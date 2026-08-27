import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCanonicalLifecycleStoreName,
  getLifecycleEntryCompleteness,
  getStoreLifecycleKey,
  lifecycleStoreBrandMatches,
  normalizeLifecycleMaster,
  validateLifecycleEntryDraft,
} from "../src/utils/storeLifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const backend = read("functions/storeLifecycle.js");
const functionsIndex = read("functions/index.js");
const deviceApproval = read("functions/deviceApproval.js");
const rules = read("firestore.rules");
const settings = read("src/components/SettingsView.jsx");
const manager = read("src/components/StoreLifecycleManager.jsx");

test("Store Lifecycle identity preserves CYJ 新店 canonical contract", () => {
  for (const alias of ["新店", "CYJ新店", "CYJ新店店", "DRCYJ新店", "DRCYJ新店店", "新"]) {
    assert.equal(getStoreLifecycleKey(alias), "新店");
    assert.equal(getCanonicalLifecycleStoreName(alias, "cyj"), "CYJ新店店");
  }
});

test("explicit store brand prefixes cannot cross-write into another current brand", () => {
  assert.equal(lifecycleStoreBrandMatches("安妞中山店", "cyj"), false);
  assert.equal(lifecycleStoreBrandMatches("CYJ中山店", "anniu"), false);
  assert.equal(lifecycleStoreBrandMatches("中山", "anniu"), true);
  assert.match(backend, /explicitStoreBrand && explicitStoreBrand !== brandId/);
  assert.match(backend, /code: 'BRAND_MISMATCH'/);
});

test("same core store remains brand-isolated by physical master and canonical label", () => {
  assert.equal(getCanonicalLifecycleStoreName("新店", "cyj"), "CYJ新店店");
  assert.equal(getCanonicalLifecycleStoreName("新店", "anniu"), "安妞新店店");
  assert.equal(getCanonicalLifecycleStoreName("新店", "yibo"), "伊啵新店店");
  assert.match(backend, /getBrandCollection\(db, brandId, 'store_lifecycle'\)\.doc\('master'\)/);
});

