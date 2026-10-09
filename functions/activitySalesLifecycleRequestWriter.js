"use strict";
// Phase 2A-5B1 isolated, UNREGISTERED handler. Records immutable PENDING requests only.
// Not connected to functions/index.js, frontend, daily reports, Summary, ranking or KPI.
const {assertActivitySalesSessionActor}=require("./activitySalesSessionBoundary");
const {normalizeAttributionSale,attributionDocumentId,assertPublishedVersionForSale}=require("./activitySalesAttributionContract");
const {normalizeEvent,lifecycleDocumentId,KINDS}=require("./activitySalesLifecycleContract");
const {ownerStore,coreStore,reportKey,assertReport,summaryDocumentId,invalid}=require("./activitySalesAttributionWriterLogic");
const {activitySalesServerTimestamp}=require("./activitySalesFirestoreFieldValue");

function taipeiDate(now){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
function assertKeys(obj,keys,code){
  if(!obj || typeof obj!=="object" || Array.isArray(obj) || Object.keys(obj).some(k=>!keys.includes(k)))invalid(code,400);
}
function checkedRequest(body,now){
  assertKeys(body,["action","storeName","actor","event"],"LIFECYCLE_REQUEST_FIELDS_INVALID");
  if(body.action!=="request_lifecycle")invalid("LIFECYCLE_REQUEST_ACTION_INVALID",400);
  const e=body.event;
  assertKeys(e,["brandId","campaignId","versionId","roleId","accountId","reportDate","saleId","eventId",
    "eventDate","kind","reasonCode","reasonNote","refundAmount","replacement","expectedEventRevision","formalRevenueDelta"],"LIFECYCLE_EVENT_FIELDS_INVALID");
  if(e.replacement!==undefined)assertKeys(e.replacement,["packageId","quantity","attributedAmount"],"LIFECYCLE_REPLACEMENT_FIELDS_INVALID");
  let event;
  try{event=normalizeEvent(e);}catch(error){invalid(String(error?.code||error?.message||"LIFECYCLE_EVENT_INVALID"),400);}
  if(/[\\/]/.test(event.accountId))invalid("LIFECYCLE_ACCOUNT_PATH_INVALID",400);
  const storeName=String(body.storeName||"").trim();
  if(!storeName || storeName.length>120 || storeName.includes("/"))invalid("LIFECYCLE_STORE_INVALID",400);
  if(event.eventDate>taipeiDate(now))invalid("LIFECYCLE_FUTURE_EVENT",400);
  return {event,storeName};
}
function assertImmutableVersion(version,event,sale,storeCore){
  try{assertPublishedVersionForSale(sale,version);}catch{invalid("LIFECYCLE_VERSION_MISMATCH",409);}
  const snap=version?.campaignSnapshot;
  if(!snap || typeof snap.startDate!=="string" || typeof snap.endDate!=="string" ||
     event.reportDate<snap.startDate || event.reportDate>snap.endDate)invalid("LIFECYCLE_VERSION_WINDOW_INVALID",409);
  if(snap.storeScope==="selected"){
    if(!Array.isArray(snap.stores) || !snap.stores.some(s=>coreStore(s)===storeCore))invalid("LIFECYCLE_STORE_SCOPE_FORBIDDEN",403);
  } else if(snap.storeScope!=="all")invalid("LIFECYCLE_STORE_SCOPE_INVALID",409);
  const originalPackage=snap.packages?.find(p=>p?.packageId===sale.packageId);
  if(!originalPackage || !Number.isSafeInteger(originalPackage.salePrice) || originalPackage.salePrice<=0 ||
      originalPackage.salePrice*sale.quantity!==sale.attributedAmount)invalid("LIFECYCLE_SALE_PRICE_INCONSISTENT",409);
  if(event.kind===KINDS.CORRECTION){
    const replacement=snap.packages?.find(p=>p?.packageId===event.replacement.packageId);
    if(!replacement || !Number.isSafeInteger(replacement.salePrice) || replacement.salePrice<=0)
      invalid("LIFECYCLE_REPLACEMENT_PACKAGE_INVALID",409);
    // An unusual requested amount is NOT approved here; it remains PENDING.
  }
  if(event.kind===KINDS.REFUND && event.refundAmount>sale.attributedAmount)
    invalid("LIFECYCLE_REFUND_EXCEEDS_ORIGINAL",409);
}
function sameSale(a,b){
  return ["brandId","campaignId","versionId","roleId","accountId","reportDate","saleId"].every(k=>a?.[k]===b?.[k]);
}
function createLifecycleRequestHandler({admin,db,services={}}){
  const deps=services.requireFirebaseRequestAuth&&services.verifyTrustedApplicationActor&&services.getBrandCollection
    ?services:{...require("./deviceApproval"),...services};
  const {requireFirebaseRequestAuth,verifyTrustedApplicationActor,getBrandCollection}=deps;
  const getBrandSettingDoc=deps.getBrandSettingDoc||require("./deviceApproval").getBrandSettingDoc;
  return async(req,res)=>{
    if(req.method!=="POST")return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
    try{
      const {event,storeName}=checkedRequest(req.body,services.now?.()||new Date());
      const actorInput=req.body.actor||{};
      const auth=await requireFirebaseRequestAuth(req,admin);
      if(!auth?.ok)return res.status(401).json({ok:false,code:"AUTH_EXPIRED"});
      assertActivitySalesSessionActor(auth,event.brandId,actorInput);
      const actor=await verifyTrustedApplicationActor({db,brandId:event.brandId,actor:actorInput,allowedRoles:["therapist","store"]});
      if(!actor?.ok || actor.actorRole!==event.roleId || actor.actorAccountId!==event.accountId)
        invalid("LIFECYCLE_ACTOR_FORBIDDEN",403);
      const col=name=>getBrandCollection(db,event.brandId,name);
      const masterRef=event.roleId==="therapist"?col("therapists").doc(event.accountId):null;
      const managerRef=event.roleId==="store"?getBrandSettingDoc(db,event.brandId,"store_account_data"):null;
      const reportRef=col(event.roleId==="therapist"?"therapist_daily_reports":"daily_reports").doc(reportKey(event,storeName));
      const saleRef=col("activity_sales_attribution_sales").doc(attributionDocumentId(event,event.saleId));
      const dailyRef=col("activity_sales_daily_attributions").doc(summaryDocumentId(event));
      const versionRef=col("activity_campaign_versions").doc(event.versionId);
      // A request is NOT a settled lifecycle event. No projected net totals are updated.
      const stateRef=col("activity_sales_lifecycle_request_state").doc(attributionDocumentId(event,event.saleId));
      const eventRef=col("activity_sales_lifecycle_requests").doc(lifecycleDocumentId(event));
      const result=await db.runTransaction(async tx=>{
        // Exact-document bounded transaction. ALL reads precede writes; no listener/query.
        const master=masterRef?await tx.get(masterRef):null;
        const manager=managerRef?await tx.get(managerRef):null;
        const report=await tx.get(reportRef);
        const saleSnap=await tx.get(saleRef);
        const dailySnap=await tx.get(dailyRef);
        const versionSnap=await tx.get(versionRef);
        const stateSnap=await tx.get(stateRef);
        const eventSnap=await tx.get(eventRef);
        let storeCore;
        if(event.roleId==="therapist"){
          if(!master?.exists)invalid("LIFECYCLE_THERAPIST_MISSING",403);
          storeCore=ownerStore({roleId:event.roleId,accountId:event.accountId,
            therapistMaster:master.data(),targetStore:storeName});
        }else{
          const rows=manager?.exists?manager.data()?.accounts:null;
          const account=Array.isArray(rows)?rows.find(a=>String(a?.id||a?.name||"")===actor.actorAccountId):null;
          if(!account || account.isActive===false || account.disabled===true)invalid("LIFECYCLE_STORE_ACTOR_REVOKED",403);
          const stores=Array.isArray(account.stores)?account.stores:[account.storeName||account.store].filter(Boolean);
          storeCore=ownerStore({roleId:"store",accountId:event.accountId,credential:{stores},targetStore:storeName});
        }
        if(!report?.exists)invalid("LIFECYCLE_REPORT_MISSING",409);
        assertReport(report.data(),event,storeCore);
        if(!saleSnap?.exists || !dailySnap?.exists || !versionSnap?.exists)invalid("LIFECYCLE_ANCHOR_MISSING",409);
        const rawSale=saleSnap.data();
        if(!sameSale(rawSale,event) || rawSale.storeCore!==storeCore || rawSale.formalRevenueDelta!==0)
          invalid("LIFECYCLE_SALE_IDENTITY_MISMATCH",409);
        let sale;
        try{sale=normalizeAttributionSale(rawSale);}catch{invalid("LIFECYCLE_SALE_INVALID",409);}
        const daily=dailySnap.data();
        if(!["HAS_SALES"].includes(daily.status) || !["brandId","campaignId","versionId","roleId","accountId","reportDate"].every(k=>daily[k]===event[k]) ||
          daily.storeCore!==storeCore || daily.formalRevenueDelta!==0 || !Number.isSafeInteger(daily.revision))
          invalid("LIFECYCLE_DAILY_MISMATCH",409);
        assertImmutableVersion(versionSnap.data(),event,sale,storeCore);
        const canonical=JSON.stringify(event);
        const priorEvent=eventSnap.exists?eventSnap.data():null;
        if(priorEvent){
          const priorState=stateSnap.exists?stateSnap.data():null;
          if(!priorState || priorState.state!=="PENDING_REVIEW" || priorState.pendingRequestId!==eventRef.id ||
             !sameSale(priorState,event) || priorState.storeCore!==storeCore)
            invalid("LIFECYCLE_REQUEST_REPLAY_STATE_MISMATCH",409);
          if(priorEvent.eventCanonical!==canonical || priorEvent.requestedByRole!==actor.actorRole ||
             priorEvent.requestedByAccountId!==actor.actorAccountId || priorEvent.storeCore!==storeCore ||
             priorEvent.state!=="PENDING_REVIEW")invalid("LIFECYCLE_REQUEST_REPLAY_CONFLICT",409);
          return {state:"idempotent",requestId:eventRef.id,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
        }
        const existing=stateSnap.exists?stateSnap.data():null;
        if(existing && (!sameSale(existing,event) || existing.storeCore!==storeCore))invalid("LIFECYCLE_REQUEST_STATE_MISMATCH",409);
        // Phase B1 cannot decide policy, therefore only one pending request per sale.
        // No approved/rejected status transition is supplied by B1.
        if(existing)invalid("LIFECYCLE_REQUEST_ALREADY_PENDING_OR_LOCKED",409);
        if(event.expectedEventRevision!==0)invalid("LIFECYCLE_REQUEST_REVISION_CONFLICT",409);
        const createdAt=activitySalesServerTimestamp(admin);
        const createdAtText=(services.now?.()||new Date()).toISOString();
        const common={brandId:event.brandId,campaignId:event.campaignId,versionId:event.versionId,
          roleId:event.roleId,accountId:event.accountId,reportDate:event.reportDate,saleId:event.saleId,
          storeCore,formalRevenueDelta:0};
        tx.create(eventRef,{schemaVersion:"activity-sales-lifecycle-request-v1",...common,
          event, eventCanonical:canonical,state:"PENDING_REVIEW",officialKpiAllocation:"UNDECIDED",
          requestedByRole:actor.actorRole,requestedByAccountId:actor.actorAccountId,createdAt,createdAtText});
        tx.create(stateRef,{schemaVersion:"activity-sales-lifecycle-request-state-v1",...common,
          state:"PENDING_REVIEW",pendingRequestId:eventRef.id,requestRevision:1,createdAt,createdAtText});
        return {state:"requested",requestId:eventRef.id,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
      });
      return res.status(200).json({ok:true,...result});
    }catch(error){
      const code=String(error?.code||error?.message||"LIFECYCLE_REQUEST_FAILED");
      const status=Number(error?.status||(code.startsWith("ACTIVITY_")||code.startsWith("LIFECYCLE_")?400:500));
      if(status>=500)console.error("lifecycle request (isolated, unregistered) failed",error);
      return res.status(status).json({ok:false,code:status>=500?"LIFECYCLE_REQUEST_FAILED":code});
    }
  };
}
module.exports={checkedRequest,createLifecycleRequestHandler};
