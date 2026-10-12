import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {buildSpecialPricePolicyDecisionDraft}=require('../functions/activitySalesSpecialPricePolicyDecisionDraft.js');
const {DECISION_CODES}=require('../functions/activitySalesSpecialPriceRecognitionWorksheet.js');
function worksheet(brandId="cyj",crossMonth=false){
 const sourceReportDate="2026-09-30",approvedTaipeiDate=crossMonth?"2026-10-01":"2026-09-30";
 return {schemaVersion:"activity-sales-special-price-recognition-worksheet-v1",
  state:"AWAITING_BUSINESS_DECISIONS_NO_POSTING",postingAllowed:false,periodPostingAuthority:"NOT_GRANTED",
  brandId,requestId:"price_"+"a".repeat(48),worksheetFingerprint:"b".repeat(64),
  reviewRevision:2,expectedDailyRevision:0,sourceReportDate,approvedTaipeiDate,
  sourceMonth:"2026-09",approvalMonth:approvedTaipeiDate.slice(0,7),crossMonth,
  businessDecisions:DECISION_CODES.map(code=>({code,status:"UNDECIDED"})),
  recognitionDate:null,recognitionMonth:null,recognizedAmount:null,recognizedQuantity:null,calculatedAsp:null,
  formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
}
const answer={text:"待業務負責人確認之草案，不代表正式政策",rationale:"依據正式業績認列與關帳治理流程，後續須獨立核准"};
const expectCode=(fn,code)=>assert.throws(fn,e=>e.code===code);
for(const brandId of ["cyj","anniu","yibo"]){
 test(`${brandId}: blank draft remains non-posting`,()=>{
  const draft=buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(brandId)});
  assert.equal(draft.completedDecisionCount,0);assert.equal(draft.requiredDecisionCount,9);
  assert.equal(draft.state,"INCOMPLETE_DECISION_DRAFT_NO_POSTING");
  assert.equal(draft.postingAllowed,false);assert.equal(draft.financialPeriodAuthority,"NOT_GRANTED");
  assert.equal(draft.recognizedAmount,null);assert.equal(draft.recognitionMonth,null);
 });
 test(`${brandId}: all nine proposals are still not approved or posted`,()=>{
  const proposals=Object.fromEntries(DECISION_CODES.map(code=>[code,answer]));
  const draft=buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(brandId,true),proposals});
  assert.equal(draft.completedDecisionCount,9);
  assert.equal(draft.state,"READY_FOR_BUSINESS_REVIEW_NO_POSTING");
  assert.equal(draft.businessAuthority,"NOT_VERIFIED");
  assert.equal(draft.postingAllowed,false);assert.equal(draft.approvedPolicyRevision,null);
  assert.equal(draft.crossMonth,true);assert.equal(draft.formalRevenueDelta,0);
  assert.ok(Object.isFrozen(draft));assert.ok(Object.isFrozen(draft.decisions));
 });
}
test("partial proposals are fingerprinted in canonical policy order",()=>{
 const w=worksheet(),a=buildSpecialPricePolicyDecisionDraft({worksheet:w,proposals:{ACTIVITY_AMOUNT_BASIS:answer,ACTIVITY_ASP_FORMULA:answer}}),
 b=buildSpecialPricePolicyDecisionDraft({worksheet:w,proposals:{ACTIVITY_ASP_FORMULA:answer,ACTIVITY_AMOUNT_BASIS:answer}});
 assert.equal(a.completedDecisionCount,2);assert.equal(a.draftFingerprint,b.draftFingerprint);
 assert.equal(a.decisions[0].status,"UNDECIDED");
});
test("unknown decision code fails closed",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(),proposals:{FAKE:answer}}),"SPECIAL_PRICE_DECISION_DRAFT_CODE_INVALID"));
test("postingAllowed/approved actor injected at top level fails",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(),postingAllowed:true}),"SPECIAL_PRICE_DECISION_DRAFT_INPUT_INVALID"));
test("approved status injected into proposal fails",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(),proposals:{ACTIVITY_ASP_FORMULA:{...answer,status:"APPROVED"}}}),"SPECIAL_PRICE_DECISION_DRAFT_FIELDS_INVALID"));
test("fake sign-off or policy revision in proposal fails",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(),proposals:{ACTIVITY_ASP_FORMULA:{...answer,policyRevision:100}}}),"SPECIAL_PRICE_DECISION_DRAFT_FIELDS_INVALID"));
test("missing rationale fails closed",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(),proposals:{ACTIVITY_ASP_FORMULA:{text:answer.text}}}),"SPECIAL_PRICE_DECISION_DRAFT_FIELDS_INVALID"));
test("untrimmed answer fails closed",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(),proposals:{ACTIVITY_ASP_FORMULA:{...answer,text:" bad  "}}}),"SPECIAL_PRICE_DECISION_DRAFT_TEXT_INVALID"));
test("control character fails closed",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(),proposals:{ACTIVITY_ASP_FORMULA:{...answer,rationale:"abc\nxyz"}}}),"SPECIAL_PRICE_DECISION_DRAFT_RATIONALE_INVALID"));
test("authored financial authority in worksheet fails closed",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:{...worksheet(),periodPostingAuthority:"GRANTED"}}),"SPECIAL_PRICE_DECISION_DRAFT_WORKSHEET_INVALID"));
test("worksheet brand or false identity rejected",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:{...worksheet(),brandId:"other"}}),"SPECIAL_PRICE_DECISION_DRAFT_WORKSHEET_INVALID"));
test("worksheet cross-month tamper rejected",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:{...worksheet(),crossMonth:true}}),"SPECIAL_PRICE_DECISION_DRAFT_WORKSHEET_INVALID"));
test("worksheet prior business decision tamper rejected",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:{...worksheet(),businessDecisions:[{code:"FAKE",status:"APPROVED"}]}}),"SPECIAL_PRICE_DECISION_DRAFT_WORKSHEET_INVALID"));
test("worksheet synthetic approved preflight rejected",()=>expectCode(()=>buildSpecialPricePolicyDecisionDraft({worksheet:{...worksheet(),postingAllowed:true}}),"SPECIAL_PRICE_DECISION_DRAFT_WORKSHEET_INVALID"));
test("numeric totals remain uncomputed even when fully proposed",()=>{
 const draft=buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(),proposals:Object.fromEntries(DECISION_CODES.map(code=>[code,answer]))});
 assert.equal(draft.calculatedAsp,null);assert.equal(draft.recognizedQuantity,null);
 assert.equal(draft.officialKpiAllocation,"UNDECIDED");
});
