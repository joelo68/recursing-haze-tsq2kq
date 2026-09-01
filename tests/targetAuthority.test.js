import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const targetCoverage = require("../functions/targetCoverage.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const targetView = read("src/components/TargetView.jsx");
const settingsView = read("src/components/SettingsView.jsx");
const app = read("src/App.jsx");
const functionsIndex = read("functions/index.js");
const coverageSource = read("functions/targetCoverage.js");

const eligibleEntries = ["A", "B", "C"].map((storeKey) => ({
  storeKey,
  coreStoreName: storeKey,
  canonicalStoreName: `CYJ${storeKey}店`,
}));

test("Target coverage keeps cash and accrual completeness independent", () => {
  const result = targetCoverage.buildIndependentCoverage({
    lifecycleReady: true,
    eligibleEntries,
    targetMap: {
      "CYJA店": { storeName: "CYJA店", cashTarget: 100, accrualTarget: 200 },
      "CYJB店": { storeName: "CYJB店", cashTarget: 100, accrualTarget: null },
      "CYJC店": { storeName: "CYJC店", cashTarget: null, accrualTarget: 200 },
    },
  });

  assert.equal(result.eligibleStoreCount, 3);
  assert.equal(result.cashCoverageComplete, false);
  assert.equal(result.accrualCoverageComplete, false);
  assert.deepEqual(result.cashMissingStores, ["CYJC店"]);
  assert.deepEqual(result.accrualMissingStores, ["CYJB店"]);
  assert.equal(result.cashConfiguredStoreCount, 2);
  assert.equal(result.accrualConfiguredStoreCount, 2);
});

test("cash complete can coexist with accrual incomplete and vice versa", () => {
  const cashComplete = targetCoverage.buildIndependentCoverage({
    lifecycleReady: true,
    eligibleEntries: eligibleEntries.slice(0, 2),
    targetMap: {
      "CYJA店": { cashTarget: 100, accrualTarget: 200 },
      "CYJB店": { cashTarget: 100, accrualTarget: null },
    },
  });
  assert.equal(cashComplete.cashCoverageComplete, true);
  assert.equal(cashComplete.accrualCoverageComplete, false);

  const accrualComplete = targetCoverage.buildIndependentCoverage({
    lifecycleReady: true,
    eligibleEntries: eligibleEntries.slice(0, 2),
    targetMap: {
      "CYJA店": { cashTarget: 100, accrualTarget: 200 },
      "CYJB店": { cashTarget: null, accrualTarget: 200 },
    },
  });
  assert.equal(accrualComplete.cashCoverageComplete, false);
  assert.equal(accrualComplete.accrualCoverageComplete, true);
});

test("coverage is not certified while Lifecycle dataset is not READY", () => {
  const result = targetCoverage.buildIndependentCoverage({
    lifecycleReady: false,
    eligibleEntries: [],
    targetMap: {},
  });
  assert.equal(result.cashCoverageComplete, false);
  assert.equal(result.accrualCoverageComplete, false);
  assert.equal(result.lifecycleReady, false);
});

test("target audit keeps zero base informational while reporting only true invalid challenge relationships", () => {
  const audit = targetCoverage.buildTargetAudit({
    "CYJA店": { cashTarget: 0, challengeCashTarget: 120 },
    "CYJB店": { cashTarget: 100, challengeCashTarget: 90 },
    "CYJC店": { accrualTarget: "bad", challengeAccrualTarget: 300 },
  });
  assert.deepEqual(audit.zeroBaseTargets, [{ storeName: "CYJA店", metric: "cash" }]);
  assert.equal(
    audit.challengeWithoutValidBase.some((row) => row.storeName === "CYJA店" && row.metric === "cash"),
    false,
    "base zero is valid, so challenge 120 is valid and must not be treated as missing-base",
  );
  assert.ok(audit.challengeNotGreaterThanBase.some((row) => row.storeName === "CYJB店" && row.metric === "cash"));
  assert.ok(audit.invalidBaseTargets.some((row) => row.storeName === "CYJC店" && row.metric === "accrual"));
  assert.ok(audit.challengeWithoutValidBase.some((row) => row.storeName === "CYJC店" && row.metric === "accrual"));
  assert.equal(audit.issueCount, 3);
});

test("target coverage physical paths preserve CYJ legacy root and standard brand roots", () => {
  assert.equal(targetCoverage.getTargetCoveragePaths("cyj").monthlyTargets, "artifacts/default-app-id/public/data/monthly_targets");
  assert.equal(targetCoverage.getTargetCoveragePaths("anniu").monthlyTargetSummary, "brands/anniu/monthly_targets_summary");
  assert.equal(targetCoverage.getTargetCoveragePaths("yibo").lifecycleMaster, "brands/yibo/store_lifecycle/master");
});

test("derived target summary keeps legacy-compatible totals synchronized with the canonical target map", () => {
  const fields = targetCoverage.buildTargetSummaryCompatibilityFields({
    "CYJA店": { cashTarget: 100, accrualTarget: 200, sourceDocId: "A" },
    "CYJB店": { cashTarget: null, accrualTarget: 300, sourceDocId: "B" },
    "CYJC店": { cashTarget: "bad", accrualTarget: 0, sourceDocId: "C" },
  }, "cyj", "2026-08");
  assert.deepEqual(fields, {
    brandId: "cyj",
    brandLabel: "CYJ",
    year: 2026,
    month: 8,
    yearMonth: "2026-08",
    storeCount: 3,
    targetCount: 3,
    cashTargetTotal: 100,
    accrualTargetTotal: 500,
    sourceDocCount: 3,
  });
});

test("Target Summary writer replaces the persisted targets map so deleted nested keys cannot survive", () => {
  const replacement = targetCoverage.buildTargetSummaryReplacementDocument({
    summaryData: {
      source: "legacy_source",
      keepMe: { value: 1 },
      targets: {
        "CYJA店": { cashTarget: 100, accrualTarget: 100, sourceDocId: "A" },
        "CYJB店": { cashTarget: 200, accrualTarget: 200, sourceDocId: "B" },
      },
    },
    targetMap: {
      "CYJA店": { cashTarget: 100, accrualTarget: 100, sourceDocId: "A" },
    },
    brandId: "cyj",
    yearMonth: "2026-08",
    coveragePatch: { cashCoverageComplete: true },
    updatedAtText: "2026-08-31T00:00:00.000Z",
  });

  assert.deepEqual(Object.keys(replacement.targets), ["CYJA店"]);
  assert.equal(Object.prototype.hasOwnProperty.call(replacement.targets, "CYJB店"), false);
  assert.deepEqual(replacement.keepMe, { value: 1 });
  assert.equal(replacement.source, "legacy_source");
  assert.equal(replacement.storeCount, 1);
  assert.equal(replacement.targetCount, 1);

  assert.match(coverageSource, /transaction\.set\(summaryRef, replacementDocument, \{ merge: false \}\)/);
  assert.match(coverageSource, /spreading summaryData preserves unrelated top-level fields/);
});

test("unknown target coverage brands are rejected instead of silently falling back to CYJ", () => {
  assert.equal(targetCoverage.normalizeTargetCoverageBrandId("unknown"), "");
  assert.throws(() => targetCoverage.getTargetCoveragePaths("unknown"), /UNSUPPORTED_TARGET_COVERAGE_BRAND/);
  assert.match(coverageSource, /if \(!normalizedBrandId\) throw new Error\('UNSUPPORTED_TARGET_COVERAGE_BRAND'\)/);
  assert.match(coverageSource, /return brandId \? handleMonthlyTargetWrite\(change, context, brandId\) : null/);
});

test("partial challenge configuration falls back to each store base target at aggregate scope", () => {
  const targetMap = {
    "CYJA店": { cashTarget: 100, challengeCashTarget: 130 },
    "CYJB店": { cashTarget: 200, challengeCashTarget: null },
  };
  const result = targetCoverage.buildScopeChallengeTarget({
    targetMap,
    eligibleEntries: eligibleEntries.slice(0, 2),
    metric: "cash",
    lifecycleReady: true,
  });
  assert.equal(result.valid, true);
  assert.equal(result.value, 330);
  assert.deepEqual(result.challengeStores, ["CYJA店"]);
  assert.deepEqual(result.baseFallbackStores, ["CYJB店"]);

  const invalid = targetCoverage.buildScopeChallengeTarget({
    targetMap: {
      "CYJA店": { cashTarget: 100, challengeCashTarget: 100 },
      "CYJB店": { cashTarget: 200 },
    },
    eligibleEntries: eligibleEntries.slice(0, 2),
    metric: "cash",
    lifecycleReady: true,
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.value, null);
  assert.deepEqual(invalid.invalidChallengeStores, ["CYJA店"]);
});

test("TargetView uses canonical target validity and no longer writes target Summary directly", () => {
  assert.match(targetView, /validBaseTarget/);
  assert.match(targetView, /validChallengeTarget/);
  assert.match(targetView, /deleteField\(\)/);
  assert.match(targetView, /isDirty/);
  assert.match(targetView, /monthly_targets_summary 自 Batch 3 起由 Backend event-driven writer 維護/);
  assert.doesNotMatch(targetView, /getCollectionPath\("monthly_targets_summary"\)/);
  assert.doesNotMatch(targetView, /parseNumber\(item\.cashTarget\)/);
  assert.match(targetView, /sourceId:\s*writeKey/);
  assert.match(targetView, /storeName:\s*canonicalStoreName/);
});

test("KPI Settings preserves missing newASP and validates benchmark ranges before write", () => {
  assert.match(settingsView, /validPositiveSetting\(localTargets\?\.newASP\)/);
  assert.match(settingsView, /validateStoreHealthBenchmark/);
  assert.match(settingsView, /newASP:\s*newAspResult\.valid \? newAspResult\.value : deleteField\(\)/);
  assert.match(settingsView, /benchmarks\.\$\{brandKey\}\.\$\{category\.id\}/);
  assert.doesNotMatch(settingsView, /newASP:\s*Number\(localTargets\?\.newASP \?\? 3500\)/);
  assert.doesNotMatch(settingsView, /value=\{localTargets\.newASP \?\? 3500\}/);
  assert.doesNotMatch(settingsView, /DEFAULT_BENCHMARKS_INIT/);
  assert.match(settingsView, /if \(!text\) \{[\s\S]{0,120}delete nextCategory\[field\]/);
  assert.doesNotMatch(settingsView, /if \(isNaN\(numValue\)\) numValue = 0/);
  assert.match(settingsView, /currentVal\.min !== null && currentVal\.min !== undefined/);
  assert.match(settingsView, /currentVal\.max !== null && currentVal\.max !== undefined/);
});

test("App propagates benchmark settings and no longer promotes missing newASP to 3500", () => {
  assert.match(app, /import \{ validPositiveSetting \} from "\.\/utils\/kpiContracts"/);
  assert.match(app, /benchmarks:\s*data\?\.benchmarks/);
  assert.match(app, /newASP:\s*newAspResult\.valid \? newAspResult\.value : null/);
  assert.match(app, /CURRENT_APP_VERSION = "3\.5\.3"/);
  assert.doesNotMatch(app, /newASP:\s*Number\(data\.newASP \?\? 3500\)/);
});

test("5E-1B.1 explicit zero is configured coverage and zero is not a target-audit issue", () => {
  const targetMap = {
    "CYJA店": { storeName: "CYJA店", cashTarget: 0, accrualTarget: 0 },
  };
  const audit = targetCoverage.buildTargetAudit(targetMap);
  assert.equal(audit.zeroBaseTargets.length, 2, "zeroBaseTargets remains informational");
  assert.equal(audit.issueCount, 0, "explicit configured zero must not count as an issue");

  const coverage = targetCoverage.buildIndependentCoverage({
    targetMap,
    eligibleEntries: [{ canonicalStoreName: "CYJA店", storeKey: "A" }],
    lifecycleReady: true,
  });
  assert.equal(coverage.cashConfiguredStoreCount, 1);
  assert.equal(coverage.accrualConfiguredStoreCount, 1);
  assert.equal(coverage.cashCoverageComplete, true);
  assert.equal(coverage.accrualCoverageComplete, true);
  assert.deepEqual(coverage.cashMissingStores, []);
  assert.deepEqual(coverage.accrualMissingStores, []);

  const compatibility = targetCoverage.buildTargetSummaryCompatibilityFields(targetMap, "cyj", "2026-08");
  assert.equal(compatibility.cashTargetTotal, 0);
  assert.equal(compatibility.accrualTargetTotal, 0);
});

test("5E-1B.1 canonical CYJ新店店 explicit zero beats newer legacy positive duplicate", () => {
  const summary = {
    targets: {
      legacy: {
        storeName: "CYJ新店",
        sourceDocId: "CYJ新店_2026_8",
        yearMonth: "2026-08",
        cashTarget: 900000,
        accrualTarget: 800000,
        updatedAtText: "2026-08-31T23:59:59.000Z",
      },
      canonical: {
        storeName: "CYJ新店店",
        sourceDocId: "CYJ新店店_2026_8",
        yearMonth: "2026-08",
        cashTarget: 0,
        accrualTarget: 0,
        updatedAtText: "2026-08-01T00:00:00.000Z",
      },
    },
  };
  const map = targetCoverage.extractSummaryTargetMap(summary, "cyj", "2026-08");
  assert.equal(map["CYJ新店店"].sourceDocId, "CYJ新店店_2026_8");
  assert.equal(map["CYJ新店店"].cashTarget, 0);
  assert.equal(map["CYJ新店店"].accrualTarget, 0);
  assert.equal(map["CYJ新店店"].isCanonicalSource, true);
  assert.equal(map["CYJ新店店"].canonicalTargetId, "CYJ新店店_2026_8");
});

test("5E-1B.1 event writer preserves canonical identity metadata", () => {
  assert.match(
    coverageSource,
    /resolved\.sourceDocId \|\| targetId,\s*identity\.canonicalTargetId\s*\)/
  );
});

test("5E-1B.1 TargetView remains event-driven and zero writer semantics come from validBaseTarget", () => {
  assert.match(targetView, /cashTarget:\s*cashResult\.valid \? cashResult\.value : deleteField\(\)/);
  assert.match(targetView, /accrualTarget:\s*accrualResult\.valid \? accrualResult\.value : deleteField\(\)/);
  assert.doesNotMatch(targetView, /getCollectionPath\("monthly_targets_summary"\)/);
  assert.match(app, /validPositiveSetting\(data\.newASP\)/);
  assert.match(settingsView, /validPositiveSetting\(localTargets\?\.newASP\)/);
  assert.match(settingsView, /validPositiveSetting\(targets\?\.newASP\)/);
});

test("Functions exports only scoped event-driven Target Coverage handlers", () => {
  for (const name of [
    "onLegacyMonthlyTargetChange",
    "onBrandMonthlyTargetChange",
    "onLegacyMonthlyTargetSummaryChange",
    "onBrandMonthlyTargetSummaryChange",
    "onLegacyStoreLifecycleCoverageChange",
    "onBrandStoreLifecycleCoverageChange",
  ]) {
    assert.match(functionsIndex, new RegExp(`exports\\.${name} = targetCoverageFunctions\\.${name}`));
  }
  assert.match(functionsIndex, /createTargetCoverageFunctions/);
  assert.match(coverageSource, /artifacts\/default-app-id\/public\/data\/monthly_targets\/\{targetId\}/);
  assert.match(coverageSource, /artifacts\/default-app-id\/public\/data\/monthly_targets_summary\/\{yearMonth\}/);
  assert.match(coverageSource, /artifacts\/default-app-id\/public\/data\/store_lifecycle\/\{docId\}/);
});

test("Target Coverage uses Lifecycle owner, has no polling, and does not full-scan monthly_targets on normal writes", () => {
  assert.match(coverageSource, /getLifecycleEligibleStoreEntries/);
  assert.match(coverageSource, /normalizeStoreLifecycleCore/);
  assert.match(coverageSource, /getCanonicalStoreName: getCanonicalLifecycleStoreName/);
  assert.match(coverageSource, /lifecycleIdentityApi/);
  assert.match(coverageSource, /cashCoverageComplete/);
  assert.match(coverageSource, /accrualCoverageComplete/);
  assert.match(coverageSource, /cashMissingStores/);
  assert.match(coverageSource, /accrualMissingStores/);
  assert.doesNotMatch(coverageSource, /setInterval\s*\(/);
  assert.doesNotMatch(coverageSource, /collection\(['"]monthly_targets['"]\)\.get\s*\(/);
  assert.match(coverageSource, /getCollection\(brandId,\s*'monthly_targets_summary'\)\.get\(\)/);
  assert.match(coverageSource, /beforeStatus !== 'READY' && afterStatus !== 'READY'/);
});

test("5E-1B.3 conflicting canonical-equivalent authoritative Summary rows fail closed", () => {
  const summary = {
    targets: {
      canonicalA: {
        storeName: "CYJ新店店",
        sourceDocId: "CYJ新店店_2026_8",
        yearMonth: "2026-08",
        cashTarget: 0,
        accrualTarget: 0,
      },
    },
    storeTargets: {
      canonicalB: {
        storeName: "CYJ新店店",
        sourceDocId: "CYJ新店店_2026_8",
        yearMonth: "2026-08",
        cashTarget: 900000,
        accrualTarget: 800000,
      },
    },
  };

  const map = targetCoverage.extractSummaryTargetMap(summary, "cyj", "2026-08");
  const row = map["CYJ新店店"];
  assert.equal(row.authorityConflict, true);
  assert.equal(row.status, "AUTHORITY_CONFLICT");
  assert.equal(row.cashTarget, null);
  assert.equal(row.accrualTarget, null);

  const audit = targetCoverage.buildTargetAudit(map);
  assert.equal(audit.authorityConflicts.length, 1);
  assert.equal(audit.issueCount, 1);

  const coverage = targetCoverage.buildIndependentCoverage({
    targetMap: map,
    eligibleEntries: [{ storeKey: "新店", canonicalStoreName: "CYJ新店店" }],
    lifecycleReady: true,
  });
  assert.equal(coverage.cashCoverageComplete, false);
  assert.equal(coverage.accrualCoverageComplete, false);
  assert.equal(coverage.cashConfiguredStoreCount, 0);
  assert.equal(coverage.accrualConfiguredStoreCount, 0);

  assert.match(
    coverageSource,
    /targetMap\[identity\.canonicalStoreName\] = choosePreferredTargetRow\(/
  );
});
