import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
const require=createRequire(import.meta.url);
const original=Module._load;
let factory;
try {
  Module._load=function(request,parent,isMain) {
    if (request==="firebase-functions/v2/https") return {onRequest:(_opts,handler)=>handler};
    if (request==="./deviceApproval" && parent?.filename.endsWith("activitySalesAuthority.js")) return {
      getBrandCollection:(db,brand,name)=>db.brandCollection(brand,name),
      requireFirebaseRequestAuth:async(req)=>({ok:true,decoded:req.mockClaims}),
      verifyTrustedApplicationActor:async({actor})=>actor.deviceId==="trusted"&&actor.credentialPassword==="fresh"
        ? {ok:true,actorRole:actor.roleId,actorAccountId:actor.accountId,actorName:actor.accountId}:{ok:false},
    };
    return original.apply(this,arguments);
  };
  ({createActivitySalesAuthorityFunctions:factory}=require("../functions/activitySalesAuthority.js"));
} finally {Module._load=original;}
const {reviewerKey}=require("../functions/activitySalesApprovalInbox.js");
const a={roleId:"director",accountId:"a"},b={roleId:"director",accountId:"b"},c={roleId:"trainer",accountId:"c"};
function make() {
  const docs={
    "cyj/activity_campaigns/autumn":{brandId:"cyj",campaignId:"autumn",revision:4,status:"pending_approval",currentVersionId:"autumn_v001",versionSequence:1,createdBy:c},
    "cyj/activity_campaign_approvals/autumn_v001":{brandId:"cyj",campaignId:"autumn",versionId:"autumn_v001",status:"pending",currentStepIndex:0,
      steps:[{stepId:"s1",label:"第一關",quorum:"all",members:[a,b]},{stepId:"s2",label:"第二關",quorum:"any",members:[c]}],
      creator:c,allowCreatorApproval:true,decisions:{},activeReviewerKeys:[reviewerKey(a),reviewerKey(b)]},
    "cyj/activity_campaign_versions/autumn_v001":{brandId:"cyj",campaignId:"autumn",versionId:"autumn_v001",campaignSnapshot:{title:"秋季",approvalPlan:{releaseMode:"manual_after_approval"}}},
  };
  const db={brandCollection:(brand,name)=>({doc:(id)=>({path:`${brand}/${name}/${id}`})}),
    runTransaction:async(fn)=>{
      const staged=[];
      const tx={get:async(ref)=>{const data=docs[ref.path];return {exists:Boolean(data),data:()=>data};},
        set:(ref,fields,opts)=>staged.push({path:ref.path,fields,merge:opts?.merge===true}),
        create:(ref,fields)=>staged.push({path:ref.path,fields,merge:false}),
      };
      const outcome=await fn(tx);
      for(const op of staged) docs[op.path]=op.merge?{...(docs[op.path]||{}),...op.fields}:op.fields;
      return outcome;
    }};
  const admin={firestore:{FieldValue:{serverTimestamp:()=>"SERVER_TS"}}};
  const api=factory({admin,db});
  async function request(target,action="approve",expectedRevision=docs["cyj/activity_campaigns/autumn"].revision) {
    const claims={drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:"cyj",...target};
    let status=200,payload=null;
    await api.manageActivityCampaign({method:"POST",mockClaims:claims,body:{brandId:"cyj",action,campaignId:"autumn",expectedRevision,
      actor:{...target,deviceId:"trusted",credentialPassword:"fresh"}}},{status(c){status=c;return this;},json(x){payload=x;return this;}});
    return {status,payload};
  }
  return {docs,request};
}
test("all-quorum first approval atomically removes decided reviewer; stale OCC rejected",async()=>{
  const t=make();const one=await t.request(a,"approve",4);
  assert.equal(one.status,200);assert.equal(one.payload.revision,5);
  assert.equal(t.docs["cyj/activity_campaigns/autumn"].status,"pending_approval");
  assert.deepEqual(t.docs["cyj/activity_campaign_approvals/autumn_v001"].activeReviewerKeys,[reviewerKey(b)]);
  const stale=await t.request(b,"approve",4);
  assert.equal(stale.status,409);assert.equal(stale.payload.code,"CAMPAIGN_CONFLICT");
  assert.deepEqual(t.docs["cyj/activity_campaign_approvals/autumn_v001"].activeReviewerKeys,[reviewerKey(b)]);
});
test("completion of first quorum assigns only next-step reviewers in same transaction",async()=>{
  const t=make();await t.request(a,"approve",4);
  const result=await t.request(b,"approve",5);
  assert.equal(result.status,200);
  assert.equal(t.docs["cyj/activity_campaign_approvals/autumn_v001"].currentStepIndex,1);
  assert.deepEqual(t.docs["cyj/activity_campaign_approvals/autumn_v001"].activeReviewerKeys,[reviewerKey(c)]);
});
test("final approval and return both clear active inbox keys",async()=>{
  const t=make();await t.request(a);await t.request(b);await t.request(c);
  assert.equal(t.docs["cyj/activity_campaigns/autumn"].status,"approved");
  assert.deepEqual(t.docs["cyj/activity_campaign_approvals/autumn_v001"].activeReviewerKeys,[]);
  const r=make();const returned=await r.request(a,"return_for_changes",4);
  assert.equal(returned.status,200);
  assert.deepEqual(r.docs["cyj/activity_campaign_approvals/autumn_v001"].activeReviewerKeys,[]);
});
