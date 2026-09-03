import {
  KPI_VALUE_STATUS,
  inspectKpiNumber,
  normalizeKpiBrandId,
  formalNetCash,
  formalAccrual,
  validPositiveSetting,
  validRatio,
  validateStoreHealthBenchmark,
} from "./kpiContracts.js";
import { STORE_HEALTH_INPUT_VERSION } from "./summarySemantics.js";

export const STORE_HEALTH_VERSION = "store-health-v1";

export const STORE_HEALTH_DIMENSIONS = Object.freeze([
  "financial",
  "sales",
  "loyalty",
  "mining",
  "acquisition",
]);

const DIMENSION_LABELS = Object.freeze({
  financial: "現權責比",
  sales: "產品佔比",
  loyalty: "舊客佔比",
  mining: "舊客強度",
  acquisition: "新客含金",
});

const BENCHMARK_BRAND_KEYS = Object.freeze({
  cyj: "default",
  anniu: "安妞",
  yibo: "伊啵",
});

const isValidStatus = (status) => (
  status === KPI_VALUE_STATUS.VALID || status === KPI_VALUE_STATUS.VALID_ZERO
);

const statusFromValue = (value) => (
  value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID
);

const mergeFailureStatus = (...statuses) => {
  if (statuses.some((status) => status === KPI_VALUE_STATUS.DATA_INVALID)) return KPI_VALUE_STATUS.DATA_INVALID;
  if (statuses.some((status) => status === KPI_VALUE_STATUS.FIELD_MISSING)) return KPI_VALUE_STATUS.FIELD_MISSING;
  if (statuses.some((status) => status === KPI_VALUE_STATUS.TARGET_NOT_SET)) return KPI_VALUE_STATUS.TARGET_NOT_SET;
  if (statuses.some((status) => status === KPI_VALUE_STATUS.N_A)) return KPI_VALUE_STATUS.N_A;
  return KPI_VALUE_STATUS.DATA_INVALID;
};

const readSummaryMetric = (row, valueKey, statusKey, { requireStoreHealthVersion = false } = {}) => {
  if (requireStoreHealthVersion && String(row?.storeHealthInputVersion || "") !== STORE_HEALTH_INPUT_VERSION) {
    return { value: null, status: KPI_VALUE_STATUS.FIELD_MISSING };
  }
  const status = String(row?.[statusKey] || "");
  if (!isValidStatus(status)) {
    return {
      value: null,
      status: status === KPI_VALUE_STATUS.DATA_INVALID ? KPI_VALUE_STATUS.DATA_INVALID : KPI_VALUE_STATUS.FIELD_MISSING,
    };
  }
  const inspected = inspectKpiNumber(row?.[valueKey]);
  if (!isValidStatus(inspected.status)) return { value: null, status: inspected.status };
  return { value: inspected.value, status };
};

const readRawMetric = (row, valueKey) => {
  const inspected = inspectKpiNumber(row?.[valueKey]);
  return isValidStatus(inspected.status)
    ? { value: inspected.value, status: inspected.status }
    : { value: null, status: inspected.status };
};

const readRowInputs = (brandId, row = {}) => {
  const isSummary = row?.source === "dashboard_summary";
  if (isSummary) {
    return {
      formalNetCash: readSummaryMetric(row, "formalNetCash", "formalNetCashStatus"),
      formalAccrual: readSummaryMetric(row, "formalAccrual", "formalAccrualStatus"),
      skincareRefund: readSummaryMetric(row, "skincareRefund", "skincareRefundStatus"),
      skincareSales: readSummaryMetric(row, "skincareSales", "skincareSalesStatus", { requireStoreHealthVersion: true }),
      traffic: readSummaryMetric(row, "traffic", "trafficStatus", { requireStoreHealthVersion: true }),
      newCustomers: readSummaryMetric(row, "newCustomers", "newCustomersStatus", { requireStoreHealthVersion: true }),
      newCustomerSales: readSummaryMetric(row, "newCustomerSales", "newCustomerSalesStatus", { requireStoreHealthVersion: true }),
    };
  }

  const netCash = formalNetCash(row?.cash, row?.refund, row?.skincareRefund);
  const accrual = formalAccrual(brandId, row?.accrual, row?.operationalAccrual);
  return {
    formalNetCash: isValidStatus(netCash.status)
      ? { value: netCash.value, status: netCash.status }
      : { value: null, status: netCash.status },
    formalAccrual: isValidStatus(accrual.status)
      ? { value: accrual.value, status: accrual.status }
      : { value: null, status: accrual.status },
    skincareRefund: readRawMetric(row, "skincareRefund"),
    skincareSales: readRawMetric(row, "skincareSales"),
    traffic: readRawMetric(row, "traffic"),
    newCustomers: readRawMetric(row, "newCustomers"),
    newCustomerSales: readRawMetric(row, "newCustomerSales"),
  };
};

