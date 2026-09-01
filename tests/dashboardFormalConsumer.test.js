import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHistoricalFormalDashboardScope,
  isFormalDashboardSummaryCompatible,
  normalizeMonthlyTargetMap,
} from "../src/utils/dashboardFormalConsumer.js";
import { KPI_CONTRACT_VERSION, KPI_VALUE_STATUS } from "../src/utils/kpiContracts.js";
import { SUMMARY_KPI_STATUS, SUMMARY_SEMANTIC_VERSION } from "../src/utils/summarySemantics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const normalizeStoreKey = (value = "") => String(value || "")
  .trim()
  .replace(/^(DRCYJ|DR\.CYJ|CYJ|安妞|伊啵)\s*/i, "")
  .replace(/店$/, "")
  .trim();

const makeSummary = () => ({
  id: "2026-07",
  yearMonth: "2026-07",
  version: "dashboard-summary-v2",
  semanticVersion: SUMMARY_SEMANTIC_VERSION,
  kpiContractVersion: KPI_CONTRACT_VERSION,
  lifecycleSnapshot: {
    datasetStatus: "READY",
    eligibleStoreCount: 2,
    eligibleStoreKeys: ["A", "B"],
  },
  grandTotal: {
    formalNetCash: 250,
    formalNetCashStatus: KPI_VALUE_STATUS.VALID,
    formalAccrual: 210,
    formalAccrualStatus: KPI_VALUE_STATUS.VALID,
  },
  stores: {
    A: {
      store: "A",
      displayName: "CYJA店",
      formalLifecycleEligible: true,
      formalNetCash: 100,
      formalNetCashStatus: KPI_VALUE_STATUS.VALID,
      formalAccrual: 90,
      formalAccrualStatus: KPI_VALUE_STATUS.VALID,
      formalCashTarget: 100,
      formalCashTargetStatus: KPI_VALUE_STATUS.VALID,
      formalCashAchievement: 100,
      formalCashAchievementStatus: KPI_VALUE_STATUS.VALID,
      formalCashAchievementRank: 1,
      formalRankEligible: true,
      challengeBudget: 120,
    },
    B: {
      store: "B",
      displayName: "CYJB店",
      formalLifecycleEligible: true,
      formalNetCash: 150,
      formalNetCashStatus: KPI_VALUE_STATUS.VALID,
      formalAccrual: 120,
      formalAccrualStatus: KPI_VALUE_STATUS.VALID,
      formalCashTarget: 200,
      formalCashTargetStatus: KPI_VALUE_STATUS.VALID,
      formalCashAchievement: 75,
      formalCashAchievementStatus: KPI_VALUE_STATUS.VALID,
      formalCashAchievementRank: 2,
      formalRankEligible: true,
      challengeBudget: 250,
    },
    C: {
      store: "C",
      displayName: "CYJC店",
      formalLifecycleEligible: false,
      formalNetCash: 999,
      formalNetCashStatus: KPI_VALUE_STATUS.VALID,
      formalAccrual: 999,
      formalAccrualStatus: KPI_VALUE_STATUS.VALID,
      formalCashTarget: 999,
      formalCashTargetStatus: KPI_VALUE_STATUS.VALID,
    },
  },
  formalStoreRankings: [],
});

const makeTargets = () => ({
  id: "2026-07",
  yearMonth: "2026-07",
  targetCoverageVersion: "target-coverage-v1",
  kpiContractVersion: KPI_CONTRACT_VERSION,
  lifecycleReady: true,
  eligibleStoreCount: 2,
  cashConfiguredStoreCount: 2,
  accrualConfiguredStoreCount: 2,
  cashCoverageComplete: true,
  accrualCoverageComplete: true,
  cashMissingStores: [],
  accrualMissingStores: [],
  targets: {
    "CYJA店": { storeName: "CYJA店", cashTarget: 100, accrualTarget: 100 },
    "CYJB店": { storeName: "CYJB店", cashTarget: 200, accrualTarget: 200 },
  },
});

