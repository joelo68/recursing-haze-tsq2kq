"use strict";
// Phase 2A-5B2 ISOLATED, UNREGISTERED handler. Review decisions only.
// Never settles a refund, alters a sale, attribution, report, summary or KPI.
const {assertActivitySalesSessionActor}=require("./activitySalesSessionBoundary");
const {attributionDocumentId}=require("./activitySalesAttributionContract");
const {lifecycleDocumentId}=require("./activitySalesLifecycleContract");
const {summaryDocumentId,invalid}=require("./activitySalesAttributionWriterLogic");
const {activitySalesServerTimestamp}=require("./activitySalesFirestoreFieldValue");
const {parsePlan,applyDecision,reviewerDocumentId,stableActor}=require("./activitySalesLifecycleReviewPolicy");
const ROLES=["director","manager","trainer","store","therapist"];
const BRANDS=new Set(["cyj","anniu","yibo"]);
const AUTH_DOC={director:"director_auth",manager:"manager_auth",trainer:"trainer_auth",store:"store_account_data"};
function verifyActorActive(role,accountId,data,storeCore){
  if(!data || typeof data!=="object")invalid("LIFECYCLE_REVIEW_ACCOUNT_REVOKED",403);
  let row;
  if(role==="store"){
    row=Array.isArray(data.accounts)?data.accounts.find(a=>String(a?.id||a?.name||"")===accountId):null;
    if(!row || row.isActive===false || row.disabled===true || row.resigned===true)invalid("LIFECYCLE_REVIEW_ACCOUNT_REVOKED",403);
    const stores=Array.isArray(row.stores)?row.stores:[row.storeName||row.store].filter(Boolean);
    // A store reviewer has no implied cross-store authority even if the policy names them.
    const {coreStore}=require("./activitySalesAttributionWriterLogic");
    if(!stores.some(s=>coreStore(s)===storeCore))invalid("LIFECYCLE_REVIEW_STORE_FORBIDDEN",403);
    return;
  }
  if(role==="director" || role==="trainer"){
    const accounts=data.accounts && typeof data.accounts==="object"?data.accounts:{};
    row=accounts[accountId] || Object.values(accounts).find(x=>String(x?.id||x?.name||"")===accountId);
    if(!row){
      // Director/trainer credential authority permits legacy top-level accounts.
      row=role==="director"?data[accountId]:null;
    }
    if(!row || (typeof row==="object" && (row.isActive===false || row.disabled===true)))
      invalid("LIFECYCLE_REVIEW_ACCOUNT_REVOKED",403);
    return;
  }
  if(role==="manager"){
    row=data[accountId];
    if(!row || (typeof row==="object" && (row.isActive===false || row.disabled===true)))
      invalid("LIFECYCLE_REVIEW_ACCOUNT_REVOKED",403);
    return;
  }
  if(role==="therapist"){
    if(data.id!==accountId && data.therapistId!==accountId)invalid("LIFECYCLE_REVIEW_ACCOUNT_REVOKED",403);
    if(data.isActive===false || data.resigned===true || data.isResigned===true ||
       ["resigned","離職","封存"].includes(String(data.status||"").trim().toLowerCase()))
      invalid("LIFECYCLE_REVIEW_ACCOUNT_REVOKED",403);
    return;
  }
  invalid("LIFECYCLE_REVIEW_ACTOR_ROLE_UNSUPPORTED",403);
}
function checkedReviewBody(raw){
  if(!raw || typeof raw!=="object" || Array.isArray(raw) ||
     Object.keys(raw).some(x=>!["action","brandId","requestId","decision","reasonNote","expectedReviewRevision","actor"].includes(x)))
    invalid("LIFECYCLE_REVIEW_INPUT_INVALID",400);
  if(raw.action!=="review_lifecycle" || !BRANDS.has(raw.brandId) ||
     typeof raw.requestId!=="string" || !/^life_[a-f0-9]{48}$/.test(raw.requestId) ||
     !["APPROVE","REJECT"].includes(raw.decision) ||
     !Number.isSafeInteger(raw.expectedReviewRevision) || raw.expectedReviewRevision<0)
    invalid("LIFECYCLE_REVIEW_INPUT_INVALID",400);
  return raw;
}
function createLifecycleReviewHandler({admin,db,services={}}){
  const deps=services.requireFirebaseRequestAuth&&services.verifyTrustedApplicationActor&&services.getBrandCollection&&services.getBrandSettingDoc
    ?services:{...require("./deviceApproval"),...services};
  const {requireFirebaseRequestAuth,verifyTrustedApplicationActor,getBrandCollection,getBrandSettingDoc}=deps;
  return async (req,res)=>{
    if(req.method!=="POST")return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
    try{
      const body=checkedReviewBody(req.body);
      const actorInput=body.actor||{};
      const auth=await requireFirebaseRequestAuth(req,admin);
      if(!auth?.ok)return res.status(401).json({ok:false,code:"AUTH_EXPIRED"});
      assertActivitySalesSessionActor(auth,body.brandId,actorInput);
      const actor=await verifyTrustedApplicationActor({db,brandId:body.brandId,actor:actorInput,allowedRoles:ROLES});
      if(!actor?.ok || actor.actorRole!==actorInput.roleId || actor.actorAccountId!==actorInput.accountId)
        invalid("LIFECYCLE_REVIEW_ACTOR_UNTRUSTED",403);
      stableActor({roleId:actor.actorRole,accountId:actor.actorAccountId});
      const col=name=>getBrandCollection(db,body.brandId,name);
      const policyRef=col("activity_sales_lifecycle_review_policy").doc("current");
      const requestRef=col("activity_sales_lifecycle_requests").doc(body.requestId);
      const reviewRef=col("activity_sales_lifecycle_review_state").doc(body.requestId);
      const decisionRef=col("activity_sales_lifecycle_review_decisions").doc(reviewerDocumentId(body.requestId,{roleId:actor.actorRole,accountId:actor.actorAccountId}));
      const actorRef=actor.actorRole==="therapist"?col("therapists").doc(actor.actorAccountId):
        getBrandSettingDoc(db,body.brandId,AUTH_DOC[actor.actorRole]);
      const result=await db.runTransaction(async tx=>{
        // All reads first. Exact documents only; no listener or unbounded query.
        const policySnap=await tx.get(policyRef);
        const requestSnap=await tx.get(requestRef);
        const reviewSnap=await tx.get(reviewRef);
        const decisionSnap=await tx.get(decisionRef);
        const actorSnap=await tx.get(actorRef);
        if(!requestSnap.exists)invalid("LIFECYCLE_REVIEW_REQUEST_MISSING",409);
        const request=requestSnap.data(),event=request.event;
        if(request.brandId!==body.brandId || request.state!=="PENDING_REVIEW" ||
           request.formalRevenueDelta!==0 || request.officialKpiAllocation!=="UNDECIDED" ||
           !event || event.brandId!==body.brandId || lifecycleDocumentId(event)!==body.requestId ||
           request.eventCanonical!==JSON.stringify(event))invalid("LIFECYCLE_REVIEW_REQUEST_CORRUPT",409);
        // B1 lock is still pending; B2 decisions may not unlock it or settle it.
        const lockRef=col("activity_sales_lifecycle_request_state").doc(attributionDocumentId(event,event.saleId));
        const saleRef=col("activity_sales_attribution_sales").doc(attributionDocumentId(event,event.saleId));
        const dailyRef=col("activity_sales_daily_attributions").doc(summaryDocumentId(event));
        const versionRef=col("activity_campaign_versions").doc(event.versionId);
        const lockSnap=await tx.get(lockRef),saleSnap=await tx.get(saleRef),dailySnap=await tx.get(dailyRef),versionSnap=await tx.get(versionRef);
        if(!lockSnap.exists || lockSnap.data().state!=="PENDING_REVIEW" || lockSnap.data().pendingRequestId!==body.requestId ||
           lockSnap.data().brandId!==body.brandId ||
           !saleSnap.exists || !dailySnap.exists || !versionSnap.exists ||
           saleSnap.data().brandId!==body.brandId || saleSnap.data().saleId!==event.saleId ||
           saleSnap.data().versionId!==event.versionId || saleSnap.data().storeCore!==request.storeCore ||
           dailySnap.data().brandId!==body.brandId || dailySnap.data().status!=="HAS_SALES" ||
           dailySnap.data().versionId!==event.versionId || dailySnap.data().formalRevenueDelta!==0 ||
           versionSnap.data().brandId!==body.brandId || versionSnap.data().versionId!==event.versionId)
          invalid("LIFECYCLE_REVIEW_ANCHOR_STALE",409);
        verifyActorActive(actor.actorRole,actor.actorAccountId,actorSnap.exists?actorSnap.data():null,request.storeCore);
        if(!policySnap.exists)invalid("LIFECYCLE_REVIEW_POLICY_MISSING",403);
        const plan=parsePlan(policySnap.data(),event.kind,body.brandId);
        // Idempotency is strict and only after current identity/policy/anchor validation.
        const existing=reviewSnap.exists?reviewSnap.data():null;
        if(decisionSnap.exists){
          const old=decisionSnap.data();
          if(old.brandId===body.brandId && old.requestId===body.requestId &&
             old.roleId===actor.actorRole && old.accountId===actor.actorAccountId &&
             old.decision===body.decision && old.reasonNote===(body.reasonNote||"") &&
             old.expectedReviewRevision===body.expectedReviewRevision &&
             existing?.planHash===plan.planHash && existing?.decisions?.[require("node:crypto").createHash("sha256").update(`${actor.actorRole}\u0000${actor.actorAccountId}`).digest("hex").slice(0,48)])
            return {state:"idempotent",reviewRevision:existing.reviewRevision,status:existing.status,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
          invalid("LIFECYCLE_REVIEW_DECISION_REPLAY_CONFLICT",409);
        }
        const next=applyDecision({requestId:body.requestId,request,plan,prior:existing,
          actor:{roleId:actor.actorRole,accountId:actor.actorAccountId},decision:body.decision,
          reasonNote:body.reasonNote||"",expectedReviewRevision:body.expectedReviewRevision});
        const nowText=(services.now?.()||new Date()).toISOString();
        const timestamp=activitySalesServerTimestamp(admin);
        tx.create(decisionRef,{schemaVersion:"activity-sales-lifecycle-review-decision-v1",brandId:body.brandId,
          requestId:body.requestId,kind:event.kind,roleId:actor.actorRole,accountId:actor.actorAccountId,
          decision:body.decision,reasonNote:body.reasonNote||"",expectedReviewRevision:body.expectedReviewRevision,
          reviewRevision:next.reviewRevision,policyRevision:plan.policyRevision,planHash:plan.planHash,
          formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED",createdAt:timestamp,createdAtText:nowText});
        const stored={...next,updatedAt:timestamp,updatedAtText:nowText};
        if(reviewSnap.exists)tx.set(reviewRef,stored,{merge:false});else tx.create(reviewRef,stored);
        return {state:"written",reviewRevision:next.reviewRevision,status:next.status,
          formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
      });
      return res.status(200).json({ok:true,...result});
    }catch(error){
      const code=String(error?.code||error?.message||"LIFECYCLE_REVIEW_FAILED");
      const status=Number(error?.status||(code.startsWith("ACTIVITY_")?403:code.startsWith("LIFECYCLE_")?409:500));
      if(status>=500)console.error("isolated lifecycle review failed",error);
      return res.status(status).json({ok:false,code:status>=500?"LIFECYCLE_REVIEW_FAILED":code});
    }
  };
}
module.exports={checkedReviewBody,verifyActorActive,createLifecycleReviewHandler};
