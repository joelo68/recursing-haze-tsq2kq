import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Target Coverage audit is System Exclusion aware and remains Summary-first/read-only", () => {
  const source = read("functions/targetCoverageAudit.js");
  assert.match(source, /normalizeStoredSystemExclusionProfile/);
  assert.match(source, /buildStoredSystemExclusionSnapshot/);
  assert.match(source, /isStoredSystemExclusionSnapshotCurrent/);
  assert.match(source, /systemExclusionRef\s*=\s*db\.doc\(paths\.systemExclusion\)/);
  assert.match(source, /systemExclusionSnap/);
  assert.match(source, /systemExclusionData/);
  assert.match(source, /systemExclusionCurrent/);
  assert.match(source, /lifecycleEligibleEntries\.filter/);
  assert.match(source, /!systemExclusionProfile\.storeSet\.has/);
  assert.match(source, /SYSTEM_EXCLUSION_SNAPSHOT_STALE/);
  assert.match(source, /systemExclusionReads:\s*1/);
  assert.match(source, /rawMonthlyTargetsReads:\s*0/);
  assert.match(source, /firestoreWrites:\s*0/);
  assert.doesNotMatch(source, /onSchedule/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test("Target Coverage migration repairs snapshot metadata atomically and triggers existing historical reconciliation", () => {
  const source = read("functions/targetCoverageMigration.js");
  const index = read("functions/index.js");
  assert.match(source, /'systemExclusionSnapshot'/);
  assert.match(source, /systemExclusionSnapshot:\s*coverage\.systemExclusionSnapshot/);
  assert.match(source, /const systemExclusionRef = db\.doc\(paths\.systemExclusion\)/);
  assert.match(source, /transaction\.get\(systemExclusionRef\)/);
  assert.match(source, /systemExclusionData/);
  assert.match(source, /markHistoricalSummariesDirtyForSystemExclusion/);
  assert.match(source, /reconciliationDerivedSummaryReads/);
  assert.match(source, /rawMonthlyTargetsReads:\s*0/);
  assert.doesNotMatch(source, /paths\.monthlyTargets/);
  assert.match(index, /createTargetCoverageMigrationFunctions\(\{[\s\S]*markHistoricalSummariesDirtyForSystemExclusion/);
  assert.match(index, /scanned:\s*summarySnap\.size/);
});

test("System Exclusion writer treats unchanged store sets as a no-op without revision churn", () => {
  const source = read("functions/systemExclusion.js");
  assert.match(source, /function systemExclusionStoresEqual/);
  assert.match(source, /if \(systemExclusionStoresEqual\(current\.stores, stores\)\)/);
  assert.match(source, /let changed = false/);
  assert.match(source, /changed = true/);
  assert.match(source, /res\.status\(200\)\.json\(\{ ok: true, changed, systemExclusion/);
  assert.doesNotMatch(source, /onSchedule/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test("App keeps System Exclusion as one brand-scoped live authority document and removes the old optional one-shot read", () => {
  const source = read("src/App.jsx");
  assert.match(source, /SYSTEM_EXCLUSION_ENDPOINT/);
  assert.match(source, /const exclusionRef = getDocPath\("audit_exclusions"\)/);
  assert.match(source, /onSnapshot\(\s*exclusionRef/);
  assert.match(source, /system_exclusion_authority_live/);
  assert.match(source, /setSystemExclusionState\(nextState\)/);
  assert.match(source, /setAuditExclusions\(nextState\.stores\)/);
  assert.doesNotMatch(source, /key:\s*"auditExclusions"/);
  assert.match(source, /fetchGlobalData_core_docs[\s\S]{0,220}9/);
  assert.doesNotMatch(source, /setInterval\([\s\S]{0,200}audit_exclusions/);
  assert.match(source, /CURRENT_APP_VERSION = "3\.5\.3"/);
});

test("Daily Analysis consumes formal System Exclusion scope and separates partial observed actuals from completeness", () => {
  const view = read("src/components/DailyView.jsx");
  const util = read("src/utils/dailyObservedTotals.js");
  assert.match(view, /systemExclusionState/);
  assert.match(view, /isSystemExclusionLoading/);
  assert.match(view, /systemExcludedStoreSet/);
  assert.match(view, /buildDailyObservedTotals\(list\)/);
  assert.match(view, /目前已回報累計/);
  assert.doesNotMatch(view, /cashComplete\s*=\s*dataComplete/);
  assert.doesNotMatch(view, /accrualComplete\s*=\s*dataComplete/);
  assert.match(util, /reportedRows = list\.filter/);
  assert.match(util, /cashObservedValid/);
  assert.match(util, /dataComplete/);
  assert.doesNotMatch(util, /firebase\/firestore|onSnapshot\s*\(|getDocs\s*\(|getDoc\s*\(/);
});

test("Target Coverage brand paths keep CYJ legacy and Anniu/Yibo brand isolation", () => {
  const source = read("functions/targetCoverage.js");
  assert.match(source, /normalizedBrandId === 'cyj'/);
  assert.match(source, /artifacts\/default-app-id\/public\/data/);
  assert.match(source, /brands\/\$\{normalizedBrandId\}/);
  assert.match(source, /global_settings\/audit_exclusions/);
  assert.match(source, /settings\/audit_exclusions/);
});
