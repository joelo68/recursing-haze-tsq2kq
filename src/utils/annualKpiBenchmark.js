// src/utils/annualKpiBenchmark.js
// Batch 7 Annual benchmark consumer semantics.
// V2 uses KPI-specific month authority; V1 remains readable during staged rollout.

import { KPI_VALUE_STATUS } from "./kpiContracts.js";

export const ANNUAL_KPI_SUMMARY_SCHEMA_VERSION = "annual-kpi-summary-v2";

export const ANNUAL_BENCHMARK_METRIC_IDS = Object.freeze([
  "traffic",
  "newCustomers",
  "cash",
  "accrual",
]);

const isFiniteValue = (value) => (
  value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
);

const validStatus = (status) => (
  status === KPI_VALUE_STATUS.VALID || status === KPI_VALUE_STATUS.VALID_ZERO
);

const normalizeYearMonth = (value = "") => {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
};

const normalizeMetric = (raw = {}, fallback = {}) => {
  const basedMonths = Array.isArray(raw?.basedMonths)
    ? raw.basedMonths.map(normalizeYearMonth).filter(Boolean)
    : (Array.isArray(fallback?.basedMonths) ? fallback.basedMonths.map(normalizeYearMonth).filter(Boolean) : []);
  const basedMonthCount = Number.isFinite(Number(raw?.basedMonthCount))
    ? Number(raw.basedMonthCount)
    : basedMonths.length;
  const monthlyAverage = isFiniteValue(raw?.monthlyAverage)
    ? Number(raw.monthlyAverage)
    : (isFiniteValue(fallback?.monthlyAverage) ? Number(fallback.monthlyAverage) : null);
  const total = isFiniteValue(raw?.total)
    ? Number(raw.total)
    : (isFiniteValue(fallback?.total) ? Number(fallback.total) : null);
  const status = String(raw?.status || fallback?.status || (
    basedMonthCount > 0
      ? (Number(monthlyAverage) === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID)
      : KPI_VALUE_STATUS.N_A
  ));

  return {
    monthlyValues: raw?.monthlyValues && typeof raw.monthlyValues === "object"
      ? Object.fromEntries(
          Object.entries(raw.monthlyValues)
            .map(([yearMonth, value]) => [normalizeYearMonth(yearMonth), isFiniteValue(value) ? Number(value) : null])
            .filter(([yearMonth, value]) => Boolean(yearMonth) && value !== null)
        )
      : {},
    monthlyAverage: validStatus(status) && isFiniteValue(monthlyAverage) ? Number(monthlyAverage) : null,
    total: validStatus(status) && isFiniteValue(total) ? Number(total) : null,
    basedMonths,
    basedMonthCount,
    status,
    skippedMonths: Array.isArray(raw?.skippedMonths) ? raw.skippedMonths : [],
  };
};

const makeEmptyMetric = () => ({
  monthlyValues: {},
  monthlyAverage: null,
  total: null,
  basedMonths: [],
  basedMonthCount: 0,
  status: KPI_VALUE_STATUS.N_A,
  skippedMonths: [],
});

export const makeEmptyAnnualKpiBenchmark = (base = {}, source = "not_available") => ({
  ...base,
  ready: true,
  source,
  schemaVersion: String(base?.schemaVersion || ""),
  metrics: Object.fromEntries(ANNUAL_BENCHMARK_METRIC_IDS.map((metricId) => [metricId, makeEmptyMetric()])),
  trafficMonthlyAverage: null,
  newCustomerMonthlyAverage: null,
  cashMonthlyAverage: null,
  accrualMonthlyAverage: null,
  basedMonthCount: 0,
  basedMonths: [],
  stores: base?.stores && typeof base.stores === "object" ? base.stores : {},
  benchmarkScopeByMonth: base?.benchmarkScopeByMonth && typeof base.benchmarkScopeByMonth === "object"
    ? base.benchmarkScopeByMonth
    : {},
});

