const { randomUUID } = require('node:crypto');
const { onRequest } = require('firebase-functions/v2/https');
const {
  getBrandCollection,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
} = require('./deviceApproval');
const {
  normalizeStoreLifecycleCore,
  getCanonicalStoreName,
  detectStoreBrandFromName,
} = require('./storeLifecycle');
const {
  CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION,
  CURRENT_STORE_MONTH_REPORTS_COLLECTION,
  CURRENT_STORE_MONTH_REPORTS_STATUS_COLLECTION,
  normalizeProjectionBrandId,
  getTaipeiYearMonth,
  normalizeEventTimestamp,
  encodeKey,
  buildProjectedReportRow,
  buildProjectionBucket,
  applySourceEventToProjectionData,
} = require('./currentStoreMonthReports');
const {
  normalizeYearMonth,
  getMonthBounds,
  timestampToIso,
  buildRawParityInventory,
  buildProjectionParityInventory,
  auditBrandProjection,
} = require('./currentStoreMonthReportsAudit');

const CURRENT_STORE_MONTH_REPORTS_BOOTSTRAP_VERSION = 'current-store-month-reports-bootstrap-v1';
const BOOTSTRAP_CONFIRMATION = 'BOOTSTRAP_CURRENT_STORE_MONTH_REPORTS';
const BOOTSTRAP_LEASE_MS = 5 * 60 * 1000;

function projectionBucketFromData(data = {}, brandIdInput = '', yearMonthInput = '') {
  const brandId = normalizeProjectionBrandId(brandIdInput);
  const yearMonth = normalizeYearMonth(yearMonthInput);
  const storeKey = String(data?.storeKey || '').trim();
  if (!brandId || !yearMonth || !storeKey) return null;
  return {
    brandId,
    yearMonth,
    storeKey,
    canonicalStoreName: String(data?.canonicalStoreName || getCanonicalStoreName(storeKey, brandId) || '').trim(),
    documentId: `${yearMonth}_${encodeKey(storeKey)}`,
    bucketKey: `${brandId}:${yearMonth}:${storeKey}`,
  };
}

