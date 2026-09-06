import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const {
  ANNUAL_KPI_SUMMARY_SCHEMA_VERSION,
  inspectAnnualSummaryFlag,
  inspectAnnualKpiSummarySourceTrust,
  buildAnnualKpiSummaryPayload,
} = require("../functions/annualKpiSummary.js");

const makeFlag = (overrides = {}) => ({
  id: "2026-01",
  affectedYearMonth: "2026-01",
  brandId: "cyj",
  status: "verified",
  dirty: false,
  pendingCount: 0,
  lastMismatchCount: 0,
  ...overrides,
});

const makeSummary = (overrides = {}) => ({
  id: "2026-01",
  yearMonth: "2026-01",
  brandId: "cyj",
  semanticVersion: "summary-semantics-v1",
  lifecycleSnapshot: {
    datasetStatus: "READY",
    revision: 7,
  },
  reportingCompleteness: {
    schemaVersion: "reporting-completeness-v1",
    stores: {},
  },
  ...overrides,
});

const validRow = (overrides = {}) => ({
  displayName: "A店",
  formalLifecycleEligible: true,
  traffic: 0,
  trafficStatus: "VALID_ZERO",
  newCustomers: 2,
  newCustomersStatus: "VALID",
  formalNetCash: 100,
  formalNetCashStatus: "VALID",
  formalAccrual: 120,
  formalAccrualStatus: "VALID",
  ...overrides,
});

const completeReporting = (overrides = {}) => ({
  reportingStatus: "DATA_COMPLETE",
  fullMonthLifecycleEligible: true,
  ...overrides,
});

test("Annual backend Summary trust mirrors completed/verified + clean + zero mismatch/pending semantics", () => {
  assert.equal(inspectAnnualSummaryFlag(makeFlag()).isVerified, true);
  assert.equal(inspectAnnualSummaryFlag(makeFlag({ status: "completed" })).isVerified, true);
  assert.equal(inspectAnnualSummaryFlag(makeFlag({ status: "idle" })).isVerified, false);
  assert.equal(inspectAnnualSummaryFlag(makeFlag({ dirty: true })).isVerified, false);
  assert.equal(inspectAnnualSummaryFlag(makeFlag({ pendingCount: 1 })).isVerified, false);
  assert.equal(inspectAnnualSummaryFlag(makeFlag({ lastMismatchCount: 1 })).isVerified, false);

  const trusted = inspectAnnualKpiSummarySourceTrust({
    summary: makeSummary(),
    summaryFlag: makeFlag(),
    yearMonth: "2026-01",
    brandId: "cyj",
    expectedSummarySemanticVersion: "summary-semantics-v1",
    lifecycleRevision: 7,
    systemExclusionCurrent: true,
  });
  assert.deepEqual(trusted, { trusted: true, reason: "VERIFIED_FORMAL_SUMMARY" });

  assert.equal(inspectAnnualKpiSummarySourceTrust({
    summary: makeSummary(),
    summaryFlag: makeFlag({ pendingCount: 1 }),
    yearMonth: "2026-01",
    brandId: "cyj",
    expectedSummarySemanticVersion: "summary-semantics-v1",
    lifecycleRevision: 7,
    systemExclusionCurrent: true,
  }).reason, "SUMMARY_PENDING");

  assert.equal(inspectAnnualKpiSummarySourceTrust({
    summary: makeSummary(),
    summaryFlag: makeFlag(),
    yearMonth: "2026-01",
    brandId: "cyj",
    expectedSummarySemanticVersion: "summary-semantics-v1",
    lifecycleRevision: 8,
    systemExclusionCurrent: true,
  }).reason, "LIFECYCLE_SUMMARY_REVISION_MISMATCH");
});

