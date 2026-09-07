import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  buildDashboardProjectionFromModel,
  inspectProjectionModelTrust,
} from "../src/utils/projectionModelConsumer.js";

const require = createRequire(import.meta.url);
const backend = require("../functions/telegram/projectionConsumer.js");

const {
  buildTelegramProjectionFromModel,
  buildTelegramProjectionAuthorityScope,
  inspectTelegramProjectionModelTrust,
  isTelegramProjectionCurrentMonthToDateRange,
  resolveTelegramProjectionDaysPassed,
} = backend;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const normalizeStoreKey = (value = "") => String(value || "")
  .replace(/^(CYJ|安妞|伊啵)/, "")
  .replace(/店+$/g, "")
  .trim();

const curve = (baseline, sampleCount = 3, reliable = true) => Object.fromEntries(
  Array.from({ length: 7 }, (_, dow) => [dow, {
    sampleCount,
    reliable,
    baseline,
    valueStatus: baseline === 0 ? "VALID_ZERO" : "VALID",
  }])
);

const lifecycleStore = (overrides = {}) => ({
  firstEligibleMonth: "2026-01",
  openDate: "2020-01-01",
  lastEligibleMonth: "",
  closeDate: "",
  exemptMonths: [],
  ...overrides,
});

const makeLifecycle = (overrides = {}) => ({
  schemaVersion: "store-lifecycle-v1",
  brandId: "cyj",
  datasetStatus: "READY",
  revision: 7,
  reportingCalendar: {
    schemaVersion: "reporting-calendar-v2",
    revision: 11,
    monthRevisions: {
      "2026-06": 2,
      "2026-07": 3,
      "2026-08": 4,
      "2026-09": 5,
    },
    closedDates: [],
    storeClosureEvents: [],
  },
  stores: {
    A: lifecycleStore(),
    X: lifecycleStore(),
  },
  ...overrides,
});

const makeModel = (overrides = {}) => ({
  schemaVersion: "projection-model-v1",
  semanticVersion: "projection-semantic-v1",
  kpiContractVersion: "kpi-contract-v1",
  brandId: "cyj",
  modelMonth: "2026-09",
  sourceMonths: ["2026-06", "2026-07", "2026-08"],
  authority: {
    lifecycleRevision: 7,
    lifecycleDatasetStatus: "READY",
    reportingCalendarSchemaVersion: "reporting-calendar-v2",
    reportingCalendarMasterRevision: 11,
    reportingCalendarMonthRevisions: {
      "2026-06": 2,
      "2026-07": 3,
      "2026-08": 4,
    },
    systemExclusionSnapshot: {
      version: "system-exclusion-v1",
      brandId: "cyj",
      revision: 1,
      stores: ["X"],
    },
  },
  brand: {
    cashWeekday: curve(80),
    accrualWeekday: curve(90),
  },
  stores: {
    A: {
      storeKey: "A",
      canonicalStoreName: "CYJA店",
      cashWeekday: curve(100),
      accrualWeekday: curve(120),
    },
  },
  ...overrides,
});

const frontendExclusionState = {
  ready: true,
  brandId: "cyj",
  version: "system-exclusion-v1",
  revision: 1,
  stores: ["X"],
};

const backendExclusionProfile = {
  systemExclusionVersion: "system-exclusion-v1",
  brandId: "cyj",
  revision: 1,
  stores: ["X"],
};

test("8C Backend Projection trust stays in parity with Dashboard Projection authority", () => {
  const frontend = inspectProjectionModelTrust({
    model: makeModel(),
    brandId: "cyj",
    modelMonth: "2026-09",
    lifecycleMaster: makeLifecycle(),
    systemExclusionState: frontendExclusionState,
  });
  const telegram = inspectTelegramProjectionModelTrust({
    model: makeModel(),
    brandId: "cyj",
    modelMonth: "2026-09",
    lifecycleMaster: makeLifecycle(),
    systemExclusionProfile: backendExclusionProfile,
    normalizeStoreKey,
  });

  assert.equal(frontend.trusted, true);
  assert.equal(telegram.trusted, true);
  assert.equal(telegram.reason, frontend.reason);
  assert.deepEqual(telegram.expectedSourceMonths, frontend.expectedSourceMonths);
});

