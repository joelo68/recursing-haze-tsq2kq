export const STORE_LIFECYCLE_SCHEMA_VERSION = "store-lifecycle-v1";
export const REPORTING_COMPLETENESS_SCHEMA_VERSION = "reporting-completeness-v1";
export const REPORTING_CALENDAR_SCHEMA_VERSION = "reporting-calendar-v2";
export const STORE_LIFECYCLE_DATASET_STATUSES = Object.freeze(["BUILDING", "READY"]);
export const STORE_SCHEDULE_EVENT_PREFIX = "store-schedule-v1";

const BRAND_META = Object.freeze({
  cyj: { id: "cyj", label: "CYJ", prefix: "CYJ" },
  anniu: { id: "anniu", label: "安妞", prefix: "安妞" },
  yibo: { id: "yibo", label: "伊啵", prefix: "伊啵" },
});

export const normalizeLifecycleBrandId = (value = "") => {
  const raw = typeof value === "object" && value ? (value.id || value.brandId || value.value) : value;
  const id = String(raw || "cyj").trim().toLowerCase();
  if (["default", "default-app-id", "drcyj", "cyj"].includes(id)) return "cyj";
  if (["anniu", "anew", "安妞"].includes(id)) return "anniu";
  if (["yibo", "伊啵"].includes(id)) return "yibo";
  return "cyj";
};

export const getLifecycleBrandMeta = (brandId = "cyj") => (
  BRAND_META[normalizeLifecycleBrandId(brandId)] || BRAND_META.cyj
);

export const detectLifecycleStoreBrand = (value = "") => {
  const text = String(value || "").trim().replace(/[　\s]+/g, "");
  if (/^(DR\.?CYJ|CYJ)/i.test(text)) return "cyj";
  if (/^(Anew安妞|Anew|Ann|安妞)/i.test(text)) return "anniu";
  if (/^(Yibo伊啵|Yibo|伊啵)/i.test(text)) return "yibo";
  return "";
};

export const lifecycleStoreBrandMatches = (value = "", brandId = "cyj") => {
  const detected = detectLifecycleStoreBrand(value);
  return !detected || detected === normalizeLifecycleBrandId(brandId);
};

const stripBrandPrefix = (value = "") => String(value || "")
  .trim()
  .replace(/[　\s]+/g, "")
  .replace(/[（）()]/g, "")
  .replace(/臺/g, "台")
  .replace(/^DR\.?CYJ/i, "CYJ")
  .replace(/^(CYJ|Anew安妞|Yibo伊啵|Anew|Yibo|Ann|安妞|伊啵)/i, "")
  .trim();

export const normalizeStoreLifecycleCore = (value = "") => {
  const core = stripBrandPrefix(value);
  if (!core) return "";

  // Production Store Identity guard：歷史上「新店」曾被誤裁成「新」。
  // Lifecycle 必須把所有已知 alias 歸到同一個 core，避免建立第二套 store identity。
  if (core === "新" || /^新店店?$/.test(core)) return "新店";

  return core.replace(/店+$/g, "").trim();
};

export const getCanonicalLifecycleStoreName = (value = "", brandId = "cyj") => {
  const core = normalizeStoreLifecycleCore(value);
  if (!core) return "";
  const { prefix } = getLifecycleBrandMeta(brandId);
  return `${prefix}${core}店`;
};

export const getStoreLifecycleKey = (value = "") => normalizeStoreLifecycleCore(value);


export const getStoreScheduleEventId = (storeName = "", yearMonth = "") => {
  const storeKey = normalizeStoreLifecycleCore(storeName);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  return storeKey && normalizedYearMonth
    ? `${STORE_SCHEDULE_EVENT_PREFIX}:${storeKey}:${normalizedYearMonth}`
    : "";
};


export const normalizeYearMonth = (value = "") => {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
};

export const normalizeIsoDate = (value = "") => {
  const text = String(value || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(text)) return "";
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  const [year, month, day] = text.split("-").map(Number);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return "";
  return text;
};

export const normalizeReportingCalendarClosedDates = (values = []) => {
  const source = Array.isArray(values) ? values : [];
  const byDate = new Map();

  source.forEach((value) => {
    const row = typeof value === "string"
      ? { date: value }
      : (value && typeof value === "object" ? value : {});
    const date = normalizeIsoDate(row.date);
    if (!date) return;
    byDate.set(date, {
      date,
      reason: String(row.reason || "").trim(),
    });
  });

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
};

