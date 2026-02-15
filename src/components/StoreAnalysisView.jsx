// src/components/StoreAnalysisView.jsx
import React, { useState, useEffect, useMemo, useContext } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from "recharts";
import { 
  Activity, Target, Users, Zap, Award, HelpCircle, AlertTriangle, 
  ArrowRight, TrendingDown, AlertCircle, ShoppingBag, ArrowLeft,
  DollarSign 
} from "lucide-react";

import { AppContext } from "../AppContext";
import { toStandardDateFormat, formatNumber } from "../utils/helpers";
import { ViewWrapper, Card } from "./SharedUI";

// 預設值
const DEFAULT_BENCHMARKS = {
  default: {
    financial: { min: 80, max: 120, label: "現權責比" }, 
    sales:     { min: 10, max: 45, label: "產品佔比" },
    loyalty:   { min: 50, max: 80, label: "舊客佔比" },
    mining:    { min: 80, max: 120, label: "舊客強度" },
    acquisition: { min: 80, max: 120, label: "新客含金" }
  },
  "安妞": {
    financial: { min: 70, max: 110, label: "現權責比" },
    sales:     { min: 10, max: 40, label: "產品佔比" }, 
    loyalty:   { min: 30, max: 60, label: "舊客佔比" },
    mining:    { min: 80, max: 120, label: "舊客強度" },
    acquisition: { min: 80, max: 120, label: "新客含金" }
  },
  "伊啵": {
    financial: { min: 70, max: 110, label: "現權責比" },
    sales:     { min: 10, max: 40, label: "產品佔比" }, 
    loyalty:   { min: 30, max: 60, label: "舊客佔比" },
    mining:    { min: 80, max: 120, label: "舊客強度" },
    acquisition: { min: 80, max: 120, label: "新客含金" }
  }
};

