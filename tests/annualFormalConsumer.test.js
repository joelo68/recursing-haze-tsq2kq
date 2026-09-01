import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { KPI_CONTRACT_VERSION, KPI_VALUE_STATUS } from "../src/utils/kpiContracts.js";
import { SUMMARY_SEMANTIC_VERSION } from "../src/utils/summarySemantics.js";
import {
  buildAnnualFormalMonth,
  buildAnnualIntervalTotals,
  isAnnualPreSystemMonth,
  resolveAnnualHistoricalFormalTrust,
  shouldAllowAnnualRawTargetFallback,
} from "../src/utils/annualFormalConsumer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const makeTargetSummary = ({
  brandId = "cyj",
  yearMonth = "2026-07",
  cashA = 100,
  cashB = 200,
  accrualA = 110,
  accrualB = 210,
  cashComplete = true,
  accrualComplete = true,
} = {}) => ({
  brandId,
  yearMonth,
  targetCoverageVersion: "target-coverage-v1",
  kpiContractVersion: KPI_CONTRACT_VERSION,
  lifecycleReady: true,
  eligibleStoreCount: 2,
  cashConfiguredStoreCount: cashComplete ? 2 : 1,
  accrualConfiguredStoreCount: accrualComplete ? 2 : 1,
  cashCoverageComplete: cashComplete,
  accrualCoverageComplete: accrualComplete,
  cashMissingStores: cashComplete ? [] : ["B"],
  accrualMissingStores: accrualComplete ? [] : ["B"],
  cashTargetTotal: cashComplete ? cashA + cashB : cashA,
  accrualTargetTotal: accrualComplete ? accrualA + accrualB : accrualA,
  targets: {
    A: { storeName: "A", cashTarget: cashA, accrualTarget: accrualA },
    ...(cashComplete || accrualComplete ? {
      B: {
        storeName: "B",
        ...(cashComplete ? { cashTarget: cashB } : {}),
        ...(accrualComplete ? { accrualTarget: accrualB } : {}),
      },
    } : {}),
  },
});

const makeDashboardSummary = ({ brandId = "cyj", yearMonth = "2026-07" } = {}) => ({
  id: yearMonth,
  yearMonth,
  brandId,
  version: "dashboard-summary-v2",
  semanticVersion: SUMMARY_SEMANTIC_VERSION,
  kpiContractVersion: KPI_CONTRACT_VERSION,
  lifecycleSnapshot: {
    datasetStatus: "READY",
    eligibleStoreKeys: ["A", "B"],
    eligibleStoreCount: 2,
  },
  grandTotal: {
    formalNetCash: 250,
    formalNetCashStatus: KPI_VALUE_STATUS.VALID,
    formalAccrual: 260,
    formalAccrualStatus: KPI_VALUE_STATUS.VALID,
    traffic: 30,
  },
  stores: {
    A: {
      store: "A",
      formalLifecycleEligible: true,
      formalNetCash: 100,
      formalNetCashStatus: KPI_VALUE_STATUS.VALID,
      formalAccrual: 110,
      formalAccrualStatus: KPI_VALUE_STATUS.VALID,
      traffic: 10,
    },
    B: {
      store: "B",
      formalLifecycleEligible: true,
      formalNetCash: 150,
      formalNetCashStatus: KPI_VALUE_STATUS.VALID,
      formalAccrual: 150,
      formalAccrualStatus: KPI_VALUE_STATUS.VALID,
      traffic: 20,
    },
  },
});

const verifiedFlag = ({ brandId = "cyj", yearMonth = "2026-07" } = {}) => ({
  id: yearMonth,
  brandId,
  affectedYearMonth: yearMonth,
  status: "verified",
  dirty: false,
  lastMismatchCount: 0,
  pendingCount: 0,
});

const normalizeStore = (value = "") => String(value || "")
  .replace(/^(CYJ|安妞|伊啵)/, "")
  .replace(/店+$/, "")
  .trim();

test("Yibo months before 2026-04 are pre-system and must be excluded", () => {
  assert.equal(isAnnualPreSystemMonth("yibo", "2026-01"), true);
  assert.equal(isAnnualPreSystemMonth("yibo", "2026-03"), true);
  assert.equal(isAnnualPreSystemMonth("yibo", "2026-04"), false);
  assert.equal(isAnnualPreSystemMonth("cyj", "2026-01"), false);
});