export const normalizeReportingCalendarStoreClosureEvents = (values = []) => {
  const source = Array.isArray(values) ? values : [];
  const byId = new Map();

  source.forEach((value, index) => {
    const row = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const dates = [...new Set(
      (Array.isArray(row.dates) ? row.dates : [row.date])
        .map(normalizeIsoDate)
        .filter(Boolean)
    )].sort();
    const storeKeys = [...new Set(
      (Array.isArray(row.storeKeys) ? row.storeKeys : [row.storeKey])
        .map(normalizeStoreLifecycleCore)
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    if (!dates.length || !storeKeys.length) return;

    const fallbackId = `legacy-store-closure-${dates[0]}-${index + 1}`;
    const id = String(row.id || row.eventId || fallbackId).trim() || fallbackId;
    byId.set(id, {
      id,
      dates,
      storeKeys,
      reason: String(row.reason || "").trim(),
      createdAtText: String(row.createdAtText || ""),
      createdBy: String(row.createdBy || ""),
      createdByRole: String(row.createdByRole || ""),
      createdByAccountId: String(row.createdByAccountId || ""),
    });
  });

  return [...byId.values()].sort((a, b) => (
    String(a.dates?.[0] || "").localeCompare(String(b.dates?.[0] || ""))
    || String(a.id || "").localeCompare(String(b.id || ""))
  ));
};

export const getReportingCalendarStoreClosedDates = (calendar = {}, storeName = "") => {
  const storeKey = normalizeStoreLifecycleCore(storeName);
  if (!storeKey) return [];
  const normalized = normalizeReportingCalendar(calendar);
  return [...new Set(
    normalized.storeClosureEvents
      .filter((event) => event.storeKeys.includes(storeKey))
      .flatMap((event) => event.dates)
  )].sort();
};

export const normalizeReportingCalendarMonthRevisions = (raw = {}) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([yearMonth, value]) => [normalizeYearMonth(yearMonth), Number(value)])
      .filter(([yearMonth, value]) => (
        Boolean(yearMonth) && Number.isInteger(value) && value >= 0
      ))
      .sort(([a], [b]) => a.localeCompare(b))
  );
};

export const normalizeReportingCalendar = (raw = {}) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    schemaVersion: String(source.schemaVersion || REPORTING_CALENDAR_SCHEMA_VERSION),
    revision: Math.max(0, Number(source.revision || 0)),
    monthRevisions: normalizeReportingCalendarMonthRevisions(source.monthRevisions),
    closedDates: normalizeReportingCalendarClosedDates(source.closedDates),
    storeClosureEvents: normalizeReportingCalendarStoreClosureEvents(source.storeClosureEvents),
    updatedAtText: String(source.updatedAtText || ""),
    updatedBy: String(source.updatedBy || ""),
    updatedByRole: String(source.updatedByRole || ""),
    updatedByAccountId: String(source.updatedByAccountId || ""),
  };
};

const getReportingClosedDateSet = (values = []) => new Set(
  normalizeReportingCalendarClosedDates(values).map((row) => row.date)
);

export const REPORTING_CALENDAR_TRUST_REASON = Object.freeze({
  TRUSTED: "REPORTING_CALENDAR_TRUSTED",
  AUTHORITY_NOT_READY: "REPORTING_CALENDAR_AUTHORITY_NOT_READY",
  BRAND_MISMATCH: "REPORTING_CALENDAR_BRAND_MISMATCH",
  SUMMARY_REVISION_MISMATCH: "REPORTING_CALENDAR_SUMMARY_REVISION_MISMATCH",
  FLAG_REVISION_MISMATCH: "REPORTING_CALENDAR_FLAG_REVISION_MISMATCH",
});

const readReportingCalendarRevision = (value, legacyValue = 0) => {
  if (value === null || value === undefined || value === "") return legacyValue;
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : null;
};

