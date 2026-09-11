// tests/projectionContext.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  PROJECTION_CONTEXT_SCHEMA_VERSION,
  PROJECTION_CONTEXT_MAX_STORE_SCHEDULES_PER_EVENT,
  PROJECTION_CONTEXT_MAX_TOTAL_STORE_SCHEDULES,
  normalizeProjectionContextBrandId,
  normalizeProjectionContextYearMonth,
  normalizeProjectionContextEvents,
  parseProjectionContextExpectedRevision,
} = require("../functions/projectionContext.js");

test("Projection Context schema / brand isolation aliases stay explicit", () => {
  assert.equal(PROJECTION_CONTEXT_SCHEMA_VERSION, "projection-context-v2");
  assert.equal(PROJECTION_CONTEXT_MAX_STORE_SCHEDULES_PER_EVENT, 80);
  assert.equal(PROJECTION_CONTEXT_MAX_TOTAL_STORE_SCHEDULES, 240);
  assert.equal(normalizeProjectionContextBrandId("cyj"), "cyj");
  assert.equal(normalizeProjectionContextBrandId("default-app-id"), "cyj");
  assert.equal(normalizeProjectionContextBrandId("anniu"), "anniu");
  assert.equal(normalizeProjectionContextBrandId("yibo"), "yibo");
  assert.equal(normalizeProjectionContextBrandId("other"), "");
});

test("Projection Context only accepts canonical YYYY-MM", () => {
  assert.equal(normalizeProjectionContextYearMonth("2026-09"), "2026-09");
  assert.equal(normalizeProjectionContextYearMonth("2026-9"), "");
  assert.equal(normalizeProjectionContextYearMonth("2026-13"), "");
});

test("Projection Context normalizes one brand-wide event", () => {
  const events = normalizeProjectionContextEvents([{
    id: "event_1",
    name: "CYJ 週年慶",
    type: "anniversary",
    startDate: "2026-09-10",
    endDate: "2026-09-30",
    level: "major",
    scopeMode: "brand",
    storeKeys: ["不應保存"],
    metrics: ["cash", "accrual", "cash"],
    note: "會員回饋",
  }], {
    yearMonth: "2026-09",
    allowedStoreKeys: new Set(["新店", "板橋"]),
    excludedStoreKeys: new Set(),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].scopeMode, "brand");
  assert.deepEqual(events[0].storeKeys, []);
  assert.deepEqual(events[0].metrics, ["accrual", "cash"]);
});

test("Projection Context rejects cross-month dates", () => {
  assert.throws(
    () => normalizeProjectionContextEvents([{
      id: "event_2",
      name: "跨月活動",
      type: "promotion",
      startDate: "2026-09-25",
      endDate: "2026-10-03",
      level: "notable",
      scopeMode: "brand",
      metrics: ["cash"],
    }], { yearMonth: "2026-09" }),
    /同一月份/
  );
});

test("Projection Context rejects a store outside formal eligible scope", () => {
  assert.throws(
    () => normalizeProjectionContextEvents([{
      id: "event_3",
      name: "單店活動",
      type: "promotion",
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      level: "normal",
      scopeMode: "stores",
      storeKeys: ["不存在店"],
      metrics: ["cash"],
    }], {
      yearMonth: "2026-09",
      allowedStoreKeys: new Set(["新店", "板橋"]),
      excludedStoreKeys: new Set(),
    }),
    /正式營運範圍/
  );
});

test("Projection Context rejects System Excluded stores", () => {
  assert.throws(
    () => normalizeProjectionContextEvents([{
      id: "event_4",
      name: "排除店活動",
      type: "other",
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      level: "normal",
      scopeMode: "stores",
      storeKeys: ["中美"],
      metrics: ["accrual"],
    }], {
      yearMonth: "2026-09",
      allowedStoreKeys: new Set(["中美"]),
      excludedStoreKeys: new Set(["中美"]),
    }),
    /已排除店家/
  );
});