test("historical Formal trust is fail-closed when summary flag is missing", () => {
  const result = resolveAnnualHistoricalFormalTrust({
    yearMonth: "2026-07",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    dashboardSummary: makeDashboardSummary(),
    summaryFlag: null,
  });
  assert.equal(result.trusted, false);
  assert.equal(result.reason, "FLAG_MISSING");
});

test("historical Formal trust rejects dirty or pending flags", () => {
  const dirty = resolveAnnualHistoricalFormalTrust({
    yearMonth: "2026-07",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    dashboardSummary: makeDashboardSummary(),
    summaryFlag: { ...verifiedFlag(), dirty: true },
  });
  assert.equal(dirty.trusted, false);

  const pending = resolveAnnualHistoricalFormalTrust({
    yearMonth: "2026-07",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    dashboardSummary: makeDashboardSummary(),
    summaryFlag: { ...verifiedFlag(), pendingCount: 1 },
  });
  assert.equal(pending.trusted, false);
  assert.equal(pending.reason, "SUMMARY_PENDING");
});

test("historical Formal trust requires exact brand and yearMonth anchoring", () => {
  const wrongBrand = resolveAnnualHistoricalFormalTrust({
    yearMonth: "2026-07",
    currentYearMonth: "2026-08",
    brandId: "anniu",
    dashboardSummary: makeDashboardSummary({ brandId: "cyj" }),
    summaryFlag: verifiedFlag({ brandId: "anniu" }),
  });
  assert.equal(wrongBrand.trusted, false);
  assert.equal(wrongBrand.reason, "SUMMARY_BRAND_MISMATCH");

  const wrongMonth = resolveAnnualHistoricalFormalTrust({
    yearMonth: "2026-06",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    dashboardSummary: makeDashboardSummary({ yearMonth: "2026-07" }),
    summaryFlag: verifiedFlag({ yearMonth: "2026-06" }),
  });
  assert.equal(wrongMonth.trusted, false);
  assert.equal(wrongMonth.reason, "SUMMARY_MONTH_MISMATCH");
});

test("verified historical Formal summary is trusted", () => {
  const result = resolveAnnualHistoricalFormalTrust({
    yearMonth: "2026-07",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    dashboardSummary: makeDashboardSummary(),
    summaryFlag: verifiedFlag(),
  });
  assert.equal(result.trusted, true);
  assert.equal(result.reason, "VERIFIED_FORMAL_SUMMARY");
});

test("current month never enters historical Formal trust", () => {
  const result = resolveAnnualHistoricalFormalTrust({
    yearMonth: "2026-08",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    dashboardSummary: makeDashboardSummary({ yearMonth: "2026-08" }),
    summaryFlag: verifiedFlag({ yearMonth: "2026-08" }),
  });
  assert.equal(result.trusted, false);
  assert.equal(result.reason, "NOT_HISTORICAL");
});

test("full-brand Formal month uses grand Formal actuals and Coverage v1 targets", () => {
  const result = buildAnnualFormalMonth({
    dashboardSummary: makeDashboardSummary(),
    monthlyTargetSummary: makeTargetSummary(),
    normalizeStoreKey: normalizeStore,
  });
  assert.equal(result.applied, true);
  assert.equal(result.cash, 250);
  assert.equal(result.accrual, 260);
  assert.equal(result.budget, 300);
  assert.equal(result.accrualBudget, 320);
  assert.equal(result.achievement, (250 / 300) * 100);
  assert.equal(result.traffic, 30);
});

test("audit exclusion forces store-scope Formal aggregation and removes excluded store from actual and target", () => {
  const result = buildAnnualFormalMonth({
    dashboardSummary: makeDashboardSummary(),
    monthlyTargetSummary: makeTargetSummary(),
    excludedStoreKeys: ["B"],
    normalizeStoreKey: normalizeStore,
  });
  assert.equal(result.cash, 100);
  assert.equal(result.accrual, 110);
  assert.equal(result.budget, 100);
  assert.equal(result.accrualBudget, 110);
  assert.equal(result.traffic, 10);
  assert.equal(result.scopeEligibleStoreCount, 1);
});

