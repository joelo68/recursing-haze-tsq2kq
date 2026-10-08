import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
const require=createRequire(import.meta.url);
const original=Module._load;
let factory;
try {
  Module._load=function(request,parent,isMain) {
    if (request==="firebase-functions/v2/https") return {onRequest:(_options,handler)=>handler};
    if (request==="./deviceApproval" && parent?.filename.endsWith("activitySalesAuthority.js")) return {
      getBrandCollection:(db,brand,name)=>db.brandCollection(brand,name),
      requireFirebaseRequestAuth:async(req)=>({ok:true,decoded:req.mockClaims}),
      verifyTrustedApplicationActor:async({actor})=>actor.deviceId==="trusted" && actor.credentialPassword==="fresh"
        ? {ok:true,actorRole:actor.roleId,actorAccountId:actor.accountId,actorName:"目前使用者"}:{ok:false},
      verifySuperAdminActor:async({actor})=>actor.accountId==="superadmin" && actor.credentialPassword==="fresh"
        ? {ok:true,actorRole:"director",actorAccountId:"superadmin",actorName:"最高管理者"}:{ok:false},
    };
    return original.apply(this,arguments);
  };
  ({createActivitySalesAuthorityFunctions:factory}=require("../functions/activitySalesAuthority.js"));
} finally {Module._load=original;}
const claims={drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:"cyj",roleId:"director",accountId:"reviewer1"};
const actor=(c=claims)=>({roleId:c.roleId,accountId:c.accountId,deviceId:"trusted",credentialPassword:"fresh"});
function ctx() {
  const reads=[],queries=[],docs={
    "cyj/activity_sales_policy/current":{revision:4,groups:{team:{label:"團隊",members:[{roleId:"director",accountId:"reviewer1"}]}},creatorSelectors:[{type:"group",groupId:"team"}],directPublishSelectors:[],publisherSelectors:[]},
  };
  const approval={brandId:"cyj",campaignId:"p1",versionId:"p1_v001",campaignTitle:"第一活動",status:"pending",currentStepIndex:0,
    steps:[{stepId:"first",label:"第一關",quorum:"any",members:[{roleId:"director",accountId:"reviewer1"}]}],decisions:{},creator:{roleId:"trainer",accountId:"creator1"},allowCreatorApproval:false};
  const {reviewerKey}=require("../functions/activitySalesApprovalInbox.js");
  approval.activeReviewerKeys=[reviewerKey(claims)];
  docs["cyj/activity_campaign_approvals/p1_v001"]=approval;
  const db={brandCollection:(brand,name)=>({
    doc:(id)=>({path:`${brand}/${name}/${id}`,get:async()=>{reads.push(`${brand}/${name}/${id}`);const data=docs[`${brand}/${name}/${id}`];return {exists:!!data,data:()=>data};}}),
    where:(field,op,value)=>{queries.push({brand,name,field,op,value});return {limit:(amount)=>({get:async()=>{
      assert.equal(amount,20);
      const selected=Object.entries(docs).filter(([key,data])=>key.startsWith(`${brand}/${name}/`) && data[field]?.includes(value));
      reads.push(`QUERY ${brand}/${name} ${selected.length}`);
      return {size:selected.length,docs:selected.map(([,data])=>({data:()=>data}))};
    }})};},
  }),runTransaction:async(fn)=>fn({get:async(ref)=>{reads.push(ref.path);const data=docs[ref.path];return {exists:!!data,data:()=>data};}})};
  const api=factory({admin:{},db});
  async function request(action,{mockClaims=claims,inputActor=actor(mockClaims),brandId="cyj"}={}) {
    let status=200,payload=null;
    await api.getActivitySalesWorkspace({method:"POST",mockClaims,body:{action,actor:inputActor,brandId}},
      {status(c){status=c;return this;},json(data){payload=data;return this;}});
    return {status,payload};
  }
  return {request,docs,reads,queries,approval};
}
test("single scoped inbox query derives reviewer key from verified identity",async()=>{
  const t=ctx();const r=await t.request("approval_inbox");
  assert.equal(r.status,200);assert.equal(r.payload.inbox.length,1);
  assert.deepEqual(t.queries.map(({brand,name,field,op})=>({brand,name,field,op})),[{brand:"cyj",name:"activity_campaign_approvals",field:"activeReviewerKeys",op:"array-contains"}]);
  assert.equal(t.reads.length,1);assert.equal(r.payload.inbox[0].campaignId,"p1");
  assert.equal(JSON.stringify(r.payload).includes("members"),false);
});
test("cross-brand token mismatch refuses inbox before Firestore access",async()=>{
  const t=ctx();const c={...claims,brandId:"anniu"};const r=await t.request("approval_inbox",{mockClaims:c,inputActor:actor(c)});
  assert.equal(r.status,403);assert.deepEqual(t.queries,[]);assert.deepEqual(t.reads,[]);
});
test("untrusted actor refuses inbox before query",async()=>{
  const t=ctx();const r=await t.request("approval_inbox",{inputActor:{...actor(),deviceId:"unknown"}});
  assert.equal(r.status,403);assert.deepEqual(t.queries,[]);
});
test("policy read denied for non-superadmin despite valid session",async()=>{
  const t=ctx();const r=await t.request("get_policy");
  assert.equal(r.status,403);assert.deepEqual(t.reads,[]);
});
test("fresh superadmin may load policy members and revision from one scoped doc",async()=>{
  const t=ctx();const c={...claims,accountId:"superadmin"};const r=await t.request("get_policy",{mockClaims:c,inputActor:actor(c)});
  assert.equal(r.status,200);assert.equal(r.payload.policy.revision,4);
  assert.equal(r.payload.policy.groups.team.members[0].accountId,"reviewer1");
  assert.deepEqual(t.reads,["cyj/activity_sales_policy/current"]);
});
test("missing brand policy returns revision zero for first OCC save",async()=>{
  const t=ctx();delete t.docs["cyj/activity_sales_policy/current"];
  const c={...claims,accountId:"superadmin"};const r=await t.request("get_policy",{mockClaims:c,inputActor:actor(c)});
  assert.equal(r.status,200);assert.equal(r.payload.policy.revision,0);assert.equal(r.payload.policyReady,false);
});
