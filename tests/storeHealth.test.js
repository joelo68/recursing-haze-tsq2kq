import test from "node:test";
import assert from "node:assert/strict";
import {
  KPI_VALUE_STATUS,
} from "../src/utils/kpiContracts.js";
import {
  STORE_HEALTH_DIMENSIONS,
  aggregateStoreHealthInputs,
  buildStoreHealthMetrics,
  normalizeStoreHealthScore,
  resolveStoreHealthBenchmarkProfile,
} from "../src/utils/storeHealth.js";
import { STORE_HEALTH_INPUT_VERSION } from "../src/utils/summarySemantics.js";

const makeBenchmarks = () => ({
  default: {
    financial: { min: 0.8, max: 1.2, label: "現權責比" },
    sales: { min: 0.1, max: 0.45, label: "產品佔比" },
    loyalty: { min: 0.5, max: 0.8, label: "舊客佔比" },
    mining: { min: 0.8, max: 1.2, label: "舊客強度" },
    acquisition: { min: 0.8, max: 1.2, label: "新客含金" },
  },
  安妞: {
    financial: { min: 0.7, max: 1.1, label: "現權責比" },
    sales: { min: 0.1, max: 0.4, label: "產品佔比" },
    loyalty: { min: 0.3, max: 0.6, label: "舊客佔比" },
    mining: { min: 0.8, max: 1.2, label: "舊客強度" },
    acquisition: { min: 0.8, max: 1.2, label: "新客含金" },
  },
  伊啵: {
    financial: { min: 0.7, max: 1.1, label: "現權責比" },
    sales: { min: 0.1, max: 0.4, label: "產品佔比" },
    loyalty: { min: 0.3, max: 0.6, label: "舊客佔比" },
    mining: { min: 0.8, max: 1.2, label: "舊客強度" },
    acquisition: { min: 0.8, max: 1.2, label: "新客含金" },
  },
});

const makeRawRow = (overrides = {}) => ({
  cash: 1000,
  refund: 100,
  skincareRefund: 50,
  accrual: 1000,
  operationalAccrual: 700,
  skincareSales: 250,
  traffic: 10,
  newCustomers: 2,
  newCustomerSales: 300,
  ...overrides,
});

