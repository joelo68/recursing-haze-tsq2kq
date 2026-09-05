import test from "node:test";
import assert from "node:assert/strict";

import { KPI_VALUE_STATUS } from "../src/utils/kpiContracts.js";
import {
  buildCurrentStoreSelfViewScope,
  buildHistoricalStoreSelfViewScope,
  buildStoreSelfViewTargetScope,
} from "../src/utils/storeSelfView.js";

const clean = (value = "") => String(value || "")
  .replace(/^(CYJ|安妞|伊啵)/, "")
  .replace(/店$/, "")
  .trim();

const targetSummary = {
  id: "2026-08",
  yearMonth: "2026-08",
  targets: {
    "排除A": {
      storeName: "CYJ排除A店",
      cashTarget: 100,
      accrualTarget: 120,
      challengeCashTarget: 150,
    },
  },
};

test("current store self-view uses canonical KPI formulas without restoring Formal eligibility", () => {
  const result = buildCurrentStoreSelfViewScope({
    reports: [
      {
        storeName: "CYJ排除A店",
        date: "2026-08-01",
        cash: 120,
        refund: 10,
        skincareRefund: 5,
        accrual: 90,
        operationalAccrual: 80,
      },
    ],
    brandId: "cyj",
    yearMonth: "2026-08",
    scopeStoreKeys: ["排除A"],
    monthlyTargetSummary: targetSummary,
    normalizeStoreKey: clean,
  });

  assert.equal(result.cash.value, 105);
  assert.equal(result.cash.status, KPI_VALUE_STATUS.VALID);
  assert.equal(result.accrual.value, 90);
  assert.equal(result.cashTarget.value, 100);
  assert.equal(result.cashAchievement.value, 105);
  assert.equal(result.challengeCashTarget.configured, true);
  assert.equal(result.challengeCashAchievement.value, 70);
});

test("store self-view supports multiple own excluded stores as one isolated self scope", () => {
  const result = buildCurrentStoreSelfViewScope({
    reports: [
      { storeName: "CYJ排除A店", date: "2026-08-01", cash: 100, refund: 0, skincareRefund: 0, accrual: 100, operationalAccrual: 100 },
      { storeName: "CYJ排除B店", date: "2026-08-01", cash: 200, refund: 10, skincareRefund: 0, accrual: 180, operationalAccrual: 180 },
    ],
    brandId: "cyj",
    yearMonth: "2026-08",
    scopeStoreKeys: ["排除A", "排除B"],
    monthlyTargetSummary: {
      id: "2026-08",
      targets: {
        排除A: { cashTarget: 100, accrualTarget: 100 },
        排除B: { cashTarget: 200, accrualTarget: 180 },
      },
    },
    normalizeStoreKey: clean,
  });

  assert.equal(result.cash.value, 290);
  assert.equal(result.accrual.value, 280);
  assert.equal(result.cashTarget.value, 300);
});

test("Anniu store self-view keeps operationalAccrual authority", () => {
  const result = buildCurrentStoreSelfViewScope({
    reports: [
      {
        storeName: "安妞排除A店",
        date: "2026-08-01",
        cash: 100,
        refund: 0,
        skincareRefund: 0,
        accrual: 300,
        operationalAccrual: 180,
      },
    ],
    brandId: "anniu",
    yearMonth: "2026-08",
    scopeStoreKeys: ["排除A"],
    monthlyTargetSummary: {
      id: "2026-08",
      targets: {
        "排除A": { storeName: "安妞排除A店", cashTarget: 100, accrualTarget: 180 },
      },
    },
    normalizeStoreKey: clean,
  });

  assert.equal(result.accrual.value, 180);
  assert.equal(result.accrualAchievement.value, 100);
});

test("historical self-view reads explicit Summary KPI fields even when the row is excluded from Formal scope", () => {
  const result = buildHistoricalStoreSelfViewScope({
    summaryRows: [
      {
        __summaryKey: "排除A",
        store: "排除A",
        formalScopeEligible: false,
        formalRankEligible: false,
        cash: 120,
        refund: 10,
        skincareRefund: 5,
        accrual: 90,
        operationalAccrual: 80,
        reportingStatus: "DATA_COMPLETE",
      },
    ],
    scopeStoreKeys: ["排除A"],
    monthlyTargetSummary: targetSummary,
    brandId: "cyj",
    yearMonth: "2026-08",
    normalizeStoreKey: clean,
  });

  assert.equal(result.cash.value, 105);
  assert.equal(result.accrual.value, 90);
  assert.equal(result.cashTarget.value, 100);
  assert.equal(result.cashAchievement.value, 105);
  assert.equal(result.summaryRowCount, 1);
});

test("self-view target aggregation preserves configured zero and returns N/A achievement denominator semantics", () => {
  const targets = buildStoreSelfViewTargetScope({
    monthlyTargetSummary: {
      id: "2026-08",
      targets: {
        "排除A": { cashTarget: 0, accrualTarget: 0 },
      },
    },
    scopeStoreKeys: ["排除A"],
    expectedYearMonth: "2026-08",
    normalizeStoreKey: clean,
  });

  assert.equal(targets.cashTarget.value, 0);
  assert.equal(targets.cashTarget.status, KPI_VALUE_STATUS.VALID_ZERO);

  const result = buildCurrentStoreSelfViewScope({
    reports: [
      {
        storeName: "CYJ排除A店",
        date: "2026-08-01",
        cash: 0,
        refund: 0,
        skincareRefund: 0,
        accrual: 0,
        operationalAccrual: 0,
      },
    ],
    brandId: "cyj",
    yearMonth: "2026-08",
    scopeStoreKeys: ["排除A"],
    monthlyTargetSummary: {
      id: "2026-08",
      targets: {
        "排除A": { cashTarget: 0, accrualTarget: 0 },
      },
    },
    normalizeStoreKey: clean,
  });

  assert.equal(result.cash.value, 0);
  assert.equal(result.cash.status, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(result.cashAchievement.value, null);
  assert.equal(result.cashAchievement.status, KPI_VALUE_STATUS.N_A);
});

test("self-view target source is month-anchored and fails closed on mismatched Summary month", () => {
  const result = buildStoreSelfViewTargetScope({
    monthlyTargetSummary: targetSummary,
    scopeStoreKeys: ["排除A"],
    expectedYearMonth: "2026-09",
    normalizeStoreKey: clean,
  });

  assert.equal(result.targetSummaryAvailable, false);
  assert.equal(result.cashTarget.value, null);
  assert.equal(result.cashTarget.status, "TARGET_INCOMPLETE");
});
