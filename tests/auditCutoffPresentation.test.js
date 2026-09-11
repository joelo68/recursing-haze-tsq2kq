// tests/auditCutoffPresentation.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("回報檢核 18:00 前使用中性『今日回報中』狀態，不誤顯示全數完成", () => {
  const source = read("src/components/AuditView.jsx");

  assert.match(source, /phase:\s*"in_progress"/);
  assert.match(source, /今日回報中/);
  assert.match(source, /18:00 後顯示今日回報完成狀態/);
  assert.match(source, /已全數回報/);
  assert.match(source, /尚有店家未回報/);
  assert.match(source, /尚有管理師未回報/);
  assert.match(source, /尚未到回報日期/);

  assert.match(
    source,
    /dailyAuditVisualState\.phase\s*===\s*"ready"[\s\S]{0,500}activeData\.missing\.length\s*===\s*0/,
    "只有已進入正式判定時段才可顯示『已全數回報』"
  );
});

test("回報檢核月曆只隱藏尚未進入判定時段的當日狀態點", () => {
  const audit = read("src/components/AuditView.jsx");
  const picker = read("src/components/SmartDatePicker.jsx");
  const calendar = read("src/components/SmartCalendar.jsx");

  assert.match(audit, /statusHiddenDates=\{dailyAuditVisualState\.statusHiddenDates\}/);
  assert.match(picker, /statusHiddenDates\s*=\s*\[\]/);
  assert.match(picker, /statusHiddenDates=\{statusHiddenDates\}/);
  assert.match(calendar, /statusHiddenDates\s*=\s*\[\]/);
  assert.match(calendar, /statusHiddenDateSet\.has\(dateStr\)\s*\?\s*"none"\s*:\s*getDayStatus\(day\)/);
});

test("18:00 狀態更新沿用既有單次 cutoff timer，不新增 polling / Firestore read", () => {
  const audit = read("src/components/AuditView.jsx");
  const picker = read("src/components/SmartDatePicker.jsx");
  const calendar = read("src/components/SmartCalendar.jsx");

  assert.match(audit, /getMillisecondsUntilNextTaipeiCutoff/);
  assert.match(audit, /window\.setTimeout/);
  assert.doesNotMatch(audit, /setInterval\s*\(/);

  for (const source of [audit, picker, calendar]) {
    assert.doesNotMatch(source, /onSnapshot\s*\(/);
    assert.doesNotMatch(source, /getDocs\s*\(/);
  }
});

test("SmartCalendar 變更為 additive contract，不影響店家排休 multi-select", () => {
  const source = read("src/components/SmartCalendar.jsx");

  assert.match(source, /multiSelect\s*=\s*false/);
  assert.match(source, /selectedDates\s*=\s*\[\]/);
  assert.match(source, /onDateToggle/);
  assert.match(source, /statusHiddenDates\s*=\s*\[\]/);
});

test("CURRENT_APP_VERSION 已提升至 3.6.0", () => {
  const app = read("src/App.jsx");
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
});
