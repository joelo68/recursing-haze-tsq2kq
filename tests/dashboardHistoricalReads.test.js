import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DASHBOARD_READ_MODE,
  getSummaryRecalcFlagState,
  resolveHistoricalDashboardReadPolicy,
  resolveHistoricalTherapistReadPolicy,
} from "../src/utils/dashboardReadPolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const hookSource = fs.readFileSync(path.join(root, "src/hooks/useDashboardStats.js"), "utf8");

const verifiedFlag = {
  status: "verified",
  dirty: false,
  lastMismatchCount: 0,
};

test("verified historical summary suppresses daily report and raw target reads", () => {
  const result = resolveHistoricalDashboardReadPolicy({
    isCurrentMonth: false,
    reportSummaryReady: true,
    hasUsableDashboardSummary: true,
    summaryFlagReady: true,
    summaryFlag: verifiedFlag,
  });

  assert.equal(result.mode, DASHBOARD_READ_MODE.SUMMARY_TRUSTED);
  assert.equal(result.shouldLoadDailyReports, false);
  assert.equal(result.allowRawTargetFallback, false);
  assert.equal(result.summaryTrusted, true);
});

test("stale System Exclusion revision forces historical detail/raw fallback", () => {
  const result = resolveHistoricalDashboardReadPolicy({
    isCurrentMonth: false,
    reportSummaryReady: true,
    hasUsableDashboardSummary: true,
    summaryFlagReady: true,
    summaryFlag: verifiedFlag,
    systemExclusionTrusted: false,
    systemExclusionReason: "SYSTEM_EXCLUSION_SUMMARY_REVISION_MISMATCH",
  });
  assert.equal(result.mode, DASHBOARD_READ_MODE.DETAIL_FALLBACK);
  assert.equal(result.shouldLoadDailyReports, true);
  assert.equal(result.allowRawTargetFallback, true);
  assert.equal(result.summaryTrusted, false);
  assert.equal(result.reason, "SYSTEM_EXCLUSION_SUMMARY_REVISION_MISMATCH");
});

test("stale Reporting Calendar month revision forces historical detail/raw fallback", () => {
  const result = resolveHistoricalDashboardReadPolicy({
    isCurrentMonth: false,
    reportSummaryReady: true,
    hasUsableDashboardSummary: true,
    summaryFlagReady: true,
    summaryFlag: verifiedFlag,
    reportingCalendarTrusted: false,
    reportingCalendarReason: "REPORTING_CALENDAR_SUMMARY_REVISION_MISMATCH",
  });
  assert.equal(result.mode, DASHBOARD_READ_MODE.DETAIL_FALLBACK);
  assert.equal(result.shouldLoadDailyReports, true);
  assert.equal(result.allowRawTargetFallback, true);
  assert.equal(result.summaryTrusted, false);
  assert.equal(result.reason, "REPORTING_CALENDAR_SUMMARY_REVISION_MISMATCH");
});

test("summary loading does not eagerly trigger historical raw reads", () => {
  const result = resolveHistoricalDashboardReadPolicy({
    isCurrentMonth: false,
    reportSummaryReady: false,
    hasUsableDashboardSummary: false,
    summaryFlagReady: false,
  });

  assert.equal(result.mode, DASHBOARD_READ_MODE.LOADING);
  assert.equal(result.shouldLoadDailyReports, false);
  assert.equal(result.allowRawTargetFallback, false);
});

test("dirty-triggered refresh keeps one-shot detail fallback available", () => {
  const result = resolveHistoricalDashboardReadPolicy({
    isCurrentMonth: false,
    historicalRefreshRequested: true,
    reportSummaryReady: true,
    hasUsableDashboardSummary: true,
    summaryFlagReady: true,
    summaryFlag: { status: "dirty", dirty: true },
  });

  assert.equal(result.mode, DASHBOARD_READ_MODE.DIRTY_REFRESH);
  assert.equal(result.shouldLoadDailyReports, true);
  assert.equal(result.allowRawTargetFallback, true);
});

