import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CalendarOff, Loader2, MapPin, RefreshCw, Save, ShieldCheck, Store } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { AppContext } from "../AppContext";
import { Card, ViewWrapper } from "./SharedUI";
import SmartCalendar from "./SmartCalendar";
import {
  getCanonicalLifecycleStoreName,
  getStoreScheduleEventId,
  normalizeLifecycleBrandId,
  normalizeLifecycleMaster,
  normalizeStoreLifecycleCore,
} from "../utils/storeLifecycle";
import { sortManagersByOrgOrder, sortStoresByOrgOrder } from "../utils/helpers";

const UNASSIGNED_KEY = "未分配";

const getTaipeiTodayIso = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

const addIsoDays = (dateText, days) => {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
};

const StoreScheduleView = () => {
  const {
    currentBrand,
    currentUser,
    userRole,
    officialManagers = {},
    managerOrder = [],
    getCollectionPath,
    showToast,
    currentDeviceTrust,
    updateStoreSchedule,
  } = useContext(AppContext);

  const brandId = normalizeLifecycleBrandId(currentBrand?.id || currentBrand || "cyj");
  const today = getTaipeiTodayIso();
  const firstEditableDate = addIsoDays(today, 1);
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));

  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedStoreKey, setSelectedStoreKey] = useState("");
  const [master, setMaster] = useState(() => normalizeLifecycleMaster({}, brandId));
  const [selectedDates, setSelectedDates] = useState([]);
  const [loadState, setLoadState] = useState("idle");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  const yearMonth = `${year}-${String(month).padStart(2, "0")}`;

  const notify = useCallback((message, type = "info") => {
    showToast?.(message, type);
  }, [showToast]);

  const loadMaster = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const snap = await getDoc(doc(getCollectionPath("store_lifecycle"), "master"));
      if (!snap.exists()) throw new Error("目前品牌尚未建立門市營運期間資料");
      setMaster(normalizeLifecycleMaster(snap.data() || {}, brandId));
      setLoadState("ready");
    } catch (error) {
      console.error("店家排休 Lifecycle 載入失敗:", error);
      setLoadError(error?.message || "店家排休資料載入失敗");
      setLoadState("error");
    }
  }, [brandId, getCollectionPath]);

  useEffect(() => {
    setSelectedRegion("");
    setSelectedStoreKey("");
    setYear(currentYear);
    setMonth(currentMonth);
    setMaster(normalizeLifecycleMaster({}, brandId));
    setSelectedDates([]);
    loadMaster();
  }, [brandId, currentYear, currentMonth, loadMaster]);

  const officialRegionRows = useMemo(() => {
    const managers = officialManagers && typeof officialManagers === "object" ? officialManagers : {};
    const allManagerNames = sortManagersByOrgOrder(managers, null, managerOrder)
      .filter((name) => !String(name).includes("未分配") && !String(name).includes("未分區"));

    const storeAccountKeys = new Set(
      (Array.isArray(currentUser?.stores) ? currentUser.stores : [currentUser?.storeName || currentUser?.store])
        .map(normalizeStoreLifecycleCore)
        .filter(Boolean)
    );

    const visibleManagerNames = userRole === "director"
      ? allManagerNames
      : userRole === "manager"
        ? allManagerNames.filter((name) => (
          name === currentUser?.name
          || name === currentUser?.securityAccountId
          || name === currentUser?.accountId
          || name === currentUser?.id
        ))
        : userRole === "store"
          ? allManagerNames.filter((name) => (
            (managers[name] || []).some((store) => storeAccountKeys.has(normalizeStoreLifecycleCore(store)))
          ))
          : [];

    const rows = visibleManagerNames.map((managerName) => {
      const rawStores = sortStoresByOrgOrder(managers, managers[managerName] || [], currentBrand?.label || "", managerOrder);
      const filtered = userRole === "store"
        ? rawStores.filter((store) => storeAccountKeys.has(normalizeStoreLifecycleCore(store)))
        : rawStores;
      return {
        managerName,
        stores: filtered
          .map((storeName) => {
            const storeKey = normalizeStoreLifecycleCore(storeName);
            const lifecycle = master?.stores?.[storeKey] || null;
            return {
              storeKey,
              label: getCanonicalLifecycleStoreName(storeKey, brandId),
              lifecycleReady: lifecycle?.entryStatus === "COMPLETE",
            };
          })
          .filter((row) => row.storeKey),
      };
    }).filter((row) => row.stores.length > 0);

    if (userRole === "store") {
      const represented = new Set(rows.flatMap((row) => row.stores.map((store) => store.storeKey)));
      const unassigned = [...storeAccountKeys]
        .filter((storeKey) => !represented.has(storeKey))
        .map((storeKey) => ({
          storeKey,
          label: getCanonicalLifecycleStoreName(storeKey, brandId),
          lifecycleReady: master?.stores?.[storeKey]?.entryStatus === "COMPLETE",
        }));
      if (unassigned.length) rows.push({ managerName: UNASSIGNED_KEY, stores: unassigned });
    }

    return rows;
  }, [
    officialManagers,
    managerOrder,
    currentUser,
    userRole,
    currentBrand?.label,
    master?.stores,
    brandId,
  ]);

  useEffect(() => {
    if (officialRegionRows.length === 1 && !selectedRegion) {
      setSelectedRegion(officialRegionRows[0].managerName);
    } else if (selectedRegion && !officialRegionRows.some((row) => row.managerName === selectedRegion)) {
      setSelectedRegion("");
      setSelectedStoreKey("");
    }
  }, [officialRegionRows, selectedRegion]);

  const selectedRegionRow = useMemo(
    () => officialRegionRows.find((row) => row.managerName === selectedRegion) || null,
    [officialRegionRows, selectedRegion]
  );

  const availableStores = selectedRegionRow?.stores || [];

  useEffect(() => {
    if (availableStores.length === 1 && !selectedStoreKey) {
      setSelectedStoreKey(availableStores[0].storeKey);
    } else if (selectedStoreKey && !availableStores.some((row) => row.storeKey === selectedStoreKey)) {
      setSelectedStoreKey("");
    }
  }, [availableStores, selectedStoreKey]);

  const calendar = master?.reportingCalendar || {};
  const managedEventId = useMemo(
    () => getStoreScheduleEventId(selectedStoreKey, yearMonth),
    [selectedStoreKey, yearMonth]
  );

  const managedEvent = useMemo(
    () => (calendar.storeClosureEvents || []).find((event) => event.id === managedEventId) || null,
    [calendar.storeClosureEvents, managedEventId]
  );

  const originalManagedDates = useMemo(
    () => (managedEvent?.dates || []).filter((date) => date.startsWith(`${yearMonth}-`)).sort(),
    [managedEvent, yearMonth]
  );

  const lockedDates = useMemo(() => {
    if (!selectedStoreKey) return [];
    const brandDates = (calendar.closedDates || [])
      .map((row) => row.date)
      .filter((date) => date.startsWith(`${yearMonth}-`));
    const otherStoreEventDates = (calendar.storeClosureEvents || [])
      .filter((event) => event.id !== managedEventId && event.storeKeys.includes(selectedStoreKey))
      .flatMap((event) => event.dates)
      .filter((date) => date.startsWith(`${yearMonth}-`));
    return [...new Set([...brandDates, ...otherStoreEventDates])].sort();
  }, [calendar, selectedStoreKey, managedEventId, yearMonth]);

  useEffect(() => {
    setSelectedDates(originalManagedDates);
  }, [selectedStoreKey, yearMonth, originalManagedDates.join("|")]);

  const futureSelectedDates = useMemo(
    () => selectedDates.filter((date) => date >= firstEditableDate && date.startsWith(`${yearMonth}-`)).sort(),
    [selectedDates, firstEditableDate, yearMonth]
  );
  const originalFutureDates = useMemo(
    () => originalManagedDates.filter((date) => date >= firstEditableDate).sort(),
    [originalManagedDates, firstEditableDate]
  );
  const hasChanges = futureSelectedDates.join("|") !== originalFutureDates.join("|");

  const toggleDate = useCallback((date) => {
    if (!selectedStoreKey || date < firstEditableDate) return;
    setSelectedDates((previous) => (
      previous.includes(date)
        ? previous.filter((item) => item !== date)
        : [...previous, date].sort()
    ));
  }, [selectedStoreKey, firstEditableDate]);

  const handleMonthChange = useCallback(({ year: nextYear, month: nextMonth }) => {
    setYear(Number(nextYear));
    setMonth(Number(nextMonth));
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedStoreKey) return notify("請先選擇店家", "error");
    if (!master?.stores?.[selectedStoreKey] || master.stores[selectedStoreKey].entryStatus !== "COMPLETE") {
      return notify("這間店的營運期間設定尚未完成，暫時不能設定排休", "error");
    }
    if (currentDeviceTrust?.status !== "trusted") {
      return notify("目前裝置尚未完成信任確認，無法修改店家排休", "error");
    }
    if (typeof updateStoreSchedule !== "function") {
      return notify("店家排休服務尚未就緒", "error");
    }

    setSaving(true);
    try {
      const result = await updateStoreSchedule({
        storeKey: selectedStoreKey,
        yearMonth,
        dates: futureSelectedDates,
        expectedCalendarRevision: Number(calendar.revision || 0),
      });
      if (result?.reportingCalendar) {
        setMaster((previous) => ({
          ...previous,
          reportingCalendar: normalizeLifecycleMaster({
            ...previous,
            reportingCalendar: result.reportingCalendar,
          }, brandId).reportingCalendar,
        }));
      }
      notify(result?.changed === false ? "排休設定沒有變更" : "店家排休已儲存", "success");
    } catch (error) {
      console.error("店家排休儲存失敗:", error);
      if (error?.status === 409 && error?.result?.currentReportingCalendar) {
        setMaster((previous) => ({
          ...previous,
          reportingCalendar: normalizeLifecycleMaster({
            ...previous,
            reportingCalendar: error.result.currentReportingCalendar,
          }, brandId).reportingCalendar,
        }));
      }
      notify(error?.result?.message || error?.message || "店家排休儲存失敗", "error");
    } finally {
      setSaving(false);
    }
  }, [
    selectedStoreKey,
    master,
    currentDeviceTrust?.status,
    updateStoreSchedule,
    yearMonth,
    futureSelectedDates,
    calendar.revision,
    brandId,
    notify,
  ]);

  const canOperate = ["director", "manager", "store"].includes(userRole || "");
  const selectedStore = availableStores.find((row) => row.storeKey === selectedStoreKey) || null;
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

  return (
    <ViewWrapper>
      <Card
        title="店家每月排休設定"
        subtitle="點擊日期設定休店（紅色代表店家排休；金色代表中央／全品牌休店）"
      >
        <div className="space-y-6">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-bold text-stone-400">
                  <MapPin size={12} /> 區域（區長）
                </span>
                <select
                  value={selectedRegion}
                  onChange={(event) => {
                    setSelectedRegion(event.target.value);
                    setSelectedStoreKey("");
                  }}
                  disabled={!canOperate || userRole === "manager" || officialRegionRows.length <= 1}
                  className="w-full rounded-xl border-2 border-stone-200 bg-white px-4 py-2 font-bold outline-none focus:border-amber-400 disabled:bg-stone-100 disabled:text-stone-500"
                >
                  <option value="">請選擇區域...</option>
                  {officialRegionRows.map((row) => (
                    <option key={row.managerName} value={row.managerName}>
                      {row.managerName === UNASSIGNED_KEY ? "未分區" : `${row.managerName}區`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-bold text-stone-400">
                  <Store size={12} /> 店家
                </span>
                <select
                  value={selectedStoreKey}
                  onChange={(event) => setSelectedStoreKey(event.target.value)}
                  disabled={!canOperate || !selectedRegion}
                  className="w-full rounded-xl border-2 border-stone-200 bg-white px-4 py-2 font-bold outline-none focus:border-amber-400 disabled:bg-stone-100 disabled:text-stone-500"
                >
                  <option value="">請選擇店家...</option>
                  {availableStores.map((store) => (
                    <option key={store.storeKey} value={store.storeKey} disabled={!store.lifecycleReady}>
                      {store.label}{store.lifecycleReady ? "" : "（營運期間未完成）"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold text-stone-400">年度</span>
                <select
                  value={year}
                  onChange={(event) => setYear(Number(event.target.value))}
                  className="w-full rounded-xl border-2 border-stone-200 bg-white px-4 py-2 font-bold"
                >
                  {yearOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold text-stone-400">月份</span>
                <select
                  value={month}
                  onChange={(event) => setMonth(Number(event.target.value))}
                  className="w-full rounded-xl border-2 border-stone-200 bg-white px-4 py-2 font-bold"
                >
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>{value}月</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
              <div className="flex flex-wrap gap-2 text-xs font-bold">
                <span className={`rounded-full px-3 py-1.5 ${currentDeviceTrust?.status === "trusted" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>
                  {currentDeviceTrust?.status === "trusted" ? "🛡 已信任裝置" : "⚠ 裝置尚未信任"}
                </span>
                <span className="rounded-full bg-stone-100 px-3 py-1.5 text-stone-500">
                  Calendar revision {Number(calendar.revision || 0)}
                </span>
                {selectedStore && (
                  <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-700">
                    {selectedStore.label}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={loadMaster}
                disabled={loadState === "loading" || saving}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-black text-stone-500 hover:bg-stone-50 disabled:opacity-50"
              >
                <RefreshCw size={14} className={loadState === "loading" ? "animate-spin" : ""} />
                重新載入
              </button>
            </div>
          </div>

          {!canOperate && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              目前角色可以由資安權限決定是否看見此頁，但沒有店家排休寫入範圍。日常排休操作只開放最高管理者、區長與店經理。
            </div>
          )}

          {loadState === "error" && (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
              {loadError}
            </div>
          )}

          {loadState === "loading" ? (
            <div className="flex min-h-[360px] items-center justify-center text-stone-400">
              <Loader2 size={28} className="animate-spin" />
            </div>
          ) : selectedStoreKey ? (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 md:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-base font-black text-stone-700">
                    <CalendarOff size={18} className="text-rose-500" />
                    {selectedStore?.label || getCanonicalLifecycleStoreName(selectedStoreKey, brandId)}
                  </div>
                  <div className="mt-1 text-xs font-bold text-stone-400">
                    今天以前（含今天）的日期只供查看；店主管最早可設定明天，今天與歷史修正仍由最高管理者從「營運日曆」處理。
                  </div>
                </div>
                <div className="flex gap-2 text-[11px] font-black">
                  <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-600">紅色：店家排休</span>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">金色：中央休店</span>
                </div>
              </div>

              <SmartCalendar
                embedded
                multiSelect
                selectedDate={`${yearMonth}-01`}
                selectedDates={selectedDates}
                disabledDates={lockedDates}
                minDate={firstEditableDate}
                onDateToggle={toggleDate}
                onMonthChange={handleMonthChange}
                selectedDateLabel="休"
                disabledDateLabel="全休"
              />
            </div>
          ) : (
            <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50 text-center">
              <Store size={32} className="mb-3 text-stone-300" />
              <div className="text-sm font-black text-stone-500">請先選擇要設定排休的店家</div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-stone-100 pt-5 md:flex-row md:items-center md:justify-between">
            <div className="text-xs font-bold leading-6 text-stone-400">
              儲存只會更新這間門市的正式休店設定，不會建立或修改既有日報資料。
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canOperate || !selectedStoreKey || !hasChanges || saving || currentDeviceTrust?.status !== "trusted"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-800 px-8 py-3 font-bold text-white shadow-sm transition-all hover:bg-stone-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 md:w-auto"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : (currentDeviceTrust?.status === "trusted" ? <Save size={18} /> : <ShieldCheck size={18} />)}
              {saving ? "儲存中…" : "儲存排休"}
            </button>
          </div>
        </div>
      </Card>
    </ViewWrapper>
  );
};

export default StoreScheduleView;
