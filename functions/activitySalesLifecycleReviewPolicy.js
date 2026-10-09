"use strict";
// Phase 2A-5B2 isolated, fail-closed review authority. No Firebase / endpoint.
const crypto = require("node:crypto");
const BRANDS = new Set(["cyj", "anniu", "yibo"]);
const KINDS = new Set(["CORRECTION", "CANCELLATION", "REFUND", "SPECIAL_PRICE"]);
const DECISIONS = new Set(["APPROVE", "REJECT"]);
const ROLES = new Set(["director", "manager", "trainer", "store", "therapist"]);
const SCHEMA = "activity-sales-lifecycle-review-policy-v1";
const STATE_SCHEMA = "activity-sales-lifecycle-review-state-v1";
const ID = /^[A-Za-z0-9_\u3400-\u9fff][A-Za-z0-9_\-\u3400-\u9fff]{0,159}$/;
function reject(code, status=409) {const e=new Error(code); e.code=code; e.status=status; throw e;}
function stableActor(raw) {
  if(!raw || typeof raw!=="object" || !ROLES.has(raw.roleId) || typeof raw.accountId!=="string" || !ID.test(raw.accountId))
    reject("LIFECYCLE_REVIEW_ACTOR_INVALID",400);
  return {roleId:raw.roleId,accountId:raw.accountId};
}
function keyOf(a){ const v=stableActor(a); return `${v.roleId}\u0000${v.accountId}`; }
function digest(value){return crypto.createHash("sha256").update(value).digest("hex");}
function reviewerDocumentId(requestId,actor){return `decision_${digest(`${requestId}\u0000${keyOf(actor)}`).slice(0,48)}`;}
function parsePlan(raw,kind,brandId){
  if(!raw || raw.schemaVersion!==SCHEMA || raw.enabled!==true || raw.brandId!==brandId || !BRANDS.has(brandId) ||
     !Number.isSafeInteger(raw.revision) || raw.revision<1 || !KINDS.has(kind)) reject("LIFECYCLE_REVIEW_POLICY_UNAVAILABLE",403);
  const flow=raw.flows?.[kind];
  if(!flow || flow.enabled!==true || !Array.isArray(flow.steps) || !flow.steps.length || flow.steps.length>8 ||
     typeof flow.allowRequesterApproval!=="boolean") reject("LIFECYCLE_REVIEW_FLOW_DISABLED",403);
  const groups=raw.groups||{};
  if(typeof groups!=="object" || Array.isArray(groups)) reject("LIFECYCLE_REVIEW_GROUPS_INVALID");
  const all=new Set(), stepIds=new Set();
  const steps=flow.steps.map(s=>{
    if(!s || typeof s.stepId!=="string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(s.stepId) ||
       stepIds.has(s.stepId) || !["ANY","ALL"].includes(s.quorum) ||
       !Array.isArray(s.reviewers) || !s.reviewers.length || s.reviewers.length>30)
      reject("LIFECYCLE_REVIEW_STEP_INVALID",403);
    stepIds.add(s.stepId);
    const members=[];
    for(const sel of s.reviewers){
      if(!sel || !["account","group"].includes(sel.type))reject("LIFECYCLE_REVIEW_SELECTOR_INVALID",403);
      if(sel.type==="account")members.push(stableActor(sel));
      else{
        const list=groups[sel.groupId];
        if(typeof sel.groupId!=="string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(sel.groupId) ||
           !Array.isArray(list) || !list.length || list.length>50)
          reject("LIFECYCLE_REVIEW_GROUP_INVALID",403);
        members.push(...list.map(stableActor));
      }
    }
    const local=new Map(members.map(m=>[keyOf(m),m]));
    if(!local.size || local.size>50)reject("LIFECYCLE_REVIEW_MEMBERS_INVALID",403);
    // A person may not fulfill two separate sequential steps.
    for(const k of local.keys()){
      if(all.has(k))reject("LIFECYCLE_REVIEW_CROSS_STEP_DUPLICATE",403);
      all.add(k);
    }
    return {stepId:s.stepId,quorum:s.quorum,members:[...local.values()].sort((a,b)=>keyOf(a).localeCompare(keyOf(b)))};
  });
  const plan={brandId,kind,policyRevision:raw.revision,allowRequesterApproval:flow.allowRequesterApproval,steps};
  return {...plan,planHash:digest(JSON.stringify(plan))};
}
function normalizePrior(raw,requestId,plan){
  if(!raw)return {status:"PENDING_REVIEW",reviewRevision:0,stepIndex:0,decisions:{}};
  if(raw.schemaVersion!==STATE_SCHEMA || raw.requestId!==requestId || raw.brandId!==plan.brandId ||
     raw.kind!==plan.kind || raw.planHash!==plan.planHash || raw.policyRevision!==plan.policyRevision ||
     !Number.isSafeInteger(raw.reviewRevision) || raw.reviewRevision<1 ||
     !Number.isSafeInteger(raw.stepIndex) || raw.stepIndex<0 || raw.stepIndex>=plan.steps.length ||
     !raw.decisions || typeof raw.decisions!=="object" || Array.isArray(raw.decisions))
    reject("LIFECYCLE_REVIEW_STATE_STALE",409);
  if(!["PENDING_REVIEW","APPROVED_PENDING_SETTLEMENT","REJECTED"].includes(raw.status))
    reject("LIFECYCLE_REVIEW_STATE_INVALID",409);
  return {status:raw.status,reviewRevision:raw.reviewRevision,stepIndex:raw.stepIndex,decisions:raw.decisions};
}
function applyDecision({requestId,request,plan,prior,actor,decision,reasonNote="",expectedReviewRevision}){
  if(typeof requestId!=="string" || !/^life_[a-f0-9]{48}$/.test(requestId) || !request ||
     request.state!=="PENDING_REVIEW" || request.brandId!==plan.brandId || request.event?.kind!==plan.kind)
    reject("LIFECYCLE_REVIEW_REQUEST_INVALID",409);
  if(!DECISIONS.has(decision) || typeof reasonNote!=="string" || reasonNote.length>500 ||
     /[\u0000-\u001f\u007f]/.test(reasonNote) || (decision==="REJECT" && reasonNote.trim().length<3))
    reject("LIFECYCLE_REVIEW_DECISION_INVALID",400);
  const current=normalizePrior(prior,requestId,plan);
  if(!Number.isSafeInteger(expectedReviewRevision) || expectedReviewRevision!==current.reviewRevision)
    reject("LIFECYCLE_REVIEW_REVISION_CONFLICT",409);
  if(current.status!=="PENDING_REVIEW")reject("LIFECYCLE_REVIEW_TERMINAL",409);
  const who=stableActor(actor), actorKey=keyOf(who), requestKey=keyOf({roleId:request.requestedByRole,accountId:request.requestedByAccountId});
  if(!plan.allowRequesterApproval && actorKey===requestKey)reject("LIFECYCLE_REVIEW_SELF_APPROVAL_FORBIDDEN",403);
  const step=plan.steps[current.stepIndex];
  if(!step.members.some(m=>keyOf(m)===actorKey))reject("LIFECYCLE_REVIEW_NOT_AUTHORIZED",403);
  const id=digest(actorKey).slice(0,48);
  if(current.decisions[id])reject("LIFECYCLE_REVIEW_DUPLICATE_ACTOR",409);
  if(Object.keys(current.decisions).length>=50)reject("LIFECYCLE_REVIEW_TOO_MANY_DECISIONS",409);
  const decisions={...current.decisions,[id]:{stepId:step.stepId,decision,roleId:who.roleId,accountId:who.accountId}};
  const approvals=Object.values(decisions).filter(d=>d.stepId===step.stepId && d.decision==="APPROVE").length;
  const complete=step.quorum==="ANY"?approvals>=1:approvals===step.members.length;
  const nextIndex=decision==="APPROVE" && complete && current.stepIndex<plan.steps.length-1 ? current.stepIndex+1:current.stepIndex;
  const status=decision==="REJECT"?"REJECTED": complete && nextIndex===current.stepIndex && current.stepIndex===plan.steps.length-1
    ?"APPROVED_PENDING_SETTLEMENT":"PENDING_REVIEW";
  return {schemaVersion:STATE_SCHEMA,brandId:plan.brandId,kind:plan.kind,requestId,
    policyRevision:plan.policyRevision,planHash:plan.planHash,reviewRevision:current.reviewRevision+1,
    stepIndex:nextIndex,decisions,status,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
}
module.exports={SCHEMA,STATE_SCHEMA,parsePlan,applyDecision,reviewerDocumentId,stableActor,reject};
