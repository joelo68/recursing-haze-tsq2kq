"use strict";
// L3B2B3: pure, brand-private grant/revoke authority contract. No posting token.
const {AUTH_SCHEMA,parseSignoffAuthority}=require("./activitySalesSpecialPricePolicySignoffContract");
const BRANDS=new Set(["cyj","anniu","yibo"]);
const STAGES=["BUSINESS","FINANCE"];
const AUTH_KEYS=["schemaVersion","brandId","revision","enabled","reviewers"];
const ROLES=new Set(["director","manager","trainer","store","therapist"]);
const ACCOUNT=/^[A-Za-z0-9_\u3400-\u9fff][A-Za-z0-9_\-\u3400-\u9fff]{0,159}$/;
function reject(code,status=409){const error=new Error(code);error.code=code;error.status=status;throw error;}
function plain(x){return x!==null&&typeof x==="object"&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);}
function exact(x,fields){return plain(x)&&Object.keys(x).length===fields.length&&fields.every(k=>Object.prototype.hasOwnProperty.call(x,k));}
function validateReviewer(roleId,accountId){
  if(!ROLES.has(roleId)||typeof accountId!=="string"||!ACCOUNT.test(accountId))reject("SIGNOFF_AUTHORITY_REVIEWER_INVALID",400);
  return {roleId,accountId};
}
function inspectStored(raw,brandId){
  if(!exact(raw,AUTH_KEYS)||raw.schemaVersion!==AUTH_SCHEMA||raw.brandId!==brandId||
    !Number.isSafeInteger(raw.revision)||raw.revision<1||raw.enabled!==true&&raw.enabled!==false||
    !exact(raw.reviewers,STAGES))reject("SIGNOFF_AUTHORITY_STORED_CORRUPT");
  if(raw.enabled===true){parseSignoffAuthority(raw,brandId);return raw;}
  if(STAGES.some(stage=>!Array.isArray(raw.reviewers[stage])||raw.reviewers[stage].length!==0))
    reject("SIGNOFF_AUTHORITY_DISABLED_CORRUPT");
  return raw;
}
function checkedAuthorityBody(body){
  const get=body?.action==="get_special_price_signoff_authority";
  const set=body?.action==="set_special_price_signoff_authority";
  const disable=body?.action==="disable_special_price_signoff_authority";
  const keys=get?["action","brandId","actor"]:
    set?["action","brandId","expectedRevision","reviewers","actor"]:
    disable?["action","brandId","expectedRevision","actor"]:null;
  if(!keys||!exact(body,keys)||!BRANDS.has(body.brandId)||
    (!get&&(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0))||
    !plain(body.actor)||Object.keys(body.actor).some(k=>!["roleId","accountId","deviceId","credentialPassword"].includes(k))||
    body.actor.roleId!=="director" || typeof body.actor.accountId!=="string"||!ACCOUNT.test(body.actor.accountId)||
    typeof body.actor.deviceId!=="string"||!body.actor.deviceId||body.actor.deviceId.length>160||
    typeof body.actor.credentialPassword!=="string"||!body.actor.credentialPassword)
    reject("SIGNOFF_AUTHORITY_INPUT_INVALID",400);
  if(set && (!exact(body.reviewers,STAGES)||STAGES.some(stage=>
    !Array.isArray(body.reviewers[stage])||body.reviewers[stage].length<1||body.reviewers[stage].length>15||
    body.reviewers[stage].some(r=>!exact(r,["roleId","accountId"])))))
    reject("SIGNOFF_AUTHORITY_REVIEWERS_INVALID",400);
  return {get,set,body};
}
function buildNextAuthority({brandId,expectedRevision,stored=null,enabled,reviewers}={}){
  if(!BRANDS.has(brandId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
    reject("SIGNOFF_AUTHORITY_INPUT_INVALID",400);
  const current=stored===null?null:inspectStored(stored,brandId);
  const revision=current?.revision??0;
  if(revision!==expectedRevision)reject("SIGNOFF_AUTHORITY_REVISION_CONFLICT");
  if(revision>=Number.MAX_SAFE_INTEGER)reject("SIGNOFF_AUTHORITY_REVISION_OVERFLOW");
  if(enabled!==true&&enabled!==false)reject("SIGNOFF_AUTHORITY_STATE_INVALID",400);
  let nextReviewers;
  if(enabled){
    // parseSignoffAuthority enforces nonempty stage lists, valid identities and no
    // duplicated account across stages. Its hash is exactly what signoff Writer uses.
    const candidate={schemaVersion:AUTH_SCHEMA,brandId,revision:revision+1,enabled:true,reviewers};
    const plan=parseSignoffAuthority(candidate,brandId);
    nextReviewers=plan.reviewers;
  } else {
    if(reviewers!==undefined)reject("SIGNOFF_AUTHORITY_DISABLED_FIELDS_INVALID",400);
    nextReviewers={BUSINESS:[],FINANCE:[]};
  }
  const next={schemaVersion:AUTH_SCHEMA,brandId,revision:revision+1,enabled,reviewers:nextReviewers};
  if(current && current.enabled===enabled && JSON.stringify(current.reviewers)===JSON.stringify(nextReviewers))
    reject("SIGNOFF_AUTHORITY_UNCHANGED");
  return Object.freeze({next:Object.freeze(next),previousRevision:revision,
    authorityHash:enabled?parseSignoffAuthority(next,brandId).authorityHash:null,
    postingAllowed:false,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"});
}
module.exports={checkedAuthorityBody,buildNextAuthority,inspectStored,validateReviewer};
