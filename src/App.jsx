/* eslint-disable no-undef */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-unused-vars */
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
      Pie as RechartsPie,
    } from "recharts";
import React, {
  useState,
  useEffect,
  useMemo,
  useContext,
  useCallback,
  useRef,
} from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCustomToken,
} from "firebase/auth";
import {
  getFirestore,
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
  Pie as RechartsPie,
} from "recharts";
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
} from "lucide-react";

// --- Firebase Config ---
const originalConfig = {
  apiKey: "AIzaSyDqeHT2J9Z69k88-clPwKyuywg1TSpojYM",
  authDomain: "cyjsituation-analysis.firebaseapp.com",
  projectId: "cyjsituation-analysis",
  storageBucket: "cyjsituation-analysis.firebasestorage.app",
  messagingSenderId: "139860745126",
  appId: "1:139860745126:web:4539176a4cf73ae4480d67",
  measurementId: "G-L9DVME64VK",
};

const firebaseConfig =
  typeof __firebase_config !== "undefined"
    ? JSON.parse(__firebase_config)
    : originalConfig;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const rawAppId = typeof __app_id !== "undefined" ? __app_id : "default-app-id";
const appId = rawAppId.replace(/\//g, "_");

// --- Constants ---
const ROLES = {
  DIRECTOR: { id: "director", label: "總監", pass: "16500" },
  MANAGER: { id: "manager", label: "區長", pass: null },
  STORE: { id: "store", label: "店經理", pass: null },
};

const ALL_MENU_ITEMS = [
  { id: "dashboard", label: "營運總覽", icon: LayoutDashboard },
  { id: "regional", label: "區域分析", icon: MapIcon },
  { id: "store-analysis", label: "單店分析", icon: Store },
  { id: "ranking", label: "詳細報表", icon: TrendingUp },
  { id: "audit", label: "回報檢核", icon: ClipboardCheck },
  { id: "history", label: "數據修正", icon: FileText },
  { id: "input", label: "日報輸入", icon: Upload },
  { id: "logs", label: "系統監控", icon: Activity },
  { id: "settings", label: "參數設定", icon: Settings },
];

const DEFAULT_REGIONAL_MANAGERS = {
  Jonas: ["安平", "永康", "崇學", "大順", "前鎮", "左營"],
  Angel: ["古亭", "蘆洲", "北車", "三重", "桃園", "中壢", "八德"],
  漢娜: ["內湖", "安和", "士林", "南港", "頂溪", "園區", "新竹", "竹北"],
  婉娟: ["林口", "新莊", "北大", "河南", "站前", "豐原", "太平"],
  AA: ["仁愛", "板橋", "新店", "復北"],
};

const DEFAULT_PERMISSIONS = {
  director: ALL_MENU_ITEMS.map((i) => i.id),
  manager: ["dashboard", "regional", "store-analysis", "audit"],
  store: ["dashboard", "store-analysis", "ranking", "history", "input"],
};

// --- Helpers ---
const generateUUID = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch (e) {
      // Fallback
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const formatLocalYYYYMMDD = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toStandardDateFormat = (dateStr) => {
  if (!dateStr) return "";
  const date = new Date(dateStr.replace(/-/g, "/"));
  if (isNaN(date.getTime())) return dateStr;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
};

const formatNumber = (val) => {
  if (!val) return "";
  const num = val.toString().replace(/,/g, "");
  if (isNaN(num)) return val;
  return Number(num).toLocaleString();
};

const parseNumber = (val) => {
  if (!val) return 0;
  return Number(val.toString().replace(/,/g, ""));
};

const AppContext = React.createContext(null);

// --- UI Components ---
const ViewWrapper = ({ children }) => (
  <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 w-full">
    {children}
  </div>
);

const Card = ({ title, subtitle, children, className = "" }) => (
  <div
    className={`bg-white p-6 rounded-3xl border border-stone-100 shadow-sm ${className}`}
  >
    {(title || subtitle) && (
      <div className="mb-6">
        {title && <h2 className="text-xl font-bold text-stone-800">{title}</h2>}
        {subtitle && <p className="text-sm text-stone-400 mt-1">{subtitle}</p>}
      </div>
    )}
    {children}
  </div>
);

const Skeleton = ({ className }) => (
  <div className={`animate-pulse bg-stone-200 rounded-2xl ${className}`}></div>
);

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  const bgClass =
    type === "success"
      ? "bg-emerald-600"
      : type === "error"
      ? "bg-stone-700"
      : "bg-amber-600";
  return (
    <div
      className={`fixed bottom-20 md:bottom-6 right-6 ${bgClass} text-white px-6 py-3 rounded-full shadow-xl shadow-stone-300 flex items-center gap-3 z-[60] animate-in slide-in-from-bottom-10 fade-in duration-300 max-w-[90vw]`}
    >
      {type === "success" ? (
        <CheckCircle size={20} />
      ) : type === "error" ? (
        <AlertCircle size={20} />
      ) : (
        <Bell size={20} />
      )}
      <span className="font-medium text-sm tracking-wide">{message}</span>
    </div>
  );
};

const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
        <h3 className="text-lg font-bold text-stone-800 mb-2">{title}</h3>
        <p className="text-stone-500 mb-6 whitespace-pre-line">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-stone-500 hover:bg-stone-50 font-bold transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-rose-500 text-white rounded-xl hover:bg-rose-600 font-bold shadow-lg shadow-rose-200 transition-colors"
          >
            確認
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Sidebar & Nav ---
const Sidebar = ({
  activeView,
  setActiveView,
  isSidebarOpen,
  setSidebarOpen,
  userRole,
  onLogout,
  permissions,
  currentUser,
}) => {
  const menuItems = useMemo(() => {
    if (!userRole) return [];
    if (userRole === "director") return ALL_MENU_ITEMS;
    const allowed = permissions[userRole] || [];
    return ALL_MENU_ITEMS.filter((item) => allowed.includes(item.id));
  }, [userRole, permissions]);

  return (
    <>
      <div
        className={`fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-30 md:hidden transition-opacity duration-300 ${
          isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        className={`fixed top-0 left-0 h-full bg-white border-r border-stone-200 z-50 transition-all duration-300 flex flex-col ${
          isSidebarOpen
            ? "w-64 translate-x-0"
            : "w-20 -translate-x-full md:translate-x-0"
        }`}
      >
        <div className="h-20 flex items-center px-6 border-b border-stone-100 shrink-0">
          <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-200 mr-3 shrink-0">
            <span className="text-white font-bold text-lg">C</span>
          </div>
          <span
            className={`font-extrabold text-xl text-stone-800 tracking-tight transition-opacity duration-300 ${
              isSidebarOpen ? "opacity-100" : "opacity-0 w-0 hidden"
            }`}
          >
            DRCYJ Cloud
          </span>
        </div>
        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1 custom-scrollbar">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveView(item.id);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-200 group relative ${
                  isActive
                    ? "bg-amber-50 text-amber-700 shadow-sm"
                    : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
                }`}
                title={!isSidebarOpen ? item.label : ""}
              >
                <Icon
                  size={22}
                  className={`shrink-0 transition-colors ${
                    isActive
                      ? "text-amber-600"
                      : "text-stone-400 group-hover:text-stone-600"
                  }`}
                />
                <span
                  className={`font-bold text-sm whitespace-nowrap transition-all duration-300 ${
                    isSidebarOpen ? "opacity-100" : "opacity-0 w-0 hidden"
                  }`}
                >
                  {item.label}
                </span>
                {isActive && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-amber-500 rounded-l-full" />
                )}
              </button>
            );
          })}
        </div>
        <div className="p-4 border-t border-stone-100 shrink-0">
          <div
            className={`bg-stone-50 rounded-2xl p-3 flex items-center gap-3 mb-3 transition-all ${
              !isSidebarOpen && "justify-center"
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center shrink-0 overflow-hidden">
              <User size={20} className="text-stone-400" />
            </div>
            {isSidebarOpen && (
              <div className="overflow-hidden">
                <p className="text-sm font-bold text-stone-700 truncate">
                  {currentUser?.name ||
                    (userRole === "director" ? "總監" : "使用者")}
                </p>
                <p className="text-xs text-stone-400 truncate capitalize">
                  {ROLES[userRole?.toUpperCase()]?.label || userRole}
                </p>
              </div>
            )}
          </div>
          <button
            onClick={onLogout}
            className={`w-full flex items-center gap-2 text-stone-400 hover:text-rose-500 hover:bg-rose-50 px-3 py-2 rounded-xl transition-all ${
              !isSidebarOpen && "justify-center"
            }`}
          >
            <LogOut size={20} />
            {isSidebarOpen && (
              <span className="font-bold text-sm">登出系統</span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
};

const MobileTopNav = ({
  activeView,
  setActiveView,
  permissions,
  userRole,
  onLogout,
}) => {
  const menuItems = useMemo(() => {
    if (!userRole) return [];
    if (userRole === "director") return ALL_MENU_ITEMS;
    const allowed = permissions[userRole] || [];
    return ALL_MENU_ITEMS.filter((item) => allowed.includes(item.id));
  }, [userRole, permissions]);

  return (
    <div className="md:hidden bg-white border-b border-stone-200 overflow-x-auto">
      <div className="flex items-center px-4 h-14 gap-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                isActive
                  ? "bg-stone-800 text-white shadow-md shadow-stone-200"
                  : "bg-stone-100 text-stone-500"
              }`}
            >
              <Icon size={14} />
              {item.label}
            </button>
          );
        })}
        <button
          onClick={onLogout}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap bg-stone-100 text-stone-500 hover:bg-rose-50 hover:text-rose-500 transition-all"
        >
          <LogOut size={14} />
          登出
        </button>
      </div>
    </div>
  );
};

