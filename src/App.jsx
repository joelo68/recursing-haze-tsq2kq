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
  app, auth, db, appId } from "./config/firebase"; import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "firebase/auth"; import { collection, addDoc, deleteDoc, updateDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, query, orderBy, limit, deleteField, where, increment, getDocs, documentId } from "firebase/firestore"; import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line, ComposedChart, Area, Cell, PieChart, Pie } from "recharts"; import {    LayoutDashboard, Upload, TrendingUp, Map as MapIcon, Settings, ClipboardCheck, Menu, Search, Filter, Trash2, Save, Plus, DollarSign, Target, Users, Award, Loader2, FileText, AlertCircle, CheckCircle, User, Store, Lock, LogOut, FileWarning, Edit2, CheckSquare, X, Download, ChevronLeft, ChevronRight, Activity, Sparkles, ChevronDown, Heart, Coffee, Shield, WifiOff, ShoppingBag, CreditCard, Smartphone, Monitor, Bell, Clock, Music, ShieldAlert, Calendar
} from "lucide-react";

import { ROLES, ALL_MENU_ITEMS, DEFAULT_REGIONAL_MANAGERS, DEFAULT_PERMISSIONS } from "./constants/index";
import { generateUUID, formatLocalYYYYMMDD, toStandardDateFormat, formatNumber, parseNumber, normalizeManagerOrder } from "./utils/helpers";
import { validPositiveSetting } from "./utils/kpiContracts";
import { resolveHistoricalDashboardReadPolicy } from "./utils/dashboardReadPolicy";
import { buildAnnualAggregateYearMonthCandidates, normalizeAnnualYearMonth, resolveAnnualReadPlan } from "./utils/annualReadPolicy";
import { isFormalReportSummaryPairCompatible } from "./utils/reportFormalConsumer";
import {
  buildDelegationAccessProfile,
  canAccessStore as canAccessDelegatedStore,
  canPerformDelegatedStoreAction,
  getDelegationForStore as resolveDelegationForStore,
  getLocalDateString,
  resolveActiveDelegations,
} from "./utils/delegationResolver";
import { ViewWrapper, Card, Skeleton, Toast, ConfirmModal } from "./components/SharedUI";
import { Sidebar, MobileTopNav } from "./components/Navigation";
import { AppContext } from "./AppContext";
import { useAnalytics } from "./hooks/useAnalytics";
import TherapistManagerView from "./components/TherapistManagerView";
import LoginView from "./components/LoginView";
import DeviceApprovalGate from "./components/DeviceApprovalGate";
import DeviceApprovalPanel from "./components/DeviceApprovalPanel";
import {
  trackSnapshotRead,
  trackReadSource,
  flushReadTrackerToFirestore,
  setReadTrackerMode,
  resolveReadTrackerModeFromConfig,
  getReadTrackerScheduleStatus,
  getReadTrackerNextScheduleBoundaryDelayMs,
} from "./utils/readTracker";

// ==========================================
// ★ 系統核心版本號 (終極動態快取版)
// ==========================================
const CURRENT_APP_VERSION = "3.5.3";
const LOGIN_LOCATION_ENDPOINT = "https://resolveloginlocation-hyhcwrnyaa-uc.a.run.app";
const DEVICE_ACCESS_ENDPOINT = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/checkDeviceAccess";
const DEVICE_APPROVAL_REVIEW_ENDPOINT = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/reviewDeviceApproval";
const DEVICE_MANAGEMENT_ENDPOINT = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageAccountDevice";
const DEVICE_EMERGENCY_ENDPOINT = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/emergencyUnblockDevice";
const LOGIN_SECURITY_EVENT_ENDPOINT = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/reportLoginSecurityEvent";
const TELEGRAM_SECURITY_CONFIG_ENDPOINT = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/updateTelegramSecurityAlertConfig";


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
  // 新裝置登入保護預設關閉：新版部署不會突然改變既有登入行為。
  deviceApprovalMode: "off",
  deviceApprovalRoles: ["director", "trainer", "manager", "store", "therapist"],
  deviceApprovalExpiryMinutes: 15,
  allowTrustedDeviceSelfApproval: true,
};

const DEFAULT_FEATURE_FLAGS = {
  therapistModuleEnabled: true,
  annualAverageSettings: {
    brandStartMonth: "",
    autoDetectFirstCompleteMonth: true,
    excludePartialFirstMonth: true,
    storeStartMonthOverrides: {},
  },
};

const normalizeFeatureFlags = (flags = {}) => {
  const rawAnnualAverageSettings = flags?.annualAverageSettings || {};
  return {
    ...DEFAULT_FEATURE_FLAGS,
    ...(flags || {}),
    therapistModuleEnabled: flags?.therapistModuleEnabled !== false,
    annualAverageSettings: {
      ...DEFAULT_FEATURE_FLAGS.annualAverageSettings,
      ...rawAnnualAverageSettings,
      storeStartMonthOverrides:
        rawAnnualAverageSettings?.storeStartMonthOverrides &&
        typeof rawAnnualAverageSettings.storeStartMonthOverrides === "object"
          ? rawAnnualAverageSettings.storeStartMonthOverrides
          : {},
    },
  };
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
  deviceApprovalMode: ["off", "monitor", "enforce"].includes(config.deviceApprovalMode) ? config.deviceApprovalMode : DEFAULT_SECURITY_CONFIG.deviceApprovalMode,
  deviceApprovalRoles: Array.isArray(config.deviceApprovalRoles) && config.deviceApprovalRoles.length ? config.deviceApprovalRoles : DEFAULT_SECURITY_CONFIG.deviceApprovalRoles,
  deviceApprovalExpiryMinutes: Math.max(5, Math.min(60, Number(config.deviceApprovalExpiryMinutes ?? DEFAULT_SECURITY_CONFIG.deviceApprovalExpiryMinutes))),
  allowTrustedDeviceSelfApproval: config.allowTrustedDeviceSelfApproval !== false,
});

const DEVICE_APPROVAL_ROLE_LABELS = {
  director: "高階主管",
  trainer: "教專",
  manager: "區長",
  store: "店經理",
  therapist: "管理師",
};

