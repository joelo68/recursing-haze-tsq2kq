const { createHash } = require('node:crypto');
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
  PROJECTED_REPORT_FIELDS,
  normalizeProjectionBrandId,
  getTaipeiYearMonth,
  encodeKey,
  buildProjectedReportRow,
  buildProjectionBucket,
} = require('./currentStoreMonthReports');

const CURRENT_STORE_MONTH_REPORTS_AUDIT_VERSION = 'current-store-month-reports-parity-audit-v1';
const MAX_DETAIL_ITEMS = 50;

function normalizeYearMonth(value = '') {
  const text = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : '';
}

function getMonthBounds(yearMonth = '') {
  const normalized = normalizeYearMonth(yearMonth);
  if (!normalized) return null;
  return {
    startDate: `${normalized}-01`,
    endDate: `${normalized}-31`,
  };
}

function timestampToIso(value) {
  if (!value) return '';
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date?.getTime?.()) ? '' : date.toISOString();
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableObject(value[key])])
  );
}

function stableJson(value) {
  return JSON.stringify(stableObject(value));
}

function sha256(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function comparableProjectedRow(row = {}) {
  const result = {
    sourceReportId: String(row.sourceReportId || '').trim(),
    date: String(row.date || '').trim(),
    storeName: String(row.storeName || '').trim(),
  };
  PROJECTED_REPORT_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(row, field) && row[field] !== undefined) {
      result[field] = row[field];
    }
  });
  return result;
}

function makeComparableEntry(storeKey, row) {
  return {
    storeKey: String(storeKey || '').trim(),
    row: comparableProjectedRow(row),
  };
}

function sortComparableEntries(entries = []) {
  return [...entries].sort((a, b) => (
    String(a.storeKey || '').localeCompare(String(b.storeKey || ''))
    || String(a.row?.date || '').localeCompare(String(b.row?.date || ''))
    || String(a.row?.sourceReportId || '').localeCompare(String(b.row?.sourceReportId || ''))
    || stableJson(a.row || {}).localeCompare(stableJson(b.row || {}))
  ));
}

function buildRawParityInventory(rawRows = [], brandIdInput = '') {
  const brandId = normalizeProjectionBrandId(brandIdInput);
  const invalidRows = [];
  const duplicateStoreDates = [];
  const comparableEntries = [];
  const storeDateSources = new Map();
  const stores = new Set();

  if (!brandId) {
    return {
      brandId: '',
      rawDocCount: rawRows.length,
      validRawDocCount: 0,
      invalidRows: [{ reason: 'UNSUPPORTED_BRAND' }],
      duplicateStoreDates: [],
      comparableEntries: [],
      sourceSignature: sha256([]),
      storeCount: 0,
    };
  }

  rawRows.forEach((item = {}) => {
    const sourceReportId = String(item.id || item.sourceReportId || '').trim();
    const data = item.data && typeof item.data === 'object' ? item.data : {};
    const explicitStoreBrand = detectStoreBrandFromName(data.storeName || '');
    if (explicitStoreBrand && explicitStoreBrand !== brandId) {
      invalidRows.push({
        sourceReportId,
        reason: 'CROSS_BRAND_STORE_NAME',
        storeName: String(data.storeName || ''),
        detectedBrandId: explicitStoreBrand,
      });
      return;
    }

    const row = buildProjectedReportRow(data, sourceReportId);
    if (!row) {
      invalidRows.push({
        sourceReportId,
        reason: 'INVALID_REPORT_IDENTITY',
        storeName: String(data.storeName || ''),
        date: String(data.date || ''),
      });
      return;
    }

    const bucket = buildProjectionBucket({
      row,
      brandId,
      normalizeStoreCore: normalizeStoreLifecycleCore,
      getCanonicalStoreName,
      detectStoreBrandFromName,
    });
    if (!bucket) {
      invalidRows.push({
        sourceReportId,
        reason: 'INVALID_PROJECTION_BUCKET',
        storeName: row.storeName,
        date: row.date,
      });
      return;
    }

    const updateTime = timestampToIso(item.updateTime);
    if (!updateTime) {
      invalidRows.push({
        sourceReportId,
        reason: 'MISSING_SOURCE_UPDATE_TIME',
        storeName: row.storeName,
        date: row.date,
      });
      return;
    }

    const storeDateKey = `${bucket.storeKey}|${row.date}`;
    if (!storeDateSources.has(storeDateKey)) storeDateSources.set(storeDateKey, []);
    storeDateSources.get(storeDateKey).push(sourceReportId);
    stores.add(bucket.storeKey);
    comparableEntries.push(makeComparableEntry(bucket.storeKey, row));
  });

  for (const [storeDateKey, sourceReportIds] of storeDateSources.entries()) {
    if (sourceReportIds.length <= 1) continue;
    const splitAt = storeDateKey.lastIndexOf('|');
    duplicateStoreDates.push({
      storeKey: storeDateKey.slice(0, splitAt),
      date: storeDateKey.slice(splitAt + 1),
      sourceReportIds: [...sourceReportIds].sort(),
    });
  }

  const sortedEntries = sortComparableEntries(comparableEntries);
  return {
    brandId,
    rawDocCount: rawRows.length,
    validRawDocCount: sortedEntries.length,
    storeCount: stores.size,
    invalidRows,
    duplicateStoreDates,
    comparableEntries: sortedEntries,
    sourceSignature: sha256(sortedEntries),
  };
}

