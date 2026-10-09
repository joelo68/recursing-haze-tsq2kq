import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const PROJECT="demo-drcyj-activity-sales";
if((process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT)!==PROJECT ||
   !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error("B2 review tx test requires demo-only Firestore/Auth emulators");
const admin=require("../functions/node_modules/firebase-admin");
if(!admin.apps.length)admin.initializeApp({projectId:PROJECT});
const db=admin.firestore();
const {normalizeEvent,lifecycleDocumentId}=require("../functions/activitySalesLifecycleContract.js");
const {attributionDocumentId}=require("../functions/activitySalesAttributionContract.js");
const {summaryDocumentId}=require("../functions/activitySalesAttributionWriterLogic.js");
const {createLifecycleReviewHandler}=require("../functions/activitySalesLifecycleReviewWriter.js");
const prefix=brand=>brand==="cyj"?"artifacts/default-app-id/public/data":`brands/${brand}`;
const at=(brand,name)=>db.collection(`${prefix(brand)}/${name}`);
const now=new Date("2026-10-09T01:00:00.000Z");
async function seed(brand){
  const tag=`b2_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const event=normalizeEvent({brandId:brand,campaignId:tag,versionId:`${tag}_v001`,roleId:"therapist",
    accountId:"T001",reportDate:"2026-10-08",saleId:`s_${tag}`,eventId:"event01",eventDate:"2026-10-09",
    kind:"REFUND",refundAmount:700,reasonCode:"customer_request",expectedEventRevision:0,formalRevenueDelta:0});
  const requestId=lifecycleDocumentId(event),saleId=attributionDocumentId(event,event.saleId);
  await Promise.all([
    at(brand,"activity_sales_lifecycle_requests").doc(requestId).set({schemaVersion:"activity-sales-lifecycle-request-v1",
      ...event,storeCore:"崇學",event,eventCanonical:JSON.stringify(event),state:"PENDING_REVIEW",requestedByRole:"therapist",
      requestedByAccountId:"T001",formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"}),
    at(brand,"activity_sales_lifecycle_request_state").doc(saleId).set({...event,state:"PENDING_REVIEW",pendingRequestId:requestId,requestRevision:1}),
    at(brand,"activity_sales_attribution_sales").doc(saleId).set({...event,storeCore:"崇學",formalRevenueDelta:0}),
    at(brand,"activity_sales_daily_attributions").doc(summaryDocumentId(event)).set({...event,storeCore:"崇學",status:"HAS_SALES",formalRevenueDelta:0}),
    at(brand,"activity_campaign_versions").doc(event.versionId).set({brandId:brand,versionId:event.versionId}),
    at(brand,"activity_sales_lifecycle_review_policy").doc("current").set({
      schemaVersion:"activity-sales-lifecycle-review-policy-v1",brandId:brand,enabled:true,revision:1,groups:{},
      flows:{REFUND:{enabled:true,allowRequesterApproval:false,steps:[{stepId:"store_gate",quorum:"ANY",reviewers:[
        {type:"account",roleId:"store",accountId:"S001"},{type:"account",roleId:"store",accountId:"S002"}]}]}}}),
  ]);
  // CYJ uses global_settings, not brands/.../settings.
  const settingsRef=brand==="cyj"?db.doc(`${prefix(brand)}/global_settings/store_account_data`):db.doc(`${prefix(brand)}/settings/store_account_data`);
  await settingsRef.set({accounts:[{id:"S001",stores:["崇學"],isActive:true},{id:"S002",stores:["崇學"],isActive:true}]});
  return {event,requestId,settingsRef};
}
function handler(brand,accountId){
  const getBrandCollection=(_db,b,name)=>at(b,name);
  const getBrandSettingDoc=(_db,b,name)=>b==="cyj"?db.doc(`${prefix(b)}/global_settings/${name}`):db.doc(`${prefix(b)}/settings/${name}`);
  return createLifecycleReviewHandler({admin,db,services:{now:()=>now,getBrandCollection,getBrandSettingDoc,
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:brand,roleId:"store",accountId}}),
    verifyTrustedApplicationActor:async()=>({ok:true,actorRole:"store",actorAccountId:accountId})}});
}
async function call(brand,accountId,requestId,expectedReviewRevision=0){
  const h=handler(brand,accountId);
  const req={method:"POST",body:{action:"review_lifecycle",brandId:brand,requestId,decision:"APPROVE",reasonNote:"",
    expectedReviewRevision,actor:{roleId:"store",accountId,deviceId:"demo",credentialPassword:"fake-emulator-only"}}};
  const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){return {status:this.statusCode,body};}};
  return h(req,res);
}
test("B2: Firestore transaction concurrent review approvals OCC all 3 brands, zero settlement",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const s=await seed(brand);
    const answers=await Promise.all([call(brand,"S001",s.requestId),call(brand,"S002",s.requestId)]);
    assert.deepEqual(answers.map(x=>x.status).sort(),[200,409],`${brand} single approval winner`);
    const winner=answers[0].status===200?"S001":"S002";
    assert.equal((await call(brand,winner,s.requestId)).body.state,"idempotent");
    const review=await at(brand,"activity_sales_lifecycle_review_state").doc(s.requestId).get();
    assert.equal(review.data().status,"APPROVED_PENDING_SETTLEMENT");
    assert.equal(review.data().reviewRevision,1);
    const decisions=await at(brand,"activity_sales_lifecycle_review_decisions").where("requestId","==",s.requestId).get();
    assert.equal(decisions.size,1);
    assert.equal(decisions.docs[0].data().formalRevenueDelta,0);
    assert.equal((await at(brand,"activity_sales_lifecycle_requests").doc(s.requestId).get()).data().state,"PENDING_REVIEW");
    assert.equal((await at(brand,"activity_sales_attribution_sales").doc(attributionDocumentId(s.event,s.event.saleId)).get()).data().formalRevenueDelta,0);
    assert.equal((await at(brand,"activity_sales_daily_attributions").doc(summaryDocumentId(s.event)).get()).data().status,"HAS_SALES");
  }
});
