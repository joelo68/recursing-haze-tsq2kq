import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDashboardProjectionFromModel,
  getExpectedProjectionSourceMonths,
  inspectProjectionModelTrust,
  resolveProjectionHistoricalBaseline,
} from "../src/utils/projectionModelConsumer.js";

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
    A: {
      firstEligibleMonth: "2026-01",
      openDate: "2020-01-01",
      lastEligibleMonth: "",
      closeDate: "",
      exemptMonths: [],
    },
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

const exclusionState = {
  ready: true,
  brandId: "cyj",
  version: "system-exclusion-v1",
  revision: 1,
  stores: ["X"],
};

test("Projection Model trust validates current brand/month, Lifecycle, source-month Calendar, and System Exclusion", () => {
  const result = inspectProjectionModelTrust({
    model: makeModel(),
    brandId: "cyj",
    modelMonth: "2026-09",
    lifecycleMaster: makeLifecycle(),
    systemExclusionState: exclusionState,
  });

  assert.equal(result.trusted, true);
  assert.equal(result.reason, "TRUSTED");
  assert.deepEqual(getExpectedProjectionSourceMonths("2026-09"), ["2026-06", "2026-07", "2026-08"]);
});

test("Projection Model fails closed when Lifecycle, source-month Calendar, or System Exclusion authority is stale", () => {
  assert.equal(
    inspectProjectionModelTrust({
      model: makeModel(),
      brandId: "cyj",
      modelMonth: "2026-09",
      lifecycleMaster: makeLifecycle({ revision: 8 }),
      systemExclusionState: exclusionState,
    }).reason,
    "LIFECYCLE_REVISION_STALE"
  );

  const calendarStale = makeLifecycle();
  calendarStale.reportingCalendar.monthRevisions["2026-07"] = 99;
  assert.equal(
    inspectProjectionModelTrust({
      model: makeModel(),
      brandId: "cyj",
      modelMonth: "2026-09",
      lifecycleMaster: calendarStale,
      systemExclusionState: exclusionState,
    }).reason,
    "REPORTING_CALENDAR_STALE"
  );

  assert.equal(
    inspectProjectionModelTrust({
      model: makeModel(),
      brandId: "cyj",
      modelMonth: "2026-09",
      lifecycleMaster: makeLifecycle(),
      systemExclusionState: { ...exclusionState, revision: 2 },
    }).reason,
    "SYSTEM_EXCLUSION_STALE"
  );
});

test("Reliable numeric zero weekday baseline remains a true zero on every weekday", () => {
  const model = makeModel();
  model.stores.A.cashWeekday[2] = {
    sampleCount: 3,
    reliable: true,
    baseline: 0,
    valueStatus: "VALID_ZERO",
  };

  const result = resolveProjectionHistoricalBaseline({
    model,
    storeKey: "CYJA店",
    metric: "cash",
    weekday: 2,
    fallbackValue: 55,
    normalizeStoreKey,
  });

  assert.equal(result.source, "STORE_MODEL");
  assert.equal(result.value, 0);
  assert.equal(result.reliable, true);
});

test("Unreliable store weekday falls back to reliable brand model, then current pace", () => {
  const model = makeModel();
  model.stores.A.cashWeekday[1] = {
    sampleCount: 2,
    reliable: false,
    baseline: null,
    valueStatus: "INSUFFICIENT_SAMPLE",
  };

  const brandFallback = resolveProjectionHistoricalBaseline({
    model,
    storeKey: "A",
    metric: "cash",
    weekday: 1,
    fallbackValue: 55,
    normalizeStoreKey,
  });
  assert.equal(brandFallback.source, "BRAND_MODEL");
  assert.equal(brandFallback.value, 80);

  const currentOnly = resolveProjectionHistoricalBaseline({
    model,
    storeKey: "A",
    metric: "cash",
    weekday: 1,
    fallbackValue: 55,
    normalizeStoreKey,
    allowBrandFallback: false,
  });
  assert.equal(currentOnly.source, "CURRENT_PACE");
  assert.equal(currentOnly.value, 55);
});

