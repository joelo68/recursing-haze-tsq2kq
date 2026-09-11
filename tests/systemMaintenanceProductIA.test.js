import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("SystemMaintenance 主畫面改成四個問題導向工作入口，流量觀察維持次要入口", () => {
  const source = read("src/components/SystemMaintenance.jsx");

  for (const label of ["檢查本月資料", "整理月份報表", "處理異常資料", "備份或救回資料"]) {
    assert.match(source, new RegExp(`title: "${label}"`));
  }

  assert.match(source, /你現在要做哪一件事？/);
  assert.match(source, /不用先懂系統工具，選最接近你現在情況的一項。/);
  assert.match(source, /你選的是：\{activeCard\.title\}/);
  assert.match(source, /適合什麼時候/);
  assert.match(source, /會幫你做什麼/);
  assert.match(source, /這一步不會做什麼/);
  assert.match(source, /完成後你會看到/);

  assert.match(source, /scenarioCards\.filter\(\(card\) => card\.id !== "traffic"\)/);
  assert.match(source, /title: "系統流量觀察"/);
  assert.match(source, /只有費用異常、改版觀察或需要追查讀取來源時才開啟/);
});

test("SystemMaintenance 移除任務精靈分步導覽，不再重複同一項工作的第二套流程", () => {
  const source = read("src/components/SystemMaintenance.jsx");

  assert.doesNotMatch(source, /wizardStep/);
  assert.doesNotMatch(source, /setWizardStep/);
  assert.doesNotMatch(source, /任務精靈/);
  assert.doesNotMatch(source, /Step \{wizardStep\}/);
  assert.doesNotMatch(source, />下一步</);
  assert.doesNotMatch(source, />上一步</);

  assert.match(source, /const selectScenario = \(scenarioId\) =>/);
  assert.match(source, /setActiveMaintenanceScenario\(scenarioId\)/);
  assert.match(source, /setGuidedFlowReport\(null\)/);
  assert.match(source, /const runActiveTask = \(\) =>/);
});

test("SystemMaintenance 選工作本身不讀寫 Firestore，資料操作仍沿用既有 handler", () => {
  const source = read("src/components/SystemMaintenance.jsx");
  const guideStart = source.indexOf("const renderMaintenanceScenarioGuide = () =>");
  const guideEnd = source.indexOf("// 讀取來源追蹤", guideStart);
  assert.ok(guideStart >= 0 && guideEnd > guideStart);

  const guide = source.slice(guideStart, guideEnd);
  assert.doesNotMatch(guide, /getDocs\(/);
  assert.doesNotMatch(guide, /getDoc\(/);
  assert.doesNotMatch(guide, /setDoc\(/);
  assert.doesNotMatch(guide, /addDoc\(/);
  assert.doesNotMatch(guide, /updateDoc\(/);
  assert.doesNotMatch(guide, /writeBatch\(/);
  assert.doesNotMatch(guide, /onSnapshot\(/);
  assert.doesNotMatch(guide, /setInterval\(/);

  assert.match(guide, /handleRunGuidedFlow\(activeCard\.id\)/);
  assert.match(guide, /handleMonthEndDashboardSummaryCalibration\(\)/);
});

test("SystemMaintenance 技術修復入口退出日常介面但保留正式治理能力", () => {
  const source = read("src/components/SystemMaintenance.jsx");

  assert.doesNotMatch(source, /一鍵補整理年度目標/);
  assert.doesNotMatch(source, /Production：Target Coverage 全現有月份稽核/);
  assert.doesNotMatch(source, /Production：補 Target Coverage Metadata/);
  assert.doesNotMatch(source, /handleRebuildYearlyTargetSummary/);
  assert.doesNotMatch(source, /handleAuditHistoricalTargetCoverage/);
  assert.doesNotMatch(source, /handleMigrateHistoricalTargetCoverageMetadata/);

  assert.match(source, /資料一致性檢查/);
  assert.match(source, /重新整理月份數據/);
  assert.match(source, /等待整理的月份/);
  assert.match(source, /月份報表整理/);
  assert.match(source, /品牌資料備份/);
});

test("SystemMaintenance 本月不自動執行歷史報表狀態查詢", () => {
  const source = read("src/components/SystemMaintenance.jsx");
  const effectStart = source.indexOf("useEffect(() => {\n    if (isSelectedCurrentMonth(calMonth))");
  const effectEnd = source.indexOf("}, [currentBrand?.id, calMonth]);", effectStart);
  assert.ok(effectStart >= 0 && effectEnd > effectStart);

  const effect = source.slice(effectStart, effectEnd);
  assert.match(effect, /setSummaryStatusReport\(null\)/);
  assert.match(effect, /loadDashboardSummaryStatus\(calMonth, true\)/);
  assert.ok(
    effect.indexOf("setSummaryStatusReport(null)") < effect.indexOf("loadDashboardSummaryStatus(calMonth, true)"),
    "current-month fail-fast guard must run before historical status load"
  );
});

test("資料量與讀取來源工具預設收合，且高風險資料處理維持獨立保護區", () => {
  const source = read("src/components/SystemMaintenance.jsx");

  assert.match(source, /const \[showTrafficTools, setShowTrafficTools\] = useState\(false\)/);
  assert.match(source, /\{showTrafficTools && \(/);
  assert.match(source, /title="系統流量來源"/);
  assert.match(source, /資料量概況會讀取多個完整資料集合/);

  assert.match(source, /const \[showAdvancedTools, setShowAdvancedTools\] = useState\(false\)/);
  assert.match(source, /title="高風險資料處理"/);
  assert.match(source, /\{showAdvancedTools &&/);
  assert.match(source, /title="日期資料修正"/);
  assert.match(source, /title="重複資料整理"/);
  assert.match(source, /title="查看與還原封存資料"/);
});
