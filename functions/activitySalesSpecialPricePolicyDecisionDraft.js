"use strict";
// Phase 2A-5B3B2-L3B2A: PURE, UNTRUSTED business decision draft only.
// NO signoff authority, posting permission, persistence, writer or Cloud Function.
const crypto=require("node:crypto");
const {DECISION_CODES}=require("./activitySalesSpecialPriceRecognitionWorksheet");
const BRANDS=new Set(["cyj","anniu","yibo"]);
const TOP_KEYS=new Set(["worksheet","proposals"]);
const PROPOSAL_KEYS=new Set(["text","rationale"]);
const CODES=new Set(DECISION_CODES);
function refuse(code){const e=new Error(code);e.code=code;e.status=409;throw e;}
function plain(x){return x!==null && typeof x==="object" && !Array.isArray(x) && (Object.getPrototypeOf(x)===Object.prototype || Object.getPrototypeOf(x)===null);}
function cleanText(value,label){
  if(typeof value!=="string" || value!==value.trim() || value.length<3 || value.length>800 ||
      /[\u0000-\u001f\u007f]/.test(value))refuse(label);
  return value;
}
function assertWorksheetForDraft(w){
  if(!plain(w) || w.schemaVersion!=="activity-sales-special-price-recognition-worksheet-v1" ||
     w.state!=="AWAITING_BUSINESS_DECISIONS_NO_POSTING" || w.postingAllowed!==false ||
     w.periodPostingAuthority!=="NOT_GRANTED" ||
     !BRANDS.has(w.brandId) || !/^price_[a-f0-9]{48}$/.test(w.requestId||"") ||
     !/^[0-9a-f]{64}$/.test(w.worksheetFingerprint||"") ||
     !Array.isArray(w.businessDecisions) || w.businessDecisions.length!==DECISION_CODES.length ||
     !DECISION_CODES.every((code,i)=>w.businessDecisions[i]?.code===code && w.businessDecisions[i]?.status==="UNDECIDED") ||
     w.recognitionDate!==null || w.recognitionMonth!==null || w.recognizedAmount!==null ||
     w.recognizedQuantity!==null || w.calculatedAsp!==null ||
     w.formalRevenueDelta!==0 || w.officialKpiAllocation!=="UNDECIDED" ||
     typeof w.crossMonth!=="boolean" || typeof w.sourceReportDate!=="string" ||
     typeof w.approvedTaipeiDate!=="string" || !/^\d{4}-\d{2}$/.test(w.sourceMonth||"") ||
     !/^\d{4}-\d{2}$/.test(w.approvalMonth||"") ||
     w.sourceMonth!==w.sourceReportDate.slice(0,7) ||
     w.approvalMonth!==w.approvedTaipeiDate.slice(0,7) ||
     w.crossMonth!==(w.sourceMonth!==w.approvalMonth) ||
     !Number.isSafeInteger(w.reviewRevision) || w.reviewRevision<1 ||
     !Number.isSafeInteger(w.expectedDailyRevision) || w.expectedDailyRevision<0)
    refuse("SPECIAL_PRICE_DECISION_DRAFT_WORKSHEET_INVALID");
  // The supplied worksheet is NOT authenticated by this check. A future backend
  // must derive and validate all original anchors from fresh transaction reads.
}
function buildSpecialPricePolicyDecisionDraft(input={}){
  if(!plain(input) || Object.keys(input).some(k=>!TOP_KEYS.has(k)))
    refuse("SPECIAL_PRICE_DECISION_DRAFT_INPUT_INVALID");
  const {worksheet:w,proposals={}}=input;
  assertWorksheetForDraft(w);
  if(!plain(proposals) || Object.keys(proposals).some(code=>!CODES.has(code)))
    refuse("SPECIAL_PRICE_DECISION_DRAFT_CODE_INVALID");
  const decisions=Object.freeze(DECISION_CODES.map(code=>{
    if(!Object.prototype.hasOwnProperty.call(proposals,code))
      return Object.freeze({code,status:"UNDECIDED",proposalText:null,rationale:null});
    const item=proposals[code];
    if(!plain(item) || Object.keys(item).sort().join(",")!=="rationale,text")
      refuse("SPECIAL_PRICE_DECISION_DRAFT_FIELDS_INVALID");
    return Object.freeze({code,status:"PROPOSED_PENDING_AUTHORITY",
      proposalText:cleanText(item.text,"SPECIAL_PRICE_DECISION_DRAFT_TEXT_INVALID"),
      rationale:cleanText(item.rationale,"SPECIAL_PRICE_DECISION_DRAFT_RATIONALE_INVALID")});
  }));
  const filled=decisions.filter(x=>x.status==="PROPOSED_PENDING_AUTHORITY").length;
  const canonical={worksheetFingerprint:w.worksheetFingerprint,brandId:w.brandId,requestId:w.requestId,
    reviewRevision:w.reviewRevision,expectedDailyRevision:w.expectedDailyRevision,decisions};
  const draftFingerprint=crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return Object.freeze({
    schemaVersion:"activity-sales-special-price-policy-decision-draft-v1",
    state:filled===DECISION_CODES.length?"READY_FOR_BUSINESS_REVIEW_NO_POSTING":"INCOMPLETE_DECISION_DRAFT_NO_POSTING",
    worksheetFingerprint:w.worksheetFingerprint,draftFingerprint,
    brandId:w.brandId,requestId:w.requestId,reviewRevision:w.reviewRevision,
    expectedDailyRevision:w.expectedDailyRevision,sourceMonth:w.sourceMonth,approvalMonth:w.approvalMonth,
    crossMonth:w.crossMonth,completedDecisionCount:filled,requiredDecisionCount:DECISION_CODES.length,
    decisions,
    // Even a complete draft is NOT an approved brand policy or a financial period grant.
    businessAuthority:"NOT_VERIFIED",financialPeriodAuthority:"NOT_GRANTED",
    approvedPolicyRevision:null,approvedPolicyHash:null,
    postingAllowed:false,recognitionDate:null,recognitionMonth:null,
    recognizedAmount:null,recognizedQuantity:null,calculatedAsp:null,
    formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"
  });
}
module.exports={buildSpecialPricePolicyDecisionDraft,assertWorksheetForDraft};
