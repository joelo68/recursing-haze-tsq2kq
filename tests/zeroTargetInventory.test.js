import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const inventory = require('../functions/zeroTargetInventory.js');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const inventorySource = read('functions/zeroTargetInventory.js');
const functionsIndex = read('functions/index.js');
const clientSource = read('scripts/zeroTargetInventoryClient.mjs');

test('explicit zero inventory only classifies finite numeric zero as explicit numeric zero', () => {
  assert.equal(inventory.isExplicitNumericZero(0), true);
  assert.equal(inventory.isExplicitNumericZero(-0), true);
  assert.equal(inventory.isExplicitNumericZero('0'), false);
  assert.equal(inventory.isExplicitNumericZero(''), false);
  assert.equal(inventory.isExplicitNumericZero(null), false);
  assert.equal(inventory.isExplicitNumericZero(1), false);
});

test('inventory record preserves canonical CYJ 新店 identity and explicit zero metric flags', () => {
  const row = inventory.buildZeroTargetInventoryRecord({
    brandId: 'cyj',
    docId: 'CYJ新店店_2026_8',
    data: { storeName: 'CYJ新店店', yearMonth: '2026-08', cashTarget: 0, accrualTarget: 1450000 },
  });
  assert.equal(row.canonicalStoreName, 'CYJ新店店');
  assert.equal(row.canonicalTargetId, 'CYJ新店店_2026_8');
  assert.equal(row.sourceKind, 'CANONICAL');
  assert.equal(row.cashExplicitZero, true);
  assert.equal(row.accrualExplicitZero, false);
});

test('legacy CYJ 新店 zero row is classified separately from canonical source', () => {
  const row = inventory.buildZeroTargetInventoryRecord({
    brandId: 'cyj',
    docId: 'CYJ新店_2026_8',
    data: { storeName: 'CYJ新店', yearMonth: '2026-08', cashTarget: 0, accrualTarget: 0 },
  });
  assert.equal(row.canonicalStoreName, 'CYJ新店店');
  assert.equal(row.sourceKind, 'LEGACY_OR_NONCANONICAL');
  assert.deepEqual(inventory.buildCyjNewStoreLegacyTargetIds(row), [
    'CYJ新店_2026_8',
    'DRCYJ新店_2026_8',
    'DRCYJ新店店_2026_8',
  ]);
});

test('summary observation exposes current downstream loss or replacement of an explicit zero', () => {
  const record = inventory.buildZeroTargetInventoryRecord({
    brandId: 'cyj',
    docId: 'CYJ新店店_2026_8',
    data: { storeName: 'CYJ新店店', yearMonth: '2026-08', cashTarget: 0, accrualTarget: 100 },
  });
  const observation = inventory.buildSummaryObservation(record, {
    yearMonth: '2026-08',
    targets: {
      'CYJ新店店': { storeName: 'CYJ新店店', cashTarget: 1450000, accrualTarget: 100, sourceDocId: 'CYJ新店_2026_8' },
    },
  });
  assert.equal(observation.summaryRowPresent, true);
  assert.equal(observation.summaryCashTarget, 1450000);
  assert.equal(observation.cashZeroPreservedInSummary, false);
  assert.equal(observation.summarySourceDocId, 'CYJ新店_2026_8');
});

test('inventory summary counts metrics, canonical rows and affected months independently', () => {
  const summary = inventory.summarizeZeroTargetInventory([
    { yearMonth: '2026-08', canonicalStoreName: 'CYJA店', sourceKind: 'CANONICAL', cashExplicitZero: true, accrualExplicitZero: false },
    { yearMonth: '2026-08', canonicalStoreName: 'CYJB店', sourceKind: 'LEGACY_OR_NONCANONICAL', cashExplicitZero: true, accrualExplicitZero: true },
    { yearMonth: '2026-09', canonicalStoreName: 'CYJA店', sourceKind: 'CANONICAL', cashExplicitZero: false, accrualExplicitZero: true },
  ]);
  assert.equal(summary.uniqueTargetDocs, 3);
  assert.equal(summary.explicitZeroMetricCount, 4);
  assert.equal(summary.cashZeroDocs, 2);
  assert.equal(summary.accrualZeroDocs, 2);
  assert.equal(summary.canonicalDocs, 2);
  assert.equal(summary.legacyOrNonCanonicalDocs, 1);
  assert.deepEqual(summary.affectedMonths, ['2026-08', '2026-09']);
});

test('5E-0 endpoint is authenticated, super-admin-only, equality-query scoped and write-free', () => {
  assert.match(inventorySource, /requireFirebaseRequestAuth/);
  assert.match(inventorySource, /verifySuperAdminActor/);
  assert.match(inventorySource, /getTargetCoveragePaths/);
  assert.match(inventorySource, /where\('cashTarget',\s*'==',\s*0\)/);
  assert.match(inventorySource, /where\('accrualTarget',\s*'==',\s*0\)/);
  assert.match(inventorySource, /summaryCollection\.doc\(yearMonth\)\.get\(\)/);
  assert.match(inventorySource, /firestoreWrites:\s*0/);
  assert.doesNotMatch(inventorySource, /targetCollection\.get\(\)/);
  assert.doesNotMatch(inventorySource, /transaction\.set|batch\.set|docRef\.set|summaryRef\.set|targetRef\.set/);
  assert.doesNotMatch(inventorySource, /transaction\.update|batch\.update|docRef\.update|summaryRef\.update|targetRef\.update/);
  assert.doesNotMatch(inventorySource, /transaction\.delete|batch\.delete|docRef\.delete|summaryRef\.delete|targetRef\.delete/);
  assert.doesNotMatch(inventorySource, /runTransaction/);
  assert.doesNotMatch(inventorySource, /setInterval\s*\(/);
  assert.doesNotMatch(inventorySource, /onSchedule/);
});

test('Functions index exports only the scoped 5E-0 inventory endpoint for this sub-batch', () => {
  assert.match(functionsIndex, /createZeroTargetInventoryFunctions/);
  assert.match(functionsIndex, /exports\.auditExplicitZeroTargets = zeroTargetInventoryFunctions\.auditExplicitZeroTargets/);
});

test('local audit client authenticates anonymously, calls only audit endpoint and writes report locally', () => {
  assert.match(clientSource, /signInAnonymously/);
  assert.match(clientSource, /auditExplicitZeroTargets/);
  assert.match(clientSource, /DRCYJ_BATCH5E_ZERO_TARGET_INVENTORY_/);
  assert.doesNotMatch(clientSource, /setDoc|addDoc|updateDoc|deleteDoc|writeBatch/);
});
