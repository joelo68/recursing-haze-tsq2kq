import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const project=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT||"";
if(!project.startsWith("demo-") || !process.env.FIRESTORE_EMULATOR_HOST)
  throw Error("Review transaction test requires explicit demo-* project and Firestore emulator");
const admin=require("../functions/node_modules/firebase-admin");
if(!admin.apps.length)admin.initializeApp({projectId:project});
const db=admin.firestore();
const {summaryDocumentId}=require("../functions/activitySalesAttributionWriterLogic.js");
const {createAttributionReviewHandler}=require("../functions/activitySalesAttributionReview.js");
let n=0;
const prefix=brand=>brand==="cyj"?"artifacts/default-app-id/public/data":`brands/${brand}`;
const col=(brand,name)=>db.collection(`${prefix(brand)}/${name}`);
async function fixture(brand){
  n++;
  const campaignId=`review_${process.pid}_${Date.now()}_${n}`,versionId=`${campaignId}_v001`,accountId=`T${n}`;
  const storeName=`${brand==="cyj"?"CYJ":brand==="anniu"?"安妞":"伊啵"}崇學店`;
  const subject={brandId:brand,campaignId,versionId,roleId:"therapist",accountId,reportDate:"2026-10-08"};
  await Promise.all([
    col(brand,"therapists").doc(accountId).set({id:accountId,store:storeName,status:"active"}),
    db.doc(`${prefix(brand)}/${brand==="cyj"?"global_settings":"settings"}/store_account_data`).set({accounts:[{id:"S001",stores:[storeName]},{id:"S002",stores:[storeName]}]}),
    col(brand,"therapist_daily_reports").doc(`2026-10-08_${accountId}`).set({brandId:brand,date:"2026-10-08",therapistId:accountId,storeName,totalRevenue:4800}),
    col(brand,"activity_sales_publications").doc(campaignId).set({brandId:brand,campaignId,versionId,status:"published",startDate:"2026-10-01",endDate:"2026-10-31"}),
    col(brand,"activity_campaign_versions").doc(versionId).set({brandId:brand,campaignId,versionId,campaignSnapshot:{startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"all",stores:[]}}),
    col(brand,"activity_sales_daily_attributions").doc(summaryDocumentId(subject)).set({schemaVersion:"activity-sales-daily-attribution-v1",...subject,storeCore:"崇學",revision:1,status:"HAS_SALES",saleCount:1,attributedAmount:4800,formalRevenueDelta:0}),
  ]);
  function caller(managerId="S001",stores=["崇學"],claimBrand=brand){
    const handler=createAttributionReviewHandler({admin,db,services:{
      getBrandCollection:(_db,b,name)=>col(b,name),
      getBrandSettingDoc:(_db,b,name)=>db.doc(`${prefix(b)}/${b==="cyj"?"global_settings":"settings"}/${name}`),
      requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:claimBrand,roleId:"store",accountId:managerId}}),
      verifyTrustedApplicationActor:async()=>({ok:true,actorRole:"store",actorAccountId:managerId,credential:{stores}}),
    }});
    return async(changes={})=>{
      const req={method:"POST",body:{action:"inspect",brandId:brand,subject,storeName,
        actor:{roleId:"store",accountId:managerId,deviceId:"dev",credentialPassword:"demo"},...changes}};
      const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){return {status:this.statusCode,body};}};
      return handler(req,res);
    };
  }
  return {subject,caller,dailyRef:col(brand,"activity_sales_daily_attributions").doc(summaryDocumentId(subject)),
    reportRef:col(brand,"therapist_daily_reports").doc(`2026-10-08_${accountId}`),
    reviewRef:col(brand,"activity_sales_attribution_reviews").doc(summaryDocumentId(subject))};
}
test("2A-4R1: 3-brand manager review real transactions; OCC, staleness, formal revenue unchanged",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const f=await fixture(brand),first=f.caller("S001"),second=f.caller("S002");
    let inspected=await first();
    assert.equal(inspected.status,200,brand);assert.equal(inspected.body.review.state,"UNREVIEWED");
    const base={action:"review",decision:"verified",expectedReviewRevision:0,expectedAttributionRevision:1,
      expectedReportUpdateVersion:inspected.body.reportUpdateVersion};
    const concurrent=await Promise.all([first(base),second(base)]);
    assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409],`${brand} OCC`);
    let current=await first();assert.equal(current.body.review.state,"CURRENT");
    assert.equal(current.body.review.reviewRevision,1);
    assert.equal((await f.reviewRef.get()).data().formalRevenueDelta,0);
    const replay=await (concurrent[0].status===200?first:second)(base);
    assert.equal(replay.body.state,"idempotent");
    await f.dailyRef.update({revision:2,attributedAmount:9600,saleCount:2});
    current=await first();assert.equal(current.body.review.state,"STALE",brand);
    assert.equal((await first({...base,expectedReviewRevision:1})).status,409);
    const fresh={...base,expectedReviewRevision:1,expectedAttributionRevision:2,
      expectedReportUpdateVersion:current.body.reportUpdateVersion};
    assert.equal((await first(fresh)).status,200);
    await f.reportRef.update({totalRevenue:5200});
    current=await first();assert.equal(current.body.review.state,"STALE",brand);
    assert.equal((await second({action:"review",decision:"verified",expectedReviewRevision:2,
      expectedAttributionRevision:2,expectedReportUpdateVersion:fresh.expectedReportUpdateVersion})).status,409);
    assert.equal((await second()).status,200);
    const daily=await f.dailyRef.get();assert.equal(daily.data().attributedAmount,9600);
    const formal=await f.reportRef.get();assert.equal(formal.data().totalRevenue,5200);
    assert.equal((await first({storeName:"CYJ其他店"})).status,403);
    assert.equal((await f.caller("S003",["其他"])()).status,403);
    assert.equal((await f.caller("S004",["崇學"],"anniu"===brand?"yibo":"anniu")()).status,403);
    assert.ok(f.reviewRef.path.startsWith(`${prefix(brand)}/`));
  }
});
