import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {DECISION_CODES}=require('../functions/activitySalesSpecialPriceRecognitionWorksheet.js');
const {buildSpecialPricePolicyDecisionDraft}=require('../functions/activitySalesSpecialPricePolicyDecisionDraft.js');
const {AUTH_SCHEMA,parseSignoffAuthority,assertCompleteDraft,signoffId,beginSignoff,applySignoffDecision,inspectPrior}=require('../functions/activitySalesSpecialPricePolicySignoffContract.js');
const business={roleId:'director',accountId:'營運主管A'}, finance={roleId:'manager',accountId:'財務主管B'}, requester={roleId:'store',accountId:'桃園店'}, stranger={roleId:'manager',accountId:'unlisted'};
const propose={text:'依業務確認後處理之待審提案',rationale:'應確認跨月、業績對帳和關帳，非直接入帳'};
function worksheet(brandId='cyj'){
 return {schemaVersion:'activity-sales-special-price-recognition-worksheet-v1',state:'AWAITING_BUSINESS_DECISIONS_NO_POSTING',postingAllowed:false,
 periodPostingAuthority:'NOT_GRANTED',brandId,requestId:'price_'+'a'.repeat(48),worksheetFingerprint:'b'.repeat(64),reviewRevision:2,
 expectedDailyRevision:0,sourceReportDate:'2026-09-30',approvedTaipeiDate:'2026-10-01',sourceMonth:'2026-09',approvalMonth:'2026-10',crossMonth:true,
 businessDecisions:DECISION_CODES.map(code=>({code,status:'UNDECIDED'})),recognitionDate:null,recognitionMonth:null,recognizedAmount:null,
 recognizedQuantity:null,calculatedAsp:null,formalRevenueDelta:0,officialKpiAllocation:'UNDECIDED'};
}
const draft=(brand='cyj')=>buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(brand),proposals:Object.fromEntries(DECISION_CODES.map(code=>[code,propose]))});
function authority(brand='cyj'){
 return {schemaVersion:AUTH_SCHEMA,brandId:brand,revision:1,enabled:true,reviewers:{BUSINESS:[business],FINANCE:[finance]}};
}
const fails=(fn,code)=>assert.throws(fn,err=>err.code===code);
function approved(brand){const p=authority(brand),d=draft(brand); const initial=beginSignoff({authority:p,draft:d,requestedBy:requester});
 const a=applySignoffDecision({authority:p,draft:d,prior:initial,actor:business,decision:'APPROVE',expectedRevision:0});
 const b=applySignoffDecision({authority:p,draft:d,prior:a.next,actor:finance,decision:'APPROVE',expectedRevision:1});return {p,d,initial,a,b};}
