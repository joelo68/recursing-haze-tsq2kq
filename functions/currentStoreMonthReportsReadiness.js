const {
  CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION,
  CURRENT_STORE_MONTH_REPORTS_STATUS_COLLECTION,
  normalizeProjectionBrandId,
  getTaipeiYearMonth,
} = require('./currentStoreMonthReports');

const CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION = 'current-store-month-reports-readiness-v1';
const READINESS_CONFIRMATION = 'PROMOTE_CURRENT_STORE_MONTH_REPORTS_READY';

class CurrentStoreMonthReportsReadinessError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function normalizeYearMonth(value = '') {
  const text = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : '';
}

function normalizeAction(value = 'plan') {
  const action = String(value || 'plan').trim().toLowerCase();
  if (!['plan', 'apply'].includes(action)) {
    throw new CurrentStoreMonthReportsReadinessError('INVALID_READINESS_ACTION', 400);
  }
  return action;
}

function normalizeExpectedRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new CurrentStoreMonthReportsReadinessError('INVALID_EXPECTED_REVISION', 400);
  }
  return revision;
}

function hasZeroParityErrors(comparison = {}) {
  return (
    Number(comparison.rawInvalidCount || 0) === 0
    && Number(comparison.rawDuplicateStoreDateCount || 0) === 0
    && Number(comparison.projectionInvalidCount || 0) === 0
    && Number(comparison.projectionDuplicateStoreDateCount || 0) === 0
    && Number(comparison?.sourceOnly?.total || 0) === 0
    && Number(comparison?.projectionOnly?.total || 0) === 0
  );
}

function assessCurrentStoreMonthReadiness({ audit = {} } = {}) {
  const status = audit?.status || {};
  const comparison = audit?.comparison || {};
  const certifiedSourceSignature = String(status.certifiedSourceSignature || '');
  const certifiedProjectionSignature = String(status.certifiedProjectionSignature || '');
  const currentSourceSignature = String(comparison.sourceSignature || '');
  const currentProjectionSignature = String(comparison.projectionSignature || '');

  const base = {
    readinessVersion: CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION,
    consumerReady: false,
    promotable: false,
    code: '',
    certifiedSourceSignature,
    certifiedProjectionSignature,
    currentSourceSignature,
    currentProjectionSignature,
    revision: Number.isInteger(Number(status.revision)) ? Number(status.revision) : 0,
  };

  if (status.exists !== true) {
    return { ...base, code: 'STATUS_MISSING' };
  }
  if (String(status.schemaVersion || '') !== CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION) {
    return { ...base, code: 'STATUS_SCHEMA_MISMATCH' };
  }
  if (String(status.status || '') !== 'BOOTSTRAP_CERTIFIED') {
    return { ...base, code: 'BOOTSTRAP_NOT_CERTIFIED' };
  }
  if (
    !certifiedSourceSignature
    || certifiedSourceSignature !== certifiedProjectionSignature
  ) {
    return { ...base, code: 'BOOTSTRAP_SIGNATURE_INVALID' };
  }
  if (
    comparison.parity !== true
    || !hasZeroParityErrors(comparison)
    || !currentSourceSignature
    || currentSourceSignature !== currentProjectionSignature
  ) {
    return { ...base, code: 'CURRENT_PARITY_FAILED' };
  }

  const persistedReady = (
    status.consumerReady === true
    && String(status.readinessVersion || '') === CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION
    && String(status.readinessStatus || '') === 'CONSUMER_READY'
    && String(status.consumerReadySourceSignature || '')
    && String(status.consumerReadySourceSignature || '') === String(status.consumerReadyProjectionSignature || '')
  );

  if (persistedReady) {
    return {
      ...base,
      consumerReady: true,
      promotable: false,
      code: 'ALREADY_CONSUMER_READY',
    };
  }

  if (currentSourceSignature === certifiedSourceSignature) {
    return { ...base, code: 'WAITING_FOR_LIVE_EVENT' };
  }

  return {
    ...base,
    promotable: true,
    code: 'READY_TO_PROMOTE',
  };
}

function buildPlanResponse(audit = {}) {
  const readiness = assessCurrentStoreMonthReadiness({ audit });
  return {
    ok: true,
    action: 'plan',
    writeMode: false,
    firestoreWrites: 0,
    brandId: String(audit.brandId || ''),
    yearMonth: String(audit.yearMonth || ''),
    readiness,
    audit,
  };
}

