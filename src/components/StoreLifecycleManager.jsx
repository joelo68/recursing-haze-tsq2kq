import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Store,
  KeyRound,
  X,
} from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { auth } from "../config/firebase";
import { Card } from "./SharedUI";
import {
  getCanonicalLifecycleStoreName,
  getLifecycleBrandMeta,
  getLifecycleEntryCompleteness,
  getStoreLifecycleKey,
  lifecycleStoreBrandMatches,
  normalizeExemptMonths,
  normalizeLifecycleBrandId,
  normalizeLifecycleEntry,
  normalizeLifecycleMaster,
  validateLifecycleEntryDraft,
} from "../utils/storeLifecycle";

const STORE_LIFECYCLE_ENDPOINT = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageStoreLifecycle";

const createEmptyEntry = (storeName = "", brandId = "cyj") => ({
  storeKey: getStoreLifecycleKey(storeName),
  coreStoreName: getStoreLifecycleKey(storeName),
  canonicalStoreName: getCanonicalLifecycleStoreName(storeName, brandId),
  firstEligibleMonth: "",
  lastEligibleMonth: "",
  openDate: "",
  closeDate: "",
  exemptMonths: [],
  entryStatus: "INCOMPLETE",
  revision: 0,
});

const getStatusMeta = (status = "") => {
  if (status === "COMPLETE") return { label: "資料完整", className: "bg-emerald-50 text-emerald-700 border-emerald-100" };
  if (status === "INVALID") return { label: "資料有誤", className: "bg-rose-50 text-rose-700 border-rose-100" };
  return { label: "待補資料", className: "bg-amber-50 text-amber-700 border-amber-100" };
};

const getDatasetMeta = (status = "BUILDING") => (
  status === "READY"
    ? { label: "已完成確認", className: "bg-emerald-50 text-emerald-700 border-emerald-100" }
    : { label: "建置中", className: "bg-amber-50 text-amber-700 border-amber-100" }
);

