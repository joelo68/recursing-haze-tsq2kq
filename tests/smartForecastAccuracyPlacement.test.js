// tests/smartForecastAccuracyPlacement.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("推估準確度屬於智慧推估，不再出現在系統維護", () => {
  const view = read("src/components/SmartForecastView.jsx");
  const panel = read("src/components/SmartForecastAccuracyPanel.jsx");
  const maintenance = read("src/components/SystemMaintenance.jsx");

  assert.match(view, /import SmartForecastAccuracyPanel from "\.\/SmartForecastAccuracyPanel"/);
  assert.match(view, /<SmartForecastAccuracyPanel/);
  assert.match(panel, />推估準確度<\/h2>/);
  assert.doesNotMatch(maintenance, /title="業績推估準確度"/);
  assert.doesNotMatch(maintenance, /projection_accuracy_history/);

  const methodIndex = view.indexOf(">推估方式</h2>");
  const accuracyIndex = view.indexOf("<SmartForecastAccuracyPanel");
  const eventIndex = view.indexOf(">本月活動</h2>");
  assert.ok(methodIndex >= 0);
  assert.ok(accuracyIndex > methodIndex);
  assert.ok(eventIndex > accuracyIndex);
});

test("智慧推估準確度只做小範圍單文件讀取，不新增常駐監聽或掃描", () => {
  const panel = read("src/components/SmartForecastAccuracyPanel.jsx");

  assert.match(
    panel,
    /getDoc\(doc\(getCollectionPath\("projection_accuracy"\), selectedMonth\)\)/
  );
  assert.match(
    panel,
    /getDoc\(doc\(getCollectionPath\("projection_accuracy_history"\), year\)\)/
  );
  assert.doesNotMatch(panel, /\bgetDocs\s*\(/);
  assert.doesNotMatch(panel, /\bonSnapshot\s*\(/);
  assert.doesNotMatch(panel, /\bsetInterval\s*\(/);
  assert.doesNotMatch(panel, /\bsetDoc\s*\(/);
  assert.doesNotMatch(panel, /\baddDoc\s*\(/);
  assert.doesNotMatch(panel, /\bupdateDoc\s*\(/);
});

test("歷史準確度只對核准的智慧校正品牌讀取年度資料", () => {
  const panel = read("src/components/SmartForecastAccuracyPanel.jsx");

  assert.match(
    panel,
    /import \{ PROJECTION_V2_BRANDS \} from "\.\.\/utils\/projectionModelConsumer\.js"/
  );
  assert.match(
    panel,
    /const canUseRollingHistory = PROJECTION_V2_BRANDS\.includes\(normalizedBrandId\)/
  );
  assert.match(
    panel,
    /if \(!canUseRollingHistory \|\| typeof getCollectionPath !== "function"\) return/
  );
  assert.match(
    panel,
    /nextOpen && canUseRollingHistory && historyState\.status === "idle"/
  );
  assert.match(
    panel,
    /目前品牌使用標準推估，因此暫不提供歷史方式比較/
  );
});

test("智慧推估準確度主要文案維持一般管理者可理解語言", () => {
  const panel = read("src/components/SmartForecastAccuracyPanel.jsx");
  for (const forbidden of [
    "WAPE",
    "Bias",
    "residual",
    "regime",
    "shrinkage",
    "feature engineering",
    "ensemble",
    "drift detection",
    "training loss",
  ]) {
    assert.equal(panel.includes(forbidden), false, `unexpected UI engineering term: ${forbidden}`);
  }

  assert.match(panel, /用已完成月份的正式結果確認推估是否穩定/);
  assert.match(panel, /已累積觀察時間點/);
  assert.match(panel, /查看歷史表現/);
  assert.match(panel, /各日期比較/);
});
