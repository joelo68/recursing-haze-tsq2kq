// src/utils/readTracker.js
import { doc, setDoc, serverTimestamp, increment } from "firebase/firestore";

const STORAGE_KEY = "cyj_read_tracker_stats";
const MODE_KEY = "cyj_read_tracker_mode";
const LAST_FLUSH_KEY = "cyj_read_tracker_last_flush";

const DEFAULT_MODE = "off"; // off | local | global

const getDeviceType = () => {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();

  if (ua.includes("iphone") || ua.includes("ipad")) return "iOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("mobile")) return "Mobile";
  if (ua.includes("mac")) return "Mac";
  if (ua.includes("windows")) return "Windows";

  return "Desktop";
};

const safeParse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const getLocalHourKey = (date = new Date()) => {
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}`;
};

const sanitizeFirestoreFieldKey = (value = "") => {
  return String(value || "unknown")
    .replace(/[.#$/\[\]\\]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120) || "unknown";
};

const mergeHourlyBucketsForFlush = (stats = {}) => {
  const merged = {};

  Object.entries(stats || {}).forEach(([label, item]) => {
    const safeLabel = sanitizeFirestoreFieldKey(label);
    const buckets = item?.hourlyBuckets && typeof item.hourlyBuckets === "object"
      ? item.hourlyBuckets
      : {};

    Object.entries(buckets).forEach(([hourKey, bucket]) => {
      if (!hourKey) return;
      if (!merged[hourKey]) merged[hourKey] = { sources: {} };
      if (!merged[hourKey].sources[safeLabel]) {
        merged[hourKey].sources[safeLabel] = { docs: 0, triggers: 0, lastAt: "" };
      }

      merged[hourKey].sources[safeLabel].docs += Number(bucket?.docs || 0);
      merged[hourKey].sources[safeLabel].triggers += Number(bucket?.triggers || 0);
      const lastAt = bucket?.lastAt || item?.lastAt || "";
      if (!merged[hourKey].sources[safeLabel].lastAt || String(lastAt) > String(merged[hourKey].sources[safeLabel].lastAt)) {
        merged[hourKey].sources[safeLabel].lastAt = lastAt;
      }
    });
  });

  return merged;
};

export const getReadTrackerMode = () => {
  if (typeof localStorage === "undefined") return DEFAULT_MODE;
  return localStorage.getItem(MODE_KEY) || DEFAULT_MODE;
};

export const setReadTrackerMode = (mode) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(MODE_KEY, mode);
};

export const clearReadTrackerStats = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LAST_FLUSH_KEY);
};

export const getReadTrackerStats = () => {
  if (typeof localStorage === "undefined") return {};
  return safeParse(localStorage.getItem(STORAGE_KEY), {});
};

export const trackReadSource = (label, docsCount = 0, meta = {}) => {
  const mode = getReadTrackerMode();
  if (mode === "off") return;
  if (typeof localStorage === "undefined") return;

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const hourKey = getLocalHourKey(nowDate);
  const current = getReadTrackerStats();
  const prev = current[label] || { docs: 0, triggers: 0, lastAt: null, meta: {}, hourlyBuckets: {} };
  const prevHourlyBuckets = prev.hourlyBuckets && typeof prev.hourlyBuckets === "object" ? prev.hourlyBuckets : {};
  const prevHour = prevHourlyBuckets[hourKey] || { docs: 0, triggers: 0, lastAt: null };

  current[label] = {
    docs: Number(prev.docs || 0) + Number(docsCount || 0),
    triggers: Number(prev.triggers || 0) + 1,
    lastAt: now,
    meta: { ...prev.meta, ...meta },
    hourlyBuckets: {
      ...prevHourlyBuckets,
      [hourKey]: {
        docs: Number(prevHour.docs || 0) + Number(docsCount || 0),
        triggers: Number(prevHour.triggers || 0) + 1,
        lastAt: now,
      },
    },
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
};

export const trackSnapshotRead = (label, snapshot, meta = {}) => {
  if (!snapshot) return;

  const docsCount = snapshot.docs?.length || 0;
  const changesCount =
    typeof snapshot.docChanges === "function" ? snapshot.docChanges().length : 0;

  trackReadSource(label, docsCount, {
    ...meta,
    changes: changesCount,
    fromCache: snapshot.metadata?.fromCache || false,
  });
};

export const shouldFlushReadTracker = (intervalMs = 5 * 60 * 1000) => {
  if (typeof localStorage === "undefined") return false;

  const lastFlush = Number(localStorage.getItem(LAST_FLUSH_KEY) || 0);
  const now = Date.now();

  return now - lastFlush >= intervalMs;
};

export const flushReadTrackerToFirestore = async ({
  db,
  brandId = "unknown",
  brandLabel = "unknown",
  userRole = "unknown",
  userName = "unknown",
  activeView = "unknown",
  flushIntervalMs = 5 * 60 * 1000,
  force = false,
}) => {
  const mode = getReadTrackerMode();
  if (mode !== "global") return { skipped: true, reason: "not_global_mode" };

  if (!force && !shouldFlushReadTracker(flushIntervalMs)) {
    return { skipped: true, reason: "interval_not_reached" };
  }

  const stats = getReadTrackerStats();
  const sources = Object.entries(stats);

  if (sources.length === 0) {
    return { skipped: true, reason: "empty_stats" };
  }

  const today = new Date().toISOString().slice(0, 10);
  const device = getDeviceType();
  const safeUser = String(userName || "unknown")
    .replace(/[.#$/\[\]\\]/g, "_")
    .replace(/\s+/g, "_");

  const sessionKey = [
    today,
    brandId || "unknown",
    userRole || "unknown",
    safeUser,
    device,
  ].join("_");

  const totalReadDocs = sources.reduce((sum, [, item]) => sum + (item.docs || 0), 0);
  const totalTriggers = sources.reduce((sum, [, item]) => sum + (item.triggers || 0), 0);

  const payload = {
    date: today,
    brandId,
    brandLabel,
    userRole,
    userName,
    activeView,
    device,
    totalReadDocs: increment(totalReadDocs),
    totalTriggers: increment(totalTriggers),
    hasHourlyBuckets: true,
    hourlyBucketVersion: 1,
    lastUpdatedAt: serverTimestamp(),
    updatedAtText: new Date().toISOString(),
  };

  const sourcePayload = {};
  const hourlyBuckets = mergeHourlyBucketsForFlush(stats);

  Object.entries(hourlyBuckets).forEach(([hourKey, bucket]) => {
    const safeHourKey = sanitizeFirestoreFieldKey(hourKey);
    Object.entries(bucket.sources || {}).forEach(([safeLabel, item]) => {
      sourcePayload[`hourlyBuckets.${safeHourKey}.sources.${safeLabel}.docs`] = increment(Number(item.docs || 0));
      sourcePayload[`hourlyBuckets.${safeHourKey}.sources.${safeLabel}.triggers`] = increment(Number(item.triggers || 0));
      sourcePayload[`hourlyBuckets.${safeHourKey}.sources.${safeLabel}.lastAt`] = item.lastAt || new Date().toISOString();
    });
  });

  sources.forEach(([label, item]) => {
    const safeLabel = sanitizeFirestoreFieldKey(label);
    sourcePayload[`sources.${safeLabel}.docs`] = increment(item.docs || 0);
    sourcePayload[`sources.${safeLabel}.triggers`] = increment(item.triggers || 0);
    sourcePayload[`sources.${safeLabel}.lastAt`] = item.lastAt || new Date().toISOString();
    sourcePayload[`sources.${safeLabel}.meta`] = item.meta || {};
  });

  const ref = doc(db, "read_debug_sessions", sessionKey);

  await setDoc(ref, { ...payload, ...sourcePayload }, { merge: true });

  localStorage.setItem(LAST_FLUSH_KEY, String(Date.now()));
  localStorage.removeItem(STORAGE_KEY);

  return {
    skipped: false,
    totalReadDocs,
    totalTriggers,
    sources: sources.length,
  };
};

// ==========================================
// ★ 排程式讀取追蹤工具
// ==========================================
export const isTimeInScheduleRange = (nowHHMM, startHHMM, endHHMM) => {
  if (!startHHMM || !endHHMM) return false;

  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const now = toMinutes(nowHHMM);
  const start = toMinutes(startHHMM);
  const end = toMinutes(endHHMM);

  if (start === end) return true; // 視為全天
  if (start < end) return now >= start && now < end;

  // 跨日，例如 19:00 ~ 07:00
  return now >= start || now < end;
};

export const getLocalHHMM = (date = new Date()) => {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};

export const getReadTrackerScheduleStatus = (config = {}, nowDate = new Date()) => {
  const scheduleEnabled = Boolean(config.scheduleEnabled);
  const startTime = config.startTime || "19:00";
  const endTime = config.endTime || "07:00";
  const scheduleMode = config.scheduleMode || "global";
  const nowTime = getLocalHHMM(nowDate);
  const isActive = scheduleEnabled && isTimeInScheduleRange(nowTime, startTime, endTime);

  let label = "排程未啟用";
  if (scheduleEnabled && isActive) label = "排程追蹤中";
  else if (scheduleEnabled && !isActive) label = "等待排程啟動";

  return {
    scheduleEnabled,
    startTime,
    endTime,
    scheduleMode,
    nowTime,
    isActive,
    label,
  };
};

export const getReadTrackerNextScheduleBoundaryDelayMs = (config = {}, nowDate = new Date()) => {
  if (!config.scheduleEnabled) return null;

  const parseHHMM = (hhmm) => {
    const [h, m] = String(hhmm || "00:00").split(":").map(Number);
    return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
  };

  const makeBoundary = (baseDate, hhmm, dayOffset = 0) => {
    const { h, m } = parseHHMM(hhmm);
    const target = new Date(baseDate);
    target.setDate(target.getDate() + dayOffset);
    target.setHours(h, m, 1, 0);
    return target;
  };

  const startTime = config.startTime || "19:00";
  const endTime = config.endTime || "07:00";
  const candidates = [
    makeBoundary(nowDate, startTime, 0),
    makeBoundary(nowDate, endTime, 0),
    makeBoundary(nowDate, startTime, 1),
    makeBoundary(nowDate, endTime, 1),
  ]
    .map((date) => date.getTime() - nowDate.getTime())
    .filter((delay) => delay > 1000)
    .sort((a, b) => a - b);

  return candidates.length ? candidates[0] : null;
};

export const resolveReadTrackerModeFromConfig = (config = {}, nowDate = new Date()) => {
  const manualMode = ["off", "local", "global"].includes(config.mode) ? config.mode : "off";
  const status = getReadTrackerScheduleStatus(config, nowDate);

  // 排程時段內應優先切為全域上報。
  // 否則若使用者白天曾開本機追蹤，config.mode 會停在 local，晚上 19:00 就會被 local 擋住，導致全域上報沒有啟動。
  if (status.scheduleEnabled && status.isActive) {
    return status.scheduleMode || "global";
  }

  // 非排程時段才回到手動模式。
  if (manualMode === "local" || manualMode === "global") return manualMode;

  return "off";
};