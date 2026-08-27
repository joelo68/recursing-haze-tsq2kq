const { onRequest } = require('firebase-functions/v2/https');
const {
  normalizeBrandId,
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
} = require('./deviceApproval');

const STORE_LIFECYCLE_SCHEMA_VERSION = 'store-lifecycle-v1';
const DATASET_STATUSES = new Set(['BUILDING', 'READY']);

const BRAND_PREFIX = Object.freeze({
  cyj: 'CYJ',
  anniu: '安妞',
  yibo: '伊啵',
});

function resolveRequestedBrandId(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (['cyj', 'default', 'default-app-id', 'drcyj'].includes(raw)) return 'cyj';
  if (['anniu', 'anew', '安妞'].includes(raw)) return 'anniu';
  if (['yibo', '伊啵'].includes(raw)) return 'yibo';
  return '';
}

function detectStoreBrandFromName(value = '') {
  const text = String(value || '').trim().replace(/[　\s]+/g, '');
  if (/^(DR\.?CYJ|CYJ)/i.test(text)) return 'cyj';
  if (/^(Anew安妞|Anew|Ann|安妞)/i.test(text)) return 'anniu';
  if (/^(Yibo伊啵|Yibo|伊啵)/i.test(text)) return 'yibo';
  return '';
}

function normalizeStoreLifecycleCore(value = '') {
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
  const core = normalizeStoreLifecycleCore(value);
  if (!core) return '';
  const normalizedBrandId = normalizeBrandId(brandId);
  return `${BRAND_PREFIX[normalizedBrandId] || BRAND_PREFIX.cyj}${core}店`;
}

function normalizeYearMonth(value = '') {
  const text = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : '';
}

function normalizeIsoDate(value = '') {
  const text = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(text)) return '';
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const [year, month, day] = text.split('-').map(Number);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return '';
  return text;
}

function normalizeExemptMonths(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeYearMonth).filter(Boolean))].sort();
}

function validateLifecycleDraft(raw = {}) {
  const errors = [];
  const firstRaw = String(raw.firstEligibleMonth || '').trim();
  const openRaw = String(raw.openDate || '').trim();
  const lastRaw = String(raw.lastEligibleMonth || '').trim();
  const closeRaw = String(raw.closeDate || '').trim();

  const firstEligibleMonth = normalizeYearMonth(firstRaw);
  const openDate = normalizeIsoDate(openRaw);
  const lastEligibleMonth = normalizeYearMonth(lastRaw);
  const closeDate = normalizeIsoDate(closeRaw);
  const rawExemptMonths = raw.exemptMonths == null ? [] : raw.exemptMonths;
  const exemptMonths = normalizeExemptMonths(rawExemptMonths);

  if (!Array.isArray(rawExemptMonths)) errors.push('暫停營運月份格式必須是月份清單');
  else if (rawExemptMonths.some((month) => String(month || '').trim() && !normalizeYearMonth(month))) errors.push('暫停營運月份格式需為 YYYY-MM');
  if (firstRaw && !firstEligibleMonth) errors.push('納入月份格式需為 YYYY-MM');
  if (openRaw && !openDate) errors.push('開始日期格式需為 YYYY-MM-DD');
  if (lastRaw && !lastEligibleMonth) errors.push('永久結束月份格式需為 YYYY-MM');
  if (closeRaw && !closeDate) errors.push('永久結束日期格式需為 YYYY-MM-DD');

  if (firstEligibleMonth && openDate && openDate.slice(0, 7) !== firstEligibleMonth) {
    errors.push('開始日期必須落在納入月份內');
  }
  if (lastEligibleMonth && closeDate && closeDate.slice(0, 7) !== lastEligibleMonth) {
    errors.push('永久結束日期必須落在永久結束月份內');
  }
  if (firstEligibleMonth && lastEligibleMonth && lastEligibleMonth < firstEligibleMonth) {
    errors.push('永久結束月份不可早於納入月份');
  }
  if (openDate && closeDate && closeDate < openDate) {
    errors.push('永久結束日期不可早於開始日期');
  }
  if (exemptMonths.length && !firstEligibleMonth) {
    errors.push('設定暫停營運月份前，請先設定納入月份');
  }
  if (firstEligibleMonth && exemptMonths.some((month) => month < firstEligibleMonth)) {
    errors.push('暫停營運月份不可早於納入月份');
  }
  if (lastEligibleMonth && exemptMonths.some((month) => month > lastEligibleMonth)) {
    errors.push('暫停營運月份不可晚於永久結束月份');
  }
  if (firstEligibleMonth && exemptMonths.includes(firstEligibleMonth)) {
    errors.push('開店／納入月份必須是正式納管月份，不可同時設為整月暫停');
  }
  if (lastEligibleMonth && exemptMonths.includes(lastEligibleMonth)) {
    errors.push('永久結束月份仍是正式納管月份，不可同時設為整月暫停');
  }

  const hasFirst = Boolean(firstEligibleMonth);
  const hasOpen = Boolean(openDate);
  const hasLast = Boolean(lastEligibleMonth);
  const hasClose = Boolean(closeDate);
  let entryStatus = 'INCOMPLETE';
  if (errors.length) entryStatus = 'INVALID';
  else if (hasFirst && hasOpen && hasLast === hasClose) entryStatus = 'COMPLETE';

  return {
    valid: errors.length === 0,
    errors,
    entryStatus,
    normalized: {
      firstEligibleMonth,
      openDate,
      lastEligibleMonth,
      closeDate,
      exemptMonths,
    },
  };
}

