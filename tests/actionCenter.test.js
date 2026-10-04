import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_CENTER_MAX_ACTIONS,
  buildActionCenterState,
} from '../src/utils/actionCenter.js';

const makeLifecycleEntry = (storeKey, { closedDates = [] } = {}) => ({
  storeKey,
  canonicalStoreName: `${storeKey}店`,
  firstEligibleMonth: '2026-01',
  openDate: '2026-01-01',
  lastEligibleMonth: '',
  closeDate: '',
  exemptMonths: [],
  reportingCalendarClosedDates: closedDates,
});

const makeAuthority = ({ stores = 32, cashMissing = [], accrualMissing = [] } = {}) => {
  const rows = {};
  const eligibleStoreKeys = [];
  for (let i = 1; i <= stores; i += 1) {
    const key = `S${String(i).padStart(2, '0')}`;
    eligibleStoreKeys.push(key);
    rows[key] = {
      storeKey: key,
      canonicalStoreName: `${key}店`,
      lifecycleEntry: makeLifecycleEntry(key),
      lifecycleEligible: true,
      formalScopeEligible: true,
    };
  }
  return {
    compatible: true,
    lifecycleReady: true,
    stores: rows,
    eligibleStoreKeys,
    targetAuthority: {
      coverageConsistent: true,
      cashMissingStoreKeys: cashMissing,
      accrualMissingStoreKeys: accrualMissing,
    },
  };
};

const makeDashboardStats = ({ projection = 950000, target = 1000000, daysPassed = 10, reportingStatus = 'DATA_COMPLETE' } = {}) => ({
  daysPassed,
  grandTotal: {
    projection,
    formalCashTarget: target,
  },
  formalKpiStatus: {
    reportingStatus,
  },
});

const reportFor = (storeKey, date = '2026-10-04') => ({
  storeName: `${storeKey}店`,
  date,
  cash: 0,
});

test('Action Center is current-month only and does not enter historical Dashboard semantics', () => {
  const state = buildActionCenterState({
    selectedYearMonth: '2026-09',
    brandName: 'CYJ',
    now: new Date('2026-10-04T11:00:00Z'),
  });
  assert.equal(state.visible, false);
  assert.equal(state.reason, 'CURRENT_MONTH_ONLY');
  assert.deepEqual(state.actions, []);
});

test('System Excluded own-store self view does not reuse brand Formal Action Center authority', () => {
  const state = buildActionCenterState({
    selectedYearMonth: '2026-10',
    brandName: 'CYJ',
    storeSelfViewActive: true,
    now: new Date('2026-10-04T11:00:00Z'),
  });
  assert.equal(state.visible, false);
  assert.equal(state.reason, 'STORE_SELF_VIEW_EXCLUDED');
});

test('before 18:00 reporting stays neutral and never creates early missing-report alerts', () => {
  const formalAuthority = makeAuthority({ stores: 32 });
  const visibleStoreKeys = formalAuthority.eligibleStoreKeys;
  const reports = visibleStoreKeys.slice(0, 10).map((key) => reportFor(key));
  const state = buildActionCenterState({
    selectedYearMonth: '2026-10',
    brandName: 'CYJ',
    reports,
    formalAuthority,
    visibleStoreKeys,
    dashboardStats: makeDashboardStats({ daysPassed: 3, projection: 400000 }),
    securityActionSummary: { eligible: true, ready: true, pendingCount: 0 },
    now: new Date('2026-10-04T09:00:00Z'), // 17:00 Asia/Taipei
  });

  const reportingChip = state.summary.find((row) => row.key === 'reporting');
  assert.equal(reportingChip.value, '回報進行中');
  assert.equal(state.actions.some((row) => row.kind === 'reporting'), false);
  assert.equal(state.actions.some((row) => row.kind === 'performance'), false);
});

