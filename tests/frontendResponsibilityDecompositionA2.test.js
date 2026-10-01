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
const projectionLoader = read("src/hooks/useDashboardProjectionModel.js");

test("FRD-A2 moves Projection Model Firestore IO out of useDashboardStats", () => {
  assert.match(dashboardHook, /useDashboardProjectionModel\(\{/);
  assert.match(dashboardHook, /brandId:\s*brandInfo\?\.id/);
  assert.match(dashboardHook, /selectedYearMonth/);
  assert.match(dashboardHook, /isSelectedCurrentMonth/);

  assert.doesNotMatch(dashboardHook, /getCollectionPath\("projection_models"\)/);
  assert.doesNotMatch(dashboardHook, /getDoc\(/);
});

test("FRD-A2 preserves Projection Model single-document point-read topology", () => {
  assert.match(
    projectionLoader,
    /doc\(getCollectionPath\("projection_models"\), PROJECTION_MODEL_DOC_ID\)/
  );
  assert.match(projectionLoader, /getDoc\(modelRef\)/);
  assert.equal((projectionLoader.match(/getDoc\(/g) || []).length, 1);

  assert.doesNotMatch(projectionLoader, /onSnapshot\s*\(/);
  assert.doesNotMatch(projectionLoader, /getDocs\s*\(/);
  assert.doesNotMatch(projectionLoader, /query\s*\(/);
  assert.doesNotMatch(projectionLoader, /setInterval\s*\(/);
});

test("FRD-A2 preserves current-month activation and brand-month state anchoring", () => {
  assert.match(
    projectionLoader,
    /!getCollectionPath \|\| !selectedYearMonth \|\| !isSelectedCurrentMonth \|\| !brandId/
  );
  assert.match(projectionLoader, /brandId = String\(inputBrandId \|\| ""\)\.toLowerCase\(\)/);
  assert.match(projectionLoader, /modelMonth: selectedYearMonth/);
  assert.match(projectionLoader, /ready: false/);
  assert.match(projectionLoader, /ready: true/);
  assert.match(projectionLoader, /cancelled = true/);
});

test("FRD-A2 keeps Projection trust composition in useDashboardStats", () => {
  assert.match(dashboardHook, /inspectProjectionModelTrust\(/);
  assert.match(dashboardHook, /projectionPresentationReady/);
  assert.match(dashboardHook, /currentLifecycleMasterState/);
  assert.match(dashboardHook, /systemExclusionState/);

  assert.doesNotMatch(projectionLoader, /inspectProjectionModelTrust/);
  assert.doesNotMatch(projectionLoader, /currentLifecycleMasterState/);
  assert.doesNotMatch(projectionLoader, /systemExclusionState/);
});

test("FRD-A2 does not absorb therapist Summary listener ownership", () => {
  assert.match(dashboardHook, /getCollectionPath\("therapist_summary"\)/);
  assert.match(dashboardHook, /onSnapshot\(/);
  assert.doesNotMatch(projectionLoader, /therapist_summary/);
  assert.doesNotMatch(projectionLoader, /onSnapshot\(/);
});
