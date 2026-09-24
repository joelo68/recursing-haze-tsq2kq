const PRODUCTION_OBSERVABILITY_SCHEMA_VERSION = "production-observability-v1";
const PRODUCTION_OBSERVABILITY_BRANDS = Object.freeze(["cyj", "anniu", "yibo"]);
const PRODUCTION_OBSERVABILITY_DIRECTOR_LEVELS = Object.freeze(["super_admin", "operation_admin"]);
const SUMMARY_ISSUE_STATUSES = Object.freeze(["dirty", "pending", "mismatch"]);
const SUMMARY_ISSUE_LIMIT = 10;
const MAINTENANCE_LIMIT = 5;
const MAX_DOCUMENT_READ_BUDGET = 21;

const normalizeText = (value = "", max = 240) => String(value ?? "").trim().slice(0, max);

function normalizeProductionBrandId(value = "") {
  const brandId = normalizeText(value, 24).toLowerCase();
  if (!PRODUCTION_OBSERVABILITY_BRANDS.includes(brandId)) {
    const error = new Error("unsupported_brand");
    error.code = "unsupported_brand";
    error.status = 400;
    throw error;
  }
  return brandId;
}

function getTaipeiDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: String(byType.year || ""),
    month: String(byType.month || "").padStart(2, "0"),
    day: String(byType.day || "").padStart(2, "0"),
  };
}

function getTaipeiDateString(now = new Date()) {
  const parts = getTaipeiDateParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getTaipeiYearMonth(now = new Date()) {
  const parts = getTaipeiDateParts(now);
  return `${parts.year}-${parts.month}`;
}

function getPreviousYearMonth(yearMonth = "") {
  const match = String(yearMonth || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getPreviousTaipeiDateString(now = new Date()) {
  const current = getTaipeiDateParts(now);
  const utc = new Date(Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day)));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

function normalizeSnapshotSource(source = null) {
  if (!source || typeof source !== "object") return { exists: false, data: {} };
  return {
    exists: source.exists === true,
    data: source.data && typeof source.data === "object" ? source.data : {},
  };
}

function normalizeMaintenanceRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).slice(0, MAINTENANCE_LIMIT).map((row) => {
    const data = row?.data && typeof row.data === "object" ? row.data : row || {};
    const rawStatus = normalizeText(data.status || data.lastRunStatus || "", 40).toLowerCase();
    const failed = ["failed", "error"].includes(rawStatus) || Boolean(data.errorMessage || data.lastError);
    return {
      id: normalizeText(row?.id || data.id || "", 180),
      type: normalizeText(data.type || "maintenance", 80),
      action: normalizeText(data.action || "", 120),
      month: normalizeText(data.month || data.yearMonth || "", 16),
      status: rawStatus || (failed ? "failed" : "ok"),
      failed,
      createdAtText: normalizeText(data.createdAtText || data.updatedAtText || "", 80),
    };
  });
}

