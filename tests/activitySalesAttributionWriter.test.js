import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAttributionWriterHandler}=require("../functions/activitySalesAttributionWriter.js");
const logic=require("../functions/activitySalesAttributionWriterLogic.js");
const frozen=new Date("2026-10-08T08:00:00.000Z"); // Taipei 16:00
const base={action:"record_sale",brandId:"cyj",campaignId:"act01",versionId:"act01_v001",
  reportDate:"2026-10-08",storeName:"CYJ崇學店",saleId:"s001",packageId:"pkg01",quantity:1,attributedAmount:9800,
  expectedRevision:0,actor:{roleId:"therapist",accountId:"T001",deviceId:"dev01",credentialPassword:"secret"}};
const prefix=(brand)=>brand==="cyj"?"artifacts/default-app-id/public/data":`brands/${brand}`;
const stamp={firestore:{FieldValue:{serverTimestamp:()=>"<server-timestamp>"}}};
function fixture({brand="cyj",role="therapist",account="T001",storeName="CYJ崇學店",masterStore="崇學",
  allowedStores=["崇學"],claimsBrand=brand,trusted=true,publicationVersion="act01_v001",report=true,
  version=true,packages=[{packageId:"pkg01",salePrice:9800}],storeScope="selected",versionScopeStores=["崇學"]}={}){
  const docs=new Map(),writes=[];
  const init=(col,id,data)=>docs.set(`${prefix(brand)}/${col}/${id}`,data);
  init("activity_sales_publications","act01",{status:"published",brandId:brand,campaignId:"act01",versionId:publicationVersion,
    startDate:"2026-10-01",endDate:"2026-10-31"});
  if(version)init("activity_campaign_versions","act01_v001",{brandId:brand,campaignId:"act01",versionId:"act01_v001",
    campaignSnapshot:{startDate:"2026-10-01",endDate:"2026-10-31",packages,storeScope,stores:versionScopeStores}});
  if(report)init(role==="therapist"?"therapist_daily_reports":"daily_reports",`2026-10-08_${role==="therapist"?account:storeName}`,
    {brandId:brand,date:"2026-10-08",storeName,therapistId:role==="therapist"?account:undefined,totalRevenue:9800});
  if(role==="therapist")init("therapists",account,{id:account,store:masterStore,status:"active"});
  const col=(_db,b,name)=>({doc:(id)=>({path:`${prefix(b)}/${name}/${id}`, async get(){return snap(docs.get(this.path));}})});
  const snap=(data)=>({exists:data!==undefined,data:()=>data});
  const db={runTransaction:async(fn)=>{
    const staged=[];
    const result=await fn({get:async ref=>snap(docs.get(ref.path)),
      create:(ref,data)=>staged.push({op:"create",ref,data}),set:(ref,data,options)=>staged.push({op:"set",ref,data,options})});
    for(const op of staged){if(op.op==="create"&&docs.has(op.ref.path))throw new Error("DUPLICATE_CREATE");
      docs.set(op.ref.path,op.data);writes.push(op);}
    return result;
  }};
  const handler=createAttributionWriterHandler({admin:stamp,db,services:{now:()=>frozen,
    getBrandCollection:col,
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",
      brandId:claimsBrand,roleId:role,accountId:account}}),
    verifyTrustedApplicationActor:async()=>trusted?{ok:true,actorRole:role,actorAccountId:account,
      credential:{stores:allowedStores}}:{ok:false}
  }});
  const call=async(override={})=>{
    const req={method:"POST",body:{...base,brandId:brand,storeName,actor:{...base.actor,roleId:role,accountId:account},...override}};
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(payload){return{status:this.statusCode,body:payload};}};
    return handler(req,res);
  };
  return {docs,writes,call};
}
test("report anchor and canonical therapist master; no writes into formal revenue",async()=>{
  const f=fixture(),response=await f.call();assert.equal(response.status,200);
  assert.equal(response.body.revision,1);assert.equal(response.body.formalRevenueDelta,0);
  assert.equal(f.writes.length,3);assert.deepEqual(f.writes.map(x=>x.ref.path.split("/").at(-2)).sort(),
    ["activity_sales_attribution_sales","activity_sales_daily_attributions","activity_sales_attribution_audit"].sort());
  const doc=[...f.docs.entries()].find(([key])=>key.includes("activity_sales_daily_attributions/"))[1];
  assert.equal(doc.status,"HAS_SALES");assert.equal(doc.saleCount,1);assert.equal(doc.attributedAmount,9800);
});
test("duplicate same sale is idempotent; changed data denied even with same saleId",async()=>{
  const f=fixture();await f.call();let r=await f.call();assert.equal(r.status,200);assert.equal(r.body.state,"idempotent");assert.equal(f.writes.length,3);
  r=await f.call({attributedAmount:1000});assert.equal(r.status,409);assert.equal(r.body.code,"ATTRIBUTION_PRICE_MISMATCH");assert.equal(f.writes.length,3);
});
test("revision OCC prevents concurrent second sale at stale revision",async()=>{
  const f=fixture();await f.call();let r=await f.call({saleId:"s002"});assert.equal(r.status,409);assert.equal(r.body.code,"ATTRIBUTION_REVISION_CONFLICT");
  r=await f.call({saleId:"s002",expectedRevision:1});assert.equal(r.status,200);assert.equal(r.body.revision,2);assert.equal(r.body.attributedAmount,19600);
});
test("explicit zero is durable and cannot become a sale silently",async()=>{
  const f=fixture();let r=await f.call({action:"confirm_zero",saleId:undefined,packageId:undefined,attributedAmount:undefined});
  assert.equal(r.status,200);assert.equal(r.body.status,"CONFIRMED_ZERO");assert.equal(r.body.saleCount,0);assert.equal(f.writes.length,2);
  r=await f.call({expectedRevision:1});assert.equal(r.status,409);assert.equal(r.body.code,"ATTRIBUTION_ZERO_LOCKED");
});
test("no report remains UNCONFIRMED: fail closed, zero cannot be assumed",async()=>{
  const f=fixture({report:false});const r=await f.call({action:"confirm_zero",saleId:undefined,packageId:undefined,attributedAmount:undefined});
  assert.equal(r.status,409);assert.equal(r.body.code,"ATTRIBUTION_REPORT_NOT_SUBMITTED");assert.equal(f.writes.length,0);
});
test("claim brand mismatch denies before any write",async()=>{
  const f=fixture({claimsBrand:"anniu"});const r=await f.call();assert.equal(r.status,403);
  assert.equal(r.body.code,"ACTIVITY_SESSION_MISMATCH");assert.equal(f.writes.length,0);
});
test("untrusted actor and wrong therapist store denied",async()=>{
  const bad=fixture({trusted:false});assert.equal((await bad.call()).status,403);assert.equal(bad.writes.length,0);
  const store=fixture({masterStore:"中美"});let r=await store.call();assert.equal(r.status,403);assert.equal(r.body.code,"ATTRIBUTION_STORE_FORBIDDEN");
});
test("store account must own exact store, anchors canonical daily report",async()=>{
  const f=fixture({brand:"anniu",role:"store",account:"S001",storeName:"安妞A店",allowedStores:["A"] ,versionScopeStores:["A"]});
  let r=await f.call({saleId:"s301"});assert.equal(r.status,200);
  assert.equal(f.writes.every(x=>x.ref.path.startsWith("brands/anniu/")),true);
  const fail=fixture({brand:"yibo",role:"store",account:"S001",storeName:"伊啵A店",allowedStores:["B"],versionScopeStores:["A"]});
  r=await fail.call();assert.equal(r.status,403);assert.equal(fail.writes.length,0);
});
test("published-version mismatch and removed package fail closed",async()=>{
  const mismatched=fixture({publicationVersion:"act01_v002"});let r=await mismatched.call();assert.equal(r.status,409);assert.equal(r.body.code,"ATTRIBUTION_PUBLICATION_CHANGED");
  const missing=fixture({packages:[]});r=await missing.call();assert.equal(r.status,409);assert.equal(r.body.code,"ATTRIBUTION_PACKAGE_INVALID");
});
test("record amounts must derive from version salePrice; reject arbitrary amount",async()=>{
  const f=fixture();const r=await f.call({attributedAmount:8000});assert.equal(r.status,409);assert.equal(r.body.code,"ATTRIBUTION_PRICE_MISMATCH");assert.equal(f.writes.length,0);
});
test("Taipei report cutoff enforced without relying on browser clock",()=>{
  assert.throws(()=>logic.ensureReportDateAllowed("2026-10-08",new Date("2026-10-08T06:59:00Z")),/ATTRIBUTION_BEFORE_REPORT_WINDOW/);
  assert.doesNotThrow(()=>logic.ensureReportDateAllowed("2026-10-08",new Date("2026-10-08T07:00:00Z")));
  assert.throws(()=>logic.ensureReportDateAllowed("2026-10-09",frozen),/ATTRIBUTION_FUTURE_DATE/);
});
test("invalid or missing OCC is not silently defaulted",async()=>{
  const f=fixture();let r=await f.call({expectedRevision:undefined});assert.equal(r.status,400);
  r=await f.call({action:"unknown"});assert.equal(r.status,400);assert.equal(f.writes.length,0);
});
test("special store name 新店 is normalized without dropping identity",()=>{
  assert.equal(logic.coreStore("CYJ新店店"),"新店");
  assert.equal(logic.coreStore("新店"),"新店");
  assert.equal(logic.coreStore("CYJ新"),"新店");
  assert.notEqual(logic.coreStore("新店"),logic.coreStore("中美"));
});
test("path injection from account identity and unauthorized selected store rejected",async()=>{
  const f=fixture();const path=await f.call({actor:{roleId:"therapist",accountId:"T001/../bad",deviceId:"dev",credentialPassword:"secret"}});
  assert.equal(path.status,400);assert.equal(path.body.code,"ATTRIBUTION_ACCOUNT_PATH_INVALID");
  const other=fixture({versionScopeStores:["中美"]});const r=await other.call();assert.equal(r.status,403);
  assert.equal(r.body.code,"ATTRIBUTION_STORE_NOT_ELIGIBLE");assert.equal(other.writes.length,0);
});
