const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const {
  KPI_CONTRACT_VERSION,
  KPI_VALUE_STATUS,
  formalNetCash,
  formalAccrual,
} = require("./kpiContracts");
const {
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
} = require("./deviceApproval");
const {
  normalizeStoreLifecycleCore,
  getCanonicalStoreName,
  getLifecycleEligibleStoreEntries,
  isLifecycleEntryExpectedForDate,
  normalizeReportingCalendar,
} = require("./storeLifecycle");
const {
  normalizeStoredSystemExclusionProfile,
  buildStoredSystemExclusionSnapshot,
} = require("./systemExclusionContract");

const PROJECTION_MODEL_SCHEMA_VERSION = "projection-model-v1";
const PROJECTION_SEMANTIC_VERSION = "projection-semantic-v1";
const PROJECTION_SOURCE_MONTH_COUNT = 3;
const PROJECTION_MIN_WEEKDAY_SAMPLES = 3;
const PROJECTION_MODEL_DOC_ID = "current";
const PROJECTION_MODEL_COLLECTION = "projection_models";
const PROJECTION_BRANDS = Object.freeze(["cyj", "anniu", "yibo"]);

function normalizeProjectionBrandId(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (["cyj", "drcyj", "default", "default-app-id"].includes(text)) return "cyj";
  if (["anniu", "anew", "安妞"].includes(text)) return "anniu";
  if (["yibo", "伊啵"].includes(text)) return "yibo";
  return "";
}

function normalizeYearMonth(value = "") {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
}

function normalizeIsoDate(value = "") {
  const text = String(value || "").trim().replace(/\//g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return "";
  return text;
}

function getTaipeiYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  return normalizeYearMonth(`${year}-${month}`);
}