function buildProductionHealthSnapshotFromSources({
  brandId = "",
  brandLabel = "",
  generatedAtText = "",
  currentYearMonth = "",
  previousYearMonth = "",
  previousFlag = null,
  previousSummary = null,
  summaryIssues = [],
  securitySummary = null,
  todayStats = null,
  yesterdayStats = null,
  readTrackerConfig = null,
  maintenanceRows = [],
  sourceErrors = [],
  observedDocumentResults = 0,
} = {}) {
  const normalizedBrandId = normalizeProductionBrandId(brandId);
  const flag = normalizeSnapshotSource(previousFlag);
  const summary = normalizeSnapshotSource(previousSummary);
  const security = normalizeSnapshotSource(securitySummary);
  const today = normalizeSnapshotSource(todayStats);
  const yesterday = normalizeSnapshotSource(yesterdayStats);
  const tracker = normalizeSnapshotSource(readTrackerConfig);
  const issues = (Array.isArray(summaryIssues) ? summaryIssues : []).slice(0, SUMMARY_ISSUE_LIMIT).map((row) => {
    const data = row?.data && typeof row.data === "object" ? row.data : row || {};
    return {
      yearMonth: normalizeText(row?.id || data.yearMonth || data.affectedYearMonth || "", 16),
      status: normalizeText(data.status || "unknown", 40).toLowerCase(),
      pendingCount: Math.max(0, Number(data.pendingCount || 0)),
      updatedAtText: normalizeText(data.updatedAtText || data.lastDirtyAtText || data.lastCompletedAtText || "", 80),
    };
  });
  const maintenance = normalizeMaintenanceRows(maintenanceRows);
  const errors = [...new Set((Array.isArray(sourceErrors) ? sourceErrors : []).map((value) => normalizeText(value, 80)).filter(Boolean))];

  const flagData = flag.data || {};
  const summaryData = summary.data || {};
  const previousVerified = (
    flag.exists
    && summary.exists
    && String(flagData.status || "").toLowerCase() === "verified"
    && flagData.dirty !== true
    && Number(flagData.lastMismatchCount || 0) === 0
    && String(summaryData.version || "") === "dashboard-summary-v2"
  );

  const summaryNeedsAttention = !previousVerified || issues.length > 0;
  const maintenanceFailures = maintenance.filter((row) => row.failed);
  const pendingDeviceCount = Math.max(
    0,
    Number(security.data?.pendingCount ?? security.data?.pendingNewDeviceCount ?? 0)
  );
  const adminAssistancePendingCount = Math.max(
    0,
    Number(security.data?.adminAssistancePendingCount || 0)
  );

  const trackerData = tracker.data || {};
  const trackerMode = ["off", "local", "global"].includes(String(trackerData.mode || ""))
    ? String(trackerData.mode)
    : "off";
  const scheduleEnabled = trackerData.scheduleEnabled === true;

  const overallStatus = errors.length > 0
    ? "error"
    : (summaryNeedsAttention || maintenanceFailures.length > 0 ? "attention" : "healthy");
  const overallLabel = overallStatus === "healthy"
    ? "整體運作正常"
    : overallStatus === "error"
      ? "部分狀態暫時無法確認"
      : "有項目需要留意";
  const overallDetail = overallStatus === "healthy"
    ? "目前沒有發現需要立即處理的系統狀態。"
    : overallStatus === "error"
      ? "部分健康資料讀取未完成，請稍後重新檢查。"
      : "請查看下方標示需要留意的項目。";

  return {
    schemaVersion: PRODUCTION_OBSERVABILITY_SCHEMA_VERSION,
    brandId: normalizedBrandId,
    brandLabel: normalizeText(brandLabel || normalizedBrandId, 40),
    generatedAtText: normalizeText(generatedAtText || new Date().toISOString(), 80),
    currentYearMonth: normalizeText(currentYearMonth, 16),
    previousYearMonth: normalizeText(previousYearMonth, 16),
    overall: {
      status: overallStatus,
      label: overallLabel,
      detail: overallDetail,
    },
    summary: {
      status: errors.some((item) => item.startsWith("summary")) ? "error" : (summaryNeedsAttention ? "attention" : "healthy"),
      previousYearMonth: normalizeText(previousYearMonth, 16),
      previousVerified,
      previousFlagExists: flag.exists,
      previousSummaryExists: summary.exists,
      previousFlagStatus: normalizeText(flagData.status || (flag.exists ? "unknown" : "missing"), 40),
      previousSummaryVersion: normalizeText(summaryData.version || "", 80),
      unresolvedCount: issues.length,
      unresolvedMonths: issues,
      updatedAtText: normalizeText(
        flagData.updatedAtText || flagData.lastCompletedAtText || summaryData.lastUpdatedAtText || "",
        80
      ),
    },
    security: {
      status: errors.includes("securitySummary") ? "error" : (pendingDeviceCount > 0 ? "attention" : "healthy"),
      pendingCount: pendingDeviceCount,
      adminAssistancePendingCount,
      updatedAtText: normalizeText(security.data?.updatedAtText || "", 80),
    },
    usage: {
      status: errors.some((item) => item === "todayStats" || item === "yesterdayStats") ? "error" : "healthy",
      todayLoginCount: Math.max(0, Number(today.data?.count || 0)),
      yesterdayLoginCount: Math.max(0, Number(yesterday.data?.count || 0)),
    },
    readTracking: {
      status: errors.includes("readTrackerConfig") ? "error" : "healthy",
      mode: trackerMode,
      scheduleEnabled,
      scheduleMode: normalizeText(trackerData.scheduleMode || "", 40),
      startTime: normalizeText(trackerData.startTime || "", 12),
      endTime: normalizeText(trackerData.endTime || "", 12),
    },
    maintenance: {
      status: errors.includes("maintenance") ? "error" : (maintenanceFailures.length > 0 ? "attention" : "healthy"),
      recentCount: maintenance.length,
      failureCount: maintenanceFailures.length,
      latestAtText: normalizeText(maintenance[0]?.createdAtText || "", 80),
      rows: maintenance,
    },
    diagnostics: {
      sourceErrors: errors,
      observedDocumentResults: Math.max(0, Number(observedDocumentResults || 0)),
      maxDocumentReadBudget: MAX_DOCUMENT_READ_BUDGET,
      listenerCountAdded: 0,
      pollingAdded: 0,
    },
  };
}