const StoreLifecycleManager = ({
  currentBrand,
  managers = {},
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
  const [selectedKey, setSelectedKey] = useState("");
  const [draft, setDraft] = useState(() => createEmptyEntry("", brandId));
  const [customStoreName, setCustomStoreName] = useState("");
  const [storeSearch, setStoreSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [exemptMonthInput, setExemptMonthInput] = useState("");
  const [credentialPassword, setCredentialPassword] = useState("");
  const [credentialDialog, setCredentialDialog] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const loadSequenceRef = useRef(0);
  const activeBrandRef = useRef(brandId);

  useEffect(() => {
    activeBrandRef.current = brandId;
  }, [brandId]);

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
      console.error("Store Lifecycle 載入失敗:", error);
      if (requestId === loadSequenceRef.current && activeBrandRef.current === brandId) {
        setLoadError(error?.message || "門市生命週期資料載入失敗");
      }
      return null;
    } finally {
      if (!silent && requestId === loadSequenceRef.current && activeBrandRef.current === brandId) setLoading(false);
    }
  }, [brandId, getCollectionPath]);

  useEffect(() => {
    setSelectedKey("");
    setDraft(createEmptyEntry("", brandId));
    setCustomStoreName("");
    setStoreSearch("");
    setStoreFilter("all");
    setExemptMonthInput("");
    setCredentialPassword("");
    setCredentialDialog(null);
    loadMaster();
  }, [brandId, loadMaster]);

  const orgStoreNames = useMemo(() => {
    const seen = new Set();
    const rows = [];
    Object.values(managers || {}).flat().forEach((storeName) => {
      const key = getStoreLifecycleKey(storeName);
      if (!key || seen.has(key)) return;
      seen.add(key);
      rows.push({
        key,
        canonicalStoreName: getCanonicalLifecycleStoreName(storeName, brandId),
        source: "org",
      });
    });
    return rows;
  }, [brandId, managers]);

  const allStores = useMemo(() => {
    const map = new Map();
    orgStoreNames.forEach((row) => map.set(row.key, row));
    Object.values(master.stores || {}).forEach((entry) => {
      const normalized = normalizeLifecycleEntry(entry, entry.storeKey, brandId);
      if (!normalized.storeKey) return;
      const existing = map.get(normalized.storeKey) || {};
      map.set(normalized.storeKey, {
        ...existing,
        key: normalized.storeKey,
        canonicalStoreName: normalized.canonicalStoreName || existing.canonicalStoreName,
        entry: normalized,
        source: existing.source ? "org+lifecycle" : "lifecycle",
      });
    });
    return [...map.values()].sort((a, b) => String(a.canonicalStoreName || a.key).localeCompare(String(b.canonicalStoreName || b.key), "zh-Hant", { numeric: true, sensitivity: "base" }));
  }, [brandId, master.stores, orgStoreNames]);

  const lifecycleRows = useMemo(() => allStores.map((row) => {
    const status = row.entry?.entryStatus || "INCOMPLETE";
    return { ...row, lifecycleStatus: status };
  }), [allStores]);

  const storeCounts = useMemo(() => lifecycleRows.reduce((counts, row) => {
    counts.all += 1;
    if (row.lifecycleStatus === "COMPLETE") counts.complete += 1;
    else if (row.lifecycleStatus === "INVALID") counts.invalid += 1;
    else counts.incomplete += 1;
    return counts;
  }, { all: 0, incomplete: 0, complete: 0, invalid: 0 }), [lifecycleRows]);

  const filteredStores = useMemo(() => {
    const keyword = String(storeSearch || "").trim().toLocaleLowerCase("zh-Hant");
    return lifecycleRows.filter((row) => {
      const statusMatch =
        storeFilter === "all"
        || (storeFilter === "complete" && row.lifecycleStatus === "COMPLETE")
        || (storeFilter === "invalid" && row.lifecycleStatus === "INVALID")
        || (storeFilter === "incomplete" && !["COMPLETE", "INVALID"].includes(row.lifecycleStatus));
      if (!statusMatch) return false;
      if (!keyword) return true;
      return `${row.canonicalStoreName || ""} ${row.key || ""}`.toLocaleLowerCase("zh-Hant").includes(keyword);
    });
  }, [lifecycleRows, storeFilter, storeSearch]);

  const selectedRow = useMemo(() => allStores.find((row) => row.key === selectedKey) || null, [allStores, selectedKey]);

  const selectStore = useCallback((row) => {
    if (!row?.key) return;
    const next = row.entry
      ? normalizeLifecycleEntry(row.entry, row.canonicalStoreName || row.key, brandId)
      : createEmptyEntry(row.canonicalStoreName || row.key, brandId);
    setSelectedKey(row.key);
    setDraft(next);
    setExemptMonthInput("");
  }, [brandId]);

  const selectNextIncompleteStore = useCallback(() => {
    const pendingRows = lifecycleRows.filter((row) => !["COMPLETE", "INVALID"].includes(row.lifecycleStatus));
    if (pendingRows.length === 0) {
      notify("目前沒有待補資料的門市", "success");
      return;
    }
    const currentIndex = pendingRows.findIndex((row) => row.key === selectedKey);
    const nextRow = pendingRows[currentIndex >= 0 ? (currentIndex + 1) % pendingRows.length : 0];
    setStoreFilter("incomplete");
    setStoreSearch("");
    selectStore(nextRow);
  }, [lifecycleRows, notify, selectStore, selectedKey]);

  const closeCredentialDialog = useCallback(() => {
    if (saving || statusChanging) return;
    setCredentialPassword("");
    setCredentialDialog(null);
  }, [saving, statusChanging]);

  const addCustomStore = () => {
    if (!lifecycleStoreBrandMatches(customStoreName, brandId)) {
      notify(`店名的品牌前綴與目前 ${brandMeta.label} 不一致，請切換到正確品牌後再建立`, "error");
      return;
    }
    const key = getStoreLifecycleKey(customStoreName);
    if (!key) {
      notify("請輸入有效的歷史門市名稱", "error");
      return;
    }
    const existing = allStores.find((row) => row.key === key);
    if (existing) {
      selectStore(existing);
      setCustomStoreName("");
      notify("此門市已存在，已切換到原有生命週期資料", "info");
      return;
    }
    const canonicalStoreName = getCanonicalLifecycleStoreName(customStoreName, brandId);
    setSelectedKey(key);
    setDraft(createEmptyEntry(canonicalStoreName, brandId));
    setCustomStoreName("");
  };

  const addExemptMonth = () => {
    const month = String(exemptMonthInput || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      notify("請先選擇有效的暫停營運月份", "error");
      return;
    }
    setDraft((prev) => ({ ...prev, exemptMonths: normalizeExemptMonths([...(prev.exemptMonths || []), month]) }));
    setExemptMonthInput("");
  };

  const removeExemptMonth = (month) => {
    setDraft((prev) => ({ ...prev, exemptMonths: (prev.exemptMonths || []).filter((item) => item !== month) }));
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        brandId,
        ...payload,
        actor: buildActor(password),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      const error = new Error(result?.message || `門市生命週期操作失敗 (${response.status})`);
      error.status = response.status;
      error.result = result;
      throw error;
    }
    return result;
  }, [brandId, currentDeviceTrust?.deviceId, currentUser]);

  const performSave = async (password) => {
    const check = validateLifecycleEntryDraft(draft);
    if (!check.valid) {
      notify(check.errors[0] || "門市生命週期資料格式有誤", "error");
      return false;
    }

    setSaving(true);
    try {
      const result = await callLifecycleEndpoint({
        action: "upsert_store",
        storeName: draft.canonicalStoreName || draft.storeKey,
        expectedStoreRevision: Number(draft.revision || 0),
        entry: {
          firstEligibleMonth: check.normalized.firstEligibleMonth,
          openDate: check.normalized.openDate,
          lastEligibleMonth: check.normalized.lastEligibleMonth,
          closeDate: check.normalized.closeDate,
          exemptMonths: check.normalized.exemptMonths,
        },
      }, password);
      if (activeBrandRef.current !== brandId) return false;
      notify(`${result?.entry?.canonicalStoreName || draft.canonicalStoreName} 生命週期已儲存`, "success");
      await loadMaster({ silent: true });
      const nextEntry = normalizeLifecycleEntry(result?.entry || {}, draft.canonicalStoreName, brandId);
      setSelectedKey(nextEntry.storeKey);
      setDraft(nextEntry);
      return true;
    } catch (error) {
      if (error?.status === 409) {
        notify(error.message || "資料已被其他管理者更新，請重新載入", "error");
        const fresh = await loadMaster({ silent: true });
        const freshEntry = fresh?.stores?.[selectedKey];
        if (freshEntry) setDraft(normalizeLifecycleEntry(freshEntry, selectedKey, brandId));
      } else {
        notify(error.message || "門市生命週期儲存失敗", "error");
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (!draft?.storeKey && !draft?.canonicalStoreName) {
      notify("請先選擇門市", "error");
      return;
    }
    if (currentDeviceTrust?.status !== "trusted") {
      notify("請改用已信任的裝置修改門市生命週期", "error");
      return;
    }

    const check = validateLifecycleEntryDraft(draft);
    if (!check.valid) {
      notify(check.errors[0] || "門市生命週期資料格式有誤", "error");
      return;
    }

    setCredentialPassword("");
    setCredentialDialog({
      type: "save",
      title: "確認儲存門市生命週期",
      description: `即將儲存「${draft.canonicalStoreName || selectedRow?.canonicalStoreName || selectedKey}」的生命週期資料。`,
    });
  };

  const performDatasetStatus = async (nextStatus, password) => {
    setStatusChanging(true);
    try {
      const result = await callLifecycleEndpoint({
        action: "set_dataset_status",
        datasetStatus: nextStatus,
        expectedMasterRevision: Number(master.revision || 0),
      }, password);
      if (activeBrandRef.current !== brandId) return false;
      notify(nextStatus === "READY" ? "門市生命週期資料已完成確認" : "門市生命週期資料已改回建置中", "success");
      setMaster((prev) => ({ ...prev, datasetStatus: result.datasetStatus, revision: result.masterRevision }));
      await loadMaster({ silent: true });
      return true;
    } catch (error) {
      if (error?.status === 409) await loadMaster({ silent: true });
      notify(error.message || "資料集狀態更新失敗", "error");
      return false;
    } finally {
      setStatusChanging(false);
    }
  };

  const handleDatasetStatus = (nextStatus) => {
    if (currentDeviceTrust?.status !== "trusted") {
      notify("請改用已信任的裝置變更資料集狀態", "error");
      return;
    }

    setCredentialPassword("");
    setCredentialDialog({
      type: "dataset",
      nextStatus,
      title: nextStatus === "READY" ? "完成整個品牌資料確認" : "改回建置中",
      description: nextStatus === "READY"
        ? "系統會再次檢查目前組織架構中的所有門市是否都有完整生命週期。Batch 1 仍不會切換任何 KPI 計算。"
        : "將資料集改回建置中不會刪除已建立的門市生命週期，也不會影響目前 KPI。",
    });
  };

  const confirmCredentialAction = async () => {
    const password = String(credentialPassword || "").trim();
    if (!password) {
      notify("請輸入目前最高管理者密碼", "error");
      return;
    }
    const dialog = credentialDialog;
    if (!dialog) return;

    const ok = dialog.type === "save"
      ? await performSave(password)
      : await performDatasetStatus(dialog.nextStatus, password);

    setCredentialPassword("");
    if (ok) setCredentialDialog(null);
  };

  const completedCount = Object.values(master.stores || {}).filter((entry) => entry?.entryStatus === "COMPLETE").length;
  const datasetMeta = getDatasetMeta(master.datasetStatus);
  const draftValidation = validateLifecycleEntryDraft(draft);
  const computedDraftStatus = draftValidation.valid
    ? getLifecycleEntryCompleteness(draftValidation.normalized)
    : "INVALID";
  const draftStatus = getStatusMeta(computedDraftStatus);

  if (loading) {
    return (
      <Card title="門市生命週期">
        <div className="flex items-center justify-center gap-2 py-16 text-sm font-bold text-[#A69C91]"><Loader2 className="animate-spin" size={20} /> 正在載入門市生命週期…</div>
      </Card>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      <Card title="門市生命週期 Master">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-[#EFE7DA] bg-[#FFFCF7] p-4">
              <div className="text-[11px] font-black text-[#A69C91]">目前品牌</div>
              <div className="mt-1 text-lg font-black text-[#4D4338]">{brandMeta.label}</div>
            </div>
            <div className="rounded-2xl border border-[#EFE7DA] bg-[#FFFCF7] p-4">
              <div className="text-[11px] font-black text-[#A69C91]">資料集狀態</div>
              <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${datasetMeta.className}`}>{datasetMeta.label}</span>
            </div>
            <div className="rounded-2xl border border-[#EFE7DA] bg-[#FFFCF7] p-4">
              <div className="text-[11px] font-black text-[#A69C91]">已建立 / 完整</div>
              <div className="mt-1 text-lg font-black text-[#4D4338]">{Object.keys(master.stores || {}).length} / {completedCount}</div>
            </div>
            <div className="rounded-2xl border border-[#EFE7DA] bg-[#FFFCF7] p-4">
              <div className="text-[11px] font-black text-[#A69C91]">Master Revision</div>
              <div className="mt-1 text-lg font-black text-[#4D4338]">{master.revision || 0}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 text-xs font-bold leading-6 text-sky-800">
            Batch 1 只建立 Store Lifecycle 上游 Master。即使標記為「已完成確認」，目前 Dashboard、Ranking、Annual、Regional、Projection、Telegram 都不會讀取這份資料，因此不會改變既有 KPI 數字。
          </div>

          {loadError && (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50/70 p-4 text-sm font-bold text-rose-700">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">{loadError}</div>
              <button type="button" onClick={() => loadMaster()} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-black"><RefreshCw size={13} /> 重試</button>
            </div>
          )}

          <div className="rounded-2xl border border-[#EFE7DA] bg-[#FAF7F1] p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck size={20} className="mt-0.5 shrink-0 text-[#B7863D]" />
              <div className="flex-1 min-w-0">
                <div className="font-black text-[#4D4338]">高風險資料寫入保護</div>
                <p className="mt-1 text-xs font-bold leading-5 text-[#8C8176]">每次儲存都會由 Backend 重新驗證 Firebase 登入、目前可信裝置與最高管理者密碼。密碼只用於本次驗證，不會寫入 Lifecycle、log 或瀏覽器儲存空間。</p>
                <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className={`inline-flex w-fit items-center justify-center rounded-xl border px-3 py-2.5 text-xs font-black ${currentDeviceTrust?.status === "trusted" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"}`}>
                    {currentDeviceTrust?.status === "trusted" ? "🛡 目前裝置已信任" : "⚠ 請改用已信任裝置"}
                  </div>
                  <button
                    type="button"
                    disabled={statusChanging}
                    onClick={() => handleDatasetStatus(master.datasetStatus === "READY" ? "BUILDING" : "READY")}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E8C77A] bg-gradient-to-r from-[#FFF4D8] to-[#EFD399] px-4 py-2.5 text-xs font-black text-[#6A4D26] disabled:opacity-50"
                  >
                    {statusChanging ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                    {master.datasetStatus === "READY" ? "改回建置中" : "完成資料確認"}
                  </button>
                </div>
                <p className="mt-2 text-[11px] font-bold leading-5 text-[#9A8E82]">
                  不需要先在頁面上尋找密碼欄位；按「儲存這間門市」或「完成資料確認」後，系統會直接跳出最高管理者確認視窗。
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
        <Card title="門市清單">
          <div className="space-y-3">
            <div className="rounded-2xl border border-[#EFE7DA] bg-[#FFFCF8] p-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#B0A59A]" />
                  <input
                    type="search"
                    value={storeSearch}
                    onChange={(event) => setStoreSearch(event.target.value)}
                    placeholder="搜尋門市，例如：八德、新店"
                    className="w-full rounded-xl border border-[#E8DDD0] bg-white py-2.5 pl-9 pr-9 text-sm font-bold text-[#5A5047] outline-none focus:border-amber-300"
                  />
                  {storeSearch && (
                    <button
                      type="button"
                      onClick={() => setStoreSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[#B0A59A] hover:bg-[#FAF7F1] hover:text-[#6E6257]"
                      title="清除搜尋"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={selectNextIncompleteStore}
                  className="shrink-0 rounded-xl border border-[#E8C77A] bg-[#FFF7DF] px-3 py-2.5 text-xs font-black text-[#6A4D26]"
                >
                  下一間待補
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  ["all", "全部", storeCounts.all],
                  ["incomplete", "待補", storeCounts.incomplete],
                  ["complete", "完整", storeCounts.complete],
                  ["invalid", "有誤", storeCounts.invalid],
                ].map(([value, label, count]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setStoreFilter(value)}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-black transition-all ${
                      storeFilter === value
                        ? "border-[#E8C77A] bg-[#FFF4D8] text-[#7A5727]"
                        : "border-[#E8DDD0] bg-white text-[#8C8176] hover:bg-[#FAF7F1]"
                    }`}
                  >
                    {label} {count}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={customStoreName}
                onChange={(event) => setCustomStoreName(event.target.value)}
                placeholder="新增不在目前組織架構的歷史門市"
                className="min-w-0 flex-1 rounded-xl border border-[#E8DDD0] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-300"
              />
              <button type="button" onClick={addCustomStore} className="shrink-0 rounded-xl border border-[#E8C77A] bg-[#FFF7DF] px-3 py-2 text-xs font-black text-[#6A4D26]">加入</button>
            </div>
            <p className="text-[11px] font-bold leading-5 text-[#A69C91]">加入歷史門市只建立 Lifecycle 草稿，不會新增 org_structure、帳號、日報或 KPI 資料。</p>

            <div className="max-h-[470px] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-2">
                {filteredStores.map((row) => {
                  const meta = getStatusMeta(row.lifecycleStatus);
                  return (
                    <button
                      type="button"
                      key={row.key}
                      onClick={() => selectStore(row)}
                      className={`min-w-0 rounded-xl border px-3 py-2.5 text-left transition-all ${
                        selectedKey === row.key
                          ? "border-[#E8C77A] bg-[#FFF8E7] shadow-sm ring-1 ring-[#F3DFB8]"
                          : "border-[#EFE7DA] bg-white hover:bg-[#FFFCF7]"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Store size={14} className="shrink-0 text-[#B7863D]" />
                        <span className="min-w-0 flex-1 truncate text-xs font-black text-[#4D4338]">{row.canonicalStoreName || row.key}</span>
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            row.lifecycleStatus === "COMPLETE"
                              ? "bg-emerald-400"
                              : row.lifecycleStatus === "INVALID"
                                ? "bg-rose-400"
                                : "bg-amber-400"
                          }`}
                          title={meta.label}
                        />
                      </div>
                      <div className="mt-1 truncate text-[9px] font-bold text-[#B0A59A]">
                        {row.source === "lifecycle" ? "歷史門市" : row.source === "org+lifecycle" ? "已建立 Lifecycle" : "尚未建立"}
                      </div>
                    </button>
                  );
                })}
              </div>
              {filteredStores.length === 0 && (
                <div className="mt-2 rounded-2xl border-2 border-dashed border-[#EDE2D4] py-10 text-center text-sm font-bold text-[#A69C91]">
                  找不到符合條件的門市
                </div>
              )}
            </div>
          </div>
        </Card>
        <Card title="門市生命週期設定">
          {!selectedKey ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#EDE2D4] bg-[#FFFCF8] px-5 py-16 text-center">
              <Building2 size={38} className="text-[#D5C8BA]" />
              <div className="mt-3 text-base font-black text-[#6E6257]">請先從左側選擇門市</div>
              <p className="mt-1 text-xs font-bold text-[#A69C91]">本頁不會自動推論開店、停業或整月暫停。</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 rounded-2xl border border-[#EFE7DA] bg-[#FAF7F1] p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[11px] font-black text-[#A69C91]">目前編輯</div>
                  <div className="mt-1 text-lg font-black text-[#4D4338]">{draft.canonicalStoreName || selectedRow?.canonicalStoreName || selectedKey}</div>
                  <div className="mt-1 text-[10px] font-bold text-[#A69C91]">Store Key：{draft.storeKey || selectedKey}｜Revision {draft.revision || 0}</div>
                </div>
                <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-black ${draftStatus.className}`}>{draftStatus.label}</span>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="flex items-center gap-1 text-xs font-black text-[#7C7063]"><CalendarDays size={14} /> 首次正式納管月份</span>
                  <input type="month" value={draft.firstEligibleMonth || ""} onChange={(event) => setDraft((prev) => ({ ...prev, firstEligibleMonth: event.target.value }))} className="w-full rounded-xl border border-[#E8DDD0] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-300" />
                  <span className="text-[10px] font-bold text-[#A69C91]">Opening month 仍是正式 KPI 納管月份，不自動按日數折算目標。</span>
                </label>
                <label className="space-y-1.5">
                  <span className="flex items-center gap-1 text-xs font-black text-[#7C7063]"><CalendarDays size={14} /> 實際開始營運日期</span>
                  <input type="date" value={draft.openDate || ""} onChange={(event) => setDraft((prev) => ({ ...prev, openDate: event.target.value }))} className="w-full rounded-xl border border-[#E8DDD0] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-300" />
                  <span className="text-[10px] font-bold text-[#A69C91]">未來用於 Daily expected-report boundary；目前 Batch 1 尚未接入日報檢核。</span>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-black text-[#7C7063]">永久結束月份（仍納管）</span>
                  <input type="month" value={draft.lastEligibleMonth || ""} onChange={(event) => setDraft((prev) => ({ ...prev, lastEligibleMonth: event.target.value }))} className="w-full rounded-xl border border-[#E8DDD0] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-300" />
                  <span className="text-[10px] font-bold text-[#A69C91]">只有永久結束營業才填；暫時停業請使用下方整月暫停。</span>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-black text-[#7C7063]">實際永久結束日期</span>
                  <input type="date" value={draft.closeDate || ""} onChange={(event) => setDraft((prev) => ({ ...prev, closeDate: event.target.value }))} className="w-full rounded-xl border border-[#E8DDD0] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-300" />
                  <span className="text-[10px] font-bold text-[#A69C91]">永久結束月份最後仍是 eligible month；不刪除 Store Identity。</span>
                </label>
              </div>

              <div className="rounded-2xl border border-[#EFE7DA] bg-[#FFFCF8] p-4">
                <div className="text-xs font-black text-[#6E6257]">整月暫停營運 Exempt Months</div>
                <p className="mt-1 text-[10px] font-bold leading-5 text-[#A69C91]">只用於已核准的「整個月份不營運」。一般休店日、0 業績或沒日報都不能自動視為 exempt。</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input type="month" value={exemptMonthInput} onChange={(event) => setExemptMonthInput(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-[#E8DDD0] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-300" />
                  <button type="button" onClick={addExemptMonth} className="rounded-xl border border-[#E8C77A] bg-[#FFF7DF] px-4 py-2.5 text-xs font-black text-[#6A4D26]">加入暫停月份</button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(draft.exemptMonths || []).map((month) => (
                    <span key={month} className="inline-flex items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700">{month}<button type="button" onClick={() => removeExemptMonth(month)} className="rounded-full p-0.5 hover:bg-amber-100"><X size={12} /></button></span>
                  ))}
                  {(draft.exemptMonths || []).length === 0 && <span className="text-xs font-bold text-[#B0A59A]">目前沒有整月暫停設定</span>}
                </div>
              </div>

              {!draftValidation.valid && (
                <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4 text-xs font-bold leading-6 text-rose-700">
                  {draftValidation.errors.join("；")}
                </div>
              )}

              <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-xs font-bold leading-6 text-amber-800">
                系統不會因為沒有日報、業績為 0、從區長轄區移除，或暫時休店就自動判定永久關店。現階段允許先儲存未完整草稿，但只有資料完整的門市才能讓整個品牌 Lifecycle 通過 READY 檢查。
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#E8C77A] bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] px-5 py-3 text-sm font-black text-[#5A4225] shadow-sm disabled:opacity-50 sm:w-auto"
                >
                  {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} 儲存這間門市
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {credentialDialog && (
        <div
          className="fixed inset-0 z-[99995] flex items-center justify-center bg-stone-900/35 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCredentialDialog();
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-[1.75rem] border border-[#E8DDD0] bg-[#FFFCF8] shadow-[0_24px_80px_rgba(80,62,45,0.22)]">
            <div className="border-b border-[#EFE7DA] bg-gradient-to-br from-[#FFF9EC] via-white to-[#FFF4DC] px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-[#B7863D] shadow-sm">
                    <KeyRound size={19} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-black text-[#4D4338]">{credentialDialog.title}</div>
                    <p className="mt-1 text-xs font-bold leading-5 text-[#8C8176]">{credentialDialog.description}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeCredentialDialog}
                  disabled={saving || statusChanging}
                  className="rounded-full p-2 text-[#A69C91] hover:bg-white disabled:opacity-40"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className={`rounded-xl border px-3 py-2.5 text-xs font-black ${currentDeviceTrust?.status === "trusted" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"}`}>
                {currentDeviceTrust?.status === "trusted" ? "🛡 目前裝置已信任" : "⚠ 目前裝置尚未信任，無法執行高風險寫入"}
              </div>

              <label className="block">
                <span className="mb-2 block text-xs font-black text-[#7C7063]">最高管理者密碼</span>
                <input
                  autoFocus
                  type="password"
                  value={credentialPassword}
                  onChange={(event) => setCredentialPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !saving && !statusChanging) confirmCredentialAction();
                  }}
                  placeholder="輸入目前登入的最高管理者密碼"
                  autoComplete="current-password"
                  className="w-full rounded-xl border-2 border-[#E8DDD0] bg-white px-4 py-3 text-sm font-bold text-[#4D4338] outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-50"
                />
                <span className="mt-2 block text-[10px] font-bold leading-5 text-[#A69C91]">
                  密碼只會送到 Backend 做本次重新驗證；成功或失敗後都會從畫面狀態清除，不寫入 Firestore、Lifecycle 或瀏覽器儲存空間。
                </span>
              </label>

              {credentialDialog.type === "dataset" && credentialDialog.nextStatus === "READY" && (
                <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2.5 text-xs font-bold leading-5 text-amber-800">
                  READY 只代表 Lifecycle Master 已完成確認；Batch 1 仍不會讓 Dashboard、Ranking、Annual 或 Telegram 改讀這份資料。
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeCredentialDialog}
                  disabled={saving || statusChanging}
                  className="rounded-xl border border-[#E8DDD0] bg-white px-4 py-3 text-sm font-black text-[#7C7063] disabled:opacity-40"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={confirmCredentialAction}
                  disabled={!credentialPassword.trim() || saving || statusChanging || currentDeviceTrust?.status !== "trusted"}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E8C77A] bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] px-4 py-3 text-sm font-black text-[#5A4225] disabled:opacity-45"
                >
                  {(saving || statusChanging) ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  {(saving || statusChanging) ? "驗證並處理中…" : "確認並繼續"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

class StoreLifecycleErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: String(error?.message || "門市生命週期畫面暫時無法顯示") };
  }

  componentDidCatch(error, info) {
    console.error("Store Lifecycle UI isolated error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card title="門市生命週期">
          <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-5 text-sm font-bold leading-6 text-rose-700">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-black">門市生命週期工具暫時無法顯示</div>
                <div className="mt-1 text-xs">{this.state.message}</div>
                <div className="mt-1 text-xs text-rose-600/80">其他系統設定與營運資料不受影響。</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: "" })}
              className="mt-4 inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black"
            >
              <RefreshCw size={13} /> 重新載入此工具
            </button>
          </div>
        </Card>
      );
    }
    return this.props.children;
  }
}

const SafeStoreLifecycleManager = (props) => (
  <StoreLifecycleErrorBoundary>
    <StoreLifecycleManager {...props} />
  </StoreLifecycleErrorBoundary>
);

export default SafeStoreLifecycleManager;