const makeAggregateState = () => ({ sum: 0, count: 0, status: KPI_VALUE_STATUS.VALID });

const mergeAggregate = (state, metric) => {
  state.count += 1;
  if (!isValidStatus(metric?.status)) {
    state.status = mergeFailureStatus(state.status, metric?.status);
    return;
  }
  if (isValidStatus(state.status)) state.sum += Number(metric.value || 0);
};

const finalizeAggregate = (state) => {
  if (!state.count) return { value: null, status: KPI_VALUE_STATUS.FIELD_MISSING };
  if (!isValidStatus(state.status)) return { value: null, status: state.status };
  return { value: state.sum, status: statusFromValue(state.sum) };
};

export const aggregateStoreHealthInputs = ({ brandId = "", rows = [] } = {}) => {
  const normalizedBrandId = normalizeKpiBrandId(brandId);
  const source = Array.isArray(rows) ? rows : [];
  const keys = [
    "formalNetCash",
    "formalAccrual",
    "skincareRefund",
    "skincareSales",
    "traffic",
    "newCustomers",
    "newCustomerSales",
  ];
  const states = Object.fromEntries(keys.map((key) => [key, makeAggregateState()]));

  source.forEach((row) => {
    const input = readRowInputs(normalizedBrandId, row || {});
    keys.forEach((key) => mergeAggregate(states[key], input[key]));
  });

  const finalized = Object.fromEntries(keys.map((key) => [key, finalizeAggregate(states[key])]));
  return {
    brandId: normalizedBrandId,
    reportCount: source.length,
    ...finalized,
  };
};

export const resolveStoreHealthBenchmarkProfile = ({ brandId = "", benchmarks = {} } = {}) => {
  const normalizedBrandId = normalizeKpiBrandId(brandId);
  const brandKey = BENCHMARK_BRAND_KEYS[normalizedBrandId] || "";
  const profile = brandKey && benchmarks && typeof benchmarks === "object"
    ? benchmarks?.[brandKey]
    : null;

  const result = {
    brandId: normalizedBrandId,
    brandKey,
    configured: Boolean(profile && typeof profile === "object"),
  };

  STORE_HEALTH_DIMENSIONS.forEach((dimension) => {
    const raw = profile && typeof profile === "object" ? profile?.[dimension] : null;
    const label = String(raw?.label || DIMENSION_LABELS[dimension]);
    const minMissing = raw?.min === null || raw?.min === undefined || raw?.min === "";
    const maxMissing = raw?.max === null || raw?.max === undefined || raw?.max === "";

    if (!raw || typeof raw !== "object" || (minMissing && maxMissing)) {
      result[dimension] = {
        label,
        min: null,
        max: null,
        valid: false,
        status: KPI_VALUE_STATUS.FIELD_MISSING,
      };
      return;
    }

    const checked = validateStoreHealthBenchmark(raw.min, raw.max);
    result[dimension] = {
      label,
      min: checked.valid ? checked.min : null,
      max: checked.valid ? checked.max : null,
      valid: checked.valid === true,
      status: checked.status,
    };
  });

  return result;
};

const ratioFromAggregates = (numerator, denominator, options = {}) => {
  if (!isValidStatus(numerator?.status) || !isValidStatus(denominator?.status)) {
    return { value: null, status: mergeFailureStatus(numerator?.status, denominator?.status), valid: false };
  }
  return validRatio(numerator.value, denominator.value, options);
};

const subtractAggregates = (left, right) => {
  if (!isValidStatus(left?.status) || !isValidStatus(right?.status)) {
    return { value: null, status: mergeFailureStatus(left?.status, right?.status), valid: false };
  }
  const value = left.value - right.value;
  return { value, status: statusFromValue(value), valid: true };
};

const buildLoyalty = (traffic, newCustomers) => {
  if (!isValidStatus(traffic?.status) || !isValidStatus(newCustomers?.status)) {
    const status = mergeFailureStatus(traffic?.status, newCustomers?.status);
    return {
      oldCustomers: { value: null, status },
      retention: { value: null, status, valid: false },
    };
  }
  if (traffic.value < 0 || newCustomers.value < 0 || newCustomers.value > traffic.value) {
    return {
      oldCustomers: { value: null, status: KPI_VALUE_STATUS.DATA_INVALID },
      retention: { value: null, status: KPI_VALUE_STATUS.DATA_INVALID, valid: false },
    };
  }
  const oldCustomers = traffic.value - newCustomers.value;
  const oldResult = { value: oldCustomers, status: statusFromValue(oldCustomers) };
  if (traffic.value === 0) {
    return {
      oldCustomers: oldResult,
      retention: { value: null, status: KPI_VALUE_STATUS.N_A, valid: false },
    };
  }
  const retention = validRatio(oldCustomers, traffic.value, { requirePositiveDenominator: true });
  return { oldCustomers: oldResult, retention };
};

