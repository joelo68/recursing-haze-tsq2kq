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

import { app, auth, db, appId } from "./config/firebase";
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "firebase/auth";
import { collection, addDoc, deleteDoc, updateDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, query, orderBy, limit, deleteField, where, increment, getDocs } from "firebase/firestore";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line, ComposedChart, Area, Cell, PieChart, Pie } from "recharts";
import { 
  LayoutDashboard, Upload, TrendingUp, Map as MapIcon, Settings, ClipboardCheck, Menu, Search, Filter, Trash2, Save, Plus, DollarSign, Target, Users, Award, Loader2, FileText, AlertCircle, CheckCircle, User, Store, Lock, LogOut, FileWarning, Edit2, CheckSquare, X, Download, ChevronLeft, ChevronRight, Activity, Sparkles, ChevronDown, 
  Heart, Coffee, Shield, WifiOff,
  ShoppingBag, CreditCard, Smartphone, Monitor, Bell, Clock, Music 
} from "lucide-react";

import { ROLES, ALL_MENU_ITEMS, DEFAULT_REGIONAL_MANAGERS, DEFAULT_PERMISSIONS } from "./constants/index";
import { generateUUID, formatLocalYYYYMMDD, toStandardDateFormat, formatNumber, parseNumber } from "./utils/helpers";
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
const CURRENT_APP_VERSION = "3.1.1"; 

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

