import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("B1 reuses existing daily report onWrite triggers; no scheduler/polling", () => {
  const index = read("functions/index.js");
  const module = read("functions/currentStoreMonthReports.js");
  assert.match(index, /currentStoreMonthReportsWriter\.updateFromDailyWrite\(change, context, getBackendDirtyBrandId\(context\.params\.appId\)\)/);
  assert.match(index, /currentStoreMonthReportsWriter\.updateFromDailyWrite\(change, context, context\.params\.brandId\)/);
  assert.doesNotMatch(module, /onSchedule/);
  assert.doesNotMatch(module, /setInterval\s*\(/);
  assert.doesNotMatch(module, /\.where\(["']date["']/);
});

test("B1 Rules make projection/status browser-read-only and close generic bypass", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /match \/brands\/\{brandId\}\/current_store_month_reports\/\{document=\*\*\} \{[\s\S]*?allow read: if sameBrandIdentity\(brandId\);[\s\S]*?allow write: if false;/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/current_store_month_reports\/\{document=\*\*\} \{[\s\S]*?allow read: if cyjLegacyIdentity\(appId\);[\s\S]*?allow write: if false;/);
  assert.ok((rules.match(/collectionName != 'current_store_month_reports'/g) || []).length >= 2);
  assert.ok((rules.match(/collectionName != 'current_store_month_reports_status'/g) || []).length >= 2);
});

test("B1 is backend-only and CURRENT_APP_VERSION stays 3.6.0", () => {
  const app = read("src/App.jsx");
  assert.doesNotMatch(app, /current_store_month_reports/);
  assert.match(app, /const CURRENT_APP_VERSION = "3\.6\.0";/);
});

test("B1 delegates Store Identity to shared Lifecycle owner", () => {
  const index = read("functions/index.js");
  assert.match(index, /normalizeStoreCore: normalizeStoreLifecycleCore/);
  assert.match(index, /getCanonicalStoreName,/);
});
