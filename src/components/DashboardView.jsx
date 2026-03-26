// src/components/DashboardView.jsx
import React, { useContext, useMemo, useState } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Line, ComposedChart, Area } from "recharts";
import { 
  TrendingUp, DollarSign, Target, Users, Award, Loader2, CheckSquare, Activity, 
  Sparkles, ShoppingBag, CreditCard, FileWarning, Trophy, Medal, AlertTriangle, 
  Crown, Map as MapIcon, User, Store as StoreIcon, ArrowRight, ArrowLeft, Frown, 
  Flame, Zap, Download, PieChart, Star
} from "lucide-react";
import { ViewWrapper, Card } from "./SharedUI";
import { formatNumber } from "../utils/helpers";
import { AppContext } from "../AppContext";

const DashboardView = () => {
  const { 
    fmtMoney, fmtNum, targets, userRole, currentUser, 
    allReports, budgets, managers, selectedYear, selectedMonth, therapistReports,
    currentBrand, therapists, dailyLoginCount, yesterdayLoginCount 
  } = useContext(AppContext);

  const [viewMode, setViewMode] = useState((userRole === 'therapist' || userRole === 'trainer') ? 'therapist' : 'store');
  const [selectedDashboardManager, setSelectedDashboardManager] = useState("");
  const [selectedDashboardStore, setSelectedDashboardStore] = useState("");

  const { brandInfo, brandPrefix } = useMemo(() => {
    let id = "CYJ";
    let name = "CYJ"; 
    
    if (currentBrand) {
      if (typeof currentBrand === 'string') { id = currentBrand; } 
      else if (typeof currentBrand === 'object') {
        id = currentBrand.id || "CYJ";
        name = currentBrand.name || currentBrand.label || id;
      }
    }

    const normalizedId = id.toLowerCase();
    if (normalizedId.includes("anniu") || normalizedId.includes("anew")) { name = "安妞"; } 
    else if (normalizedId.includes("yibo")) { name = "伊啵"; } 
    else { name = "CYJ"; }

    return { brandInfo: { id: normalizedId, name }, brandPrefix: name };
  }, [currentBrand]);

  const cleanName = useMemo(() => (name) => {
    if (!name) return "";
    let core = String(name).replace(new RegExp(`^(${brandPrefix}|CYJ|Anew|Yibo|安妞|伊啵)`, 'i'), '').trim();
    if (core === "新店") return "新店"; 
    return core.replace(/店$/, '').trim();
  }, [brandPrefix]);

  const baseVisibleStores = useMemo(() => {
    if (userRole === 'director' || userRole === 'trainer' || userRole === 'therapist') {
      return Object.values(managers).flat().map(cleanName).filter(Boolean);
    }
    if (userRole === 'manager' && currentUser) {
      return (managers[currentUser.name] || []).map(cleanName).filter(Boolean);
    }
    if (userRole === 'store' && currentUser) {
      const rawStores = currentUser.stores || [currentUser.storeName];
      return rawStores.map(cleanName).filter(Boolean);
    }
    return []; 
  }, [userRole, currentUser, managers, cleanName]);

  const availableStoresForFilter = useMemo(() => {
    const uniqueStores = [...new Set(baseVisibleStores)];
    return uniqueStores.sort().map(s => `${brandPrefix}${s}店`);
  }, [baseVisibleStores, brandPrefix]);

  const groupedStoresForFilter = useMemo(() => {
    const groups = {};
    const availableSet = new Set(availableStoresForFilter);

    Object.entries(managers || {}).forEach(([mgrName, rawStores]) => {
        const mgrValidStores = [];
        (rawStores || []).forEach(rs => {
            const core = cleanName(rs);
            const fullName = `${brandPrefix}${core}店`;
            if (availableSet.has(fullName) && !mgrValidStores.includes(fullName)) {
                mgrValidStores.push(fullName);
            }
        });
        if (mgrValidStores.length > 0) {
            groups[mgrName] = mgrValidStores.sort();
        }
    });

    const inGroups = new Set(Object.values(groups).flat());
    const orphans = availableStoresForFilter.filter(s => !inGroups.has(s));
    if (orphans.length > 0) {
        groups['其他'] = orphans.sort();
    }

    return groups;
  }, [managers, availableStoresForFilter, cleanName, brandPrefix]);

  const availableStoresForDropdown = useMemo(() => {
    if (userRole === 'manager' && currentUser) {
         return groupedStoresForFilter[currentUser.name] || Object.values(groupedStoresForFilter).flat().sort();
    }
    if (selectedDashboardManager && groupedStoresForFilter[selectedDashboardManager]) {
        return groupedStoresForFilter[selectedDashboardManager];
    }
    return Object.values(groupedStoresForFilter).flat().sort();
  }, [selectedDashboardManager, groupedStoresForFilter, userRole, currentUser]);

  const effectiveStores = useMemo(() => {
    if (selectedDashboardStore) {
      return [cleanName(selectedDashboardStore)];
    }
    if (selectedDashboardManager) {
      const stores = managers[selectedDashboardManager] || [];
      return stores.map(cleanName).filter(Boolean);
    }
    return baseVisibleStores;
  }, [baseVisibleStores, selectedDashboardStore, selectedDashboardManager, managers, cleanName]);

  const dashboardStats = useMemo(() => {
    if (!allReports) return null;

    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    const daysInMonth = new Date(y, m, 0).getDate();
    
    const now = new Date();
    let daysPassed = daysInMonth; 
    let isCurrentMonth = false;
    
    if (now.getFullYear() === y && (now.getMonth() + 1) === m) {
        daysPassed = Math.max(0, now.getDate() - 1); 
        isCurrentMonth = true;
    } else if (now < new Date(y, m - 1, 1)) {
        daysPassed = 0; 
    }

    const stats = {
      cash: 0, accrual: 0, operationalAccrual: 0, skincareSales: 0, traffic: 0,
      newCustomers: 0, newCustomerClosings: 0, newCustomerSales: 0,
      budget: 0, accrualBudget: 0,
      challengeBudget: 0, challengeAccrualBudget: 0, 
      hasChallengeCash: false,
      hasChallengeAccrual: false,
      dailyData: Array.from({ length: daysInMonth }, (_, i) => ({
        date: `${m}/${i + 1}`,
        day: i + 1,
        cash: 0,
        traffic: 0
      }))
    };

    let maxDataDay = 0; 

    allReports.forEach(report => {
      const rDate = new Date(report.date);
      if (rDate.getFullYear() !== y || (rDate.getMonth() + 1) !== m) return;

      const reportStoreClean = cleanName(report.storeName);
      if (!effectiveStores.includes(reportStoreClean)) return;

      const cash = (Number(report.cash) || 0) - (Number(report.refund) || 0);
      const traffic = Number(report.traffic) || 0;
      const operationalAccrual = Number(report.operationalAccrual) || 0;
      const skincareSales = Number(report.skincareSales) || 0;

      let accrual = Number(report.accrual) || 0;
      if (brandPrefix === '安妞') {
         accrual = operationalAccrual; 
      }

      const actualDay = rDate.getDate();
      if (cash !== 0 || traffic !== 0 || accrual !== 0 || operationalAccrual !== 0 || skincareSales !== 0) {
         if (actualDay > maxDataDay) {
             maxDataDay = actualDay;
         }
      }

      stats.cash += cash;
      stats.accrual += accrual;
      stats.operationalAccrual += operationalAccrual;
      stats.newCustomerSales += (Number(report.newCustomerSales) || 0);
      
      stats.skincareSales += skincareSales;
      stats.traffic += traffic;
      stats.newCustomers += (Number(report.newCustomers) || 0);
      stats.newCustomerClosings += (Number(report.newCustomerClosings) || 0);

      const dayIndex = rDate.getDate() - 1;
      if (stats.dailyData[dayIndex]) {
        stats.dailyData[dayIndex].cash += cash;
        stats.dailyData[dayIndex].traffic += traffic;
      }
    });

    if (isCurrentMonth) {
        if (maxDataDay > daysPassed) {
            daysPassed = maxDataDay;
        }
        if (daysPassed > now.getDate()) {
            daysPassed = now.getDate();
        }
    }

    effectiveStores.forEach(storeName => {
        const fullName = `${brandPrefix}${storeName}店`;
        const budgetKey = `${fullName}_${y}_${m}`;
        const b = budgets[budgetKey];
        if (b) {
            const baseCash = Number(b.cashTarget) || 0;
            const baseAccrual = Number(b.accrualTarget) || 0;
            const chalCash = Number(b.challengeCashTarget) || 0;
            const chalAccrual = Number(b.challengeAccrualTarget) || 0;

            stats.budget += baseCash;
            stats.accrualBudget += baseAccrual;
            
            if (chalCash > 0) stats.hasChallengeCash = true;
            if (chalAccrual > 0) stats.hasChallengeAccrual = true;

            stats.challengeBudget += (chalCash > 0 ? chalCash : baseCash);
            stats.challengeAccrualBudget += (chalAccrual > 0 ? chalAccrual : baseAccrual);
        }
    });

    const achievement = stats.budget > 0 ? (stats.cash / stats.budget) * 100 : 0;
    const accrualAchievement = stats.accrualBudget > 0 ? (stats.accrual / stats.accrualBudget) * 100 : 0;
    
    const challengeAchievement = stats.challengeBudget > 0 ? (stats.cash / stats.challengeBudget) * 100 : 0;
    const challengeAccrualAchievement = stats.challengeAccrualBudget > 0 ? (stats.accrual / stats.challengeAccrualBudget) * 100 : 0;

    const projection = daysPassed > 0 ? Math.round((stats.cash / daysPassed) * daysInMonth) : 0;
    const accrualProjection = daysPassed > 0 ? Math.round((stats.accrual / daysPassed) * daysInMonth) : 0;

    const avgTrafficASP = stats.traffic > 0 ? Math.round(stats.operationalAccrual / stats.traffic) : 0;
    const avgNewCustomerASP = stats.newCustomers > 0 ? Math.round(stats.newCustomerSales / stats.newCustomers) : 0;

    const newRevMix = stats.cash > 0 ? Math.round((stats.newCustomerSales / stats.cash) * 100) : 0;
    const oldRevMix = stats.cash > 0 ? Math.max(0, 100 - newRevMix) : 0;

    const newCountMix = stats.traffic > 0 ? Math.round((stats.newCustomers / stats.traffic) * 100) : 0;
    const oldCountMix = stats.traffic > 0 ? Math.max(0, 100 - newCountMix) : 0;

    let chartDays = daysInMonth;
    if (isCurrentMonth) {
        chartDays = Math.max(1, daysPassed); 
    } else if (daysPassed === 0) {
        chartDays = 0;
    }
    const slicedDailyTotals = stats.dailyData.slice(0, chartDays);

    return {
      grandTotal: {
        cash: stats.cash,
        accrual: stats.accrual,
        operationalAccrual: stats.operationalAccrual,
        skincareSales: stats.skincareSales,
        traffic: stats.traffic,
        newCustomers: stats.newCustomers,
        newCustomerClosings: stats.newCustomerClosings,
        newCustomerSales: stats.newCustomerSales,
        budget: stats.budget,
        accrualBudget: stats.accrualBudget,
        challengeBudget: stats.challengeBudget, 
        challengeAccrualBudget: stats.challengeAccrualBudget, 
        hasChallengeCash: stats.hasChallengeCash,
        hasChallengeAccrual: stats.hasChallengeAccrual,
        projection,         
        accrualProjection   
      },
      dailyTotals: slicedDailyTotals,
      totalAchievement: achievement,
      totalAccrualAchievement: accrualAchievement,
      challengeAchievement, 
      challengeAccrualAchievement, 
      avgTrafficASP,
      avgNewCustomerASP,
      daysPassed,
      daysInMonth,
      newRevMix,     
      oldRevMix,     
      newCountMix,   
      oldCountMix    
    };
  }, [allReports, budgets, selectedYear, selectedMonth, effectiveStores, brandPrefix, cleanName]);

  const myStoreRankings = useMemo(() => {
    if ((userRole !== 'store' && userRole !== 'manager' && userRole !== 'director') || !allReports) return [];
    
    const storeStats = {};
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);

    allReports.forEach(report => {
      const rDate = new Date(report.date);
      if (rDate.getFullYear() !== y || (rDate.getMonth() + 1) !== m) return;
      
      const cName = cleanName(report.storeName);
      if (!cName) return; 
      const standardName = `${brandPrefix}${cName}店`; 
      
      if (!storeStats[standardName]) storeStats[standardName] = 0;
      storeStats[standardName] += ((Number(report.cash) || 0) - (Number(report.refund) || 0));
    });

    const rankingList = Object.keys(storeStats).map(storeName => {
      const budgetKey = `${storeName}_${y}_${m}`;
      const budgetData = budgets[budgetKey];
      const target = budgetData ? Number(budgetData.cashTarget || 0) : 0;
      const challengeTarget = budgetData ? Number(budgetData.challengeCashTarget || 0) : 0; 
      
      const actual = storeStats[storeName];
      const rate = target > 0 ? (actual / target) * 100 : 0;
      const challengeRate = challengeTarget > 0 ? (actual / challengeTarget) * 100 : 0; 

      return { 
        storeName, 
        actual, 
        target, 
        rate,
        challengeTarget, 
        challengeRate,   
        hasChallenge: challengeTarget > 0, 
        passedChallenge: challengeTarget > 0 && actual >= challengeTarget 
      };
    });

    rankingList.sort((a, b) => b.rate - a.rate);
    
    const fullRankedList = rankingList.map((item, index) => ({ 
      ...item, 
      rank: index + 1, 
      totalStores: rankingList.length, 
      isBottom5: (index + 1) > (rankingList.length - 5) 
    }));
    
    return fullRankedList.filter(item => {
        const cleanItemName = cleanName(item.storeName);
        return effectiveStores.includes(cleanItemName);
    });
  }, [userRole, allReports, effectiveStores, budgets, selectedYear, selectedMonth, cleanName, brandPrefix]);

  const therapistStats = useMemo(() => {
    if (!therapistReports) return { rankings: [], myStats: null, grandTotal: {} };
    
    const currentMonthReports = therapistReports.filter(r => {
      const dStr = r.date.replace(/-/g, "/"); 
      const d = new Date(dStr);
      const isTargetMonth = d.getFullYear() === parseInt(selectedYear) && (d.getMonth() + 1) === parseInt(selectedMonth);
      if (!isTargetMonth) return false;

      const rStoreClean = cleanName(r.storeName);
      if (!effectiveStores.includes(rStoreClean)) return false;

      return true;
    });

    const statsMap = {};
    currentMonthReports.forEach(r => {
      const id = r.therapistId;
      const rStoreClean = cleanName(r.storeName);
      const reportTime = new Date(r.date.replace(/-/g, "/")).getTime();

      if (!statsMap[id]) { 
        statsMap[id] = { 
          id, 
          name: r.therapistName, 
          latestDate: reportTime,       
          storeDisplay: rStoreClean,    
          totalRevenue: 0, serviceCount: 0, newCustomerRevenue: 0, oldCustomerRevenue: 0,
          newCustomerCount: 0, oldCustomerCount: 0, newCustomerClosings: 0, returnRevenue: 0 
        }; 
      } else {
          if (reportTime > statsMap[id].latestDate) {
              statsMap[id].latestDate = reportTime;
              statsMap[id].storeDisplay = rStoreClean;
          }
      }
      
      statsMap[id].totalRevenue += (Number(r.totalRevenue) || 0);
      statsMap[id].serviceCount += (Number(r.serviceCount) || 0);
      statsMap[id].newCustomerRevenue += (Number(r.newCustomerRevenue) || 0);
      statsMap[id].oldCustomerRevenue += (Number(r.oldCustomerRevenue) || 0);
      statsMap[id].newCustomerCount += (Number(r.newCustomerCount) || 0);
      statsMap[id].oldCustomerCount += (Number(r.oldCustomerCount) || 0);
      statsMap[id].newCustomerClosings += (Number(r.newCustomerClosings) || 0);
      statsMap[id].returnRevenue += (Number(r.returnRevenue) || 0);
    });

    const rankings = Object.values(statsMap).map(item => {
        const total = item.totalRevenue || 1; 
        const newMix = Math.round((item.newCustomerRevenue / total) * 100);
        const oldMix = Math.round((item.oldCustomerRevenue / total) * 100);
        const newCount = item.newCustomerCount || 1;
        const newRate = (item.newCustomerClosings / newCount) * 100;
        const oldCount = item.oldCustomerCount || 1;
        const newAsp = item.newCustomerRevenue / newCount;
        const oldAsp = item.oldCustomerRevenue / oldCount;

        const finalStoreDisplay = item.storeDisplay + '店';

        const isSystemStaff = therapists && Array.isArray(therapists) && therapists.some(t => t.id === item.id);

        return { ...item, storeDisplay: finalStoreDisplay, revenueMix: `${newMix}% / ${oldMix}%`, newClosingRate: newRate, newAsp, oldAsp, isSystemStaff };
    }).sort((a, b) => b.totalRevenue - a.totalRevenue);

    const totalTherapists = rankings.length;
    rankings.forEach((item, index) => { 
        item.rank = index + 1; 
        item.totalPeers = totalTherapists;
        if (item.rank <= 3) item.status = "TOP";
        else if (item.rank > totalTherapists - 10) item.status = "DANGER";
        else item.status = "NORMAL";
        item.gapToNext = index > 0 ? rankings[index - 1].totalRevenue - item.totalRevenue : 0;
    });
    
    let myStats = null;
    if (userRole === 'therapist' && currentUser) { 
        myStats = rankings.find(r => r.id === currentUser.id); 
    }
    
    const grandTotal = rankings.reduce((acc, curr) => ({ 
        totalRevenue: acc.totalRevenue + curr.totalRevenue, 
        serviceCount: acc.serviceCount + curr.serviceCount, 
        newCustomerRevenue: acc.newCustomerRevenue + curr.newCustomerRevenue, 
        oldCustomerRevenue: acc.oldCustomerRevenue + curr.oldCustomerRevenue,
        returnRevenue: acc.returnRevenue + curr.returnRevenue, 
    }), { totalRevenue: 0, serviceCount: 0, newCustomerRevenue: 0, oldCustomerRevenue: 0, returnRevenue: 0 });
    
    let systemTherapistCount = 0;
    if (therapists && Array.isArray(therapists)) {
        systemTherapistCount = therapists.filter(t => {
            const tStoreClean = cleanName(t.store);
            return effectiveStores.includes(tStoreClean);
        }).length;
    }
    grandTotal.count = systemTherapistCount;

    return { rankings, myStats, grandTotal };
  }, [therapistReports, selectedYear, selectedMonth, effectiveStores, cleanName, userRole, currentUser, therapists]);

  const handleExportCSV = () => {
    const dataToExport = therapistStats.rankings.filter(t => userRole !== 'therapist' || t.id === currentUser?.id);
    const headers = ["排名,姓名,所屬店家,個人總業績,今明業績,舊客業績,新舊客佔比,新客締結率,新客人數,新客留單數,新客平均業績,舊客平均業績,在職狀態"];
    const rows = dataToExport.map(t => [
      t.rank,
      t.name,
      t.storeDisplay, 
      t.totalRevenue,
      t.newCustomerRevenue,
      t.oldCustomerRevenue,
      `"${t.revenueMix}"`,
      `${t.newClosingRate.toFixed(0)}%`,
      t.newCustomerCount,
      t.newCustomerClosings,
      Math.round(t.newAsp),
      Math.round(t.oldAsp),
      t.isSystemStaff ? "在職" : "支援/離職"
    ].join(","));

    const csvContent = "\uFEFF" + [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    const today = new Date().toISOString().split("T")[0];
    link.setAttribute("href", url);
    link.setAttribute("download", `${brandInfo.name}_管理師績效排行_${today}.csv`);
    
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getMotivationalMessage = (stats) => {
      if (!stats) return { title: "努力加載中...", sub: "Data Loading..." };
      const { rank, totalPeers, status, gapToNext } = stats;
      const beaten = totalPeers - rank;
      if (status === "TOP") return { title: rank === 1 ? "全區制霸！無人能敵" : "表現卓越！王者風範", sub: "請繼續保持這份榮耀", icon: Crown };
      else if (status === "DANGER") return { title: `警報！您僅贏過 ${beaten} 人`, sub: `距離上一名還差 ${fmtMoney(gapToNext)}，請加油好嗎？`, icon: AlertTriangle };
      else return { title: `表現平穩，擊敗了 ${beaten} 位夥伴`, sub: `再多做 ${fmtMoney(gapToNext)} 就能前進一名！`, icon: Zap };
  };

  if (!dashboardStats) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-stone-300" /><span className="ml-3 text-stone-400 font-bold">數據載入中...</span></div>;

  const { grandTotal: storeGrandTotal, dailyTotals, totalAchievement, daysPassed, daysInMonth } = dashboardStats;
  const timeProgress = daysInMonth > 0 ? (daysPassed / daysInMonth) * 100 : 0;
  const paceGap = totalAchievement - timeProgress;
  
  const MiniKpiCard = ({ title, value, subText, icon: Icon, color }) => (
    <div className="bg-white p-5 rounded-3xl border border-stone-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden h-full flex flex-col">
      <div className={`absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity ${color}`}><Icon size={64} /></div>
      <div className="flex flex-col h-full justify-between relative z-10">
        <div>
           <p className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
           <h3 className="text-2xl font-extrabold text-stone-700 font-mono tracking-tight">{value}</h3>
        </div>
        {subText && <div className="mt-3 pt-3 border-t border-stone-50 text-xs font-medium text-stone-500 flex flex-col gap-1">{subText}</div>}
      </div>
    </div>
  );

  return (
    <ViewWrapper>
      <div className="space-y-8 pb-10 w-full min-w-0 relative">
        
        {/* ======================================= */}
        {/* ★★★ 整合式控制面板 (Unified Control Panel) ★★★ */}
        {/* ======================================= */}
        <div className="bg-white p-4 md:p-5 rounded-3xl border border-stone-200 shadow-sm animate-in fade-in slide-in-from-top-2 mb-6">
          <div className="flex flex-col xl:flex-row justify-between gap-5">
            
            {/* 左側：標題與切換器 */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 md:gap-5 shrink-0">
              {/* 標題區 */}
              <div className="flex items-center gap-3">
                <div className={`w-2 h-8 rounded-full ${brandInfo.id.toLowerCase().includes('anniu') ? 'bg-teal-500' : brandInfo.id.toLowerCase().includes('yibo') ? 'bg-purple-500' : 'bg-amber-500'}`}></div>
                <div>
                  {/* ★ 加入 flex-wrap 讓手機版空間不夠時自動換行排列 */}
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl md:text-2xl font-extrabold text-stone-800 tracking-tight">{brandInfo.name} 營運總覽</h1>
                    
                    {/* ★★★ 今日/昨日 雙重登入次數監控膠囊 (移除 hidden，加入完美自適應) ★★★ */}
                    {(userRole === 'director' || userRole === 'trainer' || userRole === 'manager') && (
                      <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-1 sm:py-1.5 bg-stone-50 border border-stone-200 rounded-lg sm:rounded-xl shadow-sm">
                        <div className="flex items-center gap-1.5" title="今日系統登入次數">
                          <div className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </div>
                          <span className="text-[10px] font-bold text-stone-500 tracking-widest">今日</span>
                          <span className="text-sm font-mono font-black text-stone-700">{dailyLoginCount || 0}</span>
                        </div>
                        
                        <div className="w-px h-3 sm:h-4 bg-stone-200"></div>
                        
                        <div className="flex items-center gap-1.5" title="昨日系統登入次數">
                          <div className="h-2 w-2 rounded-full bg-stone-300"></div>
                          <span className="text-[10px] font-bold text-stone-400 tracking-widest">昨日</span>
                          <span className="text-sm font-mono font-bold text-stone-500">{yesterdayLoginCount || 0}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] md:text-xs text-stone-400 font-bold tracking-wider uppercase mt-0.5">Dashboard</p>
                </div>
              </div>

              {/* 分隔線與切換按鈕 (依權限顯示) */}
              {userRole !== 'therapist' && userRole !== 'trainer' && (
                <>
                  <div className="hidden sm:block w-px h-10 bg-stone-100"></div>
                  <div className="bg-stone-100/80 p-1 rounded-2xl flex shadow-inner w-fit border border-stone-200/50">
                     <button onClick={() => setViewMode('store')} className={`px-4 md:px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all duration-200 ${viewMode === 'store' ? 'bg-white text-stone-800 shadow-sm ring-1 ring-stone-200/50' : 'text-stone-500 hover:text-stone-700 hover:bg-stone-200/50'}`}><StoreIcon size={16}/> 門市營運</button>
                     <button onClick={() => setViewMode('therapist')} className={`px-4 md:px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all duration-200 ${viewMode === 'therapist' ? 'bg-white text-stone-800 shadow-sm ring-1 ring-stone-200/50' : 'text-stone-500 hover:text-stone-700 hover:bg-stone-200/50'}`}><User size={16}/> 人員績效</button>
                  </div>
                </>
              )}
            </div>

            {/* 右側：店家篩選器 */}
            <div className="flex flex-wrap xl:flex-nowrap items-center gap-2 md:gap-3">
              {(userRole === 'director' || userRole === 'trainer' || userRole === 'manager') && (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {(userRole === 'director' || userRole === 'trainer') && (
                    <select
                        value={selectedDashboardManager}
                        onChange={(e) => {
                            setSelectedDashboardManager(e.target.value);
                            setSelectedDashboardStore(""); 
                        }}
                        className="flex-1 sm:flex-none px-4 py-2.5 border border-stone-200 rounded-xl text-sm font-bold text-stone-600 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 bg-stone-50 hover:bg-white transition-all cursor-pointer min-w-[120px]"
                    >
                        <option value="">全品牌</option>
                        {Object.keys(groupedStoresForFilter).map(m => (
                            <option key={m} value={m}>{m}區</option>
                        ))}
                    </select>
                  )}
                  
                  <select
                      value={selectedDashboardStore}
                      onChange={(e) => setSelectedDashboardStore(e.target.value)}
                      className="flex-1 sm:flex-none px-4 py-2.5 border border-stone-200 rounded-xl text-sm font-bold text-stone-600 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 bg-stone-50 hover:bg-white transition-all cursor-pointer min-w-[140px]"
                  >
                      <option value="" className="font-bold text-stone-800">
                          {selectedDashboardManager || userRole === 'manager' ? "全區店家" : "顯示全區"}
                      </option>
                      
                      {(!selectedDashboardManager && userRole !== 'manager') ? (
                          Object.entries(groupedStoresForFilter).map(([mgrName, stores]) => (
                              <optgroup key={mgrName} label={`${mgrName} 區`} className="font-bold text-stone-400 bg-stone-50">
                                  {stores.map(s => (
                                      <option key={s} value={s} className="font-medium text-stone-700 bg-white">{s}</option>
                                  ))}
                              </optgroup>
                          ))
                      ) : (
                          availableStoresForDropdown.map(s => (
                              <option key={s} value={s} className="font-medium text-stone-700 bg-white">{s}</option>
                          ))
                      )}
                  </select>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* --- 門市營運視圖 --- */}
        {viewMode === 'store' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full min-w-0">
            {/* 我的店家戰情卡 (僅店經理顯示) */}
            {userRole === 'store' && myStoreRankings.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{myStoreRankings.map((storeRank) => ( 
                <div key={storeRank.storeName} className={`rounded-3xl p-6 text-white shadow-xl relative overflow-hidden transition-all ${storeRank.isBottom5 ? "bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-200" : "bg-gradient-to-br from-amber-400 to-orange-600 shadow-amber-200"}`}>
                  <div className="absolute top-0 right-0 p-4 opacity-10">{storeRank.isBottom5 ? <AlertTriangle size={120} /> : <Trophy size={120} />}</div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">{storeRank.isBottom5 ? <Activity size={20} className="text-white" /> : <Medal size={20} className="text-yellow-100" />}</div>
                      <h3 className="font-bold text-lg tracking-wider opacity-90">{storeRank.storeName}</h3>
                      {storeRank.passedChallenge && (
                        <span className="bg-gradient-to-r from-yellow-300 to-amber-500 text-amber-900 px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 shadow-sm ml-1 animate-pulse">
                          <Star size={12} className="fill-current" /> 突破挑戰
                        </span>
                      )}
                      {storeRank.isBottom5 && <span className="ml-auto bg-white/20 px-2 py-1 rounded text-xs font-bold flex items-center gap-1">需加強</span>}
                    </div>
                    <div className="flex items-end gap-4 mb-2">
                      <div>
                        <p className="text-white/80 text-xs font-bold uppercase mb-1">全區排名</p>
                        <div className="flex items-baseline gap-2">
                          <span className="text-5xl font-extrabold font-mono text-white tracking-tighter">No.{storeRank.rank}</span>
                          <span className="text-white/60 font-bold text-sm">/ {storeRank.totalStores}</span>
                        </div>
                      </div>
                      <div className="flex-1 text-right">
                        <p className="text-white/80 text-xs font-bold uppercase mb-1">預算目標達成率</p>
                        <p className="text-3xl font-mono font-bold text-white">{storeRank.rate.toFixed(0)}%</p>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-white/20 flex flex-col gap-1 text-xs font-medium text-white/90">
                      <div className="flex justify-between">
                         <span>目前業績: {fmtMoney(storeRank.actual)}</span>
                         <span>預算目標: {fmtMoney(storeRank.target)}</span>
                       </div>
                      {storeRank.hasChallenge && (
                         <div className="flex justify-between text-yellow-200 mt-1 pt-1 border-t border-white/10">
                           <span>挑戰目標達成率: {storeRank.challengeRate.toFixed(0)}%</span>
                           <span>挑戰目標: {fmtMoney(storeRank.challengeTarget)}</span>
                         </div>
                      )}
                    </div>
                  </div>
                </div> 
              ))}</div>
            )}
            
            {/* 營運節奏監控 與 全新月底推估 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* 營運節奏監控 */}
              <div className="lg:col-span-2 bg-white rounded-3xl p-6 md:p-8 border border-stone-100 shadow-xl shadow-stone-200/50 relative overflow-hidden group flex flex-col h-full">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-60"></div>
                
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 relative z-10 shrink-0">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-1.5 bg-indigo-50 rounded-lg"><Activity size={16} className="text-indigo-500" /></div>
                      <span className="text-xs font-bold uppercase tracking-widest text-stone-400">營運節奏監控</span>
                    </div>
                    <h2 className="text-3xl md:text-4xl font-extrabold font-mono tracking-tight text-stone-700">Day {daysPassed} <span className="text-lg text-stone-300 font-sans">/ {daysInMonth}</span></h2>
                  </div>
                  <div className={`mt-4 md:mt-0 px-4 py-2 rounded-xl flex items-center gap-2 ${paceGap >= 0 ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-rose-50 text-rose-600 border border-rose-100"}`}>
                    <span className="text-sm font-bold">{paceGap >= 0 ? "超前預算" : "落後預算"}</span>
                    <span className="text-xl font-mono font-bold">{Math.abs(paceGap).toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex-1 flex flex-col relative z-10">
                  <div className="flex-1 flex flex-col justify-center gap-8 pb-8">
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm md:text-base font-bold">
                        <span className="text-stone-500">實際達成率 (預算)</span>
                        <span className={totalAchievement >= timeProgress ? "text-emerald-500" : "text-rose-500"}>{totalAchievement.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-stone-100 h-3.5 md:h-4 rounded-full overflow-hidden shadow-inner">
                        <div className={`h-full rounded-full transition-all duration-1000 ${totalAchievement >= 100 ? "bg-gradient-to-r from-emerald-400 to-teal-400" : totalAchievement >= timeProgress ? "bg-emerald-400" : "bg-rose-400"}`} style={{ width: `${Math.min(totalAchievement, 100)}%` }} />
                      </div>
                    </div>
                    
                    {storeGrandTotal.hasChallengeCash && (
                       <div className="space-y-3">
                         <div className="flex justify-between text-sm md:text-base font-bold">
                           <span className="text-amber-600 flex items-center gap-1"><Star size={14} className="fill-amber-500"/> 挑戰目標達成率 (加碼)</span>
                           <span className={dashboardStats.challengeAchievement >= 100 ? "text-amber-500 drop-shadow-sm" : "text-amber-600/70"}>
                             {dashboardStats.challengeAchievement.toFixed(0)}%
                           </span>
                         </div>
                         <div className="w-full bg-amber-50 h-3 md:h-3.5 rounded-full overflow-hidden border border-amber-100">
                           <div 
                             className={`h-full rounded-full transition-all duration-1000 ${dashboardStats.challengeAchievement >= 100 ? "bg-gradient-to-r from-amber-400 to-yellow-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]" : "bg-amber-300"}`} 
                             style={{ width: `${Math.min(dashboardStats.challengeAchievement, 100)}%` }} 
                           />
                         </div>
                       </div>
                    )}
                  </div>

                  <div className="space-y-2 pt-4 md:pt-5 border-t border-stone-100 mt-auto shrink-0">
                    <div className="flex justify-between text-xs md:text-sm font-medium">
                      <span className="text-stone-400">時間進度 (應達)</span>
                      <span className="text-stone-400">{timeProgress.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-stone-50 h-2 rounded-full overflow-hidden">
                      <div className="h-full bg-stone-300 rounded-full" style={{ width: `${Math.min(timeProgress, 100)}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* 月底推估 */}
              <div className="bg-white rounded-3xl p-6 border border-stone-100 shadow-lg shadow-stone-100 flex flex-col relative overflow-hidden group h-full">
                <div className="relative z-10 flex flex-col h-full">
                  <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-1 shrink-0">
                    <Target size={14} /> 月底推估
                  </p>

                  <div className="flex flex-col gap-5 flex-1 justify-center">
                    <div className="bg-stone-50/50 rounded-2xl p-4 border border-stone-100">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-stone-500 text-xs font-bold flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>現金推估
                        </div>
                      </div>
                      <h3 className="text-3xl font-extrabold text-stone-700 font-mono tracking-tight mb-3">
                        {fmtMoney(storeGrandTotal.projection)}
                      </h3>

                      <div className="flex flex-wrap gap-2 mb-3">
                        <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md text-[11px] font-bold border border-emerald-100">
                          <span>{storeGrandTotal.hasChallengeCash ? '預算達成' : '預估達成'}</span>
                          <span>{storeGrandTotal.budget > 0 ? ((storeGrandTotal.projection / storeGrandTotal.budget) * 100).toFixed(0) : 0}%</span>
                        </div>
                        {storeGrandTotal.hasChallengeCash && (
                          <div className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 rounded-md text-[11px] font-bold border border-amber-100 shadow-sm">
                            <Star size={10} className="fill-amber-500 text-amber-500" />
                            <span>挑戰達成</span>
                            <span>{storeGrandTotal.challengeBudget > 0 ? ((storeGrandTotal.projection / storeGrandTotal.challengeBudget) * 100).toFixed(0) : 0}%</span>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5 pt-3 border-t border-stone-200/60">
                        <div className="flex justify-between items-center text-[11px]">
                           <span className="text-stone-400">預算目標</span>
                           <span className="font-mono font-bold text-stone-500">{fmtMoney(storeGrandTotal.budget)}</span>
                        </div>
                        {storeGrandTotal.hasChallengeCash && (
                           <div className="flex justify-between items-center text-[11px]">
                             <span className="text-amber-600/80">挑戰目標</span>
                             <span className="font-mono font-bold text-amber-600">{fmtMoney(storeGrandTotal.challengeBudget)}</span>
                           </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-stone-50/50 rounded-2xl p-4 border border-stone-100">
                       <div className="flex items-center justify-between mb-2">
                        <div className="text-stone-500 text-xs font-bold flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>權責推估
                        </div>
                      </div>
                      <h3 className="text-3xl font-extrabold text-stone-700 font-mono tracking-tight mb-3">
                        {fmtMoney(storeGrandTotal.accrualProjection)}
                      </h3>

                      <div className="flex flex-wrap gap-2 mb-3">
                        <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md text-[11px] font-bold border border-emerald-100">
                          <span>{storeGrandTotal.hasChallengeAccrual ? '預算達成' : '預估達成'}</span>
                          <span>{storeGrandTotal.accrualBudget > 0 ? ((storeGrandTotal.accrualProjection / storeGrandTotal.accrualBudget) * 100).toFixed(0) : 0}%</span>
                        </div>
                        {storeGrandTotal.hasChallengeAccrual && (
                          <div className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 rounded-md text-[11px] font-bold border border-amber-100 shadow-sm">
                            <Star size={10} className="fill-amber-500 text-amber-500" />
                            <span>挑戰達成</span>
                            <span>{storeGrandTotal.challengeAccrualBudget > 0 ? ((storeGrandTotal.accrualProjection / storeGrandTotal.challengeAccrualBudget) * 100).toFixed(0) : 0}%</span>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5 pt-3 border-t border-stone-200/60">
                        <div className="flex justify-between items-center text-[11px]">
                           <span className="text-stone-400">預算目標</span>
                           <span className="font-mono font-bold text-stone-500">{fmtMoney(storeGrandTotal.accrualBudget)}</span>
                        </div>
                        {storeGrandTotal.hasChallengeAccrual && (
                           <div className="flex justify-between items-center text-[11px]">
                             <span className="text-amber-600/80">挑戰目標</span>
                             <span className="font-mono font-bold text-amber-600">{fmtMoney(storeGrandTotal.challengeAccrualBudget)}</span>
                           </div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            </div>
            
            {/* 財務與營運卡片 */}
            <div><h3 className="text-lg font-bold text-stone-700 mb-4 flex items-center gap-2 pl-1"><div className="w-1 h-6 bg-amber-500 rounded-full"></div>財務績效</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MiniKpiCard 
                  title="總現金業績" 
                  value={fmtMoney(storeGrandTotal.cash)} 
                  icon={DollarSign} color="text-amber-500" 
                  subText={
                    <div className="flex flex-col gap-1 w-full">
                      <div className="flex items-center justify-between">
                         <span className={`font-bold ${totalAchievement >= 100 ? "text-emerald-600" : "text-stone-500"}`}>預算目標達成率</span>
                         <span className={`font-bold ${totalAchievement >= 100 ? "text-emerald-600" : "text-stone-500"}`}>{totalAchievement.toFixed(0)}%</span>
                      </div>
                      {storeGrandTotal.hasChallengeCash && (
                         <div className="flex items-center justify-between border-t border-stone-100 pt-1">
                           <span className={`font-bold text-[11px] ${dashboardStats.challengeAchievement >= 100 ? "text-amber-600" : "text-amber-600/60"}`}><Star size={10} className="inline mb-0.5"/> 挑戰目標達成率</span>
                           <span className={`font-bold text-[11px] ${dashboardStats.challengeAchievement >= 100 ? "text-amber-600" : "text-amber-600/60"}`}>{dashboardStats.challengeAchievement.toFixed(0)}%</span>
                         </div>
                      )}
                    </div>
                  } 
                />
                
                <MiniKpiCard 
                  title="總權責業績" 
                  value={fmtMoney(storeGrandTotal.accrual)} 
                  icon={CreditCard} color="text-cyan-500" 
                  subText={
                    <div className="flex flex-col gap-1 w-full">
                      <div className="flex items-center justify-between">
                         <span className={`font-bold ${dashboardStats.totalAccrualAchievement >= 100 ? "text-emerald-600" : "text-stone-500"}`}>預算目標達成率</span>
                         <span className={`font-bold ${dashboardStats.totalAccrualAchievement >= 100 ? "text-emerald-600" : "text-stone-500"}`}>{dashboardStats.totalAccrualAchievement.toFixed(0)}%</span>
                      </div>
                      {storeGrandTotal.hasChallengeAccrual && (
                         <div className="flex items-center justify-between border-t border-stone-100 pt-1">
                           <span className={`font-bold text-[11px] ${dashboardStats.challengeAccrualAchievement >= 100 ? "text-amber-600" : "text-amber-600/60"}`}><Star size={10} className="inline mb-0.5"/> 挑戰目標達成率</span>
                           <span className={`font-bold text-[11px] ${dashboardStats.challengeAccrualAchievement >= 100 ? "text-amber-600" : "text-amber-600/60"}`}>{dashboardStats.challengeAccrualAchievement.toFixed(0)}%</span>
                         </div>
                      )}
                    </div>
                  } 
                />
                
                <MiniKpiCard 
                  title="總保養品業績" 
                  value={fmtMoney(storeGrandTotal.skincareSales)} 
                  icon={ShoppingBag} 
                  color="text-rose-500" 
                  subText={
                    <div className="flex items-center gap-3 w-full">
                       <span>佔現金 <span className="font-bold text-stone-700 ml-1">{storeGrandTotal.cash > 0 ? ((storeGrandTotal.skincareSales / storeGrandTotal.cash) * 100).toFixed(0) : 0}%</span></span>
                       <span className="w-px h-3 bg-stone-300"></span>
                       <span>佔權責 <span className="font-bold text-stone-700 ml-1">{storeGrandTotal.accrual > 0 ? ((storeGrandTotal.skincareSales / storeGrandTotal.accrual) * 100).toFixed(0) : 0}%</span></span>
                    </div>
                  } 
                />
              </div>
            </div>
            
            {/* 營運效率與客流 */}
            <div>
               <h3 className="text-lg font-bold text-stone-700 mb-4 flex items-center gap-2 pl-1">
                 <div className="w-1 h-6 bg-cyan-500 rounded-full"></div>營運效率與客流
               </h3>
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                 <MiniKpiCard title="課程操作人數" value={fmtNum(storeGrandTotal.traffic)} icon={Users} color="text-blue-500" subText="本月累計操作人數" />
                 <MiniKpiCard title="平均操作權責" value={fmtMoney(dashboardStats.avgTrafficASP)} icon={TrendingUp} color="text-indigo-500" subText={<span className={dashboardStats.avgTrafficASP >= targets.trafficASP ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>{dashboardStats.avgTrafficASP >= targets.trafficASP ? "達標" : "未達標"} (目標 {fmtNum(targets.trafficASP)})</span>} />
                 <MiniKpiCard title="總新客數" value={fmtNum(storeGrandTotal.newCustomers)} icon={Sparkles} color="text-purple-500" subText="本月新增體驗人數" />
                 <MiniKpiCard title="總新客留單" value={fmtNum(storeGrandTotal.newCustomerClosings)} icon={CheckSquare} color="text-teal-500" subText={<span>留單率 <span className="font-bold">{storeGrandTotal.newCustomers > 0 ? ((storeGrandTotal.newCustomerClosings / storeGrandTotal.newCustomers) * 100).toFixed(0) : 0}%</span></span>} />
                 <MiniKpiCard title="新客平均客單" value={fmtMoney(dashboardStats.avgNewCustomerASP)} icon={Award} color="text-fuchsia-500" subText={<span className={dashboardStats.avgNewCustomerASP >= targets.newASP ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>{dashboardStats.avgNewCustomerASP >= targets.newASP ? "達標" : "未達標"} (目標 {fmtNum(targets.newASP)})</span>} />
                 <MiniKpiCard 
                   title="新 / 舊客 結構比" 
                   value={`${dashboardStats.newCountMix}% / ${dashboardStats.oldCountMix}%`} 
                   icon={PieChart} 
                   color="text-pink-500" 
                   subText={
                     <span className="flex items-center gap-1 text-stone-500">
                       業績比 <span className="font-bold text-stone-700">{dashboardStats.newRevMix}% / {dashboardStats.oldRevMix}%</span>
                     </span>
                   } 
                 />
               </div>
            </div>
            
            {/* 走勢圖 */}
            <Card title={`${brandInfo.name} 日營運走勢`} subtitle="現金業績 vs 課程操作人數趨勢分析"><div className="h-[300px] w-full"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={dailyTotals} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" /><XAxis dataKey="date" stroke="#a8a29e" tick={{ fontSize: 12 }} dy={10} /><YAxis yAxisId="left" stroke="#a8a29e" tick={{ fontSize: 12 }} width={60} tickFormatter={(val) => val === 0 ? "0" : `$${(val / 1000).toFixed(0)}k`} /><YAxis yAxisId="right" orientation="right" stroke="#a8a29e" tick={{ fontSize: 12 }} tickFormatter={(val) => fmtNum(val)} /><RechartsTooltip contentStyle={{ borderRadius: "16px", border: "none", padding: "12px", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)", }} cursor={{ fill: "#fafaf9" }} formatter={(value, name) => { if (name === "現金業績") return [fmtMoney(value), name]; return [fmtNum(value), name]; }} /><Area yAxisId="left" type="monotone" dataKey="cash" name="現金業績" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} strokeWidth={3} /><Line yAxisId="right" type="monotone" dataKey="traffic" name="課程操作人數" stroke="#0ea5e9" strokeWidth={3} /></ComposedChart></ResponsiveContainer></div></Card>

            {/* 戰情排行分析 */}
            {(userRole === 'manager' || userRole === 'director' || userRole === 'store') && myStoreRankings.length > 0 && (
              <div className="bg-white rounded-3xl border border-stone-200 shadow-xl overflow-hidden relative"><div className="bg-gradient-to-r from-amber-500 to-orange-600 p-6 flex justify-between items-center text-white relative overflow-hidden"><div className="absolute right-0 top-0 p-4 opacity-10"><MapIcon size={100} /></div><div className="relative z-10 flex items-center gap-3"><div className="p-2 bg-white/20 rounded-xl backdrop-blur-md"><Crown size={24} className="text-white" /></div><div><h3 className="text-xl font-bold tracking-wide">戰情排行分析</h3><p className="text-amber-100 text-xs font-medium">Rankings & Performance</p></div></div><div className="relative z-10 text-right"><p className="text-xs text-amber-100 font-bold uppercase">目前顯示店家數</p><p className="text-2xl font-mono font-bold text-white">{myStoreRankings.length}</p></div></div><div className="p-0 sm:p-2 overflow-x-auto"><table className="w-full text-left border-collapse min-w-[350px]"><thead><tr className="text-xs font-bold text-stone-400 border-b border-stone-100"><th className="p-3 sm:p-4 w-16 sm:w-20 text-center">全區排名</th><th className="p-3 sm:p-4">門市名稱</th><th className="p-3 sm:p-4 text-right">目前業績</th><th className="p-3 sm:p-4 text-right hidden sm:table-cell">目標金額</th><th className="p-3 sm:p-4 text-right">達成率</th></tr></thead><tbody>{myStoreRankings.map((store) => (<tr key={store.storeName} className={`group transition-colors border-b last:border-0 border-stone-50 ${store.isBottom5 ? "bg-rose-50 hover:bg-rose-100" : "hover:bg-stone-50" }`}>
                <td className="p-3 sm:p-4 text-center"><span className={`inline-flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full text-xs font-bold ${store.rank === 1 ? "bg-amber-100 text-amber-700" : store.rank === 2 ? "bg-stone-200 text-stone-600" : store.rank === 3 ? "bg-orange-100 text-orange-700" : "bg-stone-50 text-stone-400"}`}>{store.rank}</span></td>
                <td className="p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                    <span className={`font-bold text-sm sm:text-base ${store.isBottom5 ? "text-rose-700" : "text-stone-700"}`}>{store.storeName}</span>
                    {store.isBottom5 && (<span className="w-fit text-[10px] font-bold px-1.5 py-0.5 bg-rose-200 text-rose-700 rounded flex items-center gap-1 animate-pulse"><AlertTriangle size={10} /> <span className="hidden sm:inline">需關注</span></span>)}
                    {store.passedChallenge && (
                      <span className="w-fit text-[10px] font-bold px-1.5 py-0.5 bg-gradient-to-r from-amber-400 to-orange-500 text-white rounded flex items-center gap-1 shadow-sm">
                        <Star size={10} className="fill-current" /> <span className="hidden sm:inline">突破挑戰</span>
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-3 sm:p-4 text-right font-mono font-medium text-stone-600 text-sm sm:text-base">{fmtMoney(store.actual)}</td>
                <td className="p-3 sm:p-4 text-right font-mono text-stone-400 text-sm hidden sm:table-cell">
                   {fmtMoney(store.target)}
                   {store.hasChallenge && (
                     <div className="text-[10px] text-amber-500 mt-0.5 flex items-center justify-end gap-0.5">
                       <Star size={8} className="fill-amber-500"/> {fmtMoney(store.challengeTarget)}
                     </div>
                   )}
                </td>
                <td className="p-3 sm:p-4 text-right">
                  <div className="flex flex-col items-end">
                    <span className={`text-base sm:text-lg font-bold font-mono ${store.isBottom5 ? "text-rose-600" : (store.rate >= 100 ? "text-emerald-500" : "text-stone-600")}`}>{store.rate.toFixed(0)}%</span>
                    <div className="w-16 sm:w-24 h-1 sm:h-1.5 bg-stone-100 rounded-full mt-1 overflow-hidden"><div className={`h-full rounded-full ${store.isBottom5 ? "bg-rose-500" : (store.rate >= 100 ? "bg-emerald-400" : "bg-stone-400")}`} style={{ width: `${Math.min(store.rate, 100)}%` }}></div></div>
                  </div>
                </td>
              </tr>))}</tbody></table></div></div>
            )}

          </div>
        )}

        {/* --- 人員績效視圖 --- */}
        {viewMode === 'therapist' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full min-w-0">
            {therapistStats.myStats && (() => {
              const info = getMotivationalMessage(therapistStats.myStats);
              const status = therapistStats.myStats.status;
              let bgClass = "bg-gradient-to-br from-indigo-600 to-purple-700"; 
              let shadowClass = "shadow-indigo-200";
              if (status === "TOP") { bgClass = "bg-gradient-to-br from-amber-400 to-orange-500"; shadowClass = "shadow-amber-200"; } 
              else if (status === "DANGER") { bgClass = "bg-gradient-to-br from-rose-600 to-red-700"; shadowClass = "shadow-rose-200"; }
              return ( <div className={`${bgClass} rounded-3xl p-6 text-white shadow-xl ${shadowClass} relative overflow-hidden transition-all duration-500`}> <div className="absolute top-0 right-0 p-4 opacity-10"><info.icon size={140} /></div> <div className="relative z-10 flex flex-col md:flex-row justify-between items-end gap-6"> <div> <div className="flex items-center gap-3 mb-2"><span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm flex items-center gap-1">{status === 'DANGER' && <Flame size={12} className="animate-pulse"/>}No.{therapistStats.myStats.rank}</span><span className="text-white/80 font-bold tracking-wider text-sm">{therapistStats.myStats.storeDisplay}</span></div><h2 className="text-3xl md:text-4xl font-extrabold mb-1">{therapistStats.myStats.name}</h2><div className="mt-2 p-3 bg-black/10 rounded-xl backdrop-blur-md border border-white/10 max-w-md"><p className="font-bold text-sm flex items-center gap-2">{status === 'DANGER' && <Frown size={16}/>}{info.title}</p><p className="text-xs text-white/70 mt-1">{info.sub}</p></div> </div> <div className="flex gap-6 text-right"> <div><p className="text-xs text-white/60 font-bold uppercase mb-1">個人總業績</p><p className="text-3xl font-mono font-bold">{fmtMoney(therapistStats.myStats.totalRevenue)}</p></div> <div><p className="text-xs text-white/60 font-bold uppercase mb-1">新客締結率</p><p className="text-3xl font-mono font-bold">{therapistStats.myStats.newClosingRate.toFixed(0)}%</p></div> </div> </div> </div> );
            })()}
            
            {(userRole !== 'therapist' || userRole === 'trainer') && ( 
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4"> 
                <MiniKpiCard title="管理師總業績" value={fmtMoney(therapistStats.grandTotal.totalRevenue)} icon={DollarSign} color="text-indigo-500" subText={`${therapistStats.grandTotal.count} 位在職人員`} /> 
                <MiniKpiCard title="管理師新客業績" value={fmtMoney(therapistStats.grandTotal.newCustomerRevenue)} icon={Sparkles} color="text-amber-500" /> 
                <MiniKpiCard title="管理師舊客業績" value={fmtMoney(therapistStats.grandTotal.oldCustomerRevenue)} icon={TrendingUp} color="text-cyan-500" /> 
                <MiniKpiCard title="管理師新舊客佔比" value={`${Math.round((therapistStats.grandTotal.newCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100)}% / ${Math.round((therapistStats.grandTotal.oldCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100)}%`} icon={Activity} color="text-fuchsia-500" subText="新客 / 舊客" /> 
                <MiniKpiCard title="管理師退費總額" value={fmtMoney(therapistStats.grandTotal.returnRevenue)} icon={FileWarning} color="text-rose-500" /> 
              </div> 
            )}
            
            <Card title="管理師績效排行榜" subtitle="依本月個人總業績排序 (即時更新)">
              <div className="grid grid-cols-1 w-full">
                <div className="flex justify-end mb-4"><button onClick={handleExportCSV} className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors border border-emerald-100"><Download size={16} /> 匯出 CSV</button></div>
                <div className="overflow-x-auto w-full pb-2"><table className="w-full text-left border-collapse min-w-[1200px] whitespace-nowrap"><thead><tr className="text-xs font-bold text-stone-400 border-b border-stone-100 bg-stone-50/50"><th className="p-3 md:p-4 w-16 text-center">排名</th><th className="p-3 md:p-4">姓名</th><th className="p-3 md:p-4">所屬店家</th><th className="p-3 md:p-4 text-right">個人總業績</th><th className="p-3 md:p-4 text-right">新客業績</th><th className="p-3 md:p-4 text-right">舊客業績</th><th className="p-3 md:p-4 text-center">新舊客佔比</th><th className="p-3 md:p-4 text-right">新客締結率</th><th className="p-3 md:p-4 text-right">新客人數</th><th className="p-3 md:p-4 text-right">新客留單數</th><th className="p-3 md:p-4 text-right">新客平均業績</th><th className="p-3 md:p-4 text-right">舊客平均業績</th></tr></thead><tbody className="text-sm">
                  {therapistStats.rankings.filter(t => userRole !== 'therapist' || t.id === currentUser?.id).map((t, idx) => (
                    <tr key={t.id} className={`border-b border-stone-50 hover:bg-stone-50 transition-colors ${currentUser?.id === t.id ? "bg-indigo-50 hover:bg-indigo-100" : ""}`}>
                      <td className="p-3 md:p-4 text-center"><span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${t.rank <= 3 ? "bg-amber-100 text-amber-700 ring-4 ring-amber-50" : t.status === "DANGER" ? "bg-rose-100 text-rose-700 ring-4 ring-rose-50" : "bg-stone-100 text-stone-500"}`}>{t.rank}</span></td>
                      
                      <td className="p-3 md:p-4 font-bold text-stone-700 flex flex-wrap items-center gap-2">
                        {t.name}
                        {!t.isSystemStaff && <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded font-bold border border-stone-200">支援/離職</span>}
                        {currentUser?.id === t.id && <span className="px-2 py-0.5 bg-indigo-200 text-indigo-700 text-[10px] rounded-full">ME</span>}
                        {t.status === "DANGER" && <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-bold">加油</span>}
                      </td>
                      
                      <td className="p-3 md:p-4 text-stone-500">{t.storeDisplay}</td><td className="p-3 md:p-4 text-right font-mono font-bold text-indigo-600">{fmtMoney(t.totalRevenue)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtMoney(t.newCustomerRevenue)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtMoney(t.oldCustomerRevenue)}</td><td className="p-3 md:p-4 text-center font-mono text-xs text-stone-400">{t.revenueMix}</td><td className="p-3 md:p-4 text-right font-mono font-bold text-stone-700">{t.newClosingRate.toFixed(0)}%</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(t.newCustomerCount)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(t.newCustomerClosings)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(Math.round(t.newAsp))}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(Math.round(t.oldAsp))}</td>
                    </tr>
                  ))} 
                  {therapistStats.rankings.length === 0 && (<tr><td colSpan={12} className="p-8 text-center text-stone-400">本月尚無資料</td></tr>)}
                </tbody></table></div>
                <div className="md:hidden py-2 text-center text-stone-400 text-xs flex justify-center items-center gap-1 bg-stone-50 rounded-b-xl border-t border-stone-100"><ArrowLeft size={12}/> 左右滑動以查看更多 <ArrowRight size={12}/></div>
              </div>
            </Card>
          </div>
        )}
      </div>

    </ViewWrapper>
  );
};

export default DashboardView;