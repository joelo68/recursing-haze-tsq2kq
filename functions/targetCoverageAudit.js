const {
  TARGET_COVERAGE_VERSION,
  normalizeTargetCoverageBrandId,
  extractSummaryTargetMap,
  buildIndependentCoverage,
  buildTargetSummaryCompatibilityFields,
  getTargetCoveragePaths,
} = require('./targetCoverage');
const {
  KPI_CONTRACT_VERSION,
} = require('./kpiContracts');
const {
  getLifecycleEligibleStoreEntries,
  normalizeStoreLifecycleCore,
  getCanonicalStoreName: getCanonicalLifecycleStoreName,
} = require('./storeLifecycle');

const TARGET_COVERAGE_AUDIT_VERSION = 'target-coverage-existing-summary-audit-v2';
const TARGET_COVERAGE_AUDIT_SCOPE = 'EXISTING_SUMMARY_MONTHS';
const YIBO_DATA_START_MONTH = '2026-04';

const TARGET_COVERAGE_AUDIT_CLASSIFICATION = Object.freeze({
  ALREADY_V1: 'ALREADY_V1',
  SUMMARY_BACKFILL_SAFE: 'SUMMARY_BACKFILL_SAFE',
  RAW_RECONSTRUCTION_REQUIRED: 'RAW_RECONSTRUCTION_REQUIRED',
  LIFECYCLE_NOT_READY: 'LIFECYCLE_NOT_READY',
  PRE_SYSTEM_SKIP: 'PRE_SYSTEM_SKIP',
});

function normalizeAuditYearMonth(value = '') {
  const text = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : '';
}

function isFiniteSummaryNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  const number = Number(value);
  return Number.isFinite(number);
}

function toFiniteSummaryNumber(value) {
  return isFiniteSummaryNumber(value) ? Number(value) : null;
}

function exactNumericMatch(stored, calculated) {
  const storedNumber = toFiniteSummaryNumber(stored);
  const calculatedNumber = toFiniteSummaryNumber(calculated);
  if (storedNumber === null || calculatedNumber === null) return false;
  return storedNumber === calculatedNumber;
}

function isPreSystemTargetCoverageMonth(brandId = '', yearMonth = '') {
  return normalizeTargetCoverageBrandId(brandId) === 'yibo' && normalizeAuditYearMonth(yearMonth) < YIBO_DATA_START_MONTH;
}

