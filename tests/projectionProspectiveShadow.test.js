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

const makeContext = (overrides = {}) => ({
  schemaVersion: "projection-context-v2",
  brandId: "cyj",
  yearMonth: "2026-10",
  revision: 3,
  mode: "event_month",
  updatedAtText: "2026-10-01T01:00:00.000Z",
  events: [{
    id: "vip-2026-10",
    campaignId: "vip-2026-10",
    name: "VIP 實體活動",
    type: "vip",
    level: "major",
    scopeMode: "brand",
    startDate: "2026-10-18",
    endDate: "2026-10-25",
    metrics: ["cash", "accrual"],
    storeSchedule: [{
      storeKey: "中壢",
      startDate: "2026-10-18",
      endDate: "2026-10-18",
    }],
  }],
  ...overrides,
});

test("B3D calibration is frozen to the approved single-campaign candidate and never auto-promotes", () => {
  assert.equal(shadow.PROSPECTIVE_SHADOW_CANDIDATE_ID, "b3d-prospective-vip-shadow-v1");
  assert.equal(shadow.PROSPECTIVE_SHADOW_CALIBRATION.campaignCount, 1);
  assert.equal(shadow.PROSPECTIVE_SHADOW_CALIBRATION.independentCampaignValidation, false);
  assert.equal(shadow.PROSPECTIVE_SHADOW_CALIBRATION.productionPromotionAllowed, false);

  assert.equal(shadow.PROSPECTIVE_SHADOW_FACTORS.cash.day05, 1.2);
  assert.equal(shadow.PROSPECTIVE_SHADOW_FACTORS.cash.day25, 1.013028);
  assert.equal(shadow.PROSPECTIVE_SHADOW_FACTORS.accrual.day05, 1.153406);
  assert.equal(shadow.PROSPECTIVE_SHADOW_FACTORS.accrual.day25, 1.077505);
});

test("B3D prospective candidate uses only checkpoint-known actual, formal standard and frozen factor", () => {
  const result = shadow.buildProspectiveShadowCandidate({
    brandId: "cyj",
    yearMonth: "2026-10",
    checkpointKey: "day10",
    cutoffDate: "2026-10-10",
    capturedAtText: "2026-10-11T00:10:00.000Z",
    context: makeContext(),
    actual: { cash: 10_000_000, accrual: 12_000_000 },
    effective: {
      cash: { conservative: 18_000_000, standard: 20_000_000, aggressive: 22_000_000 },
      accrual: { conservative: 20_000_000, standard: 22_000_000, aggressive: 24_000_000 },
    },
  });

  assert.equal(result.productionFormulaChanged, false);
  assert.equal(result.automaticPromotionAllowed, false);
  assert.equal(result.status, "SHADOW_ELIGIBLE");
  assert.equal(result.cash.standard, 22_000_000);
  assert.equal(result.cash.actualToDate, 10_000_000);
  assert.equal(result.cash.formalStandard, 20_000_000);
  assert.equal(result.cash.factor, 1.2);
  assert.equal(result.accrual.standard, Math.round(12_000_000 + 10_000_000 * 1.137281));
});

test("storeSchedule is captured as immutable evidence but does not scale candidate v1", () => {
  const base = {
    brandId: "cyj",
    yearMonth: "2026-10",
    checkpointKey: "day15",
    cutoffDate: "2026-10-15",
    capturedAtText: "2026-10-16T00:10:00.000Z",
    actual: { cash: 15_000_000, accrual: 16_000_000 },
    effective: {
      cash: { standard: 25_000_000 },
      accrual: { standard: 26_000_000 },
    },
  };

  const oneSchedule = shadow.buildProspectiveShadowCandidate({
    ...base,
    context: makeContext(),
  });
  const manySchedule = shadow.buildProspectiveShadowCandidate({
    ...base,
    context: makeContext({
      events: [{
        ...makeContext().events[0],
        storeSchedule: [
          { storeKey: "中壢", startDate: "2026-10-18", endDate: "2026-10-18" },
          { storeKey: "桃園", startDate: "2026-10-19", endDate: "2026-10-19" },
          { storeKey: "竹北", startDate: "2026-10-20", endDate: "2026-10-20" },
        ],
      }],
    }),
  });

  assert.equal(oneSchedule.cash.standard, manySchedule.cash.standard);
  assert.equal(oneSchedule.accrual.standard, manySchedule.accrual.standard);
  assert.notEqual(oneSchedule.context.contextHash, manySchedule.context.contextHash);
  assert.equal(manySchedule.context.relevantEvents[0].storeSchedule.length, 3);
});

