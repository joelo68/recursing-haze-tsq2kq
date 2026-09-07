// src/hooks/useDashboardStats.js
import { useState, useMemo, useContext, useEffect } from 'react';
import { AppContext } from '../AppContext';
import { sortManagerNames, sortStoreNames, sortManagersByOrgOrder, sortStoresByOrgOrder } from "../utils/helpers";
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { KPI_VALUE_STATUS, formalNetCash } from '../utils/kpiContracts.js';
import {
  DASHBOARD_LIVE_RANKING_SEMANTICS,
  buildDashboardLiveRanking,
} from '../utils/dashboardLiveRanking.js';
import {
  PROJECTION_MODEL_DOC_ID,
  buildDashboardProjectionFromModel,
  buildProjectionLifecycleEntryMap,
  inspectProjectionModelTrust,
} from '../utils/projectionModelConsumer.js';
import {
  buildCurrentDetailFormalAuthority,
  buildCurrentDetailFormalScope,
} from '../utils/currentDetailFormalConsumer.js';
import { buildHistoricalFormalDashboardScope, isFormalDashboardSummaryCompatible } from '../utils/dashboardFormalConsumer.js';
import {
  buildCurrentStoreSelfViewScope,
  buildHistoricalStoreSelfViewScope,
  buildStoreSelfViewProfile,
  filterDashboardStorePresentationKeys,
} from '../utils/storeSelfView.js';
import { applyTherapistRankingSemantics, buildTherapistAggregateMetrics } from '../utils/therapistKpi.js';
import { getSummaryRecalcFlagState, resolveHistoricalDashboardReadPolicy } from '../utils/dashboardReadPolicy.js';
import { inspectHistoricalReportingCalendarTrust } from '../utils/storeLifecycle.js';
import {
  filterSystemExcludedStoreKeys,
  inspectHistoricalSystemExclusionTrust,
  isSystemExclusionSnapshotCurrent,
} from '../utils/systemExclusion.js';
import {
  ANNUAL_KPI_SUMMARY_SCHEMA_VERSION,
  buildAnnualKpiBenchmarkScope,
  makeEmptyAnnualKpiBenchmark,
  normalizeAnnualKpiBenchmarkPayload,
} from '../utils/annualKpiBenchmark.js';

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

