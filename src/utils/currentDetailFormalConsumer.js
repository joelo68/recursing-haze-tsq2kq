import {
  KPI_VALUE_STATUS,
  normalizeKpiBrandId,
  validBaseTarget,
  validChallengeTarget,
  validRatio,
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
import {
  normalizeSystemExclusionState,
  isSystemExclusionSnapshotCurrent,
} from "./systemExclusion.js";

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
    ? { value: result.value, status: result.status }
    : { value: null, status: result.status };
};

const buildChallengeTargetResult = (targetRow = {}, baseField = "cashTarget", challengeField = "challengeCashTarget") => {
  const base = validBaseTarget(targetRow?.[baseField]);
  if (!base.valid) return { value: null, status: base.status, configured: false };
  const challenge = validChallengeTarget(targetRow?.[baseField], targetRow?.[challengeField]);
  if (challenge.valid) return { value: challenge.value, status: KPI_VALUE_STATUS.VALID, configured: true };
  if (challenge.configured) return { value: null, status: challenge.status, configured: true };
  return { value: base.value, status: base.status, configured: false };
};

const buildAchievement = ({ actual, actualStatus, target, targetStatus }) => {
  if (!isValidNumericStatus(actualStatus) || !isFiniteNumber(actual)) {
    return { value: null, status: actualStatus || CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE };
  }
  if (!isValidNumericStatus(targetStatus) || !isFiniteNumber(target) || target < 0) {
    return { value: null, status: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE };
  }
  const ratio = validRatio(actual, target, { requirePositiveDenominator: true });
  if (!ratio.valid) {
    return { value: null, status: ratio.status };
  }
  return {
    value: ratio.value * 100,
    status: ratio.status,
  };
};

const mergeActualStatus = (statuses = []) => {
  if (statuses.some((status) => status === KPI_VALUE_STATUS.DATA_INVALID)) return KPI_VALUE_STATUS.DATA_INVALID;
  if (statuses.some((status) => status === CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE)) return CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE;
  if (statuses.some((status) => status === CURRENT_DETAIL_KPI_STATUS.LIFECYCLE_NOT_READY)) return CURRENT_DETAIL_KPI_STATUS.LIFECYCLE_NOT_READY;
  if (statuses.some((status) => status === KPI_VALUE_STATUS.FIELD_MISSING)) return KPI_VALUE_STATUS.FIELD_MISSING;
  return KPI_VALUE_STATUS.VALID;
};

const sumStoreMetric = (rows = [], valueKey, statusKey, options = {}) => {
  if (!rows.length) return { value: null, status: KPI_VALUE_STATUS.FIELD_MISSING };

  const allowIncomplete = options.allowIncomplete === true;
  const statuses = rows.map((row) => row?.[statusKey] || KPI_VALUE_STATUS.FIELD_MISSING);

  if (!allowIncomplete) {
    const status = mergeActualStatus(statuses);
    if (!isValidNumericStatus(status)) return { value: null, status };
    const value = rows.reduce((sum, row) => sum + Number(row?.[valueKey] || 0), 0);
    return { value, status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID };
  }

  // Live/current partial mode:
  // - DATA_INCOMPLETE rows represent stores that have no usable actual yet and
  //   are omitted from the observed subtotal.
  // - true invalid/missing/lifecycle failures remain blocking.
  const blockingStatuses = statuses.filter(
    (status) => status !== CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE
  );
  if (blockingStatuses.length > 0) {
    const blockingStatus = mergeActualStatus(blockingStatuses);
    if (!isValidNumericStatus(blockingStatus)) return { value: null, status: blockingStatus };
  }

  const numericRows = rows.filter((row) => (
    isValidNumericStatus(row?.[statusKey]) &&
    isFiniteNumber(row?.[valueKey])
  ));
  const malformedValidRow = rows.some((row) => (
    isValidNumericStatus(row?.[statusKey]) &&
    !isFiniteNumber(row?.[valueKey])
  ));
  if (malformedValidRow) return { value: null, status: KPI_VALUE_STATUS.DATA_INVALID };
  if (numericRows.length === 0) {
    return { value: null, status: CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE };
  }

  const value = numericRows.reduce((sum, row) => sum + Number(row[valueKey]), 0);
  return { value, status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID };
};

const buildScopeTarget = ({ rows = [], targetAuthority = {}, targetKey = "cashTarget", targetStatusKey = "cashTargetStatus" }) => {
  if (targetAuthority?.coverageConsistent !== true || rows.length === 0) {
    return { value: null, status: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE, coverageComplete: false };
  }
  const invalid = rows.filter((row) => !isValidNumericStatus(row?.[targetStatusKey]) || !isFiniteNumber(row?.[targetKey]) || row[targetKey] < 0);
  if (invalid.length > 0) {
    return {
      value: null,
      status: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE,
      coverageComplete: false,
      missingStoreKeys: invalid.map((row) => row.storeKey),
    };
  }
  const value = rows.reduce((sum, row) => sum + Number(row[targetKey]), 0);
  return { value, status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID, coverageComplete: true, missingStoreKeys: [] };
};