test("Annual KPI v2 preserves complete true zero and gives every KPI its own based months", () => {
  const payload = buildAnnualKpiSummaryPayload({
    brandId: "cyj",
    brandLabel: "CYJ",
    year: 2026,
    candidateMonths: ["2026-01", "2026-02", "2026-03"],
    lifecycleRevision: 7,
    systemExclusionSnapshot: {
      version: "system-exclusion-v1",
      brandId: "cyj",
      revision: 2,
      stores: ["X"],
    },
    monthInputs: [
      {
        yearMonth: "2026-01",
        trust: { trusted: true, reason: "VERIFIED_FORMAL_SUMMARY" },
        requiredStoreKeys: ["A", "B"],
        storesByCore: {
          A: validRow({ displayName: "A店", traffic: 0, trafficStatus: "VALID_ZERO" }),
          B: validRow({ displayName: "B店", traffic: 10, newCustomers: 3, formalNetCash: 200, formalAccrual: 220 }),
        },
        reportingByCore: {
          A: completeReporting(),
          B: completeReporting(),
        },
      },
      {
        yearMonth: "2026-02",
        trust: { trusted: true, reason: "VERIFIED_FORMAL_SUMMARY" },
        requiredStoreKeys: ["A", "B"],
        storesByCore: {
          A: validRow({ traffic: 1, formalNetCash: null, formalNetCashStatus: "FIELD_MISSING" }),
          B: validRow({ traffic: 2, formalNetCash: 50 }),
        },
        reportingByCore: {
          A: completeReporting(),
          B: completeReporting(),
        },
      },
      {
        yearMonth: "2026-03",
        trust: { trusted: true, reason: "VERIFIED_FORMAL_SUMMARY" },
        requiredStoreKeys: ["A", "B"],
        storesByCore: {
          A: validRow({ traffic: 4, newCustomers: 1, formalNetCash: 40 }),
          B: validRow({ traffic: 5, newCustomers: 1, formalNetCash: 50 }),
        },
        reportingByCore: {
          A: completeReporting(),
          B: completeReporting({ reportingStatus: "DATA_INCOMPLETE" }),
        },
      },
    ],
    updatedAtText: "2026-09-06T00:00:00.000Z",
  });

  assert.equal(payload.schemaVersion, ANNUAL_KPI_SUMMARY_SCHEMA_VERSION);

  // January traffic includes A's real zero and B's 10.
  assert.equal(payload.metrics.traffic.monthlyValues["2026-01"], 10);
  assert.deepEqual(payload.metrics.traffic.basedMonths, ["2026-01", "2026-02"]);
  assert.equal(payload.metrics.traffic.basedMonthCount, 2);

  // February cash is incomplete because A's cash field is missing, but traffic remains valid.
  assert.deepEqual(payload.metrics.cash.basedMonths, ["2026-01"]);
  assert.equal(payload.metrics.cash.monthlyValues["2026-02"], undefined);

  // March is excluded at brand scope because one required store is reporting-incomplete.
  assert.equal(payload.metrics.traffic.monthlyValues["2026-03"], undefined);
  assert.equal(payload.metrics.newCustomers.monthlyValues["2026-03"], undefined);

  // A's complete true-zero store sample is retained as a real benchmark month.
  assert.equal(payload.stores.A.metrics.traffic.monthlyValues["2026-01"], 0);
  assert.equal(payload.stores.A.metrics.traffic.basedMonthCount, 3);
  assert.equal(payload.stores.B.metrics.traffic.basedMonthCount, 2);

  // The top-level scope metadata is what filtered manager/store consumers use.
  assert.deepEqual(payload.benchmarkScopeByMonth["2026-01"].requiredStoreKeys, ["A", "B"]);
  assert.equal(payload.lifecycleRevision, 7);
  assert.equal(payload.systemExclusionSnapshot.revision, 2);
});

test("Annual KPI v2 excludes untrusted months without converting them into zero samples", () => {
  const payload = buildAnnualKpiSummaryPayload({
    brandId: "anniu",
    year: 2026,
    candidateMonths: ["2026-01"],
    monthInputs: [{
      yearMonth: "2026-01",
      trust: { trusted: false, reason: "SUMMARY_DIRTY" },
      requiredStoreKeys: ["A"],
      storesByCore: { A: validRow() },
      reportingByCore: { A: completeReporting() },
    }],
  });

  assert.equal(payload.metrics.traffic.basedMonthCount, 0);
  assert.equal(payload.metrics.traffic.monthlyAverage, null);
  assert.equal(payload.metrics.traffic.status, "N_A");
  assert.deepEqual(payload.metrics.traffic.basedMonths, []);
  assert.equal(payload.sourceTrustByMonth["2026-01"].reason, "SUMMARY_DIRTY");
});


test("Annual KPI rebuild is Summary-first, Lifecycle/System-Exclusion anchored and no longer uses annualAverageSettings activity heuristics", () => {
  const indexSource = fs.readFileSync(path.join(root, "functions/index.js"), "utf8");
  const settingsSource = fs.readFileSync(path.join(root, "src/components/SettingsView.jsx"), "utf8");

  const rebuildStart = indexSource.indexOf("async function rebuildAnnualKpiSummaryForBrand");
  const rebuildEnd = indexSource.indexOf("function normalizeSummaryCoreName", rebuildStart);
  const rebuildBlock = indexSource.slice(rebuildStart, rebuildEnd);

  assert.match(rebuildBlock, /dashboard_summary/);
  assert.match(rebuildBlock, /summary_recalc_flags/);
  assert.match(rebuildBlock, /store_lifecycle/);
  assert.match(rebuildBlock, /getAuditExclusionsDocRef/);
  assert.match(rebuildBlock, /isLifecycleEntryFullEligibleMonth/);
  assert.doesNotMatch(rebuildBlock, /daily_reports/);
  assert.doesNotMatch(rebuildBlock, /monthly_targets/);
  assert.doesNotMatch(rebuildBlock, /annualAverageSettings/);
  assert.doesNotMatch(rebuildBlock, /firstActivityDay/);

  assert.match(settingsSource, /annualAverageSettings 已退休為 legacy data/);
  assert.match(settingsSource, /年度平均樣本由門市生命週期自動判定/);
  assert.doesNotMatch(settingsSource, /ANNUAL_KPI_REBUILD_ENDPOINT/);
});
