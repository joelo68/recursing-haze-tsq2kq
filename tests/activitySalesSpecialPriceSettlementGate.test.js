import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {assertSpecialPriceSettlementPreflight}=require('../functions/activitySalesSpecialPriceSettlementGate.js');
const {buildSpecialPriceRequest,specialPriceRequestId}=require('../functions/activitySalesSpecialPriceRequestContract.js');
const {parsePlan,applyDecision}=require('../functions/activitySalesLifecycleReviewPolicy.js');
const {makeDayLock}=require('../functions/activitySalesSpecialPriceDayLock.js');
const {attributionDocumentId}=require('../functions/activitySalesAttributionContract.js');
const copy=v=>structuredClone(v);
const policy=brandId=>({schemaVersion:'activity-sales-lifecycle-review-policy-v1',brandId,revision:3,enabled:true,groups:{},flows:{
  SPECIAL_PRICE:{enabled:true,allowRequesterApproval:false,steps:[
    {stepId:'lead',quorum:'ALL',reviewers:[{type:'account',roleId:'store',accountId:'S001'},{type:'account',roleId:'manager',accountId:'M001'}]},
    {stepId:'final',quorum:'ANY',reviewers:[{type:'account',roleId:'director',accountId:'D001'}]}
  ]}}});
function fixture(brandId='cyj',roleId='therapist'){
  const identity={brandId,campaignId:'campaign01',versionId:'campaign01_v001',roleId,
    accountId:roleId==='therapist'?'T001':'S002',reportDate:'2026-10-09'};
  const storeName=`${brandId==='cyj'?'CYJ':brandId==='anniu'?'安妞':'伊啵'}崇學店`;
  const proposal=buildSpecialPriceRequest({identity,saleId:'sale001',packageId:'pkg001',quantity:2,
    actualAmount:35000,reasonCode:'special_discount',reasonNote:'主管核准優惠'},18800);
  const requestId=specialPriceRequestId(identity,'sale001');
  const plan=parsePlan(policy(brandId),'SPECIAL_PRICE',brandId);
  const request={schemaVersion:'activity-sales-special-price-request-record-v1',...identity,
    requestId,saleId:'sale001',storeName,storeCore:'崇學',reportDocId:identity.roleId==='therapist'?'2026-10-09_T001':`2026-10-09_${storeName}`,
    requestedByRole:roleId,requestedByAccountId:identity.accountId,proposal,state:'PENDING_REVIEW',
    policyRevision:plan.policyRevision,planHash:plan.planHash,formalRevenueDelta:0,officialKpiAllocation:'UNDECIDED'};
  let old=null;
  for(const a of [{roleId:'store',accountId:'S001'},{roleId:'manager',accountId:'M001'},{roleId:'director',accountId:'D001'}]){
    old=applyDecision({requestId,request,plan,prior:old,actor:a,decision:'APPROVE',
      expectedReviewRevision:old?.reviewRevision||0});
  }
  assert.equal(old.status,'APPROVED_PENDING_SETTLEMENT');
  return {brandId,requestId,request,requestState:{schemaVersion:'activity-sales-special-price-request-state-v1',...identity,
    requestId,saleId:'sale001',storeCore:'崇學',storeName,reportDocId:request.reportDocId,state:'PENDING_REVIEW',requestRevision:1,
    formalRevenueDelta:0,officialKpiAllocation:'UNDECIDED'},review:old,policy:policy(brandId),
    dayLock:makeDayLock(identity,'崇學','now','2026-10-09T00:00:00Z'),
    publication:{brandId,campaignId:identity.campaignId,versionId:identity.versionId,status:'published',startDate:'2026-10-01',endDate:'2026-10-31'},
    version:{brandId,campaignId:identity.campaignId,versionId:identity.versionId,campaignSnapshot:{startDate:'2026-10-01',endDate:'2026-10-31',storeScope:'all',packages:[{packageId:'pkg001',salePrice:18800}]}},
    report:{date:identity.reportDate,brandId,storeName,...(roleId==='therapist'?{therapistId:'T001'}:{})},
    sellerStoreCore:'崇學',existingSale:null,lifecycleLock:null,daily:null,expectedDailyRevision:0};
}
const evaluate=x=>assertSpecialPriceSettlementPreflight(x);
const deny=(original,edit,pattern)=>{
  const f=copy(original);edit(f);assert.throws(()=>evaluate(f),pattern);
};
test('L3A: three brands + both seller roles pass pure preflight without posting capability',()=>{
  for(const brand of ['cyj','anniu','yibo'])for(const role of ['therapist','store']){
    const f=fixture(brand,role),r=evaluate(f);
    assert.equal(r.state,'PREFLIGHT_PASSED_NO_POSTING');assert.equal(r.postingAllowed,false);
    assert.equal(r.formalRevenueDelta,0);assert.equal(r.officialKpiAllocation,'UNDECIDED');
    assert.equal(r.proposedActivityAmount,35000);assert.equal(r.proposedQuantity,2);
    assert.equal(r.reviewRevision,3);assert.equal(r.expectedDailyRevision,0);
    assert.equal(r.saleDocumentId,attributionDocumentId(f.request.proposal,'sale001'));
    assert.equal(Object.isFrozen(r),true);
  }
});
test('L3A: healthy HAS_SALES aggregate with OCC revision is a preflight fact, not an additive write',()=>{
  const f=fixture();const i=f.request.proposal;
  f.daily={schemaVersion:'activity-sales-daily-attribution-v1',brandId:i.brandId,campaignId:i.campaignId,
    versionId:i.versionId,roleId:i.roleId,accountId:i.accountId,reportDate:i.reportDate,
    storeCore:'崇學',status:'HAS_SALES',revision:4,attributedAmount:18800,saleCount:1,formalRevenueDelta:0};
  f.expectedDailyRevision=4;const out=evaluate(f);assert.equal(out.expectedDailyRevision,4);
  deny(f,x=>x.expectedDailyRevision=3,/SPECIAL_PRICE_SETTLEMENT_DAILY_REVISION_CONFLICT/);
  deny(f,x=>x.daily.status='CONFIRMED_ZERO',/SPECIAL_PRICE_SETTLEMENT_DAILY_INVALID/);
});
test('L3A: impossible approval state, quorum, forged member, duplicate or revision rejects',()=>{
  const f=fixture();
  deny(f,x=>x.review.status='PENDING_REVIEW',/SPECIAL_PRICE_SETTLEMENT_REVIEW_INVALID/);
  deny(f,x=>x.review.status='REJECTED',/SPECIAL_PRICE_SETTLEMENT_REVIEW_INVALID/);
  deny(f,x=>x.review.reviewRevision=2,/SPECIAL_PRICE_SETTLEMENT_REVIEW_REVISION_INVALID/);
  deny(f,x=>x.review.decisions={},/SPECIAL_PRICE_SETTLEMENT_REVIEW_REVISION_INVALID/);
  deny(f,x=>{const key=Object.keys(x.review.decisions)[0];delete x.review.decisions[key];x.review.reviewRevision=2;},/SPECIAL_PRICE_SETTLEMENT_QUORUM_INCOMPLETE/);
  deny(f,x=>{const k=Object.keys(x.review.decisions)[0];x.review.decisions[k].accountId='ATTACKER';},/SPECIAL_PRICE_SETTLEMENT_VOTE_UNAUTHORIZED/);
  deny(f,x=>{const k=Object.keys(x.review.decisions)[0];x.review.decisions[k].decision='REJECT';},/SPECIAL_PRICE_SETTLEMENT_VOTE_INVALID/);
  deny(f,x=>x.review.planHash='forged',/SPECIAL_PRICE_SETTLEMENT_REVIEW_INVALID/);
  deny(f,x=>x.review.stepIndex=0,/SPECIAL_PRICE_SETTLEMENT_REVIEW_INVALID/);
});
test('L3A: brand / policy / identity isolation and request anchor mismatch fail closed',()=>{
  const f=fixture();
  deny(f,x=>x.brandId='anniu',/SPECIAL_PRICE_SETTLEMENT_REQUEST_STALE/);
  deny(f,x=>x.requestId='price_'+ 'f'.repeat(48),/SPECIAL_PRICE_SETTLEMENT_REQUEST_STALE/);
  deny(f,x=>x.request.proposal.accountId='T_OTHER',/SPECIAL_PRICE_SETTLEMENT_REQUEST_STALE/);
  deny(f,x=>x.request.requestedByAccountId='OTHER',/SPECIAL_PRICE_SETTLEMENT_REQUEST_STALE/);
  deny(f,x=>x.request.policyRevision++,/SPECIAL_PRICE_SETTLEMENT_POLICY_STALE/);
  deny(f,x=>x.policy.brandId='anniu',/LIFECYCLE_REVIEW_POLICY_UNAVAILABLE/);
  deny(f,x=>x.policy.enabled=false,/LIFECYCLE_REVIEW_POLICY_UNAVAILABLE/);
  deny(f,x=>x.request.storeName='CYJ其它店',/SPECIAL_PRICE_SETTLEMENT_LOCK_STALE/);
  deny(f,x=>x.requestState.requestRevision=2,/SPECIAL_PRICE_SETTLEMENT_LOCK_STALE/);
  deny(f,x=>x.requestState.requestId='price_'+ 'a'.repeat(48),/SPECIAL_PRICE_SETTLEMENT_LOCK_STALE/);
  deny(f,x=>x.requestState.state='REJECTED',/SPECIAL_PRICE_SETTLEMENT_LOCK_STALE/);
});
test('L3A: original sale / lifecycle lock / malformed or missing day lock forbid posting preflight',()=>{
  const f=fixture();
  deny(f,x=>x.existingSale={brandId:'cyj'},/SPECIAL_PRICE_SETTLEMENT_SALE_CONFLICT/);
  deny(f,x=>x.lifecycleLock={state:'PENDING_REVIEW'},/SPECIAL_PRICE_SETTLEMENT_SALE_CONFLICT/);
  deny(f,x=>x.dayLock=null,/SPECIAL_PRICE_DAY_LOCK_CORRUPT/);
  deny(f,x=>x.dayLock.brandId='yibo',/SPECIAL_PRICE_DAY_LOCK_CORRUPT/);
  deny(f,x=>x.dayLock.state='RELEASED',/SPECIAL_PRICE_DAY_LOCK_CORRUPT/);
  deny(f,x=>x.sellerStoreCore='西門',/SPECIAL_PRICE_SETTLEMENT_REQUEST_STALE/);
});
test('L3A: report, published version, price and scope are authoritative, not caller self-claims',()=>{
  const f=fixture();
  deny(f,x=>x.report=null,/SPECIAL_PRICE_SETTLEMENT_REPORT_MISSING/);
  deny(f,x=>x.report.date='2026-10-08',/ATTRIBUTION_REPORT_MISMATCH/);
  deny(f,x=>x.report.therapistId='ATTACKER',/ATTRIBUTION_REPORT_OWNER_MISMATCH/);
  deny(f,x=>x.publication.status='draft',/ATTRIBUTION_PUBLICATION_CHANGED/);
  deny(f,x=>x.version.campaignSnapshot.packages[0].salePrice=18000,/SPECIAL_PRICE_SETTLEMENT_PRICE_STALE/);
  deny(f,x=>x.version.campaignSnapshot.storeScope='selected',/ATTRIBUTION_STORE_NOT_ELIGIBLE/);
  deny(f,x=>x.request.proposal.actualAmount=28000,/SPECIAL_PRICE_SETTLEMENT_PRICE_STALE/);
  deny(f,x=>x.request.proposal.quantity=3,/SPECIAL_PRICE_SETTLEMENT_PRICE_STALE/);
});
test('L3A: invalid daily identity, totals, absent-day revision and foreign actor fail closed',()=>{
  const f=fixture();
  deny(f,x=>x.expectedDailyRevision=1,/SPECIAL_PRICE_SETTLEMENT_DAILY_REVISION_CONFLICT/);
  deny(f,x=>x.expectedDailyRevision=-1,/SPECIAL_PRICE_SETTLEMENT_DAILY_REVISION_CONFLICT/);
  deny(f,x=>x.daily={status:'CONFIRMED_ZERO',revision:1},/SPECIAL_PRICE_SETTLEMENT_DAILY_INVALID/);
  deny(f,x=>x.request.formalRevenueDelta=100,/SPECIAL_PRICE_SETTLEMENT_REQUEST_STALE/);
  deny(f,x=>x.review.formalRevenueDelta=100,/SPECIAL_PRICE_SETTLEMENT_REVIEW_INVALID/);
});
