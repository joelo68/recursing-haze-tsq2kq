import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_APP_VERSION_SOURCE_PATTERN } from "./helpers/appVersionContract.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const dashboardHook = read("src/hooks/useDashboardStats.js");
const appSource = read("src/App.jsx");

test("FRD-A4 retires the dead Dashboard historical read-policy mirror", () => {
  assert.doesNotMatch(dashboardHook, /dashboardTargetReadPolicy/);
  assert.doesNotMatch(dashboardHook, /resolveHistoricalDashboardReadPolicy/);
  assert.doesNotMatch(dashboardHook, /inspectHistoricalReportingCalendarTrust/);
});

test("FRD-A4 keeps App as the sole daily-report read-topology policy owner", () => {
  assert.match(appSource, /resolveHistoricalDashboardReadPolicy/);
  assert.match(appSource, /dashboardReadPolicy\.shouldLoadDailyReports/);
  assert.match(appSource, /inspectHistoricalSystemExclusionTrust/);
  assert.match(appSource, /inspectHistoricalReportingCalendarTrust/);
  assert.match(appSource, /reportingCalendarTrusted: reportingCalendarTrust\.trusted/);
});

test("FRD-A4 preserves Dashboard presentation trust responsibility", () => {
  assert.match(dashboardHook, /getSummaryRecalcFlagState/);
  assert.match(dashboardHook, /inspectHistoricalSystemExclusionTrust/);
  assert.match(dashboardHook, /const dashboardSummaryBundle = useMemo\(\(\) => \{/);
  assert.match(dashboardHook, /const isSummaryTrustedForDashboard = useMemo/);
  assert.match(dashboardHook, /currentReportSummaryReadyBrandId === brandInfo\?\.id/);
  assert.match(dashboardHook, /currentSummaryRecalcFlagState\?\.brandId === brandInfo\?\.id/);
});

test("FRD-A4 is read-neutral and does not reintroduce Firestore ownership", () => {
  assert.doesNotMatch(dashboardHook, /from ['"]firebase\/firestore['"]/);
  assert.doesNotMatch(dashboardHook, /\bonSnapshot\s*\(/);
  assert.doesNotMatch(dashboardHook, /\bgetDoc\s*\(/);
  assert.doesNotMatch(dashboardHook, /\bgetDocs\s*\(/);
  assert.doesNotMatch(dashboardHook, /\bquery\s*\(/);
  assert.doesNotMatch(dashboardHook, /\bsetInterval\s*\(/);
});

test("FRD-A4 keeps application version unchanged", () => {
  assert.match(appSource, CURRENT_APP_VERSION_SOURCE_PATTERN);
});
