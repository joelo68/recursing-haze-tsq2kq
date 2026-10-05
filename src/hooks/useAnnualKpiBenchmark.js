import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import {
  makeEmptyAnnualKpiBenchmark,
  normalizeAnnualKpiBenchmarkPayload,
} from "../utils/annualKpiBenchmark.js";

const createInitialAnnualKpiBenchmarkState = () => ({
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

export function useAnnualKpiBenchmark({
  getCollectionPath,
  brandId: inputBrandId,
  selectedYear,
} = {}) {
  const [annualKpiBenchmark, setAnnualKpiBenchmark] = useState(
    createInitialAnnualKpiBenchmarkState
  );

  useEffect(() => {
    let cancelled = false;

    const loadAnnualKpiBenchmark = async () => {
      const year = String(selectedYear || "").trim();
      const brandId = String(inputBrandId || "").trim() || "cyj";

      if (!getCollectionPath || !year) {
        setAnnualKpiBenchmark(makeEmptyAnnualKpiBenchmark({}, "not_available"));
        return;
      }

      const cacheKey = `cyj_annual_kpi_summary_v7_${brandId}_${year}`;
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
        // Cache failure must not block Dashboard; fall through to the single Firestore point read.
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

        const payload = {
          ...normalizeAnnualKpiBenchmarkPayload(snap.data() || {}),
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
          // Cache failure does not change the authoritative Firestore result.
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
    return () => {
      cancelled = true;
    };
  }, [getCollectionPath, inputBrandId, selectedYear]);

  return annualKpiBenchmark;
}