function buildProjectionParityInventory(projectionDocs = [], brandIdInput = '', yearMonthInput = '') {
  const brandId = normalizeProjectionBrandId(brandIdInput);
  const yearMonth = normalizeYearMonth(yearMonthInput);
  const invalidDocs = [];
  const comparableEntries = [];
  const activeStoreDates = new Map();

  projectionDocs.forEach((item = {}) => {
    const id = String(item.id || '').trim();
    const data = item.data && typeof item.data === 'object' ? item.data : {};
    const storeKey = String(data.storeKey || '').trim();
    const expectedId = storeKey && yearMonth ? `${yearMonth}_${encodeKey(storeKey)}` : '';

    if (
      String(data.schemaVersion || '') !== CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION
      || String(data.brandId || '') !== brandId
      || String(data.yearMonth || '') !== yearMonth
      || !storeKey
      || id !== expectedId
    ) {
      invalidDocs.push({
        id,
        reason: 'INVALID_PROJECTION_METADATA',
        schemaVersion: String(data.schemaVersion || ''),
        brandId: String(data.brandId || ''),
        yearMonth: String(data.yearMonth || ''),
        storeKey,
        expectedId,
      });
      return;
    }

    const sourceEvents = data.sourceEvents && typeof data.sourceEvents === 'object'
      ? data.sourceEvents
      : {};
    Object.values(sourceEvents).forEach((entry = {}) => {
      if (entry.exists !== true || !entry.row) return;
      const row = comparableProjectedRow(entry.row);
      if (!row.sourceReportId || !row.date || !row.storeName) {
        invalidDocs.push({
          id,
          reason: 'INVALID_ACTIVE_SOURCE_EVENT',
          sourceReportId: row.sourceReportId,
        });
        return;
      }
      comparableEntries.push(makeComparableEntry(storeKey, row));
      const key = `${storeKey}|${row.date}`;
      if (!activeStoreDates.has(key)) activeStoreDates.set(key, []);
      activeStoreDates.get(key).push(row.sourceReportId);
    });
  });

  const duplicateStoreDates = [];
  for (const [key, sourceReportIds] of activeStoreDates.entries()) {
    if (sourceReportIds.length <= 1) continue;
    const splitAt = key.lastIndexOf('|');
    duplicateStoreDates.push({
      storeKey: key.slice(0, splitAt),
      date: key.slice(splitAt + 1),
      sourceReportIds: [...sourceReportIds].sort(),
    });
  }

  const sortedEntries = sortComparableEntries(comparableEntries);
  return {
    brandId,
    yearMonth,
    projectionDocCount: projectionDocs.length,
    activeProjectionReportCount: sortedEntries.length,
    invalidDocs,
    duplicateStoreDates,
    comparableEntries: sortedEntries,
    projectionSignature: sha256(sortedEntries),
  };
}

