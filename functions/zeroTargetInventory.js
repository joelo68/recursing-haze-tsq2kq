const {
  normalizeTargetCoverageBrandId,
  extractTargetIdentity,
  extractSummaryTargetMap,
  getTargetCoveragePaths,
} = require('./targetCoverage');

const ZERO_TARGET_INVENTORY_VERSION = 'zero-target-production-inventory-v2';
const CYJ_NEW_STORE_CANONICAL_NAME = 'CYJ新店店';
const CYJ_NEW_STORE_LEGACY_NAMES = Object.freeze([
  'CYJ新店',
  'DRCYJ新店',
  'DRCYJ新店店',
]);

const KNOWN_TARGET_FIELDS = Object.freeze(new Set([
  'brandId',
  'year',
  'month',
  'yearMonth',
  'store',
  'storeName',
  'cashTarget',
  'accrualTarget',
  'challengeCashTarget',
  'challengeAccrualTarget',
  'isUnlocked',
  'updatedAt',
  'updatedAtText',
  'updatedBy',
  'createdAt',
  'createdAtText',
  'createdBy',
]));

function hasOwn(value = {}, key = '') {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

function isExplicitNumericZero(value) {
  return typeof value === 'number' && Number.isFinite(value) && value === 0;
}

function normalizeAuditText(value = '') {
  if (!value) return '';
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?.seconds === 'number') return new Date(Number(value.seconds) * 1000).toISOString();
  return String(value || '');
}

function buildZeroTargetInventoryRecord({ brandId, docId, data = {} } = {}) {
  const normalizedBrandId = normalizeTargetCoverageBrandId(brandId);
  const identity = extractTargetIdentity(docId, data, normalizedBrandId);
  const cashExplicitZero = hasOwn(data, 'cashTarget') && isExplicitNumericZero(data.cashTarget);
  const accrualExplicitZero = hasOwn(data, 'accrualTarget') && isExplicitNumericZero(data.accrualTarget);
  const canonicalDocument = Boolean(identity.canonicalTargetId && String(docId || '') === identity.canonicalTargetId);
  const documentFieldNames = Object.keys(data || {}).sort();
  const extraFieldNames = documentFieldNames.filter((key) => !KNOWN_TARGET_FIELDS.has(key));

  return {
    brandId: normalizedBrandId,
    docId: String(docId || ''),
    yearMonth: identity.yearMonth,
    rawStoreName: String(data.storeName || data.store || ''),
    storeCore: identity.storeCore,
    canonicalStoreName: identity.canonicalStoreName,
    canonicalTargetId: identity.canonicalTargetId,
    sourceKind: canonicalDocument ? 'CANONICAL' : 'LEGACY_OR_NONCANONICAL',
    cashTargetPresent: hasOwn(data, 'cashTarget'),
    cashTarget: hasOwn(data, 'cashTarget') ? data.cashTarget : null,
    cashExplicitZero,
    accrualTargetPresent: hasOwn(data, 'accrualTarget'),
    accrualTarget: hasOwn(data, 'accrualTarget') ? data.accrualTarget : null,
    accrualExplicitZero,
    challengeCashTargetPresent: hasOwn(data, 'challengeCashTarget'),
    challengeCashTarget: hasOwn(data, 'challengeCashTarget') ? data.challengeCashTarget : null,
    challengeAccrualTargetPresent: hasOwn(data, 'challengeAccrualTarget'),
    challengeAccrualTarget: hasOwn(data, 'challengeAccrualTarget') ? data.challengeAccrualTarget : null,
    isUnlocked: data.isUnlocked === true,
    updatedAtText: normalizeAuditText(data.updatedAtText || data.updatedAt || ''),
    updatedBy: String(data.updatedBy || ''),
    createdAtText: normalizeAuditText(data.createdAtText || data.createdAt || ''),
    createdBy: String(data.createdBy || ''),
    documentFieldNames,
    extraFieldNames,
  };
}