test('after 18:00 many missing CYJ stores become one aggregated management event, not one card per store', () => {
  const formalAuthority = makeAuthority({ stores: 32 });
  const visibleStoreKeys = formalAuthority.eligibleStoreKeys;
  const reports = visibleStoreKeys.slice(0, 20).map((key) => reportFor(key));
  const state = buildActionCenterState({
    selectedYearMonth: '2026-10',
    brandName: 'CYJ',
    reports,
    formalAuthority,
    visibleStoreKeys,
    dashboardStats: makeDashboardStats({ daysPassed: 3 }),
    securityActionSummary: { eligible: true, ready: true, pendingCount: 0 },
    now: new Date('2026-10-04T11:00:00Z'), // 19:00 Asia/Taipei
  });

  const reportingActions = state.actions.filter((row) => row.kind === 'reporting');
  assert.equal(reportingActions.length, 1);
  assert.equal(reportingActions[0].count, 12);
  assert.equal(state.reporting.expectedStoreCount, 32);
  assert.equal(state.reporting.reportedStoreCount, 20);
  assert.equal(state.reporting.missingStoreCount, 12);
  assert.ok(state.actions.length <= ACTION_CENTER_MAX_ACTIONS);
});

test('reporting respects the existing Lifecycle/Reporting Calendar closed-date authority', () => {
  const formalAuthority = makeAuthority({ stores: 2 });
  formalAuthority.stores.S02.lifecycleEntry.reportingCalendarClosedDates = ['2026-10-04'];
  const state = buildActionCenterState({
    selectedYearMonth: '2026-10',
    reports: [reportFor('S01')],
    formalAuthority,
    visibleStoreKeys: ['S01', 'S02'],
    dashboardStats: makeDashboardStats({ daysPassed: 3 }),
    securityActionSummary: { eligible: false, ready: true, pendingCount: 0 },
    now: new Date('2026-10-04T11:00:00Z'),
  });
  assert.equal(state.reporting.expectedStoreCount, 1);
  assert.equal(state.reporting.missingStoreCount, 0);
  assert.equal(state.actions.some((row) => row.kind === 'reporting'), false);
});

test('Action Center never expands an empty visible scope into the whole brand', () => {
  const formalAuthority = makeAuthority({ stores: 32, cashMissing: ['S01', 'S02'] });
  const state = buildActionCenterState({
    selectedYearMonth: '2026-10',
    reports: [],
    formalAuthority,
    visibleStoreKeys: [],
    dashboardStats: makeDashboardStats({ daysPassed: 3 }),
    securityActionSummary: { eligible: false, ready: true, pendingCount: 0 },
    now: new Date('2026-10-04T11:00:00Z'),
  });
  assert.equal(state.scopeStoreCount, 0);
  assert.equal(state.reporting.expectedStoreCount, 0);
  assert.equal(state.actions.some((row) => row.kind === 'target'), false);
});

test('target incompleteness is one scoped event and only uses consistent target authority', () => {
  const formalAuthority = makeAuthority({ stores: 4, cashMissing: ['S02'], accrualMissing: ['S03'] });
  const reports = formalAuthority.eligibleStoreKeys.map((key) => reportFor(key, '2026-10-10'));
  const state = buildActionCenterState({
    selectedYearMonth: '2026-10',
    reports,
    formalAuthority,
    visibleStoreKeys: ['S01', 'S02', 'S03'],
    dashboardStats: makeDashboardStats({ daysPassed: 9, projection: 950000 }),
    securityActionSummary: { eligible: false, ready: true, pendingCount: 0 },
    now: new Date('2026-10-10T11:00:00Z'),
  });
  const targetActions = state.actions.filter((row) => row.kind === 'target');
  assert.equal(targetActions.length, 1);
  assert.equal(targetActions[0].count, 2);

  formalAuthority.targetAuthority.coverageConsistent = false;
  const stale = buildActionCenterState({
    selectedYearMonth: '2026-10',
    reports,
    formalAuthority,
    visibleStoreKeys: ['S01', 'S02', 'S03'],
    dashboardStats: makeDashboardStats({ daysPassed: 9, projection: 950000 }),
    now: new Date('2026-10-10T11:00:00Z'),
  });
  assert.equal(stale.actions.some((row) => row.kind === 'target'), false);
  assert.equal(stale.summary.find((row) => row.key === 'target').value, '資料整理中');
});

