import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { auth } from "../config/firebase";
import { Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";
import {
  getCanonicalLifecycleStoreName,
  getLifecycleBrandMeta,
  getStoreLifecycleKey,
  normalizeIsoDate,
  normalizeLifecycleBrandId,
  normalizeLifecycleMaster,
  normalizeReportingCalendar,
} from "../utils/storeLifecycle";

const STORE_LIFECYCLE_ENDPOINT = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageStoreLifecycle";
const UNASSIGNED_KEY = "未分配";
const REASON_OPTIONS = ["春節", "颱風停班", "全品牌教育訓練", "公司旅遊", "盤點休店", "品牌公休日", "其他"];

const getTodayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const enumerateDateRange = (startText = "", endText = "") => {
  const start = normalizeIsoDate(startText);
  const end = normalizeIsoDate(endText);
  if (!start || !end || start > end) return [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const finish = new Date(`${end}T00:00:00Z`);
  const rows = [];
  while (cursor <= finish) {
    rows.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
};

const areConsecutiveDates = (left = "", right = "") => {
  const a = normalizeIsoDate(left);
  const b = normalizeIsoDate(right);
  if (!a || !b) return false;
  const next = new Date(`${a}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10) === b;
};

const groupBrandClosedDates = (rows = []) => {
  const normalized = [...(rows || [])].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const groups = [];
  normalized.forEach((row) => {
    const date = normalizeIsoDate(row?.date);
    if (!date) return;
    const reason = String(row?.reason || "").trim();
    const previous = groups.at(-1);
    if (previous && previous.reason === reason && areConsecutiveDates(previous.dates.at(-1), date)) {
      previous.dates.push(date);
      return;
    }
    groups.push({ id: `brand-${date}-${groups.length}`, scope: "brand", reason, dates: [date] });
  });
  return groups;
};

const formatDateRange = (dates = []) => {
  const rows = [...new Set((dates || []).map(normalizeIsoDate).filter(Boolean))].sort();
  if (!rows.length) return "—";
  if (rows.length === 1) return rows[0];
  return `${rows[0]} ～ ${rows.at(-1)}`;
};

const ReportingCalendarManager = ({
  currentBrand,
  managers = {},
  managerOrder = [],
  getCollectionPath,
  currentUser,
  currentDeviceTrust,
  showToast,
}) => {
  const brandId = normalizeLifecycleBrandId(currentBrand);
  const brandMeta = getLifecycleBrandMeta(brandId);
  const [master, setMaster] = useState(() => normalizeLifecycleMaster({}, brandId));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeMode, setActiveMode] = useState("create");
  const [scope, setScope] = useState("brand");
  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStoreKeys, setSelectedStoreKeys] = useState([]);
  const [startDate, setStartDate] = useState(getTodayIso);
  const [endDate, setEndDate] = useState(getTodayIso);
  const [reasonOption, setReasonOption] = useState("品牌公休日");
  const [customReason, setCustomReason] = useState("");
  const [monthFocusDate, setMonthFocusDate] = useState(getTodayIso);
  const [credentialPassword, setCredentialPassword] = useState("");
  const [credentialDialog, setCredentialDialog] = useState(null);
  const [saving, setSaving] = useState(false);
  const loadSequenceRef = useRef(0);
  const activeBrandRef = useRef(brandId);

  useEffect(() => { activeBrandRef.current = brandId; }, [brandId]);

  const notify = useCallback((message, type = "info") => {
    if (typeof showToast === "function") showToast(message, type);
  }, [showToast]);

  const loadMaster = useCallback(async ({ silent = false } = {}) => {
    if (!getCollectionPath) return null;
    const requestId = ++loadSequenceRef.current;
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const snap = await getDoc(doc(getCollectionPath("store_lifecycle"), "master"));
      const next = normalizeLifecycleMaster(snap.exists() ? (snap.data() || {}) : {}, brandId);
      if (requestId !== loadSequenceRef.current || activeBrandRef.current !== brandId) return null;
      setMaster(next);
      return next;
    } catch (error) {
      console.error("Reporting Calendar 載入失敗:", error);
      if (requestId === loadSequenceRef.current && activeBrandRef.current === brandId) {
        setLoadError(error?.message || "營運日曆資料載入失敗");
      }
      return null;
    } finally {
      if (!silent && requestId === loadSequenceRef.current && activeBrandRef.current === brandId) setLoading(false);
    }
  }, [brandId, getCollectionPath]);

  useEffect(() => {
    setScope("brand");
    setSelectedManager("");
    setSelectedStoreKeys([]);
    setCredentialPassword("");
    setCredentialDialog(null);
    setActiveMode("create");
    loadMaster();
  }, [brandId, loadMaster]);

  const reportingCalendar = useMemo(() => normalizeReportingCalendar(master.reportingCalendar || {}), [master.reportingCalendar]);

  const managerRows = useMemo(() => {
    const rawManagers = managers && typeof managers === "object" ? managers : {};
    const rawKeys = Object.keys(rawManagers).filter((name) => name && name !== UNASSIGNED_KEY);
    const ordered = [];
    const seen = new Set();
    (Array.isArray(managerOrder) ? managerOrder : []).forEach((name) => {
      if (!rawKeys.includes(name) || seen.has(name)) return;
      seen.add(name);
      ordered.push(name);
    });
    rawKeys
      .filter((name) => !seen.has(name))
      .sort((a, b) => String(a).localeCompare(String(b), "zh-Hant", { numeric: true, sensitivity: "base" }))
      .forEach((name) => ordered.push(name));

    return ordered.map((managerName) => {
      const stores = [...new Set((Array.isArray(rawManagers[managerName]) ? rawManagers[managerName] : []).map(String).filter(Boolean))]
        .map((storeName) => {
          const storeKey = getStoreLifecycleKey(storeName);
          return {
            storeKey,
            canonicalStoreName: getCanonicalLifecycleStoreName(storeName, brandId),
            lifecycleReady: Boolean(storeKey && master.stores?.[storeKey]?.entryStatus === "COMPLETE"),
          };
        })
        .filter((row) => row.storeKey)
        .sort((a, b) => a.canonicalStoreName.localeCompare(b.canonicalStoreName, "zh-Hant", { numeric: true, sensitivity: "base" }));
      return { managerName, stores };
    });
  }, [brandId, managerOrder, managers, master.stores]);

  const selectedManagerRow = useMemo(() => managerRows.find((row) => row.managerName === selectedManager) || null, [managerRows, selectedManager]);

  const storeDirectory = useMemo(() => {
    const map = new Map();
    managerRows.forEach((manager) => {
      manager.stores.forEach((store) => map.set(store.storeKey, { ...store, managerName: manager.managerName }));
    });
    Object.values(master.stores || {}).forEach((entry) => {
      const storeKey = getStoreLifecycleKey(entry.storeKey || entry.coreStoreName || entry.canonicalStoreName);
      if (!storeKey || map.has(storeKey)) return;
      map.set(storeKey, {
        storeKey,
        canonicalStoreName: getCanonicalLifecycleStoreName(entry.canonicalStoreName || storeKey, brandId),
        managerName: "歷史／未分配",
        lifecycleReady: true,
      });
    });
    return map;
  }, [brandId, managerRows, master.stores]);

  const selectedStoreSet = useMemo(() => new Set(selectedStoreKeys), [selectedStoreKeys]);
  const selectedStoreGroups = useMemo(() => {
    const grouped = new Map();
    selectedStoreKeys.forEach((storeKey) => {
      const row = storeDirectory.get(storeKey);
      if (!row) return;
      const managerName = row.managerName || "其他";
      if (!grouped.has(managerName)) grouped.set(managerName, []);
      grouped.get(managerName).push(row);
    });
    return [...grouped.entries()].map(([managerName, stores]) => ({
      managerName,
      stores: stores.sort((a, b) => a.canonicalStoreName.localeCompare(b.canonicalStoreName, "zh-Hant")),
    }));
  }, [selectedStoreKeys, storeDirectory]);

  const effectiveReason = useMemo(() => reasonOption === "其他" ? String(customReason || "").trim() : reasonOption, [customReason, reasonOption]);
  const selectedDates = useMemo(() => enumerateDateRange(startDate, endDate), [startDate, endDate]);
  const brandHistory = useMemo(() => groupBrandClosedDates(reportingCalendar.closedDates), [reportingCalendar.closedDates]);
  const storeHistory = useMemo(() => (reportingCalendar.storeClosureEvents || []).map((event) => ({
    ...event,
    scope: "stores",
    storeRows: event.storeKeys.map((storeKey) => storeDirectory.get(storeKey) || {
      storeKey,
      canonicalStoreName: getCanonicalLifecycleStoreName(storeKey, brandId),
      managerName: "歷史／未分配",
    }),
  })), [brandId, reportingCalendar.storeClosureEvents, storeDirectory]);
  const allHistory = useMemo(() => [...brandHistory, ...storeHistory].sort((a, b) => String(b.dates?.[0] || "").localeCompare(String(a.dates?.[0] || "")) || String(b.id || "").localeCompare(String(a.id || ""))), [brandHistory, storeHistory]);
  const focusMonth = String(monthFocusDate || "").slice(0, 7);
  const monthHistory = useMemo(() => allHistory.filter((event) => event.dates?.some((date) => String(date).startsWith(`${focusMonth}-`))), [allHistory, focusMonth]);

  const toggleStore = (storeKey) => {
    const row = storeDirectory.get(storeKey);
    if (!row?.lifecycleReady) {
      notify("這間門市尚未建立完整 Lifecycle，暫時不能設定休店日", "error");
      return;
    }
    setSelectedStoreKeys((previous) => previous.includes(storeKey) ? previous.filter((key) => key !== storeKey) : [...previous, storeKey]);
  };

  const selectAllCurrentManagerStores = () => {
    const keys = (selectedManagerRow?.stores || []).filter((row) => row.lifecycleReady).map((row) => row.storeKey);
    setSelectedStoreKeys((previous) => [...new Set([...previous, ...keys])]);
  };
  const clearCurrentManagerStores = () => {
    const managerKeys = new Set((selectedManagerRow?.stores || []).map((row) => row.storeKey));
    setSelectedStoreKeys((previous) => previous.filter((key) => !managerKeys.has(key)));
  };

  const buildActor = (password) => ({
    roleId: "director",
    accountId: String(currentUser?.securityAccountId || currentUser?.id || currentUser?.accountId || currentUser?.name || "").trim(),
    accountKey: "",
    userName: String(currentUser?.name || "最高管理者"),
    deviceId: String(currentDeviceTrust?.deviceId || ""),
    credentialPassword: String(password || ""),
  });

  const callLifecycleEndpoint = useCallback(async (payload, password) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error("登入狀態已失效，請重新登入");
    const idToken = await firebaseUser.getIdToken();
    const response = await fetch(STORE_LIFECYCLE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ brandId, ...payload, actor: buildActor(password) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      const error = new Error(result?.message || `營運日曆操作失敗 (${response.status})`);
      error.status = response.status;
      error.result = result;
      throw error;
    }
    return result;
  }, [brandId, currentDeviceTrust?.deviceId, currentUser]);

  const openAddConfirmation = () => {
    if (currentDeviceTrust?.status !== "trusted") return notify("請改用已信任的裝置設定休店日", "error");
    if (!selectedDates.length) return notify("請選擇有效的休店日期範圍", "error");
    if (!effectiveReason) return notify("請填寫休店原因", "error");
    if (scope === "stores" && selectedStoreKeys.length === 0) return notify("請先選擇至少一間休店門市", "error");
    setCredentialPassword("");
    setCredentialDialog({
      type: "add",
      title: "確認設定休店日",
      description: scope === "brand"
        ? `即將把 ${brandMeta.label} ${formatDateRange(selectedDates)} 設定為全品牌休店。`
        : `即將把 ${selectedStoreKeys.length} 間門市於 ${formatDateRange(selectedDates)} 設定為休店。`,
      payload: {
        action: "update_reporting_calendar_v2",
        operation: "add",
        scope,
        dates: selectedDates,
        reason: effectiveReason,
        storeKeys: scope === "stores" ? selectedStoreKeys : [],
        expectedCalendarRevision: Number(reportingCalendar.revision || 0),
      },
    });
  };

  const openRemoveConfirmation = (event) => {
    if (currentDeviceTrust?.status !== "trusted") return notify("請改用已信任的裝置取消休店設定", "error");
    const isStoreEvent = event.scope === "stores";
    setCredentialPassword("");
    setCredentialDialog({
      type: "remove",
      title: "確認取消休店設定",
      description: isStoreEvent
        ? `即將取消 ${event.storeKeys?.length || 0} 間門市 ${formatDateRange(event.dates)} 的休店設定。`
        : `即將取消 ${brandMeta.label} ${formatDateRange(event.dates)} 的全品牌休店設定。`,
      payload: {
        action: "update_reporting_calendar_v2",
        operation: "remove",
        scope: isStoreEvent ? "stores" : "brand",
        dates: isStoreEvent ? [] : event.dates,
        eventId: isStoreEvent ? event.id : "",
        expectedCalendarRevision: Number(reportingCalendar.revision || 0),
      },
    });
  };

  const closeCredentialDialog = () => {
    if (saving) return;
    setCredentialPassword("");
    setCredentialDialog(null);
  };

  const confirmCredentialAction = async () => {
    const password = String(credentialPassword || "").trim();
    if (!password) return notify("請輸入目前最高管理者密碼", "error");
    const dialog = credentialDialog;
    if (!dialog?.payload) return;
    setSaving(true);
    try {
      const result = await callLifecycleEndpoint(dialog.payload, password);
      if (activeBrandRef.current !== brandId) return;
      const historicalMonths = Array.isArray(result?.affectedHistoricalMonths) ? result.affectedHistoricalMonths : [];
      if (result?.changed === false) notify("目前資料已是相同設定，沒有需要變更的內容", "info");
      else if (historicalMonths.length > 0) notify(`休店設定已更新；${historicalMonths.join("、")} 已排入 Summary 自動重整，完成後會自動重建 Annual`, "success");
      else notify(dialog.type === "remove" ? "休店設定已取消" : "休店日已設定", "success");
      await loadMaster({ silent: true });
      if (dialog.type === "add") {
        setSelectedManager("");
        setSelectedStoreKeys([]);
        setCustomReason("");
      }
      setCredentialPassword("");
      setCredentialDialog(null);
    } catch (error) {
      if (error?.status === 409) {
        await loadMaster({ silent: true });
        notify(error.message || "營運日曆已被其他管理者更新，已重新載入，請再次確認", "error");
      } else notify(error.message || "營運日曆操作失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Card title="營運日曆 / 休店日"><div className="flex items-center justify-center gap-2 py-16 text-sm font-bold text-[#A69C91]"><Loader2 className="animate-spin" size={20} /> 正在載入營運日曆…</div></Card>;

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      <Card title="營運日曆 / 休店日管理">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-[#EFE7DA] bg-[#FFFCF7] p-4"><div className="text-[11px] font-black text-[#A69C91]">目前品牌</div><div className="mt-1 text-lg font-black text-[#4D4338]">{brandMeta.label}</div></div>
            <div className="rounded-2xl border border-[#EFE7DA] bg-[#FFFCF7] p-4"><div className="text-[11px] font-black text-[#A69C91]">Calendar Revision</div><div className="mt-1 text-lg font-black text-[#4D4338]">{reportingCalendar.revision || 0}</div></div>
            <div className="rounded-2xl border border-[#EFE7DA] bg-[#FFFCF7] p-4"><div className="text-[11px] font-black text-[#A69C91]">全品牌休店日</div><div className="mt-1 text-lg font-black text-[#4D4338]">{reportingCalendar.closedDates.length}</div></div>
            <div className="rounded-2xl border border-[#EFE7DA] bg-[#FFFCF7] p-4"><div className="text-[11px] font-black text-[#A69C91]">指定店家事件</div><div className="mt-1 text-lg font-black text-[#4D4338]">{reportingCalendar.storeClosureEvents.length}</div></div>
          </div>
          <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 text-xs font-bold leading-6 text-sky-800">正式休店日會從「應回報日」排除，不需要建立 0 元日報。全品牌與指定店家共用 Lifecycle Master / Reporting Calendar authority，不修改 Raw daily_reports。</div>
          {loadError && <div className="flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50/70 p-4 text-sm font-bold text-rose-700"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div className="min-w-0 flex-1">{loadError}</div><button type="button" onClick={() => loadMaster()} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-black"><RefreshCw size={13} /> 重試</button></div>}
          <div className="flex flex-wrap gap-2 rounded-2xl border border-[#EFE7DA] bg-[#FAF7F1] p-1.5">
            {[["create", "新增休店日"], ["month", "月份檢視"], ["history", "休店紀錄"]].map(([value, label]) => <button type="button" key={value} onClick={() => setActiveMode(value)} className={`rounded-xl px-4 py-2.5 text-xs font-black transition-all ${activeMode === value ? "border border-[#E8C77A] bg-[#FFF4D8] text-[#6A4D26] shadow-sm" : "text-[#8C8176] hover:bg-white"}`}>{label}</button>)}
          </div>
        </div>
      </Card>

      {activeMode === "create" && <Card title="新增休店日"><div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]"><div className="space-y-5 min-w-0">
        <div><div className="text-sm font-black text-[#4D4338]">1. 選擇休店範圍</div><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{[["brand", "全品牌休店", "春節、公司旅遊、全品牌教育訓練等。"], ["stores", "指定店家休店", "局部颱風停班、單店盤點或特定門市公休。"]].map(([value, title, description]) => <button type="button" key={value} onClick={() => setScope(value)} className={`rounded-2xl border p-4 text-left transition-all ${scope === value ? "border-[#E8C77A] bg-[#FFF8E7] ring-1 ring-[#F3DFB8]" : "border-[#EFE7DA] bg-white hover:bg-[#FFFCF7]"}`}><div className="text-sm font-black text-[#4D4338]">{title}</div><div className="mt-1 text-[11px] font-bold leading-5 text-[#A69C91]">{description}</div></button>)}</div></div>
        {scope === "stores" && <div className="space-y-4 rounded-2xl border border-[#EFE7DA] bg-[#FFFCF8] p-4"><div><label className="mb-1.5 block text-xs font-black text-[#7C7063]">2. 選擇區長</label><div className="relative"><select value={selectedManager} onChange={(event) => setSelectedManager(event.target.value)} className="w-full appearance-none rounded-xl border border-[#E8DDD0] bg-white px-4 py-3 pr-10 text-sm font-black text-[#4D4338] outline-none focus:border-amber-300"><option value="">請先選擇區長，再顯示該區店家</option>{managerRows.map((row) => <option key={row.managerName} value={row.managerName}>{row.managerName}｜{row.stores.length} 店</option>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#A69C91]" /></div></div>
          {!selectedManagerRow ? <div className="rounded-2xl border-2 border-dashed border-[#EDE2D4] py-9 text-center"><Store size={30} className="mx-auto text-[#D5C8BA]" /><div className="mt-2 text-sm font-black text-[#8C8176]">請先選擇區長</div><div className="mt-1 text-[11px] font-bold text-[#B0A59A]">不會一次把全品牌所有店家展開。</div></div> : <div className="rounded-2xl border border-[#EFE7DA] bg-white p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-black text-[#4D4338]">{selectedManagerRow.managerName}</div><div className="mt-1 text-[11px] font-bold text-[#A69C91]">只顯示此區 {selectedManagerRow.stores.length} 間門市；切換區長後已選店家仍保留。</div></div><div className="flex flex-wrap gap-2"><button type="button" onClick={selectAllCurrentManagerStores} className="rounded-lg border border-[#E8C77A] bg-[#FFF7DF] px-3 py-1.5 text-[11px] font-black text-[#6A4D26]">本區全選</button><button type="button" onClick={clearCurrentManagerStores} className="rounded-lg border border-[#E8DDD0] bg-white px-3 py-1.5 text-[11px] font-black text-[#7C7063]">清除此區</button></div></div><div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{selectedManagerRow.stores.map((storeRow) => <label key={storeRow.storeKey} className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black ${selectedStoreSet.has(storeRow.storeKey) ? "border-[#E8C77A] bg-[#FFF8E7] text-[#5A4225]" : "border-[#EFE7DA] bg-[#FFFCF8] text-[#675B4E]"} ${storeRow.lifecycleReady ? "cursor-pointer" : "cursor-not-allowed opacity-45"}`}><input type="checkbox" checked={selectedStoreSet.has(storeRow.storeKey)} disabled={!storeRow.lifecycleReady} onChange={() => toggleStore(storeRow.storeKey)} className="h-4 w-4 rounded border-stone-300" /><span className="min-w-0 flex-1 truncate">{storeRow.canonicalStoreName}</span></label>)}</div></div>}
          <div className="rounded-2xl border border-[#EFE7DA] bg-[#FAF7F1] p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-black text-[#6E6257]">已選店家</div><div className="mt-1 text-[10px] font-bold text-[#A69C91]">{selectedStoreKeys.length > 0 ? `已選 ${selectedStoreKeys.length} 間，可繼續切換其他區長增加門市` : "目前尚未選擇店家"}</div></div>{selectedStoreKeys.length > 0 && <button type="button" onClick={() => setSelectedStoreKeys([])} className="rounded-lg border border-[#E8DDD0] bg-white px-3 py-1.5 text-[11px] font-black text-[#7C7063]">清除全部</button>}</div><div className="mt-3 space-y-2">{selectedStoreGroups.map((group) => <div key={group.managerName} className="rounded-xl border border-[#EFE7DA] bg-white p-3"><div className="text-[10px] font-black text-[#A69C91]">{group.managerName}</div><div className="mt-2 flex flex-wrap gap-2">{group.stores.map((row) => <button type="button" key={row.storeKey} onClick={() => toggleStore(row.storeKey)} className="inline-flex items-center gap-1 rounded-full border border-[#E8DDD0] bg-[#FFFCF8] px-2.5 py-1 text-[11px] font-black text-[#675B4E]">{row.canonicalStoreName}<X size={11} /></button>)}</div></div>)}</div></div>
        </div>}
        <div><div className="text-sm font-black text-[#4D4338]">{scope === "stores" ? "3" : "2"}. 選擇日期</div><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs font-black text-[#7C7063]">開始日期</span><SmartDatePicker selectedDate={startDate} onDateSelect={(date) => { setStartDate(date); if (date > endDate) setEndDate(date); }} /></label><label><span className="mb-1.5 block text-xs font-black text-[#7C7063]">結束日期</span><SmartDatePicker selectedDate={endDate} minDate={startDate} onDateSelect={setEndDate} /></label></div><div className="mt-2 text-[10px] font-bold text-[#A69C91]">沿用系統既有 SmartCalendar；單日休店請讓開始與結束日期相同。</div></div>
        <div><div className="text-sm font-black text-[#4D4338]">{scope === "stores" ? "4" : "3"}. 休店原因</div><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><select value={reasonOption} onChange={(event) => setReasonOption(event.target.value)} className="rounded-xl border border-[#E8DDD0] bg-white px-3 py-3 text-sm font-black text-[#4D4338] outline-none focus:border-amber-300">{REASON_OPTIONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select>{reasonOption === "其他" && <input value={customReason} onChange={(event) => setCustomReason(event.target.value)} placeholder="輸入休店原因" className="rounded-xl border border-[#E8DDD0] bg-white px-3 py-3 text-sm font-bold outline-none focus:border-amber-300" />}</div></div>
      </div><div className="space-y-4"><div className="rounded-2xl border border-[#EFE7DA] bg-[#FAF7F1] p-4"><div className="text-sm font-black text-[#4D4338]">設定預覽</div><div className="mt-4 space-y-3 text-xs"><div className="flex justify-between gap-3"><span className="font-bold text-[#A69C91]">品牌</span><span className="font-black text-[#4D4338]">{brandMeta.label}</span></div><div className="flex justify-between gap-3"><span className="font-bold text-[#A69C91]">範圍</span><span className="text-right font-black text-[#4D4338]">{scope === "brand" ? "全品牌" : `指定 ${selectedStoreKeys.length} 間店`}</span></div><div className="flex justify-between gap-3"><span className="font-bold text-[#A69C91]">日期</span><span className="text-right font-black text-[#4D4338]">{formatDateRange(selectedDates)}</span></div><div className="flex justify-between gap-3"><span className="font-bold text-[#A69C91]">原因</span><span className="text-right font-black text-[#4D4338]">{effectiveReason || "尚未填寫"}</span></div></div><div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-[11px] font-bold leading-5 text-emerald-700">不會產生 0 元日報；Lifecycle Master Revision 不變。歷史月份會更新 Reporting Calendar month revision 並排入 Summary repair。</div></div>
        <div className="rounded-2xl border border-[#EFE7DA] bg-white p-4"><div className="flex items-start gap-3"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-[#B7863D]" /><div><div className="text-sm font-black text-[#4D4338]">最高管理者保護</div><div className="mt-1 text-[11px] font-bold leading-5 text-[#A69C91]">Backend 會重新驗證 Firebase Login、Trusted Device 與最高管理者密碼。</div></div></div><div className={`mt-3 rounded-xl border px-3 py-2.5 text-xs font-black ${currentDeviceTrust?.status === "trusted" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"}`}>{currentDeviceTrust?.status === "trusted" ? "🛡 目前裝置已信任" : "⚠ 請改用已信任裝置"}</div><button type="button" onClick={openAddConfirmation} disabled={saving || currentDeviceTrust?.status !== "trusted"} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#E8C77A] bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] px-5 py-3 text-sm font-black text-[#5A4225] disabled:opacity-45">{saving ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />} 確認設定休店日</button></div></div></div></Card>}

      {activeMode === "month" && <Card title="月份檢視"><div className="space-y-4"><div className="max-w-sm"><div className="mb-1.5 text-xs font-black text-[#7C7063]">選擇要查看的月份日期</div><SmartDatePicker selectedDate={monthFocusDate} onDateSelect={setMonthFocusDate} /><div className="mt-1 text-[10px] font-bold text-[#A69C91]">使用 SmartCalendar 選任一天，顯示該月份所有休店設定。</div></div><div className="rounded-2xl border border-[#EFE7DA] bg-[#FAF7F1] p-4"><div className="text-sm font-black text-[#4D4338]">{focusMonth || "—"}｜{monthHistory.length} 筆休店設定</div><div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">{monthHistory.map((event) => <div key={`${event.scope}-${event.id}`} className="rounded-xl border border-[#EFE7DA] bg-white p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-black text-[#A69C91]">{formatDateRange(event.dates)}</div><div className="mt-1 text-sm font-black text-[#4D4338]">{event.reason || "休店"}</div></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${event.scope === "brand" ? "border-amber-100 bg-amber-50 text-amber-700" : "border-sky-100 bg-sky-50 text-sky-700"}`}>{event.scope === "brand" ? "全品牌" : `${event.storeKeys?.length || 0} 店`}</span></div>{event.scope === "stores" && <div className="mt-3 flex flex-wrap gap-1.5">{(event.storeRows || []).map((row) => <span key={row.storeKey} className="rounded-full border border-[#EFE7DA] bg-[#FAF7F1] px-2 py-1 text-[10px] font-bold text-[#7C7063]">{row.canonicalStoreName}</span>)}</div>}</div>)}</div>{monthHistory.length === 0 && <div className="py-10 text-center text-xs font-bold text-[#A69C91]">這個月份目前沒有休店設定</div>}</div></div></Card>}

      {activeMode === "history" && <Card title="休店紀錄"><div className="space-y-3">{allHistory.map((event) => <div key={`${event.scope}-${event.id}`} className="rounded-2xl border border-[#EFE7DA] bg-white p-4"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-black text-[#4D4338]">{formatDateRange(event.dates)}</span><span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${event.scope === "brand" ? "border-amber-100 bg-amber-50 text-amber-700" : "border-sky-100 bg-sky-50 text-sky-700"}`}>{event.scope === "brand" ? "全品牌" : `指定 ${event.storeKeys?.length || 0} 店`}</span></div><div className="mt-1 text-xs font-black text-[#7C7063]">{event.reason || "休店"}</div>{event.scope === "stores" && <div className="mt-3 flex flex-wrap gap-1.5">{(event.storeRows || []).map((row) => <span key={row.storeKey} className="rounded-full border border-[#EFE7DA] bg-[#FAF7F1] px-2 py-1 text-[10px] font-bold text-[#7C7063]">{row.canonicalStoreName}</span>)}</div>}{event.scope === "stores" && event.createdBy && <div className="mt-2 text-[10px] font-bold text-[#B0A59A]">設定人：{event.createdBy}{event.createdAtText ? `｜${event.createdAtText}` : ""}</div>}</div><button type="button" onClick={() => openRemoveConfirmation(event)} disabled={saving} className="inline-flex shrink-0 items-center justify-center gap-1 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 disabled:opacity-40"><Trash2 size={14} /> 取消設定</button></div></div>)}{allHistory.length === 0 && <div className="rounded-2xl border-2 border-dashed border-[#EDE2D4] py-12 text-center text-sm font-bold text-[#A69C91]">目前沒有休店紀錄</div>}</div></Card>}

      {credentialDialog && <div className="fixed inset-0 z-[99995] flex items-center justify-center bg-stone-900/35 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCredentialDialog(); }}><div className="w-full max-w-md overflow-hidden rounded-[1.75rem] border border-[#E8DDD0] bg-[#FFFCF8] shadow-[0_24px_80px_rgba(80,62,45,0.22)]"><div className="border-b border-[#EFE7DA] bg-gradient-to-br from-[#FFF9EC] via-white to-[#FFF4DC] px-5 py-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-[#B7863D] shadow-sm"><KeyRound size={19} /></div><div className="min-w-0"><div className="text-base font-black text-[#4D4338]">{credentialDialog.title}</div><p className="mt-1 text-xs font-bold leading-5 text-[#8C8176]">{credentialDialog.description}</p></div></div><button type="button" onClick={closeCredentialDialog} disabled={saving} className="rounded-full p-2 text-[#A69C91] hover:bg-white disabled:opacity-40"><X size={18} /></button></div></div><div className="space-y-4 p-5"><div className={`rounded-xl border px-3 py-2.5 text-xs font-black ${currentDeviceTrust?.status === "trusted" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"}`}>{currentDeviceTrust?.status === "trusted" ? "🛡 目前裝置已信任" : "⚠ 目前裝置尚未信任，無法執行高風險寫入"}</div><label className="block"><span className="mb-2 block text-xs font-black text-[#7C7063]">最高管理者密碼</span><input autoFocus type="password" value={credentialPassword} onChange={(event) => setCredentialPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !saving) confirmCredentialAction(); }} placeholder="輸入目前登入的最高管理者密碼" autoComplete="current-password" className="w-full rounded-xl border-2 border-[#E8DDD0] bg-white px-4 py-3 text-sm font-bold text-[#4D4338] outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-50" /><span className="mt-2 block text-[10px] font-bold leading-5 text-[#A69C91]">密碼只送到 Backend 做本次驗證；不會寫入 Firestore、Lifecycle 或瀏覽器儲存空間。</span></label><div className="grid grid-cols-2 gap-2 pt-1"><button type="button" onClick={closeCredentialDialog} disabled={saving} className="rounded-xl border border-[#E8DDD0] bg-white px-4 py-3 text-sm font-black text-[#7C7063] disabled:opacity-40">取消</button><button type="button" onClick={confirmCredentialAction} disabled={!credentialPassword.trim() || saving || currentDeviceTrust?.status !== "trusted"} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E8C77A] bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] px-4 py-3 text-sm font-black text-[#5A4225] disabled:opacity-45">{saving ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}{saving ? "驗證並處理中…" : "確認並繼續"}</button></div></div></div></div>}
    </div>
  );
};

class ReportingCalendarErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: String(error?.message || "營運日曆畫面載入失敗") };
  }

  componentDidCatch(error, info) {
    console.error("Reporting Calendar UI render failed:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <Card title="營運日曆 / 休店日">
        <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-5">
          <div className="flex items-start gap-3 text-rose-700">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-black">營運日曆暫時無法顯示</div>
              <div className="mt-1 text-xs font-bold leading-5">
                {this.state.message || "請重新進入此分頁。其他系統設定與營運資料不受影響。"}
              </div>
            </div>
          </div>
        </div>
      </Card>
    );
  }
}

const SafeReportingCalendarManager = (props) => (
  <ReportingCalendarErrorBoundary>
    <ReportingCalendarManager {...props} />
  </ReportingCalendarErrorBoundary>
);

export default SafeReportingCalendarManager;
