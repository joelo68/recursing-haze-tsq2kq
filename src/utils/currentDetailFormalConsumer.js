import {
  KPI_VALUE_STATUS,
  normalizeKpiBrandId,
  validBaseTarget,
  validChallengeTarget,
} from "./kpiContracts.js";
import {
  SUMMARY_KPI_STATUS,
  aggregateFormalMetrics,
  buildSummaryTargetAuthoritySnapshot,
  extractTargetCoverageMetadata,
} from "./summarySemantics.js";
import { normalizeMonthlyTargetMap } from "./dashboardFormalConsumer.js";
import {
  buildLifecycleReportingCompleteness,
  getLifecycleEligibleStoreEntries,
  isLifecycleEntryExpectedForDate,
  normalizeIsoDate,
  normalizeLifecycleBrandId,
  normalizeLifecycleMaster,
  normalizeStoreLifecycleCore,
  normalizeYearMonth,
} from "./storeLifecycle.js";

export const CURRENT_DETAIL_FORMAL_CONSUMER_VERSION = "current-detail-formal-v1";
export const CURRENT_DETAIL_KPI_STATUS = Object.freeze({
  DATA_INCOMPLETE: "DATA_INCOMPLETE",
  LIFECYCLE_NOT_READY: "LIFECYCLE_NOT_READY",
  TARGET_INCOMPLETE: SUMMARY_KPI_STATUS.TARGET_INCOMPLETE,
});

const isValidNumericStatus = (status) => (
  status === KPI_VALUE_STATUS.VALID || status === KPI_VALUE_STATUS.VALID_ZERO
);

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const getTaipeiDate = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = {};
  parts.forEach((part) => {
    if (part.type !== "literal") map[part.type] = part.value;
  });
  return `${map.year}-${map.month}-${map.day}`;
};

const shiftIsoDate = (dateText = "", deltaDays = 0) => {
  const date = normalizeIsoDate(dateText);
  if (!date) return "";
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + Number(deltaDays || 0));
  return cursor.toISOString().slice(0, 10);
};

