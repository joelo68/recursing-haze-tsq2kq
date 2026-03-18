// src/components/DashboardView.jsx
import React, { useContext, useMemo, useState, useEffect, useRef } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Line, ComposedChart, Area } from "recharts";
import { 
  TrendingUp, DollarSign, Target, Users, Award, Loader2, CheckSquare, Activity, 
  Sparkles, ShoppingBag, CreditCard, FileWarning, Trophy, Medal, AlertTriangle, 
  Crown, Map as MapIcon, User, Store as StoreIcon, ArrowRight, ArrowLeft, Frown, 
  Flame, Zap, Download, PieChart, Star, 
  // 引入 Icon
  MessageSquare, Bot, Send, X, Key
} from "lucide-react";
import { ViewWrapper, Card } from "./SharedUI";
import { formatNumber } from "../utils/helpers";
import { AppContext } from "../AppContext";

// ==========================================
// ★★★ 系統全域 Gemini API Key (企業共用版) ★★★
// 請將您申請到的 Key 貼在下方的引號中，例如: "AIzaSyxxxxxxxxx"
// 只要在這裡填入，所有區長與高管登入後就會自動共用這把鑰匙，不需再手動設定！
// ==========================================
const SYSTEM_GEMINI_KEY = "AIzaSyDlSKy0ktpTJFxa2mZL2RU6fbBtB1dBNus"; 

