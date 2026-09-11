// tests/systemPickerConsistency.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("AnnualView uses shared SmartMonthPicker for both custom range endpoints", () => {
  const source = read("src/components/AnnualView.jsx");
  assert.match(source, /import SmartMonthPicker from "\.\/SmartMonthPicker"/);
  assert.equal((source.match(/<SmartMonthPicker/g) || []).length, 2);
  assert.doesNotMatch(source, /type="month"/);
  assert.match(source, /minMonth=\{`\$\{selectedYear\}-01`\}/);
  assert.match(source, /maxMonth=\{`\$\{selectedYear\}-12`\}/);
});

test("NotificationManager uses SmartDatePicker for scheduled-report pause date", () => {
  const source = read("src/components/NotificationManager.jsx");
  assert.match(source, /import SmartDatePicker from "\.\/SmartDatePicker"/);
  assert.match(source, /selectedDate=\{currentRule\.pausedUntil \|\| ""\}/);
  assert.doesNotMatch(source, /type="date"/);
});

test("TelegramAlertControlCenter uses SmartDatePicker for all date-only controls", () => {
  const source = read("src/components/TelegramAlertControlCenter.jsx");
  assert.match(source, /import SmartDatePicker from "\.\/SmartDatePicker"/);
  assert.match(source, /selectedDate=\{form\.pausedUntil \|\| ""\}/);
  assert.match(source, /selectedDate=\{policyEditor\.effectiveUntil \|\| ""\}/);
  assert.doesNotMatch(source, /type="date"/);
});

test("Shared SmartMonthPicker has no data access, listeners, polling, or native month input", () => {
  const source = read("src/components/SmartMonthPicker.jsx");
  assert.match(source, /const SmartMonthPicker =/);
  assert.match(source, /回到本月/);
  assert.doesNotMatch(source, /type="month"/);
  assert.doesNotMatch(source, /\bgetDoc\s*\(/);
  assert.doesNotMatch(source, /\bsetDoc\s*\(/);
  assert.doesNotMatch(source, /\bonSnapshot\s*\(/);
  assert.doesNotMatch(source, /\bsetInterval\s*\(/);
});
