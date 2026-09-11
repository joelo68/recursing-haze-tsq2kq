import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("UI language uses canonical menu labels for activity names", () => {
  const app = read("src/App.jsx");
  assert.match(app, /const VIEW_ACTIVITY_LABELS = Object\.fromEntries\([\s\S]*ALL_MENU_ITEMS\.map/);
  assert.match(
    app,
    /const DIRECTOR_RESTRICTED_VIEW_IDS = \[[\s\S]*const DIRECTOR_RESTRICTED_VIEWS = Object\.fromEntries\([\s\S]*VIEW_ACTIVITY_LABELS\[viewId\]/
  );
  for (const stale of [
    'daily: "每日總覽"',
    'regional: "區域總覽"',
    'ranking: "排行榜"',
    'history: "數據修正中心"',
    'notification: "通知管理"',
  ]) {
    assert.equal(app.includes(stale), false, `App still contains stale activity label: ${stale}`);
  }
});

test("reviewed high-priority engineering wording is removed from operational UI", () => {
  const checks = [
    ["src/components/DashboardHeader.jsx", ["已整理 Summary", "Dashboard 資料來源狀態", ">Dashboard</p>"]],
    ["src/components/AuditView.jsx", ["Store Lifecycle 尚未就緒", "Lifecycle 尚未就緒"]],
    ["src/components/ReportingCalendarManager.jsx", ["Calendar Revision", "Lifecycle Master / Reporting Calendar authority", "沿用系統既有 SmartCalendar"]],
    ["src/components/SettingsView.jsx", ["SYSTEM SETTINGS"]],
    ["src/components/HistoryView.jsx", ["數據查詢待命區"]],
    ["src/components/StoreAnalysisView.jsx", ["Regional Five-Force Analysis", "Five-Force Store Analysis"]],
    ["src/components/TherapistManagerView.jsx", ["登入帳號 / 文件 ID"]],
  ];
  for (const [file, phrases] of checks) {
    const source = read(file);
    for (const phrase of phrases) {
      assert.equal(source.includes(phrase), false, `${file} still exposes reviewed phrase: ${phrase}`);
    }
  }
});

test("lifecycle and reporting calendar use plain operational copy", () => {
  const lifecycle = read("src/components/StoreLifecycleManager.jsx");
  const calendar = read("src/components/ReportingCalendarManager.jsx");
  assert.match(lifecycle, /門市營運期間管理/);
  assert.match(lifecycle, /資料版本/);
  assert.match(calendar, /歷史月報自動重整/);
  assert.match(calendar, /正式休店設定/);
});

test("final operational copy hides residual engineering jargon without changing contracts", () => {
  const dashboard = read("src/hooks/useDashboardStats.js");
  assert.match(dashboard, /已確認月報資料/);
  for (const stale of ["已整理 Summary", "Summary 狀態未知", "本月 Dashboard 以即時明細為準。"]) {
    assert.equal(dashboard.includes(stale), false, `dashboard still exposes: ${stale}`);
  }

  const calendar = read("src/components/ReportingCalendarManager.jsx");
  assert.equal(calendar.includes("尚未建立完整 Lifecycle"), false);

  const settings = read("src/components/SettingsView.jsx");
  assert.match(settings, /門市營運期間/);
  assert.equal(settings.includes("既有 Firestore legacy 欄位"), false);

  const lifecycle = read("src/components/StoreLifecycleManager.jsx");
  assert.match(lifecycle, /門市營運期間設定/);
  for (const stale of ["確認批次初始化門市生命週期", "Store Key：", "本 SaaS KPI", "每間仍使用既有 Backend transaction", "READY 只代表 Lifecycle Master"]) {
    assert.equal(lifecycle.includes(stale), false, `lifecycle still exposes: ${stale}`);
  }

  const schedule = read("src/components/StoreScheduleView.jsx");
  assert.equal(schedule.includes("（Lifecycle 未完成）"), false);
  assert.equal(schedule.includes("Reporting Calendar 的店家休店 authority"), false);

  const login = read("src/components/LoginView.jsx");
  assert.match(login, /最高管理金鑰/);
  for (const stale of ["請使用 Master Key 管理帳號", "最高管理員(Master Key)", "僅 Master Key 可", "舊密碼 或 Master Key", "密碼 (或 Master Key)"]) {
    assert.equal(login.includes(stale), false, `login still exposes: ${stale}`);
  }

  const telegram = read("src/components/TelegramAlertControlCenter.jsx");
  for (const stale of ["master／director 可以", "Chat ID", "全品牌 Security 設定", "Backend 會重新確認"]) {
    assert.equal(telegram.includes(stale), false, `telegram still exposes: ${stale}`);
  }

  const maintenance = read("src/components/SystemMaintenance.jsx");
  for (const stale of ["Summary 前置", "筆 pending", "Dashboard Summary 重建完成", "V2 啟用門檻", "現金 Phase", "權責 Phase", "唯讀 Audit", " docs｜"]) {
    assert.equal(maintenance.includes(stale), false, `maintenance still exposes: ${stale}`);
  }
  assert.match(maintenance, /歷史月報重新整理完成/);
  assert.match(maintenance, /智慧校正啟用條件/);
});

test("TherapistPerformance wording exception stays byte-identical", () => {
  const rel = "src/components/TherapistPerformanceView.jsx";
  const hash = execFileSync("git", ["hash-object", rel], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(hash, "2f267259cdfb34464b3d09e8662c0f12d354fc1a");
  const source = read(rel);
  assert.match(source, /Top 5/);
  assert.match(source, /\bME\b/);
  assert.match(source, /\bvs\b/);
});

test("semantic implementation is promoted with app version 3.6.0", () => {
  const app = read("src/App.jsx");
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.doesNotMatch(app, /CURRENT_APP_VERSION\s*=\s*"3\.5\.3"/);
});
