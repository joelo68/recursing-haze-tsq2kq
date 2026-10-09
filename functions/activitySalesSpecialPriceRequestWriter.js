"use strict";
// Phase 2A-5B3A: UNREGISTERED pending-only special price request handler.
// There is deliberately NO sale insertion, review decision or settlement capability.
const {assertActivitySalesSessionActor}=require("./activitySalesSessionBoundary");
const {attributionDocumentId}=require("./activitySalesAttributionContract");
const {ownerStore,reportKey,assertReport,assertSaleWindow,summaryDocumentId,ensureReportDateAllowed,invalid}=require("./activitySalesAttributionWriterLogic");
const {activitySalesServerTimestamp}=require("./activitySalesFirestoreFieldValue");
const {parsePlan}=require("./activitySalesLifecycleReviewPolicy");
const {checkedSpecialPriceRequest,specialPriceRequestId,buildSpecialPriceRequest}=require("./activitySalesSpecialPriceRequestContract");
function createSpecialPriceRequestHandler({admin,db,services={}}){
  const deps=services.requireFirebaseRequestAuth&&services.verifyTrustedApplicationActor&&services.getBrandCollection&&services.getBrandSettingDoc
    ?services:{...require("./deviceApproval"),...services};
  const {requireFirebaseRequestAuth,verifyTrustedApplicationActor,getBrandCollection,getBrandSettingDoc}=deps;
  return async(req,res)=>{
    if(req.method!=="POST")return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
    try{
      const checked=checkedSpecialPriceRequest(req.body),{identity,storeName,saleId,packageId}=checked;
      ensureReportDateAllowed(identity.reportDate,services.now?.()||new Date());
      const actorInput=req.body.actor;
      const auth=await requireFirebaseRequestAuth(req,admin);
      if(!auth?.ok)return res.status(401).json({ok:false,code:"AUTH_EXPIRED"});
      assertActivitySalesSessionActor(auth,identity.brandId,actorInput);
      const actor=await verifyTrustedApplicationActor({db,brandId:identity.brandId,actor:actorInput,allowedRoles:["therapist","store"]});
      if(!actor?.ok || actor.actorRole!==identity.roleId || actor.actorAccountId!==identity.accountId)invalid("SPECIAL_PRICE_ACTOR_FORBIDDEN",403);
      const col=name=>getBrandCollection(db,identity.brandId,name);
      const masterRef=identity.roleId==="therapist"?col("therapists").doc(identity.accountId):null;
      const managerRef=identity.roleId==="store"?getBrandSettingDoc(db,identity.brandId,"store_account_data"):null;
      const reportRef=col(identity.roleId==="therapist"?"therapist_daily_reports":"daily_reports").doc(reportKey(identity,storeName));
      const publicationRef=col("activity_sales_publications").doc(identity.campaignId);
      const versionRef=col("activity_campaign_versions").doc(identity.versionId);
      const policyRef=col("activity_sales_lifecycle_review_policy").doc("current");
      const saleDocId=attributionDocumentId(identity,saleId);
      const saleRef=col("activity_sales_attribution_sales").doc(saleDocId);
      const legacyLockRef=col("activity_sales_lifecycle_request_state").doc(saleDocId);
      const dailyRef=col("activity_sales_daily_attributions").doc(summaryDocumentId(identity));
      const requestId=specialPriceRequestId(identity,saleId);
      const requestRef=col("activity_sales_special_price_requests").doc(requestId);
      const stateRef=col("activity_sales_special_price_request_state").doc(saleDocId);
      const result=await db.runTransaction(async tx=>{
        // Exact, scoped reads only. Every read happens before any write.
        const master=masterRef?await tx.get(masterRef):null;
        const manager=managerRef?await tx.get(managerRef):null;
        const report=await tx.get(reportRef);
        const pub=await tx.get(publicationRef);
        const version=await tx.get(versionRef);
        const policy=await tx.get(policyRef);
        const sale=await tx.get(saleRef);
        const legacyLock=await tx.get(legacyLockRef);
        const daily=await tx.get(dailyRef);
        const request=await tx.get(requestRef);
        const state=await tx.get(stateRef);
        let storeCore;
        if(identity.roleId==="therapist"){
          if(!master?.exists)invalid("SPECIAL_PRICE_THERAPIST_MISSING",403);
          storeCore=ownerStore({roleId:"therapist",accountId:identity.accountId,therapistMaster:master.data(),targetStore:storeName});
        }else{
          const rows=manager?.exists?manager.data()?.accounts:null;
          const account=Array.isArray(rows)?rows.find(a=>String(a?.id||a?.name||"")===actor.actorAccountId):null;
          if(!account || account.isActive===false || account.disabled===true || account.resigned===true)invalid("SPECIAL_PRICE_STORE_REVOKED",403);
          const stores=Array.isArray(account.stores)?account.stores:[account.storeName||account.store].filter(Boolean);
          storeCore=ownerStore({roleId:"store",accountId:identity.accountId,credential:{stores},targetStore:storeName});
        }
        if(!report?.exists)invalid("SPECIAL_PRICE_REPORT_MISSING",409);
        assertReport(report.data(),identity,storeCore);
        if(!pub?.exists || !version?.exists)invalid("SPECIAL_PRICE_VERSION_MISSING",409);
        const pkg=assertSaleWindow(pub.data(),version.data(),identity,storeCore,packageId);
        if(!policy?.exists)invalid("SPECIAL_PRICE_POLICY_MISSING",403);
        // Parse the same brand-scoped SPECIAL_PRICE authority as B2; no permission inferred from publication approval.
        const plan=parsePlan(policy.data(),"SPECIAL_PRICE",identity.brandId);
        const proposed=buildSpecialPriceRequest(checked,pkg.salePrice);
        if(sale?.exists || legacyLock?.exists)invalid("SPECIAL_PRICE_SALE_OR_LIFECYCLE_ALREADY_EXISTS",409);
        if(daily?.exists && (daily.data()?.status==="CONFIRMED_ZERO" || daily.data()?.brandId!==identity.brandId ||
          daily.data()?.storeCore!==storeCore || daily.data()?.formalRevenueDelta!==0))invalid("SPECIAL_PRICE_DAILY_STATE_CONFLICT",409);
        if(request?.exists){
          const prior=request.data();
          const before=prior?.proposal;
          if(prior.state==="PENDING_REVIEW" && prior.brandId===identity.brandId && prior.storeCore===storeCore &&
             prior.storeName===storeName && prior.reportDocId===reportRef.id &&
             prior.policyRevision===plan.policyRevision && prior.planHash===plan.planHash &&
             prior.requestedByRole===actor.actorRole && prior.requestedByAccountId===actor.actorAccountId &&
             JSON.stringify(before)===JSON.stringify(proposed) && state?.exists &&
             state.data()?.state==="PENDING_REVIEW" && state.data()?.requestId===requestId)
            return {state:"idempotent",requestId,approvalState:"PENDING_REVIEW",formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
          invalid("SPECIAL_PRICE_REPLAY_CONFLICT",409);
        }
        if(state?.exists)invalid("SPECIAL_PRICE_REQUEST_ALREADY_EXISTS",409);
        const now=(services.now?.()||new Date()).toISOString();
        const timestamp=activitySalesServerTimestamp(admin);
        const common={brandId:identity.brandId,campaignId:identity.campaignId,versionId:identity.versionId,
          roleId:identity.roleId,accountId:identity.accountId,reportDate:identity.reportDate,saleId,
          storeCore,storeName,reportDocId:reportRef.id,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
        tx.create(requestRef,{...common,schemaVersion:"activity-sales-special-price-request-record-v1",
          requestId,proposal:proposed,requestedByRole:actor.actorRole,requestedByAccountId:actor.actorAccountId,
          policyRevision:plan.policyRevision,planHash:plan.planHash,state:"PENDING_REVIEW",
          createdAt:timestamp,createdAtText:now});
        tx.create(stateRef,{...common,schemaVersion:"activity-sales-special-price-request-state-v1",
          requestId,state:"PENDING_REVIEW",requestRevision:1,createdAt:timestamp,createdAtText:now});
        return {state:"requested",requestId,approvalState:"PENDING_REVIEW",formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
      });
      return res.status(200).json({ok:true,...result});
    }catch(e){
      const code=String(e?.code||e?.message||"SPECIAL_PRICE_REQUEST_FAILED");
      const status=Number(e?.status||(code.startsWith("SPECIAL_PRICE_")?409:code.startsWith("ACTIVITY_")||code.startsWith("ATTRIBUTION_")||code.startsWith("LIFECYCLE_")?409:500));
      if(status>=500)console.error("isolated unregistered special price request failed",e);
      return res.status(status).json({ok:false,code:status>=500?"SPECIAL_PRICE_REQUEST_FAILED":code});
    }
  };
}
module.exports={createSpecialPriceRequestHandler};
