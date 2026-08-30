import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const storeAnalysisSource = fs.readFileSync(new URL("../src/components/StoreAnalysisView.jsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("Store Analysis target presentation treats explicit zero as authoritative and removes stale target fallbacks", () => {
  assert.match(storeAnalysisSource, /const readCashTargetPresentation = useCallback/);
  assert.match(storeAnalysisSource, /Number\.isFinite\(value\)\) return \{ found: true, value \}/);
  assert.match(storeAnalysisSource, /findTargetByStore\(monthlyTargetSummary/);
  assert.doesNotMatch(storeAnalysisSource, /getDoc\(doc\(getCollectionPath\("monthly_targets"\)/);
  assert.doesNotMatch(storeAnalysisSource, /StoreAnalysis Target Fallback/);
  assert.doesNotMatch(storeAnalysisSource, /resolveStoreBudget/);
});

test("Store Analysis joins the shared current-detail Formal authority and shared Lifecycle listener", () => {
  assert.match(storeAnalysisSource, /buildCurrentDetailFormalAuthority/);
  assert.match(storeAnalysisSource, /buildCurrentDetailFormalScope/);
  assert.match(storeAnalysisSource, /currentLifecycleMasterState\?\.data/);
  assert.match(appSource, /OPERATIONAL_FORMAL_LIFECYCLE_VIEWS = new Set\(\[[^\]]*"store-analysis"[^\]]*\]\)/);
});

test("Store Analysis Formal cash subtracts both general and skincare refunds", () => {
  assert.match(storeAnalysisSource, /Number\(b\.cash\).*Number\(b\.refund\).*Number\(b\.skincareRefund\)/s);
  assert.match(storeAnalysisSource, /cash: \(Number\(d\.cash\).*Number\(d\.refund\).*Number\(d\.skincareRefund\)/s);
  assert.match(storeAnalysisSource, /storeStats\[dCore\]\.cash \+= .*Number\(d\.refund\).*Number\(d\.skincareRefund\)/);
});

test("Store Analysis target/data incompleteness renders N/A instead of a fabricated achievement", () => {
  assert.match(storeAnalysisSource, /formatAchievementOrNA/);
  assert.match(storeAnalysisSource, /typeof formalScope\.cashAchievement === "number"/);
  assert.doesNotMatch(storeAnalysisSource, /achievement:\s*totalBudget > 0/);
  assert.doesNotMatch(storeAnalysisSource, /achievement\.toFixed\(1\)/);
});

test("Store Analysis no longer restores the deprecated hard-coded newASP fallback", () => {
  assert.doesNotMatch(storeAnalysisSource, /Number\(targets\?\.newASP\) \|\| 3500/);
  assert.match(storeAnalysisSource, /Number\.isFinite\(configuredNewASP\) && configuredNewASP > 0/);
});

test("hotfix keeps application version unchanged", () => {
  assert.match(appSource, /CURRENT_APP_VERSION\s*=\s*"3\.5\.3"/);
});
