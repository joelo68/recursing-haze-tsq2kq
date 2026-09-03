const { onRequest } = require('firebase-functions/v2/https');
const {
  SYSTEM_EXCLUSION_VERSION,
  normalizeSystemExclusionRevision,
  normalizeStoredSystemExclusionProfile,
  buildStoredSystemExclusionSnapshot,
} = require('./systemExclusionContract');
const {
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
} = require('./deviceApproval');
const {
  detectStoreBrandFromName,
  normalizeStoreLifecycleCore,
} = require('./storeLifecycle');

const SYSTEM_EXCLUSION_SOURCE = 'system_exclusion_backend_v1';
const STRICT_BRANDS = new Set(['cyj', 'anniu', 'yibo']);

function resolveStrictSystemExclusionBrandId(value = '') {
  const brandId = String(value || '').trim().toLowerCase();
  return STRICT_BRANDS.has(brandId) ? brandId : '';
}

function parseExpectedSystemExclusionRevision(value) {
  if (value === null || value === undefined || value === '') {
    const error = new Error('缺少排除設定版本，請重新載入後再儲存');
    error.code = 'INVALID_SYSTEM_EXCLUSION_REVISION';
    throw error;
  }
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    const error = new Error('排除設定版本格式錯誤，請重新載入後再儲存');
    error.code = 'INVALID_SYSTEM_EXCLUSION_REVISION';
    throw error;
  }
  return revision;
}

