import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCurrentDetailFormalAuthority,
  buildCurrentDetailFormalScope,
} from "../src/utils/currentDetailFormalConsumer.js";
import { KPI_CONTRACT_VERSION, KPI_VALUE_STATUS, validBaseTarget } from "../src/utils/kpiContracts.js";

const normalizeStoreKey = (value = "") => String(value || "")
  .trim()
  .replace(/^(DRCYJ|DR\.CYJ|CYJ|安妞|伊啵)\s*/i, "")
  .replace(/店$/, "")
  .trim();

const makeMaster = (brandId = "cyj", stores = {}) => ({
  schemaVersion: "store-lifecycle-v1",
  brandId,
  datasetStatus: "READY",
  stores,
});

const lifecycleEntry = (overrides = {}) => ({
  firstEligibleMonth: "2026-08",
  openDate: "2026-01-01",
  lastEligibleMonth: "",
  closeDate: "",
  exemptMonths: [],
  ...overrides,
});

const makeTargetSummary = ({ brandId = "cyj", rows = {}, cashMissing = [], accrualMissing = [] } = {}) => {
  const eligibleStoreCount = Object.keys(rows).length;
  const cashConfiguredStoreCount = Object.values(rows).filter((row) => validBaseTarget(row.cashTarget).valid).length;
  const accrualConfiguredStoreCount = Object.values(rows).filter((row) => validBaseTarget(row.accrualTarget).valid).length;
  return {
    id: "2026-08",
    yearMonth: "2026-08",
    brandId,
    targetCoverageVersion: "target-coverage-v1",
    kpiContractVersion: KPI_CONTRACT_VERSION,
    lifecycleReady: true,
    eligibleStoreCount,
    cashConfiguredStoreCount,
    accrualConfiguredStoreCount,
    cashCoverageComplete: cashMissing.length === 0,
    accrualCoverageComplete: accrualMissing.length === 0,
    cashMissingStores: cashMissing,
    accrualMissingStores: accrualMissing,
    targets: Object.fromEntries(Object.entries(rows).map(([storeKey, row]) => [storeKey, { storeName: storeKey, ...row }])),
  };
};

test("current/detail Formal cash subtracts both refund types and preserves explicit zero", () => {
  const master = makeMaster("cyj", { A: lifecycleEntry() });
  const targetSummary = makeTargetSummary({
    rows: { A: { cashTarget: 100, accrualTarget: 100 } },
  });
  const authority = buildCurrentDetailFormalAuthority({
    brandId: "cyj",
    yearMonth: "2026-08",
    lifecycleMaster: master,
    monthlyTargetSummary: targetSummary,
    cutoffDate: "2026-08-02",
    normalizeStoreKey,
    reports: [
      { storeName: "CYJA店", date: "2026-08-01", cash: 100, refund: 10, skincareRefund: 5, accrual: 90, operationalAccrual: 40 },
      { storeName: "A", date: "2026-08-02", cash: 0, refund: 0, skincareRefund: 0, accrual: 0, operationalAccrual: 0 },
    ],
  });

  assert.equal(authority.compatible, true);
  assert.equal(authority.stores.A.reportingStatus, "DATA_COMPLETE");
  assert.equal(authority.stores.A.formalNetCash, 85);
  assert.equal(authority.stores.A.formalNetCashStatus, KPI_VALUE_STATUS.VALID);
  assert.equal(authority.stores.A.formalAccrual, 90);
  assert.equal(authority.stores.A.cashAchievement, 85);
});

test("Anniu current/detail Formal accrual uses operationalAccrual authority", () => {
  const master = makeMaster("anniu", { A: lifecycleEntry() });
  const targetSummary = makeTargetSummary({
    brandId: "anniu",
    rows: { A: { cashTarget: 100, accrualTarget: 100 } },
  });
  const authority = buildCurrentDetailFormalAuthority({
    brandId: "anniu",
    yearMonth: "2026-08",
    lifecycleMaster: master,
    monthlyTargetSummary: targetSummary,
    cutoffDate: "2026-08-01",
    normalizeStoreKey,
    reports: [
      { storeName: "安妞A店", date: "2026-08-01", cash: 100, refund: 0, skincareRefund: 0, accrual: 999, operationalAccrual: 80 },
    ],
  });

  assert.equal(authority.stores.A.formalAccrual, 80);
  assert.equal(authority.stores.A.accrualAchievement, 80);
});