function entryKey(entry = {}) {
  return `${String(entry.storeKey || '')}|${String(entry.row?.sourceReportId || '')}|${stableJson(entry.row || {})}`;
}

function diffEntries(left = [], right = [], limit = MAX_DETAIL_ITEMS) {
  const rightCounts = new Map();
  right.forEach((entry) => {
    const key = entryKey(entry);
    rightCounts.set(key, Number(rightCounts.get(key) || 0) + 1);
  });

  const sample = [];
  let total = 0;
  left.forEach((entry) => {
    const key = entryKey(entry);
    const count = Number(rightCounts.get(key) || 0);
    if (count > 0) {
      rightCounts.set(key, count - 1);
      return;
    }
    total += 1;
    if (sample.length < limit) sample.push(entry);
  });
  return { total, sample };
}

function compareRawAndProjection(rawInventory = {}, projectionInventory = {}) {
  const sourceOnly = diffEntries(
    rawInventory.comparableEntries || [],
    projectionInventory.comparableEntries || []
  );
  const projectionOnly = diffEntries(
    projectionInventory.comparableEntries || [],
    rawInventory.comparableEntries || []
  );

  const parity = (
    (rawInventory.invalidRows || []).length === 0
    && (rawInventory.duplicateStoreDates || []).length === 0
    && (projectionInventory.invalidDocs || []).length === 0
    && (projectionInventory.duplicateStoreDates || []).length === 0
    && sourceOnly.total === 0
    && projectionOnly.total === 0
    && String(rawInventory.sourceSignature || '') === String(projectionInventory.projectionSignature || '')
  );

  return {
    parity,
    sourceSignature: String(rawInventory.sourceSignature || ''),
    projectionSignature: String(projectionInventory.projectionSignature || ''),
    sourceOnly,
    projectionOnly,
    rawInvalidCount: (rawInventory.invalidRows || []).length,
    rawDuplicateStoreDateCount: (rawInventory.duplicateStoreDates || []).length,
    projectionInvalidCount: (projectionInventory.invalidDocs || []).length,
    projectionDuplicateStoreDateCount: (projectionInventory.duplicateStoreDates || []).length,
  };
}

async function auditBrandProjection({ db, brandId, yearMonth }) {
  const normalizedBrandId = normalizeProjectionBrandId(brandId);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  const bounds = getMonthBounds(normalizedYearMonth);
  if (!normalizedBrandId || !bounds) throw new Error('INVALID_AUDIT_SCOPE');

  const dailyRef = getBrandCollection(db, normalizedBrandId, 'daily_reports');
  const projectionRef = getBrandCollection(db, normalizedBrandId, CURRENT_STORE_MONTH_REPORTS_COLLECTION);
  const statusRef = getBrandCollection(db, normalizedBrandId, CURRENT_STORE_MONTH_REPORTS_STATUS_COLLECTION)
    .doc(normalizedYearMonth);

  const rawQuery = dailyRef
    .where('date', '>=', bounds.startDate)
    .where('date', '<=', bounds.endDate)
    .orderBy('date', 'asc');
  const projectionQuery = projectionRef.where('yearMonth', '==', normalizedYearMonth);

  const [rawSnap, projectionSnap, statusSnap] = await Promise.all([
    rawQuery.get(),
    projectionQuery.get(),
    statusRef.get(),
  ]);

  const rawRows = rawSnap.docs.map((snap) => ({
    id: snap.id,
    data: snap.data() || {},
    updateTime: snap.updateTime || snap.readTime || null,
  }));
  const projectionDocs = projectionSnap.docs.map((snap) => ({
    id: snap.id,
    data: snap.data() || {},
  }));

  const rawInventory = buildRawParityInventory(rawRows, normalizedBrandId);
  const projectionInventory = buildProjectionParityInventory(
    projectionDocs,
    normalizedBrandId,
    normalizedYearMonth
  );
  const comparison = compareRawAndProjection(rawInventory, projectionInventory);
  const statusData = statusSnap.exists ? (statusSnap.data() || {}) : {};

  return {
    auditVersion: CURRENT_STORE_MONTH_REPORTS_AUDIT_VERSION,
    brandId: normalizedBrandId,
    yearMonth: normalizedYearMonth,
    raw: {
      rawDocCount: rawInventory.rawDocCount,
      validRawDocCount: rawInventory.validRawDocCount,
      storeCount: rawInventory.storeCount,
      invalidRows: rawInventory.invalidRows.slice(0, MAX_DETAIL_ITEMS),
      duplicateStoreDates: rawInventory.duplicateStoreDates.slice(0, MAX_DETAIL_ITEMS),
    },
    projection: {
      projectionDocCount: projectionInventory.projectionDocCount,
      activeProjectionReportCount: projectionInventory.activeProjectionReportCount,
      invalidDocs: projectionInventory.invalidDocs.slice(0, MAX_DETAIL_ITEMS),
      duplicateStoreDates: projectionInventory.duplicateStoreDates.slice(0, MAX_DETAIL_ITEMS),
    },
    comparison,
    status: {
      exists: statusSnap.exists,
      status: String(statusData.status || ''),
      revision: Number.isInteger(Number(statusData.revision)) ? Number(statusData.revision) : 0,
      schemaVersion: String(statusData.schemaVersion || ''),
      certifiedSourceSignature: String(statusData.sourceSignature || ''),
      certifiedProjectionSignature: String(statusData.projectionSignature || ''),
    },
    readEstimate: {
      rawDailyReportReads: rawSnap.size,
      projectionReads: projectionSnap.size,
      statusReads: 1,
      firestoreWrites: 0,
      estimatedDataReads: rawSnap.size + projectionSnap.size + 1,
    },
  };
}