function summarizeZeroTargetInventory(records = []) {
  const uniqueMonths = [...new Set(records.map((row) => row.yearMonth).filter(Boolean))].sort();
  const uniqueStores = [...new Set(records.map((row) => row.canonicalStoreName).filter(Boolean))].sort();
  return {
    uniqueTargetDocs: records.length,
    explicitZeroMetricCount: records.reduce(
      (sum, row) => sum + (row.cashExplicitZero ? 1 : 0) + (row.accrualExplicitZero ? 1 : 0),
      0
    ),
    cashZeroDocs: records.filter((row) => row.cashExplicitZero).length,
    accrualZeroDocs: records.filter((row) => row.accrualExplicitZero).length,
    canonicalDocs: records.filter((row) => row.sourceKind === 'CANONICAL').length,
    legacyOrNonCanonicalDocs: records.filter((row) => row.sourceKind !== 'CANONICAL').length,
    affectedMonths: uniqueMonths,
    affectedStoreCount: uniqueStores.length,
    affectedStores: uniqueStores,
    docsWithChallengeFields: records.filter(
      (row) => row.challengeCashTargetPresent || row.challengeAccrualTargetPresent
    ).length,
    docsUnlocked: records.filter((row) => row.isUnlocked).length,
    docsWithExtraFields: records.filter((row) => Array.isArray(row.extraFieldNames) && row.extraFieldNames.length > 0).length,
  };
}

function buildCyjNewStoreLegacyTargetIds(record = {}) {
  if (record.brandId !== 'cyj' || record.canonicalStoreName !== CYJ_NEW_STORE_CANONICAL_NAME || !record.yearMonth) return [];
  const [year, monthText] = String(record.yearMonth).split('-');
  const month = Number(monthText);
  if (!year || !month) return [];
  return CYJ_NEW_STORE_LEGACY_NAMES.map((name) => `${name}_${year}_${month}`);
}

function buildSummaryObservation(record = {}, summaryData = {}) {
  const summaryMap = extractSummaryTargetMap(summaryData || {}, record.brandId, record.yearMonth);
  const row = summaryMap[record.canonicalStoreName] || null;
  const summaryCashTarget = row && hasOwn(row, 'cashTarget') ? row.cashTarget : null;
  const summaryAccrualTarget = row && hasOwn(row, 'accrualTarget') ? row.accrualTarget : null;
  return {
    summaryRowPresent: Boolean(row),
    summarySourceDocId: String(row?.sourceDocId || ''),
    summaryCashTarget,
    summaryAccrualTarget,
    summaryChallengeCashTarget: row && hasOwn(row, 'challengeCashTarget') ? row.challengeCashTarget : null,
    summaryChallengeAccrualTarget: row && hasOwn(row, 'challengeAccrualTarget') ? row.challengeAccrualTarget : null,
    summaryIsUnlocked: row?.isUnlocked === true,
    cashZeroPreservedInSummary: record.cashExplicitZero ? isExplicitNumericZero(summaryCashTarget) : null,
    accrualZeroPreservedInSummary: record.accrualExplicitZero ? isExplicitNumericZero(summaryAccrualTarget) : null,
  };
}

function extractCoverageObservation(summaryData = {}) {
  const audit = summaryData?.targetAudit && typeof summaryData.targetAudit === 'object'
    ? summaryData.targetAudit
    : {};
  return {
    targetCoverageVersion: String(summaryData.targetCoverageVersion || ''),
    kpiContractVersion: String(summaryData.kpiContractVersion || ''),
    lifecycleReady: summaryData.lifecycleReady === true,
    eligibleStoreCount: Number.isFinite(Number(summaryData.eligibleStoreCount)) ? Number(summaryData.eligibleStoreCount) : null,
    cashConfiguredStoreCount: Number.isFinite(Number(summaryData.cashConfiguredStoreCount)) ? Number(summaryData.cashConfiguredStoreCount) : null,
    accrualConfiguredStoreCount: Number.isFinite(Number(summaryData.accrualConfiguredStoreCount)) ? Number(summaryData.accrualConfiguredStoreCount) : null,
    cashCoverageComplete: summaryData.cashCoverageComplete === true,
    accrualCoverageComplete: summaryData.accrualCoverageComplete === true,
    cashMissingStores: Array.isArray(summaryData.cashMissingStores) ? summaryData.cashMissingStores.map(String) : [],
    accrualMissingStores: Array.isArray(summaryData.accrualMissingStores) ? summaryData.accrualMissingStores.map(String) : [],
    targetAuditIssueCount: Number.isFinite(Number(audit.issueCount)) ? Number(audit.issueCount) : null,
    targetAuditZeroBaseTargets: Array.isArray(audit.zeroBaseTargets) ? audit.zeroBaseTargets : [],
    coverageSource: String(summaryData.coverageSource || ''),
    coverageUpdatedAtText: normalizeAuditText(summaryData.coverageUpdatedAtText || summaryData.coverageUpdatedAt || ''),
    summaryUpdatedAtText: normalizeAuditText(summaryData.updatedAtText || summaryData.updatedAt || ''),
    storeCount: Number.isFinite(Number(summaryData.storeCount)) ? Number(summaryData.storeCount) : null,
    targetCount: Number.isFinite(Number(summaryData.targetCount)) ? Number(summaryData.targetCount) : null,
    sourceDocCount: Number.isFinite(Number(summaryData.sourceDocCount)) ? Number(summaryData.sourceDocCount) : null,
    cashTargetTotal: Number.isFinite(Number(summaryData.cashTargetTotal)) ? Number(summaryData.cashTargetTotal) : null,
    accrualTargetTotal: Number.isFinite(Number(summaryData.accrualTargetTotal)) ? Number(summaryData.accrualTargetTotal) : null,
  };
}

