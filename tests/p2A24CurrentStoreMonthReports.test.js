import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projection = require("../functions/currentStoreMonthReports.js");

const {
  CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION,
  buildProjectedReportRow,
  buildProjectionBucket,
  applySourceEventToProjectionData,
} = projection;

const normalizeStoreCore = (value = "") => String(value || "")
  .replace(/^(CYJ|安妞|伊啵)/, "")
  .replace(/店+$/, "");
const getCanonicalStoreName = (value = "", brandId = "cyj") => (
  `${brandId === "anniu" ? "安妞" : brandId === "yibo" ? "伊啵" : "CYJ"}${normalizeStoreCore(value)}店`
);
const bucketFor = (row, brandId = "cyj") => buildProjectionBucket({
  row, brandId, normalizeStoreCore, getCanonicalStoreName,
});

test("B1 row-pack preserves explicit zero and field absence", () => {
  const row = buildProjectedReportRow({
    date: "2026-09-28", storeName: "CYJA店",
    cash: 0, refund: 0, skincareRefund: 0, accrual: 0, traffic: 0,
  }, "report-1");
  assert.equal(row.cash, 0);
  assert.equal(row.accrual, 0);
  assert.equal(Object.hasOwn(row, "newCustomerSales"), false);
});

test("B1 row-pack rejects invalid date/store/report identity", () => {
  assert.equal(buildProjectedReportRow({ date: "2026-02-31", storeName: "CYJA店" }, "x"), null);
  assert.equal(buildProjectedReportRow({ date: "2026-09-01", storeName: "" }, "x"), null);
  assert.equal(buildProjectedReportRow({ date: "2026-09-01", storeName: "CYJA店" }, ""), null);
});

test("B1 bucket is brand/store/month scoped and slash-safe", () => {
  const row = buildProjectedReportRow({ date: "2026-09-28", storeName: "CYJA/B店", cash: 1 }, "r1");
  const bucket = bucketFor(row);
  assert.equal(bucket.yearMonth, "2026-09");
  assert.equal(bucket.storeKey, "A/B");
  assert.equal(bucket.documentId.includes("/"), false);
});

test("B1 true-zero report still creates source presence", () => {
  const row = buildProjectedReportRow({
    date: "2026-09-01", storeName: "CYJA店",
    cash: 0, refund: 0, skincareRefund: 0, accrual: 0,
  }, "r1");
  const bucket = bucketFor(row);
  const result = applySourceEventToProjectionData({}, {
    bucket, sourceReportId: "r1",
    eventTimestamp: "2026-09-01T10:00:00.000Z", exists: true, row,
  });
  assert.equal(result.data.schemaVersion, CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION);
  assert.equal(result.data.sourceReportCount, 1);
  assert.deepEqual(result.data.submittedDates, ["2026-09-01"]);
});

test("B1 newer update replaces same source report without duplicate presence", () => {
  const row1 = buildProjectedReportRow({ date: "2026-09-01", storeName: "CYJA店", cash: 10 }, "r1");
  const row2 = buildProjectedReportRow({ date: "2026-09-01", storeName: "CYJA店", cash: 20 }, "r1");
  const bucket = bucketFor(row1);
  const first = applySourceEventToProjectionData({}, {
    bucket, sourceReportId: "r1", eventTimestamp: "2026-09-01T10:00:00.000Z", exists: true, row: row1,
  });
  const second = applySourceEventToProjectionData(first.data, {
    bucket, sourceReportId: "r1", eventTimestamp: "2026-09-01T10:01:00.000Z", exists: true, row: row2,
  });
  assert.equal(second.data.sourceReportCount, 1);
  const active = Object.values(second.data.sourceEvents).find((entry) => entry.exists === true);
  assert.equal(active.row.cash, 20);
});

test("B1 older event cannot overwrite newer event", () => {
  const row1 = buildProjectedReportRow({ date: "2026-09-01", storeName: "CYJA店", cash: 10 }, "r1");
  const row2 = buildProjectedReportRow({ date: "2026-09-01", storeName: "CYJA店", cash: 20 }, "r1");
  const bucket = bucketFor(row1);
  const newer = applySourceEventToProjectionData({}, {
    bucket, sourceReportId: "r1", eventTimestamp: "2026-09-01T10:02:00.000Z", exists: true, row: row2,
  });
  const older = applySourceEventToProjectionData(newer.data, {
    bucket, sourceReportId: "r1", eventTimestamp: "2026-09-01T10:01:00.000Z", exists: true, row: row1,
  });
  assert.equal(older.changed, false);
  const active = Object.values(older.data.sourceEvents).find((entry) => entry.exists === true);
  assert.equal(active.row.cash, 20);
});

test("B1 delete tombstone blocks older resurrection", () => {
  const row = buildProjectedReportRow({ date: "2026-09-01", storeName: "CYJA店", cash: 0 }, "r1");
  const bucket = bucketFor(row);
  const created = applySourceEventToProjectionData({}, {
    bucket, sourceReportId: "r1", eventTimestamp: "2026-09-01T10:00:00.000Z", exists: true, row,
  });
  const deleted = applySourceEventToProjectionData(created.data, {
    bucket, sourceReportId: "r1", eventTimestamp: "2026-09-01T10:02:00.000Z", exists: false, row: null,
  });
  assert.equal(deleted.data.sourceReportCount, 0);
  const stale = applySourceEventToProjectionData(deleted.data, {
    bucket, sourceReportId: "r1", eventTimestamp: "2026-09-01T10:01:00.000Z", exists: true, row,
  });
  assert.equal(stale.changed, false);
  assert.equal(stale.data.sourceReportCount, 0);
});
