import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const annual = read("src/components/AnnualView.jsx");
const daily = read("src/components/DailyView.jsx");
const app = read("src/App.jsx");

test("UX2C Annual selector readiness is anchored to current-brand System Exclusion authority", () => {
  assert.match(annual, /const annualStoreScopeReady = Boolean\(/);
  assert.match(annual, /systemExclusionState\?\.ready === true/);
  assert.match(
    annual,
    /String\(systemExclusionState\?\.brandId \|\| ""\)\.toLowerCase\(\) === annualBrandId/
  );
});

test("UX2C Annual manager/store selectors fail closed until scope readiness", () => {
  assert.match(
    annual,
    /value=\{annualStoreScopeReady \? selectedAnnualManager : ""\}/
  );
  assert.match(
    annual,
    /value=\{annualStoreScopeReady \? selectedAnnualStore : ""\}/
  );
  assert.equal((annual.match(/disabled=\{!annualStoreScopeReady\}/g) || []).length, 2);
  assert.equal((annual.match(/aria-busy=\{!annualStoreScopeReady\}/g) || []).length, 2);
  assert.match(annual, /範圍同步中\.\.\./);
  assert.match(annual, /店家範圍同步中\.\.\./);
});

test("UX2C Daily reuses existing brand-anchored System Exclusion readiness", () => {
  assert.match(
    daily,
    /const systemExclusionReady = systemExclusionState\?\.ready === true &&/
  );
  assert.match(
    daily,
    /systemExclusionBrandId === String\(brandInfo\.id \|\| ""\)\.toLowerCase\(\)/
  );
  assert.match(daily, /const isSystemExclusionLoading = !systemExclusionReady;/);
});

test("UX2C Daily manager/store selectors fail closed while authority is unresolved", () => {
  assert.match(daily, /value=\{systemExclusionReady \? selectedManager : ""\}/);
  assert.match(daily, /value=\{systemExclusionReady \? selectedStore : ""\}/);
  assert.equal((daily.match(/disabled=\{!systemExclusionReady\}/g) || []).length, 2);
  assert.equal((daily.match(/aria-busy=\{!systemExclusionReady\}/g) || []).length, 2);
  assert.match(daily, /範圍同步中\.\.\./);
  assert.match(daily, /店家範圍同步中\.\.\./);
});

test("UX2C preserves existing Annual and Daily data authority paths", () => {
  assert.match(
    annual,
    /const annualPresentationReady = annualSummaryTrustReady && annualTargetSummariesLoaded;/
  );
  assert.match(daily, /const isSystemExclusionLoading = !systemExclusionReady;/);
  assert.match(daily, /const presentationStores = \(effectiveStores \|\| \[\]\)\.filter/);
  assert.match(daily, /return !systemExcludedStoreSet\.has\(core\);/);
});

test("UX2C keeps CURRENT_APP_VERSION unchanged", () => {
  assert.match(app, /const CURRENT_APP_VERSION = "3\.6\.0";/);
});
