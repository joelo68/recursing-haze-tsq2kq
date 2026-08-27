// tests/storeIdentity.test.js
//
// Store Identity regression guard
// --------------------------------
// 這支測試不改任何正式資料，也不需要 Firebase。
// 目的：防止未來有人重構 TargetView / index / SystemMaintenance 時，
// 不小心把 2026-08-18 已建立的 CYJ 新店治理規則移除。
//
// 執行：
//   node --test tests/storeIdentity.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function readProjectFile(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  assert.ok(
    fs.existsSync(fullPath),
    `找不到 ${relativePath}。請從專案根目錄執行：node --test tests/storeIdentity.test.js`
  );
  return fs.readFileSync(fullPath, "utf8");
}

function normalizeSpecCoreStoreName(value = "") {
  let core = String(value || "")
    .trim()
    .replace(/^(DRCYJ|DR\.CYJ|CYJ)\s*/i, "")
    .replace(/[　\s]+/g, "")
    .trim();

  if (core === "新店") return "新店";
  if (/^新店店?$/.test(core)) return "新店";

  return core.replace(/店$/, "").trim();
}

function canonicalSpecStoreName(value = "", brandPrefix = "CYJ") {
  const core = normalizeSpecCoreStoreName(value);
  if (!core) return "";
  if (brandPrefix === "CYJ" && core === "新店") return "CYJ新店店";
  return `${brandPrefix}${core}店`;
}

test("Store Identity 規格：CYJ 新店 aliases 必須歸一成 core=新店", () => {
  const aliases = [
    "新店",
    "CYJ新店",
    "CYJ新店店",
    "DRCYJ新店",
    "DRCYJ新店店",
  ];

  for (const alias of aliases) {
    assert.equal(
      normalizeSpecCoreStoreName(alias),
      "新店",
      `${alias} 應歸一為 coreStoreName=新店`
    );
  }
});

test("Store Identity 規格：CYJ 新店 canonical 必須固定為 CYJ新店店", () => {
  const aliases = [
    "新店",
    "CYJ新店",
    "CYJ新店店",
    "DRCYJ新店",
    "DRCYJ新店店",
  ];

  for (const alias of aliases) {
    assert.equal(
      canonicalSpecStoreName(alias, "CYJ"),
      "CYJ新店店",
      `${alias} 的 canonicalStoreName 應為 CYJ新店店`
    );
  }
});

test("TargetView：必須保留 legacy read fallback + canonical write guard", () => {
  const source = readProjectFile("src/components/TargetView.jsx");

  assert.match(source, /const\s+resolveTargetBudgetReadKey\s*=/);
  assert.match(source, /const\s+getCanonicalTargetBudgetKey\s*=/);
  assert.match(source, /const\s+getCanonicalTargetStoreName\s*=/);

  assert.match(
    source,
    /brandPrefix\s*===\s*["']CYJ["'][\s\S]{0,120}core\s*===\s*["']新店["'][\s\S]{0,120}return\s+["']CYJ新店店["']/,
    "TargetView 必須把 CYJ + core 新店寫成 CYJ新店店"
  );

  assert.doesNotMatch(
    source,
    /\bresolveTargetBudgetKey\s*\(/,
    "舊版 read/write 共用 resolveTargetBudgetKey 不可重新出現"
  );

  assert.match(
    source,
    /const\s+writeKey\s*=\s*getCanonicalTargetBudgetKey\(/,
    "寫入 monthly_targets 必須使用 canonical writeKey"
  );

  assert.match(
    source,
    /sourceId:\s*writeKey/,
    "recalc_queue.sourceId 必須使用 canonical writeKey"
  );

  assert.match(
    source,
    /storeName:\s*canonicalStoreName/,
    "recalc_queue.storeName 必須使用 canonicalStoreName"
  );
});

test("Backend：target resolver 必須保留有效非 0 優先防呆", () => {
  const source = readProjectFile("functions/index.js");

  assert.match(source, /function\s+isAutoTargetEffective\s*\(/);
  assert.match(source, /function\s+choosePreferredAutoTarget\s*\(/);
});

test("Backend：monthly_aggregated 必須保留 CYJ 新店 canonical guard", () => {
  const source = readProjectFile("functions/index.js");

  assert.match(
    source,
    /function\s+getMonthlyAggregationCanonicalStoreName\s*\(/
  );

  assert.match(
    source,
    /normalizeSummaryCoreName\(raw\)\s*===\s*["']新店["']\s*\?\s*["']CYJ新店店["']\s*:\s*raw/,
    "monthly_aggregated writer 必須把 CYJ 新店統一寫成 CYJ新店店"
  );

  assert.match(
    source,
    /getMonthlyAggregationCanonicalStoreName\(rawStoreName,\s*basePath\)/,
    "即時 aggregate trigger 必須使用 canonical guard"
  );
});

test("SystemMaintenance：Core Consistency Audit 必須保留且正式版不可含一次性修復工具", () => {
  const source = readProjectFile("src/components/SystemMaintenance.jsx");

  assert.match(source, /核心資料一致性健檢/);
  assert.match(source, /執行全年健檢/);
  assert.match(source, /V1 僅檢查，不修改任何資料/);

  assert.doesNotMatch(
    source,
    /CYJ 新店歷史命名安全修復/,
    "一次性 CYJ 新店修復工具不應長期存在正式 UI"
  );

  assert.doesNotMatch(
    source,
    /handleExecuteCyjNewStoreRepair/,
    "一次性 CYJ 新店修復 handler 不應長期存在正式版"
  );
});

test("治理文件必須存在並明確禁止 page-level workaround", () => {
  const candidatePaths = ["docs/DATA_IDENTITY_RULES.md", "DATA_IDENTITY_RULES.md"];
  const relativePath = candidatePaths.find((candidate) => fs.existsSync(path.join(projectRoot, candidate)));
  assert.ok(relativePath, "找不到 DATA_IDENTITY_RULES.md（docs/ 或專案根目錄）");
  const source = readProjectFile(relativePath);

  assert.match(source, /Store Identity 是資料層規則，不是頁面顯示 workaround/);
  assert.match(source, /禁止一開始就修改出問題的頁面/);
  assert.match(source, /CYJ新店店/);
});
