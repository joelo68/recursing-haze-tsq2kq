import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const dashboardSource = fs.readFileSync(
  path.join(root, "src/components/DashboardView.jsx"),
  "utf8"
);

test("B1C2E-UX2A removes cross-module full-page readiness blocking", () => {
  assert.doesNotMatch(
    dashboardSource,
    /if\s*\(\s*!dashboardStats\s*\|\|\s*\(isTherapistModuleEnabled\s*&&\s*!therapistStats\)\s*\)/
  );
  assert.match(dashboardSource, /const isStoreViewActive = \(/);
  assert.match(
    dashboardSource,
    /const isTherapistViewActive = isTherapistModuleEnabled && viewMode === 'therapist';/
  );
});

test("B1C2E-UX2A keeps DashboardHeader mounted while the active section loads", () => {
  const headerIndex = dashboardSource.indexOf("<DashboardHeader");
  const storeIndex = dashboardSource.indexOf("{isStoreViewActive && (");
  const therapistIndex = dashboardSource.indexOf("{isTherapistViewActive && (");

  assert.ok(headerIndex >= 0);
  assert.ok(storeIndex > headerIndex);
  assert.ok(therapistIndex > storeIndex);

  assert.match(
    dashboardSource,
    /DashboardSectionLoading label="門市營運資料載入中\.\.\."/
  );
  assert.match(
    dashboardSource,
    /DashboardSectionLoading label="人員績效資料載入中\.\.\."/
  );
});

test("B1C2E-UX2A binds each consumer to its own readiness source", () => {
  const storeBlock = dashboardSource.match(
    /\{isStoreViewActive && \([\s\S]*?\n        \)\}/
  )?.[0] || "";
  const therapistBlock = dashboardSource.match(
    /\{isTherapistViewActive && \([\s\S]*?\n        \)\}/
  )?.[0] || "";

  assert.match(storeBlock, /dashboardStats \? \(/);
  assert.match(storeBlock, /<StorePerformanceView/);
  assert.doesNotMatch(storeBlock, /therapistStats \? \(/);

  assert.match(therapistBlock, /therapistStats \? \(/);
  assert.match(therapistBlock, /<TherapistPerformanceView/);
  assert.doesNotMatch(therapistBlock, /dashboardStats \? \(/);
});

test("B1C2E-UX2A adds no Firestore read, listener, query, or polling primitive", () => {
  assert.doesNotMatch(
    dashboardSource,
    /\bonSnapshot\b|\bgetDoc\b|\bgetDocs\b|\bcollection\s*\(|\bquery\s*\(|\bsetInterval\s*\(|\bsetTimeout\s*\(/
  );
});
