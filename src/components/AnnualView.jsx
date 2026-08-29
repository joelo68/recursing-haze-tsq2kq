// src/components/AnnualView.jsx
import React, { useContext, useMemo, useState, useEffect } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Area
} from "recharts";
import { Target, TrendingUp, DollarSign, Activity, Calendar, Award, Filter, ArrowRight, Settings, X, Ban, CheckCircle, Save } from "lucide-react";

import { getDoc, doc } from "firebase/firestore";
import { AppContext } from "../AppContext";
import { sortManagerNames, sortStoreNames, sortManagersByOrgOrder, sortStoresByOrgOrder } from "../utils/helpers";
import { ViewWrapper, Card } from "./SharedUI";
import {
  buildAnnualFormalMonth,
  buildAnnualIntervalTotals,
  isAnnualPreSystemMonth,
  resolveAnnualHistoricalFormalTrust,
  shouldAllowAnnualRawTargetFallback,
} from "../utils/annualFormalConsumer.js";

// ★★★ 自定義圖例元件：完全控制順序與樣式 ★★★
const CustomLegend = () => {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 pb-2 select-none">
      
      {/* 1. 現金預算 (Area: 淺黃填充 + 深黃邊框) */}
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#fef3c7', border: '2px solid #fbbf24' }}></div>
        <span className="text-xs font-bold text-stone-600">現金預算</span>
      </div>

      {/* 2. 權責預算 (Line: 淺藍虛線) */}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center justify-center w-6">
          <div className="w-full h-0 border-t-2 border-dashed border-[#818cf8]"></div>
        </div>
        <span className="text-xs font-bold text-stone-600">權責預算</span>
      </div>

      {/* 3. 實際現金 (Bar: 橘色實心) */}
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-[2px] bg-[#f59e0b]"></div>
        <span className="text-xs font-bold text-stone-600">實際現金</span>
      </div>

      {/* 4. 實際權責 (Line: 深藍實線 + 圓點) */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex items-center justify-center w-6">
           <div className="w-full h-[2px] bg-[#4f46e5]"></div>
           <div className="absolute w-2.5 h-2.5 rounded-full bg-[#4f46e5]"></div>
        </div>
        <span className="text-xs font-bold text-stone-600">實際權責</span>
      </div>

    </div>
  );
};

const AnnualView = () => {
  const { 
    annualAggregatedData, // monthly_aggregated：本月 / 未整理月份備援
    annualDashboardSummaries = [], // ★ 歷史月份可信口徑：dashboard_summary
    annualSummaryStatusMap = {}, // ★ Summary 狀態：避免 dirty / mismatch 仍被使用
    annualSummaryLoadState = {}, // ★ 年度 Summary / flag readiness + brand/year anchoring
    monthlyTargetSummary, // ★ 當月目標輕量 Summary：避免 AnnualView 為了本月預算讀完整 monthly_targets
    budgets, 
    managers, managerOrder, 
    fmtMoney, 
    fmtNum, 
    selectedYear,
    auditExclusions,
    handleUpdateAuditExclusions,
    userRole,
    currentUser,
    showToast,
    currentBrand,
    getCollectionPath
  } = useContext(AppContext);

  // ==========================================
  // 1. 本地狀態：自訂月份區間 & 雙層聯動篩選器
  // ==========================================
  const [startMonthStr, setStartMonthStr] = useState(`${selectedYear}-01`);
  const [endMonthStr, setEndMonthStr] = useState(`${selectedYear}-12`);
  
  const [selectedAnnualManager, setSelectedAnnualManager] = useState("");
  const [selectedAnnualStore, setSelectedAnnualStore] = useState("");

  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [localExclusions, setLocalExclusions] = useState([]);
  const [annualMonthlyTargetSummaries, setAnnualMonthlyTargetSummaries] = useState({});
  const [annualTargetSummariesLoaded, setAnnualTargetSummariesLoaded] = useState(false);
  const [annualTargetFallbacks, setAnnualTargetFallbacks] = useState({});

  // 當切換品牌或年份時，重置過濾與時間區間
  useEffect(() => {
    setSelectedAnnualManager("");
    setSelectedAnnualStore("");
    setStartMonthStr(`${selectedYear}-01`);
    setEndMonthStr(`${selectedYear}-12`);
  }, [currentBrand, selectedYear]);

  const getMonthKeysInRange = (startValue, endValue) => {
    const start = String(startValue || `${selectedYear}-01`);
    const end = String(endValue || `${selectedYear}-12`);
    const startMatch = start.match(/^(\d{4})-(\d{2})$/);
    const endMatch = end.match(/^(\d{4})-(\d{2})$/);
    if (!startMatch || !endMatch) return [];

    const startYear = Number(startMatch[1]);
    const startMonth = Number(startMatch[2]);
    const endYear = Number(endMatch[1]);
    const endMonth = Number(endMatch[2]);
    const keys = [];

    let cursor = new Date(startYear, startMonth - 1, 1);
    const endDate = new Date(endYear, endMonth - 1, 1);

    while (cursor <= endDate && keys.length < 24) {
      keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return keys;
  };

  useEffect(() => {
    let cancelled = false;

    const loadAnnualMonthlyTargetSummaries = async () => {
      if (!getCollectionPath) return;

      setAnnualTargetSummariesLoaded(false);
      const monthKeys = getMonthKeysInRange(startMonthStr, endMonthStr)
        .filter((yearMonth) => !isAnnualPreSystemMonth(currentBrand, yearMonth));
      if (monthKeys.length === 0) {
        setAnnualMonthlyTargetSummaries({});
        setAnnualTargetSummariesLoaded(true);
        return;
      }

      try {
        const rows = await Promise.all(
          monthKeys.map(async (yearMonth) => {
            const snap = await getDoc(doc(getCollectionPath("monthly_targets_summary"), yearMonth));
            return [yearMonth, snap.exists() ? { id: snap.id, ...snap.data() } : null];
          })
        );

        if (cancelled) return;

        const next = {};
        rows.forEach(([yearMonth, data]) => {
          if (data) next[yearMonth] = data;
        });
        setAnnualMonthlyTargetSummaries(next);
        setAnnualTargetSummariesLoaded(true);
      } catch (error) {
        console.warn("AnnualView 載入 monthly_targets_summary 失敗:", error);
        if (!cancelled) {
          setAnnualMonthlyTargetSummaries({});
          setAnnualTargetSummariesLoaded(true);
        }
      }
    };

    loadAnnualMonthlyTargetSummaries();

    return () => {
      cancelled = true;
    };
  }, [getCollectionPath, startMonthStr, endMonthStr, selectedYear, currentBrand]);

  // ==========================================
  // 2. 品牌資訊與篩選引擎
  // ==========================================
  const brandPrefix = useMemo(() => {
    let name = "CYJ";
    if (currentBrand) {
      const id = typeof currentBrand === 'string' ? currentBrand : (currentBrand.id || "CYJ");
      const normalizedId = id.toLowerCase();
      if (normalizedId.includes("anniu") || normalizedId.includes("anew")) name = "安妞";
      else if (normalizedId.includes("yibo")) name = "伊啵";
      else name = "CYJ";
    }
    return name;
  }, [currentBrand]);

  const currentYearMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const annualSummaryTrustReady = useMemo(() => {
    const brandId = typeof currentBrand === "string"
      ? currentBrand.toLowerCase()
      : String(currentBrand?.id || "").toLowerCase();
    return annualSummaryLoadState?.brandId === brandId
      && String(annualSummaryLoadState?.year || "") === String(selectedYear)
      && annualSummaryLoadState?.dashboardReady === true
      && annualSummaryLoadState?.flagsReady === true;
  }, [annualSummaryLoadState, currentBrand, selectedYear]);

  const annualSummaryTrustError = Boolean(
    annualSummaryLoadState?.dashboardError || annualSummaryLoadState?.flagsError
  );

  const cleanName = useMemo(() => (name) => {
    if (!name) return "";
    let core = String(name).replace(new RegExp(`^(${brandPrefix}|CYJ|Anew|Yibo|安妞|伊啵)`, 'i'), '').trim();
    if (core === "新店") return "新店"; 
    return core.replace(/店$/, '').trim();
  }, [brandPrefix]);

  // ★ 歷史 Summary 店名相容層：只用於資料比對，不改畫面顯示名稱。
  // 舊 Summary 曾把「新店」存成「新」；新 Summary 則為「新店」。兩者統一視為同一間店。
  const canonicalStoreName = useMemo(() => (name) => {
    const core = cleanName(name);
    if (!core) return "";
    if (core === "新" || /^新店店?$/.test(core)) return "新店";
    return core;
  }, [cleanName]);

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
  }, [userRole, currentUser, managers, managerOrder, cleanName]);

  const availableStoresForFilter = useMemo(() => {
    const uniqueStores = [...new Set(baseVisibleStores)];
    return sortStoresByOrgOrder(managers, uniqueStores.map(s => `${brandPrefix}${s}店`), brandPrefix, managerOrder);
  }, [baseVisibleStores, brandPrefix, managers, managerOrder]);

  const groupedStoresForFilter = useMemo(() => {
    const groups = {};
    const availableSet = new Set(availableStoresForFilter);

    sortManagersByOrgOrder(managers, null, managerOrder).forEach((mgrName) => {
        const rawStores = managers?.[mgrName] || [];
        const mgrValidStores = [];
        (rawStores || []).forEach(rs => {
            const core = cleanName(rs);
            const fullName = `${brandPrefix}${core}店`;
            if (availableSet.has(fullName) && !mgrValidStores.includes(fullName)) {
                mgrValidStores.push(fullName);
            }
        });
        if (mgrValidStores.length > 0) {
            groups[mgrName] = sortStoresByOrgOrder(managers, mgrValidStores, brandPrefix, managerOrder);
        }
    });

    const inGroups = new Set(Object.values(groups).flat());
    const orphans = availableStoresForFilter.filter(s => !inGroups.has(s));
    if (orphans.length > 0) {
        groups['其他'] = sortStoresByOrgOrder(managers, orphans, brandPrefix, managerOrder);
    }

    return groups;
  }, [managers, managerOrder, availableStoresForFilter, cleanName, brandPrefix]);

  const availableStoresForDropdown = useMemo(() => {
    if (userRole === 'manager' && currentUser) {
         return groupedStoresForFilter[currentUser.name] || sortStoresByOrgOrder(managers, Object.values(groupedStoresForFilter).flat(), brandPrefix, managerOrder);
    }
    if (selectedAnnualManager && groupedStoresForFilter[selectedAnnualManager]) {
        return groupedStoresForFilter[selectedAnnualManager];
    }
    return sortStoresByOrgOrder(managers, Object.values(groupedStoresForFilter).flat(), brandPrefix, managerOrder);
  }, [selectedAnnualManager, groupedStoresForFilter, userRole, currentUser, managers, brandPrefix, managerOrder]);

  const effectiveStores = useMemo(() => {
    if (selectedAnnualStore) {
      return [cleanName(selectedAnnualStore)];
    }
    if (selectedAnnualManager) {
      const stores = managers[selectedAnnualManager] || [];
      return stores.map(cleanName).filter(Boolean);
    }
    return baseVisibleStores;
  }, [baseVisibleStores, selectedAnnualStore, selectedAnnualManager, managers, managerOrder, cleanName]);


  // ==========================================
  // 3. 設定排除視窗邏輯
  // ==========================================
  const openConfigModal = () => {
    setLocalExclusions(auditExclusions || []);
    setIsConfigModalOpen(true);
  };

  const saveConfig = async () => {
    const success = await handleUpdateAuditExclusions(localExclusions);
    if (!success) {
      showToast("排除名單更新失敗，請稍後再試");
      return;
    }
    setIsConfigModalOpen(false);
    showToast("排除名單已更新，報表已重新計算", "success");
  };

  const toggleExclusion = (store) => {
    setLocalExclusions(prev => {
      if (prev.includes(store)) return prev.filter(s => s !== store);
      return [...prev, store];
    });
  };

  const handleQuarterClick = (q) => {
    let start = "01";
    let end = "03";
    switch (q) {
      case 1: start = "01"; end = "03"; break;
      case 2: start = "04"; end = "06"; break;
      case 3: start = "07"; end = "09"; break;
      case 4: start = "10"; end = "12"; break;
      case 'ALL': start = "01"; end = "12"; break; 
      default: break;
    }
    setStartMonthStr(`${selectedYear}-${start}`);
    setEndMonthStr(`${selectedYear}-${end}`);
  };

  const activeQuarter = useMemo(() => {
    if (startMonthStr === `${selectedYear}-01` && endMonthStr === `${selectedYear}-03`) return 1;
    if (startMonthStr === `${selectedYear}-04` && endMonthStr === `${selectedYear}-06`) return 2;
    if (startMonthStr === `${selectedYear}-07` && endMonthStr === `${selectedYear}-09`) return 3;
    if (startMonthStr === `${selectedYear}-10` && endMonthStr === `${selectedYear}-12`) return 4;
    if (startMonthStr === `${selectedYear}-01` && endMonthStr === `${selectedYear}-12`) return 'ALL';
    return null;
  }, [startMonthStr, endMonthStr, selectedYear]);

  // ==========================================
  // 4. 核心運算邏輯 (★ 改為讀取 annualAggregatedData)
  // ==========================================
  const monthlyTargetSummaryByMonth = useMemo(() => {
    const map = { ...(annualMonthlyTargetSummaries || {}) };

    // ★ 當月 AppContext 的即時 Summary 只做「合併」，不能整份覆蓋 AnnualView 剛讀到的月份 Summary。
    // 否則即時 Summary 若暫時缺店（例如新店），會把已補整理完成的 33 店 Summary 再覆蓋成不完整版本。
    if (monthlyTargetSummary?.yearMonth) {
      const yearMonth = String(monthlyTargetSummary.yearMonth);
      const rangeSummary = map[yearMonth] || {};
      const rangeTargets = rangeSummary.targets || rangeSummary.storeTargets || rangeSummary.data || {};
      const liveTargets = monthlyTargetSummary.targets || monthlyTargetSummary.storeTargets || monthlyTargetSummary.data || {};

      map[yearMonth] = {
        ...rangeSummary,
        ...monthlyTargetSummary,
        id: monthlyTargetSummary.id || rangeSummary.id || yearMonth,
        yearMonth,
        targets: {
          ...(rangeTargets && typeof rangeTargets === "object" ? rangeTargets : {}),
          ...(liveTargets && typeof liveTargets === "object" ? liveTargets : {}),
        },
      };
    }

    return map;
  }, [annualMonthlyTargetSummaries, monthlyTargetSummary]);

  const annualDashboardSummaryByMonth = useMemo(() => {
    const map = {};
    (annualDashboardSummaries || []).forEach((summary) => {
      const yearMonth = String(summary?.yearMonth || summary?.id || "");
      if (yearMonth) map[yearMonth] = summary;
    });
    return map;
  }, [annualDashboardSummaries]);

  // ★ Summary-first 安全備援：
  // 只有當某月份的 monthly_targets_summary 對目前篩選店家「缺店或目標為 0」時，
  // 才精準讀取該店該月的原始 monthly_targets 文件。正常情況仍只讀 12 份 Summary，
  // 不重新打開全年 400+ 筆 monthly_targets 監聽。
  useEffect(() => {
    let cancelled = false;

    const readTargetNumber = (row, keys = []) => {
      for (const key of keys) {
        const raw = row?.[key];
        if (raw === null || raw === undefined || raw === "") continue;
        const num = Number(raw);
        if (Number.isFinite(num)) return num;
      }
      return 0;
    };

    const getSummaryTargetByCore = (summary, coreName) => {
      if (!summary || !coreName) return null;
      const targetsMap = summary.targets || summary.storeTargets || summary.data || {};
      if (!targetsMap || typeof targetsMap !== "object") return null;

      for (const [key, value] of Object.entries(targetsMap)) {
        const candidateName = value?.storeName || value?.store || value?.name || value?.displayName || key;
        if (canonicalStoreName(candidateName) === coreName) {
          return value || {};
        }
      }
      return null;
    };

    const loadMissingTargetFallbacks = async () => {
      if (!annualTargetSummariesLoaded || !getCollectionPath) return;

      const monthKeys = getMonthKeysInRange(startMonthStr, endMonthStr);
      const exclusionSet = new Set((auditExclusions || []).map(canonicalStoreName).filter(Boolean));
      const storeCores = [...new Set(
        (effectiveStores || [])
          .map(canonicalStoreName)
          .filter((core) => core && !exclusionSet.has(core))
      )];

      if (monthKeys.length === 0 || storeCores.length === 0) {
        if (!cancelled) setAnnualTargetFallbacks({});
        return;
      }

      const missingPairs = [];
      monthKeys.forEach((yearMonth) => {
        const isHistoricalMonth = yearMonth < currentYearMonth;
        const preSystemSkip = isAnnualPreSystemMonth(currentBrand, yearMonth);
        if (preSystemSkip) return;

        // 歷史月份先等 dashboard_summary + summary_recalc_flags 都完成 brand/year anchoring。
        // 否則 target Summary 比 Formal Summary 先回來時，會在 50~100ms 的 race window 提前打 raw monthly_targets。
        if (isHistoricalMonth && !annualSummaryTrustReady) return;

        const allowRawFallback = isHistoricalMonth && annualSummaryTrustError
          ? true
          : shouldAllowAnnualRawTargetFallback({
              yearMonth,
              currentYearMonth,
              brandId: currentBrand,
              dashboardSummary: annualDashboardSummaryByMonth[yearMonth] || null,
              summaryFlag: annualSummaryStatusMap?.[yearMonth] || null,
            });
        if (!allowRawFallback) return;

        const summary = monthlyTargetSummaryByMonth[yearMonth];
        storeCores.forEach((core) => {
          const row = getSummaryTargetByCore(summary, core);
          const cashTarget = readTargetNumber(row, ["cashTarget", "targetCash", "cashBudget", "monthlyCashTarget", "cash", "cash_target"]);
          const accrualTarget = readTargetNumber(row, ["accrualTarget", "targetAccrual", "accrualBudget", "monthlyAccrualTarget", "accrual", "accrual_target"]);
          if (!row || (cashTarget <= 0 && accrualTarget <= 0)) {
            missingPairs.push({ yearMonth, core });
          }
        });
      });

      if (missingPairs.length === 0) {
        if (!cancelled) setAnnualTargetFallbacks({});
        return;
      }

      const targetCollection = getCollectionPath("monthly_targets");
      const nextFallbacks = {};

      // 正常僅會處理少數缺漏；新店同時相容舊 key「CYJ新店_YYYY_M」與新 key「CYJ新店店_YYYY_M」。
      for (const { yearMonth, core } of missingPairs) {
        if (cancelled) return;
        const [yearText, monthText] = String(yearMonth).split("-");
        const monthNum = Number(monthText);
        const canonicalFullName = `${brandPrefix}${core}店`;
        const candidateIds = [
          `${canonicalFullName}_${yearText}_${monthNum}`,
          `${canonicalFullName}_${yearText}_${String(monthNum).padStart(2, "0")}`,
        ];

        if (core === "新店") {
          candidateIds.push(
            `${brandPrefix}新店_${yearText}_${monthNum}`,
            `${brandPrefix}新店_${yearText}_${String(monthNum).padStart(2, "0")}`
          );
        }

        const uniqueIds = [...new Set(candidateIds)];
        let resolved = null;

        for (const targetId of uniqueIds) {
          const snap = await getDoc(doc(targetCollection, targetId));
          if (!snap.exists()) continue;

          const data = snap.data() || {};
          const cashTarget = readTargetNumber(data, ["cashTarget", "targetCash", "cashBudget", "monthlyCashTarget", "cash", "cash_target"]);
          const accrualTarget = readTargetNumber(data, ["accrualTarget", "targetAccrual", "accrualBudget", "monthlyAccrualTarget", "accrual", "accrual_target"]);
          if (cashTarget > 0 || accrualTarget > 0) {
            resolved = {
              ...data,
              storeName: data.storeName || data.store || canonicalFullName,
              cashTarget,
              accrualTarget,
              sourceDocId: snap.id,
            };
            break;
          }
        }

        if (resolved) {
          if (!nextFallbacks[yearMonth]) nextFallbacks[yearMonth] = {};
          nextFallbacks[yearMonth][core] = resolved;
        }
      }

      if (!cancelled) setAnnualTargetFallbacks(nextFallbacks);
    };

    loadMissingTargetFallbacks().catch((error) => {
      console.warn("AnnualView 精準讀取 monthly_targets fallback 失敗:", error);
      if (!cancelled) setAnnualTargetFallbacks({});
    });

    return () => {
      cancelled = true;
    };
  }, [
    annualTargetSummariesLoaded,
    monthlyTargetSummaryByMonth,
    annualDashboardSummaryByMonth,
    annualSummaryStatusMap,
    annualSummaryTrustReady,
    annualSummaryTrustError,
    currentYearMonth,
    getCollectionPath,
    startMonthStr,
    endMonthStr,
    selectedYear,
    currentBrand,
    brandPrefix,
    effectiveStores,
    auditExclusions,
    canonicalStoreName,
  ]);

const annualData = useMemo(() => {
    const effectiveStoreSet = new Set(effectiveStores.map(canonicalStoreName).filter(Boolean));
    const auditExclusionSet = new Set((auditExclusions || []).map(canonicalStoreName).filter(Boolean));

    // Compatibility path（本月 / unverified historical）使用目前可見店家。
    const targetStoreNames = effectiveStores
      .filter((s) => {
        const core = canonicalStoreName(s);
        return core && !auditExclusionSet.has(core);
      })
      .map((s) => `${brandPrefix}${s}店`);

    const monthList = [];
    let current = new Date(`${startMonthStr}-01`);
    const end = new Date(`${endMonthStr}-01`);

    if (current > end) current = new Date(`${startMonthStr}-01`);

    while (current <= end) {
      const y = current.getFullYear();
      const m = current.getMonth() + 1;
      monthList.push({ label: `${y}/${m}`, y, m, dateKey: `${y}/${m.toString().padStart(2, '0')}` });
      current.setMonth(current.getMonth() + 1);
    }

    const statsMap = monthList.map((item) => ({
      ...item,
      cash: 0,
      accrual: 0,
      traffic: 0,
      budget: 0,
      accrualBudget: 0,
      achievement: 0,
      accrualAchievement: 0,
      source: "aggregated",
      includedInTotals: true,
      preSystemSkip: false,
      formalTrustReason: "",
    }));

    const pickNumber = (row, keys = []) => keys.reduce((value, key) => {
      if (value !== null && value !== undefined) return value;
      const raw = row?.[key];
      return raw === null || raw === undefined ? null : Number(raw) || 0;
    }, null) || 0;

    const hasExplicitAnnualScope = Boolean(
      selectedAnnualManager ||
      selectedAnnualStore ||
      userRole === "manager" ||
      userRole === "store"
    );
    const formalScopeStoreKeys = hasExplicitAnnualScope ? [...effectiveStoreSet] : null;

    const sumTargetsFromMonthlyTargetSummary = (summary, targetStat) => {
      const targetYearMonth = `${targetStat.y}-${String(targetStat.m).padStart(2, "0")}`;
      const summaryYearMonth = String(summary?.yearMonth || summary?.id || targetYearMonth);
      const targetsMap = summary?.targets || summary?.storeTargets || summary?.data || {};
      const targetStoreCores = [...new Set(targetStoreNames.map(canonicalStoreName).filter(Boolean))];
      const summaryTargetMap = new Map();

      if (summary && summaryYearMonth === targetYearMonth && targetsMap && typeof targetsMap === "object") {
        Object.entries(targetsMap).forEach(([key, value]) => {
          const item = {
            key,
            ...(value || {}),
            storeName: value?.storeName || value?.store || value?.name || value?.displayName || key,
          };
          const core = canonicalStoreName(item.storeName);
          if (core && !summaryTargetMap.has(core)) summaryTargetMap.set(core, item);
        });
      }

      let foundAnyTarget = false;
      let usedDirectFallback = false;

      targetStoreCores.forEach((core) => {
        let row = summaryTargetMap.get(core) || null;
        let cashTarget = pickNumber(row, ["cashTarget", "targetCash", "cashBudget", "monthlyCashTarget", "cash", "cash_target"]);
        let accrualTarget = pickNumber(row, ["accrualTarget", "targetAccrual", "accrualBudget", "monthlyAccrualTarget", "accrual", "accrual_target"]);

        // Formal trusted historical 已在上方被套用，不會走到此 compatibility fallback。
        if (!row || (cashTarget <= 0 && accrualTarget <= 0)) {
          const fallbackRow = annualTargetFallbacks?.[targetYearMonth]?.[core];
          if (fallbackRow) {
            row = fallbackRow;
            cashTarget = pickNumber(row, ["cashTarget", "targetCash", "cashBudget", "monthlyCashTarget", "cash", "cash_target"]);
            accrualTarget = pickNumber(row, ["accrualTarget", "targetAccrual", "accrualBudget", "monthlyAccrualTarget", "accrual", "accrual_target"]);
            usedDirectFallback = true;
          }
        }

        if (cashTarget <= 0 && accrualTarget <= 0) {
          const canonicalFullName = `${brandPrefix}${core}店`;
          const legacyFullName = core === "新店" ? `${brandPrefix}新店` : "";
          const budgetKeys = [
            `${canonicalFullName}_${targetStat.y}_${targetStat.m}`,
            `${canonicalFullName}_${targetStat.y}_${String(targetStat.m).padStart(2, "0")}`,
            legacyFullName ? `${legacyFullName}_${targetStat.y}_${targetStat.m}` : "",
            legacyFullName ? `${legacyFullName}_${targetStat.y}_${String(targetStat.m).padStart(2, "0")}` : "",
          ].filter(Boolean);

          for (const key of budgetKeys) {
            const budgetRow = budgets?.[key];
            if (!budgetRow) continue;
            const nextCash = pickNumber(budgetRow, ["cashTarget", "targetCash", "cashBudget", "monthlyCashTarget", "cash", "cash_target"]);
            const nextAccrual = pickNumber(budgetRow, ["accrualTarget", "targetAccrual", "accrualBudget", "monthlyAccrualTarget", "accrual", "accrual_target"]);
            if (nextCash > 0 || nextAccrual > 0) {
              cashTarget = nextCash;
              accrualTarget = nextAccrual;
              break;
            }
          }
        }

        if (cashTarget > 0 || accrualTarget > 0) {
          targetStat.budget += cashTarget;
          targetStat.accrualBudget += accrualTarget;
          foundAnyTarget = true;
        }
      });

      if (foundAnyTarget) {
        targetStat.targetSource = usedDirectFallback ? "monthly_targets_precise_fallback" : "monthly_targets_summary";
      }
      return foundAnyTarget;
    };

    const summaryAppliedMonths = new Set();

    statsMap.forEach((stat) => {
      const yearMonth = `${stat.y}-${String(stat.m).padStart(2, "0")}`;

      if (isAnnualPreSystemMonth(currentBrand, yearMonth)) {
        stat.cash = null;
        stat.accrual = null;
        stat.budget = null;
        stat.accrualBudget = null;
        stat.achievement = null;
        stat.accrualAchievement = null;
        stat.source = "pre_system";
        stat.preSystemSkip = true;
        stat.includedInTotals = false;
        stat.formalTrustReason = "PRE_SYSTEM_SKIP";
        return;
      }

      if (yearMonth >= currentYearMonth || !annualSummaryTrustReady) return;

      const dashboardSummary = annualDashboardSummaryByMonth[yearMonth] || null;
      const trust = annualSummaryTrustError
        ? { trusted: false, preSystemSkip: false, reason: "SUMMARY_LOAD_ERROR" }
        : resolveAnnualHistoricalFormalTrust({
            yearMonth,
            currentYearMonth,
            brandId: currentBrand,
            dashboardSummary,
            summaryFlag: annualSummaryStatusMap?.[yearMonth] || null,
          });
      stat.formalTrustReason = trust.reason || "";
      if (!trust.trusted) return;

      const formalMonth = buildAnnualFormalMonth({
        dashboardSummary,
        monthlyTargetSummary: monthlyTargetSummaryByMonth[yearMonth] || null,
        scopeStoreKeys: formalScopeStoreKeys,
        excludedStoreKeys: [...auditExclusionSet],
        normalizeStoreKey: canonicalStoreName,
      });
      if (!formalMonth?.applied) return;

      Object.assign(stat, formalMonth, {
        source: "formal_summary",
        preSystemSkip: false,
      });
      summaryAppliedMonths.add(yearMonth);
    });

    // monthly_aggregated 僅作為本月 / unverified / missing Formal Summary 的 compatibility fallback。
    annualAggregatedData.forEach((d) => {
      const rawStoreName = canonicalStoreName(d.storeName);
      if (auditExclusionSet.has(rawStoreName)) return;
      if (!effectiveStoreSet.has(rawStoreName)) return;
      if (!d.yearMonth) return;

      const parts = d.yearMonth.split("-");
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      const realYear = y < 1911 ? y + 1911 : y;
      const yearMonth = `${realYear}-${String(m).padStart(2, "0")}`;
      if (isAnnualPreSystemMonth(currentBrand, yearMonth)) return;
      if (summaryAppliedMonths.has(yearMonth)) return;

      const targetStat = statsMap.find((row) => row.y === realYear && row.m === m);
      if (targetStat) {
        targetStat.cash += (Number(d.cash) || 0) - (Number(d.refund) || 0);

        let currentAccrual = Number(d.accrual) || 0;
        if (brandPrefix === "安妞") {
          currentAccrual = Number(d.operationalAccrual) || 0;
        }
        targetStat.accrual += currentAccrual;
        targetStat.traffic += Number(d.traffic) || 0;
      }
    });

    statsMap.forEach((stat) => {
      if (stat.includedInTotals === false) return;

      // Formal trusted historical 的 target / achievement 由 Coverage v1 authority 決定，禁止 raw fallback。
      if (stat.source !== "formal_summary") {
        const statYearMonth = `${stat.y}-${String(stat.m).padStart(2, "0")}`;
        sumTargetsFromMonthlyTargetSummary(monthlyTargetSummaryByMonth[statYearMonth], stat);
        stat.achievement = stat.budget > 0 ? (stat.cash / stat.budget) * 100 : 0;
        stat.accrualAchievement = stat.accrualBudget > 0 ? (stat.accrual / stat.accrualBudget) * 100 : 0;
      }
    });

    return {
      monthlyStats: statsMap,
      totals: buildAnnualIntervalTotals(statsMap),
    };
  }, [
    annualAggregatedData,
    annualDashboardSummaryByMonth,
    annualSummaryStatusMap,
    annualSummaryTrustReady,
    annualSummaryTrustError,
    monthlyTargetSummaryByMonth,
    annualTargetFallbacks,
    budgets,
    startMonthStr,
    endMonthStr,
    auditExclusions,
    brandPrefix,
    currentBrand,
    currentYearMonth,
    effectiveStores,
    canonicalStoreName,
    selectedAnnualManager,
    selectedAnnualStore,
    userRole,
  ]);

  const { monthlyStats, totals } = annualData;

  // 用於動態顯示上方標題的文字
  const currentViewLabel = useMemo(() => {
      if (selectedAnnualStore) return `${cleanName(selectedAnnualStore)}店`;
      if (selectedAnnualManager) return `${selectedAnnualManager}區`;
      return "全區";
  }, [selectedAnnualStore, selectedAnnualManager, cleanName]);

  const currentActiveStoresCount = useMemo(() => {
    const excluded = new Set((auditExclusions || []).map(canonicalStoreName).filter(Boolean));
    return effectiveStores.filter((storeName) => !excluded.has(canonicalStoreName(storeName))).length;
  }, [effectiveStores, auditExclusions, canonicalStoreName]);

  const displayAnnualMoney = (value, preSystemSkip = false) => {
    if (preSystemSkip) return "—";
    return value !== null && value !== undefined && Number.isFinite(Number(value)) ? fmtMoney(Number(value)) : "N/A";
  };
  const displayAnnualPercent = (value, preSystemSkip = false) => {
    if (preSystemSkip) return "—";
    return value !== null && value !== undefined && Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : "N/A";
  };
  const annualProgressWidth = (value) => (
    value !== null && value !== undefined && Number.isFinite(Number(value))
      ? Math.max(0, Math.min(Number(value), 100))
      : 0
  );

  return (
    <ViewWrapper>
      <div className="space-y-6 pb-12">
        
        {/* 標題與權限顯示 */}
        <div className="flex flex-col gap-4 mb-2">
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in fade-in slide-in-from-left-2 duration-500">
             <div className="flex items-center gap-3">
               <div className="p-3 bg-amber-100 text-amber-600 rounded-xl shadow-sm">
                 <Calendar size={24} />
               </div>
               <div>
                 <h1 className="text-2xl font-bold text-stone-800">經營績效分析 ({brandPrefix})</h1>
                 <p className="text-xs text-stone-500 font-medium">Performance Analytics</p>
               </div>
             </div>
             
             <div className="flex items-center gap-2 self-start md:self-auto md:ml-auto">
               <div className="px-4 py-1.5 bg-stone-100 text-stone-500 text-xs font-bold rounded-full transition-all">
                 檢視範圍: {currentViewLabel} ({currentActiveStoresCount} 店)
               </div>
               {(userRole === 'director' || userRole === 'manager') && (
                  <button 
                    onClick={openConfigModal} 
                    className="p-1.5 bg-stone-100 text-stone-500 rounded-full hover:bg-stone-200 transition-colors" 
                    title="設定排除店家 (不計入目標與業績)"
                  >
                    <Settings size={16}/>
                  </button>
               )}
             </div>
           </div>

           {/* ★★★ 工具列：雙層聯動篩選器 & 快速區間 ★★★ */}
           <div className="bg-white p-4 rounded-2xl border border-stone-100 shadow-sm flex flex-col xl:flex-row items-start xl:items-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              
              {/* 單店篩選器 (安插在快速篩選左側) */}
              {(userRole === 'director' || userRole === 'trainer' || userRole === 'manager') && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full xl:w-auto overflow-x-auto no-scrollbar">
                    
                    {(userRole === 'director' || userRole === 'trainer') && (
                        <select
                            value={selectedAnnualManager}
                            onChange={(e) => {
                                setSelectedAnnualManager(e.target.value);
                                setSelectedAnnualStore(""); 
                            }}
                            className="px-3 py-2 border border-stone-200 rounded-xl text-sm font-bold text-stone-600 outline-none focus:border-amber-400 bg-stone-50 shadow-sm cursor-pointer min-w-[120px] hover:border-stone-300 transition-colors"
                        >
                            <option value="">全品牌</option>
                            {sortManagersByOrgOrder(managers, Object.keys(groupedStoresForFilter), managerOrder).map(m => (
                                <option key={m} value={m}>{m}區</option>
                            ))}
                        </select>
                    )}
                    
                    <select
                        value={selectedAnnualStore}
                        onChange={(e) => setSelectedAnnualStore(e.target.value)}
                        className="px-3 py-2 border border-stone-200 rounded-xl text-sm font-bold text-stone-600 outline-none focus:border-amber-400 bg-stone-50 shadow-sm cursor-pointer min-w-[140px] hover:border-stone-300 transition-colors"
                    >
                        <option value="" className="font-bold text-stone-800">
                            {selectedAnnualManager || userRole === 'manager' ? "全區店家" : "顯示全區"}
                        </option>
                        
                        {(!selectedAnnualManager && userRole !== 'manager') ? (
                            Object.entries(groupedStoresForFilter).map(([mgrName, stores]) => (
                                <optgroup key={mgrName} label={`${mgrName} 區`} className="font-bold text-stone-400 bg-white">
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

                    <div className="hidden xl:block w-px h-6 bg-stone-200 mx-2"></div>
                </div>
              )}

              {/* 快速篩選按鈕 */}
              <div className="flex items-center gap-2 text-stone-600 font-bold text-sm whitespace-nowrap shrink-0">
                <Filter size={18} className="text-amber-500"/>
                <span>快速篩選：</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => handleQuarterClick('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    activeQuarter === 'ALL' 
                      ? 'bg-stone-800 text-white border-stone-800' 
                      : 'bg-stone-50 text-stone-500 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  整年度
                </button>
                {[1, 2, 3, 4].map(q => (
                  <button
                    key={q}
                    onClick={() => handleQuarterClick(q)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                      activeQuarter === q 
                        ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-200' 
                        : 'bg-stone-50 text-stone-500 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    Q{q}
                  </button>
                ))}
              </div>
              
              <div className="hidden xl:block w-px h-8 bg-stone-200 mx-2"></div>
              
              <div className="flex items-center gap-2 text-stone-600 font-bold text-sm whitespace-nowrap xl:ml-0 shrink-0">
                <span>自訂區間：</span>
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <input 
                  type="month" 
                  value={startMonthStr}
                  onChange={(e) => setStartMonthStr(e.target.value)}
                  className="bg-stone-50 border border-stone-200 text-stone-700 text-sm rounded-lg focus:ring-amber-500 focus:border-amber-500 block w-full p-2 font-mono"
                />
                <span className="text-stone-400"><ArrowRight size={16}/></span>
                <input 
                  type="month" 
                  value={endMonthStr}
                  onChange={(e) => setEndMonthStr(e.target.value)}
                  className="bg-stone-50 border border-stone-200 text-stone-700 text-sm rounded-lg focus:ring-amber-500 focus:border-amber-500 block w-full p-2 font-mono"
                />
              </div>
           </div>
        </div>

        {/* 區塊 1: 區間總 KPI */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
          <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-20"><DollarSign size={100} /></div>
            <div className="relative z-10">
              <p className="text-amber-100 font-bold text-sm mb-1 flex items-center gap-1"><Target size={14}/> 區間現金達成</p>
              <h2 className="text-4xl font-extrabold font-mono tracking-tight mb-4">{displayAnnualMoney(totals.cash)}</h2>
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-amber-100">
                  <span>區間目標 {displayAnnualMoney(totals.budget)}</span>
                  <span>{displayAnnualPercent(totals.cashAch)}</span>
                </div>
                <div className="w-full bg-black/20 h-2 rounded-full overflow-hidden">
                  <div className="bg-white h-full rounded-full transition-all duration-1000" style={{ width: `${annualProgressWidth(totals.cashAch)}%` }}></div>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white border-2 border-indigo-100 rounded-2xl p-6 shadow-sm relative overflow-hidden flex flex-col justify-center">
             <div className="absolute top-0 right-0 p-4 opacity-5 text-indigo-600"><Activity size={100} /></div>
             <div className="relative z-10">
              <p className="text-indigo-400 font-bold text-sm mb-1 flex items-center gap-1"><Award size={14}/> 區間權責達成</p>
              <h2 className={`text-4xl font-extrabold font-mono tracking-tight text-stone-700 ${brandPrefix === '安妞' ? 'mb-1' : 'mb-4'}`}>{displayAnnualMoney(totals.accrual)}</h2>
              {/* ★ 針對安妞的文字提示 */}
              {brandPrefix === '安妞' && (
                <p className="text-[11px] text-indigo-400 mb-3 font-medium flex items-center gap-1">
                  <span className="inline-block w-1 h-1 bg-indigo-400 rounded-full"></span> 僅含技術操作 (排除產品)
                </p>
              )}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-stone-400">
                  <span>區間目標 {displayAnnualMoney(totals.accrualBudget)}</span>
                  <span className={totals.accrualAch >= 100 ? "text-emerald-500" : "text-stone-500"}>{displayAnnualPercent(totals.accrualAch)}</span>
                </div>
                <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-indigo-500 h-full rounded-full transition-all duration-1000" style={{ width: `${annualProgressWidth(totals.accrualAch)}%` }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 區塊 2: 趨勢圖表 */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
          <Card title="區間營收趨勢分析" subtitle={`實際 vs 預算 (現金/權責${brandPrefix === '安妞' ? ' - 不含產品' : ''})`}>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyStats} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#78716c' }} axisLine={false} tickLine={false} dy={10} />
                  <YAxis 
                    width={50} 
                    tick={{ fontSize: 11, fill: '#a8a29e' }} 
                    axisLine={false} 
                    tickLine={false} 
                    tickFormatter={(val) => `${(val/10000).toFixed(0)}萬`} 
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    formatter={(value) => fmtMoney(value)}
                    itemSorter={(item) => {
                      const order = { "現金預算": 1, "權責預算": 2, "實際現金": 3, "實際權責": 4 };
                      return order[item.name] || 99;
                    }}
                  />
                  <Legend content={<CustomLegend />} verticalAlign="top" height={36} />
                  <Area type="monotone" dataKey="budget" name="現金預算" stroke="#fbbf24" fill="#fef3c7" strokeWidth={2} fillOpacity={0.5} />
                  <Line type="monotone" dataKey="accrualBudget" name="權責預算" stroke="#818cf8" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                  <Bar dataKey="cash" name="實際現金" barSize={12} radius={[4, 4, 0, 0]} fill="#f59e0b" />
                  <Line type="monotone" dataKey="accrual" name="實際權責" stroke="#4f46e5" strokeWidth={3} dot={{r:3}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* 區塊 3: 詳細數據表 */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
          <Card title="區間詳細數據表">
            <div className="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="text-stone-400 font-bold border-b border-stone-100 text-xs uppercase">
                  <tr>
                    <th className="pb-3 pl-2">月份</th>
                    <th className="pb-3 text-right text-amber-500/60">現金目標</th>
                    <th className="pb-3 text-right text-amber-600">現金業績</th>
                    <th className="pb-3 text-right">達成率</th>
                    <th className="pb-3 text-right text-indigo-400/60 pl-4 border-l border-dashed border-stone-200">權責目標</th>
                    <th className="pb-3 text-right text-indigo-600">
                      權責業績 {brandPrefix === '安妞' && <span className="text-[10px] text-indigo-400 font-normal normal-case ml-1">(純操作)</span>}
                    </th>
                    <th className="pb-3 text-right">達成率</th>
                    <th className="pb-3 text-right pl-4 border-l border-dashed border-stone-200">操作人次</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {monthlyStats.map((stat, idx) => (
                    <tr key={idx} className="group hover:bg-stone-50 transition-colors">
                      <td className="py-4 pl-2 font-bold text-stone-700">
                        <span>{stat.label}</span>
                        {stat.preSystemSkip && (
                          <span className="ml-2 px-2 py-0.5 rounded-full bg-stone-100 text-stone-400 text-[10px] font-bold">Pre-system</span>
                        )}
                      </td>
                      <td className="py-4 text-right font-mono text-stone-400 text-xs">{displayAnnualMoney(stat.budget, stat.preSystemSkip)}</td>
                      <td className="py-4 text-right font-mono text-stone-700 font-bold">{displayAnnualMoney(stat.cash, stat.preSystemSkip)}</td>
                      <td className="py-4 text-right font-bold">
                         <span className={`px-2 py-1 rounded-md text-xs ${stat.achievement >= 100 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-400'}`}>
                           {displayAnnualPercent(stat.achievement, stat.preSystemSkip)}
                         </span>
                      </td>
                      <td className="py-4 text-right font-mono text-stone-400 text-xs pl-4 border-l border-dashed border-stone-100">{displayAnnualMoney(stat.accrualBudget, stat.preSystemSkip)}</td>
                      <td className="py-4 text-right font-mono text-indigo-600 font-bold">{displayAnnualMoney(stat.accrual, stat.preSystemSkip)}</td>
                      <td className="py-4 text-right font-bold">
                         <span className={`px-2 py-1 rounded-md text-xs ${stat.accrualAchievement >= 100 ? 'bg-indigo-100 text-indigo-700' : 'bg-stone-100 text-stone-400'}`}>
                           {displayAnnualPercent(stat.accrualAchievement, stat.preSystemSkip)}
                         </span>
                      </td>
                      <td className="py-4 text-right font-mono text-stone-600 pl-4 border-l border-dashed border-stone-100">{stat.preSystemSkip ? "—" : fmtNum(stat.traffic)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-stone-50 font-bold text-stone-800 border-t-2 border-stone-100">
                  <tr>
                    <td className="py-4 pl-2 text-stone-500">區間總計</td>
                    <td className="py-4 text-right font-mono text-stone-500 text-xs">{displayAnnualMoney(totals.budget)}</td>
                    <td className="py-4 text-right font-mono text-amber-600">{displayAnnualMoney(totals.cash)}</td>
                    <td className="py-4 text-right text-emerald-600">{displayAnnualPercent(totals.cashAch)}</td>
                    <td className="py-4 text-right font-mono text-stone-500 text-xs pl-4 border-l border-dashed border-stone-200">{displayAnnualMoney(totals.accrualBudget)}</td>
                    <td className="py-4 text-right font-mono text-indigo-600">{displayAnnualMoney(totals.accrual)}</td>
                    <td className="py-4 text-right text-emerald-600">{displayAnnualPercent(totals.accrualAch)}</td>
                    <td className="py-4 text-right font-mono pl-4 border-l border-dashed border-stone-200">{fmtNum(totals.traffic)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </div>

      </div>

      {/* ★★★ 設定視窗 (Modal) ★★★ */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-stone-800 text-white p-4 font-bold text-lg flex justify-between items-center shrink-0">
              <span className="flex items-center gap-2"><Ban size={20} className="text-rose-400"/> 設定不計算店家 ({brandPrefix})</span>
              <button onClick={() => setIsConfigModalOpen(false)} className="hover:bg-white/10 p-1 rounded-lg transition-colors"><X size={20}/></button>
            </div>
            <div className="p-4 bg-stone-50 border-b border-stone-200 shrink-0 text-sm text-stone-500">
              <p>勾選的店家將 <span className="font-bold text-rose-500">不會</span> 計入年度預算與實際業績。</p>
              <p className="text-xs mt-1 text-stone-400">(此設定與「回報檢核」共用排除名單)</p>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              {Object.entries(managers).map(([mgr, stores]) => (
                <div key={mgr}>
                  <h4 className="font-bold text-stone-400 text-xs uppercase mb-2 ml-1">{mgr} 區</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {stores.map(store => {
                      const isExcluded = localExclusions.includes(store);
                      return (
                        <button
                          key={store}
                          onClick={() => toggleExclusion(store)}
                          className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 ${
                            isExcluded 
                              ? "bg-rose-50 border-rose-500 text-rose-600 shadow-sm" 
                              : "bg-white border-stone-200 text-stone-500 hover:border-stone-400"
                          }`}
                        >
                          {isExcluded && <CheckCircle size={14}/>}
                          {store}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-stone-100 bg-white shrink-0 flex justify-end gap-3">
              <button onClick={() => setIsConfigModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-stone-500 hover:bg-stone-50">取消</button>
              <button onClick={saveConfig} className="px-6 py-2.5 rounded-xl font-bold bg-stone-800 text-white hover:bg-stone-700 shadow-lg flex items-center gap-2">
                <Save size={18}/> 儲存設定
              </button>
            </div>
          </div>
        </div>
      )}
    </ViewWrapper>
  );
};

export default AnnualView;