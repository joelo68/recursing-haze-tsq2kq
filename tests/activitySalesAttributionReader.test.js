import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAttributionReaderHandler,normalizedStatus}=require("../functions/activitySalesAttributionReader.js");
const {summaryDocumentId}=require("../functions/activitySalesAttributionWriterLogic.js");
const brandRoot=b=>b==="cyj"?"artifacts/default-app-id/public/data":`brands/${b}`;
const identity={brandId:"cyj",campaignId:"sale01",versionId:"sale01_v001",reportDate:"2026-10-08",roleId:"therapist",accountId:"T001"};
const base={...identity,storeName:"CYJ崇學店",actor:{roleId:"therapist",accountId:"T001",deviceId:"device",credentialPassword:"current-password"}};
function setup({brand="cyj",role="therapist",account="T001",storeName="CYJ崇學店",credentialStores=["崇學"],masterStore="崇學",report=true,
  publishedVersion="sale01_v001",daily=null,claimsBrand=brand,trusted=true,scope=["崇學"],reportStore=storeName}={}){
  const docs=new Map(),reads=[],writes=[];
  const i={...identity,brandId:brand,roleId:role,accountId:account};
  const put=(collection,id,value)=>docs.set(`${brandRoot(brand)}/${collection}/${id}`,value);
  put("activity_sales_publications",i.campaignId,{brandId:brand,status:"published",campaignId:i.campaignId,versionId:publishedVersion,startDate:"2026-10-01",endDate:"2026-10-31"});
  put("activity_campaign_versions",i.versionId,{brandId:brand,campaignId:i.campaignId,versionId:i.versionId,
    campaignSnapshot:{startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"selected",stores:scope,packages:[{packageId:"p1",salePrice:9800}]}});
  if(report)put(role==="therapist"?"therapist_daily_reports":"daily_reports",`2026-10-08_${role==="therapist"?account:storeName}`,
    {brandId:brand,date:"2026-10-08",storeName:reportStore,therapistId:role==="therapist"?account:undefined});
  if(role==="therapist")put("therapists",account,{id:account,store:masterStore,status:"active"});
  if(daily)put("activity_sales_daily_attributions",summaryDocumentId(i),{schemaVersion:"activity-sales-daily-attribution-v1",...i,storeCore:"崇學",revision:1,formalRevenueDelta:0,...daily});
  const snap=value=>({exists:value!==undefined,data:()=>value});
  const getBrandCollection=(_db,b,name)=>({doc:id=>({path:`${brandRoot(b)}/${name}/${id}`})});
  const db={runTransaction:async(fn,opts)=>{
    assert.deepEqual(opts,{readOnly:true});
    return fn({get:async(ref)=>{reads.push(ref.path);return snap(docs.get(ref.path));},
      set:()=>writes.push("set"),create:()=>writes.push("create"),update:()=>writes.push("update")});
  }};
  const handler=createAttributionReaderHandler({admin:{},db,services:{now:()=>new Date("2026-10-08T08:00:00Z"),getBrandCollection,
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:claimsBrand,roleId:role,accountId:account}}),
    verifyTrustedApplicationActor:async()=>trusted?{ok:true,actorRole:role,actorAccountId:account,credential:{stores:credentialStores}}:{ok:false}}});
  const call=async(patch={})=>{
    const body={...base,brandId:brand,storeName,actor:{...base.actor,roleId:role,accountId:account},...patch};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(data){return {status:this.statusCode,body:data};}};
    return handler({method:"POST",body},res);
  };
  return {call,reads,writes,docs};
}
test("no summary document means UNCONFIRMED, null amount/count, not zero",async()=>{
  const f=setup();const {status,body}=await f.call();
  assert.equal(status,200);assert.equal(body.status,"UNCONFIRMED");assert.equal(body.saleCount,null);
  assert.equal(body.attributedAmount,null);assert.equal(body.revision,0);assert.equal(body.formalRevenueDelta,0);
  assert.equal(f.reads.length,5);assert.equal(f.writes.length,0);
});
test("confirmed zero is explicit, not missing",async()=>{
  const f=setup({daily:{status:"CONFIRMED_ZERO",saleCount:0,attributedAmount:0}});
  const r=await f.call();assert.equal(r.status,200);assert.equal(r.body.status,"CONFIRMED_ZERO");assert.equal(r.body.saleCount,0);assert.equal(r.body.attributedAmount,0);
});
test("has sales is non additive and server-derived",async()=>{
  const f=setup({daily:{status:"HAS_SALES",saleCount:2,attributedAmount:19600}});
  const r=await f.call();assert.equal(r.status,200);assert.equal(r.body.attributedAmount,19600);assert.equal(r.body.formalRevenueDelta,0);
});
test("inconsistent summary is rejected, not silently coerced to zero",()=>{
  const i={...identity};const snap=raw=>({exists:true,data:()=>({schemaVersion:"activity-sales-daily-attribution-v1",...i,storeCore:"崇學",revision:1,formalRevenueDelta:0,...raw})});
  assert.throws(()=>normalizedStatus(snap({status:"HAS_SALES",saleCount:0,attributedAmount:0}),i,"崇學"),/ATTRIBUTION_READ_DATA_INVALID/);
  assert.throws(()=>normalizedStatus(snap({status:"CONFIRMED_ZERO",saleCount:0,attributedAmount:null}),i,"崇學"),/ATTRIBUTION_READ_DATA_INVALID/);
  assert.throws(()=>normalizedStatus(snap({status:"HAS_SALES",saleCount:1,attributedAmount:9800,formalRevenueDelta:9800}),i,"崇學"),/ATTRIBUTION_READ_DATA_INVALID/);
});
test("an unsubmitted report must not show UNCONFIRMED",async()=>{
  const f=setup({report:false});const r=await f.call();assert.equal(r.status,409);assert.equal(r.body.code,"ATTRIBUTION_REPORT_NOT_SUBMITTED");
});
test("user must own report and therapist master must match store",async()=>{
  const f=setup({masterStore:"中美"});const r=await f.call();assert.equal(r.status,403);assert.equal(r.body.code,"ATTRIBUTION_STORE_FORBIDDEN");
  const bad=setup({reportStore:"CYJ中美店"});const q=await bad.call();assert.equal(q.status,409);assert.equal(q.body.code,"ATTRIBUTION_REPORT_MISMATCH");
});
test("store credentials control exact selected store",async()=>{
  const f=setup({brand:"anniu",role:"store",account:"S012",storeName:"安妞崇學店",credentialStores:["崇學"]});
  const ok=await f.call();assert.equal(ok.status,200);assert.ok(f.reads.every(p=>p.startsWith("brands/anniu/")));
  const bad=setup({brand:"yibo",role:"store",account:"S012",storeName:"伊啵崇學店",credentialStores:["中美"]});
  const denied=await bad.call();assert.equal(denied.status,403);
});
test("authentication claim brand mismatch and untrusted device block before reads",async()=>{
  const x=setup({claimsBrand:"anniu"});assert.equal((await x.call()).status,403);assert.equal(x.reads.length,0);
  const y=setup({trusted:false});assert.equal((await y.call()).status,403);assert.equal(y.reads.length,0);
});
test("published version must match selected version; old version cannot masquerade as zero",async()=>{
  const f=setup({publishedVersion:"sale01_v002"});const r=await f.call();assert.equal(r.status,409);assert.equal(r.body.code,"ATTRIBUTION_PUBLICATION_CHANGED");
});
test("cross-brand response is isolated for CYJ / Anniu / Yibo",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){const f=setup({brand});const r=await f.call();assert.equal(r.status,200);assert.equal(r.body.brandId,brand);assert.ok(f.reads.every(p=>p.startsWith(brandRoot(brand)+"/")));}
});
test("future date, path injection, non POST or invalid role fail closed",async()=>{
  const f=setup();assert.equal((await f.call({reportDate:"2026-10-09"})).status,400);
  assert.equal((await f.call({actor:{roleId:"therapist",accountId:"T001/../x",deviceId:"dev",credentialPassword:"x"}})).status,400);
  assert.equal((await f.call({actor:{roleId:"director",accountId:"X",deviceId:"dev",credentialPassword:"x"}})).status,400);
});
