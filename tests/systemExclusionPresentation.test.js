import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { filterSystemExcludedStoreKeys } from "../src/utils/systemExclusion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const clean = (value = "") => String(value || "")
  .replace(/^(CYJ|安妞|伊啵)/, "")
  .replace(/店$/, "")
  .trim();

test("formal selectable store helper removes System Excluded stores only after authority is ready", () => {
  const values = ["CYJ中美店", "CYJ板橋店", "CYJ中美店"];
  assert.deepEqual(
    filterSystemExcludedStoreKeys(values, { ready: true, stores: ["中美"] }, clean),
    ["板橋"]
  );
  assert.deepEqual(
    filterSystemExcludedStoreKeys(values, { ready: false, stores: ["中美"] }, clean),
    ["中美", "板橋"]
  );
});

test("Dashboard selector and effective scope share System Exclusion authority and clear stale excluded selection", () => {
  const source = read("src/hooks/useDashboardStats.js");
  assert.match(source, /filterSystemExcludedStoreKeys\(sourceStores, systemExclusionState, cleanName\)/);
  assert.match(source, /selectedDashboardStore && !availableStoresForFilter\.includes\(selectedDashboardStore\)/);
  assert.match(source, /filterSystemExcludedStoreKeys\(\[selectedDashboardStore\], systemExclusionState, cleanName\)/);
  assert.match(source, /filterSystemExcludedStoreKeys\([\s\S]*managers\[selectedDashboardManager\][\s\S]*systemExclusionState,[\s\S]*cleanName/);
});

test("Dashboard explicit empty Formal scope never falls back to all-brand historical Summary", () => {
  const source = read("src/hooks/useDashboardStats.js");
  assert.match(source, /const stores = shouldFilterSummaryStores\s*\? allSummaryStores\.filter/);
  assert.match(source, /const isFilteredSummaryView = shouldFilterSummaryStores;/);
  assert.doesNotMatch(source, /shouldFilterSummaryStores && effectiveStoreSet\.size > 0/);
});

test("Therapist explicit empty store scope fails closed instead of skipping the filter", () => {
  const source = read("src/hooks/useDashboardStats.js");
  assert.match(source, /if \(useFilter\) \{\s*rankings = rankings\.filter/);
  assert.match(source, /if \(!useFilter\) return list;\s*return list\.filter/);
  assert.doesNotMatch(source, /if \(useFilter && selectedStores\.size > 0\)/);
});

test("Annual selectable and effective stores exclude System Excluded stores without touching target-maintenance Raw data", () => {
  const source = read("src/components/AnnualView.jsx");
  assert.match(source, /filterSystemExcludedStoreKeys\(sourceStores, systemExclusionState, cleanName\)/);
  assert.match(source, /selectedAnnualStore && !availableStoresForFilter\.includes\(selectedAnnualStore\)/);
  assert.match(source, /filterSystemExcludedStoreKeys\(\[selectedAnnualStore\], systemExclusionState, cleanName\)/);
  assert.doesNotMatch(source, /getCollectionPath\("monthly_targets"\)[\s\S]{0,250}systemExclusionState\.stores/);
});
