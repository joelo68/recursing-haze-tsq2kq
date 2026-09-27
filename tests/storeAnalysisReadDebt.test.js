import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/components/StoreAnalysisView.jsx", import.meta.url), "utf8");
const start = source.indexOf('if (activeView !== "store-analysis" || !selectedStore || !getCollectionPath)');
const end = source.indexOf('const formalReportRows', start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);

test("P2-A1 primary remains selected-store + selected-month scoped", () => {
  assert.match(block, /where\("storeName",\s*"in",\s*variants\)/);
  assert.match(block, /where\("date",\s*">=",\s*selectedYearMonthRange\.startDate\)/);
  assert.match(block, /where\("date",\s*"<=",\s*selectedYearMonthRange\.endDate\)/);
});

test("P2-A1 removes all-history storeName-only fallback", () => {
  assert.doesNotMatch(block, /query\(getCollectionPath\("daily_reports"\),\s*where\("storeName",\s*"in",\s*variants\)\)/);
  assert.doesNotMatch(block, /store_analysis_selected_store_reports_fallback/);
  assert.doesNotMatch(source, /isDateInSelectedMonth/);
});

test("P2-A1 bounded fallback is selected-month only", () => {
  assert.match(block, /store_analysis_selected_store_reports_month_bounded_fallback/);
  assert.match(block, /const variantSet = new Set\(variants\)/);
  assert.match(block, /variantSet\.has\(String\(d\?\.storeName \|\| ""\)\.trim\(\)\)/);
});

test("P2-A1 zero-result primary does not trigger fallback", () => {
  assert.doesNotMatch(block, /docs\.length\s*===\s*0/);
  assert.doesNotMatch(block, /snap\.empty/);
});

test("P2-A1 fallback is missing-index / failed-precondition only", () => {
  assert.match(block, /code === "failed-precondition"/);
  assert.match(block, /message\.includes\("requires an index"\)/);
  assert.match(block, /非索引型錯誤不啟動 fallback/);
});

test("P2-A1 keeps two listeners and no polling", () => {
  assert.equal((block.match(/onSnapshot\s*\(/g) || []).length, 2);
  assert.doesNotMatch(block, /setInterval\s*\(/);
  assert.doesNotMatch(block, /setTimeout\s*\(/);
});
