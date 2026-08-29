const {
  TARGET_COVERAGE_VERSION,
  normalizeTargetCoverageBrandId,
  extractSummaryTargetMap,
  targetMapsEqual,
  getTargetCoveragePaths,
} = require('./targetCoverage');
const {
  KPI_CONTRACT_VERSION,
} = require('./kpiContracts');
const {
  normalizeStoreLifecycleCore,
  getCanonicalStoreName: getCanonicalLifecycleStoreName,
} = require('./storeLifecycle');
const {
  TARGET_COVERAGE_AUDIT_VERSION,
  TARGET_COVERAGE_AUDIT_CLASSIFICATION,
  normalizeAuditYearMonth,
  getTaipeiCurrentYearMonth,
  buildHistoricalTargetCoverageAuditRow,
} = require('./targetCoverageAudit');

const TARGET_COVERAGE_MIGRATION_VERSION = 'target-coverage-historical-metadata-backfill-v1';
const TARGET_COVERAGE_MIGRATION_SOURCE = 'target_coverage_historical_backfill_v1';
const TARGET_COVERAGE_MIGRATION_MAX_MONTHS = 12;

const TARGET_COVERAGE_MIGRATION_ALLOWED_FIELDS = Object.freeze([
  'targetCoverageVersion',
  'kpiContractVersion',
  'lifecycleReady',
  'eligibleStoreCount',
  'cashConfiguredStoreCount',
  'accrualConfiguredStoreCount',
  'cashCoverageComplete',
  'accrualCoverageComplete',
  'cashMissingStores',
  'accrualMissingStores',
  'targetAudit',
  'coverageSource',
  'coverageUpdatedAt',
  'coverageUpdatedAtText',
]);

const TARGET_COVERAGE_MIGRATION_FORBIDDEN_LEGACY_FIELDS = Object.freeze([
  'targets',
  'stores',
  'storeTargets',
  'storeTargetMap',
  'monthlyTargets',
  'targetStores',
  'items',
  'data',
  'byStore',
  'storeMap',
  'storesMap',
  'summaryByStore',
  'storeSummaries',
  'storeCount',
  'targetCount',
  'sourceDocCount',
  'cashTargetTotal',
  'accrualTargetTotal',
]);

function toComparableLegacyNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeMigrationYearMonths(values = [], historicalBeforeMonth = getTaipeiCurrentYearMonth()) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('MIGRATION_MONTHS_REQUIRED');
  }
  if (values.length > TARGET_COVERAGE_MIGRATION_MAX_MONTHS) {
    throw new Error('MIGRATION_MONTH_LIMIT_EXCEEDED');
  }

  const cutoff = normalizeAuditYearMonth(historicalBeforeMonth);
  if (!cutoff) throw new Error('INVALID_HISTORICAL_CUTOFF');

  const normalized = [];
  const seen = new Set();
  values.forEach((value) => {
    const yearMonth = normalizeAuditYearMonth(value);
    if (!yearMonth) throw new Error(`INVALID_MIGRATION_MONTH:${String(value || '')}`);
    if (yearMonth >= cutoff) throw new Error(`MIGRATION_MONTH_NOT_HISTORICAL:${yearMonth}`);
    if (!seen.has(yearMonth)) {
      seen.add(yearMonth);
      normalized.push(yearMonth);
    }
  });

  return normalized.sort((a, b) => a.localeCompare(b));
}

function buildLegacyTargetSummarySnapshot(summaryData = {}, brandId = 'cyj', yearMonth = '') {
  const targetMap = extractSummaryTargetMap(summaryData || {}, brandId, yearMonth, {
    normalizeStoreCore: normalizeStoreLifecycleCore,
    getCanonicalStoreName: getCanonicalLifecycleStoreName,
  });
  return {
    storeCount: toComparableLegacyNumber(summaryData.storeCount),
    targetCount: toComparableLegacyNumber(summaryData.targetCount),
    sourceDocCount: toComparableLegacyNumber(summaryData.sourceDocCount),
    cashTargetTotal: toComparableLegacyNumber(summaryData.cashTargetTotal),
    accrualTargetTotal: toComparableLegacyNumber(summaryData.accrualTargetTotal),
    targetMap,
  };
}