export const inspectHistoricalReportingCalendarTrust = ({
  currentLifecycleMasterState,
  dashboardSummary = null,
  summaryFlag = null,
  brandId = "",
} = {}) => {
  const state = currentLifecycleMasterState || {};
  const master = state?.data || null;
  const expectedBrandId = normalizeLifecycleBrandId(
    brandId || dashboardSummary?.brandId || master?.brandId || "cyj"
  );
  const stateBrandId = normalizeLifecycleBrandId(state?.brandId || master?.brandId || "cyj");

  if (state?.ready !== true || !master || String(master?.datasetStatus || "") !== "READY") {
    return {
      trusted: false,
      reason: REPORTING_CALENDAR_TRUST_REASON.AUTHORITY_NOT_READY,
      currentRevision: null,
    };
  }

  if (stateBrandId !== expectedBrandId) {
    return {
      trusted: false,
      reason: REPORTING_CALENDAR_TRUST_REASON.BRAND_MISMATCH,
      currentRevision: null,
    };
  }

  const yearMonth = normalizeYearMonth(
    dashboardSummary?.yearMonth
    || dashboardSummary?.id
    || summaryFlag?.affectedYearMonth
    || summaryFlag?.yearMonth
    || summaryFlag?.id
    || ""
  );
  const calendar = normalizeReportingCalendar(master?.reportingCalendar || {});
  const currentRevision = Math.max(0, Number(calendar.monthRevisions?.[yearMonth] || 0));

  const summaryRevision = readReportingCalendarRevision(
    dashboardSummary?.reportingCompleteness?.reportingCalendarRevision,
    0
  );
  if (summaryRevision === null || summaryRevision !== currentRevision) {
    return {
      trusted: false,
      reason: REPORTING_CALENDAR_TRUST_REASON.SUMMARY_REVISION_MISMATCH,
      yearMonth,
      currentRevision,
      summaryRevision,
    };
  }

  const flagRevision = readReportingCalendarRevision(summaryFlag?.reportingCalendarRevision, 0);
  const requiredRevision = readReportingCalendarRevision(
    summaryFlag?.requiredReportingCalendarRevision,
    0
  );
  if (
    flagRevision === null
    || requiredRevision === null
    || flagRevision !== currentRevision
    || requiredRevision > flagRevision
  ) {
    return {
      trusted: false,
      reason: REPORTING_CALENDAR_TRUST_REASON.FLAG_REVISION_MISMATCH,
      yearMonth,
      currentRevision,
      summaryRevision,
      flagRevision,
      requiredRevision,
    };
  }

  return {
    trusted: true,
    reason: REPORTING_CALENDAR_TRUST_REASON.TRUSTED,
    yearMonth,
    currentRevision,
    summaryRevision,
    flagRevision,
    requiredRevision,
  };
};

export const normalizeExemptMonths = (values = []) => {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map(normalizeYearMonth).filter(Boolean))].sort();
};

export const getLifecycleEntryCompleteness = (entry = {}) => {
  const firstEligibleMonth = normalizeYearMonth(entry.firstEligibleMonth);
  const openDate = normalizeIsoDate(entry.openDate);
  const lastEligibleMonth = normalizeYearMonth(entry.lastEligibleMonth);
  const closeDate = normalizeIsoDate(entry.closeDate);

  if (!firstEligibleMonth || !openDate) return "INCOMPLETE";
  if (openDate.slice(0, 7) > firstEligibleMonth) return "INVALID";

  const hasClosureMonth = Boolean(lastEligibleMonth);
  const hasCloseDate = Boolean(closeDate);
  if (hasClosureMonth !== hasCloseDate) return "INCOMPLETE";

  if (hasClosureMonth) {
    if (lastEligibleMonth < firstEligibleMonth) return "INVALID";
    if (closeDate < openDate) return "INVALID";
    if (closeDate.slice(0, 7) !== lastEligibleMonth) return "INVALID";
  }

  const exemptMonths = normalizeExemptMonths(entry.exemptMonths);
  if (exemptMonths.some((month) => month < firstEligibleMonth)) return "INVALID";
  if (lastEligibleMonth && exemptMonths.some((month) => month > lastEligibleMonth)) return "INVALID";
  if (exemptMonths.includes(firstEligibleMonth)) return "INVALID";
  if (lastEligibleMonth && exemptMonths.includes(lastEligibleMonth)) return "INVALID";

  return "COMPLETE";
};

