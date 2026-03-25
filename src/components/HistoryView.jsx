// src/components/HistoryView.jsx
import React, { useState, useContext, useMemo, useEffect, useCallback } from "react";
import { Edit2, Trash2, Save, X, RotateCcw, Store, User, Loader2, Calendar, Search, ArrowRight, ArrowLeft } from "lucide-react";
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

import { db, appId } from "../config/firebase";
import { ViewWrapper, Card } from "./SharedUI";
import { AppContext } from "../AppContext";
// ★ 引入標準化日期組件與濾水器
import SmartDatePicker from "./SmartDatePicker";
import { formatLocalYYYYMMDD, toStandardDateFormat } from "../utils/helpers";

const HistoryView = () => {
  const { 
    showToast, managers, userRole, currentUser, 
    getCollectionPath, getDocPath, currentBrand 
  } = useContext(AppContext);
  
  const [activeTab, setActiveTab] = useState((userRole === 'trainer' || userRole === 'therapist') ? 'therapist' : 'store');
  
  const [storeRawData, setStoreRawData] = useState([]);
  const [therapistRawData, setTherapistRawData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // 初始化日期，確保時區與格式正確
  const [startDate, setStartDate] = useState(() => formatLocalYYYYMMDD(new Date()));
  const [endDate, setEndDate] = useState(() => formatLocalYYYYMMDD(new Date()));

  const [filterStore, setFilterStore] = useState("");
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});

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

  const cleanStoreName = useCallback((name) => {
    if (!name) return "";
    let core = String(name).replace(/^(CYJ|Anew\s*\(安妞\)|Yibo\s*\(伊啵\)|安妞|伊啵|Anew|Yibo)\s*/i, '').trim();
    if (core === "新店") return "新店";
    return core.replace(/店$/, '').trim();
  }, []);
  
  const myAllowedStores = useMemo(() => {
    if (userRole === 'director' || userRole === 'trainer') return null; 
    if (userRole === 'manager' && currentUser) return (managers[currentUser.name] || []).map(s => s.trim());
    if (userRole === 'store' && currentUser) {
      const stores = currentUser.stores || [currentUser.storeName];
      return stores.map(s => cleanStoreName(s));
    }
    if (userRole === 'therapist' && currentUser) return [currentUser.store];
    return [];
  }, [userRole, currentUser, managers, cleanStoreName]);
  
  const allStores = useMemo(() => {
    let baseList = (myAllowedStores !== null) ? myAllowedStores : Object.values(managers).flat();
    return baseList.filter(s => s).map((s) => `${brandPrefix}${s}店`).sort();
  }, [managers, myAllowedStores, brandPrefix]);

  useEffect(() => {
    if (allStores.length === 1) setFilterStore(allStores[0]);
  }, [allStores]);

  const getStoreName = (row) => row?.storeName || row?.store || "未註記";

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
    if (!startDate || !endDate) return;
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const collectionName = activeTab === "store" ? "daily_reports" : "therapist_daily_reports";
        const collectionRef = getCollectionPath(collectionName);
        // 使用清洗後的 YYYY-MM-DD 精準查詢
        const q = query(collectionRef, where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc"));
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (activeTab === "store") setStoreRawData(data); else setTherapistRawData(data);
      } catch (e) {
        showToast("讀取失敗: " + e.message, "error");
      } finally { setIsLoading(false); }
    };
    fetchData();
  }, [activeTab, startDate, endDate, getCollectionPath, showToast, currentBrand]);

  const filteredData = useMemo(() => {
    return (activeTab === "store" ? storeRawData : therapistRawData).filter((d) => {
      if (userRole === 'therapist') { if (activeTab !== 'therapist' || d.therapistId !== currentUser?.id) return false; }
      else if (myAllowedStores !== null) {
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
  }, [storeRawData, therapistRawData, filterStore, myAllowedStores, userRole, currentUser, activeTab, cleanStoreName]);

  const startEdit = (row) => { setEditId(row.id); setEditForm({ ...row, date: toStandardDateFormat(row.date) }); };
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
    try {
      const collectionName = activeTab === "store" ? "daily_reports" : "therapist_daily_reports";
      const docRef = doc(getCollectionPath(collectionName), editId);
      let cleanData = {};
      const fields = activeTab === "store" ? ["cash", "accrual", "operationalAccrual", "skincareSales", "traffic", "newCustomers", "newCustomerClosings", "newCustomerSales", "refund", "skincareRefund"] : ["totalRevenue", "newCustomerRevenue", "newCustomerCount", "newCustomerClosings", "oldCustomerRevenue", "oldCustomerCount", "returnRevenue"];
      fields.forEach(f => { cleanData[f] = Number(editForm[f] || 0); });
      // 將 editForm 裡的 date、storeName 等資訊與清洗後的數字欄位合併
      cleanData = { ...editForm, ...cleanData };
      await updateDoc(docRef, cleanData);
      showToast("更新成功", "success");
      const updateState = activeTab === "store" ? setStoreRawData : setTherapistRawData;
      updateState(prev => prev.map(item => item.id === editId ? { ...item, ...cleanData } : item));
      setEditId(null);
    } catch (e) { showToast("更新失敗", "error"); }
  };

  const handleDelete = async (id) => {
    if (!confirm("確定刪除?")) return;
    try {
      const collectionName = activeTab === "store" ? "daily_reports" : "therapist_daily_reports";
      await deleteDoc(doc(getCollectionPath(collectionName), id));
      showToast("已刪除", "success");
      const updateState = activeTab === "store" ? setStoreRawData : setTherapistRawData;
      updateState(prev => prev.filter(p => p.id !== id)); 
    } catch (e) { showToast("刪除失敗", "error"); }
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
              <button onClick={() => {setActiveTab("therapist"); setFilterStore("");}} className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-bold flex justify-center items-center gap-2 transition-all ${activeTab === 'therapist' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}><User size={16}/> 管理師日報</button>
           </div>
        </div>

        {/* 修正 1：移除外層 overflow-hidden，確保日曆 Portal 正常運作 */}
        <Card className="!overflow-visible z-30 relative">
          <div className="space-y-4 w-full">
            
            <div className="flex flex-wrap items-end gap-4 bg-stone-50 p-4 rounded-xl border border-stone-100 relative z-30">
              
              <div className="w-full md:w-auto flex-grow">
                <label className="block text-xs font-bold text-stone-400 mb-1 flex items-center gap-1"><Calendar size={12}/> 篩選日期區間</label>
                <div className="flex flex-col md:flex-row items-center gap-2 w-full">
                  <div className="w-full sm:w-44">
                    <SmartDatePicker 
                      selectedDate={startDate}
                      onDateSelect={(val) => setStartDate(val)}
                    />
                  </div>
                  <span className="text-stone-400 font-bold transform rotate-90 md:rotate-0">→</span>
                  <div className="w-full sm:w-44 relative">
                    {/* 第二個選取器靠右對齊，防止超出 */}
                    <SmartDatePicker 
                      selectedDate={endDate}
                      onDateSelect={(val) => setEndDate(val)}
                      align="right"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 w-full md:w-auto shrink-0">
                <div className="flex-grow min-w-[150px]">
                  <label className="block text-xs font-bold text-stone-400 mb-1">篩選店家</label>
                  <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)} disabled={allStores.length === 1} className="w-full px-4 py-2 rounded-xl font-bold bg-white border border-stone-200 outline-none focus:border-amber-400 h-[46px] disabled:bg-stone-100 disabled:text-stone-500">
                    {allStores.length > 1 && <option value="">全部店家</option>}
                    {allStores.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex items-end">
                  <button onClick={() => { const today = formatLocalYYYYMMDD(new Date()); setStartDate(today); setEndDate(today); if(allStores.length > 1) setFilterStore(""); }} className="px-4 py-2 bg-white border border-stone-200 text-stone-600 rounded-xl font-bold flex gap-2 hover:bg-stone-50 transition-colors shadow-sm h-[46px] items-center justify-center whitespace-nowrap"><RotateCcw size={16} /> <span className="hidden sm:inline">重置</span></button>
                </div>
              </div>
            </div>

            <div className="w-full border border-stone-200 rounded-xl bg-white shadow-sm flex flex-col relative z-10">
              <div className="overflow-x-auto w-full rounded-xl"> 
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
                    {!isLoading && filteredData.map((row) => {
                      const isEditing = editId === row.id;
                      const displayStore = cleanStoreName(getStoreName(row));
                      return (
                        <tr key={row.id} className="group hover:bg-stone-50 transition-colors">
                          <td className="p-4 md:sticky md:left-0 bg-white group-hover:bg-stone-50 md:z-10 border-r border-stone-100">
                            <div className="flex flex-col">
                              {/* ★ 關鍵修正 1：將表格內部的舊輸入框也替換為 SmartDatePicker ★ */}
                              {isEditing ? (
                                <div className="mb-1 w-32 relative">
                                  <SmartDatePicker 
                                    selectedDate={editForm.date}
                                    onDateSelect={(val) => handleEditChange('date', val)}
                                  />
                                </div>
                              ) : (
                                <span className="font-mono font-bold text-stone-600">{row.date}</span>
                              )}
                              <span className="font-bold text-stone-800">{displayStore}店</span>
                            </div>
                          </td>
                          {activeTab === "store" ? ( STORE_FIELDS.map(f => (<td key={f.key} className="p-4 text-right">{isEditing ? (<input type="number" value={editForm[f.key]} onChange={(e)=>handleEditChange(f.key,e.target.value)} readOnly={f.key === 'accrual'} className={`border rounded w-20 text-right px-1 outline-none focus:border-amber-400 ${f.isNegative ? "text-rose-500" : ""} ${f.key === 'accrual' ? 'bg-stone-100 text-stone-500' : ''}`}/>) : (<span className={f.isNegative ? "text-rose-500 font-bold" : ""}>{fmt(row[f.key])}</span>)}</td>)) ) : ( <> <td className="p-4 font-bold">{row.therapistName}</td>{THERAPIST_FIELDS.map(f => (<td key={f.key} className="p-4 text-right">{isEditing ? (<input type="number" value={editForm[f.key]} onChange={(e)=>handleEditChange(f.key,e.target.value)} readOnly={f.readOnly} className={`border rounded w-20 text-right px-1 outline-none focus:border-indigo-400 ${f.isNegative ? "text-rose-500" : f.isHighlight ? "font-bold text-indigo-600" : ""} ${f.readOnly ? "bg-stone-100 text-stone-500 cursor-not-allowed" : ""}`}/>) : (<span className={f.isNegative ? "text-rose-500 font-bold" : f.isHighlight ? "text-indigo-600 font-bold" : ""}>{fmt(row[f.key])}</span>)}</td>))}</> )}
                          <td className="p-4 text-center md:sticky md:right-0 bg-white group-hover:bg-stone-50 md:z-10 border-l border-stone-100 shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.05)]">
                            {isEditing ? ( <div className="flex gap-2 justify-center"><button onClick={saveEdit} className="p-1.5 bg-emerald-100 text-emerald-600 rounded hover:bg-emerald-200"><Save size={16}/></button><button onClick={cancelEdit} className="p-1.5 bg-stone-100 text-stone-500 rounded hover:bg-stone-200"><X size={16}/></button></div> ) : ( <div className="flex gap-2 justify-center"><button onClick={()=>startEdit(row)} className="p-1.5 hover:bg-amber-50 text-amber-500 rounded transition-colors"><Edit2 size={16}/></button><button onClick={()=>handleDelete(row.id)} className="p-1.5 hover:bg-rose-50 text-rose-500 rounded transition-colors"><Trash2 size={16}/></button></div> )}
                          </td>
                        </tr>
                      );
                    })}
                    {!isLoading && filteredData.length === 0 && ( <tr><td colSpan={20} className="p-10 text-center text-stone-400">該日期區間無相關資料 (請確認日期或篩選條件)</td></tr> )}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden py-2 text-center text-stone-400 text-xs flex justify-center items-center gap-1 bg-stone-50 rounded-b-xl border-t border-stone-100"><ArrowLeft size={12}/> 左右滑動以查看更多 <ArrowRight size={12}/></div>
            </div>
          </div>
        </Card>
      </div>
    </ViewWrapper>
  );
};

export default HistoryView;