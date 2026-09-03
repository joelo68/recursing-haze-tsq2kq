import { KPI_CONTRACT_VERSION, KPI_VALUE_STATUS, validBaseTarget } from "./kpiContracts.js";
import { SUMMARY_SEMANTIC_VERSION } from "./summarySemantics.js";
import { buildHistoricalFormalDashboardScope, isFormalDashboardSummaryCompatible } from "./dashboardFormalConsumer.js";
import { getSummaryRecalcFlagState } from "./dashboardReadPolicy.js";
import { inspectHistoricalSystemExclusionTrust } from "./systemExclusion.js";

export const RANKINGS_SUMMARY_VERSION = "rankings-summary-v1";

const normalizeText = (value = "") => String(value || "").trim();
const normalizeBrandId = (value = "") => normalizeText(value).toLowerCase();
const isValidNumericStatus = (status) => (
  status === KPI_VALUE_STATUS.VALID || status === KPI_VALUE_STATUS.VALID_ZERO
);

const readFormalMetric = (row = {}, valueKey, statusKey) => {
  const status = String(row?.[statusKey] || KPI_VALUE_STATUS.FIELD_MISSING);
  const raw = row?.[valueKey];
  const value = raw === null || raw === undefined || raw === "" ? null : Number(raw);
  if (!isValidNumericStatus(status) || !Number.isFinite(value)) {
    return { value: null, status };
  }
  return { value, status };
};

const readFormalTarget = (row = {}, valueKey, statusKey) => {
  const status = String(row?.[statusKey] || KPI_VALUE_STATUS.TARGET_NOT_SET);
  const target = validBaseTarget(row?.[valueKey]);
  if (!target.valid || !isValidNumericStatus(status)) {
    return { value: null, status: target.valid ? status : target.status };
  }
  return { value: target.value, status };
};

const readFormalAchievement = (row = {}, valueKey, statusKey) => {
  const status = String(row?.[statusKey] || KPI_VALUE_STATUS.DATA_INVALID);
  const raw = row?.[valueKey];
  const value = raw === null || raw === undefined || raw === "" ? null : Number(raw);
  if (!isValidNumericStatus(status) || !Number.isFinite(value)) {
    return { value: null, status };
  }
  return { value, status };
};

const normalizeStoreEntries = (stores = {}) => (
  Array.isArray(stores)
    ? stores.map((row, index) => [String(index), row])
    : Object.entries(stores && typeof stores === "object" ? stores : {})
);

const getStoreKey = (row = {}, fallbackKey = "", normalizeStoreKey = normalizeText) => normalizeStoreKey(
  row?.store || row?.storeName || row?.coreStoreName || row?.displayName || row?.name || fallbackKey
);

const buildManagerByStore = (managers = {}, normalizeStoreKey = normalizeText) => {
  const map = {};
  Object.entries(managers || {}).forEach(([manager, stores]) => {
    (Array.isArray(stores) ? stores : []).forEach((storeName) => {
      const key = normalizeStoreKey(storeName);
      if (key) map[key] = manager;
    });
  });
  return map;
};

export const isFormalRankingsSummaryCompatible = (summary = {}) => {
  if (String(summary?.version || "") !== RANKINGS_SUMMARY_VERSION) return false;
  if (String(summary?.semanticVersion || "") !== SUMMARY_SEMANTIC_VERSION) return false;
  if (String(summary?.kpiContractVersion || "") !== KPI_CONTRACT_VERSION) return false;
  if (!Array.isArray(summary?.formalStoreRankings)) return false;
  const count = Number(summary?.formalRankEligibleStoreCount);
  if (!Number.isFinite(count) || count < 0) return false;
  return summary.formalStoreRankings.length === count;
};

export const isFormalReportSummaryPairCompatible = ({
  dashboardSummary = {},
  rankingsSummary = {},
  yearMonth = "",
  brandId = "",
} = {}) => {
  if (!isFormalDashboardSummaryCompatible(dashboardSummary)) return false;
  if (!isFormalRankingsSummaryCompatible(rankingsSummary)) return false;

  const expectedMonth = normalizeText(yearMonth);
  const dashboardMonth = normalizeText(dashboardSummary?.yearMonth || dashboardSummary?.id);
  const rankingsMonth = normalizeText(rankingsSummary?.yearMonth || rankingsSummary?.id);
  if (expectedMonth && (dashboardMonth !== expectedMonth || rankingsMonth !== expectedMonth)) return false;
  if (dashboardMonth && rankingsMonth && dashboardMonth !== rankingsMonth) return false;

  const expectedBrand = normalizeBrandId(brandId);
  const dashboardBrand = normalizeBrandId(dashboardSummary?.brandId);
  const rankingsBrand = normalizeBrandId(rankingsSummary?.brandId);
  if (expectedBrand && (dashboardBrand !== expectedBrand || rankingsBrand !== expectedBrand)) return false;
  if (dashboardBrand && rankingsBrand && dashboardBrand !== rankingsBrand) return false;

  const dashboardCount = Number(dashboardSummary?.formalRankEligibleStoreCount);
  const rankingsCount = Number(rankingsSummary?.formalRankEligibleStoreCount);
  if (!Number.isFinite(dashboardCount) || dashboardCount < 0 || dashboardCount !== rankingsCount) return false;
  if (!Array.isArray(dashboardSummary?.formalStoreRankings) || dashboardSummary.formalStoreRankings.length !== dashboardCount) return false;

  return true;
};

