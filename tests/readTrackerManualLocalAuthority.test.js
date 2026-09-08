import test from "node:test";
import assert from "node:assert/strict";

import {
  getManualLocalReadTrackerEnabled,
  setManualLocalReadTrackerEnabled,
  resolveReadTrackerModeFromConfig,
} from "../src/utils/readTracker.js";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(String(key), String(value));
  }
  removeItem(key) {
    this.map.delete(String(key));
  }
}

test("manual-local read tracker uses one shared effective-mode authority", () => {
  const previousLocalStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;

  try {
    const scheduledGlobal = {
      mode: "off",
      scheduleEnabled: true,
      scheduleMode: "global",
      startTime: "19:00",
      endTime: "07:00",
      timezone: "Asia/Taipei",
    };

    const scheduleInactive = new Date(2026, 8, 8, 8, 30, 0);
    const scheduleActive = new Date(2026, 8, 8, 20, 0, 0);

    assert.equal(getManualLocalReadTrackerEnabled(), false);
    assert.equal(
      resolveReadTrackerModeFromConfig({ mode: "off", scheduleEnabled: false }, scheduleInactive),
      "off"
    );

    setManualLocalReadTrackerEnabled(true);
    assert.equal(getManualLocalReadTrackerEnabled(), true);

    assert.equal(
      resolveReadTrackerModeFromConfig({ mode: "off", scheduleEnabled: false }, scheduleInactive),
      "local"
    );

    assert.equal(
      resolveReadTrackerModeFromConfig(scheduledGlobal, scheduleActive),
      "global"
    );

    assert.equal(
      resolveReadTrackerModeFromConfig({ mode: "global", scheduleEnabled: false }, scheduleInactive),
      "local"
    );

    setManualLocalReadTrackerEnabled(false);
    assert.equal(getManualLocalReadTrackerEnabled(), false);
    assert.equal(
      resolveReadTrackerModeFromConfig({ mode: "global", scheduleEnabled: false }, scheduleInactive),
      "global"
    );
  } finally {
    if (previousLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousLocalStorage;
    }
  }
});

test("SystemMaintenance delegates manual-local persistence to readTracker authority", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(
    new URL("../src/components/SystemMaintenance.jsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /setManualLocalReadTrackerEnabled/);
  assert.match(source, /resolveReadTrackerModeFromConfig\(config\)/);
  assert.match(source, /resolveReadTrackerModeFromConfig\(nextConfig\)/);
  assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem|removeItem)\("read_tracker_manual_local_enabled"/);
});

test("App keeps using the shared resolver for config and schedule authority", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(
    new URL("../src/App.jsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /resolveReadTrackerModeFromConfig\(remoteConfig\)/);
  assert.doesNotMatch(source, /read_tracker_manual_local_enabled/);
});