const getMonthEndDate = (yearMonth = "") => {
  const normalized = normalizeYearMonth(yearMonth);
  if (!normalized) return "";
  const [year, month] = normalized.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${normalized}-${String(day).padStart(2, "0")}`;
};

// Current/live reporting completeness only expects reports through yesterday.
// Historical detail fallback expects the full month. Future months expect zero elapsed report-days.
export const resolveCurrentDetailReportingCutoffDate = (yearMonth = "", now = new Date()) => {
  const normalized = normalizeYearMonth(yearMonth);
  if (!normalized) return "";
  const today = getTaipeiDate(now);
  const currentYearMonth = today.slice(0, 7);
  if (normalized < currentYearMonth) return getMonthEndDate(normalized);
  if (normalized > currentYearMonth) return shiftIsoDate(`${normalized}-01`, -1);
  return shiftIsoDate(today, -1);
};

const normalizeTargetSummaryAnchor = (summary = {}) => ({
  yearMonth: String(summary?.yearMonth || summary?.id || "").trim(),
  brandId: normalizeKpiBrandId(summary?.brandId || ""),
});

const normalizeReportDate = (row = {}) => normalizeIsoDate(
  row?.date || row?.reportDate || row?.sourceDate || ""
);

const zeroFormalMetrics = (brandId = "") => ({
  brandId,
  grossCash: 0,
  grossCashStatus: KPI_VALUE_STATUS.VALID_ZERO,
  refund: 0,
  refundStatus: KPI_VALUE_STATUS.VALID_ZERO,
  skincareRefund: 0,
  skincareRefundStatus: KPI_VALUE_STATUS.VALID_ZERO,
  formalNetCash: 0,
  formalNetCashStatus: KPI_VALUE_STATUS.VALID_ZERO,
  totalAccrual: 0,
  totalAccrualStatus: KPI_VALUE_STATUS.VALID_ZERO,
  operationalAccrual: 0,
  operationalAccrualStatus: KPI_VALUE_STATUS.VALID_ZERO,
  formalAccrual: 0,
  formalAccrualStatus: KPI_VALUE_STATUS.VALID_ZERO,
});

const readAuxiliaryTotals = (rows = []) => (
  (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
    acc.skincareSales += Number(row?.skincareSales || 0);
    acc.traffic += Number(row?.traffic || 0);
    acc.newCustomers += Number(row?.newCustomers || 0);
    acc.newCustomerSales += Number(row?.newCustomerSales ?? row?.newCustomerRevenue ?? 0);
    acc.newCustomerClosings += Number(row?.newCustomerClosings || 0);
    const operational = Number(row?.operationalAccrual || 0);
    if (Number.isFinite(operational)) acc.operationalAccrual += operational;
    return acc;
  }, {
    skincareSales: 0,
    traffic: 0,
    newCustomers: 0,
    newCustomerSales: 0,
    newCustomerClosings: 0,
    operationalAccrual: 0,
  })
);

const buildTargetResult = (targetRow = {}, field = "cashTarget") => {
  const result = validBaseTarget(targetRow?.[field]);
  return result.valid
    ? { value: result.value, status: KPI_VALUE_STATUS.VALID }
    : { value: null, status: result.status };
};

const buildChallengeTargetResult = (targetRow = {}, baseField = "cashTarget", challengeField = "challengeCashTarget") => {
  const base = validBaseTarget(targetRow?.[baseField]);
  if (!base.valid) return { value: null, status: base.status, configured: false };
  const challenge = validChallengeTarget(targetRow?.[baseField], targetRow?.[challengeField]);
  if (challenge.valid) return { value: challenge.value, status: KPI_VALUE_STATUS.VALID, configured: true };
  if (challenge.configured) return { value: null, status: challenge.status, configured: true };
  return { value: base.value, status: KPI_VALUE_STATUS.VALID, configured: false };
};

const buildAchievement = ({ actual, actualStatus, target, targetStatus }) => {
  if (!isValidNumericStatus(actualStatus) || !isFiniteNumber(actual)) {
    return { value: null, status: actualStatus || CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE };
  }
  if (targetStatus !== KPI_VALUE_STATUS.VALID || !isFiniteNumber(target) || target <= 0) {
    return { value: null, status: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE };
  }
  const value = (actual / target) * 100;
  return {
    value,
    status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
  };
};

const mergeActualStatus = (statuses = []) => {
  if (statuses.some((status) => status === KPI_VALUE_STATUS.DATA_INVALID)) return KPI_VALUE_STATUS.DATA_INVALID;
  if (statuses.some((status) => status === CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE)) return CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE;
  if (statuses.some((status) => status === CURRENT_DETAIL_KPI_STATUS.LIFECYCLE_NOT_READY)) return CURRENT_DETAIL_KPI_STATUS.LIFECYCLE_NOT_READY;
  if (statuses.some((status) => status === KPI_VALUE_STATUS.FIELD_MISSING)) return KPI_VALUE_STATUS.FIELD_MISSING;
  return KPI_VALUE_STATUS.VALID;
};

const sumStoreMetric = (rows = [], valueKey, statusKey) => {
  if (!rows.length) return { value: null, status: KPI_VALUE_STATUS.FIELD_MISSING };
  const statuses = rows.map((row) => row?.[statusKey] || KPI_VALUE_STATUS.FIELD_MISSING);
  const status = mergeActualStatus(statuses);
  if (!isValidNumericStatus(status)) return { value: null, status };
  const value = rows.reduce((sum, row) => sum + Number(row?.[valueKey] || 0), 0);
  return { value, status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID };
};

const buildScopeTarget = ({ rows = [], targetAuthority = {}, targetKey = "cashTarget", targetStatusKey = "cashTargetStatus" }) => {
  if (targetAuthority?.coverageConsistent !== true || rows.length === 0) {
    return { value: null, status: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE, coverageComplete: false };
  }
  const invalid = rows.filter((row) => row?.[targetStatusKey] !== KPI_VALUE_STATUS.VALID || !isFiniteNumber(row?.[targetKey]) || row[targetKey] <= 0);
  if (invalid.length > 0) {
    return {
      value: null,
      status: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE,
      coverageComplete: false,
      missingStoreKeys: invalid.map((row) => row.storeKey),
    };
  }
  const value = rows.reduce((sum, row) => sum + Number(row[targetKey]), 0);
  return { value, status: KPI_VALUE_STATUS.VALID, coverageComplete: true, missingStoreKeys: [] };
};

const buildScopeChallengeTarget = ({ rows = [], targetAuthority = {}, targetKey, targetStatusKey }) => {
  if (targetAuthority?.coverageConsistent !== true || rows.length === 0) {
    return { value: null, status: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE, coverageComplete: false, configured: false };
  }
  const invalid = rows.filter((row) => row?.[targetStatusKey] !== KPI_VALUE_STATUS.VALID || !isFiniteNumber(row?.[targetKey]) || row[targetKey] <= 0);
  if (invalid.length > 0) {
    return { value: null, status: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE, coverageComplete: false, configured: false };
  }
  const value = rows.reduce((sum, row) => sum + Number(row[targetKey]), 0);
  return {
    value,
    status: KPI_VALUE_STATUS.VALID,
    coverageComplete: true,
    configured: rows.some((row) => row?.[`${targetKey}Configured`] === true),
  };
};

export const buildCurrentDetailFormalAuthority = ({
  brandId = "",
  yearMonth = "",
  lifecycleMaster = null,
  monthlyTargetSummary = null,
  reports = [],
  cutoffDate = "",
  normalizeStoreKey = normalizeStoreLifecycleCore,
} = {}) => {
  const normalizedBrandId = normalizeKpiBrandId(brandId);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  const rawLifecycleBrandId = String(lifecycleMaster?.brandId || "").trim();
  const lifecycleBrandId = rawLifecycleBrandId ? normalizeLifecycleBrandId(rawLifecycleBrandId) : "";
  const lifecycleReady = Boolean(
    normalizedBrandId &&
    normalizedYearMonth &&
    lifecycleMaster &&
    lifecycleBrandId === normalizedBrandId &&
    String(lifecycleMaster?.datasetStatus || "") === "READY"
  );

  if (!lifecycleReady) {
    return {
      version: CURRENT_DETAIL_FORMAL_CONSUMER_VERSION,
      compatible: false,
      reason: "LIFECYCLE_NOT_READY",
      brandId: normalizedBrandId,
      yearMonth: normalizedYearMonth,
      lifecycleReady: false,
      stores: {},
      eligibleStoreKeys: [],
      reportingStatus: CURRENT_DETAIL_KPI_STATUS.LIFECYCLE_NOT_READY,
      targetAuthority: null,
    };
  }

  const normalizedMaster = normalizeLifecycleMaster(lifecycleMaster, normalizedBrandId);
  const eligibleEntries = getLifecycleEligibleStoreEntries(normalizedMaster, normalizedYearMonth, {
    brandId: normalizedBrandId,
    requireReady: true,
  });
  const eligibleStoreKeys = eligibleEntries.map((entry) => normalizeStoreKey(entry.storeKey || entry.coreStoreName)).filter(Boolean);
  const entryByStore = new Map(eligibleEntries.map((entry) => [normalizeStoreKey(entry.storeKey || entry.coreStoreName), entry]));

  const effectiveCutoffDate = normalizeIsoDate(cutoffDate) || resolveCurrentDetailReportingCutoffDate(normalizedYearMonth);
  const reporting = buildLifecycleReportingCompleteness({
    master: normalizedMaster,
    yearMonth: normalizedYearMonth,
    reports,
    brandId: normalizedBrandId,
    cutoffDate: effectiveCutoffDate,
    requireReady: true,
    includeMissingDates: false,
    getReportStoreName: (row) => row?.storeName || row?.store || row?.storeKey || "",
    getReportDate: (row) => row?.date || row?.reportDate || row?.sourceDate || "",
  });

  const targetAnchor = normalizeTargetSummaryAnchor(monthlyTargetSummary || {});
  const targetSummaryMatches = Boolean(monthlyTargetSummary)
    && targetAnchor.yearMonth === normalizedYearMonth
    && (!targetAnchor.brandId || targetAnchor.brandId === normalizedBrandId);
  const targetMap = targetSummaryMatches
    ? normalizeMonthlyTargetMap(monthlyTargetSummary, normalizeStoreKey)
    : {};
  const targetCoverage = targetSummaryMatches
    ? extractTargetCoverageMetadata(monthlyTargetSummary)
    : {};
  const targetAuthority = buildSummaryTargetAuthoritySnapshot({
    targetMap,
    eligibleStoreKeys,
    lifecycleReady: true,
    targetCoverage,
  });

  const reportsByStore = new Map();
  (Array.isArray(reports) ? reports : []).forEach((row) => {
    const date = normalizeReportDate(row);
    if (!date || date.slice(0, 7) !== normalizedYearMonth) return;
    const storeKey = normalizeStoreKey(row?.storeName || row?.store || row?.storeKey || "");
    const entry = entryByStore.get(storeKey);
    if (!entry || !isLifecycleEntryExpectedForDate(entry, date)) return;
    if (!reportsByStore.has(storeKey)) reportsByStore.set(storeKey, []);
    reportsByStore.get(storeKey).push(row);
  });

  const stores = {};
  eligibleEntries.forEach((entry) => {
    const storeKey = normalizeStoreKey(entry.storeKey || entry.coreStoreName);
    if (!storeKey) return;
    const storeReports = reportsByStore.get(storeKey) || [];
    const reportingStore = reporting?.stores?.[entry.storeKey] || reporting?.stores?.[storeKey] || null;
    const expectedReportDayCount = Number(reportingStore?.expectedReportDayCount || 0);
    const reportingStatus = String(reportingStore?.reportingStatus || CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE);

    let metrics = storeReports.length > 0
      ? aggregateFormalMetrics(normalizedBrandId, storeReports)
      : zeroFormalMetrics(normalizedBrandId);

    if (reportingStatus !== "DATA_COMPLETE") {
      metrics = {
        ...metrics,
        formalNetCash: null,
        formalNetCashStatus: CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE,
        formalAccrual: null,
        formalAccrualStatus: CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE,
      };
    } else if (expectedReportDayCount > 0 && storeReports.length === 0) {
      metrics = {
        ...metrics,
        formalNetCash: null,
        formalNetCashStatus: CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE,
        formalAccrual: null,
        formalAccrualStatus: CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE,
      };
    }

    const targetRow = targetMap?.[storeKey] || {};
    const cashTarget = buildTargetResult(targetRow, "cashTarget");
    const accrualTarget = buildTargetResult(targetRow, "accrualTarget");
    const challengeCashTarget = buildChallengeTargetResult(targetRow, "cashTarget", "challengeCashTarget");
    const challengeAccrualTarget = buildChallengeTargetResult(targetRow, "accrualTarget", "challengeAccrualTarget");
    const cashAchievement = buildAchievement({
      actual: metrics.formalNetCash,
      actualStatus: metrics.formalNetCashStatus,
      target: cashTarget.value,
      targetStatus: cashTarget.status,
    });
    const accrualAchievement = buildAchievement({
      actual: metrics.formalAccrual,
      actualStatus: metrics.formalAccrualStatus,
      target: accrualTarget.value,
      targetStatus: accrualTarget.status,
    });
    const aux = readAuxiliaryTotals(storeReports);

    stores[storeKey] = {
      storeKey,
      canonicalStoreName: entry.canonicalStoreName,
      lifecycleEntry: entry,
      lifecycleEligible: true,
      reportingStatus,
      expectedReportDayCount,
      submittedReportDayCount: Number(reportingStore?.submittedReportDayCount || 0),
      missingReportDayCount: Number(reportingStore?.missingReportDayCount || 0),
      reportDocumentCount: storeReports.length,
      formalNetCash: metrics.formalNetCash,
      formalNetCashStatus: metrics.formalNetCashStatus,
      formalAccrual: metrics.formalAccrual,
      formalAccrualStatus: metrics.formalAccrualStatus,
      cashTarget: cashTarget.value,
      cashTargetStatus: cashTarget.status,
      accrualTarget: accrualTarget.value,
      accrualTargetStatus: accrualTarget.status,
      challengeCashTarget: challengeCashTarget.value,
      challengeCashTargetStatus: challengeCashTarget.status,
      challengeCashTargetConfigured: challengeCashTarget.configured,
      challengeAccrualTarget: challengeAccrualTarget.value,
      challengeAccrualTargetStatus: challengeAccrualTarget.status,
      challengeAccrualTargetConfigured: challengeAccrualTarget.configured,
      cashAchievement: cashAchievement.value,
      cashAchievementStatus: cashAchievement.status,
      accrualAchievement: accrualAchievement.value,
      accrualAchievementStatus: accrualAchievement.status,
      formalRankEligible: (
        isValidNumericStatus(metrics.formalNetCashStatus) &&
        cashTarget.status === KPI_VALUE_STATUS.VALID &&
        isValidNumericStatus(cashAchievement.status)
      ),
      ...aux,
    };
  });

  const rankEligibleRows = Object.values(stores)
    .filter((row) => row.formalRankEligible)
    .sort((a, b) => {
      if (b.cashAchievement !== a.cashAchievement) return b.cashAchievement - a.cashAchievement;
      if (b.formalNetCash !== a.formalNetCash) return b.formalNetCash - a.formalNetCash;
      return String(a.storeKey).localeCompare(String(b.storeKey), "zh-Hant");
    });
  rankEligibleRows.forEach((row, index) => {
    row.formalCashAchievementRank = index + 1;
  });
  Object.values(stores).forEach((row) => {
    if (!row.formalRankEligible) row.formalCashAchievementRank = null;
  });

  return {
    version: CURRENT_DETAIL_FORMAL_CONSUMER_VERSION,
    compatible: true,
    reason: "CURRENT_DETAIL_FORMAL_READY",
    brandId: normalizedBrandId,
    yearMonth: normalizedYearMonth,
    lifecycleReady: true,
    cutoffDate: effectiveCutoffDate,
    stores,
    eligibleStoreKeys,
    reporting,
    reportingStatus: reporting.reportingStatus,
    targetSummaryAvailable: targetSummaryMatches,
    targetAuthority,
    formalRankEligibleStoreCount: rankEligibleRows.length,
  };
};

export const buildCurrentDetailFormalScope = ({
  authority = null,
  storeKeys = null,
  normalizeStoreKey = normalizeStoreLifecycleCore,
} = {}) => {
  if (!authority?.compatible || authority?.lifecycleReady !== true) {
    return {
      compatible: false,
      reason: authority?.reason || "LIFECYCLE_NOT_READY",
      cash: null,
      cashStatus: CURRENT_DETAIL_KPI_STATUS.LIFECYCLE_NOT_READY,
      accrual: null,
      accrualStatus: CURRENT_DETAIL_KPI_STATUS.LIFECYCLE_NOT_READY,
      cashTarget: null,
      cashTargetStatus: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE,
      accrualTarget: null,
      accrualTargetStatus: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE,
      cashAchievement: null,
      cashAchievementStatus: CURRENT_DETAIL_KPI_STATUS.LIFECYCLE_NOT_READY,
      accrualAchievement: null,
      accrualAchievementStatus: CURRENT_DETAIL_KPI_STATUS.LIFECYCLE_NOT_READY,
      reportingStatus: CURRENT_DETAIL_KPI_STATUS.LIFECYCLE_NOT_READY,
      rows: [],
    };
  }

  const requested = Array.isArray(storeKeys)
    ? new Set(storeKeys.map(normalizeStoreKey).filter(Boolean))
    : null;
  const rows = Object.values(authority.stores || {}).filter((row) => !requested || requested.has(normalizeStoreKey(row.storeKey)));
  const cash = sumStoreMetric(rows, "formalNetCash", "formalNetCashStatus");
  const accrual = sumStoreMetric(rows, "formalAccrual", "formalAccrualStatus");
  const cashTarget = buildScopeTarget({ rows, targetAuthority: authority.targetAuthority, targetKey: "cashTarget", targetStatusKey: "cashTargetStatus" });
  const accrualTarget = buildScopeTarget({ rows, targetAuthority: authority.targetAuthority, targetKey: "accrualTarget", targetStatusKey: "accrualTargetStatus" });
  const challengeCashTarget = buildScopeChallengeTarget({ rows, targetAuthority: authority.targetAuthority, targetKey: "challengeCashTarget", targetStatusKey: "challengeCashTargetStatus" });
  const challengeAccrualTarget = buildScopeChallengeTarget({ rows, targetAuthority: authority.targetAuthority, targetKey: "challengeAccrualTarget", targetStatusKey: "challengeAccrualTargetStatus" });
  const cashAchievement = buildAchievement({ actual: cash.value, actualStatus: cash.status, target: cashTarget.value, targetStatus: cashTarget.status });
  const accrualAchievement = buildAchievement({ actual: accrual.value, actualStatus: accrual.status, target: accrualTarget.value, targetStatus: accrualTarget.status });
  const challengeCashAchievement = buildAchievement({ actual: cash.value, actualStatus: cash.status, target: challengeCashTarget.value, targetStatus: challengeCashTarget.status });
  const challengeAccrualAchievement = buildAchievement({ actual: accrual.value, actualStatus: accrual.status, target: challengeAccrualTarget.value, targetStatus: challengeAccrualTarget.status });
  const reportingStatus = rows.some((row) => row.reportingStatus !== "DATA_COMPLETE")
    ? CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE
    : "DATA_COMPLETE";

  return {
    compatible: true,
    reason: "CURRENT_DETAIL_FORMAL_SCOPE_READY",
    rows,
    scopeStoreKeys: rows.map((row) => row.storeKey),
    scopeEligibleStoreCount: rows.length,
    reportingStatus,
    cash: cash.value,
    cashStatus: cash.status,
    accrual: accrual.value,
    accrualStatus: accrual.status,
    cashTarget: cashTarget.value,
    cashTargetStatus: cashTarget.status,
    accrualTarget: accrualTarget.value,
    accrualTargetStatus: accrualTarget.status,
    challengeCashTarget: challengeCashTarget.value,
    challengeCashTargetStatus: challengeCashTarget.status,
    challengeCashConfigured: challengeCashTarget.configured,
    challengeAccrualTarget: challengeAccrualTarget.value,
    challengeAccrualTargetStatus: challengeAccrualTarget.status,
    challengeAccrualConfigured: challengeAccrualTarget.configured,
    cashAchievement: cashAchievement.value,
    cashAchievementStatus: cashAchievement.status,
    accrualAchievement: accrualAchievement.value,
    accrualAchievementStatus: accrualAchievement.status,
    challengeCashAchievement: challengeCashAchievement.value,
    challengeCashAchievementStatus: challengeCashAchievement.status,
    challengeAccrualAchievement: challengeAccrualAchievement.value,
    challengeAccrualAchievementStatus: challengeAccrualAchievement.status,
    cashCoverageComplete: cashTarget.coverageComplete === true,
    accrualCoverageComplete: accrualTarget.coverageComplete === true,
    targetSummaryAvailable: authority.targetSummaryAvailable === true,
    targetCoverageConsistent: authority.targetAuthority?.coverageConsistent === true,
    skincareSales: rows.reduce((sum, row) => sum + Number(row.skincareSales || 0), 0),
    traffic: rows.reduce((sum, row) => sum + Number(row.traffic || 0), 0),
    newCustomers: rows.reduce((sum, row) => sum + Number(row.newCustomers || 0), 0),
    newCustomerSales: rows.reduce((sum, row) => sum + Number(row.newCustomerSales || 0), 0),
    newCustomerClosings: rows.reduce((sum, row) => sum + Number(row.newCustomerClosings || 0), 0),
    operationalAccrual: rows.reduce((sum, row) => sum + Number(row.operationalAccrual || 0), 0),
  };
};
