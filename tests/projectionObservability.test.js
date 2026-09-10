import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectionObservabilitySnapshot,
  getProjectionObservabilityTone,
  getTaipeiProjectionYearMonth,
} from "../src/utils/projectionObservability.js";

const SOURCE_MONTHS = ["2026-06", "2026-07", "2026-08"];

const makeV2Model = (brandId = "cyj") => ({
  schemaVersion: "projection-model-v1",
  semanticVersion: "projection-semantic-v1",
  strategyVersion: "projection-strategy-v2-phase-calibrated",
  brandId,
  modelMonth: "2026-09",
  sourceMonths: SOURCE_MONTHS,
  generatedAtText: "2026-09-08T08:24:45.578Z",
  trigger: "manual_secure_rebuild",
  excludedStoreKeys: brandId === "cyj" ? ["中美"] : [],
  stores: { A: {}, B: {} },
  brand: {
    phaseCalibration: {
      schemaVersion: "projection-phase-v1",
      brandId,
      enabled: true,
      strategyVersion: "projection-strategy-v2-phase-calibrated",
      sourceMonths: SOURCE_MONTHS,
      cash: { reliable: true, sourceMonthCount: 3, completeSourceMonths: SOURCE_MONTHS },
      accrual: { reliable: true, sourceMonthCount: 3, completeSourceMonths: SOURCE_MONTHS },
    },
  },
});

test("Taipei year-month does not depend on UTC month boundary", () => {
  assert.equal(
    getTaipeiProjectionYearMonth(new Date("2026-08-31T16:30:00.000Z")),
    "2026-09"
  );
});

test("CYJ V2 model is healthy when both phase metrics are reliable", () => {
  const result = buildProjectionObservabilitySnapshot({
    model: makeV2Model("cyj"),
    brandId: "cyj",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "healthy");
  assert.equal(result.v2Expected, true);
  assert.equal(result.v2Active, true);
  assert.equal(result.cashPhase.reliable, true);
  assert.equal(result.accrualPhase.reliable, true);
  assert.deepEqual(result.sourceMonths, SOURCE_MONTHS);
  assert.equal(result.excludedStoreCount, 1);
});

test("Anniu V2 model remains brand-isolated", () => {
  const result = buildProjectionObservabilitySnapshot({
    model: makeV2Model("anniu"),
    brandId: "anniu",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "healthy");
  assert.equal(result.brandId, "anniu");
  assert.equal(result.v2Active, true);
});

test("Yibo remains a valid V1 brand and is not labeled V2", () => {
  const model = {
    schemaVersion: "projection-model-v1",
    semanticVersion: "projection-semantic-v1",
    brandId: "yibo",
    modelMonth: "2026-09",
    sourceMonths: SOURCE_MONTHS,
    generatedAtText: "2026-09-08T08:24:48.586Z",
    stores: { A: {} },
    brand: {},
  };
  const result = buildProjectionObservabilitySnapshot({
    model,
    brandId: "yibo",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "healthy");
  assert.equal(result.v2Expected, false);
  assert.equal(result.v2Active, false);
  assert.equal(result.strategyLabel, "V1");
});

test("metric-specific reliability failure is surfaced as warning", () => {
  const model = makeV2Model("cyj");
  model.brand.phaseCalibration.accrual.reliable = false;
  model.brand.phaseCalibration.accrual.sourceMonthCount = 2;
  const result = buildProjectionObservabilitySnapshot({
    model,
    brandId: "cyj",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "warning");
  assert.equal(result.cashPhase.reliable, true);
  assert.equal(result.accrualPhase.reliable, false);
});

test("stale source-month lineage is surfaced as warning", () => {
  const model = makeV2Model("cyj");
  model.sourceMonths = ["2026-05", "2026-06", "2026-07"];
  model.brand.phaseCalibration.sourceMonths = model.sourceMonths;
  const result = buildProjectionObservabilitySnapshot({
    model,
    brandId: "cyj",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "warning");
  assert.equal(result.sourceMonthsCurrent, false);
});

test("cross-brand model mismatch is surfaced as error", () => {
  const result = buildProjectionObservabilitySnapshot({
    model: makeV2Model("cyj"),
    brandId: "anniu",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "error");
  assert.match(result.statusLabel, /品牌資料不一致/);
});

test("tone mapping is presentation-only", () => {
  assert.equal(getProjectionObservabilityTone("healthy"), "emerald");
  assert.equal(getProjectionObservabilityTone("warning"), "amber");
  assert.equal(getProjectionObservabilityTone("error"), "rose");
});
