import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as frontend from "../src/utils/kpiContracts.js";

const require = createRequire(import.meta.url);
const backend = require("../functions/kpiContracts.js");

const implementations = [
  ["frontend", frontend],
  ["backend", backend],
];

for (const [label, api] of implementations) {
  test(`${label}: formal net cash includes both refund types and preserves negative/zero`, () => {
    assert.deepEqual(api.formalNetCash(100000, 10000, 5000), {
      status: api.KPI_VALUE_STATUS.VALID,
      value: 85000,
      components: { cash: 100000, refund: 10000, skincareRefund: 5000 },
    });
    assert.equal(api.formalNetCash(15000, 10000, 5000).status, api.KPI_VALUE_STATUS.VALID_ZERO);
    assert.equal(api.formalNetCash(10000, 12000, 1000).value, -3000);
  });

  test(`${label}: missing/invalid numeric fields are distinct from a true zero`, () => {
    assert.equal(api.inspectKpiNumber(0).status, api.KPI_VALUE_STATUS.VALID_ZERO);
    assert.equal(api.inspectKpiNumber("0").status, api.KPI_VALUE_STATUS.VALID_ZERO);
    assert.equal(api.inspectKpiNumber(-0).status, api.KPI_VALUE_STATUS.VALID_ZERO);
    assert.equal(api.inspectKpiNumber("").status, api.KPI_VALUE_STATUS.FIELD_MISSING);
    assert.equal(api.inspectKpiNumber(null).status, api.KPI_VALUE_STATUS.FIELD_MISSING);
    assert.equal(api.inspectKpiNumber("abc").status, api.KPI_VALUE_STATUS.DATA_INVALID);
    assert.equal(api.inspectKpiNumber(true).status, api.KPI_VALUE_STATUS.DATA_INVALID);
  });

  test(`${label}: formal accrual is brand-specific and keeps total accrual distinct for 安妞`, () => {
    assert.deepEqual(api.formalAccrual("cyj", 500, 300), {
      status: api.KPI_VALUE_STATUS.VALID,
      value: 500,
      brandId: "cyj",
      sourceField: "accrual",
    });
    assert.equal(api.formalAccrual("yibo", 600, 350).value, 600);
    assert.deepEqual(api.formalAccrual("anniu", 900, 700), {
      status: api.KPI_VALUE_STATUS.VALID,
      value: 700,
      brandId: "anniu",
      sourceField: "operationalAccrual",
    });
    assert.equal(api.formalAccrual("unknown", 900, 700).status, api.KPI_VALUE_STATUS.DATA_INVALID);
  });

  test(`${label}: base target distinguishes missing from explicit configured zero`, () => {
    for (const value of ["", null, undefined]) {
      assert.equal(api.validBaseTarget(value).status, api.KPI_VALUE_STATUS.TARGET_NOT_SET);
      assert.equal(api.validBaseTarget(value).valid, false);
    }
    for (const value of [0, "0"]) {
      assert.deepEqual(api.validBaseTarget(value), {
        status: api.KPI_VALUE_STATUS.VALID_ZERO,
        valid: true,
        value: 0,
      });
    }
    assert.deepEqual(api.validBaseTarget("800,000"), {
      status: api.KPI_VALUE_STATUS.VALID,
      valid: true,
      value: 800000,
    });
    assert.equal(api.validBaseTarget(-1).status, api.KPI_VALUE_STATUS.DATA_INVALID);
  });

  test(`${label}: challenge target is optional but must be greater than a valid base target`, () => {
    assert.equal(api.validChallengeTarget(100, "").status, api.KPI_VALUE_STATUS.CHALLENGE_NOT_SET);
    assert.equal(api.validChallengeTarget(100, 0).status, api.KPI_VALUE_STATUS.CHALLENGE_NOT_SET);
    assert.deepEqual(api.validChallengeTarget(0, 120), {
      status: api.KPI_VALUE_STATUS.VALID,
      valid: true,
      configured: true,
      value: 120,
    });
    assert.equal(api.validChallengeTarget(100, 100).status, api.KPI_VALUE_STATUS.DATA_INVALID);
    assert.equal(api.validChallengeTarget(100, 99).status, api.KPI_VALUE_STATUS.DATA_INVALID);
    assert.deepEqual(api.validChallengeTarget(100, 120), {
      status: api.KPI_VALUE_STATUS.VALID,
      valid: true,
      configured: true,
      value: 120,
    });
  });

  test(`${label}: ratio keeps true zero numerator but returns N/A for invalid denominator`, () => {
    assert.deepEqual(api.validRatio(0, 100), {
      status: api.KPI_VALUE_STATUS.VALID_ZERO,
      valid: true,
      value: 0,
    });
    assert.equal(api.validRatio(10, 0).status, api.KPI_VALUE_STATUS.N_A);
    assert.equal(api.validRatio(10, -2).value, -5);
    assert.equal(api.validRatio(10, -2, { requirePositiveDenominator: true }).status, api.KPI_VALUE_STATUS.N_A);
    assert.equal(api.validRatio("", 100).status, api.KPI_VALUE_STATUS.FIELD_MISSING);
  });

  test(`${label}: positive-only setting keeps zero unset for newASP semantics`, () => {
    assert.equal(api.validPositiveSetting("").status, api.KPI_VALUE_STATUS.TARGET_NOT_SET);
    assert.equal(api.validPositiveSetting(null).status, api.KPI_VALUE_STATUS.TARGET_NOT_SET);
    assert.equal(api.validPositiveSetting(0).status, api.KPI_VALUE_STATUS.TARGET_NOT_SET);
    assert.equal(api.validPositiveSetting("0").status, api.KPI_VALUE_STATUS.TARGET_NOT_SET);
    assert.deepEqual(api.validPositiveSetting(3500), {
      status: api.KPI_VALUE_STATUS.VALID,
      valid: true,
      value: 3500,
    });
    assert.equal(api.validPositiveSetting(-1).status, api.KPI_VALUE_STATUS.DATA_INVALID);
  });

  test(`${label}: Store Health benchmark requires finite positive min and max > min`, () => {
    assert.deepEqual(api.validateStoreHealthBenchmark(0.8, 1.2), {
      status: api.KPI_VALUE_STATUS.VALID,
      valid: true,
      min: 0.8,
      max: 1.2,
    });
    assert.equal(api.validateStoreHealthBenchmark("", 1.2).status, api.KPI_VALUE_STATUS.FIELD_MISSING);
    assert.equal(api.validateStoreHealthBenchmark(0, 1.2).status, api.KPI_VALUE_STATUS.DATA_INVALID);
    assert.equal(api.validateStoreHealthBenchmark(1.2, 1.2).status, api.KPI_VALUE_STATUS.DATA_INVALID);
    assert.equal(api.validateStoreHealthBenchmark(1.3, 1.2).status, api.KPI_VALUE_STATUS.DATA_INVALID);
  });
}

