"use strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const test=require("node:test");
const assert=require("node:assert/strict");
const {parsePlan,applyDecision,reviewerDocumentId}=require("../functions/activitySalesLifecycleReviewPolicy");
const requestId=`life_${"a".repeat(48)}`;
const account=(roleId,accountId)=>({type:"account",roleId,accountId});
const groups={finance:[{roleId:"director",accountId:"finance01"},{roleId:"director",accountId:"finance02"}]};
const makePolicy=(brand="cyj",steps=[{stepId:"store_gate",quorum:"ANY",reviewers:[account("store","S001")]},
  {stepId:"finance_gate",quorum:"ALL",reviewers:[{type:"group",groupId:"finance"}]}],allowRequesterApproval=false)=>({
  schemaVersion:"activity-sales-lifecycle-review-policy-v1",brandId:brand,revision:1,enabled:true,groups,
  flows:{REFUND:{enabled:true,allowRequesterApproval,steps}}
});
const request=(brand="cyj",requestedByRole="therapist",requestedByAccountId="T001")=>({brandId:brand,state:"PENDING_REVIEW",event:{kind:"REFUND"},requestedByRole,requestedByAccountId});
const act=(p,r,prev,a,decision="APPROVE",expectedReviewRevision=0,reasonNote="")=>applyDecision({plan:p,request:r,
  requestId,prior:prev,actor:a,decision,expectedReviewRevision,reasonNote});
