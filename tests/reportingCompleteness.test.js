import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPORTING_COMPLETENESS_SCHEMA_VERSION,
  buildLifecycleReportingCompleteness,
  getLifecycleExpectedReportDates,
  isLifecycleEntryExpectedForDate,
  isLifecycleEntryFullEligibleMonth,
} from "../src/utils/storeLifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const backendLifecycle = read("functions/storeLifecycle.js");
const functionsIndex = read("functions/index.js");

const lifecycleEntry = (overrides = {}) => ({
  firstEligibleMonth: "2026-08",
  openDate: "2022-06-15",
  lastEligibleMonth: "",
  closeDate: "",
  exemptMonths: [],
  ...overrides,
});

test("daily expected-report authority combines monthly cohort with open/close boundaries", () => {
  const existing = lifecycleEntry();
  assert.equal(isLifecycleEntryExpectedForDate(existing, "2026-07-31"), false);
  assert.equal(isLifecycleEntryExpectedForDate(existing, "2026-08-01"), true);

  const opening = lifecycleEntry({ openDate: "2026-08-12" });
  assert.equal(isLifecycleEntryExpectedForDate(opening, "2026-08-11"), false);
  assert.equal(isLifecycleEntryExpectedForDate(opening, "2026-08-12"), true);

  const closing = lifecycleEntry({
    lastEligibleMonth: "2026-08",
    closeDate: "2026-08-20",
  });
  assert.equal(isLifecycleEntryExpectedForDate(closing, "2026-08-20"), true);
  assert.equal(isLifecycleEntryExpectedForDate(closing, "2026-08-21"), false);

  const exempt = lifecycleEntry({
    firstEligibleMonth: "2026-07",
    openDate: "2026-01-01",
    exemptMonths: ["2026-08"],
  });
  assert.equal(isLifecycleEntryExpectedForDate(exempt, "2026-08-15"), false);
});

test("expected report dates respect cutoff and do not treat future days as missing", () => {
  const entry = lifecycleEntry({ openDate: "2026-08-12" });
  assert.deepEqual(
    getLifecycleExpectedReportDates(entry, "2026-08", { cutoffDate: "2026-08-15" }),
    ["2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"]
  );
  assert.deepEqual(
    getLifecycleExpectedReportDates(entry, "2026-08", { cutoffDate: "2026-07-31" }),
    []
  );
});

test("full-month eligibility distinguishes existing stores from opening/closing partial months", () => {
  assert.equal(isLifecycleEntryFullEligibleMonth(lifecycleEntry({ openDate: "2022-06-15" }), "2026-08"), true);
  assert.equal(isLifecycleEntryFullEligibleMonth(lifecycleEntry({ openDate: "2026-08-12" }), "2026-08"), false);
  assert.equal(isLifecycleEntryFullEligibleMonth(lifecycleEntry({
    lastEligibleMonth: "2026-08",
    closeDate: "2026-08-20",
  }), "2026-08"), false);
});

test("reporting completeness counts report-document presence, preserves true zero, and deduplicates same store-date", () => {
  const master = {
    schemaVersion: "store-lifecycle-v1",
    brandId: "cyj",
    datasetStatus: "READY",
    stores: {
      "A": lifecycleEntry({ openDate: "2022-01-01" }),
      "B": lifecycleEntry({ openDate: "2026-08-03" }),
    },
  };
  const reports = [
    { storeName: "CYJA店", date: "2026-08-01", cash: 0 },
    { storeName: "A", date: "2026-08-02", cash: 10 },
    { storeName: "A店", date: "2026-08-02", cash: 20 },
    { storeName: "B", date: "2026-08-01", cash: 999 }, // before openDate: does not satisfy expected reporting
    { storeName: "CYJB店", date: "2026-08-03", cash: 0 },
  ];

  const result = buildLifecycleReportingCompleteness({
    master,
    yearMonth: "2026-08",
    reports,
    brandId: "cyj",
    cutoffDate: "2026-08-03",
  });

  assert.equal(result.schemaVersion, REPORTING_COMPLETENESS_SCHEMA_VERSION);
  assert.equal(result.eligibleStoreCount, 2);
  assert.equal(result.expectedStoreDayCount, 4);
  assert.equal(result.submittedStoreDayCount, 3);
  assert.equal(result.missingStoreDayCount, 1);
  assert.equal(result.reportingStatus, "DATA_INCOMPLETE");
  assert.deepEqual(result.stores.A.missingReportDates, ["2026-08-03"]);
  assert.equal(result.stores.A.submittedReportDayCount, 2);
  assert.equal(result.stores.B.submittedReportDayCount, 1);
  assert.equal(result.stores.A.fullMonthLifecycleEligible, true);
  assert.equal(result.stores.B.fullMonthLifecycleEligible, false);
});

