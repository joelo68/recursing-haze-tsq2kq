import { KPI_VALUE_STATUS, normalizeKpiBrandId } from "./kpiContracts.js";
import { buildHistoricalFormalDashboardScope, isFormalDashboardSummaryCompatible } from "./dashboardFormalConsumer.js";
import { getSummaryRecalcFlagState } from "./dashboardReadPolicy.js";
import { inspectHistoricalSystemExclusionTrust } from "./systemExclusion.js";
import { getLifecycleEligibleStoreEntries } from "./storeLifecycle.js";

export const ANNUAL_FORMAL_REASON = Object.freeze({
  PRE_SYSTEM_SKIP: "PRE_SYSTEM_SKIP",
  NOT_HISTORICAL: "NOT_HISTORICAL",
  SUMMARY_MISSING: "SUMMARY_MISSING",
  SUMMARY_CONTRACT_MISSING: "SUMMARY_CONTRACT_MISSING",
  SUMMARY_MONTH_MISMATCH: "SUMMARY_MONTH_MISMATCH",
  SUMMARY_BRAND_MISMATCH: "SUMMARY_BRAND_MISMATCH",
  FLAG_MISSING: "FLAG_MISSING",
  FLAG_MONTH_MISMATCH: "FLAG_MONTH_MISMATCH",
  FLAG_BRAND_MISMATCH: "FLAG_BRAND_MISMATCH",
  SUMMARY_PENDING: "SUMMARY_PENDING",
  SUMMARY_DIRTY: "SUMMARY_DIRTY",
  SUMMARY_UNVERIFIED: "SUMMARY_UNVERIFIED",
  VERIFIED_FORMAL_SUMMARY: "VERIFIED_FORMAL_SUMMARY",
  LIFECYCLE_AUTHORITY_NOT_READY: "LIFECYCLE_AUTHORITY_NOT_READY",
  LIFECYCLE_BRAND_MISMATCH: "LIFECYCLE_BRAND_MISMATCH",
  LIFECYCLE_SUMMARY_REVISION_MISMATCH: "LIFECYCLE_SUMMARY_REVISION_MISMATCH",
});

const DATA_START_MONTH_BY_BRAND = Object.freeze({
  yibo: "2026-04",
});

const normalizeText = (value = "") => String(value || "").trim();
const isFiniteValue = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const validNumericStatus = (status) => status === KPI_VALUE_STATUS.VALID || status === KPI_VALUE_STATUS.VALID_ZERO;

export const getAnnualBrandDataStartMonth = (brandId = "") => (
  DATA_START_MONTH_BY_BRAND[normalizeKpiBrandId(brandId)] || ""
);

export const isAnnualPreSystemMonth = (brandId = "", yearMonth = "") => {
  const startMonth = getAnnualBrandDataStartMonth(brandId);
  const ym = normalizeText(yearMonth);
  return Boolean(startMonth && /^\d{4}-\d{2}$/.test(ym) && ym < startMonth);
};

