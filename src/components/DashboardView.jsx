// src/components/DashboardView.jsx
import React, { useContext, useMemo, useState } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Line, ComposedChart, Area } from "recharts";
import { TrendingUp, DollarSign, Target, Users, Award, Loader2, CheckSquare, Activity, Sparkles, ShoppingBag, CreditCard, FileWarning, Trophy, Medal, AlertTriangle, Crown, Map, User, Store as StoreIcon, ArrowRight, ArrowLeft, Frown, Flame, Zap, Download } from "lucide-react";
import { ViewWrapper, Card } from "./SharedUI";
import { formatNumber } from "../utils/helpers";
import { AppContext } from "../AppContext";

const DashboardView = () => {
  const { 
    fmtMoney, fmtNum, targets, userRole, currentUser, 
    allReports, budgets, managers, selectedYear, selectedMonth, therapistReports,
    currentBrand 
  } = useContext(AppContext);

  const [viewMode, setViewMode] = useState((userRole === 'therapist' || userRole === 'trainer') ? 'therapist' : 'store');

  // ★★★ 1. 品牌資訊與前綴邏輯 ★★★
  const { brandInfo, brandPrefix } = useMemo(() => {
    let id = "CYJ";
    let name = "CYJ"; 
    
    if (currentBrand) {
      if (typeof currentBrand === 'string') {
        id = currentBrand;
      } else if (typeof currentBrand === 'object') {
        id = currentBrand.id || "CYJ";
        name = currentBrand.name || currentBrand.label || id;
      }
    }

    const normalizedId = id.toLowerCase();
    if (normalizedId.includes("anniu") || normalizedId.includes("anew")) {
      name = "安妞";
    } else if (normalizedId.includes("yibo")) {
      name = "伊啵";
    } else {
      name = "CYJ";
    }

    return { brandInfo: { id, name }, brandPrefix: name };
  }, [currentBrand]);

  // ★★★ 2. 本地計算 Dashboard 統計數據 (移除小數點) ★★★
  const dashboardStats = useMemo(() => {
    if (!allReports) return null;

    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    const daysInMonth = new Date(y, m, 0).getDate();
    
    // 計算經過天數
    const now = new Date();
    let daysPassed = daysInMonth; // 預設為整月
    if (now.getFullYear() === y && (now.getMonth() + 1) === m) {
        daysPassed = now.getDate();
    } else if (now < new Date(y, m - 1, 1)) {
        daysPassed = 0; // 未來月份
    }

    // 初始化累加器
    const stats = {
      cash: 0, accrual: 0, skincareSales: 0, traffic: 0,
      newCustomers: 0, newCustomerClosings: 0,
      budget: 0, accrualBudget: 0,
      dailyData: Array.from({ length: daysInMonth }, (_, i) => ({
        date: `${m}/${i + 1}`,
        day: i + 1,
        cash: 0,
        traffic: 0
      }))
    };

    // 篩選當月資料並加總
    allReports.forEach(report => {
      const rDate = new Date(report.date);
      if (rDate.getFullYear() !== y || (rDate.getMonth() + 1) !== m) return;

      const cash = (Number(report.cash) || 0) - (Number(report.refund) || 0); // 扣除退費
      const accrual = Number(report.accrual) || 0;
      const traffic = Number(report.traffic) || 0;

      stats.cash += cash;
      stats.accrual += accrual;
      stats.skincareSales += (Number(report.skincareSales) || 0);
      stats.traffic += traffic;
      stats.newCustomers += (Number(report.newCustomers) || 0);
      stats.newCustomerClosings += (Number(report.newCustomerClosings) || 0);

      // 日資料 (用於圖表)
      const dayIndex = rDate.getDate() - 1;
      if (stats.dailyData[dayIndex]) {
        stats.dailyData[dayIndex].cash += cash;
        stats.dailyData[dayIndex].traffic += traffic;
      }
    });

    // 計算目標 (Budget)
    const allStoreNames = Object.values(managers).flat();
    allStoreNames.forEach(storeName => {
        const fullName = `${brandPrefix}${storeName}店`;
        const budgetKey = `${fullName}_${y}_${m}`;
        const b = budgets[budgetKey];
        if (b) {
            stats.budget += (Number(b.cashTarget) || 0);
            stats.accrualBudget += (Number(b.accrualTarget) || 0);
        }
    });

    // 衍生指標
    const achievement = stats.budget > 0 ? (stats.cash / stats.budget) * 100 : 0;
    
    // ★ 修改：加入 Math.round 確保平均客單為整數
    const avgTrafficASP = stats.traffic > 0 ? Math.round(stats.accrual / stats.traffic) : 0;
    const avgNewCustomerASP = stats.newCustomers > 0 ? Math.round(stats.cash / stats.newCustomers) : 0;
    
    // ★ 修改：加入 Math.round 確保推估值為整數
    const projection = daysPassed > 0 ? Math.round((stats.cash / daysPassed) * daysInMonth) : 0;

    return {
      grandTotal: {
        cash: stats.cash,
        accrual: stats.accrual,
        skincareSales: stats.skincareSales,
        traffic: stats.traffic,
        newCustomers: stats.newCustomers,
        newCustomerClosings: stats.newCustomerClosings,
        budget: stats.budget,
        projection
      },
      dailyTotals: stats.dailyData,
      totalAchievement: achievement,
      avgTrafficASP,
      avgNewCustomerASP,
      daysPassed,
      daysInMonth
    };

  }, [allReports, budgets, selectedYear, selectedMonth, managers, brandPrefix]);

  // --- 店家排行邏輯 ---
  const myStoreRankings = useMemo(() => {
    if ((userRole !== 'store' && userRole !== 'manager') || !allReports) return [];
    
    const storeStats = {};
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);

    allReports.forEach(report => {
      const rDate = new Date(report.date);
      if (rDate.getFullYear() !== y || (rDate.getMonth() + 1) !== m) return;
      
      const name = report.storeName;
      if (!storeStats[name]) storeStats[name] = 0;
      storeStats[name] += ((Number(report.cash) || 0) - (Number(report.refund) || 0));
    });

    const rankingList = Object.keys(storeStats).map(storeName => {
      const budgetKey = `${storeName}_${y}_${m}`;
      const budgetData = budgets[budgetKey];
      const target = budgetData ? Number(budgetData.cashTarget || 0) : 0;
      const actual = storeStats[storeName];
      const rate = target > 0 ? (actual / target) * 100 : 0;
      return { storeName, actual, target, rate };
    });

    rankingList.sort((a, b) => b.rate - a.rate);
    
    const fullRankedList = rankingList.map((item, index) => ({ 
      ...item, 
      rank: index + 1, 
      totalStores: rankingList.length, 
      isBottom5: (index + 1) > (rankingList.length - 5) 
    }));
    
    let myManagedStores = [];
    if (userRole === 'store' && currentUser) {
      myManagedStores = (currentUser.stores || [currentUser.storeName] || []).filter(s => s);
    } else if (userRole === 'manager' && managers && currentUser) {
      myManagedStores = managers[currentUser.name] || [];
    }

    return fullRankedList.filter(item => {
        const cleanItemName = item.storeName
            .replace(new RegExp(`^(${brandPrefix}|CYJ|Anew|Yibo)`, 'i'), '')
            .replace(/店$/, '')
            .trim();

        return myManagedStores.some(myStore => {
            const cleanMyStore = myStore
                .replace(new RegExp(`^(${brandPrefix}|CYJ|Anew|Yibo)`, 'i'), '')
                .replace(/店$/, '')
                .trim();
            return cleanItemName === cleanMyStore;
        });
    });
  }, [userRole, allReports, currentUser, managers, budgets, selectedYear, selectedMonth, brandPrefix]);

  // --- 管理師數據邏輯 ---
  const therapistStats = useMemo(() => {
    if (!therapistReports) return { rankings: [], myStats: null, grandTotal: {} };
    
    const currentMonthReports = therapistReports.filter(r => {
      const dStr = r.date.replace(/-/g, "/"); 
      const d = new Date(dStr);
      return d.getFullYear() === parseInt(selectedYear) && (d.getMonth() + 1) === parseInt(selectedMonth);
    });

    const statsMap = {};
    currentMonthReports.forEach(r => {
      const id = r.therapistId;
      if (!statsMap[id]) { 
        statsMap[id] = { 
          id, 
          name: r.therapistName, 
          store: r.storeName, 
          totalRevenue: 0, serviceCount: 0, newCustomerRevenue: 0, oldCustomerRevenue: 0,
          newCustomerCount: 0, oldCustomerCount: 0, newCustomerClosings: 0, returnRevenue: 0 
        }; 
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

        return { ...item, revenueMix: `${newMix}% / ${oldMix}%`, newClosingRate: newRate, newAsp, oldAsp };
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
        count: acc.count + 1 
    }), { totalRevenue: 0, serviceCount: 0, newCustomerRevenue: 0, oldCustomerRevenue: 0, returnRevenue: 0, count: 0 });
    
    return { rankings, myStats, grandTotal };
  }, [therapistReports, selectedYear, selectedMonth, userRole, currentUser]);

  const handleExportCSV = () => {
    const dataToExport = therapistStats.rankings.filter(t => userRole !== 'therapist' || t.id === currentUser?.id);
    const headers = ["排名,姓名,所屬店家,個人總業績,新客業績,舊客業績,新舊客佔比,新客締結率,新客平均業績,舊客平均業績"];
    const rows = dataToExport.map(t => [
      t.rank,
      t.name,
      t.store,
      t.totalRevenue,
      t.newCustomerRevenue,
      t.oldCustomerRevenue,
      `"${t.revenueMix}"`,
      `${t.newClosingRate.toFixed(0)}%`, // CSV 也改為整數
      Math.round(t.newAsp),
      Math.round(t.oldAsp)
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
    <div className="bg-white p-5 rounded-3xl border border-stone-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden h-full">
      <div className={`absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity ${color}`}><Icon size={64} /></div>
      <div className="flex flex-col h-full justify-between relative z-10"><div><p className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-1">{title}</p><h3 className="text-2xl font-extrabold text-stone-700 font-mono tracking-tight">{value}</h3></div>{subText && <div className="mt-3 pt-3 border-t border-stone-50 text-xs font-medium text-stone-500 flex items-center gap-1">{subText}</div>}</div>
    </div>
  );

  return (
    <ViewWrapper>
      <div className="space-y-8 pb-10 w-full min-w-0">
        
        {/* 動態品牌名稱 */}
        <div className="flex items-center gap-3 mb-2 px-2 animate-in fade-in slide-in-from-left-2 duration-500">
            <div className={`w-2 h-8 rounded-full ${brandInfo.id.toLowerCase().includes('anniu') ? 'bg-teal-500' : brandInfo.id.toLowerCase().includes('yibo') ? 'bg-purple-500' : 'bg-amber-500'}`}></div>
            <h1 className="text-2xl font-bold text-stone-700">{brandInfo.name} 營運總覽</h1>
        </div>

        {userRole !== 'therapist' && userRole !== 'trainer' && (
          <div className="flex justify-center mb-4">
            <div className="bg-stone-200 p-1 rounded-2xl flex shadow-inner">
               <button onClick={() => setViewMode('store')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${viewMode === 'store' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}><StoreIcon size={16}/> 門市營運</button>
               <button onClick={() => setViewMode('therapist')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${viewMode === 'therapist' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}><User size={16}/> 人員績效</button>
            </div>
          </div>
        )}

        {viewMode === 'store' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* 店家營運區塊 */}
            {userRole === 'store' && myStoreRankings.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{myStoreRankings.map((storeRank) => ( <div key={storeRank.storeName} className={`rounded-3xl p-6 text-white shadow-xl relative overflow-hidden transition-all ${storeRank.isBottom5 ? "bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-200" : "bg-gradient-to-br from-amber-400 to-orange-600 shadow-amber-200"}`}><div className="absolute top-0 right-0 p-4 opacity-10">{storeRank.isBottom5 ? <AlertTriangle size={120} /> : <Trophy size={120} />}</div><div className="relative z-10"><div className="flex items-center gap-2 mb-4"><div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">{storeRank.isBottom5 ? <Activity size={20} className="text-white" /> : <Medal size={20} className="text-yellow-100" />}</div><h3 className="font-bold text-lg tracking-wider opacity-90">{storeRank.storeName}</h3>{storeRank.isBottom5 && <span className="ml-auto bg-white/20 px-2 py-1 rounded text-xs font-bold flex items-center gap-1">需加強</span>}</div><div className="flex items-end gap-4 mb-2"><div><p className="text-white/80 text-xs font-bold uppercase mb-1">全區排名</p><div className="flex items-baseline gap-2"><span className="text-5xl font-extrabold font-mono text-white tracking-tighter">No.{storeRank.rank}</span><span className="text-white/60 font-bold text-sm">/ {storeRank.totalStores}</span></div></div><div className="flex-1 text-right"><p className="text-white/80 text-xs font-bold uppercase mb-1">目標達成率</p><p className="text-3xl font-mono font-bold text-white">{storeRank.rate.toFixed(0)}%</p></div></div><div className="mt-4 pt-4 border-t border-white/20 flex justify-between text-xs font-medium text-white/90"><span>目前業績: {fmtMoney(storeRank.actual)}</span><span>目標: {fmtMoney(storeRank.target)}</span></div></div></div> ))}</div>
            )}
            {userRole === 'manager' && myStoreRankings.length > 0 && (
              <div className="bg-white rounded-3xl border border-stone-200 shadow-xl overflow-hidden relative"><div className="bg-gradient-to-r from-amber-500 to-orange-600 p-6 flex justify-between items-center text-white relative overflow-hidden"><div className="absolute right-0 top-0 p-4 opacity-10"><Map size={100} /></div><div className="relative z-10 flex items-center gap-3"><div className="p-2 bg-white/20 rounded-xl backdrop-blur-md"><Crown size={24} className="text-white" /></div><div><h3 className="text-xl font-bold tracking-wide">區域門市戰情排行</h3><p className="text-amber-100 text-xs font-medium">Rankings & Performance</p></div></div><div className="relative z-10 text-right"><p className="text-xs text-amber-100 font-bold uppercase">管理店家數</p><p className="text-2xl font-mono font-bold text-white">{myStoreRankings.length}</p></div></div><div className="p-0 sm:p-2 overflow-x-auto"><table className="w-full text-left border-collapse min-w-[350px]"><thead><tr className="text-xs font-bold text-stone-400 border-b border-stone-100"><th className="p-3 sm:p-4 w-16 sm:w-20 text-center">排名</th><th className="p-3 sm:p-4">門市名稱</th><th className="p-3 sm:p-4 text-right">目前業績</th><th className="p-3 sm:p-4 text-right hidden sm:table-cell">目標金額</th><th className="p-3 sm:p-4 text-right">達成率</th></tr></thead><tbody>{myStoreRankings.map((store, idx) => (<tr key={store.storeName} className={`group transition-colors border-b last:border-0 border-stone-50 ${store.isBottom5 ? "bg-rose-50 hover:bg-rose-100" : "hover:bg-stone-50" }`}><td className="p-3 sm:p-4 text-center"><span className={`inline-flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full text-xs font-bold ${idx === 0 ? "bg-amber-100 text-amber-700" : idx === 1 ? "bg-stone-200 text-stone-600" : idx === 2 ? "bg-orange-100 text-orange-700" : "bg-stone-50 text-stone-400"}`}>{store.rank}</span></td><td className="p-3 sm:p-4"><div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2"><span className={`font-bold text-sm sm:text-base ${store.isBottom5 ? "text-rose-700" : "text-stone-700"}`}>{store.storeName}</span>{store.isBottom5 && (<span className="w-fit text-[10px] font-bold px-1.5 py-0.5 bg-rose-200 text-rose-700 rounded flex items-center gap-1 animate-pulse"><AlertTriangle size={10} /> <span className="hidden sm:inline">需關注</span></span>)}</div></td><td className="p-3 sm:p-4 text-right font-mono font-medium text-stone-600 text-sm sm:text-base">{fmtMoney(store.actual)}</td><td className="p-3 sm:p-4 text-right font-mono text-stone-400 text-sm hidden sm:table-cell">{fmtMoney(store.target)}</td><td className="p-3 sm:p-4 text-right"><div className="flex flex-col items-end"><span className={`text-base sm:text-lg font-bold font-mono ${store.isBottom5 ? "text-rose-600" : (store.rate >= 100 ? "text-emerald-500" : "text-amber-500")}`}>{store.rate.toFixed(0)}%</span><div className="w-16 sm:w-24 h-1 sm:h-1.5 bg-stone-100 rounded-full mt-1 overflow-hidden"><div className={`h-full rounded-full ${store.isBottom5 ? "bg-rose-500" : (store.rate >= 100 ? "bg-emerald-400" : "bg-amber-400")}`} style={{ width: `${Math.min(store.rate, 100)}%` }}></div></div></div></td></tr>))}</tbody></table></div></div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-3xl p-6 md:p-8 border border-stone-100 shadow-xl shadow-stone-200/50 relative overflow-hidden group"><div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-60"></div><div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 relative z-10"><div><div className="flex items-center gap-2 mb-2"><div className="p-1.5 bg-indigo-50 rounded-lg"><Activity size={16} className="text-indigo-500" /></div><span className="text-xs font-bold uppercase tracking-widest text-stone-400">營運節奏監控</span></div><h2 className="text-3xl md:text-4xl font-extrabold font-mono tracking-tight text-stone-700">Day {daysPassed} <span className="text-lg text-stone-300 font-sans">/ {daysInMonth}</span></h2></div><div className={`mt-4 md:mt-0 px-4 py-2 rounded-xl flex items-center gap-2 ${paceGap >= 0 ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-rose-50 text-rose-600 border border-rose-100"}`}><span className="text-sm font-bold">{paceGap >= 0 ? "超前進度" : "落後進度"}</span><span className="text-xl font-mono font-bold">{Math.abs(paceGap).toFixed(0)}%</span></div></div><div className="space-y-6 relative z-10"><div className="space-y-2"><div className="flex justify-between text-sm font-bold"><span className="text-stone-500">實際達成率</span><span className={totalAchievement >= timeProgress ? "text-emerald-500" : "text-rose-500"}>{totalAchievement.toFixed(0)}%</span></div><div className="w-full bg-stone-100 h-3 rounded-full overflow-hidden shadow-inner"><div className={`h-full rounded-full transition-all duration-1000 ${totalAchievement >= 100 ? "bg-gradient-to-r from-emerald-400 to-teal-400" : totalAchievement >= timeProgress ? "bg-emerald-400" : "bg-rose-400"}`} style={{ width: `${Math.min(totalAchievement, 100)}%` }} /></div></div><div className="space-y-2"><div className="flex justify-between text-sm font-medium"><span className="text-stone-400">時間進度 (應達)</span><span className="text-stone-400">{timeProgress.toFixed(0)}%</span></div><div className="w-full bg-stone-50 h-1.5 rounded-full overflow-hidden"><div className="h-full bg-stone-300 rounded-full" style={{ width: `${Math.min(timeProgress, 100)}%` }} /></div></div></div></div>
              <div className="bg-white rounded-3xl p-6 border border-stone-100 shadow-lg shadow-stone-100 flex flex-col justify-center relative overflow-hidden group"><div className="relative z-10"><p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1"><Target size={14} /> 月底現金推估</p><h3 className="text-3xl xl:text-4xl font-extrabold text-stone-700 font-mono mb-4">{fmtMoney(storeGrandTotal.projection)}</h3><div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold"><span>預估達成</span><span>{storeGrandTotal.budget > 0 ? ((storeGrandTotal.projection / storeGrandTotal.budget) * 100).toFixed(0) : 0}%</span></div><div className="mt-4 pt-4 border-t border-stone-50"><div className="flex justify-between items-center text-xs text-stone-400"><span>本月目標</span><span className="font-mono font-bold text-stone-500">{fmtMoney(storeGrandTotal.budget)}</span></div></div></div></div>
            </div>
            <div><h3 className="text-lg font-bold text-stone-700 mb-4 flex items-center gap-2 pl-1"><div className="w-1 h-6 bg-amber-500 rounded-full"></div>財務績效</h3><div className="grid grid-cols-1 md:grid-cols-3 gap-4"><MiniKpiCard title="總現金業績" value={fmtMoney(storeGrandTotal.cash)} icon={DollarSign} color="text-amber-500" subText={<span className={`font-bold ${totalAchievement >= 100 ? "text-emerald-600" : "text-amber-600"}`}>{totalAchievement.toFixed(0)}% 目標達成率</span>} /><MiniKpiCard title="總權責業績" value={fmtMoney(storeGrandTotal.accrual)} icon={CreditCard} color="text-cyan-500" subText="含技術操作與產品銷售" /><MiniKpiCard title="總保養品業績" value={fmtMoney(storeGrandTotal.skincareSales)} icon={ShoppingBag} color="text-rose-500" subText={<>佔權責 <span className="font-bold text-stone-700 ml-1">{storeGrandTotal.accrual > 0 ? ((storeGrandTotal.skincareSales / storeGrandTotal.accrual) * 100).toFixed(0) : 0}%</span></>} /></div></div>
            <div><h3 className="text-lg font-bold text-stone-700 mb-4 flex items-center gap-2 pl-1"><div className="w-1 h-6 bg-cyan-500 rounded-full"></div>營運效率與客流</h3><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4"><MiniKpiCard title="課程操作人數" value={fmtNum(storeGrandTotal.traffic)} icon={Users} color="text-blue-500" subText="本月累計操作人數" /><MiniKpiCard title="平均操作權責" value={fmtMoney(dashboardStats.avgTrafficASP)} icon={TrendingUp} color="text-indigo-500" subText={<span className={dashboardStats.avgTrafficASP >= targets.trafficASP ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>{dashboardStats.avgTrafficASP >= targets.trafficASP ? "達標" : "未達標"} (目標 {fmtNum(targets.trafficASP)})</span>} /><MiniKpiCard title="總新客數" value={fmtNum(storeGrandTotal.newCustomers)} icon={Sparkles} color="text-purple-500" subText="本月新增體驗人數" /><MiniKpiCard title="總新客留單" value={fmtNum(storeGrandTotal.newCustomerClosings)} icon={CheckSquare} color="text-teal-500" subText={<span>留單率 <span className="font-bold">{storeGrandTotal.newCustomers > 0 ? ((storeGrandTotal.newCustomerClosings / storeGrandTotal.newCustomers) * 100).toFixed(0) : 0}%</span></span>} /><MiniKpiCard title="新客平均客單" value={fmtMoney(dashboardStats.avgNewCustomerASP)} icon={Award} color="text-fuchsia-500" subText={<span className={dashboardStats.avgNewCustomerASP >= targets.newASP ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>{dashboardStats.avgNewCustomerASP >= targets.newASP ? "達標" : "未達標"} (目標 {fmtNum(targets.newASP)})</span>} /></div></div>
            <Card title={`${brandInfo.name} 日營運走勢`} subtitle="現金業績 vs 課程操作人數趨勢分析"><div className="h-[300px] w-full"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={dailyTotals} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" /><XAxis dataKey="date" stroke="#a8a29e" tick={{ fontSize: 12 }} dy={10} /><YAxis yAxisId="left" stroke="#a8a29e" tick={{ fontSize: 12 }} width={60} tickFormatter={(val) => val === 0 ? "0" : `$${(val / 1000).toFixed(0)}k`} /><YAxis yAxisId="right" orientation="right" stroke="#a8a29e" tick={{ fontSize: 12 }} tickFormatter={(val) => fmtNum(val)} /><RechartsTooltip contentStyle={{ borderRadius: "16px", border: "none", padding: "12px", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)", }} cursor={{ fill: "#fafaf9" }} formatter={(value, name) => { if (name === "現金業績") return [fmtMoney(value), name]; return [fmtNum(value), name]; }} /><Area yAxisId="left" type="monotone" dataKey="cash" name="現金業績" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} strokeWidth={3} /><Line yAxisId="right" type="monotone" dataKey="traffic" name="課程操作人數" stroke="#0ea5e9" strokeWidth={3} /></ComposedChart></ResponsiveContainer></div></Card>
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
              return ( <div className={`${bgClass} rounded-3xl p-6 text-white shadow-xl ${shadowClass} relative overflow-hidden transition-all duration-500`}> <div className="absolute top-0 right-0 p-4 opacity-10"><info.icon size={140} /></div> <div className="relative z-10 flex flex-col md:flex-row justify-between items-end gap-6"> <div> <div className="flex items-center gap-3 mb-2"><span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm flex items-center gap-1">{status === 'DANGER' && <Flame size={12} className="animate-pulse"/>}No.{therapistStats.myStats.rank}</span><span className="text-white/80 font-bold tracking-wider text-sm">{therapistStats.myStats.store}店</span></div><h2 className="text-3xl md:text-4xl font-extrabold mb-1">{therapistStats.myStats.name}</h2><div className="mt-2 p-3 bg-black/10 rounded-xl backdrop-blur-md border border-white/10 max-w-md"><p className="font-bold text-sm flex items-center gap-2">{status === 'DANGER' && <Frown size={16}/>}{info.title}</p><p className="text-xs text-white/70 mt-1">{info.sub}</p></div> </div> <div className="flex gap-6 text-right"> <div><p className="text-xs text-white/60 font-bold uppercase mb-1">個人總業績</p><p className="text-3xl font-mono font-bold">{fmtMoney(therapistStats.myStats.totalRevenue)}</p></div> <div><p className="text-xs text-white/60 font-bold uppercase mb-1">新客締結率</p><p className="text-3xl font-mono font-bold">{therapistStats.myStats.newClosingRate.toFixed(0)}%</p></div> </div> </div> </div> );
            })()}
            
            {(userRole !== 'therapist') && ( <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4"> <MiniKpiCard title="管理師總業績" value={fmtMoney(therapistStats.grandTotal.totalRevenue)} icon={DollarSign} color="text-indigo-500" subText={`${therapistStats.grandTotal.count} 位在職人員`} /> <MiniKpiCard title="管理師新客業績" value={fmtMoney(therapistStats.grandTotal.newCustomerRevenue)} icon={Sparkles} color="text-amber-500" /> <MiniKpiCard title="管理師舊客業績" value={fmtMoney(therapistStats.grandTotal.oldCustomerRevenue)} icon={TrendingUp} color="text-cyan-500" /> <MiniKpiCard title="管理師新舊客佔比" value={`${Math.round((therapistStats.grandTotal.newCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100)}% / ${Math.round((therapistStats.grandTotal.oldCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100)}%`} icon={Activity} color="text-fuchsia-500" subText="新客 / 舊客" /> <MiniKpiCard title="管理師退費總額" value={fmtMoney(therapistStats.grandTotal.returnRevenue)} icon={FileWarning} color="text-rose-500" /> </div> )}
            
            <Card title="管理師績效排行榜" subtitle="依本月個人總業績排序 (即時更新)">
              <div className="grid grid-cols-1 w-full">
                <div className="flex justify-end mb-4"><button onClick={handleExportCSV} className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors border border-emerald-100"><Download size={16} /> 匯出 CSV</button></div>
                <div className="overflow-x-auto w-full pb-2"><table className="w-full text-left border-collapse min-w-[1200px] whitespace-nowrap"><thead><tr className="text-xs font-bold text-stone-400 border-b border-stone-100 bg-stone-50/50"><th className="p-3 md:p-4 w-16 text-center">排名</th><th className="p-3 md:p-4">姓名</th><th className="p-3 md:p-4">所屬店家</th><th className="p-3 md:p-4 text-right">個人總業績</th><th className="p-3 md:p-4 text-right">新客業績</th><th className="p-3 md:p-4 text-right">舊客業績</th><th className="p-3 md:p-4 text-center">新舊客佔比</th><th className="p-3 md:p-4 text-right">新客締結率</th><th className="p-3 md:p-4 text-right">新客平均業績</th><th className="p-3 md:p-4 text-right">舊客平均業績</th></tr></thead><tbody className="text-sm">{therapistStats.rankings.filter(t => userRole !== 'therapist' || t.id === currentUser?.id).map((t, idx) => (<tr key={t.id} className={`border-b border-stone-50 hover:bg-stone-50 transition-colors ${currentUser?.id === t.id ? "bg-indigo-50 hover:bg-indigo-100" : ""}`}><td className="p-3 md:p-4 text-center"><span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${t.rank <= 3 ? "bg-amber-100 text-amber-700 ring-4 ring-amber-50" : t.status === "DANGER" ? "bg-rose-100 text-rose-700 ring-4 ring-rose-50" : "bg-stone-100 text-stone-500"}`}>{t.rank}</span></td><td className="p-3 md:p-4 font-bold text-stone-700 flex items-center gap-2">{t.name}{currentUser?.id === t.id && <span className="px-2 py-0.5 bg-indigo-200 text-indigo-700 text-[10px] rounded-full">ME</span>}{t.status === "DANGER" && <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-bold">加油</span>}</td><td className="p-3 md:p-4 text-stone-500">{t.store}店</td><td className="p-3 md:p-4 text-right font-mono font-bold text-indigo-600">{fmtMoney(t.totalRevenue)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtMoney(t.newCustomerRevenue)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtMoney(t.oldCustomerRevenue)}</td><td className="p-3 md:p-4 text-center font-mono text-xs text-stone-400">{t.revenueMix}</td><td className="p-3 md:p-4 text-right font-mono font-bold text-stone-700">{t.newClosingRate.toFixed(0)}%</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(Math.round(t.newAsp))}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(Math.round(t.oldAsp))}</td></tr>))} {therapistStats.rankings.length === 0 && (<tr><td colSpan={10} className="p-8 text-center text-stone-400">本月尚無資料</td></tr>)}</tbody></table></div>
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