test("Projection Context requires OCC revision", () => {
  assert.equal(parseProjectionContextExpectedRevision(0), 0);
  assert.equal(parseProjectionContextExpectedRevision("3"), 3);
  assert.throws(() => parseProjectionContextExpectedRevision(-1), /版本無效/);
});

test("Projection Context v2 keeps legacy events backward-compatible with empty storeSchedule", () => {
  const events = normalizeProjectionContextEvents([{
    id: "legacy_event",
    name: "舊版活動",
    type: "promotion",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    level: "major",
    scopeMode: "brand",
    metrics: ["cash"],
  }], {
    yearMonth: "2026-09",
    allowedStoreKeys: new Set(["新店", "板橋"]),
    excludedStoreKeys: new Set(),
  });

  assert.equal(events[0].campaignId, "legacy_event");
  assert.deepEqual(events[0].storeSchedule, []);
});

test("Projection Context v2 normalizes per-store scheduled dates with canonical store identity", () => {
  const lifecycleEntriesByStoreKey = new Map([
    ["新店", {
      storeKey: "新店",
      coreStoreName: "新店",
      firstEligibleMonth: "2026-09",
      openDate: "2026-09-01",
    }],
    ["板橋", {
      storeKey: "板橋",
      coreStoreName: "板橋",
      firstEligibleMonth: "2026-09",
      openDate: "2026-09-01",
    }],
  ]);

  const events = normalizeProjectionContextEvents([{
    id: "vip_202609",
    campaignId: "vip_2026",
    name: "VIP 茶會",
    type: "promotion",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    level: "major",
    scopeMode: "brand",
    metrics: ["cash", "accrual"],
    storeSchedule: [
      { storeName: "CYJ新店店", date: "2026-09-12" },
      { storeKey: "板橋", startDate: "2026-09-19", endDate: "2026-09-20" },
    ],
  }], {
    yearMonth: "2026-09",
    allowedStoreKeys: new Set(["新店", "板橋"]),
    excludedStoreKeys: new Set(),
    lifecycleEntriesByStoreKey,
  });

  assert.equal(events[0].campaignId, "vip_2026");
  assert.deepEqual(events[0].storeSchedule, [
    { storeKey: "新店", startDate: "2026-09-12", endDate: "2026-09-12" },
    { storeKey: "板橋", startDate: "2026-09-19", endDate: "2026-09-20" },
  ]);
});

test("Projection Context v2 rejects duplicate scheduled store rows", () => {
  assert.throws(
    () => normalizeProjectionContextEvents([{
      id: "event_duplicate_schedule",
      name: "VIP 茶會",
      type: "promotion",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      level: "major",
      scopeMode: "brand",
      metrics: ["cash"],
      storeSchedule: [
        { storeKey: "新店", date: "2026-09-12" },
        { storeName: "CYJ新店店", date: "2026-09-13" },
      ],
    }], {
      yearMonth: "2026-09",
      allowedStoreKeys: new Set(["新店"]),
      excludedStoreKeys: new Set(),
    }),
    /重複/
  );
});

test("Projection Context v2 rejects scheduled dates outside the campaign period", () => {
  assert.throws(
    () => normalizeProjectionContextEvents([{
      id: "event_outside_period",
      name: "VIP 茶會",
      type: "promotion",
      startDate: "2026-09-10",
      endDate: "2026-09-20",
      level: "major",
      scopeMode: "brand",
      metrics: ["cash"],
      storeSchedule: [
        { storeKey: "板橋", date: "2026-09-25" },
      ],
    }], {
      yearMonth: "2026-09",
      allowedStoreKeys: new Set(["板橋"]),
      excludedStoreKeys: new Set(),
    }),
    /整體活動期間/
  );
});