function buildBootstrapBucketPlan({
  rawRows = [],
  projectionDocs = [],
  brandId: brandIdInput = '',
  yearMonth: yearMonthInput = '',
  snapshotCutoff = '',
} = {}) {
  const brandId = normalizeProjectionBrandId(brandIdInput);
  const yearMonth = normalizeYearMonth(yearMonthInput);
  const cutoff = normalizeEventTimestamp(snapshotCutoff);
  if (!brandId || !yearMonth || !cutoff) return { ok: false, reason: 'INVALID_BOOTSTRAP_SCOPE' };

  const rawInventory = buildRawParityInventory(rawRows, brandId);
  const projectionInventory = buildProjectionParityInventory(projectionDocs, brandId, yearMonth);
  if (rawInventory.invalidRows.length) return { ok: false, reason: 'RAW_INVALID', rawInventory, projectionInventory };
  if (rawInventory.duplicateStoreDates.length) return { ok: false, reason: 'RAW_DUPLICATE_STORE_DATE', rawInventory, projectionInventory };
  if (projectionInventory.invalidDocs.length) return { ok: false, reason: 'PROJECTION_INVALID', rawInventory, projectionInventory };
  if (projectionInventory.duplicateStoreDates.length) return { ok: false, reason: 'PROJECTION_DUPLICATE_STORE_DATE', rawInventory, projectionInventory };

  const rawBySourceId = new Map();
  const rawByBucket = new Map();

  for (const item of rawRows) {
    const sourceReportId = String(item?.id || item?.sourceReportId || '').trim();
    const row = buildProjectedReportRow(item?.data || {}, sourceReportId);
    const bucket = buildProjectionBucket({
      row,
      brandId,
      normalizeStoreCore: normalizeStoreLifecycleCore,
      getCanonicalStoreName,
      detectStoreBrandFromName,
    });
    const updateTime = timestampToIso(item?.updateTime);
    if (!sourceReportId || !row || !bucket || bucket.yearMonth !== yearMonth || !updateTime) {
      return { ok: false, reason: 'RAW_PLAN_INVALID', sourceReportId };
    }
    const entry = { sourceReportId, row, bucket, eventTimestamp: updateTime };
    rawBySourceId.set(sourceReportId, entry);
    if (!rawByBucket.has(bucket.bucketKey)) rawByBucket.set(bucket.bucketKey, { bucket, rawEntries: [] });
    rawByBucket.get(bucket.bucketKey).rawEntries.push(entry);
  }

  const projectionByBucket = new Map();
  for (const item of projectionDocs) {
    const data = item?.data || {};
    const bucket = projectionBucketFromData(data, brandId, yearMonth);
    if (!bucket || String(item?.id || '') !== bucket.documentId) {
      return { ok: false, reason: 'PROJECTION_PLAN_INVALID', documentId: String(item?.id || '') };
    }
    projectionByBucket.set(bucket.bucketKey, { bucket, data });
  }

  const bucketKeys = [...new Set([...rawByBucket.keys(), ...projectionByBucket.keys()])].sort();
  const buckets = bucketKeys.map((bucketKey) => {
    const rawPart = rawByBucket.get(bucketKey);
    const projectionPart = projectionByBucket.get(bucketKey);
    const bucket = rawPart?.bucket || projectionPart?.bucket;
    return {
      bucket,
      rawEntries: [...(rawPart?.rawEntries || [])].sort((a, b) => (
        String(a.eventTimestamp).localeCompare(String(b.eventTimestamp))
        || String(a.sourceReportId).localeCompare(String(b.sourceReportId))
      )),
    };
  });

  return {
    ok: true,
    brandId,
    yearMonth,
    snapshotCutoff: cutoff,
    rawInventory,
    projectionInventory,
    rawBySourceId,
    buckets,
  };
}

function mergeBootstrapBucketData({
  currentData = {},
  bucket,
  rawEntries = [],
  rawBySourceId = new Map(),
  snapshotCutoff = '',
} = {}) {
  let data = currentData && typeof currentData === 'object' ? currentData : {};
  let changed = false;
  let appliedActive = 0;
  let appliedTombstones = 0;
  let preservedNewerEvents = 0;

  const currentEvents = data?.sourceEvents && typeof data.sourceEvents === 'object'
    ? Object.values(data.sourceEvents)
    : [];

  for (const existing of currentEvents) {
    if (existing?.exists !== true || !existing?.sourceReportId) continue;
    const sourceReportId = String(existing.sourceReportId).trim();
    const expected = rawBySourceId.get(sourceReportId);
    const stillBelongsHere = expected?.bucket?.bucketKey === bucket.bucketKey;
    if (stillBelongsHere) continue;

    const existingTimestamp = normalizeEventTimestamp(existing.eventTimestamp);
    if (existingTimestamp && existingTimestamp > snapshotCutoff) {
      preservedNewerEvents += 1;
      continue;
    }

    const applied = applySourceEventToProjectionData(data, {
      bucket,
      sourceReportId,
      eventTimestamp: snapshotCutoff,
      exists: false,
      row: null,
    });
    data = applied.data;
    if (applied.changed) {
      changed = true;
      appliedTombstones += 1;
    }
  }

  for (const entry of rawEntries) {
    const applied = applySourceEventToProjectionData(data, {
      bucket,
      sourceReportId: entry.sourceReportId,
      eventTimestamp: entry.eventTimestamp,
      exists: true,
      row: entry.row,
    });
    data = applied.data;
    if (applied.changed) {
      changed = true;
      appliedActive += 1;
    } else if (applied.reason === 'STALE_OR_DUPLICATE_EVENT') {
      preservedNewerEvents += 1;
    }
  }

  return { changed, data, appliedActive, appliedTombstones, preservedNewerEvents };
}

