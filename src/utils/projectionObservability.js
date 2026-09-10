import {
  PROJECTION_MODEL_SCHEMA_VERSION,
  PROJECTION_SEMANTIC_VERSION,
  PROJECTION_MIN_PHASE_SOURCE_MONTHS,
  PROJECTION_PHASE_MIN_DAYS_PASSED,
  PROJECTION_PHASE_SCHEMA_VERSION,
  PROJECTION_STRATEGY_V2,
  PROJECTION_V2_BRANDS,
  getExpectedProjectionSourceMonths,
} from "./projectionModelConsumer.js";

const normalizeBrandId = (value = "") => {
  const text = String(value || "").trim().toLowerCase();
  if (["cyj", "drcyj", "default", "default-app-id"].includes(text)) return "cyj";
  if (["anniu", "anew", "安妞"].includes(text)) return "anniu";
  if (["yibo", "伊啵"].includes(text)) return "yibo";
  return "";
};

const normalizeYearMonth = (value = "") => {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
};

const sameArray = (left = [], right = []) =>
  JSON.stringify(Array.isArray(left) ? left : [])
  === JSON.stringify(Array.isArray(right) ? right : []);

export const getTaipeiProjectionYearMonth = (now = new Date()) => {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  return normalizeYearMonth(`${year}-${month}`);
};

const buildPhaseMetricStatus = (metric = null) => {
  const sourceMonthCount = Math.max(0, Number(metric?.sourceMonthCount || 0));
  const completeSourceMonths = Array.isArray(metric?.completeSourceMonths)
    ? metric.completeSourceMonths.map(normalizeYearMonth).filter(Boolean)
    : [];
  const reliable = metric?.reliable === true
    && sourceMonthCount >= PROJECTION_MIN_PHASE_SOURCE_MONTHS;

  return { reliable, sourceMonthCount, completeSourceMonths };
};