test("manager/store Formal scope uses only Lifecycle-eligible requested stores", () => {
  const result = buildAnnualFormalMonth({
    dashboardSummary: makeDashboardSummary(),
    monthlyTargetSummary: makeTargetSummary(),
    scopeStoreKeys: ["B"],
    normalizeStoreKey: normalizeStore,
  });
  assert.equal(result.cash, 150);
  assert.equal(result.budget, 200);
  assert.equal(result.scopeEligibleStoreCount, 1);
});

test("Coverage incomplete returns N/A target and achievement instead of shrinking denominator", () => {
  const target = makeTargetSummary({ cashComplete: false, accrualComplete: true });
  const result = buildAnnualFormalMonth({
    dashboardSummary: makeDashboardSummary(),
    monthlyTargetSummary: target,
    normalizeStoreKey: normalizeStore,
  });
  assert.equal(result.cash, 250);
  assert.equal(result.budget, null);
  assert.equal(result.cashCoverageComplete, false);
  assert.equal(result.achievement, null);
});

test("missing eligible store row fails actual closed instead of silently shrinking scope", () => {
  const dashboard = makeDashboardSummary();
  delete dashboard.stores.B;
  const result = buildAnnualFormalMonth({
    dashboardSummary: dashboard,
    monthlyTargetSummary: makeTargetSummary(),
    scopeStoreKeys: ["A", "B"],
    normalizeStoreKey: normalizeStore,
  });
  assert.equal(result.cash, null);
  assert.equal(result.cashStatus, KPI_VALUE_STATUS.FIELD_MISSING);
  assert.deepEqual(result.missingSummaryStoreKeys, ["B"]);
  assert.equal(result.budget, 300, "target denominator must still include the missing eligible store");
  assert.equal(result.achievement, null);
});

test("valid zero and negative Formal actuals are preserved", () => {
  const zero = makeDashboardSummary();
  zero.grandTotal.formalNetCash = 0;
  zero.grandTotal.formalNetCashStatus = KPI_VALUE_STATUS.VALID_ZERO;
  const zeroResult = buildAnnualFormalMonth({
    dashboardSummary: zero,
    monthlyTargetSummary: makeTargetSummary(),
    normalizeStoreKey: normalizeStore,
  });
  assert.equal(zeroResult.cash, 0);

  const negative = makeDashboardSummary();
  negative.grandTotal.formalNetCash = -25;
  negative.grandTotal.formalNetCashStatus = KPI_VALUE_STATUS.VALID;
  const negativeResult = buildAnnualFormalMonth({
    dashboardSummary: negative,
    monthlyTargetSummary: makeTargetSummary(),
    normalizeStoreKey: normalizeStore,
  });
  assert.equal(negativeResult.cash, -25);
});

test("empty Lifecycle scope is excluded from interval totals rather than treated as zero performance", () => {
  const result = buildAnnualFormalMonth({
    dashboardSummary: makeDashboardSummary(),
    monthlyTargetSummary: makeTargetSummary(),
    scopeStoreKeys: ["NOT_ELIGIBLE"],
    normalizeStoreKey: normalizeStore,
  });
  assert.equal(result.includedInTotals, false);
  assert.equal(result.cash, null);
  assert.equal(result.achievement, null);
});

test("annual interval totals fail closed when any included Formal target is incomplete", () => {
  const totals = buildAnnualIntervalTotals([
    { cash: 100, budget: 100, accrual: 120, accrualBudget: 100, traffic: 10, includedInTotals: true },
    { cash: 150, budget: null, accrual: 150, accrualBudget: 200, traffic: 20, includedInTotals: true },
    { cash: null, budget: null, accrual: null, accrualBudget: null, traffic: 0, includedInTotals: false },
  ]);
  assert.equal(totals.cash, 250);
  assert.equal(totals.budget, null);
  assert.equal(totals.cashAch, null);
  assert.equal(totals.accrual, 270);
  assert.equal(totals.accrualBudget, 300);
  assert.equal(totals.accrualAch, 90);
  assert.equal(totals.traffic, 30);
});

test("trusted historical and Yibo pre-system months never allow raw monthly_targets fallback", () => {
  const trusted = shouldAllowAnnualRawTargetFallback({
    yearMonth: "2026-07",
    currentYearMonth: "2026-08",
    brandId: "cyj",
    dashboardSummary: makeDashboardSummary(),
    summaryFlag: verifiedFlag(),
  });
  assert.equal(trusted, false);

  const yiboPreSystem = shouldAllowAnnualRawTargetFallback({
    yearMonth: "2026-03",
    currentYearMonth: "2026-08",
    brandId: "yibo",
  });
  assert.equal(yiboPreSystem, false);

  const currentMonth = shouldAllowAnnualRawTargetFallback({
    yearMonth: "2026-08",
    currentYearMonth: "2026-08",
    brandId: "cyj",
  });
  assert.equal(currentMonth, true);
});

