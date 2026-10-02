import { CURRENT_APP_VERSION_SOURCE_PATTERN } from "./helpers/appVersionContract.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("B2B current store-month projection uses dedicated daily report onWrite triggers; no scheduler/polling", () => {
  const index = read("functions/index.js");
  const module = read("functions/currentStoreMonthReports.js");
  assert.match(index, /exports\.projectLegacyCurrentStoreMonthReports = functions\.firestore[\s\S]*?artifacts\/\{appId\}\/public\/data\/daily_reports\/\{reportId\}[\s\S]*?currentStoreMonthReportsWriter\.updateFromDailyWrite/);
  assert.match(index, /exports\.projectBrandCurrentStoreMonthReports = functions\.firestore[\s\S]*?brands\/\{brandId\}\/daily_reports\/\{reportId\}[\s\S]*?currentStoreMonthReportsWriter\.updateFromDailyWrite/);
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

test("B4 cuts approved current-month broad consumers to Projection and follows the shared app version contract", () => {
  const app = read("src/App.jsx");
  const consumer = read("src/utils/currentStoreMonthReportsConsumer.js");
  assert.match(app, /current_store_month_reports_status/);
  assert.match(app, /current_store_month_reports/);
  assert.match(app, /CURRENT_STORE_MONTH_PROJECTION_VIEWS/);
  assert.match(consumer, /current-store-month-reports-readiness-v1/);
  assert.match(consumer, /READINESS_SIGNATURE_MISMATCH/);
  assert.match(app, CURRENT_APP_VERSION_SOURCE_PATTERN);
});

test("B1 delegates Store Identity to shared Lifecycle owner", () => {
  const index = read("functions/index.js");
  assert.match(index, /normalizeStoreCore: normalizeStoreLifecycleCore/);
  assert.match(index, /getCanonicalStoreName,/);
});
