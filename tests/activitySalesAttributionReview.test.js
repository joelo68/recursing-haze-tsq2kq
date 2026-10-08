import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAttributionReviewHandler}=require("../functions/activitySalesAttributionReview.js");
const {summaryDocumentId}=require("../functions/activitySalesAttributionWriterLogic.js");
const {normalizedReview}=require("../functions/activitySalesAttributionReviewLogic.js");
const brandPrefix=b=>b==="cyj"?"artifacts/default-app-id/public/data":`brands/${b}`;
const frozen=new Date("2026-10-08T08:00:00Z");
function fixture({brand="cyj",claimBrand=brand,subjectStore="CYJ崇學店",allowedStores=["崇學"],
  report=true,summary=true,currentVersion="act01_v001",trusted=true,actorRole="store",recordStatus="HAS_SALES"}={}) {
  const documents=new Map();let timestamp=1790000000000;let writes=[];
  const subject={brandId:brand,roleId:"therapist",accountId:"T001",reportDate:"2026-10-08",campaignId:"act01",versionId:"act01_v001"};
  const id=summaryDocumentId(subject);
  const key=(collection,doc)=>`${brandPrefix(brand)}/${collection}/${doc}`;
  function seed(collection,doc,data){documents.set(key(collection,doc),{data,stamp:++timestamp});}
  seed("therapists","T001",{id:"T001",store:subjectStore,status:"active"});
  seed(brand==="cyj"?"global_settings":"settings","store_account_data",{accounts:[{id:"S001",stores:allowedStores},{id:"S002",stores:allowedStores}]});
  if(report)seed("therapist_daily_reports","2026-10-08_T001",{brandId:brand,date:"2026-10-08",therapistId:"T001",storeName:subjectStore,totalRevenue:10000});
  seed("activity_sales_publications","act01",{brandId:brand,status:"published",campaignId:"act01",versionId:currentVersion,startDate:"2026-10-01",endDate:"2026-10-31"});
  seed("activity_campaign_versions","act01_v001",{brandId:brand,campaignId:"act01",versionId:"act01_v001",campaignSnapshot:{startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"all",stores:[]}});
  if(summary)seed("activity_sales_daily_attributions",id,{schemaVersion:"activity-sales-daily-attribution-v1",...subject,
    storeCore:"崇學",formalRevenueDelta:0,revision:1,status:recordStatus,saleCount:recordStatus==="HAS_SALES"?1:0,
    attributedAmount:recordStatus==="HAS_SALES"?9800:0});
  const snap=(r)=>{const doc=documents.get(r.path);return {exists:!!doc,data:()=>doc?.data,updateTime:doc?{seconds:Math.floor(doc.stamp/1000),nanoseconds:(doc.stamp%1000)*1000000}:undefined};};
  const db={runTransaction:async fn=>{const queued=[];const res=await fn({get:async ref=>snap(ref),
    set:(ref,data)=>queued.push({op:"set",ref,data}),create:(ref,data)=>queued.push({op:"create",ref,data})});
    for(const w of queued){if(w.op==="create"&&documents.has(w.ref.path))throw Error("DUPLICATE_AUDIT");
      documents.set(w.ref.path,{data:w.data,stamp:++timestamp});writes.push(w);}
    return res;}};
  const handler=createAttributionReviewHandler({admin:{firestore:{FieldValue:{serverTimestamp:()=>"stamp"}}},db,services:{now:()=>frozen,
    getBrandCollection:(_db,b,name)=>({doc:(id)=>({path:`${brandPrefix(b)}/${name}/${id}`})}),
    getBrandSettingDoc:(_db,b,name)=>({path:`${brandPrefix(b)}/${b==="cyj"?"global_settings":"settings"}/${name}`}),
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:claimBrand,roleId:actorRole,accountId:"S001"}}),
    verifyTrustedApplicationActor:async()=>trusted?{ok:true,actorRole,actorAccountId:"S001",credential:{stores:allowedStores}}:{ok:false}}});
  const call=async changes=>{
    const req={method:"POST",body:{action:"inspect",brandId:brand,subject,storeName:subjectStore,
      actor:{roleId:actorRole,accountId:"S001",deviceId:"dev",credentialPassword:"test"},...changes}};
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){return {status:this.statusCode,body};}};
    return handler(req,res);
  };
  return {documents,writes,subject,id,call,seed};
}
test("store manager inspects exact therapist report; no writes or revenue mutation",async()=>{
  const f=fixture();const r=await f.call();assert.equal(r.status,200);assert.equal(r.body.status,"HAS_SALES");
  assert.equal(r.body.attributedAmount,9800);assert.equal(r.body.review.state,"UNREVIEWED");assert.equal(r.body.formalRevenueDelta,0);
  assert.equal(f.writes.length,0);
});
test("store manager verifies immutable snapshot and writes only review + audit",async()=>{
  const f=fixture();const before=await f.call();const r=await f.call({action:"review",decision:"verified",expectedAttributionRevision:1,
    expectedReviewRevision:0,expectedReportUpdateVersion:before.body.reportUpdateVersion});
  assert.equal(r.status,200);assert.equal(r.body.state,"written");assert.equal(f.writes.length,2);
  assert.deepEqual(f.writes.map(w=>w.ref.path.split("/").at(-2)).sort(),
    ["activity_sales_attribution_reviews","activity_sales_attribution_review_audit"].sort());
  const after=await f.call();assert.equal(after.body.review.state,"CURRENT");assert.equal(after.body.review.decision,"verified");
  assert.equal(f.documents.get(`${brandPrefix('cyj')}/therapist_daily_reports/2026-10-08_T001`).data.totalRevenue,10000);
});
test("flag is a non-mutating review state with fixed reason enum",async()=>{
  const f=fixture({recordStatus:"CONFIRMED_ZERO"});const inspected=await f.call();assert.equal(inspected.body.attributedAmount,0);
  const r=await f.call({action:"review",decision:"flagged",reason:"AMOUNT_RECHECK",expectedReviewRevision:0,
    expectedAttributionRevision:1,expectedReportUpdateVersion:inspected.body.reportUpdateVersion});
  assert.equal(r.status,200);assert.equal((await f.call()).body.review.reason,"AMOUNT_RECHECK");
  assert.equal((await f.call({action:"review",decision:"flagged",reason:"secret info",expectedReviewRevision:0,
    expectedAttributionRevision:1,expectedReportUpdateVersion:inspected.body.reportUpdateVersion})).status,400);
});
test("same reviewer exact retry is idempotent; different decision needs fresh review OCC",async()=>{
  const f=fixture();const i=await f.call();const request={action:"review",decision:"verified",expectedReviewRevision:0,
    expectedAttributionRevision:1,expectedReportUpdateVersion:i.body.reportUpdateVersion};
  assert.equal((await f.call(request)).body.state,"written");assert.equal((await f.call(request)).body.state,"idempotent");
  assert.equal(f.writes.length,2);
  let r=await f.call({...request,decision:"flagged",reason:"OWNER_RECHECK"});assert.equal(r.status,409);
  r=await f.call({...request,expectedReviewRevision:1,decision:"flagged",reason:"OWNER_RECHECK"});assert.equal(r.status,200);
  assert.equal((await f.call()).body.review.reviewRevision,2);
});
test("sale revision increase and formal report overwrite invalidate review without modifying sales",async()=>{
  const f=fixture();let i=await f.call();await f.call({action:"review",decision:"verified",expectedReviewRevision:0,
    expectedAttributionRevision:1,expectedReportUpdateVersion:i.body.reportUpdateVersion});
  const daily=f.documents.get(`${brandPrefix('cyj')}/activity_sales_daily_attributions/${f.id}`);
  f.seed("activity_sales_daily_attributions",f.id,{...daily.data,revision:2,saleCount:2,attributedAmount:19600});
  i=await f.call();assert.equal(i.body.review.state,"STALE");assert.equal(i.body.review.reviewRevision,1);
  assert.equal((await f.call({action:"review",decision:"verified",expectedReviewRevision:1,expectedAttributionRevision:1,
    expectedReportUpdateVersion:i.body.reportUpdateVersion})).status,409);
  const report=f.documents.get(`${brandPrefix('cyj')}/therapist_daily_reports/2026-10-08_T001`);
  const r=await f.call({action:"review",decision:"verified",expectedReviewRevision:1,expectedAttributionRevision:2,
    expectedReportUpdateVersion:i.body.reportUpdateVersion});assert.equal(r.status,200);
  f.seed("therapist_daily_reports","2026-10-08_T001",{...report.data,totalRevenue:10200});
  i=await f.call();assert.equal(i.body.review.state,"STALE");
});
test("unconfirmed has no zero and cannot be reviewed",async()=>{
  const f=fixture({summary:false});const i=await f.call();assert.equal(i.body.status,"UNCONFIRMED");
  assert.equal(i.body.saleCount,null);const r=await f.call({action:"review",decision:"verified",expectedReviewRevision:0,
    expectedAttributionRevision:1,expectedReportUpdateVersion:i.body.reportUpdateVersion});
  assert.equal(r.status,409);assert.equal(r.body.code,"ATTRIBUTION_REVIEW_UNCONFIRMED");assert.equal(f.writes.length,0);
});
test("cross-brand claim, untrusted, district manager, or unauthorized store denied",async()=>{
  for(const options of [{claimBrand:"anniu"},{trusted:false},{actorRole:"manager"},{allowedStores:["其他"]}]){
    const f=fixture(options);const r=await f.call();assert.equal(r.status,403,JSON.stringify(options));assert.equal(f.writes.length,0);
  }
});
test("therapist master must match allowed store, no report and old version fail closed",async()=>{
  for(const options of [{subjectStore:"CYJ中美店",allowedStores:["崇學"]},{report:false},{currentVersion:"act01_v002"}]){
    const f=fixture(options);const r=await f.call();assert.ok([403,409].includes(r.status),JSON.stringify(options));assert.equal(f.writes.length,0);
  }
});
test("three-brand isolation uses CYJ legacy and branded namespace",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const f=fixture({brand});const i=await f.call();assert.equal(i.status,200);
    const r=await f.call({action:"review",decision:"verified",expectedAttributionRevision:1,expectedReviewRevision:0,
      expectedReportUpdateVersion:i.body.reportUpdateVersion});assert.equal(r.status,200);
    assert.ok(f.writes.every(w=>w.ref.path.startsWith(`${brandPrefix(brand)}/`)),brand);
  }
});
test("review data contract fails closed on forged or malformed review record",()=>{
  const identity={brandId:"cyj",campaignId:"act01",versionId:"act01_v001",roleId:"therapist",accountId:"T001",reportDate:"2026-10-08"};
  assert.throws(()=>normalizedReview({schemaVersion:"not-review"},identity,"崇學",1,5000),/ATTRIBUTION_REVIEW_DATA_INVALID/);
});
test("invalid request rejects path injection, missing OCC, and self-as-reviewer",async()=>{
  const f=fixture();const i=await f.call();for(const opts of [
    {subject:{...f.subject,accountId:"../../oops"}},
    {action:"review",decision:"verified",expectedAttributionRevision:1,expectedReviewRevision:0},
    {actor:{roleId:"therapist",accountId:"T001",deviceId:"dev",credentialPassword:"x"}}
  ]){
    const r=await f.call(opts);assert.ok([400,403].includes(r.status),r.body.code);
  }
  assert.match(i.body.reportUpdateVersion,/^\d{10,}:\d{9}$/);
});
test("report version uses full nanosecond precision, not rounded milliseconds",()=>{
  const identity={brandId:"cyj",campaignId:"act01",versionId:"act01_v001",roleId:"therapist",accountId:"T001",reportDate:"2026-10-08"};
  const doc={schemaVersion:"activity-sales-attribution-review-v1",...identity,storeCore:"崇學",formalRevenueDelta:0,
    reviewRevision:1,attributionRevision:1,reportUpdateVersion:"1790000000:100000001",decision:"verified",reason:""};
  assert.equal(normalizedReview(doc,identity,"崇學",1,"1790000000:100000001").state,"CURRENT");
  assert.equal(normalizedReview(doc,identity,"崇學",1,"1790000000:100000002").state,"STALE");
});

test("manager store assignment revoked at transaction time denies review despite earlier trusted check",async()=>{
  const f=fixture();f.seed("global_settings","store_account_data",{accounts:[{id:"S001",stores:["其他"]}]});
  const r=await f.call();assert.equal(r.status,403);assert.equal(f.writes.length,0);
});