// --- Login View ---
const LoginView = ({
  onLogin,
  storeAccounts,
  managers,
  managerAuth,
  onUpdatePassword,
  onUpdateManagerPassword,
}) => {
  const [role, setRole] = useState("director");
  const [password, setPassword] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const handleAuth = async () => {
    setError("");
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 600));

    try {
      if (role === "director") {
        if (password === ROLES.DIRECTOR.pass) {
          onLogin("director", { name: "總監" });
        } else {
          setError("密碼錯誤");
        }
      } else if (role === "manager") {
        if (!selectedUser) {
          setError("請選擇區長");
          setIsLoading(false);
          return;
        }
        const correctPass = managerAuth[selectedUser] || "0000";
        if (password === correctPass) {
          onLogin("manager", { name: selectedUser });
        } else {
          setError("密碼錯誤");
        }
      } else if (role === "store") {
        if (!selectedUser) {
          setError("請選擇帳號");
          setIsLoading(false);
          return;
        }
        const account = storeAccounts.find((a) => a.id === selectedUser);
        if (account && account.password === password) {
          onLogin("store", {
            name: account.name,
            storeName: account.stores?.[0] || account.storeName,
            stores: account.stores,
          });
        } else {
          setError("密碼錯誤");
        }
      }
    } catch (e) {
      setError("登入發生錯誤");
    } finally {
      setIsLoading(false);
    }
  };

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9F8F6] p-4">
      <div className="bg-white w-full max-w-md p-8 rounded-3xl shadow-xl shadow-stone-200/50 border border-stone-100">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200 mx-auto mb-4">
            <Coffee size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-stone-800 tracking-tight">
            DRCYJ OPC Cloud
          </h1>
          <p className="text-stone-400 font-medium mt-2">智慧營運管理系統</p>
        </div>

        <div className="bg-stone-100 p-1.5 rounded-2xl flex mb-8">
          {Object.entries(ROLES).map(([key, r]) => (
            <button
              key={key}
              onClick={() => {
                setRole(r.id);
                setError("");
                setPassword("");
                setSelectedUser("");
                setIsResetting(false);
              }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                role === r.id
                  ? "bg-white text-stone-800 shadow-sm"
                  : "text-stone-400 hover:text-stone-600"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {role === "manager" && (
            <div className="relative">
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="w-full px-4 py-3 bg-stone-50 border-2 border-stone-100 rounded-2xl outline-none font-bold text-stone-700"
              >
                <option value="">請選擇區長...</option>
                {Object.keys(managers).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
          {role === "store" && (
            <div className="relative">
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="w-full px-4 py-3 bg-stone-50 border-2 border-stone-100 rounded-2xl outline-none font-bold text-stone-700"
              >
                <option value="">請選擇店經理...</option>
                {storeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isResetting ? (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="請輸入密碼"
              className="w-full px-4 py-3 bg-stone-50 border-2 border-stone-100 rounded-2xl outline-none font-bold text-stone-700"
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
          ) : (
            <div className="space-y-3">
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="舊密碼"
                className="w-full px-4 py-3 bg-white border-2 border-stone-200 rounded-2xl font-bold"
              />
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="新密碼"
                className="w-full px-4 py-3 bg-white border-2 border-stone-200 rounded-2xl font-bold"
              />
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-50 text-rose-500 text-sm font-bold rounded-xl flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {!isResetting ? (
            <button
              onClick={handleAuth}
              disabled={isLoading}
              className="w-full py-4 bg-stone-800 hover:bg-stone-900 text-white rounded-2xl font-bold shadow-lg"
            >
              {isLoading ? <Loader2 className="animate-spin" /> : "登入系統"}
            </button>
          ) : (
            <button
              onClick={handlePasswordReset}
              disabled={isLoading}
              className="w-full py-4 bg-rose-500 hover:bg-rose-600 text-white rounded-2xl font-bold shadow-lg"
            >
              {isLoading ? <Loader2 className="animate-spin" /> : "確認修改"}
            </button>
          )}

          {(role === "store" || role === "manager") && selectedUser && (
            <button
              onClick={() => {
                setIsResetting(!isResetting);
                setError("");
              }}
              className="w-full text-center text-xs text-stone-400 hover:text-stone-600 font-bold py-2"
            >
              {isResetting ? "返回登入" : "修改密碼?"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Dashboard View ---
const DashboardView = () => {
  const { analytics, fmtMoney, fmtNum, targets } = useContext(AppContext);
  const { grandTotal, dailyTotals, totalAchievement } = analytics;
  const timeProgress =
    analytics.daysInMonth > 0
      ? (analytics.daysPassed / analytics.daysInMonth) * 100
      : 0;
  const paceGap = totalAchievement - timeProgress;

  const MiniKpiCard = ({ title, value, subText, icon: Icon, color }) => (
    <div className="bg-white p-5 rounded-3xl border border-stone-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
      <div
        className={`absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity ${color}`}
      >
        <Icon size={64} />
      </div>
      <div className="flex flex-col h-full justify-between relative z-10">
        <div>
          <p className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-1">
            {title}
          </p>
          <h3 className="text-2xl font-extrabold text-stone-700 font-mono tracking-tight">
            {value}
          </h3>
        </div>
        {subText && (
          <div className="mt-3 pt-3 border-t border-stone-50 text-xs font-medium text-stone-500 flex items-center gap-1">
            {subText}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <ViewWrapper>
      <div className="space-y-8 pb-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-3xl p-6 md:p-8 border border-stone-100 shadow-xl shadow-stone-200/50 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-60"></div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 relative z-10">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 bg-indigo-50 rounded-lg">
                    <Activity size={16} className="text-indigo-500" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-widest text-stone-400">
                    營運節奏監控
                  </span>
                </div>
                <h2 className="text-3xl md:text-4xl font-extrabold font-mono tracking-tight text-stone-700">
                  Day {analytics.daysPassed}{" "}
                  <span className="text-lg text-stone-300 font-sans">
                    / {analytics.daysInMonth}
                  </span>
                </h2>
              </div>
              <div
                className={`mt-4 md:mt-0 px-4 py-2 rounded-xl flex items-center gap-2 ${
                  paceGap >= 0
                    ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                    : "bg-rose-50 text-rose-600 border border-rose-100"
                }`}
              >
                <span className="text-sm font-bold">
                  {paceGap >= 0 ? "超前進度" : "落後進度"}
                </span>
                <span className="text-xl font-mono font-bold">
                  {Math.abs(paceGap).toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="space-y-6 relative z-10">
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-stone-500">實際達成率</span>
                  <span
                    className={
                      totalAchievement >= timeProgress
                        ? "text-emerald-500"
                        : "text-rose-500"
                    }
                  >
                    {totalAchievement.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-stone-100 h-3 rounded-full overflow-hidden shadow-inner">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      totalAchievement >= 100
                        ? "bg-gradient-to-r from-emerald-400 to-teal-400"
                        : totalAchievement >= timeProgress
                        ? "bg-emerald-400"
                        : "bg-rose-400"
                    }`}
                    style={{ width: `${Math.min(totalAchievement, 100)}%` }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-medium">
                  <span className="text-stone-400">時間進度 (應達)</span>
                  <span className="text-stone-400">
                    {timeProgress.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-stone-50 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-stone-300 rounded-full"
                    style={{ width: `${Math.min(timeProgress, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-3xl p-6 border border-stone-100 shadow-lg shadow-stone-100 flex flex-col justify-center relative overflow-hidden group">
            <div className="relative z-10">
              <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
                <Target size={14} /> 月底現金推估
              </p>
              <h3 className="text-3xl xl:text-4xl font-extrabold text-stone-700 font-mono mb-4">
                {fmtMoney(grandTotal.projection)}
              </h3>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold">
                <span>預估達成</span>
                <span>
                  {grandTotal.budget > 0
                    ? (
                        (grandTotal.projection / grandTotal.budget) *
                        100
                      ).toFixed(1)
                    : 0}
                  %
                </span>
              </div>
              <div className="mt-4 pt-4 border-t border-stone-50">
                <div className="flex justify-between items-center text-xs text-stone-400">
                  <span>本月目標</span>
                  <span className="font-mono font-bold text-stone-500">
                    {fmtMoney(grandTotal.budget)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-bold text-stone-700 mb-4 flex items-center gap-2 pl-1">
            <div className="w-1 h-6 bg-amber-500 rounded-full"></div>財務績效
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MiniKpiCard
              title="總現金業績"
              value={fmtMoney(grandTotal.cash)}
              icon={DollarSign}
              color="text-amber-500"
              subText={
                <span
                  className={`font-bold ${
                    totalAchievement >= 100
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}
                >
                  {totalAchievement.toFixed(1)}% 目標達成率
                </span>
              }
            />
            <MiniKpiCard
              title="總權責業績"
              value={fmtMoney(grandTotal.accrual)}
              icon={CreditCard}
              color="text-cyan-500"
              subText="含技術操作與產品銷售"
            />
            <MiniKpiCard
              title="總保養品業績"
              value={fmtMoney(grandTotal.skincareSales)}
              icon={ShoppingBag}
              color="text-rose-500"
              subText={
                <>
                  佔權責{" "}
                  <span className="font-bold text-stone-700 ml-1">
                    {grandTotal.accrual > 0
                      ? (
                          (grandTotal.skincareSales / grandTotal.accrual) *
                          100
                        ).toFixed(1)
                      : 0}
                    %
                  </span>
                </>
              }
            />
            <MiniKpiCard
              title="總退費金額"
              value={fmtMoney(grandTotal.refund)}
              icon={FileWarning}
              color="text-rose-600"
              subText={
                <>
                  佔現金{" "}
                  <span className="font-bold text-stone-700 ml-1">
                    {grandTotal.cash > 0
                      ? ((grandTotal.refund / grandTotal.cash) * 100).toFixed(1)
                      : 0}
                    %
                  </span>
                </>
              }
            />
          </div>
        </div>

        <div>
          <h3 className="text-lg font-bold text-stone-700 mb-4 flex items-center gap-2 pl-1">
            <div className="w-1 h-6 bg-cyan-500 rounded-full"></div>
            營運效率與客流
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <MiniKpiCard
              title="課程操作人數"
              value={fmtNum(grandTotal.traffic)}
              icon={Users}
              color="text-blue-500"
              subText="本月累計操作人數"
            />
            <MiniKpiCard
              title="平均操作權責"
              value={fmtMoney(analytics.avgTrafficASP)}
              icon={TrendingUp}
              color="text-indigo-500"
              subText={
                <span
                  className={
                    analytics.avgTrafficASP >= targets.trafficASP
                      ? "text-emerald-500 font-bold"
                      : "text-rose-500 font-bold"
                  }
                >
                  {analytics.avgTrafficASP >= targets.trafficASP
                    ? "達標"
                    : "未達標"}{" "}
                  (目標 {fmtNum(targets.trafficASP)})
                </span>
              }
            />
            <MiniKpiCard
              title="總新客數"
              value={fmtNum(grandTotal.newCustomers)}
              icon={Sparkles}
              color="text-purple-500"
              subText="本月新增體驗人數"
            />
            <MiniKpiCard
              title="總新客留單"
              value={fmtNum(grandTotal.newCustomerClosings)}
              icon={CheckSquare}
              color="text-teal-500"
              subText={
                <span>
                  留單率{" "}
                  <span className="font-bold">
                    {grandTotal.newCustomers > 0
                      ? (
                          (grandTotal.newCustomerClosings /
                            grandTotal.newCustomers) *
                          100
                        ).toFixed(0)
                      : 0}
                    %
                  </span>
                </span>
              }
            />
            <MiniKpiCard
              title="新客平均客單"
              value={fmtMoney(analytics.avgNewCustomerASP)}
              icon={Award}
              color="text-fuchsia-500"
              subText={
                <span
                  className={
                    analytics.avgNewCustomerASP >= targets.newASP
                      ? "text-emerald-500 font-bold"
                      : "text-rose-500 font-bold"
                  }
                >
                  {analytics.avgNewCustomerASP >= targets.newASP
                    ? "達標"
                    : "未達標"}{" "}
                  (目標 {fmtNum(targets.newASP)})
                </span>
              }
            />
          </div>
        </div>

        <Card
          title="全品牌日營運走勢"
          subtitle="現金業績 vs 課程操作人數趨勢分析"
        >
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={dailyTotals}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#f5f5f4"
                />
                <XAxis
                  dataKey="date"
                  stroke="#a8a29e"
                  tick={{ fontSize: 12 }}
                  dy={10}
                />
                <YAxis
                  yAxisId="left"
                  stroke="#a8a29e"
                  tick={{ fontSize: 12 }}
                  width={60}
                  tickFormatter={(val) =>
                    val === 0 ? "0" : `$${(val / 1000).toFixed(0)}k`
                  }
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#a8a29e"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(val) => fmtNum(val)}
                />
                <RechartsTooltip
                  contentStyle={{
                    borderRadius: "16px",
                    border: "none",
                    padding: "12px",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                  cursor={{ fill: "#fafaf9" }}
                  formatter={(value, name) => {
                    if (name === "現金業績") return [fmtMoney(value), name];
                    return [fmtNum(value), name];
                  }}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="cash"
                  name="現金業績"
                  stroke="#f59e0b"
                  fill="#f59e0b"
                  fillOpacity={0.2}
                  strokeWidth={3}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="traffic"
                  name="課程操作人數"
                  stroke="#0ea5e9"
                  strokeWidth={3}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </ViewWrapper>
  );
};

// --- Regional View ---
const RegionalView = () => {
  const { analytics, fmtMoney, fmtNum, userRole } = useContext(AppContext);
  const pieData = useMemo(
    () =>
      analytics.regionalStats
        .map((r) => ({ name: r.manager, value: r.cashTotal }))
        .filter((i) => i.value > 0),
    [analytics.regionalStats]
  );
  const COLORS = [
    "#0088FE",
    "#00C49F",
    "#FFBB28",
    "#FF8042",
    "#8884d8",
    "#82ca9d",
  ];

  return (
    <ViewWrapper>
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {analytics.regionalStats.map((region) => (
            <Card
              key={region.manager}
              className="hover:shadow-lg transition-shadow duration-300 border-l-4 border-l-stone-200"
            >
              <div className="flex justify-between items-start mb-6 border-b border-stone-50 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center font-bold text-stone-500 text-lg">
                    {region.manager.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-stone-700">
                      {region.manager} 區
                    </h3>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`px-3 py-1 rounded-lg text-sm font-bold mb-1 inline-block ${
                      region.achievement >= 100
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-50 text-amber-600"
                    }`}
                  >
                    {region.achievement.toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center">
                  <span className="text-stone-500 text-sm">現金總業績</span>
                  <span className="text-lg font-bold text-stone-700">
                    {fmtMoney(region.cashTotal)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-stone-500 text-sm">權責總業績</span>
                  <span className="text-base font-bold text-stone-600">
                    {fmtMoney(region.accrualTotal)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-stone-500 text-sm">保養品業績</span>
                  <span className="text-base font-bold text-rose-500">
                    {fmtMoney(region.skincareSalesTotal)}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 py-4 border-t border-stone-100 bg-stone-50/50 -mx-6 px-6">
                <div className="text-center">
                  <p className="text-[10px] text-stone-400 font-bold uppercase mb-1">
                    課程操作人數
                  </p>
                  <p className="text-stone-700 font-bold">
                    {fmtNum(region.trafficTotal)}
                  </p>
                </div>
                <div className="text-center border-l border-stone-200">
                  <p className="text-[10px] text-stone-400 font-bold uppercase mb-1">
                    新客數
                  </p>
                  <p className="text-stone-700 font-bold">
                    {fmtNum(region.newCustomersTotal)}
                  </p>
                </div>
                <div className="text-center border-l border-stone-200">
                  <p className="text-[10px] text-stone-400 font-bold uppercase mb-1">
                    留單數
                  </p>
                  <p className="text-stone-700 font-bold">
                    {fmtNum(region.newCustomerClosingsTotal)}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
        {userRole === "director" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-bottom-4 duration-500">
            <Card title="各區現金業績貢獻佔比" subtitle="區長業績分佈分析">
              <div className="h-[350px] w-full flex justify-center items-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={true}
                      label={({ name, percent }) =>
                        `${name} ${(percent * 100).toFixed(0)}%`
                      }
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(value) => fmtMoney(value)} />
                    <Legend verticalAlign="bottom" height={36} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        ) : (
          <div className="space-y-6">
            {analytics.regionalStats.map((region) => {
              const regionStores = analytics.storeList.filter(
                (s) => s.manager === region.manager
              );
              return (
                <div
                  key={region.manager}
                  className="bg-white rounded-3xl border border-stone-100 overflow-hidden shadow-sm mb-6"
                >
                  <div className="bg-stone-50/80 px-6 py-4 border-b border-stone-100 flex justify-between items-center">
                    <h3 className="font-bold text-stone-700">
                      {region.manager} 區分店列表
                    </h3>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {regionStores.map((store) => (
                      <div
                        key={store.name}
                        className="bg-white border border-stone-100 rounded-2xl p-5 hover:shadow-lg transition-all"
                      >
                        <div className="flex justify-between items-start mb-4">
                          <h4 className="font-bold text-stone-700">
                            {store.name.replace("CYJ", "").replace("店", "")}
                          </h4>
                          <span className="text-sm font-bold text-emerald-600">
                            {store.achievement.toFixed(1)}%
                          </span>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-stone-400">現金</span>
                            <span className="font-bold">
                              {fmtMoney(store.cashTotal)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-stone-400">權責</span>
                            <span className="font-bold">
                              {fmtMoney(store.accrualTotal)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ViewWrapper>
  );
};

// --- Ranking View ---
const RankingView = () => {
  const { analytics, fmtMoney, fmtNum } = useContext(AppContext);
  const [sortConfig, setSortConfig] = useState({
    key: "achievement",
    direction: "desc",
  });
  const sortedData = useMemo(() => {
    let items = [...analytics.storeList];
    if (sortConfig.key) {
      items.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key])
          return sortConfig.direction === "ascending" ? -1 : 1;
        if (a[sortConfig.key] > b[sortConfig.key])
          return sortConfig.direction === "ascending" ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [analytics.storeList, sortConfig]);
  const requestSort = (key) =>
    setSortConfig({
      key,
      direction:
        sortConfig.key === key && sortConfig.direction === "desc"
          ? "ascending"
          : "desc",
    });

  const handleExportCSV = () => {
    const headers = [
      "排名,店名,區域,現金業績,達成率,保養品業績,課程操作人數,消耗客單,新客數,新客留單",
    ];
    const rows = sortedData.map((store, index) => {
      const name = store.name.replace("CYJ", "").replace("店", "");
      return [
        index + 1,
        name,
        store.manager,
        store.cashTotal,
        store.achievement.toFixed(2) + "%",
        store.skincareSalesTotal,
        store.trafficTotal,
        store.trafficASP,
        store.newCustomersTotal,
        store.newCustomerClosingsTotal,
      ].join(",");
    });
    const csvContent = "\uFEFF" + [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `詳細報表_${new Date().toISOString().split("T")[0]}.csv`
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <ViewWrapper>
      <Card title="詳細報表與排名" subtitle="各店關鍵指標排名分析">
        <div className="flex justify-end mb-4">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors border border-emerald-100"
          >
            <Download size={16} /> 匯出 CSV
          </button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-stone-100 min-h-[500px]">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="bg-stone-50 font-bold text-xs text-stone-500 uppercase">
              <tr>
                <th className="p-4 w-16 text-center">排名</th>
                <th
                  className="p-4 cursor-pointer"
                  onClick={() => requestSort("name")}
                >
                  店名
                </th>
                <th
                  className="p-4 cursor-pointer text-right"
                  onClick={() => requestSort("cashTotal")}
                >
                  現金業績
                </th>
                <th
                  className="p-4 cursor-pointer text-right"
                  onClick={() => requestSort("achievement")}
                >
                  達成率
                </th>
                <th
                  className="p-4 cursor-pointer text-right"
                  onClick={() => requestSort("trafficTotal")}
                >
                  課程操作人數
                </th>
                <th
                  className="p-4 cursor-pointer text-right"
                  onClick={() => requestSort("newCustomersTotal")}
                >
                  新客數
                </th>
                <th
                  className="p-4 cursor-pointer text-right"
                  onClick={() => requestSort("newCustomerClosingsTotal")}
                >
                  留單數
                </th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-stone-50">
              {sortedData.map((store, index) => (
                <tr key={store.name} className="hover:bg-stone-50">
                  <td className="p-4 text-center text-stone-400 font-bold">
                    {index + 1}
                  </td>
                  <td className="p-4 font-bold text-stone-700">
                    {store.name.replace("CYJ", "").replace("店", "")}
                  </td>
                  <td className="p-4 text-right font-mono font-bold text-stone-700">
                    {fmtMoney(store.cashTotal)}
                  </td>
                  <td className="p-4 text-right font-mono font-bold text-emerald-600">
                    {store.achievement.toFixed(1)}%
                  </td>
                  <td className="p-4 text-right font-mono text-stone-600">
                    {fmtNum(store.trafficTotal)}
                  </td>
                  <td className="p-4 text-right font-mono text-stone-600">
                    {fmtNum(store.newCustomersTotal)}
                  </td>
                  <td className="p-4 text-right font-mono text-stone-600">
                    {fmtNum(store.newCustomerClosingsTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </ViewWrapper>
  );
};

// --- StoreAnalysis View ---
const StoreAnalysisView = () => {
  const {
    rawData,
    budgets,
    managers,
    selectedYear,
    selectedMonth,
    fmtMoney,
    fmtNum,
    currentUser,
    userRole,
    activeView,
  } = useContext(AppContext);
  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");

  useEffect(() => {
    if (
      activeView === "store-analysis" &&
      currentUser &&
      managers[currentUser.name]
    )
      setSelectedManager(currentUser.name);
  }, [activeView, currentUser, managers]);

  useEffect(() => {
    const handleStoreNav = (e) => setSelectedStore(e.detail);
    window.addEventListener("navigate-to-store", handleStoreNav);
    return () =>
      window.removeEventListener("navigate-to-store", handleStoreNav);
  }, []);

  const availableStores = useMemo(() => {
    if (userRole === "director")
      return selectedManager
        ? (managers[selectedManager] || []).map((s) => `CYJ${s}店`)
        : [];
    if (userRole === "manager")
      return Object.values(managers)
        .flat()
        .map((s) => `CYJ${s}店`);
    if (userRole === "store" && currentUser)
      return (currentUser.stores || [currentUser.storeName]).map((s) =>
        s.startsWith("CYJ") ? s : `CYJ${s}店`
      );
    return [];
  }, [selectedManager, managers, currentUser, userRole]);

  useEffect(() => {
    if (currentUser && availableStores.length === 1 && !selectedStore)
      setSelectedStore(availableStores[0]);
  }, [currentUser, availableStores, selectedStore]);

  const storeMetrics = useMemo(() => {
    if (!selectedStore) return null;
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;

    const data = rawData
      .filter((d) => {
        if (d.storeName !== selectedStore) return false;
        if (!d.date) return false;
        const parts = d.date.replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        return (y === targetYear || y === rocYear) && m === monthInt;
      })
      .sort((a, b) => {
        const dateA = toStandardDateFormat(a.date);
        const dateB = toStandardDateFormat(b.date);
        return dateA.localeCompare(dateB);
      });

    const grossCash = data.reduce((a, b) => a + (b.cash || 0), 0);
    const totalRefund = data.reduce((a, b) => a + (b.refund || 0), 0);
    const totalCash = grossCash - totalRefund;
    const totalTraffic = data.reduce((a, b) => a + (b.traffic || 0), 0);
    const totalOpAccrual = data.reduce(
      (a, b) => a + (b.operationalAccrual || 0),
      0
    );
    const totalNewCustomers = data.reduce(
      (a, b) => a + (b.newCustomers || 0),
      0
    );
    const totalNewCustomerSales = data.reduce(
      (a, b) => a + (b.newCustomerSales || 0),
      0
    );
    const totalNewCustomerClosings = data.reduce(
      (a, b) => a + (b.newCustomerClosings || 0),
      0
    );

    const budget =
      budgets[`${selectedStore}_${targetYear}_${monthInt}`]?.cashTarget || 0;

    return {
      totalCash,
      achievement: budget > 0 ? (totalCash / budget) * 100 : 0,
      trafficASP:
        totalTraffic > 0 ? Math.round(totalOpAccrual / totalTraffic) : 0,
      newCustomerASP:
        totalNewCustomers > 0
          ? Math.round(totalNewCustomerSales / totalNewCustomers)
          : 0,
      totalNewCustomerClosings,
      totalRefund,
      dailyData: data.map((d) => ({
        date: toStandardDateFormat(d.date).split("/")[2],
        cash: (d.cash || 0) - (d.refund || 0),
        accrual: d.accrual || 0,
        traffic: d.traffic,
      })),
      budget,
    };
  }, [selectedStore, selectedYear, selectedMonth, rawData, budgets]);

  return (
    <ViewWrapper>
      <div className="space-y-6">
        <Card title="單店營運分析">
          <div className="flex gap-4">
            <select
              value={selectedManager}
              onChange={(e) => setSelectedManager(e.target.value)}
              disabled={userRole !== "director"}
              className="px-4 py-2 border rounded-xl"
            >
              <option value="">選擇區長</option>
              {Object.keys(managers).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
              className="px-4 py-2 border rounded-xl"
            >
              <option value="">選擇店家</option>
              {availableStores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </Card>
        {selectedStore && storeMetrics && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  現金業績
                </p>
                <h3 className="text-2xl font-bold text-stone-700">
                  {fmtMoney(storeMetrics.totalCash)}
                </h3>
                <p
                  className={`text-sm font-bold ${
                    storeMetrics.achievement >= 100
                      ? "text-emerald-500"
                      : "text-amber-500"
                  }`}
                >
                  {storeMetrics.achievement.toFixed(1)}% 達成
                </p>
              </div>
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  平均消耗客單
                </p>
                <h3 className="text-2xl font-bold text-stone-700">
                  {fmtMoney(storeMetrics.trafficASP)}
                </h3>
              </div>
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  本月目標
                </p>
                <h3 className="text-2xl font-bold text-stone-700">
                  {fmtMoney(storeMetrics.budget)}
                </h3>
              </div>
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  新客平均客單
                </p>
                <h3 className="text-2xl font-bold text-stone-700">
                  {fmtMoney(storeMetrics.newCustomerASP)}
                </h3>
              </div>
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  總新客留單
                </p>
                <h3 className="text-2xl font-bold text-stone-700">
                  {fmtNum(storeMetrics.totalNewCustomerClosings)}
                </h3>
              </div>
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  總退費金額
                </p>
                <h3 className="text-2xl font-bold text-rose-500">
                  {fmtMoney(storeMetrics.totalRefund)}
                </h3>
              </div>
            </div>

            <Card
              title="綜合營運趨勢分析"
              subtitle="長條：現金業績｜實線：權責業績｜虛線(右軸)：操作人數"
            >
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={storeMetrics.dailyData}
                    margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#e7e5e4"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12, fill: "#78716c" }}
                      axisLine={{ stroke: "#e7e5e4" }}
                      tickLine={false}
                      dy={10}
                    />
                    <YAxis
                      yAxisId="left"
                      width={80}
                      tickFormatter={(val) =>
                        val === 0 ? "0" : `$${(val / 1000).toFixed(0)}k`
                      }
                      tick={{ fontSize: 12, fill: "#f59e0b" }}
                      axisLine={false}
                      tickLine={false}
                      label={{
                        value: "金額 (NT$)",
                        angle: -90,
                        position: "insideLeft",
                        fill: "#d6d3d1",
                        fontSize: 10,
                      }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      allowDecimals={false}
                      tick={{ fontSize: 12, fill: "#0ea5e9" }}
                      axisLine={false}
                      tickLine={false}
                      label={{
                        value: "人數",
                        angle: 90,
                        position: "insideRight",
                        fill: "#d6d3d1",
                        fontSize: 10,
                      }}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        borderRadius: "16px",
                        border: "none",
                        boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                        padding: "12px",
                      }}
                      formatter={(value, name) => {
                        if (name === "課程操作人數")
                          return [fmtNum(value), name];
                        return [fmtMoney(value), name];
                      }}
                      labelStyle={{
                        color: "#78716c",
                        marginBottom: "0.5rem",
                        fontWeight: "bold",
                      }}
                      cursor={{ fill: "#f5f5f4", opacity: 0.6 }}
                    />
                    <Legend
                      verticalAlign="top"
                      height={36}
                      iconType="circle"
                      wrapperStyle={{
                        paddingBottom: "20px",
                        fontSize: "12px",
                        fontWeight: "bold",
                      }}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="cash"
                      name="現金業績 (淨額)"
                      fill="#fbbf24"
                      radius={[4, 4, 0, 0]}
                      barSize={20}
                      fillOpacity={0.9}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="accrual"
                      name="權責業績"
                      stroke="#8b5cf6"
                      strokeWidth={3}
                      dot={{
                        r: 4,
                        fill: "#8b5cf6",
                        strokeWidth: 2,
                        stroke: "#fff",
                      }}
                      activeDot={{ r: 6 }}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="traffic"
                      name="課程操作人數"
                      stroke="#0ea5e9"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{
                        r: 3,
                        fill: "#0ea5e9",
                        strokeWidth: 2,
                        stroke: "#fff",
                      }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </>
        )}
      </div>
    </ViewWrapper>
  );
};

// --- Audit View ---
const AuditView = () => {
  const {
    analytics,
    rawData,
    managers,
    showToast,
    budgets,
    selectedYear,
    selectedMonth,
  } = useContext(AppContext);
  const [checkDate, setCheckDate] = useState(formatLocalYYYYMMDD(new Date()));
  const [auditType, setAuditType] = useState("daily");

  const auditData = useMemo(() => {
    if (!checkDate) return { submitted: [], missing: [], missingByManager: {} };
    const targetDate = toStandardDateFormat(checkDate);
    const submitted = new Set(
      rawData
        .filter((d) => toStandardDateFormat(d.date) === targetDate)
        .map((d) => d.storeName)
    );
    const missingByManager = {};
    Object.entries(managers).forEach(([manager, stores]) => {
      const missing = [];
      stores.forEach((s) => {
        const name = `CYJ${s}店`;
        if (!submitted.has(name)) missing.push(name);
      });
      if (missing.length) missingByManager[manager] = missing;
    });
    return {
      submitted: Array.from(submitted),
      missing: Object.values(missingByManager).flat(),
      missingByManager,
    };
  }, [checkDate, rawData, managers]);

  const targetAuditData = useMemo(() => {
    const missingByManager = {};
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    Object.entries(managers).forEach(([manager, stores]) => {
      const missing = [];
      stores.forEach((s) => {
        const name = `CYJ${s}店`;
        const b = budgets[`${name}_${y}_${m}`];
        if (!b || (!b.cashTarget && !b.accrualTarget)) missing.push(name);
      });
      if (missing.length) missingByManager[manager] = missing;
    });
    return {
      missing: Object.values(missingByManager).flat(),
      missingByManager,
    };
  }, [budgets, managers, selectedYear, selectedMonth]);

  const activeData = auditType === "daily" ? auditData : targetAuditData;
  const handleCopy = () => {
    let text =
      auditType === "daily"
        ? `未回報(${checkDate})：\n`
        : `未設定目標(${selectedMonth}月)：\n`;
    Object.entries(activeData.missingByManager).forEach(([mgr, stores]) => {
      text += `${mgr}區：${stores
        .map((s) => s.replace("CYJ", "").replace("店", ""))
        .join("、")}\n`;
    });
    navigator.clipboard.writeText(text);
    showToast("已複製", "success");
  };

  return (
    <ViewWrapper>
      <Card title="回報檢核中心">
        <div className="flex gap-4 mb-6">
          <div className="bg-stone-100 p-1 rounded-xl inline-flex">
            <button
              onClick={() => setAuditType("daily")}
              className={`px-4 py-2 rounded-lg text-sm font-bold ${
                auditType === "daily" ? "bg-white shadow" : "text-stone-400"
              }`}
            >
              日報檢核
            </button>
            <button
              onClick={() => setAuditType("target")}
              className={`px-4 py-2 rounded-lg text-sm font-bold ${
                auditType === "target" ? "bg-white shadow" : "text-stone-400"
              }`}
            >
              目標檢核
            </button>
          </div>
          {auditType === "daily" && (
            <input
              type="date"
              value={checkDate}
              onChange={(e) => setCheckDate(e.target.value)}
              className="px-4 py-2 border rounded-xl bg-stone-50 outline-none focus:ring-2 focus:ring-amber-200"
            />
          )}
        </div>
        <div className="border border-rose-100 rounded-3xl overflow-hidden shadow-sm mb-8">
          <div className="bg-rose-50 px-6 py-4 flex justify-between items-center">
            <h4 className="font-bold text-rose-600 flex items-center gap-2">
              <AlertCircle size={20} /> 未完成名單 ({activeData.missing.length})
            </h4>
            <button
              onClick={handleCopy}
              className="text-xs bg-white text-rose-500 px-4 py-2 rounded-xl border border-rose-200 font-bold"
            >
              複製名單
            </button>
          </div>
          <div className="p-6 bg-white grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(activeData.missingByManager).map(
              ([mgr, stores]) => (
                <div key={mgr} className="bg-stone-50 p-4 rounded-2xl border">
                  <div className="font-bold text-stone-600 mb-2">{mgr} 區</div>
                  <div className="flex flex-wrap gap-2">
                    {stores.map((s) => (
                      <span
                        key={s}
                        className="bg-white px-2 py-1 rounded-lg text-xs border"
                      >
                        {s.replace("CYJ", "").replace("店", "")}
                      </span>
                    ))}
                  </div>
                </div>
              )
            )}
            {activeData.missing.length === 0 && (
              <div className="col-span-3 text-center text-emerald-500 font-bold py-10">
                全數完成！
              </div>
            )}
          </div>
        </div>
      </Card>
    </ViewWrapper>
  );
};

// --- Input View ---
const InputView = () => {
  const {
    currentUser,
    userRole,
    managers,
    budgets,
    inputDate,
    setInputDate,
    showToast,
    logActivity,
    rawData,
    openConfirm,
  } = useContext(AppContext);
  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [formData, setFormData] = useState({
    cash: "",
    accrual: "",
    operationalAccrual: "",
    skincareSales: "",
    skincareRefund: "",
    traffic: "",
    newCustomers: "",
    newCustomerClosings: "",
    newCustomerSales: "",
    refund: "",
  });
  const [targetInput, setTargetInput] = useState({ cash: "", accrual: "" });
  const LABELS = {
    cash: "現金業績",
    accrual: "總權責業績 (自動計算)",
    operationalAccrual: "操作權責 (技術)",
    skincareSales: "保養品業績",
    skincareRefund: "當日保養品退費",
    traffic: "課程操作人數",
    newCustomers: "新客數",
    newCustomerClosings: "新客留單人數",
    newCustomerSales: "新客業績",
    refund: "當日退費",
  };
  const today = new Date().toISOString().split("T")[0];
  const isFirstDay = inputDate.endsWith("-01");
  const canEditTargets =
    userRole === "director" ||
    userRole === "manager" ||
    (userRole === "store" && isFirstDay);

  useEffect(() => {
    const op = parseNumber(formData.operationalAccrual);
    const skin = parseNumber(formData.skincareSales);
    const total = op + skin;
    setFormData((prev) => {
      const currentTotal = parseNumber(prev.accrual);
      if (currentTotal !== total) {
        return { ...prev, accrual: formatNumber(total) };
      }
      return prev;
    });
  }, [formData.operationalAccrual, formData.skincareSales]);

  const handleNumberChange = (key, value) => {
    const rawValue = value.replace(/,/g, "");
    if (!/^\d*$/.test(rawValue)) return;
    if (
      (key === "traffic" ||
        key === "newCustomers" ||
        key === "newCustomerClosings") &&
      rawValue.length > 2
    ) {
      showToast("⚠️ 人數限制：不能超過兩位數 (最大 99)", "error");
      return;
    }
    setFormData((prev) => ({ ...prev, [key]: formatNumber(rawValue) }));
  };

  const availableStores = useMemo(() => {
    if (!selectedManager) {
      if (userRole === "store" && currentUser) {
        return (currentUser.stores || [currentUser.storeName]).map((s) =>
          s.startsWith("CYJ") ? s : `CYJ${s}店`
        );
      }
      return [];
    }
    return (managers[selectedManager] || []).map((s) => `CYJ${s}店`);
  }, [selectedManager, managers, userRole, currentUser]);

  useEffect(() => {
    if (userRole === "store" && currentUser) {
      const myStores = currentUser.stores || [currentUser.storeName];
      if (myStores.length > 0) {
        const shortName = myStores[0].replace("CYJ", "").replace("店", "");
        const foundMgr = Object.keys(managers).find((mgr) =>
          managers[mgr].includes(shortName)
        );
        if (foundMgr) setSelectedManager(foundMgr);
        const fullName = myStores[0].startsWith("CYJ")
          ? myStores[0]
          : `CYJ${myStores[0]}店`;
        setSelectedStore(fullName);
      }
    } else if (userRole === "manager" && currentUser) {
      setSelectedManager(currentUser.name);
    }
  }, [userRole, currentUser, managers]);

  useEffect(() => {
    if (!selectedStore || !inputDate) {
      setTargetInput({ cash: "", accrual: "" });
      return;
    }
    const dateObj = new Date(inputDate);
    if (isNaN(dateObj.getTime())) return;
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const budgetKey = `${selectedStore}_${year}_${month}`;
    const budget = budgets[budgetKey];
    if (budget) {
      setTargetInput({
        cash: budget.cashTarget || "",
        accrual: budget.accrualTarget || "",
      });
    } else {
      setTargetInput({ cash: "", accrual: "" });
    }
  }, [selectedStore, inputDate, budgets]);

  const saveReport = async (existingId = null) => {
    try {
      if (isFirstDay) {
        await handleUpdateTargets(true);
      }
      const normalizedDate = toStandardDateFormat(inputDate);
      const payload = {
        date: normalizedDate,
        storeName: selectedStore,
        cash: parseNumber(formData.cash),
        accrual: parseNumber(formData.accrual),
        operationalAccrual: parseNumber(formData.operationalAccrual),
        skincareSales: parseNumber(formData.skincareSales),
        skincareRefund: parseNumber(formData.skincareRefund),
        traffic: parseNumber(formData.traffic),
        newCustomers: parseNumber(formData.newCustomers),
        newCustomerClosings: parseNumber(formData.newCustomerClosings),
        newCustomerSales: parseNumber(formData.newCustomerSales),
        refund: parseNumber(formData.refund),
        timestamp: serverTimestamp(),
      };
      if (existingId) {
        await setDoc(
          doc(
            db,
            "artifacts",
            appId,
            "public",
            "data",
            "daily_reports",
            existingId
          ),
          payload
        );
        showToast("資料已更新 (覆蓋舊資料)", "success");
        logActivity(
          userRole,
          currentUser?.name,
          "更新日報(覆蓋)",
          `${selectedStore} ${normalizedDate}`
        );
      } else {
        await addDoc(
          collection(db, "artifacts", appId, "public", "data", "daily_reports"),
          payload
        );
        showToast("日報提交成功", "success");
        logActivity(
          userRole,
          currentUser?.name,
          "提交日報",
          `${selectedStore} ${normalizedDate}`
        );
      }
      setFormData({
        cash: "",
        accrual: "",
        operationalAccrual: "",
        skincareSales: "",
        skincareRefund: "",
        traffic: "",
        newCustomers: "",
        newCustomerClosings: "",
        newCustomerSales: "",
        refund: "",
      });
    } catch (err) {
      console.error(err);
      showToast("提交失敗", "error");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedStore) {
      showToast("請選擇店家", "error");
      return;
    }
    if (inputDate > today) {
      showToast("⛔ 不可以提交未來業績！\n請確認日期符合規定。", "error");
      return;
    }
    if (isFirstDay) {
      const cashT = Number(targetInput.cash);
      const accrualT = Number(targetInput.accrual);
      if (!cashT || !accrualT || cashT <= 0 || accrualT <= 0) {
        showToast(
          "⚠️ 每月1號為目標設定日，請務必填寫當月「現金」與「權責」目標！",
          "error"
        );
        return;
      }
    }
    const formattedInputDate = toStandardDateFormat(inputDate);
    const existingReport = rawData.find((d) => {
      const recordDate = toStandardDateFormat(d.date);
      return recordDate === formattedInputDate && d.storeName === selectedStore;
    });
    if (existingReport) {
      openConfirm(
        "⚠️ 資料覆蓋確認",
        `系統檢測到 ${selectedStore} 在 ${formattedInputDate} 已經有一筆回報紀錄。\n\n您確定要提交並「覆蓋」原有的資料嗎？`,
        () => saveReport(existingReport.id)
      );
    } else {
      saveReport();
    }
  };

  const handleUpdateTargets = async (silent = false) => {
    if (!selectedStore || !inputDate) return;
    const dateObj = new Date(inputDate);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const budgetKey = `${selectedStore}_${year}_${month}`;
    try {
      await setDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "monthly_targets",
          budgetKey
        ),
        {
          cashTarget: Number(targetInput.cash),
          accrualTarget: Number(targetInput.accrual),
        },
        { merge: true }
      );
      if (!silent) {
        showToast(`${month}月目標已更新`, "success");
        logActivity(
          userRole,
          currentUser?.name,
          "更新月目標",
          `${selectedStore} ${year}/${month}`
        );
      }
    } catch (e) {
      console.error(e);
      showToast("目標更新失敗", "error");
    }
  };

  const formKeys = [
    "cash",
    "refund",
    "accrual",
    "operationalAccrual",
    "skincareSales",
    "skincareRefund",
    "traffic",
    "newCustomers",
    "newCustomerClosings",
    "newCustomerSales",
  ];

  return (
    <ViewWrapper>
      <div className="max-w-2xl mx-auto space-y-6">
        <Card title="日報與目標管理">
          <div className="space-y-6">
            <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100 space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1.5 text-stone-400 uppercase">
                  回報日期 (不可選未來日期)
                </label>
                <input
                  type="date"
                  max={today}
                  value={inputDate}
                  onChange={(e) => setInputDate(e.target.value)}
                  className="w-full border-2 border-stone-200 p-3 rounded-xl focus:border-amber-400 outline-none font-bold text-stone-700 bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-stone-400 uppercase">
                    選擇區域
                  </label>
                  <select
                    value={selectedManager}
                    onChange={(e) => {
                      setSelectedManager(e.target.value);
                      setSelectedStore("");
                    }}
                    disabled={userRole !== "director"}
                    className="w-full border-2 border-stone-200 p-3 rounded-xl focus:border-amber-400 outline-none font-bold text-stone-700 bg-white disabled:bg-stone-100 disabled:text-stone-400"
                  >
                    <option value="">請選擇...</option>
                    {Object.keys(managers).map((m) => (
                      <option key={m} value={m}>
                        {m}區
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-stone-400 uppercase">
                    選擇店家
                  </label>
                  <select
                    value={selectedStore}
                    onChange={(e) => setSelectedStore(e.target.value)}
                    disabled={!selectedManager}
                    className="w-full border-2 border-stone-200 p-3 rounded-xl focus:border-amber-400 outline-none font-bold text-stone-700 bg-white disabled:bg-stone-100 disabled:text-stone-400"
                  >
                    <option value="">請選擇...</option>
                    {availableStores.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            {selectedStore && (
              <div
                className={`p-5 rounded-2xl border transition-all ${
                  canEditTargets
                    ? "bg-white border-stone-200 shadow-sm"
                    : "bg-stone-50 border-stone-100 opacity-90"
                }`}
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-stone-600 flex items-center gap-2">
                    <Target size={18} className="text-amber-500" /> 當月營運目標
                    ({new Date(inputDate).getMonth() + 1}月){" "}
                    {isFirstDay && (
                      <span className="text-xs bg-rose-100 text-rose-500 px-2 py-0.5 rounded-full ml-2">
                        1號必填
                      </span>
                    )}
                  </h3>
                  {canEditTargets && (
                    <button
                      onClick={() => handleUpdateTargets(false)}
                      className="text-xs bg-stone-800 text-white px-3 py-1.5 rounded-lg hover:bg-stone-700 transition-colors font-bold shadow-md active:scale-95"
                    >
                      更新目標
                    </button>
                  )}
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1">
                      現金目標{" "}
                      {isFirstDay && <span className="text-rose-500">*</span>}
                    </label>
                    <div className="relative">
                      <DollarSign
                        size={14}
                        className="absolute left-3 top-3 text-stone-400"
                      />
                      <input
                        type="number"
                        value={targetInput.cash}
                        onChange={(e) =>
                          setTargetInput({
                            ...targetInput,
                            cash: e.target.value,
                          })
                        }
                        disabled={!canEditTargets}
                        placeholder="0"
                        className={`w-full pl-8 pr-3 py-2 border-2 rounded-xl font-mono font-bold outline-none transition-all ${
                          canEditTargets
                            ? "border-stone-200 focus:border-amber-400 bg-white text-stone-700"
                            : "border-transparent bg-stone-100 text-stone-500"
                        }`}
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1">
                      權責目標{" "}
                      {isFirstDay && <span className="text-rose-500">*</span>}
                    </label>
                    <div className="relative">
                      <CreditCard
                        size={14}
                        className="absolute left-3 top-3 text-stone-400"
                      />
                      <input
                        type="number"
                        value={targetInput.accrual}
                        onChange={(e) =>
                          setTargetInput({
                            ...targetInput,
                            accrual: e.target.value,
                          })
                        }
                        disabled={!canEditTargets}
                        placeholder="0"
                        className={`w-full pl-8 pr-3 py-2 border-2 rounded-xl font-mono font-bold outline-none transition-all ${
                          canEditTargets
                            ? "border-stone-200 focus:border-cyan-400 bg-white text-stone-700"
                            : "border-transparent bg-stone-100 text-stone-500"
                        }`}
                      />
                    </div>
                  </div>
                </div>
                {!canEditTargets && (
                  <p className="text-[10px] text-stone-400 mt-2 text-right">
                    * 僅區長或每月1號可修改
                  </p>
                )}
              </div>
            )}
            <form
              onSubmit={handleSubmit}
              className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm"
            >
              <h3 className="font-bold text-stone-600 mb-4 flex items-center gap-2">
                <FileText size={18} className="text-stone-400" /> 日報數據輸入
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {formKeys.map((key) => {
                  const isReadOnly = key === "accrual";
                  const isRefund = key === "refund" || key === "skincareRefund";
                  return (
                    <div key={key}>
                      <label
                        className={`block text-xs font-bold mb-1.5 ${
                          isRefund ? "text-rose-500" : "text-stone-500"
                        }`}
                      >
                        {LABELS[key] || key}
                      </label>
                      <input
                        type="text"
                        value={formData[key]}
                        onChange={(e) =>
                          handleNumberChange(key, e.target.value)
                        }
                        readOnly={isReadOnly}
                        placeholder="0"
                        inputMode="numeric"
                        className={`w-full border-2 p-3 rounded-xl outline-none font-bold transition-all focus:shadow-lg focus:shadow-amber-50 focus:bg-amber-50/10 ${
                          isReadOnly
                            ? "bg-stone-100 text-stone-500 border-stone-100 cursor-not-allowed"
                            : `border-stone-100 focus:border-amber-400 ${
                                isRefund
                                  ? "text-rose-500 font-extrabold"
                                  : "text-stone-700"
                              }`
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
              <button
                type="submit"
                className="w-full bg-gradient-to-r from-stone-800 to-stone-700 hover:from-stone-700 hover:to-stone-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-stone-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Upload size={20} /> 提交日報數據
              </button>
            </form>
          </div>
        </Card>
      </div>
    </ViewWrapper>
  );
};

// --- History View ---
const HistoryView = () => {
  const { rawData, showToast, managers } = useContext(AppContext);
  const [filterDate, setFilterDate] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const fmt = (val) => (typeof val === "number" ? val.toLocaleString() : val);
  const allStores = useMemo(
    () =>
      Object.values(managers)
        .flat()
        .map((s) => `CYJ${s}店`)
        .sort(),
    [managers]
  );
  const filteredData = useMemo(() => {
    return rawData.filter((d) => {
      const rowDate = toStandardDateFormat(d.date);
      const targetDate = filterDate ? toStandardDateFormat(filterDate) : null;
      const matchDate = targetDate ? rowDate === targetDate : true;
      const matchStore = filterStore ? d.storeName === filterStore : true;
      return matchDate && matchStore;
    });
  }, [rawData, filterDate, filterStore]);

  const startEdit = (report) => {
    setEditId(report.id);
    setEditForm({ ...report });
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditForm({});
  };
  const handleEditChange = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveEdit = async () => {
    try {
      const docRef = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "daily_reports",
        editId
      );
      const cleanData = {
        ...editForm,
        cash: Number(editForm.cash),
        accrual: Number(editForm.accrual),
        operationalAccrual: Number(editForm.operationalAccrual),
        skincareSales: Number(editForm.skincareSales),
        skincareRefund: Number(editForm.skincareRefund),
        traffic: Number(editForm.traffic),
        newCustomers: Number(editForm.newCustomers),
        newCustomerClosings: Number(editForm.newCustomerClosings),
        newCustomerSales: Number(editForm.newCustomerSales),
        refund: Number(editForm.refund),
      };
      await updateDoc(docRef, cleanData);
      showToast("資料更新成功", "success");
      setEditId(null);
    } catch (e) {
      console.error(e);
      showToast("更新失敗", "error");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("確定刪除此筆資料?")) return;
    try {
      await deleteDoc(
        doc(db, "artifacts", appId, "public", "data", "daily_reports", id)
      );
      showToast("資料已刪除", "success");
    } catch (e) {
      showToast("刪除失敗", "error");
    }
  };

  return (
    <ViewWrapper>
      <Card title="數據修正中心" subtitle="查詢並修正歷史日報數據">
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row gap-4 bg-stone-50 p-4 rounded-2xl border border-stone-100">
            <div className="flex-1">
              <label className="block text-xs font-bold text-stone-400 mb-1">
                篩選日期
              </label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full px-4 py-2 border border-stone-200 rounded-xl text-stone-700 font-bold focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-stone-400 mb-1">
                篩選店家
              </label>
              <div className="relative">
                <select
                  value={filterStore}
                  onChange={(e) => setFilterStore(e.target.value)}
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl text-stone-700 font-bold focus:ring-2 focus:ring-amber-200 outline-none appearance-none bg-white"
                >
                  <option value="">全部店家</option>
                  {allStores.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="absolute right-3 top-3 text-stone-400 pointer-events-none"
                />
              </div>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => {
                  setFilterDate("");
                  setFilterStore("");
                }}
                className="px-4 py-2 bg-stone-200 text-stone-600 rounded-xl font-bold hover:bg-stone-300 transition-colors w-full md:w-auto"
              >
                重置
              </button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-stone-200 min-h-[400px]">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-stone-100 text-stone-500 font-bold uppercase text-xs">
                <tr>
                  <th className="p-4">日期</th>
                  <th className="p-4">店名</th>
                  <th className="p-4 text-right">現金</th>
                  <th className="p-4 text-right">退費</th>
                  <th className="p-4 text-right">總權責</th>
                  <th className="p-4 text-right">操作權責</th>
                  <th className="p-4 text-right">保養品</th>
                  <th className="p-4 text-right">保養退費</th>
                  <th className="p-4 text-right">操作人數</th>
                  <th className="p-4 text-right">新客</th>
                  <th className="p-4 text-right">留單</th>
                  <th className="p-4 text-center sticky right-0 bg-stone-100 shadow-l">
                    動作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredData.slice(0, 50).map((row) => {
                  const isEditing = editId === row.id;
                  return (
                    <tr key={row.id} className="hover:bg-stone-50 group">
                      <td className="p-4 font-mono font-bold text-stone-600">
                        {toStandardDateFormat(row.date)}
                      </td>
                      <td className="p-4 font-bold text-stone-700">
                        {row.storeName.replace("CYJ", "").replace("店", "")}
                      </td>
                      {[
                        "cash",
                        "refund",
                        "accrual",
                        "operationalAccrual",
                        "skincareSales",
                        "skincareRefund",
                        "traffic",
                        "newCustomers",
                        "newCustomerClosings",
                      ].map((field) => (
                        <td key={field} className="p-4 text-right font-mono">
                          {isEditing ? (
                            <input
                              type="number"
                              value={editForm[field]}
                              onChange={(e) =>
                                handleEditChange(field, e.target.value)
                              }
                              className="w-20 px-2 py-1 border border-amber-300 rounded text-right outline-none focus:ring-2 focus:ring-amber-200 bg-white"
                            />
                          ) : (
                            <span
                              className={
                                field === "refund" || field === "skincareRefund"
                                  ? "text-rose-500 font-bold"
                                  : field === "accrual"
                                  ? "text-stone-400"
                                  : "text-stone-700"
                              }
                            >
                              {fmt(row[field])}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="p-4 text-center sticky right-0 bg-white group-hover:bg-stone-50 shadow-l">
                        {isEditing ? (
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={saveEdit}
                              className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-200"
                            >
                              <Save size={16} />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1.5 bg-stone-100 text-stone-500 rounded-lg hover:bg-stone-200"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => startEdit(row)}
                              className="p-1.5 hover:bg-amber-50 text-amber-500 rounded-lg"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(row.id)}
                              className="p-1.5 hover:bg-rose-50 text-rose-500 rounded-lg"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredData.length === 0 && (
                  <tr>
                    <td colSpan="12" className="p-8 text-center text-stone-400">
                      沒有符合條件的資料
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-400 text-center">
            * 僅顯示最近 50 筆符合條件的紀錄，請使用篩選器縮小範圍
          </p>
        </div>
      </Card>
    </ViewWrapper>
  );
};

// --- Settings View ---
const SettingsView = () => {
  const {
    targets,
    setTargets,
    showToast,
    managers,
    storeAccounts,
    managerAuth,
    userRole,
    appId,
    permissions,
  } = useContext(AppContext);
  const [activeTab, setActiveTab] = useState("kpi");
  const [localTargets, setLocalTargets] = useState(targets);
  const [localPermissions, setLocalPermissions] = useState(
    permissions || DEFAULT_PERMISSIONS
  );
  const [newStoreAccount, setNewStoreAccount] = useState({
    name: "",
    password: "",
    stores: "",
  });
  const [newManager, setNewManager] = useState({ name: "", password: "" });
  const [editingManager, setEditingManager] = useState(null);
  const [editingManagerStores, setEditingManagerStores] = useState([]);
  const [newShop, setNewShop] = useState({ name: "", manager: "" });

  useEffect(() => {
    if (permissions) setLocalPermissions(permissions);
  }, [permissions]);

  const handleSaveTargets = async () => {
    try {
      await setDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "global_settings",
          "kpi_targets"
        ),
        localTargets
      );
      setTargets(localTargets);
      showToast("KPI 參數已儲存", "success");
    } catch (e) {
      console.error(e);
      showToast("儲存失敗", "error");
    }
  };
  const handleSavePermissions = async () => {
    try {
      await setDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "global_settings",
          "permissions"
        ),
        localPermissions
      );
      showToast("權限設定已更新", "success");
    } catch (e) {
      console.error(e);
      showToast("更新失敗", "error");
    }
  };
  const togglePermission = (role, menuId) => {
    const current = localPermissions[role] || [];
    const updated = current.includes(menuId)
      ? current.filter((id) => id !== menuId)
      : [...current, menuId];
    setLocalPermissions({ ...localPermissions, [role]: updated });
  };
  const handleAddGlobalStore = async () => {
    if (!newShop.name || !newShop.manager) {
      showToast("請輸入店名並選擇區域", "error");
      return;
    }
    const allStores = Object.values(managers).flat();
    if (allStores.includes(newShop.name)) {
      showToast("該店名已存在", "error");
      return;
    }
    try {
      const currentStores = managers[newShop.manager] || [];
      const updatedStores = [...currentStores, newShop.name];
      const updatedManagers = { ...managers, [newShop.manager]: updatedStores };
      await setDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "global_settings",
          "org_structure"
        ),
        { managers: updatedManagers }
      );
      setNewShop({ name: "", manager: "" });
      showToast(`已新增 ${newShop.name} 至 ${newShop.manager}區`, "success");
    } catch (e) {
      console.error(e);
      showToast("新增失敗", "error");
    }
  };
  const handleDeleteGlobalStore = async (storeName, managerName) => {
    if (
      !confirm(
        `確定要刪除「${storeName}」嗎？\n注意：這不會刪除該店的歷史日報數據，但會將其從組織架構中移除。`
      )
    )
      return;
    try {
      const currentStores = managers[managerName] || [];
      const updatedStores = currentStores.filter((s) => s !== storeName);
      const updatedManagers = { ...managers, [managerName]: updatedStores };
      await setDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "global_settings",
          "org_structure"
        ),
        { managers: updatedManagers }
      );
      showToast("店家已移除", "success");
    } catch (e) {
      showToast("移除失敗", "error");
    }
  };
  const availableUnassignedStores = useMemo(() => {
    const allGlobalStores = Object.values(managers).flat();
    const assignedGlobalStores = storeAccounts.flatMap((a) => a.stores || []);
    return allGlobalStores
      .filter((s) => !assignedGlobalStores.includes(s))
      .sort();
  }, [managers, storeAccounts]);
  const handleAddStoreAccount = async () => {
    if (!newStoreAccount.name || !newStoreAccount.password) {
      showToast("請輸入名稱與密碼", "error");
      return;
    }
    const storesArray = newStoreAccount.stores ? [newStoreAccount.stores] : [];
    const newAccount = {
      id: generateUUID(),
      name: newStoreAccount.name,
      password: newStoreAccount.password,
      stores: storesArray,
    };
    const updatedAccounts = [...storeAccounts, newAccount];
    try {
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
        { accounts: updatedAccounts }
      );
      setNewStoreAccount({ name: "", password: "", stores: "" });
      showToast("店經理帳號已新增", "success");
    } catch (e) {
      showToast("新增失敗", "error");
    }
  };
  const handleDeleteStoreAccount = async (id) => {
    if (!confirm("確定要刪除此帳號嗎？")) return;
    const updatedAccounts = storeAccounts.filter((a) => a.id !== id);
    try {
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
        { accounts: updatedAccounts }
      );
      showToast("帳號已刪除", "success");
    } catch (e) {
      showToast("刪除失敗", "error");
    }
  };
  const orphanedStores = useMemo(() => {
    const allKnownStores = [
      ...new Set(storeAccounts.flatMap((a) => a.stores || [])),
    ];
    const assignedStores = Object.values(managers).flat();
    return allKnownStores.filter((s) => !assignedStores.includes(s)).sort();
  }, [storeAccounts, managers]);
  const handleAddManager = async () => {
    if (!newManager.name || !newManager.password) {
      showToast("請輸入區長姓名與密碼", "error");
      return;
    }
    if (managers[newManager.name]) {
      showToast("該區長已存在", "error");
      return;
    }
    try {
      const newManagersList = { ...managers, [newManager.name]: [] };
      await setDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "global_settings",
          "org_structure"
        ),
        { managers: newManagersList },
        { merge: true }
      );
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
        { [newManager.name]: newManager.password },
        { merge: true }
      );
      setNewManager({ name: "", password: "" });
      showToast("區長已新增", "success");
    } catch (e) {
      showToast("新增失敗", "error");
    }
  };
  const handleSaveManagerStores = async (managerName) => {
    try {
      const updatedManagers = {
        ...managers,
        [managerName]: editingManagerStores,
      };
      await setDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "global_settings",
          "org_structure"
        ),
        { managers: updatedManagers }
      );
      setEditingManager(null);
      showToast(`${managerName}轄區已更新`, "success");
    } catch (e) {
      showToast("更新失敗", "error");
    }
  };
  const handleAddStoreToEditing = (storeName) => {
    if (!storeName) return;
    if (!editingManagerStores.includes(storeName)) {
      setEditingManagerStores([...editingManagerStores, storeName]);
    }
  };
  const handleRemoveStoreFromEditing = (storeName) => {
    setEditingManagerStores(
      editingManagerStores.filter((s) => s !== storeName)
    );
  };
  const handleDeleteManager = async (managerName) => {
    if (!confirm(`確定要移除區長 ${managerName} 及其所有設定嗎？`)) return;
    try {
      const newManagers = { ...managers };
      delete newManagers[managerName];
      await setDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "global_settings",
          "org_structure"
        ),
        { managers: newManagers }
      );
      const newAuth = { ...managerAuth };
      delete newAuth[managerName];
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
        newAuth
      );
      showToast("區長資料已移除", "success");
    } catch (e) {
      showToast("移除失敗", "error");
    }
  };

  if (userRole !== "director")
    return (
      <ViewWrapper>
        <Card title="權限不足">
          <div className="text-center py-10 text-stone-400">
            <Lock size={48} className="mx-auto mb-4 opacity-50" />
            <p>僅總監可存取系統設定</p>
          </div>
        </Card>
      </ViewWrapper>
    );

  return (
    <ViewWrapper>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <h2 className="text-2xl font-bold text-stone-800">系統管理中心</h2>
          <div className="bg-white p-1 rounded-xl shadow-sm border border-stone-100 flex overflow-x-auto max-w-full">
            {["kpi", "permissions", "shops", "stores", "managers"].map(
              (tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${
                    activeTab === tab
                      ? "bg-stone-800 text-white shadow"
                      : "text-stone-500 hover:bg-stone-50"
                  }`}
                >
                  {tab === "kpi"
                    ? "KPI 參數"
                    : tab === "permissions"
                    ? "權限設定"
                    : tab === "shops"
                    ? "店家管理"
                    : tab === "stores"
                    ? "店經理帳號"
                    : "組織架構"}
                </button>
              )
            )}
          </div>
        </div>
        {activeTab === "kpi" && (
          <Card title="KPI 目標參數設定" subtitle="設定全域的計算基準值">
            <div className="max-w-md space-y-6">
              <div>
                <label className="block text-sm font-bold text-stone-500 mb-2">
                  目標新客客單 (New Customer ASP)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-stone-400 font-bold">
                    $
                  </span>
                  <input
                    type="number"
                    value={localTargets.newASP}
                    onChange={(e) =>
                      setLocalTargets({
                        ...localTargets,
                        newASP: Number(e.target.value),
                      })
                    }
                    className="w-full pl-8 pr-4 py-3 border-2 border-stone-100 rounded-xl focus:border-amber-400 outline-none font-bold text-stone-700"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-stone-500 mb-2">
                  目標消耗客單 (Traffic ASP)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-stone-400 font-bold">
                    $
                  </span>
                  <input
                    type="number"
                    value={localTargets.trafficASP}
                    onChange={(e) =>
                      setLocalTargets({
                        ...localTargets,
                        trafficASP: Number(e.target.value),
                      })
                    }
                    className="w-full pl-8 pr-4 py-3 border-2 border-stone-100 rounded-xl focus:border-amber-400 outline-none font-bold text-stone-700"
                  />
                </div>
              </div>
              <button
                onClick={handleSaveTargets}
                className="w-full bg-stone-800 text-white py-3 rounded-xl font-bold hover:bg-stone-900 transition-colors shadow-lg"
              >
                儲存 KPI 設定
              </button>
            </div>
          </Card>
        )}
        {activeTab === "permissions" && (
          <Card title="角色權限管理" subtitle="設定各職級可存取的系統模組">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200">
                    <th className="p-4 font-bold text-stone-500">功能模組</th>
                    <th className="p-4 font-bold text-stone-700 text-center bg-teal-50/50">
                      區長 (Manager)
                    </th>
                    <th className="p-4 font-bold text-stone-700 text-center bg-amber-50/50">
                      店經理 (Store)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {ALL_MENU_ITEMS.map((item) => (
                    <tr key={item.id} className="hover:bg-stone-50">
                      <td className="p-4 flex items-center gap-3">
                        <div className="p-2 bg-stone-100 rounded-lg text-stone-500">
                          <item.icon size={18} />
                        </div>
                        <span className="font-bold text-stone-700">
                          {item.label}
                        </span>
                      </td>
                      <td className="p-4 text-center bg-teal-50/30">
                        <input
                          type="checkbox"
                          checked={localPermissions.manager?.includes(item.id)}
                          onChange={() => togglePermission("manager", item.id)}
                          className="w-5 h-5 rounded border-stone-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                        />
                      </td>
                      <td className="p-4 text-center bg-amber-50/30">
                        <input
                          type="checkbox"
                          checked={localPermissions.store?.includes(item.id)}
                          onChange={() => togglePermission("store", item.id)}
                          className="w-5 h-5 rounded border-stone-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSavePermissions}
                className="bg-stone-800 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-stone-700 shadow-lg active:scale-95 transition-all"
              >
                儲存權限設定
              </button>
            </div>
          </Card>
        )}
        {activeTab === "shops" && (
          <div className="space-y-6">
            <Card title="新增營運店家">
              <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                  <label className="block text-xs font-bold text-stone-400 mb-1">
                    分店簡稱
                  </label>
                  <input
                    type="text"
                    value={newShop.name}
                    onChange={(e) =>
                      setNewShop({ ...newShop, name: e.target.value })
                    }
                    placeholder="例如: 中山"
                    className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"
                  />
                </div>
                <div className="flex-1 w-full">
                  <label className="block text-xs font-bold text-stone-400 mb-1">
                    所屬區域 (區長)
                  </label>
                  <div className="relative">
                    <select
                      value={newShop.manager}
                      onChange={(e) =>
                        setNewShop({ ...newShop, manager: e.target.value })
                      }
                      className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold appearance-none bg-white text-stone-700"
                    >
                      <option value="">請選擇...</option>
                      {Object.keys(managers).map((m) => (
                        <option key={m} value={m}>
                          {m} 區
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      className="absolute right-3 top-3 text-stone-400 pointer-events-none"
                    />
                  </div>
                </div>
                <button
                  onClick={handleAddGlobalStore}
                  className="w-full md:w-auto bg-stone-800 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-stone-700 shadow-sm flex items-center justify-center gap-2"
                >
                  <Plus size={18} /> 新增店家
                </button>
              </div>
            </Card>
            <Card title="全域店家列表">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(managers).map(([mgr, stores]) => (
                  <div
                    key={mgr}
                    className="bg-stone-50 rounded-2xl p-4 border border-stone-100"
                  >
                    <div className="flex items-center gap-2 mb-3 border-b border-stone-200 pb-2">
                      <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center text-xs font-bold text-stone-500">
                        {mgr[0]}
                      </div>
                      <span className="font-bold text-stone-700">{mgr} 區</span>
                      <span className="text-xs text-stone-400 ml-auto">
                        {stores.length} 間
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {stores.length > 0 ? (
                        stores.map((store) => (
                          <div
                            key={store}
                            className="group relative flex items-center"
                          >
                            <span className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold text-stone-600 shadow-sm pr-7">
                              {store}
                            </span>
                            <button
                              onClick={() =>
                                handleDeleteGlobalStore(store, mgr)
                              }
                              className="absolute right-1 p-1 text-stone-300 hover:text-rose-500 transition-colors"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-stone-400 italic">
                          無店家
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
        {activeTab === "stores" && (
          <div className="space-y-6">
            <Card title="新增店經理帳號">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-xs font-bold text-stone-400 mb-1">
                    姓名 / 帳號名稱
                  </label>
                  <input
                    type="text"
                    value={newStoreAccount.name}
                    onChange={(e) =>
                      setNewStoreAccount({
                        ...newStoreAccount,
                        name: e.target.value,
                      })
                    }
                    placeholder="例如: 王小明"
                    className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-400 mb-1">
                    登入密碼
                  </label>
                  <input
                    type="text"
                    value={newStoreAccount.password}
                    onChange={(e) =>
                      setNewStoreAccount({
                        ...newStoreAccount,
                        password: e.target.value,
                      })
                    }
                    placeholder="設定密碼"
                    className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-stone-400 mb-1">
                    分配管理店家
                  </label>
                  <div className="flex gap-2">
                    <div className="relative w-full">
                      <Store
                        size={16}
                        className="absolute left-3 top-3 text-stone-400 pointer-events-none"
                      />
                      <select
                        value={newStoreAccount.stores}
                        onChange={(e) =>
                          setNewStoreAccount({
                            ...newStoreAccount,
                            stores: e.target.value,
                          })
                        }
                        className="w-full pl-10 pr-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold appearance-none bg-white text-stone-700"
                      >
                        <option value="">請選擇未分配店家...</option>
                        {availableUnassignedStores.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={16}
                        className="absolute right-3 top-3 text-stone-400 pointer-events-none"
                      />
                    </div>
                    <button
                      onClick={handleAddStoreAccount}
                      className="bg-stone-800 text-white px-4 rounded-xl font-bold shrink-0 hover:bg-stone-700"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
            <Card title="現有店經理列表">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-stone-50 font-bold text-stone-500 uppercase">
                    <tr>
                      <th className="p-4 rounded-tl-xl">姓名</th>
                      <th className="p-4">密碼</th>
                      <th className="p-4">負責店家</th>
                      <th className="p-4 rounded-tr-xl text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {storeAccounts.map((account) => (
                      <tr key={account.id} className="hover:bg-stone-50">
                        <td className="p-4 font-bold text-stone-700">
                          {account.name}
                        </td>
                        <td className="p-4 font-mono text-stone-500">
                          {account.password}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-1">
                            {account.stores &&
                              account.stores.map((s) => (
                                <span
                                  key={s}
                                  className="px-2 py-1 bg-stone-100 rounded text-xs font-bold text-stone-600"
                                >
                                  {s}
                                </span>
                              ))}
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => handleDeleteStoreAccount(account.id)}
                            className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 p-2 rounded-lg transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {storeAccounts.length === 0 && (
                      <tr>
                        <td
                          colSpan="4"
                          className="p-8 text-center text-stone-400"
                        >
                          目前沒有帳號
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
        {activeTab === "managers" && (
          <div className="space-y-6">
            <Card title="新增區長">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-xs font-bold text-stone-400 mb-1">
                    區長姓名
                  </label>
                  <input
                    type="text"
                    value={newManager.name}
                    onChange={(e) =>
                      setNewManager({ ...newManager, name: e.target.value })
                    }
                    placeholder="例如: Jonas"
                    className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-400 mb-1">
                    預設密碼
                  </label>
                  <input
                    type="text"
                    value={newManager.password}
                    onChange={(e) =>
                      setNewManager({ ...newManager, password: e.target.value })
                    }
                    placeholder="設定密碼"
                    className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"
                  />
                </div>
                <button
                  onClick={handleAddManager}
                  className="bg-stone-800 text-white py-2.5 rounded-xl font-bold hover:bg-stone-700 shadow-sm flex items-center justify-center gap-2"
                >
                  <Plus size={18} /> 新增區長
                </button>
              </div>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.entries(managers).map(([managerName, stores]) => (
                <Card key={managerName} className="border border-stone-200">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-stone-700 flex items-center gap-2">
                        <User size={20} className="text-amber-500" />
                        {managerName} 區
                      </h3>
                      <p className="text-xs text-stone-400 mt-1 font-mono">
                        密碼: {managerAuth[managerName] || "未設定"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingManager(managerName);
                          setEditingManagerStores(stores);
                        }}
                        className="text-xs bg-stone-100 text-stone-600 px-3 py-1.5 rounded-lg hover:bg-stone-200 font-bold"
                      >
                        編輯轄區
                      </button>
                      <button
                        onClick={() => handleDeleteManager(managerName)}
                        className="text-rose-400 hover:bg-rose-50 p-1.5 rounded-lg"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {editingManager === managerName ? (
                    <div className="mt-4 animate-in fade-in slide-in-from-top-2 bg-stone-50 p-4 rounded-xl border border-stone-200">
                      <label className="block text-xs font-bold text-stone-400 mb-2">
                        已分配店家 (點擊 X 移除)
                      </label>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {editingManagerStores.map((s) => (
                          <div
                            key={s}
                            className="group relative flex items-center"
                          >
                            <span className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold text-stone-600 shadow-sm pr-7">
                              {s}
                            </span>
                            <button
                              onClick={() => handleRemoveStoreFromEditing(s)}
                              className="absolute right-1 p-1 text-stone-300 hover:text-rose-500 transition-colors"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                        {editingManagerStores.length === 0 && (
                          <span className="text-xs text-stone-400 italic">
                            暫無店家
                          </span>
                        )}
                      </div>
                      <div className="mb-4">
                        <label className="block text-xs font-bold text-stone-400 mb-1">
                          新增未分配店家
                        </label>
                        <div className="relative">
                          <select
                            onChange={(e) => {
                              handleAddStoreToEditing(e.target.value);
                              e.target.value = "";
                            }}
                            className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl outline-none focus:border-amber-400 font-bold appearance-none bg-white text-stone-700"
                          >
                            <option value="">請選擇...</option>
                            {orphanedStores
                              .filter((s) => !editingManagerStores.includes(s))
                              .map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                          </select>
                          <ChevronDown
                            size={16}
                            className="absolute right-3 top-3 text-stone-400 pointer-events-none"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingManager(null)}
                          className="px-3 py-1.5 text-xs font-bold text-stone-400 hover:text-stone-600"
                        >
                          取消
                        </button>
                        <button
                          onClick={() => handleSaveManagerStores(managerName)}
                          className="px-4 py-1.5 bg-stone-800 text-white text-xs font-bold rounded-lg hover:bg-stone-900"
                        >
                          儲存變更
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {stores.length > 0 ? (
                        stores.map((s) => (
                          <span
                            key={s}
                            className="px-2.5 py-1 bg-stone-50 border border-stone-100 rounded-lg text-xs font-bold text-stone-600"
                          >
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-stone-300 italic">
                          尚未分配店家
                        </span>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </ViewWrapper>
  );
};

// --- Log View ---
const LogView = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => {
    const q = query(
      collection(db, "artifacts", appId, "public", "data", "system_logs"),
      orderBy("timestamp", "desc"),
      limit(200)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const totalPages = Math.ceil(logs.length / itemsPerPage);
  const currentData = logs.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  const formatTime = (ts) => {
    if (!ts) return "-";
    const date = ts.toDate();
    return `${date.getMonth() + 1}/${date.getDate()} ${date
      .getHours()
      .toString()
      .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  };
  const getRoleBadge = (role) => {
    switch (role) {
      case "director":
        return (
          <span className="bg-rose-100 text-rose-600 px-2.5 py-1 rounded-lg text-xs font-bold">
            總監
          </span>
        );
      case "manager":
        return (
          <span className="bg-teal-100 text-teal-600 px-2.5 py-1 rounded-lg text-xs font-bold">
            區長
          </span>
        );
      case "store":
        return (
          <span className="bg-amber-100 text-amber-600 px-2.5 py-1 rounded-lg text-xs font-bold">
            店經理
          </span>
        );
      default:
        return (
          <span className="bg-stone-100 text-stone-500 px-2.5 py-1 rounded-lg text-xs">
            未知
          </span>
        );
    }
  };
  const getDeviceIcon = (device) =>
    device === "iOS" || device === "Android" || device === "Mobile" ? (
      <div className="flex items-center gap-1 text-stone-500 font-bold bg-stone-100 px-2 py-1 rounded text-xs w-max">
        <Smartphone size={14} className="text-stone-400" /> {device}
      </div>
    ) : (
      <div className="flex items-center gap-1 text-stone-400 text-xs w-max">
        <Monitor size={14} /> PC
      </div>
    );

  return (
    <ViewWrapper>
      <Card
        title="系統監控日誌"
        subtitle="即時追蹤系統使用狀況 (顯示最近 200 筆紀錄)"
      >
        {loading ? (
          <div className="space-y-4 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto min-h-[400px] rounded-2xl border border-stone-100">
              <table className="w-full text-left border-collapse">
                <thead className="bg-stone-50/50 text-stone-400 font-bold text-xs uppercase tracking-wider border-b border-stone-100">
                  <tr>
                    <th className="p-4 w-32">時間</th>
                    <th className="p-4 w-24">裝置</th>
                    <th className="p-4 w-24">身份</th>
                    <th className="p-4 w-32">使用者</th>
                    <th className="p-4 w-32">動作</th>
                    <th className="p-4">詳細內容</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50 text-sm bg-white">
                  {currentData.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-rose-50/30 transition-colors"
                    >
                      <td className="p-4 font-mono text-stone-400 text-xs">
                        {formatTime(log.timestamp)}
                      </td>
                      <td className="p-4">{getDeviceIcon(log.device)}</td>
                      <td className="p-4">{getRoleBadge(log.role)}</td>
                      <td className="p-4 font-bold text-stone-700">
                        {log.user}
                      </td>
                      <td className="p-4 font-medium text-rose-500">
                        {log.action}
                      </td>
                      <td className="p-4 text-stone-500 text-xs">
                        {typeof log.details === "string"
                          ? log.details
                          : JSON.stringify(log.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex justify-between items-center mt-4 pt-2 px-2">
                <span className="text-sm text-stone-400 font-medium">
                  頁次 {currentPage} / {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 border-2 border-stone-100 rounded-xl hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed text-stone-500"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={currentPage === totalPages}
                    className="p-2 border-2 border-stone-100 rounded-xl hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed text-stone-500"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </ViewWrapper>
  );
};

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

  const analytics = useMemo(() => {
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;
    const currentMonthData = visibleRawData.filter((d) => {
      if (!d.date) return false;
      const dateStr = d.date.replace(/-/g, "/");
      const [y, m] = dateStr.split("/").map(Number);
      return (y === targetYear || y === rocYear) && m === monthInt;
    });
    const dates = [
      ...new Set(currentMonthData.map((d) => toStandardDateFormat(d.date))),
    ].sort();
    const latestDate = dates[dates.length - 1] || "無資料";
    const daysInMonth = new Date(targetYear, monthInt, 0).getDate();
    let currentDayNum = 1;
    if (latestDate !== "無資料")
      currentDayNum = parseInt(latestDate.split("/")[2]);

    const dailyTotals = dates.map((date) => {
      const dayRecs = currentMonthData.filter(
        (r) => toStandardDateFormat(r.date) === date
      );
      return {
        date: date.split("/")[2],
        fullDate: date,
        cash: dayRecs.reduce((a, b) => a + (b.cash || 0) - (b.refund || 0), 0),
        traffic: dayRecs.reduce((a, b) => a + (b.traffic || 0), 0),
      };
    });

    const storeList = Object.entries(visibleManagers).flatMap(([mgr, stores]) =>
      stores.map((s) => ({ name: `CYJ${s}店`, manager: mgr }))
    );
    const storeStats = storeList.map((s) => {
      const storeRecs = currentMonthData.filter((r) => r.storeName === s.name);
      const grossCashTotal = storeRecs.reduce((a, b) => a + (b.cash || 0), 0);
      const refundTotal = storeRecs.reduce((a, b) => a + (b.refund || 0), 0);
      const cashTotal = grossCashTotal - refundTotal;
      const accrualTotal = storeRecs.reduce((a, b) => a + (b.accrual || 0), 0);
      const operationalAccrualTotal = storeRecs.reduce(
        (a, b) => a + (b.operationalAccrual || 0),
        0
      );
      const trafficTotal = storeRecs.reduce((a, b) => a + (b.traffic || 0), 0);
      const newCustomersTotal = storeRecs.reduce(
        (a, b) => a + (b.newCustomers || 0),
        0
      );
      const newCustomerClosingsTotal = storeRecs.reduce(
        (a, b) => a + (b.newCustomerClosings || 0),
        0
      );
      const newCustomerSalesTotal = storeRecs.reduce(
        (a, b) => a + (b.newCustomerSales || 0),
        0
      );
      const grossSkincareSales = storeRecs.reduce(
        (a, b) => a + (b.skincareSales || 0),
        0
      );
      const skincareRefundTotal = storeRecs.reduce(
        (a, b) => a + (b.skincareRefund || 0),
        0
      );
      const skincareSalesTotal = grossSkincareSales - skincareRefundTotal;
      const budgetKey = `${s.name}_${targetYear}_${monthInt}`;
      const budget = budgets[budgetKey] || { cashTarget: 0, accrualTarget: 0 };
      return {
        ...s,
        cashTotal,
        accrualTotal,
        operationalAccrualTotal,
        trafficTotal,
        newCustomersTotal,
        newCustomerClosingsTotal,
        newCustomerSalesTotal,
        skincareSalesTotal,
        skincareRefundTotal,
        refundTotal,
        cashBudget: budget.cashTarget,
        accrualBudget: budget.accrualTarget,
        projection:
          currentDayNum > 0
            ? Math.round((cashTotal / currentDayNum) * daysInMonth)
            : 0,
        achievement:
          budget.cashTarget > 0 ? (cashTotal / budget.cashTarget) * 100 : 0,
        trafficASP:
          trafficTotal > 0
            ? Math.round(operationalAccrualTotal / trafficTotal)
            : 0,
        newCustomerASP:
          newCustomersTotal > 0
            ? Math.round(newCustomerSalesTotal / newCustomersTotal)
            : 0,
      };
    });

    const grandTotal = storeStats.reduce(
      (acc, s) => ({
        cash: acc.cash + s.cashTotal,
        accrual: acc.accrual + s.accrualTotal,
        operationalAccrual: acc.operationalAccrual + s.operationalAccrualTotal,
        skincareSales: acc.skincareSales + s.skincareSalesTotal,
        skincareRefund: acc.skincareRefund + s.skincareRefundTotal,
        traffic: acc.traffic + s.trafficTotal,
        newCustomers: acc.newCustomers + s.newCustomersTotal,
        newCustomerClosings:
          acc.newCustomerClosings + s.newCustomerClosingsTotal,
        newCustomerSales: acc.newCustomerSales + s.newCustomerSalesTotal,
        refund: acc.refund + s.refundTotal,
        budget: acc.budget + s.cashBudget,
        accrualBudget: acc.accrualBudget + s.accrualBudget,
        projection: acc.projection + s.projection,
      }),
      {
        cash: 0,
        accrual: 0,
        operationalAccrual: 0,
        skincareSales: 0,
        skincareRefund: 0,
        traffic: 0,
        newCustomers: 0,
        newCustomerClosings: 0,
        newCustomerSales: 0,
        refund: 0,
        budget: 0,
        accrualBudget: 0,
        projection: 0,
      }
    );

    const regionalStats = Object.entries(visibleManagers).map(
      ([mgr, stores]) => {
        const managed = storeStats.filter((s) => s.manager === mgr);
        const cashTotal = managed.reduce((a, b) => a + b.cashTotal, 0);
        const accrualTotal = managed.reduce((a, b) => a + b.accrualTotal, 0);
        const operationalAccrualTotal = managed.reduce(
          (a, b) => a + b.operationalAccrualTotal,
          0
        );
        const budget = managed.reduce((a, b) => a + b.cashBudget, 0);
        const skincareSalesTotal = managed.reduce(
          (a, b) => a + b.skincareSalesTotal,
          0
        );
        const skincareRefundTotal = managed.reduce(
          (a, b) => a + b.skincareRefundTotal,
          0
        );
        const trafficTotal = managed.reduce((a, b) => a + b.trafficTotal, 0);
        const newCustomersTotal = managed.reduce(
          (a, b) => a + b.newCustomersTotal,
          0
        );
        const newCustomerClosingsTotal = managed.reduce(
          (a, b) => a + b.newCustomerClosingsTotal,
          0
        );
        const refundTotal = managed.reduce((a, b) => a + b.refundTotal, 0);
        const trafficASP =
          trafficTotal > 0
            ? Math.round(operationalAccrualTotal / trafficTotal)
            : 0;
        return {
          manager: mgr,
          cashTotal,
          accrualTotal,
          operationalAccrualTotal,
          skincareSalesTotal,
          skincareRefundTotal,
          trafficTotal,
          newCustomersTotal,
          newCustomerClosingsTotal,
          refundTotal,
          trafficASP,
          achievement: budget > 0 ? (cashTotal / budget) * 100 : 0,
        };
      }
    );

    return {
      latestDate,
      daysPassed: currentDayNum,
      daysInMonth,
      remainingDays: daysInMonth - currentDayNum,
      dailyTotals,
      storeList: storeStats,
      grandTotal,
      regionalStats,
      totalAchievement:
        grandTotal.budget > 0 ? (grandTotal.cash / grandTotal.budget) * 100 : 0,
      avgTrafficASP:
        grandTotal.traffic > 0
          ? Math.round(grandTotal.operationalAccrual / grandTotal.traffic)
          : 0,
      avgNewCustomerASP:
        grandTotal.newCustomers > 0
          ? Math.round(grandTotal.newCustomerSales / grandTotal.newCustomers)
          : 0,
      allDates: dates,
    };
  }, [visibleRawData, selectedMonth, selectedYear, budgets, visibleManagers]);

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
      showToast,
      openConfirm,
      fmtMoney,
      fmtNum,
      inputDate,
      setInputDate,
      storeList: analytics.storeList,
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
            {activeView === "logs" && <LogView />}
            {activeView === "settings" && <SettingsView />}
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
