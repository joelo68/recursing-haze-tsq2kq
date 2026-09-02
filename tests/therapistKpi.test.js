import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import * as frontend from "../src/utils/therapistKpi.js";

const require = createRequire(import.meta.url);
const backend = require("../functions/therapistKpi.js");

const implementations = [
  ["frontend", frontend],
  ["backend", backend],
];

for (const [label, api] of implementations) {
  test(`${label}: zero new-customer sample is N/A, not zero`, () => {
    const row = api.buildTherapistSampleMetrics({
      totalRevenue: 1000,
      newCustomerRevenue: 0,
      oldCustomerRevenue: 1000,
      newCustomerCount: 0,
      oldCustomerCount: 2,
      newCustomerClosings: 0,
    });
    assert.equal(row.newClosingRate, null);
    assert.equal(row.newAsp, null);
    assert.equal(row.oldAsp, 500);
  });

  test(`${label}: aggregate uses ratio-of-totals and zero sample stays N/A`, () => {
    const grand = api.buildTherapistAggregateMetrics([
      { newCustomerRevenue: 1000, newCustomerCount: 1, newCustomerClosings: 1, oldCustomerRevenue: 100, oldCustomerCount: 1 },
      { newCustomerRevenue: 3000, newCustomerCount: 3, newCustomerClosings: 1, oldCustomerRevenue: 900, oldCustomerCount: 3 },
    ]);
    assert.equal(grand.regionalNewAsp, 1000);
    assert.equal(grand.regionalNewClosingRate, 50);
    assert.equal(grand.regionalOldAsp, 250);

    const empty = api.buildTherapistAggregateMetrics([{ newCustomerCount: 0, newCustomerRevenue: 0 }]);
    assert.equal(empty.regionalNewAsp, null);
    assert.equal(empty.regionalNewClosingRate, null);
  });

  test(`${label}: DANGER is dynamic bottom 20%, never overlaps TOP`, () => {
    const expectedDanger = new Map([
      [0, 0], [1, 0], [2, 0], [3, 0], [4, 1], [5, 1], [6, 2], [9, 2], [10, 2], [11, 3],
    ]);
    for (const [peers, danger] of expectedDanger) {
      assert.equal(api.getTherapistDangerCount(peers), danger, `peers=${peers}`);
      for (let rank = 1; rank <= peers; rank += 1) {
        const status = api.getTherapistRankStatus(rank, peers);
        if (rank <= Math.min(3, peers)) assert.equal(status, "TOP");
        if (status === "DANGER") assert.ok(rank > 3);
      }
    }
  });

  test(`${label}: ranking sorts totalRevenue and preserves null sample semantics`, () => {
    const rows = api.applyTherapistRankingSemantics([
      { id: "C", totalRevenue: 10, newCustomerCount: 0, newCustomerRevenue: 0 },
      { id: "A", totalRevenue: 30, newCustomerCount: 1, newCustomerRevenue: 100 },
      { id: "B", totalRevenue: 20, newCustomerCount: 2, newCustomerRevenue: 100 },
      { id: "D", totalRevenue: 5, newCustomerCount: 0, newCustomerRevenue: 0 },
    ]);
    assert.deepEqual(rows.map((r) => r.id), ["A", "B", "C", "D"]);
    assert.deepEqual(rows.map((r) => r.status), ["TOP", "TOP", "TOP", "DANGER"]);
    assert.equal(rows[2].newAsp, null);
    assert.equal(rows[3].newClosingRate, null);
  });
}

test("frontend/backend Therapist KPI implementations stay behaviorally identical", () => {
  assert.equal(frontend.THERAPIST_KPI_SEMANTIC_VERSION, backend.THERAPIST_KPI_SEMANTIC_VERSION);
  const rows = [
    { id: "A", name: "甲", totalRevenue: 300, newCustomerRevenue: 100, oldCustomerRevenue: 200, newCustomerCount: 2, oldCustomerCount: 2, newCustomerClosings: 1 },
    { id: "B", name: "乙", totalRevenue: 200, newCustomerRevenue: 0, oldCustomerRevenue: 200, newCustomerCount: 0, oldCustomerCount: 1, newCustomerClosings: 0 },
    { id: "C", name: "丙", totalRevenue: 100, newCustomerRevenue: 50, oldCustomerRevenue: 50, newCustomerCount: 1, oldCustomerCount: 1, newCustomerClosings: 1 },
    { id: "D", name: "丁", totalRevenue: 50, newCustomerRevenue: 0, oldCustomerRevenue: 50, newCustomerCount: 0, oldCustomerCount: 1, newCustomerClosings: 0 },
  ];
  assert.deepEqual(frontend.applyTherapistRankingSemantics(rows), backend.applyTherapistRankingSemantics(rows));
  assert.deepEqual(frontend.buildTherapistAggregateMetrics(rows), backend.buildTherapistAggregateMetrics(rows));
  const summary = { rankings: rows };
  assert.equal(frontend.buildTherapistSummarySignature(summary), backend.buildTherapistSummarySignature(summary));
});
