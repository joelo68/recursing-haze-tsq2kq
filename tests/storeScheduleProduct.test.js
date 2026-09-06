import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCanonicalLifecycleStoreName,
  getStoreScheduleEventId,
  normalizeStoreLifecycleCore,
} from "../src/utils/storeLifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const constants = read("src/constants/index.js");
const navigation = read("src/components/Navigation.jsx");
const app = read("src/App.jsx");
const settings = read("src/components/SettingsView.jsx");
const storeSchedule = read("src/components/StoreScheduleView.jsx");
const smartCalendar = read("src/components/SmartCalendar.jsx");
const backend = read("functions/storeLifecycle.js");
const modulePermissions = read("functions/modulePermissions.js");
const deviceApproval = read("functions/deviceApproval.js");
const functionsIndex = read("functions/index.js");
const rules = read("firestore.rules");

test("店家排休 is a first-class permission-controlled left-nav module", () => {
  assert.match(constants, /\{\s*id:\s*"store-schedule",\s*label:\s*"店家排休",\s*icon:\s*Store\s*\}/);
  assert.match(navigation, /permissions\?\.\[userRole\][\s\S]*includes\(item\.id\)/);
  assert.match(app, /const StoreScheduleView = lazyWithRetry/);
  assert.match(app, /activeView === "store-schedule"[\s\S]*<StoreScheduleView/);
  assert.match(app, /canAccessStoreScheduleView/);
});