test("READY lifecycle with explicit zero reports is DATA_COMPLETE; missing lifecycle authority fails closed", () => {
  const master = {
    brandId: "anniu",
    datasetStatus: "READY",
    stores: {
      "中山": {
        firstEligibleMonth: "2026-08",
        openDate: "2026-08-01",
      },
    },
  };
  const complete = buildLifecycleReportingCompleteness({
    master,
    yearMonth: "2026-08",
    brandId: "anniu",
    cutoffDate: "2026-08-02",
    reports: [
      { storeName: "安妞中山店", date: "2026-08-01", cash: 0 },
      { storeName: "中山", date: "2026-08-02", cash: 0 },
    ],
  });
  assert.equal(complete.reportingStatus, "DATA_COMPLETE");
  assert.equal(complete.submittedStoreDayCount, 2);
  assert.equal(complete.missingStoreDayCount, 0);

  const notReady = buildLifecycleReportingCompleteness({
    master: { ...master, datasetStatus: "BUILDING" },
    yearMonth: "2026-08",
    brandId: "anniu",
    cutoffDate: "2026-08-02",
    reports: [],
  });
  assert.equal(notReady.reportingStatus, "LIFECYCLE_NOT_READY");
  assert.equal(notReady.lifecycleReady, false);
});

test("Summary Writer persists compact reporting metadata from already-loaded Lifecycle and daily rows", () => {
  assert.match(backendLifecycle, /REPORTING_COMPLETENESS_SCHEMA_VERSION = 'reporting-completeness-v1'/);
  assert.match(backendLifecycle, /function isLifecycleEntryExpectedForDate/);
  assert.match(backendLifecycle, /function getLifecycleExpectedReportDates/);
  assert.match(backendLifecycle, /function buildLifecycleReportingCompleteness/);
  assert.match(backendLifecycle, /buildLifecycleReportingCompleteness,/);

  assert.match(functionsIndex, /REPORTING_COMPLETENESS_SCHEMA_VERSION/);
  assert.match(functionsIndex, /buildLifecycleReportingCompleteness\(\{[\s\S]*?master: lifecycleMasterForSystemScope,[\s\S]*?reports: dailyRows,[\s\S]*?includeMissingDates: false/);
  assert.match(functionsIndex, /reportingCompleteness: \{[\s\S]*?\.\.\.reportingCompleteness,[\s\S]*?schemaVersion: REPORTING_COMPLETENESS_SCHEMA_VERSION/);
  assert.match(functionsIndex, /Store Reporting Signature/);
});

test("compact persisted completeness metadata does not carry per-day missing arrays", () => {
  const stores = {};
  for (let i = 1; i <= 54; i += 1) {
    stores[`店${i}`] = {
      firstEligibleMonth: "2026-08",
      openDate: "2020-01-01",
    };
  }
  const result = buildLifecycleReportingCompleteness({
    master: { brandId: "cyj", datasetStatus: "READY", stores },
    yearMonth: "2026-08",
    cutoffDate: "2026-08-31",
    reports: [],
    includeMissingDates: false,
  });
  assert.equal(result.missingStoreDayCount, 54 * 31);
  assert.equal(Object.values(result.stores).some((row) => Object.hasOwn(row, "missingReportDates")), false);
  assert.ok(JSON.stringify(result).length < 30000);
});
