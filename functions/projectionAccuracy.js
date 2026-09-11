"use strict";

const { createHash } = require("node:crypto");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { isLifecycleEntryExpectedForDate } = require("./storeLifecycle");
const { aggregateTelegramProjectionRows } = require("./telegram/projectionConsumer");
const { isValidNumericStatus } = require("./telegram/formalKpi");
const { KPI_CONTRACT_VERSION } = require("./kpiContracts");
const { PROJECTION_CONTEXT_COLLECTION } = require("./projectionContext");
const { buildProspectiveShadowCandidate } = require("./projectionShadowCandidate");

const PROJECTION_ACCURACY_SCHEMA_VERSION = "projection-accuracy-v1";
const PROJECTION_ACCURACY_SEMANTIC_VERSION = "projection-accuracy-checkpoint-v1";
const PROJECTION_ACCURACY_COLLECTION = "projection_accuracy";
const PROJECTION_ACCURACY_BRANDS = Object.freeze(["cyj", "anniu", "yibo"]);
const PROJECTION_ACCURACY_CHECKPOINT_DAYS = Object.freeze([5, 7, 10, 15, 20, 25]);
const PROJECTION_ACCURACY_SCHEDULE = "10 7 * * *";
const PROJECTION_ACCURACY_TIME_ZONE = "Asia/Taipei";
const PROJECTION_ACCURACY_MAX_STORE_ROWS = 80;
const PROJECTION_ACCURACY_SCORE_SEMANTIC_VERSION = "projection-accuracy-score-v1";
const PROJECTION_ACCURACY_FINAL_ACTUAL_SOURCE = "verified_dashboard_summary";
const PROJECTION_ACCURACY_SUMMARY_VERSION = "dashboard-summary-v2";
const PROJECTION_ACCURACY_SUMMARY_SEMANTIC_VERSION = "summary-semantics-v1";
const PROJECTION_ACCURACY_HISTORY_COLLECTION = "projection_accuracy_history";
const PROJECTION_ACCURACY_HISTORY_SCHEMA_VERSION = "projection-accuracy-history-v1";
const PROJECTION_ACCURACY_HISTORY_COMPARISON_MODE = "v2_vs_v1_vs_pace";
const PROJECTION_ACCURACY_HISTORY_BRANDS = Object.freeze(["cyj", "anniu"]);
// Private normalization anchors from the approved B2A0 seed. They are used only to
// convert exact score amounts into dimensionless WAPE components before persistence.
// projection_accuracy_history never stores exact revenue totals.
const PROJECTION_ACCURACY_HISTORY_WEIGHT_BASELINES = Object.freeze({
  cyj: Object.freeze({ cash: 33377364, accrual: 37544307 }),
  anniu: Object.freeze({ cash: 32196527, accrual: 30397230 }),
});
const PROJECTION_ACCURACY_HISTORY_STATISTICS_VERSION = "normalized-wape-components-v1";

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const safeArray = (value) => Array.isArray(value) ? value : [];

function normalizeYearMonth(value = "") {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
}

