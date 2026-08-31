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

const source = read('functions/zeroTargetInventory.js');
const client = read('scripts/placeholderZeroLifecycleAuditClient.mjs');

const normalizeCore = (value = '') => String(value || '').replace(/^伊啵/, '').replace(/店$/, '');
const lifecycleApi = {
  normalizeStoreLifecycleCore: normalizeCore,
  validateLifecycleDraft(entry = {}) {
    const firstEligibleMonth = String(entry.firstEligibleMonth || '');
    const openDate = String(entry.openDate || '');
    return {
      valid: Boolean(firstEligibleMonth && openDate),
      errors: firstEligibleMonth && openDate ? [] : ['missing'],
      entryStatus: firstEligibleMonth && openDate ? 'COMPLETE' : 'INCOMPLETE',
      normalized: {
        firstEligibleMonth,
        openDate,
        lastEligibleMonth: String(entry.lastEligibleMonth || ''),
        closeDate: String(entry.closeDate || ''),
        exemptMonths: Array.isArray(entry.exemptMonths) ? entry.exemptMonths : [],
      },
    };
  },
  isLifecycleEntryEligibleForMonth(entry = {}, yearMonth = '') {
    if (!entry.firstEligibleMonth || yearMonth < entry.firstEligibleMonth) return false;
    if (entry.lastEligibleMonth && yearMonth > entry.lastEligibleMonth) return false;
    if ((entry.exemptMonths || []).includes(yearMonth)) return false;
    return true;
  },
  getLifecycleEligibleStoreEntries(master = {}, yearMonth = '') {
    return Object.entries(master.stores || {})
      .filter(([, entry]) => lifecycleApi.isLifecycleEntryEligibleForMonth(entry, yearMonth))
      .map(([storeKey, entry]) => ({ ...entry, storeKey, canonicalStoreName: `伊啵${storeKey}店` }));
  },
};

test('5E-0.5 inventory v2 exposes document-shape metadata without inventing target intent', () => {
  const row = inventory.buildZeroTargetInventoryRecord({
    brandId: 'yibo',
    docId: '伊啵站前店_2026_9',
    data: {
      brandId: 'yibo', yearMonth: '2026-09', storeName: '伊啵站前店',
      cashTarget: 0, accrualTarget: 0, challengeCashTarget: 120, isUnlocked: true,
      updatedBy: 'Joe', customLegacyMarker: 'x',
    },
  });
  assert.equal(row.cashExplicitZero, true);
  assert.equal(row.accrualExplicitZero, true);
  assert.equal(row.challengeCashTargetPresent, true);
  assert.equal(row.challengeCashTarget, 120);
  assert.equal(row.isUnlocked, true);
  assert.deepEqual(row.extraFieldNames, ['customLegacyMarker']);
  assert.equal(Object.hasOwn(row, 'configured'), false);
  assert.equal(Object.hasOwn(row, 'placeholder'), false);
});

test('lifecycle relation distinguishes pre-eligible, eligible and exempt target months', () => {
  const master = {
    datasetStatus: 'READY', revision: 7,
    stores: {
      站前: { firstEligibleMonth: '2026-05', openDate: '2026-04-20', exemptMonths: ['2026-08'] },
    },
  };
  const base = { storeCore: '站前', canonicalStoreName: '伊啵站前店' };
  assert.equal(inventory.buildLifecycleObservation({ ...base, yearMonth: '2026-04' }, master, lifecycleApi).lifecycleRelation, 'PRE_ELIGIBLE');
  assert.equal(inventory.buildLifecycleObservation({ ...base, yearMonth: '2026-05' }, master, lifecycleApi).lifecycleRelation, 'ELIGIBLE');
  assert.equal(inventory.buildLifecycleObservation({ ...base, yearMonth: '2026-08' }, master, lifecycleApi).lifecycleRelation, 'EXEMPT_MONTH');
});

test('month observation reports persisted Coverage separately from lifecycle cohort', () => {
  const master = {
    datasetStatus: 'READY', revision: 2,
    stores: {
      站前: { firstEligibleMonth: '2026-05', openDate: '2026-04-20', exemptMonths: [] },
      新莊: { firstEligibleMonth: '2026-07', openDate: '2026-06-15', exemptMonths: [] },
    },
  };
  const result = inventory.buildMonthObservation({
    brandId: 'yibo',
    yearMonth: '2026-06',
    records: [{ yearMonth: '2026-06', docId: '伊啵站前店_2026_6', canonicalStoreName: '伊啵站前店' }],
    summaryData: {
      targetCoverageVersion: 'target-coverage-v1', kpiContractVersion: 'kpi-contract-v1',
      lifecycleReady: true, eligibleStoreCount: 1,
      cashConfiguredStoreCount: 0, accrualConfiguredStoreCount: 0,
      cashCoverageComplete: false, accrualCoverageComplete: false,
      cashMissingStores: ['伊啵站前店'], accrualMissingStores: ['伊啵站前店'],
      targetAudit: { issueCount: 2, zeroBaseTargets: [{ storeName: '伊啵站前店', metric: 'cash' }] },
    },
    lifecycleMaster: master,
    lifecycleApi,
  });
  assert.equal(result.lifecycleEligibleStoreCount, 1);
  assert.deepEqual(result.lifecycleEligibleStores, ['伊啵站前店']);
  assert.equal(result.coverage.cashConfiguredStoreCount, 0);
  assert.deepEqual(result.coverage.cashMissingStores, ['伊啵站前店']);
  assert.equal(result.coverage.targetAuditIssueCount, 2);
});

test('5E-0.5 extends the existing scoped audit with one lifecycle point read and remains write-free', () => {
  assert.match(source, /zero-target-production-inventory-v2/);
  assert.match(source, /const lifecycleRef = db\.doc\(paths\.lifecycleMaster\)/);
  assert.match(source, /lifecycleRef\.get\(\)/);
  assert.match(source, /monthObservations/);
  assert.match(source, /lifecycleReads:\s*1/);
  assert.match(source, /firestoreWrites:\s*0/);
  assert.doesNotMatch(source, /db\.collection\([^\n]+daily_reports/);
  assert.doesNotMatch(source, /db\.collection\([^\n]+therapist_daily_reports/);
  assert.doesNotMatch(source, /runTransaction/);
  assert.doesNotMatch(source, /transaction\.set|batch\.set|docRef\.set|summaryRef\.set|targetRef\.set/);
  assert.doesNotMatch(source, /transaction\.update|batch\.update|docRef\.update|summaryRef\.update|targetRef\.update/);
  assert.doesNotMatch(source, /transaction\.delete|batch\.delete|docRef\.delete|summaryRef\.delete|targetRef\.delete/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /onSchedule/);
});

test('5E-0.5 local client is fail-closed to yibo and requires inventory v2', () => {
  assert.match(client, /brandId !== 'yibo'/);
  assert.match(client, /zero-target-production-inventory-v2/);
  assert.match(client, /auditExplicitZeroTargets/);
  assert.match(client, /DRCYJ_BATCH5E05_PLACEHOLDER_ZERO_LIFECYCLE_AUDIT_/);
  assert.match(client, /Firestore writes: 0/);
  assert.doesNotMatch(client, /setDoc|addDoc|updateDoc|deleteDoc|writeBatch/);
});
