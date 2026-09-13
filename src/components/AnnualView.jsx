// src/components/AnnualView.jsx
import React, { useContext, useMemo, useState, useEffect } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Area
} from "recharts";
import { Target, TrendingUp, DollarSign, Activity, Calendar, Award, Filter, ArrowRight, Settings, X, Ban, CheckCircle, Save, Loader2 } from "lucide-react";

import { getDoc, doc } from "firebase/firestore";
import { AppContext } from "../AppContext";
import { sortManagerNames, sortStoreNames, sortManagersByOrgOrder, sortStoresByOrgOrder } from "../utils/helpers";
import { ViewWrapper, Card } from "./SharedUI";
import SmartMonthPicker from "./SmartMonthPicker";
import { filterSystemExcludedStoreKeys } from "../utils/systemExclusion.js";
import { resolveKpiPresentationLabel } from "../utils/kpiPresentation.js";
import {
  buildAnnualFormalMonth,
  buildAnnualIntervalTotals,
  buildAnnualLifecycleScope,
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
    annualMonthlyTargetSummaries = {},
    annualTargetSummaryLoadState = {},
    annualAggregateLoadState = {},
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
    getCollectionPath,
    systemExclusionState,
    currentLifecycleMasterState,
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
  const [annualTargetFallbacks, setAnnualTargetFallbacks] = useState({});
  const [annualTargetFallbackLoadState, setAnnualTargetFallbackLoadState] = useState({
    brandId: "",
    year: "",
    ready: false,
    loading: false,
    error: "",
  });

  // 當切換品牌或年份時，重置過濾與時間區間
  useEffect(() => {
    setSelectedAnnualManager("");
    setSelectedAnnualStore("");
    setStartMonthStr(`${selectedYear}-01`);
    setEndMonthStr(`${selectedYear}-12`);
    setAnnualTargetFallbacks({});
    setAnnualTargetFallbackLoadState({
      brandId: "",
      year: "",
      ready: false,
      loading: false,
      error: "",
    });
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

  const annualBrandId = useMemo(() => (
    typeof currentBrand === "string"
      ? currentBrand.toLowerCase()
      : String(currentBrand?.id || "").toLowerCase()
  ), [currentBrand]);

  const annualSummaryTrustReady = useMemo(() => {
    return annualSummaryLoadState?.brandId === annualBrandId
      && String(annualSummaryLoadState?.year || "") === String(selectedYear)
      && annualSummaryLoadState?.dashboardReady === true
      && annualSummaryLoadState?.flagsReady === true
      && systemExclusionState?.ready === true
      && String(systemExclusionState?.brandId || "").toLowerCase() === annualBrandId
      && currentLifecycleMasterState?.ready === true
      && String(currentLifecycleMasterState?.brandId || "").toLowerCase() === annualBrandId
      && String(currentLifecycleMasterState?.data?.datasetStatus || "") === "READY";
  }, [annualSummaryLoadState, annualBrandId, selectedYear, systemExclusionState, currentLifecycleMasterState]);

  const annualTargetSummariesLoaded = Boolean(
    annualTargetSummaryLoadState?.brandId === annualBrandId
      && String(annualTargetSummaryLoadState?.year || "") === String(selectedYear)
      && annualTargetSummaryLoadState?.ready === true
  );

  const annualSummaryTrustError = Boolean(
    annualSummaryLoadState?.dashboardError || annualSummaryLoadState?.flagsError
  );

  // B1C2E-UX1 / UX1.1：年度 authority 分層呈現。
  // Summary/Target 是年度基礎 trust；monthly_aggregated fallback 有獨立 readiness，
  // 因此 current/unverified month 尚在同步時不會把 null 誤呈現成「尚無資料」。
  const annualPresentationReady = annualSummaryTrustReady && annualTargetSummariesLoaded;
  const annualAggregateStateAnchored = Boolean(
    annualAggregateLoadState?.brandId === annualBrandId
      && String(annualAggregateLoadState?.year || "") === String(selectedYear)
  );
  const annualAggregateReady = Boolean(
    annualAggregateStateAnchored
      && annualAggregateLoadState?.ready === true
      && !annualAggregateLoadState?.error
  );
  const annualAggregateScopeKnown = Boolean(
    annualAggregateStateAnchored
      && (
        annualAggregateLoadState?.ready === true
        || Boolean(annualAggregateLoadState?.fallbackKey)
        || (Array.isArray(annualAggregateLoadState?.fallbackYearMonths) && annualAggregateLoadState.fallbackYearMonths.length > 0)
      )
  );
  const annualAggregateFallbackMonthSet = useMemo(() => new Set(
    annualAggregateStateAnchored && Array.isArray(annualAggregateLoadState?.fallbackYearMonths)
      ? annualAggregateLoadState.fallbackYearMonths
      : []
  ), [annualAggregateStateAnchored, annualAggregateLoadState]);

  const selectedRangeMonthKeys = useMemo(() => (
    getMonthKeysInRange(startMonthStr, endMonthStr)
  ), [startMonthStr, endMonthStr, selectedYear]);

  const selectedRangeNeedsAggregate = selectedRangeMonthKeys.some((yearMonth) => (
    annualAggregateFallbackMonthSet.has(yearMonth)
  ));
  const selectedRangeActualReady = Boolean(
    annualSummaryTrustReady
      && annualAggregateScopeKnown
      && (!selectedRangeNeedsAggregate || annualAggregateReady)
  );
  const annualTargetFallbackReady = Boolean(
    annualTargetFallbackLoadState?.brandId === annualBrandId
      && String(annualTargetFallbackLoadState?.year || "") === String(selectedYear)
      && annualTargetFallbackLoadState?.ready === true
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
    let sourceStores = [];
    if (userRole === 'director' || userRole === 'trainer' || userRole === 'therapist') {
      sourceStores = Object.values(managers).flat();
    } else if (userRole === 'manager' && currentUser) {
      sourceStores = managers[currentUser.name] || [];
    } else if (userRole === 'store' && currentUser) {
      sourceStores = currentUser.stores || [currentUser.storeName];
    }
    return filterSystemExcludedStoreKeys(sourceStores, systemExclusionState, cleanName);
  }, [userRole, currentUser, managers, systemExclusionState, cleanName]);

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

  useEffect(() => {
    if (selectedAnnualStore && !availableStoresForFilter.includes(selectedAnnualStore)) {
      setSelectedAnnualStore("");
    }
  }, [selectedAnnualStore, availableStoresForFilter]);

  useEffect(() => {
    if (selectedAnnualManager && !groupedStoresForFilter[selectedAnnualManager]) {
      setSelectedAnnualManager("");
      setSelectedAnnualStore("");
    }
  }, [selectedAnnualManager, groupedStoresForFilter]);

  const effectiveStores = useMemo(() => {
    if (selectedAnnualStore) {
      return filterSystemExcludedStoreKeys([selectedAnnualStore], systemExclusionState, cleanName);
    }
    if (selectedAnnualManager) {
      return filterSystemExcludedStoreKeys(
        managers[selectedAnnualManager] || [],
        systemExclusionState,
        cleanName
      );
    }
    return baseVisibleStores;
  }, [baseVisibleStores, selectedAnnualStore, selectedAnnualManager, managers, systemExclusionState, cleanName]);

  const annualHasExplicitScope = Boolean(
    selectedAnnualManager ||
    selectedAnnualStore ||
    userRole === "manager" ||
    userRole === "store"
  );
  const annualExplicitScopeStoreKeys = useMemo(
    () => annualHasExplicitScope
      ? [...new Set((effectiveStores || []).map(canonicalStoreName).filter(Boolean))]
      : null,
    [annualHasExplicitScope, effectiveStores, canonicalStoreName]
  );
  const annualFormalExclusionKeys = useMemo(() => ([
    ...(auditExclusions || []).map(canonicalStoreName),
    ...(systemExclusionState?.ready === true
      ? (systemExclusionState?.stores || []).map(canonicalStoreName)
      : []),
  ].filter(Boolean)), [auditExclusions, systemExclusionState, canonicalStoreName]);
  const resolveAnnualLifecycleScopeForMonth = useMemo(() => (yearMonth) => (
    buildAnnualLifecycleScope({
      currentLifecycleMasterState,
      yearMonth,
      brandId: currentBrand,
      scopeStoreKeys: annualExplicitScopeStoreKeys,
      excludedStoreKeys: annualFormalExclusionKeys,
      normalizeStoreKey: canonicalStoreName,
    })
  ), [
    currentLifecycleMasterState,
    currentBrand,
    annualExplicitScopeStoreKeys,
    annualFormalExclusionKeys,
    canonicalStoreName,
  ]);


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
  // 只有當某月份的 monthly_targets_summary 對該月 Lifecycle Formal scope 缺少 authoritative row 時，
  // 才精準讀取該店該月的原始 monthly_targets 文件。Explicit target 0 是 configured，不觸發 fallback。
  // 正常情況仍只讀 12 份 Summary，
  // 不重新打開全年 400+ 筆 monthly_targets 監聽。
  useEffect(() => {
    let cancelled = false;

    const readTargetValue = (row, keys = []) => {
      for (const key of keys) {
        if (!row || !Object.prototype.hasOwnProperty.call(row, key)) continue;
        const raw = row?.[key];
        if (raw === null || raw === undefined || raw === "") continue;
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0) {
          return { found: true, configured: false, value: null };
        }
        return { found: true, configured: true, value: num };
      }
      return { found: false, configured: false, value: null };
    };

    const readTargetNumber = (row, keys = []) => {
      const result = readTargetValue(row, keys);
      return result.configured ? result.value : 0;
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

      // B1C2E-UX1.1：precise fallback 的生命週期固定在 brand + year，
      // 不再跟 Q1/Q2/月篩選綁定。篩選只切片已準備好的年度 snapshot。
      const monthKeys = getMonthKeysInRange(`${selectedYear}-01`, `${selectedYear}-12`);
      setAnnualTargetFallbackLoadState({
        brandId: annualBrandId,
        year: String(selectedYear),
        ready: false,
        loading: true,
        error: "",
      });

      if (monthKeys.length === 0) {
        if (!cancelled) {
          setAnnualTargetFallbacks({});
          setAnnualTargetFallbackLoadState({
            brandId: annualBrandId,
            year: String(selectedYear),
            ready: true,
            loading: false,
            error: "",
          });
        }
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

        const lifecycleScope = resolveAnnualLifecycleScopeForMonth(yearMonth);
        if (!lifecycleScope.ready || lifecycleScope.eligibleStoreKeys.length === 0) return;
        const storeCores = lifecycleScope.eligibleStoreKeys;

        const allowRawFallback = isHistoricalMonth && annualSummaryTrustError
          ? true
          : shouldAllowAnnualRawTargetFallback({
              yearMonth,
              currentYearMonth,
              brandId: currentBrand,
              dashboardSummary: annualDashboardSummaryByMonth[yearMonth] || null,
              summaryFlag: annualSummaryStatusMap?.[yearMonth] || null,
              systemExclusionState,
              currentLifecycleMasterState,
            });
        if (!allowRawFallback) return;

        const summary = monthlyTargetSummaryByMonth[yearMonth];
        storeCores.forEach((core) => {
          const row = getSummaryTargetByCore(summary, core);
          const cashTargetResult = readTargetValue(row, ["cashTarget", "targetCash", "cashBudget", "monthlyCashTarget", "cash", "cash_target"]);
          const accrualTargetResult = readTargetValue(row, ["accrualTarget", "targetAccrual", "accrualBudget", "monthlyAccrualTarget", "accrual", "accrual_target"]);
          // Canonical Summary row presence is authoritative. Only a missing store row may trigger
          // precise Raw fallback; an explicit zero or explicit missing/invalid field must not reopen legacy authority.
          if (!row) {
            missingPairs.push({ yearMonth, core });
          }
        });
      });

      if (missingPairs.length === 0) {
        if (!cancelled) {
          setAnnualTargetFallbacks({});
          setAnnualTargetFallbackLoadState({
            brandId: annualBrandId,
            year: String(selectedYear),
            ready: true,
            loading: false,
            error: "",
          });
        }
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
          const cashTargetResult = readTargetValue(data, ["cashTarget", "targetCash", "cashBudget", "monthlyCashTarget", "cash", "cash_target"]);
          const accrualTargetResult = readTargetValue(data, ["accrualTarget", "targetAccrual", "accrualBudget", "monthlyAccrualTarget", "accrual", "accrual_target"]);
          if (cashTargetResult.found || accrualTargetResult.found) {
            resolved = {
              ...data,
              storeName: data.storeName || data.store || canonicalFullName,
              cashTarget: cashTargetResult.configured ? cashTargetResult.value : null,
              accrualTarget: accrualTargetResult.configured ? accrualTargetResult.value : null,
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

      if (!cancelled) {
        setAnnualTargetFallbacks(nextFallbacks);
        setAnnualTargetFallbackLoadState({
          brandId: annualBrandId,
          year: String(selectedYear),
          ready: true,
          loading: false,
          error: "",
        });
      }
    };

    loadMissingTargetFallbacks().catch((error) => {
      console.warn("AnnualView 精準讀取 monthly_targets fallback 失敗:", error);
      if (!cancelled) {
        setAnnualTargetFallbacks({});
        setAnnualTargetFallbackLoadState({
          brandId: annualBrandId,
          year: String(selectedYear),
          ready: true,
          loading: false,
          error: error?.message || "monthly_targets precise fallback load failed",
        });
      }
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
    selectedYear,
    annualBrandId,
    currentBrand,
    brandPrefix,
    effectiveStores,
    auditExclusions,
    systemExclusionState,
    currentLifecycleMasterState,
    canonicalStoreName,
    resolveAnnualLifecycleScopeForMonth,
  ]);

const annualData = useMemo(() => {
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

    const statsMap = monthList.map((item) => {
      const yearMonth = `${item.y}-${String(item.m).padStart(2, "0")}`;
      const notStarted = yearMonth > currentYearMonth;
      return {
        ...item,
        // Missing compatibility data is not a true zero. Initialize as unknown;
        // an observed monthly_aggregated row (including an explicit all-zero row) turns it numeric.
        cash: null,
        accrual: null,
        traffic: null,
        budget: 0,
        accrualBudget: 0,
        achievement: null,
        accrualAchievement: null,
        source: notStarted ? "not_started" : "aggregated",
        includedInTotals: true,
        actualIncludedInTotals: !notStarted,
        targetIncludedInTotals: true,
        performanceStatus: notStarted ? "NOT_STARTED" : (yearMonth === currentYearMonth ? "PROVISIONAL" : "DATA_INCOMPLETE"),
        preSystemSkip: false,
        formalTrustReason: "",
        cashCoverageComplete: false,
        accrualCoverageComplete: false,
      };
    });

    const pickNumber = (row, keys = []) => keys.reduce((value, key) => {
      if (value !== null && value !== undefined) return value;
      const raw = row?.[key];
      return raw === null || raw === undefined ? null : Number(raw) || 0;
    }, null) || 0;

    const pickTargetValue = (row, keys = []) => {
      for (const key of keys) {
        if (!row || !Object.prototype.hasOwnProperty.call(row, key)) continue;
        const raw = row?.[key];
        if (raw === null || raw === undefined || raw === "") continue;
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0) {
          return { found: true, configured: false, value: null };
        }
        return { found: true, configured: true, value: num };
      }
      return { found: false, configured: false, value: null };
    };

    const sumTargetsFromMonthlyTargetSummary = (summary, targetStat, targetStoreCores = []) => {
      const targetYearMonth = `${targetStat.y}-${String(targetStat.m).padStart(2, "0")}`;
      const summaryYearMonth = String(summary?.yearMonth || summary?.id || targetYearMonth);
      const targetsMap = summary?.targets || summary?.storeTargets || summary?.data || {};
      const requiredStoreCores = [...new Set((targetStoreCores || []).map(canonicalStoreName).filter(Boolean))];
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

      let cashTargetTotal = 0;
      let accrualTargetTotal = 0;
      let cashConfiguredStoreCount = 0;
      let accrualConfiguredStoreCount = 0;
      let usedDirectFallback = false;

      requiredStoreCores.forEach((core) => {
        let row = summaryTargetMap.get(core) || null;
        let cashTargetResult = pickTargetValue(row, ["cashTarget", "targetCash", "cashBudget", "monthlyCashTarget", "cash", "cash_target"]);
        let accrualTargetResult = pickTargetValue(row, ["accrualTarget", "targetAccrual", "accrualBudget", "monthlyAccrualTarget", "accrual", "accrual_target"]);

        // Canonical Summary row presence is authoritative. Raw fallback is only used when
        // the store row itself is absent, never to resurrect a legacy positive over an explicit zero/invalid.
        if (!row) {
          const fallbackRow = annualTargetFallbacks?.[targetYearMonth]?.[core];
          if (fallbackRow) {
            row = fallbackRow;
            cashTargetResult = pickTargetValue(row, ["cashTarget", "targetCash", "cashBudget", "monthlyCashTarget", "cash", "cash_target"]);
            accrualTargetResult = pickTargetValue(row, ["accrualTarget", "targetAccrual", "accrualBudget", "monthlyAccrualTarget", "accrual", "accrual_target"]);
            usedDirectFallback = true;
          }
        }

        if (!row) {
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
            row = budgetRow;
            cashTargetResult = pickTargetValue(budgetRow, ["cashTarget", "targetCash", "cashBudget", "monthlyCashTarget", "cash", "cash_target"]);
            accrualTargetResult = pickTargetValue(budgetRow, ["accrualTarget", "targetAccrual", "accrualBudget", "monthlyAccrualTarget", "accrual", "accrual_target"]);
            break;
          }
        }

        if (cashTargetResult.configured) {
          cashTargetTotal += cashTargetResult.value;
          cashConfiguredStoreCount += 1;
        }
        if (accrualTargetResult.configured) {
          accrualTargetTotal += accrualTargetResult.value;
          accrualConfiguredStoreCount += 1;
        }
      });

      const requiredStoreCount = requiredStoreCores.length;
      targetStat.cashCoverageComplete = cashConfiguredStoreCount === requiredStoreCount;
      targetStat.accrualCoverageComplete = accrualConfiguredStoreCount === requiredStoreCount;
      targetStat.budget = targetStat.cashCoverageComplete ? cashTargetTotal : null;
      targetStat.accrualBudget = targetStat.accrualCoverageComplete ? accrualTargetTotal : null;
      targetStat.targetSource = usedDirectFallback ? "monthly_targets_precise_fallback" : "monthly_targets_summary";
      return targetStat.cashCoverageComplete || targetStat.accrualCoverageComplete;
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
        stat.actualIncludedInTotals = false;
        stat.targetIncludedInTotals = false;
        stat.performanceStatus = "PRE_SYSTEM";
        stat.formalTrustReason = "PRE_SYSTEM_SKIP";
        return;
      }

      if (yearMonth >= currentYearMonth || !annualSummaryTrustReady) return;

      const lifecycleScope = resolveAnnualLifecycleScopeForMonth(yearMonth);
      if (!lifecycleScope.ready) {
        stat.formalTrustReason = lifecycleScope.reason || "LIFECYCLE_AUTHORITY_NOT_READY";
        return;
      }

      const dashboardSummary = annualDashboardSummaryByMonth[yearMonth] || null;
      const trust = annualSummaryTrustError
        ? { trusted: false, preSystemSkip: false, reason: "SUMMARY_LOAD_ERROR" }
        : resolveAnnualHistoricalFormalTrust({
            yearMonth,
            currentYearMonth,
            brandId: currentBrand,
            dashboardSummary,
            summaryFlag: annualSummaryStatusMap?.[yearMonth] || null,
            systemExclusionState,
            currentLifecycleMasterState,
          });
      stat.formalTrustReason = trust.reason || "";
      if (!trust.trusted) return;

      const formalMonth = buildAnnualFormalMonth({
        dashboardSummary,
        monthlyTargetSummary: monthlyTargetSummaryByMonth[yearMonth] || null,
        scopeStoreKeys: lifecycleScope.eligibleStoreKeys,
        excludedStoreKeys: [],
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
      if (!d.yearMonth) return;

      const parts = d.yearMonth.split("-");
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      const realYear = y < 1911 ? y + 1911 : y;
      const yearMonth = `${realYear}-${String(m).padStart(2, "0")}`;
      if (isAnnualPreSystemMonth(currentBrand, yearMonth)) return;
      if (summaryAppliedMonths.has(yearMonth)) return;

      const lifecycleScope = resolveAnnualLifecycleScopeForMonth(yearMonth);
      if (!lifecycleScope.ready || !lifecycleScope.eligibleStoreKeys.includes(rawStoreName)) return;

      const targetStat = statsMap.find((row) => row.y === realYear && row.m === m);
      if (targetStat) {
        targetStat.cash += (Number(d.cash) || 0) - (Number(d.refund) || 0) - (Number(d.skincareRefund) || 0);

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
        const lifecycleScope = resolveAnnualLifecycleScopeForMonth(statYearMonth);
        if (!lifecycleScope.ready) {
          stat.cash = null;
          stat.accrual = null;
          stat.traffic = null;
          stat.budget = null;
          stat.accrualBudget = null;
          stat.achievement = null;
          stat.accrualAchievement = null;
          stat.includedInTotals = false;
          stat.actualIncludedInTotals = false;
          stat.targetIncludedInTotals = false;
          stat.performanceStatus = "LIFECYCLE_NOT_READY";
          return;
        }

        // A month with zero Lifecycle-eligible stores is outside this Formal interval, not a true-zero month.
        // This is especially important before a store opens and after it permanently closes.
        if (lifecycleScope.eligibleStoreKeys.length === 0) {
          stat.cash = null;
          stat.accrual = null;
          stat.traffic = null;
          stat.budget = null;
          stat.accrualBudget = null;
          stat.achievement = null;
          stat.accrualAchievement = null;
          stat.includedInTotals = false;
          stat.actualIncludedInTotals = false;
          stat.targetIncludedInTotals = false;
          stat.performanceStatus = "N_A";
          stat.emptyLifecycleScope = true;
          return;
        }

        sumTargetsFromMonthlyTargetSummary(
          monthlyTargetSummaryByMonth[statYearMonth],
          stat,
          lifecycleScope.eligibleStoreKeys
        );
        const hasCashActual = stat.cash !== null && stat.cash !== undefined && stat.cash !== "" && Number.isFinite(Number(stat.cash));
        const hasAccrualActual = stat.accrual !== null && stat.accrual !== undefined && stat.accrual !== "" && Number.isFinite(Number(stat.accrual));
        stat.achievement = hasCashActual && stat.budget !== null && stat.budget !== undefined && Number.isFinite(Number(stat.budget)) && Number(stat.budget) > 0
          ? (Number(stat.cash) / Number(stat.budget)) * 100
          : null;
        stat.accrualAchievement = hasAccrualActual && stat.accrualBudget !== null && stat.accrualBudget !== undefined && Number.isFinite(Number(stat.accrualBudget)) && Number(stat.accrualBudget) > 0
          ? (Number(stat.accrual) / Number(stat.accrualBudget)) * 100
          : null;
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
    systemExclusionState,
    currentLifecycleMasterState,
    brandPrefix,
    currentBrand,
    currentYearMonth,
    effectiveStores,
    canonicalStoreName,
    selectedAnnualManager,
    selectedAnnualStore,
    userRole,
    resolveAnnualLifecycleScopeForMonth,
  ]);

  const { monthlyStats, totals } = annualData;
  const intervalAchievementLabel = totals.includesFutureTargets ? "區間目標完成進度" : "區間達成率";

  // 用於動態顯示上方標題的文字
  const currentViewLabel = useMemo(() => {
      if (selectedAnnualStore) return `${cleanName(selectedAnnualStore)}店`;
      if (selectedAnnualManager) return `${selectedAnnualManager}區`;
      return "全區";
  }, [selectedAnnualStore, selectedAnnualManager, cleanName]);

  const currentActiveStoresCount = useMemo(() => {
    const excluded = new Set([
      ...(auditExclusions || []).map(canonicalStoreName),
      ...(systemExclusionState?.ready === true ? (systemExclusionState?.stores || []).map(canonicalStoreName) : []),
    ].filter(Boolean));
    return effectiveStores.filter((storeName) => !excluded.has(canonicalStoreName(storeName))).length;
  }, [effectiveStores, auditExclusions, systemExclusionState, canonicalStoreName]);

  const displayAnnualMoney = (value, preSystemSkip = false, status = "", pending = false) => {
    if (pending) return "同步中";
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) return fmtMoney(Number(value));
    return resolveKpiPresentationLabel({
      status: preSystemSkip ? "PRE_SYSTEM" : status,
      fallback: "尚無資料",
    });
  };
  const displayAnnualPercent = (value, preSystemSkip = false, status = "", pending = false) => {
    if (pending) return "同步中";
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) return `${Number(value).toFixed(1)}%`;
    return resolveKpiPresentationLabel({
      status: preSystemSkip ? "PRE_SYSTEM" : status,
      fallback: "尚無資料",
    });
  };
  const annualProgressWidth = (value, pending = false) => (
    !pending && value !== null && value !== undefined && Number.isFinite(Number(value))
      ? Math.max(0, Math.min(Number(value), 100))
      : 0
  );

  const isMonthActualPending = (stat) => {
    const yearMonth = `${stat.y}-${String(stat.m).padStart(2, "0")}`;
    if (stat.preSystemSkip || stat.performanceStatus === "NOT_STARTED") return false;
    if (!annualSummaryTrustReady) return true;
    return annualAggregateFallbackMonthSet.has(yearMonth) && !annualAggregateReady;
  };

  const intervalActualPending = !selectedRangeActualReady;
  const intervalTargetPending = !annualTargetSummariesLoaded || !annualTargetFallbackReady;
  const intervalAchievementPending = intervalActualPending || intervalTargetPending;
  const annualSyncing = !annualPresentationReady
    || intervalActualPending
    || intervalTargetPending
    || annualTargetSummaryLoadState?.refreshing === true
    || annualAggregateLoadState?.refreshing === true;

  return (
    <ViewWrapper>
      <div className="space-y-6 pb-12">
        {annualSyncing && (
          <div className="flex items-center gap-2 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-xs font-bold text-amber-700 animate-in fade-in duration-200">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span>{!annualPresentationReady ? "年度資料同步中，畫面會自動補齊" : "最新年度資料正在背景更新"}</span>
          </div>
        )}
        
        {/* 標題與權限顯示 */}
        <div className="flex flex-col gap-4 mb-2">
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in fade-in slide-in-from-left-2 duration-500">
             <div className="flex items-center gap-3">
               <div className="p-3 bg-amber-100 text-amber-600 rounded-xl shadow-sm">
                 <Calendar size={24} />
               </div>
               <div>
                 <h1 className="text-2xl font-bold text-stone-800">經營績效分析 ({brandPrefix})</h1>
                 <p className="text-xs text-stone-500 font-medium">年度營運分析</p>
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
              <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center md:w-auto">
                <SmartMonthPicker
                  value={startMonthStr}
                  onChange={setStartMonthStr}
                  minMonth={`${selectedYear}-01`}
                  maxMonth={`${selectedYear}-12`}
                  align="left"
                />
                <span className="hidden text-stone-400 sm:inline-flex"><ArrowRight size={16}/></span>
                <SmartMonthPicker
                  value={endMonthStr}
                  onChange={setEndMonthStr}
                  minMonth={`${selectedYear}-01`}
                  maxMonth={`${selectedYear}-12`}
                  align="right"
                />
              </div>
           </div>
        </div>

        {/* 區塊 1: 區間總 KPI */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
          <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-20"><DollarSign size={100} /></div>
            <div className="relative z-10">
              <p className="text-amber-100 font-bold text-sm mb-1 flex items-center gap-1"><Target size={14}/> 區間現金{intervalAchievementLabel === "區間目標完成進度" ? "目標完成進度" : "達成"}</p>
              <h2 className="text-4xl font-extrabold font-mono tracking-tight mb-4">{displayAnnualMoney(totals.cash, false, "", intervalActualPending)}</h2>
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-amber-100">
                  <span>區間目標 {displayAnnualMoney(totals.budget, false, "", intervalTargetPending)}</span>
                  <span>{displayAnnualPercent(totals.cashAch, false, "", intervalAchievementPending)}</span>
                </div>
                <div className="w-full bg-black/20 h-2 rounded-full overflow-hidden">
                  <div className="bg-white h-full rounded-full transition-all duration-1000" style={{ width: `${annualProgressWidth(totals.cashAch, intervalAchievementPending)}%` }}></div>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white border-2 border-indigo-100 rounded-2xl p-6 shadow-sm relative overflow-hidden flex flex-col justify-center">
             <div className="absolute top-0 right-0 p-4 opacity-5 text-indigo-600"><Activity size={100} /></div>
             <div className="relative z-10">
              <p className="text-indigo-400 font-bold text-sm mb-1 flex items-center gap-1"><Award size={14}/> 區間權責{intervalAchievementLabel === "區間目標完成進度" ? "目標完成進度" : "達成"}</p>
              <h2 className={`text-4xl font-extrabold font-mono tracking-tight text-stone-700 ${brandPrefix === '安妞' ? 'mb-1' : 'mb-4'}`}>{displayAnnualMoney(totals.accrual, false, "", intervalActualPending)}</h2>
              {/* ★ 針對安妞的文字提示 */}
              {brandPrefix === '安妞' && (
                <p className="text-[11px] text-indigo-400 mb-3 font-medium flex items-center gap-1">
                  <span className="inline-block w-1 h-1 bg-indigo-400 rounded-full"></span> 僅含技術操作 (排除產品)
                </p>
              )}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-stone-400">
                  <span>區間目標 {displayAnnualMoney(totals.accrualBudget, false, "", intervalTargetPending)}</span>
                  <span className={totals.accrualAch >= 100 ? "text-emerald-500" : "text-stone-500"}>{displayAnnualPercent(totals.accrualAch, false, "", intervalAchievementPending)}</span>
                </div>
                <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-indigo-500 h-full rounded-full transition-all duration-1000" style={{ width: `${annualProgressWidth(totals.accrualAch, intervalAchievementPending)}%` }}></div>
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
                          <span className="ml-2 px-2 py-0.5 rounded-full bg-stone-100 text-stone-400 text-[10px] font-bold">不納入</span>
                        )}
                        {stat.performanceStatus === "NOT_STARTED" && (
                          <span className="ml-2 px-2 py-0.5 rounded-full bg-sky-50 text-sky-500 text-[10px] font-bold">未開始</span>
                        )}
                        {isMonthActualPending(stat) && !stat.preSystemSkip && stat.performanceStatus !== "NOT_STARTED" && (
                          <span className="ml-2 px-2 py-0.5 rounded-full bg-sky-50 text-sky-600 text-[10px] font-bold">同步中</span>
                        )}
                        {stat.performanceStatus === "DATA_INCOMPLETE" && !stat.preSystemSkip && !isMonthActualPending(stat) && (
                          <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold">資料未完整</span>
                        )}
                      </td>
                      <td className="py-4 text-right font-mono text-stone-400 text-xs">{displayAnnualMoney(stat.budget, stat.preSystemSkip, stat.performanceStatus, !annualTargetSummariesLoaded || !annualTargetFallbackReady)}</td>
                      <td className="py-4 text-right font-mono text-stone-700 font-bold">{displayAnnualMoney(stat.cash, stat.preSystemSkip, stat.performanceStatus, isMonthActualPending(stat))}</td>
                      <td className="py-4 text-right font-bold">
                         <span className={`px-2 py-1 rounded-md text-xs ${stat.achievement >= 100 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-400'}`}>
                           {displayAnnualPercent(stat.achievement, stat.preSystemSkip, stat.performanceStatus, isMonthActualPending(stat) || !annualTargetSummariesLoaded || !annualTargetFallbackReady)}
                         </span>
                      </td>
                      <td className="py-4 text-right font-mono text-stone-400 text-xs pl-4 border-l border-dashed border-stone-100">{displayAnnualMoney(stat.accrualBudget, stat.preSystemSkip, stat.performanceStatus, !annualTargetSummariesLoaded || !annualTargetFallbackReady)}</td>
                      <td className="py-4 text-right font-mono text-indigo-600 font-bold">{displayAnnualMoney(stat.accrual, stat.preSystemSkip, stat.performanceStatus, isMonthActualPending(stat))}</td>
                      <td className="py-4 text-right font-bold">
                         <span className={`px-2 py-1 rounded-md text-xs ${stat.accrualAchievement >= 100 ? 'bg-indigo-100 text-indigo-700' : 'bg-stone-100 text-stone-400'}`}>
                           {displayAnnualPercent(stat.accrualAchievement, stat.preSystemSkip, stat.performanceStatus, isMonthActualPending(stat) || !annualTargetSummariesLoaded || !annualTargetFallbackReady)}
                         </span>
                      </td>
                      <td className="py-4 text-right font-mono text-stone-600 pl-4 border-l border-dashed border-stone-100">{isMonthActualPending(stat) ? "同步中" : (Number.isFinite(Number(stat.traffic)) && stat.traffic !== null ? fmtNum(stat.traffic) : resolveKpiPresentationLabel({ status: stat.preSystemSkip ? "PRE_SYSTEM" : stat.performanceStatus, fallback: "尚無資料" }))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-stone-50 font-bold text-stone-800 border-t-2 border-stone-100">
                  <tr>
                    <td className="py-4 pl-2 text-stone-500">區間總計</td>
                    <td className="py-4 text-right font-mono text-stone-500 text-xs">{displayAnnualMoney(totals.budget, false, "", intervalTargetPending)}</td>
                    <td className="py-4 text-right font-mono text-amber-600">{displayAnnualMoney(totals.cash, false, "", intervalActualPending)}</td>
                    <td className="py-4 text-right text-emerald-600">{displayAnnualPercent(totals.cashAch, false, "", intervalAchievementPending)}</td>
                    <td className="py-4 text-right font-mono text-stone-500 text-xs pl-4 border-l border-dashed border-stone-200">{displayAnnualMoney(totals.accrualBudget, false, "", intervalTargetPending)}</td>
                    <td className="py-4 text-right font-mono text-indigo-600">{displayAnnualMoney(totals.accrual, false, "", intervalActualPending)}</td>
                    <td className="py-4 text-right text-emerald-600">{displayAnnualPercent(totals.accrualAch, false, "", intervalAchievementPending)}</td>
                    <td className="py-4 text-right font-mono pl-4 border-l border-dashed border-stone-200">{intervalActualPending ? "同步中" : (totals.traffic !== null && totals.traffic !== undefined && Number.isFinite(Number(totals.traffic)) ? fmtNum(totals.traffic) : "尚無資料")}</td>
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
