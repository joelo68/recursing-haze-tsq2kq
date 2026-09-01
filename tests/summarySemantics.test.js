import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as frontend from "../src/utils/summarySemantics.js";
import * as frontendKpi from "../src/utils/kpiContracts.js";

const require = createRequire(import.meta.url);
const backend = require("../functions/summarySemantics.js");
const backendKpi = require("../functions/kpiContracts.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const implementations = [
  ["frontend", frontend, frontendKpi],
  ["backend", backend, backendKpi],
];

for (const [label, api, kpi] of implementations) {
  test(`${label}: formal summary cash preserves gross/refunds and includes skincare refund`, () => {
    const metrics = api.buildFormalReportMetrics("cyj", {
      cash: 100000,
      refund: 10000,
      skincareRefund: 5000,
      accrual: 80000,
      operationalAccrual: 70000,
    });
    assert.equal(metrics.grossCash, 100000);
    assert.equal(metrics.refund, 10000);
    assert.equal(metrics.skincareRefund, 5000);
    assert.equal(metrics.formalNetCash, 85000);
    assert.equal(metrics.formalNetCashStatus, kpi.KPI_VALUE_STATUS.VALID);
    assert.equal(metrics.totalAccrual, 80000);
    assert.equal(metrics.formalAccrual, 80000);
    assert.equal(metrics.formalAccrualSource, "accrual");
  });

  test(`${label}: 安妞 preserves total accrual while formal accrual uses operationalAccrual`, () => {
    const metrics = api.buildFormalReportMetrics("anniu", {
      cash: 1000,
      refund: 100,
      skincareRefund: 50,
      accrual: 900,
      operationalAccrual: 700,
    });
    assert.equal(metrics.totalAccrual, 900);
    assert.equal(metrics.operationalAccrual, 700);
    assert.equal(metrics.formalAccrual, 700);
    assert.equal(metrics.formalAccrualSource, "operationalAccrual");
  });

  test(`${label}: true zero and negative formal net cash remain valid`, () => {
    const zero = api.buildFormalReportMetrics("yibo", {
      cash: 150,
      refund: 100,
      skincareRefund: 50,
      accrual: 0,
      operationalAccrual: 0,
    });
    assert.equal(zero.formalNetCash, 0);
    assert.equal(zero.formalNetCashStatus, kpi.KPI_VALUE_STATUS.VALID_ZERO);

    const negative = api.buildFormalReportMetrics("cyj", {
      cash: 100,
      refund: 120,
      skincareRefund: 10,
      accrual: 50,
      operationalAccrual: 50,
    });
    assert.equal(negative.formalNetCash, -30);
    assert.equal(negative.formalNetCashStatus, kpi.KPI_VALUE_STATUS.VALID);
  });

  test(`${label}: missing raw component stays missing instead of silently becoming zero`, () => {
    const metrics = api.buildFormalReportMetrics("cyj", {
      cash: 1000,
      refund: 100,
      accrual: 500,
      operationalAccrual: 500,
      // skincareRefund intentionally missing
    });
    assert.equal(metrics.skincareRefund, null);
    assert.equal(metrics.skincareRefundStatus, kpi.KPI_VALUE_STATUS.FIELD_MISSING);
    assert.equal(metrics.formalNetCash, null);
    assert.equal(metrics.formalNetCashStatus, kpi.KPI_VALUE_STATUS.FIELD_MISSING);
  });

  test(`${label}: aggregate formal metrics are additive and do not overwrite legacy numeric field names`, () => {
    const result = api.aggregateFormalMetrics("anniu", [
      { cash: 1000, refund: 100, skincareRefund: 50, accrual: 900, operationalAccrual: 700 },
      { cash: 500, refund: 0, skincareRefund: 0, accrual: 400, operationalAccrual: 300 },
    ]);
    assert.equal(result.grossCash, 1500);
    assert.equal(result.formalNetCash, 1350);
    assert.equal(result.totalAccrual, 1300);
    assert.equal(result.formalAccrual, 1000);
    assert.equal(result.formalAccrualSource, "operationalAccrual");

    // These legacy field names are intentionally absent from the additive patch.
    assert.equal(Object.prototype.hasOwnProperty.call(result, "refund"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result, "skincareRefund"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result, "operationalAccrual"), false);
    assert.equal(result.refundStatus, kpi.KPI_VALUE_STATUS.VALID);
    assert.equal(result.skincareRefundStatus, kpi.KPI_VALUE_STATUS.VALID);
    assert.equal(result.operationalAccrualStatus, kpi.KPI_VALUE_STATUS.VALID);
  });

  test(`${label}: independent Target Coverage becomes trusted only when Batch 3 metadata matches Lifecycle cohort`, () => {
    const targetMap = {
      A: { cashTarget: 100, accrualTarget: 200 },
      B: { cashTarget: 300, accrualTarget: null },
    };
    const coverage = api.extractTargetCoverageMetadata({
      targetCoverageVersion: "target-coverage-v1",
      kpiContractVersion: kpi.KPI_CONTRACT_VERSION,
      lifecycleReady: true,
      eligibleStoreCount: 2,
      cashConfiguredStoreCount: 2,
      accrualConfiguredStoreCount: 1,
      cashCoverageComplete: true,
      accrualCoverageComplete: false,
      cashMissingStores: [],
      accrualMissingStores: ["CYJB店"],
    });
    const authority = api.buildSummaryTargetAuthoritySnapshot({
      targetMap,
      eligibleStoreKeys: ["A", "B"],
      lifecycleReady: true,
      targetCoverage: coverage,
    });
    assert.equal(authority.cashTargetTotal, 400);
    assert.equal(authority.accrualTargetTotal, 200);
    assert.equal(authority.cashCoverageTrusted, true);
    assert.equal(authority.accrualCoverageTrusted, false);
    assert.equal(authority.coverageVersionCompatible, true);
    assert.equal(authority.coverageConsistent, true);

    const staleVersion = api.buildSummaryTargetAuthoritySnapshot({
      targetMap,
      eligibleStoreKeys: ["A", "B"],
      lifecycleReady: true,
      targetCoverage: { ...coverage, kpiContractVersion: "old-contract" },
    });
    assert.equal(staleVersion.coverageVersionCompatible, false);
    assert.equal(staleVersion.coverageConsistent, false);
    assert.equal(staleVersion.cashCoverageTrusted, false);
  });

  test(`${label}: aggregate achievement is N/A/TARGET_INCOMPLETE when corresponding coverage is incomplete`, () => {
    const incomplete = api.buildScopeFormalAchievement({
      actualValue: 100,
      actualStatus: kpi.KPI_VALUE_STATUS.VALID,
      targetValue: 200,
      coverageComplete: false,
    });
    assert.equal(incomplete.valid, false);
    assert.equal(incomplete.value, null);
    assert.equal(incomplete.status, api.SUMMARY_KPI_STATUS.TARGET_INCOMPLETE);

    const zero = api.buildScopeFormalAchievement({
      actualValue: 0,
      actualStatus: kpi.KPI_VALUE_STATUS.VALID_ZERO,
      targetValue: 200,
      coverageComplete: true,
    });
    assert.equal(zero.valid, true);
    assert.equal(zero.value, 0);
    assert.equal(zero.status, kpi.KPI_VALUE_STATUS.VALID_ZERO);

    const negative = api.buildScopeFormalAchievement({
      actualValue: -50,
      actualStatus: kpi.KPI_VALUE_STATUS.VALID,
      targetValue: 200,
      coverageComplete: true,
    });
    assert.equal(negative.valid, true);
    assert.equal(negative.value, -25);
  });

  test(`${label}: formal store ranking uses cash achievement, preserves true zero/negative, and excludes invalid target/data or Lifecycle-ineligible stores`, () => {
    const stores = {
      A: { store: "A", formalNetCash: 100, formalNetCashStatus: kpi.KPI_VALUE_STATUS.VALID, formalAccrual: 0, formalAccrualStatus: kpi.KPI_VALUE_STATUS.VALID_ZERO },
      B: { store: "B", formalNetCash: 150, formalNetCashStatus: kpi.KPI_VALUE_STATUS.VALID, formalAccrual: 0, formalAccrualStatus: kpi.KPI_VALUE_STATUS.VALID_ZERO },
      C: { store: "C", formalNetCash: 0, formalNetCashStatus: kpi.KPI_VALUE_STATUS.VALID_ZERO, formalAccrual: 0, formalAccrualStatus: kpi.KPI_VALUE_STATUS.VALID_ZERO },
      D: { store: "D", formalNetCash: -10, formalNetCashStatus: kpi.KPI_VALUE_STATUS.VALID, formalAccrual: 0, formalAccrualStatus: kpi.KPI_VALUE_STATUS.VALID_ZERO },
      E: { store: "E", formalNetCash: 999, formalNetCashStatus: kpi.KPI_VALUE_STATUS.FIELD_MISSING, formalAccrual: 0, formalAccrualStatus: kpi.KPI_VALUE_STATUS.VALID_ZERO },
      F: { store: "F", formalNetCash: 1000, formalNetCashStatus: kpi.KPI_VALUE_STATUS.VALID, formalAccrual: 0, formalAccrualStatus: kpi.KPI_VALUE_STATUS.VALID_ZERO },
    };
    const targets = {
      A: { cashTarget: 100 },  // 100%
      B: { cashTarget: 200 },  // 75% despite higher cash
      C: { cashTarget: 100 },  // 0%, still valid
      D: { cashTarget: 100 },  // -10%, still valid
      E: { cashTarget: 100 },  // invalid actual
      F: { cashTarget: 100 },  // lifecycle-ineligible
    };
    const ranking = api.buildFormalStoreRanking(stores, targets, { eligibleStoreKeys: ["A", "B", "C", "D", "E"] });
    assert.deepEqual(ranking.rankings.map((row) => row.store), ["A", "B", "C", "D"]);
    assert.deepEqual(ranking.rankings.map((row) => row.formalCashAchievementRank), [1, 2, 3, 4]);
    assert.equal(ranking.byStore.C.formalRankEligible, true);
    assert.equal(ranking.byStore.D.formalRankEligible, true);
    assert.equal(ranking.byStore.E.formalRankEligible, false);
    assert.equal(ranking.byStore.F.formalRankEligible, false);
  });

  test(`${label}: store/ranking signatures are stable and detect semantic drift`, () => {
    const a = {
      stores: {
        B: { formalNetCash: 50, formalNetCashStatus: "VALID", refund: 1 },
        A: { formalNetCash: 100, formalNetCashStatus: "VALID", refund: 2 },
      },
      formalStoreRankings: [
        { store: "A", formalCashAchievement: 100, formalCashAchievementRank: 1, formalRankEligible: true },
      ],
    };
    const b = {
      stores: {
        A: { formalNetCash: 100, formalNetCashStatus: "VALID", refund: 2 },
        B: { formalNetCash: 50, formalNetCashStatus: "VALID", refund: 1 },
      },
      formalStoreRankings: [
        { store: "A", formalCashAchievement: 100, formalCashAchievementRank: 1, formalRankEligible: true },
      ],
    };
    assert.equal(api.buildSummaryStoreSemanticSignature(a), api.buildSummaryStoreSemanticSignature(b));
    assert.equal(api.buildFormalRankingSignature(a), api.buildFormalRankingSignature(b));

    b.stores.B.formalNetCash = 49;
    assert.notEqual(api.buildSummaryStoreSemanticSignature(a), api.buildSummaryStoreSemanticSignature(b));
  });
}

