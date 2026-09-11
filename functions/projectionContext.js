// functions/projectionContext.js
const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const {
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
} = require("./deviceApproval");
const {
  normalizeStoreLifecycleCore,
  getLifecycleEligibleStoreEntries,
  isLifecycleEntryExpectedForDate,
} = require("./storeLifecycle");
const {
  normalizeStoredSystemExclusionProfile,
} = require("./systemExclusionContract");

const PROJECTION_CONTEXT_SCHEMA_VERSION = "projection-context-v2";
const PROJECTION_CONTEXT_COLLECTION = "projection_context";
const PROJECTION_CONTEXT_EVENT_TYPES = Object.freeze([
  "vip",
  "anniversary",
  "seasonal",
  "promotion",
  "launch",
  "other",
]);
const PROJECTION_CONTEXT_LEVELS = Object.freeze(["normal", "notable", "major"]);
const PROJECTION_CONTEXT_METRICS = Object.freeze(["cash", "accrual"]);
const PROJECTION_CONTEXT_MAX_EVENTS = 12;
const PROJECTION_CONTEXT_MAX_STORE_SCHEDULES_PER_EVENT = 80;
const PROJECTION_CONTEXT_MAX_TOTAL_STORE_SCHEDULES = 240;

function normalizeProjectionContextBrandId(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (["cyj", "drcyj", "default", "default-app-id"].includes(text)) return "cyj";
  if (["anniu", "anew", "安妞"].includes(text)) return "anniu";
  if (["yibo", "伊啵"].includes(text)) return "yibo";
  return "";
}

function normalizeProjectionContextYearMonth(value = "") {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
}

function normalizeProjectionContextDate(value = "", yearMonth = "") {
  const text = String(value || "").trim().replace(/\//g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  if (yearMonth && !text.startsWith(`${yearMonth}-`)) return "";
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return "";
  return text;
}

function normalizeProjectionContextEventId(value = "") {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(text) ? text : "";
}

function parseProjectionContextExpectedRevision(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    const error = new Error("資料版本無效，請重新載入後再操作");
    error.code = "PROJECTION_CONTEXT_REVISION_INVALID";
    throw error;
  }
  return parsed;
}

