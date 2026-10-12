"use strict";
// Phase 2A-5B3B2-L3B1: pure, read-only facts/decision worksheet.
// Deliberately NEVER decides month, ASP, units, posting eligibility, or period authority.
const crypto=require("node:crypto");
const BRANDS=new Set(["cyj","anniu","yibo"]);
const TOP_FIELDS=new Set(["preflight","request","review"]);
const DECISION_CODES=Object.freeze([
  "ACTIVITY_RECOGNITION_DATE",
  "ACTIVITY_AMOUNT_BASIS",
  "ACTIVITY_QUANTITY_BASIS",
  "ACTIVITY_ASP_FORMULA",
  "DAILY_REPORT_RECONCILIATION",
  "CROSS_MONTH_ATTRIBUTION",
  "CLOSED_PERIOD_TREATMENT",
  "REJECTED_REOPEN_FLOW",
  "DAY_LOCK_TERMINAL_RELEASE"
]);
function reject(code){const e=new Error(code);e.code=code;e.status=409;throw e;}
function isoUtc(raw){
  if(typeof raw!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw))reject("SPECIAL_PRICE_WORKSHEET_TIMESTAMP_INVALID");
  const date=new Date(raw);
  if(!Number.isFinite(date.getTime()) || date.toISOString()!==raw)reject("SPECIAL_PRICE_WORKSHEET_TIMESTAMP_INVALID");
  return date;
}
function saleDate(raw){
  if(typeof raw!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw))reject("SPECIAL_PRICE_WORKSHEET_DATE_INVALID");
  const d=new Date(raw+"T00:00:00.000Z");
  if(!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==raw)reject("SPECIAL_PRICE_WORKSHEET_DATE_INVALID");
  return raw;
}
const taipeiFmt=new Intl.DateTimeFormat("en-US",{
  timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"
});
function taipeiDate(date){
  const parts=Object.fromEntries(taipeiFmt.formatToParts(date).map(x=>[x.type,x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const monetary=n=>Number.isSafeInteger(n)&&n>0&&n<=100000000;
function buildSpecialPriceRecognitionWorksheet(input={}){
  if(!input || typeof input!=="object" || Array.isArray(input) ||
     Object.keys(input).some(k=>!TOP_FIELDS.has(k)))reject("SPECIAL_PRICE_WORKSHEET_INPUT_INVALID");
  const {preflight:p,request:r,review:v}=input,prop=r?.proposal;
  if(!p || p.state!=="PREFLIGHT_PASSED_NO_POSTING" || p.postingAllowed!==false ||
     p.formalRevenueDelta!==0 || p.officialKpiAllocation!=="UNDECIDED" ||
     !BRANDS.has(p.brandId) || typeof p.requestId!=="string" ||
     !/^price_[a-f0-9]{48}$/.test(p.requestId) ||
     !Number.isSafeInteger(p.reviewRevision) || p.reviewRevision<1 ||
     !Number.isSafeInteger(p.expectedDailyRevision) || p.expectedDailyRevision<0 ||
     !Number.isSafeInteger(p.proposedActivityAmount) || !Number.isSafeInteger(p.proposedQuantity))
    reject("SPECIAL_PRICE_WORKSHEET_PREFLIGHT_INVALID");
  // This is consistency checking of a DRAFT, not proof that preflight was performed.
  // The later real writer must independently re-read/revalidate every anchor in a transaction.
  if(!r || r.schemaVersion!=="activity-sales-special-price-request-record-v1" ||
     r.requestId!==p.requestId || r.brandId!==p.brandId || r.state!=="PENDING_REVIEW" ||
     r.formalRevenueDelta!==0 || r.officialKpiAllocation!=="UNDECIDED" ||
     !prop || prop.schemaVersion!=="activity-sales-special-price-request-v1" ||
     prop.brandId!==p.brandId || prop.campaignId!==r.campaignId ||
     prop.versionId!==r.versionId || prop.roleId!==r.roleId ||
     prop.accountId!==r.accountId || prop.reportDate!==r.reportDate ||
     prop.saleId!==r.saleId || prop.state!=="PENDING_REVIEW" ||
     prop.approvalState!=="PENDING_REVIEW" || prop.priceMode!==undefined ||
     prop.formalRevenueDelta!==0 || prop.officialKpiAllocation!=="UNDECIDED")
    reject("SPECIAL_PRICE_WORKSHEET_REQUEST_INVALID");
  if(!v || v.schemaVersion!=="activity-sales-lifecycle-review-state-v1" ||
     v.requestId!==p.requestId || v.brandId!==p.brandId || v.kind!=="SPECIAL_PRICE" ||
     v.status!=="APPROVED_PENDING_SETTLEMENT" || v.reviewRevision!==p.reviewRevision ||
     v.policyRevision!==r.policyRevision || v.planHash!==r.planHash ||
     v.formalRevenueDelta!==0 || v.officialKpiAllocation!=="UNDECIDED")
    reject("SPECIAL_PRICE_WORKSHEET_REVIEW_INVALID");
  if(!monetary(prop.standardUnitPrice) || !monetary(prop.standardTotal) ||
     !monetary(prop.actualAmount) || !Number.isSafeInteger(prop.quantity) ||
     prop.quantity<1 || prop.quantity>100 ||
     prop.standardUnitPrice*prop.quantity!==prop.standardTotal ||
     !Number.isSafeInteger(prop.priceDifference) ||
     prop.actualAmount-prop.standardTotal!==prop.priceDifference ||
     prop.priceDifference===0 ||
     prop.actualAmount!==p.proposedActivityAmount ||
     prop.quantity!==p.proposedQuantity ||
     typeof prop.packageId!=="string" || !prop.packageId)
    reject("SPECIAL_PRICE_WORKSHEET_PRICE_INVALID");
  const sourceReportDate=saleDate(prop.reportDate);
  const requestedAt=isoUtc(r.createdAtText),approvedAt=isoUtc(v.updatedAtText);
  if(approvedAt.getTime()<requestedAt.getTime())reject("SPECIAL_PRICE_WORKSHEET_TIME_ORDER_INVALID");
  const requestedTaipeiDate=taipeiDate(requestedAt),approvedTaipeiDate=taipeiDate(approvedAt);
  const sourceMonth=sourceReportDate.slice(0,7),approvalMonth=approvedTaipeiDate.slice(0,7);
  const fingerprintSource={brandId:p.brandId,requestId:p.requestId,sourceReportDate,
    requestedAtText:r.createdAtText,approvedAtText:v.updatedAtText,
    approvalRevision:p.reviewRevision,policyRevision:r.policyRevision,planHash:r.planHash,
    campaignId:r.campaignId,versionId:r.versionId,saleId:r.saleId,packageId:prop.packageId,
    quantity:prop.quantity,standardUnitPrice:prop.standardUnitPrice,
    standardTotal:prop.standardTotal,actualAmount:prop.actualAmount,priceDifference:prop.priceDifference,
    expectedDailyRevision:p.expectedDailyRevision};
  const fingerprint=crypto.createHash("sha256").update(JSON.stringify(fingerprintSource)).digest("hex");
  const decisions=Object.freeze(DECISION_CODES.map(code=>Object.freeze({code,status:"UNDECIDED"})));
  return Object.freeze({
    schemaVersion:"activity-sales-special-price-recognition-worksheet-v1",
    state:"AWAITING_BUSINESS_DECISIONS_NO_POSTING",postingAllowed:false,
    brandId:p.brandId,requestId:p.requestId,sourceReportDate,requestedTaipeiDate,
    approvedTaipeiDate,sourceMonth,approvalMonth,
    crossMonth:sourceMonth!==approvalMonth,
    standardUnitPrice:prop.standardUnitPrice,standardTotal:prop.standardTotal,
    proposedActualAmount:prop.actualAmount,proposedQuantity:prop.quantity,
    priceDifference:prop.priceDifference,expectedDailyRevision:p.expectedDailyRevision,
    reviewRevision:p.reviewRevision,worksheetFingerprint:fingerprint,
    recognitionDate:null,recognitionMonth:null,recognizedAmount:null,recognizedQuantity:null,
    calculatedAsp:null,periodPostingAuthority:"NOT_GRANTED",
    businessDecisions:decisions,
    formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"
  });
}
module.exports={buildSpecialPriceRecognitionWorksheet,DECISION_CODES};
