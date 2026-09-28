import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('B3-2 endpoint is current-month, highest-admin/trusted-device protected, and explicit-apply only', () => {
  const source = read('functions/currentStoreMonthReportsReadiness.js');
  assert.match(source, /requireFirebaseRequestAuth/);
  assert.match(source, /verifySuperAdminActor/);
  assert.match(source, /assertAdminApplicationClaims/);
  assert.match(source, /if \(action === 'apply'\)/);
  assert.match(source, /yearMonth !== currentYearMonth/);
  assert.match(source, /PROMOTE_CURRENT_STORE_MONTH_REPORTS_READY/);
  assert.match(source, /expectedRevision/);
  assert.match(source, /READINESS_REVISION_CONFLICT/);
  assert.match(source, /db\.runTransaction/);
});

test('B3-2 never promotes bootstrap point-in-time parity without a changed live signature', () => {
  const source = read('functions/currentStoreMonthReportsReadiness.js');
  assert.match(source, /WAITING_FOR_LIVE_EVENT/);
  assert.match(source, /currentSourceSignature === certifiedSourceSignature/);
  assert.match(source, /READY_TO_PROMOTE/);
  assert.match(source, /POST_BOOTSTRAP_LIVE_EVENT_EXACT_PARITY/);
});

test('B3-2 promotion persists versioned readiness and immediately re-audits fail-closed', () => {
  const source = read('functions/currentStoreMonthReportsReadiness.js');
  assert.match(source, /consumerReady:\s*true/);
  assert.match(source, /readinessStatus:\s*'CONSUMER_READY'/);
  assert.match(source, /consumerReadySourceSignature/);
  assert.match(source, /consumerReadyProjectionSignature/);
  assert.match(source, /postAudit/);
  assert.match(source, /READINESS_POST_AUDIT_FAILED/);
  assert.match(source, /consumerReady:\s*false/);
});

test('B3-2 adds no listener, polling, scheduler or frontend cutover', () => {
  const source = read('functions/currentStoreMonthReportsReadiness.js');
  const client = read('scripts/currentStoreMonthReportsReadinessClient.mjs');
  const app = read('src/App.jsx');
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /onSchedule/);
  assert.doesNotMatch(source, /onSnapshot/);
  assert.doesNotMatch(client, /setInterval\s*\(/);
  assert.match(client, /checkDeviceAccess/);
  assert.match(client, /signInWithCustomToken/);
  assert.match(client, /applicationIdentityCustomToken/);
  assert.match(client, /idToken:\s*applicationIdToken/);
  assert.doesNotMatch(app, /current_store_month_reports/);
  assert.match(app, /const CURRENT_APP_VERSION = "3\.6\.0";/);
});

test('B3-2 keeps projection/status Browser writes denied and exports only the backend authority', () => {
  const index = read('functions/index.js');
  const rules = read('firestore.rules');
  assert.match(index, /createCurrentStoreMonthReportsReadinessFunctions\(\{[\s\S]*?assertAdminApplicationClaims[\s\S]*?auditBrandProjection/);
  assert.match(index, /exports\.manageCurrentStoreMonthReportsReadiness/);
  assert.match(rules, /current_store_month_reports\/\{document=\*\*\}[\s\S]*?allow write:\s*if false/);
  assert.match(rules, /current_store_month_reports_status\/\{document=\*\*\}[\s\S]*?allow write:\s*if false/);
});
