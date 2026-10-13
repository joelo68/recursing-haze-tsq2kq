'use strict';
// L3B2B4C: pre-authorization REVIEW ONLY. Never a credential, approval or live-read grant.
const {checkScope,MAX_ESTIMATED_READS}=require('./activitySalesL3B2B4ControlledRead.js');
const REQUEST_SCHEMA='activity-sales-l3b2b4c-review-request-v1';
const GATES=Object.freeze([
 'APPROVED_BRAND_AND_ACCOUNT_SCOPE_NOT_ATTESTED',
 'PRODUCTION_PROJECT_AND_DEPLOYED_SOURCE_NOT_ATTESTED',
 'RUNTIME_PRINCIPAL_IDENTITY_NOT_ATTESTED',
 'LEAST_PRIVILEGE_IAM_AND_READ_ONLY_SCOPE_NOT_VERIFIED',
 'INDEPENDENT_APPROVER_SIGNATURE_AND_EXPIRY_NOT_VERIFIED',
 'NON_ATOMIC_SNAPSHOT_AND_LEGACY_ALIAS_POLICY_UNRESOLVED',
 'NINE_FINANCIAL_POLICIES_NOT_APPROVED'
]);
function fail(){const e=Error('L3B2B4C_PREFLIGHT_INVALID');e.code='L3B2B4C_PREFLIGHT_INVALID';throw e;}
function plain(x){return !!x&&typeof x==='object'&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);}
function matches(x,regex,max){return typeof x==='string'&&x.length<=max&&regex.test(x);}
function reviewPreflight(scopeInput,request){
 // Check the source scope using the existing L3B2B4B exact-path schema.
 // Exceptions contain constant error codes; no raw path or account ID.
 let scope;try{scope=checkScope(scopeInput);}catch{fail();}
 if(!plain(request)||Object.keys(request).sort().join('|')!==['declaredPrincipal','intent','projectId','readBudget','schemaVersion'].sort().join('|')||
 request.schemaVersion!==REQUEST_SCHEMA||request.intent!=='REVIEW_ONLY_NOT_AUTHORIZATION'||
 !matches(request.projectId,/^[a-z][a-z0-9-]{4,49}$/,50)||
 !(request.declaredPrincipal==='UNVERIFIED'||matches(request.declaredPrincipal,/^[^\s@]{1,80}@[^\s@]{1,120}$/,201))||
 !Number.isInteger(request.readBudget)||request.readBudget<scope.profileCount||request.readBudget>MAX_ESTIMATED_READS)fail();
 return Object.freeze({
  schemaVersion:'activity-sales-l3b2b4c-preflight-report-v1',
  status:'HOLD_AUTHORIZATION_NOT_ATTESTED',
  financialStatus:'HOLD_NO_POSTING',
  executionMode:'OFFLINE_REVIEW_ONLY',
  collectionPermitted:false,
  requestedBrands:{cyj:scope.byBrand.cyj,anniu:scope.byBrand.anniu,yibo:scope.byBrand.yibo},
  requestedProfiles:scope.profileCount,
  requestedReadBudget:request.readBudget,
  conservativeReadCeiling:scope.estimatedReadCeiling,
  readsPerformed:0,
  claimState:{projectId:'SELF_DECLARED_NOT_VERIFIED',principal:'SELF_DECLARED_NOT_VERIFIED',scope:'OPERATOR_SUPPLIED_NOT_ATTESTED'},
  requiredGates:[...GATES],
  // No identifying source data, authorization token, fingerprint, deviceId, accountId or principal.
  permissions:{canReadProduction:false,canGrantAuthority:false,canDeploy:false,canSettle:false,canPost:false}
 });
}
module.exports={REQUEST_SCHEMA,GATES,reviewPreflight};
