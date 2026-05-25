// src/hooks/useDashboardStats.js
import { useState, useMemo, useContext, useEffect } from 'react';
import { AppContext } from '../AppContext';
// ★ 新增了 collection 與 getDocs，讓我們一次把全公司的專屬小抄都抓下來
import { doc, getDoc, collection, getDocs } from 'firebase/firestore'; 
import { db } from '../config/firebase';

export function useDashboardStats() {
  const { 
    targets, userRole, currentUser, 
    allReports, budgets, managers, selectedYear, selectedMonth, therapistReports,
    currentBrand, therapists, dailyLoginCount, yesterdayLoginCount,
    therapistAnnualAggregatedData, getCollectionPath 
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
  
  // ==========================================
  // ★ 升級版：一次抓取「全集團所有門市」的專屬推估小抄 (包含現金與權責)
  // ==========================================
  const [allStoreCurves, setAllStoreCurves] = useState({});
  
  useEffect(() => {
      const fetchAllCurves = async () => {
          if (!brandInfo || !brandInfo.id) return;
          try {
              const colRef = collection(db, "brands", brandInfo.id, "settings", "projection_curves", "stores");
              const snap = await getDocs(colRef);
              const dataDict = {};
              snap.forEach(doc => {
                  // ★ 改為存取「整包資料」，才能拿到獨立的現金與權責小抄
                  dataDict[doc.id] = doc.data(); 
              });
              setAllStoreCurves(dataDict);
          } catch (e) {
              console.error("讀取金額小抄失敗:", e);
          }
      };
      fetchAllCurves();
  }, [brandInfo]);

  const cleanName = useMemo(() => (name) => {
    if (!name) return "";
    let core = String(name).replace(new RegExp(`^(${brandPrefix}|CYJ|Anew|Yibo|安妞|伊啵)`, 'i'), '').trim();
    if (core === "新店") return "新店"; 
    return core.replace(/店$/, '').trim();
  }, [brandPrefix]);

  const baseVisibleStores = useMemo(() => {
    if (userRole === 'director' || userRole === 'trainer' || userRole === 'therapist' || userRole === 'master') {
      return Object.values(managers || {}).flat().map(cleanName).filter(Boolean);
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
    if (selectedDashboardStore) return [cleanName(selectedDashboardStore)];
    if (selectedDashboardManager) return (managers[selectedDashboardManager] || []).map(cleanName).filter(Boolean);
    return baseVisibleStores;
  }, [baseVisibleStores, selectedDashboardStore, selectedDashboardManager, managers, cleanName]);

  const allCompanyStores = useMemo(() => {
    const stores = new Set();
    if (allReports) {
      allReports.forEach(r => { if (r.storeName) stores.add(cleanName(r.storeName)); });
    }
    if (therapistReports) {
      therapistReports.forEach(r => { if (r.storeName) stores.add(cleanName(r.storeName)); });
    }
    return Array.from(stores).filter(Boolean);
  }, [allReports, therapistReports, cleanName]);

  const therapistEffectiveStores = useMemo(() => {
    if (selectedDashboardStore) return [cleanName(selectedDashboardStore)];
    if (selectedDashboardManager && managers[selectedDashboardManager]) {
        return managers[selectedDashboardManager].map(cleanName).filter(Boolean);
    }
    return allCompanyStores; 
  }, [selectedDashboardStore, selectedDashboardManager, managers, allCompanyStores, cleanName]);

  // ==========================================
  // ★ Dashboard Summary v1：安全過渡版 summary-first
  // 先嘗試讀取維護中心建立好的 summary；若不存在或不適用，仍會 fallback 原本明細計算。
  // ==========================================
  const [dashboardSummaryBundle, setDashboardSummaryBundle] = useState({
    dashboard: null,
    therapist: null,
    rankings: null,
    ready: false,
    error: null,
  });

  const selectedYearMonth = useMemo(() => {
    const y = String(selectedYear || "");
    const m = String(selectedMonth || "").padStart(2, "0");
    return y && m ? `${y}-${m}` : "";
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    let cancelled = false;

    const fetchDashboardSummaries = async () => {
      if (!getCollectionPath || !selectedYearMonth) {
        if (!cancelled) setDashboardSummaryBundle({ dashboard: null, therapist: null, rankings: null, ready: true, error: null });
        return;
      }

      try {
        const [dashboardSnap, therapistSnap, rankingsSnap] = await Promise.all([
          getDoc(doc(getCollectionPath("dashboard_summary"), selectedYearMonth)),
          getDoc(doc(getCollectionPath("therapist_summary"), selectedYearMonth)),
          getDoc(doc(getCollectionPath("rankings_summary"), selectedYearMonth)),
        ]);

        if (cancelled) return;

        setDashboardSummaryBundle({
          dashboard: dashboardSnap.exists() ? { id: dashboardSnap.id, ...dashboardSnap.data() } : null,
          therapist: therapistSnap.exists() ? { id: therapistSnap.id, ...therapistSnap.data() } : null,
          rankings: rankingsSnap.exists() ? { id: rankingsSnap.id, ...rankingsSnap.data() } : null,
          ready: true,
          error: null,
        });
      } catch (error) {
        console.warn("Dashboard Summary 讀取失敗，將使用明細計算 fallback：", error);
        if (!cancelled) setDashboardSummaryBundle({ dashboard: null, therapist: null, rankings: null, ready: true, error });
      }
    };

    setDashboardSummaryBundle(prev => ({ ...prev, ready: false, error: null }));
    fetchDashboardSummaries();

    return () => { cancelled = true; };
  }, [getCollectionPath, selectedYearMonth]);

  const isSelectedCurrentMonth = useMemo(() => {
    const now = new Date();
    return Number(selectedYear) === now.getFullYear() && Number(selectedMonth) === now.getMonth() + 1;
  }, [selectedYear, selectedMonth]);

  const isFullBrandDashboardView = useMemo(() => {
    // ★ 即時戰情保護：當月仍使用明細計算，避免晚上陸續回報時，Summary 尚未重建而造成今日排行榜/走勢/營運節奏不更新。
    // Summary 先用於歷史月份與已結算月份；當月即時 Dashboard 等 App.jsx 載入分流完成後再進入下一階段。
    if (isSelectedCurrentMonth) return false;
    if (selectedDashboardManager || selectedDashboardStore) return false;
    if (!dashboardSummaryBundle.dashboard?.stores) return false;

    // Summary v1 的 dailyTotals 目前是全品牌日線，尚未儲存「各店每日日線」。
    // 因此第一版只在全品牌視角使用 summary，避免區長/店經理篩選時圖表不一致。
    if (!(userRole === "director" || userRole === "master" || userRole === "trainer" || userRole === "therapist")) return false;

    return true;
  }, [isSelectedCurrentMonth, selectedDashboardManager, selectedDashboardStore, dashboardSummaryBundle.dashboard, userRole]);

  const buildProjectionFromSummaryStores = useMemo(() => (stores = [], daysPassed = 0, daysInMonth = 0) => {
    if (!daysPassed || !daysInMonth || !Array.isArray(stores)) return { projection: 0, accrualProjection: 0 };
    const y = parseInt(selectedYear, 10);
    const m = parseInt(selectedMonth, 10);
    let projection = 0;
    let accrualProjection = 0;

    stores.forEach((store) => {
      const storeCore = cleanName(store.store || store.displayName || "");
      const storeId = storeCore.replace(/\s+/g, "").toLowerCase();
      const storeCurve = allStoreCurves[storeId] || allStoreCurves["BRAND_TOTAL"] || {};
      const cashAverages = storeCurve.cashAverages || {};
      const accrualAverages = storeCurve.accrualAverages || {};

      const currentCash = Number(store.cash) || 0;
      const currentAccrual = Number(store.accrual) || 0;
      const currentCashDailyAvg = currentCash / daysPassed;
      const currentAccrualDailyAvg = currentAccrual / daysPassed;

      let remainingProjectedCash = 0;
      let remainingProjectedAccrual = 0;

      for (let d = daysPassed + 1; d <= daysInMonth; d++) {
        const futureDate = new Date(y, m - 1, d);
        const dow = futureDate.getDay();

        const historyCashValue = cashAverages[dow] !== undefined ? cashAverages[dow] : currentCashDailyAvg;
        const blendedCashValue = historyCashValue > currentCashDailyAvg
          ? (currentCashDailyAvg * 0.5) + (historyCashValue * 0.5)
          : Math.max(currentCashDailyAvg, historyCashValue);
        remainingProjectedCash += blendedCashValue;

        const historyAccrualValue = accrualAverages[dow] !== undefined ? accrualAverages[dow] : currentAccrualDailyAvg;
        const blendedAccrualValue = historyAccrualValue > currentAccrualDailyAvg
          ? (currentAccrualDailyAvg * 0.5) + (historyAccrualValue * 0.5)
          : Math.max(currentAccrualDailyAvg, historyAccrualValue);
        remainingProjectedAccrual += blendedAccrualValue;
      }

      projection += Math.round(currentCash + remainingProjectedCash);
      accrualProjection += Math.round(currentAccrual + remainingProjectedAccrual);
    });

    return { projection, accrualProjection };
  }, [selectedYear, selectedMonth, cleanName, allStoreCurves]);

  const summaryDashboardStats = useMemo(() => {
    const summary = dashboardSummaryBundle.dashboard;
    if (!summary || !isFullBrandDashboardView) return null;

    const y = parseInt(selectedYear, 10);
    const m = parseInt(selectedMonth, 10);
    const daysInMonth = new Date(y, m, 0).getDate();
    const now = new Date();
    let daysPassed = daysInMonth;
    let isCurrentMonth = false;

    // ★ 營運節奏維持原本邏輯：
    // 當月預設用「系統日 - 1 天」，避免主管白天查看時，把尚未結束營業的今天算進應達進度。
    // 只有當 summary.dailyTotals 偵測到今日已經有有效回報數據時，才推進到系統日。
    const rawDailyTotals = Array.isArray(summary.dailyTotals) ? summary.dailyTotals : [];
    const getDailyDayNumber = (row, index) => Number(row?.day || index + 1);
    const hasMeaningfulDailyData = (row) => {
      if (!row || typeof row !== "object") return false;
      return Object.entries(row).some(([key, value]) => {
        if (["day", "date", "label"].includes(key)) return false;
        return typeof value === "number" && value !== 0;
      });
    };
    const maxDataDay = rawDailyTotals.reduce((max, row, index) => {
      const day = getDailyDayNumber(row, index);
      return hasMeaningfulDailyData(row) && day > max ? day : max;
    }, 0);

    if (now.getFullYear() === y && (now.getMonth() + 1) === m) {
      daysPassed = Math.max(0, now.getDate() - 1);
      isCurrentMonth = true;
      if (maxDataDay > daysPassed) daysPassed = maxDataDay;
      if (daysPassed > now.getDate()) daysPassed = now.getDate();
    } else if (now < new Date(y, m - 1, 1)) {
      daysPassed = 0;
    }

    const stores = Object.values(summary.stores || {});
    const grand = { ...(summary.grandTotal || {}) };
    const projectionPayload = buildProjectionFromSummaryStores(stores, daysPassed, daysInMonth);

    grand.hasChallengeCash = Number(grand.challengeBudget || 0) > Number(grand.budget || 0);
    grand.hasChallengeAccrual = Number(grand.challengeAccrualBudget || 0) > Number(grand.accrualBudget || 0);
    grand.projection = projectionPayload.projection || Number(grand.projection || 0);
    grand.accrualProjection = projectionPayload.accrualProjection || Number(grand.accrualProjection || 0);

    const totalAchievement = Number(grand.budget || 0) > 0 ? (Number(grand.cash || 0) / Number(grand.budget || 0)) * 100 : 0;
    const totalAccrualAchievement = Number(grand.accrualBudget || 0) > 0 ? (Number(grand.accrual || 0) / Number(grand.accrualBudget || 0)) * 100 : 0;
    const challengeAchievement = Number(grand.challengeBudget || 0) > 0 ? (Number(grand.cash || 0) / Number(grand.challengeBudget || 0)) * 100 : 0;
    const challengeAccrualAchievement = Number(grand.challengeAccrualBudget || 0) > 0 ? (Number(grand.accrual || 0) / Number(grand.challengeAccrualBudget || 0)) * 100 : 0;

    const avgTrafficASP = Number(grand.traffic || 0) > 0 ? Math.round(Number(grand.operationalAccrual || 0) / Number(grand.traffic || 0)) : 0;
    const avgNewCustomerASP = Number(grand.newCustomers || 0) > 0 ? Math.round(Number(grand.newCustomerSales || 0) / Number(grand.newCustomers || 0)) : 0;
    const newRevMix = Number(grand.cash || 0) > 0 ? Math.round((Number(grand.newCustomerSales || 0) / Number(grand.cash || 0)) * 100) : 0;
    const oldRevMix = Number(grand.cash || 0) > 0 ? Math.max(0, 100 - newRevMix) : 0;
    const newCountMix = Number(grand.traffic || 0) > 0 ? Math.round((Number(grand.newCustomers || 0) / Number(grand.traffic || 0)) * 100) : 0;
    const oldCountMix = Number(grand.traffic || 0) > 0 ? Math.max(0, 100 - newCountMix) : 0;

    let chartDays = daysInMonth;
    if (isCurrentMonth) chartDays = Math.max(1, daysPassed);
    else if (daysPassed === 0) chartDays = 0;

    const dailyTotals = (summary.dailyTotals || []).slice(0, chartDays);

    const mapStoreTop = (rows = []) => rows.map((item) => ({
      name: item.name || item.displayName || (item.store ? `${item.store}店` : ""),
      revenue: Number(item.revenue ?? item.cash ?? 0),
      streak: false,
      badgeText: "",
    }));

    return {
      grandTotal: grand,
      dailyTotals,
      totalAchievement,
      totalAccrualAchievement,
      challengeAchievement,
      challengeAccrualAchievement,
      avgTrafficASP,
      avgNewCustomerASP,
      daysPassed,
      daysInMonth,
      newRevMix,
      oldRevMix,
      newCountMix,
      oldCountMix,
      storeMonthlyTop3: mapStoreTop(summary.storeTop3?.monthly),
      storeTodayTop3: mapStoreTop(summary.storeTop3?.today),
      storeYesterdayTop3: mapStoreTop(summary.storeTop3?.yesterday),
      source: "summary",
      summaryLastUpdatedAtText: summary.lastUpdatedAtText || "",
    };
  }, [dashboardSummaryBundle.dashboard, isFullBrandDashboardView, selectedYear, selectedMonth, buildProjectionFromSummaryStores]);

  const summaryMyStoreRankings = useMemo(() => {
    // ★ 當月門市排行也必須即時，避免主管或店長看到未更新的 Summary 排名。
    if (isSelectedCurrentMonth) return null;
    const summary = dashboardSummaryBundle.dashboard;
    if (!summary || userRole !== "store" || !currentUser) return null;

    const rawStores = currentUser.stores || [currentUser.storeName];
    const myCores = rawStores.map(cleanName).filter(Boolean);
    const allRanks = Array.isArray(summary.storeRankings) ? summary.storeRankings : Object.values(summary.stores || []);

    return allRanks
      .filter((s) => myCores.includes(cleanName(s.store || s.displayName || "")))
      .map((s) => {
        const actual = Number(s.cash || 0);
        const target = Number(s.budget || 0);
        const challengeTarget = Number(s.challengeBudget || 0) || target;
        const hasChallenge = challengeTarget > target;
        const rate = target > 0 ? (actual / target) * 100 : 0;
        const challengeRate = challengeTarget > 0 ? (actual / challengeTarget) * 100 : 0;
        return {
          storeName: s.displayName || `${cleanName(s.store)}店`,
          rank: s.rank || 0,
          totalStores: allRanks.length,
          actual,
          target,
          rate,
          challengeTarget,
          hasChallenge,
          challengeRate,
          passedChallenge: hasChallenge && challengeRate >= 100,
          isBottom5: s.rank > Math.max(0, allRanks.length - 5),
        };
      });
  }, [dashboardSummaryBundle.dashboard, userRole, currentUser, cleanName, isSelectedCurrentMonth]);

  const summaryTherapistStats = useMemo(() => {
    // ★ 即時戰情保護：當月人員績效仍用明細計算，避免管理師晚上陸續回報後，今日戰神/排行榜不即時更新。
    if (isSelectedCurrentMonth) return null;
    const summary = dashboardSummaryBundle.therapist;
    if (!summary) return null;

    const normalizeStoreDisplay = (value) => cleanName(value || "").replace(/店$/, "") + "店";
    const selectedStores = new Set((therapistEffectiveStores || []).map(cleanName).filter(Boolean));
    const useFilter = selectedDashboardManager || selectedDashboardStore;

    let rankings = Array.isArray(summary.rankings) ? summary.rankings.map((item) => ({ ...item })) : [];
    if (useFilter && selectedStores.size > 0) {
      rankings = rankings.filter((item) => selectedStores.has(cleanName(item.store || item.storeDisplay || "")));
    }

    rankings = rankings
      .sort((a, b) => Number(b.totalRevenue || 0) - Number(a.totalRevenue || 0))
      .map((item, index, arr) => ({
        ...item,
        storeDisplay: item.storeDisplay || normalizeStoreDisplay(item.store),
        rank: index + 1,
        totalPeers: arr.length,
        revenueMix: item.revenueMix || `${Number(item.newCustomerRevenue || 0)} / ${Number(item.oldCustomerRevenue || 0)}`,
        newClosingRate: Number(item.newClosingRate || 0),
        newAsp: Number(item.newAsp || 0),
        oldAsp: Number(item.oldAsp || 0),
        status: index < 3 ? "TOP" : index >= Math.max(0, arr.length - 10) ? "DANGER" : "NORMAL",
      }));

    const myStats = userRole === "therapist"
      ? rankings.find((item) => item.id === currentUser?.id || item.name === currentUser?.name) || null
      : null;

    const grandTotal = rankings.reduce((acc, item) => {
      acc.totalRevenue += Number(item.totalRevenue || 0);
      acc.serviceCount += Number(item.serviceCount || 0);
      acc.newCustomerRevenue += Number(item.newCustomerRevenue || 0);
      acc.oldCustomerRevenue += Number(item.oldCustomerRevenue || 0);
      acc.newCustomerCount += Number(item.newCustomerCount || 0);
      acc.oldCustomerCount += Number(item.oldCustomerCount || 0);
      acc.newCustomerClosings += Number(item.newCustomerClosings || 0);
      acc.returnRevenue += Number(item.returnRevenue || 0);
      return acc;
    }, { totalRevenue: 0, serviceCount: 0, newCustomerRevenue: 0, oldCustomerRevenue: 0, newCustomerCount: 0, oldCustomerCount: 0, newCustomerClosings: 0, returnRevenue: 0, count: rankings.length });

    grandTotal.regionalNewClosingRate = grandTotal.newCustomerCount > 0 ? (grandTotal.newCustomerClosings / grandTotal.newCustomerCount) * 100 : 0;
    grandTotal.regionalNewAsp = grandTotal.newCustomerCount > 0 ? grandTotal.newCustomerRevenue / grandTotal.newCustomerCount : 0;

    const filterTopRows = (rows = []) => {
      const list = Array.isArray(rows) ? rows : [];
      if (!useFilter || selectedStores.size === 0) return list;
      return list.filter((item) => selectedStores.has(cleanName(item.store || item.storeDisplay || "")));
    };

    let myYearlyTotal = 0;
    if (userRole === 'therapist' && currentUser && therapistAnnualAggregatedData && Array.isArray(therapistAnnualAggregatedData)) {
      const myYearData = therapistAnnualAggregatedData.find(d => d.therapistId === currentUser.id || d.therapistName === currentUser.name);
      if (myYearData) {
        myYearlyTotal = Object.keys(myYearData).reduce((sum, key) => {
          if (/^\d{1,2}$/.test(key) || key.startsWith('month_')) return sum + (Number(myYearData[key]) || 0);
          return sum;
        }, 0);
      }
    }

    return {
      rankings,
      myStats,
      grandTotal,
      yesterdayTop3: filterTopRows(summary.yesterdayTop3),
      todayTop3: filterTopRows(summary.todayTop3),
      myYearlyTotal,
      source: "summary",
      summaryLastUpdatedAtText: summary.lastUpdatedAtText || "",
    };
  }, [dashboardSummaryBundle.therapist, therapistEffectiveStores, selectedDashboardManager, selectedDashboardStore, cleanName, userRole, currentUser, therapistAnnualAggregatedData]);


  const detailDashboardStats = useMemo(() => {
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

    // ★ 新增：為了 Bottom-Up 推估，我們需要在這裡先把資料「按門市分類」整理好
    const storeStatsMap = {}; 

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

      // 幫每間門市建立自己的迷你資料庫，等等才能獨立算推估
      if (!storeStatsMap[reportStoreClean]) {
          storeStatsMap[reportStoreClean] = {
              cash: 0, accrual: 0, 
              dailyData: Array.from({ length: daysInMonth }, () => ({ cash: 0 }))
          };
      }
      storeStatsMap[reportStoreClean].cash += cash;
      storeStatsMap[reportStoreClean].accrual += accrual;
      storeStatsMap[reportStoreClean].dailyData[dayIndex].cash += cash;
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

    const getStoreTop3Global = (targetDateStr) => {
        const storeMap = {};
        allReports.forEach(r => {
            if (r.date === targetDateStr) {
                const sName = cleanName(r.storeName) + '店';
                if (!storeMap[sName]) storeMap[sName] = 0;
                storeMap[sName] += (Number(r.cash) || 0) - (Number(r.refund) || 0);
            }
        });
        return Object.entries(storeMap)
            .map(([name, revenue]) => ({ name, revenue }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 3);
    };

    const todayObj = new Date();
    const tStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth()+1).padStart(2,'0')}-${String(todayObj.getDate()).padStart(2,'0')}`;
    const yesterdayObj = new Date(); yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    const yStr = `${yesterdayObj.getFullYear()}-${String(yesterdayObj.getMonth()+1).padStart(2,'0')}-${String(yesterdayObj.getDate()).padStart(2,'0')}`;

    const rawTodayTop3 = getStoreTop3Global(tStr);
    const rawYesterdayTop3 = getStoreTop3Global(yStr);

    const storeMonthlyMap = {};
    allReports.forEach(r => {
        const rDate = new Date(r.date);
        if (rDate.getFullYear() === y && (rDate.getMonth() + 1) === m) {
            const sName = cleanName(r.storeName) + '店';
            if (!storeMonthlyMap[sName]) storeMonthlyMap[sName] = 0;
            storeMonthlyMap[sName] += (Number(r.cash) || 0) - (Number(r.refund) || 0);
        }
    });
    const rawMonthlyTop3 = Object.entries(storeMonthlyMap)
        .map(([name, revenue]) => ({ name, revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 3);
    
    const storeTodayTop3 = rawTodayTop3.map(s => {
        const isStreak = rawYesterdayTop3.some(yest => yest.name === s.name);
        return { ...s, streak: isStreak, badgeText: "沒打算讓" };
    });

    const storeYesterdayTop3 = rawYesterdayTop3.map(s => {
        const inMonth = rawMonthlyTop3.some(mo => mo.name === s.name);
        return { ...s, streak: inMonth, badgeText: "底氣十足" };
    });

    const storeMonthlyTop3 = rawMonthlyTop3.map(s => {
        const inToday = rawTodayTop3.some(today => today.name === s.name);
        const inYesterday = rawYesterdayTop3.some(yest => yest.name === s.name);
        const isStreak = inToday || inYesterday;
        let txt = "穩如泰山";
        if (inToday && inYesterday) txt = "無人能擋";
        else if (inToday) txt = "火力全開";
        else if (inYesterday) txt = "緊咬不放";
        return { ...s, streak: isStreak, badgeText: txt };
    });

    const achievement = stats.budget > 0 ? (stats.cash / stats.budget) * 100 : 0;
    const accrualAchievement = stats.accrualBudget > 0 ? (stats.accrual / stats.accrualBudget) * 100 : 0;
    const challengeAchievement = stats.challengeBudget > 0 ? (stats.cash / stats.challengeBudget) * 100 : 0;
    const challengeAccrualAchievement = stats.challengeAccrualBudget > 0 ? (stats.accrual / stats.challengeAccrualBudget) * 100 : 0;

 // ============================================================================
    // ★ 歷史金額填補法 (現金與權責 雙軌獨立 50/50 融合版)
    // ============================================================================
    let projection = 0;
    let accrualProjection = 0;

    if (daysPassed > 0) {
        Object.keys(storeStatsMap).forEach(storeName => {
            const sStats = storeStatsMap[storeName];
            const storeId = storeName.replace(/\s+/g, '').toLowerCase();
            
            // 拿到這家店的整包小抄
            const storeCurve = allStoreCurves[storeId] || allStoreCurves["BRAND_TOTAL"] || {};
            
            // ★ 分別拿出「現金小抄」與「權責小抄」
            // ★ 拔除 dailyAverages 墊檔！強迫系統只讀取純現金與純權責的歷史！
            const cashAverages = storeCurve.cashAverages || {};
            const accrualAverages = storeCurve.accrualAverages || {};

            // 算出這家店本月目前的「現金日均」與「權責日均」
            const currentCashDailyAvg = sStats.cash / daysPassed;
            const currentAccrualDailyAvg = sStats.accrual / daysPassed;
            
            let remainingProjectedCash = 0;
            let remainingProjectedAccrual = 0;

            for (let d = daysPassed + 1; d <= daysInMonth; d++) {
                const futureDate = new Date(y, m - 1, d);
                const dow = futureDate.getDay();
                
                // ----------------------------------------------------
                // 🍏 【現金推估軌道】(保留您最滿意的 50/50 邏輯)
                // ----------------------------------------------------
                const historyCashValue = (cashAverages[dow] !== undefined) 
                    ? cashAverages[dow] 
                    : currentCashDailyAvg;
                
                let blendedCashValue = historyCashValue;

                if (historyCashValue > currentCashDailyAvg) {
                    blendedCashValue = (currentCashDailyAvg * 0.5) + (historyCashValue * 0.5);
                } else {
                    blendedCashValue = Math.max(currentCashDailyAvg, historyCashValue);
                }
                remainingProjectedCash += blendedCashValue;

                // ----------------------------------------------------
                // 🍊 【權責推估軌道】(完全比照辦理，獨立使用權責小抄)
                // ----------------------------------------------------
                const historyAccrualValue = (accrualAverages[dow] !== undefined) 
                    ? accrualAverages[dow] 
                    : currentAccrualDailyAvg;
                
                let blendedAccrualValue = historyAccrualValue;

                if (historyAccrualValue > currentAccrualDailyAvg) {
                    // 權責也享有 50/50 的動能校正！
                    blendedAccrualValue = (currentAccrualDailyAvg * 0.5) + (historyAccrualValue * 0.5);
                } else {
                    blendedAccrualValue = Math.max(currentAccrualDailyAvg, historyAccrualValue);
                }
                remainingProjectedAccrual += blendedAccrualValue;
            }

            // 分別把推估好的未來金額，加上目前已入袋的金額
            projection += Math.round(sStats.cash + remainingProjectedCash);
            accrualProjection += Math.round(sStats.accrual + remainingProjectedAccrual);
        });
    }
    // ===========================================================================
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
      avgTrafficASP, avgNewCustomerASP, daysPassed, daysInMonth, newRevMix, oldRevMix, newCountMix, oldCountMix,
      storeMonthlyTop3, storeTodayTop3, storeYesterdayTop3 
    };
  // ★ 監視清單換成了包含全部小抄的字典
  }, [allReports, budgets, selectedYear, selectedMonth, effectiveStores, brandPrefix, cleanName, allStoreCurves]);

  const detailMyStoreRankings = useMemo(() => {
    if (!allReports) return [];
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
  }, [allReports, effectiveStores, budgets, selectedYear, selectedMonth, cleanName, brandPrefix]);

  const detailTherapistStats = useMemo(() => {
    if (!therapistReports) return { rankings: [], myStats: null, grandTotal: {}, yesterdayTop3: [], todayTop3: [], myYearlyTotal: 0 }; 
    
    const currentMonthReports = therapistReports.filter(r => {
      const dStr = r.date.replace(/-/g, "/"); const d = new Date(dStr);
      const isTargetMonth = d.getFullYear() === parseInt(selectedYear) && (d.getMonth() + 1) === parseInt(selectedMonth);
      if (!isTargetMonth) return false;
      const rStoreClean = cleanName(r.storeName);
      if (!therapistEffectiveStores.includes(rStoreClean)) return false;
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
        
        const matchedTherapist = therapists && Array.isArray(therapists) ? therapists.find(t => t.id === item.id) : null;
        const isSystemStaff = !!matchedTherapist;
        const latestName = matchedTherapist ? matchedTherapist.name : item.name;

        return { 
            ...item, 
            name: latestName, 
            storeDisplay: finalStoreDisplay, 
            revenueMix: `${newMix}% / ${oldMix}%`, 
            newClosingRate: newRate, 
            newAsp, 
            oldAsp, 
            isSystemStaff 
        };
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
    let myYearlyTotal = 0; 

    if (userRole === 'therapist' && currentUser) { 
        myStats = rankings.find(r => r.id === currentUser.id); 

        if (therapistAnnualAggregatedData) {
            const pastMonthsTotal = therapistAnnualAggregatedData
                .filter(d => d.therapistId === currentUser.id && d.yearMonth !== `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`)
                .reduce((sum, d) => sum + (Number(d.totalRevenue) || 0), 0);
            
            const currentMonthTotal = myStats ? myStats.totalRevenue : 0;
            myYearlyTotal = pastMonthsTotal + currentMonthTotal;
        }
    }
    
    const grandTotal = rankings.reduce((acc, curr) => ({ 
        totalRevenue: acc.totalRevenue + curr.totalRevenue, serviceCount: acc.serviceCount + curr.serviceCount, 
        newCustomerRevenue: acc.newCustomerRevenue + curr.newCustomerRevenue, oldCustomerRevenue: acc.oldCustomerRevenue + curr.oldCustomerRevenue,
        returnRevenue: acc.returnRevenue + curr.returnRevenue,
        newCustomerCount: acc.newCustomerCount + curr.newCustomerCount,
        newCustomerClosings: acc.newCustomerClosings + curr.newCustomerClosings
    }), { totalRevenue: 0, serviceCount: 0, newCustomerRevenue: 0, oldCustomerRevenue: 0, returnRevenue: 0, newCustomerCount: 0, newCustomerClosings: 0 });
    
    let globalNewCustomerSales = 0;
    let globalNewCustomers = 0;
    let globalNewCustomerClosings = 0;
    
    if (allReports) {
        allReports.forEach(report => {
            const rDate = new Date(report.date);
            if (rDate.getFullYear() === parseInt(selectedYear) && (rDate.getMonth() + 1) === parseInt(selectedMonth)) {
                if (therapistEffectiveStores.includes(cleanName(report.storeName))) {
                    globalNewCustomerSales += (Number(report.newCustomerSales) || 0);
                    globalNewCustomers += (Number(report.newCustomers) || 0);
                    globalNewCustomerClosings += (Number(report.newCustomerClosings) || 0);
                }
            }
        });
    }

    grandTotal.regionalNewClosingRate = globalNewCustomers > 0 ? (globalNewCustomerClosings / globalNewCustomers) * 100 : 0;
    grandTotal.regionalNewAsp = globalNewCustomers > 0 ? (globalNewCustomerSales / globalNewCustomers) : 0;

    let systemTherapistCount = 0;
    if (therapists && Array.isArray(therapists)) {
        systemTherapistCount = therapists.filter(t => { return therapistEffectiveStores.includes(cleanName(t.store)); }).length;
    }
    grandTotal.count = systemTherapistCount;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    const yesterdayMap = {};
    
    therapistReports.forEach(r => {
        if (r.date === yStr && therapistEffectiveStores.includes(cleanName(r.storeName))) {
            if (!yesterdayMap[r.therapistId]) {
                yesterdayMap[r.therapistId] = { 
                    id: r.therapistId, 
                    name: r.therapistName, 
                    storeDisplay: cleanName(r.storeName || r.store || "") ? cleanName(r.storeName || r.store || "") + '店' : "", 
                    revenue: 0 
                };
            }
            yesterdayMap[r.therapistId].revenue += (Number(r.totalRevenue) || 0);
        }
    });
    
    const yesterdayTop3 = Object.values(yesterdayMap).sort((a,b) => b.revenue - a.revenue).slice(0, 3);
    yesterdayTop3.forEach(t => {
        const matchedTherapist = rankings.find(r => r.id === t.id);
        if (matchedTherapist && matchedTherapist.storeDisplay) { t.storeDisplay = matchedTherapist.storeDisplay; } 
        else if (!t.storeDisplay || t.storeDisplay === "店") { t.storeDisplay = "未知店"; }
    });

    const today = new Date();
    const tStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const todayMap = {};

    therapistReports.forEach(r => {
        if (r.date === tStr && therapistEffectiveStores.includes(cleanName(r.storeName))) {
            if (!todayMap[r.therapistId]) {
                todayMap[r.therapistId] = { 
                    id: r.therapistId, 
                    name: r.therapistName, 
                    storeDisplay: cleanName(r.storeName || r.store || "") ? cleanName(r.storeName || r.store || "") + '店' : "", 
                    revenue: 0 
                };
            }
            todayMap[r.therapistId].revenue += (Number(r.totalRevenue) || 0);
        }
    });

    const todayTop3 = Object.values(todayMap).sort((a,b) => b.revenue - a.revenue).slice(0, 3);
    todayTop3.forEach(t => {
        const matchedTherapist = rankings.find(r => r.id === t.id);
        if (matchedTherapist && matchedTherapist.storeDisplay) { t.storeDisplay = matchedTherapist.storeDisplay; } 
        else if (!t.storeDisplay || t.storeDisplay === "店") { t.storeDisplay = "未知店"; }
    });

    return { rankings, myStats, grandTotal, yesterdayTop3, todayTop3, myYearlyTotal };
  }, [therapistReports, selectedYear, selectedMonth, therapistEffectiveStores, allReports, cleanName, userRole, currentUser, therapists, therapistAnnualAggregatedData]);

  const dashboardStats = summaryDashboardStats || detailDashboardStats;
  const myStoreRankings = summaryMyStoreRankings || detailMyStoreRankings;
  const therapistStats = summaryTherapistStats || detailTherapistStats;

  return {
    viewMode, setViewMode,
    selectedDashboardManager, setSelectedDashboardManager,
    selectedDashboardStore, setSelectedDashboardStore,
    brandInfo, brandPrefix,
    dashboardStats, myStoreRankings, therapistStats,
    dashboardSummaryStatus: {
      ready: dashboardSummaryBundle.ready,
      usingDashboardSummary: Boolean(summaryDashboardStats),
      usingTherapistSummary: Boolean(summaryTherapistStats),
      error: dashboardSummaryBundle.error,
      yearMonth: selectedYearMonth,
    },
    dailyLoginCount, yesterdayLoginCount,
    groupedStoresForFilter, availableStoresForDropdown
  };
}