const denied=(f,code)=>assert.throws(f,e=>e.code===code);
test("brand-specific quorum ANY then ALL stays pending settlement, no KPI/revenue mutation",()=>{
  const plan=parsePlan(makePolicy(),"REFUND","cyj"),r=request();
  let st=act(plan,r,null,{roleId:"store",accountId:"S001"});
  assert.equal(st.status,"PENDING_REVIEW");assert.equal(st.stepIndex,1);assert.equal(st.reviewRevision,1);
  st=act(plan,r,st,{roleId:"director",accountId:"finance01"},"APPROVE",1);
  assert.equal(st.status,"PENDING_REVIEW");
  st=act(plan,r,st,{roleId:"director",accountId:"finance02"},"APPROVE",2);
  assert.equal(st.status,"APPROVED_PENDING_SETTLEMENT");assert.equal(st.formalRevenueDelta,0);
  assert.equal(st.officialKpiAllocation,"UNDECIDED");
  denied(()=>act(plan,r,st,{roleId:"director",accountId:"finance02"},"APPROVE",3),"LIFECYCLE_REVIEW_TERMINAL");
});
test("missing policy, disabled flow, cross-brand policy all fail closed",()=>{
  for(const brand of ["anniu","yibo"])denied(()=>parsePlan(makePolicy("cyj"),"REFUND",brand),"LIFECYCLE_REVIEW_POLICY_UNAVAILABLE");
  denied(()=>parsePlan(null,"REFUND","cyj"),"LIFECYCLE_REVIEW_POLICY_UNAVAILABLE");
  denied(()=>parsePlan(makePolicy(),"CANCELLATION","cyj"),"LIFECYCLE_REVIEW_FLOW_DISABLED");
});
test("no implicit approver by role; creator self-approval denied unless policy explicitly enables",()=>{
  const p=parsePlan(makePolicy("cyj",[{stepId:"single",quorum:"ANY",reviewers:[account("store","S001")]}]),"REFUND","cyj");
  denied(()=>act(p,request(),null,{roleId:"store",accountId:"S002"}),"LIFECYCLE_REVIEW_NOT_AUTHORIZED");
  denied(()=>act(p,request("cyj","store","S001"),null,{roleId:"store",accountId:"S001"}),"LIFECYCLE_REVIEW_SELF_APPROVAL_FORBIDDEN");
  const yes=parsePlan(makePolicy("cyj",[{stepId:"single",quorum:"ANY",reviewers:[account("store","S001")]}],true),"REFUND","cyj");
  assert.equal(act(yes,request("cyj","store","S001"),null,{roleId:"store",accountId:"S001"}).status,"APPROVED_PENDING_SETTLEMENT");
});
test("policy revision and reviewer group change block historical partial approval",()=>{
  const raw=makePolicy(),p=parsePlan(raw,"REFUND","cyj"),r=request();
  const first=act(p,r,null,{roleId:"store",accountId:"S001"});
  const newPlan=parsePlan({...raw,revision:2},"REFUND","cyj");
  denied(()=>act(newPlan,r,first,{roleId:"director",accountId:"finance01"},"APPROVE",1),"LIFECYCLE_REVIEW_STATE_STALE");
});
test("single actor cannot complete two sequential steps; no duplicate group member counted twice",()=>{
  denied(()=>parsePlan(makePolicy("cyj",[{stepId:"a",quorum:"ANY",reviewers:[account("director","X")]},
    {stepId:"b",quorum:"ANY",reviewers:[account("director","X")]}]),"REFUND","cyj"),"LIFECYCLE_REVIEW_CROSS_STEP_DUPLICATE");
  const p=parsePlan(makePolicy("cyj",[{stepId:"b",quorum:"ALL",reviewers:[account("director","A"),account("director","A")]}]),"REFUND","cyj");
  assert.equal(p.steps[0].members.length,1);
});
test("stale OCC, duplicate actor, outsider, malformed reason are all denied",()=>{
  const p=parsePlan(makePolicy("cyj",[{stepId:"b",quorum:"ALL",reviewers:[account("store","A"),account("store","B")]}]),"REFUND","cyj"),r=request();
  const a=act(p,r,null,{roleId:"store",accountId:"A"});
  denied(()=>act(p,r,a,{roleId:"store",accountId:"B"},"APPROVE",0),"LIFECYCLE_REVIEW_REVISION_CONFLICT");
  denied(()=>act(p,r,a,{roleId:"store",accountId:"A"},"APPROVE",1),"LIFECYCLE_REVIEW_DUPLICATE_ACTOR");
  denied(()=>act(p,r,a,{roleId:"store",accountId:"Z"},"APPROVE",1),"LIFECYCLE_REVIEW_NOT_AUTHORIZED");
  denied(()=>act(p,r,a,{roleId:"store",accountId:"B"},"REJECT",1,""),"LIFECYCLE_REVIEW_DECISION_INVALID");
});
test("REJECT is terminal; decision IDs isolate both request and account",()=>{
  const p=parsePlan(makePolicy("cyj",[{stepId:"single",quorum:"ANY",reviewers:[account("store","S001")]}]),"REFUND","cyj"),r=request();
  const result=act(p,r,null,{roleId:"store",accountId:"S001"},"REJECT",0,"理由充足");
  assert.equal(result.status,"REJECTED");
  denied(()=>act(p,r,result,{roleId:"store",accountId:"S001"},"APPROVE",1),"LIFECYCLE_REVIEW_TERMINAL");
  assert.notEqual(reviewerDocumentId(requestId,{roleId:"store",accountId:"S001"}),
    reviewerDocumentId(requestId,{roleId:"store",accountId:"S002"}));
  assert.notEqual(reviewerDocumentId(requestId,{roleId:"store",accountId:"S001"}),
    reviewerDocumentId(`life_${"b".repeat(48)}`,{roleId:"store",accountId:"S001"}));
});
test("policy rejects unsupported roles and invalid group selectors",()=>{
  denied(()=>parsePlan(makePolicy("cyj",[{stepId:"a",quorum:"ANY",reviewers:[account("unknown","Z")]}]),"REFUND","cyj"),"LIFECYCLE_REVIEW_ACTOR_INVALID");
  denied(()=>parsePlan(makePolicy("cyj",[{stepId:"a",quorum:"ANY",reviewers:[{type:"group",groupId:"missing"}]}]),"REFUND","cyj"),"LIFECYCLE_REVIEW_GROUP_INVALID");
});
