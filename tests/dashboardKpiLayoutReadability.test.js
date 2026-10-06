import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const storeView = fs.readFileSync(path.join(root, "src/components/StorePerformanceView.jsx"), "utf8");

test("KPI annual benchmark badge wraps to a safe footer row when a card becomes narrow", () => {
  assert.doesNotMatch(storeView, /absolute bottom-4 right-5 z-30/);
  assert.doesNotMatch(storeView, /pr-28 sm:pr-32/);
  assert.match(storeView, /mt-auto flex min-w-0 flex-wrap items-end justify-between gap-x-2\.5 gap-y-2 border-t border-stone-50 pt-3/);
  assert.match(storeView, /min-w-\[9\.5rem\] flex-1 basis-\[9\.5rem\] text-xs font-medium leading-5 text-stone-500/);
  assert.match(storeView, /relative z-30 ml-auto flex-none/);
  assert.match(storeView, /whitespace-nowrap rounded-xl/);
  assert.match(storeView, /text-\[9px\] font-semibold text-stone-400/);
  assert.match(storeView, /font-mono text-\[11px\] font-extrabold tracking-tight text-stone-500/);
  assert.doesNotMatch(storeView, /font-mono text-xs font-black text-stone-600/);
});

test("average-operation target status uses controlled wrapping instead of a single long sentence", () => {
  assert.match(storeView, /title="平均操作權責"[\s\S]*?flex min-w-0 flex-wrap items-baseline gap-x-1\.5 gap-y-0\.5/);
  assert.match(storeView, /目標 \{fmtNum\(targets\.trafficASP\)\}/);
});

test("new-customer ASP footer separates achievement, target and total sales into readable groups", () => {
  const start = storeView.indexOf('title="新客平均客單"');
  assert.ok(start >= 0, "new customer ASP card missing");
  const block = storeView.slice(start, start + 2600);
  assert.match(block, /flex min-w-0 flex-col gap-0\.5/);
  assert.match(block, /whitespace-nowrap font-bold/);
  assert.match(block, /目標 \{fmtNum\(targets\.newASP\)\}/);
  assert.match(block, /<span className="whitespace-nowrap">總業績<\/span>/);
  assert.match(block, /fmtMoney\(storeGrandTotal\.newCustomerSales\)/);
  assert.doesNotMatch(block, /flex items-center justify-between w-full/);
});

test("six-card desktop layout keeps KPI subtext width instead of shrinking it underneath the annual badge", () => {
  assert.match(storeView, /xl:grid-cols-6/);
  assert.match(storeView, /flex-wrap items-end justify-between/);
  assert.match(storeView, /basis-\[9\.5rem\]/);
  assert.doesNotMatch(storeView, /mt-auto pt-3 border-t border-stone-50 flex min-w-0 items-end justify-between gap-2\.5/);
});
