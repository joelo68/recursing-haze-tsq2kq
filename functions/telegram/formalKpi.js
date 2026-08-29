"use strict";

const {
  KPI_CONTRACT_VERSION,
  KPI_VALUE_STATUS,
  normalizeKpiBrandId,
  formalNetCash,
  formalAccrual,
  validBaseTarget,
  validRatio,
} = require("../kpiContracts");

const TELEGRAM_FORMAL_SUMMARY_VERSION = "dashboard-summary-v2";
const TELEGRAM_FORMAL_SEMANTIC_VERSION = "summary-semantics-v1";
const TELEGRAM_TARGET_COVERAGE_VERSION = "target-coverage-v1";
const TELEGRAM_PRE_SYSTEM_START_MONTH = Object.freeze({ yibo: "2026-04" });

const isValidNumericStatus = (status) => status === KPI_VALUE_STATUS.VALID || status === KPI_VALUE_STATUS.VALID_ZERO;

function normalizeYearMonth(value = "") {
  const match = String(value || "").trim().match(/^(20\d{2})-(\d{1,2})$/);
  if (!match) return "";
  const month = Number(match[2]);
  if (month < 1 || month > 12) return "";
  return `${match[1]}-${String(month).padStart(2, "0")}`;
}

function isTelegramFormalPreSystemMonth(brandId, yearMonth) {
  const normalizedBrandId = normalizeKpiBrandId(brandId);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  const startMonth = TELEGRAM_PRE_SYSTEM_START_MONTH[normalizedBrandId] || "";
  return Boolean(startMonth && normalizedYearMonth && normalizedYearMonth < startMonth);
}

function inspectTelegramFormalSummaryTrust({ brandId, yearMonth, summaryStatus = {}, summaryData = {} } = {}) {
  const normalizedBrandId = normalizeKpiBrandId(brandId);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedBrandId || !normalizedYearMonth) return { trusted: false, reason: "INVALID_IDENTITY" };
  if (isTelegramFormalPreSystemMonth(normalizedBrandId, normalizedYearMonth)) return { trusted: false, reason: "PRE_SYSTEM_SKIP" };
  if (summaryStatus?.verified !== true) return { trusted: false, reason: "SUMMARY_NOT_VERIFIED" };
  if (String(summaryData?.version || "") !== TELEGRAM_FORMAL_SUMMARY_VERSION) return { trusted: false, reason: "SUMMARY_VERSION_MISMATCH" };
  if (String(summaryData?.semanticVersion || "") !== TELEGRAM_FORMAL_SEMANTIC_VERSION) return { trusted: false, reason: "SEMANTIC_VERSION_MISMATCH" };
  if (String(summaryData?.kpiContractVersion || "") !== KPI_CONTRACT_VERSION) return { trusted: false, reason: "KPI_CONTRACT_MISMATCH" };
  if (normalizeKpiBrandId(summaryData?.brandId || "") !== normalizedBrandId) return { trusted: false, reason: "BRAND_MISMATCH" };
  if (normalizeYearMonth(summaryData?.yearMonth || "") !== normalizedYearMonth) return { trusted: false, reason: "MONTH_MISMATCH" };
  if (String(summaryData?.targetCoverage?.targetCoverageVersion || "") !== TELEGRAM_TARGET_COVERAGE_VERSION) return { trusted: false, reason: "TARGET_COVERAGE_MISSING" };
  if (String(summaryData?.targetCoverage?.kpiContractVersion || "") !== KPI_CONTRACT_VERSION) return { trusted: false, reason: "TARGET_COVERAGE_CONTRACT_MISMATCH" };
  if (String(summaryData?.lifecycleSnapshot?.datasetStatus || "") !== "READY") return { trusted: false, reason: "LIFECYCLE_NOT_READY" };
  if (summaryData?.formalTargetAuthority?.lifecycleReady !== true) return { trusted: false, reason: "TARGET_AUTHORITY_LIFECYCLE_NOT_READY" };
  if (summaryData?.formalTargetAuthority?.coverageAuthorityAvailable !== true) return { trusted: false, reason: "TARGET_AUTHORITY_UNAVAILABLE" };
  if (summaryData?.formalTargetAuthority?.coverageVersionCompatible !== true) return { trusted: false, reason: "TARGET_AUTHORITY_VERSION_MISMATCH" };
  if (summaryData?.formalTargetAuthority?.coverageConsistent !== true) return { trusted: false, reason: "TARGET_AUTHORITY_INCONSISTENT" };
  return { trusted: true, reason: "FORMAL_SUMMARY_TRUSTED" };
}

