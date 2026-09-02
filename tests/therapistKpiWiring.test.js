import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const indexSource = read("functions/index.js");
const maintenance = read("src/components/SystemMaintenance.jsx");
const hook = read("src/hooks/useDashboardStats.js");
const view = read("src/components/TherapistPerformanceView.jsx");
const fe = read("src/utils/therapistKpi.js");
const be = read("functions/therapistKpi.js");
const app = read("src/App.jsx");

test("Batch 6A writers and consumers use shared Therapist KPI semantics", () => {
  assert.match(indexSource, /require\("\.\/therapistKpi"\)/);
  assert.match(indexSource, /applyTherapistRankingSemantics\(Object\.values\(therapistMap\)\)/);
  assert.match(indexSource, /buildTherapistAggregateMetrics\(therapistRankings\)/);
  assert.match(indexSource, /Therapist KPI Signature/);
  assert.doesNotMatch(indexSource, /item\.rank > therapistRankings\.length - 10/);

  assert.match(maintenance, /from "\.\.\/utils\/therapistKpi"/);
  assert.match(maintenance, /applyTherapistRankingSemantics\(Object\.values\(therapistMap\)\)/);
  assert.match(maintenance, /buildTherapistAggregateMetrics\(therapistRankings\)/);
  assert.match(maintenance, /Therapist KPI Signature/);
  assert.doesNotMatch(maintenance, /item\.rank > therapistRankings\.length - 10/);

  assert.match(hook, /from '\.\.\/utils\/therapistKpi\.js'/);
  assert.match(hook, /applyTherapistRankingSemantics/);
  assert.match(hook, /buildTherapistAggregateMetrics/);
  assert.doesNotMatch(hook, /newCustomerCount \|\| 1/);
  assert.doesNotMatch(hook, /totalTherapists - 10/);
  assert.doesNotMatch(hook, /arr\.length - 10/);
});

test("Batch 6A Therapist Performance has no fabricated targets or fake denominator", () => {
  assert.match(view, /validPositiveSetting/);
  assert.match(view, /isFiniteTherapistMetric/);
  assert.doesNotMatch(view, /800000/);
  assert.doesNotMatch(view, /targetAsp === 3500/);
  assert.doesNotMatch(view, /targetAsp = 16000/);
  assert.doesNotMatch(view, /targetAsp = 25000/);
  assert.doesNotMatch(view, /teamTarget \|\| 1/);
  assert.match(view, /目標未設定/);
  assert.match(view, /無樣本/);
});

test("Batch 6A.1 Therapist Performance renders nullable KPI and missing targets fail-closed", () => {
  assert.doesNotMatch(view, /\.newClosingRate\.toFixed\(/);
  // CSV export intentionally keeps guarded raw rounded numbers; only the table renderer
  // must never coerce nullable ASP through Math.round.
  assert.doesNotMatch(view, /\{fmtNum\(Math\.round\(t\.newAsp\)\)\}<\/td>/);
  assert.doesNotMatch(view, /\{fmtNum\(Math\.round\(t\.oldAsp\)\)\}<\/td>/);
  assert.match(view, /isFiniteTherapistMetric\(t\.newAsp\) \? Math\.round\(t\.newAsp\) : "N\/A"/);
  assert.match(view, /isFiniteTherapistMetric\(t\.oldAsp\) \? Math\.round\(t\.oldAsp\) : "N\/A"/);
  assert.match(view, /formatNullablePercent\(t\.newClosingRate\)/);
  assert.match(view, /formatNullableNumber\(t\.newAsp\)/);
  assert.match(view, /formatNullableNumber\(t\.oldAsp\)/);
  assert.match(view, /getComparisonTone/);
  assert.match(view, /renderComparisonArrow/);
  assert.match(view, /renderComparisonBadge/);
  assert.match(view, /targetComplete[\s\S]*目標未完整設定/);
  assert.doesNotMatch(view, /return Number\(t\.totalRevenue \|\| 0\) >= personalTarget/);
});

test("Batch 6A pure helpers do not add Firestore or polling", () => {
  for (const source of [fe, be]) {
    assert.doesNotMatch(source, /firebase\/firestore|firebase-admin|\.collection\(|getDocs\(|getDoc\(|onSnapshot\(|setInterval\(|onSchedule\(/);
  }
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*["']3\.5\.3["']/);
});

test("Batch 6A automatic Summary builder deploy call graph remains repair-only", () => {
  const buildCalls = [...indexSource.matchAll(/buildAutoDashboardSummaryPayloads\(/g)];
  assert.equal(buildCalls.length, 2, "expected declaration + finalize call only");
  assert.match(indexSource, /exports\.repairDirtySummaryNow\s*=/);
  assert.match(indexSource, /exports\.repairDirtySummaries\s*=/);
});
