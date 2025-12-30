import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInAnonymously, 
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  onSnapshot, 
  serverTimestamp, 
  query, 
  setDoc
} from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, 
  LineChart, Line, ComposedChart, Area, Cell, ReferenceLine
} from 'recharts';
import { 
  LayoutDashboard, Upload, TrendingUp, Users, DollarSign, 
  Target, Calendar, Award, AlertCircle, ArrowUpRight, ArrowDownRight, Map, Zap, Settings, ClipboardCheck, Copy, CheckCircle, XCircle, Clock, Plus, Trash2, Save, Cloud, Loader2
} from 'lucide-react';

// --- Firebase 初始化 ---
const firebaseConfig = ｛
  apiKey: "AIzaSyDqeHT2J9Z69k88-clPwKyuywg1TSpojYM",
  authDomain: "cyjsituation-analysis.firebaseapp.com",
  projectId: "cyjsituation-analysis",
  storageBucket: "cyjsituation-analysis.firebasestorage.app",
  messagingSenderId: "139860745126",
  appId: "1:139860745126:web:4539176a4cf73ae4480d67",
  measurementId: "G-L9DVME64VK";｝
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "cyj-v1-production"

// --- 基礎設定 ---

const generateStoreList = () => {
  const locations = [
    '板橋', '北車', '新店', '士林', '蘆洲', '桃園', '八德', '中壢', 
    '古亭', '內湖', '南港', '頂溪', '安和', '園區', '新竹', '竹北', 
    '林口', '新莊', '崇學', '安平', '永康', '左營', '三重', '仁愛', 
    '北大', '復北', '河南', '站前', '豐原', '太平', '大順', '前鎮'
  ];
  return locations.map(loc => `CYJ${loc}店`);
};

const STORE_LIST = generateStoreList();

// 區長區域設定
const REGIONAL_MANAGERS = {
  'Jonas': ['安平', '永康', '崇學', '大順', '前鎮', '左營'],
  'Angel': ['古亭', '蘆洲', '北車', '三重', '桃園', '中壢', '八德'],
  '漢娜': ['內湖', '安和', '士林', '南港', '頂溪', '園區', '新竹', '竹北'],
  '婉娟': ['林口', '新莊', '北大', '河南', '站前', '豐原', '太平'],
  'AA': ['仁愛', '板橋', '新店', '復北']
};

// --- 組件開始 ---

const Card = ({ children, className = "" }) => (
  <div className={`bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden ${className}`}>
    {children}
  </div>
);

const KPICard = ({ title, value, subValue, icon: Icon, trend, trendValue, color = "blue" }) => {
  const colorClasses = {
    blue: "text-indigo-600 bg-indigo-50",
    green: "text-emerald-600 bg-emerald-50",
    purple: "text-violet-600 bg-violet-50",
    orange: "text-amber-600 bg-amber-50",
    pink: "text-rose-600 bg-rose-50",
    cyan: "text-cyan-600 bg-cyan-50",
    stone: "text-stone-600 bg-stone-100"
  };

  return (
    <Card className="p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-stone-500 text-sm font-medium mb-1 tracking-wide">{title}</p>
          <h3 className="text-3xl font-bold text-stone-800 tracking-tight font-mono">{value}</h3>
        </div>
        <div className={`p-3 rounded-xl ${colorClasses[color]} transition-colors`}>
          <Icon size={22} />
        </div>
      </div>
      {(subValue || trend) && (
        <div className="flex items-center text-sm mt-2">
          {trend && (
            <span className={`flex items-center font-bold mr-3 px-2 py-0.5 rounded-full text-xs ${trend === 'up' ? 'text-emerald-700 bg-emerald-100' : 'text-rose-700 bg-rose-100'}`}>
              {trend === 'up' ? <ArrowUpRight size={12} className="mr-1" /> : <ArrowDownRight size={12} className="mr-1" />}
              {trendValue}
            </span>
          )}
          <span className="text-stone-400 font-medium">{subValue}</span>
        </div>
      )}
    </Card>
  );
};

