import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
const require=createRequire(import.meta.url);
const original=Module._load;
let factory;
try {
  Module._load=function(request,parent,isMain) {
    if (request==="firebase-functions/v2/https") return { onRequest:(_settings,handler)=>handler };
    if (request==="./deviceApproval" && parent?.filename.endsWith("activitySalesAuthority.js")) return {
      getBrandCollection:(db,brand,name)=>db.brandCollection(brand,name),
      requireFirebaseRequestAuth:async(req)=>({ok:true,decoded:req.mockClaims}),
      verifySuperAdminActor:async()=>({ok:false}),
      verifyTrustedApplicationActor:async({actor}) => actor.deviceId==="trusted" && actor.credentialPassword==="right-password"
        ? {ok:true,actorRole:actor.roleId,actorAccountId:actor.accountId,actorName:"actor"} : {ok:false},
    };
    return original.apply(this,arguments);
  };
  ({createActivitySalesAuthorityFunctions:factory}=require("../functions/activitySalesAuthority.js"));
} finally {Module._load=original;}
const cyjClaims={drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:"cyj",roleId:"trainer",accountId:"creator1"};
const bobClaims={...cyjClaims,roleId:"director",accountId:"reviewer1"};
const basicActor=(claims)=>({roleId:claims.roleId,accountId:claims.accountId,deviceId:"trusted",credentialPassword:"right-password"});
function makeContext() {
  const reads=[];
  const docs={
    "cyj/activity_sales_policy/current":{schemaVersion:"activity-sales-policy-v1",revision:2,
      groups:{team:{label:"活動小組",members:[{roleId:"trainer",accountId:"creator1"}]}},
      creatorSelectors:[{type:"group",groupId:"team"}],directPublishSelectors:[],publisherSelectors:[]},
    "cyj/activity_campaigns/launch":{brandId:"cyj",campaignId:"launch",revision:1,status:"pending_approval",createdBy:{roleId:"trainer",accountId:"creator1"},currentVersionId:"launch_v001",
      draft:{title:"十月",startDate:"2026-10-01",endDate:"2026-10-31",packages:[{packageId:"p1",name:"套組",salePrice:300,items:[{itemId:"i1",name:"課程",quantity:1,attributedAmount:300}]}],approvalPlan:{mode:"any",selectors:[{type:"account",account:{roleId:"director",accountId:"reviewer1"}}]},credentialPassword:"do_not_leak"}},
    "cyj/activity_campaign_approvals/launch_v001":{brandId:"cyj",campaignId:"launch",versionId:"launch_v001",status:"pending",currentStepIndex:0,allowCreatorApproval:false,
      creator:{roleId:"trainer",accountId:"creator1"},steps:[{stepId:"approval",label:"主管核准",quorum:"any",members:[{roleId:"director",accountId:"reviewer1"}]}],decisions:{secret:{decision:"unrelated"}}},
  };
  const db={brandCollection:(brand,name)=>({doc:(id)=>({path:`${brand}/${name}/${id}`})}),
    runTransaction:async(fn)=>fn({get:async(ref)=>{reads.push(ref.path);const data=docs[ref.path];return {exists:Boolean(data),data:()=>data};}})};
  const api=factory({admin:{},db});
  async function request(action,{claims=cyjClaims,actor=basicActor(claims),campaignId="launch",brandId="cyj",method="POST"}={}) {
    let status=200,payload=null;
    const res={status(code){status=code;return this;},json(data){payload=data;return this;}};
    await api.getActivitySalesWorkspace({method,mockClaims:claims,body:{action,brandId,campaignId,actor}},res);
    return {status,payload};
  }
  return {request,reads,docs};
}
test("wrong brand/identity token is denied before any private Firestore read",async()=>{
  const ctx=makeContext();const result=await ctx.request("get_campaign",{claims:{...cyjClaims,brandId:"anniu"}});
  assert.equal(result.status,403);assert.deepEqual(ctx.reads,[]);
});
test("untrusted device or invalid fresh credential is denied before private reads",async()=>{
  const ctx=makeContext();const result=await ctx.request("get_campaign",{actor:{...basicActor(cyjClaims),credentialPassword:"bad"}});
  assert.equal(result.status,403);assert.deepEqual(ctx.reads,[]);
});
test("capabilities reads only one policy doc without member list",async()=>{
  const ctx=makeContext();const result=await ctx.request("capabilities");
  assert.equal(result.status,200);assert.deepEqual(ctx.reads,["cyj/activity_sales_policy/current"]);
  assert.deepEqual(result.payload.capabilities.groups,[{groupId:"team",label:"活動小組"}]);
  assert.equal(result.payload.capabilities.groups[0].members,undefined);
});
test("unassigned role cannot enumerate or view private campaign",async()=>{
  const ctx=makeContext();const claims={...cyjClaims,roleId:"store",accountId:"outsider"};
  const result=await ctx.request("get_campaign",{claims});
  assert.equal(result.status,403);
  assert.equal(ctx.reads.length,3);
  assert.equal(result.payload.campaign,undefined);
});
test("current reviewer gets one campaign and one approval with sanitized immutable draft",async()=>{
  const ctx=makeContext();const result=await ctx.request("get_campaign",{claims:bobClaims});
  assert.equal(result.status,200);assert.equal(ctx.reads.length,3);
  assert.equal(result.payload.capabilities.canApprove,true);
  assert.equal(result.payload.campaign.review.stepLabel,"主管核准");
  assert.equal(result.payload.campaign.draft.credentialPassword,undefined);
  assert.equal(result.payload.campaign.review.members,undefined);
  assert.equal(result.payload.campaign.review.decisions,undefined);
});
test("corrupt cross-brand campaign identity fails closed after scoped lookup",async()=>{
  const ctx=makeContext();ctx.docs["cyj/activity_campaigns/launch"].brandId="anniu";
  const result=await ctx.request("get_campaign");
  assert.equal(result.status,409);assert.equal(result.payload.code,"CAMPAIGN_IDENTITY_MISMATCH");
});
test("unsupported method is rejected without reads",async()=>{
  const ctx=makeContext();const result=await ctx.request("capabilities",{method:"GET"});
  assert.equal(result.status,405);assert.deepEqual(ctx.reads,[]);
});
