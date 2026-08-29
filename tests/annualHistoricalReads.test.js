import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { KPI_CONTRACT_VERSION } from "../src/utils/kpiContracts.js";
import { SUMMARY_SEMANTIC_VERSION } from "../src/utils/summarySemantics.js";
import { ANNUAL_READ_MODE, buildAnnualAggregateYearMonthCandidates, resolveAnnualReadPlan } from "../src/utils/annualReadPolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const annualSource = fs.readFileSync(path.join(root, "src/components/AnnualView.jsx"), "utf8");

const makeSummary = ({ brandId = "cyj", yearMonth = "2026-07" } = {}) => ({
  id: yearMonth,
  yearMonth,
  brandId,
  version: "dashboard-summary-v2",
  semanticVersion: SUMMARY_SEMANTIC_VERSION,
  kpiContractVersion: KPI_CONTRACT_VERSION,
  stores: {},
});

const makeFlag = ({ brandId = "cyj", yearMonth = "2026-07", dirty = false } = {}) => ({
  id: yearMonth,
  brandId,
  affectedYearMonth: yearMonth,
  status: dirty ? "dirty" : "verified",
  dirty,
  lastMismatchCount: 0,
  pendingCount: 0,
});

const makeReadyState = ({ brandId = "cyj", year = "2026", dashboardError = "", flagsError = "" } = {}) => ({
  brandId,
  year,
  dashboardReady: true,
  flagsReady: true,
  dashboardError,
  flagsError,
});

const buildTrustedMonths = ({ brandId = "cyj", year = "2026", throughMonth = 7 } = {}) => {
  const dashboardSummaries = [];
  const summaryStatusMap = {};
  for (let month = 1; month <= throughMonth; month += 1) {
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    dashboardSummaries.push(makeSummary({ brandId, yearMonth }));
    summaryStatusMap[yearMonth] = makeFlag({ brandId, yearMonth });
  }
  return { dashboardSummaries, summaryStatusMap };
};

test("Annual loading state never eagerly reads monthly_aggregated", () => {
  const result = resolveAnnualReadPlan({
    selectedYear: "2026",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    summaryLoadState: { brandId: "cyj", year: "2026", dashboardReady: false, flagsReady: false },
  });
  assert.equal(result.mode, ANNUAL_READ_MODE.LOADING);
  assert.equal(result.ready, false);
  assert.deepEqual(result.fallbackYearMonths, []);
});

