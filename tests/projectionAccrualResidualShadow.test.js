import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const shadow = require("../functions/projectionShadowCandidate.js");
const accuracy = require("../functions/projectionAccuracy.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("accrual residual shadow v1 is frozen, accrual-only and never auto-promotes", () => {
  assert.equal(
    shadow.ACCRUAL_RESIDUAL_SHADOW_CANDIDATE_ID,
    "projection-accrual-residual-shadow-v1"
  );
  assert.equal(shadow.ACCRUAL_RESIDUAL_SHADOW_ACTIVATION_DATE, "2026-10-07");
  assert.deepEqual(shadow.ACCRUAL_RESIDUAL_SHADOW_ELIGIBLE_BRANDS, ["cyj", "anniu"]);
  assert.equal(shadow.ACCRUAL_RESIDUAL_SHADOW_CALIBRATION.metric, "accrual");
  assert.equal(shadow.ACCRUAL_RESIDUAL_SHADOW_CALIBRATION.independentMonthCountPerBrand, 5);
  assert.equal(shadow.ACCRUAL_RESIDUAL_SHADOW_CALIBRATION.validationMethod, "leave-one-month-out");
  assert.equal(shadow.ACCRUAL_RESIDUAL_SHADOW_CALIBRATION.cashChanged, false);
  assert.equal(shadow.ACCRUAL_RESIDUAL_SHADOW_CALIBRATION.accrualFormalChanged, false);
  assert.equal(shadow.ACCRUAL_RESIDUAL_SHADOW_CALIBRATION.shadowOnly, true);
  assert.equal(shadow.ACCRUAL_RESIDUAL_SHADOW_CALIBRATION.productionPromotionAllowed, false);
  assert.equal(shadow.ACCRUAL_RESIDUAL_SHADOW_CALIBRATION.automaticPromotionAllowed, false);
});

test("candidate uses brand + checkpoint factor against current effective accrual standard", () => {
  const cyj = shadow.buildAccrualResidualShadowCandidate({
    brandId: "cyj",
    checkpointKey: "day10",
    cutoffDate: "2026-10-10",
    effectiveAccrual: { standard: 20_000_000 },
  });
  assert.equal(cyj.eligible, true);
  assert.equal(cyj.productionFormulaChanged, false);
  assert.equal(cyj.automaticPromotionAllowed, false);
  assert.equal(cyj.factor, shadow.ACCRUAL_RESIDUAL_SHADOW_FACTORS.cyj.day10);
  assert.equal(
    cyj.standard,
    Math.round(20_000_000 * shadow.ACCRUAL_RESIDUAL_SHADOW_FACTORS.cyj.day10)
  );

  const anniu = shadow.buildAccrualResidualShadowCandidate({
    brandId: "anniu",
    checkpointKey: "day15",
    cutoffDate: "2026-10-15",
    effectiveAccrual: { standard: 10_000_000 },
  });
  assert.equal(anniu.eligible, true);
  assert.equal(anniu.factor, shadow.ACCRUAL_RESIDUAL_SHADOW_FACTORS.anniu.day15);
  assert.equal(
    anniu.standard,
    Math.round(10_000_000 * shadow.ACCRUAL_RESIDUAL_SHADOW_FACTORS.anniu.day15)
  );
});

test("candidate is fail-closed before activation, for Yibo, invalid checkpoint or missing standard", () => {
  const before = shadow.buildAccrualResidualShadowCandidate({
    brandId: "cyj",
    checkpointKey: "day05",
    cutoffDate: "2026-10-05",
    effectiveAccrual: { standard: 10_000_000 },
  });
  assert.equal(before.eligible, false);
  assert.equal(before.reason, "BEFORE_CANDIDATE_ACTIVATION");

  const yibo = shadow.buildAccrualResidualShadowCandidate({
    brandId: "yibo",
    checkpointKey: "day10",
    cutoffDate: "2026-10-10",
    effectiveAccrual: { standard: 10_000_000 },
  });
  assert.equal(yibo.eligible, false);
  assert.equal(yibo.reason, "BRAND_NOT_ELIGIBLE");

  const badCheckpoint = shadow.buildAccrualResidualShadowCandidate({
    brandId: "cyj",
    checkpointKey: "day12",
    cutoffDate: "2026-10-12",
    effectiveAccrual: { standard: 10_000_000 },
  });
  assert.equal(badCheckpoint.eligible, false);
  assert.equal(badCheckpoint.reason, "CHECKPOINT_NOT_ELIGIBLE");

  const missing = shadow.buildAccrualResidualShadowCandidate({
    brandId: "cyj",
    checkpointKey: "day10",
    cutoffDate: "2026-10-10",
    effectiveAccrual: null,
  });
  assert.equal(missing.eligible, false);
  assert.equal(missing.reason, "FORMAL_STANDARD_NOT_VALID");
});