export const normalizeStoreHealthScore = ({ metric = null, benchmark = null } = {}) => {
  if (!isValidStatus(metric?.status)) {
    return { value: null, status: metric?.status || KPI_VALUE_STATUS.DATA_INVALID, valid: false };
  }
  if (benchmark?.valid !== true) {
    return { value: null, status: benchmark?.status || KPI_VALUE_STATUS.FIELD_MISSING, valid: false };
  }

  const value = Number(metric.value);
  const min = Number(benchmark.min);
  const max = Number(benchmark.max);
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || !(min > 0) || !(max > min)) {
    return { value: null, status: KPI_VALUE_STATUS.DATA_INVALID, valid: false };
  }

  let score;
  if (value <= 0) score = 0;
  else if (value < min) score = 60 * (value / min);
  else if (value >= max) score = 100;
  else score = 60 + ((value - min) / (max - min)) * 40;

  const clamped = Math.max(0, Math.min(100, score));
  return { value: clamped, status: statusFromValue(clamped), valid: true };
};

export const buildStoreHealthMetrics = ({
  brandId = "",
  rows = [],
  newASP = null,
  benchmarks = {},
} = {}) => {
  const inputs = aggregateStoreHealthInputs({ brandId, rows });
  const benchmarkProfile = resolveStoreHealthBenchmarkProfile({ brandId, benchmarks });

  const financial = ratioFromAggregates(inputs.formalNetCash, inputs.formalAccrual, { requirePositiveDenominator: true });
  const netProductSales = subtractAggregates(inputs.skincareSales, inputs.skincareRefund);
  const sales = ratioFromAggregates(netProductSales, inputs.formalNetCash, { requirePositiveDenominator: true });
  const loyalty = buildLoyalty(inputs.traffic, inputs.newCustomers);

  const newCustomerASP = ratioFromAggregates(inputs.newCustomerSales, inputs.newCustomers, { requirePositiveDenominator: true });
  const oldCustomerSales = subtractAggregates(inputs.formalNetCash, inputs.newCustomerSales);
  const oldCustomerASP = ratioFromAggregates(oldCustomerSales, loyalty.oldCustomers, { requirePositiveDenominator: true });
  const mining = ratioFromAggregates(oldCustomerASP, newCustomerASP, { requirePositiveDenominator: true });

  const newAspTarget = validPositiveSetting(newASP);
  const acquisition = isValidStatus(newCustomerASP?.status) && newAspTarget.valid
    ? validRatio(newCustomerASP.value, newAspTarget.value, { requirePositiveDenominator: true })
    : {
        value: null,
        valid: false,
        status: !isValidStatus(newCustomerASP?.status)
          ? newCustomerASP?.status
          : newAspTarget.status,
      };

  const metricsByDimension = {
    financial,
    sales,
    loyalty: loyalty.retention,
    mining,
    acquisition,
  };

  const scores = {};
  const scoreStatus = {};
  STORE_HEALTH_DIMENSIONS.forEach((dimension) => {
    const score = normalizeStoreHealthScore({
      metric: metricsByDimension[dimension],
      benchmark: benchmarkProfile[dimension],
    });
    scores[dimension] = score.valid ? score.value : null;
    scoreStatus[dimension] = score.status;
  });

  return {
    version: STORE_HEALTH_VERSION,
    brandId: inputs.brandId,
    reportCount: inputs.reportCount,
    inputs,
    benchmarks: benchmarkProfile,
    raw: {
      cashToAccrual: financial.valid ? financial.value : null,
      retailRatio: sales.valid ? sales.value : null,
      retention: loyalty.retention.valid ? loyalty.retention.value : null,
      aspMining: mining.valid ? mining.value : null,
      acquisitionQuality: acquisition.valid ? acquisition.value : null,
      netProductSales: netProductSales.valid ? netProductSales.value : null,
      oldCustomers: isValidStatus(loyalty.oldCustomers.status) ? loyalty.oldCustomers.value : null,
      oldCustomerSales: oldCustomerSales.valid ? oldCustomerSales.value : null,
      oldCustomerASP: oldCustomerASP.valid ? oldCustomerASP.value : null,
      newCustomerASP: newCustomerASP.valid ? newCustomerASP.value : null,
    },
    status: {
      financial: financial.status,
      sales: sales.status,
      loyalty: loyalty.retention.status,
      mining: mining.status,
      acquisition: acquisition.status,
      netProductSales: netProductSales.status,
      oldCustomers: loyalty.oldCustomers.status,
      oldCustomerSales: oldCustomerSales.status,
      oldCustomerASP: oldCustomerASP.status,
      newCustomerASP: newCustomerASP.status,
      newASP: newAspTarget.status,
    },
    scores,
    scoreStatus,
  };
};
