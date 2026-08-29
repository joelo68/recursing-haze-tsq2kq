import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  isTelegramFormalPreSystemMonth,
  inspectTelegramFormalSummaryTrust,
  buildTelegramFormalMetricsFromCanonical,
  buildTelegramFormalRawMetrics,
  buildTelegramFormalSummaryMetrics,
  aggregateTelegramFormalRows,
} = require("../functions/telegram/formalKpi.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexSource = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8");
const promptSource = fs.readFileSync(path.join(__dirname, "../functions/telegram/prompts.js"), "utf8");

function trustedSummary(overrides = {}) {
  return {
    version: "dashboard-summary-v2",
    semanticVersion: "summary-semantics-v1",
    kpiContractVersion: "kpi-contract-v1",
    brandId: "cyj",
    yearMonth: "2026-07",
    targetCoverage: {
      targetCoverageVersion: "target-coverage-v1",
      kpiContractVersion: "kpi-contract-v1",
    },
    lifecycleSnapshot: { datasetStatus: "READY" },
    formalTargetAuthority: {
      lifecycleReady: true,
      coverageAuthorityAvailable: true,
      coverageVersionCompatible: true,
      coverageConsistent: true,
    },
    ...overrides,
  };
}

test("CYJ current/raw Formal cash subtracts general and skincare refunds", () => {
  const result = buildTelegramFormalRawMetrics("cyj", {
    grossCash: 1000,
    refund: 100,
    skincareRefund: 50,
    accrual: 800,
    operationalAccrual: 700,
  }, { cashTarget: 1000, accrualTarget: 900 });
  assert.equal(result.cash, 850);
  assert.equal(result.cashStatus, "VALID");
  assert.equal(result.achievement, 85);
});

test("Anniu Formal accrual uses operationalAccrual", () => {
  const result = buildTelegramFormalRawMetrics("anniu", {
    grossCash: 1000,
    refund: 0,
    skincareRefund: 0,
    accrual: 1200,
    operationalAccrual: 900,
  }, { cashTarget: 1000, accrualTarget: 1000 });
  assert.equal(result.accrual, 900);
  assert.equal(result.accrualAchievement, 90);
});

test("Yibo Formal accrual keeps accrual authority", () => {
  const result = buildTelegramFormalRawMetrics("yibo", {
    grossCash: 1000,
    refund: 0,
    skincareRefund: 0,
    accrual: 700,
    operationalAccrual: 200,
  }, { cashTarget: 1000, accrualTarget: 1000 });
  assert.equal(result.accrual, 700);
});

test("valid zero is preserved instead of treated as missing", () => {
  const result = buildTelegramFormalRawMetrics("cyj", {
    grossCash: 100,
    refund: 100,
    skincareRefund: 0,
    accrual: 0,
    operationalAccrual: 0,
  }, { cashTarget: 1000, accrualTarget: 1000 });
  assert.equal(result.cash, 0);
  assert.equal(result.cashStatus, "VALID_ZERO");
  assert.equal(result.achievement, 0);
});

test("missing target remains N/A and does not become zero denominator", () => {
  const result = buildTelegramFormalRawMetrics("cyj", {
    grossCash: 1000,
    refund: 0,
    skincareRefund: 0,
    accrual: 1000,
    operationalAccrual: 0,
  }, {});
  assert.equal(result.budget, null);
  assert.equal(result.cashTargetStatus, "TARGET_NOT_SET");
  assert.equal(result.achievement, null);
});


test("canonical raw aggregate preserves missing status instead of collapsing it to zero", () => {
  const result = buildTelegramFormalMetricsFromCanonical({
    formalNetCash: null,
    formalNetCashStatus: "FIELD_MISSING",
    formalAccrual: 100,
    formalAccrualStatus: "VALID",
  }, { cashTarget: 1000, accrualTarget: 1000 });
  assert.equal(result.cash, null);
  assert.equal(result.cashStatus, "FIELD_MISSING");
  assert.equal(result.achievement, null);
});

test("historical Summary consumer uses persisted Formal fields and statuses", () => {
  const result = buildTelegramFormalSummaryMetrics({
    formalNetCash: 38386697,
    formalNetCashStatus: "VALID",
    formalAccrual: 38725138,
    formalAccrualStatus: "VALID",
    formalCashTarget: 44862737,
    formalCashTargetStatus: "VALID",
    formalCashAchievement: 85.563,
    formalCashAchievementStatus: "VALID",
    formalAccrualTarget: 46277653,
    formalAccrualTargetStatus: "VALID",
    formalAccrualAchievement: 83.681,
    formalAccrualAchievementStatus: "VALID",
    formalLifecycleEligible: true,
    formalRankEligible: true,
    formalCashAchievementRank: 2,
  });
  assert.equal(result.cash, 38386697);
  assert.equal(result.budget, 44862737);
  assert.equal(result.rankingEligible, true);
  assert.equal(result.formalCashAchievementRank, 2);
});

