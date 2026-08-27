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
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSearch, setBatchSearch] = useState("");
  const [batchSelectedKeys, setBatchSelectedKeys] = useState([]);
  const [batchDrafts, setBatchDrafts] = useState({});
  const [batchCommonFirstMonth, setBatchCommonFirstMonth] = useState("");
  const [batchCommonOpenDate, setBatchCommonOpenDate] = useState("");
  const [batchFillBlanksOnly, setBatchFillBlanksOnly] = useState(true);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchResults, setBatchResults] = useState([]);
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
    setBatchOpen(false);
    setBatchSearch("");
    setBatchSelectedKeys([]);
    setBatchDrafts({});
    setBatchCommonFirstMonth("");
    setBatchCommonOpenDate("");
    setBatchFillBlanksOnly(true);
    setBatchSaving(false);
    setBatchProgress({ current: 0, total: 0 });
    setBatchResults([]);
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

  const batchRows = useMemo(() => lifecycleRows.filter((row) => row.source !== "lifecycle"), [lifecycleRows]);

  const filteredBatchRows = useMemo(() => {
    const keyword = String(batchSearch || "").trim().toLocaleLowerCase("zh-Hant");
    if (!keyword) return batchRows;
    return batchRows.filter((row) => `${row.canonicalStoreName || ""} ${row.key || ""}`.toLocaleLowerCase("zh-Hant").includes(keyword));
  }, [batchRows, batchSearch]);

  const batchSelectedSet = useMemo(() => new Set(batchSelectedKeys), [batchSelectedKeys]);

  const batchResultSummary = useMemo(() => batchResults.reduce((summary, item) => {
    if (item.ok) summary.success += 1;
    else summary.failed += 1;
    if (item.conflict) summary.conflict += 1;
    return summary;
  }, { success: 0, failed: 0, conflict: 0 }), [batchResults]);

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
    if (saving || statusChanging || batchSaving) return;
    setCredentialPassword("");
    setCredentialDialog(null);
  }, [saving, statusChanging, batchSaving]);

  const buildBatchDraft = useCallback((row) => (
    row?.entry
      ? normalizeLifecycleEntry(row.entry, row.canonicalStoreName || row.key, brandId)
      : createEmptyEntry(row?.canonicalStoreName || row?.key || "", brandId)
  ), [brandId]);

  const openBatchInitializer = () => {
    if (master.datasetStatus === "READY") {
      notify("目前 Lifecycle 已標記 READY；若要重新批次初始化，請先改回「建置中」", "error");
      return;
    }
    if (batchRows.length === 0) {
      notify("目前品牌沒有可批次初始化的組織架構門市", "error");
      return;
    }

    const drafts = {};
    batchRows.forEach((row) => {
      drafts[row.key] = buildBatchDraft(row);
    });
    const pendingKeys = batchRows
      .filter((row) => row.lifecycleStatus !== "COMPLETE")
      .map((row) => row.key);

    setBatchDrafts(drafts);
    setBatchSelectedKeys(pendingKeys);
    setBatchSearch("");
    setBatchCommonFirstMonth("");
    setBatchCommonOpenDate("");
    setBatchFillBlanksOnly(true);
    setBatchProgress({ current: 0, total: 0 });
    setBatchResults([]);
    setBatchOpen(true);
  };

  const closeBatchInitializer = () => {
    if (batchSaving) return;
    setBatchOpen(false);
    setBatchSearch("");
    setBatchSelectedKeys([]);
    setBatchDrafts({});
    setBatchCommonFirstMonth("");
    setBatchCommonOpenDate("");
    setBatchProgress({ current: 0, total: 0 });
    setBatchResults([]);
  };

  const toggleBatchStore = (row) => {
    if (!row?.key || row.lifecycleStatus === "COMPLETE" || batchSaving) return;
    setBatchSelectedKeys((prev) => prev.includes(row.key) ? prev.filter((key) => key !== row.key) : [...prev, row.key]);
    setBatchDrafts((prev) => ({
      ...prev,
      [row.key]: prev[row.key] || buildBatchDraft(row),
    }));
  };

  const selectAllBatchPending = () => {
    const keys = batchRows.filter((row) => row.lifecycleStatus !== "COMPLETE").map((row) => row.key);
    setBatchSelectedKeys(keys);
  };

  const updateBatchDraft = (storeKey, patch) => {
    const row = batchRows.find((item) => item.key === storeKey);
    if (!row || row.lifecycleStatus === "COMPLETE") return;
    setBatchDrafts((prev) => ({
      ...prev,
      [storeKey]: { ...(prev[storeKey] || buildBatchDraft(row)), ...patch },
    }));
  };

  const applyBatchCommonValues = () => {
    if (batchSelectedKeys.length === 0) {
      notify("請先勾選要套用的門市", "error");
      return;
    }
    if (!batchCommonFirstMonth && !batchCommonOpenDate) {
      notify("請至少設定一個共用欄位", "error");
      return;
    }
    if (batchCommonFirstMonth && batchCommonOpenDate && batchCommonOpenDate.slice(0, 7) > batchCommonFirstMonth) {
      notify("共用實際開始營運日期不可晚於共用首次正式納管月份", "error");
      return;
    }

    setBatchDrafts((prev) => {
      const next = { ...prev };
      batchSelectedKeys.forEach((storeKey) => {
        const row = batchRows.find((item) => item.key === storeKey);
        if (!row || row.lifecycleStatus === "COMPLETE") return;
        const current = next[storeKey] || buildBatchDraft(row);
        next[storeKey] = {
          ...current,
          firstEligibleMonth: batchCommonFirstMonth && (!batchFillBlanksOnly || !current.firstEligibleMonth)
            ? batchCommonFirstMonth
            : current.firstEligibleMonth,
          openDate: batchCommonOpenDate && (!batchFillBlanksOnly || !current.openDate)
            ? batchCommonOpenDate
            : current.openDate,
        };
      });
      return next;
    });
    notify(`已將共用設定套用到 ${batchSelectedKeys.length} 間門市${batchFillBlanksOnly ? "的空白欄位" : ""}`, "success");
  };

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

  const performBatchSave = async (password) => {
    const selectedRows = batchSelectedKeys
      .map((storeKey) => batchRows.find((row) => row.key === storeKey))
      .filter(Boolean)
      .filter((row) => row.lifecycleStatus !== "COMPLETE");

    if (selectedRows.length === 0) {
      notify("目前沒有可批次儲存的門市", "error");
      return false;
    }

    const prepared = selectedRows.map((row) => {
      const entry = batchDrafts[row.key] || buildBatchDraft(row);
      const check = validateLifecycleEntryDraft(entry);
      return { row, entry, check };
    });
    const invalidRows = prepared.filter((item) => !item.check.valid);
    if (invalidRows.length > 0) {
      notify(`有 ${invalidRows.length} 間門市資料格式互相矛盾，請先修正紅色項目再批次儲存`, "error");
      return false;
    }

    setBatchSaving(true);
    setBatchProgress({ current: 0, total: prepared.length });
    setBatchResults([]);
    const operationBrandId = brandId;
    const results = [];
    let authAborted = false;

    try {
      for (let index = 0; index < prepared.length; index += 1) {
        const item = prepared[index];
        if (activeBrandRef.current !== operationBrandId) {
          prepared.slice(index).forEach((remaining) => {
            results.push({
              key: remaining.row.key,
              name: remaining.row.canonicalStoreName || remaining.row.key,
              ok: false,
              notRun: true,
              message: "品牌已切換，本次批次作業已停止，這間門市尚未執行",
            });
          });
          break;
        }

        setBatchProgress({ current: index + 1, total: prepared.length });
        try {
          const result = await callLifecycleEndpoint({
            action: "upsert_store",
            storeName: item.entry.canonicalStoreName || item.row.canonicalStoreName || item.row.key,
            expectedStoreRevision: Number(item.entry.revision || 0),
            entry: {
              firstEligibleMonth: item.check.normalized.firstEligibleMonth,
              openDate: item.check.normalized.openDate,
              lastEligibleMonth: item.check.normalized.lastEligibleMonth,
              closeDate: item.check.normalized.closeDate,
              exemptMonths: item.check.normalized.exemptMonths,
            },
          }, password);
          results.push({
            key: item.row.key,
            name: result?.entry?.canonicalStoreName || item.row.canonicalStoreName || item.row.key,
            ok: true,
            revision: result?.entry?.revision,
          });
        } catch (error) {
          const isConflict = error?.status === 409;
          results.push({
            key: item.row.key,
            name: item.row.canonicalStoreName || item.row.key,
            ok: false,
            conflict: isConflict,
            status: error?.status || 0,
            message: error?.message || "批次儲存失敗",
          });

          // 驗證失敗時不要用同一組 credential 連續打剩餘門市；其餘單店錯誤則繼續，避免一店卡住整批。
          if ([401, 403].includes(Number(error?.status || 0))) {
            authAborted = true;
            prepared.slice(index + 1).forEach((remaining) => {
              results.push({
                key: remaining.row.key,
                name: remaining.row.canonicalStoreName || remaining.row.key,
                ok: false,
                notRun: true,
                message: "因最高管理者驗證未通過，本次尚未執行",
              });
            });
            break;
          }
        }
      }

      // 品牌切換後，舊批次結果不可回寫到新品牌 UI state。舊品牌已完成的 Backend transaction 仍保持原品牌隔離。
      if (activeBrandRef.current !== operationBrandId) return false;

      setBatchResults(results);
      const fresh = await loadMaster({ silent: true });
      if (fresh && activeBrandRef.current === operationBrandId) {
        setBatchDrafts((prev) => {
          const next = { ...prev };
          batchRows.forEach((row) => {
            const freshEntry = fresh?.stores?.[row.key];
            if (freshEntry) next[row.key] = normalizeLifecycleEntry(freshEntry, row.canonicalStoreName || row.key, brandId);
          });
          return next;
        });
      }

      const failedKeys = results.filter((item) => !item.ok).map((item) => item.key);
      setBatchSelectedKeys(failedKeys);
      const successCount = results.filter((item) => item.ok).length;
      const failedCount = results.filter((item) => !item.ok).length;

      if (authAborted) {
        notify("最高管理者驗證未通過，批次作業已立即停止；已成功的門市不會回滾", "error");
        return false;
      }
      if (failedCount > 0) {
        notify(`批次完成：${successCount} 間成功、${failedCount} 間需重新確認`, "error");
      } else {
        notify(`批次完成：${successCount} 間門市已儲存`, "success");
      }
      return true;
    } finally {
      if (activeBrandRef.current === operationBrandId) {
        setBatchSaving(false);
        setBatchProgress({
          current: results.filter((item) => !item.notRun).length,
          total: prepared.length,
        });
      }
    }
  };

  const handleBatchSave = () => {
    if (master.datasetStatus === "READY") {
      notify("Lifecycle 已是 READY，批次初始化只允許在 BUILDING 狀態執行", "error");
      return;
    }
    if (currentDeviceTrust?.status !== "trusted") {
      notify("請改用已信任的裝置執行批次初始化", "error");
      return;
    }
    if (batchSelectedKeys.length === 0) {
      notify("請先勾選要批次儲存的門市", "error");
      return;
    }

    const selectedRows = batchSelectedKeys
      .map((storeKey) => batchRows.find((row) => row.key === storeKey))
      .filter(Boolean);
    const invalidRows = selectedRows.filter((row) => {
      const check = validateLifecycleEntryDraft(batchDrafts[row.key] || buildBatchDraft(row));
      return !check.valid;
    });
    if (invalidRows.length > 0) {
      notify(`有 ${invalidRows.length} 間門市資料格式有誤，請先修正後再儲存`, "error");
      return;
    }

    setCredentialPassword("");
    setCredentialDialog({
      type: "batch",
      title: "確認批次初始化門市生命週期",
      description: `本次將依序儲存 ${selectedRows.length} 間 ${brandMeta.label} 門市。Backend 仍會逐店重新驗證、transaction 寫入與 revision 衝突檢查。`,
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

    let ok = false;
    if (dialog.type === "save") ok = await performSave(password);
    else if (dialog.type === "batch") ok = await performBatchSave(password);
    else ok = await performDatasetStatus(dialog.nextStatus, password);

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
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      disabled={batchSaving || master.datasetStatus === "READY"}
                      onClick={openBatchInitializer}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs font-black text-sky-700 disabled:opacity-45"
                    >
                      <Building2 size={15} /> 批次初始化
                    </button>
                    <button
                      type="button"
                      disabled={statusChanging || batchSaving}
                      onClick={() => handleDatasetStatus(master.datasetStatus === "READY" ? "BUILDING" : "READY")}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E8C77A] bg-gradient-to-r from-[#FFF4D8] to-[#EFD399] px-4 py-2.5 text-xs font-black text-[#6A4D26] disabled:opacity-50"
                    >
                      {statusChanging ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                      {master.datasetStatus === "READY" ? "改回建置中" : "完成資料確認"}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[11px] font-bold leading-5 text-[#9A8E82]">
                  不需要先在頁面上尋找密碼欄位；按「儲存這間門市」或「完成資料確認」後，系統會直接跳出最高管理者確認視窗。
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {batchOpen && (
        <Card title="門市批次初始化">
          <div className="space-y-5">
            <div className="flex flex-col gap-3 rounded-2xl border border-sky-100 bg-sky-50/60 p-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="font-black text-sky-800">第一次大量建置用；正式例外仍回到單店精修</div>
                <p className="mt-1 text-xs font-bold leading-5 text-sky-800/75">
                  只列出目前 {brandMeta.label} 組織架構中的門市。已完整門市在批次模式中鎖定，不會被覆寫；永久結束、整月暫停等特殊資料仍由右側單店編輯處理。
                </p>
              </div>
              <button
                type="button"
                onClick={closeBatchInitializer}
                disabled={batchSaving}
                className="shrink-0 rounded-xl border border-sky-100 bg-white px-3 py-2 text-xs font-black text-sky-700 disabled:opacity-40"
              >
                關閉批次初始化
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
              <div className="space-y-4 rounded-2xl border border-[#EFE7DA] bg-[#FFFCF8] p-4">
                <div>
                  <div className="text-sm font-black text-[#4D4338]">共用欄位</div>
                  <p className="mt-1 text-[11px] font-bold leading-5 text-[#A69C91]">
                    系統不會自行推論日期。首次正式納管月份是 SaaS KPI 邊界；實際開始營運日期是門市真實開店邊界，可以更早。只有你實際輸入的共用值才會套用；預設只補空白欄位。
                  </p>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-[#7C7063]">共用首次正式納管月份</span>
                  <input
                    type="month"
                    value={batchCommonFirstMonth}
                    onChange={(event) => setBatchCommonFirstMonth(event.target.value)}
                    disabled={batchSaving}
                    className="w-full rounded-xl border border-[#E8DDD0] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-300 disabled:opacity-50"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-[#7C7063]">共用實際開始營運日期（選填）</span>
                  <input
                    type="date"
                    value={batchCommonOpenDate}
                    onChange={(event) => setBatchCommonOpenDate(event.target.value)}
                    disabled={batchSaving}
                    className="w-full rounded-xl border border-[#E8DDD0] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-300 disabled:opacity-50"
                  />
                  <span className="mt-1.5 block text-[10px] font-bold leading-5 text-[#A69C91]">
                    這裡填門市真正開始營運的日期，可以早於首次正式納管月份；不可晚於納管月份。不確定時請留空，不要為了完成批次而猜日期。
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[#EFE7DA] bg-white p-3">
                  <input
                    type="checkbox"
                    checked={batchFillBlanksOnly}
                    onChange={(event) => setBatchFillBlanksOnly(event.target.checked)}
                    disabled={batchSaving}
                    className="mt-0.5 h-4 w-4 rounded border-stone-300"
                  />
                  <span>
                    <span className="block text-xs font-black text-[#675B4E]">只補目前空白欄位（建議）</span>
                    <span className="mt-0.5 block text-[10px] font-bold text-[#A69C91]">避免共用設定蓋掉已經逐店確認過的月份或日期。</span>
                  </span>
                </label>

                <button
                  type="button"
                  onClick={applyBatchCommonValues}
                  disabled={batchSaving || batchSelectedKeys.length === 0}
                  className="w-full rounded-xl border border-[#E8C77A] bg-[#FFF7DF] px-4 py-3 text-sm font-black text-[#6A4D26] disabled:opacity-45"
                >
                  套用到已勾選的 {batchSelectedKeys.length} 間門市
                </button>

                <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3 text-[11px] font-bold leading-5 text-amber-800">
                  批次模式不提供「永久結束月份／日期」與 Exempt Months 共用填寫，避免把特殊營運事件誤套到多間店。
                </div>
              </div>

              <div className="min-w-0 space-y-3 rounded-2xl border border-[#EFE7DA] bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-black text-[#4D4338]">目前品牌門市</div>
                    <div className="mt-0.5 text-[11px] font-bold text-[#A69C91]">
                      共 {batchRows.length} 間｜已勾選 {batchSelectedKeys.length} 間｜完整門市自動保護
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={selectAllBatchPending} disabled={batchSaving} className="rounded-lg border border-[#E8DDD0] bg-[#FAF7F1] px-3 py-1.5 text-[11px] font-black text-[#7C7063] disabled:opacity-40">勾選全部待補</button>
                    <button type="button" onClick={() => setBatchSelectedKeys([])} disabled={batchSaving} className="rounded-lg border border-[#E8DDD0] bg-white px-3 py-1.5 text-[11px] font-black text-[#7C7063] disabled:opacity-40">清除勾選</button>
                  </div>
                </div>

                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#B0A59A]" />
                  <input
                    type="search"
                    value={batchSearch}
                    onChange={(event) => setBatchSearch(event.target.value)}
                    placeholder="搜尋批次門市"
                    disabled={batchSaving}
                    className="w-full rounded-xl border border-[#E8DDD0] bg-[#FFFCF8] py-2.5 pl-9 pr-3 text-sm font-bold outline-none focus:border-amber-300 disabled:opacity-50"
                  />
                </div>

                <div className="max-h-[620px] overflow-y-auto pr-1">
                  <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
                    {filteredBatchRows.map((row) => {
                      const isComplete = row.lifecycleStatus === "COMPLETE";
                      const checked = batchSelectedSet.has(row.key);
                      const rowDraft = batchDrafts[row.key] || buildBatchDraft(row);
                      const rowCheck = validateLifecycleEntryDraft(rowDraft);
                      const rowComputedStatus = rowCheck.valid ? getLifecycleEntryCompleteness(rowCheck.normalized) : "INVALID";
                      const rowMeta = getStatusMeta(rowComputedStatus);
                      return (
                        <div key={row.key} className={`rounded-xl border p-3 ${isComplete ? "border-emerald-100 bg-emerald-50/40" : checked ? "border-[#E8C77A] bg-[#FFF9EC]" : "border-[#EFE7DA] bg-[#FFFCF8]"}`}>
                          <div className="flex items-start gap-2.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isComplete || batchSaving}
                              onChange={() => toggleBatchStore(row)}
                              className="mt-1 h-4 w-4 shrink-0 rounded border-stone-300 disabled:opacity-40"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="truncate text-xs font-black text-[#4D4338]">{row.canonicalStoreName || row.key}</span>
                                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${rowMeta.className}`}>{isComplete ? "已完整・保護" : rowMeta.label}</span>
                              </div>
                              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <label>
                                  <span className="mb-1 block text-[9px] font-black text-[#9A8E82]">納管月份</span>
                                  <input
                                    type="month"
                                    value={rowDraft.firstEligibleMonth || ""}
                                    disabled={!checked || isComplete || batchSaving}
                                    onChange={(event) => updateBatchDraft(row.key, { firstEligibleMonth: event.target.value })}
                                    className="w-full rounded-lg border border-[#E8DDD0] bg-white px-2 py-2 text-xs font-bold outline-none focus:border-amber-300 disabled:bg-stone-50 disabled:text-stone-400"
                                  />
                                </label>
                                <label>
                                  <span className="mb-1 block text-[9px] font-black text-[#9A8E82]">開始日期</span>
                                  <input
                                    type="date"
                                    value={rowDraft.openDate || ""}
                                    disabled={!checked || isComplete || batchSaving}
                                    onChange={(event) => updateBatchDraft(row.key, { openDate: event.target.value })}
                                    className="w-full rounded-lg border border-[#E8DDD0] bg-white px-2 py-2 text-xs font-bold outline-none focus:border-amber-300 disabled:bg-stone-50 disabled:text-stone-400"
                                  />
                                </label>
                              </div>
                              {!rowCheck.valid && (
                                <div className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[9px] font-bold leading-4 text-rose-600">{rowCheck.errors[0]}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {filteredBatchRows.length === 0 && <div className="py-10 text-center text-xs font-bold text-[#A69C91]">找不到符合條件的門市</div>}
                </div>
              </div>
            </div>

            {batchResults.length > 0 && (
              <div className="rounded-2xl border border-[#EFE7DA] bg-[#FAF7F1] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black text-[#4D4338]">上一次批次結果</div>
                  <div className="text-[11px] font-black text-[#7C7063]">
                    成功 {batchResultSummary.success}｜失敗 {batchResultSummary.failed}{batchResultSummary.conflict > 0 ? `｜衝突 ${batchResultSummary.conflict}` : ""}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {batchResults.map((item) => (
                    <div key={`${item.key}-${item.ok ? "ok" : "fail"}`} className={`rounded-xl border px-3 py-2 text-xs font-bold ${item.ok ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"}`}>
                      <div className="font-black">{item.ok ? "✓" : "!"} {item.name}</div>
                      {!item.ok && <div className="mt-1 text-[10px] leading-4 opacity-85">{item.conflict ? "其他管理者已更新：" : ""}{item.message}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3 rounded-2xl border border-[#EFE7DA] bg-[#FFFCF8] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-bold leading-5 text-[#7C7063]">
                {batchSaving
                  ? `正在逐店儲存 ${batchProgress.current} / ${batchProgress.total}；請勿切換品牌或關閉頁面。`
                  : `準備儲存 ${batchSelectedKeys.length} 間。每間仍使用既有 Backend transaction 與 revision 保護；單店 409 不會覆蓋其他管理者資料。`}
              </div>
              <button
                type="button"
                onClick={handleBatchSave}
                disabled={batchSaving || batchSelectedKeys.length === 0 || currentDeviceTrust?.status !== "trusted"}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#E8C77A] bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] px-5 py-3 text-sm font-black text-[#5A4225] disabled:opacity-45"
              >
                {batchSaving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
                {batchSaving ? `批次儲存中 ${batchProgress.current}/${batchProgress.total}` : `批次儲存 ${batchSelectedKeys.length} 間`}
              </button>
            </div>
          </div>
        </Card>
      )}

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
                  <span className="text-[10px] font-bold text-[#A69C91]">這是本 SaaS KPI 正式開始納管該店的月份；可晚於門市真正開始營運的日期，且不自動按日數折算目標。</span>
                </label>
                <label className="space-y-1.5">
                  <span className="flex items-center gap-1 text-xs font-black text-[#7C7063]"><CalendarDays size={14} /> 實際開始營運日期</span>
                  <input type="date" value={draft.openDate || ""} onChange={(event) => setDraft((prev) => ({ ...prev, openDate: event.target.value }))} className="w-full rounded-xl border border-[#E8DDD0] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-300" />
                  <span className="text-[10px] font-bold text-[#A69C91]">填門市真正開始營運日期，可早於首次正式納管月份；未來用於 Daily expected-report boundary，目前 Batch 1 尚未接入日報檢核。</span>
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
                  disabled={saving || statusChanging || batchSaving}
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
                    if (event.key === "Enter" && !saving && !statusChanging && !batchSaving) confirmCredentialAction();
                  }}
                  placeholder="輸入目前登入的最高管理者密碼"
                  autoComplete="current-password"
                  className="w-full rounded-xl border-2 border-[#E8DDD0] bg-white px-4 py-3 text-sm font-bold text-[#4D4338] outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-50"
                />
                <span className="mt-2 block text-[10px] font-bold leading-5 text-[#A69C91]">
                  密碼只會送到 Backend 做本次重新驗證；成功或失敗後都會從畫面狀態清除，不寫入 Firestore、Lifecycle 或瀏覽器儲存空間。
                </span>
              </label>

              {credentialDialog.type === "batch" && (
                <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2.5 text-xs font-bold leading-5 text-sky-800">
                  這組密碼只用於本次批次操作。Frontend 會依序呼叫既有單店 Endpoint；Backend 對每一間門市仍重新驗證 trusted device、最高管理者權限與 revision。
                </div>
              )}

              {credentialDialog.type === "dataset" && credentialDialog.nextStatus === "READY" && (
                <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2.5 text-xs font-bold leading-5 text-amber-800">
                  READY 只代表 Lifecycle Master 已完成確認；Batch 1 仍不會讓 Dashboard、Ranking、Annual 或 Telegram 改讀這份資料。
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeCredentialDialog}
                  disabled={saving || statusChanging || batchSaving}
                  className="rounded-xl border border-[#E8DDD0] bg-white px-4 py-3 text-sm font-black text-[#7C7063] disabled:opacity-40"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={confirmCredentialAction}
                  disabled={!credentialPassword.trim() || saving || statusChanging || batchSaving || currentDeviceTrust?.status !== "trusted"}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E8C77A] bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] px-4 py-3 text-sm font-black text-[#5A4225] disabled:opacity-45"
                >
                  {(saving || statusChanging || batchSaving) ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  {(saving || statusChanging || batchSaving) ? "驗證並處理中…" : "確認並繼續"}
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
