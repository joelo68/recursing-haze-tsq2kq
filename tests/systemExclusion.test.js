import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  SYSTEM_EXCLUSION_VERSION,
  normalizeSystemExclusionStoreKey,
  normalizeSystemExclusionState,
  isSystemExclusionSnapshotCurrent,
  inspectHistoricalSystemExclusionTrust,
} from "../src/utils/systemExclusion.js";

const require = createRequire(import.meta.url);
const targetCoverage = require("../functions/targetCoverage.js");
const systemExclusionBackend = require("../functions/systemExclusion.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("System Exclusion identity normalizes CYJ 新店 aliases and deduplicates stored state", () => {
  assert.equal(normalizeSystemExclusionStoreKey("CYJ新店"), "新店");
  assert.equal(normalizeSystemExclusionStoreKey("DRCYJ新店店"), "新店");
  const state = normalizeSystemExclusionState({ revision: 7, stores: ["CYJ新店", "CYJ新店店", "板橋店", "板橋"] }, "cyj", { ready: true });
  assert.equal(state.ready, true);
  assert.equal(state.revision, 7);
  assert.deepEqual(state.stores, ["新店", "板橋"].sort((a, b) => a.localeCompare(b, "zh-Hant")));
});

test("System Exclusion historical/coverage snapshot trust is exact revision and brand, with safe empty legacy compatibility only", () => {
  const current = { ready: true, brandId: "cyj", revision: 4, stores: ["B"] };
  assert.equal(isSystemExclusionSnapshotCurrent({ snapshot: { version: SYSTEM_EXCLUSION_VERSION, brandId: "cyj", revision: 4, stores: ["B"] }, currentState: current, brandId: "cyj" }), true);
  assert.equal(isSystemExclusionSnapshotCurrent({ snapshot: { version: SYSTEM_EXCLUSION_VERSION, brandId: "cyj", revision: 4 }, currentState: current, brandId: "cyj" }), false);
  assert.equal(isSystemExclusionSnapshotCurrent({ snapshot: { version: SYSTEM_EXCLUSION_VERSION, brandId: "cyj", revision: 3 }, currentState: current, brandId: "cyj" }), false);
  assert.equal(isSystemExclusionSnapshotCurrent({ snapshot: null, currentState: current, brandId: "cyj" }), false);
  assert.equal(isSystemExclusionSnapshotCurrent({ snapshot: null, currentState: { ready: true, brandId: "cyj", revision: 0, stores: [] }, brandId: "cyj" }), true);
});

test("historical Summary trust rejects stale dashboard/rankings or flag snapshots", () => {
  const currentState = { ready: true, brandId: "cyj", revision: 4, stores: ["B"] };
  const currentSnapshot = { version: SYSTEM_EXCLUSION_VERSION, brandId: "cyj", revision: 4, stores: ["B"] };
  const staleSnapshot = { ...currentSnapshot, revision: 3, stores: [] };

  assert.deepEqual(inspectHistoricalSystemExclusionTrust({
    currentState,
    brandId: "cyj",
    summaries: [{ systemExclusionSnapshot: currentSnapshot }, { systemExclusionSnapshot: currentSnapshot }],
    summaryFlag: { systemExclusionSnapshot: currentSnapshot },
  }), { trusted: true, reason: "SYSTEM_EXCLUSION_REVISION_CURRENT" });

  assert.equal(inspectHistoricalSystemExclusionTrust({
    currentState,
    brandId: "cyj",
    summaries: [{ systemExclusionSnapshot: staleSnapshot }],
    summaryFlag: { systemExclusionSnapshot: currentSnapshot },
  }).reason, "SYSTEM_EXCLUSION_SUMMARY_REVISION_MISMATCH");

  assert.equal(inspectHistoricalSystemExclusionTrust({
    currentState,
    brandId: "cyj",
    summaries: [{ systemExclusionSnapshot: currentSnapshot }],
    summaryFlag: { systemExclusionSnapshot: staleSnapshot },
  }).reason, "SYSTEM_EXCLUSION_FLAG_REVISION_MISMATCH");
});

