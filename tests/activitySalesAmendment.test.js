import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import Module from "node:module";
const require=createRequire(import.meta.url);
const original=Module._load;
let factory, normalizeCampaignDraft;
try {
  Module._load=function(request,parent,isMain) {
    if (request==="firebase-functions/v2/https") return {onRequest:(_opts,handler)=>handler};
    if (request==="./deviceApproval" && parent?.filename.endsWith("activitySalesAuthority.js")) return {
      getBrandCollection:(db,brand,name)=>db.collectionFor(brand,name),
      requireFirebaseRequestAuth:async(req)=>({ok:true,decoded:req.mockClaims}),
      verifyTrustedApplicationActor:async({actor})=>actor.deviceId==="trusted" && actor.credentialPassword==="fresh"
        ? {ok:true,actorRole:actor.roleId,actorAccountId:actor.accountId,actorName:actor.accountId}:{ok:false},
    };
    return original.apply(this,arguments);
  };
  ({createActivitySalesAuthorityFunctions:factory,normalizeCampaignDraft}=require("../functions/activitySalesAuthority.js"));
} finally {Module._load=original;}
const {reviewerKey}=require("../functions/activitySalesApprovalInbox.js");
const {createScheduleEngine}=require("../functions/activitySalesScheduledPublisher.js");
const creator={roleId:"trainer",accountId:"maker"};
const reviewer1={roleId:"director",accountId:"reviewer1"};
const reviewer2={roleId:"director",accountId:"reviewer2"};
const publisher={roleId:"director",accountId:"publisher"};
const plan=(mode="all",releaseMode="manual_after_approval",scheduledPublishAt="")=>({
  mode,releaseMode,scheduledPublishAt,allowCreatorApproval:false,
  selectors:[{type:"account",account:reviewer1},{type:"account",account:reviewer2}],
});
const draft=(title="舊版",approvalPlan=plan())=>({title,startDate:"2026-10-01",endDate:"2027-04-30",
  packages:[{packageId:"pkg",name:"正式套組",salePrice:500,items:[{itemId:"a",name:"課程",quantity:1,attributedAmount:500}]}],
  approvalPlan});
const brandPath=(b,name,id)=>b==="cyj"?`artifacts/default-app-id/public/data/${name}/${id}`:
  `brands/${b}/${name}/${id}`;
function fixture(brand="cyj") {
  const docs=new Map(); const writes=[];let counter=0;
  const path=(n,id)=>brandPath(brand,n,id);
  const put=(n,id,data)=>docs.set(path(n,id),structuredClone(data));
  const old=draft();
  put("activity_sales_policy","current",{revision:1,groups:{},
    creatorSelectors:[{type:"account",account:creator}],
    publisherSelectors:[{type:"account",account:publisher}],directPublishSelectors:[]});
  put("activity_campaigns","flash",{schemaVersion:"activity-sales-v1",brandId:brand,campaignId:"flash",
    status:"published",revision:5,currentVersionId:"flash_v001",versionSequence:1,
    draft:old,createdBy:creator,releaseMode:"manual_after_approval"});
  put("activity_campaign_versions","flash_v001",{schemaVersion:"activity-campaign-version-v1",
    brandId:brand,campaignId:"flash",versionId:"flash_v001",versionSequence:1,campaignSnapshot:old});
  put("activity_sales_publications","flash",{brandId:brand,campaignId:"flash",versionId:"flash_v001",
    title:"舊版",status:"published",publishedAtText:"2026-10-08T00:00:00Z"});
  put("activity_sales_acknowledgements","old_confirm",{versionId:"flash_v001",accountId:"staff"});
  const ref=(path)=>({path});
  const db={collectionFor:(b,name)=>({doc:(id)=>ref(brandPath(b,name,id || `audit_${++counter}`))}),
    runTransaction:async(fn)=>{
      const staged=[];let writing=false;
      const tx={get:async(r)=>{if(writing) throw Error("FIRESTORE_READ_AFTER_WRITE");
        return {exists:docs.has(r.path),data:()=>docs.get(r.path)};},
      set:(r,data,opts)=>{writing=true;staged.push({type:"set",path:r.path,data,merge:opts?.merge});},
      create:(r,data)=>{writing=true;if(docs.has(r.path)) throw Error("ALREADY_EXISTS");staged.push({type:"create",path:r.path,data});},
      delete:(r)=>{writing=true;staged.push({type:"delete",path:r.path});}};
      const result=await fn(tx);
      for (const op of staged) {
        writes.push(op);
        if(op.type==="delete") docs.delete(op.path);
        else docs.set(op.path,op.merge?{...docs.get(op.path),...op.data}:op.data);
      }
      return result;
    }};
  const api=factory({admin:{firestore:{FieldValue:{serverTimestamp:()=>"SERVER_TS"}}},db});
  const get=(name,id)=>docs.get(path(name,id));
  async function request(action,who=creator,extras={},override={}) {
    const actor={...who,deviceId:"trusted",credentialPassword:"fresh"};
    let status=200,payload;
    const call=override.read?api.getActivitySalesWorkspace:api.manageActivityCampaign;
    await call({method:"POST",mockClaims:{drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:brand,
      roleId:who.roleId,accountId:who.accountId},body:{brandId:brand,action,campaignId:"flash",
      expectedRevision:get("activity_campaigns","flash").revision,actor,...extras}},
    {status(c){status=c;return this;},json(d){payload=d;return this;}});
    return {httpStatus:status,...payload};
  }
  return {brand,docs,writes,db,path,put,get,request};
}
async function prepare(t,releaseMode="manual_after_approval",at="") {
  assert.equal((await t.request("begin_amendment")).httpStatus,200);
  assert.equal(t.get("activity_campaigns","flash").currentVersionId,"flash_v001");
  const revised=draft("新售價與規則",plan("all",releaseMode,at));
  revised.packages[0].salePrice=600;
  revised.packages[0].items[0].attributedAmount=600;
  assert.equal((await t.request("update_amendment",creator,{campaign:revised})).httpStatus,200);
  assert.equal((await t.request("submit_amendment")).httpStatus,200);
  return revised;
}
const snap=(t)=>({current:t.get("activity_campaigns","flash"),
  publication:t.get("activity_sales_publications","flash")});