test("current month keeps live/detail reads unchanged", () => {
  const result = resolveHistoricalDashboardReadPolicy({
    isCurrentMonth: true,
    reportSummaryReady: true,
    hasUsableDashboardSummary: true,
    summaryFlagReady: true,
    summaryFlag: verifiedFlag,
  });

  assert.equal(result.mode, DASHBOARD_READ_MODE.CURRENT_LIVE);
  assert.equal(result.shouldLoadDailyReports, true);
  assert.equal(result.allowRawTargetFallback, true);
});


test("verified historical therapist Summary suppresses whole-month detail reads after therapist summary is ready", () => {
  const dashboardPolicy = resolveHistoricalDashboardReadPolicy({
    isCurrentMonth: false,
    reportSummaryReady: true,
    hasUsableDashboardSummary: true,
    summaryFlagReady: true,
    summaryFlag: verifiedFlag,
  });
  const result = resolveHistoricalTherapistReadPolicy({
    isCurrentMonth: false,
    dashboardReadPolicy: dashboardPolicy,
    therapistSummaryActive: true,
    therapistSummaryReady: true,
    hasUsableTherapistSummary: true,
  });

  assert.equal(result.shouldLoadTherapistReports, false);
  assert.equal(result.summaryTrusted, true);
  assert.equal(result.reason, "VERIFIED_THERAPIST_SUMMARY");
});

test("historical therapist Summary loading waits instead of eagerly reading detail", () => {
  const dashboardPolicy = resolveHistoricalDashboardReadPolicy({
    isCurrentMonth: false,
    reportSummaryReady: true,
    hasUsableDashboardSummary: true,
    summaryFlagReady: true,
    summaryFlag: verifiedFlag,
  });
  const result = resolveHistoricalTherapistReadPolicy({
    dashboardReadPolicy: dashboardPolicy,
    therapistSummaryActive: false,
    therapistSummaryReady: true,
    hasUsableTherapistSummary: false,
  });

  assert.equal(result.shouldLoadTherapistReports, false);
  assert.equal(result.reason, "THERAPIST_SUMMARY_LOADING");
});

test("missing or failed historical therapist Summary falls back to therapist detail", () => {
  const dashboardPolicy = resolveHistoricalDashboardReadPolicy({
    isCurrentMonth: false,
    reportSummaryReady: true,
    hasUsableDashboardSummary: true,
    summaryFlagReady: true,
    summaryFlag: verifiedFlag,
  });

  const missing = resolveHistoricalTherapistReadPolicy({
    dashboardReadPolicy: dashboardPolicy,
    therapistSummaryActive: true,
    therapistSummaryReady: true,
    hasUsableTherapistSummary: false,
  });
  assert.equal(missing.shouldLoadTherapistReports, true);
  assert.equal(missing.reason, "THERAPIST_SUMMARY_MISSING");

  const failed = resolveHistoricalTherapistReadPolicy({
    dashboardReadPolicy: dashboardPolicy,
    therapistSummaryActive: true,
    therapistSummaryReady: true,
    therapistSummaryError: new Error("listener failed"),
    hasUsableTherapistSummary: false,
  });
  assert.equal(failed.shouldLoadTherapistReports, true);
  assert.equal(failed.reason, "THERAPIST_SUMMARY_ERROR");
});

test("dirty historical therapist refresh and current month preserve raw detail authority", () => {
  const dirtyPolicy = resolveHistoricalDashboardReadPolicy({
    isCurrentMonth: false,
    historicalRefreshRequested: true,
    reportSummaryReady: true,
    hasUsableDashboardSummary: true,
    summaryFlagReady: true,
    summaryFlag: { status: "dirty", dirty: true },
  });
  const dirty = resolveHistoricalTherapistReadPolicy({
    dashboardReadPolicy: dirtyPolicy,
    therapistSummaryActive: true,
    therapistSummaryReady: true,
    hasUsableTherapistSummary: true,
  });
  assert.equal(dirty.shouldLoadTherapistReports, true);
  assert.equal(dirty.reason, "DIRTY_REFRESH_REQUESTED");

  const current = resolveHistoricalTherapistReadPolicy({
    isCurrentMonth: true,
    dashboardReadPolicy: { mode: DASHBOARD_READ_MODE.CURRENT_LIVE },
    therapistSummaryActive: false,
    therapistSummaryReady: true,
  });
  assert.equal(current.shouldLoadTherapistReports, true);
  assert.equal(current.reason, "CURRENT_MONTH_LIVE");
});

