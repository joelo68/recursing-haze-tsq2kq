import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("5D-2 shares one view-scoped Store Lifecycle master listener and adds no polling/per-store query", () => {
  const app = read("src/App.jsx");
  assert.match(app, /OPERATIONAL_FORMAL_LIFECYCLE_VIEWS = new Set\(\["dashboard", "regional", "ranking", "daily", "audit", "store-analysis"\]\)/);
  assert.match(app, /doc\(getCollectionPath\("store_lifecycle"\), "master"\)/);
  assert.match(app, /store_lifecycle_master_operational/);
  assert.match(app, /shouldKeepCurrentLifecycleMasterLive/);
  assert.doesNotMatch(app, /query\(\s*getCollectionPath\("store_lifecycle"\)/);
  assert.doesNotMatch(app, /setInterval\([\s\S]{0,200}store_lifecycle/);
});

test("Dashboard current/detail uses canonical Formal authority, disables raw target fallback, and distinguishes data vs target incompleteness", () => {
  const hook = read("src/hooks/useDashboardStats.js");
  const header = read("src/components/DashboardHeader.jsx");
  const view = read("src/components/DashboardView.jsx");
  assert.match(hook, /buildCurrentDetailFormalAuthority/);
  assert.match(hook, /buildCurrentDetailFormalScope/);
  assert.doesNotMatch(hook, /Dashboard 月目標精準 raw fallback/);
  assert.doesNotMatch(hook, /getCollectionPath\("monthly_targets"\)/);
  assert.doesNotMatch(hook, /dashboardTargetRawFallbacks/);
  assert.match(hook, /formalConsumerActive:\s*true/);
  assert.match(hook, /formalKpiStatus:/);
  assert.match(header, /現金實績資料不足/);
  assert.match(header, /現金目標資料不足/);
  assert.match(header, /權責實績資料不足/);
  assert.match(header, /權責目標資料不足/);
  assert.match(view, /dashboardKpiStatus=\{dashboardStats\?\.formalKpiStatus \|\| \{\}\}/);
  assert.doesNotMatch(hook, /\(Number\(report\.cash\) \|\| 0\)\s*-\s*\(Number\(report\.refund\) \|\| 0\)/);
});

test("Regional and Ranking current/detail consume shared Formal authority without legacy cash-minus-refund or denominator fallback", () => {
  const regional = read("src/components/RegionalView.jsx");
  const ranking = read("src/components/RankingView.jsx");
  assert.match(regional, /buildCurrentDetailFormalAuthority/);
  assert.match(regional, /buildCurrentDetailFormalScope/);
  assert.doesNotMatch(regional, /\(Number\(r\.cash\) \|\| 0\)\s*-\s*\(Number\(r\.refund\) \|\| 0\)/);
  assert.match(ranking, /buildCurrentDetailFormalAuthority/);
  assert.match(ranking, /formalCashAchievementRank/);
  assert.match(ranking, /formalRankEligible/);
  assert.doesNotMatch(ranking, /cashTotal\s*-\s*store\.refundTotal/);
});

test("Daily and Audit use Lifecycle expected-date authority and report document presence", () => {
  const daily = read("src/components/DailyView.jsx");
  const audit = read("src/components/AuditView.jsx");
  assert.match(daily, /aggregateFormalMetrics/);
  assert.match(daily, /isLifecycleEntryExpectedForDate/);
  assert.match(daily, /isReported:\s*false/);
  assert.match(daily, /storeDataMap\[core\]\.reports\.push\(report\)/);
  assert.match(daily, /isLifecycleMasterLoading/);
  assert.doesNotMatch(daily, /\(Number\(report\.cash\) \|\| 0\)\s*-\s*\(Number\(report\.refund\) \|\| 0\)/);

  assert.match(audit, /getLifecycleEligibleStoreEntries/);
  assert.match(audit, /isLifecycleEntryExpectedForDate\(store\.lifecycleEntry, dateStr\)/);
  assert.match(audit, /submittedStoreSet/);
  assert.match(audit, /cleanStoreName\(row\?\.storeName \|\| row\?\.store \|\| ""\)/);
  assert.doesNotMatch(audit, /sub\.includes\(id\)/);
  assert.match(audit, /Store Lifecycle 尚未就緒，店家日報暫不判定漏報/);
});

test("5D-2 does not change Firestore Rules or application version contract", () => {
  const rules = read("firestore.rules");
  const app = read("src/App.jsx");
  assert.match(rules, /store_lifecycle/);
  assert.match(rules, /allow read/);
  assert.match(rules, /allow write:\s*if false/);
  assert.match(app, /3\.5\.3/);
});

test("runtime stabilization Audit delegates store identity to shared Lifecycle authority", () => {
  const audit = read("src/components/AuditView.jsx");
  assert.match(audit, /normalizeStoreLifecycleCore/);
  assert.match(audit, /\(name\)\s*=>\s*normalizeStoreLifecycleCore\(name\)/);
  assert.doesNotMatch(
    audit,
    /const cleanStoreName[\s\S]{0,350}\.replace\(\/店\$\/i/
  );
});

test("runtime stabilization Dashboard separates reporting completeness from observed actual value", () => {
  const header = read("src/components/DashboardHeader.jsx");
  assert.match(header, /dashboardKpiStatus\?\.reportingStatus/);
  assert.match(header, /回報尚未完整（目前顯示已回報累計）/);
});