const DashboardView = () => {
  const { 
    fmtMoney, fmtNum, targets, userRole, currentUser, 
    allReports, budgets, managers, selectedYear, selectedMonth, therapistReports,
    currentBrand 
  } = useContext(AppContext);

  const [viewMode, setViewMode] = useState((userRole === 'therapist' || userRole === 'trainer' || userRole === 'manager') ? 'therapist' : 'store');
  const [selectedDashboardManager, setSelectedDashboardManager] = useState("");
  const [selectedDashboardStore, setSelectedDashboardStore] = useState("");

  // ==========================================
  // ★★★ AI 助理專用狀態 (Phase 1.5) ★★★
  // ==========================================
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);
  const [showAIConfig, setShowAIConfig] = useState(false);
  
  // ★ 升級：優先讀取系統全域金鑰，若無才讀取本機記憶體
  const [geminiApiKey, setGeminiApiKey] = useState(() => {
    if (SYSTEM_GEMINI_KEY && SYSTEM_GEMINI_KEY.length > 10) {
        return SYSTEM_GEMINI_KEY;
    }
    return localStorage.getItem("drcyj_gemini_key") || "";
  });

  const [aiInput, setAiInput] = useState("");
  const [isAILoading, setIsAILoading] = useState(false);
  
  // 取得品牌核心資訊（用於顏色判斷）
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

  // ★ 初始化 AI 對話 (加入動態問候語)
  const [aiMessages, setAiMessages] = useState(() => {
    const userName = currentUser?.name || (userRole === 'director' ? '總監' : userRole === 'manager' ? '區長' : '主管');
    return [
      { role: "model", text: `${userName} 您好！我是 DRCYJ 專屬營運分析師 🤖\n我已經讀取了目前的【全區深度營運數據】。\n請問您想進行哪方面的深入分析呢？\n(例如：「幫我找出新客締結率最低的人」、「目前的業績達成率有跟上時間進度嗎？」)` }
    ];
  });

  const messagesEndRef = useRef(null);

  useEffect(() => {
    const userName = currentUser?.name || (userRole === 'director' ? '總監' : userRole === 'manager' ? '區長' : '主管');
    setAiMessages(prev => {
        const newMsgs = [...prev];
        if (newMsgs.length > 0 && newMsgs[0].role === 'model' && newMsgs[0].text.includes('營運分析師 🤖')) {
            newMsgs[0].text = `${userName} 您好！我是 DRCYJ 專屬營運分析師 🤖\n我已經讀取了目前的【全區深度營運數據】。\n請問您想進行哪方面的深入分析呢？\n(例如：「幫我找出新客締結率最低的人」、「目前的業績達成率有跟上時間進度嗎？」)`;
        }
        return newMsgs;
    });
  }, [currentUser, userRole]);

  // ★★★ 設計 AI 聊天視窗的品牌配色 ★★★
  const aiTheme = useMemo(() => {
    const brandId = brandInfo.id;
    if (brandId.includes('anniu') || brandId.includes('anew')) {
        return {
            fab: 'bg-teal-500 hover:bg-teal-600 shadow-teal-100',
            ping: 'bg-teal-400',
            header: 'bg-teal-600 text-white',
            headerIcon: 'text-teal-100',
            userMsg: 'bg-teal-500 text-white',
            sendBtn: 'bg-teal-600'
        };
    } else if (brandId.includes('yibo')) {
        return {
            fab: 'bg-purple-500 hover:bg-purple-600 shadow-purple-100',
            ping: 'bg-purple-400',
            header: 'bg-purple-600 text-white',
            headerIcon: 'text-purple-100',
            userMsg: 'bg-purple-500 text-white',
            sendBtn: 'bg-purple-600'
        };
    } else {
        return {
            fab: 'bg-amber-500 hover:bg-amber-600 shadow-amber-100',
            ping: 'bg-orange-400',
            header: 'bg-amber-500 text-amber-950', 
            headerIcon: 'text-amber-800',
            userMsg: 'bg-amber-500 text-amber-950', 
            sendBtn: 'bg-amber-600'
        };
    }
  }, [brandInfo]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => { scrollToBottom(); }, [aiMessages, isAIChatOpen]);

  const handleSaveApiKey = () => {
    localStorage.setItem("drcyj_gemini_key", geminiApiKey.trim());
    setShowAIConfig(false);
    alert("Gemini API Key 已儲存！您可以開始對話了。");
  };

  useEffect(() => {
    setSelectedDashboardManager("");
    setSelectedDashboardStore("");
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
        projection
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

        return { ...item, storeDisplay: finalStoreDisplay, revenueMix: `${newMix}% / ${oldMix}%`, newClosingRate: newRate, newAsp, oldAsp };
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
  }, [therapistReports, selectedYear, selectedMonth, effectiveStores, cleanName, userRole, currentUser]);

  // ==========================================
  // ★★★ 發送 AI 訊息的邏輯 (Phase 1.5 深度數據注入版) ★★★
  // ==========================================
  const handleSendToAI = async () => {
    if (!aiInput.trim() || !geminiApiKey) {
      if (!geminiApiKey) {
         alert("請先點擊右上角 🔑 設定您的 Gemini API Key！");
         setShowAIConfig(true);
      }
      return;
    }

    const currentKey = geminiApiKey.trim(); 
    const newMsg = { role: "user", text: aiInput };
    
    setAiMessages(prev => [...prev, newMsg]);
    setAiInput("");
    setIsAILoading(true);

    try {
      const { grandTotal, totalAchievement, daysPassed, daysInMonth, avgTrafficASP, avgNewCustomerASP, newCountMix, oldCountMix } = dashboardStats;
      const timeProgress = daysInMonth > 0 ? (daysPassed / daysInMonth) * 100 : 0;
      
      const detailedStores = myStoreRankings.length > 0 
        ? myStoreRankings.map(s => `- ${s.storeName}: 業績 ${fmtNum(s.actual)} (目標 ${fmtNum(s.target)}, 達成率 ${s.rate.toFixed(1)}%)`).join("\n      ")
        : "本區/本店目前尚無業績排名資料。";

      const detailedTherapists = therapistStats.rankings.length > 0
        ? therapistStats.rankings.map(t => `- ${t.name}(${t.storeDisplay}): 業績 ${fmtNum(t.totalRevenue)}, 新客締結率 ${t.newClosingRate.toFixed(0)}%, 新客均單 ${fmtNum(Math.round(t.newAsp))}, 舊客均單 ${fmtNum(Math.round(t.oldAsp))}`).join("\n      ")
        : "本月尚無人員績效資料。";

      const dailyTrend = dashboardStats.dailyTotals.map(d => `${d.date}(業績${fmtNum(d.cash)},客流${d.traffic})`).join("、");

      const userNameForPrompt = currentUser?.name || '主管';

      const systemPrompt = `
      你現在是 DRCYJ 醫美集團的高階數據分析師，正在向「${userNameForPrompt}」進行營運匯報。
      請根據以下【本月所有深度數據】回答使用者的問題。
      你的回答不僅要給出表面數字，還要「主動比較、找出異常點、分析落後原因，並給出具體的管理或銷售建議」。
      如果被問到跨月、跨年或系統沒有的深度數據（例如保養品庫存細節），請誠實告知「抱歉，目前畫面中沒有這項數據可以供我分析」。
      回答請保持專業、語氣誠懇、條理分明（建議多用條列式）。

      【全區核心指標總覽】
      - 總現金業績: ${fmtNum(grandTotal.cash)} (目標: ${fmtNum(grandTotal.budget)}, 達成率: ${totalAchievement.toFixed(1)}%)
      - 月底推估現金: ${fmtNum(grandTotal.projection)}
      - 總保養品業績: ${fmtNum(grandTotal.skincareSales)}
      - 總服務客流: ${fmtNum(grandTotal.traffic)} 人 (新客佔 ${newCountMix}%, 舊客佔 ${oldCountMix}%)
      - 總新客體驗人數: ${fmtNum(grandTotal.newCustomers)} 人 (留單數: ${fmtNum(grandTotal.newCustomerClosings)})
      - 全區平均操作客單價: ${fmtNum(avgTrafficASP)} / 新客平均客單價: ${fmtNum(avgNewCustomerASP)}
      - 目前時間進度: ${timeProgress.toFixed(1)}% (已過 ${daysPassed} 天 / 本月 ${daysInMonth} 天)

      【每日營運趨勢概況 (依日期排列)】
      ${dailyTrend}

      【各門市詳細業績與達成率清單】
      ${detailedStores}

      【全區管理師詳細績效排行榜 (包含締結率與客單價)】
      ${detailedTherapists}

      【分析師守則】
      1. 當使用者問「誰最差」、「哪裡有問題」，請務必分析「達成率」、「新客締結率」或「客單價」。
      2. 任何店或人的達成率如果低於目前的時間進度 (${timeProgress.toFixed(1)}%)，就代表進度落後，必須點名並提醒。
      `;

      const apiContents = [];
      aiMessages.slice(1).forEach(msg => { 
        apiContents.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.text }]
        });
      });
      apiContents.push({ role: "user", parts: [{ text: newMsg.text }] });

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] }, 
          contents: apiContents
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const specificError = errorData?.error?.message || `HTTP 狀態碼: ${response.status}`;
        throw new Error(specificError);
      }

      const data = await response.json();
      const aiReply = data.candidates[0].content.parts[0].text;
      
      setAiMessages(prev => [...prev, { role: "model", text: aiReply }]);

    } catch (error) {
      console.error("Gemini API Error Detail:", error);
      setAiMessages(prev => [...prev, { 
        role: "model", 
        text: `❌ 抱歉，Google 伺服器拒絕了請求。\n\n【錯誤代碼】\n${error.message}\n\n💡 常見解決方式：\n1. API Key 不正確，請點擊右上角 🔑 重新貼上。\n2. 若您剛申請 Key，Google 可能需要幾分鐘時間開通。\n3. 您發問的問題過長超出了限制。`
      }]);
    } finally {
      setIsAILoading(false);
    }
  };


  const handleExportCSV = () => {
    const dataToExport = therapistStats.rankings.filter(t => userRole !== 'therapist' || t.id === currentUser?.id);
    const headers = ["排名,姓名,所屬店家,個人總業績,新客業績,舊客業績,新舊客佔比,新客締結率,新客人數,新客留單數,新客平均業績,舊客平均業績"];
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
        
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2 px-2 animate-in fade-in slide-in-from-left-2 duration-500">
            <div className="flex items-center gap-3 shrink-0">
                <div className={`w-2 h-8 rounded-full ${brandInfo.id.toLowerCase().includes('anniu') ? 'bg-teal-500' : brandInfo.id.toLowerCase().includes('yibo') ? 'bg-purple-500' : 'bg-amber-500'}`}></div>
                <h1 className="text-2xl font-bold text-stone-700">{brandInfo.name} 營運總覽</h1>
            </div>

            {(userRole === 'director' || userRole === 'trainer' || userRole === 'manager') && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar pb-1 sm:pb-0">
                    
                    {(userRole === 'director' || userRole === 'trainer') && (
                        <select
                            value={selectedDashboardManager}
                            onChange={(e) => {
                                setSelectedDashboardManager(e.target.value);
                                setSelectedDashboardStore(""); 
                            }}
                            className="px-4 py-2.5 border border-stone-200 rounded-xl text-sm font-bold text-stone-600 outline-none focus:border-amber-400 bg-white shadow-sm cursor-pointer min-w-[120px] hover:border-stone-300 transition-colors"
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
                        className="px-4 py-2.5 border border-stone-200 rounded-xl text-sm font-bold text-stone-600 outline-none focus:border-amber-400 bg-white shadow-sm cursor-pointer min-w-[140px] hover:border-stone-300 transition-colors"
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

        {userRole !== 'therapist' && userRole !== 'trainer' && (
          <div className="flex justify-center mb-4">
            <div className="bg-stone-200 p-1 rounded-2xl flex shadow-inner">
               <button onClick={() => setViewMode('store')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${viewMode === 'store' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}><StoreIcon size={16}/> 門市營運</button>
               <button onClick={() => setViewMode('therapist')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${viewMode === 'therapist' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}><User size={16}/> 人員績效</button>
            </div>
          </div>
        )}

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
            
            {/* 時間進度與預估 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-3xl p-6 md:p-8 border border-stone-100 shadow-xl shadow-stone-200/50 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-60"></div>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 relative z-10">
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
                
                <div className="space-y-6 relative z-10">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm font-bold">
                      <span className="text-stone-500">實際達成率 (預算)</span>
                      <span className={totalAchievement >= timeProgress ? "text-emerald-500" : "text-rose-500"}>{totalAchievement.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-stone-100 h-3 rounded-full overflow-hidden shadow-inner">
                      <div className={`h-full rounded-full transition-all duration-1000 ${totalAchievement >= 100 ? "bg-gradient-to-r from-emerald-400 to-teal-400" : totalAchievement >= timeProgress ? "bg-emerald-400" : "bg-rose-400"}`} style={{ width: `${Math.min(totalAchievement, 100)}%` }} />
                    </div>
                  </div>
                  
                  {storeGrandTotal.hasChallengeCash && (
                     <div className="space-y-2 pt-2">
                       <div className="flex justify-between text-sm font-bold">
                         <span className="text-amber-600 flex items-center gap-1"><Star size={14} className="fill-amber-500"/> 挑戰目標達成率 (加碼)</span>
                         <span className={dashboardStats.challengeAchievement >= 100 ? "text-amber-500 drop-shadow-sm" : "text-amber-600/70"}>
                           {dashboardStats.challengeAchievement.toFixed(0)}%
                         </span>
                       </div>
                       <div className="w-full bg-amber-50 h-2.5 rounded-full overflow-hidden border border-amber-100">
                         <div 
                           className={`h-full rounded-full transition-all duration-1000 ${dashboardStats.challengeAchievement >= 100 ? "bg-gradient-to-r from-amber-400 to-yellow-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]" : "bg-amber-300"}`} 
                           style={{ width: `${Math.min(dashboardStats.challengeAchievement, 100)}%` }} 
                         />
                       </div>
                     </div>
                  )}

                  <div className="space-y-2 border-t border-stone-50 pt-2">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-stone-400">時間進度 (應達)</span>
                      <span className="text-stone-400">{timeProgress.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-stone-50 h-1.5 rounded-full overflow-hidden">
                      <div className="h-full bg-stone-300 rounded-full" style={{ width: `${Math.min(timeProgress, 100)}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-3xl p-6 border border-stone-100 shadow-lg shadow-stone-100 flex flex-col justify-center relative overflow-hidden group">
                <div className="relative z-10">
                  <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1"><Target size={14} /> 月底現金推估</p>
                  <h3 className="text-3xl xl:text-4xl font-extrabold text-stone-700 font-mono mb-4">{fmtMoney(storeGrandTotal.projection)}</h3>
                  
                  <div className="flex flex-col gap-2 items-start">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold border border-emerald-100">
                      <span>{storeGrandTotal.hasChallengeCash ? '預算預估達成' : '預估達成'}</span>
                      <span className="text-sm">{storeGrandTotal.budget > 0 ? ((storeGrandTotal.projection / storeGrandTotal.budget) * 100).toFixed(0) : 0}%</span>
                    </div>
                    {storeGrandTotal.hasChallengeCash && (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-bold border border-amber-100 shadow-sm">
                        <Star size={12} className="fill-amber-500 text-amber-500 -mr-1" />
                        <span>挑戰預估達成</span>
                        <span className="text-sm">{storeGrandTotal.challengeBudget > 0 ? ((storeGrandTotal.projection / storeGrandTotal.challengeBudget) * 100).toFixed(0) : 0}%</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-stone-50 flex flex-col gap-1">
                    <div className="flex justify-between items-center text-xs text-stone-400">
                      <span>預算目標</span><span className="font-mono font-bold text-stone-500">{fmtMoney(storeGrandTotal.budget)}</span>
                    </div>
                    {storeGrandTotal.hasChallengeCash && (
                      <div className="flex justify-between items-center text-xs text-amber-500/80">
                        <span>挑戰目標</span><span className="font-mono font-bold">{fmtMoney(storeGrandTotal.challengeBudget)}</span>
                      </div>
                    )}
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
                
                <MiniKpiCard title="總保養品業績" value={fmtMoney(storeGrandTotal.skincareSales)} icon={ShoppingBag} color="text-rose-500" subText={<>佔權責 <span className="font-bold text-stone-700 ml-1">{storeGrandTotal.accrual > 0 ? ((storeGrandTotal.skincareSales / storeGrandTotal.accrual) * 100).toFixed(0) : 0}%</span></>} />
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
            
            {(userRole !== 'therapist' || userRole === 'trainer') && ( <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4"> <MiniKpiCard title="管理師總業績" value={fmtMoney(therapistStats.grandTotal.totalRevenue)} icon={DollarSign} color="text-indigo-500" subText={`${therapistStats.grandTotal.count} 位在職人員`} /> <MiniKpiCard title="管理師新客業績" value={fmtMoney(therapistStats.grandTotal.newCustomerRevenue)} icon={Sparkles} color="text-amber-500" /> <MiniKpiCard title="管理師舊客業績" value={fmtMoney(therapistStats.grandTotal.oldCustomerRevenue)} icon={TrendingUp} color="text-cyan-500" /> <MiniKpiCard title="管理師新舊客佔比" value={`${Math.round((therapistStats.grandTotal.newCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100)}% / ${Math.round((therapistStats.grandTotal.oldCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100)}%`} icon={Activity} color="text-fuchsia-500" subText="新客 / 舊客" /> <MiniKpiCard title="管理師退費總額" value={fmtMoney(therapistStats.grandTotal.returnRevenue)} icon={FileWarning} color="text-rose-500" /> </div> )}
            
            <Card title="管理師績效排行榜" subtitle="依本月個人總業績排序 (即時更新)">
              <div className="grid grid-cols-1 w-full">
                <div className="flex justify-end mb-4"><button onClick={handleExportCSV} className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors border border-emerald-100"><Download size={16} /> 匯出 CSV</button></div>
                <div className="overflow-x-auto w-full pb-2"><table className="w-full text-left border-collapse min-w-[1200px] whitespace-nowrap"><thead><tr className="text-xs font-bold text-stone-400 border-b border-stone-100 bg-stone-50/50"><th className="p-3 md:p-4 w-16 text-center">排名</th><th className="p-3 md:p-4">姓名</th><th className="p-3 md:p-4">所屬店家</th><th className="p-3 md:p-4 text-right">個人總業績</th><th className="p-3 md:p-4 text-right">新客業績</th><th className="p-3 md:p-4 text-right">舊客業績</th><th className="p-3 md:p-4 text-center">新舊客佔比</th><th className="p-3 md:p-4 text-right">新客締結率</th><th className="p-3 md:p-4 text-right">新客人數</th><th className="p-3 md:p-4 text-right">新客留單數</th><th className="p-3 md:p-4 text-right">新客平均業績</th><th className="p-3 md:p-4 text-right">舊客平均業績</th></tr></thead><tbody className="text-sm">{therapistStats.rankings.filter(t => userRole !== 'therapist' || t.id === currentUser?.id).map((t, idx) => (<tr key={t.id} className={`border-b border-stone-50 hover:bg-stone-50 transition-colors ${currentUser?.id === t.id ? "bg-indigo-50 hover:bg-indigo-100" : ""}`}><td className="p-3 md:p-4 text-center"><span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${t.rank <= 3 ? "bg-amber-100 text-amber-700 ring-4 ring-amber-50" : t.status === "DANGER" ? "bg-rose-100 text-rose-700 ring-4 ring-rose-50" : "bg-stone-100 text-stone-500"}`}>{t.rank}</span></td><td className="p-3 md:p-4 font-bold text-stone-700 flex items-center gap-2">{t.name}{currentUser?.id === t.id && <span className="px-2 py-0.5 bg-indigo-200 text-indigo-700 text-[10px] rounded-full">ME</span>}{t.status === "DANGER" && <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-bold">加油</span>}</td><td className="p-3 md:p-4 text-stone-500">{t.storeDisplay}</td><td className="p-3 md:p-4 text-right font-mono font-bold text-indigo-600">{fmtMoney(t.totalRevenue)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtMoney(t.newCustomerRevenue)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtMoney(t.oldCustomerRevenue)}</td><td className="p-3 md:p-4 text-center font-mono text-xs text-stone-400">{t.revenueMix}</td><td className="p-3 md:p-4 text-right font-mono font-bold text-stone-700">{t.newClosingRate.toFixed(0)}%</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(t.newCustomerCount)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(t.newCustomerClosings)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(Math.round(t.newAsp))}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(Math.round(t.oldAsp))}</td></tr>))} {therapistStats.rankings.length === 0 && (<tr><td colSpan={12} className="p-8 text-center text-stone-400">本月尚無資料</td></tr>)}</tbody></table></div>
                <div className="md:hidden py-2 text-center text-stone-400 text-xs flex justify-center items-center gap-1 bg-stone-50 rounded-b-xl border-t border-stone-100"><ArrowLeft size={12}/> 左右滑動以查看更多 <ArrowRight size={12}/></div>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* ========================================== */}
      {/* ★★★ AI 助理聊天懸浮視窗 (僅開放給區長、高管、教專) ★★★ */}
      {/* ========================================== */}
      
      {(userRole === 'director' || userRole === 'manager' || userRole === 'trainer') && (
        <>
          {!isAIChatOpen && (
            <button 
              onClick={() => setIsAIChatOpen(true)}
              className={`fixed bottom-6 right-6 p-4 ${aiTheme.fab} text-white rounded-full shadow-2xl transition-transform hover:scale-110 flex items-center justify-center group z-50`}
            >
              <Bot size={28} className="group-hover:animate-bounce" />
              <div className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${aiTheme.ping} opacity-75`}></span>
                <span className={`relative inline-flex rounded-full h-4 w-4 ${aiTheme.ping}`}></span>
              </div>
            </button>
          )}

          {isAIChatOpen && (
            <div className="fixed bottom-6 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-96 bg-white rounded-3xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] border border-stone-200 z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300" style={{ height: 'min(600px, 80vh)' }}>
              
              <div className={`${aiTheme.header} p-4 flex items-center justify-between shrink-0 shadow-sm`}>
                <div className="flex items-center gap-2">
                  <Bot size={20} className={aiTheme.headerIcon} />
                  <h3 className="font-bold text-sm">DRCYJ 營運分析師</h3>
                </div>
                <div className="flex items-center gap-1">
                  {/* ★ 若尚未設定全域 Key，才顯示鑰匙按鈕，避免其他人誤按 */}
                  {(!SYSTEM_GEMINI_KEY || SYSTEM_GEMINI_KEY.length < 10) && (
                    <button onClick={() => setShowAIConfig(!showAIConfig)} className="p-1.5 hover:bg-black/10 rounded-lg transition-colors" title="設定 API Key">
                      <Key size={16} />
                    </button>
                  )}
                  <button onClick={() => setIsAIChatOpen(false)} className="p-1.5 hover:bg-black/10 rounded-lg transition-colors">
                    <X size={20} />
                  </button>
                </div>
              </div>

              {showAIConfig && (
                <div className="p-4 bg-amber-50 border-b border-amber-100 shrink-0">
                  <p className="text-xs text-amber-700 font-bold mb-2">設定 Google Gemini API Key</p>
                  <input 
                    type="password" 
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="貼上您的 API Key..."
                    className="w-full px-3 py-2 rounded-lg text-sm border border-amber-200 focus:outline-none focus:border-amber-400 mb-2"
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowAIConfig(false)} className="px-3 py-1.5 text-xs text-stone-500 hover:bg-stone-200 rounded-lg font-bold transition-colors">取消</button>
                    <button onClick={handleSaveApiKey} className="px-3 py-1.5 text-xs bg-amber-500 text-white hover:bg-amber-600 rounded-lg font-bold transition-colors">儲存金鑰</button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-stone-50/50">
                {aiMessages.map((msg, index) => (
                  <div key={index} className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl p-3 text-sm ${
                      msg.role === "user" 
                        ? `${aiTheme.userMsg} rounded-tr-sm shadow-md`
                        : "bg-white border border-stone-100 text-stone-700 shadow-sm rounded-tl-sm"
                    }`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                    </div>
                  </div>
                ))}
                {isAILoading && (
                  <div className="flex w-full justify-start">
                    <div className="bg-white border border-stone-100 text-stone-400 shadow-sm rounded-2xl rounded-tl-sm p-3 text-sm flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" /> 正在深度分析中...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-3 bg-white border-t border-stone-100 shrink-0">
                <div className="relative flex items-center">
                  <input 
                    type="text"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        handleSendToAI();
                      }
                    }}
                    placeholder="問我關於營運績效的問題..."
                    className="w-full pl-4 pr-12 py-3 bg-stone-50 border border-stone-100 focus:border-stone-200 focus:bg-white focus:ring-0 rounded-xl text-sm transition-colors outline-none text-stone-700 placeholder-stone-400"
                    disabled={isAILoading}
                  />
                  <button 
                    onClick={handleSendToAI}
                    disabled={isAILoading || !aiInput.trim()}
                    className={`absolute right-2 p-1.5 ${aiTheme.sendBtn} text-white rounded-lg disabled:opacity-50 disabled:bg-stone-300 transition-colors`}
                  >
                    <Send size={16} />
                  </button>
                </div>
                {/* 若無金鑰才會提示 */}
                {!geminiApiKey && (!SYSTEM_GEMINI_KEY || SYSTEM_GEMINI_KEY.length < 10) && (
                  <p className="text-[10px] text-rose-500 text-center mt-2 font-bold cursor-pointer" onClick={() => setShowAIConfig(true)}>
                    ⚠️ 尚未設定 Gemini API Key，點此設定
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}

    </ViewWrapper>
  );
};

export default DashboardView;