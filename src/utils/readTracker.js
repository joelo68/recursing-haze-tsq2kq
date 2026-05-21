// src/utils/readTracker.js
import { doc, setDoc, serverTimestamp, increment } from "firebase/firestore";

const STORAGE_KEY = "cyj_read_tracker_stats";
const MODE_KEY = "cyj_read_tracker_mode";
const LAST_FLUSH_KEY = "cyj_read_tracker_last_flush";

const DEFAULT_MODE = "off"; 
// off | local | global

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

  const prev = current[label] || {
    docs: 0,
    triggers: 0,
    lastAt: null,
    meta: {},
  };

  current[label] = {
    docs: prev.docs + Number(docsCount || 0),
    triggers: prev.triggers + 1,
    lastAt: now,
    meta: {
      ...prev.meta,
      ...meta,
    },
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
};

export const trackSnapshotRead = (label, snapshot, meta = {}) => {
  if (!snapshot) return;

  const docsCount = snapshot.docs?.length || 0;
  const changesCount =
    typeof snapshot.docChanges === "function"
      ? snapshot.docChanges().length
      : 0;

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

  const sessionKey = [
    today,
    brandId || "unknown",
    userRole || "unknown",
    String(userName || "unknown").replace(/[^\w\u4e00-\u9fa5-]/g, "_"),
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
    sourcePayload[`sources.${label}.docs`] = increment(item.docs || 0);
    sourcePayload[`sources.${label}.triggers`] = increment(item.triggers || 0);
    sourcePayload[`sources.${label}.lastAt`] = item.lastAt || new Date().toISOString();
    sourcePayload[`sources.${label}.meta`] = item.meta || {};
  });

  const ref = doc(db, "read_debug_sessions", sessionKey);

  await setDoc(
    ref,
    {
      ...payload,
      ...sourcePayload,
    },
    { merge: true }
  );

  localStorage.setItem(LAST_FLUSH_KEY, String(Date.now()));
  localStorage.removeItem(STORAGE_KEY);

  return {
    skipped: false,
    totalReadDocs,
    totalTriggers,
    sources: sources.length,
  };
};