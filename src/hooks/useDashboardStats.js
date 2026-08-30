// src/hooks/useDashboardStats.js
import { useState, useMemo, useContext, useEffect } from 'react';
import { AppContext } from '../AppContext';
import { sortManagerNames, sortStoreNames, sortManagersByOrgOrder, sortStoresByOrgOrder } from "../utils/helpers";
// ★ 新增了 collection 與 getDocs，讓我們一次把全公司的專屬小抄都抓下來
import { doc, getDoc, collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { KPI_VALUE_STATUS, formalNetCash } from '../utils/kpiContracts.js';
import {
  buildCurrentDetailFormalAuthority,
  buildCurrentDetailFormalScope,
} from '../utils/currentDetailFormalConsumer.js';
import { buildHistoricalFormalDashboardScope, isFormalDashboardSummaryCompatible } from '../utils/dashboardFormalConsumer.js';
import { getSummaryRecalcFlagState, resolveHistoricalDashboardReadPolicy } from '../utils/dashboardReadPolicy.js';

const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const isFiniteKpiNumber = (value) => typeof value === "number" && Number.isFinite(value);
const getFormalNetCashValue = (row = {}) => {
  const result = formalNetCash(row?.cash, row?.refund, row?.skincareRefund);
  return [KPI_VALUE_STATUS.VALID, KPI_VALUE_STATUS.VALID_ZERO].includes(result.status)
    ? result.value
    : null;
};

// 門市排名後段採動態比例，避免小型品牌「全部門市都落在後五名」的失真。
// 2～5 間：最後 1 名；6～9 間：最後 2 名；10 間以上：最後 20%。
const getBottomRankingSegmentSize = (totalStores = 0) => {
  const total = Math.max(0, Number(totalStores || 0));
  if (total <= 1) return 0;
  if (total <= 5) return 1;
  if (total <= 9) return 2;
  return Math.max(2, Math.ceil(total * 0.2));
};

const isInBottomRankingSegment = (rank = 0, totalStores = 0) => {
  const total = Math.max(0, Number(totalStores || 0));
  const normalizedRank = Math.max(0, Number(rank || 0));
  const segmentSize = getBottomRankingSegmentSize(total);
  return segmentSize > 0 && normalizedRank > total - segmentSize;
};

const getProjectionBlendProfile = (daysPassed = 0, daysInMonth = 0) => {
  if (!daysPassed || !daysInMonth) {
    return { currentWeight: 0.5, historyWeight: 0.5, label: "資料不足" };
  }

  const progress = daysPassed / daysInMonth;

  if (daysPassed <= 5 || progress <= 0.18) {
    return { currentWeight: 0.3, historyWeight: 0.7, label: "月初：偏歷史節奏" };
  }

  if (progress <= 0.5) {
    return { currentWeight: 0.5, historyWeight: 0.5, label: "月中：本月與歷史均衡" };
  }

  if (progress <= 0.8) {
    return { currentWeight: 0.7, historyWeight: 0.3, label: "月中後：偏本月實際" };
  }

  return { currentWeight: 0.85, historyWeight: 0.15, label: "月底：高度依本月實際" };
};

const blendByWeights = (currentValue, historyValue, currentWeight, historyWeight) => {
  const current = safeNumber(currentValue);
  const history = safeNumber(historyValue);
  return (current * currentWeight) + (history * historyWeight);
};

const hasPositiveCurveValue = (averages = {}) => (
  Object.values(averages || {}).some((value) => safeNumber(value) > 0)
);

// 推估小抄若某個星期值是 0，可能代表「店休日」，也可能代表小抄建立失敗。
// 目前沒有完整店休日設定，所以採保守防呆：
// 1. 有正數歷史值 → 使用歷史值。
// 2. 星期日為 0 且該小抄其他星期有正數 → 保留 0，避免固定週日店休被高估。
// 3. 其他 0 / 空值 / 非數字 → 回退本月目前日均，避免月底推估被拉成「到月底都沒業績」。
const getUsableHistoryAverage = (averages = {}, dow, fallbackValue = 0) => {
  const history = safeNumber(averages?.[dow]);
  const fallback = safeNumber(fallbackValue);
  const hasAnyPositiveHistory = hasPositiveCurveValue(averages);

  if (history > 0) return history;
  if (history === 0 && Number(dow) === 0 && hasAnyPositiveHistory) return 0;
  return fallback > 0 ? fallback : 0;
};

const buildProjectionRangePayload = ({ currentTotal = 0, remainingConservative = 0, remainingStandard = 0, remainingAggressive = 0 }) => {
  const rawConservative = Math.round(safeNumber(currentTotal) + safeNumber(remainingConservative));
  const standard = Math.round(safeNumber(currentTotal) + safeNumber(remainingStandard));
  const rawAggressive = Math.round(safeNumber(currentTotal) + safeNumber(remainingAggressive));

  // 保守 / 標準 / 積極是給主管看的「判讀區間」，必須維持語意順序。
  // 這版把保守改成較低節奏、積極改成較高節奏；若遇到極端資料，仍用下緣 / 上緣保護顯示。
  const conservative = Math.min(rawConservative, standard, rawAggressive);
  const aggressive = Math.max(rawConservative, standard, rawAggressive);

  return {
    conservative,
    standard,
    aggressive,
    min: conservative,
    max: aggressive,
    rawConservative,
    rawAggressive,
  };
};



export function useDashboardStats() {
  const { 
    targets, userRole, currentUser, 
    allReports, monthlyTargetSummary, currentLifecycleMasterState, managers, managerOrder = [], selectedYear, selectedMonth, therapistReports,
    currentBrand, therapists, dailyLoginCount, yesterdayLoginCount,
    therapistAnnualAggregatedData, getCollectionPath, historicalDetailRefreshState,
    currentDashboardSummary, currentRankingsSummary, currentReportSummaryReady,
    currentReportSummaryReadyYearMonth, currentReportSummaryReadyBrandId, currentSummaryRecalcFlagState,
    therapistModuleEnabled,
    accessibleStores = [], officialStores = [], delegatedStores = [], delegationAccess = {},
    getActiveDelegationForStore
  } = useContext(AppContext);

  const isTherapistModuleEnabled = therapistModuleEnabled !== false;
  const [viewMode, setViewMode] = useState((isTherapistModuleEnabled && (userRole === 'therapist' || userRole === 'trainer')) ? 'therapist' : 'store');
  const [selectedDashboardManager, setSelectedDashboardManager] = useState("");
  const [selectedDashboardStore, setSelectedDashboardStore] = useState("");

  useEffect(() => {
    if (!isTherapistModuleEnabled && viewMode === 'therapist') {
      setViewMode('store');
    }
  }, [isTherapistModuleEnabled, viewMode]);

  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent("cyj_dashboard_view_mode_changed", { detail: { viewMode } }));
    } catch (error) {
      // 不影響 Dashboard 運算；此事件只用來讓 App 分流管理師日報監聽。
    }
  }, [viewMode]);

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

  // Batch 5A-2：Dashboard 歷史月份的 raw target fallback 必須與 App 的
  // Summary trust authority 使用同一套 policy，避免 verified Formal Summary 又回頭讀 raw monthly_targets。
  const dashboardTargetReadPolicy = useMemo(() => {
    const y = Number(selectedYear);
    const m = Number(selectedMonth);
    const targetYearMonth = y && m ? `${y}-${String(m).padStart(2, "0")}` : "";
    const now = new Date();
    const isCurrentMonth = y === now.getFullYear() && m === now.getMonth() + 1;
    const summaryYearMonth = String(currentDashboardSummary?.yearMonth || currentDashboardSummary?.id || "");
    const rankingsYearMonth = String(currentRankingsSummary?.yearMonth || currentRankingsSummary?.id || "");
    const hasUsableDashboardSummary = Boolean(
      targetYearMonth &&
      summaryYearMonth === targetYearMonth &&
      currentDashboardSummary?.stores &&
      Object.keys(currentDashboardSummary.stores || {}).length > 0 &&
      rankingsYearMonth === targetYearMonth &&
      currentRankingsSummary
    );
    const reportSummaryReadyForMonth = Boolean(
      targetYearMonth &&
      currentReportSummaryReady === true &&
      currentReportSummaryReadyYearMonth === targetYearMonth &&
      currentReportSummaryReadyBrandId === brandInfo?.id
    );
    const summaryFlagReadyForMonth = Boolean(
      targetYearMonth &&
      currentSummaryRecalcFlagState?.brandId === brandInfo?.id &&
      currentSummaryRecalcFlagState?.yearMonth === targetYearMonth &&
      currentSummaryRecalcFlagState?.ready === true
    );
    const historicalRefreshRequested = Boolean(
      targetYearMonth &&
      historicalDetailRefreshState?.yearMonth === targetYearMonth &&
      ["requested", "loading"].includes(historicalDetailRefreshState?.status)
    );

    return resolveHistoricalDashboardReadPolicy({
      isCurrentMonth,
      historicalRefreshRequested,
      reportSummaryReady: reportSummaryReadyForMonth,
      hasUsableDashboardSummary,
      summaryFlagReady: summaryFlagReadyForMonth,
      summaryFlag: currentSummaryRecalcFlagState?.data || null,
      summaryFlagError: currentSummaryRecalcFlagState?.error || null,
    });
  }, [
    selectedYear,
    selectedMonth,
    currentDashboardSummary,
    currentRankingsSummary,
    currentReportSummaryReady,
    currentReportSummaryReadyYearMonth,
    currentReportSummaryReadyBrandId,
    currentSummaryRecalcFlagState,
    historicalDetailRefreshState,
    brandInfo?.id,
  ]);

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
              const normalizeCurveKey = (value = "") => {
                const raw = String(value || "").trim();
                if (!raw) return "";
                if (raw === "BRAND_TOTAL") return "BRAND_TOTAL";
                return raw
                  .replace(new RegExp(`^(${brandPrefix}|CYJ|Anew|Yibo|安妞|伊啵)\\s*`, 'i'), '')
                  .replace(/店$/, '')
                  .replace(/\s+/g, '')
                  .toLowerCase();
              };

              snap.forEach((curveDoc) => {
                  // ★ 改為存取「整包資料」，才能拿到獨立的現金與權責小抄。
                  // 同時建立多組 key，避免 Firestore 文件 ID 是「安妞信義店」，
                  // 但 Dashboard 明細推估用 cleanName 後的「信義」去找，最後誤吃 BRAND_TOTAL。
                  const data = curveDoc.data();
                  const rawId = String(curveDoc.id || "").trim();
                  const compactId = rawId.replace(/\s+/g, '').toLowerCase();
                  const coreId = normalizeCurveKey(rawId);
                  const candidateKeys = [rawId, compactId, coreId];

                  if (coreId && coreId !== "BRAND_TOTAL") {
                    candidateKeys.push(`${coreId}店`);
                    candidateKeys.push(`${brandPrefix}${coreId}店`);
                    candidateKeys.push(`${brandInfo.name || brandPrefix}${coreId}店`);
                  }

                  Array.from(new Set(candidateKeys.filter(Boolean))).forEach((key) => {
                    dataDict[key] = data;
                  });
              });
              setAllStoreCurves(dataDict);
          } catch (e) {
              console.error("讀取金額小抄失敗:", e);
          }
      };
      fetchAllCurves();
  }, [brandInfo, brandPrefix]);


  const [annualKpiBenchmark, setAnnualKpiBenchmark] = useState({
    ready: false,
    source: "idle",
    trafficMonthlyAverage: 0,
    newCustomerMonthlyAverage: 0,
    basedMonthCount: 0,
    basedMonths: [],
    stores: {},
    storeCount: 0,
    updatedAtText: "",
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const loadAnnualKpiBenchmark = async () => {
      const year = String(selectedYear || "").trim();
      const brandId = String(brandInfo?.id || "").trim() || "cyj";

      if (!getCollectionPath || !year) {
        setAnnualKpiBenchmark({
          ready: true,
          source: "not_available",
          trafficMonthlyAverage: 0,
          newCustomerMonthlyAverage: 0,
          basedMonthCount: 0,
          basedMonths: [],
          stores: {},
          storeCount: 0,
          updatedAtText: "",
          error: null,
        });
        return;
      }

      const cacheKey = `cyj_annual_kpi_summary_v5_${brandId}_${year}`;
      const cacheTtlMs = 60 * 60 * 1000;

      try {
        if (typeof sessionStorage !== "undefined") {
          const cachedRaw = sessionStorage.getItem(cacheKey);
          if (cachedRaw) {
            const cached = JSON.parse(cachedRaw);
            if (cached?.cachedAt && Date.now() - Number(cached.cachedAt) < cacheTtlMs) {
              setAnnualKpiBenchmark({
                ready: true,
                source: "session_cache",
                trafficMonthlyAverage: safeNumber(cached.trafficMonthlyAverage),
                newCustomerMonthlyAverage: safeNumber(cached.newCustomerMonthlyAverage),
                basedMonthCount: safeNumber(cached.basedMonthCount),
                basedMonths: Array.isArray(cached.basedMonths) ? cached.basedMonths : [],
                stores: cached.stores && typeof cached.stores === "object" ? cached.stores : {},
                storeCount: safeNumber(cached.storeCount || Object.keys(cached.stores || {}).length),
                basis: cached.basis || "",
                annualAverageSettings:
                  cached.annualAverageSettings && typeof cached.annualAverageSettings === "object"
                    ? cached.annualAverageSettings
                    : {},
                updatedAtText: cached.updatedAtText || "",
                error: null,
              });
              return;
            }
          }
        }
      } catch (error) {
        // 快取失敗不影響 Dashboard，改讀 Firestore 單一年度摘要 doc。
      }

      setAnnualKpiBenchmark(prev => ({
        ...prev,
        ready: false,
        source: "loading",
        error: null,
      }));

      try {
        const summaryRef = doc(getCollectionPath("annual_kpi_summary"), year);
        const snap = await getDoc(summaryRef);
        if (cancelled) return;

        if (!snap.exists()) {
          const emptyPayload = {
            ready: true,
            source: "missing",
            trafficMonthlyAverage: 0,
            newCustomerMonthlyAverage: 0,
            basedMonthCount: 0,
            basedMonths: [],
            stores: {},
            storeCount: 0,
            updatedAtText: "",
            error: null,
          };
          setAnnualKpiBenchmark(emptyPayload);
          return;
        }

        const data = snap.data() || {};
        const storeData = data.stores && typeof data.stores === "object" ? data.stores : {};
        const payload = {
          ready: true,
          source: "annual_kpi_summary",
          trafficMonthlyAverage: safeNumber(data.trafficMonthlyAverage),
          newCustomerMonthlyAverage: safeNumber(data.newCustomerMonthlyAverage),
          basedMonthCount: safeNumber(data.basedMonthCount || (Array.isArray(data.basedMonths) ? data.basedMonths.length : 0)),
          basedMonths: Array.isArray(data.basedMonths) ? data.basedMonths : [],
          stores: storeData,
          storeCount: safeNumber(data.storeCount || Object.keys(storeData).length),
          basis: data.basis || "",
          annualAverageSettings:
            data.annualAverageSettings && typeof data.annualAverageSettings === "object"
              ? data.annualAverageSettings
              : {},
          updatedAtText: data.updatedAtText || "",
          error: null,
        };

        setAnnualKpiBenchmark(payload);

        try {
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem(cacheKey, JSON.stringify({ ...payload, cachedAt: Date.now() }));
          }
        } catch (error) {
          // 快取失敗不影響顯示。
        }
      } catch (error) {
        console.warn("讀取年度 KPI 摘要失敗：", error);
        if (cancelled) return;
        setAnnualKpiBenchmark({
          ready: true,
          source: "error",
          trafficMonthlyAverage: 0,
          newCustomerMonthlyAverage: 0,
          basedMonthCount: 0,
          basedMonths: [],
          stores: {},
          storeCount: 0,
          updatedAtText: "",
          error: error?.message || String(error),
        });
      }
    };

    loadAnnualKpiBenchmark();
    return () => { cancelled = true; };
  }, [getCollectionPath, brandInfo?.id, selectedYear]);

  const cleanName = useMemo(() => (name) => {
    if (!name) return "";

    // v3.3.7：年度 KPI 單店/區長年均需要與 annual_kpi_summary.stores 的 key 對齊。
    // 舊寫法只會移除第一段品牌前綴，例如「Anew安妞中正店」只移除 Anew，留下「安妞中正」，
    // 造成 Firestore stores 裡的「中正」對不到前端選單的店名。
    const prefixes = Array.from(new Set([
      brandPrefix,
      brandInfo?.name,
      "Anew安妞",
      "Yibo伊啵",
      "DRCYJ",
      "CYJ",
      "Anew",
      "Yibo",
      "安妞",
      "伊啵",
    ].filter(Boolean))).sort((a, b) => String(b).length - String(a).length);

    let core = String(name || "")
      .replace(/[　\s]+/g, "")
      .replace(/[（）()]/g, "")
      .replace(/臺/g, "台")
      .trim();

    // 連續移除品牌前綴，兼容「Anew安妞中正店 / Yibo伊啵古亭店 / CYJ新店店」。
    let changed = true;
    while (changed) {
      changed = false;
      for (const prefix of prefixes) {
        const text = String(prefix || "").replace(/[　\s]+/g, "");
        if (text && core.toLowerCase().startsWith(text.toLowerCase())) {
          core = core.slice(text.length);
          changed = true;
          break;
        }
      }
    }

    // ★「新店」是正式店名，不是「新 + 店」；同時相容舊錯誤資料「新」、新店、新店店、CYJ新店店。
    if (core === "新" || /^新店店?$/.test(core)) return "新店";

    return core.replace(/店+$/g, '').trim();
  }, [brandPrefix, brandInfo?.name]);

  const getProjectionCurveForStore = useMemo(() => (storeName = "") => {
    const core = cleanName(storeName);
    const raw = String(storeName || "").trim();
    const compact = (value = "") => String(value || "").replace(/\s+/g, "").toLowerCase();

    const candidateKeys = [
      raw,
      compact(raw),
      core,
      compact(core),
      core ? `${core}店` : "",
      core ? compact(`${core}店`) : "",
      core ? `${brandPrefix}${core}店` : "",
      core ? compact(`${brandPrefix}${core}店`) : "",
      core ? `${brandInfo?.name || brandPrefix}${core}店` : "",
      core ? compact(`${brandInfo?.name || brandPrefix}${core}店`) : "",
    ];

    for (const key of Array.from(new Set(candidateKeys.filter(Boolean)))) {
      if (allStoreCurves[key]) return allStoreCurves[key];
    }

    return allStoreCurves["BRAND_TOTAL"] || allStoreCurves["brand_total"] || {};
  }, [allStoreCurves, cleanName, brandPrefix, brandInfo]);

  const getSummaryStoreName = useMemo(() => (store = {}) => (
    store.__canonicalStoreName ||
    store.__summaryKey ||
    store.store ||
    store.storeName ||
    store.displayName ||
    store.name ||
    store.id ||
    ""
  ), []);

  const normalizeSummaryStores = useMemo(() => (storesMap = {}) => {
    if (Array.isArray(storesMap)) {
      return storesMap.map((store, index) => {
        const source = store && typeof store === "object" ? store : {};
        const fallbackRaw = source.store || source.storeName || source.displayName || source.name || source.id || `store_${index}`;
        const fallbackCore = cleanName(fallbackRaw);
        const canonicalStoreName = fallbackCore ? `${fallbackCore}店` : fallbackRaw;
        return {
          ...source,
          __summaryKey: source.__summaryKey || source.id || `store_${index}`,
          __canonicalStoreName: source.__canonicalStoreName || canonicalStoreName,
          store: source.store || canonicalStoreName,
          displayName: source.displayName || source.storeName || source.store || source.name || canonicalStoreName,
        };
      });
    }

    return Object.entries(storesMap || {}).map(([key, value]) => {
      const source = value && typeof value === "object" ? value : {};
      // ★ 關鍵：Summary stores 若是 map，key 通常比 value.store 更可靠。
      // 舊資料可能把「新店」誤寫成 store: "新"，但 key 仍是「新店 / CYJ新店店」。
      const keyCore = cleanName(key);
      const fieldCore = cleanName(source.store || source.storeName || source.displayName || source.name || source.id || "");
      const canonicalCore = keyCore || fieldCore;
      const canonicalStoreName = canonicalCore ? `${canonicalCore}店` : (key || source.store || source.displayName || "");

      return {
        ...source,
        __summaryKey: key,
        __canonicalStoreName: canonicalStoreName,
        store: source.store || canonicalStoreName,
        displayName: source.displayName || source.storeName || source.store || source.name || canonicalStoreName,
      };
    });
  }, [cleanName]);

  const getSummaryStoreCandidates = useMemo(() => (store = {}) => {
    const rawValues = [
      store.__canonicalStoreName,
      store.__summaryKey,
      store.store,
      store.storeName,
      store.displayName,
      store.name,
      store.id,
    ];

    return Array.from(new Set(rawValues.map(cleanName).filter(Boolean)));
  }, [cleanName]);

  const summaryStoreMatchesSet = useMemo(() => (store = {}, targetSet = new Set()) => {
    if (!targetSet || targetSet.size === 0) return false;
    return getSummaryStoreCandidates(store).some((candidate) => targetSet.has(candidate));
  }, [getSummaryStoreCandidates]);

  // ============================================================================
  // ★ 期間式代理與托管：營運總覽可視範圍
  // 正式組織仍由 managers / org_structure 決定；這裡只把具備 viewOperations
  // 權限的暫時托管店家加入目前登入者的營運查看範圍。
  // ============================================================================
  const viewableDelegatedStores = useMemo(() => (
    (delegatedStores || []).filter((storeName) => {
      const core = cleanName(storeName);
      return delegationAccess?.storePermissions?.[core]?.viewOperations === true;
    })
  ), [delegatedStores, delegationAccess, cleanName]);

  const operationAccessibleStores = useMemo(() => (
    [...new Set(
      [...(officialStores || []), ...viewableDelegatedStores]
        .map(cleanName)
        .filter(Boolean)
    )]
  ), [officialStores, viewableDelegatedStores, cleanName]);

  const hasDelegationAccessProfile = Boolean(
    delegationAccess &&
    (
      delegationAccess.role ||
      Array.isArray(delegationAccess.officialStores) ||
      Array.isArray(delegationAccess.delegatedStores) ||
      delegationAccess.storePermissions
    )
  );

  const baseVisibleStores = useMemo(() => {
    if (userRole === 'director' || userRole === 'trainer' || userRole === 'therapist' || userRole === 'master') {
      return [...new Set(Object.values(managers || {}).flat().map(cleanName).filter(Boolean))];
    }

    if ((userRole === 'manager' || userRole === 'store') && currentUser) {
      const delegatedAwareStores = (
        hasDelegationAccessProfile
          ? operationAccessibleStores
          : (accessibleStores || [])
      ).map(cleanName).filter(Boolean);

      if (delegatedAwareStores.length > 0) {
        return [...new Set(delegatedAwareStores)];
      }

      // 代理資料尚未完成載入時，保留原正式權限，避免畫面短暫變成 0。
      if (userRole === 'manager') {
        return [...new Set((managers[currentUser.name] || []).map(cleanName).filter(Boolean))];
      }

      const rawStores = currentUser.stores || [currentUser.storeName];
      return [...new Set((rawStores || []).map(cleanName).filter(Boolean))];
    }

    return [];
  }, [
    userRole,
    currentUser,
    managers,
    accessibleStores,
    operationAccessibleStores,
    hasDelegationAccessProfile,
    cleanName,
  ]);

  const availableStoresForFilter = useMemo(() => {
    const uniqueStores = [...new Set(baseVisibleStores)];
    return sortStoresByOrgOrder(
      managers,
      uniqueStores.map((storeCore) => `${brandPrefix}${storeCore}店`),
      brandPrefix,
      managerOrder
    );
  }, [baseVisibleStores, brandPrefix, managers, managerOrder]);

  const officialStoreCoreSet = useMemo(
    () => new Set((officialStores || []).map(cleanName).filter(Boolean)),
    [officialStores, cleanName]
  );

  const delegatedStoreCoreSet = useMemo(
    () => new Set(viewableDelegatedStores.map(cleanName).filter(Boolean)),
    [viewableDelegatedStores, cleanName]
  );

  const officialStoresForDropdown = useMemo(
    () => availableStoresForFilter.filter(
      (storeName) => officialStoreCoreSet.has(cleanName(storeName))
    ),
    [availableStoresForFilter, officialStoreCoreSet, cleanName]
  );

  const delegatedStoresForDropdown = useMemo(
    () => availableStoresForFilter.filter(
      (storeName) =>
        delegatedStoreCoreSet.has(cleanName(storeName)) &&
        !officialStoreCoreSet.has(cleanName(storeName))
    ),
    [availableStoresForFilter, delegatedStoreCoreSet, officialStoreCoreSet, cleanName]
  );

  const delegatedStoreDetails = useMemo(() => {
    const details = {};

    delegatedStoresForDropdown.forEach((storeName) => {
      const delegation = typeof getActiveDelegationForStore === 'function'
        ? getActiveDelegationForStore(cleanName(storeName), null, 'viewOperations')
        : null;

      details[storeName] = delegation
        ? {
            id: delegation.id || '',
            principalName: delegation.principalName || '',
            delegateName: delegation.delegateName || '',
            endDate: delegation.endDate || '',
          }
        : null;
    });

    return details;
  }, [delegatedStoresForDropdown, getActiveDelegationForStore, cleanName]);

  const groupedStoresForFilter = useMemo(() => {
    const groups = {};
    const availableSet = new Set(availableStoresForFilter);

    sortManagersByOrgOrder(managers, null, managerOrder).forEach((mgrName) => {
      const rawStores = managers?.[mgrName] || [];
      const mgrValidStores = [];

      (rawStores || []).forEach((rawStoreName) => {
        const core = cleanName(rawStoreName);
        const fullName = `${brandPrefix}${core}店`;

        if (availableSet.has(fullName) && !mgrValidStores.includes(fullName)) {
          mgrValidStores.push(fullName);
        }
      });

      if (mgrValidStores.length > 0) {
        groups[mgrName] = sortStoresByOrgOrder(
          managers,
          mgrValidStores,
          brandPrefix,
          managerOrder
        );
      }
    });

    const inGroups = new Set(Object.values(groups).flat());
    const orphans = availableStoresForFilter.filter((storeName) => !inGroups.has(storeName));

    if (orphans.length > 0) {
      groups['其他'] = sortStoresByOrgOrder(
        managers,
        orphans,
        brandPrefix,
        managerOrder
      );
    }

    return groups;
  }, [managers, managerOrder, availableStoresForFilter, cleanName, brandPrefix]);

  const availableStoresForDropdown = useMemo(() => {
    // 區長／店經理必須同時看到正式店家與暫時托管店家。
    if ((userRole === 'manager' || userRole === 'store') && currentUser) {
      return availableStoresForFilter;
    }

    if (selectedDashboardManager && groupedStoresForFilter[selectedDashboardManager]) {
      return groupedStoresForFilter[selectedDashboardManager];
    }

    return sortStoresByOrgOrder(
      managers,
      Object.values(groupedStoresForFilter).flat(),
      brandPrefix,
      managerOrder
    );
  }, [
    selectedDashboardManager,
    groupedStoresForFilter,
    userRole,
    currentUser,
    managers,
    brandPrefix,
    managerOrder,
    availableStoresForFilter,
  ]);

  const effectiveStores = useMemo(() => {
    if (selectedDashboardStore) return [cleanName(selectedDashboardStore)];

    if (selectedDashboardManager) {
      return (managers[selectedDashboardManager] || [])
        .map(cleanName)
        .filter(Boolean);
    }

    return baseVisibleStores;
  }, [
    baseVisibleStores,
    selectedDashboardStore,
    selectedDashboardManager,
    managers,
    cleanName,
  ]);

  const allCompanyStores = useMemo(() => {
    const stores = new Set();

    Object.values(managers || {}).flat().forEach((storeName) => {
      const core = cleanName(storeName);
      if (core) stores.add(core);
    });

    if (allReports) {
      allReports.forEach((report) => {
        if (report.storeName) stores.add(cleanName(report.storeName));
      });
    }

    return Array.from(stores).filter(Boolean);
  }, [allReports, managers, cleanName]);

  const therapistEffectiveStores = useMemo(() => {
    if (selectedDashboardStore) return [cleanName(selectedDashboardStore)];
    if (selectedDashboardManager && managers[selectedDashboardManager]) {
        return managers[selectedDashboardManager].map(cleanName).filter(Boolean);
    }
    return allCompanyStores; 
  }, [selectedDashboardStore, selectedDashboardManager, managers, allCompanyStores, cleanName]);

  const effectiveAnnualKpiBenchmark = useMemo(() => {
    const base = annualKpiBenchmark || {};
    if (!base.ready) return base;

    const shouldUseFilteredBenchmark = Boolean(
      selectedDashboardStore ||
      selectedDashboardManager ||
      userRole === "manager" ||
      userRole === "store"
    );

    if (!shouldUseFilteredBenchmark) {
      return { ...base, scope: "brand", scopeStoreCount: 0 };
    }

    const selectedStoreCores = Array.from(new Set((effectiveStores || []).map(cleanName).filter(Boolean)));
    const storesMap = base.stores && typeof base.stores === "object" ? base.stores : {};

    // 舊年度摘要 doc 只有全品牌平均，沒有 stores 明細。此時不要在單店/區長視角顯示全品牌年均，避免誤導。
    if (selectedStoreCores.length === 0 || Object.keys(storesMap).length === 0) {
      return {
        ...base,
        scope: "filtered_missing_store_data",
        trafficMonthlyAverage: 0,
        newCustomerMonthlyAverage: 0,
        basedMonthCount: 0,
        basedMonths: [],
        scopeStoreCount: selectedStoreCores.length,
      };
    }

    const compact = (value = "") => String(value || "").replace(/\s+/g, "").toLowerCase();
    const storeEntries = Object.entries(storesMap);

    const findStoreSummary = (core = "") => {
      const normalizedCore = cleanName(core);
      const candidates = Array.from(new Set([
        normalizedCore,
        compact(normalizedCore),
        `${normalizedCore}店`,
        compact(`${normalizedCore}店`),
        `${brandPrefix}${normalizedCore}店`,
        compact(`${brandPrefix}${normalizedCore}店`),
        `${brandInfo?.name || brandPrefix}${normalizedCore}店`,
        compact(`${brandInfo?.name || brandPrefix}${normalizedCore}店`),
      ].filter(Boolean)));

      for (const key of candidates) {
        if (storesMap[key]) return storesMap[key];
      }

      return storeEntries.find(([key, value]) => (
        cleanName(key) === normalizedCore ||
        cleanName(value?.storeCore || value?.storeName || value?.store || value?.displayName || value?.name || "") === normalizedCore
      ))?.[1] || null;
    };

    const selectedStoreSummaries = selectedStoreCores
      .map(findStoreSummary)
      .filter(Boolean);

    if (selectedStoreSummaries.length === 0) {
      return {
        ...base,
        scope: "filtered_missing_store_match",
        trafficMonthlyAverage: 0,
        newCustomerMonthlyAverage: 0,
        basedMonthCount: 0,
        basedMonths: [],
        scopeStoreCount: selectedStoreCores.length,
      };
    }

    const monthTotals = {};
    const eligibleMonthSet = new Set();

    selectedStoreSummaries.forEach((storeSummary) => {
      const monthlyValues = storeSummary?.monthlyValues && typeof storeSummary.monthlyValues === "object"
        ? storeSummary.monthlyValues
        : {};

      // basedMonths 是後端完成「首月排除」後的唯一有效月份清單。
      // Firestore 舊版 merge 寫入可能留下已排除月份的 monthlyValues 舊 key，
      // 因此區域／單店不得再把 monthlyValues 的所有月份無條件加回平均。
      const hasDeclaredBasedMonths = Array.isArray(storeSummary?.basedMonths);
      const declaredBasedMonths = hasDeclaredBasedMonths ? storeSummary.basedMonths : [];
      const storeBasedMonths = (hasDeclaredBasedMonths
        ? declaredBasedMonths
        : Object.keys(monthlyValues)
      ).filter((yearMonth) => /^\d{4}-\d{2}$/.test(String(yearMonth || "")));
      const storeBasedMonthSet = new Set(storeBasedMonths);

      storeBasedMonths.forEach((yearMonth) => {
        eligibleMonthSet.add(yearMonth);
        if (!monthTotals[yearMonth]) {
          monthTotals[yearMonth] = { traffic: 0, newCustomers: 0, cash: 0, accrual: 0 };
        }
      });

      Object.entries(monthlyValues).forEach(([yearMonth, metrics]) => {
        if (!storeBasedMonthSet.has(yearMonth)) return;
        if (!monthTotals[yearMonth]) {
          monthTotals[yearMonth] = { traffic: 0, newCustomers: 0, cash: 0, accrual: 0 };
        }
        monthTotals[yearMonth].traffic += safeNumber(metrics?.traffic);
        monthTotals[yearMonth].newCustomers += safeNumber(metrics?.newCustomers);
        monthTotals[yearMonth].cash += safeNumber(metrics?.cash);
        monthTotals[yearMonth].accrual += safeNumber(metrics?.accrual);
      });
    });

    const basedMonths = Array.from(eligibleMonthSet).sort();

    // 若重建後暫時沒有 monthlyValues，單店仍可用該店年度摘要備援，不回退全品牌。
    if (basedMonths.length === 0 && selectedStoreSummaries.length === 1) {
      const onlyStore = selectedStoreSummaries[0];
      return {
        ...base,
        scope: selectedDashboardStore ? "store" : "filtered",
        trafficMonthlyAverage: safeNumber(onlyStore.trafficMonthlyAverage),
        newCustomerMonthlyAverage: safeNumber(onlyStore.newCustomerMonthlyAverage),
        basedMonthCount: safeNumber(onlyStore.basedMonthCount),
        basedMonths: Array.isArray(onlyStore.basedMonths) ? onlyStore.basedMonths : [],
        scopeStoreCount: 1,
      };
    }

    const totals = basedMonths.reduce((acc, yearMonth) => {
      const metrics = monthTotals[yearMonth] || {};
      acc.traffic += safeNumber(metrics.traffic);
      acc.newCustomers += safeNumber(metrics.newCustomers);
      acc.cash += safeNumber(metrics.cash);
      acc.accrual += safeNumber(metrics.accrual);
      return acc;
    }, { traffic: 0, newCustomers: 0, cash: 0, accrual: 0 });

    const basedMonthCount = basedMonths.length;
    return {
      ...base,
      scope: selectedDashboardStore ? "store" : "filtered",
      trafficMonthlyAverage: basedMonthCount > 0 ? Math.round(totals.traffic / basedMonthCount) : 0,
      newCustomerMonthlyAverage: basedMonthCount > 0 ? Math.round(totals.newCustomers / basedMonthCount) : 0,
      basedMonthCount,
      basedMonths,
      scopeStoreCount: selectedStoreSummaries.length,
    };
  }, [annualKpiBenchmark, selectedDashboardStore, selectedDashboardManager, userRole, effectiveStores, cleanName, brandPrefix, brandInfo]);

  // ==========================================
  // ★ Batch 5A-2：Dashboard Summary trust 來源收斂
  // dashboard_summary / rankings_summary / summary_recalc_flags 由 App 單一監聽後傳入；
  // 此 hook 不再重複監聽，也不再依賴 recalc_queue / maintenance_logs 大型 query。
  // therapist_summary 只在人員績效歷史視圖真正需要時才監聽單一文件。
  // ==========================================
  const [therapistSummaryState, setTherapistSummaryState] = useState({
    yearMonth: "",
    data: null,
    ready: true,
    error: null,
  });

  const selectedYearMonth = useMemo(() => {
    const y = String(selectedYear || "");
    const m = String(selectedMonth || "").padStart(2, "0");
    return y && m ? `${y}-${m}` : "";
  }, [selectedYear, selectedMonth]);

  const isSelectedCurrentMonth = useMemo(() => {
    const now = new Date();
    return Number(selectedYear) === now.getFullYear() && Number(selectedMonth) === now.getMonth() + 1;
  }, [selectedYear, selectedMonth]);

  const currentDetailFormalAuthority = useMemo(() => {
    const lifecycleStateBrand = String(currentLifecycleMasterState?.brandId || "").toLowerCase();
    const currentBrandId = String(brandInfo?.id || "").toLowerCase();
    const lifecycleMaster = (
      currentLifecycleMasterState?.ready === true &&
      lifecycleStateBrand === currentBrandId
    ) ? currentLifecycleMasterState?.data : null;

    return buildCurrentDetailFormalAuthority({
      brandId: currentBrandId,
      yearMonth: selectedYearMonth,
      lifecycleMaster,
      monthlyTargetSummary,
      reports: allReports || [],
      normalizeStoreKey: cleanName,
    });
  }, [
    currentLifecycleMasterState,
    brandInfo?.id,
    selectedYearMonth,
    monthlyTargetSummary,
    allReports,
    cleanName,
  ]);

  const currentDetailFormalScope = useMemo(() => buildCurrentDetailFormalScope({
    authority: currentDetailFormalAuthority,
    storeKeys: effectiveStores,
    normalizeStoreKey: cleanName,
  }), [currentDetailFormalAuthority, effectiveStores, cleanName]);

  const getDashboardSummaryTrustMeta = (statusKey) => {
    const map = {
      loading: {
        label: "檢查中",
        tone: "stone",
        hint: "正在確認此月份 Summary 是否可作為 Dashboard 資料來源。",
      },
      missing: {
        label: "尚未建立 Summary",
        tone: "rose",
        hint: "此月份尚未建立完整 Summary，Dashboard 會改用明細資料，避免顯示舊數字。",
      },
      dirty: {
        label: "Summary 需重新整理",
        tone: "amber",
        hint: "此月份有待重算異動，Dashboard 暫時改用明細資料，避免舊 Summary 誤導判斷。",
      },
      current_dirty: {
        label: "本月即時資料",
        tone: "amber",
        hint: "本月仍以即時明細為準，Summary 不作為 Dashboard 主要來源。",
      },
      unverified: {
        label: "Summary 尚未比對",
        tone: "amber",
        hint: "Summary 已建立但尚未完成比對，Dashboard 暫時改用明細資料。",
      },
      mismatch: {
        label: "Summary 比對異常",
        tone: "rose",
        hint: "Summary 與明細重算結果不一致，Dashboard 暫時改用明細資料。",
      },
      verified: {
        label: "Summary 已驗證",
        tone: "emerald",
        hint: "Summary 已建立、無待重算異動，且最近一次比對通過。",
      },
      error: {
        label: "Summary 狀態檢查失敗",
        tone: "rose",
        hint: "無法確認 Summary 可信度，Dashboard 會改用明細資料。",
      },
    };
    return map[statusKey] || map.unverified;
  };

  useEffect(() => {
    if (
      !getCollectionPath ||
      !selectedYearMonth ||
      isSelectedCurrentMonth ||
      !isTherapistModuleEnabled ||
      viewMode !== "therapist"
    ) {
      setTherapistSummaryState({
        yearMonth: selectedYearMonth,
        data: null,
        ready: true,
        error: null,
      });
      return undefined;
    }

    setTherapistSummaryState({
      yearMonth: selectedYearMonth,
      data: null,
      ready: false,
      error: null,
    });

    const unsubscribe = onSnapshot(
      doc(getCollectionPath("therapist_summary"), selectedYearMonth),
      (snap) => {
        setTherapistSummaryState({
          yearMonth: selectedYearMonth,
          data: snap.exists() ? { id: snap.id, ...snap.data() } : null,
          ready: true,
          error: null,
        });
      },
      (error) => {
        console.warn("Dashboard therapist_summary 監聽失敗，將使用管理師明細 fallback：", error);
        setTherapistSummaryState({
          yearMonth: selectedYearMonth,
          data: null,
          ready: true,
          error,
        });
      }
    );

    return () => {
      try { unsubscribe && unsubscribe(); } catch (error) { console.warn("therapist_summary listener cleanup failed", error); }
    };
  }, [getCollectionPath, selectedYearMonth, isSelectedCurrentMonth, isTherapistModuleEnabled, viewMode]);

  const dashboardSummaryBundle = useMemo(() => {
    const dashboardYearMonth = String(currentDashboardSummary?.yearMonth || currentDashboardSummary?.id || "");
    const rankingsYearMonth = String(currentRankingsSummary?.yearMonth || currentRankingsSummary?.id || "");
    const dashboardMatchesMonth = Boolean(currentDashboardSummary) && dashboardYearMonth === selectedYearMonth;
    const rankingsMatchesMonth = Boolean(currentRankingsSummary) && rankingsYearMonth === selectedYearMonth;
    const reportReadyForMonth = Boolean(
      currentReportSummaryReady === true &&
      currentReportSummaryReadyYearMonth === selectedYearMonth &&
      currentReportSummaryReadyBrandId === brandInfo?.id
    );
    const flagReadyForMonth = Boolean(
      currentSummaryRecalcFlagState?.brandId === brandInfo?.id &&
      currentSummaryRecalcFlagState?.yearMonth === selectedYearMonth &&
      currentSummaryRecalcFlagState?.ready === true
    );
    const recalcFlag = flagReadyForMonth ? (currentSummaryRecalcFlagState?.data || null) : null;
    const flagError = flagReadyForMonth ? (currentSummaryRecalcFlagState?.error || null) : null;
    const flagState = getSummaryRecalcFlagState(recalcFlag);
    const summaryDocs = {
      dashboard: dashboardMatchesMonth,
      therapist: Boolean(therapistSummaryState?.data) && therapistSummaryState?.yearMonth === selectedYearMonth,
      rankings: rankingsMatchesMonth,
    };

    if (isSelectedCurrentMonth) {
      return {
        dashboard: dashboardMatchesMonth ? currentDashboardSummary : null,
        therapist: null,
        rankings: rankingsMatchesMonth ? currentRankingsSummary : null,
        trustStatus: {
          yearMonth: selectedYearMonth,
          statusKey: "current_dirty",
          ...getDashboardSummaryTrustMeta("current_dirty"),
          isTrusted: false,
          summaryDocs,
          pendingCount: 0,
          recalcFlag: null,
          checkedAtText: new Date().toISOString(),
        },
        ready: true,
        error: null,
      };
    }

    if (!reportReadyForMonth || !flagReadyForMonth) {
      return {
        dashboard: dashboardMatchesMonth ? currentDashboardSummary : null,
        therapist: therapistSummaryState?.yearMonth === selectedYearMonth ? therapistSummaryState?.data : null,
        rankings: rankingsMatchesMonth ? currentRankingsSummary : null,
        trustStatus: {
          yearMonth: selectedYearMonth,
          statusKey: "loading",
          ...getDashboardSummaryTrustMeta("loading"),
          isTrusted: false,
          summaryDocs,
          pendingCount: 0,
          recalcFlag: null,
          checkedAtText: new Date().toISOString(),
        },
        ready: false,
        error: null,
      };
    }

    let statusKey = "unverified";
    if (flagError) statusKey = "error";
    else if (!summaryDocs.dashboard || !summaryDocs.rankings) statusKey = "missing";
    else if (flagState.isDirty) statusKey = "dirty";
    else if (flagState.isVerified) statusKey = "verified";

    const updatedAtText =
      currentDashboardSummary?.lastUpdatedAtText ||
      currentRankingsSummary?.lastUpdatedAtText ||
      "";
    const flagCompletedAtText = recalcFlag?.lastCompletedAtText || recalcFlag?.completedAtText || "";
    const meta = getDashboardSummaryTrustMeta(statusKey);

    return {
      dashboard: dashboardMatchesMonth ? currentDashboardSummary : null,
      therapist: therapistSummaryState?.yearMonth === selectedYearMonth ? therapistSummaryState?.data : null,
      rankings: rankingsMatchesMonth ? currentRankingsSummary : null,
      trustStatus: {
        yearMonth: selectedYearMonth,
        statusKey,
        ...meta,
        isTrusted: statusKey === "verified",
        summaryDocs,
        pendingCount: flagState.isDirty ? 1 : 0,
        pendingSources: flagState.isDirty ? ["summary_recalc_flags"] : [],
        recalcFlag,
        recalcFlagStatus: flagState.status,
        recalcFlagRebuildAfterAtText: recalcFlag?.rebuildAfterAtText || "",
        lastDirtyAtText: recalcFlag?.lastDirtyAtText || "",
        lastUpdatedAtText: updatedAtText,
        lastCompareAtText: flagCompletedAtText,
        lastCompareStatus: flagState.isVerified ? "matched" : "-",
        lastCompareMismatchCount: flagState.mismatchCount,
        checkedAtText: new Date().toISOString(),
      },
      ready: true,
      error: flagError || null,
    };
  }, [
    currentDashboardSummary,
    currentRankingsSummary,
    currentReportSummaryReady,
    currentReportSummaryReadyYearMonth,
    currentReportSummaryReadyBrandId,
    currentSummaryRecalcFlagState,
    therapistSummaryState,
    selectedYearMonth,
    isSelectedCurrentMonth,
    brandInfo?.id,
  ]);

  const isSummaryTrustedForDashboard = useMemo(() => {
    if (isSelectedCurrentMonth) return false;
    return dashboardSummaryBundle.trustStatus?.isTrusted === true;
  }, [isSelectedCurrentMonth, dashboardSummaryBundle.trustStatus]);

  const isSummaryDashboardView = useMemo(() => {
    // ★ 即時戰情保護：本月仍使用明細計算，避免晚上陸續回報時 Dashboard 不更新。
    if (isSelectedCurrentMonth) return false;
    if (!isSummaryTrustedForDashboard) return false;
    if (!dashboardSummaryBundle.dashboard?.stores) return false;

    // ★ Summary v2 過渡版：
    // verified Summary 不只支援全品牌，也支援區長 / 單店篩選。
    // 這樣歷史月份整理完成後，切換單店或區域時也會用同一份可信 Summary，
    // 避免回到未同步的歷史明細 fallback。
    if (!(userRole === "director" || userRole === "master" || userRole === "trainer" || userRole === "manager" || userRole === "store" || userRole === "therapist")) return false;

    return true;
  }, [isSelectedCurrentMonth, isSummaryTrustedForDashboard, dashboardSummaryBundle.dashboard, userRole]);

  const buildProjectionFromSummaryStores = useMemo(() => (stores = [], daysPassed = 0, daysInMonth = 0) => {
    const emptyRange = {
      cash: { conservative: 0, standard: 0, aggressive: 0, min: 0, max: 0 },
      accrual: { conservative: 0, standard: 0, aggressive: 0, min: 0, max: 0 },
      profile: getProjectionBlendProfile(daysPassed, daysInMonth),
    };
    if (!daysPassed || !daysInMonth || !Array.isArray(stores)) {
      return { projection: 0, accrualProjection: 0, projectionRange: emptyRange };
    }

    const y = parseInt(selectedYear, 10);
    const m = parseInt(selectedMonth, 10);
    const profile = getProjectionBlendProfile(daysPassed, daysInMonth);

    const totals = {
      cash: { current: 0, conservative: 0, standard: 0, aggressive: 0 },
      accrual: { current: 0, conservative: 0, standard: 0, aggressive: 0 },
    };

    stores.forEach((store) => {
      const storeCore = cleanName(getSummaryStoreName(store));
      const storeCurve = getProjectionCurveForStore(storeCore);
      const cashAverages = storeCurve.cashAverages || {};
      const accrualAverages = storeCurve.accrualAverages || {};

      const currentCash = Number(store.cash) || 0;
      const currentAccrual = Number(store.accrual) || 0;
      const currentCashDailyAvg = currentCash / daysPassed;
      const currentAccrualDailyAvg = currentAccrual / daysPassed;

      totals.cash.current += currentCash;
      totals.accrual.current += currentAccrual;

      for (let d = daysPassed + 1; d <= daysInMonth; d++) {
        const futureDate = new Date(y, m - 1, d);
        const dow = futureDate.getDay();

        const historyCashValue = getUsableHistoryAverage(cashAverages, dow, currentCashDailyAvg);
        totals.cash.conservative += Math.min(currentCashDailyAvg, historyCashValue);
        totals.cash.standard += blendByWeights(currentCashDailyAvg, historyCashValue, profile.currentWeight, profile.historyWeight);
        totals.cash.aggressive += Math.max(currentCashDailyAvg, historyCashValue);

        const historyAccrualValue = getUsableHistoryAverage(accrualAverages, dow, currentAccrualDailyAvg);
        totals.accrual.conservative += Math.min(currentAccrualDailyAvg, historyAccrualValue);
        totals.accrual.standard += blendByWeights(currentAccrualDailyAvg, historyAccrualValue, profile.currentWeight, profile.historyWeight);
        totals.accrual.aggressive += Math.max(currentAccrualDailyAvg, historyAccrualValue);
      }
    });

    const cashRange = buildProjectionRangePayload({
      currentTotal: totals.cash.current,
      remainingConservative: totals.cash.conservative,
      remainingStandard: totals.cash.standard,
      remainingAggressive: totals.cash.aggressive,
    });
    const accrualRange = buildProjectionRangePayload({
      currentTotal: totals.accrual.current,
      remainingConservative: totals.accrual.conservative,
      remainingStandard: totals.accrual.standard,
      remainingAggressive: totals.accrual.aggressive,
    });

    return {
      projection: cashRange.standard,
      accrualProjection: accrualRange.standard,
      projectionRange: {
        cash: cashRange,
        accrual: accrualRange,
        profile,
      },
    };
  }, [selectedYear, selectedMonth, cleanName, getSummaryStoreName, getProjectionCurveForStore]);

  const summaryDashboardStats = useMemo(() => {
    const summary = dashboardSummaryBundle.dashboard;
    if (!summary || !isSummaryDashboardView) return null;

    const y = parseInt(selectedYear, 10);
    const m = parseInt(selectedMonth, 10);
    const daysInMonth = new Date(y, m, 0).getDate();
    const now = new Date();
    let daysPassed = daysInMonth;
    let isCurrentMonth = false;

    const allSummaryStores = normalizeSummaryStores(summary.stores || {});
    const effectiveStoreSet = new Set((effectiveStores || []).map(cleanName).filter(Boolean));
    const shouldFilterSummaryStores = Boolean(
      selectedDashboardManager ||
      selectedDashboardStore ||
      userRole === "manager" ||
      userRole === "store"
    );

    const stores = shouldFilterSummaryStores && effectiveStoreSet.size > 0
      ? allSummaryStores.filter((store) => summaryStoreMatchesSet(store, effectiveStoreSet))
      : allSummaryStores;

    const sumFields = [
      "cash", "accrual", "operationalAccrual", "skincareSales", "traffic",
      "newCustomers", "newCustomerClosings", "newCustomerSales", "refund", "skincareRefund",
      "budget", "accrualBudget", "challengeBudget", "challengeAccrualBudget"
    ];

    const aggregateGrandFromStores = (rows = []) => {
      const acc = sumFields.reduce((obj, key) => ({ ...obj, [key]: 0 }), {});
      rows.forEach((store) => {
        sumFields.forEach((key) => { acc[key] += Number(store?.[key] || 0); });
      });
      acc.totalAchievement = acc.budget > 0 ? (acc.cash / acc.budget) * 100 : 0;
      acc.totalAccrualAchievement = acc.accrualBudget > 0 ? (acc.accrual / acc.accrualBudget) * 100 : 0;
      acc.challengeAchievement = acc.challengeBudget > 0 ? (acc.cash / acc.challengeBudget) * 100 : 0;
      acc.challengeAccrualAchievement = acc.challengeAccrualBudget > 0 ? (acc.accrual / acc.challengeAccrualBudget) * 100 : 0;
      return acc;
    };

    const isFilteredSummaryView = shouldFilterSummaryStores && effectiveStoreSet.size > 0;
    const summaryGrand = summary.grandTotal || {};
    const grand = isFilteredSummaryView ? aggregateGrandFromStores(stores) : { ...summaryGrand };

    // Batch 5A-1：歷史 verified Summary 必須正式切到 Batch 4 Formal KPI contract。
    // 若 Summary schema 尚未升級，直接回到既有 detail fallback，不以 legacy 欄位冒充 Formal。
    if (!isFormalDashboardSummaryCompatible(summary)) return null;
    const formalScope = buildHistoricalFormalDashboardScope({
      summary,
      stores,
      monthlyTargetSummary,
      normalizeStoreKey: cleanName,
      filtered: isFilteredSummaryView,
    });
    if (!formalScope.compatible) return null;

    const legacyGrand = {
      cash: grand.cash,
      accrual: grand.accrual,
      budget: grand.budget,
      accrualBudget: grand.accrualBudget,
    };

    // 對既有 Dashboard view-model 做 compatibility mapping：
    // 舊畫面仍讀 cash/accrual/budget/accrualBudget，但歷史 Summary 模式下這四個欄位改承接 Formal authority。
    // null 代表缺漏/invalid/TARGET_INCOMPLETE，不能被 Number(... || 0) 吞成合法 0。
    grand.legacyCash = legacyGrand.cash;
    grand.legacyAccrual = legacyGrand.accrual;
    grand.legacyBudget = legacyGrand.budget;
    grand.legacyAccrualBudget = legacyGrand.accrualBudget;
    grand.cash = formalScope.cash;
    grand.accrual = formalScope.accrual;
    grand.budget = formalScope.cashTarget;
    grand.accrualBudget = formalScope.accrualTarget;
    grand.formalNetCash = formalScope.cash;
    grand.formalNetCashStatus = formalScope.cashStatus;
    grand.formalAccrual = formalScope.accrual;
    grand.formalAccrualStatus = formalScope.accrualStatus;
    grand.formalCashTarget = formalScope.cashTarget;
    grand.formalCashTargetStatus = formalScope.cashTargetStatus;
    grand.formalAccrualTarget = formalScope.accrualTarget;
    grand.formalAccrualTargetStatus = formalScope.accrualTargetStatus;
    grand.formalCashAchievement = formalScope.cashAchievement;
    grand.formalCashAchievementStatus = formalScope.cashAchievementStatus;
    grand.formalAccrualAchievement = formalScope.accrualAchievement;
    grand.formalAccrualAchievementStatus = formalScope.accrualAchievementStatus;
    grand.formalConsumerActive = true;

    // Challenge 仍是 compatibility layer；不把 legacy challenge 欄位假裝成 Formal contract。
    grand.hasChallengeCash = Number.isFinite(formalScope.cashTarget) && Number(grand.challengeBudget || 0) > formalScope.cashTarget;
    grand.hasChallengeAccrual = Number.isFinite(formalScope.accrualTarget) && Number(grand.challengeAccrualBudget || 0) > formalScope.accrualTarget;

    // 歷史月份已結算，月底推估應與 Formal 實績一致，避免卡片顯示 legacy cash/accrual。
    const cashProjection = Number.isFinite(formalScope.cash) ? formalScope.cash : null;
    const accrualProjection = Number.isFinite(formalScope.accrual) ? formalScope.accrual : null;
    grand.projection = cashProjection;
    grand.accrualProjection = accrualProjection;
    grand.projectionRange = {
      cash: cashProjection === null ? null : { conservative: cashProjection, standard: cashProjection, aggressive: cashProjection, min: cashProjection, max: cashProjection },
      accrual: accrualProjection === null ? null : { conservative: accrualProjection, standard: accrualProjection, aggressive: accrualProjection, min: accrualProjection, max: accrualProjection },
      profile: { currentWeight: 1, historyWeight: 0, label: "歷史結算：Formal 實績" },
    };

    const selectedStoreSet = new Set(stores.flatMap((item) => getSummaryStoreCandidates(item)).filter(Boolean));

    // ★ 營運節奏維持原本邏輯：
    // 當月預設用「系統日 - 1 天」，避免主管白天查看時，把尚未結束營業的今天算進應達進度。
    // 歷史月份則以完整月份呈現。
    const rawDailyTotals = Array.isArray(summary.dailyTotals) ? summary.dailyTotals : [];
    const storeDailyTotalsMap = summary.storeDailyTotals && typeof summary.storeDailyTotals === "object" ? summary.storeDailyTotals : null;
    const hasPreciseStoreDailyTotals = Boolean(isFilteredSummaryView && storeDailyTotalsMap && selectedStoreSet.size > 0);
    const buildPreciseFilteredDailyTotals = () => {
      const baseRows = Array.from({ length: daysInMonth }, (_, index) => ({
        day: index + 1,
        date: `${m}/${index + 1}`,
        cash: 0,
        accrual: 0,
        operationalAccrual: 0,
        skincareSales: 0,
        traffic: 0,
        newCustomers: 0,
        newCustomerClosings: 0,
        newCustomerSales: 0,
        refund: 0,
        skincareRefund: 0,
      }));
      if (!hasPreciseStoreDailyTotals) return null;
      Object.entries(storeDailyTotalsMap || {}).forEach(([storeKey, rows]) => {
        const storeCore = cleanName(storeKey);
        if (!selectedStoreSet.has(storeCore) || !Array.isArray(rows)) return;
        rows.forEach((row, index) => {
          const day = Number(row?.day || index + 1);
          if (!day || day < 1 || day > daysInMonth) return;
          const target = baseRows[day - 1];
          ["cash", "accrual", "operationalAccrual", "skincareSales", "traffic", "newCustomers", "newCustomerClosings", "newCustomerSales", "refund", "skincareRefund"].forEach((key) => {
            target[key] += Number(row?.[key] || 0);
          });
        });
      });
      return baseRows;
    };
    const preciseFilteredDailyTotals = buildPreciseFilteredDailyTotals();
    const dailyTotalsForDataDayCheck = preciseFilteredDailyTotals || rawDailyTotals;
    const getDailyDayNumber = (row, index) => Number(row?.day || index + 1);
    const hasMeaningfulDailyData = (row) => {
      if (!row || typeof row !== "object") return false;
      return Object.entries(row).some(([key, value]) => {
        if (["day", "date", "label"].includes(key)) return false;
        return typeof value === "number" && value !== 0;
      });
    };
    const maxDataDay = dailyTotalsForDataDayCheck.reduce((max, row, index) => {
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

    const totalAchievement = formalScope.cashAchievement;
    const totalAccrualAchievement = formalScope.accrualAchievement;
    const challengeAchievement = Number.isFinite(formalScope.cash) && Number(grand.challengeBudget || 0) > 0
      ? (formalScope.cash / Number(grand.challengeBudget)) * 100
      : 0;
    const challengeAccrualAchievement = Number.isFinite(formalScope.accrual) && Number(grand.challengeAccrualBudget || 0) > 0
      ? (formalScope.accrual / Number(grand.challengeAccrualBudget)) * 100
      : 0;

    const avgTrafficASP = Number(grand.traffic || 0) > 0 ? Math.round(Number(grand.operationalAccrual || 0) / Number(grand.traffic || 0)) : 0;
    const avgNewCustomerASP = Number(grand.newCustomers || 0) > 0 ? Math.round(Number(grand.newCustomerSales || 0) / Number(grand.newCustomers || 0)) : 0;
    const newRevMix = Number(grand.cash || 0) > 0 ? Math.round((Number(grand.newCustomerSales || 0) / Number(grand.cash || 0)) * 100) : 0;
    const oldRevMix = Number(grand.cash || 0) > 0 ? Math.max(0, 100 - newRevMix) : 0;
    const newCountMix = Number(grand.traffic || 0) > 0 ? Math.round((Number(grand.newCustomers || 0) / Number(grand.traffic || 0)) * 100) : 0;
    const oldCountMix = Number(grand.traffic || 0) > 0 ? Math.max(0, 100 - newCountMix) : 0;

    let chartDays = daysInMonth;
    if (isCurrentMonth) chartDays = Math.max(1, daysPassed);
    else if (daysPassed === 0) chartDays = 0;

    // Summary v2：若後端已提供 storeDailyTotals，區長 / 單店歷史日趨勢改用精準每日加總。
    // Summary v1 舊月份沒有 storeDailyTotals 時，保留原本比例縮放 fallback，避免破壞已建立的歷史報表。
    const fullCash = Number(summaryGrand.cash || 0);
    const fullTraffic = Number(summaryGrand.traffic || 0);
    const cashRatio = isFilteredSummaryView && fullCash > 0 ? Number(grand.cash || 0) / fullCash : 1;
    const trafficRatio = isFilteredSummaryView && fullTraffic > 0 ? Number(grand.traffic || 0) / fullTraffic : 1;
    const dailyTotals = preciseFilteredDailyTotals
      ? preciseFilteredDailyTotals.slice(0, chartDays)
      : rawDailyTotals.slice(0, chartDays).map((row) => ({
          ...row,
          cash: isFilteredSummaryView ? Math.round(Number(row.cash || 0) * cashRatio) : Number(row.cash || 0),
          traffic: isFilteredSummaryView ? Math.round(Number(row.traffic || 0) * trafficRatio) : Number(row.traffic || 0),
        }));

    const mapStoreTop = (rows = []) => {
      const list = Array.isArray(rows) ? rows : [];
      const filtered = isFilteredSummaryView && selectedStoreSet.size > 0
        ? list.filter((item) => {
            const candidates = [
              item.store,
              item.name,
              item.displayName,
              item.storeName,
              item.id,
            ].map(cleanName).filter(Boolean);
            return candidates.some((candidate) => selectedStoreSet.has(candidate));
          })
        : list;
      return filtered.map((item) => ({
        name: item.name || item.displayName || (item.store ? `${item.store}店` : ""),
        revenue: Number(item.revenue ?? item.cash ?? 0),
        streak: false,
        badgeText: "",
      }));
    };

    const formalMonthlyTop = [...stores]
      .filter((item) => (
        item?.formalLifecycleEligible === true &&
        [KPI_VALUE_STATUS.VALID, KPI_VALUE_STATUS.VALID_ZERO].includes(item?.formalNetCashStatus) &&
        Number.isFinite(Number(item?.formalNetCash))
      ))
      .sort((a, b) => Number(b.formalNetCash) - Number(a.formalNetCash))
      .slice(0, 3)
      .map((item) => {
        const core = cleanName(getSummaryStoreName(item));
        return { name: item.displayName || (core ? `${core}店` : ""), revenue: Number(item.formalNetCash), streak: false, badgeText: "" };
      });

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
      storeMonthlyTop3: formalMonthlyTop,
      storeTodayTop3: mapStoreTop(summary.storeTop3?.today),
      storeYesterdayTop3: mapStoreTop(summary.storeTop3?.yesterday),
      source: preciseFilteredDailyTotals ? "summary_store_daily" : isFilteredSummaryView ? "summary_filtered" : "summary",
      summaryLastUpdatedAtText: summary.lastUpdatedAtText || "",
      summaryFilterMode: isFilteredSummaryView ? (selectedDashboardStore ? "store" : "manager") : "brand",
      formalConsumerActive: true,
      formalKpiStatus: {
        cash: formalScope.cashStatus,
        cashTarget: formalScope.cashTargetStatus,
        cashAchievement: formalScope.cashAchievementStatus,
        accrual: formalScope.accrualStatus,
        accrualTarget: formalScope.accrualTargetStatus,
        accrualAchievement: formalScope.accrualAchievementStatus,
        cashCoverageComplete: formalScope.cashCoverageComplete,
        accrualCoverageComplete: formalScope.accrualCoverageComplete,
        lifecycleReady: formalScope.lifecycleReady,
        scopeEligibleStoreCount: formalScope.scopeEligibleStoreCount,
        targetSummaryAvailable: formalScope.targetSummaryAvailable,
      },
    };
  }, [dashboardSummaryBundle.dashboard, isSummaryDashboardView, selectedYear, selectedMonth, effectiveStores, selectedDashboardManager, selectedDashboardStore, cleanName, getSummaryStoreName, getSummaryStoreCandidates, normalizeSummaryStores, summaryStoreMatchesSet, userRole, monthlyTargetSummary]);

  const summaryMyStoreRankings = useMemo(() => {
    // ★ 當月門市排行也必須即時，避免主管或店長看到未更新的 Summary 排名。
    if (isSelectedCurrentMonth || !isSummaryTrustedForDashboard) return null;
    const summary = dashboardSummaryBundle.dashboard;
    if (!summary || userRole !== "store" || !currentUser) return null;
    if (!isFormalDashboardSummaryCompatible(summary)) return null;

    // Batch 5A-1：歷史店經理排名正式改吃 formalStoreRankings。
    // rank denominator 只使用 formalRankEligibleStoreCount，避免 invalid/missing target 被塞進排名。
    const formalRanks = Array.isArray(summary.formalStoreRankings) ? summary.formalStoreRankings : [];
    const formalRankEligibleStoreCount = Number(summary.formalRankEligibleStoreCount || formalRanks.length || 0);
    const myCores = (effectiveStores || []).map(cleanName).filter(Boolean);
    const myCoreSet = new Set(myCores);
    const summaryStores = normalizeSummaryStores(summary.stores || {});

    return formalRanks
      .filter((s) => summaryStoreMatchesSet(s, myCoreSet))
      .map((s) => {
        const actual = Number(s.formalNetCash);
        const target = Number(s.formalCashTarget);
        const rate = Number(s.formalCashAchievement);
        if (!Number.isFinite(actual) || !Number.isFinite(target) || !Number.isFinite(rate)) return null;

        const sourceStore = summaryStores.find((store) => {
          const core = cleanName(getSummaryStoreName(s));
          return core && getSummaryStoreCandidates(store).includes(core);
        }) || {};
        const legacyChallengeTarget = Number(sourceStore.challengeBudget || 0);
        const challengeTarget = legacyChallengeTarget > target ? legacyChallengeTarget : target;
        const hasChallenge = challengeTarget > target;
        const challengeRate = challengeTarget > 0 ? (actual / challengeTarget) * 100 : 0;
        const rank = Number(s.formalCashAchievementRank || 0);

        return {
          storeName: s.displayName || sourceStore.displayName || `${cleanName(getSummaryStoreName(s))}店`,
          rank,
          totalStores: formalRankEligibleStoreCount,
          actual,
          target,
          rate,
          challengeTarget,
          hasChallenge,
          challengeRate,
          passedChallenge: hasChallenge && challengeRate >= 100,
          rankingSemantics: "formal_cash_achievement",
          isBottomSegment: isInBottomRankingSegment(rank, formalRankEligibleStoreCount),
          isBottom5: isInBottomRankingSegment(rank, formalRankEligibleStoreCount),
        };
      })
      .filter(Boolean);
  }, [dashboardSummaryBundle.dashboard, userRole, currentUser, effectiveStores, cleanName, getSummaryStoreName, getSummaryStoreCandidates, normalizeSummaryStores, summaryStoreMatchesSet, isSelectedCurrentMonth, isSummaryTrustedForDashboard]);

  const summaryTherapistStats = useMemo(() => {
    if (viewMode !== "therapist" && userRole !== "therapist" && userRole !== "trainer") return null;
    // ★ 即時戰情保護：當月人員績效仍用明細計算，避免管理師晚上陸續回報後，今日戰神/排行榜不即時更新。
    if (isSelectedCurrentMonth || !isSummaryTrustedForDashboard) return null;
    const summary = dashboardSummaryBundle.therapist;
    if (!summary) return null;

    const normalizeStoreDisplay = (value) => cleanName(value || "").replace(/店$/, "") + "店";
    const selectedStores = new Set((therapistEffectiveStores || []).map(cleanName).filter(Boolean));
    // 保留 useDashboardStats-NEW 的原始設計：區長／店經理預設觀看全品牌人員績效；
    // 只有手動選區或選店時，才縮小人員績效範圍。
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
  }, [dashboardSummaryBundle.therapist, therapistEffectiveStores, selectedDashboardManager, selectedDashboardStore, cleanName, userRole, currentUser, therapistAnnualAggregatedData, isSelectedCurrentMonth, isSummaryTrustedForDashboard, viewMode]);


  const detailDashboardStats = useMemo(() => {
    if (!allReports) return null;
    if (!currentDetailFormalScope.compatible) return null;
    const formalScopeStoreKeySet = new Set(currentDetailFormalScope.scopeStoreKeys || []);
    const formalBrandStoreKeySet = new Set(currentDetailFormalAuthority.eligibleStoreKeys || []);
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
      if (!formalScopeStoreKeySet.has(reportStoreClean)) return;

      const cash = getFormalNetCashValue(report) ?? 0;
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

    const getStoreTop3Global = (targetDateStr) => {
        const storeMap = {};
        allReports.forEach(r => {
            if (r.date === targetDateStr) {
                const core = cleanName(r.storeName);
                if (!formalBrandStoreKeySet.has(core)) return;
                const sName = core + '店';
                if (!storeMap[sName]) storeMap[sName] = 0;
                storeMap[sName] += getFormalNetCashValue(r) ?? 0;
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
            const core = cleanName(r.storeName);
            if (!formalBrandStoreKeySet.has(core)) return;
            const sName = core + '店';
            if (!storeMonthlyMap[sName]) storeMonthlyMap[sName] = 0;
            storeMonthlyMap[sName] += getFormalNetCashValue(r) ?? 0;
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

    // Batch 5D-2：正式達成率 authority 由 Lifecycle + reporting completeness + Target Coverage 決定。
    const achievement = currentDetailFormalScope.cashAchievement;
    const accrualAchievement = currentDetailFormalScope.accrualAchievement;
    const challengeAchievement = currentDetailFormalScope.challengeCashAchievement;
    const challengeAccrualAchievement = currentDetailFormalScope.challengeAccrualAchievement;

 // ============================================================================
    // ★ 月底推估：動態權重 + 保守 / 標準 / 積極區間
    //    - 保守：偏本月實際節奏
    //    - 標準：依月份進度動態調整本月與歷史權重
    //    - 積極：保留歷史高節奏與月底衝刺可能
    // ============================================================================
    let projection = 0;
    let accrualProjection = 0;
    let projectionRange = {
      cash: { conservative: 0, standard: 0, aggressive: 0, min: 0, max: 0 },
      accrual: { conservative: 0, standard: 0, aggressive: 0, min: 0, max: 0 },
      profile: getProjectionBlendProfile(daysPassed, daysInMonth),
    };

    if (daysPassed > 0) {
        const profile = getProjectionBlendProfile(daysPassed, daysInMonth);
        const totals = {
          cash: { current: 0, conservative: 0, standard: 0, aggressive: 0 },
          accrual: { current: 0, conservative: 0, standard: 0, aggressive: 0 },
        };

        Object.keys(storeStatsMap).forEach(storeName => {
            const sStats = storeStatsMap[storeName];
            const storeCurve = getProjectionCurveForStore(storeName);
            const cashAverages = storeCurve.cashAverages || {};
            const accrualAverages = storeCurve.accrualAverages || {};

            const currentCashDailyAvg = sStats.cash / daysPassed;
            const currentAccrualDailyAvg = sStats.accrual / daysPassed;

            totals.cash.current += sStats.cash;
            totals.accrual.current += sStats.accrual;

            for (let d = daysPassed + 1; d <= daysInMonth; d++) {
                const futureDate = new Date(y, m - 1, d);
                const dow = futureDate.getDay();

                const historyCashValue = getUsableHistoryAverage(cashAverages, dow, currentCashDailyAvg);

                totals.cash.conservative += Math.min(currentCashDailyAvg, historyCashValue);
                totals.cash.standard += blendByWeights(currentCashDailyAvg, historyCashValue, profile.currentWeight, profile.historyWeight);
                totals.cash.aggressive += Math.max(currentCashDailyAvg, historyCashValue);

                const historyAccrualValue = getUsableHistoryAverage(accrualAverages, dow, currentAccrualDailyAvg);

                totals.accrual.conservative += Math.min(currentAccrualDailyAvg, historyAccrualValue);
                totals.accrual.standard += blendByWeights(currentAccrualDailyAvg, historyAccrualValue, profile.currentWeight, profile.historyWeight);
                totals.accrual.aggressive += Math.max(currentAccrualDailyAvg, historyAccrualValue);
            }
        });

        const cashRange = buildProjectionRangePayload({
          currentTotal: totals.cash.current,
          remainingConservative: totals.cash.conservative,
          remainingStandard: totals.cash.standard,
          remainingAggressive: totals.cash.aggressive,
        });
        const accrualRange = buildProjectionRangePayload({
          currentTotal: totals.accrual.current,
          remainingConservative: totals.accrual.conservative,
          remainingStandard: totals.accrual.standard,
          remainingAggressive: totals.accrual.aggressive,
        });

        projection = cashRange.standard;
        accrualProjection = accrualRange.standard;
        projectionRange = { cash: cashRange, accrual: accrualRange, profile };
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

    const formalCashAvailable = isFiniteKpiNumber(currentDetailFormalScope.cash);
    const formalAccrualAvailable = isFiniteKpiNumber(currentDetailFormalScope.accrual);
    const formalProjection = formalCashAvailable ? projection : null;
    const formalAccrualProjection = formalAccrualAvailable ? accrualProjection : null;
    const formalProjectionRange = {
      ...projectionRange,
      cash: formalCashAvailable ? projectionRange.cash : null,
      accrual: formalAccrualAvailable ? projectionRange.accrual : null,
    };

    return {
      grandTotal: {
        cash: currentDetailFormalScope.cash,
        accrual: currentDetailFormalScope.accrual,
        operationalAccrual: stats.operationalAccrual,
        skincareSales: stats.skincareSales,
        traffic: stats.traffic,
        newCustomers: stats.newCustomers,
        newCustomerClosings: stats.newCustomerClosings,
        newCustomerSales: stats.newCustomerSales,
        budget: currentDetailFormalScope.cashTarget,
        accrualBudget: currentDetailFormalScope.accrualTarget,
        challengeBudget: currentDetailFormalScope.challengeCashTarget,
        challengeAccrualBudget: currentDetailFormalScope.challengeAccrualTarget,
        hasChallengeCash: currentDetailFormalScope.challengeCashConfigured === true,
        hasChallengeAccrual: currentDetailFormalScope.challengeAccrualConfigured === true,
        projection: formalProjection,
        accrualProjection: formalAccrualProjection,
        projectionRange: formalProjectionRange,
        formalNetCash: currentDetailFormalScope.cash,
        formalNetCashStatus: currentDetailFormalScope.cashStatus,
        formalAccrual: currentDetailFormalScope.accrual,
        formalAccrualStatus: currentDetailFormalScope.accrualStatus,
        formalCashTarget: currentDetailFormalScope.cashTarget,
        formalCashTargetStatus: currentDetailFormalScope.cashTargetStatus,
        formalAccrualTarget: currentDetailFormalScope.accrualTarget,
        formalAccrualTargetStatus: currentDetailFormalScope.accrualTargetStatus,
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
      oldCountMix,
      storeMonthlyTop3,
      storeTodayTop3,
      storeYesterdayTop3,
      source: "detail_formal",
      formalConsumerActive: true,
      formalKpiStatus: {
        cash: currentDetailFormalScope.cashStatus,
        cashTarget: currentDetailFormalScope.cashTargetStatus,
        cashAchievement: currentDetailFormalScope.cashAchievementStatus,
        accrual: currentDetailFormalScope.accrualStatus,
        accrualTarget: currentDetailFormalScope.accrualTargetStatus,
        accrualAchievement: currentDetailFormalScope.accrualAchievementStatus,
        reportingStatus: currentDetailFormalScope.reportingStatus,
        cashCoverageComplete: currentDetailFormalScope.cashCoverageComplete,
        accrualCoverageComplete: currentDetailFormalScope.accrualCoverageComplete,
        lifecycleReady: currentDetailFormalAuthority.lifecycleReady === true,
        scopeEligibleStoreCount: currentDetailFormalScope.scopeEligibleStoreCount,
        targetSummaryAvailable: currentDetailFormalScope.targetSummaryAvailable,
      },
    };
  // ★ 監視清單換成了包含全部小抄的字典
  }, [allReports, selectedYear, selectedMonth, effectiveStores, brandPrefix, cleanName, getProjectionCurveForStore, currentDetailFormalScope, currentDetailFormalAuthority]);

  const detailMyStoreRankings = useMemo(() => {
    if (!currentDetailFormalAuthority?.compatible) return [];
    const effectiveStoreSet = new Set((effectiveStores || []).map(cleanName).filter(Boolean));
    const totalStores = Number(currentDetailFormalAuthority.formalRankEligibleStoreCount || 0);

    return Object.values(currentDetailFormalAuthority.stores || {})
      .filter((row) => row?.formalRankEligible === true && effectiveStoreSet.has(cleanName(row.storeKey)))
      .sort((a, b) => Number(a.formalCashAchievementRank || 0) - Number(b.formalCashAchievementRank || 0))
      .map((row) => {
        const rank = Number(row.formalCashAchievementRank || 0);
        const target = row.cashTarget;
        const challengeTarget = row.challengeCashTarget;
        const hasChallenge = row.challengeCashTargetConfigured === true;
        const challengeRate = (
          isFiniteKpiNumber(row.formalNetCash) &&
          isFiniteKpiNumber(challengeTarget) &&
          challengeTarget > 0
        ) ? (row.formalNetCash / challengeTarget) * 100 : null;

        return {
          storeName: row.canonicalStoreName || `${brandPrefix}${row.storeKey}店`,
          rank,
          totalStores,
          actual: row.formalNetCash,
          target,
          rate: row.cashAchievement,
          challengeTarget,
          hasChallenge,
          challengeRate,
          passedChallenge: hasChallenge && isFiniteKpiNumber(challengeRate) && challengeRate >= 100,
          rankingSemantics: "formal_cash_achievement",
          isBottomSegment: isInBottomRankingSegment(rank, totalStores),
          isBottom5: isInBottomRankingSegment(rank, totalStores),
        };
      });
  }, [currentDetailFormalAuthority, effectiveStores, cleanName, brandPrefix]);

  const detailTherapistStats = useMemo(() => {
    const emptyTherapistStats = { rankings: [], myStats: null, grandTotal: {}, yesterdayTop3: [], todayTop3: [], myYearlyTotal: 0, source: "not_loaded" };
    if (!isTherapistModuleEnabled) return emptyTherapistStats;
    if (viewMode !== "therapist" && userRole !== "therapist" && userRole !== "trainer") return emptyTherapistStats;
    if (!therapistReports) return emptyTherapistStats; 
    
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
  }, [therapistReports, selectedYear, selectedMonth, therapistEffectiveStores, allReports, cleanName, userRole, currentUser, therapists, therapistAnnualAggregatedData, viewMode, isTherapistModuleEnabled]);

  const isHistoricalDetailRefreshing = useMemo(() => (
    !isSelectedCurrentMonth &&
    historicalDetailRefreshState?.yearMonth === selectedYearMonth &&
    ["requested", "loading"].includes(historicalDetailRefreshState?.status)
  ), [isSelectedCurrentMonth, historicalDetailRefreshState, selectedYearMonth]);

  const hasHistoricalDetailRefreshError = useMemo(() => (
    !isSelectedCurrentMonth &&
    historicalDetailRefreshState?.yearMonth === selectedYearMonth &&
    historicalDetailRefreshState?.status === "error"
  ), [isSelectedCurrentMonth, historicalDetailRefreshState, selectedYearMonth]);

  const baseDashboardStats = summaryDashboardStats || detailDashboardStats;
  const dashboardStats = useMemo(() => {
    if (!baseDashboardStats) return baseDashboardStats;
    return { ...baseDashboardStats, annualKpiBenchmark: effectiveAnnualKpiBenchmark };
  }, [baseDashboardStats, effectiveAnnualKpiBenchmark]);
  const myStoreRankings = summaryMyStoreRankings || detailMyStoreRankings;
  const therapistStats = isTherapistModuleEnabled ? (summaryTherapistStats || detailTherapistStats) : { rankings: [], myStats: null, grandTotal: {}, yesterdayTop3: [], todayTop3: [], myYearlyTotal: 0, source: "module_disabled" };

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
      usingDetailFallback: !isSelectedCurrentMonth && Boolean(dashboardSummaryBundle.ready) && !Boolean(summaryDashboardStats),
      error: dashboardSummaryBundle.error,
      yearMonth: selectedYearMonth,
      trustStatus: dashboardSummaryBundle.trustStatus,
      statusKey: dashboardSummaryBundle.trustStatus?.statusKey || (isSelectedCurrentMonth ? "current" : "unknown"),
      statusLabel: isSelectedCurrentMonth ? "本月即時資料" : (dashboardSummaryBundle.trustStatus?.label || "Summary 狀態未知"),
      statusHint: isSelectedCurrentMonth
        ? "本月 Dashboard 以即時明細為準。"
        : isHistoricalDetailRefreshing
        ? "Summary 已失效，正在重新讀取此月份最新明細；完成前保留原畫面，避免顯示 0 或半套資料。"
        : hasHistoricalDetailRefreshError
        ? `最新明細載入失敗：${historicalDetailRefreshState?.error || "未知錯誤"}`
        : (dashboardSummaryBundle.trustStatus?.hint || "尚未完成 Summary 狀態判斷。"),
      isTrustedSummary: dashboardSummaryBundle.trustStatus?.isTrusted === true,
      detailRefreshStatus: historicalDetailRefreshState?.status || "idle",
      detailRefreshYearMonth: historicalDetailRefreshState?.yearMonth || "",
      detailRefreshLoadedAtText: historicalDetailRefreshState?.loadedAtText || "",
      detailRefreshError: historicalDetailRefreshState?.error || "",
      isDetailRefreshing: isHistoricalDetailRefreshing,
      dataSourceMode: isSelectedCurrentMonth
        ? "live"
        : summaryDashboardStats
        ? "verified_summary"
        : isHistoricalDetailRefreshing
        ? "detail_refreshing"
        : hasHistoricalDetailRefreshError
        ? "detail_refresh_error"
        : "detail_fallback",
      dataSourceLabel: isSelectedCurrentMonth
        ? "即時明細"
        : summaryDashboardStats
        ? "已整理 Summary"
        : isHistoricalDetailRefreshing
        ? "正在載入最新明細"
        : hasHistoricalDetailRefreshError
        ? "明細載入失敗"
        : "明細暫代",
      lastUpdatedAtText: dashboardSummaryBundle.trustStatus?.lastUpdatedAtText || "",
      lastCompareAtText: dashboardSummaryBundle.trustStatus?.lastCompareAtText || "",
      pendingCount: dashboardSummaryBundle.trustStatus?.pendingCount || 0,
    },
    dailyLoginCount, yesterdayLoginCount,
    groupedStoresForFilter, availableStoresForDropdown,
    officialStoresForDropdown, delegatedStoresForDropdown, delegatedStoreDetails
  };
}