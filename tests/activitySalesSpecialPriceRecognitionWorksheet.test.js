import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {buildSpecialPriceRecognitionWorksheet,DECISION_CODES}=require('../functions/activitySalesSpecialPriceRecognitionWorksheet.js');
const clone=structuredClone;
const priceId='price_'+'b'.repeat(48);
function fixture(brandId='cyj',sellerRole='therapist'){
  const proposal={schemaVersion:'activity-sales-special-price-request-v1',brandId,
    campaignId:'campaign1',versionId:'campaign1_v001',roleId:sellerRole,
    accountId:sellerRole==='therapist'?'T001':'S001',reportDate:'2026-09-30',
    saleId:'sale001',packageId:'pkg01',quantity:2,standardUnitPrice:18800,
    standardTotal:37600,actualAmount:35000,priceDifference:-2600,
    reasonCode:'special_discount',reasonNote:'demo',state:'PENDING_REVIEW',
    approvalState:'PENDING_REVIEW',formalRevenueDelta:0,officialKpiAllocation:'UNDECIDED'};
  const request={schemaVersion:'activity-sales-special-price-request-record-v1',
    ...Object.fromEntries(['brandId','campaignId','versionId','roleId','accountId','reportDate','saleId'].map(k=>[k,proposal[k]])),
    requestId:priceId,state:'PENDING_REVIEW',policyRevision:3,planHash:'hash001',
    proposal,formalRevenueDelta:0,officialKpiAllocation:'UNDECIDED',
    createdAtText:'2026-09-30T15:58:00.000Z'};
  const review={schemaVersion:'activity-sales-lifecycle-review-state-v1',
    requestId:priceId,brandId,kind:'SPECIAL_PRICE',status:'APPROVED_PENDING_SETTLEMENT',
    reviewRevision:3,policyRevision:3,planHash:'hash001',
    formalRevenueDelta:0,officialKpiAllocation:'UNDECIDED',
    updatedAtText:'2026-09-30T16:01:00.000Z'};
  const preflight={state:'PREFLIGHT_PASSED_NO_POSTING',postingAllowed:false,
    brandId,requestId:priceId,reviewRevision:3,expectedDailyRevision:2,
    proposedActivityAmount:35000,proposedQuantity:2,
    formalRevenueDelta:0,officialKpiAllocation:'UNDECIDED'};
  return {preflight,request,review};
}
const evaluate=x=>buildSpecialPriceRecognitionWorksheet(x);
function deny(edit,re=/SPECIAL_PRICE_WORKSHEET_/){let f=fixture();edit(f);assert.throws(()=>evaluate(f),re);}
test('L3B1 all three brands and two seller roles: factual values only, never posting',()=>{
  for(const brandId of ['cyj','anniu','yibo'])for(const role of ['therapist','store']){
    const f=fixture(brandId,role),out=evaluate(f);
    assert.equal(out.brandId,brandId);
    assert.equal(out.state,'AWAITING_BUSINESS_DECISIONS_NO_POSTING');
    assert.equal(out.postingAllowed,false);
    assert.equal(out.recognitionDate,null);
    assert.equal(out.recognitionMonth,null);
    assert.equal(out.recognizedAmount,null);
    assert.equal(out.recognizedQuantity,null);
    assert.equal(out.calculatedAsp,null);
    assert.equal(out.periodPostingAuthority,'NOT_GRANTED');
    assert.equal(out.formalRevenueDelta,0);
    assert.equal(out.officialKpiAllocation,'UNDECIDED');
    assert.equal(out.standardTotal,37600);
    assert.equal(out.proposedActualAmount,35000);
    assert.equal(out.priceDifference,-2600);
    assert.equal(out.proposedQuantity,2);
    assert.equal(out.expectedDailyRevision,2);
    assert.equal(out.businessDecisions.length,9);
    assert.ok(out.businessDecisions.every(x=>x.status==='UNDECIDED'));
    assert.equal(Object.isFrozen(out),true);
    assert.equal(Object.isFrozen(out.businessDecisions),true);
    assert.equal(Object.isFrozen(out.businessDecisions[0]),true);
  }
});
test('L3B1 timezone boundary: report and approvals crossing Sept/Oct detected in Asia/Taipei',()=>{
  const x=evaluate(fixture());
  assert.equal(x.sourceReportDate,'2026-09-30');
  assert.equal(x.requestedTaipeiDate,'2026-09-30');
  assert.equal(x.approvedTaipeiDate,'2026-10-01');
  assert.equal(x.sourceMonth,'2026-09');
  assert.equal(x.approvalMonth,'2026-10');
  assert.equal(x.crossMonth,true);
});
test('L3B1 same Taipei calendar month does not imply permission to recognize revenue',()=>{
  const f=fixture();f.review.updatedAtText='2026-09-30T15:59:00.000Z';
  const x=evaluate(f);assert.equal(x.crossMonth,false);assert.equal(x.postingAllowed,false);
});
test('L3B1 year boundary is factual, no automatic fiscal attribution',()=>{
  const f=fixture();f.request.proposal.reportDate='2026-12-31';
  f.request.reportDate='2026-12-31';
  f.request.createdAtText='2026-12-31T15:57:00.000Z';
  f.review.updatedAtText='2026-12-31T16:02:00.000Z';
  const x=evaluate(f);assert.equal(x.approvalMonth,'2027-01');
  assert.equal(x.crossMonth,true);assert.equal(x.recognitionMonth,null);
});
test('L3B1 decision slots are complete, unique and unapproved',()=>{
  const r=evaluate(fixture());assert.equal(new Set(DECISION_CODES).size,9);
  assert.deepEqual(r.businessDecisions.map(x=>x.code),[...DECISION_CODES]);
  assert.ok(!('policyApproved' in r));
});
test('L3B1 a caller cannot smuggle approval or accounting choices',()=>{
  deny(x=>x.authorizePosting=true,/SPECIAL_PRICE_WORKSHEET_INPUT_INVALID/);
  deny(x=>x.preflight.postingAllowed=true,/SPECIAL_PRICE_WORKSHEET_PREFLIGHT_INVALID/);
  deny(x=>x.preflight.state='POSTING_ALLOWED',/SPECIAL_PRICE_WORKSHEET_PREFLIGHT_INVALID/);
  deny(x=>x.preflight.formalRevenueDelta=100,/SPECIAL_PRICE_WORKSHEET_PREFLIGHT_INVALID/);
  deny(x=>x.preflight.officialKpiAllocation='APPROVED',/SPECIAL_PRICE_WORKSHEET_PREFLIGHT_INVALID/);
});
test('L3B1 cross-brand and stale approval/review cannot become a worksheet',()=>{
  deny(x=>x.preflight.brandId='anniu');
  deny(x=>x.request.brandId='yibo');
  deny(x=>x.review.brandId='anniu');
  deny(x=>x.review.requestId='price_'+'c'.repeat(48));
  deny(x=>x.review.status='REJECTED');
  deny(x=>x.review.status='PENDING_REVIEW');
  deny(x=>x.review.reviewRevision=2);
  deny(x=>x.review.policyRevision=4);
  deny(x=>x.review.planHash='stale');
});
test('L3B1 proposal and request identity drift fail closed',()=>{
  deny(x=>x.request.proposal.accountId='attacker');
  deny(x=>x.request.proposal.campaignId='other');
  deny(x=>x.request.proposal.versionId='other');
  deny(x=>x.request.proposal.reportDate='2026-09-29');
  deny(x=>x.request.state='POSTED');
  deny(x=>x.request.proposal.state='POSTED');
  deny(x=>x.request.proposal.approvalState='APPROVED');
  deny(x=>x.request.proposal.formalRevenueDelta=1);
  deny(x=>x.request.proposal.priceMode='APPROVED');
});
test('L3B1 quoted price arithmetic and proposed units cannot be silently changed',()=>{
  deny(x=>x.request.proposal.standardTotal=0,/PRICE_INVALID/);
  deny(x=>x.request.proposal.standardTotal=37601,/PRICE_INVALID/);
  deny(x=>x.request.proposal.actualAmount=36000,/PRICE_INVALID/);
  deny(x=>x.request.proposal.priceDifference=-1000,/PRICE_INVALID/);
  deny(x=>x.request.proposal.quantity=3,/PRICE_INVALID/);
  deny(x=>x.preflight.proposedQuantity=3,/PRICE_INVALID/);
  deny(x=>x.preflight.proposedActivityAmount=36000,/PRICE_INVALID/);
  deny(x=>x.request.proposal.quantity=0,/PRICE_INVALID/);
});
test('L3B1 missing, malformed or reverse-ordered timestamps are rejected',()=>{
  deny(x=>delete x.request.createdAtText,/TIMESTAMP_INVALID/);
  deny(x=>x.review.updatedAtText='2026-10-01',/TIMESTAMP_INVALID/);
  deny(x=>x.review.updatedAtText='2026-02-30T16:01:00.000Z',/TIMESTAMP_INVALID/);
  deny(x=>x.request.createdAtText='2026-10-01T15:58:00.000Z',/TIME_ORDER_INVALID/);
  deny(x=>x.request.reportDate='2026-02-29');
});
test('L3B1 fingerprint binds date, actor-free pricing facts, revision and quoted proposal',()=>{
  const original=fixture(),a=evaluate(original),b=evaluate(clone(original));
  assert.equal(a.worksheetFingerprint,b.worksheetFingerprint);
  assert.match(a.worksheetFingerprint,/^[a-f0-9]{64}$/);
  const rev=clone(original);rev.preflight.expectedDailyRevision=3;
  assert.notEqual(a.worksheetFingerprint,evaluate(rev).worksheetFingerprint);
  const date=clone(original);date.review.updatedAtText='2026-09-30T16:03:00.000Z';
  assert.notEqual(a.worksheetFingerprint,evaluate(date).worksheetFingerprint);
  // Fingerprint is a drift indicator for draft review, NOT a credential or settlement token.
  assert.equal(evaluate(rev).postingAllowed,false);
});
test('L3B1 malformed structure is rejected',()=>{
  assert.throws(()=>evaluate(null),/INPUT_INVALID/);
  assert.throws(()=>evaluate([]),/INPUT_INVALID/);
  deny(x=>x.request.proposal=null);
  deny(x=>x.review=null);
  deny(x=>x.preflight=null);
});
