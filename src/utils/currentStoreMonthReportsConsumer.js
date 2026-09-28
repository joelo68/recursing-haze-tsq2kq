// src/utils/currentStoreMonthReportsConsumer.js

export const CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION = "current-store-month-reports-v1";
export const CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION = "current-store-month-reports-readiness-v1";
export const CURRENT_STORE_MONTH_REPORTS_PROJECTION_SOURCE = "daily_reports_onwrite_v1";

const normalizeBrandId = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (["cyj", "default", "default-app-id", "drcyj"].includes(raw)) return "cyj";
  if (["anniu", "anew", "安妞"].includes(raw)) return "anniu";
  if (["yibo", "伊啵"].includes(raw)) return "yibo";
  return "";
};

const normalizeYearMonth = (value = "") => {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
};

const normalizeIsoDate = (value = "") => {
  const text = String(value || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(text)) return "";
  const [year, month, day] = text.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) return "";
  return text;
};

const normalizeText = (value = "") => String(value || "").trim();

export const inspectCurrentStoreMonthReportsReadiness = ({
  status = null,
  brandId = "",
  yearMonth = "",
} = {}) => {
  const normalizedBrandId = normalizeBrandId(brandId);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  const data = status && typeof status === "object" && !Array.isArray(status) ? status : null;

  const fail = (reason) => ({
    ready: false,
    reason,
    brandId: normalizedBrandId,
    yearMonth: normalizedYearMonth,
  });

  if (!normalizedBrandId || !normalizedYearMonth) return fail("INVALID_SCOPE");
  if (!data) return fail("STATUS_MISSING");

  const statusBrandId = normalizeBrandId(data.brandId || "");
  if (statusBrandId && statusBrandId !== normalizedBrandId) return fail("STATUS_BRAND_MISMATCH");

  const statusYearMonth = normalizeYearMonth(data.yearMonth || data.id || "");
  if (statusYearMonth && statusYearMonth !== normalizedYearMonth) return fail("STATUS_MONTH_MISMATCH");

  if (normalizeText(data.schemaVersion) !== CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION) {
    return fail("STATUS_SCHEMA_MISMATCH");
  }
  if (normalizeText(data.status) !== "BOOTSTRAP_CERTIFIED") return fail("BOOTSTRAP_NOT_CERTIFIED");
  if (data.consumerReady !== true) return fail("CONSUMER_NOT_READY");
  if (normalizeText(data.readinessStatus) !== "CONSUMER_READY") return fail("READINESS_STATUS_MISMATCH");
  if (normalizeText(data.readinessVersion) !== CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION) {
    return fail("READINESS_VERSION_MISMATCH");
  }

  const sourceSignature = normalizeText(data.consumerReadySourceSignature);
  const projectionSignature = normalizeText(data.consumerReadyProjectionSignature);
  if (!sourceSignature || sourceSignature !== projectionSignature) {
    return fail("READINESS_SIGNATURE_MISMATCH");
  }

  return {
    ready: true,
    reason: "CONSUMER_READY",
    brandId: normalizedBrandId,
    yearMonth: normalizedYearMonth,
    revision: Number.isInteger(Number(data.revision)) ? Number(data.revision) : 0,
    signature: sourceSignature,
  };
};

