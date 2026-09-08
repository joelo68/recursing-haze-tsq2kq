import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  buildDashboardProjectionFromModel,
  resolveProjectionPhaseCalibration as resolveFrontendPhase,
} from "../src/utils/projectionModelConsumer.js";

const require = createRequire(import.meta.url);
const authority = require("../functions/projectionAuthority.js");
const telegram = require("../functions/telegram/projectionConsumer.js");

const normalizeStoreKey = (value = "") => String(value || "")
  .replace(/^(CYJ|安妞|伊啵)/, "")
  .replace(/店+$/g, "")
  .trim();

const weekdayCurve = (baseline) => Object.fromEntries(
  Array.from({ length: 7 }, (_, dow) => [dow, {
    sampleCount: 3,
    reliable: true,
    baseline,
    valueStatus: baseline === 0 ? "VALID_ZERO" : "VALID",
  }])
);

const phaseCurve = () => ({
  reliable: true,
  sourceMonthCount: 3,
  completeSourceMonths: ["2026-06", "2026-07", "2026-08"],
  minSourceMonths: 3,
  points: Object.fromEntries(
    Array.from({ length: 31 }, (_, index) => {
      const day = index + 1;
      return [day, {
        sampleCount: 3,
        reliable: true,
        cumulativeShare: Math.min(1, day / 40),
        valueStatus: "VALID",
      }];
    })
  ),
});

const makeV2Model = (brandId = "cyj") => ({
  schemaVersion: "projection-model-v1",
  semanticVersion: "projection-semantic-v1",
  strategyVersion: "projection-strategy-v2-phase-calibrated",
  kpiContractVersion: "kpi-contract-v1",
  brandId,
  modelMonth: "2026-09",
  sourceMonths: ["2026-06", "2026-07", "2026-08"],
  brand: {
    cashWeekday: weekdayCurve(80),
    accrualWeekday: weekdayCurve(90),
    phaseCalibration: {
      schemaVersion: "projection-phase-v1",
      brandId,
      enabled: true,
      strategyVersion: "projection-strategy-v2-phase-calibrated",
      sourceMonths: ["2026-06", "2026-07", "2026-08"],
      minSourceMonths: 3,
      cash: phaseCurve(),
      accrual: phaseCurve(),
    },
  },
  stores: {
    A: {
      storeKey: "A",
      canonicalStoreName: `${brandId === "anniu" ? "安妞" : "CYJ"}A店`,
      cashWeekday: weekdayCurve(100),
      accrualWeekday: weekdayCurve(120),
    },
  },
});

const lifecycleStore = () => ({
  firstEligibleMonth: "2026-01",
  openDate: "2020-01-01",
  lastEligibleMonth: "",
  closeDate: "",
  exemptMonths: [],
});

const makeHistoricalRows = (brandId) => {
  const prefix = brandId === "anniu" ? "安妞" : (brandId === "yibo" ? "伊啵" : "CYJ");
  const rows = [];
  for (const ym of ["2026-06", "2026-07", "2026-08"]) {
    const [year, month] = ym.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      rows.push({
        storeName: `${prefix}A店`,
        date: `${ym}-${String(day).padStart(2, "0")}`,
        cash: 100 + day,
        refund: 0,
        skincareRefund: 0,
        accrual: 200 + day,
        operationalAccrual: 300 + day,
      });
    }
  }
  return rows;
};

const buildHistoricalModel = (brandId, rows = makeHistoricalRows(brandId)) =>
  authority.buildHistoricalProjectionModel({
    brandId,
    modelMonth: "2026-09",
    rawRows: rows,
    lifecycleMaster: {
      schemaVersion: "store-lifecycle-v1",
      brandId,
      datasetStatus: "READY",
      revision: 1,
      stores: { A: lifecycleStore() },
    },
    systemExclusionData: {},
  });

test("Projection v2 writer is CYJ + ANNIU only; Yibo stays v1-compatible", () => {
  for (const brandId of ["cyj", "anniu"]) {
    const model = buildHistoricalModel(brandId);
    assert.equal(model.strategyVersion, authority.PROJECTION_STRATEGY_V2);
    assert.equal(
      model.brand.phaseCalibration.schemaVersion,
      authority.PROJECTION_PHASE_SCHEMA_VERSION
    );
    assert.equal(model.brand.phaseCalibration.enabled, true);
    assert.deepEqual(
      model.brand.phaseCalibration.cash.completeSourceMonths,
      ["2026-06", "2026-07", "2026-08"]
    );
    assert.equal(model.brand.phaseCalibration.cash.points[5].reliable, true);
  }

  const yibo = buildHistoricalModel("yibo");
  assert.equal(Object.hasOwn(yibo, "strategyVersion"), false);
  assert.equal(Object.hasOwn(yibo.brand, "phaseCalibration"), false);
});

