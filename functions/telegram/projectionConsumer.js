"use strict";

const { KPI_CONTRACT_VERSION } = require("../kpiContracts");
const {
  getLifecycleEligibleStoreEntries,
  isLifecycleEntryExpectedForDate,
  normalizeReportingCalendar,
  normalizeStoreLifecycleCore,
} = require("../storeLifecycle");
const {
  normalizeStoredSystemExclusionProfile,
  isStoredSystemExclusionSnapshotCurrent,
} = require("../systemExclusionContract");

const PROJECTION_MODEL_SCHEMA_VERSION = "projection-model-v1";
const PROJECTION_SEMANTIC_VERSION = "projection-semantic-v1";
const PROJECTION_MODEL_DOC_ID = "current";
const PROJECTION_SOURCE_MONTH_COUNT = 3;
const PROJECTION_MIN_PHASE_SOURCE_MONTHS = 3;
const PROJECTION_PHASE_MIN_DAYS_PASSED = 5;
const PROJECTION_STRATEGY_V1 = "projection-strategy-v1-weekday";
const PROJECTION_STRATEGY_V2 = "projection-strategy-v2-phase-calibrated";
const PROJECTION_PHASE_SCHEMA_VERSION = "projection-phase-v1";
const PROJECTION_V2_BRANDS = Object.freeze(["cyj", "anniu"]);

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function normalizeProjectionYearMonth(value = "") {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
}

function normalizeProjectionBrandId(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (["cyj", "drcyj", "default", "default-app-id"].includes(text)) return "cyj";
  if (["anniu", "anew", "安妞"].includes(text)) return "anniu";
  if (["yibo", "伊啵"].includes(text)) return "yibo";
  return "";
}

