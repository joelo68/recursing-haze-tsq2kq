'use strict';
// Offline, fail-closed release blocker inventory. Not a production authorization service.
const { GATES: AUTHORIZATION_GATES } = require('./activitySalesL3B2B4CPreflight.js');
const { REQUIRED_POLICY_CODES } = (() => {
  const codes = [
    'ACTIVITY_RECOGNITION_DATE','ACTIVITY_AMOUNT_BASIS','ACTIVITY_QUANTITY_BASIS',
    'ACTIVITY_ASP_FORMULA','DAILY_REPORT_RECONCILIATION','CROSS_MONTH_ATTRIBUTION',
    'CLOSED_PERIOD_TREATMENT','REJECTED_REOPEN_FLOW','DAY_LOCK_TERMINAL_RELEASE'
  ];
  return { REQUIRED_POLICY_CODES: Object.freeze(codes) };
})();
const OTHER_BLOCKERS=Object.freeze([
 'PRODUCTION_RELEASE_IDENTITY_AND_TARGET_NOT_VERIFIED',
 'LEGACY_TRUST_AND_FINGERPRINT_ALIAS_DECISION_PENDING',
 'SIGNOFF_ROLE_ROSTER_AND_ADMIN_ENTRY_NOT_APPROVED',
 'SETTLEMENT_WRITER_AND_DOUBLE_POSTING_PREVENTION_NOT_IMPLEMENTED',
 'PHASE3_ACTIVITY_ANALYTICS_AND_FORMAL_KPI_RECONCILIATION_NOT_VALIDATED',
 'THREE_BRAND_SECURITY_RULES_RACE_REGRESSION_AND_UAT_NOT_SIGNED_OFF'
]);
function buildReleaseGate(){
 return {
  schemaVersion:'activity-sales-l3b2b4d-release-gate-v1',
  status:'HOLD_NOT_RELEASE_AUTHORIZED',
  branch:'feature/activity-sales-center',
  sourceRef:'641b84a9df26645ab8c62a6ac3f8d61cde58284e',
  stage:'PHASE_2A_ISOLATED_CANDIDATE',
  productionReadsPerformed:0,
  authorization:{status:'HOLD_AUTHORIZATION_NOT_ATTESTED',blockers:[...AUTHORIZATION_GATES]},
  finance:{status:'HOLD_POLICY_NOT_SIGNED_OFF',requiredPolicyCodes:[...REQUIRED_POLICY_CODES],approvedCount:0},
  otherBlockers:[...OTHER_BLOCKERS],
  permissions:{canReadProduction:false,canGrantSignoffAuthority:false,canSettle:false,canPost:false,canMergeMain:false,canDeploy:false,canClaimProductionConfirmed:false},
  documentation:'This offline inventory is not evidence of IAM verification, business approval, real UAT, or deployment.'
 };
}
module.exports={buildReleaseGate,REQUIRED_POLICY_CODES,OTHER_BLOCKERS};