export const resolveAnnualHistoricalFormalTrust = ({
  yearMonth = "",
  currentYearMonth = "",
  brandId = "",
  dashboardSummary = null,
  summaryFlag = null,
  systemExclusionState,
  currentLifecycleMasterState,
} = {}) => {
  const ym = normalizeText(yearMonth);
  const currentYm = normalizeText(currentYearMonth);
  const expectedBrand = normalizeKpiBrandId(brandId);

  if (currentLifecycleMasterState !== undefined) {
    const lifecycleBrand = normalizeKpiBrandId(currentLifecycleMasterState?.brandId);
    const lifecycleMaster = currentLifecycleMasterState?.data || null;
    if (currentLifecycleMasterState?.ready !== true || !lifecycleMaster || String(lifecycleMaster?.datasetStatus || "") !== "READY") {
      return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.LIFECYCLE_AUTHORITY_NOT_READY };
    }
    if (lifecycleBrand !== expectedBrand) {
      return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.LIFECYCLE_BRAND_MISMATCH };
    }
  }

  if (isAnnualPreSystemMonth(expectedBrand, ym)) {
    return { trusted: false, preSystemSkip: true, reason: ANNUAL_FORMAL_REASON.PRE_SYSTEM_SKIP };
  }
  if (!ym || !currentYm || ym >= currentYm) {
    return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.NOT_HISTORICAL };
  }
  if (!dashboardSummary) {
    return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.SUMMARY_MISSING };
  }
  if (!isFormalDashboardSummaryCompatible(dashboardSummary)) {
    return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.SUMMARY_CONTRACT_MISSING };
  }

  const summaryMonth = normalizeText(dashboardSummary?.yearMonth || dashboardSummary?.id);
  if (summaryMonth !== ym) {
    return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.SUMMARY_MONTH_MISMATCH };
  }

  const summaryBrand = normalizeKpiBrandId(dashboardSummary?.brandId);
  if (!expectedBrand || summaryBrand !== expectedBrand) {
    return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.SUMMARY_BRAND_MISMATCH };
  }

  if (currentLifecycleMasterState !== undefined) {
    const currentRevision = Number(currentLifecycleMasterState?.data?.revision);
    const summaryRevision = Number(dashboardSummary?.lifecycleSnapshot?.revision);
    const summaryLifecycleReady = String(dashboardSummary?.lifecycleSnapshot?.datasetStatus || "") === "READY";
    if (!summaryLifecycleReady || !Number.isFinite(currentRevision) || !Number.isFinite(summaryRevision) || currentRevision !== summaryRevision) {
      return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.LIFECYCLE_SUMMARY_REVISION_MISMATCH };
    }
  }

  if (!summaryFlag || typeof summaryFlag !== "object") {
    return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.FLAG_MISSING };
  }

  const flagMonth = normalizeText(summaryFlag?.affectedYearMonth || summaryFlag?.yearMonth || summaryFlag?.id || ym);
  if (flagMonth !== ym) {
    return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.FLAG_MONTH_MISMATCH };
  }

  const flagBrand = normalizeKpiBrandId(summaryFlag?.brandId || expectedBrand);
  if (flagBrand !== expectedBrand) {
    return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.FLAG_BRAND_MISMATCH };
  }


  if (systemExclusionState !== undefined) {
    const exclusionTrust = inspectHistoricalSystemExclusionTrust({
      currentState: systemExclusionState,
      brandId: expectedBrand,
      summaries: [dashboardSummary],
      summaryFlag,
    });
    if (!exclusionTrust.trusted) {
      return { trusted: false, preSystemSkip: false, reason: exclusionTrust.reason };
    }
  }

  if (Number(summaryFlag?.pendingCount || 0) > 0) {
    return { trusted: false, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.SUMMARY_PENDING };
  }

  const flagState = getSummaryRecalcFlagState(summaryFlag);
  if (!flagState.isVerified) {
    return {
      trusted: false,
      preSystemSkip: false,
      reason: flagState.isDirty ? ANNUAL_FORMAL_REASON.SUMMARY_DIRTY : ANNUAL_FORMAL_REASON.SUMMARY_UNVERIFIED,
    };
  }

  return { trusted: true, preSystemSkip: false, reason: ANNUAL_FORMAL_REASON.VERIFIED_FORMAL_SUMMARY };
};

