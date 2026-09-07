// src/utils/projectionModelConsumer.js
import {
  getLifecycleEligibleStoreEntries,
  isLifecycleEntryExpectedForDate,
  normalizeReportingCalendar,
} from "./storeLifecycle.js";
import { isSystemExclusionSnapshotCurrent } from "./systemExclusion.js";

export const PROJECTION_MODEL_SCHEMA_VERSION = "projection-model-v1";
export const PROJECTION_SEMANTIC_VERSION = "projection-semantic-v1";
export const PROJECTION_MODEL_DOC_ID = "current";
export const PROJECTION_SOURCE_MONTH_COUNT = 3;

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

const normalizeYearMonth = (value = "") => {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
};

const normalizeBrandId = (value = "") => {
  const text = String(value || "").trim().toLowerCase();
  if (["cyj", "drcyj", "default", "default-app-id"].includes(text)) return "cyj";
  if (["anniu", "anew", "安妞"].includes(text)) return "anniu";
  if (["yibo", "伊啵"].includes(text)) return "yibo";
  return "";
};

const shiftYearMonth = (yearMonth = "", deltaMonths = 0) => {
  const normalized = normalizeYearMonth(yearMonth);
  if (!normalized) return "";
  const [year, month] = normalized.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + Number(deltaMonths || 0), 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const getExpectedProjectionSourceMonths = (modelMonth = "") => {
  const normalized = normalizeYearMonth(modelMonth);
  if (!normalized) return [];
  return Array.from({ length: PROJECTION_SOURCE_MONTH_COUNT }, (_, index) =>
    shiftYearMonth(normalized, -(PROJECTION_SOURCE_MONTH_COUNT - index))
  );
};

export const getProjectionBlendProfile = (daysPassed = 0, daysInMonth = 0) => {
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
};

export const buildProjectionRangePayload = ({
  currentTotal = 0,
  remainingConservative = 0,
  remainingStandard = 0,
  remainingAggressive = 0,
} = {}) => {
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
};

const normalizeMonthRevisionMap = (value = {}, months = []) => Object.fromEntries(
  months.map((yearMonth) => [
    yearMonth,
    Math.max(0, Number(value?.[yearMonth] || 0)),
  ])
);

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const inspectProjectionModelTrust = ({
  model = null,
  brandId = "",
  modelMonth = "",
  lifecycleMaster = null,
  systemExclusionState = null,
} = {}) => {
  const normalizedBrandId = normalizeBrandId(brandId);
  const normalizedModelMonth = normalizeYearMonth(modelMonth);
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
  if (String(model.kpiContractVersion || "") !== "kpi-contract-v1") return fail("KPI_CONTRACT_MISMATCH");
  if (normalizeBrandId(model.brandId) !== normalizedBrandId) return fail("BRAND_MISMATCH");
  if (normalizeYearMonth(model.modelMonth) !== normalizedModelMonth) return fail("MODEL_MONTH_MISMATCH");

  const sourceMonths = Array.isArray(model.sourceMonths)
    ? model.sourceMonths.map(normalizeYearMonth).filter(Boolean)
    : [];
  if (!sameJson(sourceMonths, expectedSourceMonths)) return fail("SOURCE_MONTHS_MISMATCH");

  if (!lifecycleMaster || String(lifecycleMaster.datasetStatus || "") !== "READY") {
    return fail("LIFECYCLE_NOT_READY");
  }
  if (normalizeBrandId(lifecycleMaster.brandId) !== normalizedBrandId) {
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

  if (!isSystemExclusionSnapshotCurrent({
    snapshot: model?.authority?.systemExclusionSnapshot || null,
    currentState: systemExclusionState,
    brandId: normalizedBrandId,
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
};

const getCurvePoint = (curve = {}, weekday = 0) => {
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
};

export const resolveProjectionHistoricalBaseline = ({
  model = null,
  storeKey = "",
  metric = "cash",
  weekday = 0,
  fallbackValue = 0,
  normalizeStoreKey = (value) => String(value || "").trim(),
  allowBrandFallback = true,
} = {}) => {
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
};

const formatIsoDate = (year, month, day) => (
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
);

const getUtcWeekday = (year, month, day) => (
  new Date(Date.UTC(year, month - 1, day)).getUTCDay()
);

export const buildDashboardProjectionFromModel = ({
  rows = [],
  model = null,
  modelTrusted = false,
  yearMonth = "",
  daysPassed = 0,
  daysInMonth = 0,
  normalizeStoreKey = (value) => String(value || "").trim(),
  allowBrandFallbackForRow = () => true,
} = {}) => {
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
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
          ? resolveProjectionHistoricalBaseline({
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
          ? resolveProjectionHistoricalBaseline({
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

  const cashRange = buildProjectionRangePayload({
    currentTotal: totals.cash.current,
    remainingConservative: totals.cash.conservative,
    remainingStandard: totals.cash.standard,
    remainingAggressive: totals.cash.aggressive,
  });
  const accrualRange = buildProjectionRangePayload({
    currentTotal: totals.accrual.current,
    remainingConservative: totals.accrual.conservative,
    remainingStandard: totals.accrual.standard,
    remainingAggressive: totals.accrual.aggressive,
  });

  return {
    projection: cashRange.standard,
    accrualProjection: accrualRange.standard,
    projectionRange: {
      cash: cashRange,
      accrual: accrualRange,
      profile,
      modelTrusted: modelTrusted === true,
      sourceStats,
    },
    sourceStats,
  };
};

export const buildProjectionLifecycleEntryMap = ({
  lifecycleMaster = null,
  brandId = "",
  yearMonth = "",
  normalizeStoreKey = (value) => String(value || "").trim(),
} = {}) => {
  if (!lifecycleMaster || String(lifecycleMaster.datasetStatus || "") !== "READY") return new Map();

  const entries = getLifecycleEligibleStoreEntries(lifecycleMaster, yearMonth, {
    brandId,
    requireReady: true,
  });

  return new Map(
    entries
      .map((entry) => [
        normalizeStoreKey(entry?.storeKey || entry?.coreStoreName || entry?.canonicalStoreName || ""),
        entry,
      ])
      .filter(([key]) => Boolean(key))
  );
};