export const normalizeAnnualKpiBenchmarkPayload = (data = {}) => {
  const source = data && typeof data === "object" ? data : {};
  const schemaVersion = String(source.schemaVersion || "");
  const isV2 = schemaVersion === ANNUAL_KPI_SUMMARY_SCHEMA_VERSION;

  const sharedBasedMonths = Array.isArray(source.basedMonths)
    ? source.basedMonths.map(normalizeYearMonth).filter(Boolean)
    : [];
  const sharedBasedMonthCount = Number.isFinite(Number(source.basedMonthCount))
    ? Number(source.basedMonthCount)
    : sharedBasedMonths.length;

  const metrics = isV2
    ? Object.fromEntries(
        ANNUAL_BENCHMARK_METRIC_IDS.map((metricId) => [
          metricId,
          normalizeMetric(source?.metrics?.[metricId] || {}),
        ])
      )
    : {
        traffic: normalizeMetric({}, {
          monthlyAverage: source.trafficMonthlyAverage,
          total: source.trafficTotal,
          basedMonths: sharedBasedMonths,
          status: sharedBasedMonthCount > 0
            ? (Number(source.trafficMonthlyAverage || 0) === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID)
            : KPI_VALUE_STATUS.N_A,
        }),
        newCustomers: normalizeMetric({}, {
          monthlyAverage: source.newCustomerMonthlyAverage,
          total: source.newCustomerTotal,
          basedMonths: sharedBasedMonths,
          status: sharedBasedMonthCount > 0
            ? (Number(source.newCustomerMonthlyAverage || 0) === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID)
            : KPI_VALUE_STATUS.N_A,
        }),
        cash: normalizeMetric({}, {
          monthlyAverage: source.cashMonthlyAverage,
          total: source.cashTotal,
          basedMonths: sharedBasedMonths,
          status: sharedBasedMonthCount > 0
            ? (Number(source.cashMonthlyAverage || 0) === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID)
            : KPI_VALUE_STATUS.N_A,
        }),
        accrual: normalizeMetric({}, {
          monthlyAverage: source.accrualMonthlyAverage,
          total: source.accrualTotal,
          basedMonths: sharedBasedMonths,
          status: sharedBasedMonthCount > 0
            ? (Number(source.accrualMonthlyAverage || 0) === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID)
            : KPI_VALUE_STATUS.N_A,
        }),
      };

  const normalizedStores = Object.fromEntries(
    Object.entries(source.stores && typeof source.stores === "object" ? source.stores : {})
      .map(([key, store = {}]) => {
        const storeMetrics = isV2
          ? Object.fromEntries(
              ANNUAL_BENCHMARK_METRIC_IDS.map((metricId) => [
                metricId,
                normalizeMetric(store?.metrics?.[metricId] || {}),
              ])
            )
          : null;
        return [key, { ...store, ...(storeMetrics ? { metrics: storeMetrics } : {}) }];
      })
  );

  return {
    ...source,
    ready: true,
    schemaVersion,
    metrics,
    stores: normalizedStores,
    storeCount: Number.isFinite(Number(source.storeCount))
      ? Number(source.storeCount)
      : Object.keys(normalizedStores).length,
    benchmarkScopeByMonth: source.benchmarkScopeByMonth && typeof source.benchmarkScopeByMonth === "object"
      ? source.benchmarkScopeByMonth
      : {},
    trafficMonthlyAverage: metrics.traffic.monthlyAverage,
    newCustomerMonthlyAverage: metrics.newCustomers.monthlyAverage,
    cashMonthlyAverage: metrics.cash.monthlyAverage,
    accrualMonthlyAverage: metrics.accrual.monthlyAverage,
    basedMonthCount: metrics.traffic.basedMonthCount,
    basedMonths: metrics.traffic.basedMonths,
  };
};

const findStoreSummary = ({
  storesMap = {},
  core = "",
  normalizeStoreKey = (value) => String(value || "").trim(),
} = {}) => {
  const normalizedCore = normalizeStoreKey(core);
  if (!normalizedCore) return null;

  const entries = Object.entries(storesMap || {});
  for (const [key, value] of entries) {
    if (normalizeStoreKey(key) === normalizedCore) return value;
    if (normalizeStoreKey(
      value?.storeCore || value?.storeName || value?.store || value?.displayName || value?.name || ""
    ) === normalizedCore) return value;
  }
  return null;
};

