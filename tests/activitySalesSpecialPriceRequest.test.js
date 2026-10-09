import {createRequire} from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {checkedSpecialPriceRequest,specialPriceRequestId,buildSpecialPriceRequest}=require("../functions/activitySalesSpecialPriceRequestContract.js");
const {createSpecialPriceRequestHandler}=require("../functions/activitySalesSpecialPriceRequestWriter.js");
const {attributionDocumentId}=require("../functions/activitySalesAttributionContract.js");
const {summaryDocumentId}=require("../functions/activitySalesAttributionWriterLogic.js");
const NOW=new Date("2026-10-09T06:00:00.000Z"),br=x=>x==="cyj"?"artifacts/default-app-id/public/data":`brands/${x}`;
const identity=(brand="cyj")=>({brandId:brand,campaignId:"camp01",versionId:"camp01_v001",roleId:"therapist",accountId:"T001",reportDate:"2026-10-08"});
const payload=(brand="cyj")=>({brandId:brand,campaignId:"camp01",versionId:"camp01_v001",reportDate:"2026-10-08",action:"request_special_price",storeName:"CYJ崇學店",saleId:"sale001",
  packageId:"pkg01",quantity:1,actualAmount:17800,reasonCode:"special_discount",reasonNote:"主管同意申請折讓",expectedRevision:0,
  actor:{roleId:"therapist",accountId:"T001",deviceId:"dev001",credentialPassword:"test-only"}});
