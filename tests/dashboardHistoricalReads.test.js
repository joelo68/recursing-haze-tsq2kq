import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DASHBOARD_READ_MODE,
  getSummaryRecalcFlagState,
  resolveHistoricalDashboardReadPolicy,
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

test("App uses the shared historical read policy for Dashboard daily_reports", () => {
  assert.match(appSource, /resolveHistoricalDashboardReadPolicy/);
  assert.match(appSource, /dashboardReadPolicy\.shouldLoadDailyReports/);
  assert.match(appSource, /currentSummaryRecalcFlagState/);
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

test("Dashboard trusted read gate requires both dashboard and rankings summary for the selected month", () => {
  assert.match(appSource, /rankingsSummaryYearMonth === targetYearMonth/);
  assert.match(hookSource, /rankingsYearMonth === targetYearMonth/);
});

test("runtime stabilization historical readiness has one-shot point-read recovery without polling", () => {
  const start = appSource.indexOf("// Runtime stabilization — Historical Summary readiness one-shot recovery.");
  const end = appSource.indexOf("const shouldLoadAnnualData = ANNUAL_DATA_VIEWS.has(activeView);", start);
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