test("frontend and backend Summary Semantics stay behaviorally identical", () => {
  assert.equal(frontend.SUMMARY_SEMANTIC_VERSION, backend.SUMMARY_SEMANTIC_VERSION);
  assert.deepEqual(frontend.SUMMARY_KPI_STATUS, backend.SUMMARY_KPI_STATUS);

  const reportRows = [
    { cash: 1000, refund: 100, skincareRefund: 50, accrual: 900, operationalAccrual: 700 },
    { cash: 500, refund: 0, skincareRefund: 0, accrual: 400, operationalAccrual: 300 },
  ];
  assert.deepEqual(frontend.aggregateFormalMetrics("anniu", reportRows), backend.aggregateFormalMetrics("anniu", reportRows));

  const coverageData = {
    targetCoverageVersion: "target-coverage-v1",
    kpiContractVersion: "kpi-contract-v1",
    lifecycleReady: true,
    eligibleStoreCount: 1,
    cashConfiguredStoreCount: 1,
    accrualConfiguredStoreCount: 1,
    cashCoverageComplete: true,
    accrualCoverageComplete: true,
    cashMissingStores: [],
    accrualMissingStores: [],
  };
  const args = {
    targetMap: { A: { cashTarget: 100, accrualTarget: 200 } },
    eligibleStoreKeys: ["A"],
    lifecycleReady: true,
    targetCoverage: frontend.extractTargetCoverageMetadata(coverageData),
  };
  assert.deepEqual(frontend.buildSummaryTargetAuthoritySnapshot(args), backend.buildSummaryTargetAuthoritySnapshot({
    ...args,
    targetCoverage: backend.extractTargetCoverageMetadata(coverageData),
  }));
});