export const buildAnnualLifecycleScope = ({
  currentLifecycleMasterState,
  yearMonth = "",
  brandId = "",
  scopeStoreKeys = null,
  excludedStoreKeys = [],
  normalizeStoreKey = normalizeText,
} = {}) => {
  const expectedBrand = normalizeKpiBrandId(brandId);
  const lifecycleBrand = normalizeKpiBrandId(currentLifecycleMasterState?.brandId);
  const master = currentLifecycleMasterState?.data || null;

  if (currentLifecycleMasterState?.ready !== true || !master || String(master?.datasetStatus || "") !== "READY") {
    return {
      ready: false,
      reason: ANNUAL_FORMAL_REASON.LIFECYCLE_AUTHORITY_NOT_READY,
      eligibleStoreKeys: [],
    };
  }
  if (!expectedBrand || lifecycleBrand !== expectedBrand) {
    return {
      ready: false,
      reason: ANNUAL_FORMAL_REASON.LIFECYCLE_BRAND_MISMATCH,
      eligibleStoreKeys: [],
    };
  }

  const explicitScope = Array.isArray(scopeStoreKeys)
    ? new Set(scopeStoreKeys.map(normalizeStoreKey).filter(Boolean))
    : null;
  const excluded = new Set((excludedStoreKeys || []).map(normalizeStoreKey).filter(Boolean));
  const entries = getLifecycleEligibleStoreEntries(master, yearMonth, {
    brandId: expectedBrand,
    requireReady: true,
  });

  const eligibleStoreKeys = entries
    .map((entry) => normalizeStoreKey(entry?.storeKey || entry?.coreStoreName || entry?.canonicalStoreName || ""))
    .filter((storeKey) => (
      storeKey
      && !excluded.has(storeKey)
      && (!explicitScope || explicitScope.has(storeKey))
    ));

  return {
    ready: true,
    reason: "LIFECYCLE_SCOPE_READY",
    eligibleStoreKeys: [...new Set(eligibleStoreKeys)].sort((a, b) => a.localeCompare(b, "zh-Hant")),
  };
};

const normalizeStoreEntries = (stores = {}) => (
  Array.isArray(stores)
    ? stores.map((row, index) => [String(index), row])
    : Object.entries(stores && typeof stores === "object" ? stores : {})
);

const getStoreKey = (row = {}, fallbackKey = "", normalizeStoreKey = normalizeText) => normalizeStoreKey(
  row?.__summaryKey || row?.store || row?.storeName || row?.coreStoreName || row?.displayName || row?.name || row?.id || fallbackKey
);

const readTraffic = (row = {}) => {
  const raw = row?.traffic ?? row?.trafficTotal ?? row?.totalTraffic;
  return isFiniteValue(raw) ? Number(raw) : 0;
};

const makeUnavailableMetric = (status = KPI_VALUE_STATUS.FIELD_MISSING) => ({ value: null, status });

