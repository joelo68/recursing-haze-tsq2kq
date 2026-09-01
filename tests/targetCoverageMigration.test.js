import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const migration = require('../functions/targetCoverageMigration.js');
const audit = require('../functions/targetCoverageAudit.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migrationSource = read('functions/targetCoverageMigration.js');
const functionsIndex = read('functions/index.js');
const maintenanceSource = read('src/components/SystemMaintenance.jsx');

function readyLifecycle(brandId = 'cyj') {
  return {
    brandId,
    datasetStatus: 'READY',
    revision: 21,
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
      CYJA店: { storeName: 'CYJA店', cashTarget: 100, accrualTarget: 200, sourceDocId: 'CYJA店_2026_6' },
      CYJB店: { storeName: 'CYJB店', cashTarget: 200, accrualTarget: 300, sourceDocId: 'CYJB店_2026_6' },
    },
    ...overrides,
  };
}

function safeAuditRow() {
  return audit.buildHistoricalTargetCoverageAuditRow({
    brandId: 'cyj',
    yearMonth: '2026-06',
    summaryData: legacySummary(),
    lifecycleMaster: readyLifecycle('cyj'),
  });
}

test('migration normalizes unique valid months and allows historical/current/future existing Summary scope', () => {
  assert.deepEqual(
    migration.normalizeMigrationYearMonths(['2026-10', '2026-08', '2026-09', '2026-08']),
    ['2026-08', '2026-09', '2026-10']
  );
  assert.throws(
    () => migration.normalizeMigrationYearMonths(['2026-13']),
    /INVALID_MIGRATION_MONTH/
  );
});

test('metadata-only patch contains exactly allowed Coverage fields and no legacy target fields', () => {
  const patch = migration.buildMetadataOnlyCoveragePatch({
    auditRow: safeAuditRow(),
    coverageUpdatedAt: 'SERVER_TIMESTAMP_SENTINEL',
    coverageUpdatedAtText: '2026-08-29T10:00:00.000Z',
  });
  assert.deepEqual(Object.keys(patch).sort(), [...migration.TARGET_COVERAGE_MIGRATION_ALLOWED_FIELDS].sort());
  migration.TARGET_COVERAGE_MIGRATION_FORBIDDEN_LEGACY_FIELDS.forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(patch, key), false, `must not write legacy field ${key}`);
  });
  assert.equal(patch.targetCoverageVersion, 'target-coverage-v1');
  assert.equal(patch.kpiContractVersion, 'kpi-contract-v1');
  assert.equal(patch.coverageSource, migration.TARGET_COVERAGE_MIGRATION_SOURCE);
});

test('metadata-only patch refuses any row not freshly classified SUMMARY_BACKFILL_SAFE', () => {
  assert.throws(
    () => migration.buildMetadataOnlyCoveragePatch({ auditRow: { classification: 'ALREADY_V1' } }),
    /MIGRATION_ROW_NOT_SAFE/
  );
});

test('atomic migration plan allows safe rows and skips already-v1 rows without rewriting them', () => {
  const plan = migration.buildAtomicMigrationPlan({
    brandId: 'cyj',
    yearMonths: ['2026-05', '2026-06'],
    summariesByMonth: {
      '2026-05': { exists: true, data: { ...legacySummary(), yearMonth: '2026-05' } },
      '2026-06': { exists: true, data: legacySummary({ targetCoverageVersion: 'target-coverage-v1', kpiContractVersion: 'kpi-contract-v1' }) },
    },
    lifecycleMaster: readyLifecycle('cyj'),
  });
  assert.equal(plan.canApply, true);
  assert.deepEqual(plan.writeMonths, ['2026-05']);
  assert.deepEqual(plan.skippedMonths, ['2026-06']);
  assert.deepEqual(plan.blockedMonths, []);
});

test('one unsafe month blocks the entire brand migration plan atomically', () => {
  const plan = migration.buildAtomicMigrationPlan({
    brandId: 'cyj',
    yearMonths: ['2026-05', '2026-06'],
    summariesByMonth: {
      '2026-05': { exists: true, data: { ...legacySummary(), yearMonth: '2026-05' } },
      '2026-06': { exists: true, data: legacySummary({ cashTargetTotal: 999 }) },
    },
    lifecycleMaster: readyLifecycle('cyj'),
  });
  assert.equal(plan.canApply, false);
  assert.deepEqual(plan.blockedMonths, ['2026-06']);
});

