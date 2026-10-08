import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const project=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT||"";
if(!project.startsWith("demo-") || !process.env.FIRESTORE_EMULATOR_HOST)
  throw Error("R2B pagination integration test requires demo-* project and Firestore emulator");
const admin=require("../functions/node_modules/firebase-admin");
if(!admin.apps.length)admin.initializeApp({projectId:project});
const db=admin.firestore();
const {summaryDocumentId}=require("../functions/activitySalesAttributionWriterLogic.js");
const {createAttributionReviewInboxHandler}=require("../functions/activitySalesAttributionReviewInbox.js");
const prefix=brand=>brand==="cyj"?"artifacts/default-app-id/public/data":`brands/${brand}`;
const collection=(brand,name)=>db.collection(`${prefix(brand)}/${name}`);
const frozen=new Date("2026-10-08T11:00:00.000Z");
let seq=0;
async function fixture(brand){
  seq++;
  const storeName=`${brand==="cyj"?"CYJ":brand==="anniu"?"安妞":"伊啵"}崇學店`;
  const campaignId=`pager${process.pid}${seq}${Date.now()}`,versionId=`${campaignId}_v001`,reportDate="2026-10-08";
  const accountRef=db.doc(`${prefix(brand)}/${brand==="cyj"?"global_settings":"settings"}/store_account_data`);
  await accountRef.set({accounts:[{id:"S001",stores:[storeName],isActive:true}]});
  await Promise.all([
    collection(brand,"activity_sales_publications").doc(campaignId).set({brandId:brand,campaignId,versionId,status:"published",startDate:"2026-10-01",endDate:"2026-10-31"}),
    collection(brand,"activity_campaign_versions").doc(versionId).set({brandId:brand,campaignId,versionId,campaignSnapshot:{startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"all",stores:[]}}),
  ]);
  const batch=db.batch();
  for(let i=1;i<=16;i++){
    const accountId=`T${String(i).padStart(3,"0")}`;
    const subject={brandId:brand,campaignId,versionId,roleId:"therapist",accountId,reportDate};
    batch.set(collection(brand,"therapists").doc(accountId),{id:accountId,store:storeName,status:"active"});
    batch.set(collection(brand,"activity_sales_daily_attributions").doc(summaryDocumentId(subject)),
      {schemaVersion:"activity-sales-daily-attribution-v1",...subject,storeCore:"崇學",revision:1,
        status:i===1?"HAS_SALES":"CONFIRMED_ZERO",saleCount:i===1?1:0,attributedAmount:i===1?9800:0,formalRevenueDelta:0});
  }
  await batch.commit();
  const handler=createAttributionReviewInboxHandler({admin,db,services:{now:()=>frozen,
    getBrandCollection:(_db,id,name)=>collection(id,name),
    getBrandSettingDoc:(_db,id,name)=>db.doc(`${prefix(id)}/${id==="cyj"?"global_settings":"settings"}/${name}`),
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:brand,roleId:"store",accountId:"S001"}}),
    verifyTrustedApplicationActor:async()=>({ok:true,actorRole:"store",actorAccountId:"S001",credential:{stores:[storeName]}}),
  }});
  const call=async changes=>{
    const req={method:"POST",body:{action:"list_candidates",brandId:brand,storeName,reportDate,
      actor:{roleId:"store",accountId:"S001",deviceId:"demo",credentialPassword:"demo"},...changes}};
    const res={statusCode:200,status(v){this.statusCode=v;return this;},json(body){return {status:this.statusCode,body};}};
    return handler(req,res);
  };
  return {call,accountRef};
}
test("R2B: three-brand real Firestore composite-index cursor paging and permission recheck",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const f=await fixture(brand);
    const first=await f.call();assert.equal(first.status,200,`${brand}: ${first.body.code}`);
    assert.equal(first.body.candidates.length,12);assert.equal(first.body.hasMore,true);
    assert.ok(first.body.nextCursor);assert.equal(first.body.brandId,brand);
    const second=await f.call({cursor:first.body.nextCursor});assert.equal(second.status,200,`${brand}: ${second.body.code}`);
    assert.equal(second.body.candidates.length,4);assert.equal(second.body.hasMore,false);
    const found=[...first.body.candidates,...second.body.candidates];
    assert.equal(new Set(found.map(x=>x.accountId)).size,16);
    assert.ok(found.every(x=>x.formalRevenueDelta===0));
    assert.equal((await f.call({cursor:first.body.nextCursor,storeName:"其他店"})).status,400);
    await f.accountRef.set({accounts:[{id:"S001",stores:["其他店"],isActive:true}]});
    assert.equal((await f.call({cursor:first.body.nextCursor})).status,403);
    assert.equal((await f.call()).status,403);
  }
});
