"use strict";
// B3B2-L2 private, brand-scoped day-level reservation. Never a real sale or revenue event.
const {summaryDocumentId,invalid}=require("./activitySalesAttributionWriterLogic");
const SCHEMA="activity-sales-special-price-day-lock-v1";
function dayLockDocumentId(identity){return summaryDocumentId(identity);}
function assertDayLock(raw,identity,storeCore){
  if(!raw || raw.schemaVersion!==SCHEMA || raw.state!=="SPECIAL_PRICE_REQUESTED" ||
     raw.brandId!==identity.brandId || raw.campaignId!==identity.campaignId ||
     raw.versionId!==identity.versionId || raw.roleId!==identity.roleId ||
     raw.accountId!==identity.accountId || raw.reportDate!==identity.reportDate ||
     raw.storeCore!==storeCore || raw.formalRevenueDelta!==0 ||
     raw.officialKpiAllocation!=="UNDECIDED")
    invalid("SPECIAL_PRICE_DAY_LOCK_CORRUPT",409);
  return true;
}
function makeDayLock(identity,storeCore,createdAt,createdAtText){
  return {schemaVersion:SCHEMA,...identity,storeCore,state:"SPECIAL_PRICE_REQUESTED",
    formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED",createdAt,createdAtText};
}
module.exports={SCHEMA,dayLockDocumentId,assertDayLock,makeDayLock};
