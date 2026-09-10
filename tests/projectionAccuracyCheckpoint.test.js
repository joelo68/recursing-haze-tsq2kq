import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const accuracy = require("../functions/projectionAccuracy.js");
const projectionConsumer = require("../functions/telegram/projectionConsumer.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("B1 schedule uses yesterday in Taipei and only captures approved cutoff days", () => {
  const day5 = accuracy.resolveScheduledCheckpoint(new Date("2026-09-05T23:10:00.000Z"));
  assert.equal(day5.taipeiToday, "2026-09-06");
  assert.equal(day5.cutoffDate, "2026-09-05");
  assert.equal(day5.checkpointKey, "day05");
  assert.equal(day5.isCheckpoint, true);

  const day9 = accuracy.resolveScheduledCheckpoint(new Date("2026-09-09T23:10:00.000Z"));
  assert.equal(day9.cutoffDate, "2026-09-09");
  assert.equal(day9.isCheckpoint, false);

  assert.deepEqual([...accuracy.PROJECTION_ACCURACY_CHECKPOINT_DAYS], [5, 7, 10, 15, 20, 25]);
  assert.equal(accuracy.PROJECTION_ACCURACY_SCHEDULE, "10 7 * * *");
  assert.equal(accuracy.PROJECTION_ACCURACY_TIME_ZONE, "Asia/Taipei");
});

test("B1 cutoff completeness respects formal scope, lifecycle day, archived duplicate and active duplicate", () => {
  const authority = {
    scopeReady: true,
    scopeReason: "READY",
    formalScopeStoreSet: new Set(["A", "B", "X"]),
    lifecycleEntryMap: new Map([
      ["A", { expected: true }],
      ["B", { expected: true }],
      ["X", { expected: false }],
    ]),
  };
  const normalize = (value) => String(value || "").trim();
  const expected = (entry) => entry.expected === true;

  const complete = accuracy.buildCutoffDayCompleteness({
    authority,
    cutoffDate: "2026-09-10",
    normalizeStoreKey: normalize,
    isExpectedForDate: expected,
    rows: [
      { storeName: "A", date: "2026-09-10" },
      { storeName: "B", date: "2026-09-10" },
      { storeName: "X", date: "2026-09-10" },
      { storeName: "Z", date: "2026-09-10" },
      { storeName: "A", date: "2026-09-10", isArchivedDuplicate: true },
    ],
  });
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.expectedStores, ["A", "B"]);
  assert.deepEqual(complete.unexpectedReportedStores, ["X", "Z"]);
  assert.equal(complete.archivedDuplicateCount, 1);

  const duplicate = accuracy.buildCutoffDayCompleteness({
    authority,
    cutoffDate: "2026-09-10",
    normalizeStoreKey: normalize,
    isExpectedForDate: expected,
    rows: [
      { storeName: "A", date: "2026-09-10" },
      { storeName: "A", date: "2026-09-10" },
      { storeName: "B", date: "2026-09-10" },
    ],
  });
  assert.equal(duplicate.complete, false);
  assert.deepEqual(duplicate.duplicateStores, ["A"]);
});

