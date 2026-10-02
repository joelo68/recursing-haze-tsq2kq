import { CURRENT_APP_VERSION_SOURCE_PATTERN } from "./helpers/appVersionContract.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const storeAnalysis = fs.readFileSync(new URL("../src/components/StoreAnalysisView.jsx", import.meta.url), "utf8");
const writer = fs.readFileSync(new URL("../functions/currentStoreMonthReports.js", import.meta.url), "utf8");

const currentMonthStart = app.indexOf("if (isCurrentMonth) {");
const currentMonthEnd = app.indexOf("} else {\n      if (monthCacheRef.current[cacheKey])", currentMonthStart);
assert.ok(currentMonthStart >= 0 && currentMonthEnd > currentMonthStart);
const currentMonthBlock = app.slice(currentMonthStart, currentMonthEnd);

test("B4 current-month broad consumers gate Projection through one readiness status doc", () => {
  assert.match(app, /CURRENT_STORE_MONTH_PROJECTION_VIEWS = new Set\(\["dashboard", "regional", "ranking", "store-analysis"\]\)/);
  assert.match(currentMonthBlock, /getCollectionPath\("current_store_month_reports_status"\)/);
  assert.match(currentMonthBlock, /inspectCurrentStoreMonthReportsReadiness/);
  assert.match(currentMonthBlock, /getCollectionPath\("current_store_month_reports"\)/);
  assert.match(currentMonthBlock, /where\("yearMonth", "==", targetYearMonth\)/);
  assert.match(currentMonthBlock, /flattenCurrentStoreMonthReports/);
});

test("B4 fails back to the existing bounded current-month Raw listener without polling", () => {
  assert.match(currentMonthBlock, /startRawReports\(readiness\.reason \|\| "CONSUMER_NOT_READY"\)/);
  assert.match(currentMonthBlock, /startRawReports\("PROJECTION_LISTENER_ERROR"\)/);
  assert.match(currentMonthBlock, /getCollectionPath\("daily_reports"\)/);
  assert.match(currentMonthBlock, /where\("date", ">=", startDate\)/);
  assert.match(currentMonthBlock, /where\("date", "<=", endDate\)/);
  assert.doesNotMatch(currentMonthBlock, /setInterval\s*\(/);
  assert.doesNotMatch(currentMonthBlock, /setTimeout\s*\(/);
});

test("B4 leaves Audit/Daily Raw authority and selected-store Store Analysis scoped Raw path intact", () => {
  assert.doesNotMatch(app.match(/CURRENT_STORE_MONTH_PROJECTION_VIEWS = new Set\(([^;]+)\);/)?.[1] || "", /audit|daily/);
  assert.match(currentMonthBlock, /!\(activeView === "store-analysis" && storeAnalysisSelectedStore\)/);
  assert.match(storeAnalysis, /where\("storeName", "in", variants\)/);
  assert.match(storeAnalysis, /where\("date", ">=", selectedYearMonthRange\.startDate\)/);
  assert.match(storeAnalysis, /where\("date", "<=", selectedYearMonthRange\.endDate\)/);
});


test("B4 Projection writer carries every field used by current broad store consumers", () => {
  [
    "cash",
    "refund",
    "skincareRefund",
    "accrual",
    "operationalAccrual",
    "traffic",
    "skincareSales",
    "newCustomers",
    "newCustomerSales",
    "newCustomerRevenue",
    "newCustomerClosings",
  ].forEach((field) => {
    assert.match(writer, new RegExp(`['\"]${field}['\"]`));
  });
});

test("B4 does not change CURRENT_APP_VERSION", () => {
  assert.match(app, CURRENT_APP_VERSION_SOURCE_PATTERN);
});
