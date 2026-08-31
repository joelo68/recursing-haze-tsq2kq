
const {
  TARGET_COVERAGE_SOURCE,
  normalizeTargetCoverageBrandId,
  extractTargetIdentity,
  extractSummaryTargetMap,
  buildIndependentCoverage,
  buildTargetSummaryReplacementDocument,
  getTargetCoveragePaths,
} = require('./targetCoverage');
const {
  buildZeroTargetInventoryRecord,
  buildLifecycleObservation,
  isExplicitNumericZero,
} = require('./zeroTargetInventory');

const BATCH5E1A_NORMALIZATION_VERSION = 'batch5e1a-yibo-placeholder-normalization-v1';
const BATCH5E1A_TARGET_BRAND = 'yibo';
const BATCH5E1A_EXPECTED_LIFECYCLE_REVISION = 6;
const BATCH5E1A_EXECUTION_CONFIRMATION = 'BATCH5E1A_DELETE_27_YIBO_LEGACY_ZERO_PLACEHOLDERS';

const BATCH5E1A_PLACEHOLDER_MANIFEST = Object.freeze([
  {
    "docId": "伊啵新莊店_2026_1",
    "yearMonth": "2026-01",
    "canonicalStoreName": "伊啵新莊店",
    "expectedUpdatedAtText": "2026-08-01T05:14:56.856Z",
    "expectedUpdatedBy": "Abby",
    "expectedLifecycleRelation": "PRE_ELIGIBLE"
  },
  {
    "docId": "伊啵站前店_2026_1",
    "yearMonth": "2026-01",
    "canonicalStoreName": "伊啵站前店",
    "expectedUpdatedAtText": "2026-08-04T04:24:35.122Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "PRE_ELIGIBLE"
  },
  {
    "docId": "伊啵新莊店_2026_2",
    "yearMonth": "2026-02",
    "canonicalStoreName": "伊啵新莊店",
    "expectedUpdatedAtText": "2026-08-01T05:14:56.857Z",
    "expectedUpdatedBy": "Abby",
    "expectedLifecycleRelation": "PRE_ELIGIBLE"
  },
  {
    "docId": "伊啵站前店_2026_2",
    "yearMonth": "2026-02",
    "canonicalStoreName": "伊啵站前店",
    "expectedUpdatedAtText": "2026-08-04T04:24:35.122Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "PRE_ELIGIBLE"
  },
  {
    "docId": "伊啵新莊店_2026_3",
    "yearMonth": "2026-03",
    "canonicalStoreName": "伊啵新莊店",
    "expectedUpdatedAtText": "2026-08-01T05:14:56.857Z",
    "expectedUpdatedBy": "Abby",
    "expectedLifecycleRelation": "PRE_ELIGIBLE"
  },
  {
    "docId": "伊啵站前店_2026_3",
    "yearMonth": "2026-03",
    "canonicalStoreName": "伊啵站前店",
    "expectedUpdatedAtText": "2026-08-04T04:24:35.122Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "PRE_ELIGIBLE"
  },
  {
    "docId": "伊啵新莊店_2026_4",
    "yearMonth": "2026-04",
    "canonicalStoreName": "伊啵新莊店",
    "expectedUpdatedAtText": "2026-08-01T05:14:56.858Z",
    "expectedUpdatedBy": "Abby",
    "expectedLifecycleRelation": "PRE_ELIGIBLE"
  },
  {
    "docId": "伊啵站前店_2026_4",
    "yearMonth": "2026-04",
    "canonicalStoreName": "伊啵站前店",
    "expectedUpdatedAtText": "2026-08-04T04:24:35.122Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "PRE_ELIGIBLE"
  },
  {
    "docId": "伊啵站前店_2026_5",
    "yearMonth": "2026-05",
    "canonicalStoreName": "伊啵站前店",
    "expectedUpdatedAtText": "2026-08-04T04:24:35.122Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "PRE_ELIGIBLE"
  },
  {
    "docId": "伊啵站前店_2026_6",
    "yearMonth": "2026-06",
    "canonicalStoreName": "伊啵站前店",
    "expectedUpdatedAtText": "2026-08-04T04:24:35.122Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "PRE_ELIGIBLE"
  },
  {
    "docId": "伊啵站前店_2026_7",
    "yearMonth": "2026-07",
    "canonicalStoreName": "伊啵站前店",
    "expectedUpdatedAtText": "2026-08-04T04:24:35.122Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "PRE_ELIGIBLE"
  },
  {
    "docId": "伊啵中山店_2026_9",
    "yearMonth": "2026-09",
    "canonicalStoreName": "伊啵中山店",
    "expectedUpdatedAtText": "2026-08-04T04:24:10.216Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵天母店_2026_9",
    "yearMonth": "2026-09",
    "canonicalStoreName": "伊啵天母店",
    "expectedUpdatedAtText": "2026-08-04T04:24:21.881Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵新莊店_2026_9",
    "yearMonth": "2026-09",
    "canonicalStoreName": "伊啵新莊店",
    "expectedUpdatedAtText": "2026-08-01T05:14:56.858Z",
    "expectedUpdatedBy": "Abby",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵站前店_2026_9",
    "yearMonth": "2026-09",
    "canonicalStoreName": "伊啵站前店",
    "expectedUpdatedAtText": "2026-08-04T04:24:35.123Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵中山店_2026_10",
    "yearMonth": "2026-10",
    "canonicalStoreName": "伊啵中山店",
    "expectedUpdatedAtText": "2026-08-04T04:24:10.216Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵天母店_2026_10",
    "yearMonth": "2026-10",
    "canonicalStoreName": "伊啵天母店",
    "expectedUpdatedAtText": "2026-08-04T04:24:21.881Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵新莊店_2026_10",
    "yearMonth": "2026-10",
    "canonicalStoreName": "伊啵新莊店",
    "expectedUpdatedAtText": "2026-08-01T05:14:56.858Z",
    "expectedUpdatedBy": "Abby",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵站前店_2026_10",
    "yearMonth": "2026-10",
    "canonicalStoreName": "伊啵站前店",
    "expectedUpdatedAtText": "2026-08-04T04:24:35.123Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵中山店_2026_11",
    "yearMonth": "2026-11",
    "canonicalStoreName": "伊啵中山店",
    "expectedUpdatedAtText": "2026-08-04T04:24:10.216Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵天母店_2026_11",
    "yearMonth": "2026-11",
    "canonicalStoreName": "伊啵天母店",
    "expectedUpdatedAtText": "2026-08-04T04:24:21.881Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵新莊店_2026_11",
    "yearMonth": "2026-11",
    "canonicalStoreName": "伊啵新莊店",
    "expectedUpdatedAtText": "2026-08-01T05:14:56.859Z",
    "expectedUpdatedBy": "Abby",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵站前店_2026_11",
    "yearMonth": "2026-11",
    "canonicalStoreName": "伊啵站前店",
    "expectedUpdatedAtText": "2026-08-04T04:24:35.123Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵中山店_2026_12",
    "yearMonth": "2026-12",
    "canonicalStoreName": "伊啵中山店",
    "expectedUpdatedAtText": "2026-08-04T04:24:10.216Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵天母店_2026_12",
    "yearMonth": "2026-12",
    "canonicalStoreName": "伊啵天母店",
    "expectedUpdatedAtText": "2026-08-04T04:24:21.881Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵新莊店_2026_12",
    "yearMonth": "2026-12",
    "canonicalStoreName": "伊啵新莊店",
    "expectedUpdatedAtText": "2026-08-01T05:14:56.859Z",
    "expectedUpdatedBy": "Abby",
    "expectedLifecycleRelation": "ELIGIBLE"
  },
  {
    "docId": "伊啵站前店_2026_12",
    "yearMonth": "2026-12",
    "canonicalStoreName": "伊啵站前店",
    "expectedUpdatedAtText": "2026-08-04T04:24:35.123Z",
    "expectedUpdatedBy": "Joe 總經理",
    "expectedLifecycleRelation": "ELIGIBLE"
  }
]);

