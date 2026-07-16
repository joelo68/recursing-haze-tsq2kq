// src/hooks/useDashboardStats.js
import { useState, useMemo, useContext, useEffect } from 'react';
import { AppContext } from '../AppContext';
import { sortManagerNames, sortStoreNames, sortManagersByOrgOrder, sortStoresByOrgOrder } from "../utils/helpers";
// ★ 新增了 collection 與 getDocs，讓我們一次把全公司的專屬小抄都抓下來
import { doc, getDoc, collection, getDocs, query, where, limit, onSnapshot } from 'firebase/firestore'; 
import { db } from '../config/firebase';

const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

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
    allReports, budgets, monthlyTargetSummary, managers, managerOrder = [], selectedYear, selectedMonth, therapistReports,
    currentBrand, therapists, dailyLoginCount, yesterdayLoginCount,
    therapistAnnualAggregatedData, getCollectionPath, historicalDetailRefreshState,
    therapistModuleEnabled
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

      const cacheKey = `cyj_annual_kpi_summary_v3_${brandId}_${year}`;
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

  const getBudgetDataForStore = useMemo(() => {
    const summaryTargets = monthlyTargetSummary?.targets || {};
    const hasUsableSummary = Boolean(
      monthlyTargetSummary &&
      monthlyTargetSummary.yearMonth &&
      summaryTargets &&
      Object.keys(summaryTargets).length > 0
    );

    return (fullStoreName, y, m) => {
      const legacyKey = `${fullStoreName}_${y}_${m}`;
      const legacyValue = budgets?.[legacyKey] || null;

      if (!hasUsableSummary) return legacyValue;

      // Summary 可能尚未完整補齊；單店找不到時必須 fallback 原本 budgets，避免達成率歸零或目標失真。
      return summaryTargets?.[fullStoreName] || legacyValue;
    };
  }, [monthlyTargetSummary, budgets]);

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
    if (selectedDashboardManager && groupedStoresForFilter[selectedDashboardManager]) {
        return groupedStoresForFilter[selectedDashboardManager];
    }
    return sortStoresByOrgOrder(managers, Object.values(groupedStoresForFilter).flat(), brandPrefix, managerOrder);
  }, [selectedDashboardManager, groupedStoresForFilter, userRole, currentUser, managers, brandPrefix, managerOrder]);

  const effectiveStores = useMemo(() => {
    if (selectedDashboardStore) return [cleanName(selectedDashboardStore)];
    if (selectedDashboardManager) return (managers[selectedDashboardManager] || []).map(cleanName).filter(Boolean);
    return baseVisibleStores;
  }, [baseVisibleStores, selectedDashboardStore, selectedDashboardManager, managers, cleanName]);

  const allCompanyStores = useMemo(() => {
    const stores = new Set();

    Object.values(managers || {}).flat().forEach((storeName) => {
      const core = cleanName(storeName);
      if (core) stores.add(core);
    });

    if (allReports) {
      allReports.forEach(r => { if (r.storeName) stores.add(cleanName(r.storeName)); });
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
    selectedStoreSummaries.forEach((storeSummary) => {
      const monthlyValues = storeSummary?.monthlyValues && typeof storeSummary.monthlyValues === "object"
        ? storeSummary.monthlyValues
        : {};

      Object.entries(monthlyValues).forEach(([yearMonth, metrics]) => {
        if (!monthTotals[yearMonth]) {
          monthTotals[yearMonth] = { traffic: 0, newCustomers: 0, cash: 0, accrual: 0 };
        }
        monthTotals[yearMonth].traffic += safeNumber(metrics?.traffic);
        monthTotals[yearMonth].newCustomers += safeNumber(metrics?.newCustomers);
        monthTotals[yearMonth].cash += safeNumber(metrics?.cash);
        monthTotals[yearMonth].accrual += safeNumber(metrics?.accrual);
      });
    });

    const basedMonths = Object.entries(monthTotals)
      .filter(([, metrics]) => (
        safeNumber(metrics.traffic) > 0 ||
        safeNumber(metrics.newCustomers) > 0 ||
        safeNumber(metrics.cash) > 0 ||
        safeNumber(metrics.accrual) > 0
      ))
      .map(([yearMonth]) => yearMonth)
      .sort();

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
  // ★ Dashboard Summary v1：安全過渡版 summary-first
  // 先嘗試讀取維護中心建立好的 summary；若不存在或不適用，仍會 fallback 原本明細計算。
  // ==========================================
  const [dashboardSummaryBundle, setDashboardSummaryBundle] = useState({
    dashboard: null,
    therapist: null,
    rankings: null,
    trustStatus: null,
    ready: false,
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

  const getSummaryQueueYearMonth = (row = {}) => {
    const raw = row.affectedYearMonth || row.yearMonth || String(row.date || row.sourceDate || "").slice(0, 7);
    return /^\d{4}-\d{2}$/.test(String(raw || "")) ? String(raw) : "未知月份";
  };

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
    let cancelled = false;
    const unsubscribers = [];

    const buildTrustStatus = ({ dashboardData = {}, therapistData = {}, rankingsData = {}, summaryDocs = {}, queueRows = [], logRows = [], recalcFlag = null }) => {
      const allSummaryExists = Boolean(summaryDocs.dashboard && summaryDocs.therapist && summaryDocs.rankings);
      const updatedAtText = dashboardData.lastUpdatedAtText || therapistData.lastUpdatedAtText || rankingsData.lastUpdatedAtText || "";
      const summaryUpdatedMs = updatedAtText ? new Date(updatedAtText).getTime() : 0;

      const pendingRows = (queueRows || []).filter((row) => getSummaryQueueYearMonth(row) === selectedYearMonth);
      const flagStatus = String(recalcFlag?.status || "").toLowerCase();
      const flagMismatchCount = Number(recalcFlag?.lastMismatchCount ?? recalcFlag?.mismatchCount ?? 0);
      const flagCompletedAtText = recalcFlag?.lastCompletedAtText || recalcFlag?.completedAtText || "";
      const flagIsCompleteStatus = ["completed", "verified", "idle"].includes(flagStatus);
      const flagVerified = Boolean(recalcFlag) && ["completed", "verified"].includes(flagStatus) && recalcFlag?.dirty !== true && flagMismatchCount === 0;
      const flagDirty = Boolean(recalcFlag) && (recalcFlag?.dirty === true || !flagIsCompleteStatus);
      const compareLogs = (logRows || [])
        .filter((row) => row.type === "dashboard_summary" && row.action === "compare_summary_with_raw")
        .sort((a, b) => new Date(b.createdAtText || 0).getTime() - new Date(a.createdAtText || 0).getTime());
      const latestCompare = compareLogs[0] || null;
      const latestCompareMs = latestCompare?.createdAtText ? new Date(latestCompare.createdAtText).getTime() : 0;
      const compareAfterBuild = latestCompare && (!summaryUpdatedMs || latestCompareMs >= summaryUpdatedMs - 1000);

      let statusKey = "unverified";
      if (!allSummaryExists) statusKey = "missing";
      else if ((pendingRows.length > 0 || flagDirty) && isSelectedCurrentMonth) statusKey = "current_dirty";
      else if (pendingRows.length > 0 || flagDirty) statusKey = "dirty";
      // ★ 關鍵修正：
      // 後端 auto repair worker 會把 summary_recalc_flags/{yearMonth} 寫回 verified。
      // 只要 flag 已 verified、dirty=false、mismatch=0，就應視為可用 Summary；
      // 不再強制依賴 maintenance_logs 的 compare_summary_with_raw 時間。
      // 否則後端已整理成功時，Dashboard 仍可能因舊 compare log 而卡在「明細暫代顯示」。
      else if (flagVerified) statusKey = "verified";
      else if (!latestCompare || !compareAfterBuild) statusKey = "unverified";
      else if (latestCompare.status === "matched") statusKey = "verified";
      else statusKey = "mismatch";

      const meta = getDashboardSummaryTrustMeta(statusKey);
      return {
        yearMonth: selectedYearMonth,
        statusKey,
        ...meta,
        isTrusted: statusKey === "verified",
        summaryDocs,
        pendingCount: pendingRows.length,
        pendingSources: [...new Set(pendingRows.map((row) => row.sourceType || row.source || "unknown"))],
        recalcFlag: recalcFlag || null,
        recalcFlagStatus: flagStatus || "none",
        recalcFlagRebuildAfterAtText: recalcFlag?.rebuildAfterAtText || "",
        lastDirtyAtText: recalcFlag?.lastDirtyAtText || "",
        lastUpdatedAtText: updatedAtText,
        lastCompareAtText: latestCompare?.createdAtText || flagCompletedAtText || "",
        lastCompareStatus: latestCompare?.status || (flagVerified ? "matched" : "-"),
        lastCompareMismatchCount: latestCompare?.mismatchCount ?? flagMismatchCount,
        checkedAtText: new Date().toISOString(),
      };
    };

    if (!getCollectionPath || !selectedYearMonth) {
      setDashboardSummaryBundle({ dashboard: null, therapist: null, rankings: null, trustStatus: null, ready: true, error: null });
      return () => { cancelled = true; };
    }

    setDashboardSummaryBundle(prev => ({
      ...prev,
      trustStatus: {
        yearMonth: selectedYearMonth,
        statusKey: "loading",
        ...getDashboardSummaryTrustMeta("loading"),
        isTrusted: false,
        checkedAtText: new Date().toISOString(),
      },
      ready: false,
      error: null,
    }));

    const liveState = {
      dashboard: null,
      therapist: null,
      rankings: null,
      summaryDocs: { dashboard: false, therapist: false, rankings: false },
      queueRows: [],
      logRows: [],
      recalcFlag: null,
      loaded: {
        dashboard: false,
        therapist: false,
        rankings: false,
        queue: false,
        logs: false,
        flag: false,
      },
    };

    const publishIfReady = () => {
      if (cancelled) return;
      const isReady = Object.values(liveState.loaded).every(Boolean);
      if (!isReady) return;

      const trustStatus = buildTrustStatus({
        dashboardData: liveState.dashboard || {},
        therapistData: liveState.therapist || {},
        rankingsData: liveState.rankings || {},
        summaryDocs: liveState.summaryDocs,
        queueRows: liveState.queueRows,
        logRows: liveState.logRows,
        recalcFlag: liveState.recalcFlag,
      });

      setDashboardSummaryBundle({
        dashboard: liveState.dashboard,
        therapist: liveState.therapist,
        rankings: liveState.rankings,
        trustStatus,
        ready: true,
        error: null,
      });
    };

    const handleLiveError = (error) => {
      console.warn("Dashboard Summary 即時狀態監聽失敗，將使用明細計算 fallback：", error);
      if (cancelled) return;
      setDashboardSummaryBundle({
        dashboard: null,
        therapist: null,
        rankings: null,
        trustStatus: {
          yearMonth: selectedYearMonth,
          statusKey: "error",
          ...getDashboardSummaryTrustMeta("error"),
          isTrusted: false,
          pendingCount: 0,
          summaryDocs: { dashboard: false, therapist: false, rankings: false },
          checkedAtText: new Date().toISOString(),
        },
        ready: true,
        error,
      });
    };

    try {
      unsubscribers.push(onSnapshot(doc(getCollectionPath("dashboard_summary"), selectedYearMonth), (snap) => {
        liveState.dashboard = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        liveState.summaryDocs.dashboard = snap.exists();
        liveState.loaded.dashboard = true;
        publishIfReady();
      }, handleLiveError));

      unsubscribers.push(onSnapshot(doc(getCollectionPath("therapist_summary"), selectedYearMonth), (snap) => {
        liveState.therapist = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        liveState.summaryDocs.therapist = snap.exists();
        liveState.loaded.therapist = true;
        publishIfReady();
      }, handleLiveError));

      unsubscribers.push(onSnapshot(doc(getCollectionPath("rankings_summary"), selectedYearMonth), (snap) => {
        liveState.rankings = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        liveState.summaryDocs.rankings = snap.exists();
        liveState.loaded.rankings = true;
        publishIfReady();
      }, handleLiveError));

      unsubscribers.push(onSnapshot(query(getCollectionPath("recalc_queue"), where("status", "==", "pending"), limit(500)), (snap) => {
        liveState.queueRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        liveState.loaded.queue = true;
        publishIfReady();
      }, handleLiveError));

      unsubscribers.push(onSnapshot(query(getCollectionPath("maintenance_logs"), where("month", "==", selectedYearMonth), limit(120)), (snap) => {
        liveState.logRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        liveState.loaded.logs = true;
        publishIfReady();
      }, handleLiveError));

      unsubscribers.push(onSnapshot(doc(getCollectionPath("summary_recalc_flags"), selectedYearMonth), (snap) => {
        liveState.recalcFlag = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        liveState.loaded.flag = true;
        publishIfReady();
      }, handleLiveError));
    } catch (error) {
      handleLiveError(error);
    }

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => {
        try { unsubscribe && unsubscribe(); } catch (error) { console.warn("Dashboard Summary listener cleanup failed", error); }
      });
    };
  }, [getCollectionPath, selectedYearMonth, isSelectedCurrentMonth]);

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
    const projectionPayload = buildProjectionFromSummaryStores(stores, daysPassed, daysInMonth);

    grand.hasChallengeCash = Number(grand.challengeBudget || 0) > Number(grand.budget || 0);
    grand.hasChallengeAccrual = Number(grand.challengeAccrualBudget || 0) > Number(grand.accrualBudget || 0);
    grand.projection = projectionPayload.projection || Number(grand.projection || 0);
    grand.accrualProjection = projectionPayload.accrualProjection || Number(grand.accrualProjection || 0);
    grand.projectionRange = projectionPayload.projectionRange || grand.projectionRange || null;

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

    const filteredMonthlyTop = [...stores]
      .sort((a, b) => Number(b.cash || 0) - Number(a.cash || 0))
      .slice(0, 3)
      .map((item) => {
        const core = cleanName(getSummaryStoreName(item));
        return { name: item.displayName || (core ? `${core}店` : ""), revenue: Number(item.cash || 0), streak: false, badgeText: "" };
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
      storeMonthlyTop3: isFilteredSummaryView ? filteredMonthlyTop : mapStoreTop(summary.storeTop3?.monthly),
      storeTodayTop3: mapStoreTop(summary.storeTop3?.today),
      storeYesterdayTop3: mapStoreTop(summary.storeTop3?.yesterday),
      source: preciseFilteredDailyTotals ? "summary_store_daily" : isFilteredSummaryView ? "summary_filtered" : "summary",
      summaryLastUpdatedAtText: summary.lastUpdatedAtText || "",
      summaryFilterMode: isFilteredSummaryView ? (selectedDashboardStore ? "store" : "manager") : "brand",
    };
  }, [dashboardSummaryBundle.dashboard, isSummaryDashboardView, selectedYear, selectedMonth, buildProjectionFromSummaryStores, effectiveStores, selectedDashboardManager, selectedDashboardStore, cleanName, getSummaryStoreName, getSummaryStoreCandidates, normalizeSummaryStores, summaryStoreMatchesSet, userRole]);

  const summaryMyStoreRankings = useMemo(() => {
    // ★ 當月門市排行也必須即時，避免主管或店長看到未更新的 Summary 排名。
    if (isSelectedCurrentMonth || !isSummaryTrustedForDashboard) return null;
    const summary = dashboardSummaryBundle.dashboard;
    if (!summary || userRole !== "store" || !currentUser) return null;

    const rawStores = currentUser.stores || [currentUser.storeName];
    const myCores = rawStores.map(cleanName).filter(Boolean);
    const allRanks = Array.isArray(summary.storeRankings) ? summary.storeRankings : normalizeSummaryStores(summary.stores || []);

    const myCoreSet = new Set(myCores);

    return allRanks
      .filter((s) => summaryStoreMatchesSet(s, myCoreSet))
      .map((s) => {
        const actual = Number(s.cash || 0);
        const target = Number(s.budget || 0);
        const challengeTarget = Number(s.challengeBudget || 0) || target;
        const hasChallenge = challengeTarget > target;
        const rate = target > 0 ? (actual / target) * 100 : 0;
        const challengeRate = challengeTarget > 0 ? (actual / challengeTarget) * 100 : 0;
        return {
          storeName: s.displayName || `${cleanName(getSummaryStoreName(s))}店`,
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
  }, [dashboardSummaryBundle.dashboard, userRole, currentUser, cleanName, getSummaryStoreName, normalizeSummaryStores, summaryStoreMatchesSet, isSelectedCurrentMonth, isSummaryTrustedForDashboard]);

  const summaryTherapistStats = useMemo(() => {
    if (viewMode !== "therapist" && userRole !== "therapist" && userRole !== "trainer") return null;
    // ★ 即時戰情保護：當月人員績效仍用明細計算，避免管理師晚上陸續回報後，今日戰神/排行榜不即時更新。
    if (isSelectedCurrentMonth || !isSummaryTrustedForDashboard) return null;
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
  }, [dashboardSummaryBundle.therapist, therapistEffectiveStores, selectedDashboardManager, selectedDashboardStore, cleanName, userRole, currentUser, therapistAnnualAggregatedData, isSelectedCurrentMonth, isSummaryTrustedForDashboard, viewMode]);


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
        const b = getBudgetDataForStore(fullName, y, m);
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

    return {
      grandTotal: {
        cash: stats.cash, accrual: stats.accrual, operationalAccrual: stats.operationalAccrual, skincareSales: stats.skincareSales, traffic: stats.traffic,
        newCustomers: stats.newCustomers, newCustomerClosings: stats.newCustomerClosings, newCustomerSales: stats.newCustomerSales,
        budget: stats.budget, accrualBudget: stats.accrualBudget, challengeBudget: stats.challengeBudget, challengeAccrualBudget: stats.challengeAccrualBudget, 
        hasChallengeCash: stats.hasChallengeCash, hasChallengeAccrual: stats.hasChallengeAccrual, projection, accrualProjection, projectionRange   
      },
      dailyTotals: slicedDailyTotals,
      totalAchievement: achievement, totalAccrualAchievement: accrualAchievement, challengeAchievement, challengeAccrualAchievement, 
      avgTrafficASP, avgNewCustomerASP, daysPassed, daysInMonth, newRevMix, oldRevMix, newCountMix, oldCountMix,
      storeMonthlyTop3, storeTodayTop3, storeYesterdayTop3 
    };
  // ★ 監視清單換成了包含全部小抄的字典
  }, [allReports, getBudgetDataForStore, selectedYear, selectedMonth, effectiveStores, brandPrefix, cleanName, getProjectionCurveForStore]);

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
      const budgetData = getBudgetDataForStore(storeName, y, m);
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
  }, [allReports, effectiveStores, getBudgetDataForStore, selectedYear, selectedMonth, cleanName, brandPrefix]);

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
    groupedStoresForFilter, availableStoresForDropdown
  };
}