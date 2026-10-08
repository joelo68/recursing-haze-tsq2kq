import React, { useEffect, useMemo, useState } from "react";
import SmartDatePicker from "./SmartDatePicker";
import { auth } from "../config/firebase";
import { ACTIVITY_SALES_DEV_MODE, resolveActivitySalesDevFunctionUrl } from "../config/runtimeEnvironment";
import { draftToEditor, editorToDraft, emptyDraft, pricingWarnings } from "../utils/activitySalesEditor";
import ActivitySalesPolicyPanel from "./ActivitySalesPolicyPanel";

const WORKSPACE_URL = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/getActivitySalesWorkspace";
const CAMPAIGN_URL = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageActivityCampaign";
const labels = ["基本資料", "套組與售價", "資格限制", "金額歸屬", "銷售話術", "常見問題", "發布與審核", "預覽／送審"];
const tones = "rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs text-stone-700 outline-none focus:border-rose-300";
const smallButton = "rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40";
const primaryButton = "rounded-full bg-rose-500 px-4 py-2 text-xs font-black text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40";
const lineHelp = "每行一項；儲存時由後端再次驗證內容與權限。";
const money = (n) => new Intl.NumberFormat("zh-TW", { style:"currency", currency:"TWD", maximumFractionDigits:0 }).format(Number(n || 0));
const statusLabels={draft:"草稿",returned:"退回修改",pending_approval:"審核中",approved:"已核准待發布",published:"已發布",stopped:"已停止",cancelled:"已取消"};
const emptyForm = () => draftToEditor(emptyDraft());

function LineField({label,value,onChange,help=lineHelp}) {
  return <label className="block text-xs font-semibold text-stone-600">
    <span className="mb-2 block">{label}</span>
    <textarea rows={3} className={`${tones} w-full resize-y`} value={value || ""} onChange={(e)=>onChange(e.target.value)} />
    <span className="mt-1 block text-[10px] font-normal text-stone-400">{help}</span>
  </label>;
}
function TextField({label,value,onChange,type="text",placeholder="",min}) {
  return <label className="block text-xs font-semibold text-stone-600">
    <span className="mb-2 block">{label}</span>
    <input className={`${tones} w-full`} type={type} min={min} value={value ?? ""} placeholder={placeholder} onChange={(e)=>onChange(e.target.value)} />
  </label>;
}
function RowSection({title,children}) {
  return <section className="rounded-2xl border border-stone-200 bg-stone-50/60 p-4">
    <h4 className="mb-4 text-xs font-black text-stone-700">{title}</h4>{children}
  </section>;
}