test("module permission writes move behind a highest-admin backend authority", () => {
  assert.doesNotMatch(settings, /setDoc\(getDocPath\("permissions"\),\s*localPermissions\)/);
  assert.match(settings, /updateModulePermissions\(localPermissions\)/);
  assert.match(app, /MODULE_PERMISSIONS_ENDPOINT/);
  assert.match(app, /expectedRevision:\s*Math\.max\(0,\s*Number\(permissions\?\.revision/);

  assert.match(modulePermissions, /verifySuperAdminActor/);
  assert.match(modulePermissions, /db\.runTransaction/);
  assert.match(modulePermissions, /MODULE_PERMISSIONS_CONFLICT/);
  assert.match(modulePermissions, /maintenance_logs/);
  assert.match(functionsIndex, /exports\.manageModulePermissions = modulePermissionsFunctions\.manageModulePermissions/);
});

test("Firestore rules deny direct client writes to permissions on all brand paths", () => {
  assert.match(rules, /settingId != 'permissions'/);
  assert.match(rules, /match \/brands\/\{brandId\}\/settings\/permissions[\s\S]*allow write:\s*if false/);
  assert.match(rules, /!\(collectionName == 'settings' && document == 'permissions'\)/);
});

test("store schedule actor verification requires trusted device plus application credential", () => {
  assert.match(deviceApproval, /async function verifyTrustedApplicationActor/);
  assert.match(deviceApproval, /verifyTrustedApproverDevice/);
  assert.match(deviceApproval, /verifyApplicationCredential/);
  assert.match(deviceApproval, /stores:\s*Array\.isArray\(account\.stores\)/);
  assert.match(deviceApproval, /verifyTrustedApplicationActor,/);
  assert.match(backend, /allowedRoles:\s*\['manager', 'store'\]/);
});

test("store schedule backend separates module visibility from authoritative store scope", () => {
  assert.match(backend, /rolePermissions\.includes\('store-schedule'\)/);
  assert.match(backend, /getBrandSettingDoc\(db, brandId, 'org_structure'\)/);
  assert.match(backend, /actorCheck\.credential\?\.stores/);
  assert.match(backend, /allowedStoreKeys\.includes\(storeKey\)/);
  assert.match(backend, /code = 'STORE_SCHEDULE_SCOPE_DENIED'/);
  assert.match(backend, /explicitStoreBrand && explicitStoreBrand !== brandId/);
});

test("store schedule uses deterministic Store Identity and preserves CYJ 新店", () => {
  assert.equal(normalizeStoreLifecycleCore("CYJ新店店"), "新店");
  assert.equal(getCanonicalLifecycleStoreName("新店", "cyj"), "CYJ新店店");
  assert.equal(getStoreScheduleEventId("CYJ新店店", "2026-09"), "store-schedule-v1:新店:2026-09");
  assert.match(storeSchedule, /normalizeStoreLifecycleCore/);
  assert.doesNotMatch(storeSchedule, /\.replace\(\/店\$\/[gimy]*,/);
});

test("store schedule only edits future days and leaves today/history to highest-admin authority", () => {
  assert.match(backend, /yearMonth < today\.slice\(0, 7\)/);
  assert.match(backend, /date <= normalizedToday/);
  assert.match(backend, /getLifecycleExpectedReportDates\(lifecycleEntry, yearMonth, \{ closedDates: \[\] \}\)/);
  assert.doesNotMatch(backend, /getBrandCollection\(db, brandId, ['\"]daily_reports['\"]\)/);
  assert.match(backend, /今天與歷史修正請由最高管理者處理/);
});

test("store schedule writes only Reporting Calendar authority and keeps Lifecycle master revision separate", () => {
  const match = backend.match(/if \(action === 'update_store_schedule_v1'\) \{([\s\S]*?)if \(action === 'update_reporting_calendar'/);
  assert.ok(match, "store schedule action block must exist");
  const block = match[1];
  assert.match(block, /reportingCalendar/);
  assert.match(block, /nextMonthRevisions\[yearMonth\]/);
  assert.doesNotMatch(block, /nextMasterRevision/);
  assert.doesNotMatch(block, /monthly_aggregated/);
  assert.doesNotMatch(block, /annual_kpi_summary/);
  assert.doesNotMatch(block, /transaction\.set\([^;\n]*daily_reports/);
});

test("store schedule frontend is one-point-read and has no listener polling or Raw write", () => {
  assert.match(storeSchedule, /getDoc\(doc\(getCollectionPath\("store_lifecycle"\), "master"\)\)/);
  assert.doesNotMatch(storeSchedule, /onSnapshot\s*\(/);
  assert.doesNotMatch(storeSchedule, /setInterval\s*\(/);
  assert.doesNotMatch(storeSchedule, /getDocs\s*\(/);
  assert.doesNotMatch(storeSchedule, /setDoc\s*\(/);
  assert.doesNotMatch(storeSchedule, /getCollectionPath\("daily_reports"\)|collection\([^\n]*daily_reports|doc\([^\n]*daily_reports/);
  assert.match(storeSchedule, /updateStoreSchedule/);
});

test("店家排休 reuses SmartCalendar as an additive multi-select schedule surface", () => {
  assert.match(storeSchedule, /<SmartCalendar/);
  assert.match(storeSchedule, /\bmultiSelect\b/);
  assert.match(storeSchedule, /disabledDates=\{lockedDates\}/);
  assert.match(storeSchedule, /minDate=\{firstEditableDate\}/);
  assert.doesNotMatch(storeSchedule, /type="date"/);

  assert.match(smartCalendar, /multiSelect = false/);
  assert.match(smartCalendar, /selectedDates = \[\]/);
  assert.match(smartCalendar, /disabledDates = \[\]/);
  assert.match(smartCalendar, /onDateToggle/);
  assert.match(smartCalendar, /onDateSelect\?\.\(newDate\)/);
});

test("permissions rollout is fail-closed for existing role documents until highest admin enables the module", () => {
  assert.doesNotMatch(constants, /trainer:\s*\[[^\]]*"store-schedule"/);
  assert.doesNotMatch(constants, /manager:\s*\[[^\]]*"store-schedule"/);
  assert.doesNotMatch(constants, /store:\s*\[[^\]]*"store-schedule"/);
  assert.doesNotMatch(constants, /therapist:\s*\[[^\]]*"store-schedule"/);
  assert.match(app, /permissions\[userRole\]\.includes\("store-schedule"\)/);
});