test("AnnualView and App wire readiness, fail-closed trust, Formal scope and no trusted historical raw fallback", () => {
  const annualSource = fs.readFileSync(path.join(root, "src/components/AnnualView.jsx"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");

  assert.match(annualSource, /annualSummaryLoadState/);
  assert.match(annualSource, /resolveAnnualHistoricalFormalTrust/);
  assert.match(annualSource, /buildAnnualFormalMonth/);
  assert.match(annualSource, /shouldAllowAnnualRawTargetFallback/);
  assert.match(annualSource, /if \(isHistoricalMonth && !annualSummaryTrustReady\) return;/);
  assert.doesNotMatch(annualSource, /if \(!flag\) return true/);
  assert.match(appSource, /annualSummaryLoadState/);
  assert.match(appSource, /dashboardReady: true/);
  assert.match(appSource, /flagsReady: true/);
});

test("audit exclusion save synchronizes AppContext state only for the same brand after Firestore succeeds", () => {
  const appSource = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");

  assert.match(appSource, /const brandIdAtStart = currentBrandId;/);
  assert.match(appSource, /const nextExclusions = Array\.isArray\(newExclusions\) \? \[\.\.\.newExclusions\] : \[\];/);
  assert.match(appSource, /await setDoc\(auditExclusionsDoc, \{ stores: nextExclusions \}\);/);
  assert.match(appSource, /if \(currentBrandIdRef\.current === brandIdAtStart\) \{\s*setAuditExclusions\(nextExclusions\);\s*\}/);
  assert.match(appSource, /\}, \[currentBrandId, getDocPath\]\);/);
});

test("AnnualView only closes the exclusion modal and shows success after the write succeeds", () => {
  const annualSource = fs.readFileSync(path.join(root, "src/components/AnnualView.jsx"), "utf8");

  assert.match(annualSource, /const success = await handleUpdateAuditExclusions\(localExclusions\);/);
  assert.match(annualSource, /if \(!success\) \{\s*showToast\("排除名單更新失敗，請稍後再試"\);\s*return;\s*\}/);
  const successCheckIndex = annualSource.indexOf("if (!success)");
  const closeIndex = annualSource.indexOf("setIsConfigModalOpen(false);", successCheckIndex);
  const successToastIndex = annualSource.indexOf('showToast("排除名單已更新，報表已重新計算", "success");', successCheckIndex);
  assert.ok(successCheckIndex >= 0);
  assert.ok(closeIndex > successCheckIndex);
  assert.ok(successToastIndex > closeIndex);
});

test("5E-1B Annual Formal all-zero configured targets stay zero and achievement is N/A", () => {
  const result = buildAnnualFormalMonth({
    dashboardSummary: makeDashboardSummary(),
    monthlyTargetSummary: makeTargetSummary({
      cashA: 0,
      cashB: 0,
      accrualA: 0,
      accrualB: 0,
    }),
    normalizeStoreKey: normalizeStore,
  });

  assert.equal(result.applied, true);
  assert.equal(result.budget, 0);
  assert.equal(result.accrualBudget, 0);
  assert.equal(result.cashCoverageComplete, true);
  assert.equal(result.accrualCoverageComplete, true);
  assert.equal(result.achievement, null);
  assert.equal(result.accrualAchievement, null);
});

test("5E-1B AnnualView explicit zero is presence-aware and does not reopen legacy target fallback", () => {
  const source = fs.readFileSync(path.join(root, "src/components/AnnualView.jsx"), "utf8");
  assert.match(source, /const readTargetValue = \(row, keys = \[\]\) =>/);
  assert.match(source, /!cashTargetResult\.found && !accrualTargetResult\.found/);
  assert.match(source, /cashTargetResult\.configured \|\| accrualTargetResult\.configured/);
  assert.doesNotMatch(source, /if \(!row \|\| \(cashTarget <= 0 && accrualTarget <= 0\)\)/);
  assert.doesNotMatch(source, /if \(cashTarget > 0 \|\| accrualTarget > 0\)/);
});
