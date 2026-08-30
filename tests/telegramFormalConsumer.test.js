import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

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

test("5C-2 decouples active-alert policy scope from Formal KPI authority", () => {
  const storeStart = indexSource.indexOf("async function getStorePerformance");
  const storeEnd = indexSource.indexOf("function normalizeTelegramAgentTherapistRow", storeStart);
  const storeSource = indexSource.slice(storeStart, storeEnd);
  assert.match(storeSource, /const formalKpiMode = true;/);
  assert.doesNotMatch(storeSource, /policyScopes\.includes\("active_alert"\)/);
  assert.match(storeSource, /formalKpiMode,/);
});

test("5C-2 Active Alert runtime resolves Formal status helper through index import", async () => {
  const formalImportEndMarker = '} = require("./telegram/formalKpi");';
  const formalImportEndMarkerIndex = indexSource.indexOf(formalImportEndMarker);
  const formalImportStart = indexSource.lastIndexOf("const {", formalImportEndMarkerIndex);
  const formalImportEnd = formalImportEndMarkerIndex + formalImportEndMarker.length;
  const formalImportSource = indexSource.slice(formalImportStart, formalImportEnd);
  assert.ok(formalImportStart >= 0 && formalImportEndMarkerIndex >= 0, "formalKpi import block must be extractable");
  assert.match(formalImportSource, /\bisValidNumericStatus\b/, "functions/index.js must import isValidNumericStatus from formalKpi");

  const alertsStart = indexSource.indexOf("async function getOperationalAlerts");
  const alertsEnd = indexSource.indexOf("async function getDataHealth", alertsStart);
  const runtimeSource = `${indexSource.slice(formalImportStart, formalImportEnd)}\n${indexSource.slice(alertsStart, alertsEnd)}\ngetOperationalAlerts;`;

  const disabledRule = { enabled: false, threshold: 0, criticalThreshold: 0, watchThreshold: 0, minSample: 0, severity: "watch" };
  const rules = {
    missingReport: { ...disabledRule },
    missingTarget: { ...disabledRule },
    progressGap: { ...disabledRule },
    cashAchievementRate: { ...disabledRule },
    closingRate: { ...disabledRule },
    skincareRatio: { ...disabledRule },
    newCustomers: { ...disabledRule },
    traffic: { ...disabledRule },
  };

  const sandbox = {
    require: (specifier) => {
      assert.equal(specifier, "./telegram/formalKpi");
      return require("../functions/telegram/formalKpi.js");
    },
    normalizeTelegramAgentYearMonth: (value) => value,
    getTelegramAgentTaipeiNow: () => ({ yearMonth: "2026-07", todayStr: "2026-07-31" }),
    resolveTelegramAgentBrands: () => ["cyj"],
    getTelegramAgentExpectedProgress: () => 80,
    normalizeTelegramActiveAlertRules: () => rules,
    applyTelegramAgentAlertPolicies: (value) => value,
    getTelegramActiveAlertEnabledRuleLabels: () => [],
    getTelegramAgentAlertLimit: () => 10,
    loadTelegramAgentStoreMonth: async () => ({
      rows: [{
        storeName: "仁愛",
        cash: 100,
        cashStatus: "VALID",
        budget: 200,
        cashTargetStatus: "VALID",
        achievement: 50,
        cashAchievementRate: 50,
        cashAchievementStatus: "VALID",
        newCount: 0,
        newClosings: 0,
        skincareGross: 0,
        traffic: 0,
        formalKpiMode: true,
      }],
      source: "verified_formal_dashboard_summary",
      updatedAtText: "2026-08-30",
      formalKpiMode: true,
      preSystem: false,
    }),
    loadTelegramAgentOrgProfile: async () => ({
      stores: ["仁愛"],
      storeOwner: { "仁愛": "測試區長" },
      actingDelegationByStore: {},
      activeDelegations: [],
      actingManagerByStore: {},
      sourcePath: "org_structure",
      delegationSourcePath: "",
    }),
    loadTelegramAgentAuditExclusions: async () => ({ storeSet: new Set(), stores: [], sourcePath: "audit_exclusions" }),
    getTelegramPolicyExcludedStoreSet: () => new Set(),
    normalizeSummaryCoreName: (value) => String(value || ""),
    loadTelegramAgentTargetMap: async () => { throw new Error("Formal row should own target authority"); },
    getTelegramAgentBrandLabel: () => "DRCYJ",
    buildTelegramAgentDataQuality: (value) => value,
    getTelegramAgentDateDiffDays: () => 30,
    getTelegramAgentMetricDictionary: () => ({}),
  };

  const getOperationalAlertsRuntime = vm.runInNewContext(runtimeSource, sandbox);
  const result = await getOperationalAlertsRuntime("2026-07", "CYJ", 10, { warnings: [] }, rules);

  assert.equal(result.formal_kpi_mode, true);
  assert.equal(result.brandSummaries.length, 1);
  assert.equal(result.brandSummaries[0].cash, 100);
  assert.equal(result.brandSummaries[0].budget, 200);
  assert.equal(result.brandSummaries[0].cashAchievementRate, 50);
  assert.equal(result.brandSummaries[0].cashAchievementStatus, "VALID");
});

