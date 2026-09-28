import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const audit = require("../functions/currentStoreMonthReportsAudit.js");

const updateTime = new Date("2026-09-28T10:00:00.000Z");

function raw(id, data) {
  return { id, data, updateTime };
}

function projectionDoc(id, data) {
  return { id, data };
}

function projectionData({ storeKey = "A", sourceEvents = {} } = {}) {
  return {
    schemaVersion: "current-store-month-reports-v1",
    brandId: "cyj",
    yearMonth: "2026-09",
    storeKey,
    canonicalStoreName: `CYJ${storeKey}店`,
    sourceEvents,
  };
}

test("B2A exact parity preserves explicit zero and missing-field distinction", () => {
  const rawInventory = audit.buildRawParityInventory([
    raw("r1", {
      date: "2026-09-01",
      storeName: "CYJA店",
      cash: 0,
      refund: 0,
    }),
  ], "cyj");

  const projectionInventory = audit.buildProjectionParityInventory([
    projectionDoc("2026-09_QQ", projectionData({
      sourceEvents: {
        cjE: {
          sourceReportId: "r1",
          eventTimestamp: "2026-09-28T10:00:00.000Z",
          exists: true,
          row: {
            sourceReportId: "r1",
            date: "2026-09-01",
            storeName: "CYJA店",
            cash: 0,
            refund: 0,
          },
        },
      },
    })),
  ], "cyj", "2026-09");

  const result = audit.compareRawAndProjection(rawInventory, projectionInventory);
  assert.equal(result.parity, true);
  assert.equal(rawInventory.comparableEntries[0].row.cash, 0);
  assert.equal(Object.hasOwn(rawInventory.comparableEntries[0].row, "accrual"), false);
});

test("B2A missing projection row fails parity instead of shrinking source authority", () => {
  const rawInventory = audit.buildRawParityInventory([
    raw("r1", { date: "2026-09-01", storeName: "CYJA店", cash: 100 }),
  ], "cyj");
  const projectionInventory = audit.buildProjectionParityInventory([], "cyj", "2026-09");
  const result = audit.compareRawAndProjection(rawInventory, projectionInventory);
  assert.equal(result.parity, false);
  assert.equal(result.sourceOnly.total, 1);
});

test("B2A explicit cross-brand raw store name fails closed", () => {
  const inventory = audit.buildRawParityInventory([
    raw("r1", { date: "2026-09-01", storeName: "安妞A店", cash: 100 }),
  ], "cyj");
  assert.equal(inventory.invalidRows.length, 1);
  assert.equal(inventory.invalidRows[0].reason, "CROSS_BRAND_STORE_NAME");
});

test("B2A duplicate canonical Store×Date fails certification basis", () => {
  const inventory = audit.buildRawParityInventory([
    raw("r1", { date: "2026-09-01", storeName: "CYJ新店", cash: 100 }),
    raw("r2", { date: "2026-09-01", storeName: "CYJ新店店", cash: 200 }),
  ], "cyj");
  assert.equal(inventory.duplicateStoreDates.length, 1);
  assert.equal(inventory.duplicateStoreDates[0].storeKey, "新店");
});

test("B2A tombstones do not create false active parity rows", () => {
  const inventory = audit.buildProjectionParityInventory([
    projectionDoc("2026-09_QQ", projectionData({
      sourceEvents: {
        old: {
          sourceReportId: "old",
          eventTimestamp: "2026-09-20T00:00:00.000Z",
          exists: false,
        },
      },
    })),
  ], "cyj", "2026-09");
  assert.equal(inventory.activeProjectionReportCount, 0);
  assert.equal(inventory.invalidDocs.length, 0);
});
