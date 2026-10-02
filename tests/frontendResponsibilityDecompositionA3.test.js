import { CURRENT_APP_VERSION_SOURCE_PATTERN } from "./helpers/appVersionContract.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const dashboardHook = read("src/hooks/useDashboardStats.js");
const therapistSummaryLoader = read("src/hooks/useDashboardTherapistSummary.js");
const projectionLoader = read("src/hooks/useDashboardProjectionModel.js");
const annualLoader = read("src/hooks/useAnnualKpiBenchmark.js");
const appSource = read("src/App.jsx");

test("FRD-A3 moves therapist Summary Firestore listener ownership out of useDashboardStats", () => {
  assert.match(dashboardHook, /useDashboardTherapistSummary\(\{/);
  assert.match(dashboardHook, /brandId:\s*brandInfo\?\.id/);
  assert.match(dashboardHook, /selectedYearMonth/);
  assert.match(dashboardHook, /isSelectedCurrentMonth/);
  assert.match(dashboardHook, /isTherapistModuleEnabled/);
  assert.match(dashboardHook, /viewMode/);

  assert.doesNotMatch(dashboardHook, /from ['"]firebase\/firestore['"]/);
  assert.doesNotMatch(dashboardHook, /\bonSnapshot\s*\(/);
  assert.doesNotMatch(dashboardHook, /\bdoc\s*\(/);
});

test("FRD-A3 preserves one historical therapist_summary document listener and no query/polling", () => {
  assert.match(
    therapistSummaryLoader,
    /doc\(getCollectionPath\("therapist_summary"\), selectedYearMonth\)/
  );
  assert.match(therapistSummaryLoader, /const unsubscribe = onSnapshot\(/);
  assert.equal((therapistSummaryLoader.match(/\bonSnapshot\s*\(/g) || []).length, 1);
  assert.equal((therapistSummaryLoader.match(/\bdoc\s*\(/g) || []).length, 1);

  assert.doesNotMatch(therapistSummaryLoader, /\bgetDoc\s*\(/);
  assert.doesNotMatch(therapistSummaryLoader, /\bgetDocs\s*\(/);
  assert.doesNotMatch(therapistSummaryLoader, /\bquery\s*\(/);
  assert.doesNotMatch(therapistSummaryLoader, /\bcollection\s*\(/);
  assert.doesNotMatch(therapistSummaryLoader, /\bsetInterval\s*\(/);
  assert.doesNotMatch(therapistSummaryLoader, /\bsetTimeout\s*\(/);
});

test("FRD-A3 preserves view-scoped activation semantics", () => {
  assert.match(therapistSummaryLoader, /!getCollectionPath/);
  assert.match(therapistSummaryLoader, /!brandId/);
  assert.match(therapistSummaryLoader, /!selectedYearMonth/);
  assert.match(therapistSummaryLoader, /isSelectedCurrentMonth/);
  assert.match(therapistSummaryLoader, /!isTherapistModuleEnabled/);
  assert.match(therapistSummaryLoader, /viewMode !== "therapist"/);
  assert.match(therapistSummaryLoader, /unsubscribe\?\.\(\)/);
  assert.match(therapistSummaryLoader, /cancelled = true/);
});

test("FRD-A3 brand-month anchors therapist Summary state and consumer", () => {
  assert.match(
    therapistSummaryLoader,
    /brandId = String\(inputBrandId \|\| ""\)\.trim\(\)\.toLowerCase\(\)/
  );
  assert.match(therapistSummaryLoader, /brandId,/);
  assert.match(therapistSummaryLoader, /yearMonth: selectedYearMonth/);

  assert.match(dashboardHook, /const therapistMatchesScope = Boolean\(/);
  assert.match(
    dashboardHook,
    /String\(therapistSummaryState\?\.brandId \|\| ""\)\.toLowerCase\(\) === String\(brandInfo\?\.id \|\| ""\)\.toLowerCase\(\)/
  );
  assert.match(dashboardHook, /therapistSummaryState\?\.yearMonth === selectedYearMonth/);
  assert.match(dashboardHook, /therapist:\s*therapistMatchesScope/);
});

test("FRD-A3 does not absorb Annual KPI or Projection Model IO ownership", () => {
  assert.match(annualLoader, /getCollectionPath\("annual_kpi_summary"\)/);
  assert.match(projectionLoader, /getCollectionPath\("projection_models"\)/);

  assert.doesNotMatch(therapistSummaryLoader, /annual_kpi_summary/);
  assert.doesNotMatch(therapistSummaryLoader, /projection_models/);
});

test("FRD-A3 keeps application version unchanged", () => {
  assert.match(appSource, CURRENT_APP_VERSION_SOURCE_PATTERN);
});
