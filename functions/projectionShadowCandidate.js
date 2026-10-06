"use strict";

const { createHash } = require("node:crypto");
const { PROJECTION_CONTEXT_SCHEMA_VERSION } = require("./projectionContext");

const PROSPECTIVE_SHADOW_SCHEMA_VERSION = "projection-prospective-shadow-v1";
const PROSPECTIVE_SHADOW_CANDIDATE_ID = "b3d-prospective-vip-shadow-v1";
const PROSPECTIVE_SHADOW_ELIGIBLE_BRAND = "cyj";
const PROSPECTIVE_SHADOW_ELIGIBLE_EVENT_TYPE = "vip";
const PROSPECTIVE_SHADOW_ELIGIBLE_SCOPE_MODE = "brand";

const PROSPECTIVE_SHADOW_FACTORS = Object.freeze({
  cash: Object.freeze({"day05": 1.2, "day07": 1.183422, "day10": 1.2, "day15": 1.180629, "day20": 1.057073, "day25": 1.013028}),
  accrual: Object.freeze({"day05": 1.153406, "day07": 1.134127, "day10": 1.137281, "day15": 1.124179, "day20": 1.100268, "day25": 1.077505}),
});

const PROSPECTIVE_SHADOW_CALIBRATION = Object.freeze({
  schemaVersion: "smart-forecast-b3d-prospective-candidate-calibration-v2",
  calibrationJsonSha256: "1a621257401759b21505894dcfefa0b33ff0b3137cf8199f1a1a2281670ae12b",
  candidateId: PROSPECTIVE_SHADOW_CANDIDATE_ID,
  campaignCount: 1,
  campaignId: "vip-tea-2026-03-04",
  trainingMonths: Object.freeze(["2026-03", "2026-04"]),
  independentCampaignValidation: false,
  b3c1c3ExactSourceRecovered: false,
  productionPromotionAllowed: false,
  storeSchedulePolicy: "evidence_only",
});

const ACCRUAL_RESIDUAL_SHADOW_SCHEMA_VERSION = "projection-accrual-residual-shadow-v1";
const ACCRUAL_RESIDUAL_SHADOW_CANDIDATE_ID = "projection-accrual-residual-shadow-v1";
const ACCRUAL_RESIDUAL_SHADOW_ACTIVATION_DATE = "2026-10-07";
const ACCRUAL_RESIDUAL_SHADOW_ELIGIBLE_BRANDS = Object.freeze(["cyj", "anniu"]);
const ACCRUAL_RESIDUAL_SHADOW_FACTORS = Object.freeze({
  cyj: Object.freeze({
    day05: 1.0671806264189028,
    day07: 1.0868747631985327,
    day10: 1.1156821451817756,
    day15: 1.132807108115948,
    day20: 1.0997853009721472,
    day25: 1.066560146611014,
  }),
  anniu: Object.freeze({
    day05: 1.1312958364066337,
    day07: 1.1024797739350842,
    day10: 1.120625722389392,
    day15: 1.101014900476267,
    day20: 1.0627454466241164,
    day25: 1.0411009537749896,
  }),
});
const ACCRUAL_RESIDUAL_SHADOW_CALIBRATION = Object.freeze({
  schemaVersion: "projection-accrual-residual-shadow-calibration-v1",
  candidateId: ACCRUAL_RESIDUAL_SHADOW_CANDIDATE_ID,
  metric: "accrual",
  trainingMonths: Object.freeze(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]),
  independentMonthCountPerBrand: 5,
  validationMethod: "leave-one-month-out",
  cashChanged: false,
  accrualFormalChanged: false,
  shadowOnly: true,
  productionPromotionAllowed: false,
  automaticPromotionAllowed: false,
});

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const safeArray = (value) => Array.isArray(value) ? value : [];

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeYearMonth(value = "") {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
}

function normalizeBrandId(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (["cyj", "drcyj", "default", "default-app-id"].includes(text)) return "cyj";
  if (["anniu", "anew", "安妞"].includes(text)) return "anniu";
  if (["yibo", "伊啵"].includes(text)) return "yibo";
  return "";
}