export const resolveHistoricalReportFormalTrust = ({
  isCurrentMonth = false,
  yearMonth = "",
  brandId = "",
  dashboardSummary = null,
  rankingsSummary = null,
  reportSummaryReady = false,
  reportSummaryReadyYearMonth = "",
  reportSummaryReadyBrandId = "",
  summaryFlagState = null,
  systemExclusionState,
} = {}) => {
  if (isCurrentMonth) return { trusted: false, loading: false, reason: "CURRENT_MONTH_LIVE" };

  const expectedMonth = normalizeText(yearMonth);
  const expectedBrand = normalizeBrandId(brandId);
  const readyMonth = normalizeText(reportSummaryReadyYearMonth);
  const readyBrand = normalizeBrandId(reportSummaryReadyBrandId);
  const flagMonth = normalizeText(summaryFlagState?.yearMonth);
  const flagBrand = normalizeBrandId(summaryFlagState?.brandId);

  if (!reportSummaryReady || !summaryFlagState?.ready) {
    return { trusted: false, loading: true, reason: "SUMMARY_TRUST_LOADING" };
  }
  if ((expectedMonth && readyMonth !== expectedMonth) || (expectedBrand && readyBrand !== expectedBrand)) {
    return { trusted: false, loading: true, reason: "SUMMARY_READY_ANCHOR_MISMATCH" };
  }
  if ((expectedMonth && flagMonth !== expectedMonth) || (expectedBrand && flagBrand !== expectedBrand)) {
    return { trusted: false, loading: true, reason: "SUMMARY_FLAG_ANCHOR_MISMATCH" };
  }
  if (summaryFlagState?.error) {
    return { trusted: false, loading: false, reason: "SUMMARY_FLAG_ERROR" };
  }
  if (!isFormalReportSummaryPairCompatible({ dashboardSummary, rankingsSummary, yearMonth, brandId })) {
    return { trusted: false, loading: false, reason: "FORMAL_SUMMARY_CONTRACT_MISSING" };
  }

  if (systemExclusionState !== undefined) {
    const exclusionTrust = inspectHistoricalSystemExclusionTrust({
      currentState: systemExclusionState,
      brandId: expectedBrand,
      summaries: [dashboardSummary, rankingsSummary],
      summaryFlag: summaryFlagState?.data || null,
    });
    if (!exclusionTrust.trusted) {
      return { trusted: false, loading: false, reason: exclusionTrust.reason };
    }
  }

  const flag = getSummaryRecalcFlagState(summaryFlagState?.data || null);
  if (!flag.isVerified) {
    return { trusted: false, loading: false, reason: flag.isDirty ? "SUMMARY_DIRTY" : "SUMMARY_UNVERIFIED" };
  }
  return { trusted: true, loading: false, reason: "VERIFIED_FORMAL_SUMMARY" };
};

