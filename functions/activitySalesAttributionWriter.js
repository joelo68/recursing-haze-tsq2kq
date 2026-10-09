"use strict";
// Isolated Phase 2A-1 Backend writer: never modifies formal daily reports/Summary.
const {activitySalesServerTimestamp}=require("./activitySalesFirestoreFieldValue");
const {assertActivitySalesSessionActor}=require("./activitySalesSessionBoundary");
const {attributionDocumentId,STATES}=require("./activitySalesAttributionContract");
const {checkedInput,ownerStore,reportKey,assertReport,assertSaleWindow,
  ensureReportDateAllowed,summaryDocumentId,invalid}=require("./activitySalesAttributionWriterLogic");

function createAttributionWriterHandler({admin,db,services={}}) {
  const dependencies=services.requireFirebaseRequestAuth && services.verifyTrustedApplicationActor && services.getBrandCollection
    ? services : {...require("./deviceApproval"),...services};
  const {requireFirebaseRequestAuth,verifyTrustedApplicationActor,getBrandCollection}=dependencies;
  return async(req,res)=>{
    if(req.method!=="POST") return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
    try {
      const {identity,storeName,targetStoreCore,sale,action,expectedRevision}=checkedInput(req.body);
      ensureReportDateAllowed(identity.reportDate,services.now?.()||new Date());
      const auth=await requireFirebaseRequestAuth(req,admin);
      if(!auth?.ok) return res.status(401).json({ok:false,code:"AUTH_EXPIRED"});
      assertActivitySalesSessionActor(auth,identity.brandId,req.body.actor||{});
      const actor=await verifyTrustedApplicationActor({db,brandId:identity.brandId,actor:req.body.actor||{},allowedRoles:["store","therapist"]});
      if(!actor?.ok || actor.actorRole!==identity.roleId || actor.actorAccountId!==identity.accountId) invalid("ATTRIBUTION_ACTOR_FORBIDDEN",403);
      const col=(name)=>getBrandCollection(db,identity.brandId,name);
      const masterRef=identity.roleId==="therapist"?col("therapists").doc(identity.accountId):null;
      const reportRef=col(identity.roleId==="therapist"?"therapist_daily_reports":"daily_reports").doc(reportKey(identity,storeName));
      const publicationRef=col("activity_sales_publications").doc(identity.campaignId);
      const versionRef=col("activity_campaign_versions").doc(identity.versionId);
      const dailyRef=col("activity_sales_daily_attributions").doc(summaryDocumentId(identity));
      const saleRef=sale?col("activity_sales_attribution_sales").doc(attributionDocumentId(identity,sale.saleId)):null;
      // B3B2-L1: symmetric sale-id mutex with the B3A special-price request writer.
      // B3A reads the sale doc and creates this state doc in the same transaction;
      // this path reads the state doc before writing the sale. Firestore OCC then
      // makes one of the two concurrent transactions retry and fail closed.
      const specialPriceStateRef=sale?col("activity_sales_special_price_request_state")
        .doc(attributionDocumentId(identity,sale.saleId)):null;
      const eventId=sale?attributionDocumentId(identity,sale.saleId):summaryDocumentId(identity);
      const auditRef=col("activity_sales_attribution_audit").doc(`${eventId}_${expectedRevision}`);
      const result=await db.runTransaction(async(tx)=>{
        // Firestore reads precede ALL writes. Conflicts retry on the same daily document.
        const masterSnap=masterRef?await tx.get(masterRef):null;
      if(masterRef && !masterSnap.exists) invalid("ATTRIBUTION_THERAPIST_MISSING",403);
      const storeCore=ownerStore({roleId:identity.roleId,accountId:identity.accountId,
        credential:actor.credential,therapistMaster:masterSnap?masterSnap.data():null,
        targetStore:storeName});
      const reportSnap=await tx.get(reportRef);
        const pubSnap=await tx.get(publicationRef);
        const versionSnap=await tx.get(versionRef);
        const dailySnap=await tx.get(dailyRef);
        const saleSnap=saleRef?await tx.get(saleRef):null;
        const specialPriceStateSnap=specialPriceStateRef?await tx.get(specialPriceStateRef):null;
        // Any previously created special-price application owns this sale ID,
        // including PENDING_REVIEW, REJECTED or APPROVED_PENDING_SETTLEMENT.
        // Never rely on caller-supplied state or an approval as an unlock.
        if(specialPriceStateSnap?.exists) invalid("ATTRIBUTION_SPECIAL_PRICE_REQUEST_LOCKED",409);
        if(!reportSnap.exists) invalid("ATTRIBUTION_REPORT_NOT_SUBMITTED",409);
        assertReport(reportSnap.data(),identity,storeCore);
        if(!pubSnap.exists || !versionSnap.exists) invalid("ATTRIBUTION_VERSION_NOT_PUBLISHED",409);
        const pkg=assertSaleWindow(pubSnap.data(),versionSnap.data(),identity,storeCore,sale?.packageId||null);
        if(sale && (sale.attributedAmount!==sale.quantity*pkg.salePrice)) invalid("ATTRIBUTION_PRICE_MISMATCH",409);
        const current=dailySnap.exists?dailySnap.data():null;
        if(current && (current.brandId!==identity.brandId || current.campaignId!==identity.campaignId ||
          current.versionId!==identity.versionId || current.roleId!==identity.roleId || current.accountId!==identity.accountId ||
          current.reportDate!==identity.reportDate || current.storeCore!==storeCore)) invalid("ATTRIBUTION_DAILY_IDENTITY_MISMATCH");
        const revision=current?.revision??0;
        if(!Number.isSafeInteger(revision) || revision<0) invalid("ATTRIBUTION_DAILY_REVISION_INVALID");
        if(saleSnap?.exists) {
          const saved=saleSnap.data();
          // A replay is allowed only for byte-for-byte same business event, regardless
          // of an old expectedRevision. A changed event is a correction (not enabled).
          if(saved?.brandId!==identity.brandId || saved?.campaignId!==identity.campaignId ||
             saved?.versionId!==identity.versionId || saved?.accountId!==identity.accountId ||
             saved?.reportDate!==identity.reportDate || saved?.roleId!==identity.roleId ||
             saved?.saleId!==sale.saleId || saved?.packageId!==sale.packageId ||
             saved?.quantity!==sale.quantity || saved?.attributedAmount!==sale.attributedAmount) invalid("ATTRIBUTION_SALE_REPLAY_CONFLICT",409);
          return {state:"idempotent",revision,status:current?.status||STATES.UNCONFIRMED};
        }
        if(revision!==expectedRevision) invalid("ATTRIBUTION_REVISION_CONFLICT",409);
        if(current?.status===STATES.CONFIRMED_ZERO && sale) invalid("ATTRIBUTION_ZERO_LOCKED",409);
        if(action==="confirm_zero" && current) invalid("ATTRIBUTION_ZERO_LOCKED",409);
        const now=(services.now?.()||new Date()).toISOString();
        const timestamp=activitySalesServerTimestamp(admin);
        const next=revision+1;
        let nextData;
        if(sale){
          const priorTotal=current?.attributedAmount||0,priorCount=current?.saleCount||0;
          const total=priorTotal+sale.attributedAmount;
          if(!Number.isSafeInteger(total) || total>1000000000 || !Number.isSafeInteger(priorCount) || priorCount<0 || priorCount>=10000) invalid("ATTRIBUTION_TOTAL_OVERFLOW",409);
          nextData={status:STATES.HAS_SALES,attributedAmount:total,saleCount:priorCount+1};
        }else{
          nextData={status:STATES.CONFIRMED_ZERO,attributedAmount:0,saleCount:0};
        }
        const common={brandId:identity.brandId,campaignId:identity.campaignId,versionId:identity.versionId,
          roleId:identity.roleId,accountId:identity.accountId,reportDate:identity.reportDate,storeCore,
          formalRevenueDelta:0};
        if(saleRef) tx.create(saleRef,{schemaVersion:"activity-sales-attribution-sale-v1",...sale,
          storeCore,createdAt:timestamp,createdAtText:now});
        tx.set(dailyRef,{schemaVersion:"activity-sales-daily-attribution-v1",...common,...nextData,
          revision:next,updatedAt:timestamp,updatedAtText:now},{merge:false});
        tx.create(auditRef,{schemaVersion:"activity-sales-attribution-audit-v1",...common,
          action,eventId,revisionFrom:revision,revisionTo:next,actorRole:actor.actorRole,
          actorAccountId:actor.actorAccountId,createdAt:timestamp,createdAtText:now});
        return {state:"written",revision:next,...nextData,formalRevenueDelta:0};
      });
      return res.status(200).json({ok:true,campaignId:identity.campaignId,
        versionId:identity.versionId,reportDate:identity.reportDate,...result});
    }catch(error){
      const code=String(error?.code||error?.message||"ATTRIBUTION_FAILED");
      const status=Number(error?.status||(code.startsWith("ACTIVITY_")?400:500));
      if(status>=500) console.error("writeActivitySalesAttribution failed",error);
      return res.status(status).json({ok:false,code:status>=500?"ATTRIBUTION_FAILED":code,
        message:status>=500?"活動成交歸屬暫時無法處理":code});
    }
  };
}
function createActivitySalesAttributionWriterFunctions({admin,db}) {
  const {onRequest}=require("firebase-functions/v2/https");
  return {writeActivitySalesAttribution:onRequest({cors:true,timeoutSeconds:25,memory:"256MiB"},createAttributionWriterHandler({admin,db}))};
}
module.exports={createAttributionWriterHandler,createActivitySalesAttributionWriterFunctions};
