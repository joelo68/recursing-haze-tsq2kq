import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("src/App.jsx", "utf8");
const firebase = fs.readFileSync("src/config/firebase.js", "utf8");
const runtime = fs.readFileSync("src/config/runtimeEnvironment.js", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const localFirebase = fs.readFileSync("firebase.activity-sales.local.json", "utf8");

const productionUrls = [
  ...app.matchAll(/https:\/\/[A-Za-z0-9.-]+(?:cloudfunctions\.net|a\.run\.app)\/?[A-Za-z0-9_/-]*/g),
].map((match) => match[0].replace(/\/+$/, ""));

test("Activity Sales development mode is hard-bound to a demo Firebase project", () => {
  assert.match(runtime, /DEMO_PROJECT_ID = "demo-drcyj-activity-sales"/);
  assert.match(runtime, /requestedProjectId\.startsWith\("demo-"\)/);
  assert.match(firebase, /connectAuthEmulator/);
  assert.match(firebase, /connectFirestoreEmulator/);
  assert.match(firebase, /ACTIVITY_SALES_DEV_MODE\s*\?\s*activitySalesDemoConfig/);
  assert.doesNotMatch(localFirebase, /cyjsituation-analysis/);
});

test("formal App endpoint source shape stays unchanged for existing regressions", () => {
  assert.match(
    app,
    /LOGIN_DIRECTORY_ENDPOINT\s*=\s*"https:\/\/us-central1-cyjsituation-analysis\.cloudfunctions\.net\/getApplicationLoginDirectory"/
  );
  assert.match(
    app,
    /THERAPIST_MASTER_ENDPOINT\s*=\s*"https:\/\/us-central1-cyjsituation-analysis\.cloudfunctions\.net\/manageTherapistMaster"/
  );
  assert.doesNotMatch(app, /resolveRuntimeFunctionEndpoint/);
});

test("every existing Production Function URL is covered by the dev-only network isolation map", () => {
  assert.ok(productionUrls.length >= 10);
  for (const url of new Set(productionUrls)) {
    assert.ok(
      runtime.includes(`"${url}"`),
      `missing Activity Sales isolation route for ${url}`
    );
  }
  assert.match(runtime, /resolveActivitySalesDevFunctionUrl/);
  assert.match(runtime, /__DRCYJ_ACTIVITY_SALES_FETCH_ISOLATED__/);
  assert.match(runtime, /Activity Sales DEV 阻止未登錄的 Production Function/);
});

test("Phase 0B does not bump the formal app version", () => {
  assert.match(app, /const CURRENT_APP_VERSION = "3\.6\.2";/);
});

test("Activity Sales package scripts use only the isolated workflow", () => {
  assert.match(pkg.scripts["activity:dev"], /VITE_ACTIVITY_SALES_DEV=true/);
  assert.match(pkg.scripts["activity:dev"], /demo-drcyj-activity-sales/);
  assert.match(pkg.scripts["activity:emulators"], /--project demo-drcyj-activity-sales/);
  assert.match(pkg.scripts["activity:emulators"], /firebase\.activity-sales\.local\.json/);
  assert.match(pkg.scripts["activity:build"], /dist-activity-sales-local/);
});

test("local development UI is visibly marked as non-production without changing App.jsx", () => {
  assert.match(runtime, /ACTIVITY SALES DEV · LOCAL DEMO · 不連正式資料/);
  assert.match(runtime, /activity-sales-dev-badge/);
});