test("Dashboard Projection skips future Lifecycle/Reporting Calendar closed dates", () => {
  const lifecycleEntry = {
    firstEligibleMonth: "2026-01",
    openDate: "2020-01-01",
    lastEligibleMonth: "",
    closeDate: "",
    exemptMonths: [],
    reportingCalendarClosedDates: ["2026-09-07"],
  };
  const rows = [{
    storeKey: "A",
    cash: 600,
    accrual: 720,
    lifecycleEntry,
  }];

  const withClosure = buildDashboardProjectionFromModel({
    rows,
    model: makeModel(),
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 6,
    daysInMonth: 8,
    normalizeStoreKey,
  });
  const withoutClosure = buildDashboardProjectionFromModel({
    rows: [{ ...rows[0], lifecycleEntry: { ...lifecycleEntry, reportingCalendarClosedDates: [] } }],
    model: makeModel(),
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 6,
    daysInMonth: 8,
    normalizeStoreKey,
  });

  assert.equal(withClosure.sourceStats.skippedClosedFutureStoreDays, 1);
  assert.ok(withClosure.projection < withoutClosure.projection);
  assert.ok(withClosure.accrualProjection < withoutClosure.accrualProjection);
});

test("Missing/stale Projection Model falls back to current pace without pretending historical weighting", () => {
  const result = buildDashboardProjectionFromModel({
    rows: [{ storeKey: "A", cash: 600, accrual: 300 }],
    model: null,
    modelTrusted: false,
    yearMonth: "2026-09",
    daysPassed: 6,
    daysInMonth: 8,
    normalizeStoreKey,
  });

  assert.equal(result.projectionRange.profile.currentWeight, 1);
  assert.equal(result.projectionRange.profile.historyWeight, 0);
  assert.equal(result.projectionRange.cash.conservative, result.projectionRange.cash.standard);
  assert.equal(result.projectionRange.cash.standard, result.projectionRange.cash.aggressive);
  assert.equal(result.projectionRange.accrual.conservative, result.projectionRange.accrual.standard);
  assert.equal(result.projectionRange.accrual.standard, result.projectionRange.accrual.aggressive);
});

test("System Excluded own-store self-view can disable brand baseline fallback", () => {
  const model = makeModel({ stores: {} });
  const result = buildDashboardProjectionFromModel({
    rows: [{
      storeKey: "ExcludedOwnStore",
      cash: 600,
      accrual: 300,
      selfViewExcluded: true,
    }],
    model,
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 6,
    daysInMonth: 8,
    normalizeStoreKey,
    allowBrandFallbackForRow: (row) => row.selfViewExcluded !== true,
  });

  assert.equal(result.sourceStats.brandModelFallbacks, 0);
  assert.ok(result.sourceStats.currentPaceFallbacks > 0);
});

test("Dashboard wiring uses one projection_models/current point read and retires legacy projection_curves reads", () => {
  const hook = read("src/hooks/useDashboardStats.js");
  const app = read("src/App.jsx");
  const analytics = read("src/hooks/useAnalytics.js");
  const dashboardView = read("src/components/DashboardView.jsx");

  assert.match(hook, /doc\(getCollectionPath\("projection_models"\), PROJECTION_MODEL_DOC_ID\)/);
  assert.match(hook, /await getDoc\(modelRef\)/);
  assert.doesNotMatch(hook, /projection_curves/);
  assert.doesNotMatch(hook, /\bgetDocs\s*\(/);
  assert.doesNotMatch(hook, /\bcollection\s*\(/);
  assert.doesNotMatch(hook, /from ['"]\.\.\/config\/firebase['"]/);

  assert.match(hook, /inspectProjectionModelTrust/);
  assert.match(hook, /buildDashboardProjectionFromModel/);
  assert.match(hook, /projectionLifecycleEntryMap/);
  assert.match(hook, /allowBrandFallbackForRow/);

  // Batch 8B only cuts over the Dashboard consumer. Legacy useAnalytics remains
  // compatibility source for AppContext storeList until Batch 9 cleanup.
  assert.match(app, /const analytics = useAnalytics\(/);
  assert.match(app, /storeList: analytics\?\.storeList \|\| \[\]/);
  assert.match(analytics, /projection/);
  assert.doesNotMatch(dashboardView, /\banalytics\b/);
});