test("Phase calibration scales only remaining forecast and retains v1 shadow", () => {
  const model = makeV2Model("cyj");
  const phase = resolveFrontendPhase({
    model,
    metric: "cash",
    daysPassed: 10,
    daysInMonth: 30,
  });

  // Day 10: historical cumulative share=0.25, calendar progress=1/3.
  assert.equal(phase.applied, true);
  assert.ok(Math.abs(phase.multiplier - (4 / 3)) < 1e-12);

  const result = buildDashboardProjectionFromModel({
    rows: [{ storeKey: "A", cash: 1000, accrual: 900 }],
    model,
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 10,
    daysInMonth: 30,
    normalizeStoreKey,
  });

  const shadow = result.projectionRange.shadowV1.cash.standard;
  const expected = Math.round(1000 + ((shadow - 1000) * (4 / 3)));
  assert.equal(result.projection, expected);
  assert.equal(result.projectionRange.phaseCalibration.cash.applied, true);
  assert.equal(
    result.projectionRange.profile.strategyVersion,
    "projection-strategy-v2-phase-calibrated"
  );
});

test("Day < 5, Yibo and System Excluded self-view fail closed to v1", () => {
  const early = buildDashboardProjectionFromModel({
    rows: [{ storeKey: "A", cash: 400, accrual: 360 }],
    model: makeV2Model("cyj"),
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 4,
    daysInMonth: 30,
    normalizeStoreKey,
  });
  assert.equal(early.projection, early.projectionRange.shadowV1.cash.standard);
  assert.equal(
    early.projectionRange.phaseCalibration.cash.reason,
    "BEFORE_VALIDATED_CHECKPOINT"
  );

  const yibo = buildDashboardProjectionFromModel({
    rows: [{ storeKey: "A", cash: 1000, accrual: 900 }],
    model: makeV2Model("yibo"),
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 10,
    daysInMonth: 30,
    normalizeStoreKey,
  });
  assert.equal(yibo.projection, yibo.projectionRange.shadowV1.cash.standard);
  assert.equal(yibo.projectionRange.phaseCalibration.cash.reason, "BRAND_V1");

  const excluded = buildDashboardProjectionFromModel({
    rows: [{
      storeKey: "ExcludedOwnStore",
      cash: 600,
      accrual: 300,
      selfViewExcluded: true,
    }],
    model: { ...makeV2Model("cyj"), stores: {} },
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 10,
    daysInMonth: 30,
    normalizeStoreKey,
    allowBrandFallbackForRow: (row) => row.selfViewExcluded !== true,
  });
  assert.equal(excluded.projection, excluded.projectionRange.shadowV1.cash.standard);
  assert.equal(
    excluded.projectionRange.phaseCalibration.cash.reason,
    "SCOPE_PHASE_DISABLED"
  );
  assert.equal(excluded.sourceStats.phaseCalibratedCash, false);
});

test("Dashboard and Telegram Projection v2 stay mathematically identical", () => {
  const model = makeV2Model("anniu");
  const rows = [{
    storeKey: "A",
    cash: 1200,
    accrual: 900,
    lifecycleEntry: lifecycleStore(),
  }];

  const frontend = buildDashboardProjectionFromModel({
    rows,
    model,
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 10,
    daysInMonth: 30,
    normalizeStoreKey,
  });
  const backend = telegram.buildTelegramProjectionFromModel({
    rows,
    model,
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 10,
    daysInMonth: 30,
    normalizeStoreKey,
  });

  assert.equal(backend.projection, frontend.projection);
  assert.equal(backend.accrualProjection, frontend.accrualProjection);
  assert.deepEqual(backend.projectionRange.cash, frontend.projectionRange.cash);
  assert.deepEqual(backend.projectionRange.accrual, frontend.projectionRange.accrual);
  assert.deepEqual(backend.projectionRange.shadowV1, frontend.projectionRange.shadowV1);
  assert.deepEqual(
    backend.projectionRange.phaseCalibration,
    frontend.projectionRange.phaseCalibration
  );
});

test("Incomplete historical source month makes phase curve fail closed", () => {
  const rows = makeHistoricalRows("cyj").filter(
    (row) => !(row.date === "2026-07-10")
  );
  const model = buildHistoricalModel("cyj", rows);

  assert.equal(model.brand.phaseCalibration.cash.reliable, false);
  assert.deepEqual(
    model.brand.phaseCalibration.cash.completeSourceMonths,
    ["2026-06", "2026-08"]
  );
});
