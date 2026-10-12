"use strict";
// L3B2B1 PURE contract only: not an authorization service, Firestore writer or posting grant.
// Inputs are untrusted until a future backend re-reads brand-private docs inside one transaction.
const crypto = require("node:crypto");
const {DECISION_CODES} = require("./activitySalesSpecialPriceRecognitionWorksheet");
const BRANDS = new Set(["cyj", "anniu", "yibo"]);
const ROLES = new Set(["director", "manager", "trainer", "store", "therapist"]);
const ACCOUNT = /^[A-Za-z0-9_\u3400-\u9fff][A-Za-z0-9_\-\u3400-\u9fff]{0,159}$/;
const AUTH_SCHEMA = "activity-sales-special-price-signoff-authority-v1";
const STATE_SCHEMA = "activity-sales-special-price-signoff-state-v1";
const STAGES = Object.freeze(["BUSINESS", "FINANCE"]);
const STATE_FIELDS = ["schemaVersion","brandId","requestId","signoffId","draftFingerprint","worksheetFingerprint","authorityRevision","authorityHash","requestedBy","reviewRevision","status","decisions","authorityVerified","businessPolicyApproved","financialPeriodAuthority","postingAllowed","recognizedAmount","recognizedQuantity","calculatedAsp","recognitionMonth","formalRevenueDelta","officialKpiAllocation"];
const DRAFT_FIELDS = new Set(["schemaVersion","state","worksheetFingerprint","draftFingerprint","brandId","requestId","reviewRevision","expectedDailyRevision","sourceMonth","approvalMonth","crossMonth","completedDecisionCount","requiredDecisionCount","decisions","businessAuthority","financialPeriodAuthority","approvedPolicyRevision","approvedPolicyHash","postingAllowed","recognitionDate","recognitionMonth","recognizedAmount","recognizedQuantity","calculatedAsp","formalRevenueDelta","officialKpiAllocation"]);
function reject(code, status=409){const e = new Error(code);e.code=code;e.status=status;throw e;}
function plain(x){return x!==null && typeof x==="object" && !Array.isArray(x) && (Object.getPrototypeOf(x)===Object.prototype || Object.getPrototypeOf(x)===null);}
function exactKeys(obj,expected){return plain(obj)&&Object.keys(obj).length===expected.length&&expected.every(k=>Object.prototype.hasOwnProperty.call(obj,k));}
function digest(value){return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function actor(raw){
  if(!exactKeys(raw,["roleId","accountId"]) || !ROLES.has(raw.roleId) || typeof raw.accountId!=="string" || !ACCOUNT.test(raw.accountId))reject("SPECIAL_PRICE_SIGNOFF_ACTOR_INVALID",403);
  return {roleId:raw.roleId,accountId:raw.accountId};
}
const actorKey=a=>`${a.roleId}\0${a.accountId}`;
function parseSignoffAuthority(raw,brandId){
  if(!BRANDS.has(brandId)|| !exactKeys(raw,["schemaVersion","brandId","revision","enabled","reviewers"]) ||
    raw.schemaVersion!==AUTH_SCHEMA ||raw.brandId!==brandId||raw.enabled!==true||!Number.isSafeInteger(raw.revision)||raw.revision<1||
    !exactKeys(raw.reviewers,STAGES))reject("SPECIAL_PRICE_SIGNOFF_AUTHORITY_UNAVAILABLE",403);
  const used = new Set();
  const reviewers={};
  for(const stage of STAGES){
    const list=raw.reviewers[stage];
    if(!Array.isArray(list)||list.length<1||list.length>15)reject("SPECIAL_PRICE_SIGNOFF_REVIEWERS_INVALID",403);
    reviewers[stage]=list.map(actor).sort((a,b)=>actorKey(a).localeCompare(actorKey(b)));
    for(const a of reviewers[stage]){
      const key=actorKey(a);
      if(used.has(key))reject("SPECIAL_PRICE_SIGNOFF_DUPLICATE_REVIEWER",403);
      used.add(key);
    }
  }
  const canonical={schemaVersion:AUTH_SCHEMA,brandId,revision:raw.revision,reviewers};
  return {...canonical,authorityHash:digest(canonical)};
}
function assertCompleteDraft(raw,brandId){
  if(!exactKeys(raw,[...DRAFT_FIELDS])||
    raw.schemaVersion!=="activity-sales-special-price-policy-decision-draft-v1"||
    raw.state!=="READY_FOR_BUSINESS_REVIEW_NO_POSTING" || raw.brandId!==brandId ||
    !/^price_[0-9a-f]{48}$/.test(raw.requestId||"") ||
    !/^[0-9a-f]{64}$/.test(raw.worksheetFingerprint||"") ||
    !/^[0-9a-f]{64}$/.test(raw.draftFingerprint||"") ||
    raw.postingAllowed!==false || raw.businessAuthority!=="NOT_VERIFIED" ||
    raw.financialPeriodAuthority!=="NOT_GRANTED" || raw.approvedPolicyRevision!==null ||
    raw.approvedPolicyHash!==null || raw.formalRevenueDelta!==0 ||
    raw.officialKpiAllocation!=="UNDECIDED" || raw.recognitionDate!==null ||
    raw.recognitionMonth!==null || raw.recognizedAmount!==null ||
    raw.recognizedQuantity!==null || raw.calculatedAsp!==null ||
    !Number.isSafeInteger(raw.reviewRevision) || raw.reviewRevision<1 ||
    !Number.isSafeInteger(raw.expectedDailyRevision) || raw.expectedDailyRevision<0 ||
    typeof raw.crossMonth!=="boolean" || !/^\d{4}-\d{2}$/.test(raw.sourceMonth||"") ||
    !/^\d{4}-\d{2}$/.test(raw.approvalMonth||"") ||raw.crossMonth!==(raw.sourceMonth!==raw.approvalMonth)||
    raw.completedDecisionCount!==DECISION_CODES.length || raw.requiredDecisionCount!==DECISION_CODES.length ||
    !Array.isArray(raw.decisions)||raw.decisions.length!==DECISION_CODES.length)
    reject("SPECIAL_PRICE_SIGNOFF_DRAFT_INVALID");
  for(let i=0;i<DECISION_CODES.length;i++){
    const d=raw.decisions[i];
    if(!exactKeys(d,["code","status","proposalText","rationale"]) ||
      d.code!==DECISION_CODES[i] || d.status!=="PROPOSED_PENDING_AUTHORITY" ||
      ![d.proposalText,d.rationale].every(v=>typeof v==="string" && v===v.trim() && v.length>=3 && v.length<=800 && !/[\u0000-\u001f\u007f]/.test(v)))
      reject("SPECIAL_PRICE_SIGNOFF_DECISION_INVALID");
  }
  const canonical={worksheetFingerprint:raw.worksheetFingerprint,brandId:raw.brandId,requestId:raw.requestId,
    reviewRevision:raw.reviewRevision,expectedDailyRevision:raw.expectedDailyRevision,decisions:raw.decisions};
  if(digest(canonical)!==raw.draftFingerprint)reject("SPECIAL_PRICE_SIGNOFF_DRAFT_FINGERPRINT_INVALID");
  return raw;
}
function signoffId(brandId,requestId,fingerprint){
  if(!BRANDS.has(brandId)|| !/^price_[0-9a-f]{48}$/.test(requestId||"") || !/^[a-f0-9]{64}$/.test(fingerprint||""))reject("SPECIAL_PRICE_SIGNOFF_ID_INVALID");
  return `signoff_${crypto.createHash("sha256").update([brandId,requestId,fingerprint].join("\0")).digest("hex").slice(0,48)}`;
}
function safeResult(state){
  return {...state,authorityVerified:false,businessPolicyApproved:false,financialPeriodAuthority:"NOT_GRANTED",
    postingAllowed:false,recognizedAmount:null,recognizedQuantity:null,calculatedAsp:null,recognitionMonth:null,
    formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
}
function beginSignoff({authority,draft,requestedBy}={}){
  if(!plain(draft)||!BRANDS.has(draft.brandId))reject("SPECIAL_PRICE_SIGNOFF_BRAND_INVALID");
  const plan=parseSignoffAuthority(authority,draft.brandId);
  assertCompleteDraft(draft,draft.brandId);
  const requester=actor(requestedBy);
  // The author must be a human identity from a future verified request; never treat this as authentication.
  const state={schemaVersion:STATE_SCHEMA,brandId:draft.brandId,requestId:draft.requestId,
    signoffId:signoffId(draft.brandId,draft.requestId,draft.draftFingerprint),
    draftFingerprint:draft.draftFingerprint,worksheetFingerprint:draft.worksheetFingerprint,
    authorityRevision:plan.revision,authorityHash:plan.authorityHash,
    requestedBy:requester,reviewRevision:0,status:"PENDING_BUSINESS_REVIEW",decisions:[]};
  return safeResult(state);
}
function inspectPrior(raw,plan,draft){
  if(!exactKeys(raw,STATE_FIELDS)||raw.schemaVersion!==STATE_SCHEMA||raw.brandId!==draft.brandId||
    raw.requestId!==draft.requestId||raw.signoffId!==signoffId(draft.brandId,draft.requestId,draft.draftFingerprint)||
    raw.draftFingerprint!==draft.draftFingerprint||raw.worksheetFingerprint!==draft.worksheetFingerprint||
    raw.authorityRevision!==plan.revision||raw.authorityHash!==plan.authorityHash||
    !Number.isSafeInteger(raw.reviewRevision)||raw.reviewRevision<0||
    !Array.isArray(raw.decisions)||raw.decisions.length!==raw.reviewRevision||raw.decisions.length>2 ||
    !exactKeys(raw.requestedBy,["roleId","accountId"])||!ROLES.has(raw.requestedBy.roleId)||typeof raw.requestedBy.accountId!=="string"||!ACCOUNT.test(raw.requestedBy.accountId))
    reject("SPECIAL_PRICE_SIGNOFF_STATE_STALE");
  // Recompute stage from immutable decision entries; do not trust caller-supplied status.
  let expected="PENDING_BUSINESS_REVIEW";
  const used=new Set();
  for(let i=0;i<raw.decisions.length;i++){
    const d=raw.decisions[i],stage=STAGES[i];
    if(!exactKeys(d,["stage","actor","decision","reasonNote"]) || d.stage!==stage ||
      !["APPROVE","REJECT"].includes(d.decision)||typeof d.reasonNote!=="string" ||
      d.reasonNote.length>500||/[\u0000-\u001f\u007f]/.test(d.reasonNote)||
      (d.decision==="REJECT"&&d.reasonNote.trim().length<3)||
      expected!==`PENDING_${stage}_REVIEW`)reject("SPECIAL_PRICE_SIGNOFF_STATE_INVALID");
    const reviewer=actor(d.actor),key=actorKey(reviewer);
    if(key===actorKey(raw.requestedBy)||used.has(key)||
      !plan.reviewers[stage].some(x=>actorKey(x)===key))reject("SPECIAL_PRICE_SIGNOFF_STATE_UNAUTHORIZED");
    used.add(key);
    expected=d.decision==="REJECT"?"REJECTED":stage==="BUSINESS"?"PENDING_FINANCE_REVIEW":"SIGNED_NO_POSTING";
  }
  if(expected!==raw.status || raw.postingAllowed!==false||raw.financialPeriodAuthority!=="NOT_GRANTED"||
    raw.businessPolicyApproved!==false||raw.authorityVerified!==false||raw.formalRevenueDelta!==0||
    raw.officialKpiAllocation!=="UNDECIDED"||raw.recognitionMonth!==null||raw.recognizedAmount!==null||
    raw.recognizedQuantity!==null||raw.calculatedAsp!==null)reject("SPECIAL_PRICE_SIGNOFF_STATE_INVALID");
  return expected;
}
function applySignoffDecision({authority,draft,prior,actor:actorInput,decision,reasonNote="",expectedRevision}={}){
  if(!plain(draft)||!BRANDS.has(draft.brandId))reject("SPECIAL_PRICE_SIGNOFF_BRAND_INVALID");
  const plan=parseSignoffAuthority(authority,draft.brandId);
  assertCompleteDraft(draft,draft.brandId);
  const status=inspectPrior(prior,plan,draft);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==prior.reviewRevision)
    reject("SPECIAL_PRICE_SIGNOFF_REVISION_CONFLICT");
  if(!["PENDING_BUSINESS_REVIEW","PENDING_FINANCE_REVIEW"].includes(status))reject("SPECIAL_PRICE_SIGNOFF_TERMINAL");
  if(!["APPROVE","REJECT"].includes(decision)||typeof reasonNote!=="string"||reasonNote.length>500||
    /[\u0000-\u001f\u007f]/.test(reasonNote)||(decision==="REJECT"&&reasonNote.trim().length<3))
    reject("SPECIAL_PRICE_SIGNOFF_DECISION_INVALID",400);
  const signer=actor(actorInput);
  const stage=status==="PENDING_BUSINESS_REVIEW"?"BUSINESS":"FINANCE";
  if(actorKey(signer)===actorKey(prior.requestedBy))reject("SPECIAL_PRICE_SIGNOFF_SELF_APPROVAL_FORBIDDEN",403);
  if(!plan.reviewers[stage].some(x=>actorKey(x)===actorKey(signer)))reject("SPECIAL_PRICE_SIGNOFF_REVIEWER_FORBIDDEN",403);
  const record={stage,actor:signer,decision,reasonNote};
  const nextStatus=decision==="REJECT"?"REJECTED":stage==="BUSINESS"?"PENDING_FINANCE_REVIEW":"SIGNED_NO_POSTING";
  const next=safeResult({schemaVersion:STATE_SCHEMA,brandId:prior.brandId,requestId:prior.requestId,
    signoffId:prior.signoffId,draftFingerprint:prior.draftFingerprint,worksheetFingerprint:prior.worksheetFingerprint,
    authorityRevision:plan.revision,authorityHash:plan.authorityHash,requestedBy:prior.requestedBy,
    reviewRevision:prior.reviewRevision+1,status:nextStatus,decisions:[...prior.decisions,record]});
  return {next,decisionRecord:Object.freeze({schemaVersion:"activity-sales-special-price-signoff-decision-v1",
    brandId:draft.brandId,signoffId:next.signoffId,requestId:draft.requestId,
    draftFingerprint:draft.draftFingerprint,authorityRevision:plan.revision,authorityHash:plan.authorityHash,
    stage,actor:signer,decision,reasonNote,revision:next.reviewRevision,
    postingAllowed:false,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"})};
}
module.exports={AUTH_SCHEMA,STATE_SCHEMA,STAGES,parseSignoffAuthority,assertCompleteDraft,signoffId,
  beginSignoff,applySignoffDecision,inspectPrior};