test("B1 shadow V1 reuses exact aggregate parity basis and disables only phase", () => {
  const mkRow = (current, remaining, phaseMultiplier = 0.8) => ({
    projectionModelTrust: { trusted: true, reason: "TRUSTED" },
    projectionRange: {
      profile: { currentWeight: 0.5, historyWeight: 0.5, label: "test" },
      // aggregateTelegramProjectionRows validates public ranges before aggregationBasis.
      // Real getStorePerformance rows carry them; V1.1 fixture accidentally omitted them.
      cash: {
        conservative: current + remaining - 10,
        standard: current + remaining,
        aggressive: current + remaining + 10,
        min: current + remaining - 10,
        max: current + remaining + 10,
      },
      accrual: {
        conservative: (current / 2) + (remaining / 2) - 5,
        standard: (current / 2) + (remaining / 2),
        aggressive: (current / 2) + (remaining / 2) + 5,
        min: (current / 2) + (remaining / 2) - 5,
        max: (current / 2) + (remaining / 2) + 5,
      },
      aggregationBasis: {
        cash: {
          currentTotal: current,
          remainingConservative: remaining - 10,
          remainingStandard: remaining,
          remainingAggressive: remaining + 10,
          phaseScopeEligible: true,
          phaseApplied: true,
          phaseMultiplier,
        },
        accrual: {
          currentTotal: current / 2,
          remainingConservative: remaining / 2 - 5,
          remainingStandard: remaining / 2,
          remainingAggressive: remaining / 2 + 5,
          phaseScopeEligible: true,
          phaseApplied: true,
          phaseMultiplier,
        },
      },
    },
  });

  const rows = [mkRow(100, 80), mkRow(200, 120)];
  const shadow = accuracy.buildShadowV1Aggregate(rows);
  assert.equal(shadow.ready, true);

  const manualRows = rows.map((row) => ({
    ...row,
    projectionRange: {
      ...row.projectionRange,
      aggregationBasis: {
        cash: { ...row.projectionRange.aggregationBasis.cash, phaseApplied: false, phaseMultiplier: 1 },
        accrual: { ...row.projectionRange.aggregationBasis.accrual, phaseApplied: false, phaseMultiplier: 1 },
      },
    },
  }));
  const expected = projectionConsumer.aggregateTelegramProjectionRows(manualRows);
  assert.deepEqual(shadow.cash, expected.cash);
  assert.deepEqual(shadow.accrual, expected.accrual);
  assert.equal(shadow.cash.standard, 500);
});

test("B1 eligibility scores effective production fallback too; model trust is metadata, not a score prerequisite", () => {
  const eligible = accuracy.buildScoreEligibility({
    metric: "cash",
    completeness: { complete: true },
    actualStatus: "VALID",
    actualValue: 123,
    effectiveRange: { conservative: 200, standard: 220, aggressive: 240 },
    shadowRange: { conservative: 210, standard: 230, aggressive: 250 },
    naiveValue: 225,
    shadowReady: true,
  });
  assert.equal(eligible.eligible, true);

  const incomplete = accuracy.buildScoreEligibility({
    metric: "cash",
    completeness: { complete: false },
    actualStatus: "VALID",
    actualValue: 123,
    effectiveRange: { conservative: 200, standard: 220, aggressive: 240 },
    shadowRange: { conservative: 210, standard: 230, aggressive: 250 },
    naiveValue: 225,
    shadowReady: true,
  });
  assert.equal(incomplete.eligible, false);
  assert.ok(incomplete.reasons.includes("CUTOFF_DAY_INCOMPLETE"));
});

test("B1 persistence is transaction first-writer-wins and retry cannot overwrite captured evidence", async () => {
  let stored = null;
  const fakeRef = { path: "brands/anniu/projection_accuracy/2026-09" };
  const fakeAdmin = {
    firestore: {
      FieldValue: {
        serverTimestamp: () => "__SERVER_TIMESTAMP__",
      },
    },
  };
  const fakeDb = {
    async runTransaction(callback) {
      const tx = {
        async get() {
          return {
            exists: stored != null,
            data: () => stored,
          };
        },
        set(_ref, patch) {
          stored = {
            ...(stored || {}),
            ...patch,
            checkpoints: {
              ...((stored || {}).checkpoints || {}),
              ...(patch.checkpoints || {}),
            },
          };
        },
      };
      return callback(tx);
    },
  };

  const first = await accuracy.persistCheckpointFirstWriterWins({
    db: fakeDb,
    admin: fakeAdmin,
    monthlyRef: fakeRef,
    brandId: "anniu",
    yearMonth: "2026-09",
    checkpointKey: "day10",
    checkpoint: { effective: { cash: { standard: 100 } } },
    capturedAtText: "2026-09-11T00:10:00.000Z",
  });
  assert.equal(first.written, true);

  const second = await accuracy.persistCheckpointFirstWriterWins({
    db: fakeDb,
    admin: fakeAdmin,
    monthlyRef: fakeRef,
    brandId: "anniu",
    yearMonth: "2026-09",
    checkpointKey: "day10",
    checkpoint: { effective: { cash: { standard: 999 } } },
    capturedAtText: "2026-09-11T00:11:00.000Z",
  });
  assert.equal(second.written, false);
  assert.equal(stored.checkpoints.day10.effective.cash.standard, 100);
});


