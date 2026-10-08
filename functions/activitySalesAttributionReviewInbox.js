"use strict";
// Phase 2A-4R2A: explicit, bounded store-manager review candidates. READ ONLY.
// No private collection is accessible to Browser; no polling or listener.
const {assertActivitySalesSessionActor}=require("./activitySalesSessionBoundary");
const {ownerStore,assertSaleWindow,invalid}=require("./activitySalesAttributionWriterLogic");
const {checkedReviewInboxInput,checkedReviewCandidate,MAX_CANDIDATES,encodeReviewCursor}=require("./activitySalesAttributionReviewInboxLogic");

function createAttributionReviewInboxHandler({admin,db,services={}}){
  const deps=services.requireFirebaseRequestAuth&&services.verifyTrustedApplicationActor&&services.getBrandCollection
    ?services:{...require("./deviceApproval"),...services};
  const {requireFirebaseRequestAuth,verifyTrustedApplicationActor,getBrandCollection}=deps;
  const getBrandSettingDoc=deps.getBrandSettingDoc||require("./deviceApproval").getBrandSettingDoc;
  return async(req,res)=>{
    if(req.method!=="POST")return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
    try{
      const {brandId,storeName,storeCore,reportDate,afterId}=checkedReviewInboxInput(req.body,services.now?.()||new Date());
      const actorInput=req.body.actor||{};
      const auth=await requireFirebaseRequestAuth(req,admin);
      if(!auth?.ok)return res.status(401).json({ok:false,code:"AUTH_EXPIRED"});
      assertActivitySalesSessionActor(auth,brandId,actorInput);
      const actor=await verifyTrustedApplicationActor({db,brandId,actor:actorInput,allowedRoles:["store"]});
      if(!actor?.ok || actor.actorRole!=="store" || actor.actorAccountId!==actorInput.accountId)
        invalid("ATTRIBUTION_REVIEW_INBOX_ACTOR_FORBIDDEN",403);
      ownerStore({roleId:"store",accountId:actor.actorAccountId,credential:actor.credential,targetStore:storeName});
      const col=name=>getBrandCollection(db,brandId,name);
      const authRef=getBrandSettingDoc(db,brandId,"store_account_data");
      const summaryQuery=col("activity_sales_daily_attributions")
        .where("storeCore","==",storeCore)
        .where("reportDate","==",reportDate)
        .where("roleId","==","therapist")
        // Stable, index-backed document-ID ordering; a cursor does not grant authority.
        .orderBy("__name__","asc");
      const boundedQuery=(afterId?summaryQuery.startAfter(afterId):summaryQuery).limit(MAX_CANDIDATES+1);
      const result=await db.runTransaction(async tx=>{
        // Re-read canonical store-account permission and candidate query in ONE read-only snapshot.
        // A revocation committed before this snapshot cannot be bypassed with stale credentials.
        const authSnap=await tx.get(authRef);
        const accounts=authSnap.exists?authSnap.data()?.accounts:null;
        const current=Array.isArray(accounts)
          ?accounts.find(a=>String(a?.id||a?.name||"")===actor.actorAccountId):null;
        if(!current || current.isActive===false || current.disabled===true)
          invalid("ATTRIBUTION_REVIEW_INBOX_MANAGER_REVOKED",403);
        const latestStores=Array.isArray(current.stores)?current.stores:[current.storeName||current.store].filter(Boolean);
        ownerStore({roleId:"store",accountId:actor.actorAccountId,
          credential:{stores:latestStores},targetStore:storeName});
        const page=await tx.get(boundedQuery);
        const rows=page.docs||[];
        const output=[];
        // Check CURRENT therapist store and CURRENT published version before returning even
        // the minimum candidate identity. Historical/stale records are not an active inbox.
        for(const candidate of rows.slice(0,MAX_CANDIDATES)){
          const {subject,...status}=checkedReviewCandidate(candidate,{brandId,storeCore,reportDate});
          const therapistSnap=await tx.get(col("therapists").doc(subject.accountId));
          if(!therapistSnap.exists)continue;
          try{ownerStore({roleId:"therapist",accountId:subject.accountId,
            therapistMaster:therapistSnap.data(),targetStore:storeName});}catch{continue;}
          const publicationSnap=await tx.get(col("activity_sales_publications").doc(subject.campaignId));
          if(!publicationSnap.exists)continue;
          const pub=publicationSnap.data();
          if(pub?.brandId!==brandId || pub.status!=="published" || pub.versionId!==subject.versionId ||
             !(pub.startDate<=reportDate&&pub.endDate>=reportDate))continue;
          const versionSnap=await tx.get(col("activity_campaign_versions").doc(subject.versionId));
          if(!versionSnap.exists)continue;
          try{assertSaleWindow(pub,versionSnap.data(),subject,storeCore,null);}catch{continue;}
          output.push({accountId:subject.accountId,campaignId:subject.campaignId,
            versionId:subject.versionId,reportDate,status:status.status,
            saleCount:status.saleCount,attributedAmount:status.attributedAmount,
            attributionRevision:status.revision,formalRevenueDelta:0});
        }
        const hasMore=rows.length>MAX_CANDIDATES;
        const lastScanned=rows.slice(0,MAX_CANDIDATES).at(-1);
        return {candidates:output,truncated:hasMore,hasMore,
          nextCursor:hasMore&&lastScanned?encodeReviewCursor({brandId,storeCore,reportDate},lastScanned.id):null,
          maxCandidates:MAX_CANDIDATES,reportDate,brandId,storeCore};
      },{readOnly:true});
      return res.status(200).json({ok:true,...result});
    }catch(error){
      const code=String(error?.code||error?.message||"ATTRIBUTION_REVIEW_INBOX_FAILED");
      const status=Number(error?.status||500);
      if(status>=500)console.error("getActivitySalesReviewCandidates failed",error);
      return res.status(status).json({ok:false,code:status>=500?"ATTRIBUTION_REVIEW_INBOX_FAILED":code});
    }
  };
}
function createActivitySalesReviewInboxFunctions({admin,db}){
  const {onRequest}=require("firebase-functions/v2/https");
  return {getActivitySalesReviewCandidates:onRequest({cors:true,timeoutSeconds:30,memory:"256MiB"},
    createAttributionReviewInboxHandler({admin,db}))};
}
module.exports={createAttributionReviewInboxHandler,createActivitySalesReviewInboxFunctions};
