import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MAX_DOCUMENT_READ_BUDGET,
  buildProductionHealthSnapshotFromSources,
  assertProductionObservabilityClaims,
  getPreviousYearMonth,
  normalizeProductionBrandId,
} = require("../functions/productionObservability.js");

const verifiedSources = {
  brandId: "cyj",
  brandLabel: "CYJ",
  generatedAtText: "2026-09-24T05:00:00.000Z",
  currentYearMonth: "2026-09",
  previousYearMonth: "2026-08",
  previousFlag: {
    exists: true,
    data: {
      status: "verified",
      dirty: false,
      lastMismatchCount: 0,
      updatedAtText: "2026-09-02T00:00:00.000Z",
    },
  },
  previousSummary: {
    exists: true,
    data: {
      version: "dashboard-summary-v2",
      lastUpdatedAtText: "2026-09-02T00:00:00.000Z",
    },
  },
  summaryIssues: [],
  securitySummary: {
    exists: true,
    data: {
      pendingCount: 0,
      adminAssistancePendingCount: 0,
      updatedAtText: "2026-09-24T04:00:00.000Z",
    },
  },
  todayStats: { exists: true, data: { count: 12 } },
  yesterdayStats: { exists: true, data: { count: 25 } },
  readTrackerConfig: {
    exists: true,
    data: {
      mode: "off",
      scheduleEnabled: true,
      scheduleMode: "global",
      startTime: "19:00",
      endTime: "07:00",
    },
  },
  maintenanceRows: [
    {
      id: "m1",
      data: {
        type: "summary",
        action: "auto_month_report_finalized",
        status: "success",
        month: "2026-08",
        createdAtText: "2026-09-02T00:00:00.000Z",
      },
    },
  ],
  sourceErrors: [],
  observedDocumentResults: 7,
};

test("P1-C healthy snapshot requires verified previous summary and no unresolved issues", () => {
  const snapshot = buildProductionHealthSnapshotFromSources(verifiedSources);
  assert.equal(snapshot.overall.status, "healthy");
  assert.equal(snapshot.summary.previousVerified, true);
  assert.equal(snapshot.summary.unresolvedCount, 0);
  assert.equal(snapshot.security.pendingCount, 0);
  assert.equal(snapshot.usage.todayLoginCount, 12);
  assert.equal(snapshot.readTracking.scheduleEnabled, true);
  assert.equal(snapshot.diagnostics.maxDocumentReadBudget, 21);
});

test("P1-C unresolved summary status becomes attention without inventing a system failure", () => {
  const snapshot = buildProductionHealthSnapshotFromSources({
    ...verifiedSources,
    summaryIssues: [
      { id: "2026-07", data: { status: "dirty", pendingCount: 1 } },
    ],
  });
  assert.equal(snapshot.overall.status, "attention");
  assert.equal(snapshot.summary.status, "attention");
  assert.equal(snapshot.summary.unresolvedCount, 1);
  assert.equal(snapshot.summary.unresolvedMonths[0].yearMonth, "2026-07");
});

test("P1-C source read failure is surfaced as unavailable health evidence", () => {
  const snapshot = buildProductionHealthSnapshotFromSources({
    ...verifiedSources,
    sourceErrors: ["summaryIssues"],
  });
  assert.equal(snapshot.overall.status, "error");
  assert.equal(snapshot.summary.status, "error");
  assert.deepEqual(snapshot.diagnostics.sourceErrors, ["summaryIssues"]);
});

test("P1-C security pending work is attention but does not corrupt summary authority", () => {
  const snapshot = buildProductionHealthSnapshotFromSources({
    ...verifiedSources,
    securitySummary: {
      exists: true,
      data: {
        pendingCount: 3,
        adminAssistancePendingCount: 1,
      },
    },
  });
  assert.equal(snapshot.security.status, "attention");
  assert.equal(snapshot.security.pendingCount, 3);
  assert.equal(snapshot.summary.previousVerified, true);
});

test("P1-C claims are strictly same-brand director Application Identity", () => {
  const auth = {
    ok: true,
    decoded: {
      drcyjIdentity: true,
      identityVersion: "application-identity-v1",
      brandId: "cyj",
      roleId: "director",
      directorLevel: "operation_admin",
      accountId: "director-1",
    },
  };
  const actor = assertProductionObservabilityClaims(auth, "cyj", "application-identity-v1");
  assert.equal(actor.accountId, "director-1");

  assert.throws(
    () => assertProductionObservabilityClaims({
      ...auth,
      decoded: { ...auth.decoded, brandId: "anniu" },
    }, "cyj", "application-identity-v1"),
    /production_observability_identity_mismatch/
  );

  assert.throws(
    () => assertProductionObservabilityClaims({
      ...auth,
      decoded: { ...auth.decoded, roleId: "manager" },
    }, "cyj", "application-identity-v1"),
    /production_observability_identity_mismatch/
  );

  assert.throws(
    () => assertProductionObservabilityClaims({
      ...auth,
      decoded: { ...auth.decoded, directorLevel: "finance_admin" },
    }, "cyj", "application-identity-v1"),
    /production_observability_identity_mismatch/
  );
});

test("P1-C brand and previous-month normalization do not cross brand or year boundary", () => {
  assert.equal(normalizeProductionBrandId("anniu"), "anniu");
  assert.equal(normalizeProductionBrandId("yibo"), "yibo");
  assert.equal(getPreviousYearMonth("2026-01"), "2025-12");
  assert.throws(() => normalizeProductionBrandId("unknown"), /unsupported_brand/);
});

test("P1-C read budget is permanently bounded", () => {
  assert.equal(MAX_DOCUMENT_READ_BUDGET, 21);
});
