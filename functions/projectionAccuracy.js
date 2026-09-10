"use strict";

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { isLifecycleEntryExpectedForDate } = require("./storeLifecycle");
const { aggregateTelegramProjectionRows } = require("./telegram/projectionConsumer");
const { isValidNumericStatus } = require("./telegram/formalKpi");

const PROJECTION_ACCURACY_SCHEMA_VERSION = "projection-accuracy-v1";
const PROJECTION_ACCURACY_SEMANTIC_VERSION = "projection-accuracy-checkpoint-v1";
const PROJECTION_ACCURACY_COLLECTION = "projection_accuracy";
const PROJECTION_ACCURACY_BRANDS = Object.freeze(["cyj", "anniu", "yibo"]);
const PROJECTION_ACCURACY_CHECKPOINT_DAYS = Object.freeze([5, 7, 10, 15, 20, 25]);
const PROJECTION_ACCURACY_SCHEDULE = "10 7 * * *";
const PROJECTION_ACCURACY_TIME_ZONE = "Asia/Taipei";
const PROJECTION_ACCURACY_MAX_STORE_ROWS = 80;

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

    const checkpoint = buildCheckpointPayload({
      brandId,
      yearMonth,
      cutoffDate,
      checkpointKey,
      completeness,
      performance,
      authority,
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
  createProjectionAccuracyFunctions,
};
