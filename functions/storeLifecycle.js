const { randomUUID } = require('node:crypto');
const { onRequest } = require('firebase-functions/v2/https');
const {
  normalizeBrandId,
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
  verifyTrustedApplicationActor,
} = require('./deviceApproval');

const STORE_LIFECYCLE_SCHEMA_VERSION = 'store-lifecycle-v1';
const REPORTING_COMPLETENESS_SCHEMA_VERSION = 'reporting-completeness-v1';
const REPORTING_CALENDAR_SCHEMA_VERSION = 'reporting-calendar-v2';
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

function normalizeReportingCalendarClosedDates(values = []) {
  const source = Array.isArray(values) ? values : [];
  const byDate = new Map();

  source.forEach((value) => {
    const row = typeof value === 'string'
      ? { date: value }
      : (value && typeof value === 'object' ? value : {});
    const date = normalizeIsoDate(row.date);
    if (!date) return;
    byDate.set(date, {
      date,
      reason: String(row.reason || '').trim(),
    });
  });

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeReportingCalendarStoreClosureEvents(values = []) {
  const source = Array.isArray(values) ? values : [];
  const byId = new Map();

  source.forEach((value, index) => {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const dates = [...new Set(
      (Array.isArray(row.dates) ? row.dates : [row.date])
        .map(normalizeIsoDate)
        .filter(Boolean)
    )].sort();
    const storeKeys = [...new Set(
      (Array.isArray(row.storeKeys) ? row.storeKeys : [row.storeKey])
        .map(normalizeStoreLifecycleCore)
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    if (!dates.length || !storeKeys.length) return;

    const fallbackId = `legacy-store-closure-${dates[0]}-${index + 1}`;
    const id = String(row.id || row.eventId || fallbackId).trim() || fallbackId;
    byId.set(id, {
      id,
      dates,
      storeKeys,
      reason: String(row.reason || '').trim(),
      createdAtText: String(row.createdAtText || ''),
      createdBy: String(row.createdBy || ''),
      createdByRole: String(row.createdByRole || ''),
      createdByAccountId: String(row.createdByAccountId || ''),
    });
  });

  return [...byId.values()].sort((a, b) => (
    String(a.dates?.[0] || '').localeCompare(String(b.dates?.[0] || ''))
    || String(a.id || '').localeCompare(String(b.id || ''))
  ));
}

function getReportingCalendarStoreClosedDates(calendar = {}, storeName = '') {
  const storeKey = normalizeStoreLifecycleCore(storeName);
  if (!storeKey) return [];
  const normalized = normalizeReportingCalendar(calendar);
  return [...new Set(
    normalized.storeClosureEvents
      .filter((event) => event.storeKeys.includes(storeKey))
      .flatMap((event) => event.dates)
  )].sort();
}

function normalizeReportingCalendarStoreKeys(values = []) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map(normalizeStoreLifecycleCore).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function normalizeReportingCalendarMonthRevisions(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([yearMonth, value]) => [normalizeYearMonth(yearMonth), Number(value)])
      .filter(([yearMonth, value]) => (
        Boolean(yearMonth) && Number.isInteger(value) && value >= 0
      ))
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

function normalizeReportingCalendar(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    schemaVersion: String(source.schemaVersion || REPORTING_CALENDAR_SCHEMA_VERSION),
    revision: Math.max(0, Number(source.revision || 0)),
    monthRevisions: normalizeReportingCalendarMonthRevisions(source.monthRevisions),
    closedDates: normalizeReportingCalendarClosedDates(source.closedDates),
    storeClosureEvents: normalizeReportingCalendarStoreClosureEvents(source.storeClosureEvents),
    updatedAtText: String(source.updatedAtText || ''),
    updatedBy: String(source.updatedBy || ''),
    updatedByRole: String(source.updatedByRole || ''),
    updatedByAccountId: String(source.updatedByAccountId || ''),
  };
}

function getReportingClosedDateSet(values = []) {
  return new Set(normalizeReportingCalendarClosedDates(values).map((row) => row.date));
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

  if (firstEligibleMonth && openDate && openDate.slice(0, 7) > firstEligibleMonth) {
    errors.push('實際開始營運日期不可晚於首次正式納管月份');
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


// Batch 3 Target Coverage authority：monthly cohort 必須共用 Lifecycle owner，禁止在 Target/Summary writer 另寫一套日期規則。
function isLifecycleEntryEligibleForMonth(entry = {}, yearMonth = '') {
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedYearMonth) return false;

  const check = validateLifecycleDraft(entry || {});
  if (!check.valid || check.entryStatus !== 'COMPLETE') return false;

  const firstEligibleMonth = check.normalized.firstEligibleMonth;
  const lastEligibleMonth = check.normalized.lastEligibleMonth;
  const exemptMonths = check.normalized.exemptMonths;

  if (!firstEligibleMonth || normalizedYearMonth < firstEligibleMonth) return false;
  if (lastEligibleMonth && normalizedYearMonth > lastEligibleMonth) return false;
  if (exemptMonths.includes(normalizedYearMonth)) return false;
  return true;
}

function getLifecycleEligibleStoreEntries(master = {}, yearMonth = '', options = {}) {
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedYearMonth) return [];
  const requireReady = options.requireReady !== false;
  if (requireReady && String(master?.datasetStatus || '') !== 'READY') return [];

  const brandId = normalizeBrandId(master?.brandId || options.brandId || 'cyj');
  const reportingCalendar = normalizeReportingCalendar(master?.reportingCalendar || {});
  const reportingCalendarBrandClosedDates = reportingCalendar.closedDates;
  const stores = master?.stores && typeof master.stores === 'object' && !Array.isArray(master.stores)
    ? master.stores
    : {};

  return Object.entries(stores)
    .map(([storeKey, value]) => {
      const entry = value || {};
      const coreStoreName = normalizeStoreLifecycleCore(entry.coreStoreName || entry.storeKey || storeKey);
      const reportingCalendarStoreClosedDates = getReportingCalendarStoreClosedDates(
        reportingCalendar,
        coreStoreName
      );
      const reportingCalendarClosedDates = [...new Set([
        ...reportingCalendarBrandClosedDates.map((row) => row.date),
        ...reportingCalendarStoreClosedDates,
      ])].sort();
      return {
        ...entry,
        storeKey: coreStoreName,
        coreStoreName,
        canonicalStoreName: getCanonicalStoreName(entry.canonicalStoreName || coreStoreName, brandId),
        reportingCalendarBrandClosedDates,
        reportingCalendarStoreClosedDates,
        reportingCalendarClosedDates,
      };
    })
    .filter((entry) => isLifecycleEntryEligibleForMonth(entry, normalizedYearMonth))
    .sort((a, b) => String(a.canonicalStoreName || a.storeKey).localeCompare(String(b.canonicalStoreName || b.storeKey), 'zh-Hant'));
}

function getLifecycleMonthBounds(yearMonth = '') {
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedYearMonth) return null;
  const [year, month] = normalizedYearMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${normalizedYearMonth}-01`,
    end: `${normalizedYearMonth}-${String(lastDay).padStart(2, '0')}`,
    daysInMonth: lastDay,
  };
}

function enumerateIsoDateRange(startDate = '', endDate = '') {
  const start = normalizeIsoDate(startDate);
  const end = normalizeIsoDate(endDate);
  if (!start || !end || start > end) return [];

  const cursor = new Date(`${start}T00:00:00Z`);
  const finish = new Date(`${end}T00:00:00Z`);
  const dates = [];
  while (cursor.getTime() <= finish.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// Batch 5D-1：Daily expected-report authority。月度 cohort 與實際 open/close 日界線必須同時成立。
function isLifecycleEntryExpectedForDate(entry = {}, dateText = '', options = {}) {
  const date = normalizeIsoDate(dateText);
  if (!date) return false;
  const yearMonth = date.slice(0, 7);
  if (!isLifecycleEntryEligibleForMonth(entry, yearMonth)) return false;

  const check = validateLifecycleDraft(entry || {});
  if (!check.valid || check.entryStatus !== 'COMPLETE') return false;
  const openDate = check.normalized.openDate;
  const closeDate = check.normalized.closeDate;
  if (!openDate || date < openDate) return false;
  if (closeDate && date > closeDate) return false;

  const closedDateSet = getReportingClosedDateSet(
    options.closedDates || entry.reportingCalendarClosedDates || []
  );
  if (closedDateSet.has(date)) return false;
  return true;
}

function isLifecycleEntryFullEligibleMonth(entry = {}, yearMonth = '') {
  const bounds = getLifecycleMonthBounds(yearMonth);
  if (!bounds || !isLifecycleEntryEligibleForMonth(entry, yearMonth)) return false;
  const check = validateLifecycleDraft(entry || {});
  if (!check.valid || check.entryStatus !== 'COMPLETE') return false;
  const openDate = check.normalized.openDate;
  const closeDate = check.normalized.closeDate;
  return Boolean(openDate && openDate <= bounds.start && (!closeDate || closeDate >= bounds.end));
}

function getLifecycleExpectedReportDates(entry = {}, yearMonth = '', options = {}) {
  const bounds = getLifecycleMonthBounds(yearMonth);
  if (!bounds || !isLifecycleEntryEligibleForMonth(entry, yearMonth)) return [];
  const check = validateLifecycleDraft(entry || {});
  if (!check.valid || check.entryStatus !== 'COMPLETE') return [];

  const openDate = check.normalized.openDate;
  const closeDate = check.normalized.closeDate;
  const cutoffDate = options.cutoffDate == null || options.cutoffDate === ''
    ? bounds.end
    : normalizeIsoDate(options.cutoffDate);
  if (!openDate || !cutoffDate) return [];

  const start = [bounds.start, openDate].sort().at(-1);
  const endCandidates = [bounds.end, cutoffDate, ...(closeDate ? [closeDate] : [])].sort();
  const closedDateSet = getReportingClosedDateSet(
    options.closedDates || entry.reportingCalendarClosedDates || []
  );
  return enumerateIsoDateRange(start, endCandidates[0]).filter((date) => !closedDateSet.has(date));
}

function buildLifecycleReportingCompleteness({
  master = {},
  yearMonth = '',
  reports = [],
  brandId = 'cyj',
  cutoffDate = '',
  requireReady = true,
  includeMissingDates = true,
  getReportStoreName = (row = {}) => row.storeName || row.store || row.storeId || row.storeKey || '',
  getReportDate = (row = {}) => row.date || row.reportDate || row.sourceDate || '',
} = {}) {
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  const normalizedBrandId = normalizeBrandId(master?.brandId || brandId || 'cyj');
  const lifecycleReady = String(master?.datasetStatus || '') === 'READY';
  const reportingCalendar = normalizeReportingCalendar(master?.reportingCalendar || {});
  const reportingCalendarRevision = Math.max(
    0,
    Number(reportingCalendar.monthRevisions?.[normalizedYearMonth] || 0)
  );
  const reportingBounds = getLifecycleMonthBounds(normalizedYearMonth);
  const normalizedCutoffDate = normalizeIsoDate(cutoffDate) || reportingBounds?.end || '';
  const closedReportDates = reportingCalendar.closedDates
    .map((row) => row.date)
    .filter((date) => (
      normalizedYearMonth
      && date.startsWith(`${normalizedYearMonth}-`)
      && (!normalizedCutoffDate || date <= normalizedCutoffDate)
    ));
  const storeClosedReportPairs = new Set();
  reportingCalendar.storeClosureEvents.forEach((event) => {
    event.dates
      .filter((date) => (
        normalizedYearMonth
        && date.startsWith(`${normalizedYearMonth}-`)
        && (!normalizedCutoffDate || date <= normalizedCutoffDate)
      ))
      .forEach((date) => {
        event.storeKeys.forEach((storeKey) => storeClosedReportPairs.add(`${storeKey}@@${date}`));
      });
  });
  const empty = {
    schemaVersion: REPORTING_COMPLETENESS_SCHEMA_VERSION,
    brandId: normalizedBrandId,
    yearMonth: normalizedYearMonth,
    cutoffDate: normalizedCutoffDate,
    lifecycleReady,
    reportingCalendarSchemaVersion: reportingCalendar.schemaVersion,
    reportingCalendarMasterRevision: reportingCalendar.revision,
    reportingCalendarRevision,
    closedReportDateCount: closedReportDates.length,
    closedReportDates,
    storeClosedReportDayCount: storeClosedReportPairs.size,
    eligibleStoreCount: 0,
    completeStoreCount: 0,
    incompleteStoreCount: 0,
    expectedStoreDayCount: 0,
    submittedStoreDayCount: 0,
    missingStoreDayCount: 0,
    reportingStatus: lifecycleReady ? 'DATA_COMPLETE' : 'LIFECYCLE_NOT_READY',
    stores: {},
  };
  if (!normalizedYearMonth) return { ...empty, reportingStatus: 'INVALID_PERIOD' };
  if (requireReady && !lifecycleReady) return empty;

  const eligibleEntries = getLifecycleEligibleStoreEntries(master, normalizedYearMonth, {
    brandId: normalizedBrandId,
    requireReady,
  });
  const submittedDatesByStore = new Map();
  (Array.isArray(reports) ? reports : []).forEach((row) => {
    const storeKey = normalizeStoreLifecycleCore(getReportStoreName(row));
    const reportDate = normalizeIsoDate(getReportDate(row));
    if (!storeKey || !reportDate) return;
    if (!submittedDatesByStore.has(storeKey)) submittedDatesByStore.set(storeKey, new Set());
    submittedDatesByStore.get(storeKey).add(reportDate);
  });

  const stores = {};
  let expectedStoreDayCount = 0;
  let submittedStoreDayCount = 0;
  let missingStoreDayCount = 0;
  let completeStoreCount = 0;
  let incompleteStoreCount = 0;

  eligibleEntries.forEach((entry) => {
    const storeKey = entry.storeKey || entry.coreStoreName;
    if (!storeKey) return;
    const expectedDates = getLifecycleExpectedReportDates(entry, normalizedYearMonth, {
      cutoffDate,
    });
    const submittedDates = submittedDatesByStore.get(storeKey) || new Set();
    const submittedExpectedDates = expectedDates.filter((date) => submittedDates.has(date));
    const missingDates = expectedDates.filter((date) => !submittedDates.has(date));
    const reportingStatus = missingDates.length === 0 ? 'DATA_COMPLETE' : 'DATA_INCOMPLETE';

    expectedStoreDayCount += expectedDates.length;
    submittedStoreDayCount += submittedExpectedDates.length;
    missingStoreDayCount += missingDates.length;
    if (reportingStatus === 'DATA_COMPLETE') completeStoreCount += 1;
    else incompleteStoreCount += 1;

    stores[storeKey] = {
      storeKey,
      canonicalStoreName: entry.canonicalStoreName || getCanonicalStoreName(storeKey, normalizedBrandId),
      expectedReportDayCount: expectedDates.length,
      submittedReportDayCount: submittedExpectedDates.length,
      missingReportDayCount: missingDates.length,
      reportingStatus,
      fullMonthLifecycleEligible: isLifecycleEntryFullEligibleMonth(entry, normalizedYearMonth),
      ...(includeMissingDates ? { missingReportDates: missingDates } : {}),
    };
  });

  return {
    ...empty,
    cutoffDate: normalizeIsoDate(cutoffDate) || getLifecycleMonthBounds(normalizedYearMonth)?.end || '',
    eligibleStoreCount: eligibleEntries.length,
    completeStoreCount,
    incompleteStoreCount,
    expectedStoreDayCount,
    submittedStoreDayCount,
    missingStoreDayCount,
    reportingStatus: missingStoreDayCount === 0 ? 'DATA_COMPLETE' : 'DATA_INCOMPLETE',
    stores,
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

function parseExpectedReportingCalendarRevision(value) {
  if (value === null || value === undefined || value === '') {
    const error = new Error('缺少營業日曆版本，請重新讀取後再操作');
    error.code = 'INVALID_REPORTING_CALENDAR_REVISION';
    throw error;
  }
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    const error = new Error('營業日曆版本格式錯誤');
    error.code = 'INVALID_REPORTING_CALENDAR_REVISION';
    throw error;
  }
  return revision;
}

function normalizeReportingCalendarMutationDates(values = []) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 366) {
    const error = new Error('公休日日期必須是 1～366 筆 YYYY-MM-DD 日期清單');
    error.code = 'INVALID_REPORTING_CALENDAR';
    throw error;
  }
  const invalid = values
    .map((value) => String(value || '').trim())
    .filter((value) => !normalizeIsoDate(value));
  if (invalid.length) {
    const error = new Error(`公休日日期格式錯誤：${invalid.slice(0, 5).join('、')}`);
    error.code = 'INVALID_REPORTING_CALENDAR';
    throw error;
  }
  return [...new Set(values.map(normalizeIsoDate).filter(Boolean))].sort();
}

function getTaipeiYearMonthForReportingCalendar() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}`;
}


function getTaipeiDateForStoreSchedule() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

const STORE_SCHEDULE_EVENT_PREFIX = 'store-schedule-v1';

function getStoreScheduleEventId(storeName = '', yearMonth = '') {
  const storeKey = normalizeStoreLifecycleCore(storeName);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  return storeKey && normalizedYearMonth
    ? `${STORE_SCHEDULE_EVENT_PREFIX}:${storeKey}:${normalizedYearMonth}`
    : '';
}

function normalizeStoreScheduleDates(values = [], yearMonth = '', today = '') {
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  const normalizedToday = normalizeIsoDate(today);
  const source = Array.isArray(values) ? values : [];
  if (!normalizedYearMonth || !normalizedToday) {
    const error = new Error('店家排休月份或目前日期無效');
    error.code = 'INVALID_STORE_SCHEDULE';
    throw error;
  }
  if (source.length > 31) {
    const error = new Error('單月店家排休最多 31 天');
    error.code = 'INVALID_STORE_SCHEDULE';
    throw error;
  }

  const normalized = [...new Set(source.map(normalizeIsoDate).filter(Boolean))].sort();
  if (normalized.length !== source.length || normalized.some((date) => !date.startsWith(`${normalizedYearMonth}-`))) {
    const error = new Error('店家排休日期必須全部屬於所選月份，且使用 YYYY-MM-DD');
    error.code = 'INVALID_STORE_SCHEDULE';
    throw error;
  }
  if (normalized.some((date) => date <= normalizedToday)) {
    const error = new Error('店家主管最早只能設定明天的排休；今天與歷史修正請由最高管理者處理');
    error.code = 'STORE_SCHEDULE_HISTORY_FORBIDDEN';
    throw error;
  }
  return normalized;
}

function reconcileStoreScheduleEvent({
  current = {},
  storeName = '',
  yearMonth = '',
  dates = [],
  today = '',
  actor = {},
} = {}) {
  const normalized = normalizeReportingCalendar(current);
  const storeKey = normalizeStoreLifecycleCore(storeName);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  const normalizedToday = normalizeIsoDate(today);
  const eventId = getStoreScheduleEventId(storeKey, normalizedYearMonth);
  const requestedDates = normalizeStoreScheduleDates(dates, normalizedYearMonth, normalizedToday);

  if (!storeKey || !eventId) {
    const error = new Error('店家排休缺少有效的店家或月份');
    error.code = 'INVALID_STORE_SCHEDULE';
    throw error;
  }

  const existing = normalized.storeClosureEvents.find((event) => event.id === eventId) || null;
  if (existing) {
    const exactStore = existing.storeKeys.length === 1 && existing.storeKeys[0] === storeKey;
    const exactMonth = existing.dates.every((date) => date.startsWith(`${normalizedYearMonth}-`));
    if (!exactStore || !exactMonth) {
      const error = new Error('店家排休事件識別已被其他資料占用，請由最高管理者檢查');
      error.code = 'STORE_SCHEDULE_EVENT_CONFLICT';
      throw error;
    }
  }

  const brandClosedSet = new Set(normalized.closedDates.map((row) => row.date));
  const lockedBrandDates = requestedDates.filter((date) => brandClosedSet.has(date));
  if (lockedBrandDates.length) {
    const error = new Error(`所選日期已有全品牌休店：${lockedBrandDates.join('、')}`);
    error.code = 'STORE_SCHEDULE_LOCKED_DATE';
    error.overlapDates = lockedBrandDates;
    throw error;
  }

  const externalOverlap = normalized.storeClosureEvents
    .filter((event) => event.id !== eventId && event.storeKeys.includes(storeKey))
    .flatMap((event) => event.dates.filter((date) => requestedDates.includes(date)));
  const lockedStoreDates = [...new Set(externalOverlap)].sort();
  if (lockedStoreDates.length) {
    const error = new Error(`所選日期已有中央管理休店設定：${lockedStoreDates.join('、')}`);
    error.code = 'STORE_SCHEDULE_LOCKED_DATE';
    error.overlapDates = lockedStoreDates;
    throw error;
  }

  const previousDates = existing ? [...existing.dates].sort() : [];
  const preservedLockedDates = previousDates.filter((date) => date <= normalizedToday);
  const nextDates = [...new Set([...preservedLockedDates, ...requestedDates])].sort();
  const changedDates = [...new Set([
    ...previousDates.filter((date) => !nextDates.includes(date)),
    ...nextDates.filter((date) => !previousDates.includes(date)),
  ])].sort();

  if (!changedDates.length) {
    return {
      changed: false,
      eventId,
      changedDates: [],
      storeScheduleDates: previousDates,
      storeClosureEvents: normalized.storeClosureEvents,
    };
  }

  const nextEvents = normalized.storeClosureEvents.filter((event) => event.id !== eventId);
  if (nextDates.length) {
    nextEvents.push({
      id: eventId,
      dates: nextDates,
      storeKeys: [storeKey],
      reason: '店家排休',
      createdAtText: String(existing?.createdAtText || actor.createdAtText || ''),
      createdBy: String(existing?.createdBy || actor.actorName || ''),
      createdByRole: String(existing?.createdByRole || actor.actorRole || ''),
      createdByAccountId: String(existing?.createdByAccountId || actor.actorAccountId || ''),
    });
  }

  return {
    changed: true,
    eventId,
    changedDates,
    storeScheduleDates: nextDates,
    storeClosureEvents: normalizeReportingCalendarStoreClosureEvents(nextEvents),
  };
}

function applyReportingCalendarMutation({
  current = {},
  operation = 'add',
  scope = 'brand',
  dates = [],
  reason = '',
  storeKeys = [],
  eventId = '',
  eventMeta = {},
} = {}) {
  const normalized = normalizeReportingCalendar(current);
  const mode = String(operation || '').trim().toLowerCase();
  const normalizedScope = String(scope || 'brand').trim().toLowerCase() === 'stores' ? 'stores' : 'brand';
  if (!['add', 'remove'].includes(mode)) {
    const error = new Error('營業日曆操作只支援 add / remove');
    error.code = 'INVALID_REPORTING_CALENDAR';
    throw error;
  }

  const normalizedReason = String(reason || '').trim();
  if (mode === 'add' && !normalizedReason) {
    const error = new Error('新增休店日必須填寫原因');
    error.code = 'INVALID_REPORTING_CALENDAR';
    throw error;
  }

  if (normalizedScope === 'brand') {
    const normalizedDates = normalizeReportingCalendarMutationDates(dates);
    if (mode === 'add') {
      const storeOverlap = normalized.storeClosureEvents.find((event) => (
        event.dates.some((date) => normalizedDates.includes(date))
      ));
      if (storeOverlap) {
        const error = new Error('選擇日期已有指定店家休店設定，請先取消該設定後再改為全品牌休店');
        error.code = 'REPORTING_CALENDAR_SCOPE_OVERLAP';
        error.currentEvent = storeOverlap;
        throw error;
      }
    }

    const byDate = new Map(normalized.closedDates.map((row) => [row.date, { ...row }]));
    const changedDates = [];
    normalizedDates.forEach((date) => {
      if (mode === 'add') {
        const previous = byDate.get(date);
        if (!previous || String(previous.reason || '') !== normalizedReason) {
          byDate.set(date, { date, reason: normalizedReason });
          changedDates.push(date);
        }
        return;
      }
      if (byDate.has(date)) {
        byDate.delete(date);
        changedDates.push(date);
      }
    });

    return {
      scope: 'brand',
      changed: changedDates.length > 0,
      changedDates,
      closedDates: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
      storeClosureEvents: normalized.storeClosureEvents,
      eventId: '',
    };
  }

  if (mode === 'remove') {
    const requestedEventId = String(eventId || '').trim();
    if (!requestedEventId) {
      const error = new Error('取消指定店家休店設定時缺少 eventId');
      error.code = 'INVALID_REPORTING_CALENDAR';
      throw error;
    }
    const existing = normalized.storeClosureEvents.find((event) => event.id === requestedEventId) || null;
    if (!existing) {
      return {
        scope: 'stores',
        changed: false,
        changedDates: [],
        closedDates: normalized.closedDates,
        storeClosureEvents: normalized.storeClosureEvents,
        eventId: requestedEventId,
      };
    }
    return {
      scope: 'stores',
      changed: true,
      changedDates: existing.dates,
      closedDates: normalized.closedDates,
      storeClosureEvents: normalized.storeClosureEvents.filter((event) => event.id !== requestedEventId),
      eventId: requestedEventId,
      removedEvent: existing,
    };
  }

  const normalizedDates = normalizeReportingCalendarMutationDates(dates);
  const normalizedStoreKeys = normalizeReportingCalendarStoreKeys(storeKeys);
  if (!normalizedStoreKeys.length) {
    const error = new Error('指定店家休店至少需要選擇一間門市');
    error.code = 'INVALID_REPORTING_CALENDAR';
    throw error;
  }

  const brandClosedDateSet = new Set(normalized.closedDates.map((row) => row.date));
  const brandOverlapDates = normalizedDates.filter((date) => brandClosedDateSet.has(date));
  if (brandOverlapDates.length) {
    const error = new Error('選擇日期已設定為全品牌休店，不需要再設定指定店家');
    error.code = 'REPORTING_CALENDAR_SCOPE_OVERLAP';
    error.overlapDates = brandOverlapDates;
    throw error;
  }

  const exact = normalized.storeClosureEvents.find((event) => (
    event.reason === normalizedReason
    && event.dates.length === normalizedDates.length
    && event.storeKeys.length === normalizedStoreKeys.length
    && event.dates.every((date, index) => date === normalizedDates[index])
    && event.storeKeys.every((storeKey, index) => storeKey === normalizedStoreKeys[index])
  ));
  if (exact) {
    return {
      scope: 'stores',
      changed: false,
      changedDates: [],
      closedDates: normalized.closedDates,
      storeClosureEvents: normalized.storeClosureEvents,
      eventId: exact.id,
    };
  }

  const overlap = normalized.storeClosureEvents.find((event) => (
    event.dates.some((date) => normalizedDates.includes(date))
    && event.storeKeys.some((storeKey) => normalizedStoreKeys.includes(storeKey))
  ));
  if (overlap) {
    const error = new Error('選擇的門市與日期已有休店設定，請先檢查既有休店紀錄');
    error.code = 'REPORTING_CALENDAR_STORE_OVERLAP';
    error.currentEvent = overlap;
    throw error;
  }

  const nextEventId = String(eventId || '').trim() || randomUUID();
  const nextEvent = {
    id: nextEventId,
    dates: normalizedDates,
    storeKeys: normalizedStoreKeys,
    reason: normalizedReason,
    createdAtText: String(eventMeta.createdAtText || ''),
    createdBy: String(eventMeta.createdBy || ''),
    createdByRole: String(eventMeta.createdByRole || ''),
    createdByAccountId: String(eventMeta.createdByAccountId || ''),
  };

  return {
    scope: 'stores',
    changed: true,
    changedDates: normalizedDates,
    closedDates: normalized.closedDates,
    storeClosureEvents: normalizeReportingCalendarStoreClosureEvents([
      ...normalized.storeClosureEvents,
      nextEvent,
    ]),
    eventId: nextEventId,
    addedEvent: nextEvent,
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
      let adminCheck = null;
      if (action !== 'update_store_schedule_v1') {
        adminCheck = await verifySuperAdminActor({ db, brandId, actor });
        if (!adminCheck.ok) {
          return res.status(403).json({ ok: false, message: '此操作僅限已信任裝置上的最高管理者使用' });
        }
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


      if (action === 'update_store_schedule_v1') {
        const roleId = String(actor?.roleId || '').trim();
        let actorCheck = null;

        if (roleId === 'director') {
          actorCheck = await verifySuperAdminActor({ db, brandId, actor });
        } else {
          actorCheck = await verifyTrustedApplicationActor({
            db,
            brandId,
            actor,
            allowedRoles: ['manager', 'store'],
          });
        }
        if (!actorCheck?.ok) {
          return res.status(403).json({ ok: false, code: 'STORE_SCHEDULE_ACTOR_DENIED', message: '目前帳號或裝置無法修改店家排休' });
        }

        const storeName = String(body.storeKey || body.storeName || '').trim();
        const explicitStoreBrand = detectStoreBrandFromName(storeName);
        if (explicitStoreBrand && explicitStoreBrand !== brandId) {
          return res.status(400).json({ ok: false, code: 'BRAND_MISMATCH', message: '店家品牌與目前品牌不一致' });
        }

        const storeKey = normalizeStoreLifecycleCore(storeName);
        const yearMonth = normalizeYearMonth(body.yearMonth);
        const today = getTaipeiDateForStoreSchedule();
        if (!storeKey || !yearMonth) {
          return res.status(400).json({ ok: false, code: 'INVALID_STORE_SCHEDULE', message: '請指定有效的店家與月份' });
        }
        if (yearMonth < today.slice(0, 7)) {
          return res.status(403).json({ ok: false, code: 'STORE_SCHEDULE_HISTORY_FORBIDDEN', message: '店家主管不能修改歷史月份排休' });
        }

        const dates = normalizeStoreScheduleDates(body.dates || [], yearMonth, today);
        const expectedCalendarRevision = parseExpectedReportingCalendarRevision(body.expectedCalendarRevision);
        const permissionsRef = getBrandSettingDoc(db, brandId, 'permissions');
        const orgRef = getBrandSettingDoc(db, brandId, 'org_structure');
        const auditRef = getBrandCollection(db, brandId, 'maintenance_logs').doc();
        let result = null;

        await db.runTransaction(async (transaction) => {
          const lifecyclePromise = transaction.get(lifecycleRef);
          const permissionPromise = roleId === 'director' ? Promise.resolve(null) : transaction.get(permissionsRef);
          const orgPromise = roleId === 'manager' ? transaction.get(orgRef) : Promise.resolve(null);
          const [lifecycleSnap, permissionsSnap, orgSnap] = await Promise.all([
            lifecyclePromise,
            permissionPromise,
            orgPromise,
          ]);

          const master = lifecycleSnap.exists ? (lifecycleSnap.data() || {}) : {};
          const currentCalendar = normalizeReportingCalendar(master.reportingCalendar || {});
          if (currentCalendar.revision !== expectedCalendarRevision) {
            const error = new Error('店家排休已由其他使用者更新，請重新載入後再儲存');
            error.code = 'REPORTING_CALENDAR_CONFLICT';
            error.currentCalendar = currentCalendar;
            throw error;
          }

          if (roleId !== 'director') {
            const permissionData = permissionsSnap?.exists ? (permissionsSnap.data() || {}) : {};
            const rolePermissions = Array.isArray(permissionData[roleId]) ? permissionData[roleId] : [];
            if (!rolePermissions.includes('store-schedule')) {
              const error = new Error('目前角色尚未開放「店家排休」模組權限');
              error.code = 'STORE_SCHEDULE_PERMISSION_DENIED';
              throw error;
            }
          }

          let allowedStoreKeys = [];
          if (roleId === 'director') {
            allowedStoreKeys = Object.keys(master.stores || {}).map(normalizeStoreLifecycleCore).filter(Boolean);
          } else if (roleId === 'manager') {
            const orgData = orgSnap?.exists ? (orgSnap.data() || {}) : {};
            const managers = orgData.managers && typeof orgData.managers === 'object' ? orgData.managers : {};
            const managerStores = managers[actorCheck.actorAccountId] || managers[actorCheck.actorName] || [];
            allowedStoreKeys = normalizeReportingCalendarStoreKeys(managerStores);
          } else if (roleId === 'store') {
            allowedStoreKeys = normalizeReportingCalendarStoreKeys(actorCheck.credential?.stores || []);
          }

          if (!allowedStoreKeys.includes(storeKey)) {
            const error = new Error('這間店不在目前帳號的正式管理範圍內');
            error.code = 'STORE_SCHEDULE_SCOPE_DENIED';
            throw error;
          }

          const lifecycleEntry = master?.stores?.[storeKey];
          const lifecycleCheck = validateLifecycleDraft(lifecycleEntry || {});
          if (!lifecycleEntry || !lifecycleCheck.valid || lifecycleCheck.entryStatus !== 'COMPLETE') {
            const error = new Error('這間店尚未完成 Lifecycle，不能設定店家排休');
            error.code = 'INVALID_REPORTING_CALENDAR_STORE';
            error.details = [storeKey];
            throw error;
          }

          const baselineExpectedDates = new Set(getLifecycleExpectedReportDates(lifecycleEntry, yearMonth, { closedDates: [] }));
          const outsideLifecycleDates = dates.filter((date) => !baselineExpectedDates.has(date));
          if (outsideLifecycleDates.length) {
            const error = new Error(`所選日期不在店家正式營運期間：${outsideLifecycleDates.join('、')}`);
            error.code = 'STORE_SCHEDULE_OUTSIDE_LIFECYCLE';
            error.details = outsideLifecycleDates;
            throw error;
          }

          const nowText = new Date().toISOString();
          const mutation = reconcileStoreScheduleEvent({
            current: currentCalendar,
            storeName: storeKey,
            yearMonth,
            dates,
            today,
            actor: {
              actorName: actorCheck.actorName,
              actorRole: actorCheck.actorRole,
              actorAccountId: actorCheck.actorAccountId,
              createdAtText: nowText,
            },
          });

          if (!mutation.changed) {
            result = {
              changed: false,
              eventId: mutation.eventId,
              storeKey,
              yearMonth,
              storeScheduleDates: mutation.storeScheduleDates,
              reportingCalendar: currentCalendar,
            };
            return;
          }

          const nextCalendarRevision = currentCalendar.revision + 1;
          const nextMonthRevisions = { ...(currentCalendar.monthRevisions || {}) };
          nextMonthRevisions[yearMonth] = Math.max(0, Number(nextMonthRevisions[yearMonth] || 0)) + 1;
          const reportingCalendar = {
            schemaVersion: REPORTING_CALENDAR_SCHEMA_VERSION,
            revision: nextCalendarRevision,
            monthRevisions: nextMonthRevisions,
            closedDates: currentCalendar.closedDates,
            storeClosureEvents: mutation.storeClosureEvents,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: nowText,
            updatedBy: actorCheck.actorName,
            updatedByRole: actorCheck.actorRole,
            updatedByAccountId: actorCheck.actorAccountId,
          };

          transaction.set(lifecycleRef, {
            reportingCalendar,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: nowText,
            updatedBy: actorCheck.actorName,
            updatedByRole: actorCheck.actorRole,
            updatedByAccountId: actorCheck.actorAccountId,
          }, { merge: true });

          transaction.set(auditRef, buildLifecycleAuditPayload({
            admin,
            brandId,
            actor: actorCheck,
            action: 'update_store_schedule',
            details: {
              storeKey,
              yearMonth,
              eventId: mutation.eventId,
              changedDates: mutation.changedDates,
              previousCalendarRevision: currentCalendar.revision,
              reportingCalendarRevision: nextCalendarRevision,
              monthRevision: nextMonthRevisions[yearMonth],
              source: 'store_schedule_v1',
            },
          }), { merge: false });

          result = {
            changed: true,
            eventId: mutation.eventId,
            storeKey,
            yearMonth,
            storeScheduleDates: mutation.storeScheduleDates,
            reportingCalendar: {
              schemaVersion: REPORTING_CALENDAR_SCHEMA_VERSION,
              revision: nextCalendarRevision,
              monthRevisions: nextMonthRevisions,
              closedDates: currentCalendar.closedDates,
              storeClosureEvents: mutation.storeClosureEvents,
              updatedAtText: nowText,
              updatedBy: actorCheck.actorName,
              updatedByRole: actorCheck.actorRole,
              updatedByAccountId: actorCheck.actorAccountId,
            },
          };
        });

        return res.status(200).json({ ok: true, ...result });
      }

if (action === 'update_reporting_calendar' || action === 'update_reporting_calendar_v2') {
        const isReportingCalendarV2Action = action === 'update_reporting_calendar_v2';
        const operation = String(body.operation || 'add').trim().toLowerCase();
        const requestedScope = String(body.scope || 'brand').trim().toLowerCase() === 'stores' ? 'stores' : 'brand';
        if (!isReportingCalendarV2Action && requestedScope === 'stores') {
          return res.status(400).json({
            ok: false,
            code: 'REPORTING_CALENDAR_V2_ACTION_REQUIRED',
            message: '指定店家休店必須使用 Reporting Calendar V2 action',
          });
        }
        const scope = isReportingCalendarV2Action ? requestedScope : 'brand';
        const rawStoreKeys = Array.isArray(body.storeKeys) ? body.storeKeys : [];
        const mismatchedStoreBrand = rawStoreKeys.find((value) => {
          const explicitStoreBrand = detectStoreBrandFromName(value);
          return explicitStoreBrand && explicitStoreBrand !== brandId;
        });
        if (mismatchedStoreBrand) {
          return res.status(400).json({ ok: false, code: 'BRAND_MISMATCH', message: '指定店家品牌與目前品牌不一致' });
        }
        const storeKeys = normalizeReportingCalendarStoreKeys(rawStoreKeys);
        const dates = scope === 'stores' && operation === 'remove'
          ? []
          : normalizeReportingCalendarMutationDates(body.dates || []);
        const reason = String(body.reason || '').trim();
        const eventId = String(body.eventId || '').trim();
        const expectedCalendarRevision = parseExpectedReportingCalendarRevision(body.expectedCalendarRevision);
        const auditRef = getBrandCollection(db, brandId, 'maintenance_logs').doc();
        let result = null;

        await db.runTransaction(async (transaction) => {
          const lifecycleSnap = await transaction.get(lifecycleRef);
          const master = lifecycleSnap.exists ? (lifecycleSnap.data() || {}) : {};
          const currentCalendar = normalizeReportingCalendar(master.reportingCalendar || {});

          if (currentCalendar.revision !== expectedCalendarRevision) {
            const error = new Error('營業日曆已由其他管理者更新，請重新讀取後再操作');
            error.code = 'REPORTING_CALENDAR_CONFLICT';
            error.currentCalendar = currentCalendar;
            throw error;
          }

          if (scope === 'stores' && operation === 'add') {
            const lifecycleStores = master.stores && typeof master.stores === 'object' && !Array.isArray(master.stores)
              ? master.stores
              : {};
            const invalidStoreKeys = storeKeys.filter((storeKey) => {
              const entry = lifecycleStores[storeKey];
              if (!entry) return true;
              const check = validateLifecycleDraft(entry || {});
              return !check.valid || check.entryStatus !== 'COMPLETE';
            });
            if (invalidStoreKeys.length) {
              const error = new Error(`指定店家尚未完成 Lifecycle：${invalidStoreKeys.join('、')}`);
              error.code = 'INVALID_REPORTING_CALENDAR_STORE';
              error.details = invalidStoreKeys;
              throw error;
            }
          }

          const nowText = new Date().toISOString();
          const mutation = applyReportingCalendarMutation({
            current: currentCalendar,
            operation,
            scope,
            dates,
            reason,
            storeKeys,
            eventId,
            eventMeta: {
              createdAtText: nowText,
              createdBy: adminCheck.actorName,
              createdByRole: adminCheck.actorRole,
              createdByAccountId: adminCheck.actorAccountId,
            },
          });

          if (!mutation.changed) {
            result = {
              changed: false,
              reportingCalendar: currentCalendar,
              eventId: mutation.eventId || '',
              affectedHistoricalMonths: [],
            };
            return;
          }

          const nextCalendarRevision = currentCalendar.revision + 1;
          const changedMonths = [...new Set(
            mutation.changedDates.map((date) => date.slice(0, 7))
          )].sort();
          const nextMonthRevisions = { ...(currentCalendar.monthRevisions || {}) };
          changedMonths.forEach((yearMonth) => {
            nextMonthRevisions[yearMonth] = Math.max(
              0,
              Number(nextMonthRevisions[yearMonth] || 0)
            ) + 1;
          });
          const reportingCalendar = {
            schemaVersion: REPORTING_CALENDAR_SCHEMA_VERSION,
            revision: nextCalendarRevision,
            monthRevisions: nextMonthRevisions,
            closedDates: mutation.closedDates,
            storeClosureEvents: mutation.storeClosureEvents,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: nowText,
            updatedBy: adminCheck.actorName,
            updatedByRole: adminCheck.actorRole,
            updatedByAccountId: adminCheck.actorAccountId,
          };

          // Reporting Calendar uses its own revision. Do NOT advance Lifecycle master
          // revision, otherwise every historical Summary would fail Lifecycle revision trust.
          transaction.set(lifecycleRef, {
            reportingCalendar,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: nowText,
            updatedBy: adminCheck.actorName,
            updatedByRole: adminCheck.actorRole,
            updatedByAccountId: adminCheck.actorAccountId,
          }, { merge: true });

          const currentTaipeiYearMonth = getTaipeiYearMonthForReportingCalendar();
          const affectedHistoricalMonths = changedMonths
            .filter((yearMonth) => yearMonth < currentTaipeiYearMonth)
            .filter((yearMonth) => getLifecycleEligibleStoreEntries(master, yearMonth, {
              brandId,
              requireReady: true,
            }).length > 0)
            .sort();

          affectedHistoricalMonths.forEach((yearMonth) => {
            const flagRef = getBrandCollection(db, brandId, 'summary_recalc_flags').doc(yearMonth);
            const monthClosedDates = reportingCalendar.closedDates
              .filter((row) => row.date.startsWith(`${yearMonth}-`))
              .map((row) => ({ date: row.date, reason: row.reason }));

            const monthStoreClosureEvents = reportingCalendar.storeClosureEvents
              .filter((event) => event.dates.some((date) => date.startsWith(`${yearMonth}-`)));
            const monthStoreClosedPairs = new Set();
            monthStoreClosureEvents.forEach((event) => {
              event.dates
                .filter((date) => date.startsWith(`${yearMonth}-`))
                .forEach((date) => {
                  event.storeKeys.forEach((storeKey) => monthStoreClosedPairs.add(`${storeKey}@@${date}`));
                });
            });
            const nextMonthRevision = Math.max(
              0,
              Number(reportingCalendar.monthRevisions?.[yearMonth] || 0)
            );

            transaction.set(flagRef, {
              brandId,
              yearMonth,
              affectedYearMonth: yearMonth,
              status: 'dirty',
              dirty: true,
              dirtyReason: 'reporting_calendar_changed',
              requiredReportingCalendarRevision: nextMonthRevision,
              reportingCalendarSnapshot: {
                schemaVersion: REPORTING_CALENDAR_SCHEMA_VERSION,
                masterRevision: nextCalendarRevision,
                revision: nextMonthRevision,
                closedDates: monthClosedDates,
                storeClosureEventCount: monthStoreClosureEvents.length,
                storeClosedReportDayCount: monthStoreClosedPairs.size,
              },
              lastDirtyAt: admin.firestore.FieldValue.serverTimestamp(),
              lastDirtyAtText: nowText,
              rebuildAfterAtText: nowText,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAtText: nowText,
              updatedBy: 'reporting_calendar_backend_v1',
              updatedByRole: 'system',
            }, { merge: true });
          });

          transaction.set(auditRef, buildLifecycleAuditPayload({
            admin,
            brandId,
            actor: adminCheck,
            action: 'update_reporting_calendar',
            details: {
              operation,
              scope,
              dates: mutation.changedDates,
              reason,
              storeKeys: scope === 'stores' ? storeKeys : [],
              eventId: mutation.eventId || '',
              previousCalendarRevision: currentCalendar.revision,
              reportingCalendarRevision: nextCalendarRevision,
              changedMonthRevisions: Object.fromEntries(
                changedMonths.map((yearMonth) => [
                  yearMonth,
                  Number(reportingCalendar.monthRevisions?.[yearMonth] || 0),
                ])
              ),
              changedDates: mutation.changedDates,
              affectedHistoricalMonths,
            },
          }), { merge: false });

          result = {
            changed: true,
            reportingCalendar: {
              schemaVersion: REPORTING_CALENDAR_SCHEMA_VERSION,
              revision: nextCalendarRevision,
              monthRevisions: nextMonthRevisions,
              closedDates: mutation.closedDates,
              storeClosureEvents: mutation.storeClosureEvents,
              updatedAtText: nowText,
              updatedBy: adminCheck.actorName,
              updatedByRole: adminCheck.actorRole,
              updatedByAccountId: adminCheck.actorAccountId,
            },
            eventId: mutation.eventId || '',
            affectedHistoricalMonths,
          };
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
      if (error?.code === 'REPORTING_CALENDAR_CONFLICT') {
        return res.status(409).json({
          ok: false,
          code: error.code,
          message: error.message,
          currentReportingCalendar: error.currentCalendar || null,
        });
      }
      if (error?.code === 'REPORTING_CALENDAR_STORE_OVERLAP' || error?.code === 'REPORTING_CALENDAR_SCOPE_OVERLAP') {
        return res.status(409).json({
          ok: false,
          code: error.code,
          message: error.message,
          currentEvent: error.currentEvent || null,
          overlapDates: Array.isArray(error.overlapDates) ? error.overlapDates : [],
        });
      }
      if (
        error?.code === 'STORE_SCHEDULE_PERMISSION_DENIED'
        || error?.code === 'STORE_SCHEDULE_SCOPE_DENIED'
        || error?.code === 'STORE_SCHEDULE_HISTORY_FORBIDDEN'
      ) {
        return res.status(403).json({ ok: false, code: error.code, message: error.message });
      }
      if (
        error?.code === 'STORE_SCHEDULE_LOCKED_DATE'
        || error?.code === 'STORE_SCHEDULE_EVENT_CONFLICT'
      ) {
        return res.status(409).json({
          ok: false,
          code: error.code,
          message: error.message,
          overlapDates: Array.isArray(error.overlapDates) ? error.overlapDates : [],
        });
      }
      if (
        error?.code === 'INVALID_STORE_SCHEDULE'
        || error?.code === 'STORE_SCHEDULE_OUTSIDE_LIFECYCLE'
      ) {
        return res.status(400).json({
          ok: false,
          code: error.code,
          message: error.message,
          details: Array.isArray(error.details) ? error.details : [],
        });
      }
      if (error?.code === 'LIFECYCLE_CONFLICT') {
        return res.status(409).json({
          ok: false,
          code: error.code,
          message: error.message,
          currentRevision: Number(error.currentRevision || 0),
        });
      }
      if (
        error?.code === 'LIFECYCLE_NOT_READY'
        || error?.code === 'INVALID_LIFECYCLE'
        || error?.code === 'INVALID_STORE_IDENTITY'
        || error?.code === 'INVALID_REPORTING_CALENDAR'
        || error?.code === 'INVALID_REPORTING_CALENDAR_REVISION'
        || error?.code === 'INVALID_REPORTING_CALENDAR_STORE'
      ) {
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
  REPORTING_COMPLETENESS_SCHEMA_VERSION,
  REPORTING_CALENDAR_SCHEMA_VERSION,
  normalizeReportingCalendarClosedDates,
  normalizeReportingCalendarStoreClosureEvents,
  normalizeReportingCalendarMonthRevisions,
  normalizeReportingCalendar,
  applyReportingCalendarMutation,
  STORE_SCHEDULE_EVENT_PREFIX,
  getStoreScheduleEventId,
  normalizeStoreScheduleDates,
  reconcileStoreScheduleEvent,
  resolveRequestedBrandId,
  detectStoreBrandFromName,
  normalizeStoreLifecycleCore,
  getCanonicalStoreName,
  validateLifecycleDraft,
  isLifecycleEntryEligibleForMonth,
  getLifecycleEligibleStoreEntries,
  isLifecycleEntryExpectedForDate,
  isLifecycleEntryFullEligibleMonth,
  getLifecycleExpectedReportDates,
  buildLifecycleReportingCompleteness,
  buildReadyValidation,
};