function createBootstrapBusyError() {
  const error = new Error('BOOTSTRAP_BUSY');
  error.code = 'BOOTSTRAP_BUSY';
  return error;
}

async function acquireBootstrapLease({ admin, db, brandId, yearMonth, actorMeta }) {
  const statusRef = getBrandCollection(db, brandId, CURRENT_STORE_MONTH_REPORTS_STATUS_COLLECTION).doc(yearMonth);
  const nowMs = Date.now();
  const runId = randomUUID();

  const lease = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(statusRef);
    const current = snap.exists ? (snap.data() || {}) : {};
    const leaseUntilMs = current?.leaseUntil?.toMillis?.() || 0;
    if (String(current.status || '') === 'BOOTSTRAP_RUNNING' && leaseUntilMs > nowMs) {
      throw createBootstrapBusyError();
    }

    const revision = Number.isInteger(Number(current.revision)) ? Number(current.revision) + 1 : 1;
    transaction.set(statusRef, {
      schemaVersion: CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION,
      bootstrapVersion: CURRENT_STORE_MONTH_REPORTS_BOOTSTRAP_VERSION,
      brandId,
      yearMonth,
      status: 'BOOTSTRAP_RUNNING',
      consumerReady: false,
      certificationIsPointInTime: true,
      revision,
      runId,
      actorAccountId: String(actorMeta?.actorAccountId || ''),
      actorName: String(actorMeta?.actorName || ''),
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      leaseUntil: admin.firestore.Timestamp.fromMillis(nowMs + BOOTSTRAP_LEASE_MS),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: false });
    return { runId, revision };
  });

  return { ...lease, statusRef };
}

async function finalizeBootstrapStatus({
  admin,
  db,
  statusRef,
  runId,
  status,
  comparison = {},
  raw = {},
  projection = {},
  errorMessage = '',
}) {
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(statusRef);
    const current = snap.exists ? (snap.data() || {}) : {};
    if (String(current.runId || '') !== String(runId || '')) {
      const error = new Error('BOOTSTRAP_OCC_LOST');
      error.code = 'BOOTSTRAP_OCC_LOST';
      throw error;
    }

    const next = {
      ...current,
      status,
      consumerReady: false,
      certificationIsPointInTime: true,
      sourceSignature: String(comparison.sourceSignature || ''),
      projectionSignature: String(comparison.projectionSignature || ''),
      parity: comparison.parity === true,
      rawDocCount: Number(raw.rawDocCount || 0),
      activeProjectionReportCount: Number(projection.activeProjectionReportCount || 0),
      projectionDocCount: Number(projection.projectionDocCount || 0),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      leaseUntil: admin.firestore.Timestamp.fromMillis(0),
      ...(errorMessage ? { errorMessage: String(errorMessage).slice(0, 500) } : {}),
    };
    transaction.set(statusRef, next, { merge: false });
    return next;
  });
}

async function readBootstrapPlan({ db, brandId, yearMonth }) {
  const bounds = getMonthBounds(yearMonth);
  if (!bounds) throw new Error('INVALID_BOOTSTRAP_MONTH');

  const dailyRef = getBrandCollection(db, brandId, 'daily_reports');
  const projectionRef = getBrandCollection(db, brandId, CURRENT_STORE_MONTH_REPORTS_COLLECTION);
  const rawQuery = dailyRef
    .where('date', '>=', bounds.startDate)
    .where('date', '<=', bounds.endDate)
    .orderBy('date', 'asc');
  const projectionQuery = projectionRef.where('yearMonth', '==', yearMonth);

  const [rawSnap, projectionSnap] = await Promise.all([rawQuery.get(), projectionQuery.get()]);
  const snapshotCutoff = timestampToIso(
    rawSnap.readTime
    || rawSnap.docs?.[0]?.readTime
    || projectionSnap.readTime
    || projectionSnap.docs?.[0]?.readTime
  );
  if (!snapshotCutoff) throw new Error('MISSING_SNAPSHOT_CUTOFF');

  const rawRows = rawSnap.docs.map((snap) => ({
    id: snap.id,
    data: snap.data() || {},
    updateTime: snap.updateTime || null,
  }));
  const projectionDocs = projectionSnap.docs.map((snap) => ({
    id: snap.id,
    data: snap.data() || {},
  }));

  const plan = buildBootstrapBucketPlan({
    rawRows,
    projectionDocs,
    brandId,
    yearMonth,
    snapshotCutoff,
  });
  if (!plan.ok) {
    const error = new Error(plan.reason || 'BOOTSTRAP_PLAN_BLOCKED');
    error.code = plan.reason || 'BOOTSTRAP_PLAN_BLOCKED';
    throw error;
  }

  return {
    ...plan,
    readEstimate: {
      rawDailyReportReads: rawSnap.size,
      projectionReads: projectionSnap.size,
      estimatedDataReads: rawSnap.size + projectionSnap.size,
    },
  };
}

