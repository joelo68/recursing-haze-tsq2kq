// tests/smartForecastProduct.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("Smart Forecast is standalone and permission-controlled, not another SystemMaintenance tool", () => {
  const constants = read("src/constants/index.js");
  const app = read("src/App.jsx");
  const maintenance = read("src/components/SystemMaintenance.jsx");

  assert.match(constants, /id:\s*"smart-forecast"/);
  assert.match(constants, /label:\s*"智慧推估"/);
  assert.doesNotMatch(constants, /id:\s*"smart-forecast"[^\n]*directorOnly:\s*true/);
  assert.match(app, /activeView === "smart-forecast"/);
  assert.match(app, /canAccessSmartForecastView/);
  assert.doesNotMatch(maintenance, /SmartForecastView/);
});

test("Smart Forecast local preview cannot write Production", () => {
  const view = read("src/components/SmartForecastView.jsx");
  assert.match(view, /import\.meta\.env\.DEV/);
  assert.match(view, /本機測試模式/);
  assert.match(view, /沒有寫入正式資料/);
  assert.doesNotMatch(view, /\bsetDoc\s*\(/);
  assert.doesNotMatch(view, /\baddDoc\s*\(/);
  assert.doesNotMatch(view, /\bonSnapshot\s*\(/);
  assert.doesNotMatch(view, /\bsetInterval\s*\(/);
});

test("Smart Forecast user-facing copy stays operational and non-engineering", () => {
  const view = read("src/components/SmartForecastView.jsx");
  for (const forbidden of [
    "WAPE",
    "Bias",
    "residual",
    "regime",
    "shrinkage",
    "feature engineering",
    "ensemble",
    "drift detection",
    "training loss",
  ]) {
    assert.equal(view.includes(forbidden), false, `unexpected UI engineering term: ${forbidden}`);
  }
  assert.match(view, /本月情境/);
  assert.match(view, /一般月份/);
  assert.match(view, /活動月份/);
  assert.match(view, /推估方式/);
});

test("Smart Forecast Firestore rules are frontend read-only on both brand roots", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /brands\/\{brandId\}\/projection_context\/\{document=\*\*\}/);
  assert.match(rules, /artifacts\/\{appId\}\/public\/data\/projection_context\/\{document=\*\*\}/);
  assert.match(rules, /collectionName != 'projection_context'/);
});

test("Smart Forecast Backend is request-only and does not introduce listeners or polling", () => {
  const source = read("functions/projectionContext.js");
  assert.match(source, /onRequest/);
  assert.doesNotMatch(source, /onSchedule/);
  assert.doesNotMatch(source, /onSnapshot/);
  assert.doesNotMatch(source, /setInterval/);
  assert.match(source, /runTransaction/);
  assert.match(source, /verifySuperAdminActor/);
});


test("Smart Forecast uses the system SmartDatePicker instead of browser native date inputs", () => {
  const view = read("src/components/SmartForecastView.jsx");
  assert.match(view, /import SmartDatePicker from "\.\/SmartDatePicker"/);
  assert.match(view, /<SmartDatePicker/);
  assert.doesNotMatch(view, /type="date"/);
});

test("Smart Forecast store selection is manager-first instead of rendering the whole brand at once", () => {
  const view = read("src/components/SmartForecastView.jsx");
  assert.match(view, /先選區長／區域/);
  assert.match(view, /selectedManagerRow/);
  assert.match(view, /全選此區/);
  assert.match(view, /清除此區/);
  assert.doesNotMatch(view, /storeOptions\.map/);
});

test("Smart Forecast appears in module permission management and non-director access follows saved permissions", () => {
  const constants = read("src/constants/index.js");
  const settings = read("src/components/SettingsView.jsx");
  const navigation = read("src/components/Navigation.jsx");
  const app = read("src/App.jsx");

  assert.match(constants, /id:\s*"smart-forecast"/);
  assert.doesNotMatch(constants, /id:\s*"smart-forecast"[^\n]*directorOnly:\s*true/);
  assert.match(settings, /ALL_MENU_ITEMS\.filter\(\(item\) => item\.directorOnly !== true\)\.map/);
  assert.match(navigation, /permissions\?\.\[userRole\]/);
  assert.match(app, /permissions\?\.\[userRole\]\)\s*&&\s*permissions\[userRole\]\.includes\("smart-forecast"\)/);
});


test("Smart Forecast month selection uses the shared system SmartMonthPicker instead of browser native month input", () => {
  const view = read("src/components/SmartForecastView.jsx");
  const picker = read("src/components/SmartMonthPicker.jsx");
  assert.match(view, /import SmartMonthPicker from "\.\/SmartMonthPicker"/);
  assert.match(view, /<SmartMonthPicker/);
  assert.match(picker, /回到本月/);
  assert.doesNotMatch(view, /type="month"/);
});

test("Smart Forecast v2 supports one campaign with per-store scheduled dates in the same monthly document", () => {
  const backend = read("functions/projectionContext.js");
  const view = read("src/components/SmartForecastView.jsx");

  assert.match(backend, /projection-context-v2/);
  assert.match(backend, /storeSchedule/);
  assert.match(backend, /PROJECTION_CONTEXT_MAX_STORE_SCHEDULES_PER_EVENT/);
  assert.match(backend, /isLifecycleEntryExpectedForDate/);
  assert.match(backend, /PROJECTION_CONTEXT_SCHEDULE_STORE_EXCLUDED/);
  assert.match(backend, /PROJECTION_CONTEXT_SCHEDULE_OUTSIDE_EVENT_PERIOD/);

  assert.match(view, /各店活動日期（選填）/);
  assert.match(view, /storeSchedule/);
  assert.match(view, /已排定/);
  assert.match(view, /SmartDatePicker/);
  assert.doesNotMatch(view, /type="date"/);
});

test("Smart Forecast v2 keeps page reads to one projection_context document per selected month", () => {
  const view = read("src/components/SmartForecastView.jsx");
  assert.match(
    view,
    /getDoc\(doc\(getCollectionPath\("projection_context"\), selectedMonth\)\)/
  );
  assert.doesNotMatch(view, /\bgetDocs\s*\(/);
  assert.doesNotMatch(view, /\bonSnapshot\s*\(/);
  assert.doesNotMatch(view, /\bsetInterval\s*\(/);
});

test("Smart Forecast v2 backend keeps one monthly context transaction and revalidates Lifecycle / System Exclusion", () => {
  const backend = read("functions/projectionContext.js");
  assert.match(backend, /getBrandCollection\(db, brandId, PROJECTION_CONTEXT_COLLECTION\)\.doc\(yearMonth\)/);
  assert.match(backend, /getBrandCollection\(db, brandId, "store_lifecycle"\)\.doc\("master"\)/);
  assert.match(backend, /getBrandSettingDoc\(db, brandId, "audit_exclusions"\)/);
  assert.match(backend, /runTransaction/);
  assert.match(backend, /currentRevision !== expectedRevision/);
  assert.match(backend, /lifecycleEntriesByStoreKey/);
  assert.match(backend, /normalizeStoredSystemExclusionProfile/);
});

test("Smart Forecast v2 frontend filters already-known System Excluded stores without weakening backend authority", () => {
  const view = read("src/components/SmartForecastView.jsx");
  assert.match(view, /systemExclusionState/);
  assert.match(view, /excludedStoreKeySet/);
  assert.match(view, /excludedStoreKeySet\.has\(storeKey\)/);

  const backend = read("functions/projectionContext.js");
  assert.match(backend, /excluded\.has\(storeKey\)/);
  assert.match(backend, /PROJECTION_CONTEXT_SCHEDULE_STORE_EXCLUDED/);
});

test("Smart Forecast OCC conflict metadata survives the shared endpoint wrapper", () => {
  const app = read("src/App.jsx");
  const view = read("src/components/SmartForecastView.jsx");

  assert.match(app, /error\.code = String\(result\?\.code \|\| ""\)/);
  assert.match(app, /error\.currentContext = result\?\.currentContext \|\| null/);
  assert.match(view, /error\?\.code === "PROJECTION_CONTEXT_CONFLICT"/);
  assert.match(view, /error\?\.currentContext/);
});

test("Smart Forecast exposes VIP as a business event type without changing Projection formula", () => {
  const view = read("src/components/SmartForecastView.jsx");
  const backend = read("functions/projectionContext.js");

  assert.match(view, /id:\s*"vip",\s*label:\s*"VIP實體活動"/);
  assert.match(backend, /"vip"/);
  assert.match(view, /目前正式推估維持不變/);
});

test("Smart Forecast month cache is brand-scoped and cannot leak context across brands", () => {
  const view = read("src/components/SmartForecastView.jsx");
  assert.match(view, /const contextCacheKey = useMemo/);
  assert.match(view, /`\$\{brandId \|\| "unknown"\}\|\$\{selectedMonth\}`/);
  assert.match(view, /cacheRef\.current\.has\(contextCacheKey\)/);
  assert.match(view, /cacheRef\.current\.set\(contextCacheKey,/);
  assert.doesNotMatch(view, /cacheRef\.current\.set\(selectedMonth,/);
});
