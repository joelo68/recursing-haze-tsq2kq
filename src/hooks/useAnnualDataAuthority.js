/* eslint-disable react-hooks/exhaustive-deps */

import { useEffect, useState } from "react";
import { documentId, getDocs, onSnapshot, query, where } from "firebase/firestore";

import { buildAnnualAggregateYearMonthCandidates, normalizeAnnualYearMonth, resolveAnnualReadPlan } from "../utils/annualReadPolicy";
import { isAnnualPreSystemMonth } from "../utils/annualFormalConsumer";
import { trackSnapshotRead } from "../utils/readTracker";

const ANNUAL_DATA_VIEWS = new Set(["annual"]);

export const useAnnualDataAuthority = ({
  hasVerifiedApplicationSession,
  currentBrand,
  selectedYear,
  activeView,
  isLowPowerMode,
  getCollectionPath,
  getStableReadMeta,
  systemExclusionState,
  currentLifecycleMasterState,
}) => {
  const [annualAggregatedData, setAnnualAggregatedData] = useState([]);
  const [annualDashboardSummaries, setAnnualDashboardSummaries] = useState([]);
  const [annualSummaryStatusMap, setAnnualSummaryStatusMap] = useState({});
  const [annualSummaryLoadState, setAnnualSummaryLoadState] = useState({
    brandId: "",
    year: "",
    dashboardReady: false,
    flagsReady: false,
    dashboardError: "",
    flagsError: "",
  });
  const [annualMonthlyTargetSummaries, setAnnualMonthlyTargetSummaries] = useState({});
  const [annualTargetSummaryLoadState, setAnnualTargetSummaryLoadState] = useState({
    brandId: "",
    year: "",
    ready: false,
    refreshing: false,
    error: "",
  });
  const [annualAggregateLoadState, setAnnualAggregateLoadState] = useState({
    brandId: "",
    year: "",
    ready: false,
    refreshing: false,
    fallbackKey: "",
    fallbackYearMonths: [],
    error: "",
  });
  const [therapistAnnualAggregatedData, setTherapistAnnualAggregatedData] = useState([]); // ★新增：管理師專屬結算包

  useEffect(() => {
    const shouldLoadAnnualData = ANNUAL_DATA_VIEWS.has(activeView);

    if (!hasVerifiedApplicationSession) {
      setAnnualAggregatedData([]);
      setAnnualDashboardSummaries([]);
      setAnnualSummaryStatusMap({});
      setAnnualSummaryLoadState({
        brandId: "",
        year: "",
        dashboardReady: false,
        flagsReady: false,
        dashboardError: "",
        flagsError: "",
      });
      setTherapistAnnualAggregatedData([]);
      return undefined;
    }

    // B1C2E-UX1：離開年度分析只解除年度 Query，不清掉已通過 trust gate 的 session snapshot。
    // 回到同品牌 / 同年份時可以先顯示上一份可信資料，再由新的 snapshot 背景校正；
    // 切品牌 / 切年份仍必須重新進入 fail-closed readiness。
    if (isLowPowerMode || !shouldLoadAnnualData) return undefined;

    const targetYear = String(selectedYear);
    const annualBrandId = String(currentBrand?.id || "").toLowerCase();
    const yearStartId = `${targetYear}-01`;
    const yearEndId = `${targetYear}-12`;
    const hasPublishedAnnualSnapshot = Boolean(
      annualSummaryLoadState?.brandId === annualBrandId &&
      String(annualSummaryLoadState?.year || "") === targetYear &&
      annualSummaryLoadState?.dashboardReady === true &&
      annualSummaryLoadState?.flagsReady === true
    );
    let active = true;

    if (!hasPublishedAnnualSnapshot) {
      setAnnualAggregatedData([]);
      setTherapistAnnualAggregatedData([]);
      setAnnualDashboardSummaries([]);
      setAnnualSummaryStatusMap({});
      setAnnualSummaryLoadState({
        brandId: annualBrandId,
        year: targetYear,
        dashboardReady: false,
        flagsReady: false,
        dashboardError: "",
        flagsError: "",
      });
    }

    const dashboardSummaryQuery = query(
      getCollectionPath("dashboard_summary"),
      where(documentId(), ">=", yearStartId),
      where(documentId(), "<=", yearEndId)
    );
    const unsubDashboardSummary = onSnapshot(
      dashboardSummaryQuery,
      (s) => {
        if (!active) return;
        trackSnapshotRead("dashboard_summary_year_for_annual", s, getStableReadMeta("dashboard_summary_year_for_annual"));
        setAnnualDashboardSummaries(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        setAnnualSummaryLoadState((prev) => (
          prev.brandId === annualBrandId && prev.year === targetYear
            ? { ...prev, dashboardReady: true, dashboardError: "" }
            : {
                brandId: annualBrandId,
                year: targetYear,
                dashboardReady: true,
                flagsReady: false,
                dashboardError: "",
                flagsError: "",
              }
        ));
      },
      (error) => {
        if (!active) return;
        console.error("年度 dashboard_summary 監聽失敗:", error);
        if (!hasPublishedAnnualSnapshot) setAnnualDashboardSummaries([]);
        setAnnualSummaryLoadState((prev) => (
          prev.brandId === annualBrandId && prev.year === targetYear
            ? { ...prev, dashboardReady: true, dashboardError: error?.message || "dashboard_summary load failed" }
            : prev
        ));
      }
    );

    const summaryFlagsQuery = query(
      getCollectionPath("summary_recalc_flags"),
      where(documentId(), ">=", yearStartId),
      where(documentId(), "<=", yearEndId)
    );
    const unsubSummaryFlags = onSnapshot(
      summaryFlagsQuery,
      (s) => {
        if (!active) return;
        trackSnapshotRead("summary_recalc_flags_year_for_annual", s, getStableReadMeta("summary_recalc_flags_year_for_annual"));
        const map = {};
        s.docs.forEach((d) => {
          const data = { id: d.id, ...d.data() };
          const ym = String(data.affectedYearMonth || data.yearMonth || d.id || "");
          if (ym) map[ym] = data;
        });
        setAnnualSummaryStatusMap(map);
        setAnnualSummaryLoadState((prev) => (
          prev.brandId === annualBrandId && prev.year === targetYear
            ? { ...prev, flagsReady: true, flagsError: "" }
            : {
                brandId: annualBrandId,
                year: targetYear,
                dashboardReady: false,
                flagsReady: true,
                dashboardError: "",
                flagsError: "",
              }
        ));
      },
      (error) => {
        if (!active) return;
        console.error("年度 summary_recalc_flags 監聽失敗:", error);
        if (!hasPublishedAnnualSnapshot) setAnnualSummaryStatusMap({});
        setAnnualSummaryLoadState((prev) => (
          prev.brandId === annualBrandId && prev.year === targetYear
            ? { ...prev, flagsReady: true, flagsError: error?.message || "summary_recalc_flags load failed" }
            : prev
        ));
      }
    );

    return () => {
      active = false;
      try { unsubDashboardSummary && unsubDashboardSummary(); } catch (error) { console.warn("annual dashboard_summary unsubscribe failed", error); }
      try { unsubSummaryFlags && unsubSummaryFlags(); } catch (error) { console.warn("annual summary_recalc_flags unsubscribe failed", error); }
    };
  }, [hasVerifiedApplicationSession, currentBrand?.id, selectedYear, activeView, getCollectionPath, getStableReadMeta, isLowPowerMode]);

  useEffect(() => {
    const shouldLoadAnnualData = ANNUAL_DATA_VIEWS.has(activeView);

    if (!hasVerifiedApplicationSession) {
      setAnnualMonthlyTargetSummaries({});
      setAnnualTargetSummaryLoadState({
        brandId: "",
        year: "",
        ready: false,
        refreshing: false,
        error: "",
      });
      return undefined;
    }

    // B1C2E-UX1：Q1/Q2/Q3/Q4/月份篩選只做本機切片，不能重新打 monthly_targets_summary。
    // 同品牌 / 同年份再次進入 Annual 時保留 trusted target snapshot，同時用單一年度 query 背景校正。
    if (isLowPowerMode || !shouldLoadAnnualData) return undefined;

    const targetYear = String(selectedYear);
    const annualBrandId = String(currentBrand?.id || "").toLowerCase();
    const hasPublishedTargetSnapshot = Boolean(
      annualTargetSummaryLoadState?.brandId === annualBrandId &&
      String(annualTargetSummaryLoadState?.year || "") === targetYear &&
      annualTargetSummaryLoadState?.ready === true
    );

    const annualTargetMonthKeys = Array.from({ length: 12 }, (_, index) => (
      `${targetYear}-${String(index + 1).padStart(2, "0")}`
    )).filter((yearMonth) => !isAnnualPreSystemMonth(annualBrandId, yearMonth));

    if (annualTargetMonthKeys.length === 0) {
      setAnnualMonthlyTargetSummaries({});
      setAnnualTargetSummaryLoadState({
        brandId: annualBrandId,
        year: targetYear,
        ready: true,
        refreshing: false,
        error: "",
      });
      return undefined;
    }

    if (!hasPublishedTargetSnapshot) {
      setAnnualMonthlyTargetSummaries({});
      setAnnualTargetSummaryLoadState({
        brandId: annualBrandId,
        year: targetYear,
        ready: false,
        refreshing: true,
        error: "",
      });
    } else {
      setAnnualTargetSummaryLoadState((prev) => ({
        ...prev,
        refreshing: true,
        error: "",
      }));
    }

    let active = true;
    const loadAnnualTargetSummaries = async () => {
      try {
        const targetSnap = await getDocs(query(
          getCollectionPath("monthly_targets_summary"),
          where(documentId(), "in", annualTargetMonthKeys)
        ));
        if (!active) return;

        trackSnapshotRead(
          "monthly_targets_summary_year_for_annual",
          targetSnap,
          getStableReadMeta("monthly_targets_summary_year_for_annual")
        );

        const next = {};
        targetSnap.docs.forEach((d) => {
          next[d.id] = { id: d.id, ...d.data() };
        });
        setAnnualMonthlyTargetSummaries(next);
        setAnnualTargetSummaryLoadState({
          brandId: annualBrandId,
          year: targetYear,
          ready: true,
          refreshing: false,
          error: "",
        });
      } catch (error) {
        if (!active) return;
        console.warn("年度 monthly_targets_summary 載入失敗:", error);
        if (!hasPublishedTargetSnapshot) setAnnualMonthlyTargetSummaries({});
        setAnnualTargetSummaryLoadState({
          brandId: annualBrandId,
          year: targetYear,
          ready: true,
          refreshing: false,
          error: error?.message || "monthly_targets_summary load failed",
        });
      }
    };

    loadAnnualTargetSummaries();

    return () => {
      active = false;
    };
  }, [
    hasVerifiedApplicationSession,
    currentBrand?.id,
    selectedYear,
    activeView,
    getCollectionPath,
    getStableReadMeta,
    isLowPowerMode,
  ]);

  useEffect(() => {
    const shouldLoadAnnualData = ANNUAL_DATA_VIEWS.has(activeView);

    if (!hasVerifiedApplicationSession) {
      setAnnualAggregatedData([]);
      setAnnualAggregateLoadState({
        brandId: "",
        year: "",
        ready: false,
        refreshing: false,
        fallbackKey: "",
        fallbackYearMonths: [],
        error: "",
      });
      return undefined;
    }

    // B1C2E-UX1.1：離開 Annual 只解除 fallback listener，不刪除同品牌 / 同年份
    // 已取得的 compatibility snapshot。回頁先保留可信畫面，再背景校正；
    // 品牌、年份或 fallback scope 改變時仍 fail-closed，不跨 scope 重用。
    if (isLowPowerMode || !shouldLoadAnnualData) return undefined;

    const targetYear = String(selectedYear);
    const annualBrandId = String(currentBrand?.id || "").toLowerCase();
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const readPlan = resolveAnnualReadPlan({
      selectedYear: targetYear,
      currentYearMonth,
      brandId: annualBrandId,
      dashboardSummaries: annualDashboardSummaries,
      summaryStatusMap: annualSummaryStatusMap,
      summaryLoadState: annualSummaryLoadState,
      systemExclusionState,
      currentLifecycleMasterState,
    });

    // Summary / Lifecycle authority 尚未 ready 時，不能猜 fallback scope。
    // 若同 scope 已有上一份 snapshot，保留資料但標示 refreshing；否則保持未 ready。
    if (!readPlan.ready) {
      setAnnualAggregateLoadState((prev) => (
        prev.brandId === annualBrandId && String(prev.year || "") === targetYear && prev.ready === true
          ? { ...prev, refreshing: true, error: "" }
          : {
              brandId: annualBrandId,
              year: targetYear,
              ready: false,
              refreshing: true,
              fallbackKey: "",
              fallbackYearMonths: [],
              error: "",
            }
      ));
      return undefined;
    }

    const fallbackYearMonths = [...readPlan.fallbackYearMonths].sort();
    const fallbackKey = fallbackYearMonths.join("|");

    if (fallbackYearMonths.length === 0) {
      setAnnualAggregatedData([]);
      setAnnualAggregateLoadState({
        brandId: annualBrandId,
        year: targetYear,
        ready: true,
        refreshing: false,
        fallbackKey,
        fallbackYearMonths,
        error: "",
      });
      return undefined;
    }

    const hasPublishedAggregateSnapshot = Boolean(
      annualAggregateLoadState?.brandId === annualBrandId
      && String(annualAggregateLoadState?.year || "") === targetYear
      && annualAggregateLoadState?.fallbackKey === fallbackKey
      && annualAggregateLoadState?.ready === true
    );

    if (!hasPublishedAggregateSnapshot) {
      setAnnualAggregatedData([]);
      setAnnualAggregateLoadState({
        brandId: annualBrandId,
        year: targetYear,
        ready: false,
        refreshing: true,
        fallbackKey,
        fallbackYearMonths,
        error: "",
      });
    } else {
      setAnnualAggregateLoadState((prev) => ({
        ...prev,
        refreshing: true,
        error: "",
      }));
    }

    let active = true;
    const fallbackSet = new Set(fallbackYearMonths);
    const aggregateYearMonthCandidates = buildAnnualAggregateYearMonthCandidates(fallbackYearMonths);
    const aggregateQuery = query(
      getCollectionPath("monthly_aggregated"),
      where("yearMonth", "in", aggregateYearMonthCandidates)
    );

    const unsubscribe = onSnapshot(
      aggregateQuery,
      (snap) => {
        if (!active) return;
        trackSnapshotRead("monthly_aggregated_fallback_months", snap, getStableReadMeta("monthly_aggregated_fallback_months"));
        setAnnualAggregatedData(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((row) => fallbackSet.has(normalizeAnnualYearMonth(row?.yearMonth)))
        );
        setAnnualAggregateLoadState({
          brandId: annualBrandId,
          year: targetYear,
          ready: true,
          refreshing: false,
          fallbackKey,
          fallbackYearMonths,
          error: "",
        });
      },
      (error) => {
        if (!active) return;
        console.error("年度 monthly_aggregated fallback 監聽失敗:", error);
        if (!hasPublishedAggregateSnapshot) setAnnualAggregatedData([]);
        setAnnualAggregateLoadState({
          brandId: annualBrandId,
          year: targetYear,
          ready: hasPublishedAggregateSnapshot,
          refreshing: false,
          fallbackKey,
          fallbackYearMonths,
          error: error?.message || "monthly_aggregated fallback load failed",
        });
      }
    );

    return () => {
      active = false;
      try { unsubscribe && unsubscribe(); } catch (error) { console.warn("annual monthly_aggregated fallback unsubscribe failed", error); }
    };
  }, [
    hasVerifiedApplicationSession,
    currentBrand?.id,
    selectedYear,
    activeView,
    isLowPowerMode,
    getCollectionPath,
    getStableReadMeta,
    annualDashboardSummaries,
    annualSummaryStatusMap,
    annualSummaryLoadState,
    systemExclusionState,
    currentLifecycleMasterState,
  ]);

  return {
    annualAggregatedData,
    annualDashboardSummaries,
    annualSummaryStatusMap,
    annualSummaryLoadState,
    annualMonthlyTargetSummaries,
    annualTargetSummaryLoadState,
    annualAggregateLoadState,
    therapistAnnualAggregatedData,
  };
};
