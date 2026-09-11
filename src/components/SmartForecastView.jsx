// src/components/SmartForecastView.jsx
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import {
  Sparkles,
  CalendarDays,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Save,
  X,
  Store,
  BadgeDollarSign,
  ShieldCheck,
  Info,
} from "lucide-react";

import { AppContext } from "../AppContext";
import { Card, ViewWrapper } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";
import SmartMonthPicker from "./SmartMonthPicker";
import {
  getCanonicalLifecycleStoreName,
  getStoreLifecycleKey,
  normalizeLifecycleBrandId,
} from "../utils/storeLifecycle";

const EVENT_TYPES = [
  { id: "vip", label: "VIP實體活動" },
  { id: "anniversary", label: "週年慶" },
  { id: "seasonal", label: "節慶活動" },
  { id: "promotion", label: "大型促銷" },
  { id: "launch", label: "新品／療程活動" },
  { id: "other", label: "其他活動" },
];

const EVENT_LEVELS = [
  { id: "normal", label: "一般" },
  { id: "notable", label: "明顯" },
  { id: "major", label: "大型" },
];

const METRIC_LABELS = {
  cash: "現金",
  accrual: "權責",
};

const UNASSIGNED_KEY = "未分配";

const LOCAL_PREVIEW_STORAGE_PREFIX = "drcyj:projection-context-preview:v2";

const getLocalPreviewActorKey = (currentUser = {}) => String(
  currentUser?.uid ||
  currentUser?.userId ||
  currentUser?.id ||
  currentUser?.accountId ||
  currentUser?.username ||
  currentUser?.email ||
  currentUser?.name ||
  "anonymous"
).trim() || "anonymous";

const buildLocalPreviewStorageKey = ({ actorKey = "anonymous", brandId = "unknown", yearMonth = "" } = {}) => (
  [
    LOCAL_PREVIEW_STORAGE_PREFIX,
    encodeURIComponent(String(actorKey || "anonymous")),
    String(brandId || "unknown"),
    String(yearMonth || ""),
  ].join("|")
);

const readLocalPreviewContext = (storageKey, yearMonth) => {
  if (!storageKey || typeof globalThis?.localStorage?.getItem !== "function") return null;
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (payload?.schemaVersion !== "projection-context-local-preview-v1") return null;
    if (String(payload?.context?.yearMonth || "") !== String(yearMonth || "")) return null;
    return payload.context || null;
  } catch (error) {
    console.warn("智慧推估本機預覽讀取失敗:", error);
    return null;
  }
};

const writeLocalPreviewContext = (storageKey, context) => {
  if (!storageKey || typeof globalThis?.localStorage?.setItem !== "function") return false;
  try {
    globalThis.localStorage.setItem(storageKey, JSON.stringify({
      schemaVersion: "projection-context-local-preview-v1",
      savedAtText: new Date().toISOString(),
      context,
    }));
    return true;
  } catch (error) {
    console.warn("智慧推估本機預覽儲存失敗:", error);
    return false;
  }
};

const removeLocalPreviewContext = (storageKey) => {
  if (!storageKey || typeof globalThis?.localStorage?.removeItem !== "function") return false;
  try {
    globalThis.localStorage.removeItem(storageKey);
    return true;
  } catch (error) {
    console.warn("智慧推估本機預覽清除失敗:", error);
    return false;
  }
};


const emptyContext = (yearMonth = "") => ({
  schemaVersion: "projection-context-v2",
  yearMonth,
  revision: 0,
  mode: "normal_month",
  events: [],
  updatedAtText: "",
  updatedBy: "",
});

const monthLastDate = (yearMonth = "") => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(yearMonth || ""))) return "";
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
};

const createEventDraft = (yearMonth = "") => ({
  id: "",
  name: "",
  type: "promotion",
  startDate: `${yearMonth}-01`,
  endDate: monthLastDate(yearMonth),
  level: "notable",
  scopeMode: "brand",
  storeKeys: [],
  storeSchedule: [],
  metrics: ["cash", "accrual"],
  note: "",
});

const normalizeStoreLabel = (value) => {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(
    value.canonicalStoreName ||
    value.storeName ||
    value.name ||
    value.label ||
    value.storeKey ||
    value.coreStoreName ||
    ""
  ).trim();
};

const normalizeLoadedContext = (data = {}, yearMonth = "") => ({
  schemaVersion: String(data?.schemaVersion || "projection-context-v2"),
  yearMonth: String(data?.yearMonth || yearMonth),
  revision: Math.max(0, Number(data?.revision || 0)),
  mode: Array.isArray(data?.events) && data.events.length ? "event_month" : "normal_month",
  events: (Array.isArray(data?.events) ? data.events : []).map((event = {}) => ({
    ...event,
    campaignId: String(event?.campaignId || event?.id || ""),
    storeKeys: Array.isArray(event?.storeKeys) ? event.storeKeys : [],
    storeSchedule: Array.isArray(event?.storeSchedule) ? event.storeSchedule : [],
    metrics: Array.isArray(event?.metrics) ? event.metrics : [],
  })),
  updatedAtText: String(data?.updatedAtText || ""),
  updatedBy: String(data?.updatedBy || ""),
});


const eventTypeLabel = (value) => EVENT_TYPES.find((item) => item.id === value)?.label || "其他活動";
const eventLevelLabel = (value) => EVENT_LEVELS.find((item) => item.id === value)?.label || "一般";

