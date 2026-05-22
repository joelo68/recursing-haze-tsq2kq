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

  const now = new Date().toISOString();
  const current = getReadTrackerStats();
  const prev = current[label] || { docs: 0, triggers: 0, lastAt: null, meta: {} };

  current[label] = {
    docs: prev.docs + Number(docsCount || 0),
    triggers: prev.triggers + 1,
    lastAt: now,
    meta: { ...prev.meta, ...meta },
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
    lastUpdatedAt: serverTimestamp(),
    updatedAtText: new Date().toISOString(),
  };

  const sourcePayload = {};

  sources.forEach(([label, item]) => {
    const safeLabel = String(label).replace(/[.#$/\[\]\\]/g, "_");
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

export const resolveReadTrackerModeFromConfig = (config = {}, nowDate = new Date()) => {
  const manualMode = config.mode || "off";
  const status = getReadTrackerScheduleStatus(config, nowDate);

  if (status.scheduleEnabled) {
    return status.isActive ? status.scheduleMode : "off";
  }

  return ["off", "local", "global"].includes(manualMode) ? manualMode : "off";
};