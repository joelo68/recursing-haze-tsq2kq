import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHistoricalFormalRankingRows,
  buildHistoricalFormalRegionalData,
  isFormalRankingsSummaryCompatible,
  isFormalReportSummaryPairCompatible,
  resolveHistoricalReportFormalTrust,
} from "../src/utils/reportFormalConsumer.js";
import { KPI_CONTRACT_VERSION, KPI_VALUE_STATUS } from "../src/utils/kpiContracts.js";
import { SUMMARY_KPI_STATUS, SUMMARY_SEMANTIC_VERSION } from "../src/utils/summarySemantics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const normalizeStoreKey = (value = "") => String(value || "")
  .trim()
  .replace(/^(DRCYJ|DR\.CYJ|CYJ|安妞|伊啵|Anew|Yibo)\s*/i, "")
  .replace(/店$/, "")
  .trim();

const makeDashboardSummary = () => ({
  id: "2026-07",
  yearMonth: "2026-07",
  brandId: "cyj",
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
      manager: "M1",
      formalLifecycleEligible: true,
      formalNetCash: 100,
      formalNetCashStatus: KPI_VALUE_STATUS.VALID,
      formalAccrual: 90,
      formalAccrualStatus: KPI_VALUE_STATUS.VALID,
      formalCashTarget: 100,
      formalCashTargetStatus: KPI_VALUE_STATUS.VALID,
      formalCashAchievement: 100,
      formalCashAchievementStatus: KPI_VALUE_STATUS.VALID,
      formalAccrualTarget: 100,
      formalAccrualTargetStatus: KPI_VALUE_STATUS.VALID,
      formalAccrualAchievement: 90,
      formalAccrualAchievementStatus: KPI_VALUE_STATUS.VALID,
      formalRankEligible: true,
      formalCashAchievementRank: 1,
      operationalAccrual: 90,
      traffic: 10,
      skincareSales: 20,
      newCustomers: 2,
      newCustomerSales: 30,
      newCustomerClosings: 1,
    },
    B: {
      store: "B",
      displayName: "CYJB店",
      manager: "M1",
      formalLifecycleEligible: true,
      formalNetCash: 150,
      formalNetCashStatus: KPI_VALUE_STATUS.VALID,
      formalAccrual: 120,
      formalAccrualStatus: KPI_VALUE_STATUS.VALID,
      formalCashTarget: 200,
      formalCashTargetStatus: KPI_VALUE_STATUS.VALID,
      formalCashAchievement: 75,
      formalCashAchievementStatus: KPI_VALUE_STATUS.VALID,
      formalAccrualTarget: 200,
      formalAccrualTargetStatus: KPI_VALUE_STATUS.VALID,
      formalAccrualAchievement: 60,
      formalAccrualAchievementStatus: KPI_VALUE_STATUS.VALID,
      formalRankEligible: true,
      formalCashAchievementRank: 2,
      operationalAccrual: 120,
      traffic: 20,
      skincareSales: 30,
      newCustomers: 3,
      newCustomerSales: 40,
      newCustomerClosings: 2,
    },
    C: {
      store: "C",
      displayName: "CYJC店",
      manager: "M2",
      formalLifecycleEligible: false,
      formalNetCash: 999,
      formalNetCashStatus: KPI_VALUE_STATUS.VALID,
      formalAccrual: 999,
      formalAccrualStatus: KPI_VALUE_STATUS.VALID,
      formalCashTarget: null,
      formalCashTargetStatus: KPI_VALUE_STATUS.TARGET_NOT_SET,
      formalCashAchievement: null,
      formalCashAchievementStatus: KPI_VALUE_STATUS.TARGET_NOT_SET,
      formalRankEligible: false,
      formalCashAchievementRank: null,
    },
  },
  formalRankEligibleStoreCount: 2,
  formalStoreRankings: [
    { store: "A", displayName: "CYJA店", formalRankEligible: true, formalCashAchievement: 100, formalCashAchievementStatus: KPI_VALUE_STATUS.VALID, formalCashAchievementRank: 1 },
    { store: "B", displayName: "CYJB店", formalRankEligible: true, formalCashAchievement: 75, formalCashAchievementStatus: KPI_VALUE_STATUS.VALID, formalCashAchievementRank: 2 },
  ],
});