export default function WarRoom() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('input');
  
  // 資料狀態 (從 Firebase 同步)
  const [rawData, setRawData] = useState([]); 
  const [budgets, setBudgets] = useState({});
  const [targets, setTargets] = useState({ newASP: 3500, trafficASP: 1200 });

  // 輸入狀態
  const [budgetInputText, setBudgetInputText] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("12");

  // 檢核日期狀態
  const [auditDate, setAuditDate] = useState("");

  // 取得當日本地日期 (YYYY-MM-DD)
  const getTodayString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // 輸入表單狀態
  const [inputDate, setInputDate] = useState(getTodayString());
  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  
  // 數值輸入
  const [formCash, setFormCash] = useState("");
  const [formAccrual, setFormAccrual] = useState("");
  const [formTraffic, setFormTraffic] = useState("");
  const [formNewCustomers, setFormNewCustomers] = useState("");
  const [formNewSales, setFormNewSales] = useState("");

  // 暫存清單 (本地暫存，確認後上傳)
  const [pendingEntries, setPendingEntries] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  // --- Firebase 監聽與初始化 ---

  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) setLoading(false);
    });
  }, []);

  // 監聽資料庫
  useEffect(() => {
    if (!user) return;

    // 1. 監聽日報數據 (使用 Public 集合以便協作)
    const reportsRef = collection(db, 'artifacts', appId, 'public', 'data', 'daily_reports');
    const unsubReports = onSnapshot(reportsRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRawData(data);
    }, (err) => console.error("Reports fetch error:", err));

    // 2. 監聽預算設定
    const budgetsRef = collection(db, 'artifacts', appId, 'public', 'data', 'store_budgets');
    const unsubBudgets = onSnapshot(budgetsRef, (snapshot) => {
      const budgetMap = {};
      snapshot.docs.forEach(doc => {
        budgetMap[doc.id] = doc.data();
      });
      setBudgets(budgetMap);
    }, (err) => console.error("Budgets fetch error:", err));

    // 3. 監聽全域目標
    const targetsRef = doc(db, 'artifacts', appId, 'public', 'data', 'global_settings', 'kpi_targets');
    const unsubTargets = onSnapshot(targetsRef, (docSnap) => {
      if (docSnap.exists()) {
        setTargets(docSnap.data());
      }
    }, (err) => console.error("Targets fetch error:", err));

    setLoading(false);

    return () => {
      unsubReports();
      unsubBudgets();
      unsubTargets();
    };
  }, [user]);

  // --- 資料寫入邏輯 ---

  const formatROCDate = (isoDate) => {
    if (!isoDate) return "";
    const [year, month, day] = isoDate.split('-');
    const rocYear = parseInt(year) - 1911;
    return `${rocYear}/${parseInt(month)}/${parseInt(day)}`;
  };

  const handleBudgetParse = async () => {
    if (!user) return;
    setIsUploading(true);
    const newBudgets = {};
    let currentStore = null;
    const lines = budgetInputText.split('\n');
    const regexCashTarget = /現金目標[：:]\s*\$?([\d,]+)/;
    const regexAccrualTarget = /權責目標[：:]\s*\$?([\d,]+)/;

    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine.includes('店') && !trimmedLine.includes('目標')) {
        currentStore = trimmedLine;
      } else if (currentStore) {
        if (!newBudgets[currentStore]) newBudgets[currentStore] = {};
        
        const cashMatch = line.match(regexCashTarget);
        if (cashMatch) newBudgets[currentStore].cashTarget = parseInt(cashMatch[1].replace(/,/g, ''));

        const accrualMatch = line.match(regexAccrualTarget);
        if (accrualMatch) newBudgets[currentStore].accrualTarget = parseInt(accrualMatch[1].replace(/,/g, ''));
      }
    });

    try {
      const batchPromises = Object.entries(newBudgets).map(([storeName, data]) => {
        // 使用 setDoc (merge: true) 來更新或建立預算
        return setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'store_budgets', storeName), data, { merge: true });
      });
      await Promise.all(batchPromises);
      setBudgetInputText("");
      alert(`成功更新 ${Object.keys(newBudgets).length} 間門市預算！`);
      setActiveTab('dashboard');
    } catch (err) {
      console.error(err);
      alert("更新失敗，請檢查網路");
    } finally {
      setIsUploading(false);
    }
  };

  const saveGlobalTargets = async (newASP, newTraffic) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'global_settings', 'kpi_targets'), {
        newASP: Number(newASP),
        trafficASP: Number(newTraffic)
      });
    } catch (err) {
      console.error("Error saving targets:", err);
    }
  };

  const handleAddToPending = () => {
    if (!selectedStore || !inputDate) {
      alert("請選擇日期與店家");
      return;
    }

    if (inputDate > getTodayString()) {
      alert("無法輸入未來日期的業績！請選擇今日或之前的日期。");
      return;
    }

    const newEntry = {
      id: Math.random().toString(36).substr(2, 9),
      date: formatROCDate(inputDate),
      storeName: selectedStore,
      cash: Number(formCash) || 0,
      accrual: Number(formAccrual) || 0,
      traffic: Number(formTraffic) || 0,
      newCustomers: Number(formNewCustomers) || 0,
      newCustomerSales: Number(formNewSales) || 0,
      manager: selectedManager,
      timestamp: Date.now() // 用於排序
    };

    setPendingEntries([...pendingEntries, newEntry]);
    
    // 清空輸入
    setFormCash("");
    setFormAccrual("");
    setFormTraffic("");
    setFormNewCustomers("");
    setFormNewSales("");
    setSelectedStore(""); 
  };

  const handleRemovePending = (id) => {
    setPendingEntries(pendingEntries.filter(e => e.id !== id));
  };

  const handleSubmitAll = async () => {
    if (!user || pendingEntries.length === 0) return;
    setIsUploading(true);

    try {
      // 批次寫入 Firestore
      const promises = pendingEntries.map(entry => {
        // 移除臨時 id, 加入 serverTimestamp
        const { id, ...data } = entry;
        return addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'daily_reports'), {
          ...data,
          createdAt: serverTimestamp()
        });
      });

      await Promise.all(promises);
      setPendingEntries([]);
      alert(`成功上傳 ${pendingEntries.length} 筆資料至雲端！`);
      setActiveTab('dashboard');
    } catch (err) {
      console.error("Upload error:", err);
      alert("上傳失敗，請稍後再試");
    } finally {
      setIsUploading(false);
    }
  };

  // --- 計算邏輯 (與 V1 相同，但資料源改為 Firestore 的 rawData) ---
  
  const availableStores = useMemo(() => {
    if (!selectedManager) return [];
    const locations = REGIONAL_MANAGERS[selectedManager] || [];
    return STORE_LIST.filter(store => locations.some(loc => store.includes(loc)));
  }, [selectedManager]);

  const analytics = useMemo(() => {
    const currentMonthData = rawData.filter(d => d.date && d.date.includes(`114/${selectedMonth}`));
    const dates = [...new Set(currentMonthData.map(d => d.date))].sort((a, b) => {
        const dayA = parseInt(a.split('/')[2]);
        const dayB = parseInt(b.split('/')[2]);
        return dayA - dayB;
    });
    const latestDate = dates[dates.length - 1] || "無資料";
    
    const year = 2025; 
    const monthIndex = parseInt(selectedMonth) - 1;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate(); 
    
    let currentDayNum = 1;
    if (latestDate !== "無資料") {
        currentDayNum = parseInt(latestDate.split('/')[2]);
    }
    
    const daysPassed = currentDayNum;
    const remainingDays = daysInMonth - daysPassed;

    const dailyTotals = dates.map(date => {
      const records = currentMonthData.filter(r => r.date === date);
      return {
        date,
        cash: records.reduce((sum, r) => sum + (r.cash||0), 0),
        accrual: records.reduce((sum, r) => sum + (r.accrual||0), 0),
        traffic: records.reduce((sum, r) => sum + (r.traffic||0), 0),
        newCustomers: records.reduce((sum, r) => sum + (r.newCustomers||0), 0),
      };
    });

    const storeStats = {};
    // 初始化所有店鋪 (確保即使沒業績也有資料)
    STORE_LIST.forEach(sName => {
        storeStats[sName] = {
          name: sName,
          cashTotal: 0, accrualTotal: 0, trafficTotal: 0, newCustomersTotal: 0, newCustomerSalesTotal: 0,
          cashBudget: budgets[sName]?.cashTarget || 0,
          accrualBudget: budgets[sName]?.accrualTarget || 0,
        };
    });

    currentMonthData.forEach(r => {
      if (storeStats[r.storeName]) {
        storeStats[r.storeName].cashTotal += (r.cash||0);
        storeStats[r.storeName].accrualTotal += (r.accrual||0);
        storeStats[r.storeName].trafficTotal += (r.traffic||0);
        storeStats[r.storeName].newCustomersTotal += (r.newCustomers||0);
        storeStats[r.storeName].newCustomerSalesTotal += (r.newCustomerSales||0);
      }
    });

    const storeList = Object.values(storeStats).map(s => {
      const projection = daysPassed > 0 ? Math.round((s.cashTotal / daysPassed) * daysInMonth) : 0;
      const achievement = s.cashBudget > 0 ? (s.cashTotal / s.cashBudget) * 100 : 0;
      const newCustomerASP = s.newCustomersTotal > 0 ? Math.round(s.newCustomerSalesTotal / s.newCustomersTotal) : 0;
      const trafficASP = s.trafficTotal > 0 ? Math.round(s.accrualTotal / s.trafficTotal) : 0;

      return { ...s, projection, achievement, newCustomerASP, trafficASP };
    });

    const grandTotal = storeList.reduce((acc, s) => ({
      cash: acc.cash + s.cashTotal,
      accrual: acc.accrual + s.accrualTotal,
      traffic: acc.traffic + s.trafficTotal,
      newCustomers: acc.newCustomers + s.newCustomersTotal,
      budget: acc.budget + s.cashBudget,
      projection: acc.projection + s.projection
    }), { cash: 0, accrual: 0, traffic: 0, newCustomers: 0, budget: 0, projection: 0 });

    const totalAchievement = grandTotal.budget > 0 ? (grandTotal.cash / grandTotal.budget) * 100 : 0;
    const avgTrafficASP = grandTotal.traffic > 0 ? Math.round(grandTotal.accrual / grandTotal.traffic) : 0;

    const regionalStats = Object.entries(REGIONAL_MANAGERS).map(([manager, locations]) => {
        const managedStores = storeList.filter(s => locations.some(loc => s.name.includes(loc)));
        const rStats = managedStores.reduce((acc, s) => ({
            cashTotal: acc.cashTotal + s.cashTotal,
            budget: acc.budget + s.cashBudget,
            accrualBudget: acc.accrualBudget + s.accrualBudget,
            trafficTotal: acc.trafficTotal + s.trafficTotal,
            storeCount: acc.storeCount + 1,
            stores: [...acc.stores, s]
        }), { cashTotal: 0, budget: 0, accrualBudget: 0, trafficTotal: 0, storeCount: 0, stores: [] });
        const achievement = rStats.budget > 0 ? (rStats.cashTotal / rStats.budget) * 100 : 0;
        return { manager, ...rStats, achievement };
    });

    return { 
      latestDate, daysPassed, daysInMonth, remainingDays, 
      dailyTotals, storeList, grandTotal, totalAchievement, regionalStats, avgTrafficASP,
      allDates: dates 
    };
  }, [rawData, selectedMonth, budgets]);

  useEffect(() => {
    if (analytics.latestDate && !auditDate && analytics.latestDate !== "無資料") {
        setAuditDate(analytics.latestDate);
    }
  }, [analytics.latestDate]);

  const auditResult = useMemo(() => {
    if (!auditDate) return { submitted: [], missing: [], percentage: 0 };
    const submittedStores = [...new Set(rawData.filter(d => d.date === auditDate).map(d => d.storeName))];
    const missing = STORE_LIST.filter(store => !submittedStores.includes(store));
    const percentage = (submittedStores.length / STORE_LIST.length) * 100;
    return { submitted: submittedStores, missing, percentage };
  }, [rawData, auditDate]);

  const fmtMoney = (val) => `$${val?.toLocaleString()}`;
  const fmtNum = (val) => val?.toLocaleString();
  const COLORS = { grid: '#e7e5e4' };

  // --- Render ---

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 text-stone-400">
        <Loader2 className="w-10 h-10 animate-spin mb-4 text-indigo-600" />
        <p>正在連線至 CYJ 雲端資料庫...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800 font-sans selection:bg-indigo-100 selection:text-indigo-900 pb-20">
      
      {/* Navbar */}
      <nav className="bg-white border-b border-stone-200 sticky top-0 z-50 shadow-sm backdrop-blur-sm bg-white/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 p-2 rounded-lg shadow-sm shadow-indigo-200">
                <Cloud size={20} className="text-white" />
              </div>
              <div>
                <span className="font-bold text-xl tracking-tight text-stone-800 block leading-tight">CYJ 雲端戰情室</span>
                <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded-full flex items-center gap-1 w-fit mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Live Sync
                </span>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto p-1 hide-scrollbar">
              {[
                { id: 'dashboard', label: '總覽', icon: LayoutDashboard },
                { id: 'regional', label: '區域', icon: Map },
                { id: 'audit', label: '檢核', icon: ClipboardCheck },
                { id: 'ranking', label: '排行', icon: TrendingUp },
                { id: 'settings', label: '設定', icon: Settings },
                { id: 'input', label: '輸入', icon: Upload }
              ].map(tab => (
                <button 
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 whitespace-nowrap
                    ${activeTab === tab.id 
                      ? 'bg-stone-800 text-white shadow-md' 
                      : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700'}`}
                >
                  <tab.icon size={16} />
                  <span className="hidden md:inline">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* DASHBOARD VIEW */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <KPICard 
                title="營運進度" 
                value={analytics.latestDate === "無資料" ? "--" : `Day ${analytics.daysPassed}`}
                subValue={`本月剩餘 ${analytics.remainingDays} 天`}
                icon={Clock}
                color="stone"
                trend="down"
                trendValue={`${((analytics.daysPassed/analytics.daysInMonth)*100).toFixed(0)}%`}
              />
              <KPICard 
                title="本月累積現金" 
                value={fmtMoney(analytics.grandTotal.cash)}
                subValue={`權責: ${fmtMoney(analytics.grandTotal.accrual)}`}
                icon={DollarSign}
                color="blue"
                trend="up"
                trendValue={`${analytics.totalAchievement.toFixed(1)}%`}
              />
              <KPICard 
                title="月底業績推估" 
                value={fmtMoney(analytics.grandTotal.projection)}
                subValue={`目標: ${fmtMoney(analytics.grandTotal.budget)}`}
                icon={Target}
                color={analytics.grandTotal.projection >= analytics.grandTotal.budget ? "green" : "orange"}
                trend={analytics.grandTotal.projection >= analytics.grandTotal.budget ? "up" : "down"}
                trendValue={analytics.grandTotal.projection >= analytics.grandTotal.budget ? "預期達標" : "落後"}
              />
              <KPICard 
                title="平均消耗客單" 
                value={fmtMoney(analytics.avgTrafficASP)}
                subValue={`目標: ${fmtMoney(targets.trafficASP || 0)}`}
                icon={Zap}
                color="cyan"
              />
              <KPICard 
                title="新客累積" 
                value={`${fmtNum(analytics.grandTotal.newCustomers)}`}
                subValue="人"
                icon={Award}
                color="pink"
              />
            </div>

            {analytics.dailyTotals.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2 p-6">
                    <h3 className="text-lg font-bold text-stone-800 mb-6 flex items-center gap-2">
                    <TrendingUp size={18} className="text-indigo-500" />
                    日業績與來客走勢
                    </h3>
                    <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={analytics.dailyTotals}>
                        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                        <XAxis dataKey="date" stroke="#a8a29e" tick={{fontSize: 12, fill: '#78716c'}} />
                        <YAxis yAxisId="left" stroke="#a8a29e" tick={{fontSize: 12, fill: '#78716c'}} />
                        <YAxis yAxisId="right" orientation="right" stroke="#a8a29e" tick={{fontSize: 12, fill: '#78716c'}} />
                        <RechartsTooltip 
                            contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e7e5e4', color: '#44403c', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                        />
                        <Legend wrapperStyle={{paddingTop: '20px'}} />
                        <Area yAxisId="left" type="monotone" dataKey="cash" name="現金業績" fill="#818cf8" fillOpacity={0.2} stroke="#6366f1" strokeWidth={2} />
                        <Bar yAxisId="left" dataKey="accrual" name="權責業績" fill="#c7d2fe" barSize={20} radius={[4, 4, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="traffic" name="進店人數" stroke="#10b981" strokeWidth={2} dot={{r: 4, fill: '#10b981'}} />
                        </ComposedChart>
                    </ResponsiveContainer>
                    </div>
                </Card>

                <Card className="p-6">
                    <h3 className="text-lg font-bold text-stone-800 mb-4">預算達成率 Top 5</h3>
                    <div className="space-y-5">
                    {[...analytics.storeList].sort((a, b) => b.achievement - a.achievement).slice(0, 5).map((store, idx) => (
                        <div key={store.name} className="flex items-center justify-between group hover:bg-stone-50 p-2 rounded-lg transition-colors -mx-2">
                        <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-sm ${idx === 0 ? 'bg-amber-100 text-amber-700' : idx === 1 ? 'bg-stone-200 text-stone-600' : idx === 2 ? 'bg-orange-100 text-orange-700' : 'bg-stone-100 text-stone-400'}`}>
                            {idx + 1}
                            </div>
                            <div>
                            <p className="text-sm font-medium text-stone-700">{store.name}</p>
                            <p className="text-xs text-stone-400 font-mono">{fmtMoney(store.cashTotal)}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className={`text-sm font-bold font-mono ${store.achievement >= 100 ? 'text-emerald-600' : 'text-indigo-600'}`}>
                            {store.achievement.toFixed(1)}%
                            </p>
                            <div className="w-24 h-2 bg-stone-100 rounded-full mt-1 overflow-hidden">
                            <div 
                                className={`h-full rounded-full transition-all duration-500 ${store.achievement >= 100 ? 'bg-emerald-400' : 'bg-indigo-400'}`} 
                                style={{width: `${Math.min(store.achievement, 100)}%`}}
                            />
                            </div>
                        </div>
                        </div>
                    ))}
                    </div>
                    
                    <div className="mt-8 pt-6 border-t border-stone-100">
                    <h4 className="text-sm font-medium text-stone-500 mb-2">全品牌進度</h4>
                    <div className="flex justify-between items-end mb-2">
                        <span className="text-2xl font-bold text-stone-800 font-mono">{analytics.totalAchievement.toFixed(1)}%</span>
                        <span className="text-xs text-stone-400">目標 100%</span>
                    </div>
                    <div className="w-full h-3 bg-stone-200 rounded-full overflow-hidden shadow-inner">
                        <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{width: `${Math.min(analytics.totalAchievement, 100)}%`}} />
                    </div>
                    </div>
                </Card>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center p-12 bg-stone-100 rounded-xl border border-stone-200 text-stone-400">
                    <TrendingUp size={48} className="mb-4 opacity-50" />
                    <p className="text-lg font-medium">資料庫尚無數據</p>
                    <p className="text-sm">請前往「輸入」分頁上傳第一筆日報</p>
                </div>
            )}
            
            {/* KPI Charts... (省略重複部分，保持既有邏輯) */}
            {analytics.dailyTotals.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                   {/* 新客客單 */}
                    <Card className="p-6">
                        <h3 className="text-md font-bold text-stone-800 mb-2 flex items-center gap-2">
                        <Award size={16} className="text-pink-500" />
                        新客質量分析
                        </h3>
                         <p className="text-stone-400 text-xs mb-4 flex items-center gap-2">
                            目標
                            <span className="flex items-center gap-1 text-amber-500 font-bold bg-amber-50 px-1 rounded">
                                {fmtMoney(targets.newASP || 0)}
                            </span>
                        </p>
                        <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={[...analytics.storeList].sort((a,b) => b.newCustomerASP - a.newCustomerASP).slice(0, 7)} layout="vertical">
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={80} tick={{fontSize: 10, fill: '#78716c'}} />
                                <Bar dataKey="newCustomerASP" radius={[0, 4, 4, 0]}>
                                    {
                                        [...analytics.storeList].sort((a,b) => b.newCustomerASP - a.newCustomerASP).slice(0, 7).map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.newCustomerASP >= (targets.newASP || 0) ? '#f59e0b' : '#f472b6'} />
                                        ))
                                    }
                                </Bar>
                                <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{backgroundColor: '#fff', borderColor: '#e7e5e4'}} />
                            </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>
                    
                     {/* 消耗客單 */}
                    <Card className="p-6">
                        <h3 className="text-md font-bold text-stone-800 mb-2 flex items-center gap-2">
                        <Zap size={16} className="text-cyan-500" />
                        消耗客單分析
                        </h3>
                        <p className="text-stone-400 text-xs mb-4 flex items-center gap-2">
                            目標
                            <span className="text-cyan-600 bg-cyan-50 px-1 rounded font-bold">{fmtMoney(targets.trafficASP || 0)}</span>
                        </p>
                        <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={[...analytics.storeList].sort((a,b) => b.trafficASP - a.trafficASP).slice(0, 7)} layout="vertical">
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={80} tick={{fontSize: 10, fill: '#78716c'}} />
                                <Bar dataKey="trafficASP" radius={[0, 4, 4, 0]}>
                                    {
                                        [...analytics.storeList].sort((a,b) => b.trafficASP - a.trafficASP).slice(0, 7).map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.trafficASP >= (targets.trafficASP || 0) ? '#06b6d4' : '#94a3b8'} />
                                        ))
                                    }
                                </Bar>
                                <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{backgroundColor: '#fff', borderColor: '#e7e5e4'}} />
                            </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>

                    {/* 落後警示 */}
                    <Card className="p-6">
                        <h3 className="text-md font-bold text-stone-800 mb-2 flex items-center gap-2">
                        <AlertCircle size={16} className="text-rose-500" />
                        落後門市 ({'<'} 80%)
                        </h3>
                        <div className="overflow-auto h-52 pr-2 custom-scrollbar">
                            <table className="w-full text-left text-sm">
                            <thead className="text-xs text-stone-400 uppercase bg-stone-50 sticky top-0">
                                <tr>
                                <th className="py-2 pl-2">店名</th>
                                <th className="py-2 text-right">目前</th>
                                <th className="py-2 text-right pr-2">缺口</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {[...analytics.storeList].filter(s => s.achievement < 80).sort((a, b) => a.achievement - b.achievement).map(store => (
                                <tr key={store.name} className="hover:bg-stone-50">
                                    <td className="py-2 pl-2 text-stone-600">{store.name}</td>
                                    <td className="py-2 text-right font-mono text-rose-500 font-bold">{store.achievement.toFixed(0)}%</td>
                                    <td className="py-2 text-right pr-2 font-mono text-stone-400">
                                    {fmtMoney(store.cashBudget - store.cashTotal)}
                                    </td>
                                </tr>
                                ))}
                            </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}
          </div>
        )}

        {/* AUDIT VIEW */}
        {activeTab === 'audit' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Card className="p-6">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
                        <div className="flex items-center gap-3">
                            <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
                                <ClipboardCheck size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-stone-800">日報上傳檢核</h3>
                                <p className="text-sm text-stone-500">雲端即時監控回報狀況</p>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-stone-600">日期：</span>
                            <select 
                                value={auditDate} 
                                onChange={(e) => setAuditDate(e.target.value)}
                                className="px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-stone-800 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                {analytics.allDates.length > 0 ? (
                                    analytics.allDates.map(d => <option key={d} value={d}>{d}</option>)
                                ) : (
                                    <option value="">無資料</option>
                                )}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="p-4 bg-stone-50 rounded-xl border border-stone-100 flex flex-col items-center">
                            <span className="text-sm text-stone-500 mb-1">應回報</span>
                            <span className="text-3xl font-bold text-stone-800">{STORE_LIST.length}</span>
                        </div>
                        <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 flex flex-col items-center">
                            <span className="text-sm text-emerald-600 mb-1">已完成</span>
                            <span className="text-3xl font-bold text-emerald-600">{auditResult.submitted.length}</span>
                        </div>
                        <div className="p-4 bg-rose-50 rounded-xl border border-rose-100 flex flex-col items-center">
                            <span className="text-sm text-rose-600 mb-1">未回報</span>
                            <span className="text-3xl font-bold text-rose-600">{auditResult.missing.length}</span>
                        </div>
                    </div>

                    <div className="mb-6">
                        <div className="flex justify-between text-xs text-stone-500 mb-1">
                            <span>回報率</span>
                            <span>{auditResult.percentage.toFixed(0)}%</span>
                        </div>
                        <div className="w-full h-3 bg-stone-100 rounded-full overflow-hidden">
                            <div 
                                className={`h-full transition-all duration-500 ${auditResult.percentage === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} 
                                style={{width: `${auditResult.percentage}%`}} 
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="border border-rose-100 rounded-xl overflow-hidden">
                            <div className="bg-rose-50 p-4 border-b border-rose-100 flex justify-between items-center">
                                <h4 className="font-bold text-rose-700 flex items-center gap-2">
                                    <XCircle size={18} />
                                    未回報 ({auditResult.missing.length})
                                </h4>
                                {auditResult.missing.length > 0 && (
                                    <button 
                                        onClick={() => {
                                            const text = `[${auditDate}] 未回報店家：\n${auditResult.missing.join('、')}`;
                                            navigator.clipboard.writeText(text);
                                            alert("名單已複製！");
                                        }}
                                        className="text-xs bg-white text-rose-600 px-3 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 font-medium flex items-center gap-1 transition-colors"
                                    >
                                        <Copy size={12} /> 複製
                                    </button>
                                )}
                            </div>
                            <div className="p-4 bg-white min-h-[200px] max-h-[400px] overflow-y-auto">
                                <div className="flex flex-wrap gap-2">
                                    {auditResult.missing.map(store => (
                                        <span key={store} className="px-3 py-1 bg-rose-50 text-rose-700 text-sm rounded-full border border-rose-100">
                                            {store}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="border border-emerald-100 rounded-xl overflow-hidden">
                             <div className="bg-emerald-50 p-4 border-b border-emerald-100">
                                <h4 className="font-bold text-emerald-700 flex items-center gap-2">
                                    <CheckCircle size={18} />
                                    已回報 ({auditResult.submitted.length})
                                </h4>
                            </div>
                            <div className="p-4 bg-white min-h-[200px] max-h-[400px] overflow-y-auto">
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {auditResult.submitted.map(store => (
                                        <span key={store} className="text-sm text-emerald-800 flex items-center gap-1.5">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                                            {store}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>
        )}

        {/* REGIONAL VIEW */}
        {activeTab === 'regional' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Card className="p-6">
                    <h3 className="text-lg font-bold text-stone-800 mb-6 flex items-center gap-2">
                        <Map size={18} className="text-indigo-500" />
                        區長業績貢獻比較
                    </h3>
                    <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={analytics.regionalStats} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={COLORS.grid} />
                                <XAxis type="number" stroke="#a8a29e" tick={{fontSize: 12}} />
                                <YAxis dataKey="manager" type="category" width={60} stroke="#78716c" tick={{fontSize: 14, fontWeight: 'bold', fill: '#44403c'}} />
                                <RechartsTooltip 
                                    contentStyle={{ backgroundColor: '#fff', borderColor: '#e7e5e4', color: '#44403c' }} 
                                    formatter={(value) => fmtMoney(value)}
                                />
                                <Legend />
                                <Bar dataKey="cashTotal" name="總現金業績" radius={[0, 6, 6, 0]}>
                                    {analytics.regionalStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#10b981'][index % 5]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {analytics.regionalStats.map((region) => (
                        <Card key={region.manager} className="p-0 border-t-4 border-t-indigo-400">
                            <div className="p-5 bg-stone-50/50">
                                <div className="flex justify-between items-start mb-4">
                                    <h3 className="text-xl font-bold text-stone-800 flex items-center gap-2">
                                        <Award size={20} className="text-amber-500" />
                                        {region.manager} 區
                                    </h3>
                                    <span className={`px-2 py-1 rounded text-xs font-bold border ${region.achievement >= 100 ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-indigo-50 text-indigo-600 border-indigo-200'}`}>
                                        {region.achievement.toFixed(1)}% 達成
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-4 mb-2">
                                    <div>
                                        <p className="text-stone-400 text-xs">現金業績</p>
                                        <p className="text-lg font-bold text-stone-700 font-mono">{fmtMoney(region.cashTotal)}</p>
                                    </div>
                                    <div>
                                        <p className="text-stone-400 text-xs">管理店數</p>
                                        <p className="text-lg font-bold text-stone-700 font-mono">{region.storeCount} 間</p>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            </div>
        )}

        {/* RANKING VIEW */}
        {activeTab === 'ranking' && (
          <Card className="overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
              <h3 className="text-lg font-bold text-stone-800">全店詳細數據表</h3>
              <div className="text-sm text-stone-500">
                統計至：<span className="font-mono">{analytics.latestDate}</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-stone-600">
                <thead className="text-xs text-stone-500 uppercase bg-stone-100 font-bold tracking-wider">
                  <tr>
                    <th className="px-6 py-4">店名</th>
                    <th className="px-6 py-4 text-right">累積現金</th>
                    <th className="px-6 py-4 text-right">目標達成率</th>
                    <th className="px-6 py-4 text-right">月底推估</th>
                    <th className="px-6 py-4 text-right">平均消耗</th>
                    <th className="px-6 py-4 text-right">累積權責</th>
                    <th className="px-6 py-4 text-right">累積進店</th>
                    <th className="px-6 py-4 text-right">累積新客</th>
                    <th className="px-6 py-4 text-right">新客客單</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 bg-white">
                  {[...analytics.storeList].sort((a,b) => b.cashTotal - a.cashTotal).map((store, index) => (
                    <tr key={store.name} className={`hover:bg-indigo-50/30 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-stone-50/30'}`}>
                      <td className="px-6 py-4 font-bold text-stone-700">{store.name}</td>
                      <td className="px-6 py-4 text-right font-mono text-indigo-600 font-medium">{fmtMoney(store.cashTotal)}</td>
                      <td className="px-6 py-4 text-right font-mono">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${store.achievement >= 100 ? 'bg-emerald-100 text-emerald-700' : store.achievement >= 80 ? 'bg-indigo-50 text-indigo-700' : 'bg-stone-100 text-stone-500'}`}>
                          {store.achievement.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-stone-500">{fmtMoney(store.projection)}</td>
                      <td className="px-6 py-4 text-right font-mono text-cyan-600 font-bold">{fmtMoney(store.trafficASP)}</td>
                      <td className="px-6 py-4 text-right font-mono">{fmtMoney(store.accrualTotal)}</td>
                      <td className="px-6 py-4 text-right font-mono">{fmtNum(store.trafficTotal)}</td>
                      <td className="px-6 py-4 text-right font-mono">{fmtNum(store.newCustomersTotal)}</td>
                      <td className="px-6 py-4 text-right font-mono text-rose-500">{fmtMoney(store.newCustomerASP)}</td>
                    </tr>
                  ))}
                  <tr className="bg-stone-100 font-bold text-stone-800 border-t-2 border-stone-200">
                    <td className="px-6 py-4">總計</td>
                    <td className="px-6 py-4 text-right font-mono text-indigo-700">{fmtMoney(analytics.grandTotal.cash)}</td>
                    <td className="px-6 py-4 text-right font-mono">{analytics.totalAchievement.toFixed(1)}%</td>
                    <td className="px-6 py-4 text-right font-mono">{fmtMoney(analytics.grandTotal.projection)}</td>
                    <td className="px-6 py-4 text-right font-mono text-cyan-700">{fmtMoney(analytics.avgTrafficASP)}</td>
                    <td className="px-6 py-4 text-right font-mono">{fmtMoney(analytics.grandTotal.accrual)}</td>
                    <td className="px-6 py-4 text-right font-mono">{fmtNum(analytics.grandTotal.traffic)}</td>
                    <td className="px-6 py-4 text-right font-mono">{fmtNum(analytics.grandTotal.newCustomers)}</td>
                    <td className="px-6 py-4 text-right font-mono">-</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* SETTINGS VIEW */}
        {activeTab === 'settings' && (
          <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Card className="p-8">
              <h3 className="text-xl font-bold text-stone-800 mb-6 flex items-center gap-2">
                <Target className="text-indigo-500" />
                全域 KPI 目標設定 (即時同步)
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-2">新客客單價目標 (ASP)</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-stone-400 pointer-events-none">$</span>
                    <input
                      type="number"
                      value={targets.newASP}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTargets(prev => ({...prev, newASP: val}));
                        saveGlobalTargets(val, targets.trafficASP);
                      }}
                      className="w-full pl-8 pr-4 py-3 bg-stone-50 border border-stone-300 rounded-lg text-stone-800 font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-2">平均消耗客單目標 (Traffic ASP)</label>
                  <div className="relative">
                     <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-stone-400 pointer-events-none">$</span>
                    <input
                      type="number"
                      value={targets.trafficASP}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTargets(prev => ({...prev, trafficASP: val}));
                        saveGlobalTargets(targets.newASP, val);
                      }}
                      className="w-full pl-8 pr-4 py-3 bg-stone-50 border border-stone-300 rounded-lg text-stone-800 font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-8">
              <h3 className="text-xl font-bold text-stone-800 mb-4 flex items-center gap-2">
                <DollarSign className="text-indigo-500" />
                門市月目標匯入
              </h3>
              <p className="text-stone-500 mb-6 text-sm leading-relaxed">
                更新資料將直接寫入雲端資料庫，所有使用者將立即看到變更。
              </p>
              
              <div className="bg-stone-50 p-4 rounded-lg border border-stone-200 mb-4 font-mono text-xs text-stone-500 shadow-inner">
                 <p className="font-bold text-stone-600 mb-2">格式範例 (可直接貼上)：</p>
                 <div className="pl-4 border-l-2 border-indigo-200">
                    <p>CYJ板橋店</p>
                    <p>現金目標：800,000</p>
                    <p>權責目標：750,000</p>
                 </div>
              </div>

              <textarea 
                className="w-full h-64 bg-white border border-stone-300 rounded-lg p-4 text-stone-800 font-mono focus:ring-2 focus:ring-indigo-500 outline-none mb-6 shadow-sm resize-none"
                placeholder="請在此貼上..."
                value={budgetInputText}
                onChange={(e) => setBudgetInputText(e.target.value)}
              />

              <div className="flex justify-end gap-4">
                <button 
                  onClick={() => setBudgetInputText(`CYJ板橋店\n現金目標：900,000\n權責目標：800,000`)}
                  className="px-6 py-2 rounded-lg text-stone-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors font-medium"
                >
                  載入範本
                </button>
                <button 
                  onClick={handleBudgetParse}
                  disabled={isUploading}
                  className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-stone-400 text-white rounded-lg font-bold shadow-lg shadow-indigo-200 transition-all flex items-center gap-2"
                >
                  {isUploading && <Loader2 className="animate-spin" size={18} />}
                  更新至雲端
                </button>
              </div>
            </Card>
          </div>
        )}

        {/* INPUT FORM VIEW */}
        {activeTab === 'input' && (
          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="lg:col-span-2 space-y-6">
              <Card className="p-8">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-stone-100">
                  <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
                    <Upload size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-stone-800">日報資料輸入</h3>
                    <p className="text-sm text-stone-500">資料將暫存於右側清單，確認無誤後再上傳至雲端。</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-stone-600 mb-2">1. 日期</label>
                    <div className="flex items-center gap-3">
                      <input 
                        type="date" 
                        value={inputDate}
                        max={getTodayString()}
                        onChange={(e) => setInputDate(e.target.value)}
                        className="flex-1 px-4 py-3 bg-stone-50 border border-stone-300 rounded-lg text-stone-800 outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <div className="px-4 py-3 bg-indigo-50 text-indigo-700 rounded-lg font-mono font-medium border border-indigo-100 min-w-[120px] text-center">
                        民國 {formatROCDate(inputDate).split('/')[0]} 年
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-2">2. 區長</label>
                    <select 
                      value={selectedManager} 
                      onChange={(e) => {
                        setSelectedManager(e.target.value);
                        setSelectedStore("");
                      }}
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-300 rounded-lg text-stone-800 outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">-- 請選擇 --</option>
                      {Object.keys(REGIONAL_MANAGERS).map(m => (
                        <option key={m} value={m}>{m} 區</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-2">3. 店家</label>
                    <select 
                      value={selectedStore} 
                      onChange={(e) => setSelectedStore(e.target.value)}
                      disabled={!selectedManager}
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-300 rounded-lg text-stone-800 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                    >
                      <option value="">-- {selectedManager ? '請選擇分店' : '請先選區長'} --</option>
                      {availableStores.map(store => (
                        <option key={store} value={store}>{store}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="bg-stone-50 p-6 rounded-xl border border-stone-200">
                  <h4 className="text-sm font-bold text-stone-700 mb-4 flex items-center gap-2">
                    <Zap size={16} className="text-amber-500" />
                    4. 鍵入數據
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="col-span-1">
                      <label className="text-xs font-medium text-stone-500 block mb-1">現金業績</label>
                      <input type="number" placeholder="0" value={formCash} onChange={(e) => setFormCash(e.target.value)} className="w-full px-3 py-2 bg-white border border-stone-300 rounded-md focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="col-span-1">
                      <label className="text-xs font-medium text-stone-500 block mb-1">權責業績</label>
                      <input type="number" placeholder="0" value={formAccrual} onChange={(e) => setFormAccrual(e.target.value)} className="w-full px-3 py-2 bg-white border border-stone-300 rounded-md focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="col-span-1">
                      <label className="text-xs font-medium text-stone-500 block mb-1">進店數</label>
                      <input type="number" placeholder="0" value={formTraffic} onChange={(e) => setFormTraffic(e.target.value)} className="w-full px-3 py-2 bg-white border border-stone-300 rounded-md focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="col-span-1">
                      <label className="text-xs font-medium text-stone-500 block mb-1">新客數</label>
                      <input type="number" placeholder="0" value={formNewCustomers} onChange={(e) => setFormNewCustomers(e.target.value)} className="w-full px-3 py-2 bg-white border border-stone-300 rounded-md focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="col-span-1 md:col-span-2">
                      <label className="text-xs font-medium text-stone-500 block mb-1">新客締結金額</label>
                      <input type="number" placeholder="0" value={formNewSales} onChange={(e) => setFormNewSales(e.target.value)} className="w-full px-3 py-2 bg-white border border-stone-300 rounded-md focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button 
                    onClick={handleAddToPending}
                    className="px-6 py-3 bg-stone-800 hover:bg-stone-700 text-white rounded-lg font-bold flex items-center gap-2 transition-all transform hover:-translate-y-0.5 shadow-md"
                  >
                    <Plus size={18} />
                    加入待上傳清單
                  </button>
                </div>
              </Card>
            </div>

            <div className="lg:col-span-1 space-y-6">
              <Card className="h-full flex flex-col">
                <div className="p-6 border-b border-stone-100 bg-stone-50">
                  <h3 className="font-bold text-stone-800 flex items-center gap-2">
                    <Cloud size={18} className="text-indigo-500" />
                    待上傳至雲端 ({pendingEntries.length})
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[500px]">
                  {pendingEntries.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-stone-400 text-sm py-10">
                      <p>清單為空</p>
                      <p>請先新增資料</p>
                    </div>
                  ) : (
                    pendingEntries.map((entry, idx) => (
                      <div key={entry.id} className="bg-white border border-stone-200 rounded-lg p-3 shadow-sm relative group">
                        <button 
                          onClick={() => handleRemovePending(entry.id)}
                          className="absolute top-2 right-2 text-stone-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={16} />
                        </button>
                        <div className="flex justify-between items-start mb-2 pr-6">
                          <span className="font-bold text-stone-700 text-sm">{entry.storeName}</span>
                          <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-mono">{entry.date}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-y-1 text-xs text-stone-500">
                          <div>現: <span className="text-stone-800 font-mono">{fmtMoney(entry.cash)}</span></div>
                          <div>權: <span className="text-stone-800 font-mono">{fmtMoney(entry.accrual)}</span></div>
                          <div>進: <span className="text-stone-800 font-mono">{entry.traffic}</span></div>
                          <div>新: <span className="text-stone-800 font-mono">{entry.newCustomers}</span></div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="p-4 border-t border-stone-100 bg-stone-50">
                  <button 
                    onClick={handleSubmitAll}
                    disabled={pendingEntries.length === 0 || isUploading}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-300 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-colors shadow-md disabled:shadow-none"
                  >
                    {isUploading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                    {isUploading ? '資料上傳中...' : '確認上傳'}
                  </button>
                </div>
              </Card>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}