import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const dashboard = fs.readFileSync(new URL("../src/components/DashboardView.jsx", import.meta.url), "utf8");
const therapistPerformance = fs.readFileSync(new URL("../src/components/TherapistPerformanceView.jsx", import.meta.url), "utf8");

const lowFrequencyStart = app.indexOf("const fetchLowFrequencyData = async () =>");
const lowFrequencyEnd = app.indexOf("const unsubStatsToday =", lowFrequencyStart);
assert.ok(lowFrequencyStart >= 0 && lowFrequencyEnd > lowFrequencyStart);
const lowFrequencyBlock = app.slice(lowFrequencyStart, lowFrequencyEnd);

test("P2-A2.1 Dashboard store mode does not own therapist target year listener", () => {
  assert.match(
    lowFrequencyBlock,
    /activeView === "dashboard"[\s\S]*dashboardViewMode === "therapist"[\s\S]*userRole === "therapist"[\s\S]*userRole === "trainer"/
  );
  assert.doesNotMatch(
    lowFrequencyBlock,
    /shouldLoadTherapistTargets\s*=\s*therapistModuleEnabled\s*&&\s*\(\s*activeView === "dashboard"\s*\|\|/
  );
});

test("P2-A2.1 target editor and therapist-target audit keep yearly live authority", () => {
  assert.match(lowFrequencyBlock, /activeView === "t-targets"/);
  assert.match(lowFrequencyBlock, /activeView === "audit"\s*&&\s*auditType === "therapist-target"/);
  assert.match(
    lowFrequencyBlock,
    /query\(getCollectionPath\("therapist_targets"\),\s*where\("year",\s*"==",\s*targetYearStr\)\)/
  );
  assert.match(lowFrequencyBlock, /trackSnapshotRead\("therapist_targets_year_live"/);
});

test("P2-A2.1 dashboard mode bridge can start and stop the target listener without polling", () => {
  assert.match(app, /window\.addEventListener\("cyj_dashboard_view_mode_changed"/);
  assert.match(app, /\bdashboardViewMode\b[\s\S]*\buserRole\b[\s\S]*getStableReadMeta/);
  assert.doesNotMatch(lowFrequencyBlock, /setInterval\s*\(/);
  assert.doesNotMatch(lowFrequencyBlock, /setTimeout\s*\(/);
});

test("P2-A2.1 therapist targets are consumed only by therapist presentation in Dashboard bundle", () => {
  assert.match(therapistPerformance, /therapistTargets/);
  assert.match(therapistPerformance, /resolveTherapistTarget/);
  assert.match(dashboard, /isTherapistViewActive/);
  assert.match(dashboard, /isTherapistViewActive\s*&&/);
});

test("P2-A2.1 adds no extra therapist_targets listener", () => {
  const matches = lowFrequencyBlock.match(/onSnapshot\s*\(\s*query\(getCollectionPath\("therapist_targets"\)/g) || [];
  assert.equal(matches.length, 1);
});