function legacyTargetSummarySnapshotMatches(before = {}, after = {}) {
  return (
    before.storeCount === after.storeCount &&
    before.targetCount === after.targetCount &&
    before.sourceDocCount === after.sourceDocCount &&
    before.cashTargetTotal === after.cashTargetTotal &&
    before.accrualTargetTotal === after.accrualTargetTotal &&
    targetMapsEqual(before.targetMap || {}, after.targetMap || {})
  );
}

function buildMetadataOnlyCoveragePatch({ auditRow = {}, coverageUpdatedAt = null, coverageUpdatedAtText = '' } = {}) {
  if (
    auditRow.classification !== TARGET_COVERAGE_AUDIT_CLASSIFICATION.SUMMARY_BACKFILL_SAFE ||
    auditRow.migrationWriteAllowed !== true ||
    !auditRow.previewCoverage
  ) {
    throw new Error('MIGRATION_ROW_NOT_SAFE');
  }

  const coverage = auditRow.previewCoverage || {};
  const patch = {
    targetCoverageVersion: String(coverage.targetCoverageVersion || TARGET_COVERAGE_VERSION),
    kpiContractVersion: String(coverage.kpiContractVersion || KPI_CONTRACT_VERSION),
    lifecycleReady: coverage.lifecycleReady === true,
    eligibleStoreCount: Number(coverage.eligibleStoreCount || 0),
    cashConfiguredStoreCount: Number(coverage.cashConfiguredStoreCount || 0),
    accrualConfiguredStoreCount: Number(coverage.accrualConfiguredStoreCount || 0),
    cashCoverageComplete: coverage.cashCoverageComplete === true,
    accrualCoverageComplete: coverage.accrualCoverageComplete === true,
    cashMissingStores: Array.isArray(coverage.cashMissingStores) ? coverage.cashMissingStores : [],
    accrualMissingStores: Array.isArray(coverage.accrualMissingStores) ? coverage.accrualMissingStores : [],
    targetAudit: coverage.targetAudit && typeof coverage.targetAudit === 'object' ? coverage.targetAudit : {},
    coverageSource: TARGET_COVERAGE_MIGRATION_SOURCE,
    coverageUpdatedAt,
    coverageUpdatedAtText: String(coverageUpdatedAtText || ''),
  };

  const unexpectedKeys = Object.keys(patch).filter((key) => !TARGET_COVERAGE_MIGRATION_ALLOWED_FIELDS.includes(key));
  if (unexpectedKeys.length) throw new Error(`MIGRATION_PATCH_FIELD_NOT_ALLOWED:${unexpectedKeys.join(',')}`);
  const forbiddenKeys = TARGET_COVERAGE_MIGRATION_FORBIDDEN_LEGACY_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(patch, key));
  if (forbiddenKeys.length) throw new Error(`MIGRATION_PATCH_TOUCHES_LEGACY:${forbiddenKeys.join(',')}`);
  return patch;
}

