import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const PROJECT="demo-drcyj-activity-sales";
if((process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT)!==PROJECT ||
   !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST){
  throw new Error("2A-5B1 real transaction test must use the demo Firebase emulators only");
}
const admin=require("../functions/node_modules/firebase-admin");
if(!admin.apps.length)admin.initializeApp({projectId:PROJECT});
const db=admin.firestore();
const {createLifecycleRequestHandler}=require("../functions/activitySalesLifecycleRequestWriter.js");
const {attributionDocumentId}=require("../functions/activitySalesAttributionContract.js");
const {summaryDocumentId}=require("../functions/activitySalesAttributionWriterLogic.js");
const now=new Date("2026-10-09T00:00:00.000Z");
const prefix=brand=>brand==="cyj"?"artifacts/default-app-id/public/data":`brands/${brand}`;
const collection=(_db,brand,name)=>db.collection(`${prefix(brand)}/${name}`);
let seedSequence=0;
async function scenario(brand){
  const n=++seedSequence;
  const campaignId=`l5b1_${process.pid}_${n}_${Date.now()}`,versionId=`${campaignId}_v001`,accountId="T001";
  const storeName=brand==="cyj"?"CYJ崇學店":brand==="anniu"?"安妞崇學店":"伊啵崇學店";
  const identity={brandId:brand,roleId:"therapist",accountId,campaignId,versionId,reportDate:"2026-10-08"};
  const sale={...identity,saleId:"sale001",packageId:"pkg01",quantity:1,attributedAmount:9800,
    storeCore:"崇學",formalRevenueDelta:0};
  const at=name=>collection(db,brand,name);
  const saleRef=at("activity_sales_attribution_sales").doc(attributionDocumentId(identity,sale.saleId));
  const reportRef=at("therapist_daily_reports").doc("2026-10-08_T001");
  await Promise.all([
    at("therapists").doc(accountId).set({id:accountId,store:storeName,status:"active"}),
    reportRef.set({brandId:brand,date:"2026-10-08",therapistId:accountId,storeName,totalRevenue:9800}),
    saleRef.set(sale),
    at("activity_sales_daily_attributions").doc(summaryDocumentId(identity)).set({...identity,storeCore:"崇學",
      status:"HAS_SALES",saleCount:1,attributedAmount:9800,revision:1,formalRevenueDelta:0}),
    at("activity_campaign_versions").doc(versionId).set({brandId:brand,campaignId,versionId,
      campaignSnapshot:{startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"all",stores:[],packages:[{packageId:"pkg01",salePrice:9800}]}}),
  ]);
  const handler=createLifecycleRequestHandler({admin,db,services:{now:()=>now,getBrandCollection:collection,
    getBrandSettingDoc:(_db,b,id)=>db.doc(`${prefix(b)}/settings/${id}`),
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",
      brandId:brand,roleId:"therapist",accountId}}),
    verifyTrustedApplicationActor:async()=>({ok:true,actorRole:"therapist",actorAccountId:accountId})}});
  const call=async(eventId)=>{
    const req={method:"POST",body:{action:"request_lifecycle",storeName,
      actor:{roleId:"therapist",accountId,deviceId:"demo-dev",credentialPassword:"fake-test-only"},
      event:{...identity,saleId:"sale001",eventId,eventDate:"2026-10-09",kind:"REFUND",
        reasonCode:"customer_request",reasonNote:"",refundAmount:1000,expectedEventRevision:0,formalRevenueDelta:0}}};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){return{status:this.statusCode,body};}};
    return handler(req,res);
  };
  return {at,call,saleRef,reportRef,campaignId};
}
test("2A-5B1: actual Firestore tx exactly one PENDING request under concurrent races for all three brands",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const s=await scenario(brand);
    const result=await Promise.all([s.call("evt001"),s.call("evt002")]);
    assert.deepEqual(result.map(r=>r.status).sort(),[200,409],`${brand} only one request may win`);
    const winner=result[0].status===200?"evt001":"evt002";
    assert.equal((await s.call(winner)).body.state,"idempotent");
    assert.equal((await s.call(winner==="evt001"?"evt002":"evt001")).status,409);
    const requests=await s.at("activity_sales_lifecycle_requests").where("campaignId","==",s.campaignId).get();
    const states=await s.at("activity_sales_lifecycle_request_state").where("campaignId","==",s.campaignId).get();
    assert.equal(requests.size,1,`${brand} event append only`);
    assert.equal(states.size,1,`${brand} scoped lock`);
    assert.equal(requests.docs[0].data().state,"PENDING_REVIEW");
    assert.equal(requests.docs[0].data().officialKpiAllocation,"UNDECIDED");
    assert.equal(requests.docs[0].data().formalRevenueDelta,0);
    const saleSnap=await s.saleRef.get(),reportSnap=await s.reportRef.get();
    assert.equal(saleSnap.data().attributedAmount,9800);
    assert.equal(reportSnap.data().totalRevenue,9800);
  }
});
