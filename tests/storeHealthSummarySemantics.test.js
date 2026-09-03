import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as frontend from "../src/utils/summarySemantics.js";
import { KPI_VALUE_STATUS } from "../src/utils/kpiContracts.js";

const require = createRequire(import.meta.url);
const backend = require("../functions/summarySemantics.js");

const implementations = [
  ["frontend", frontend],
  ["backend", backend],
];

const completeRow = (overrides = {}) => ({
  cash: 100,
  refund: 10,
  skincareRefund: 5,
  accrual: 80,
  operationalAccrual: 70,
  skincareSales: 20,
  traffic: 4,
  newCustomers: 1,
  newCustomerSales: 25,
  ...overrides,
});

for (const [label, api] of implementations) {
  test(`${label}: Summary Store Health feeder fields preserve strict missing/zero validity`, () => {
    const zero = api.buildFormalReportMetrics("cyj", completeRow({
      skincareSales: 0,
      traffic: 0,
      newCustomers: 0,
      newCustomerSales: 0,
    }));
    assert.equal(zero.storeHealthInputVersion, api.STORE_HEALTH_INPUT_VERSION);
    assert.equal(zero.skincareSalesStatus, KPI_VALUE_STATUS.VALID_ZERO);
    assert.equal(zero.trafficStatus, KPI_VALUE_STATUS.VALID_ZERO);
    assert.equal(zero.newCustomersStatus, KPI_VALUE_STATUS.VALID_ZERO);
    assert.equal(zero.newCustomerSalesStatus, KPI_VALUE_STATUS.VALID_ZERO);

    const missing = api.buildFormalReportMetrics("cyj", {
      cash: 100,
      refund: 0,
      skincareRefund: 0,
      accrual: 100,
      operationalAccrual: 100,
    });
    assert.equal(missing.skincareSales, null);
    assert.equal(missing.skincareSalesStatus, KPI_VALUE_STATUS.FIELD_MISSING);
    assert.equal(missing.traffic, null);
    assert.equal(missing.trafficStatus, KPI_VALUE_STATUS.FIELD_MISSING);
    assert.equal(missing.newCustomers, null);
    assert.equal(missing.newCustomersStatus, KPI_VALUE_STATUS.FIELD_MISSING);
    assert.equal(missing.newCustomerSales, null);
    assert.equal(missing.newCustomerSalesStatus, KPI_VALUE_STATUS.FIELD_MISSING);
  });

  test(`${label}: aggregate Formal metrics adds Store Health validity metadata without overwriting legacy numeric fields`, () => {
    const aggregate = api.aggregateFormalMetrics("cyj", [completeRow(), completeRow({ traffic: 0, newCustomers: 0, newCustomerSales: 0 })]);
    assert.equal(aggregate.storeHealthInputVersion, api.STORE_HEALTH_INPUT_VERSION);
    assert.equal(aggregate.trafficStatus, KPI_VALUE_STATUS.VALID);
    assert.equal(aggregate.newCustomersStatus, KPI_VALUE_STATUS.VALID);
    assert.equal(aggregate.skincareSalesStatus, KPI_VALUE_STATUS.VALID);
    assert.equal(aggregate.newCustomerSalesStatus, KPI_VALUE_STATUS.VALID);

    assert.equal(Object.prototype.hasOwnProperty.call(aggregate, "traffic"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(aggregate, "newCustomers"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(aggregate, "skincareSales"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(aggregate, "newCustomerSales"), false);
  });

  test(`${label}: aggregate Store Health feeder status fails closed when any contributing row is missing`, () => {
    const aggregate = api.aggregateFormalMetrics("cyj", [completeRow(), completeRow({ traffic: undefined })]);
    assert.equal(aggregate.trafficStatus, KPI_VALUE_STATUS.FIELD_MISSING);
    assert.equal(aggregate.skincareSalesStatus, KPI_VALUE_STATUS.VALID);
  });

  test(`${label}: Store Health input validity participates in Summary semantic signature`, () => {
    const base = {
      stores: {
        A: {
          formalNetCash: 100,
          formalNetCashStatus: KPI_VALUE_STATUS.VALID,
          storeHealthInputVersion: api.STORE_HEALTH_INPUT_VERSION,
          trafficStatus: KPI_VALUE_STATUS.VALID,
          skincareSalesStatus: KPI_VALUE_STATUS.VALID,
          newCustomersStatus: KPI_VALUE_STATUS.VALID,
          newCustomerSalesStatus: KPI_VALUE_STATUS.VALID,
        },
      },
    };
    const changed = structuredClone(base);
    changed.stores.A.trafficStatus = KPI_VALUE_STATUS.FIELD_MISSING;
    assert.notEqual(api.buildSummaryStoreSemanticSignature(base), api.buildSummaryStoreSemanticSignature(changed));
  });
}

test("frontend/backend Summary Store Health metadata stays parity-protected", () => {
  assert.equal(frontend.STORE_HEALTH_INPUT_VERSION, backend.STORE_HEALTH_INPUT_VERSION);
  const rows = [completeRow(), completeRow({ traffic: 0, newCustomers: 0, newCustomerSales: 0 })];
  const fe = frontend.aggregateFormalMetrics("anniu", rows);
  const be = backend.aggregateFormalMetrics("anniu", rows);
  assert.deepEqual(fe, be);
});