function buildAtomicMigrationPlan({ brandId, yearMonths = [], summariesByMonth = {}, lifecycleMaster = {} } = {}) {
  const normalizedBrandId = normalizeTargetCoverageBrandId(brandId);
  if (!normalizedBrandId) throw new Error('UNSUPPORTED_TARGET_COVERAGE_BRAND');

  const rows = yearMonths.map((yearMonth) => {
    const entry = summariesByMonth[yearMonth];
    if (!entry || entry.exists === false) {
      return {
        brandId: normalizedBrandId,
        yearMonth,
        classification: 'SUMMARY_DOCUMENT_MISSING',
        reasonCodes: ['SUMMARY_DOCUMENT_MISSING'],
        migrationWriteAllowed: false,
      };
    }
    return buildHistoricalTargetCoverageAuditRow({
      brandId: normalizedBrandId,
      yearMonth,
      summaryData: entry.data || {},
      lifecycleMaster,
    });
  });

  const writeRows = rows.filter((row) => (
    row.classification === TARGET_COVERAGE_AUDIT_CLASSIFICATION.SUMMARY_BACKFILL_SAFE &&
    row.migrationWriteAllowed === true
  ));
  const skipRows = rows.filter((row) => row.classification === TARGET_COVERAGE_AUDIT_CLASSIFICATION.ALREADY_V1);
  const blockedRows = rows.filter((row) => !writeRows.includes(row) && !skipRows.includes(row));

  return {
    atomic: true,
    canApply: blockedRows.length === 0,
    rows,
    writeRows,
    skipRows,
    blockedRows,
    writeMonths: writeRows.map((row) => row.yearMonth),
    skippedMonths: skipRows.map((row) => row.yearMonth),
    blockedMonths: blockedRows.map((row) => row.yearMonth),
  };
}

function stableComparable(value) {
  if (Array.isArray(value)) return value.map(stableComparable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableComparable(value[key])]));
  }
  return value ?? null;
}

function persistedCoverageMatchesExpected(persisted = {}, expectedPatch = {}) {
  const compareKeys = TARGET_COVERAGE_MIGRATION_ALLOWED_FIELDS.filter((key) => key !== 'coverageUpdatedAt');
  return compareKeys.every((key) => {
    const expected = expectedPatch[key];
    const actual = persisted[key];
    if (Array.isArray(expected) || (expected && typeof expected === 'object')) {
      return JSON.stringify(stableComparable(actual)) === JSON.stringify(stableComparable(expected));
    }
    return actual === expected;
  });
}

