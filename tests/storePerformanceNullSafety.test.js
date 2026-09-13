import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/components/StorePerformanceView.jsx"), "utf8");

test("StorePerformanceView renders nullable formal percentages without direct toFixed", () => {
  const unsafePatterns = [
    /storeRank\.rate\.toFixed\(/,
    /storeRank\.challengeRate\.toFixed\(/,
    /dashboardStats\.challengeAchievement\.toFixed\(/,
    /dashboardStats\.challengeAccrualAchievement\.toFixed\(/,
    /store\.rate\.toFixed\(/,
  ];

  unsafePatterns.forEach((pattern) => {
    assert.doesNotMatch(source, pattern);
  });

  assert.match(source, /formatKpiPercent\(storeRank\.rate\)/);
  assert.match(source, /formatKpiPercent\(storeRank\.challengeRate\)/);
  assert.match(source, /formatKpiPercent\(dashboardStats\.challengeAchievement\)/);
  assert.match(source, /formatKpiPercent\(dashboardStats\.challengeAccrualAchievement\)/);
  assert.match(source, /formatKpiPercent\(store\.rate\)/);
});

test("StorePerformanceView keeps nullable challenge projections as N/A instead of coercing null to zero", () => {
  assert.match(
    source,
    /formatProjectionTargetRate\(storeGrandTotal\.projection, storeGrandTotal\.challengeBudget\)/
  );
  assert.match(
    source,
    /formatProjectionTargetRate\(storeGrandTotal\.accrualProjection, storeGrandTotal\.challengeAccrualBudget\)/
  );
});

test("StorePerformanceView keeps Formal projection null-safe and suppresses transient values until Projection readiness", () => {
  assert.match(source, /const projectionPresentationReady = projectionRange\.presentationReady !== false;/);
  assert.match(
    source,
    /\{projectionPresentationReady \? formatKpiMoney\(storeGrandTotal\.projection\) : "同步中"\}/
  );
  assert.match(
    source,
    /\{projectionPresentationReady \? formatKpiMoney\(storeGrandTotal\.accrualProjection\) : "同步中"\}/
  );
  assert.match(
    source,
    /\{projectionPresentationReady \? formatProjectionTargetRate\(storeGrandTotal\.projection, storeGrandTotal\.budget\) : "—"\}/
  );
  assert.match(
    source,
    /\{projectionPresentationReady \? formatProjectionTargetRate\(storeGrandTotal\.accrualProjection, storeGrandTotal\.accrualBudget\) : "—"\}/
  );
  assert.match(source, /!projectionPresentationReady[\s\S]*?推估資料同步中/);
  assert.doesNotMatch(source, /\{fmtMoney\(storeGrandTotal\.projection\)\}/);
  assert.doesNotMatch(source, /\{fmtMoney\(storeGrandTotal\.accrualProjection\)\}/);
  assert.match(source, /const formatProjectionValue = \(value\) => \{\s*if \(!isFiniteKpi\(value\)\) return "尚無資料";\s*return fmtMoney\(value\);/);
});


test("StorePerformanceView keeps excluded-store self-view null-safe and labels the scope", () => {
  assert.match(source, /const storeSelfViewActive = dashboardStats\.storeSelfViewActive === true;/);
  assert.match(source, /const strictKpiPresentation = formalConsumerActive \|\| storeSelfViewActive;/);
  assert.match(source, /自店檢視｜本店目前不納入公司正式營運統計/);
});


test("StorePerformanceView uses KPI-specific Annual benchmark metadata and preserves a real zero", () => {
  assert.match(source, /getAnnualBenchmarkMetric\(annualKpiBenchmark, "traffic"\)/);
  assert.match(source, /getAnnualBenchmarkMetric\(annualKpiBenchmark, "newCustomers"\)/);
  assert.match(source, /isAnnualBenchmarkMetricDisplayable\(metric\)/);
  assert.match(source, /trafficBenchmarkMonthCount/);
  assert.match(source, /newCustomerBenchmarkMonthCount/);
  assert.match(source, /getAnnualBenchmarkLabel\(trafficAnnualBenchmark\)/);
  assert.doesNotMatch(source, /numeric > 0 \? fmtNum/);
});

test("Projection drawer uses neutral low/main/high estimate language without implying operating health", () => {
  assert.match(source, /title="低位推估"/);
  assert.match(source, /title="主推估"/);
  assert.match(source, /title="高位推估"/);
  assert.match(source, /若後續業績進展低於目前主要推估節奏，月底可能接近此較低落點。/);
  assert.match(source, /依目前已回報業績與歷史營運節奏，推算的主要月底落點。/);
  assert.match(source, /若後續業績進展高於目前主要推估節奏，月底可能接近此較高落點。/);
  assert.match(source, /系統會依本月已回報業績、目前進度與歷史營運節奏推估月底可能落點。/);
  assert.match(source, /主畫面保留最需要追蹤的推估數字；這裡補充現金與權責的低位、主要與高位推估，方便主管掌握月底可能落點與變動範圍。/);
  assert.doesNotMatch(source, /方便主管判斷後續衝刺空間/);
  assert.doesNotMatch(source, /title="偏穩"/);
  assert.doesNotMatch(source, /title="衝刺"/);
  assert.doesNotMatch(source, /後續維持穩定服務與成交時/);
});