function sanitizeSchedule(rows = []) {
  return safeArray(rows)
    .map((row = {}) => ({
      storeKey: String(row?.storeKey || ""),
      startDate: String(row?.startDate || ""),
      endDate: String(row?.endDate || ""),
    }))
    .filter((row) => row.storeKey && row.startDate && row.endDate)
    .sort((left, right) =>
      left.startDate.localeCompare(right.startDate)
      || left.storeKey.localeCompare(right.storeKey, "zh-Hant")
    );
}

function sanitizeRelevantEvent(raw = {}) {
  const metrics = [...new Set(
    safeArray(raw?.metrics)
      .map((value) => String(value || "").trim().toLowerCase())
      .filter((value) => ["cash", "accrual"].includes(value))
  )].sort();

  return {
    id: String(raw?.id || ""),
    campaignId: String(raw?.campaignId || raw?.id || ""),
    name: String(raw?.name || ""),
    type: String(raw?.type || ""),
    level: String(raw?.level || ""),
    scopeMode: String(raw?.scopeMode || ""),
    startDate: String(raw?.startDate || ""),
    endDate: String(raw?.endDate || ""),
    metrics,
    storeSchedule: sanitizeSchedule(raw?.storeSchedule),
  };
}

function inspectProspectiveShadowContext({ brandId = "", yearMonth = "", context = null } = {}) {
  const normalizedBrandId = normalizeBrandId(brandId);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);

  if (normalizedBrandId !== PROSPECTIVE_SHADOW_ELIGIBLE_BRAND) {
    return {
      trusted: false,
      reason: "BRAND_NOT_ELIGIBLE",
      revision: 0,
      updatedAtText: "",
      relevantEvents: [],
      contextHash: "",
    };
  }
  if (!context || typeof context !== "object") {
    return {
      trusted: false,
      reason: "CONTEXT_MISSING",
      revision: 0,
      updatedAtText: "",
      relevantEvents: [],
      contextHash: "",
    };
  }
  if (String(context?.schemaVersion || "") !== PROJECTION_CONTEXT_SCHEMA_VERSION) {
    return {
      trusted: false,
      reason: "CONTEXT_SCHEMA_MISMATCH",
      revision: 0,
      updatedAtText: String(context?.updatedAtText || ""),
      relevantEvents: [],
      contextHash: "",
    };
  }
  if (normalizeBrandId(context?.brandId) !== normalizedBrandId) {
    return {
      trusted: false,
      reason: "CONTEXT_BRAND_MISMATCH",
      revision: 0,
      updatedAtText: String(context?.updatedAtText || ""),
      relevantEvents: [],
      contextHash: "",
    };
  }
  if (normalizeYearMonth(context?.yearMonth) !== normalizedYearMonth) {
    return {
      trusted: false,
      reason: "CONTEXT_MONTH_MISMATCH",
      revision: 0,
      updatedAtText: String(context?.updatedAtText || ""),
      relevantEvents: [],
      contextHash: "",
    };
  }

  const revision = Number(context?.revision);
  if (!Number.isInteger(revision) || revision < 1) {
    return {
      trusted: false,
      reason: "CONTEXT_REVISION_INVALID",
      revision: 0,
      updatedAtText: String(context?.updatedAtText || ""),
      relevantEvents: [],
      contextHash: "",
    };
  }

  const events = safeArray(context?.events);
  const mode = String(context?.mode || "");
  if ((events.length > 0 && mode !== "event_month") || (events.length === 0 && mode !== "normal_month")) {
    return {
      trusted: false,
      reason: "CONTEXT_MODE_MISMATCH",
      revision,
      updatedAtText: String(context?.updatedAtText || ""),
      relevantEvents: [],
      contextHash: "",
    };
  }

  const relevantEvents = events
    .filter((event) =>
      String(event?.type || "") === PROSPECTIVE_SHADOW_ELIGIBLE_EVENT_TYPE
      && String(event?.scopeMode || "") === PROSPECTIVE_SHADOW_ELIGIBLE_SCOPE_MODE
    )
    .map(sanitizeRelevantEvent)
    .sort((left, right) =>
      left.startDate.localeCompare(right.startDate)
      || left.name.localeCompare(right.name, "zh-Hant")
      || left.id.localeCompare(right.id)
    );

  const snapshot = {
    schemaVersion: String(context?.schemaVersion || ""),
    brandId: normalizedBrandId,
    yearMonth: normalizedYearMonth,
    revision,
    mode,
    updatedAtText: String(context?.updatedAtText || ""),
    relevantEvents,
  };

  return {
    trusted: true,
    reason: relevantEvents.length ? "VIP_CONTEXT_READY" : "NO_ELIGIBLE_VIP_EVENT",
    revision,
    updatedAtText: snapshot.updatedAtText,
    relevantEvents,
    contextHash: stableHash(snapshot),
  };
}

