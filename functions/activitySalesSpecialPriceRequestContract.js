"use strict";
// Phase 2A-5B3A: inert proposal contract. NEVER an authoritative sale or settlement.
const crypto=require("node:crypto");
const {validIdentity,attributionDocumentId}=require("./activitySalesAttributionContract");
const {pricingException}=require("./activitySalesLifecycleContract");
const SAFE=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const INPUT_FIELDS=new Set(["action","brandId","campaignId","versionId","reportDate","storeName","saleId","packageId","quantity","actualAmount","reasonCode","reasonNote","expectedRevision","formalRevenueDelta","actor"]);
function reject(code,status=400){const e=new Error(code);e.code=code;e.status=status;throw e;}
function checkedSpecialPriceRequest(raw={}){
  if(!raw || typeof raw!=="object" || Array.isArray(raw) || Object.keys(raw).some(k=>!INPUT_FIELDS.has(k)) || raw.action!=="request_special_price")reject("SPECIAL_PRICE_INPUT_INVALID");
  const actor=raw.actor;
  if(!actor || typeof actor!=="object" || Array.isArray(actor) || Object.keys(actor).some(k=>!["roleId","accountId","deviceId","credentialPassword"].includes(k)))reject("SPECIAL_PRICE_ACTOR_FIELDS_INVALID");
  let identity;
  try{identity=validIdentity({...raw,roleId:actor.roleId,accountId:actor.accountId});}catch{reject("SPECIAL_PRICE_IDENTITY_INVALID");}
  if(/[\\/]/.test(identity.accountId) || !SAFE.test(raw.saleId||"") || !SAFE.test(raw.packageId||""))reject("SPECIAL_PRICE_ID_INVALID");
  if(typeof raw.storeName!=="string" || !raw.storeName.trim() || raw.storeName.length>120 || /[\\/]/.test(raw.storeName))reject("SPECIAL_PRICE_STORE_INVALID");
  if(!Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision!==0)reject("SPECIAL_PRICE_REVISION_INVALID");
  if(raw.formalRevenueDelta!==undefined && raw.formalRevenueDelta!==0)reject("SPECIAL_PRICE_REVENUE_FORBIDDEN");
  if(!Number.isSafeInteger(raw.quantity) || raw.quantity<1 || raw.quantity>100 || !Number.isSafeInteger(raw.actualAmount) || raw.actualAmount<1 || raw.actualAmount>100000000)reject("SPECIAL_PRICE_AMOUNT_INVALID");
  if(typeof raw.reasonCode!=="string" || typeof raw.reasonNote!=="string" && raw.reasonNote!==undefined)reject("SPECIAL_PRICE_REASON_INVALID");
  return {identity,storeName:raw.storeName.trim(),saleId:raw.saleId,packageId:raw.packageId,quantity:raw.quantity,
    actualAmount:raw.actualAmount,reasonCode:raw.reasonCode,reasonNote:raw.reasonNote||"",expectedRevision:0};
}
function specialPriceRequestId(identity,saleId){
  const id=attributionDocumentId(identity,saleId);
  return `price_${crypto.createHash("sha256").update(id).digest("hex").slice(0,48)}`;
}
function buildSpecialPriceRequest(checked,standardUnitPrice){
  let price;
  try{price=pricingException({standardUnitPrice,quantity:checked.quantity,actualAmount:checked.actualAmount,
    reasonCode:checked.reasonCode,reasonNote:checked.reasonNote,approvalPolicy:"REQUIRE_REVIEW"});}
  catch(e){reject(String(e.code||e.message||"SPECIAL_PRICE_AMOUNT_INVALID"));}
  if(price.priceMode!=="EXCEPTION" || price.approvalState!=="PENDING")reject("SPECIAL_PRICE_NOT_AN_EXCEPTION");
  return {schemaVersion:"activity-sales-special-price-request-v1",...checked.identity,
    saleId:checked.saleId,packageId:checked.packageId,quantity:checked.quantity,
    standardUnitPrice,standardTotal:price.standardTotal,actualAmount:price.actualAmount,
    priceDifference:price.priceDifference,reasonCode:price.reasonCode,reasonNote:price.reasonNote,
    approvalState:"PENDING_REVIEW",state:"PENDING_REVIEW",formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
}
module.exports={checkedSpecialPriceRequest,specialPriceRequestId,buildSpecialPriceRequest};