function buildLifecycleEntry({ raw = {}, storeName = '', brandId, previous = {}, actor }) {
  const storeKey = normalizeStoreLifecycleCore(storeName || raw.storeKey || raw.canonicalStoreName || previous.storeKey || previous.canonicalStoreName);
  if (!storeKey) {
    const error = new Error('請指定有效的店家名稱');
    error.code = 'INVALID_STORE_IDENTITY';
    throw error;
  }

  const canonicalStoreName = getCanonicalStoreName(storeName || raw.canonicalStoreName || storeKey, brandId);
  const validation = validateLifecycleDraft(raw);
  if (!validation.valid) {
    const error = new Error(validation.errors.join('；'));
    error.code = 'INVALID_LIFECYCLE';
    error.details = validation.errors;
    throw error;
  }

  const nowText = new Date().toISOString();
  return {
    storeKey,
    coreStoreName: storeKey,
    canonicalStoreName,
    firstEligibleMonth: validation.normalized.firstEligibleMonth,
    lastEligibleMonth: validation.normalized.lastEligibleMonth,
    exemptMonths: validation.normalized.exemptMonths,
    openDate: validation.normalized.openDate,
    closeDate: validation.normalized.closeDate,
    entryStatus: validation.entryStatus,
    revision: Math.max(0, Number(previous.revision || 0)) + 1,
    createdAtText: String(previous.createdAtText || nowText),
    createdBy: String(previous.createdBy || actor.actorName || ''),
    createdByAccountId: String(previous.createdByAccountId || actor.actorAccountId || ''),
    updatedAtText: nowText,
    updatedBy: String(actor.actorName || ''),
    updatedByRole: String(actor.actorRole || ''),
    updatedByAccountId: String(actor.actorAccountId || ''),
  };
}

function getCurrentOrgStoreKeys(orgData = {}) {
  const managers = orgData && orgData.managers && typeof orgData.managers === 'object'
    ? orgData.managers
    : {};
  return [...new Set(
    Object.values(managers)
      .flatMap((stores) => Array.isArray(stores) ? stores : [])
      .map(normalizeStoreLifecycleCore)
      .filter(Boolean)
  )].sort();
}

function buildReadyValidation({ stores = {}, currentOrgStoreKeys = [] }) {
  const errors = [];
  const entries = Object.values(stores || {});
  if (!entries.length) errors.push('目前沒有任何門市生命週期資料');

  const incomplete = entries
    .filter((entry) => {
      const check = validateLifecycleDraft(entry || {});
      return !check.valid || check.entryStatus !== 'COMPLETE';
    })
    .map((entry) => entry?.canonicalStoreName || entry?.storeKey || '未知門市');
  if (incomplete.length) {
    errors.push(`仍有 ${incomplete.length} 間門市資料未完整：${incomplete.slice(0, 8).join('、')}${incomplete.length > 8 ? '…' : ''}`);
  }

  const missingCurrentStores = currentOrgStoreKeys.filter((key) => !stores?.[key]);
  if (missingCurrentStores.length) {
    errors.push(`目前組織架構仍有 ${missingCurrentStores.length} 間門市尚未建立生命週期：${missingCurrentStores.slice(0, 8).join('、')}${missingCurrentStores.length > 8 ? '…' : ''}`);
  }

  return { valid: errors.length === 0, errors, incomplete, missingCurrentStores };
}

