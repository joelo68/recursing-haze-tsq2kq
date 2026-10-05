import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const annualBackend = read("functions/annualKpiSummary.js");
const annualFrontend = read("src/utils/annualKpiBenchmark.js");
const annualHook = read("src/hooks/useAnnualKpiBenchmark.js");
const storeView = read("src/components/StorePerformanceView.jsx");

test("Dashboard KPI annual-average extension remains Summary-first with no new Dashboard Firestore read", () => {
  assert.match(annualBackend, /operationalAccrual: Object\.freeze/);
  assert.match(annualBackend, /newCustomerSales: Object\.freeze/);
  assert.match(annualBackend, /newCustomerClosings: Object\.freeze/);
  assert.match(annualFrontend, /"operationalAccrual"/);
  assert.match(annualFrontend, /"newCustomerSales"/);
  assert.match(annualFrontend, /"newCustomerClosings"/);
  assert.match(annualHook, /getDoc\(summaryRef\)/);
  assert.doesNotMatch(storeView, /getDoc\(|getDocs\(|onSnapshot\(/);
});

test("Annual KPI cache key advances so old cached v2 documents do not hide newly rebuilt metrics", () => {
  assert.match(annualHook, /cyj_annual_kpi_summary_v7_/);
  assert.doesNotMatch(annualHook, /cyj_annual_kpi_summary_v6_/);
});

test("Annual ratio helper uses shared months and ratio-of-totals instead of averaging monthly ratios", () => {
  assert.match(annualFrontend, /aggregation: "ratio_of_totals"/);
  assert.match(annualFrontend, /numeratorTotal \/ denominatorTotal/);
  assert.match(annualFrontend, /Number\(denominatorValues\[yearMonth\]\) > 0/);
});