const BATCH5E1A_EXPECTED_COVERAGE = Object.freeze({
  "2026-01": {
    "eligibleStoreCount": 0,
    "cashConfiguredStoreCount": 0,
    "accrualConfiguredStoreCount": 0,
    "cashCoverageComplete": true,
    "accrualCoverageComplete": true,
    "cashMissingStores": [],
    "accrualMissingStores": [],
    "cashTargetTotal": 1300000,
    "accrualTargetTotal": 1300000,
    "expectedPostCleanupStoreCount": 3,
    "expectedPostCleanupTargetCount": 3,
    "expectedPostCleanupSourceDocCount": 3
  },
  "2026-02": {
    "eligibleStoreCount": 0,
    "cashConfiguredStoreCount": 0,
    "accrualConfiguredStoreCount": 0,
    "cashCoverageComplete": true,
    "accrualCoverageComplete": true,
    "cashMissingStores": [],
    "accrualMissingStores": [],
    "cashTargetTotal": 1300000,
    "accrualTargetTotal": 1300000,
    "expectedPostCleanupStoreCount": 3,
    "expectedPostCleanupTargetCount": 3,
    "expectedPostCleanupSourceDocCount": 3
  },
  "2026-03": {
    "eligibleStoreCount": 0,
    "cashConfiguredStoreCount": 0,
    "accrualConfiguredStoreCount": 0,
    "cashCoverageComplete": true,
    "accrualCoverageComplete": true,
    "cashMissingStores": [],
    "accrualMissingStores": [],
    "cashTargetTotal": 1300000,
    "accrualTargetTotal": 1300000,
    "expectedPostCleanupStoreCount": 3,
    "expectedPostCleanupTargetCount": 3,
    "expectedPostCleanupSourceDocCount": 3
  },
  "2026-04": {
    "eligibleStoreCount": 2,
    "cashConfiguredStoreCount": 2,
    "accrualConfiguredStoreCount": 2,
    "cashCoverageComplete": true,
    "accrualCoverageComplete": true,
    "cashMissingStores": [],
    "accrualMissingStores": [],
    "cashTargetTotal": 1300000,
    "accrualTargetTotal": 1300000,
    "expectedPostCleanupStoreCount": 3,
    "expectedPostCleanupTargetCount": 3,
    "expectedPostCleanupSourceDocCount": 3
  },
  "2026-05": {
    "eligibleStoreCount": 4,
    "cashConfiguredStoreCount": 4,
    "accrualConfiguredStoreCount": 4,
    "cashCoverageComplete": true,
    "accrualCoverageComplete": true,
    "cashMissingStores": [],
    "accrualMissingStores": [],
    "cashTargetTotal": 1600000,
    "accrualTargetTotal": 1600000,
    "expectedPostCleanupStoreCount": 4,
    "expectedPostCleanupTargetCount": 4,
    "expectedPostCleanupSourceDocCount": 4
  },
  "2026-06": {
    "eligibleStoreCount": 4,
    "cashConfiguredStoreCount": 4,
    "accrualConfiguredStoreCount": 4,
    "cashCoverageComplete": true,
    "accrualCoverageComplete": true,
    "cashMissingStores": [],
    "accrualMissingStores": [],
    "cashTargetTotal": 1700000,
    "accrualTargetTotal": 1700000,
    "expectedPostCleanupStoreCount": 4,
    "expectedPostCleanupTargetCount": 4,
    "expectedPostCleanupSourceDocCount": 4
  },
  "2026-07": {
    "eligibleStoreCount": 4,
    "cashConfiguredStoreCount": 4,
    "accrualConfiguredStoreCount": 4,
    "cashCoverageComplete": true,
    "accrualCoverageComplete": true,
    "cashMissingStores": [],
    "accrualMissingStores": [],
    "cashTargetTotal": 1700000,
    "accrualTargetTotal": 1700000,
    "expectedPostCleanupStoreCount": 4,
    "expectedPostCleanupTargetCount": 4,
    "expectedPostCleanupSourceDocCount": 4
  },
  "2026-09": {
    "eligibleStoreCount": 5,
    "cashConfiguredStoreCount": 1,
    "accrualConfiguredStoreCount": 1,
    "cashCoverageComplete": false,
    "accrualCoverageComplete": false,
    "cashMissingStores": [
      "伊啵中山店",
      "伊啵天母店",
      "伊啵新莊店",
      "伊啵站前店"
    ],
    "accrualMissingStores": [
      "伊啵中山店",
      "伊啵天母店",
      "伊啵新莊店",
      "伊啵站前店"
    ],
    "cashTargetTotal": 400000,
    "accrualTargetTotal": 400000,
    "expectedPostCleanupStoreCount": 1,
    "expectedPostCleanupTargetCount": 1,
    "expectedPostCleanupSourceDocCount": 1
  },
  "2026-10": {
    "eligibleStoreCount": 5,
    "cashConfiguredStoreCount": 1,
    "accrualConfiguredStoreCount": 1,
    "cashCoverageComplete": false,
    "accrualCoverageComplete": false,
    "cashMissingStores": [
      "伊啵中山店",
      "伊啵天母店",
      "伊啵新莊店",
      "伊啵站前店"
    ],
    "accrualMissingStores": [
      "伊啵中山店",
      "伊啵天母店",
      "伊啵新莊店",
      "伊啵站前店"
    ],
    "cashTargetTotal": 400000,
    "accrualTargetTotal": 400000,
    "expectedPostCleanupStoreCount": 1,
    "expectedPostCleanupTargetCount": 1,
    "expectedPostCleanupSourceDocCount": 1
  },
  "2026-11": {
    "eligibleStoreCount": 5,
    "cashConfiguredStoreCount": 1,
    "accrualConfiguredStoreCount": 1,
    "cashCoverageComplete": false,
    "accrualCoverageComplete": false,
    "cashMissingStores": [
      "伊啵中山店",
      "伊啵天母店",
      "伊啵新莊店",
      "伊啵站前店"
    ],
    "accrualMissingStores": [
      "伊啵中山店",
      "伊啵天母店",
      "伊啵新莊店",
      "伊啵站前店"
    ],
    "cashTargetTotal": 400000,
    "accrualTargetTotal": 400000,
    "expectedPostCleanupStoreCount": 1,
    "expectedPostCleanupTargetCount": 1,
    "expectedPostCleanupSourceDocCount": 1
  },
  "2026-12": {
    "eligibleStoreCount": 5,
    "cashConfiguredStoreCount": 1,
    "accrualConfiguredStoreCount": 1,
    "cashCoverageComplete": false,
    "accrualCoverageComplete": false,
    "cashMissingStores": [
      "伊啵中山店",
      "伊啵天母店",
      "伊啵新莊店",
      "伊啵站前店"
    ],
    "accrualMissingStores": [
      "伊啵中山店",
      "伊啵天母店",
      "伊啵新莊店",
      "伊啵站前店"
    ],
    "cashTargetTotal": 400000,
    "accrualTargetTotal": 400000,
    "expectedPostCleanupStoreCount": 1,
    "expectedPostCleanupTargetCount": 1,
    "expectedPostCleanupSourceDocCount": 1
  }
});

