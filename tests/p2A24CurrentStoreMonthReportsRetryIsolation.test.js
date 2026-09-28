import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("functions/index.js", "utf8");

function sliceBetween(start, end) {
  const startAt = index.indexOf(start);
  assert.notEqual(startAt, -1, `missing start anchor: ${start}`);
  const endAt = index.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing end anchor: ${end}`);
  return index.slice(startAt, endAt);
}

test("B2B legacy aggregate trigger no longer owns projection writer", () => {
  const block = sliceBetween(
    "exports.aggregateLegacyReports =",
    "exports.aggregateBrandReports ="
  );
  assert.match(block, /updateMonthlyAggregation/);
  assert.match(block, /markSummaryDirtyFromDailyWrite/);
  assert.doesNotMatch(block, /currentStoreMonthReportsWriter/);
});

test("B2B brand aggregate trigger no longer owns projection writer", () => {
  const block = sliceBetween(
    "exports.aggregateBrandReports =",
    "// ==========================================\n// ★ 1.5"
  );
  assert.match(block, /updateMonthlyAggregation/);
  assert.match(block, /markSummaryDirtyFromDailyWrite/);
  assert.doesNotMatch(block, /currentStoreMonthReportsWriter/);
});

test("B2B dedicated projection triggers are exactly scoped to raw daily reports", () => {
  const legacy = sliceBetween(
    "exports.projectLegacyCurrentStoreMonthReports =",
    "exports.projectBrandCurrentStoreMonthReports ="
  );
  const brand = sliceBetween(
    "exports.projectBrandCurrentStoreMonthReports =",
    "exports.aggregateLegacyReports ="
  );

  assert.match(legacy, /artifacts\/\{appId\}\/public\/data\/daily_reports\/\{reportId\}/);
  assert.match(legacy, /getBackendDirtyBrandId\(context\.params\.appId\)/);
  assert.match(brand, /brands\/\{brandId\}\/daily_reports\/\{reportId\}/);
  assert.match(brand, /context\.params\.brandId/);

  for (const block of [legacy, brand]) {
    assert.match(block, /currentStoreMonthReportsWriter\.updateFromDailyWrite/);
    assert.doesNotMatch(block, /updateMonthlyAggregation/);
    assert.doesNotMatch(block, /markSummaryDirtyFromDailyWrite/);
    assert.doesNotMatch(block, /FieldValue\.increment/);
  }
});

test("B2B does not add polling, scheduler, frontend cutover, or version bump", () => {
  const current = fs.readFileSync("functions/currentStoreMonthReports.js", "utf8");
  const app = fs.readFileSync("src/App.jsx", "utf8");

  assert.doesNotMatch(current, /setInterval\s*\(/);
  assert.doesNotMatch(current, /onSchedule/);
  assert.doesNotMatch(app, /current_store_month_reports/);
  assert.match(app, /const CURRENT_APP_VERSION = "3\.6\.0";/);
});
