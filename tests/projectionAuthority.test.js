import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projection = require("../functions/projectionAuthority.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const {
  getProjectionSourceMonths,
  median,
  buildWeekdayCurve,
  buildFormalProjectionMetrics,
  buildHistoricalProjectionModel,
  PROJECTION_MODEL_SCHEMA_VERSION,
  PROJECTION_SEMANTIC_VERSION,
} = projection;

const lifecycleStore = (overrides = {}) => ({
  firstEligibleMonth: "2026-01",
  openDate: "2020-01-01",
  lastEligibleMonth: "",
  closeDate: "",
  exemptMonths: [],
  ...overrides,
});

test("Projection source months are the previous three complete calendar months", () => {
  assert.deepEqual(getProjectionSourceMonths("2027-01"), ["2026-10", "2026-11", "2026-12"]);
  assert.deepEqual(getProjectionSourceMonths("2026-09"), ["2026-06", "2026-07", "2026-08"]);
});

test("historical baseline uses median, preserves zero/negative, and requires three weekday samples", () => {
  assert.equal(median([-10, 0, 20]), 0);
  assert.equal(median([1, 2, 100, 1000000]), 51);
  const curve = buildWeekdayCurve({ 1: [-10, 0, 20], 2: [100, 200] });
  assert.equal(curve[1].reliable, true);
  assert.equal(curve[1].sampleCount, 3);
  assert.equal(curve[1].baseline, 0);
  assert.equal(curve[1].valueStatus, "VALID_ZERO");
  assert.equal(curve[2].reliable, false);
  assert.equal(curve[2].baseline, null);
});

test("Projection Formal KPI uses net cash and Anniu operationalAccrual", () => {
  const cyj = buildFormalProjectionMetrics("cyj", {
    cash: 1000,
    refund: 100,
    skincareRefund: 50,
    accrual: 800,
    operationalAccrual: 700,
  });
  assert.equal(cyj.cash.value, 850);
  assert.equal(cyj.accrual.value, 800);

  const anniu = buildFormalProjectionMetrics("anniu", {
    cash: 1000,
    skincareRefund: 0,
    accrual: 900,
    operationalAccrual: 650,
  });
  assert.equal(anniu.cash.value, 1000);
  assert.equal(anniu.accrual.value, 650);
  assert.equal(anniu.accrual.sourceField, "operationalAccrual");
});