function getTaipeiCurrentYearMonth(nowMs = Date.now()) {
  return new Date(Number(nowMs || Date.now()) + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function buildSummaryConsistencySnapshot(summaryData = {}, compatibility = {}) {
  const stored = {
    storeCount: toFiniteSummaryNumber(summaryData.storeCount),
    targetCount: toFiniteSummaryNumber(summaryData.targetCount),
    sourceDocCount: toFiniteSummaryNumber(summaryData.sourceDocCount),
    cashTargetTotal: toFiniteSummaryNumber(summaryData.cashTargetTotal),
    accrualTargetTotal: toFiniteSummaryNumber(summaryData.accrualTargetTotal),
  };

  const calculated = {
    storeCount: Number(compatibility.storeCount || 0),
    targetCount: Number(compatibility.targetCount || 0),
    sourceDocCount: Number(compatibility.sourceDocCount || 0),
    cashTargetTotal: Number(compatibility.cashTargetTotal || 0),
    accrualTargetTotal: Number(compatibility.accrualTargetTotal || 0),
  };

  const checks = {
    storeCount: exactNumericMatch(stored.storeCount, calculated.storeCount),
    targetCount: exactNumericMatch(stored.targetCount, calculated.targetCount),
    cashTargetTotal: exactNumericMatch(stored.cashTargetTotal, calculated.cashTargetTotal),
    accrualTargetTotal: exactNumericMatch(stored.accrualTargetTotal, calculated.accrualTargetTotal),
    sourceDocCount: stored.sourceDocCount === null
      ? true
      : exactNumericMatch(stored.sourceDocCount, calculated.sourceDocCount),
  };

  return {
    stored,
    calculated,
    checks,
    requiredLegacyFieldsPresent:
      stored.storeCount !== null &&
      stored.targetCount !== null &&
      stored.cashTargetTotal !== null &&
      stored.accrualTargetTotal !== null,
    allMatched: Object.values(checks).every(Boolean),
  };
}

function buildHistoricalTargetCoverageAuditRow({
  brandId,
  yearMonth,
  summaryData = {},
  lifecycleMaster = {},
} = {}) {
  const normalizedBrandId = normalizeTargetCoverageBrandId(brandId);
  const normalizedYearMonth = normalizeAuditYearMonth(yearMonth || summaryData.yearMonth || '');
  if (!normalizedBrandId) throw new Error('UNSUPPORTED_TARGET_COVERAGE_BRAND');

  const baseRow = {
    auditVersion: TARGET_COVERAGE_AUDIT_VERSION,
    brandId: normalizedBrandId,
    yearMonth: normalizedYearMonth || String(yearMonth || ''),
    classification: TARGET_COVERAGE_AUDIT_CLASSIFICATION.RAW_RECONSTRUCTION_REQUIRED,
    reasonCodes: [],
    targetCoverageVersion: String(summaryData.targetCoverageVersion || ''),
    kpiContractVersion: String(summaryData.kpiContractVersion || ''),
    lifecycleDatasetStatus: String(lifecycleMaster.datasetStatus || 'BUILDING'),
    lifecycleReady: String(lifecycleMaster.datasetStatus || '') === 'READY',
    summaryTargetRowCount: 0,
    declaredStoreCount: toFiniteSummaryNumber(summaryData.storeCount),
    declaredTargetCount: toFiniteSummaryNumber(summaryData.targetCount),
    declaredSourceDocCount: toFiniteSummaryNumber(summaryData.sourceDocCount),
    storedCashTargetTotal: toFiniteSummaryNumber(summaryData.cashTargetTotal),
    storedAccrualTargetTotal: toFiniteSummaryNumber(summaryData.accrualTargetTotal),
    calculatedCashTargetTotal: null,
    calculatedAccrualTargetTotal: null,
    calculatedStoreCount: null,
    calculatedTargetCount: null,
    calculatedSourceDocCount: null,
    eligibleStoreCount: null,
    previewCoverage: null,
    consistency: null,
    migrationWriteAllowed: false,
  };

  if (!normalizedYearMonth) {
    return {
      ...baseRow,
      reasonCodes: ['INVALID_YEAR_MONTH'],
    };
  }

  if (isPreSystemTargetCoverageMonth(normalizedBrandId, normalizedYearMonth)) {
    return {
      ...baseRow,
      classification: TARGET_COVERAGE_AUDIT_CLASSIFICATION.PRE_SYSTEM_SKIP,
      reasonCodes: ['YIBO_PRE_SYSTEM_MONTH'],
    };
  }

  const targetMap = extractSummaryTargetMap(summaryData, normalizedBrandId, normalizedYearMonth, {
    normalizeStoreCore: normalizeStoreLifecycleCore,
    getCanonicalStoreName: getCanonicalLifecycleStoreName,
  });
  const compatibility = buildTargetSummaryCompatibilityFields(targetMap, normalizedBrandId, normalizedYearMonth);
  const consistency = buildSummaryConsistencySnapshot(summaryData, compatibility);
  const summaryTargetRowCount = Object.keys(targetMap).length;

  const enriched = {
    ...baseRow,
    summaryTargetRowCount,
    calculatedCashTargetTotal: compatibility.cashTargetTotal,
    calculatedAccrualTargetTotal: compatibility.accrualTargetTotal,
    calculatedStoreCount: compatibility.storeCount,
    calculatedTargetCount: compatibility.targetCount,
    calculatedSourceDocCount: compatibility.sourceDocCount,
    consistency,
  };

  if (String(summaryData.targetCoverageVersion || '') === TARGET_COVERAGE_VERSION) {
    const reasonCodes = ['TARGET_COVERAGE_V1_PRESENT'];
    if (String(summaryData.kpiContractVersion || '') !== KPI_CONTRACT_VERSION) {
      reasonCodes.push('KPI_CONTRACT_VERSION_MISMATCH');
    }
    return {
      ...enriched,
      classification: TARGET_COVERAGE_AUDIT_CLASSIFICATION.ALREADY_V1,
      reasonCodes,
    };
  }

  if (!enriched.lifecycleReady) {
    return {
      ...enriched,
      classification: TARGET_COVERAGE_AUDIT_CLASSIFICATION.LIFECYCLE_NOT_READY,
      reasonCodes: ['LIFECYCLE_DATASET_NOT_READY'],
    };
  }

  const eligibleEntries = getLifecycleEligibleStoreEntries(lifecycleMaster, normalizedYearMonth, {
    brandId: normalizedBrandId,
    requireReady: true,
  });
  const previewCoverage = buildIndependentCoverage({
    targetMap,
    eligibleEntries,
    lifecycleReady: true,
    normalizeStoreCoreFn: normalizeStoreLifecycleCore,
  });

  const reasonCodes = [];
  if (summaryTargetRowCount === 0) reasonCodes.push('SUMMARY_TARGET_MAP_EMPTY');
  if (!consistency.requiredLegacyFieldsPresent) reasonCodes.push('LEGACY_SUMMARY_FIELDS_MISSING');
  if (!consistency.checks.storeCount) reasonCodes.push('STORE_COUNT_MISMATCH');
  if (!consistency.checks.targetCount) reasonCodes.push('TARGET_COUNT_MISMATCH');
  if (!consistency.checks.sourceDocCount) reasonCodes.push('SOURCE_DOC_COUNT_MISMATCH');
  if (!consistency.checks.cashTargetTotal) reasonCodes.push('CASH_TARGET_TOTAL_MISMATCH');
  if (!consistency.checks.accrualTargetTotal) reasonCodes.push('ACCRUAL_TARGET_TOTAL_MISMATCH');

  const safe = summaryTargetRowCount > 0 && consistency.requiredLegacyFieldsPresent && consistency.allMatched;
  if (!safe) {
    return {
      ...enriched,
      eligibleStoreCount: eligibleEntries.length,
      previewCoverage,
      classification: TARGET_COVERAGE_AUDIT_CLASSIFICATION.RAW_RECONSTRUCTION_REQUIRED,
      reasonCodes: reasonCodes.length ? reasonCodes : ['SUMMARY_NOT_SAFE_FOR_METADATA_ONLY_BACKFILL'],
    };
  }

  return {
    ...enriched,
    eligibleStoreCount: eligibleEntries.length,
    previewCoverage,
    classification: TARGET_COVERAGE_AUDIT_CLASSIFICATION.SUMMARY_BACKFILL_SAFE,
    reasonCodes: ['SUMMARY_MAP_AND_LEGACY_TOTALS_MATCH'],
    migrationWriteAllowed: true,
  };
}

function summarizeHistoricalTargetCoverageAudit(rows = []) {
  const counts = Object.fromEntries(Object.values(TARGET_COVERAGE_AUDIT_CLASSIFICATION).map((key) => [key, 0]));
  rows.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(counts, row?.classification)) counts[row.classification] += 1;
  });
  return {
    totalMonths: rows.length,
    counts,
    migrationCandidateMonths: rows
      .filter((row) => row.classification === TARGET_COVERAGE_AUDIT_CLASSIFICATION.SUMMARY_BACKFILL_SAFE)
      .map((row) => row.yearMonth),
    rawReconstructionMonths: rows
      .filter((row) => row.classification === TARGET_COVERAGE_AUDIT_CLASSIFICATION.RAW_RECONSTRUCTION_REQUIRED)
      .map((row) => row.yearMonth),
    lifecycleBlockedMonths: rows
      .filter((row) => row.classification === TARGET_COVERAGE_AUDIT_CLASSIFICATION.LIFECYCLE_NOT_READY)
      .map((row) => row.yearMonth),
    preSystemSkippedMonths: rows
      .filter((row) => row.classification === TARGET_COVERAGE_AUDIT_CLASSIFICATION.PRE_SYSTEM_SKIP)
      .map((row) => row.yearMonth),
  };
}