test("B2A verified final actual authority requires trusted Summary flag, complete reporting and formal KPI", () => {
  const summary = {
    version: "dashboard-summary-v2",
    semanticVersion: "summary-semantics-v1",
    kpiContractVersion: "kpi-contract-v1",
    brandId: "anniu",
    yearMonth: "2026-09",
    lifecycleSnapshot: {
      schemaVersion: "store-lifecycle-v1",
      datasetStatus: "READY",
      revision: 7,
      eligibleStoreCount: 17,
    },
    systemExclusionSnapshot: {
      version: "system-exclusion-v1",
      brandId: "anniu",
      revision: 2,
      stores: [],
    },
    reportingCompleteness: {
      schemaVersion: "reporting-completeness-v1",
      reportingStatus: "DATA_COMPLETE",
      expectedStoreDayCount: 510,
      submittedStoreDayCount: 510,
      missingStoreDayCount: 0,
      reportingCalendarMasterRevision: 4,
      reportingCalendarRevision: 3,
      storeClosedReportDayCount: 0,
    },
    grandTotal: {
      formalNetCash: 1000,
      formalNetCashStatus: "VALID",
      formalAccrual: 1200,
      formalAccrualStatus: "VALID",
    },
  };
  const flag = {
    status: "verified",
    dirty: false,
    lastMismatchCount: 0,
    reportingCalendarRevision: 3,
    requiredReportingCalendarRevision: 3,
    systemExclusionRevision: 2,
  };

  const trusted = accuracy.inspectVerifiedFinalActualAuthority({
    brandId: "anniu",
    yearMonth: "2026-09",
    summaryData: summary,
    summaryFlag: flag,
  });
  assert.equal(trusted.trusted, true);
  assert.equal(trusted.actual.cash.value, 1000);
  assert.equal(trusted.actual.accrual.value, 1200);

  const dirty = accuracy.inspectVerifiedFinalActualAuthority({
    brandId: "anniu",
    yearMonth: "2026-09",
    summaryData: summary,
    summaryFlag: { ...flag, dirty: true },
  });
  assert.equal(dirty.trusted, false);
  assert.equal(dirty.reason, "SUMMARY_FLAG_DIRTY");

  const calendarRace = accuracy.inspectVerifiedFinalActualAuthority({
    brandId: "anniu",
    yearMonth: "2026-09",
    summaryData: summary,
    summaryFlag: { ...flag, requiredReportingCalendarRevision: 4 },
  });
  assert.equal(calendarRace.trusted, false);
  assert.equal(calendarRace.reason, "REPORTING_CALENDAR_REVISION_MISMATCH");
});

test("B2A month-final scoring preserves method semantics and labels V2-applied subset from captured runtime phase", () => {
  const checkpoint = {
    cutoffDate: "2026-09-10",
    cutoffDay: 10,
    capturedAtText: "2026-09-11T00:10:00.000Z",
    scoreEligibility: {
      cash: { eligible: true, reasons: [] },
      accrual: { eligible: true, reasons: [] },
    },
    effective: {
      cash: { standard: 900 },
      accrual: { standard: 1200 },
    },
    shadowV1: {
      ready: true,
      cash: { standard: 800 },
      accrual: { standard: 1000 },
    },
    naiveCurrentPace: {
      cash: 950,
      accrual: 1100,
    },
    model: {
      strategyVersion: "projection-strategy-v2-phase-calibrated",
      runtimePhase: {
        cash: { phaseApplied: true },
        accrual: { phaseApplied: false },
      },
    },
  };

  const scorecard = accuracy.buildMonthFinalScorecard({
    checkpoints: { day10: checkpoint },
    finalActual: {
      cash: { value: 1000, status: "VALID" },
      accrual: { value: 1250, status: "VALID" },
    },
  });

  assert.equal(scorecard.byCheckpoint.day10.cash.effective.score.error, -100);
  assert.equal(scorecard.byCheckpoint.day10.cash.effective.score.apePct, 10);
  assert.equal(scorecard.byCheckpoint.day10.cash.effective.score.biasPct, -10);
  assert.equal(scorecard.overall.cash.effective.count, 1);
  assert.equal(scorecard.overall.cash.effectiveV2AppliedOnly.count, 1);
  assert.equal(scorecard.overall.accrual.effectiveV2AppliedOnly.count, 0);
  assert.equal(scorecard.overall.cash.currentPace.wapePct, 5);
});

