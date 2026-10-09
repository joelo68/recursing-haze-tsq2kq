import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createLifecycleRequestHandler}=require("../functions/activitySalesLifecycleRequestWriter.js");
const {attributionDocumentId}=require("../functions/activitySalesAttributionContract.js");
const {summaryDocumentId}=require("../functions/activitySalesAttributionWriterLogic.js");
const NOW=new Date("2026-10-09T00:00:00.000Z");
const fakeAdmin={firestore:{FieldValue:{serverTimestamp:()=>"SERVER_TS"}}};
const core={campaignId:"act01",versionId:"act01_v001",reportDate:"2026-10-08",saleId:"s001"};
const prefix=brand=>brand==="cyj"?"artifacts/default-app-id/public/data":`brands/${brand}`;
const spySnap=data=>({exists:data!==undefined,data:()=>data});
function setup({brand="cyj",role="therapist",account="T001",storeName="CYJ崇學店",masterStore="崇學",stores=["崇學"],
  trusted=true,claimsBrand=brand,revoked=false,hasReport=true,hasSale=true,hasDaily=true,versionPrice=9800,reportBrand=brand}={}){
  const docs=new Map(),writes=[],attempted=[];
  const key=(name,id)=>`${prefix(brand)}/${name}/${id}`;
  const put=(name,id,data)=>docs.set(key(name,id),data);
  const identity={brandId:brand,roleId:role,accountId:account,...core};
  const saleId=attributionDocumentId(identity,"s001");
  const reportName=role==="therapist"?"therapist_daily_reports":"daily_reports";
  if(hasReport)put(reportName,`2026-10-08_${role==="therapist"?account:storeName}`,
    {brandId:reportBrand,date:"2026-10-08",storeName,therapistId:role==="therapist"?account:undefined});
  if(role==="therapist")put("therapists",account,{id:account,store:masterStore,status:"active"});
  if(role==="store")put("settings","store_account_data",{accounts:[{id:account,stores:revoked?[]:stores,isActive:!revoked}]});
  if(hasSale)put("activity_sales_attribution_sales",saleId,{...identity,packageId:"pkg01",quantity:1,
    attributedAmount:9800,formalRevenueDelta:0,storeCore:masterStore});
  if(hasDaily)put("activity_sales_daily_attributions",summaryDocumentId(identity),{...identity,storeCore:masterStore,
    status:"HAS_SALES",revision:1,saleCount:1,attributedAmount:9800,formalRevenueDelta:0});
  put("activity_campaign_versions","act01_v001",{brandId:brand,campaignId:"act01",versionId:"act01_v001",
    campaignSnapshot:{startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"selected",stores:["崇學"],
      packages:[{packageId:"pkg01",salePrice:versionPrice},{packageId:"pkg02",salePrice:10500}]}});
  const ref=path=>({path,id:path.slice(path.lastIndexOf("/")+1)});
  const col=(_db,b,name)=>({doc:id=>ref(`${prefix(b)}/${name}/${id}`)});
  const db={runTransaction:async fn=>{
    const staged=[];
    const result=await fn({get:async r=>spySnap(docs.get(r.path)),create:(r,data)=>staged.push({r,data})});
    for(const {r} of staged)if(docs.has(r.path))throw new Error("DUPLICATE_CREATE");
    staged.forEach(({r,data})=>{docs.set(r.path,data);writes.push({path:r.path,data});});
    return result;
  }};
  const handler=createLifecycleRequestHandler({admin:fakeAdmin,db,services:{now:()=>NOW,getBrandCollection:col,
    getBrandSettingDoc:(_db,b,id)=>ref(`${prefix(b)}/settings/${id}`),
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",
      brandId:claimsBrand,roleId:role,accountId:account}}),
    verifyTrustedApplicationActor:async()=>trusted?{ok:true,actorRole:role,actorAccountId:account,credential:{stores}}:{ok:false}}});
  const event={...identity,eventId:"evt001",kind:"REFUND",eventDate:"2026-10-09",expectedEventRevision:0,
    reasonCode:"customer_request",reasonNote:"",refundAmount:1000,formalRevenueDelta:0};
  const actor={roleId:role,accountId:account,deviceId:"dev01",credentialPassword:"secret"};
  const call=async(override={})=>{
    const request={method:"POST",body:{action:"request_lifecycle",actor,storeName,event,...override}};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){return {status:this.statusCode,body};}};
    attempted.push(request);
    return handler(request,res);
  };
  return {docs,writes,attempted,call,event,identity};
}
test("creates only two private PENDING documents, keeps original sale and revenue unchanged",async()=>{
  const f=setup(),original=f.docs.get(`${prefix("cyj")}/activity_sales_attribution_sales/${attributionDocumentId(f.identity,"s001")}`);
  const result=await f.call();assert.equal(result.status,200);assert.equal(result.body.state,"requested");
  assert.equal(result.body.formalRevenueDelta,0);assert.equal(result.body.officialKpiAllocation,"UNDECIDED");
  assert.deepEqual(f.writes.map(x=>x.path.split("/").at(-2)).sort(),
    ["activity_sales_lifecycle_request_state","activity_sales_lifecycle_requests"].sort());
  assert.strictEqual(f.docs.get(`${prefix("cyj")}/activity_sales_attribution_sales/${attributionDocumentId(f.identity,"s001")}`),original);
  assert.ok(f.writes.every(x=>x.data.formalRevenueDelta===0));
  assert.ok(f.writes.every(x=>x.data.state==="PENDING_REVIEW"));
});
test("identical Event ID retry is idempotent, altered replay denied",async()=>{
  const f=setup();await f.call();const r=await f.call();assert.equal(r.status,200);assert.equal(r.body.state,"idempotent");assert.equal(f.writes.length,2);
  const c=await f.call({event:{...f.event,refundAmount:1001}});assert.equal(c.status,409);
  assert.equal(c.body.code,"LIFECYCLE_REQUEST_REPLAY_CONFLICT");assert.equal(f.writes.length,2);
});
test("single pending request locks another event, OCC cannot be forged",async()=>{
  const f=setup();await f.call();const p=await f.call({event:{...f.event,eventId:"evt002"}});
  assert.equal(p.status,409);assert.equal(p.body.code,"LIFECYCLE_REQUEST_ALREADY_PENDING_OR_LOCKED");
  const g=setup();const wrong=await g.call({event:{...g.event,expectedEventRevision:1}});
  assert.equal(wrong.status,409);assert.equal(g.writes.length,0);
});
test("rejects invalid or future event, over-refund and injected approval",async()=>{
  const f=setup();
  for(const e of [{...f.event,eventDate:"2026-10-10"},{...f.event,refundAmount:9900},
    {...f.event,approvalState:"APPROVED"},{...f.event,formalRevenueDelta:9800}]){
    const r=await f.call({event:e});assert.notEqual(r.status,200);assert.equal(f.writes.length,0);
  }
});
test("no report, sale, or daily summary means zero writes",async()=>{
  for(const field of ["hasReport","hasSale","hasDaily"]){const f=setup({[field]:false});
    const r=await f.call();assert.equal(r.status,409);assert.equal(f.writes.length,0);}
});
test("tampered immutable version price and corrected unknown package denied",async()=>{
  const f=setup({versionPrice:9750});const r=await f.call();assert.equal(r.status,409);assert.equal(f.writes.length,0);
  const g=setup();const c=await g.call({event:{...g.event,kind:"CORRECTION",refundAmount:undefined,
    replacement:{packageId:"not_in_version",quantity:1,attributedAmount:9000}}});
  assert.equal(c.status,409);assert.equal(g.writes.length,0);
});
test("store manager authority is rechecked inside transaction, including revoked store",async()=>{
  const good=setup({brand:"anniu",role:"store",account:"S001",storeName:"安妞崇學店"});
  assert.equal((await good.call()).status,200);
  assert.ok(good.writes.every(x=>x.path.startsWith("brands/anniu/")));
  const bad=setup({brand:"yibo",role:"store",account:"S001",storeName:"伊啵崇學店",revoked:true});
  const r=await bad.call();assert.equal(r.status,403);assert.equal(bad.writes.length,0);
});
test("therapist ownership, tenant claim and Trusted Device mismatch fail closed",async()=>{
  const other=setup({masterStore:"中美"});assert.equal((await other.call()).status,403);assert.equal(other.writes.length,0);
  const cross=setup({claimsBrand:"anniu"});assert.equal((await cross.call()).status,403);assert.equal(cross.writes.length,0);
  const denied=setup({trusted:false});assert.equal((await denied.call()).status,403);assert.equal(denied.writes.length,0);
});
test("every brand writes to its own canonical location",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){const f=setup({brand});const r=await f.call();assert.equal(r.status,200);
    assert.ok(f.writes.every(x=>x.path.startsWith(`${prefix(brand)}/`)));}
});
test("immutable historical version allowed without looking up CURRENT publication",async()=>{
  const f=setup();const r=await f.call();assert.equal(r.status,200);
  assert.ok(!f.writes.some(x=>x.path.includes("activity_sales_publications")));
});