function buildLifecycleAuditPayload({ admin, brandId, actor, action, details = {} }) {
  return {
    type: 'store_lifecycle',
    action,
    brandId: normalizeBrandId(brandId),
    operator: String(actor.actorName || ''),
    operatorRole: String(actor.actorRole || ''),
    operatorAccountId: String(actor.actorAccountId || ''),
    details,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtText: new Date().toISOString(),
    source: 'manageStoreLifecycle',
  };
}

function createStoreLifecycleFunctions({ admin, db }) {
  const manageStoreLifecycle = onRequest({ cors: true, timeoutSeconds: 20, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });

    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });

    const body = req.body || {};
    const requestedBrandId = resolveRequestedBrandId(body.brandId);
    if (!requestedBrandId) return res.status(400).json({ ok: false, message: '不支援的品牌識別' });
    const brandId = normalizeBrandId(requestedBrandId);
    const action = String(body.action || '').trim();
    const actor = body.actor || {};

    try {
      const adminCheck = await verifySuperAdminActor({ db, brandId, actor });
      if (!adminCheck.ok) {
        return res.status(403).json({ ok: false, message: '此操作僅限已信任裝置上的最高管理者使用' });
      }

      const lifecycleRef = getBrandCollection(db, brandId, 'store_lifecycle').doc('master');

      if (action === 'upsert_store') {
        const storeName = String(body.storeName || body.entry?.canonicalStoreName || body.entry?.storeKey || '').trim();
        const explicitStoreBrand = detectStoreBrandFromName(storeName);
        if (explicitStoreBrand && explicitStoreBrand !== brandId) {
          return res.status(400).json({ ok: false, code: 'BRAND_MISMATCH', message: '店名品牌前綴與目前品牌不一致，已拒絕寫入' });
        }
        const requestedKey = normalizeStoreLifecycleCore(storeName);
        if (!requestedKey) return res.status(400).json({ ok: false, message: '請指定有效的店家名稱' });
        const expectedStoreRevision = Math.max(0, Number(body.expectedStoreRevision || 0));
        const auditRef = getBrandCollection(db, brandId, 'maintenance_logs').doc();
        let result = null;

        await db.runTransaction(async (transaction) => {
          const snap = await transaction.get(lifecycleRef);
          const master = snap.exists ? (snap.data() || {}) : {};
          const stores = master.stores && typeof master.stores === 'object' ? { ...master.stores } : {};
          const previous = stores[requestedKey] || null;
          const currentRevision = Math.max(0, Number(previous?.revision || 0));

          if (currentRevision !== expectedStoreRevision) {
            const error = new Error('這間店的生命週期資料剛剛已由其他管理者更新，請重新載入後再確認');
            error.code = 'LIFECYCLE_CONFLICT';
            error.currentRevision = currentRevision;
            throw error;
          }

          const nextEntry = buildLifecycleEntry({
            raw: body.entry || {},
            storeName,
            brandId,
            previous: previous || {},
            actor: adminCheck,
          });

          if (String(master.datasetStatus || '') === 'READY' && nextEntry.entryStatus !== 'COMPLETE') {
            const error = new Error('資料集目前已完成確認；若要儲存未完整草稿，請先將資料集改回「建置中」');
            error.code = 'LIFECYCLE_NOT_READY';
            throw error;
          }

          stores[nextEntry.storeKey] = nextEntry;

          const nowText = new Date().toISOString();
          const nextMasterRevision = Math.max(0, Number(master.revision || 0)) + 1;
          const datasetStatus = DATASET_STATUSES.has(String(master.datasetStatus || ''))
            ? String(master.datasetStatus)
            : 'BUILDING';

          transaction.set(lifecycleRef, {
            schemaVersion: STORE_LIFECYCLE_SCHEMA_VERSION,
            brandId,
            datasetStatus,
            revision: nextMasterRevision,
            stores,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: nowText,
            updatedBy: adminCheck.actorName,
            updatedByRole: adminCheck.actorRole,
            updatedByAccountId: adminCheck.actorAccountId,
          }, { merge: true });

          transaction.set(auditRef, buildLifecycleAuditPayload({
            admin,
            brandId,
            actor: adminCheck,
            action: 'upsert_store',
            details: {
              storeKey: nextEntry.storeKey,
              canonicalStoreName: nextEntry.canonicalStoreName,
              entryRevision: nextEntry.revision,
              masterRevision: nextMasterRevision,
              entryStatus: nextEntry.entryStatus,
            },
          }), { merge: false });

          result = { entry: nextEntry, masterRevision: nextMasterRevision, datasetStatus };
        });

        return res.status(200).json({ ok: true, ...result });
      }

      if (action === 'set_dataset_status') {
        const nextStatus = String(body.datasetStatus || '').trim().toUpperCase();
        if (!DATASET_STATUSES.has(nextStatus)) {
          return res.status(400).json({ ok: false, message: '不支援的資料集狀態' });
        }
        const expectedMasterRevision = Math.max(0, Number(body.expectedMasterRevision || 0));
        const auditRef = getBrandCollection(db, brandId, 'maintenance_logs').doc();
        let result = null;

        await db.runTransaction(async (transaction) => {
          const [lifecycleSnap, orgSnap] = await Promise.all([
            transaction.get(lifecycleRef),
            transaction.get(getBrandSettingDoc(db, brandId, 'org_structure')),
          ]);
          const master = lifecycleSnap.exists ? (lifecycleSnap.data() || {}) : {};
          const currentMasterRevision = Math.max(0, Number(master.revision || 0));
          if (currentMasterRevision !== expectedMasterRevision) {
            const error = new Error('門市生命週期資料已更新，請重新載入後再變更資料集狀態');
            error.code = 'LIFECYCLE_CONFLICT';
            error.currentRevision = currentMasterRevision;
            throw error;
          }

          const stores = master.stores && typeof master.stores === 'object' ? master.stores : {};
          if (nextStatus === 'READY') {
            const currentOrgStoreKeys = getCurrentOrgStoreKeys(orgSnap.exists ? (orgSnap.data() || {}) : {});
            const readyCheck = buildReadyValidation({ stores, currentOrgStoreKeys });
            if (!readyCheck.valid) {
              const error = new Error(readyCheck.errors.join('；'));
              error.code = 'LIFECYCLE_NOT_READY';
              error.details = readyCheck.errors;
              throw error;
            }
          }

          const nowText = new Date().toISOString();
          const nextMasterRevision = currentMasterRevision + 1;
          const patch = {
            schemaVersion: STORE_LIFECYCLE_SCHEMA_VERSION,
            brandId,
            datasetStatus: nextStatus,
            revision: nextMasterRevision,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: nowText,
            updatedBy: adminCheck.actorName,
            updatedByRole: adminCheck.actorRole,
            updatedByAccountId: adminCheck.actorAccountId,
          };

          if (nextStatus === 'READY') {
            patch.certifiedAt = admin.firestore.FieldValue.serverTimestamp();
            patch.certifiedAtText = nowText;
            patch.certifiedBy = adminCheck.actorName;
            patch.certifiedByRole = adminCheck.actorRole;
            patch.certifiedByAccountId = adminCheck.actorAccountId;
          } else {
            patch.certifiedAt = admin.firestore.FieldValue.delete();
            patch.certifiedAtText = '';
            patch.certifiedBy = '';
            patch.certifiedByRole = '';
            patch.certifiedByAccountId = '';
          }

          transaction.set(lifecycleRef, patch, { merge: true });
          transaction.set(auditRef, buildLifecycleAuditPayload({
            admin,
            brandId,
            actor: adminCheck,
            action: 'set_dataset_status',
            details: { datasetStatus: nextStatus, masterRevision: nextMasterRevision },
          }), { merge: false });
          result = { datasetStatus: nextStatus, masterRevision: nextMasterRevision };
        });

        return res.status(200).json({ ok: true, ...result });
      }

      return res.status(400).json({ ok: false, message: '不支援的門市生命週期操作' });
    } catch (error) {
      console.error('manageStoreLifecycle failed', error);
      if (error?.code === 'LIFECYCLE_CONFLICT') {
        return res.status(409).json({
          ok: false,
          code: error.code,
          message: error.message,
          currentRevision: Number(error.currentRevision || 0),
        });
      }
      if (error?.code === 'LIFECYCLE_NOT_READY' || error?.code === 'INVALID_LIFECYCLE' || error?.code === 'INVALID_STORE_IDENTITY') {
        return res.status(400).json({
          ok: false,
          code: error.code,
          message: error.message,
          details: Array.isArray(error.details) ? error.details : [],
        });
      }
      return res.status(500).json({ ok: false, message: '門市生命週期更新失敗，請稍後再試' });
    }
  });

  return { manageStoreLifecycle };
}

module.exports = {
  createStoreLifecycleFunctions,
  STORE_LIFECYCLE_SCHEMA_VERSION,
  resolveRequestedBrandId,
  detectStoreBrandFromName,
  normalizeStoreLifecycleCore,
  getCanonicalStoreName,
  validateLifecycleDraft,
  buildReadyValidation,
};
