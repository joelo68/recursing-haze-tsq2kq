import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import * as frontend from "../src/utils/targetAuthorityConflict.js";

const require = createRequire(import.meta.url);
const backend = require("../functions/targetAuthorityConflict.js");

const implementations = [
  ["frontend", frontend],
  ["backend", backend],
];

for (const [label, api] of implementations) {
  test(`${label}: semantically identical authoritative zero rows do not conflict`, () => {
    const current = {
      storeName: "CYJ新店店",
      sourceDocId: "A",
      canonicalTargetId: "CYJ新店店_2026_8",
      cashTarget: 0,
      accrualTarget: "0",
      challengeCashTarget: "",
      challengeAccrualTarget: 0,
    };
    const incoming = {
      ...current,
      sourceDocId: "B",
      cashTarget: "0",
      accrualTarget: 0,
      challengeCashTarget: 0,
      challengeAccrualTarget: "",
    };
    assert.equal(api.resolveTargetAuthorityConflict(current, incoming, {
      currentAuthoritative: true,
      incomingAuthoritative: true,
      storeName: "CYJ新店店",
      canonicalTargetId: "CYJ新店店_2026_8",
    }), null);
  });

  test(`${label}: canonical vs legacy disagreement is not an authority conflict`, () => {
    assert.equal(api.resolveTargetAuthorityConflict(
      { sourceDocId: "legacy", cashTarget: 900000, accrualTarget: 800000 },
      { sourceDocId: "canonical", cashTarget: 0, accrualTarget: 0 },
      {
        currentAuthoritative: false,
        incomingAuthoritative: true,
        storeName: "CYJ新店店",
        canonicalTargetId: "CYJ新店店_2026_8",
      },
    ), null);
  });

  test(`${label}: conflicting authoritative rows fail closed deterministically`, () => {
    const zero = {
      storeName: "CYJ新店店",
      sourceDocId: "A",
      canonicalTargetId: "CYJ新店店_2026_8",
      cashTarget: 0,
      accrualTarget: 0,
    };
    const positive = {
      storeName: "CYJ新店店",
      sourceDocId: "B",
      canonicalTargetId: "CYJ新店店_2026_8",
      cashTarget: 900000,
      accrualTarget: 800000,
    };

    const one = api.resolveTargetAuthorityConflict(zero, positive, {
      currentAuthoritative: true,
      incomingAuthoritative: true,
      storeName: "CYJ新店店",
      canonicalTargetId: "CYJ新店店_2026_8",
    });
    const two = api.resolveTargetAuthorityConflict(positive, zero, {
      currentAuthoritative: true,
      incomingAuthoritative: true,
      storeName: "CYJ新店店",
      canonicalTargetId: "CYJ新店店_2026_8",
    });

    for (const result of [one, two]) {
      assert.equal(result.authorityConflict, true);
      assert.equal(result.status, api.TARGET_AUTHORITY_CONFLICT_STATUS);
      assert.equal(result.cashTarget, null);
      assert.equal(result.accrualTarget, null);
      assert.deepEqual(result.conflictSourceDocIds, ["A", "B"]);
    }
    assert.deepEqual(one, two);
  });
}

test("frontend and backend target authority conflict semantics stay identical", () => {
  const rows = [
    { cashTarget: 0, accrualTarget: 0 },
    { cashTarget: 100, challengeCashTarget: 0 },
    { cashTarget: 0, challengeCashTarget: 120 },
  ];
  rows.forEach((row) => {
    assert.deepEqual(
      frontend.buildTargetAuthoritySemanticSnapshot(row),
      backend.buildTargetAuthoritySemanticSnapshot(row),
    );
    assert.equal(
      frontend.buildTargetAuthoritySemanticSignature(row),
      backend.buildTargetAuthoritySemanticSignature(row),
    );
  });
});
