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
} from "react";

// --- 1. 設定檔 ---
import { app, auth, db, appId } from "./config/firebase";

// --- 2. Firebase SDK ---
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithCustomToken,
} from "firebase/auth";

import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  query,
  orderBy,
  limit,
} from "firebase/firestore";

// --- 3. Recharts 圖表 ---
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  ComposedChart,
  Area,
  Cell,
  PieChart,
  Pie,
} from "recharts";

// --- 4. Lucide Icons ---
import {
  LayoutDashboard,
  Upload,
  TrendingUp,
  Map as MapIcon,
  Settings,
  ClipboardCheck,
  Menu,
  Search,
  Filter,
  Trash2,
  Save,
  Plus,
  DollarSign,
  Target,
  Users,
  Award,
  Loader2,
  FileText,
  AlertCircle,
  CheckCircle,
  User,
  Store,
  Lock,
  LogOut,
  FileWarning,
  Edit2,
  CheckSquare,
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  Activity,
  Sparkles,
  ChevronDown,
  Coffee,
  ShoppingBag,
  CreditCard,
  Smartphone,
  Monitor,
  Bell,
  Clock, 
} from "lucide-react";

// --- 5. 常數與工具 ---
import {
  ROLES,
  ALL_MENU_ITEMS,
  DEFAULT_REGIONAL_MANAGERS,
  DEFAULT_PERMISSIONS,
} from "./constants";

import {
  generateUUID,
  formatLocalYYYYMMDD,
  toStandardDateFormat,
  formatNumber,
  parseNumber,
} from "./utils/helpers";