function normalizeIsoDate(value = "") {
  const text = String(value || "").trim().replace(/\//g, "-");
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(text) ? text : "";
}

function getTaipeiIsoDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PROJECTION_ACCURACY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function shiftIsoDate(dateText = "", deltaDays = 0) {
  const date = normalizeIsoDate(dateText);
  if (!date) return "";
  const cursor = new Date(`${date}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + Number(deltaDays || 0));
  return cursor.toISOString().slice(0, 10);
}

function resolveScheduledCheckpoint(now = new Date()) {
  const taipeiToday = getTaipeiIsoDate(now);
  const cutoffDate = shiftIsoDate(taipeiToday, -1);
  const cutoffDay = Number(cutoffDate.slice(8, 10));
  return {
    taipeiToday,
    cutoffDate,
    cutoffDay,
    yearMonth: cutoffDate.slice(0, 7),
    checkpointKey: `day${String(cutoffDay).padStart(2, "0")}`,
    isCheckpoint: PROJECTION_ACCURACY_CHECKPOINT_DAYS.includes(cutoffDay),
  };
}

function getDaysInMonth(yearMonth = "") {
  const normalized = normalizeYearMonth(yearMonth);
  if (!normalized) return 0;
  const [year, month] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function recordLocalRead(ctx, count, source, meta = {}) {
  if (!ctx) return;
  const safeCount = Math.max(0, Number(count) || 0);
  ctx.readCount = Math.max(0, Number(ctx.readCount) || 0) + safeCount;
  if (!Array.isArray(ctx.sources)) ctx.sources = [];
  ctx.sources.push({
    source: String(source || "unknown"),
    brandId: String(meta.brandId || ""),
    yearMonth: String(meta.yearMonth || ""),
    updatedAtText: String(meta.updatedAtText || ""),
    readCount: safeCount,
    cacheHit: false,
  });
}

function buildCutoffDayCompleteness({
  authority = {},
  rows = [],
  cutoffDate = "",
  normalizeStoreKey = (value) => String(value || "").trim(),
  isExpectedForDate = isLifecycleEntryExpectedForDate,
} = {}) {
  const normalizedDate = normalizeIsoDate(cutoffDate);
  const formalScopeStoreSet = authority?.formalScopeStoreSet instanceof Set
    ? authority.formalScopeStoreSet
    : new Set();
  const lifecycleEntryMap = authority?.lifecycleEntryMap instanceof Map
    ? authority.lifecycleEntryMap
    : new Map();

  const expectedStores = [...formalScopeStoreSet]
    .map(normalizeStoreKey)
    .filter(Boolean)
    .filter((storeKey) => {
      const entry = lifecycleEntryMap.get(storeKey);
      return Boolean(entry && isExpectedForDate(entry, normalizedDate));
    })
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const expectedSet = new Set(expectedStores);

  const counts = new Map();
  let archivedDuplicateCount = 0;
  const unexpected = new Set();

  for (const row of safeArray(rows)) {
    if (row?.isArchivedDuplicate === true) {
      archivedDuplicateCount += 1;
      continue;
    }
    const date = normalizeIsoDate(row?.date || "");
    if (normalizedDate && date && date !== normalizedDate) continue;
    const storeKey = normalizeStoreKey(row?.storeName || row?.store || row?.storeKey || "");
    if (!storeKey) continue;
    if (!expectedSet.has(storeKey)) {
      unexpected.add(storeKey);
      continue;
    }
    counts.set(storeKey, (counts.get(storeKey) || 0) + 1);
  }

  const submittedStores = expectedStores.filter((storeKey) => (counts.get(storeKey) || 0) >= 1);
  const missingStores = expectedStores.filter((storeKey) => (counts.get(storeKey) || 0) === 0);
  const duplicateStores = expectedStores.filter((storeKey) => (counts.get(storeKey) || 0) > 1);

  const scopeReady = authority?.scopeReady === true;
  const complete = scopeReady
    && expectedStores.length > 0
    && missingStores.length === 0
    && duplicateStores.length === 0;

  return {
    complete,
    scopeReady,
    scopeReason: String(authority?.scopeReason || ""),
    expectedCount: expectedStores.length,
    submittedCount: submittedStores.length,
    missingCount: missingStores.length,
    duplicateCount: duplicateStores.length,
    unexpectedReportedCount: unexpected.size,
    archivedDuplicateCount,
    expectedStores,
    submittedStores,
    missingStores,
    duplicateStores,
    unexpectedReportedStores: [...unexpected].sort((a, b) => a.localeCompare(b, "zh-Hant")),
  };
}

function cloneRowsForShadowV1(rows = []) {
  const safeRows = safeArray(rows);
  if (!safeRows.length) return { ready: false, reason: "NO_STORE_ROWS", rows: [] };
  if (safeRows.length >= PROJECTION_ACCURACY_MAX_STORE_ROWS) {
    return { ready: false, reason: "STORE_ROWS_TRUNCATION_GUARD", rows: [] };
  }

  for (const row of safeRows) {
    for (const metric of ["cash", "accrual"]) {
      const basis = row?.projectionRange?.aggregationBasis?.[metric];
      if (
        !basis
        || !["currentTotal", "remainingConservative", "remainingStandard", "remainingAggressive"]
          .every((key) => isFiniteNumber(basis?.[key]))
      ) {
        return { ready: false, reason: `MISSING_${metric.toUpperCase()}_AGGREGATION_BASIS`, rows: [] };
      }
    }
  }

  return {
    ready: true,
    reason: "READY",
    rows: safeRows.map((row) => ({
      ...row,
      projectionRange: {
        ...(row?.projectionRange || {}),
        aggregationBasis: {
          cash: {
            ...row.projectionRange.aggregationBasis.cash,
            phaseApplied: false,
            phaseMultiplier: 1,
          },
          accrual: {
            ...row.projectionRange.aggregationBasis.accrual,
            phaseApplied: false,
            phaseMultiplier: 1,
          },
        },
      },
    })),
  };
}

function buildShadowV1Aggregate(rows = []) {
  const cloned = cloneRowsForShadowV1(rows);
  if (!cloned.ready) {
    return { ready: false, reason: cloned.reason, cash: null, accrual: null };
  }
  const aggregate = aggregateTelegramProjectionRows(cloned.rows);
  return {
    ready: true,
    reason: "READY",
    cash: aggregate?.cash || null,
    accrual: aggregate?.accrual || null,
  };
}

function buildNaiveCurrentPace(actualValue, cutoffDay, daysInMonth) {
  if (!isFiniteNumber(actualValue) || cutoffDay <= 0 || daysInMonth <= 0) return null;
  return Math.round((actualValue / cutoffDay) * daysInMonth);
}

function isProjectionRangeValid(range) {
  return Boolean(
    range
    && isFiniteNumber(range.conservative)
    && isFiniteNumber(range.standard)
    && isFiniteNumber(range.aggressive)
  );
}

function extractRuntimePhase(rows = [], metric = "cash") {
  const bases = safeArray(rows)
    .map((row) => row?.projectionRange?.aggregationBasis?.[metric] || null)
    .filter(Boolean);
  if (!bases.length) {
    return {
      available: false,
      phaseApplied: false,
      phaseScopeEligible: null,
      phaseMultiplier: null,
      reason: "NO_AGGREGATION_BASIS",
    };
  }

  const scopeEligible = bases.every((basis) => basis.phaseScopeEligible !== false);
  const appliedStates = bases.map((basis) => basis.phaseApplied === true);
  const phaseApplied = appliedStates.every(Boolean);
  const multipliers = bases
    .map((basis) => Number(basis.phaseMultiplier))
    .filter((value) => Number.isFinite(value) && value > 0);
  const firstMultiplier = multipliers.length ? multipliers[0] : null;
  const multiplierConsistent = firstMultiplier != null
    && multipliers.length === bases.length
    && multipliers.every((value) => Math.abs(value - firstMultiplier) <= 1e-12);

  return {
    available: true,
    phaseApplied,
    phaseScopeEligible: scopeEligible,
    phaseMultiplier: phaseApplied && multiplierConsistent ? firstMultiplier : 1,
    reason: phaseApplied
      ? (multiplierConsistent ? "PHASE_CALIBRATED" : "MIXED_OR_INVALID_MULTIPLIER")
      : "V1_OR_PHASE_FALLBACK",
  };
}

function buildScoreEligibility({
  metric = "cash",
  completeness = {},
  actualStatus = "",
  actualValue = null,
  effectiveRange = null,
  shadowRange = null,
  naiveValue = null,
  shadowReady = false,
} = {}) {
  const reasons = [];
  if (completeness?.complete !== true) reasons.push("CUTOFF_DAY_INCOMPLETE");
  if (!isValidNumericStatus(String(actualStatus || "")) || !isFiniteNumber(actualValue)) {
    reasons.push("ACTUAL_NOT_VALID");
  }
  if (!isProjectionRangeValid(effectiveRange)) reasons.push("EFFECTIVE_PROJECTION_NOT_VALID");
  if (!shadowReady || !isProjectionRangeValid(shadowRange)) reasons.push("SHADOW_V1_NOT_VALID");
  if (!isFiniteNumber(naiveValue)) reasons.push("NAIVE_CURRENT_PACE_NOT_VALID");

  return {
    metric: metric === "accrual" ? "accrual" : "cash",
    eligible: reasons.length === 0,
    reasons,
  };
}

function toPlainJson(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function buildModelMetadata(authority = {}, rows = []) {
  const model = authority?.rawModel || null;
  const phase = model?.brand?.phaseCalibration || null;
  return {
    modelTrusted: authority?.modelTrusted === true,
    trustReason: String(authority?.trustReason || ""),
    scopeReady: authority?.scopeReady === true,
    scopeReason: String(authority?.scopeReason || ""),
    schemaVersion: String(model?.schemaVersion || ""),
    semanticVersion: String(model?.semanticVersion || ""),
    strategyVersion: String(model?.strategyVersion || ""),
    kpiContractVersion: String(model?.kpiContractVersion || ""),
    modelMonth: String(model?.modelMonth || ""),
    sourceMonths: safeArray(model?.sourceMonths).map(String),
    generatedAtText: String(model?.generatedAtText || ""),
    trigger: String(model?.trigger || ""),
    excludedStoreCount: authority?.systemExcludedStoreSet instanceof Set
      ? authority.systemExcludedStoreSet.size
      : safeArray(model?.excludedStoreKeys).length,
    phaseCalibration: phase ? {
      schemaVersion: String(phase?.schemaVersion || ""),
      enabled: phase?.enabled === true,
      strategyVersion: String(phase?.strategyVersion || ""),
      sourceMonths: safeArray(phase?.sourceMonths).map(String),
      cashReliable: phase?.cash?.reliable === true,
      accrualReliable: phase?.accrual?.reliable === true,
    } : null,
    runtimePhase: {
      cash: extractRuntimePhase(rows, "cash"),
      accrual: extractRuntimePhase(rows, "accrual"),
    },
    authorityPaths: toPlainJson(authority?.authorityPaths || null),
  };
}

function buildCheckpointPayload({
  brandId,
  yearMonth,
  cutoffDate,
  checkpointKey,
  completeness,
  performance,
  authority,
  projectionContext = null,
  capturedAtText,
  readCount,
  readSources,
} = {}) {
  const overall = performance?.overall_summary || {};
  const rows = safeArray(performance?.stores_details);
  const daysInMonth = getDaysInMonth(yearMonth);
  const cutoffDay = Number(String(cutoffDate || "").slice(8, 10)) || 0;

  const cashStatus = String(overall?.cashStatus || "");
  const accrualStatus = String(overall?.accrualStatus || "");
  const cashActual = isValidNumericStatus(cashStatus) && isFiniteNumber(overall?.cash)
    ? Number(overall.cash)
    : null;
  const accrualActual = isValidNumericStatus(accrualStatus) && isFiniteNumber(overall?.accrual)
    ? Number(overall.accrual)
    : null;

  const effectiveCash = overall?.projectionRange?.cash || null;
  const effectiveAccrual = overall?.projectionRange?.accrual || null;
  const shadow = buildShadowV1Aggregate(rows);
  const naiveCash = buildNaiveCurrentPace(cashActual, cutoffDay, daysInMonth);
  const naiveAccrual = buildNaiveCurrentPace(accrualActual, cutoffDay, daysInMonth);
  const prospectiveShadow = buildProspectiveShadowCandidate({
    brandId,
    yearMonth,
    checkpointKey,
    cutoffDate,
    capturedAtText,
    context: projectionContext,
    actual: { cash: cashActual, accrual: accrualActual },
    effective: { cash: effectiveCash, accrual: effectiveAccrual },
  });

  const cashEligibility = buildScoreEligibility({
    metric: "cash",
    completeness,
    actualStatus: cashStatus,
    actualValue: cashActual,
    effectiveRange: effectiveCash,
    shadowRange: shadow.cash,
    naiveValue: naiveCash,
    shadowReady: shadow.ready,
  });
  const accrualEligibility = buildScoreEligibility({
    metric: "accrual",
    completeness,
    actualStatus: accrualStatus,
    actualValue: accrualActual,
    effectiveRange: effectiveAccrual,
    shadowRange: shadow.accrual,
    naiveValue: naiveAccrual,
    shadowReady: shadow.ready,
  });

  return {
    checkpointKey,
    brandId: String(brandId || ""),
    yearMonth: String(yearMonth || ""),
    cutoffDate: String(cutoffDate || ""),
    cutoffDay,
    daysInMonth,
    capturedAtText: String(capturedAtText || new Date().toISOString()),
    actual: {
      cash: { value: cashActual, status: cashStatus || "UNKNOWN" },
      accrual: { value: accrualActual, status: accrualStatus || "UNKNOWN" },
    },
    effective: {
      cash: isProjectionRangeValid(effectiveCash) ? toPlainJson(effectiveCash) : null,
      accrual: isProjectionRangeValid(effectiveAccrual) ? toPlainJson(effectiveAccrual) : null,
    },
    shadowV1: {
      ready: shadow.ready,
      reason: shadow.reason,
      cash: isProjectionRangeValid(shadow.cash) ? toPlainJson(shadow.cash) : null,
      accrual: isProjectionRangeValid(shadow.accrual) ? toPlainJson(shadow.accrual) : null,
    },
    naiveCurrentPace: {
      cash: naiveCash,
      accrual: naiveAccrual,
    },
    prospectiveShadow: toPlainJson(prospectiveShadow),
    model: buildModelMetadata(authority, rows),
    cutoffDayCompleteness: toPlainJson(completeness),
    scoreEligibility: {
      cash: cashEligibility,
      accrual: accrualEligibility,
      all: cashEligibility.eligible && accrualEligibility.eligible,
    },
    sourceMeta: toPlainJson(performance?.source_meta || []),
    readCount: Math.max(0, Number(readCount) || 0),
    readSources: toPlainJson(readSources || []),
  };
}

async function persistCheckpointFirstWriterWins({
  db,
  admin,
  monthlyRef,
  brandId,
  yearMonth,
  checkpointKey,
  checkpoint,
  capturedAtText,
} = {}) {
  if (!db || !admin || !monthlyRef || !checkpointKey) {
    throw new Error("projection_accuracy_persist_invalid_args");
  }

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(monthlyRef);
    const existing = snap.exists ? (snap.data() || {}) : {};
    if (existing?.checkpoints?.[checkpointKey]) {
      return {
        written: false,
        reason: "ALREADY_CAPTURED",
        checkpoint: existing.checkpoints[checkpointKey],
      };
    }

    const nowText = String(capturedAtText || new Date().toISOString());
    const patch = {
      schemaVersion: PROJECTION_ACCURACY_SCHEMA_VERSION,
      semanticVersion: PROJECTION_ACCURACY_SEMANTIC_VERSION,
      brandId: String(brandId || ""),
      yearMonth: String(yearMonth || ""),
      checkpointDays: [...PROJECTION_ACCURACY_CHECKPOINT_DAYS],
      checkpoints: {
        [checkpointKey]: checkpoint,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: nowText,
    };
    if (!snap.exists) {
      patch.createdAt = admin.firestore.FieldValue.serverTimestamp();
      patch.createdAtText = nowText;
    }

    transaction.set(monthlyRef, patch, { merge: true });
    return { written: true, reason: "CREATED", checkpoint };
  });
}


function stableJsonHash(value) {
  const json = JSON.stringify(value);
  return createHash("sha256").update(json).digest("hex");
}

function inspectVerifiedFinalActualAuthority({
  brandId = "",
  yearMonth = "",
  summaryData = {},
  summaryFlag = {},
} = {}) {
  const normalizedBrandId = String(brandId || "").trim().toLowerCase();
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  const fail = (reason) => ({ trusted: false, reason, actual: null, authority: null });

  if (!normalizedBrandId || !normalizedYearMonth) return fail("INVALID_SCOPE");
  if (String(summaryFlag?.status || "").toLowerCase() !== "verified") return fail("SUMMARY_FLAG_NOT_VERIFIED");
  if (summaryFlag?.dirty === true) return fail("SUMMARY_FLAG_DIRTY");
  if (Number(summaryFlag?.lastMismatchCount || 0) !== 0) return fail("SUMMARY_FLAG_MISMATCH");

  if (String(summaryData?.version || "") !== PROJECTION_ACCURACY_SUMMARY_VERSION) {
    return fail("SUMMARY_VERSION_MISMATCH");
  }
  if (String(summaryData?.semanticVersion || "") !== PROJECTION_ACCURACY_SUMMARY_SEMANTIC_VERSION) {
    return fail("SUMMARY_SEMANTIC_MISMATCH");
  }
  if (String(summaryData?.kpiContractVersion || "") !== KPI_CONTRACT_VERSION) {
    return fail("KPI_CONTRACT_MISMATCH");
  }
  if (String(summaryData?.brandId || "").trim().toLowerCase() !== normalizedBrandId) {
    return fail("SUMMARY_BRAND_MISMATCH");
  }
  if (normalizeYearMonth(summaryData?.yearMonth) !== normalizedYearMonth) {
    return fail("SUMMARY_MONTH_MISMATCH");
  }

  const completeness = summaryData?.reportingCompleteness || {};
  const expectedStoreDays = Math.max(0, Number(completeness?.expectedStoreDayCount || 0));
  const submittedStoreDays = Math.max(0, Number(completeness?.submittedStoreDayCount || 0));
  const missingStoreDays = Math.max(0, Number(completeness?.missingStoreDayCount || 0));
  if (
    String(completeness?.reportingStatus || "") !== "DATA_COMPLETE"
    || expectedStoreDays <= 0
    || submittedStoreDays !== expectedStoreDays
    || missingStoreDays !== 0
  ) {
    return fail("REPORTING_NOT_COMPLETE");
  }

  const lifecycle = summaryData?.lifecycleSnapshot || {};
  if (String(lifecycle?.datasetStatus || "") !== "READY") return fail("LIFECYCLE_NOT_READY");

  const summaryCalendarRevision = Math.max(0, Number(completeness?.reportingCalendarRevision || 0));
  const flagCalendarRevision = Math.max(0, Number(summaryFlag?.reportingCalendarRevision || 0));
  const requiredCalendarRevision = Math.max(
    flagCalendarRevision,
    Math.max(0, Number(summaryFlag?.requiredReportingCalendarRevision || 0))
  );
  if (
    summaryCalendarRevision !== flagCalendarRevision
    || summaryCalendarRevision < requiredCalendarRevision
  ) {
    return fail("REPORTING_CALENDAR_REVISION_MISMATCH");
  }

  const summaryExclusionRevision = Math.max(
    0,
    Number(summaryData?.systemExclusionSnapshot?.revision || 0)
  );
  const flagExclusionRevision = Math.max(0, Number(summaryFlag?.systemExclusionRevision || 0));
  if (summaryExclusionRevision !== flagExclusionRevision) {
    return fail("SYSTEM_EXCLUSION_REVISION_MISMATCH");
  }

  const grand = summaryData?.grandTotal || {};
  const cashStatus = String(grand?.formalNetCashStatus || "");
  const accrualStatus = String(grand?.formalAccrualStatus || "");
  const cashValue = isValidNumericStatus(cashStatus) && isFiniteNumber(grand?.formalNetCash)
    ? Number(grand.formalNetCash)
    : null;
  const accrualValue = isValidNumericStatus(accrualStatus) && isFiniteNumber(grand?.formalAccrual)
    ? Number(grand.formalAccrual)
    : null;
  if (cashValue === null || accrualValue === null) return fail("FORMAL_ACTUAL_NOT_VALID");

  const authority = {
    source: PROJECTION_ACCURACY_FINAL_ACTUAL_SOURCE,
    brandId: normalizedBrandId,
    yearMonth: normalizedYearMonth,
    summaryVersion: String(summaryData?.version || ""),
    summarySemanticVersion: String(summaryData?.semanticVersion || ""),
    kpiContractVersion: String(summaryData?.kpiContractVersion || ""),
    lifecycle: {
      schemaVersion: String(lifecycle?.schemaVersion || ""),
      datasetStatus: String(lifecycle?.datasetStatus || ""),
      revision: Math.max(0, Number(lifecycle?.revision || 0)),
      eligibleStoreCount: Math.max(0, Number(lifecycle?.eligibleStoreCount || 0)),
    },
    systemExclusionSnapshot: {
      version: String(summaryData?.systemExclusionSnapshot?.version || ""),
      brandId: String(summaryData?.systemExclusionSnapshot?.brandId || "").trim().toLowerCase(),
      revision: summaryExclusionRevision,
      stores: safeArray(summaryData?.systemExclusionSnapshot?.stores).map(String).sort(),
    },
    reportingCompleteness: {
      schemaVersion: String(completeness?.schemaVersion || ""),
      reportingStatus: String(completeness?.reportingStatus || ""),
      expectedStoreDayCount: expectedStoreDays,
      submittedStoreDayCount: submittedStoreDays,
      missingStoreDayCount: missingStoreDays,
      reportingCalendarMasterRevision: Math.max(
        0,
        Number(completeness?.reportingCalendarMasterRevision || 0)
      ),
      reportingCalendarRevision: summaryCalendarRevision,
      storeClosedReportDayCount: Math.max(
        0,
        Number(completeness?.storeClosedReportDayCount || 0)
      ),
    },
  };

  return {
    trusted: true,
    reason: "VERIFIED_FINAL_ACTUAL",
    actual: {
      cash: { value: cashValue, status: cashStatus },
      accrual: { value: accrualValue, status: accrualStatus },
    },
    authority,
  };
}

function buildFinalForecastScore(forecast, actual) {
  if (!isFiniteNumber(forecast) || !isFiniteNumber(actual)) {
    return { eligible: false, reason: "INVALID_FORECAST_OR_ACTUAL", score: null };
  }
  const error = Number(forecast) - Number(actual);
  const absError = Math.abs(error);
  if (!(Number(actual) > 0)) {
    return {
      eligible: false,
      reason: "ACTUAL_NOT_POSITIVE_FOR_PERCENTAGE_SCORE",
      score: {
        forecast: Math.round(Number(forecast)),
        actual: Math.round(Number(actual)),
        error: Math.round(error),
        absError: Math.round(absError),
        apePct: null,
        accuracyPctDisplay: null,
        biasPct: null,
      },
    };
  }
  const apePct = Number(((absError / Number(actual)) * 100).toFixed(4));
  const biasPct = Number(((error / Number(actual)) * 100).toFixed(4));
  return {
    eligible: true,
    reason: "SCORED",
    score: {
      forecast: Math.round(Number(forecast)),
      actual: Math.round(Number(actual)),
      error: Math.round(error),
      absError: Math.round(absError),
      apePct,
      accuracyPctDisplay: Number(Math.max(0, 100 - apePct).toFixed(4)),
      biasPct,
    },
  };
}

function buildCheckpointEvidenceSignature(checkpoints = {}) {
  const normalized = Object.fromEntries(
    Object.entries(checkpoints && typeof checkpoints === "object" ? checkpoints : {})
      .filter(([key]) => /^day(05|07|10|15|20|25)$/.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, checkpoint]) => [key, {
        cutoffDate: String(checkpoint?.cutoffDate || ""),
        capturedAtText: String(checkpoint?.capturedAtText || ""),
        scoreEligibility: toPlainJson(checkpoint?.scoreEligibility || null),
        effective: {
          cash: checkpoint?.effective?.cash?.standard ?? null,
          accrual: checkpoint?.effective?.accrual?.standard ?? null,
        },
        shadowV1: {
          ready: checkpoint?.shadowV1?.ready === true,
          cash: checkpoint?.shadowV1?.cash?.standard ?? null,
          accrual: checkpoint?.shadowV1?.accrual?.standard ?? null,
        },
        naiveCurrentPace: {
          cash: checkpoint?.naiveCurrentPace?.cash ?? null,
          accrual: checkpoint?.naiveCurrentPace?.accrual ?? null,
        },
        prospectiveShadow: {
          candidateId: String(checkpoint?.prospectiveShadow?.candidateId || ""),
          contextRevision: Math.max(0, Number(checkpoint?.prospectiveShadow?.context?.revision || 0)),
          contextHash: String(checkpoint?.prospectiveShadow?.context?.contextHash || ""),
          cash: {
            eligible: checkpoint?.prospectiveShadow?.cash?.eligible === true,
            standard: checkpoint?.prospectiveShadow?.cash?.standard ?? null,
            factor: checkpoint?.prospectiveShadow?.cash?.factor ?? null,
            reason: String(checkpoint?.prospectiveShadow?.cash?.reason || ""),
          },
          accrual: {
            eligible: checkpoint?.prospectiveShadow?.accrual?.eligible === true,
            standard: checkpoint?.prospectiveShadow?.accrual?.standard ?? null,
            factor: checkpoint?.prospectiveShadow?.accrual?.factor ?? null,
            reason: String(checkpoint?.prospectiveShadow?.accrual?.reason || ""),
          },
        },
        model: {
          strategyVersion: String(checkpoint?.model?.strategyVersion || ""),
          runtimePhase: toPlainJson(checkpoint?.model?.runtimePhase || null),
        },
      }])
  );
  return stableJsonHash(normalized);
}

function buildMethodScoreForCheckpoint(checkpoint = {}, metric = "cash", method = "effective", actual = null) {
  const metricEligibility = checkpoint?.scoreEligibility?.[metric] || {};
  if (metricEligibility?.eligible !== true) {
    return {
      eligible: false,
      reason: "CHECKPOINT_NOT_SCORE_ELIGIBLE",
      checkpointReasons: safeArray(metricEligibility?.reasons).map(String),
      score: null,
    };
  }

  let forecast = null;
  if (method === "effective") forecast = checkpoint?.effective?.[metric]?.standard;
  else if (method === "shadowV1") {
    if (checkpoint?.shadowV1?.ready !== true) {
      return { eligible: false, reason: "SHADOW_V1_NOT_READY", score: null };
    }
    forecast = checkpoint?.shadowV1?.[metric]?.standard;
  } else if (method === "currentPace") {
    forecast = checkpoint?.naiveCurrentPace?.[metric];
  }

  return buildFinalForecastScore(forecast, actual);
}

function summarizeFinalScores(states = []) {
  const scores = safeArray(states)
    .filter((state) => state?.eligible === true && state?.score)
    .map((state) => state.score);
  const actualSum = scores.reduce((sum, row) => sum + Number(row.actual || 0), 0);
  const absErrorSum = scores.reduce((sum, row) => sum + Number(row.absError || 0), 0);
  const errorSum = scores.reduce((sum, row) => sum + Number(row.error || 0), 0);
  return {
    count: scores.length,
    actualSum: Math.round(actualSum),
    absErrorSum: Math.round(absErrorSum),
    errorSum: Math.round(errorSum),
    wapePct: actualSum > 0 ? Number(((absErrorSum / actualSum) * 100).toFixed(4)) : null,
    biasPct: actualSum > 0 ? Number(((errorSum / actualSum) * 100).toFixed(4)) : null,
    meanApePct: scores.length
      ? Number((scores.reduce((sum, row) => sum + Number(row.apePct || 0), 0) / scores.length).toFixed(4))
      : null,
  };
}

function buildMonthFinalScorecard({
  checkpoints = {},
  finalActual = {},
} = {}) {
  const byCheckpoint = {};
  const aggregateStates = {
    cash: { effective: [], shadowV1: [], currentPace: [], effectiveV2AppliedOnly: [] },
    accrual: { effective: [], shadowV1: [], currentPace: [], effectiveV2AppliedOnly: [] },
  };

  for (const [checkpointKey, checkpoint] of Object.entries(checkpoints || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^day(05|07|10|15|20|25)$/.test(checkpointKey)) continue;
    const row = {
      checkpointKey,
      cutoffDate: String(checkpoint?.cutoffDate || ""),
      cutoffDay: Math.max(0, Number(checkpoint?.cutoffDay || 0)),
      model: {
        strategyVersion: String(checkpoint?.model?.strategyVersion || ""),
        runtimePhase: toPlainJson(checkpoint?.model?.runtimePhase || null),
      },
      cash: {},
      accrual: {},
    };

    for (const metric of ["cash", "accrual"]) {
      const actual = finalActual?.[metric]?.value;
      for (const method of ["effective", "shadowV1", "currentPace"]) {
        const state = buildMethodScoreForCheckpoint(checkpoint, metric, method, actual);
        row[metric][method] = state;
        aggregateStates[metric][method].push(state);
      }
      if (
        checkpoint?.model?.runtimePhase?.[metric]?.phaseApplied === true
        && row[metric].effective?.eligible === true
      ) {
        aggregateStates[metric].effectiveV2AppliedOnly.push(row[metric].effective);
      }
    }
    byCheckpoint[checkpointKey] = row;
  }

  const overall = {};
  for (const metric of ["cash", "accrual"]) {
    overall[metric] = {};
    for (const method of ["effective", "shadowV1", "currentPace", "effectiveV2AppliedOnly"]) {
      overall[metric][method] = summarizeFinalScores(aggregateStates[metric][method]);
    }
  }

  return { byCheckpoint, overall };
}


function normalizeHistoryMethodState(state = null, { brandId = "", metric = "cash" } = {}) {
  const normalizedBrandId = String(brandId || "").trim().toLowerCase();
  const normalizedMetric = metric === "accrual" ? "accrual" : "cash";
  const baseline = Number(PROJECTION_ACCURACY_HISTORY_WEIGHT_BASELINES?.[normalizedBrandId]?.[normalizedMetric] || 0);
  const score = state?.score && typeof state.score === "object" ? state.score : null;
  if (
    state?.eligible !== true
    || !score
    || !(baseline > 0)
    || !isFiniteNumber(score.actual)
    || !isFiniteNumber(score.error)
    || !isFiniteNumber(score.absError)
    || !(Number(score.actual) > 0)
  ) {
    return {
      eligible: false,
      actualWeight: null,
      errorWeight: null,
      absErrorWeight: null,
    };
  }
  return {
    eligible: true,
    actualWeight: Number((Number(score.actual) / baseline).toFixed(12)),
    errorWeight: Number((Number(score.error) / baseline).toFixed(12)),
    absErrorWeight: Number((Number(score.absError) / baseline).toFixed(12)),
  };
}

function buildProjectionAccuracyHistoryMonth({
  brandId = "",
  yearMonth = "",
  scorecard = null,
  scoreRevision = 0,
  inputSignature = "",
  scoredAtText = "",
} = {}) {
  const normalizedBrandId = String(brandId || "").trim().toLowerCase();
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (
    !PROJECTION_ACCURACY_HISTORY_BRANDS.includes(normalizedBrandId)
    || !normalizedYearMonth
    || !scorecard
    || typeof scorecard !== "object"
  ) {
    return { complete: false, reason: "INVALID_HISTORY_SCOPE", month: null };
  }

  const byCheckpoint = scorecard?.byCheckpoint && typeof scorecard.byCheckpoint === "object"
    ? scorecard.byCheckpoint
    : {};
  const expectedKeys = PROJECTION_ACCURACY_CHECKPOINT_DAYS
    .map((day) => `day${String(day).padStart(2, "0")}`);
  const checkpoints = {};

  for (const checkpointKey of expectedKeys) {
    const source = byCheckpoint[checkpointKey];
    if (!source || typeof source !== "object") {
      return { complete: false, reason: `MISSING_${checkpointKey.toUpperCase()}`, month: null };
    }

    const cutoffDay = Math.max(0, Number(source?.cutoffDay || 0));
    const expectedDay = Number(checkpointKey.replace("day", ""));
    if (cutoffDay !== expectedDay) {
      return { complete: false, reason: `CHECKPOINT_DAY_MISMATCH:${checkpointKey}`, month: null };
    }

    const row = {
      cutoffDay,
      cutoffDate: String(source?.cutoffDate || ""),
      phaseApplied: {
        cash: source?.model?.runtimePhase?.cash?.phaseApplied === true,
        accrual: source?.model?.runtimePhase?.accrual?.phaseApplied === true,
      },
      cash: {},
      accrual: {},
    };

    for (const metric of ["cash", "accrual"]) {
      // Historical V2 comparison may only label the effective method as
      // "智慧校正推估" when phase calibration actually ran at this checkpoint.
      if (row.phaseApplied[metric] !== true) {
        return { complete: false, reason: `PHASE_NOT_APPLIED:${checkpointKey}:${metric}`, month: null };
      }
      for (const method of ["effective", "shadowV1", "currentPace"]) {
        const state = normalizeHistoryMethodState(source?.[metric]?.[method], {
          brandId: normalizedBrandId,
          metric,
        });
        if (state.eligible !== true) {
          return {
            complete: false,
            reason: `METHOD_NOT_COMPARABLE:${checkpointKey}:${metric}:${method}`,
            month: null,
          };
        }
        row[metric][method] = state;
      }
    }
    checkpoints[checkpointKey] = row;
  }

  return {
    complete: true,
    reason: "COMPLETE",
    month: {
      brandId: normalizedBrandId,
      yearMonth: normalizedYearMonth,
      evidenceType: "live_checkpoint",
      comparisonMode: PROJECTION_ACCURACY_HISTORY_COMPARISON_MODE,
      statisticsVersion: PROJECTION_ACCURACY_HISTORY_STATISTICS_VERSION,
      complete: true,
      scoreSemanticVersion: PROJECTION_ACCURACY_SCORE_SEMANTIC_VERSION,
      scoreRevision: Math.max(0, Number(scoreRevision || 0)),
      inputSignature: String(inputSignature || ""),
      scoredAtText: String(scoredAtText || ""),
      checkpoints,
    },
  };
}

function buildProjectionAccuracyHistoryDocument({
  existing = {},
  brandId = "",
  year = "",
  month = null,
  updatedAtText = "",
} = {}) {
  const normalizedBrandId = String(brandId || "").trim().toLowerCase();
  const normalizedYear = String(year || "").trim();
  if (
    !PROJECTION_ACCURACY_HISTORY_BRANDS.includes(normalizedBrandId)
    || !/^\d{4}$/.test(normalizedYear)
    || !month
    || typeof month !== "object"
  ) {
    throw new Error("projection_accuracy_history_invalid_args");
  }
  if (String(month.yearMonth || "").slice(0, 4) !== normalizedYear) {
    throw new Error("projection_accuracy_history_year_mismatch");
  }
  if (String(month.comparisonMode || "") !== PROJECTION_ACCURACY_HISTORY_COMPARISON_MODE) {
    throw new Error("projection_accuracy_history_mode_mismatch");
  }

  const existingBrandId = String(existing?.brandId || "").trim().toLowerCase();
  const existingYear = String(existing?.year || "").trim();
  const existingSchema = String(existing?.schemaVersion || "");
  const existingMode = String(existing?.comparisonMode || "");
  const existingStatisticsVersion = String(existing?.statisticsVersion || "");
  if (existingBrandId && existingBrandId !== normalizedBrandId) {
    throw new Error("projection_accuracy_history_brand_mismatch");
  }
  if (existingYear && existingYear !== normalizedYear) {
    throw new Error("projection_accuracy_history_existing_year_mismatch");
  }
  if (existingSchema && existingSchema !== PROJECTION_ACCURACY_HISTORY_SCHEMA_VERSION) {
    throw new Error("projection_accuracy_history_schema_mismatch");
  }
  if (existingMode && existingMode !== PROJECTION_ACCURACY_HISTORY_COMPARISON_MODE) {
    throw new Error("projection_accuracy_history_existing_mode_mismatch");
  }
  if (existingStatisticsVersion && existingStatisticsVersion !== PROJECTION_ACCURACY_HISTORY_STATISTICS_VERSION) {
    throw new Error("projection_accuracy_history_statistics_mismatch");
  }

  const months = existing?.months && typeof existing.months === "object"
    ? { ...existing.months }
    : {};
  const currentMonth = months[month.yearMonth];
  const currentRevision = Math.max(0, Number(currentMonth?.scoreRevision || 0));
  const nextRevision = Math.max(0, Number(month.scoreRevision || 0));
  const currentSignature = String(currentMonth?.inputSignature || "");
  const nextSignature = String(month.inputSignature || "");

  if (currentRevision > nextRevision) {
    throw new Error("projection_accuracy_history_revision_ahead");
  }
  if (currentRevision === nextRevision && currentMonth) {
    if (currentSignature !== nextSignature) {
      throw new Error("projection_accuracy_history_same_revision_signature_mismatch");
    }
    return { changed: false, document: existing };
  }

  months[month.yearMonth] = month;
  const monthKeys = Object.keys(months).filter(normalizeYearMonth).sort();
  return {
    changed: true,
    document: {
      schemaVersion: PROJECTION_ACCURACY_HISTORY_SCHEMA_VERSION,
      comparisonMode: PROJECTION_ACCURACY_HISTORY_COMPARISON_MODE,
      statisticsVersion: PROJECTION_ACCURACY_HISTORY_STATISTICS_VERSION,
      brandId: normalizedBrandId,
      year: normalizedYear,
      monthCount: monthKeys.length,
      availableMonths: monthKeys,
      months,
      updatedAtText: String(updatedAtText || new Date().toISOString()),
    },
  };
}

async function persistVerifiedMonthScore({
  db,
  admin,
  monthlyRef,
  summaryRef,
  flagRef,
  historyRef = null,
  brandId,
  yearMonth,
  scoredAtText = "",
} = {}) {
  if (!db || !admin || !monthlyRef || !summaryRef || !flagRef) {
    throw new Error("projection_accuracy_score_persist_invalid_args");
  }

  return db.runTransaction(async (transaction) => {
    // Read checkpoint evidence first. Most historical months before B1 have no live
    // checkpoint document, so they exit after one point read without touching Summary.
    const monthlySnap = await transaction.get(monthlyRef);
    if (!monthlySnap.exists) {
      return { written: false, reason: "NO_CHECKPOINT_DOCUMENT", scoreRevision: 0 };
    }

    const existing = monthlySnap.data() || {};
    const checkpoints = existing?.checkpoints && typeof existing.checkpoints === "object"
      ? existing.checkpoints
      : {};
    const checkpointKeys = Object.keys(checkpoints)
      .filter((key) => /^day(05|07|10|15|20|25)$/.test(key))
      .sort();
    if (!checkpointKeys.length) {
      return { written: false, reason: "NO_CHECKPOINTS", scoreRevision: 0 };
    }

    // Summary + flag are read inside the same transaction. If a concurrent repair marks
    // the month dirty or publishes a newer Summary, Firestore retries this transaction
    // and trust is re-evaluated before any Accuracy write can commit.
    const flagSnap = await transaction.get(flagRef);
    const summarySnap = await transaction.get(summaryRef);
    if (!flagSnap.exists || !summarySnap.exists) {
      return { written: false, reason: "VERIFIED_SUMMARY_MISSING", scoreRevision: 0 };
    }

    const trust = inspectVerifiedFinalActualAuthority({
      brandId,
      yearMonth,
      summaryData: summarySnap.data() || {},
      summaryFlag: flagSnap.data() || {},
    });
    if (!trust.trusted) {
      return {
        written: false,
        reason: `SUMMARY_NOT_TRUSTED:${trust.reason}`,
        scoreRevision: Math.max(0, Number(existing?.scoreMeta?.scoreRevision || 0)),
      };
    }

    const checkpointEvidenceSignature = buildCheckpointEvidenceSignature(checkpoints);
    const finalActualAuthoritySignature = stableJsonHash(trust.authority);
    const inputSignature = stableJsonHash({
      checkpointEvidenceSignature,
      finalActualAuthoritySignature,
      finalActual: trust.actual,
    });

    const alreadyCurrent = String(existing?.scoreMeta?.inputSignature || "") === inputSignature;
    const existingRevision = Math.max(0, Number(existing?.scoreMeta?.scoreRevision || 0));
    const scorecard = alreadyCurrent
      ? (existing?.scorecard && typeof existing.scorecard === "object" ? existing.scorecard : null)
      : buildMonthFinalScorecard({
          checkpoints,
          finalActual: trust.actual,
        });
    if (!scorecard) {
      return {
        written: false,
        reason: "CURRENT_SCORECARD_MISSING",
        scoreRevision: existingRevision,
        inputSignature,
      };
    }

    const nowText = String(scoredAtText || new Date().toISOString());
    const scoreRevision = alreadyCurrent ? existingRevision : existingRevision + 1;
    let historyResult = { written: false, reason: "HISTORY_NOT_APPLICABLE" };
    let historyMeta = existing?.historyMeta && typeof existing.historyMeta === "object"
      ? { ...existing.historyMeta }
      : null;

    if (historyRef && PROJECTION_ACCURACY_HISTORY_BRANDS.includes(String(brandId || "").trim().toLowerCase())) {
      const historyMonthResult = buildProjectionAccuracyHistoryMonth({
        brandId,
        yearMonth,
        scorecard,
        scoreRevision,
        inputSignature,
        scoredAtText: String(existing?.scoreMeta?.scoredAtText || nowText),
      });
      const historyAlreadySynced = Boolean(
        historyMonthResult.complete === true
        && historyMeta?.synced === true
        && String(historyMeta?.inputSignature || "") === inputSignature
        && Math.max(0, Number(historyMeta?.scoreRevision || 0)) === scoreRevision
        && String(historyMeta?.statisticsVersion || "") === PROJECTION_ACCURACY_HISTORY_STATISTICS_VERSION
      );

      if (historyAlreadySynced) {
        historyResult = { written: false, reason: "HISTORY_ALREADY_SYNCED" };
      } else if (historyMonthResult.complete === true && historyMonthResult.month) {
        // The yearly compact history summary participates in the same Firestore
        // transaction as the monthly score. Concurrent score revisions therefore
        // retry against the newest year document instead of losing another month.
        // For an already-current pre-B2C.1 score, this is a one-time self-heal read.
        const historySnap = await transaction.get(historyRef);
        const historyDocResult = buildProjectionAccuracyHistoryDocument({
          existing: historySnap.exists ? (historySnap.data() || {}) : {},
          brandId,
          year: String(yearMonth).slice(0, 4),
          month: historyMonthResult.month,
          updatedAtText: nowText,
        });
        if (historyDocResult.changed) {
          transaction.set(historyRef, {
            ...historyDocResult.document,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          historyResult = { written: true, reason: "HISTORY_UPDATED" };
        } else {
          historyResult = { written: false, reason: "HISTORY_ALREADY_CURRENT" };
        }
        historyMeta = {
          schemaVersion: PROJECTION_ACCURACY_HISTORY_SCHEMA_VERSION,
          statisticsVersion: PROJECTION_ACCURACY_HISTORY_STATISTICS_VERSION,
          comparisonMode: PROJECTION_ACCURACY_HISTORY_COMPARISON_MODE,
          year: String(yearMonth).slice(0, 4),
          scoreRevision,
          inputSignature,
          synced: true,
          syncedAtText: nowText,
        };
      } else {
        historyResult = { written: false, reason: historyMonthResult.reason || "HISTORY_NOT_COMPLETE" };
        historyMeta = {
          schemaVersion: PROJECTION_ACCURACY_HISTORY_SCHEMA_VERSION,
          statisticsVersion: PROJECTION_ACCURACY_HISTORY_STATISTICS_VERSION,
          comparisonMode: PROJECTION_ACCURACY_HISTORY_COMPARISON_MODE,
          year: String(yearMonth).slice(0, 4),
          scoreRevision,
          inputSignature,
          synced: false,
          reason: historyResult.reason,
          syncedAtText: nowText,
        };
      }
    }

    if (alreadyCurrent) {
      const existingHistorySignature = stableJsonHash(existing?.historyMeta || null);
      const nextHistorySignature = stableJsonHash(historyMeta || null);
      if (existingHistorySignature !== nextHistorySignature) {
        transaction.set(monthlyRef, {
          historyMeta,
          historyUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          historyUpdatedAtText: nowText,
        }, { merge: true });
      }
      return {
        written: false,
        reason: "ALREADY_CURRENT",
        scoreRevision,
        inputSignature,
        history: historyResult,
      };
    }

    transaction.set(monthlyRef, {
      finalActual: {
        source: PROJECTION_ACCURACY_FINAL_ACTUAL_SOURCE,
        cash: trust.actual.cash,
        accrual: trust.actual.accrual,
        authority: trust.authority,
      },
      scorecard,
      scoreMeta: {
        semanticVersion: PROJECTION_ACCURACY_SCORE_SEMANTIC_VERSION,
        scoreRevision,
        checkpointEvidenceSignature,
        finalActualAuthoritySignature,
        inputSignature,
        scoredAtText: nowText,
      },
      historyMeta,
      scoreUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      scoreUpdatedAtText: nowText,
    }, { merge: true });

    return {
      written: true,
      reason: "SCORED",
      scoreRevision,
      inputSignature,
      checkpointCount: checkpointKeys.length,
      scorecard,
      history: historyResult,
    };
  });
}

function createProjectionAccuracyFunctions({
  admin,
  db,
  getStorePerformance,
  loadProjectionAuthority,
  createAgentContext,
  getBrandCollection,
  normalizeStoreKey,
} = {}) {
  if (
    !admin
    || !db
    || typeof getStorePerformance !== "function"
    || typeof loadProjectionAuthority !== "function"
    || typeof createAgentContext !== "function"
    || typeof getBrandCollection !== "function"
    || typeof normalizeStoreKey !== "function"
  ) {
    throw new Error("projection_accuracy_dependencies_missing");
  }

  async function captureBrandCheckpoint({ brandId, cutoffDate, yearMonth, checkpointKey, capturedAtText }) {
    const ctx = createAgentContext({
      chatId: `projectionAccuracy:${brandId}`,
      userId: "projectionAccuracy",
      question: `Projection Accuracy checkpoint ${brandId} ${cutoffDate}`,
    });

    // Accuracy is system evidence, not a Telegram conversation. A fresh context
    // intentionally has no Telegram policy state, and policyScopes=[] prevents
    // conversational exclusions from entering formal checkpoint evidence.
    const authority = await loadProjectionAuthority(brandId, yearMonth, ctx);

    const dailyRef = getBrandCollection(brandId, "daily_reports");
    const exactDaySnap = await dailyRef.where("date", "==", cutoffDate).get();
    recordLocalRead(ctx, Math.max(1, exactDaySnap.size), "projection_accuracy_cutoff_day_reports", {
      brandId,
      yearMonth,
    });
    const exactDayRows = exactDaySnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() || {}),
    }));

    const completeness = buildCutoffDayCompleteness({
      authority,
      rows: exactDayRows,
      cutoffDate,
      normalizeStoreKey,
    });

    const monthStart = `${yearMonth}-01`;
    const performance = await getStorePerformance(
      monthStart,
      cutoffDate,
      null,
      brandId,
      ctx,
      []
    );

    let projectionContext = null;
    if (String(brandId || "").trim().toLowerCase() === "cyj") {
      const contextRef = getBrandCollection(brandId, PROJECTION_CONTEXT_COLLECTION).doc(yearMonth);
      const contextSnap = await contextRef.get();
      recordLocalRead(ctx, 1, "projection_accuracy_projection_context", {
        brandId,
        yearMonth,
        updatedAtText: contextSnap.exists ? String(contextSnap.data()?.updatedAtText || "") : "",
      });
      projectionContext = contextSnap.exists ? (contextSnap.data() || {}) : null;
    }

    const checkpoint = buildCheckpointPayload({
      brandId,
      yearMonth,
      cutoffDate,
      checkpointKey,
      completeness,
      performance,
      authority,
      projectionContext,
      capturedAtText,
      readCount: ctx.readCount,
      readSources: ctx.sources,
    });

    const monthlyRef = getBrandCollection(brandId, PROJECTION_ACCURACY_COLLECTION).doc(yearMonth);
    const persisted = await persistCheckpointFirstWriterWins({
      db,
      admin,
      monthlyRef,
      brandId,
      yearMonth,
      checkpointKey,
      checkpoint,
      capturedAtText,
    });

    return {
      brandId,
      checkpointKey,
      written: persisted.written,
      reason: persisted.reason,
      scoreEligible: checkpoint.scoreEligibility.all,
      readCount: checkpoint.readCount,
      completeness: checkpoint.cutoffDayCompleteness.complete,
    };
  }


  async function scoreProjectionAccuracyMonthFromVerifiedSummary({ brandId, yearMonth } = {}) {
    const normalizedBrandId = String(brandId || "").trim().toLowerCase();
    const normalizedYearMonth = normalizeYearMonth(yearMonth);
    if (!PROJECTION_ACCURACY_BRANDS.includes(normalizedBrandId) || !normalizedYearMonth) {
      return { written: false, reason: "INVALID_SCORE_SCOPE", scoreRevision: 0 };
    }

    return persistVerifiedMonthScore({
      db,
      admin,
      monthlyRef: getBrandCollection(normalizedBrandId, PROJECTION_ACCURACY_COLLECTION).doc(normalizedYearMonth),
      summaryRef: getBrandCollection(normalizedBrandId, "dashboard_summary").doc(normalizedYearMonth),
      flagRef: getBrandCollection(normalizedBrandId, "summary_recalc_flags").doc(normalizedYearMonth),
      historyRef: PROJECTION_ACCURACY_HISTORY_BRANDS.includes(normalizedBrandId)
        ? getBrandCollection(normalizedBrandId, PROJECTION_ACCURACY_HISTORY_COLLECTION).doc(normalizedYearMonth.slice(0, 4))
        : null,
      brandId: normalizedBrandId,
      yearMonth: normalizedYearMonth,
    });
  }

  const captureProjectionAccuracyCheckpoint = onSchedule({
    schedule: PROJECTION_ACCURACY_SCHEDULE,
    timeZone: PROJECTION_ACCURACY_TIME_ZONE,
    timeoutSeconds: 540,
    memory: "1GiB",
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
  }, async () => {
    const scheduled = resolveScheduledCheckpoint(new Date());
    if (!scheduled.isCheckpoint) {
      console.log(`Projection Accuracy skip: cutoff ${scheduled.cutoffDate} is not a checkpoint day`);
      return {
        skipped: true,
        cutoffDate: scheduled.cutoffDate,
        reason: "NON_CHECKPOINT_DAY",
      };
    }

    const capturedAtText = new Date().toISOString();
    const results = [];
    const errors = [];

    for (const brandId of PROJECTION_ACCURACY_BRANDS) {
      try {
        const result = await captureBrandCheckpoint({
          brandId,
          cutoffDate: scheduled.cutoffDate,
          yearMonth: scheduled.yearMonth,
          checkpointKey: scheduled.checkpointKey,
          capturedAtText,
        });
        results.push(result);
        console.log(
          `Projection Accuracy ${brandId}/${scheduled.checkpointKey} written=${result.written} eligible=${result.scoreEligible} reads=${result.readCount}`
        );
      } catch (error) {
        const detail = {
          brandId,
          message: String(error?.message || error),
          code: String(error?.code || ""),
        };
        errors.push(detail);
        console.error(`Projection Accuracy ${brandId}/${scheduled.checkpointKey} failed`, error);
      }
    }

    if (errors.length) {
      const error = new Error(`projection_accuracy_partial_failure:${JSON.stringify(errors)}`);
      error.code = "PROJECTION_ACCURACY_PARTIAL_FAILURE";
      throw error;
    }

    return {
      skipped: false,
      cutoffDate: scheduled.cutoffDate,
      checkpointKey: scheduled.checkpointKey,
      results,
    };
  });

  return {
    captureProjectionAccuracyCheckpoint,
    captureBrandCheckpoint,
    scoreProjectionAccuracyMonthFromVerifiedSummary,
  };
}

module.exports = {
  PROJECTION_ACCURACY_SCHEMA_VERSION,
  PROJECTION_ACCURACY_SEMANTIC_VERSION,
  PROJECTION_ACCURACY_COLLECTION,
  PROJECTION_ACCURACY_BRANDS,
  PROJECTION_ACCURACY_CHECKPOINT_DAYS,
  PROJECTION_ACCURACY_SCHEDULE,
  PROJECTION_ACCURACY_TIME_ZONE,
  PROJECTION_ACCURACY_SCORE_SEMANTIC_VERSION,
  PROJECTION_ACCURACY_FINAL_ACTUAL_SOURCE,
  PROJECTION_ACCURACY_SUMMARY_VERSION,
  PROJECTION_ACCURACY_SUMMARY_SEMANTIC_VERSION,
  PROJECTION_ACCURACY_HISTORY_COLLECTION,
  PROJECTION_ACCURACY_HISTORY_SCHEMA_VERSION,
  PROJECTION_ACCURACY_HISTORY_COMPARISON_MODE,
  PROJECTION_ACCURACY_HISTORY_BRANDS,
  PROJECTION_ACCURACY_HISTORY_STATISTICS_VERSION,
  getTaipeiIsoDate,
  shiftIsoDate,
  resolveScheduledCheckpoint,
  getDaysInMonth,
  recordLocalRead,
  buildCutoffDayCompleteness,
  cloneRowsForShadowV1,
  buildShadowV1Aggregate,
  buildNaiveCurrentPace,
  isProjectionRangeValid,
  extractRuntimePhase,
  buildScoreEligibility,
  buildModelMetadata,
  buildCheckpointPayload,
  persistCheckpointFirstWriterWins,
  stableJsonHash,
  inspectVerifiedFinalActualAuthority,
  buildFinalForecastScore,
  buildCheckpointEvidenceSignature,
  buildMethodScoreForCheckpoint,
  summarizeFinalScores,
  buildMonthFinalScorecard,
  normalizeHistoryMethodState,
  buildProjectionAccuracyHistoryMonth,
  buildProjectionAccuracyHistoryDocument,
  persistVerifiedMonthScore,
  createProjectionAccuracyFunctions,
};