function normalizeTarget(value) {
  const result = validBaseTarget(value);
  return { value: result.valid ? result.value : null, status: result.status };
}

function buildAchievement(actualValue, actualStatus, targetValue, targetStatus) {
  if (!isValidNumericStatus(actualStatus)) return { value: null, status: actualStatus || KPI_VALUE_STATUS.DATA_INVALID };
  if (targetStatus !== KPI_VALUE_STATUS.VALID) return { value: null, status: targetStatus || KPI_VALUE_STATUS.TARGET_NOT_SET };
  const ratio = validRatio(actualValue, targetValue, { requirePositiveDenominator: true });
  return { value: ratio.valid ? Number((ratio.value * 100).toFixed(1)) : null, status: ratio.status };
}

function buildTelegramFormalMetricsFromCanonical(actual = {}, target = {}, mode = "raw_canonical") {
  const cashStatus = String(actual?.formalNetCashStatus || KPI_VALUE_STATUS.FIELD_MISSING);
  const accrualStatus = String(actual?.formalAccrualStatus || KPI_VALUE_STATUS.FIELD_MISSING);
  const cashValue = isValidNumericStatus(cashStatus) ? Number(actual.formalNetCash) : null;
  const accrualValue = isValidNumericStatus(accrualStatus) ? Number(actual.formalAccrual) : null;
  const cashTarget = normalizeTarget(target?.cashTarget);
  const accrualTarget = normalizeTarget(target?.accrualTarget);
  const cashAchievement = buildAchievement(cashValue, cashStatus, cashTarget.value, cashTarget.status);
  const accrualAchievement = buildAchievement(accrualValue, accrualStatus, accrualTarget.value, accrualTarget.status);
  return {
    formalKpiMode: mode,
    cash: cashValue,
    cashStatus,
    accrual: accrualValue,
    accrualStatus,
    budget: cashTarget.value,
    cashTargetStatus: cashTarget.status,
    accrualBudget: accrualTarget.value,
    accrualTargetStatus: accrualTarget.status,
    achievement: cashAchievement.value,
    cashAchievementRate: cashAchievement.value,
    cashAchievementStatus: cashAchievement.status,
    accrualAchievement: accrualAchievement.value,
    accrualAchievementStatus: accrualAchievement.status,
  };
}

function buildTelegramFormalRawMetrics(brandId, row = {}, target = {}) {
  const grossCash = Object.prototype.hasOwnProperty.call(row, "grossCash") ? row.grossCash : row.cash;
  const refund = Object.prototype.hasOwnProperty.call(row, "refund") ? row.refund : 0;
  const netCash = formalNetCash(grossCash, refund, row.skincareRefund);
  const accrual = formalAccrual(brandId, row.accrual, row.operationalAccrual);
  return buildTelegramFormalMetricsFromCanonical({
    formalNetCash: netCash.value,
    formalNetCashStatus: netCash.status,
    formalAccrual: accrual.value,
    formalAccrualStatus: accrual.status,
  }, {
    cashTarget: target?.cashTarget ?? row.cashTarget ?? row.budget,
    accrualTarget: target?.accrualTarget ?? row.accrualTarget ?? row.accrualBudget,
  });
}