function createCurrentStoreMonthReportsAuditFunctions({ admin, db }) {
  const auditCurrentStoreMonthReportsProjection = onRequest({
    cors: true,
    timeoutSeconds: 90,
    memory: '512MiB',
  }, async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, message: 'method_not_allowed' });
    }

    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) {
      return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });
    }

    try {
      const body = req.body || {};
      const brandId = normalizeProjectionBrandId(body.brandId);
      const requestedYearMonth = normalizeYearMonth(body.yearMonth || getTaipeiYearMonth());
      const currentYearMonth = getTaipeiYearMonth();

      if (!brandId) return res.status(400).json({ ok: false, message: '不支援的品牌' });
      if (!requestedYearMonth || requestedYearMonth !== currentYearMonth) {
        return res.status(400).json({
          ok: false,
          message: `此稽核只允許目前月份 ${currentYearMonth}`,
        });
      }

      const adminCheck = await verifySuperAdminActor({
        db,
        brandId,
        actor: body.actor || {},
      });
      if (!adminCheck.ok) {
        return res.status(403).json({
          ok: false,
          message: '此稽核僅限最高管理者在已信任裝置執行',
        });
      }

      const result = await auditBrandProjection({
        db,
        brandId,
        yearMonth: requestedYearMonth,
      });

      console.info(
        `Current Store-Month parity audit: ${brandId}/${requestedYearMonth}`
        + ` raw=${result.raw.rawDocCount}`
        + ` projection=${result.projection.activeProjectionReportCount}`
        + ` parity=${result.comparison.parity}`
      );

      return res.status(200).json({
        ok: true,
        auditOnly: true,
        firestoreWrites: 0,
        currentMonthOnly: true,
        ...result,
        auditedAtText: new Date().toISOString(),
      });
    } catch (error) {
      console.error('auditCurrentStoreMonthReportsProjection failed', error);
      return res.status(500).json({
        ok: false,
        message: 'Current Store-Month Projection 稽核失敗，請停止後續 bootstrap 並檢查後端紀錄',
      });
    }
  });

  return { auditCurrentStoreMonthReportsProjection };
}

module.exports = {
  CURRENT_STORE_MONTH_REPORTS_AUDIT_VERSION,
  MAX_DETAIL_ITEMS,
  normalizeYearMonth,
  getMonthBounds,
  timestampToIso,
  stableJson,
  sha256,
  comparableProjectedRow,
  buildRawParityInventory,
  buildProjectionParityInventory,
  compareRawAndProjection,
  auditBrandProjection,
  createCurrentStoreMonthReportsAuditFunctions,
};