export const buildAnnualFormalMonth = ({
  dashboardSummary = {},
  monthlyTargetSummary = null,
  scopeStoreKeys = null,
  excludedStoreKeys = [],
  normalizeStoreKey = normalizeText,
} = {}) => {
  if (!isFormalDashboardSummaryCompatible(dashboardSummary)) {
    return { compatible: false, applied: false, reason: ANNUAL_FORMAL_REASON.SUMMARY_CONTRACT_MISSING };
  }

  const excluded = new Set((excludedStoreKeys || []).map(normalizeStoreKey).filter(Boolean));
  const explicitScope = Array.isArray(scopeStoreKeys)
    ? new Set(scopeStoreKeys.map(normalizeStoreKey).filter(Boolean))
    : null;
  const filtered = Boolean(explicitScope || excluded.size > 0);

  const rowsByKey = new Map();
  normalizeStoreEntries(dashboardSummary?.stores).forEach(([fallbackKey, value]) => {
    if (!value || typeof value !== "object") return;
    const row = { __summaryKey: fallbackKey, ...value };
    const key = getStoreKey(row, fallbackKey, normalizeStoreKey);
    if (key && !rowsByKey.has(key)) rowsByKey.set(key, row);
  });

  const lifecycleEligibleKeys = Array.isArray(dashboardSummary?.lifecycleSnapshot?.eligibleStoreKeys)
    ? dashboardSummary.lifecycleSnapshot.eligibleStoreKeys.map(normalizeStoreKey).filter(Boolean)
    : [];
  const expectedScopeKeys = lifecycleEligibleKeys.filter((key) => (
    !excluded.has(key) && (!explicitScope || explicitScope.has(key))
  ));

  const selectedRows = filtered
    ? expectedScopeKeys.map((key) => rowsByKey.get(key) || {
        __summaryKey: key,
        store: key,
        formalLifecycleEligible: true,
      })
    : [...rowsByKey.values()];

  const scope = buildHistoricalFormalDashboardScope({
    summary: dashboardSummary,
    stores: selectedRows,
    monthlyTargetSummary,
    normalizeStoreKey,
    filtered,
  });
  if (!scope?.compatible) {
    return { compatible: false, applied: false, reason: scope?.reason || "FORMAL_SCOPE_UNAVAILABLE" };
  }

  if (filtered && expectedScopeKeys.length === 0) {
    return {
      compatible: true,
      applied: true,
      includedInTotals: false,
      actualIncludedInTotals: false,
      targetIncludedInTotals: false,
      performanceStatus: "N_A",
      emptyLifecycleScope: true,
      source: "formal_dashboard_summary",
      cash: null,
      cashStatus: KPI_VALUE_STATUS.N_A,
      accrual: null,
      accrualStatus: KPI_VALUE_STATUS.N_A,
      budget: null,
      budgetStatus: KPI_VALUE_STATUS.N_A,
      accrualBudget: null,
      accrualBudgetStatus: KPI_VALUE_STATUS.N_A,
      achievement: null,
      achievementStatus: KPI_VALUE_STATUS.N_A,
      accrualAchievement: null,
      accrualAchievementStatus: KPI_VALUE_STATUS.N_A,
      traffic: 0,
      scopeEligibleStoreCount: 0,
      cashCoverageComplete: true,
      accrualCoverageComplete: true,
      missingSummaryStoreKeys: [],
    };
  }

  const scopeStoreKeySet = new Set(scope?.scopeStoreKeys || []);
  const missingSummaryStoreKeys = filtered
    ? expectedScopeKeys.filter((key) => !rowsByKey.has(key))
    : [];
  const actualScopeIncomplete = missingSummaryStoreKeys.length > 0;
  const reportingStores = dashboardSummary?.reportingCompleteness?.stores
    && typeof dashboardSummary.reportingCompleteness.stores === "object"
      ? dashboardSummary.reportingCompleteness.stores
      : {};
  const reportingByKey = new Map();
  Object.entries(reportingStores).forEach(([fallbackKey, row]) => {
    const key = normalizeStoreKey(row?.storeKey || row?.coreStoreName || row?.canonicalStoreName || fallbackKey);
    if (key && !reportingByKey.has(key)) reportingByKey.set(key, row || {});
  });
  const reportingScopeKeys = filtered ? expectedScopeKeys : lifecycleEligibleKeys.filter((key) => !excluded.has(key));
  const incompleteReportingStoreKeys = reportingScopeKeys.filter((key) => (
    reportingByKey.get(key)?.reportingStatus !== "DATA_COMPLETE"
  ));
  const performanceStatus = incompleteReportingStoreKeys.length > 0
    ? "DATA_INCOMPLETE"
    : "DATA_COMPLETE";

  const cashMetric = actualScopeIncomplete
    ? makeUnavailableMetric(KPI_VALUE_STATUS.FIELD_MISSING)
    : { value: scope.cash, status: scope.cashStatus };
  const accrualMetric = actualScopeIncomplete
    ? makeUnavailableMetric(KPI_VALUE_STATUS.FIELD_MISSING)
    : { value: scope.accrual, status: scope.accrualStatus };

  let achievement = scope.cashAchievement;
  let achievementStatus = scope.cashAchievementStatus;
  let accrualAchievement = scope.accrualAchievement;
  let accrualAchievementStatus = scope.accrualAchievementStatus;
  if (actualScopeIncomplete) {
    achievement = null;
    achievementStatus = KPI_VALUE_STATUS.FIELD_MISSING;
    accrualAchievement = null;
    accrualAchievementStatus = KPI_VALUE_STATUS.FIELD_MISSING;
  }

  const traffic = filtered
    ? [...scopeStoreKeySet].reduce((sum, key) => sum + readTraffic(rowsByKey.get(key) || {}), 0)
    : readTraffic(dashboardSummary?.grandTotal || {});

  return {
    compatible: true,
    applied: true,
    includedInTotals: true,
    actualIncludedInTotals: true,
    targetIncludedInTotals: true,
    performanceStatus,
    incompleteReportingStoreKeys,
    emptyLifecycleScope: false,
    source: "formal_dashboard_summary",
    cash: cashMetric.value,
    cashStatus: cashMetric.status,
    accrual: accrualMetric.value,
    accrualStatus: accrualMetric.status,
    budget: scope.cashTarget,
    budgetStatus: scope.cashTargetStatus,
    accrualBudget: scope.accrualTarget,
    accrualBudgetStatus: scope.accrualTargetStatus,
    achievement,
    achievementStatus,
    accrualAchievement,
    accrualAchievementStatus,
    traffic,
    scopeEligibleStoreCount: scope.scopeEligibleStoreCount,
    cashCoverageComplete: scope.cashCoverageComplete === true,
    accrualCoverageComplete: scope.accrualCoverageComplete === true,
    missingSummaryStoreKeys,
  };
};