test("missing expected report fails actual closed without contaminating a complete selected store scope", () => {
  const master = makeMaster("cyj", { A: lifecycleEntry(), B: lifecycleEntry() });
  const targetSummary = makeTargetSummary({
    rows: {
      A: { cashTarget: 100, accrualTarget: 100 },
      B: { cashTarget: 100, accrualTarget: 100 },
    },
  });
  const authority = buildCurrentDetailFormalAuthority({
    brandId: "cyj",
    yearMonth: "2026-08",
    lifecycleMaster: master,
    monthlyTargetSummary: targetSummary,
    cutoffDate: "2026-08-02",
    normalizeStoreKey,
    reports: [
      { storeName: "A", date: "2026-08-01", cash: 50, refund: 0, skincareRefund: 0, accrual: 50, operationalAccrual: 50 },
      { storeName: "A", date: "2026-08-02", cash: 50, refund: 0, skincareRefund: 0, accrual: 50, operationalAccrual: 50 },
      { storeName: "B", date: "2026-08-01", cash: 500, refund: 0, skincareRefund: 0, accrual: 500, operationalAccrual: 500 },
    ],
  });

  assert.equal(authority.stores.B.reportingStatus, "DATA_INCOMPLETE");
  assert.equal(authority.stores.B.formalNetCash, null);
  assert.equal(authority.stores.B.formalNetCashStatus, "DATA_INCOMPLETE");
  assert.equal(authority.stores.B.formalRankEligible, false);

  const fullScope = buildCurrentDetailFormalScope({ authority, normalizeStoreKey });
  assert.equal(fullScope.cash, null);
  assert.equal(fullScope.cashStatus, "DATA_INCOMPLETE");
  assert.equal(fullScope.reportingStatus, "DATA_INCOMPLETE");

  const storeAScope = buildCurrentDetailFormalScope({ authority, storeKeys: ["A"], normalizeStoreKey });
  assert.equal(storeAScope.cash, 100);
  assert.equal(storeAScope.cashStatus, KPI_VALUE_STATUS.VALID);
  assert.equal(storeAScope.reportingStatus, "DATA_COMPLETE");
});

test("target coverage stays scope-aware but full scope never shrinks a missing denominator", () => {
  const master = makeMaster("cyj", { A: lifecycleEntry(), B: lifecycleEntry() });
  const targetSummary = makeTargetSummary({
    rows: {
      A: { cashTarget: 100, accrualTarget: 100 },
      B: { cashTarget: null, accrualTarget: 100 },
    },
    cashMissing: ["B"],
  });
  const reports = ["A", "B"].flatMap((storeName) => [
    { storeName, date: "2026-08-01", cash: 100, refund: 0, skincareRefund: 0, accrual: 100, operationalAccrual: 100 },
  ]);
  const authority = buildCurrentDetailFormalAuthority({
    brandId: "cyj",
    yearMonth: "2026-08",
    lifecycleMaster: master,
    monthlyTargetSummary: targetSummary,
    cutoffDate: "2026-08-01",
    normalizeStoreKey,
    reports,
  });

  assert.equal(authority.targetAuthority.coverageConsistent, true);
  const fullScope = buildCurrentDetailFormalScope({ authority, normalizeStoreKey });
  assert.equal(fullScope.cash, 200);
  assert.equal(fullScope.cashTarget, null);
  assert.equal(fullScope.cashTargetStatus, "TARGET_INCOMPLETE");
  assert.equal(fullScope.cashAchievement, null);
  assert.equal(fullScope.cashAchievementStatus, "TARGET_INCOMPLETE");

  const storeAScope = buildCurrentDetailFormalScope({ authority, storeKeys: ["A"], normalizeStoreKey });
  assert.equal(storeAScope.cashTarget, 100);
  assert.equal(storeAScope.cashAchievement, 100);
});

