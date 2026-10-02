import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const targetView = fs.readFileSync(new URL("../src/components/TargetView.jsx", import.meta.url), "utf8");

test("Target editor owns monthly_targets Raw state locally instead of App-wide budgets", () => {
  assert.doesNotMatch(app, /const \[budgets, setBudgets\] = useState/);
  assert.doesNotMatch(app, /user, loading, managers:[^\n]*\bbudgets\b/);
  assert.match(targetView, /const \[budgets, setBudgets\] = useState\(\{\}\)/);
});

test("canonical target listener is bounded by selected store and selected year document-id prefix", () => {
  assert.match(targetView, /canonicalTargetPrefix = selectedStore[\s\S]*getCanonicalTargetBudgetKey\(selectedStore, selectedYear, 1\)\.replace\(\/_1\$\/, "_"\)/);
  assert.match(targetView, /const buildPrefixQuery = \(prefix\) => query\([\s\S]*getCollectionPath\("monthly_targets"\)[\s\S]*where\(documentId\(\), ">=", prefix\)[\s\S]*where\(documentId\(\), "<=", `\$\{prefix\}\\uf8ff`\)/);
  assert.match(targetView, /const canonicalQuery = buildPrefixQuery\(canonicalTargetPrefix\)/);
  assert.match(targetView, /onSnapshot\(\s*canonicalQuery,/);
  assert.doesNotMatch(targetView, /onSnapshot\(\s*getCollectionPath\("monthly_targets"\)/);
});

test("CYJ 新店 legacy fallback remains bounded, one-shot, and canonical-first", () => {
  assert.match(targetView, /getLegacyCyjNewStoreBudgetKey/);
  assert.match(targetView, /legacyTargetPrefix = selectedStore[\s\S]*getLegacyCyjNewStoreBudgetKey\(selectedStore, selectedYear, 1\)/);
  assert.match(targetView, /getDocs\(buildPrefixQuery\(legacyTargetPrefix\)\)/);
  assert.match(targetView, /setBudgets\(\{ \.\.\.legacyRows, \.\.\.canonicalRows \}\)/);
  assert.match(targetView, /if \(budgets\?\.\[canonicalKey\]\) return canonicalKey/);
  assert.doesNotMatch(targetView, /onSnapshot\([\s\S]{0,120}legacyTargetPrefix/);
});

test("read optimization keeps visibility, connectivity, low-power and fail-closed edit gates", () => {
  assert.match(targetView, /document\.addEventListener\("visibilitychange", syncVisibility\)/);
  assert.match(targetView, /if \(!isPageVisible \|\| !isOnline \|\| isLowPowerMode\)/);
  assert.match(targetView, /if \(!targetReadReady\) return true/);
  assert.match(targetView, /為避免覆寫已停止儲存/);
  assert.match(targetView, /歷史目標相容資料同步失敗，已停止編輯以避免覆寫/);
});

test("existing read-tracker label remains comparable and legacy fallback gets its own label", () => {
  assert.match(app, /mode === "legacy-fallback"[\s\S]*"monthly_targets_legacy_fallback"[\s\S]*"monthly_targets_live"/);
  assert.match(targetView, /trackTargetEditorRead\?\.\("live", budgetSnap\)/);
  assert.match(targetView, /trackTargetEditorRead\?\.\("legacy-fallback", legacySnap\)/);
});

test("read optimization does not redefine target writer semantics", () => {
  assert.match(targetView, /cashTarget:\s*cashResult\.valid \? cashResult\.value : deleteField\(\)/);
  assert.match(targetView, /accrualTarget:\s*accrualResult\.valid \? accrualResult\.value : deleteField\(\)/);
  assert.match(targetView, /batch\.delete\(doc\(getCollectionPath\("monthly_targets"\), readKey\)\)/);
  assert.match(targetView, /batch\.set\(doc\(getCollectionPath\("recalc_queue"\)\)/);
});