test("candidate stays fail-closed outside CYJ brand-wide VIP context", () => {
  const storeScoped = shadow.buildProspectiveShadowCandidate({
    brandId: "cyj",
    yearMonth: "2026-10",
    checkpointKey: "day10",
    context: makeContext({
      events: [{ ...makeContext().events[0], scopeMode: "stores", storeKeys: ["中壢"] }],
    }),
    actual: { cash: 10, accrual: 10 },
    effective: { cash: { standard: 20 }, accrual: { standard: 20 } },
  });
  assert.equal(storeScoped.cash.eligible, false);
  assert.equal(storeScoped.cash.reason, "NO_ELIGIBLE_VIP_EVENT_FOR_METRIC");

  const anniu = shadow.buildProspectiveShadowCandidate({
    brandId: "anniu",
    yearMonth: "2026-10",
    checkpointKey: "day10",
    context: { ...makeContext(), brandId: "anniu" },
    actual: { cash: 10, accrual: 10 },
    effective: { cash: { standard: 20 }, accrual: { standard: 20 } },
  });
  assert.equal(anniu.cash.eligible, false);
  assert.equal(anniu.context.reason, "BRAND_NOT_ELIGIBLE");

  const yibo = shadow.buildProspectiveShadowCandidate({
    brandId: "yibo",
    yearMonth: "2026-10",
    checkpointKey: "day10",
    context: null,
    actual: { cash: 10, accrual: 10 },
    effective: { cash: { standard: 20 }, accrual: { standard: 20 } },
  });
  assert.equal(yibo.cash.eligible, false);
  assert.equal(yibo.context.reason, "BRAND_NOT_ELIGIBLE");
});

test("metric activation is independent and invalid/missing context cannot generate a forecast", () => {
  const cashOnly = shadow.buildProspectiveShadowCandidate({
    brandId: "cyj",
    yearMonth: "2026-10",
    checkpointKey: "day20",
    context: makeContext({
      events: [{ ...makeContext().events[0], metrics: ["cash"] }],
    }),
    actual: { cash: 20_000_000, accrual: 20_000_000 },
    effective: { cash: { standard: 30_000_000 }, accrual: { standard: 30_000_000 } },
  });
  assert.equal(cashOnly.cash.eligible, true);
  assert.equal(cashOnly.accrual.eligible, false);
  assert.equal(cashOnly.accrual.reason, "NO_ELIGIBLE_VIP_EVENT_FOR_METRIC");

  const missing = shadow.buildProspectiveShadowCandidate({
    brandId: "cyj",
    yearMonth: "2026-10",
    checkpointKey: "day20",
    context: null,
    actual: { cash: 20, accrual: 20 },
    effective: { cash: { standard: 30 }, accrual: { standard: 30 } },
  });
  assert.equal(missing.cash.eligible, false);
  assert.equal(missing.context.reason, "CONTEXT_MISSING");

  const wrongMonth = shadow.buildProspectiveShadowCandidate({
    brandId: "cyj",
    yearMonth: "2026-10",
    checkpointKey: "day20",
    context: makeContext({ yearMonth: "2026-11" }),
    actual: { cash: 20, accrual: 20 },
    effective: { cash: { standard: 30 }, accrual: { standard: 30 } },
  });
  assert.equal(wrongMonth.cash.eligible, false);
  assert.equal(wrongMonth.context.reason, "CONTEXT_MONTH_MISMATCH");
});

