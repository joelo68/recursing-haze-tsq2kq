import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('B2C endpoint is current-month, highest-admin/trusted-device protected, and explicit-apply only', () => {
  const source = read('functions/currentStoreMonthReportsBootstrap.js');
  assert.match(source, /requireFirebaseRequestAuth/);
  assert.match(source, /verifySuperAdminActor/);
  assert.match(source, /yearMonth !== currentYearMonth/);
  assert.match(source, /BOOTSTRAP_CURRENT_STORE_MONTH_REPORTS/);
  assert.match(source, /!\['plan', 'apply'\]\.includes\(action\)/);
  assert.match(source, /action === 'plan'/);
  assert.match(source, /String\(body\.confirmation \|\| ''\) !== BOOTSTRAP_CONFIRMATION/);
});

test('B2C apply is race-safe against live projection and multi-admin execution', () => {
  const source = read('functions/currentStoreMonthReportsBootstrap.js');
  assert.match(source, /BOOTSTRAP_RUNNING/);
  assert.match(source, /leaseUntil/);
  assert.match(source, /runId/);
  assert.match(source, /BOOTSTRAP_OCC_LOST/);
  assert.match(source, /existingTimestamp > snapshotCutoff/);
  assert.match(source, /applySourceEventToProjectionData/);
  assert.match(source, /db\.runTransaction/);
});

test('B2C stays bounded and adds no polling/listener/scheduler; later B4 owns frontend cutover', () => {
  const source = read('functions/currentStoreMonthReportsBootstrap.js');
  const client = read('scripts/currentStoreMonthReportsBootstrapClient.mjs');
  const app = read('src/App.jsx');
  assert.match(source, /\.where\('date', '>='/);
  assert.match(source, /\.where\('date', '<='/);
  assert.match(source, /\.where\('yearMonth', '=='/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /onSchedule/);
  assert.doesNotMatch(source, /onSnapshot/);
  assert.doesNotMatch(client, /setInterval\s*\(/);
  // Frontend cutover is a B4 concern; B2C continues to enforce bounded backend/bootstrap behavior.
  assert.match(app, /const CURRENT_APP_VERSION = "3\.6\.0";/);
});

test('B2C status certification is point-in-time and never frontend readiness', () => {
  const source = read('functions/currentStoreMonthReportsBootstrap.js');
  assert.match(source, /consumerReady: false/);
  assert.match(source, /certificationIsPointInTime: true/);
  assert.match(source, /BOOTSTRAP_CERTIFIED/);
  assert.match(source, /PARITY_FAILED/);
});

test('B2C index exports operator endpoint while live projection triggers remain separate', () => {
  const index = read('functions/index.js');
  assert.match(index, /exports\.bootstrapCurrentStoreMonthReports/);
  assert.match(index, /exports\.projectLegacyCurrentStoreMonthReports/);
  assert.match(index, /exports\.projectBrandCurrentStoreMonthReports/);
});