export const validateLifecycleEntryDraft = (entry = {}) => {
  const errors = [];
  const firstRaw = String(entry.firstEligibleMonth || "").trim();
  const openRaw = String(entry.openDate || "").trim();
  const lastRaw = String(entry.lastEligibleMonth || "").trim();
  const closeRaw = String(entry.closeDate || "").trim();

  const firstEligibleMonth = normalizeYearMonth(firstRaw);
  const openDate = normalizeIsoDate(openRaw);
  const lastEligibleMonth = normalizeYearMonth(lastRaw);
  const closeDate = normalizeIsoDate(closeRaw);
  const rawExemptMonths = entry.exemptMonths == null ? [] : entry.exemptMonths;
  const exemptMonths = normalizeExemptMonths(rawExemptMonths);

  if (!Array.isArray(rawExemptMonths)) errors.push("暫停營運月份格式必須是月份清單");
  else if (rawExemptMonths.some((month) => String(month || "").trim() && !normalizeYearMonth(month))) errors.push("暫停營運月份格式需為 YYYY-MM");
  if (firstRaw && !firstEligibleMonth) errors.push("納入月份格式需為 YYYY-MM");
  if (openRaw && !openDate) errors.push("開始日期格式需為 YYYY-MM-DD");
  if (lastRaw && !lastEligibleMonth) errors.push("永久結束月份格式需為 YYYY-MM");
  if (closeRaw && !closeDate) errors.push("永久結束日期格式需為 YYYY-MM-DD");

  if (firstEligibleMonth && openDate && openDate.slice(0, 7) > firstEligibleMonth) {
    errors.push("實際開始營運日期不可晚於首次正式納管月份");
  }

  if (lastEligibleMonth && closeDate && closeDate.slice(0, 7) !== lastEligibleMonth) {
    errors.push("永久結束日期必須落在永久結束月份內");
  }

  if (firstEligibleMonth && lastEligibleMonth && lastEligibleMonth < firstEligibleMonth) {
    errors.push("永久結束月份不可早於納入月份");
  }

  if (openDate && closeDate && closeDate < openDate) {
    errors.push("永久結束日期不可早於開始日期");
  }

  if (exemptMonths.length && !firstEligibleMonth) {
    errors.push("設定暫停營運月份前，請先設定納入月份");
  }

  if (firstEligibleMonth && exemptMonths.some((month) => month < firstEligibleMonth)) {
    errors.push("暫停營運月份不可早於納入月份");
  }

  if (lastEligibleMonth && exemptMonths.some((month) => month > lastEligibleMonth)) {
    errors.push("暫停營運月份不可晚於永久結束月份");
  }

  if (firstEligibleMonth && exemptMonths.includes(firstEligibleMonth)) {
    errors.push("開店／納入月份必須是正式納管月份，不可同時設為整月暫停");
  }

  if (lastEligibleMonth && exemptMonths.includes(lastEligibleMonth)) {
    errors.push("永久結束月份仍是正式納管月份，不可同時設為整月暫停");
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      firstEligibleMonth,
      openDate,
      lastEligibleMonth,
      closeDate,
      exemptMonths,
    },
  };
};


// Batch 3 Target Coverage authority：Lifecycle 是「某月份是否屬於正式 KPI cohort」的單一來源。
// 不使用 openDate 推導 monthly eligibility；openDate / closeDate 是 daily boundary，月度 cohort 由 first/last/exempt 決定。
export const isLifecycleEntryEligibleForMonth = (entry = {}, yearMonth = "") => {
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedYearMonth) return false;
  if (getLifecycleEntryCompleteness(entry) !== "COMPLETE") return false;

  const firstEligibleMonth = normalizeYearMonth(entry.firstEligibleMonth);
  const lastEligibleMonth = normalizeYearMonth(entry.lastEligibleMonth);
  const exemptMonths = normalizeExemptMonths(entry.exemptMonths);

  if (!firstEligibleMonth || normalizedYearMonth < firstEligibleMonth) return false;
  if (lastEligibleMonth && normalizedYearMonth > lastEligibleMonth) return false;
  if (exemptMonths.includes(normalizedYearMonth)) return false;
  return true;
};

export const getLifecycleEligibleStoreEntries = (master = {}, yearMonth = "", options = {}) => {
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedYearMonth) return [];

  const requireReady = options.requireReady !== false;
  if (requireReady && String(master?.datasetStatus || "") !== "READY") return [];

  const brandId = normalizeLifecycleBrandId(master?.brandId || options.brandId || "cyj");
  const reportingCalendar = normalizeReportingCalendar(master?.reportingCalendar || {});
  const reportingCalendarBrandClosedDates = reportingCalendar.closedDates;
  const rawStores = master?.stores && typeof master.stores === "object" && !Array.isArray(master.stores)
    ? master.stores
    : {};

  return Object.entries(rawStores)
    .map(([key, value]) => {
      const normalizedEntry = normalizeLifecycleEntry(value || {}, key, brandId);
      const reportingCalendarStoreClosedDates = getReportingCalendarStoreClosedDates(
        reportingCalendar,
        normalizedEntry.storeKey
      );
      const reportingCalendarClosedDates = [...new Set([
        ...reportingCalendarBrandClosedDates.map((row) => row.date),
        ...reportingCalendarStoreClosedDates,
      ])].sort();
      return {
        ...normalizedEntry,
        reportingCalendarBrandClosedDates,
        reportingCalendarStoreClosedDates,
        reportingCalendarClosedDates,
      };
    })
    .filter((entry) => isLifecycleEntryEligibleForMonth(entry, normalizedYearMonth))
    .sort((a, b) => String(a.canonicalStoreName || a.storeKey).localeCompare(String(b.canonicalStoreName || b.storeKey), "zh-Hant"));
};

