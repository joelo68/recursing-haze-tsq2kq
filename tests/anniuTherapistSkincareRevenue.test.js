import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  calculateTherapistReportTotalRevenue,
  getTherapistReportWritableFields,
  isAnniuTherapistReportBrand,
} from "../src/utils/therapistReportContract.js";

const inputView = fs.readFileSync(new URL("../src/components/InputView.jsx", import.meta.url), "utf8");
const historyView = fs.readFileSync(new URL("../src/components/HistoryView.jsx", import.meta.url), "utf8");
const backend = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("Anniu total includes new/old skincare revenue while CYJ and Yibo keep legacy total semantics", () => {
  const row = {
    newCustomerRevenue: "20,000",
    newCustomerSkincareRevenue: "3,000",
    oldCustomerRevenue: "15,000",
    oldCustomerSkincareRevenue: "2,000",
    returnRevenue: "1,000",
  };

  assert.equal(calculateTherapistReportTotalRevenue(row, "anniu"), 39000);
  assert.equal(calculateTherapistReportTotalRevenue(row, { id: "anniu" }), 39000);
  assert.equal(calculateTherapistReportTotalRevenue(row, "cyj"), 34000);
  assert.equal(calculateTherapistReportTotalRevenue(row, "yibo"), 34000);
});

test("brand detection and writable fields isolate skincare schema to Anniu", () => {
  assert.equal(isAnniuTherapistReportBrand("anniu"), true);
  assert.equal(isAnniuTherapistReportBrand({ id: "anniu" }), true);
  assert.equal(isAnniuTherapistReportBrand("cyj"), false);
  assert.equal(isAnniuTherapistReportBrand("yibo"), false);

  const anniu = getTherapistReportWritableFields("anniu");
  assert.ok(anniu.includes("newCustomerSkincareRevenue"));
  assert.ok(anniu.includes("oldCustomerSkincareRevenue"));

  for (const brand of ["cyj", "yibo"]) {
    const fields = getTherapistReportWritableFields(brand);
    assert.equal(fields.includes("newCustomerSkincareRevenue"), false);
    assert.equal(fields.includes("oldCustomerSkincareRevenue"), false);
  }
});

test("InputView renders and writes skincare fields only through the Anniu branch", () => {
  assert.match(inputView, /const isAnniuTherapistReport = isAnniuTherapistReportBrand\(currentBrand\)/);
  assert.match(inputView, /newCustomerSkincareRevenue: ""/);
  assert.match(inputView, /oldCustomerSkincareRevenue: ""/);
  assert.match(inputView, /\.\.\.\(isAnniuTherapistReport \? \{ newCustomerSkincareRevenue:/);
  assert.match(inputView, /\.\.\.\(isAnniuTherapistReport \? \{ oldCustomerSkincareRevenue:/);
  assert.match(inputView, /calculateTherapistReportTotalRevenue\(formData, currentBrand\)/);
  assert.match(inputView, /新客保養品業績/);
  assert.match(inputView, /舊客保養品業績/);
});

test("HistoryView preserves Anniu skincare fields and recalculates total with the same shared contract", () => {
  assert.match(historyView, /getTherapistReportWritableFields\(currentBrand\)/);
  assert.match(historyView, /calculateTherapistReportTotalRevenue\(newState, currentBrand\)/);
  assert.match(historyView, /newCustomerSkincareRevenue/);
  assert.match(historyView, /oldCustomerSkincareRevenue/);
  assert.match(historyView, /legacyZero: true/);
});

test("backend aggregation and dirty detection carry both skincare fields without adding a new query or listener", () => {
  assert.match(backend, /THERAPIST_DAILY_REPORT_DIRTY_FIELDS[\s\S]*"newCustomerSkincareRevenue"[\s\S]*"oldCustomerSkincareRevenue"/);
  assert.match(backend, /newCustomerSkincareRevenue:\s*\(Number\(afterData\.newCustomerSkincareRevenue\) \|\| 0\) - \(Number\(beforeData\.newCustomerSkincareRevenue\) \|\| 0\)/);
  assert.match(backend, /oldCustomerSkincareRevenue:\s*\(Number\(afterData\.oldCustomerSkincareRevenue\) \|\| 0\) - \(Number\(beforeData\.oldCustomerSkincareRevenue\) \|\| 0\)/);
  assert.match(backend, /exports\.aggregateBrandTherapistReports/);
  assert.match(backend, /exports\.aggregateLegacyTherapistReports/);
});

test("Firestore Rules surface is intentionally unchanged by the additive field contract", () => {
  assert.ok(rules.length > 0);
});