export const buildHistoricalFormalRankingRows = ({
  dashboardSummary = {},
  rankingsSummary = {},
  managers = {},
  auditExclusions = [],
  normalizeStoreKey = normalizeText,
  getDisplayName = (row, fallbackKey) => normalizeText(row?.displayName || row?.store || row?.storeName || fallbackKey),
  brandPrefix = "",
} = {}) => {
  if (!isFormalReportSummaryPairCompatible({ dashboardSummary, rankingsSummary })) {
    return { compatible: false, rows: [], rankEligibleStoreCount: 0 };
  }

  const managerByStore = buildManagerByStore(managers, normalizeStoreKey);
  const excluded = new Set((auditExclusions || []).map(normalizeStoreKey).filter(Boolean));
  const storeMap = new Map();
  normalizeStoreEntries(dashboardSummary?.stores).forEach(([fallbackKey, row]) => {
    if (!row || typeof row !== "object") return;
    const key = getStoreKey(row, fallbackKey, normalizeStoreKey);
    if (!key) return;
    storeMap.set(key, { row, fallbackKey });
  });

  const formalRankingEntries = (rankingsSummary?.formalStoreRankings || [])
    .map((row) => ({ row, key: getStoreKey(row, "", normalizeStoreKey) }))
    .filter(({ key, row }) => key && row?.formalRankEligible === true && !excluded.has(key))
    .sort((a, b) => {
      const rankA = Number(a.row?.formalCashAchievementRank);
      const rankB = Number(b.row?.formalCashAchievementRank);
      if (Number.isFinite(rankA) && Number.isFinite(rankB) && rankA !== rankB) return rankA - rankB;
      return String(a.key).localeCompare(String(b.key), "zh-Hant");
    });

  const rankMap = new Map();
  formalRankingEntries.forEach(({ key, row }, index) => {
    rankMap.set(key, { ...row, presentationRank: index + 1 });
  });

  const rows = [];
  storeMap.forEach(({ row, fallbackKey }, key) => {
    if (excluded.has(key) || row?.formalLifecycleEligible !== true) return;

    const cash = readFormalMetric(row, "formalNetCash", "formalNetCashStatus");
    const accrual = readFormalMetric(row, "formalAccrual", "formalAccrualStatus");
    const accrualTarget = readFormalTarget(row, "formalAccrualTarget", "formalAccrualTargetStatus");
    const accrualAchievement = readFormalAchievement(row, "formalAccrualAchievement", "formalAccrualAchievementStatus");
    const rankEntry = rankMap.get(key) || null;
    const cashTarget = readFormalTarget(row, "formalCashTarget", "formalCashTargetStatus");
    const cashAchievement = rankEntry
      ? readFormalAchievement(rankEntry, "formalCashAchievement", "formalCashAchievementStatus")
      : readFormalAchievement(row, "formalCashAchievement", "formalCashAchievementStatus");

    const displayName = getDisplayName(row, fallbackKey) || key;
    const cleanDisplayName = normalizeStoreKey(displayName) || key;
    const operationalAccrual = Number(row?.operationalAccrual ?? row?.operationalAccrualTotal ?? 0);
    const traffic = Number(row?.traffic ?? row?.trafficTotal ?? 0);

    rows.push({
      name: brandPrefix ? `${brandPrefix}${cleanDisplayName}店` : displayName,
      displayName: cleanDisplayName,
      manager: row?.manager || managerByStore[key] || "未分配",
      cashTotal: cash.value,
      cashStatus: cash.status,
      accrualTotal: accrual.value,
      accrualStatus: accrual.status,
      cashTarget: cashTarget.value,
      cashTargetStatus: cashTarget.status,
      achievement: cashAchievement.value,
      achievementStatus: cashAchievement.status,
      accrualTarget: accrualTarget.value,
      accrualTargetStatus: accrualTarget.status,
      accrualAchievement: accrualAchievement.value,
      accrualAchievementStatus: accrualAchievement.status,
      formalRankEligible: Boolean(rankEntry),
      formalCashAchievementRank: rankEntry?.formalCashAchievementRank ?? null,
      rank: rankEntry?.presentationRank ?? null,
      skincareSalesTotal: Number(row?.skincareSales ?? row?.skincareSalesTotal ?? 0),
      trafficTotal: traffic,
      newCustomersTotal: Number(row?.newCustomers ?? row?.newCustomersTotal ?? 0),
      newCustomerSalesTotal: Number(row?.newCustomerSales ?? row?.newCustomerRevenue ?? row?.newCustomerSalesTotal ?? 0),
      newCustomerClosingsTotal: Number(row?.newCustomerClosings ?? row?.newCustomerClosingsTotal ?? 0),
      operationalAccrualTotal: Number.isFinite(operationalAccrual) ? operationalAccrual : 0,
      trafficASP: traffic > 0 && Number.isFinite(operationalAccrual) ? Math.round(operationalAccrual / traffic) : 0,
      source: "formal_dashboard_summary",
    });
  });

  rows.sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return String(a.displayName).localeCompare(String(b.displayName), "zh-Hant");
  });

  return {
    compatible: true,
    rows,
    rankEligibleStoreCount: formalRankingEntries.length,
    sourceRankEligibleStoreCount: Number(rankingsSummary?.formalRankEligibleStoreCount || 0),
  };
};