export const shouldAllowAnnualRawTargetFallback = ({
  yearMonth = "",
  currentYearMonth = "",
  brandId = "",
  dashboardSummary = null,
  summaryFlag = null,
  systemExclusionState,
  currentLifecycleMasterState,
} = {}) => {
  const trust = resolveAnnualHistoricalFormalTrust({
    yearMonth,
    currentYearMonth,
    brandId,
    dashboardSummary,
    summaryFlag,
    systemExclusionState,
    currentLifecycleMasterState,
  });
  if (trust.preSystemSkip || trust.trusted) return false;
  return true;
};

export const buildAnnualIntervalTotals = (monthlyStats = []) => {
  const included = (Array.isArray(monthlyStats) ? monthlyStats : [])
    .filter((row) => row?.includedInTotals !== false);
  const actualRows = included.filter((row) => (
    row?.actualIncludedInTotals !== false && row?.performanceStatus !== "NOT_STARTED"
  ));
  const targetRows = included.filter((row) => row?.targetIncludedInTotals !== false);

  const sumNullableMetric = (rows, key) => {
    if (rows.some((row) => !isFiniteValue(row?.[key]))) return null;
    return rows.reduce((sum, row) => sum + Number(row?.[key] || 0), 0);
  };

  const totalCash = sumNullableMetric(actualRows, "cash");
  const totalBudget = sumNullableMetric(targetRows, "budget");
  const totalAccrual = sumNullableMetric(actualRows, "accrual");
  const totalAccrualBudget = sumNullableMetric(targetRows, "accrualBudget");
  const totalTraffic = actualRows.reduce((sum, row) => sum + (isFiniteValue(row?.traffic) ? Number(row.traffic) : 0), 0);

  const cashAch = isFiniteValue(totalCash) && isFiniteValue(totalBudget) && Number(totalBudget) > 0
    ? (Number(totalCash) / Number(totalBudget)) * 100
    : null;
  const accrualAch = isFiniteValue(totalAccrual) && isFiniteValue(totalAccrualBudget) && Number(totalAccrualBudget) > 0
    ? (Number(totalAccrual) / Number(totalAccrualBudget)) * 100
    : null;

  const includesFutureTargets = included.some((row) => (
    row?.performanceStatus === "NOT_STARTED" && row?.targetIncludedInTotals !== false
  ));
  const performanceStatus = actualRows.some((row) => row?.performanceStatus === "DATA_INCOMPLETE")
    ? "DATA_INCOMPLETE"
    : (actualRows.some((row) => row?.performanceStatus === "PROVISIONAL") ? "PROVISIONAL" : "DATA_COMPLETE");

  return {
    cash: totalCash,
    budget: totalBudget,
    cashAch,
    accrual: totalAccrual,
    accrualBudget: totalAccrualBudget,
    accrualAch,
    traffic: totalTraffic,
    includesFutureTargets,
    performanceStatus,
    actualMonthCount: actualRows.length,
    targetMonthCount: targetRows.length,
  };
};

export const isAnnualFormalMetricDisplayable = (value, status) => (
  isFiniteValue(value) && validNumericStatus(status)
);
