"use strict";
// Phase 2A-5A: PURE, INERT domain contract. No HTTP handler, Firebase import,
// persisted ledger, sale writer, report changes, or KPI authority in this module.
// A future backend MUST re-derive all input values from canonical snapshots and
// authorize the actor, price exception, revision and immutable version in a tx.
const crypto = require("node:crypto");
const {validIdentity, assertDate, normalizeAttributionSale} = require("./activitySalesAttributionContract");

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const KINDS = Object.freeze({CORRECTION:"CORRECTION",CANCELLATION:"CANCELLATION",REFUND:"REFUND"});
const PRICE_REASONS = Object.freeze([
  "manager_authorized", "complaint_compensation", "special_discount", "special_project", "other",
]);
const MAX_AMOUNT=100000000;
function reject(code) { const error=new Error(code); error.code=code; throw error; }
function money(value,nonZero=true) {
  if(!Number.isSafeInteger(value) || value<0 || value>MAX_AMOUNT || (nonZero && value===0)) reject("LIFECYCLE_MONEY_INVALID");
  return value;
}
function safeId(value,label="LIFECYCLE_ID_INVALID") {
  if(typeof value!=="string" || !ID.test(value)) reject(label);
  return value;
}
function note(value,required=false) {
  const v=String(value??"").trim();
  if(v.length>500 || /[\u0000-\u001f\u007f]/.test(v) || (required && v.length<3)) reject("LIFECYCLE_REASON_NOTE_INVALID");
  return v;
}
function noRevenueChange(value) {
  if(value!==undefined && value!==0) reject("LIFECYCLE_FORMAL_REVENUE_FORBIDDEN");
  return 0;
}
function pricingException({standardUnitPrice,quantity,actualAmount,reasonCode,reasonNote,approvalPolicy}={}) {
  money(standardUnitPrice);
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100) reject("LIFECYCLE_QUANTITY_INVALID");
  money(actualAmount);
  const standardTotal=standardUnitPrice*quantity;
  money(standardTotal);
  if(actualAmount===standardTotal) {
    if(reasonCode || reasonNote) reject("LIFECYCLE_NORMAL_PRICE_REASON_CONFLICT");
    return {priceMode:"STANDARD",standardTotal,actualAmount,priceDifference:0,reasonCode:null,reasonNote:null,approvalState:"NOT_REQUIRED",formalRevenueDelta:0};
  }
  if(!PRICE_REASONS.includes(reasonCode)) reject("LIFECYCLE_SPECIAL_PRICE_REASON_REQUIRED");
  const explanation=note(reasonNote,reasonCode==="other");
  // Policy from backend authority only. No caller may assert that approval occurred.
  if(approvalPolicy!==undefined && approvalPolicy!=="REQUIRE_REVIEW") reject("LIFECYCLE_APPROVAL_POLICY_UNAUTHORIZED");
  return {priceMode:"EXCEPTION",standardTotal,actualAmount,priceDifference:actualAmount-standardTotal,
    reasonCode,reasonNote:explanation,approvalState:"PENDING",formalRevenueDelta:0};
}
function normalizeEvent(raw={}) {
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) reject("LIFECYCLE_EVENT_INVALID");
  const identity=validIdentity(raw);
  const kind=raw.kind;
  if(!Object.values(KINDS).includes(kind)) reject("LIFECYCLE_EVENT_KIND_INVALID");
  const eventId=safeId(raw.eventId,"LIFECYCLE_EVENT_ID_INVALID");
  const saleId=safeId(raw.saleId,"LIFECYCLE_SALE_ID_INVALID");
  const eventDate=assertDate(raw.eventDate);
  if(eventDate<identity.reportDate) reject("LIFECYCLE_EVENT_BEFORE_SALE");
  if(!Number.isSafeInteger(raw.expectedEventRevision)||raw.expectedEventRevision<0) reject("LIFECYCLE_REVISION_INVALID");
  noRevenueChange(raw.formalRevenueDelta);
  const reasonCode=safeId(raw.reasonCode,"LIFECYCLE_REASON_REQUIRED");
  const reasonNote=note(raw.reasonNote,reasonCode==="other");
  const event={schemaVersion:"activity-sales-lifecycle-event-v1",...identity,kind,eventId,saleId,
    eventDate,expectedEventRevision:raw.expectedEventRevision,reasonCode,reasonNote,formalRevenueDelta:0};
  if(kind===KINDS.REFUND) {
    event.refundAmount=money(raw.refundAmount);
    if(raw.replacement!==undefined) reject("LIFECYCLE_EVENT_FIELDS_INVALID");
  } else if(kind===KINDS.CORRECTION) {
    if(raw.refundAmount!==undefined || !raw.replacement || typeof raw.replacement!=="object") reject("LIFECYCLE_EVENT_FIELDS_INVALID");
    const replacement=raw.replacement;
    event.replacement={packageId:safeId(replacement.packageId,"LIFECYCLE_PACKAGE_INVALID"),
      quantity:replacement.quantity,attributedAmount:money(replacement.attributedAmount)};
    if(!Number.isSafeInteger(event.replacement.quantity)||event.replacement.quantity<1||event.replacement.quantity>100) reject("LIFECYCLE_QUANTITY_INVALID");
    // A correction may change formal package or amount, but the FUTURE backend
    // must verify the replacement against the immutable version and policy.
  } else if(raw.refundAmount!==undefined || raw.replacement!==undefined) reject("LIFECYCLE_EVENT_FIELDS_INVALID");
  return event;
}
function lifecycleDocumentId(event) {
  const normalized=normalizeEvent(event);
  const p=[normalized.brandId,normalized.roleId,normalized.accountId,normalized.reportDate,
    normalized.campaignId,normalized.versionId,normalized.saleId,normalized.eventId];
  return "life_"+crypto.createHash("sha256").update(p.join("\0")).digest("hex").slice(0,48);
}
function sameSubject(sale,event) {
  for(const key of ["brandId","campaignId","versionId","roleId","accountId","reportDate","saleId"]) {
    if(sale[key]!==event[key]) reject("LIFECYCLE_SUBJECT_MISMATCH");
  }
}
function evaluateLifecycle(saleInput,rawEvents=[]) {
  const sale=normalizeAttributionSale(saleInput);
  if(!Array.isArray(rawEvents)||rawEvents.length>100) reject("LIFECYCLE_EVENTS_INVALID");
  // NEVER count an unapproved special-price request as an authorized sale.
  if(saleInput?.approvalState==="PENDING") reject("LIFECYCLE_PENDING_SALE_NOT_ELIGIBLE");
  if(saleInput?.approvalState && !["NOT_REQUIRED","APPROVED"].includes(saleInput.approvalState)) reject("LIFECYCLE_APPROVAL_STATE_INVALID");
  let revisedAmount=sale.attributedAmount,quantity=sale.quantity,packageId=sale.packageId;
  let refundTotal=0,cancelledAmount=0,netAmount=revisedAmount,revision=0,state="ACTIVE";
  const seen=new Map(),applied=[];
  for(const input of rawEvents) {
    const event=normalizeEvent(input);
    sameSubject(sale,event);
    const docId=lifecycleDocumentId(event);
    const canonical=JSON.stringify(event);
    if(seen.has(docId)) {
      if(seen.get(docId)!==canonical) reject("LIFECYCLE_IDEMPOTENCY_CONFLICT");
      continue; // exact retry: no second refund/revision advance
    }
    if(event.expectedEventRevision!==revision) reject("LIFECYCLE_REVISION_CONFLICT");
    if(state==="CANCELLED" || state==="FULL_REFUND") reject("LIFECYCLE_TERMINAL_STATE");
    if(event.kind===KINDS.CORRECTION) {
      if(refundTotal!==0) reject("LIFECYCLE_CORRECTION_AFTER_REFUND");
      revisedAmount=event.replacement.attributedAmount;
      quantity=event.replacement.quantity;
      packageId=event.replacement.packageId;
      netAmount=revisedAmount;
      state="CORRECTED";
    } else if(event.kind===KINDS.REFUND) {
      if(event.refundAmount>netAmount) reject("LIFECYCLE_OVER_REFUND");
      refundTotal+=event.refundAmount;
      netAmount-=event.refundAmount;
      state=netAmount===0?"FULL_REFUND":"PARTIAL_REFUND";
    } else {
      cancelledAmount=netAmount;
      netAmount=0;
      state="CANCELLED";
    }
    seen.set(docId,canonical);
    applied.push(docId);
    revision++;
  }
  // This is a per-sale audit projection, NOT an official month/KPI allocation.
  return {schemaVersion:"activity-sales-lifecycle-projection-v1",brandId:sale.brandId,
    campaignId:sale.campaignId,versionId:sale.versionId,roleId:sale.roleId,
    accountId:sale.accountId,reportDate:sale.reportDate,saleId:sale.saleId,
    originalAttributedAmount:sale.attributedAmount,currentGrossAttributedAmount:revisedAmount,
    refundAttributedAmount:refundTotal,cancelledAttributedAmount:cancelledAmount,
    netAttributedAmount:netAmount,originalQuantity:sale.quantity,currentQuantity:quantity,
    currentPackageId:packageId,state,eventRevision:revision,eventIds:applied,formalRevenueDelta:0,
    officialKpiAllocation:"UNDECIDED"};
}
module.exports={KINDS,PRICE_REASONS,pricingException,normalizeEvent,lifecycleDocumentId,evaluateLifecycle};
