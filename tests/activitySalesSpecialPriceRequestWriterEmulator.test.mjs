import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const PROJECT="demo-drcyj-activity-sales";
if((process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT)!==PROJECT ||
  !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("SPECIAL_PRICE_EMULATOR_MUST_BE_DEMO_ONLY");
}
const admin=require("../functions/node_modules/firebase-admin");
if(!admin.apps.length)admin.initializeApp({projectId:PROJECT});
const db=admin.firestore();
const {createSpecialPriceRequestHandler}=require("../functions/activitySalesSpecialPriceRequestWriter.js");
const {specialPriceRequestId}=require("../functions/activitySalesSpecialPriceRequestContract.js");
const {attributionDocumentId}=require("../functions/activitySalesAttributionContract.js");
const NOW=new Date("2026-10-09T06:00:00Z");
const prefix=b=>b==="cyj"?"artifacts/default-app-id/public/data":`brands/${b}`;
const getCol=(_db,b,name)=>db.collection(`${prefix(b)}/${name}`);
let seq=0;
async function scenario(brand){
  seq++;
  const campaignId=`special_${process.pid}_${seq}_${Date.now()}`,versionId=`${campaignId}_v001`;
  const accountId="T001",storeName="崇學店",reportDate="2026-10-08";
  const identity={brandId:brand,campaignId,versionId,roleId:"therapist",accountId,reportDate};
  const at=(name)=>getCol(db,brand,name);
  const reportRef=at("therapist_daily_reports").doc(`${reportDate}_${accountId}`);
  const seed=[
    at("therapists").doc(accountId).set({id:accountId,store:storeName,status:"active"}),
    reportRef.set({brandId:brand,therapistId:accountId,storeName,date:reportDate,totalRevenue:86400}),
    at("activity_sales_publications").doc(campaignId).set({...identity,status:"published",startDate:"2026-10-01",endDate:"2026-10-31"}),
    at("activity_campaign_versions").doc(versionId).set({brandId:brand,campaignId,versionId,
      campaignSnapshot:{startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"all",packages:[{packageId:"pkg01",salePrice:18800}]}}),
    at("activity_sales_lifecycle_review_policy").doc("current").set({schemaVersion:"activity-sales-lifecycle-review-policy-v1",brandId:brand,
      enabled:true,revision:1,groups:{},flows:{SPECIAL_PRICE:{enabled:true,allowRequesterApproval:false,
        steps:[{stepId:"a1",quorum:"ANY",reviewers:[{type:"account",roleId:"store",accountId:"S001"}]}]}}}),
  ];
  await Promise.all(seed);
  const handler=createSpecialPriceRequestHandler({admin,db,services:{now:()=>NOW,getBrandCollection:getCol,
    getBrandSettingDoc:(_db,b,id)=>db.doc(`${prefix(b)}/settings/${id}`),
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:brand,roleId:"therapist",accountId}}),
    verifyTrustedApplicationActor:async()=>({ok:true,actorRole:"therapist",actorAccountId:accountId})}});
  const call=async(actualAmount)=>{
    const req={method:"POST",body:{...identity,action:"request_special_price",storeName,saleId:"sale001",packageId:"pkg01",quantity:1,
      actualAmount,reasonCode:"special_discount",reasonNote:"活動現場折讓待審",expectedRevision:0,
      actor:{roleId:"therapist",accountId,deviceId:"dev",credentialPassword:"demo"}}};
    // No client may send actor role/account as direct body fields.
    delete req.body.roleId;delete req.body.accountId;
    const res={code:200,status(n){this.code=n;return this;},json(body){return{status:this.code,body};}};
    return handler(req,res);
  };
  return {call,identity,at,reportRef};
}
test("B3A real Firestore Transaction: 3 brands accept exactly one conflicting special-price request; no sale or revenue writes",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const s=await scenario(brand);
    const outcomes=await Promise.all([s.call(17800),s.call(17000)]);
    assert.deepEqual(outcomes.map(x=>x.status).sort(),[200,409],`${brand} OCC must block conflicting proposal`);
    const winner=outcomes.findIndex(x=>x.status===200)===0?17800:17000;
    const retry=await s.call(winner);assert.equal(retry.status,200);assert.equal(retry.body.state,"idempotent");
    const requestId=specialPriceRequestId(s.identity,"sale001");
    const proposal=await s.at("activity_sales_special_price_requests").doc(requestId).get();
    assert.equal(proposal.exists,true);assert.equal(proposal.data().state,"PENDING_REVIEW");
    assert.equal(proposal.data().proposal.actualAmount,winner);
    assert.equal(proposal.data().formalRevenueDelta,0);
    const state=await s.at("activity_sales_special_price_request_state").doc(attributionDocumentId(s.identity,"sale001")).get();
    assert.equal(state.data().requestRevision,1);
    const sale=await s.at("activity_sales_attribution_sales").doc(attributionDocumentId(s.identity,"sale001")).get();
    assert.equal(sale.exists,false);
    assert.equal((await s.reportRef.get()).data().totalRevenue,86400);
  }
});
