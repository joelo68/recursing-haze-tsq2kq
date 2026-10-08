// Phase 2A-3: pure client input contract; Backend remains the sole authority.
// These values are classifications of existing formal daily revenue, never additions.
const SALE_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_TOTAL=100000000;
export const ATTRIBUTION_ENTRY_STATES=Object.freeze({
  UNCONFIRMED:"UNCONFIRMED",CONFIRMED_ZERO:"CONFIRMED_ZERO",HAS_SALES:"HAS_SALES",
});
export function allowedAttributionActions(status){
  return {recordSale:status==="UNCONFIRMED"||status==="HAS_SALES",
    confirmZero:status==="UNCONFIRMED"};
}
export function buildAttributionEntry({publication,status,revision,action,packageId,quantity,saleId}){
  if(!publication||publication.status!=="published"||!publication.campaignId||!publication.versionId)
    throw new Error("ATTRIBUTION_PUBLICATION_INVALID");
  if(!Number.isSafeInteger(revision)||revision<0) throw new Error("ATTRIBUTION_REVISION_INVALID");
  if(status==="UNCONFIRMED"&&revision!==0)throw new Error("ATTRIBUTION_STATE_REVISION_INVALID");
  if(status!=="UNCONFIRMED"&&status!=="CONFIRMED_ZERO"&&status!=="HAS_SALES")
    throw new Error("ATTRIBUTION_STATE_INVALID");
  const allowed=allowedAttributionActions(status);
  if(action==="confirm_zero"){
    if(!allowed.confirmZero)throw new Error("ATTRIBUTION_ZERO_LOCKED");
    return {action,expectedRevision:revision,formalRevenueDelta:0};
  }
  if(action!=="record_sale"||!allowed.recordSale)throw new Error("ATTRIBUTION_ACTION_FORBIDDEN");
  if(!SALE_ID.test(String(saleId||"")))throw new Error("ATTRIBUTION_SALE_ID_INVALID");
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>99)
    throw new Error("ATTRIBUTION_QUANTITY_INVALID");
  const pkg=publication.packages?.find(p=>p?.packageId===packageId);
  if(!pkg||!Number.isSafeInteger(pkg.salePrice)||pkg.salePrice<=0)
    throw new Error("ATTRIBUTION_PACKAGE_INVALID");
  const attributedAmount=pkg.salePrice*quantity;
  if(!Number.isSafeInteger(attributedAmount)||attributedAmount>MAX_TOTAL)
    throw new Error("ATTRIBUTION_TOTAL_INVALID");
  return {action,expectedRevision:revision,saleId,packageId,quantity,attributedAmount,formalRevenueDelta:0};
}
// A successful writer response must match the requested immutable activity identity.
// Idempotent outcomes have no amount/count; a fresh authenticated status read is required.
export function checkedAttributionWriteResponse(data,publication,reportDate){
  if(data?.ok!==true||data.campaignId!==publication?.campaignId||
    data.versionId!==publication?.versionId||data.reportDate!==reportDate||
    !Number.isSafeInteger(data.revision)||data.revision<1)throw new Error("ATTRIBUTION_WRITE_RESPONSE_INVALID");
  if(data.state==="idempotent")return {needsRefresh:true};
  if(data.state!=="written"||data.formalRevenueDelta!==0||
    !["CONFIRMED_ZERO","HAS_SALES"].includes(data.status)||
    !Number.isSafeInteger(data.saleCount)||data.saleCount<0||
    !Number.isSafeInteger(data.attributedAmount)||data.attributedAmount<0||
    (data.status==="CONFIRMED_ZERO"&&(data.saleCount!==0||data.attributedAmount!==0))||
    (data.status==="HAS_SALES"&&(data.saleCount<1||data.attributedAmount<1)))
    throw new Error("ATTRIBUTION_WRITE_RESPONSE_INVALID");
  return {needsRefresh:false,status:data.status,revision:data.revision,
    saleCount:data.saleCount,attributedAmount:data.attributedAmount,formalRevenueDelta:0};
}
