"use strict";
// Phase 2A-1: single-report, version-bound, non-additive attribution. No revenue writes.
const crypto = require("node:crypto");
const {validIdentity,normalizeAttributionSale,attributionDocumentId,assertDate,STATES} = require("./activitySalesAttributionContract");
const {isCurrentPublication} = require("./activitySalesAcknowledgementLogic");
const {isTherapistInactive} = require("./therapistCredentialAuthority");

const idRe = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
function invalid(code, status=409) {const e=new Error(code);e.code=code;e.status=status;throw e;}
function coreStore(value) {
  const compact=String(value||"").trim().replace(/^(?:CYJ|DRCYJ|Anew\s*\(安妞\)|Yibo\s*\(伊啵\)|Anew|Yibo|安妞|伊啵)\s*/i, "")
    .replace(/[\s　]+/g,"");
  const s=(compact==="新" || /^新店店?$/.test(compact))?"新店":compact.replace(/店$/,"");
  if (!s || s.length>80 || /[\/#$\[\].\u0000-\u001f]/.test(s)) invalid("ATTRIBUTION_STORE_INVALID",400);
  return s;
}
function ownerStore({roleId,accountId,credential,therapistMaster,targetStore}) {
  if (roleId==="therapist") {
    const master=therapistMaster||{};
    if ((master.id && String(master.id)!==accountId) || isTherapistInactive(master)) invalid("ATTRIBUTION_THERAPIST_INACTIVE",403);
    const actual=master.store||master.storeName||master.primaryStore||
      (Array.isArray(master.stores)&&master.stores.length===1?master.stores[0]:"");
    if (!actual || coreStore(actual)!==coreStore(targetStore)) invalid("ATTRIBUTION_STORE_FORBIDDEN",403);
    return coreStore(actual);
  }
  if (roleId!=="store") invalid("ATTRIBUTION_ROLE_FORBIDDEN",403);
  const allowed=credential?.stores;
  if (!Array.isArray(allowed) || !allowed.length || !allowed.some(s=>coreStore(s)===coreStore(targetStore))) invalid("ATTRIBUTION_STORE_FORBIDDEN",403);
  return coreStore(targetStore);
}
function reportKey(identity,storeName) {
  return identity.roleId==="therapist"
    ? `${identity.reportDate}_${identity.accountId}`
    : `${identity.reportDate}_${storeName}`;
}
function assertReport(report,identity,storeCore) {
  if (!report || report.date!==identity.reportDate || report.brandId!==identity.brandId ||
      coreStore(report.storeName)!==storeCore) invalid("ATTRIBUTION_REPORT_MISMATCH",409);
  if (identity.roleId==="therapist" && String(report.therapistId||"")!==identity.accountId) invalid("ATTRIBUTION_REPORT_OWNER_MISMATCH",403);
}
function assertSaleWindow(publication, version, identity, storeCore, packageId) {
  if (!isCurrentPublication(publication,identity) ||
      version?.brandId!==identity.brandId || version?.campaignId!==identity.campaignId ||
      version?.versionId!==identity.versionId || !version?.campaignSnapshot ||
      publication.startDate!==version.campaignSnapshot.startDate || publication.endDate!==version.campaignSnapshot.endDate ||
      identity.reportDate<publication.startDate || identity.reportDate>publication.endDate) invalid("ATTRIBUTION_PUBLICATION_CHANGED",409);
  const draft=version.campaignSnapshot;
  if (draft.storeScope==="selected" && (!Array.isArray(draft.stores) || !draft.stores.some(s=>coreStore(s)===storeCore))) invalid("ATTRIBUTION_STORE_NOT_ELIGIBLE",403);
  if (draft.storeScope!=="all" && draft.storeScope!=="selected") invalid("ATTRIBUTION_SCOPE_INVALID");
  if (packageId===null) return null; // explicit zero: no sale package
  const pkg=draft.packages?.find(p=>p?.packageId===packageId);
  if (!pkg || !Number.isSafeInteger(pkg.salePrice) || pkg.salePrice<=0) invalid("ATTRIBUTION_PACKAGE_INVALID",409);
  return pkg;
}
function localTaipeiDate(now=new Date()) {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
function ensureReportDateAllowed(date,now=new Date()) {
  assertDate(date);
  const today=localTaipeiDate(now);
  if (date>today) invalid("ATTRIBUTION_FUTURE_DATE",400);
  if (date===today) {
    const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",hour:"2-digit",hourCycle:"h23"}).format(now));
    if (hour<15) invalid("ATTRIBUTION_BEFORE_REPORT_WINDOW",409);
  }
  // Phase 2A-1 has no privileged historical override; historical reporting still
  // requires a previously submitted daily report, checked atomically below.
}
function summaryDocumentId(identity) {
  const fields=validIdentity(identity);
  return "day_"+crypto.createHash("sha256").update([fields.brandId,fields.roleId,fields.accountId,fields.reportDate,fields.campaignId,fields.versionId].join("\0")).digest("hex").slice(0,48);
}
function checkedInput(body) {
  if (!body || !["record_sale","confirm_zero"].includes(body.action)) invalid("ATTRIBUTION_ACTION_INVALID",400);
  const identity=validIdentity({brandId:body.brandId,campaignId:body.campaignId,versionId:body.versionId,
    roleId:body.actor?.roleId,accountId:body.actor?.accountId,reportDate:body.reportDate});
  if (/[\/\\]/.test(identity.accountId)) invalid("ATTRIBUTION_ACCOUNT_PATH_INVALID",400);
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision<0) invalid("ATTRIBUTION_REVISION_INVALID",400);
  const storeName=String(body.storeName||"").trim();
  if (!storeName || storeName.length>120 || storeName.includes("/")) invalid("ATTRIBUTION_STORE_INVALID",400);
  const targetStoreCore=coreStore(storeName);
  let sale=null;
  if (body.action==="record_sale") sale=normalizeAttributionSale({...identity,
    saleId:body.saleId,packageId:body.packageId,quantity:body.quantity,
    attributedAmount:body.attributedAmount,formalRevenueDelta:body.formalRevenueDelta});
  else if (body.saleId!==undefined || body.packageId!==undefined || body.attributedAmount!==undefined) invalid("ATTRIBUTION_ZERO_CONFLICT",400);
  return {identity,storeName,targetStoreCore,sale,action:body.action,expectedRevision:body.expectedRevision};
}
module.exports={invalid,coreStore,ownerStore,reportKey,assertReport,assertSaleWindow,ensureReportDateAllowed,summaryDocumentId,checkedInput};
