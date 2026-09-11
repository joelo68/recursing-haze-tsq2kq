// src/utils/kpiPresentation.js
// Presentation-only semantic mapping. It does not change KPI authority or validity.

const STATUS_LABELS = Object.freeze({
  TARGET_NOT_SET: "目標未設定",
  CHALLENGE_NOT_SET: "挑戰目標未設定",
  TARGET_INCOMPLETE: "目標資料不足",
  DATA_INCOMPLETE: "資料不足",
  FIELD_MISSING: "尚無資料",
  DATA_INVALID: "資料異常",
  N_A: "不適用",
  NOT_STARTED: "尚未開始",
  PRE_SYSTEM: "不納入",
  LIFECYCLE_NOT_READY: "營運期間未完成",
});

export const KPI_PRESENTATION_LABELS = STATUS_LABELS;

export const resolveKpiPresentationLabel = ({
  status = "",
  fallback = "尚無資料",
} = {}) => {
  const normalized = String(status || "").trim().toUpperCase();

  // VALID_ZERO is a valid configured numeric target. Never reinterpret it as missing.
  if (normalized === "VALID" || normalized === "VALID_ZERO") return fallback;

  return STATUS_LABELS[normalized] || fallback;
};