const makeRankingsSummary = () => ({
  id: "2026-07",
  yearMonth: "2026-07",
  brandId: "cyj",
  version: "rankings-summary-v1",
  semanticVersion: SUMMARY_SEMANTIC_VERSION,
  kpiContractVersion: KPI_CONTRACT_VERSION,
  formalRankEligibleStoreCount: 2,
  formalStoreRankings: [
    { store: "A", displayName: "CYJA店", formalNetCash: 100, formalCashTarget: 100, formalCashAchievement: 100, formalCashAchievementStatus: KPI_VALUE_STATUS.VALID, formalCashAchievementRank: 1, formalRankEligible: true },
    { store: "B", displayName: "CYJB店", formalNetCash: 150, formalCashTarget: 200, formalCashAchievement: 75, formalCashAchievementStatus: KPI_VALUE_STATUS.VALID, formalCashAchievementRank: 2, formalRankEligible: true },
  ],
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

const verifiedFlagState = {
  brandId: "cyj",
  yearMonth: "2026-07",
  ready: true,
  data: { status: "verified", dirty: false, lastMismatchCount: 0 },
  error: null,
};

test("rankings-summary-v1 requires canonical semantic contract and exact eligible count", () => {
  const summary = makeRankingsSummary();
  assert.equal(isFormalRankingsSummaryCompatible(summary), true);
  assert.equal(isFormalRankingsSummaryCompatible({ ...summary, semanticVersion: "legacy" }), false);
  assert.equal(isFormalRankingsSummaryCompatible({ ...summary, formalRankEligibleStoreCount: 3 }), false);
});

test("dashboard + rankings formal pair is anchored to month, brand and ranking count", () => {
  const dashboard = makeDashboardSummary();
  const rankings = makeRankingsSummary();
  assert.equal(isFormalReportSummaryPairCompatible({ dashboardSummary: dashboard, rankingsSummary: rankings, yearMonth: "2026-07", brandId: "cyj" }), true);
  assert.equal(isFormalReportSummaryPairCompatible({ dashboardSummary: dashboard, rankingsSummary: rankings, yearMonth: "2026-06", brandId: "cyj" }), false);
  assert.equal(isFormalReportSummaryPairCompatible({ dashboardSummary: dashboard, rankingsSummary: rankings, yearMonth: "2026-07", brandId: "anniu" }), false);
});

test("historical formal trust requires verified flag plus month/brand anchored summary pair", () => {
  const trusted = resolveHistoricalReportFormalTrust({
    yearMonth: "2026-07",
    brandId: "cyj",
    dashboardSummary: makeDashboardSummary(),
    rankingsSummary: makeRankingsSummary(),
    reportSummaryReady: true,
    reportSummaryReadyYearMonth: "2026-07",
    reportSummaryReadyBrandId: "cyj",
    summaryFlagState: verifiedFlagState,
  });
  assert.deepEqual(trusted, { trusted: true, loading: false, reason: "VERIFIED_FORMAL_SUMMARY" });

  const dirty = resolveHistoricalReportFormalTrust({
    yearMonth: "2026-07",
    brandId: "cyj",
    dashboardSummary: makeDashboardSummary(),
    rankingsSummary: makeRankingsSummary(),
    reportSummaryReady: true,
    reportSummaryReadyYearMonth: "2026-07",
    reportSummaryReadyBrandId: "cyj",
    summaryFlagState: { ...verifiedFlagState, data: { status: "dirty", dirty: true } },
  });
  assert.equal(dirty.trusted, false);
  assert.equal(dirty.reason, "SUMMARY_DIRTY");
});

test("current month never enters historical formal trust", () => {
  const result = resolveHistoricalReportFormalTrust({ isCurrentMonth: true });
  assert.equal(result.trusted, false);
  assert.equal(result.reason, "CURRENT_MONTH_LIVE");
});

test("formal ranking consumes persisted formal actuals/achievements and excludes Lifecycle-ineligible rows", () => {
  const result = buildHistoricalFormalRankingRows({
    dashboardSummary: makeDashboardSummary(),
    rankingsSummary: makeRankingsSummary(),
    managers: { M1: ["A", "B"], M2: ["C"] },
    normalizeStoreKey,
    brandPrefix: "CYJ",
  });
  assert.equal(result.compatible, true);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map((row) => row.displayName), ["A", "B"]);
  assert.deepEqual(result.rows.map((row) => row.rank), [1, 2]);
  assert.equal(result.rows[0].cashTotal, 100);
  assert.equal(result.rows[0].achievement, 100);
  assert.equal(result.rows[1].accrualTotal, 120);
  assert.equal(result.rows[1].accrualAchievement, 60);
});

test("explicit Ranking exclusion filters the formal authority order and reindexes presentation rank", () => {
  const result = buildHistoricalFormalRankingRows({
    dashboardSummary: makeDashboardSummary(),
    rankingsSummary: makeRankingsSummary(),
    managers: { M1: ["A", "B"] },
    auditExclusions: ["A"],
    normalizeStoreKey,
    brandPrefix: "CYJ",
  });
  assert.equal(result.rankEligibleStoreCount, 1);
  assert.equal(result.sourceRankEligibleStoreCount, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].displayName, "B");
  assert.equal(result.rows[0].rank, 1);
  assert.equal(result.rows[0].formalCashAchievementRank, 2);
});