test("verified current-year Annual reads only current month aggregate", () => {
  const trusted = buildTrustedMonths({ throughMonth: 7 });
  const result = resolveAnnualReadPlan({
    selectedYear: "2026",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    ...trusted,
    summaryLoadState: makeReadyState(),
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.fallbackYearMonths, ["2026-08"]);
  assert.equal(result.reasonsByMonth["2026-07"], "VERIFIED_FORMAL_SUMMARY");
  assert.equal(result.reasonsByMonth["2026-08"], "CURRENT_MONTH_FALLBACK");
});

test("dirty historical month adds only that month plus current month", () => {
  const trusted = buildTrustedMonths({ throughMonth: 7 });
  trusted.summaryStatusMap["2026-05"] = makeFlag({ yearMonth: "2026-05", dirty: true });
  const result = resolveAnnualReadPlan({
    selectedYear: "2026",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    ...trusted,
    summaryLoadState: makeReadyState(),
  });
  assert.deepEqual(result.fallbackYearMonths, ["2026-05", "2026-08"]);
});

test("missing historical Formal summary falls back only for the missing month", () => {
  const trusted = buildTrustedMonths({ throughMonth: 7 });
  trusted.dashboardSummaries = trusted.dashboardSummaries.filter((row) => row.yearMonth !== "2026-06");
  const result = resolveAnnualReadPlan({
    selectedYear: "2026",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    ...trusted,
    summaryLoadState: makeReadyState(),
  });
  assert.deepEqual(result.fallbackYearMonths, ["2026-06", "2026-08"]);
});

test("fully verified historical year needs zero monthly_aggregated reads", () => {
  const trusted = buildTrustedMonths({ year: "2025", throughMonth: 12 });
  const result = resolveAnnualReadPlan({
    selectedYear: "2025",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    ...trusted,
    summaryLoadState: makeReadyState({ year: "2025" }),
  });
  assert.equal(result.mode, ANNUAL_READ_MODE.SUMMARY_ONLY);
  assert.deepEqual(result.fallbackYearMonths, []);
});

test("Yibo pre-system months never enter aggregate fallback", () => {
  const trusted = buildTrustedMonths({ brandId: "yibo", throughMonth: 7 });
  const result = resolveAnnualReadPlan({
    selectedYear: "2026",
    currentYearMonth: "2026-08",
    brandId: "yibo",
    ...trusted,
    summaryLoadState: makeReadyState({ brandId: "yibo" }),
  });
  assert.deepEqual(result.fallbackYearMonths, ["2026-08"]);
  assert.equal(result.reasonsByMonth["2026-01"], "PRE_SYSTEM_SKIP");
  assert.equal(result.reasonsByMonth["2026-03"], "PRE_SYSTEM_SKIP");
});

test("summary listener error fails closed to historical detail fallback after readiness", () => {
  const result = resolveAnnualReadPlan({
    selectedYear: "2026",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    dashboardSummaries: [],
    summaryStatusMap: {},
    summaryLoadState: makeReadyState({ dashboardError: "permission-denied" }),
  });
  assert.deepEqual(result.fallbackYearMonths, [
    "2026-01", "2026-02", "2026-03", "2026-04",
    "2026-05", "2026-06", "2026-07", "2026-08",
  ]);
});

test("brand/year mismatch stays in loading mode and cannot reuse previous annual state", () => {
  const trusted = buildTrustedMonths({ throughMonth: 7 });
  const result = resolveAnnualReadPlan({
    selectedYear: "2026",
    currentYearMonth: "2026-08",
    brandId: "anniu",
    ...trusted,
    summaryLoadState: makeReadyState({ brandId: "cyj" }),
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.fallbackYearMonths, []);
});

test("future year creates no aggregate fallback once scoped Summary listeners are ready", () => {
  const result = resolveAnnualReadPlan({
    selectedYear: "2027",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    dashboardSummaries: [],
    summaryStatusMap: {},
    summaryLoadState: makeReadyState({ year: "2027" }),
  });
  assert.equal(result.mode, ANNUAL_READ_MODE.SUMMARY_ONLY);
  assert.deepEqual(result.fallbackYearMonths, []);
});

test("App scopes Annual dashboard_summary and flags by documentId year range", () => {
  assert.match(appSource, /where\(documentId\(\), ">=", yearStartId\)/);
  assert.match(appSource, /where\(documentId\(\), "<=", yearEndId\)/);
  assert.match(appSource, /getCollectionPath\("dashboard_summary"\)/);
  assert.match(appSource, /getCollectionPath\("summary_recalc_flags"\)/);
});

test("App no longer keeps whole-year store or therapist aggregate listeners in Annual source block", () => {
  const start = appSource.indexOf("const shouldLoadAnnualData = ANNUAL_DATA_VIEWS.has(activeView);");
  const end = appSource.indexOf("const targetYear = String(selectedYear);", appSource.indexOf("useEffect(() => {", start + 1));
  const block = appSource.slice(start, end > start ? end : start + 12000);
  assert.doesNotMatch(block, /where\("year", "in", \[targetYear, Number\(targetYear\)\]\)/);
  assert.doesNotMatch(block, /getCollectionPath\("therapist_monthly_aggregated"\)/);
});

test("aggregate fallback query keeps padded and legacy unpadded yearMonth compatibility within Firestore IN limit", () => {
  const candidates = buildAnnualAggregateYearMonthCandidates([
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
    "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
  ]);
  assert.ok(candidates.includes("2026-01"));
  assert.ok(candidates.includes("2026-1"));
  assert.ok(candidates.includes("2026-10"));
  assert.ok(candidates.length <= 30);
});

test("App uses fallback-month-only monthly_aggregated query and shared read plan", () => {
  assert.match(appSource, /resolveAnnualReadPlan/);
  assert.match(appSource, /buildAnnualAggregateYearMonthCandidates/);
  assert.match(appSource, /where\("yearMonth", "in", aggregateYearMonthCandidates\)/);
  assert.match(appSource, /monthly_aggregated_fallback_months/);
});

test("Annual target Summary reads skip Yibo pre-system months", () => {
  assert.match(annualSource, /filter\(\(yearMonth\) => !isAnnualPreSystemMonth\(currentBrand, yearMonth\)\)/);
});
