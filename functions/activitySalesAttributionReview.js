"use strict";
// Phase 2A-4R1: one-therapist-one-activity review, scoped to a store account.
// This does not correct, refund, approve formal revenue, or touch daily reports.
const {assertActivitySalesSessionActor}=require("./activitySalesSessionBoundary");
const {ownerStore,reportKey,assertReport,assertSaleWindow,summaryDocumentId,invalid}=require("./activitySalesAttributionWriterLogic");
const {normalizedStatus}=require("./activitySalesAttributionReader");
const {checkedReviewInput,reportUpdateVersion,normalizedReview,assertConfirmedForReview}=require("./activitySalesAttributionReviewLogic");
const {activitySalesServerTimestamp}=require("./activitySalesFirestoreFieldValue");

function createAttributionReviewHandler({admin,db,services={}}){
  const deps=services.requireFirebaseRequestAuth && services.verifyTrustedApplicationActor && services.getBrandCollection
    ?services:{...require("./deviceApproval"),...services};
  const {requireFirebaseRequestAuth,verifyTrustedApplicationActor,getBrandCollection}=deps;
  const getBrandSettingDoc=deps.getBrandSettingDoc||require("./deviceApproval").getBrandSettingDoc;
  return async(req,res)=>{
    if(req.method!=="POST")return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
    try{
      const body=req.body||{};
      const {subject,storeName,storeCore,action,decision,reason}=checkedReviewInput(body);
      // Harden all read/review requests: do not expose other actor's brand/identity.
      const auth=await requireFirebaseRequestAuth(req,admin);
      if(!auth?.ok)return res.status(401).json({ok:false,code:"AUTH_EXPIRED"});
      assertActivitySalesSessionActor(auth,subject.brandId,body.actor);
      const actor=await verifyTrustedApplicationActor({db,brandId:subject.brandId,actor:body.actor,allowedRoles:["store"]});
      if(!actor?.ok || actor.actorRole!=="store" || actor.actorAccountId!==body.actor.accountId) invalid("ATTRIBUTION_REVIEW_ACTOR_FORBIDDEN",403);
      // Not manager_auth: store_account_data.stores is store-manager authority.
      ownerStore({roleId:"store",accountId:actor.actorAccountId,credential:actor.credential,targetStore:storeName});
      const col=name=>getBrandCollection(db,subject.brandId,name);
      const managerAuthRef=getBrandSettingDoc(db,subject.brandId,"store_account_data");
      const masterRef=col("therapists").doc(subject.accountId);
      const reportRef=col("therapist_daily_reports").doc(reportKey(subject,storeName));
      const publicationRef=col("activity_sales_publications").doc(subject.campaignId);
      const versionRef=col("activity_campaign_versions").doc(subject.versionId);
      const id=summaryDocumentId(subject);
      const dailyRef=col("activity_sales_daily_attributions").doc(id);
      const reviewRef=col("activity_sales_attribution_reviews").doc(id);
      const auditRef=body.action==="review"
        ?col("activity_sales_attribution_review_audit").doc(`${id}_r${body.expectedReviewRevision+1}`):null;
      const result=await db.runTransaction(async tx=>{
        // Firestore transaction: strictly all reads before writes; scoped to exact docs.
        const managerSnap=await tx.get(managerAuthRef);
        const masterSnap=await tx.get(masterRef);
        const reportSnap=await tx.get(reportRef);
        const pubSnap=await tx.get(publicationRef);
        const versionSnap=await tx.get(versionRef);
        const dailySnap=await tx.get(dailyRef);
        const reviewSnap=await tx.get(reviewRef);
        // Recheck the canonical store-account membership INSIDE the transaction.
        // A concurrent admin revocation causes transaction retry rather than stale approval.
        const accounts=managerSnap.exists?managerSnap.data()?.accounts:null;
        const manager=Array.isArray(accounts)?accounts.find(a=>String(a?.id||a?.name||"")===actor.actorAccountId):null;
        if(!manager || manager.isActive===false || manager.disabled===true)invalid("ATTRIBUTION_REVIEW_MANAGER_REVOKED",403);
        const latestStores=Array.isArray(manager.stores)?manager.stores:[manager.storeName||manager.store].filter(Boolean);
        ownerStore({roleId:"store",accountId:actor.actorAccountId,credential:{stores:latestStores},targetStore:storeName});
        if(!masterSnap.exists)invalid("ATTRIBUTION_REVIEW_THERAPIST_MISSING",403);
        // Canonical therapist master must agree with store manager's allowed store.
        const verifiedStore=ownerStore({roleId:"therapist",accountId:subject.accountId,
          therapistMaster:masterSnap.data(),targetStore:storeName});
        if(verifiedStore!==storeCore)invalid("ATTRIBUTION_REVIEW_STORE_MISMATCH",403);
        if(!reportSnap.exists)invalid("ATTRIBUTION_REPORT_NOT_SUBMITTED",409);
        assertReport(reportSnap.data(),subject,storeCore);
        if(!pubSnap.exists || !versionSnap.exists)invalid("ATTRIBUTION_VERSION_NOT_PUBLISHED",409);
        assertSaleWindow(pubSnap.data(),versionSnap.data(),subject,storeCore,null);
        const reportVersion=reportUpdateVersion(reportSnap);
        const attribution=normalizedStatus(dailySnap,subject,storeCore);
        const prior=reviewSnap.exists?reviewSnap.data():null;
        const existing=normalizedReview(prior,subject,storeCore,attribution.revision,reportVersion);
        if(action==="inspect")return {subject,storeCore,...attribution,reportUpdateVersion:reportVersion,review:existing};
        assertConfirmedForReview(attribution);
        // Allow a safe replay of EXACT same review, even if response was lost.
        if(existing.state==="CURRENT" && prior?.reviewedByRole==="store" &&
           prior?.reviewedByAccountId===actor.actorAccountId && prior?.decision===decision &&
           prior?.reason===reason && prior?.attributionRevision===body.expectedAttributionRevision &&
           prior?.reportUpdateVersion===body.expectedReportUpdateVersion){
          return {state:"idempotent",reviewRevision:existing.reviewRevision,decision,reason:reason||null,formalRevenueDelta:0};
        }
        if(body.expectedAttributionRevision!==attribution.revision ||
          body.expectedReportUpdateVersion!==reportVersion ||
          body.expectedReviewRevision!==existing.reviewRevision)invalid("ATTRIBUTION_REVIEW_REVISION_CONFLICT",409);
        const next=existing.reviewRevision+1;
        const updatedAt=activitySalesServerTimestamp(admin);
        const now=(services.now?.()||new Date()).toISOString();
        const common={brandId:subject.brandId,campaignId:subject.campaignId,versionId:subject.versionId,
          roleId:subject.roleId,accountId:subject.accountId,reportDate:subject.reportDate,storeCore,formalRevenueDelta:0};
        const record={schemaVersion:"activity-sales-attribution-review-v1",...common,
          reviewRevision:next,attributionRevision:attribution.revision,reportUpdateVersion:reportVersion,
          decision,reason,reviewedByRole:"store",reviewedByAccountId:actor.actorAccountId,
          updatedAt,updatedAtText:now};
        tx.set(reviewRef,record,{merge:false});
        tx.create(auditRef,{schemaVersion:"activity-sales-attribution-review-audit-v1",...common,
          decision,reason,reviewRevisionFrom:existing.reviewRevision,reviewRevisionTo:next,
          attributionRevision:attribution.revision,reportUpdateVersion:reportVersion,
          reviewedByRole:"store",reviewedByAccountId:actor.actorAccountId,createdAt:updatedAt,createdAtText:now});
        return {state:"written",reviewRevision:next,decision,reason:reason||null,formalRevenueDelta:0};
      });
      return res.status(200).json({ok:true,...result});
    }catch(error){
      const code=String(error?.code||error?.message||"ATTRIBUTION_REVIEW_FAILED");
      const status=Number(error?.status||(code.startsWith("ACTIVITY_")?400:500));
      if(status>=500)console.error("manageActivitySalesAttributionReview failed",error);
      return res.status(status).json({ok:false,code:status>=500?"ATTRIBUTION_REVIEW_FAILED":code});
    }
  };
}
function createActivitySalesAttributionReviewFunctions({admin,db}){
  const {onRequest}=require("firebase-functions/v2/https");
  return {manageActivitySalesAttributionReview:onRequest({cors:true,timeoutSeconds:25,memory:"256MiB"},createAttributionReviewHandler({admin,db}))};
}
module.exports={createAttributionReviewHandler,createActivitySalesAttributionReviewFunctions};
