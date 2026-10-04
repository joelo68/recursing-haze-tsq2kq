import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const app = read('src/App.jsx');
const dashboard = read('src/components/DashboardView.jsx');
const actionCenter = read('src/components/ActionCenter.jsx');
const actionCenterLogic = read('src/utils/actionCenter.js');
const dailyAuditPolicy = read('src/utils/dailyAuditPolicy.js');
const auditView = read('src/components/AuditView.jsx');
const dashboardHook = read('src/hooks/useDashboardStats.js');

test('Dashboard no longer mounts Action Center or consumes Action Center navigation seams', () => {
  assert.doesNotMatch(dashboard, /import ActionCenter from/);
  assert.doesNotMatch(dashboard, /<ActionCenter/);
  assert.doesNotMatch(dashboard, /actionCenterState/);
  assert.doesNotMatch(dashboard, /onOpenAudit=\{openDailyAudit\}/);
  assert.doesNotMatch(dashboard, /onOpenSecurity=\{openDeviceApprovalPanel\}/);
  assert.doesNotMatch(dashboard, /onOpenStore=\{navigateToStore\}/);

  const headerIndex = dashboard.indexOf('<DashboardHeader');
  const storePerformanceIndex = dashboard.indexOf('<StorePerformanceView');
  const therapistIndex = dashboard.indexOf('{isTherapistViewActive && (');

  assert.ok(headerIndex >= 0);
  assert.ok(storePerformanceIndex > headerIndex);
  assert.ok(therapistIndex > storePerformanceIndex);
});

test('Dashboard hook no longer computes Action Center state or schedules Action Center clock work', () => {
  assert.doesNotMatch(dashboardHook, /buildActionCenterState/);
  assert.doesNotMatch(dashboardHook, /getMillisecondsUntilNextTaipeiActionBoundary/);
  assert.doesNotMatch(dashboardHook, /actionCenterClockRevision/);
  assert.doesNotMatch(dashboardHook, /actionCenterState/);
  assert.doesNotMatch(dashboardHook, /deviceApprovalActionSummary/);
});

test('Retired Action Center modules remain isolated and add no Firestore I/O if revisited later', () => {
  for (const [name, source] of [
    ['ActionCenter.jsx', actionCenter],
    ['actionCenter.js', actionCenterLogic],
    ['dailyAuditPolicy.js', dailyAuditPolicy],
  ]) {
    assert.doesNotMatch(source, /firebase|firestore/i, `${name} should not import Firebase/Firestore`);
    assert.doesNotMatch(source, /\bonSnapshot\b|\bgetDoc\b|\bgetDocs\b|\bcollection\s*\(|\bquery\s*\(/, `${name} added I/O`);
    assert.doesNotMatch(source, /\bsetInterval\s*\(/, `${name} added polling`);
  }
});

test('Existing App security and audit capabilities remain available outside Dashboard Action Center', () => {
  assert.match(app, /deviceApprovalActionSummary/);
  assert.match(app, /adminAssistancePendingCount/);
  assert.match(app, /const openDailyAudit = useCallback/);
  assert.match(app, /setAuditType\("daily"\)/);
  assert.match(app, /handleProtectedSetActiveView\("audit"\)/);
});

test('AuditView continues consuming the shared cutoff policy after Action Center retirement', () => {
  assert.match(auditView, /from "\.\.\/utils\/dailyAuditPolicy\.js"/);
  assert.match(auditView, /getDailyAuditPolicy/);
  assert.match(auditView, /const policy = getDailyAuditPolicy\(\);/);
  assert.match(auditView, /const todayDate = policy\.todayDate;/);
  assert.match(auditView, /const isBeforeCutoff = policy\.cutoffReached !== true;/);
  assert.doesNotMatch(auditView, /const TAIPEI_TIME_ZONE =/);
  assert.doesNotMatch(auditView, /\bDAILY_AUDIT_CUTOFF_HOUR\b/);
  assert.doesNotMatch(auditView, /\bgetTaipeiDateTimeParts\s*\(/);
  assert.doesNotMatch(auditView, /\bformatCalendarDate\s*\(/);
});

test('Inactive Action Center UI keeps technical authority language out of presentation code', () => {
  for (const stale of ['Summary', 'Lifecycle', 'Firestore', 'revision', 'raw collection']) {
    assert.equal(actionCenter.includes(stale), false, `ActionCenter UI still exposes technical term: ${stale}`);
  }
});
