const { onRequest } = require('firebase-functions/v2/https');
const {
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
} = require('./deviceApproval');

const MODULE_PERMISSIONS_SCHEMA_VERSION = 'module-permissions-v1';
const MODULE_PERMISSION_ROLES = Object.freeze(['director', 'trainer', 'manager', 'store', 'therapist']);

function resolveModulePermissionsBrandId(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (['default', 'default-app-id', 'drcyj', 'cyj'].includes(raw)) return 'cyj';
  if (['anniu', 'anew', '安妞'].includes(raw)) return 'anniu';
  if (['yibo', '伊啵'].includes(raw)) return 'yibo';
  return '';
}

function normalizeModulePermissionId(value = '') {
  const id = String(value || '').trim();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ? id : '';
}

function normalizeModulePermissions(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const normalized = {};
  MODULE_PERMISSION_ROLES.forEach((role) => {
    normalized[role] = [...new Set(
      (Array.isArray(source[role]) ? source[role] : [])
        .map(normalizeModulePermissionId)
        .filter(Boolean)
    )].sort();
  });
  return normalized;
}

function parseExpectedPermissionRevision(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    const error = new Error('權限版本無效，請重新載入後再操作');
    error.code = 'MODULE_PERMISSIONS_REVISION_INVALID';
    throw error;
  }
  return parsed;
}

function createModulePermissionsFunctions({ admin, db }) {
  const manageModulePermissions = onRequest({ cors: true, timeoutSeconds: 20, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });

    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });

    const body = req.body || {};
    const brandId = resolveModulePermissionsBrandId(body.brandId);
    if (!brandId) return res.status(400).json({ ok: false, message: '不支援的品牌識別' });

    try {
      const actorCheck = await verifySuperAdminActor({ db, brandId, actor: body.actor || {} });
      if (!actorCheck.ok) {
        return res.status(403).json({ ok: false, message: '此操作僅限已信任裝置上的最高管理者使用' });
      }

      const expectedRevision = parseExpectedPermissionRevision(body.expectedRevision);
      const requestedPermissions = normalizeModulePermissions(body.permissions || {});
      const permissionsRef = getBrandSettingDoc(db, brandId, 'permissions');
      const auditRef = getBrandCollection(db, brandId, 'maintenance_logs').doc();
      let result = null;

      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(permissionsRef);
        const current = snap.exists ? (snap.data() || {}) : {};
        const currentRevision = Math.max(0, Number(current.revision || 0));

        if (currentRevision !== expectedRevision) {
          const error = new Error('模組權限已由其他最高管理者更新，請重新載入後再儲存');
          error.code = 'MODULE_PERMISSIONS_CONFLICT';
          error.currentPermissions = {
            ...normalizeModulePermissions(current),
            schemaVersion: String(current.schemaVersion || MODULE_PERMISSIONS_SCHEMA_VERSION),
            revision: currentRevision,
            updatedAtText: String(current.updatedAtText || ''),
            updatedBy: String(current.updatedBy || ''),
          };
          throw error;
        }

        const nextRevision = currentRevision + 1;
        const nowText = new Date().toISOString();
        const payload = {
          schemaVersion: MODULE_PERMISSIONS_SCHEMA_VERSION,
          revision: nextRevision,
          ...requestedPermissions,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtText: nowText,
          updatedBy: actorCheck.actorName,
          updatedByRole: actorCheck.actorRole,
          updatedByAccountId: actorCheck.actorAccountId,
        };

        transaction.set(permissionsRef, payload, { merge: false });
        transaction.set(auditRef, {
          type: 'module_permissions',
          action: 'update',
          brandId,
          operator: actorCheck.actorName,
          operatorRole: actorCheck.actorRole,
          operatorAccountId: actorCheck.actorAccountId,
          revision: nextRevision,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAtText: nowText,
          source: 'manageModulePermissions',
        }, { merge: false });

        result = {
          ...requestedPermissions,
          schemaVersion: MODULE_PERMISSIONS_SCHEMA_VERSION,
          revision: nextRevision,
          updatedAtText: nowText,
          updatedBy: actorCheck.actorName,
          updatedByRole: actorCheck.actorRole,
          updatedByAccountId: actorCheck.actorAccountId,
        };
      });

      return res.status(200).json({ ok: true, permissions: result });
    } catch (error) {
      console.error('manageModulePermissions failed', error);
      if (error?.code === 'MODULE_PERMISSIONS_CONFLICT') {
        return res.status(409).json({
          ok: false,
          code: error.code,
          message: error.message,
          currentPermissions: error.currentPermissions || null,
        });
      }
      if (error?.code === 'MODULE_PERMISSIONS_REVISION_INVALID') {
        return res.status(400).json({ ok: false, code: error.code, message: error.message });
      }
      return res.status(500).json({ ok: false, message: '模組權限更新失敗，請稍後再試' });
    }
  });

  return { manageModulePermissions };
}

module.exports = {
  createModulePermissionsFunctions,
  MODULE_PERMISSIONS_SCHEMA_VERSION,
  normalizeModulePermissions,
  resolveModulePermissionsBrandId,
};
