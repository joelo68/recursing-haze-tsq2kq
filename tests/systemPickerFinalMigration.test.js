// tests/systemPickerFinalMigration.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const walk = (dir) => {
  const rows = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "build", "coverage", ".git", ".vite"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...walk(full));
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) rows.push(full);
  }
  return rows;
};

test("StoreLifecycleManager uses shared month/date pickers and preserves blank draft semantics", () => {
  const source = read("src/components/StoreLifecycleManager.jsx");
  assert.match(source, /import SmartMonthPicker from "\.\/SmartMonthPicker"/);
  assert.match(source, /import SmartDatePicker from "\.\/SmartDatePicker"/);
  assert.doesNotMatch(source, /type="month"/);
  assert.doesNotMatch(source, /type="date"/);
  for (const token of ["firstEligibleMonth", "openDate", "lastEligibleMonth", "closeDate", "exemptMonthInput"]) {
    assert.match(source, new RegExp(token));
  }
});

test("SystemMaintenance has no browser-native date/month picker left", () => {
  const source = read("src/components/SystemMaintenance.jsx");
  assert.match(source, /import SmartMonthPicker from "\.\/SmartMonthPicker"/);
  assert.doesNotMatch(source, /type="month"/);
  assert.doesNotMatch(source, /type="date"/);
  for (const token of ["projectionAccuracyMonth", "projectionHistoryStartMonth", "projectionHistoryEndMonth", "archiveFilterMonth"]) {
    assert.match(source, new RegExp(token));
  }
});

test("SmartMonthPicker supports empty, clearable, and disabled states without displaying a fake current selection", () => {
  const source = read("src/components/SmartMonthPicker.jsx");
  assert.match(source, /allowClear = false/);
  assert.match(source, /disabled = false/);
  assert.match(source, /placeholder = "選擇月份"/);
  assert.match(source, /const selected = parseMonth\(value\);/);
  assert.doesNotMatch(source, /const selected = parseMonth\(value\) \|\| parseMonth\(fallbackKey\)/);
  assert.match(source, /onChange\?\.\(""\)/);
});

test("SmartDatePicker supports optional clear and disabled lifecycle dates", () => {
  const source = read("src/components/SmartDatePicker.jsx");
  assert.match(source, /disabled = false/);
  assert.match(source, /allowClear = false/);
  assert.match(source, /placeholder = "選擇日期"/);
  assert.match(source, /onDateSelect\(""\)/);
});

test("No component keeps browser-native date/month inputs after final migration", () => {
  const offenders = [];
  for (const file of walk(path.join(root, "src", "components"))) {
    const source = fs.readFileSync(file, "utf8");
    if (/type\s*=\s*["'](?:date|month)["']/.test(source)) {
      offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("Native time inputs remain intentionally limited to the two scheduling controls", () => {
  const hits = [];
  for (const file of walk(path.join(root, "src", "components"))) {
    const source = fs.readFileSync(file, "utf8");
    const count = (source.match(/type\s*=\s*["']time["']/g) || []).length;
    for (let i = 0; i < count; i += 1) hits.push(path.relative(root, file));
  }
  assert.deepEqual(
    hits.sort(),
    ["src/components/NotificationManager.jsx", "src/components/TelegramAlertControlCenter.jsx"].sort()
  );
});


test("SmartMonthPicker portal prevents clipping inside overflow-hidden cards", () => {
  const source = read("src/components/SmartMonthPicker.jsx");
  assert.match(source, /import ReactDOM from "react-dom"/);
  assert.match(source, /ReactDOM\.createPortal/);
  assert.match(source, /panelRef/);
  assert.match(source, /window\.addEventListener\("scroll", updatePosition, true\)/);
  assert.match(source, /window\.addEventListener\("resize", updatePosition\)/);
  assert.match(source, /z-\[9999\]/);
  assert.doesNotMatch(source, /md:absolute/);
});

test("SmartMonthPicker desktop popup can flip above and clamps into viewport", () => {
  const source = read("src/components/SmartMonthPicker.jsx");
  assert.match(source, /const enoughBelow/);
  assert.match(source, /const enoughAbove/);
  assert.match(source, /triggerRect\.top - measuredHeight - PANEL_GAP/);
  assert.match(source, /viewportWidth - width - PANEL_MARGIN/);
  assert.match(source, /viewportHeight - measuredHeight - PANEL_MARGIN/);
});
