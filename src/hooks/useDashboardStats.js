// src/hooks/useDashboardStats.js
import { useState, useMemo, useContext } from 'react';
import { AppContext } from '../AppContext';

export function useDashboardStats() {
  const { 
    targets, userRole, currentUser, 
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
    const y = parseInt(selectedYear); const m = parseInt(selectedMonth);
    const daysInMonth = new Date(y, m, 0).getDate();
    const now = new Date(); let daysPassed = daysInMonth; let isCurrentMonth = false;
    
    if (now.getFullYear() === y && (now.getMonth() + 1) === m) {
        daysPassed = Math.max(0, now.getDate() - 1); 
        isCurrentMonth = true;
    } else if (now < new Date(y, m - 1, 1)) { daysPassed = 0; }

    const stats = {
      cash: 0, accrual: 0, operationalAccrual: 0, skincareSales: 0, traffic: 0,
      newCustomers: 0, newCustomerClosings: 0, newCustomerSales: 0,
      budget: 0, accrualBudget: 0, challengeBudget: 0, challengeAccrualBudget: 0, 
      hasChallengeCash: false, hasChallengeAccrual: false,
      dailyData: Array.from({ length: daysInMonth }, (_, i) => ({ date: `${m}/${i + 1}`, day: i + 1, cash: 0, traffic: 0 }))
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
      if (brandPrefix === '安妞') accrual = operationalAccrual; 

      const actualDay = rDate.getDate();
      if (cash !== 0 || traffic !== 0 || accrual !== 0 || operationalAccrual !== 0 || skincareSales !== 0) {
         if (actualDay > maxDataDay) maxDataDay = actualDay;
      }

      stats.cash += cash; stats.accrual += accrual; stats.operationalAccrual += operationalAccrual; stats.newCustomerSales += (Number(report.newCustomerSales) || 0);
      stats.skincareSales += skincareSales; stats.traffic += traffic; stats.newCustomers += (Number(report.newCustomers) || 0); stats.newCustomerClosings += (Number(report.newCustomerClosings) || 0);

      const dayIndex = rDate.getDate() - 1;
      if (stats.dailyData[dayIndex]) {
        stats.dailyData[dayIndex].cash += cash; stats.dailyData[dayIndex].traffic += traffic;
      }
    });

    if (isCurrentMonth) {
        if (maxDataDay > daysPassed) daysPassed = maxDataDay;
        if (daysPassed > now.getDate()) daysPassed = now.getDate();
    }

    effectiveStores.forEach(storeName => {
        const fullName = `${brandPrefix}${storeName}店`;
        const budgetKey = `${fullName}_${y}_${m}`;
        const b = budgets[budgetKey];
        if (b) {
            const baseCash = Number(b.cashTarget) || 0; const baseAccrual = Number(b.accrualTarget) || 0;
            const chalCash = Number(b.challengeCashTarget) || 0; const chalAccrual = Number(b.challengeAccrualTarget) || 0;
            stats.budget += baseCash; stats.accrualBudget += baseAccrual;
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
    if (isCurrentMonth) chartDays = Math.max(1, daysPassed); 
    else if (daysPassed === 0) chartDays = 0;
    const slicedDailyTotals = stats.dailyData.slice(0, chartDays);

    return {
      grandTotal: {
        cash: stats.cash, accrual: stats.accrual, operationalAccrual: stats.operationalAccrual, skincareSales: stats.skincareSales, traffic: stats.traffic,
        newCustomers: stats.newCustomers, newCustomerClosings: stats.newCustomerClosings, newCustomerSales: stats.newCustomerSales,
        budget: stats.budget, accrualBudget: stats.accrualBudget, challengeBudget: stats.challengeBudget, challengeAccrualBudget: stats.challengeAccrualBudget, 
        hasChallengeCash: stats.hasChallengeCash, hasChallengeAccrual: stats.hasChallengeAccrual, projection, accrualProjection   
      },
      dailyTotals: slicedDailyTotals,
      totalAchievement: achievement, totalAccrualAchievement: accrualAchievement, challengeAchievement, challengeAccrualAchievement, 
      avgTrafficASP, avgNewCustomerASP, daysPassed, daysInMonth, newRevMix, oldRevMix, newCountMix, oldCountMix    
    };
  }, [allReports, budgets, selectedYear, selectedMonth, effectiveStores, brandPrefix, cleanName]);

  const myStoreRankings = useMemo(() => {
    if ((userRole !== 'store' && userRole !== 'manager' && userRole !== 'director') || !allReports) return [];
    const storeStats = {}; const y = parseInt(selectedYear); const m = parseInt(selectedMonth);

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
        storeName, actual, target, rate, challengeTarget, challengeRate,   
        hasChallenge: challengeTarget > 0, passedChallenge: challengeTarget > 0 && actual >= challengeTarget 
      };
    });

    rankingList.sort((a, b) => b.rate - a.rate);
    const fullRankedList = rankingList.map((item, index) => ({ 
      ...item, rank: index + 1, totalStores: rankingList.length, isBottom5: (index + 1) > (rankingList.length - 5) 
    }));
    
    return fullRankedList.filter(item => {
        const cleanItemName = cleanName(item.storeName);
        return effectiveStores.includes(cleanItemName);
    });
  }, [userRole, allReports, effectiveStores, budgets, selectedYear, selectedMonth, cleanName, brandPrefix]);

  const therapistStats = useMemo(() => {
    if (!therapistReports) return { rankings: [], myStats: null, grandTotal: {}, yesterdayTop3: [] };
    const currentMonthReports = therapistReports.filter(r => {
      const dStr = r.date.replace(/-/g, "/"); const d = new Date(dStr);
      const isTargetMonth = d.getFullYear() === parseInt(selectedYear) && (d.getMonth() + 1) === parseInt(selectedMonth);
      if (!isTargetMonth) return false;
      const rStoreClean = cleanName(r.storeName);
      if (!effectiveStores.includes(rStoreClean)) return false;
      return true;
    });

    const statsMap = {};
    currentMonthReports.forEach(r => {
      const id = r.therapistId; const rStoreClean = cleanName(r.storeName); const reportTime = new Date(r.date.replace(/-/g, "/")).getTime();
      if (!statsMap[id]) { 
        statsMap[id] = { 
          id, name: r.therapistName, latestDate: reportTime, storeDisplay: rStoreClean,    
          totalRevenue: 0, serviceCount: 0, newCustomerRevenue: 0, oldCustomerRevenue: 0,
          newCustomerCount: 0, oldCustomerCount: 0, newCustomerClosings: 0, returnRevenue: 0 
        }; 
      } else {
          if (reportTime > statsMap[id].latestDate) {
              statsMap[id].latestDate = reportTime; statsMap[id].storeDisplay = rStoreClean;
          }
      }
      statsMap[id].totalRevenue += (Number(r.totalRevenue) || 0); statsMap[id].serviceCount += (Number(r.serviceCount) || 0);
      statsMap[id].newCustomerRevenue += (Number(r.newCustomerRevenue) || 0); statsMap[id].oldCustomerRevenue += (Number(r.oldCustomerRevenue) || 0);
      statsMap[id].newCustomerCount += (Number(r.newCustomerCount) || 0); statsMap[id].oldCustomerCount += (Number(r.oldCustomerCount) || 0);
      statsMap[id].newCustomerClosings += (Number(r.newCustomerClosings) || 0); statsMap[id].returnRevenue += (Number(r.returnRevenue) || 0);
    });

    const rankings = Object.values(statsMap).map(item => {
        const total = item.totalRevenue || 1; 
        const newMix = Math.round((item.newCustomerRevenue / total) * 100); const oldMix = Math.round((item.oldCustomerRevenue / total) * 100);
        const newCount = item.newCustomerCount || 1; const newRate = (item.newCustomerClosings / newCount) * 100;
        const oldCount = item.oldCustomerCount || 1; const newAsp = item.newCustomerRevenue / newCount; const oldAsp = item.oldCustomerRevenue / oldCount;
        const finalStoreDisplay = item.storeDisplay + '店';
        const isSystemStaff = therapists && Array.isArray(therapists) && therapists.some(t => t.id === item.id);
        return { ...item, storeDisplay: finalStoreDisplay, revenueMix: `${newMix}% / ${oldMix}%`, newClosingRate: newRate, newAsp, oldAsp, isSystemStaff };
    }).sort((a, b) => b.totalRevenue - a.totalRevenue);

    const totalTherapists = rankings.length;
    rankings.forEach((item, index) => { 
        item.rank = index + 1; item.totalPeers = totalTherapists;
        if (item.rank <= 3) item.status = "TOP";
        else if (item.rank > totalTherapists - 10) item.status = "DANGER";
        else item.status = "NORMAL";
        item.gapToNext = index > 0 ? rankings[index - 1].totalRevenue - item.totalRevenue : 0;
    });
    
    let myStats = null;
    if (userRole === 'therapist' && currentUser) { myStats = rankings.find(r => r.id === currentUser.id); }
    
    // ★ 更新：將「新客數量」與「新客締結數」一併加總，以供大盤雷達運算
    const grandTotal = rankings.reduce((acc, curr) => ({ 
        totalRevenue: acc.totalRevenue + curr.totalRevenue, serviceCount: acc.serviceCount + curr.serviceCount, 
        newCustomerRevenue: acc.newCustomerRevenue + curr.newCustomerRevenue, oldCustomerRevenue: acc.oldCustomerRevenue + curr.oldCustomerRevenue,
        returnRevenue: acc.returnRevenue + curr.returnRevenue,
        newCustomerCount: acc.newCustomerCount + curr.newCustomerCount,
        newCustomerClosings: acc.newCustomerClosings + curr.newCustomerClosings
    }), { totalRevenue: 0, serviceCount: 0, newCustomerRevenue: 0, oldCustomerRevenue: 0, returnRevenue: 0, newCustomerCount: 0, newCustomerClosings: 0 });
    
    // ★ 新增：大盤雷達指標運算
    grandTotal.regionalNewClosingRate = grandTotal.newCustomerCount > 0 ? (grandTotal.newCustomerClosings / grandTotal.newCustomerCount) * 100 : 0;
    grandTotal.regionalNewAsp = grandTotal.newCustomerCount > 0 ? (grandTotal.newCustomerRevenue / grandTotal.newCustomerCount) : 0;

    let systemTherapistCount = 0;
    if (therapists && Array.isArray(therapists)) {
        systemTherapistCount = therapists.filter(t => { return effectiveStores.includes(cleanName(t.store)); }).length;
    }
    grandTotal.count = systemTherapistCount;

    // ★ 新增：計算昨日全區前三名戰神
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    const yesterdayMap = {};
    
    therapistReports.forEach(r => {
        if (r.date === yStr && effectiveStores.includes(cleanName(r.storeName))) {
            if (!yesterdayMap[r.therapistId]) yesterdayMap[r.therapistId] = { id: r.therapistId, name: r.therapistName, revenue: 0 };
            yesterdayMap[r.therapistId].revenue += (Number(r.totalRevenue) || 0);
        }
    });
    const yesterdayTop3 = Object.values(yesterdayMap).sort((a,b) => b.revenue - a.revenue).slice(0, 3);

    return { rankings, myStats, grandTotal, yesterdayTop3 };
  }, [therapistReports, selectedYear, selectedMonth, effectiveStores, cleanName, userRole, currentUser, therapists]);

  return {
    viewMode, setViewMode,
    selectedDashboardManager, setSelectedDashboardManager,
    selectedDashboardStore, setSelectedDashboardStore,
    brandInfo, brandPrefix,
    dashboardStats, myStoreRankings, therapistStats,
    dailyLoginCount, yesterdayLoginCount,
    groupedStoresForFilter, availableStoresForDropdown
  };
}