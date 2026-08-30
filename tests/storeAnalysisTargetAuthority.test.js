import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildStoreAnalysisTargetPresentationAuthority,
  resolveStoreAnalysisCashTargetPresentation,
  resolveStoreAnalysisCashTargetScopePresentation,
  STORE_ANALYSIS_TARGET_STATUS,
} from "../src/utils/storeAnalysisTargetAuthority.js";

const normalizeStoreKey = (value = "") => String(value || "")
  .trim()
  .replace(/^(DRCYJ|CYJ|安妞|伊啵)\s*/i, "")
  .replace(/店$/, "")
  .trim();

const makeSummary = (overrides = {}) => ({
  brandId: "cyj",
  yearMonth: "2026-08",
  targetCoverageVersion: "target-coverage-v1",
  lifecycleReady: true,
  cashMissingStores: [],
  targets: {},
  ...overrides,
});

test("Coverage missing status overrides stale legacy target containers", () => {
  const summary = makeSummary({
    cashMissingStores: ["CYJ中美店"],
    targets: {
      "CYJ中美店": { storeName: "CYJ中美店", cashTarget: null },
    },
    // Historical stale compatibility container must never be trusted by Store Analysis.
    stores: {
      "CYJ中美店": { storeName: "CYJ中美店", cashTarget: 1450000 },
    },
  });
  const authority = buildStoreAnalysisTargetPresentationAuthority({
    summary,
    brandId: "cyj",
    yearMonth: "2026-08",
    normalizeStoreKey,
  });
  const result = resolveStoreAnalysisCashTargetPresentation({
    authority,
    storeName: "CYJ中美店",
    normalizeStoreKey,
  });

  assert.equal(authority.compatible, true);
  assert.equal(result.found, true);
  assert.equal(result.value, 0);
  assert.equal(result.configured, false);
  assert.equal(result.status, STORE_ANALYSIS_TARGET_STATUS.TARGET_NOT_SET);
});

test("canonical targets map supplies positive selected-month target", () => {
  const authority = buildStoreAnalysisTargetPresentationAuthority({
    summary: makeSummary({
      targets: { "CYJ中美店": { storeName: "CYJ中美店", cashTarget: 1450000 } },
    }),
    brandId: "cyj",
    yearMonth: "2026-08",
    normalizeStoreKey,
  });
  const result = resolveStoreAnalysisCashTargetPresentation({ authority, storeName: "中美", normalizeStoreKey });
  assert.deepEqual(result, {
    found: true,
    value: 1450000,
    configured: true,
    status: STORE_ANALYSIS_TARGET_STATUS.VALID,
  });
});

test("explicit canonical zero is presentation $0 but not a valid denominator", () => {
  const authority = buildStoreAnalysisTargetPresentationAuthority({
    summary: makeSummary({
      cashMissingStores: ["CYJ中美店"],
      targets: { "CYJ中美店": { storeName: "CYJ中美店", cashTarget: 0 } },
    }),
    brandId: "cyj",
    yearMonth: "2026-08",
    normalizeStoreKey,
  });
  const result = resolveStoreAnalysisCashTargetPresentation({ authority, storeName: "中美", normalizeStoreKey });
  assert.equal(result.value, 0);
  assert.equal(result.configured, false);
  assert.equal(result.status, STORE_ANALYSIS_TARGET_STATUS.TARGET_NOT_SET);
});

test("aggregate target fails closed when any store is target-not-set", () => {
  const authority = buildStoreAnalysisTargetPresentationAuthority({
    summary: makeSummary({
      cashMissingStores: ["CYJB店"],
      targets: {
        "CYJA店": { storeName: "CYJA店", cashTarget: 100 },
        "CYJB店": { storeName: "CYJB店", cashTarget: null },
      },
    }),
    brandId: "cyj",
    yearMonth: "2026-08",
    normalizeStoreKey,
  });
  const result = resolveStoreAnalysisCashTargetScopePresentation({
    authority,
    storeNames: ["A", "B"],
    normalizeStoreKey,
  });
  assert.equal(result.complete, false);
  assert.equal(result.value, null);
  assert.equal(result.status, STORE_ANALYSIS_TARGET_STATUS.TARGET_NOT_SET);
});

test("cross-brand or wrong-month target Summary fails closed", () => {
  for (const summary of [
    makeSummary({ brandId: "anniu" }),
    makeSummary({ yearMonth: "2026-07" }),
  ]) {
    const authority = buildStoreAnalysisTargetPresentationAuthority({
      summary,
      brandId: "cyj",
      yearMonth: "2026-08",
      normalizeStoreKey,
    });
    assert.equal(authority.compatible, false);
    const result = resolveStoreAnalysisCashTargetPresentation({ authority, storeName: "中美", normalizeStoreKey });
    assert.equal(result.value, null);
    assert.equal(result.status, STORE_ANALYSIS_TARGET_STATUS.AUTHORITY_NOT_READY);
  }
});

test("Store Analysis wiring uses Coverage-aware authority and no legacy container scan", () => {
  const source = fs.readFileSync(new URL("../src/components/StoreAnalysisView.jsx", import.meta.url), "utf8");
  assert.match(source, /buildStoreAnalysisTargetPresentationAuthority/);
  assert.match(source, /resolveStoreAnalysisCashTargetPresentation/);
  assert.match(source, /resolveStoreAnalysisCashTargetScopePresentation/);
  assert.doesNotMatch(source, /source\?\.stores|source\?\.storeTargets|source\?\.storeTargetMap|source\?\.monthlyTargets/);
  assert.doesNotMatch(source, /findTargetByStore/);
});
