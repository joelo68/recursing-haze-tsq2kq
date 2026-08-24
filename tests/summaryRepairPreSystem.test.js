import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.resolve(__dirname, "../functions/index.js"), "utf8");

test("Yibo pre-system months are guarded from automatic Summary repair", () => {
  assert.match(
    source,
    /SUMMARY_REPAIR_DATA_START_MONTH[\s\S]*yibo:\s*"2026-04"/,
    "Yibo automatic Summary repair floor must remain 2026-04 unless production data policy changes."
  );

  assert.match(
    source,
    /function isBeforeSummaryRepairDataStartMonth[\s\S]*normalizedYearMonth < startMonth/,
    "Pre-system month helper must compare YYYY-MM against the configured repair floor."
  );

  assert.match(
    source,
    /status:\s*"ignored_pre_system_month"[\s\S]*cleanupReason:\s*"before_brand_data_start_month"/,
    "Dirty flags / queue rows before the data start month must be closed instead of retried."
  );
});

test("scheduled finalize path skips pre-system months before Summary build", () => {
  const finalizeStart = source.indexOf("async function finalizeMonthReportAuto");
  const buildCall = source.indexOf("buildAutoDashboardSummaryPayloads(brandId, yearMonth)", finalizeStart);
  const preSystemGuard = source.indexOf("isBeforeSummaryRepairDataStartMonth(brandId, yearMonth)", finalizeStart);

  assert.ok(finalizeStart >= 0, "finalizeMonthReportAuto must exist.");
  assert.ok(preSystemGuard > finalizeStart, "finalizeMonthReportAuto must check pre-system months.");
  assert.ok(buildCall > preSystemGuard, "Pre-system guard must run before the Summary builder and target fallback.");
});

test("active historical months keep the zero-raw safety guard", () => {
  assert.match(
    source,
    /dailyRows\.length === 0[\s\S]*原始店日報為 0 筆[\s\S]*請確認來源路徑/,
    "The existing zero-daily-report safety guard must remain for supported months."
  );
});
