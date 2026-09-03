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
import { query, where, orderBy, onSnapshot } from "firebase/firestore";
import { trackSnapshotRead } from "../utils/readTracker";
import { toStandardDateFormat, formatNumber, sortManagerNames, sortStoreNames, sortManagersByOrgOrder, sortStoresByOrgOrder } from "../utils/helpers";
import { ViewWrapper, Card } from "./SharedUI";
import { buildCurrentDetailFormalAuthority, buildCurrentDetailFormalScope } from "../utils/currentDetailFormalConsumer";
import {
  buildStoreAnalysisTargetPresentationAuthority,
  resolveStoreAnalysisCashTargetPresentation,
  resolveStoreAnalysisCashTargetScopePresentation,
} from "../utils/storeAnalysisTargetAuthority";
import {
  buildStoreHealthMetrics,
  resolveStoreHealthBenchmarkProfile,
  STORE_HEALTH_DIMENSIONS,
} from "../utils/storeHealth.js";
import { KPI_VALUE_STATUS } from "../utils/kpiContracts.js";

const StoreAnalysisView = () => {
  const {
    rawData,
    allReports,
    monthlyTargetSummary,
    currentLifecycleMasterState,
    systemExclusionState,
    currentDashboardSummary,
    managers, managerOrder,
    targets, 
    selectedYear,
    selectedMonth,
    fmtMoney,
    fmtNum,
    currentUser,
    userRole,
    activeView,
    currentBrand,
    getCollectionPath,
    accessibleStores = [], delegatedStores = [],
  } = useContext(AppContext);

  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [showBenchmark, setShowBenchmark] = useState(true);
  const [storeScopedReports, setStoreScopedReports] = useState([]);
  const [storeScopedLoading, setStoreScopedLoading] = useState(false);

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

  // ★ 目標資料專用正規化：只在 Summary / monthly_targets 比對時，
  //   將歷史別名「新」視為正式店名「新店」。
  //   不修改既有 cleanStoreName，避免影響組織、代理管理、日報與其他品牌邏輯。
  const canonicalTargetStoreName = useCallback((name) => {
    const core = cleanStoreName(name);
    return brandPrefix === "CYJ" && core === "新" ? "新店" : core;
  }, [brandPrefix, cleanStoreName]);

  const isBrandMatch = useCallback((storeName, bId) => {
      const name = String(storeName || "");
      if (bId === '安妞') return /安妞|Anew|Ann/i.test(name);
      if (bId === '伊啵') return /伊啵|Yibo/i.test(name);
      return !(/安妞|Anew|伊啵|Yibo/i.test(name)); 
  }, []);

  const selectedYearMonth = useMemo(() => (
    `${String(selectedYear || "")}-${String(selectedMonth || "").padStart(2, "0")}`
  ), [selectedYear, selectedMonth]);

  // Store Analysis target presentation is Coverage-aware.
  // target-coverage-v1 status is authoritative; stale legacy Summary containers are never scanned.
  // The canonical `targets` map is the only value container. Missing/zero target may display $0
  // for a single store, but aggregate scopes remain fail-closed and never shrink denominators.
  const storeAnalysisTargetAuthority = useMemo(() => (
    buildStoreAnalysisTargetPresentationAuthority({
      summary: monthlyTargetSummary,
      brandId: currentBrand?.id || "",
      yearMonth: selectedYearMonth,
      normalizeStoreKey: canonicalTargetStoreName,
    })
  ), [monthlyTargetSummary, currentBrand?.id, selectedYearMonth, canonicalTargetStoreName]);

  const resolveStoreTargetPresentation = useCallback((coreName, fullName) => (
    resolveStoreAnalysisCashTargetPresentation({
      authority: storeAnalysisTargetAuthority,
      storeName: coreName || fullName,
      normalizeStoreKey: canonicalTargetStoreName,
    })
  ), [storeAnalysisTargetAuthority, canonicalTargetStoreName]);

  const resolveScopeTargetPresentation = useCallback((storesList = []) => (
    resolveStoreAnalysisCashTargetScopePresentation({
      authority: storeAnalysisTargetAuthority,
      storeNames: storesList,
      normalizeStoreKey: canonicalTargetStoreName,
    })
  ), [storeAnalysisTargetAuthority, canonicalTargetStoreName]);

  // 2. Store Health 標準只接受目前品牌的 runtime kpi_targets.benchmarks。
  // 不跨品牌借用 default，也不以頁面 hardcode 數值補標準。
  const currentBenchmarks = useMemo(() => resolveStoreHealthBenchmarkProfile({
    brandId,
    benchmarks: targets?.benchmarks || {},
  }), [brandId, targets?.benchmarks]);

  const formatMoneyOrNA = useCallback((value) => (
    typeof value === "number" && Number.isFinite(value) ? fmtMoney(value) : "N/A"
  ), [fmtMoney]);

  const formatAchievementOrNA = useCallback((value) => (
    typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}% 達成` : "N/A"
  ), []);

  const getAchievementTone = useCallback((value) => {
    if (!(typeof value === "number" && Number.isFinite(value))) return "text-stone-400";
    return value >= 100 ? "text-emerald-500" : "text-amber-500";
  }, []);

  const formatHealthPercentOrNA = useCallback((value, digits = 1) => (
    typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "N/A"
  ), []);

  const formatScoreOrNA = useCallback((value) => (
    typeof value === "number" && Number.isFinite(value) ? value.toFixed(0) : "N/A"
  ), []);

  const isHealthMetricBelowBenchmark = useCallback((value, benchmark, offset = 0) => (
    typeof value === "number"
    && Number.isFinite(value)
    && benchmark?.valid === true
    && typeof benchmark.min === "number"
    && Number.isFinite(benchmark.min)
    && value < (benchmark.min + offset)
  ), []);

  const getHealthDiagnosis = useCallback((health) => {
    if (!health) return { text: "資料不足", tone: "neutral" };
    const benchmarkStates = STORE_HEALTH_DIMENSIONS.map((dimension) => health?.benchmarks?.[dimension]?.status);
    if (benchmarkStates.some((status) => status === KPI_VALUE_STATUS.DATA_INVALID)) {
      return { text: "標準設定無效", tone: "neutral" };
    }
    if (benchmarkStates.some((status) => status === KPI_VALUE_STATUS.FIELD_MISSING)) {
      return { text: "標準未設定", tone: "neutral" };
    }
    if (STORE_HEALTH_DIMENSIONS.some((dimension) => !(typeof health?.scores?.[dimension] === "number" && Number.isFinite(health.scores[dimension])))) {
      return { text: "資料不足", tone: "neutral" };
    }
    if (health.scores.financial < 60) return { text: "需注意現金流", tone: "risk" };
    if (health.scores.loyalty < 60) return { text: "舊客流失風險", tone: "risk" };
    if (health.scores.sales < 60) return { text: "產品銷售偏弱", tone: "risk" };
    return { text: "體質健康", tone: "healthy" };
  }, []);

  const isManagementRole = userRole === "director" || userRole === "trainer" || userRole === "manager";

  const targetBrandManagers = useMemo(() => {
    const safeManagers = managers || {}; 
    
    if (brandId === 'default') {
        return sortManagersByOrgOrder(safeManagers, Object.keys(safeManagers).filter(mgr => {
             const stores = safeManagers[mgr] || [];
             const isSideBrand = stores.some(s => /安妞|Anew|伊啵|Yibo/i.test(String(s || "")));
             return !isSideBrand;
        }), managerOrder);
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
        return sortManagersByOrgOrder(safeManagers, null, managerOrder);
    }

    return sortManagersByOrgOrder(safeManagers, Array.from(detectedManagers), managerOrder);
  }, [managers, managerOrder, brandId, rawData, cleanStoreName]);

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

  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent("cyj_store_analysis_selected_store_changed", {
        detail: { selectedStore }
      }));
    } catch (error) {
      // 僅用於通知 App 是否啟動完整店日報監聽，不影響單店分析顯示。
    }
  }, [selectedStore]);

  const selectedYearMonthRange = useMemo(() => {
    const y = String(selectedYear || "");
    const m = String(selectedMonth || "").padStart(2, "0");
    return {
      startDate: `${y}-${m}-01`,
      endDate: `${y}-${m}-31`,
    };
  }, [selectedYear, selectedMonth]);

  const isDateInSelectedMonth = useCallback((dateValue) => {
    if (!dateValue) return false;

    const raw = String(dateValue).trim();
    const parts = raw.replace(/-/g, "/").split("/");
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);

    const targetYear = parseInt(selectedYear, 10);
    const targetMonth = parseInt(selectedMonth, 10);
    const rocYear = targetYear - 1911;

    return (y === targetYear || y === rocYear) && m === targetMonth;
  }, [selectedYear, selectedMonth]);

  const buildStoreNameVariants = useCallback((storeName = "") => {
    const core = cleanStoreName(storeName);
    const variants = [
      storeName,
      core,
      `${core}店`,
      `${brandPrefix}${core}店`,
      `${brandPrefix}${core}`,
    ];

    return Array.from(new Set(
      variants
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    )).slice(0, 10);
  }, [brandPrefix, cleanStoreName]);

  const summaryReportRows = useMemo(() => {
    const stores = currentDashboardSummary?.stores;
    if (!stores) return [];

    const rows = Array.isArray(stores) ? stores : Object.values(stores || {});
    return rows.map((store) => {
      const name = store?.displayName || store?.storeName || store?.store || store?.name || "";
      const core = cleanStoreName(name);
      const storeName = `${brandPrefix}${core}店`;
      return {
        id: `summary_${core}`,
        date: selectedYearMonthRange.startDate,
        storeName,
        cash: Number(store?.cash ?? store?.cashTotal ?? 0),
        refund: Number(store?.refund ?? store?.refundTotal ?? 0),
        skincareRefund: Number(store?.skincareRefund ?? store?.skincareRefundTotal ?? 0),
        skincareRefundStatus: String(store?.skincareRefundStatus || ""),
        formalNetCash: store?.formalNetCash ?? null,
        formalNetCashStatus: String(store?.formalNetCashStatus || ""),
        accrual: Number(store?.accrual ?? store?.accrualTotal ?? 0),
        operationalAccrual: Number(store?.operationalAccrual ?? store?.operationalAccrualTotal ?? store?.accrual ?? store?.accrualTotal ?? 0),
        formalAccrual: store?.formalAccrual ?? null,
        formalAccrualStatus: String(store?.formalAccrualStatus || ""),
        storeHealthInputVersion: String(store?.storeHealthInputVersion || ""),
        skincareSales: Number(store?.skincareSales ?? store?.skincareSalesTotal ?? 0),
        skincareSalesStatus: String(store?.skincareSalesStatus || ""),
        traffic: Number(store?.traffic ?? store?.trafficTotal ?? 0),
        trafficStatus: String(store?.trafficStatus || ""),
        newCustomers: Number(store?.newCustomers ?? store?.newCustomersTotal ?? 0),
        newCustomersStatus: String(store?.newCustomersStatus || ""),
        newCustomerSales: Number(store?.newCustomerSales ?? store?.newCustomerSalesTotal ?? 0),
        newCustomerSalesStatus: String(store?.newCustomerSalesStatus || ""),
        newCustomerClosings: Number(store?.newCustomerClosings ?? store?.newCustomerClosingsTotal ?? 0),
        source: "dashboard_summary",
      };
    }).filter((row) => cleanStoreName(row.storeName));
  }, [currentDashboardSummary, brandPrefix, cleanStoreName, selectedYearMonthRange.startDate]);

  const storeScopedAnalysisReports = useMemo(() => {
    if (storeScopedReports.length > 0) return storeScopedReports;
    if (!selectedStore) return [];

    const selectedCore = cleanStoreName(selectedStore);
    return summaryReportRows.filter((row) => cleanStoreName(row.storeName) === selectedCore);
  }, [storeScopedReports, summaryReportRows, selectedStore, cleanStoreName]);

  const analysisAllReports = useMemo(() => {
    if (activeView === "store-analysis") {
      if (!selectedStore) {
        return (allReports && allReports.length > 0) ? allReports : summaryReportRows;
      }
      return summaryReportRows.length > 0 ? summaryReportRows : storeScopedReports;
    }
    return allReports || [];
  }, [activeView, selectedStore, summaryReportRows, storeScopedReports, allReports]);

  useEffect(() => {
    if (activeView !== "store-analysis" || !selectedStore || !getCollectionPath) {
      setStoreScopedReports([]);
      setStoreScopedLoading(false);
      return undefined;
    }

    const variants = buildStoreNameVariants(selectedStore);
    if (!variants.length) {
      setStoreScopedReports([]);
      setStoreScopedLoading(false);
      return undefined;
    }

    let fallbackUnsub = null;
    let cancelled = false;
    setStoreScopedLoading(true);

    const applySnapshot = (snap, label, shouldFilterMonth = false) => {
      trackSnapshotRead(label, snap, {
        label,
        view: "store-analysis",
        storeName: selectedStore,
      });

      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const filtered = shouldFilterMonth
        ? docs.filter((d) => isDateInSelectedMonth(d.date))
        : docs;

      if (!cancelled) {
        setStoreScopedReports(filtered);
        setStoreScopedLoading(false);
      }

      if (!shouldFilterMonth && docs.length === 0) {
        startFallback();
      }
    };

    const startFallback = () => {
      try {
        fallbackUnsub = onSnapshot(
          query(getCollectionPath("daily_reports"), where("storeName", "in", variants)),
          (snap) => applySnapshot(snap, "store_analysis_selected_store_reports_fallback", true),
          (error) => {
            console.error("單店分析 fallback 讀取失敗:", error);
            if (!cancelled) {
              setStoreScopedReports([]);
              setStoreScopedLoading(false);
            }
          }
        );
      } catch (error) {
        console.error("單店分析 fallback query 建立失敗:", error);
        if (!cancelled) {
          setStoreScopedReports([]);
          setStoreScopedLoading(false);
        }
      }
    };

    let primaryUnsub = null;
    try {
      primaryUnsub = onSnapshot(
        query(
          getCollectionPath("daily_reports"),
          where("storeName", "in", variants),
          where("date", ">=", selectedYearMonthRange.startDate),
          where("date", "<=", selectedYearMonthRange.endDate),
          orderBy("date", "desc")
        ),
        (snap) => applySnapshot(snap, "store_analysis_selected_store_reports", false),
        (error) => {
          console.warn("單店分析精準讀取失敗，改用店名 fallback:", error);
          if (!cancelled) startFallback();
        }
      );
    } catch (error) {
      console.warn("單店分析精準 query 建立失敗，改用店名 fallback:", error);
      startFallback();
    }

    return () => {
      cancelled = true;
      try { primaryUnsub && primaryUnsub(); } catch (error) { console.warn("store analysis primary unsubscribe failed", error); }
      try { fallbackUnsub && fallbackUnsub(); } catch (error) { console.warn("store analysis fallback unsubscribe failed", error); }
    };
  }, [activeView, selectedStore, selectedYearMonthRange.startDate, selectedYearMonthRange.endDate, getCollectionPath, buildStoreNameVariants, isDateInSelectedMonth]);

  const formalReportRows = useMemo(() => (
    selectedStore ? storeScopedAnalysisReports : analysisAllReports
  ), [selectedStore, storeScopedAnalysisReports, analysisAllReports]);

  // 5D-2 production hotfix: Store Analysis joins the shared current/detail Formal authority.
  // Target status comes only from the selected-month monthly_targets_summary; no stale dashboard/raw fallback.
  const currentDetailFormalAuthority = useMemo(() => buildCurrentDetailFormalAuthority({
    brandId: currentBrand?.id || "",
    yearMonth: selectedYearMonth,
    lifecycleMaster: currentLifecycleMasterState?.data || null,
    monthlyTargetSummary,
    reports: formalReportRows,
    systemExclusionState,
  }), [currentBrand?.id, selectedYearMonth, currentLifecycleMasterState?.data, monthlyTargetSummary, formalReportRows, systemExclusionState]);

  const getFormalScope = useCallback((storeKeys = null) => buildCurrentDetailFormalScope({
    authority: currentDetailFormalAuthority,
    storeKeys,
  }), [currentDetailFormalAuthority]);

  // ==========================================
  // 單店運算與彙整運算引擎
  // ==========================================
  // Store Health formulas / validity / brand benchmark authority are owned by a pure helper.
  const calculateHealthMetrics = useCallback((dataList) => buildStoreHealthMetrics({
    brandId,
    rows: dataList || [],
    newASP: targets?.newASP,
    benchmarks: targets?.benchmarks || {},
  }), [brandId, targets?.newASP, targets?.benchmarks]);

  const formalEligibleStoreSet = useMemo(() => new Set(
    Array.isArray(currentDetailFormalAuthority?.eligibleStoreKeys)
      ? currentDetailFormalAuthority.eligibleStoreKeys.map(cleanStoreName).filter(Boolean)
      : []
  ), [currentDetailFormalAuthority?.eligibleStoreKeys, cleanStoreName]);

  const availableStores = useMemo(() => {
    const safeManagers = managers || {};
    const formatStoreName = (storeName) => {
      if (!storeName) return "";
      const core = cleanStoreName(storeName);
      return core && formalEligibleStoreSet.has(core) ? `${brandPrefix}${core}店` : "";
    };

    let sourceStores = [];
    if (userRole === "director" || userRole === "trainer") {
      sourceStores = selectedManager
        ? (safeManagers[selectedManager] || [])
        : targetBrandManagers.flatMap((manager) => safeManagers[manager] || []);
    } else if (userRole === "manager") {
      sourceStores = accessibleStores || [];
    } else if (userRole === "store" && currentUser) {
      sourceStores = (accessibleStores || []).length
        ? accessibleStores
        : (currentUser.stores || (currentUser.storeName ? [currentUser.storeName] : []));
    }

    return sortStoresByOrgOrder(
      safeManagers,
      sourceStores.map(formatStoreName).filter(Boolean),
      brandPrefix,
      managerOrder
    );
  }, [
    selectedManager, managers, managerOrder, currentUser, userRole, brandPrefix,
    targetBrandManagers, cleanStoreName, accessibleStores, formalEligibleStoreSet,
  ]);

  useEffect(() => {
    if (currentDetailFormalAuthority?.compatible !== true) return;
    if (selectedStore && !availableStores.includes(selectedStore)) {
      setSelectedStore("");
      return;
    }
    if (userRole === "store" && currentUser && !selectedStore && availableStores.length > 0) {
      setSelectedStore(availableStores[0]);
    }
  }, [currentDetailFormalAuthority?.compatible, currentUser, availableStores, selectedStore, userRole]);

  const getAggregateData = useCallback((storesList) => {
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;
    const normalizedStores = Array.from(new Set((storesList || []).map(cleanStoreName).filter(Boolean)))
      .filter((storeKey) => formalEligibleStoreSet.has(storeKey));

    const data = analysisAllReports.filter(d => {
        if (!d.date || !d.storeName) return false;
        const parts = String(d.date).replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        if (!((y === targetYear || y === rocYear) && m === monthInt)) return false;

        const core = cleanStoreName(d.storeName);
        return normalizedStores.includes(core);
    }).map(d => {
        let adjustedAccrual = Number(d.accrual) || 0;
        if (brandId === '安妞') adjustedAccrual = Number(d.operationalAccrual) || 0;
        return { ...d, accrual: adjustedAccrual };
    });

    const formalScope = getFormalScope(normalizedStores);
    const targetPresentation = resolveScopeTargetPresentation(normalizedStores);
    const totalRefund = data.reduce(
      (a, b) => a + (Number(b.refund) || 0) + (Number(b.skincareRefund) || 0),
      0
    );
    const traffic = data.reduce((a, b) => a + (Number(b.traffic) || 0), 0);
    const opAccrual = data.reduce((a, b) => a + (Number(b.operationalAccrual) || 0), 0);
    const newCust = data.reduce((a, b) => a + (Number(b.newCustomers) || 0), 0);
    const newSales = data.reduce((a, b) => a + (Number(b.newCustomerSales) || 0), 0);
    const newClosings = data.reduce((a, b) => a + (Number(b.newCustomerClosings) || 0), 0);
    const health = calculateHealthMetrics(data);

    return {
        totalCash: typeof formalScope.cash === "number" && Number.isFinite(formalScope.cash) ? formalScope.cash : null,
        cashStatus: formalScope.cashStatus,
        totalRefund,
        totalTraffic: traffic,
        trafficASP: traffic > 0 ? Math.round(opAccrual / traffic) : 0,
        newCustomerASP: typeof health.raw.newCustomerASP === "number" ? Math.round(health.raw.newCustomerASP) : null,
        totalNewCustomerClosings: newClosings,
        budget: targetPresentation.complete ? targetPresentation.value : null,
        budgetStatus: formalScope.cashTargetStatus,
        achievement: typeof formalScope.cashAchievement === "number" && Number.isFinite(formalScope.cashAchievement)
          ? formalScope.cashAchievement
          : null,
        achievementStatus: formalScope.cashAchievementStatus,
        reportingStatus: formalScope.reportingStatus,
        health,
    };
  }, [analysisAllReports, selectedYear, selectedMonth, cleanStoreName, brandId, getFormalScope, resolveScopeTargetPresentation, calculateHealthMetrics, formalEligibleStoreSet]);

  const globalMetrics = useMemo(() => {
    if (!analysisAllReports) return null;
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;

    const globalData = analysisAllReports.filter(d => {
        if (!d.date || !d.storeName) return false;
        const parts = String(d.date).replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        if (!((y === targetYear || y === rocYear) && m === monthInt)) return false;
        const storeKey = cleanStoreName(d.storeName);
        return isBrandMatch(d.storeName, brandId) && formalEligibleStoreSet.has(storeKey);
    }).map(d => {
        let adjustedAccrual = Number(d.accrual) || 0;
        if (brandId === '安妞') adjustedAccrual = Number(d.operationalAccrual) || 0;
        return { ...d, accrual: adjustedAccrual };
    });

    const scopeStoreKeys = Array.isArray(currentDetailFormalAuthority?.eligibleStoreKeys)
      ? currentDetailFormalAuthority.eligibleStoreKeys
      : Array.from(new Set(globalData.map(d => cleanStoreName(d.storeName))));
    const formalScope = getFormalScope(null);
    const targetPresentation = resolveScopeTargetPresentation(scopeStoreKeys);
    const totalRefund = globalData.reduce(
      (a, b) => a + (Number(b.refund) || 0) + (Number(b.skincareRefund) || 0),
      0
    );
    const traffic = globalData.reduce((a, b) => a + (Number(b.traffic) || 0), 0);
    const opAccrual = globalData.reduce((a, b) => a + (Number(b.operationalAccrual) || 0), 0);
    const newCust = globalData.reduce((a, b) => a + (Number(b.newCustomers) || 0), 0);
    const newSales = globalData.reduce((a, b) => a + (Number(b.newCustomerSales) || 0), 0);
    const newClosings = globalData.reduce((a, b) => a + (Number(b.newCustomerClosings) || 0), 0);
    const health = calculateHealthMetrics(globalData);

    return {
        totalCash: typeof formalScope.cash === "number" && Number.isFinite(formalScope.cash) ? formalScope.cash : null,
        cashStatus: formalScope.cashStatus,
        totalRefund,
        totalTraffic: traffic,
        trafficASP: traffic > 0 ? Math.round(opAccrual / traffic) : 0,
        newCustomerASP: typeof health.raw.newCustomerASP === "number" ? Math.round(health.raw.newCustomerASP) : null,
        totalNewCustomerClosings: newClosings,
        budget: targetPresentation.complete ? targetPresentation.value : null,
        budgetStatus: formalScope.cashTargetStatus,
        achievement: typeof formalScope.cashAchievement === "number" && Number.isFinite(formalScope.cashAchievement)
          ? formalScope.cashAchievement
          : null,
        achievementStatus: formalScope.cashAchievementStatus,
        reportingStatus: formalScope.reportingStatus,
        health,
    };
  }, [analysisAllReports, selectedYear, selectedMonth, isBrandMatch, brandId, currentDetailFormalAuthority, getFormalScope, resolveScopeTargetPresentation, cleanStoreName, calculateHealthMetrics, formalEligibleStoreSet]);

  const regionMetrics = useMemo(() => {
    if (!isManagementRole || !analysisAllReports) return null;
    if (userRole === 'manager') {
      const managementStores = (accessibleStores || []).map(cleanStoreName).filter(Boolean);
      return managementStores.length ? getAggregateData(managementStores) : null;
    }
    const targetManager = selectedManager;
    if (!targetManager) return null;
    return getAggregateData((managers[targetManager] || []).map(cleanStoreName));
  }, [isManagementRole, selectedManager, userRole, analysisAllReports, managers, cleanStoreName, getAggregateData, accessibleStores]);

  const storeMetrics = useMemo(() => {
    if (!selectedStore) return null;
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;
    const targetCoreName = cleanStoreName(selectedStore);
    const selectedStoreFormalEligible = formalEligibleStoreSet.has(targetCoreName);

    const data = storeScopedAnalysisReports.filter((d) => {
        if (!selectedStoreFormalEligible || !d.date || !d.storeName) return false;
        const parts = String(d.date).replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        if (!((y === targetYear || y === rocYear) && m === monthInt)) return false;
        return cleanStoreName(d.storeName) === targetCoreName;
    }).map(d => {
        let adjustedAccrual = Number(d.accrual) || 0;
        if (brandId === '安妞') adjustedAccrual = Number(d.operationalAccrual) || 0;
        return { ...d, accrual: adjustedAccrual };
    }).sort((a, b) => toStandardDateFormat(a.date).localeCompare(toStandardDateFormat(b.date)));

    const formalScope = getFormalScope([targetCoreName]);
    const targetPresentation = resolveStoreTargetPresentation(targetCoreName, selectedStore);
    const totalRefund = data.reduce(
      (a, b) => a + (Number(b.refund) || 0) + (Number(b.skincareRefund) || 0),
      0
    );
    const totalTraffic = data.reduce((a, b) => a + (Number(b.traffic) || 0), 0);
    const totalOpAccrual = data.reduce((a, b) => a + (Number(b.operationalAccrual) || 0), 0);
    const totalNewCustomers = data.reduce((a, b) => a + (Number(b.newCustomers) || 0), 0);
    const totalNewCustomerSales = data.reduce((a, b) => a + (Number(b.newCustomerSales) || 0), 0);
    const totalNewCustomerClosings = data.reduce((a, b) => a + (Number(b.newCustomerClosings) || 0), 0);
    const health = calculateHealthMetrics(data);

    return {
      totalCash: typeof formalScope.cash === "number" && Number.isFinite(formalScope.cash) ? formalScope.cash : null,
      cashStatus: formalScope.cashStatus,
      achievement: typeof formalScope.cashAchievement === "number" && Number.isFinite(formalScope.cashAchievement)
        ? formalScope.cashAchievement
        : null,
      achievementStatus: formalScope.cashAchievementStatus,
      reportingStatus: formalScope.reportingStatus,
      trafficASP: totalTraffic > 0 ? Math.round(totalOpAccrual / totalTraffic) : 0,
      newCustomerASP: typeof health.raw.newCustomerASP === "number" ? Math.round(health.raw.newCustomerASP) : null,
      totalNewCustomerClosings,
      totalRefund,
      dailyData: data.map((d) => ({
        date: String(toStandardDateFormat(d.date)).split("/")[2],
        cash: (Number(d.cash) || 0) - (Number(d.refund) || 0) - (Number(d.skincareRefund) || 0),
        accrual: Number(d.accrual) || 0,
        traffic: Number(d.traffic) || 0,
      })),
      budget: targetPresentation.found ? targetPresentation.value : null,
      budgetStatus: formalScope.cashTargetStatus,
      health,
    };
  }, [selectedStore, selectedYear, selectedMonth, storeScopedAnalysisReports, cleanStoreName, calculateHealthMetrics, brandId, getFormalScope, resolveStoreTargetPresentation, formalEligibleStoreSet]);

  const benchmarkMetrics = useMemo(() => {
      if (!showBenchmark || !analysisAllReports) return null;
      const targetYear = parseInt(selectedYear);
      const monthInt = parseInt(selectedMonth);
      const rocYear = targetYear - 1911;

      const benchmarkData = analysisAllReports.filter(d => {
          if (!d.date || !d.storeName) return false;
          const parts = String(d.date).replace(/-/g, "/").split("/");
          const y = parseInt(parts[0]);
          const m = parseInt(parts[1]);
          if (!((y === targetYear || y === rocYear) && m === monthInt)) return false;

          if (!isBrandMatch(d.storeName, brandId)) return false;
          const storeKey = cleanStoreName(d.storeName);
          if (!formalEligibleStoreSet.has(storeKey)) return false;
          if (storeKey === cleanStoreName(selectedStore)) return false;

          return true;
      });

      return calculateHealthMetrics(benchmarkData);
  }, [selectedYear, selectedMonth, analysisAllReports, showBenchmark, selectedStore, cleanStoreName, isBrandMatch, brandId, calculateHealthMetrics, formalEligibleStoreSet]);


  const radarData = useMemo(() => {
    if (!storeMetrics?.health) return [];
    const s = storeMetrics.health.scores;
    const b = benchmarkMetrics?.scores || {};
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
      ? `${userRole === 'manager' ? '我的管理範圍' : `${selectedManager}區`} 體質診斷`
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
                      <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">正式淨現金相對於正式權責業績的比例，檢視業績轉成實際現金回收的程度。</p>
                  </div>
                  <div>
                      <p className="font-bold text-blue-500">2. {cfg.sales.label} (銷售結構)</p>
                      <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">扣除保養品退費後的淨產品業績，占正式淨現金的比例；負值代表產品退費高於產品銷售。</p>
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
    if (!isManagementRole || !rawData || currentDetailFormalAuthority?.compatible !== true) return null;
    const safeManagers = managers || {};

    let targetRawStores = [];
    if (userRole === 'manager' && currentUser) {
      targetRawStores = accessibleStores || [];
    } else if (userRole === 'director' || userRole === 'trainer') {
      targetRawStores = targetBrandManagers.flatMap((mgr) => safeManagers[mgr] || []);
    }

    const targetStores = targetRawStores
      .map((store) => ({ id: String(store || ""), core: cleanStoreName(store) }))
      .filter((row) => row.core && formalEligibleStoreSet.has(row.core));
    if (!targetStores.length) return {
      financialRisks: [], retentionRisks: [], salesRisks: [],
      evaluation: {
        financial: { ready: false, reason: "資料不足" },
        retention: { ready: false, reason: "資料不足" },
        sales: { ready: false, reason: "資料不足" },
      },
    };

    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;
    const rowsByStore = new Map(targetStores.map((row) => [row.core, []]));

    rawData.forEach((row) => {
      if (!row?.date || !row?.storeName || !isBrandMatch(row.storeName, brandId)) return;
      const parts = String(row.date).replace(/-/g, "/").split("/");
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      if (!((y === targetYear || y === rocYear) && m === monthInt)) return;
      const core = cleanStoreName(row.storeName);
      if (rowsByStore.has(core)) rowsByStore.get(core).push(row);
    });

    const reportCards = targetStores.map((store) => {
      const rows = rowsByStore.get(store.core) || [];
      if (!rows.length) return null;
      let managerName = "未分配";
      Object.entries(safeManagers).some(([manager, list]) => {
        if ((list || []).some((name) => cleanStoreName(name) === store.core)) {
          managerName = manager;
          return true;
        }
        return false;
      });
      const health = calculateHealthMetrics(rows);
      return {
        id: store.id,
        name: `${store.core}店`,
        manager: managerName,
        health,
        cash: health.inputs.formalNetCash.value,
        traffic: health.inputs.traffic.value,
        newCust: health.inputs.newCustomers.value,
        cashToAccrual: health.raw.cashToAccrual,
        retentionRate: health.raw.retention,
        newCustomerASP: health.raw.newCustomerASP,
        acquisitionRate: health.raw.acquisitionQuality,
      };
    }).filter(Boolean);

    const financialSample = reportCards.filter((store) => Number(store.cash) > 0 && typeof store.cashToAccrual === "number" && Number.isFinite(store.cashToAccrual));
    const retentionSample = reportCards.filter((store) => Number(store.traffic) > 10 && typeof store.retentionRate === "number" && Number.isFinite(store.retentionRate));
    const salesSample = reportCards.filter((store) => Number(store.newCust) > 0 && typeof store.acquisitionRate === "number" && Number.isFinite(store.acquisitionRate));

    const getEvaluation = (benchmark, sample) => {
      if (benchmark?.valid !== true) {
        return {
          ready: false,
          reason: benchmark?.status === KPI_VALUE_STATUS.DATA_INVALID ? "標準設定無效" : "標準未設定",
        };
      }
      if (!sample.length) return { ready: false, reason: "資料不足" };
      return { ready: true, reason: "" };
    };

    const evaluation = {
      financial: getEvaluation(currentBenchmarks.financial, financialSample),
      retention: getEvaluation(currentBenchmarks.loyalty, retentionSample),
      sales: getEvaluation(currentBenchmarks.acquisition, salesSample),
    };

    const financialRisks = evaluation.financial.ready
      ? financialSample.filter((store) => isHealthMetricBelowBenchmark(store.cashToAccrual, currentBenchmarks.financial))
          .sort((a, b) => a.cashToAccrual - b.cashToAccrual)
      : [];

    const retentionRisks = evaluation.retention.ready
      ? retentionSample.filter((store) => isHealthMetricBelowBenchmark(store.retentionRate, currentBenchmarks.loyalty, -0.1))
          .sort((a, b) => a.retentionRate - b.retentionRate)
      : [];

    const salesRisks = evaluation.sales.ready
      ? salesSample.filter((store) => isHealthMetricBelowBenchmark(store.acquisitionRate, currentBenchmarks.acquisition))
          .sort((a, b) => a.acquisitionRate - b.acquisitionRate)
      : [];

    return { financialRisks, retentionRisks, salesRisks, evaluation };
  }, [
    rawData, userRole, currentUser, managers, isManagementRole, targetBrandManagers,
    selectedYear, selectedMonth, cleanStoreName, brandId, accessibleStores,
    currentDetailFormalAuthority?.compatible, formalEligibleStoreSet, isBrandMatch,
    calculateHealthMetrics, currentBenchmarks, isHealthMetricBelowBenchmark,
  ]);

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
                {type === 'currency' ? fmtMoney(value) : formatHealthPercentOrNA(value, 0)}
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
      const num = Number(val);
      return Number.isFinite(num) && num > 0 ? `${(num * 100).toFixed(0)}%` : "未設定";
  };
  
  const showToggle = selectedStore || (isManagementRole && isManagerView);

  return (
    <ViewWrapper>
      <div className="space-y-6">
        <Card title="門市體質診斷">
          {delegatedStores.length > 0 && (
            <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-sky-700">
              <span className="font-black">代理管理已生效：</span>下方店家選單已包含 {delegatedStores.length} 間受託店家，區域名稱仍維持正式組織歸屬。
            </div>
          )}
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
                            <RechartsTooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} formatter={(val) => formatScoreOrNA(val)}/>
                        </RadarChart>
                    </ResponsiveContainer>
                  </div>
               </div>

               <div className="w-full xl:w-2/3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
                  <div className="bg-white p-5 rounded-2xl border shadow-sm flex flex-col justify-between">
                    <div><p className="text-stone-400 text-xs font-bold mb-1">彙整現金業績</p><h3 className="text-2xl font-bold text-stone-700">{formatMoneyOrNA(activeManagementMetrics.totalCash)}</h3></div>
                    <p className={`text-sm font-bold mt-2 ${getAchievementTone(activeManagementMetrics.achievement)}`}>{formatAchievementOrNA(activeManagementMetrics.achievement)}</p>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">彙整消耗客單</p>
                    <h3 className="text-2xl font-bold text-stone-700">{fmtMoney(activeManagementMetrics.trafficASP)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">彙整目標</p>
                    <h3 className="text-2xl font-bold text-stone-700">{formatMoneyOrNA(activeManagementMetrics.budget)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">平均新客客單</p>
                    <h3 className="text-2xl font-bold text-stone-700">{formatMoneyOrNA(activeManagementMetrics.newCustomerASP)}</h3>
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
                    <h3 className={`text-xl font-bold font-mono ${isHealthMetricBelowBenchmark(activeManagementMetrics.health.raw.cashToAccrual, cfg.financial) ? 'text-rose-500' : 'text-stone-700'}`}>
                        {formatHealthPercentOrNA(activeManagementMetrics.health.raw.cashToAccrual, 0)}
                    </h3>
                  </div>
                  <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100">
                    <p className="text-stone-400 text-xs font-bold mb-1">{cfg.sales.label} (銷售)</p>
                    <h3 className={`text-xl font-bold font-mono ${isHealthMetricBelowBenchmark(activeManagementMetrics.health.raw.retailRatio, cfg.sales) ? 'text-rose-500' : 'text-stone-700'}`}>
                        {formatHealthPercentOrNA(activeManagementMetrics.health.raw.retailRatio, 1)}
                    </h3>
                  </div>
                  <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100">
                    <p className="text-stone-400 text-xs font-bold mb-1">{cfg.loyalty.label} (黏著)</p>
                    <h3 className="text-xl font-bold font-mono text-stone-700">
                        {formatHealthPercentOrNA(activeManagementMetrics.health.raw.retention, 1)}
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
                        {userRole === 'manager' ? '我的管理範圍' : brandPrefix} 體質異常監控 (本月)
                    </h3>
                    <span className="text-xs bg-stone-100 text-stone-400 px-2 py-1 rounded-lg">
                        套用標準：{brandPrefix} (及格線 {formatThreshold(cfg.financial.min)})
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
                                    <p className="text-sm font-bold">{exceptionLists.evaluation?.financial?.ready ? "財務體質全數健康" : (exceptionLists.evaluation?.financial?.reason || "資料不足")}</p>
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
                                    <p className="text-sm font-bold">{exceptionLists.evaluation?.retention?.ready ? "顧客黏著度良好" : (exceptionLists.evaluation?.retention?.reason || "資料不足")}</p>
                                </div>
                            )}
                        </div>
                        <div className="p-3 bg-stone-50 text-xs text-stone-400 text-center border-t border-stone-100">
                            篩選標準：{cfg.loyalty.label} &lt; {cfg.loyalty.valid ? formatThreshold(cfg.loyalty.min - 0.1) : "未設定"}
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
                                    <p className="text-sm font-bold">{exceptionLists.evaluation?.sales?.ready ? "新客開發表現優異" : (exceptionLists.evaluation?.sales?.reason || "資料不足")}</p>
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
                        {(() => {
                          const diagnosis = getHealthDiagnosis(storeMetrics.health);
                          return (
                            <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                              diagnosis.tone === "risk"
                                ? "bg-rose-50 text-rose-600 border-rose-100"
                                : diagnosis.tone === "healthy"
                                  ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                  : "bg-stone-50 text-stone-500 border-stone-200"
                            }`}>
                              診斷：{diagnosis.text}
                            </span>
                          );
                        })()}
                        
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
                            <RechartsTooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} formatter={(val) => formatScoreOrNA(val)}/>
                        </RadarChart>
                    </ResponsiveContainer>
                  </div>
               </div>

               <div className="w-full xl:w-2/3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
                  <div className="bg-white p-5 rounded-2xl border shadow-sm flex flex-col justify-between">
                    <div><p className="text-stone-400 text-xs font-bold mb-1">現金業績</p><h3 className="text-2xl font-bold text-stone-700">{formatMoneyOrNA(storeMetrics.totalCash)}</h3></div>
                    <p className={`text-sm font-bold mt-2 ${getAchievementTone(storeMetrics.achievement)}`}>{formatAchievementOrNA(storeMetrics.achievement)}</p>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">平均消耗客單</p>
                    <h3 className="text-2xl font-bold text-stone-700">{fmtMoney(storeMetrics.trafficASP)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">本月目標</p>
                    <h3 className="text-2xl font-bold text-stone-700">{formatMoneyOrNA(storeMetrics.budget)}</h3>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border shadow-sm">
                    <p className="text-stone-400 text-xs font-bold mb-1">新客平均客單</p>
                    <h3 className="text-2xl font-bold text-stone-700">{formatMoneyOrNA(storeMetrics.newCustomerASP)}</h3>
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
                    <h3 className={`text-xl font-bold font-mono ${isHealthMetricBelowBenchmark(storeMetrics.health.raw.cashToAccrual, cfg.financial) ? 'text-rose-500' : 'text-stone-700'}`}>
                        {formatHealthPercentOrNA(storeMetrics.health.raw.cashToAccrual, 0)}
                    </h3>
                  </div>
                  <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100">
                    <p className="text-stone-400 text-xs font-bold mb-1">{cfg.sales.label} (銷售)</p>
                    <h3 className={`text-xl font-bold font-mono ${isHealthMetricBelowBenchmark(storeMetrics.health.raw.retailRatio, cfg.sales) ? 'text-rose-500' : 'text-stone-700'}`}>
                        {formatHealthPercentOrNA(storeMetrics.health.raw.retailRatio, 1)}
                    </h3>
                  </div>
                  <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100">
                    <p className="text-stone-400 text-xs font-bold mb-1">{cfg.loyalty.label} (黏著)</p>
                    <h3 className="text-xl font-bold font-mono text-stone-700">
                        {formatHealthPercentOrNA(storeMetrics.health.raw.retention, 1)}
                    </h3>
                  </div>
               </div>
            </div>

            <Card
              title={`${selectedStore} 營運趨勢`}
              subtitle={`長條：現金業績｜實線：權責業績${brandPrefix === '安妞' ? '(不含產品)' : ''}｜虛線(右軸)：操作人數`}
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