test("Projection Context v2 rejects a scheduled store outside store-scoped event range", () => {
  assert.throws(
    () => normalizeProjectionContextEvents([{
      id: "event_scope_guard",
      name: "指定店活動",
      type: "promotion",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      level: "notable",
      scopeMode: "stores",
      storeKeys: ["新店"],
      metrics: ["cash"],
      storeSchedule: [
        { storeKey: "板橋", date: "2026-09-12" },
      ],
    }], {
      yearMonth: "2026-09",
      allowedStoreKeys: new Set(["新店", "板橋"]),
      excludedStoreKeys: new Set(),
    }),
    /超出本活動指定範圍/
  );
});

test("Projection Context v2 rejects scheduled stores after Lifecycle close date", () => {
  const lifecycleEntriesByStoreKey = new Map([
    ["板橋", {
      storeKey: "板橋",
      coreStoreName: "板橋",
      firstEligibleMonth: "2026-09",
      openDate: "2026-09-01",
      lastEligibleMonth: "2026-09",
      closeDate: "2026-09-15",
    }],
  ]);

  assert.throws(
    () => normalizeProjectionContextEvents([{
      id: "event_lifecycle_guard",
      name: "VIP 茶會",
      type: "promotion",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      level: "major",
      scopeMode: "brand",
      metrics: ["cash"],
      storeSchedule: [
        { storeKey: "板橋", date: "2026-09-20" },
      ],
    }], {
      yearMonth: "2026-09",
      allowedStoreKeys: new Set(["板橋"]),
      excludedStoreKeys: new Set(),
      lifecycleEntriesByStoreKey,
    }),
    /正式營運期間/
  );
});

test("Projection Context v2 rejects System Excluded scheduled stores", () => {
  assert.throws(
    () => normalizeProjectionContextEvents([{
      id: "event_schedule_excluded",
      name: "VIP 茶會",
      type: "promotion",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      level: "major",
      scopeMode: "brand",
      metrics: ["cash"],
      storeSchedule: [
        { storeKey: "中美", date: "2026-09-20" },
      ],
    }], {
      yearMonth: "2026-09",
      allowedStoreKeys: new Set(["中美"]),
      excludedStoreKeys: new Set(["中美"]),
    }),
    /已排除店家/
  );
});

test("Projection Context v2 accepts VIP as an explicit event type", () => {
  const events = normalizeProjectionContextEvents([{
    id: "vip_event_type",
    name: "VIP 茶會",
    type: "vip",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    level: "major",
    scopeMode: "brand",
    metrics: ["cash"],
  }], {
    yearMonth: "2026-09",
    allowedStoreKeys: new Set(["新店"]),
    excludedStoreKeys: new Set(),
  });

  assert.equal(events[0].type, "vip");
});

test("Projection Context v2 caps per-event store schedule rows", () => {
  const storeKeys = Array.from({ length: 81 }, (_, index) => `測試${index + 1}`);
  assert.throws(
    () => normalizeProjectionContextEvents([{
      id: "event_schedule_cap",
      name: "大量店家活動",
      type: "vip",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      level: "major",
      scopeMode: "brand",
      metrics: ["cash"],
      storeSchedule: storeKeys.map((storeKey) => ({ storeKey, date: "2026-09-12" })),
    }], {
      yearMonth: "2026-09",
      allowedStoreKeys: new Set(storeKeys),
      excludedStoreKeys: new Set(),
    }),
    /單一活動最多設定/
  );
});

test("Projection Context v2 caps total monthly store schedule rows to keep one monthly document bounded", () => {
  const storeKeys = Array.from({ length: 61 }, (_, index) => `測試${index + 1}`);
  const events = Array.from({ length: 4 }, (_, index) => ({
    id: `event_total_cap_${index + 1}`,
    name: `活動 ${index + 1}`,
    type: "vip",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    level: "major",
    scopeMode: "brand",
    metrics: ["cash"],
    storeSchedule: storeKeys.map((storeKey) => ({ storeKey, date: "2026-09-12" })),
  }));

  assert.throws(
    () => normalizeProjectionContextEvents(events, {
      yearMonth: "2026-09",
      allowedStoreKeys: new Set(storeKeys),
      excludedStoreKeys: new Set(),
    }),
    /單一月份最多設定/
  );
});
