import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DASHBOARD_LIVE_RANKING_SEMANTICS,
  buildDashboardLiveRanking,
  getDashboardLiveRankEligibility,
} from "../src/utils/dashboardLiveRanking.js";
import { KPI_VALUE_STATUS } from "../src/utils/kpiContracts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const row = (overrides = {}) => ({
  storeKey: "A",
  formalScopeEligible: true,
  reportingStatus: "DATA_COMPLETE",
  formalNetCash: 100,
  formalNetCashStatus: KPI_VALUE_STATUS.VALID,
  cashTarget: 200,
  cashTargetStatus: KPI_VALUE_STATUS.VALID,
  cashAchievement: 50,
  cashAchievementStatus: KPI_VALUE_STATUS.VALID,
  formalRankEligible: true,
  ...overrides,
});

test("Dashboard live ranking keeps a partially reported numeric store rankable without changing Formal rank eligibility", () => {
  const partial = row({
    reportingStatus: "DATA_INCOMPLETE",
    formalNetCash: 80,
    cashAchievement: 40,
    formalRankEligible: false,
  });

  const eligibility = getDashboardLiveRankEligibility(partial);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.reason, "PARTIAL_REPORTING");
  assert.equal(eligibility.reportingIncomplete, true);
  assert.equal(partial.formalRankEligible, false, "Formal authority remains fail-closed");
});

test("Dashboard live ranking never turns missing actual / zero target / missing target into a fake rank", () => {
  const noActual = getDashboardLiveRankEligibility(row({
    formalNetCash: null,
    formalNetCashStatus: "DATA_INCOMPLETE",
    cashAchievement: null,
    cashAchievementStatus: "DATA_INCOMPLETE",
    formalRankEligible: false,
  }));
  assert.equal(noActual.eligible, false);
  assert.equal(noActual.reason, "ACTUAL_UNAVAILABLE");

  const zeroTarget = getDashboardLiveRankEligibility(row({
    cashTarget: 0,
    cashTargetStatus: KPI_VALUE_STATUS.VALID_ZERO,
    cashAchievement: null,
    cashAchievementStatus: KPI_VALUE_STATUS.N_A,
    formalRankEligible: false,
  }));
  assert.equal(zeroTarget.eligible, false);
  assert.equal(zeroTarget.reason, "TARGET_ZERO");

  const missingTarget = getDashboardLiveRankEligibility(row({
    cashTarget: null,
    cashTargetStatus: KPI_VALUE_STATUS.TARGET_NOT_SET,
    cashAchievement: null,
    cashAchievementStatus: KPI_VALUE_STATUS.TARGET_NOT_SET,
    formalRankEligible: false,
  }));
  assert.equal(missingTarget.eligible, false);
  assert.equal(missingTarget.reason, "TARGET_NOT_SET");
});

test("Dashboard live ranking preserves full Formal scope while ranking only calculable stores", () => {
  const rows = [
    row({ storeKey: "A", formalNetCash: 100, cashAchievement: 50 }),
    row({ storeKey: "B", reportingStatus: "DATA_INCOMPLETE", formalNetCash: 160, cashAchievement: 80, formalRankEligible: false }),
    row({ storeKey: "C", formalNetCash: null, formalNetCashStatus: "DATA_INCOMPLETE", cashAchievement: null, cashAchievementStatus: "DATA_INCOMPLETE", formalRankEligible: false }),
    row({ storeKey: "D", cashTarget: 0, cashTargetStatus: KPI_VALUE_STATUS.VALID_ZERO, cashAchievement: null, cashAchievementStatus: KPI_VALUE_STATUS.N_A, formalRankEligible: false }),
  ];

  const result = buildDashboardLiveRanking({ rows });
  assert.equal(result.semantics, DASHBOARD_LIVE_RANKING_SEMANTICS);
  assert.equal(result.scopeStoreCount, 4);
  assert.equal(result.liveRankEligibleStoreCount, 2);
  assert.equal(result.rows.length, 4, "Scope rows must never disappear from Dashboard overview");
  assert.deepEqual(result.rows.map((item) => item.storeKey), ["B", "A", "C", "D"]);
  assert.deepEqual(result.rows.map((item) => item.dashboardLiveCashAchievementRank), [1, 2, null, null]);
  assert.equal(result.rows[0].reportingIncomplete, true);
  assert.equal(result.rows[0].formalRankEligible, false, "Live ranking must not rewrite Formal eligibility");
  assert.equal(result.rows[2].dashboardLiveRankReason, "ACTUAL_UNAVAILABLE");
  assert.equal(result.rows[3].dashboardLiveRankReason, "TARGET_ZERO");
});

test("Dashboard live rank tie-break remains achievement then actual then canonical store key", () => {
  const result = buildDashboardLiveRanking({
    rows: [
      row({ storeKey: "C", formalNetCash: 100, cashAchievement: 50 }),
      row({ storeKey: "B", formalNetCash: 120, cashAchievement: 50 }),
      row({ storeKey: "A", formalNetCash: 120, cashAchievement: 50 }),
    ],
  });

  assert.deepEqual(result.rows.map((item) => item.storeKey), ["A", "B", "C"]);
  assert.deepEqual(result.rows.map((item) => item.dashboardLiveCashAchievementRank), [1, 2, 3]);
});
test("Dashboard current-month consumer separates live display/ranking semantics from strict Formal rank eligibility", () => {
  const hook = read("src/hooks/useDashboardStats.js");
  assert.match(hook, /buildDashboardLiveRanking/);
  assert.match(hook, /DASHBOARD_LIVE_RANKING_SEMANTICS/);
  assert.match(hook, /dashboardLiveRankEligible/);
  assert.match(hook, /scopeStoreCount/);
  assert.doesNotMatch(
    hook,
    /\.filter\(\(row\) => row\?\.formalRankEligible === true && effectiveStoreSet\.has\(cleanName\(row\.storeKey\)\)\)/,
    "Current Dashboard must not delete scope stores solely because Formal ranking is fail-closed"
  );
});

test("StorePerformance uses scope count for layout/count and exposes partial-reporting / unranked states", () => {
  const view = read("src/components/StorePerformanceView.jsx");
  assert.match(view, /rankingScopeStoreCount/);
  assert.match(view, /isSmallStoreRanking = rankingScopeStoreCount > 0 && rankingScopeStoreCount <= 6/);
  assert.match(view, /可即時排名/);
  assert.match(view, /回報未完整/);
  assert.match(view, /暫不排名/);
  assert.match(view, /dashboardLiveRankEligible === false \? "—" : store\.rank/);
  assert.doesNotMatch(view, /目前顯示店家數/);
});

test("Formal current-detail authority remains strict for trusted/formal ranking", () => {
  const formal = read("src/utils/currentDetailFormalConsumer.js");
  assert.match(formal, /formalRankEligible: \(\s*reportingStatus === "DATA_COMPLETE"/);
  assert.match(formal, /\.filter\(\(row\) => row\.formalRankEligible\)/);
});