export default function ActivitySalesManagementView({brandId,deviceId}) {
  const [credentialPassword,setCredentialPassword]=useState("");
  const [inbox,setInbox]=useState([]);
  const [inboxMeta,setInboxMeta]=useState(null);
  const [policyVisible,setPolicyVisible]=useState(false);
  const [capabilities,setCapabilities]=useState(null);
  const [campaignId,setCampaignId]=useState("");
  const [lookupId,setLookupId]=useState("");
  const [record,setRecord]=useState(null);
  const [form,setForm]=useState(emptyForm);
  const [step,setStep]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [reviewComment,setReviewComment]=useState("");
  const [hasUnsavedChanges,setHasUnsavedChanges]=useState(false);
  // Never retain a different brand's private campaign/policy on a brand switch.
  useEffect(()=>{setCredentialPassword("");setCapabilities(null);setInbox([]);setInboxMeta(null);
    setRecord(null);setCampaignId("");setLookupId("");setForm(emptyForm());setHasUnsavedChanges(false);
    setPolicyVisible(false);setError("");setMessage("");},[brandId]);
  const warnings=useMemo(()=>pricingWarnings(form),[form]);
  const mutateForm=(mutator)=>{setForm((current)=>mutator(current));setHasUnsavedChanges(true);};
  const patch=(key,value)=>mutateForm((f)=>({...f,[key]:value}));
  const patchPlan=(key,value)=>mutateForm((f)=>({...f,approvalPlan:{...f.approvalPlan,[key]:value}}));
  const patchPackage=(index,patchValue)=>mutateForm((f)=>({...f,packages:f.packages.map((p,i)=>i===index?{...p,...patchValue}:p)}));
  const patchItem=(pkgIndex,itemIndex,patchValue)=>mutateForm((f)=>({...f,packages:f.packages.map((p,i)=>i===pkgIndex?{...p,items:p.items.map((item,j)=>j===itemIndex?{...item,...patchValue}:item)}:p)}));

  async function call(url,action,payload={}) {
    if (!ACTIVITY_SALES_DEV_MODE) throw new Error("管理工作台僅限 Activity Sales 本機隔離模式");
    if (!deviceId) throw new Error("請先完成已信任裝置驗證，才能操作活動管理工作台");
    if (!credentialPassword) throw new Error("請輸入目前帳號密碼，後端將重新驗證操作權限");
    const current=auth.currentUser;
    if (!current) throw new Error("尚未登入 Application Identity");
    const token=await current.getIdTokenResult();
    const claims=token.claims || {};
    if (claims.drcyjIdentity!==true || claims.identityVersion!=="application-identity-v1" ||
        claims.brandId!==brandId || !claims.roleId || !claims.accountId) {
      throw new Error("登入品牌或身分與活動工作台不一致");
    }
    const actor={roleId:claims.roleId,accountId:String(claims.accountId),deviceId,credentialPassword};
    const response=await fetch(resolveActivitySalesDevFunctionUrl(url),{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token.token}`},
      body:JSON.stringify({action,brandId,actor,...payload}),
    });
    const data=await response.json().catch(()=>null);
    if (!response.ok || data?.ok!==true) {
      const failure=new Error(data?.message || `操作未完成（HTTP ${response.status}）`);
      failure.code=data?.code || "WORKSPACE_REQUEST_FAILED";
      throw failure;
    }
    return data;
  }
  async function perform(label,fn) {
    if (busy) return;
    setBusy(true);setError("");setMessage("");
    try {await fn();setMessage(label);}
    catch(err) {setError(`${err?.message || "操作未完成"}${err?.code?.includes("CONFLICT") ? "；請重新載入活動後再操作。" : ""}`);}
    finally {setBusy(false);}
  }
  const refreshInbox=()=>perform("已更新我的待核准活動",async()=>{
    const result=await call(WORKSPACE_URL,"approval_inbox");
    setInbox(result.inbox || []);setInboxMeta({limit:result.limit,hasMore:result.hasMore});
  });
  const refreshCapabilities=()=>perform("已確認管理權限",async()=>{
    const result=await call(WORKSPACE_URL,"capabilities");
    setCapabilities(result.capabilities);
  });
  async function loadCampaign(id) {
    const target=String(id || "").trim();
    if (!target) throw new Error("請輸入活動代碼");
    const result=await call(WORKSPACE_URL,"get_campaign",{campaignId:target});
    setCapabilities(result.capabilities);
    setRecord(result.campaign);
    setCampaignId(target);setLookupId(target);
    setForm(draftToEditor(result.campaign.draft || emptyDraft()));
    setHasUnsavedChanges(false);
    setStep(0);
    return result;
  }
  const lookupCampaign=()=>perform("活動已重新載入",()=>loadCampaign(lookupId));
  const freshDraft=()=>{setRecord(null);setCampaignId("");setForm(emptyForm());setHasUnsavedChanges(false);setStep(0);setError("");setMessage("新的草稿尚未寫入資料庫");};
  const isAmendment=Boolean(record?.amendment);
  const canSave=capabilities?.canCreate === true && (!record || capabilities?.canEdit || capabilities?.canEditAmendment);
  const saveDraft=()=>perform("草稿已儲存",async()=>{
    if (warnings.length) throw new Error(warnings.join("；"));
    const draft=editorToDraft(form);
    const action=record?(isAmendment?"update_amendment":"update_draft"):"create_draft";
    const result=await call(CAMPAIGN_URL,action,record
      ? {campaignId,expectedRevision:record.revision,campaign:draft}
      : {campaign:draft});
    const id=result.campaign?.campaignId || campaignId;
    if (!id) throw new Error("後端未回傳活動代碼");
    await loadCampaign(id);
  });
  const action=(name,label,comment="")=>perform(`${label}完成，已重新讀取最新狀態`,async()=>{
    if (!record) throw new Error("請先建立或載入活動");
    const result=await call(CAMPAIGN_URL,name,{campaignId,expectedRevision:record.revision,comment});
    if (["approve","return_for_changes"].includes(name)) {
      setInbox((current)=>current.filter((item)=>item.campaignId!==campaignId));
    }
    try {
      await loadCampaign(campaignId);
    } catch (err) {
      // Approval can transfer visibility away from the current reviewer.
      // A successful writer response must never be misreported as a failed mutation.
      if (err?.code !== "WORKSPACE_FORBIDDEN") {
        throw new Error(`${label}已由後端完成（${result.status || "已處理"}），但重新讀取失敗：${err?.message || "未知錯誤"}`);
      }
      setRecord(null);
      setForm(emptyForm());
      setHasUnsavedChanges(false);
      setMessage(`${label}已完成；目前審核權限已移交下一關或發布人，已收回私人草稿內容。`);
    }
    setReviewComment("");
  });
  const addPackage=()=>mutateForm((f)=>({...f,packages:[...f.packages,{packageId:`package_${f.packages.length+1}`,name:"",salePrice:"",originalPrice:"",items:[{itemId:"item_1",type:"course",name:"",quantity:1,attributedAmount:""}]}]}));
  const addStep=()=>patchPlan("steps",[...form.approvalPlan.steps,{stepId:`step_${form.approvalPlan.steps.length+1}`,label:"",quorum:"any",selectorText:""}]);

  return <div className="space-y-4 text-stone-700">
    <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4">
      <div className="text-[10px] font-black tracking-widest text-rose-600">PHASE 1C · LOCAL EMULATOR ONLY</div>
      <h3 className="mt-1 text-base font-black">活動規劃與審核工作台</h3>
      <p className="mt-2 text-xs leading-6 text-stone-600">草稿／審核資料只能透過後端權限入口按活動代碼查詢；所有寫入均執行身份、裝置與版本衝突驗證。密碼只在目前頁面暫存，不寫入 Firestore。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <TextField label="目前帳號密碼（每次請求重新驗證）" type="password" value={credentialPassword} onChange={setCredentialPassword} placeholder="輸入密碼後查詢權限" />
        <button className={smallButton} disabled={busy} type="button" onClick={refreshCapabilities}>確認我的活動權限</button>
      </div>
      {!deviceId && <p role="alert" className="mt-2 text-xs font-bold text-rose-700">目前沒有已驗證裝置識別，後端不接受管理操作。</p>}
      {capabilities && <p className="mt-3 text-xs text-stone-600">Policy：{capabilities.policyReady?"已設定":"未設定"} · 建立：{capabilities.canCreate?"允許":"未授權"} · 免審核：{capabilities.canDirectPublish?"允許":"未授權"} · 發布：{capabilities.canPublish?"允許":"未授權"}</p>}
      {capabilities?.policyReady===false && <p className="mt-1 text-xs text-amber-800">尚未設定品牌活動權限。請由最高管理者透過已驗證的 Backend Policy Authority 完成設定。</p>}
      {!!capabilities?.groups?.length && <p className="mt-2 text-[11px] text-stone-500">可用群組：{capabilities.groups.map((g)=>`@${g.groupId}（${g.label}）`).join("、")}</p>}
    </div>

    <section className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h4 className="text-sm font-black text-stone-800">我的待核准活動</h4>
          <p className="mt-1 text-[11px] text-stone-500">只查詢本人目前關卡，單次最多 20 筆；不會持續監聽或讀取其他管理者的私人草稿。</p></div>
        <button type="button" className={smallButton} disabled={busy} onClick={refreshInbox}>手動更新待辦</button>
      </div>
      {inbox.length>0 ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{inbox.map((item)=><button
        key={item.versionId} type="button" disabled={busy || hasUnsavedChanges} onClick={()=>perform("已開啟待核准活動",()=>loadCampaign(item.campaignId))}
        className="rounded-xl border border-rose-100 bg-rose-50/40 p-3 text-left text-xs hover:bg-rose-50 disabled:opacity-50">
          <div className="font-black text-stone-800">{item.title}</div>
          <div className="mt-1 text-stone-500">{item.campaignId} · {item.stepLabel}（第 {item.stepIndex+1}/{item.stepCount} 關）</div>
        </button>)}</div> : inboxMeta && <p className="mt-3 text-xs text-stone-500">目前沒有屬於您的待核准活動。</p>}
      {inboxMeta?.hasMore && <p className="mt-2 text-xs text-amber-700">目前僅載入前 20 筆，仍可能有其他待辦；此畫面未提供全品牌掃描。</p>}
      {hasUnsavedChanges && <p className="mt-2 text-xs text-amber-700">請先儲存或捨棄目前草稿，才能從 Inbox 切換活動。</p>}
    </section>
    <section className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h4 className="text-sm font-black">活動權限 Policy（最高管理者）</h4><p className="mt-1 text-[11px] text-stone-500">需重新驗證最高管理者身分，修改採 revision OCC。</p></div>
        <button type="button" className={smallButton} onClick={()=>setPolicyVisible((v)=>!v)}>{policyVisible?"收起權限設定":"開啟權限設定"}</button>
      </div>
      {policyVisible && <ActivitySalesPolicyPanel key={brandId} request={call} busy={busy} setBusy={setBusy} />}
    </section>
    <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-stone-200 bg-white p-4">
      <label className="min-w-0 flex-1 text-xs font-semibold">依活動代碼開啟 <input className={`${tones} mt-2 block w-full`} value={lookupId} onChange={(e)=>setLookupId(e.target.value)} placeholder="例如：brand_october_campaign" /></label>
      <button type="button" className={smallButton} disabled={busy} onClick={lookupCampaign}>載入單檔活動</button>
      <button type="button" className={smallButton} disabled={busy || !capabilities?.canCreate} onClick={freshDraft}>建立新活動</button>
    </div>

    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">{message}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-500">
      <span>活動 ID：<strong className="text-stone-700">{campaignId || "尚未建立"}</strong> · 狀態：{statusLabels[record?.status] || (record?record.status:"新草稿")} · Revision：{record?.revision || "—"}</span>
      {hasUnsavedChanges && <span className="font-bold text-amber-800">有尚未儲存的本機編輯</span>}
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {labels.map((label,index)=><button type="button" key={label} onClick={()=>setStep(index)} className={`rounded-xl px-2 py-2 text-[11px] font-bold ${step===index?"bg-rose-500 text-white":"border border-stone-200 bg-white text-stone-600"}`}>{index+1}. {label}</button>)}
    </div>

    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
      <h3 className="mb-4 text-sm font-black">{labels[step]}</h3>
      {step===0 && <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="活動名稱" value={form.title} onChange={(v)=>patch("title",v)} />
        <LineField label="活動標籤" value={form.tags} onChange={(v)=>patch("tags",v)} />
        <div className="min-w-0">
          <div className="mb-2 text-xs font-semibold text-stone-600">開始日期</div>
          <SmartDatePicker selectedDate={form.startDate || ""} onDateSelect={(date)=>patch("startDate",date)} allowClear placeholder="選擇活動開始日期" />
        </div>
        <div className="min-w-0">
          <div className="mb-2 text-xs font-semibold text-stone-600">結束日期</div>
          <SmartDatePicker selectedDate={form.endDate || ""} onDateSelect={(date)=>patch("endDate",date)} minDate={form.startDate || undefined} allowClear placeholder="選擇活動結束日期" />
        </div>
        <div className="sm:col-span-2"><TextField label="活動一句話摘要" value={form.shortSummary} onChange={(v)=>patch("shortSummary",v)} /></div>
        <label className="text-xs font-bold">參與門市 <select className={`${tones} ml-3`} value={form.storeScope} onChange={(e)=>patch("storeScope",e.target.value)}><option value="all">全品牌</option><option value="selected">指定門市</option></select></label>
        {form.storeScope==="selected" && <LineField label="指定門市名稱（每行一間）" value={form.stores} onChange={(v)=>patch("stores",v)} />}
      </div>}
      {step===1 && <div className="space-y-4">
        {form.packages.map((p,index)=><RowSection key={`${index}-${p.packageId}`} title={`套組 ${index+1}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="套組代碼（英數／底線）" value={p.packageId} onChange={(v)=>patchPackage(index,{packageId:v})} />
            <TextField label="套組名稱" value={p.name} onChange={(v)=>patchPackage(index,{name:v})} />
            <TextField label="正式優惠售價（元）" value={p.salePrice} type="number" min="0" onChange={(v)=>patchPackage(index,{salePrice:v})} />
            <TextField label="原價（可空白）" value={p.originalPrice} type="number" min="0" onChange={(v)=>patchPackage(index,{originalPrice:v})} />
          </div>
          <button type="button" disabled={form.packages.length<=1} className={`${smallButton} mt-3`} onClick={()=>mutateForm((f)=>({...f,packages:f.packages.filter((_,i)=>i!==index)}))}>移除此套組</button>
        </RowSection>)}
        <button type="button" className={smallButton} onClick={addPackage}>＋新增銷售套組</button>
      </div>}
      {step===2 && <div className="grid gap-4 sm:grid-cols-2">
        <LineField label="顧客類型" value={form.customerTypes} onChange={(v)=>patch("customerTypes",v)} />
        <LineField label="適用對象" value={form.suitableFor} onChange={(v)=>patch("suitableFor",v)} />
        <LineField label="不適用對象" value={form.notSuitableFor} onChange={(v)=>patch("notSuitableFor",v)} />
        <LineField label="正式優惠規則" value={form.discountRules} onChange={(v)=>patch("discountRules",v)} />
        <div className="sm:col-span-2"><LineField label="限制／不可併用條件" value={form.restrictions} onChange={(v)=>patch("restrictions",v)} /></div>
      </div>}
      {step===3 && <div className="space-y-4">{form.packages.map((p,pIndex)=><RowSection key={`${pIndex}-${p.packageId}`} title={`${p.name || p.packageId} · 正式售價 ${money(p.salePrice)}；歸屬合計 ${money(p.items.reduce((sum,i)=>sum+Number(i.attributedAmount||0),0))}`}>
        <div className="space-y-3">{p.items.map((i,itemIndex)=><div key={`${pIndex}-${itemIndex}`} className="grid gap-2 rounded-xl border border-stone-200 bg-white p-3 sm:grid-cols-5">
          <TextField label="內容代碼" value={i.itemId} onChange={(v)=>patchItem(pIndex,itemIndex,{itemId:v})}/>
          <label className="text-xs font-semibold">類別<select className={`${tones} mt-2 w-full`} value={i.type} onChange={(e)=>patchItem(pIndex,itemIndex,{type:e.target.value})}><option value="course">課程</option><option value="product">商品</option><option value="other">其他</option></select></label>
          <TextField label="內容名稱" value={i.name} onChange={(v)=>patchItem(pIndex,itemIndex,{name:v})}/>
          <TextField label="數量" type="number" min="1" value={i.quantity} onChange={(v)=>patchItem(pIndex,itemIndex,{quantity:v})}/>
          <TextField label="內部歸屬金額（元）" type="number" min="0" value={i.attributedAmount} onChange={(v)=>patchItem(pIndex,itemIndex,{attributedAmount:v})}/>
          <button className={smallButton} disabled={p.items.length<=1} type="button" onClick={()=>patchPackage(pIndex,{items:p.items.filter((_,j)=>j!==itemIndex)})}>刪除項目</button>
        </div>)}<button type="button" className={smallButton} onClick={()=>patchPackage(pIndex,{items:[...p.items,{itemId:`item_${p.items.length+1}`,type:"course",name:"",quantity:1,attributedAmount:""}]})}>＋新增課程／商品歸屬</button></div>
      </RowSection>)}</div>}
      {step===4 && <div className="space-y-4"><LineField label="30 秒銷售重點" value={form.sellingPoints} onChange={(v)=>patch("sellingPoints",v)} /><label className="block text-xs font-bold">銷售話術<textarea rows={8} className={`${tones} mt-2 w-full`} value={form.salesTalk} onChange={(e)=>patch("salesTalk",e.target.value)}/></label></div>}
      {step===5 && <div className="space-y-4">{form.faq.map((f,index)=><div key={index} className="grid gap-2 rounded-xl border border-stone-100 bg-stone-50 p-3 sm:grid-cols-2"><TextField label={`問題 ${index+1}`} value={f.question} onChange={(v)=>mutateForm((old)=>({...old,faq:old.faq.map((q,i)=>i===index?{...q,question:v}:q)}))}/><TextField label="標準回答" value={f.answer} onChange={(v)=>mutateForm((old)=>({...old,faq:old.faq.map((q,i)=>i===index?{...q,answer:v}:q)}))}/><button type="button" className={smallButton} onClick={()=>mutateForm((old)=>({...old,faq:old.faq.filter((_,i)=>i!==index)}))}>移除 FAQ</button></div>)}<button type="button" className={smallButton} onClick={()=>mutateForm((old)=>({...old,faq:[...old.faq,{faqId:`faq_${old.faq.length+1}`,question:"",answer:""}]}))}>＋新增 FAQ</button></div>}
      {step===6 && <div className="space-y-4">
        <RowSection title="可配置審核（建立者不可自核為預設）"><div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold">審核方式<select className={`${tones} mt-2 block w-full`} value={form.approvalPlan.mode} onChange={(e)=>patchPlan("mode",e.target.value)}><option value="none" disabled={!capabilities?.canDirectPublish}>免審核直接放行（需授權）</option><option value="any">指定人員任一核准</option><option value="all">指定人員全部核准</option><option value="sequential">依序核准</option><option value="custom">自訂核准流程</option></select></label>
          <label className="text-xs font-bold">發布時機<select className={`${tones} mt-2 block w-full`} value={form.approvalPlan.releaseMode} onChange={(e)=>patchPlan("releaseMode",e.target.value)}><option value="immediate_after_approval">核准後立即發布</option><option value="manual_after_approval">核准後手動發布</option><option value="scheduled_after_approval">指定時間後可發布（目前仍須手動觸發）</option></select></label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={form.approvalPlan.allowCreatorApproval===true} onChange={(e)=>patchPlan("allowCreatorApproval",e.target.checked)} />允許建立者自行核准</label>
        {form.approvalPlan.releaseMode==="scheduled_after_approval" && <div className="mt-3"><TextField label="自動發布時間（台北時間 UTC+8）" type="datetime-local" value={form.approvalPlan.scheduledPublishAt} onChange={(v)=>patchPlan("scheduledPublishAt",v)}/></div>}
        {["any","all"].includes(form.approvalPlan.mode) && <div className="mt-3"><LineField label="核准對象（每行一位或群組）" value={form.approvalPlan.selectorText} onChange={(v)=>patchPlan("selectorText",v)} help="範例：director:director_01 或 @campaign_team；正式權限由 Backend 審核。" /></div>}
        {["sequential","custom"].includes(form.approvalPlan.mode) && <div className="mt-3 space-y-3">{form.approvalPlan.steps.map((s,index)=><div className="rounded-xl border border-stone-200 bg-white p-3" key={`${index}-${s.stepId}`}><div className="grid gap-2 sm:grid-cols-3"><TextField label="步驟代碼" value={s.stepId} onChange={(v)=>patchPlan("steps",form.approvalPlan.steps.map((o,i)=>i===index?{...o,stepId:v}:o))}/><TextField label="步驟名稱" value={s.label} onChange={(v)=>patchPlan("steps",form.approvalPlan.steps.map((o,i)=>i===index?{...o,label:v}:o))}/><label className="text-xs font-bold">核准門檻<select className={`${tones} mt-2 w-full`} value={s.quorum} onChange={(e)=>patchPlan("steps",form.approvalPlan.steps.map((o,i)=>i===index?{...o,quorum:e.target.value}:o))}><option value="any">任一人</option><option value="all">全部人員</option></select></label></div><div className="mt-3"><LineField label="核准對象" value={s.selectorText} onChange={(v)=>patchPlan("steps",form.approvalPlan.steps.map((o,i)=>i===index?{...o,selectorText:v}:o))} help="每行一個 role:account 或 @group"/></div><button className={smallButton} type="button" onClick={()=>patchPlan("steps",form.approvalPlan.steps.filter((_,i)=>i!==index))}>移除此關</button></div>)}<button className={smallButton} type="button" onClick={addStep}>＋新增審核步驟</button></div>}
        </RowSection>
      </div>}
      {step===7 && <div className="space-y-4 text-xs leading-6 text-stone-600"><div className="rounded-xl bg-stone-50 p-4"><div className="font-black text-stone-800">{form.title || "活動尚未命名"}</div><div>{form.startDate || "—"} ～ {form.endDate || "—"}</div><div>發布方式：{form.approvalPlan.releaseMode} · 審核方式：{form.approvalPlan.mode}</div><p className="mt-2">{form.shortSummary}</p></div>{form.packages.map((p)=><p className="rounded-xl border border-stone-200 p-3" key={p.packageId}>{p.name || p.packageId}：{money(p.salePrice)}，歸屬 {money(p.items.reduce((sum,i)=>sum+Number(i.attributedAmount||0),0))}</p>)}<p><strong>本階段不寫入日報與正式營收。</strong>送審將由後端生成不可覆寫的版本快照；請先儲存草稿。</p></div>}
      {!!warnings.length && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{warnings.join("；")}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
        <button type="button" className={smallButton} disabled={step<=0} onClick={()=>setStep((i)=>Math.max(0,i-1))}>上一步</button>
        <button type="button" className={smallButton} disabled={step>=7} onClick={()=>setStep((i)=>Math.min(7,i+1))}>下一步</button>
        <div className="flex-1"/>
        <button type="button" className={primaryButton} disabled={busy || !canSave} onClick={saveDraft}>{record?"儲存草稿（OCC）":"建立草稿"}</button>
        {!!record && capabilities?.canSubmit && <button type="button" className={smallButton} disabled={busy || hasUnsavedChanges} onClick={()=>action("submit_for_approval","送審")}>提交審核／建立正式版本</button>}
        {!!record && capabilities?.canSubmitAmendment && <button type="button" className={smallButton} disabled={busy || hasUnsavedChanges} onClick={()=>action("submit_amendment","修訂送審")}>重大異動重新送審</button>}
      </div>
    </div>

    {!!record && record.status==="published" && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-stone-700">
      <strong>目前第一線正式版本：{record.currentVersionId}</strong>。
      {record.amendment ? <span> 正在處理私人修訂（{statusLabels[record.amendment.status] || record.amendment.status}；{record.amendment.versionId || "尚未送審"}）。審核期間舊版展示與理解確認不受草稿影響；正式版本切換後，第一線必須確認新版。</span>
        : <span> 修改任何已發布活動內容，都需要建立獨立修訂、重新送審；不可直接覆蓋目前展示。</span>}
      {record.amendment && <span className="block text-rose-700">已發布活動的修訂必須設定審核人員，不能使用「免審核」直接換版。</span>}
    </div>}
    {!!record && <RowSection title="管理動作（以最新 Revision 與後端權限為準）">
      {record.review && <p className="mb-3 text-xs text-stone-600">目前：{record.review.stepLabel}（第 {record.review.stepIndex+1}/{record.review.stepCount} 關）· 已核准 {record.review.approvedCount}/{record.review.requiredCount}</p>}
      {(capabilities?.canApprove || capabilities?.canReturn) && <TextField label="核准／退回原因（可選）" value={reviewComment} onChange={setReviewComment} />}
      <div className="mt-3 flex flex-wrap gap-2">
        {capabilities?.canBeginAmendment && <button className={smallButton} disabled={busy || hasUnsavedChanges} type="button" onClick={()=>action("begin_amendment","建立重大異動修訂")}>建立重大異動修訂草稿</button>}
        {capabilities?.canDiscardAmendment && <button className={smallButton} disabled={busy || hasUnsavedChanges} type="button" onClick={()=>action("discard_amendment","撤銷修訂")}>撤銷未發布修訂</button>}
        {capabilities?.canPublishAmendment && <button className={smallButton} disabled={busy || hasUnsavedChanges} type="button" onClick={()=>action("publish_amendment","發布修訂")}>切換至核准新版本</button>}
        {capabilities?.canApprove && <button className={smallButton} disabled={busy || hasUnsavedChanges} type="button" onClick={()=>action("approve","核准",reviewComment)}>核准目前關卡</button>}
        {capabilities?.canReturn && <button className={smallButton} disabled={busy || hasUnsavedChanges} type="button" onClick={()=>action("return_for_changes","退回修改",reviewComment)}>退回修改</button>}
        {capabilities?.canPublish && <button className={smallButton} disabled={busy || hasUnsavedChanges} type="button" onClick={()=>action("publish","發布")}>發布核准版本</button>}
        {capabilities?.canStop && <button className={smallButton} disabled={busy || hasUnsavedChanges} type="button" onClick={()=>action("stop","停止活動")}>停止活動</button>}
        {capabilities?.canCancel && <button className={smallButton} disabled={busy || hasUnsavedChanges} type="button" onClick={()=>action("cancel","取消活動")}>取消活動</button>}
      </div>
      <p className="mt-3 text-[11px] text-stone-400">每次操作均重新驗證品牌、帳號與 Trusted Device；兩位管理者同時處理時，舊 Revision 會被後端拒絕。</p>
    </RowSection>}
  </div>;
}