test("8C Dashboard and Telegram projection math match for the same authority and rows", () => {
  const model = makeModel();
  model.stores.A.cashWeekday[2] = {
    sampleCount: 3,
    reliable: true,
    baseline: 0,
    valueStatus: "VALID_ZERO",
  };
  const lifecycleEntry = {
    ...lifecycleStore(),
    reportingCalendarClosedDates: ["2026-09-07"],
  };
  const rows = [{
    storeKey: "A",
    cash: 600,
    accrual: 720,
    lifecycleEntry,
  }];

  const frontend = buildDashboardProjectionFromModel({
    rows,
    model,
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 6,
    daysInMonth: 30,
    normalizeStoreKey,
  });
  const telegram = buildTelegramProjectionFromModel({
    rows,
    model,
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 6,
    daysInMonth: 30,
    normalizeStoreKey,
  });

  assert.equal(telegram.projection, frontend.projection);
  assert.equal(telegram.accrualProjection, frontend.accrualProjection);
  assert.deepEqual(telegram.projectionRange.cash, frontend.projectionRange.cash);
  assert.deepEqual(telegram.projectionRange.accrual, frontend.projectionRange.accrual);
  assert.deepEqual(telegram.projectionRange.profile, frontend.projectionRange.profile);
  assert.deepEqual(telegram.sourceStats, frontend.sourceStats);
});

test("8C current MTD range and reporting cutoff mirror Dashboard day semantics", () => {
  assert.equal(isTelegramProjectionCurrentMonthToDateRange({
    startDate: "2026-09-01",
    endDate: "2026-09-07",
    currentYearMonth: "2026-09",
    todayStr: "2026-09-07",
  }), true);
  assert.equal(isTelegramProjectionCurrentMonthToDateRange({
    startDate: "2026-09-01",
    endDate: "2026-09-06",
    currentYearMonth: "2026-09",
    todayStr: "2026-09-07",
  }), true);
  assert.equal(isTelegramProjectionCurrentMonthToDateRange({
    startDate: "2026-09-02",
    endDate: "2026-09-07",
    currentYearMonth: "2026-09",
    todayStr: "2026-09-07",
  }), false);
  assert.equal(isTelegramProjectionCurrentMonthToDateRange({
    startDate: "2026-09-01",
    endDate: "2026-09-08",
    currentYearMonth: "2026-09",
    todayStr: "2026-09-07",
  }), false);

  assert.equal(resolveTelegramProjectionDaysPassed({
    rows: [{ __maxDataDay: 6 }],
    yearMonth: "2026-09",
    endDate: "2026-09-07",
    todayStr: "2026-09-07",
  }), 6);
  assert.equal(resolveTelegramProjectionDaysPassed({
    rows: [{ __maxDataDay: 7 }],
    yearMonth: "2026-09",
    endDate: "2026-09-07",
    todayStr: "2026-09-07",
  }), 7);
  assert.equal(resolveTelegramProjectionDaysPassed({
    rows: [{ __maxDataDay: 6 }],
    yearMonth: "2026-09",
    endDate: "2026-09-06",
    todayStr: "2026-09-07",
  }), 6);
});