export const flattenCurrentStoreMonthReports = ({
  documents = [],
  brandId = "",
  yearMonth = "",
} = {}) => {
  const normalizedBrandId = normalizeBrandId(brandId);
  const normalizedYearMonth = normalizeYearMonth(yearMonth);
  const docs = Array.isArray(documents) ? documents : [];

  const fail = (reason, details = {}) => ({
    compatible: false,
    reason,
    reports: [],
    brandId: normalizedBrandId,
    yearMonth: normalizedYearMonth,
    ...details,
  });

  if (!normalizedBrandId || !normalizedYearMonth) return fail("INVALID_SCOPE");
  if (docs.length === 0) return fail("PROJECTION_EMPTY");

  const reports = [];
  const sourceReportIds = new Set();
  const storeKeys = new Set();

  for (const rawDoc of docs) {
    const data = rawDoc && typeof rawDoc === "object" && !Array.isArray(rawDoc)
      ? (rawDoc.data && typeof rawDoc.data === "object" ? rawDoc.data : rawDoc)
      : null;
    if (!data) return fail("PROJECTION_DOCUMENT_INVALID");

    if (normalizeText(data.schemaVersion) !== CURRENT_STORE_MONTH_REPORTS_SCHEMA_VERSION) {
      return fail("PROJECTION_SCHEMA_MISMATCH");
    }
    if (normalizeText(data.projectionSource) !== CURRENT_STORE_MONTH_REPORTS_PROJECTION_SOURCE) {
      return fail("PROJECTION_SOURCE_MISMATCH");
    }
    if (normalizeBrandId(data.brandId) !== normalizedBrandId) return fail("PROJECTION_BRAND_MISMATCH");
    if (normalizeYearMonth(data.yearMonth) !== normalizedYearMonth) return fail("PROJECTION_MONTH_MISMATCH");

    const storeKey = normalizeText(data.storeKey);
    if (!storeKey) return fail("PROJECTION_STORE_KEY_MISSING");
    if (storeKeys.has(storeKey)) return fail("PROJECTION_DUPLICATE_STORE_DOC", { storeKey });
    storeKeys.add(storeKey);

    const sourceEvents = data.sourceEvents && typeof data.sourceEvents === "object" && !Array.isArray(data.sourceEvents)
      ? data.sourceEvents
      : {};
    const sourceEventEntries = Object.values(sourceEvents);
    const expectedEventCount = Number(data.sourceEventCount || 0);
    if (expectedEventCount !== sourceEventEntries.length) {
      return fail("PROJECTION_EVENT_COUNT_MISMATCH", { storeKey });
    }

    const activeEntries = sourceEventEntries.filter((entry) => entry?.exists === true);
    const expectedReportCount = Number(data.sourceReportCount || 0);
    if (expectedReportCount !== activeEntries.length) {
      return fail("PROJECTION_REPORT_COUNT_MISMATCH", { storeKey });
    }

    for (const entry of activeEntries) {
      const row = entry?.row && typeof entry.row === "object" && !Array.isArray(entry.row) ? entry.row : null;
      const sourceReportId = normalizeText(entry?.sourceReportId || row?.sourceReportId);
      const rowReportId = normalizeText(row?.sourceReportId || sourceReportId);
      const date = normalizeIsoDate(row?.date);
      const storeName = normalizeText(row?.storeName);

      if (!row || !sourceReportId || !rowReportId || sourceReportId !== rowReportId) {
        return fail("PROJECTION_REPORT_ID_INVALID", { storeKey });
      }
      if (!date || date.slice(0, 7) !== normalizedYearMonth) {
        return fail("PROJECTION_REPORT_DATE_INVALID", { storeKey, sourceReportId });
      }
      if (!storeName) return fail("PROJECTION_REPORT_STORE_MISSING", { storeKey, sourceReportId });
      if (sourceReportIds.has(sourceReportId)) {
        return fail("PROJECTION_DUPLICATE_REPORT_ID", { sourceReportId });
      }
      sourceReportIds.add(sourceReportId);

      reports.push({
        ...row,
        id: sourceReportId,
        sourceReportId,
        date,
        storeName,
      });
    }
  }

  reports.sort((a, b) => (
    String(b.date || "").localeCompare(String(a.date || "")) ||
    String(b.sourceReportId || "").localeCompare(String(a.sourceReportId || ""))
  ));

  return {
    compatible: true,
    reason: "CURRENT_STORE_MONTH_REPORTS_READY",
    brandId: normalizedBrandId,
    yearMonth: normalizedYearMonth,
    projectionDocCount: docs.length,
    reportCount: reports.length,
    reports,
  };
};