export function useDashboardStats() {
  const { 
    targets, userRole, currentUser, 
    allReports, monthlyTargetSummary, currentLifecycleMasterState, managers, managerOrder = [], selectedYear, selectedMonth, therapistReports,
    currentBrand, therapists, dailyLoginCount, yesterdayLoginCount,
    therapistAnnualAggregatedData, getCollectionPath, historicalDetailRefreshState,
    currentDashboardSummary, currentRankingsSummary, currentReportSummaryReady,
    currentReportSummaryReadyYearMonth, currentReportSummaryReadyBrandId, currentSummaryRecalcFlagState,
    systemExclusionState, therapistModuleEnabled,
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
    const systemExclusionTrust = inspectHistoricalSystemExclusionTrust({
      currentState: systemExclusionState,
      brandId: brandInfo?.id,
      summaries: [currentDashboardSummary, currentRankingsSummary],
      summaryFlag: currentSummaryRecalcFlagState?.data || null,
    });
    const reportingCalendarTrust = inspectHistoricalReportingCalendarTrust({
      currentLifecycleMasterState,
      dashboardSummary: currentDashboardSummary,
      summaryFlag: currentSummaryRecalcFlagState?.data || null,
      brandId: brandInfo?.id,
    });

    return resolveHistoricalDashboardReadPolicy({
      isCurrentMonth,
      historicalRefreshRequested,
      reportSummaryReady: reportSummaryReadyForMonth,
      hasUsableDashboardSummary,
      summaryFlagReady: summaryFlagReadyForMonth,
      summaryFlag: currentSummaryRecalcFlagState?.data || null,
      summaryFlagError: currentSummaryRecalcFlagState?.error || null,
      systemExclusionTrusted: systemExclusionTrust.trusted,
      systemExclusionReason: systemExclusionTrust.reason,
      reportingCalendarTrusted: reportingCalendarTrust.trusted,
      reportingCalendarReason: reportingCalendarTrust.reason,
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
    systemExclusionState,
    currentLifecycleMasterState,
    brandInfo?.id,
  ]);

  // Batch 8B：Dashboard Projection 改讀 Backend-owned 單一 Projection Model authority。
  // Current-month Dashboard 每次品牌/月份 activation 最多 1 個 point read；不新增 listener / polling。
  const [projectionModelState, setProjectionModelState] = useState({
    brandId: "",
    modelMonth: "",
    ready: false,
    data: null,
    error: null,
  });


  const [annualKpiBenchmark, setAnnualKpiBenchmark] = useState({
    ready: false,
    source: "idle",
    schemaVersion: "",
    metrics: {},
    stores: {},
    benchmarkScopeByMonth: {},
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
        setAnnualKpiBenchmark(makeEmptyAnnualKpiBenchmark({}, "not_available"));
        return;
      }

      const cacheKey = `cyj_annual_kpi_summary_v6_${brandId}_${year}`;
      const cacheTtlMs = 60 * 60 * 1000;

      try {
        if (typeof sessionStorage !== "undefined") {
          const cachedRaw = sessionStorage.getItem(cacheKey);
          if (cachedRaw) {
            const cached = JSON.parse(cachedRaw);
            if (cached?.cachedAt && Date.now() - Number(cached.cachedAt) < cacheTtlMs) {
              setAnnualKpiBenchmark({
                ...normalizeAnnualKpiBenchmarkPayload(cached),
                ready: true,
                source: "session_cache",
                error: null,
              });
              return;
            }
          }
        }
      } catch (error) {
        // 快取失敗不影響 Dashboard，改讀 Firestore 單一年度摘要 doc。
      }

      setAnnualKpiBenchmark((prev) => ({
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
          setAnnualKpiBenchmark(makeEmptyAnnualKpiBenchmark({}, "missing"));
          return;
        }

        const data = snap.data() || {};
        const payload = {
          ...normalizeAnnualKpiBenchmarkPayload(data),
          ready: true,
          source: "annual_kpi_summary",
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
          ...makeEmptyAnnualKpiBenchmark({}, "error"),
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
    let sourceStores = [];

    if (userRole === 'director' || userRole === 'trainer' || userRole === 'therapist' || userRole === 'master') {
      sourceStores = Object.values(managers || {}).flat();
    } else if ((userRole === 'manager' || userRole === 'store') && currentUser) {
      const delegatedAwareStores = (
        hasDelegationAccessProfile
          ? operationAccessibleStores
          : (accessibleStores || [])
      );

      if (delegatedAwareStores.length > 0) {
        sourceStores = delegatedAwareStores;
      } else if (userRole === 'manager') {
        // 代理資料尚未完成載入時，保留原正式權限；System Exclusion 仍必須套用。
        sourceStores = managers[currentUser.name] || [];
      } else {
        sourceStores = currentUser.stores || [currentUser.storeName];
      }
    }

    return filterDashboardStorePresentationKeys({
      values: sourceStores,
      userRole,
      officialStores,
      systemExclusionState,
      normalizeStoreKey: cleanName,
    });
  }, [
    userRole,
    currentUser,
    managers,
    accessibleStores,
    officialStores,
    operationAccessibleStores,
    hasDelegationAccessProfile,
    systemExclusionState,
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

  useEffect(() => {
    if (selectedDashboardStore && !availableStoresForFilter.includes(selectedDashboardStore)) {
      setSelectedDashboardStore("");
    }
  }, [selectedDashboardStore, availableStoresForFilter]);

  useEffect(() => {
    if (selectedDashboardManager && !groupedStoresForFilter[selectedDashboardManager]) {
      setSelectedDashboardManager("");
      setSelectedDashboardStore("");
    }
  }, [selectedDashboardManager, groupedStoresForFilter]);

  const effectiveStores = useMemo(() => {
    const filterPresentationStores = (values = []) => filterDashboardStorePresentationKeys({
      values,
      userRole,
      officialStores,
      systemExclusionState,
      normalizeStoreKey: cleanName,
    });

    if (selectedDashboardStore) {
      return filterPresentationStores([selectedDashboardStore]);
    }

    if (selectedDashboardManager) {
      return filterSystemExcludedStoreKeys(
        managers[selectedDashboardManager] || [],
        systemExclusionState,
        cleanName
      );
    }

    if (userRole === "store") {
      const normalizedOfficialStores = filterPresentationStores(officialStores);
      const formalOfficialStores = filterSystemExcludedStoreKeys(
        officialStores,
        systemExclusionState,
        cleanName
      );
      const formalBaseStores = filterSystemExcludedStoreKeys(
        baseVisibleStores,
        systemExclusionState,
        cleanName
      );
      // 若此 store account 的所有正式 own stores 都已被 System Excluded，
      // 預設仍回到 own-store self-view；暫時托管的 Formal 店家不能蓋過帳號本身的店。
      // 若 officialStores 同時包含 Formal + excluded，則預設維持 Formal aggregate，
      // excluded own store 仍可由下拉選單個別切入 self-view。
      if (normalizedOfficialStores.length > 0 && formalOfficialStores.length === 0) {
        return normalizedOfficialStores;
      }
      return formalBaseStores;
    }

    return baseVisibleStores;
  }, [
    baseVisibleStores,
    selectedDashboardStore,
    selectedDashboardManager,
    managers,
    userRole,
    officialStores,
    systemExclusionState,
    cleanName,
  ]);

  const storeSelfViewProfile = useMemo(() => buildStoreSelfViewProfile({
    userRole,
    scopeStoreKeys: effectiveStores,
    officialStores,
    systemExclusionState,
    normalizeStoreKey: cleanName,
  }), [
    userRole,
    effectiveStores,
    officialStores,
    systemExclusionState,
    cleanName,
  ]);

  const storeSelfViewActive = storeSelfViewProfile.active === true;

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
    if (storeSelfViewActive && userRole === "store") {
      return [...new Set((effectiveStores || []).map(cleanName).filter(Boolean))];
    }

    const excluded = systemExclusionState?.ready === true
      ? new Set((systemExclusionState.stores || []).map(cleanName).filter(Boolean))
      : new Set();
    const filterFormalStores = (values = []) => values.map(cleanName).filter((storeCore) => storeCore && !excluded.has(storeCore));
    if (selectedDashboardStore) return filterFormalStores([selectedDashboardStore]);
    if (selectedDashboardManager && managers[selectedDashboardManager]) {
        return filterFormalStores(managers[selectedDashboardManager]);
    }
    return filterFormalStores(allCompanyStores);
  }, [selectedDashboardStore, selectedDashboardManager, managers, allCompanyStores, cleanName, systemExclusionState, storeSelfViewActive, userRole, effectiveStores]);

  const effectiveAnnualKpiBenchmark = useMemo(() => {
    const base = annualKpiBenchmark || {};
    if (!base.ready) return base;

    const expectedBrandId = String(brandInfo?.id || "").trim().toLowerCase();
    if (base.schemaVersion === ANNUAL_KPI_SUMMARY_SCHEMA_VERSION) {
      const lifecycleBrandId = String(currentLifecycleMasterState?.brandId || "").trim().toLowerCase();
      const lifecycleReady = currentLifecycleMasterState?.ready === true
        && lifecycleBrandId === expectedBrandId
        && String(currentLifecycleMasterState?.data?.datasetStatus || "") === "READY";
      const lifecycleRevisionCurrent = lifecycleReady
        && Number(base.lifecycleRevision) === Number(currentLifecycleMasterState?.data?.revision);
      const currentCalendarMonthRevisions = (
        currentLifecycleMasterState?.data?.reportingCalendar?.monthRevisions
        && typeof currentLifecycleMasterState.data.reportingCalendar.monthRevisions === "object"
      )
        ? currentLifecycleMasterState.data.reportingCalendar.monthRevisions
        : {};
      const benchmarkCalendarMonthRevisions = (
        base.reportingCalendarMonthRevisions
        && typeof base.reportingCalendarMonthRevisions === "object"
      )
        ? base.reportingCalendarMonthRevisions
        : {};
      const benchmarkCandidateMonths = Array.isArray(base.candidateMonths)
        ? base.candidateMonths
        : [];
      const reportingCalendarRevisionCurrent = lifecycleReady
        && benchmarkCandidateMonths.every((yearMonth) => (
          Number(benchmarkCalendarMonthRevisions?.[yearMonth] || 0)
          === Number(currentCalendarMonthRevisions?.[yearMonth] || 0)
        ));
      const systemExclusionCurrent = isSystemExclusionSnapshotCurrent({
        snapshot: base.systemExclusionSnapshot || null,
        currentState: systemExclusionState,
        brandId: expectedBrandId,
      });

      if (!lifecycleRevisionCurrent || !reportingCalendarRevisionCurrent || !systemExclusionCurrent) {
        return {
          ...makeEmptyAnnualKpiBenchmark(base, "authority_stale"),
          scope: "authority_stale",
          authorityReason: !lifecycleRevisionCurrent
            ? "LIFECYCLE_REVISION_MISMATCH"
            : (!reportingCalendarRevisionCurrent
              ? "REPORTING_CALENDAR_REVISION_MISMATCH"
              : "SYSTEM_EXCLUSION_REVISION_MISMATCH"),
        };
      }
    }

    if (storeSelfViewActive) {
      return {
        ...makeEmptyAnnualKpiBenchmark(base, "store_self_view_excluded"),
        scope: "store_self_view_excluded",
        scopeStoreCount: storeSelfViewProfile.scopeStoreKeys.length,
      };
    }

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
    if (selectedStoreCores.length === 0) {
      return {
        ...makeEmptyAnnualKpiBenchmark(base, "filtered_empty_scope"),
        scope: "filtered_empty_scope",
        scopeStoreCount: 0,
      };
    }

    return buildAnnualKpiBenchmarkScope({
      payload: base,
      selectedStoreCores,
      normalizeStoreKey: cleanName,
    });
  }, [
    annualKpiBenchmark,
    selectedDashboardStore,
    selectedDashboardManager,
    userRole,
    effectiveStores,
    cleanName,
    brandInfo,
    storeSelfViewActive,
    storeSelfViewProfile.scopeStoreKeys,
    currentLifecycleMasterState,
    systemExclusionState,
  ]);

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

  useEffect(() => {
    const brandId = String(brandInfo?.id || "").toLowerCase();
    if (!getCollectionPath || !selectedYearMonth || !isSelectedCurrentMonth || !brandId) {
      setProjectionModelState({
        brandId,
        modelMonth: selectedYearMonth,
        ready: true,
        data: null,
        error: null,
      });
      return undefined;
    }

    let cancelled = false;
    setProjectionModelState({
      brandId,
      modelMonth: selectedYearMonth,
      ready: false,
      data: null,
      error: null,
    });

    const loadProjectionModel = async () => {
      try {
        const modelRef = doc(getCollectionPath("projection_models"), PROJECTION_MODEL_DOC_ID);
        const snap = await getDoc(modelRef);
        if (cancelled) return;
        setProjectionModelState({
          brandId,
          modelMonth: selectedYearMonth,
          ready: true,
          data: snap.exists() ? { id: snap.id, ...snap.data() } : null,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        console.warn("Dashboard Projection Model 讀取失敗，改用本月節奏 fallback：", error);
        setProjectionModelState({
          brandId,
          modelMonth: selectedYearMonth,
          ready: true,
          data: null,
          error,
        });
      }
    };

    loadProjectionModel();
    return () => { cancelled = true; };
  }, [getCollectionPath, selectedYearMonth, isSelectedCurrentMonth, brandInfo?.id]);

  const projectionLifecycleMaster = useMemo(() => {
    const brandId = String(brandInfo?.id || "").toLowerCase();
    const lifecycleBrandId = String(currentLifecycleMasterState?.brandId || "").toLowerCase();
    if (
      currentLifecycleMasterState?.ready !== true ||
      lifecycleBrandId !== brandId ||
      !currentLifecycleMasterState?.data
    ) {
      return null;
    }
    return currentLifecycleMasterState.data;
  }, [currentLifecycleMasterState, brandInfo?.id]);

  const projectionModelTrust = useMemo(() => inspectProjectionModelTrust({
    model: (
      projectionModelState?.ready === true &&
      projectionModelState?.brandId === String(brandInfo?.id || "").toLowerCase() &&
      projectionModelState?.modelMonth === selectedYearMonth
    ) ? projectionModelState.data : null,
    brandId: brandInfo?.id || "",
    modelMonth: selectedYearMonth,
    lifecycleMaster: projectionLifecycleMaster,
    systemExclusionState,
  }), [
    projectionModelState,
    brandInfo?.id,
    selectedYearMonth,
    projectionLifecycleMaster,
    systemExclusionState,
  ]);

  const projectionLifecycleEntryMap = useMemo(() => buildProjectionLifecycleEntryMap({
    lifecycleMaster: projectionLifecycleMaster,
    brandId: brandInfo?.id || "",
    yearMonth: selectedYearMonth,
    normalizeStoreKey: cleanName,
  }), [projectionLifecycleMaster, brandInfo?.id, selectedYearMonth, cleanName]);

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
      systemExclusionState,
      normalizeStoreKey: cleanName,
    });
  }, [
    currentLifecycleMasterState,
    brandInfo?.id,
    selectedYearMonth,
    monthlyTargetSummary,
    allReports,
    systemExclusionState,
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
      exclusion_stale: {
        label: "排除設定已更新",
        tone: "amber",
        hint: "此月份 Summary 使用舊版排除設定，已暫停信任並改用明細資料等待重算。",
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
    const systemExclusionTrust = inspectHistoricalSystemExclusionTrust({
      currentState: systemExclusionState,
      brandId: brandInfo?.id,
      summaries: [
        dashboardMatchesMonth ? currentDashboardSummary : null,
        rankingsMatchesMonth ? currentRankingsSummary : null,
      ],
      summaryFlag: recalcFlag,
    });

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
    else if (!systemExclusionTrust.trusted) statusKey = "exclusion_stale";
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
        systemExclusionTrustReason: systemExclusionTrust.reason,
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
    systemExclusionState,
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

    const stores = shouldFilterSummaryStores
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

    const isFilteredSummaryView = shouldFilterSummaryStores;
    const summaryGrand = summary.grandTotal || {};
    const grand = isFilteredSummaryView ? aggregateGrandFromStores(stores) : { ...summaryGrand };

    // Batch 5A-1：歷史 verified Summary 必須正式切到 Batch 4 Formal KPI contract。
    // 若 Summary schema 尚未升級，直接回到既有 detail fallback，不以 legacy 欄位冒充 Formal。
    if (!isFormalDashboardSummaryCompatible(summary)) return null;

    const selfViewScope = storeSelfViewActive
      ? buildHistoricalStoreSelfViewScope({
          summaryRows: stores,
          scopeStoreKeys: effectiveStores,
          monthlyTargetSummary,
          brandId: brandInfo?.id || "",
          yearMonth: selectedYearMonth,
          normalizeStoreKey: cleanName,
        })
      : null;
    const formalScope = storeSelfViewActive
      ? null
      : buildHistoricalFormalDashboardScope({
          summary,
          stores,
          monthlyTargetSummary,
          normalizeStoreKey: cleanName,
          filtered: isFilteredSummaryView,
        });
    if (!storeSelfViewActive && !formalScope?.compatible) return null;

    const legacyGrand = {
      cash: grand.cash,
      accrual: grand.accrual,
      budget: grand.budget,
      accrualBudget: grand.accrualBudget,
    };

    // Store self-view 與 Formal aggregation eligibility 是兩個不同概念：
    // 被 System Excluded 的店家自己的 store account 仍可使用 Summary 內既有 explicit KPI 欄位查看自己，
    // 但這個 scope 不具 Formal aggregate / ranking / annual benchmark authority。
    const activeScope = storeSelfViewActive ? {
      cash: selfViewScope?.cash?.value ?? null,
      cashStatus: selfViewScope?.cash?.status || KPI_VALUE_STATUS.FIELD_MISSING,
      accrual: selfViewScope?.accrual?.value ?? null,
      accrualStatus: selfViewScope?.accrual?.status || KPI_VALUE_STATUS.FIELD_MISSING,
      cashTarget: selfViewScope?.cashTarget?.value ?? null,
      cashTargetStatus: selfViewScope?.cashTarget?.status || "TARGET_INCOMPLETE",
      accrualTarget: selfViewScope?.accrualTarget?.value ?? null,
      accrualTargetStatus: selfViewScope?.accrualTarget?.status || "TARGET_INCOMPLETE",
      cashAchievement: selfViewScope?.cashAchievement?.value ?? null,
      cashAchievementStatus: selfViewScope?.cashAchievement?.status || KPI_VALUE_STATUS.N_A,
      accrualAchievement: selfViewScope?.accrualAchievement?.value ?? null,
      accrualAchievementStatus: selfViewScope?.accrualAchievement?.status || KPI_VALUE_STATUS.N_A,
      challengeCashTarget: selfViewScope?.challengeCashTarget?.value ?? null,
      challengeAccrualTarget: selfViewScope?.challengeAccrualTarget?.value ?? null,
      challengeCashConfigured: selfViewScope?.challengeCashTarget?.configured === true,
      challengeAccrualConfigured: selfViewScope?.challengeAccrualTarget?.configured === true,
      challengeCashAchievement: selfViewScope?.challengeCashAchievement?.value ?? null,
      challengeAccrualAchievement: selfViewScope?.challengeAccrualAchievement?.value ?? null,
      reportingStatus: selfViewScope?.reportingStatus || "DATA_COMPLETE",
      scopeEligibleStoreCount: selfViewScope?.scopeStoreKeys?.length || 0,
      targetSummaryAvailable: selfViewScope?.targetSummaryAvailable === true,
      lifecycleReady: true,
    } : formalScope;

    // 對既有 Dashboard view-model 做 compatibility mapping。
    grand.legacyCash = legacyGrand.cash;
    grand.legacyAccrual = legacyGrand.accrual;
    grand.legacyBudget = legacyGrand.budget;
    grand.legacyAccrualBudget = legacyGrand.accrualBudget;
    grand.cash = activeScope.cash;
    grand.accrual = activeScope.accrual;
    grand.budget = activeScope.cashTarget;
    grand.accrualBudget = activeScope.accrualTarget;
    grand.formalNetCash = activeScope.cash;
    grand.formalNetCashStatus = activeScope.cashStatus;
    grand.formalAccrual = activeScope.accrual;
    grand.formalAccrualStatus = activeScope.accrualStatus;
    grand.formalCashTarget = activeScope.cashTarget;
    grand.formalCashTargetStatus = activeScope.cashTargetStatus;
    grand.formalAccrualTarget = activeScope.accrualTarget;
    grand.formalAccrualTargetStatus = activeScope.accrualTargetStatus;
    grand.formalCashAchievement = activeScope.cashAchievement;
    grand.formalCashAchievementStatus = activeScope.cashAchievementStatus;
    grand.formalAccrualAchievement = activeScope.accrualAchievement;
    grand.formalAccrualAchievementStatus = activeScope.accrualAchievementStatus;
    grand.formalConsumerActive = !storeSelfViewActive;

    if (storeSelfViewActive) {
      grand.challengeBudget = activeScope.challengeCashTarget;
      grand.challengeAccrualBudget = activeScope.challengeAccrualTarget;
      grand.hasChallengeCash = activeScope.challengeCashConfigured;
      grand.hasChallengeAccrual = activeScope.challengeAccrualConfigured;
    } else {
      // Challenge 仍是 compatibility layer；不把 legacy challenge 欄位假裝成 Formal contract。
      grand.hasChallengeCash = Number.isFinite(formalScope.cashTarget) && Number(grand.challengeBudget || 0) > formalScope.cashTarget;
      grand.hasChallengeAccrual = Number.isFinite(formalScope.accrualTarget) && Number(grand.challengeAccrualBudget || 0) > formalScope.accrualTarget;
    }

    // 歷史月份已結算：Formal scope 用 Formal actual；self-view 則使用該店 canonical KPI actual。
    const cashProjection = Number.isFinite(activeScope.cash) ? activeScope.cash : null;
    const accrualProjection = Number.isFinite(activeScope.accrual) ? activeScope.accrual : null;
    grand.projection = cashProjection;
    grand.accrualProjection = accrualProjection;
    grand.projectionRange = {
      cash: cashProjection === null ? null : { conservative: cashProjection, standard: cashProjection, aggressive: cashProjection, min: cashProjection, max: cashProjection },
      accrual: accrualProjection === null ? null : { conservative: accrualProjection, standard: accrualProjection, aggressive: accrualProjection, min: accrualProjection, max: accrualProjection },
      profile: {
        currentWeight: 1,
        historyWeight: 0,
        label: storeSelfViewActive ? "歷史結算：自店檢視" : "歷史結算：Formal 實績",
      },
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

    const totalAchievement = activeScope.cashAchievement;
    const totalAccrualAchievement = activeScope.accrualAchievement;
    const challengeAchievement = storeSelfViewActive
      ? activeScope.challengeCashAchievement
      : (Number.isFinite(formalScope.cash) && Number(grand.challengeBudget || 0) > 0
          ? (formalScope.cash / Number(grand.challengeBudget)) * 100
          : 0);
    const challengeAccrualAchievement = storeSelfViewActive
      ? activeScope.challengeAccrualAchievement
      : (Number.isFinite(formalScope.accrual) && Number(grand.challengeAccrualBudget || 0) > 0
          ? (formalScope.accrual / Number(grand.challengeAccrualBudget)) * 100
          : 0);

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
      storeMonthlyTop3: storeSelfViewActive ? [] : formalMonthlyTop,
      storeTodayTop3: storeSelfViewActive ? [] : mapStoreTop(summary.storeTop3?.today),
      storeYesterdayTop3: storeSelfViewActive ? [] : mapStoreTop(summary.storeTop3?.yesterday),
      source: storeSelfViewActive
        ? "summary_store_self_view"
        : (preciseFilteredDailyTotals ? "summary_store_daily" : isFilteredSummaryView ? "summary_filtered" : "summary"),
      summaryLastUpdatedAtText: summary.lastUpdatedAtText || "",
      summaryFilterMode: storeSelfViewActive
        ? "store_self_view"
        : (isFilteredSummaryView ? (selectedDashboardStore ? "store" : "manager") : "brand"),
      formalConsumerActive: !storeSelfViewActive,
      storeSelfViewActive,
      excludedFromFormalScope: storeSelfViewActive,
      formalKpiStatus: {
        cash: activeScope.cashStatus,
        cashTarget: activeScope.cashTargetStatus,
        cashAchievement: activeScope.cashAchievementStatus,
        accrual: activeScope.accrualStatus,
        accrualTarget: activeScope.accrualTargetStatus,
        accrualAchievement: activeScope.accrualAchievementStatus,
        reportingStatus: activeScope.reportingStatus,
        cashCoverageComplete: storeSelfViewActive ? null : formalScope.cashCoverageComplete,
        accrualCoverageComplete: storeSelfViewActive ? null : formalScope.accrualCoverageComplete,
        lifecycleReady: activeScope.lifecycleReady,
        scopeEligibleStoreCount: storeSelfViewActive ? 0 : formalScope.scopeEligibleStoreCount,
        selfViewStoreCount: storeSelfViewActive ? activeScope.scopeEligibleStoreCount : 0,
        targetSummaryAvailable: activeScope.targetSummaryAvailable,
      },
    };
  }, [dashboardSummaryBundle.dashboard, isSummaryDashboardView, selectedYear, selectedMonth, selectedYearMonth, effectiveStores, selectedDashboardManager, selectedDashboardStore, cleanName, getSummaryStoreName, getSummaryStoreCandidates, normalizeSummaryStores, summaryStoreMatchesSet, userRole, monthlyTargetSummary, storeSelfViewActive, brandInfo?.id]);

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
    // Excluded own-store self-view 不信任 therapist_summary 的 Formal exclusion scope；
    // Dashboard 人員模式沿用既有 therapist detail read path，只限自己的 effectiveStores。
    if (storeSelfViewActive && userRole === "store") return null;
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
    if (useFilter) {
      rankings = rankings.filter((item) => selectedStores.has(cleanName(item.store || item.storeDisplay || "")));
    }

    rankings = applyTherapistRankingSemantics(rankings.map((item) => ({
      ...item,
      storeDisplay: item.storeDisplay || normalizeStoreDisplay(item.store),
    })));

    const myStats = userRole === "therapist"
      ? rankings.find((item) => item.id === currentUser?.id || item.name === currentUser?.name) || null
      : null;

    const grandTotal = buildTherapistAggregateMetrics(rankings);

    const filterTopRows = (rows = []) => {
      const list = Array.isArray(rows) ? rows : [];
      if (!useFilter) return list;
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
  }, [dashboardSummaryBundle.therapist, therapistEffectiveStores, selectedDashboardManager, selectedDashboardStore, cleanName, userRole, currentUser, therapistAnnualAggregatedData, isSelectedCurrentMonth, isSummaryTrustedForDashboard, viewMode, storeSelfViewActive]);


  const detailDashboardStats = useMemo(() => {
    if (!allReports) return null;
    if (!currentDetailFormalScope.compatible) return null;
    const formalScopeStoreKeySet = new Set(currentDetailFormalScope.scopeStoreKeys || []);
    const formalBrandStoreKeySet = new Set(currentDetailFormalAuthority.eligibleStoreKeys || []);
    const currentSelfViewScope = storeSelfViewActive
      ? buildCurrentStoreSelfViewScope({
          reports: allReports,
          brandId: brandInfo?.id || "",
          yearMonth: selectedYearMonth,
          scopeStoreKeys: effectiveStores,
          monthlyTargetSummary,
          normalizeStoreKey: cleanName,
        })
      : null;
    const calculationStoreKeySet = storeSelfViewActive
      ? new Set((effectiveStores || []).map(cleanName).filter(Boolean))
      : formalScopeStoreKeySet;
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
      if (!calculationStoreKeySet.has(reportStoreClean)) return;

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

    // Formal aggregate eligibility 與 store self-view visibility 分離。
    // store role 的 own excluded store 只在自己的 Dashboard 走 canonical KPI self-view；
    // Ranking / Regional / Annual / Target Coverage 仍沿用既有 Formal scope。
    const activeDetailScope = storeSelfViewActive ? {
      cash: currentSelfViewScope?.cash?.value ?? null,
      cashStatus: currentSelfViewScope?.cash?.status || KPI_VALUE_STATUS.FIELD_MISSING,
      accrual: currentSelfViewScope?.accrual?.value ?? null,
      accrualStatus: currentSelfViewScope?.accrual?.status || KPI_VALUE_STATUS.FIELD_MISSING,
      cashTarget: currentSelfViewScope?.cashTarget?.value ?? null,
      cashTargetStatus: currentSelfViewScope?.cashTarget?.status || "TARGET_INCOMPLETE",
      accrualTarget: currentSelfViewScope?.accrualTarget?.value ?? null,
      accrualTargetStatus: currentSelfViewScope?.accrualTarget?.status || "TARGET_INCOMPLETE",
      challengeCashTarget: currentSelfViewScope?.challengeCashTarget?.value ?? null,
      challengeAccrualTarget: currentSelfViewScope?.challengeAccrualTarget?.value ?? null,
      challengeCashConfigured: currentSelfViewScope?.challengeCashTarget?.configured === true,
      challengeAccrualConfigured: currentSelfViewScope?.challengeAccrualTarget?.configured === true,
      cashAchievement: currentSelfViewScope?.cashAchievement?.value ?? null,
      cashAchievementStatus: currentSelfViewScope?.cashAchievement?.status || KPI_VALUE_STATUS.N_A,
      accrualAchievement: currentSelfViewScope?.accrualAchievement?.value ?? null,
      accrualAchievementStatus: currentSelfViewScope?.accrualAchievement?.status || KPI_VALUE_STATUS.N_A,
      challengeCashAchievement: currentSelfViewScope?.challengeCashAchievement?.value ?? null,
      challengeAccrualAchievement: currentSelfViewScope?.challengeAccrualAchievement?.value ?? null,
      reportingStatus: currentSelfViewScope?.reportDocumentCount > 0 ? "SELF_VIEW" : "DATA_INCOMPLETE",
      targetSummaryAvailable: currentSelfViewScope?.targetSummaryAvailable === true,
      lifecycleReady: true,
      scopeEligibleStoreCount: 0,
    } : currentDetailFormalScope;

    const achievement = activeDetailScope.cashAchievement;
    const accrualAchievement = activeDetailScope.accrualAchievement;
    const challengeAchievement = activeDetailScope.challengeCashAchievement;
    const challengeAccrualAchievement = activeDetailScope.challengeAccrualAchievement;

 // ============================================================================
    // ★ Batch 8B — Projection Model Authority consumer
    //    - Historical weekday baseline only from projection_models/current.
    //    - Current actual stays on Current Detail Formal authority.
    //    - Store Lifecycle / Reporting Calendar decides future operating dates.
    //    - Missing/stale model falls back to current pace; no legacy curve read.
    // ============================================================================
    const projectionRows = Object.keys(storeStatsMap).map((storeName) => {
      const storeKey = cleanName(storeName);
      const sStats = storeStatsMap[storeName] || {};
      const formalRow = currentDetailFormalAuthority?.stores?.[storeKey] || null;
      return {
        storeKey,
        cash: storeSelfViewActive ? sStats.cash : formalRow?.formalNetCash,
        accrual: storeSelfViewActive ? sStats.accrual : formalRow?.formalAccrual,
        lifecycleEntry: formalRow?.lifecycleEntry || projectionLifecycleEntryMap.get(storeKey) || null,
        selfViewExcluded: storeSelfViewActive === true,
      };
    });

    const projectionResult = buildDashboardProjectionFromModel({
      rows: projectionRows,
      model: projectionModelTrust.trusted ? projectionModelState.data : null,
      modelTrusted: projectionModelTrust.trusted === true,
      yearMonth: selectedYearMonth,
      daysPassed,
      daysInMonth,
      normalizeStoreKey: cleanName,
      // System Excluded own-store self-view may see its own actual, but must not
      // consume brand-level historical baseline that could leak aggregate scope.
      allowBrandFallbackForRow: (row) => row?.selfViewExcluded !== true,
    });
    const projection = projectionResult.projection;
    const accrualProjection = projectionResult.accrualProjection;
    const projectionRange = {
      ...projectionResult.projectionRange,
      modelTrust: {
        trusted: projectionModelTrust.trusted === true,
        reason: projectionModelTrust.reason || "",
      },
    };

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

    const activeCashAvailable = isFiniteKpiNumber(activeDetailScope.cash);
    const activeAccrualAvailable = isFiniteKpiNumber(activeDetailScope.accrual);
    const activeProjection = activeCashAvailable ? projection : null;
    const activeAccrualProjection = activeAccrualAvailable ? accrualProjection : null;
    const activeProjectionRange = {
      ...projectionRange,
      cash: activeCashAvailable ? projectionRange.cash : null,
      accrual: activeAccrualAvailable ? projectionRange.accrual : null,
    };

    return {
      grandTotal: {
        cash: activeDetailScope.cash,
        accrual: activeDetailScope.accrual,
        operationalAccrual: stats.operationalAccrual,
        skincareSales: stats.skincareSales,
        traffic: stats.traffic,
        newCustomers: stats.newCustomers,
        newCustomerClosings: stats.newCustomerClosings,
        newCustomerSales: stats.newCustomerSales,
        budget: activeDetailScope.cashTarget,
        accrualBudget: activeDetailScope.accrualTarget,
        challengeBudget: activeDetailScope.challengeCashTarget,
        challengeAccrualBudget: activeDetailScope.challengeAccrualTarget,
        hasChallengeCash: activeDetailScope.challengeCashConfigured === true,
        hasChallengeAccrual: activeDetailScope.challengeAccrualConfigured === true,
        projection: activeProjection,
        accrualProjection: activeAccrualProjection,
        projectionRange: activeProjectionRange,
        formalNetCash: activeDetailScope.cash,
        formalNetCashStatus: activeDetailScope.cashStatus,
        formalAccrual: activeDetailScope.accrual,
        formalAccrualStatus: activeDetailScope.accrualStatus,
        formalCashTarget: activeDetailScope.cashTarget,
        formalCashTargetStatus: activeDetailScope.cashTargetStatus,
        formalAccrualTarget: activeDetailScope.accrualTarget,
        formalAccrualTargetStatus: activeDetailScope.accrualTargetStatus,
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
      storeMonthlyTop3: storeSelfViewActive ? [] : storeMonthlyTop3,
      storeTodayTop3: storeSelfViewActive ? [] : storeTodayTop3,
      storeYesterdayTop3: storeSelfViewActive ? [] : storeYesterdayTop3,
      source: storeSelfViewActive ? "detail_store_self_view" : "detail_formal",
      formalConsumerActive: !storeSelfViewActive,
      storeSelfViewActive,
      excludedFromFormalScope: storeSelfViewActive,
      formalKpiStatus: {
        cash: activeDetailScope.cashStatus,
        cashTarget: activeDetailScope.cashTargetStatus,
        cashAchievement: activeDetailScope.cashAchievementStatus,
        accrual: activeDetailScope.accrualStatus,
        accrualTarget: activeDetailScope.accrualTargetStatus,
        accrualAchievement: activeDetailScope.accrualAchievementStatus,
        reportingStatus: activeDetailScope.reportingStatus,
        cashCoverageComplete: storeSelfViewActive ? null : currentDetailFormalScope.cashCoverageComplete,
        accrualCoverageComplete: storeSelfViewActive ? null : currentDetailFormalScope.accrualCoverageComplete,
        lifecycleReady: storeSelfViewActive ? true : currentDetailFormalAuthority.lifecycleReady === true,
        scopeEligibleStoreCount: storeSelfViewActive ? 0 : currentDetailFormalScope.scopeEligibleStoreCount,
        selfViewStoreCount: storeSelfViewActive ? storeSelfViewProfile.scopeStoreKeys.length : 0,
        targetSummaryAvailable: activeDetailScope.targetSummaryAvailable,
      },
    };
  // ★ 監視清單換成了包含全部小抄的字典
  }, [allReports, selectedYear, selectedMonth, selectedYearMonth, effectiveStores, brandPrefix, brandInfo?.id, cleanName, currentDetailFormalScope, currentDetailFormalAuthority, monthlyTargetSummary, storeSelfViewActive, storeSelfViewProfile.scopeStoreKeys, projectionLifecycleEntryMap, projectionModelTrust, projectionModelState.data]);

  const detailMyStoreRankings = useMemo(() => {
    if (!currentDetailFormalAuthority?.compatible) return [];
    const authorityRowsByStore = new Map(
      Object.values(currentDetailFormalAuthority.stores || {})
        .map((row) => [cleanName(row?.storeKey), row])
        .filter(([storeKey]) => Boolean(storeKey))
    );
    const scopedRows = [...new Set((effectiveStores || []).map(cleanName).filter(Boolean))]
      .map((storeKey) => authorityRowsByStore.get(storeKey))
      .filter(Boolean);
    const liveRanking = buildDashboardLiveRanking({
      rows: scopedRows,
      normalizeStoreKey: cleanName,
    });

    return liveRanking.rows.map((row) => {
      const rank = Number(row.dashboardLiveCashAchievementRank || 0) || null;
      const totalStores = Number(row.dashboardLiveRankEligibleStoreCount || liveRanking.liveRankEligibleStoreCount || 0);
      const scopeStoreCount = Number(row.dashboardLiveScopeStoreCount || liveRanking.scopeStoreCount || 0);
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
        scopeStoreCount,
        actual: row.formalNetCash,
        actualStatus: row.formalNetCashStatus,
        target,
        targetStatus: row.cashTargetStatus,
        rate: row.cashAchievement,
        achievementStatus: row.cashAchievementStatus,
        reportingStatus: row.reportingStatus,
        reportingIncomplete: row.reportingIncomplete === true,
        dashboardLiveRankEligible: row.dashboardLiveRankEligible === true,
        dashboardLiveRankReason: row.dashboardLiveRankReason || "",
        dashboardLiveRankLabel: row.dashboardLiveRankLabel || "",
        formalRankEligible: row.formalRankEligible === true,
        challengeTarget,
        hasChallenge,
        challengeRate,
        passedChallenge: hasChallenge && isFiniteKpiNumber(challengeRate) && challengeRate >= 100,
        rankingSemantics: DASHBOARD_LIVE_RANKING_SEMANTICS,
        isBottomSegment: row.dashboardLiveRankEligible === true && isInBottomRankingSegment(rank, totalStores),
        isBottom5: row.dashboardLiveRankEligible === true && isInBottomRankingSegment(rank, totalStores),
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

    const preparedTherapists = Object.values(statsMap).map((item) => {
      const matchedTherapist = therapists && Array.isArray(therapists)
        ? therapists.find((t) => t.id === item.id)
        : null;
      return {
        ...item,
        name: matchedTherapist ? matchedTherapist.name : item.name,
        storeDisplay: `${item.storeDisplay}店`,
        isSystemStaff: Boolean(matchedTherapist),
      };
    });
    const rankings = applyTherapistRankingSemantics(preparedTherapists);
    
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
    
    const grandTotal = buildTherapistAggregateMetrics(rankings);

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
  }, [therapistReports, selectedYear, selectedMonth, therapistEffectiveStores, cleanName, userRole, currentUser, therapists, therapistAnnualAggregatedData, viewMode, isTherapistModuleEnabled]);

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
