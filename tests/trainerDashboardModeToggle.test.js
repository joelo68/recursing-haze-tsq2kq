import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const header = fs.readFileSync(new URL("../src/components/DashboardHeader.jsx", import.meta.url), "utf8");
const view = fs.readFileSync(new URL("../src/components/DashboardView.jsx", import.meta.url), "utf8");
const stats = fs.readFileSync(new URL("../src/hooks/useDashboardStats.js", import.meta.url), "utf8");

const lowFrequencyStart = app.indexOf("const fetchLowFrequencyData = async () =>");
const lowFrequencyEnd = app.indexOf("const unsubStatsToday =", lowFrequencyStart);
assert.ok(lowFrequencyStart >= 0 && lowFrequencyEnd > lowFrequencyStart);
const lowFrequencyBlock = app.slice(lowFrequencyStart, lowFrequencyEnd);

const monthlyReadStart = app.indexOf("const shouldLoadDailyReportData =");
const monthlyReadEnd = app.indexOf("const cacheKey =", monthlyReadStart);
assert.ok(monthlyReadStart >= 0 && monthlyReadEnd > monthlyReadStart);
const monthlyReadBlock = app.slice(monthlyReadStart, monthlyReadEnd);

test("Trainer Dashboard keeps therapist as the default mode when the therapist module is enabled", () => {
  assert.match(
    stats,
    /useState\(\(isTherapistModuleEnabled && \(userRole === 'therapist' \|\| userRole === 'trainer'\)\) \? 'therapist' : 'store'\)/
  );
});

test("Trainer gets the existing Store Operations / Therapist Performance selector", () => {
  const selectorStart = header.indexOf("{isTherapistModuleEnabled && userRole !== 'therapist' && (");
  assert.ok(selectorStart >= 0);
  const selectorBlock = header.slice(selectorStart, header.indexOf("</>", selectorStart) + 3);

  assert.match(selectorBlock, /setViewMode\('store'\)/);
  assert.match(selectorBlock, /門市營運/);
  assert.match(selectorBlock, /setViewMode\('therapist'\)/);
  assert.match(selectorBlock, /人員績效/);
  assert.doesNotMatch(selectorBlock, /userRole !== 'trainer'/);
});

test("Trainer store mode renders StorePerformanceView instead of being role-blocked", () => {
  const storeGate = view.match(/const isStoreViewActive = \([\s\S]*?\);/)?.[0] || "";
  assert.match(storeGate, /viewMode === 'store'/);
  assert.match(storeGate, /userRole !== 'therapist'/);
  assert.doesNotMatch(storeGate, /userRole !== 'trainer'/);
  assert.match(view, /\{isStoreViewActive && \([\s\S]*?<StorePerformanceView/);
});


test("Trainer Store Operations reuses the existing full-brand dashboard store scope", () => {
  assert.match(
    stats,
    /userRole === 'director' \|\| userRole === 'trainer' \|\| userRole === 'therapist' \|\| userRole === 'master'[\s\S]*?sourceStores = Object\.values\(managers \|\| \{\}\)\.flat\(\);/
  );
});

test("Trainer store mode does not keep therapist target/report reads alive", () => {
  assert.match(
    lowFrequencyBlock,
    /activeView === "dashboard"[\s\S]*dashboardViewMode === "therapist"[\s\S]*userRole === "therapist"/
  );
  assert.doesNotMatch(
    lowFrequencyBlock,
    /dashboardViewMode === "therapist"[\s\S]*userRole === "therapist"[\s\S]*userRole === "trainer"/
  );

  assert.match(
    monthlyReadBlock,
    /activeView === "dashboard" && \(dashboardViewMode === "therapist" \|\| userRole === "therapist"\)/
  );
  assert.doesNotMatch(
    monthlyReadBlock,
    /dashboardViewMode === "therapist" \|\| userRole === "therapist" \|\| userRole === "trainer"/
  );
});

test("Trainer store mode skips therapist-only aggregation while therapist role remains fixed", () => {
  assert.match(
    stats,
    /if \(viewMode !== "therapist" && userRole !== "therapist"\) return null;/
  );
  assert.match(
    stats,
    /if \(viewMode !== "therapist" && userRole !== "therapist"\) return emptyTherapistStats;/
  );
  assert.doesNotMatch(
    stats,
    /viewMode !== "therapist" && userRole !== "therapist" && userRole !== "trainer"/
  );
});

test("Therapist-module-disabled brands stay on store mode and hide the selector", () => {
  assert.match(
    stats,
    /if \(!isTherapistModuleEnabled && viewMode === 'therapist'\) \{\s*setViewMode\('store'\);/
  );
  assert.match(
    header,
    /\{isTherapistModuleEnabled && userRole !== 'therapist' && \(/
  );
});

test("Trainer Dashboard mode change adds no Firestore primitive or polling to presentation owners", () => {
  for (const source of [header, view]) {
    assert.doesNotMatch(
      source,
      /\bonSnapshot\b|\bgetDoc\b|\bgetDocs\b|\bcollection\s*\(|\bquery\s*\(|\bsetInterval\s*\(|\bsetTimeout\s*\(/
    );
  }
});
