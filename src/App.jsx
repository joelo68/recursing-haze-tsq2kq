// src/App.jsx
/* eslint-disable no-undef */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-unused-vars */

import React, {
  useState,
  useEffect,
  useMemo,
  useContext,
  useCallback,
  useRef,
  lazy,
  Suspense
} from "react";

import {
  app, auth, db, appId } from "./config/firebase"; import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "firebase/auth"; import { collection, addDoc, deleteDoc, updateDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, query, orderBy, limit, deleteField, where, increment, getDocs } from "firebase/firestore"; import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line, ComposedChart, Area, Cell, PieChart, Pie } from "recharts"; import {    LayoutDashboard, Upload, TrendingUp, Map as MapIcon, Settings, ClipboardCheck, Menu, Search, Filter, Trash2, Save, Plus, DollarSign, Target, Users, Award, Loader2, FileText, AlertCircle, CheckCircle, User, Store, Lock, LogOut, FileWarning, Edit2, CheckSquare, X, Download, ChevronLeft, ChevronRight, Activity, Sparkles, ChevronDown, Heart, Coffee, Shield, WifiOff, ShoppingBag, CreditCard, Smartphone, Monitor, Bell, Clock, Music, ShieldAlert, Calendar
} from "lucide-react";

import { ROLES, ALL_MENU_ITEMS, DEFAULT_REGIONAL_MANAGERS, DEFAULT_PERMISSIONS } from "./constants/index";
import { generateUUID, formatLocalYYYYMMDD, toStandardDateFormat, formatNumber, parseNumber, normalizeManagerOrder } from "./utils/helpers";
import { ViewWrapper, Card, Skeleton, Toast, ConfirmModal } from "./components/SharedUI";
import { Sidebar, MobileTopNav } from "./components/Navigation";
import { AppContext } from "./AppContext";
import { useAnalytics } from "./hooks/useAnalytics";
import TherapistManagerView from "./components/TherapistManagerView";
import LoginView from "./components/LoginView";
import {
  trackSnapshotRead,
  trackReadSource,
  flushReadTrackerToFirestore,
  setReadTrackerMode,
  resolveReadTrackerModeFromConfig,
  getReadTrackerScheduleStatus,
} from "./utils/readTracker";

// ==========================================
// ★ 系統核心版本號 (終極動態快取版)
// ==========================================
const CURRENT_APP_VERSION = "3.2.5"; 
const LOGIN_LOCATION_ENDPOINT = "https://resolveloginlocation-hyhcwrnyaa-uc.a.run.app";


const isNewerVersion = (local, remote) => {
  if (!remote) return true;
  const l = local.split('.').map(Number);
  const r = remote.split('.').map(Number);
  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    const numL = l[i] || 0; const numR = r[i] || 0;
    if (numL > numR) return true;
    if (numL < numR) return false;
  }
  return false;
};

const isOlderVersion = (local, remote) => {
  if (!remote) return false;
  const l = local.split('.').map(Number);
  const r = remote.split('.').map(Number);
  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    const numL = l[i] || 0; const numR = r[i] || 0;
    if (numL < numR) return true;
    if (numL > numR) return false;
  }
  return false;
};

const lazyWithRetry = (componentImport) =>
  lazy(async () => {
    try {
      return await componentImport();
    } catch (error) {
      console.warn("模組載入失敗，正在自動重整...", error);
      const currentUrl = window.location.href.split('?')[0]; 
      window.location.replace(`${currentUrl}?v=${new Date().getTime()}`);
      return { default: () => <div className="p-10 text-center text-stone-400">正在同步最新模組...</div> };
    }
  });

const DashboardView = lazyWithRetry(() => import("./components/DashboardView"));
const DailyView = lazyWithRetry(() => import("./components/DailyView"));
const RegionalView = lazyWithRetry(() => import("./components/RegionalView"));
const RankingView = lazyWithRetry(() => import("./components/RankingView"));
const StoreAnalysisView = lazyWithRetry(() => import("./components/StoreAnalysisView"));
const AuditView = lazyWithRetry(() => import("./components/AuditView"));
const HistoryView = lazyWithRetry(() => import("./components/HistoryView"));
const InputView = lazyWithRetry(() => import("./components/InputView"));
const SystemMonitor = lazyWithRetry(() => import("./components/SystemMonitor"));
const SettingsView = lazyWithRetry(() => import("./components/SettingsView"));
const AnnualView = lazyWithRetry(() => import("./components/AnnualView"));
const TargetView = lazyWithRetry(() => import("./components/TargetView"));
const TherapistTargetView = lazyWithRetry(() => import("./components/TherapistTargetView"));
const TherapistScheduleView = lazyWithRetry(() => import("./components/TherapistScheduleView"));
const NotificationManager = lazyWithRetry(() => import("./components/NotificationManager"));


const removeUndefinedDeep = (value) => {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedDeep).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.entries(value).reduce((acc, [key, item]) => {
      if (item !== undefined) {
        acc[key] = removeUndefinedDeep(item);
      }
      return acc;
    }, {});
  }
  return value;
};

const normalizeLoginLocationPayload = (location = {}) => {
  const display = String(location?.display || "").trim() || "未知位置";
  return {
    display,
    countryCode: location?.countryCode || "",
    countryName: location?.countryName || "",
    region: location?.region || "",
    city: location?.city || "",
    district: location?.district || "",
    timezone: location?.timezone || "",
    isp: location?.isp || "",
    ipMasked: location?.ipMasked || "",
    source: location?.source || (display === "未知位置" ? "unknown" : "ip_geolocation"),
    confidence: location?.confidence || "unknown",
    isProxy: Boolean(location?.isProxy),
    isMobileNetwork: Boolean(location?.isMobileNetwork),
    updatedAtText: location?.updatedAtText || new Date().toISOString(),
  };
};

const UNKNOWN_LOGIN_LOCATION = normalizeLoginLocationPayload({ display: "未知位置", source: "unknown" });


const BRANDS = [
  { id: 'cyj', label: 'CYJ', icon: Sparkles, pathType: 'legacy', color: 'amber', gradient: 'from-amber-500 to-orange-600', bg: 'bg-amber-50', text: 'text-amber-600' },
  { id: 'anniu', label: '安妞', icon: Heart, pathType: 'new', color: 'rose', gradient: 'from-rose-400 to-pink-600', bg: 'bg-rose-50', text: 'text-rose-600' },
  { id: 'yibo', label: '伊啵', icon: Music, pathType: 'new', color: 'sky', gradient: 'from-sky-400 to-indigo-600', bg: 'bg-sky-50', text: 'text-sky-600' }
];

const DEFAULT_SECURITY_CONFIG = {
  enabled: true,
  timeoutMinutes: 240,
  warningSeconds: 60,
  exemptRoles: ["director", "master"],
  lowPowerEnabled: true,
  lowPowerIdleMinutes: 30,
  autoLogoutEnabled: true,
  autoLogoutMinutes: 240,
  logoutWarningSeconds: 60,
};


const LEGACY_TRAINER_ID = "trainer_default";

const normalizeTrainerAuthData = (data = {}) => {
  const raw = data || {};
  const hasAccounts = raw.accounts && typeof raw.accounts === "object";
  const accounts = hasAccounts ? { ...raw.accounts } : {};
  let trainerOrder = Array.isArray(raw.trainerOrder) ? [...raw.trainerOrder] : [];

  // 舊版相容：原本只有 trainer_auth.password。
  if (!hasAccounts) {
    accounts[LEGACY_TRAINER_ID] = {
      id: LEGACY_TRAINER_ID,
      name: raw.name || "教專",
      password: raw.password || "0000",
      isActive: raw.isActive !== false,
      isLegacyDefault: true,
      createdAtText: raw.createdAtText || "",
      updatedAtText: raw.updatedAtText || "",
    };
    trainerOrder = [LEGACY_TRAINER_ID];
  } else if (Object.keys(accounts).length === 0) {
    accounts[LEGACY_TRAINER_ID] = {
      id: LEGACY_TRAINER_ID,
      name: "教專",
      password: raw.password || "0000",
      isActive: true,
      isLegacyDefault: true,
      createdAtText: "",
      updatedAtText: "",
    };
    trainerOrder = [LEGACY_TRAINER_ID];
  }

  const existingIds = Object.keys(accounts);
  const seen = new Set();
  const normalizedOrder = [];

  trainerOrder.forEach((id) => {
    const key = String(id || "").trim();
    if (key && accounts[key] && !seen.has(key)) {
      seen.add(key);
      normalizedOrder.push(key);
    }
  });

  existingIds
    .filter((id) => !seen.has(id))
    .sort((a, b) => String(accounts[a]?.name || a).localeCompare(String(accounts[b]?.name || b), "zh-Hant", { numeric: true, sensitivity: "base" }))
    .forEach((id) => normalizedOrder.push(id));

  const normalizedAccounts = {};
  normalizedOrder.forEach((id, index) => {
    const account = accounts[id] || {};
    normalizedAccounts[id] = {
      id,
      name: account.name || (id === LEGACY_TRAINER_ID ? "教專" : "未命名教專"),
      password: account.password || "0000",
      isActive: account.isActive !== false,
      sortOrder: Number.isFinite(Number(account.sortOrder)) ? Number(account.sortOrder) : index,
      createdAtText: account.createdAtText || "",
      updatedAtText: account.updatedAtText || "",
      ...account,
    };
  });

  return {
    ...raw,
    accounts: normalizedAccounts,
    trainerOrder: normalizedOrder,
    password: raw.password || normalizedAccounts[normalizedOrder[0]]?.password || "0000",
  };
};

const getSortedTrainerAccounts = (trainerAuth = {}) => {
  const normalized = normalizeTrainerAuthData(trainerAuth);
  return (normalized.trainerOrder || [])
    .map((id) => normalized.accounts?.[id])
    .filter(Boolean);
};

const getDirectorTitleWeight = (name = "") => {
  if (name.includes("董事長")) return 1;
  if (name.includes("總經理")) return 2;
  if (name.includes("營運長")) return 3;
  if (name.includes("總監")) return 4;
  if (name.includes("財務")) return 5;
  return 9;
};

const getDefaultDirectorLevel = (name = "") => {
  if (name.includes("董事長") || name.includes("總經理")) return "super_admin";
  if (name.includes("財務")) return "finance_admin";
  return "operation_admin";
};

const normalizeDirectorAuthData = (data = {}) => {
  const raw = data || {};
  const hasAccounts = raw.accounts && typeof raw.accounts === "object";
  let accounts = {};
  let directorOrder = Array.isArray(raw.directorOrder) ? [...raw.directorOrder] : [];

  if (hasAccounts) {
    accounts = { ...raw.accounts };
  } else {
    Object.entries(raw).forEach(([name, value]) => {
      if (["accounts", "directorOrder", "password"].includes(name)) return;
      if (value && typeof value === "object") accounts[name] = { ...value, name: value.name || name };
      else accounts[name] = { name, password: value || "0000" };
    });
    if (raw.password && Object.keys(accounts).length === 0) {
      accounts["營運總監"] = { name: "營運總監", password: raw.password };
    }
  }

  const existingNames = Object.keys(accounts);
  const seen = new Set();
  const normalizedOrder = [];

  directorOrder.forEach((name) => {
    const key = String(name || "").trim();
    if (key && accounts[key] && !seen.has(key)) {
      seen.add(key);
      normalizedOrder.push(key);
    }
  });

  existingNames
    .filter((name) => !seen.has(name))
    .sort((a, b) => {
      const aw = getDirectorTitleWeight(a);
      const bw = getDirectorTitleWeight(b);
      if (aw !== bw) return aw - bw;
      return String(a).localeCompare(String(b), "zh-Hant", { numeric: true, sensitivity: "base" });
    })
    .forEach((name) => normalizedOrder.push(name));

  const normalizedAccounts = {};
  normalizedOrder.forEach((name, index) => {
    const account = accounts[name] || {};
    normalizedAccounts[name] = {
      id: account.id || name,
      name: account.name || name,
      password: account.password || (typeof account === "string" ? account : "0000"),
      level: account.level || account.directorLevel || getDefaultDirectorLevel(name),
      isActive: account.isActive !== false,
      sortOrder: Number.isFinite(Number(account.sortOrder)) ? Number(account.sortOrder) : index,
      createdAtText: account.createdAtText || "",
      updatedAtText: account.updatedAtText || "",
      ...account,
    };
  });

  return { accounts: normalizedAccounts, directorOrder: normalizedOrder };
};

const VIEW_ACTIVITY_LABELS = {
  dashboard: "營運總覽",
  daily: "每日總覽",
  regional: "區域總覽",
  ranking: "排行榜",
  "store-analysis": "店家分析",
  audit: "回報檢核",
  history: "數據修正中心",
  input: "日報輸入",
  logs: "登入監控 / 操作日誌",
  settings: "系統設定",
  annual: "年度分析",
  targets: "年度目標設定",
  "t-targets": "管理師目標",
  "t-schedule": "管理師排休",
  notification: "通知管理",
  "therapist-manager": "管理師管理",
};

const IMPORTANT_PAGE_VIEW_SET = new Set([
  "dashboard",
  "input",
  "history",
  "audit",
  "targets",
  "t-targets",
  "settings",
  "logs",
  "annual",
]);

const normalizeSecurityConfig = (config = {}) => ({
  ...DEFAULT_SECURITY_CONFIG,
  ...config,
  autoLogoutEnabled: config.autoLogoutEnabled ?? config.enabled ?? DEFAULT_SECURITY_CONFIG.autoLogoutEnabled,
  autoLogoutMinutes: Number(config.autoLogoutMinutes ?? config.timeoutMinutes ?? DEFAULT_SECURITY_CONFIG.autoLogoutMinutes),
  logoutWarningSeconds: Number(config.logoutWarningSeconds ?? config.warningSeconds ?? DEFAULT_SECURITY_CONFIG.logoutWarningSeconds),
  lowPowerEnabled: config.lowPowerEnabled ?? DEFAULT_SECURITY_CONFIG.lowPowerEnabled,
  lowPowerIdleMinutes: Number(config.lowPowerIdleMinutes ?? DEFAULT_SECURITY_CONFIG.lowPowerIdleMinutes),
  enabled: config.enabled ?? config.autoLogoutEnabled ?? DEFAULT_SECURITY_CONFIG.enabled,
  timeoutMinutes: Number(config.timeoutMinutes ?? config.autoLogoutMinutes ?? DEFAULT_SECURITY_CONFIG.timeoutMinutes),
  warningSeconds: Number(config.warningSeconds ?? config.logoutWarningSeconds ?? DEFAULT_SECURITY_CONFIG.warningSeconds),
  exemptRoles: config.exemptRoles || DEFAULT_SECURITY_CONFIG.exemptRoles,
});


