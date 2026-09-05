import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { filterSystemExcludedStoreKeys } from "../src/utils/systemExclusion.js";
import {
  buildStoreSelfViewProfile,
  filterDashboardStorePresentationKeys,
} from "../src/utils/storeSelfView.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const clean = (value = "") => String(value || "")
  .replace(/^(CYJ|安妞|伊啵)/, "")
  .replace(/店$/, "")
  .trim();

test("formal selectable store helper removes System Excluded stores only after authority is ready", () => {
  const values = ["CYJ排除A店", "CYJ正常B店", "CYJ排除A店"];
  assert.deepEqual(
    filterSystemExcludedStoreKeys(values, { ready: true, stores: ["排除A"] }, clean),
    ["正常B"]
  );
  assert.deepEqual(
    filterSystemExcludedStoreKeys(values, { ready: false, stores: ["排除A"] }, clean),
    ["排除A", "正常B"]
  );
});

test("store self-view exception is role- and ownership-scoped, never hardcoded to a store name", () => {
  const state = { ready: true, stores: ["排除A", "排除B"] };

  assert.deepEqual(
    filterDashboardStorePresentationKeys({
      values: ["排除A", "排除B", "正常C"],
      userRole: "store",
      officialStores: ["排除A"],
      systemExclusionState: state,
      normalizeStoreKey: clean,
    }),
    ["排除A", "正常C"]
  );

  assert.deepEqual(
    filterDashboardStorePresentationKeys({
      values: ["排除A", "正常C"],
      userRole: "manager",
      officialStores: ["排除A"],
      systemExclusionState: state,
      normalizeStoreKey: clean,
    }),
    ["正常C"]
  );

  const profile = buildStoreSelfViewProfile({
    userRole: "store",
    scopeStoreKeys: ["排除A"],
    officialStores: ["排除A"],
    systemExclusionState: state,
    normalizeStoreKey: clean,
  });
  assert.equal(profile.active, true);
  assert.deepEqual(profile.excludedSelfStoreKeys, ["排除A"]);

  const mixedProfile = buildStoreSelfViewProfile({
    userRole: "store",
    scopeStoreKeys: ["排除A", "正常C"],
    officialStores: ["排除A", "正常C"],
    systemExclusionState: state,
    normalizeStoreKey: clean,
  });
  assert.equal(mixedProfile.active, false);
});

test("Dashboard selector preserves only the store account's own excluded store while management scope still excludes it", () => {
  const source = read("src/hooks/useDashboardStats.js");
  assert.match(source, /filterDashboardStorePresentationKeys\(\{[\s\S]*values: sourceStores,[\s\S]*userRole,[\s\S]*officialStores,[\s\S]*systemExclusionState/);
  assert.match(source, /selectedDashboardStore && !availableStoresForFilter\.includes\(selectedDashboardStore\)/);
  assert.match(source, /const filterPresentationStores = \(values = \[\]\) => filterDashboardStorePresentationKeys/);
  assert.match(source, /const storeSelfViewProfile = useMemo\(\(\) => buildStoreSelfViewProfile/);
  assert.match(source, /normalizedOfficialStores\.length > 0 && formalOfficialStores\.length === 0/);
  assert.match(source, /storeSelfViewActive/);
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

test("Dashboard therapist mode uses own-store detail scope during excluded store self-view without restoring company Formal scope", () => {
  const source = read("src/hooks/useDashboardStats.js");
  assert.match(source, /if \(storeSelfViewActive && userRole === "store"\) \{\s*return \[\.\.\.new Set\(\(effectiveStores/);
  assert.match(source, /if \(storeSelfViewActive && userRole === "store"\) return null;[\s\S]*isSummaryTrustedForDashboard/);
  assert.match(source, /currentMonthReports = therapistReports\.filter/);
});

test("Annual selectable and effective stores exclude System Excluded stores without touching target-maintenance Raw data", () => {
  const source = read("src/components/AnnualView.jsx");
  assert.match(source, /filterSystemExcludedStoreKeys\(sourceStores, systemExclusionState, cleanName\)/);
  assert.match(source, /selectedAnnualStore && !availableStoresForFilter\.includes\(selectedAnnualStore\)/);
  assert.match(source, /filterSystemExcludedStoreKeys\(\[selectedAnnualStore\], systemExclusionState, cleanName\)/);
  assert.doesNotMatch(source, /getCollectionPath\("monthly_targets"\)[\s\S]{0,250}systemExclusionState\.stores/);
});
