import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const appSource = read("src/App.jsx");
const dashboardHook = read("src/hooks/useDashboardStats.js");
const annualLoader = read("src/hooks/useAnnualKpiBenchmark.js");
const projectionLoader = read("src/hooks/useDashboardProjectionModel.js");
const therapistSummaryLoader = read("src/hooks/useDashboardTherapistSummary.js");

test("FRD-A1 moves Annual KPI benchmark IO out of useDashboardStats", () => {
  assert.match(dashboardHook, /useAnnualKpiBenchmark\(\{/);
  assert.match(dashboardHook, /brandId:\s*brandInfo\?\.id/);
  assert.match(dashboardHook, /selectedYear/);

  assert.doesNotMatch(dashboardHook, /cyj_annual_kpi_summary_v6_/);
  assert.doesNotMatch(dashboardHook, /getCollectionPath\("annual_kpi_summary"\)/);
  assert.doesNotMatch(dashboardHook, /normalizeAnnualKpiBenchmarkPayload\(/);
});

test("FRD-A1 preserves the exact single-document annual KPI read topology", () => {
  assert.match(annualLoader, /doc\(getCollectionPath\("annual_kpi_summary"\), year\)/);
  assert.match(annualLoader, /getDoc\(summaryRef\)/);
  assert.equal((annualLoader.match(/getDoc\(/g) || []).length, 1);

  assert.doesNotMatch(annualLoader, /onSnapshot\s*\(/);
  assert.doesNotMatch(annualLoader, /getDocs\s*\(/);
  assert.doesNotMatch(annualLoader, /query\s*\(/);
  assert.doesNotMatch(annualLoader, /setInterval\s*\(/);
});

test("FRD-A1 preserves brand-year cache isolation and one-hour TTL", () => {
  assert.match(annualLoader, /cyj_annual_kpi_summary_v6_\$\{brandId\}_\$\{year\}/);
  assert.match(annualLoader, /60 \* 60 \* 1000/);
  assert.match(annualLoader, /sessionStorage\.getItem\(cacheKey\)/);
  assert.match(annualLoader, /sessionStorage\.setItem\(cacheKey/);
});

test("FRD-A1 preserves normalization and missing/error fail-safe semantics", () => {
  assert.match(annualLoader, /normalizeAnnualKpiBenchmarkPayload\(cached\)/);
  assert.match(annualLoader, /normalizeAnnualKpiBenchmarkPayload\(snap\.data\(\) \|\| \{\}\)/);
  assert.match(annualLoader, /makeEmptyAnnualKpiBenchmark\(\{\}, "not_available"\)/);
  assert.match(annualLoader, /makeEmptyAnnualKpiBenchmark\(\{\}, "missing"\)/);
  assert.match(annualLoader, /makeEmptyAnnualKpiBenchmark\(\{\}, "error"\)/);
});

test("FRD-A1 annual loader remains isolated from Projection Model and therapist Summary ownership", () => {
  assert.match(dashboardHook, /useDashboardProjectionModel\(\{/);
  assert.match(projectionLoader, /getCollectionPath\("projection_models"\)/);
  assert.doesNotMatch(dashboardHook, /useDashboardTherapistSummary\(\{/);
  assert.match(appSource, /useDashboardTherapistSummary\(\{/);
  assert.match(therapistSummaryLoader, /getCollectionPath\("therapist_summary"\)/);
  assert.match(therapistSummaryLoader, /onSnapshot\(/);
  assert.doesNotMatch(annualLoader, /projection_models/);
  assert.doesNotMatch(annualLoader, /therapist_summary/);
});
