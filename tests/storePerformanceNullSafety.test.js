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

test("StorePerformanceView keeps Formal projection null as N/A while preserving a real zero", () => {
  assert.match(source, /\{formatKpiMoney\(storeGrandTotal\.projection\)\}/);
  assert.match(source, /\{formatKpiMoney\(storeGrandTotal\.accrualProjection\)\}/);
  assert.doesNotMatch(source, /\{fmtMoney\(storeGrandTotal\.projection\)\}/);
  assert.doesNotMatch(source, /\{fmtMoney\(storeGrandTotal\.accrualProjection\)\}/);
  assert.match(source, /const formatProjectionValue = \(value\) => \{\s*if \(!isFiniteKpi\(value\)\) return "N\/A";\s*return fmtMoney\(value\);/);
});


test("StorePerformanceView keeps excluded-store self-view null-safe and labels the scope", () => {
  assert.match(source, /const storeSelfViewActive = dashboardStats\.storeSelfViewActive === true;/);
  assert.match(source, /const strictKpiPresentation = formalConsumerActive \|\| storeSelfViewActive;/);
  assert.match(source, /自店檢視｜本店目前不納入公司正式營運統計/);
});
