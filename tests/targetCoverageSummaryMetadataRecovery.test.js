import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const targetCoverage = require("../functions/targetCoverage.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const coverageSource = fs.readFileSync(path.join(root, "functions/targetCoverage.js"), "utf8");
const maintenanceSource = fs.readFileSync(path.join(root, "src/components/SystemMaintenance.jsx"), "utf8");

const validCoverage = (overrides = {}) => ({
  brandId: "cyj",
  yearMonth: "2026-12",
  targetCoverageVersion: "target-coverage-v1",
  kpiContractVersion: "kpi-contract-v1",
  lifecycleReady: true,
  eligibleStoreCount: 33,
  cashConfiguredStoreCount: 33,
  accrualConfiguredStoreCount: 33,
  cashCoverageComplete: true,
  accrualCoverageComplete: true,
  cashMissingStores: [],
  accrualMissingStores: [],
  targetAudit: { issueCount: 0 },
  coverageSource: "target_coverage_event_v1",
  coverageUpdatedAtText: "2026-09-02T00:00:00.000Z",
  ...overrides,
});

test("5E metadata self-heal: complete Coverage v1 contract is accepted and zero counts remain valid", () => {
  assert.equal(
    targetCoverage.hasCompleteTargetCoverageMetadata(validCoverage(), "cyj", "2026-12"),
    true,
  );

  assert.equal(
    targetCoverage.hasCompleteTargetCoverageMetadata(validCoverage({
      eligibleStoreCount: 0,
      cashConfiguredStoreCount: 0,
      accrualConfiguredStoreCount: 0,
      cashCoverageComplete: false,
      accrualCoverageComplete: false,
    }), "cyj", "2026-12"),
    true,
  );
});

test("5E metadata self-heal: missing/incompatible Coverage authority fails closed", () => {
  const cases = [
    validCoverage({ targetCoverageVersion: "" }),
    validCoverage({ kpiContractVersion: "legacy" }),
    validCoverage({ lifecycleReady: null }),
    validCoverage({ eligibleStoreCount: null }),
    validCoverage({ cashConfiguredStoreCount: "" }),
    validCoverage({ accrualConfiguredStoreCount: undefined }),
    validCoverage({ cashCoverageComplete: null }),
    validCoverage({ accrualCoverageComplete: null }),
    validCoverage({ cashMissingStores: null }),
    validCoverage({ accrualMissingStores: null }),
    validCoverage({ targetAudit: null }),
    validCoverage({ coverageSource: "" }),
    validCoverage({ coverageUpdatedAtText: "" }),
    validCoverage({ brandId: "yibo" }),
    validCoverage({ yearMonth: "2026-11" }),
  ];

  cases.forEach((row, index) => {
    assert.equal(
      targetCoverage.hasCompleteTargetCoverageMetadata(row, "cyj", "2026-12"),
      false,
      `case ${index} must fail closed`,
    );
  });
});

test("5E metadata self-heal: same target map no-ops only when Coverage authority remains complete", () => {
  assert.equal(targetCoverage.shouldRecomputeTargetSummaryCoverage({
    beforeExists: true,
    targetMapChanged: false,
    afterData: validCoverage(),
    brandId: "cyj",
    yearMonth: "2026-12",
  }), false);

  assert.equal(targetCoverage.shouldRecomputeTargetSummaryCoverage({
    beforeExists: true,
    targetMapChanged: false,
    afterData: validCoverage({ targetCoverageVersion: "" }),
    brandId: "cyj",
    yearMonth: "2026-12",
  }), true);

  assert.equal(targetCoverage.shouldRecomputeTargetSummaryCoverage({
    beforeExists: true,
    targetMapChanged: false,
    afterData: validCoverage({ coverageSource: "target_coverage_existing_summary_backfill_v2" }),
    brandId: "cyj",
    yearMonth: "2026-12",
  }), false);

  assert.equal(targetCoverage.shouldRecomputeTargetSummaryCoverage({
    beforeExists: true,
    targetMapChanged: true,
    afterData: validCoverage(),
    brandId: "cyj",
    yearMonth: "2026-12",
  }), true);
});

test("5E metadata self-heal: same-map metadata loss routes to race-safe CURRENT Summary transaction", () => {
  const handlerStart = coverageSource.indexOf("async function handleTargetSummaryWrite");
  const handlerEnd = coverageSource.indexOf("async function handleLifecycleWrite", handlerStart);
  const handler = coverageSource.slice(handlerStart, handlerEnd);

  const repairStart = coverageSource.indexOf("async function repairCurrentSummaryCoverageMetadata");
  const repairEnd = coverageSource.indexOf("async function handleTargetSummaryWrite", repairStart);
  const repair = coverageSource.slice(repairStart, repairEnd);

  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.ok(repairStart >= 0 && repairEnd > repairStart);

  assert.match(handler, /shouldRecomputeTargetSummaryCoverage/);
  assert.match(handler, /change\.before\.exists && !targetMapChanged/);
  assert.match(handler, /repairCurrentSummaryCoverageMetadata/);
  assert.doesNotMatch(
    handler,
    /if \(change\.before\.exists && targetMapsEqual\(beforeMap, afterMap\)\) return null;/,
  );

  assert.match(repair, /db\.runTransaction/);
  assert.equal((repair.match(/transaction\.get\(/g) || []).length, 2);
  assert.match(repair, /transaction\.get\(summaryRef\)/);
  assert.match(repair, /transaction\.get\(lifecycleRef\)/);
  assert.match(repair, /hasCompleteTargetCoverageMetadata\(summaryData, brandId, yearMonth\)/);
  assert.match(repair, /extractSummaryTargetMap\(summaryData, brandId, yearMonth, lifecycleIdentityApi\)/);
  assert.match(repair, /transaction\.set\(summaryRef,/);
  assert.match(repair, /\{ merge: true \}/);
  assert.doesNotMatch(repair, /targets\s*:/);
});

test("5E metadata self-heal: normal Raw target writer stays exactly two transaction point reads", () => {
  const start = coverageSource.indexOf("async function handleMonthlyTargetWrite");
  const end = coverageSource.indexOf("async function recomputeOneSummary", start);
  const rawWriter = coverageSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.equal((rawWriter.match(/transaction\.get\(/g) || []).length, 2);
  assert.match(rawWriter, /transaction\.get\(summaryRef\)/);
  assert.match(rawWriter, /transaction\.get\(lifecycleRef\)/);
});

test("5E metadata self-heal: listener topology and three-brand physical paths remain unchanged", () => {
  assert.equal((coverageSource.match(/\.onWrite\(/g) || []).length, 6);
  assert.doesNotMatch(coverageSource, /setInterval\(/);

  assert.equal(
    targetCoverage.getTargetCoveragePaths("cyj").monthlyTargetSummary,
    "artifacts/default-app-id/public/data/monthly_targets_summary",
  );
  assert.equal(
    targetCoverage.getTargetCoveragePaths("anniu").monthlyTargetSummary,
    "brands/anniu/monthly_targets_summary",
  );
  assert.equal(
    targetCoverage.getTargetCoveragePaths("yibo").monthlyTargetSummary,
    "brands/yibo/monthly_targets_summary",
  );
});

test("5E metadata self-heal: Maintenance yearly rebuild stays full replacement; Backend owns Coverage recovery", () => {
  const start = maintenanceSource.indexOf("const handleRebuildYearlyTargetSummary = async () =>");
  const end = maintenanceSource.indexOf("// 既有主要工具：校準與備份", start);
  const block = maintenanceSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(
    block,
    /batch\.set\(doc\(getCollectionPath\("monthly_targets_summary"\), bucket\.yearMonth\), \{/,
  );
  assert.match(block, /source: "SystemMaintenance_yearly_target_summary_rebuild"/);
  assert.doesNotMatch(block, /targetCoverageVersion/);
  assert.doesNotMatch(block, /coverageSource/);
  assert.doesNotMatch(block, /merge:\s*true/);

  assert.match(
    coverageSource,
    /Same target values do NOT prove that the Summary is still a valid Formal/,
  );
});
