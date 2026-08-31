const {
  normalizeTargetCoverageBrandId,
  extractTargetIdentity,
  extractSummaryTargetMap,
  getTargetCoveragePaths,
} = require('./targetCoverage');

const ZERO_TARGET_INVENTORY_VERSION = 'zero-target-production-inventory-v1';
const CYJ_NEW_STORE_CANONICAL_NAME = 'CYJ新店店';
const CYJ_NEW_STORE_LEGACY_NAMES = Object.freeze([
  'CYJ新店',
  'DRCYJ新店',
  'DRCYJ新店店',
]);

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
    updatedAtText: normalizeAuditText(data.updatedAtText || data.updatedAt || ''),
    updatedBy: String(data.updatedBy || ''),
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
    cashZeroPreservedInSummary: record.cashExplicitZero ? isExplicitNumericZero(summaryCashTarget) : null,
    accrualZeroPreservedInSummary: record.accrualExplicitZero ? isExplicitNumericZero(summaryAccrualTarget) : null,
  };
}

function createZeroTargetInventoryFunctions({ admin, db }) {
  const { onRequest } = require('firebase-functions/v2/https');
  const {
    requireFirebaseRequestAuth,
    verifySuperAdminActor,
  } = require('./deviceApproval');

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

      // 5E-0 只查 index 命中的 explicit numeric zero；不掃完整 monthly_targets。
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
      const summarySnaps = await Promise.all(affectedMonths.map((yearMonth) => summaryCollection.doc(yearMonth).get()));
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
        };
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
        affectedMonthSummaryReads: summarySnaps.length,
        cyjNewStoreLegacyProbeReads: cyjAliasRefs.length,
        firestoreWrites: 0,
        estimatedFirestoreReads: 3 + cashZeroSnap.size + accrualZeroSnap.size + summarySnaps.length + cyjAliasRefs.length,
      };

      console.info(
        `Zero Target inventory: ${brandId} | docs=${summary.uniqueTargetDocs} | metrics=${summary.explicitZeroMetricCount} | months=${summary.affectedMonths.length} | rawReads=${readEstimate.rawMonthlyTargetQueryReads} | writes=0`
      );

      return res.status(200).json({
        ok: true,
        auditOnly: true,
        inventoryVersion: ZERO_TARGET_INVENTORY_VERSION,
        brandId,
        summary,
        readEstimate,
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
  createZeroTargetInventoryFunctions,
};