test('performance alert is suppressed in early month and only promotes a complete scope-level Projection later', () => {
  const formalAuthority = makeAuthority({ stores: 4 });
  const visibleStoreKeys = formalAuthority.eligibleStoreKeys;
  const earlyReports = visibleStoreKeys.map((key) => reportFor(key, '2026-10-04'));
  const early = buildActionCenterState({
    selectedYearMonth: '2026-10',
    reports: earlyReports,
    formalAuthority,
    visibleStoreKeys,
    dashboardStats: makeDashboardStats({ daysPassed: 3, projection: 700000, target: 1000000 }),
    now: new Date('2026-10-04T11:00:00Z'),
  });
  assert.equal(early.actions.some((row) => row.kind === 'performance'), false);
  assert.equal(early.summary.find((row) => row.key === 'performance').value, '月初觀察期');

  const laterReports = visibleStoreKeys.map((key) => reportFor(key, '2026-10-10'));
  const later = buildActionCenterState({
    selectedYearMonth: '2026-10',
    reports: laterReports,
    formalAuthority,
    visibleStoreKeys,
    dashboardStats: makeDashboardStats({ daysPassed: 9, projection: 800000, target: 1000000 }),
    storeRankings: [
      { storeName: 'S04店', isBottomSegment: true, dashboardLiveRankEligible: true },
    ],
    now: new Date('2026-10-10T11:00:00Z'),
  });
  const performance = later.actions.find((row) => row.kind === 'performance');
  assert.ok(performance);
  assert.equal(Math.round(performance.projectedAchievement), 80);
  assert.equal(performance.storeName, 'S04店');
});

test('performance alert does not fire while today reporting is incomplete or Formal reporting is incomplete', () => {
  const formalAuthority = makeAuthority({ stores: 3 });
  const visibleStoreKeys = formalAuthority.eligibleStoreKeys;
  const partial = buildActionCenterState({
    selectedYearMonth: '2026-10',
    reports: [reportFor('S01', '2026-10-10')],
    formalAuthority,
    visibleStoreKeys,
    dashboardStats: makeDashboardStats({ daysPassed: 9, projection: 800000, target: 1000000 }),
    now: new Date('2026-10-10T11:00:00Z'),
  });
  assert.equal(partial.actions.some((row) => row.kind === 'performance'), false);

  const allReports = visibleStoreKeys.map((key) => reportFor(key, '2026-10-10'));
  const formalIncomplete = buildActionCenterState({
    selectedYearMonth: '2026-10',
    reports: allReports,
    formalAuthority,
    visibleStoreKeys,
    dashboardStats: makeDashboardStats({ daysPassed: 9, projection: 800000, target: 1000000, reportingStatus: 'DATA_INCOMPLETE' }),
    now: new Date('2026-10-10T11:00:00Z'),
  });
  assert.equal(formalIncomplete.actions.some((row) => row.kind === 'performance'), false);
});

test('security action uses only the existing highest-manager assistance summary', () => {
  const formalAuthority = makeAuthority({ stores: 1 });
  const state = buildActionCenterState({
    selectedYearMonth: '2026-10',
    reports: [reportFor('S01')],
    formalAuthority,
    visibleStoreKeys: ['S01'],
    dashboardStats: makeDashboardStats({ daysPassed: 3 }),
    securityActionSummary: { eligible: true, ready: true, pendingCount: 2 },
    now: new Date('2026-10-04T11:00:00Z'),
  });
  const security = state.actions.find((row) => row.kind === 'security');
  assert.ok(security);
  assert.equal(security.count, 2);
  assert.equal(security.priority, 100);
});