test('Yibo pre-system month blocks migration instead of becoming a write candidate', () => {
  const plan = migration.buildAtomicMigrationPlan({
    brandId: 'yibo',
    yearMonths: ['2026-03'],
    summariesByMonth: { '2026-03': { exists: true, data: {} } },
    lifecycleMaster: readyLifecycle('yibo'),
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.rows[0].classification, 'PRE_SYSTEM_SKIP');
});

test('missing Summary document blocks the atomic migration', () => {
  const plan = migration.buildAtomicMigrationPlan({
    brandId: 'cyj',
    yearMonths: ['2026-06'],
    summariesByMonth: { '2026-06': { exists: false, data: {} } },
    lifecycleMaster: readyLifecycle('cyj'),
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.rows[0].classification, 'SUMMARY_DOCUMENT_MISSING');
});

test('legacy preservation signature detects both totals and target-map changes', () => {
  const before = migration.buildLegacyTargetSummarySnapshot(legacySummary(), 'cyj', '2026-06');
  const same = migration.buildLegacyTargetSummarySnapshot(legacySummary({ targetCoverageVersion: 'target-coverage-v1' }), 'cyj', '2026-06');
  const changedTotal = migration.buildLegacyTargetSummarySnapshot(legacySummary({ cashTargetTotal: 301 }), 'cyj', '2026-06');
  const changedMap = migration.buildLegacyTargetSummarySnapshot(legacySummary({
    targets: {
      CYJA店: { storeName: 'CYJA店', cashTarget: 101, accrualTarget: 200, sourceDocId: 'CYJA店_2026_6' },
      CYJB店: { storeName: 'CYJB店', cashTarget: 200, accrualTarget: 300, sourceDocId: 'CYJB店_2026_6' },
    },
  }), 'cyj', '2026-06');
  assert.equal(migration.legacyTargetSummarySnapshotMatches(before, same), true);
  assert.equal(migration.legacyTargetSummarySnapshotMatches(before, changedTotal), false);
  assert.equal(migration.legacyTargetSummarySnapshotMatches(before, changedMap), false);
});

test('backend migration endpoint accepts fresh all-existing-month audit scope, stays secured/atomic/Summary-first, has persisted readback, and never scans Raw monthly_targets', () => {
  assert.match(migrationSource, /requireFirebaseRequestAuth/);
  assert.match(migrationSource, /verifySuperAdminActor/);
  assert.match(migrationSource, /confirmMetadataOnly/);
  assert.match(migrationSource, /TARGET_COVERAGE_AUDIT_SCOPE/);
  assert.match(migrationSource, /body\.auditScope/);
  assert.doesNotMatch(migrationSource, /MIGRATION_MONTH_NOT_HISTORICAL/);
  assert.doesNotMatch(migrationSource, /getTaipeiCurrentYearMonth/);
  assert.match(migrationSource, /db\.runTransaction/);
  assert.match(migrationSource, /transaction\.get\(lifecycleRef\)/);
  assert.match(migrationSource, /transaction\.get\(summaryRefs\[yearMonth\]\)/);
  assert.match(migrationSource, /buildHistoricalTargetCoverageAuditRow/);
  assert.match(migrationSource, /persistedVerification/);
  assert.match(migrationSource, /rawMonthlyTargetsReads:\s*0/);
  assert.doesNotMatch(migrationSource, /db\.collection\([^\n]*monthly_targets[^_]/);
  assert.doesNotMatch(migrationSource, /paths\.monthlyTargets/);
  assert.doesNotMatch(migrationSource, /onSchedule/);
  assert.doesNotMatch(migrationSource, /setInterval\s*\(/);
});

test('Functions index and SystemMaintenance expose one explicit all-existing-month metadata-only migration path', () => {
  assert.match(functionsIndex, /createTargetCoverageMigrationFunctions/);
  assert.match(functionsIndex, /exports\.migrateHistoricalTargetCoverageMetadata = targetCoverageMigrationFunctions\.migrateHistoricalTargetCoverageMetadata/);
  assert.match(maintenanceSource, /Production：補 Target Coverage Metadata/);
  assert.match(maintenanceSource, /auditScope:\s*targetCoverageAuditReport\.auditScope/);
  assert.match(maintenanceSource, /TARGET_COVERAGE_MIGRATION_ENDPOINT/);
  assert.match(maintenanceSource, /confirmMetadataOnly:\s*true/);
  assert.match(maintenanceSource, /atomic transaction/);
  assert.match(maintenanceSource, /Raw Target Reads/);
  assert.doesNotMatch(maintenanceSource, /onSnapshot\([^\n]*targetCoverageMigration/);
  assert.doesNotMatch(maintenanceSource, /setInterval\([^\n]*targetCoverageMigration/);
});
