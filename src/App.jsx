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

import LoginView from "./components/LoginView";

// ==========================================
// ★ 系統核心版本號 (終極動態快取版)
// ==========================================
const CURRENT_APP_VERSION = "2.6.2"; 

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

const BRANDS = [
  { id: 'cyj', label: 'CYJ', icon: Sparkles, pathType: 'legacy', color: 'amber', gradient: 'from-amber-500 to-orange-600', bg: 'bg-amber-50', text: 'text-amber-600' },
  { id: 'anniu', label: '安妞', icon: Heart, pathType: 'new', color: 'rose', gradient: 'from-rose-400 to-pink-600', bg: 'bg-rose-50', text: 'text-rose-600' },
  { id: 'yibo', label: '伊啵', icon: Music, pathType: 'new', color: 'sky', gradient: 'from-sky-400 to-indigo-600', bg: 'bg-sky-50', text: 'text-sky-600' }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState("dashboard");
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
  const handleSwitchBrand = (brandId) => { setCurrentBrandId(brandId); setHasSelectedBrand(true); };

  const getCollectionPath = useCallback((collectionName) => {
    return currentBrand.pathType === 'legacy' ? collection(db, "artifacts", appId, "public", "data", collectionName) : collection(db, "brands", currentBrand.id, collectionName);
  }, [currentBrand]);

  const getDocPath = useCallback((docName) => {
    return currentBrand.pathType === 'legacy' ? doc(db, "artifacts", appId, "public", "data", "global_settings", docName) : doc(db, "brands", currentBrand.id, "settings", docName);
  }, [currentBrand]);

  const [rawData, setRawData] = useState([]); 
  const [annualAggregatedData, setAnnualAggregatedData] = useState([]); 
  const [budgets, setBudgets] = useState({});
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

  const [securityConfig, setSecurityConfig] = useState({
    enabled: true, timeoutMinutes: 3, warningSeconds: 15, exemptRoles: ["director", "master"]
  });

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState((new Date().getMonth() + 1).toString());
  const [inputDate, setInputDate] = useState(() => formatLocalYYYYMMDD(new Date()));

  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const [countdown, setCountdown] = useState(15);
  const lastActivityTimeRef = useRef(Date.now()); 
  const isWarningShowingRef = useRef(false);

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
    setCountdown(securityConfig.warningSeconds || 15);
  }, [securityConfig]);

  const handleUserActivity = useCallback(() => {
    if (!userRole) return;
    if (isWarningShowingRef.current) return; 
    lastActivityTimeRef.current = Date.now();
  }, [userRole]); 

  const logActivity = useCallback(async (role, user, action, details) => {
    if (!isOnline) return; 
    let device = "PC";
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes("android")) device = "Android";
      else if (ua.includes("iphone")||ua.includes("ipad")) device = "iOS";
      else if (ua.includes("mobile")) device = "Mobile";
    }
    try { 
      await addDoc(getCollectionPath("system_logs"), { timestamp: serverTimestamp(), role, user, action, details, device, brand: currentBrandId }); 
      if (action === "登入系統") {
        const todayStr = formatLocalYYYYMMDD(new Date());
        await setDoc(doc(getCollectionPath("system_stats"), todayStr), { count: increment(1), updatedAt: serverTimestamp() }, { merge: true });
      }
    } catch (e) { console.error("Failed to log activity", e); }
  }, [getCollectionPath, currentBrandId, isOnline]);

  const handleLogout = useCallback(async (reason = "使用者手動登出") => {
    const userName = currentUser?.name || (userRole === "director" ? "高階主管" : (userRole === "trainer" ? "教專" : "未知"));
    if (userRole) logActivity(userRole, userName, "登出系統", reason);
    
    isWarningShowingRef.current = false; 
    setShowIdleWarning(false); 
    setCountdown(securityConfig.warningSeconds || 15); 
    lastActivityTimeRef.current = Date.now(); 
    
    localStorage.removeItem("cyj_input_draft"); localStorage.removeItem("cyj_input_draft_v2"); localStorage.removeItem("cyj_input_draft_v3"); 
    localStorage.removeItem("cyj_therapist_draft"); localStorage.removeItem("cyj_therapist_draft_v2");
    
    setUserRole(null); setCurrentUser(null); setActiveView("dashboard");
  }, [currentUser, userRole, logActivity, securityConfig]);

  useEffect(() => {
    const globalVersionRef = doc(db, "artifacts", appId, "public", "data", "global_settings", "system_version");

    const checkAndExecuteUpdate = (remoteVersion) => {
      if (remoteVersion && isOlderVersion(CURRENT_APP_VERSION, remoteVersion)) {
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
      const isExempt = securityConfig.exemptRoles?.includes(userRole) || userRole === 'director' || userRole === 'master';
      if (!securityConfig.enabled || isExempt) return; 

      intervalId = setInterval(() => {
        const now = Date.now();
        const elapsed = now - lastActivityTimeRef.current; 
        
        const LOGOUT_THRESHOLD = (securityConfig.timeoutMinutes || 3) * 60 * 1000;  
        const WARNING_THRESHOLD = LOGOUT_THRESHOLD - ((securityConfig.warningSeconds || 15) * 1000);
        
        if (elapsed > LOGOUT_THRESHOLD) { 
          clearInterval(intervalId); 
          handleLogout(`閒置超過 ${securityConfig.timeoutMinutes} 分鐘自動登出`); 
        } 
        else if (elapsed > WARNING_THRESHOLD) { 
          if (!isWarningShowingRef.current) {
            isWarningShowingRef.current = true; 
            setShowIdleWarning(true); 
          }
          const remaining = Math.ceil((LOGOUT_THRESHOLD - elapsed) / 1000); 
          setCountdown(remaining > 0 ? remaining : 0); 
        } 
        else { 
          if (isWarningShowingRef.current) {
            isWarningShowingRef.current = false;
            setShowIdleWarning(false); 
          }
        }
      }, 1000); 
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [userRole, handleLogout, securityConfig]); 

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

  // ==========================================
  // ★ 流量極致優化：設定檔與人員改為單次讀取 (取代 onSnapshot)
  // ==========================================
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

      if (orgSnap.exists()) {
        const rawManagers = orgSnap.data().managers || {};
        const filteredManagers = {};
        Object.keys(rawManagers).forEach(key => { if (!key.includes("未分配") && !key.includes("未分區")) filteredManagers[key] = rawManagers[key]; });
        setManagers(filteredManagers);
      } else {
        setManagers(currentBrand.id === 'cyj' ? DEFAULT_REGIONAL_MANAGERS : {}); 
      }

      setStoreAccounts(accSnap.exists() ? accSnap.data().accounts : []);
      setManagerAuth(mAuthSnap.exists() ? mAuthSnap.data() : {});
      setPermissions(permSnap.exists() ? permSnap.data() : DEFAULT_PERMISSIONS);
      setTherapists(thSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setTrainerAuth(trAuthSnap.exists() ? trAuthSnap.data() : { password: "0000" });
      setAuditExclusions(audSnap.exists() ? (audSnap.data().stores || []) : []);
      setSecurityConfig(secSnap.exists() ? secSnap.data() : { enabled: true, timeoutMinutes: 3, warningSeconds: 15, exemptRoles: ["director", "master"] });

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
  }, [user, currentBrand, getDocPath, getCollectionPath]);


  // ==========================================
  // ★ 黑洞一號修復：將時間鎖 (selectedYear) 重新掛回
  // ==========================================
  useEffect(() => {
    if (!user) return;
    setBudgets({}); setManagers({}); setStoreAccounts([]); setManagerAuth({}); setTherapists([]); setTherapistSchedules({}); setTherapistTargets({}); setPermissions(DEFAULT_PERMISSIONS); setTargets({ newASP: 3500, trafficASP: 1200 });
    setSecurityConfig({ enabled: true, timeoutMinutes: 3, warningSeconds: 15, exemptRoles: ["director", "master"] });

    const targetYearStr = String(selectedYear);

    fetchGlobalData();

    const unsubBudgets = onSnapshot(getCollectionPath("monthly_targets"), (s) => { const b = {}; s.docs.forEach((d) => (b[d.id] = d.data())); setBudgets(b); });
    const unsubTargets = onSnapshot(getDocPath("kpi_targets"), (s) => { if (s.exists()) setTargets(s.data()); else setTargets({ newASP: 3500, trafficASP: 1200 }); });
    
    const unsubTherapistSchedules = onSnapshot(
      query(getCollectionPath("therapist_schedules"), where("year", "==", targetYearStr)), 
      (s) => { const schedules = {}; s.docs.forEach((d) => (schedules[d.id] = d.data())); setTherapistSchedules(schedules); }
    );
    
    const unsubTherapistTargets = onSnapshot(
      query(getCollectionPath("therapist_targets"), where("year", "==", targetYearStr)), 
      (s) => { const t = {}; s.docs.forEach((d) => (t[d.id] = d.data())); setTherapistTargets(t); }
    );

    const todayStr = formatLocalYYYYMMDD(new Date());
    const d = new Date(); d.setDate(d.getDate() - 1);
    const yesterdayStr = formatLocalYYYYMMDD(d);

    const unsubStatsToday = onSnapshot(doc(getCollectionPath("system_stats"), todayStr), (s) => { if (s.exists()) setDailyLoginCount(s.data().count || 0); else setDailyLoginCount(0); });
    const unsubStatsYesterday = onSnapshot(doc(getCollectionPath("system_stats"), yesterdayStr), (s) => { if (s.exists()) setYesterdayLoginCount(s.data().count || 0); else setYesterdayLoginCount(0); });

    return () => { 
      unsubBudgets(); unsubTargets(); unsubTherapistSchedules(); unsubTherapistTargets(); unsubStatsToday(); unsubStatsYesterday(); 
    };
  }, [user, currentBrand, getCollectionPath, getDocPath, selectedYear, fetchGlobalData]); 


  // =========================================================================
  // ★ 終極效能修復：動態快取 (Local Cache) 與視窗解綁
  // =========================================================================
  
  // 建立本地快取池，用來存放「過去月份」的歷史資料
  const monthCacheRef = useRef({});

  // 💦 [獨立水龍頭 A]：年度總帳卡 (永遠只看 selectedYear，不受切換畫面影響)
  useEffect(() => {
    if (!user) return;
    const targetYear = String(selectedYear);

    const unsubAgg = onSnapshot(
      query(getCollectionPath("monthly_aggregated"), where("year", "in", [targetYear, Number(targetYear)])),
      (s) => setAnnualAggregatedData(s.docs.map((d) => ({ id: d.id, ...d.data() })))
    );

    return () => unsubAgg();
  }, [user, currentBrand, selectedYear, getCollectionPath]);

  // 💦 [獨立水龍頭 B]：月度日報與管理師明細 (導入動態快取策略)
  useEffect(() => {
    if (!user) return;

    const targetYear = String(selectedYear);
    const targetMonth = String(selectedMonth).padStart(2, '0');
    // 讓快取 Key 包含品牌，切換品牌時才不會拿到舊資料
    const cacheKey = `${currentBrand.id}_${targetYear}_${targetMonth}`;

    // 判斷是否為「現實中的當前月份」
    const now = new Date();
    const currentRealYear = String(now.getFullYear());
    const currentRealMonth = String(now.getMonth() + 1).padStart(2, '0');
    const isCurrentMonth = (targetYear === currentRealYear && targetMonth === currentRealMonth);

    const startDate = `${targetYear}-${targetMonth}-01`;
    const endDate = `${targetYear}-${targetMonth}-31`;

    if (isCurrentMonth) {
      // 👉 【情境一】當前月份：店長隨時會輸入，保持 onSnapshot 即時連線
      setRawData([]);
      setTherapistReports([]);

      const unsubReports = onSnapshot(
        query(getCollectionPath("daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc")),
        (s) => setRawData(s.docs.map((d) => ({ id: d.id, ...d.data() })))
      );

      const unsubTherapistReports = onSnapshot(
        query(getCollectionPath("therapist_daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc")),
        (s) => setTherapistReports(s.docs.map((d) => ({ id: d.id, ...d.data() })))
      );

      return () => {
        unsubReports();
        unsubTherapistReports();
      };

    } else {
      // 👉 【情境二】過去月份：歷史資料不變，採用 getDocs 並放入 Local Cache
      if (monthCacheRef.current[cacheKey]) {
        // 🎯 命中快取！直接從瀏覽器記憶體取出，Firebase 讀取數 = 0
        setRawData(monthCacheRef.current[cacheKey].reports);
        setTherapistReports(monthCacheRef.current[cacheKey].therapistReports);
        return;
      }

      // 沒有快取，向 Firebase 單次索取
      setRawData([]);
      setTherapistReports([]);
      let isMounted = true;

      const fetchPastMonth = async () => {
        try {
          const [reportsSnap, tReportsSnap] = await Promise.all([
            getDocs(query(getCollectionPath("daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc"))),
            getDocs(query(getCollectionPath("therapist_daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc")))
          ]);

          if (!isMounted) return;

          const reportsData = reportsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          const tReportsData = tReportsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

          // 📦 存入快取池 (下一次切換回來就不會再抓了)
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
        isMounted = false; // 防止組件卸載後還去 setState
      };
    }
  }, [user, currentBrand, selectedYear, selectedMonth, getCollectionPath]);

  // =========================================================================


  const handleLogin = useCallback((roleId, userInfo = null) => {
    let finalUser = userInfo;
    if (roleId === 'therapist' && userInfo?.name) { const foundTherapist = therapists.find(t => t.name === userInfo.name); if (foundTherapist) { finalUser = { ...userInfo, ...foundTherapist, id: foundTherapist.id || userInfo.id }; } }
    setUserRole(roleId); if (finalUser) setCurrentUser(finalUser);
    const userName = finalUser?.name || (roleId === "director" ? "高階主管" : (roleId === "trainer" ? "教專" : "未知"));
    logActivity(roleId, userName, "登入系統", "登入成功"); setActiveView("dashboard");
  }, [therapists, logActivity]);

  const showToast = useCallback((message, type = "info") => setToast({ message, type }), []);
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

  const visibleTherapistReports = useMemo(() => {
    if (userRole === ROLES.DIRECTOR.id || userRole === ROLES.TRAINER.id || userRole === ROLES.THERAPIST.id) { return therapistReports; }
    if (userRole === ROLES.MANAGER.id && currentUser) { const myCores = (managers[currentUser.name] || []).map(normalizeStore).filter(Boolean); return therapistReports.filter(r => myCores.includes(normalizeStore(r.storeName))); }
    if (userRole === ROLES.STORE.id && currentUser) { const myCores = (currentUser.stores || [currentUser.storeName] || []).map(normalizeStore).filter(Boolean); return therapistReports.filter(r => myCores.includes(normalizeStore(r.storeName))); }
    return [];
  }, [therapistReports, userRole, currentUser, managers, normalizeStore]);

  const visibleTherapists = useMemo(() => {
    if (userRole === ROLES.DIRECTOR.id || userRole === ROLES.TRAINER.id) return therapists;
    if (userRole === ROLES.MANAGER.id && currentUser) { const myCores = (managers[currentUser.name] || []).map(normalizeStore).filter(Boolean); return therapists.filter(t => myCores.includes(normalizeStore(t.store))); }
    if (userRole === ROLES.STORE.id && currentUser) { const myCores = (currentUser.stores || [currentUser.storeName] || []).map(normalizeStore).filter(Boolean); return therapists.filter(t => myCores.includes(normalizeStore(t.store))); }
    if (userRole === ROLES.THERAPIST.id && currentUser) return therapists.filter(t => t.id === currentUser.id);
    return [];
  }, [therapists, userRole, currentUser, managers, normalizeStore]);

  const visibleManagers = useMemo(() => {
    let result = managers; 
    if (userRole === ROLES.MANAGER.id && currentUser) { const myStores = managers[currentUser.name] || []; result = { [currentUser.name]: myStores }; } 
    else if (userRole === ROLES.STORE.id && currentUser) {
      const myCores = (currentUser.stores || (currentUser.storeName ? [currentUser.storeName] : [])).map(normalizeStore);
      const filteredManagers = {};
      Object.entries(managers).forEach(([mgr, stores]) => { const intersectingStores = stores.filter((s) => myCores.includes(normalizeStore(s))); if (intersectingStores.length > 0) filteredManagers[mgr] = intersectingStores; });
      result = filteredManagers;
    }
    if (activeView !== 'settings') {
       const filtered = {};
       Object.entries(result).forEach(([mgr, stores]) => { if (!mgr.includes("未分配") && !mgr.includes("未分區")) filtered[mgr] = stores; });
       return filtered;
    }
    return result;
  }, [managers, userRole, currentUser, activeView, normalizeStore]);

  const publicManagers = useMemo(() => { const filtered = {}; Object.entries(managers).forEach(([mgr, stores]) => { if (!mgr.includes("未分配") && !mgr.includes("未分區")) filtered[mgr] = stores; }); return filtered; }, [managers]);

  const analytics = useAnalytics(visibleRawData, visibleManagers, budgets, selectedYear, selectedMonth);
  const allStoreNames = useMemo(() => { const prefix = currentBrandId === 'anniu' ? '安妞' : currentBrandId === 'yibo' ? '伊啵' : 'CYJ'; return Object.values(managers).flat().map((s) => `${prefix}${normalizeStore(s)}店`); }, [managers, currentBrandId, normalizeStore]);

  const fmtMoney = (val) => `$${(val || 0).toLocaleString()}`;
  const fmtNum = (val) => (val || 0).toLocaleString();

  const contextValue = useMemo(() => ({
    user, loading, analytics, managers: visibleManagers, budgets, targets, rawData: visibleRawData, allReports: rawData, 
    annualAggregatedData, 
    showToast, openConfirm, fmtMoney, fmtNum, inputDate, setInputDate, storeList: analytics?.storeList || [], setTargets, selectedYear, selectedMonth, permissions, storeAccounts, managerAuth, currentUser, userRole, logActivity, handleUpdateStorePassword, handleUpdateManagerPassword, handleUpdateTherapistPassword, navigateToStore, activeView, appId, 
    therapists: visibleTherapists, therapistReports: visibleTherapistReports, therapistSchedules, therapistTargets, trainerAuth, handleUpdateTrainerAuth, auditExclusions, handleUpdateAuditExclusions, currentBrand, setCurrentBrandId, getCollectionPath, getDocPath, dailyLoginCount, yesterdayLoginCount, securityConfig, isOnline,
    fetchGlobalData 
  }), [user, loading, analytics, visibleManagers, budgets, targets, visibleRawData, rawData, annualAggregatedData, inputDate, selectedYear, selectedMonth, permissions, storeAccounts, managerAuth, currentUser, userRole, logActivity, handleUpdateStorePassword, handleUpdateManagerPassword, handleUpdateTherapistPassword, navigateToStore, activeView, appId, visibleTherapists, visibleTherapistReports, therapistSchedules, therapistTargets, trainerAuth, handleUpdateTrainerAuth, auditExclusions, handleUpdateAuditExclusions, currentBrand, setCurrentBrandId, getCollectionPath, getDocPath, dailyLoginCount, yesterdayLoginCount, securityConfig, isOnline, fetchGlobalData]);

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
          {activeView === "audit" && <AuditView />}
          {activeView === "history" && <HistoryView />}
          {activeView === "input" && <InputView />}
          {activeView === "logs" && <SystemMonitor />}
          {activeView === "settings" && <SettingsView />}
          {activeView === "annual" && <AnnualView />}
          {activeView === "targets" && <TargetView />}
          {activeView === "t-targets" && <TherapistTargetView />}
          {activeView === "t-schedule" && <TherapistScheduleView />}
        </Suspense>
      </main>
    );
  }, [activeView]);

  if (loading) return <div className="min-h-screen flex flex-col items-center justify-center bg-[#F9F8F6]"><Loader2 className="w-16 h-16 animate-spin text-stone-400 mb-4" /><p className="animate-pulse text-stone-500 font-bold tracking-wider">Loading DRCYJ Cloud...</p></div>;
  
  if (isUpdating) {
    return (
      <div className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-stone-900 text-white animate-in fade-in duration-300">
        <Loader2 className="w-16 h-16 animate-spin text-amber-500 mb-6" />
        <h2 className="text-3xl font-bold mb-2 tracking-widest">系統強制更新中</h2>
        <p className="text-stone-400 font-mono">正在為您同步最新版本 (v{CURRENT_APP_VERSION} ➡️ 新版)</p>
        <p className="text-stone-500 text-sm mt-4 animate-pulse">請稍候，畫面即將自動重新載入...</p>
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

      <div className={`flex min-h-screen bg-[#F9F8F6] text-stone-600 font-sans selection:bg-stone-200 selection:text-stone-800 overflow-x-hidden transition-all duration-300 ${!isOnline ? 'mt-9' : 'mt-0'}`}>
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
        {toast && (<Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />)}
        <ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={closeConfirmModal} />
        
        {showIdleWarning && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-stone-900/40 backdrop-blur-md animate-in fade-in duration-300 p-4">
            <div className="bg-white p-8 md:p-10 rounded-[2rem] shadow-2xl shadow-stone-900/20 max-w-sm w-full text-center animate-in zoom-in-95 slide-in-from-bottom-4 duration-500 border border-white/60 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-300 via-amber-500 to-amber-300"></div>
              <div className="w-24 h-24 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6 relative">
                <div className="absolute inset-0 rounded-full border-4 border-amber-100 animate-ping opacity-30 duration-1000"></div>
                <Clock size={40} className="animate-pulse" strokeWidth={1.5} />
              </div>
              <div className="mb-8">
                <h3 className="text-2xl font-extrabold text-stone-800 mb-3 tracking-tight">系統閒置提醒</h3>
                <p className="text-stone-500 font-medium text-sm leading-relaxed mb-6">
                  為了保護您的營業數據安全，系統偵測到您已閒置一段時間。系統將於倒數結束後自動登出。
                </p>
                <div className="bg-rose-50 text-rose-600 inline-flex flex-col items-center justify-center rounded-2xl px-8 py-3.5 border border-rose-100/50 shadow-sm shadow-rose-100/50">
                   <span className="text-[10px] font-black text-rose-400 mb-1 tracking-[0.2em] uppercase">Auto Logout</span>
                   <div className="flex items-baseline gap-1.5">
                     <span className="text-5xl font-black font-mono tracking-tighter tabular-nums">{countdown}</span>
                     <span className="text-sm font-bold">秒</span>
                   </div>
                </div>
              </div>
              <button onClick={handleStayLoggedIn} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold tracking-wide hover:bg-stone-800 hover:shadow-xl hover:shadow-stone-900/10 active:scale-[0.97] transition-all flex items-center justify-center gap-2">
                <Shield size={18} strokeWidth={2} /> 確認並保持登入
              </button>
            </div>
          </div>
        )}

      </div>
    </AppContext.Provider>
  );
}