test("all three brands: published revision remains publicly immutable during new draft, inbox and approvals",async()=>{
  for(const brand of ["cyj","anniu","yibo"]) {
    const t=fixture(brand);await prepare(t);
    assert.equal(snap(t).current.status,"published");
    assert.equal(snap(t).current.currentVersionId,"flash_v001");
    assert.equal(snap(t).publication.title,"舊版");
    const version=t.get("activity_campaign_versions","flash_v002");
    assert.equal(version.baseVersionId,"flash_v001");
    assert.equal(version.campaignSnapshot.title,"新售價與規則");
    const inbox=t.get("activity_campaign_approvals","flash_v002");
    assert.deepEqual(inbox.activeReviewerKeys.sort(),[reviewerKey(reviewer1),reviewerKey(reviewer2)].sort());
    assert.equal((await t.request("approve",reviewer1)).httpStatus,200);
    assert.equal(snap(t).publication.versionId,"flash_v001");
    assert.deepEqual(t.get("activity_campaign_approvals","flash_v002").activeReviewerKeys,[reviewerKey(reviewer2)]);
    const stale=await t.request("approve",reviewer2,{expectedRevision:5});
    assert.equal(stale.httpStatus,409);
    assert.equal((await t.request("approve",reviewer2)).httpStatus,200);
    assert.equal(t.get("activity_campaigns","flash").amendment.status,"approved");
    assert.equal(snap(t).publication.versionId,"flash_v001");
    assert.equal((await t.request("publish_amendment",creator)).httpStatus,403);
    assert.equal((await t.request("publish_amendment",publisher)).httpStatus,200);
    assert.equal(snap(t).publication.versionId,"flash_v002");
    assert.equal(snap(t).publication.title,"新售價與規則");
    assert.equal(snap(t).current.currentVersionId,"flash_v002");
    assert.equal(snap(t).current.amendment,null);
    assert.equal(t.get("activity_sales_acknowledgements","old_confirm").versionId,"flash_v001");
  }
});

test("review is mandatory even for a previously direct-published activity",async()=>{
  const t=fixture();await t.request("begin_amendment");
  const result=await t.request("update_amendment",creator,{campaign:draft("違規直發",{mode:"none",releaseMode:"immediate_after_approval"})});
  assert.equal(result.httpStatus,200);
  const blocked=await t.request("submit_amendment");
  assert.equal(blocked.httpStatus,400);assert.equal(blocked.code,"AMENDMENT_REVIEW_REQUIRED");
  assert.equal(snap(t).publication.title,"舊版");
});

test("return, edit, resubmit use a new immutable version and never touch old publication",async()=>{
  const t=fixture();await prepare(t);
  assert.equal((await t.request("return_for_changes",reviewer1,{comment:"請再確認"})).httpStatus,200);
  assert.equal(t.get("activity_campaigns","flash").amendment.status,"returned");
  assert.deepEqual(t.get("activity_campaign_approvals","flash_v002").activeReviewerKeys,[]);
  const changed=draft("退回後新版");
  assert.equal((await t.request("update_amendment",creator,{campaign:changed})).httpStatus,200);
  assert.equal((await t.request("submit_amendment")).httpStatus,200);
  assert.equal(t.get("activity_campaigns","flash").amendment.versionId,"flash_v003");
  assert.equal(t.get("activity_campaign_versions","flash_v002").campaignSnapshot.title,"新售價與規則");
  assert.equal(snap(t).publication.versionId,"flash_v001");
});

