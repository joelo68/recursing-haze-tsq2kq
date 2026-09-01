const {
  KPI_CONTRACT_VERSION,
  KPI_VALUE_STATUS,
  inspectKpiNumber,
  validBaseTarget,
  validChallengeTarget,
} = require('./kpiContracts');
const {
  TARGET_AUTHORITY_CONFLICT_STATUS,
  resolveTargetAuthorityConflict,
} = require('./targetAuthorityConflict');

const TARGET_COVERAGE_VERSION = 'target-coverage-v1';
const TARGET_COVERAGE_SOURCE = 'target_coverage_event_v1';
const BRAND_PREFIX = Object.freeze({ cyj: 'CYJ', anniu: '安妞', yibo: '伊啵' });
const SUMMARY_TARGET_CONTAINERS = Object.freeze([
  'targets', 'stores', 'storeTargets', 'storeTargetMap', 'monthlyTargets', 'targetStores',
  'items', 'data', 'byStore', 'storeMap', 'storesMap', 'summaryByStore', 'storeSummaries',
]);

function normalizeTargetCoverageBrandId(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (['cyj', 'default', 'default-app-id', 'drcyj'].includes(text)) return 'cyj';
  if (['anniu', 'anew', '安妞'].includes(text)) return 'anniu';
  if (['yibo', '伊啵'].includes(text)) return 'yibo';
  return '';
}

function normalizeYearMonth(value = '') {
  const text = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : '';
}

function normalizeStoreCore(value = '') {
  let core = String(value || '')
    .trim()
    .replace(/[　\s]+/g, '')
    .replace(/[（）()]/g, '')
    .replace(/臺/g, '台')
    .replace(/^DR\.?CYJ/i, 'CYJ')
    .replace(/^(CYJ|Anew安妞|Yibo伊啵|Anew|Yibo|Ann|安妞|伊啵)/i, '')
    .trim();
  if (!core) return '';
  if (core === '新' || /^新店店?$/.test(core)) return '新店';
  return core.replace(/店+$/g, '').trim();
}

function getCanonicalStoreName(value = '', brandId = 'cyj') {
  const core = normalizeStoreCore(value);
  const normalizedBrandId = normalizeTargetCoverageBrandId(brandId);
  return core && normalizedBrandId ? `${BRAND_PREFIX[normalizedBrandId]}${core}店` : '';
}

function extractTargetIdentity(targetId = '', data = {}, brandId = 'cyj', identityApi = {}) {
  const explicitYearMonth = normalizeYearMonth(data?.yearMonth || '');
  const id = String(targetId || '').trim();
  const match = id.match(/_(20\d{2})_(\d{1,2})$/);
  const yearMonth = explicitYearMonth || (match
    ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
    : '');
  if (!yearMonth) return { yearMonth: '', storeCore: '', canonicalStoreName: '', canonicalTargetId: '' };

  const rawStore = data?.storeName || data?.store || (match ? id.slice(0, match.index) : id);
  const normalizeCore = identityApi.normalizeStoreCore || normalizeStoreCore;
  const canonicalName = identityApi.getCanonicalStoreName || getCanonicalStoreName;
  const storeCore = normalizeCore(rawStore);
  const canonicalStoreName = canonicalName(storeCore, brandId);
  const monthNumber = Number(yearMonth.slice(5, 7));
  return {
    yearMonth,
    storeCore,
    canonicalStoreName,
    canonicalTargetId: canonicalStoreName ? `${canonicalStoreName}_${yearMonth.slice(0, 4)}_${monthNumber}` : '',
  };
}

function getComparableTime(value = {}) {
  const raw = value?.updatedAtText || value?.updatedAt || value?.modifiedAtText || value?.createdAtText || value?.createdAt || '';
  if (!raw) return 0;
  if (typeof raw?.toMillis === 'function') return Number(raw.toMillis()) || 0;
  if (typeof raw?.seconds === 'number') return Number(raw.seconds) * 1000;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : 0;
}

