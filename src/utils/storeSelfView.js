import {
  KPI_VALUE_STATUS,
  formalAccrual,
  formalNetCash,
  validBaseTarget,
  validChallengeTarget,
  validRatio,
} from "./kpiContracts.js";
import { normalizeMonthlyTargetMap } from "./dashboardFormalConsumer.js";
import { getSystemExcludedStoreSet } from "./systemExclusion.js";

export const STORE_SELF_VIEW_SOURCE = Object.freeze({
  CURRENT_DETAIL: "store_self_view_current_detail",
  HISTORICAL_SUMMARY: "store_self_view_historical_summary",
});

const normalizeList = (values = [], normalizeStoreKey) => [...new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => normalizeStoreKey(value))
    .filter(Boolean)
)];

const isValidNumericStatus = (status) => (
  status === KPI_VALUE_STATUS.VALID || status === KPI_VALUE_STATUS.VALID_ZERO
);

const aggregateMetricResults = (results = []) => {
  if (!results.length) {
    return { value: null, status: KPI_VALUE_STATUS.FIELD_MISSING };
  }
  const invalid = results.find((result) => !isValidNumericStatus(result?.status) || !Number.isFinite(Number(result?.value)));
  if (invalid) {
    return {
      value: null,
      status: invalid?.status || KPI_VALUE_STATUS.DATA_INVALID,
    };
  }
  const value = results.reduce((sum, result) => sum + Number(result.value), 0);
  return {
    value,
    status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
  };
};

const buildAchievement = (actual, target) => {
  if (!isValidNumericStatus(actual?.status) || !Number.isFinite(Number(actual?.value))) {
    return { value: null, status: actual?.status || KPI_VALUE_STATUS.FIELD_MISSING };
  }
  if (!isValidNumericStatus(target?.status) || !Number.isFinite(Number(target?.value))) {
    return { value: null, status: target?.status || "TARGET_INCOMPLETE" };
  }
  const ratio = validRatio(actual.value, target.value, { requirePositiveDenominator: true });
  return ratio.valid
    ? { value: ratio.value * 100, status: ratio.status }
    : { value: null, status: ratio.status };
};

const buildTargetMetric = ({ scopeStoreKeys, targetMap, field }) => {
  if (!scopeStoreKeys.length) {
    return { value: null, status: KPI_VALUE_STATUS.FIELD_MISSING, configuredCount: 0, missingStores: [] };
  }

  const results = [];
  const missingStores = [];
  scopeStoreKeys.forEach((storeKey) => {
    const result = validBaseTarget(targetMap?.[storeKey]?.[field]);
    if (!result.valid) {
      missingStores.push(storeKey);
      return;
    }
    results.push(result);
  });

  if (missingStores.length > 0 || results.length !== scopeStoreKeys.length) {
    return {
      value: null,
      status: "TARGET_INCOMPLETE",
      configuredCount: results.length,
      missingStores,
    };
  }

  const value = results.reduce((sum, result) => sum + Number(result.value), 0);
  return {
    value,
    status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
    configuredCount: results.length,
    missingStores: [],
  };
};

const buildChallengeMetric = ({
  scopeStoreKeys,
  targetMap,
  baseField,
  challengeField,
}) => {
  if (!scopeStoreKeys.length) {
    return {
      value: null,
      status: KPI_VALUE_STATUS.FIELD_MISSING,
      configured: false,
      configuredCount: 0,
      missingStores: [],
    };
  }

  let configuredCount = 0;
  const values = [];
  const missingStores = [];

  scopeStoreKeys.forEach((storeKey) => {
    const row = targetMap?.[storeKey] || {};
    const base = validBaseTarget(row?.[baseField]);
    if (!base.valid) {
      missingStores.push(storeKey);
      return;
    }

    const challenge = validChallengeTarget(row?.[baseField], row?.[challengeField]);
    if (challenge.configured) configuredCount += 1;

    if (challenge.valid) {
      values.push(challenge.value);
      return;
    }

    if (challenge.configured) {
      missingStores.push(storeKey);
      return;
    }

    values.push(base.value);
  });

  if (missingStores.length > 0 || values.length !== scopeStoreKeys.length) {
    return {
      value: null,
      status: "TARGET_INCOMPLETE",
      configured: configuredCount > 0,
      configuredCount,
      missingStores,
    };
  }

  const value = values.reduce((sum, item) => sum + Number(item), 0);
  return {
    value,
    status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
    configured: configuredCount > 0,
    configuredCount,
    missingStores: [],
  };
};

