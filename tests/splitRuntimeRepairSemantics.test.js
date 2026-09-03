import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const normalizeCore = (value = "") => String(value || "")
  .trim()
  .replace(/^(DRCYJ|DR\.CYJ|CYJ|安妞|伊啵|Anew|Yibo)/i, "")
  .replace(/店+$/g, "")
  .trim();

const targetCoverageStub = {
  TARGET_COVERAGE_VERSION: "target-coverage-v1",
  normalizeTargetCoverageBrandId: (value = "") => {
    const id = String(value || "").trim().toLowerCase();
    return ["cyj", "anniu", "yibo"].includes(id) ? id : "";
  },
  extractSummaryTargetMap: (summary = {}) => summary.targets || {},
  targetMapsEqual: (a = {}, b = {}) => JSON.stringify(a) === JSON.stringify(b),
  getTargetCoveragePaths: (brandId = "cyj") => ({
    lifecycleMaster: brandId === "cyj"
      ? "artifacts/default-app-id/public/data/store_lifecycle/master"
      : `brands/${brandId}/store_lifecycle/master`,
    systemExclusion: brandId === "cyj"
      ? "artifacts/default-app-id/public/data/global_settings/audit_exclusions"
      : `brands/${brandId}/settings/audit_exclusions`,
    monthlyTargetSummary: brandId === "cyj"
      ? "artifacts/default-app-id/public/data/monthly_targets_summary"
      : `brands/${brandId}/monthly_targets_summary`,
  }),
  buildTargetSummaryCompatibilityFields: (targetMap = {}) => {
    const rows = Object.values(targetMap || {});
    return {
      storeCount: rows.length,
      targetCount: rows.length,
      sourceDocCount: rows.length,
      cashTargetTotal: rows.reduce((sum, row) => sum + Number(row?.cashTarget || 0), 0),
      accrualTargetTotal: rows.reduce((sum, row) => sum + Number(row?.accrualTarget || 0), 0),
    };
  },
  buildIndependentCoverage: ({ targetMap = {}, eligibleEntries = [], lifecycleReady = false }) => {
    const targetByCore = new Map(Object.entries(targetMap || {}).map(([key, row]) => [
      normalizeCore(row?.storeName || row?.store || key),
      row || {},
    ]));
    const eligible = eligibleEntries.map((entry) => normalizeCore(entry?.storeKey || entry?.coreStoreName || entry?.canonicalStoreName)).filter(Boolean);
    const cashMissingStores = [];
    const accrualMissingStores = [];
    let cashConfiguredStoreCount = 0;
    let accrualConfiguredStoreCount = 0;
    eligible.forEach((core) => {
      const row = targetByCore.get(core) || {};
      const cashConfigured = row.cashTarget !== undefined && row.cashTarget !== null && row.cashTarget !== "";
      const accrualConfigured = row.accrualTarget !== undefined && row.accrualTarget !== null && row.accrualTarget !== "";
      if (cashConfigured) cashConfiguredStoreCount += 1; else cashMissingStores.push(core);
      if (accrualConfigured) accrualConfiguredStoreCount += 1; else accrualMissingStores.push(core);
    });
    return {
      targetCoverageVersion: "target-coverage-v1",
      kpiContractVersion: "kpi-contract-v1",
      lifecycleReady,
      eligibleStoreCount: eligible.length,
      cashConfiguredStoreCount,
      accrualConfiguredStoreCount,
      cashCoverageComplete: lifecycleReady && cashMissingStores.length === 0,
      accrualCoverageComplete: lifecycleReady && accrualMissingStores.length === 0,
      cashMissingStores,
      accrualMissingStores,
      targetAudit: {},
    };
  },
};

const storeLifecycleStub = {
  normalizeStoreLifecycleCore: normalizeCore,
  getCanonicalStoreName: (value) => normalizeCore(value),
  getLifecycleEligibleStoreEntries: (master = {}) => Object.entries(master.stores || {}).map(([storeKey, row]) => ({ storeKey, ...row })),
};