test("historical Formal Summary trust requires the complete current contract", () => {
  const result = inspectTelegramFormalSummaryTrust({
    brandId: "cyj",
    yearMonth: "2026-07",
    summaryStatus: { verified: true },
    summaryData: trustedSummary(),
  });
  assert.deepEqual(result, { trusted: true, reason: "FORMAL_SUMMARY_TRUSTED" });
});

test("historical Formal Summary trust fails closed on semantic mismatch", () => {
  const result = inspectTelegramFormalSummaryTrust({
    brandId: "cyj",
    yearMonth: "2026-07",
    summaryStatus: { verified: true },
    summaryData: trustedSummary({ semanticVersion: "legacy" }),
  });
  assert.equal(result.trusted, false);
  assert.equal(result.reason, "SEMANTIC_VERSION_MISMATCH");
});

test("historical Formal Summary trust fails closed on coverage inconsistency", () => {
  const summary = trustedSummary();
  summary.formalTargetAuthority.coverageConsistent = false;
  const result = inspectTelegramFormalSummaryTrust({
    brandId: "cyj",
    yearMonth: "2026-07",
    summaryStatus: { verified: true },
    summaryData: summary,
  });
  assert.equal(result.trusted, false);
  assert.equal(result.reason, "TARGET_AUTHORITY_INCONSISTENT");
});

test("Yibo pre-system months are explicitly skipped", () => {
  assert.equal(isTelegramFormalPreSystemMonth("yibo", "2026-01"), true);
  assert.equal(isTelegramFormalPreSystemMonth("yibo", "2026-03"), true);
  assert.equal(isTelegramFormalPreSystemMonth("yibo", "2026-04"), false);
});

test("Formal aggregate calculates achievement only when every target is valid", () => {
  const rows = [
    { formalKpiMode: "historical_summary", cash: 100, cashStatus: "VALID", accrual: 90, accrualStatus: "VALID", budget: 200, cashTargetStatus: "VALID", accrualBudget: 180, accrualTargetStatus: "VALID" },
    { formalKpiMode: "historical_summary", cash: 50, cashStatus: "VALID", accrual: 40, accrualStatus: "VALID", budget: 100, cashTargetStatus: "VALID", accrualBudget: 80, accrualTargetStatus: "VALID" },
  ];
  const result = aggregateTelegramFormalRows(rows);
  assert.equal(result.cash, 150);
  assert.equal(result.budget, 300);
  assert.equal(result.achievement, 50);
});

test("Formal aggregate refuses denominator shrink when any target is missing", () => {
  const rows = [
    { formalKpiMode: "historical_summary", cash: 100, cashStatus: "VALID", accrual: 90, accrualStatus: "VALID", budget: 200, cashTargetStatus: "VALID", accrualBudget: 180, accrualTargetStatus: "VALID" },
    { formalKpiMode: "historical_summary", cash: 50, cashStatus: "VALID", accrual: 40, accrualStatus: "VALID", budget: null, cashTargetStatus: "TARGET_NOT_SET", accrualBudget: 80, accrualTargetStatus: "VALID" },
  ];
  const result = aggregateTelegramFormalRows(rows);
  assert.equal(result.budget, null);
  assert.equal(result.achievement, null);
  assert.equal(result.cashAchievementStatus, "TARGET_NOT_SET");
});

test("5C-1 keeps active-alert getStorePerformance on legacy input until 5C-2", () => {
  assert.match(indexSource, /const analyticalFormalKpiMode = !Array\.isArray\(policyScopes\) \|\| !policyScopes\.includes\("active_alert"\)/);
  const alertsStart = indexSource.indexOf("async function getOperationalAlerts");
  const alertsEnd = indexSource.indexOf("async function getDataHealth", alertsStart);
  const alertsSource = indexSource.slice(alertsStart, alertsEnd);
  assert.doesNotMatch(alertsSource, /formalKpiMode:\s*true/);
});

test("trusted historical analytical path does not invoke target repair", () => {
  assert.match(indexSource, /rowsNeedingTargetRepair = loaded\.formalKpiMode === true \? \[\]/);
  assert.match(indexSource, /source: "verified_formal_dashboard_summary"/);
  assert.match(indexSource, /useFormalRowTargetAuthority = loaded\.source === "verified_formal_dashboard_summary"/);
  assert.match(indexSource, /source: "formal_row_authority"/);
});

test("Telegram prompts describe Formal cash and Anniu formal accrual", () => {
  assert.match(promptSource, /Formal Net Cash/);
  assert.match(promptSource, /安妞取 operationalAccrual/);
  assert.match(promptSource, /PRE_SYSTEM_SKIP/);
  assert.doesNotMatch(promptSource, /安妞 operationalAccrual 只是操作權責子項/);
});
