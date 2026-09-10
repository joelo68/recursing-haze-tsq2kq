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
import {
  PROJECTION_ACCURACY_HISTORICAL_EVIDENCE,
} from "../data/projectionAccuracyHistoricalEvidence.js";

export const PROJECTION_ACCURACY_SCHEMA_VERSION = "projection-accuracy-v1";
export const PROJECTION_ACCURACY_CHECKPOINT_SEMANTIC_VERSION = "projection-accuracy-checkpoint-v1";
export const PROJECTION_ACCURACY_SCORE_SEMANTIC_VERSION = "projection-accuracy-score-v1";
export const PROJECTION_ACCURACY_FINAL_ACTUAL_SOURCE = "verified_dashboard_summary";
export const PROJECTION_ACCURACY_CHECKPOINT_KEYS = Object.freeze([
  "day05",
  "day07",
  "day10",
  "day15",
  "day20",
  "day25",
]);

export const PROJECTION_ACCURACY_METHOD_LABELS = Object.freeze({
  effective: "目前使用的推估方式",
  shadowV1: "原本推估方式",
  currentPace: "依目前進度推估",
});

export const PROJECTION_HISTORICAL_METHOD_LABELS = Object.freeze({
  effective: "智慧校正推估",
  shadowV1: "原本推估方式",
  currentPace: "依目前進度推估",
});

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


const normalizePersistedScoreSummary = (summary = null) => {
  if (!summary || typeof summary !== "object") {
    return {
      count: 0,
      actualSum: null,
      absErrorSum: null,
      errorSum: null,
      wapePct: null,
      biasPct: null,
      meanApePct: null,
    };
  }

  const finiteOrNull = (value) => (
    typeof value === "number" && Number.isFinite(value) ? value : null
  );

  const rawCount = Number(summary.count);
  return {
    count: Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0,
    actualSum: finiteOrNull(summary.actualSum),
    absErrorSum: finiteOrNull(summary.absErrorSum),
    errorSum: finiteOrNull(summary.errorSum),
    wapePct: finiteOrNull(summary.wapePct),
    biasPct: finiteOrNull(summary.biasPct),
    meanApePct: finiteOrNull(summary.meanApePct),
  };
};

const buildPersistedMethodComparison = (metricOverall = {}, { includeShadowV1 = true } = {}) => {
  const methods = {
    effective: normalizePersistedScoreSummary(metricOverall?.effective),
    shadowV1: normalizePersistedScoreSummary(metricOverall?.shadowV1),
    currentPace: normalizePersistedScoreSummary(metricOverall?.currentPace),
    effectiveV2AppliedOnly: normalizePersistedScoreSummary(metricOverall?.effectiveV2AppliedOnly),
  };

  const comparableKeys = ["effective", ...(includeShadowV1 ? ["shadowV1"] : []), "currentPace"]
    .filter((key) => methods[key].count > 0 && methods[key].wapePct !== null);

  const bestWape = comparableKeys.length
    ? Math.min(...comparableKeys.map((key) => methods[key].wapePct))
    : null;
  const bestMethods = bestWape === null
    ? []
    : comparableKeys.filter((key) => Math.abs(methods[key].wapePct - bestWape) <= 1e-9);

  return { methods, bestMethods };
};

const normalizeCheckpointScore = (state = null) => {
  const score = state?.score && typeof state.score === "object" ? state.score : null;
  const finiteOrNull = (value) => (
    typeof value === "number" && Number.isFinite(value) ? value : null
  );
  return {
    eligible: state?.eligible === true,
    reason: String(state?.reason || ""),
    checkpointReasons: Array.isArray(state?.checkpointReasons)
      ? state.checkpointReasons.map(String)
      : [],
    forecast: finiteOrNull(score?.forecast),
    actual: finiteOrNull(score?.actual),
    error: finiteOrNull(score?.error),
    absError: finiteOrNull(score?.absError),
    apePct: finiteOrNull(score?.apePct),
    accuracyPctDisplay: finiteOrNull(score?.accuracyPctDisplay),
    biasPct: finiteOrNull(score?.biasPct),
  };
};