// --- 6. 引入元件 ---
import { ViewWrapper, Card, Skeleton, Toast, ConfirmModal } from "./components/SharedUI";
import { Sidebar, MobileTopNav } from "./components/Navigation";
import LoginView from "./components/LoginView";
import { AppContext } from "./AppContext";
import DashboardView from "./components/DashboardView";
import SmartDatePicker from "./components/SmartDatePicker";
import InputView from "./components/InputView";
import HistoryView from "./components/HistoryView";
import RegionalView from "./components/RegionalView";
import RankingView from "./components/RankingView";
import StoreAnalysisView from "./components/StoreAnalysisView";
import SystemMonitor from "./components/SystemMonitor";
import SettingsView from "./components/SettingsView";
import AuditView from "./components/AuditView";
import { useAnalytics } from "./hooks/useAnalytics";
import AnnualView from "./components/AnnualView";
import TargetView from "./components/TargetView";

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState("dashboard");
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState(null);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null,
  });
  const [globalSearchTerm, setGlobalSearchTerm] = useState("");
  const [rawData, setRawData] = useState([]);
  const [budgets, setBudgets] = useState({});
  const [targets, setTargets] = useState({ newASP: 3500, trafficASP: 1200 });
  const [managers, setManagers] = useState(DEFAULT_REGIONAL_MANAGERS);
  const [storeAccounts, setStoreAccounts] = useState([]);
  const [managerAuth, setManagerAuth] = useState({});
  const [permissions, setPermissions] = useState(DEFAULT_PERMISSIONS);
  const [therapists, setTherapists] = useState([]);

  // ★★★ 閒置自動登出相關狀態 (修正版) ★★★
  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const [countdown, setCountdown] = useState(15); // 新增：倒數秒數狀態
  const idleTimerRef = useRef(null);       

  const [selectedYear, setSelectedYear] = useState(
    new Date().getFullYear().toString()
  );
  const [selectedMonth, setSelectedMonth] = useState(
    (new Date().getMonth() + 1).toString()
  );
  const [inputDate, setInputDate] = useState(() =>
    formatLocalYYYYMMDD(new Date())
  );

  const logActivity = useCallback(async (role, user, action, details) => {
    let device = "PC";
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes("android")) device = "Android";
      else if (
        ua.includes("iphone") ||
        ua.includes("ipad") ||
        ua.includes("ipod")
      )
        device = "iOS";
      else if (ua.includes("mobile")) device = "Mobile";
    }
    try {
      await addDoc(
        collection(db, "artifacts", appId, "public", "data", "system_logs"),
        { timestamp: serverTimestamp(), role, user, action, details, device }
      );
    } catch (e) {
      console.error("Failed to log activity", e);
    }
  }, []);

  // ★★★ 修正 handleLogout ★★★
  const handleLogout = useCallback((reason = "使用者手動登出") => {
    const userName =
      currentUser?.name || (userRole === "director" ? "總監" : "未知");
    
    if (userRole) {
      logActivity(userRole, userName, "登出系統", reason);
    }

    // 清除計時器與狀態
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    setShowIdleWarning(false);
    setCountdown(15);

    localStorage.removeItem("cyj_input_draft");
    localStorage.removeItem("cyj_input_draft_v2"); 
    localStorage.removeItem("cyj_input_draft_v3"); 
    localStorage.removeItem("cyj_therapist_draft"); 
    setUserRole(null);
    setCurrentUser(null);
    setActiveView("dashboard");
  }, [currentUser, userRole, logActivity]);

  // ★★★ 啟動閒置計時器 (只負責觸發警告) ★★★
  const startIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    // 2分45秒 (165000ms) 後顯示警告視窗
    idleTimerRef.current = setTimeout(() => {
      setCountdown(15); // 重置倒數秒數
      setShowIdleWarning(true);
    }, 165000); 
  }, []);

  // ★★★ 倒數計時與自動登出邏輯 (使用 useEffect 驅動動畫) ★★★
  useEffect(() => {
    let interval = null;

    // 當警告視窗出現且還有登入身份時，開始倒數
    if (showIdleWarning && userRole) {
      interval = setInterval(() => {
        setCountdown((prevCount) => {
          if (prevCount <= 1) {
            // 倒數結束，執行登出
            clearInterval(interval);
            handleLogout("閒置超過 3 分鐘自動登出");
            return 0;
          }
          return prevCount - 1;
        });
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showIdleWarning, userRole, handleLogout]);

  // ★★★ 使用者活動處理函式 ★★★
  const handleUserActivity = useCallback(() => {
    if (!userRole) return;

    // 如果警告視窗開著，代表使用者回來了，關閉視窗並重置倒數
    if (showIdleWarning) {
      setShowIdleWarning(false);
      setCountdown(15);
    }
    
    // 重置閒置計時器
    startIdleTimer();
  }, [userRole, showIdleWarning, startIdleTimer]);

  // ★★★ 監聽全域事件 ★★★
  useEffect(() => {
    if (userRole) {
      const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart', 'click'];
      
      let activityTimeout;
      const throttledActivity = () => {
        if (!activityTimeout) {
          handleUserActivity();
          activityTimeout = setTimeout(() => {
            activityTimeout = null;
          }, 1000); 
        }
      };

      events.forEach(event => window.addEventListener(event, throttledActivity));
      
      startIdleTimer();

      return () => {
        events.forEach(event => window.removeEventListener(event, throttledActivity));
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      };
    }
  }, [userRole, handleUserActivity, startIdleTimer]);


  useEffect(() => {
    const initAuth = async () => {
      try {
        if (
          typeof __initial_auth_token !== "undefined" &&
          __initial_auth_token
        ) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.warn("Auth Error:", error);
      }
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubReports = onSnapshot(
      query(
        collection(db, "artifacts", appId, "public", "data", "daily_reports"),
        orderBy("date", "desc")
      ),
      (s) => setRawData(s.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const unsubBudgets = onSnapshot(
      collection(db, "artifacts", appId, "public", "data", "monthly_targets"),
      (s) => {
        const b = {};
        s.docs.forEach((d) => (b[d.id] = d.data()));
        setBudgets(b);
      }
    );
    const unsubTargets = onSnapshot(
      doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "global_settings",
        "kpi_targets"
      ),
      (s) => s.exists() && setTargets(s.data())
    );
    const unsubOrg = onSnapshot(
      doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "global_settings",
        "org_structure"
      ),
      (s) => s.exists() && setManagers(s.data().managers)
    );
    const unsubAccounts = onSnapshot(
      doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "global_settings",
        "store_account_data"
      ),
      (s) => s.exists() && setStoreAccounts(s.data().accounts)
    );
    const unsubManagerAuth = onSnapshot(
      doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "global_settings",
        "manager_auth"
      ),
      (s) => s.exists() && setManagerAuth(s.data())
    );
    const unsubPermissions = onSnapshot(
      doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "global_settings",
        "permissions"
      ),
      (s) => s.exists() && setPermissions(s.data())
    );
    
    const unsubTherapists = onSnapshot(
      collection(db, "artifacts", appId, "public", "data", "therapists"),
      (s) => setTherapists(s.docs.map((d) => ({ id: d.id, ...d.data() })))
    );

    return () => {
      unsubReports();
      unsubBudgets();
      unsubTargets();
      unsubOrg();
      unsubAccounts();
      unsubManagerAuth();
      unsubPermissions();
      unsubTherapists();
    };
  }, [user]);

  const handleLogin = (roleId, userInfo = null) => {
    let finalUser = userInfo;

    if (roleId === 'therapist' && userInfo?.name) {
       console.log("正在補全管理師資料:", userInfo.name);
       const foundTherapist = therapists.find(t => t.name === userInfo.name);
       
       if (foundTherapist) {
         console.log("找到完整資料:", foundTherapist);
         finalUser = {
           ...userInfo,
           ...foundTherapist,
           id: foundTherapist.id || userInfo.id
         };
       }
    }

    setUserRole(roleId);
    if (finalUser) setCurrentUser(finalUser);
    
    const userName = finalUser?.name || (roleId === "director" ? "總監" : "未知");
    logActivity(roleId, userName, "登入系統", "登入成功");
    
    if (roleId === "therapist") {
      setActiveView("input");
    } else {
      setActiveView("dashboard");
    }
  };

  const handleUpdateStorePassword = async (id, newPass) => {
    try {
      const updated = storeAccounts.map((a) =>
        a.id === id ? { ...a, password: newPass } : a
      );
      await setDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "global_settings",
          "store_account_data"
        ),
        { accounts: updated }
      );
      return true;
    } catch (e) {
      return false;
    }
  };
  const handleUpdateManagerPassword = async (name, newPass) => {
    try {
      await setDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "global_settings",
          "manager_auth"
        ),
        { [name]: newPass },
        { merge: true }
      );
      return true;
    } catch (e) {
      return false;
    }
  };

  const allStoreNames = useMemo(
    () =>
      Object.values(managers)
        .flat()
        .map((s) => `CYJ${s}店`),
    [managers]
  );
  const navigateToStore = useCallback((storeName) => {
    setActiveView("store-analysis");
    window.dispatchEvent(
      new CustomEvent("navigate-to-store", { detail: storeName })
    );
  }, []);

  const visibleRawData = useMemo(() => {
    if (userRole === ROLES.STORE.id && currentUser) {
      const myStores = (currentUser.stores || [currentUser.storeName]).map(
        (s) => (s.startsWith("CYJ") ? s : `CYJ${s}店`)
      );
      return rawData.filter((d) => myStores.includes(d.storeName));
    }
    if (userRole === ROLES.MANAGER.id && currentUser) {
      const myStores = (managers[currentUser.name] || []).map(
        (s) => `CYJ${s}店`
      );
      return rawData.filter((d) => myStores.includes(d.storeName));
    }
    return rawData;
  }, [rawData, userRole, currentUser, managers]);

  const visibleManagers = useMemo(() => {
    if (userRole === ROLES.MANAGER.id && currentUser)
      return { [currentUser.name]: managers[currentUser.name] };
    if (userRole === ROLES.STORE.id && currentUser) {
      const myStores =
        currentUser.stores ||
        (currentUser.storeName ? [currentUser.storeName] : []);
      const filteredManagers = {};
      Object.entries(managers).forEach(([mgr, stores]) => {
        const intersectingStores = stores.filter((s) => myStores.includes(s));
        if (intersectingStores.length > 0) {
          filteredManagers[mgr] = intersectingStores;
        }
      });
      return filteredManagers;
    }
    return managers;
  }, [managers, userRole, currentUser]);

  const analytics = useAnalytics(
    visibleRawData,
    visibleManagers,
    budgets,
    selectedYear,
    selectedMonth
  );

  const showToast = (message, type = "info") => setToast({ message, type });
  
  const openConfirm = useCallback(
    (title, message, onConfirm) =>
      setConfirmModal({
        isOpen: true,
        title,
        message,
        onConfirm: () => {
          onConfirm();
          setConfirmModal((p) => ({ ...p, isOpen: false }));
        },
      }),
    []
  );

  const closeConfirmModal = () =>
    setConfirmModal((p) => ({ ...p, isOpen: false }));

  const fmtMoney = (val) => `$${(val || 0).toLocaleString()}`;
  const fmtNum = (val) => (val || 0).toLocaleString();

  const contextValue = useMemo(
    () => ({
      user,
      loading,
      analytics,
      managers: visibleManagers,
      budgets,
      targets,
      rawData: visibleRawData,
      allReports: rawData,
      showToast,
      openConfirm,
      fmtMoney,
      fmtNum,
      inputDate,
      setInputDate,
      storeList: analytics?.storeList || [],
      setTargets,
      selectedYear,
      selectedMonth,
      permissions,
      storeAccounts,
      managerAuth,
      currentUser,
      userRole,
      logActivity,
      handleUpdateStorePassword,
      handleUpdateManagerPassword,
      navigateToStore,
      activeView,
      appId,
      therapists, 
    }),
    [
      user,
      loading,
      analytics,
      visibleManagers,
      budgets,
      targets,
      visibleRawData,
      rawData,
      inputDate,
      selectedYear,
      selectedMonth,
      permissions,
      storeAccounts,
      managerAuth,
      currentUser,
      userRole,
      logActivity,
      handleUpdateStorePassword,
      handleUpdateManagerPassword,
      navigateToStore,
      activeView,
      appId,
      therapists,
    ]
  );

  if (loading)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F9F8F6]">
        <Loader2 className="w-16 h-16 animate-spin text-stone-400 mb-4" />
        <p className="animate-pulse text-stone-500 font-bold tracking-wider">
          Loading DRCYJ Cloud...
        </p>
      </div>
    );
  if (!userRole)
    return (
      <LoginView
        onLogin={handleLogin}
        storeAccounts={storeAccounts}
        managers={managers}
        managerAuth={managerAuth}
        therapists={therapists}
        onUpdatePassword={handleUpdateStorePassword}
        onUpdateManagerPassword={handleUpdateManagerPassword}
      />
    );

  return (
    <AppContext.Provider value={contextValue}>
      <div className="flex min-h-screen bg-[#F9F8F6] text-stone-600 font-sans selection:bg-stone-200 selection:text-stone-800 overflow-x-hidden">
        <Sidebar
          activeView={activeView}
          setActiveView={setActiveView}
          isSidebarOpen={isSidebarOpen}
          setSidebarOpen={setSidebarOpen}
          user={user}
          userRole={userRole}
          onLogout={() => handleLogout()} 
          permissions={permissions}
          currentUser={currentUser}
        />
        <div
          className={`flex-1 flex flex-col transition-all duration-500 w-full max-w-full ${
            isSidebarOpen ? "md:ml-64" : "md:ml-20"
          } ml-0`}
        >
          <header className="h-20 bg-white/80 backdrop-blur-md border-b border-stone-200 sticky top-0 z-40 px-4 md:px-8 flex items-center justify-between shadow-sm shadow-stone-200/50 shrink-0 transition-all">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!isSidebarOpen)}
                className="p-2.5 hover:bg-stone-100 rounded-xl text-stone-400 hidden md:block transition-colors"
              >
                <Menu size={24} />
              </button>
              <h1 className="text-xl md:text-2xl font-extrabold text-stone-800 tracking-tight truncate hidden sm:block flex items-center gap-2">
                <span className="text-amber-600">●</span>{" "}
                {ALL_MENU_ITEMS.find((i) => i.id === activeView)?.label || (activeView === 'targets' ? '年度目標設定' : 'DRCYJ System')}
              </h1>
              <h1 className="text-lg font-bold text-stone-800 tracking-tight truncate md:hidden flex items-center gap-2">
                <Coffee size={20} className="text-amber-600" /> DRCYJ Cloud
              </h1>
            </div>
            <div className="flex items-center gap-3 md:gap-5 flex-1 justify-end">
              <div className="relative hidden md:block w-56 lg:w-72 group">
                <Search
                  className="absolute left-3 top-2.5 text-stone-400 group-focus-within:text-stone-600 transition-colors"
                  size={18}
                />
                <input
                  type="text"
                  placeholder="搜尋店名..."
                  value={globalSearchTerm}
                  onChange={(e) => setGlobalSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-full text-sm focus:ring-4 focus:ring-stone-100 focus:border-stone-300 transition-all outline-none shadow-sm text-stone-600 placeholder-stone-300"
                />
                {globalSearchTerm && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-stone-200 rounded-2xl shadow-xl z-50 max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2">
                    {allStoreNames.filter((s) => s.includes(globalSearchTerm))
                      .length > 0 ? (
                      allStoreNames
                        .filter((s) => s.includes(globalSearchTerm))
                        .map((s) => (
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
                      <div className="px-4 py-3 text-xs text-stone-400 text-center">
                        無相符店家
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 bg-stone-100 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border border-stone-200">
                <Filter size={16} className="text-stone-400 hidden sm:block" />
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="bg-transparent text-sm font-bold text-stone-600 outline-none border-r border-stone-200 pr-2 mr-2 cursor-pointer hover:text-stone-800 transition-colors"
                >
                  {[2024, 2025, 2026].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-transparent text-sm font-bold text-stone-600 outline-none cursor-pointer hover:text-stone-800 transition-colors"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {m}月
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </header>
          <MobileTopNav
            activeView={activeView}
            setActiveView={setActiveView}
            permissions={permissions}
            userRole={userRole}
            onLogout={() => handleLogout()}
          />
          <main className="flex-1 p-4 md:p-8 overflow-y-auto overflow-x-hidden min-w-0 w-full">
            {activeView === "dashboard" && <DashboardView />}
            {activeView === "regional" && <RegionalView />}
            {activeView === "ranking" && <RankingView />}
            {activeView === "audit" && <AuditView />}
            {activeView === "history" && <HistoryView />}
            {activeView === "input" && <InputView />}
            {activeView === "logs" && <SystemMonitor />}
            {activeView === "settings" && <SettingsView />}
            {activeView === "annual" && <AnnualView />}
            {activeView === "store-analysis" && <StoreAnalysisView />}
            {activeView === "targets" && <TargetView />}
          </main>
        </div>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={confirmModal.onConfirm}
          onCancel={closeConfirmModal}
        />

        {/* ★★★ 閒置警告視窗 (動態倒數) ★★★ */}
        {showIdleWarning && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center space-y-6 animate-in zoom-in-95 duration-300 border border-stone-200">
              <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <Clock size={40} className="animate-pulse" /> 
              </div>
              <div>
                <h3 className="text-2xl font-bold text-stone-800 mb-2">閒置提醒</h3>
                <p className="text-stone-500 font-medium">
                  系統偵測到您已閒置一段時間。<br/>
                  將於 <span className="text-rose-500 text-2xl font-black font-mono inline-block min-w-[2ch]">{countdown}</span> 秒後自動登出。
                </p>
              </div>
              <button 
                onClick={handleUserActivity}
                className="w-full py-4 bg-stone-800 text-white rounded-2xl font-bold hover:bg-stone-700 transition-all active:scale-95 shadow-lg"
              >
                保持登入
              </button>
            </div>
          </div>
        )}

      </div>
    </AppContext.Provider>
  );
}