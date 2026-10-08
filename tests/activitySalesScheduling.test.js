import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const logic = require("../functions/activitySalesScheduleLogic.js");
const {createScheduleEngine} = require("../functions/activitySalesScheduledPublisher.js");

const stamp = (ms)=>new Date(ms).toISOString();
const baseMs=Date.parse("2026-10-08T02:00:00.000Z");
const identity={brandId:"anniu",campaignId:"campaignA",versionId:"campaignA_v001"};
const admin={firestore:{FieldValue:{serverTimestamp:()=>"<serverTime>"}}};

function fakeDB() {
  const docs=new Map();
  const getRef=(p)=>({
    path:p,
    async get(){return {exists:docs.has(p),data:()=>docs.get(p)};},
  });
  const getCollection=(_db,brand,name)=>{
    const path=brand==="cyj" ? `artifacts/default-app-id/public/data/${name}` :
      `brands/${brand}/${name}`;
    return {doc:(id)=>getRef(`${path}/${id || "audit_1"}`)};
  };
  const operations=[];
  const db={async runTransaction(fn) {
    const tx={
      get:async(ref)=>({exists:docs.has(ref.path),data:()=>docs.get(ref.path)}),
      set:(ref,data,opts)=>operations.push({op:"set",ref,data,opts}),
      delete:(ref)=>operations.push({op:"delete",ref}),
    };
    const before=operations.length;
    const result=await fn(tx);
    for (const op of operations.slice(before)) {
      if (op.op==="delete") docs.delete(op.ref.path);
      else docs.set(op.ref.path, op.opts?.merge ?
        {...(docs.get(op.ref.path)||{}),...op.data} : op.data);
    }
    return result;
  }};
  return {docs,db,operations,getCollection};
}
function campaign(overrides={}) {
  return {brandId:"anniu",campaignId:identity.campaignId,
    currentVersionId:identity.versionId,revision:4,status:"approved",
    releaseMode:"scheduled_after_approval",scheduledPublishAtText:stamp(baseMs),
    ...overrides};
}
function version() {
  return {brandId:"anniu",campaignId:identity.campaignId,versionId:identity.versionId,
    campaignSnapshot:{title:"正式活動",startDate:"2026-10-01",endDate:"2026-10-31",
      packages:[{name:"套組",packageId:"p1",salePrice:980,items:[{name:"課程",attributedAmount:980}]}],
      approvalPlan:{releaseMode:"scheduled_after_approval",scheduledPublishAt:stamp(baseMs)}}};
}
const campaignPath=`brands/anniu/activity_campaigns/${identity.campaignId}`;
const versionPath=`brands/anniu/activity_campaign_versions/${identity.versionId}`;
const publicPath=`brands/anniu/activity_sales_publications/${identity.campaignId}`;

test("identity and version are checked, including strict brand allowlist",()=>{
  assert.deepEqual(logic.validateScheduleIdentity(identity),identity);
  assert.throws(()=>logic.validateScheduleIdentity({...identity,brandId:"wrong"}),/INVALID/);
  assert.throws(()=>logic.validateScheduleIdentity({...identity,versionId:"other_v001"}),/INVALID/);
});

test("enqueue only on approved scheduled transition, never manual or unchanged",async()=>{
  const e=fakeDB(); const calls=[];
  const engine=createScheduleEngine({admin,db:e.db,getBrandCollection:e.getCollection,
    enqueueTask:async(id,when)=>calls.push({id,when}),now:()=>baseMs-1000});
  const eligible=campaign();
  const result=await engine.handleTransition({
    brandId:"anniu",campaignId:identity.campaignId,before:{status:"pending_approval"},after:eligible,
  });
  assert.equal(result.state,"enqueued");
  assert.equal(calls.length,1);
  assert.equal(calls[0].when.toISOString(),stamp(baseMs));
  await engine.handleTransition({brandId:"anniu",campaignId:identity.campaignId,before:eligible,after:eligible});
  await engine.handleTransition({brandId:"anniu",campaignId:identity.campaignId,
    before:{status:"pending_approval"},after:campaign({releaseMode:"manual_after_approval"})});
  assert.equal(calls.length,1);
});

test("Cloud Tasks 30-day limit handled by <=25 day checkpoint and continuation",async()=>{
  const future=baseMs+110*86400000;
  const first=logic.chooseScheduledTaskTime(future,baseMs);
  assert.equal(first.getTime()-baseMs,25*86400000);
  const e=fakeDB(); e.docs.set(campaignPath,campaign({scheduledPublishAtText:stamp(future)}));
  const calls=[];
  const engine=createScheduleEngine({admin,db:e.db,getBrandCollection:e.getCollection,
    enqueueTask:async(id,when)=>calls.push({id,when}),now:()=>baseMs+25*86400000});
  const result=await engine.dispatch(identity);
  assert.equal(result.state,"requeued");
  assert.equal(calls.length,1);
  assert.ok(calls[0].when.getTime()<=baseMs+50*86400000);
  assert.equal(e.operations.length,0);
});

test("due version publishes in one transaction, duplicate retry is idempotent",async()=>{
  const e=fakeDB();
  e.docs.set(campaignPath,campaign());
  e.docs.set(versionPath,version());
  const engine=createScheduleEngine({admin,db:e.db,getBrandCollection:e.getCollection,
    enqueueTask:async()=>{},now:()=>baseMs+60000});
  const first=await engine.dispatch(identity);
  assert.equal(first.state,"published");
  assert.equal(e.docs.get(campaignPath).status,"published");
  assert.equal(e.docs.get(campaignPath).revision,5);
  assert.equal(e.docs.get(publicPath).versionId,identity.versionId);
  const count=e.operations.length;
  const second=await engine.dispatch(identity);
  assert.equal(second.state,"skip");
  assert.equal(e.operations.length,count);
  assert.equal(e.docs.get(publicPath).status,"published");
});

test("cancelled/stopped/other version or wrong brand never publish",async()=>{
  for (const changed of [{status:"cancelled"},{status:"stopped"},
    {currentVersionId:"campaignA_v002"},{brandId:"yibo"}]) {
    const e=fakeDB(); e.docs.set(campaignPath,campaign(changed));
    e.docs.set(versionPath,version());
    const engine=createScheduleEngine({admin,db:e.db,getBrandCollection:e.getCollection,
      enqueueTask:async()=>{},now:()=>baseMs+60000});
    assert.equal((await engine.dispatch(identity)).state,"skip");
    assert.equal(e.docs.has(publicPath),false);
    assert.equal(e.operations.length,0);
  }
});

test("immutable version mismatch fails closed without writes",async()=>{
  const e=fakeDB(); e.docs.set(campaignPath,campaign());
  e.docs.set(versionPath,{...version(),brandId:"yibo"});
  const engine=createScheduleEngine({admin,db:e.db,getBrandCollection:e.getCollection,
    enqueueTask:async()=>{},now:()=>baseMs+60000});
  await assert.rejects(engine.dispatch(identity),/VERSION_MISMATCH/);
  assert.equal(e.operations.length,0);
});

test("expired schedule fails closed, no public projection produced",async()=>{
  const e=fakeDB();e.docs.set(campaignPath,campaign());e.docs.set(versionPath,version());
  const engine=createScheduleEngine({admin,db:e.db,getBrandCollection:e.getCollection,
    enqueueTask:async()=>{},now:()=>Date.parse("2026-11-01T02:00:00.000Z")});
  await assert.rejects(engine.dispatch(identity),/ALREADY_EXPIRED/);
  assert.equal(e.operations.length,0);
});