const formatDeviceApprovalNoticeTime = (value = "") => {
  if (!value) return "剛剛";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "剛剛";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

const getDeviceApprovalResolvedText = (request = {}) => {
  const resolvedBy = String(request?.resolvedBy || "其他最高管理者").trim() || "其他最高管理者";
  const status = String(request?.status || "");
  if (status === "approved") return `已由 ${resolvedBy} 完成確認`;
  if (status === "observing") return `已由 ${resolvedBy} 設為繼續觀察`;
  if (status === "reverify_required") return `已由 ${resolvedBy} 要求重新驗證`;
  if (status === "blocked") return `已由 ${resolvedBy} 禁止此裝置使用`;
  if (status === "rejected") return `已由 ${resolvedBy} 完成安全處理`;
  return `已由 ${resolvedBy} 完成處理`;
};


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

const sanitizeSecurityKey = (value = "") => {
  return String(value || "")
    .trim()
    .replace(/[\/.#$\[\]\s]+/g, "_")
    .slice(0, 120) || "unknown";
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
const OPERATIONAL_FORMAL_LIFECYCLE_VIEWS = new Set(["dashboard", "regional", "ranking", "daily", "audit", "store-analysis"]);
const HISTORICAL_SUMMARY_READINESS_RECOVERY_DELAY_MS = 10_000;
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
  const [deviceApprovalSummary, setDeviceApprovalSummary] = useState({
    myPendingCount: 0,
    brandPendingCount: 0,
    adminAssistancePendingCount: 0,
    adminAssistancePendingItems: [],
    latestAdminAssistanceRequestId: "",
    latestAdminAssistanceUserName: "",
    latestAdminAssistanceRole: "",
    latestAdminAssistanceDevice: "",
    latestAdminAssistanceAtText: "",
    latestUserName: "",
    latestDevice: "",
    latestAtText: "",
  });
  const [isDeviceApprovalPanelOpen, setIsDeviceApprovalPanelOpen] = useState(false);
  const [guidedDeviceApprovalRequestId, setGuidedDeviceApprovalRequestId] = useState("");
  // ★ 最高管理者 Security Action Card：只提醒「需要主管協助」的正式模式待確認申請。
  const [superAdminDeviceNotice, setSuperAdminDeviceNotice] = useState(null);
  const [superAdminApprovalFocusId, setSuperAdminApprovalFocusId] = useState("");
  const superAdminNoticeSeenRef = useRef(new Set());
  const superAdminNoticeResolveTimerRef = useRef(null);
  const [pendingDeviceLogin, setPendingDeviceLogin] = useState(null);
  const pendingDeviceLoginRef = useRef(null);
  // 僅保存在目前頁面記憶體中，供需要較高權限的裝置確認動作再次向後端驗證。
  // 不寫入 Firestore / localStorage / sessionStorage。
  const securitySessionCredentialRef = useRef("");
  const [currentDeviceTrust, setCurrentDeviceTrust] = useState({
    status: "checking",
    label: "裝置狀態確認中",
    deviceShort: "",
    deviceId: "",
    approvalRequestId: "",
  });

  const [isUpdating, setIsUpdating] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );

  const currentBrand = useMemo(() => BRANDS.find(b => b.id === currentBrandId) || BRANDS[0], [currentBrandId]);
  const currentBrandIdRef = useRef(currentBrandId);

  useEffect(() => {
    currentBrandIdRef.current = currentBrandId;
  }, [currentBrandId]);

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
  const [readTrackerConfigState, setReadTrackerConfigState] = useState(readTrackerConfigRef.current);

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

  const currentSecurityAccountRawId = useMemo(() => (
    String(currentUser?.securityAccountId || currentUser?.id || currentUser?.accountId || currentUser?.name || userRole || "").trim()
  ), [currentUser, userRole]);

  const currentSecurityAccountId = useMemo(() => (
    sanitizeSecurityKey(currentSecurityAccountRawId)
  ), [currentSecurityAccountRawId]);

  const currentSecurityAccountKey = useMemo(() => (
    userRole && currentSecurityAccountId
      ? sanitizeSecurityKey(`${currentBrandId}_${userRole}_${currentSecurityAccountId}`)
      : ""
  ), [currentBrandId, userRole, currentSecurityAccountId]);

  const isDeviceSecuritySuperAdmin = Boolean(
    userRole === "director" && (
      currentUser?.directorLevel === "super_admin" ||
      currentUser?.isSuperAdmin === true ||
      currentUser?.isMasterLogin === true
    )
  );

  // 新版 Header 只監聽極小的待確認摘要，不再為了紅色數字讀完整 account_devices。
  useEffect(() => {
    if (!userRole || !currentUser || !currentSecurityAccountKey) {
      setDeviceApprovalSummary({
        myPendingCount: 0,
        brandPendingCount: 0,
        adminAssistancePendingCount: 0,
        adminAssistancePendingItems: [],
        latestAdminAssistanceRequestId: "",
        latestAdminAssistanceUserName: "",
        latestAdminAssistanceRole: "",
        latestAdminAssistanceDevice: "",
        latestAdminAssistanceAtText: "",
        latestUserName: "",
        latestDevice: "",
        latestAtText: "",
      });
      return undefined;
    }

    const unsubscribers = [];
    const myInboxRef = doc(getCollectionPath("device_approval_inbox"), currentSecurityAccountKey);
    unsubscribers.push(onSnapshot(myInboxRef, (snap) => {
      const data = snap.exists() ? snap.data() || {} : {};
      setDeviceApprovalSummary((prev) => ({
        ...prev,
        myPendingCount: Math.max(0, Number(data.pendingCount || 0)),
      }));
    }, (error) => console.warn("讀取我的新裝置提醒失敗:", error)));

    if (isDeviceSecuritySuperAdmin) {
      unsubscribers.push(onSnapshot(getSecuritySummaryDocPath("device_approvals"), (snap) => {
        const data = snap.exists() ? snap.data() || {} : {};
        const adminAssistancePendingItems = Array.isArray(data.adminAssistancePendingItems)
          ? data.adminAssistancePendingItems.filter((item) => item && item.requestId).slice(0, 50)
          : [];
        setDeviceApprovalSummary((prev) => ({
          ...prev,
          brandPendingCount: Math.max(0, Number(data.pendingCount || 0)),
          adminAssistancePendingCount: Math.max(0, Number(data.adminAssistancePendingCount || 0)),
          adminAssistancePendingItems,
          latestAdminAssistanceRequestId: data.latestAdminAssistanceRequestId || "",
          latestAdminAssistanceUserName: data.latestAdminAssistanceUserName || "",
          latestAdminAssistanceRole: data.latestAdminAssistanceRole || "",
          latestAdminAssistanceDevice: data.latestAdminAssistanceDevice || "",
          latestAdminAssistanceAtText: data.latestAdminAssistanceAtText || "",
          latestUserName: data.latestUserName || "",
          latestDevice: data.latestDevice || "",
          latestAtText: data.latestAtText || data.updatedAtText || "",
        }));
      }, (error) => console.warn("讀取待確認裝置摘要失敗:", error)));
    } else {
      setDeviceApprovalSummary((prev) => ({
        ...prev,
        brandPendingCount: 0,
        adminAssistancePendingCount: 0,
        adminAssistancePendingItems: [],
        latestAdminAssistanceRequestId: "",
        latestAdminAssistanceUserName: "",
        latestAdminAssistanceRole: "",
        latestAdminAssistanceDevice: "",
        latestAdminAssistanceAtText: "",
      }));
    }

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
  }, [userRole, currentUser, currentSecurityAccountKey, isDeviceSecuritySuperAdmin, getCollectionPath, getSecuritySummaryDocPath]);

  const openDeviceApprovalPanel = useCallback(() => {
    // 從 Header Badge 手動進入時顯示完整待確認清單，不鎖定特定提醒案件。
    setSuperAdminApprovalFocusId("");
    setIsDeviceApprovalPanelOpen(true);
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {};
      if (!detail.deviceShort && !detail.deviceId) return;

      setCurrentDeviceTrust((prev) => {
        const isSameDevice =
          (detail.deviceId && prev.deviceId && detail.deviceId === prev.deviceId) ||
          (detail.deviceShort && prev.deviceShort && detail.deviceShort === prev.deviceShort);

        if (!isSameDevice) return prev;

        const isBlocked = detail.status === "blocked" || detail.source === "manual_blocked";
        const isTrusted = detail.status === "trusted" || detail.trusted === true;
        const isObserving = detail.status === "observing" || detail.source === "manual_observing";
        const isReverifyRequired = detail.status === "reverify_required" || detail.source === "manual_reverify_required";
        const nextStatus = isBlocked
          ? "blocked"
          : isTrusted
            ? "trusted"
            : isReverifyRequired
              ? "reverify_required"
              : isObserving
                ? "observing"
                : "new";
        const nextLabel = nextStatus === "blocked"
          ? "⛔ 此裝置已停用"
          : nextStatus === "trusted"
            ? "🛡 目前裝置已信任"
            : nextStatus === "reverify_required"
              ? "⚠ 主管要求重新驗證"
              : nextStatus === "observing"
                ? "⚠ 新裝置待觀察"
                : "⚠ 新裝置待確認";
        return {
          ...prev,
          status: nextStatus,
          label: nextLabel,
          deviceShort: detail.deviceShort || prev.deviceShort,
          deviceId: detail.deviceId || prev.deviceId,
          approvalRequestId: ["trusted", "blocked", "observing", "reverify_required"].includes(nextStatus) ? "" : prev.approvalRequestId,
        };
      });
    };

    window.addEventListener("cyj_device_trust_updated", handler);
    return () => window.removeEventListener("cyj_device_trust_updated", handler);
  }, []);

  // Monitor 模式下，新裝置已經能進入系統，因此要額外同步「目前這台裝置」的確認結果。
  // iPhone / Safari 私密瀏覽可能暫停背景 request listener；因此採三層同步：
  // 1. request 即時監聽；2. 我的待確認數歸零時主動確認一次；3. 回到前景時再確認一次。
  // 全程只讀目前這一筆 request，不讀完整裝置歷史，也不做固定秒數輪詢。
  const deviceApprovalReconcileRef = useRef({
    inFlight: false,
    lastRequestId: "",
    lastCheckedAt: 0,
  });
  const previousMyPendingCountRef = useRef(0);

  const applyCurrentDeviceApprovalResult = useCallback((requestId, data = {}) => {
    const requestStatus = String(data?.status || "pending");

    if (requestStatus === "approved") {
      setCurrentDeviceTrust((prev) => {
        if (String(prev?.approvalRequestId || "") !== String(requestId || "")) return prev;
        return {
          ...prev,
          status: "trusted",
          label: "🛡 目前裝置已信任",
          approvalRequestId: "",
        };
      });
      return true;
    }

    if (["observing", "reverify_required", "blocked", "rejected", "expired"].includes(requestStatus)) {
      setCurrentDeviceTrust((prev) => {
        if (String(prev?.approvalRequestId || "") !== String(requestId || "")) return prev;

        if (requestStatus === "blocked") {
          return {
            ...prev,
            status: "blocked",
            label: "⛔ 此裝置已停用",
            approvalRequestId: "",
          };
        }

        if (requestStatus === "reverify_required") {
          return {
            ...prev,
            status: "reverify_required",
            label: "⚠ 主管要求重新驗證",
            approvalRequestId: "",
          };
        }

        if (requestStatus === "observing") {
          return {
            ...prev,
            status: "observing",
            label: "⚠ 新裝置待觀察",
            approvalRequestId: "",
          };
        }

        return {
          ...prev,
          status: prev.status === "suspicious" ? "suspicious" : "new",
          label: prev.status === "suspicious" ? "⚠ 需要管理者確認" : "⚠ 新裝置待確認",
          approvalRequestId: "",
        };
      });
      return true;
    }

    return false;
  }, []);

  const refreshCurrentDeviceApprovalStatus = useCallback(async (reason = "foreground") => {
    const requestId = String(currentDeviceTrust?.approvalRequestId || "").trim();
    const shouldRefresh = Boolean(
      userRole &&
      currentUser &&
      requestId &&
      ["new", "suspicious"].includes(currentDeviceTrust?.status)
    );
    if (!shouldRefresh) return false;

    const state = deviceApprovalReconcileRef.current;
    const now = Date.now();

    // visibilitychange + focus + pageshow 可能在極短時間內連續觸發，只允許一次小型確認讀取。
    if (state.inFlight) return false;
    if (state.lastRequestId === requestId && now - Number(state.lastCheckedAt || 0) < 1200) return false;

    state.inFlight = true;
    state.lastRequestId = requestId;
    state.lastCheckedAt = now;

    try {
      const requestRef = doc(getCollectionPath("device_approval_requests"), requestId);
      const snap = await getDoc(requestRef);
      if (!snap.exists()) return false;
      return applyCurrentDeviceApprovalResult(requestId, snap.data() || {});
    } catch (error) {
      console.warn(`重新確認目前裝置狀態失敗 (${reason}):`, error);
      return false;
    } finally {
      state.inFlight = false;
    }
  }, [
    userRole,
    currentUser,
    currentDeviceTrust?.approvalRequestId,
    currentDeviceTrust?.status,
    getCollectionPath,
    applyCurrentDeviceApprovalResult,
  ]);

  useEffect(() => {
    const requestId = String(currentDeviceTrust?.approvalRequestId || "").trim();
    const shouldWatch = Boolean(
      userRole &&
      currentUser &&
      requestId &&
      ["new", "suspicious"].includes(currentDeviceTrust?.status)
    );
    if (!shouldWatch) return undefined;

    const requestRef = doc(getCollectionPath("device_approval_requests"), requestId);
    return onSnapshot(requestRef, (snap) => {
      if (!snap.exists()) return;
      applyCurrentDeviceApprovalResult(requestId, snap.data() || {});
    }, (error) => {
      console.warn("同步目前裝置確認結果失敗:", error);
    });
  }, [
    userRole,
    currentUser,
    currentDeviceTrust?.approvalRequestId,
    currentDeviceTrust?.status,
    getCollectionPath,
    applyCurrentDeviceApprovalResult,
  ]);

  // 實測上 iPhone 私密瀏覽的「待確認數」會先即時歸零，因此把 1 -> 0 當成一次性 reconciliation 訊號。
  // 這不是輪詢，只在真的有待確認紀錄被處理完成時多讀目前 request 一次。
  useEffect(() => {
    const nextCount = Math.max(0, Number(deviceApprovalSummary?.myPendingCount || 0));
    const previousCount = Math.max(0, Number(previousMyPendingCountRef.current || 0));
    previousMyPendingCountRef.current = nextCount;

    const currentRequestId = String(currentDeviceTrust?.approvalRequestId || "").trim();
    const stillWaiting = Boolean(
      currentRequestId &&
      ["new", "suspicious"].includes(currentDeviceTrust?.status)
    );

    if (previousCount > 0 && nextCount === 0 && stillWaiting) {
      refreshCurrentDeviceApprovalStatus("pending-count-cleared");
    }
  }, [
    deviceApprovalSummary?.myPendingCount,
    currentDeviceTrust?.approvalRequestId,
    currentDeviceTrust?.status,
    refreshCurrentDeviceApprovalStatus,
  ]);

  // 手機瀏覽器從背景回到前景時主動確認目前這一筆 request。
  // Safari / PWA 可能以 visibilitychange、focus 或 pageshow 任一事件恢復，因此三者都接，內部已有 1.2 秒去重。
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;

    const refreshIfVisible = () => {
      if (document.visibilityState === "hidden") return;
      refreshCurrentDeviceApprovalStatus("foreground");
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshIfVisible();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("pageshow", refreshIfVisible);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("pageshow", refreshIfVisible);
    };
  }, [refreshCurrentDeviceApprovalStatus]);

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
  const [annualSummaryLoadState, setAnnualSummaryLoadState] = useState({
    brandId: "",
    year: "",
    dashboardReady: false,
    flagsReady: false,
    dashboardError: "",
    flagsError: "",
  });
  const [therapistAnnualAggregatedData, setTherapistAnnualAggregatedData] = useState([]); // ★新增：管理師專屬結算包
  const [budgets, setBudgets] = useState({});
  const [monthlyTargetSummary, setMonthlyTargetSummary] = useState(null); // ★ monthly_targets_summary/{yearMonth}：Dashboard 目標資料輕量即時來源
  const [currentLifecycleMasterState, setCurrentLifecycleMasterState] = useState({
    brandId: "",
    ready: false,
    data: null,
    error: null,
  });
  const [currentDashboardSummary, setCurrentDashboardSummary] = useState(null); // ★ 報表 summary-first：Ranking / Regional / Dashboard 共用單一來源
  const [currentRankingsSummary, setCurrentRankingsSummary] = useState(null);
  const [currentReportSummaryReady, setCurrentReportSummaryReady] = useState(false);
  const [currentReportSummaryReadyYearMonth, setCurrentReportSummaryReadyYearMonth] = useState("");
  const [currentReportSummaryReadyBrandId, setCurrentReportSummaryReadyBrandId] = useState("");
  const [currentSummaryRecalcFlagState, setCurrentSummaryRecalcFlagState] = useState({
    brandId: "",
    yearMonth: "",
    ready: false,
    data: null,
    error: null,
  });
  // ★ 歷史月份 dirty-triggered refresh：Summary 失效時只重新抓取該月份明細一次，
  // 不恢復歷史月份長駐 onSnapshot，兼顧資料正確性與 reads。
  const [historicalDetailRefreshToken, setHistoricalDetailRefreshToken] = useState(0);
  const [historicalDetailRefreshState, setHistoricalDetailRefreshState] = useState({
    yearMonth: "",
    status: "idle", // idle | requested | loading | ready | error
    lastDirtyAtText: "",
    requestedAtText: "",
    loadedAtText: "",
    error: "",
  });
  const [targets, setTargets] = useState({ newASP: null, trafficASP: 1200, benchmarks: {} });
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
  // ★ 期間式代理與托管：獨立於正式 org_structure，不改寫正式隸屬。
  const [delegations, setDelegations] = useState([]);
  const [delegationDateKey, setDelegationDateKey] = useState(() => getLocalDateString());

  const [securityConfig, setSecurityConfig] = useState(DEFAULT_SECURITY_CONFIG);
  const [featureFlags, setFeatureFlags] = useState(DEFAULT_FEATURE_FLAGS);

  // ★ Guided Device Approval：正式模式下，只要「自己的新裝置」正在等待確認，
  // 原本已信任的裝置會主動進入確認流程，不再要求一般使用者自己注意 Header Badge。
  // 先透過極小的 inbox pendingCount 判斷；只有真的有待確認時，才額外查最多 10 筆自己的 pending request。
  const guidedDeviceApprovalLookupRef = useRef({ key: "", inFlight: false });

  useEffect(() => {
    const pendingCount = Math.max(0, Number(deviceApprovalSummary?.myPendingCount || 0));
    const canGuide = Boolean(
      userRole &&
      currentUser &&
      currentSecurityAccountKey &&
      securityConfig?.deviceApprovalMode === "enforce" &&
      currentDeviceTrust?.status === "trusted" &&
      pendingCount > 0
    );

    if (!canGuide) {
      guidedDeviceApprovalLookupRef.current.key = "";
      if (pendingCount === 0 || currentDeviceTrust?.status !== "trusted" || securityConfig?.deviceApprovalMode !== "enforce") {
        setGuidedDeviceApprovalRequestId("");
      }
      return undefined;
    }

    const lookupKey = [
      currentBrandId,
      currentSecurityAccountKey,
      pendingCount,
      currentDeviceTrust?.deviceId || "",
    ].join("|");
    const lookupState = guidedDeviceApprovalLookupRef.current;
    if (lookupState.inFlight || lookupState.key === lookupKey) return undefined;

    lookupState.inFlight = true;
    lookupState.key = lookupKey;
    let cancelled = false;

    (async () => {
      try {
        const pendingQuery = query(
          getCollectionPath("device_approval_requests"),
          where("accountKey", "==", currentSecurityAccountKey),
          where("status", "==", "pending"),
          limit(10)
        );
        const snap = await getDocs(pendingQuery);
        const now = Date.now();
        const actionable = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
          .filter((request) => (
            request.status === "pending" &&
            Number(request.expiresAtMs || 0) > now &&
            request.selfApprovalAllowed !== false &&
            String(request.deviceId || "") !== String(currentDeviceTrust?.deviceId || "")
          ))
          .sort((a, b) => String(a.requestedAtText || "").localeCompare(String(b.requestedAtText || "")))[0];

        if (cancelled) return;
        if (actionable?.id) {
          // Guided flow 優先於一般抽屜，避免同時出現兩層裝置確認 UI。
          setIsDeviceApprovalPanelOpen(false);
          setGuidedDeviceApprovalRequestId(String(actionable.id));
        } else {
          setGuidedDeviceApprovalRequestId("");
        }
      } catch (error) {
        console.warn("主動新裝置確認載入失敗:", error);
      } finally {
        guidedDeviceApprovalLookupRef.current.inFlight = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    userRole,
    currentUser,
    currentSecurityAccountKey,
    currentBrandId,
    securityConfig?.deviceApprovalMode,
    currentDeviceTrust?.status,
    currentDeviceTrust?.deviceId,
    deviceApprovalSummary?.myPendingCount,
    getCollectionPath,
  ]);

  // ★ Highest-admin Security Action Card — Summary-first
  // 後端已把「需要最高管理者協助」的 pending 小佇列直接寫進原本的
  // security_summary/device_approvals。最高管理者沿用既有 summary onSnapshot 即可判斷是否提醒，
  // 不再因 brandPendingCount 變化而額外 query device_approval_requests。
  // 同一 requestId 在同一登入工作階段只主動出現一次；按「稍後處理」後 Badge 仍會保留。
  useEffect(() => {
    const adminPendingCount = Math.max(0, Number(deviceApprovalSummary?.adminAssistancePendingCount || 0));
    const adminItems = Array.isArray(deviceApprovalSummary?.adminAssistancePendingItems)
      ? deviceApprovalSummary.adminAssistancePendingItems
      : [];

    const canNotify = Boolean(
      isDeviceSecuritySuperAdmin &&
      securityConfig?.deviceApprovalMode === "enforce" &&
      currentDeviceTrust?.status === "trusted" &&
      adminPendingCount > 0 &&
      !guidedDeviceApprovalRequestId
    );

    // 已完成狀態交由單筆 request listener 的 2.2 秒完成提示自行收尾，
    // 不因 summary count 先歸零而提前把完成訊息吃掉。
    if (superAdminDeviceNotice?.uiStatus === "resolved") return undefined;

    if (!canNotify) {
      if (!superAdminDeviceNotice && (
        adminPendingCount === 0 ||
        securityConfig?.deviceApprovalMode !== "enforce" ||
        !isDeviceSecuritySuperAdmin
      )) {
        setSuperAdminDeviceNotice(null);
      }
      return undefined;
    }

    // 主管正在完整 Panel 中時，視為已經看到目前這批主管待辦；
    // 記住 requestId，避免關閉 Panel 後又補跳同一批卡片。
    if (isDeviceApprovalPanelOpen) {
      adminItems.forEach((item) => {
        const requestId = String(item?.requestId || "");
        if (requestId) superAdminNoticeSeenRef.current.add(requestId);
      });
      return undefined;
    }

    if (superAdminDeviceNotice) return undefined;

    const actionable = adminItems.find((item) => {
      const requestId = String(item?.requestId || "");
      return requestId && !superAdminNoticeSeenRef.current.has(requestId);
    });
    if (!actionable?.requestId) return undefined;

    const requestId = String(actionable.requestId);
    superAdminNoticeSeenRef.current.add(requestId);
    setSuperAdminDeviceNotice({
      id: requestId,
      requestId,
      status: "pending",
      uiStatus: "pending",
      userName: actionable.userName || deviceApprovalSummary?.latestAdminAssistanceUserName || "使用者",
      role: actionable.role || deviceApprovalSummary?.latestAdminAssistanceRole || "",
      device: actionable.device || "裝置",
      browser: actionable.browser || "瀏覽器",
      os: actionable.os || "-",
      deviceShort: actionable.deviceShort || "",
      requestedAtText: actionable.requestedAtText || deviceApprovalSummary?.latestAdminAssistanceAtText || "",
      loginLocation: { display: actionable.loginLocationDisplay || "位置未確認" },
      hasTrustedApproverDevice: actionable.hasTrustedApproverDevice !== false,
      deviceStatus: actionable.deviceStatus || "new",
      selfApprovalAllowed: false,
      approvalMode: "enforce",
      adminOnly: true,
    });
    return undefined;
  }, [
    currentBrandId,
    isDeviceSecuritySuperAdmin,
    securityConfig?.deviceApprovalMode,
    currentDeviceTrust?.status,
    deviceApprovalSummary?.adminAssistancePendingCount,
    deviceApprovalSummary?.adminAssistancePendingItems,
    deviceApprovalSummary?.latestAdminAssistanceUserName,
    deviceApprovalSummary?.latestAdminAssistanceRole,
    deviceApprovalSummary?.latestAdminAssistanceAtText,
    guidedDeviceApprovalRequestId,
    isDeviceApprovalPanelOpen,
    superAdminDeviceNotice,
  ]);

  // 通知卡顯示期間只監聽「這一筆 request」；如果其他最高管理者先完成，
  // 立刻把卡片轉成「已由 XXX 完成確認」，短暫顯示後自動收起。
  useEffect(() => {
    const requestId = String(superAdminDeviceNotice?.id || "");
    if (!requestId || superAdminDeviceNotice?.uiStatus === "resolved") return undefined;

    const requestRef = doc(getCollectionPath("device_approval_requests"), requestId);
    return onSnapshot(requestRef, (snap) => {
      if (!snap.exists()) {
        setSuperAdminDeviceNotice(null);
        return;
      }

      const data = snap.data() || {};
      const status = String(data.status || "pending");
      if (status === "pending") {
        setSuperAdminDeviceNotice((prev) => (
          prev?.id === requestId ? { ...prev, ...data, id: requestId, uiStatus: "pending" } : prev
        ));
        return;
      }

      const resolvedNotice = {
        ...data,
        id: requestId,
        uiStatus: "resolved",
        resolvedText: getDeviceApprovalResolvedText(data),
      };
      setSuperAdminDeviceNotice(resolvedNotice);

      if (superAdminNoticeResolveTimerRef.current) {
        window.clearTimeout(superAdminNoticeResolveTimerRef.current);
      }
      superAdminNoticeResolveTimerRef.current = window.setTimeout(() => {
        setSuperAdminDeviceNotice((prev) => (prev?.id === requestId ? null : prev));
        superAdminNoticeResolveTimerRef.current = null;
      }, 2200);
    }, (error) => {
      console.warn("最高管理者單筆待確認提醒同步失敗:", error);
    });
  }, [superAdminDeviceNotice?.id, superAdminDeviceNotice?.uiStatus, getCollectionPath]);

  // 切換品牌／帳號時重新建立「本次工作階段已提醒」集合，避免跨品牌沿用狀態。
  useEffect(() => {
    superAdminNoticeSeenRef.current = new Set();
    setSuperAdminDeviceNotice(null);
    setSuperAdminApprovalFocusId("");
    if (superAdminNoticeResolveTimerRef.current) {
      window.clearTimeout(superAdminNoticeResolveTimerRef.current);
      superAdminNoticeResolveTimerRef.current = null;
    }
  }, [currentBrandId, currentSecurityAccountKey]);

  // 元件卸載時清掉短暫完成提示 timer。
  useEffect(() => () => {
    if (superAdminNoticeResolveTimerRef.current) {
      window.clearTimeout(superAdminNoticeResolveTimerRef.current);
    }
  }, []);

  const handleOpenSuperAdminDeviceNotice = useCallback(() => {
    const requestId = String(superAdminDeviceNotice?.id || "");
    if (!requestId) return;
    setSuperAdminApprovalFocusId(requestId);
    setSuperAdminDeviceNotice(null);
    setIsDeviceApprovalPanelOpen(true);
  }, [superAdminDeviceNotice?.id]);

  const handleDismissSuperAdminDeviceNotice = useCallback(() => {
    setSuperAdminDeviceNotice(null);
  }, []);

  // ★ 登入授權名單載入狀態：
  // 名單尚未完整發布前，登入頁只顯示一致的精緻載入畫面，不顯示暫時人數。
  const [accountDirectoryState, setAccountDirectoryState] = useState({
    status: "idle", // idle | loading | refreshing | ready | error
    brandId: "",
    attempt: 0,
    reason: "",
    error: "",
    updatedAtText: "",
  });
  const accountDirectoryStateRef = useRef(accountDirectoryState);
  const accountDirectoryRequestRef = useRef(0);
  const accountDirectoryInFlightRef = useRef(false);

  const updateAccountDirectoryState = useCallback((updater) => {
    setAccountDirectoryState((previous) => {
      const next = typeof updater === "function" ? updater(previous) : updater;
      accountDirectoryStateRef.current = next;
      return next;
    });
  }, []);

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

  const therapistModuleEnabled = featureFlags?.therapistModuleEnabled !== false;

  useEffect(() => {
    if (!therapistModuleEnabled) {
      if (dashboardViewMode === "therapist") setDashboardViewMode("store");
      if (auditType === "therapist-daily" || auditType === "therapist-target") setAuditType("daily");
      if (activeView === "t-targets" || activeView === "t-schedule" || activeView === "therapist-manager") {
        setActiveView("dashboard");
      }
    }
  }, [therapistModuleEnabled, dashboardViewMode, auditType, activeView]);

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

  // ★ 背景分頁節流：完整目標集合只在目前頁籤可見時保持即時監聽。
  // 回到此頁籤後，Firestore onSnapshot 會重新取得最新資料，不影響目標設定正確性。
  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const handleVisibilityChange = () => {
      const visible = document.visibilityState !== "hidden";
      setIsPageVisible(visible);

      if (visible) {
        // 返回系統頁籤視為使用者恢復操作，立即結束省流量待機並重新取得最新目標資料。
        lastActivityTimeRef.current = Date.now();
        setIsLowPowerMode(false);
      }
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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


  const callDeviceSecurityEndpoint = useCallback(async (endpoint, payload = {}) => {
    const idToken = await auth.currentUser?.getIdToken?.().catch(() => "");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      const error = new Error(result?.message || `HTTP ${response.status}`);
      error.result = result;
      error.status = response.status;
      throw error;
    }
    return result;
  }, []);

  const reportLoginSecurityEvent = useCallback(async ({ eventType, roleId, accountId, userName = "" } = {}) => {
    if (!isOnline || !eventType || !roleId || !accountId) return { ok: false, skipped: true };

    const deviceInfo = getClientDeviceInfo();
    const loginLocation = await resolveLoginLocation({ role: roleId, userName, deviceInfo });
    try {
      return await callDeviceSecurityEndpoint(LOGIN_SECURITY_EVENT_ENDPOINT, removeUndefinedDeep({
        brandId: currentBrandId,
        eventType,
        roleId,
        accountId: String(accountId),
        userName: String(userName || accountId || roleId),
        deviceInfo,
        loginLocation,
      }));
    } catch (error) {
      // 登入安全遙測不得阻擋正常登入流程；失敗只保留 console 診斷。
      console.warn("登入安全事件回報失敗:", error?.message || error);
      return { ok: false, message: error?.message || "security_event_failed" };
    }
  }, [isOnline, currentBrandId, resolveLoginLocation, callDeviceSecurityEndpoint]);

  const registerAccountDevice = useCallback(async (roleId, userInfo = {}, loginCredential = {}) => {
    const deviceInfo = getClientDeviceInfo();
    const accountId = String(loginCredential?.accountId || userInfo?.id || userInfo?.accountId || userInfo?.name || roleId).trim();
    const userName = userInfo?.name || (roleId === "director" ? "高階主管" : (roleId === "trainer" ? "教專" : "使用者"));
    const mode = securityConfig?.deviceApprovalMode || "off";
    const protectedRoles = Array.isArray(securityConfig?.deviceApprovalRoles)
      ? securityConfig.deviceApprovalRoles
      : DEFAULT_SECURITY_CONFIG.deviceApprovalRoles;
    const shouldFailClosed = mode === "enforce" && protectedRoles.includes(roleId);

    if (!isOnline || !roleId) {
      return {
        ok: !shouldFailClosed,
        allowed: !shouldFailClosed,
        deviceInfo,
        isNewDevice: false,
        riskTags: ["裝置確認服務暫時無法使用"],
        deviceStatus: "check_failed",
        approvalMode: mode,
        message: shouldFailClosed ? "目前無法完成裝置確認，請確認網路後再試一次。" : "裝置狀態暫時未確認",
      };
    }

    const loginLocation = await resolveLoginLocation({ role: roleId, userName, deviceInfo });
    loginSessionLocationRef.current = loginLocation;
    deviceInfo.loginLocation = loginLocation;

    try {
      const result = await callDeviceSecurityEndpoint(DEVICE_ACCESS_ENDPOINT, {
        brandId: currentBrandId,
        roleId,
        accountId,
        userName,
        password: String(loginCredential?.password || ""),
        deviceInfo,
        loginLocation: removeUndefinedDeep(loginLocation),
      });

      if (result?.recoveredDeviceId && result.recoveredDeviceId !== deviceInfo.deviceId) {
        persistStableClientDeviceId(result.recoveredDeviceId);
      }

      const normalizedResult = {
        ...result,
        deviceInfo: result?.deviceInfo || deviceInfo,
        loginLocation: normalizeLoginLocationPayload(result?.loginLocation || loginLocation),
      };
      logDeviceCheckResult(roleId, userName, normalizedResult, deviceInfo);
      return normalizedResult;
    } catch (error) {
      console.warn("裝置確認服務暫時無法完成:", error);
      const credentialRejected = error?.status === 401;
      // 「維持目前方式 / 先觀察」都不能因後端裝置確認暫時失敗而改變既有登入結果。
      // 只有正式啟用 enforce 的受保護角色才採 fail-closed。
      const mustBlock = shouldFailClosed;
      const result = {
        ok: !mustBlock,
        allowed: !mustBlock,
        deviceInfo,
        isNewDevice: false,
        deviceTrusted: null,
        autoTrusted: false,
        alertCreated: false,
        riskTags: ["裝置確認服務暫時無法使用"],
        deviceStatus: "check_failed",
        approvalMode: mode,
        loginLocation,
        error: error.message,
        message: shouldFailClosed && credentialRejected
          ? "帳號資訊需要重新確認，請返回登入頁重新輸入帳號密碼。"
          : (shouldFailClosed ? "目前無法完成裝置確認，請稍後再試一次。" : "裝置狀態暫時未確認"),
      };
      logDeviceCheckResult(roleId, userName, result, deviceInfo);
      return result;
    }
  }, [isOnline, currentBrandId, securityConfig, resolveLoginLocation, callDeviceSecurityEndpoint, logDeviceCheckResult]);

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
    securitySessionCredentialRef.current = "";
    pendingDeviceLoginRef.current = null;
    setPendingDeviceLogin(null);
    setIsDeviceApprovalPanelOpen(false);
    setGuidedDeviceApprovalRequestId("");
    setSuperAdminDeviceNotice(null);
    setSuperAdminApprovalFocusId("");
    superAdminNoticeSeenRef.current = new Set();
    if (superAdminNoticeResolveTimerRef.current) {
      window.clearTimeout(superAdminNoticeResolveTimerRef.current);
      superAdminNoticeResolveTimerRef.current = null;
    }
    
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
      approvalRequestId: "",
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

  const fetchGlobalData = useCallback(async (options = {}) => {
    if (!user) return false;

    const {
      reason = "manual",
      preserveExisting = true,
      force = false,
    } = options || {};

    const brandIdAtStart = currentBrand.id;
    const previousDirectoryState = accountDirectoryStateRef.current || {};
    const hasPublishedDirectory =
      previousDirectoryState.brandId === brandIdAtStart &&
      ["ready", "refreshing"].includes(previousDirectoryState.status);

    if (accountDirectoryInFlightRef.current && !force) return false;

    const requestId = ++accountDirectoryRequestRef.current;
    accountDirectoryInFlightRef.current = true;
    const startingStatus = preserveExisting && hasPublishedDirectory ? "refreshing" : "loading";

    updateAccountDirectoryState({
      status: startingStatus,
      brandId: brandIdAtStart,
      attempt: 1,
      reason,
      error: "",
      updatedAtText: previousDirectoryState.updatedAtText || "",
    });

    const retryDelays = [0, 900, 2200];
    let lastError = null;

    const withTimeout = (promise, label, timeoutMs = 12000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} 讀取逾時`)), timeoutMs);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });

    try {
      for (let attemptIndex = 0; attemptIndex < retryDelays.length; attemptIndex += 1) {
        const delayMs = retryDelays[attemptIndex];
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        if (
          requestId !== accountDirectoryRequestRef.current ||
          currentBrandIdRef.current !== brandIdAtStart
        ) {
          return false;
        }

        updateAccountDirectoryState((previous) => ({
          ...previous,
          status: startingStatus,
          brandId: brandIdAtStart,
          attempt: attemptIndex + 1,
          reason,
          error: "",
        }));

        try {
          // 必要帳號來源與次要設定同時讀取；只有必要來源失敗才阻擋登入名單發布。
          const tasks = [
            { key: "org", required: true, promise: withTimeout(getDoc(getDocPath("org_structure")), "組織架構") },
            { key: "storeAccounts", required: true, promise: withTimeout(getDoc(getDocPath("store_account_data")), "店經理帳號") },
            { key: "managerAuth", required: true, promise: withTimeout(getDoc(getDocPath("manager_auth")), "區長帳號") },
            { key: "permissions", required: false, promise: withTimeout(getDoc(getDocPath("permissions")), "權限設定") },
            { key: "therapists", required: true, promise: withTimeout(getDocs(getCollectionPath("therapists")), "管理師名單") },
            { key: "trainerAuth", required: true, promise: withTimeout(getDoc(getDocPath("trainer_auth")), "教專帳號") },
            { key: "auditExclusions", required: false, promise: withTimeout(getDoc(getDocPath("audit_exclusions")), "回報排除設定") },
            { key: "securityConfig", required: false, promise: withTimeout(getDoc(getDocPath("security_config")), "安全設定") },
            { key: "featureFlags", required: false, promise: withTimeout(getDoc(getDocPath("feature_flags")), "功能設定") },
            { key: "directorAuth", required: true, promise: withTimeout(getDoc(getDocPath("director_auth")), "高階主管帳號") },
            { key: "masterAuth", required: true, promise: withTimeout(getDoc(getDocPath("master_auth")), "最高管理帳號") },
            { key: "delegations", required: false, promise: withTimeout(getDocs(query(getCollectionPath("management_delegations"), where("status", "in", ["active", "scheduled"]))), "代理與托管") },
          ];

          const settledResults = await Promise.allSettled(tasks.map((task) => task.promise));
          const resultMap = {};
          settledResults.forEach((result, index) => {
            resultMap[tasks[index].key] = result;
          });

          trackReadSource("fetchGlobalData_core_docs", 10, getStableReadMeta("fetchGlobalData_core_docs"));
          const delegationResult = resultMap.delegations;
          trackReadSource(
            "fetchGlobalData_delegations",
            delegationResult?.status === "fulfilled" ? delegationResult.value.docs.length : 0,
            getStableReadMeta("fetchGlobalData_delegations")
          );
          const therapistResult = resultMap.therapists;
          trackReadSource(
            "fetchGlobalData_therapists",
            therapistResult?.status === "fulfilled" ? therapistResult.value.docs.length : 0,
            getStableReadMeta("fetchGlobalData_therapists")
          );

          const failedRequiredTasks = tasks.filter((task) => (
            task.required && resultMap[task.key]?.status !== "fulfilled"
          ));

          if (failedRequiredTasks.length > 0) {
            const firstFailure = resultMap[failedRequiredTasks[0].key]?.reason;
            throw new Error(
              `${failedRequiredTasks.map((task) => task.key).join("、")} 載入失敗${firstFailure?.message ? `：${firstFailure.message}` : ""}`
            );
          }

          if (
            requestId !== accountDirectoryRequestRef.current ||
            currentBrandIdRef.current !== brandIdAtStart
          ) {
            return false;
          }

          const orgSnap = resultMap.org.value;
          const accSnap = resultMap.storeAccounts.value;
          const mAuthSnap = resultMap.managerAuth.value;
          const thSnap = resultMap.therapists.value;
          const trAuthSnap = resultMap.trainerAuth.value;
          const dAuthSnap = resultMap.directorAuth.value;
          const mastSnap = resultMap.masterAuth.value;

          let nextManagers = {};
          let nextManagerOrder = [];
          let shouldBackfillManagerOrder = false;

          if (orgSnap.exists()) {
            const orgData = orgSnap.data() || {};
            const rawManagers = orgData.managers || {};
            const rawManagerOrder = Array.isArray(orgData.managerOrder) ? orgData.managerOrder : [];
            nextManagers = rawManagers;
            nextManagerOrder = normalizeManagerOrder(rawManagers, rawManagerOrder);
            shouldBackfillManagerOrder = rawManagerOrder.length === 0;
          } else {
            nextManagers = currentBrand.id === "cyj" ? DEFAULT_REGIONAL_MANAGERS : {};
            nextManagerOrder = normalizeManagerOrder(nextManagers);
          }

          const nextStoreAccounts = accSnap.exists() && Array.isArray(accSnap.data()?.accounts)
            ? accSnap.data().accounts
            : [];
          const nextManagerAuth = mAuthSnap.exists() ? (mAuthSnap.data() || {}) : {};
          const nextTherapists = thSnap.docs.map((documentSnapshot) => {
            const data = documentSnapshot.data() || {};
            const storeName = data.store || data.storeName || data.primaryStore || (Array.isArray(data.stores) ? data.stores[0] : "");
            const managerName = data.manager || data.managerName || data.region || data.area || "";
            return {
              id: documentSnapshot.id,
              ...data,
              store: storeName,
              storeName: data.storeName || storeName,
              manager: managerName,
              managerName: data.managerName || managerName,
              normalizedStoreCore: normalizeStore(storeName),
            };
          });
          const nextTrainerAuth = normalizeTrainerAuthData(
            trAuthSnap.exists() ? trAuthSnap.data() : { password: "0000" }
          );

          let nextDirectorAuth;
          if (dAuthSnap.exists()) {
            nextDirectorAuth = normalizeDirectorAuthData(dAuthSnap.data());
            if (Object.keys(nextDirectorAuth.accounts || {}).length === 0) {
              nextDirectorAuth = normalizeDirectorAuthData({ "營運總監": "0000" });
            }
          } else {
            let defaultPass = "0000";
            if (currentBrand.id === "cyj") defaultPass = "16500";
            if (currentBrand.id === "anniu") defaultPass = "8888";
            if (currentBrand.id === "yibo") defaultPass = "9999";
            nextDirectorAuth = normalizeDirectorAuthData({ "營運總監": defaultPass });
          }

          const nextMasterAuth = mastSnap.exists() && mastSnap.data()?.password
            ? mastSnap.data()
            : { password: "BOSS888" };

          // 必要帳號資料全部完成後才一次發布，避免登入頁出現半套名單或錯誤人數。
          setManagers(nextManagers);
          setManagerOrder(nextManagerOrder);
          setStoreAccounts(nextStoreAccounts);
          setManagerAuth(nextManagerAuth);
          setTherapists(nextTherapists);
          setTrainerAuth(nextTrainerAuth);
          setDirectorAuth(nextDirectorAuth);
          setMasterAuth(nextMasterAuth);
          if (delegationResult?.status === "fulfilled") {
            setDelegations(delegationResult.value.docs.map((documentSnapshot) => ({
              id: documentSnapshot.id,
              ...documentSnapshot.data(),
            })));
          } else if (delegationResult?.reason) {
            console.warn("management_delegations 讀取失敗，沿用目前值：", delegationResult.reason);
          }

          const applyOptionalDoc = (key, applyValue, fallbackLabel) => {
            const result = resultMap[key];
            if (result?.status === "fulfilled") {
              applyValue(result.value);
            } else if (result?.reason) {
              console.warn(`${fallbackLabel}讀取失敗，沿用目前值：`, result.reason);
            }
          };

          applyOptionalDoc("permissions", (snap) => {
            setPermissions(snap.exists() ? snap.data() : DEFAULT_PERMISSIONS);
          }, "permissions ");
          applyOptionalDoc("auditExclusions", (snap) => {
            setAuditExclusions(snap.exists() ? (snap.data().stores || []) : []);
          }, "audit_exclusions ");
          applyOptionalDoc("securityConfig", (snap) => {
            setSecurityConfig(snap.exists() ? normalizeSecurityConfig(snap.data()) : DEFAULT_SECURITY_CONFIG);
          }, "security_config ");
          applyOptionalDoc("featureFlags", (snap) => {
            setFeatureFlags(snap.exists() ? normalizeFeatureFlags(snap.data()) : DEFAULT_FEATURE_FLAGS);
          }, "feature_flags ");

          if (shouldBackfillManagerOrder && (userRole === "director" || userRole === "master")) {
            setDoc(
              getDocPath("org_structure"),
              { managers: nextManagers, managerOrder: nextManagerOrder },
              { merge: true }
            ).catch((error) => console.warn("managerOrder backfill failed:", error));
          }

          updateAccountDirectoryState({
            status: "ready",
            brandId: brandIdAtStart,
            attempt: attemptIndex + 1,
            reason,
            error: "",
            updatedAtText: new Date().toISOString(),
          });
          return true;
        } catch (error) {
          lastError = error;
          console.warn(`授權名單第 ${attemptIndex + 1} 次載入失敗：`, error);

          if (
            requestId !== accountDirectoryRequestRef.current ||
            currentBrandIdRef.current !== brandIdAtStart
          ) {
            return false;
          }
        }
      }

      // 背景重新同步失敗時保留上一份完整名單；首次載入失敗才阻擋登入。
      if (startingStatus === "refreshing" && hasPublishedDirectory) {
        updateAccountDirectoryState({
          ...previousDirectoryState,
          status: "ready",
          brandId: brandIdAtStart,
          reason,
          error: lastError?.message || "背景同步未完成",
        });
        return false;
      }

      updateAccountDirectoryState({
        status: "error",
        brandId: brandIdAtStart,
        attempt: retryDelays.length,
        reason,
        error: "網路暫時不穩，授權名單尚未完整載入，請重新同步。",
        updatedAtText: "",
      });
      return false;
    } finally {
      if (requestId === accountDirectoryRequestRef.current) {
        accountDirectoryInFlightRef.current = false;
      }
    }
  }, [
    user,
    currentBrand,
    getDocPath,
    getCollectionPath,
    getStableReadMeta,
    normalizeStore,
    updateAccountDirectoryState,
  ]);

  useEffect(() => {
    if (!user) return;

    const unsubReadTrackerConfig = onSnapshot(getDocPath("read_tracker_config"), (s) => {
      trackReadSource("read_tracker_config", s.exists() ? 1 : 0, getReadMeta("read_tracker_config"));
      const remoteConfig = s.exists() ? s.data() : { mode: "off" };
      readTrackerConfigRef.current = remoteConfig;
      setReadTrackerConfigState(remoteConfig);

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

    let timerId = null;
    let cancelled = false;

    const applyScheduledReadTrackerMode = () => {
      if (cancelled) return;

      const remoteConfig = readTrackerConfigRef.current || { mode: "off" };
      const effectiveMode = resolveReadTrackerModeFromConfig(remoteConfig);

      if (["off", "local", "global"].includes(effectiveMode)) {
        setReadTrackerMode(effectiveMode);
      }

      const nextDelayMs = getReadTrackerNextScheduleBoundaryDelayMs(remoteConfig);
      if (nextDelayMs !== null) {
        timerId = window.setTimeout(applyScheduledReadTrackerMode, nextDelayMs);
      }
    };

    applyScheduledReadTrackerMode();

    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [user, readTrackerConfigState]);

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

  // 完整目標資料屬高成本來源；只在真正需要、頁籤可見、連線正常且未進入省流量待機時保持監聽。
  const shouldKeepMonthlyTargetsLive =
    Boolean(user) &&
    shouldLoadMonthlyTargets &&
    isPageVisible &&
    isOnline &&
    !isLowPowerMode;

  useEffect(() => {
    if (!shouldLoadMonthlyTargets || !user) {
      // 離開目標功能或登出時清空，避免切品牌後誤用舊品牌資料。
      setBudgets({});
      return undefined;
    }

    if (!shouldKeepMonthlyTargetsLive) {
      // 背景分頁、離線或省流量待機時只取消即時監聽；保留畫面中的最後資料，
      // 回到前景或恢復操作後會重新訂閱並取得最新版本。
      return undefined;
    }

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
  }, [
    user,
    currentBrandId,
    getCollectionPath,
    shouldLoadMonthlyTargets,
    shouldKeepMonthlyTargetsLive,
    getStableReadMeta,
  ]);

  // ★ KPI 參數獨立常駐監聽：
  // kpi_targets 只有 1 doc，必須在登入 / 品牌切換後穩定讀回，避免登出重登後還原成預設值。
  useEffect(() => {
    if (!user) {
      setTargets({ newASP: null, trafficASP: 1200, benchmarks: {} });
      return undefined;
    }

    const unsubKpiTargets = onSnapshot(
      getDocPath("kpi_targets"),
      (kpiSnap) => {
        trackReadSource("kpi_targets_live", kpiSnap.exists() ? 1 : 0, getStableReadMeta("kpi_targets_live"));
        const data = kpiSnap.exists() ? kpiSnap.data() : {};
        const newAspResult = validPositiveSetting(data.newASP);
        setTargets({
          ...data,
          newASP: newAspResult.valid ? newAspResult.value : null,
          trafficASP: Number(data.trafficASP ?? 1200),
          benchmarks: data?.benchmarks && typeof data.benchmarks === "object" ? data.benchmarks : {},
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

  // Batch 5D-2：Current/detail Formal consumers 共用單一 Store Lifecycle Master listener。
  // 只在營運 consumer views 啟用；不建立 per-store listener、query 或 polling。
  const shouldLoadCurrentLifecycleMaster = OPERATIONAL_FORMAL_LIFECYCLE_VIEWS.has(activeView);
  const shouldKeepCurrentLifecycleMasterLive = Boolean(user)
    && shouldLoadCurrentLifecycleMaster
    && isPageVisible
    && isOnline
    && !isLowPowerMode;

  useEffect(() => {
    const brandId = currentBrand?.id || currentBrandId || "";
    if (!user || !shouldLoadCurrentLifecycleMaster) {
      setCurrentLifecycleMasterState({ brandId: "", ready: false, data: null, error: null });
      return undefined;
    }

    if (!shouldKeepCurrentLifecycleMasterLive) return undefined;

    setCurrentLifecycleMasterState((prev) => (
      prev.brandId === brandId
        ? { ...prev, ready: false, error: null }
        : { brandId, ready: false, data: null, error: null }
    ));

    const lifecycleRef = doc(getCollectionPath("store_lifecycle"), "master");
    const unsubscribe = onSnapshot(
      lifecycleRef,
      (snap) => {
        trackReadSource(
          "store_lifecycle_master_operational",
          snap.exists() ? 1 : 0,
          getStableReadMeta("store_lifecycle_master_operational")
        );
        setCurrentLifecycleMasterState({
          brandId,
          ready: true,
          data: snap.exists() ? { id: snap.id, ...snap.data() } : null,
          error: snap.exists() ? null : new Error("STORE_LIFECYCLE_MASTER_MISSING"),
        });
      },
      (error) => {
        console.error("Store Lifecycle Master 即時監聽失敗:", error);
        setCurrentLifecycleMasterState({ brandId, ready: true, data: null, error });
      }
    );

    return () => unsubscribe();
  }, [
    user,
    currentBrand?.id,
    currentBrandId,
    getCollectionPath,
    getStableReadMeta,
    shouldLoadCurrentLifecycleMaster,
    shouldKeepCurrentLifecycleMasterLive,
  ]);

  // ★ 報表 summary-first v1：
  // Ranking / Regional 優先讀 dashboard_summary / rankings_summary，不再一進頁面就讀整月 daily_reports。
  // 若 Summary 不存在，才允許 App 回退到明細監聽，保留正式營運數字安全性。
  useEffect(() => {
    if (!user || !selectedYearMonth) {
      setCurrentDashboardSummary(null);
      setCurrentRankingsSummary(null);
      setCurrentReportSummaryReady(false);
      setCurrentReportSummaryReadyYearMonth("");
      setCurrentReportSummaryReadyBrandId("");
      return undefined;
    }

    let dashboardLoaded = false;
    let rankingsLoaded = false;

    const publishReady = () => {
      if (dashboardLoaded && rankingsLoaded) {
        setCurrentReportSummaryReady(true);
        setCurrentReportSummaryReadyYearMonth(selectedYearMonth);
        setCurrentReportSummaryReadyBrandId(currentBrand?.id || "");
      }
    };

    setCurrentDashboardSummary(null);
    setCurrentRankingsSummary(null);
    setCurrentReportSummaryReady(false);
    setCurrentReportSummaryReadyYearMonth("");
    setCurrentReportSummaryReadyBrandId("");

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

    // 切換品牌時取消上一品牌尚未完成的請求，避免舊資料晚到後覆蓋新品牌。
    accountDirectoryRequestRef.current += 1;
    accountDirectoryInFlightRef.current = false;

    setManagers({});
    setManagerOrder([]);
    setStoreAccounts([]);
    setManagerAuth({});
    setTherapists([]);
    setDirectorAuth({});
    setTrainerAuth(normalizeTrainerAuthData({ password: "0000" }));
    setMasterAuth({ password: "BOSS888" });
    setDelegations([]);
    setTherapistSchedules({});
    setTherapistTargets({});
    setPermissions(DEFAULT_PERMISSIONS);
    setSecurityConfig(DEFAULT_SECURITY_CONFIG);
    setFeatureFlags(DEFAULT_FEATURE_FLAGS);

    updateAccountDirectoryState({
      status: "loading",
      brandId: currentBrandId,
      attempt: 1,
      reason: "brand-switch",
      error: "",
      updatedAtText: "",
    });

    fetchGlobalData({
      reason: "brand-switch",
      preserveExisting: false,
      force: true,
    });
  }, [user, currentBrandId, fetchGlobalData, updateAccountDirectoryState]);

  useEffect(() => {
    if (!user) return undefined;

    const recoverIncompleteDirectory = () => {
      const state = accountDirectoryStateRef.current || {};
      const shouldRecover = ["idle", "loading", "error"].includes(state.status);
      if (!shouldRecover || accountDirectoryInFlightRef.current) return;

      fetchGlobalData({
        reason: "connection-recovery",
        preserveExisting: false,
        force: true,
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") recoverIncompleteDirectory();
    };

    window.addEventListener("online", recoverIncompleteDirectory);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", recoverIncompleteDirectory);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [user, fetchGlobalData]);

  useEffect(() => {
    if (!user) return;

    const targetYearStr = String(selectedYear);
    let isMounted = true;
    const lowFrequencyUnsubs = [];

    const fetchLowFrequencyData = async () => {
      try {
        const cacheTtlMs = 10 * 60 * 1000;
        const nowMs = Date.now();

        const shouldLoadSchedules = therapistModuleEnabled && (activeView === "t-schedule" || (activeView === "audit" && auditType === "therapist-daily"));
        const shouldLoadTherapistTargets = therapistModuleEnabled && (activeView === "dashboard" || activeView === "t-targets" || (activeView === "audit" && auditType === "therapist-target"));

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
  }, [user, currentBrandId, currentBrand, getCollectionPath, selectedYear, activeView, auditType, therapistModuleEnabled, getStableReadMeta]);

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
  const historicalDirtyHandledRef = useRef({});

  // ★ 歷史 Summary 一變 dirty，就讓目前月份的明細快取失效並觸發一次性重抓。
  // 這個 listener 只監聽 1 個 flag doc；不會把歷史 daily_reports 改回長駐監聽。
  useEffect(() => {
    if (!user || !selectedYearMonth) {
      setCurrentSummaryRecalcFlagState({ brandId: "", yearMonth: "", ready: false, data: null, error: null });
      setHistoricalDetailRefreshState({
        yearMonth: "",
        status: "idle",
        lastDirtyAtText: "",
        requestedAtText: "",
        loadedAtText: "",
        error: "",
      });
      return undefined;
    }

    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (selectedYearMonth >= currentYearMonth) {
      setCurrentSummaryRecalcFlagState({
        brandId: currentBrand?.id || "",
        yearMonth: selectedYearMonth,
        ready: true,
        data: null,
        error: null,
      });
      setHistoricalDetailRefreshState((prev) => (
        prev.yearMonth === selectedYearMonth
          ? { ...prev, status: "idle", error: "" }
          : prev
      ));
      return undefined;
    }

    setCurrentSummaryRecalcFlagState({
      brandId: currentBrand?.id || "",
      yearMonth: selectedYearMonth,
      ready: false,
      data: null,
      error: null,
    });

    const flagRef = doc(getCollectionPath("summary_recalc_flags"), selectedYearMonth);
    const unsubscribe = onSnapshot(
      flagRef,
      (snap) => {
        trackReadSource(
          "summary_recalc_flag_history_detail_refresh",
          snap.exists() ? 1 : 0,
          getStableReadMeta("summary_recalc_flag_history_detail_refresh")
        );

        const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        setCurrentSummaryRecalcFlagState({
          brandId: currentBrand?.id || "",
          yearMonth: selectedYearMonth,
          ready: true,
          data,
          error: null,
        });

        if (!data) return;
        const status = String(data.status || "").toLowerCase();
        const isDirty = data.dirty === true || ["dirty", "pending", "rebuilding"].includes(status);
        if (!isDirty) return;

        const dirtyMillis =
          data.lastDirtyAt?.toMillis?.() ||
          data.updatedAt?.toMillis?.() ||
          0;
        const lastDirtyAtText = String(
          data.lastDirtyAtText ||
          data.updatedAtText ||
          (dirtyMillis ? new Date(dirtyMillis).toISOString() : "") ||
          "dirty"
        );
        const requestKey = `${currentBrand.id}_${selectedYearMonth}_${lastDirtyAtText}`;

        if (historicalDirtyHandledRef.current[selectedYearMonth] === requestKey) return;
        historicalDirtyHandledRef.current[selectedYearMonth] = requestKey;

        // 同月份可能存在 daily / therapist 等不同 cacheKey，全部清掉，避免 fallback 取到舊快取。
        const cachePrefix = `${currentBrand.id}_${selectedYearMonth.replace("-", "_")}_`;
        Object.keys(monthCacheRef.current).forEach((key) => {
          if (key.startsWith(cachePrefix)) delete monthCacheRef.current[key];
        });

        setHistoricalDetailRefreshState({
          yearMonth: selectedYearMonth,
          status: "requested",
          lastDirtyAtText,
          requestedAtText: new Date().toISOString(),
          loadedAtText: "",
          error: "",
        });
        setHistoricalDetailRefreshToken((prev) => prev + 1);
      },
      (error) => {
        console.error("歷史月份 dirty flag 監聽失敗:", error);
        setCurrentSummaryRecalcFlagState({
          brandId: currentBrand?.id || "",
          yearMonth: selectedYearMonth,
          ready: true,
          data: null,
          error,
        });
        setHistoricalDetailRefreshState((prev) => ({
          ...prev,
          yearMonth: selectedYearMonth,
          status: "error",
          error: error?.message || "歷史月份狀態監聽失敗",
        }));
      }
    );

    return () => {
      try { unsubscribe && unsubscribe(); } catch (error) { console.warn("history detail refresh flag unsubscribe failed", error); }
    };
  }, [user, selectedYearMonth, currentBrand.id, getCollectionPath, getStableReadMeta]);

  // Runtime stabilization — Historical Summary readiness one-shot recovery.
  //
  // Normal path: existing onSnapshot callbacks win before 10s => extra reads 0.
  // Stall path: point-read only the unresolved authority groups, max 3 docs:
  // dashboard_summary/{YM}, rankings_summary/{YM}, summary_recalc_flags/{YM}.
  // This is not polling and does not reopen historical daily_reports as a listener.
  useEffect(() => {
    if (!user || !selectedYearMonth) return undefined;

    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (selectedYearMonth >= currentYearMonth) return undefined;

    const brandIdAtStart = currentBrand?.id || "";
    const summaryReadyForMonth = Boolean(
      currentReportSummaryReady &&
      currentReportSummaryReadyYearMonth === selectedYearMonth &&
      currentReportSummaryReadyBrandId === brandIdAtStart
    );
    const flagReadyForMonth = Boolean(
      currentSummaryRecalcFlagState?.ready === true &&
      currentSummaryRecalcFlagState?.yearMonth === selectedYearMonth &&
      currentSummaryRecalcFlagState?.brandId === brandIdAtStart
    );

    if (summaryReadyForMonth && flagReadyForMonth) return undefined;

    let cancelled = false;
    const recoveryTimer = setTimeout(async () => {
      const tasks = [];

      if (!summaryReadyForMonth) {
        tasks.push({
          key: "dashboard",
          source: "dashboard_summary_readiness_recovery",
          promise: getDoc(doc(getCollectionPath("dashboard_summary"), selectedYearMonth)),
        });
        tasks.push({
          key: "rankings",
          source: "rankings_summary_readiness_recovery",
          promise: getDoc(doc(getCollectionPath("rankings_summary"), selectedYearMonth)),
        });
      }

      if (!flagReadyForMonth) {
        tasks.push({
          key: "flag",
          source: "summary_recalc_flag_readiness_recovery",
          promise: getDoc(doc(getCollectionPath("summary_recalc_flags"), selectedYearMonth)),
        });
      }

      const settled = await Promise.all(tasks.map(async (task) => {
        try {
          return { ...task, snap: await task.promise, error: null };
        } catch (error) {
          return { ...task, snap: null, error };
        }
      }));

      if (cancelled) return;

      const byKey = Object.fromEntries(settled.map((row) => [row.key, row]));
      settled.forEach((row) => {
        if (!row.snap) return;
        trackReadSource(
          row.source,
          row.snap.exists() ? 1 : 0,
          getStableReadMeta(row.source)
        );
      });

      if (!summaryReadyForMonth) {
        const dashboardResult = byKey.dashboard || {};
        const rankingsResult = byKey.rankings || {};

        if (dashboardResult.error || rankingsResult.error) {
          console.warn(
            "Historical Summary readiness recovery encountered an error:",
            dashboardResult.error || rankingsResult.error
          );
        }

        setCurrentDashboardSummary(
          dashboardResult.snap?.exists()
            ? { id: dashboardResult.snap.id, ...dashboardResult.snap.data() }
            : null
        );
        setCurrentRankingsSummary(
          rankingsResult.snap?.exists()
            ? { id: rankingsResult.snap.id, ...rankingsResult.snap.data() }
            : null
        );
        // Important: even a point-read error ends the infinite LOADING state and
        // lets the existing read policy choose the safe fallback/error path.
        setCurrentReportSummaryReady(true);
        setCurrentReportSummaryReadyYearMonth(selectedYearMonth);
        setCurrentReportSummaryReadyBrandId(brandIdAtStart);
      }

      if (!flagReadyForMonth) {
        const flagResult = byKey.flag || {};
        if (flagResult.error) {
          console.warn("Historical Summary flag readiness recovery failed:", flagResult.error);
        }
        setCurrentSummaryRecalcFlagState({
          brandId: brandIdAtStart,
          yearMonth: selectedYearMonth,
          ready: true,
          data: flagResult.snap?.exists()
            ? { id: flagResult.snap.id, ...flagResult.snap.data() }
            : null,
          error: flagResult.error || null,
        });
      }
    }, HISTORICAL_SUMMARY_READINESS_RECOVERY_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(recoveryTimer);
    };
  }, [
    user,
    selectedYearMonth,
    currentBrand?.id,
    currentReportSummaryReady,
    currentReportSummaryReadyYearMonth,
    currentReportSummaryReadyBrandId,
    currentSummaryRecalcFlagState?.brandId,
    currentSummaryRecalcFlagState?.yearMonth,
    currentSummaryRecalcFlagState?.ready,
    getCollectionPath,
    getStableReadMeta,
  ]);

  useEffect(() => {
    const shouldLoadAnnualData = ANNUAL_DATA_VIEWS.has(activeView);

    if (!user || isLowPowerMode || !shouldLoadAnnualData) {
      setAnnualAggregatedData([]);
      setAnnualDashboardSummaries([]);
      setAnnualSummaryStatusMap({});
      setAnnualSummaryLoadState({
        brandId: "",
        year: "",
        dashboardReady: false,
        flagsReady: false,
        dashboardError: "",
        flagsError: "",
      });
      setTherapistAnnualAggregatedData([]);
      return;
    }

    const targetYear = String(selectedYear);
    const annualBrandId = String(currentBrand?.id || "").toLowerCase();
    const yearStartId = `${targetYear}-01`;
    const yearEndId = `${targetYear}-12`;
    let active = true;

    // Annual 的歷史可信來源只讀 selectedYear；切品牌/年份時先清掉上一組資料，
    // 避免舊 listener callback 在新畫面短暫污染 state。
    setAnnualAggregatedData([]);
    setTherapistAnnualAggregatedData([]);
    setAnnualDashboardSummaries([]);
    setAnnualSummaryStatusMap({});
    setAnnualSummaryLoadState({
      brandId: annualBrandId,
      year: targetYear,
      dashboardReady: false,
      flagsReady: false,
      dashboardError: "",
      flagsError: "",
    });

    const dashboardSummaryQuery = query(
      getCollectionPath("dashboard_summary"),
      where(documentId(), ">=", yearStartId),
      where(documentId(), "<=", yearEndId)
    );
    const unsubDashboardSummary = onSnapshot(
      dashboardSummaryQuery,
      (s) => {
        if (!active) return;
        trackSnapshotRead("dashboard_summary_year_for_annual", s, getStableReadMeta("dashboard_summary_year_for_annual"));
        setAnnualDashboardSummaries(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        setAnnualSummaryLoadState((prev) => (
          prev.brandId === annualBrandId && prev.year === targetYear
            ? { ...prev, dashboardReady: true, dashboardError: "" }
            : prev
        ));
      },
      (error) => {
        if (!active) return;
        console.error("年度 dashboard_summary 監聽失敗:", error);
        setAnnualDashboardSummaries([]);
        setAnnualSummaryLoadState((prev) => (
          prev.brandId === annualBrandId && prev.year === targetYear
            ? { ...prev, dashboardReady: true, dashboardError: error?.message || "dashboard_summary load failed" }
            : prev
        ));
      }
    );

    const summaryFlagsQuery = query(
      getCollectionPath("summary_recalc_flags"),
      where(documentId(), ">=", yearStartId),
      where(documentId(), "<=", yearEndId)
    );
    const unsubSummaryFlags = onSnapshot(
      summaryFlagsQuery,
      (s) => {
        if (!active) return;
        trackSnapshotRead("summary_recalc_flags_year_for_annual", s, getStableReadMeta("summary_recalc_flags_year_for_annual"));
        const map = {};
        s.docs.forEach((d) => {
          const data = { id: d.id, ...d.data() };
          const ym = String(data.affectedYearMonth || data.yearMonth || d.id || "");
          if (ym) map[ym] = data;
        });
        setAnnualSummaryStatusMap(map);
        setAnnualSummaryLoadState((prev) => (
          prev.brandId === annualBrandId && prev.year === targetYear
            ? { ...prev, flagsReady: true, flagsError: "" }
            : prev
        ));
      },
      (error) => {
        if (!active) return;
        console.error("年度 summary_recalc_flags 監聽失敗:", error);
        setAnnualSummaryStatusMap({});
        setAnnualSummaryLoadState((prev) => (
          prev.brandId === annualBrandId && prev.year === targetYear
            ? { ...prev, flagsReady: true, flagsError: error?.message || "summary_recalc_flags load failed" }
            : prev
        ));
      }
    );

    return () => {
      active = false;
      try { unsubDashboardSummary && unsubDashboardSummary(); } catch (error) { console.warn("annual dashboard_summary unsubscribe failed", error); }
      try { unsubSummaryFlags && unsubSummaryFlags(); } catch (error) { console.warn("annual summary_recalc_flags unsubscribe failed", error); }
    };
  }, [user, currentBrand?.id, selectedYear, activeView, getCollectionPath, getStableReadMeta, isLowPowerMode]);

  useEffect(() => {
    const shouldLoadAnnualData = ANNUAL_DATA_VIEWS.has(activeView);
    if (!user || isLowPowerMode || !shouldLoadAnnualData) {
      setAnnualAggregatedData([]);
      return;
    }

    const targetYear = String(selectedYear);
    const annualBrandId = String(currentBrand?.id || "").toLowerCase();
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const readPlan = resolveAnnualReadPlan({
      selectedYear: targetYear,
      currentYearMonth,
      brandId: annualBrandId,
      dashboardSummaries: annualDashboardSummaries,
      summaryStatusMap: annualSummaryStatusMap,
      summaryLoadState: annualSummaryLoadState,
    });

    // Loading 階段先不碰 monthly_aggregated，避免 Summary/flag 晚 50~100ms 回來時
    // 已經先把整年 fallback 資料讀完。
    if (!readPlan.ready || readPlan.fallbackYearMonths.length === 0) {
      setAnnualAggregatedData([]);
      return;
    }

    let active = true;
    const fallbackYearMonths = readPlan.fallbackYearMonths;
    const fallbackSet = new Set(fallbackYearMonths);
    const aggregateYearMonthCandidates = buildAnnualAggregateYearMonthCandidates(fallbackYearMonths);
    const aggregateQuery = query(
      getCollectionPath("monthly_aggregated"),
      where("yearMonth", "in", aggregateYearMonthCandidates)
    );

    const unsubscribe = onSnapshot(
      aggregateQuery,
      (s) => {
        if (!active) return;
        trackSnapshotRead("monthly_aggregated_fallback_months", s, getStableReadMeta("monthly_aggregated_fallback_months"));
        setAnnualAggregatedData(
          s.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((row) => fallbackSet.has(normalizeAnnualYearMonth(row?.yearMonth)))
        );
      },
      (error) => {
        if (!active) return;
        console.error("年度 monthly_aggregated fallback 監聽失敗:", error);
        setAnnualAggregatedData([]);
      }
    );

    return () => {
      active = false;
      try { unsubscribe && unsubscribe(); } catch (error) { console.warn("annual monthly_aggregated fallback unsubscribe failed", error); }
    };
  }, [
    user,
    currentBrand?.id,
    selectedYear,
    activeView,
    isLowPowerMode,
    getCollectionPath,
    getStableReadMeta,
    annualDashboardSummaries,
    annualSummaryStatusMap,
    annualSummaryLoadState,
  ]);

  useEffect(() => {
    const targetYear = String(selectedYear);
    const targetMonth = String(selectedMonth).padStart(2, '0');
    const targetYearMonth = `${targetYear}-${targetMonth}`;

    const now = new Date();
    const currentRealYear = String(now.getFullYear());
    const currentRealMonth = String(now.getMonth() + 1).padStart(2, '0');
    const isCurrentMonth = (targetYear === currentRealYear && targetMonth === currentRealMonth);

    const isHistoricalRefreshRequested =
      !isCurrentMonth &&
      historicalDetailRefreshState.yearMonth === targetYearMonth &&
      ["requested", "loading"].includes(historicalDetailRefreshState.status);

    const isSummaryFirstReportView = activeView === "ranking" || activeView === "regional";
    const isStoreAnalysisScopedView = activeView === "store-analysis";
    const dashboardSummaryYearMonth = String(currentDashboardSummary?.yearMonth || currentDashboardSummary?.id || "");
    const rankingsSummaryYearMonth = String(currentRankingsSummary?.yearMonth || currentRankingsSummary?.id || "");
    const hasUsableDashboardSummary = Boolean(
      dashboardSummaryYearMonth === targetYearMonth &&
      rankingsSummaryYearMonth === targetYearMonth &&
      isFormalReportSummaryPairCompatible({
        dashboardSummary: currentDashboardSummary,
        rankingsSummary: currentRankingsSummary,
        yearMonth: targetYearMonth,
        brandId: currentBrand?.id || "",
      })
    );
    const reportSummaryReadyForMonth = Boolean(
      currentReportSummaryReady &&
      currentReportSummaryReadyYearMonth === targetYearMonth &&
      currentReportSummaryReadyBrandId === currentBrand?.id
    );
    const summaryFlagReadyForMonth = Boolean(
      currentSummaryRecalcFlagState?.brandId === currentBrand?.id &&
      currentSummaryRecalcFlagState?.yearMonth === targetYearMonth &&
      currentSummaryRecalcFlagState?.ready === true
    );
    const dashboardReadPolicy = resolveHistoricalDashboardReadPolicy({
      isCurrentMonth,
      historicalRefreshRequested: isHistoricalRefreshRequested,
      reportSummaryReady: reportSummaryReadyForMonth,
      hasUsableDashboardSummary,
      summaryFlagReady: summaryFlagReadyForMonth,
      summaryFlag: currentSummaryRecalcFlagState?.data || null,
      summaryFlagError: currentSummaryRecalcFlagState?.error || null,
    });

    const shouldLoadDailyReportData =
      MONTHLY_DAILY_REPORT_DATA_VIEWS.has(activeView) &&
      (
        (activeView === "dashboard" || isSummaryFirstReportView)
          ? dashboardReadPolicy.shouldLoadDailyReports
          : (
              isHistoricalRefreshRequested ||
              (
                (!isStoreAnalysisScopedView || !storeAnalysisSelectedStore) &&
                (
                  !isSummaryFirstReportView ||
                  isCurrentMonth ||
                  (currentReportSummaryReady && !hasUsableDashboardSummary)
                )
              )
            )
      );

    const shouldLoadTherapistReportData = therapistModuleEnabled && (
      MONTHLY_THERAPIST_REPORT_DATA_VIEWS.has(activeView) ||
      (activeView === "dashboard" && (dashboardViewMode === "therapist" || userRole === "therapist" || userRole === "trainer"))
    );

    if (!user || isLowPowerMode || (!shouldLoadDailyReportData && !shouldLoadTherapistReportData)) {
      setRawData([]);
      setTherapistReports([]);
      return;
    }

    const cacheKey = `${currentBrand.id}_${targetYear}_${targetMonth}_${shouldLoadDailyReportData ? "daily" : "nodaily"}_${shouldLoadTherapistReportData ? "therapist" : "notherapist"}`;

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
        setHistoricalDetailRefreshState((prev) => (
          prev.yearMonth === targetYearMonth && ["requested", "loading"].includes(prev.status)
            ? { ...prev, status: "ready", loadedAtText: new Date().toISOString(), error: "" }
            : prev
        ));
        return;
      }

      // dirty 後先保留原畫面，並明確標示正在抓取最新明細；
      // 新資料完成後才一次替換，避免中途顯示 0 或半套資料。
      const isDirtyTriggeredRefresh = isHistoricalRefreshRequested;
      if (!isDirtyTriggeredRefresh) {
        setRawData([]);
        setTherapistReports([]);
      }
      setHistoricalDetailRefreshState((prev) => ({
        yearMonth: targetYearMonth,
        status: "loading",
        lastDirtyAtText: prev.yearMonth === targetYearMonth ? prev.lastDirtyAtText : "",
        requestedAtText: prev.yearMonth === targetYearMonth && prev.requestedAtText
          ? prev.requestedAtText
          : new Date().toISOString(),
        loadedAtText: "",
        error: "",
      }));

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
            trackReadSource(
              isDirtyTriggeredRefresh ? "daily_reports_past_month_dirty_refresh" : "daily_reports_past_month_getDocs",
              reportsSnap.docs.length,
              getStableReadMeta(isDirtyTriggeredRefresh ? "daily_reports_past_month_dirty_refresh" : "daily_reports_past_month_getDocs")
            );
          }
          if (shouldLoadTherapistReportData) {
            trackReadSource(
              isDirtyTriggeredRefresh ? "therapist_daily_reports_past_month_dirty_refresh" : "therapist_daily_reports_past_month_getDocs",
              tReportsSnap.docs.length,
              getStableReadMeta(isDirtyTriggeredRefresh ? "therapist_daily_reports_past_month_dirty_refresh" : "therapist_daily_reports_past_month_getDocs")
            );
          }

          if (!isMounted) return;

          const reportsData = reportsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          const tReportsData = tReportsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

          monthCacheRef.current[cacheKey] = {
            reports: reportsData,
            therapistReports: tReportsData,
            loadedAtText: new Date().toISOString(),
          };

          setRawData(reportsData);
          setTherapistReports(tReportsData);
          setHistoricalDetailRefreshState((prev) => ({
            yearMonth: targetYearMonth,
            status: "ready",
            lastDirtyAtText: prev.yearMonth === targetYearMonth ? prev.lastDirtyAtText : "",
            requestedAtText: prev.yearMonth === targetYearMonth ? prev.requestedAtText : "",
            loadedAtText: new Date().toISOString(),
            error: "",
          }));

        } catch (e) {
          console.error("單次獲取歷史月份失敗:", e);
          if (!isMounted) return;
          setHistoricalDetailRefreshState((prev) => ({
            ...prev,
            yearMonth: targetYearMonth,
            status: "error",
            error: e?.message || "最新歷史明細載入失敗",
          }));
        }
      };

      fetchPastMonth();

      return () => {
        isMounted = false; 
      };
    }
  }, [user, currentBrand, selectedYear, selectedMonth, activeView, dashboardViewMode, storeAnalysisSelectedStore, userRole, therapistModuleEnabled, currentDashboardSummary, currentRankingsSummary, currentReportSummaryReady, currentReportSummaryReadyYearMonth, currentReportSummaryReadyBrandId, currentSummaryRecalcFlagState, getCollectionPath, getStableReadMeta, isLowPowerMode, historicalDetailRefreshToken]);


 const handleLogin = useCallback(async (roleId, userInfo = null, loginCredential = {}) => {
    setLoginSecurityNotice(null);
    setToast((prev) => {
      if (String(prev?.message || "").includes("裝置") || String(prev?.message || "").includes("登入")) return null;
      return prev;
    });

    let finalUser = userInfo;
    if (roleId === "therapist" && userInfo?.name) {
      // 同名人員仍以「姓名 + 店家」做既有防撞，避免改動人員身份邏輯。
      const foundTherapist = therapists.find((t) =>
        t.name === userInfo.name &&
        (t.store === userInfo.store || t.storeName === userInfo.store || t.store === userInfo.storeName)
      );
      if (foundTherapist) {
        finalUser = { ...userInfo, ...foundTherapist, id: foundTherapist.id || userInfo.id };
      }
    }

    const loginAccountId = String(
      loginCredential?.accountId || finalUser?.id || finalUser?.accountId || finalUser?.name || roleId
    ).trim();
    if (finalUser && loginAccountId) {
      finalUser = { ...finalUser, securityAccountId: loginAccountId };
    }

    const userName = finalUser?.name || (roleId === "director" ? "高階主管" : (roleId === "trainer" ? "教專" : "使用者"));
    const immediateDeviceInfo = getClientDeviceInfo();
    setCurrentDeviceTrust({
      status: "checking",
      label: "正在確認目前裝置",
      deviceShort: immediateDeviceInfo.deviceShort,
      deviceId: immediateDeviceInfo.deviceId,
    });

    const deviceSecurity = await registerAccountDevice(roleId, finalUser || { name: userName }, loginCredential);

    if (deviceSecurity?.blocked || (deviceSecurity?.allowed === false && deviceSecurity?.deviceStatus === "blocked")) {
      setCurrentDeviceTrust({
        status: "blocked",
        label: "⛔ 此裝置已停用",
        deviceShort: deviceSecurity?.deviceInfo?.deviceShort || immediateDeviceInfo.deviceShort,
        deviceId: deviceSecurity?.deviceInfo?.deviceId || immediateDeviceInfo.deviceId,
      });

      logActivity(roleId, userName, "停用裝置嘗試登入", {
        activityType: "auth.blocked_device",
        message: "此裝置目前無法使用系統",
        deviceInfo: deviceSecurity?.deviceInfo || immediateDeviceInfo,
        deviceShort: deviceSecurity?.deviceInfo?.deviceShort || immediateDeviceInfo.deviceShort,
        riskTags: ["裝置已停用"],
        deviceStatus: "blocked",
      });

      setLoginSecurityNotice({
        type: "blocked",
        title: deviceSecurity?.globalBlocked ? "這台裝置已停止所有品牌使用" : "這台裝置目前無法使用系統",
        message: "請聯繫最高管理者確認裝置使用權限，或改用原本已信任的常用裝置登入。",
        deviceShort: deviceSecurity?.deviceInfo?.deviceShort || immediateDeviceInfo.deviceShort,
        deviceInfo: deviceSecurity?.deviceInfo || immediateDeviceInfo,
        roleId,
        accountId: sanitizeSecurityKey(loginCredential?.accountId || finalUser?.id || finalUser?.accountId || finalUser?.name || roleId),
        userName,
        globalBlocked: Boolean(deviceSecurity?.globalBlocked),
        blockedData: deviceSecurity?.existingDevice || null,
        blockedDeviceId: deviceSecurity?.blockedDeviceId || deviceSecurity?.existingDevice?.deviceId || "",
      });
      setToast({ message: "這台裝置目前無法使用系統，請聯繫最高管理者。", type: "error" });
      setUserRole(null);
      setCurrentUser(null);
      setActiveView("dashboard");
      return { ok: false, blocked: true };
    }

    const approvalRequired = Boolean(deviceSecurity?.approvalRequired);
    const enforceApproval = approvalRequired && deviceSecurity?.approvalMode === "enforce" && deviceSecurity?.allowed === false;

    if (enforceApproval) {
      const pending = {
        roleId,
        finalUser,
        loginCredential: { ...loginCredential },
        requestId: deviceSecurity.requestId,
        verificationCode: deviceSecurity.verificationCode,
        expiresAtMs: deviceSecurity.expiresAtMs,
        expiresAtText: deviceSecurity.expiresAtText,
        deviceInfo: deviceSecurity.deviceInfo || immediateDeviceInfo,
        loginLocation: deviceSecurity.loginLocation || UNKNOWN_LOGIN_LOCATION,
        likelyKnownDevice: Boolean(deviceSecurity.likelyKnownDevice),
        adminOnly: Boolean(deviceSecurity.adminOnly),
        selfApprovalAllowed: deviceSecurity.selfApprovalAllowed !== false,
        hasTrustedApproverDevice: deviceSecurity.hasTrustedApproverDevice !== false,
        deviceStatus: deviceSecurity.deviceStatus || "new",
      };
      pendingDeviceLoginRef.current = pending;
      setPendingDeviceLogin(pending);
      const pendingStatus = String(deviceSecurity?.deviceStatus || "new");
      const pendingLabel = pendingStatus === "reverify_required"
        ? "⚠ 主管要求重新驗證"
        : pendingStatus === "observing"
          ? "⚠ 新裝置待觀察"
          : pendingStatus === "suspicious"
            ? "⚠ 需要管理者確認"
            : "⚠ 新裝置待確認";
      setCurrentDeviceTrust({
        status: ["observing", "reverify_required", "suspicious"].includes(pendingStatus) ? pendingStatus : "new",
        label: pendingLabel,
        deviceShort: pending.deviceInfo.deviceShort,
        deviceId: pending.deviceInfo.deviceId,
      });
      setUserRole(null);
      setCurrentUser(null);
      return { ok: false, pending: true };
    }

    if (deviceSecurity?.allowed === false) {
      setCurrentDeviceTrust({
        status: "unknown",
        label: "裝置確認暫時無法完成",
        deviceShort: deviceSecurity?.deviceInfo?.deviceShort || immediateDeviceInfo.deviceShort,
        deviceId: deviceSecurity?.deviceInfo?.deviceId || immediateDeviceInfo.deviceId,
      });
      setToast({ message: deviceSecurity?.message || "目前無法完成裝置確認，請稍後再試一次。", type: "error" });
      setUserRole(null);
      setCurrentUser(null);
      return { ok: false, unavailable: true };
    }

    pendingDeviceLoginRef.current = null;
    setPendingDeviceLogin(null);
    setUserRole(roleId);
    if (finalUser) setCurrentUser(finalUser);
    securitySessionCredentialRef.current = String(loginCredential?.password || "");

    const loginDeviceInfo = deviceSecurity?.deviceInfo || immediateDeviceInfo;
    const loginLocation = normalizeLoginLocationPayload(deviceSecurity?.loginLocation || UNKNOWN_LOGIN_LOCATION);
    loginSessionLocationRef.current = loginLocation;

    // 真正進入系統後才記為「登入系統」，被新裝置確認擋住的嘗試不計入今日登入。
    logActivity(roleId, userName, "登入系統", {
      activityType: "auth.login",
      message: finalUser?.passwordUpdatedOnFirstLogin
        ? "登入成功，已完成首次安全更新"
        : (deviceSecurity?.deviceStatus === "reverify_required"
          ? "登入成功，主管已要求此裝置重新驗證"
          : deviceSecurity?.deviceStatus === "observing"
            ? "登入成功，此裝置維持觀察狀態"
            : (approvalRequired ? "登入成功，新裝置仍在觀察確認中" : "登入成功")),
      passwordUpdatedOnFirstLogin: Boolean(finalUser?.passwordUpdatedOnFirstLogin),
      deviceInfo: { ...loginDeviceInfo, loginLocation },
      loginLocation,
      deviceShort: loginDeviceInfo.deviceShort,
      isNewDevice: Boolean(deviceSecurity?.isNewDevice),
      deviceTrusted: deviceSecurity?.deviceTrusted ?? null,
      riskTags: deviceSecurity?.deviceStatus === "reverify_required"
        ? ["主管要求重新驗證"]
        : deviceSecurity?.deviceStatus === "observing"
          ? ["新裝置待觀察"]
          : (approvalRequired ? ["新裝置待確認"] : []),
      deviceStatus: deviceSecurity?.deviceStatus || "trusted",
    });

    let nextTrustStatus = "trusted";
    let nextTrustLabel = "🛡 目前裝置已信任";
    if (deviceSecurity?.deviceStatus === "check_failed") {
      nextTrustStatus = "unknown";
      nextTrustLabel = "裝置狀態暫時未確認";
    } else if (approvalRequired || deviceSecurity?.deviceTrusted === false) {
      const returnedStatus = String(deviceSecurity?.deviceStatus || "new");
      nextTrustStatus = ["observing", "reverify_required", "suspicious"].includes(returnedStatus) ? returnedStatus : "new";
      nextTrustLabel = nextTrustStatus === "reverify_required"
        ? "⚠ 主管要求重新驗證"
        : nextTrustStatus === "observing"
          ? "⚠ 新裝置待觀察"
          : nextTrustStatus === "suspicious"
            ? "⚠ 需要管理者確認"
            : "⚠ 新裝置待確認";
    }
    setCurrentDeviceTrust({
      status: nextTrustStatus,
      label: nextTrustLabel,
      deviceShort: loginDeviceInfo.deviceShort,
      deviceId: loginDeviceInfo.deviceId,
      approvalRequestId: approvalRequired ? String(deviceSecurity?.requestId || "") : "",
    });

    if (deviceSecurity?.approvalMode === "monitor") {
      if (deviceSecurity?.deviceStatus === "reverify_required") {
        setToast({ message: "主管已要求這台裝置重新驗證；目前仍可正常使用系統。", type: "info" });
      } else if (deviceSecurity?.deviceStatus === "observing") {
        setToast({ message: "這台裝置目前維持觀察狀態，仍可正常使用系統。", type: "info" });
      } else if (approvalRequired) {
        setToast({ message: "這台新裝置已列入待確認，您目前仍可正常使用系統。", type: "info" });
      }
    }

    if (finalUser?.passwordUpdatedOnFirstLogin) {
      logActivity(roleId, userName, "首次安全更新", {
        activityType: "auth.password_update",
        message: "使用初始密碼登入後，已完成密碼更新",
      });
    }
    setActiveView("dashboard");
    return { ok: true };
  }, [therapists, logActivity, registerAccountDevice]);

  const resumePendingDeviceLogin = useCallback(async () => {
    const pending = pendingDeviceLoginRef.current;
    if (!pending) return;
    setPendingDeviceLogin(null);
    pendingDeviceLoginRef.current = null;
    await handleLogin(pending.roleId, pending.finalUser, pending.loginCredential);
  }, [handleLogin]);

  const cancelPendingDeviceLogin = useCallback(() => {
    pendingDeviceLoginRef.current = null;
    setPendingDeviceLogin(null);
    setLoginSecurityNotice(null);
    setCurrentDeviceTrust({ status: "checking", label: "裝置狀態確認中", deviceShort: "", deviceId: "" });
  }, []);

  const buildDeviceSecurityActor = useCallback(() => ({
    roleId: userRole || "",
    accountId: currentSecurityAccountRawId,
    accountKey: currentSecurityAccountKey,
    userName: currentUser?.name || userRole || "",
    deviceId: currentDeviceTrust?.deviceId || getClientDeviceInfo().deviceId,
    // 僅傳給 Device Security backend 做當次再驗證，不寫入任何前端儲存空間。
    credentialPassword: securitySessionCredentialRef.current || "",
  }), [userRole, currentSecurityAccountRawId, currentSecurityAccountKey, currentUser, currentDeviceTrust]);

  const updateTelegramSecurityAlertConfig = useCallback(async ({ config, expectedRevision = 0, credentialPassword = "" } = {}) => {
    if (!isDeviceSecuritySuperAdmin) {
      throw new Error("只有最高管理者可以修改登入安全 Telegram 設定");
    }
    if (currentDeviceTrust?.status !== "trusted") {
      throw new Error("目前裝置尚未完成信任確認，無法修改登入安全 Telegram 設定");
    }
    const password = String(credentialPassword || "").trim();
    if (!password) {
      throw new Error("請輸入目前最高管理者密碼");
    }
    return callDeviceSecurityEndpoint(TELEGRAM_SECURITY_CONFIG_ENDPOINT, {
      brandId: currentBrandId,
      config,
      expectedRevision: Math.max(0, Number(expectedRevision || 0)),
      actor: {
        ...buildDeviceSecurityActor(),
        roleId: "director",
        credentialPassword: password,
      },
    });
  }, [
    isDeviceSecuritySuperAdmin,
    currentDeviceTrust?.status,
    callDeviceSecurityEndpoint,
    currentBrandId,
    buildDeviceSecurityActor,
  ]);

  const reviewDeviceApprovalAction = useCallback(async ({ request, action, verificationCode = "" }) => {
    try {
      return await callDeviceSecurityEndpoint(DEVICE_APPROVAL_REVIEW_ENDPOINT, {
        brandId: currentBrandId,
        requestId: request?.requestId || request?.id,
        action,
        verificationCode,
        actor: buildDeviceSecurityActor(),
      });
    } catch (error) {
      return { ok: false, message: error?.result?.message || error.message || "目前無法完成裝置確認" };
    }
  }, [callDeviceSecurityEndpoint, currentBrandId, buildDeviceSecurityActor]);

  const manageDeviceSecurityAction = useCallback(async (profile, device, nextStatus) => {
    try {
      return await callDeviceSecurityEndpoint(DEVICE_MANAGEMENT_ENDPOINT, {
        brandId: currentBrandId,
        accountKey: profile?.id,
        deviceId: device?.deviceId,
        nextStatus,
        actor: buildDeviceSecurityActor(),
      });
    } catch (error) {
      return { ok: false, message: error?.result?.message || error.message || "裝置狀態更新失敗" };
    }
  }, [callDeviceSecurityEndpoint, currentBrandId, buildDeviceSecurityActor]);

  const emergencyRecoverDevice = useCallback(async ({ masterPassword, target = null } = {}) => {
    const pending = target || pendingDeviceLoginRef.current || loginSecurityNotice;
    if (!pending) return { ok: false, message: "目前沒有需要協助的裝置" };
    const roleId = pending.roleId || "unknown";
    const accountId = sanitizeSecurityKey(pending.loginCredential?.accountId || pending.accountId || pending.finalUser?.id || pending.finalUser?.accountId || pending.finalUser?.name || pending.userName || roleId);
    const userName = pending.finalUser?.name || pending.userName || accountId;
    const deviceInfo = pending.deviceInfo || getClientDeviceInfo();
    try {
      return await callDeviceSecurityEndpoint(DEVICE_EMERGENCY_ENDPOINT, {
        brandId: currentBrandId,
        masterPassword,
        roleId,
        accountId,
        userName,
        deviceInfo,
        loginLocation: pending.loginLocation || pending.blockedData?.loginLocation || UNKNOWN_LOGIN_LOCATION,
        blockedDeviceId: pending.blockedDeviceId || pending.blockedData?.deviceId || pending.recoveredFromDeviceId || "",
      });
    } catch (error) {
      return { ok: false, message: error?.result?.message || error.message || "目前無法完成協助" };
    }
  }, [callDeviceSecurityEndpoint, currentBrandId, loginSecurityNotice]);

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

  const refreshDelegations = useCallback(async (options = {}) => {
    if (!user) return [];
    const includeHistory = options === true || options?.includeHistory === true;
    try {
      const collectionRef = getCollectionPath("management_delegations");
      const sourceQuery = includeHistory
        ? collectionRef
        : query(collectionRef, where("status", "in", ["active", "scheduled"]));
      const snap = await getDocs(sourceQuery);
      const rows = snap.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
      const label = includeHistory ? "management_delegations_history" : "management_delegations_active";
      trackReadSource(label, rows.length, getStableReadMeta(label));
      setDelegations(rows);
      return rows;
    } catch (error) {
      console.error("代理與托管資料更新失敗：", error);
      return [];
    }
  }, [user, getCollectionPath, getStableReadMeta]);

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
  const handleUpdateAuditExclusions = useCallback(async (newExclusions) => {
    const brandIdAtStart = currentBrandId;
    const nextExclusions = Array.isArray(newExclusions) ? [...newExclusions] : [];
    const auditExclusionsDoc = getDocPath("audit_exclusions");

    try {
      await setDoc(auditExclusionsDoc, { stores: nextExclusions });
      if (currentBrandIdRef.current === brandIdAtStart) {
        setAuditExclusions(nextExclusions);
      }
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }, [currentBrandId, getDocPath]);
  
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

  useEffect(() => {
    const refreshDateKey = () => setDelegationDateKey((previous) => {
      const next = getLocalDateString();
      return previous === next ? previous : next;
    });
    const timer = window.setInterval(refreshDateKey, 60 * 1000);
    window.addEventListener("focus", refreshDateKey);
    document.addEventListener("visibilitychange", refreshDateKey);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshDateKey);
      document.removeEventListener("visibilitychange", refreshDateKey);
    };
  }, []);

  const activeDelegations = useMemo(
    () => resolveActiveDelegations(delegations, delegationDateKey),
    [delegations, delegationDateKey]
  );

  const delegationAccess = useMemo(() => buildDelegationAccessProfile({
    role: userRole,
    user: currentUser || {},
    managers,
    storeAccounts,
    delegations,
    date: delegationDateKey,
  }), [userRole, currentUser, managers, storeAccounts, delegations, delegationDateKey]);

  const accessibleStores = delegationAccess.accessibleStores || [];
  const officialStores = delegationAccess.officialStores || [];
  const delegatedStores = delegationAccess.delegatedStores || [];

  const canAccessStore = useCallback(
    (storeName) => canAccessDelegatedStore(delegationAccess, storeName),
    [delegationAccess]
  );

  const canEditStoreReport = useCallback(
    (storeName, permissionKey = "editReports") => canPerformDelegatedStoreAction(delegationAccess, storeName, permissionKey),
    [delegationAccess]
  );

  const getActiveDelegationForStore = useCallback((storeName, date = null, permissionKey = "") => resolveDelegationForStore({
    delegations,
    storeName,
    managers,
    storeAccounts,
    date: date || delegationDateKey,
    permissionKey,
  }), [delegations, managers, storeAccounts, delegationDateKey]);

  const visibleRawData = useMemo(() => {
    if (userRole === ROLES.TRAINER.id) return []; 
    if ((userRole === ROLES.STORE.id || userRole === ROLES.MANAGER.id) && currentUser) {
      const allowed = new Set((accessibleStores || []).map(normalizeStore).filter(Boolean));
      return rawData.filter((d) => allowed.has(normalizeStore(d.storeName || d.store)));
    }
    return rawData;
  }, [rawData, userRole, currentUser, accessibleStores, normalizeStore]);


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
    if ((userRole === ROLES.MANAGER.id || userRole === ROLES.STORE.id) && currentUser) {
      const allowed = new Set((accessibleStores || []).map(normalizeStore).filter(Boolean));
      const filteredManagers = {};
      Object.entries(managers || {}).forEach(([mgr, stores]) => {
        const intersectingStores = (Array.isArray(stores) ? stores : []).filter((store) => allowed.has(normalizeStore(store)));
        if (intersectingStores.length > 0) filteredManagers[mgr] = intersectingStores;
      });
      result = filteredManagers;
    }
    // 正式分組不因代理而改名；代理人看得到受託店家，但店家仍列在原區長名下。
    if (activeView !== 'settings' && userRole !== 'director' && userRole !== 'master') {
       const filtered = {};
       Object.entries(result || {}).forEach(([mgr, stores]) => { if (!String(mgr).includes("未分配") && !String(mgr).includes("未分區")) filtered[mgr] = Array.isArray(stores) ? stores : []; });
       return filtered;
    }
    return result;
  }, [managers, userRole, currentUser, activeView, normalizeStore, accessibleStores]);

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
    user, loading, analytics, managers: visibleManagers, managerOrder: visibleManagerOrder, budgets, monthlyTargetSummary, currentLifecycleMasterState, currentDashboardSummary, currentRankingsSummary, currentReportSummaryReady, currentReportSummaryReadyYearMonth, currentReportSummaryReadyBrandId, currentSummaryRecalcFlagState, historicalDetailRefreshState, targets, rawData: visibleRawData, allReports: rawData,
    annualAggregatedData, annualDashboardSummaries, annualSummaryStatusMap, annualSummaryLoadState, therapistAnnualAggregatedData, // ★ 把年度 Summary 與管理師資料交出去
    showToast, openConfirm, fmtMoney, fmtNum, inputDate, setInputDate, storeList: analytics?.storeList || [], setTargets, selectedYear, selectedMonth, setSelectedYear, setSelectedMonth, permissions, storeAccounts, managerAuth, currentUser, userRole, logActivity, handleUpdateStorePassword, handleUpdateManagerPassword, handleUpdateTherapistPassword, navigateToStore, activeView, appId, 
    therapists: visibleTherapists, therapistReports: visibleTherapistReports, therapistSchedules, therapistTargets, trainerAuth, handleUpdateTrainerAuth, auditExclusions, handleUpdateAuditExclusions, currentBrand, setCurrentBrandId, getCollectionPath, getDocPath, dailyLoginCount, yesterdayLoginCount, securityConfig, featureFlags, therapistModuleEnabled, isOnline, isLowPowerMode,
    currentDeviceTrust, currentSecurityAccountKey, manageDeviceSecurityAction, reviewDeviceApprovalAction, updateTelegramSecurityAlertConfig, canManageDeviceSecurity: isDeviceSecuritySuperAdmin, openDeviceApprovalPanel,
    fetchGlobalData,
    officialManagers: managers,
    delegations, activeDelegations, delegationAccess, accessibleStores, officialStores, delegatedStores,
    refreshDelegations, canAccessStore, canEditStoreReport, getActiveDelegationForStore,
    directorLevel,
    directorPermissionProfile,
    canDirectorAccessView,
    isReadOnlyDirector: userRole === "director" && !canDirectorAccessView("history")
  }), [user, loading, analytics, visibleManagers, visibleManagerOrder, budgets, monthlyTargetSummary, currentLifecycleMasterState, currentDashboardSummary, currentRankingsSummary, currentReportSummaryReady, currentReportSummaryReadyYearMonth, currentReportSummaryReadyBrandId, currentSummaryRecalcFlagState, historicalDetailRefreshState, targets, visibleRawData, rawData, annualAggregatedData, annualDashboardSummaries, annualSummaryStatusMap, annualSummaryLoadState, therapistAnnualAggregatedData, inputDate, selectedYear, selectedMonth, permissions, storeAccounts, managerAuth, currentUser, userRole, logActivity, handleUpdateStorePassword, handleUpdateManagerPassword, handleUpdateTherapistPassword, navigateToStore, activeView, appId, visibleTherapists, visibleTherapistReports, therapistSchedules, therapistTargets, trainerAuth, handleUpdateTrainerAuth, auditExclusions, handleUpdateAuditExclusions, currentBrand, setCurrentBrandId, getCollectionPath, getDocPath, dailyLoginCount, yesterdayLoginCount, securityConfig, featureFlags, therapistModuleEnabled, isOnline, isLowPowerMode, currentDeviceTrust, currentSecurityAccountKey, manageDeviceSecurityAction, reviewDeviceApprovalAction, updateTelegramSecurityAlertConfig, isDeviceSecuritySuperAdmin, openDeviceApprovalPanel, fetchGlobalData, managers, delegations, activeDelegations, delegationAccess, accessibleStores, officialStores, delegatedStores, refreshDelegations, canAccessStore, canEditStoreReport, getActiveDelegationForStore, directorLevel, directorPermissionProfile, canDirectorAccessView]); // ★ 依賴陣列也要加
  
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
    if (!inputPassword) {
      setToast({ message: "請輸入最高管理者密碼。", type: "error" });
      return;
    }

    setIsEmergencyUnlocking(true);
    try {
      const result = await emergencyRecoverDevice({ masterPassword: inputPassword, target: loginSecurityNotice });
      if (!result?.ok) {
        setToast({ message: result?.message || "目前無法完成協助。", type: "error" });
        return;
      }
      try {
        localStorage.setItem("cyj_device_unblock_success_notice", JSON.stringify({
          deviceId: loginSecurityNotice?.deviceInfo?.deviceId || "",
          deviceShort: loginSecurityNotice?.deviceShort || "",
          at: Date.now(),
        }));
      } catch (storageError) {
        console.warn("裝置恢復提示暫存失敗:", storageError);
      }
      setLoginSecurityNotice({
        type: "unblocked",
        title: "這台裝置已恢復使用",
        message: "已由最高管理者完成協助，請重新登入。",
        deviceShort: loginSecurityNotice?.deviceShort || "",
      });
      setEmergencyMasterPassword("");
      setToast({ message: "這台裝置已恢復使用，請重新登入。", type: "success" });
    } catch (error) {
      console.error("最高管理者協助失敗:", error);
      setToast({ message: "目前無法完成協助，請稍後再試。", type: "error" });
    } finally {
      setIsEmergencyUnlocking(false);
    }
  };





  if (pendingDeviceLogin) {
    const approvalRequestRef = doc(getCollectionPath("device_approval_requests"), pendingDeviceLogin.requestId);
    return (
      <DeviceApprovalGate
        approval={pendingDeviceLogin}
        requestRef={approvalRequestRef}
        onApproved={resumePendingDeviceLogin}
        onCancel={cancelPendingDeviceLogin}
        onEmergencyRecovery={(masterPassword) => emergencyRecoverDevice({ masterPassword, target: pendingDeviceLogin })}
      />
    );
  }

  if (!userRole) return (
    <>
      <LoginView 
        appVersion={CURRENT_APP_VERSION}
        onLogin={handleLogin}
        onSecurityEvent={reportLoginSecurityEvent}
        storeAccounts={storeAccounts} managers={publicManagers} managerOrder={managerOrder} managerAuth={managerAuth} therapists={therapists} 
        onUpdatePassword={handleUpdateStorePassword} onUpdateManagerPassword={handleUpdateManagerPassword} onUpdateTherapistPassword={handleUpdateTherapistPassword} 
        trainerAuth={trainerAuth} handleUpdateTrainerAuth={handleUpdateTrainerAuth} directorAuth={directorAuth} handleUpdateDirectorAuth={handleUpdateDirectorAuth} masterAuth={masterAuth}
        currentBrandId={currentBrandId} onSwitchBrand={handleSwitchBrand} hasSelectedBrand={hasSelectedBrand}
        accountDirectoryStatus={accountDirectoryState.status}
        accountDirectoryError={accountDirectoryState.error}
        onRetryAccountDirectory={() => fetchGlobalData({ reason: "manual-retry", preserveExisting: false, force: true })}
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
                  最高管理者協助
                </div>
                <div className="text-[11px] font-bold leading-5 text-stone-400 mb-2">
                  僅供裝置誤停用時使用。輸入最高管理者密碼後，只會恢復這台裝置的使用權限，完成後仍需重新登入。
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={emergencyMasterPassword}
                    onChange={(e) => setEmergencyMasterPassword(e.target.value)}
                    placeholder="輸入最高管理者密碼"
                    className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-600 outline-none focus:border-amber-300"
                  />
                  <button
                    type="button"
                    disabled={isEmergencyUnlocking}
                    onClick={handleEmergencyUnblockCurrentDevice}
                    className="shrink-0 rounded-xl border border-[#E8C77A] bg-gradient-to-r from-[#FFF4D8] to-[#EFD399] px-3 py-2 text-xs font-black text-[#6A4D26] disabled:opacity-50 active:scale-95"
                  >
                    {isEmergencyUnlocking ? "處理中" : "協助恢復"}
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
                {loginSecurityNotice.title || "這台裝置已恢復使用"}
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

  const headerDeviceApprovalCount = isDeviceSecuritySuperAdmin
    ? Number(deviceApprovalSummary.brandPendingCount || 0)
    : Number(deviceApprovalSummary.myPendingCount || 0);

  return (
    <AppContext.Provider value={contextValue}>
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 bg-rose-500 text-white z-[999999] py-2 px-4 flex items-center justify-center gap-2 shadow-md animate-in slide-in-from-top-full duration-300">
          <WifiOff size={18} className="animate-pulse" />
          <span className="text-sm font-bold tracking-wide">目前無網路連線！請確保網路通暢，以免報表無法成功送出。</span>
        </div>
      )}

      {superAdminDeviceNotice && isDeviceSecuritySuperAdmin && !guidedDeviceApprovalRequestId && !isDeviceApprovalPanelOpen && (
        <div
          className={`fixed right-3 z-[99980] w-[calc(100%-1.5rem)] max-w-[410px] md:right-6 ${!isOnline ? "top-32" : "top-24"} animate-in fade-in slide-in-from-top-3 md:slide-in-from-right duration-300`}
          role="status"
          aria-live="polite"
        >
          <div className={`overflow-hidden rounded-[1.5rem] border bg-white/95 shadow-[0_20px_60px_rgba(80,62,45,0.20)] backdrop-blur-md ${
            superAdminDeviceNotice.uiStatus === "resolved" ? "border-emerald-100" : "border-[#E8D7BF]"
          }`}>
            <div className={`h-1.5 w-full ${superAdminDeviceNotice.uiStatus === "resolved" ? "bg-emerald-500" : "bg-[#B7863D]"}`} />
            <div className="p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                  superAdminDeviceNotice.uiStatus === "resolved"
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-[#FFF7E8] text-[#B7863D]"
                }`}>
                  {superAdminDeviceNotice.uiStatus === "resolved"
                    ? <CheckCircle size={22} />
                    : <ShieldAlert size={22} />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className={`text-base font-black ${
                    superAdminDeviceNotice.uiStatus === "resolved" ? "text-emerald-700" : "text-[#4D4338]"
                  }`}>
                    {superAdminDeviceNotice.uiStatus === "resolved"
                      ? "這筆申請已完成"
                      : "有一筆新裝置需要確認"}
                  </div>
                  <div className="mt-1 text-xs font-bold text-[#9A8F83]">
                    {superAdminDeviceNotice.uiStatus === "resolved"
                      ? (superAdminDeviceNotice.resolvedText || getDeviceApprovalResolvedText(superAdminDeviceNotice))
                      : `目前有 ${Math.max(1, Number(deviceApprovalSummary.adminAssistancePendingCount || 0))} 筆需要最高管理者處理`}
                  </div>
                </div>
              </div>

              <div className="mt-4 border-t border-[#EFE7DA] pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-black text-[#4D4338]">
                      {superAdminDeviceNotice.userName || "使用者"}
                      <span className="ml-2 text-xs font-black text-[#A69C91]">
                        {DEVICE_APPROVAL_ROLE_LABELS[superAdminDeviceNotice.role] || superAdminDeviceNotice.role || "帳號"}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full border border-[#EDE2D4] bg-[#FAF7F2] px-2.5 py-1 text-[10px] font-black text-[#8A7D70]">
                    {formatDeviceApprovalNoticeTime(superAdminDeviceNotice.requestedAtText)}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-xs font-bold text-[#756A60]">
                  <div className="flex items-center gap-2">
                    <Smartphone size={15} className="shrink-0 text-[#B7863D]" />
                    <span className="truncate">{superAdminDeviceNotice.device || "裝置"} / {superAdminDeviceNotice.browser || "瀏覽器"} / {superAdminDeviceNotice.os || "-"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapIcon size={15} className="shrink-0 text-[#B7863D]" />
                    <span className="truncate">{superAdminDeviceNotice.loginLocation?.display || "位置未確認"}</span>
                  </div>
                </div>

                {superAdminDeviceNotice.uiStatus !== "resolved" && (
                  <>
                    <div className="mt-4 rounded-xl border border-[#F0E3D1] bg-[#FFFBF4] px-3 py-2.5 text-xs font-bold leading-5 text-[#806B52]">
                      {superAdminDeviceNotice.hasTrustedApproverDevice === false
                        ? "此帳號目前沒有其他已信任裝置，需要最高管理者完成第一次確認。"
                        : superAdminDeviceNotice.deviceStatus === "suspicious"
                          ? "這次登入需要主管進一步確認，請核對使用者與裝置資訊。"
                          : "這筆登入無法自行完成認證，需要最高管理者協助確認。"}
                    </div>

                    <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                      <button
                        type="button"
                        onClick={handleOpenSuperAdminDeviceNotice}
                        className="rounded-xl border border-[#D8C19C] bg-gradient-to-r from-[#F8EACD] to-[#E9D0A0] px-4 py-3 text-sm font-black text-[#5A4225] shadow-sm hover:brightness-[1.02] active:scale-[0.98]"
                      >
                        查看並確認
                      </button>
                      <button
                        type="button"
                        onClick={handleDismissSuperAdminDeviceNotice}
                        className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs font-black text-stone-500 hover:bg-stone-100 active:scale-[0.98]"
                      >
                        稍後處理
                      </button>
                    </div>
                    <div className="mt-2 text-center text-[10px] font-bold text-[#B0A59A]">稍後處理只會收起提醒，右上角待確認數量仍會保留。</div>
                  </>
                )}

                {superAdminDeviceNotice.uiStatus === "resolved" && (
                  <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-3 text-center text-xs font-black text-emerald-700">
                    已即時同步其他最高管理者的處理結果，這張提醒即將自動收起。
                  </div>
                )}
              </div>
            </div>
          </div>
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
                        : ["new", "observing", "reverify_required", "suspicious"].includes(currentDeviceTrust.status)
                          ? "border-rose-100 bg-rose-50 text-rose-600"
                          : currentDeviceTrust.status === "trusted"
                            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                            : "border-stone-100 bg-stone-50 text-stone-500"
                    }`}
                    title={currentDeviceTrust.deviceShort ? `裝置碼：${currentDeviceTrust.deviceShort}` : "目前裝置狀態"}
                  >
                    <span className="2xl:hidden truncate">
                      {currentDeviceTrust.status === "blocked" ? "⛔ 已停用" : currentDeviceTrust.status === "reverify_required" ? "⚠ 需重驗" : currentDeviceTrust.status === "observing" ? "⚠ 觀察中" : currentDeviceTrust.status === "suspicious" ? "⚠ 待主管確認" : currentDeviceTrust.status === "new" ? "⚠ 待確認" : currentDeviceTrust.status === "trusted" ? "🛡 已信任" : "確認中"}
                    </span>
                    <span className="hidden 2xl:inline">{currentDeviceTrust.label}</span>
                  </div>
                )}

                {headerDeviceApprovalCount > 0 && (
                  <button
                    type="button"
                    onClick={openDeviceApprovalPanel}
                    className="hidden lg:flex items-center gap-1.5 2xl:gap-2 rounded-full border border-rose-100 bg-rose-50 px-2.5 2xl:px-3 py-2 text-xs font-black text-rose-600 shadow-sm hover:bg-rose-100 active:scale-95 transition-all whitespace-nowrap shrink-0"
                    title={isDeviceSecuritySuperAdmin && deviceApprovalSummary.latestUserName ? `最新：${deviceApprovalSummary.latestUserName}｜${deviceApprovalSummary.latestDevice}` : "有新裝置等待確認"}
                  >
                    <ShieldAlert size={16} />
                    <span className="2xl:hidden">{headerDeviceApprovalCount}</span>
                    <span className="hidden 2xl:inline">待確認 {headerDeviceApprovalCount}</span>
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
                        ["new", "observing", "reverify_required", "suspicious"].includes(currentDeviceTrust.status)
                          ? "border-rose-100 bg-rose-50 text-rose-600"
                          : currentDeviceTrust.status === "trusted"
                            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                            : "border-stone-100 bg-stone-50 text-stone-500"
                      }`}
                      title={currentDeviceTrust.deviceShort ? `裝置碼：${currentDeviceTrust.deviceShort}` : "目前裝置狀態"}
                    >
                      {currentDeviceTrust.status === "blocked"
                        ? "⛔ 已停用"
                        : currentDeviceTrust.status === "reverify_required"
                          ? "⚠ 需重驗"
                          : currentDeviceTrust.status === "observing"
                            ? "⚠ 觀察中"
                            : currentDeviceTrust.status === "suspicious"
                              ? "⚠ 待主管確認"
                              : currentDeviceTrust.status === "new"
                                ? "⚠ 待確認"
                                : currentDeviceTrust.status === "trusted"
                                  ? "🛡 已信任"
                                  : "確認中"}
                    </div>
                  )}

                  {headerDeviceApprovalCount > 0 && (
                    <button
                      type="button"
                      onClick={openDeviceApprovalPanel}
                      className="flex items-center justify-center gap-1 rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1.5 text-[11px] font-black text-rose-600 shadow-sm whitespace-nowrap"
                      title="有新裝置等待確認"
                    >
                      <ShieldAlert size={13} />
                      {headerDeviceApprovalCount}
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

        <DeviceApprovalPanel
          open={Boolean(guidedDeviceApprovalRequestId)}
          guided
          guidedRequestId={guidedDeviceApprovalRequestId}
          currentDeviceId={currentDeviceTrust.deviceId}
          onGuidedComplete={() => setGuidedDeviceApprovalRequestId("")}
          getCollectionPath={getCollectionPath}
          accountKey={currentSecurityAccountKey}
          currentDeviceTrusted={currentDeviceTrust.status === "trusted"}
          isSuperAdmin={isDeviceSecuritySuperAdmin}
          onReview={reviewDeviceApprovalAction}
        />

        <DeviceApprovalPanel
          open={isDeviceApprovalPanelOpen}
          onClose={() => {
            setIsDeviceApprovalPanelOpen(false);
            setSuperAdminApprovalFocusId("");
          }}
          getCollectionPath={getCollectionPath}
          accountKey={currentSecurityAccountKey}
          currentDeviceId={currentDeviceTrust.deviceId}
          currentDeviceTrusted={currentDeviceTrust.status === "trusted"}
          isSuperAdmin={isDeviceSecuritySuperAdmin}
          onReview={reviewDeviceApprovalAction}
          focusRequestId={superAdminApprovalFocusId}
        />

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
