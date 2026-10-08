import React,{useState} from "react";
import ActivitySalesAttributionEntryForm from "./ActivitySalesAttributionEntryForm";
import {collection,getDocsFromServer,limit,orderBy,query,where} from "firebase/firestore";
import {auth,db} from "../config/firebase";
import {ACTIVITY_SALES_DEV_MODE,resolveActivitySalesDevFunctionUrl} from "../config/runtimeEnvironment";
import {getActivitySalesPublicationPath} from "../utils/activitySalesPublished";

const STATUS_URL="https://us-central1-cyjsituation-analysis.cloudfunctions.net/getActivitySalesAttributionStatus";
const currency=(value)=>new Intl.NumberFormat("zh-TW",{maximumFractionDigits:0}).format(value);

// Only rendered in the isolated activity-sales build, never on Production InputView.
// All reads/writes are explicit user actions through authorized Backend endpoints;
// no listener, polling, private Browser reads/writes or formal report mutation.
export default function ActivitySalesAttributionStatusPanel({brandId,roleId,storeName,reportDate,deviceId}){
  const [campaigns,setCampaigns]=useState([]);
  const [campaignId,setCampaignId]=useState("");
  const [password,setPassword]=useState("");
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [listLoaded,setListLoaded]=useState(false);
  const [refreshNeeded,setRefreshNeeded]=useState(false);
  const [entryNotice,setEntryNotice]=useState("");
  if(!ACTIVITY_SALES_DEV_MODE || !["store","therapist"].includes(roleId))return null;

  async function loadCampaigns(){
    if(loading)return;
    setLoading(true);setError("");setResult(null);setRefreshNeeded(false);setEntryNotice("");setListLoaded(false);setRefreshNeeded(false);setEntryNotice("");
    try{
      if(!auth.currentUser || !storeName || !deviceId)throw new Error("請先確認登入、信任裝置及回報門市");
      const token=await auth.currentUser.getIdTokenResult();
      if(token.claims.drcyjIdentity!==true || token.claims.identityVersion!=="application-identity-v1" ||
        token.claims.brandId!==brandId || token.claims.roleId!==roleId) throw new Error("登入身分不符，已停止載入活動");
      const ref=collection(db,getActivitySalesPublicationPath(brandId));
      const snap=await getDocsFromServer(query(ref,where("endDate",">=",reportDate),orderBy("endDate","asc"),limit(30)));
      const available=snap.docs.map(d=>({...d.data(),campaignId:d.id})).filter(row=>
        row.status==="published" && row.brandId===brandId && row.startDate<=reportDate &&
        row.endDate>=reportDate && typeof row.versionId==="string");
      setCampaigns(available);setCampaignId(available[0]?.campaignId||"");setListLoaded(true);
    }catch(e){setCampaigns([]);setCampaignId("");setError(String(e?.message||"無法取得目前正式活動"));}
    finally{setLoading(false);}
  }
  async function loadStatus(){
    if(loading)return;
    setLoading(true);setError("");setResult(null);setRefreshNeeded(false);setEntryNotice("");
    try{
      if(!password || !deviceId || !storeName)throw new Error("請輸入帳號密碼並確認店家與信任裝置");
      const selected=campaigns.find(row=>row.campaignId===campaignId);
      if(!selected)throw new Error("請選擇正式活動");
      const current=auth.currentUser;
      if(!current)throw new Error("請先重新登入");
      const {token,claims}=await current.getIdTokenResult();
      if(claims.drcyjIdentity!==true || claims.identityVersion!=="application-identity-v1" ||
        claims.brandId!==brandId || claims.roleId!==roleId || !claims.accountId)throw new Error("登入品牌或帳號不符");
      const response=await fetch(resolveActivitySalesDevFunctionUrl(STATUS_URL),{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
        body:JSON.stringify({brandId,campaignId:selected.campaignId,versionId:selected.versionId,
          reportDate,storeName,actor:{roleId,accountId:String(claims.accountId),deviceId,credentialPassword:password}}),
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok || data?.ok!==true)throw new Error(data?.message||data?.code||"查詢失敗");
      if(data.brandId!==brandId || data.campaignId!==selected.campaignId || data.versionId!==selected.versionId ||
        data.reportDate!==reportDate || data.formalRevenueDelta!==0)throw new Error("查詢結果不符合品牌／版本／日報契約");
      setResult(data);setRefreshNeeded(false);setEntryNotice("");
    }catch(e){setError(String(e?.message||"無法讀取活動成交歸屬"));}
    finally{setPassword("");setLoading(false);}
  }
  const selected=campaigns.find(c=>c.campaignId===campaignId);
  return <section className="rounded-2xl border border-rose-100 bg-rose-50/30 p-4 space-y-3" aria-label="活動成交歸屬狀態">
    <div className="text-xs font-black text-rose-700">活動成交歸屬 · 查詢與填報（隔離環境）</div>
    <p className="text-[11px] leading-5 text-stone-600">僅查詢 {reportDate}／{storeName} 的目前正式活動版本。活動金額為原有日報營收的分類歸屬，<strong>不額外計入現金、權責或個人業績</strong>。歷史改版前版本不在此查詢範圍。</p>
    <button type="button" disabled={loading||!storeName||!deviceId} onClick={loadCampaigns}
      className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">
      {loading?"正在驗證…":"手動載入該日期正式活動（最多 30 筆）"}
    </button>
    {listLoaded && <>
      {campaigns.length===0?<p className="text-xs text-stone-500">此日期沒有可查詢的目前正式活動；不代表已確認零成交。</p>:
        <label className="block text-xs font-bold text-stone-600">正式活動
          <select value={campaignId} onChange={e=>{setCampaignId(e.target.value);setResult(null);setError("");setEntryNotice("");}}
            className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs">
            {campaigns.map(c=><option key={c.campaignId} value={c.campaignId}>{c.title||c.campaignId}（{c.versionId}）</option>)}
          </select>
        </label>}
      {selected && <>
        <label className="block text-xs font-bold text-stone-600">查詢時重新驗證目前帳號密碼
          <input type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}
            className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs" placeholder="查詢完成立即清空" />
        </label>
        <button type="button" disabled={loading||!password} onClick={loadStatus}
          className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">查詢此活動歸屬狀態</button>
      </>}
    </>}
    {result && <div role="status" className="rounded-xl border border-rose-100 bg-white p-3 text-xs text-stone-700">
      <div className="font-bold">{result.status==="UNCONFIRMED"?"尚未確認（不是零成交）":
        result.status==="CONFIRMED_ZERO"?"已明確確認：0 筆成交":"已有成交紀錄"}</div>
      <div className="mt-1">成交筆數：{result.saleCount===null?"N/A":result.saleCount}　歸屬額：{result.attributedAmount===null?"N/A":`NT$ ${currency(result.attributedAmount)}`}</div>
      <div className="mt-1 text-[11px] text-stone-500">正式版本 {result.versionId} · Revision {result.revision} · 正式業績新增額 0</div>
    </div>}
    {selected && result && !refreshNeeded && <ActivitySalesAttributionEntryForm
      key={`${selected.campaignId}-${selected.versionId}-${result.revision}`}
      publication={selected} attribution={result} brandId={brandId} roleId={roleId}
      storeName={storeName} reportDate={reportDate} deviceId={deviceId}
      onWritten={next=>{if(next){setResult(previous=>({...previous,...next}));
        setEntryNotice(next.status==="CONFIRMED_ZERO"?"已確認零成交（正式日報營收不變）。":"成交已登錄；正式日報營收不變。");
      }else{setResult(null);setRefreshNeeded(true);setEntryNotice("");}}}/>}
    {entryNotice && <p role="status" className="text-xs font-semibold text-emerald-700">{entryNotice}</p>}
    {refreshNeeded && <p className="text-xs text-amber-700">請重新輸入密碼，查詢正式歸屬狀態後才能繼續登錄。</p>}
    {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
  </section>;
}
