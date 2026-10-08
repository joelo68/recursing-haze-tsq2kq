import React,{useEffect,useMemo,useRef,useState} from "react";
import SmartDatePicker from "./SmartDatePicker";
import {auth} from "../config/firebase";
import {ACTIVITY_SALES_DEV_MODE,resolveActivitySalesDevFunctionUrl} from "../config/runtimeEnvironment";
import {taipeiDateString} from "../utils/activitySalesPublished";
import {checkedReviewPage,reviewFromInspect,REVIEW_DECISIONS,REVIEW_REASONS} from "../utils/activitySalesReviewUiContract";

const INBOX_URL="https://us-central1-cyjsituation-analysis.cloudfunctions.net/getActivitySalesReviewCandidates";
const REVIEW_URL="https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageActivitySalesAttributionReview";
const numberText=value=>value===null||value===undefined?"N/A":new Intl.NumberFormat("zh-TW").format(value);
const secondary="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-40";
const primary="rounded-full bg-rose-500 px-4 py-2 text-xs font-black text-white hover:bg-rose-600 disabled:opacity-40";

// Isolated frontend only. Browser does NOT read private Firestore review/attribution docs.
// All list/inspect/review actions require fresh credential and Backend authority.
export default function ActivitySalesAttributionReviewPanel({brandId,deviceId,roleId,stores=[]}){
  const availableStores=useMemo(()=>Array.from(new Set((Array.isArray(stores)?stores:[])
    .map(v=>String(v||"").trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"zh-TW")),[stores]);
  const scopeSerial=useRef(0);
  const [storeName,setStoreName]=useState("");
  const [reportDate,setReportDate]=useState(()=>taipeiDateString());
  const [password,setPassword]=useState("");
  const [rows,setRows]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const [cursors,setCursors]=useState([null]);
  const [pageNumber,setPageNumber]=useState(0);
  const [nextCursor,setNextCursor]=useState(null);
  const [chosen,setChosen]=useState(null);
  const [inspect,setInspect]=useState(null);
  const [reason,setReason]=useState("AMOUNT_RECHECK");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const today=taipeiDateString();

  // Clear previous brand / store / date candidates and OCC tokens. Never show stale
  // candidates under a newly selected authorization scope.
  useEffect(()=>{
    scopeSerial.current++;
    setStoreName("");setReportDate(taipeiDateString());setPassword("");setRows([]);
    setLoaded(false);setCursors([null]);setPageNumber(0);setNextCursor(null);
    setChosen(null);setInspect(null);setError("");setNotice("");
  },[brandId]);
  useEffect(()=>{
    if(storeName && !availableStores.includes(storeName)){setStoreName("");clearPage();}
  },[storeName,availableStores]);
  function clearPage(){scopeSerial.current++;setRows([]);setLoaded(false);setCursors([null]);setPageNumber(0);
    setNextCursor(null);setChosen(null);setInspect(null);setError("");setNotice("");}

  async function post(url,payload){
    if(!ACTIVITY_SALES_DEV_MODE || roleId!=="store")throw new Error("只有隔離環境的店經理能使用覆核工具");
    if(!deviceId || !storeName || !availableStores.includes(storeName))throw new Error("請先確認信任裝置與授權門市");
    if(!password)throw new Error("請輸入目前帳號密碼，後端將重新核對權限");
    const user=auth.currentUser;
    if(!user)throw new Error("請先完成 Application Identity 登入");
    const result=await user.getIdTokenResult();
    const claims=result.claims||{};
    if(claims.drcyjIdentity!==true || claims.identityVersion!=="application-identity-v1" ||
       claims.brandId!==brandId || claims.roleId!=="store" || !claims.accountId)
      throw new Error("品牌或店經理身分不符，已停止操作");
    const actor={roleId:"store",accountId:String(claims.accountId),deviceId,credentialPassword:password};
    const response=await fetch(resolveActivitySalesDevFunctionUrl(url),{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${result.token}`},
      body:JSON.stringify({brandId,storeName,actor,...payload}),
    });
    const data=await response.json().catch(()=>null);
    if(!response.ok || data?.ok!==true)throw new Error(data?.code||`服務未完成（HTTP ${response.status}）`);
    return data;
  }
  async function perform(task){
    if(busy)return;
    setBusy(true);setError("");setNotice("");
    try{await task();}catch(e){setError(String(e?.message||"覆核操作失敗"));}
    finally{setPassword("");setBusy(false);}
  }
  function loadPage(targetIndex,cursor){
    const serial=scopeSerial.current;
    return perform(async()=>{
      // Clear previous results BEFORE awaiting request; a failed next-page request
      // must not leave the previous page masquerading as the requested one.
      setRows([]);setLoaded(false);setChosen(null);setInspect(null);setNextCursor(null);
      const data=checkedReviewPage(await post(INBOX_URL,{action:"list_candidates",reportDate,
        ...(cursor?{cursor}:{})}),{brandId,reportDate,storeName});
      if(serial!==scopeSerial.current)return;
      setRows(data.candidates);setNextCursor(data.nextCursor);setLoaded(true);
      setPageNumber(targetIndex);
      setCursors(current=>{
        const next=current.slice(0,targetIndex+1);
        if(targetIndex+1===next.length && data.hasMore)next.push(data.nextCursor);
        else if(data.hasMore)next[targetIndex+1]=data.nextCursor;
        return next;
      });
    });
  }
  function inspectRow(row){
    const serial=scopeSerial.current;
    return perform(async()=>{
      setChosen(null);setInspect(null);
      const subject={brandId,campaignId:row.campaignId,versionId:row.versionId,
        roleId:"therapist",accountId:row.accountId,reportDate};
      const data=await post(REVIEW_URL,{action:"inspect",subject});
      reviewFromInspect({inspect:data,expected:subject});
      if(serial!==scopeSerial.current)return;
      setChosen(row);setInspect(data);
    });
  }
  function writeReview(decision){
    const serial=scopeSerial.current;
    return perform(async()=>{
      const row=chosen,detail=inspect;
      if(!row||!detail)throw new Error("請先重新檢視這筆待核對資料");
      const subject={brandId,campaignId:row.campaignId,versionId:row.versionId,
        roleId:"therapist",accountId:row.accountId,reportDate};
      const expected=reviewFromInspect({inspect:detail,expected:subject});
      const data=await post(REVIEW_URL,{action:"review",subject,decision,
        reason:decision===REVIEW_DECISIONS.FLAGGED?reason:"",...expected});
      if(!["written","idempotent"].includes(data.state)||data.formalRevenueDelta!==0)
        throw new Error("覆核結果不符合業務契約，請重新查詢");
      if(serial!==scopeSerial.current)return;
      setRows([]);setLoaded(false);setChosen(null);setInspect(null);setNextCursor(null);
      setCursors([null]);setPageNumber(0);
      setNotice("覆核已送出；請重新查詢候選清單，確認最新狀態。正式日報營收沒有變更。");
    });
  }

  if(!ACTIVITY_SALES_DEV_MODE||roleId!=="store")return null;
  return <section className="space-y-4 rounded-2xl border border-rose-100 bg-white p-4 shadow-sm sm:p-5" aria-label="店經理活動成交覆核">
    <div><h3 className="text-sm font-black text-stone-800">店經理 · 活動成交覆核</h3>
      <p className="mt-1 text-[11px] leading-5 text-stone-500">僅限授權門市及指定日期，手動分頁查詢；每頁最多 12 筆候選。候選不代表已完成覆核，逐筆檢視時會再確認正式日報與目前活動版本。</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-stone-600">授權門市
        <select className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs" value={storeName}
          onChange={e=>{setStoreName(e.target.value);clearPage();}}>
          <option value="">選擇授權門市</option>
          {availableStores.map(name=><option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <div className="min-w-0"><div className="mb-1 text-xs font-semibold text-stone-600">回報日期</div>
        <SmartDatePicker selectedDate={reportDate} onDateSelect={v=>{setReportDate(v||today);clearPage();}}
          maxDate={today} placeholder="選擇回報日期" />
      </div>
    </div>
    {!availableStores.length && <p className="text-xs text-amber-700">目前沒有可選的授權門市，請重新確認帳號及門市設定。</p>}
    <label className="block text-xs font-semibold text-stone-600">每次查詢／覆核需重新輸入目前帳號密碼
      <input type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}
        className="mt-1 w-full max-w-sm rounded-xl border border-stone-200 px-3 py-2 text-xs" placeholder="本次操作驗證（不保存密碼）" />
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={primary} disabled={busy||!storeName||!deviceId||!password}
        onClick={()=>loadPage(0,null)}>{busy?"確認身分中…":"手動查詢第一頁"}</button>
      {loaded&&pageNumber>0&&<button type="button" className={secondary} disabled={busy||!password}
        onClick={()=>loadPage(pageNumber-1,cursors[pageNumber-1])}>上一頁</button>}
      {loaded&&nextCursor&&<button type="button" className={secondary} disabled={busy||!password}
        onClick={()=>loadPage(pageNumber+1,nextCursor)}>下一頁（重新驗證）</button>}
    </div>
    {loaded&&<p className="text-[11px] text-stone-500">第 {pageNumber+1} 頁 · {rows.length} 筆有效候選{nextCursor?" · 後方仍有候選，請繼續翻頁":" · 本次查詢已到最後一頁"}。舊版或轉店資料可能被排除，不代表全店總筆數。</p>}
    {loaded&&!rows.length&&<p className="text-xs text-stone-500">這一頁沒有符合當前條件的歸屬候選；尚未確認不等於零成交。{nextCursor?"仍有下一頁可查。":""}</p>}
    <div className="space-y-2">{rows.map(row=><div key={`${row.accountId}:${row.campaignId}:${row.versionId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50 p-3">
      <div className="min-w-0"><div className="text-xs font-bold text-stone-800">管理師 {row.accountId} · 活動 {row.campaignId}</div>
        <p className="mt-1 text-[11px] text-stone-500">正式版本 {row.versionId} · {row.status==="CONFIRMED_ZERO"?"已確認零成交":"已有成交"} · {numberText(row.saleCount)} 筆 · 歸屬額 {numberText(row.attributedAmount)} 元</p></div>
      <button type="button" className={secondary} disabled={busy||!password} onClick={()=>inspectRow(row)}>重新驗證並檢視</button>
    </div>)}</div>
    {inspect&&chosen&&<div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/50 p-4">
      <div className="text-xs font-black text-stone-800">單筆覆核 · {chosen.accountId}／{chosen.campaignId}</div>
      <p className="text-xs text-stone-600">狀態：{inspect.status==="CONFIRMED_ZERO"?"已確認零成交":"已有成交"}；歸屬額 {numberText(inspect.attributedAmount)} 元（<strong>正式營收新增 0 元</strong>）</p>
      <p className="text-[11px] text-stone-500">目前覆核：{inspect.review?.state||"UNREVIEWED"}；覆核 revision：{inspect.review?.reviewRevision??0}。任何正式日報或歸屬異動，都會由 Backend OCC 拒絕舊資料的覆核。</p>
      <label className="block text-xs font-semibold text-stone-600">要求複核原因
        <select value={reason} onChange={e=>setReason(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs">
          {REVIEW_REASONS.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={busy||!password} onClick={()=>writeReview(REVIEW_DECISIONS.VERIFIED)}>核對通過</button>
        <button type="button" className={secondary} disabled={busy||!password} onClick={()=>writeReview(REVIEW_DECISIONS.FLAGGED)}>要求複核</button>
      </div>
    </div>}
    {notice&&<p role="status" className="text-xs font-bold text-emerald-700">{notice}</p>}
    {error&&<p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
    <p className="text-[10px] leading-5 text-stone-400">R2B 隔離開發版：不提供更正、退款、刪除或正式營收調整；不查詢私人 Firestore、不使用背景常駐監聽。</p>
  </section>;
}