test("store role can preserve historical therapist detail semantics until self-view scope is shared upstream", () => {
  const dashboardPolicy = resolveHistoricalDashboardReadPolicy({
    isCurrentMonth: false,
    reportSummaryReady: true,
    hasUsableDashboardSummary: true,
    summaryFlagReady: true,
    summaryFlag: verifiedFlag,
  });
  const result = resolveHistoricalTherapistReadPolicy({
    dashboardReadPolicy: dashboardPolicy,
    therapistSummaryActive: true,
    therapistSummaryReady: true,
    hasUsableTherapistSummary: true,
    preserveDetailFallback: true,
  });
  assert.equal(result.shouldLoadTherapistReports, true);
  assert.equal(result.reason, "ROLE_DETAIL_SEMANTICS_PRESERVED");
});

test("missing or unverified historical summary fails closed to detail fallback", () => {
  const missing = resolveHistoricalDashboardReadPolicy({
    reportSummaryReady: true,
    hasUsableDashboardSummary: false,
    summaryFlagReady: true,
    summaryFlag: verifiedFlag,
  });
  assert.equal(missing.mode, DASHBOARD_READ_MODE.DETAIL_FALLBACK);
  assert.equal(missing.shouldLoadDailyReports, true);

  const unverified = resolveHistoricalDashboardReadPolicy({
    reportSummaryReady: true,
    hasUsableDashboardSummary: true,
    summaryFlagReady: true,
    summaryFlag: { status: "idle", dirty: false, lastMismatchCount: 0 },
  });
  assert.equal(unverified.mode, DASHBOARD_READ_MODE.DETAIL_FALLBACK);
  assert.equal(unverified.shouldLoadDailyReports, true);
});

test("mismatch flag is never trusted", () => {
  const state = getSummaryRecalcFlagState({
    status: "verified",
    dirty: false,
    lastMismatchCount: 1,
  });
  assert.equal(state.isVerified, false);
  assert.equal(state.isDirty, true);
});