function normalizeSystemExclusionStores(values = [], brandId = '') {
  const normalizedBrandId = resolveStrictSystemExclusionBrandId(brandId);
  if (!normalizedBrandId) {
    const error = new Error('不支援的品牌');
    error.code = 'INVALID_SYSTEM_EXCLUSION_BRAND';
    throw error;
  }
  if (!Array.isArray(values) || values.length > 250) {
    const error = new Error('排除店家格式錯誤');
    error.code = 'INVALID_SYSTEM_EXCLUSION_STORES';
    throw error;
  }

  const stores = [];
  const seen = new Set();
  values.forEach((value) => {
    const raw = String(value || '').trim();
    if (!raw) return;
    const explicitBrand = detectStoreBrandFromName(raw);
    if (explicitBrand && explicitBrand !== normalizedBrandId) {
      const error = new Error(`店家 ${raw} 不屬於目前品牌`);
      error.code = 'SYSTEM_EXCLUSION_BRAND_MISMATCH';
      throw error;
    }
    const storeCore = normalizeStoreLifecycleCore(raw);
    if (!storeCore || seen.has(storeCore)) return;
    seen.add(storeCore);
    stores.push(storeCore);
  });
  return stores.sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function createSystemExclusionFunctions({
  admin,
  db,
  refreshTargetCoverageForSystemExclusion,
  markHistoricalSummariesDirtyForSystemExclusion,
}) {
  const functions = require('firebase-functions/v1');

  const manageSystemExclusions = onRequest({ cors: true, timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });
    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });

    try {
      const body = req.body || {};
      const brandId = resolveStrictSystemExclusionBrandId(body.brandId);
      if (!brandId) return res.status(400).json({ ok: false, message: '不支援的品牌' });
      const actor = body.actor || {};
      const adminCheck = await verifySuperAdminActor({ db, brandId, actor });
      if (!adminCheck.ok) return res.status(403).json({ ok: false, message: '此設定僅限已信任裝置上的最高管理者修改' });

      const stores = normalizeSystemExclusionStores(body.stores || [], brandId);
      const expectedRevision = parseExpectedSystemExclusionRevision(body.expectedRevision);
      const ref = getBrandSettingDoc(db, brandId, 'audit_exclusions');
      const auditRef = getBrandCollection(db, brandId, 'system_logs').doc();
      let result = null;

      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        const current = normalizeStoredSystemExclusionProfile(
          snap.exists ? (snap.data() || {}) : {},
          brandId,
          normalizeStoreLifecycleCore
        );
        if (current.revision !== expectedRevision) {
          const conflict = new Error('system_exclusion_revision_conflict');
          conflict.code = 'SYSTEM_EXCLUSION_CONFLICT';
          conflict.current = current;
          throw conflict;
        }

        const nextRevision = current.revision + 1;
        const nowText = new Date().toISOString();
        const payload = {
          systemExclusionVersion: SYSTEM_EXCLUSION_VERSION,
          brandId,
          revision: nextRevision,
          stores,
          source: SYSTEM_EXCLUSION_SOURCE,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtText: nowText,
          updatedBy: adminCheck.actorName,
          updatedByRole: adminCheck.actorRole,
          updatedByAccountId: adminCheck.actorAccountId,
        };
        transaction.set(ref, payload, { merge: true });
        transaction.set(auditRef, {
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          createdAtText: nowText,
          role: adminCheck.actorRole,
          user: adminCheck.actorName,
          action: '更新全系統排除店家',
          activityType: 'system_exclusion.update',
          view: 'audit_exclusions',
          brandId,
          details: {
            previousRevision: current.revision,
            revision: nextRevision,
            previousStores: current.stores,
            stores,
          },
        }, { merge: false });
        result = buildStoredSystemExclusionSnapshot({ ...payload, revision: nextRevision, stores }, brandId, normalizeStoreLifecycleCore);
      });

      return res.status(200).json({ ok: true, systemExclusion: { ...result, ready: true } });
    } catch (error) {
      if (error?.code === 'SYSTEM_EXCLUSION_CONFLICT') {
        const current = error.current || {};
        return res.status(409).json({
          ok: false,
          reason: 'revision_conflict',
          message: '排除店家設定已被另一位管理者更新，請重新確認後再儲存',
          currentSystemExclusion: {
            ...buildStoredSystemExclusionSnapshot(current, current.brandId, normalizeStoreLifecycleCore),
            ready: true,
          },
        });
      }
      if (['INVALID_SYSTEM_EXCLUSION_BRAND', 'INVALID_SYSTEM_EXCLUSION_STORES', 'INVALID_SYSTEM_EXCLUSION_REVISION', 'SYSTEM_EXCLUSION_BRAND_MISMATCH'].includes(error?.code)) {
        return res.status(400).json({ ok: false, reason: error.code, message: error.message });
      }
      console.error('manageSystemExclusions failed', error);
      return res.status(500).json({ ok: false, message: '排除店家設定目前無法更新，請稍後再試' });
    }
  });

  async function handleSystemExclusionWrite(change, context, brandIdInput) {
    const brandId = resolveStrictSystemExclusionBrandId(brandIdInput);
    if (!brandId || !change.after.exists) return null;
    const before = normalizeStoredSystemExclusionProfile(
      change.before.exists ? (change.before.data() || {}) : {},
      brandId,
      normalizeStoreLifecycleCore
    );
    const afterData = change.after.data() || {};
    const after = normalizeStoredSystemExclusionProfile(afterData, brandId, normalizeStoreLifecycleCore);
    if (before.revision === after.revision && JSON.stringify(before.stores) === JSON.stringify(after.stores)) return null;
    const tasks = [];
    if (typeof refreshTargetCoverageForSystemExclusion === 'function') {
      tasks.push(refreshTargetCoverageForSystemExclusion({ brandId, exclusionData: afterData }));
    }
    if (typeof markHistoricalSummariesDirtyForSystemExclusion === 'function') {
      tasks.push(markHistoricalSummariesDirtyForSystemExclusion({ brandId, exclusionData: afterData }));
    }
    return tasks.length ? Promise.all(tasks) : null;
  }

  const onLegacySystemExclusionChange = functions.firestore
    .document('artifacts/default-app-id/public/data/global_settings/audit_exclusions')
    .onWrite((change, context) => handleSystemExclusionWrite(change, context, 'cyj'));

  const onBrandSystemExclusionChange = functions.firestore
    .document('brands/{brandId}/settings/audit_exclusions')
    .onWrite((change, context) => handleSystemExclusionWrite(change, context, context.params.brandId));

  return {
    manageSystemExclusions,
    onLegacySystemExclusionChange,
    onBrandSystemExclusionChange,
  };
}

module.exports = {
  SYSTEM_EXCLUSION_VERSION,
  SYSTEM_EXCLUSION_SOURCE,
  resolveStrictSystemExclusionBrandId,
  parseExpectedSystemExclusionRevision,
  normalizeSystemExclusionStores,
  createSystemExclusionFunctions,
};
