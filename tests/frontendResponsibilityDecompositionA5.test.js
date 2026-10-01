import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const appSource = read("src/App.jsx");
const annualAuthoritySource = read("src/hooks/useAnnualDataAuthority.js");
const annualViewSource = read("src/components/AnnualView.jsx");

const countCalls = (source, name) => (
  source.match(new RegExp(`\\b${name}\\s*\\(`, "g")) || []
).length;

test("FRD-A5 makes useAnnualDataAuthority the sole App-level Annual I/O owner", () => {
  assert.match(appSource, /import \{ useAnnualDataAuthority \} from "\.\/hooks\/useAnnualDataAuthority";/);
  assert.match(appSource, /const \{[\s\S]*annualAggregatedData[\s\S]*therapistAnnualAggregatedData[\s\S]*\} = useAnnualDataAuthority\(\{/);
  assert.doesNotMatch(appSource, /const \[annualAggregatedData, setAnnualAggregatedData\] = useState/);
  assert.doesNotMatch(appSource, /const shouldLoadAnnualData = ANNUAL_DATA_VIEWS\.has\(activeView\)/);
  assert.doesNotMatch(appSource, /resolveAnnualReadPlan/);
  assert.doesNotMatch(appSource, /isAnnualPreSystemMonth/);
});

test("FRD-A5 preserves the exact three-effect Annual activation and session gates", () => {
  const gateCount = (
    annualAuthoritySource.match(
      /const shouldLoadAnnualData = ANNUAL_DATA_VIEWS\.has\(activeView\);\s+if \(!hasVerifiedApplicationSession\) \{/g
    ) || []
  ).length;
  assert.equal(gateCount, 3);
  assert.equal((annualAuthoritySource.match(/if \(isLowPowerMode \|\| !shouldLoadAnnualData\) return undefined;/g) || []).length, 3);
  assert.match(appSource, /useAnnualDataAuthority\(\{[\s\S]*hasVerifiedApplicationSession[\s\S]*currentBrand[\s\S]*selectedYear[\s\S]*activeView[\s\S]*isLowPowerMode/);
});

test("FRD-A5 is read-topology neutral", () => {
  assert.equal(countCalls(annualAuthoritySource, "onSnapshot"), 3);
  assert.equal(countCalls(annualAuthoritySource, "getDocs"), 1);
  assert.equal(countCalls(annualAuthoritySource, "query"), 4);
  assert.equal(countCalls(annualAuthoritySource, "where"), 6);
  assert.equal(countCalls(annualAuthoritySource, "setInterval"), 0);

  for (const collectionName of [
    "dashboard_summary",
    "summary_recalc_flags",
    "monthly_targets_summary",
    "monthly_aggregated",
  ]) {
    assert.match(annualAuthoritySource, new RegExp(`getCollectionPath\\("${collectionName}"\\)`));
  }

  for (const label of [
    "dashboard_summary_year_for_annual",
    "summary_recalc_flags_year_for_annual",
    "monthly_targets_summary_year_for_annual",
    "monthly_aggregated_fallback_months",
  ]) {
    assert.match(annualAuthoritySource, new RegExp(label));
  }
});

test("FRD-A5 preserves brand/year isolation and Formal fallback trust inputs", () => {
  assert.match(annualAuthoritySource, /String\(currentBrand\?\.id \|\| ""\)\.toLowerCase\(\)/);
  assert.match(annualAuthoritySource, /const targetYear = String\(selectedYear\)/);
  assert.match(annualAuthoritySource, /where\(documentId\(\), ">=", yearStartId\)/);
  assert.match(annualAuthoritySource, /where\(documentId\(\), "<=", yearEndId\)/);
  assert.match(annualAuthoritySource, /filter\(\(yearMonth\) => !isAnnualPreSystemMonth\(annualBrandId, yearMonth\)\)/);
  assert.match(annualAuthoritySource, /resolveAnnualReadPlan\(\{[\s\S]*systemExclusionState[\s\S]*currentLifecycleMasterState/);
  assert.doesNotMatch(annualAuthoritySource, /artifacts\//);
  assert.doesNotMatch(annualAuthoritySource, /brands\//);
  assert.doesNotMatch(annualAuthoritySource, /default-app-id/);
});

test("FRD-A5 keeps AnnualView precise monthly_targets fallback outside the extracted authority", () => {
  assert.match(annualViewSource, /getDoc/);
  assert.match(annualViewSource, /const targetCollection = getCollectionPath\("monthly_targets"\)/);
  assert.match(annualViewSource, /getDoc\(doc\(targetCollection, targetId\)\)/);
  assert.doesNotMatch(annualAuthoritySource, /getCollectionPath\("monthly_targets"\)/);
});

test("FRD-A5 keeps AppContext Annual publication contract and version unchanged", () => {
  for (const name of [
    "annualAggregatedData",
    "annualDashboardSummaries",
    "annualSummaryStatusMap",
    "annualSummaryLoadState",
    "annualMonthlyTargetSummaries",
    "annualTargetSummaryLoadState",
    "annualAggregateLoadState",
    "therapistAnnualAggregatedData",
  ]) {
    assert.match(appSource, new RegExp(`\\b${name}\\b`));
  }
  assert.match(appSource, /const CURRENT_APP_VERSION = "3\.6\.0";/);
});
