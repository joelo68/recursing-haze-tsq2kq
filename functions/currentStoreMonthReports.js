const CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION = 'current-store-month-reports-v1';
const CURRENT_STORE_MONTH_REPORTS_COLLECTION = 'current_store_month_reports';
const CURRENT_STORE_MONTH_REPORTS_STATUS_COLLECTION = 'current_store_month_reports_status';
const CURRENT_STORE_MONTH_REPORTS_SOURCE = 'daily_reports_onwrite_v1';

const PROJECTED_REPORT_FIELDS = Object.freeze([
  'cash',
  'refund',
  'skincareRefund',
  'accrual',
  'operationalAccrual',
  'traffic',
  'skincareSales',
  'newCustomers',
  'newCustomerSales',
  'newCustomerRevenue',
  'newCustomerClosings',
]);

function normalizeProjectionBrandId(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (['cyj', 'default', 'default-app-id', 'drcyj'].includes(raw)) return 'cyj';
  if (['anniu', 'anew', '安妞'].includes(raw)) return 'anniu';
  if (['yibo', '伊啵'].includes(raw)) return 'yibo';
  return '';
}

function normalizeIsoDate(value = '') {
  const text = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(text)) return '';
  const [year, month, day] = text.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() + 1 !== month
    || probe.getUTCDate() !== day
  ) return '';
  return text;
}

function getTaipeiYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}`;
}

function normalizeEventTimestamp(value = '') {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function encodeKey(value = '') {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}

function buildProjectedReportRow(raw = {}, sourceReportId = '') {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const date = normalizeIsoDate(source.date);
  const storeName = String(source.storeName || '').trim();
  const reportId = String(sourceReportId || '').trim();
  if (!date || !storeName || !reportId) return null;

  const row = { sourceReportId: reportId, date, storeName };
  PROJECTED_REPORT_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
      row[field] = source[field];
    }
  });
  return row;
}

function buildProjectionBucket({
  row = null,
  brandId = '',
  normalizeStoreCore = (value) => String(value || '').trim(),
  getCanonicalStoreName = (value) => String(value || '').trim(),
} = {}) {
  if (!row) return null;
  const normalizedBrandId = normalizeProjectionBrandId(brandId);
  const date = normalizeIsoDate(row.date);
  const storeKey = String(normalizeStoreCore(row.storeName) || '').trim();
  if (!normalizedBrandId || !date || !storeKey) return null;
  const yearMonth = date.slice(0, 7);
  return {
    brandId: normalizedBrandId,
    yearMonth,
    storeKey,
    canonicalStoreName: String(getCanonicalStoreName(storeKey, normalizedBrandId) || row.storeName || '').trim(),
    documentId: `${yearMonth}_${encodeKey(storeKey)}`,
    bucketKey: `${normalizedBrandId}:${yearMonth}:${storeKey}`,
  };
}

function normalizeExistingSourceEvents(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
      .map(([key, value]) => [String(key), { ...value }])
  );
}

function compareEventTimestamp(left = '', right = '') {
  const a = normalizeEventTimestamp(left);
  const b = normalizeEventTimestamp(right);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

function applySourceEventToProjectionData(currentData = {}, {
  bucket,
  sourceReportId = '',
  eventTimestamp = '',
  exists = false,
  row = null,
} = {}) {
  if (!bucket || !bucket.brandId || !bucket.yearMonth || !bucket.storeKey) {
    return { changed: false, reason: 'INVALID_BUCKET', data: currentData || {} };
  }
  const reportId = String(sourceReportId || '').trim();
  const timestamp = normalizeEventTimestamp(eventTimestamp);
  if (!reportId || !timestamp) {
    return { changed: false, reason: 'INVALID_EVENT', data: currentData || {} };
  }

  const sourceEvents = normalizeExistingSourceEvents(currentData?.sourceEvents || {});
  const eventKey = encodeKey(reportId);
  const existing = sourceEvents[eventKey] || null;

  if (existing && compareEventTimestamp(existing.eventTimestamp, timestamp) >= 0) {
    return { changed: false, reason: 'STALE_OR_DUPLICATE_EVENT', data: currentData || {} };
  }

  sourceEvents[eventKey] = {
    sourceReportId: reportId,
    eventTimestamp: timestamp,
    exists: exists === true,
    ...(exists === true && row ? { row: { ...row, sourceReportId: reportId } } : {}),
  };

  const activeEntries = Object.values(sourceEvents)
    .filter((entry) => entry?.exists === true && entry?.row)
    .sort((a, b) => (
      String(a.row?.date || '').localeCompare(String(b.row?.date || ''))
      || String(a.sourceReportId || '').localeCompare(String(b.sourceReportId || ''))
    ));

  const submittedDates = [...new Set(
    activeEntries.map((entry) => normalizeIsoDate(entry.row?.date)).filter(Boolean)
  )].sort();

  const lastEventTimestamp = Object.values(sourceEvents)
    .map((entry) => normalizeEventTimestamp(entry?.eventTimestamp))
    .filter(Boolean)
    .sort()
    .at(-1) || timestamp;

  return {
    changed: true,
    reason: 'APPLIED',
    data: {
      schemaVersion: CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION,
      projectionSource: CURRENT_STORE_MONTH_REPORTS_SOURCE,
      brandId: bucket.brandId,
      yearMonth: bucket.yearMonth,
      storeKey: bucket.storeKey,
      canonicalStoreName: bucket.canonicalStoreName,
      sourceEvents,
      sourceEventCount: Object.keys(sourceEvents).length,
      sourceReportCount: activeEntries.length,
      submittedDates,
      submittedDateCount: submittedDates.length,
      lastEventTimestamp,
      updatedAtText: timestamp,
    },
  };
}

function createCurrentStoreMonthReportsWriter({
  admin,
  db,
  getBrandCollection,
  normalizeStoreCore,
  getCanonicalStoreName,
} = {}) {
  if (!admin || !db || typeof getBrandCollection !== 'function') {
    throw new Error('current store-month reports writer dependencies are incomplete');
  }
  if (typeof normalizeStoreCore !== 'function' || typeof getCanonicalStoreName !== 'function') {
    throw new Error('current store-month reports identity helpers are required');
  }

  const projectionRefForBucket = (bucket) => (
    getBrandCollection(db, bucket.brandId, CURRENT_STORE_MONTH_REPORTS_COLLECTION).doc(bucket.documentId)
  );

  async function updateFromDailyWrite(change, context, brandIdInput) {
    const brandId = normalizeProjectionBrandId(brandIdInput);
    if (!brandId) return { skipped: true, reason: 'UNSUPPORTED_BRAND' };

    const sourceReportId = String(
      context?.params?.reportId || change?.after?.id || change?.before?.id || ''
    ).trim();
    const eventTimestamp = normalizeEventTimestamp(context?.timestamp || new Date().toISOString());
    if (!sourceReportId || !eventTimestamp) {
      return { skipped: true, reason: 'INVALID_EVENT_IDENTITY' };
    }

    const beforeRow = change?.before?.exists
      ? buildProjectedReportRow(change.before.data() || {}, sourceReportId)
      : null;
    const afterRow = change?.after?.exists
      ? buildProjectedReportRow(change.after.data() || {}, sourceReportId)
      : null;

    const beforeBucket = buildProjectionBucket({
      row: beforeRow, brandId, normalizeStoreCore, getCanonicalStoreName,
    });
    const afterBucket = buildProjectionBucket({
      row: afterRow, brandId, normalizeStoreCore, getCanonicalStoreName,
    });

    const currentYearMonth = getTaipeiYearMonth();
    const relevantBefore = beforeBucket?.yearMonth === currentYearMonth ? beforeBucket : null;
    const relevantAfter = afterBucket?.yearMonth === currentYearMonth ? afterBucket : null;
    if (!relevantBefore && !relevantAfter) {
      return { skipped: true, reason: 'NOT_CURRENT_MONTH' };
    }

    const operationsByBucket = new Map();
    const addOperation = (bucket, payload) => {
      if (!bucket) return;
      if (!operationsByBucket.has(bucket.bucketKey)) {
        operationsByBucket.set(bucket.bucketKey, { bucket, operations: [] });
      }
      operationsByBucket.get(bucket.bucketKey).operations.push(payload);
    };

    if (relevantBefore && (!relevantAfter || relevantBefore.bucketKey !== relevantAfter.bucketKey)) {
      addOperation(relevantBefore, {
        sourceReportId, eventTimestamp, exists: false, row: null,
      });
    }
    if (relevantAfter) {
      addOperation(relevantAfter, {
        sourceReportId, eventTimestamp, exists: true, row: afterRow,
      });
    }

    const result = await db.runTransaction(async (transaction) => {
      const loaded = new Map();
      for (const [bucketKey, item] of operationsByBucket.entries()) {
        const ref = projectionRefForBucket(item.bucket);
        const snap = await transaction.get(ref);
        loaded.set(bucketKey, {
          ref,
          data: snap.exists ? (snap.data() || {}) : {},
          item,
        });
      }

      let writeCount = 0;
      const outcomes = [];
      for (const [bucketKey, loadedItem] of loaded.entries()) {
        let data = loadedItem.data;
        let changed = false;
        let reason = 'NO_CHANGE';

        for (const operation of loadedItem.item.operations) {
          const applied = applySourceEventToProjectionData(data, {
            bucket: loadedItem.item.bucket,
            ...operation,
          });
          data = applied.data;
          if (applied.changed) changed = true;
          reason = applied.reason;
        }

        if (changed) {
          transaction.set(loadedItem.ref, {
            ...data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: false });
          writeCount += 1;
        }
        outcomes.push({ bucketKey, changed, reason });
      }
      return { writeCount, outcomes };
    });

    return {
      skipped: false,
      brandId,
      sourceReportId,
      eventTimestamp,
      ...result,
    };
  }

  return { updateFromDailyWrite };
}

module.exports = {
  CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION,
  CURRENT_STORE_MONTH_REPORTS_COLLECTION,
  CURRENT_STORE_MONTH_REPORTS_STATUS_COLLECTION,
  CURRENT_STORE_MONTH_REPORTS_SOURCE,
  PROJECTED_REPORT_FIELDS,
  normalizeProjectionBrandId,
  normalizeIsoDate,
  getTaipeiYearMonth,
  normalizeEventTimestamp,
  encodeKey,
  buildProjectedReportRow,
  buildProjectionBucket,
  applySourceEventToProjectionData,
  createCurrentStoreMonthReportsWriter,
};