test("frontend and backend canonical KPI contracts stay behaviorally identical", () => {
  assert.equal(frontend.KPI_CONTRACT_VERSION, backend.KPI_CONTRACT_VERSION);
  assert.deepEqual(frontend.KPI_VALUE_STATUS, backend.KPI_VALUE_STATUS);

  const calls = [
    ["inspectKpiNumber", [0]],
    ["inspectKpiNumber", ["1,250"]],
    ["inspectKpiNumber", [""]],
    ["formalNetCash", [100000, 10000, 5000]],
    ["formalNetCash", [10000, 12000, 1000]],
    ["formalAccrual", ["cyj", 500, 300]],
    ["formalAccrual", ["anniu", 900, 700]],
    ["formalAccrual", ["yibo", 600, 350]],
    ["validBaseTarget", [0]],
    ["validBaseTarget", [800000]],
    ["validPositiveSetting", [0]],
    ["validPositiveSetting", [3500]],
    ["validChallengeTarget", [800000, 900000]],
    ["validRatio", [0, 100]],
    ["validRatio", [10, 0]],
    ["validRatio", [10, -2, { requirePositiveDenominator: true }]],
    ["validateStoreHealthBenchmark", [0.8, 1.2]],
  ];

  for (const [name, args] of calls) {
    assert.deepEqual(frontend[name](...args), backend[name](...args), `${name} parity mismatch`);
  }
});
