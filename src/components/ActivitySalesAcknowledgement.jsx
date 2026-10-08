import React, {useEffect,useState} from "react";
import {auth} from "../config/firebase";
import {ACTIVITY_SALES_DEV_MODE,resolveActivitySalesDevFunctionUrl} from "../config/runtimeEnvironment";

const ACK_URL =
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/acknowledgeActivitySalesPublication";

// No direct Browser writes to acknowledgement records; only a scoped Backend transaction.
export default function ActivitySalesAcknowledgement({brandId,deviceId,publication}) {
  const [password,setPassword]=useState("");
  const [understood,setUnderstood]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [acknowledged,setAcknowledged]=useState(false);

  useEffect(()=>{
    setPassword("");setUnderstood(false);setBusy(false);
    setMessage("");setError("");setAcknowledged(false);
  },[brandId,publication?.campaignId,publication?.versionId]);

  async function submit(action) {
    if (busy) return;
    setBusy(true);setMessage("");setError("");
    try {
      if (!ACTIVITY_SALES_DEV_MODE) throw new Error("此功能僅限隔離開發環境");
      if (!deviceId) throw new Error("請先在已信任裝置登入");
      if (!password) throw new Error("請輸入目前帳號密碼以驗證理解確認");
      if (action==="acknowledge" && !understood) throw new Error("請先確認已閱讀活動規則");
      const current=auth.currentUser;
      if (!current) throw new Error("請重新登入系統");
      const {token,claims}=await current.getIdTokenResult();
      if (claims.drcyjIdentity!==true || claims.identityVersion!=="application-identity-v1" ||
          claims.brandId!==brandId || !claims.roleId || !claims.accountId) {
        throw new Error("帳號身分或品牌不符，已停止確認");
      }
      const actor={roleId:claims.roleId,accountId:String(claims.accountId),deviceId,
        credentialPassword:password};
      const response=await fetch(resolveActivitySalesDevFunctionUrl(ACK_URL),{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
        body:JSON.stringify({action,brandId,campaignId:publication.campaignId,
          versionId:publication.versionId,actor,confirmUnderstood:action==="acknowledge"}),
      });
      const result=await response.json().catch(()=>null);
      if (!response.ok || result?.ok!==true) throw new Error(result?.message || result?.code || "理解確認尚未完成");
      setAcknowledged(Boolean(result.acknowledged));
      setMessage(result.acknowledged
        ? `已確認正式版本 ${publication.versionId}，活動改版後須重新確認。`
        : "此活動版本尚未完成理解確認。");
    } catch(e) {setError(String(e?.message || "理解確認失敗"));}
    finally {setBusy(false);setPassword("");}
  }

  return (
    <section className="mt-5 rounded-2xl border border-rose-100 bg-rose-50/40 p-4">
      <div className="text-xs font-black text-rose-700">正式活動理解確認</div>
      <p className="mt-1 text-[11px] leading-5 text-stone-600">
        確認適用對象、不得併用規則、正式套組及售價。記錄只綁定目前發布版本，改版後不沿用舊確認。
      </p>
      {acknowledged && <p role="status" className="mt-2 text-xs font-bold text-rose-700">此版本已完成理解確認</p>}
      <label className="mt-3 block text-xs font-bold text-stone-700">
        目前帳號密碼（驗證後立即清空）
        <input type="password" autoComplete="off" value={password}
          onChange={(e)=>setPassword(e.target.value)}
          className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs"
          placeholder="請輸入目前登入密碼" />
      </label>
      <label className="mt-3 flex items-start gap-2 text-xs text-stone-700">
        <input type="checkbox" checked={understood} onChange={(e)=>setUnderstood(e.target.checked)}
          className="mt-0.5" />
        <span>我已閱讀本版本的活動條件、售價、組合與不可併用限制。</span>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !understood || acknowledged} onClick={()=>submit("acknowledge")}
          className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
          完成理解確認
        </button>
        <button type="button" disabled={busy} onClick={()=>submit("status")}
          className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-bold text-rose-700 disabled:opacity-40">
          查詢我的確認狀態
        </button>
      </div>
      {message && <p role="status" className="mt-2 text-xs text-stone-600">{message}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
    </section>
  );
}