async function applyBootstrapPlan({ admin, db, plan }) {
  let projectionDocReads = 0;
  let projectionDocWrites = 0;
  let appliedActive = 0;
  let appliedTombstones = 0;
  let preservedNewerEvents = 0;

  for (const item of plan.buckets) {
    const projectionRef = getBrandCollection(
      db,
      plan.brandId,
      CURRENT_STORE_MONTH_REPORTS_COLLECTION
    ).doc(item.bucket.documentId);

    const outcome = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(projectionRef);
      projectionDocReads += 1;
      const merged = mergeBootstrapBucketData({
        currentData: snap.exists ? (snap.data() || {}) : {},
        bucket: item.bucket,
        rawEntries: item.rawEntries,
        rawBySourceId: plan.rawBySourceId,
        snapshotCutoff: plan.snapshotCutoff,
      });

      if (merged.changed) {
        transaction.set(projectionRef, {
          ...merged.data,
          bootstrapVersion: CURRENT_STORE_MONTH_REPORTS_BOOTSTRAP_VERSION,
          bootstrapSnapshotCutoff: plan.snapshotCutoff,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: false });
      }
      return merged;
    });

    if (outcome.changed) projectionDocWrites += 1;
    appliedActive += outcome.appliedActive;
    appliedTombstones += outcome.appliedTombstones;
    preservedNewerEvents += outcome.preservedNewerEvents;
  }

  return { projectionDocReads, projectionDocWrites, appliedActive, appliedTombstones, preservedNewerEvents };
}

