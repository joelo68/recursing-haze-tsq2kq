import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  KPI_VALUE_STATUS,
  validBaseTarget,
} from "../src/utils/kpiContracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/components/TargetView.jsx"), "utf8");

test("5E final: explicit zero remains a configured VALID_ZERO base target", () => {
  const zero = validBaseTarget(0);
  const missing = validBaseTarget("");

  assert.equal(zero.valid, true);
  assert.equal(zero.status, KPI_VALUE_STATUS.VALID_ZERO);
  assert.equal(zero.value, 0);

  assert.equal(missing.valid, false);
  assert.equal(missing.status, KPI_VALUE_STATUS.TARGET_NOT_SET);
  assert.equal(missing.value, null);
});

test("5E final: TargetView hydration round-trips explicit zero instead of collapsing it to blank", () => {
  assert.match(
    source,
    /const formatBaseTargetInputValue = \(row = null, field = ""\) => \{[\s\S]*?validBaseTarget\(row\[field\]\)[\s\S]*?result\.value === 0 \? "0" : formatNumber\(result\.value\)/,
  );

  assert.match(
    source,
    /cashTarget:\s*formatBaseTargetInputValue\(existing,\s*"cashTarget"\)/,
  );
  assert.match(
    source,
    /accrualTarget:\s*formatBaseTargetInputValue\(existing,\s*"accrualTarget"\)/,
  );

  assert.doesNotMatch(
    source,
    /existing\.cashTarget > 0 \? formatNumber\(existing\.cashTarget\) : ""/,
  );
  assert.doesNotMatch(
    source,
    /existing\.accrualTarget > 0 \? formatNumber\(existing\.accrualTarget\) : ""/,
  );
});

test("5E final: configured zero participates in existing target lock semantics", () => {
  assert.match(
    source,
    /const hasConfiguredBaseTarget = \(row = null\) => \{[\s\S]*?validBaseTarget\(row\.cashTarget\)\.valid \|\| validBaseTarget\(row\.accrualTarget\)\.valid/,
  );
  assert.match(source, /return hasConfiguredBaseTarget\(existing\);/);
  assert.doesNotMatch(
    source,
    /existing && \(existing\.cashTarget > 0 \|\| existing\.accrualTarget > 0\)/,
  );
});

test("5E final: missing target UI is visually distinct from an actual configured zero", () => {
  assert.doesNotMatch(source, /placeholder=\{disabled \? "-" : "0"\}/);

  const missingPlaceholders = source.match(
    /placeholder=\{disabled \? "-" : "未設定"\}/g,
  ) || [];
  assert.ok(
    missingPlaceholders.length >= 2,
    `expected at least 2 base-target missing placeholders, found ${missingPlaceholders.length}`,
  );
});

test("5E final: save writer still preserves zero and deletes only not-set fields", () => {
  assert.match(
    source,
    /cashTarget:\s*cashResult\.valid \? cashResult\.value : deleteField\(\)/,
  );
  assert.match(
    source,
    /accrualTarget:\s*accrualResult\.valid \? accrualResult\.value : deleteField\(\)/,
  );
  assert.match(source, /explicit numeric 0 是 configured VALID_ZERO/);
});

test("5E final: challenge target remains positive-only and is not redefined by the base-target UI fix", () => {
  assert.match(source, /existing\.challengeCashTarget > 0/);
  assert.match(source, /existing\.challengeAccrualTarget > 0/);
});