function createCurrentStoreMonthReportsReadinessFunctions({
  onRequest,
  admin,
  db,
  getBrandCollection,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
  auditBrandProjection,
} = {}) {
  if (
    typeof onRequest !== 'function'
    || !admin
    || !db
    || typeof getBrandCollection !== 'function'
    || typeof requireFirebaseRequestAuth !== 'function'
    || typeof verifySuperAdminActor !== 'function'
    || typeof auditBrandProjection !== 'function'
  ) {
    throw new Error('current store-month readiness dependencies are incomplete');
  }

  const manageCurrentStoreMonthReportsReadiness = onRequest({
    cors: true,
    timeoutSeconds: 120,
    memory: '512MiB',
  }, async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });
    }

    const requestAuth = await requireFirebaseRequestAuth(req);
    if (!requestAuth?.ok) {
      return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED' });
    }

    try {
      const body = req.body || {};
      const brandId = normalizeProjectionBrandId(body.brandId);
      const yearMonth = normalizeYearMonth(body.yearMonth || getTaipeiYearMonth());
      const currentYearMonth = getTaipeiYearMonth();
      const action = normalizeAction(body.action || 'plan');

      if (!brandId) {
        throw new CurrentStoreMonthReportsReadinessError('UNSUPPORTED_BRAND', 400);
      }
      if (!yearMonth || yearMonth !== currentYearMonth) {
        throw new CurrentStoreMonthReportsReadinessError('CURRENT_MONTH_ONLY', 400, {
          currentYearMonth,
        });
      }

      const actor = body.actor && typeof body.actor === 'object' ? body.actor : {};
      const actorCheck = await verifySuperAdminActor({ db, brandId, actor });
      if (!actorCheck?.ok) {
        throw new CurrentStoreMonthReportsReadinessError('SUPER_ADMIN_REVERIFICATION_REQUIRED', 403);
      }

      const initialAudit = await auditBrandProjection({ db, brandId, yearMonth });
      const initialReadiness = assessCurrentStoreMonthReadiness({ audit: initialAudit });

      if (action === 'plan') {
        return res.status(200).json({
          ...buildPlanResponse(initialAudit),
          currentMonthOnly: true,
        });
      }

      if (String(body.confirmation || '') !== READINESS_CONFIRMATION) {
        throw new CurrentStoreMonthReportsReadinessError('READINESS_CONFIRMATION_REQUIRED', 400);
      }

      const expectedRevision = normalizeExpectedRevision(body.expectedRevision);

      if (initialReadiness.code === 'ALREADY_CONSUMER_READY') {
        return res.status(200).json({
          ok: true,
          action: 'apply',
          writeMode: true,
          changed: false,
          firestoreWrites: 0,
          currentMonthOnly: true,
          brandId,
          yearMonth,
          readiness: initialReadiness,
          audit: initialAudit,
        });
      }

      if (initialReadiness.promotable !== true) {
        return res.status(409).json({
          ok: false,
          action: 'apply',
          writeMode: false,
          firestoreWrites: 0,
          currentMonthOnly: true,
          brandId,
          yearMonth,
          code: initialReadiness.code,
          readiness: initialReadiness,
          audit: initialAudit,
        });
      }

      const statusRef = getBrandCollection(
        db,
        brandId,
        CURRENT_STORE_MONTH_REPORTS_STATUS_COLLECTION
      ).doc(yearMonth);
      const nowText = new Date().toISOString();

      const promotion = await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(statusRef);
        if (!snap.exists) {
          throw new CurrentStoreMonthReportsReadinessError('STATUS_MISSING_DURING_PROMOTION', 409);
        }

        const current = snap.data() || {};
        const currentRevision = Number.isInteger(Number(current.revision))
          ? Number(current.revision)
          : 0;

        if (currentRevision !== expectedRevision) {
          throw new CurrentStoreMonthReportsReadinessError('READINESS_REVISION_CONFLICT', 409, {
            currentRevision,
          });
        }
        if (String(current.schemaVersion || '') !== CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION) {
          throw new CurrentStoreMonthReportsReadinessError('STATUS_SCHEMA_CHANGED', 409);
        }
        if (String(current.status || '') !== 'BOOTSTRAP_CERTIFIED') {
          throw new CurrentStoreMonthReportsReadinessError('BOOTSTRAP_STATUS_CHANGED', 409);
        }

        const sourceSignature = String(current.sourceSignature || '');
        const projectionSignature = String(current.projectionSignature || '');
        if (
          !sourceSignature
          || sourceSignature !== projectionSignature
          || sourceSignature !== initialReadiness.certifiedSourceSignature
          || projectionSignature !== initialReadiness.certifiedProjectionSignature
        ) {
          throw new CurrentStoreMonthReportsReadinessError('BOOTSTRAP_BASELINE_CHANGED', 409);
        }

        if (
          current.consumerReady === true
          && String(current.readinessVersion || '') === CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION
          && String(current.readinessStatus || '') === 'CONSUMER_READY'
        ) {
          return {
            changed: false,
            currentRevision,
            nextRevision: currentRevision,
          };
        }

        const nextRevision = currentRevision + 1;
        transaction.set(statusRef, {
          consumerReady: true,
          readinessStatus: 'CONSUMER_READY',
          readinessVersion: CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION,
          readinessEvidence: 'POST_BOOTSTRAP_LIVE_EVENT_EXACT_PARITY',
          consumerReadySourceSignature: initialReadiness.currentSourceSignature,
          consumerReadyProjectionSignature: initialReadiness.currentProjectionSignature,
          consumerReadyAt: admin.firestore.FieldValue.serverTimestamp(),
          consumerReadyAtText: nowText,
          consumerReadyBy: String(actorCheck.actorName || actorCheck.actorAccountId || '最高管理者'),
          consumerReadyByAccountId: String(actorCheck.actorAccountId || ''),
          consumerReadyByRole: String(actorCheck.actorRole || 'director'),
          revision: nextRevision,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtText: nowText,
        }, { merge: true });

        return {
          changed: true,
          currentRevision,
          nextRevision,
        };
      });

      const postAudit = await auditBrandProjection({ db, brandId, yearMonth });
      const postReadiness = assessCurrentStoreMonthReadiness({ audit: postAudit });
      const postAuditHealthy = (
        postAudit?.comparison?.parity === true
        && hasZeroParityErrors(postAudit?.comparison || {})
        && postReadiness.consumerReady === true
      );

      if (!postAuditHealthy && promotion.changed === true) {
        const revokeText = new Date().toISOString();
        const revoke = await db.runTransaction(async (transaction) => {
          const snap = await transaction.get(statusRef);
          if (!snap.exists) return { changed: false, reason: 'STATUS_MISSING' };
          const current = snap.data() || {};
          const currentRevision = Number.isInteger(Number(current.revision))
            ? Number(current.revision)
            : 0;
          if (currentRevision !== promotion.nextRevision) {
            return {
              changed: false,
              reason: 'REVISION_MOVED',
              currentRevision,
            };
          }
          transaction.set(statusRef, {
            consumerReady: false,
            readinessStatus: 'READINESS_POST_AUDIT_FAILED',
            readinessVersion: CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION,
            readinessRevokedAt: admin.firestore.FieldValue.serverTimestamp(),
            readinessRevokedAtText: revokeText,
            revision: currentRevision + 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: revokeText,
          }, { merge: true });
          return {
            changed: true,
            reason: 'POST_AUDIT_FAILED',
            nextRevision: currentRevision + 1,
          };
        });

        return res.status(409).json({
          ok: false,
          action: 'apply',
          writeMode: true,
          changed: promotion.changed,
          firestoreWrites: promotion.changed ? 1 + (revoke.changed ? 1 : 0) : 0,
          currentMonthOnly: true,
          brandId,
          yearMonth,
          code: 'READINESS_POST_AUDIT_FAILED',
          promotion,
          revoke,
          initialReadiness,
          postReadiness,
          postAudit,
        });
      }

      return res.status(200).json({
        ok: true,
        action: 'apply',
        writeMode: true,
        changed: promotion.changed,
        firestoreWrites: promotion.changed ? 1 : 0,
        currentMonthOnly: true,
        brandId,
        yearMonth,
        readiness: postReadiness,
        promotion,
        initialAudit,
        postAudit,
      });
    } catch (error) {
      const status = Number(error?.status || 500);
      const code = String(error?.code || error?.message || 'READINESS_FAILED');
      if (status >= 500) {
        console.error('manageCurrentStoreMonthReportsReadiness failed', code, error);
      }
      return res.status(status).json({
        ok: false,
        code,
        ...(error?.details && typeof error.details === 'object' ? error.details : {}),
      });
    }
  });

  return { manageCurrentStoreMonthReportsReadiness };
}

module.exports = {
  CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION,
  READINESS_CONFIRMATION,
  CurrentStoreMonthReportsReadinessError,
  normalizeYearMonth,
  normalizeAction,
  normalizeExpectedRevision,
  hasZeroParityErrors,
  assessCurrentStoreMonthReadiness,
  buildPlanResponse,
  createCurrentStoreMonthReportsReadinessFunctions,
};