const StoreAnalysisView = () => {
  const {
    rawData,
    budgets,
    managers,
    targets, 
    selectedYear,
    selectedMonth,
    fmtMoney,
    fmtNum,
    currentUser,
    userRole,
    activeView,
    currentBrand,
  } = useContext(AppContext);

  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [showBenchmark, setShowBenchmark] = useState(true);

  // 1. 定義品牌前綴與識別 ID
  const { brandPrefix, brandId } = useMemo(() => {
    let name = "CYJ";
    let id = "default"; 

    if (currentBrand) {
      const rawId = typeof currentBrand === 'string' ? currentBrand : (currentBrand.id || "CYJ");
      const normalizedId = rawId.toLowerCase();
      
      if (normalizedId.includes("anniu") || normalizedId.includes("anew")) {
        name = "安妞";
        id = "安妞";
      } else if (normalizedId.includes("yibo")) {
        name = "伊啵";
        id = "伊啵";
      } else {
        name = "CYJ";
        id = "default";
      }
    }
    return { brandPrefix: name, brandId: id };
  }, [currentBrand]);

  // 2. 讀取設定
  const currentBenchmarks = useMemo(() => {
    const dbBenchmarks = targets?.benchmarks || {};
    const config = dbBenchmarks[brandId] || dbBenchmarks["default"] || DEFAULT_BENCHMARKS[brandId] || DEFAULT_BENCHMARKS["default"];
    
    return {
       financial: { ...DEFAULT_BENCHMARKS.default.financial, ...config?.financial },
       sales: { ...DEFAULT_BENCHMARKS.default.sales, ...config?.sales },
       loyalty: { ...DEFAULT_BENCHMARKS.default.loyalty, ...config?.loyalty },
       mining: { ...DEFAULT_BENCHMARKS.default.mining, ...config?.mining },
       acquisition: { ...DEFAULT_BENCHMARKS.default.acquisition, ...config?.acquisition },
    };
  }, [brandId, targets]);

  const isManagementRole = userRole === "director" || userRole === "trainer" || userRole === "manager";

  // 3. 找出屬於當前品牌的區長 (Reverse Lookup)
  const targetBrandManagers = useMemo(() => {
    if (!managers) return [];
    
    if (brandId === 'default') {
        return Object.keys(managers).filter(mgr => {
             const stores = managers[mgr] || [];
             const isSideBrand = stores.some(s => /安妞|Anew|伊啵|Yibo/i.test(s));
             return !isSideBrand;
        });
    }

    const detectedManagers = new Set();
    Object.keys(managers).forEach(mgr => {
        const stores = managers[mgr] || [];
        const match = brandId === '安妞' 
            ? stores.some(s => /安妞|Anew|Ann/i.test(s))
            : stores.some(s => /伊啵|Yibo/i.test(s));
        if (match) detectedManagers.add(mgr);
    });

    if (detectedManagers.size === 0 && rawData) {
        rawData.forEach(d => {
            const name = d.storeName;
            const isTarget = brandId === '安妞' 
                ? /安妞|Anew|Ann/i.test(name)
                : /伊啵|Yibo/i.test(name);
            
            if (isTarget) {
                const core = name.replace(/^(CYJ|安妞|伊啵|Anew|Yibo|Ann)\s*/i, "").replace(/店$/, "").trim();
                Object.keys(managers).forEach(mgr => {
                    const stores = managers[mgr] || [];
                    if (stores.some(s => s.includes(core))) {
                        detectedManagers.add(mgr);
                    }
                });
            }
        });
    }

    if (detectedManagers.size === 0) {
        return Object.keys(managers);
    }

    return Array.from(detectedManagers);
  }, [managers, brandId, rawData]);

  // 初始化選單
  useEffect(() => {
    if (activeView === "store-analysis") {
        if (userRole === "store" && currentUser) {
            const myStore = currentUser.stores?.[0] || currentUser.storeName;
            const coreName = myStore.replace(/^(CYJ|安妞|伊啵|Anew|Yibo|Ann)\s*/i, "").replace(/店$/, "").trim();
            const fullName = `${brandPrefix}${coreName}店`;
            setSelectedStore(fullName);
        } else if (userRole === "manager" && currentUser) {
            setSelectedManager(currentUser.name);
        }
    }
  }, [activeView, currentUser, userRole, brandPrefix]);

  useEffect(() => {
    const handleStoreNav = (e) => setSelectedStore(e.detail);
    window.addEventListener("navigate-to-store", handleStoreNav);
    return () => window.removeEventListener("navigate-to-store", handleStoreNav);
  }, []);

  // 4. 選單列表
  const availableStores = useMemo(() => {
    const formatStoreName = (s) => {
      let coreName = s.replace(/^(CYJ|安妞|伊啵|Anew|Yibo|Ann)\s*/i, "").replace(/店$/, "").trim();
      return `${brandPrefix}${coreName}店`;
    };

    if (userRole === "director" || userRole === "trainer") {
        if (selectedManager) return (managers[selectedManager] || []).map(formatStoreName);
        const allStores = targetBrandManagers.flatMap(mgr => managers[mgr] || []);
        return allStores.map(formatStoreName);
    }
        
    if (userRole === "manager")
      return Object.values(managers).flat().map(formatStoreName);
        
    if (userRole === "store" && currentUser)
      return (currentUser.stores || [currentUser.storeName]).map((s) => formatStoreName(s));
      
    return [];
  }, [selectedManager, managers, currentUser, userRole, brandPrefix, targetBrandManagers]);

  useEffect(() => {
    if (userRole === "store" && currentUser && availableStores.length > 0) {
       if (!selectedStore || !availableStores.includes(selectedStore)) {
          setSelectedStore(availableStores[0]);
       }
    }
  }, [currentUser, availableStores, selectedStore, userRole]);

  // ==========================================
  // ★★★ 5. 全局掃描引擎 ★★★
  // ==========================================
  const exceptionLists = useMemo(() => {
    if (!isManagementRole || !rawData) return null;

    let targetRawStores = [];
    
    if (userRole === 'manager' && currentUser) {
        targetRawStores = managers[currentUser.name] || [];
    } else if (userRole === 'director' || userRole === 'trainer') {
        targetRawStores = targetBrandManagers.flatMap(mgr => managers[mgr] || []);
    }

    if (targetRawStores.length === 0) return null;

    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;

    const storeStats = {};

    targetRawStores.forEach(s => {
        const coreName = s.replace(/^(CYJ|安妞|伊啵|Anew|Yibo|Ann)\s*/i, "").replace(/店$/, "").trim();
        let mgrName = "未分配";
        Object.entries(managers).forEach(([m, list]) => {
            if(list.includes(s)) mgrName = m;
        });

        storeStats[coreName] = {
            id: s,
            name: `${coreName}店`,
            manager: mgrName,
            cash: 0, accrual: 0, skincare: 0, traffic: 0, newCust: 0, newSales: 0, foundData: false 
        };
    });

    rawData.forEach(d => {
        if (!d.date) return;
        const parts = d.date.replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        if (!((y === targetYear || y === rocYear) && m === monthInt)) return;

        const dCore = d.storeName.replace(/^(CYJ|安妞|伊啵|Anew|Yibo|Ann)\s*/i, "").replace(/店$/, "").trim();
        
        if (storeStats[dCore]) {
            storeStats[dCore].foundData = true;
            storeStats[dCore].cash += (d.cash || 0) - (d.refund || 0);
            storeStats[dCore].accrual += (d.accrual || 0);
            storeStats[dCore].skincare += (d.skincareSales || 0);
            storeStats[dCore].traffic += (d.traffic || 0);
            storeStats[dCore].newCust += (d.newCustomers || 0);
            storeStats[dCore].newSales += (d.newCustomerSales || 0);
        }
    });

    const cfg = currentBenchmarks;
    const getThreshold = (val) => (val > 5 ? val / 100 : val); 

    const reportCards = Object.values(storeStats)
        .filter(s => s.foundData)
        .map(s => {
            const oldCust = Math.max(0, s.traffic - s.newCust);
            const cashToAccrual = s.accrual > 0 ? s.cash / s.accrual : 0;
            const productRatio = s.cash > 0 ? s.skincare / s.cash : 0;
            const retentionRate = s.traffic > 0 ? oldCust / s.traffic : 0;
            const newCustomerASP = s.newCust > 0 ? Math.round(s.newSales / s.newCust) : 0;
            const targetASP = targets.newASP || 3500;
            const acquisitionRate = targetASP > 0 ? newCustomerASP / targetASP : 0;

            return {
                ...s,
                cashToAccrual, productRatio, retentionRate, newCustomerASP, acquisitionRate
            };
        });

    const financialRisks = reportCards
        .filter(s => s.cashToAccrual < getThreshold(cfg.financial.min) && s.cash > 0) 
        .sort((a, b) => a.cashToAccrual - b.cashToAccrual); 

    const retentionRisks = reportCards
        .filter(s => s.retentionRate < (getThreshold(cfg.loyalty.min) - 0.1) && s.traffic > 10) 
        .sort((a, b) => a.retentionRate - b.retentionRate);

    const salesRisks = reportCards
        .filter(s => s.acquisitionRate < getThreshold(cfg.acquisition.min) && s.newCust > 0) 
        .sort((a, b) => a.acquisitionRate - b.acquisitionRate); 

    return { financialRisks, retentionRisks, salesRisks };

  }, [rawData, userRole, currentUser, managers, isManagementRole, targets, currentBenchmarks, targetBrandManagers, selectedYear, selectedMonth]);


  // ==========================================
  // 單店運算
  // ==========================================
  
  const calculateHealthMetrics = (dataList) => {
    if (!dataList || dataList.length === 0) return null;

    const cash = dataList.reduce((a, b) => a + (b.cash || 0) - (b.refund || 0), 0);
    const accrual = dataList.reduce((a, b) => a + (b.accrual || 0), 0);
    const skincare = dataList.reduce((a, b) => a + (b.skincareSales || 0), 0);
    const traffic = dataList.reduce((a, b) => a + (b.traffic || 0), 0);
    const newCust = dataList.reduce((a, b) => a + (b.newCustomers || 0), 0);
    const newSales = dataList.reduce((a, b) => a + (b.newCustomerSales || 0), 0);
    
    const oldCust = Math.max(0, traffic - newCust);
    const oldSales = Math.max(0, cash - newSales);

    const rawMetrics = {
      cashToAccrual: accrual > 0 ? cash / accrual : 0,
      retailRatio: cash > 0 ? skincare / cash : 0,
      retention: traffic > 0 ? oldCust / traffic : 0,
      aspMining: (oldCust > 0 && newCust > 0 && (newSales/newCust) > 0) 
                 ? (oldSales / oldCust) / (newSales / newCust)
                 : 0,
      acquisitionQuality: (newCust > 0 && targets.newASP > 0) 
                          ? (newSales / newCust) / targets.newASP
                          : 0
    };

    const normalize = (val, min, max) => {
      const nMin = min > 5 ? min / 100 : min;
      const nMax = max > 5 ? max / 100 : max;

      if (val <= nMin) return 60 * (val / nMin);
      if (val >= nMax) return 100;
      return 60 + ((val - nMin) / (nMax - nMin)) * 40;
    };

    const cfg = currentBenchmarks;

    const scores = {
      financial: normalize(rawMetrics.cashToAccrual, cfg.financial.min, cfg.financial.max),
      sales: normalize(rawMetrics.retailRatio, cfg.sales.min, cfg.sales.max),
      loyalty: normalize(rawMetrics.retention, cfg.loyalty.min, cfg.loyalty.max),
      mining: normalize(rawMetrics.aspMining, cfg.mining.min, cfg.mining.max),
      acquisition: normalize(rawMetrics.acquisitionQuality, cfg.acquisition.min, cfg.acquisition.max)
    };

    return { raw: rawMetrics, scores };
  };

  const storeMetrics = useMemo(() => {
    if (!selectedStore) return null;
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;

    const targetCoreName = selectedStore.replace(/^(CYJ|安妞|伊啵|Anew|Yibo|Ann)\s*/i, "").replace(/店$/, "").trim();

    const data = rawData.filter((d) => {
        if (!d.date) return false;
        const parts = d.date.replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        if (!((y === targetYear || y === rocYear) && m === monthInt)) return false;

        const dCoreName = d.storeName.replace(/^(CYJ|安妞|伊啵|Anew|Yibo|Ann)\s*/i, "").replace(/店$/, "").trim();
        return dCoreName === targetCoreName;
    }).sort((a, b) => toStandardDateFormat(a.date).localeCompare(toStandardDateFormat(b.date)));

    const grossCash = data.reduce((a, b) => a + (b.cash || 0), 0);
    const totalRefund = data.reduce((a, b) => a + (b.refund || 0), 0);
    const totalCash = grossCash - totalRefund;
    const totalTraffic = data.reduce((a, b) => a + (b.traffic || 0), 0);
    const totalOpAccrual = data.reduce((a, b) => a + (b.operationalAccrual || 0), 0);
    const totalNewCustomers = data.reduce((a, b) => a + (b.newCustomers || 0), 0);
    const totalNewCustomerSales = data.reduce((a, b) => a + (b.newCustomerSales || 0), 0);
    const totalNewCustomerClosings = data.reduce((a, b) => a + (b.newCustomerClosings || 0), 0);
    const budget = budgets[`${selectedStore}_${targetYear}_${monthInt}`]?.cashTarget || 0;

    const health = calculateHealthMetrics(data);

    return {
      totalCash,
      achievement: budget > 0 ? (totalCash / budget) * 100 : 0,
      trafficASP: totalTraffic > 0 ? Math.round(totalOpAccrual / totalTraffic) : 0,
      newCustomerASP: totalNewCustomers > 0 ? Math.round(totalNewCustomerSales / totalNewCustomers) : 0,
      totalNewCustomerClosings,
      totalRefund,
      dailyData: data.map((d) => ({
        date: toStandardDateFormat(d.date).split("/")[2],
        cash: (d.cash || 0) - (d.refund || 0),
        accrual: d.accrual || 0,
        traffic: d.traffic,
      })),
      budget,
      health
    };
  }, [selectedStore, selectedYear, selectedMonth, rawData, budgets, targets, currentBenchmarks]);

  const benchmarkMetrics = useMemo(() => {
    if (!showBenchmark) return null;
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;

    const validCores = new Set();
    const relevantManagers = (userRole === 'manager' && selectedManager) 
        ? [selectedManager] 
        : targetBrandManagers;

    relevantManagers.forEach(mgr => {
        (managers[mgr] || []).forEach(s => {
            const core = s.replace(/^(CYJ|安妞|伊啵|Anew|Yibo|Ann)\s*/i, "").replace(/店$/, "").trim();
            if(core) validCores.add(core);
        });
    });

    let benchmarkStores = rawData.filter(d => {
        const core = d.storeName.replace(/^(CYJ|安妞|伊啵|Anew|Yibo|Ann)\s*/i, "").replace(/店$/, "").trim();
        return validCores.has(core);
    });

    const benchmarkData = benchmarkStores.filter(d => {
        if (!d.date) return false;
        const parts = d.date.replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        return (y === targetYear || y === rocYear) && m === monthInt;
    }).filter(d => d.storeName !== selectedStore); 

    return calculateHealthMetrics(benchmarkData);
  }, [selectedYear, selectedMonth, rawData, managers, selectedManager, userRole, brandPrefix, showBenchmark, targets, selectedStore, currentBenchmarks, brandId, targetBrandManagers]);

  const radarData = useMemo(() => {
    if (!storeMetrics?.health) return [];
    const s = storeMetrics.health.scores;
    const b = benchmarkMetrics?.scores || { financial:0, sales:0, loyalty:0, mining:0, acquisition:0 };
    const cfg = currentBenchmarks;

    return [
      { subject: '財務健康', A: s.financial, B: b.financial, fullMark: 100, label: cfg.financial.label },
      { subject: '銷售結構', A: s.sales, B: b.sales, fullMark: 100, label: cfg.sales.label },
      { subject: '顧客黏著', A: s.loyalty, B: b.loyalty, fullMark: 100, label: cfg.loyalty.label },
      { subject: '客單挖掘', A: s.mining, B: b.mining, fullMark: 100, label: cfg.mining.label },
      { subject: '新客質量', A: s.acquisition, B: b.acquisition, fullMark: 100, label: cfg.acquisition.label },
    ];
  }, [storeMetrics, benchmarkMetrics, currentBenchmarks]);

  const AlertItem = ({ store, value, label, type, onClick, fmtMoney }) => (
    <div 
        onClick={() => onClick(store.id)}
        className="flex items-center justify-between p-3 hover:bg-stone-50 rounded-lg cursor-pointer group transition-colors border-b border-stone-100 last:border-0"
    >
        <div className="flex items-center gap-3">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                type === 'danger' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'
            }`}>!</span>
            <div>
                <h4 className="font-bold text-stone-700 text-sm group-hover:text-amber-600 transition-colors">{store.name}</h4>
                <p className="text-xs text-stone-400">{store.manager}區</p>
            </div>
        </div>
        <div className="text-right">
            <p className={`font-mono font-bold text-sm ${
                type === 'danger' ? 'text-rose-500' : 'text-amber-500'
            }`}>
                {type === 'currency' ? fmtMoney(value) : `${(value * 100).toFixed(0)}%`}
            </p>
            <p className="text-[10px] text-stone-400">{label}</p>
        </div>
        <ArrowRight size={14} className="text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );

  const handleJumpToStore = (fullStoreName) => {
    const formatStoreName = (s) => {
        let coreName = s.replace(/^(CYJ|安妞|伊啵|Anew|Yibo|Ann)\s*/i, "").replace(/店$/, "").trim();
        return `${brandPrefix}${coreName}店`;
    };
    setSelectedStore(formatStoreName(fullStoreName));
  };

  const cfg = currentBenchmarks;

  // 格式化顯示函數
  const formatThreshold = (val) => {
      const num = val > 5 ? val : val * 100;
      return `${num.toFixed(0)}%`;
  };

  return (
    <ViewWrapper>
      <div className="space-y-6">
        <Card title="門市體質診斷">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
            <div className="flex gap-3 w-full sm:w-auto items-center overflow-x-auto no-scrollbar">
              
              {selectedStore && isManagementRole && (
                <button 
                  onClick={() => setSelectedStore("")}
                  className="h-[42px] px-4 bg-stone-800 text-white rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-stone-700 transition-all shadow-sm whitespace-nowrap"
                >
                  <ArrowLeft size={16} />
                  看板
                </button>
              )}

              <select
                value={selectedManager}
                onChange={(e) => setSelectedManager(e.target.value)}
                disabled={userRole !== "director" && userRole !== "trainer"}
                className="h-[42px] px-4 border rounded-xl font-bold text-stone-700 outline-none focus:border-amber-400 bg-white flex-1 sm:flex-none min-w-[120px]"
              >
                <option value="">{userRole === "director" ? "全品牌" : "選擇區長"}</option>
                {targetBrandManagers.map((m) => (
                  <option key={m} value={m}>{m}區</option>
                ))}
              </select>
              
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="h-[42px] px-4 border rounded-xl font-bold text-stone-700 outline-none focus:border-amber-400 bg-white flex-1 sm:flex-none min-w-[140px]"
              >
                <option value="">選擇店家...</option>
                {availableStores.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            
            {selectedStore && (
                <div className="flex items-center gap-2 mt-2 sm:mt-0">
                <label className="flex items-center cursor-pointer relative">
                    <input type="checkbox" checked={showBenchmark} onChange={(e) => setShowBenchmark(e.target.checked)} className="sr-only peer" />
                    <div className="w-11 h-6 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-stone-500"></div>
                    <span className="ml-3 text-sm font-bold text-stone-500">
                        {userRole === 'manager' ? '顯示區域平均' : '顯示全區平均'}
                    </span>
                </label>
                </div>
            )}
          </div>
        </Card>

        {/* 異常監控看板 */}
        {!selectedStore && isManagementRole && exceptionLists ? (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="mb-4 flex items-center gap-2 text-stone-500">
                    <Activity size={20} />
                    <h3 className="font-bold">
                        {userRole === 'manager' ? `${currentUser.name}區` : brandPrefix} 體質異常監控 (本月)
                    </h3>
                    <span className="text-xs bg-stone-100 text-stone-400 px-2 py-1 rounded-lg">
                        套用標準：{brandId === 'default' ? '預設' : brandId} (及格線 {formatThreshold(cfg.financial.min)})
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* 1. 財務紅燈區 */}
                    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
                        <div className="p-4 bg-rose-50 border-b border-rose-100 flex justify-between items-center">
                            <h3 className="font-bold text-rose-800 flex items-center gap-2">
                                <AlertTriangle size={18} /> 財務健康紅燈區
                            </h3>
                            <span className="text-xs bg-rose-200 text-rose-800 px-2 py-0.5 rounded-full font-bold">
                                {exceptionLists.financialRisks.length} 間
                            </span>
                        </div>
                        {/* ★★★ 修改重點：增加 max-height (約5間店) 與 overflow-y-auto ★★★ */}
                        <div className="p-2 flex-1 min-h-[200px] max-h-[300px] overflow-y-auto no-scrollbar">
                            {exceptionLists.financialRisks.length > 0 ? (
                                exceptionLists.financialRisks.map(store => (
                                    <AlertItem 
                                        key={store.id} 
                                        store={store} 
                                        value={store.cashToAccrual} 
                                        label={cfg.financial.label} 
                                        type="percent"
                                        onClick={handleJumpToStore}
                                        fmtMoney={fmtMoney}
                                    />
                                ))
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-stone-400 opacity-50">
                                    <Award size={48} className="mb-2" />
                                    <p className="text-sm font-bold">財務體質全數健康</p>
                                </div>
                            )}
                        </div>
                        <div className="p-3 bg-stone-50 text-xs text-stone-400 text-center border-t border-stone-100">
                            篩選標準：{cfg.financial.label} &lt; {formatThreshold(cfg.financial.min)}
                        </div>
                    </div>

                    {/* 2. 留客警報區 */}
                    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
                        <div className="p-4 bg-amber-50 border-b border-amber-100 flex justify-between items-center">
                            <h3 className="font-bold text-amber-800 flex items-center gap-2">
                                <Users size={18} /> 顧客流失警報
                            </h3>
                            <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                                {exceptionLists.retentionRisks.length} 間
                            </span>
                        </div>
                        {/* ★★★ 修改重點：增加 max-height (約5間店) 與 overflow-y-auto ★★★ */}
                        <div className="p-2 flex-1 min-h-[200px] max-h-[300px] overflow-y-auto no-scrollbar">
                            {exceptionLists.retentionRisks.length > 0 ? (
                                exceptionLists.retentionRisks.map(store => (
                                    <AlertItem 
                                        key={store.id} 
                                        store={store} 
                                        value={store.retentionRate} 
                                        label={cfg.loyalty.label} 
                                        type="percent"
                                        onClick={handleJumpToStore}
                                        fmtMoney={fmtMoney}
                                    />
                                ))
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-stone-400 opacity-50">
                                    <Award size={48} className="mb-2" />
                                    <p className="text-sm font-bold">顧客黏著度良好</p>
                                </div>
                            )}
                        </div>
                        <div className="p-3 bg-stone-50 text-xs text-stone-400 text-center border-t border-stone-100">
                            篩選標準：{cfg.loyalty.label} &lt; {formatThreshold((cfg.loyalty.min > 5 ? cfg.loyalty.min / 100 : cfg.loyalty.min) - 0.1)}
                        </div>
                    </div>

                    {/* 3. 新客客單警示區 */}
                    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
                        <div className="p-4 bg-stone-100 border-b border-stone-200 flex justify-between items-center">
                            <h3 className="font-bold text-stone-700 flex items-center gap-2">
                                <DollarSign size={18} /> 新客達標率警示
                            </h3>
                            <span className="text-xs bg-stone-300 text-stone-800 px-2 py-0.5 rounded-full font-bold">
                                {exceptionLists.salesRisks.length} 間
                            </span>
                        </div>
                        {/* ★★★ 修改重點：增加 max-height (約5間店) 與 overflow-y-auto ★★★ */}
                        <div className="p-2 flex-1 min-h-[200px] max-h-[300px] overflow-y-auto no-scrollbar">
                            {exceptionLists.salesRisks.length > 0 ? (
                                exceptionLists.salesRisks.map(store => (
                                    <AlertItem 
                                        key={store.id} 
                                        store={store} 
                                        value={store.acquisitionRate} 
                                        label="目標達成率" 
                                        type="percent"
                                        onClick={handleJumpToStore}
                                        fmtMoney={fmtMoney}
                                    />
                                ))
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-stone-400 opacity-50">
                                    <Award size={48} className="mb-2" />
                                    <p className="text-sm font-bold">新客開發表現優異</p>
                                </div>
                            )}
                        </div>
                        <div className="p-3 bg-stone-50 text-xs text-stone-400 text-center border-t border-stone-100">
                            篩選標準：達成率 &lt; {formatThreshold(cfg.acquisition.min)}
                        </div>
                    </div>
                </div>
            </div>
        ) : null}

        {selectedStore && storeMetrics ? (
          <div className="animate-in fade-in slide-in-from-right-8 duration-500">
            {/* ... 下方的單店內容完全不變 ... */}
            <div className="flex flex-col xl:flex-row gap-6">
               
               <div className="w-full xl:w-1/3 bg-white rounded-2xl border border-stone-100 shadow-sm p-4 flex flex-col relative overflow-hidden">
                  
                  <div className="flex justify-between items-center mb-2">
                    <div>
                        <h3 className="font-bold text-stone-700 flex items-center gap-2"><Activity size={18} className="text-amber-500"/> 經營體質診斷</h3>
                        <p className="text-xs text-stone-400">Five-Force Store Analysis</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                              storeMetrics.health.scores.financial < 60 || storeMetrics.health.scores.loyalty < 60 || storeMetrics.health.scores.sales < 60
                              ? "bg-rose-50 text-rose-600 border-rose-100" 
                              : "bg-emerald-50 text-emerald-600 border-emerald-100"
                        }`}>
                             診斷：
                             {storeMetrics.health.scores.financial < 60 ? "需注意現金流" : 
                              storeMetrics.health.scores.loyalty < 60 ? "舊客流失風險" :
                              storeMetrics.health.scores.sales < 60 ? "產品銷售偏弱" : "體質健康"}
                        </span>

                        <div className="group relative">
                            <HelpCircle size={16} className="text-stone-300 cursor-help"/>
                            <div className="absolute right-0 w-64 p-3 bg-stone-800 text-white text-xs rounded-xl shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
                                <p className="font-bold mb-1">指標說明 (滿分基準)：</p>
                                <ul className="space-y-1 opacity-90">
                                    <li>• {cfg.financial.label}：{formatThreshold(cfg.financial.max)} (現金大於權責)</li>
                                    <li>• {cfg.sales.label}：{formatThreshold(cfg.sales.max)} (產品銷售佔比)</li>
                                    <li>• {cfg.loyalty.label}：{formatThreshold(cfg.loyalty.max)} (顧客留存度)</li>
                                    <li>• {cfg.mining.label}：{formatThreshold(cfg.mining.max)} (舊客單價 &gt; 新客)</li>
                                    <li>• {cfg.acquisition.label}：{formatThreshold(cfg.acquisition.max)} (大於目標客單)</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                  </div>

                  <div className="h-[350px] w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                            <PolarGrid stroke="#cbd5e1" />
                            <PolarAngleAxis dataKey="subject" tick={{ fill: '#78716c', fontSize: 12, fontWeight: 'bold' }} />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                            
                            {showBenchmark && (
                                <Radar
                                    name={userRole === 'manager' ? "區域平均" : "全區平均"}
                                    dataKey="B"
                                    stroke="#a8a29e"
                                    fill="#a8a29e"
                                    fillOpacity={0.1}
                                />
                            )}
                            
                            <Radar
                                name={selectedStore}
                                dataKey="A"
                                stroke="#f59e0b"
                                fill="#f59e0b"
                                fillOpacity={0.4}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}/>
                            <RechartsTooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} formatter={(val) => val.toFixed(0)}/>
                        </RadarChart>
                    </ResponsiveContainer>
                  </div>
               </div>

               <div className="w-full xl:w-2/3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
                  <div className="bg-white p-5 rounded-2xl border shadow-sm flex flex-col justify-between">
                    <div><p className="text-stone-400 text-xs font-bold mb-1">現金業績</p><h3 className="text-2xl font-bold text-stone-700">{fmtMoney(storeMetrics.totalCash)}</h3></div>
                    <p className={`text-sm font-bold mt-2 ${storeMetrics.achievement >= 100 ? "text-emerald-500" : "text-amber-500"}`}>{storeMetrics.achievement.toFixed(1)}% 達成</p>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">平均消耗客單</p>
                    <h3 className="text-2xl font-bold text-stone-700">{fmtMoney(storeMetrics.trafficASP)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">本月目標</p>
                    <h3 className="text-2xl font-bold text-stone-700">{fmtMoney(storeMetrics.budget)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">新客平均客單</p>
                    <h3 className="text-2xl font-bold text-stone-700">{fmtMoney(storeMetrics.newCustomerASP)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">總新客留單</p>
                    <h3 className="text-2xl font-bold text-stone-700">{fmtNum(storeMetrics.totalNewCustomerClosings)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">總退費金額</p>
                    <h3 className="text-2xl font-bold text-rose-500">{fmtMoney(storeMetrics.totalRefund)}</h3>
                  </div>
                  
                  <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100">
                    <p className="text-stone-400 text-xs font-bold mb-1">{cfg.financial.label} (體質)</p>
                    <h3 className={`text-xl font-bold font-mono ${storeMetrics.health.raw.cashToAccrual < getCalcThreshold(cfg.financial.min) ? 'text-rose-500' : 'text-stone-700'}`}>
                        {(storeMetrics.health.raw.cashToAccrual * 100).toFixed(0)}%
                    </h3>
                  </div>
                  <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100">
                    <p className="text-stone-400 text-xs font-bold mb-1">{cfg.sales.label} (銷售)</p>
                    <h3 className={`text-xl font-bold font-mono ${storeMetrics.health.raw.retailRatio < getCalcThreshold(cfg.sales.min) ? 'text-rose-500' : 'text-stone-700'}`}>
                        {(storeMetrics.health.raw.retailRatio * 100).toFixed(1)}%
                    </h3>
                  </div>
                  <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100">
                    <p className="text-stone-400 text-xs font-bold mb-1">{cfg.loyalty.label} (黏著)</p>
                    <h3 className="text-xl font-bold font-mono text-stone-700">
                        {(storeMetrics.health.raw.retention * 100).toFixed(1)}%
                    </h3>
                  </div>
               </div>
            </div>

            <Card
              title={`${selectedStore} 營運趨勢`}
              subtitle="長條：現金業績｜實線：權責業績｜虛線(右軸)：操作人數"
            >
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={storeMetrics.dailyData}
                    margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#78716c" }} axisLine={{ stroke: "#e7e5e4" }} tickLine={false} dy={10} />
                    <YAxis yAxisId="left" width={80} tickFormatter={(val) => val === 0 ? "0" : `$${(val / 1000).toFixed(0)}k`} tick={{ fontSize: 12, fill: "#f59e0b" }} axisLine={false} tickLine={false} label={{ value: "金額 (NT$)", angle: -90, position: "insideLeft", fill: "#d6d3d1", fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 12, fill: "#0ea5e9" }} axisLine={false} tickLine={false} label={{ value: "人數", angle: 90, position: "insideRight", fill: "#d6d3d1", fontSize: 10 }} />
                    <RechartsTooltip contentStyle={{ borderRadius: "16px", border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)", padding: "12px" }} formatter={(value, name) => { if (name === "課程操作人數") return [fmtNum(value), name]; return [fmtMoney(value), name]; }} labelStyle={{ color: "#78716c", marginBottom: "0.5rem", fontWeight: "bold" }} cursor={{ fill: "#f5f5f4", opacity: 0.6 }} />
                    <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ paddingBottom: "20px", fontSize: "12px", fontWeight: "bold" }} />
                    <Bar yAxisId="left" dataKey="cash" name="現金業績 (淨額)" fill="#fbbf24" radius={[4, 4, 0, 0]} barSize={20} fillOpacity={0.9} />
                    <Line yAxisId="left" type="monotone" dataKey="accrual" name="權責業績" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, fill: "#8b5cf6", strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6 }} />
                    <Line yAxisId="right" type="monotone" dataKey="traffic" name="課程操作人數" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: "#0ea5e9", strokeWidth: 2, stroke: "#fff" }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        ) : (
          !isManagementRole && (
            <div className="p-10 text-center text-stone-400 bg-stone-50 rounded-xl border border-stone-100">
               <p className="font-bold">請選擇區長與店家以查看報表</p>
            </div>
          )
        )}
      </div>
    </ViewWrapper>
  );
};

export default StoreAnalysisView;