function findLifecycleEntry(lifecycleMaster = {}, record = {}, lifecycleApi = {}) {
  const normalizeStoreLifecycleCore = lifecycleApi.normalizeStoreLifecycleCore || ((value = '') => String(value || '').trim());
  const targetCore = normalizeStoreLifecycleCore(record.storeCore || record.canonicalStoreName || record.rawStoreName || '');
  if (!targetCore) return { storeKey: '', entry: null };
  const stores = lifecycleMaster?.stores && typeof lifecycleMaster.stores === 'object' && !Array.isArray(lifecycleMaster.stores)
    ? lifecycleMaster.stores
    : {};

  for (const [storeKey, rawEntry] of Object.entries(stores)) {
    const entry = rawEntry || {};
    const core = normalizeStoreLifecycleCore(entry.coreStoreName || entry.storeKey || entry.canonicalStoreName || storeKey);
    if (core === targetCore) return { storeKey, entry };
  }
  return { storeKey: '', entry: null };
}

function classifyLifecycleRelation(entry = null, yearMonth = '', lifecycleReady = false, lifecycleApi = {}) {
  const validateLifecycleDraft = lifecycleApi.validateLifecycleDraft || (() => ({ valid: false, entryStatus: 'INCOMPLETE', errors: ['LIFECYCLE_API_MISSING'], normalized: {} }));
  const isLifecycleEntryEligibleForMonth = lifecycleApi.isLifecycleEntryEligibleForMonth || (() => false);
  if (!lifecycleReady) return 'LIFECYCLE_NOT_READY';
  if (!entry) return 'STORE_NOT_IN_LIFECYCLE';
  const check = validateLifecycleDraft(entry || {});
  if (!check.valid) return 'LIFECYCLE_ENTRY_INVALID';
  if (check.entryStatus !== 'COMPLETE') return 'LIFECYCLE_ENTRY_INCOMPLETE';
  if (isLifecycleEntryEligibleForMonth(entry, yearMonth)) return 'ELIGIBLE';
  const first = String(check.normalized.firstEligibleMonth || '');
  const last = String(check.normalized.lastEligibleMonth || '');
  const exempt = Array.isArray(check.normalized.exemptMonths) ? check.normalized.exemptMonths : [];
  if (first && yearMonth < first) return 'PRE_ELIGIBLE';
  if (last && yearMonth > last) return 'POST_ELIGIBLE';
  if (exempt.includes(yearMonth)) return 'EXEMPT_MONTH';
  return 'NOT_ELIGIBLE';
}

function buildLifecycleObservation(record = {}, lifecycleMaster = {}, lifecycleApi = {}) {
  const validateLifecycleDraft = lifecycleApi.validateLifecycleDraft || (() => ({ valid: false, entryStatus: 'INCOMPLETE', errors: ['LIFECYCLE_API_MISSING'], normalized: {} }));
  const isLifecycleEntryEligibleForMonth = lifecycleApi.isLifecycleEntryEligibleForMonth || (() => false);
  const lifecycleReady = String(lifecycleMaster?.datasetStatus || '') === 'READY';
  const { storeKey, entry } = findLifecycleEntry(lifecycleMaster, record, lifecycleApi);
  const check = entry ? validateLifecycleDraft(entry) : null;
  return {
    lifecycleDatasetStatus: String(lifecycleMaster?.datasetStatus || 'BUILDING'),
    lifecycleRevision: Number(lifecycleMaster?.revision || 0),
    lifecycleReady,
    lifecycleStoreEntryPresent: Boolean(entry),
    lifecycleStoreKey: String(storeKey || ''),
    lifecycleEntryStatus: String(check?.entryStatus || ''),
    lifecycleValidationErrors: Array.isArray(check?.errors) ? check.errors : [],
    firstEligibleMonth: String(check?.normalized?.firstEligibleMonth || ''),
    openDate: String(check?.normalized?.openDate || ''),
    lastEligibleMonth: String(check?.normalized?.lastEligibleMonth || ''),
    closeDate: String(check?.normalized?.closeDate || ''),
    exemptMonths: Array.isArray(check?.normalized?.exemptMonths) ? check.normalized.exemptMonths : [],
    eligibleForTargetMonth: Boolean(entry && lifecycleReady && isLifecycleEntryEligibleForMonth(entry, record.yearMonth)),
    lifecycleRelation: classifyLifecycleRelation(entry, record.yearMonth, lifecycleReady, lifecycleApi),
  };
}