export const buildProjectionObservabilitySnapshot = ({
  model = null,
  brandId = "",
  currentYearMonth = "",
} = {}) => {
  const normalizedBrandId = normalizeBrandId(brandId);
  const selectedYearMonth = normalizeYearMonth(currentYearMonth);
  const expectedSourceMonths = getExpectedProjectionSourceMonths(selectedYearMonth);
  const v2Expected = PROJECTION_V2_BRANDS.includes(normalizedBrandId);

  const base = {
    brandId: normalizedBrandId,
    currentYearMonth: selectedYearMonth,
    expectedSourceMonths,
    exists: Boolean(model && typeof model === "object"),
    status: "missing",
    statusLabel: "模型尚未讀取",
    statusDetail: "",
    strategyLabel: v2Expected ? "V2 預期" : "V1",
    v2Expected,
    v2Active: false,
    modelMonth: "",
    modelMonthCurrent: false,
    sourceMonths: [],
    sourceMonthsCurrent: false,
    schemaVersion: "",
    semanticVersion: "",
    strategyVersion: "",
    phaseSchemaVersion: "",
    phaseMinDay: PROJECTION_PHASE_MIN_DAYS_PASSED,
    phaseSourceMonthMinimum: PROJECTION_MIN_PHASE_SOURCE_MONTHS,
    cashPhase: buildPhaseMetricStatus(null),
    accrualPhase: buildPhaseMetricStatus(null),
    generatedAtText: "",
    trigger: "",
    storeCount: 0,
    excludedStoreCount: 0,
  };

  if (!base.exists) {
    return {
      ...base,
      status: "missing",
      statusLabel: "Projection Model 不存在",
      statusDetail: "目前品牌找不到 projection_models/current。",
    };
  }

  const modelBrandId = normalizeBrandId(model?.brandId);
  const modelMonth = normalizeYearMonth(model?.modelMonth);
  const sourceMonths = Array.isArray(model?.sourceMonths)
    ? model.sourceMonths.map(normalizeYearMonth).filter(Boolean)
    : [];
  const phase = model?.brand?.phaseCalibration || null;
  const phaseSchemaVersion = String(phase?.schemaVersion || "");
  const strategyVersion = String(model?.strategyVersion || "");
  const v2Active = (
    v2Expected
    && strategyVersion === PROJECTION_STRATEGY_V2
    && phase?.enabled === true
    && phaseSchemaVersion === PROJECTION_PHASE_SCHEMA_VERSION
    && normalizeBrandId(phase?.brandId) === normalizedBrandId
    && String(phase?.strategyVersion || "") === PROJECTION_STRATEGY_V2
    && sameArray(phase?.sourceMonths || [], sourceMonths)
  );
  const cashPhase = buildPhaseMetricStatus(phase?.cash);
  const accrualPhase = buildPhaseMetricStatus(phase?.accrual);

  const snapshot = {
    ...base,
    exists: true,
    modelMonth,
    modelMonthCurrent: Boolean(selectedYearMonth && modelMonth === selectedYearMonth),
    sourceMonths,
    sourceMonthsCurrent: Boolean(expectedSourceMonths.length && sameArray(sourceMonths, expectedSourceMonths)),
    schemaVersion: String(model?.schemaVersion || ""),
    semanticVersion: String(model?.semanticVersion || ""),
    strategyVersion,
    phaseSchemaVersion,
    v2Active,
    strategyLabel: v2Active ? "V2 Phase Calibrated" : (v2Expected ? "V1 fallback / V2 未就緒" : "V1"),
    cashPhase,
    accrualPhase,
    generatedAtText: String(model?.generatedAtText || ""),
    trigger: String(model?.trigger || ""),
    storeCount: Object.keys(model?.stores || {}).length,
    excludedStoreCount: Array.isArray(model?.excludedStoreKeys) ? model.excludedStoreKeys.length : 0,
  };

  if (modelBrandId !== normalizedBrandId) {
    return {
      ...snapshot,
      status: "error",
      statusLabel: "品牌資料不一致",
      statusDetail: `文件 brandId=${modelBrandId || "unknown"}，目前品牌=${normalizedBrandId || "unknown"}。`,
    };
  }

  if (
    snapshot.schemaVersion !== PROJECTION_MODEL_SCHEMA_VERSION
    || snapshot.semanticVersion !== PROJECTION_SEMANTIC_VERSION
  ) {
    return {
      ...snapshot,
      status: "error",
      statusLabel: "Projection Model 版本不相容",
      statusDetail: `${snapshot.schemaVersion || "no-schema"} / ${snapshot.semanticVersion || "no-semantic"}`,
    };
  }

  if (!snapshot.modelMonthCurrent || !snapshot.sourceMonthsCurrent) {
    return {
      ...snapshot,
      status: "warning",
      statusLabel: "模型月份或來源月份待更新",
      statusDetail: `modelMonth=${snapshot.modelMonth || "-"}；sourceMonths=${snapshot.sourceMonths.join(", ") || "-"}`,
    };
  }

  if (v2Expected) {
    if (!snapshot.v2Active) {
      return {
        ...snapshot,
        status: "warning",
        statusLabel: "V2 Phase 尚未就緒",
        statusDetail: "目前品牌應使用 V2，但 strategy / phase metadata 尚未同時符合正式條件。",
      };
    }

    if (!snapshot.cashPhase.reliable || !snapshot.accrualPhase.reliable) {
      return {
        ...snapshot,
        status: "warning",
        statusLabel: "V2 部分指標 Phase 不可靠",
        statusDetail: `Cash=${snapshot.cashPhase.reliable ? "READY" : "FALLBACK"}；Accrual=${snapshot.accrualPhase.reliable ? "READY" : "FALLBACK"}`,
      };
    }

    return {
      ...snapshot,
      status: "healthy",
      statusLabel: "V2 模型狀態正常",
      statusDetail: "Cash / Accrual Phase 均符合目前模型文件的 reliability 條件。",
    };
  }

  if (strategyVersion === PROJECTION_STRATEGY_V2 || phase?.enabled === true) {
    return {
      ...snapshot,
      status: "warning",
      statusLabel: "V1 品牌出現非預期 V2 metadata",
      statusDetail: "目前品牌尚未核准切換 V2，請先做 readiness / backtest audit。",
    };
  }

  return {
    ...snapshot,
    status: "healthy",
    statusLabel: "V1 模型狀態正常",
    statusDetail: "目前品牌維持 V1；尚未啟用品牌 Phase Calibration。",
  };
};

export const getProjectionObservabilityTone = (status = "") => {
  if (status === "healthy") return "emerald";
  if (status === "error") return "rose";
  return "amber";
};
