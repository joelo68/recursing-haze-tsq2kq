import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const project=process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
if (!project.startsWith("demo-") || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Phase 2A-1 transaction test requires explicit demo project + Firestore Emulator");
}
const admin=require("../functions/node_modules/firebase-admin");
if(!admin.apps.length)admin.initializeApp({projectId:project});
const db=admin.firestore();
const {createAttributionWriterHandler}=require("../functions/activitySalesAttributionWriter.js");
const today=new Date("2026-10-08T08:00:00.000Z");
const prefix=(brand)=>brand==="cyj"?"artifacts/default-app-id/public/data":`brands/${brand}`;
const getBrandCollection=(_db,brand,collection)=>db.collection(`${prefix(brand)}/${collection}`);
let sequence=0;
async function seed(brand){
  sequence++;
  const campaignId=`a2a1_${process.pid}_${sequence}_${Date.now()}`;
  const versionId=`${campaignId}_v001`;
  const base=(name)=>getBrandCollection(db,brand,name);
  const person="T001",storeName=brand==="cyj"?"CYJ崇學店":brand==="anniu"?"安妞崇學店":"伊啵崇學店";
  await Promise.all([
    base("therapists").doc(person).set({id:person,name:"demo",store:storeName,status:"active"}),
    base("therapist_daily_reports").doc(`2026-10-08_${person}`).set({brandId:brand,date:"2026-10-08",therapistId:person,storeName,totalRevenue:19600}),
    base("activity_sales_publications").doc(campaignId).set({status:"published",brandId:brand,campaignId,versionId,startDate:"2026-10-01",endDate:"2026-10-31"}),
    base("activity_campaign_versions").doc(versionId).set({brandId:brand,campaignId,versionId,campaignSnapshot:{startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"all",stores:[],packages:[{packageId:"pkg",salePrice:9800}]}})
  ]);
  const handler=createAttributionWriterHandler({admin,db,services:{now:()=>today,getBrandCollection,
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:brand,roleId:"therapist",accountId:person}}),
    verifyTrustedApplicationActor:async()=>({ok:true,actorRole:"therapist",actorAccountId:person})}});
  const call=async(changes={})=>{
    const req={method:"POST",body:{action:"record_sale",brandId:brand,campaignId,versionId,reportDate:"2026-10-08",storeName,
      saleId:"s001",packageId:"pkg",quantity:1,attributedAmount:9800,expectedRevision:0,
      actor:{roleId:"therapist",accountId:person,deviceId:"dev",credentialPassword:"test"},...changes}};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){return{status:this.statusCode,body};}};
    return handler(req,res);
  };
  return {base,call};
}
test("Phase 2A-1: real Firestore emulator transaction, CYJ/Anniu/Yibo tenant isolation + OCC",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const f=await seed(brand);
    const concurrent=await Promise.all([f.call(),f.call({saleId:"s002"})]);
    assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409],`${brand} OCC`);
    const success=concurrent.find(r=>r.status===200);
    assert.equal(success.body.formalRevenueDelta,0);
    assert.equal((await f.call({saleId:"s003",expectedRevision:1})).status,200);
    const daily=await f.base("activity_sales_daily_attributions").get();
    const matching=daily.docs.filter(s=>s.data().campaignId===success.body.campaignId);
    assert.equal(matching.length,1,brand);
    assert.equal(matching[0].data().saleCount,2);
    assert.equal(matching[0].data().attributedAmount,19600);
    const formal=await f.base("therapist_daily_reports").doc("2026-10-08_T001").get();
    assert.equal(formal.data().totalRevenue,19600,"formal revenue must stay untouched");
  }
});
