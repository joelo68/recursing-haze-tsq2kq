import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('5E-1C retires the one-time zero placeholder mutation endpoint from Functions exports', () => {
  const index = read('functions/index.js');

  assert.doesNotMatch(index, /normalizeLegacyZeroTargetPlaceholders/);
  assert.doesNotMatch(index, /createZeroTargetNormalizationFunctions/);
  assert.doesNotMatch(index, /require\(["']\.\/zeroTargetNormalization["']\)/);

  assert.equal(fs.existsSync(path.join(root, 'functions/zeroTargetNormalization.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'scripts/zeroTargetPlaceholderNormalizationClient.mjs')), false);
});

test('5E-1C preserves the read-only zero-target governance audit', () => {
  const index = read('functions/index.js');
  const inventory = read('functions/zeroTargetInventory.js');

  assert.match(index, /createZeroTargetInventoryFunctions/);
  assert.match(index, /exports\.auditExplicitZeroTargets\s*=/);
  assert.match(inventory, /auditExplicitZeroTargets/);
  assert.equal(fs.existsSync(path.join(root, 'scripts/zeroTargetInventoryClient.mjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'scripts/placeholderZeroLifecycleAuditClient.mjs')), true);
});

test('5E-1C does not retire Target Coverage authority or metadata migration', () => {
  const index = read('functions/index.js');
  const coverage = read('functions/targetCoverage.js');

  assert.match(index, /exports\.onLegacyMonthlyTargetChange\s*=/);
  assert.match(index, /exports\.onBrandMonthlyTargetChange\s*=/);
  assert.match(index, /exports\.migrateHistoricalTargetCoverageMetadata\s*=/);
  assert.match(coverage, /buildTargetSummaryReplacementDocument/);
});