function assertProductionObservabilityClaims(requestAuth = {}, brandId = "", applicationIdentityVersion = "") {
  const decoded = requestAuth?.decoded || {};
  const valid = (
    requestAuth?.ok === true
    && decoded?.drcyjIdentity === true
    && String(decoded.identityVersion || "") === String(applicationIdentityVersion || "")
    && String(decoded.brandId || "").trim().toLowerCase() === String(brandId || "").trim().toLowerCase()
    && String(decoded.roleId || "").trim().toLowerCase() === "director"
    && PRODUCTION_OBSERVABILITY_DIRECTOR_LEVELS.includes(
      String(decoded.directorLevel || "").trim().toLowerCase()
    )
    && String(decoded.accountId || "").trim()
  );
  if (!valid) {
    const error = new Error("production_observability_identity_mismatch");
    error.code = "production_observability_identity_mismatch";
    error.status = 403;
    throw error;
  }
  return {
    accountId: String(decoded.accountId || "").trim(),
    directorLevel: String(decoded.directorLevel || "").trim().toLowerCase(),
  };
}

function snapshotFromDoc(snap) {
  return {
    exists: Boolean(snap?.exists),
    data: snap?.exists ? (snap.data?.() || {}) : {},
  };
}

function rowsFromQuery(snapshot) {
  return Array.isArray(snapshot?.docs)
    ? snapshot.docs.map((doc) => ({ id: String(doc.id || ""), data: doc.data?.() || {} }))
    : [];
}

async function settleRead(label, reader) {
  try {
    return { label, ok: true, value: await reader() };
  } catch (error) {
    console.error(`production observability read failed: ${label}`, error?.message || error);
    return { label, ok: false, error };
  }
}

async function readProductionHealthSources({
  db,
  brandId,
  getBrandCollection,
  getBrandSettingDoc,
  now = new Date(),
} = {}) {
  const currentYearMonth = getTaipeiYearMonth(now);
  const previousYearMonth = getPreviousYearMonth(currentYearMonth);
  const todayDate = getTaipeiDateString(now);
  const yesterdayDate = getPreviousTaipeiDateString(now);

  const flagCollection = getBrandCollection(db, brandId, "summary_recalc_flags");
  const summaryCollection = getBrandCollection(db, brandId, "dashboard_summary");
  const securityCollection = getBrandCollection(db, brandId, "security_summary");
  const statsCollection = getBrandCollection(db, brandId, "system_stats");
  const maintenanceCollection = getBrandCollection(db, brandId, "maintenance_logs");

  const reads = await Promise.all([
    settleRead("summaryPreviousFlag", () => flagCollection.doc(previousYearMonth).get()),
    settleRead("summaryPreviousDocument", () => summaryCollection.doc(previousYearMonth).get()),
    settleRead("summaryIssues", () => flagCollection.where("status", "in", [...SUMMARY_ISSUE_STATUSES]).limit(SUMMARY_ISSUE_LIMIT).get()),
    settleRead("securitySummary", () => securityCollection.doc("device_approvals").get()),
    settleRead("todayStats", () => statsCollection.doc(todayDate).get()),
    settleRead("yesterdayStats", () => statsCollection.doc(yesterdayDate).get()),
    settleRead("readTrackerConfig", () => getBrandSettingDoc(db, brandId, "read_tracker_config").get()),
    settleRead("maintenance", () => maintenanceCollection.orderBy("createdAt", "desc").limit(MAINTENANCE_LIMIT).get()),
  ]);

  const byLabel = Object.fromEntries(reads.map((item) => [item.label, item]));
  const sourceErrors = reads.filter((item) => !item.ok).map((item) => item.label);

  const previousFlag = byLabel.summaryPreviousFlag?.ok
    ? snapshotFromDoc(byLabel.summaryPreviousFlag.value)
    : { exists: false, data: {} };
  const previousSummary = byLabel.summaryPreviousDocument?.ok
    ? snapshotFromDoc(byLabel.summaryPreviousDocument.value)
    : { exists: false, data: {} };
  const securitySummary = byLabel.securitySummary?.ok
    ? snapshotFromDoc(byLabel.securitySummary.value)
    : { exists: false, data: {} };
  const todayStats = byLabel.todayStats?.ok
    ? snapshotFromDoc(byLabel.todayStats.value)
    : { exists: false, data: {} };
  const yesterdayStats = byLabel.yesterdayStats?.ok
    ? snapshotFromDoc(byLabel.yesterdayStats.value)
    : { exists: false, data: {} };
  const readTrackerConfig = byLabel.readTrackerConfig?.ok
    ? snapshotFromDoc(byLabel.readTrackerConfig.value)
    : { exists: false, data: {} };
  const summaryIssues = byLabel.summaryIssues?.ok
    ? rowsFromQuery(byLabel.summaryIssues.value)
    : [];
  const maintenanceRows = byLabel.maintenance?.ok
    ? rowsFromQuery(byLabel.maintenance.value)
    : [];

  const pointResults = [
    previousFlag,
    previousSummary,
    securitySummary,
    todayStats,
    yesterdayStats,
    readTrackerConfig,
  ].filter((item) => item.exists).length;

  return {
    currentYearMonth,
    previousYearMonth,
    previousFlag,
    previousSummary,
    summaryIssues,
    securitySummary,
    todayStats,
    yesterdayStats,
    readTrackerConfig,
    maintenanceRows,
    sourceErrors,
    observedDocumentResults: pointResults + summaryIssues.length + maintenanceRows.length,
  };
}

