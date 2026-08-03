// src/components/HistoryView.jsx
import React, { useState, useContext, useMemo, useEffect, useCallback } from "react";
import { 
  Edit2, Trash2, Save, X, RotateCcw, Store, User, Loader2, 
  Calendar, Search, ArrowRight, ArrowLeft, Database,
  ChevronLeft, ChevronRight // ★ 新增翻頁圖示
} from "lucide-react";
import {
  doc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy
} from "firebase/firestore";

import { ViewWrapper, Card } from "./SharedUI";
import { AppContext } from "../AppContext";
import SmartDatePicker from "./SmartDatePicker";
import { formatLocalYYYYMMDD, toStandardDateFormat, sortStoreNames, sortStoresByOrgOrder } from "../utils/helpers";

const HistoryView = () => {
  const { 
    showToast, managers, managerOrder, userRole, currentUser, logActivity, 
    getCollectionPath, currentBrand, therapistModuleEnabled, accessibleStores = [],
    delegatedStores = [], canEditStoreReport, getActiveDelegationForStore
  } = useContext(AppContext);

  const isTherapistModuleEnabled = therapistModuleEnabled !== false;
  
  const [activeTab, setActiveTab] = useState((isTherapistModuleEnabled && (userRole === 'trainer' || userRole === 'therapist')) ? 'therapist' : 'store');
  
  const [storeRawData, setStoreRawData] = useState([]);
  const [therapistRawData, setTherapistRawData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const [hasQueried, setHasQueried] = useState(false);

  const todayStr = formatLocalYYYYMMDD(new Date());

  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);

  const [queryRange, setQueryRange] = useState({ start: todayStr, end: todayStr });

  const [filterStore, setFilterStore] = useState("");
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // ==========================================
  // ★ 新增：分頁系統狀態
  // ==========================================
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50; // 每頁顯示 50 筆，效能最佳化

  const fmt = (val) => (typeof val === "number" ? val.toLocaleString() : val);

  const brandPrefix = useMemo(() => {
    let name = "CYJ";
    if (currentBrand) {
      const id = typeof currentBrand === 'string' ? currentBrand : (currentBrand.id || "CYJ");
      const normalizedId = id.toLowerCase();
      if (normalizedId.includes("anniu") || normalizedId.includes("anew")) name = "安妞";
      else if (normalizedId.includes("yibo")) name = "伊啵";
      else name = "CYJ";
    }
    return name;
  }, [currentBrand]);

  const brandId = useMemo(() => {
    if (!currentBrand) return "unknown";
    return typeof currentBrand === "string" ? currentBrand : (currentBrand.id || "unknown");
  }, [currentBrand]);


  const getOperatorName = () => currentUser?.name || (userRole === "director" ? "高階主管" : (userRole === "trainer" ? "教專" : userRole || "unknown"));

  const pickChangedFields = (beforeData = {}, afterData = {}, fields = []) => {
    const changes = {};
    fields.forEach((field) => {
      const beforeValue = beforeData?.[field] ?? 0;
      const afterValue = afterData?.[field] ?? 0;
      if (String(beforeValue) !== String(afterValue)) {
        changes[field] = { before: beforeValue, after: afterValue };
      }
    });
    if (String(beforeData?.date || "") !== String(afterData?.date || "")) {
      changes.date = { before: beforeData?.date || "", after: afterData?.date || "" };
    }
    return changes;
  };

  const cleanStoreName = useCallback((name) => {
    if (!name) return "";
    let core = String(name)
      .replace(/^(CYJ|DRCYJ|Anew\s*\(安妞\)|Yibo\s*\(伊啵\)|安妞|伊啵|Anew|Yibo)\s*/i, "")
      .replace(/[　\s]+/g, "")
      .trim();

    // 舊版管理師資料曾把正式店名「新店」裁成「新」。
    // 查詢與權限比對時兩者統一為「新店」，既有日報不必重填即可顯示。
    if (core === "新" || /^新店店?$/.test(core)) return "新店";
    return core.replace(/店$/, "").trim();
  }, []);

  const formatStoreDisplayName = useCallback((name) => {
    const core = cleanStoreName(name);
    if (!core) return "未註記";
    return core === "新店" ? "新店" : `${core}店`;
  }, [cleanStoreName]);

  const formatStoreFilterValue = useCallback((name) => {
    const core = cleanStoreName(name);
    return core ? `${brandPrefix}${core}店` : "";
  }, [brandPrefix, cleanStoreName]);
  
  const myAllowedStores = useMemo(() => {
    if (userRole === 'director' || userRole === 'trainer' || userRole === 'master') return null;
    if ((userRole === 'manager' || userRole === 'store') && currentUser) {
      return (accessibleStores || []).map(cleanStoreName).filter(Boolean);
    }
    if (userRole === 'therapist' && currentUser) {
      const storeValue =
        currentUser.store ||
        currentUser.storeName ||
        currentUser.primaryStore ||
        (Array.isArray(currentUser.stores) ? currentUser.stores[0] : "");
      return [cleanStoreName(storeValue)].filter(Boolean);
    }
    return [];
  }, [userRole, currentUser, accessibleStores, cleanStoreName]);
  
  const allStores = useMemo(() => {
    const baseList = (myAllowedStores !== null) ? myAllowedStores : Object.values(managers).flat();
    const formattedStores = Array.from(new Set(
      baseList
        .filter(Boolean)
        .map((storeName) => formatStoreFilterValue(storeName))
        .filter(Boolean)
    ));

    return sortStoresByOrgOrder(managers, formattedStores, brandPrefix, managerOrder);
  }, [managers, managerOrder, myAllowedStores, brandPrefix, formatStoreFilterValue]);

  useEffect(() => {
    if (allStores.length === 1) setFilterStore(allStores[0]);
  }, [allStores]);

  // 品牌關閉管理師模組時，數據修正中心也同步收起管理師日報。
  // 若使用者原本停在管理師日報，會自動切回店務日報並清空管理師查詢資料。
  useEffect(() => {
    if (!isTherapistModuleEnabled && activeTab === "therapist") {
      setActiveTab("store");
      setTherapistRawData([]);
      setEditId(null);
      setEditForm({});
      setHasQueried(false);
      setCurrentPage(1);
    }
  }, [isTherapistModuleEnabled, activeTab]);

  const getStoreName = (row) => row?.storeName || row?.store || "未註記";

  const normalizeDateForQueue = (value) => String(value || "").replace(/\//g, "-").slice(0, 10);
  const getYearMonthForQueue = (value) => normalizeDateForQueue(value).slice(0, 7);

  // Summary dirty 與 recalc_queue 改由後端 Firestore onWrite 統一建立。
  // 歷史資料修改／刪除後，前端不再額外建立隨機 Queue 文件。

  const STORE_FIELDS = [
    { key: "cash", label: "現金", width: "min-w-[100px]" },
    { key: "accrual", label: "總權責", width: "min-w-[100px]" },
    { key: "operationalAccrual", label: "操作權責", width: "min-w-[100px]" },
    { key: "skincareSales", label: "保養品", width: "min-w-[100px]" },
    { key: "traffic", label: "操作人數", width: "min-w-[90px]" },
    { key: "newCustomers", label: "新客數", width: "min-w-[90px]" },
    { key: "newCustomerClosings", label: "新客留單", width: "min-w-[90px]" },
    { key: "newCustomerSales", label: "新客業績", width: "min-w-[100px]" },
    { key: "refund", label: "退費", width: "min-w-[100px]", isNegative: true },
    { key: "skincareRefund", label: "保養品退", width: "min-w-[100px]", isNegative: true },
  ];

  const THERAPIST_FIELDS = [
    { key: "totalRevenue", label: "總業績", width: "min-w-[100px]", isHighlight: true, readOnly: true },
    { key: "newCustomerRevenue", label: "新客業績", width: "min-w-[100px]" },
    { key: "newCustomerCount", label: "新客人數", width: "min-w-[80px]" },
    { key: "newCustomerClosings", label: "新客留單", width: "min-w-[80px]" },
    { key: "oldCustomerRevenue", label: "舊客業績", width: "min-w-[100px]" },
    { key: "oldCustomerCount", label: "舊客人數", width: "min-w-[80px]" },
    { key: "returnRevenue", label: "退費", width: "min-w-[100px]", isNegative: true },
  ];

  useEffect(() => {
    if (!hasQueried) {
      setStoreRawData([]);
      setTherapistRawData([]);
      return;
    }

    if (!isTherapistModuleEnabled && activeTab === "therapist") {
      setTherapistRawData([]);
      setIsLoading(false);
      return;
    }
    
    if (!queryRange.start || !queryRange.end) return;
    
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const collectionName = activeTab === "store" ? "daily_reports" : "therapist_daily_reports";
        const collectionRef = getCollectionPath(collectionName);
        
        const q = query(
          collectionRef, 
          where("date", ">=", queryRange.start), 
          where("date", "<=", queryRange.end), 
          orderBy("date", "desc")
        );
        
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (activeTab === "store") setStoreRawData(data); else setTherapistRawData(data);
        
        // ★ 查詢完畢後，強制回到第一頁
        setCurrentPage(1);
      } catch (e) {
        showToast("讀取失敗: " + e.message, "error");
      } finally { 
        setIsLoading(false); 
      }
    };
    fetchData();
  }, [activeTab, queryRange, getCollectionPath, showToast, currentBrand, hasQueried, isTherapistModuleEnabled]);

  const normalizeTherapistName = useCallback((value = "") => (
    String(value || "")
      .replace(/[　\s]+/g, "")
      .trim()
      .toLocaleLowerCase("zh-Hant")
  ), []);

  const currentTherapistIdentity = useMemo(() => {
    const storeValue =
      currentUser?.store ||
      currentUser?.storeName ||
      currentUser?.primaryStore ||
      (Array.isArray(currentUser?.stores) ? currentUser.stores[0] : "");

    return {
      id: String(currentUser?.id || "").trim(),
      name: normalizeTherapistName(currentUser?.name || ""),
      storeCore: cleanStoreName(storeValue),
    };
  }, [currentUser, normalizeTherapistName, cleanStoreName]);

  const isCurrentTherapistReport = useCallback((row = {}) => {
    const rowId = String(row?.therapistId || "").trim();
    if (currentTherapistIdentity.id && rowId === currentTherapistIdentity.id) return true;

    // 舊帳號曾使用不同 therapistId 時，以「同姓名＋同店家」安全銜接歷史日報。
    // 不只用姓名，避免不同店家同名人員互相看到資料。
    const rowName = normalizeTherapistName(row?.therapistName || row?.name || "");
    const rowStoreCore = cleanStoreName(getStoreName(row));
    const sameName = Boolean(currentTherapistIdentity.name) && rowName === currentTherapistIdentity.name;
    const sameStore = Boolean(currentTherapistIdentity.storeCore) && rowStoreCore === currentTherapistIdentity.storeCore;
    return sameName && sameStore;
  }, [currentTherapistIdentity, normalizeTherapistName, cleanStoreName]);

  const therapistLockedStoreLabel = useMemo(() => {
    const rawStore =
      currentUser?.store ||
      currentUser?.storeName ||
      currentUser?.primaryStore ||
      (Array.isArray(currentUser?.stores) ? currentUser.stores[0] : "");
    const core = cleanStoreName(rawStore);
    return core ? `${brandPrefix}${core}店` : "未註記";
  }, [currentUser, cleanStoreName, brandPrefix]);

  const filteredData = useMemo(() => {
    return (activeTab === "store" ? storeRawData : therapistRawData).filter((d) => {
      if (userRole === 'therapist') {
        if (activeTab !== 'therapist' || !isCurrentTherapistReport(d)) return false;
      } else if (myAllowedStores !== null) {
         const cleanRowStore = cleanStoreName(getStoreName(d));
         if (!myAllowedStores.some(allowed => cleanRowStore === cleanStoreName(allowed))) return false;
      }
      if (filterStore) {
        const cleanFilter = cleanStoreName(filterStore);
        const cleanRow = cleanStoreName(getStoreName(d));
        if (cleanRow !== cleanFilter) return false;
      }
      return true;
    });
  }, [storeRawData, therapistRawData, filterStore, myAllowedStores, userRole, activeTab, cleanStoreName, isCurrentTherapistReport]);

  // ==========================================
  // ★ 新增：計算分頁資料
  // ==========================================
  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE) || 1;
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredData.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredData, currentPage]);

  // 當過濾條件改變時，回到第一頁
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStore, activeTab]);

  const canModifyRow = useCallback((row, permissionKey = "editHistory") => {
    if (activeTab === "therapist") return userRole === "therapist" ? isCurrentTherapistReport(row) : true;
    if (typeof canEditStoreReport !== "function") return true;
    return canEditStoreReport(getStoreName(row), permissionKey);
  }, [activeTab, userRole, isCurrentTherapistReport, canEditStoreReport]);

  const startEdit = (row) => { 
    if (!canModifyRow(row, "editHistory")) {
      showToast("你目前沒有這筆日報的歷史修正權限", "error");
      return;
    }
    setEditId(row.id); 
    const safeDate = String(row.date || "").replace(/\//g, "-");
    setEditForm({ ...row, date: safeDate }); 
  };
  
  const cancelEdit = () => { setEditId(null); setEditForm({}); };
  
  const handleEditChange = (field, value) => { 
    setEditForm((prev) => {
      const newState = { ...prev, [field]: value };
      if (activeTab === "therapist" && ["newCustomerRevenue", "oldCustomerRevenue", "returnRevenue"].includes(field)) {
        newState.totalRevenue = Number(newState.newCustomerRevenue || 0) + Number(newState.oldCustomerRevenue || 0) - Number(newState.returnRevenue || 0);
      }
      if (activeTab === "store" && ["operationalAccrual", "skincareSales"].includes(field)) {
         newState.accrual = Number(newState.operationalAccrual || 0) + Number(newState.skincareSales || 0);
      }
      return newState;
    }); 
  };
  
  const saveEdit = async () => {
    const rowForPermission = (activeTab === "store" ? storeRawData : therapistRawData).find((item) => item.id === editId);
    if (!canModifyRow(rowForPermission, "editHistory")) {
      showToast("你目前沒有這筆日報的歷史修正權限", "error");
      return;
    }
    try {
      const collectionName = activeTab === "store" ? "daily_reports" : "therapist_daily_reports";
      const docRef = doc(getCollectionPath(collectionName), editId);
      let cleanData = {};
      const fields = activeTab === "store" ? ["cash", "accrual", "operationalAccrual", "skincareSales", "traffic", "newCustomers", "newCustomerClosings", "newCustomerSales", "refund", "skincareRefund"] : ["totalRevenue", "newCustomerRevenue", "newCustomerCount", "newCustomerClosings", "oldCustomerRevenue", "oldCustomerCount", "returnRevenue"];
      fields.forEach(f => { cleanData[f] = Number(editForm[f] || 0); });
      
      const finalSafeDate = String(editForm.date || "").replace(/\//g, "-");
      cleanData = { ...editForm, ...cleanData, date: finalSafeDate };

      const originalRow = (activeTab === "store" ? storeRawData : therapistRawData).find((item) => item.id === editId);
      const rowStoreCore = cleanStoreName(getStoreName(cleanData));
      const isDelegatedOperation = activeTab === "store" && (delegatedStores || []).map(cleanStoreName).includes(rowStoreCore);
      const activeDelegation = isDelegatedOperation && typeof getActiveDelegationForStore === "function"
        ? getActiveDelegationForStore(getStoreName(cleanData), null, "editHistory")
        : null;
      cleanData.operatedBy = getOperatorName();
      cleanData.actingManager = activeDelegation?.delegateName || cleanData.actingManager || "";
      cleanData.delegationId = activeDelegation?.id || cleanData.delegationId || "";
      cleanData.managementMode = activeDelegation ? "delegated" : (cleanData.managementMode || "official");

      await updateDoc(docRef, cleanData);
      // 後端 onWrite 會辨識歷史月份與實際欄位變更，並以固定 ID 建立重算 Queue。

      const changedFields = pickChangedFields(originalRow || {}, cleanData || {}, fields);
      logActivity?.(userRole, getOperatorName(), "修改歷史日報", {
        activityType: "data.update_report",
        view: "history",
        sourceType: collectionName,
        sourceId: editId,
        affectedYearMonth: getYearMonthForQueue(cleanData.date),
        affectedDate: cleanData.date,
        storeName: getStoreName(cleanData),
        therapistName: cleanData.therapistName || cleanData.name || "",
        changedFields,
        beforeData: originalRow || null,
        afterData: cleanData,
        summaryMarkedDirty: true,
      });

      showToast("更新成功", "success");
      const updateState = activeTab === "store" ? setStoreRawData : setTherapistRawData;
      updateState(prev => prev.map(item => item.id === editId ? { ...item, ...cleanData } : item));
      setEditId(null);
    } catch (e) { showToast("更新失敗", "error"); }
  };

  const handleDelete = async (id) => {
    const sourceData = (activeTab === "store" ? storeRawData : therapistRawData).find((item) => item.id === id);
    if (!canModifyRow(sourceData, "deleteReports")) {
      showToast("你目前沒有刪除這筆日報的權限", "error");
      return;
    }
    if (!confirm("確定刪除?")) return;
    try {
      const collectionName = activeTab === "store" ? "daily_reports" : "therapist_daily_reports";

      await deleteDoc(doc(getCollectionPath(collectionName), id));
      // 後端 onWrite 會以刪除前日期判斷歷史月份並建立唯一重算 Queue。

      logActivity?.(userRole, getOperatorName(), "刪除歷史日報", {
        activityType: "data.delete_report",
        view: "history",
        sourceType: collectionName,
        sourceId: id,
        affectedYearMonth: getYearMonthForQueue(sourceData?.date),
        affectedDate: sourceData?.date || "",
        storeName: getStoreName(sourceData),
        therapistName: sourceData?.therapistName || sourceData?.name || "",
        beforeData: sourceData || null,
        afterData: null,
        summaryMarkedDirty: true,
      });

      showToast("已刪除", "success");
      const updateState = activeTab === "store" ? setStoreRawData : setTherapistRawData;
      updateState(prev => prev.filter(p => p.id !== id)); 
    } catch (e) { showToast("刪除失敗", "error"); }
  };

  const handleExecuteQuery = () => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
  
  if (diffDays > 93) { // 限制最多只能查 3 個月
    showToast("為維持系統效能，查詢區間請勿超過 3 個月", "error");
    return;
  }
  
  logActivity?.(userRole, getOperatorName(), "查詢歷史資料", {
    activityType: "query.history_reports",
    view: "history",
    tab: activeTab,
    tabLabel: activeTab === "store" ? "店務日報" : "管理師日報",
    startDate,
    endDate,
    filterStore: filterStore || "全部店家",
    brandId,
    brandLabel: brandPrefix,
  });
  setQueryRange({ start: startDate, end: endDate });
  setHasQueried(true);
};

  const handleResetQuery = () => {
    setStartDate(todayStr);
    setEndDate(todayStr);
    setQueryRange({ start: todayStr, end: todayStr });
    setHasQueried(false);
    setStoreRawData([]);
    setTherapistRawData([]);
    if(allStores.length > 1) setFilterStore("");
    setCurrentPage(1);
  };

  return (
    <ViewWrapper>
      <div className="grid grid-cols-1 gap-6 w-full pb-20">
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
           <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-stone-800">數據修正中心</h2>
              <span className="px-2 py-1 bg-stone-100 text-stone-500 rounded text-xs font-bold">{brandPrefix}</span>
           </div>
           <span className="hidden sm:inline text-stone-400">|</span>
           
           <div className="flex bg-stone-200 p-1 rounded-xl w-full sm:w-auto">
              {userRole !== 'trainer' && userRole !== 'therapist' && (
                <button onClick={() => {setActiveTab("store"); setFilterStore("");}} className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-bold flex justify-center items-center gap-2 transition-all ${activeTab === 'store' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}><Store size={16}/> 店務日報</button>
              )}
              {isTherapistModuleEnabled && (
                <button onClick={() => {setActiveTab("therapist"); setFilterStore("");}} className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-bold flex justify-center items-center gap-2 transition-all ${activeTab === 'therapist' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}><User size={16}/> 管理師日報</button>
              )}
           </div>
        </div>

        {delegatedStores.length > 0 && (
          <div className="rounded-2xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm font-bold text-sky-800">
            目前有 {delegatedStores.length} 間代理店家可依授權查看或修正；正式績效歸屬仍維持原主管。
          </div>
        )}

        <Card className="!overflow-visible z-30 relative flex flex-col h-full">
          <div className="space-y-4 w-full flex-1 flex flex-col">
            
            <div className="flex flex-wrap items-end gap-4 bg-stone-50 p-4 rounded-xl border border-stone-100 relative z-30 shrink-0">
              
              <div className="w-full md:w-auto flex-grow">
                <label className="block text-xs font-bold text-stone-400 mb-1 flex items-center gap-1"><Calendar size={12}/> 篩選日期區間</label>
                <div className="flex flex-col md:flex-row items-center gap-2 w-full">
                  <div className="w-full sm:w-44">
                    <SmartDatePicker 
                      selectedDate={startDate}
                      onDateSelect={(val) => {
                        setStartDate(val);
                        if (val > endDate) setEndDate(val);
                      }}
                      maxDate={todayStr} 
                    />
                  </div>
                  <span className="text-stone-400 font-bold transform rotate-90 md:rotate-0">→</span>
                  <div className="w-full sm:w-44 relative">
                    <SmartDatePicker 
                      selectedDate={endDate}
                      onDateSelect={(val) => setEndDate(val)}
                      align="right"
                      minDate={startDate} 
                      maxDate={todayStr}  
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 w-full md:w-auto shrink-0">
                <div className="flex-grow min-w-[150px]">
                  <label className="block text-xs font-bold text-stone-400 mb-1">
                    {userRole === "therapist" ? "所屬店家" : "篩選店家"}
                  </label>
                  {userRole === "therapist" ? (
                    <div className="w-full h-[46px] px-4 rounded-xl font-bold bg-stone-100 border border-stone-200 text-stone-600 flex items-center">
                      {therapistLockedStoreLabel}
                    </div>
                  ) : (
                    <select
                      value={filterStore}
                      onChange={(e) => setFilterStore(e.target.value)}
                      disabled={allStores.length === 1}
                      style={{ colorScheme: "light" }}
                      className="w-full px-4 py-2 rounded-xl font-bold bg-white text-stone-700 border border-stone-200 outline-none focus:border-amber-400 h-[46px] disabled:bg-stone-100 disabled:text-stone-500"
                    >
                      {allStores.length > 1 && <option value="">全部店家</option>}
                      {allStores.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  )}
                </div>
                
                <div className="flex items-end gap-2">
                  <button 
                    onClick={handleExecuteQuery} 
                    disabled={isLoading}
                    className="px-6 py-2 bg-stone-800 text-white rounded-xl font-bold flex gap-2 hover:bg-stone-900 transition-colors shadow-sm h-[46px] items-center justify-center whitespace-nowrap active:scale-95 disabled:opacity-50"
                  >
                    {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} 
                    <span className="hidden sm:inline">{isLoading ? '讀取中' : '查詢'}</span>
                  </button>
                  
                  <button 
                    onClick={handleResetQuery} 
                    title="重置為今天"
                    className="px-3 py-2 bg-white border border-stone-200 text-stone-500 rounded-xl hover:bg-stone-50 transition-colors shadow-sm h-[46px] flex items-center justify-center"
                  >
                    <RotateCcw size={18} />
                  </button>
                </div>
              </div>
            </div>

            <div className="w-full border border-stone-200 rounded-xl bg-white shadow-sm flex flex-col relative z-10 flex-1">
              
              {!hasQueried ? (
                <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-stone-50/50 rounded-xl border-2 border-dashed border-stone-200 m-2">
                  <Database size={48} className="text-stone-300 mb-4" />
                  <h4 className="text-stone-500 font-bold text-lg mb-2 tracking-wide">數據查詢待命區</h4>
                  <p className="text-stone-400 text-sm max-w-sm">
                    為保護系統效能，進入此頁面時不會預先載入歷史資料。<br/><br/>
                    請在上方設定好日期範圍與店家後，點擊「<strong className="text-stone-600">查詢</strong>」以調閱紀錄。
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto w-full rounded-t-xl"> 
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-stone-100 text-stone-500 font-bold uppercase text-xs">
                        <tr>
                          <th className="p-4 md:sticky md:left-0 bg-stone-100 md:z-20 border-r border-stone-200 min-w-[140px]">日期 / 店名</th>
                          {activeTab === "store" ? ( STORE_FIELDS.map(f => (<th key={f.key} className={`p-4 text-right ${f.isNegative ? "text-rose-500" : ""} ${f.width}`}>{f.label}</th>)) ) : ( <> <th className="p-4 min-w-[100px]">姓名</th>{THERAPIST_FIELDS.map(f => (<th key={f.key} className={`p-4 text-right ${f.isNegative ? "text-rose-500" : f.isHighlight ? "text-indigo-600" : ""} ${f.width}`}>{f.label}</th>))}</> )}
                          <th className="p-4 text-center bg-stone-100 md:sticky md:right-0 md:z-20 border-l border-stone-200 min-w-[100px] shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.05)]">動作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {isLoading && <tr><td colSpan={20} className="p-10 text-center"><Loader2 className="animate-spin inline mr-2"/>資料讀取中...</td></tr>}
                        
                        {/* ★ 改用 paginatedData 來渲染，不再一次畫幾千筆 */}
                        {!isLoading && paginatedData.map((row) => {
                          const isEditing = editId === row.id;
                          const displayStore = formatStoreDisplayName(getStoreName(row));
                          return (
                            <tr key={row.id} className="group hover:bg-stone-50 transition-colors">
                              <td className="p-4 md:sticky md:left-0 bg-white group-hover:bg-stone-50 md:z-10 border-r border-stone-100">
                                <div className="flex flex-col">
                                  {isEditing ? (
                                    <div className="mb-1 w-32 relative">
                                      <SmartDatePicker 
                                        selectedDate={editForm.date}
                                        onDateSelect={(val) => handleEditChange('date', val)}
                                        maxDate={todayStr} 
                                      />
                                    </div>
                                  ) : (
                                    <span className="font-mono font-bold text-stone-600">{row.date}</span>
                                  )}
                                  <span className="font-bold text-stone-800">{displayStore}</span>
                                </div>
                              </td>
                              {activeTab === "store" ? ( STORE_FIELDS.map(f => (<td key={f.key} className="p-4 text-right">{isEditing ? (<input type="number" value={editForm[f.key]} onChange={(e)=>handleEditChange(f.key,e.target.value)} readOnly={f.key === 'accrual'} className={`border rounded w-20 text-right px-1 outline-none focus:border-amber-400 ${f.isNegative ? "text-rose-500" : ""} ${f.key === 'accrual' ? 'bg-stone-100 text-stone-500' : ''}`}/>) : (<span className={f.isNegative ? "text-rose-500 font-bold" : ""}>{fmt(row[f.key])}</span>)}</td>)) ) : ( <> <td className="p-4 font-bold">{row.therapistName}</td>{THERAPIST_FIELDS.map(f => (<td key={f.key} className="p-4 text-right">{isEditing ? (<input type="number" value={editForm[f.key]} onChange={(e)=>handleEditChange(f.key,e.target.value)} readOnly={f.readOnly} className={`border rounded w-20 text-right px-1 outline-none focus:border-indigo-400 ${f.isNegative ? "text-rose-500" : f.isHighlight ? "font-bold text-indigo-600" : ""} ${f.readOnly ? "bg-stone-100 text-stone-500 cursor-not-allowed" : ""}`}/>) : (<span className={f.isNegative ? "text-rose-500 font-bold" : f.isHighlight ? "text-indigo-600 font-bold" : ""}>{fmt(row[f.key])}</span>)}</td>))}</> )}
                              <td className="p-4 text-center md:sticky md:right-0 bg-white group-hover:bg-stone-50 md:z-10 border-l border-stone-100 shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.05)]">
                                {isEditing ? ( <div className="flex gap-2 justify-center"><button onClick={saveEdit} className="p-1.5 bg-emerald-100 text-emerald-600 rounded hover:bg-emerald-200"><Save size={16}/></button><button onClick={cancelEdit} className="p-1.5 bg-stone-100 text-stone-500 rounded hover:bg-stone-200"><X size={16}/></button></div> ) : ( <div className="flex gap-2 justify-center">{canModifyRow(row, "editHistory") && <button onClick={()=>startEdit(row)} className="p-1.5 hover:bg-amber-50 text-amber-500 rounded transition-colors"><Edit2 size={16}/></button>}{canModifyRow(row, "deleteReports") && <button onClick={()=>handleDelete(row.id)} className="p-1.5 hover:bg-rose-50 text-rose-500 rounded transition-colors"><Trash2 size={16}/></button>}{!canModifyRow(row, "editHistory") && !canModifyRow(row, "deleteReports") && <span className="text-xs font-bold text-stone-300">僅查看</span>}</div> )}
                              </td>
                            </tr>
                          );
                        })}
                        {!isLoading && filteredData.length === 0 && ( <tr><td colSpan={20} className="p-10 text-center text-stone-400">該日期區間無相關資料 (請確認日期或篩選條件)</td></tr> )}
                      </tbody>
                    </table>
                  </div>

                  {/* ========================================== */}
                  {/* ★ 新增：分頁控制列 (Pagination UI) */}
                  {/* ========================================== */}
                  {!isLoading && filteredData.length > 0 && (
                    <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 bg-stone-50 border-t border-stone-200 rounded-b-xl gap-4">
                      <div className="text-sm font-bold text-stone-500">
                        共查詢到 <span className="text-stone-800">{filteredData.length}</span> 筆資料
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="p-2 rounded-lg bg-white border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                          <ChevronLeft size={18} />
                        </button>
                        
                        <div className="px-4 text-sm font-bold text-stone-600 font-mono">
                          {currentPage} / {totalPages}
                        </div>
                        
                        <button 
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                          className="p-2 rounded-lg bg-white border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>
      </div>
    </ViewWrapper>
  );
};

export default HistoryView;
