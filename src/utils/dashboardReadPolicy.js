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
  reportingCalendarTrusted = true,
  reportingCalendarReason = "",
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

  if (reportingCalendarTrusted !== true) {
    return {
      mode: DASHBOARD_READ_MODE.DETAIL_FALLBACK,
      shouldLoadDailyReports: true,
      allowRawTargetFallback: true,
      summaryTrusted: false,
      reason: reportingCalendarReason || "REPORTING_CALENDAR_REVISION_MISMATCH",
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
export const resolveHistoricalTherapistReadPolicy = ({
  isCurrentMonth = false,
  dashboardReadPolicy = null,
  therapistSummaryActive = false,
  therapistSummaryReady = false,
  therapistSummaryError = null,
  hasUsableTherapistSummary = false,
  preserveDetailFallback = false,
} = {}) => {
  if (isCurrentMonth || dashboardReadPolicy?.mode === DASHBOARD_READ_MODE.CURRENT_LIVE) {
    return {
      shouldLoadTherapistReports: true,
      summaryTrusted: false,
      reason: "CURRENT_MONTH_LIVE",
    };
  }

  // Store self-view may intentionally rely on excluded own-store detail semantics.
  // App currently preserves every store-role historical therapist detail path rather
  // than trying to reproduce that presentation-only scope decision in read topology.
  if (preserveDetailFallback) {
    return {
      shouldLoadTherapistReports: true,
      summaryTrusted: false,
      reason: "ROLE_DETAIL_SEMANTICS_PRESERVED",
    };
  }

  const mode = dashboardReadPolicy?.mode || "";
  if (mode === DASHBOARD_READ_MODE.DIRTY_REFRESH) {
    return {
      shouldLoadTherapistReports: true,
      summaryTrusted: false,
      reason: "DIRTY_REFRESH_REQUESTED",
    };
  }

  if (mode === DASHBOARD_READ_MODE.DETAIL_FALLBACK) {
    return {
      shouldLoadTherapistReports: true,
      summaryTrusted: false,
      reason: dashboardReadPolicy?.reason || "DASHBOARD_DETAIL_FALLBACK",
    };
  }

  if (mode === DASHBOARD_READ_MODE.LOADING) {
    return {
      shouldLoadTherapistReports: false,
      summaryTrusted: false,
      reason: "SUMMARY_TRUST_LOADING",
    };
  }

  if (mode === DASHBOARD_READ_MODE.SUMMARY_TRUSTED) {
    if (!therapistSummaryActive || !therapistSummaryReady) {
      return {
        shouldLoadTherapistReports: false,
        summaryTrusted: false,
        reason: "THERAPIST_SUMMARY_LOADING",
      };
    }

    if (therapistSummaryError || !hasUsableTherapistSummary) {
      return {
        shouldLoadTherapistReports: true,
        summaryTrusted: false,
        reason: therapistSummaryError ? "THERAPIST_SUMMARY_ERROR" : "THERAPIST_SUMMARY_MISSING",
      };
    }

    return {
      shouldLoadTherapistReports: false,
      summaryTrusted: true,
      reason: "VERIFIED_THERAPIST_SUMMARY",
    };
  }

  // Unknown policy state fails closed to the existing detail path.
  return {
    shouldLoadTherapistReports: true,
    summaryTrusted: false,
    reason: "UNKNOWN_DASHBOARD_READ_POLICY",
  };
};