export const buildProjectionAccuracyObservabilitySnapshot = ({
  accuracy = null,
  brandId = "",
  yearMonth = "",
  currentYearMonth = "",
} = {}) => {
  const normalizedBrandId = normalizeBrandId(brandId);
  const selectedYearMonth = normalizeYearMonth(yearMonth);
  const normalizedCurrentMonth = normalizeYearMonth(currentYearMonth);
  const v2Expected = PROJECTION_V2_BRANDS.includes(normalizedBrandId);

  const base = {
    brandId: normalizedBrandId,
    yearMonth: selectedYearMonth,
    currentYearMonth: normalizedCurrentMonth,
    exists: Boolean(accuracy && typeof accuracy === "object"),
    status: "missing",
    statusLabel: "尚無推估驗證資料",
    statusDetail: "",
    schemaVersion: "",
    semanticVersion: "",
    scoreSemanticVersion: "",
    scoreRevision: 0,
    scoredAtText: "",
    updatedAtText: "",
    checkpointKeys: [],
    checkpointCount: 0,
    expectedCheckpointCount: PROJECTION_ACCURACY_CHECKPOINT_KEYS.length,
    scoringAvailable: false,
    finalActual: {
      source: "",
      cash: null,
      accrual: null,
    },
    v2Expected,
    v2AppliedCheckpointCount: {
      cash: 0,
      accrual: 0,
    },
    metrics: {
      cash: buildPersistedMethodComparison({}, { includeShadowV1: true }),
      accrual: buildPersistedMethodComparison({}, { includeShadowV1: true }),
    },
    checkpointRows: [],
  };

  if (!normalizedBrandId || !selectedYearMonth) {
    return {
      ...base,
      status: "error",
      statusLabel: "推估驗證查詢範圍無效",
      statusDetail: "品牌或月份格式無法辨識。",
    };
  }

  if (!base.exists) {
    const isCurrent = normalizedCurrentMonth && selectedYearMonth === normalizedCurrentMonth;
    return {
      ...base,
      status: "warning",
      statusLabel: isCurrent ? "本月尚未累積驗證時間點" : "此月份沒有正式驗證紀錄",
      statusDetail: isCurrent
        ? "系統會在每月 5 / 7 / 10 / 15 / 20 / 25 日保存驗證時間點；尚未到保存日或當日紀錄尚未建立。"
        : "此月份沒有正式月份驗證紀錄；畫面不會用其他資料自行補出結果。",
    };
  }

  const documentBrandId = normalizeBrandId(accuracy?.brandId);
  const documentYearMonth = normalizeYearMonth(accuracy?.yearMonth);
  const schemaVersion = String(accuracy?.schemaVersion || "");
  const semanticVersion = String(accuracy?.semanticVersion || "");
  const checkpoints = accuracy?.checkpoints && typeof accuracy.checkpoints === "object"
    ? accuracy.checkpoints
    : {};
  const checkpointKeys = PROJECTION_ACCURACY_CHECKPOINT_KEYS.filter((key) => Boolean(checkpoints[key]));
  const checkpointCount = checkpointKeys.length;

  const phaseAppliedCount = (metric) => checkpointKeys.reduce(
    (count, key) => count + (checkpoints[key]?.model?.runtimePhase?.[metric]?.phaseApplied === true ? 1 : 0),
    0
  );
  const v2AppliedCheckpointCount = {
    cash: phaseAppliedCount("cash"),
    accrual: phaseAppliedCount("accrual"),
  };

  const snapshot = {
    ...base,
    exists: true,
    schemaVersion,
    semanticVersion,
    updatedAtText: String(accuracy?.updatedAtText || ""),
    checkpointKeys,
    checkpointCount,
    v2AppliedCheckpointCount,
  };

  if (documentBrandId !== normalizedBrandId) {
    return {
      ...snapshot,
      status: "error",
      statusLabel: "推估驗證品牌資料不一致",
      statusDetail: `文件 brandId=${documentBrandId || "unknown"}，目前品牌=${normalizedBrandId}.`,
    };
  }

  if (documentYearMonth !== selectedYearMonth) {
    return {
      ...snapshot,
      status: "error",
      statusLabel: "推估驗證月份資料不一致",
      statusDetail: `文件 yearMonth=${documentYearMonth || "unknown"}，查詢月份=${selectedYearMonth}.`,
    };
  }

  if (
    schemaVersion !== PROJECTION_ACCURACY_SCHEMA_VERSION
    || semanticVersion !== PROJECTION_ACCURACY_CHECKPOINT_SEMANTIC_VERSION
  ) {
    return {
      ...snapshot,
      status: "error",
      statusLabel: "推估驗證資料版本不相容",
      statusDetail: `${schemaVersion || "no-schema"} / ${semanticVersion || "no-semantic"}`,
    };
  }

  if (!v2Expected && (v2AppliedCheckpointCount.cash > 0 || v2AppliedCheckpointCount.accrual > 0)) {
    return {
      ...snapshot,
      status: "error",
      statusLabel: "推估方式資料不一致",
      statusDetail: "此品牌目前使用標準推估，不應出現智慧校正的驗證紀錄；畫面已停止顯示該份結果。",
    };
  }

  const scoreMeta = accuracy?.scoreMeta && typeof accuracy.scoreMeta === "object"
    ? accuracy.scoreMeta
    : null;
  const scorecard = accuracy?.scorecard && typeof accuracy.scorecard === "object"
    ? accuracy.scorecard
    : null;
  const finalActual = accuracy?.finalActual && typeof accuracy.finalActual === "object"
    ? accuracy.finalActual
    : null;

  if (!scoreMeta || !scorecard || !finalActual) {
    const isCurrent = normalizedCurrentMonth && selectedYearMonth === normalizedCurrentMonth;
    return {
      ...snapshot,
      status: "warning",
      statusLabel: isCurrent ? "驗證時間點累積中" : "等待月底驗證結果",
      statusDetail: checkpointCount
        ? `已保存 ${checkpointCount}/${PROJECTION_ACCURACY_CHECKPOINT_KEYS.length} 個驗證時間點；目前尚未完成月底正式業績。`
        : "月份驗證紀錄已建立，但目前還沒有可比較的時間點。",
    };
  }

  const scoreSemanticVersion = String(scoreMeta?.semanticVersion || "");
  if (scoreSemanticVersion !== PROJECTION_ACCURACY_SCORE_SEMANTIC_VERSION) {
    return {
      ...snapshot,
      scoreSemanticVersion,
      status: "error",
      statusLabel: "月底驗證資料版本不相容",
      statusDetail: "這份月底驗證紀錄使用不同資料版本，為避免誤判暫不顯示。",
    };
  }

  const finalActualSource = String(finalActual?.source || "");
  const finalAuthorityBrandId = normalizeBrandId(finalActual?.authority?.brandId);
  const finalAuthorityMonth = normalizeYearMonth(finalActual?.authority?.yearMonth);
  if (
    finalActualSource !== PROJECTION_ACCURACY_FINAL_ACTUAL_SOURCE
    || finalAuthorityBrandId !== normalizedBrandId
    || finalAuthorityMonth !== selectedYearMonth
  ) {
    return {
      ...snapshot,
      scoreSemanticVersion,
      status: "error",
      statusLabel: "月底實際業績來源不相容",
      statusDetail: "月底實際業績不是目前品牌與月份已確認的正式月結來源，為避免誤判暫不顯示。",
    };
  }

  const cashActual = (
    typeof finalActual?.cash?.value === "number" && Number.isFinite(finalActual.cash.value)
      ? finalActual.cash.value
      : null
  );
  const accrualActual = (
    typeof finalActual?.accrual?.value === "number" && Number.isFinite(finalActual.accrual.value)
      ? finalActual.accrual.value
      : null
  );
  if (cashActual === null || accrualActual === null) {
    return {
      ...snapshot,
      scoreSemanticVersion,
      status: "error",
      statusLabel: "月底實際業績資料不完整",
      statusDetail: "正式月底現金或權責業績缺少有效數值；畫面不會自行補算。",
    };
  }

  const metrics = {
    cash: buildPersistedMethodComparison(scorecard?.overall?.cash, { includeShadowV1: true }),
    accrual: buildPersistedMethodComparison(scorecard?.overall?.accrual, { includeShadowV1: true }),
  };

  const checkpointRows = checkpointKeys.map((checkpointKey) => {
    const persisted = scorecard?.byCheckpoint?.[checkpointKey] || {};
    const checkpoint = checkpoints[checkpointKey] || {};
    return {
      checkpointKey,
      cutoffDate: String(persisted?.cutoffDate || checkpoint?.cutoffDate || ""),
      cutoffDay: Math.max(0, Number(persisted?.cutoffDay || checkpoint?.cutoffDay || 0)),
      phaseApplied: {
        cash: checkpoint?.model?.runtimePhase?.cash?.phaseApplied === true,
        accrual: checkpoint?.model?.runtimePhase?.accrual?.phaseApplied === true,
      },
      cash: {
        effective: normalizeCheckpointScore(persisted?.cash?.effective),
        shadowV1: normalizeCheckpointScore(persisted?.cash?.shadowV1),
        currentPace: normalizeCheckpointScore(persisted?.cash?.currentPace),
      },
      accrual: {
        effective: normalizeCheckpointScore(persisted?.accrual?.effective),
        shadowV1: normalizeCheckpointScore(persisted?.accrual?.shadowV1),
        currentPace: normalizeCheckpointScore(persisted?.accrual?.currentPace),
      },
    };
  });

  return {
    ...snapshot,
    status: "healthy",
    statusLabel: "月底驗證結果已建立",
    statusDetail: `已使用正式月底業績完成 ${checkpointCount} 個驗證時間點的比較；畫面只呈現已保存結果，不重新推算。`,
    scoreSemanticVersion,
    scoreRevision: Math.max(0, Number(scoreMeta?.scoreRevision || 0)),
    scoredAtText: String(scoreMeta?.scoredAtText || accuracy?.scoreUpdatedAtText || ""),
    scoringAvailable: true,
    finalActual: {
      source: finalActualSource,
      cash: {
        value: cashActual,
        status: String(finalActual?.cash?.status || ""),
      },
      accrual: {
        value: accrualActual,
        status: String(finalActual?.accrual?.status || ""),
      },
    },
    metrics,
    checkpointRows,
  };
};