function normalizeProjectionContextEvents(rawEvents = [], {
  yearMonth = "",
  allowedStoreKeys = null,
  excludedStoreKeys = null,
  lifecycleEntriesByStoreKey = null,
} = {}) {
  if (!Array.isArray(rawEvents)) {
    const error = new Error("活動資料格式無效");
    error.code = "PROJECTION_CONTEXT_EVENTS_INVALID";
    throw error;
  }
  if (rawEvents.length > PROJECTION_CONTEXT_MAX_EVENTS) {
    const error = new Error(`單一月份最多設定 ${PROJECTION_CONTEXT_MAX_EVENTS} 個活動`);
    error.code = "PROJECTION_CONTEXT_TOO_MANY_EVENTS";
    throw error;
  }

  const allowed = allowedStoreKeys instanceof Set ? allowedStoreKeys : null;
  const excluded = excludedStoreKeys instanceof Set ? excludedStoreKeys : new Set();
  const lifecycleMap = lifecycleEntriesByStoreKey instanceof Map
    ? lifecycleEntriesByStoreKey
    : null;
  const seenIds = new Set();
  let totalStoreScheduleCount = 0;

  const events = rawEvents.map((raw = {}) => {
    const name = String(raw?.name || "").trim().slice(0, 60);
    if (!name) {
      const error = new Error("活動名稱不可空白");
      error.code = "PROJECTION_CONTEXT_EVENT_NAME_REQUIRED";
      throw error;
    }

    const type = PROJECTION_CONTEXT_EVENT_TYPES.includes(String(raw?.type || ""))
      ? String(raw.type)
      : "other";
    const level = PROJECTION_CONTEXT_LEVELS.includes(String(raw?.level || ""))
      ? String(raw.level)
      : "normal";

    const startDate = normalizeProjectionContextDate(raw?.startDate, yearMonth);
    const endDate = normalizeProjectionContextDate(raw?.endDate, yearMonth);
    if (!startDate || !endDate || startDate > endDate) {
      const error = new Error("活動期間無效，第一階段請設定在同一月份內");
      error.code = "PROJECTION_CONTEXT_EVENT_DATE_INVALID";
      throw error;
    }

    const rawMetrics = Array.isArray(raw?.metrics) ? raw.metrics : [];
    const metrics = [...new Set(
      rawMetrics
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => PROJECTION_CONTEXT_METRICS.includes(value))
    )].sort();
    if (!metrics.length) {
      const error = new Error("請至少選擇一項主要影響");
      error.code = "PROJECTION_CONTEXT_EVENT_METRIC_REQUIRED";
      throw error;
    }

    const scopeMode = raw?.scopeMode === "stores" ? "stores" : "brand";
    const storeKeys = scopeMode === "stores"
      ? [...new Set(
          (Array.isArray(raw?.storeKeys) ? raw.storeKeys : [])
            .map(normalizeStoreLifecycleCore)
            .filter(Boolean)
        )].sort((a, b) => a.localeCompare(b, "zh-Hant"))
      : [];

    if (scopeMode === "stores" && !storeKeys.length) {
      const error = new Error("指定店家時，請至少選擇一間店");
      error.code = "PROJECTION_CONTEXT_EVENT_STORE_REQUIRED";
      throw error;
    }

    if (allowed) {
      const invalidStores = storeKeys.filter((storeKey) => !allowed.has(storeKey));
      if (invalidStores.length) {
        const error = new Error(`活動範圍包含目前不屬於正式營運範圍的店家：${invalidStores.join("、")}`);
        error.code = "PROJECTION_CONTEXT_EVENT_STORE_INVALID";
        throw error;
      }
    }

    const excludedStores = storeKeys.filter((storeKey) => excluded.has(storeKey));
    if (excludedStores.length) {
      const error = new Error(`活動範圍包含已排除店家：${excludedStores.join("、")}`);
      error.code = "PROJECTION_CONTEXT_EVENT_STORE_EXCLUDED";
      throw error;
    }

    let id = normalizeProjectionContextEventId(raw?.id);
    if (!id) id = crypto.randomUUID();
    if (seenIds.has(id)) {
      const error = new Error("活動識別重複，請重新操作");
      error.code = "PROJECTION_CONTEXT_EVENT_ID_DUPLICATE";
      throw error;
    }
    seenIds.add(id);

    const campaignId = normalizeProjectionContextEventId(raw?.campaignId) || id;
    const rawStoreSchedule = Array.isArray(raw?.storeSchedule) ? raw.storeSchedule : [];
    if (rawStoreSchedule.length > PROJECTION_CONTEXT_MAX_STORE_SCHEDULES_PER_EVENT) {
      const error = new Error(`單一活動最多設定 ${PROJECTION_CONTEXT_MAX_STORE_SCHEDULES_PER_EVENT} 間店的活動日期`);
      error.code = "PROJECTION_CONTEXT_TOO_MANY_STORE_SCHEDULES";
      throw error;
    }
    totalStoreScheduleCount += rawStoreSchedule.length;
    if (totalStoreScheduleCount > PROJECTION_CONTEXT_MAX_TOTAL_STORE_SCHEDULES) {
      const error = new Error(`單一月份最多設定 ${PROJECTION_CONTEXT_MAX_TOTAL_STORE_SCHEDULES} 筆店家活動日期`);
      error.code = "PROJECTION_CONTEXT_TOO_MANY_TOTAL_STORE_SCHEDULES";
      throw error;
    }

    const selectedStoreSet = new Set(storeKeys);
    const seenScheduleStoreKeys = new Set();
    const storeSchedule = rawStoreSchedule.map((row = {}) => {
      const storeKey = normalizeStoreLifecycleCore(
        row?.storeKey ||
        row?.coreStoreName ||
        row?.canonicalStoreName ||
        row?.storeName ||
        ""
      );
      if (!storeKey) {
        const error = new Error("店家活動日期包含無效店家");
        error.code = "PROJECTION_CONTEXT_SCHEDULE_STORE_REQUIRED";
        throw error;
      }
      if (seenScheduleStoreKeys.has(storeKey)) {
        const error = new Error(`店家活動日期重複：${storeKey}`);
        error.code = "PROJECTION_CONTEXT_SCHEDULE_STORE_DUPLICATE";
        throw error;
      }
      seenScheduleStoreKeys.add(storeKey);

      if (allowed && !allowed.has(storeKey)) {
        const error = new Error(`店家活動日期包含目前不屬於正式營運範圍的店家：${storeKey}`);
        error.code = "PROJECTION_CONTEXT_SCHEDULE_STORE_INVALID";
        throw error;
      }
      if (excluded.has(storeKey)) {
        const error = new Error(`店家活動日期包含已排除店家：${storeKey}`);
        error.code = "PROJECTION_CONTEXT_SCHEDULE_STORE_EXCLUDED";
        throw error;
      }
      if (scopeMode === "stores" && !selectedStoreSet.has(storeKey)) {
        const error = new Error(`店家活動日期超出本活動指定範圍：${storeKey}`);
        error.code = "PROJECTION_CONTEXT_SCHEDULE_OUTSIDE_EVENT_SCOPE";
        throw error;
      }

      const scheduleStartDate = normalizeProjectionContextDate(
        row?.startDate || row?.date,
        yearMonth
      );
      const scheduleEndDate = normalizeProjectionContextDate(
        row?.endDate || row?.startDate || row?.date,
        yearMonth
      );
      if (!scheduleStartDate || !scheduleEndDate || scheduleStartDate > scheduleEndDate) {
        const error = new Error(`店家活動日期無效：${storeKey}`);
        error.code = "PROJECTION_CONTEXT_SCHEDULE_DATE_INVALID";
        throw error;
      }
      if (scheduleStartDate < startDate || scheduleEndDate > endDate) {
        const error = new Error(`店家活動日期必須落在整體活動期間內：${storeKey}`);
        error.code = "PROJECTION_CONTEXT_SCHEDULE_OUTSIDE_EVENT_PERIOD";
        throw error;
      }

      if (lifecycleMap) {
        const lifecycleEntry = lifecycleMap.get(storeKey) || null;
        const lifecycleDateOptions = { closedDates: [] };
        if (
          !lifecycleEntry ||
          !isLifecycleEntryExpectedForDate(lifecycleEntry, scheduleStartDate, lifecycleDateOptions) ||
          !isLifecycleEntryExpectedForDate(lifecycleEntry, scheduleEndDate, lifecycleDateOptions)
        ) {
          const error = new Error(`店家活動日期超出目前正式營運期間：${storeKey}`);
          error.code = "PROJECTION_CONTEXT_SCHEDULE_LIFECYCLE_INVALID";
          throw error;
        }
      }

      return {
        storeKey,
        startDate: scheduleStartDate,
        endDate: scheduleEndDate,
      };
    }).sort((left, right) =>
      String(left.startDate || "").localeCompare(String(right.startDate || "")) ||
      String(left.storeKey || "").localeCompare(String(right.storeKey || ""), "zh-Hant")
    );

    return {
      id,
      campaignId,
      name,
      type,
      startDate,
      endDate,
      level,
      scopeMode,
      storeKeys,
      storeSchedule,
      metrics,
      note: String(raw?.note || "").trim().slice(0, 200),
    };
  });

  return events.sort((left, right) =>
    String(left.startDate || "").localeCompare(String(right.startDate || "")) ||
    String(left.name || "").localeCompare(String(right.name || ""), "zh-Hant") ||
    String(left.id || "").localeCompare(String(right.id || ""))
  );
}

