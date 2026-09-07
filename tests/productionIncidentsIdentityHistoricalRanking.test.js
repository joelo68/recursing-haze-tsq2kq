import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCurrentDetailFormalAuthority } from "../src/utils/currentDetailFormalConsumer.js";
import {
  getCanonicalLifecycleStoreName,
  normalizeStoreLifecycleCore,
} from "../src/utils/storeLifecycle.js";
import { KPI_CONTRACT_VERSION, KPI_VALUE_STATUS } from "../src/utils/kpiContracts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("shared Store Identity is idempotent for CYJ 新店 aliases", () => {
  const aliases = ["新", "新店", "新店店", "CYJ新店", "CYJ新店店", "DRCYJ新店", "DRCYJ新店店"];
  for (const alias of aliases) {
    const core = normalizeStoreLifecycleCore(alias);
    assert.equal(core, "新店", `${alias} should resolve to core 新店`);
    assert.equal(normalizeStoreLifecycleCore(core), core, `${alias} normalization must be idempotent`);
    assert.equal(getCanonicalLifecycleStoreName(alias, "cyj"), "CYJ新店店");
  }
});

test("current/detail Formal authority joins CYJ 新店 raw alias, canonical target and Lifecycle into one store", () => {
  const reports = Array.from({ length: 6 }, (_, index) => ({
    storeName: "CYJ新店",
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    cash: 100,
    refund: 0,
    skincareRefund: 0,
    accrual: 100,
    operationalAccrual: 100,
  }));

  const authority = buildCurrentDetailFormalAuthority({
    brandId: "cyj",
    yearMonth: "2026-09",
    cutoffDate: "2026-09-06",
    lifecycleMaster: {
      schemaVersion: "store-lifecycle-v1",
      brandId: "cyj",
      datasetStatus: "READY",
      stores: {
        新店: {
          storeKey: "新店",
          coreStoreName: "新店",
          canonicalStoreName: "CYJ新店店",
          firstEligibleMonth: "2026-09",
          openDate: "2026-09-01",
          lastEligibleMonth: "",
          closeDate: "",
          exemptMonths: [],
        },
      },
    },
    monthlyTargetSummary: {
      id: "2026-09",
      yearMonth: "2026-09",
      brandId: "cyj",
      targetCoverageVersion: "target-coverage-v1",
      kpiContractVersion: KPI_CONTRACT_VERSION,
      lifecycleReady: true,
      eligibleStoreCount: 1,
      cashConfiguredStoreCount: 1,
      accrualConfiguredStoreCount: 1,
      cashCoverageComplete: true,
      accrualCoverageComplete: true,
      cashMissingStores: [],
      accrualMissingStores: [],
      targets: {
        CYJ新店店: {
          storeName: "CYJ新店店",
          cashTarget: 1000,
          accrualTarget: 1000,
          isCanonicalSource: true,
        },
      },
    },
    reports,
    normalizeStoreKey: normalizeStoreLifecycleCore,
  });

  assert.equal(authority.compatible, true);
  assert.equal(Boolean(authority.stores["新"]), false);
  assert.ok(authority.stores["新店"]);
  assert.equal(authority.stores["新店"].canonicalStoreName, "CYJ新店店");
  assert.equal(authority.stores["新店"].formalNetCash, 600);
  assert.equal(authority.stores["新店"].formalNetCashStatus, KPI_VALUE_STATUS.VALID);
  assert.equal(authority.stores["新店"].cashTarget, 1000);
  assert.equal(authority.stores["新店"].cashTargetStatus, KPI_VALUE_STATUS.VALID);
});

test("RankingView delegates identity normalization to shared Store Lifecycle authority", () => {
  const source = read("src/components/RankingView.jsx");
  assert.match(source, /import \{ normalizeStoreLifecycleCore \} from "\.\.\/utils\/storeLifecycle\.js";/);
  assert.match(source, /const normalizeStoreKey = normalizeStoreLifecycleCore;/);
  assert.match(source, /const getCoreStoreName = normalizeStoreLifecycleCore;/);

  const localIdentityBlock = source.slice(
    source.indexOf("const normalizeStoreKey ="),
    source.indexOf("const pickNumber =")
  );
  assert.doesNotMatch(localIdentityBlock, /\.replace\(\/店\$\/|\.replace\(\/店\$\/g/);
});

test("HistoryView uses shared identity for matching and keeps raw storeName writes untouched", () => {
  const source = read("src/components/HistoryView.jsx");
  assert.match(source, /import \{ normalizeStoreLifecycleCore \} from "\.\.\/utils\/storeLifecycle\.js";/);
  assert.match(source, /const cleanStoreName = normalizeStoreLifecycleCore;/);
  assert.match(source, /return `\$\{core\}店`;/);
  assert.match(source, /storeName: getStoreName\(cleanData\)/);
  assert.match(source, /storeName: getStoreName\(sourceData\)/);
  assert.doesNotMatch(source, /core === "新店" \? "新店"/);
});

test("trusted historical Dashboard store ranking is not restricted to store-role accounts", () => {
  const source = read("src/hooks/useDashboardStats.js");
  const start = source.indexOf("const summaryMyStoreRankings = useMemo");
  const end = source.indexOf("const summaryTherapistStats = useMemo");
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);

  assert.match(block, /summary\.formalStoreRankings/);
  assert.match(block, /formalRankEligibleStoreCount/);
  assert.match(block, /effectiveStores/);
  assert.doesNotMatch(block, /userRole\s*!==\s*["']store["']/);
  assert.doesNotMatch(block, /currentUser\)\s*return null/);
  assert.match(source, /const myStoreRankings = summaryMyStoreRankings \|\| detailMyStoreRankings;/);
});