test("withdraw and emergency stop atomically revoke pending inbox without public draft leak",async()=>{
  const t=fixture();await prepare(t);
  assert.equal((await t.request("discard_amendment")).httpStatus,200);
  assert.equal(t.get("activity_campaigns","flash").amendment,null);
  assert.equal(snap(t).publication.versionId,"flash_v001");
  assert.deepEqual(t.get("activity_campaign_approvals","flash_v002").activeReviewerKeys,[]);
  await prepare(t);
  assert.equal((await t.request("stop",publisher)).httpStatus,200);
  assert.equal(t.get("activity_campaigns","flash").status,"stopped");
  assert.equal(t.get("activity_campaigns","flash").amendment,null);
  assert.equal(t.get("activity_sales_publications","flash"),undefined);
  assert.deepEqual(t.get("activity_campaign_approvals","flash_v003").activeReviewerKeys,[]);
});

test("private workspace gives pending reviewer amended snapshot, no credentials/policy member lists",async()=>{
  const t=fixture();await prepare(t);
  const result=await t.request("get_campaign",reviewer1,{}, {read:true});
  assert.equal(result.httpStatus,200);
  assert.equal(result.campaign.currentVersionId,"flash_v001");
  assert.equal(result.campaign.draft.title,"新售價與規則");
  assert.equal(result.capabilities.canApprove,true);
  assert.equal(result.campaign.review.members,undefined);
  assert.equal(result.capabilities.groups.length,0);
});

test("rejected cross-brand token and untrusted device cannot access/amend",async()=>{
  const t=fixture("yibo");
  const noTrust=await t.request("begin_amendment",creator,{actor:{...creator,deviceId:"other",credentialPassword:"fresh"}});
  assert.equal(noTrust.httpStatus,403);
  assert.equal(t.get("activity_campaigns","flash").amendment,undefined);
});

test("manual/scheduled swap rejects stale version and preserves active official snapshot",async()=>{
  const t=fixture();await prepare(t);await t.request("approve",reviewer1);await t.request("approve",reviewer2);
  t.put("activity_sales_publications","flash",{brandId:"cyj",versionId:"flash_other"});
  const failed=await t.request("publish_amendment",publisher);
  assert.equal(failed.httpStatus,409);assert.equal(failed.code,"AMENDMENT_VERSION_INVALID");
  assert.equal(t.get("activity_campaigns","flash").currentVersionId,"flash_v001");
});

test("scheduled amendment routes same campaign to single delayed task, then atomically switches projection",async()=>{
  const t=fixture("anniu");const when="2027-03-01T02:00:00.000Z";
  await prepare(t,"scheduled_after_approval",when);
  await t.request("approve",reviewer1);
  const before=structuredClone(t.get("activity_campaigns","flash"));
  await t.request("approve",reviewer2);
  const after=t.get("activity_campaigns","flash");
  assert.equal(after.amendment.status,"approved");
  const queued=[];
  const id={brandId:"anniu",campaignId:"flash",versionId:"flash_v002"};
  const clock=Date.parse(when)-1000;
  const engine=createScheduleEngine({admin:{firestore:{FieldValue:{serverTimestamp:()=>"SERVER_TS"}}},db:t.db,
    getBrandCollection:(db,b,n)=>db.collectionFor(b,n),now:()=>clock,
    enqueueTask:async(identity,time)=>queued.push({identity,time})});
  const send=await engine.handleTransition({brandId:"anniu",campaignId:"flash",before,after});
  assert.equal(send.state,"enqueued");assert.equal(queued.length,1);
  assert.deepEqual(queued[0].identity,id);
  assert.equal(snap(t).publication.versionId,"flash_v001");
  const ahead=await engine.dispatch(id);
  assert.equal(ahead.state,"requeued");
  const due=createScheduleEngine({admin:{firestore:{FieldValue:{serverTimestamp:()=>"SERVER_TS"}}},db:t.db,
    getBrandCollection:(db,b,n)=>db.collectionFor(b,n),now:()=>Date.parse(when)+1000,
    enqueueTask:async()=>{}});
  assert.equal((await due.dispatch(id)).state,"published");
  assert.equal(snap(t).publication.versionId,"flash_v002");
  assert.equal(snap(t).current.currentVersionId,"flash_v002");
  assert.equal(snap(t).current.amendment,null);
  const last=t.writes.length;
  assert.equal((await due.dispatch(id)).state,"skip");
  assert.equal(t.writes.length,last);
});

test("canonical any/all approval drafts survive save-to-submit normalization without losing reviewer selectors",()=>{
  const normalized=normalizeCampaignDraft(draft("雙重正規化",plan("all")));
  const twice=normalizeCampaignDraft(normalized);
  assert.deepEqual(twice.approvalPlan.steps,normalized.approvalPlan.steps);
  assert.equal(twice.approvalPlan.steps[0].selectors.length,2);
});