function buildProjectionContextResponse(data = {}, yearMonth = "") {
  return {
    schemaVersion: PROJECTION_CONTEXT_SCHEMA_VERSION,
    brandId: String(data?.brandId || ""),
    yearMonth: String(data?.yearMonth || yearMonth),
    revision: Math.max(0, Number(data?.revision || 0)),
    mode: Array.isArray(data?.events) && data.events.length ? "event_month" : "normal_month",
    events: Array.isArray(data?.events) ? data.events : [],
    updatedAtText: String(data?.updatedAtText || ""),
    updatedBy: String(data?.updatedBy || ""),
    updatedByRole: String(data?.updatedByRole || ""),
    updatedByAccountId: String(data?.updatedByAccountId || ""),
  };
}

function createProjectionContextFunctions({ admin, db }) {
  if (!admin || !db) throw new Error("projection_context_requires_admin_and_db");

  const manageProjectionContext = onRequest(
    { cors: true, timeoutSeconds: 20, memory: "256MiB" },
    async (req, res) => {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, message: "method_not_allowed" });
      }

      const requestAuth = await requireFirebaseRequestAuth(req, admin);
      if (!requestAuth.ok) {
        return res.status(401).json({ ok: false, message: "登入狀態已失效，請重新登入" });
      }

      const body = req.body || {};
      const brandId = normalizeProjectionContextBrandId(body.brandId);
      const yearMonth = normalizeProjectionContextYearMonth(body.yearMonth);
      if (!brandId) return res.status(400).json({ ok: false, message: "不支援的品牌識別" });
      if (!yearMonth) return res.status(400).json({ ok: false, message: "月份格式無效" });

      try {
        const actorCheck = await verifySuperAdminActor({
          db,
          brandId,
          actor: body.actor || {},
        });
        if (!actorCheck.ok) {
          return res.status(403).json({
            ok: false,
            message: "此操作僅限已信任裝置上的最高管理者使用",
          });
        }

        const expectedRevision = parseProjectionContextExpectedRevision(body.expectedRevision);
        const contextRef = getBrandCollection(db, brandId, PROJECTION_CONTEXT_COLLECTION).doc(yearMonth);
        const lifecycleRef = getBrandCollection(db, brandId, "store_lifecycle").doc("master");
        const exclusionRef = getBrandSettingDoc(db, brandId, "audit_exclusions");
        const auditRef = getBrandCollection(db, brandId, "maintenance_logs").doc();

        let result = null;

        await db.runTransaction(async (transaction) => {
          const [contextSnap, lifecycleSnap, exclusionSnap] = await Promise.all([
            transaction.get(contextRef),
            transaction.get(lifecycleRef),
            transaction.get(exclusionRef),
          ]);

          const current = contextSnap.exists ? (contextSnap.data() || {}) : {};
          const currentRevision = Math.max(0, Number(current?.revision || 0));
          if (currentRevision !== expectedRevision) {
            const error = new Error("本月活動資訊已由其他最高管理者更新，請重新載入後再儲存");
            error.code = "PROJECTION_CONTEXT_CONFLICT";
            error.currentContext = buildProjectionContextResponse(current, yearMonth);
            throw error;
          }

          const lifecycleMaster = lifecycleSnap.exists ? (lifecycleSnap.data() || {}) : {};
          if (String(lifecycleMaster?.datasetStatus || "") !== "READY") {
            const error = new Error("店家正式名單尚未就緒，暫時無法更新活動範圍");
            error.code = "PROJECTION_CONTEXT_LIFECYCLE_NOT_READY";
            throw error;
          }

          const exclusionData = exclusionSnap.exists ? (exclusionSnap.data() || {}) : {};
          const exclusionProfile = normalizeStoredSystemExclusionProfile(
            exclusionData,
            brandId,
            normalizeStoreLifecycleCore
          );

          const eligibleEntries = getLifecycleEligibleStoreEntries(lifecycleMaster, yearMonth, {
            brandId,
            requireReady: true,
          });

          const lifecycleEntriesByStoreKey = new Map();
          eligibleEntries.forEach((entry) => {
            const storeKey = normalizeStoreLifecycleCore(
              entry?.storeKey ||
              entry?.coreStoreName ||
              entry?.canonicalStoreName ||
              ""
            );
            if (!storeKey || exclusionProfile.storeSet.has(storeKey)) return;
            lifecycleEntriesByStoreKey.set(storeKey, entry);
          });
          const allowedStoreKeys = new Set(lifecycleEntriesByStoreKey.keys());

          const events = normalizeProjectionContextEvents(body.events || [], {
            yearMonth,
            allowedStoreKeys,
            excludedStoreKeys: exclusionProfile.storeSet,
            lifecycleEntriesByStoreKey,
          });

          const nextRevision = currentRevision + 1;
          const nowText = new Date().toISOString();
          const payload = {
            schemaVersion: PROJECTION_CONTEXT_SCHEMA_VERSION,
            brandId,
            yearMonth,
            revision: nextRevision,
            mode: events.length ? "event_month" : "normal_month",
            events,
            lifecycleRevision: Math.max(0, Number(lifecycleMaster?.revision || 0)),
            systemExclusionRevision: Math.max(0, Number(exclusionProfile?.revision || 0)),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: nowText,
            updatedBy: actorCheck.actorName,
            updatedByRole: actorCheck.actorRole,
            updatedByAccountId: actorCheck.actorAccountId,
          };

          transaction.set(contextRef, payload, { merge: false });
          transaction.set(auditRef, {
            type: "projection_context",
            action: "update",
            source: "manageProjectionContext",
            brandId,
            yearMonth,
            revision: nextRevision,
            mode: payload.mode,
            eventCount: events.length,
            scheduledStoreCount: events.reduce(
              (sum, event) => sum + (Array.isArray(event?.storeSchedule) ? event.storeSchedule.length : 0),
              0
            ),
            operator: actorCheck.actorName,
            operatorRole: actorCheck.actorRole,
            operatorAccountId: actorCheck.actorAccountId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAtText: nowText,
          }, { merge: false });

          result = buildProjectionContextResponse(payload, yearMonth);
        });

        return res.status(200).json({ ok: true, context: result });
      } catch (error) {
        console.error("manageProjectionContext failed", error);

        if (error?.code === "PROJECTION_CONTEXT_CONFLICT") {
          return res.status(409).json({
            ok: false,
            code: error.code,
            message: error.message,
            currentContext: error.currentContext || null,
          });
        }

        const safeCodes = new Set([
          "PROJECTION_CONTEXT_REVISION_INVALID",
          "PROJECTION_CONTEXT_EVENTS_INVALID",
          "PROJECTION_CONTEXT_TOO_MANY_EVENTS",
          "PROJECTION_CONTEXT_EVENT_NAME_REQUIRED",
          "PROJECTION_CONTEXT_EVENT_DATE_INVALID",
          "PROJECTION_CONTEXT_EVENT_METRIC_REQUIRED",
          "PROJECTION_CONTEXT_EVENT_STORE_REQUIRED",
          "PROJECTION_CONTEXT_EVENT_STORE_INVALID",
          "PROJECTION_CONTEXT_EVENT_STORE_EXCLUDED",
          "PROJECTION_CONTEXT_EVENT_ID_DUPLICATE",
          "PROJECTION_CONTEXT_TOO_MANY_STORE_SCHEDULES",
          "PROJECTION_CONTEXT_TOO_MANY_TOTAL_STORE_SCHEDULES",
          "PROJECTION_CONTEXT_SCHEDULE_STORE_REQUIRED",
          "PROJECTION_CONTEXT_SCHEDULE_STORE_DUPLICATE",
          "PROJECTION_CONTEXT_SCHEDULE_STORE_INVALID",
          "PROJECTION_CONTEXT_SCHEDULE_STORE_EXCLUDED",
          "PROJECTION_CONTEXT_SCHEDULE_OUTSIDE_EVENT_SCOPE",
          "PROJECTION_CONTEXT_SCHEDULE_DATE_INVALID",
          "PROJECTION_CONTEXT_SCHEDULE_OUTSIDE_EVENT_PERIOD",
          "PROJECTION_CONTEXT_SCHEDULE_LIFECYCLE_INVALID",
          "PROJECTION_CONTEXT_LIFECYCLE_NOT_READY",
        ]);
        if (safeCodes.has(error?.code)) {
          return res.status(400).json({ ok: false, code: error.code, message: error.message });
        }

        return res.status(500).json({
          ok: false,
          message: "本月活動資訊更新失敗，請稍後再試",
        });
      }
    }
  );

  return { manageProjectionContext };
}

module.exports = {
  PROJECTION_CONTEXT_SCHEMA_VERSION,
  PROJECTION_CONTEXT_COLLECTION,
  PROJECTION_CONTEXT_EVENT_TYPES,
  PROJECTION_CONTEXT_LEVELS,
  PROJECTION_CONTEXT_METRICS,
  PROJECTION_CONTEXT_MAX_EVENTS,
  PROJECTION_CONTEXT_MAX_STORE_SCHEDULES_PER_EVENT,
  PROJECTION_CONTEXT_MAX_TOTAL_STORE_SCHEDULES,
  normalizeProjectionContextBrandId,
  normalizeProjectionContextYearMonth,
  normalizeProjectionContextDate,
  normalizeProjectionContextEvents,
  parseProjectionContextExpectedRevision,
  buildProjectionContextResponse,
  createProjectionContextFunctions,
};