test("Accuracy checkpoint embeds prospective shadow without changing formal effective projection", () => {
  const checkpoint = accuracy.buildCheckpointPayload({
    brandId: "cyj",
    yearMonth: "2026-10",
    cutoffDate: "2026-10-10",
    checkpointKey: "day10",
    completeness: { complete: true },
    performance: {
      overall_summary: {
        cashStatus: "VALID",
        accrualStatus: "VALID",
        cash: 10_000_000,
        accrual: 12_000_000,
        projectionRange: {
          cash: { conservative: 18_000_000, standard: 20_000_000, aggressive: 22_000_000 },
          accrual: { conservative: 20_000_000, standard: 22_000_000, aggressive: 24_000_000 },
        },
      },
      stores_details: [],
      source_meta: [],
    },
    authority: {},
    projectionContext: makeContext(),
    capturedAtText: "2026-10-11T00:10:00.000Z",
    readCount: 1,
    readSources: [],
  });

  assert.equal(checkpoint.effective.cash.standard, 20_000_000);
  assert.equal(checkpoint.effective.accrual.standard, 22_000_000);
  assert.equal(checkpoint.prospectiveShadow.candidateId, "b3d-prospective-vip-shadow-v1");
  assert.equal(checkpoint.prospectiveShadow.cash.standard, 22_000_000);
  assert.equal(checkpoint.prospectiveShadow.accrual.standard, Math.round(12_000_000 + 10_000_000 * 1.137281));
});

test("checkpoint evidence signature includes context-aware shadow identity", () => {
  const base = {
    day10: {
      cutoffDate: "2026-10-10",
      capturedAtText: "2026-10-11T00:10:00.000Z",
      scoreEligibility: {},
      effective: { cash: { standard: 100 }, accrual: { standard: 100 } },
      shadowV1: { ready: false, cash: null, accrual: null },
      naiveCurrentPace: { cash: 90, accrual: 90 },
      prospectiveShadow: {
        candidateId: "b3d-prospective-vip-shadow-v1",
        context: { revision: 1, contextHash: "a" },
        cash: { eligible: true, standard: 120, factor: 1.2, reason: "ELIGIBLE" },
        accrual: { eligible: true, standard: 115, factor: 1.15, reason: "ELIGIBLE" },
      },
      model: { strategyVersion: "projection-strategy-v2-phase-calibrated", runtimePhase: {} },
    },
  };

  const a = accuracy.buildCheckpointEvidenceSignature(base);
  const b = accuracy.buildCheckpointEvidenceSignature({
    day10: {
      ...base.day10,
      prospectiveShadow: {
        ...base.day10.prospectiveShadow,
        context: { revision: 2, contextHash: "b" },
      },
    },
  });
  assert.notEqual(a, b);
});

test("B3D integration adds only one CYJ point read and no listener/polling or Production consumer cutover", () => {
  const source = read("functions/projectionAccuracy.js");
  assert.match(source, /PROJECTION_CONTEXT_COLLECTION/);
  assert.match(source, /projection_accuracy_projection_context/);
  assert.match(source, /if \(String\(brandId \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "cyj"\)/);
  assert.match(source, /getBrandCollection\(brandId, PROJECTION_CONTEXT_COLLECTION\)\.doc\(yearMonth\)/);
  assert.match(source, /buildProspectiveShadowCandidate/);
  assert.doesNotMatch(source, /onSnapshot\s*\(/);
  assert.doesNotMatch(source, /setInterval\s*\(/);

  const indexSource = read("functions/index.js");
  assert.match(indexSource, /exports\.captureProjectionAccuracyCheckpoint/);
  assert.doesNotMatch(indexSource, /b3d-prospective-vip-shadow-v1/);

  const candidate = read("functions/projectionShadowCandidate.js");
  assert.doesNotMatch(candidate, /finalActual/);
  assert.doesNotMatch(candidate, /daily_reports|dashboard_summary|monthly_aggregated/);
  assert.doesNotMatch(candidate, /get\(|getAll\(|where\(|onSnapshot|setInterval/);
});