function buildProspectiveMetricState({
  metric = "cash",
  checkpointKey = "",
  actualToDate = null,
  formalRange = null,
  contextEvidence = null,
} = {}) {
  const normalizedMetric = metric === "accrual" ? "accrual" : "cash";
  const factor = Number(PROSPECTIVE_SHADOW_FACTORS?.[normalizedMetric]?.[checkpointKey]);

  const ineligible = (reason) => ({
    eligible: false,
    reason,
    standard: null,
    factor: Number.isFinite(factor) ? factor : null,
    actualToDate: isFiniteNumber(actualToDate) ? Math.round(actualToDate) : null,
    formalStandard: isFiniteNumber(formalRange?.standard) ? Math.round(formalRange.standard) : null,
    remainingForecast: null,
  });

  if (!contextEvidence?.trusted) return ineligible(String(contextEvidence?.reason || "CONTEXT_NOT_TRUSTED"));
  if (!Number.isFinite(factor) || factor <= 0) return ineligible("CALIBRATION_FACTOR_MISSING");

  const metricEvents = safeArray(contextEvidence?.relevantEvents)
    .filter((event) => safeArray(event?.metrics).includes(normalizedMetric));
  if (!metricEvents.length) return ineligible("NO_ELIGIBLE_VIP_EVENT_FOR_METRIC");

  if (!isFiniteNumber(actualToDate)) return ineligible("ACTUAL_TO_DATE_NOT_VALID");
  const formalStandard = formalRange?.standard;
  if (!isFiniteNumber(formalStandard)) return ineligible("FORMAL_STANDARD_NOT_VALID");

  const remainingForecast = Number(formalStandard) - Number(actualToDate);
  if (!Number.isFinite(remainingForecast) || remainingForecast < 0) {
    return ineligible("FORMAL_REMAINING_NEGATIVE");
  }

  return {
    eligible: true,
    reason: "ELIGIBLE",
    standard: Math.round(Number(actualToDate) + remainingForecast * factor),
    factor,
    actualToDate: Math.round(Number(actualToDate)),
    formalStandard: Math.round(Number(formalStandard)),
    remainingForecast: Math.round(remainingForecast),
    eligibleEventCount: metricEvents.length,
  };
}

function buildAccrualResidualShadowCandidate({
  brandId = "",
  checkpointKey = "",
  cutoffDate = "",
  effectiveAccrual = null,
} = {}) {
  const normalizedBrandId = normalizeBrandId(brandId);
  const factor = Number(ACCRUAL_RESIDUAL_SHADOW_FACTORS?.[normalizedBrandId]?.[checkpointKey]);

  const ineligible = (reason) => ({
    schemaVersion: ACCRUAL_RESIDUAL_SHADOW_SCHEMA_VERSION,
    candidateId: ACCRUAL_RESIDUAL_SHADOW_CANDIDATE_ID,
    status: "SHADOW_INELIGIBLE",
    productionFormulaChanged: false,
    automaticPromotionAllowed: false,
    metric: "accrual",
    brandId: normalizedBrandId,
    checkpointKey: String(checkpointKey || ""),
    cutoffDate: String(cutoffDate || ""),
    eligible: false,
    reason,
    factor: Number.isFinite(factor) ? factor : null,
    formalStandard: isFiniteNumber(effectiveAccrual?.standard)
      ? Math.round(effectiveAccrual.standard)
      : null,
    standard: null,
    calibration: ACCRUAL_RESIDUAL_SHADOW_CALIBRATION,
  });

  if (!ACCRUAL_RESIDUAL_SHADOW_ELIGIBLE_BRANDS.includes(normalizedBrandId)) {
    return ineligible("BRAND_NOT_ELIGIBLE");
  }
  if (!/^day(05|07|10|15|20|25)$/.test(String(checkpointKey || ""))) {
    return ineligible("CHECKPOINT_NOT_ELIGIBLE");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(cutoffDate || ""))) {
    return ineligible("CUTOFF_DATE_INVALID");
  }
  if (String(cutoffDate) < ACCRUAL_RESIDUAL_SHADOW_ACTIVATION_DATE) {
    return ineligible("BEFORE_CANDIDATE_ACTIVATION");
  }
  if (!Number.isFinite(factor) || factor < 1 || factor > 1.2) {
    return ineligible("CALIBRATION_FACTOR_INVALID");
  }
  if (!isFiniteNumber(effectiveAccrual?.standard)) {
    return ineligible("FORMAL_STANDARD_NOT_VALID");
  }

  const formalStandard = Math.round(Number(effectiveAccrual.standard));
  const standard = Math.round(Number(effectiveAccrual.standard) * factor);

  return {
    schemaVersion: ACCRUAL_RESIDUAL_SHADOW_SCHEMA_VERSION,
    candidateId: ACCRUAL_RESIDUAL_SHADOW_CANDIDATE_ID,
    status: "SHADOW_ELIGIBLE",
    productionFormulaChanged: false,
    automaticPromotionAllowed: false,
    metric: "accrual",
    brandId: normalizedBrandId,
    checkpointKey: String(checkpointKey || ""),
    cutoffDate: String(cutoffDate || ""),
    eligible: true,
    reason: "ELIGIBLE",
    factor,
    formalStandard,
    standard,
    calibration: ACCRUAL_RESIDUAL_SHADOW_CALIBRATION,
  };
}

