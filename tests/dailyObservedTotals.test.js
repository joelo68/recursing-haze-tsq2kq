import test from "node:test";
import assert from "node:assert/strict";
import { KPI_VALUE_STATUS } from "../src/utils/kpiContracts.js";
import { buildDailyObservedTotals } from "../src/utils/dailyObservedTotals.js";

const reported = (overrides = {}) => ({
  isReported: true,
  cash: 100,
  cashStatus: KPI_VALUE_STATUS.VALID,
  accrual: 120,
  accrualStatus: KPI_VALUE_STATUS.VALID,
  traffic: 10,
  newCustomers: 2,
  skincareSales: 30,
  ...overrides,
});

const missing = () => ({
  isReported: false,
  cash: null,
  cashStatus: KPI_VALUE_STATUS.FIELD_MISSING,
  accrual: null,
  accrualStatus: KPI_VALUE_STATUS.FIELD_MISSING,
  traffic: 0,
  newCustomers: 0,
  skincareSales: 0,
});

test("Daily observed totals keep reported cumulative actuals when reporting is incomplete", () => {
  const result = buildDailyObservedTotals([
    reported({ cash: 100, accrual: 120, traffic: 10, newCustomers: 2, skincareSales: 30 }),
    reported({ cash: 200, accrual: 230, traffic: 20, newCustomers: 3, skincareSales: 40 }),
    missing(),
  ]);

  assert.equal(result.reportedCount, 2);
  assert.equal(result.totalCount, 3);
  assert.equal(result.dataComplete, false);
  assert.deepEqual(result.totals, {
    cash: 300,
    accrual: 350,
    traffic: 30,
    newCustomers: 5,
    skincare: 70,
  });
});

test("Daily observed totals still fail closed when a reported Formal KPI is invalid", () => {
  const result = buildDailyObservedTotals([
    reported(),
    reported({ cash: null, cashStatus: KPI_VALUE_STATUS.DATA_INVALID, accrual: 80 }),
    missing(),
  ]);

  assert.equal(result.dataComplete, false);
  assert.equal(result.totals.cash, null);
  assert.equal(result.totals.accrual, 200);
  assert.equal(result.totals.traffic, 20);
});

test("Daily observed totals remain unavailable when nothing has been reported", () => {
  const result = buildDailyObservedTotals([missing(), missing()]);
  assert.equal(result.reportedCount, 0);
  assert.equal(result.dataComplete, false);
  assert.deepEqual(result.totals, {
    cash: null,
    accrual: null,
    traffic: null,
    newCustomers: null,
    skincare: null,
  });
});

test("Daily observed totals mark complete only when every expected store has reported", () => {
  const result = buildDailyObservedTotals([
    reported({ cash: 0, cashStatus: KPI_VALUE_STATUS.VALID_ZERO }),
    reported({ cash: 200 }),
  ]);
  assert.equal(result.reportedCount, 2);
  assert.equal(result.totalCount, 2);
  assert.equal(result.dataComplete, true);
  assert.equal(result.totals.cash, 200);
});