test("8C Formal Projection scope removes System Excluded stores but keeps lifecycle entry metadata", () => {
  const scope = buildTelegramProjectionAuthorityScope({
    lifecycleMaster: makeLifecycle(),
    systemExclusionProfile: backendExclusionProfile,
    brandId: "cyj",
    yearMonth: "2026-09",
    normalizeStoreKey,
  });

  assert.equal(scope.scopeReady, true);
  assert.deepEqual([...scope.lifecycleEligibleStoreSet].sort(), ["A", "X"]);
  assert.deepEqual([...scope.formalScopeStoreSet].sort(), ["A"]);
  assert.equal(scope.systemExcludedStoreSet.has("X"), true);
  assert.equal(scope.lifecycleEntryMap.has("X"), true);
});

test("8C stale Projection Model fails closed to current pace", () => {
  const lifecycle = makeLifecycle({ revision: 8 });
  const trust = inspectTelegramProjectionModelTrust({
    model: makeModel(),
    brandId: "cyj",
    modelMonth: "2026-09",
    lifecycleMaster: lifecycle,
    systemExclusionProfile: backendExclusionProfile,
    normalizeStoreKey,
  });
  assert.equal(trust.trusted, false);
  assert.equal(trust.reason, "LIFECYCLE_REVISION_STALE");

  const result = buildTelegramProjectionFromModel({
    rows: [{ storeKey: "A", cash: 600, accrual: 300 }],
    model: null,
    modelTrusted: false,
    yearMonth: "2026-09",
    daysPassed: 6,
    daysInMonth: 30,
    normalizeStoreKey,
  });
  assert.equal(result.projectionRange.profile.currentWeight, 1);
  assert.equal(result.projectionRange.profile.historyWeight, 0);
  assert.equal(result.projectionRange.cash.conservative, result.projectionRange.cash.standard);
  assert.equal(result.projectionRange.cash.standard, result.projectionRange.cash.aggressive);
});

test("8C index wiring uses one 3-document authority BatchGet per execution/brand and preserves explicit-store fail-closed behavior", () => {
  const source = read("functions/index.js");
  assert.match(source, /require\("\.\/telegram\/projectionConsumer"\)/);
  assert.match(source, /getSummaryCollection\(normalizedBrandId, "projection_models"\)\.doc\(TELEGRAM_PROJECTION_MODEL_DOC_ID\)/);
  assert.match(source, /getSummaryCollection\(normalizedBrandId, "store_lifecycle"\)\.doc\("master"\)/);
  assert.match(source, /getAuditExclusionsDocRef\(normalizedBrandId\)/);
  assert.match(source, /db\.getAll\(\s*projectionRef,\s*lifecycleRef,\s*exclusionRef\s*\)/);
  assert.match(source, /assertTelegramAgentReadBudget\(ctx, 3\)/);
  assert.match(source, /_telegramProjectionAuthorityPromises/);
  assert.match(source, /formalScopeStoreSet\.has\(normalizeSummaryCoreName\(row\.storeName\)\)/);
  assert.match(source, /OUTSIDE_FORMAL_SCOPE_CURRENT_PACE/);
  assert.match(source, /projectionSource: "projection_models\/current \(Current MTD only\)"/);
  assert.match(source, /projectionAuthorityPointReads: projectionAuthority\?\.pointReadsThisCall \|\| 0/);
  assert.match(source, /projectionAuthorityExecutionCacheHit: projectionAuthority\?\.executionCacheHit === true/);
});

test("8C does not modify Therapist Projection consumer", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("function normalizeTelegramAgentTherapistRow");
  const end = source.indexOf("\nasync function getMissingReports", start);
  assert.ok(start >= 0 && end > start, "Therapist owner slice must remain extractable");
  const therapistSource = source.slice(start, end);
  const hash = crypto.createHash("sha256").update(therapistSource).digest("hex");
  assert.equal(hash, "30f94e6380c2841181594bd277bb854e54c1064e68df96093d9b9222ed078bce");
  assert.match(therapistSource, /overall\.projection = calculateTelegramAgentProjection\(overall\.revenue, yearMonth, endDate\)/);
  assert.doesNotMatch(therapistSource, /buildTelegramProjectionFromModel|projection_models/);
});