function shiftYearMonth(yearMonth = "", deltaMonths = 0) {
  const normalized = normalizeYearMonth(yearMonth);
  if (!normalized) return "";
  const [year, month] = normalized.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + Number(deltaMonths || 0), 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getProjectionSourceMonths(modelMonth = "") {
  const normalized = normalizeYearMonth(modelMonth);
  if (!normalized) return [];
  return Array.from({ length: PROJECTION_SOURCE_MONTH_COUNT }, (_, index) =>
    shiftYearMonth(normalized, -(PROJECTION_SOURCE_MONTH_COUNT - index))
  );
}

function getMonthLastDate(yearMonth = "") {
  const normalized = normalizeYearMonth(yearMonth);
  if (!normalized) return "";
  const [year, month] = normalized.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${normalized}-${String(lastDay).padStart(2, "0")}`;
}

function getProjectionSourceRange(sourceMonths = []) {
  const months = (Array.isArray(sourceMonths) ? sourceMonths : [])
    .map(normalizeYearMonth)
    .filter(Boolean)
    .sort();
  if (!months.length) return { startDate: "", endDate: "" };
  return {
    startDate: `${months[0]}-01`,
    endDate: getMonthLastDate(months.at(-1)),
  };
}

function median(values = []) {
  const numbers = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!numbers.length) return null;
  const mid = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2;
}

function isValidKpiResult(result = {}) {
  return result?.status === KPI_VALUE_STATUS.VALID || result?.status === KPI_VALUE_STATUS.VALID_ZERO;
}

function buildWeekdayBucket() {
  return Object.fromEntries(Array.from({ length: 7 }, (_, dow) => [dow, []]));
}

function buildWeekdayCurve(samplesByWeekday = {}) {
  return Object.fromEntries(
    Array.from({ length: 7 }, (_, dow) => {
      const values = Array.isArray(samplesByWeekday?.[dow]) ? samplesByWeekday[dow] : [];
      const sampleCount = values.length;
      const reliable = sampleCount >= PROJECTION_MIN_WEEKDAY_SAMPLES;
      const baseline = reliable ? median(values) : null;
      return [dow, {
        sampleCount,
        reliable,
        baseline,
        valueStatus: baseline === null
          ? (sampleCount > 0 ? "INSUFFICIENT_SAMPLE" : "NO_SAMPLE")
          : (baseline === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID),
      }];
    })
  );
}

function getReportStoreName(row = {}) {
  return row?.storeName || row?.store || row?.storeId || row?.storeKey || "";
}

function getReportDate(row = {}) {
  return normalizeIsoDate(row?.date || row?.reportDate || row?.sourceDate || "");
}

function getUtcWeekday(dateText = "") {
  const date = normalizeIsoDate(dateText);
  if (!date) return null;
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function buildFormalProjectionMetrics(brandId = "", row = {}) {
  const grossCash = Object.prototype.hasOwnProperty.call(row, "grossCash") ? row.grossCash : row.cash;
  // Preserve the current Formal raw compatibility contract: a missing legacy refund field is 0.
  // skincareRefund intentionally does not silently default so missing current-contract data fails closed.
  const refund = Object.prototype.hasOwnProperty.call(row, "refund") ? row.refund : 0;
  const cash = formalNetCash(grossCash, refund, row.skincareRefund);
  const accrual = formalAccrual(brandId, row.accrual, row.operationalAccrual);
  return { cash, accrual };
}

function buildProjectionAuthoritySnapshot({
  brandId,
  lifecycleMaster = {},
  systemExclusionData = {},
  sourceMonths = [],
} = {}) {
  const normalizedBrandId = normalizeProjectionBrandId(brandId);
  if (!normalizedBrandId) {
    const error = new Error("invalid_projection_brand");
    error.code = "INVALID_PROJECTION_BRAND";
    throw error;
  }
  const calendar = normalizeReportingCalendar(lifecycleMaster?.reportingCalendar || {});
  const exclusionProfile = normalizeStoredSystemExclusionProfile(
    systemExclusionData || {}, normalizedBrandId, normalizeStoreLifecycleCore
  );
  const months = (Array.isArray(sourceMonths) ? sourceMonths : []).map(normalizeYearMonth).filter(Boolean);
  return {
    lifecycleRevision: Math.max(0, Number(lifecycleMaster?.revision || 0)),
    lifecycleDatasetStatus: String(lifecycleMaster?.datasetStatus || ""),
    reportingCalendarSchemaVersion: String(calendar?.schemaVersion || ""),
    reportingCalendarMasterRevision: Math.max(0, Number(calendar?.revision || 0)),
    reportingCalendarMonthRevisions: Object.fromEntries(
      months.map((yearMonth) => [
        yearMonth,
        Math.max(0, Number(calendar?.monthRevisions?.[yearMonth] || 0)),
      ])
    ),
    systemExclusionSnapshot: buildStoredSystemExclusionSnapshot(
      exclusionProfile, normalizedBrandId, normalizeStoreLifecycleCore
    ),
  };
}

function authoritySnapshotsEqual(left = {}, right = {}) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildHistoricalProjectionModel({
  brandId,
  modelMonth,
  sourceMonths,
  rawRows = [],
  lifecycleMaster = {},
  systemExclusionData = {},
  generatedAtText = "",
  trigger = "scheduled",
} = {}) {
  const normalizedBrandId = normalizeProjectionBrandId(brandId);
  const normalizedModelMonth = normalizeYearMonth(modelMonth);
  const months = (Array.isArray(sourceMonths) && sourceMonths.length
    ? sourceMonths
    : getProjectionSourceMonths(normalizedModelMonth))
    .map(normalizeYearMonth)
    .filter(Boolean);

  if (!normalizedBrandId || !normalizedModelMonth || months.length !== PROJECTION_SOURCE_MONTH_COUNT) {
    const error = new Error("invalid_projection_model_scope");
    error.code = "INVALID_PROJECTION_SCOPE";
    throw error;
  }
  if (String(lifecycleMaster?.datasetStatus || "") !== "READY") {
    const error = new Error("projection_lifecycle_not_ready");
    error.code = "PROJECTION_LIFECYCLE_NOT_READY";
    throw error;
  }

  const authority = buildProjectionAuthoritySnapshot({
    brandId: normalizedBrandId,
    lifecycleMaster,
    systemExclusionData,
    sourceMonths: months,
  });
  const exclusionProfile = normalizeStoredSystemExclusionProfile(
    systemExclusionData || {}, normalizedBrandId, normalizeStoreLifecycleCore
  );
  const excludedStoreSet = exclusionProfile.storeSet;

  const eligibleByMonth = new Map();
  const unionStoreEntries = new Map();
  const lifecycleEligibleStoreKeysByMonth = {};

  for (const yearMonth of months) {
    const entries = getLifecycleEligibleStoreEntries(lifecycleMaster, yearMonth, {
      brandId: normalizedBrandId,
      requireReady: true,
    }).filter((entry) => !excludedStoreSet.has(
      normalizeStoreLifecycleCore(entry?.storeKey || entry?.coreStoreName || entry?.canonicalStoreName || "")
    ));

    const byStore = new Map();
    for (const entry of entries) {
      const storeKey = normalizeStoreLifecycleCore(
        entry?.storeKey || entry?.coreStoreName || entry?.canonicalStoreName || ""
      );
      if (!storeKey) continue;
      byStore.set(storeKey, entry);
      unionStoreEntries.set(storeKey, entry);
    }
    eligibleByMonth.set(yearMonth, byStore);
    lifecycleEligibleStoreKeysByMonth[yearMonth] = [...byStore.keys()]
      .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }

  const groupedRows = new Map();
  const counters = {
    rawDocumentCount: Array.isArray(rawRows) ? rawRows.length : 0,
    outsideSourceRangeCount: 0,
    invalidIdentityOrDateCount: 0,
    noLifecycleEligibilityCount: 0,
    nonOperatingDateCount: 0,
    duplicateStoreDateCount: 0,
    eligibleUniqueStoreDateCount: 0,
    validCashSampleCount: 0,
    validAccrualSampleCount: 0,
    invalidCashSampleCount: 0,
    invalidAccrualSampleCount: 0,
  };

  const monthSet = new Set(months);
  for (const row of Array.isArray(rawRows) ? rawRows : []) {
    const reportDate = getReportDate(row);
    const storeKey = normalizeStoreLifecycleCore(getReportStoreName(row));
    if (!storeKey || !reportDate) {
      counters.invalidIdentityOrDateCount += 1;
      continue;
    }
    const yearMonth = reportDate.slice(0, 7);
    if (!monthSet.has(yearMonth)) {
      counters.outsideSourceRangeCount += 1;
      continue;
    }
    const entry = eligibleByMonth.get(yearMonth)?.get(storeKey);
    if (!entry) {
      counters.noLifecycleEligibilityCount += 1;
      continue;
    }
    if (!isLifecycleEntryExpectedForDate(entry, reportDate)) {
      counters.nonOperatingDateCount += 1;
      continue;
    }
    const key = `${storeKey}|${reportDate}`;
    if (!groupedRows.has(key)) groupedRows.set(key, { storeKey, reportDate, entry, rows: [] });
    groupedRows.get(key).rows.push(row);
  }

  const brandSamples = { cash: buildWeekdayBucket(), accrual: buildWeekdayBucket() };
  const storeSamples = new Map();
  const ensureStoreSamples = (storeKey) => {
    if (!storeSamples.has(storeKey)) {
      storeSamples.set(storeKey, { cash: buildWeekdayBucket(), accrual: buildWeekdayBucket() });
    }
    return storeSamples.get(storeKey);
  };

  for (const group of groupedRows.values()) {
    // One canonical Store × Date is one Projection sample. Duplicate logical day rows are
    // an upstream data-quality conflict; do not add/choose one silently.
    if (group.rows.length !== 1) {
      counters.duplicateStoreDateCount += 1;
      continue;
    }
    counters.eligibleUniqueStoreDateCount += 1;
    const row = group.rows[0];
    const dow = getUtcWeekday(group.reportDate);
    if (dow === null) continue;
    const metrics = buildFormalProjectionMetrics(normalizedBrandId, row);
    const samples = ensureStoreSamples(group.storeKey);

    if (isValidKpiResult(metrics.cash)) {
      samples.cash[dow].push(metrics.cash.value);
      brandSamples.cash[dow].push(metrics.cash.value);
      counters.validCashSampleCount += 1;
    } else {
      counters.invalidCashSampleCount += 1;
    }

    if (isValidKpiResult(metrics.accrual)) {
      samples.accrual[dow].push(metrics.accrual.value);
      brandSamples.accrual[dow].push(metrics.accrual.value);
      counters.validAccrualSampleCount += 1;
    } else {
      counters.invalidAccrualSampleCount += 1;
    }
  }

  const stores = Object.fromEntries(
    [...unionStoreEntries.keys()]
      .sort((a, b) => a.localeCompare(b, "zh-Hant"))
      .map((storeKey) => {
        const entry = unionStoreEntries.get(storeKey) || {};
        const samples = storeSamples.get(storeKey) || {
          cash: buildWeekdayBucket(),
          accrual: buildWeekdayBucket(),
        };
        return [storeKey, {
          storeKey,
          canonicalStoreName: entry?.canonicalStoreName || getCanonicalStoreName(storeKey, normalizedBrandId),
          cashWeekday: buildWeekdayCurve(samples.cash),
          accrualWeekday: buildWeekdayCurve(samples.accrual),
        }];
      })
  );

  return {
    schemaVersion: PROJECTION_MODEL_SCHEMA_VERSION,
    semanticVersion: PROJECTION_SEMANTIC_VERSION,
    kpiContractVersion: KPI_CONTRACT_VERSION,
    brandId: normalizedBrandId,
    modelMonth: normalizedModelMonth,
    sourceMonths: months,
    sourceRange: getProjectionSourceRange(months),
    authority,
    lifecycleEligibleStoreKeysByMonth,
    excludedStoreKeys: [...excludedStoreSet].sort((a, b) => a.localeCompare(b, "zh-Hant")),
    brand: {
      cashWeekday: buildWeekdayCurve(brandSamples.cash),
      accrualWeekday: buildWeekdayCurve(brandSamples.accrual),
    },
    stores,
    sourceStats: counters,
    trigger: String(trigger || "scheduled"),
    generatedAtText: String(generatedAtText || new Date().toISOString()),
  };
}

function createProjectionAuthorityFunctions({ admin, db }) {
  if (!admin || !db) throw new Error("projection_authority_requires_admin_and_db");

  async function rebuildProjectionModelForBrand(brandIdInput, {
    trigger = "scheduled",
    actor = null,
    modelMonth = "",
  } = {}) {
    const brandId = normalizeProjectionBrandId(brandIdInput);
    if (!brandId) {
      const error = new Error("invalid_projection_brand");
      error.code = "INVALID_PROJECTION_BRAND";
      throw error;
    }

    const resolvedModelMonth = normalizeYearMonth(modelMonth) || getTaipeiYearMonth();
    const sourceMonths = getProjectionSourceMonths(resolvedModelMonth);
    if (sourceMonths.length !== PROJECTION_SOURCE_MONTH_COUNT) {
      const error = new Error("invalid_projection_source_months");
      error.code = "INVALID_PROJECTION_SCOPE";
      throw error;
    }
    const sourceRange = getProjectionSourceRange(sourceMonths);

    const lifecycleRef = getBrandCollection(db, brandId, "store_lifecycle").doc("master");
    const systemExclusionRef = getBrandSettingDoc(db, brandId, "audit_exclusions");
    const reportsRef = getBrandCollection(db, brandId, "daily_reports");
    const projectionRef = getBrandCollection(db, brandId, PROJECTION_MODEL_COLLECTION).doc(PROJECTION_MODEL_DOC_ID);

    const [lifecycleSnap, exclusionSnap] = await Promise.all([
      lifecycleRef.get(),
      systemExclusionRef.get(),
    ]);
    const lifecycleMaster = lifecycleSnap.exists ? (lifecycleSnap.data() || {}) : {};
    const systemExclusionData = exclusionSnap.exists ? (exclusionSnap.data() || {}) : {};

    if (String(lifecycleMaster?.datasetStatus || "") !== "READY") {
      const error = new Error("projection_lifecycle_not_ready");
      error.code = "PROJECTION_LIFECYCLE_NOT_READY";
      throw error;
    }

    const initialAuthority = buildProjectionAuthoritySnapshot({
      brandId,
      lifecycleMaster,
      systemExclusionData,
      sourceMonths,
    });

    const reportsSnap = await reportsRef
      .where("date", ">=", sourceRange.startDate)
      .where("date", "<=", sourceRange.endDate)
      .get();

    const rawRows = reportsSnap.docs.map((docSnap) => ({
      ...(docSnap.data() || {}),
      __docId: docSnap.id,
    }));

    const payload = buildHistoricalProjectionModel({
      brandId,
      modelMonth: resolvedModelMonth,
      sourceMonths,
      rawRows,
      lifecycleMaster,
      systemExclusionData,
      generatedAtText: new Date().toISOString(),
      trigger,
    });

    await db.runTransaction(async (transaction) => {
      const [currentLifecycleSnap, currentExclusionSnap] = await Promise.all([
        transaction.get(lifecycleRef),
        transaction.get(systemExclusionRef),
      ]);
      const currentLifecycleMaster = currentLifecycleSnap.exists ? (currentLifecycleSnap.data() || {}) : {};
      const currentSystemExclusionData = currentExclusionSnap.exists ? (currentExclusionSnap.data() || {}) : {};
      const currentAuthority = buildProjectionAuthoritySnapshot({
        brandId,
        lifecycleMaster: currentLifecycleMaster,
        systemExclusionData: currentSystemExclusionData,
        sourceMonths,
      });

      if (!authoritySnapshotsEqual(initialAuthority, currentAuthority)) {
        const error = new Error("projection_authority_changed_during_rebuild");
        error.code = "PROJECTION_AUTHORITY_CHANGED";
        throw error;
      }

      transaction.set(projectionRef, {
        ...payload,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(actor ? {
          generatedBy: String(actor?.name || actor?.actorName || ""),
          generatedByRole: String(actor?.role || actor?.actorRole || ""),
          generatedByAccountId: String(actor?.accountId || actor?.actorAccountId || ""),
        } : {}),
      }, { merge: false });
    });

    return {
      ok: true,
      brandId,
      modelMonth: resolvedModelMonth,
      sourceMonths,
      sourceRange,
      rawDocumentCount: reportsSnap.size,
      storeCount: Object.keys(payload.stores || {}).length,
      sourceStats: payload.sourceStats,
      authority: payload.authority,
      readPlan: {
        initialAuthorityPointReads: 2,
        rawRangeQueryDocumentReads: reportsSnap.size,
        publishRaceGuardPointReads: 2,
        projectionModelWrites: 1,
      },
    };
  }

  const rebuildProjectionModelNow = onRequest({
    cors: true,
    timeoutSeconds: 540,
    memory: "512MiB",
  }, async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, message: "method_not_allowed" });
    }
    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) {
      return res.status(401).json({ ok: false, message: "登入狀態已失效，請重新登入" });
    }

    try {
      const body = req.body || {};
      const brandId = normalizeProjectionBrandId(body.brandId);
      if (!brandId) return res.status(400).json({ ok: false, message: "不支援的品牌" });

      const adminCheck = await verifySuperAdminActor({ db, brandId, actor: body.actor || {} });
      if (!adminCheck.ok) {
        return res.status(403).json({
          ok: false,
          message: "此操作僅限已信任裝置上的最高管理者執行",
        });
      }

      const result = await rebuildProjectionModelForBrand(brandId, {
        trigger: "manual_secure_rebuild",
        actor: {
          name: adminCheck.actorName,
          role: adminCheck.actorRole,
          accountId: adminCheck.actorAccountId,
        },
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error?.code === "PROJECTION_AUTHORITY_CHANGED") {
        return res.status(409).json({
          ok: false,
          reason: error.code,
          message: "營運權限資料在重建期間已更新，本次未發布舊版推估模型，請重新執行",
        });
      }
      if (error?.code === "PROJECTION_LIFECYCLE_NOT_READY") {
        return res.status(409).json({
          ok: false,
          reason: error.code,
          message: "店家生命週期資料尚未完成，為避免錯誤推估，本次未建立模型",
        });
      }
      if (["INVALID_PROJECTION_BRAND", "INVALID_PROJECTION_SCOPE"].includes(error?.code)) {
        return res.status(400).json({ ok: false, reason: error.code, message: "推估模型範圍格式錯誤" });
      }
      console.error("rebuildProjectionModelNow failed", error);
      return res.status(500).json({ ok: false, message: "推估模型重建失敗，請稍後再試" });
    }
  });

  const calculateHistoricalProjectionCurve = onSchedule({
    schedule: "0 3 1 * *",
    timeZone: "Asia/Taipei",
    timeoutSeconds: 540,
    memory: "1GiB",
  }, async () => {
    const modelMonth = getTaipeiYearMonth();
    for (const brandId of PROJECTION_BRANDS) {
      try {
        const result = await rebuildProjectionModelForBrand(brandId, {
          trigger: "monthly_projection_model",
          modelMonth,
        });
        console.log(`✅ Projection Model ${brandId}/${modelMonth} stores=${result.storeCount} rawReads=${result.rawDocumentCount}`);
      } catch (error) {
        console.error(`❌ Projection Model ${brandId}/${modelMonth} failed`, error);
      }
    }
  });

  return {
    rebuildProjectionModelForBrand,
    rebuildProjectionModelNow,
    calculateHistoricalProjectionCurve,
  };
}

module.exports = {
  PROJECTION_MODEL_SCHEMA_VERSION,
  PROJECTION_SEMANTIC_VERSION,
  PROJECTION_SOURCE_MONTH_COUNT,
  PROJECTION_MIN_WEEKDAY_SAMPLES,
  PROJECTION_MODEL_DOC_ID,
  PROJECTION_MODEL_COLLECTION,
  PROJECTION_BRANDS,
  normalizeProjectionBrandId,
  normalizeYearMonth,
  normalizeIsoDate,
  getTaipeiYearMonth,
  shiftYearMonth,
  getProjectionSourceMonths,
  getMonthLastDate,
  getProjectionSourceRange,
  median,
  isValidKpiResult,
  buildWeekdayBucket,
  buildWeekdayCurve,
  getReportStoreName,
  getReportDate,
  getUtcWeekday,
  buildFormalProjectionMetrics,
  buildProjectionAuthoritySnapshot,
  authoritySnapshotsEqual,
  buildHistoricalProjectionModel,
  createProjectionAuthorityFunctions,
};