test("Batch 5A formal consumer accepts only dashboard-summary-v2 + canonical semantic contract", () => {
  const summary = makeSummary();
  assert.equal(isFormalDashboardSummaryCompatible(summary), true);
  assert.equal(isFormalDashboardSummaryCompatible({ ...summary, version: "dashboard-summary-v1" }), false);
  assert.equal(isFormalDashboardSummaryCompatible({ ...summary, semanticVersion: "legacy" }), false);
  assert.equal(isFormalDashboardSummaryCompatible({ ...summary, kpiContractVersion: "legacy" }), false);
});

test("monthly target map normalizes canonical/legacy store names without shrinking target authority", () => {
  const normalized = normalizeMonthlyTargetMap(makeTargets(), normalizeStoreKey);
  assert.deepEqual(Object.keys(normalized).sort(), ["A", "B"]);
  assert.equal(normalized.A.cashTarget, 100);
  assert.equal(normalized.B.accrualTarget, 200);
});

test("brand historical scope consumes formal actuals and live Coverage v1 target authority", () => {
  const summary = makeSummary();
  const result = buildHistoricalFormalDashboardScope({
    summary,
    stores: Object.values(summary.stores),
    monthlyTargetSummary: makeTargets(),
    normalizeStoreKey,
    filtered: false,
  });

  assert.equal(result.compatible, true);
  assert.equal(result.targetAuthority.coverageConsistent, true);
  assert.equal(result.cash, 250);
  assert.equal(result.cashTarget, 300);
  assert.equal(result.cashAchievement, 250 / 300 * 100);
  assert.equal(result.accrual, 210);
  assert.equal(result.accrualTarget, 300);
  assert.equal(result.accrualAchievement, 70);
  assert.equal(result.cashCoverageComplete, true);
  assert.equal(result.accrualCoverageComplete, true);
});

test("filtered historical scope aggregates only Lifecycle-eligible stores and recomputes scope target", () => {
  const summary = makeSummary();
  const selectedStores = [summary.stores.B, summary.stores.C];
  const result = buildHistoricalFormalDashboardScope({
    summary,
    stores: selectedStores,
    monthlyTargetSummary: makeTargets(),
    normalizeStoreKey,
    filtered: true,
  });

  assert.deepEqual(result.scopeStoreKeys, ["B"]);
  assert.equal(result.scopeEligibleStoreCount, 1);
  assert.equal(result.cash, 150);
  assert.equal(result.cashTarget, 200);
  assert.equal(result.cashAchievement, 75);
  assert.equal(result.accrual, 120);
  assert.equal(result.accrualTarget, 200);
  assert.equal(result.accrualAchievement, 60);
});