export const getProjectionAccuracyDisplayPct = (wapePct) => {
  if (typeof wapePct !== "number" || !Number.isFinite(wapePct)) return null;
  return Math.max(0, Math.min(100, 100 - wapePct));
};

export const describeProjectionBias = (biasPct) => {
  if (typeof biasPct !== "number" || !Number.isFinite(biasPct)) return "偏差資料不足";
  const magnitude = Math.abs(biasPct);
  if (magnitude < 0.005) return "平均接近實際";
  return `平均${biasPct < 0 ? "偏低" : "偏高"} ${magnitude.toFixed(2)}%`;
};

const buildHistoricalDisplayScore = (score = null) => {
  const count = Math.max(0, Number(score?.count || 0));
  const wapePct = typeof score?.wapePct === "number" && Number.isFinite(score.wapePct)
    ? score.wapePct
    : null;
  const biasPct = typeof score?.biasPct === "number" && Number.isFinite(score.biasPct)
    ? score.biasPct
    : null;
  return {
    count,
    accuracyPct: getProjectionAccuracyDisplayPct(wapePct),
    averageErrorPct: wapePct,
    biasPct,
    tendencyLabel: describeProjectionBias(biasPct),
  };
};

const buildHistoricalMethodSet = (raw = {}) => {
  const methods = Object.fromEntries(
    ["effective", "shadowV1", "currentPace"].map((key) => [
      key,
      buildHistoricalDisplayScore(raw?.[key]),
    ])
  );
  const comparable = Object.entries(methods)
    .filter(([, score]) => score.count > 0 && score.accuracyPct !== null);
  const bestAccuracy = comparable.length
    ? Math.max(...comparable.map(([, score]) => score.accuracyPct))
    : null;
  const bestMethods = bestAccuracy === null
    ? []
    : comparable
      .filter(([, score]) => Math.abs(score.accuracyPct - bestAccuracy) <= 1e-9)
      .map(([key]) => key);
  return { methods, bestMethods };
};

