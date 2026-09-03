import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (url) => fs.readFileSync(new URL(url, import.meta.url), "utf8");
const storeAnalysisSource = read("../src/components/StoreAnalysisView.jsx");
const storeHealthSource = read("../src/utils/storeHealth.js");
const appSource = read("../src/App.jsx");

test("Store Analysis target presentation follows Coverage-aware canonical authority and removes stale target fallbacks", () => {
  assert.match(storeAnalysisSource, /buildStoreAnalysisTargetPresentationAuthority/);
  assert.match(storeAnalysisSource, /resolveStoreAnalysisCashTargetPresentation/);
  assert.match(storeAnalysisSource, /resolveStoreAnalysisCashTargetScopePresentation/);
  assert.doesNotMatch(storeAnalysisSource, /findTargetByStore/);
  assert.doesNotMatch(storeAnalysisSource, /getDoc\(doc\(getCollectionPath\("monthly_targets"\)/);
  assert.doesNotMatch(storeAnalysisSource, /StoreAnalysis Target Fallback/);
  assert.doesNotMatch(storeAnalysisSource, /resolveStoreBudget/);
});

test("Store Analysis current-detail Formal authority includes shared Lifecycle and System Exclusion authority", () => {
  assert.match(storeAnalysisSource, /buildCurrentDetailFormalAuthority/);
  assert.match(storeAnalysisSource, /buildCurrentDetailFormalScope/);
  assert.match(storeAnalysisSource, /currentLifecycleMasterState\?\.data/);
  assert.match(storeAnalysisSource, /systemExclusionState,/);
  assert.match(appSource, /OPERATIONAL_FORMAL_LIFECYCLE_VIEWS = new Set\(\[[^\]]*"store-analysis"[^\]]*\]\)/);
});

test("Store Analysis uses pure Store Health owner and removes page-local zero coercion and hardcoded benchmark authority", () => {
  assert.match(storeAnalysisSource, /buildStoreHealthMetrics/);
  assert.match(storeAnalysisSource, /resolveStoreHealthBenchmarkProfile/);
  assert.doesNotMatch(storeAnalysisSource, /DEFAULT_BENCHMARKS/);
  assert.doesNotMatch(storeAnalysisSource, /Math\.max\(0,\s*traffic\s*-\s*newCust/);
  assert.doesNotMatch(storeAnalysisSource, /Math\.max\(0,\s*cash\s*-\s*newSales/);
  assert.doesNotMatch(storeAnalysisSource, /Number\(targets\?\.newASP\)/);
  assert.doesNotMatch(storeAnalysisSource, /cashToAccrual:\s*accrual\s*>\s*0\s*\?/);
  assert.doesNotMatch(storeAnalysisSource, /retention:\s*traffic\s*>\s*0\s*\?/);
  assert.doesNotMatch(storeAnalysisSource, /const\s+normalize\s*=\s*\(/);
});

test("Store Health helper is pure and owns exact-brand benchmark resolution", () => {
  assert.doesNotMatch(storeHealthSource, /firebase\/firestore|onSnapshot\s*\(|getDocs\s*\(|getDoc\s*\(|setInterval\s*\(/);
  assert.match(storeHealthSource, /cyj:\s*"default"/);
  assert.match(storeHealthSource, /anniu:\s*"安妞"/);
  assert.match(storeHealthSource, /yibo:\s*"伊啵"/);
  assert.doesNotMatch(storeHealthSource, /DEFAULT_BENCHMARKS/);
});

test("Store Analysis applies Formal eligible scope to aggregate, benchmark and risk samples", () => {
  assert.match(storeAnalysisSource, /formalEligibleStoreSet/);
  assert.match(storeAnalysisSource, /eligibleStoreKeys/);
  assert.match(storeAnalysisSource, /\.filter\(\(storeKey\) => formalEligibleStoreSet\.has\(storeKey\)\)/);
  assert.match(storeAnalysisSource, /formalEligibleStoreSet\.has\(storeKey\)/);
  assert.match(storeAnalysisSource, /formalEligibleStoreSet\.has\(row\.core\)/);
  assert.match(storeAnalysisSource, /core && formalEligibleStoreSet\.has\(core\) \? `\$\{brandPrefix\}\$\{core\}店` : ""/);
});

test("historical Store Analysis Summary rows carry Store Health input version and field validity metadata", () => {
  assert.match(storeAnalysisSource, /storeHealthInputVersion:\s*String\(store\?\.storeHealthInputVersion/);
  assert.match(storeAnalysisSource, /skincareSalesStatus:\s*String\(store\?\.skincareSalesStatus/);
  assert.match(storeAnalysisSource, /trafficStatus:\s*String\(store\?\.trafficStatus/);
  assert.match(storeAnalysisSource, /newCustomersStatus:\s*String\(store\?\.newCustomersStatus/);
  assert.match(storeAnalysisSource, /newCustomerSalesStatus:\s*String\(store\?\.newCustomerSalesStatus/);
  assert.match(storeAnalysisSource, /source:\s*"dashboard_summary"/);
});

test("Store Analysis keeps nullable Store Health UI fail-closed instead of formatting null as zero", () => {
  assert.match(storeAnalysisSource, /formatHealthPercentOrNA/);
  assert.match(storeAnalysisSource, /formatScoreOrNA/);
  assert.match(storeAnalysisSource, /標準未設定/);
  assert.match(storeAnalysisSource, /資料不足/);
  assert.match(storeAnalysisSource, /exceptionLists\.evaluation\?\.financial\?\.ready \? "財務體質全數健康"/);
  assert.match(storeAnalysisSource, /標準設定無效/);
  assert.doesNotMatch(storeAnalysisSource, /health\.raw\.cashToAccrual\s*\*\s*100\)\.toFixed/);
  assert.doesNotMatch(storeAnalysisSource, /health\.raw\.retention\s*\*\s*100\)\.toFixed/);
});

test("Store Analysis preserves existing selected-store Firestore listener topology and adds no new Store Health listener", () => {
  const snapshotCount = (storeAnalysisSource.match(/onSnapshot\s*\(/g) || []).length;
  assert.equal(snapshotCount, 2);
  assert.match(storeAnalysisSource, /where\("date",\s*">=",\s*selectedYearMonthRange\.startDate\)/);
  assert.match(storeAnalysisSource, /where\("date",\s*"<=",\s*selectedYearMonthRange\.endDate\)/);
  assert.match(storeAnalysisSource, /store_analysis_selected_store_reports_fallback/);
});

test("hotfix keeps application version unchanged", () => {
  assert.match(appSource, /CURRENT_APP_VERSION\s*=\s*"3\.5\.3"/);
});