export default function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState("dashboard");
  const [auditType, setAuditType] = useState("daily");
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: "", message: "", onConfirm: null });
  const [globalSearchTerm, setGlobalSearchTerm] = useState("");
  const [currentBrandId, setCurrentBrandId] = useState("cyj");
  const [hasSelectedBrand, setHasSelectedBrand] = useState(false);
  const [dailyLoginCount, setDailyLoginCount] = useState(0);
  const [yesterdayLoginCount, setYesterdayLoginCount] = useState(0);

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

  const [rawData, setRawData] = useState([]); 
  const [annualAggregatedData, setAnnualAggregatedData] = useState([]); 
  const [annualDashboardSummaries, setAnnualDashboardSummaries] = useState([]);
  const [annualSummaryStatusMap, setAnnualSummaryStatusMap] = useState({});
  const [therapistAnnualAggregatedData, setTherapistAnnualAggregatedData] = useState([]); // ★新增：管理師專屬結算包
  const [budgets, setBudgets] = useState({});
  const [monthlyTargetSummary, setMonthlyTargetSummary] = useState(null); // ★ monthly_targets_summary/{yearMonth}：Dashboard 目標資料輕量即時來源
  const [targets, setTargets] = useState({ newASP: 3500, trafficASP: 1200 });
  const [managers, setManagers] = useState({});
  const [storeAccounts, setStoreAccounts] = useState([]);
  const [managerAuth, setManagerAuth] = useState({});
  const [permissions, setPermissions] = useState(DEFAULT_PERMISSIONS);
  const [therapists, setTherapists] = useState([]);
  const [directorAuth, setDirectorAuth] = useState({});
  const [trainerAuth, setTrainerAuth] = useState({ password: "0000" });
  const [masterAuth, setMasterAuth] = useState({ password: "BOSS888" });
  const [therapistReports, setTherapistReports] = useState([]); 
  const [therapistSchedules, setTherapistSchedules] = useState({}); 
  const [therapistTargets, setTherapistTargets] = useState({}); 
  const [auditExclusions, setAuditExclusions] = useState([]);

  const [securityConfig, setSecurityConfig] = useState(DEFAULT_SECURITY_CONFIG);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState((new Date().getMonth() + 1).toString());

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

  const logActivity = useCallback(async (role, user, action, details) => {
    if (!isOnline) return; 
    let device = "PC";
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes("android")) device = "Android";
      else if (ua.includes("iphone")||ua.includes("ipad")) device = "iOS";
      else if (ua.includes("mobile")) device = "Mobile";
    }

    const detailPayload = details && typeof details === "object" && !Array.isArray(details) ? details : { message: details || "" };
    const activityType = detailPayload.activityType || detailPayload.type || (
      action === "登入系統" ? "auth.login" :
      action === "登出系統" ? "auth.logout" :
      action.includes("查詢") ? "query" :
      action.includes("修改") || action.includes("更新") || action.includes("刪除") || action.includes("封存") || action.includes("還原") ? "data.change" :
      "general"
    );

    try { 
      await addDoc(getCollectionPath("system_logs"), {
        timestamp: serverTimestamp(),
        createdAtText: new Date().toISOString(),
        role,
        user,
        action,
        details: detailPayload,
        activityType,
        view: detailPayload.view || activeView || "",
        device,
        brand: currentBrandId,
        brandLabel: currentBrand?.label || currentBrandId,
      }); 
      if (action === "登入系統") {
        const todayStr = formatLocalYYYYMMDD(new Date());
        await setDoc(doc(getCollectionPath("system_stats"), todayStr), { count: increment(1), updatedAt: serverTimestamp() }, { merge: true });
      }
    } catch (e) { console.error("Failed to log activity", e); }
  }, [getCollectionPath, currentBrandId, currentBrand, activeView, isOnline]);

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
    });
  }, [activeView, userRole, currentUser, currentBrandId, currentBrand, logActivity]);


  const handleLogout = useCallback(async (reason = "使用者手動登出") => {
    const userName = currentUser?.name || (userRole === "director" ? "高階主管" : (userRole === "trainer" ? "教專" : "未知"));
    if (userRole) logActivity(userRole, userName, "登出系統", reason);
    
    isWarningShowingRef.current = false; 
    setShowIdleWarning(false); 
    setCountdown(securityConfig.logoutWarningSeconds || securityConfig.warningSeconds || 60); 
    lastActivityTimeRef.current = Date.now(); 
    
    localStorage.removeItem("cyj_input_draft"); localStorage.removeItem("cyj_input_draft_v2"); localStorage.removeItem("cyj_input_draft_v3"); 
    localStorage.removeItem("cyj_therapist_draft"); localStorage.removeItem("cyj_therapist_draft_v2");
    
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

      trackReadSource("fetchGlobalData_core_docs", 9, getReadMeta("fetchGlobalData_core_docs"));
      trackReadSource("fetchGlobalData_therapists", thSnap.docs.length, getReadMeta("fetchGlobalData_therapists"));

      if (orgSnap.exists()) {
        const rawManagers = orgSnap.data().managers || {};
        // 保留「未分配」在全域 managers state 中。
        // 原本這裡會把「未分配 / 未分區」過濾掉，導致 SettingsView 儲存後重新 fetchGlobalData 時，
        // 已移入未分配的店家從前端狀態消失，進而讓營運總覽排除這些店家。
        // 登入頁需要隱藏未分配時，統一交給 publicManagers 過濾。
        setManagers(rawManagers);
      } else {
        setManagers(currentBrand.id === 'cyj' ? DEFAULT_REGIONAL_MANAGERS : {}); 
      }

      setStoreAccounts(accSnap.exists() ? accSnap.data().accounts : []);
      setManagerAuth(mAuthSnap.exists() ? mAuthSnap.data() : {});
      setPermissions(permSnap.exists() ? permSnap.data() : DEFAULT_PERMISSIONS);
      setTherapists(thSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setTrainerAuth(trAuthSnap.exists() ? trAuthSnap.data() : { password: "0000" });
      setAuditExclusions(audSnap.exists() ? (audSnap.data().stores || []) : []);
      setSecurityConfig(secSnap.exists() ? normalizeSecurityConfig(secSnap.data()) : DEFAULT_SECURITY_CONFIG);

      if (dAuthSnap.exists()) {
         let data = { ...dAuthSnap.data() };
         if (data.password && Object.keys(data).length === 1) { setDirectorAuth({ "營運總監": data.password }); } 
         else { delete data.password; if (Object.keys(data).length === 0) data = { "營運總監": "0000" }; setDirectorAuth(data); }
      } else {
         let defaultPass = "0000";
         if (currentBrand.id === 'cyj') defaultPass = "16500"; if (currentBrand.id === 'anniu') defaultPass = "8888"; if (currentBrand.id === 'yibo') defaultPass = "9999";
         setDirectorAuth({ "營運總監": defaultPass }); 
      }

      setMasterAuth((mastSnap.exists() && mastSnap.data().password) ? mastSnap.data() : { password: "BOSS888" });
    } catch (error) {
      console.error("Fetch Global Data Error:", error);
    }
  }, [user, currentBrand, getDocPath, getCollectionPath, getReadMeta]);

  useEffect(() => {
    if (!user) return;

    const unsubReadTrackerConfig = onSnapshot(getDocPath("read_tracker_config"), (s) => {
      trackReadSource("read_tracker_config", s.exists() ? 1 : 0, getReadMeta("read_tracker_config"));
      const remoteConfig = s.exists() ? s.data() : { mode: "off" };
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

  const lowFrequencyCacheRef = useRef({});

  // ★ monthly_targets / kpi_targets 穩定監聽：
  // 這兩包資料仍維持 onSnapshot 即時更新，但只跟「登入 / 品牌」有關，避免切換頁面時反覆重建整包監聽。
  // 注意：這裡只負責 budgets / targets；org_structure、therapists 等全域資料仍由原本 fetchGlobalData 流程處理，避免 Dashboard 店家清單被清空。
  
  // monthly_targets 第二階段節流：
  // Dashboard 已優先使用 monthly_targets_summary/{yearMonth}。
  // 完整 monthly_targets 只在年度目標設定、店家目標檢核、系統維護需要時才常駐監聽。
  const shouldLoadMonthlyTargets =
    activeView === "targets" ||
    activeView === "settings" ||
    activeView === "annual" ||
    (activeView === "audit" && auditType === "target");

useEffect(() => {
    if (!shouldLoadMonthlyTargets) {
      // Dashboard 已由 monthly_targets_summary 提供目標資料；不在非必要頁面常駐監聽完整 monthly_targets。
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

    const unsubKpiTargets = onSnapshot(
      getDocPath("kpi_targets"),
      (kpiSnap) => {
        trackReadSource("kpi_targets_live", kpiSnap.exists() ? 1 : 0, getStableReadMeta("kpi_targets_live"));
        setTargets(kpiSnap.exists() ? kpiSnap.data() : { newASP: 3500, trafficASP: 1200 });
      },
      (error) => console.error("kpi_targets 即時監聽失敗:", error)
    );

    return () => {
      try { unsubBudgetTargets && unsubBudgetTargets(); } catch (error) { console.warn("monthly_targets unsubscribe failed", error); }
      try { unsubKpiTargets && unsubKpiTargets(); } catch (error) { console.warn("kpi_targets unsubscribe failed", error); }
    };
  }, [currentBrandId, getCollectionPath, shouldLoadMonthlyTargets]);

  // ★ monthly_targets_summary 輕量即時監聽：
  // 先建立並監聽「目前 Dashboard 月份」的目標 Summary，作為下一階段降低 monthly_targets_live reads 的安全過渡。
  // 目前仍保留原本 monthly_targets 完整監聽作為 fallback，避免目標設定、回報檢核與 Dashboard 達成率受影響。
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

    const targetYearStr = String(selectedYear);
    let isMounted = true;
    const lowFrequencyUnsubs = [];

    fetchGlobalData();

    // ==========================================
    // ★ 第二階段保守節流：維持 Dashboard 所需資料完整，但降低重複讀取
    // monthly_targets 是營運總覽預算、達成率與月底推估的核心資料。
    // useDashboardStats 會用 `${品牌店名}_${年}_${月}` 當 key 查 budgets，
    // 因此這裡不可改成不明確的 where 查詢，否則營運總覽會歸零。
    // 做法：
    // 1. monthly_targets + kpi_targets 保留完整結構，但加入 10 分鐘快取。
    // 2. therapist_schedules 只有進入「管師排休」或「回報檢核 > 管理師日報」才讀。
    // 3. therapist_targets 在 Dashboard / 管師目標頁 /「回報檢核 > 管理師目標」才讀，避免不必要低頻讀取。
    // ==========================================
    const fetchLowFrequencyData = async () => {
      try {
        const cacheTtlMs = 10 * 60 * 1000;
        const nowMs = Date.now();

        // monthly_targets / kpi_targets 已改由品牌層級穩定監聽，這裡只處理按頁面載入的低頻管理師資料。

        const shouldLoadSchedules = activeView === "t-schedule" || (activeView === "audit" && auditType === "therapist-daily");
        const shouldLoadTherapistTargets = activeView === "dashboard" || activeView === "t-targets" || (activeView === "audit" && auditType === "therapist-target");

        if (shouldLoadSchedules) {
          const scheduleCacheKey = `${currentBrand.id}_${targetYearStr}_therapist_schedules_v2`;
          const scheduleCached = lowFrequencyCacheRef.current[scheduleCacheKey];

          if (scheduleCached && scheduleCached.expiresAt > nowMs) {
            setTherapistSchedules(scheduleCached.data || {});
            trackReadSource("therapist_schedules_year_cache_hit", 0, getReadMeta("therapist_schedules_year_cache_hit"));
          } else {
            const scheduleSnap = await getDocs(query(getCollectionPath("therapist_schedules"), where("year", "==", targetYearStr)));
            trackReadSource("therapist_schedules_year", scheduleSnap.docs.length, getReadMeta("therapist_schedules_year_lazy"));

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
          // ★ 管理師目標同樣影響當月人員績效達成率；Dashboard / 管師目標頁維持即時監聽。
          const unsubTherapistTargets = onSnapshot(
            query(getCollectionPath("therapist_targets"), where("year", "==", targetYearStr)),
            (tTargetSnap) => {
              trackSnapshotRead("therapist_targets_year_live", tTargetSnap, getReadMeta("therapist_targets_year_live"));
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

    const todayStr = formatLocalYYYYMMDD(new Date());
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterdayStr = formatLocalYYYYMMDD(d);

    // 登入數字很小，保留即時監聽即可。
    const unsubStatsToday = onSnapshot(doc(getCollectionPath("system_stats"), todayStr), (s) => {
      trackReadSource("system_stats_today", s.exists() ? 1 : 0, getReadMeta("system_stats_today"));
      if (s.exists()) setDailyLoginCount(s.data().count || 0);
      else setDailyLoginCount(0);
    });

    const unsubStatsYesterday = onSnapshot(doc(getCollectionPath("system_stats"), yesterdayStr), (s) => {
      trackReadSource("system_stats_yesterday", s.exists() ? 1 : 0, getReadMeta("system_stats_yesterday"));
      if (s.exists()) setYesterdayLoginCount(s.data().count || 0);
      else setYesterdayLoginCount(0);
    });

    return () => {
      isMounted = false;
      unsubStatsToday();
      unsubStatsYesterday();
      lowFrequencyUnsubs.forEach((unsubscribe) => {
        try { unsubscribe && unsubscribe(); } catch (error) { console.warn("low frequency unsubscribe failed", error); }
      });
    };
  }, [user, currentBrand, getCollectionPath, getDocPath, selectedYear, activeView, auditType, fetchGlobalData, getReadMeta]);


  const monthCacheRef = useRef({});

  useEffect(() => {
    if (!user || isLowPowerMode) return;
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
  }, [user, currentBrand, selectedYear, getCollectionPath, getStableReadMeta, isLowPowerMode]);

  useEffect(() => {
    if (!user || isLowPowerMode) return;

    const targetYear = String(selectedYear);
    const targetMonth = String(selectedMonth).padStart(2, '0');
    const cacheKey = `${currentBrand.id}_${targetYear}_${targetMonth}`;

    const now = new Date();
    const currentRealYear = String(now.getFullYear());
    const currentRealMonth = String(now.getMonth() + 1).padStart(2, '0');
    const isCurrentMonth = (targetYear === currentRealYear && targetMonth === currentRealMonth);

    const startDate = `${targetYear}-${targetMonth}-01`;
    const endDate = `${targetYear}-${targetMonth}-31`;

    if (isCurrentMonth) {
      setRawData([]);
      setTherapistReports([]);

      const unsubReports = onSnapshot(
        query(getCollectionPath("daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc")),
        (s) => {
          trackSnapshotRead("daily_reports_current_month", s, getStableReadMeta("daily_reports_current_month"));
          setRawData(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        }
      );

      const unsubTherapistReports = onSnapshot(
        query(getCollectionPath("therapist_daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc")),
        (s) => {
          trackSnapshotRead("therapist_daily_reports_current_month", s, getStableReadMeta("therapist_daily_reports_current_month"));
          setTherapistReports(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        }
      );

      return () => {
        unsubReports();
        unsubTherapistReports();
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
            getDocs(query(getCollectionPath("daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc"))),
            getDocs(query(getCollectionPath("therapist_daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc")))
          ]);

          trackReadSource("daily_reports_past_month_getDocs", reportsSnap.docs.length, getStableReadMeta("daily_reports_past_month_getDocs"));
          trackReadSource("therapist_daily_reports_past_month_getDocs", tReportsSnap.docs.length, getStableReadMeta("therapist_daily_reports_past_month_getDocs"));

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
  }, [user, currentBrand, selectedYear, selectedMonth, getCollectionPath, getStableReadMeta, isLowPowerMode]);


 const handleLogin = useCallback((roleId, userInfo = null) => {
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
    logActivity(roleId, userName, "登入系統", finalUser?.passwordUpdatedOnFirstLogin ? {
      activityType: "auth.login",
      message: "登入成功，已完成首次安全更新",
      passwordUpdatedOnFirstLogin: true,
    } : "登入成功"); 
    if (finalUser?.passwordUpdatedOnFirstLogin) {
      logActivity(roleId, userName, "首次安全更新", {
        activityType: "auth.password_update",
        message: "使用初始密碼登入後，已完成密碼更新",
      });
    }
    setActiveView("dashboard");
  }, [therapists, logActivity]);

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
  const handleUpdateTrainerAuth = useCallback(async (newPass) => { try { await setDoc(getDocPath("trainer_auth"), { password: newPass }); return true; } catch (e) { console.error(e); return false; } }, [getDocPath]);
  const handleUpdateAuditExclusions = useCallback(async (newExclusions) => { try { await setDoc(getDocPath("audit_exclusions"), { stores: newExclusions }); return true; } catch (e) { console.error(e); return false; } }, [getDocPath]);
  
  const handleUpdateDirectorAuth = useCallback(async (action, name, newPass, newName = null) => { 
    try { 
      const docRef = getDocPath("director_auth");
      if (action === 'delete') { await updateDoc(docRef, { [name]: deleteField() }); } 
      else if (action === 'rename') { await setDoc(docRef, { [newName]: newPass }, { merge: true }); await updateDoc(docRef, { [name]: deleteField() }); } 
      else { await setDoc(docRef, { [name]: newPass }, { merge: true }); }
      return true; 
    } catch (e) { console.error(e); return false; } 
  }, [getDocPath]);

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
    user, loading, analytics, managers: visibleManagers, budgets, monthlyTargetSummary, targets, rawData: visibleRawData, allReports: rawData, 
    annualAggregatedData, annualDashboardSummaries, annualSummaryStatusMap, therapistAnnualAggregatedData, // ★ 把年度 Summary 與管理師資料交出去
    showToast, openConfirm, fmtMoney, fmtNum, inputDate, setInputDate, storeList: analytics?.storeList || [], setTargets, selectedYear, selectedMonth, permissions, storeAccounts, managerAuth, currentUser, userRole, logActivity, handleUpdateStorePassword, handleUpdateManagerPassword, handleUpdateTherapistPassword, navigateToStore, activeView, appId, 
    therapists: visibleTherapists, therapistReports: visibleTherapistReports, therapistSchedules, therapistTargets, trainerAuth, handleUpdateTrainerAuth, auditExclusions, handleUpdateAuditExclusions, currentBrand, setCurrentBrandId, getCollectionPath, getDocPath, dailyLoginCount, yesterdayLoginCount, securityConfig, isOnline, isLowPowerMode,
    fetchGlobalData 
  }), [user, loading, analytics, visibleManagers, budgets, monthlyTargetSummary, targets, visibleRawData, rawData, annualAggregatedData, annualDashboardSummaries, annualSummaryStatusMap, therapistAnnualAggregatedData, inputDate, selectedYear, selectedMonth, permissions, storeAccounts, managerAuth, currentUser, userRole, logActivity, handleUpdateStorePassword, handleUpdateManagerPassword, handleUpdateTherapistPassword, navigateToStore, activeView, appId, visibleTherapists, visibleTherapistReports, therapistSchedules, therapistTargets, trainerAuth, handleUpdateTrainerAuth, auditExclusions, handleUpdateAuditExclusions, currentBrand, setCurrentBrandId, getCollectionPath, getDocPath, dailyLoginCount, yesterdayLoginCount, securityConfig, isOnline, isLowPowerMode, fetchGlobalData]); // ★ 依賴陣列也要加
  
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
          {activeView === "history" && <HistoryView />}
          {activeView === "input" && <InputView />}
          {activeView === "logs" && <SystemMonitor />}
          {activeView === "settings" && <SettingsView />}
          {activeView === "annual" && <AnnualView />}
          {activeView === "targets" && <TargetView />}
          {activeView === "t-targets" && <TherapistTargetView />}
          {activeView === "t-schedule" && <TherapistScheduleView />}
          {activeView === "notification" && <NotificationManager />}
          {activeView === "therapist-manager" && <TherapistManagerView />}
        </Suspense>
      </main>
    );
  }, [activeView, auditType]);

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

  if (!userRole) return (
    <LoginView 
      appVersion={CURRENT_APP_VERSION}
      onLogin={handleLogin} storeAccounts={storeAccounts} managers={publicManagers} managerAuth={managerAuth} therapists={therapists} 
      onUpdatePassword={handleUpdateStorePassword} onUpdateManagerPassword={handleUpdateManagerPassword} onUpdateTherapistPassword={handleUpdateTherapistPassword} 
      trainerAuth={trainerAuth} handleUpdateTrainerAuth={handleUpdateTrainerAuth} directorAuth={directorAuth} handleUpdateDirectorAuth={handleUpdateDirectorAuth} masterAuth={masterAuth}
      currentBrandId={currentBrandId} onSwitchBrand={handleSwitchBrand} hasSelectedBrand={hasSelectedBrand}
    />
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
        <Sidebar activeView={activeView} setActiveView={setActiveView} isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} user={user} userRole={userRole} onLogout={() => handleLogout()} permissions={permissions} currentUser={currentUser} />
        <div className={`flex-1 flex flex-col transition-all duration-500 w-full max-w-full ${isSidebarOpen ? "md:ml-64" : "md:ml-20"} ml-0`}>
          <header className="h-20 bg-white/80 backdrop-blur-md border-b border-stone-200 sticky top-0 z-40 px-4 md:px-8 flex items-center justify-between shadow-sm shadow-stone-200/50 shrink-0 transition-all">
            <div className="flex items-center gap-4">
              <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2.5 hover:bg-stone-100 rounded-xl text-stone-400 hidden md:block transition-colors"><Menu size={24} /></button>
              
              <h1 className="text-xl md:text-2xl font-extrabold text-stone-800 tracking-tight truncate hidden sm:flex items-center gap-2">
                <span className="text-amber-600">●</span> 
                {ALL_MENU_ITEMS.find((i) => i.id === activeView)?.label || (activeView === 'targets' ? '年度目標設定' : 'DRCYJ System')}
                <span className="ml-2 text-[11px] font-mono bg-stone-100 text-stone-400 px-2 py-0.5 rounded-md border border-stone-200/60 shadow-inner select-all" title="系統當前版本">
                  v{CURRENT_APP_VERSION}
                </span>
              </h1>
              
              <h1 className="text-lg font-bold text-stone-800 tracking-tight truncate md:hidden flex items-center gap-2">
                <Coffee size={20} className="text-amber-600" /> DRCYJ Cloud
                <span className="ml-1 text-[10px] font-mono bg-stone-100 text-stone-400 px-1.5 py-0.5 rounded-md border border-stone-200/60 shadow-inner select-all">
                  v{CURRENT_APP_VERSION}
                </span>
              </h1>
            </div>
            <div className="flex items-center gap-3 md:gap-5 flex-1 justify-end">
              <div className="relative hidden md:block w-56 lg:w-72 group"><Search className="absolute left-3 top-2.5 text-stone-400 group-focus-within:text-stone-600 transition-colors" size={18} /><input type="text" placeholder="搜尋店名..." value={globalSearchTerm} onChange={(e) => setGlobalSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-full text-sm focus:ring-4 focus:ring-stone-100 focus:border-stone-300 transition-all outline-none shadow-sm text-stone-600 placeholder-stone-300" />{globalSearchTerm && (<div className="absolute top-full left-0 right-0 mt-2 bg-white border border-stone-200 rounded-2xl shadow-xl z-50 max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2">{allStoreNames.filter((s) => s.includes(globalSearchTerm)).length > 0 ? (allStoreNames.filter((s) => s.includes(globalSearchTerm)).map((s) => (<button key={s} onClick={() => { navigateToStore(s); setGlobalSearchTerm(""); }} className="w-full text-left px-4 py-3 hover:bg-stone-50 text-sm font-medium text-stone-600 flex items-center gap-2 transition-colors"><Store size={16} className="text-stone-400" /> {s}</button>))) : (<div className="px-4 py-3 text-xs text-stone-400 text-center">無相符店家</div>)}</div>)}</div>
              <div className="flex items-center gap-2 bg-stone-100 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border border-stone-200">
                <Filter size={16} className="text-stone-400 hidden sm:block" />
                <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="bg-transparent text-sm font-bold text-stone-600 outline-none border-r border-stone-200 pr-2 mr-2 cursor-pointer hover:text-stone-800 transition-colors">{[2025, 2026, 2027].map((y) => (<option key={y} value={y}>{y}</option>))}</select>
                <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="bg-transparent text-sm font-bold text-stone-600 outline-none cursor-pointer hover:text-stone-800 transition-colors">{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (<option key={m} value={m}>{m}月</option>))}</select>
              </div>
            </div>
          </header>
          <MobileTopNav activeView={activeView} setActiveView={setActiveView} permissions={permissions} userRole={userRole} onLogout={() => handleLogout()} />
          
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