export const buildProjectionHistoricalAccuracyComparison = ({
  brandId = "",
  evidence = PROJECTION_ACCURACY_HISTORICAL_EVIDENCE,
} = {}) => {
  const normalizedBrandId = normalizeBrandId(brandId);
  const supportedBrands = Array.isArray(evidence?.brandIds)
    ? evidence.brandIds.map(normalizeBrandId).filter(Boolean)
    : [];
  const targetMonths = Array.isArray(evidence?.targetMonths)
    ? evidence.targetMonths.map(normalizeYearMonth).filter(Boolean)
    : [];
  const checkpointDays = Array.isArray(evidence?.checkpointDays)
    ? evidence.checkpointDays.map((day) => Number(day)).filter((day) => Number.isFinite(day) && day > 0)
    : [];
  const brandEvidence = evidence?.brands?.[normalizedBrandId] || null;

  const base = {
    brandId: normalizedBrandId,
    available: false,
    status: "warning",
    statusLabel: "目前沒有相同口徑的歷史驗證資料",
    statusDetail: "歷史比較只顯示已完成且通過資料完整性檢查的既有驗證結果，不會用其他品牌或不同口徑資料補值。",
    evidenceVersion: String(evidence?.evidenceVersion || ""),
    generatedAtText: String(evidence?.generatedAtText || ""),
    sourceJsonSha256: String(evidence?.sourceJsonSha256 || ""),
    sourceReportSha256: String(evidence?.sourceReportSha256 || ""),
    targetMonths,
    checkpointDays,
    monthRangeLabel: targetMonths.length
      ? `${targetMonths[0].replace("-", " 年 ")} 月～${targetMonths[targetMonths.length - 1].slice(5)} 月`
      : "",
    trustedMonthCount: 0,
    rawRowCount: 0,
    displayReadCount: 0,
    originalAuditReads: Math.max(0, Number(evidence?.auditCost?.estimatedBilledReads || 0)),
    originalAuditWrites: Math.max(0, Number(evidence?.auditCost?.writes || 0)),
    metrics: {
      cash: { overall: buildHistoricalMethodSet({}), checkpoints: [] },
      accrual: { overall: buildHistoricalMethodSet({}), checkpoints: [] },
    },
  };

  if (!normalizedBrandId || !supportedBrands.includes(normalizedBrandId) || !brandEvidence) {
    return base;
  }

  const buildMetric = (metricKey) => {
    const rawMetric = brandEvidence?.metrics?.[metricKey] || {};
    return {
      overall: buildHistoricalMethodSet(rawMetric?.overall || {}),
      checkpoints: checkpointDays.map((day) => {
        const key = `day${String(day).padStart(2, "0")}`;
        return {
          checkpointKey: key,
          day,
          label: `${day} 日`,
          ...buildHistoricalMethodSet(rawMetric?.[key] || {}),
        };
      }),
    };
  };

  return {
    ...base,
    available: true,
    status: "healthy",
    statusLabel: "歷史驗證資料可用",
    statusDetail: `使用 ${targetMonths.length} 個已完成月份，比較每月 5 / 7 / 10 / 15 / 20 / 25 日當時的推估與月底實際業績。`,
    trustedMonthCount: Math.max(0, Number(brandEvidence?.trustedMonthCount || 0)),
    rawRowCount: Math.max(0, Number(brandEvidence?.rawRowCount || 0)),
    metrics: {
      cash: buildMetric("cash"),
      accrual: buildMetric("accrual"),
    },
  };
};


export const getProjectionObservabilityTone = (status = "") => {
  if (status === "healthy") return "emerald";
  if (status === "error") return "rose";
  return "amber";
};