test("formal ranking preserves valid zero/negative KPI values instead of coercing them to missing", () => {
  const dashboard = makeDashboardSummary();
  dashboard.stores.A.formalNetCash = 0;
  dashboard.stores.A.formalNetCashStatus = KPI_VALUE_STATUS.VALID_ZERO;
  dashboard.stores.A.formalAccrual = -20;
  dashboard.stores.A.formalAccrualStatus = KPI_VALUE_STATUS.VALID;
  const result = buildHistoricalFormalRankingRows({
    dashboardSummary: dashboard,
    rankingsSummary: makeRankingsSummary(),
    managers: { M1: ["A", "B"] },
    normalizeStoreKey,
  });
  const row = result.rows.find((item) => item.displayName === "A");
  assert.equal(row.cashTotal, 0);
  assert.equal(row.accrualTotal, -20);
});

test("formal Regional aggregates only Lifecycle-eligible scope using Coverage v1 denominator", () => {
  const result = buildHistoricalFormalRegionalData({
    dashboardSummary: makeDashboardSummary(),
    monthlyTargetSummary: makeTargets(),
    managers: { M1: ["A", "B"], M2: ["C"] },
    normalizeStoreKey,
    brandPrefix: "CYJ",
  });
  assert.equal(result.compatible, true);
  const m1 = result.regions.find((row) => row.manager === "M1");
  assert.equal(m1.cashTotal, 250);
  assert.equal(m1.cashStatus, KPI_VALUE_STATUS.VALID);
  assert.equal(m1.budgetTotal, 300);
  assert.equal(m1.achievement, 250 / 300 * 100);
  assert.equal(m1.accrualTotal, 210);
  assert.equal(m1.stores.length, 2);
  const m2 = result.regions.find((row) => row.manager === "M2");
  assert.equal(m2.stores.length, 0);
  assert.equal(m2.cashTotal, null);
});

test("Regional Target Coverage incomplete fails closed instead of shrinking denominator", () => {
  const targets = makeTargets();
  delete targets.targets["CYJB店"].cashTarget;
  targets.cashConfiguredStoreCount = 1;
  targets.cashCoverageComplete = false;
  targets.cashMissingStores = ["CYJB店"];
  const result = buildHistoricalFormalRegionalData({
    dashboardSummary: makeDashboardSummary(),
    monthlyTargetSummary: targets,
    managers: { M1: ["A", "B"] },
    normalizeStoreKey,
  });
  const m1 = result.regions[0];
  assert.equal(m1.cashTotal, 250);
  assert.equal(m1.budgetTotal, null);
  assert.equal(m1.achievement, null);
  assert.equal(m1.achievementStatus, SUMMARY_KPI_STATUS.TARGET_INCOMPLETE);
});

test("App applies shared verified/fallback read policy to Dashboard, Ranking and Regional", () => {
  const app = read("src/App.jsx");
  assert.match(app, /isFormalReportSummaryPairCompatible/);
  assert.match(app, /\(activeView === "dashboard" \|\| isSummaryFirstReportView\)/);
  assert.match(app, /dashboardReadPolicy\.shouldLoadDailyReports/);
  assert.match(app, /brandId:\s*currentBrand\?\.id/);
});

test("Ranking and Regional consumers use Formal contract and render missing KPI as N\/A", () => {
  const ranking = read("src/components/RankingView.jsx");
  const regional = read("src/components/RegionalView.jsx");
  assert.match(ranking, /buildHistoricalFormalRankingRows/);
  assert.match(ranking, /resolveHistoricalReportFormalTrust/);
  assert.match(ranking, /store\.rank \?\? "—"/);
  assert.match(ranking, /formatPercentOrNA/);
  assert.match(regional, /buildHistoricalFormalRegionalData/);
  assert.match(regional, /resolveHistoricalReportFormalTrust/);
  assert.match(regional, /formatMoneyOrNA/);
  assert.doesNotMatch(regional, /summaryStore\.cash/);
});

test("latest production writer persists the exact Formal Ranking authority Batch 5B-1 consumes", () => {
  const writer = read("functions/index.js");
  assert.match(writer, /formalStoreRankings:\s*formalStoreRanking\.rankings/);
  assert.match(writer, /formalRankEligibleStoreCount:\s*formalStoreRanking\.rankEligibleStoreCount/);
  assert.match(writer, /formalCashAchievementRank/);
  assert.match(writer, /formalRankEligible/);
  assert.match(writer, /formalTargetAuthority/);
});

test("Batch 5B-1 adds no Firestore listener/query and keeps app version unchanged", () => {
  const util = read("src/utils/reportFormalConsumer.js");
  const ranking = read("src/components/RankingView.jsx");
  const regional = read("src/components/RegionalView.jsx");
  const app = read("src/App.jsx");
  assert.doesNotMatch(util, /firebase\/firestore|onSnapshot\s*\(|getDocs\s*\(|getDoc\s*\(/);
  assert.doesNotMatch(ranking, /firebase\/firestore|onSnapshot\s*\(|getDocs\s*\(|getDoc\s*\(/);
  assert.doesNotMatch(regional, /firebase\/firestore|onSnapshot\s*\(|getDocs\s*\(|getDoc\s*\(/);
  assert.match(app, /CURRENT_APP_VERSION = "3\.5\.3"/);
});
