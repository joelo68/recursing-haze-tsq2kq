import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  AUDIT_TARGET_AUTHORITY_STATUS,
  buildAuditTargetSummaryAuthority,
  resolveAuditStoreTargetPresence,
} from "../src/utils/auditTargetAuthority.js";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const audit = fs.readFileSync(new URL("../src/components/AuditView.jsx", import.meta.url), "utf8");
const dataModel = fs.readFileSync(new URL("../docs/FIREBASE_DATA_MODEL.md", import.meta.url), "utf8");
const sourceMap = fs.readFileSync(new URL("../docs/SYSTEM_SOURCE_MAP.md", import.meta.url), "utf8");

const normalizeStoreKey = (value = "") => String(value || "")
  .replace(/^(CYJ|安妞|伊啵)/, "")
  .replace(/店+$/g, "")
  .trim();

const makeSummary = (overrides = {}) => ({
  brandId: "cyj",
  yearMonth: "2026-09",
  targetCoverageVersion: "target-coverage-v1",
  lifecycleReady: true,
  cashMissingStores: [],
  accrualMissingStores: [],
  targets: {
    "CYJA店": { storeName: "CYJA店", cashTarget: 100, accrualTarget: 200 },
    "CYJB店": { storeName: "CYJB店", cashTarget: 0, accrualTarget: 0 },
  },
  ...overrides,
});

test("P2-A2.3 Audit target no longer activates full monthly_targets listener", () => {
  assert.match(app, /const shouldLoadMonthlyTargets = activeView === "targets";/);
  assert.doesNotMatch(
    app,
    /shouldLoadMonthlyTargets\s*=[\s\S]{0,220}activeView === "audit" && auditType === "target"/
  );
  assert.match(app, /doc\(getCollectionPath\("monthly_targets_summary"\), selectedYearMonth\)/);
});

test("P2-A2.3 Audit consumes monthlyTargetSummary instead of raw budgets", () => {
  assert.match(audit, /monthlyTargetSummary/);
  assert.match(audit, /buildAuditTargetSummaryAuthority/);
  assert.match(audit, /resolveAuditStoreTargetPresence/);
  assert.doesNotMatch(audit, /\bbudgets\b/);
  assert.doesNotMatch(audit, /!b\.cashTarget && !b\.accrualTarget/);
});

test("P2-A2.3 exact brand month and Coverage gate fails closed", () => {
  const good = buildAuditTargetSummaryAuthority({
    summary: makeSummary(),
    brandId: "cyj",
    yearMonth: "2026-09",
    normalizeStoreKey,
  });
  assert.equal(good.compatible, true);

  const badAuthorities = [
    buildAuditTargetSummaryAuthority({ summary: makeSummary({ brandId: "anniu" }), brandId: "cyj", yearMonth: "2026-09", normalizeStoreKey }),
    buildAuditTargetSummaryAuthority({ summary: makeSummary({ yearMonth: "2026-08" }), brandId: "cyj", yearMonth: "2026-09", normalizeStoreKey }),
    buildAuditTargetSummaryAuthority({ summary: makeSummary({ targetCoverageVersion: "" }), brandId: "cyj", yearMonth: "2026-09", normalizeStoreKey }),
    buildAuditTargetSummaryAuthority({ summary: makeSummary({ lifecycleReady: false }), brandId: "cyj", yearMonth: "2026-09", normalizeStoreKey }),
  ];

  badAuthorities.forEach((authority) => assert.equal(authority.compatible, false));
});

test("P2-A2.3 explicit zero remains configured", () => {
  const authority = buildAuditTargetSummaryAuthority({
    summary: makeSummary(),
    brandId: "cyj",
    yearMonth: "2026-09",
    normalizeStoreKey,
  });
  const result = resolveAuditStoreTargetPresence({
    authority,
    storeName: "CYJB店",
    normalizeStoreKey,
  });

  assert.equal(result.configured, true);
  assert.equal(result.status, AUDIT_TARGET_AUTHORITY_STATUS.CONFIGURED);
  assert.equal(result.cash.value, 0);
  assert.equal(result.accrual.value, 0);
});

test("P2-A2.3 Coverage missing status overrides stale Summary row values", () => {
  const authority = buildAuditTargetSummaryAuthority({
    summary: makeSummary({
      cashMissingStores: ["CYJA店"],
      accrualMissingStores: ["CYJA店"],
    }),
    brandId: "cyj",
    yearMonth: "2026-09",
    normalizeStoreKey,
  });
  const result = resolveAuditStoreTargetPresence({
    authority,
    storeName: "CYJA店",
    normalizeStoreKey,
  });

  assert.equal(result.configured, false);
  assert.equal(result.status, AUDIT_TARGET_AUTHORITY_STATUS.TARGET_NOT_SET);
});

test("P2-A2.3 authority conflict and invalid targets fail closed", () => {
  const conflictAuthority = buildAuditTargetSummaryAuthority({
    summary: makeSummary({
      targets: {
        "CYJA店": {
          storeName: "CYJA店",
          cashTarget: null,
          accrualTarget: null,
          authorityConflict: true,
          authorityStatus: "AUTHORITY_CONFLICT",
        },
      },
    }),
    brandId: "cyj",
    yearMonth: "2026-09",
    normalizeStoreKey,
  });

  const conflict = resolveAuditStoreTargetPresence({
    authority: conflictAuthority,
    storeName: "CYJA店",
    normalizeStoreKey,
  });
  assert.equal(conflict.configured, false);
  assert.equal(conflict.status, AUDIT_TARGET_AUTHORITY_STATUS.AUTHORITY_CONFLICT);

  const invalidAuthority = buildAuditTargetSummaryAuthority({
    summary: makeSummary({
      targets: {
        "CYJA店": { storeName: "CYJA店", cashTarget: -1, accrualTarget: "bad" },
      },
    }),
    brandId: "cyj",
    yearMonth: "2026-09",
    normalizeStoreKey,
  });

  const invalid = resolveAuditStoreTargetPresence({
    authority: invalidAuthority,
    storeName: "CYJA店",
    normalizeStoreKey,
  });
  assert.equal(invalid.configured, false);
  assert.equal(invalid.status, AUDIT_TARGET_AUTHORITY_STATUS.DATA_INVALID);
});

test("P2-A2.3 Target editor keeps full Raw authority and no new listener or polling is added", () => {
  assert.match(app, /activeView === "targets"/);
  assert.match(app, /trackSnapshotRead\("monthly_targets_live"/);
  assert.equal((app.match(/trackSnapshotRead\("monthly_targets_live"/g) || []).length, 1);
  assert.equal((app.match(/monthly_targets_summary_live/g) || []).length >= 1, true);
  assert.doesNotMatch(audit, /onSnapshot\s*\(/);
  assert.doesNotMatch(audit, /setInterval\s*\(/);
});

test("P2-A2.3 documentation records the Summary-first target audit topology", () => {
  assert.match(dataModel, /`回報檢核 > 店家目標` 改用既有 selected-month `monthly_targets_summary\/\{YYYY-MM\}` 單文件 authority/);
  assert.match(sourceMap, /P2-A2\.3：`店家目標` 使用 selected-month `monthly_targets_summary\/\{YYYY-MM\}` 1-doc authority/);
});