test("draft validation preserves incomplete drafts but rejects contradictory dates", () => {
  const incomplete = validateLifecycleEntryDraft({ firstEligibleMonth: "2026-08" });
  assert.equal(incomplete.valid, true);
  assert.equal(getLifecycleEntryCompleteness(incomplete.normalized), "INCOMPLETE");

  const complete = validateLifecycleEntryDraft({
    firstEligibleMonth: "2026-08",
    openDate: "2026-08-12",
    lastEligibleMonth: "2026-10",
    closeDate: "2026-10-31",
    exemptMonths: ["2026-09"],
  });
  assert.equal(complete.valid, true);
  assert.equal(getLifecycleEntryCompleteness(complete.normalized), "COMPLETE");

  const invalid = validateLifecycleEntryDraft({
    firstEligibleMonth: "2026-08",
    openDate: "2026-07-31",
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("|"), /開始日期必須落在納入月份內/);
});

test("invalid exemption values are rejected instead of silently dropped", () => {
  const invalidList = validateLifecycleEntryDraft({
    firstEligibleMonth: "2026-01",
    openDate: "2026-01-01",
    exemptMonths: ["2026-13"],
  });
  assert.equal(invalidList.valid, false);
  assert.match(invalidList.errors.join("|"), /暫停營運月份格式需為 YYYY-MM/);

  const invalidType = validateLifecycleEntryDraft({
    firstEligibleMonth: "2026-01",
    openDate: "2026-01-01",
    exemptMonths: "2026-02",
  });
  assert.equal(invalidType.valid, false);
});

test("opening and permanent closing months cannot also be full-month exemptions", () => {
  const openingConflict = validateLifecycleEntryDraft({
    firstEligibleMonth: "2026-08",
    openDate: "2026-08-01",
    exemptMonths: ["2026-08"],
  });
  assert.equal(openingConflict.valid, false);

  const closingConflict = validateLifecycleEntryDraft({
    firstEligibleMonth: "2026-01",
    openDate: "2026-01-01",
    lastEligibleMonth: "2026-08",
    closeDate: "2026-08-20",
    exemptMonths: ["2026-08"],
  });
  assert.equal(closingConflict.valid, false);
});

test("master normalization is defensive and does not coerce missing lifecycle fields to performance zero", () => {
  const normalized = normalizeLifecycleMaster({
    revision: "2",
    stores: {
      "CYJ新店": { firstEligibleMonth: "", openDate: "", exemptMonths: null },
    },
  }, "cyj");
  assert.equal(normalized.revision, 2);
  assert.equal(normalized.stores["新店"].firstEligibleMonth, "");
  assert.equal(normalized.stores["新店"].openDate, "");
  assert.deepEqual(normalized.stores["新店"].exemptMonths, []);
  assert.equal(normalized.stores["新店"].entryStatus, "INCOMPLETE");
});

test("backend rejects unknown brand ids instead of silently falling back to CYJ", () => {
  assert.match(backend, /function resolveRequestedBrandId/);
  assert.match(backend, /if \(!requestedBrandId\) return res\.status\(400\)/);
});

test("backend writer requires Firebase auth plus existing trusted super-admin re-verification", () => {
  assert.match(backend, /requireFirebaseRequestAuth\(req, admin\)/);
  assert.match(backend, /verifySuperAdminActor\(\{ db, brandId, actor \}\)/);
  assert.match(deviceApproval, /requireFirebaseRequestAuth,/);
  assert.match(deviceApproval, /verifySuperAdminActor,/);
});

test("Lifecycle Master and maintenance audit are committed in the same transaction", () => {
  assert.match(backend, /const auditRef = getBrandCollection\(db, brandId, 'maintenance_logs'\)\.doc\(\)/);
  assert.match(backend, /transaction\.set\(auditRef, buildLifecycleAuditPayload/);
  assert.doesNotMatch(backend, /await writeLifecycleAudit/);
});

test("backend uses transaction and per-store revision conflict guard", () => {
  assert.match(backend, /db\.runTransaction/);
  assert.match(backend, /expectedStoreRevision/);
  assert.match(backend, /currentRevision !== expectedStoreRevision/);
  assert.match(backend, /LIFECYCLE_CONFLICT/);
  assert.match(backend, /revision: Math\.max\(0, Number\(previous\.revision \|\| 0\)\) \+ 1/);
});

test("READY certification validates current org coverage and complete lifecycle entries", () => {
  assert.match(backend, /getBrandSettingDoc\(db, brandId, 'org_structure'\)/);
  assert.match(backend, /buildReadyValidation/);
  assert.match(backend, /check\.entryStatus !== 'COMPLETE'/);
  assert.match(backend, /missingCurrentStores/);
  assert.match(backend, /LIFECYCLE_NOT_READY/);
});

test("Batch 1 backend cannot mutate existing KPI, raw, target, summary or queue collections", () => {
  for (const forbidden of [
    "daily_reports",
    "therapist_daily_reports",
    "monthly_aggregated",
    "therapist_monthly_aggregated",
    "monthly_targets",
    "monthly_targets_summary",
    "therapist_targets",
    "dashboard_summary",
    "rankings_summary",
    "annual_kpi_summary",
    "therapist_summary",
    "summary_recalc_flags",
    "recalc_queue",
    "org_structure_snapshots",
    "store_account_data",
    "auditExclusions",
  ]) {
    assert.doesNotMatch(backend, new RegExp(`getBrandCollection\\(db, brandId, ['\"]${forbidden}['\"]\\)`));
  }
});

test("Firestore rules make Store Lifecycle frontend-read-only on both physical roots", () => {
  assert.match(rules, /match \/brands\/\{brandId\}\/store_lifecycle\/\{document=\*\*\}[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow write: if false;/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/store_lifecycle\/\{document=\*\*\}[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow write: if false;/);
  const exclusionCount = (rules.match(/collectionName != 'store_lifecycle'/g) || []).length;
  assert.equal(exclusionCount, 2);
});

test("Lifecycle UI is isolated by an error boundary so a local render error does not blank Settings", () => {
  assert.match(manager, /class StoreLifecycleErrorBoundary extends React\.Component/);
  assert.match(manager, /static getDerivedStateFromError/);
  assert.match(manager, /其他系統設定與營運資料不受影響/);
});

test("frontend ignores stale Lifecycle reads after a brand switch", () => {
  assert.match(manager, /loadSequenceRef = useRef\(0\)/);
  assert.match(manager, /activeBrandRef = useRef\(brandId\)/);
  assert.match(manager, /requestId !== loadSequenceRef\.current \|\| activeBrandRef\.current !== brandId/);
});

test("Settings Lifecycle UI is view-loaded and does not add polling or persistent Firestore listeners", () => {
  assert.match(settings, /id: "store-lifecycle"/);
  assert.match(settings, /<StoreLifecycleManager/);
  assert.match(manager, /getDoc\(doc\(getCollectionPath\("store_lifecycle"\), "master"\)\)/);
  assert.doesNotMatch(manager, /onSnapshot\s*\(/);
  assert.doesNotMatch(manager, /setInterval\s*\(/);
  assert.doesNotMatch(manager, /getDocs\s*\(/);
});

test("Functions index exports only the new lifecycle endpoint without changing app version", () => {
  assert.match(functionsIndex, /createStoreLifecycleFunctions/);
  assert.match(functionsIndex, /exports\.manageStoreLifecycle = storeLifecycleFunctions\.manageStoreLifecycle/);
});
