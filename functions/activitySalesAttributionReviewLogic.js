"use strict";
// Phase 2A-4R1: independent manager review contract. Neither sales nor formal
// daily reports are mutated by this authority. No corrections/refunds here.
const {validIdentity,STATES}=require("./activitySalesAttributionContract");
const {coreStore,invalid}=require("./activitySalesAttributionWriterLogic");
const DECISIONS=Object.freeze({VERIFIED:"verified",FLAGGED:"flagged"});
const REASONS=new Set(["AMOUNT_RECHECK","OWNER_RECHECK","MISSING_EVIDENCE","OTHER"]);
function checkedReviewInput(body) {
  if(!body || !["inspect","review"].includes(body.action))invalid("ATTRIBUTION_REVIEW_ACTION_INVALID",400);
  if(body.actor?.roleId!=="store")invalid("ATTRIBUTION_REVIEW_STORE_ROLE_REQUIRED",403);
  let subject;
  try {subject=validIdentity({...body.subject,brandId:body.brandId,roleId:"therapist"});}
  catch {invalid("ATTRIBUTION_REVIEW_SUBJECT_INVALID",400);}
  if(body.subject?.roleId!=="therapist" || /[\/\\]/.test(subject.accountId)) invalid("ATTRIBUTION_REVIEW_SUBJECT_INVALID",400);
  const storeName=String(body.storeName||"").trim();
  if(!storeName || storeName.length>120 || /[\/\\]/.test(storeName))invalid("ATTRIBUTION_REVIEW_STORE_INVALID",400);
  const storeCore=coreStore(storeName);
  let decision=null,reason="";
  if(body.action==="review") {
    if(!Number.isSafeInteger(body.expectedAttributionRevision) || body.expectedAttributionRevision<1 ||
       !Number.isSafeInteger(body.expectedReviewRevision) || body.expectedReviewRevision<0 ||
       typeof body.expectedReportUpdateVersion!=="string" || !/^\d{10,}:\d{9}$/.test(body.expectedReportUpdateVersion))invalid("ATTRIBUTION_REVIEW_OCC_INVALID",400);
    decision=body.decision;
    if(!Object.values(DECISIONS).includes(decision))invalid("ATTRIBUTION_REVIEW_DECISION_INVALID",400);
    reason=body.reason===undefined?"":body.reason;
    if(typeof reason!=="string" || (decision===DECISIONS.FLAGGED && !REASONS.has(reason)) ||
      (decision===DECISIONS.VERIFIED && reason!==""))invalid("ATTRIBUTION_REVIEW_REASON_INVALID",400);
  }
  return {subject,storeName,storeCore,action:body.action,decision,reason};
}
function reportUpdateVersion(snapshot) {
  // Full Firestore seconds + nanoseconds, not millisecond-rounded timestamps.
  const ts=snapshot?.updateTime;
  if(!Number.isSafeInteger(ts?.seconds) || ts.seconds<=0 ||
     !Number.isSafeInteger(ts?.nanoseconds) || ts.nanoseconds<0 || ts.nanoseconds>=1000000000)
    invalid("ATTRIBUTION_REVIEW_REPORT_STAMP_MISSING",409);
  return `${ts.seconds}:${String(ts.nanoseconds).padStart(9,"0")}`;
}
function normalizedReview(doc,subject,storeCore,attributionRevision,reportVersion) {
  if(!doc)return {state:"UNREVIEWED",reviewRevision:0,decision:null,reason:null};
  if(doc.schemaVersion!=="activity-sales-attribution-review-v1" || doc.brandId!==subject.brandId ||
    doc.campaignId!==subject.campaignId || doc.versionId!==subject.versionId ||
    doc.roleId!==subject.roleId || doc.accountId!==subject.accountId || doc.reportDate!==subject.reportDate ||
    doc.storeCore!==storeCore || doc.formalRevenueDelta!==0 ||
    !Number.isSafeInteger(doc.reviewRevision) || doc.reviewRevision<1 ||
    !Number.isSafeInteger(doc.attributionRevision) || doc.attributionRevision<1 ||
    typeof doc.reportUpdateVersion!=="string" || !/^\d{10,}:\d{9}$/.test(doc.reportUpdateVersion) ||
    !Object.values(DECISIONS).includes(doc.decision) ||
    (doc.decision===DECISIONS.FLAGGED && !REASONS.has(doc.reason)) ||
    (doc.decision===DECISIONS.VERIFIED && doc.reason!==""))invalid("ATTRIBUTION_REVIEW_DATA_INVALID",409);
  return {state:doc.attributionRevision===attributionRevision && doc.reportUpdateVersion===reportVersion?"CURRENT":"STALE",
    reviewRevision:doc.reviewRevision,decision:doc.decision,reason:doc.reason||null};
}
function assertConfirmedForReview(attribution){
  if(![STATES.HAS_SALES,STATES.CONFIRMED_ZERO].includes(attribution.status) ||
    !Number.isSafeInteger(attribution.revision) || attribution.revision<1)invalid("ATTRIBUTION_REVIEW_UNCONFIRMED",409);
}
module.exports={DECISIONS,REASONS,checkedReviewInput,reportUpdateVersion,normalizedReview,assertConfirmedForReview};