function shiftProjectionYearMonth(yearMonth = "", deltaMonths = 0) {
  const normalized = normalizeProjectionYearMonth(yearMonth);
  if (!normalized) return "";
  const [year, month] = normalized.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + Number(deltaMonths || 0), 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getExpectedProjectionSourceMonths(modelMonth = "") {
  const normalized = normalizeProjectionYearMonth(modelMonth);
  if (!normalized) return [];
  return Array.from({ length: PROJECTION_SOURCE_MONTH_COUNT }, (_, index) =>
    shiftProjectionYearMonth(normalized, -(PROJECTION_SOURCE_MONTH_COUNT - index))
  );
}

function getProjectionBlendProfile(daysPassed = 0, daysInMonth = 0) {
  if (!daysPassed || !daysInMonth) {
    return { currentWeight: 0.5, historyWeight: 0.5, label: "資料不足" };
  }

  const progress = daysPassed / daysInMonth;
  if (daysPassed <= 5 || progress <= 0.18) {
    return { currentWeight: 0.3, historyWeight: 0.7, label: "月初：偏歷史節奏" };
  }
  if (progress <= 0.5) {
    return { currentWeight: 0.5, historyWeight: 0.5, label: "月中：本月與歷史均衡" };
  }
  if (progress <= 0.8) {
    return { currentWeight: 0.7, historyWeight: 0.3, label: "月中後：偏本月實際" };
  }
  return { currentWeight: 0.85, historyWeight: 0.15, label: "月底：高度依本月實際" };
}

function buildProjectionRangePayload({
  currentTotal = 0,
  remainingConservative = 0,
  remainingStandard = 0,
  remainingAggressive = 0,
} = {}) {
  const rawConservative = Math.round(safeNumber(currentTotal) + safeNumber(remainingConservative));
  const standard = Math.round(safeNumber(currentTotal) + safeNumber(remainingStandard));
  const rawAggressive = Math.round(safeNumber(currentTotal) + safeNumber(remainingAggressive));
  const conservative = Math.min(rawConservative, standard, rawAggressive);
  const aggressive = Math.max(rawConservative, standard, rawAggressive);

  return {
    conservative,
    standard,
    aggressive,
    min: conservative,
    max: aggressive,
    rawConservative,
    rawAggressive,
  };
}

const getProjectionPhasePoint = (curve = {}, day = 0) => {
  const point = curve?.points?.[day] ?? curve?.points?.[String(day)] ?? null;
  if (!point || typeof point !== "object") return null;

  const sampleCount = Math.max(0, Number(point.sampleCount || 0));
  const cumulativeShare = point.cumulativeShare;
  const reliable = point.reliable === true
    && sampleCount >= PROJECTION_MIN_PHASE_SOURCE_MONTHS
    && isFiniteNumber(cumulativeShare)
    && Number(cumulativeShare) > 0;

  return {
    sampleCount,
    reliable,
    cumulativeShare: reliable ? Number(cumulativeShare) : null,
  };
};

const resolveProjectionPhaseCalibration = ({
  model = null,
  metric = "cash",
  daysPassed = 0,
  daysInMonth = 0,
  scopeEligible = true,
} = {}) => {
  const brandId = normalizeProjectionBrandId(model?.brandId || "");
  const normalizedMetric = metric === "accrual" ? "accrual" : "cash";
  const calendarProgress = daysInMonth > 0
    ? Math.max(0, Number(daysPassed || 0)) / Number(daysInMonth)
    : 0;
  const fail = (reason) => ({
    applied: false,
    reason,
    brandId,
    metric: normalizedMetric,
    multiplier: 1,
    cumulativeShare: null,
    calendarProgress,
    sampleCount: 0,
  });

  if (scopeEligible !== true) return fail("SCOPE_PHASE_DISABLED");
  if (!PROJECTION_V2_BRANDS.includes(brandId)) return fail("BRAND_V1");
  if (String(model?.strategyVersion || "") !== PROJECTION_STRATEGY_V2) return fail("STRATEGY_V1");
  if (!daysPassed || !daysInMonth) return fail("INVALID_PROGRESS");
  if (daysPassed < PROJECTION_PHASE_MIN_DAYS_PASSED) return fail("BEFORE_VALIDATED_CHECKPOINT");
  if (daysPassed >= daysInMonth) return fail("MONTH_COMPLETE");

  const phase = model?.brand?.phaseCalibration || null;
  if (!phase || String(phase.schemaVersion || "") !== PROJECTION_PHASE_SCHEMA_VERSION) {
    return fail("PHASE_MODEL_MISSING");
  }
  if (phase.enabled !== true) return fail("PHASE_DISABLED");
  if (normalizeProjectionBrandId(phase.brandId) !== brandId) return fail("PHASE_BRAND_MISMATCH");
  if (String(phase.strategyVersion || "") !== PROJECTION_STRATEGY_V2) {
    return fail("PHASE_STRATEGY_MISMATCH");
  }

  const modelMonths = Array.isArray(model?.sourceMonths) ? model.sourceMonths : [];
  const phaseMonths = Array.isArray(phase?.sourceMonths) ? phase.sourceMonths : [];
  if (JSON.stringify(modelMonths) !== JSON.stringify(phaseMonths)) {
    return fail("PHASE_SOURCE_MONTHS_MISMATCH");
  }

  const curve = phase?.[normalizedMetric] || null;
  if (!curve || curve.reliable !== true) return fail("PHASE_CURVE_UNRELIABLE");
  const point = getProjectionPhasePoint(curve, daysPassed);
  if (!point?.reliable) return fail("PHASE_POINT_UNRELIABLE");

  const multiplier = calendarProgress / point.cumulativeShare;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return fail("PHASE_MULTIPLIER_INVALID");

  return {
    applied: true,
    reason: "PHASE_CALIBRATED",
    brandId,
    metric: normalizedMetric,
    multiplier,
    cumulativeShare: point.cumulativeShare,
    calendarProgress,
    sampleCount: point.sampleCount,
  };
};

const calibrateProjectionRange = ({
  range = null,
  currentTotal = 0,
  multiplier = 1,
} = {}) => {
  if (!range || typeof range !== "object") return range;

  const current = safeNumber(currentTotal);
  const safeMultiplier = Number.isFinite(Number(multiplier)) && Number(multiplier) > 0
    ? Number(multiplier)
    : 1;
  const scaleRemaining = (value) =>
    Math.round(current + ((safeNumber(value) - current) * safeMultiplier));

  const rawConservative = scaleRemaining(range.rawConservative ?? range.conservative);
  const standard = scaleRemaining(range.standard);
  const rawAggressive = scaleRemaining(range.rawAggressive ?? range.aggressive);
  const conservative = Math.min(rawConservative, standard, rawAggressive);
  const aggressive = Math.max(rawConservative, standard, rawAggressive);

  return {
    conservative,
    standard,
    aggressive,
    min: conservative,
    max: aggressive,
    rawConservative,
    rawAggressive,
  };
};

const normalizeMonthRevisionMap = (value = {}, months = []) => Object.fromEntries(
  months.map((yearMonth) => [
    yearMonth,
    Math.max(0, Number(value?.[yearMonth] || 0)),
  ])
);

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function inspectTelegramProjectionModelTrust({
  model = null,
  brandId = "",
  modelMonth = "",
  lifecycleMaster = null,
  systemExclusionProfile = null,
  normalizeStoreKey = normalizeStoreLifecycleCore,
} = {}) {
  const normalizedBrandId = normalizeProjectionBrandId(brandId);
  const normalizedModelMonth = normalizeProjectionYearMonth(modelMonth);
  const expectedSourceMonths = getExpectedProjectionSourceMonths(normalizedModelMonth);

  const fail = (reason, detail = "") => ({
    trusted: false,
    reason,
    detail,
    brandId: normalizedBrandId,
    modelMonth: normalizedModelMonth,
    expectedSourceMonths,
  });

  if (!normalizedBrandId || !normalizedModelMonth) return fail("INVALID_SCOPE");
  if (!model || typeof model !== "object") return fail("MODEL_MISSING");
  if (String(model.schemaVersion || "") !== PROJECTION_MODEL_SCHEMA_VERSION) return fail("SCHEMA_MISMATCH");
  if (String(model.semanticVersion || "") !== PROJECTION_SEMANTIC_VERSION) return fail("SEMANTIC_MISMATCH");
  if (String(model.kpiContractVersion || "") !== KPI_CONTRACT_VERSION) return fail("KPI_CONTRACT_MISMATCH");
  if (normalizeProjectionBrandId(model.brandId) !== normalizedBrandId) return fail("BRAND_MISMATCH");
  if (normalizeProjectionYearMonth(model.modelMonth) !== normalizedModelMonth) return fail("MODEL_MONTH_MISMATCH");

  const sourceMonths = Array.isArray(model.sourceMonths)
    ? model.sourceMonths.map(normalizeProjectionYearMonth).filter(Boolean)
    : [];
  if (!sameJson(sourceMonths, expectedSourceMonths)) return fail("SOURCE_MONTHS_MISMATCH");

  if (!lifecycleMaster || String(lifecycleMaster.datasetStatus || "") !== "READY") {
    return fail("LIFECYCLE_NOT_READY");
  }
  if (normalizeProjectionBrandId(lifecycleMaster.brandId) !== normalizedBrandId) {
    return fail("LIFECYCLE_BRAND_MISMATCH");
  }

  const modelLifecycleRevision = Math.max(0, Number(model?.authority?.lifecycleRevision || 0));
  const currentLifecycleRevision = Math.max(0, Number(lifecycleMaster?.revision || 0));
  if (modelLifecycleRevision !== currentLifecycleRevision) {
    return fail("LIFECYCLE_REVISION_STALE");
  }

  const currentCalendar = normalizeReportingCalendar(lifecycleMaster?.reportingCalendar || {});
  const expectedCalendarMonthRevisions = normalizeMonthRevisionMap(
    currentCalendar?.monthRevisions || {},
    expectedSourceMonths
  );
  const modelCalendarMonthRevisions = normalizeMonthRevisionMap(
    model?.authority?.reportingCalendarMonthRevisions || {},
    expectedSourceMonths
  );
  if (!sameJson(modelCalendarMonthRevisions, expectedCalendarMonthRevisions)) {
    return fail("REPORTING_CALENDAR_STALE");
  }

  const currentProfile = normalizeStoredSystemExclusionProfile(
    systemExclusionProfile || {},
    normalizedBrandId,
    normalizeStoreKey
  );
  if (!isStoredSystemExclusionSnapshotCurrent({
    snapshot: model?.authority?.systemExclusionSnapshot || null,
    currentProfile,
    brandId: normalizedBrandId,
    normalizeStoreKey,
  })) {
    return fail("SYSTEM_EXCLUSION_STALE");
  }

  if (!model.stores || typeof model.stores !== "object" || !model.brand || typeof model.brand !== "object") {
    return fail("MODEL_PAYLOAD_INCOMPLETE");
  }

  return {
    trusted: true,
    reason: "TRUSTED",
    detail: "",
    brandId: normalizedBrandId,
    modelMonth: normalizedModelMonth,
    expectedSourceMonths,
    sourceMonths,
  };
}

function getCurvePoint(curve = {}, weekday = 0) {
  const point = curve?.[weekday] ?? curve?.[String(weekday)] ?? null;
  if (!point || typeof point !== "object") return null;
  const sampleCount = Math.max(0, Number(point.sampleCount || 0));
  const baseline = point.baseline;
  const reliable = point.reliable === true && sampleCount >= 3 && isFiniteNumber(baseline);
  return {
    sampleCount,
    reliable,
    baseline: reliable ? Number(baseline) : null,
    valueStatus: String(point.valueStatus || ""),
  };
}

function resolveTelegramProjectionHistoricalBaseline({
  model = null,
  storeKey = "",
  metric = "cash",
  weekday = 0,
  fallbackValue = 0,
  normalizeStoreKey = normalizeStoreLifecycleCore,
  allowBrandFallback = true,
} = {}) {
  const normalizedMetric = metric === "accrual" ? "accrual" : "cash";
  const curveField = normalizedMetric === "cash" ? "cashWeekday" : "accrualWeekday";
  const normalizedStoreKey = normalizeStoreKey(storeKey);
  const fallback = safeNumber(fallbackValue);

  const storeRow = model?.stores?.[normalizedStoreKey] || null;
  const storePoint = getCurvePoint(storeRow?.[curveField], weekday);
  if (storePoint?.reliable) {
    return {
      value: storePoint.baseline,
      source: "STORE_MODEL",
      sampleCount: storePoint.sampleCount,
      reliable: true,
    };
  }

  if (allowBrandFallback) {
    const brandPoint = getCurvePoint(model?.brand?.[curveField], weekday);
    if (brandPoint?.reliable) {
      return {
        value: brandPoint.baseline,
        source: "BRAND_MODEL",
        sampleCount: brandPoint.sampleCount,
        reliable: true,
      };
    }
  }

  return {
    value: fallback,
    source: "CURRENT_PACE",
    sampleCount: 0,
    reliable: false,
  };
}

const formatIsoDate = (year, month, day) => (
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
);

const getUtcWeekday = (year, month, day) => (
  new Date(Date.UTC(year, month - 1, day)).getUTCDay()
);

function buildTelegramProjectionFromModel({
  rows = [],
  model = null,
  modelTrusted = false,
  yearMonth = "",
  daysPassed = 0,
  daysInMonth = 0,
  normalizeStoreKey = normalizeStoreLifecycleCore,
  allowBrandFallbackForRow = () => true,
} = {}) {
  const normalizedYearMonth = normalizeProjectionYearMonth(yearMonth);
  const safeRows = Array.isArray(rows) ? rows : [];
  const emptyProfile = modelTrusted
    ? getProjectionBlendProfile(daysPassed, daysInMonth)
    : { currentWeight: 1, historyWeight: 0, label: "模型未就緒：依本月節奏" };
  const emptyRange = {
    cash: { conservative: 0, standard: 0, aggressive: 0, min: 0, max: 0 },
    accrual: { conservative: 0, standard: 0, aggressive: 0, min: 0, max: 0 },
    profile: emptyProfile,
    modelTrusted: modelTrusted === true,
  };

  if (!normalizedYearMonth || !daysPassed || !daysInMonth || !safeRows.length) {
    return {
      projection: 0,
      accrualProjection: 0,
      projectionRange: emptyRange,
      sourceStats: {
        storeModelHits: 0,
        brandModelFallbacks: 0,
        currentPaceFallbacks: 0,
        skippedClosedFutureStoreDays: 0,
      },
    };
  }

  const [year, month] = normalizedYearMonth.split("-").map(Number);
  const profile = emptyProfile;
  const totals = {
    cash: { current: 0, conservative: 0, standard: 0, aggressive: 0 },
    accrual: { current: 0, conservative: 0, standard: 0, aggressive: 0 },
  };
  const sourceStats = {
    storeModelHits: 0,
    brandModelFallbacks: 0,
    currentPaceFallbacks: 0,
    skippedClosedFutureStoreDays: 0,
  };

  const addSourceStat = (source) => {
    if (source === "STORE_MODEL") sourceStats.storeModelHits += 1;
    else if (source === "BRAND_MODEL") sourceStats.brandModelFallbacks += 1;
    else sourceStats.currentPaceFallbacks += 1;
  };

  safeRows.forEach((row) => {
    const storeKey = normalizeStoreKey(row?.storeKey || row?.canonicalStoreName || "");
    if (!storeKey) return;

    const currentCash = isFiniteNumber(row?.cash) ? Number(row.cash) : null;
    const currentAccrual = isFiniteNumber(row?.accrual) ? Number(row.accrual) : null;
    if (currentCash === null && currentAccrual === null) return;

    const currentCashDailyAvg = currentCash === null ? null : currentCash / daysPassed;
    const currentAccrualDailyAvg = currentAccrual === null ? null : currentAccrual / daysPassed;

    if (currentCash !== null) totals.cash.current += currentCash;
    if (currentAccrual !== null) totals.accrual.current += currentAccrual;

    const allowBrandFallback = allowBrandFallbackForRow(row) !== false;

    for (let day = daysPassed + 1; day <= daysInMonth; day += 1) {
      const dateText = formatIsoDate(year, month, day);
      if (
        row?.lifecycleEntry &&
        !isLifecycleEntryExpectedForDate(row.lifecycleEntry, dateText)
      ) {
        sourceStats.skippedClosedFutureStoreDays += 1;
        continue;
      }

      const weekday = getUtcWeekday(year, month, day);

      if (currentCashDailyAvg !== null) {
        const history = modelTrusted
          ? resolveTelegramProjectionHistoricalBaseline({
              model,
              storeKey,
              metric: "cash",
              weekday,
              fallbackValue: currentCashDailyAvg,
              normalizeStoreKey,
              allowBrandFallback,
            })
          : { value: currentCashDailyAvg, source: "CURRENT_PACE" };
        addSourceStat(history.source);
        totals.cash.conservative += Math.min(currentCashDailyAvg, history.value);
        totals.cash.standard += (currentCashDailyAvg * profile.currentWeight) + (history.value * profile.historyWeight);
        totals.cash.aggressive += Math.max(currentCashDailyAvg, history.value);
      }

      if (currentAccrualDailyAvg !== null) {
        const history = modelTrusted
          ? resolveTelegramProjectionHistoricalBaseline({
              model,
              storeKey,
              metric: "accrual",
              weekday,
              fallbackValue: currentAccrualDailyAvg,
              normalizeStoreKey,
              allowBrandFallback,
            })
          : { value: currentAccrualDailyAvg, source: "CURRENT_PACE" };
        addSourceStat(history.source);
        totals.accrual.conservative += Math.min(currentAccrualDailyAvg, history.value);
        totals.accrual.standard += (currentAccrualDailyAvg * profile.currentWeight) + (history.value * profile.historyWeight);
        totals.accrual.aggressive += Math.max(currentAccrualDailyAvg, history.value);
      }
    }
  });

  const shadowCashRange = buildProjectionRangePayload({
    currentTotal: totals.cash.current,
    remainingConservative: totals.cash.conservative,
    remainingStandard: totals.cash.standard,
    remainingAggressive: totals.cash.aggressive,
  });
  const shadowAccrualRange = buildProjectionRangePayload({
    currentTotal: totals.accrual.current,
    remainingConservative: totals.accrual.conservative,
    remainingStandard: totals.accrual.standard,
    remainingAggressive: totals.accrual.aggressive,
  });

  const phaseScopeEligible = safeRows.length > 0
    && safeRows.every((row) => allowBrandFallbackForRow(row) !== false);
  const cashPhase = modelTrusted
    ? resolveProjectionPhaseCalibration({
        model,
        metric: "cash",
        daysPassed,
        daysInMonth,
        scopeEligible: phaseScopeEligible,
      })
    : { applied: false, reason: "MODEL_UNTRUSTED", multiplier: 1 };
  const accrualPhase = modelTrusted
    ? resolveProjectionPhaseCalibration({
        model,
        metric: "accrual",
        daysPassed,
        daysInMonth,
        scopeEligible: phaseScopeEligible,
      })
    : { applied: false, reason: "MODEL_UNTRUSTED", multiplier: 1 };

  const cashRange = cashPhase.applied
    ? calibrateProjectionRange({
        range: shadowCashRange,
        currentTotal: totals.cash.current,
        multiplier: cashPhase.multiplier,
      })
    : shadowCashRange;
  const accrualRange = accrualPhase.applied
    ? calibrateProjectionRange({
        range: shadowAccrualRange,
        currentTotal: totals.accrual.current,
        multiplier: accrualPhase.multiplier,
      })
    : shadowAccrualRange;

  const phaseApplied = cashPhase.applied === true || accrualPhase.applied === true;
  const effectiveProfile = {
    ...profile,
    label: phaseApplied ? `${profile.label}＋月內節奏校正` : profile.label,
    strategyVersion: phaseApplied ? PROJECTION_STRATEGY_V2 : PROJECTION_STRATEGY_V1,
    phaseCalibrated: phaseApplied,
  };
  sourceStats.phaseCalibratedCash = cashPhase.applied === true;
  sourceStats.phaseCalibratedAccrual = accrualPhase.applied === true;

  return {
    projection: cashRange.standard,
    accrualProjection: accrualRange.standard,
    projectionRange: {
      cash: cashRange,
      accrual: accrualRange,
      shadowV1: {
        cash: shadowCashRange,
        accrual: shadowAccrualRange,
      },
      profile: effectiveProfile,
      phaseCalibration: {
        cash: cashPhase,
        accrual: accrualPhase,
      },
      // Exact aggregate parity authority:
      // preserve pre-round components so multi-store Telegram aggregation can
      // reproduce Dashboard's aggregate-first rounding order exactly.
      aggregationBasis: {
        cash: {
          currentTotal: totals.cash.current,
          remainingConservative: totals.cash.conservative,
          remainingStandard: totals.cash.standard,
          remainingAggressive: totals.cash.aggressive,
          phaseScopeEligible,
          phaseApplied: cashPhase.applied === true,
          phaseMultiplier: cashPhase.applied === true ? cashPhase.multiplier : 1,
        },
        accrual: {
          currentTotal: totals.accrual.current,
          remainingConservative: totals.accrual.conservative,
          remainingStandard: totals.accrual.standard,
          remainingAggressive: totals.accrual.aggressive,
          phaseScopeEligible,
          phaseApplied: accrualPhase.applied === true,
          phaseMultiplier: accrualPhase.applied === true ? accrualPhase.multiplier : 1,
        },
      },
      modelTrusted: modelTrusted === true,
      sourceStats,
    },
    sourceStats,
  };
}

function buildTelegramProjectionAuthorityScope({
  lifecycleMaster = null,
  systemExclusionProfile = null,
  brandId = "",
  yearMonth = "",
  normalizeStoreKey = normalizeStoreLifecycleCore,
} = {}) {
  const normalizedBrandId = normalizeProjectionBrandId(brandId);
  const normalizedYearMonth = normalizeProjectionYearMonth(yearMonth);
  const lifecycleBrandId = normalizeProjectionBrandId(lifecycleMaster?.brandId || "");
  const scopeReady = Boolean(
    normalizedBrandId &&
    normalizedYearMonth &&
    lifecycleMaster &&
    String(lifecycleMaster.datasetStatus || "") === "READY" &&
    lifecycleBrandId === normalizedBrandId
  );

  if (!scopeReady) {
    return {
      scopeReady: false,
      reason: "LIFECYCLE_NOT_READY",
      lifecycleEntryMap: new Map(),
      formalScopeStoreSet: new Set(),
      lifecycleEligibleStoreSet: new Set(),
      systemExcludedStoreSet: new Set(),
    };
  }

  const exclusionProfile = normalizeStoredSystemExclusionProfile(
    systemExclusionProfile || {},
    normalizedBrandId,
    normalizeStoreKey
  );
  const entries = getLifecycleEligibleStoreEntries(lifecycleMaster, normalizedYearMonth, {
    brandId: normalizedBrandId,
    requireReady: true,
  });
  const lifecycleEntryMap = new Map(
    entries
      .map((entry) => [
        normalizeStoreKey(entry?.storeKey || entry?.coreStoreName || entry?.canonicalStoreName || ""),
        entry,
      ])
      .filter(([key]) => Boolean(key))
  );
  const lifecycleEligibleStoreSet = new Set(lifecycleEntryMap.keys());
  const systemExcludedStoreSet = new Set(
    (exclusionProfile.stores || []).map(normalizeStoreKey).filter(Boolean)
  );
  const formalScopeStoreSet = new Set(
    [...lifecycleEligibleStoreSet].filter((storeKey) => !systemExcludedStoreSet.has(storeKey))
  );

  return {
    scopeReady: true,
    reason: "READY",
    lifecycleEntryMap,
    formalScopeStoreSet,
    lifecycleEligibleStoreSet,
    systemExcludedStoreSet,
  };
}

function isTelegramProjectionCurrentMonthToDateRange({
  startDate = "",
  endDate = "",
  currentYearMonth = "",
  todayStr = "",
} = {}) {
  const yearMonth = normalizeProjectionYearMonth(currentYearMonth);
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();
  const today = String(todayStr || "").trim();
  return Boolean(
    yearMonth &&
    /^\d{4}-\d{2}-\d{2}$/.test(today) &&
    start === `${yearMonth}-01` &&
    /^\d{4}-\d{2}-\d{2}$/.test(end) &&
    end.startsWith(`${yearMonth}-`) &&
    end <= today
  );
}

function resolveTelegramProjectionDaysPassed({
  rows = [],
  yearMonth = "",
  endDate = "",
  todayStr = "",
} = {}) {
  const normalizedYearMonth = normalizeProjectionYearMonth(yearMonth);
  if (!normalizedYearMonth) return 0;
  const [year, month] = normalizedYearMonth.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cutoffDay = Math.min(daysInMonth, Math.max(0, Number(String(endDate || "").slice(8, 10)) || 0));
  if (!cutoffDay) return 0;
  const todayDay = Number(String(todayStr || "").slice(8, 10)) || 0;
  const baseDay = endDate === todayStr ? Math.max(0, todayDay - 1) : cutoffDay;
  const maxDataDay = (Array.isArray(rows) ? rows : []).reduce(
    (max, row) => Math.max(max, Math.max(0, Number(row?.__maxDataDay || 0))),
    0
  );
  return Math.min(cutoffDay, Math.max(baseDay, maxDataDay));
}

function aggregateTelegramProjectionRows(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const sumMetric = (metric) => {
    if (!safeRows.length) return null;

    const ranges = safeRows.map((row) => row?.projectionRange?.[metric] || null);
    if (ranges.some((range) =>
      !range ||
      !["conservative", "standard", "aggressive"].every((key) => isFiniteNumber(range?.[key]))
    )) {
      return null;
    }

    // Backward-compatible fallback for rows produced before exact-parity metadata existed.
    const legacyRoundedSum = () => {
      const conservative = Math.round(
        ranges.reduce((sum, range) => sum + Number(range.conservative), 0)
      );
      const standard = Math.round(
        ranges.reduce((sum, range) => sum + Number(range.standard), 0)
      );
      const aggressive = Math.round(
        ranges.reduce((sum, range) => sum + Number(range.aggressive), 0)
      );
      return {
        conservative,
        standard,
        aggressive,
        min: Math.min(conservative, standard, aggressive),
        max: Math.max(conservative, standard, aggressive),
      };
    };

    const bases = safeRows.map(
      (row) => row?.projectionRange?.aggregationBasis?.[metric] || null
    );
    const numericFields = [
      "currentTotal",
      "remainingConservative",
      "remainingStandard",
      "remainingAggressive",
    ];
    const basisReady = bases.every((basis) =>
      basis &&
      numericFields.every((key) => isFiniteNumber(basis?.[key]))
    );
    if (!basisReady) return legacyRoundedSum();

    const summed = bases.reduce(
      (acc, basis) => ({
        currentTotal: acc.currentTotal + Number(basis.currentTotal),
        remainingConservative:
          acc.remainingConservative + Number(basis.remainingConservative),
        remainingStandard:
          acc.remainingStandard + Number(basis.remainingStandard),
        remainingAggressive:
          acc.remainingAggressive + Number(basis.remainingAggressive),
      }),
      {
        currentTotal: 0,
        remainingConservative: 0,
        remainingStandard: 0,
        remainingAggressive: 0,
      }
    );

    // Rebuild once at aggregate scope. This mirrors Dashboard's
    // "aggregate first -> round" order.
    const shadowRange = buildProjectionRangePayload(summed);

    // If any row forbids brand phase (e.g. System Excluded own-store),
    // disable phase for the whole mixed aggregate exactly like Dashboard.
    if (bases.some((basis) => basis.phaseScopeEligible === false)) {
      return shadowRange;
    }

    const phaseStates = bases.map((basis) => basis.phaseApplied === true);
    if (phaseStates.every((value) => value === false)) {
      return shadowRange;
    }

    // One brand/month should never contain mixed phase state or multipliers.
    // Fall back to previous safe behavior instead of inventing a new semantic.
    if (!phaseStates.every(Boolean)) return legacyRoundedSum();

    const multipliers = bases.map((basis) => Number(basis.phaseMultiplier));
    if (multipliers.some((value) => !Number.isFinite(value) || value <= 0)) {
      return legacyRoundedSum();
    }
    const firstMultiplier = multipliers[0];
    if (multipliers.some((value) => Math.abs(value - firstMultiplier) > 1e-12)) {
      return legacyRoundedSum();
    }

    return calibrateProjectionRange({
      range: shadowRange,
      currentTotal: summed.currentTotal,
      multiplier: firstMultiplier,
    });
  };

  const profiles = safeRows
    .map((row) => row?.projectionRange?.profile || null)
    .filter(Boolean);
  const profileKeys = [...new Set(profiles.map((profile) => JSON.stringify({
    currentWeight: Number(profile.currentWeight),
    historyWeight: Number(profile.historyWeight),
    label: String(profile.label || ""),
  })))];
  const profile = profileKeys.length === 1
    ? JSON.parse(profileKeys[0])
    : {
        currentWeight: null,
        historyWeight: null,
        label: profiles.length ? "跨品牌／混合模型可信狀態" : "資料不足",
        mixed: profiles.length > 1,
      };

  const trustReasons = [...new Set(
    safeRows.map((row) => String(row?.projectionModelTrust?.reason || "")).filter(Boolean)
  )];

  return {
    cash: sumMetric("cash"),
    accrual: sumMetric("accrual"),
    profile,
    modelTrusted: safeRows.length > 0 && safeRows.every((row) => row?.projectionModelTrust?.trusted === true),
    trustReasons,
  };
}

module.exports = {
  PROJECTION_MODEL_SCHEMA_VERSION,
  PROJECTION_SEMANTIC_VERSION,
  PROJECTION_MODEL_DOC_ID,
  PROJECTION_SOURCE_MONTH_COUNT,
  PROJECTION_MIN_PHASE_SOURCE_MONTHS,
  PROJECTION_PHASE_MIN_DAYS_PASSED,
  PROJECTION_STRATEGY_V1,
  PROJECTION_STRATEGY_V2,
  PROJECTION_PHASE_SCHEMA_VERSION,
  PROJECTION_V2_BRANDS,
  normalizeProjectionYearMonth,
  normalizeProjectionBrandId,
  getExpectedProjectionSourceMonths,
  getProjectionBlendProfile,
  buildProjectionRangePayload,
  resolveProjectionPhaseCalibration,
  calibrateProjectionRange,
  inspectTelegramProjectionModelTrust,
  resolveTelegramProjectionHistoricalBaseline,
  buildTelegramProjectionFromModel,
  buildTelegramProjectionAuthorityScope,
  isTelegramProjectionCurrentMonthToDateRange,
  resolveTelegramProjectionDaysPassed,
  aggregateTelegramProjectionRows,
};