function buildTelegramFormalSummaryMetrics(row = {}) {
  const cashStatus = String(row?.formalNetCashStatus || KPI_VALUE_STATUS.FIELD_MISSING);
  const accrualStatus = String(row?.formalAccrualStatus || KPI_VALUE_STATUS.FIELD_MISSING);
  const cashTargetStatus = String(row?.formalCashTargetStatus || KPI_VALUE_STATUS.TARGET_NOT_SET);
  const accrualTargetStatus = String(row?.formalAccrualTargetStatus || KPI_VALUE_STATUS.TARGET_NOT_SET);
  const cashAchievementStatus = String(row?.formalCashAchievementStatus || KPI_VALUE_STATUS.DATA_INVALID);
  const accrualAchievementStatus = String(row?.formalAccrualAchievementStatus || KPI_VALUE_STATUS.DATA_INVALID);
  return {
    formalKpiMode: "historical_summary",
    cash: isValidNumericStatus(cashStatus) ? Number(row.formalNetCash) : null,
    cashStatus,
    accrual: isValidNumericStatus(accrualStatus) ? Number(row.formalAccrual) : null,
    accrualStatus,
    budget: cashTargetStatus === KPI_VALUE_STATUS.VALID ? Number(row.formalCashTarget) : null,
    cashTargetStatus,
    accrualBudget: accrualTargetStatus === KPI_VALUE_STATUS.VALID ? Number(row.formalAccrualTarget) : null,
    accrualTargetStatus,
    achievement: isValidNumericStatus(cashAchievementStatus) ? Number(row.formalCashAchievement) : null,
    cashAchievementRate: isValidNumericStatus(cashAchievementStatus) ? Number(row.formalCashAchievement) : null,
    cashAchievementStatus,
    accrualAchievement: isValidNumericStatus(accrualAchievementStatus) ? Number(row.formalAccrualAchievement) : null,
    accrualAchievementStatus,
    rankingEligible: row?.formalRankEligible === true,
    formalLifecycleEligible: row?.formalLifecycleEligible === true,
    formalCashAchievementRank: Number.isFinite(Number(row?.formalCashAchievementRank)) ? Number(row.formalCashAchievementRank) : null,
  };
}

function aggregateTelegramFormalRows(rows = []) {
  const formalRows = (Array.isArray(rows) ? rows : []).filter((row) => row?.formalKpiMode);
  const sumValid = (valueField, statusField) => {
    let total = 0;
    let sawAny = false;
    for (const row of formalRows) {
      const status = row?.[statusField];
      if (!isValidNumericStatus(status)) return { value: null, status: status || KPI_VALUE_STATUS.DATA_INVALID };
      total += Number(row?.[valueField]);
      sawAny = true;
    }
    return { value: sawAny ? total : 0, status: total === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID };
  };
  const sumTarget = (valueField, statusField) => {
    let total = 0;
    for (const row of formalRows) {
      if (row?.[statusField] !== KPI_VALUE_STATUS.VALID) return { value: null, status: row?.[statusField] || KPI_VALUE_STATUS.TARGET_NOT_SET };
      total += Number(row?.[valueField]);
    }
    return { value: total, status: KPI_VALUE_STATUS.VALID };
  };
  const cash = sumValid("cash", "cashStatus");
  const accrual = sumValid("accrual", "accrualStatus");
  const cashTarget = sumTarget("budget", "cashTargetStatus");
  const accrualTarget = sumTarget("accrualBudget", "accrualTargetStatus");
  const cashAchievement = buildAchievement(cash.value, cash.status, cashTarget.value, cashTarget.status);
  const accrualAchievement = buildAchievement(accrual.value, accrual.status, accrualTarget.value, accrualTarget.status);
  return {
    cash: cash.value,
    cashStatus: cash.status,
    accrual: accrual.value,
    accrualStatus: accrual.status,
    budget: cashTarget.value,
    cashTargetStatus: cashTarget.status,
    accrualBudget: accrualTarget.value,
    accrualTargetStatus: accrualTarget.status,
    achievement: cashAchievement.value,
    cashAchievementRate: cashAchievement.value,
    cashAchievementStatus: cashAchievement.status,
    accrualAchievement: accrualAchievement.value,
    accrualAchievementStatus: accrualAchievement.status,
  };
}

module.exports = {
  TELEGRAM_FORMAL_SUMMARY_VERSION,
  TELEGRAM_FORMAL_SEMANTIC_VERSION,
  TELEGRAM_TARGET_COVERAGE_VERSION,
  TELEGRAM_PRE_SYSTEM_START_MONTH,
  isValidNumericStatus,
  normalizeYearMonth,
  isTelegramFormalPreSystemMonth,
  inspectTelegramFormalSummaryTrust,
  buildTelegramFormalMetricsFromCanonical,
  buildTelegramFormalRawMetrics,
  buildTelegramFormalSummaryMetrics,
  aggregateTelegramFormalRows,
};