test("App owns historical therapist Summary-first read topology while useDashboardStats only consumes published state", () => {
  assert.match(appSource, /resolveHistoricalTherapistReadPolicy/);
  assert.match(appSource, /useDashboardTherapistSummary\(\{/);
  assert.match(appSource, /therapistSummaryState/);
  assert.match(appSource, /historicalTherapistReadPolicy\.shouldLoadTherapistReports/);
  assert.match(appSource, /preserveDetailFallback:\s*userRole === "store"/);

  assert.doesNotMatch(hookSource, /useDashboardTherapistSummary\(\{/);
  assert.match(hookSource, /therapistSummaryState/);
});

test("App is the sole historical read-policy owner for Dashboard daily_reports", () => {
  assert.match(appSource, /resolveHistoricalDashboardReadPolicy/);
  assert.match(appSource, /dashboardReadPolicy\.shouldLoadDailyReports/);
  assert.match(appSource, /currentSummaryRecalcFlagState/);
  assert.match(appSource, /inspectHistoricalSystemExclusionTrust/);
  assert.match(appSource, /systemExclusionTrusted: systemExclusionTrust\.trusted/);
  assert.match(appSource, /inspectHistoricalReportingCalendarTrust/);
  assert.match(appSource, /reportingCalendarTrusted: reportingCalendarTrust\.trusted/);

  assert.doesNotMatch(hookSource, /dashboardTargetReadPolicy/);
  assert.doesNotMatch(hookSource, /resolveHistoricalDashboardReadPolicy/);
  assert.doesNotMatch(hookSource, /inspectHistoricalReportingCalendarTrust/);
});

test("Dashboard hook no longer listens to recalc_queue or maintenance_logs", () => {
  assert.doesNotMatch(hookSource, /getCollectionPath\("recalc_queue"\)/);
  assert.doesNotMatch(hookSource, /getCollectionPath\("maintenance_logs"\)/);
});

test("Dashboard hook reuses App dashboard, rankings and flag sources instead of duplicate listeners", () => {
  assert.doesNotMatch(hookSource, /onSnapshot\(doc\(getCollectionPath\("dashboard_summary"\)/);
  assert.doesNotMatch(hookSource, /onSnapshot\(doc\(getCollectionPath\("rankings_summary"\)/);
  assert.doesNotMatch(hookSource, /onSnapshot\(doc\(getCollectionPath\("summary_recalc_flags"\)/);
  assert.match(hookSource, /currentDashboardSummary/);
  assert.match(hookSource, /currentRankingsSummary/);
  assert.match(hookSource, /currentSummaryRecalcFlagState/);
});

test("Dashboard never reopens raw monthly_targets recovery after Formal target authority cutover", () => {
  assert.doesNotMatch(hookSource, /Dashboard 月目標精準 raw fallback/);
  assert.doesNotMatch(hookSource, /getCollectionPath\("monthly_targets"\)/);
  assert.doesNotMatch(hookSource, /dashboardTargetRawFallbacks/);
});


test("App read trust is anchored to both month and brand to prevent cross-brand reuse", () => {
  assert.match(appSource, /currentReportSummaryReadyBrandId === currentBrand\?\.id/);
  assert.match(appSource, /currentSummaryRecalcFlagState\?\.brandId === currentBrand\?\.id/);
  assert.match(hookSource, /currentReportSummaryReadyBrandId === brandInfo\?\.id/);
  assert.match(hookSource, /currentSummaryRecalcFlagState\?\.brandId === brandInfo\?\.id/);
});

test("Dashboard trusted gates require the rankings summary to match each owner's selected month", () => {
  // App owns read topology and compares against its targetYearMonth.
  assert.match(appSource, /rankingsSummaryYearMonth === targetYearMonth/);

  // useDashboardStats owns presentation trust and compares against selectedYearMonth.
  assert.match(
    hookSource,
    /const rankingsMatchesMonth = Boolean\(currentRankingsSummary\) && rankingsYearMonth === selectedYearMonth;/
  );
  assert.match(
    hookSource,
    /else if \(!summaryDocs\.dashboard \|\| !summaryDocs\.rankings\) statusKey = "missing";/
  );
});

test("runtime stabilization historical readiness has one-shot point-read recovery without polling", () => {
  const start = appSource.indexOf("// Runtime stabilization — Historical Summary readiness one-shot recovery.");
  const end = appSource.indexOf("// FRD-A5：Annual data authority 移出 App", start);
  assert.ok(start >= 0 && end > start);
  const recovery = appSource.slice(start, end);

  assert.match(appSource, /HISTORICAL_SUMMARY_READINESS_RECOVERY_DELAY_MS = 10_000/);
  assert.match(recovery, /selectedYearMonth >= currentYearMonth/);
  assert.match(recovery, /currentReportSummaryReadyYearMonth === selectedYearMonth/);
  assert.match(recovery, /currentReportSummaryReadyBrandId === brandIdAtStart/);
  assert.match(recovery, /currentSummaryRecalcFlagState\?\.yearMonth === selectedYearMonth/);
  assert.match(recovery, /currentSummaryRecalcFlagState\?\.brandId === brandIdAtStart/);

  assert.match(recovery, /getDoc\(doc\(getCollectionPath\("dashboard_summary"\), selectedYearMonth\)\)/);
  assert.match(recovery, /getDoc\(doc\(getCollectionPath\("rankings_summary"\), selectedYearMonth\)\)/);
  assert.match(recovery, /getDoc\(doc\(getCollectionPath\("summary_recalc_flags"\), selectedYearMonth\)\)/);

  assert.match(recovery, /setTimeout\(/);
  assert.match(recovery, /clearTimeout\(recoveryTimer\)/);
  assert.doesNotMatch(recovery, /setInterval\(/);
  assert.doesNotMatch(recovery, /\bonSnapshot\s*\(/);
  assert.doesNotMatch(recovery, /\bquery\s*\(/);
  assert.doesNotMatch(recovery, /\bgetDocs\s*\(/);
});
