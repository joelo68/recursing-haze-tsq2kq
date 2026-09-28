import test from "node:test";
import assert from "node:assert/strict";
import {
  flattenCurrentStoreMonthReports,
  inspectCurrentStoreMonthReportsReadiness,
} from "../src/utils/currentStoreMonthReportsConsumer.js";

const readyStatus = (overrides = {}) => ({
  schemaVersion: "current-store-month-reports-v1",
  status: "BOOTSTRAP_CERTIFIED",
  consumerReady: true,
  readinessStatus: "CONSUMER_READY",
  readinessVersion: "current-store-month-reports-readiness-v1",
  consumerReadySourceSignature: "sig-current",
  consumerReadyProjectionSignature: "sig-current",
  revision: 2,
  ...overrides,
});

const projectionDoc = (overrides = {}) => ({
  schemaVersion: "current-store-month-reports-v1",
  projectionSource: "daily_reports_onwrite_v1",
  brandId: "cyj",
  yearMonth: "2026-09",
  storeKey: "中美",
  canonicalStoreName: "CYJ中美店",
  sourceEvents: {
    event1: {
      sourceReportId: "report-1",
      eventTimestamp: "2026-09-28T10:00:00.000Z",
      exists: true,
      row: {
        sourceReportId: "report-1",
        date: "2026-09-28",
        storeName: "CYJ中美店",
        cash: 1000,
        operationalAccrual: 1200,
      },
    },
    event2: {
      sourceReportId: "report-deleted",
      eventTimestamp: "2026-09-28T11:00:00.000Z",
      exists: false,
    },
  },
  sourceEventCount: 2,
  sourceReportCount: 1,
  submittedDates: ["2026-09-28"],
  submittedDateCount: 1,
  ...overrides,
});

test("B4 readiness accepts only promoted, versioned, signature-matched status", () => {
  const result = inspectCurrentStoreMonthReportsReadiness({
    status: readyStatus(),
    brandId: "cyj",
    yearMonth: "2026-09",
  });
  assert.equal(result.ready, true);
  assert.equal(result.reason, "CONSUMER_READY");
  assert.equal(result.revision, 2);

  assert.equal(inspectCurrentStoreMonthReportsReadiness({
    status: readyStatus({ consumerReady: false }),
    brandId: "cyj",
    yearMonth: "2026-09",
  }).ready, false);

  assert.equal(inspectCurrentStoreMonthReportsReadiness({
    status: readyStatus({ consumerReadyProjectionSignature: "different" }),
    brandId: "cyj",
    yearMonth: "2026-09",
  }).reason, "READINESS_SIGNATURE_MISMATCH");
});

test("B4 flattens only active projected source reports and preserves raw report identity", () => {
  const result = flattenCurrentStoreMonthReports({
    documents: [{ id: "2026-09-store", data: projectionDoc() }],
    brandId: "cyj",
    yearMonth: "2026-09",
  });
  assert.equal(result.compatible, true);
  assert.equal(result.projectionDocCount, 1);
  assert.equal(result.reportCount, 1);
  assert.deepEqual(result.reports.map((row) => row.id), ["report-1"]);
  assert.equal(result.reports[0].storeName, "CYJ中美店");
  assert.equal(result.reports[0].cash, 1000);
});

test("B4 projection fails closed on cross-brand, schema or count corruption", () => {
  assert.equal(flattenCurrentStoreMonthReports({
    documents: [{ data: projectionDoc({ brandId: "anniu" }) }],
    brandId: "cyj",
    yearMonth: "2026-09",
  }).reason, "PROJECTION_BRAND_MISMATCH");

  assert.equal(flattenCurrentStoreMonthReports({
    documents: [{ data: projectionDoc({ schemaVersion: "future-schema" }) }],
    brandId: "cyj",
    yearMonth: "2026-09",
  }).reason, "PROJECTION_SCHEMA_MISMATCH");

  assert.equal(flattenCurrentStoreMonthReports({
    documents: [{ data: projectionDoc({ sourceReportCount: 2 }) }],
    brandId: "cyj",
    yearMonth: "2026-09",
  }).reason, "PROJECTION_REPORT_COUNT_MISMATCH");
});

test("B4 empty projection is not treated as a valid current-month consumer source", () => {
  const result = flattenCurrentStoreMonthReports({
    documents: [],
    brandId: "cyj",
    yearMonth: "2026-09",
  });
  assert.equal(result.compatible, false);
  assert.equal(result.reason, "PROJECTION_EMPTY");
});
