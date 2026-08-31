import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const normalization = require('../functions/zeroTargetNormalization.js');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const source = read('functions/zeroTargetNormalization.js');
const targetView = read('src/components/TargetView.jsx');
const targetCoverage = read('functions/targetCoverage.js');
const functionsIndex = read('functions/index.js');
const client = read('scripts/zeroTargetPlaceholderNormalizationClient.mjs');

const normalizeCore = (value = '') => String(value || '')
  .replace(/^伊啵/, '')
  .replace(/店$/, '')
  .trim();

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
      .map(([storeKey]) => ({
        storeKey,
        coreStoreName: storeKey,
        canonicalStoreName: `伊啵${storeKey}店`,
        brandId: 'yibo',
      }));
  },
};

function makeLifecycleMaster() {
  return {
    datasetStatus: 'READY',
    revision: 6,
    stores: {
      中山: { firstEligibleMonth: '2026-04', openDate: '2026-04-01', exemptMonths: [] },
      天母: { firstEligibleMonth: '2026-04', openDate: '2026-04-01', exemptMonths: [] },
      新莊: { firstEligibleMonth: '2026-05', openDate: '2026-05-05', exemptMonths: [] },
      站前: { firstEligibleMonth: '2026-08', openDate: '2026-08-11', exemptMonths: [] },
    },
  };
}

function exactPlaceholderData(entry) {
  return {
    cashTarget: 0,
    accrualTarget: 0,
    challengeCashTarget: 0,
    challengeAccrualTarget: 0,
    isUnlocked: false,
    updatedAt: entry.expectedUpdatedAtText,
    updatedBy: entry.expectedUpdatedBy,
  };
}

function fakeSnap(docMap = new Map()) {
  return {
    size: docMap.size,
    docs: [...docMap.entries()].map(([id, data]) => ({
      id,
      data: () => data,
    })),
  };
}

function fakeDocSnap(id, exists, data = {}) {
  return {
    id,
    exists,
    data: () => data,
  };
}

test('5E-1A manifest is exact-scope: 27 Yibo canonical docs, 11 months, 11 pre-eligible + 16 eligible', () => {
  const manifest = normalization.BATCH5E1A_PLACEHOLDER_MANIFEST;
  assert.equal(manifest.length, 27);
  assert.equal(new Set(manifest.map((row) => row.docId)).size, 27);
  assert.equal(new Set(manifest.map((row) => row.yearMonth)).size, 11);
  assert.equal(manifest.filter((row) => row.expectedLifecycleRelation === 'PRE_ELIGIBLE').length, 11);
  assert.equal(manifest.filter((row) => row.expectedLifecycleRelation === 'ELIGIBLE').length, 16);
  assert.ok(manifest.every((row) => row.docId.startsWith('伊啵')));
  assert.equal(normalization.BATCH5E1A_TARGET_BRAND, 'yibo');
  assert.equal(normalization.BATCH5E1A_EXPECTED_LIFECYCLE_REVISION, 6);
});

