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
// 注意：我們已經移除部分被移入子元件的 Icon，但保留了可能在 DashboardView 內使用的 Icon
// 如果發現有 Icon 消失 (undefined)，請從下方加回去
// 找到原本 import ... from "lucide-react" 那一大段
// 用下面這一段直接取代它：

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
  Loader2,      // <--- 補回這個 (讀取圈圈)
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
  Coffee,       // <--- 補回這個 (錯誤就是因為少了他)
  ShoppingBag,
  CreditCard,
  Smartphone,
  Monitor,
  Bell,
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

// --- 6. 引入新拆分的元件 (取代原本冗長的定義) ---
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
// ==================== 原本的 UI 元件定義已移除 (移至 components 資料夾) ====================

// --- 接下來是 const AppContext = ... (保持原本的程式碼) ---
// 請將你原本 App.jsx 中，從這裡往下的所有程式碼 (DashboardView, Main App component 等) 完整貼在這裡
// 不要遺漏原本 AppContext 的定義以及 App 主程式
// ... (以下請保留你原本檔案中 AppContext 之後的所有內容)

  const handlePasswordReset = async () => {
    setError("");
    if (!newPassword || !oldPassword) {
      setError("請輸入舊密碼與新密碼");
      return;
    }
    setIsLoading(true);
    let isVerified = false;
    if (role === "store" && selectedUser) {
      const account = storeAccounts.find((a) => a.id === selectedUser);
      if (account && account.password === oldPassword) isVerified = true;
    } else if (role === "manager" && selectedUser) {
      const correctPass = managerAuth[selectedUser] || "0000";
      if (correctPass === oldPassword) isVerified = true;
    }

    if (!isVerified) {
      setError("舊密碼錯誤");
      setIsLoading(false);
      return;
    }

    let success = false;
    if (role === "store" && selectedUser) {
      success = await onUpdatePassword(selectedUser, newPassword);
    } else if (role === "manager" && selectedUser) {
      success = await onUpdateManagerPassword(selectedUser, newPassword);
    }

    if (success) {
      alert("密碼更新成功");
      setIsResetting(false);
      setNewPassword("");
      setOldPassword("");
      setPassword("");
    } else {
      setError("更新失敗");
    }
    setIsLoading(false);
  };


// --- Dashboard View ---
// --- Regional View ---
// --- Ranking View ---
// --- StoreAnalysis View ---

// --- Audit View ---

// --- Input View ---

// --- History View ---

// --- Settings View ---

// --- Log View ---

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
    return () => {
      unsubReports();
      unsubBudgets();
      unsubTargets();
      unsubOrg();
      unsubAccounts();
      unsubManagerAuth();
      unsubPermissions();
    };
  }, [user]);

  const handleLogin = (roleId, userInfo = null) => {
    setUserRole(roleId);
    if (userInfo) setCurrentUser(userInfo);
    const userName =
      userInfo?.name || (roleId === "director" ? "總監" : "未知");
    logActivity(roleId, userName, "登入系統", "登入成功");
    setActiveView(roleId === ROLES.STORE.id ? "input" : "dashboard");
  };
  const handleLogout = () => {
    const userName =
      currentUser?.name || (userRole === "director" ? "總監" : "未知");
    if (userRole) logActivity(userRole, userName, "登出系統", "使用者手動登出");
    localStorage.removeItem("cyj_input_draft");
    setUserRole(null);
    setCurrentUser(null);
    setActiveView("dashboard");
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

 // --- Analytics Logic (從 Hook 引入) ---
  const analytics = useAnalytics(
    visibleRawData,   // 傳入篩選後的日報資料
    visibleManagers,  // 傳入篩選後的組織架構
    budgets,          // 傳入預算資料
    selectedYear,     // 傳入年份
    selectedMonth     // 傳入月份
  );
  // --- Helpers ---
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

  // --- Context Value (被誤刪的部分) ---
  const contextValue = useMemo(
    () => ({
      user,
      loading,
      analytics,
      managers: visibleManagers,
      budgets,
      targets,
      rawData: visibleRawData,
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
    }),
    [
      user,
      loading,
      analytics,
      visibleManagers,
      budgets,
      targets,
      visibleRawData,
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
          onLogout={handleLogout}
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
                {ALL_MENU_ITEMS.find((i) => i.id === activeView)?.label}
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
            onLogout={handleLogout}
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
      </div>
    </AppContext.Provider>
  );
}
// ★★★ 這一行非常重要，絕對不能少 ★★★