test("B2A scoring transaction is idempotent, never rewrites checkpoints, and rescoring increments only when trusted actual authority changes", async () => {
  const monthlyRef = { path: "brands/anniu/projection_accuracy/2026-09" };
  const summaryRef = { path: "brands/anniu/dashboard_summary/2026-09" };
  const flagRef = { path: "brands/anniu/summary_recalc_flags/2026-09" };
  const fakeAdmin = {
    firestore: {
      FieldValue: {
        serverTimestamp: () => "__SERVER_TIMESTAMP__",
      },
    },
  };

  const checkpoint = {
    cutoffDate: "2026-09-10",
    cutoffDay: 10,
    capturedAtText: "2026-09-11T00:10:00.000Z",
    scoreEligibility: {
      cash: { eligible: true, reasons: [] },
      accrual: { eligible: true, reasons: [] },
    },
    effective: {
      cash: { standard: 900 },
      accrual: { standard: 1100 },
    },
    shadowV1: {
      ready: true,
      cash: { standard: 850 },
      accrual: { standard: 1050 },
    },
    naiveCurrentPace: {
      cash: 950,
      accrual: 1150,
    },
    model: {
      strategyVersion: "projection-strategy-v2-phase-calibrated",
      runtimePhase: {
        cash: { phaseApplied: true },
        accrual: { phaseApplied: true },
      },
    },
  };

  const summary = {
    version: "dashboard-summary-v2",
    semanticVersion: "summary-semantics-v1",
    kpiContractVersion: "kpi-contract-v1",
    brandId: "anniu",
    yearMonth: "2026-09",
    lifecycleSnapshot: {
      schemaVersion: "store-lifecycle-v1",
      datasetStatus: "READY",
      revision: 7,
      eligibleStoreCount: 17,
    },
    systemExclusionSnapshot: {
      version: "system-exclusion-v1",
      brandId: "anniu",
      revision: 2,
      stores: [],
    },
    reportingCompleteness: {
      schemaVersion: "reporting-completeness-v1",
      reportingStatus: "DATA_COMPLETE",
      expectedStoreDayCount: 510,
      submittedStoreDayCount: 510,
      missingStoreDayCount: 0,
      reportingCalendarMasterRevision: 4,
      reportingCalendarRevision: 3,
      storeClosedReportDayCount: 0,
    },
    grandTotal: {
      formalNetCash: 1000,
      formalNetCashStatus: "VALID",
      formalAccrual: 1200,
      formalAccrualStatus: "VALID",
    },
  };
  const flag = {
    status: "verified",
    dirty: false,
    lastMismatchCount: 0,
    reportingCalendarRevision: 3,
    requiredReportingCalendarRevision: 3,
    systemExclusionRevision: 2,
  };

  const store = new Map([
    [monthlyRef.path, {
      schemaVersion: "projection-accuracy-v1",
      checkpoints: { day10: checkpoint },
    }],
    [summaryRef.path, summary],
    [flagRef.path, flag],
  ]);
  const fakeDb = {
    async runTransaction(callback) {
      const tx = {
        async get(ref) {
          const value = store.get(ref.path);
          return {
            exists: value !== undefined,
            data: () => value,
          };
        },
        set(ref, patch) {
          const previous = store.get(ref.path) || {};
          store.set(ref.path, { ...previous, ...patch });
        },
      };
      return callback(tx);
    },
  };

  const first = await accuracy.persistVerifiedMonthScore({
    db: fakeDb,
    admin: fakeAdmin,
    monthlyRef,
    summaryRef,
    flagRef,
    brandId: "anniu",
    yearMonth: "2026-09",
    scoredAtText: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(first.written, true);
  assert.equal(first.scoreRevision, 1);
  assert.equal(store.get(monthlyRef.path).checkpoints.day10.effective.cash.standard, 900);

  const second = await accuracy.persistVerifiedMonthScore({
    db: fakeDb,
    admin: fakeAdmin,
    monthlyRef,
    summaryRef,
    flagRef,
    brandId: "anniu",
    yearMonth: "2026-09",
    scoredAtText: "2026-10-01T00:01:00.000Z",
  });
  assert.equal(second.written, false);
  assert.equal(second.reason, "ALREADY_CURRENT");
  assert.equal(second.scoreRevision, 1);

  store.set(summaryRef.path, {
    ...summary,
    grandTotal: {
      ...summary.grandTotal,
      formalNetCash: 1100,
    },
  });

  const third = await accuracy.persistVerifiedMonthScore({
    db: fakeDb,
    admin: fakeAdmin,
    monthlyRef,
    summaryRef,
    flagRef,
    brandId: "anniu",
    yearMonth: "2026-09",
    scoredAtText: "2026-10-01T00:02:00.000Z",
  });
  assert.equal(third.written, true);
  assert.equal(third.scoreRevision, 2);
  assert.equal(store.get(monthlyRef.path).finalActual.cash.value, 1100);
  assert.equal(store.get(monthlyRef.path).checkpoints.day10.effective.cash.standard, 900);
});

test("B2A index hook runs only after verified Summary guard and keeps scoring failure non-blocking", () => {
  const source = read("functions/index.js");
  assert.match(source, /finalFlagState\?\.verified === true/);
  assert.match(source, /scoreProjectionAccuracyMonthFromVerifiedSummary/);
  assert.match(source, /reason: "SCORING_FAILED"/);
  assert.match(source, /Accuracy is observability evidence|Accuracy 是 observability evidence/);
});

test("B1 index wiring is Backend-only, policy-state-free and uses existing brand path resolver", () => {
  const source = read("functions/index.js");
  assert.match(source, /createProjectionAccuracyFunctions/);
  assert.match(source, /exports\.captureProjectionAccuracyCheckpoint = projectionAccuracyFunctions\.captureProjectionAccuracyCheckpoint/);
  assert.match(source, /getBrandCollection: getSummaryCollection/);
  assert.match(source, /loadProjectionAuthority: loadTelegramAgentProjectionAuthority/);

  const moduleSource = read("functions/projectionAccuracy.js");
  assert.match(moduleSource, /where\("date", "==", cutoffDate\)/);
  assert.match(moduleSource, /getStorePerformance\(\s*monthStart,\s*cutoffDate,\s*null,\s*brandId,\s*ctx,\s*\[\]/);
  assert.match(moduleSource, /isLifecycleEntryExpectedForDate/);
  assert.match(moduleSource, /isArchivedDuplicate === true/);
  assert.match(moduleSource, /runTransaction/);
  assert.doesNotMatch(moduleSource, /loadTelegramAgentPolicyState/);
  assert.doesNotMatch(moduleSource, /setInterval\s*\(/);
  assert.doesNotMatch(moduleSource, /onSnapshot\s*\(/);
});

test("B1 Firestore Rules protect projection_accuracy from frontend writes on both roots", () => {
  const rules = read("firestore.rules");
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/projection_accuracy\/\{document=\*\*\} \{[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow write: if false;/
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/projection_accuracy\/\{document=\*\*\} \{[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow write: if false;/
  );
  assert.equal((rules.match(/collectionName != 'projection_accuracy'/g) || []).length, 2);
});
