import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const PROJECT="demo-drcyj-activity-sales";
if((process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT)!==PROJECT ||
  !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw Error("B3B2_L2_REQUIRES_DEMO_FIRESTORE_AND_AUTH_EMULATORS");
const admin=require("../functions/node_modules/firebase-admin");
if(!admin.apps.length)admin.initializeApp({projectId:PROJECT});
const db=admin.firestore();
const {createAttributionWriterHandler}=require("../functions/activitySalesAttributionWriter.js");
const {createSpecialPriceRequestHandler}=require("../functions/activitySalesSpecialPriceRequestWriter.js");
const {attributionDocumentId}=require("../functions/activitySalesAttributionContract.js");
const {specialPriceRequestId,checkedSpecialPriceRequest}=require("../functions/activitySalesSpecialPriceRequestContract.js");
const {dayLockDocumentId}=require("../functions/activitySalesSpecialPriceDayLock.js");
const prefix=brand=>brand==="cyj"?"artifacts/default-app-id/public/data":`brands/${brand}`;
const col=(_db,brand,name)=>db.collection(`${prefix(brand)}/${name}`);
const setting=(_db,brand,name)=>brand==="cyj"
  ?db.doc(`artifacts/default-app-id/public/data/global_settings/${name}`)
  :db.doc(`brands/${brand}/settings/${name}`);
const now=new Date("2026-10-09T06:00:00.000Z");
function res(){return {code:200,status(code){this.code=code;return this;},json(body){return {status:this.code,body}}};}
let seq=0;
async function seed(brand){
  const campaignId=`zero_mutex_${process.pid}_${++seq}_${Date.now()}`,versionId=`${campaignId}_v001`;
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
  const zeroCall=()=>ordinary({method:"POST",body:{...common,action:"confirm_zero",saleId:undefined,packageId:undefined,attributedAmount:undefined,expectedRevision:0}},res());
  const specialBody={...common,action:"request_special_price",actualAmount:8800,
    reasonCode:"special_discount",reasonNote:"客戶專案折扣",expectedRevision:0};
  // Catch malformed test fixtures BEFORE treating a 400 as a failed mutex transaction.
  assert.doesNotThrow(()=>checkedSpecialPriceRequest(specialBody),`${brand}: fixture must satisfy B3A input contract`);
  const specialCall=()=>special({method:"POST",body:specialBody},res());
  return {at,identity,zeroCall,specialCall};
}
test("B3B2-L2: concurrent zero confirmation and special request serialize on exact daily lock, all brands",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const f=await seed(brand);
    const responses=await Promise.all([f.zeroCall(),f.specialCall()]);
    assert.deepEqual(responses.map(x=>x.status).sort(),[200,409],
      `${brand}: zero and special must not coexist; codes=${responses.map(x=>x.body?.code||"OK")}`);
    const dayId=dayLockDocumentId(f.identity);
    const dayLock=await f.at("activity_sales_special_price_day_locks").doc(dayId).get();
    const daily=await f.at("activity_sales_daily_attributions").doc(dayId).get();
    const specialId=specialPriceRequestId(f.identity,"s001");
    const request=await f.at("activity_sales_special_price_requests").doc(specialId).get();
    assert.equal(dayLock.exists,request.exists,`${brand}: request+day lock atomic`);
    assert.notEqual(daily.exists,dayLock.exists,`${brand}: zero and day lock cannot coexist`);
    if(dayLock.exists){
      assert.equal(dayLock.data().state,"SPECIAL_PRICE_REQUESTED");
      assert.equal(dayLock.data().formalRevenueDelta,0);
      const retry=await f.zeroCall();
      assert.equal(retry.status,409,`${brand}: no zero after request`);
      assert.equal(retry.body.code,"ATTRIBUTION_SPECIAL_PRICE_DAY_LOCKED");
    }else{
      assert.equal(daily.data().status,"CONFIRMED_ZERO");
      const retry=await f.specialCall();
      assert.equal(retry.status,409,`${brand}: no request after zero`);
    }
    const formal=await f.at("therapist_daily_reports").doc("2026-10-08_T001").get();
    assert.equal(formal.data().totalRevenue,8800,`${brand}: formal report unchanged`);
  }
});
test("B3B2-L2: request before zero and zero before request both reject second writer",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    let f=await seed(brand);
    assert.equal((await f.specialCall()).status,200);
    assert.equal((await f.zeroCall()).status,409);
    f=await seed(brand);
    assert.equal((await f.zeroCall()).status,200);
    assert.equal((await f.specialCall()).status,409);
  }
});