test("Historical model reuses Lifecycle, Reporting Calendar and System Exclusion authority", () => {
  const master = {
    brandId: "cyj",
    datasetStatus: "READY",
    revision: 11,
    reportingCalendar: {
      schemaVersion: "reporting-calendar-v2",
      revision: 7,
      monthRevisions: { "2026-06": 1, "2026-07": 2, "2026-08": 3 },
      closedDates: [{ date: "2026-07-06", reason: "品牌休假" }],
      storeClosureEvents: [{
        id: "store-close-a",
        dates: ["2026-08-03"],
        storeKeys: ["A"],
        reason: "A店排休",
      }],
    },
    stores: {
      A: lifecycleStore(),
      B: lifecycleStore({ firstEligibleMonth: "2026-08", openDate: "2026-08-10" }),
      X: lifecycleStore(),
    },
  };

  const rows = [
    { storeName: "CYJA店", date: "2026-06-01", cash: 100, refund: 0, skincareRefund: 0, accrual: 100 },
    { storeName: "A", date: "2026-06-08", cash: 0, refund: 0, skincareRefund: 0, accrual: 0 },
    { storeName: "A店", date: "2026-06-15", cash: -50, refund: 0, skincareRefund: 0, accrual: -30 },
    { storeName: "A", date: "2026-07-06", cash: 9999, refund: 0, skincareRefund: 0, accrual: 9999 },
    { storeName: "A", date: "2026-08-03", cash: 9999, refund: 0, skincareRefund: 0, accrual: 9999 },
    { storeName: "B", date: "2026-08-03", cash: 9999, refund: 0, skincareRefund: 0, accrual: 9999 },
    { storeName: "B", date: "2026-08-10", cash: 200, refund: 0, skincareRefund: 0, accrual: 300 },
    { storeName: "X", date: "2026-06-01", cash: 5000, refund: 0, skincareRefund: 0, accrual: 5000 },
  ];

  const model = buildHistoricalProjectionModel({
    brandId: "cyj",
    modelMonth: "2026-09",
    rawRows: rows,
    lifecycleMaster: master,
    systemExclusionData: {
      systemExclusionVersion: "system-exclusion-v1",
      revision: 5,
      stores: ["X"],
    },
    generatedAtText: "2026-09-06T10:00:00.000Z",
  });

  assert.equal(model.schemaVersion, PROJECTION_MODEL_SCHEMA_VERSION);
  assert.equal(model.semanticVersion, PROJECTION_SEMANTIC_VERSION);
  assert.deepEqual(model.sourceMonths, ["2026-06", "2026-07", "2026-08"]);
  assert.equal(model.authority.lifecycleRevision, 11);
  assert.deepEqual(model.authority.reportingCalendarMonthRevisions, {
    "2026-06": 1,
    "2026-07": 2,
    "2026-08": 3,
  });
  assert.deepEqual(model.excludedStoreKeys, ["X"]);
  assert.equal(Object.hasOwn(model.stores, "X"), false);
  assert.equal(model.stores.A.cashWeekday[1].sampleCount, 3);
  assert.equal(model.stores.A.cashWeekday[1].reliable, true);
  assert.equal(model.stores.A.cashWeekday[1].baseline, 0);
  assert.equal(model.brand.cashWeekday[1].sampleCount, 4);
  assert.equal(model.brand.cashWeekday[1].baseline, 50);
  assert.ok(model.sourceStats.nonOperatingDateCount >= 3);
  assert.ok(model.sourceStats.noLifecycleEligibilityCount >= 1);
});

test("duplicate canonical Store×Date rows fail closed instead of being summed", () => {
  const master = {
    brandId: "cyj",
    datasetStatus: "READY",
    revision: 1,
    stores: { A: lifecycleStore() },
  };
  const model = buildHistoricalProjectionModel({
    brandId: "cyj",
    modelMonth: "2026-09",
    rawRows: [
      { storeName: "A", date: "2026-06-01", cash: 100, refund: 0, skincareRefund: 0, accrual: 100 },
      { storeName: "CYJA店", date: "2026-06-01", cash: 200, refund: 0, skincareRefund: 0, accrual: 200 },
    ],
    lifecycleMaster: master,
    systemExclusionData: {},
  });
  assert.equal(model.sourceStats.duplicateStoreDateCount, 1);
  assert.equal(model.stores.A.cashWeekday[1].sampleCount, 0);
});

test("Backend wiring replaces legacy brands/cyj projection curve worker", () => {
  const index = read("functions/index.js");
  const source = read("functions/projectionAuthority.js");
  assert.match(index, /createProjectionAuthorityFunctions/);
  assert.match(index, /exports\.rebuildProjectionModelNow = projectionAuthorityFunctions\.rebuildProjectionModelNow/);
  assert.match(index, /exports\.calculateHistoricalProjectionCurve = projectionAuthorityFunctions\.calculateHistoricalProjectionCurve/);
  assert.doesNotMatch(index, /collection\("settings"\)\.doc\("projection_curves"\)\.collection\("stores"\)/);
  assert.match(source, /getBrandCollection\(db, brandId, "daily_reports"\)/);
  assert.match(source, /getBrandCollection\(db, brandId, PROJECTION_MODEL_COLLECTION\)\.doc\(PROJECTION_MODEL_DOC_ID\)/);
  assert.doesNotMatch(source, /median\s*\*\s*4/);
  assert.doesNotMatch(source, /avg\s*\*\s*2\.5/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test("Projection model Rules are signed-in read and backend-only write on both roots", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /match \/brands\/\{brandId\}\/projection_models\/\{document=\*\*\} \{[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow write: if false;/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/projection_models\/\{document=\*\*\} \{[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow write: if false;/);
  assert.ok((rules.match(/collectionName != 'projection_models'/g) || []).length >= 2);
});
