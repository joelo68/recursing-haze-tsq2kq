// src/components/SmartForecastAccuracyPanel.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import {
  BarChart3,
  ChevronDown,
  RefreshCw,
} from "lucide-react";

import SmartMonthPicker from "./SmartMonthPicker";
import { PROJECTION_V2_BRANDS } from "../utils/projectionModelConsumer.js";
import {
  PROJECTION_HISTORICAL_METHOD_LABELS,
  buildProjectionAccuracyObservabilitySnapshot,
  buildProjectionHistoricalAccuracyComparison,
  getProjectionAccuracyDisplayPct,
  getProjectionHistoryYearsForRange,
  getTaipeiProjectionYearMonth,
} from "../utils/projectionObservability.js";

const emptyAccuracyState = () => ({
  status: "idle",
  data: null,
  error: "",
  loadedAtText: "",
});

const emptyHistoryState = () => ({
  status: "idle",
  loadedYears: [],
  sessionReadCount: 0,
  error: "",
});

const shiftYearMonth = (yearMonth = "", offset = 0) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(yearMonth || ""))) return "";
  const [year, month] = String(yearMonth).split("-").map(Number);
  const date = new Date(year, month - 1 + Number(offset || 0), 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const formatPct = (value) => (
  typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1)}%`
    : "尚無資料"
);

const SmartForecastAccuracyPanel = ({
  brandId = "",
  brandLabel = "",
  selectedMonth = "",
  getCollectionPath,
}) => {
  const [accuracyState, setAccuracyState] = useState(emptyAccuracyState);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMode, setHistoryMode] = useState("latest4");
  const [historyStartMonth, setHistoryStartMonth] = useState("");
  const [historyEndMonth, setHistoryEndMonth] = useState("");
  const [historyMetric, setHistoryMetric] = useState("cash");
  const [historyDetailsOpen, setHistoryDetailsOpen] = useState(false);
  const [historyDocuments, setHistoryDocuments] = useState({});
  const [historyState, setHistoryState] = useState(emptyHistoryState);

  const accuracyCacheRef = useRef(new Map());
  const historyCacheRef = useRef(new Map());
  const accuracyRequestSeq = useRef(0);
  const historyRequestSeq = useRef(0);

  const currentYearMonth = getTaipeiProjectionYearMonth();
  const latestCompleteEndMonth = shiftYearMonth(currentYearMonth, -1);
  const latestCompleteStartMonth = shiftYearMonth(currentYearMonth, -4);
  const normalizedBrandId = String(brandId || "").trim().toLowerCase();
  const canUseRollingHistory = PROJECTION_V2_BRANDS.includes(normalizedBrandId);

  const accuracyCacheKey = `${brandId || "unknown"}|${selectedMonth}`;

  const loadAccuracy = useCallback(async ({ force = false } = {}) => {
    if (
      !selectedMonth ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(selectedMonth || "")) ||
      typeof getCollectionPath !== "function"
    ) return;

    const requestSeq = ++accuracyRequestSeq.current;
    const cacheKey = `${brandId || "unknown"}|${selectedMonth}`;

    if (!force && accuracyCacheRef.current.has(cacheKey)) {
      setAccuracyState(accuracyCacheRef.current.get(cacheKey));
      return;
    }

    setAccuracyState((prev) => ({
      ...prev,
      status: "loading",
      error: "",
    }));

    try {
      const snap = await getDoc(doc(getCollectionPath("projection_accuracy"), selectedMonth));
      if (requestSeq !== accuracyRequestSeq.current) return;

      const accuracy = snap.exists() ? (snap.data() || {}) : null;
      const data = buildProjectionAccuracyObservabilitySnapshot({
        accuracy,
        brandId,
        yearMonth: selectedMonth,
        currentYearMonth: getTaipeiProjectionYearMonth(),
      });

      const next = {
        status: "ready",
        data,
        error: "",
        loadedAtText: new Date().toLocaleString("zh-TW", { hour12: false }),
      };
      accuracyCacheRef.current.set(cacheKey, next);
      setAccuracyState(next);
    } catch (error) {
      if (requestSeq !== accuracyRequestSeq.current) return;
      setAccuracyState({
        status: "error",
        data: null,
        error: error?.message || String(error),
        loadedAtText: new Date().toLocaleString("zh-TW", { hour12: false }),
      });
    }
  }, [brandId, getCollectionPath, selectedMonth]);

  useEffect(() => {
    setHistoryOpen(false);
    setHistoryDetailsOpen(false);
    loadAccuracy({ force: false });
  }, [accuracyCacheKey, loadAccuracy]);

  useEffect(() => {
    historyRequestSeq.current += 1;
    historyCacheRef.current = new Map();
    setHistoryDocuments({});
    setHistoryState(emptyHistoryState());
    setHistoryOpen(false);
    setHistoryDetailsOpen(false);
    setHistoryMode("latest4");
    setHistoryStartMonth("");
    setHistoryEndMonth("");
    setHistoryMetric("cash");
  }, [brandId]);

  const historyRange = useMemo(() => {
    if (historyMode === "custom") {
      return {
        startMonth: historyStartMonth,
        endMonth: historyEndMonth,
      };
    }
    return {
      startMonth: latestCompleteStartMonth,
      endMonth: latestCompleteEndMonth,
    };
  }, [
    historyEndMonth,
    historyMode,
    historyStartMonth,
    latestCompleteEndMonth,
    latestCompleteStartMonth,
  ]);

  const liveHistoryDocuments = useMemo(
    () => Object.values(historyDocuments || {}).filter(Boolean),
    [historyDocuments]
  );

  const history = useMemo(() => buildProjectionHistoricalAccuracyComparison({
    brandId,
    liveHistoryDocuments,
    startMonth: historyRange.startMonth,
    endMonth: historyRange.endMonth,
  }), [brandId, historyRange.endMonth, historyRange.startMonth, liveHistoryDocuments]);

  const loadHistory = useCallback(async ({ force = false } = {}) => {
    if (!canUseRollingHistory || typeof getCollectionPath !== "function") return;

    const years = getProjectionHistoryYearsForRange({
      startMonth: historyRange.startMonth,
      endMonth: historyRange.endMonth,
      currentYearMonth: getTaipeiProjectionYearMonth(),
    });

    if (!years.length) {
      setHistoryState({
        status: "error",
        loadedYears: [],
        sessionReadCount: 0,
        error: "請確認要查看的月份區間",
      });
      return;
    }

    const requestSeq = ++historyRequestSeq.current;
    setHistoryState((prev) => ({
      ...prev,
      status: "loading",
      error: "",
    }));

    const nextDocuments = { ...historyDocuments };
    let readCount = 0;
    const errors = [];

    for (const year of years) {
      const cacheKey = `${brandId || "unknown"}|${year}`;
      if (!force && historyCacheRef.current.has(cacheKey)) {
        nextDocuments[year] = historyCacheRef.current.get(cacheKey);
        continue;
      }

      try {
        const snap = await getDoc(doc(getCollectionPath("projection_accuracy_history"), year));
        readCount += 1;
        const data = snap.exists() ? (snap.data() || {}) : null;
        historyCacheRef.current.set(cacheKey, data);
        nextDocuments[year] = data;
      } catch (error) {
        errors.push(error?.message || String(error));
      }
    }

    if (requestSeq !== historyRequestSeq.current) return;

    setHistoryDocuments(nextDocuments);
    setHistoryState((prev) => ({
      status: errors.length ? "error" : "ready",
      loadedYears: [...new Set([
        ...(prev.loadedYears || []),
        ...years,
      ])].sort(),
      sessionReadCount: Math.max(0, Number(prev.sessionReadCount || 0)) + readCount,
      error: errors[0] || "",
    }));
  }, [
    brandId,
    canUseRollingHistory,
    getCollectionPath,
    historyDocuments,
    historyRange.endMonth,
    historyRange.startMonth,
  ]);

  const openHistory = async () => {
    const nextOpen = !historyOpen;
    setHistoryOpen(nextOpen);
    setHistoryDetailsOpen(false);
    if (nextOpen && canUseRollingHistory && historyState.status === "idle") {
      await loadHistory({ force: false });
    }
  };

  const applyHistoryRange = async ({ force = false } = {}) => {
    setHistoryDetailsOpen(false);
    await loadHistory({ force });
  };

  const data = accuracyState.data;
  const statusTone = data?.status === "healthy"
    ? "border-emerald-100 bg-emerald-50 text-emerald-700"
    : data?.status === "error"
      ? "border-rose-100 bg-rose-50 text-rose-600"
      : "border-amber-100 bg-amber-50 text-amber-700";

  const renderCurrentMetric = (metricKey, label) => {
    const score = data?.metrics?.[metricKey]?.methods?.effective || {};
    const accuracyPct = getProjectionAccuracyDisplayPct(score.wapePct);
    return (
      <div className="rounded-2xl border border-stone-100 bg-white p-4">
        <p className="text-xs font-bold text-stone-400">{label}</p>
        <p className="mt-1 text-2xl font-extrabold text-stone-800">{formatPct(accuracyPct)}</p>
        <p className="mt-1 text-xs font-bold text-stone-400">
          已完成 {Number(score.count || 0)} 次比較
        </p>
      </div>
    );
  };

  const metricKey = historyMetric === "accrual" ? "accrual" : "cash";
  const metricLabel = metricKey === "cash" ? "現金業績" : "權責業績";
  const historyMetricData = history.metrics?.[metricKey] || {};
  const historyOverall = historyMetricData.overall || {};

  return (
    <div className="rounded-3xl border border-stone-100 bg-white p-5 md:p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-stone-800">
            <BarChart3 size={20} className="text-emerald-500" />
            <h2 className="font-extrabold text-lg">推估準確度</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-stone-500">
            用已完成月份的正式結果確認推估是否穩定；數字越高，代表越接近月底實際業績。
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadAccuracy({ force: true })}
          disabled={accuracyState.status === "loading"}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-600 hover:bg-stone-50 disabled:opacity-50"
        >
          <RefreshCw size={16} className={accuracyState.status === "loading" ? "animate-spin" : ""} />
          更新準確度
        </button>
      </div>

      {accuracyState.status === "loading" && (
        <div className="mt-4 rounded-2xl border border-stone-100 bg-stone-50/70 px-4 py-5 text-sm font-bold text-stone-400">
          正在讀取 {selectedMonth} 的推估結果...
        </div>
      )}

      {accuracyState.status === "error" && (
        <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/60 px-4 py-4 text-sm font-bold text-rose-600">
          目前無法讀取推估準確度，請稍後再試。
        </div>
      )}

      {accuracyState.status === "ready" && data && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${statusTone}`}>
              {data.statusLabel}
            </span>
            <span className="rounded-full border border-stone-100 bg-stone-50 px-3 py-1.5 text-xs font-bold text-stone-500">
              {selectedMonth}
            </span>
            <span className="text-xs font-bold text-stone-400">
              更新：{accuracyState.loadedAtText || "-"}
            </span>
          </div>

          {data.status === "error" ? (
            <div className="rounded-2xl border border-rose-100 bg-rose-50/40 px-4 py-4 text-sm font-bold leading-6 text-rose-600">
              {data.statusDetail || "這份資料目前無法安全顯示。"}
            </div>
          ) : data.scoringAvailable ? (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {renderCurrentMetric("cash", "現金推估")}
                {renderCurrentMetric("accrual", "權責推估")}
              </div>
              <p className="text-xs font-bold leading-5 text-stone-400">
                以上為這個月份完成後的整體準確程度；系統直接使用正式保存結果，不會在畫面重新推算。
              </p>
            </>
          ) : (
            <div className="rounded-2xl border border-amber-100 bg-amber-50/45 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white bg-white/85 p-3">
                  <p className="text-xs font-bold text-stone-400">已累積觀察時間點</p>
                  <p className="mt-1 text-xl font-extrabold text-stone-800">
                    {Number(data.checkpointCount || 0)} / {Number(data.expectedCheckpointCount || 6)}
                  </p>
                </div>
                <div className="rounded-xl border border-white bg-white/85 p-3">
                  <p className="text-xs font-bold text-stone-400">月底結果</p>
                  <p className="mt-1 text-sm font-extrabold text-stone-700">
                    {data.exists ? "等待完整月份" : "尚未開始累積"}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm font-bold leading-6 text-amber-800">
                {data.statusDetail || "月底完成後，才會顯示這個月份的正式準確度。"}
              </p>
              {Array.isArray(data.checkpointKeys) && data.checkpointKeys.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {data.checkpointKeys.map((key) => (
                    <span
                      key={key}
                      className="rounded-full border border-amber-100 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-700"
                    >
                      {Number(String(key).replace("day", ""))} 日已記錄
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-stone-100 pt-4">
            <button
              type="button"
              onClick={openHistory}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-stone-100 bg-stone-50/55 px-4 py-3 text-left"
            >
              <div>
                <p className="text-sm font-extrabold text-stone-700">歷史表現</p>
                <p className="mt-0.5 text-xs font-bold text-stone-400">
                  需要時再查看最近完整月份或自行選擇比較期間。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-stone-400">
                  {historyOpen ? "收合" : "查看歷史表現"}
                </span>
                <ChevronDown
                  size={16}
                  className={`text-stone-400 transition-transform ${historyOpen ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            {historyOpen && (
              <div className="mt-3 space-y-3 rounded-2xl border border-stone-100 bg-[#FFFDF9] p-4">
                {!canUseRollingHistory ? (
                  <div className="rounded-xl border border-stone-100 bg-white px-4 py-3 text-sm font-bold leading-6 text-stone-600">
                    目前品牌使用標準推估，因此暫不提供歷史方式比較。
                  </div>
                ) : (
                  <>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
                  <label>
                    <span className="mb-1 block text-xs font-bold text-stone-400">比較期間</span>
                    <select
                      value={historyMode}
                      onChange={(event) => {
                        setHistoryMode(event.target.value);
                        setHistoryDetailsOpen(false);
                      }}
                      className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-700 outline-none"
                    >
                      <option value="latest4">最近 4 個完整月份</option>
                      <option value="custom">自行選擇月份</option>
                    </select>
                  </label>

                  {historyMode === "custom" && (
                    <div className="grid grid-cols-2 gap-2">
                      <SmartMonthPicker
                        value={historyStartMonth}
                        maxMonth={latestCompleteEndMonth}
                        onChange={setHistoryStartMonth}
                        allowClear
                        align="left"
                        buttonClassName="!h-10 !min-w-[140px] !text-xs"
                      />
                      <SmartMonthPicker
                        value={historyEndMonth}
                        maxMonth={latestCompleteEndMonth}
                        onChange={setHistoryEndMonth}
                        allowClear
                        align="right"
                        buttonClassName="!h-10 !min-w-[140px] !text-xs"
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => applyHistoryRange({ force: false })}
                      disabled={historyState.status === "loading"}
                      className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-xs font-extrabold text-stone-600 disabled:opacity-50"
                    >
                      套用
                    </button>
                    <button
                      type="button"
                      onClick={() => applyHistoryRange({ force: true })}
                      disabled={historyState.status === "loading"}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 text-xs font-extrabold text-stone-500 disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={historyState.status === "loading" ? "animate-spin" : ""} />
                      更新
                    </button>
                  </div>
                </div>

                {historyState.status === "error" && historyState.error && (
                  <p className="rounded-xl border border-rose-100 bg-rose-50/50 px-3 py-2 text-xs font-bold text-rose-600">
                    部分歷史資料讀取失敗：{historyState.error}
                  </p>
                )}

                {!history.available ? (
                  <div className="rounded-xl border border-amber-100 bg-amber-50/45 px-4 py-3 text-sm font-bold leading-6 text-amber-800">
                    {history.statusDetail}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex rounded-xl border border-stone-100 bg-white p-1">
                        {[
                          ["cash", "現金業績"],
                          ["accrual", "權責業績"],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              setHistoryMetric(key);
                              setHistoryDetailsOpen(false);
                            }}
                            className={`rounded-lg px-3 py-2 text-xs font-extrabold ${
                              metricKey === key
                                ? "bg-stone-700 text-white"
                                : "text-stone-500"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs font-bold text-stone-400">
                        {history.monthRangeLabel || `${historyRange.startMonth} ～ ${historyRange.endMonth}`}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-extrabold text-stone-700">{metricLabel}｜整體比較</p>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {["effective", "shadowV1", "currentPace"].map((methodKey) => {
                          const score = historyOverall.methods?.[methodKey] || {};
                          const isBest = historyOverall.bestMethods?.includes(methodKey);
                          return (
                            <div
                              key={`${metricKey}_${methodKey}`}
                              className={`rounded-2xl border p-3 ${
                                isBest
                                  ? "border-emerald-100 bg-emerald-50/65"
                                  : "border-stone-100 bg-white"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-bold text-stone-500">
                                  {PROJECTION_HISTORICAL_METHOD_LABELS[methodKey] || methodKey}
                                </p>
                                {isBest && (
                                  <span className="rounded-full border border-emerald-100 bg-white px-2 py-0.5 text-[10px] font-extrabold text-emerald-700">
                                    最接近實際
                                  </span>
                                )}
                              </div>
                              <p className={`mt-1 text-xl font-extrabold ${isBest ? "text-emerald-700" : "text-stone-800"}`}>
                                {formatPct(score.accuracyPct)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setHistoryDetailsOpen((current) => !current)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-stone-100 bg-white px-3 py-3 text-left"
                    >
                      <div>
                        <p className="text-xs font-extrabold text-stone-700">各日期比較</p>
                        <p className="mt-0.5 text-[11px] font-bold text-stone-400">
                          需要時再展開每個觀察日期的差異。
                        </p>
                      </div>
                      <ChevronDown
                        size={15}
                        className={`text-stone-400 transition-transform ${historyDetailsOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    {historyDetailsOpen && (
                      <div className="overflow-x-auto rounded-xl border border-stone-100 bg-white">
                        <div className="min-w-[430px]">
                          <div className="grid grid-cols-[64px_repeat(3,minmax(105px,1fr))] gap-1 border-b border-stone-100 bg-stone-50/70 px-3 py-2 text-[10px] font-extrabold text-stone-400">
                            <span>日期</span>
                            <span>智慧校正</span>
                            <span>原本方式</span>
                            <span>依目前進度</span>
                          </div>
                          {(historyMetricData.checkpoints || []).map((row) => (
                            <div
                              key={`${metricKey}_${row.checkpointKey}`}
                              className="grid grid-cols-[64px_repeat(3,minmax(105px,1fr))] gap-1 border-b border-stone-100 px-3 py-2 text-[11px] font-bold last:border-b-0"
                            >
                              <span className="font-extrabold text-stone-600">{row.label}</span>
                              {["effective", "shadowV1", "currentPace"].map((methodKey) => {
                                const score = row.methods?.[methodKey] || {};
                                const isBest = row.bestMethods?.includes(methodKey);
                                return (
                                  <span
                                    key={`${row.checkpointKey}_${methodKey}`}
                                    className={isBest ? "font-extrabold text-emerald-700" : "text-stone-500"}
                                  >
                                    {formatPct(score.accuracyPct)}{isBest ? " ✓" : ""}
                                  </span>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-[11px] font-bold leading-5 text-stone-400">
                      歷史回看資料與正式累積資料會分開保存，只合併做畫面比較；不會補寫成過去的單月追蹤紀錄，也不會修改推估公式。
                    </p>
                  </>
                )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartForecastAccuracyPanel;
