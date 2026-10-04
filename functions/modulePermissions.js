const { onRequest } = require('firebase-functions/v2/https');
const {
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
} = require('./deviceApproval');

const MODULE_PERMISSIONS_SCHEMA_VERSION = 'module-permissions-v2';
const MODULE_PERMISSION_ROLES = Object.freeze(['director', 'trainer', 'manager', 'store', 'therapist']);
const DIRECTOR_PERMISSION_LEVELS = Object.freeze(['operation_admin', 'finance_admin', 'viewer']);
const DIRECTOR_PERMISSION_REQUIRED_VIEW_IDS = Object.freeze(['dashboard']);
const DIRECTOR_PERMISSION_SUPER_ADMIN_ONLY_VIEW_IDS = new Set(['settings']);
const DEFAULT_DIRECTOR_LEVEL_PERMISSIONS = Object.freeze({
  operation_admin: Object.freeze([
    'dashboard', 'daily', 'regional', 'ranking', 'store-analysis', 'audit',
    'annual', 'smart-forecast', 'logs', 'notification',
  ]),
  finance_admin: Object.freeze([
    'dashboard', 'daily', 'regional', 'ranking', 'store-analysis', 'annual', 'smart-forecast',
  ]),
  viewer: Object.freeze([
    'dashboard', 'daily', 'regional', 'ranking', 'store-analysis', 'annual',
  ]),
});


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

function normalizeDirectorLevelPermissions(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const normalized = {};

  DIRECTOR_PERMISSION_LEVELS.forEach((levelId) => {
    const configured = Array.isArray(source[levelId])
      ? source[levelId]
      : DEFAULT_DIRECTOR_LEVEL_PERMISSIONS[levelId];

    const ids = [...new Set(
      configured
        .map(normalizeModulePermissionId)
        .filter(Boolean)
        .filter((viewId) => !DIRECTOR_PERMISSION_SUPER_ADMIN_ONLY_VIEW_IDS.has(viewId))
    )];

    DIRECTOR_PERMISSION_REQUIRED_VIEW_IDS.forEach((viewId) => {
      if (!ids.includes(viewId)) ids.unshift(viewId);
    });

    normalized[levelId] = ids.sort();
  });

  return normalized;
}

function normalizeBaseModulePermissions(raw = {}) {
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

function normalizeModulePermissions(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...normalizeBaseModulePermissions(source),
    directorLevels: normalizeDirectorLevelPermissions(source.directorLevels || {}),
  };
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
      const rawRequestedPermissions = body.permissions && typeof body.permissions === 'object' && !Array.isArray(body.permissions)
        ? body.permissions
        : {};
      const requestHasDirectorLevels = Object.prototype.hasOwnProperty.call(rawRequestedPermissions, 'directorLevels');
      const requestedBasePermissions = normalizeBaseModulePermissions(rawRequestedPermissions);
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
            ...normalizeBaseModulePermissions(current),
            directorLevels: normalizeDirectorLevelPermissions(current.directorLevels || {}),
            schemaVersion: String(current.schemaVersion || MODULE_PERMISSIONS_SCHEMA_VERSION),
            revision: currentRevision,
            updatedAtText: String(current.updatedAtText || ''),
            updatedBy: String(current.updatedBy || ''),
          };
          throw error;
        }

        const nextRevision = currentRevision + 1;
        const nowText = new Date().toISOString();
        const directorLevels = requestHasDirectorLevels
          ? normalizeDirectorLevelPermissions(rawRequestedPermissions.directorLevels || {})
          : normalizeDirectorLevelPermissions(current.directorLevels || {});
        const requestedPermissions = {
          ...requestedBasePermissions,
          directorLevels,
        };
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
  DIRECTOR_PERMISSION_LEVELS,
  DEFAULT_DIRECTOR_LEVEL_PERMISSIONS,
  normalizeDirectorLevelPermissions,
  normalizeBaseModulePermissions,
  normalizeModulePermissions,
  resolveModulePermissionsBrandId,
};
