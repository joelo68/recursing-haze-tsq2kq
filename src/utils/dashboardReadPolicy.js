export const DASHBOARD_READ_MODE = Object.freeze({
  CURRENT_LIVE: "CURRENT_LIVE",
  LOADING: "LOADING",
  SUMMARY_TRUSTED: "SUMMARY_TRUSTED",
  DETAIL_FALLBACK: "DETAIL_FALLBACK",
  DIRTY_REFRESH: "DIRTY_REFRESH",
});

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

export const getSummaryRecalcFlagState = (recalcFlag = null) => {
  if (!recalcFlag || typeof recalcFlag !== "object") {
    return {
      status: "none",
      mismatchCount: 0,
      isVerified: false,
      isDirty: false,
    };
  }

  const status = normalizeStatus(recalcFlag.status);
  const mismatchCount = Number(recalcFlag.lastMismatchCount ?? recalcFlag.mismatchCount ?? 0);
  const isVerified = ["completed", "verified"].includes(status) &&
    recalcFlag.dirty !== true &&
    mismatchCount === 0;
  const isCompleteStatus = ["completed", "verified", "idle"].includes(status);
  const isDirty = recalcFlag.dirty === true || !isCompleteStatus || mismatchCount > 0;

  return {
    status: status || "none",
    mismatchCount,
    isVerified,
    isDirty,
  };
};

export const resolveHistoricalDashboardReadPolicy = ({
  isCurrentMonth = false,
  historicalRefreshRequested = false,
  reportSummaryReady = false,
  hasUsableDashboardSummary = false,
  summaryFlagReady = false,
  summaryFlag = null,
  summaryFlagError = null,
  systemExclusionTrusted = true,
  systemExclusionReason = "",
} = {}) => {
  if (isCurrentMonth) {
    return {
      mode: DASHBOARD_READ_MODE.CURRENT_LIVE,
      shouldLoadDailyReports: true,
      allowRawTargetFallback: true,
      summaryTrusted: false,
      reason: "CURRENT_MONTH_LIVE",
    };
  }

  if (historicalRefreshRequested) {
    return {
      mode: DASHBOARD_READ_MODE.DIRTY_REFRESH,
      shouldLoadDailyReports: true,
      allowRawTargetFallback: true,
      summaryTrusted: false,
      reason: "DIRTY_REFRESH_REQUESTED",
    };
  }

  if (!reportSummaryReady || !summaryFlagReady) {
    return {
      mode: DASHBOARD_READ_MODE.LOADING,
      shouldLoadDailyReports: false,
      allowRawTargetFallback: false,
      summaryTrusted: false,
      reason: "SUMMARY_TRUST_LOADING",
    };
  }

  if (summaryFlagError) {
    return {
      mode: DASHBOARD_READ_MODE.DETAIL_FALLBACK,
      shouldLoadDailyReports: true,
      allowRawTargetFallback: true,
      summaryTrusted: false,
      reason: "SUMMARY_FLAG_ERROR",
    };
  }

  if (!hasUsableDashboardSummary) {
    return {
      mode: DASHBOARD_READ_MODE.DETAIL_FALLBACK,
      shouldLoadDailyReports: true,
      allowRawTargetFallback: true,
      summaryTrusted: false,
      reason: "DASHBOARD_SUMMARY_MISSING",
    };
  }

  if (systemExclusionTrusted !== true) {
    return {
      mode: DASHBOARD_READ_MODE.DETAIL_FALLBACK,
      shouldLoadDailyReports: true,
      allowRawTargetFallback: true,
      summaryTrusted: false,
      reason: systemExclusionReason || "SYSTEM_EXCLUSION_REVISION_MISMATCH",
    };
  }

  const flagState = getSummaryRecalcFlagState(summaryFlag);
  if (flagState.isVerified) {
    return {
      mode: DASHBOARD_READ_MODE.SUMMARY_TRUSTED,
      shouldLoadDailyReports: false,
      allowRawTargetFallback: false,
      summaryTrusted: true,
      reason: "VERIFIED_SUMMARY",
    };
  }

  return {
    mode: DASHBOARD_READ_MODE.DETAIL_FALLBACK,
    shouldLoadDailyReports: true,
    allowRawTargetFallback: true,
    summaryTrusted: false,
    reason: flagState.isDirty ? "SUMMARY_DIRTY" : "SUMMARY_UNVERIFIED",
  };
};
