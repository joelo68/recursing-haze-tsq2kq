import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ANNUAL_KPI_SUMMARY_SCHEMA_VERSION,
  buildAnnualKpiBenchmarkScope,
  getAnnualBenchmarkLabel,
  isAnnualBenchmarkMetricDisplayable,
  normalizeAnnualKpiBenchmarkPayload,
} from "../src/utils/annualKpiBenchmark.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dashboardHookSource = fs.readFileSync(path.join(root, "src/hooks/useDashboardStats.js"), "utf8");

const metric = (monthlyValues = {}) => {
  const basedMonths = Object.keys(monthlyValues).sort();
  const total = basedMonths.reduce((sum, ym) => sum + Number(monthlyValues[ym]), 0);
  const monthlyAverage = basedMonths.length ? Math.round(total / basedMonths.length) : null;
  return {
    monthlyValues,
    total: basedMonths.length ? total : null,
    monthlyAverage,
    basedMonths,
    basedMonthCount: basedMonths.length,
    status: basedMonths.length ? (total === 0 ? "VALID_ZERO" : "VALID") : "N_A",
  };
};

test("V2 filtered benchmark requires every selected required store for each KPI/month", () => {
  const payload = normalizeAnnualKpiBenchmarkPayload({
    schemaVersion: ANNUAL_KPI_SUMMARY_SCHEMA_VERSION,
    brandId: "cyj",
    metrics: {
      traffic: metric({ "2026-01": 30, "2026-02": 10 }),
      newCustomers: metric({ "2026-01": 6, "2026-02": 2 }),
      cash: metric({ "2026-01": 300, "2026-02": 100 }),
      accrual: metric({ "2026-01": 330, "2026-02": 110 }),
    },
    benchmarkScopeByMonth: {
      "2026-01": { requiredStoreKeys: ["A", "B"] },
      "2026-02": { requiredStoreKeys: ["A"] }, // B is not a full-month benchmark store in Feb.
    },
    stores: {
      A: {
        storeCore: "A",
        metrics: {
          traffic: metric({ "2026-01": 10, "2026-02": 10 }),
          newCustomers: metric({ "2026-01": 2, "2026-02": 2 }),
          cash: metric({ "2026-01": 100, "2026-02": 100 }),
          accrual: metric({ "2026-01": 110, "2026-02": 110 }),
        },
      },
      B: {
        storeCore: "B",
        metrics: {
          traffic: metric({ "2026-01": 20 }),
          // newCustomers intentionally missing January => only that KPI/month must fail.
          newCustomers: metric({}),
          cash: metric({ "2026-01": 200 }),
          accrual: metric({ "2026-01": 220 }),
        },
      },
    },
  });

  const filtered = buildAnnualKpiBenchmarkScope({
    payload,
    selectedStoreCores: ["A", "B"],
    normalizeStoreKey: (value) => String(value || "").replace(/店$/, ""),
  });

  assert.deepEqual(filtered.metrics.traffic.basedMonths, ["2026-01", "2026-02"]);
  assert.equal(filtered.metrics.traffic.monthlyValues["2026-01"], 30);
  assert.equal(filtered.metrics.traffic.monthlyValues["2026-02"], 10);

  // January new-customer scope is incomplete because B is required but has no valid sample.
  // February remains valid because only A belongs to the full-month benchmark cohort.
  assert.deepEqual(filtered.metrics.newCustomers.basedMonths, ["2026-02"]);
  assert.equal(filtered.metrics.newCustomers.monthlyValues["2026-01"], undefined);
  assert.equal(filtered.metrics.newCustomers.monthlyValues["2026-02"], 2);

  assert.deepEqual(filtered.metrics.cash.basedMonths, ["2026-01", "2026-02"]);
});

test("true-zero Annual benchmark is displayable and 1-2 sample naming is explicit", () => {
  const zero = metric({ "2026-01": 0 });
  assert.equal(zero.status, "VALID_ZERO");
  assert.equal(isAnnualBenchmarkMetricDisplayable(zero), true);
  assert.equal(getAnnualBenchmarkLabel(zero), "近 1 個完整月平均");

  const two = metric({ "2026-01": 0, "2026-02": 4 });
  assert.equal(getAnnualBenchmarkLabel(two), "近 2 個完整月平均");

  const three = metric({ "2026-01": 0, "2026-02": 4, "2026-03": 5 });
  assert.equal(getAnnualBenchmarkLabel(three), "年均");
});

test("rounded monthly average zero is not mislabeled as a true VALID_ZERO sample", () => {
  const small = metric({ "2026-01": 1, "2026-02": 0, "2026-03": 0 });
  assert.equal(small.monthlyAverage, 0);
  assert.equal(small.total, 1);
  assert.equal(small.status, "VALID");
  assert.equal(isAnnualBenchmarkMetricDisplayable(small), true);
});

test("legacy Annual KPI document remains readable during staged rollout", () => {
  const legacy = normalizeAnnualKpiBenchmarkPayload({
    trafficMonthlyAverage: 15,
    newCustomerMonthlyAverage: 4,
    basedMonths: ["2026-01", "2026-02"],
    basedMonthCount: 2,
    stores: {},
  });

  assert.equal(legacy.schemaVersion, "");
  assert.equal(legacy.metrics.traffic.monthlyAverage, 15);
  assert.equal(legacy.metrics.newCustomers.monthlyAverage, 4);
  assert.deepEqual(legacy.metrics.traffic.basedMonths, ["2026-01", "2026-02"]);
});

test("Dashboard Annual KPI benchmark cache is anchored to candidate-month Reporting Calendar revisions", () => {
  assert.match(dashboardHookSource, /currentCalendarMonthRevisions/);
  assert.match(dashboardHookSource, /base\.reportingCalendarMonthRevisions/);
  assert.match(dashboardHookSource, /benchmarkCandidateMonths\.every/);
  assert.match(dashboardHookSource, /REPORTING_CALENDAR_REVISION_MISMATCH/);
});
