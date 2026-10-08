import React,{useRef,useState} from "react";
import {auth} from "../config/firebase";
import {ACTIVITY_SALES_DEV_MODE,resolveActivitySalesDevFunctionUrl} from "../config/runtimeEnvironment";
import {allowedAttributionActions,buildAttributionEntry,checkedAttributionWriteResponse} from "../utils/activitySalesAttributionEntry";

const WRITER_URL="https://us-central1-cyjsituation-analysis.cloudfunctions.net/writeActivitySalesAttribution";
const formatCurrency=value=>new Intl.NumberFormat("zh-TW",{maximumFractionDigits:0}).format(value);

// The daily report is submitted separately. This form NEVER modifies daily report
// fields. Backend requires an existing formal report and enforces the live store,
// account, immutable version, current package price and revision transactionally.
export default function ActivitySalesAttributionEntryForm({publication,attribution,brandId,roleId,storeName,reportDate,deviceId,onWritten}){
  const [action,setAction]=useState("record_sale");
  const [packageId,setPackageId]=useState(publication?.packages?.[0]?.packageId||"");
  const [quantity,setQuantity]=useState(1);
  const [saleReference,setSaleReference]=useState("");
  const [password,setPassword]=useState("");
  const [zeroAcknowledged,setZeroAcknowledged]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const pending=useRef(null);
  const inFlight=useRef(false);
  if(!ACTIVITY_SALES_DEV_MODE||!["store","therapist"].includes(roleId))return null;
  const allowed=allowedAttributionActions(attribution?.status);
  const pkg=publication?.packages?.find(item=>item.packageId===packageId);
  const estimate=Number.isSafeInteger(pkg?.salePrice)?pkg.salePrice*quantity:null;

  const choose=(next)=>{
    // A failed request may have committed despite a transport timeout: retain the
    // same immutable saleId + exact payload until a fresh status verification.
    if(pending.current)return;
    setAction(next);setError("");setMessage("");setZeroAcknowledged(false);
  };
  async function submit(){
    if(inFlight.current)return;
    inFlight.current=true;setLoading(true);
    setError("");setMessage("");
    try{
      if(!deviceId||!storeName||!password)throw new Error("請確認信任裝置、回報店家並輸入目前帳號密碼");
      if(action==="confirm_zero"&&!zeroAcknowledged)throw new Error("請先勾選明確零成交確認");
      const user=auth.currentUser;
      if(!user)throw new Error("請重新登入");
      const {token,claims}=await user.getIdTokenResult();
      if(claims.drcyjIdentity!==true||claims.identityVersion!=="application-identity-v1"||
        claims.brandId!==brandId||claims.roleId!==roleId||!claims.accountId)
        throw new Error("登入身分與品牌不一致");
      let entry=pending.current;
      if(!entry){
        // Use a stable operator-confirmed transaction reference. Random IDs would
        // permit duplicate attribution after page reload or reconnect.
        const saleId=action==="record_sale"?saleReference.trim():undefined;
        entry=buildAttributionEntry({publication,status:attribution.status,revision:attribution.revision,
          action,packageId,quantity,saleId});
        // Lock request identity and payload for safe retries (never persist to disk).
        pending.current=entry;
      }
      const response=await fetch(resolveActivitySalesDevFunctionUrl(WRITER_URL),{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
        body:JSON.stringify({brandId,campaignId:publication.campaignId,versionId:publication.versionId,
          reportDate,storeName,...entry,
          actor:{roleId,accountId:String(claims.accountId),deviceId,credentialPassword:password}}),
      });
      const result=await response.json().catch(()=>null);
      if(!response.ok||result?.ok!==true)throw new Error(result?.message||result?.code||"登錄失敗，請確認狀態後再重試");
      const checked=checkedAttributionWriteResponse(result,publication,reportDate);
      pending.current=null;
      if(checked.needsRefresh){
        setMessage("伺服器確認這筆是重複請求，未新增成交。請重新驗證密碼並查詢最新歸屬狀態。");
        onWritten(null);
      }else{
        setMessage(action==="confirm_zero"?"已明確確認零成交；此狀態不可直接改成有成交。":"活動成交已登錄；歸屬金額不會另外加進日報營收。");
        onWritten(checked);
      }
      setZeroAcknowledged(false);
    }catch(e){
      const detail=String(e?.message||"活動歸屬無法寫入");
      setError(`${detail}。如請求可能已送出，請勿更換交易識別碼；可用相同內容重試，或先查詢最新狀態。`);
    }finally{
      setPassword("");setLoading(false);inFlight.current=false;
    }
  }
  if(!allowed.recordSale&&!allowed.confirmZero)return <p className="text-xs text-stone-600">已確認零成交，不能直接新增成交；更正須等待另行授權的工作流程。</p>;
  const requestLocked=Boolean(pending.current);
  return <div className="mt-3 border-t border-rose-100 pt-3 space-y-3" aria-label="活動成交填報（隔離測試）">
    <div className="text-xs font-black text-rose-700">活動成交填報 · 隔離測試</div>
    <p className="text-[11px] leading-5 text-stone-600">請先完成正式日報提交，再單獨登錄活動成交。金額僅供活動歸屬，<strong>絕不增加正式營收</strong>。不支援更正、退款、刪除與主管覆核；若重複填報同一交易，請使用同一識別碼。</p>
    <div className="flex flex-wrap gap-3 text-xs">
      {allowed.recordSale&&<label className="inline-flex items-center gap-1"><input type="radio" name="activity-attribution-action" checked={action==="record_sale"} disabled={loading||requestLocked} onChange={()=>choose("record_sale")}/>登錄成交</label>}
      {allowed.confirmZero&&<label className="inline-flex items-center gap-1"><input type="radio" name="activity-attribution-action" checked={action==="confirm_zero"} disabled={loading||requestLocked} onChange={()=>choose("confirm_zero")}/>明確確認 0 成交</label>}
    </div>
    {action==="record_sale"&&allowed.recordSale&&<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
      <label className="block font-semibold text-stone-700">正式套組
        <select value={packageId} disabled={loading||requestLocked} onChange={e=>{setPackageId(e.target.value);setError("");}}
          className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2">
          {(publication.packages||[]).map(item=><option key={item.packageId} value={item.packageId}>{item.name} · NT$ {formatCurrency(item.salePrice)}</option>)}
        </select>
      </label>
      <label className="block font-semibold text-stone-700">成交套數（1–99）
        <input type="number" min="1" max="99" step="1" value={quantity} disabled={loading||requestLocked}
          onChange={e=>setQuantity(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2"/>
      </label>
      <label className="block font-semibold text-stone-700 sm:col-span-2">成交交易識別碼（同一交易重填請使用同一編號）
        <input type="text" value={saleReference} maxLength="80" autoComplete="off" disabled={loading||requestLocked}
          onChange={e=>setSaleReference(e.target.value)} placeholder="只接受英數字、-、_；勿輸入個資"
          className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2"/>
      </label>
      <div className="sm:col-span-2 font-semibold text-rose-700">預計歸屬 NT$ {Number.isSafeInteger(estimate)&&estimate>0?formatCurrency(estimate):"請選有效套數"}（不加總日報）</div>
    </div>}
    {action==="confirm_zero"&&allowed.confirmZero&&<label className="flex gap-2 text-xs text-amber-800 leading-5">
      <input type="checkbox" checked={zeroAcknowledged} disabled={loading||requestLocked} onChange={e=>setZeroAcknowledged(e.target.checked)}/>
      我已核對當日此活動確實 0 筆成交，了解一經確認不可在本流程新增成交。</label>}
    <label className="block text-xs font-semibold text-stone-700">寫入前重新驗證目前帳號密碼
      <input type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}
        disabled={loading} placeholder="本次操作後立即清空" className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2"/>
    </label>
    <button type="button" disabled={loading||!password||(action==="confirm_zero"&&!zeroAcknowledged)} onClick={submit}
      className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
      {loading?"正在安全登錄…":requestLocked?"以相同交易 ID 安全重試":action==="confirm_zero"?"確認此活動為零成交":"登錄本筆活動成交"}
    </button>
    {requestLocked&&<p className="text-xs text-amber-700">前一次請求結果尚未確認。重試會保留相同交易識別碼、套組、數量與 revision；若資料已有異動，請重新查詢歸屬狀態。</p>}
    {message&&<p role="status" className="text-xs text-emerald-700">{message}</p>}
    {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
