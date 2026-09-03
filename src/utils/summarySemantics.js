// src/utils/summarySemantics.js
import {
  KPI_CONTRACT_VERSION,
  KPI_VALUE_STATUS,
  inspectKpiNumber,
  normalizeKpiBrandId,
  formalNetCash,
  formalAccrual,
  validBaseTarget,
  validRatio,
} from "./kpiContracts.js";

export const SUMMARY_SEMANTIC_VERSION = "summary-semantics-v1";

export const SUMMARY_KPI_STATUS = Object.freeze({
  TARGET_INCOMPLETE: "TARGET_INCOMPLETE",
  TARGET_NOT_SET: KPI_VALUE_STATUS.TARGET_NOT_SET,
  FIELD_MISSING: KPI_VALUE_STATUS.FIELD_MISSING,
  DATA_INVALID: KPI_VALUE_STATUS.DATA_INVALID,
  VALID: KPI_VALUE_STATUS.VALID,
  VALID_ZERO: KPI_VALUE_STATUS.VALID_ZERO,
});

const isValidNumericStatus = (status) => (
  status === KPI_VALUE_STATUS.VALID || status === KPI_VALUE_STATUS.VALID_ZERO
);

const mergeStatus = (currentStatus, nextStatus) => {
  if (currentStatus === KPI_VALUE_STATUS.DATA_INVALID || nextStatus === KPI_VALUE_STATUS.DATA_INVALID) {
    return KPI_VALUE_STATUS.DATA_INVALID;
  }
  if (currentStatus === KPI_VALUE_STATUS.FIELD_MISSING || nextStatus === KPI_VALUE_STATUS.FIELD_MISSING) {
    return KPI_VALUE_STATUS.FIELD_MISSING;
  }
  return KPI_VALUE_STATUS.VALID;
};

const finalizeNumericAggregate = (sum, status, count) => {
  if (!count || !isValidNumericStatus(status)) {
    return {
      value: null,
      status: count ? status : KPI_VALUE_STATUS.FIELD_MISSING,
    };
  }
  return {
    value: sum,
    status: sum === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
  };
};

export const buildFormalReportMetrics = (brandId, row = {}) => {
  const normalizedBrandId = normalizeKpiBrandId(brandId);
  const grossCash = inspectKpiNumber(row?.cash);
  const refund = inspectKpiNumber(row?.refund);
  const skincareRefund = inspectKpiNumber(row?.skincareRefund);
  const netCash = formalNetCash(row?.cash, row?.refund, row?.skincareRefund);
  const totalAccrual = inspectKpiNumber(row?.accrual);
  const operationalAccrual = inspectKpiNumber(row?.operationalAccrual);
  const formalAccrualResult = formalAccrual(normalizedBrandId, row?.accrual, row?.operationalAccrual);

  return {
    summarySemanticVersion: SUMMARY_SEMANTIC_VERSION,
    kpiContractVersion: KPI_CONTRACT_VERSION,
    brandId: normalizedBrandId,
    grossCash: isValidNumericStatus(grossCash.status) ? grossCash.value : null,
    grossCashStatus: grossCash.status,
    refund: isValidNumericStatus(refund.status) ? refund.value : null,
    refundStatus: refund.status,
    skincareRefund: isValidNumericStatus(skincareRefund.status) ? skincareRefund.value : null,
    skincareRefundStatus: skincareRefund.status,
    formalNetCash: isValidNumericStatus(netCash.status) ? netCash.value : null,
    formalNetCashStatus: netCash.status,
    totalAccrual: isValidNumericStatus(totalAccrual.status) ? totalAccrual.value : null,
    totalAccrualStatus: totalAccrual.status,
    operationalAccrual: isValidNumericStatus(operationalAccrual.status) ? operationalAccrual.value : null,
    operationalAccrualStatus: operationalAccrual.status,
    formalAccrual: isValidNumericStatus(formalAccrualResult.status) ? formalAccrualResult.value : null,
    formalAccrualStatus: formalAccrualResult.status,
    formalAccrualSource: formalAccrualResult.sourceField || "",
  };
};