export const filterDashboardStorePresentationKeys = ({
  values = [],
  userRole = "",
  officialStores = [],
  systemExclusionState = {},
  normalizeStoreKey,
} = {}) => {
  const normalized = normalizeList(values, normalizeStoreKey);
  const excluded = getSystemExcludedStoreSet(systemExclusionState, normalizeStoreKey);
  if (excluded.size === 0) return normalized;

  const selfVisible = String(userRole || "").toLowerCase() === "store"
    ? new Set(normalizeList(officialStores, normalizeStoreKey))
    : new Set();

  return normalized.filter((storeKey) => !excluded.has(storeKey) || selfVisible.has(storeKey));
};

export const buildStoreSelfViewProfile = ({
  userRole = "",
  scopeStoreKeys = [],
  officialStores = [],
  systemExclusionState = {},
  normalizeStoreKey,
} = {}) => {
  const role = String(userRole || "").toLowerCase();
  const scope = normalizeList(scopeStoreKeys, normalizeStoreKey);
  const official = new Set(normalizeList(officialStores, normalizeStoreKey));
  const excluded = getSystemExcludedStoreSet(systemExclusionState, normalizeStoreKey);
  const excludedSelfStoreKeys = role === "store"
    ? scope.filter((storeKey) => official.has(storeKey) && excluded.has(storeKey))
    : [];

  return {
    ready: systemExclusionState?.ready === true,
    active: (
      systemExclusionState?.ready === true &&
      scope.length > 0 &&
      excludedSelfStoreKeys.length === scope.length
    ),
    scopeStoreKeys: scope,
    officialStoreKeys: [...official],
    excludedSelfStoreKeys,
  };
};

export const buildStoreSelfViewTargetScope = ({
  monthlyTargetSummary = null,
  scopeStoreKeys = [],
  expectedYearMonth = "",
  normalizeStoreKey,
} = {}) => {
  const scope = normalizeList(scopeStoreKeys, normalizeStoreKey);
  const summaryYearMonth = String(monthlyTargetSummary?.yearMonth || monthlyTargetSummary?.id || "");
  const expected = String(expectedYearMonth || "");
  const targetSummaryAvailable = Boolean(
    monthlyTargetSummary &&
    (!expected || !summaryYearMonth || summaryYearMonth === expected)
  );
  const targetMap = targetSummaryAvailable
    ? normalizeMonthlyTargetMap(monthlyTargetSummary, normalizeStoreKey)
    : {};

  const cashTarget = targetSummaryAvailable
    ? buildTargetMetric({ scopeStoreKeys: scope, targetMap, field: "cashTarget" })
    : { value: null, status: "TARGET_INCOMPLETE", configuredCount: 0, missingStores: scope };
  const accrualTarget = targetSummaryAvailable
    ? buildTargetMetric({ scopeStoreKeys: scope, targetMap, field: "accrualTarget" })
    : { value: null, status: "TARGET_INCOMPLETE", configuredCount: 0, missingStores: scope };
  const challengeCashTarget = targetSummaryAvailable
    ? buildChallengeMetric({
        scopeStoreKeys: scope,
        targetMap,
        baseField: "cashTarget",
        challengeField: "challengeCashTarget",
      })
    : { value: null, status: "TARGET_INCOMPLETE", configured: false, configuredCount: 0, missingStores: scope };
  const challengeAccrualTarget = targetSummaryAvailable
    ? buildChallengeMetric({
        scopeStoreKeys: scope,
        targetMap,
        baseField: "accrualTarget",
        challengeField: "challengeAccrualTarget",
      })
    : { value: null, status: "TARGET_INCOMPLETE", configured: false, configuredCount: 0, missingStores: scope };

  return {
    targetSummaryAvailable,
    targetMap,
    cashTarget,
    accrualTarget,
    challengeCashTarget,
    challengeAccrualTarget,
  };
};

