// src/components/StoreAnalysisView.jsx
import React, { useState, useEffect, useMemo, useContext, useCallback } from "react";
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
    allReports,
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

  const cleanStoreName = useCallback((name) => {
    if (!name) return "";
    let core = String(name).replace(/^(CYJ|Anew\s*\(安妞\)|Yibo\s*\(伊啵\)|安妞|伊啵|Anew|Yibo|Ann)\s*/i, '').trim();
    if (core === "新店") return "新店"; 
    return core.replace(/店$/, '').trim();
  }, []);

  const isBrandMatch = useCallback((storeName, bId) => {
      const name = String(storeName || "");
      if (bId === '安妞') return /安妞|Anew|Ann/i.test(name);
      if (bId === '伊啵') return /伊啵|Yibo/i.test(name);
      return !(/安妞|Anew|伊啵|Yibo/i.test(name)); 
  }, []);

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

  const targetBrandManagers = useMemo(() => {
    const safeManagers = managers || {}; 
    
    if (brandId === 'default') {
        return Object.keys(safeManagers).filter(mgr => {
             const stores = safeManagers[mgr] || [];
             const isSideBrand = stores.some(s => /安妞|Anew|伊啵|Yibo/i.test(String(s || "")));
             return !isSideBrand;
        });
    }

    const detectedManagers = new Set();
    Object.keys(safeManagers).forEach(mgr => {
        const stores = safeManagers[mgr] || [];
        const match = brandId === '安妞' 
            ? stores.some(s => /安妞|Anew|Ann/i.test(String(s || "")))
            : stores.some(s => /伊啵|Yibo/i.test(String(s || "")));
        if (match) detectedManagers.add(mgr);
    });

    if (detectedManagers.size === 0 && rawData) {
        rawData.forEach(d => {
            const name = d.storeName || "";
            const isTarget = brandId === '安妞' 
                ? /安妞|Anew|Ann/i.test(String(name))
                : /伊啵|Yibo/i.test(String(name));
            
            if (isTarget) {
                const core = cleanStoreName(name);
                Object.keys(safeManagers).forEach(mgr => {
                    const stores = safeManagers[mgr] || [];
                    if (stores.some(s => cleanStoreName(s) === core)) {
                        detectedManagers.add(mgr);
                    }
                });
            }
        });
    }

    if (detectedManagers.size === 0) {
        return Object.keys(safeManagers);
    }

    return Array.from(detectedManagers);
  }, [managers, brandId, rawData, cleanStoreName]);

  useEffect(() => {
    if (activeView === "store-analysis") {
        if (userRole === "store" && currentUser) {
            const myStore = currentUser.stores?.[0] || currentUser.storeName;
            if (myStore) { 
                const coreName = cleanStoreName(myStore);
                const fullName = `${brandPrefix}${coreName}店`;
                setSelectedStore(fullName);
            }
        } else if (userRole === "manager" && currentUser) {
            setSelectedManager(currentUser.name || "");
        }
    }
  }, [activeView, currentUser, userRole, brandPrefix, cleanStoreName]);

  useEffect(() => {
    const handleStoreNav = (e) => setSelectedStore(e.detail);
    window.addEventListener("navigate-to-store", handleStoreNav);
    return () => window.removeEventListener("navigate-to-store", handleStoreNav);
  }, []);

  const availableStores = useMemo(() => {
    const safeManagers = managers || {};

    const formatStoreName = (s) => {
      if (!s) return ""; 
      return `${brandPrefix}${cleanStoreName(s)}店`;
    };

    if (userRole === "director" || userRole === "trainer") {
        if (selectedManager) return (safeManagers[selectedManager] || []).map(formatStoreName).filter(Boolean);
        const allStores = targetBrandManagers.flatMap(mgr => safeManagers[mgr] || []);
        return allStores.map(formatStoreName).filter(Boolean);
    }
        
    if (userRole === "manager")
      return Object.values(safeManagers).flat().map(formatStoreName).filter(Boolean);
        
    if (userRole === "store" && currentUser) {
      const myStores = currentUser.stores || (currentUser.storeName ? [currentUser.storeName] : []);
      return myStores.map((s) => formatStoreName(s)).filter(Boolean);
    }
      
    return [];
  }, [selectedManager, managers, currentUser, userRole, brandPrefix, targetBrandManagers, cleanStoreName]);

  useEffect(() => {
    if (userRole === "store" && currentUser && availableStores.length > 0) {
       if (!selectedStore || !availableStores.includes(selectedStore)) {
          setSelectedStore(availableStores[0]);
       }
    }
  }, [currentUser, availableStores, selectedStore, userRole]);

  // ==========================================
  // 單店運算與彙整運算引擎
  // ==========================================
  const calculateHealthMetrics = useCallback((dataList) => {
    const defaultHealth = {
        raw: { cashToAccrual: 0, retailRatio: 0, retention: 0, aspMining: 0, acquisitionQuality: 0 },
        scores: { financial: 0, sales: 0, loyalty: 0, mining: 0, acquisition: 0 }
    };

    if (!dataList || dataList.length === 0) return defaultHealth;

    const cash = dataList.reduce((a, b) => a + (Number(b.cash) || 0) - (Number(b.refund) || 0), 0);
    const accrual = dataList.reduce((a, b) => a + (Number(b.accrual) || 0), 0);
    const skincare = dataList.reduce((a, b) => a + (Number(b.skincareSales) || 0), 0);
    const traffic = dataList.reduce((a, b) => a + (Number(b.traffic) || 0), 0);
    const newCust = dataList.reduce((a, b) => a + (Number(b.newCustomers) || 0), 0);
    const newSales = dataList.reduce((a, b) => a + (Number(b.newCustomerSales) || 0), 0);
    
    const oldCust = Math.max(0, traffic - newCust);
    const oldSales = Math.max(0, cash - newSales);

    const rawMetrics = {
      cashToAccrual: accrual > 0 ? cash / accrual : 0,
      retailRatio: cash > 0 ? skincare / cash : 0,
      retention: traffic > 0 ? oldCust / traffic : 0,
      aspMining: (oldCust > 0 && newCust > 0 && (newSales/newCust) > 0) 
                 ? (oldSales / oldCust) / (newSales / newCust)
                 : 0,
      acquisitionQuality: (newCust > 0 && (Number(targets?.newASP) || 3500) > 0) 
                          ? (newSales / newCust) / (Number(targets?.newASP) || 3500)
                          : 0
    };

    const normalize = (val, min, max) => {
      const nMin = Number(min) > 5 ? Number(min) / 100 : Number(min);
      const nMax = Number(max) > 5 ? Number(max) / 100 : Number(max);
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
  }, [currentBenchmarks, targets]);

  const getAggregateData = useCallback((storesList) => {
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;
    
    const data = allReports.filter(d => {
        if (!d.date || !d.storeName) return false;
        const parts = String(d.date).replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        if (!((y === targetYear || y === rocYear) && m === monthInt)) return false;
        
        const core = cleanStoreName(d.storeName);
        return storesList.includes(core);
    });

    const cash = data.reduce((a, b) => a + (Number(b.cash) || 0) - (Number(b.refund) || 0), 0);
    const refund = data.reduce((a, b) => a + (Number(b.refund) || 0), 0);
    const traffic = data.reduce((a, b) => a + (Number(b.traffic) || 0), 0);
    const opAccrual = data.reduce((a, b) => a + (Number(b.operationalAccrual) || 0), 0);
    const newCust = data.reduce((a, b) => a + (Number(b.newCustomers) || 0), 0);
    const newSales = data.reduce((a, b) => a + (Number(b.newCustomerSales) || 0), 0);
    const newClosings = data.reduce((a, b) => a + (Number(b.newCustomerClosings) || 0), 0);
    
    let totalBudget = 0;
    storesList.forEach(core => {
        const budgetKey = `${brandPrefix}${core}店_${targetYear}_${monthInt}`;
        if(budgets[budgetKey]) {
            totalBudget += Number(budgets[budgetKey].cashTarget || 0);
        }
    });

    const health = calculateHealthMetrics(data);

    return {
        totalCash: cash,
        totalRefund: refund,
        totalTraffic: traffic,
        trafficASP: traffic > 0 ? Math.round(opAccrual / traffic) : 0,
        newCustomerASP: newCust > 0 ? Math.round(newSales / newCust) : 0,
        totalNewCustomerClosings: newClosings,
        budget: totalBudget,
        achievement: totalBudget > 0 ? (cash / totalBudget) * 100 : 0,
        health
    };
  }, [allReports, selectedYear, selectedMonth, cleanStoreName, brandPrefix, budgets, calculateHealthMetrics]);

  const globalMetrics = useMemo(() => {
    if (!allReports) return null;
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;

    const globalData = allReports.filter(d => {
        if (!d.date || !d.storeName) return false;
        const parts = String(d.date).replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        if (!((y === targetYear || y === rocYear) && m === monthInt)) return false;
        
        return isBrandMatch(d.storeName, brandId);
    });

    const uniqueCores = new Set(globalData.map(d => cleanStoreName(d.storeName)));
    let totalBudget = 0;
    uniqueCores.forEach(core => {
        const budgetKey = `${brandPrefix}${core}店_${targetYear}_${monthInt}`;
        if(budgets[budgetKey]) {
            totalBudget += Number(budgets[budgetKey].cashTarget || 0);
        }
    });

    const cash = globalData.reduce((a, b) => a + (Number(b.cash) || 0) - (Number(b.refund) || 0), 0);
    const refund = globalData.reduce((a, b) => a + (Number(b.refund) || 0), 0);
    const traffic = globalData.reduce((a, b) => a + (Number(b.traffic) || 0), 0);
    const opAccrual = globalData.reduce((a, b) => a + (Number(b.operationalAccrual) || 0), 0);
    const newCust = globalData.reduce((a, b) => a + (Number(b.newCustomers) || 0), 0);
    const newSales = globalData.reduce((a, b) => a + (Number(b.newCustomerSales) || 0), 0);
    const newClosings = globalData.reduce((a, b) => a + (Number(b.newCustomerClosings) || 0), 0);

    const health = calculateHealthMetrics(globalData);

    return {
        totalCash: cash,
        totalRefund: refund,
        totalTraffic: traffic,
        trafficASP: traffic > 0 ? Math.round(opAccrual / traffic) : 0,
        newCustomerASP: newCust > 0 ? Math.round(newSales / newCust) : 0,
        totalNewCustomerClosings: newClosings,
        budget: totalBudget,
        achievement: totalBudget > 0 ? (cash / totalBudget) * 100 : 0,
        health
    };
  }, [allReports, selectedYear, selectedMonth, isBrandMatch, brandId, brandPrefix, budgets, cleanStoreName, calculateHealthMetrics]);

  const regionMetrics = useMemo(() => {
    if (!isManagementRole || !allReports) return null;
    let targetManager = selectedManager;
    if (userRole === 'manager') targetManager = currentUser.name; 
    
    if (!targetManager) return null; 

    const regionStores = (managers[targetManager] || []).map(cleanStoreName);
    return getAggregateData(regionStores);
  }, [isManagementRole, selectedManager, userRole, currentUser, allReports, managers, cleanStoreName, getAggregateData]);

  const storeMetrics = useMemo(() => {
    if (!selectedStore || !rawData) return null;
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;

    const targetCoreName = cleanStoreName(selectedStore);

    const data = rawData.filter((d) => {
        if (!d.date || !d.storeName) return false;
        const parts = String(d.date).replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        if (!((y === targetYear || y === rocYear) && m === monthInt)) return false;

        return cleanStoreName(d.storeName) === targetCoreName;
    }).sort((a, b) => toStandardDateFormat(a.date).localeCompare(toStandardDateFormat(b.date)));

    const grossCash = data.reduce((a, b) => a + (Number(b.cash) || 0), 0);
    const totalRefund = data.reduce((a, b) => a + (Number(b.refund) || 0), 0);
    const totalCash = grossCash - totalRefund;
    const totalTraffic = data.reduce((a, b) => a + (Number(b.traffic) || 0), 0);
    const totalOpAccrual = data.reduce((a, b) => a + (Number(b.operationalAccrual) || 0), 0);
    const totalNewCustomers = data.reduce((a, b) => a + (Number(b.newCustomers) || 0), 0);
    const totalNewCustomerSales = data.reduce((a, b) => a + (Number(b.newCustomerSales) || 0), 0);
    const totalNewCustomerClosings = data.reduce((a, b) => a + (Number(b.newCustomerClosings) || 0), 0);
    const budgetData = budgets[`${selectedStore}_${targetYear}_${monthInt}`] || {};
    const budget = Number(budgetData.cashTarget || 0);

    const health = calculateHealthMetrics(data);

    return {
      totalCash,
      achievement: budget > 0 ? (totalCash / budget) * 100 : 0,
      trafficASP: totalTraffic > 0 ? Math.round(totalOpAccrual / totalTraffic) : 0,
      newCustomerASP: totalNewCustomers > 0 ? Math.round(totalNewCustomerSales / totalNewCustomers) : 0,
      totalNewCustomerClosings,
      totalRefund,
      dailyData: data.map((d) => ({
        date: String(toStandardDateFormat(d.date)).split("/")[2],
        cash: (Number(d.cash) || 0) - (Number(d.refund) || 0),
        accrual: Number(d.accrual) || 0,
        traffic: Number(d.traffic) || 0,
      })),
      budget,
      health
    };
  }, [selectedStore, selectedYear, selectedMonth, rawData, budgets, cleanStoreName, calculateHealthMetrics]);

  const benchmarkMetrics = useMemo(() => {
      if (!showBenchmark || !allReports) return null;
      const targetYear = parseInt(selectedYear);
      const monthInt = parseInt(selectedMonth);
      const rocYear = targetYear - 1911;

      const benchmarkData = allReports.filter(d => {
          if (!d.date || !d.storeName) return false;
          const parts = String(d.date).replace(/-/g, "/").split("/");
          const y = parseInt(parts[0]);
          const m = parseInt(parts[1]);
          if (!((y === targetYear || y === rocYear) && m === monthInt)) return false;

          if (!isBrandMatch(d.storeName, brandId)) return false;
          if (cleanStoreName(d.storeName) === cleanStoreName(selectedStore)) return false;

          return true;
      });

      return calculateHealthMetrics(benchmarkData);
  }, [selectedYear, selectedMonth, allReports, showBenchmark, selectedStore, cleanStoreName, isBrandMatch, brandId, calculateHealthMetrics]);


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

  const isManagerView = userRole === 'manager' || (userRole === 'director' && selectedManager);
  const activeManagementMetrics = (isManagerView && regionMetrics) ? regionMetrics : globalMetrics;
  const managementRadarTitle = isManagerView 
      ? `${userRole === 'manager' ? currentUser.name : selectedManager}區 體質診斷`
      : `${brandPrefix} 全區體質診斷`;
      
  const managementRadarData = useMemo(() => {
      if (!globalMetrics || !activeManagementMetrics) return [];
      const cfg = currentBenchmarks;
      const s = activeManagementMetrics.health.scores;
      const b = globalMetrics.health.scores;

      return [
        { subject: '財務健康', A: s.financial, B: b.financial, fullMark: 100, label: cfg.financial.label },
        { subject: '銷售結構', A: s.sales, B: b.sales, fullMark: 100, label: cfg.sales.label },
        { subject: '顧客黏著', A: s.loyalty, B: b.loyalty, fullMark: 100, label: cfg.loyalty.label },
        { subject: '客單挖掘', A: s.mining, B: b.mining, fullMark: 100, label: cfg.mining.label },
        { subject: '新客質量', A: s.acquisition, B: b.acquisition, fullMark: 100, label: cfg.acquisition.label },
      ];
  }, [activeManagementMetrics, globalMetrics, currentBenchmarks]);

  // ==========================================
  // ★★★ 白話文翻譯蒟蒻 (輕量化明亮風格設計) ★★★
  // ==========================================
  const RadarGuideTooltip = () => {
    const cfg = currentBenchmarks;
    return (
      <div className="group relative z-[100]">
          <HelpCircle size={18} className="text-stone-400 cursor-help hover:text-amber-500 transition-colors"/>
          <div className="absolute right-0 top-full mt-2 w-[260px] sm:w-[320px] p-4 bg-white border border-stone-200 text-stone-600 text-xs rounded-2xl shadow-xl opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none translate-y-2 group-hover:translate-y-0">
              <p className="font-bold text-sm text-stone-800 mb-3 border-b border-stone-100 pb-2 flex items-center gap-2">
                 <Activity size={16} className="text-amber-500"/> 五力雷達圖指標說明
              </p>
              <div className="space-y-3 text-left">
                  <div>
                      <p className="font-bold text-emerald-600">1. {cfg.financial.label} (財務健康)</p>
                      <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">當月收進來的現金，夠不夠抵銷做課程消耗的成本？避免陷入「只做白工沒收錢」的窘境。</p>
                  </div>
                  <div>
                      <p className="font-bold text-blue-500">2. {cfg.sales.label} (銷售結構)</p>
                      <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">保養品佔總業績比例。檢視團隊在「手作課程」之外，推銷居家保養品的能力。</p>
                  </div>
                  <div>
                      <p className="font-bold text-purple-600">3. {cfg.loyalty.label} (顧客黏著)</p>
                      <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">舊客佔總客流的比例。檢視服務滿意度，分數過低代表客人一直流失，只靠新客苦撐。</p>
                  </div>
                  <div>
                      <p className="font-bold text-amber-600">4. {cfg.mining.label} (客單挖掘)</p>
                      <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">舊客平均消費 vs 新客平均消費。高分代表能讓老客人「持續加購或升級」，創造高終身價值。</p>
                  </div>
                  <div>
                      <p className="font-bold text-rose-500">5. {cfg.acquisition.label} (新客質量)</p>
                      <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">新客客單價與預期目標的落差。檢視行銷帶來的客人含金量，以及美容師的首單締結功力。</p>
                  </div>
              </div>
              <div className="mt-4 pt-2 border-t border-stone-100 text-[10px] text-stone-400 text-center font-bold bg-stone-50 -mx-4 -mb-4 p-3 rounded-b-2xl">
                  圖形越飽滿、越靠近外圈，代表經營體質越健康
              </div>
          </div>
      </div>
    );
  };


  // ==========================================
  // 全局異常店家清單掃描
  // ==========================================
  const exceptionLists = useMemo(() => {
    if (!isManagementRole || !rawData) return null;
    const safeManagers = managers || {};

    let targetRawStores = [];
    
    if (userRole === 'manager' && currentUser) {
        targetRawStores = safeManagers[currentUser.name] || [];
    } else if (userRole === 'director' || userRole === 'trainer') {
        targetRawStores = targetBrandManagers.flatMap(mgr => safeManagers[mgr] || []);
    }

    if (targetRawStores.length === 0) return null;

    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;

    const storeStats = {};

    targetRawStores.forEach(s => {
        if (!s) return; 
        const coreName = cleanStoreName(s);
        let mgrName = "未分配";
        Object.entries(safeManagers).forEach(([m, list]) => {
            if((list || []).includes(s)) mgrName = m;
        });

        storeStats[coreName] = {
            id: String(s),
            name: `${coreName}店`,
            manager: mgrName,
            cash: 0, accrual: 0, skincare: 0, traffic: 0, newCust: 0, newSales: 0, foundData: false 
        };
    });

    rawData.forEach(d => {
        if (!d.date || !d.storeName) return; 
        const parts = String(d.date).replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        if (!((y === targetYear || y === rocYear) && m === monthInt)) return;

        const dCore = cleanStoreName(d.storeName);
        
        if (storeStats[dCore]) {
            storeStats[dCore].foundData = true;
            storeStats[dCore].cash += (Number(d.cash) || 0) - (Number(d.refund) || 0);
            storeStats[dCore].accrual += (Number(d.accrual) || 0);
            storeStats[dCore].skincare += (Number(d.skincareSales) || 0);
            storeStats[dCore].traffic += (Number(d.traffic) || 0);
            storeStats[dCore].newCust += (Number(d.newCustomers) || 0);
            storeStats[dCore].newSales += (Number(d.newCustomerSales) || 0);
        }
    });

    const cfg = currentBenchmarks;
    const getThreshold = (val) => (Number(val) > 5 ? Number(val) / 100 : Number(val)); 

    const reportCards = Object.values(storeStats)
        .filter(s => s.foundData)
        .map(s => {
            const oldCust = Math.max(0, s.traffic - s.newCust);
            const cashToAccrual = s.accrual > 0 ? s.cash / s.accrual : 0;
            const productRatio = s.cash > 0 ? s.skincare / s.cash : 0;
            const retentionRate = s.traffic > 0 ? oldCust / s.traffic : 0;
            const newCustomerASP = s.newCust > 0 ? Math.round(s.newSales / s.newCust) : 0;
            const targetASP = Number(targets?.newASP) || 3500;
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

  }, [rawData, userRole, currentUser, managers, isManagementRole, targets, currentBenchmarks, targetBrandManagers, selectedYear, selectedMonth, cleanStoreName]);

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
                {type === 'currency' ? fmtMoney(value) : `${(Number(value) * 100).toFixed(0)}%`}
            </p>
            <p className="text-[10px] text-stone-400">{label}</p>
        </div>
        <ArrowRight size={14} className="text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );

  const handleJumpToStore = (fullStoreName) => {
    setSelectedStore(`${brandPrefix}${cleanStoreName(fullStoreName)}店`);
  };

  const cfg = currentBenchmarks;

  const formatThreshold = (val) => {
      const num = Number(val) > 5 ? Number(val) : Number(val) * 100;
      return `${num.toFixed(0)}%`;
  };

  const getCalcThreshold = (val) => Number(val) > 5 ? Number(val) / 100 : Number(val);
  
  const showToggle = selectedStore || (isManagementRole && isManagerView);

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
            
            {showToggle && (
                <div className="flex items-center gap-2 mt-2 sm:mt-0">
                <label className="flex items-center cursor-pointer relative">
                    <input type="checkbox" checked={showBenchmark} onChange={(e) => setShowBenchmark(e.target.checked)} className="sr-only peer" />
                    <div className="w-11 h-6 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-stone-500"></div>
                    <span className="ml-3 text-sm font-bold text-stone-500">
                        顯示全區平均
                    </span>
                </label>
                </div>
            )}
          </div>
        </Card>

        {/* 管理者專用雷達圖 */}
        {!selectedStore && isManagementRole && activeManagementMetrics ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col xl:flex-row gap-6 mb-6">
               <div className="w-full xl:w-1/3 bg-white rounded-2xl border border-stone-100 shadow-sm p-4 flex flex-col relative">
                  <div className="flex justify-between items-center mb-2">
                    <div>
                        <h3 className="font-bold text-stone-700 flex items-center gap-2"><Activity size={18} className="text-indigo-500"/> {managementRadarTitle}</h3>
                        <p className="text-xs text-stone-400">Regional Five-Force Analysis</p>
                    </div>
                    {/* ★ 加入白話文翻譯蒟蒻 ★ */}
                    <RadarGuideTooltip />
                  </div>
                  <div className="h-[350px] w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={managementRadarData}>
                            <PolarGrid stroke="#cbd5e1" />
                            <PolarAngleAxis dataKey="subject" tick={{ fill: '#78716c', fontSize: 12, fontWeight: 'bold' }} />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                            
                            {showBenchmark && isManagerView && (
                                <Radar name="全品牌平均" dataKey="B" stroke="#a8a29e" fill="#a8a29e" fillOpacity={0.1} />
                            )}
                            
                            <Radar name={isManagerView ? "區域平均" : "全品牌平均"} dataKey="A" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
                            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}/>
                            <RechartsTooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} formatter={(val) => (Number(val) || 0).toFixed(0)}/>
                        </RadarChart>
                    </ResponsiveContainer>
                  </div>
               </div>

               <div className="w-full xl:w-2/3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
                  <div className="bg-white p-5 rounded-2xl border shadow-sm flex flex-col justify-between">
                    <div><p className="text-stone-400 text-xs font-bold mb-1">彙整現金業績</p><h3 className="text-2xl font-bold text-stone-700">{fmtMoney(activeManagementMetrics.totalCash)}</h3></div>
                    <p className={`text-sm font-bold mt-2 ${activeManagementMetrics.achievement >= 100 ? "text-emerald-500" : "text-amber-500"}`}>{activeManagementMetrics.achievement.toFixed(1)}% 達成</p>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">彙整消耗客單</p>
                    <h3 className="text-2xl font-bold text-stone-700">{fmtMoney(activeManagementMetrics.trafficASP)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">彙整目標</p>
                    <h3 className="text-2xl font-bold text-stone-700">{fmtMoney(activeManagementMetrics.budget)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">平均新客客單</p>
                    <h3 className="text-2xl font-bold text-stone-700">{fmtMoney(activeManagementMetrics.newCustomerASP)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">總新客留單</p>
                    <h3 className="text-2xl font-bold text-stone-700">{fmtNum(activeManagementMetrics.totalNewCustomerClosings)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">總退費金額</p>
                    <h3 className="text-2xl font-bold text-rose-500">{fmtMoney(activeManagementMetrics.totalRefund)}</h3>
                  </div>
                  
                  <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100">
                    <p className="text-stone-400 text-xs font-bold mb-1">{cfg.financial.label} (體質)</p>
                    <h3 className={`text-xl font-bold font-mono ${activeManagementMetrics.health.raw.cashToAccrual < getCalcThreshold(cfg.financial.min) ? 'text-rose-500' : 'text-stone-700'}`}>
                        {(activeManagementMetrics.health.raw.cashToAccrual * 100).toFixed(0)}%
                    </h3>
                  </div>
                  <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100">
                    <p className="text-stone-400 text-xs font-bold mb-1">{cfg.sales.label} (銷售)</p>
                    <h3 className={`text-xl font-bold font-mono ${activeManagementMetrics.health.raw.retailRatio < getCalcThreshold(cfg.sales.min) ? 'text-rose-500' : 'text-stone-700'}`}>
                        {(activeManagementMetrics.health.raw.retailRatio * 100).toFixed(1)}%
                    </h3>
                  </div>
                  <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100">
                    <p className="text-stone-400 text-xs font-bold mb-1">{cfg.loyalty.label} (黏著)</p>
                    <h3 className="text-xl font-bold font-mono text-stone-700">
                        {(activeManagementMetrics.health.raw.retention * 100).toFixed(1)}%
                    </h3>
                  </div>
               </div>
            </div>
          </div>
        ) : null}

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
                            篩選標準：{cfg.loyalty.label} &lt; {formatThreshold(getCalcThreshold(cfg.loyalty.min) - 0.1)}
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

        {/* 單店分析雷達圖與指標 */}
        {selectedStore && storeMetrics ? (
          <div className="animate-in fade-in slide-in-from-right-8 duration-500">
            <div className="flex flex-col xl:flex-row gap-6">
               
               <div className="w-full xl:w-1/3 bg-white rounded-2xl border border-stone-100 shadow-sm p-4 flex flex-col relative">
                  
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
                        
                        {/* ★ 加入白話文翻譯蒟蒻 ★ */}
                        <RadarGuideTooltip />
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
                                    name="全區平均" 
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
                            <RechartsTooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} formatter={(val) => (Number(val) || 0).toFixed(0)}/>
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