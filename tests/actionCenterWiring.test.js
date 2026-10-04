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

test('Action Center sits between DashboardHeader and store performance without touching therapist mode', () => {
  const headerIndex = dashboard.indexOf('<DashboardHeader');
  const actionIndex = dashboard.indexOf('<ActionCenter');
  const storeIndex = dashboard.indexOf('{isStoreViewActive && (');
  const storePerformanceIndex = dashboard.indexOf('<StorePerformanceView');
  const therapistIndex = dashboard.indexOf('{isTherapistViewActive && (');

  assert.ok(headerIndex >= 0);
  assert.ok(actionIndex > headerIndex);
  assert.ok(storePerformanceIndex > actionIndex);
  assert.ok(therapistIndex > storePerformanceIndex);
  assert.match(dashboard, /isStoreViewActive && actionCenterState\?\.visible/);
  assert.doesNotMatch(dashboard, /isTherapistViewActive[\s\S]{0,200}<ActionCenter/);
});

test('Action Center reuses existing App security summary and navigation seams', () => {
  assert.match(app, /deviceApprovalActionSummary/);
  assert.match(app, /adminAssistancePendingCount/);
  assert.match(app, /const openDailyAudit = useCallback/);
  assert.match(app, /setAuditType\("daily"\)/);
  assert.match(app, /handleProtectedSetActiveView\("audit"\)/);
  assert.match(dashboard, /onOpenAudit=\{openDailyAudit\}/);
  assert.match(dashboard, /onOpenSecurity=\{openDeviceApprovalPanel\}/);
  assert.match(dashboard, /onOpenStore=\{navigateToStore\}/);
});

test('Action Center logic is pure and adds no Firestore read/listener/query primitive', () => {
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

test('Dashboard hook adds only a Taipei boundary timeout, not polling or a new Firestore primitive', () => {
  assert.match(dashboardHook, /getMillisecondsUntilNextTaipeiActionBoundary/);
  assert.match(dashboardHook, /window\.setTimeout/);
  assert.match(dashboardHook, /不新增 polling，也不觸發 Firestore read/);

  const actionImports = dashboardHook.match(/import \{ buildActionCenterState \} from '\.\.\/utils\/actionCenter\.js';/g) || [];
  assert.equal(actionImports.length, 1);
});

test('AuditView consumes the shared cutoff policy and no longer owns or references duplicate cutoff primitives', () => {
  assert.match(auditView, /from "\.\.\/utils\/dailyAuditPolicy\.js"/);
  assert.match(auditView, /getDailyAuditPolicy/);
  assert.match(auditView, /const policy = getDailyAuditPolicy\(\);/);
  assert.match(auditView, /const todayDate = policy\.todayDate;/);
  assert.match(auditView, /const isBeforeCutoff = policy\.cutoffReached !== true;/);
  assert.doesNotMatch(auditView, /const TAIPEI_TIME_ZONE =/);
  assert.doesNotMatch(auditView, /\bDAILY_AUDIT_CUTOFF_HOUR\b/);
  assert.doesNotMatch(auditView, /\bgetTaipeiDateTimeParts\s*\(/);
  assert.doesNotMatch(auditView, /\bformatCalendarDate\s*\(/);
  assert.doesNotMatch(auditView, /const getMillisecondsUntilNextTaipeiCutoff =/);
});

test('Action Center v1 keeps technical authority language out of its user-facing component', () => {
  for (const stale of ['Summary', 'Lifecycle', 'Firestore', 'revision', 'raw collection']) {
    assert.equal(actionCenter.includes(stale), false, `ActionCenter UI still exposes technical term: ${stale}`);
  }
  assert.match(actionCenter, /今日行動中心/);
  assert.match(actionCenter, /今天沒有需要立即處理的事項/);
});