export const aggregateFormalMetrics = (brandId, rows = []) => {
  const normalizedBrandId = normalizeKpiBrandId(brandId);
  const source = Array.isArray(rows) ? rows : [];
  const fields = [
    ["grossCash", "grossCashStatus"],
    ["refund", "refundStatus"],
    ["skincareRefund", "skincareRefundStatus"],
    ["formalNetCash", "formalNetCashStatus"],
    ["totalAccrual", "totalAccrualStatus"],
    ["operationalAccrual", "operationalAccrualStatus"],
    ["formalAccrual", "formalAccrualStatus"],
  ];

  const acc = Object.fromEntries(fields.map(([valueKey]) => [
    valueKey,
    { sum: 0, status: KPI_VALUE_STATUS.VALID, count: 0 },
  ]));

  source.forEach((row) => {
    const metrics = buildFormalReportMetrics(normalizedBrandId, row);
    fields.forEach(([valueKey, statusKey]) => {
      const state = acc[valueKey];
      const status = metrics[statusKey];
      state.count += 1;
      state.status = mergeStatus(state.status, status);
      if (isValidNumericStatus(status)) state.sum += Number(metrics[valueKey] || 0);
    });
  });

  const finalizedByField = {};
  fields.forEach(([valueKey, statusKey]) => {
    finalizedByField[valueKey] = {
      ...finalizeNumericAggregate(acc[valueKey].sum, acc[valueKey].status, acc[valueKey].count),
      statusKey,
    };
  });

  // Additive-only contract: do not overwrite legacy Summary fields such as
  // refund / skincareRefund / operationalAccrual. Their numeric values remain
  // untouched for Batch 5 compatibility; strict validity is carried separately.
  return {
    summarySemanticVersion: SUMMARY_SEMANTIC_VERSION,
    kpiContractVersion: KPI_CONTRACT_VERSION,
    brandId: normalizedBrandId,
    reportCount: source.length,
    grossCash: finalizedByField.grossCash.value,
    grossCashStatus: finalizedByField.grossCash.status,
    refundStatus: finalizedByField.refund.status,
    skincareRefundStatus: finalizedByField.skincareRefund.status,
    formalNetCash: finalizedByField.formalNetCash.value,
    formalNetCashStatus: finalizedByField.formalNetCash.status,
    totalAccrual: finalizedByField.totalAccrual.value,
    totalAccrualStatus: finalizedByField.totalAccrual.status,
    operationalAccrualStatus: finalizedByField.operationalAccrual.status,
    formalAccrual: finalizedByField.formalAccrual.value,
    formalAccrualStatus: finalizedByField.formalAccrual.status,
    formalAccrualSource: normalizedBrandId === "anniu" ? "operationalAccrual" : (normalizedBrandId ? "accrual" : ""),
  };
};

export const extractTargetCoverageMetadata = (data = {}) => {
  const source = data && typeof data === "object" ? data : {};
  const hasCoverageContract = String(source.targetCoverageVersion || "") === "target-coverage-v1";
  const copyList = (value) => Array.isArray(value) ? [...value] : [];
  const numericOrNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  return {
    available: hasCoverageContract,
    targetCoverageVersion: String(source.targetCoverageVersion || ""),
    kpiContractVersion: String(source.kpiContractVersion || ""),
    lifecycleReady: source.lifecycleReady === true,
    eligibleStoreCount: Number.isFinite(Number(source.eligibleStoreCount)) ? Number(source.eligibleStoreCount) : 0,
    cashConfiguredStoreCount: Number.isFinite(Number(source.cashConfiguredStoreCount)) ? Number(source.cashConfiguredStoreCount) : 0,
    accrualConfiguredStoreCount: Number.isFinite(Number(source.accrualConfiguredStoreCount)) ? Number(source.accrualConfiguredStoreCount) : 0,
    cashCoverageComplete: hasCoverageContract && source.cashCoverageComplete === true,
    accrualCoverageComplete: hasCoverageContract && source.accrualCoverageComplete === true,
    cashMissingStores: copyList(source.cashMissingStores),
    accrualMissingStores: copyList(source.accrualMissingStores),
    cashTargetTotal: numericOrNull(source.cashTargetTotal),
    accrualTargetTotal: numericOrNull(source.accrualTargetTotal),
    coverageSource: String(source.coverageSource || ""),
    coverageUpdatedAtText: String(source.coverageUpdatedAtText || ""),
    systemExclusionSnapshot: source?.systemExclusionSnapshot && typeof source.systemExclusionSnapshot === "object"
      ? { ...source.systemExclusionSnapshot }
      : null,
  };
};

