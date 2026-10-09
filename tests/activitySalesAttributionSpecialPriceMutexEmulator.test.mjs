import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const PROJECT="demo-drcyj-activity-sales";
if((process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT)!==PROJECT ||
  !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw Error("B3B2_L1_REQUIRES_DEMO_FIRESTORE_AND_AUTH_EMULATORS");
const admin=require("../functions/node_modules/firebase-admin");
if(!admin.apps.length)admin.initializeApp({projectId:PROJECT});
const db=admin.firestore();
const {createAttributionWriterHandler}=require("../functions/activitySalesAttributionWriter.js");
const {createSpecialPriceRequestHandler}=require("../functions/activitySalesSpecialPriceRequestWriter.js");
const {attributionDocumentId}=require("../functions/activitySalesAttributionContract.js");
const {specialPriceRequestId,checkedSpecialPriceRequest}=require("../functions/activitySalesSpecialPriceRequestContract.js");
const prefix=brand=>brand==="cyj"?"artifacts/default-app-id/public/data":`brands/${brand}`;
const col=(_db,brand,name)=>db.collection(`${prefix(brand)}/${name}`);
const setting=(_db,brand,name)=>brand==="cyj"
  ?db.doc(`artifacts/default-app-id/public/data/global_settings/${name}`)
  :db.doc(`brands/${brand}/settings/${name}`);
const now=new Date("2026-10-09T06:00:00.000Z");
function res(){return {code:200,status(code){this.code=code;return this;},json(body){return {status:this.code,body}}};}
let seq=0;
async function seed(brand){
  const campaignId=`mutex_${process.pid}_${++seq}_${Date.now()}`,versionId=`${campaignId}_v001`;
  const identity={brandId:brand,campaignId,versionId,roleId:"therapist",accountId:"T001",reportDate:"2026-10-08"};
  const storeName="崇學店",at=name=>col(db,brand,name);
  await Promise.all([
    at("therapists").doc("T001").set({id:"T001",store:storeName,status:"active"}),
    at("therapist_daily_reports").doc("2026-10-08_T001").set({brandId:brand,therapistId:"T001",date:"2026-10-08",storeName,totalRevenue:8800}),
    at("activity_sales_publications").doc(campaignId).set({...identity,status:"published",startDate:"2026-10-01",endDate:"2026-10-31"}),
    at("activity_campaign_versions").doc(versionId).set({brandId:brand,campaignId,versionId,campaignSnapshot:{
      startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"all",packages:[{packageId:"pkg01",salePrice:9800}]}}),
    at("activity_sales_lifecycle_review_policy").doc("current").set({schemaVersion:"activity-sales-lifecycle-review-policy-v1",
      brandId:brand,enabled:true,revision:1,groups:{},flows:{SPECIAL_PRICE:{enabled:true,allowRequesterApproval:false,
        steps:[{stepId:"stage1",quorum:"ANY",reviewers:[{type:"account",roleId:"store",accountId:"S001"}]}]}}}),
  ]);
  const services={now:()=>now,getBrandCollection:col,getBrandSettingDoc:setting,
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",
      brandId:brand,roleId:"therapist",accountId:"T001"}}),
    verifyTrustedApplicationActor:async()=>({ok:true,actorRole:"therapist",actorAccountId:"T001"})};
  const ordinary=createAttributionWriterHandler({admin,db,services});
  const special=createSpecialPriceRequestHandler({admin,db,services});
  const actor={roleId:"therapist",accountId:"T001",deviceId:"dev",credentialPassword:"test"};
  // The request contract takes role/account exclusively from actor. They are NOT top-level body fields.
  // Copy only the exact, permitted public identity fields; otherwise B3A correctly rejects with 400.
  const common={brandId:brand,campaignId,versionId,reportDate:identity.reportDate,storeName,
    saleId:"s001",packageId:"pkg01",quantity:1,actor};
  const normalCall=()=>ordinary({method:"POST",body:{...common,action:"record_sale",attributedAmount:9800,expectedRevision:0}},res());
  const specialBody={...common,action:"request_special_price",actualAmount:8800,
    reasonCode:"special_discount",reasonNote:"客戶專案折扣",expectedRevision:0};
  // Catch malformed test fixtures BEFORE treating a 400 as a failed mutex transaction.
  assert.doesNotThrow(()=>checkedSpecialPriceRequest(specialBody),`${brand}: fixture must satisfy B3A input contract`);
  const specialCall=()=>special({method:"POST",body:specialBody},res());
  return {at,identity,normalCall,specialCall};
}
test("B3B2-L1: concurrent normal sale vs special-price request shares exact sale-id transaction lock, all brands",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const f=await seed(brand);
    const responses=await Promise.all([f.normalCall(),f.specialCall()]);
    assert.deepEqual(responses.map(x=>x.status).sort(),[200,409],
      `${brand}: exactly one succeeds; codes=${responses.map(x=>x.body?.code||"OK").join(",")}`);
    const id=attributionDocumentId(f.identity,"s001"),requestId=specialPriceRequestId(f.identity,"s001");
    const sale=await f.at("activity_sales_attribution_sales").doc(id).get();
    const specialState=await f.at("activity_sales_special_price_request_state").doc(id).get();
    assert.notEqual(sale.exists,specialState.exists,`${brand}: cannot have both types for one ID`);
    const request=await f.at("activity_sales_special_price_requests").doc(requestId).get();
    assert.equal(request.exists,specialState.exists,`${brand}: proposal state atomic with request`);
    if(specialState.exists){
      assert.equal((await f.normalCall()).status,409,`${brand}: no normal sale after proposal`);
    }else{
      assert.equal((await f.specialCall()).status,409,`${brand}: no proposal after normal sale`);
    }
    const formal=await f.at("therapist_daily_reports").doc("2026-10-08_T001").get();
    assert.equal(formal.data().totalRevenue,8800,"formal report unchanged");
  }
});
