import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const project=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT||"";
if(!project.startsWith("demo-") || !process.env.FIRESTORE_EMULATOR_HOST)throw new Error("Reader integration test requires explicit demo-* project and Firestore emulator");
const admin=require("../functions/node_modules/firebase-admin");
if(!admin.apps.length)admin.initializeApp({projectId:project});
const db=admin.firestore();
const {createAttributionReaderHandler}=require("../functions/activitySalesAttributionReader.js");
const {summaryDocumentId}=require("../functions/activitySalesAttributionWriterLogic.js");
let n=0;
const path=(brand,name)=>`${brand==="cyj"?"artifacts/default-app-id/public/data":`brands/${brand}`}/${name}`;
test("2A-2: real Firestore read-only transaction, zero/unconfirmed and three-brand isolation",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    n++;
    const campaignId=`a2a2_${process.pid}_${Date.now()}_${n}`;
    const versionId=`${campaignId}_v001`,accountId=`T_${n}`;
    const storeName=`${brand==="cyj"?"CYJ":brand==="anniu"?"安妞":"伊啵"}崇學店`;
    const input={brandId:brand,campaignId,versionId,roleId:"therapist",accountId,reportDate:"2026-10-08"};
    const col=(name)=>db.collection(path(brand,name));
    await Promise.all([
      col("therapists").doc(accountId).set({id:accountId,store:storeName,status:"active"}),
      col("therapist_daily_reports").doc(`2026-10-08_${accountId}`).set({brandId:brand,date:"2026-10-08",therapistId:accountId,storeName}),
      col("activity_sales_publications").doc(campaignId).set({brandId:brand,status:"published",campaignId,versionId,startDate:"2026-10-01",endDate:"2026-10-31"}),
      col("activity_campaign_versions").doc(versionId).set({brandId:brand,campaignId,versionId,campaignSnapshot:{startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"all",stores:[]}}),
    ]);
    const handler=createAttributionReaderHandler({admin,db,services:{now:()=>new Date("2026-10-08T08:00:00.000Z"),
      getBrandCollection:(_db,brandId,name)=>db.collection(path(brandId,name)),
      requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:brand,roleId:"therapist",accountId}}),
      verifyTrustedApplicationActor:async()=>({ok:true,actorRole:"therapist",actorAccountId:accountId})}});
    const read=async()=>{
      const req={method:"POST",body:{...input,storeName,actor:{roleId:"therapist",accountId,deviceId:"demo",credentialPassword:"demo"}}};
      const res={statusCode:200,status(c){this.statusCode=c;return this;},json(b){return {status:this.statusCode,body:b};}};
      return handler(req,res);
    };
    let result=await read();assert.equal(result.status,200,brand);assert.equal(result.body.status,"UNCONFIRMED");assert.equal(result.body.attributedAmount,null);
    const dailyRef=col("activity_sales_daily_attributions").doc(summaryDocumentId(input));
    await dailyRef.set({schemaVersion:"activity-sales-daily-attribution-v1",...input,storeCore:"崇學",status:"CONFIRMED_ZERO",saleCount:0,attributedAmount:0,formalRevenueDelta:0,revision:1});
    result=await read();assert.equal(result.status,200,brand);assert.equal(result.body.status,"CONFIRMED_ZERO");assert.equal(result.body.attributedAmount,0);
    assert.equal(result.body.formalRevenueDelta,0);
    assert.equal((await col("therapist_daily_reports").doc(`2026-10-08_${accountId}`).get()).data().attributedAmount,undefined);
    await dailyRef.update({status:"HAS_SALES",saleCount:1,attributedAmount:9800,revision:2});
    result=await read();assert.equal(result.status,200,brand);assert.equal(result.body.attributedAmount,9800);
  }
});
