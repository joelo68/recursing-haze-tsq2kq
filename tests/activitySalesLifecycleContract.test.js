import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {KINDS,pricingException,normalizeEvent,lifecycleDocumentId,evaluateLifecycle}=require("../functions/activitySalesLifecycleContract.js");
const root={brandId:"cyj",campaignId:"campaign_01",versionId:"campaign_01_v001",roleId:"therapist",accountId:"T001",reportDate:"2026-10-08",saleId:"S001",packageId:"A",quantity:1,attributedAmount:18800,formalRevenueDelta:0};
const event=(kind,rev=0,extra={})=>({brandId:root.brandId,campaignId:root.campaignId,versionId:root.versionId,roleId:root.roleId,accountId:root.accountId,reportDate:root.reportDate,saleId:root.saleId,
 eventId:`E_${kind}_${rev}`,kind,eventDate:"2026-10-09",expectedEventRevision:rev,reasonCode:"other",reasonNote:"客戶服務流程紀錄",...extra});
const fail=(fn,code)=>assert.throws(fn,e=>(e.code||e.message)===code);

test("standard price remains unexceptional; exceptions are pending, never auto-approved",()=>{
 const standard=pricingException({standardUnitPrice:18800,quantity:1,actualAmount:18800});
 assert.equal(standard.approvalState,"NOT_REQUIRED");
 const exceptional=pricingException({standardUnitPrice:18800,quantity:1,actualAmount:17800,reasonCode:"special_discount"});
 assert.equal(exceptional.approvalState,"PENDING");assert.equal(exceptional.priceDifference,-1000);
 fail(()=>pricingException({standardUnitPrice:18800,quantity:1,actualAmount:17800}),"LIFECYCLE_SPECIAL_PRICE_REASON_REQUIRED");
 fail(()=>pricingException({standardUnitPrice:18800,quantity:1,actualAmount:17800,reasonCode:"other",reasonNote:"no"}),"LIFECYCLE_REASON_NOTE_INVALID");
 fail(()=>pricingException({standardUnitPrice:18800,quantity:1,actualAmount:17800,reasonCode:"special_discount",approvalPolicy:"AUTO_APPROVE"}),"LIFECYCLE_APPROVAL_POLICY_UNAUTHORIZED");
 fail(()=>pricingException({standardUnitPrice:18800,quantity:1,actualAmount:18800,reasonCode:"special_discount"}),"LIFECYCLE_NORMAL_PRICE_REASON_CONFLICT");
});

test("append-only event identity isolates all brands, users, dates, versions and event IDs",()=>{
 const base=event(KINDS.REFUND,0,{refundAmount:2000});
 const key=lifecycleDocumentId(base);assert.match(key,/^life_[a-f0-9]{48}$/);
 for(const p of [{brandId:"anniu"},{brandId:"yibo"},{accountId:"T002"},{versionId:"campaign_01_v002"},{reportDate:"2026-10-07",eventDate:"2026-10-08"},{eventId:"other"}]) {
   assert.notEqual(lifecycleDocumentId({...base,...p}),key);
 }
});

test("refund events preserve original sale and net arithmetic with exact replay idempotency",()=>{
 const e1=event(KINDS.REFUND,0,{refundAmount:4000});
 const e2=event(KINDS.REFUND,1,{refundAmount:14800});
 const snap=structuredClone(root);
 const result=evaluateLifecycle(root,[e1,e1,e2]);
 assert.equal(result.state,"FULL_REFUND");assert.equal(result.eventRevision,2);
 assert.equal(result.refundAttributedAmount,18800);assert.equal(result.netAttributedAmount,0);
 assert.equal(result.currentGrossAttributedAmount,18800);assert.equal(result.formalRevenueDelta,0);
 assert.equal(result.officialKpiAllocation,"UNDECIDED");assert.deepEqual(root,snap);
 fail(()=>evaluateLifecycle(root,[e1,{...e1,refundAmount:2000}]),"LIFECYCLE_IDEMPOTENCY_CONFLICT");
 fail(()=>evaluateLifecycle(root,[e1,event(KINDS.REFUND,1,{refundAmount:15000})]),"LIFECYCLE_OVER_REFUND");
 fail(()=>evaluateLifecycle(root,[e1,event(KINDS.REFUND,2,{refundAmount:1})]),"LIFECYCLE_REVISION_CONFLICT");
 fail(()=>evaluateLifecycle(root,[e1,e2,event(KINDS.REFUND,2,{refundAmount:1})]),"LIFECYCLE_TERMINAL_STATE");
});