for(const brand of ['cyj','anniu','yibo']){
 test(`${brand}: two distinct signoffs, still NO POSTING`,()=>{
  const {p,d,initial,a,b}=approved(brand);
  assert.equal(initial.status,'PENDING_BUSINESS_REVIEW');assert.equal(initial.authorityVerified,false);
  assert.equal(a.next.status,'PENDING_FINANCE_REVIEW');assert.equal(a.next.reviewRevision,1);
  assert.equal(b.next.status,'SIGNED_NO_POSTING');assert.equal(b.next.reviewRevision,2);
  assert.equal(b.next.postingAllowed,false);assert.equal(b.next.businessPolicyApproved,false);
  assert.equal(b.next.financialPeriodAuthority,'NOT_GRANTED');assert.equal(b.next.recognitionMonth,null);
  assert.equal(b.next.formalRevenueDelta,0);assert.equal(b.next.officialKpiAllocation,'UNDECIDED');
  assert.equal(b.decisionRecord.brandId,brand);assert.equal(b.decisionRecord.postingAllowed,false);
  assert.equal(inspectPrior(b.next,parseSignoffAuthority(p,brand),d),'SIGNED_NO_POSTING');
 });
 test(`${brand}: cannot skip business or finance stage`,()=>{
  const p=authority(brand),d=draft(brand),s=beginSignoff({authority:p,draft:d,requestedBy:requester});
  fails(()=>applySignoffDecision({authority:p,draft:d,prior:s,actor:finance,decision:'APPROVE',expectedRevision:0}),'SPECIAL_PRICE_SIGNOFF_REVIEWER_FORBIDDEN');
 });
 test(`${brand}: reject is terminal and requires reason`,()=>{
  const p=authority(brand),d=draft(brand),s=beginSignoff({authority:p,draft:d,requestedBy:requester});
  fails(()=>applySignoffDecision({authority:p,draft:d,prior:s,actor:business,decision:'REJECT',expectedRevision:0,reasonNote:'x'}),'SPECIAL_PRICE_SIGNOFF_DECISION_INVALID');
  const x=applySignoffDecision({authority:p,draft:d,prior:s,actor:business,decision:'REJECT',expectedRevision:0,reasonNote:'資料不完整'});
  assert.equal(x.next.status,'REJECTED');
  fails(()=>applySignoffDecision({authority:p,draft:d,prior:x.next,actor:finance,decision:'APPROVE',expectedRevision:1}),'SPECIAL_PRICE_SIGNOFF_TERMINAL');
 });
 test(`${brand}: no policy means fail closed`,()=>fails(()=>beginSignoff({authority:null,draft:draft(brand),requestedBy:requester}),'SPECIAL_PRICE_SIGNOFF_AUTHORITY_UNAVAILABLE'));
}
test('invalid role/member path and no implicit default',()=>{
 fails(()=>parseSignoffAuthority({...authority(),reviewers:{BUSINESS:[{roleId:'root',accountId:'boss'}],FINANCE:[finance]}},'cyj'),'SPECIAL_PRICE_SIGNOFF_ACTOR_INVALID');
 fails(()=>parseSignoffAuthority({...authority(),reviewers:{BUSINESS:[business],FINANCE:[]}},'cyj'),'SPECIAL_PRICE_SIGNOFF_REVIEWERS_INVALID');
 fails(()=>parseSignoffAuthority({...authority(),reviewers:{BUSINESS:[business],FINANCE:[business]}},'cyj'),'SPECIAL_PRICE_SIGNOFF_DUPLICATE_REVIEWER');
 fails(()=>parseSignoffAuthority({...authority(),enabled:false},'cyj'),'SPECIAL_PRICE_SIGNOFF_AUTHORITY_UNAVAILABLE');
});
test('cross-brand policies always denied',()=>fails(()=>beginSignoff({authority:authority('anniu'),draft:draft('cyj'),requestedBy:requester}),'SPECIAL_PRICE_SIGNOFF_AUTHORITY_UNAVAILABLE'));
test('stale authority revision/hash and reviewer swap denied',()=>{
 const {p,d,initial,a}=approved('cyj');
 fails(()=>applySignoffDecision({authority:{...p,revision:2},draft:d,prior:initial,actor:business,decision:'APPROVE',expectedRevision:0}),'SPECIAL_PRICE_SIGNOFF_STATE_STALE');
 fails(()=>applySignoffDecision({authority:{...p,reviewers:{BUSINESS:[{roleId:'director',accountId:'another'}],FINANCE:[finance]}},draft:d,prior:initial,actor:business,decision:'APPROVE',expectedRevision:0}),'SPECIAL_PRICE_SIGNOFF_STATE_STALE');
 fails(()=>applySignoffDecision({authority:p,draft:d,prior:a.next,actor:finance,decision:'APPROVE',expectedRevision:0}),'SPECIAL_PRICE_SIGNOFF_REVISION_CONFLICT');
});
test('changing draft fingerprint or rationale invalidates prior review',()=>{
 const p=authority(),d=draft(),s=beginSignoff({authority:p,draft:d,requestedBy:requester});
 const tampered={...d,decisions:d.decisions.map((x,i)=>i===0?{...x,rationale:'惡意替換原始提案'}:x)};
 fails(()=>applySignoffDecision({authority:p,draft:tampered,prior:s,actor:business,decision:'APPROVE',expectedRevision:0}),'SPECIAL_PRICE_SIGNOFF_DRAFT_FINGERPRINT_INVALID');
 const different=buildSpecialPricePolicyDecisionDraft({worksheet:worksheet(),proposals:Object.fromEntries(DECISION_CODES.map((c,i)=>[c,{...propose,rationale:i===0?'真正不同但合法的替代方案':propose.rationale}]))});
 fails(()=>applySignoffDecision({authority:p,draft:different,prior:s,actor:business,decision:'APPROVE',expectedRevision:0}),'SPECIAL_PRICE_SIGNOFF_STATE_STALE');
});
test('requester self approval denied even when explicitly listed',()=>{
 const p={...authority(),reviewers:{BUSINESS:[requester],FINANCE:[finance]}},d=draft(),s=beginSignoff({authority:p,draft:d,requestedBy:requester});
 fails(()=>applySignoffDecision({authority:p,draft:d,prior:s,actor:requester,decision:'APPROVE',expectedRevision:0}),'SPECIAL_PRICE_SIGNOFF_SELF_APPROVAL_FORBIDDEN');
});
test('missing draft item and fake posting approved are rejected',()=>{
 const p=authority();const d=draft();
 fails(()=>beginSignoff({authority:p,draft:{...d,decisions:d.decisions.slice(1)},requestedBy:requester}),'SPECIAL_PRICE_SIGNOFF_DRAFT_INVALID');
 fails(()=>beginSignoff({authority:p,draft:{...d,postingAllowed:true},requestedBy:requester}),'SPECIAL_PRICE_SIGNOFF_DRAFT_INVALID');
 fails(()=>beginSignoff({authority:p,draft:{...d,businessAuthority:'APPROVED'},requestedBy:requester}),'SPECIAL_PRICE_SIGNOFF_DRAFT_INVALID');
});
test('tampered review status/votes/posting denied',()=>{
 const {p,d,initial,a}=approved('cyj');const plan=parseSignoffAuthority(p,'cyj');
 fails(()=>inspectPrior({...initial,status:'SIGNED_NO_POSTING'},plan,d),'SPECIAL_PRICE_SIGNOFF_STATE_INVALID');
 fails(()=>inspectPrior({...a.next,decisions:[{...a.next.decisions[0],actor:stranger}]},plan,d),'SPECIAL_PRICE_SIGNOFF_STATE_UNAUTHORIZED');
 fails(()=>inspectPrior({...a.next,postingAllowed:true},plan,d),'SPECIAL_PRICE_SIGNOFF_STATE_INVALID');
});
test('unauthorized finance signer / terminal replay denied',()=>{
 const {p,d,a,b}=approved('cyj');
 fails(()=>applySignoffDecision({authority:p,draft:d,prior:a.next,actor:stranger,decision:'APPROVE',expectedRevision:1}),'SPECIAL_PRICE_SIGNOFF_REVIEWER_FORBIDDEN');
 fails(()=>applySignoffDecision({authority:p,draft:d,prior:b.next,actor:finance,decision:'APPROVE',expectedRevision:2}),'SPECIAL_PRICE_SIGNOFF_TERMINAL');
});
test('stable opaque signoff IDs bind request and draft',()=>{
 const d=draft();assert.equal(signoffId('cyj',d.requestId,d.draftFingerprint),signoffId('cyj',d.requestId,d.draftFingerprint));
 assert.notEqual(signoffId('anniu',d.requestId,d.draftFingerprint),signoffId('cyj',d.requestId,d.draftFingerprint));
 fails(()=>signoffId('cyj','../../foo',d.draftFingerprint),'SPECIAL_PRICE_SIGNOFF_ID_INVALID');
});
test('no hidden policy grant can be smuggled in authority',()=>{
 fails(()=>parseSignoffAuthority({...authority(),postingAllowed:true},'cyj'),'SPECIAL_PRICE_SIGNOFF_AUTHORITY_UNAVAILABLE');
});
