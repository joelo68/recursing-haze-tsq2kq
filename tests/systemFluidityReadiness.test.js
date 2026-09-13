import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const appSource = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const annualSource = fs.readFileSync(path.join(root, "src/components/AnnualView.jsx"), "utf8");

test("B1C2E-UX1 keeps Annual trusted snapshots across view switches while unsubscribing Annual queries", () => {
  assert.match(
    appSource,
    /B1C2E-UX1：離開年度分析只解除年度 Query，不清掉已通過 trust gate 的 session snapshot/
  );
  assert.match(
    appSource,
    /if \(isLowPowerMode \|\| !shouldLoadAnnualData\) return undefined;/
  );
  assert.match(
    appSource,
    /hasPublishedAnnualSnapshot/
  );
});

test("B1C2E-UX1 loads monthly target summaries once per brand-year instead of per filter range", () => {
  assert.match(appSource, /annualMonthlyTargetSummaries/);
  assert.match(appSource, /annualTargetSummaryLoadState/);
  assert.match(appSource, /monthly_targets_summary_year_for_annual/);
  assert.match(
    appSource,
    /where\(documentId\(\), "in", annualTargetMonthKeys\)/
  );

  assert.doesNotMatch(
    annualSource,
    /setAnnualTargetSummariesLoaded\(false\)/
  );
  assert.doesNotMatch(
    annualSource,
    /loadAnnualMonthlyTargetSummaries/
  );
});

test("B1C2E-UX1 quarter and month filters stay local after brand-year target readiness", () => {
  assert.match(
    annualSource,
    /annualTargetSummaryLoadState\?\.brandId === annualBrandId/
  );
  assert.match(
    annualSource,
    /String\(annualTargetSummaryLoadState\?\.year \|\| ""\) === String\(selectedYear\)/
  );
  assert.match(
    annualSource,
    /const annualPresentationReady = annualSummaryTrustReady && annualTargetSummariesLoaded/
  );

  const targetReadinessBlock = annualSource.match(
    /const annualTargetSummariesLoaded = Boolean\([\s\S]*?\n  \);/
  )?.[0] || "";

  assert.doesNotMatch(targetReadinessBlock, /startMonthStr/);
  assert.doesNotMatch(targetReadinessBlock, /endMonthStr/);
});


test("B1C2E-UX1.1 tracks Annual aggregate fallback readiness instead of treating empty data as loaded", () => {
  assert.match(appSource, /annualAggregateLoadState/);
  assert.match(appSource, /fallbackYearMonths/);
  assert.match(appSource, /hasPublishedAggregateSnapshot/);
  assert.match(appSource, /monthly_aggregated fallback load failed/);
  assert.match(annualSource, /selectedRangeActualReady/);
  assert.match(annualSource, /annualAggregateScopeKnown/);
  assert.match(annualSource, /annualAggregateFallbackMonthSet/);
});

test("B1C2E-UX1.1 preserves Annual aggregate snapshot across view switches", () => {
  const aggregateEffect = appSource.match(
    /B1C2E-UX1\.1：離開 Annual[\s\S]*?\n  \}, \[[\s\S]*?currentLifecycleMasterState,[\s\S]*?\n  \]\);/
  )?.[0] || "";

  assert.match(aggregateEffect, /if \(isLowPowerMode \|\| !shouldLoadAnnualData\) return undefined;/);
  assert.doesNotMatch(
    aggregateEffect,
    /if \(!user \|\| isLowPowerMode \|\| !shouldLoadAnnualData\)[\s\S]*?setAnnualAggregatedData\(\[\]\)/
  );
});

test("B1C2E-UX1.1 renders Annual shell progressively and masks pending actuals as syncing", () => {
  assert.doesNotMatch(
    annualSource,
    /if \(!annualPresentationReady\) \{[\s\S]*?return \([\s\S]*?正在整理年度分析資料/
  );
  assert.match(annualSource, /年度資料同步中，畫面會自動補齊/);
  assert.match(annualSource, /if \(pending\) return "同步中";/);
  assert.match(annualSource, /intervalActualPending/);
  assert.match(annualSource, /isMonthActualPending/);
});

test("B1C2E-UX1.1 precise target fallback is brand-year scoped and no longer follows Q filters", () => {
  const fallbackEffect = annualSource.match(
    /const loadMissingTargetFallbacks = async \(\) => \{[\s\S]*?\n  \}, \[[\s\S]*?resolveAnnualLifecycleScopeForMonth,[\s\S]*?\n  \]\);/
  )?.[0] || "";

  assert.match(
    fallbackEffect,
    /getMonthKeysInRange\(`\$\{selectedYear\}-01`, `\$\{selectedYear\}-12`\)/
  );
  assert.doesNotMatch(fallbackEffect, /startMonthStr/);
  assert.doesNotMatch(fallbackEffect, /endMonthStr/);
  assert.match(fallbackEffect, /setAnnualTargetFallbackLoadState/);
});