test("Batch 4 source wiring is additive, Summary-first, store-level comparable, and has no new polling", () => {
  const functionsIndex = read("functions/index.js");
  const maintenance = read("src/components/SystemMaintenance.jsx");
  const backendSemantics = read("functions/summarySemantics.js");

  assert.match(functionsIndex, /require\("\.\/summarySemantics"\)/);
  assert.match(functionsIndex, /semanticVersion:\s*SUMMARY_SEMANTIC_VERSION/);
  assert.match(functionsIndex, /version:\s*"dashboard-summary-v2"/);
  assert.match(functionsIndex, /formalTargetAuthority/);
  assert.match(functionsIndex, /formalStoreRankings/);
  assert.match(functionsIndex, /buildSummaryStoreSemanticSignature/);
  assert.match(functionsIndex, /buildFormalRankingSignature/);
  assert.match(functionsIndex, /storedRankingsSnap/);
  assert.match(functionsIndex, /monthly_targets_summary missing Target Coverage v1 metadata/);
  assert.match(functionsIndex, /Cash\/Accrual coverage incomplete is a valid business state and must NOT trigger a full monthly_targets scan/);
  assert.doesNotMatch(functionsIndex, /setInterval\s*\(/);

  assert.match(maintenance, /from "\.\.\/utils\/summarySemantics"/);
  assert.match(maintenance, /version:\s*"dashboard-summary-v2"/);
  assert.match(maintenance, /storeDailyTotals/);
  assert.match(maintenance, /storedRankingsSnap/);
  assert.match(maintenance, /buildSummaryStoreSemanticSignature/);
  assert.match(maintenance, /buildFormalRankingSignature/);
  assert.match(maintenance, /Cash\/Accrual coverage incomplete 是正式狀態，不應因 incomplete 而 full-scan monthly_targets/);

  // Guard against accidentally reusing colliding legacy field names in the additive aggregate patch.
  assert.match(backendSemantics, /do not overwrite legacy Summary fields/);
});

test("Batch 4 only changes Summary repair exports on Backend call graph", () => {
  const functionsIndex = read("functions/index.js");
  const buildIndex = functionsIndex.indexOf("async function buildAutoDashboardSummaryPayloads");
  const finalizeIndex = functionsIndex.indexOf("async function finalizeMonthReportAuto");
  assert.ok(buildIndex >= 0);
  assert.ok(finalizeIndex > buildIndex);

  const directBuildCalls = [...functionsIndex.matchAll(/buildAutoDashboardSummaryPayloads\(/g)].map((m) => m.index);
  assert.equal(directBuildCalls.length, 2, "expected one declaration + one finalize call");
  assert.match(functionsIndex, /exports\.repairDirtySummaryNow\s*=/);
  assert.match(functionsIndex, /exports\.repairDirtySummaries\s*=/);
});

for (const [label, api, kpi] of implementations) {
  test(`${label}: 5E-1B zero target preserves VALID_ZERO and denominator N_A`, () => {
    const metrics = api.buildFormalReportMetrics("cyj", {
      cash: 100,
      refund: 0,
      skincareRefund: 0,
      accrual: 100,
      operationalAccrual: 100,
    });
    const meta = api.buildStoreFormalKpiMetadata(metrics, {
      cashTarget: 0,
      accrualTarget: 0,
    });

    assert.equal(meta.formalCashTarget, 0);
    assert.equal(meta.formalCashTargetStatus, kpi.KPI_VALUE_STATUS.VALID_ZERO);
    assert.equal(meta.formalCashAchievement, null);
    assert.equal(meta.formalCashAchievementStatus, kpi.KPI_VALUE_STATUS.N_A);
    assert.equal(meta.formalAccrualTarget, 0);
    assert.equal(meta.formalAccrualTargetStatus, kpi.KPI_VALUE_STATUS.VALID_ZERO);
    assert.equal(meta.formalAccrualAchievement, null);
    assert.equal(meta.formalAccrualAchievementStatus, kpi.KPI_VALUE_STATUS.N_A);
    assert.equal(meta.formalRankEligible, false);
  });
}
