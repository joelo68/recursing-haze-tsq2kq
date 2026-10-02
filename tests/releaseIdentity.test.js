import test from "node:test";
import assert from "node:assert/strict";

import {
  RELEASE_IDENTITY_SCHEMA_VERSION,
  buildReleaseIdentityStatus,
  fetchPublishedReleaseIdentity,
  getLoadedEntryAsset,
  normalizePublishedReleaseIdentity,
} from "../src/utils/releaseIdentity.js";

const release = {
  schemaVersion: RELEASE_IDENTITY_SCHEMA_VERSION,
  appVersion: "3.6.1",
  sourceCommit: "83ebb1d56ec4bb70aea6f5ad811dc8851d8d8993",
  entryAsset: "assets/index-DSQNwaVu.js",
};

test("P1-RH release identity recognizes a browser loaded from the published release", () => {
  const status = buildReleaseIdentityStatus({
    appVersion: "3.6.1",
    publishedSystemVersion: "3.6.1",
    loadedEntryAsset: "assets/index-DSQNwaVu.js",
    publishedRelease: release,
    serviceWorkerState: { supported: true, controlled: true, scriptURL: "https://example.test/sw.js" },
  });

  assert.equal(status.status, "healthy");
  assert.equal(status.publishedRelease.sourceCommit, release.sourceCommit);
  assert.equal(status.mismatches.length, 0);
});

test("P1-RH stale loaded asset fails closed even when semantic app version matches", () => {
  const status = buildReleaseIdentityStatus({
    appVersion: "3.6.1",
    publishedSystemVersion: "3.6.1",
    loadedEntryAsset: "assets/index-OLD123.js",
    publishedRelease: release,
  });

  assert.equal(status.status, "stale");
  assert.deepEqual(status.mismatches, ["entryAsset"]);
});

test("P1-RH system_version drift is attention without pretending the browser bundle is stale", () => {
  const status = buildReleaseIdentityStatus({
    appVersion: "3.6.1",
    publishedSystemVersion: "3.6.0",
    loadedEntryAsset: "assets/index-DSQNwaVu.js",
    publishedRelease: release,
  });

  assert.equal(status.status, "attention");
  assert.deepEqual(status.mismatches, ["systemVersion"]);
});

test("P1-RH missing published release stays unavailable instead of inventing release health", () => {
  const status = buildReleaseIdentityStatus({
    appVersion: "3.6.1",
    publishedSystemVersion: "3.6.1",
    loadedEntryAsset: "assets/index-DSQNwaVu.js",
    publishedRelease: null,
  });

  assert.equal(status.status, "attention");
  assert.deepEqual(status.unavailable, ["publishedRelease"]);
});

test("P1-RH release.json contract validates version, commit and entry asset", () => {
  assert.deepEqual(normalizePublishedReleaseIdentity(release), release);
  assert.throws(
    () => normalizePublishedReleaseIdentity({ ...release, sourceCommit: "bad" }),
    /release_identity_incomplete/
  );
  assert.throws(
    () => normalizePublishedReleaseIdentity({ ...release, schemaVersion: "legacy" }),
    /release_identity_schema_mismatch/
  );
});

test("P1-RH browser entry asset is discovered without a Firestore read", () => {
  const documentRef = {
    querySelectorAll: () => [
      { getAttribute: () => "/recursing-haze-tsq2kq/assets/index-DSQNwaVu.js" },
    ],
  };
  assert.equal(getLoadedEntryAsset(documentRef), "assets/index-DSQNwaVu.js");
});

test("P1-RH published release fetch is no-store and cache-busted", async () => {
  let requestedUrl = "";
  let requestedOptions = null;
  const fetched = await fetchPublishedReleaseIdentity({
    baseUrl: "/recursing-haze-tsq2kq/",
    origin: "https://example.test",
    now: 12345,
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => release,
      };
    },
  });

  assert.deepEqual(fetched, release);
  assert.match(requestedUrl, /\/recursing-haze-tsq2kq\/release\.json\?release_health=12345$/);
  assert.equal(requestedOptions.cache, "no-store");
});
