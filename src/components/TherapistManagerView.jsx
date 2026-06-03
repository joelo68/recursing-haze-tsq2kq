// src/components/TherapistManagerView.jsx
import React, { useState, useContext, useMemo, useEffect } from "react";
import {
  UserCheck,
  Archive,
  Search,
  Plus,
  Edit2,
  X,
  Key,
  Calendar,
  UserX,
  Store,
  Trash2,
  Users,
  Shield,
  TrendingUp,
  Lock,
  Eye,
  ChevronDown,
  CheckCircle2,
} from "lucide-react";
import { doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

import { AppContext } from "../AppContext";
import { ViewWrapper } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";
import { formatLocalYYYYMMDD, sortManagerNames, sortStoreNames, sortTherapistsByStoreThenName, sortManagersByOrgOrder, sortStoresByOrgOrder } from "../utils/helpers";

const TherapistManagerView = () => {
  const {
    therapists,
    managers, managerOrder,
    showToast,
    getCollectionPath,
    fetchGlobalData,
  } = useContext(AppContext);

  const [showResigned, setShowResigned] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedManagerFilter, setSelectedManagerFilter] = useState("all");
  const [selectedStoreFilter, setSelectedStoreFilter] = useState("all");

  const [selectedTherapist, setSelectedTherapist] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // 2xl 以下使用抽屜，避免右側面板把畫面撐爆
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [formManager, setFormManager] = useState("");
  const [formStore, setFormStore] = useState("");
  const [formName, setFormName] = useState("");
  const [formPassword, setFormPassword] = useState("0000");
  const [formOnboardDate, setFormOnboardDate] = useState("");
  const [formResignDate, setFormResignDate] = useState("");

  const getTodayStr = () => formatLocalYYYYMMDD(new Date());

  const formatStoreName = (name) => {
    if (!name) return "未分店";
    return String(name).endsWith("店") ? String(name) : `${name}店`;
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

    const cleanStore = String(storeName).replace(/店$/, "");

    for (const [mgr, stores] of Object.entries(managers)) {
      const found = (stores || []).some(
        (s) => String(s).replace(/店$/, "") === cleanStore
      );

      if (found) return mgr;
    }

    return "";
  };

  const resetForm = () => {
    setFormManager("");
    setFormStore("");
    setFormName("");
    setFormPassword("0000");
    setFormOnboardDate(getTodayStr());
    setFormResignDate("");
    setShowPassword(false);
  };

  const loadTherapistToForm = (t) => {
    const foundManager = findManagerByStore(t?.store);

    setFormManager(foundManager || "");
    setFormStore(String(t?.store || "").replace(/店$/, ""));
    setFormName(t?.name || "");
    setFormPassword(t?.password || "");
    setFormOnboardDate(t?.onboardDate || "");
    setFormResignDate(t?.resignDate || "");
    setShowPassword(false);
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
      .map((s) => String(s).replace(/店$/, ""));

    return sortStoresByOrgOrder(managers, [...new Set(stores)], '', managerOrder);
  }, [managers, managerOrder]);

  const storesForManagerFilter = useMemo(() => {
    if (selectedManagerFilter === "all") return allStores;

    return sortStoresByOrgOrder(managers, (managers?.[selectedManagerFilter] || []).map((s) =>
      String(s).replace(/店$/, "")
    ), '', managerOrder);
  }, [selectedManagerFilter, allStores, managers, managerOrder]);

  const availableStoresForForm = useMemo(() => {
    if (!formManager || !managers) return [];

    return sortStoresByOrgOrder(managers, (managers[formManager] || []).map((s) =>
      String(s).replace(/店$/, "")
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
          String(t.store || "").replace(/店$/, "") ===
          String(selectedStoreFilter).replace(/店$/, "")
      );
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();

      list = list.filter((t) => {
        return (
          String(t?.name || "").toLowerCase().includes(q) ||
          String(t?.id || "").toLowerCase().includes(q) ||
          String(t?.store || "").toLowerCase().includes(q) ||
          String(t?.password || "").toLowerCase().includes(q)
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

    if (!selectedTherapist && filteredTherapists.length > 0) {
      setSelectedTherapist(filteredTherapists[0]);
      loadTherapistToForm(filteredTherapists[0]);
      return;
    }

    if (
      selectedTherapist &&
      !filteredTherapists.some((t) => t.id === selectedTherapist.id)
    ) {
      const next = filteredTherapists[0] || null;
      setSelectedTherapist(next);

      if (next) loadTherapistToForm(next);
      else resetForm();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTherapists, isCreating, hasActiveFilter]);

  const handleSelectTherapist = (t) => {
    setIsCreating(false);
    setSelectedTherapist(t);
    loadTherapistToForm(t);
    setIsDrawerOpen(true);
  };

  const openCreatePanel = () => {
    setIsCreating(true);
    setSelectedTherapist(null);
    resetForm();
    setIsDrawerOpen(true);
  };

  const closePanel = () => {
    setIsDrawerOpen(false);
    setIsCreating(false);

    if (hasActiveFilter && filteredTherapists.length > 0) {
      setSelectedTherapist(filteredTherapists[0]);
      loadTherapistToForm(filteredTherapists[0]);
    } else {
      setSelectedTherapist(null);
      resetForm();
    }
  };

  const handleCreateTherapist = async () => {
    if (!formStore || !formName.trim() || !formPassword.trim()) {
      showToast("請填寫完整人員資訊：店家、姓名與密碼", "error");
      return;
    }

    const newId = `T${Date.now().toString().slice(-6)}`;

    try {
      const docRef = doc(getCollectionPath("therapists"), newId);

      await setDoc(docRef, {
        id: newId,
        name: formName.trim(),
        store: formStore,
        password: formPassword.trim(),
        onboardDate: formOnboardDate || getTodayStr(),
        resignDate: formResignDate || "",
        status: formResignDate ? "離職" : "在職",
        isActive: !formResignDate,
        isResigned: Boolean(formResignDate),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      showToast("新增人員成功", "success");
      setIsCreating(false);
      setIsDrawerOpen(false);

      if (fetchGlobalData) fetchGlobalData();
    } catch (error) {
      console.error("新增失敗:", error);
      showToast("新增失敗", "error");
    }
  };

  const handleUpdateTherapist = async () => {
    if (!selectedTherapist || !formStore || !formName.trim() || !formPassword.trim()) {
      showToast("資料不完整，請確認姓名、店家與密碼", "error");
      return;
    }

    try {
      const archived = Boolean(formResignDate);
      const docRef = doc(getCollectionPath("therapists"), selectedTherapist.id);

      await setDoc(
        docRef,
        {
          name: formName.trim(),
          store: formStore,
          password: formPassword.trim(),
          onboardDate: formOnboardDate || "",
          resignDate: formResignDate || "",
          status: archived ? "離職" : "在職",
          isActive: !archived,
          isResigned: archived,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      showToast("資料更新成功", "success");

      if (fetchGlobalData) fetchGlobalData();
    } catch (error) {
      console.error("更新失敗:", error);
      showToast("更新失敗", "error");
    }
  };

  const toggleStatus = async (t = selectedTherapist) => {
    if (!t) return;

    const archived = isTherapistArchived(t);
    const nextArchived = !archived;
    const actionName = nextArchived ? "封存帳號" : "重新啟用帳號";

    if (!window.confirm(`確定要${actionName}「${t.name}」嗎？`)) return;

    try {
      const docRef = doc(getCollectionPath("therapists"), t.id);

      await setDoc(
        docRef,
        {
          isResigned: nextArchived,
          status: nextArchived ? "離職" : "在職",
          isActive: !nextArchived,
          resignDate: nextArchived ? getTodayStr() : "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      showToast(`已${actionName}`, "success");

      if (fetchGlobalData) fetchGlobalData();
    } catch (error) {
      console.error("狀態更新失敗:", error);
      showToast("狀態更新失敗", "error");
    }
  };

  const handleDeleteTherapist = async (t = selectedTherapist) => {
    if (!t) return;

    if (
      !window.confirm(
        `警告：這是永久實體刪除，將無法復原。\n\n建議優先使用「封存」保留歷史資料。\n\n確定永久刪除「${t.name}」嗎？`
      )
    ) {
      return;
    }

    try {
      await deleteDoc(doc(getCollectionPath("therapists"), t.id));

      showToast("人員已永久刪除", "success");
      setSelectedTherapist(null);
      setIsCreating(false);
      setIsDrawerOpen(false);

      if (fetchGlobalData) fetchGlobalData();
    } catch (error) {
      console.error("刪除失敗:", error);
      showToast("刪除失敗", "error");
    }
  };

  const resetPassword = () => {
    const next = window.prompt("請輸入新的登入密碼", formPassword || "0000");

    if (next === null) return;

    const cleaned = next.trim();

    if (!cleaned) {
      showToast("密碼不可空白", "error");
      return;
    }

    setFormPassword(cleaned);
    showToast("密碼已暫存，請按「儲存修改」才會寫入", "info");
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

  const SelectBox = ({ value, onChange, children, className = "" }) => {
    return (
      <div className={`relative ${className}`}>
        <select
          value={value}
          onChange={onChange}
          className="w-full h-10 pl-3 pr-8 rounded-xl bg-white border border-stone-200 text-xs font-black text-stone-600 outline-none appearance-none focus:border-amber-300 focus:ring-4 focus:ring-amber-50 transition-all"
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
                ? "調整人員資料與狀態"
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
                  placeholder="請輸入姓名"
                  className="w-full h-10 px-3 rounded-xl bg-stone-50 border border-stone-200 text-xs font-black text-stone-800 outline-none focus:bg-white focus:border-amber-300 focus:ring-4 focus:ring-amber-50 transition-all"
                />
              </div>

              {!isCreating && selectedTherapist?.id && (
                <div>
                  <label className="block text-[11px] font-black text-stone-400 mb-1.5 tracking-wider">
                    登入帳號 / 文件 ID
                  </label>
                  <input
                    type="text"
                    value={selectedTherapist.id}
                    readOnly
                    className="w-full h-10 px-3 rounded-xl bg-stone-100 border border-stone-200 text-xs font-mono font-bold text-stone-400 outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-[11px] font-black text-stone-400 mb-1.5 tracking-wider">
                  登入密碼
                </label>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Key
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="預設 0000"
                      className="w-full h-10 pl-9 pr-9 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono font-black text-stone-800 outline-none focus:bg-white focus:border-amber-300 focus:ring-4 focus:ring-amber-50 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-all flex items-center justify-center"
                      title="顯示 / 隱藏密碼"
                    >
                      <Eye size={14} />
                    </button>
                  </div>

                  <button
                    onClick={resetPassword}
                    className="h-10 px-3 rounded-xl border border-stone-200 bg-white text-stone-600 text-xs font-black hover:bg-stone-50 transition-all whitespace-nowrap"
                  >
                    重設
                  </button>
                </div>
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
                      className={`h-9 px-3 rounded-xl text-xs font-black border transition-all flex items-center gap-1.5 ${
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
                  className="h-10 rounded-xl bg-stone-900 text-white text-xs font-black shadow-md hover:bg-stone-800 active:scale-[0.98] transition-all"
                >
                  {isCreating ? "確認新增" : "儲存修改"}
                </button>
              </div>

              {!isCreating && selectedTherapist && (
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
                  <div className="hidden sm:grid grid-cols-[minmax(110px,1.35fr)_78px_58px_82px_42px_82px] px-4 py-3 bg-stone-50/80 border-b border-stone-100 text-[11px] font-black text-stone-400 tracking-wider items-center">
                    <div>姓名</div>
                    <div>店家</div>
                    <div>狀態</div>
                    <div>上線日</div>
                    <div>密碼</div>
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
                          className={`sm:grid sm:grid-cols-[minmax(110px,1.35fr)_78px_58px_82px_42px_82px] px-4 py-3 border-b border-stone-100 items-center cursor-pointer transition-all group ${
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

                          <div className="hidden sm:block text-[11px] font-mono font-black tracking-[0.2em] text-stone-500">
                            ••••
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

                            <button
                              onClick={() => handleDeleteTherapist(t)}
                              className="w-7 h-7 rounded-lg bg-white border border-stone-200 text-stone-300 shadow-sm hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-all flex items-center justify-center"
                              title="永久刪除"
                            >
                              <Trash2 size={11} />
                            </button>
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