export const buildCurrentStoreSelfViewScope = ({
  reports = [],
  brandId = "",
  yearMonth = "",
  scopeStoreKeys = [],
  monthlyTargetSummary = null,
  normalizeStoreKey,
} = {}) => {
  const scope = normalizeList(scopeStoreKeys, normalizeStoreKey);
  const scopeSet = new Set(scope);
  const monthPrefix = String(yearMonth || "");
  const rows = (Array.isArray(reports) ? reports : []).filter((row) => {
    const date = String(row?.date || "");
    const storeKey = normalizeStoreKey(row?.storeName || row?.store || row?.storeId || "");
    return scopeSet.has(storeKey) && (!monthPrefix || date.startsWith(monthPrefix));
  });

  const cash = aggregateMetricResults(rows.map((row) => formalNetCash(
    row?.cash,
    row?.refund,
    row?.skincareRefund
  )));
  const accrual = aggregateMetricResults(rows.map((row) => formalAccrual(
    brandId,
    row?.accrual,
    row?.operationalAccrual
  )));
  const targets = buildStoreSelfViewTargetScope({
    monthlyTargetSummary,
    scopeStoreKeys: scope,
    expectedYearMonth: yearMonth,
    normalizeStoreKey,
  });

  return {
    source: STORE_SELF_VIEW_SOURCE.CURRENT_DETAIL,
    scopeStoreKeys: scope,
    reportDocumentCount: rows.length,
    cash,
    accrual,
    ...targets,
    cashAchievement: buildAchievement(cash, targets.cashTarget),
    accrualAchievement: buildAchievement(accrual, targets.accrualTarget),
    challengeCashAchievement: buildAchievement(cash, targets.challengeCashTarget),
    challengeAccrualAchievement: buildAchievement(accrual, targets.challengeAccrualTarget),
  };
};

export const buildHistoricalStoreSelfViewScope = ({
  summaryRows = [],
  scopeStoreKeys = [],
  monthlyTargetSummary = null,
  brandId = "",
  yearMonth = "",
  normalizeStoreKey,
} = {}) => {
  const scope = normalizeList(scopeStoreKeys, normalizeStoreKey);
  const scopeSet = new Set(scope);
  const rows = (Array.isArray(summaryRows) ? summaryRows : []).filter((row) => {
    const storeKey = normalizeStoreKey(
      row?.__summaryKey || row?.store || row?.storeName || row?.displayName || row?.name || row?.id || ""
    );
    return scopeSet.has(storeKey);
  });

  // Historical self-view does not trust excluded rows as Formal scope authority.
  // Instead it reuses the Summary's retained additive Raw/compatibility fields and
  // reapplies the canonical KPI formulas locally. This keeps self-view correct
  // without changing the persisted Formal eligibility contract or adding Raw reads.
  const cash = aggregateMetricResults(rows.map((row) => formalNetCash(
    row?.cash,
    row?.refund,
    row?.skincareRefund
  )));
  const accrual = aggregateMetricResults(rows.map((row) => formalAccrual(
    brandId,
    row?.accrual,
    row?.operationalAccrual
  )));
  const targets = buildStoreSelfViewTargetScope({
    monthlyTargetSummary,
    scopeStoreKeys: scope,
    expectedYearMonth: yearMonth,
    normalizeStoreKey,
  });
  const reportingStatus = rows.length !== scope.length
    ? "DATA_INCOMPLETE"
    : rows.some((row) => String(row?.reportingStatus || "") === "DATA_INCOMPLETE")
      ? "DATA_INCOMPLETE"
      : "SELF_VIEW";

  return {
    source: STORE_SELF_VIEW_SOURCE.HISTORICAL_SUMMARY,
    scopeStoreKeys: scope,
    summaryRowCount: rows.length,
    reportingStatus,
    cash,
    accrual,
    ...targets,
    cashAchievement: buildAchievement(cash, targets.cashTarget),
    accrualAchievement: buildAchievement(accrual, targets.accrualTarget),
    challengeCashAchievement: buildAchievement(cash, targets.challengeCashTarget),
    challengeAccrualAchievement: buildAchievement(accrual, targets.challengeAccrualTarget),
  };
};