function createTargetCoverageAuditFunctions({ admin, db }) {
  const { onRequest } = require('firebase-functions/v2/https');
  const {
    requireFirebaseRequestAuth,
    verifySuperAdminActor,
  } = require('./deviceApproval');
  const auditHistoricalTargetCoverage = onRequest({ cors: true, timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });

    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });

    try {
      const body = req.body || {};
      const brandId = normalizeTargetCoverageBrandId(body.brandId);
      if (!brandId) return res.status(400).json({ ok: false, message: '不支援的品牌' });

      const adminCheck = await verifySuperAdminActor({ db, brandId, actor: body.actor || {} });
      if (!adminCheck.ok) return res.status(403).json({ ok: false, message: '此稽核僅限最高管理者在已信任裝置執行' });

      const paths = getTargetCoveragePaths(brandId);
      const lifecycleRef = db.doc(paths.lifecycleMaster);
      const summaryCollection = db.collection(paths.monthlyTargetSummary);
      const currentYearMonth = getTaipeiCurrentYearMonth();

      // P1 coverage-gap recovery:
      // Audit every EXISTING Summary document for the selected brand, including
      // historical/current/future months. This remains a tiny month-level,
      // operator-triggered query and never scans Raw monthly_targets.
      const existingSummaryQuery = summaryCollection
        .orderBy(admin.firestore.FieldPath.documentId());
      const [lifecycleSnap, summarySnap] = await Promise.all([
        lifecycleRef.get(),
        existingSummaryQuery.get(),
      ]);

      const lifecycleMaster = lifecycleSnap.exists
        ? (lifecycleSnap.data() || {})
        : { datasetStatus: 'BUILDING', stores: {} };

      const rows = summarySnap.docs
        .map((docSnap) => buildHistoricalTargetCoverageAuditRow({
          brandId,
          yearMonth: docSnap.id || docSnap.data()?.yearMonth || '',
          summaryData: docSnap.data() || {},
          lifecycleMaster,
        }))
        .sort((a, b) => String(a.yearMonth || '').localeCompare(String(b.yearMonth || '')));

      const summary = summarizeHistoricalTargetCoverageAudit(rows);
      const readEstimate = {
        firebaseAuthVerification: 0,
        securityFirestoreReads: 3,
        lifecycleReads: 1,
        monthlyTargetSummaryReads: summarySnap.size,
        rawMonthlyTargetsReads: 0,
        firestoreWrites: 0,
        estimatedFirestoreReads: 4 + summarySnap.size,
      };

      console.info(
        `Target Coverage existing-summary audit: ${brandId} | months=${rows.length} | safe=${summary.counts.SUMMARY_BACKFILL_SAFE} | raw=${summary.counts.RAW_RECONSTRUCTION_REQUIRED} | already=${summary.counts.ALREADY_V1}`
      );

      return res.status(200).json({
        ok: true,
        auditOnly: true,
        auditVersion: TARGET_COVERAGE_AUDIT_VERSION,
        auditScope: TARGET_COVERAGE_AUDIT_SCOPE,
        includesCurrentAndFuture: true,
        brandId,
        lifecycle: {
          datasetStatus: String(lifecycleMaster.datasetStatus || 'BUILDING'),
          revision: Number(lifecycleMaster.revision || 0),
          ready: String(lifecycleMaster.datasetStatus || '') === 'READY',
        },
        summary,
        readEstimate,
        currentYearMonth,
        rows,
        auditedAtText: new Date().toISOString(),
      });
    } catch (error) {
      console.error('auditHistoricalTargetCoverage failed', error);
      return res.status(500).json({ ok: false, message: 'Target Coverage 現有 Summary 稽核失敗，請稍後再試' });
    }
  });

  return { auditHistoricalTargetCoverage };
}

module.exports = {
  TARGET_COVERAGE_AUDIT_VERSION,
  TARGET_COVERAGE_AUDIT_SCOPE,
  TARGET_COVERAGE_AUDIT_CLASSIFICATION,
  YIBO_DATA_START_MONTH,
  normalizeAuditYearMonth,
  isPreSystemTargetCoverageMonth,
  getTaipeiCurrentYearMonth,
  buildSummaryConsistencySnapshot,
  buildHistoricalTargetCoverageAuditRow,
  summarizeHistoricalTargetCoverageAudit,
  createTargetCoverageAuditFunctions,
};