const finalizeScopeMetric = (monthlyValues = {}) => {
  const normalized = Object.fromEntries(
    Object.entries(monthlyValues || {})
      .filter(([yearMonth, value]) => normalizeYearMonth(yearMonth) && isFiniteValue(value))
      .map(([yearMonth, value]) => [yearMonth, Number(value)])
      .sort(([a], [b]) => a.localeCompare(b))
  );
  const basedMonths = Object.keys(normalized);
  const basedMonthCount = basedMonths.length;
  const total = basedMonths.reduce((sum, yearMonth) => sum + normalized[yearMonth], 0);
  const monthlyAverage = basedMonthCount > 0 ? Math.round(total / basedMonthCount) : null;
  return {
    monthlyValues: normalized,
    total: basedMonthCount > 0 ? total : null,
    monthlyAverage,
    basedMonths,
    basedMonthCount,
    status: basedMonthCount === 0
      ? KPI_VALUE_STATUS.N_A
      : (total === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID),
    skippedMonths: [],
  };
};

const buildV2FilteredScope = ({
  payload,
  selectedStoreCores = [],
  normalizeStoreKey,
} = {}) => {
  const selected = [...new Set((selectedStoreCores || []).map(normalizeStoreKey).filter(Boolean))];
  const selectedSet = new Set(selected);
  const storesMap = payload?.stores && typeof payload.stores === "object" ? payload.stores : {};
  const scopeByMonth = payload?.benchmarkScopeByMonth && typeof payload.benchmarkScopeByMonth === "object"
    ? payload.benchmarkScopeByMonth
    : {};
  const monthlyByMetric = Object.fromEntries(
    ANNUAL_BENCHMARK_METRIC_IDS.map((metricId) => [metricId, {}])
  );

  Object.entries(scopeByMonth).forEach(([rawYearMonth, scope = {}]) => {
    const yearMonth = normalizeYearMonth(rawYearMonth);
    if (!yearMonth) return;

    const requiredStoreKeys = [...new Set(
      (Array.isArray(scope?.requiredStoreKeys) ? scope.requiredStoreKeys : [])
        .map(normalizeStoreKey)
        .filter(Boolean)
    )];
    const requiredForSelectedScope = requiredStoreKeys.filter((storeCore) => selectedSet.has(storeCore));
    if (requiredForSelectedScope.length === 0) return;

    ANNUAL_BENCHMARK_METRIC_IDS.forEach((metricId) => {
      let total = 0;
      let complete = true;

      for (const storeCore of requiredForSelectedScope) {
        const storeSummary = findStoreSummary({ storesMap, core: storeCore, normalizeStoreKey });
        const metric = storeSummary?.metrics?.[metricId];
        const value = metric?.monthlyValues?.[yearMonth];
        if (!metric || !isFiniteValue(value)) {
          complete = false;
          break;
        }
        total += Number(value);
      }

      if (complete) monthlyByMetric[metricId][yearMonth] = total;
    });
  });

  const metrics = Object.fromEntries(
    ANNUAL_BENCHMARK_METRIC_IDS.map((metricId) => [
      metricId,
      finalizeScopeMetric(monthlyByMetric[metricId]),
    ])
  );

  return {
    ...payload,
    scope: selected.length === 1 ? "store" : "filtered",
    scopeStoreCount: selected.length,
    metrics,
    trafficMonthlyAverage: metrics.traffic.monthlyAverage,
    newCustomerMonthlyAverage: metrics.newCustomers.monthlyAverage,
    cashMonthlyAverage: metrics.cash.monthlyAverage,
    accrualMonthlyAverage: metrics.accrual.monthlyAverage,
    basedMonthCount: metrics.traffic.basedMonthCount,
    basedMonths: metrics.traffic.basedMonths,
  };
};