function createProductionObservabilityFunctions({
  onRequest,
  db,
  normalizeBrandId,
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  applicationIdentityVersion,
} = {}) {
  if (typeof onRequest !== "function") throw new Error("missing_onRequest");
  if (!db) throw new Error("missing_db");
  if (typeof normalizeBrandId !== "function") throw new Error("missing_normalizeBrandId");
  if (typeof getBrandCollection !== "function") throw new Error("missing_getBrandCollection");
  if (typeof getBrandSettingDoc !== "function") throw new Error("missing_getBrandSettingDoc");
  if (typeof requireFirebaseRequestAuth !== "function") throw new Error("missing_requireFirebaseRequestAuth");
  if (!applicationIdentityVersion) throw new Error("missing_application_identity_version");

  const getProductionHealthSnapshot = onRequest({
    cors: true,
    timeoutSeconds: 20,
    memory: "256MiB",
  }, async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, code: "method_not_allowed" });
    }
    res.set?.("Cache-Control", "private, no-store");

    const requestAuth = await requireFirebaseRequestAuth(req);
    if (!requestAuth?.ok) {
      return res.status(401).json({ ok: false, code: "firebase_auth_required", message: "登入狀態已失效，請重新登入。" });
    }

    try {
      const strictBrandId = normalizeProductionBrandId(req.body?.brandId);
      const brandId = normalizeBrandId(strictBrandId);
      if (brandId !== strictBrandId) throw new Error("brand_resolver_mismatch");

      assertProductionObservabilityClaims(requestAuth, brandId, applicationIdentityVersion);

      const generatedAtText = new Date().toISOString();
      const sources = await readProductionHealthSources({
        db,
        brandId,
        getBrandCollection,
        getBrandSettingDoc,
      });

      const snapshot = buildProductionHealthSnapshotFromSources({
        brandId,
        brandLabel: ({ cyj: "CYJ", anniu: "安妞", yibo: "伊啵" })[brandId] || brandId,
        generatedAtText,
        ...sources,
      });

      return res.status(200).json({
        ok: true,
        snapshot,
      });
    } catch (error) {
      const status = Number(error?.status || 500);
      const code = String(error?.code || error?.message || "production_observability_failed");
      if (status >= 500) console.error("getProductionHealthSnapshot failed", error);
      return res.status(status).json({
        ok: false,
        code,
        message: status === 403
          ? "目前帳號沒有查看系統狀態的權限。"
          : status === 400
            ? "品牌資料不正確，請重新整理後再試。"
            : "系統狀態暫時無法取得，請稍後再試。",
      });
    }
  });

  return { getProductionHealthSnapshot };
}

module.exports = {
  PRODUCTION_OBSERVABILITY_SCHEMA_VERSION,
  PRODUCTION_OBSERVABILITY_BRANDS,
  PRODUCTION_OBSERVABILITY_DIRECTOR_LEVELS,
  SUMMARY_ISSUE_STATUSES,
  SUMMARY_ISSUE_LIMIT,
  MAINTENANCE_LIMIT,
  MAX_DOCUMENT_READ_BUDGET,
  normalizeProductionBrandId,
  getTaipeiDateString,
  getTaipeiYearMonth,
  getPreviousYearMonth,
  getPreviousTaipeiDateString,
  normalizeMaintenanceRows,
  buildProductionHealthSnapshotFromSources,
  assertProductionObservabilityClaims,
  readProductionHealthSources,
  createProductionObservabilityFunctions,
};