const getClientDeviceInfo = () => {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const lowerUa = ua.toLowerCase();

  let device = "PC";
  if (lowerUa.includes("android")) device = "Android";
  else if (lowerUa.includes("iphone") || lowerUa.includes("ipad")) device = "iOS";
  else if (lowerUa.includes("mobile")) device = "Mobile";

  let browser = "Browser";
  if (lowerUa.includes("edg/")) browser = "Edge";
  else if (lowerUa.includes("chrome/") && !lowerUa.includes("edg/")) browser = "Chrome";
  else if (lowerUa.includes("safari/") && !lowerUa.includes("chrome/")) browser = "Safari";
  else if (lowerUa.includes("firefox/")) browser = "Firefox";

  let os = "Unknown";
  if (lowerUa.includes("mac os")) os = "macOS";
  else if (lowerUa.includes("windows")) os = "Windows";
  else if (lowerUa.includes("iphone") || lowerUa.includes("ipad")) os = "iOS";
  else if (lowerUa.includes("android")) os = "Android";

  let deviceId = "";
  let deviceStorageStatus = "ok";
  let deviceStorageMigrated = false;

  try {
    const stableKey = "drcyj_stable_device_id_v2";
    const legacyKey = "cyj_device_id_v1";
    const legacyDeviceId = localStorage.getItem(legacyKey);
    deviceId = localStorage.getItem(stableKey) || legacyDeviceId || "";

    if (!deviceId) {
      const randomPart = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
      deviceId = `dev_${randomPart}`;
    }

    localStorage.setItem(stableKey, deviceId);
    localStorage.setItem(legacyKey, deviceId);
    deviceStorageMigrated = Boolean(legacyDeviceId && legacyDeviceId === deviceId);
  } catch (error) {
    deviceStorageStatus = "session_fallback";
    deviceId = `dev_session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  const deviceFingerprint = [device, browser, os].filter(Boolean).join("|");

  return {
    device,
    browser,
    os,
    deviceId,
    stableDeviceId: deviceId,
    deviceShort: String(deviceId || "").replace(/^dev_/, "").slice(-8),
    deviceFingerprint,
    deviceStorageStatus,
    deviceStorageMigrated,
    userAgent: ua,
  };
};

const persistStableClientDeviceId = (deviceId = "") => {
  const stableId = String(deviceId || "").trim();
  if (!stableId || stableId.startsWith("dev_session_")) return false;

  try {
    localStorage.setItem("drcyj_stable_device_id_v2", stableId);
    localStorage.setItem("cyj_device_id_v1", stableId);
    return true;
  } catch (error) {
    console.warn("persistStableClientDeviceId failed:", error);
    return false;
  }
};

const getLoginLocationCityText = (location = {}) => {
  if (!location || typeof location !== "object") return "";
  return String(location.city || location.region || location.display || "").trim();
};

const findRecoverableKnownDeviceEntry = (devices = {}, deviceInfo = {}, loginLocation = {}) => {
  const entries = Object.entries(devices || {});
  if (!entries.length) return null;

  const currentDeviceId = String(deviceInfo?.deviceId || "");
  const currentFingerprint = String(deviceInfo?.deviceFingerprint || [deviceInfo?.device, deviceInfo?.browser, deviceInfo?.os].filter(Boolean).join("|"));
  const currentLocationText = getLoginLocationCityText(loginLocation);
  const now = Date.now();
  const maxAgeMs = 120 * 24 * 60 * 60 * 1000;

  let bestMatch = null;

  entries.forEach(([storedDeviceId, item = {}]) => {
    if (!item || storedDeviceId === currentDeviceId) return;
    if (item.status === "blocked" || item.source === "manual_blocked") return;

    const storedFingerprint = String(item.deviceFingerprint || [item.device, item.browser, item.os].filter(Boolean).join("|"));
    if (!storedFingerprint || storedFingerprint !== currentFingerprint) return;

    const lastSeenText = item.lastSeenAtText || item.firstSeenAtText || "";
    const lastSeenMs = lastSeenText ? Date.parse(lastSeenText) : 0;
    const isRecent = !lastSeenMs || Number.isNaN(lastSeenMs) || (now - lastSeenMs <= maxAgeMs);
    if (!isRecent) return;

    const itemLocationText = getLoginLocationCityText(item.lastLoginLocation || item.loginLocation || item.firstLoginLocation || {});
    const locationCompatible = !currentLocationText || !itemLocationText || currentLocationText === itemLocationText || currentLocationText.includes(itemLocationText) || itemLocationText.includes(currentLocationText);
    if (!locationCompatible) return;

    const score =
      (item.trusted !== false && item.status !== "new" ? 30 : 0) +
      (Number(item.loginCount || 0) >= 2 ? 20 : 0) +
      (locationCompatible ? 10 : 0) +
      (lastSeenMs || 0) / 10000000000000;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { storedDeviceId, item, score };
    }
  });

  return bestMatch;
};

const sanitizeSecurityKey = (value = "") => {
  return String(value || "")
    .trim()
    .replace(/[\/.#$\[\]\s]+/g, "_")
    .slice(0, 120) || "unknown";
};

const SECURITY_DEVICE_CONFIG = {
  autoTrustLimit: 2,
  alertRoles: ["director", "trainer", "manager", "store"],
};

const DIRECTOR_VIEW_PERMISSIONS = {
  super_admin: { allowedViews: null, label: "最高管理者" },
  operation_admin: {
    allowedViews: new Set(["dashboard", "daily", "regional", "ranking", "store-analysis", "audit", "annual", "logs", "notification"]),
    label: "營運主管",
  },
  finance_admin: {
    allowedViews: new Set(["dashboard", "daily", "regional", "ranking", "store-analysis", "annual"]),
    label: "財務主管",
  },
  viewer: {
    allowedViews: new Set(["dashboard", "daily", "regional", "ranking", "store-analysis", "annual"]),
    label: "只讀主管",
  },
};

const DIRECTOR_RESTRICTED_VIEWS = {
  history: "業績修正",
  input: "日報輸入",
  targets: "年度目標設定",
  "t-targets": "管理師目標",
  "t-schedule": "管理師排休",
  settings: "系統管理中心",
  "therapist-manager": "管理師管理",
  logs: "登入監控 / 操作日誌",
  audit: "回報檢核",
  notification: "通知管理",
};

// ★ 讀取節流 v1：把大型資料源限制在真正需要的頁面。
// 年度資料只供年度分析使用；月度明細只供 Dashboard / 排行 / 區域 / 店家分析 / 檢核 / 修正使用。
// 日報輸入、系統設定、登入監控、目標設定等頁面不應背景常駐讀整月或全年資料。
const ANNUAL_DATA_VIEWS = new Set(["annual"]);
const MONTHLY_REPORT_DATA_VIEWS = new Set(["dashboard", "regional", "ranking", "store-analysis", "audit", "history"]);

// ★ 讀取節流 v2：拆開「店日報」與「管理師日報」監聽。
// regional / ranking / store-analysis 只需要店日報，不應同步常駐讀 therapist_daily_reports。
// Dashboard 預設店鋪模式時也先不讀管理師日報；切到人員績效才啟動。
const MONTHLY_DAILY_REPORT_DATA_VIEWS = new Set(["dashboard", "regional", "ranking", "store-analysis", "audit", "history"]);
const MONTHLY_THERAPIST_REPORT_DATA_VIEWS = new Set(["audit", "history"]);


export default function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState("dashboard");
  const [dashboardViewMode, setDashboardViewMode] = useState("store");
  const [storeAnalysisSelectedStore, setStoreAnalysisSelectedStore] = useState("");
  const [auditType, setAuditType] = useState("daily");
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState(null);
  const [loginSecurityNotice, setLoginSecurityNotice] = useState(null);
  const [emergencyMasterPassword, setEmergencyMasterPassword] = useState("");
  const [isEmergencyUnlocking, setIsEmergencyUnlocking] = useState(false);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: "", message: "", onConfirm: null });
  const [globalSearchTerm, setGlobalSearchTerm] = useState("");
  const [currentBrandId, setCurrentBrandId] = useState("cyj");
  const [hasSelectedBrand, setHasSelectedBrand] = useState(false);
  const [dailyLoginCount, setDailyLoginCount] = useState(0);
  const [yesterdayLoginCount, setYesterdayLoginCount] = useState(0);
  const [deviceAlertSummary, setDeviceAlertSummary] = useState({
    pendingNewDeviceCount: 0,
    latestUserName: "",
    latestDevice: "",
    latestAtText: "",
  });
  const [currentDeviceTrust, setCurrentDeviceTrust] = useState({
    status: "checking",
    label: "裝置狀態確認中",
    deviceShort: "",
    deviceId: "",
  });

  const [isUpdating, setIsUpdating] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const currentBrand = useMemo(() => BRANDS.find(b => b.id === currentBrandId) || BRANDS[0], [currentBrandId]);

  const getReadMeta = useCallback((label = "") => ({
    label,
    role: userRole || "guest",
    brand: currentBrandId,
    view: activeView,
    userName: currentUser?.name || userRole || "unknown",
  }), [userRole, currentBrandId, activeView, currentUser]);

  // ★ 穩定版讀取追蹤資訊：
  // 高流量的即時監聽不應該因為 activeView 切換而重新建立。
  // 這個 ref 讓監聽 callback 仍可取得最新畫面資訊，但不把 activeView 放進監聽依賴。
  const readMetaRef = useRef({
    role: userRole || "guest",
    brand: currentBrandId,
    view: activeView,
    userName: currentUser?.name || userRole || "unknown",
  });

  const readTrackerConfigRef = useRef({
    mode: "off",
    scheduleEnabled: false,
    scheduleMode: "global",
    startTime: "19:00",
    endTime: "07:00",
    timezone: "Asia/Taipei",
  });

  useEffect(() => {
    readMetaRef.current = {
      role: userRole || "guest",
      brand: currentBrandId,
      view: activeView,
      userName: currentUser?.name || userRole || "unknown",
    };
  }, [userRole, currentBrandId, activeView, currentUser]);

  const getStableReadMeta = useCallback((label = "") => ({
    label,
    ...readMetaRef.current,
  }), []);

  const handleSwitchBrand = (brandId) => { setCurrentBrandId(brandId); setHasSelectedBrand(true); };

  const getCollectionPath = useCallback((collectionName) => {
    return currentBrand.pathType === 'legacy' ? collection(db, "artifacts", appId, "public", "data", collectionName) : collection(db, "brands", currentBrand.id, collectionName);
  }, [currentBrand]);

  const getDocPath = useCallback((docName) => {
    return currentBrand.pathType === 'legacy' ? doc(db, "artifacts", appId, "public", "data", "global_settings", docName) : doc(db, "brands", currentBrand.id, "settings", docName);
  }, [currentBrand]);

  const getSecuritySummaryDocPath = useCallback((docName = "device_alerts") => {
    return currentBrand.pathType === "legacy"
      ? doc(db, "artifacts", appId, "public", "data", "security_summary", docName)
      : doc(db, "brands", currentBrand.id, "security_summary", docName);
  }, [currentBrand]);

  const refreshDeviceAlertSummary = useCallback(async () => {
    if (!user || !["director", "master"].includes(userRole)) {
      setDeviceAlertSummary({
        pendingNewDeviceCount: 0,
        latestUserName: "",
        latestDevice: "",
        latestAtText: "",
      });
      return;
    }

    try {
      const snap = await getDoc(getSecuritySummaryDocPath("device_alerts"));
      if (snap.exists()) {
        setDeviceAlertSummary({
          pendingNewDeviceCount: Number(snap.data()?.pendingNewDeviceCount || 0),
          latestUserName: snap.data()?.latestUserName || "",
          latestDevice: snap.data()?.latestDevice || "",
          latestAtText: snap.data()?.latestAtText || snap.data()?.updatedAtText || "",
        });
      } else {
        setDeviceAlertSummary({
          pendingNewDeviceCount: 0,
          latestUserName: "",
          latestDevice: "",
          latestAtText: "",
        });
      }
    } catch (error) {
      console.warn("讀取新裝置提醒摘要失敗:", error);
    }
  }, [user, userRole, getSecuritySummaryDocPath]);

  useEffect(() => {
    refreshDeviceAlertSummary();
  }, [refreshDeviceAlertSummary, activeView, currentBrandId]);

  const goToDeviceManagement = useCallback(() => {
    setActiveView("logs");
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent("cyj_open_device_management"));
      } catch (error) {
        console.warn("open device management event failed", error);
      }
    }, 120);
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {};
      if (!detail.deviceShort && !detail.deviceId) return;

      if (detail.resolvedPending && (detail.status === "trusted" || detail.trusted === true)) {
        setDeviceAlertSummary((prev) => ({
          ...prev,
          pendingNewDeviceCount: Math.max(0, Number(prev.pendingNewDeviceCount || 0) - 1),
        }));
      }

      setCurrentDeviceTrust((prev) => {
        const isSameDevice =
          (detail.deviceId && prev.deviceId && detail.deviceId === prev.deviceId) ||
          (detail.deviceShort && prev.deviceShort && detail.deviceShort === prev.deviceShort);

        if (!isSameDevice) return prev;

        const isBlocked = detail.status === "blocked" || detail.source === "manual_blocked";
        const isTrusted = detail.status === "trusted" || detail.trusted === true;
        return {
          ...prev,
          status: isBlocked ? "blocked" : (isTrusted ? "trusted" : "new"),
          label: isBlocked ? "⛔ 裝置已封鎖" : (isTrusted ? "🛡 目前裝置已信任" : "⚠ 新裝置待觀察"),
          deviceShort: detail.deviceShort || prev.deviceShort,
          deviceId: detail.deviceId || prev.deviceId,
        };
      });
    };

    window.addEventListener("cyj_device_trust_updated", handler);
    return () => window.removeEventListener("cyj_device_trust_updated", handler);
  }, []);

  useEffect(() => {
    const handleDashboardViewModeChanged = (event) => {
      const nextMode = event?.detail?.viewMode;
      if (nextMode === "store" || nextMode === "therapist") {
        setDashboardViewMode((prev) => (prev === nextMode ? prev : nextMode));
      }
    };

    window.addEventListener("cyj_dashboard_view_mode_changed", handleDashboardViewModeChanged);
    return () => window.removeEventListener("cyj_dashboard_view_mode_changed", handleDashboardViewModeChanged);
  }, []);

  useEffect(() => {
    const handleStoreAnalysisStoreChanged = (event) => {
      const nextStore = String(event?.detail?.selectedStore || "").trim();
      setStoreAnalysisSelectedStore((prev) => (prev === nextStore ? prev : nextStore));
    };

    window.addEventListener("cyj_store_analysis_selected_store_changed", handleStoreAnalysisStoreChanged);
    return () => window.removeEventListener("cyj_store_analysis_selected_store_changed", handleStoreAnalysisStoreChanged);
  }, []);

  const [rawData, setRawData] = useState([]); 
  const [annualAggregatedData, setAnnualAggregatedData] = useState([]); 
  const [annualDashboardSummaries, setAnnualDashboardSummaries] = useState([]);
  const [annualSummaryStatusMap, setAnnualSummaryStatusMap] = useState({});
  const [therapistAnnualAggregatedData, setTherapistAnnualAggregatedData] = useState([]); // ★新增：管理師專屬結算包
  const [budgets, setBudgets] = useState({});
  const [monthlyTargetSummary, setMonthlyTargetSummary] = useState(null); // ★ monthly_targets_summary/{yearMonth}：Dashboard 目標資料輕量即時來源
  const [currentDashboardSummary, setCurrentDashboardSummary] = useState(null); // ★ 報表 summary-first：Ranking / Regional 優先使用此資料
  const [currentRankingsSummary, setCurrentRankingsSummary] = useState(null);
  const [currentReportSummaryReady, setCurrentReportSummaryReady] = useState(false);
  const [targets, setTargets] = useState({ newASP: 3500, trafficASP: 1200 });
  const [managers, setManagers] = useState({});
  const [managerOrder, setManagerOrder] = useState([]); // ★ 穩定區長排序來源：org_structure.managerOrder
  const [storeAccounts, setStoreAccounts] = useState([]);
  const [managerAuth, setManagerAuth] = useState({});
  const [permissions, setPermissions] = useState(DEFAULT_PERMISSIONS);
  const [therapists, setTherapists] = useState([]);
  const [directorAuth, setDirectorAuth] = useState({});
  const [trainerAuth, setTrainerAuth] = useState(normalizeTrainerAuthData({ password: "0000" }));
  const [masterAuth, setMasterAuth] = useState({ password: "BOSS888" });
  const [therapistReports, setTherapistReports] = useState([]); 
  const [therapistSchedules, setTherapistSchedules] = useState({}); 
  const [therapistTargets, setTherapistTargets] = useState({}); 
  const [auditExclusions, setAuditExclusions] = useState([]);

  const [securityConfig, setSecurityConfig] = useState(DEFAULT_SECURITY_CONFIG);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState((new Date().getMonth() + 1).toString());

  const directorLevel = currentUser?.directorLevel || currentUser?.adminLevel || (userRole === "director" && String(currentUser?.name || "").includes("Joe") ? "super_admin" : "operation_admin");
  const directorPermissionProfile = userRole === "director"
    ? (DIRECTOR_VIEW_PERMISSIONS[directorLevel] || DIRECTOR_VIEW_PERMISSIONS.operation_admin)
    : null;

  const canDirectorAccessView = useCallback((viewId) => {
    if (userRole !== "director") return true;
    if (currentUser?.isMasterLogin === true) return true;
    const profile = DIRECTOR_VIEW_PERMISSIONS[directorLevel] || DIRECTOR_VIEW_PERMISSIONS.operation_admin;
    if (!profile.allowedViews) return true;
    return profile.allowedViews.has(viewId);
  }, [userRole, currentUser?.isMasterLogin, directorLevel]);

  const handleProtectedSetActiveView = useCallback((nextView) => {
    if (!canDirectorAccessView(nextView)) {
      const viewLabel = DIRECTOR_RESTRICTED_VIEWS[nextView] || VIEW_ACTIVITY_LABELS[nextView] || "此功能";
      setToast({
        message: `${directorPermissionProfile?.label || "目前權限"}無法使用「${viewLabel}」`,
        type: "error",
      });
      setActiveView("dashboard");
      return;
    }
    setActiveView(nextView);
  }, [canDirectorAccessView, directorPermissionProfile?.label]);

  useEffect(() => {
    if (!userRole || userRole !== "director") return;
    if (canDirectorAccessView(activeView)) return;

    const viewLabel = DIRECTOR_RESTRICTED_VIEWS[activeView] || VIEW_ACTIVITY_LABELS[activeView] || "此功能";
    setToast({
      message: `${directorPermissionProfile?.label || "目前權限"}無法使用「${viewLabel}」`,
      type: "error",
    });
    setActiveView("dashboard");
  }, [activeView, userRole, canDirectorAccessView, directorPermissionProfile?.label]);

  const selectedYearMonth = useMemo(() => {
    const y = String(selectedYear || "");
    const m = String(selectedMonth || "").padStart(2, "0");
    return y && m ? `${y}-${m}` : "";
  }, [selectedYear, selectedMonth]);

  const [inputDate, setInputDate] = useState(() => formatLocalYYYYMMDD(new Date()));

  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [isLowPowerMode, setIsLowPowerMode] = useState(false);
  const lastActivityTimeRef = useRef(Date.now()); 
  const isWarningShowingRef = useRef(false);
  const lowPowerToastShownRef = useRef(false);
  const pageViewLogThrottleRef = useRef({});
  const loginSessionLocationRef = useRef(UNKNOWN_LOGIN_LOCATION);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleStayLoggedIn = useCallback(() => {
    lastActivityTimeRef.current = Date.now();
    isWarningShowingRef.current = false; 
    setShowIdleWarning(false);           
    setCountdown(securityConfig.logoutWarningSeconds || securityConfig.warningSeconds || 60);
  }, [securityConfig]);

  const handleUserActivity = useCallback(() => {

  if (!userRole) return;

    if (isLowPowerMode) {
      setIsLowPowerMode(false);
      trackReadSource("low_power_resume_by_activity", 0, getReadMeta("low_power_resume_by_activity"));
    }

    if (isWarningShowingRef.current) return;
    lastActivityTimeRef.current = Date.now();
  }, [userRole, isLowPowerMode, getReadMeta]); 

  const resolveLoginLocation = useCallback(async (payload = {}) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(LOGIN_LOCATION_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(removeUndefinedDeep({
          brandId: currentBrandId,
          brandLabel: currentBrand?.label || currentBrandId,
          role: payload.role || "",
          userName: payload.userName || "",
          deviceShort: payload.deviceInfo?.deviceShort || "",
        })),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) return UNKNOWN_LOGIN_LOCATION;
      const data = await response.json();
      return normalizeLoginLocationPayload(data?.location || {});
    } catch (error) {
      console.warn("登入位置解析失敗:", error?.message || error);
      return UNKNOWN_LOGIN_LOCATION;
    }
  }, [currentBrandId, currentBrand]);

  const logActivity = useCallback(async (role, user, action, details) => {
    if (!isOnline) return; 

    const detailPayload = details && typeof details === "object" && !Array.isArray(details) ? details : { message: details || "" };
    const clientDeviceInfo = getClientDeviceInfo();
    const loginLocation = normalizeLoginLocationPayload(
      detailPayload?.loginLocation ||
      detailPayload?.deviceInfo?.loginLocation ||
      loginSessionLocationRef.current ||
      UNKNOWN_LOGIN_LOCATION
    );

    const device = detailPayload?.deviceInfo?.device || clientDeviceInfo.device;
    const browser = detailPayload?.deviceInfo?.browser || clientDeviceInfo.browser;
    const os = detailPayload?.deviceInfo?.os || clientDeviceInfo.os;
    const deviceId = detailPayload?.deviceInfo?.deviceId || clientDeviceInfo.deviceId;
    const deviceShort = detailPayload?.deviceInfo?.deviceShort || clientDeviceInfo.deviceShort;
    const activityType = detailPayload.activityType || detailPayload.type || (
      action === "登入系統" ? "auth.login" :
      action === "登出系統" ? "auth.logout" :
      action.includes("查詢") ? "query" :
      action.includes("修改") || action.includes("更新") || action.includes("刪除") || action.includes("封存") || action.includes("還原") ? "data.change" :
      "general"
    );

    try { 
      const logRef = await addDoc(getCollectionPath("system_logs"), {
        timestamp: serverTimestamp(),
        createdAtText: new Date().toISOString(),
        role,
        user,
        action,
        details: removeUndefinedDeep({ ...detailPayload, loginLocation }),
        loginLocation: removeUndefinedDeep(loginLocation),
        activityType,
        view: detailPayload.view || activeView || "",
        device,
        browser,
        os,
        deviceId,
        deviceShort,
        isNewDevice: Boolean(detailPayload.isNewDevice),
        deviceTrusted: detailPayload.deviceTrusted ?? null,
        riskTags: detailPayload.riskTags || [],
        brand: currentBrandId,
        brandLabel: currentBrand?.label || currentBrandId,
      }); 
      if (action === "登入系統") {
        const todayStr = formatLocalYYYYMMDD(new Date());
        await setDoc(doc(getCollectionPath("system_stats"), todayStr), { count: increment(1), updatedAt: serverTimestamp() }, { merge: true });
      }
      return logRef;
    } catch (e) {
      console.error("Failed to log activity", e);
      return null;
    }
  }, [getCollectionPath, currentBrandId, currentBrand, activeView, isOnline]);

  const logDeviceCheckResult = useCallback(async (roleId, userName, deviceSecurity = {}, fallbackDeviceInfo = null) => {
    if (!isOnline) return;

    const info = deviceSecurity.deviceInfo || fallbackDeviceInfo || getClientDeviceInfo();
    const loginLocation = normalizeLoginLocationPayload(deviceSecurity.loginLocation || info.loginLocation || UNKNOWN_LOGIN_LOCATION);
    const isFailed = deviceSecurity.deviceStatus === "check_failed" || deviceSecurity.error;
    const activityType = isFailed ? "auth.device_check_failed" : "auth.device_check";
    const message = isFailed
      ? "裝置檢查失敗，但登入紀錄已保留"
      : deviceSecurity.isNewDevice
        ? (deviceSecurity.autoTrusted ? "初始信任裝置已建立" : "偵測到新裝置登入")
        : "已辨識信任裝置";

    const detailPayload = {
      activityType,
      message,
      deviceInfo: { ...info, loginLocation },
      loginLocation,
      isNewDevice: Boolean(deviceSecurity.isNewDevice),
      deviceTrusted: deviceSecurity.deviceTrusted ?? null,
      autoTrusted: Boolean(deviceSecurity.autoTrusted),
      alertCreated: Boolean(deviceSecurity.alertCreated),
      riskTags: deviceSecurity.riskTags || [],
      deviceStatus: deviceSecurity.deviceStatus || (isFailed ? "check_failed" : "checked"),
      deviceShort: info?.deviceShort,
      trustedDeviceCountBefore: deviceSecurity.trustedDeviceCountBefore ?? null,
      ...(deviceSecurity.error ? { error: deviceSecurity.error } : {}),
    };

    try {
      await addDoc(getCollectionPath("system_logs"), {
        timestamp: serverTimestamp(),
        createdAtText: new Date().toISOString(),
        role: roleId,
        user: userName,
        action: "裝置安全檢查",
        details: removeUndefinedDeep(detailPayload),
        loginLocation: removeUndefinedDeep(loginLocation),
        activityType,
        view: activeView || "",
        device: info.device,
        browser: info.browser,
        os: info.os,
        deviceId: info.deviceId,
        deviceShort: info.deviceShort,
        isNewDevice: Boolean(deviceSecurity.isNewDevice),
        deviceTrusted: deviceSecurity.deviceTrusted ?? null,
        riskTags: deviceSecurity.riskTags || [],
        brand: currentBrandId,
        brandLabel: currentBrand?.label || currentBrandId,
      });
    } catch (error) {
      console.warn("裝置安全檢查紀錄寫入失敗:", error);
    }
  }, [isOnline, getCollectionPath, currentBrandId, currentBrand, activeView]);


  const registerAccountDevice = useCallback(async (roleId, userInfo = {}) => {
    if (!isOnline || !roleId) {
      return { deviceInfo: getClientDeviceInfo(), isNewDevice: false, riskTags: [] };
    }

    const deviceInfo = getClientDeviceInfo();
    const accountId = sanitizeSecurityKey(userInfo?.id || userInfo?.accountId || userInfo?.name || roleId);
    const userName = userInfo?.name || (roleId === "director" ? "高階主管" : (roleId === "trainer" ? "教專" : "未知"));
    const loginLocation = await resolveLoginLocation({ role: roleId, userName, deviceInfo });
    loginSessionLocationRef.current = loginLocation;
    deviceInfo.loginLocation = loginLocation;
    const accountKey = sanitizeSecurityKey(`${currentBrandId}_${roleId}_${accountId}`);
    const nowText = new Date().toISOString();

    try {
      const deviceProfileRef = doc(getCollectionPath("account_devices"), accountKey);
      const profileSnap = await getDoc(deviceProfileRef);
      const profileData = profileSnap.exists() ? profileSnap.data() : {};
      const devices = profileData.devices || {};

      const exactExistingDevice = devices[deviceInfo.deviceId];
      const recoveredKnownDevice = exactExistingDevice ? null : findRecoverableKnownDeviceEntry(devices, deviceInfo, loginLocation);
      const recoveredDeviceId = recoveredKnownDevice?.storedDeviceId || "";
      const originalDeviceId = deviceInfo.deviceId;
      const originalDeviceShort = deviceInfo.deviceShort;

      if (recoveredDeviceId && recoveredDeviceId !== deviceInfo.deviceId) {
        persistStableClientDeviceId(recoveredDeviceId);
        deviceInfo.previousDeviceId = originalDeviceId;
        deviceInfo.previousDeviceShort = originalDeviceShort;
        deviceInfo.deviceId = recoveredDeviceId;
        deviceInfo.stableDeviceId = recoveredDeviceId;
        deviceInfo.deviceShort = String(recoveredDeviceId || "").replace(/^dev_/, "").slice(-8);
        deviceInfo.recoveredKnownDevice = true;
        deviceInfo.recoveredFromDeviceId = originalDeviceId;
      }

      const globalBlockKeys = Array.from(new Set([
        sanitizeSecurityKey(`${roleId}_${accountId}_${originalDeviceId}`),
        sanitizeSecurityKey(`${roleId}_${accountId}_${deviceInfo.deviceId}`),
      ])).filter(Boolean);

      const globalBlockSnaps = await Promise.all(
        globalBlockKeys.map((key) => getDoc(doc(db, "artifacts", appId, "public", "data", "global_blocked_devices", key)))
      );

      const activeGlobalBlockSnap = globalBlockSnaps.find((snap) => {
        if (!snap.exists()) return false;
        const data = snap.data() || {};
        return data.active !== false &&
          ["blocked", "global_blocked", "manual_global_blocked"].includes(String(data.status || data.source || ""));
      });

      if (activeGlobalBlockSnap) {
        const globalBlockData = activeGlobalBlockSnap.data() || {};
        const result = {
          allowed: false,
          blocked: true,
          globalBlocked: true,
          reason: "global_device_blocked",
          message: "此裝置已被全品牌封鎖，請聯繫主管。",
          deviceInfo,
          existingDevice: globalBlockData,
          isNewDevice: false,
          deviceTrusted: false,
          autoTrusted: false,
          alertCreated: false,
          riskTags: ["全品牌裝置封鎖"],
          deviceStatus: "blocked",
        };
        logDeviceCheckResult(roleId, userName, result, deviceInfo);
        return result;
      }

      const existingDevice = exactExistingDevice || recoveredKnownDevice?.item || null;

      if (existingDevice?.status === "blocked" || existingDevice?.source === "manual_blocked") {
        const result = {
          allowed: false,
          blocked: true,
          globalBlocked: false,
          reason: "device_blocked",
          message: "此裝置已被封鎖，請聯繫主管。",
          deviceInfo,
          existingDevice,
          isNewDevice: false,
          deviceTrusted: false,
          autoTrusted: false,
          alertCreated: false,
          riskTags: ["裝置已封鎖"],
          deviceStatus: "blocked",
        };
        logDeviceCheckResult(roleId, userName, result, deviceInfo);
        return result;
      }

      if (existingDevice) {
        const updatedDevice = {
          ...existingDevice,
          device: deviceInfo.device,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          deviceShort: deviceInfo.deviceShort,
          stableDeviceId: deviceInfo.stableDeviceId || deviceInfo.deviceId,
          deviceFingerprint: deviceInfo.deviceFingerprint,
          deviceStorageStatus: deviceInfo.deviceStorageStatus,
          recoveredKnownDevice: Boolean(deviceInfo.recoveredKnownDevice || existingDevice.recoveredKnownDevice),
          recoveredFromDeviceIds: deviceInfo.recoveredFromDeviceId
            ? Array.from(new Set([...(existingDevice.recoveredFromDeviceIds || []), deviceInfo.recoveredFromDeviceId]))
            : (existingDevice.recoveredFromDeviceIds || []),
          lastSeenAt: serverTimestamp(),
          lastSeenAtText: nowText,
          loginCount: Number(existingDevice.loginCount || 0) + 1,
          loginLocation,
          lastLoginLocation: loginLocation,
          locationUpdatedAtText: nowText,
        };

        await setDoc(deviceProfileRef, {
          brandId: currentBrandId,
          brandLabel: currentBrand?.label || currentBrandId,
          role: roleId,
          accountId,
          userName,
          updatedAt: serverTimestamp(),
          updatedAtText: nowText,
          devices: {
            ...devices,
            [deviceInfo.deviceId]: updatedDevice,
          },
        }, { merge: true });

        const result = {
          deviceInfo,
          isNewDevice: false,
          deviceTrusted: existingDevice.trusted !== false,
          autoTrusted: false,
          alertCreated: false,
          riskTags: deviceInfo.recoveredKnownDevice ? ["疑似原裝置已自動沿用"] : [],
          deviceStatus: existingDevice.status || (existingDevice.trusted === false ? "new" : "trusted"),
          loginLocation,
        };
        logDeviceCheckResult(roleId, userName, result, deviceInfo);
        return result;
      }

      const trustedDeviceCount = Object.values(devices || {}).filter((item) => item?.trusted !== false && item?.status !== "new").length;
      const autoTrusted = trustedDeviceCount < SECURITY_DEVICE_CONFIG.autoTrustLimit;
      const shouldAlert = !autoTrusted && SECURITY_DEVICE_CONFIG.alertRoles.includes(roleId);
      const riskTags = autoTrusted ? ["初始信任裝置"] : ["新裝置"];

      const newDeviceRecord = {
        deviceId: deviceInfo.deviceId,
        deviceShort: deviceInfo.deviceShort,
        stableDeviceId: deviceInfo.stableDeviceId || deviceInfo.deviceId,
        deviceFingerprint: deviceInfo.deviceFingerprint,
        deviceStorageStatus: deviceInfo.deviceStorageStatus,
        device: deviceInfo.device,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        trusted: autoTrusted,
        status: autoTrusted ? "trusted" : "new",
        source: autoTrusted ? "auto_trust_first_two_devices" : "new_device_detected",
        firstSeenAt: serverTimestamp(),
        firstSeenAtText: nowText,
        lastSeenAt: serverTimestamp(),
        lastSeenAtText: nowText,
        loginCount: 1,
        loginLocation,
        firstLoginLocation: loginLocation,
        lastLoginLocation: loginLocation,
        locationUpdatedAtText: nowText,
      };

      await setDoc(deviceProfileRef, {
        brandId: currentBrandId,
        brandLabel: currentBrand?.label || currentBrandId,
        role: roleId,
        accountId,
        userName,
        updatedAt: serverTimestamp(),
        updatedAtText: nowText,
        devices: {
          ...devices,
          [deviceInfo.deviceId]: newDeviceRecord,
        },
      }, { merge: true });

      if (shouldAlert) {
        await addDoc(getCollectionPath("security_alerts"), {
          type: "new_device_login",
          severity: roleId === "director" ? "high" : "medium",
          status: "unread",
          brandId: currentBrandId,
          brandLabel: currentBrand?.label || currentBrandId,
          role: roleId,
          accountId,
          userName,
          deviceId: deviceInfo.deviceId,
          deviceShort: deviceInfo.deviceShort,
          device: deviceInfo.device,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          loginLocation: removeUndefinedDeep(loginLocation),
          trustedDeviceCountBefore: trustedDeviceCount,
          message: `${userName} 出現新裝置登入`,
          createdAt: serverTimestamp(),
          createdAtText: nowText,
        });

        await setDoc(getSecuritySummaryDocPath("device_alerts"), {
          pendingNewDeviceCount: increment(1),
          latestUserName: userName,
          latestRole: roleId,
          latestDevice: `${deviceInfo.device} / ${deviceInfo.browser || "-"}`,
          latestDeviceShort: deviceInfo.deviceShort,
          latestAt: serverTimestamp(),
          latestAtText: nowText,
          updatedAt: serverTimestamp(),
          updatedAtText: nowText,
          brandId: currentBrandId,
          brandLabel: currentBrand?.label || currentBrandId,
        }, { merge: true });
      }

      const result = {
        deviceInfo,
        isNewDevice: true,
        deviceTrusted: autoTrusted,
        autoTrusted,
        alertCreated: shouldAlert,
        trustedDeviceCountBefore: trustedDeviceCount,
        riskTags,
        deviceStatus: autoTrusted ? "trusted" : "new",
        loginLocation,
      };
      logDeviceCheckResult(roleId, userName, result, deviceInfo);
      return result;
    } catch (error) {
      console.warn("registerAccountDevice failed:", error);
      const result = {
        deviceInfo,
        isNewDevice: false,
        deviceTrusted: null,
        autoTrusted: false,
        alertCreated: false,
        riskTags: ["裝置檢查失敗"],
        deviceStatus: "check_failed",
        loginLocation: UNKNOWN_LOGIN_LOCATION,
        error: error.message,
      };
      logDeviceCheckResult(roleId, userName, result, deviceInfo);
      return result;
    }
  }, [isOnline, currentBrandId, currentBrand, getCollectionPath, getSecuritySummaryDocPath, logDeviceCheckResult, resolveLoginLocation]);

  useEffect(() => {
    if (!userRole || !currentUser || !activeView) return;
    if (!IMPORTANT_PAGE_VIEW_SET.has(activeView)) return;

    const userName = currentUser?.name || (userRole === "director" ? "高階主管" : (userRole === "trainer" ? "教專" : userRole));
    const throttleKey = `${currentBrandId}_${userRole}_${userName}_${activeView}`;
    const now = Date.now();
    const lastAt = Number(pageViewLogThrottleRef.current[throttleKey] || 0);

    // 同一使用者、同品牌、同頁面 5 分鐘內只記一次，避免頁面切換或重整造成 system_logs 爆量。
    if (now - lastAt < 5 * 60 * 1000) return;
    pageViewLogThrottleRef.current[throttleKey] = now;

    logActivity(userRole, userName, "頁面瀏覽", {
      activityType: "page.view",
      view: activeView,
      viewLabel: VIEW_ACTIVITY_LABELS[activeView] || activeView,
      brandId: currentBrandId,
      brandLabel: currentBrand?.label || currentBrandId,
      path: typeof window !== "undefined" ? window.location.pathname : "",
      loginLocation: loginSessionLocationRef.current || UNKNOWN_LOGIN_LOCATION,
    });
  }, [activeView, userRole, currentUser, currentBrandId, currentBrand, logActivity]);


  const handleLogout = useCallback(async (reason = "使用者手動登出") => {
    const userName = currentUser?.name || (userRole === "director" ? "高階主管" : (userRole === "trainer" ? "教專" : "未知"));
    if (userRole) logActivity(userRole, userName, "登出系統", {
      message: reason,
      loginLocation: loginSessionLocationRef.current || UNKNOWN_LOGIN_LOCATION,
    });
    loginSessionLocationRef.current = UNKNOWN_LOGIN_LOCATION;
    
    isWarningShowingRef.current = false; 
    setShowIdleWarning(false); 
    setCountdown(securityConfig.logoutWarningSeconds || securityConfig.warningSeconds || 60); 
    lastActivityTimeRef.current = Date.now(); 
    
    localStorage.removeItem("cyj_input_draft"); localStorage.removeItem("cyj_input_draft_v2"); localStorage.removeItem("cyj_input_draft_v3"); 
    localStorage.removeItem("cyj_therapist_draft"); localStorage.removeItem("cyj_therapist_draft_v2");
    
    setCurrentDeviceTrust({
      status: "checking",
      label: "裝置狀態確認中",
      deviceShort: "",
      deviceId: "",
    });
    setUserRole(null); setCurrentUser(null); setActiveView("dashboard");
  }, [currentUser, userRole, logActivity, securityConfig]);

  useEffect(() => {
    const globalVersionRef = doc(db, "artifacts", appId, "public", "data", "global_settings", "system_version");

    const checkAndExecuteUpdate = (remoteVersion) => {
      if (remoteVersion && isOlderVersion(CURRENT_APP_VERSION, remoteVersion)) {
        
        // ★ 新增防爆鎖：利用 sessionStorage 紀錄重整次數
        const updateAttempts = parseInt(sessionStorage.getItem('cyj_update_attempts') || '0');
        
        if (updateAttempts >= 3) {
            // 如果已經自動重整 3 次還是舊版，代表快取卡死。停止無限迴圈，凍結畫面。
            setIsUpdating(true);
            // 可以在這裡加入一段特殊 UI 狀態，但在 App.jsx 現有架構下，
            // 只要我們 `return` 不執行 window.location.replace，就能阻止無窮讀取。
            console.error("快取清除失敗，請手動強制重新整理網頁");
            return; 
        }

        // 紀錄重整次數 +1
        sessionStorage.setItem('cyj_update_attempts', (updateAttempts + 1).toString());
        setIsUpdating(true);

        localStorage.removeItem("cyj_input_draft");
        localStorage.removeItem("cyj_input_draft_v2");
        localStorage.removeItem("cyj_input_draft_v3");
        localStorage.removeItem("cyj_therapist_draft");
        localStorage.removeItem("cyj_therapist_draft_v2");
        
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then((registrations) => {
            for (let registration of registrations) registration.unregister();
          }).catch(err => console.warn('SW unregister error', err));
        }
        
        setTimeout(() => {
          const currentUrl = window.location.href.split('?')[0]; 
          const newUrl = `${currentUrl}?v=${new Date().getTime()}`;
          window.location.replace(newUrl);
        }, 3000);
      } else {
        // 如果版本已經正確，清除重整計數器
        sessionStorage.removeItem('cyj_update_attempts');
      }
    };

    const unsubVersion = onSnapshot(globalVersionRef, (s) => {
      if (s.exists()) checkAndExecuteUpdate(s.data().version);
    });

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && isOnline) {
        try {
          const s = await getDoc(globalVersionRef);
          if (s.exists()) checkAndExecuteUpdate(s.data().version);
        } catch (e) {
          console.warn("Wake up version check failed", e);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      unsubVersion();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isOnline]); 

  useEffect(() => {
    if (userRole === 'director' || userRole === 'master') {
      const globalVersionRef = doc(db, "artifacts", appId, "public", "data", "global_settings", "system_version");
      getDoc(globalVersionRef).then(s => {
         const remoteVersion = s.exists() ? s.data().version : null;
         if (!remoteVersion || isNewerVersion(CURRENT_APP_VERSION, remoteVersion)) {
            setDoc(globalVersionRef, { version: CURRENT_APP_VERSION }, { merge: true });
         }
      }).catch(e => console.warn("Broadcast failed", e));
    }
  }, [userRole]);

  useEffect(() => {
    let intervalId = null;

    if (userRole) {
      intervalId = setInterval(() => {
        const now = Date.now();
        const elapsed = now - lastActivityTimeRef.current;

        const lowPowerEnabled = securityConfig.lowPowerEnabled !== false;
        const lowPowerThreshold = Math.max(1, Number(securityConfig.lowPowerIdleMinutes || 30)) * 60 * 1000;

        if (lowPowerEnabled && !isLowPowerMode && elapsed > lowPowerThreshold) {
          setIsLowPowerMode(true);
          trackReadSource("low_power_mode_enter", 0, {
            ...getReadMeta("low_power_mode_enter"),
            idleMinutes: securityConfig.lowPowerIdleMinutes || 30,
          });
        }

        const autoLogoutEnabled = securityConfig.autoLogoutEnabled ?? securityConfig.enabled ?? true;
        const isExempt = securityConfig.exemptRoles?.includes(userRole) || userRole === 'director' || userRole === 'master';

        if (!autoLogoutEnabled || isExempt) return;

        const logoutMinutes = Math.max(1, Number(securityConfig.autoLogoutMinutes || securityConfig.timeoutMinutes || 240));
        const warningSeconds = Math.max(5, Number(securityConfig.logoutWarningSeconds || securityConfig.warningSeconds || 60));

        const LOGOUT_THRESHOLD = logoutMinutes * 60 * 1000;
        const WARNING_THRESHOLD = LOGOUT_THRESHOLD - (warningSeconds * 1000);

        if (elapsed > LOGOUT_THRESHOLD) {
          clearInterval(intervalId);
          handleLogout(`閒置超過 ${logoutMinutes} 分鐘自動登出`);
        } else if (elapsed > WARNING_THRESHOLD) {
          if (!isWarningShowingRef.current) {
            isWarningShowingRef.current = true;
            setShowIdleWarning(true);
          }
          const remaining = Math.ceil((LOGOUT_THRESHOLD - elapsed) / 1000);
          setCountdown(remaining > 0 ? remaining : 0);
        } else {
          if (isWarningShowingRef.current) {
            isWarningShowingRef.current = false;
            setShowIdleWarning(false);
          }
        }
      }, 1000);
    }

    return () => { if (intervalId) clearInterval(intervalId); };
  }, [userRole, handleLogout, securityConfig, isLowPowerMode, getReadMeta]);

  useEffect(() => {
    if (userRole) {
      const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart', 'click'];
      let activityTimeout;
      const throttledActivity = () => { 
        if (!activityTimeout) { 
          handleUserActivity(); 
          activityTimeout = setTimeout(() => { activityTimeout = null; }, 500); 
        } 
      };
      events.forEach(event => window.addEventListener(event, throttledActivity));
      lastActivityTimeRef.current = Date.now();
      return () => { events.forEach(event => window.removeEventListener(event, throttledActivity)); };
    }
  }, [userRole, handleUserActivity]);

  const normalizeStore = useCallback((s) => {
      let core = String(s || "").replace(/^(CYJ|Anew\s*\(安妞\)|Yibo\s*\(伊啵\)|安妞|伊啵|Anew|Yibo)\s*/i, '').trim();
      if (core === "新店") return "新店"; 
      return core.replace(/店$/, '').trim();
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try { if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) { await signInWithCustomToken(auth, __initial_auth_token); } else { await signInAnonymously(auth); } } catch (error) { console.warn("Auth Error:", error); }
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
  }, []);

  const fetchGlobalData = useCallback(async () => {
    if (!user) return;
    try {
      const [orgSnap, accSnap, mAuthSnap, permSnap, thSnap, trAuthSnap, audSnap, secSnap, dAuthSnap, mastSnap] = await Promise.all([
        getDoc(getDocPath("org_structure")),
        getDoc(getDocPath("store_account_data")),
        getDoc(getDocPath("manager_auth")),
        getDoc(getDocPath("permissions")),
        getDocs(getCollectionPath("therapists")),
        getDoc(getDocPath("trainer_auth")),
        getDoc(getDocPath("audit_exclusions")),
        getDoc(getDocPath("security_config")),
        getDoc(getDocPath("director_auth")),
        getDoc(getDocPath("master_auth"))
      ]);

      trackReadSource("fetchGlobalData_core_docs", 9, getStableReadMeta("fetchGlobalData_core_docs"));
      trackReadSource("fetchGlobalData_therapists", thSnap.docs.length, getStableReadMeta("fetchGlobalData_therapists"));

      if (orgSnap.exists()) {
        const orgData = orgSnap.data() || {};
        const rawManagers = orgData.managers || {};
        const rawManagerOrder = Array.isArray(orgData.managerOrder) ? orgData.managerOrder : [];
        // 保留「未分配」在全域 managers state 中。
        // managerOrder 是穩定排序來源，避免 Firestore map / object key 順序造成每次登入排序不同。
        const normalizedManagerOrder = normalizeManagerOrder(rawManagers, rawManagerOrder);
        setManagers(rawManagers);
        setManagerOrder(normalizedManagerOrder);

        // 首次導入 v3 時，如果舊 org_structure 沒有 managerOrder，補上一份穩定排序來源。
        // 後續區長架構修改會由 SettingsView 持續維護此欄位。
        if (rawManagerOrder.length === 0 && (userRole === "director" || userRole === "master")) {
          setDoc(getDocPath("org_structure"), { managers: rawManagers, managerOrder: normalizedManagerOrder }, { merge: true })
            .catch((error) => console.warn("managerOrder backfill failed:", error));
        }
      } else {
        const fallbackManagers = currentBrand.id === 'cyj' ? DEFAULT_REGIONAL_MANAGERS : {};
        setManagers(fallbackManagers);
        setManagerOrder(normalizeManagerOrder(fallbackManagers));
      }

      setStoreAccounts(accSnap.exists() ? accSnap.data().accounts : []);
      setManagerAuth(mAuthSnap.exists() ? mAuthSnap.data() : {});
      setPermissions(permSnap.exists() ? permSnap.data() : DEFAULT_PERMISSIONS);
      setTherapists(thSnap.docs.map((d) => {
        const data = d.data() || {};
        const storeName = data.store || data.storeName || data.primaryStore || (Array.isArray(data.stores) ? data.stores[0] : "");
        const managerName = data.manager || data.managerName || data.region || data.area || "";
        return {
          id: d.id,
          ...data,
          store: storeName,
          storeName: data.storeName || storeName,
          manager: managerName,
          managerName: data.managerName || managerName,
          normalizedStoreCore: normalizeStore(storeName),
        };
      }));
      setTrainerAuth(normalizeTrainerAuthData(trAuthSnap.exists() ? trAuthSnap.data() : { password: "0000" }));
      setAuditExclusions(audSnap.exists() ? (audSnap.data().stores || []) : []);
      setSecurityConfig(secSnap.exists() ? normalizeSecurityConfig(secSnap.data()) : DEFAULT_SECURITY_CONFIG);

      if (dAuthSnap.exists()) {
         let data = normalizeDirectorAuthData(dAuthSnap.data());
         if (Object.keys(data.accounts || {}).length === 0) {
           data = normalizeDirectorAuthData({ "營運總監": "0000" });
         }
         setDirectorAuth(data);
      } else {
         let defaultPass = "0000";
         if (currentBrand.id === 'cyj') defaultPass = "16500"; if (currentBrand.id === 'anniu') defaultPass = "8888"; if (currentBrand.id === 'yibo') defaultPass = "9999";
         setDirectorAuth(normalizeDirectorAuthData({ "營運總監": defaultPass })); 
      }

      setMasterAuth((mastSnap.exists() && mastSnap.data().password) ? mastSnap.data() : { password: "BOSS888" });
    } catch (error) {
      console.error("Fetch Global Data Error:", error);
    }
  }, [user, currentBrand, getDocPath, getCollectionPath, getStableReadMeta, normalizeStore]);

  useEffect(() => {
    if (!user) return;

    const unsubReadTrackerConfig = onSnapshot(getDocPath("read_tracker_config"), (s) => {
      trackReadSource("read_tracker_config", s.exists() ? 1 : 0, getReadMeta("read_tracker_config"));
      const remoteConfig = s.exists() ? s.data() : { mode: "off" };
      readTrackerConfigRef.current = remoteConfig;

      const effectiveMode = resolveReadTrackerModeFromConfig(remoteConfig);
      const scheduleStatus = getReadTrackerScheduleStatus(remoteConfig);

      if (["off", "local", "global"].includes(effectiveMode)) {
        setReadTrackerMode(effectiveMode);
      }

      if (remoteConfig.scheduleEnabled) {
        console.info("[READ TRACKER SCHEDULE]", {
          effectiveMode,
          status: scheduleStatus.label,
          nowTime: scheduleStatus.nowTime,
          startTime: scheduleStatus.startTime,
          endTime: scheduleStatus.endTime,
        });
      }
    }, (error) => {
      console.warn("read tracker config sync failed", error);
    });

    return () => unsubReadTrackerConfig();
  }, [user, getDocPath, getReadMeta]);

  useEffect(() => {
    if (!user) return;

    const applyScheduledReadTrackerMode = () => {
      const remoteConfig = readTrackerConfigRef.current || { mode: "off" };
      const effectiveMode = resolveReadTrackerModeFromConfig(remoteConfig);

      if (["off", "local", "global"].includes(effectiveMode)) {
        setReadTrackerMode(effectiveMode);
      }
    };

    applyScheduledReadTrackerMode();
    const timer = setInterval(applyScheduledReadTrackerMode, 60 * 1000);
    return () => clearInterval(timer);
  }, [user]);

  const lowFrequencyCacheRef = useRef({});

  // ★ monthly_targets 穩定監聽：
  // 完整 monthly_targets 只在真正需要編輯 / 檢核年度目標時讀取，避免一般頁面每次讀全年約 400+ docs。
  // KPI 參數 kpi_targets 已拆成獨立 1-doc 常駐監聽，避免登出重登後回到預設值。
  
  // monthly_targets 第三階段節流：
  // Dashboard / Ranking / Annual 已優先使用 monthly_targets_summary 或 dashboard_summary。
  // 完整 monthly_targets 只在「年度目標設定」與「回報檢核 > 店家目標」這類必須編輯 / 核對完整目標資料的頁面才監聽。
  const shouldLoadMonthlyTargets =
    activeView === "targets" ||
    (activeView === "audit" && auditType === "target");

useEffect(() => {
    if (!shouldLoadMonthlyTargets) {
      // 非必要頁面不常駐監聽完整 monthly_targets，避免每次讀全年約 400+ docs。
      // 清空 budgets 可避免切品牌或離開目標頁後，用到舊品牌 / 舊年份快取造成達成率失真。
      setBudgets({});
      return undefined;
    }
    if (!user) return;

    const unsubBudgetTargets = onSnapshot(
      getCollectionPath("monthly_targets"),
      (budgetSnap) => {
        trackSnapshotRead("monthly_targets_live", budgetSnap, getStableReadMeta("monthly_targets_live"));
        const b = {};
        budgetSnap.docs.forEach((d) => (b[d.id] = d.data()));
        setBudgets(b);
      },
      (error) => console.error("monthly_targets 即時監聽失敗:", error)
    );

    return () => {
      try { unsubBudgetTargets && unsubBudgetTargets(); } catch (error) { console.warn("monthly_targets unsubscribe failed", error); }
    };
  }, [user, currentBrandId, getCollectionPath, shouldLoadMonthlyTargets, getStableReadMeta]);

  // ★ KPI 參數獨立常駐監聽：
  // kpi_targets 只有 1 doc，必須在登入 / 品牌切換後穩定讀回，避免登出重登後還原成預設值。
  useEffect(() => {
    if (!user) {
      setTargets({ newASP: 3500, trafficASP: 1200 });
      return undefined;
    }

    const unsubKpiTargets = onSnapshot(
      getDocPath("kpi_targets"),
      (kpiSnap) => {
        trackReadSource("kpi_targets_live", kpiSnap.exists() ? 1 : 0, getStableReadMeta("kpi_targets_live"));
        const data = kpiSnap.exists() ? kpiSnap.data() : {};
        setTargets({
          newASP: Number(data.newASP ?? 3500),
          trafficASP: Number(data.trafficASP ?? 1200),
        });
      },
      (error) => console.error("kpi_targets 即時監聽失敗:", error)
    );

    return () => {
      try { unsubKpiTargets && unsubKpiTargets(); } catch (error) { console.warn("kpi_targets unsubscribe failed", error); }
    };
  }, [user, currentBrandId, getDocPath, getStableReadMeta]);

  // ★ monthly_targets_summary 輕量即時監聽：
  // 監聽「目前選擇月份」的目標 Summary，供 Dashboard / Ranking / Annual 等一般分析頁使用。
  // 完整 monthly_targets 已改為必要頁面才讀，降低 monthly_targets_live 讀取量。
  useEffect(() => {
    if (!user || !selectedYearMonth) {
      setMonthlyTargetSummary(null);
      return;
    }

    const unsubMonthlyTargetSummary = onSnapshot(
      doc(getCollectionPath("monthly_targets_summary"), selectedYearMonth),
      (summarySnap) => {
        trackReadSource(
          "monthly_targets_summary_live",
          summarySnap.exists() ? 1 : 0,
          getStableReadMeta("monthly_targets_summary_live")
        );

        if (!summarySnap.exists()) {
          setMonthlyTargetSummary(null);
          return;
        }

        setMonthlyTargetSummary({
          id: summarySnap.id,
          ...summarySnap.data(),
        });
      },
      (error) => {
        console.error("monthly_targets_summary 即時監聽失敗:", error);
        setMonthlyTargetSummary(null);
      }
    );

    return () => {
      try { unsubMonthlyTargetSummary && unsubMonthlyTargetSummary(); } catch (error) { console.warn("monthly_targets_summary unsubscribe failed", error); }
    };
  }, [user, selectedYearMonth, currentBrand?.id, getCollectionPath, getStableReadMeta]);

  // ★ 報表 summary-first v1：
  // Ranking / Regional 優先讀 dashboard_summary / rankings_summary，不再一進頁面就讀整月 daily_reports。
  // 若 Summary 不存在，才允許 App 回退到明細監聽，保留正式營運數字安全性。
  useEffect(() => {
    if (!user || !selectedYearMonth) {
      setCurrentDashboardSummary(null);
      setCurrentRankingsSummary(null);
      setCurrentReportSummaryReady(false);
      return undefined;
    }

    let dashboardLoaded = false;
    let rankingsLoaded = false;

    const publishReady = () => {
      if (dashboardLoaded && rankingsLoaded) setCurrentReportSummaryReady(true);
    };

    setCurrentDashboardSummary(null);
    setCurrentRankingsSummary(null);
    setCurrentReportSummaryReady(false);

    const unsubDashboardSummary = onSnapshot(
      doc(getCollectionPath("dashboard_summary"), selectedYearMonth),
      (snap) => {
        trackReadSource("dashboard_summary_current_for_reports", snap.exists() ? 1 : 0, getStableReadMeta("dashboard_summary_current_for_reports"));
        setCurrentDashboardSummary(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        dashboardLoaded = true;
        publishReady();
      },
      (error) => {
        console.error("dashboard_summary 報表輕量監聽失敗:", error);
        setCurrentDashboardSummary(null);
        dashboardLoaded = true;
        publishReady();
      }
    );

    const unsubRankingsSummary = onSnapshot(
      doc(getCollectionPath("rankings_summary"), selectedYearMonth),
      (snap) => {
        trackReadSource("rankings_summary_current_for_reports", snap.exists() ? 1 : 0, getStableReadMeta("rankings_summary_current_for_reports"));
        setCurrentRankingsSummary(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        rankingsLoaded = true;
        publishReady();
      },
      (error) => {
        console.error("rankings_summary 報表輕量監聽失敗:", error);
        setCurrentRankingsSummary(null);
        rankingsLoaded = true;
        publishReady();
      }
    );

    return () => {
      try { unsubDashboardSummary && unsubDashboardSummary(); } catch (error) { console.warn("dashboard_summary report unsubscribe failed", error); }
      try { unsubRankingsSummary && unsubRankingsSummary(); } catch (error) { console.warn("rankings_summary report unsubscribe failed", error); }
    };
  }, [user, selectedYearMonth, currentBrand?.id, getCollectionPath, getStableReadMeta]);

  useEffect(() => {
    if (!user) return;

    setManagers({});
    setStoreAccounts([]);
    setManagerAuth({});
    setTherapists([]);
    setTherapistSchedules({});
    setTherapistTargets({});
    setPermissions(DEFAULT_PERMISSIONS);
    setSecurityConfig(DEFAULT_SECURITY_CONFIG);

    fetchGlobalData();
  }, [user, currentBrandId, fetchGlobalData]);

  useEffect(() => {
    if (!user) return;

    const targetYearStr = String(selectedYear);
    let isMounted = true;
    const lowFrequencyUnsubs = [];

    const fetchLowFrequencyData = async () => {
      try {
        const cacheTtlMs = 10 * 60 * 1000;
        const nowMs = Date.now();

        const shouldLoadSchedules = activeView === "t-schedule" || (activeView === "audit" && auditType === "therapist-daily");
        const shouldLoadTherapistTargets = activeView === "dashboard" || activeView === "t-targets" || (activeView === "audit" && auditType === "therapist-target");

        if (shouldLoadSchedules) {
          const scheduleCacheKey = `${currentBrand.id}_${targetYearStr}_therapist_schedules_v2`;
          const scheduleCached = lowFrequencyCacheRef.current[scheduleCacheKey];

          if (scheduleCached && scheduleCached.expiresAt > nowMs) {
            setTherapistSchedules(scheduleCached.data || {});
            trackReadSource("therapist_schedules_year_cache_hit", 0, getStableReadMeta("therapist_schedules_year_cache_hit"));
          } else {
            const scheduleSnap = await getDocs(query(getCollectionPath("therapist_schedules"), where("year", "==", targetYearStr)));
            trackReadSource("therapist_schedules_year", scheduleSnap.docs.length, getStableReadMeta("therapist_schedules_year_lazy"));

            if (!isMounted) return;

            const schedules = {};
            scheduleSnap.docs.forEach((d) => (schedules[d.id] = d.data()));
            setTherapistSchedules(schedules);
            lowFrequencyCacheRef.current[scheduleCacheKey] = {
              data: schedules,
              expiresAt: nowMs + cacheTtlMs,
            };
          }
        } else {
          setTherapistSchedules({});
        }

        if (shouldLoadTherapistTargets) {
          const unsubTherapistTargets = onSnapshot(
            query(getCollectionPath("therapist_targets"), where("year", "==", targetYearStr)),
            (tTargetSnap) => {
              trackSnapshotRead("therapist_targets_year_live", tTargetSnap, getStableReadMeta("therapist_targets_year_live"));
              const t = {};
              tTargetSnap.docs.forEach((d) => (t[d.id] = d.data()));
              setTherapistTargets(t);
            },
            (error) => console.error("therapist_targets 即時監聽失敗:", error)
          );
          lowFrequencyUnsubs.push(unsubTherapistTargets);
        } else {
          setTherapistTargets({});
        }
      } catch (error) {
        console.error("Fetch low frequency data error:", error);
      }
    };

    fetchLowFrequencyData();

    return () => {
      isMounted = false;
      lowFrequencyUnsubs.forEach((unsubscribe) => {
        try { unsubscribe && unsubscribe(); } catch (error) { console.warn("low frequency unsubscribe failed", error); }
      });
    };
  }, [user, currentBrandId, currentBrand, getCollectionPath, selectedYear, activeView, auditType, getStableReadMeta]);

  useEffect(() => {
    if (!user) {
      setDailyLoginCount(0);
      setYesterdayLoginCount(0);
      return;
    }

    const todayStr = formatLocalYYYYMMDD(new Date());
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterdayStr = formatLocalYYYYMMDD(d);

    const unsubStatsToday = onSnapshot(doc(getCollectionPath("system_stats"), todayStr), (s) => {
      trackReadSource("system_stats_today", s.exists() ? 1 : 0, getStableReadMeta("system_stats_today"));
      if (s.exists()) setDailyLoginCount(s.data().count || 0);
      else setDailyLoginCount(0);
    });

    const unsubStatsYesterday = onSnapshot(doc(getCollectionPath("system_stats"), yesterdayStr), (s) => {
      trackReadSource("system_stats_yesterday", s.exists() ? 1 : 0, getStableReadMeta("system_stats_yesterday"));
      if (s.exists()) setYesterdayLoginCount(s.data().count || 0);
      else setYesterdayLoginCount(0);
    });

    return () => {
      unsubStatsToday();
      unsubStatsYesterday();
    };
  }, [user, currentBrandId, getCollectionPath, getStableReadMeta]);


  const monthCacheRef = useRef({});

  useEffect(() => {
    const shouldLoadAnnualData = ANNUAL_DATA_VIEWS.has(activeView);

    if (!user || isLowPowerMode || !shouldLoadAnnualData) {
      setAnnualAggregatedData([]);
      setAnnualDashboardSummaries([]);
      setAnnualSummaryStatusMap({});
      setTherapistAnnualAggregatedData([]);
      return;
    }

    const targetYear = String(selectedYear);

    // 1. 抓取店鋪結算表：保留作為本月 / 未整理月份備援資料源
    const unsubAgg = onSnapshot(
      query(getCollectionPath("monthly_aggregated"), where("year", "in", [targetYear, Number(targetYear)])),
      (s) => {
        trackSnapshotRead("monthly_aggregated_year", s, getStableReadMeta("monthly_aggregated_year"));
        setAnnualAggregatedData(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );

    // ★ 年度分析歷史月份 Summary-first：
    // Dashboard 已改用 verified Summary 作為歷史月份可信口徑，年度分析也必須讀同一批 Summary，
    // 避免 Q2 / 年度表格與單月營運總覽出現不同金額。
    const unsubDashboardSummary = onSnapshot(
      getCollectionPath("dashboard_summary"),
      (s) => {
        trackSnapshotRead("dashboard_summary_year_for_annual", s, getStableReadMeta("dashboard_summary_year_for_annual"));
        setAnnualDashboardSummaries(
          s.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((row) => String(row.yearMonth || row.id || "").startsWith(`${targetYear}-`))
        );
      }
    );

    const unsubSummaryFlags = onSnapshot(
      getCollectionPath("summary_recalc_flags"),
      (s) => {
        trackSnapshotRead("summary_recalc_flags_year_for_annual", s, getStableReadMeta("summary_recalc_flags_year_for_annual"));
        const map = {};
        s.docs.forEach((d) => {
          const data = { id: d.id, ...d.data() };
          const ym = String(data.affectedYearMonth || data.yearMonth || d.id || "");
          if (ym.startsWith(`${targetYear}-`)) map[ym] = data;
        });
        setAnnualSummaryStatusMap(map);
      }
    );

    // ★ 2. 新增：抓取管理師結算表 (完美套用您的動態路徑)
    const unsubTherapistAgg = onSnapshot(
      query(getCollectionPath("therapist_monthly_aggregated"), where("year", "in", [targetYear, Number(targetYear)])),
      (s) => {
        trackSnapshotRead("therapist_monthly_aggregated_year", s, getStableReadMeta("therapist_monthly_aggregated_year"));
        setTherapistAnnualAggregatedData(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );

    return () => {
      unsubAgg();
      unsubDashboardSummary();
      unsubSummaryFlags();
      unsubTherapistAgg(); // ★ 離開時記得關閉管線
    };
  }, [user, currentBrand, selectedYear, activeView, getCollectionPath, getStableReadMeta, isLowPowerMode]);

  useEffect(() => {
    const isSummaryFirstReportView = activeView === "ranking" || activeView === "regional";
    const isStoreAnalysisScopedView = activeView === "store-analysis";
    const hasUsableDashboardSummary = Boolean(currentDashboardSummary?.stores && Object.keys(currentDashboardSummary.stores || {}).length > 0);

    const shouldLoadDailyReportData =
      MONTHLY_DAILY_REPORT_DATA_VIEWS.has(activeView) &&
      (!isStoreAnalysisScopedView || !storeAnalysisSelectedStore) &&
      (!isSummaryFirstReportView || (currentReportSummaryReady && !hasUsableDashboardSummary));

    const shouldLoadTherapistReportData =
      MONTHLY_THERAPIST_REPORT_DATA_VIEWS.has(activeView) ||
      (activeView === "dashboard" && (dashboardViewMode === "therapist" || userRole === "therapist" || userRole === "trainer"));

    if (!user || isLowPowerMode || (!shouldLoadDailyReportData && !shouldLoadTherapistReportData)) {
      setRawData([]);
      setTherapistReports([]);
      return;
    }

    const targetYear = String(selectedYear);
    const targetMonth = String(selectedMonth).padStart(2, '0');
    const cacheKey = `${currentBrand.id}_${targetYear}_${targetMonth}_${shouldLoadDailyReportData ? "daily" : "nodaily"}_${shouldLoadTherapistReportData ? "therapist" : "notherapist"}`;

    const now = new Date();
    const currentRealYear = String(now.getFullYear());
    const currentRealMonth = String(now.getMonth() + 1).padStart(2, '0');
    const isCurrentMonth = (targetYear === currentRealYear && targetMonth === currentRealMonth);

    const startDate = `${targetYear}-${targetMonth}-01`;
    const endDate = `${targetYear}-${targetMonth}-31`;

    if (isCurrentMonth) {
      if (!shouldLoadDailyReportData) setRawData([]);
      if (!shouldLoadTherapistReportData) setTherapistReports([]);

      let unsubReports = null;
      let unsubTherapistReports = null;

      if (shouldLoadDailyReportData) {
        unsubReports = onSnapshot(
          query(getCollectionPath("daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc")),
          (s) => {
            trackSnapshotRead("daily_reports_current_month", s, getStableReadMeta("daily_reports_current_month"));
            setRawData(s.docs.map((d) => ({ id: d.id, ...d.data() })));
          }
        );
      }

      if (shouldLoadTherapistReportData) {
        unsubTherapistReports = onSnapshot(
          query(getCollectionPath("therapist_daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc")),
          (s) => {
            trackSnapshotRead("therapist_daily_reports_current_month", s, getStableReadMeta("therapist_daily_reports_current_month"));
            setTherapistReports(s.docs.map((d) => ({ id: d.id, ...d.data() })));
          }
        );
      }

      return () => {
        if (unsubReports) unsubReports();
        if (unsubTherapistReports) unsubTherapistReports();
      };

    } else {
      if (monthCacheRef.current[cacheKey]) {
        setRawData(monthCacheRef.current[cacheKey].reports);
        setTherapistReports(monthCacheRef.current[cacheKey].therapistReports);
        return;
      }

      setRawData([]);
      setTherapistReports([]);
      let isMounted = true;

      const fetchPastMonth = async () => {
        try {
          const [reportsSnap, tReportsSnap] = await Promise.all([
            shouldLoadDailyReportData
              ? getDocs(query(getCollectionPath("daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc")))
              : Promise.resolve({ docs: [] }),
            shouldLoadTherapistReportData
              ? getDocs(query(getCollectionPath("therapist_daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc")))
              : Promise.resolve({ docs: [] })
          ]);

          if (shouldLoadDailyReportData) {
            trackReadSource("daily_reports_past_month_getDocs", reportsSnap.docs.length, getStableReadMeta("daily_reports_past_month_getDocs"));
          }
          if (shouldLoadTherapistReportData) {
            trackReadSource("therapist_daily_reports_past_month_getDocs", tReportsSnap.docs.length, getStableReadMeta("therapist_daily_reports_past_month_getDocs"));
          }

          if (!isMounted) return;

          const reportsData = reportsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          const tReportsData = tReportsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

          monthCacheRef.current[cacheKey] = {
            reports: reportsData,
            therapistReports: tReportsData
          };

          setRawData(reportsData);
          setTherapistReports(tReportsData);

        } catch (e) {
          console.error("單次獲取歷史月份失敗:", e);
        }
      };

      fetchPastMonth();

      return () => {
        isMounted = false; 
      };
    }
  }, [user, currentBrand, selectedYear, selectedMonth, activeView, dashboardViewMode, storeAnalysisSelectedStore, userRole, currentDashboardSummary, currentReportSummaryReady, getCollectionPath, getStableReadMeta, isLowPowerMode]);


 const handleLogin = useCallback(async (roleId, userInfo = null) => {
    setLoginSecurityNotice(null);
    setToast((prev) => {
      if (String(prev?.message || "").includes("裝置已被封鎖")) return null;
      return prev;
    });
    let finalUser = userInfo;
    
    if (roleId === 'therapist' && userInfo?.name) { 
      // ★ 升級防撞機制：同時比對「姓名」與「店家」，避免同名同姓抓錯 ID
      const foundTherapist = therapists.find(t => 
        t.name === userInfo.name && 
        (t.store === userInfo.store || t.storeName === userInfo.store || t.store === userInfo.storeName)
      ); 
      
      if (foundTherapist) { 
        finalUser = { ...userInfo, ...foundTherapist, id: foundTherapist.id || userInfo.id }; 
      } 
    }
    
    setUserRole(roleId); 
    if (finalUser) setCurrentUser(finalUser);
    
    const userName = finalUser?.name || (roleId === "director" ? "高階主管" : (roleId === "trainer" ? "教專" : "未知"));
    const immediateDeviceInfo = getClientDeviceInfo();
    setCurrentDeviceTrust({
      status: "checking",
      label: "裝置狀態確認中",
      deviceShort: immediateDeviceInfo.deviceShort,
      deviceId: immediateDeviceInfo.deviceId,
    });

    // v1.5 穩定版：登入紀錄一定先寫入，不等待裝置檢查。
    // 新裝置檢查只做背景處理，不能影響登入監控的「登入系統」紀錄。
    logActivity(roleId, userName, "登入系統", {
      activityType: "auth.login",
      message: finalUser?.passwordUpdatedOnFirstLogin ? "登入成功，已完成首次安全更新" : "登入成功",
      passwordUpdatedOnFirstLogin: Boolean(finalUser?.passwordUpdatedOnFirstLogin),
      deviceInfo: immediateDeviceInfo,
      deviceShort: immediateDeviceInfo.deviceShort,
      riskTags: [],
      deviceStatus: "login_recorded",
    });

    registerAccountDevice(roleId, finalUser || { name: userName }).then((deviceSecurity) => {
      if (deviceSecurity?.blocked || deviceSecurity?.allowed === false || deviceSecurity?.deviceStatus === "blocked") {
        setCurrentDeviceTrust({
          status: "blocked",
          label: "⛔ 裝置已封鎖",
          deviceShort: deviceSecurity?.deviceInfo?.deviceShort || immediateDeviceInfo.deviceShort,
          deviceId: deviceSecurity?.deviceInfo?.deviceId || immediateDeviceInfo.deviceId,
        });

        try {
          logActivity(roleId, userName, "封鎖裝置嘗試登入", {
            activityType: "auth.blocked_device",
            message: "此裝置已被封鎖，系統已拒絕登入",
            deviceInfo: immediateDeviceInfo,
            deviceShort: immediateDeviceInfo.deviceShort,
            riskTags: ["裝置已封鎖"],
            deviceStatus: "blocked",
          });
        } catch (logError) {
          console.warn("封鎖裝置登入紀錄寫入失敗:", logError);
        }

        setLoginSecurityNotice({
          type: "blocked",
          title: deviceSecurity?.globalBlocked ? "此裝置已被全品牌封鎖" : "此裝置已被封鎖",
          message: deviceSecurity?.globalBlocked
            ? "此裝置已被主管設定為全品牌封鎖，無法登入任何品牌。請聯繫主管確認裝置權限。"
            : "請聯繫主管確認裝置權限，或改用已信任的常用裝置登入。",
          deviceShort: deviceSecurity?.deviceInfo?.deviceShort || immediateDeviceInfo.deviceShort,
          deviceInfo: deviceSecurity?.deviceInfo || immediateDeviceInfo,
          roleId,
          accountId: sanitizeSecurityKey(finalUser?.id || finalUser?.accountId || finalUser?.name || roleId),
          userName,
          globalBlocked: Boolean(deviceSecurity?.globalBlocked),
          blockedData: deviceSecurity?.existingDevice || null,
        });
        setToast({ message: deviceSecurity?.globalBlocked ? "此裝置已被全品牌封鎖，請聯繫主管。" : "此裝置已被封鎖，請聯繫主管。", type: "error" });
        setUserRole(null);
        setCurrentUser(null);
        setActiveView("dashboard");
        return;
      }

      let shouldShowUnblockSuccess = false;
      try {
        const rawUnblockNotice = localStorage.getItem("cyj_device_unblock_success_notice");
        if (rawUnblockNotice) {
          const unblockNotice = JSON.parse(rawUnblockNotice);
          const sameDevice =
            unblockNotice?.deviceId === (deviceSecurity?.deviceInfo?.deviceId || immediateDeviceInfo.deviceId) ||
            unblockNotice?.deviceShort === (deviceSecurity?.deviceInfo?.deviceShort || immediateDeviceInfo.deviceShort);
          const isFresh = Date.now() - Number(unblockNotice?.at || 0) < 10 * 60 * 1000;

          if (sameDevice && isFresh) {
            shouldShowUnblockSuccess = true;
          }
          localStorage.removeItem("cyj_device_unblock_success_notice");
        }
      } catch (storageError) {
        console.warn("解除封鎖成功提示讀取失敗:", storageError);
      }

      if (shouldShowUnblockSuccess) {
        setToast({ message: "裝置已解除封鎖，可正常登入。", type: "success" });
      }

      const isNewOrUntrusted = Boolean(deviceSecurity?.isNewDevice && deviceSecurity?.deviceTrusted === false);
      setCurrentDeviceTrust({
        status: isNewOrUntrusted ? "new" : "trusted",
        label: isNewOrUntrusted ? "⚠ 新裝置待觀察" : "🛡 目前裝置已信任",
        deviceShort: deviceSecurity?.deviceInfo?.deviceShort || immediateDeviceInfo.deviceShort,
        deviceId: deviceSecurity?.deviceInfo?.deviceId || immediateDeviceInfo.deviceId,
      });
    }).catch((error) => {
      // 背景裝置檢查失敗不影響登入紀錄；registerAccountDevice 內部會盡量補記失敗紀錄。
      console.warn("背景裝置檢查失敗，登入紀錄已保留:", error);
      setCurrentDeviceTrust({
        status: "unknown",
        label: "裝置狀態未確認",
        deviceShort: immediateDeviceInfo.deviceShort,
        deviceId: immediateDeviceInfo.deviceId,
      });
    });

    if (finalUser?.passwordUpdatedOnFirstLogin) {
      logActivity(roleId, userName, "首次安全更新", {
        activityType: "auth.password_update",
        message: "使用初始密碼登入後，已完成密碼更新",
      });
    }
    setActiveView("dashboard");
  }, [therapists, logActivity, registerAccountDevice]);

  const showToast = useCallback((message, type = "info") => setToast({ message, type }), []);

  // ==========================================
  // ★ 省流量待機提示：進入 / 恢復時通知使用者
  // ==========================================
  useEffect(() => {
    if (!userRole) return;

    if (isLowPowerMode && !lowPowerToastShownRef.current) {
      showToast("已進入省流量待機，即時資料同步已暫停", "info");
      lowPowerToastShownRef.current = true;
    }

    if (!isLowPowerMode && lowPowerToastShownRef.current) {
      showToast("已恢復即時同步，系統正在更新最新資料", "success");
      lowPowerToastShownRef.current = false;
    }
  }, [isLowPowerMode, userRole, showToast]);
  const openConfirm = useCallback((title, message, onConfirm) => setConfirmModal({ isOpen: true, title, message, onConfirm: () => { onConfirm(); setConfirmModal((p) => ({ ...p, isOpen: false })); }, }), []);
  const closeConfirmModal = useCallback(() => setConfirmModal((p) => ({ ...p, isOpen: false })), []);

  const handleUpdateStorePassword = useCallback(async (id, newPass) => { try { const updated = storeAccounts.map((a) => a.id === id ? { ...a, password: newPass } : a); await setDoc(getDocPath("store_account_data"), { accounts: updated }); return true; } catch (e) { return false; } }, [storeAccounts, getDocPath]);
  const handleUpdateManagerPassword = useCallback(async (name, newPass) => { try { await setDoc(getDocPath("manager_auth"), { [name]: newPass }, { merge: true }); return true; } catch (e) { return false; } }, [getDocPath]);
  const handleUpdateTherapistPassword = useCallback(async (id, newPass) => { try { await updateDoc(doc(getCollectionPath("therapists"), id), { password: newPass }); return true; } catch (e) { console.error(e); return false; } }, [getCollectionPath]);
  const handleUpdateTrainerAuth = useCallback(async (actionOrPassword, trainerId = null, payload = {}) => {
    try {
      const current = normalizeTrainerAuthData(trainerAuth || {});
      const nowText = new Date().toISOString();
      let next = normalizeTrainerAuthData(current);

      // 舊呼叫相容：handleUpdateTrainerAuth("1234") 代表更新第一位教專密碼。
      if (!["add", "update", "rename", "toggle", "delete", "reorder"].includes(actionOrPassword)) {
        const targetId = trainerId || next.trainerOrder?.[0] || LEGACY_TRAINER_ID;
        next.accounts[targetId] = {
          ...(next.accounts[targetId] || { id: targetId, name: "教專" }),
          password: String(actionOrPassword || "0000"),
          updatedAtText: nowText,
        };
      } else if (actionOrPassword === "add") {
        const name = String(payload?.name || "").trim();
        if (!name) throw new Error("請輸入教專姓名");
        const id = payload?.id || `trainer_${Date.now().toString(36)}`;
        next.accounts[id] = {
          id,
          name,
          password: String(payload?.password || "0000").trim() || "0000",
          isActive: payload?.isActive !== false,
          createdAtText: nowText,
          updatedAtText: nowText,
        };
        next.trainerOrder = [...(next.trainerOrder || []).filter((x) => x !== id), id];
      } else if (actionOrPassword === "update" || actionOrPassword === "rename") {
        const id = trainerId;
        if (!id || !next.accounts[id]) throw new Error("找不到教專帳號");
        next.accounts[id] = {
          ...next.accounts[id],
          ...payload,
          id,
          name: String(payload?.name ?? next.accounts[id].name ?? "").trim() || next.accounts[id].name || "教專",
          password: String(payload?.password ?? next.accounts[id].password ?? "0000").trim() || "0000",
          isActive: payload?.isActive ?? next.accounts[id].isActive ?? true,
          updatedAtText: nowText,
        };
      } else if (actionOrPassword === "toggle") {
        const id = trainerId;
        if (!id || !next.accounts[id]) throw new Error("找不到教專帳號");
        next.accounts[id] = {
          ...next.accounts[id],
          isActive: payload?.isActive ?? !next.accounts[id].isActive,
          updatedAtText: nowText,
        };
      } else if (actionOrPassword === "delete") {
        const id = trainerId;
        if (!id || !next.accounts[id]) throw new Error("找不到教專帳號");
        delete next.accounts[id];
        next.trainerOrder = (next.trainerOrder || []).filter((x) => x !== id);
        if (next.trainerOrder.length === 0) {
          next = normalizeTrainerAuthData({ password: "0000" });
        }
      } else if (actionOrPassword === "reorder") {
        const order = Array.isArray(payload?.trainerOrder) ? payload.trainerOrder : [];
        const existing = new Set(Object.keys(next.accounts || {}));
        next.trainerOrder = [
          ...order.filter((id) => existing.has(id)),
          ...Object.keys(next.accounts || {}).filter((id) => !order.includes(id)),
        ];
      }

      next = normalizeTrainerAuthData(next);
      await setDoc(getDocPath("trainer_auth"), next);
      setTrainerAuth(next);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }, [getDocPath, trainerAuth]);
  const handleUpdateAuditExclusions = useCallback(async (newExclusions) => { try { await setDoc(getDocPath("audit_exclusions"), { stores: newExclusions }); return true; } catch (e) { console.error(e); return false; } }, [getDocPath]);
  
  const handleUpdateDirectorAuth = useCallback(async (action, name, payload = {}, newName = null) => { 
    try { 
      const docRef = getDocPath("director_auth");
      let next = normalizeDirectorAuthData(directorAuth || {});
      const nowText = new Date().toISOString();

      if (action === "add") {
        const accountName = String(name || "").trim();
        if (!accountName) return false;
        next.accounts[accountName] = {
          id: accountName,
          name: accountName,
          password: payload?.password || payload || "0000",
          level: payload?.level || getDefaultDirectorLevel(accountName),
          isActive: payload?.isActive !== false,
          createdAtText: nowText,
          updatedAtText: nowText,
        };
        next.directorOrder = [...next.directorOrder.filter((item) => item !== accountName), accountName];
      } else if (action === "rename") {
        const oldName = String(name || "").trim();
        const accountName = String(newName || payload?.name || "").trim();
        if (!oldName || !accountName || !next.accounts[oldName]) return false;
        const oldAccount = next.accounts[oldName] || {};
        delete next.accounts[oldName];
        next.accounts[accountName] = {
          ...oldAccount,
          ...payload,
          id: accountName,
          name: accountName,
          password: payload?.password || oldAccount.password || "0000",
          level: payload?.level || oldAccount.level || getDefaultDirectorLevel(accountName),
          updatedAtText: nowText,
        };
        next.directorOrder = next.directorOrder.map((item) => item === oldName ? accountName : item);
      } else if (action === "update") {
        if (!name || !next.accounts[name]) return false;
        next.accounts[name] = { ...next.accounts[name], password: payload?.password || payload || "0000", updatedAtText: nowText };
      } else if (action === "level") {
        if (!name || !next.accounts[name]) return false;
        next.accounts[name] = { ...next.accounts[name], level: payload?.level || "operation_admin", updatedAtText: nowText };
      } else if (action === "toggle-active") {
        if (!name || !next.accounts[name]) return false;
        next.accounts[name] = { ...next.accounts[name], isActive: payload?.isActive !== false, updatedAtText: nowText };
      } else if (action === "delete") {
        if (!name || !next.accounts[name]) return false;
        next.accounts[name] = { ...next.accounts[name], isActive: false, updatedAtText: nowText };
      } else if (action === "reorder") {
        const order = Array.isArray(payload?.directorOrder) ? payload.directorOrder : [];
        const existing = new Set(Object.keys(next.accounts || {}));
        next.directorOrder = [...order.filter((item) => existing.has(item)), ...Object.keys(next.accounts || {}).filter((item) => !order.includes(item))];
      }

      next = normalizeDirectorAuthData(next);
      await setDoc(docRef, next);
      setDirectorAuth(next);
      return true; 
    } catch (e) { console.error(e); return false; } 
  }, [getDocPath, directorAuth]);

  const navigateToStore = useCallback((storeName) => { setActiveView("store-analysis"); window.dispatchEvent(new CustomEvent("navigate-to-store", { detail: storeName })); }, []);

  const visibleRawData = useMemo(() => {
    if (userRole === ROLES.TRAINER.id) return []; 
    if (userRole === ROLES.STORE.id && currentUser) { const myCores = (currentUser.stores || [currentUser.storeName] || []).map(normalizeStore).filter(Boolean); return rawData.filter((d) => myCores.includes(normalizeStore(d.storeName))); }
    if (userRole === ROLES.MANAGER.id && currentUser) { const myCores = (managers[currentUser.name] || []).map(normalizeStore).filter(Boolean); return rawData.filter((d) => myCores.includes(normalizeStore(d.storeName))); }
    return rawData;
  }, [rawData, userRole, currentUser, managers, normalizeStore]);


  // ============================================================================
  // ★ 終極權限解鎖：炸毀資料防火牆 ★
  // 無論是店長還是區長，只要是合法登入角色，系統一律下發「全區管理師報表」
  // 讓前端畫面可以自動算出全區排名與全區大盤，不受權限影響！
  // ============================================================================
  const visibleTherapistReports = useMemo(() => {
    return therapistReports;
  }, [therapistReports]);

  const visibleTherapists = useMemo(() => {
    if (userRole === 'director' || userRole === 'trainer' || userRole === 'manager' || userRole === 'store' || userRole === 'master') {
      return therapists;
    }
    if (userRole === 'therapist' && currentUser) return therapists.filter(t => t.id === currentUser.id);
    return [];
  }, [therapists, userRole, currentUser]);
  // ============================================================================


  const visibleManagers = useMemo(() => {
    let result = managers; 
    if (userRole === ROLES.MANAGER.id && currentUser) { const myStores = managers[currentUser.name] || []; result = { [currentUser.name]: myStores }; } 
    else if (userRole === ROLES.STORE.id && currentUser) {
      const myCores = (currentUser.stores || (currentUser.storeName ? [currentUser.storeName] : [])).map(normalizeStore);
      const filteredManagers = {};
      Object.entries(managers || {}).forEach(([mgr, stores]) => { const storeList = Array.isArray(stores) ? stores : []; const intersectingStores = storeList.filter((s) => myCores.includes(normalizeStore(s))); if (intersectingStores.length > 0) filteredManagers[mgr] = intersectingStores; });
      result = filteredManagers;
    }
    // 設定頁必須看得到「未分配」。
    // director / master 的營運總覽也保留「未分配」店家，避免店家從區長轄區移除後，營運總覽數字跟著消失。
    // 其他角色維持原本邏輯，不主動顯示未分配區塊。
    if (activeView !== 'settings' && userRole !== 'director' && userRole !== 'master') {
       const filtered = {};
       Object.entries(result || {}).forEach(([mgr, stores]) => { if (!String(mgr).includes("未分配") && !String(mgr).includes("未分區")) filtered[mgr] = Array.isArray(stores) ? stores : []; });
       return filtered;
    }
    return result;
  }, [managers, userRole, currentUser, activeView, normalizeStore]);

  const visibleManagerOrder = useMemo(() => {
    const visibleKeys = Object.keys(visibleManagers || {});
    return normalizeManagerOrder(visibleManagers || {}, managerOrder).filter((name) => visibleKeys.includes(name));
  }, [visibleManagers, managerOrder]);

  const publicManagers = useMemo(() => {
    const filtered = {};
    Object.entries(managers || {}).forEach(([mgr, stores]) => {
      if (!String(mgr).includes("未分配") && !String(mgr).includes("未分區")) {
        filtered[mgr] = Array.isArray(stores) ? stores : [];
      }
    });
    return filtered;
  }, [managers]);

  const analytics = useAnalytics(visibleRawData, visibleManagers, budgets, selectedYear, selectedMonth, annualAggregatedData);
  const allStoreNames = useMemo(() => {
    const prefix = currentBrandId === 'anniu' ? '安妞' : currentBrandId === 'yibo' ? '伊啵' : 'CYJ';
    return Object.values(managers || {})
      .flatMap((stores) => Array.isArray(stores) ? stores : [])
      .filter(Boolean)
      .map((s) => `${prefix}${normalizeStore(s)}店`);
  }, [managers, currentBrandId, normalizeStore]);

  const fmtMoney = (val) => `$${(val || 0).toLocaleString()}`;
  const fmtNum = (val) => (val || 0).toLocaleString();

  useEffect(() => {
    if (!userRole) return;

    const timer = setInterval(() => {
      flushReadTrackerToFirestore({
        db,
        brandId: currentBrandId,
        brandLabel: currentBrand?.label || currentBrandId,
        userRole,
        userName: currentUser?.name || (userRole === "director" ? "高階主管" : userRole),
        activeView,
      }).catch((error) => {
        console.warn("read tracker flush failed", error);
      });
    }, 60 * 1000);

    return () => clearInterval(timer);
  }, [userRole, currentUser, currentBrandId, currentBrand, activeView]);

  const contextValue = useMemo(() => ({
    user, loading, analytics, managers: visibleManagers, managerOrder: visibleManagerOrder, budgets, monthlyTargetSummary, currentDashboardSummary, currentRankingsSummary, currentReportSummaryReady, targets, rawData: visibleRawData, allReports: rawData, 
    annualAggregatedData, annualDashboardSummaries, annualSummaryStatusMap, therapistAnnualAggregatedData, // ★ 把年度 Summary 與管理師資料交出去
    showToast, openConfirm, fmtMoney, fmtNum, inputDate, setInputDate, storeList: analytics?.storeList || [], setTargets, selectedYear, selectedMonth, permissions, storeAccounts, managerAuth, currentUser, userRole, logActivity, handleUpdateStorePassword, handleUpdateManagerPassword, handleUpdateTherapistPassword, navigateToStore, activeView, appId, 
    therapists: visibleTherapists, therapistReports: visibleTherapistReports, therapistSchedules, therapistTargets, trainerAuth, handleUpdateTrainerAuth, auditExclusions, handleUpdateAuditExclusions, currentBrand, setCurrentBrandId, getCollectionPath, getDocPath, dailyLoginCount, yesterdayLoginCount, securityConfig, isOnline, isLowPowerMode,
    fetchGlobalData,
    directorLevel,
    directorPermissionProfile,
    canDirectorAccessView,
    isReadOnlyDirector: userRole === "director" && !canDirectorAccessView("history")
  }), [user, loading, analytics, visibleManagers, visibleManagerOrder, budgets, monthlyTargetSummary, currentDashboardSummary, currentRankingsSummary, currentReportSummaryReady, targets, visibleRawData, rawData, annualAggregatedData, annualDashboardSummaries, annualSummaryStatusMap, therapistAnnualAggregatedData, inputDate, selectedYear, selectedMonth, permissions, storeAccounts, managerAuth, currentUser, userRole, logActivity, handleUpdateStorePassword, handleUpdateManagerPassword, handleUpdateTherapistPassword, navigateToStore, activeView, appId, visibleTherapists, visibleTherapistReports, therapistSchedules, therapistTargets, trainerAuth, handleUpdateTrainerAuth, auditExclusions, handleUpdateAuditExclusions, currentBrand, setCurrentBrandId, getCollectionPath, getDocPath, dailyLoginCount, yesterdayLoginCount, securityConfig, isOnline, isLowPowerMode, fetchGlobalData, directorLevel, directorPermissionProfile, canDirectorAccessView]); // ★ 依賴陣列也要加
  
  const memoizedViews = useMemo(() => {
    return (
      <main className="flex-1 p-4 md:p-8 overflow-y-auto overflow-x-hidden min-w-0 w-full relative">
        <Suspense fallback={
          <div className="flex h-[70vh] items-center justify-center flex-col animate-in fade-in duration-300">
            <Loader2 className="w-12 h-12 animate-spin text-stone-300 mb-4" />
            <span className="text-stone-400 font-bold tracking-widest text-sm">系統模組載入中...</span>
          </div>
        }>
          {activeView === "dashboard" && <DashboardView />}
          {activeView === "daily" && <DailyView />}
          {activeView === "regional" && <RegionalView />}
          {activeView === "ranking" && <RankingView />}
          {activeView === "store-analysis" && <StoreAnalysisView />}
          {activeView === "audit" && <AuditView auditType={auditType} setAuditType={setAuditType} />}
          {activeView === "history" && canDirectorAccessView("history") && <HistoryView />}
          {activeView === "input" && canDirectorAccessView("input") && <InputView />}
          {activeView === "logs" && canDirectorAccessView("logs") && <SystemMonitor />}
          {activeView === "settings" && canDirectorAccessView("settings") && <SettingsView />}
          {activeView === "annual" && <AnnualView />}
          {activeView === "targets" && canDirectorAccessView("targets") && <TargetView />}
          {activeView === "t-targets" && canDirectorAccessView("t-targets") && <TherapistTargetView />}
          {activeView === "t-schedule" && canDirectorAccessView("t-schedule") && <TherapistScheduleView />}
          {activeView === "notification" && canDirectorAccessView("notification") && <NotificationManager />}
          {activeView === "therapist-manager" && canDirectorAccessView("therapist-manager") && <TherapistManagerView />}
        </Suspense>
      </main>
    );
  }, [activeView, auditType, canDirectorAccessView]);

  if (loading) return <div className="min-h-screen flex flex-col items-center justify-center bg-[#F9F8F6]"><Loader2 className="w-16 h-16 animate-spin text-stone-400 mb-4" /><p className="animate-pulse text-stone-500 font-bold tracking-wider">Loading DRCYJ Cloud...</p></div>;
  
if (isUpdating) {
    const updateAttempts = parseInt(sessionStorage.getItem('cyj_update_attempts') || '0');
    const hasUpdateFailed = updateAttempts >= 3;
    const handleManualHardRefresh = () => {
      try {
        sessionStorage.removeItem('cyj_update_attempts');
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations?.().then((registrations) => {
            registrations.forEach((registration) => registration.unregister());
          });
        }
      } catch (error) {
        console.warn('manual refresh cleanup failed', error);
      }
      const currentUrl = window.location.href.split('?')[0];
      window.location.replace(`${currentUrl}?v=${new Date().getTime()}`);
    };

    return (
      <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-[linear-gradient(135deg,#FBF7F1_0%,#F8F1E8_45%,#FDFBF8_100%)] px-5 animate-in fade-in duration-300">
        <div className="w-full max-w-[460px] rounded-[2rem] border border-[#E8DDD0] bg-white/92 p-7 text-center shadow-[0_24px_80px_rgba(154,118,84,0.14)] backdrop-blur">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-[#F0DDBB] bg-[#FFF6E4] text-[#B7863D] shadow-[0_14px_30px_rgba(183,134,61,0.16)]">
            {hasUpdateFailed ? (
              <AlertCircle className="h-8 w-8 text-[#B66A79]" />
            ) : (
              <Loader2 className="h-8 w-8 animate-spin" />
            )}
          </div>

          <div className="mb-3 inline-flex items-center rounded-full border border-[#EADCC9] bg-[#FDF8EF] px-3 py-1 text-[11px] font-black tracking-[0.16em] text-[#A77732]">
            SYSTEM UPDATE
          </div>

          <h2 className="text-2xl font-black tracking-tight text-[#4F3F33]">
            {hasUpdateFailed ? '更新尚未完成' : '正在同步最新版本'}
          </h2>

          <p className="mt-3 text-sm font-bold leading-7 text-[#7D6753]">
            {hasUpdateFailed
              ? '系統已嘗試自動更新，但此裝置可能仍讀到舊快取。請使用下方按鈕重新整理，或完全關閉系統後再重新開啟。'
              : '我們正在為您更新系統內容，讓畫面與資料邏輯保持在最新狀態。請稍候片刻。'}
          </p>

          <div className="mt-5 rounded-2xl border border-[#EFE5DA] bg-[#FBF7F1] px-4 py-3 text-xs font-bold text-[#8A7868]">
            目前版本：<span className="font-black text-[#B7863D]">v{CURRENT_APP_VERSION}</span>
            <span className="mx-2 text-[#CDBEAE]">｜</span>
            更新嘗試：<span className="font-black text-[#B7863D]">{updateAttempts}</span> / 3
          </div>

          {hasUpdateFailed ? (
            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={handleManualHardRefresh}
                className="w-full rounded-2xl bg-gradient-to-r from-[#DAB98B] to-[#C89F68] px-5 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(200,159,104,0.24)] transition hover:brightness-[1.03] active:scale-[0.98]"
              >
                清除快取並重新整理
              </button>
              <p className="text-xs font-bold leading-6 text-[#9A8978]">
                手機 / 平板若仍無法更新，請將瀏覽器或 APP 完全關閉後重新開啟。電腦可使用 Ctrl + F5 或 Cmd + Shift + R。
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              <div className="h-2 overflow-hidden rounded-full bg-[#EFE5DA]">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-[#E9C98E] to-[#C89F68]" />
              </div>
              <button
                type="button"
                onClick={handleManualHardRefresh}
                className="rounded-2xl border border-[#E6DDD4] bg-white px-5 py-2.5 text-xs font-black text-[#8B7056] transition hover:bg-[#FAF7F2] active:scale-[0.98]"
              >
                立即同步新版
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
  const handleEmergencyUnblockCurrentDevice = async () => {
    if (!loginSecurityNotice || loginSecurityNotice.type !== "blocked") return;

    const inputPassword = String(emergencyMasterPassword || "").trim();
    const validMasterPassword = String(masterAuth?.password || "BOSS888").trim();

    if (!inputPassword) {
      setToast({ message: "請輸入 master 密碼。", type: "error" });
      return;
    }

    if (inputPassword !== validMasterPassword) {
      setToast({ message: "master 密碼不正確，無法解除封鎖。", type: "error" });
      return;
    }

    const deviceInfo = loginSecurityNotice.deviceInfo || getClientDeviceInfo();
    const roleId = loginSecurityNotice.roleId || "unknown";
    const accountId = sanitizeSecurityKey(loginSecurityNotice.accountId || loginSecurityNotice.userName || roleId);
    const accountKey = sanitizeSecurityKey(`${currentBrandId}_${roleId}_${accountId}`);
    const globalBlockKey = sanitizeSecurityKey(`${roleId}_${accountId}_${deviceInfo.deviceId}`);
    const nowText = new Date().toISOString();
    const masterName = "最高管理者救援";

    setIsEmergencyUnlocking(true);

    try {
      const deviceProfileRef = doc(getCollectionPath("account_devices"), accountKey);
      const globalBlockRef = doc(db, "artifacts", appId, "public", "data", "global_blocked_devices", globalBlockKey);

      await setDoc(deviceProfileRef, {
        updatedAt: serverTimestamp(),
        updatedAtText: nowText,
        devices: {
          [deviceInfo.deviceId]: {
            ...(loginSecurityNotice.blockedData || {}),
            deviceId: deviceInfo.deviceId,
            deviceShort: deviceInfo.deviceShort,
            device: deviceInfo.device,
            browser: deviceInfo.browser,
            os: deviceInfo.os,
            trusted: true,
            status: "trusted",
            source: "emergency_master_unblocked",
            reviewedBy: masterName,
            reviewedRole: "master",
            reviewedAtText: nowText,
            emergencyUnblocked: true,
            emergencyUnblockedAtText: nowText,
          },
        },
      }, { merge: true });

      await setDoc(globalBlockRef, {
        active: false,
        status: "resolved",
        source: "emergency_master_unblocked",
        resolvedBy: masterName,
        resolvedRole: "master",
        resolvedAtText: nowText,
        updatedAtText: nowText,
      }, { merge: true });

      try {
        await addDoc(getCollectionPath("system_logs"), {
          timestamp: serverTimestamp(),
          createdAtText: nowText,
          role: "master",
          user: masterName,
          action: "最高管理者救援解除裝置封鎖",
          activityType: "security.emergency_unblock",
          view: "login",
          device: deviceInfo.device,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          deviceId: deviceInfo.deviceId,
          deviceShort: deviceInfo.deviceShort,
          details: removeUndefinedDeep({
            message: "登入頁救援解除封鎖",
            targetRole: roleId,
            targetAccountId: accountId,
            targetUserName: loginSecurityNotice.userName,
            globalBlocked: loginSecurityNotice.globalBlocked,
          }),
        });
      } catch (logError) {
        console.warn("救援解除封鎖紀錄寫入失敗:", logError);
      }

      try {
        localStorage.setItem("cyj_device_unblock_success_notice", JSON.stringify({
          deviceId: deviceInfo.deviceId,
          deviceShort: deviceInfo.deviceShort,
          at: Date.now(),
        }));
      } catch (storageError) {
        console.warn("解除封鎖成功提示暫存失敗:", storageError);
      }

      setLoginSecurityNotice({
        type: "unblocked",
        title: "裝置封鎖已解除",
        message: "此裝置已由最高管理者救援解除封鎖，請重新登入。",
        deviceShort: deviceInfo.deviceShort,
      });
      setEmergencyMasterPassword("");
      setToast({ message: "裝置已解除封鎖，請重新登入。", type: "success" });
    } catch (error) {
      console.error("最高管理者救援解除封鎖失敗:", error);
      setToast({ message: "解除封鎖失敗：" + error.message, type: "error" });
    } finally {
      setIsEmergencyUnlocking(false);
    }
  };





  if (!userRole) return (
    <>
      <LoginView 
        appVersion={CURRENT_APP_VERSION}
        onLogin={handleLogin} storeAccounts={storeAccounts} managers={publicManagers} managerOrder={managerOrder} managerAuth={managerAuth} therapists={therapists} 
        onUpdatePassword={handleUpdateStorePassword} onUpdateManagerPassword={handleUpdateManagerPassword} onUpdateTherapistPassword={handleUpdateTherapistPassword} 
        trainerAuth={trainerAuth} handleUpdateTrainerAuth={handleUpdateTrainerAuth} directorAuth={directorAuth} handleUpdateDirectorAuth={handleUpdateDirectorAuth} masterAuth={masterAuth}
        currentBrandId={currentBrandId} onSwitchBrand={handleSwitchBrand} hasSelectedBrand={hasSelectedBrand}
      />

      {loginSecurityNotice?.type === "blocked" && (
        <div className="fixed left-1/2 top-5 z-[999999] w-[calc(100%-32px)] max-w-md -translate-x-1/2 rounded-2xl border border-rose-100 bg-white/95 p-4 shadow-2xl shadow-rose-100/70 backdrop-blur-md animate-in fade-in slide-in-from-top-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-lg">
              ⛔
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black text-rose-600">
                {loginSecurityNotice.title || "此裝置已被封鎖"}
              </div>
              <div className="mt-1 text-xs font-bold leading-5 text-stone-500">
                {loginSecurityNotice.message || "請聯繫主管確認裝置權限。"}
              </div>
              {loginSecurityNotice.deviceShort && (
                <div className="mt-2 inline-flex rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-black text-stone-400">
                  裝置碼 #{loginSecurityNotice.deviceShort}
                </div>
              )}

              <div className="mt-3 rounded-2xl border border-stone-100 bg-stone-50/80 p-3">
                <div className="text-[11px] font-black text-stone-500 mb-2">
                  最高管理者救援解除
                </div>
                <div className="text-[11px] font-bold leading-5 text-stone-400 mb-2">
                  僅供誤封鎖時使用。輸入 master 密碼後，只會解除此裝置封鎖，不會直接進入系統。
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={emergencyMasterPassword}
                    onChange={(e) => setEmergencyMasterPassword(e.target.value)}
                    placeholder="輸入 master 密碼"
                    className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-600 outline-none focus:border-amber-300"
                  />
                  <button
                    type="button"
                    disabled={isEmergencyUnlocking}
                    onClick={handleEmergencyUnblockCurrentDevice}
                    className="shrink-0 rounded-xl bg-stone-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50 active:scale-95"
                  >
                    {isEmergencyUnlocking ? "處理中" : "救援解除"}
                  </button>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setLoginSecurityNotice(null);
                setEmergencyMasterPassword("");
              }}
              className="rounded-full px-2 py-1 text-xs font-black text-stone-300 hover:bg-stone-100 hover:text-stone-500"
              aria-label="關閉提示"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {loginSecurityNotice?.type === "unblocked" && (
        <div className="fixed left-1/2 top-5 z-[999999] w-[calc(100%-32px)] max-w-md -translate-x-1/2 rounded-2xl border border-emerald-100 bg-white/95 p-4 shadow-2xl shadow-emerald-100/70 backdrop-blur-md animate-in fade-in slide-in-from-top-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-lg">
              🛡
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black text-emerald-700">
                {loginSecurityNotice.title || "裝置封鎖已解除"}
              </div>
              <div className="mt-1 text-xs font-bold leading-5 text-stone-500">
                {loginSecurityNotice.message || "請重新登入。"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLoginSecurityNotice(null)}
              className="rounded-full px-2 py-1 text-xs font-black text-stone-300 hover:bg-stone-100 hover:text-stone-500"
              aria-label="關閉提示"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <AppContext.Provider value={contextValue}>
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 bg-rose-500 text-white z-[999999] py-2 px-4 flex items-center justify-center gap-2 shadow-md animate-in slide-in-from-top-full duration-300">
          <WifiOff size={18} className="animate-pulse" />
          <span className="text-sm font-bold tracking-wide">目前無網路連線！請確保網路通暢，以免報表無法成功送出。</span>
        </div>
      )}

      <div className={`flex min-h-screen bg-[#F9F8F6] text-stone-600 font-sans selection:bg-stone-200 selection:text-stone-800 overflow-x-hidden transition-all duration-300 ${!isOnline ? 'mt-9' : 'mt-0'} ${isLowPowerMode ? 'pb-24' : ''}`}>
        <Sidebar activeView={activeView} setActiveView={handleProtectedSetActiveView} isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} user={user} userRole={userRole} onLogout={() => handleLogout()} permissions={permissions} currentUser={currentUser} canAccessView={canDirectorAccessView} />
        <div className={`flex-1 flex flex-col transition-all duration-500 w-full max-w-full ${isSidebarOpen ? "md:ml-64" : "md:ml-20"} ml-0`}>
          <header className="bg-white/80 backdrop-blur-md border-b border-stone-200 sticky top-0 z-40 px-4 md:px-8 py-3 md:h-20 shadow-sm shadow-stone-200/50 shrink-0 transition-all">
            {/* Desktop Header */}
            <div className="hidden md:flex items-center justify-between gap-4 h-full">
              <div className="flex items-center gap-4 min-w-0">
                <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2.5 hover:bg-stone-100 rounded-xl text-stone-400 hidden md:block transition-colors">
                  <Menu size={24} />
                </button>

                <h1 className="text-xl md:text-2xl font-extrabold text-stone-800 tracking-tight truncate hidden sm:flex items-center gap-2 min-w-0">
                  <span className="text-amber-600">●</span>
                  {ALL_MENU_ITEMS.find((i) => i.id === activeView)?.label || (activeView === "targets" ? "年度目標設定" : "DRCYJ System")}
                  <span className="ml-2 text-[11px] font-mono bg-stone-100 text-stone-400 px-2 py-0.5 rounded-md border border-stone-200/60 shadow-inner select-all" title="系統當前版本">
                    v{CURRENT_APP_VERSION}
                  </span>
                </h1>
              </div>

              <div className="flex items-center gap-2 lg:gap-3 flex-1 justify-end min-w-0 overflow-hidden">
                <div className="relative hidden md:block w-40 lg:w-48 xl:w-56 2xl:w-64 shrink min-w-0 group">
                  <Search className="absolute left-3 top-2.5 text-stone-400 group-focus-within:text-stone-600 transition-colors" size={18} />
                  <input
                    type="text"
                    placeholder="搜尋店名..."
                    value={globalSearchTerm}
                    onChange={(e) => setGlobalSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-full text-sm focus:ring-4 focus:ring-stone-100 focus:border-stone-300 transition-all outline-none shadow-sm text-stone-600 placeholder-stone-300"
                  />
                  {globalSearchTerm && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-stone-200 rounded-2xl shadow-xl z-50 max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2">
                      {allStoreNames.filter((s) => s.includes(globalSearchTerm)).length > 0 ? (
                        allStoreNames.filter((s) => s.includes(globalSearchTerm)).map((s) => (
                          <button
                            key={s}
                            onClick={() => {
                              navigateToStore(s);
                              setGlobalSearchTerm("");
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-stone-50 text-sm font-medium text-stone-600 flex items-center gap-2 transition-colors"
                          >
                            <Store size={16} className="text-stone-400" /> {s}
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-3 text-xs text-stone-400 text-center">無相符店家</div>
                      )}
                    </div>
                  )}
                </div>

                {currentDeviceTrust.deviceShort && (
                  <div
                    className={`hidden md:flex items-center justify-center rounded-full border px-2 lg:px-2.5 2xl:px-3 py-2 text-[11px] lg:text-xs font-black shadow-sm whitespace-nowrap shrink-0 max-w-[92px] lg:max-w-[112px] 2xl:max-w-none overflow-hidden ${
                      currentDeviceTrust.status === "blocked"
                        ? "border-stone-200 bg-stone-100 text-stone-700"
                        : currentDeviceTrust.status === "new"
                          ? "border-rose-100 bg-rose-50 text-rose-600"
                          : currentDeviceTrust.status === "trusted"
                            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                            : "border-stone-100 bg-stone-50 text-stone-500"
                    }`}
                    title={currentDeviceTrust.deviceShort ? `裝置碼：${currentDeviceTrust.deviceShort}` : "目前裝置狀態"}
                  >
                    <span className="2xl:hidden truncate">
                      {currentDeviceTrust.status === "blocked" ? "⛔ 已封鎖" : currentDeviceTrust.status === "new" ? "⚠ 待觀察" : currentDeviceTrust.status === "trusted" ? "🛡 已信任" : "確認中"}
                    </span>
                    <span className="hidden 2xl:inline">{currentDeviceTrust.label}</span>
                  </div>
                )}

                {["director", "master"].includes(userRole) && deviceAlertSummary.pendingNewDeviceCount > 0 && (
                  <button
                    type="button"
                    onClick={goToDeviceManagement}
                    className="hidden lg:flex items-center gap-1.5 2xl:gap-2 rounded-full border border-rose-100 bg-rose-50 px-2.5 2xl:px-3 py-2 text-xs font-black text-rose-600 shadow-sm hover:bg-rose-100 active:scale-95 transition-all whitespace-nowrap shrink-0"
                    title={deviceAlertSummary.latestUserName ? `最新：${deviceAlertSummary.latestUserName}｜${deviceAlertSummary.latestDevice}` : "有新裝置待確認"}
                  >
                    <ShieldAlert size={16} />
                    <span className="2xl:hidden">{deviceAlertSummary.pendingNewDeviceCount}</span>
                    <span className="hidden 2xl:inline">新裝置 {deviceAlertSummary.pendingNewDeviceCount}</span>
                  </button>
                )}

                <div className="flex items-center gap-2 bg-stone-100 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border border-stone-200 shrink-0 min-w-fit">
                  <Filter size={16} className="text-stone-400 hidden sm:block" />
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="bg-transparent text-sm font-bold text-stone-600 outline-none border-r border-stone-200 pr-2 mr-2 cursor-pointer hover:text-stone-800 transition-colors"
                  >
                    {[2025, 2026, 2027].map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="bg-transparent text-sm font-bold text-stone-600 outline-none cursor-pointer hover:text-stone-800 transition-colors"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>{m}月</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Mobile Header：精緻版，不讓信任膠囊擠壓年/月篩選器 */}
            <div className="md:hidden space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-center gap-2">
                  <h1 className="text-lg font-bold text-stone-800 tracking-tight truncate flex items-center gap-2 min-w-0">
                    <Coffee size={20} className="text-amber-600 shrink-0" />
                    <span className="truncate">DRCYJ Cloud</span>
                  </h1>
                  <span className="text-[10px] font-mono bg-stone-100 text-stone-400 px-1.5 py-0.5 rounded-md border border-stone-200/60 shadow-inner select-all shrink-0">
                    v{CURRENT_APP_VERSION}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {currentDeviceTrust.deviceShort && (
                    <div
                      className={`flex items-center justify-center rounded-full border px-2.5 py-1.5 text-[11px] font-black shadow-sm whitespace-nowrap ${
                        currentDeviceTrust.status === "new"
                          ? "border-rose-100 bg-rose-50 text-rose-600"
                          : currentDeviceTrust.status === "trusted"
                            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                            : "border-stone-100 bg-stone-50 text-stone-500"
                      }`}
                      title={currentDeviceTrust.deviceShort ? `裝置碼：${currentDeviceTrust.deviceShort}` : "目前裝置狀態"}
                    >
                      {currentDeviceTrust.status === "blocked"
                        ? "⛔ 已封鎖"
                        : currentDeviceTrust.status === "new"
                          ? "⚠ 待觀察"
                          : currentDeviceTrust.status === "trusted"
                            ? "🛡 已信任"
                            : "確認中"}
                    </div>
                  )}

                  {["director", "master"].includes(userRole) && deviceAlertSummary.pendingNewDeviceCount > 0 && (
                    <button
                      type="button"
                      onClick={goToDeviceManagement}
                      className="flex items-center justify-center rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1.5 text-[11px] font-black text-rose-600 shadow-sm whitespace-nowrap"
                      title={deviceAlertSummary.latestUserName ? `最新：${deviceAlertSummary.latestUserName}｜${deviceAlertSummary.latestDevice}` : "有新裝置待確認"}
                    >
                      <ShieldAlert size={13} />
                      {deviceAlertSummary.pendingNewDeviceCount}
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 bg-white px-3 py-2.5 rounded-2xl border border-stone-200 shadow-sm min-w-0">
                  <Calendar size={17} className="text-stone-400 shrink-0" />
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="w-full min-w-0 bg-transparent text-sm font-black text-stone-700 outline-none cursor-pointer"
                  >
                    {[2025, 2026, 2027].map((y) => (
                      <option key={y} value={y}>{y} 年</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 bg-white px-3 py-2.5 rounded-2xl border border-stone-200 shadow-sm min-w-0">
                  <Calendar size={17} className="text-stone-400 shrink-0" />
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full min-w-0 bg-transparent text-sm font-black text-stone-700 outline-none cursor-pointer"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>{m} 月</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </header>
          <MobileTopNav activeView={activeView} setActiveView={handleProtectedSetActiveView} permissions={permissions} userRole={userRole} onLogout={() => handleLogout()} canAccessView={canDirectorAccessView} />
          
          {memoizedViews}
          
        </div>

        {isLowPowerMode && (
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-2rem)] max-w-2xl animate-in fade-in slide-in-from-bottom-3 duration-300">
            <div className="relative overflow-hidden rounded-[1.65rem] border border-amber-100/80 bg-[#FFFCF7]/95 px-4 py-3.5 shadow-[0_18px_50px_rgba(120,95,55,0.16)] backdrop-blur-xl">
              <div className="absolute -left-12 -top-12 h-28 w-28 rounded-full bg-amber-100/60 blur-3xl pointer-events-none" />
              <div className="absolute -right-10 bottom-0 h-24 w-24 rounded-full bg-stone-100/80 blur-2xl pointer-events-none" />

              <div className="relative flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FFF7DF] via-[#FFFDF7] to-[#F1E7D6] border border-amber-100 text-[#B7863D] flex items-center justify-center shrink-0 shadow-[0_8px_22px_rgba(190,145,70,0.12)]">
                    <Activity size={20} strokeWidth={1.9} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black tracking-tight text-stone-800">系統已進入省流量待機</p>
                    <p className="text-xs text-stone-500 mt-0.5 font-bold leading-relaxed">已暫停高流量即時監聽；移動滑鼠、點擊或觸控即可恢復。</p>
                  </div>
                </div>

                <button
                  onClick={handleUserActivity}
                  className="h-10 px-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] text-xs font-black shadow-[0_8px_20px_rgba(190,145,70,0.16)] hover:brightness-[1.02] active:scale-[0.98] transition-all shrink-0"
                >
                  立即恢復
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && (<Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />)}
        <ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={closeConfirmModal} />
        
        {showIdleWarning && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-stone-900/35 backdrop-blur-md animate-in fade-in duration-300">
            <div className="relative w-full max-w-[430px] overflow-hidden rounded-[2rem] border border-white/70 bg-[#FFFCF7]/95 shadow-[0_24px_80px_rgba(80,65,45,0.18)] animate-in zoom-in-95 slide-in-from-bottom-3 duration-500">
              <div className="absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-amber-100/60 blur-3xl pointer-events-none" />
              <div className="absolute -right-20 bottom-10 h-40 w-40 rounded-full bg-stone-100/80 blur-3xl pointer-events-none" />
              <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-amber-200 to-transparent" />

              <div className="relative px-7 pt-8 pb-7 md:px-8 md:pt-9 md:pb-8 text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-amber-100 bg-gradient-to-br from-[#FFF8E8] via-[#FFFDF7] to-[#F6EFE2] text-[#B7863D] shadow-[0_10px_30px_rgba(190,145,70,0.14)]">
                  <Shield size={28} strokeWidth={1.8} />
                </div>

                <div className="mb-3 flex items-center justify-center gap-2">
                  <span className="h-px w-8 bg-amber-200/80" />
                  <span className="text-[11px] font-black tracking-[0.28em] text-[#B7863D]">
                    資料安全提醒
                  </span>
                  <span className="h-px w-8 bg-amber-200/80" />
                </div>

                <h3 className="mb-3 text-2xl font-black tracking-tight text-stone-800">
                  為您保護營運資料安全
                </h3>

                <p className="mx-auto mb-6 max-w-[330px] text-sm font-bold leading-7 text-stone-500">
                  系統偵測到您已暫時離開。為避免營運資料停留於公開畫面，將於倒數結束後自動登出。
                </p>

                <div className="mb-6 rounded-[1.5rem] border border-stone-100 bg-white/70 px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_30px_rgba(120,100,70,0.06)]">
                  <div className="flex items-end justify-center gap-2">
                    <span className="text-6xl md:text-7xl font-black leading-none tracking-tight text-[#5A4A3A] tabular-nums">
                      {countdown}
                    </span>
                    <span className="mb-2 text-sm font-black text-[#B7863D]">秒</span>
                  </div>

                  <p className="mt-2 text-xs font-bold text-stone-400">
                    倒數結束後將自動登出
                  </p>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#E8C77A] via-[#D6A84F] to-[#B7863D] transition-all duration-1000 ease-linear"
                      style={{
                        width: `${Math.max(
                          4,
                          Math.min(
                            100,
                            (countdown /
                              Math.max(
                                1,
                                Number(
                                  securityConfig?.logoutWarningSeconds ||
                                    securityConfig?.warningSeconds ||
                                    60
                                )
                              )) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => handleLogout('使用者於閒置提醒中手動登出')}
                    className="order-2 sm:order-1 h-12 rounded-2xl border border-stone-200 bg-white/80 px-5 text-sm font-black text-stone-500 transition-all hover:bg-stone-50 hover:text-stone-700 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <LogOut size={16} strokeWidth={2.2} />
                    立即登出
                  </button>

                  <button
                    onClick={handleStayLoggedIn}
                    className="order-1 sm:order-2 h-12 rounded-2xl border border-amber-200 bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] px-5 text-sm font-black text-[#5A4225] shadow-[0_10px_24px_rgba(190,145,70,0.18)] transition-all hover:brightness-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <CheckCircle size={17} strokeWidth={2.4} />
                    繼續使用
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </AppContext.Provider>
  );
}