"use strict";
// B3B1: UNREGISTERED review-only handler. Never creates a sale or settles a special price.
const crypto=require("node:crypto");
const {assertActivitySalesSessionActor}=require("./activitySalesSessionBoundary");
const {attributionDocumentId}=require("./activitySalesAttributionContract");
const {ownerStore,reportKey,assertReport,assertSaleWindow,summaryDocumentId,invalid}=require("./activitySalesAttributionWriterLogic");
const {activitySalesServerTimestamp}=require("./activitySalesFirestoreFieldValue");
const {parsePlan,applyDecision,reviewerDocumentId,stableActor}=require("./activitySalesLifecycleReviewPolicy");
const {verifyActorActive}=require("./activitySalesLifecycleReviewWriter");
const {specialPriceRequestId,buildSpecialPriceRequest}=require("./activitySalesSpecialPriceRequestContract");
const ROLES=["director","manager","trainer","store","therapist"];
const AUTH_DOC={director:"director_auth",manager:"manager_auth",trainer:"trainer_auth",store:"store_account_data"};
const BRANDS=new Set(["cyj","anniu","yibo"]);
function checkedBody(body){
  if(!body || typeof body!=="object" || Array.isArray(body) ||
    Object.keys(body).some(k=>!["action","brandId","requestId","decision","reasonNote","expectedReviewRevision","actor"].includes(k)) ||
    body.action!=="review_special_price" || !BRANDS.has(body.brandId) ||
    typeof body.requestId!=="string" || !/^price_[a-f0-9]{48}$/.test(body.requestId) ||
    !["APPROVE","REJECT"].includes(body.decision) || !Number.isSafeInteger(body.expectedReviewRevision) || body.expectedReviewRevision<0 ||
    (body.reasonNote!==undefined && typeof body.reasonNote!=="string") ||
    !body.actor || typeof body.actor!=="object" || Array.isArray(body.actor) ||
    Object.keys(body.actor).some(k=>!["roleId","accountId","deviceId","credentialPassword"].includes(k)))
    invalid("SPECIAL_PRICE_REVIEW_INPUT_INVALID",400);
  return body;
}
function verifyRequest(request,lock,body,plan){
  const proposal=request?.proposal;
  if(request?.schemaVersion!=="activity-sales-special-price-request-record-v1" ||
    request?.brandId!==body.brandId || request?.requestId!==body.requestId || request?.state!=="PENDING_REVIEW" ||
    request?.formalRevenueDelta!==0 || request?.officialKpiAllocation!=="UNDECIDED" ||
    request?.policyRevision!==plan.policyRevision || request?.planHash!==plan.planHash ||
    !proposal || proposal.brandId!==body.brandId || proposal.formalRevenueDelta!==0 ||
    proposal.officialKpiAllocation!=="UNDECIDED" || proposal.approvalState!=="PENDING_REVIEW" ||
    proposal.state!=="PENDING_REVIEW" ||
    specialPriceRequestId(proposal,proposal.saleId)!==body.requestId ||
    request.campaignId!==proposal.campaignId || request.versionId!==proposal.versionId ||
    request.roleId!==proposal.roleId || request.accountId!==proposal.accountId ||
    request.reportDate!==proposal.reportDate || request.saleId!==proposal.saleId ||
    typeof request.storeName!=="string" || !request.storeName || request.storeName.length>120 ||
    typeof request.reportDocId!=="string" || request.reportDocId!==reportKey(proposal,request.storeName) ||
    !lock || lock.schemaVersion!=="activity-sales-special-price-request-state-v1" ||
    lock.brandId!==body.brandId || lock.requestId!==body.requestId || lock.state!=="PENDING_REVIEW" ||
    lock.requestRevision!==1 || lock.storeCore!==request.storeCore ||
    lock.reportDocId!==request.reportDocId || lock.formalRevenueDelta!==0 ||
    lock.officialKpiAllocation!=="UNDECIDED") invalid("SPECIAL_PRICE_REVIEW_REQUEST_STALE",409);
  return proposal;
}
function createSpecialPriceReviewHandler({admin,db,services={}}){
  const deps=services.requireFirebaseRequestAuth&&services.verifyTrustedApplicationActor&&services.getBrandCollection&&services.getBrandSettingDoc
    ?services:{...require("./deviceApproval"),...services};
  const {requireFirebaseRequestAuth,verifyTrustedApplicationActor,getBrandCollection,getBrandSettingDoc}=deps;
  return async(req,res)=>{
    if(req.method!=="POST")return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
    try{
      const body=checkedBody(req.body),input=body.actor;
      const auth=await requireFirebaseRequestAuth(req,admin);
      if(!auth?.ok)return res.status(401).json({ok:false,code:"AUTH_EXPIRED"});
      assertActivitySalesSessionActor(auth,body.brandId,input);
      const actor=await verifyTrustedApplicationActor({db,brandId:body.brandId,actor:input,allowedRoles:ROLES});
      if(!actor?.ok || actor.actorRole!==input.roleId || actor.actorAccountId!==input.accountId)
        invalid("SPECIAL_PRICE_REVIEW_ACTOR_UNTRUSTED",403);
      const who=stableActor({roleId:actor.actorRole,accountId:actor.actorAccountId});
      const col=name=>getBrandCollection(db,body.brandId,name);
      const policyRef=col("activity_sales_lifecycle_review_policy").doc("current");
      const requestRef=col("activity_sales_special_price_requests").doc(body.requestId);
      const reviewRef=col("activity_sales_special_price_review_state").doc(body.requestId);
      const decisionRef=col("activity_sales_special_price_review_decisions").doc(reviewerDocumentId(body.requestId,who));
      const actorRef=who.roleId==="therapist"?col("therapists").doc(who.accountId):getBrandSettingDoc(db,body.brandId,AUTH_DOC[who.roleId]);
      const result=await db.runTransaction(async tx=>{
        const [policySnap,requestSnap,reviewSnap,decisionSnap,actorSnap]=await Promise.all([
          tx.get(policyRef),tx.get(requestRef),tx.get(reviewRef),tx.get(decisionRef),tx.get(actorRef)]);
        if(!policySnap.exists)invalid("SPECIAL_PRICE_REVIEW_POLICY_MISSING",403);
        const plan=parsePlan(policySnap.data(),"SPECIAL_PRICE",body.brandId);
        if(!requestSnap.exists)invalid("SPECIAL_PRICE_REVIEW_REQUEST_MISSING",409);
        const request=requestSnap.data(),candidate=request.proposal||{};
        // Only string-validated identity fields from brand-scoped stored request are used for document refs.
        if(request.brandId!==body.brandId || request.requestId!==body.requestId ||
           specialPriceRequestId(candidate,candidate.saleId)!==body.requestId ||
           !["therapist","store"].includes(candidate.roleId) ||
           typeof request.reportDocId!=="string" || (request.reportDocId.length>180 || !request.reportDocId.length || /[\/\u0000-\u001f]/.test(request.reportDocId)))
          invalid("SPECIAL_PRICE_REVIEW_REQUEST_INVALID",409);
        const saleKey=attributionDocumentId(candidate,candidate.saleId);
        const reportRef=col(candidate.roleId==="therapist"?"therapist_daily_reports":"daily_reports").doc(request.reportDocId);
        const publicationRef=col("activity_sales_publications").doc(candidate.campaignId);
        const versionRef=col("activity_campaign_versions").doc(candidate.versionId);
        const lockRef=col("activity_sales_special_price_request_state").doc(saleKey);
        const saleRef=col("activity_sales_attribution_sales").doc(saleKey);
        const legacyLockRef=col("activity_sales_lifecycle_request_state").doc(saleKey);
        const dailyRef=col("activity_sales_daily_attributions").doc(summaryDocumentId(candidate));
        const sellerRef=candidate.roleId==="therapist"?col("therapists").doc(candidate.accountId):getBrandSettingDoc(db,body.brandId,"store_account_data");
        const [lockSnap,reportSnap,publicationSnap,versionSnap,saleSnap,legacyLockSnap,dailySnap,sellerSnap]=await Promise.all([
          tx.get(lockRef),tx.get(reportRef),tx.get(publicationRef),tx.get(versionRef),tx.get(saleRef),tx.get(legacyLockRef),tx.get(dailyRef),tx.get(sellerRef)]);
        const proposal=verifyRequest(request,lockSnap.exists?lockSnap.data():null,body,plan);
        if(saleSnap.exists || legacyLockSnap.exists || !reportSnap.exists || !publicationSnap.exists || !versionSnap.exists || !sellerSnap.exists)
          invalid("SPECIAL_PRICE_REVIEW_ANCHOR_STALE",409);
        let sellerStore;
        if(proposal.roleId==="therapist")sellerStore=ownerStore({roleId:"therapist",accountId:proposal.accountId,
          therapistMaster:sellerSnap.data(),targetStore:request.storeName});
        else{
          const list=sellerSnap.data()?.accounts;
          const seller=Array.isArray(list)?list.find(a=>String(a?.id||a?.name||"")===proposal.accountId):null;
          if(!seller || seller.isActive===false || seller.disabled===true || seller.resigned===true)
            invalid("SPECIAL_PRICE_REVIEW_SELLER_REVOKED",403);
          const stores=Array.isArray(seller.stores)?seller.stores:[seller.storeName||seller.store].filter(Boolean);
          sellerStore=ownerStore({roleId:"store",accountId:proposal.accountId,credential:{stores},targetStore:request.storeName});
        }
        if(sellerStore!==request.storeCore)invalid("SPECIAL_PRICE_REVIEW_STORE_CHANGED",409);
        assertReport(reportSnap.data(),proposal,sellerStore);
        const pkg=assertSaleWindow(publicationSnap.data(),versionSnap.data(),proposal,sellerStore,proposal.packageId);
        const expected=buildSpecialPriceRequest({identity:proposal,saleId:proposal.saleId,packageId:proposal.packageId,
          quantity:proposal.quantity,actualAmount:proposal.actualAmount,reasonCode:proposal.reasonCode,reasonNote:proposal.reasonNote},pkg.salePrice);
        if(JSON.stringify(expected)!==JSON.stringify(proposal))invalid("SPECIAL_PRICE_REVIEW_PRICE_STALE",409);
        if(dailySnap.exists && (dailySnap.data()?.status==="CONFIRMED_ZERO" || dailySnap.data()?.brandId!==body.brandId ||
          dailySnap.data()?.storeCore!==request.storeCore || dailySnap.data()?.formalRevenueDelta!==0))
          invalid("SPECIAL_PRICE_REVIEW_DAILY_STALE",409);
        verifyActorActive(who.roleId,who.accountId,actorSnap.exists?actorSnap.data():null,request.storeCore);
        const oldReview=reviewSnap.exists?reviewSnap.data():null;
        if(decisionSnap.exists){
          const old=decisionSnap.data(),actorKey=crypto.createHash("sha256").update(`${who.roleId}\0${who.accountId}`).digest("hex").slice(0,48);
          if(old.brandId===body.brandId && old.requestId===body.requestId && old.roleId===who.roleId && old.accountId===who.accountId &&
            old.decision===body.decision && old.reasonNote===(body.reasonNote||"") && old.expectedReviewRevision===body.expectedReviewRevision &&
            oldReview?.planHash===plan.planHash && oldReview?.decisions?.[actorKey])
            return {state:"idempotent",status:oldReview.status,reviewRevision:oldReview.reviewRevision,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
          invalid("SPECIAL_PRICE_REVIEW_REPLAY_CONFLICT",409);
        }
        const next=applyDecision({requestId:body.requestId,request,plan,prior:oldReview,actor:who,
          decision:body.decision,reasonNote:body.reasonNote||"",expectedReviewRevision:body.expectedReviewRevision});
        const stamp=activitySalesServerTimestamp(admin),nowText=(services.now?.()||new Date()).toISOString();
        tx.create(decisionRef,{schemaVersion:"activity-sales-special-price-review-decision-v1",brandId:body.brandId,
          requestId:body.requestId,kind:"SPECIAL_PRICE",roleId:who.roleId,accountId:who.accountId,
          decision:body.decision,reasonNote:body.reasonNote||"",expectedReviewRevision:body.expectedReviewRevision,
          reviewRevision:next.reviewRevision,policyRevision:plan.policyRevision,planHash:plan.planHash,
          formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED",createdAt:stamp,createdAtText:nowText});
        const stored={...next,updatedAt:stamp,updatedAtText:nowText};
        if(reviewSnap.exists)tx.set(reviewRef,stored,{merge:false});else tx.create(reviewRef,stored);
        return {state:"written",status:next.status,reviewRevision:next.reviewRevision,
          formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
      });
      return res.status(200).json({ok:true,...result});
    }catch(e){
      const code=String(e?.code||e?.message||"SPECIAL_PRICE_REVIEW_FAILED");
      const status=Number(e?.status||(code.startsWith("SPECIAL_PRICE_")?409:code.startsWith("ATTRIBUTION_")||code.startsWith("ACTIVITY_")||code.startsWith("LIFECYCLE_")?409:500));
      if(status>=500)console.error("isolated special price review failed",e);
      return res.status(status).json({ok:false,code:status>=500?"SPECIAL_PRICE_REVIEW_FAILED":code});
    }
  };
}
module.exports={checkedBody,verifyRequest,createSpecialPriceReviewHandler};