const SmartForecastView = () => {
  const {
    currentBrand,
    getCollectionPath,
    officialStores = [],
    managers = {},
    managerOrder = [],
    showToast,
    userRole,
    currentUser,
    currentDeviceTrust,
    systemExclusionState,
    canManageDeviceSecurity,
    updateProjectionContext,
  } = useContext(AppContext);

  const today = new Date();
  const initialMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [contextState, setContextState] = useState(emptyContext(initialMonth));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(createEventDraft(initialMonth));
  const [editingEventId, setEditingEventId] = useState("");
  const [selectedManager, setSelectedManager] = useState("");
  const [scheduleStoreKey, setScheduleStoreKey] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState({ startDate: "", endDate: "" });
  const cacheRef = useRef(new Map());

  const localPreviewMode =
    import.meta.env.DEV &&
    String(import.meta.env.VITE_PROJECTION_CONTEXT_LIVE_WRITE || "").toLowerCase() !== "true";

  const directorLevel =
    currentUser?.directorLevel ||
    currentUser?.adminLevel ||
    (String(currentUser?.name || "").includes("Joe") ? "super_admin" : "operation_admin");

  const canEdit =
    userRole === "director" &&
    (currentUser?.isMasterLogin === true || directorLevel === "super_admin") &&
    canManageDeviceSecurity === true;

  const brandId = useMemo(() => normalizeLifecycleBrandId(currentBrand), [currentBrand]);

  const brandLabel = useMemo(() => {
    if (brandId === "anniu") return "安妞";
    if (brandId === "yibo") return "伊啵";
    return "CYJ";
  }, [brandId]);

  const contextCacheKey = useMemo(
    () => `${brandId || "unknown"}|${selectedMonth}`,
    [brandId, selectedMonth]
  );

  const localPreviewActorKey = useMemo(
    () => getLocalPreviewActorKey(currentUser),
    [currentUser]
  );

  const localPreviewStorageKey = useMemo(
    () => buildLocalPreviewStorageKey({
      actorKey: localPreviewActorKey,
      brandId,
      yearMonth: selectedMonth,
    }),
    [brandId, localPreviewActorKey, selectedMonth]
  );

  const excludedStoreKeySet = useMemo(() => {
    if (systemExclusionState?.ready !== true) return new Set();
    const source = systemExclusionState?.storeSet instanceof Set
      ? [...systemExclusionState.storeSet]
      : (Array.isArray(systemExclusionState?.stores) ? systemExclusionState.stores : []);
    return new Set(source.map(getStoreLifecycleKey).filter(Boolean));
  }, [systemExclusionState]);

  const officialStoreDirectory = useMemo(() => {
    const map = new Map();
    (Array.isArray(officialStores) ? officialStores : []).forEach((value) => {
      const label = normalizeStoreLabel(value);
      const storeKey = getStoreLifecycleKey(label);
      if (!storeKey || excludedStoreKeySet.has(storeKey)) return;
      map.set(storeKey, getCanonicalLifecycleStoreName(label || storeKey, brandId));
    });
    return map;
  }, [brandId, excludedStoreKeySet, officialStores]);

  const managerRows = useMemo(() => {
    const source = managers && typeof managers === "object" ? managers : {};
    const rawManagerNames = Object.keys(source).filter((name) => name && name !== UNASSIGNED_KEY);
    const orderedNames = [];
    const seenManagers = new Set();

    (Array.isArray(managerOrder) ? managerOrder : []).forEach((name) => {
      if (!rawManagerNames.includes(name) || seenManagers.has(name)) return;
      seenManagers.add(name);
      orderedNames.push(name);
    });
    rawManagerNames
      .filter((name) => !seenManagers.has(name))
      .sort((a, b) => String(a).localeCompare(String(b), "zh-Hant", { numeric: true, sensitivity: "base" }))
      .forEach((name) => orderedNames.push(name));

    const usedStoreKeys = new Set();
    const rows = orderedNames.map((managerName) => {
      const stores = [...new Set(Array.isArray(source[managerName]) ? source[managerName] : [])]
        .map((storeName) => {
          const storeKey = getStoreLifecycleKey(storeName);
          if (!storeKey) return null;
          if (officialStoreDirectory.size > 0 && !officialStoreDirectory.has(storeKey)) return null;
          usedStoreKeys.add(storeKey);
          return {
            storeKey,
            label: officialStoreDirectory.get(storeKey) ||
              getCanonicalLifecycleStoreName(storeName || storeKey, brandId),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.label.localeCompare(b.label, "zh-Hant", { numeric: true, sensitivity: "base" }));
      return { managerName, stores };
    }).filter((row) => row.stores.length > 0);

    const unassignedStores = [...officialStoreDirectory.entries()]
      .filter(([storeKey]) => !usedStoreKeys.has(storeKey))
      .map(([storeKey, label]) => ({ storeKey, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-Hant", { numeric: true, sensitivity: "base" }));

    if (unassignedStores.length > 0) {
      rows.push({ managerName: "其他／未分配", stores: unassignedStores });
    }
    return rows;
  }, [brandId, managerOrder, managers, officialStoreDirectory]);

  const selectedManagerRow = useMemo(
    () => managerRows.find((row) => row.managerName === selectedManager) || null,
    [managerRows, selectedManager]
  );

  const selectedStoreRows = useMemo(() => {
    const directory = new Map();
    managerRows.forEach((row) => {
      row.stores.forEach((store) => directory.set(store.storeKey, {
        ...store,
        managerName: row.managerName,
      }));
    });
    return (draft.storeKeys || []).map((storeKey) => (
      directory.get(storeKey) || { storeKey, label: storeKey, managerName: "其他" }
    ));
  }, [draft.storeKeys, managerRows]);

  const storeDirectory = useMemo(() => {
    const directory = new Map();
    managerRows.forEach((row) => {
      row.stores.forEach((store) => directory.set(store.storeKey, {
        ...store,
        managerName: row.managerName,
      }));
    });
    return directory;
  }, [managerRows]);

  const scheduleManagerRows = useMemo(() => {
    const scopedStoreKeys = draft.scopeMode === "stores"
      ? new Set(Array.isArray(draft.storeKeys) ? draft.storeKeys : [])
      : null;
    return managerRows
      .map((row) => ({
        ...row,
        stores: row.stores.filter((store) => !scopedStoreKeys || scopedStoreKeys.has(store.storeKey)),
      }))
      .filter((row) => row.stores.length > 0);
  }, [draft.scopeMode, draft.storeKeys, managerRows]);

  const selectedScheduleManagerRow = useMemo(
    () => scheduleManagerRows.find((row) => row.managerName === selectedManager) || null,
    [scheduleManagerRows, selectedManager]
  );

  const scheduledStoreRows = useMemo(() => (
    (Array.isArray(draft.storeSchedule) ? draft.storeSchedule : []).map((row) => ({
      ...row,
      ...(storeDirectory.get(row.storeKey) || {
        label: row.storeKey,
        managerName: "其他",
      }),
    }))
  ), [draft.storeSchedule, storeDirectory]);

  const loadMonth = useCallback(async ({ force = false } = {}) => {
    if (!selectedMonth || typeof getCollectionPath !== "function") return;

    if (!force && cacheRef.current.has(contextCacheKey)) {
      setContextState(cacheRef.current.get(contextCacheKey));
      setLoading(false);
      return;
    }

    if (localPreviewMode && !force) {
      const persistedPreview = readLocalPreviewContext(localPreviewStorageKey, selectedMonth);
      if (persistedPreview) {
        const next = normalizeLoadedContext(persistedPreview, selectedMonth);
        cacheRef.current.set(contextCacheKey, next);
        setContextState(next);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    try {
      const snap = await getDoc(doc(getCollectionPath("projection_context"), selectedMonth));
      const next = normalizeLoadedContext(snap.exists() ? snap.data() : {}, selectedMonth);

      if (localPreviewMode && force) {
        removeLocalPreviewContext(localPreviewStorageKey);
      }

      cacheRef.current.set(contextCacheKey, next);
      setContextState(next);

      if (localPreviewMode && force) {
        showToast?.("已清除這個品牌與月份的本機預覽，並重新讀取正式資料", "success");
      }
    } catch (error) {
      console.error("智慧推估月份資訊讀取失敗:", error);
      showToast?.("目前無法讀取本月活動資訊，請稍後再試", "error");
      setContextState(emptyContext(selectedMonth));
    } finally {
      setLoading(false);
    }
  }, [
    contextCacheKey,
    getCollectionPath,
    localPreviewMode,
    localPreviewStorageKey,
    selectedMonth,
    showToast,
  ]);

  useEffect(() => {
    setEditing(false);
    setEditingEventId("");
    setSelectedManager("");
    setScheduleStoreKey("");
    setScheduleDraft({ startDate: "", endDate: "" });
    setDraft(createEventDraft(selectedMonth));
    loadMonth();
  }, [selectedMonth, loadMonth]);

  const openNewEvent = () => {
    setEditingEventId("");
    setSelectedManager("");
    setScheduleStoreKey("");
    setScheduleDraft({ startDate: "", endDate: "" });
    setDraft(createEventDraft(selectedMonth));
    setEditing(true);
  };

  const openEditEvent = (event) => {
    const nextStoreKeys = Array.isArray(event?.storeKeys) ? [...event.storeKeys] : [];
    const firstManager = managerRows.find((row) =>
      row.stores.some((store) => nextStoreKeys.includes(store.storeKey))
    )?.managerName || "";
    setEditingEventId(String(event?.id || ""));
    setSelectedManager(firstManager);
    setDraft({
      ...createEventDraft(selectedMonth),
      ...event,
      campaignId: String(event?.campaignId || event?.id || ""),
      storeKeys: nextStoreKeys,
      storeSchedule: Array.isArray(event?.storeSchedule)
        ? event.storeSchedule.map((row) => ({ ...row }))
        : [],
      metrics: Array.isArray(event?.metrics) ? [...event.metrics] : ["cash", "accrual"],
    });
    setScheduleStoreKey("");
    setScheduleDraft({ startDate: "", endDate: "" });
    setEditing(true);
  };

  const closeEditor = () => {
    setEditing(false);
    setEditingEventId("");
    setSelectedManager("");
    setScheduleStoreKey("");
    setScheduleDraft({ startDate: "", endDate: "" });
    setDraft(createEventDraft(selectedMonth));
  };

  const toggleMetric = (metric) => {
    setDraft((prev) => {
      const current = new Set(Array.isArray(prev.metrics) ? prev.metrics : []);
      if (current.has(metric)) current.delete(metric);
      else current.add(metric);
      return { ...prev, metrics: [...current] };
    });
  };

  const toggleStore = (storeKey) => {
    setDraft((prev) => {
      const current = new Set(Array.isArray(prev.storeKeys) ? prev.storeKeys : []);
      const removing = current.has(storeKey);
      if (removing) current.delete(storeKey);
      else current.add(storeKey);
      return {
        ...prev,
        storeKeys: [...current],
        storeSchedule: removing
          ? (prev.storeSchedule || []).filter((row) => row.storeKey !== storeKey)
          : (prev.storeSchedule || []),
      };
    });
    if (scheduleStoreKey === storeKey) {
      setScheduleStoreKey("");
      setScheduleDraft({ startDate: "", endDate: "" });
    }
  };

  const selectAllCurrentManagerStores = () => {
    const keys = (selectedManagerRow?.stores || []).map((store) => store.storeKey);
    setDraft((prev) => ({
      ...prev,
      storeKeys: [...new Set([...(prev.storeKeys || []), ...keys])],
    }));
  };

  const clearCurrentManagerStores = () => {
    const managerKeys = new Set((selectedManagerRow?.stores || []).map((store) => store.storeKey));
    setDraft((prev) => ({
      ...prev,
      storeKeys: (prev.storeKeys || []).filter((storeKey) => !managerKeys.has(storeKey)),
      storeSchedule: (prev.storeSchedule || []).filter((row) => !managerKeys.has(row.storeKey)),
    }));
    if (managerKeys.has(scheduleStoreKey)) {
      setScheduleStoreKey("");
      setScheduleDraft({ startDate: "", endDate: "" });
    }
  };

  const openScheduleEditor = (storeKey) => {
    const current = (draft.storeSchedule || []).find((row) => row.storeKey === storeKey) || null;
    setScheduleStoreKey(storeKey);
    setScheduleDraft({
      startDate: current?.startDate || draft.startDate || `${selectedMonth}-01`,
      endDate: current?.endDate || current?.startDate || draft.startDate || `${selectedMonth}-01`,
    });
  };

  const closeScheduleEditor = () => {
    setScheduleStoreKey("");
    setScheduleDraft({ startDate: "", endDate: "" });
  };

  const applyScheduleDraft = () => {
    if (!scheduleStoreKey) return;
    const scheduleStart = String(scheduleDraft.startDate || "");
    const scheduleEnd = String(scheduleDraft.endDate || scheduleStart);
    if (!scheduleStart || !scheduleEnd) {
      showToast?.("請設定店家活動日期", "error");
      return;
    }
    if (!scheduleStart.startsWith(`${selectedMonth}-`) || !scheduleEnd.startsWith(`${selectedMonth}-`)) {
      showToast?.("店家活動日期必須設定在目前月份", "error");
      return;
    }
    if (scheduleStart > scheduleEnd) {
      showToast?.("店家活動結束日不可早於開始日", "error");
      return;
    }
    if (scheduleStart < draft.startDate || scheduleEnd > draft.endDate) {
      showToast?.("店家活動日期必須落在整體活動期間內", "error");
      return;
    }

    setDraft((prev) => {
      const withoutStore = (prev.storeSchedule || []).filter((row) => row.storeKey !== scheduleStoreKey);
      const storeSchedule = [...withoutStore, {
        storeKey: scheduleStoreKey,
        startDate: scheduleStart,
        endDate: scheduleEnd,
      }].sort((a, b) =>
        String(a.startDate || "").localeCompare(String(b.startDate || "")) ||
        String(a.storeKey || "").localeCompare(String(b.storeKey || ""), "zh-Hant")
      );
      return { ...prev, storeSchedule };
    });
    closeScheduleEditor();
  };

  const removeStoreSchedule = (storeKey) => {
    setDraft((prev) => ({
      ...prev,
      storeSchedule: (prev.storeSchedule || []).filter((row) => row.storeKey !== storeKey),
    }));
    if (scheduleStoreKey === storeKey) closeScheduleEditor();
  };

  const validateDraft = () => {
    if (!String(draft.name || "").trim()) return "請先輸入活動名稱";
    if (!draft.startDate || !draft.endDate) return "請設定活動期間";
    if (!draft.startDate.startsWith(`${selectedMonth}-`) || !draft.endDate.startsWith(`${selectedMonth}-`)) {
      return "第一階段請將活動日期設定在同一個月份內";
    }
    if (draft.startDate > draft.endDate) return "活動結束日不可早於開始日";
    if (!Array.isArray(draft.metrics) || draft.metrics.length === 0) return "請至少選擇一項主要影響";
    if (draft.scopeMode === "stores" && (!Array.isArray(draft.storeKeys) || draft.storeKeys.length === 0)) {
      return "指定店家時，請至少選擇一間店";
    }
    const selectedStoreSet = new Set(Array.isArray(draft.storeKeys) ? draft.storeKeys : []);
    const seenScheduleStores = new Set();
    for (const row of (Array.isArray(draft.storeSchedule) ? draft.storeSchedule : [])) {
      if (!row?.storeKey || seenScheduleStores.has(row.storeKey)) return "店家活動日期有重複店家";
      seenScheduleStores.add(row.storeKey);
      if (draft.scopeMode === "stores" && !selectedStoreSet.has(row.storeKey)) {
        return "店家活動日期包含未選入活動範圍的店家";
      }
      if (!row?.startDate || !row?.endDate || row.startDate > row.endDate) return "店家活動日期設定不完整";
      if (row.startDate < draft.startDate || row.endDate > draft.endDate) {
        return "店家活動日期必須落在整體活動期間內";
      }
    }
    return "";
  };

  const applyDraftToLocalList = () => {
    const validationMessage = validateDraft();
    if (validationMessage) {
      showToast?.(validationMessage, "error");
      return;
    }

    const eventId =
      editingEventId ||
      (globalThis.crypto?.randomUUID?.() || `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    const normalizedDraft = {
      id: eventId,
      campaignId: String(draft.campaignId || eventId),
      name: String(draft.name || "").trim(),
      type: draft.type,
      startDate: draft.startDate,
      endDate: draft.endDate,
      level: draft.level,
      scopeMode: draft.scopeMode,
      storeKeys: draft.scopeMode === "stores" ? [...new Set(draft.storeKeys || [])] : [],
      storeSchedule: (Array.isArray(draft.storeSchedule) ? draft.storeSchedule : [])
        .map((row) => ({
          storeKey: row.storeKey,
          startDate: row.startDate,
          endDate: row.endDate || row.startDate,
        }))
        .sort((a, b) =>
          String(a.startDate || "").localeCompare(String(b.startDate || "")) ||
          String(a.storeKey || "").localeCompare(String(b.storeKey || ""), "zh-Hant")
        ),
      metrics: [...new Set(draft.metrics || [])],
      note: String(draft.note || "").trim(),
    };

    setContextState((prev) => {
      const withoutCurrent = (prev.events || []).filter((item) => item.id !== editingEventId);
      const events = [...withoutCurrent, normalizedDraft].sort((a, b) =>
        String(a.startDate || "").localeCompare(String(b.startDate || "")) ||
        String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant")
      );
      return { ...prev, mode: events.length ? "event_month" : "normal_month", events };
    });

    closeEditor();
  };

  const removeEvent = (eventId) => {
    setContextState((prev) => {
      const events = (prev.events || []).filter((item) => item.id !== eventId);
      return { ...prev, mode: events.length ? "event_month" : "normal_month", events };
    });
  };

  const saveMonth = async () => {
    if (!canEdit) {
      showToast?.("目前帳號只有查看權限", "error");
      return;
    }

    if (localPreviewMode) {
      const next = {
        ...contextState,
        revision: Math.max(0, Number(contextState.revision || 0)) + 1,
        updatedAtText: new Date().toISOString(),
        updatedBy: currentUser?.name || "本機預覽",
      };
      const persisted = writeLocalPreviewContext(localPreviewStorageKey, next);
      cacheRef.current.set(contextCacheKey, next);
      setContextState(next);
      showToast?.(
        persisted
          ? "本機預覽已保存在這台瀏覽器，沒有寫入正式資料"
          : "本機預覽已更新，但瀏覽器無法保存；登出或重新整理後可能消失",
        persisted ? "success" : "error"
      );
      return;
    }

    if (typeof updateProjectionContext !== "function") {
      showToast?.("智慧推估安全服務尚未就緒", "error");
      return;
    }

    setSaving(true);
    try {
      const result = await updateProjectionContext({
        yearMonth: selectedMonth,
        events: contextState.events || [],
        expectedRevision: Math.max(0, Number(contextState.revision || 0)),
      });
      const next = normalizeLoadedContext(result?.context || {}, selectedMonth);
      cacheRef.current.set(contextCacheKey, next);
      setContextState(next);
      showToast?.("本月活動資訊已更新", "success");
    } catch (error) {
      console.error("智慧推估月份資訊儲存失敗:", error);
      if (error?.code === "PROJECTION_CONTEXT_CONFLICT" && error?.currentContext) {
        const latest = normalizeLoadedContext(error.currentContext, selectedMonth);
        cacheRef.current.set(contextCacheKey, latest);
        setContextState(latest);
      }
      showToast?.(error?.message || "活動資訊更新失敗，請稍後再試", "error");
    } finally {
      setSaving(false);
    }
  };

  const monthModeLabel = (contextState.events || []).length > 0 ? "活動月份" : "一般月份";

  return (
    <ViewWrapper
      title="智慧推估"
      subtitle="讓系統先理解這個月的營運情境，之後再用實際結果逐步提升推估準確度。"
    >
      <div className="space-y-5">
        {localPreviewMode && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-3">
            <Info size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">本機測試模式</p>
              <p className="mt-1 text-amber-700">
                你可以完整測試月份、活動新增、修改與刪除；按下儲存只會保存在這台瀏覽器的本機測試資料，不會寫入正式資料。
                重新整理或登出再登入後仍會保留；按「更新」可清除目前品牌／月份的本機預覽並重新讀取正式資料。
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5">
          <Card className="p-5 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-stone-800">
                  <Sparkles size={20} className="text-amber-500" />
                  <h2 className="font-extrabold text-lg">{brandLabel} 本月情境</h2>
                </div>
                <p className="text-sm text-stone-500 mt-1">
                  目前推估數字仍維持原本正式算法；這裡先建立活動資訊，不會直接改動月底推估。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <SmartMonthPicker
                  value={selectedMonth}
                  onChange={setSelectedMonth}
                />
                <button
                  type="button"
                  onClick={() => loadMonth({ force: true })}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                >
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                  更新
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-stone-50 border border-stone-100 p-4">
                <p className="text-xs font-bold text-stone-400">本月情境</p>
                <p className="text-lg font-extrabold text-stone-800 mt-1">{monthModeLabel}</p>
              </div>
              <div className="rounded-2xl bg-stone-50 border border-stone-100 p-4">
                <p className="text-xs font-bold text-stone-400">已設定活動</p>
                <p className="text-lg font-extrabold text-stone-800 mt-1">
                  {(contextState.events || []).length} 個
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {canEdit && (
                <button
                  type="button"
                  onClick={openNewEvent}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white px-4 py-2.5 text-sm font-bold shadow-sm shadow-amber-100"
                >
                  <Plus size={17} />
                  新增活動
                </button>
              )}
              <span className="inline-flex items-center gap-2 text-xs font-bold text-stone-400">
                <ShieldCheck size={15} />
                {canEdit ? "最高管理者可設定" : "依權限開放查看；活動維護目前限最高管理者"}
              </span>
            </div>
          </Card>

          <Card className="p-5 md:p-6">
            <div className="flex items-center gap-2 text-stone-800">
              <BadgeDollarSign size={20} className="text-rose-400" />
              <h2 className="font-extrabold text-lg">推估方式</h2>
            </div>
            <div className="mt-4 rounded-2xl bg-[#FAF7F1] border border-[#EEE6DA] p-4">
              <p className="font-bold text-stone-700">目前正式推估維持不變</p>
              <p className="text-sm text-stone-500 leading-6 mt-2">
                這一階段只讓系統開始累積活動情境。等資料足夠後，才會比較一般月份與活動月份的差異，再決定是否採用新的智慧校正方式。
              </p>
            </div>
            <div className="mt-4 text-xs text-stone-400 leading-5">
              不會因為新增活動，就立即把推估數字往上或往下調整。
            </div>
          </Card>
        </div>

        <Card className="p-5 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CalendarDays size={20} className="text-stone-500" />
                <h2 className="font-extrabold text-lg text-stone-800">本月活動</h2>
              </div>
              <p className="text-sm text-stone-500 mt-1">只記錄會明顯影響當月營運節奏的活動即可。</p>
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-stone-400">正在讀取本月資訊...</div>
          ) : (contextState.events || []).length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-stone-200 bg-stone-50/70 py-10 text-center">
              <Sparkles size={28} className="mx-auto text-stone-300" />
              <p className="font-bold text-stone-600 mt-3">目前沒有設定特殊活動</p>
              <p className="text-sm text-stone-400 mt-1">系統會先把這個月視為一般月份。</p>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-3">
              {(contextState.events || []).map((event) => (
                <div key={event.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-extrabold text-stone-800 truncate">{event.name}</p>
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">
                          {eventTypeLabel(event.type)}
                        </span>
                        <span className="rounded-full bg-stone-100 px-2 py-1 text-[11px] font-bold text-stone-600">
                          {eventLevelLabel(event.level)}
                        </span>
                      </div>
                      <p className="text-sm text-stone-500 mt-2">
                        {event.startDate} ～ {event.endDate}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditEvent(event)}
                          className="p-2 rounded-lg text-stone-400 hover:text-amber-600 hover:bg-amber-50"
                          title="修改"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeEvent(event.id)}
                          className="p-2 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                          title="刪除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-stone-50 px-2.5 py-1.5 text-stone-600">
                      <Store size={13} />
                      {event.scopeMode === "stores"
                        ? `指定 ${(event.storeKeys || []).length} 間店`
                        : "全品牌"}
                    </span>
                    {(event.storeSchedule || []).length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-700">
                        <CalendarDays size={13} />
                        已排 {(event.storeSchedule || []).length} 間店日期
                      </span>
                    )}
                    {(event.metrics || []).map((metric) => (
                      <span
                        key={metric}
                        className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-rose-600"
                      >
                        {METRIC_LABELS[metric] || metric}
                      </span>
                    ))}
                  </div>

                  {event.note && (
                    <p className="mt-3 text-sm leading-6 text-stone-500">{event.note}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit && !loading && (
            <div className="mt-5 pt-5 border-t border-stone-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs text-stone-400">
                {localPreviewMode
                  ? "本機預覽只保存在這台瀏覽器，不會寫入雲端；按「更新」可清除本月預覽並回到正式資料。"
                  : currentDeviceTrust?.status === "trusted"
                    ? "儲存時會再次確認最高管理者與信任裝置。"
                    : "目前裝置尚未完成信任確認，正式環境無法儲存。"}
              </p>
              <button
                type="button"
                onClick={saveMonth}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-400 hover:bg-rose-500 text-white px-5 py-2.5 text-sm font-bold disabled:opacity-50"
              >
                <Save size={17} />
                {saving ? "儲存中..." : localPreviewMode ? "套用本機預覽" : "儲存本月設定"}
              </button>
            </div>
          )}
        </Card>

        {editing && (
          <div className="fixed inset-0 z-[90] bg-stone-900/25 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-5">
            <div className="w-full md:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-3xl md:rounded-3xl bg-white shadow-2xl">
              <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-stone-100 px-5 md:px-6 py-4 flex items-center justify-between z-10">
                <div>
                  <h3 className="font-extrabold text-stone-800">
                    {editingEventId ? "修改活動" : "新增活動"}
                  </h3>
                  <p className="text-xs text-stone-400 mt-1">只填營運人員看得懂、真正會影響本月的資訊。</p>
                </div>
                <button type="button" onClick={closeEditor} className="p-2 rounded-xl hover:bg-stone-100 text-stone-400">
                  <X size={20} />
                </button>
              </div>

              <div className="p-5 md:p-6 space-y-5">
                <label className="block">
                  <span className="text-sm font-bold text-stone-700">活動名稱</span>
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="例如：CYJ 週年慶"
                    maxLength={60}
                    className="mt-2 w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-200"
                  />
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label>
                    <span className="text-sm font-bold text-stone-700">活動類型</span>
                    <select
                      value={draft.type}
                      onChange={(event) => setDraft((prev) => ({ ...prev, type: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm"
                    >
                      {EVENT_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="text-sm font-bold text-stone-700">活動程度</span>
                    <select
                      value={draft.level}
                      onChange={(event) => setDraft((prev) => ({ ...prev, level: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm"
                    >
                      {EVENT_LEVELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-bold text-stone-700">開始日期</span>
                    <div className="mt-2">
                      <SmartDatePicker
                        selectedDate={draft.startDate}
                        onDateSelect={(date) => setDraft((prev) => ({ ...prev, startDate: date }))}
                        stores={[]}
                        salesData={[]}
                        minDate={`${selectedMonth}-01`}
                        maxDate={monthLastDate(selectedMonth)}
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-sm font-bold text-stone-700">結束日期</span>
                    <div className="mt-2">
                      <SmartDatePicker
                        selectedDate={draft.endDate}
                        onDateSelect={(date) => setDraft((prev) => ({ ...prev, endDate: date }))}
                        stores={[]}
                        salesData={[]}
                        minDate={`${selectedMonth}-01`}
                        maxDate={monthLastDate(selectedMonth)}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <span className="text-sm font-bold text-stone-700">主要影響</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(METRIC_LABELS).map(([metric, label]) => {
                      const active = (draft.metrics || []).includes(metric);
                      return (
                        <button
                          key={metric}
                          type="button"
                          onClick={() => toggleMetric(metric)}
                          className={`rounded-xl px-4 py-2 text-sm font-bold border ${
                            active
                              ? "bg-rose-50 border-rose-200 text-rose-600"
                              : "bg-white border-stone-200 text-stone-400"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <span className="text-sm font-bold text-stone-700">影響範圍</span>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, scopeMode: "brand", storeKeys: [] }))}
                      className={`rounded-xl border px-4 py-3 text-sm font-bold ${
                        draft.scopeMode === "brand"
                          ? "bg-amber-50 border-amber-200 text-amber-700"
                          : "bg-white border-stone-200 text-stone-500"
                      }`}
                    >
                      全品牌
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => ({
                        ...prev,
                        scopeMode: "stores",
                        storeKeys: prev.storeKeys?.length
                          ? prev.storeKeys
                          : [...new Set((prev.storeSchedule || []).map((row) => row.storeKey))],
                      }))}
                      className={`rounded-xl border px-4 py-3 text-sm font-bold ${
                        draft.scopeMode === "stores"
                          ? "bg-amber-50 border-amber-200 text-amber-700"
                          : "bg-white border-stone-200 text-stone-500"
                      }`}
                    >
                      指定店家
                    </button>
                  </div>
                </div>

                {draft.scopeMode === "stores" && (
                  <div className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50/60 p-4">
                    {managerRows.length === 0 ? (
                      <p className="text-sm text-stone-400">目前沒有可選擇的店家。</p>
                    ) : (
                      <>
                        <div>
                          <span className="text-xs font-bold text-stone-500">先選區長／區域</span>
                          <select
                            value={selectedManager}
                            onChange={(event) => setSelectedManager(event.target.value)}
                            className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-bold text-stone-700"
                          >
                            <option value="">請選擇</option>
                            {managerRows.map((row) => (
                              <option key={row.managerName} value={row.managerName}>
                                {row.managerName}（{row.stores.length} 間）
                              </option>
                            ))}
                          </select>
                        </div>

                        {selectedManagerRow ? (
                          <div className="rounded-2xl border border-stone-200 bg-white p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-extrabold text-stone-700">{selectedManagerRow.managerName}</p>
                                <p className="text-[11px] font-bold text-stone-400 mt-0.5">
                                  只顯示這個區域的店家，不會一次塞出全品牌名單。
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={selectAllCurrentManagerStores}
                                  className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-700"
                                >
                                  全選此區
                                </button>
                                <button
                                  type="button"
                                  onClick={clearCurrentManagerStores}
                                  className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-stone-500"
                                >
                                  清除此區
                                </button>
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                              {selectedManagerRow.stores.map((store) => {
                                const active = (draft.storeKeys || []).includes(store.storeKey);
                                return (
                                  <button
                                    key={store.storeKey}
                                    type="button"
                                    onClick={() => toggleStore(store.storeKey)}
                                    className={`rounded-xl border px-3 py-2 text-xs font-bold text-left ${
                                      active
                                        ? "bg-amber-50 border-amber-300 text-amber-700"
                                        : "bg-white border-stone-200 text-stone-500"
                                    }`}
                                  >
                                    {store.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-stone-200 bg-white px-3 py-4 text-center text-xs font-bold text-stone-400">
                            選擇區長／區域後，再挑選需要的店家。
                          </div>
                        )}

                        {(draft.storeKeys || []).length > 0 && (
                          <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-extrabold text-amber-800">
                                已選 {(draft.storeKeys || []).length} 間店
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  setDraft((prev) => ({ ...prev, storeKeys: [], storeSchedule: [] }));
                                  closeScheduleEditor();
                                }}
                                className="text-[11px] font-bold text-amber-700"
                              >
                                全部清除
                              </button>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {selectedStoreRows.map((store) => (
                                <button
                                  type="button"
                                  key={store.storeKey}
                                  onClick={() => toggleStore(store.storeKey)}
                                  className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-700"
                                  title="點一下移除"
                                >
                                  {store.label} ×
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div className="rounded-2xl border border-amber-100 bg-amber-50/40 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-extrabold text-stone-700">各店活動日期（選填）</p>
                    <p className="mt-1 text-xs leading-5 text-stone-500">
                      如果同一個活動由不同店家分批舉辦，可把每間店真正排定的日期記在這裡。
                      沒有設定店家日期時，仍只保留上方整體活動期間。
                    </p>
                  </div>

                  {scheduleManagerRows.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-stone-200 bg-white px-3 py-4 text-center text-xs font-bold text-stone-400">
                      目前沒有可設定日期的店家。
                    </p>
                  ) : (
                    <>
                      <div>
                        <span className="text-xs font-bold text-stone-500">先選區長／區域</span>
                        <select
                          value={selectedManager}
                          onChange={(event) => {
                            setSelectedManager(event.target.value);
                            closeScheduleEditor();
                          }}
                          className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-bold text-stone-700"
                        >
                          <option value="">請選擇</option>
                          {scheduleManagerRows.map((row) => (
                            <option key={row.managerName} value={row.managerName}>
                              {row.managerName}（{row.stores.length} 間）
                            </option>
                          ))}
                        </select>
                      </div>

                      {selectedScheduleManagerRow && (
                        <div className="rounded-2xl border border-stone-200 bg-white p-3">
                          <div className="space-y-2">
                            {selectedScheduleManagerRow.stores.map((store) => {
                              const schedule = (draft.storeSchedule || []).find((row) => row.storeKey === store.storeKey) || null;
                              return (
                                <div
                                  key={store.storeKey}
                                  className="flex flex-col gap-2 rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2.5 md:flex-row md:items-center md:justify-between"
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold text-stone-700">{store.label}</p>
                                    <p className="mt-0.5 text-[11px] font-bold text-stone-400">
                                      {schedule
                                        ? schedule.startDate === schedule.endDate
                                          ? schedule.startDate
                                          : `${schedule.startDate} ～ ${schedule.endDate}`
                                        : "尚未設定店家日期"}
                                    </p>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    {schedule && (
                                      <button
                                        type="button"
                                        onClick={() => removeStoreSchedule(store.storeKey)}
                                        className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-stone-500"
                                      >
                                        清除
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => openScheduleEditor(store.storeKey)}
                                      className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-700"
                                    >
                                      {schedule ? "修改日期" : "設定日期"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {scheduleStoreKey && (
                        <div className="rounded-2xl border border-amber-200 bg-white p-4">
                          <p className="text-sm font-extrabold text-stone-700">
                            {storeDirectory.get(scheduleStoreKey)?.label || scheduleStoreKey} 活動日期
                          </p>
                          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div>
                              <span className="text-xs font-bold text-stone-500">開始日期</span>
                              <div className="mt-2">
                                <SmartDatePicker
                                  selectedDate={scheduleDraft.startDate}
                                  onDateSelect={(date) => setScheduleDraft((prev) => ({
                                    ...prev,
                                    startDate: date,
                                    endDate: prev.endDate && prev.endDate >= date ? prev.endDate : date,
                                  }))}
                                  stores={[]}
                                  salesData={[]}
                                  minDate={draft.startDate || `${selectedMonth}-01`}
                                  maxDate={draft.endDate || monthLastDate(selectedMonth)}
                                />
                              </div>
                            </div>
                            <div>
                              <span className="text-xs font-bold text-stone-500">結束日期</span>
                              <div className="mt-2">
                                <SmartDatePicker
                                  selectedDate={scheduleDraft.endDate}
                                  onDateSelect={(date) => setScheduleDraft((prev) => ({ ...prev, endDate: date }))}
                                  stores={[]}
                                  salesData={[]}
                                  minDate={scheduleDraft.startDate || draft.startDate || `${selectedMonth}-01`}
                                  maxDate={draft.endDate || monthLastDate(selectedMonth)}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={closeScheduleEditor}
                              className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-500"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={applyScheduleDraft}
                              className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600"
                            >
                              套用店家日期
                            </button>
                          </div>
                        </div>
                      )}

                      {scheduledStoreRows.length > 0 && (
                        <div className="rounded-xl border border-amber-100 bg-white px-3 py-3">
                          <p className="text-xs font-extrabold text-amber-800">
                            已排定 {scheduledStoreRows.length} 間店
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {scheduledStoreRows.map((store) => (
                              <button
                                type="button"
                                key={store.storeKey}
                                onClick={() => openScheduleEditor(store.storeKey)}
                                className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700"
                              >
                                {store.label} {store.startDate === store.endDate ? store.startDate.slice(5) : `${store.startDate.slice(5)}～${store.endDate.slice(5)}`}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <label className="block">
                  <span className="text-sm font-bold text-stone-700">補充說明（選填）</span>
                  <textarea
                    value={draft.note}
                    onChange={(event) => setDraft((prev) => ({ ...prev, note: event.target.value }))}
                    maxLength={200}
                    rows={3}
                    placeholder="例如：搭配會員回饋、預購活動"
                    className="mt-2 w-full resize-none rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-200"
                  />
                </label>
              </div>

              <div className="sticky bottom-0 bg-white border-t border-stone-100 px-5 md:px-6 py-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-bold text-stone-500"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={applyDraftToLocalList}
                  className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white px-5 py-2.5 text-sm font-bold"
                >
                  {editingEventId ? "完成修改" : "加入本月活動"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ViewWrapper>
  );
};

export default SmartForecastView;
