"use strict";
// Phase 2A-4R2A — bounded, brand/store/date-scoped manager review candidates.
// This does NOT grant reviewer authority; every R1 inspect/review rechecks ownership.
const {assertDate,validIdentity,STATES}=require("./activitySalesAttributionContract");
const {coreStore,invalid,summaryDocumentId}=require("./activitySalesAttributionWriterLogic");
const {normalizedStatus}=require("./activitySalesAttributionReader");
const MAX_CANDIDATES=12;
const CURSOR_SCHEMA="activity-review-cursor-v1";
// Stateless, NON-authorizing cursor. Never trust a cursor for brand, store, or access;
// the next HTTP call revalidates Application Identity, store membership and row scope.
function encodeReviewCursor(scope,lastId){
  if(typeof lastId!=="string"||!/^day_[a-f0-9]{48}$/.test(lastId))invalid("ATTRIBUTION_REVIEW_CURSOR_INVALID",400);
  return Buffer.from(JSON.stringify({schema:CURSOR_SCHEMA,brandId:scope.brandId,
    storeCore:scope.storeCore,reportDate:scope.reportDate,lastId}),"utf8").toString("base64url");
}
function decodeReviewCursor(encoded,scope){
  if(encoded===undefined||encoded===null||encoded==="")return null;
  if(typeof encoded!=="string"||encoded.length>1600||!/^[A-Za-z0-9_-]+$/.test(encoded)) invalid("ATTRIBUTION_REVIEW_CURSOR_INVALID",400);
  try{
    const decoded=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"));
    if(!decoded||decoded.schema!==CURSOR_SCHEMA||decoded.brandId!==scope.brandId||
       decoded.storeCore!==scope.storeCore||decoded.reportDate!==scope.reportDate||
       typeof decoded.lastId!=="string"||!/^day_[a-f0-9]{48}$/.test(decoded.lastId)|| Object.keys(decoded).length!==5)
      invalid("ATTRIBUTION_REVIEW_CURSOR_INVALID",400);
    return decoded.lastId;
  }catch{invalid("ATTRIBUTION_REVIEW_CURSOR_INVALID",400);}
}

function checkedReviewInboxInput(body,now=new Date()){
  if(!body || body.action!=="list_candidates" || body.actor?.roleId!=="store") invalid("ATTRIBUTION_REVIEW_INBOX_ROLE_FORBIDDEN",403);
  const brandId=String(body.brandId||"");
  if(!["cyj","anniu","yibo"].includes(brandId))invalid("ATTRIBUTION_REVIEW_INBOX_BRAND_INVALID",400);
  const storeName=String(body.storeName||"").trim();
  if(!storeName || storeName.length>120 || /[\/\\]/.test(storeName))invalid("ATTRIBUTION_REVIEW_INBOX_STORE_INVALID",400);
  let reportDate;
  try{reportDate=assertDate(body.reportDate);}catch{invalid("ATTRIBUTION_REVIEW_INBOX_DATE_INVALID",400);}
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  if(reportDate>today)invalid("ATTRIBUTION_REVIEW_INBOX_FUTURE_DATE",400);
  if(body.limit!==undefined || body.subject!==undefined)
    invalid("ATTRIBUTION_REVIEW_INBOX_UNSUPPORTED_SCOPE",400);
  const scope={brandId,storeName,storeCore:coreStore(storeName),reportDate};
  return {...scope,afterId:decodeReviewCursor(body.cursor,scope)};
}
function checkedReviewCandidate(doc,scope){
  const row=doc?.data?.()||{};
  let subject;
  try{subject=validIdentity(row);}catch{invalid("ATTRIBUTION_REVIEW_INBOX_DATA_INVALID",409);}
  if(/[\/\\]/.test(subject.accountId) || subject.brandId!==scope.brandId || subject.roleId!=="therapist" ||
      subject.reportDate!==scope.reportDate || row.storeCore!==scope.storeCore ||
      doc.id!==summaryDocumentId(subject)) invalid("ATTRIBUTION_REVIEW_INBOX_DATA_INVALID",409);
  const status=normalizedStatus(doc,subject,scope.storeCore);
  if(![STATES.HAS_SALES,STATES.CONFIRMED_ZERO].includes(status.status))
    invalid("ATTRIBUTION_REVIEW_INBOX_DATA_INVALID",409);
  return {subject,...status};
}
module.exports={MAX_CANDIDATES,checkedReviewInboxInput,checkedReviewCandidate,encodeReviewCursor,decodeReviewCursor};