export const buildHistoricalFormalRegionalData = ({
  dashboardSummary = {},
  monthlyTargetSummary = null,
  managers = {},
  normalizeStoreKey = normalizeText,
  getDisplayName = (row, fallbackKey) => normalizeText(row?.displayName || row?.store || row?.storeName || fallbackKey),
  brandPrefix = "",
} = {}) => {
  if (!isFormalDashboardSummaryCompatible(dashboardSummary)) {
    return { compatible: false, regions: [] };
  }

  const summaryStoreMap = new Map();
  normalizeStoreEntries(dashboardSummary?.stores).forEach(([fallbackKey, row]) => {
    if (!row || typeof row !== "object") return;
    const key = getStoreKey(row, fallbackKey, normalizeStoreKey);
    if (key) summaryStoreMap.set(key, row);
  });

  const regions = Object.entries(managers || {}).map(([managerName, storeNames]) => {
    const scopedRows = (Array.isArray(storeNames) ? storeNames : [])
      .map((storeName) => summaryStoreMap.get(normalizeStoreKey(storeName)))
      .filter((row) => row?.formalLifecycleEligible === true);

    const scope = buildHistoricalFormalDashboardScope({
      summary: dashboardSummary,
      stores: scopedRows,
      monthlyTargetSummary,
      normalizeStoreKey,
      filtered: true,
    });

    const stores = scopedRows.map((row) => {
      const key = getStoreKey(row, "", normalizeStoreKey);
      const cash = readFormalMetric(row, "formalNetCash", "formalNetCashStatus");
      const accrual = readFormalMetric(row, "formalAccrual", "formalAccrualStatus");
      const cashTarget = readFormalTarget(row, "formalCashTarget", "formalCashTargetStatus");
      const cashAchievement = readFormalAchievement(row, "formalCashAchievement", "formalCashAchievementStatus");
      const accrualTarget = readFormalTarget(row, "formalAccrualTarget", "formalAccrualTargetStatus");
      const accrualAchievement = readFormalAchievement(row, "formalAccrualAchievement", "formalAccrualAchievementStatus");
      const display = normalizeStoreKey(getDisplayName(row, key)) || key;
      return {
        name: brandPrefix ? `${brandPrefix}${display}店` : getDisplayName(row, key),
        cleanName: display,
        cashTotal: cash.value,
        cashStatus: cash.status,
        accrualTotal: accrual.value,
        accrualStatus: accrual.status,
        budget: cashTarget.value,
        budgetStatus: cashTarget.status,
        achievement: cashAchievement.value,
        achievementStatus: cashAchievement.status,
        accrualTarget: accrualTarget.value,
        accrualTargetStatus: accrualTarget.status,
        accrualAchievement: accrualAchievement.value,
        accrualAchievementStatus: accrualAchievement.status,
        source: "formal_dashboard_summary",
      };
    });

    return {
      manager: managerName || "未命名",
      stores,
      cashTotal: scope.cash,
      cashStatus: scope.cashStatus,
      accrualTotal: scope.accrual,
      accrualStatus: scope.accrualStatus,
      skincareSalesTotal: scopedRows.reduce((sum, row) => sum + Number(row?.skincareSales ?? row?.skincareSalesTotal ?? 0), 0),
      trafficTotal: scopedRows.reduce((sum, row) => sum + Number(row?.traffic ?? row?.trafficTotal ?? 0), 0),
      newCustomersTotal: scopedRows.reduce((sum, row) => sum + Number(row?.newCustomers ?? row?.newCustomersTotal ?? 0), 0),
      newCustomerClosingsTotal: scopedRows.reduce((sum, row) => sum + Number(row?.newCustomerClosings ?? row?.newCustomerClosingsTotal ?? 0), 0),
      budgetTotal: scope.cashTarget,
      budgetStatus: scope.cashTargetStatus,
      achievement: scope.cashAchievement,
      achievementStatus: scope.cashAchievementStatus,
      cashCoverageComplete: scope.cashCoverageComplete,
      accrualCoverageComplete: scope.accrualCoverageComplete,
      source: "formal_dashboard_summary",
    };
  });

  return {
    compatible: true,
    regions: regions.sort((a, b) => {
      const aValue = a.cashTotal !== null && a.cashTotal !== undefined && Number.isFinite(Number(a.cashTotal))
        ? Number(a.cashTotal)
        : Number.NEGATIVE_INFINITY;
      const bValue = b.cashTotal !== null && b.cashTotal !== undefined && Number.isFinite(Number(b.cashTotal))
        ? Number(b.cashTotal)
        : Number.NEGATIVE_INFINITY;
      if (bValue !== aValue) return bValue - aValue;
      return String(a.manager).localeCompare(String(b.manager), "zh-Hant");
    }),
  };
};