test("opening-store daily boundary excludes pre-open report activity from both completeness and Formal actual", () => {
  const master = makeMaster("yibo", {
    A: lifecycleEntry({ openDate: "2026-08-10" }),
  });
  const targetSummary = makeTargetSummary({
    brandId: "yibo",
    rows: { A: { cashTarget: 100, accrualTarget: 100 } },
  });
  const authorityBeforeOpen = buildCurrentDetailFormalAuthority({
    brandId: "yibo",
    yearMonth: "2026-08",
    lifecycleMaster: master,
    monthlyTargetSummary: targetSummary,
    cutoffDate: "2026-08-09",
    normalizeStoreKey,
    reports: [
      { storeName: "伊啵A店", date: "2026-08-05", cash: 999, refund: 0, skincareRefund: 0, accrual: 999, operationalAccrual: 999 },
    ],
  });

  assert.equal(authorityBeforeOpen.stores.A.expectedReportDayCount, 0);
  assert.equal(authorityBeforeOpen.stores.A.reportingStatus, "DATA_COMPLETE");
  assert.equal(authorityBeforeOpen.stores.A.formalNetCash, 0);
  assert.equal(authorityBeforeOpen.stores.A.formalNetCashStatus, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(authorityBeforeOpen.stores.A.formalRankEligible, true);
});

test("cross-brand or non-READY Lifecycle authority fails closed", () => {
  const wrongBrand = buildCurrentDetailFormalAuthority({
    brandId: "cyj",
    yearMonth: "2026-08",
    lifecycleMaster: makeMaster("anniu", { A: lifecycleEntry() }),
    monthlyTargetSummary: null,
    reports: [],
    normalizeStoreKey,
  });
  assert.equal(wrongBrand.compatible, false);
  assert.equal(wrongBrand.reason, "LIFECYCLE_NOT_READY");

  const building = buildCurrentDetailFormalAuthority({
    brandId: "cyj",
    yearMonth: "2026-08",
    lifecycleMaster: { ...makeMaster("cyj", { A: lifecycleEntry() }), datasetStatus: "BUILDING" },
    monthlyTargetSummary: null,
    reports: [],
    normalizeStoreKey,
  });
  assert.equal(building.compatible, false);
});

test("5E-1B current detail keeps configured zero target and returns denominator N_A without ranking", () => {
  const master = makeMaster("cyj", { A: lifecycleEntry() });
  const targetSummary = makeTargetSummary({
    rows: { A: { cashTarget: 0, accrualTarget: 0 } },
  });
  const authority = buildCurrentDetailFormalAuthority({
    brandId: "cyj",
    yearMonth: "2026-08",
    lifecycleMaster: master,
    monthlyTargetSummary: targetSummary,
    cutoffDate: "2026-08-01",
    normalizeStoreKey,
    reports: [{
      storeName: "CYJA店",
      date: "2026-08-01",
      cash: 100,
      refund: 0,
      skincareRefund: 0,
      accrual: 100,
      operationalAccrual: 100,
    }],
  });

  assert.equal(authority.compatible, true);
  assert.equal(authority.targetAuthority.coverageConsistent, true);

  const store = authority.stores.A;
  assert.equal(store.cashTarget, 0);
  assert.equal(store.cashTargetStatus, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(store.cashAchievement, null);
  assert.equal(store.cashAchievementStatus, KPI_VALUE_STATUS.N_A);
  assert.equal(store.accrualTarget, 0);
  assert.equal(store.accrualTargetStatus, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(store.accrualAchievement, null);
  assert.equal(store.accrualAchievementStatus, KPI_VALUE_STATUS.N_A);
  assert.equal(store.formalRankEligible, false);

  const scope = buildCurrentDetailFormalScope({
    authority,
    storeKeys: ["A"],
    normalizeStoreKey,
  });
  assert.equal(scope.cashTarget, 0);
  assert.equal(scope.cashTargetStatus, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(scope.cashAchievement, null);
  assert.equal(scope.cashAchievementStatus, KPI_VALUE_STATUS.N_A);
  assert.equal(scope.accrualTarget, 0);
  assert.equal(scope.accrualTargetStatus, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(scope.accrualAchievement, null);
  assert.equal(scope.accrualAchievementStatus, KPI_VALUE_STATUS.N_A);
  assert.equal(scope.cashCoverageComplete, true);
  assert.equal(scope.accrualCoverageComplete, true);
});
