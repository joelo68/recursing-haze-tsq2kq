// src/components/TherapistManagerView.jsx
import React, { useState, useContext, useMemo, useEffect, useRef } from "react";
import {
  UserCheck,
  Archive,
  Search,
  Plus,
  Edit2,
  X,
  Calendar,
  UserX,
  Store,
  Trash2,
  Users,
  Shield,
  TrendingUp,
  Lock,
  ChevronDown,
  CheckCircle2,
} from "lucide-react";
import { AppContext } from "../AppContext";
import { ViewWrapper } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";
import { formatLocalYYYYMMDD, sortManagerNames, sortStoreNames, sortTherapistsByStoreThenName, sortManagersByOrgOrder, sortStoresByOrgOrder } from "../utils/helpers";

const TherapistManagerView = () => {
  const {
    therapists,
    managers, managerOrder,
    showToast,
    manageTherapistMasterAction,
  } = useContext(AppContext);

  const [showResigned, setShowResigned] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedManagerFilter, setSelectedManagerFilter] = useState("all");
  const [selectedStoreFilter, setSelectedStoreFilter] = useState("all");

  const [selectedTherapist, setSelectedTherapist] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  // 2xl 以下使用抽屜，避免右側面板把畫面撐爆
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const detailRequestRef = useRef(0);

  const [formManager, setFormManager] = useState("");
  const [formStore, setFormStore] = useState("");
  const [formName, setFormName] = useState("");
  const [formOnboardDate, setFormOnboardDate] = useState("");
  const [formResignDate, setFormResignDate] = useState("");

  const getTodayStr = () => formatLocalYYYYMMDD(new Date());

  // ★ 新店相容修正：
  // 一般店名可移除尾端「店」作為核心名稱，但「新店」本身就是正式地名，不能裁成「新」。
  // 同時相容既有錯誤資料 store="新" 與可能出現的「CYJ新店店」。
  const normalizeManagedStoreCore = (name = "") => {
    const compact = String(name || "")
      .trim()
      .replace(/^(CYJ|DRCYJ|Anew\s*\(安妞\)|Yibo\s*\(伊啵\)|Anew|Yibo|安妞|伊啵)\s*/i, "")
      .replace(/[　\s]+/g, "")
      .trim();

    if (!compact) return "";
    if (compact === "新" || /^新店店?$/.test(compact)) return "新店";
    return compact.replace(/店$/, "").trim();
  };

  const formatStoreName = (name) => {
    const core = normalizeManagedStoreCore(name);
    if (!core) return "未分店";

    // 「新店」是正式地名；畫面上的門市名稱仍需再加一個「店」字。
    // 新店（地名）＋店（門市後綴）＝新店店。
    return `${core}店`;
  };

  const isTherapistArchived = (t) => {
    return (
      t?.isResigned === true ||
      t?.status === "resigned" ||
      t?.status === "離職" ||
      t?.status === "封存" ||
      t?.isActive === false
    );
  };

  const findManagerByStore = (storeName) => {
    if (!storeName || !managers) return "";

    const cleanStore = normalizeManagedStoreCore(storeName);

    for (const [mgr, stores] of Object.entries(managers)) {
      const found = (stores || []).some(
        (s) => normalizeManagedStoreCore(s) === cleanStore
      );

      if (found) return mgr;
    }

    return "";
  };

  const resetForm = () => {
    setFormManager("");
    setFormStore("");
    setFormName("");
    setFormOnboardDate(getTodayStr());
    setFormResignDate("");
  };

  const loadTherapistToForm = (t) => {
    const rawStore = t?.store || t?.storeName || t?.primaryStore || (Array.isArray(t?.stores) ? t.stores[0] : "");
    const foundManager = findManagerByStore(rawStore);

    setFormManager(foundManager || "");
    setFormStore(normalizeManagedStoreCore(rawStore));
    setFormName(t?.name || "");
    setFormOnboardDate(t?.onboardDate || "");
    setFormResignDate(t?.resignDate || "");
  };

  const loadTherapistDetail = async (t, { openDrawer = false } = {}) => {
    if (!t?.id) return t || null;

    setIsCreating(false);
    setSelectedTherapist(t);
    loadTherapistToForm(t);
    if (openDrawer) setIsDrawerOpen(true);

    if (t.masterSignature) return t;

    const requestId = ++detailRequestRef.current;
    setDetailLoadingId(String(t.id));

    try {
      const result = await manageTherapistMasterAction({
        action: "get",
        therapistId: t.id,
      });
      const next = result?.therapist
        ? { ...result.therapist, masterSignature: result.masterSignature || result.therapist.masterSignature || "" }
        : t;

      if (detailRequestRef.current === requestId) {
        setSelectedTherapist(next);
        loadTherapistToForm(next);
      }
      return next;
    } catch (error) {
      console.error("管理師資料確認失敗:", error);
      if (detailRequestRef.current === requestId) {
        showToast(getManagementErrorMessage(error, "目前無法確認這筆人員資料"), "error");
      }
      throw error;
    } finally {
      if (detailRequestRef.current === requestId) {
        setDetailLoadingId("");
      }
    }
  };

  const allManagers = useMemo(() => {
    return sortManagersByOrgOrder(managers, Object.keys(managers || {}).filter(
      (m) => !m.includes("未分配") && !m.includes("未分區")
    ), managerOrder);
  }, [managers, managerOrder]);

  const allStores = useMemo(() => {
    const stores = Object.values(managers || {})
      .flat()
      .filter(Boolean)
      .map((s) => normalizeManagedStoreCore(s));

    return sortStoresByOrgOrder(managers, [...new Set(stores)], '', managerOrder);
  }, [managers, managerOrder]);

  const storesForManagerFilter = useMemo(() => {
    if (selectedManagerFilter === "all") return allStores;

    return sortStoresByOrgOrder(managers, (managers?.[selectedManagerFilter] || []).map((s) =>
      normalizeManagedStoreCore(s)
    ), '', managerOrder);
  }, [selectedManagerFilter, allStores, managers, managerOrder]);

  const availableStoresForForm = useMemo(() => {
    if (!formManager || !managers) return [];

    return sortStoresByOrgOrder(managers, (managers[formManager] || []).map((s) =>
      normalizeManagedStoreCore(s)
    ), '', managerOrder);
  }, [formManager, managers, managerOrder]);

  const hasActiveFilter = useMemo(() => {
    return (
      searchTerm.trim().length > 0 ||
      selectedManagerFilter !== "all" ||
      selectedStoreFilter !== "all"
    );
  }, [searchTerm, selectedManagerFilter, selectedStoreFilter]);

  const activeFilterLabel = useMemo(() => {
    if (!hasActiveFilter) return "尚未篩選";

    const parts = [];
    if (selectedManagerFilter !== "all") parts.push(`${selectedManagerFilter}區`);
    if (selectedStoreFilter !== "all") parts.push(formatStoreName(selectedStoreFilter));
    if (searchTerm.trim()) parts.push(`搜尋「${searchTerm.trim()}」`);

    return parts.join(" / ");
  }, [hasActiveFilter, selectedManagerFilter, selectedStoreFilter, searchTerm]);

  const stats = useMemo(() => {
    const list = therapists || [];
    const active = list.filter((t) => !isTherapistArchived(t));
    const archived = list.filter((t) => isTherapistArchived(t));

    const currentMonth = getTodayStr().slice(0, 7);
    const thisMonthNew = list.filter((t) => {
      const date = t?.onboardDate || "";
      return date.startsWith(currentMonth);
    });

    return {
      total: list.length,
      active: active.length,
      archived: archived.length,
      thisMonthNew: thisMonthNew.length,
    };
  }, [therapists]);

  const filteredTherapists = useMemo(() => {
    if (!hasActiveFilter) return [];

    let list = therapists || [];

    list = list.filter((t) => {
      const archived = isTherapistArchived(t);
      return showResigned ? archived : !archived;
    });

    if (selectedManagerFilter !== "all") {
      list = list.filter(
        (t) => findManagerByStore(t.store) === selectedManagerFilter
      );
    }

    if (selectedStoreFilter !== "all") {
      list = list.filter(
        (t) =>
          normalizeManagedStoreCore(t.store || t.storeName || "") ===
          normalizeManagedStoreCore(selectedStoreFilter)
      );
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();

      list = list.filter((t) => {
        return (
          String(t?.name || "").toLowerCase().includes(q) ||
          String(t?.id || "").toLowerCase().includes(q) ||
          String(t?.store || "").toLowerCase().includes(q)
        );
      });
    }

    return [...list].sort((a, b) => {
      const storeA = a?.store || "";
      const storeB = b?.store || "";
      const nameA = a?.name || "";
      const nameB = b?.name || "";

      if (storeA !== storeB) return storeA.localeCompare(storeB, "zh-Hant");
      return nameA.localeCompare(nameB, "zh-Hant");
    });
  }, [
    therapists,
    showResigned,
    searchTerm,
    selectedManagerFilter,
    selectedStoreFilter,
    managers, managerOrder,
    hasActiveFilter,
  ]);

  useEffect(() => {
    if (isCreating) return;

    if (!hasActiveFilter) {
      setSelectedTherapist(null);
      setIsDrawerOpen(false);
      return;
    }

    if (!selectedTherapist) return;

    if (selectedTherapist) {
      const refreshedSelected = filteredTherapists.find((t) => t.id === selectedTherapist.id);
      if (
        refreshedSelected &&
        refreshedSelected.masterSignature &&
        refreshedSelected.masterSignature !== selectedTherapist.masterSignature
      ) {
        // OCC 衝突後 Backend 會重新抓名單；同一筆 ID 若簽章已變，右側表單也要同步到最新版，
        // 避免使用者在舊 local state 上再次送出相同的過期 signature。
        setSelectedTherapist(refreshedSelected);
        loadTherapistToForm(refreshedSelected);
        return;
      }

      if (!refreshedSelected) {
        setSelectedTherapist(null);
        setIsDrawerOpen(false);
        resetForm();
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTherapists, isCreating, hasActiveFilter]);

  const handleSelectTherapist = (t) => {
    loadTherapistDetail(t, { openDrawer: true }).catch(() => {});
  };

  const openCreatePanel = () => {
    detailRequestRef.current += 1;
    setDetailLoadingId("");
    setIsCreating(true);
    setSelectedTherapist(null);
    resetForm();
    setIsDrawerOpen(true);
  };

  const closePanel = () => {
    detailRequestRef.current += 1;
    setDetailLoadingId("");
    setIsDrawerOpen(false);
    setIsCreating(false);

    setSelectedTherapist(null);
    resetForm();
  };

  const getManagementErrorMessage = (error, fallback = "操作失敗") => {
    const code = String(error?.code || error?.result?.code || "");
    if (code === "therapist_master_conflict") return "這筆人員資料剛被其他管理者更新，已重新確認最新內容，請確認後再操作。";
    if (code === "super_admin_reverification_required") return "管理者驗證已失效，請重新登入後再操作。";
    if (code === "archive_before_delete_required") return "請先封存帳號，再進行永久刪除。";
    if (code === "store_outside_brand_organization") return "所選店家已不在目前品牌的組織架構中，請重新選擇。";
    if (code === "organization_duplicate_store") return "目前店家歸屬有重複，請先修正區域與店家設定。";
    if (code === "credential_payload_not_allowed") return "人員主檔不能直接修改登入密碼。";
    if (code === "therapist_missing" || code === "account_missing") return "找不到這位管理師的最新帳號資料，請重新搜尋。";
    if (code === "account_inactive") return "封存中的帳號不能重設登入密碼，請先重新啟用。";
    if (["credential_source_missing", "credential_document_invalid", "credential_dual_source_conflict", "invalid_credential_storage_mode"].includes(code)) {
      return "這位管理師的登入資料狀態需要管理者檢查，暫時無法重設密碼。";
    }
    return error?.result?.message || error?.message || fallback;
  };

  const handleCreateTherapist = async () => {
    if (!formStore || !formName.trim()) {
      showToast("請填寫完整人員資訊：店家與姓名", "error");
      return;
    }
    if (typeof manageTherapistMasterAction !== "function") {
      showToast("人員帳號安全服務尚未就緒", "error");
      return;
    }

    try {
      const result = await manageTherapistMasterAction({
        action: "create",
        payload: {
          name: formName.trim(),
          store: normalizeManagedStoreCore(formStore),
          onboardDate: formOnboardDate || getTodayStr(),
          resignDate: formResignDate || "",
        },
      });
      const next = result?.therapist
        ? { ...result.therapist, masterSignature: result.masterSignature || "" }
        : null;

      showToast("新增人員成功；初次登入將使用系統初始密碼並要求更新", "success");
      setIsCreating(false);
      setIsDrawerOpen(false);
      if (next) setSelectedTherapist(next);
    } catch (error) {
      console.error("新增失敗:", error);
      showToast(getManagementErrorMessage(error, "新增失敗"), "error");
    }
  };

  const handleUpdateTherapist = async () => {
    if (!selectedTherapist || !formStore || !formName.trim()) {
      showToast("資料不完整，請確認姓名與店家", "error");
      return;
    }
    if (!selectedTherapist.masterSignature) {
      showToast("這筆資料版本尚未同步完成，請重新進入管師帳號後再試", "error");
      return;
    }

    try {
      const result = await manageTherapistMasterAction({
        action: "update",
        therapistId: selectedTherapist.id,
        expectedMasterSignature: selectedTherapist.masterSignature,
        payload: {
          name: formName.trim(),
          store: normalizeManagedStoreCore(formStore),
          onboardDate: formOnboardDate || getTodayStr(),
          resignDate: formResignDate || "",
        },
      });
      const next = result?.therapist
        ? { ...result.therapist, masterSignature: result.masterSignature || "" }
        : selectedTherapist;

      showToast("資料更新成功", "success");
      setSelectedTherapist(next);
      loadTherapistToForm(next);
      setIsDrawerOpen(false);
      setIsCreating(false);
    } catch (error) {
      console.error("更新失敗:", error);
      showToast(getManagementErrorMessage(error, "更新失敗"), "error");
    }
  };

  const toggleStatus = async (t = selectedTherapist) => {
    if (!t) return;

    let target = t;
    if (!target.masterSignature) {
      try {
        target = await loadTherapistDetail(target);
      } catch {
        return;
      }
    }
    if (!target?.masterSignature) {
      showToast("這筆資料尚未確認完成，請稍後再試", "error");
      return;
    }

    const archived = isTherapistArchived(target);
    const action = archived ? "restore" : "archive";
    const actionName = archived ? "重新啟用帳號" : "封存帳號";
    if (!window.confirm(`確定要${actionName}「${target.name}」嗎？`)) return;

    try {
      const result = await manageTherapistMasterAction({
        action,
        therapistId: target.id,
        expectedMasterSignature: target.masterSignature,
        payload: archived ? {} : { resignDate: getTodayStr() },
      });
      const next = result?.therapist
        ? { ...result.therapist, masterSignature: result.masterSignature || "" }
        : target;
      setSelectedTherapist(next);
      loadTherapistToForm(next);
      showToast(`已${actionName}`, "success");
    } catch (error) {
      console.error("狀態更新失敗:", error);
      showToast(getManagementErrorMessage(error, "狀態更新失敗"), "error");
    }
  };

  const handleResetTherapistPassword = async (t = selectedTherapist) => {
    if (!t) return;
    if (isTherapistArchived(t)) {
      showToast("封存中的帳號不能重設登入密碼，請先重新啟用。", "error");
      return;
    }

    let target = t;
    if (!target.masterSignature) {
      try {
        target = await loadTherapistDetail(target, { openDrawer: true });
      } catch {
        return;
      }
    }
    if (!target?.masterSignature) {
      showToast("這筆資料尚未確認完成，請稍後再試", "error");
      return;
    }

    const confirmed = window.confirm(
      `確定要重設「${target.name}」的登入密碼嗎？\n\n重設後本人需使用系統初始密碼登入，並重新設定自己的密碼。`
    );
    if (!confirmed) return;

    try {
      const result = await manageTherapistMasterAction({
        action: "reset_password",
        therapistId: target.id,
        expectedMasterSignature: target.masterSignature,
      });
      const next = result?.therapist
        ? { ...result.therapist, masterSignature: result.masterSignature || target.masterSignature }
        : target;
      setSelectedTherapist(next);
      loadTherapistToForm(next);
      showToast("登入密碼已重設；請讓本人使用系統初始密碼重新登入並設定新密碼。", "success");
    } catch (error) {
      console.error("重設登入密碼失敗:", error);
      showToast(getManagementErrorMessage(error, "重設登入密碼失敗"), "error");
    }
  };

  const handleDeleteTherapist = async (t = selectedTherapist) => {
    if (!t) return;
    if (!isTherapistArchived(t)) {
      showToast("永久刪除前請先封存帳號，以避免誤刪在職人員", "error");
      return;
    }

    let target = t;
    if (!target.masterSignature) {
      try {
        target = await loadTherapistDetail(target);
      } catch {
        return;
      }
    }
    if (!target?.masterSignature) {
      showToast("這筆資料尚未確認完成，請稍後再試", "error");
      return;
    }

    if (!window.confirm(`警告：這是永久實體刪除，將無法復原。\n\n確定永久刪除「${target.name}」嗎？`)) return;

    try {
      await manageTherapistMasterAction({
        action: "delete",
        therapistId: target.id,
        expectedMasterSignature: target.masterSignature,
        confirmPermanentDelete: true,
      });
      showToast("人員已永久刪除", "success");
      setSelectedTherapist(null);
      setIsCreating(false);
      setIsDrawerOpen(false);
    } catch (error) {
      console.error("刪除失敗:", error);
      showToast(getManagementErrorMessage(error, "刪除失敗"), "error");
    }
  };

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedManagerFilter("all");
    setSelectedStoreFilter("all");
    setSelectedTherapist(null);
    setIsDrawerOpen(false);
  };

  const StatCard = ({ icon: Icon, label, value, active, tone = "stone" }) => {
    const toneClass =
      tone === "green"
        ? "text-emerald-600 bg-emerald-50 border-emerald-100"
        : tone === "amber"
        ? "text-amber-600 bg-amber-50 border-amber-100"
        : "text-stone-500 bg-stone-50 border-stone-100";

    return (
      <div
        className={`bg-white rounded-2xl border px-3 py-3 shadow-sm ${
          active ? "border-emerald-200 ring-1 ring-emerald-100" : "border-stone-100"
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center border ${toneClass}`}
          >
            <Icon size={16} />
          </div>

          <div>
            <p className="text-[11px] font-black text-stone-400 tracking-wide">
              {label}
            </p>
            <p className="text-lg font-black text-stone-800 leading-tight">
              {value}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const SelectBox = ({ value, onChange, children, className = "", disabled = false }) => {
    return (
      <div className={`relative ${className}`}>
        <select
          value={value}
          onChange={onChange}
          disabled={disabled}
          className="w-full h-10 pl-3 pr-8 rounded-xl bg-white border border-stone-200 text-xs font-black text-stone-600 outline-none appearance-none focus:border-amber-300 focus:ring-4 focus:ring-amber-50 transition-all disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-wait"
        >
          {children}
        </select>
        <ChevronDown
          size={14}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
        />
      </div>
    );
  };

  const selectedArchived = selectedTherapist
    ? isTherapistArchived(selectedTherapist)
    : false;
  const selectedDetailLoading = Boolean(
    selectedTherapist?.id &&
    detailLoadingId === String(selectedTherapist.id)
  );

  const renderDetailPanel = ({ mode = "inline" }) => (
    <aside
      className={`bg-white min-w-0 h-full ${
        mode === "inline" ? "" : "shadow-2xl"
      }`}
    >
      <div className="h-full flex flex-col">
        <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-black text-stone-900 tracking-tight">
              {isCreating ? "新增管理師" : "人員資料"}
            </h3>
            <p className="text-[11px] text-stone-400 font-bold mt-1 truncate">
              {isCreating
                ? "建立新的管理師登入帳號"
                : selectedTherapist
                ? (selectedDetailLoading ? "正在確認最新資料…" : "調整人員資料與狀態")
                : "請從左側選擇人員"}
            </p>
          </div>

          <button
            onClick={closePanel}
            className="w-8 h-8 rounded-xl border border-stone-200 text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition-all flex items-center justify-center shrink-0"
            title="關閉"
          >
            <X size={16} />
          </button>
        </div>

        {!isCreating && !selectedTherapist ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
                <Edit2 size={22} className="text-stone-300" />
              </div>
              <p className="font-black text-stone-600">尚未選擇人員</p>
              <p className="text-xs text-stone-400 mt-1">
                點擊左側任一列即可編輯。
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-[11px] font-black text-stone-400 mb-1.5 tracking-wider">
                  所屬區域
                </label>
                <SelectBox
                  value={formManager}
                  disabled={selectedDetailLoading}
                  onChange={(e) => {
                    setFormManager(e.target.value);
                    setFormStore("");
                  }}
                >
                  <option value="">選擇區域</option>
                  {allManagers.map((m) => (
                    <option key={m} value={m}>
                      {m}區
                    </option>
                  ))}
                </SelectBox>
              </div>

              <div>
                <label className="block text-[11px] font-black text-stone-400 mb-1.5 tracking-wider">
                  配屬店家
                </label>
                <SelectBox
                  value={formStore}
                  disabled={selectedDetailLoading}
                  onChange={(e) => setFormStore(e.target.value)}
                >
                  <option value="">選擇店家</option>
                  {availableStoresForForm.map((s) => (
                    <option key={s} value={s}>
                      {formatStoreName(s)}
                    </option>
                  ))}
                </SelectBox>
              </div>

              <div>
                <label className="block text-[11px] font-black text-stone-400 mb-1.5 tracking-wider">
                  員工姓名
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  disabled={selectedDetailLoading}
                  placeholder="請輸入姓名"
                  className="w-full h-10 px-3 rounded-xl bg-stone-50 border border-stone-200 text-xs font-black text-stone-800 outline-none focus:bg-white focus:border-amber-300 focus:ring-4 focus:ring-amber-50 transition-all"
                />
              </div>

              {!isCreating && selectedTherapist?.id && (
                <div>
                  <label className="block text-[11px] font-black text-stone-400 mb-1.5 tracking-wider">
                    登入帳號
                  </label>
                  <input
                    type="text"
                    value={selectedTherapist.id}
                    readOnly
                    className="w-full h-10 px-3 rounded-xl bg-stone-100 border border-stone-200 text-xs font-mono font-bold text-stone-400 outline-none"
                  />
                </div>
              )}

              <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3">
                <p className="text-xs font-black text-amber-800">登入密碼由本人管理</p>
                <p className="mt-1 text-[11px] font-bold leading-5 text-amber-700/80">
                  此頁不顯示、搜尋或直接編輯任何登入密碼。忘記密碼時，可由最高管理者重設為系統初始密碼，再由本人登入後重新設定。
                </p>

                {!isCreating && selectedTherapist && !selectedArchived && (
                  <button
                    onClick={() => handleResetTherapistPassword(selectedTherapist)}
                    disabled={selectedDetailLoading}
                    className="mt-3 h-9 px-3 rounded-xl border border-amber-200 bg-white text-amber-800 text-xs font-black hover:bg-amber-50 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-wait"
                  >
                    <Lock size={13} />
                    {selectedDetailLoading ? "確認資料中…" : "重設登入密碼"}
                  </button>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-black text-stone-400 mb-1.5 tracking-wider flex items-center gap-1">
                  <Calendar size={12} />
                  上線日
                </label>
                <SmartDatePicker
                  selectedDate={formOnboardDate || getTodayStr()}
                  onDateSelect={setFormOnboardDate}
                />
              </div>

              <div>
                <label className="block text-[11px] font-black text-stone-400 mb-1.5 tracking-wider flex items-center gap-1">
                  <Calendar size={12} />
                  停權日
                </label>

                <div className="relative">
                  <SmartDatePicker
                    selectedDate={formResignDate || "未設定"}
                    onDateSelect={setFormResignDate}
                  />

                  {formResignDate && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setFormResignDate("");
                      }}
                      className="absolute right-9 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white text-stone-300 hover:text-rose-500 hover:bg-rose-50 transition-all flex items-center justify-center"
                      title="清除停權日"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-stone-400 mt-1.5 font-bold">
                  留空表示此帳號為在職狀態。
                </p>
              </div>

              {!isCreating && selectedTherapist && (
                <div className="pt-3 border-t border-stone-100">
                  <label className="block text-[11px] font-black text-stone-400 mb-2 tracking-wider">
                    帳號狀態
                  </label>

                  <div className="flex items-center justify-between gap-2">
                    <div
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black ${
                        selectedArchived
                          ? "bg-stone-100 text-stone-500"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      <CheckCircle2 size={14} />
                      {selectedArchived ? "已封存" : "在職"}
                    </div>

                    <button
                      onClick={() => toggleStatus(selectedTherapist)}
                      disabled={selectedDetailLoading}
                      className={`h-9 px-3 rounded-xl text-xs font-black border transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-wait ${
                        selectedArchived
                          ? "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                      }`}
                    >
                      {selectedArchived ? <UserCheck size={14} /> : <Archive size={14} />}
                      {selectedArchived ? "啟用" : "封存"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-stone-100 bg-stone-50/60">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={closePanel}
                  className="h-10 rounded-xl border border-stone-200 bg-white text-stone-600 text-xs font-black hover:bg-stone-50 transition-all"
                >
                  取消
                </button>

                <button
                  onClick={isCreating ? handleCreateTherapist : handleUpdateTherapist}
                  disabled={!isCreating && (selectedDetailLoading || !selectedTherapist?.masterSignature)}
                  className="h-10 rounded-xl bg-stone-900 text-white text-xs font-black shadow-md hover:bg-stone-800 active:scale-[0.98] transition-all disabled:bg-stone-300 disabled:shadow-none disabled:cursor-wait"
                >
                  {isCreating ? "確認新增" : "儲存修改"}
                </button>
              </div>

              {!isCreating && selectedTherapist && selectedArchived && (
                <button
                  onClick={() => handleDeleteTherapist(selectedTherapist)}
                  className="mt-2 w-full h-8 rounded-xl text-[11px] font-black text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-all flex items-center justify-center gap-1.5"
                >
                  <Trash2 size={12} />
                  永久刪除此帳號
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );

  return (
    <ViewWrapper>
      <div className="w-full max-w-full min-w-0 space-y-4 pb-8 overflow-hidden">
        {/* 統計摘要 */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard icon={Users} label="全部" value={stats.total} />
          <StatCard icon={UserCheck} label="在職" value={stats.active} active tone="green" />
          <StatCard icon={Lock} label="封存" value={stats.archived} />
          <StatCard icon={TrendingUp} label="本月新增" value={stats.thisMonthNew} tone="amber" />
        </div>

        {/* 主容器 */}
        <div className="bg-white rounded-[1.75rem] border border-stone-100 shadow-sm overflow-hidden">
          {/* 控制列 */}
          <div className="p-3 border-b border-stone-100 bg-white">
            <div className="flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
              <div className="flex bg-stone-100/70 p-1 rounded-2xl border border-stone-200/60 w-full xl:w-auto">
                <button
                  onClick={() => setShowResigned(false)}
                  className={`flex-1 xl:w-32 h-10 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all ${
                    !showResigned
                      ? "bg-white text-stone-900 shadow-sm ring-1 ring-amber-100"
                      : "text-stone-400 hover:text-stone-600"
                  }`}
                >
                  <UserCheck size={15} className={!showResigned ? "text-emerald-500" : ""} />
                  在職戰力
                </button>

                <button
                  onClick={() => setShowResigned(true)}
                  className={`flex-1 xl:w-32 h-10 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all ${
                    showResigned
                      ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200"
                      : "text-stone-400 hover:text-stone-600"
                  }`}
                >
                  <Archive size={15} className={showResigned ? "text-stone-600" : ""} />
                  封存庫
                </button>
              </div>

              <div className="flex flex-col md:flex-row gap-2 w-full xl:w-auto">
                <div className="relative flex-1 xl:w-[280px]">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
                  />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setSelectedTherapist(null);
                    }}
                    placeholder="搜尋姓名、店家或帳號..."
                    className="w-full h-10 pl-9 pr-3 rounded-xl bg-stone-50 border border-stone-100 text-xs font-bold text-stone-700 placeholder-stone-400 outline-none focus:bg-white focus:border-amber-300 focus:ring-4 focus:ring-amber-50 transition-all"
                  />
                </div>

                <SelectBox
                  value={selectedManagerFilter}
                  onChange={(e) => {
                    setSelectedManagerFilter(e.target.value);
                    setSelectedStoreFilter("all");
                    setSelectedTherapist(null);
                  }}
                  className="md:w-36"
                >
                  <option value="all">區域：全部</option>
                  {allManagers.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </SelectBox>

                <SelectBox
                  value={selectedStoreFilter}
                  onChange={(e) => {
                    setSelectedStoreFilter(e.target.value);
                    setSelectedTherapist(null);
                  }}
                  className="md:w-36"
                >
                  <option value="all">店家：全部</option>
                  {storesForManagerFilter.map((s) => (
                    <option key={s} value={s}>
                      {formatStoreName(s)}
                    </option>
                  ))}
                </SelectBox>

                <button
                  onClick={openCreatePanel}
                  className="h-10 px-4 rounded-xl bg-stone-900 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md hover:bg-stone-800 active:scale-[0.98] transition-all whitespace-nowrap"
                >
                  <Plus size={16} />
                  新增
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-2xl border border-amber-100 bg-amber-50/40 px-4 py-3">
              <div className="flex items-start gap-2 min-w-0">
                <Search size={15} className="text-amber-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-black text-amber-800">
                    {hasActiveFilter ? "目前篩選條件" : "請先篩選後查看名單"}
                  </p>
                  <p className="text-[11px] font-bold text-amber-700/80 truncate">
                    {hasActiveFilter
                      ? activeFilterLabel
                      : "選擇區域、店家，或輸入姓名 / 帳號後，系統才會顯示符合條件的人員。"}
                  </p>
                </div>
              </div>

              {hasActiveFilter && (
                <button
                  onClick={clearFilters}
                  className="h-8 px-3 rounded-xl bg-white/80 border border-amber-100 text-[11px] font-black text-amber-700 hover:bg-white transition-all shrink-0"
                >
                  清除條件
                </button>
              )}
            </div>
          </div>

          {/* 
            2xl 以上：左右並排
            2xl 以下：只顯示名冊，資料面板改成右側抽屜
          */}
          <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_330px] min-h-[590px]">
            {/* 左側名冊 */}
            <div className="min-w-0 border-r border-stone-100 bg-white overflow-hidden">
              {filteredTherapists.length === 0 ? (
                <div className="h-full min-h-[480px] flex items-center justify-center p-8">
                  <div className="text-center max-w-sm">
                    <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
                      {hasActiveFilter ? (
                        <UserX size={28} className="text-stone-300" />
                      ) : (
                        <Search size={28} className="text-amber-400" />
                      )}
                    </div>
                    <h3 className="text-base font-black text-stone-700 mb-1">
                      {hasActiveFilter
                        ? showResigned
                          ? "查無符合條件的封存人員"
                          : "查無符合條件的在職人員"
                        : "請先篩選或搜尋管理師"}
                    </h3>
                    <p className="text-xs text-stone-400 leading-relaxed">
                      {hasActiveFilter
                        ? "請調整區域、店家或搜尋條件；也可以直接新增一位管理師。"
                        : "為了讓畫面更簡潔，此頁不會預設展開完整名單。請選擇區域、店家，或輸入姓名 / 帳號後查看結果。"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="w-full overflow-hidden">
                  {/* 表頭 */}
                  <div className="hidden sm:grid grid-cols-[minmax(130px,1.5fr)_88px_64px_92px_82px] px-4 py-3 bg-stone-50/80 border-b border-stone-100 text-[11px] font-black text-stone-400 tracking-wider items-center">
                    <div>姓名</div>
                    <div>店家</div>
                    <div>狀態</div>
                    <div>上線日</div>
                    <div className="text-center">操作</div>
                  </div>

                  <div>
                    {filteredTherapists.map((t) => {
                      const archived = isTherapistArchived(t);
                      const selected = selectedTherapist?.id === t.id && !isCreating;

                      return (
                        <div
                          key={t.id}
                          onClick={() => handleSelectTherapist(t)}
                          className={`sm:grid sm:grid-cols-[minmax(130px,1.5fr)_88px_64px_92px_82px] px-4 py-3 border-b border-stone-100 items-center cursor-pointer transition-all group ${
                            selected
                              ? "bg-amber-50/70 shadow-[inset_3px_0_0_#d97706]"
                              : "bg-white hover:bg-stone-50/90"
                          }`}
                        >
                          {/* 手機版 */}
                          <div className="sm:hidden flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-black text-stone-900 truncate">
                                {t.name || "未命名"}
                              </div>
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-stone-500">
                                <span>{formatStoreName(t.store)}</span>
                                <span
                                  className={`px-2 py-0.5 rounded-full font-black ${
                                    archived
                                      ? "bg-stone-100 text-stone-500"
                                      : "bg-emerald-50 text-emerald-700"
                                  }`}
                                >
                                  {archived ? "封存" : "在職"}
                                </span>
                              </div>
                            </div>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTherapist(t);
                              }}
                              className="w-8 h-8 rounded-lg bg-white border border-stone-200 text-stone-500 shadow-sm flex items-center justify-center shrink-0"
                            >
                              <Edit2 size={14} />
                            </button>
                          </div>

                          {/* 桌機 / 平板版 */}
                          <div className="hidden sm:block min-w-0 pr-2">
                            <div className="text-sm font-black text-stone-900 truncate tracking-tight">
                              {t.name || "未命名"}
                            </div>
                            <div className="mt-0.5 text-[10px] font-mono text-stone-400 truncate">
                              {t.id || "—"}
                            </div>
                          </div>

                          <div className="hidden sm:block min-w-0">
                            <span className="inline-flex max-w-full items-center gap-1 px-2 py-1 rounded-full bg-stone-100 text-stone-600 text-[10px] font-black truncate">
                              <Store size={10} className="shrink-0" />
                              <span className="truncate">{formatStoreName(t.store)}</span>
                            </span>
                          </div>

                          <div className="hidden sm:block">
                            {archived ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-full bg-stone-100 text-stone-500 text-[10px] font-black">
                                封存
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black">
                                在職
                              </span>
                            )}
                          </div>

                          <div className="hidden sm:block text-[11px] font-black text-stone-500 truncate">
                            {t.onboardDate || "—"}
                          </div>

                          <div
                            className="hidden sm:flex items-center justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => handleSelectTherapist(t)}
                              className="w-7 h-7 rounded-lg bg-white border border-stone-200 text-stone-500 shadow-sm hover:text-amber-600 hover:border-amber-200 hover:bg-amber-50 transition-all flex items-center justify-center"
                              title="編輯"
                            >
                              <Edit2 size={12} />
                            </button>

                            <button
                              onClick={() => toggleStatus(t)}
                              className={`w-7 h-7 rounded-lg bg-white border shadow-sm transition-all flex items-center justify-center ${
                                archived
                                  ? "border-emerald-100 text-emerald-600 hover:bg-emerald-50"
                                  : "border-stone-200 text-stone-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50"
                              }`}
                              title={archived ? "重新啟用" : "封存帳號"}
                            >
                              {archived ? <UserCheck size={12} /> : <Archive size={12} />}
                            </button>

                            {archived && (
                              <button
                                onClick={() => handleDeleteTherapist(t)}
                                className="w-7 h-7 rounded-lg bg-white border border-stone-200 text-stone-300 shadow-sm hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-all flex items-center justify-center"
                                title="永久刪除"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="px-4 py-3 bg-white flex items-center justify-between text-xs text-stone-400">
                    <div className="font-black">
                      目前結果 {filteredTherapists.length} 筆｜全體帳號 {stats.total} 筆
                    </div>

                    <div className="hidden xl:flex items-center gap-2 text-[11px] font-bold">
                      <Shield size={13} className="text-stone-300" />
                      建議封存保留歷史資料。
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 大螢幕才固定右側面板 */}
            <div className="hidden 2xl:block">
              {renderDetailPanel({ mode: "inline" })}
            </div>
          </div>
        </div>

        {/* 2xl 以下：右側滑出 Drawer */}
        {isDrawerOpen && (
          <div className="fixed inset-0 z-[9999] 2xl:hidden">
            <div
              className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
              onClick={closePanel}
            />

            <div className="absolute right-0 top-0 h-full w-full sm:w-[390px] max-w-full bg-white animate-in slide-in-from-right duration-300">
              {renderDetailPanel({ mode: "drawer" })}
            </div>
          </div>
        )}
      </div>
    </ViewWrapper>
  );
};

export default TherapistManagerView;