const approx = (actual, expected, epsilon = 1e-9) => {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected}`);
};

test("Store Health benchmark authority is exact-brand and never borrows another brand/default profile", () => {
  const benchmarks = makeBenchmarks();
  const cyj = resolveStoreHealthBenchmarkProfile({ brandId: "cyj", benchmarks });
  const anniu = resolveStoreHealthBenchmarkProfile({ brandId: "anniu", benchmarks });
  const yibo = resolveStoreHealthBenchmarkProfile({ brandId: "yibo", benchmarks });

  assert.equal(cyj.brandKey, "default");
  assert.equal(cyj.financial.min, 0.8);
  assert.equal(anniu.brandKey, "安妞");
  assert.equal(anniu.financial.min, 0.7);
  assert.equal(yibo.brandKey, "伊啵");
  assert.equal(yibo.financial.min, 0.7);

  const missingAnniu = resolveStoreHealthBenchmarkProfile({
    brandId: "anniu",
    benchmarks: { default: benchmarks.default },
  });
  STORE_HEALTH_DIMENSIONS.forEach((dimension) => {
    assert.equal(missingAnniu[dimension].valid, false);
    assert.equal(missingAnniu[dimension].status, KPI_VALUE_STATUS.FIELD_MISSING);
    assert.equal(missingAnniu[dimension].min, null);
  });
});

test("invalid Store Health benchmark is fail-closed instead of repaired by hardcoded fallback", () => {
  const profile = resolveStoreHealthBenchmarkProfile({
    brandId: "cyj",
    benchmarks: {
      default: {
        financial: { min: 0.8, max: 0.7 },
      },
    },
  });
  assert.equal(profile.financial.valid, false);
  assert.equal(profile.financial.status, KPI_VALUE_STATUS.DATA_INVALID);
  assert.equal(profile.financial.min, null);
  assert.equal(profile.sales.status, KPI_VALUE_STATUS.FIELD_MISSING);
});

test("CYJ Store Health uses canonical formulas and ratio-of-totals inputs", () => {
  const health = buildStoreHealthMetrics({
    brandId: "cyj",
    rows: [makeRawRow()],
    newASP: 200,
    benchmarks: makeBenchmarks(),
  });

  approx(health.raw.cashToAccrual, 850 / 1000);
  approx(health.raw.retailRatio, 200 / 850);
  approx(health.raw.retention, 8 / 10);
  approx(health.raw.newCustomerASP, 150);
  approx(health.raw.oldCustomerSales, 550);
  approx(health.raw.oldCustomerASP, 550 / 8);
  approx(health.raw.aspMining, (550 / 8) / 150);
  approx(health.raw.acquisitionQuality, 150 / 200);
  assert.equal(health.status.financial, KPI_VALUE_STATUS.VALID);
  assert.equal(health.status.loyalty, KPI_VALUE_STATUS.VALID);
});

test("Anniu Store Health financial denominator uses operationalAccrual, not total accrual", () => {
  const health = buildStoreHealthMetrics({
    brandId: "anniu",
    rows: [makeRawRow({ accrual: 2000, operationalAccrual: 500 })],
    newASP: 200,
    benchmarks: makeBenchmarks(),
  });
  approx(health.raw.cashToAccrual, 850 / 500);
  assert.equal(health.inputs.formalAccrual.value, 500);
});

test("net product zero is a true valid zero, negative net product is preserved and scored at zero", () => {
  const zero = buildStoreHealthMetrics({
    brandId: "cyj",
    rows: [makeRawRow({ skincareSales: 50, skincareRefund: 50 })],
    newASP: 200,
    benchmarks: makeBenchmarks(),
  });
  assert.equal(zero.raw.netProductSales, 0);
  assert.equal(zero.raw.retailRatio, 0);
  assert.equal(zero.status.sales, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(zero.scores.sales, 0);

  const negative = buildStoreHealthMetrics({
    brandId: "cyj",
    rows: [makeRawRow({ skincareSales: 20, skincareRefund: 50 })],
    newASP: 200,
    benchmarks: makeBenchmarks(),
  });
  assert.equal(negative.raw.netProductSales, -30);
  approx(negative.raw.retailRatio, -30 / 850);
  assert.equal(negative.scores.sales, 0);
});

test("product ratio is N/A when formal net cash denominator is zero or negative", () => {
  for (const cash of [150, 100]) {
    const health = buildStoreHealthMetrics({
      brandId: "cyj",
      rows: [makeRawRow({ cash, refund: 100, skincareRefund: 50 })],
      newASP: 200,
      benchmarks: makeBenchmarks(),
    });
    assert.equal(health.raw.retailRatio, null);
    assert.equal(health.status.sales, KPI_VALUE_STATUS.N_A);
    assert.equal(health.scores.sales, null);
  }
});

test("traffic zero with zero new customers is N/A, not a zero loyalty score", () => {
  const health = buildStoreHealthMetrics({
    brandId: "cyj",
    rows: [makeRawRow({ traffic: 0, newCustomers: 0 })],
    newASP: 200,
    benchmarks: makeBenchmarks(),
  });
  assert.equal(health.raw.retention, null);
  assert.equal(health.status.loyalty, KPI_VALUE_STATUS.N_A);
  assert.equal(health.scores.loyalty, null);
});

test("newCustomers greater than traffic is DATA_INVALID and is never clamped", () => {
  const health = buildStoreHealthMetrics({
    brandId: "cyj",
    rows: [makeRawRow({ traffic: 3, newCustomers: 4 })],
    newASP: 200,
    benchmarks: makeBenchmarks(),
  });
  assert.equal(health.raw.oldCustomers, null);
  assert.equal(health.raw.retention, null);
  assert.equal(health.status.loyalty, KPI_VALUE_STATUS.DATA_INVALID);
  assert.equal(health.scores.loyalty, null);
});

test("no new-customer sample keeps new ASP, mining and acquisition N/A", () => {
  const health = buildStoreHealthMetrics({
    brandId: "cyj",
    rows: [makeRawRow({ newCustomers: 0, newCustomerSales: 0 })],
    newASP: 200,
    benchmarks: makeBenchmarks(),
  });
  assert.equal(health.raw.newCustomerASP, null);
  assert.equal(health.status.newCustomerASP, KPI_VALUE_STATUS.N_A);
  assert.equal(health.raw.aspMining, null);
  assert.equal(health.status.mining, KPI_VALUE_STATUS.N_A);
  assert.equal(health.raw.acquisitionQuality, null);
  assert.equal(health.status.acquisition, KPI_VALUE_STATUS.N_A);
});

test("no old-customer sample keeps mining N/A", () => {
  const health = buildStoreHealthMetrics({
    brandId: "cyj",
    rows: [makeRawRow({ traffic: 2, newCustomers: 2, newCustomerSales: 300 })],
    newASP: 200,
    benchmarks: makeBenchmarks(),
  });
  assert.equal(health.raw.oldCustomers, 0);
  assert.equal(health.raw.oldCustomerASP, null);
  assert.equal(health.raw.aspMining, null);
  assert.equal(health.status.mining, KPI_VALUE_STATUS.N_A);
  assert.equal(health.scores.mining, null);
});

test("missing runtime newASP is TARGET_NOT_SET and acquisition score remains N/A", () => {
  const health = buildStoreHealthMetrics({
    brandId: "cyj",
    rows: [makeRawRow()],
    newASP: null,
    benchmarks: makeBenchmarks(),
  });
  assert.equal(health.raw.acquisitionQuality, null);
  assert.equal(health.status.newASP, KPI_VALUE_STATUS.TARGET_NOT_SET);
  assert.equal(health.status.acquisition, KPI_VALUE_STATUS.TARGET_NOT_SET);
  assert.equal(health.scores.acquisition, null);
});

test("normalize Store Health scoring preserves confirmed boundaries and keeps invalid KPI as N/A", () => {
  const benchmark = { valid: true, status: KPI_VALUE_STATUS.VALID, min: 0.8, max: 1.2 };
  assert.equal(normalizeStoreHealthScore({ metric: { status: KPI_VALUE_STATUS.VALID_ZERO, value: 0 }, benchmark }).value, 0);
  assert.equal(normalizeStoreHealthScore({ metric: { status: KPI_VALUE_STATUS.VALID, value: 0.4 }, benchmark }).value, 30);
  assert.equal(normalizeStoreHealthScore({ metric: { status: KPI_VALUE_STATUS.VALID, value: 0.8 }, benchmark }).value, 60);
  assert.equal(normalizeStoreHealthScore({ metric: { status: KPI_VALUE_STATUS.VALID, value: 1.2 }, benchmark }).value, 100);
  assert.equal(normalizeStoreHealthScore({ metric: { status: KPI_VALUE_STATUS.VALID, value: 2 }, benchmark }).value, 100);
  assert.equal(normalizeStoreHealthScore({ metric: { status: KPI_VALUE_STATUS.N_A, value: null }, benchmark }).value, null);
});

test("scope Store Health calculates ratio-of-totals rather than averaging per-store ratios", () => {
  const rows = [
    makeRawRow({ cash: 1100, refund: 100, skincareRefund: 0, accrual: 1000, operationalAccrual: 1000 }), // 1000/1000=1
    makeRawRow({ cash: 20, refund: 0, skincareRefund: 0, accrual: 100, operationalAccrual: 100 }),       // 20/100=.2
  ];
  const health = buildStoreHealthMetrics({ brandId: "cyj", rows, newASP: 200, benchmarks: makeBenchmarks() });
  approx(health.raw.cashToAccrual, 1020 / 1100);
  assert.notEqual(health.raw.cashToAccrual, (1 + 0.2) / 2);
});

test("legacy historical Summary without Store Health input validity fails closed instead of treating missing as zero", () => {
  const row = {
    source: "dashboard_summary",
    formalNetCash: 1000,
    formalNetCashStatus: KPI_VALUE_STATUS.VALID,
    formalAccrual: 1000,
    formalAccrualStatus: KPI_VALUE_STATUS.VALID,
    skincareRefund: 0,
    skincareRefundStatus: KPI_VALUE_STATUS.VALID_ZERO,
    skincareSales: 0,
    traffic: 0,
    newCustomers: 0,
    newCustomerSales: 0,
  };
  const health = buildStoreHealthMetrics({ brandId: "cyj", rows: [row], newASP: 200, benchmarks: makeBenchmarks() });
  assert.equal(health.inputs.traffic.value, null);
  assert.equal(health.inputs.traffic.status, KPI_VALUE_STATUS.FIELD_MISSING);
  assert.equal(health.raw.retention, null);
  assert.equal(health.scores.loyalty, null);
  assert.equal(health.raw.retailRatio, null);
});

test("repaired historical Summary with Store Health input version/status preserves true zero values", () => {
  const row = {
    source: "dashboard_summary",
    storeHealthInputVersion: STORE_HEALTH_INPUT_VERSION,
    formalNetCash: 1000,
    formalNetCashStatus: KPI_VALUE_STATUS.VALID,
    formalAccrual: 1000,
    formalAccrualStatus: KPI_VALUE_STATUS.VALID,
    skincareRefund: 0,
    skincareRefundStatus: KPI_VALUE_STATUS.VALID_ZERO,
    skincareSales: 0,
    skincareSalesStatus: KPI_VALUE_STATUS.VALID_ZERO,
    traffic: 10,
    trafficStatus: KPI_VALUE_STATUS.VALID,
    newCustomers: 0,
    newCustomersStatus: KPI_VALUE_STATUS.VALID_ZERO,
    newCustomerSales: 0,
    newCustomerSalesStatus: KPI_VALUE_STATUS.VALID_ZERO,
  };
  const inputs = aggregateStoreHealthInputs({ brandId: "cyj", rows: [row] });
  assert.equal(inputs.skincareSales.value, 0);
  assert.equal(inputs.skincareSales.status, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(inputs.newCustomers.value, 0);
  assert.equal(inputs.newCustomers.status, KPI_VALUE_STATUS.VALID_ZERO);

  const health = buildStoreHealthMetrics({ brandId: "cyj", rows: [row], newASP: 200, benchmarks: makeBenchmarks() });
  assert.equal(health.raw.retailRatio, 0);
  assert.equal(health.status.sales, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(health.raw.retention, 1);
  assert.equal(health.raw.newCustomerASP, null);
});