test("Target Coverage filters Lifecycle eligible cohort by System Exclusion without scanning targets", () => {
  const rows = [{ storeKey: "A" }, { storeKey: "B" }];
  const filtered = targetCoverage.filterLifecycleEntriesBySystemExclusion(rows, { revision: 1, stores: ["B"] }, "cyj", (value) => String(value || ""));
  assert.deepEqual(filtered.map((row) => row.storeKey), ["A"]);
});

test("System Exclusion OCC requires an explicit non-negative integer revision", () => {
  assert.equal(systemExclusionBackend.parseExpectedSystemExclusionRevision(0), 0);
  assert.equal(systemExclusionBackend.parseExpectedSystemExclusionRevision(7), 7);
  assert.throws(() => systemExclusionBackend.parseExpectedSystemExclusionRevision(undefined), /版本/);
  assert.throws(() => systemExclusionBackend.parseExpectedSystemExclusionRevision(-1), /版本/);
  assert.throws(() => systemExclusionBackend.parseExpectedSystemExclusionRevision(1.5), /版本/);
});

test("Backend System Exclusion writer is highest-admin, Trusted Device/credential protected and revision OCC", () => {
  const source = read("functions/systemExclusion.js");
  assert.match(source, /requireFirebaseRequestAuth/);
  assert.match(source, /verifySuperAdminActor/);
  assert.match(source, /expectedRevision/);
  assert.match(source, /db\.runTransaction/);
  assert.match(source, /SYSTEM_EXCLUSION_CONFLICT/);
  assert.match(source, /getBrandSettingDoc\(db, brandId, 'audit_exclusions'\)/);
  assert.doesNotMatch(source, /onSchedule/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test("Frontend no longer direct-writes audit_exclusions and handles revision conflict without extra query", () => {
  const app = read("src/App.jsx");
  assert.match(app, /SYSTEM_EXCLUSION_ENDPOINT/);
  assert.match(app, /manageSystemExclusions/);
  assert.match(app, /expectedRevision/);
  assert.match(app, /currentSystemExclusion/);
  assert.doesNotMatch(app, /setDoc\(auditExclusionsDoc/);
  assert.doesNotMatch(app, /getDocs\([^\n]*audit_exclusions/);
  assert.match(app, /CURRENT_APP_VERSION = "3\.5\.3"/);
});

test("Firestore Rules close both brand and legacy browser write paths for audit_exclusions", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /match \/brands\/\{brandId\}\/settings\/audit_exclusions/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/global_settings\/audit_exclusions/);
  assert.match(rules, /settingId != 'audit_exclusions'/);
  assert.match(rules, /collectionName == 'settings' && document == 'audit_exclusions'/);
});

test("Target Coverage carries System Exclusion snapshot and uses event-driven low-frequency refresh", () => {
  const source = read("functions/targetCoverage.js");
  assert.match(source, /systemExclusionSnapshot/);
  assert.match(source, /getSystemExclusionRef/);
  assert.match(source, /refreshTargetCoverageForSystemExclusion/);
  assert.match(source, /monthly_targets_summary'\)\.get\(\)/);
  assert.doesNotMatch(source, /onSchedule/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test("Functions index exports only explicit System Exclusion authority/event surfaces", () => {
  const source = read("functions/index.js");
  assert.match(source, /exports\.manageSystemExclusions/);
  assert.match(source, /exports\.onLegacySystemExclusionChange/);
  assert.match(source, /exports\.onBrandSystemExclusionChange/);
});

test("System Exclusion event dirties historical Summary and rebuild persists revision snapshots", () => {
  const eventSource = read("functions/systemExclusion.js");
  const indexSource = read("functions/index.js");
  assert.match(eventSource, /markHistoricalSummariesDirtyForSystemExclusion/);
  assert.match(eventSource, /Promise\.all\(tasks\)/);
  assert.match(indexSource, /dashboard_summary"\)\.get\(\)/);
  assert.match(indexSource, /dirtyReason: "system_exclusion_revision_changed"/);
  assert.match(indexSource, /systemExclusionSnapshot/);
  assert.match(indexSource, /Dashboard System Exclusion Snapshot/);
  assert.match(indexSource, /Rankings System Exclusion Snapshot/);
  assert.match(indexSource, /systemExclusionRevision/);
});