const buildScopeChallengeTarget = ({ rows = [], targetAuthority = {}, targetKey, targetStatusKey }) => {
  if (targetAuthority?.coverageConsistent !== true || rows.length === 0) {
    return { value: null, status: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE, coverageComplete: false, configured: false };
  }
  const invalid = rows.filter((row) => !isValidNumericStatus(row?.[targetStatusKey]) || !isFiniteNumber(row?.[targetKey]) || row[targetKey] < 0);
  if (invalid.length > 0) {
    return { value: null, status: CURRENT_DETAIL_KPI_STATUS.TARGET_INCOMPLETE, coverageComplete: false, configured: false };
  }
  const value = rows.reduce((sum, row) => sum + Number(row[targetKey]), 0);
  return {
    value,
    status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
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
  systemExclusionState = null,
  normalizeStoreKey = normalizeStoreLifecycleCore,
  now = new Date(),
} = {}) => {
  const normalizedBrandId = normalizeKpiBrandId(brandId);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  // Runtime stabilization:
  // only the live/current month may expose a known partial actual while reporting
  // completeness remains a separate DATA_INCOMPLETE status. Historical detail
  // fallback keeps the strict fail-closed contract.
  const allowPartialActuals = Boolean(
    normalizedYearMonth &&
    normalizedYearMonth === getTaipeiDate(now).slice(0, 7)
  );
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
  const exclusionState = systemExclusionState
    ? normalizeSystemExclusionState(systemExclusionState, normalizedBrandId, { ready: systemExclusionState.ready === true })
    : normalizeSystemExclusionState({}, normalizedBrandId, { ready: true });
  if (systemExclusionState && (exclusionState.ready !== true || exclusionState.brandId !== normalizedBrandId)) {
    return {
      version: CURRENT_DETAIL_FORMAL_CONSUMER_VERSION,
      compatible: false,
      reason: "SYSTEM_EXCLUSION_NOT_READY",
      brandId: normalizedBrandId,
      yearMonth: normalizedYearMonth,
      lifecycleReady: true,
      stores: {},
      eligibleStoreKeys: [],
      systemExcludedStoreKeys: exclusionState.stores || [],
      reportingStatus: CURRENT_DETAIL_KPI_STATUS.DATA_INCOMPLETE,
      targetAuthority: null,
    };
  }
  const lifecycleEligibleEntries = getLifecycleEligibleStoreEntries(normalizedMaster, normalizedYearMonth, {
    brandId: normalizedBrandId,
    requireReady: true,
  });
  const eligibleEntries = lifecycleEligibleEntries.filter((entry) => (
    !exclusionState.storeSet.has(normalizeStoreKey(entry.storeKey || entry.coreStoreName))
  ));
  const eligibleStoreKeys = eligibleEntries.map((entry) => normalizeStoreKey(entry.storeKey || entry.coreStoreName)).filter(Boolean);
  const entryByStore = new Map(eligibleEntries.map((entry) => [normalizeStoreKey(entry.storeKey || entry.coreStoreName), entry]));
  const formalMaster = {
    ...normalizedMaster,
    stores: Object.fromEntries(eligibleEntries.map((entry) => [entry.storeKey || entry.coreStoreName, entry])),
  };

  const effectiveCutoffDate = normalizeIsoDate(cutoffDate) || resolveCurrentDetailReportingCutoffDate(normalizedYearMonth, now);
  const reporting = buildLifecycleReportingCompleteness({
    master: formalMaster,
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
  const rawTargetCoverage = targetSummaryMatches
    ? extractTargetCoverageMetadata(monthlyTargetSummary)
    : {};
  const targetExclusionCurrent = isSystemExclusionSnapshotCurrent({
    snapshot: rawTargetCoverage?.systemExclusionSnapshot || null,
    currentState: exclusionState,
    brandId: normalizedBrandId,
  });
  const targetCoverage = targetExclusionCurrent
    ? rawTargetCoverage
    : { ...rawTargetCoverage, available: false };
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

    const hasNoExpectedReportDocument = expectedReportDayCount > 0 && storeReports.length === 0;
    if ((!allowPartialActuals && reportingStatus !== "DATA_COMPLETE") || hasNoExpectedReportDocument) {
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
      systemExcluded: false,
      formalScopeEligible: true,
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
        reportingStatus === "DATA_COMPLETE" &&
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
    allowPartialActuals,
    stores,
    eligibleStoreKeys,
    lifecycleEligibleStoreKeys: lifecycleEligibleEntries.map((entry) => normalizeStoreKey(entry.storeKey || entry.coreStoreName)).filter(Boolean),
    systemExcludedStoreKeys: exclusionState.stores || [],
    systemExclusionRevision: exclusionState.revision,
    reporting,
    reportingStatus: reporting.reportingStatus,
    targetSummaryAvailable: targetSummaryMatches,
    targetExclusionCurrent,
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
  const partialActualOptions = { allowIncomplete: authority.allowPartialActuals === true };
  const cash = sumStoreMetric(rows, "formalNetCash", "formalNetCashStatus", partialActualOptions);
  const accrual = sumStoreMetric(rows, "formalAccrual", "formalAccrualStatus", partialActualOptions);
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
