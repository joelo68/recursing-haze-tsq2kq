import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

import * as frontendKpi from "../src/utils/therapistKpi.js";

const require = createRequire(import.meta.url);
const backendKpi = require("../functions/therapistKpi.js");

const view = fs.readFileSync(new URL("../src/components/TherapistPerformanceView.jsx", import.meta.url), "utf8");
const hook = fs.readFileSync(new URL("../src/hooks/useDashboardStats.js", import.meta.url), "utf8");
const backend = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const maintenance = fs.readFileSync(new URL("../src/components/SystemMaintenance.jsx", import.meta.url), "utf8");

for (const [label, api] of [["frontend", frontendKpi], ["backend", backendKpi]]) {
  test(`${label}: therapist KPI derives one skincare total from new + returning skincare revenue`, () => {
    const row = api.buildTherapistSampleMetrics({
      totalRevenue: 39000,
      newCustomerRevenue: 20000,
      newCustomerSkincareRevenue: 3000,
      oldCustomerRevenue: 15000,
      oldCustomerSkincareRevenue: 2000,
      returnRevenue: 1000,
    });
    assert.equal(row.newCustomerSkincareRevenue, 3000);
    assert.equal(row.oldCustomerSkincareRevenue, 2000);
    assert.equal(row.skincareRevenue, 5000);
  });

  test(`${label}: therapist aggregate and Summary signature include skincare provenance`, () => {
    const rows = [
      { id: "A", totalRevenue: 39000, newCustomerRevenue: 20000, newCustomerSkincareRevenue: 3000, oldCustomerRevenue: 15000, oldCustomerSkincareRevenue: 2000 },
      { id: "B", totalRevenue: 12000, newCustomerRevenue: 5000, newCustomerSkincareRevenue: 1000, oldCustomerRevenue: 5000, oldCustomerSkincareRevenue: 1000 },
    ];
    const grand = api.buildTherapistAggregateMetrics(rows);
    assert.equal(grand.newCustomerSkincareRevenue, 4000);
    assert.equal(grand.oldCustomerSkincareRevenue, 3000);
    assert.equal(grand.skincareRevenue, 7000);

    const withoutSkincare = api.buildTherapistSummarySignature({ rankings: rows.map(({ newCustomerSkincareRevenue, oldCustomerSkincareRevenue, ...rest }) => rest) });
    const withSkincare = api.buildTherapistSummarySignature({ rankings: rows });
    assert.notEqual(withoutSkincare, withSkincare, "old therapist_summary without skincare must be distinguishable from fresh Anniu summary");
  });
}

test("current-month therapist detail carries both Anniu skincare source fields without a new read path", () => {
  assert.match(hook, /newCustomerSkincareRevenue: 0/);
  assert.match(hook, /oldCustomerSkincareRevenue: 0/);
  assert.match(hook, /statsMap\[id\]\.newCustomerSkincareRevenue \+= \(Number\(r\.newCustomerSkincareRevenue\) \|\| 0\)/);
  assert.match(hook, /statsMap\[id\]\.oldCustomerSkincareRevenue \+= \(Number\(r\.oldCustomerSkincareRevenue\) \|\| 0\)/);
});

test("backend and Maintenance Summary builders preserve skincare fields for historical therapist_summary", () => {
  for (const source of [backend, maintenance]) {
    assert.match(source, /newCustomerSkincareRevenue: 0/);
    assert.match(source, /oldCustomerSkincareRevenue: 0/);
    assert.match(source, /newCustomerSkincareRevenue \+= Number\(row\.newCustomerSkincareRevenue\) \|\| 0/);
    assert.match(source, /oldCustomerSkincareRevenue \+= Number\(row\.oldCustomerSkincareRevenue\) \|\| 0/);
  }
});

test("Therapist ranking shows one 保養品 column and CSV field only for Anniu", () => {
  assert.match(view, /const isAnniuBrand = /);
  assert.match(view, /isAnniuBrand && <th className="p-3 md:p-4 text-right">保養品<\/th>/);
  assert.match(view, /isAnniuBrand && <td className="p-3 md:p-4 text-right font-mono font-semibold text-emerald-600">\{fmtMoney\(t\.skincareRevenue\)\}<\/td>/);
  assert.match(view, /\.\.\.\(isAnniuBrand \? \["保養品"\] : \[\]\)/);
  assert.match(view, /\.\.\.\(isAnniuBrand \? \[t\.skincareRevenue\] : \[\]\)/);
  assert.match(view, /"個人總業績", "新客業績", "舊客業績"/);
  assert.doesNotMatch(view, /"今明業績"/);
});

test("ranking order remains totalRevenue-driven and skincare does not become a sort key", () => {
  for (const api of [frontendKpi, backendKpi]) {
    const ranked = api.applyTherapistRankingSemantics([
      { id: "A", totalRevenue: 100, newCustomerSkincareRevenue: 10000 },
      { id: "B", totalRevenue: 200, newCustomerSkincareRevenue: 0 },
    ]);
    assert.deepEqual(ranked.map((row) => row.id), ["B", "A"]);
  }
});