function hasTargetField(value = {}) {
  if (!value || typeof value !== 'object') return false;
  return ['cashTarget', 'accrualTarget', 'challengeCashTarget', 'challengeAccrualTarget']
    .some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function buildTargetSummaryRow(data = {}, canonicalStoreName = '', sourceDocId = '', canonicalTargetId = '') {
  const row = data && typeof data === 'object' ? data : {};
  const resolvedSourceDocId = sourceDocId || row.sourceDocId || '';
  const resolvedCanonicalTargetId = canonicalTargetId || row.canonicalTargetId || '';
  const authorityConflict = row.authorityConflict === true || row.status === TARGET_AUTHORITY_CONFLICT_STATUS;
  const conflictSourceDocIds = authorityConflict
    ? [...new Set((Array.isArray(row.conflictSourceDocIds) ? row.conflictSourceDocIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    : [];

  return {
    storeName: canonicalStoreName,
    cashTarget: authorityConflict ? null : (Object.prototype.hasOwnProperty.call(row, 'cashTarget') ? row.cashTarget : null),
    accrualTarget: authorityConflict ? null : (Object.prototype.hasOwnProperty.call(row, 'accrualTarget') ? row.accrualTarget : null),
    challengeCashTarget: authorityConflict ? null : (Object.prototype.hasOwnProperty.call(row, 'challengeCashTarget') ? row.challengeCashTarget : null),
    challengeAccrualTarget: authorityConflict ? null : (Object.prototype.hasOwnProperty.call(row, 'challengeAccrualTarget') ? row.challengeAccrualTarget : null),
    isUnlocked: authorityConflict ? false : row.isUnlocked === true,
    updatedAtText: row.updatedAtText || row.updatedAt || '',
    updatedBy: row.updatedBy || '',
    sourceDocId: resolvedSourceDocId,
    canonicalTargetId: resolvedCanonicalTargetId,
    isCanonicalSource: authorityConflict ? true : Boolean(resolvedCanonicalTargetId && resolvedSourceDocId === resolvedCanonicalTargetId),
    authorityConflict,
    authorityStatus: authorityConflict ? TARGET_AUTHORITY_CONFLICT_STATUS : '',
    status: authorityConflict ? TARGET_AUTHORITY_CONFLICT_STATUS : String(row.status || ''),
    conflictSourceDocIds,
  };
}

function targetRowScore(row = {}) {
  let score = 0;
  if (validBaseTarget(row.cashTarget).valid) score += 4;
  if (validBaseTarget(row.accrualTarget).valid) score += 4;
  if (inspectKpiNumber(row.challengeCashTarget).status === KPI_VALUE_STATUS.VALID) score += 1;
  if (inspectKpiNumber(row.challengeAccrualTarget).status === KPI_VALUE_STATUS.VALID) score += 1;
  return score;
}

function choosePreferredTargetRow(current = null, next = null) {
  if (!current) return next;
  if (!next) return current;

  const currentCanonical = current.isCanonicalSource === true;
  const nextCanonical = next.isCanonicalSource === true;
  const conflict = resolveTargetAuthorityConflict(current, next, {
    currentAuthoritative: currentCanonical,
    incomingAuthoritative: nextCanonical,
    storeName: current.storeName || next.storeName || '',
    canonicalTargetId: current.canonicalTargetId || next.canonicalTargetId || '',
  });
  if (conflict) return conflict;

  if (currentCanonical !== nextCanonical) return nextCanonical ? next : current;

  const currentScore = targetRowScore(current);
  const nextScore = targetRowScore(next);
  if (currentScore !== nextScore) return nextScore > currentScore ? next : current;
  const currentTime = getComparableTime(current);
  const nextTime = getComparableTime(next);
  if (currentTime !== nextTime) return nextTime > currentTime ? next : current;
  return String(next.sourceDocId || '').localeCompare(String(current.sourceDocId || ''), 'zh-Hant') > 0 ? next : current;
}

function extractSummaryTargetMap(summaryData = {}, brandId = 'cyj', yearMonth = '', identityApi = {}) {
  const result = {};
  const consume = (container) => {
    if (!container) return;
    const entries = Array.isArray(container)
      ? container.map((value, index) => [value?.sourceDocId || value?.storeName || value?.id || String(index), value])
      : (typeof container === 'object' ? Object.entries(container) : []);

    entries.forEach(([key, value]) => {
      if (!value || typeof value !== 'object' || !hasTargetField(value)) return;
      const identity = extractTargetIdentity(value.sourceDocId || key, {
        ...value,
        yearMonth: value.yearMonth || yearMonth,
        storeName: value.storeName || value.store || key,
      }, brandId, identityApi);
      if (!identity.canonicalStoreName) return;
      const row = buildTargetSummaryRow(value, identity.canonicalStoreName, value.sourceDocId || key, identity.canonicalTargetId);
      result[identity.canonicalStoreName] = choosePreferredTargetRow(result[identity.canonicalStoreName], row);
    });
  };

  SUMMARY_TARGET_CONTAINERS.forEach((key) => consume(summaryData?.[key]));
  return result;
}

function stableTargetMap(targetMap = {}) {
  return Object.fromEntries(Object.entries(targetMap || {})
    .sort(([a], [b]) => a.localeCompare(b, 'zh-Hant'))
    .map(([key, row]) => [key, {
      cashTarget: row?.cashTarget ?? null,
      accrualTarget: row?.accrualTarget ?? null,
      challengeCashTarget: row?.challengeCashTarget ?? null,
      challengeAccrualTarget: row?.challengeAccrualTarget ?? null,
      isUnlocked: row?.isUnlocked === true,
      authorityConflict: row?.authorityConflict === true,
      authorityStatus: String(row?.authorityStatus || row?.status || ''),
      canonicalTargetId: String(row?.canonicalTargetId || ''),
      conflictSourceDocIds: Array.isArray(row?.conflictSourceDocIds)
        ? [...row.conflictSourceDocIds].map((value) => String(value || '')).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
        : [],
    }]));
}

function targetMapsEqual(a = {}, b = {}) {
  return JSON.stringify(stableTargetMap(a)) === JSON.stringify(stableTargetMap(b));
}

function buildTargetAudit(targetMap = {}) {
  const authorityConflicts = [];
  const zeroBaseTargets = [];
  const invalidBaseTargets = [];
  const challengeWithoutValidBase = [];
  const challengeNotGreaterThanBase = [];

  Object.entries(targetMap || {}).forEach(([storeName, row = {}]) => {
    if (row?.authorityConflict === true || row?.status === TARGET_AUTHORITY_CONFLICT_STATUS) {
      authorityConflicts.push({
        storeName,
        status: TARGET_AUTHORITY_CONFLICT_STATUS,
        canonicalTargetId: String(row?.canonicalTargetId || ''),
        sourceDocIds: Array.isArray(row?.conflictSourceDocIds)
          ? [...row.conflictSourceDocIds].map((value) => String(value || '')).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
          : [],
      });
      return;
    }

    for (const metric of ['cash', 'accrual']) {
      const baseField = metric === 'cash' ? 'cashTarget' : 'accrualTarget';
      const challengeField = metric === 'cash' ? 'challengeCashTarget' : 'challengeAccrualTarget';
      const baseInspect = inspectKpiNumber(row[baseField]);
      const base = validBaseTarget(row[baseField]);
      const challengeInspect = inspectKpiNumber(row[challengeField]);

      if (baseInspect.status === KPI_VALUE_STATUS.VALID_ZERO) zeroBaseTargets.push({ storeName, metric });
      if (baseInspect.status === KPI_VALUE_STATUS.DATA_INVALID) invalidBaseTargets.push({ storeName, metric });

      const challengeConfigured = challengeInspect.status === KPI_VALUE_STATUS.VALID && Number(challengeInspect.value) > 0;
      if (!challengeConfigured) continue;
      if (!base.valid) challengeWithoutValidBase.push({ storeName, metric });
      else if (!(Number(challengeInspect.value) > Number(base.value))) challengeNotGreaterThanBase.push({ storeName, metric });
    }
  });

  return {
    authorityConflicts,
    zeroBaseTargets,
    invalidBaseTargets,
    challengeWithoutValidBase,
    challengeNotGreaterThanBase,
    issueCount: authorityConflicts.length
      + invalidBaseTargets.length
      + challengeWithoutValidBase.length
      + challengeNotGreaterThanBase.length,
  };
}

function buildIndependentCoverage({ targetMap = {}, eligibleEntries = [], lifecycleReady = false, normalizeStoreCoreFn = normalizeStoreCore } = {}) {
  const eligible = (eligibleEntries || []).map((entry) => ({
    storeKey: normalizeStoreCoreFn(entry?.storeKey || entry?.coreStoreName || entry?.canonicalStoreName || ''),
    canonicalStoreName: String(entry?.canonicalStoreName || '').trim() || getCanonicalStoreName(entry?.storeKey || entry?.coreStoreName || '', entry?.brandId || 'cyj'),
  })).filter((entry) => entry.storeKey && entry.canonicalStoreName);

  const targetByCore = {};
  Object.entries(targetMap || {}).forEach(([name, row]) => {
    const core = normalizeStoreCoreFn(row?.storeName || name);
    if (core) targetByCore[core] = choosePreferredTargetRow(targetByCore[core], row);
  });

  const cashMissingStores = [];
  const accrualMissingStores = [];
  let cashConfiguredStoreCount = 0;
  let accrualConfiguredStoreCount = 0;

  eligible.forEach((entry) => {
    const row = targetByCore[entry.storeKey] || {};
    if (validBaseTarget(row.cashTarget).valid) cashConfiguredStoreCount += 1;
    else cashMissingStores.push(entry.canonicalStoreName);
    if (validBaseTarget(row.accrualTarget).valid) accrualConfiguredStoreCount += 1;
    else accrualMissingStores.push(entry.canonicalStoreName);
  });

  return {
    targetCoverageVersion: TARGET_COVERAGE_VERSION,
    kpiContractVersion: KPI_CONTRACT_VERSION,
    lifecycleReady: Boolean(lifecycleReady),
    eligibleStoreCount: eligible.length,
    cashConfiguredStoreCount,
    accrualConfiguredStoreCount,
    cashCoverageComplete: Boolean(lifecycleReady) && cashMissingStores.length === 0,
    accrualCoverageComplete: Boolean(lifecycleReady) && accrualMissingStores.length === 0,
    cashMissingStores,
    accrualMissingStores,
    targetAudit: buildTargetAudit(targetMap),
  };
}

function buildTargetSummaryCompatibilityFields(targetMap = {}, brandId = 'cyj', yearMonth = '') {
  const normalizedBrandId = normalizeTargetCoverageBrandId(brandId);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedBrandId || !normalizedYearMonth) {
    throw new Error('INVALID_TARGET_SUMMARY_IDENTITY');
  }

  const rows = Object.values(targetMap || {}).filter((row) => row && typeof row === 'object');
  const cashTargetTotal = rows.reduce((sum, row) => {
    const target = validBaseTarget(row.cashTarget);
    return sum + (target.valid ? target.value : 0);
  }, 0);
  const accrualTargetTotal = rows.reduce((sum, row) => {
    const target = validBaseTarget(row.accrualTarget);
    return sum + (target.valid ? target.value : 0);
  }, 0);
  const sourceDocIds = new Set();
  rows.forEach((row) => {
    const ids = row?.authorityConflict === true && Array.isArray(row?.conflictSourceDocIds)
      ? row.conflictSourceDocIds
      : [row?.sourceDocId];
    ids.forEach((value) => {
      const id = String(value || '').trim();
      if (id) sourceDocIds.add(id);
    });
  });

  return {
    brandId: normalizedBrandId,
    brandLabel: BRAND_PREFIX[normalizedBrandId],
    year: Number(normalizedYearMonth.slice(0, 4)),
    month: Number(normalizedYearMonth.slice(5, 7)),
    yearMonth: normalizedYearMonth,
    storeCount: rows.length,
    targetCount: rows.length,
    cashTargetTotal,
    accrualTargetTotal,
    sourceDocCount: sourceDocIds.size,
  };
}

function buildTargetSummaryReplacementDocument({
  summaryData = {},
  targetMap = {},
  brandId = 'cyj',
  yearMonth = '',
  coveragePatch = {},
  updatedAt,
  updatedAtText = '',
  updatedBy = 'backend_target_coverage',
} = {}) {
  const existing = summaryData && typeof summaryData === 'object' ? summaryData : {};
  const timestampPatch = {};
  if (updatedAt !== undefined) timestampPatch.updatedAt = updatedAt;
  if (updatedAtText) timestampPatch.updatedAtText = updatedAtText;

  return {
    ...existing,
    ...buildTargetSummaryCompatibilityFields(targetMap, brandId, yearMonth),
    source: existing.source || TARGET_COVERAGE_SOURCE,
    // IMPORTANT: `targets` is a top-level replacement field. The caller must persist
    // this complete document with merge:false so a deleted nested store key cannot
    // survive Firestore map-merge semantics.
    targets: targetMap,
    ...timestampPatch,
    updatedBy,
    ...coveragePatch,
  };
}

function buildScopeChallengeTarget({ targetMap = {}, eligibleEntries = [], metric = 'cash', lifecycleReady = false, normalizeStoreCoreFn = normalizeStoreCore } = {}) {
  const baseField = metric === 'accrual' ? 'accrualTarget' : 'cashTarget';
  const challengeField = metric === 'accrual' ? 'challengeAccrualTarget' : 'challengeCashTarget';
  const targetByCore = {};

  Object.entries(targetMap || {}).forEach(([name, row]) => {
    const core = normalizeStoreCoreFn(row?.storeName || name);
    if (core) targetByCore[core] = choosePreferredTargetRow(targetByCore[core], row);
  });

  let total = 0;
  const challengeStores = [];
  const baseFallbackStores = [];
  const missingBaseStores = [];
  const invalidChallengeStores = [];

  (eligibleEntries || []).forEach((entry) => {
    const core = normalizeStoreCoreFn(entry?.storeKey || entry?.coreStoreName || entry?.canonicalStoreName || '');
    const storeName = String(entry?.canonicalStoreName || '').trim() || core;
    const row = targetByCore[core] || {};
    const base = validBaseTarget(row[baseField]);
    if (!base.valid) {
      missingBaseStores.push(storeName);
      return;
    }

    const challengeInspect = inspectKpiNumber(row[challengeField]);
    if (challengeInspect.status === KPI_VALUE_STATUS.FIELD_MISSING || challengeInspect.status === KPI_VALUE_STATUS.VALID_ZERO) {
      total += base.value;
      baseFallbackStores.push(storeName);
      return;
    }

    const challenge = validChallengeTarget(base.value, row[challengeField]);
    if (!challenge.valid) {
      invalidChallengeStores.push(storeName);
      return;
    }

    total += challenge.value;
    challengeStores.push(storeName);
  });

  const valid = Boolean(lifecycleReady) && missingBaseStores.length === 0 && invalidChallengeStores.length === 0;
  return {
    metric,
    valid,
    value: valid ? total : null,
    challengeStores,
    baseFallbackStores,
    missingBaseStores,
    invalidChallengeStores,
  };
}

function getTargetCoveragePaths(brandId = 'cyj') {
  const normalizedBrandId = normalizeTargetCoverageBrandId(brandId);
  if (!normalizedBrandId) throw new Error('UNSUPPORTED_TARGET_COVERAGE_BRAND');
  const dataRoot = normalizedBrandId === 'cyj'
    ? 'artifacts/default-app-id/public/data'
    : `brands/${normalizedBrandId}`;
  return {
    brandId: normalizedBrandId,
    dataRoot,
    monthlyTargets: `${dataRoot}/monthly_targets`,
    monthlyTargetSummary: `${dataRoot}/monthly_targets_summary`,
    lifecycleMaster: `${dataRoot}/store_lifecycle/master`,
  };
}

function createTargetCoverageFunctions({ admin, db }) {
  const functions = require('firebase-functions/v1');
  const {
    getLifecycleEligibleStoreEntries,
    normalizeStoreLifecycleCore,
    getCanonicalStoreName: getCanonicalLifecycleStoreName,
  } = require('./storeLifecycle');
  const lifecycleIdentityApi = {
    normalizeStoreCore: normalizeStoreLifecycleCore,
    getCanonicalStoreName: getCanonicalLifecycleStoreName,
  };

  function getCollection(brandId, collectionName) {
    const normalizedBrandId = normalizeTargetCoverageBrandId(brandId);
    if (!normalizedBrandId) throw new Error('UNSUPPORTED_TARGET_COVERAGE_BRAND');
    if (normalizedBrandId === 'cyj') {
      return db.collection('artifacts').doc('default-app-id').collection('public').doc('data').collection(collectionName);
    }
    return db.collection('brands').doc(normalizedBrandId).collection(collectionName);
  }

  function buildCoveragePatch({ brandId, yearMonth, lifecycleMaster, targetMap }) {
    const lifecycleReady = String(lifecycleMaster?.datasetStatus || '') === 'READY';
    const eligibleEntries = getLifecycleEligibleStoreEntries(lifecycleMaster || {}, yearMonth, {
      brandId,
      requireReady: true,
    });
    const coverage = buildIndependentCoverage({ targetMap, eligibleEntries, lifecycleReady, normalizeStoreCoreFn: normalizeStoreLifecycleCore });
    const nowText = new Date().toISOString();
    return {
      brandId,
      yearMonth,
      ...coverage,
      coverageSource: TARGET_COVERAGE_SOURCE,
      coverageUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      coverageUpdatedAtText: nowText,
    };
  }

  async function resolveCanonicalTargetAfterEvent({ brandId, targetId, beforeData, afterData, afterExists }) {
    const identity = extractTargetIdentity(targetId, afterExists ? afterData : beforeData, brandId, lifecycleIdentityApi);
    if (!identity.yearMonth || !identity.canonicalStoreName) return { identity, targetData: null };

    if (targetId !== identity.canonicalTargetId) {
      const canonicalSnap = await getCollection(brandId, 'monthly_targets').doc(identity.canonicalTargetId).get();
      if (canonicalSnap.exists) {
        return { identity, targetData: canonicalSnap.data() || {}, sourceDocId: canonicalSnap.id };
      }
    }

    return {
      identity,
      targetData: afterExists ? (afterData || {}) : null,
      sourceDocId: targetId,
    };
  }

  async function handleMonthlyTargetWrite(change, context, brandId) {
    const targetId = String(context?.params?.targetId || change.after.id || change.before.id || '');
    const beforeData = change.before.exists ? (change.before.data() || {}) : {};
    const afterData = change.after.exists ? (change.after.data() || {}) : {};
    const resolved = await resolveCanonicalTargetAfterEvent({
      brandId,
      targetId,
      beforeData,
      afterData,
      afterExists: change.after.exists,
    });
    const { identity } = resolved;
    if (!identity.yearMonth || !identity.canonicalStoreName) return null;

    const summaryRef = getCollection(brandId, 'monthly_targets_summary').doc(identity.yearMonth);
    const lifecycleRef = getCollection(brandId, 'store_lifecycle').doc('master');

    return db.runTransaction(async (transaction) => {
      const [summarySnap, lifecycleSnap] = await Promise.all([
        transaction.get(summaryRef),
        transaction.get(lifecycleRef),
      ]);
      const summaryData = summarySnap.exists ? (summarySnap.data() || {}) : {};
      const targetMap = extractSummaryTargetMap(summaryData, brandId, identity.yearMonth, lifecycleIdentityApi);

      if (resolved.targetData) {
        const nextRow = buildTargetSummaryRow(
          resolved.targetData,
          identity.canonicalStoreName,
          resolved.sourceDocId || targetId,
          identity.canonicalTargetId
        );
        targetMap[identity.canonicalStoreName] = choosePreferredTargetRow(
          targetMap[identity.canonicalStoreName] || null,
          nextRow
        );
      } else {
        delete targetMap[identity.canonicalStoreName];
      }

      const lifecycleMaster = lifecycleSnap.exists ? (lifecycleSnap.data() || {}) : { datasetStatus: 'BUILDING', stores: {} };
      const coveragePatch = buildCoveragePatch({ brandId, yearMonth: identity.yearMonth, lifecycleMaster, targetMap });
      const nowText = new Date().toISOString();

      const replacementDocument = buildTargetSummaryReplacementDocument({
        summaryData,
        targetMap,
        brandId,
        yearMonth: identity.yearMonth,
        coveragePatch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: nowText,
        updatedBy: 'backend_target_coverage',
      });

      // Full-document replacement is intentional here. Firestore set(..., { merge:true })
      // recursively merges nested maps and leaves omitted targets.<store> keys behind.
      // The transaction read above protects concurrent Summary changes and retries with
      // fresh data, while spreading summaryData preserves unrelated top-level fields.
      transaction.set(summaryRef, replacementDocument, { merge: false });
    });
  }

  async function recomputeOneSummary({ brandId, yearMonth, summaryData, summaryRef, lifecycleMaster }) {
    const targetMap = extractSummaryTargetMap(summaryData || {}, brandId, yearMonth, lifecycleIdentityApi);
    const patch = buildCoveragePatch({ brandId, yearMonth, lifecycleMaster, targetMap });
    await summaryRef.set({
      ...buildTargetSummaryCompatibilityFields(targetMap, brandId, yearMonth),
      ...patch,
    }, { merge: true });
  }

  async function handleTargetSummaryWrite(change, context, brandId) {
    if (!change.after.exists) return null;
    const beforeData = change.before.exists ? (change.before.data() || {}) : {};
    const afterData = change.after.data() || {};

    // 自己的 derived write 只改 coverage metadata；避免下一輪 trigger recursion。
    if (
      afterData.coverageSource === TARGET_COVERAGE_SOURCE &&
      String(afterData.coverageUpdatedAtText || '') !== String(beforeData.coverageUpdatedAtText || '')
    ) {
      return null;
    }

    const yearMonth = normalizeYearMonth(context?.params?.yearMonth || afterData.yearMonth || '');
    if (!yearMonth) return null;
    const beforeMap = extractSummaryTargetMap(beforeData, brandId, yearMonth, lifecycleIdentityApi);
    const afterMap = extractSummaryTargetMap(afterData, brandId, yearMonth, lifecycleIdentityApi);
    if (change.before.exists && targetMapsEqual(beforeMap, afterMap)) return null;

    const lifecycleSnap = await getCollection(brandId, 'store_lifecycle').doc('master').get();
    const lifecycleMaster = lifecycleSnap.exists ? (lifecycleSnap.data() || {}) : { datasetStatus: 'BUILDING', stores: {} };
    return recomputeOneSummary({
      brandId,
      yearMonth,
      summaryData: afterData,
      summaryRef: change.after.ref,
      lifecycleMaster,
    });
  }

  async function handleLifecycleWrite(change, context, brandId) {
    if (String(context?.params?.docId || '') !== 'master') return null;
    const beforeData = change.before.exists ? (change.before.data() || {}) : {};
    const afterData = change.after.exists ? (change.after.data() || {}) : { datasetStatus: 'BUILDING', stores: {} };
    const beforeStatus = String(beforeData.datasetStatus || 'BUILDING');
    const afterStatus = String(afterData.datasetStatus || 'BUILDING');

    // BUILDING 期間大量建立 entry 不應每次掃 target summaries；只有 READY 進出或 READY 內部變更才重算。
    if (beforeStatus !== 'READY' && afterStatus !== 'READY') return null;
    if (
      beforeStatus === afterStatus &&
      JSON.stringify(beforeData.stores || {}) === JSON.stringify(afterData.stores || {})
    ) return null;

    const summarySnap = await getCollection(brandId, 'monthly_targets_summary').get();
    if (summarySnap.empty) return null;

    const docs = summarySnap.docs;
    for (let offset = 0; offset < docs.length; offset += 400) {
      const batch = db.batch();
      docs.slice(offset, offset + 400).forEach((docSnap) => {
        const yearMonth = normalizeYearMonth(docSnap.id || docSnap.data()?.yearMonth || '');
        if (!yearMonth) return;
        const targetMap = extractSummaryTargetMap(docSnap.data() || {}, brandId, yearMonth, lifecycleIdentityApi);
        batch.set(docSnap.ref, {
          ...buildTargetSummaryCompatibilityFields(targetMap, brandId, yearMonth),
          ...buildCoveragePatch({
            brandId,
            yearMonth,
            lifecycleMaster: afterData,
            targetMap,
          }),
        }, { merge: true });
      });
      await batch.commit();
    }
    return null;
  }

  const onLegacyMonthlyTargetChange = functions.firestore
    .document('artifacts/default-app-id/public/data/monthly_targets/{targetId}')
    .onWrite((change, context) => handleMonthlyTargetWrite(change, context, 'cyj'));

  const onBrandMonthlyTargetChange = functions.firestore
    .document('brands/{brandId}/monthly_targets/{targetId}')
    .onWrite((change, context) => {
      const brandId = normalizeTargetCoverageBrandId(context.params.brandId);
      return brandId ? handleMonthlyTargetWrite(change, context, brandId) : null;
    });

  const onLegacyMonthlyTargetSummaryChange = functions.firestore
    .document('artifacts/default-app-id/public/data/monthly_targets_summary/{yearMonth}')
    .onWrite((change, context) => handleTargetSummaryWrite(change, context, 'cyj'));

  const onBrandMonthlyTargetSummaryChange = functions.firestore
    .document('brands/{brandId}/monthly_targets_summary/{yearMonth}')
    .onWrite((change, context) => {
      const brandId = normalizeTargetCoverageBrandId(context.params.brandId);
      return brandId ? handleTargetSummaryWrite(change, context, brandId) : null;
    });

  const onLegacyStoreLifecycleCoverageChange = functions.firestore
    .document('artifacts/default-app-id/public/data/store_lifecycle/{docId}')
    .onWrite((change, context) => handleLifecycleWrite(change, context, 'cyj'));

  const onBrandStoreLifecycleCoverageChange = functions.firestore
    .document('brands/{brandId}/store_lifecycle/{docId}')
    .onWrite((change, context) => {
      const brandId = normalizeTargetCoverageBrandId(context.params.brandId);
      return brandId ? handleLifecycleWrite(change, context, brandId) : null;
    });

  return {
    onLegacyMonthlyTargetChange,
    onBrandMonthlyTargetChange,
    onLegacyMonthlyTargetSummaryChange,
    onBrandMonthlyTargetSummaryChange,
    onLegacyStoreLifecycleCoverageChange,
    onBrandStoreLifecycleCoverageChange,
  };
}

module.exports = {
  TARGET_COVERAGE_VERSION,
  TARGET_COVERAGE_SOURCE,
  normalizeTargetCoverageBrandId,
  extractTargetIdentity,
  buildTargetSummaryRow,
  extractSummaryTargetMap,
  buildTargetAudit,
  buildIndependentCoverage,
  buildTargetSummaryCompatibilityFields,
  buildTargetSummaryReplacementDocument,
  buildScopeChallengeTarget,
  targetMapsEqual,
  getTargetCoveragePaths,
  createTargetCoverageFunctions,
};
