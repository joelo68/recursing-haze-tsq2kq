"use strict";
// Phase 2A-5B3B2-L3A PURE preflight contract. NOT a posting permission or a writer.
// All arguments must be obtained within a future single BRAND-SCOPED Firestore transaction.
// An account's current privileges and financial posting period are NOT decided here.
const crypto=require("node:crypto");
const {validIdentity,attributionDocumentId}=require("./activitySalesAttributionContract");
const {parsePlan,STATE_SCHEMA}=require("./activitySalesLifecycleReviewPolicy");
const {specialPriceRequestId,buildSpecialPriceRequest}=require("./activitySalesSpecialPriceRequestContract");
const {assertDayLock}=require("./activitySalesSpecialPriceDayLock");
const {reportKey,assertReport,assertSaleWindow,summaryDocumentId}=require("./activitySalesAttributionWriterLogic");
const BRANDS=new Set(["cyj","anniu","yibo"]);
function refuse(code){const e=new Error(code);e.code=code;e.status=409;throw e;}
const hash=value=>crypto.createHash("sha256").update(value).digest("hex").slice(0,48);
function assertQuorum(review,plan,request){
  if(!review || review.schemaVersion!==STATE_SCHEMA || review.brandId!==plan.brandId ||
     review.kind!=="SPECIAL_PRICE" || review.status!=="APPROVED_PENDING_SETTLEMENT" ||
     review.policyRevision!==plan.policyRevision || review.planHash!==plan.planHash ||
     review.requestId!==request.requestId || review.formalRevenueDelta!==0 ||
     review.officialKpiAllocation!=="UNDECIDED" ||
     !Number.isSafeInteger(review.reviewRevision) || review.reviewRevision<1 ||
     review.stepIndex!==plan.steps.length-1 || !review.decisions ||
     typeof review.decisions!=="object" || Array.isArray(review.decisions))
    refuse("SPECIAL_PRICE_SETTLEMENT_REVIEW_INVALID");
  const entries=Object.entries(review.decisions);
  if(!entries.length || entries.length>50 || entries.length!==review.reviewRevision)
    refuse("SPECIAL_PRICE_SETTLEMENT_REVIEW_REVISION_INVALID");
  const votes=new Map(plan.steps.map(step=>[step.stepId,new Set()]));
  const requester=`${request.requestedByRole}\0${request.requestedByAccountId}`;
  for(const [storedKey,vote] of entries){
    if(!vote || vote.decision!=="APPROVE" ||
       typeof vote.stepId!=="string" || typeof vote.roleId!=="string" ||
       typeof vote.accountId!=="string") refuse("SPECIAL_PRICE_SETTLEMENT_VOTE_INVALID");
    const step=plan.steps.find(s=>s.stepId===vote.stepId);
    const actorKey=`${vote.roleId}\0${vote.accountId}`;
    if(!step || !step.members.some(m=>m.roleId===vote.roleId && m.accountId===vote.accountId) ||
       storedKey!==hash(actorKey) || (!plan.allowRequesterApproval && actorKey===requester) ||
       votes.get(step.stepId).has(actorKey)) refuse("SPECIAL_PRICE_SETTLEMENT_VOTE_UNAUTHORIZED");
    votes.get(step.stepId).add(actorKey);
  }
  for(const step of plan.steps){
    const n=votes.get(step.stepId).size;
    if(step.quorum==="ALL" ? n!==step.members.length : n<1)
      refuse("SPECIAL_PRICE_SETTLEMENT_QUORUM_INCOMPLETE");
  }
  return review.reviewRevision;
}
function assertSpecialPriceSettlementPreflight({
  brandId,requestId,request,requestState,review,policy,dayLock,
  publication,version,report,sellerStoreCore,existingSale=null,
  lifecycleLock=null,daily=null,expectedDailyRevision
}={}){
  if(!BRANDS.has(brandId) || !/^price_[a-f0-9]{48}$/.test(requestId||""))
    refuse("SPECIAL_PRICE_SETTLEMENT_ID_INVALID");
  const proposal=request?.proposal;
  let identity;
  try{identity=validIdentity(proposal);}catch{refuse("SPECIAL_PRICE_SETTLEMENT_IDENTITY_INVALID");}
  if(identity.brandId!==brandId || !["therapist","store"].includes(identity.roleId) ||
     /[\\/]/.test(identity.accountId) ||
     specialPriceRequestId(identity,proposal.saleId)!==requestId ||
     request.schemaVersion!=="activity-sales-special-price-request-record-v1" ||
     request.requestId!==requestId || request.state!=="PENDING_REVIEW" ||
     request.formalRevenueDelta!==0 || request.officialKpiAllocation!=="UNDECIDED" ||
     proposal.schemaVersion!=="activity-sales-special-price-request-v1" ||
     proposal.state!=="PENDING_REVIEW" || proposal.approvalState!=="PENDING_REVIEW" ||
     proposal.formalRevenueDelta!==0 || proposal.officialKpiAllocation!=="UNDECIDED" ||
     request.brandId!==brandId || request.campaignId!==identity.campaignId ||
     request.versionId!==identity.versionId || request.roleId!==identity.roleId ||
     request.accountId!==identity.accountId || request.reportDate!==identity.reportDate ||
     request.saleId!==proposal.saleId || request.requestedByRole!==identity.roleId ||
     request.requestedByAccountId!==identity.accountId ||
     !Number.isSafeInteger(request.policyRevision) ||
     !request.planHash || typeof request.storeCore!=="string" ||
     request.storeCore!==sellerStoreCore || typeof request.storeName!=="string" ||
     !request.storeName.trim() || request.storeName.length>120 || /[\\/]/.test(request.storeName) ||
     request.reportDocId!==reportKey(identity,request.storeName))
    refuse("SPECIAL_PRICE_SETTLEMENT_REQUEST_STALE");
  const saleKey=attributionDocumentId(identity,proposal.saleId);
  if(!requestState || requestState.schemaVersion!=="activity-sales-special-price-request-state-v1" ||
     requestState.requestId!==requestId || requestState.state!=="PENDING_REVIEW" ||
     requestState.requestRevision!==1 || requestState.brandId!==brandId ||
     requestState.campaignId!==identity.campaignId || requestState.versionId!==identity.versionId ||
     requestState.roleId!==identity.roleId || requestState.accountId!==identity.accountId ||
     requestState.reportDate!==identity.reportDate || requestState.saleId!==proposal.saleId ||
     requestState.storeCore!==sellerStoreCore || requestState.storeName!==request.storeName ||
     requestState.reportDocId!==request.reportDocId || requestState.formalRevenueDelta!==0 ||
     requestState.officialKpiAllocation!=="UNDECIDED")
    refuse("SPECIAL_PRICE_SETTLEMENT_LOCK_STALE");
  if(existingSale!==null && existingSale!==undefined || lifecycleLock!==null && lifecycleLock!==undefined)
    refuse("SPECIAL_PRICE_SETTLEMENT_SALE_CONFLICT");
  const plan=parsePlan(policy,"SPECIAL_PRICE",brandId);
  if(plan.policyRevision!==request.policyRevision || plan.planHash!==request.planHash)
    refuse("SPECIAL_PRICE_SETTLEMENT_POLICY_STALE");
  const reviewRevision=assertQuorum(review,plan,request);
  assertDayLock(dayLock,identity,sellerStoreCore);
  if(!report)refuse("SPECIAL_PRICE_SETTLEMENT_REPORT_MISSING");
  assertReport(report,identity,sellerStoreCore);
  const pkg=assertSaleWindow(publication,version,identity,sellerStoreCore,proposal.packageId);
  let expected;
  try{expected=buildSpecialPriceRequest({identity,saleId:proposal.saleId,packageId:proposal.packageId,
    quantity:proposal.quantity,actualAmount:proposal.actualAmount,reasonCode:proposal.reasonCode,
    reasonNote:proposal.reasonNote},pkg.salePrice);}catch{refuse("SPECIAL_PRICE_SETTLEMENT_PRICE_INVALID");}
  if(JSON.stringify(expected)!==JSON.stringify(proposal))refuse("SPECIAL_PRICE_SETTLEMENT_PRICE_STALE");
  const revision=daily===null||daily===undefined?0:daily.revision;
  if(daily!==null && daily!==undefined &&
     (daily.schemaVersion!=="activity-sales-daily-attribution-v1" || daily.status!=="HAS_SALES" ||
      daily.brandId!==brandId || daily.campaignId!==identity.campaignId ||
      daily.versionId!==identity.versionId || daily.roleId!==identity.roleId ||
      daily.accountId!==identity.accountId || daily.reportDate!==identity.reportDate ||
      daily.storeCore!==sellerStoreCore || daily.formalRevenueDelta!==0 ||
      !Number.isSafeInteger(daily.attributedAmount) || daily.attributedAmount<1 ||
      !Number.isSafeInteger(daily.saleCount) || daily.saleCount<1))
    refuse("SPECIAL_PRICE_SETTLEMENT_DAILY_INVALID");
  if(!Number.isSafeInteger(revision) || revision<0 || !Number.isSafeInteger(expectedDailyRevision) ||
     expectedDailyRevision!==revision)refuse("SPECIAL_PRICE_SETTLEMENT_DAILY_REVISION_CONFLICT");
  // A pure immutable snapshot of validated facts; NEVER authorize posting from this object.
  return Object.freeze({
    state:"PREFLIGHT_PASSED_NO_POSTING",postingAllowed:false,requestId,brandId,
    saleDocumentId:saleKey,dailyDocumentId:summaryDocumentId(identity),
    reviewRevision,expectedDailyRevision:revision,proposedActivityAmount:proposal.actualAmount,
    proposedQuantity:proposal.quantity,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"
  });
}
module.exports={assertSpecialPriceSettlementPreflight,assertQuorum};
