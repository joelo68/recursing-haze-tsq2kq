import { KPI_VALUE_STATUS } from "./kpiContracts.js";

export const DASHBOARD_LIVE_RANKING_SEMANTICS = "dashboard-live-cash-achievement-v1";

const VALID_NUMERIC_STATUSES = new Set([
  KPI_VALUE_STATUS.VALID,
  KPI_VALUE_STATUS.VALID_ZERO,
]);

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

export const getDashboardLiveRankEligibility = (row = {}) => {
  if (!isFiniteNumber(row?.formalNetCash) || !VALID_NUMERIC_STATUSES.has(row?.formalNetCashStatus)) {
    return {
      eligible: false,
      reason: "ACTUAL_UNAVAILABLE",
      label: "業績資料不足",
    };
  }

  if (row?.cashTargetStatus === KPI_VALUE_STATUS.VALID_ZERO) {
    return {
      eligible: false,
      reason: "TARGET_ZERO",
      label: "目標為 0",
    };
  }

  if (row?.cashTargetStatus === KPI_VALUE_STATUS.TARGET_NOT_SET) {
    return {
      eligible: false,
      reason: "TARGET_NOT_SET",
      label: "目標未設定",
    };
  }

  if (row?.cashTargetStatus !== KPI_VALUE_STATUS.VALID || !isFiniteNumber(row?.cashTarget) || row.cashTarget <= 0) {
    return {
      eligible: false,
      reason: "TARGET_INVALID",
      label: "目標資料待確認",
    };
  }

  if (!isFiniteNumber(row?.cashAchievement) || !VALID_NUMERIC_STATUSES.has(row?.cashAchievementStatus)) {
    return {
      eligible: false,
      reason: "ACHIEVEMENT_UNAVAILABLE",
      label: "達成率無法計算",
    };
  }

  const reportingIncomplete = String(row?.reportingStatus || "") !== "DATA_COMPLETE";
  return {
    eligible: true,
    reason: reportingIncomplete ? "PARTIAL_REPORTING" : "READY",
    label: reportingIncomplete ? "回報未完整" : "可排名",
    reportingIncomplete,
  };
};

export const buildDashboardLiveRanking = ({
  rows = [],
  normalizeStoreKey = (value) => String(value || "").trim(),
} = {}) => {
  const scopedRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.formalScopeEligible !== false)
    .map((row, scopeIndex) => {
      const storeKey = normalizeStoreKey(row?.storeKey || row?.canonicalStoreName || "");
      const eligibility = getDashboardLiveRankEligibility(row);
      return {
        row,
        storeKey,
        scopeIndex,
        eligibility,
      };
    })
    .filter((item) => item.storeKey);

  const rankable = scopedRows
    .filter((item) => item.eligibility.eligible)
    .sort((a, b) => {
      if (b.row.cashAchievement !== a.row.cashAchievement) {
        return b.row.cashAchievement - a.row.cashAchievement;
      }
      if (b.row.formalNetCash !== a.row.formalNetCash) {
        return b.row.formalNetCash - a.row.formalNetCash;
      }
      return String(a.storeKey).localeCompare(String(b.storeKey), "zh-Hant");
    });

  const rankByStore = new Map();
  rankable.forEach((item, index) => {
    rankByStore.set(item.storeKey, index + 1);
  });

  const liveRankEligibleStoreCount = rankable.length;
  const scopeStoreCount = scopedRows.length;

  const resultRows = scopedRows
    .map((item) => ({
      ...item.row,
      dashboardLiveRankEligible: item.eligibility.eligible,
      dashboardLiveRankReason: item.eligibility.reason,
      dashboardLiveRankLabel: item.eligibility.label,
      reportingIncomplete: item.eligibility.reportingIncomplete === true,
      dashboardLiveCashAchievementRank: rankByStore.get(item.storeKey) || null,
      dashboardLiveRankEligibleStoreCount: liveRankEligibleStoreCount,
      dashboardLiveScopeStoreCount: scopeStoreCount,
      __scopeIndex: item.scopeIndex,
    }))
    .sort((a, b) => {
      const aRank = Number(a.dashboardLiveCashAchievementRank || 0);
      const bRank = Number(b.dashboardLiveCashAchievementRank || 0);
      if (aRank > 0 && bRank > 0) return aRank - bRank;
      if (aRank > 0) return -1;
      if (bRank > 0) return 1;
      return Number(a.__scopeIndex || 0) - Number(b.__scopeIndex || 0);
    })
    .map(({ __scopeIndex, ...row }) => row);

  return {
    semantics: DASHBOARD_LIVE_RANKING_SEMANTICS,
    scopeStoreCount,
    liveRankEligibleStoreCount,
    rows: resultRows,
  };
};