export const buildSummaryTargetAuthoritySnapshot = ({
  targetMap = {},
  eligibleStoreKeys = [],
  lifecycleReady = false,
  targetCoverage = {},
  systemExclusionCurrent = true,
} = {}) => {
  const eligibleKeys = [...new Set((eligibleStoreKeys || []).map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const cashMissingStoreKeys = [];
  const accrualMissingStoreKeys = [];
  let cashConfiguredStoreCount = 0;
  let accrualConfiguredStoreCount = 0;
  let cashTargetTotal = 0;
  let accrualTargetTotal = 0;

  eligibleKeys.forEach((storeKey) => {
    const row = targetMap?.[storeKey] || {};
    const cashTarget = validBaseTarget(row.cashTarget);
    const accrualTarget = validBaseTarget(row.accrualTarget);

    if (cashTarget.valid) {
      cashConfiguredStoreCount += 1;
      cashTargetTotal += cashTarget.value;
    } else {
      cashMissingStoreKeys.push(storeKey);
    }

    if (accrualTarget.valid) {
      accrualConfiguredStoreCount += 1;
      accrualTargetTotal += accrualTarget.value;
    } else {
      accrualMissingStoreKeys.push(storeKey);
    }
  });

  const computedCashCoverageComplete = Boolean(lifecycleReady) && cashMissingStoreKeys.length === 0;
  const computedAccrualCoverageComplete = Boolean(lifecycleReady) && accrualMissingStoreKeys.length === 0;
  const coverageAvailable = targetCoverage?.available === true;
  const coverageVersionCompatible = String(targetCoverage?.kpiContractVersion || "") === KPI_CONTRACT_VERSION;
  const coverageConsistent = coverageAvailable
    && coverageVersionCompatible
    && systemExclusionCurrent === true
    && Boolean(targetCoverage.lifecycleReady) === Boolean(lifecycleReady)
    && Number(targetCoverage.eligibleStoreCount || 0) === eligibleKeys.length
    && Number(targetCoverage.cashConfiguredStoreCount || 0) === cashConfiguredStoreCount
    && Number(targetCoverage.accrualConfiguredStoreCount || 0) === accrualConfiguredStoreCount
    && (Array.isArray(targetCoverage.cashMissingStores) ? targetCoverage.cashMissingStores.length : 0) === cashMissingStoreKeys.length
    && (Array.isArray(targetCoverage.accrualMissingStores) ? targetCoverage.accrualMissingStores.length : 0) === accrualMissingStoreKeys.length
    && Boolean(targetCoverage.cashCoverageComplete) === computedCashCoverageComplete
    && Boolean(targetCoverage.accrualCoverageComplete) === computedAccrualCoverageComplete;

  return {
    summarySemanticVersion: SUMMARY_SEMANTIC_VERSION,
    kpiContractVersion: KPI_CONTRACT_VERSION,
    lifecycleReady: Boolean(lifecycleReady),
    eligibleStoreKeys: eligibleKeys,
    eligibleStoreCount: eligibleKeys.length,
    cashConfiguredStoreCount,
    accrualConfiguredStoreCount,
    cashMissingStoreKeys,
    accrualMissingStoreKeys,
    cashTargetTotal,
    accrualTargetTotal,
    computedCashCoverageComplete,
    computedAccrualCoverageComplete,
    coverageAuthorityAvailable: coverageAvailable,
    coverageVersionCompatible,
    coverageSystemExclusionCurrent: systemExclusionCurrent === true,
    coverageConsistent,
    cashCoverageTrusted: coverageConsistent && targetCoverage.cashCoverageComplete === true,
    accrualCoverageTrusted: coverageConsistent && targetCoverage.accrualCoverageComplete === true,
  };
};

export const buildScopeFormalAchievement = ({
  actualValue,
  actualStatus,
  targetValue,
  coverageComplete,
} = {}) => {
  if (coverageComplete !== true) {
    return { status: SUMMARY_KPI_STATUS.TARGET_INCOMPLETE, valid: false, value: null };
  }

  if (!isValidNumericStatus(actualStatus)) {
    return {
      status: actualStatus || KPI_VALUE_STATUS.DATA_INVALID,
      valid: false,
      value: null,
    };
  }

  const target = validBaseTarget(targetValue);
  if (!target.valid) {
    return {
      status: target.status,
      valid: false,
      value: null,
    };
  }

  const ratio = validRatio(actualValue, target.value, { requirePositiveDenominator: true });
  if (!ratio.valid) return ratio;
  return {
    status: ratio.status,
    valid: true,
    value: ratio.value * 100,
  };
};

export const buildStoreFormalKpiMetadata = (metrics = {}, target = {}) => {
  const cashTarget = validBaseTarget(target?.cashTarget);
  const accrualTarget = validBaseTarget(target?.accrualTarget);

  const cashRatio = cashTarget.valid && isValidNumericStatus(metrics?.formalNetCashStatus)
    ? validRatio(metrics.formalNetCash, cashTarget.value, { requirePositiveDenominator: true })
    : null;
  const accrualRatio = accrualTarget.valid && isValidNumericStatus(metrics?.formalAccrualStatus)
    ? validRatio(metrics.formalAccrual, accrualTarget.value, { requirePositiveDenominator: true })
    : null;

  return {
    formalCashTarget: cashTarget.valid ? cashTarget.value : null,
    formalCashTargetStatus: cashTarget.status,
    formalCashAchievement: cashRatio?.valid ? cashRatio.value * 100 : null,
    formalCashAchievementStatus: cashRatio
      ? cashRatio.status
      : (cashTarget.valid ? (metrics?.formalNetCashStatus || KPI_VALUE_STATUS.DATA_INVALID) : cashTarget.status),
    formalAccrualTarget: accrualTarget.valid ? accrualTarget.value : null,
    formalAccrualTargetStatus: accrualTarget.status,
    formalAccrualAchievement: accrualRatio?.valid ? accrualRatio.value * 100 : null,
    formalAccrualAchievementStatus: accrualRatio
      ? accrualRatio.status
      : (accrualTarget.valid ? (metrics?.formalAccrualStatus || KPI_VALUE_STATUS.DATA_INVALID) : accrualTarget.status),
    formalRankEligible: Boolean(cashTarget.valid && cashRatio?.valid),
    formalCashAchievementRank: null,
  };
};

export const buildFormalStoreRanking = (storeMap = {}, targetMap = {}, options = {}) => {
  const byStore = {};
  const hasLifecycleFilter = Array.isArray(options.eligibleStoreKeys);
  const eligibleSet = new Set((options.eligibleStoreKeys || []).map((value) => String(value || "").trim()).filter(Boolean));

  Object.entries(storeMap || {}).forEach(([storeKey, store]) => {
    const metadata = buildStoreFormalKpiMetadata(store || {}, targetMap?.[storeKey] || {});
    const formalLifecycleEligible = hasLifecycleFilter ? eligibleSet.has(storeKey) : true;
    byStore[storeKey] = {
      ...metadata,
      formalLifecycleEligible,
      formalRankEligible: formalLifecycleEligible && metadata.formalRankEligible === true,
    };
  });

  const rankEligible = Object.entries(storeMap || {})
    .filter(([storeKey]) => byStore[storeKey]?.formalRankEligible === true)
    .sort((a, b) => {
      const aValue = Number(byStore[a[0]]?.formalCashAchievement);
      const bValue = Number(byStore[b[0]]?.formalCashAchievement);
      if (bValue !== aValue) return bValue - aValue;
      return String(a[0]).localeCompare(String(b[0]), "zh-Hant");
    });

  rankEligible.forEach(([storeKey], index) => {
    byStore[storeKey] = {
      ...byStore[storeKey],
      formalCashAchievementRank: index + 1,
    };
  });

  return {
    rankEligibleStoreCount: rankEligible.length,
    byStore,
    rankings: rankEligible.map(([storeKey, store]) => ({
      ...store,
      ...byStore[storeKey],
      store: store?.store || storeKey,
      displayName: store?.displayName || store?.storeName || storeKey,
    })),
  };
};

const normalizeSignatureScalar = (value) => {
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
};

const makeStableStoreEntries = (stores = {}) => (
  Object.entries(stores && typeof stores === "object" && !Array.isArray(stores) ? stores : {})
    .sort(([a], [b]) => String(a).localeCompare(String(b), "zh-Hant"))
);

export const buildSummaryStoreSemanticSignature = (summary = {}) => JSON.stringify(
  makeStableStoreEntries(summary?.stores || {}).map(([storeKey, row = {}]) => ({
    storeKey,
    grossCash: normalizeSignatureScalar(row.grossCash),
    grossCashStatus: String(row.grossCashStatus || ""),
    refund: normalizeSignatureScalar(row.refund),
    refundStatus: String(row.refundStatus || ""),
    skincareRefund: normalizeSignatureScalar(row.skincareRefund),
    skincareRefundStatus: String(row.skincareRefundStatus || ""),
    formalNetCash: normalizeSignatureScalar(row.formalNetCash),
    formalNetCashStatus: String(row.formalNetCashStatus || ""),
    totalAccrual: normalizeSignatureScalar(row.totalAccrual),
    totalAccrualStatus: String(row.totalAccrualStatus || ""),
    operationalAccrual: normalizeSignatureScalar(row.operationalAccrual),
    operationalAccrualStatus: String(row.operationalAccrualStatus || ""),
    formalAccrual: normalizeSignatureScalar(row.formalAccrual),
    formalAccrualStatus: String(row.formalAccrualStatus || ""),
    formalCashTarget: normalizeSignatureScalar(row.formalCashTarget),
    formalCashAchievement: normalizeSignatureScalar(row.formalCashAchievement),
    formalCashAchievementStatus: String(row.formalCashAchievementStatus || ""),
    formalAccrualTarget: normalizeSignatureScalar(row.formalAccrualTarget),
    formalAccrualAchievement: normalizeSignatureScalar(row.formalAccrualAchievement),
    formalAccrualAchievementStatus: String(row.formalAccrualAchievementStatus || ""),
    formalLifecycleEligible: row.formalLifecycleEligible === true,
    formalRankEligible: row.formalRankEligible === true,
    formalCashAchievementRank: normalizeSignatureScalar(row.formalCashAchievementRank),
  }))
);

export const buildFormalRankingSignature = (summary = {}) => JSON.stringify(
  (Array.isArray(summary?.formalStoreRankings) ? summary.formalStoreRankings : []).map((row = {}) => ({
    store: String(row.store || row.storeName || row.displayName || ""),
    formalNetCash: normalizeSignatureScalar(row.formalNetCash),
    formalCashTarget: normalizeSignatureScalar(row.formalCashTarget),
    formalCashAchievement: normalizeSignatureScalar(row.formalCashAchievement),
    formalCashAchievementStatus: String(row.formalCashAchievementStatus || ""),
    formalCashAchievementRank: normalizeSignatureScalar(row.formalCashAchievementRank),
    formalRankEligible: row.formalRankEligible === true,
  }))
);
