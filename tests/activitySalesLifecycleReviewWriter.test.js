"use strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const test=require("node:test"),assert=require("node:assert/strict");
const {createLifecycleReviewHandler}=require("../functions/activitySalesLifecycleReviewWriter");
const {normalizeEvent,lifecycleDocumentId}=require("../functions/activitySalesLifecycleContract");
const {attributionDocumentId}=require("../functions/activitySalesAttributionContract");
const {summaryDocumentId}=require("../functions/activitySalesAttributionWriterLogic");
const prefix=b=>b==="cyj"?"artifacts/default-app-id/public/data":`brands/${b}`;
const NOW=new Date("2026-10-09T01:00:00Z"),fakeAdmin={firestore:{FieldValue:{serverTimestamp:()=>"SERVER_TS"}}};
const snap=x=>({exists:x!==undefined,data:()=>x});
function setup({brand="cyj",claimedBrand=brand,actorRole="store",actorAccountId="S001",trusted=true,active=true,
  enabled=true,storeScope=true,policyRevision=1,requestPresent=true}={}){
  const docs=new Map(),writes=[];
  const ref=path=>({path,id:path.split("/").at(-1)});
  const loc=(name,id)=>`${prefix(brand)}/${name}/${id}`;
  const put=(name,id,data)=>docs.set(loc(name,id),data);
  const event=normalizeEvent({brandId:brand,campaignId:"campaign1",versionId:"campaign1_v001",
    roleId:"therapist",accountId:"T001",reportDate:"2026-10-08",saleId:"sale01",eventId:"evt01",
    eventDate:"2026-10-09",kind:"REFUND",refundAmount:500,expectedEventRevision:0,reasonCode:"customer_request",formalRevenueDelta:0});
  const requestId=lifecycleDocumentId(event),saleId=attributionDocumentId(event,event.saleId);
  const request={schemaVersion:"activity-sales-lifecycle-request-v1",...event,storeCore:"崇學",event,
    eventCanonical:JSON.stringify(event),requestedByRole:"therapist",requestedByAccountId:"T001",state:"PENDING_REVIEW",
    formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
  if(requestPresent)put("activity_sales_lifecycle_requests",requestId,request);
  put("activity_sales_lifecycle_request_state",saleId,{...event,brandId:brand,state:"PENDING_REVIEW",pendingRequestId:requestId,requestRevision:1});
  put("activity_sales_attribution_sales",saleId,{...event,storeCore:"崇學",formalRevenueDelta:0});
  put("activity_sales_daily_attributions",summaryDocumentId(event),{...event,storeCore:"崇學",status:"HAS_SALES",formalRevenueDelta:0});
  put("activity_campaign_versions",event.versionId,{brandId:brand,versionId:event.versionId});
  put("activity_sales_lifecycle_review_policy","current",{schemaVersion:"activity-sales-lifecycle-review-policy-v1",brandId:brand,
    revision:policyRevision,enabled,groups:{},flows:{REFUND:{enabled:true,allowRequesterApproval:false,
      steps:[{stepId:"store",quorum:"ANY",reviewers:[{type:"account",roleId:"store",accountId:"S001"},
        {type:"account",roleId:"store",accountId:"S002"}]}]}}});
  const settingsRole=actorRole==="store"?"store_account_data":"director_auth";
  const storeAccount={id:actorAccountId,isActive:active,stores:storeScope?["崇學"]:["中美"]};
  docs.set(`${prefix(brand)}/settings/${settingsRole}`,actorRole==="store"?{accounts:[storeAccount]}:{accounts:{[actorAccountId]:{id:actorAccountId,isActive:active}}});
  const collection=(_db,b,name)=>({doc:id=>ref(`${prefix(b)}/${name}/${id}`)});
  const db={runTransaction:async fn=>{
    const staged=[];
    const tx={get:async r=>snap(docs.get(r.path)),create:(r,data)=>staged.push({type:"create",r,data}),
      set:(r,data)=>staged.push({type:"set",r,data})};
    const result=await fn(tx);
    for(const w of staged){if(w.type==="create"&&docs.has(w.r.path))throw Error("DUPLICATE_CREATE");}
    for(const w of staged){docs.set(w.r.path,w.data);writes.push(w);}
    return result;
  }};
  const handler=createLifecycleReviewHandler({admin:fakeAdmin,db,services:{
    now:()=>NOW,getBrandCollection:collection,getBrandSettingDoc:(_db,b,id)=>ref(`${prefix(b)}/settings/${id}`),
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",
      brandId:claimedBrand,roleId:actorRole,accountId:actorAccountId}}),
    verifyTrustedApplicationActor:async()=>trusted?{ok:true,actorRole,actorAccountId}: {ok:false}
  }});
  const call=async({expectedReviewRevision=0,decision="APPROVE",reasonNote="",requestId:id=requestId,actorOverride={}}={})=>{
    const req={method:"POST",body:{action:"review_lifecycle",brandId:brand,requestId:id,decision,reasonNote,
      expectedReviewRevision,actor:{roleId:actorRole,accountId:actorAccountId,deviceId:"demo",credentialPassword:"fake",...actorOverride}}};
    const res={statusCode:200,status(s){this.statusCode=s;return this;},json(body){return {status:this.statusCode,body};}};
    return handler(req,res);
  };
  return {docs,writes,call,requestId,event};
}
test("B2 decision creates two private documents only, approval not settlement",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const f=setup({brand}),r=await f.call();assert.equal(r.status,200,`${brand} ${r.body?.code}`);
    assert.equal(r.body.status,"APPROVED_PENDING_SETTLEMENT");assert.equal(r.body.formalRevenueDelta,0);
    assert.equal(r.body.officialKpiAllocation,"UNDECIDED");
    assert.deepEqual(f.writes.map(x=>x.r.path.split("/").at(-2)).sort(),
      ["activity_sales_lifecycle_review_decisions","activity_sales_lifecycle_review_state"].sort());
    assert.ok(f.writes.every(x=>x.r.path.startsWith(`${prefix(brand)}/`)));
    const req=f.docs.get(`${prefix(brand)}/activity_sales_lifecycle_requests/${f.requestId}`);
    assert.equal(req.state,"PENDING_REVIEW");
  }
});
test("exact retry idempotent; divergent retry denied",async()=>{
  const f=setup();assert.equal((await f.call()).status,200);
  assert.equal((await f.call()).body.state,"idempotent");assert.equal(f.writes.length,2);
  assert.equal((await f.call({decision:"REJECT",reasonNote:"資料不符"})).status,409);
});
test("cross-brand claims, no trusted device, cancelled account, outsider store all denied",async()=>{
  for(const option of [{claimedBrand:"anniu"},{trusted:false},{active:false},{storeScope:false}]){
    const f=setup(option),r=await f.call();assert.notEqual(r.status,200);assert.equal(f.writes.length,0);
  }
});
test("cannot review absent request or disabled/missing brand policy",async()=>{
  for(const opt of [{requestPresent:false},{enabled:false}]){
    const f=setup(opt),r=await f.call();assert.notEqual(r.status,200);assert.equal(f.writes.length,0);
  }
});
test("second vote stale OCC or same actor never produces additional writes",async()=>{
  const f=setup();assert.equal((await f.call()).status,200);
  assert.equal((await f.call({expectedReviewRevision:1})).status,409);
  assert.equal(f.writes.length,2);
});
test("no browser actor can inject settlement / billing fields",async()=>{
  const f=setup();const r=await f.call({actorOverride:{roleId:"director"}});assert.notEqual(r.status,200);assert.equal(f.writes.length,0);
});