function createCurrentStoreMonthReportsBootstrapFunctions({ admin, db }) {
  const bootstrapCurrentStoreMonthReports = onRequest({
    cors: true,
    timeoutSeconds: 180,
    memory: '512MiB',
  }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });

    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });

    let lease = null;
    try {
      const body = req.body || {};
      const brandId = normalizeProjectionBrandId(body.brandId);
      const yearMonth = normalizeYearMonth(body.yearMonth || getTaipeiYearMonth());
      const currentYearMonth = getTaipeiYearMonth();
      const action = String(body.action || 'plan').trim().toLowerCase();

      if (!brandId) return res.status(400).json({ ok: false, message: '不支援的品牌' });
      if (!yearMonth || yearMonth !== currentYearMonth) {
        return res.status(400).json({ ok: false, message: `Bootstrap 只允許目前月份 ${currentYearMonth}` });
      }
      if (!['plan', 'apply'].includes(action)) {
        return res.status(400).json({ ok: false, message: 'action 必須是 plan 或 apply' });
      }

      const adminCheck = await verifySuperAdminActor({ db, brandId, actor: body.actor || {} });
      if (!adminCheck.ok) {
        return res.status(403).json({ ok: false, message: '此操作僅限最高管理者在已信任裝置重新驗證後執行' });
      }

      const plan = await readBootstrapPlan({ db, brandId, yearMonth });
      const planSummary = {
        brandId,
        yearMonth,
        snapshotCutoff: plan.snapshotCutoff,
        rawDocCount: plan.rawInventory.rawDocCount,
        validRawDocCount: plan.rawInventory.validRawDocCount,
        storeCount: plan.rawInventory.storeCount,
        existingProjectionDocCount: plan.projectionInventory.projectionDocCount,
        existingActiveProjectionReportCount: plan.projectionInventory.activeProjectionReportCount,
        bucketCount: plan.buckets.length,
        rawInvalidCount: plan.rawInventory.invalidRows.length,
        rawDuplicateStoreDateCount: plan.rawInventory.duplicateStoreDates.length,
        projectionInvalidCount: plan.projectionInventory.invalidDocs.length,
        projectionDuplicateStoreDateCount: plan.projectionInventory.duplicateStoreDates.length,
        readEstimate: plan.readEstimate,
      };

      if (action === 'plan') {
        return res.status(200).json({
          ok: true,
          bootstrapVersion: CURRENT_STORE_MONTH_REPORTS_BOOTSTRAP_VERSION,
          writeMode: false,
          bootstrapPerformed: false,
          consumerReady: false,
          ...planSummary,
        });
      }

      if (String(body.confirmation || '') !== BOOTSTRAP_CONFIRMATION) {
        return res.status(400).json({ ok: false, message: `apply 需要 confirmation=${BOOTSTRAP_CONFIRMATION}` });
      }

      lease = await acquireBootstrapLease({ admin, db, brandId, yearMonth, actorMeta: adminCheck });
      const applyResult = await applyBootstrapPlan({ admin, db, plan });
      const audit = await auditBrandProjection({ db, brandId, yearMonth });
      const finalStatus = audit.comparison.parity === true ? 'BOOTSTRAP_CERTIFIED' : 'PARITY_FAILED';

      await finalizeBootstrapStatus({
        admin,
        db,
        statusRef: lease.statusRef,
        runId: lease.runId,
        status: finalStatus,
        comparison: audit.comparison,
        raw: audit.raw,
        projection: audit.projection,
      });

      return res.status(audit.comparison.parity === true ? 200 : 409).json({
        ok: audit.comparison.parity === true,
        bootstrapVersion: CURRENT_STORE_MONTH_REPORTS_BOOTSTRAP_VERSION,
        writeMode: true,
        bootstrapPerformed: true,
        consumerReady: false,
        certificationIsPointInTime: true,
        status: finalStatus,
        leaseRevision: lease.revision,
        plan: planSummary,
        apply: applyResult,
        parity: audit,
      });
    } catch (error) {
      console.error('bootstrapCurrentStoreMonthReports failed', error);
      if (lease?.statusRef && lease?.runId) {
        await finalizeBootstrapStatus({
          admin,
          db,
          statusRef: lease.statusRef,
          runId: lease.runId,
          status: 'BOOTSTRAP_FAILED',
          errorMessage: error?.code || error?.message || 'unknown_error',
        }).catch((statusError) => console.error('bootstrap status finalize failed', statusError));
      }
      if (error?.code === 'BOOTSTRAP_BUSY') {
        return res.status(409).json({ ok: false, message: '另一位管理者正在執行同品牌 Bootstrap，請稍後再試' });
      }
      return res.status(500).json({
        ok: false,
        message: 'Current Store-Month Bootstrap 失敗；未取得 exact parity 前不可進行 frontend cutover',
        code: String(error?.code || error?.message || 'BOOTSTRAP_FAILED'),
      });
    }
  });

  return { bootstrapCurrentStoreMonthReports };
}

module.exports = {
  CURRENT_STORE_MONTH_REPORTS_BOOTSTRAP_VERSION,
  BOOTSTRAP_CONFIRMATION,
  BOOTSTRAP_LEASE_MS,
  projectionBucketFromData,
  buildBootstrapBucketPlan,
  mergeBootstrapBucketData,
  readBootstrapPlan,
  applyBootstrapPlan,
  createCurrentStoreMonthReportsBootstrapFunctions,
};