test("accuracy checkpoint embeds residual shadow without changing formal effective projection or VIP shadow", () => {
  const checkpoint = accuracy.buildCheckpointPayload({
    brandId: "anniu",
    yearMonth: "2026-10",
    cutoffDate: "2026-10-10",
    checkpointKey: "day10",
    completeness: { complete: true },
    performance: {
      overall_summary: {
        cashStatus: "VALID",
        accrualStatus: "VALID",
        cash: 8_000_000,
        accrual: 10_000_000,
        projectionRange: {
          cash: { conservative: 16_000_000, standard: 18_000_000, aggressive: 20_000_000 },
          accrual: { conservative: 18_000_000, standard: 20_000_000, aggressive: 22_000_000 },
        },
      },
      stores_details: [],
      source_meta: [],
    },
    authority: {},
    projectionContext: null,
    capturedAtText: "2026-10-11T00:10:00.000Z",
    readCount: 0,
    readSources: [],
  });

  assert.equal(checkpoint.effective.accrual.standard, 20_000_000);
  assert.equal(
    checkpoint.accrualResidualShadow.candidateId,
    "projection-accrual-residual-shadow-v1"
  );
  assert.equal(checkpoint.accrualResidualShadow.eligible, true);
  assert.equal(
    checkpoint.accrualResidualShadow.standard,
    Math.round(20_000_000 * shadow.ACCRUAL_RESIDUAL_SHADOW_FACTORS.anniu.day10)
  );
  assert.equal(checkpoint.prospectiveShadow.status, "SHADOW_INELIGIBLE");
});

test("month-final scorecard scores residual shadow only for eligible accrual checkpoints", () => {
  const scorecard = accuracy.buildMonthFinalScorecard({
    checkpoints: {
      day10: {
        cutoffDate: "2026-10-10",
        cutoffDay: 10,
        model: {
          strategyVersion: "projection-strategy-v2-phase-calibrated",
          runtimePhase: {
            cash: { phaseApplied: true },
            accrual: { phaseApplied: true },
          },
        },
        scoreEligibility: {
          cash: { eligible: true, reasons: [] },
          accrual: { eligible: true, reasons: [] },
        },
        effective: {
          cash: { standard: 90 },
          accrual: { standard: 100 },
        },
        shadowV1: {
          ready: true,
          cash: { standard: 90 },
          accrual: { standard: 100 },
        },
        naiveCurrentPace: { cash: 90, accrual: 100 },
        accrualResidualShadow: {
          candidateId: "projection-accrual-residual-shadow-v1",
          eligible: true,
          reason: "ELIGIBLE",
          factor: 1.1,
          standard: 110,
        },
      },
    },
    finalActual: {
      cash: { value: 100 },
      accrual: { value: 100 },
    },
  });

  assert.equal(scorecard.byCheckpoint.day10.accrual.accrualResidualShadow.eligible, true);
  assert.equal(
    scorecard.byCheckpoint.day10.accrual.accrualResidualShadow.score.forecast,
    110
  );
  assert.equal(scorecard.overall.accrual.accrualResidualShadow.count, 1);
  assert.equal(scorecard.overall.accrual.accrualResidualShadow.wapePct, 10);
  assert.equal(scorecard.overall.cash.accrualResidualShadow, undefined);
});

test("checkpoint evidence signature includes residual-shadow identity", () => {
  const base = {
    day10: {
      cutoffDate: "2026-10-10",
      capturedAtText: "2026-10-11T00:10:00.000Z",
      scoreEligibility: {},
      effective: { cash: { standard: 100 }, accrual: { standard: 100 } },
      shadowV1: { ready: false, cash: null, accrual: null },
      naiveCurrentPace: { cash: 90, accrual: 90 },
      prospectiveShadow: {},
      accrualResidualShadow: {
        candidateId: "projection-accrual-residual-shadow-v1",
        eligible: true,
        standard: 110,
        factor: 1.1,
        reason: "ELIGIBLE",
      },
      model: { strategyVersion: "projection-strategy-v2-phase-calibrated", runtimePhase: {} },
    },
  };

  const a = accuracy.buildCheckpointEvidenceSignature(base);
  const b = accuracy.buildCheckpointEvidenceSignature({
    day10: {
      ...base.day10,
      accrualResidualShadow: {
        ...base.day10.accrualResidualShadow,
        factor: 1.11,
        standard: 111,
      },
    },
  });
  assert.notEqual(a, b);
});

test("live residual candidate reuses checkpoint data and adds no Firestore read, listener, query or polling", () => {
  const candidate = read("functions/projectionShadowCandidate.js");
  assert.match(candidate, /buildAccrualResidualShadowCandidate/);
  assert.doesNotMatch(candidate, /daily_reports|dashboard_summary|monthly_aggregated/);
  assert.doesNotMatch(candidate, /get\(|getAll\(|where\(|onSnapshot|setInterval/);

  const accuracySource = read("functions/projectionAccuracy.js");
  assert.match(accuracySource, /accrualResidualShadow/);
  assert.doesNotMatch(
    accuracySource,
    /accrual_residual_shadow.*(?:get\(|getAll\(|where\(|onSnapshot|setInterval)/i
  );
});
