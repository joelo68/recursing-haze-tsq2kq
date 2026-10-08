"use strict";
// Phase 2A-2: single-document, identity-bound read only. NEVER read private
// Firestore collections directly from Browser; NEVER change formal revenues.
const {validIdentity,STATES,assertDate}=require("./activitySalesAttributionContract");
const {assertActivitySalesSessionActor}=require("./activitySalesSessionBoundary");
const {ownerStore,reportKey,assertReport,assertSaleWindow,summaryDocumentId,invalid}=require("./activitySalesAttributionWriterLogic");

function normalizedStatus(snapshot,identity,storeCore) {
  if(!snapshot?.exists) return {status:STATES.UNCONFIRMED,saleCount:null,attributedAmount:null,revision:0,formalRevenueDelta:0};
  const value=snapshot.data()||{};
  if(value.schemaVersion!=="activity-sales-daily-attribution-v1" ||
    value.brandId!==identity.brandId || value.campaignId!==identity.campaignId || value.versionId!==identity.versionId ||
    value.roleId!==identity.roleId || value.accountId!==identity.accountId || value.reportDate!==identity.reportDate ||
    value.storeCore!==storeCore || value.formalRevenueDelta!==0 ||
    !Number.isSafeInteger(value.revision) || value.revision<1) invalid("ATTRIBUTION_READ_DATA_INVALID");
  if(value.status===STATES.CONFIRMED_ZERO && value.saleCount===0 && value.attributedAmount===0) {
    return {status:value.status,saleCount:0,attributedAmount:0,revision:value.revision,formalRevenueDelta:0};
  }
  if(value.status===STATES.HAS_SALES && Number.isSafeInteger(value.saleCount) && value.saleCount>=1 &&
      value.saleCount<=10000 && Number.isSafeInteger(value.attributedAmount) &&
      value.attributedAmount>0 && value.attributedAmount<=1000000000) {
    return {status:value.status,saleCount:value.saleCount,attributedAmount:value.attributedAmount,revision:value.revision,formalRevenueDelta:0};
  }
  invalid("ATTRIBUTION_READ_DATA_INVALID");
}

function createAttributionReaderHandler({admin,db,services={}}) {
  const deps=services.requireFirebaseRequestAuth && services.verifyTrustedApplicationActor && services.getBrandCollection
    ? services:{...require("./deviceApproval"),...services};
  const {requireFirebaseRequestAuth,verifyTrustedApplicationActor,getBrandCollection}=deps;
  return async(req,res)=>{
    if(req.method!=="POST")return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
    try {
      const body=req.body||{};
      const identity=validIdentity({brandId:body.brandId,campaignId:body.campaignId,versionId:body.versionId,
        roleId:body.actor?.roleId,accountId:body.actor?.accountId,reportDate:body.reportDate});
      // Read semantics differ from writer cutoff: historical submitted reports are readable;
      // future dates still forbidden, even if Browser supplies a forged day.
      assertDate(identity.reportDate);
      const taipeiNow=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(services.now?.()||new Date());
      if(identity.reportDate>taipeiNow)invalid("ATTRIBUTION_FUTURE_DATE",400);
      if(/[\/\\]/.test(identity.accountId))invalid("ATTRIBUTION_ACCOUNT_PATH_INVALID",400);
      const storeName=String(body.storeName||"").trim();
      if(!storeName || storeName.length>120 || storeName.includes("/") || storeName.includes("\\")) invalid("ATTRIBUTION_STORE_INVALID",400);
      const auth=await requireFirebaseRequestAuth(req,admin);
      if(!auth?.ok)return res.status(401).json({ok:false,code:"AUTH_EXPIRED"});
      assertActivitySalesSessionActor(auth,identity.brandId,body.actor||{});
      const actor=await verifyTrustedApplicationActor({db,brandId:identity.brandId,actor:body.actor||{},allowedRoles:["store","therapist"]});
      if(!actor?.ok || actor.actorRole!==identity.roleId || actor.actorAccountId!==identity.accountId)invalid("ATTRIBUTION_ACTOR_FORBIDDEN",403);
      const col=(name)=>getBrandCollection(db,identity.brandId,name);
      const masterRef=identity.roleId==="therapist"?col("therapists").doc(identity.accountId):null;
      const reportRef=col(identity.roleId==="therapist"?"therapist_daily_reports":"daily_reports").doc(reportKey(identity,storeName));
      const publicationRef=col("activity_sales_publications").doc(identity.campaignId);
      const versionRef=col("activity_campaign_versions").doc(identity.versionId);
      const dailyRef=col("activity_sales_daily_attributions").doc(summaryDocumentId(identity));
      // A single consistent Firestore snapshot; no query/index/listener/polling.
      const result=await db.runTransaction(async(tx)=>{
        const masterSnap=masterRef?await tx.get(masterRef):null;
        if(masterRef && !masterSnap.exists)invalid("ATTRIBUTION_THERAPIST_MISSING",403);
        const storeCore=ownerStore({roleId:identity.roleId,accountId:identity.accountId,
          credential:actor.credential,therapistMaster:masterSnap?.data()||null,targetStore:storeName});
        const reportSnap=await tx.get(reportRef);
        if(!reportSnap.exists)invalid("ATTRIBUTION_REPORT_NOT_SUBMITTED",409);
        assertReport(reportSnap.data(),identity,storeCore);
        const pubSnap=await tx.get(publicationRef);
        const versionSnap=await tx.get(versionRef);
        if(!pubSnap.exists || !versionSnap.exists)invalid("ATTRIBUTION_VERSION_NOT_PUBLISHED",409);
        assertSaleWindow(pubSnap.data(),versionSnap.data(),identity,storeCore,null);
        const dailySnap=await tx.get(dailyRef);
        return normalizedStatus(dailySnap,identity,storeCore);
      },{readOnly:true});
      return res.status(200).json({ok:true,brandId:identity.brandId,reportDate:identity.reportDate,
        campaignId:identity.campaignId,versionId:identity.versionId,...result});
    }catch(error){
      const code=String(error?.code||error?.message||"ATTRIBUTION_READ_FAILED");
      const status=Number(error?.status||(code.startsWith("ACTIVITY_")?400:500));
      if(status>=500)console.error("getActivitySalesAttributionStatus failed",error);
      return res.status(status).json({ok:false,code:status>=500?"ATTRIBUTION_READ_FAILED":code,
        message:status>=500?"目前無法查詢活動成交歸屬":"活動成交歸屬查詢遭拒："+code});
    }
  };
}
function createActivitySalesAttributionReaderFunctions({admin,db}){
  const {onRequest}=require("firebase-functions/v2/https");
  return {getActivitySalesAttributionStatus:onRequest({cors:true,timeoutSeconds:25,memory:"256MiB"},createAttributionReaderHandler({admin,db}))};
}
module.exports={normalizedStatus,createAttributionReaderHandler,createActivitySalesAttributionReaderFunctions};