function createTargetCoverageMigrationFunctions({ admin, db }) {
  const { onRequest } = require('firebase-functions/v2/https');
  const {
    requireFirebaseRequestAuth,
    verifySuperAdminActor,
  } = require('./deviceApproval');

  const migrateHistoricalTargetCoverageMetadata = onRequest({ cors: true, timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });

    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });

    try {
      const body = req.body || {};
      const brandId = normalizeTargetCoverageBrandId(body.brandId);
      if (!brandId) return res.status(400).json({ ok: false, message: '不支援的品牌' });
      if (body.confirmMetadataOnly !== true) {
        return res.status(400).json({ ok: false, message: '缺少 Metadata-only migration 明確確認' });
      }
      if (String(body.auditVersion || '') !== TARGET_COVERAGE_AUDIT_VERSION) {
        return res.status(409).json({ ok: false, message: 'Audit 版本已變更，請重新執行只讀稽核後再補 Metadata' });
      }

      const adminCheck = await verifySuperAdminActor({ db, brandId, actor: body.actor || {} });
      if (!adminCheck.ok) return res.status(403).json({ ok: false, message: '此操作僅限最高管理者在已信任裝置執行' });

      const historicalBeforeMonth = getTaipeiCurrentYearMonth();
      let yearMonths;
      try {
        yearMonths = normalizeMigrationYearMonths(body.yearMonths, historicalBeforeMonth);
      } catch (error) {
        return res.status(400).json({ ok: false, message: error.message || '月份範圍不正確' });
      }

      const paths = getTargetCoveragePaths(brandId);
      const lifecycleRef = db.doc(paths.lifecycleMaster);
      const summaryRefs = Object.fromEntries(yearMonths.map((yearMonth) => [
        yearMonth,
        db.doc(`${paths.monthlyTargetSummary}/${yearMonth}`),
      ]));

      const transactionResult = await db.runTransaction(async (transaction) => {
        // All reads occur before any write. Firestore retries the whole transaction if either
        // Lifecycle or any target Summary changes concurrently, so Phase A results are never trusted stale.
        const lifecycleSnap = await transaction.get(lifecycleRef);
        const summarySnaps = await Promise.all(yearMonths.map((yearMonth) => transaction.get(summaryRefs[yearMonth])));
        const lifecycleMaster = lifecycleSnap.exists
          ? (lifecycleSnap.data() || {})
          : { datasetStatus: 'BUILDING', stores: {} };
        const summariesByMonth = {};
        const beforeLegacyByMonth = {};

        summarySnaps.forEach((snap, index) => {
          const yearMonth = yearMonths[index];
          summariesByMonth[yearMonth] = {
            exists: snap.exists,
            data: snap.exists ? (snap.data() || {}) : {},
          };
          if (snap.exists) {
            beforeLegacyByMonth[yearMonth] = buildLegacyTargetSummarySnapshot(snap.data() || {}, brandId, yearMonth);
          }
        });

        const plan = buildAtomicMigrationPlan({
          brandId,
          yearMonths,
          summariesByMonth,
          lifecycleMaster,
        });

        if (!plan.canApply) {
          return {
            applied: false,
            plan,
            beforeLegacyByMonth,
            lifecycle: {
              datasetStatus: String(lifecycleMaster.datasetStatus || 'BUILDING'),
              revision: Number(lifecycleMaster.revision || 0),
            },
          };
        }

        const nowText = new Date().toISOString();
        const expectedPatchByMonth = {};
        plan.writeRows.forEach((row) => {
          const patch = buildMetadataOnlyCoveragePatch({
            auditRow: row,
            coverageUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            coverageUpdatedAtText: nowText,
          });
          expectedPatchByMonth[row.yearMonth] = {
            ...patch,
            coverageUpdatedAt: null,
          };
          transaction.set(summaryRefs[row.yearMonth], patch, { merge: true });
        });

        return {
          applied: true,
          plan,
          beforeLegacyByMonth,
          expectedPatchByMonth,
          lifecycle: {
            datasetStatus: String(lifecycleMaster.datasetStatus || 'BUILDING'),
            revision: Number(lifecycleMaster.revision || 0),
          },
          coverageUpdatedAtText: nowText,
        };
      });

      const plan = transactionResult.plan || {};
      if (!transactionResult.applied) {
        const blocked = (plan.blockedRows || []).map((row) => ({
          yearMonth: row.yearMonth,
          classification: row.classification,
          reasonCodes: row.reasonCodes || [],
        }));
        console.warn(`Target Coverage metadata migration blocked atomically: ${brandId} | ${JSON.stringify(blocked)}`);
        return res.status(409).json({
          ok: false,
          atomic: true,
          migrationVersion: TARGET_COVERAGE_MIGRATION_VERSION,
          brandId,
          historicalBeforeMonth,
          message: '資料狀態已變更；本次未寫入任何月份，請重新執行只讀稽核',
          writtenCount: 0,
          skippedCount: Number(plan.skipRows?.length || 0),
          blockedCount: blocked.length,
          blocked,
          rawMonthlyTargetsReads: 0,
          firestoreWrites: 0,
        });
      }

      const writtenMonths = Array.isArray(plan.writeMonths) ? plan.writeMonths : [];
      const skippedMonths = Array.isArray(plan.skippedMonths) ? plan.skippedMonths : [];
      const persistedVerification = [];

      if (writtenMonths.length) {
        const persistedSnaps = await Promise.all(writtenMonths.map((yearMonth) => summaryRefs[yearMonth].get()));
        persistedSnaps.forEach((snap, index) => {
          const yearMonth = writtenMonths[index];
          const persisted = snap.exists ? (snap.data() || {}) : {};
          const afterLegacy = buildLegacyTargetSummarySnapshot(persisted, brandId, yearMonth);
          const beforeLegacy = transactionResult.beforeLegacyByMonth?.[yearMonth] || {};
          const expectedPatch = transactionResult.expectedPatchByMonth?.[yearMonth] || {};
          const metadataMatched = snap.exists && persistedCoverageMatchesExpected(persisted, expectedPatch);
          const legacyPreserved = snap.exists && legacyTargetSummarySnapshotMatches(beforeLegacy, afterLegacy);
          persistedVerification.push({
            yearMonth,
            exists: snap.exists,
            targetCoverageVersion: String(persisted.targetCoverageVersion || ''),
            metadataMatched,
            legacyPreserved,
            verified: Boolean(
              snap.exists &&
              String(persisted.targetCoverageVersion || '') === TARGET_COVERAGE_VERSION &&
              metadataMatched &&
              legacyPreserved
            ),
          });
        });
      }

      const allVerified = persistedVerification.every((row) => row.verified === true);
      const writtenCount = writtenMonths.length;
      const minimumFirestoreReads = 3 + 1 + yearMonths.length + writtenCount;
      const readEstimate = {
        firebaseAuthVerification: 0,
        securityFirestoreReads: 3,
        transactionLifecycleReads: 1,
        transactionMonthlyTargetSummaryReads: yearMonths.length,
        persistedVerificationReads: writtenCount,
        rawMonthlyTargetsReads: 0,
        minimumFirestoreReads,
        transactionRetriesMayAddReads: true,
      };

      console.info(
        `Target Coverage metadata migration: ${brandId} | requested=${yearMonths.length} | written=${writtenCount} | skipped=${skippedMonths.length} | verified=${allVerified}`
      );

      if (!allVerified) {
        return res.status(500).json({
          ok: false,
          migrationApplied: writtenCount > 0,
          atomic: true,
          migrationVersion: TARGET_COVERAGE_MIGRATION_VERSION,
          brandId,
          writtenMonths,
          skippedMonths,
          writtenCount,
          skippedCount: skippedMonths.length,
          persistedVerification,
          allVerified: false,
          readEstimate,
          firestoreWrites: writtenCount,
          message: 'Metadata 已寫入，但 persisted readback 驗證未完全通過；請停止後續 migration 並檢查此品牌',
        });
      }

      return res.status(200).json({
        ok: true,
        migrationApplied: writtenCount > 0,
        atomic: true,
        metadataOnly: true,
        migrationVersion: TARGET_COVERAGE_MIGRATION_VERSION,
        brandId,
        lifecycle: transactionResult.lifecycle,
        historicalBeforeMonth,
        requestedMonths: yearMonths,
        writtenMonths,
        skippedMonths,
        writtenCount,
        skippedCount: skippedMonths.length,
        blockedCount: 0,
        rawMonthlyTargetsReads: 0,
        firestoreWrites: writtenCount,
        persistedVerification,
        allVerified: true,
        readEstimate,
        migratedAtText: transactionResult.coverageUpdatedAtText || new Date().toISOString(),
      });
    } catch (error) {
      console.error('migrateHistoricalTargetCoverageMetadata failed', error);
      return res.status(500).json({ ok: false, message: '歷史 Target Coverage Metadata migration 失敗，請停止操作並檢查後端紀錄' });
    }
  });

  return { migrateHistoricalTargetCoverageMetadata };
}

module.exports = {
  TARGET_COVERAGE_MIGRATION_VERSION,
  TARGET_COVERAGE_MIGRATION_SOURCE,
  TARGET_COVERAGE_MIGRATION_MAX_MONTHS,
  TARGET_COVERAGE_MIGRATION_ALLOWED_FIELDS,
  TARGET_COVERAGE_MIGRATION_FORBIDDEN_LEGACY_FIELDS,
  normalizeMigrationYearMonths,
  buildLegacyTargetSummarySnapshot,
  legacyTargetSummarySnapshotMatches,
  buildMetadataOnlyCoveragePatch,
  buildAtomicMigrationPlan,
  stableComparable,
  persistedCoverageMatchesExpected,
  createTargetCoverageMigrationFunctions,
};
