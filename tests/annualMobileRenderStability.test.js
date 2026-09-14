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
const kpiBlock = annualSource.match(
  /\{\/\* 區塊 1: 區間總 KPI \*\/[\s\S]*?\{\/\* 區塊 2: 趨勢圖表 \*\//
)?.[0] || "";

test("Annual mobile KPI keeps fail-closed readiness semantics", () => {
  assert.match(annualSource, /const displayAnnualMoney = [\s\S]*?if \(pending\) return "同步中";/);
  assert.match(annualSource, /const displayAnnualPercent = [\s\S]*?if \(pending\) return "同步中";/);
  assert.match(annualSource, /const intervalActualPending = !selectedRangeActualReady;/);
  assert.match(annualSource, /const intervalTargetPending = !annualTargetSummariesLoaded \|\| !annualTargetFallbackReady;/);
});

test("Annual critical KPI surface avoids transform-based entrance animation on mobile", () => {
  assert.ok(kpiBlock, "Annual KPI block must be present");
  assert.match(kpiBlock, /data-annual-kpi-render-stable="true"/);
  assert.doesNotMatch(kpiBlock, /animate-in|slide-in-from-bottom-4|delay-100/);
});

test("Annual mobile KPI removes clipped decorative compositor layers from the mobile surface", () => {
  assert.match(kpiBlock, /relative md:overflow-hidden/);
  assert.ok((kpiBlock.match(/hidden md:block absolute top-0 right-0/g) || []).length >= 2);
  assert.ok((kpiBlock.match(/relative md:z-10/g) || []).length >= 2);
  assert.doesNotMatch(kpiBlock, /relative overflow-hidden/);
});

test("Annual mobile progress bars do not animate width on mobile", () => {
  assert.ok((kpiBlock.match(/md:transition-all md:duration-1000/g) || []).length >= 2);
  assert.doesNotMatch(kpiBlock, /rounded-full transition-all duration-1000/);
});

test("Annual ready text uses declarative render identity when readiness or values change", () => {
  assert.match(annualSource, /const intervalCashRenderKey = `cash-\$\{intervalActualPending \? "pending" : "ready"\}-\$\{intervalCashDisplay\}`;/);
  assert.match(annualSource, /const intervalAccrualRenderKey = `accrual-\$\{intervalActualPending \? "pending" : "ready"\}-\$\{intervalAccrualDisplay\}`;/);
  assert.match(kpiBlock, /<h2 key=\{intervalCashRenderKey\}/);
  assert.match(kpiBlock, /<span key=\{intervalCashAchievementRenderKey\}/);
  assert.match(kpiBlock, /<h2 key=\{intervalAccrualRenderKey\}/);
  assert.match(kpiBlock, /<span key=\{intervalAccrualAchievementRenderKey\}/);
});

test("Annual KPI ready text keeps stable nonshrinking labels", () => {
  assert.ok((kpiBlock.match(/shrink-0 whitespace-nowrap/g) || []).length >= 2);
  assert.match(kpiBlock, /tracking-tight mb-4 whitespace-nowrap/);
  assert.match(kpiBlock, /tracking-tight text-stone-700 whitespace-nowrap/);
});

test("Annual mobile render fix does not add forced-repaint JavaScript or Firestore reads", () => {
  assert.doesNotMatch(kpiBlock, /requestAnimationFrame|offsetHeight|getBoundingClientRect|translateZ|willChange/);
  assert.doesNotMatch(kpiBlock, /onSnapshot|getDocs|getDoc\(|collection\(|query\(/);
});

test("Annual mobile render fix does not change the application version", () => {
  assert.match(appSource, /const CURRENT_APP_VERSION = "3\.6\.0";/);
});