const snap=(x)=>({exists:x!==undefined,data:()=>x});
function fixture({brand="cyj",claimedBrand=brand,trusted=true,report=true,policy=true,active=true,version=true,
  publication=true,existingSale=false,zero=false,price=18800,store="崇學"}={}){
  const docs=new Map(),writes=[];
  const path=(b,name,id)=>`${br(b)}/${name}/${id}`;
  const ref=(p)=>({path:p,id:p.split("/").at(-1)});
  const put=(name,id,data)=>docs.set(path(brand,name,id),data);
  const id=identity(brand);
  const campaignSnapshot={startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"all",packages:[{packageId:"pkg01",salePrice:price}]};
  const pub={...id,status:"published",startDate:"2026-10-01",endDate:"2026-10-31"};
  put("therapists","T001",{id:"T001",store:store==="崇學"?"CYJ崇學店":"CYJ其他店",status:active?"active":"resigned"});
  if(report)put("therapist_daily_reports","2026-10-08_T001",{brandId:brand,therapistId:"T001",storeName:"CYJ崇學店",date:"2026-10-08",totalRevenue:86400});
  if(publication)put("activity_sales_publications",id.campaignId,pub);
  if(version)put("activity_campaign_versions",id.versionId,{brandId:brand,campaignId:id.campaignId,versionId:id.versionId,campaignSnapshot});
  if(policy)put("activity_sales_lifecycle_review_policy","current",{schemaVersion:"activity-sales-lifecycle-review-policy-v1",brandId:brand,
    enabled:true,revision:1,groups:{},flows:{SPECIAL_PRICE:{enabled:true,allowRequesterApproval:false,steps:[{stepId:"level1",quorum:"ANY",reviewers:[{type:"account",roleId:"store",accountId:"S001"}]}]}}});
  if(existingSale)put("activity_sales_attribution_sales",attributionDocumentId(id,"sale001"),{...id,saleId:"sale001",attributedAmount:18800});
  if(zero)put("activity_sales_daily_attributions",summaryDocumentId(id),{...id,status:"CONFIRMED_ZERO",storeCore:"崇學",formalRevenueDelta:0});
  const db={runTransaction:async fn=>{
    const staged=[],tx={get:async(r)=>snap(docs.get(r.path)),create:(r,data)=>staged.push({r,data})};
    const out=await fn(tx);
    for(const {r} of staged)if(docs.has(r.path))throw Error("EXISTS");
    for(const {r,data} of staged){docs.set(r.path,data);writes.push(r.path);}
    return out;
  }};
  const fakeAdmin={firestore:{FieldValue:{serverTimestamp:()=>"SERVER_TIMESTAMP"}}};
  const handler=createSpecialPriceRequestHandler({admin:fakeAdmin,db,services:{now:()=>NOW,
    getBrandCollection:(_db,b,name)=>({doc:(id)=>ref(path(b,name,id))}),
    getBrandSettingDoc:(_db,b,name)=>ref(path(b,"settings",name)),
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:claimedBrand,roleId:"therapist",accountId:"T001"}}),
    verifyTrustedApplicationActor:async()=>trusted?{ok:true,actorRole:"therapist",actorAccountId:"T001"}:{ok:false}}});
  const call=async(changes={})=>{
    const req={method:"POST",body:{...payload(brand),...changes}};
    const res={code:200,status(c){this.code=c;return this;},json(body){return {status:this.code,body};}};
    return handler(req,res);
  };
  return {docs,writes,call,id,brand};
}
test("contract: actual amount differs, reason required, standard amount rejected",()=>{
  const q=checkedSpecialPriceRequest(payload());
  const p=buildSpecialPriceRequest(q,18800);
  assert.equal(p.priceDifference,-1000);assert.equal(p.approvalState,"PENDING_REVIEW");assert.equal(p.formalRevenueDelta,0);
  assert.throws(()=>buildSpecialPriceRequest({...q,actualAmount:18800},18800),/LIFECYCLE_NORMAL_PRICE_REASON_CONFLICT|SPECIAL_PRICE_NOT_AN_EXCEPTION/);
  assert.throws(()=>buildSpecialPriceRequest({...q,reasonCode:""},18800),/LIFECYCLE_SPECIAL_PRICE_REASON_REQUIRED/);
});
test("contract: rejects client authority or revenue overrides; stable opaque request id",()=>{
  const p=payload(),r=checkedSpecialPriceRequest(p);
  assert.equal(specialPriceRequestId(r.identity,r.saleId),specialPriceRequestId(r.identity,r.saleId));
  for(const change of [{approvalState:"APPROVED"},{standardUnitPrice:18800},{formalRevenueDelta:1},{expectedRevision:2},{saleId:"bad/path"},{actualAmount:0}]){
    assert.throws(()=>checkedSpecialPriceRequest({...p,...change}));
  }
});
test("writer: three brands create pending-only private documents, no revenue changes",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const f=fixture({brand}),r=await f.call();
    assert.equal(r.status,200,`${brand}: ${r.body.code}`);
    assert.equal(r.body.approvalState,"PENDING_REVIEW");assert.equal(r.body.officialKpiAllocation,"UNDECIDED");
    assert.equal(f.writes.length,2);assert.ok(f.writes.every(x=>x.startsWith(`${br(brand)}/`)));
    assert.deepEqual(f.writes.map(x=>x.split("/").at(-2)).sort(),["activity_sales_special_price_requests","activity_sales_special_price_request_state"].sort());
    assert.equal(f.docs.get(`${br(brand)}/therapist_daily_reports/2026-10-08_T001`).totalRevenue,86400);
    assert.equal(await f.call().then(x=>x.body.state),"idempotent");assert.equal(f.writes.length,2);
  }
});
test("writer: altered replay blocked, cannot produce a second application",async()=>{
  const f=fixture();assert.equal((await f.call()).status,200);
  const r=await f.call({actualAmount:17000});assert.equal(r.status,409);assert.equal(f.writes.length,2);
});
test("writer: unauthorized, revoked, cross-store, no report, no policy, stale version, existing sale, confirmed zero are denied",async()=>{
  for(const options of [{claimedBrand:"anniu"},{trusted:false},{active:false},{store:"其他"},
    {report:false},{policy:false},{version:false},{publication:false},{existingSale:true},{zero:true}]){
    const f=fixture(options),r=await f.call();assert.notEqual(r.status,200,JSON.stringify(options));assert.equal(f.writes.length,0);
  }
});
test("writer: no client can force approval, checkout or backfill",async()=>{
  for(const changes of [{approvalState:"APPROVED"},{settle:true},{formalRevenueDelta:7},{reportDate:"2030-01-01"}]){
    const f=fixture(),r=await f.call(changes);assert.notEqual(r.status,200);assert.equal(f.writes.length,0);
  }
});
test("writer: no special price on standard amount or lacking explanation",async()=>{
  for(const changes of [{actualAmount:18800},{reasonCode:""},{reasonCode:"other",reasonNote:""}]){
    const f=fixture(),r=await f.call(changes);assert.notEqual(r.status,200);assert.equal(f.writes.length,0);
  }
});