const buildLegacyFilteredScope = ({
  payload,
  selectedStoreCores = [],
  normalizeStoreKey,
} = {}) => {
  const selected = [...new Set((selectedStoreCores || []).map(normalizeStoreKey).filter(Boolean))];
  const selectedSummaries = selected
    .map((core) => findStoreSummary({ storesMap: payload.stores || {}, core, normalizeStoreKey }))
    .filter(Boolean);

  if (selected.length === 0 || selectedSummaries.length === 0) {
    return makeEmptyAnnualKpiBenchmark({
      ...payload,
      scope: "filtered_missing_store_data",
      scopeStoreCount: selected.length,
    }, "filtered_missing_store_data");
  }

  const monthTotals = {};
  const eligibleMonthSet = new Set();

  selectedSummaries.forEach((storeSummary) => {
    const monthlyValues = storeSummary?.monthlyValues && typeof storeSummary.monthlyValues === "object"
      ? storeSummary.monthlyValues
      : {};
    const storeBasedMonths = (
      Array.isArray(storeSummary?.basedMonths)
        ? storeSummary.basedMonths
        : Object.keys(monthlyValues)
    ).map(normalizeYearMonth).filter(Boolean);
    const storeBasedMonthSet = new Set(storeBasedMonths);

    storeBasedMonths.forEach((yearMonth) => {
      eligibleMonthSet.add(yearMonth);
      if (!monthTotals[yearMonth]) monthTotals[yearMonth] = { traffic: 0, newCustomers: 0, cash: 0, accrual: 0 };
    });

    Object.entries(monthlyValues).forEach(([rawYearMonth, metrics = {}]) => {
      const yearMonth = normalizeYearMonth(rawYearMonth);
      if (!yearMonth || !storeBasedMonthSet.has(yearMonth)) return;
      if (!monthTotals[yearMonth]) monthTotals[yearMonth] = { traffic: 0, newCustomers: 0, cash: 0, accrual: 0 };
      ANNUAL_BENCHMARK_METRIC_IDS.forEach((metricId) => {
        if (isFiniteValue(metrics?.[metricId])) monthTotals[yearMonth][metricId] += Number(metrics[metricId]);
      });
    });
  });

  const basedMonths = [...eligibleMonthSet].sort();
  const legacyMetricValues = Object.fromEntries(
    ANNUAL_BENCHMARK_METRIC_IDS.map((metricId) => [
      metricId,
      Object.fromEntries(basedMonths.map((yearMonth) => [yearMonth, Number(monthTotals?.[yearMonth]?.[metricId] || 0)])),
    ])
  );
  const metrics = Object.fromEntries(
    ANNUAL_BENCHMARK_METRIC_IDS.map((metricId) => [
      metricId,
      finalizeScopeMetric(legacyMetricValues[metricId]),
    ])
  );

  return {
    ...payload,
    scope: selected.length === 1 ? "store" : "filtered",
    scopeStoreCount: selected.length,
    metrics,
    trafficMonthlyAverage: metrics.traffic.monthlyAverage,
    newCustomerMonthlyAverage: metrics.newCustomers.monthlyAverage,
    cashMonthlyAverage: metrics.cash.monthlyAverage,
    accrualMonthlyAverage: metrics.accrual.monthlyAverage,
    basedMonthCount: metrics.traffic.basedMonthCount,
    basedMonths: metrics.traffic.basedMonths,
  };
};

export const buildAnnualKpiBenchmarkScope = ({
  payload = {},
  selectedStoreCores = [],
  normalizeStoreKey = (value) => String(value || "").trim(),
} = {}) => {
  const normalized = normalizeAnnualKpiBenchmarkPayload(payload);
  const selected = [...new Set((selectedStoreCores || []).map(normalizeStoreKey).filter(Boolean))];
  if (selected.length === 0) {
    return { ...normalized, scope: "brand", scopeStoreCount: 0 };
  }

  if (normalized.schemaVersion === ANNUAL_KPI_SUMMARY_SCHEMA_VERSION) {
    return buildV2FilteredScope({
      payload: normalized,
      selectedStoreCores: selected,
      normalizeStoreKey,
    });
  }

  return buildLegacyFilteredScope({
    payload: normalized,
    selectedStoreCores: selected,
    normalizeStoreKey,
  });
};

export const getAnnualBenchmarkMetric = (payload = {}, metricId = "") => (
  payload?.metrics?.[metricId] || makeEmptyMetric()
);

export const isAnnualBenchmarkMetricDisplayable = (metric = {}) => (
  validStatus(metric?.status) && isFiniteValue(metric?.monthlyAverage)
);

export const getAnnualBenchmarkLabel = (metric = {}) => {
  const count = Number(metric?.basedMonthCount || 0);
  if (count <= 0) return "";
  if (count <= 2) return `近 ${count} 個完整月平均`;
  return "年均";
};
