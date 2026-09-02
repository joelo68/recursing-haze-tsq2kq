import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const targetCoverage = require("../functions/targetCoverage.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "functions/targetCoverage.js"), "utf8");

const canonicalId = "伊啵中山店_2026_12";

const canonicalRow = (cashTarget, extras = {}) => targetCoverage.buildTargetSummaryRow(
  {
    cashTarget,
    ...extras,
  },
  "伊啵中山店",
  canonicalId,
  canonicalId,
);

test("5E final: same physical canonical Raw missing-to-zero update replaces old Derived row", () => {
  const current = canonicalRow(null, { accrualTarget: null });
  const incoming = canonicalRow(0, { accrualTarget: null });

  assert.equal(
    targetCoverage.isSamePhysicalCanonicalTargetSource(current, incoming),
    true,
  );

  const chosen = targetCoverage.chooseTargetRowForRawEvent(current, incoming);
  assert.equal(chosen.authorityConflict, false);
  assert.equal(chosen.cashTarget, 0);
  assert.equal(chosen.sourceDocId, canonicalId);
  assert.equal(chosen.canonicalTargetId, canonicalId);

  const audit = targetCoverage.buildTargetAudit({ "伊啵中山店": chosen });
  assert.equal(audit.issueCount, 0);
  assert.deepEqual(audit.zeroBaseTargets, [{ storeName: "伊啵中山店", metric: "cash" }]);

  const coverage = targetCoverage.buildIndependentCoverage({
    targetMap: { "伊啵中山店": chosen },
    eligibleEntries: [{
      storeKey: "中山",
      canonicalStoreName: "伊啵中山店",
      brandId: "yibo",
    }],
    lifecycleReady: true,
  });
  assert.equal(coverage.cashConfiguredStoreCount, 1);
  assert.equal(coverage.cashCoverageComplete, true);
  assert.deepEqual(coverage.cashMissingStores, []);
});

test("5E final: same physical canonical Raw positive-to-zero update is a temporal replacement", () => {
  const current = canonicalRow(400000);
  const incoming = canonicalRow(0);
  const chosen = targetCoverage.chooseTargetRowForRawEvent(current, incoming);

  assert.equal(chosen.authorityConflict, false);
  assert.equal(chosen.cashTarget, 0);
  assert.equal(chosen.sourceDocId, canonicalId);
});

test("5E final: same physical canonical Raw zero-to-positive update is a temporal replacement", () => {
  const current = canonicalRow(0);
  const incoming = canonicalRow(450000);
  const chosen = targetCoverage.chooseTargetRowForRawEvent(current, incoming);

  assert.equal(chosen.authorityConflict, false);
  assert.equal(chosen.cashTarget, 450000);
  assert.equal(chosen.sourceDocId, canonicalId);
});

test("5E final: one-source persisted false conflict is repairable by the next same-source Raw event", () => {
  const falseConflict = targetCoverage.buildTargetSummaryRow(
    {
      authorityConflict: true,
      status: "AUTHORITY_CONFLICT",
      conflictSourceDocIds: [canonicalId],
      sourceDocId: canonicalId,
      canonicalTargetId: canonicalId,
    },
    "伊啵中山店",
    canonicalId,
    canonicalId,
  );
  const incoming = canonicalRow(0);

  assert.equal(falseConflict.authorityConflict, true);
  assert.equal(
    targetCoverage.isSamePhysicalCanonicalTargetSource(falseConflict, incoming),
    true,
  );

  const repaired = targetCoverage.chooseTargetRowForRawEvent(falseConflict, incoming);
  assert.equal(repaired.authorityConflict, false);
  assert.equal(repaired.status, "");
  assert.equal(repaired.cashTarget, 0);
  assert.deepEqual(repaired.conflictSourceDocIds, []);
});

test("5E final: distinct canonical-equivalent authoritative sources still fail closed", () => {
  const first = targetCoverage.buildTargetSummaryRow(
    {
      cashTarget: 0,
      accrualTarget: 0,
    },
    "CYJ新店店",
    "CYJ新店店_2026_8",
    "CYJ新店店_2026_8",
  );
  const second = {
    ...targetCoverage.buildTargetSummaryRow(
      {
        cashTarget: 900000,
        accrualTarget: 800000,
      },
      "CYJ新店店",
      "DRCYJ新店店_2026_8",
      "CYJ新店店_2026_8",
    ),
    isCanonicalSource: true,
  };

  assert.equal(
    targetCoverage.isSamePhysicalCanonicalTargetSource(first, second),
    false,
  );

  const chosen = targetCoverage.chooseTargetRowForRawEvent(first, second);
  assert.equal(chosen.authorityConflict, true);
  assert.equal(chosen.status, "AUTHORITY_CONFLICT");
  assert.equal(chosen.cashTarget, null);
});

test("5E final: Summary container arbitration remains unchanged and still uses choosePreferredTargetRow", () => {
  assert.match(
    source,
    /result\[identity\.canonicalStoreName\] = choosePreferredTargetRow\(result\[identity\.canonicalStoreName\], row\)/,
  );
  assert.match(
    source,
    /targetMap\[identity\.canonicalStoreName\] = chooseTargetRowForRawEvent\(/,
  );
});

test("5E final: Raw event arbitration adds no listener, query, polling, or extra Firestore read", () => {
  const start = source.indexOf("async function handleMonthlyTargetWrite");
  const end = source.indexOf("async function recomputeOneSummary", start);
  const rawWriter = source.slice(start, end);

  assert.ok(start >= 0 && end > start, "Raw monthly target writer block must exist");
  assert.equal((source.match(/\.onWrite\(/g) || []).length, 6);
  assert.equal((rawWriter.match(/transaction\.get\(/g) || []).length, 2);
  assert.doesNotMatch(rawWriter, /setInterval\(/);
});