test("correction preserves original, changes provisional gross only before refunds",()=>{
 const correction=event(KINDS.CORRECTION,0,{replacement:{packageId:"B",quantity:2,attributedAmount:17600}});
 const refund=event(KINDS.REFUND,1,{refundAmount:2600});
 const result=evaluateLifecycle(root,[correction,refund]);
 assert.equal(result.originalAttributedAmount,18800);assert.equal(result.currentGrossAttributedAmount,17600);
 assert.equal(result.currentQuantity,2);assert.equal(result.currentPackageId,"B");
 assert.equal(result.netAttributedAmount,15000);assert.equal(result.state,"PARTIAL_REFUND");
 fail(()=>evaluateLifecycle(root,[event(KINDS.REFUND,0,{refundAmount:500}),event(KINDS.CORRECTION,1,{replacement:{packageId:"B",quantity:1,attributedAmount:16000}})]),"LIFECYCLE_CORRECTION_AFTER_REFUND");
});

test("cancellation is terminal; refunded portion remains distinct",()=>{
 const refund=event(KINDS.REFUND,0,{refundAmount:800});
 const cancel=event(KINDS.CANCELLATION,1);
 const result=evaluateLifecycle(root,[refund,cancel]);
 assert.equal(result.refundAttributedAmount,800);assert.equal(result.cancelledAttributedAmount,18000);
 assert.equal(result.netAttributedAmount,0);assert.equal(result.state,"CANCELLED");
 fail(()=>evaluateLifecycle(root,[cancel]),"LIFECYCLE_REVISION_CONFLICT");
 fail(()=>evaluateLifecycle(root,[event(KINDS.CANCELLATION,0),event(KINDS.CANCELLATION,1)]),"LIFECYCLE_TERMINAL_STATE");
});

test("mismatched brand, actor, immutable version, and formal revenue adjustment fail closed",()=>{
 const e=event(KINDS.REFUND,0,{refundAmount:100});
 for(const part of [{brandId:"anniu"},{brandId:"yibo"},{accountId:"Other"},{versionId:"campaign_01_v002"},{saleId:"OTHER"}]) {
   fail(()=>evaluateLifecycle(root,[{...e,...part}]),"LIFECYCLE_SUBJECT_MISMATCH");
 }
 fail(()=>normalizeEvent({...e,formalRevenueDelta:-100}),"LIFECYCLE_FORMAL_REVENUE_FORBIDDEN");
 fail(()=>evaluateLifecycle({...root,approvalState:"PENDING"},[]),"LIFECYCLE_PENDING_SALE_NOT_ELIGIBLE");
});

test("malformed event dates, identifiers, reasons, amounts and illegal kind rejected",()=>{
 const good=event(KINDS.REFUND,0,{refundAmount:100});
 fail(()=>normalizeEvent({...good,eventDate:"2026-02-30"}),"ACTIVITY_DATE_INVALID");
 fail(()=>normalizeEvent({...good,eventDate:"2026-10-07"}),"LIFECYCLE_EVENT_BEFORE_SALE");
 fail(()=>normalizeEvent({...good,eventId:"bad/path"}),"LIFECYCLE_EVENT_ID_INVALID");
 fail(()=>normalizeEvent({...good,refundAmount:0}),"LIFECYCLE_MONEY_INVALID");
 fail(()=>normalizeEvent({...good,kind:"DELETE"}),"LIFECYCLE_EVENT_KIND_INVALID");
 fail(()=>normalizeEvent({...good,reasonCode:""}),"LIFECYCLE_REASON_REQUIRED");
 fail(()=>normalizeEvent({...good,expectedEventRevision:-1}),"LIFECYCLE_REVISION_INVALID");
 fail(()=>normalizeEvent({...good,replacement:{}}),"LIFECYCLE_EVENT_FIELDS_INVALID");
 fail(()=>evaluateLifecycle(root,[good,...Array.from({length:100},(_,i)=>({...good,eventId:`e_${i}`}))]),"LIFECYCLE_EVENTS_INVALID");
});

test("none of the Phase 2A-5A contracts imports firebase or exposes a backend writer",()=>{
 assert.deepEqual(Object.keys(require("../functions/activitySalesLifecycleContract.js")).sort(),
  ["KINDS","PRICE_REASONS","pricingException","normalizeEvent","lifecycleDocumentId","evaluateLifecycle"].sort());
 const s=evaluateLifecycle(root,[]);assert.equal(s.netAttributedAmount,18800);assert.equal(s.eventRevision,0);
});