test("filtered scope preserves valid zero and negative actuals instead of coercing them to missing/zero", () => {
  const summary = makeSummary();
  summary.stores.A.formalNetCash = 0;
  summary.stores.A.formalNetCashStatus = KPI_VALUE_STATUS.VALID_ZERO;
  summary.stores.A.formalAccrual = -20;
  summary.stores.A.formalAccrualStatus = KPI_VALUE_STATUS.VALID;

  const result = buildHistoricalFormalDashboardScope({
    summary,
    stores: [summary.stores.A],
    monthlyTargetSummary: makeTargets(),
    normalizeStoreKey,
    filtered: true,
  });

  assert.equal(result.cash, 0);
  assert.equal(result.cashStatus, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(result.cashAchievement, 0);
  assert.equal(result.accrual, -20);
  assert.equal(result.accrualStatus, KPI_VALUE_STATUS.VALID);
  assert.equal(result.accrualAchievement, -20);
});

test("incomplete Coverage v1 fails closed with TARGET_INCOMPLETE and null denominator/result", () => {
  const targets = makeTargets();
  targets.accrualConfiguredStoreCount = 1;
  targets.accrualCoverageComplete = false;
  targets.accrualMissingStores = ["CYJB店"];
  delete targets.targets["CYJB店"].accrualTarget;

  const summary = makeSummary();
  const result = buildHistoricalFormalDashboardScope({
    summary,
    stores: Object.values(summary.stores),
    monthlyTargetSummary: targets,
    normalizeStoreKey,
    filtered: false,
  });

  assert.equal(result.targetAuthority.coverageConsistent, true);
  assert.equal(result.cashTarget, 300);
  assert.equal(result.cashAchievement, 250 / 300 * 100);
  assert.equal(result.accrualTarget, null);
  assert.equal(result.accrualTargetStatus, SUMMARY_KPI_STATUS.TARGET_INCOMPLETE);
  assert.equal(result.accrualAchievement, null);
  assert.equal(result.accrualAchievementStatus, SUMMARY_KPI_STATUS.TARGET_INCOMPLETE);
});

test("missing/mismatched live target summary never falls back to a stale embedded denominator", () => {
  const summary = makeSummary();
  summary.formalTargetAuthority = {
    coverageConsistent: true,
    cashCoverageTrusted: true,
    cashTargetTotal: 999999,
  };

  const result = buildHistoricalFormalDashboardScope({
    summary,
    stores: Object.values(summary.stores),
    monthlyTargetSummary: null,
    normalizeStoreKey,
    filtered: false,
  });

  assert.equal(result.targetSummaryAvailable, false);
  assert.equal(result.cashTarget, null);
  assert.equal(result.cashAchievement, null);
  assert.equal(result.cashAchievementStatus, SUMMARY_KPI_STATUS.TARGET_INCOMPLETE);
});

test("consumer wiring uses Formal actual/target/ranking and UI renders N/A instead of coercing null to 0", () => {
  const hook = read("src/hooks/useDashboardStats.js");
  const view = read("src/components/StorePerformanceView.jsx");

  assert.match(hook, /buildHistoricalFormalDashboardScope/);
  assert.match(hook, /grand\.cash\s*=\s*formalScope\.cash/);
  assert.match(hook, /grand\.accrual\s*=\s*formalScope\.accrual/);
  assert.match(hook, /grand\.budget\s*=\s*formalScope\.cashTarget/);
  assert.match(hook, /grand\.accrualBudget\s*=\s*formalScope\.accrualTarget/);
  assert.match(hook, /summary\.formalStoreRankings/);
  assert.match(hook, /formalRankEligibleStoreCount/);
  assert.match(view, /formatKpiPercent/);
  assert.match(view, /目標資料未完整/);
  assert.match(view, /return "N\/A"/);
});
test("writer ↔ consumer contract exposes the exact Batch 4 formal fields Batch 5A consumes", () => {
  const writer = read("functions/index.js");
  assert.match(writer, /formalTargetAuthority/);
  assert.match(writer, /formalStoreRankings/);
  assert.match(writer, /formalRankEligibleStoreCount/);
  assert.match(writer, /grand\.formalNetCash/);
  assert.match(writer, /grand\.formalAccrual/);
  assert.match(writer, /grand\.formalCashTarget/);
  assert.match(writer, /grand\.formalAccrualTarget/);
  assert.match(writer, /version:\s*["']dashboard-summary-v2["']/);
});

test("Batch 5A does not add Firestore reads/listeners and keeps current month on detail flow", () => {
  const helper = read("src/utils/dashboardFormalConsumer.js");
  const hook = read("src/hooks/useDashboardStats.js");
  assert.doesNotMatch(helper, /firebase|onSnapshot|getDoc|getDocs|collection\(|query\(/i);
  assert.match(hook, /if \(isSelectedCurrentMonth\) return false;/);
  assert.match(hook, /if \(isSelectedCurrentMonth \|\| !isSummaryTrustedForDashboard\) return null;/);
});

test("5E-1B dashboard all-zero configured target scope is VALID_ZERO with N_A achievement", () => {
  const summary = makeSummary();
  const targets = makeTargets();

  targets.cashConfiguredStoreCount = 2;
  targets.accrualConfiguredStoreCount = 2;
  targets.cashCoverageComplete = true;
  targets.accrualCoverageComplete = true;
  targets.cashMissingStores = [];
  targets.accrualMissingStores = [];
  targets.targets = {
    "CYJA店": { storeName: "CYJA店", cashTarget: 0, accrualTarget: 0 },
    "CYJB店": { storeName: "CYJB店", cashTarget: 0, accrualTarget: 0 },
  };

  const result = buildHistoricalFormalDashboardScope({
    summary,
    stores: Object.values(summary.stores),
    monthlyTargetSummary: targets,
    normalizeStoreKey,
    filtered: false,
  });

  assert.equal(result.compatible, true);
  assert.equal(result.targetAuthority.coverageConsistent, true);
  assert.equal(result.cashTarget, 0);
  assert.equal(result.cashTargetStatus, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(result.cashAchievement, null);
  assert.equal(result.cashAchievementStatus, KPI_VALUE_STATUS.N_A);
  assert.equal(result.accrualTarget, 0);
  assert.equal(result.accrualTargetStatus, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(result.accrualAchievement, null);
  assert.equal(result.accrualAchievementStatus, KPI_VALUE_STATUS.N_A);
});

test("5E-1B dashboard normalization preserves canonical explicit zero over legacy positive duplicate", () => {
  const normalized = normalizeMonthlyTargetMap({
    targets: {
      legacy: {
        storeName: "CYJ新店",
        cashTarget: 900000,
        accrualTarget: 800000,
        isCanonicalSource: false,
      },
      canonical: {
        storeName: "CYJ新店店",
        cashTarget: 0,
        accrualTarget: 0,
        isCanonicalSource: true,
      },
    },
  }, normalizeStoreKey);

  assert.equal(normalized["新店"].cashTarget, 0);
  assert.equal(normalized["新店"].accrualTarget, 0);
  assert.equal(normalized["新店"].isCanonicalSource, true);
});

test("5E-1B Store Performance renders Formal zero-target projection as N/A and keeps pace gap neutral", () => {
  const source = read("src/components/StorePerformanceView.jsx");
  assert.match(source, /formalConsumerActive && targetValue === 0\) return "N\/A"/);
  assert.match(source, /const paceGap = cashAchievementAvailable \? totalAchievement - timeProgress : null/);
});

test("5E-1B.3 Dashboard canonical-equivalent conflict is order-independent and fail-closed", () => {
  const zeroCanonical = {
    storeName: "CYJ新店店",
    cashTarget: 0,
    accrualTarget: 0,
    isCanonicalSource: true,
    canonicalTargetId: "CYJ新店店_2026_8",
    sourceDocId: "CYJ新店店_2026_8",
  };
  const positiveCanonicalEquivalent = {
    storeName: "DRCYJ新店店",
    cashTarget: 900000,
    accrualTarget: 800000,
    isCanonicalSource: true,
    canonicalTargetId: "CYJ新店店_2026_8",
    sourceDocId: "DRCYJ新店店_2026_8",
  };

  const first = normalizeMonthlyTargetMap({
    targets: { a: zeroCanonical, b: positiveCanonicalEquivalent },
  }, normalizeStoreKey);
  const reversed = normalizeMonthlyTargetMap({
    targets: { b: positiveCanonicalEquivalent, a: zeroCanonical },
  }, normalizeStoreKey);

  for (const row of [first["新店"], reversed["新店"]]) {
    assert.equal(row.authorityConflict, true);
    assert.equal(row.status, "AUTHORITY_CONFLICT");
    assert.equal(row.cashTarget, null);
    assert.equal(row.accrualTarget, null);
  }
  assert.deepEqual(first["新店"], reversed["新店"]);
});