test('placeholder document precondition accepts the audited exact snapshot and rejects any semantic drift', () => {
  const entry = normalization.BATCH5E1A_PLACEHOLDER_MANIFEST.find((row) => row.docId === '伊啵站前店_2026_9');
  const master = makeLifecycleMaster();

  const accepted = normalization.inspectPlaceholderDocument({
    docId: entry.docId,
    data: exactPlaceholderData(entry),
    manifestEntry: entry,
    lifecycleMaster: master,
    lifecycleApi,
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.errors, []);

  const changedTarget = normalization.inspectPlaceholderDocument({
    docId: entry.docId,
    data: { ...exactPlaceholderData(entry), cashTarget: 1 },
    manifestEntry: entry,
    lifecycleMaster: master,
    lifecycleApi,
  });
  assert.equal(changedTarget.ok, false);
  assert.ok(changedTarget.errors.includes('CASH_TARGET_NOT_EXPLICIT_ZERO'));

  const extraField = normalization.inspectPlaceholderDocument({
    docId: entry.docId,
    data: { ...exactPlaceholderData(entry), note: 'new data' },
    manifestEntry: entry,
    lifecycleMaster: master,
    lifecycleApi,
  });
  assert.equal(extraField.ok, false);
  assert.ok(extraField.errors.includes('DOCUMENT_SHAPE_DRIFT'));

  const changedActor = normalization.inspectPlaceholderDocument({
    docId: entry.docId,
    data: { ...exactPlaceholderData(entry), updatedBy: 'Someone Else' },
    manifestEntry: entry,
    lifecycleMaster: master,
    lifecycleApi,
  });
  assert.equal(changedActor.ok, false);
  assert.ok(changedActor.errors.includes('UPDATED_BY_DRIFT'));

  const changedLifecycle = normalization.inspectPlaceholderDocument({
    docId: entry.docId,
    data: exactPlaceholderData(entry),
    manifestEntry: entry,
    lifecycleMaster: { ...master, revision: 7 },
    lifecycleApi,
  });
  assert.equal(changedLifecycle.ok, false);
  assert.ok(changedLifecycle.errors.includes('LIFECYCLE_REVISION_DRIFT'));
});

test('live set precondition aborts if any manifest doc disappears or any unexpected explicit zero appears', () => {
  const manifest = normalization.BATCH5E1A_PLACEHOLDER_MANIFEST;
  const docs = new Map(manifest.map((entry) => [entry.docId, exactPlaceholderData(entry)]));
  const good = normalization.buildLiveSetPrecondition({
    cashZeroSnap: fakeSnap(docs),
    accrualZeroSnap: fakeSnap(docs),
    lifecycleMaster: makeLifecycleMaster(),
    lifecycleApi,
  });
  assert.equal(good.safe, true);
  assert.equal(good.liveCount, 27);

  const missingDocs = new Map(docs);
  missingDocs.delete(manifest[0].docId);
  const missing = normalization.buildLiveSetPrecondition({
    cashZeroSnap: fakeSnap(missingDocs),
    accrualZeroSnap: fakeSnap(missingDocs),
    lifecycleMaster: makeLifecycleMaster(),
    lifecycleApi,
  });
  assert.equal(missing.safe, false);
  assert.deepEqual(missing.missingIds, [manifest[0].docId]);

  const unexpectedDocs = new Map(docs);
  unexpectedDocs.set('伊啵未知店_2026_9', {
    cashTarget: 0, accrualTarget: 0, challengeCashTarget: 0, challengeAccrualTarget: 0,
    isUnlocked: false, updatedAt: '2026-08-31T00:00:00.000Z', updatedBy: 'x',
  });
  const unexpected = normalization.buildLiveSetPrecondition({
    cashZeroSnap: fakeSnap(unexpectedDocs),
    accrualZeroSnap: fakeSnap(unexpectedDocs),
    lifecycleMaster: makeLifecycleMaster(),
    lifecycleApi,
  });
  assert.equal(unexpected.safe, false);
  assert.deepEqual(unexpected.unexpectedIds, ['伊啵未知店_2026_9']);
});

test('summary safety probe blocks execute when a placeholder also exists in a legacy target container', () => {
  const safe = normalization.buildSummarySafetyProbe({
    yearMonth: '2026-09',
    summaryData: {
      targets: {
        伊啵站前店: { storeName: '伊啵站前店', cashTarget: 0, accrualTarget: 0, sourceDocId: '伊啵站前店_2026_9' },
      },
    },
  });
  assert.equal(safe.safeForExistingDeleteTrigger, true);
  assert.equal(safe.nonCanonicalContainerMatches.length, 0);

  const unsafe = normalization.buildSummarySafetyProbe({
    yearMonth: '2026-09',
    summaryData: {
      targets: {
        伊啵站前店: { storeName: '伊啵站前店', cashTarget: 0, accrualTarget: 0, sourceDocId: '伊啵站前店_2026_9' },
      },
      stores: {
        伊啵站前店: { storeName: '伊啵站前店', cashTarget: 0, accrualTarget: 0 },
      },
    },
  });
  assert.equal(unsafe.safeForExistingDeleteTrigger, false);
  assert.equal(unsafe.nonCanonicalContainerMatches.length, 1);
  assert.equal(unsafe.nonCanonicalContainerMatches[0].containerName, 'stores');
});

test('derived repair plan removes only audited stale target rows and rejects semantic drift or legacy resurrection', () => {
  const safe = normalization.buildDerivedSummaryRepairPlan({
    yearMonth: '2026-09',
    summaryData: {
      targets: {
        伊啵園區店: { storeName: '伊啵園區店', cashTarget: 400000, accrualTarget: 400000, sourceDocId: '伊啵園區店_2026_9' },
        伊啵中山店: { storeName: '伊啵中山店', cashTarget: 0, accrualTarget: 0, challengeCashTarget: 0, challengeAccrualTarget: 0, isUnlocked: false, sourceDocId: '伊啵中山店_2026_9' },
        伊啵天母店: { storeName: '伊啵天母店', cashTarget: 0, accrualTarget: 0, challengeCashTarget: 0, challengeAccrualTarget: 0, isUnlocked: false, sourceDocId: '伊啵天母店_2026_9' },
        伊啵新莊店: { storeName: '伊啵新莊店', cashTarget: 0, accrualTarget: 0, challengeCashTarget: 0, challengeAccrualTarget: 0, isUnlocked: false, sourceDocId: '伊啵新莊店_2026_9' },
        伊啵站前店: { storeName: '伊啵站前店', cashTarget: 0, accrualTarget: 0, challengeCashTarget: 0, challengeAccrualTarget: 0, isUnlocked: false, sourceDocId: '伊啵站前店' },
      },
    },
  });
  assert.equal(safe.safe, true);
  assert.equal(safe.removedStoreCount, 4);
  assert.deepEqual(Object.keys(safe.nextTargetMap), ['伊啵園區店']);

  const drift = normalization.buildDerivedSummaryRepairPlan({
    yearMonth: '2026-09',
    summaryData: {
      targets: {
        伊啵中山店: { storeName: '伊啵中山店', cashTarget: 500000, accrualTarget: 0, challengeCashTarget: 0, challengeAccrualTarget: 0, isUnlocked: false, sourceDocId: '伊啵中山店_2026_9' },
      },
    },
  });
  assert.equal(drift.safe, false);
  assert.ok(drift.errors.some((code) => code.includes('SUMMARY_CASH_TARGET_NOT_ZERO')));

  const legacy = normalization.buildDerivedSummaryRepairPlan({
    yearMonth: '2026-09',
    summaryData: {
      targets: {},
      stores: {
        伊啵中山店: { storeName: '伊啵中山店', cashTarget: 0, accrualTarget: 0, challengeCashTarget: 0, challengeAccrualTarget: 0, isUnlocked: false },
      },
    },
  });
  assert.equal(legacy.safe, false);
  assert.ok(legacy.errors.includes('LEGACY_SUMMARY_CONTAINER_MATCH'));
});

test('post-delete repair precondition requires all 27 exact Raw manifest documents to remain absent', () => {
  const absent = normalization.BATCH5E1A_PLACEHOLDER_MANIFEST.map((entry) => fakeDocSnap(entry.docId, false));
  const good = normalization.buildManifestAbsencePrecondition(absent);
  assert.equal(good.safe, true);
  assert.deepEqual(good.existingIds, []);

  const recreated = [...absent];
  recreated[0] = fakeDocSnap(normalization.BATCH5E1A_PLACEHOLDER_MANIFEST[0].docId, true, { cashTarget: 500000 });
  const blocked = normalization.buildManifestAbsencePrecondition(recreated);
  assert.equal(blocked.safe, false);
  assert.deepEqual(blocked.existingIds, [normalization.BATCH5E1A_PLACEHOLDER_MANIFEST[0].docId]);
});

test('derived repair candidate rebuilds Coverage and expected persisted signature before any write', () => {
  const serverTimestamp = () => ({ __serverTimestamp: true });
  const candidate = normalization.buildDerivedRepairCandidate({
    admin: { firestore: { FieldValue: { serverTimestamp } } },
    yearMonth: '2026-09',
    lifecycleMaster: {
      ...makeLifecycleMaster(),
      stores: {
        ...makeLifecycleMaster().stores,
        園區: { firstEligibleMonth: '2026-04', openDate: '2026-04-01', exemptMonths: [] },
      },
    },
    lifecycleApi,
    nowText: '2026-08-31T00:00:00.000Z',
    summaryData: {
      targets: {
        伊啵園區店: { storeName: '伊啵園區店', cashTarget: 400000, accrualTarget: 400000, sourceDocId: '伊啵園區店_2026_9' },
        伊啵中山店: { storeName: '伊啵中山店', cashTarget: 0, accrualTarget: 0, challengeCashTarget: 0, challengeAccrualTarget: 0, isUnlocked: false, sourceDocId: '伊啵中山店_2026_9' },
        伊啵天母店: { storeName: '伊啵天母店', cashTarget: 0, accrualTarget: 0, challengeCashTarget: 0, challengeAccrualTarget: 0, isUnlocked: false, sourceDocId: '伊啵天母店_2026_9' },
        伊啵新莊店: { storeName: '伊啵新莊店', cashTarget: 0, accrualTarget: 0, challengeCashTarget: 0, challengeAccrualTarget: 0, isUnlocked: false, sourceDocId: '伊啵新莊店_2026_9' },
        伊啵站前店: { storeName: '伊啵站前店', cashTarget: 0, accrualTarget: 0, challengeCashTarget: 0, challengeAccrualTarget: 0, isUnlocked: false, sourceDocId: '伊啵站前店' },
      },
    },
  });

  assert.equal(candidate.safe, true);
  assert.equal(candidate.needsWrite, true);
  assert.equal(candidate.verification.ok, true);
  assert.deepEqual(Object.keys(candidate.replacementDocument.targets), ['伊啵園區店']);
  assert.equal(candidate.replacementDocument.storeCount, 1);
  assert.equal(candidate.replacementDocument.cashConfiguredStoreCount, 1);
  assert.deepEqual(candidate.replacementDocument.cashMissingStores.sort(), ['伊啵中山店', '伊啵天母店', '伊啵新莊店', '伊啵站前店'].sort());
});

test('post-cleanup verifier requires placeholder rows gone while preserving lifecycle coverage and target totals', () => {
  const result = normalization.comparePostCleanupSummary({
    yearMonth: '2026-09',
    summaryData: {
      targets: {
        伊啵園區店: {
          storeName: '伊啵園區店',
          cashTarget: 400000,
          accrualTarget: 400000,
          sourceDocId: '伊啵園區店_2026_9',
        },
      },
      eligibleStoreCount: 5,
      cashConfiguredStoreCount: 1,
      accrualConfiguredStoreCount: 1,
      cashCoverageComplete: false,
      accrualCoverageComplete: false,
      cashMissingStores: ['伊啵中山店', '伊啵天母店', '伊啵站前店', '伊啵新莊店'],
      accrualMissingStores: ['伊啵中山店', '伊啵天母店', '伊啵站前店', '伊啵新莊店'],
      cashTargetTotal: 400000,
      accrualTargetTotal: 400000,
      storeCount: 1,
      targetCount: 1,
      sourceDocCount: 1,
      targetAudit: { issueCount: 0, zeroBaseTargets: [] },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('current formal TargetView no longer creates numeric-zero placeholders and backend onWrite supports canonical delete propagation', () => {
  assert.match(targetView, /cashTarget:\s*cashResult\.valid \? cashResult\.value : deleteField\(\)/);
  assert.match(targetView, /accrualTarget:\s*accrualResult\.valid \? accrualResult\.value : deleteField\(\)/);
  assert.doesNotMatch(targetView, /parseNumber\(item\.cashTarget\)/);
  assert.doesNotMatch(targetView, /parseNumber\(item\.accrualTarget\)/);

  assert.match(targetCoverage, /\.onWrite\(\(change, context\) => handleMonthlyTargetWrite/);
  assert.match(targetCoverage, /targetData:\s*afterExists \? \(afterData \|\| \{\}\) : null/);
  assert.match(targetCoverage, /delete targetMap\[identity\.canonicalStoreName\]/);
  assert.match(targetCoverage, /transaction\.set\(summaryRef/);
  assert.doesNotMatch(targetCoverage, /collection\(['"]monthly_targets['"]\)\.get\s*\(/);
});

test('normalization endpoint is backend secured, Yibo-only, atomic, and repairs only the bounded 11 derived summaries after Raw absence', () => {
  assert.match(source, /requireFirebaseRequestAuth/);
  assert.match(source, /verifySuperAdminActor/);
  assert.match(source, /brandId !== BATCH5E1A_TARGET_BRAND/);
  assert.match(source, /db\.runTransaction/);
  assert.match(source, /transaction\.get\(cashZeroQuery\)/);
  assert.match(source, /transaction\.get\(accrualZeroQuery\)/);
  assert.match(source, /transaction\.get\(lifecycleRef\)/);
  assert.match(source, /summarySnaps\.push\(await transaction\.get\(summaryCollection\.doc\(yearMonth\)\)\)/);
  assert.match(source, /BATCH5E1A_PRECONDITION_DRIFT/);
  assert.match(source, /transaction\.delete\(targetCollection\.doc\(entry\.docId\)\)/);
  assert.match(source, /rawManifestSnaps\.push\(await transaction\.get\(targetCollection\.doc\(entry\.docId\)\)\)/);
  assert.match(source, /transaction\.set\(summarySnaps\[index\]\.ref, candidate\.replacementDocument, \{ merge: false \}\)/);
  assert.match(source, /derived_summary_repair/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /onSchedule/);
});

test('execute requires two explicit gates and dry-run/verify are write-free modes', () => {
  assert.match(source, /body\.execute !== true/);
  assert.match(source, /BATCH5E1A_EXECUTION_CONFIRMATION/);
  assert.match(source, /mode === 'dry_run'/);
  assert.match(source, /mode === 'verify'/);
  assert.match(source, /firestoreWrites:\s*0/);

  assert.match(client, /mode === 'execute'/);
  assert.match(client, /args\.execute !== true/);
  assert.match(client, /EXECUTION_CONFIRMATION/);
  assert.match(client, /dry-run/);
  assert.match(client, /Firestore writes: 0 \(dry-run contract\)/);
  assert.match(client, /Firestore writes: 0 \(verify contract\)/);
});

test('functions index exports only one scoped 5E-1A administrative endpoint for this batch', () => {
  assert.match(functionsIndex, /createZeroTargetNormalizationFunctions/);
  assert.match(functionsIndex, /exports\.normalizeLegacyZeroTargetPlaceholders = zeroTargetNormalizationFunctions\.normalizeLegacyZeroTargetPlaceholders/);
});
