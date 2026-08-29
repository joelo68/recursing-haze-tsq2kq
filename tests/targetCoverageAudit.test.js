import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const audit = require('../functions/targetCoverageAudit.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const auditSource = read('functions/targetCoverageAudit.js');
const functionsIndex = read('functions/index.js');
const maintenanceSource = read('src/components/SystemMaintenance.jsx');

function readyLifecycle(brandId = 'cyj') {
  return {
    brandId,
    datasetStatus: 'READY',
    revision: 10,
    stores: {
      A: { firstEligibleMonth: '2026-01', openDate: '2024-01-01' },
      B: { firstEligibleMonth: '2026-01', openDate: '2024-01-01' },
    },
  };
}

function legacySummary(overrides = {}) {
  return {
    brandId: 'cyj',
    yearMonth: '2026-06',
    storeCount: 2,
    targetCount: 2,
    sourceDocCount: 2,
    cashTargetTotal: 300,
    accrualTargetTotal: 500,
    targets: {
      'CYJA店': { storeName: 'CYJA店', cashTarget: 100, accrualTarget: 200, sourceDocId: 'CYJA店_2026_6' },
      'CYJB店': { storeName: 'CYJB店', cashTarget: 200, accrualTarget: 300, sourceDocId: 'CYJB店_2026_6' },
    },
    ...overrides,
  };
}

test('read-only audit marks internally consistent legacy Summary as metadata-only backfill safe', () => {
  const row = audit.buildHistoricalTargetCoverageAuditRow({
    brandId: 'cyj',
    yearMonth: '2026-06',
    summaryData: legacySummary(),
    lifecycleMaster: readyLifecycle('cyj'),
  });

  assert.equal(row.classification, audit.TARGET_COVERAGE_AUDIT_CLASSIFICATION.SUMMARY_BACKFILL_SAFE);
  assert.equal(row.migrationWriteAllowed, true);
  assert.equal(row.summaryTargetRowCount, 2);
  assert.equal(row.consistency.allMatched, true);
  assert.equal(row.previewCoverage.eligibleStoreCount, 2);
  assert.equal(row.previewCoverage.cashCoverageComplete, true);
  assert.equal(row.previewCoverage.accrualCoverageComplete, true);
});

test('existing Target Coverage v1 is classified as already migrated and is not a write candidate', () => {
  const row = audit.buildHistoricalTargetCoverageAuditRow({
    brandId: 'cyj',
    yearMonth: '2026-06',
    summaryData: legacySummary({ targetCoverageVersion: 'target-coverage-v1', kpiContractVersion: 'kpi-contract-v1' }),
    lifecycleMaster: readyLifecycle('cyj'),
  });

  assert.equal(row.classification, audit.TARGET_COVERAGE_AUDIT_CLASSIFICATION.ALREADY_V1);
  assert.equal(row.migrationWriteAllowed, false);
  assert.ok(row.reasonCodes.includes('TARGET_COVERAGE_V1_PRESENT'));
});

test('audit scopes historical months by Taipei calendar month', () => {
  const aug29Taipei = Date.UTC(2026, 7, 29, 8, 0, 0);
  assert.equal(audit.getTaipeiCurrentYearMonth(aug29Taipei), '2026-08');
});

test('Yibo pre-system months are skipped before any migration eligibility decision', () => {
  for (const yearMonth of ['2026-01', '2026-02', '2026-03']) {
    const row = audit.buildHistoricalTargetCoverageAuditRow({
      brandId: 'yibo',
      yearMonth,
      summaryData: {},
      lifecycleMaster: readyLifecycle('yibo'),
    });
    assert.equal(row.classification, audit.TARGET_COVERAGE_AUDIT_CLASSIFICATION.PRE_SYSTEM_SKIP);
    assert.equal(row.migrationWriteAllowed, false);
    assert.deepEqual(row.reasonCodes, ['YIBO_PRE_SYSTEM_MONTH']);
  }

  assert.equal(audit.isPreSystemTargetCoverageMonth('yibo', '2026-04'), false);
});

test('missing embedded target map fails closed and requires Raw reconstruction', () => {
  const row = audit.buildHistoricalTargetCoverageAuditRow({
    brandId: 'cyj',
    yearMonth: '2026-06',
    summaryData: {
      yearMonth: '2026-06',
      storeCount: 2,
      targetCount: 2,
      cashTargetTotal: 300,
      accrualTargetTotal: 500,
    },
    lifecycleMaster: readyLifecycle('cyj'),
  });

  assert.equal(row.classification, audit.TARGET_COVERAGE_AUDIT_CLASSIFICATION.RAW_RECONSTRUCTION_REQUIRED);
  assert.equal(row.migrationWriteAllowed, false);
  assert.ok(row.reasonCodes.includes('SUMMARY_TARGET_MAP_EMPTY'));
  assert.ok(row.reasonCodes.includes('STORE_COUNT_MISMATCH'));
});

test('legacy totals mismatch fails closed even when a target map exists', () => {
  const row = audit.buildHistoricalTargetCoverageAuditRow({
    brandId: 'cyj',
    yearMonth: '2026-06',
    summaryData: legacySummary({ cashTargetTotal: 999 }),
    lifecycleMaster: readyLifecycle('cyj'),
  });

  assert.equal(row.classification, audit.TARGET_COVERAGE_AUDIT_CLASSIFICATION.RAW_RECONSTRUCTION_REQUIRED);
  assert.equal(row.migrationWriteAllowed, false);
  assert.ok(row.reasonCodes.includes('CASH_TARGET_TOTAL_MISMATCH'));
});

test('missing one metric target remains a safe Summary backfill candidate while preview coverage stays independently incomplete', () => {
  const row = audit.buildHistoricalTargetCoverageAuditRow({
    brandId: 'cyj',
    yearMonth: '2026-06',
    summaryData: legacySummary({
      accrualTargetTotal: 200,
      targets: {
        'CYJA店': { storeName: 'CYJA店', cashTarget: 100, accrualTarget: 200, sourceDocId: 'CYJA店_2026_6' },
        'CYJB店': { storeName: 'CYJB店', cashTarget: 200, accrualTarget: null, sourceDocId: 'CYJB店_2026_6' },
      },
    }),
    lifecycleMaster: readyLifecycle('cyj'),
  });

  assert.equal(row.classification, audit.TARGET_COVERAGE_AUDIT_CLASSIFICATION.SUMMARY_BACKFILL_SAFE);
  assert.equal(row.previewCoverage.cashCoverageComplete, true);
  assert.equal(row.previewCoverage.accrualCoverageComplete, false);
  assert.deepEqual(row.previewCoverage.accrualMissingStores, ['CYJB店']);
});

test('source document count mismatch fails closed when legacy Summary exposes that count', () => {
  const row = audit.buildHistoricalTargetCoverageAuditRow({
    brandId: 'cyj',
    yearMonth: '2026-06',
    summaryData: legacySummary({ sourceDocCount: 99 }),
    lifecycleMaster: readyLifecycle('cyj'),
  });

  assert.equal(row.classification, audit.TARGET_COVERAGE_AUDIT_CLASSIFICATION.RAW_RECONSTRUCTION_REQUIRED);
  assert.ok(row.reasonCodes.includes('SOURCE_DOC_COUNT_MISMATCH'));
});

test('legacy Summary is blocked when Lifecycle master is not READY', () => {
  const row = audit.buildHistoricalTargetCoverageAuditRow({
    brandId: 'cyj',
    yearMonth: '2026-06',
    summaryData: legacySummary(),
    lifecycleMaster: { ...readyLifecycle('cyj'), datasetStatus: 'BUILDING' },
  });

  assert.equal(row.classification, audit.TARGET_COVERAGE_AUDIT_CLASSIFICATION.LIFECYCLE_NOT_READY);
  assert.equal(row.migrationWriteAllowed, false);
  assert.equal(row.previewCoverage, null);
});

test('audit summary exposes migration candidates, Raw-required months, Lifecycle blocks and pre-system skips separately', () => {
  const summary = audit.summarizeHistoricalTargetCoverageAudit([
    { yearMonth: '2026-01', classification: 'PRE_SYSTEM_SKIP' },
    { yearMonth: '2026-04', classification: 'ALREADY_V1' },
    { yearMonth: '2026-05', classification: 'SUMMARY_BACKFILL_SAFE' },
    { yearMonth: '2026-06', classification: 'RAW_RECONSTRUCTION_REQUIRED' },
    { yearMonth: '2026-07', classification: 'LIFECYCLE_NOT_READY' },
  ]);

  assert.equal(summary.totalMonths, 5);
  assert.deepEqual(summary.migrationCandidateMonths, ['2026-05']);
  assert.deepEqual(summary.rawReconstructionMonths, ['2026-06']);
  assert.deepEqual(summary.lifecycleBlockedMonths, ['2026-07']);
  assert.deepEqual(summary.preSystemSkippedMonths, ['2026-01']);
});

test('backend endpoint is secured, Summary-first, read-only and never scans Raw monthly_targets', () => {
  assert.match(auditSource, /requireFirebaseRequestAuth/);
  assert.match(auditSource, /verifySuperAdminActor/);
  assert.match(auditSource, /db\.collection\(paths\.monthlyTargetSummary\)/);
  assert.match(auditSource, /db\.doc\(paths\.lifecycleMaster\)/);
  assert.match(auditSource, /FieldPath\.documentId\(\)/);
  assert.match(auditSource, /endBefore\(historicalBeforeMonth\)/);
  assert.match(auditSource, /rawMonthlyTargetsReads:\s*0/);
  assert.match(auditSource, /firestoreWrites:\s*0/);
  assert.doesNotMatch(auditSource, /db\.collection\([^\n]*monthly_targets[^_]/);
  assert.doesNotMatch(auditSource, /\.set\s*\(/);
  assert.doesNotMatch(auditSource, /\.update\s*\(/);
  assert.doesNotMatch(auditSource, /\.delete\s*\(/);
  assert.doesNotMatch(auditSource, /runTransaction/);
  assert.doesNotMatch(auditSource, /setInterval\s*\(/);
  assert.doesNotMatch(auditSource, /onSchedule/);
});

test('Functions index exports exactly one read-only Pre-Batch-5 audit endpoint', () => {
  assert.match(functionsIndex, /createTargetCoverageAuditFunctions/);
  assert.match(functionsIndex, /exports\.auditHistoricalTargetCoverage = targetCoverageAuditFunctions\.auditHistoricalTargetCoverage/);
});

test('SystemMaintenance exposes Audit Only UI without listener or polling and preserves CURRENT_APP_VERSION outside this scope', () => {
  assert.match(maintenanceSource, /Pre-Batch-5：歷史 Target Coverage 稽核/);
  assert.match(maintenanceSource, /不掃 Raw monthly_targets、不寫入任何資料/);
  assert.match(maintenanceSource, /Audit Only｜0 Writes/);
  assert.match(maintenanceSource, /TARGET_COVERAGE_AUDIT_ENDPOINT/);
  assert.match(maintenanceSource, /auth\.currentUser\?\.getIdToken/);
  assert.match(maintenanceSource, /currentDeviceTrust\?\.status[^\n]*trusted/);
  assert.doesNotMatch(maintenanceSource, /onSnapshot\([^\n]*targetCoverageAudit/);
  assert.doesNotMatch(maintenanceSource, /setInterval\([^\n]*targetCoverageAudit/);
  assert.match(maintenanceSource, /核心資料一致性健檢/);
  assert.doesNotMatch(maintenanceSource, /handleExecuteCyjNewStoreRepair/);
});