function buildMonthObservation({ brandId = '', yearMonth = '', records = [], summaryData = {}, lifecycleMaster = {}, lifecycleApi = {} } = {}) {
  const getLifecycleEligibleStoreEntries = lifecycleApi.getLifecycleEligibleStoreEntries || (() => []);
  const eligibleEntries = getLifecycleEligibleStoreEntries(lifecycleMaster || {}, yearMonth, {
    brandId,
    requireReady: true,
  });
  const monthRecords = records.filter((row) => row.yearMonth === yearMonth);
  return {
    brandId,
    yearMonth,
    explicitZeroDocIds: monthRecords.map((row) => row.docId).sort(),
    explicitZeroStores: [...new Set(monthRecords.map((row) => row.canonicalStoreName).filter(Boolean))].sort(),
    summaryExists: Boolean(summaryData && Object.keys(summaryData).length > 0),
    coverage: extractCoverageObservation(summaryData),
    lifecycleEligibleStoreCount: eligibleEntries.length,
    lifecycleEligibleStores: eligibleEntries.map((entry) => String(entry.canonicalStoreName || entry.storeKey || '')).filter(Boolean),
  };
}

function createZeroTargetInventoryFunctions({ admin, db }) {
  const { onRequest } = require('firebase-functions/v2/https');
  const {
    requireFirebaseRequestAuth,
    verifySuperAdminActor,
  } = require('./deviceApproval');

  const lifecycleApi = require('./storeLifecycle');

  const auditExplicitZeroTargets = onRequest({ cors: true, timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });

    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });

    try {
      const body = req.body || {};
      const brandId = normalizeTargetCoverageBrandId(body.brandId);
      if (!brandId) return res.status(400).json({ ok: false, message: '不支援的品牌' });

      const adminCheck = await verifySuperAdminActor({ db, brandId, actor: body.actor || {} });
      if (!adminCheck.ok) return res.status(403).json({ ok: false, message: '此稽核僅限最高管理者在已信任裝置執行' });

      const paths = getTargetCoveragePaths(brandId);
      const targetCollection = db.collection(paths.monthlyTargets);

      // 5E-0 / 5E-0.5：只查 index 命中的 explicit numeric zero；不掃完整 monthly_targets。
      // 同一文件若 cash/accrual 都是 0，兩個 query 都會產生一次 billed read，因此 readEstimate 用兩個 snapshot size 相加。
      const [cashZeroSnap, accrualZeroSnap] = await Promise.all([
        targetCollection.where('cashTarget', '==', 0).get(),
        targetCollection.where('accrualTarget', '==', 0).get(),
      ]);

      const uniqueDocs = new Map();
      [...cashZeroSnap.docs, ...accrualZeroSnap.docs].forEach((docSnap) => {
        uniqueDocs.set(docSnap.id, docSnap.data() || {});
      });

      let records = [...uniqueDocs.entries()]
        .map(([docId, data]) => buildZeroTargetInventoryRecord({ brandId, docId, data }))
        .filter((row) => row.cashExplicitZero || row.accrualExplicitZero)
        .sort((a, b) => `${a.yearMonth}_${a.canonicalStoreName}_${a.docId}`.localeCompare(`${b.yearMonth}_${b.canonicalStoreName}_${b.docId}`));

      const affectedMonths = [...new Set(records.map((row) => row.yearMonth).filter(Boolean))].sort();
      const summaryCollection = db.collection(paths.monthlyTargetSummary);
      const lifecycleRef = db.doc(paths.lifecycleMaster);
      const [lifecycleSnap, ...summarySnaps] = await Promise.all([
        lifecycleRef.get(),
        ...affectedMonths.map((yearMonth) => summaryCollection.doc(yearMonth).get()),
      ]);
      const lifecycleMaster = lifecycleSnap.exists
        ? (lifecycleSnap.data() || {})
        : { datasetStatus: 'BUILDING', stores: {} };
      const summaryByMonth = new Map(summarySnaps.map((snap, index) => [affectedMonths[index], snap]));

      records = records.map((row) => {
        const summarySnap = summaryByMonth.get(row.yearMonth);
        const summaryData = summarySnap?.exists ? (summarySnap.data() || {}) : {};
        return {
          ...row,
          summaryExists: Boolean(summarySnap?.exists),
          summaryTargetCoverageVersion: String(summaryData.targetCoverageVersion || ''),
          summaryKpiContractVersion: String(summaryData.kpiContractVersion || ''),
          ...buildSummaryObservation(row, summaryData),
          lifecycle: buildLifecycleObservation(row, lifecycleMaster, lifecycleApi),
        };
      });

      const monthObservations = affectedMonths.map((yearMonth) => {
        const summarySnap = summaryByMonth.get(yearMonth);
        return buildMonthObservation({
          brandId,
          yearMonth,
          records,
          summaryData: summarySnap?.exists ? (summarySnap.data() || {}) : {},
          lifecycleMaster,
          lifecycleApi,
        });
      });

      // CYJ 新店只有一組正式已知 legacy aliases。只對 explicit-zero 新店月份做 targeted point reads，
      // 用來確認 canonical zero 是否仍旁邊存在 legacy duplicate；不擴大到全門市 alias 掃描。
      const cyjAliasIds = [...new Set(records.flatMap(buildCyjNewStoreLegacyTargetIds))];
      const cyjAliasRefs = cyjAliasIds.map((id) => targetCollection.doc(id));
      const cyjAliasSnaps = [];
      for (let offset = 0; offset < cyjAliasRefs.length; offset += 100) {
        cyjAliasSnaps.push(...await db.getAll(...cyjAliasRefs.slice(offset, offset + 100)));
      }
      const cyjNewStoreLegacyProbe = cyjAliasSnaps
        .filter((snap) => snap.exists)
        .map((snap) => ({
          docId: snap.id,
          ...buildZeroTargetInventoryRecord({ brandId, docId: snap.id, data: snap.data() || {} }),
        }));

      const summary = summarizeZeroTargetInventory(records);
      const readEstimate = {
        firebaseAuthVerification: 0,
        securityFirestoreReads: 3,
        cashZeroQueryReads: cashZeroSnap.size,
        accrualZeroQueryReads: accrualZeroSnap.size,
        rawMonthlyTargetQueryReads: cashZeroSnap.size + accrualZeroSnap.size,
        uniqueRawTargetDocs: records.length,
        lifecycleReads: 1,
        affectedMonthSummaryReads: summarySnaps.length,
        cyjNewStoreLegacyProbeReads: cyjAliasRefs.length,
        firestoreWrites: 0,
        estimatedFirestoreReads: 4 + cashZeroSnap.size + accrualZeroSnap.size + summarySnaps.length + cyjAliasRefs.length,
      };

      console.info(
        `Zero Target inventory v2: ${brandId} | docs=${summary.uniqueTargetDocs} | metrics=${summary.explicitZeroMetricCount} | months=${summary.affectedMonths.length} | rawReads=${readEstimate.rawMonthlyTargetQueryReads} | lifecycleReads=1 | writes=0`
      );

      return res.status(200).json({
        ok: true,
        auditOnly: true,
        inventoryVersion: ZERO_TARGET_INVENTORY_VERSION,
        brandId,
        lifecycle: {
          datasetStatus: String(lifecycleMaster.datasetStatus || 'BUILDING'),
          revision: Number(lifecycleMaster.revision || 0),
          ready: String(lifecycleMaster.datasetStatus || '') === 'READY',
        },
        summary,
        readEstimate,
        monthObservations,
        records,
        cyjNewStoreLegacyProbe,
        auditedAtText: new Date().toISOString(),
      });
    } catch (error) {
      console.error('auditExplicitZeroTargets failed', error);
      return res.status(500).json({ ok: false, message: 'Zero Target 只讀稽核失敗，請稍後再試' });
    }
  });

  return { auditExplicitZeroTargets };
}

module.exports = {
  ZERO_TARGET_INVENTORY_VERSION,
  CYJ_NEW_STORE_CANONICAL_NAME,
  CYJ_NEW_STORE_LEGACY_NAMES,
  isExplicitNumericZero,
  buildZeroTargetInventoryRecord,
  summarizeZeroTargetInventory,
  buildCyjNewStoreLegacyTargetIds,
  buildSummaryObservation,
  extractCoverageObservation,
  findLifecycleEntry,
  classifyLifecycleRelation,
  buildLifecycleObservation,
  buildMonthObservation,
  createZeroTargetInventoryFunctions,
};
