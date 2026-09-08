import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildTelegramProjectionFromModel,
  aggregateTelegramProjectionRows,
} = require("../functions/telegram/projectionConsumer.js");

const normalizeStoreKey = (value = "") => String(value || "").trim();

const curve = (baseline) => Object.fromEntries(
  Array.from({ length: 7 }, (_, dow) => [dow, {
    sampleCount: 3,
    reliable: true,
    baseline,
    valueStatus: baseline === 0 ? "VALID_ZERO" : "VALID",
  }])
);

const phaseCurve = (shareAtDay7 = 0.2) => ({
  reliable: true,
  sourceMonthCount: 3,
  completeSourceMonths: ["2026-06", "2026-07", "2026-08"],
  minSourceMonths: 3,
  points: Object.fromEntries(
    Array.from({ length: 31 }, (_, index) => {
      const day = index + 1;
      const cumulativeShare = day === 7
        ? shareAtDay7
        : Math.min(1, Math.max(0.01, day / 35));
      return [day, {
        sampleCount: 3,
        reliable: true,
        cumulativeShare,
        valueStatus: "VALID",
      }];
    })
  ),
});

const makeV2Model = () => ({
  schemaVersion: "projection-model-v1",
  semanticVersion: "projection-semantic-v1",
  strategyVersion: "projection-strategy-v2-phase-calibrated",
  kpiContractVersion: "kpi-contract-v1",
  brandId: "cyj",
  modelMonth: "2026-09",
  sourceMonths: ["2026-06", "2026-07", "2026-08"],
  brand: {
    cashWeekday: curve(1),
    accrualWeekday: curve(1),
    phaseCalibration: {
      schemaVersion: "projection-phase-v1",
      brandId: "cyj",
      enabled: true,
      strategyVersion: "projection-strategy-v2-phase-calibrated",
      sourceMonths: ["2026-06", "2026-07", "2026-08"],
      minSourceMonths: 3,
      cash: phaseCurve(0.2),
      accrual: phaseCurve(0.2),
    },
  },
  stores: {
    A: {
      storeKey: "A",
      canonicalStoreName: "CYJA店",
      cashWeekday: curve(0),
      accrualWeekday: curve(1),
    },
    B: {
      storeKey: "B",
      canonicalStoreName: "CYJB店",
      cashWeekday: curve(2),
      accrualWeekday: curve(3),
    },
  },
});

const wrapStoreResult = (result) => ({
  projectionRange: result.projectionRange,
  projectionModelTrust: {
    trusted: true,
    reason: "TRUSTED",
  },
});

test("Telegram aggregate uses aggregate-first rounding for current-pace fallback", () => {
  const rows = [
    { storeKey: "A", cash: 1, accrual: 2 },
    { storeKey: "B", cash: 1, accrual: 2 },
  ];

  const direct = buildTelegramProjectionFromModel({
    rows,
    model: null,
    modelTrusted: false,
    yearMonth: "2026-09",
    daysPassed: 7,
    daysInMonth: 30,
    normalizeStoreKey,
  });

  const perStore = rows.map((row) => wrapStoreResult(
    buildTelegramProjectionFromModel({
      rows: [row],
      model: null,
      modelTrusted: false,
      yearMonth: "2026-09",
      daysPassed: 7,
      daysInMonth: 30,
      normalizeStoreKey,
    })
  ));

  const legacyCashSum = perStore.reduce(
    (sum, row) => sum + row.projectionRange.cash.standard,
    0
  );
  assert.notEqual(
    legacyCashSum,
    direct.projectionRange.cash.standard,
    "fixture must expose the old store-round-first delta"
  );

  const aggregate = aggregateTelegramProjectionRows(perStore);
  assert.deepEqual(aggregate.cash, direct.projectionRange.cash);
  assert.deepEqual(aggregate.accrual, direct.projectionRange.accrual);
});

test("Telegram v2 aggregate exactly matches one-shot multi-store phase calculation", () => {
  const model = makeV2Model();
  const rows = [
    { storeKey: "A", cash: 1, accrual: 2 },
    { storeKey: "B", cash: 1, accrual: 2 },
  ];

  const direct = buildTelegramProjectionFromModel({
    rows,
    model,
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 7,
    daysInMonth: 30,
    normalizeStoreKey,
  });

  const perStore = rows.map((row) => wrapStoreResult(
    buildTelegramProjectionFromModel({
      rows: [row],
      model,
      modelTrusted: true,
      yearMonth: "2026-09",
      daysPassed: 7,
      daysInMonth: 30,
      normalizeStoreKey,
    })
  ));

  const legacyCashSum = perStore.reduce(
    (sum, row) => sum + row.projectionRange.cash.standard,
    0
  );
  assert.notEqual(
    legacyCashSum,
    direct.projectionRange.cash.standard,
    "fixture must expose the Production v2 rounding-order delta"
  );

  const aggregate = aggregateTelegramProjectionRows(perStore);
  assert.deepEqual(aggregate.cash, direct.projectionRange.cash);
  assert.deepEqual(aggregate.accrual, direct.projectionRange.accrual);
});

test("mixed phase scope fails safe without leaking brand phase", () => {
  const model = makeV2Model();
  const rows = [
    { storeKey: "A", cash: 1, accrual: 2, selfViewExcluded: false },
    { storeKey: "B", cash: 1, accrual: 2, selfViewExcluded: true },
  ];

  const perStore = rows.map((row) => wrapStoreResult(
    buildTelegramProjectionFromModel({
      rows: [row],
      model,
      modelTrusted: true,
      yearMonth: "2026-09",
      daysPassed: 7,
      daysInMonth: 30,
      normalizeStoreKey,
      allowBrandFallbackForRow: (item) => item.selfViewExcluded !== true,
    })
  ));

  const aggregate = aggregateTelegramProjectionRows(perStore);

  const directFailClosed = buildTelegramProjectionFromModel({
    rows,
    model,
    modelTrusted: true,
    yearMonth: "2026-09",
    daysPassed: 7,
    daysInMonth: 30,
    normalizeStoreKey,
    allowBrandFallbackForRow: (item) => item.selfViewExcluded !== true,
  });

  assert.equal(directFailClosed.projectionRange.phaseCalibration.cash.applied, false);
  assert.equal(
    directFailClosed.projectionRange.phaseCalibration.cash.reason,
    "SCOPE_PHASE_DISABLED"
  );
  assert.deepEqual(aggregate.cash, directFailClosed.projectionRange.cash);
  assert.deepEqual(aggregate.accrual, directFailClosed.projectionRange.accrual);
});