const SUMMARY_TARGET_CONTAINERS = Object.freeze([
  'targets', 'stores', 'storeTargets', 'storeTargetMap', 'monthlyTargets', 'targetStores',
  'items', 'data', 'byStore', 'storeMap', 'storesMap', 'summaryByStore', 'storeSummaries',
]);

const EXPECTED_PLACEHOLDER_FIELDS = Object.freeze([
  'accrualTarget',
  'cashTarget',
  'challengeAccrualTarget',
  'challengeCashTarget',
  'isUnlocked',
  'updatedAt',
  'updatedBy',
]);

function normalizeAuditText(value = '') {
  if (!value) return '';
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?.seconds === 'number') return new Date(Number(value.seconds) * 1000).toISOString();
  return String(value || '');
}

function sortedStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || '')).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function exactStringArrayEqual(a = [], b = []) {
  const left = sortedStrings(a);
  const right = sortedStrings(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getManifestById() {
  return new Map(BATCH5E1A_PLACEHOLDER_MANIFEST.map((entry) => [entry.docId, entry]));
}

function getAffectedMonths() {
  return sortedStrings(BATCH5E1A_PLACEHOLDER_MANIFEST.map((entry) => entry.yearMonth));
}

function inspectPlaceholderDocument({ docId = '', data = {}, manifestEntry = null, lifecycleMaster = {}, lifecycleApi = {} } = {}) {
  const errors = [];
  if (!manifestEntry) return { ok: false, errors: ['DOC_NOT_IN_MANIFEST'], docId };

  const identity = extractTargetIdentity(docId, data, BATCH5E1A_TARGET_BRAND);
  const record = buildZeroTargetInventoryRecord({ brandId: BATCH5E1A_TARGET_BRAND, docId, data });
  const lifecycle = buildLifecycleObservation(record, lifecycleMaster, lifecycleApi);
  const fieldNames = Object.keys(data || {}).sort((a, b) => a.localeCompare(b, 'en'));

  if (String(docId) !== String(manifestEntry.docId)) errors.push('DOC_ID_MISMATCH');
  if (identity.canonicalTargetId !== String(docId)) errors.push('NOT_CANONICAL_TARGET_ID');
  if (record.canonicalStoreName !== manifestEntry.canonicalStoreName) errors.push('CANONICAL_STORE_MISMATCH');
  if (record.yearMonth !== manifestEntry.yearMonth) errors.push('YEAR_MONTH_MISMATCH');

  if (!isExplicitNumericZero(data.cashTarget)) errors.push('CASH_TARGET_NOT_EXPLICIT_ZERO');
  if (!isExplicitNumericZero(data.accrualTarget)) errors.push('ACCRUAL_TARGET_NOT_EXPLICIT_ZERO');
  if (!isExplicitNumericZero(data.challengeCashTarget)) errors.push('CHALLENGE_CASH_NOT_ZERO');
  if (!isExplicitNumericZero(data.challengeAccrualTarget)) errors.push('CHALLENGE_ACCRUAL_NOT_ZERO');
  if (data.isUnlocked === true) errors.push('DOCUMENT_UNLOCKED');

  if (!exactStringArrayEqual(fieldNames, EXPECTED_PLACEHOLDER_FIELDS)) errors.push('DOCUMENT_SHAPE_DRIFT');
  if (normalizeAuditText(data.updatedAtText || data.updatedAt || '') !== manifestEntry.expectedUpdatedAtText) errors.push('UPDATED_AT_DRIFT');
  if (String(data.updatedBy || '') !== manifestEntry.expectedUpdatedBy) errors.push('UPDATED_BY_DRIFT');

  if (String(lifecycleMaster?.datasetStatus || '') !== 'READY') errors.push('LIFECYCLE_NOT_READY');
  if (Number(lifecycleMaster?.revision || 0) !== BATCH5E1A_EXPECTED_LIFECYCLE_REVISION) errors.push('LIFECYCLE_REVISION_DRIFT');
  if (lifecycle.lifecycleRelation !== manifestEntry.expectedLifecycleRelation) errors.push('LIFECYCLE_RELATION_DRIFT');

  return {
    ok: errors.length === 0,
    docId,
    yearMonth: record.yearMonth,
    canonicalStoreName: record.canonicalStoreName,
    expectedLifecycleRelation: manifestEntry.expectedLifecycleRelation,
    actualLifecycleRelation: lifecycle.lifecycleRelation,
    updatedAtText: record.updatedAtText,
    updatedBy: record.updatedBy,
    fieldNames,
    errors,
  };
}

function collectQueryDocuments(cashZeroSnap, accrualZeroSnap) {
  const docs = new Map();
  for (const snap of [...(cashZeroSnap?.docs || []), ...(accrualZeroSnap?.docs || [])]) {
    docs.set(snap.id, snap.data() || {});
  }
  return docs;
}

function buildLiveSetPrecondition({ cashZeroSnap, accrualZeroSnap, lifecycleMaster = {}, lifecycleApi = {} } = {}) {
  const manifestById = getManifestById();
  const expectedIds = sortedStrings([...manifestById.keys()]);
  const liveDocs = collectQueryDocuments(cashZeroSnap, accrualZeroSnap);
  const liveIds = sortedStrings([...liveDocs.keys()]);
  const missingIds = expectedIds.filter((id) => !liveDocs.has(id));
  const unexpectedIds = liveIds.filter((id) => !manifestById.has(id));

  const inspections = expectedIds
    .filter((id) => liveDocs.has(id))
    .map((id) => inspectPlaceholderDocument({
      docId: id,
      data: liveDocs.get(id),
      manifestEntry: manifestById.get(id),
      lifecycleMaster,
      lifecycleApi,
    }));

  const failedInspections = inspections.filter((row) => !row.ok);
  const lifecycleOk = String(lifecycleMaster?.datasetStatus || '') === 'READY'
    && Number(lifecycleMaster?.revision || 0) === BATCH5E1A_EXPECTED_LIFECYCLE_REVISION;

  return {
    safe: missingIds.length === 0 && unexpectedIds.length === 0 && failedInspections.length === 0 && lifecycleOk,
    expectedCount: expectedIds.length,
    liveCount: liveIds.length,
    expectedIds,
    liveIds,
    missingIds,
    unexpectedIds,
    lifecycle: {
      datasetStatus: String(lifecycleMaster?.datasetStatus || 'BUILDING'),
      revision: Number(lifecycleMaster?.revision || 0),
      expectedRevision: BATCH5E1A_EXPECTED_LIFECYCLE_REVISION,
      ok: lifecycleOk,
    },
    inspections,
    failedInspections,
  };
}

function findContainerStoreMatches(summaryData = {}, manifestEntries = [], yearMonth = '') {
  const expectedStoreNames = new Set(manifestEntries.map((entry) => entry.canonicalStoreName));
  const matches = [];

  for (const containerName of SUMMARY_TARGET_CONTAINERS) {
    const container = summaryData?.[containerName];
    if (!container || typeof container !== 'object') continue;
    const entries = Array.isArray(container)
      ? container.map((value, index) => [String(value?.sourceDocId || value?.storeName || value?.id || index), value])
      : Object.entries(container);

    for (const [key, value] of entries) {
      if (!value || typeof value !== 'object') continue;
      const identity = extractTargetIdentity(value.sourceDocId || key, {
        ...value,
        yearMonth: value.yearMonth || yearMonth,
        storeName: value.storeName || value.store || key,
      }, BATCH5E1A_TARGET_BRAND);
      if (!expectedStoreNames.has(identity.canonicalStoreName)) continue;
      matches.push({
        containerName,
        key: String(key),
        canonicalStoreName: identity.canonicalStoreName,
        sourceDocId: String(value.sourceDocId || key || ''),
      });
    }
  }

  return matches;
}

function buildSummarySafetyProbe({ yearMonth = '', summaryData = {} } = {}) {
  const manifestEntries = BATCH5E1A_PLACEHOLDER_MANIFEST.filter((entry) => entry.yearMonth === yearMonth);
  const matches = findContainerStoreMatches(summaryData, manifestEntries, yearMonth);
  const nonCanonicalContainerMatches = matches.filter((row) => row.containerName !== 'targets');

  return {
    yearMonth,
    summaryExists: Boolean(summaryData && Object.keys(summaryData).length > 0),
    matchingRows: matches,
    nonCanonicalContainerMatches,
    safeForExistingDeleteTrigger: nonCanonicalContainerMatches.length === 0,
  };
}

function getCoverageSnapshot(summaryData = {}) {
  const audit = summaryData?.targetAudit && typeof summaryData.targetAudit === 'object' ? summaryData.targetAudit : {};
  return {
    eligibleStoreCount: Number(summaryData?.eligibleStoreCount || 0),
    cashConfiguredStoreCount: Number(summaryData?.cashConfiguredStoreCount || 0),
    accrualConfiguredStoreCount: Number(summaryData?.accrualConfiguredStoreCount || 0),
    cashCoverageComplete: summaryData?.cashCoverageComplete === true,
    accrualCoverageComplete: summaryData?.accrualCoverageComplete === true,
    cashMissingStores: sortedStrings(summaryData?.cashMissingStores || []),
    accrualMissingStores: sortedStrings(summaryData?.accrualMissingStores || []),
    cashTargetTotal: Number(summaryData?.cashTargetTotal || 0),
    accrualTargetTotal: Number(summaryData?.accrualTargetTotal || 0),
    storeCount: Number(summaryData?.storeCount || 0),
    targetCount: Number(summaryData?.targetCount || 0),
    sourceDocCount: Number(summaryData?.sourceDocCount || 0),
    targetAuditIssueCount: Number(audit?.issueCount || 0),
    targetAuditZeroBaseTargets: Array.isArray(audit?.zeroBaseTargets) ? audit.zeroBaseTargets : [],
  };
}

function comparePostCleanupSummary({ yearMonth = '', summaryData = {} } = {}) {
  const expected = BATCH5E1A_EXPECTED_COVERAGE[yearMonth];
  if (!expected) return { ok: false, yearMonth, errors: ['NO_EXPECTED_COVERAGE_SIGNATURE'] };

  const targetMap = extractSummaryTargetMap(summaryData, BATCH5E1A_TARGET_BRAND, yearMonth);
  const placeholderStores = new Set(
    BATCH5E1A_PLACEHOLDER_MANIFEST
      .filter((entry) => entry.yearMonth === yearMonth)
      .map((entry) => entry.canonicalStoreName)
  );
  const lingeringStores = Object.keys(targetMap).filter((storeName) => placeholderStores.has(storeName));
  const containerProbe = buildSummarySafetyProbe({ yearMonth, summaryData });
  const actual = getCoverageSnapshot(summaryData);
  const errors = [];

  for (const key of [
    'eligibleStoreCount',
    'cashConfiguredStoreCount',
    'accrualConfiguredStoreCount',
    'cashCoverageComplete',
    'accrualCoverageComplete',
    'cashTargetTotal',
    'accrualTargetTotal',
  ]) {
    if (actual[key] !== expected[key]) errors.push(`${key}_MISMATCH`);
  }
  if (!exactStringArrayEqual(actual.cashMissingStores, expected.cashMissingStores)) errors.push('CASH_MISSING_STORES_MISMATCH');
  if (!exactStringArrayEqual(actual.accrualMissingStores, expected.accrualMissingStores)) errors.push('ACCRUAL_MISSING_STORES_MISMATCH');
  if (actual.storeCount !== expected.expectedPostCleanupStoreCount) errors.push('STORE_COUNT_MISMATCH');
  if (actual.targetCount !== expected.expectedPostCleanupTargetCount) errors.push('TARGET_COUNT_MISMATCH');
  if (actual.sourceDocCount !== expected.expectedPostCleanupSourceDocCount) errors.push('SOURCE_DOC_COUNT_MISMATCH');
  if (actual.targetAuditIssueCount !== 0) errors.push('TARGET_AUDIT_ISSUES_REMAIN');
  if (actual.targetAuditZeroBaseTargets.length !== 0) errors.push('TARGET_AUDIT_ZERO_REMAINS');
  if (lingeringStores.length > 0) errors.push('PLACEHOLDER_STORE_REMAINS_IN_EXTRACTED_TARGET_MAP');
  if (containerProbe.matchingRows.length > 0) errors.push('PLACEHOLDER_STORE_REMAINS_IN_SUMMARY_CONTAINER');

  return {
    ok: errors.length === 0,
    yearMonth,
    errors,
    expected,
    actual,
    lingeringStores,
    containerProbe,
  };
}

function buildManifestAbsencePrecondition(rawManifestSnaps = []) {
  const existingIds = sortedStrings((rawManifestSnaps || [])
    .filter((snap) => snap?.exists)
    .map((snap) => snap.id));
  return {
    safe: existingIds.length === 0 && rawManifestSnaps.length === BATCH5E1A_PLACEHOLDER_MANIFEST.length,
    expectedCount: BATCH5E1A_PLACEHOLDER_MANIFEST.length,
    checkedCount: rawManifestSnaps.length,
    existingIds,
  };
}

function inspectStaleSummaryPlaceholderRow({ yearMonth = '', entry = null, key = '', row = {} } = {}) {
  const errors = [];
  if (!entry) return { ok: false, errors: ['MANIFEST_ENTRY_REQUIRED'], key };
  if (!row || typeof row !== 'object') return { ok: false, errors: ['SUMMARY_ROW_MISSING'], key };

  const identity = extractTargetIdentity(row.sourceDocId || key || entry.canonicalStoreName, {
    ...row,
    yearMonth,
    storeName: row.storeName || row.store || key || entry.canonicalStoreName,
  }, BATCH5E1A_TARGET_BRAND);

  if (identity.canonicalStoreName !== entry.canonicalStoreName) errors.push('SUMMARY_CANONICAL_STORE_DRIFT');
  if (!isExplicitNumericZero(row.cashTarget)) errors.push('SUMMARY_CASH_TARGET_NOT_ZERO');
  if (!isExplicitNumericZero(row.accrualTarget)) errors.push('SUMMARY_ACCRUAL_TARGET_NOT_ZERO');
  if (!isExplicitNumericZero(row.challengeCashTarget)) errors.push('SUMMARY_CHALLENGE_CASH_NOT_ZERO');
  if (!isExplicitNumericZero(row.challengeAccrualTarget)) errors.push('SUMMARY_CHALLENGE_ACCRUAL_NOT_ZERO');
  if (row.isUnlocked === true) errors.push('SUMMARY_ROW_UNLOCKED');

  return {
    ok: errors.length === 0,
    key: String(key || ''),
    canonicalStoreName: identity.canonicalStoreName,
    sourceDocId: String(row.sourceDocId || key || ''),
    errors,
  };
}

function buildDerivedSummaryRepairPlan({ yearMonth = '', summaryData = {} } = {}) {
  const manifestEntries = BATCH5E1A_PLACEHOLDER_MANIFEST.filter((entry) => entry.yearMonth === yearMonth);
  if (!manifestEntries.length) return { safe: false, yearMonth, errors: ['NO_MANIFEST_ENTRIES_FOR_MONTH'] };
  if (!summaryData || typeof summaryData !== 'object' || Object.keys(summaryData).length === 0) {
    return { safe: false, yearMonth, errors: ['SUMMARY_MISSING'] };
  }

  const probe = buildSummarySafetyProbe({ yearMonth, summaryData });
  const errors = [];
  if (probe.nonCanonicalContainerMatches.length > 0) errors.push('LEGACY_SUMMARY_CONTAINER_MATCH');

  const directTargets = summaryData.targets && typeof summaryData.targets === 'object' && !Array.isArray(summaryData.targets)
    ? summaryData.targets
    : {};
  const nextTargets = { ...directTargets };
  const inspections = [];
  const removedKeys = [];

  for (const entry of manifestEntries) {
    const directMatches = Object.entries(directTargets).filter(([key, row]) => {
      if (!row || typeof row !== 'object') return false;
      const identity = extractTargetIdentity(row.sourceDocId || key, {
        ...row,
        yearMonth,
        storeName: row.storeName || row.store || key,
      }, BATCH5E1A_TARGET_BRAND);
      return identity.canonicalStoreName === entry.canonicalStoreName;
    });

    for (const [key, row] of directMatches) {
      const inspection = inspectStaleSummaryPlaceholderRow({ yearMonth, entry, key, row });
      inspections.push(inspection);
      if (!inspection.ok) {
        errors.push(...inspection.errors.map((code) => `${entry.canonicalStoreName}:${code}`));
        continue;
      }
      delete nextTargets[key];
      removedKeys.push(key);
    }
  }

  const nextSummaryData = { ...summaryData, targets: nextTargets };
  const nextTargetMap = extractSummaryTargetMap(nextSummaryData, BATCH5E1A_TARGET_BRAND, yearMonth);
  const placeholderStores = new Set(manifestEntries.map((entry) => entry.canonicalStoreName));
  const lingeringStores = Object.keys(nextTargetMap).filter((storeName) => placeholderStores.has(storeName));
  if (lingeringStores.length > 0) errors.push('PLACEHOLDER_REMAINS_AFTER_PLANNED_REPAIR');

  return {
    safe: errors.length === 0,
    yearMonth,
    errors,
    removedKeys: sortedStrings(removedKeys),
    removedStoreCount: new Set(inspections.filter((row) => row.ok).map((row) => row.canonicalStoreName)).size,
    inspections,
    lingeringStores,
    nextTargetMap,
    probe,
  };
}

function buildRepairCoveragePatch({ admin, yearMonth = '', lifecycleMaster = {}, lifecycleApi = {}, targetMap = {}, nowText = '' } = {}) {
  const lifecycleReady = String(lifecycleMaster?.datasetStatus || '') === 'READY';
  const getEligibleEntries = lifecycleApi.getLifecycleEligibleStoreEntries;
  if (typeof getEligibleEntries !== 'function') throw new Error('LIFECYCLE_ELIGIBILITY_API_MISSING');
  const eligibleEntries = getEligibleEntries(lifecycleMaster || {}, yearMonth, {
    brandId: BATCH5E1A_TARGET_BRAND,
    requireReady: true,
  });
  const coverage = buildIndependentCoverage({
    targetMap,
    eligibleEntries,
    lifecycleReady,
    normalizeStoreCoreFn: lifecycleApi.normalizeStoreLifecycleCore,
  });
  return {
    brandId: BATCH5E1A_TARGET_BRAND,
    yearMonth,
    ...coverage,
    coverageSource: TARGET_COVERAGE_SOURCE,
    coverageUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    coverageUpdatedAtText: nowText || new Date().toISOString(),
  };
}

function buildDerivedRepairCandidate({ admin, yearMonth = '', summaryData = {}, lifecycleMaster = {}, lifecycleApi = {}, nowText = '' } = {}) {
  const plan = buildDerivedSummaryRepairPlan({ yearMonth, summaryData });
  if (!plan.safe) return { safe: false, yearMonth, plan, errors: [...(plan.errors || [])] };

  const coveragePatch = buildRepairCoveragePatch({
    admin,
    yearMonth,
    lifecycleMaster,
    lifecycleApi,
    targetMap: plan.nextTargetMap,
    nowText,
  });
  const replacementDocument = buildTargetSummaryReplacementDocument({
    summaryData,
    targetMap: plan.nextTargetMap,
    brandId: BATCH5E1A_TARGET_BRAND,
    yearMonth,
    coveragePatch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText,
    updatedBy: 'backend_target_coverage_repair',
  });
  const currentVerification = comparePostCleanupSummary({ yearMonth, summaryData });
  const verification = comparePostCleanupSummary({ yearMonth, summaryData: replacementDocument });

  return {
    safe: verification.ok,
    needsWrite: plan.removedKeys.length > 0 || !currentVerification.ok,
    yearMonth,
    plan,
    replacementDocument,
    currentVerification,
    verification,
    errors: verification.ok ? [] : verification.errors,
  };
}

function createZeroTargetNormalizationFunctions({ admin, db }) {
  const { onRequest } = require('firebase-functions/v2/https');
  const {
    requireFirebaseRequestAuth,
    verifySuperAdminActor,
  } = require('./deviceApproval');
  const lifecycleApi = require('./storeLifecycle');

  const normalizeLegacyZeroTargetPlaceholders = onRequest({ cors: true, timeoutSeconds: 90, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });

    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });

    const body = req.body || {};
    const brandId = normalizeTargetCoverageBrandId(body.brandId);
    if (brandId !== BATCH5E1A_TARGET_BRAND) {
      return res.status(400).json({ ok: false, message: '5E-1A 僅允許伊啵 placeholder cleanup' });
    }

    const adminCheck = await verifySuperAdminActor({ db, brandId, actor: body.actor || {} });
    if (!adminCheck.ok) return res.status(403).json({ ok: false, message: '此工具僅限最高管理者在已信任裝置執行' });

    const mode = String(body.mode || 'dry_run').trim().toLowerCase();
    if (!['dry_run', 'execute', 'verify'].includes(mode)) {
      return res.status(400).json({ ok: false, message: 'unsupported_mode' });
    }

    const paths = getTargetCoveragePaths(brandId);
    const targetCollection = db.collection(paths.monthlyTargets);
    const summaryCollection = db.collection(paths.monthlyTargetSummary);
    const lifecycleRef = db.doc(paths.lifecycleMaster);
    const cashZeroQuery = targetCollection.where('cashTarget', '==', 0);
    const accrualZeroQuery = targetCollection.where('accrualTarget', '==', 0);
    const affectedMonths = getAffectedMonths();

    try {
      if (mode === 'verify') {
        const [cashZeroSnap, accrualZeroSnap, lifecycleSnap, ...summarySnaps] = await Promise.all([
          cashZeroQuery.get(),
          accrualZeroQuery.get(),
          lifecycleRef.get(),
          ...affectedMonths.map((yearMonth) => summaryCollection.doc(yearMonth).get()),
        ]);
        const remainingDocs = collectQueryDocuments(cashZeroSnap, accrualZeroSnap);
        const lifecycleMaster = lifecycleSnap.exists ? (lifecycleSnap.data() || {}) : {};
        const monthResults = summarySnaps.map((snap, index) => comparePostCleanupSummary({
          yearMonth: affectedMonths[index],
          summaryData: snap.exists ? (snap.data() || {}) : {},
        }));
        const verified = remainingDocs.size === 0
          && String(lifecycleMaster?.datasetStatus || '') === 'READY'
          && Number(lifecycleMaster?.revision || 0) === BATCH5E1A_EXPECTED_LIFECYCLE_REVISION
          && monthResults.every((row) => row.ok);

        return res.status(200).json({
          ok: true,
          mode,
          verified,
          normalizationVersion: BATCH5E1A_NORMALIZATION_VERSION,
          brandId,
          remainingExplicitZeroDocIds: sortedStrings([...remainingDocs.keys()]),
          lifecycle: {
            datasetStatus: String(lifecycleMaster?.datasetStatus || 'BUILDING'),
            revision: Number(lifecycleMaster?.revision || 0),
          },
          monthResults,
          readEstimate: {
            securityFirestoreReads: 3,
            cashZeroQueryReads: cashZeroSnap.size,
            accrualZeroQueryReads: accrualZeroSnap.size,
            lifecycleReads: 1,
            summaryPointReads: summarySnaps.length,
            firestoreWrites: 0,
          },
          verifiedAtText: new Date().toISOString(),
        });
      }

      if (mode === 'dry_run') {
        const [cashZeroSnap, accrualZeroSnap, lifecycleSnap, ...summarySnaps] = await Promise.all([
          cashZeroQuery.get(),
          accrualZeroQuery.get(),
          lifecycleRef.get(),
          ...affectedMonths.map((yearMonth) => summaryCollection.doc(yearMonth).get()),
        ]);
        const rawManifestSnaps = await Promise.all(
          BATCH5E1A_PLACEHOLDER_MANIFEST.map((entry) => targetCollection.doc(entry.docId).get())
        );
        const lifecycleMaster = lifecycleSnap.exists ? (lifecycleSnap.data() || {}) : {};
        const liveZeroDocs = collectQueryDocuments(cashZeroSnap, accrualZeroSnap);
        const deletePrecondition = buildLiveSetPrecondition({ cashZeroSnap, accrualZeroSnap, lifecycleMaster, lifecycleApi });
        const summarySafety = summarySnaps.map((snap, index) => buildSummarySafetyProbe({
          yearMonth: affectedMonths[index],
          summaryData: snap.exists ? (snap.data() || {}) : {},
        }));
        const unsafeSummaryMonths = summarySafety.filter((row) => !row.safeForExistingDeleteTrigger || !row.summaryExists);

        let executionPhase = 'raw_placeholder_delete';
        let canExecute = deletePrecondition.safe && unsafeSummaryMonths.length === 0;
        let repairPrecondition = null;
        let repairCandidates = [];

        if (liveZeroDocs.size === 0) {
          executionPhase = 'derived_summary_repair';
          repairPrecondition = buildManifestAbsencePrecondition(rawManifestSnaps);
          const nowText = new Date().toISOString();
          repairCandidates = summarySnaps.map((snap, index) => buildDerivedRepairCandidate({
            admin,
            yearMonth: affectedMonths[index],
            summaryData: snap.exists ? (snap.data() || {}) : {},
            lifecycleMaster,
            lifecycleApi,
            nowText,
          }));
          const lifecycleOk = String(lifecycleMaster?.datasetStatus || '') === 'READY'
            && Number(lifecycleMaster?.revision || 0) === BATCH5E1A_EXPECTED_LIFECYCLE_REVISION;
          canExecute = repairPrecondition.safe
            && lifecycleOk
            && repairCandidates.length === affectedMonths.length
            && repairCandidates.every((row) => row.safe);
        }

        return res.status(200).json({
          ok: true,
          mode,
          canExecute,
          executionPhase,
          normalizationVersion: BATCH5E1A_NORMALIZATION_VERSION,
          brandId,
          manifestCount: BATCH5E1A_PLACEHOLDER_MANIFEST.length,
          precondition: executionPhase === 'raw_placeholder_delete' ? deletePrecondition : repairPrecondition,
          summarySafety,
          unsafeSummaryMonths,
          repairCandidates: repairCandidates.map((row) => ({
            safe: row.safe,
            needsWrite: row.needsWrite,
            yearMonth: row.yearMonth,
            errors: row.errors,
            removedKeys: row.plan?.removedKeys || [],
            currentVerification: row.currentVerification || null,
            verification: row.verification || null,
          })),
          executionConfirmation: canExecute ? BATCH5E1A_EXECUTION_CONFIRMATION : '',
          readEstimate: {
            securityFirestoreReads: 3,
            cashZeroQueryReads: cashZeroSnap.size,
            accrualZeroQueryReads: accrualZeroSnap.size,
            exactManifestPointReads: rawManifestSnaps.length,
            lifecycleReads: 1,
            summaryPointReads: summarySnaps.length,
            firestoreWrites: 0,
          },
          auditedAtText: new Date().toISOString(),
        });
      }

      if (body.execute !== true || String(body.confirmation || '') !== BATCH5E1A_EXECUTION_CONFIRMATION) {
        return res.status(400).json({
          ok: false,
          message: 'execute_requires_exact_confirmation',
          requiredConfirmation: BATCH5E1A_EXECUTION_CONFIRMATION,
        });
      }

      const transactionResult = await db.runTransaction(async (transaction) => {
        // Every execution re-reads query state, exact manifest docs, Lifecycle, and all 11
        // Summary docs inside one transaction. The post-delete recovery path is allowed
        // only when all 27 Raw manifest docs remain absent.
        const cashZeroSnap = await transaction.get(cashZeroQuery);
        const accrualZeroSnap = await transaction.get(accrualZeroQuery);
        const lifecycleSnap = await transaction.get(lifecycleRef);
        const summarySnaps = [];
        for (const yearMonth of affectedMonths) {
          summarySnaps.push(await transaction.get(summaryCollection.doc(yearMonth)));
        }
        const rawManifestSnaps = [];
        for (const entry of BATCH5E1A_PLACEHOLDER_MANIFEST) {
          rawManifestSnaps.push(await transaction.get(targetCollection.doc(entry.docId)));
        }

        const lifecycleMaster = lifecycleSnap.exists ? (lifecycleSnap.data() || {}) : {};
        const lifecycleOk = String(lifecycleMaster?.datasetStatus || '') === 'READY'
          && Number(lifecycleMaster?.revision || 0) === BATCH5E1A_EXPECTED_LIFECYCLE_REVISION;
        const liveZeroDocs = collectQueryDocuments(cashZeroSnap, accrualZeroSnap);

        if (liveZeroDocs.size > 0) {
          const precondition = buildLiveSetPrecondition({ cashZeroSnap, accrualZeroSnap, lifecycleMaster, lifecycleApi });
          const summarySafety = summarySnaps.map((snap, index) => buildSummarySafetyProbe({
            yearMonth: affectedMonths[index],
            summaryData: snap.exists ? (snap.data() || {}) : {},
          }));
          const unsafeSummaryMonths = summarySafety.filter((row) => !row.safeForExistingDeleteTrigger || !row.summaryExists);

          if (!precondition.safe || unsafeSummaryMonths.length > 0) {
            const error = new Error('BATCH5E1A_PRECONDITION_DRIFT');
            error.code = 'BATCH5E1A_PRECONDITION_DRIFT';
            error.precondition = precondition;
            error.summarySafety = summarySafety;
            error.unsafeSummaryMonths = unsafeSummaryMonths;
            throw error;
          }

          for (const entry of BATCH5E1A_PLACEHOLDER_MANIFEST) {
            transaction.delete(targetCollection.doc(entry.docId));
          }

          return {
            phase: 'raw_placeholder_delete',
            precondition,
            summarySafety,
            deletedDocIds: BATCH5E1A_PLACEHOLDER_MANIFEST.map((entry) => entry.docId),
            repairedMonths: [],
          };
        }

        const repairPrecondition = buildManifestAbsencePrecondition(rawManifestSnaps);
        if (!repairPrecondition.safe || !lifecycleOk) {
          const error = new Error('BATCH5E1A_REPAIR_PRECONDITION_DRIFT');
          error.code = 'BATCH5E1A_REPAIR_PRECONDITION_DRIFT';
          error.repairPrecondition = repairPrecondition;
          error.lifecycle = {
            datasetStatus: String(lifecycleMaster?.datasetStatus || 'BUILDING'),
            revision: Number(lifecycleMaster?.revision || 0),
            expectedRevision: BATCH5E1A_EXPECTED_LIFECYCLE_REVISION,
          };
          throw error;
        }

        const nowText = new Date().toISOString();
        const repairCandidates = summarySnaps.map((snap, index) => buildDerivedRepairCandidate({
          admin,
          yearMonth: affectedMonths[index],
          summaryData: snap.exists ? (snap.data() || {}) : {},
          lifecycleMaster,
          lifecycleApi,
          nowText,
        }));
        const unsafeRepairCandidates = repairCandidates.filter((row) => !row.safe);
        if (unsafeRepairCandidates.length > 0) {
          const error = new Error('BATCH5E1A_REPAIR_PRECONDITION_DRIFT');
          error.code = 'BATCH5E1A_REPAIR_PRECONDITION_DRIFT';
          error.repairPrecondition = repairPrecondition;
          error.unsafeRepairCandidates = unsafeRepairCandidates.map((row) => ({
            yearMonth: row.yearMonth,
            errors: row.errors,
            planErrors: row.plan?.errors || [],
          }));
          throw error;
        }

        const repairIndexes = repairCandidates
          .map((candidate, index) => ({ candidate, index }))
          .filter(({ candidate }) => candidate.needsWrite);

        repairIndexes.forEach(({ candidate, index }) => {
          // Full-document replacement is required so stale nested targets.<store> keys
          // are physically removed instead of recursively merged back by Firestore.
          transaction.set(summarySnaps[index].ref, candidate.replacementDocument, { merge: false });
        });

        return {
          phase: repairIndexes.length > 0 ? 'derived_summary_repair' : 'already_repaired',
          repairPrecondition,
          deletedDocIds: [],
          repairedMonths: repairIndexes.map(({ candidate }) => candidate.yearMonth),
          repairResults: repairCandidates.map((row) => ({
            yearMonth: row.yearMonth,
            needsWrite: row.needsWrite,
            removedKeys: row.plan.removedKeys,
            currentVerification: row.currentVerification,
            verification: row.verification,
          })),
        };
      });

      console.info(
        `Batch 5E-1A execution committed: brand=${brandId} phase=${transactionResult.phase} deletes=${transactionResult.deletedDocIds.length} repairedMonths=${transactionResult.repairedMonths.length} actor=${adminCheck.actorName || adminCheck.actorAccountId || 'super_admin'}`
      );

      return res.status(200).json({
        ok: true,
        mode,
        committed: true,
        executionPhase: transactionResult.phase,
        normalizationVersion: BATCH5E1A_NORMALIZATION_VERSION,
        brandId,
        deletedDocIds: transactionResult.deletedDocIds,
        repairedMonths: transactionResult.repairedMonths,
        repairResults: transactionResult.repairResults || [],
        affectedMonths,
        expectedDerivedTriggerFanout: transactionResult.phase === 'raw_placeholder_delete'
          ? transactionResult.deletedDocIds.length
          : 0,
        nextStep: transactionResult.phase === 'raw_placeholder_delete'
          ? 'WAIT_FOR_TARGET_COVERAGE_TRIGGERS_THEN_RUN_VERIFY_ONCE'
          : 'RUN_VERIFY_ONCE',
        writeEstimate: {
          rawTargetDeletes: transactionResult.deletedDocIds.length,
          directSummaryWrites: transactionResult.repairedMonths.length,
          directAuditLogWrites: 0,
          expectedDerivedSummaryWrites: transactionResult.phase === 'raw_placeholder_delete'
            ? transactionResult.deletedDocIds.length
            : 0,
        },
        committedAtText: new Date().toISOString(),
      });
    } catch (error) {
      if (error?.code === 'BATCH5E1A_PRECONDITION_DRIFT') {
        return res.status(409).json({
          ok: false,
          message: 'Production target/lifecycle state changed after audit; cleanup aborted with 0 deletes',
          code: error.code,
          precondition: error.precondition || null,
          summarySafety: error.summarySafety || null,
          unsafeSummaryMonths: error.unsafeSummaryMonths || [],
        });
      }
      if (error?.code === 'BATCH5E1A_REPAIR_PRECONDITION_DRIFT') {
        return res.status(409).json({
          ok: false,
          message: 'Production Raw/Lifecycle/Summary state changed; derived repair aborted with 0 writes',
          code: error.code,
          repairPrecondition: error.repairPrecondition || null,
          lifecycle: error.lifecycle || null,
          unsafeRepairCandidates: error.unsafeRepairCandidates || [],
        });
      }
      console.error('normalizeLegacyZeroTargetPlaceholders failed', error);
      return res.status(500).json({ ok: false, message: '5E-1A placeholder normalization failed' });
    }
  });

  return { normalizeLegacyZeroTargetPlaceholders };
}

module.exports = {
  BATCH5E1A_NORMALIZATION_VERSION,
  BATCH5E1A_TARGET_BRAND,
  BATCH5E1A_EXPECTED_LIFECYCLE_REVISION,
  BATCH5E1A_EXECUTION_CONFIRMATION,
  BATCH5E1A_PLACEHOLDER_MANIFEST,
  BATCH5E1A_EXPECTED_COVERAGE,
  SUMMARY_TARGET_CONTAINERS,
  EXPECTED_PLACEHOLDER_FIELDS,
  normalizeAuditText,
  sortedStrings,
  exactStringArrayEqual,
  getManifestById,
  getAffectedMonths,
  inspectPlaceholderDocument,
  collectQueryDocuments,
  buildLiveSetPrecondition,
  findContainerStoreMatches,
  buildSummarySafetyProbe,
  getCoverageSnapshot,
  comparePostCleanupSummary,
  buildManifestAbsencePrecondition,
  inspectStaleSummaryPlaceholderRow,
  buildDerivedSummaryRepairPlan,
  buildRepairCoveragePatch,
  buildDerivedRepairCandidate,
  createZeroTargetNormalizationFunctions,
};