const normalizeProfile = (data = {}, brandId = "") => {
  const stores = [...new Set((Array.isArray(data?.stores) ? data.stores : []).map(normalizeCore).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  return {
    brandId: String(brandId || data?.brandId || "").toLowerCase(),
    revision: Number.isInteger(Number(data?.revision)) && Number(data.revision) >= 0 ? Number(data.revision) : 0,
    stores,
    storeSet: new Set(stores),
  };
};

const buildSnapshot = (profile = {}, brandId = "") => ({
  version: "system-exclusion-v1",
  brandId: String(brandId || profile.brandId || "").toLowerCase(),
  revision: Number(profile.revision || 0),
  stores: [...(profile.stores || [])],
});

const systemExclusionContractStub = {
  normalizeStoredSystemExclusionProfile: (data, brandId) => normalizeProfile(data, brandId),
  buildStoredSystemExclusionSnapshot: (profile, brandId) => buildSnapshot(profile, brandId),
  isStoredSystemExclusionSnapshotCurrent: ({ snapshot, currentProfile, brandId }) => {
    const current = normalizeProfile(currentProfile, brandId);
    if (!snapshot || typeof snapshot !== "object") return current.revision === 0 && current.stores.length === 0;
    const actual = buildSnapshot(normalizeProfile(snapshot, brandId), brandId);
    return snapshot.version === "system-exclusion-v1"
      && actual.brandId === current.brandId
      && actual.revision === current.revision
      && JSON.stringify(actual.stores) === JSON.stringify(current.stores);
  },
};

function loadCommonJs(relativePath, stubs) {
  const filename = path.join(root, relativePath);
  const code = fs.readFileSync(filename, "utf8");
  const module = { exports: {} };
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    throw new Error(`UNSTUBBED_REQUIRE:${request}`);
  };
  vm.runInNewContext(code, {
    require: localRequire,
    module,
    exports: module.exports,
    console,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    JSON,
    Math,
    RegExp,
    Error,
  }, { filename });
  return module.exports;
}

const audit = loadCommonJs("functions/targetCoverageAudit.js", {
  "./targetCoverage": targetCoverageStub,
  "./kpiContracts": { KPI_CONTRACT_VERSION: "kpi-contract-v1" },
  "./storeLifecycle": storeLifecycleStub,
  "./systemExclusionContract": systemExclusionContractStub,
});

const migration = loadCommonJs("functions/targetCoverageMigration.js", {
  "./targetCoverage": targetCoverageStub,
  "./kpiContracts": { KPI_CONTRACT_VERSION: "kpi-contract-v1" },
  "./storeLifecycle": storeLifecycleStub,
  "./systemExclusionContract": systemExclusionContractStub,
  "./targetCoverageAudit": audit,
});

const lifecycle = {
  brandId: "cyj",
  datasetStatus: "READY",
  revision: 10,
  stores: {
    A: { firstEligibleMonth: "2026-01" },
    B: { firstEligibleMonth: "2026-01" },
  },
};

const summaryV1WithoutExclusionSnapshot = {
  brandId: "cyj",
  yearMonth: "2026-09",
  targetCoverageVersion: "target-coverage-v1",
  kpiContractVersion: "kpi-contract-v1",
  storeCount: 2,
  targetCount: 2,
  sourceDocCount: 2,
  cashTargetTotal: 300,
  accrualTargetTotal: 500,
  targets: {
    CYJA店: { storeName: "CYJA店", cashTarget: 100, accrualTarget: 200 },
    CYJB店: { storeName: "CYJB店", cashTarget: 200, accrualTarget: 300 },
  },
};

test("CYJ stale v1 Coverage is repairable metadata when System Exclusion removes B from the formal denominator", () => {
  const exclusionData = {
    systemExclusionVersion: "system-exclusion-v1",
    brandId: "cyj",
    revision: 1,
    stores: ["B"],
  };
  const row = audit.buildHistoricalTargetCoverageAuditRow({
    brandId: "cyj",
    yearMonth: "2026-09",
    summaryData: summaryV1WithoutExclusionSnapshot,
    lifecycleMaster: lifecycle,
    systemExclusionData: exclusionData,
  });

  assert.equal(row.classification, audit.TARGET_COVERAGE_AUDIT_CLASSIFICATION.SUMMARY_BACKFILL_SAFE);
  assert.equal(row.migrationWriteAllowed, true);
  assert.equal(row.lifecycleEligibleStoreCount, 2);
  assert.equal(row.eligibleStoreCount, 1);
  assert.equal(row.systemExclusionCurrent, false);
  assert.ok(row.reasonCodes.includes("SYSTEM_EXCLUSION_SNAPSHOT_STALE"));
  assert.equal(row.previewCoverage.eligibleStoreCount, 1);
  assert.equal(row.previewCoverage.cashConfiguredStoreCount, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(row.previewCoverage.systemExclusionSnapshot)), {
    version: "system-exclusion-v1",
    brandId: "cyj",
    revision: 1,
    stores: ["B"],
  });
});

test("Empty revision-zero brands preserve safe legacy compatibility and do not require migration", () => {
  for (const brandId of ["anniu", "yibo"]) {
    const row = audit.buildHistoricalTargetCoverageAuditRow({
      brandId,
      yearMonth: "2026-09",
      summaryData: { ...summaryV1WithoutExclusionSnapshot, brandId },
      lifecycleMaster: { ...lifecycle, brandId },
      systemExclusionData: { brandId, revision: 0, stores: [] },
    });
    assert.equal(row.classification, audit.TARGET_COVERAGE_AUDIT_CLASSIFICATION.ALREADY_V1);
    assert.equal(row.migrationWriteAllowed, false);
    assert.equal(row.systemExclusionCurrent, true);
  }
});

test("Migration plan writes the stale CYJ month and patch adds only Coverage metadata including System Exclusion snapshot", () => {
  const exclusionData = { brandId: "cyj", revision: 1, stores: ["B"] };
  const plan = migration.buildAtomicMigrationPlan({
    brandId: "cyj",
    yearMonths: ["2026-09"],
    summariesByMonth: { "2026-09": { exists: true, data: summaryV1WithoutExclusionSnapshot } },
    lifecycleMaster: lifecycle,
    systemExclusionData: exclusionData,
  });

  assert.equal(plan.canApply, true);
  assert.deepEqual(Array.from(plan.writeMonths), ["2026-09"]);
  const patch = migration.buildMetadataOnlyCoveragePatch({
    auditRow: plan.writeRows[0],
    coverageUpdatedAt: null,
    coverageUpdatedAtText: "2026-09-03T00:00:00.000Z",
  });
  assert.equal(patch.eligibleStoreCount, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(patch.systemExclusionSnapshot)), {
    version: "system-exclusion-v1",
    brandId: "cyj",
    revision: 1,
    stores: ["B"],
  });
  for (const forbidden of migration.TARGET_COVERAGE_MIGRATION_FORBIDDEN_LEGACY_FIELDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(patch, forbidden), false, forbidden);
  }
});
