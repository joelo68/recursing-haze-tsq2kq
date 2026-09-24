import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("src/App.jsx", "utf8");
const monitor = fs.readFileSync("src/components/SystemMonitor.jsx", "utf8");
const backend = fs.readFileSync("functions/productionObservability.js", "utf8");
const index = fs.readFileSync("functions/index.js", "utf8");
const rules = fs.readFileSync("firestore.rules", "utf8");

test("P1-C frontend calls a dedicated same-brand backend snapshot endpoint", () => {
  assert.match(app, /PRODUCTION_OBSERVABILITY_ENDPOINT/);
  assert.match(app, /getProductionHealthSnapshotAction/);
  assert.match(app, /brandId: currentBrandId/);
  assert.match(index, /exports\.getProductionHealthSnapshot/);
});

test("P1-C System Monitor uses an on-demand health tab and no new listener or polling", () => {
  assert.match(monitor, /useState\("health"\)/);
  assert.match(monitor, />系統狀態</);
  assert.match(monitor, /重新檢查/);
  assert.match(monitor, /loadProductionHealth/);
  assert.doesNotMatch(monitor, /setInterval\([^)]*productionHealth/i);
  assert.doesNotMatch(monitor, /onSnapshot\([^)]*productionHealth/i);
});

test("P1-C backend is read-only, bounded and brand-scoped", () => {
  assert.match(backend, /SUMMARY_ISSUE_LIMIT = 10/);
  assert.match(backend, /MAINTENANCE_LIMIT = 5/);
  assert.match(backend, /MAX_DOCUMENT_READ_BUDGET = 21/);
  assert.match(backend, /getBrandCollection\(db, brandId, "summary_recalc_flags"\)/);
  assert.match(backend, /getBrandSettingDoc\(db, brandId, "read_tracker_config"\)/);
  assert.match(backend, /roleId \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "director"/);
  assert.match(backend, /PRODUCTION_OBSERVABILITY_DIRECTOR_LEVELS\.includes/);
  assert.doesNotMatch(backend, /\.set\(/);
  assert.doesNotMatch(backend, /\.add\(/);
  assert.doesNotMatch(backend, /\.update\(/);
  assert.doesNotMatch(backend, /\.delete\(/);
  assert.doesNotMatch(backend, /onSchedule/);
  assert.doesNotMatch(backend, /onDocument/);
});

test("P1-C does not create a new Firestore health collection or broaden Rules", () => {
  assert.doesNotMatch(backend, /production_health/);
  assert.doesNotMatch(rules, /production_health/);
});

test("P1-C keeps app version unchanged", () => {
  assert.match(app, /const CURRENT_APP_VERSION = "3\.6\.0";/);
});