function buildProspectiveShadowCandidate({
  brandId = "",
  yearMonth = "",
  checkpointKey = "",
  cutoffDate = "",
  capturedAtText = "",
  context = null,
  actual = {},
  effective = {},
} = {}) {
  const normalizedBrandId = normalizeBrandId(brandId);
  const contextEvidence = inspectProspectiveShadowContext({
    brandId: normalizedBrandId,
    yearMonth,
    context,
  });

  const cash = buildProspectiveMetricState({
    metric: "cash",
    checkpointKey,
    actualToDate: actual?.cash,
    formalRange: effective?.cash,
    contextEvidence,
  });
  const accrual = buildProspectiveMetricState({
    metric: "accrual",
    checkpointKey,
    actualToDate: actual?.accrual,
    formalRange: effective?.accrual,
    contextEvidence,
  });

  return {
    schemaVersion: PROSPECTIVE_SHADOW_SCHEMA_VERSION,
    candidateId: PROSPECTIVE_SHADOW_CANDIDATE_ID,
    status: cash.eligible || accrual.eligible ? "SHADOW_ELIGIBLE" : "SHADOW_INELIGIBLE",
    productionFormulaChanged: false,
    automaticPromotionAllowed: false,
    brandId: normalizedBrandId,
    yearMonth: normalizeYearMonth(yearMonth),
    checkpointKey: String(checkpointKey || ""),
    cutoffDate: String(cutoffDate || ""),
    capturedAtText: String(capturedAtText || ""),
    context: contextEvidence,
    cash,
    accrual,
    calibration: PROSPECTIVE_SHADOW_CALIBRATION,
  };
}

module.exports = {
  PROSPECTIVE_SHADOW_SCHEMA_VERSION,
  PROSPECTIVE_SHADOW_CANDIDATE_ID,
  PROSPECTIVE_SHADOW_ELIGIBLE_BRAND,
  PROSPECTIVE_SHADOW_FACTORS,
  PROSPECTIVE_SHADOW_CALIBRATION,
  ACCRUAL_RESIDUAL_SHADOW_SCHEMA_VERSION,
  ACCRUAL_RESIDUAL_SHADOW_CANDIDATE_ID,
  ACCRUAL_RESIDUAL_SHADOW_ACTIVATION_DATE,
  ACCRUAL_RESIDUAL_SHADOW_ELIGIBLE_BRANDS,
  ACCRUAL_RESIDUAL_SHADOW_FACTORS,
  ACCRUAL_RESIDUAL_SHADOW_CALIBRATION,
  inspectProspectiveShadowContext,
  buildProspectiveMetricState,
  buildProspectiveShadowCandidate,
  buildAccrualResidualShadowCandidate,
};