test("5C-2 Active Alert consumes Formal KPI and preserves policy scope", () => {
  const alertsStart = indexSource.indexOf("async function getOperationalAlerts");
  const alertsEnd = indexSource.indexOf("async function getDataHealth", alertsStart);
  const alertsSource = indexSource.slice(alertsStart, alertsEnd);
  assert.match(alertsSource, /loadTelegramAgentStoreMonth\(brandId, ym, ctx, \{ formalKpiMode: true \}\)/);
  assert.match(alertsSource, /getTelegramPolicyExcludedStoreSet\(ctx, brandId, \["active_alert"\]\)/);
  assert.match(alertsSource, /loaded\.preSystem === true/);
  assert.match(alertsSource, /dataStatus: "PRE_SYSTEM_SKIP"/);
  assert.match(alertsSource, /cashTargetStatus === "VALID"/);
  assert.match(alertsSource, /isValidNumericStatus\(cashStatus\)/);
  assert.match(alertsSource, /isValidNumericStatus\(cashAchievementStatus\)/);
  assert.match(alertsSource, /formalKpiMode: true/);
  assert.match(alertsSource, /formal_kpi_mode: true/);
  assert.match(alertsSource, /getTelegramAgentMetricDictionary\(\["cashAchievementRate", "expectedProgress", "progressGap"\], \{ formalMode: true \}\)/);
});

test("5C-2 Active Alert fails closed instead of shrinking brand denominator", () => {
  const alertsStart = indexSource.indexOf("async function getOperationalAlerts");
  const alertsEnd = indexSource.indexOf("async function getDataHealth", alertsStart);
  const alertsSource = indexSource.slice(alertsStart, alertsEnd);
  assert.match(alertsSource, /const reportComplete = activeStoreCores\.length > 0 && reportedStoreCount >= activeStoreCores\.length/);
  assert.match(alertsSource, /const targetComplete = activeStoreCores\.length > 0 && targetedStoreCount >= activeStoreCores\.length/);
  assert.match(alertsSource, /const brandCash = reportComplete \? brandCashSum : null/);
  assert.match(alertsSource, /const brandBudget = targetComplete \? brandBudgetSum : null/);
  assert.match(alertsSource, /!targetComplete \? "TARGET_INCOMPLETE" : "DATA_INCOMPLETE"/);
  assert.doesNotMatch(alertsSource, /const budget = Number\(row\?\.budget \|\| target\.cashTarget \|\| 0\)/);
});

test("5C-2 only falls back to target lookup for stores with no Formal row", () => {
  const alertsStart = indexSource.indexOf("async function getOperationalAlerts");
  const alertsEnd = indexSource.indexOf("async function getDataHealth", alertsStart);
  const alertsSource = indexSource.slice(alertsStart, alertsEnd);
  assert.match(alertsSource, /const missingRowStoreCores = activeStoreCores\.filter\(\(storeCore\) => !rowByCore\[storeCore\]\)/);
  assert.match(alertsSource, /missingRowStoreCores\.length > 0[\s\S]*loadTelegramAgentTargetMap\(brandId, ym, ctx, null, missingRowStoreCores\)/);
  assert.match(alertsSource, /source: "formal_row_authority"/);
});


test("5C-2 Active Alert presentation distinguishes target vs actual incompleteness", () => {
  const formatterStart = indexSource.indexOf("function formatTelegramAgentActiveAlertMessage");
  const formatterEnd = indexSource.indexOf("async function buildTelegramActiveAlertMessages", formatterStart);
  const formatterSource = indexSource.slice(formatterStart, formatterEnd);
  assert.match(formatterSource, /summary\?\.dataStatus === "PRE_SYSTEM_SKIP"/);
  assert.match(formatterSource, /summary\?\.cashAchievementStatus === "TARGET_INCOMPLETE"/);
  assert.match(formatterSource, /row\.cashTargetStatus !== "VALID" \? "現金目標資料不足" : "現金實績資料不足"/);
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