const getLifecycleMonthBounds = (yearMonth = "") => {
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  if (!normalizedYearMonth) return null;
  const [year, month] = normalizedYearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${normalizedYearMonth}-01`,
    end: `${normalizedYearMonth}-${String(lastDay).padStart(2, "0")}`,
    daysInMonth: lastDay,
  };
};

const enumerateIsoDateRange = (startDate = "", endDate = "") => {
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
};

// Batch 5D-1：Daily expected-report authority。
// 月度 cohort 先由 Lifecycle first/last/exempt 決定，再套用真實 openDate / closeDate 日界線。
// 不使用 report activity 推導營運日期；店休日也不在此 resolver 形成豁免。
export const isLifecycleEntryExpectedForDate = (entry = {}, dateText = "", options = {}) => {
  const date = normalizeIsoDate(dateText);
  if (!date) return false;
  const yearMonth = date.slice(0, 7);
  if (!isLifecycleEntryEligibleForMonth(entry, yearMonth)) return false;

  const openDate = normalizeIsoDate(entry.openDate);
  const closeDate = normalizeIsoDate(entry.closeDate);
  if (!openDate || date < openDate) return false;
  if (closeDate && date > closeDate) return false;

  const closedDateSet = getReportingClosedDateSet(
    options.closedDates || entry.reportingCalendarClosedDates || []
  );
  if (closedDateSet.has(date)) return false;
  return true;
};

export const isLifecycleEntryFullEligibleMonth = (entry = {}, yearMonth = "") => {
  const bounds = getLifecycleMonthBounds(yearMonth);
  if (!bounds || !isLifecycleEntryEligibleForMonth(entry, yearMonth)) return false;
  const openDate = normalizeIsoDate(entry.openDate);
  const closeDate = normalizeIsoDate(entry.closeDate);
  return Boolean(openDate && openDate <= bounds.start && (!closeDate || closeDate >= bounds.end));
};

export const getLifecycleExpectedReportDates = (entry = {}, yearMonth = "", options = {}) => {
  const bounds = getLifecycleMonthBounds(yearMonth);
  if (!bounds || !isLifecycleEntryEligibleForMonth(entry, yearMonth)) return [];

  const openDate = normalizeIsoDate(entry.openDate);
  const closeDate = normalizeIsoDate(entry.closeDate);
  if (!openDate) return [];

  const cutoffDate = options.cutoffDate == null || options.cutoffDate === ""
    ? bounds.end
    : normalizeIsoDate(options.cutoffDate);
  if (!cutoffDate) return [];

  const start = [bounds.start, openDate].sort().at(-1);
  const endCandidates = [bounds.end, cutoffDate, ...(closeDate ? [closeDate] : [])].sort();
  const end = endCandidates[0];
  const closedDateSet = getReportingClosedDateSet(
    options.closedDates || entry.reportingCalendarClosedDates || []
  );
  return enumerateIsoDateRange(start, end).filter((date) => !closedDateSet.has(date));
};

const defaultReportStoreName = (row = {}) => row.storeName || row.store || row.storeId || row.storeKey || "";
const defaultReportDate = (row = {}) => row.date || row.reportDate || row.sourceDate || "";

export const buildLifecycleReportingCompleteness = ({
  master = {},
  yearMonth = "",
  reports = [],
  brandId = "cyj",
  cutoffDate = "",
  requireReady = true,
  includeMissingDates = true,
  getReportStoreName = defaultReportStoreName,
  getReportDate = defaultReportDate,
} = {}) => {
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  const normalizedBrandId = normalizeLifecycleBrandId(master?.brandId || brandId);
  const lifecycleReady = String(master?.datasetStatus || "") === "READY";
  const reportingCalendar = normalizeReportingCalendar(master?.reportingCalendar || {});
  const reportingCalendarRevision = Math.max(
    0,
    Number(reportingCalendar.monthRevisions?.[normalizedYearMonth] || 0)
  );
  const reportingBounds = getLifecycleMonthBounds(normalizedYearMonth);
  const normalizedCutoffDate = normalizeIsoDate(cutoffDate) || reportingBounds?.end || "";
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
    reportingStatus: lifecycleReady ? "DATA_COMPLETE" : "LIFECYCLE_NOT_READY",
    stores: {},
  };
  if (!normalizedYearMonth) return { ...empty, reportingStatus: "INVALID_PERIOD" };
  if (requireReady && !lifecycleReady) return empty;

  const normalizedMaster = normalizeLifecycleMaster(master, normalizedBrandId);
  const eligibleEntries = getLifecycleEligibleStoreEntries(normalizedMaster, normalizedYearMonth, {
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
    const reportingStatus = missingDates.length === 0 ? "DATA_COMPLETE" : "DATA_INCOMPLETE";

    expectedStoreDayCount += expectedDates.length;
    submittedStoreDayCount += submittedExpectedDates.length;
    missingStoreDayCount += missingDates.length;
    if (reportingStatus === "DATA_COMPLETE") completeStoreCount += 1;
    else incompleteStoreCount += 1;

    stores[storeKey] = {
      storeKey,
      canonicalStoreName: entry.canonicalStoreName || getCanonicalLifecycleStoreName(storeKey, normalizedBrandId),
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
    cutoffDate: normalizeIsoDate(cutoffDate) || getLifecycleMonthBounds(normalizedYearMonth)?.end || "",
    eligibleStoreCount: eligibleEntries.length,
    completeStoreCount,
    incompleteStoreCount,
    expectedStoreDayCount,
    submittedStoreDayCount,
    missingStoreDayCount,
    reportingStatus: missingStoreDayCount === 0 ? "DATA_COMPLETE" : "DATA_INCOMPLETE",
    stores,
  };
};

export const normalizeLifecycleEntry = (raw = {}, fallbackStoreName = "", brandId = "cyj") => {
  const canonicalStoreName = getCanonicalLifecycleStoreName(
    raw.canonicalStoreName || raw.storeName || fallbackStoreName,
    brandId
  );
  const coreStoreName = normalizeStoreLifecycleCore(
    raw.coreStoreName || raw.storeKey || canonicalStoreName || fallbackStoreName
  );

  const normalized = {
    ...raw,
    storeKey: coreStoreName,
    coreStoreName,
    canonicalStoreName,
    firstEligibleMonth: normalizeYearMonth(raw.firstEligibleMonth),
    lastEligibleMonth: normalizeYearMonth(raw.lastEligibleMonth),
    openDate: normalizeIsoDate(raw.openDate),
    closeDate: normalizeIsoDate(raw.closeDate),
    exemptMonths: normalizeExemptMonths(raw.exemptMonths),
    revision: Math.max(0, Number(raw.revision || 0)),
  };

  return {
    ...normalized,
    // entryStatus 是衍生狀態，不把舊版持久化狀態當權威。
    // 當 Lifecycle business rule 升級時，載入後應依目前欄位重新計算，避免舊 INVALID/COMPLETE 卡住 UI。
    entryStatus: getLifecycleEntryCompleteness(normalized),
  };
};

export const normalizeLifecycleMaster = (raw = {}, brandId = "cyj") => {
  const normalizedBrandId = normalizeLifecycleBrandId(brandId || raw.brandId);
  const rawStores = raw?.stores && typeof raw.stores === "object" && !Array.isArray(raw.stores)
    ? raw.stores
    : {};
  const stores = {};

  Object.entries(rawStores).forEach(([key, value]) => {
    const entry = normalizeLifecycleEntry(value || {}, key, normalizedBrandId);
    if (entry.storeKey) stores[entry.storeKey] = entry;
  });

  return {
    schemaVersion: String(raw.schemaVersion || STORE_LIFECYCLE_SCHEMA_VERSION),
    brandId: normalizedBrandId,
    datasetStatus: STORE_LIFECYCLE_DATASET_STATUSES.includes(String(raw.datasetStatus || ""))
      ? String(raw.datasetStatus)
      : "BUILDING",
    revision: Math.max(0, Number(raw.revision || 0)),
    reportingCalendar: normalizeReportingCalendar(raw.reportingCalendar || {}),
    stores,
    certifiedAtText: String(raw.certifiedAtText || ""),
    certifiedBy: String(raw.certifiedBy || ""),
    updatedAtText: String(raw.updatedAtText || ""),
    updatedBy: String(raw.updatedBy || ""),
  };
};
