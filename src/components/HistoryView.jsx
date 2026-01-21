// src/components/HistoryView.jsx
import React, { useState, useContext, useMemo, useEffect } from "react";
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
import { toStandardDateFormat } from "../utils/helpers";

const HistoryView = () => {
  // ★ 修改 1: 取得 userRole
  const { showToast, managers, userRole } = useContext(AppContext);
  
  // ★ 修改 2: 若是教專，預設 tab 為 'therapist'
  const [activeTab, setActiveTab] = useState(userRole === 'trainer' ? 'therapist' : 'store');
  
  // 資料狀態
  const [storeRawData, setStoreRawData] = useState([]);
  const [therapistRawData, setTherapistRawData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // 日期區間 (預設今天)
  const getToday = () => new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(getToday());
  const [endDate, setEndDate] = useState(getToday());

  // 篩選與編輯狀態
  const [filterStore, setFilterStore] = useState("");
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const fmt = (val) => (typeof val === "number" ? val.toLocaleString() : val);
  
  // 取得所有店家列表
  const allStores = useMemo(
    () => Object.values(managers).flat().map((s) => `CYJ${s}店`).sort(),
    [managers]
  );

  // 取得資料列的店名 (防呆)
  const getStoreName = (row) => {
    if (!row) return "";
    return row.storeName || row.store || "未註記";
  };

  // 1. 定義店務日報欄位
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

  // 2. 定義管理師日報欄位
  const THERAPIST_FIELDS = [
    { key: "totalRevenue", label: "總業績", width: "min-w-[100px]", isHighlight: true, readOnly: true },
    { key: "newCustomerRevenue", label: "新客業績", width: "min-w-[100px]" },
    { key: "newCustomerCount", label: "新客人數", width: "min-w-[80px]" },
    { key: "newCustomerClosings", label: "新客留單", width: "min-w-[80px]" },
    { key: "oldCustomerRevenue", label: "舊客業績", width: "min-w-[100px]" },
    { key: "oldCustomerCount", label: "舊客人數", width: "min-w-[80px]" },
    { key: "returnRevenue", label: "退費", width: "min-w-[100px]", isNegative: true },
  ];

  // 資料讀取邏輯
  useEffect(() => {
    if (!startDate || !endDate) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const collectionName = activeTab === "store" ? "daily_reports" : "therapist_daily_reports";
        const dataMap = new Map(); // 用 Map 去除重複資料

        // 1. 查詢標準格式 (YYYY-MM-DD)
        const q1 = query(
          collection(db, "artifacts", appId, "public", "data", collectionName),
          where("date", ">=", startDate),
          where("date", "<=", endDate),
          orderBy("date", "desc")
        );
        const snap1 = await getDocs(q1);
        snap1.docs.forEach(doc => dataMap.set(doc.id, { id: doc.id, ...doc.data() }));

        // 2. 查詢斜線格式 (YYYY/MM/DD) - 處理舊資料
        const startSlash = startDate.replace(/-/g, "/");
        const endSlash = endDate.replace(/-/g, "/");
        const q2 = query(
          collection(db, "artifacts", appId, "public", "data", collectionName),
          where("date", ">=", startSlash),
          where("date", "<=", endSlash),
          orderBy("date", "desc")
        );
        const snap2 = await getDocs(q2);
        snap2.docs.forEach(doc => dataMap.set(doc.id, { id: doc.id, ...doc.data() }));

        // 轉回陣列並排序
        const mergedData = Array.from(dataMap.values()).sort((a, b) => b.date.localeCompare(a.date));

        if (activeTab === "store") {
          setStoreRawData(mergedData);
        } else {
          setTherapistRawData(mergedData);
        }

      } catch (e) {
        console.error(e);
        showToast("讀取失敗: " + e.message, "error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [activeTab, startDate, endDate, appId, showToast]);

  const currentRawData = activeTab === "store" ? storeRawData : therapistRawData;

  // 篩選店家 (Loose Matching)
  const filteredData = useMemo(() => {
    return currentRawData.filter((d) => {
      let matchStore = true;
      if (filterStore) {
        const normalize = (s) => String(s || "").replace(/CYJ/ig, "").replace(/店/g, "").replace(/\s/g, "").toLowerCase().trim();
        const cleanFilter = normalize(filterStore);
        const cleanRow = normalize(getStoreName(d));
        matchStore = cleanRow.includes(cleanFilter) || cleanFilter.includes(cleanRow);
      }
      return matchStore;
    });
  }, [currentRawData, filterStore]);

  // --- 編輯功能 ---
  const startEdit = (row) => { 
    setEditId(row.id); 
    setEditForm({ ...row, date: toStandardDateFormat(row.date) }); 
  };
  const cancelEdit = () => { setEditId(null); setEditForm({}); };
  
  const handleEditChange = (field, value) => { 
    setEditForm((prev) => {
      const newState = { ...prev, [field]: value };
      
      // 自動計算連動
      if (activeTab === "therapist" && (field === "newCustomerRevenue" || field === "oldCustomerRevenue" || field === "returnRevenue")) {
        const newRev = Number(newState.newCustomerRevenue || 0);
        const oldRev = Number(newState.oldCustomerRevenue || 0);
        const returnRev = Number(newState.returnRevenue || 0);
        newState.totalRevenue = newRev + oldRev - returnRev;
      }
      
      if (activeTab === "store" && (field === "operationalAccrual" || field === "skincareSales")) {
         const op = Number(newState.operationalAccrual || 0);
         const skin = Number(newState.skincareSales || 0);
         newState.accrual = op + skin;
      }

      return newState;
    }); 
  };
  
  const saveEdit = async () => {
    try {
      const collectionName = activeTab === "store" ? "daily_reports" : "therapist_daily_reports";
      const docRef = doc(db, "artifacts", appId, "public", "data", collectionName, editId);
      
      let cleanData = {};
      if (activeTab === "store") {
        cleanData = { 
          ...editForm, 
          cash: Number(editForm.cash || 0), 
          accrual: Number(editForm.accrual || 0), 
          operationalAccrual: Number(editForm.operationalAccrual || 0),
          skincareSales: Number(editForm.skincareSales || 0),
          traffic: Number(editForm.traffic || 0), 
          newCustomers: Number(editForm.newCustomers || 0),
          newCustomerClosings: Number(editForm.newCustomerClosings || 0),
          newCustomerSales: Number(editForm.newCustomerSales || 0),
          refund: Number(editForm.refund || 0),
          skincareRefund: Number(editForm.skincareRefund || 0),
        };
      } else {
        cleanData = { 
          ...editForm, 
          totalRevenue: Number(editForm.totalRevenue || 0),
          newCustomerRevenue: Number(editForm.newCustomerRevenue || 0),
          newCustomerCount: Number(editForm.newCustomerCount || 0),
          newCustomerClosings: Number(editForm.newCustomerClosings || 0),
          oldCustomerRevenue: Number(editForm.oldCustomerRevenue || 0),
          oldCustomerCount: Number(editForm.oldCustomerCount || 0),
          returnRevenue: Number(editForm.returnRevenue || 0),
        };
      }

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
      await deleteDoc(doc(db, "artifacts", appId, "public", "data", collectionName, id));
      showToast("已刪除", "success");
      
      const updateState = activeTab === "store" ? setStoreRawData : setTherapistRawData;
      updateState(prev => prev.filter(p => p.id !== id)); 
    } catch (e) { showToast("刪除失敗", "error"); }
  };

  return (
    <ViewWrapper>
      <div className="grid grid-cols-1 gap-6 w-full pb-20">
        
        {/* 標題與分頁 */}
        <div className="flex items-center gap-3">
           <h2 className="text-2xl font-bold text-stone-800">數據修正中心</h2>
           <span className="text-stone-400">|</span>
           
           {/* ★ 修改 3: 根據權限渲染按鈕 */}
           <div className="flex bg-stone-200 p-1 rounded-xl">
              {userRole !== 'trainer' && (
                <button 
                  onClick={() => {setActiveTab("store"); setFilterStore("");}} 
                  className={`px-4 py-2 rounded-lg text-sm font-bold flex gap-2 transition-all ${activeTab === 'store' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                >
                  <Store size={16}/> 店務日報
                </button>
              )}
              <button 
                onClick={() => {setActiveTab("therapist"); setFilterStore("");}} 
                className={`px-4 py-2 rounded-lg text-sm font-bold flex gap-2 transition-all ${activeTab === 'therapist' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
              >
                <User size={16}/> 管理師日報
              </button>
           </div>
        </div>

        <Card>
          <div className="space-y-4 w-full">
            {/* 篩選器 - UI 優化版 */}
            <div className="flex flex-wrap gap-4 bg-stone-50 p-4 rounded-xl items-end border border-stone-100">
              
              {/* 日期區間選擇 */}
              <div className="w-full lg:w-auto flex-grow min-w-[340px]">
                <label className="block text-xs font-bold text-stone-400 mb-1 flex items-center gap-1">
                  <Calendar size={12}/> 篩選日期區間
                </label>
                <div className="flex items-center gap-2">
                  <input 
                    type="date" 
                    value={startDate} 
                    onChange={(e) => setStartDate(e.target.value)} 
                    className="flex-1 min-w-[140px] px-4 py-2 rounded-xl font-bold bg-white border border-stone-200 outline-none focus:border-amber-400"
                  />
                  <span className="shrink-0 text-stone-400 font-bold px-2">至</span>
                  <input 
                    type="date" 
                    value={endDate} 
                    onChange={(e) => setEndDate(e.target.value)} 
                    className="flex-1 min-w-[140px] px-4 py-2 rounded-xl font-bold bg-white border border-stone-200 outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              {/* 店家篩選 */}
              <div className="w-full sm:w-auto flex-grow min-w-[200px]">
                <label className="block text-xs font-bold text-stone-400 mb-1">篩選店家</label>
                <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)} className="w-full px-4 py-2 rounded-xl font-bold bg-white border border-stone-200 outline-none focus:border-amber-400">
                  <option value="">全部店家</option>
                  {allStores.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              
              <button onClick={() => { setStartDate(getToday()); setEndDate(getToday()); setFilterStore(""); }} className="px-4 py-2 bg-white border border-stone-200 text-stone-600 rounded-xl font-bold flex gap-2 hover:bg-stone-50 transition-colors shadow-sm shrink-0">
                <RotateCcw size={16} /> 重置
              </button>
            </div>

            {/* 資料表格 */}
            <div className="w-full border border-stone-200 rounded-xl bg-white shadow-sm flex flex-col">
              <div className="overflow-x-auto w-full rounded-xl"> 
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-stone-100 text-stone-500 font-bold uppercase text-xs">
                    <tr>
                      <th className="p-4 md:sticky md:left-0 bg-stone-100 md:z-20 border-r border-stone-200 min-w-[140px]">
                        日期 / 店名
                      </th>
                      
                      {activeTab === "store" ? ( 
                        STORE_FIELDS.map(f => (
                          <th key={f.key} className={`p-4 text-right ${f.isNegative ? "text-rose-500" : ""} ${f.width}`}>
                            {f.label}
                          </th>
                        ))
                      ) : ( 
                        <> 
                          <th className="p-4 min-w-[100px]">姓名</th>
                          {THERAPIST_FIELDS.map(f => (
                            <th key={f.key} className={`p-4 text-right ${f.isNegative ? "text-rose-500" : f.isHighlight ? "text-indigo-600" : ""} ${f.width}`}>
                              {f.label}
                            </th>
                          ))}
                        </> 
                      )}
                      
                      <th className="p-4 text-center bg-stone-100 md:sticky md:right-0 md:z-20 border-l border-stone-200 min-w-[100px] shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.05)]">
                        動作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {isLoading && <tr><td colSpan={20} className="p-10 text-center"><Loader2 className="animate-spin inline mr-2"/>資料讀取中...</td></tr>}
                    
                    {!isLoading && (!startDate || !endDate) && (
                      <tr>
                        <td colSpan={20} className="p-12 text-center text-stone-400">
                          <div className="flex flex-col items-center gap-2">
                            <Search size={24} className="opacity-50"/>
                            <p className="font-bold">請選擇日期區間以載入資料</p>
                          </div>
                        </td>
                      </tr>
                    )}

                    {!isLoading && filteredData.map((row) => {
                      const isEditing = editId === row.id;
                      const displayStore = getStoreName(row).replace("CYJ", "").replace("店", "");
                      
                      return (
                        <tr key={row.id} className="group hover:bg-stone-50 transition-colors">
                          <td className="p-4 md:sticky md:left-0 bg-white group-hover:bg-stone-50 md:z-10 border-r border-stone-100">
                            <div className="flex flex-col">
                              {isEditing ? <input type="date" value={editForm.date} onChange={(e)=>handleEditChange('date',e.target.value)} className="border rounded px-2 py-1 mb-1 text-xs"/> : <span className="font-mono font-bold text-stone-600">{row.date}</span>}
                              <span className="font-bold text-stone-800">{displayStore || <span className="text-stone-300 text-xs">未註記</span>}</span>
                            </div>
                          </td>
                          
                          {activeTab === "store" ? ( 
                            STORE_FIELDS.map(f => (
                              <td key={f.key} className="p-4 text-right">
                                {isEditing ? (
                                  <input 
                                    type="number" 
                                    value={editForm[f.key]} 
                                    onChange={(e)=>handleEditChange(f.key,e.target.value)} 
                                    readOnly={f.key === 'accrual'} 
                                    className={`border rounded w-20 text-right px-1 outline-none focus:border-amber-400 ${f.isNegative ? "text-rose-500" : ""} ${f.key === 'accrual' ? 'bg-stone-100 text-stone-500' : ''}`}
                                  />
                                ) : (
                                  <span className={f.isNegative ? "text-rose-500 font-bold" : ""}>{fmt(row[f.key])}</span>
                                )}
                              </td>
                            ))
                          ) : ( 
                            <> 
                              <td className="p-4 font-bold">{row.therapistName}</td>
                              {THERAPIST_FIELDS.map(f => (
                                <td key={f.key} className="p-4 text-right">
                                  {isEditing ? (
                                    <input 
                                      type="number" 
                                      value={editForm[f.key]} 
                                      onChange={(e)=>handleEditChange(f.key,e.target.value)} 
                                      readOnly={f.readOnly} 
                                      className={`border rounded w-20 text-right px-1 outline-none focus:border-indigo-400 ${f.isNegative ? "text-rose-500" : f.isHighlight ? "font-bold text-indigo-600" : ""} ${f.readOnly ? "bg-stone-100 text-stone-500 cursor-not-allowed" : ""}`}
                                    />
                                  ) : (
                                    <span className={f.isNegative ? "text-rose-500 font-bold" : f.isHighlight ? "text-indigo-600 font-bold" : ""}>{fmt(row[f.key])}</span>
                                  )}
                                </td>
                              ))}
                            </> 
                          )}
                          
                          <td className="p-4 text-center md:sticky md:right-0 bg-white group-hover:bg-stone-50 md:z-10 border-l border-stone-100 shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.05)]">
                            {isEditing ? (
                              <div className="flex gap-2 justify-center">
                                <button onClick={saveEdit} className="p-1.5 bg-emerald-100 text-emerald-600 rounded hover:bg-emerald-200"><Save size={16}/></button>
                                <button onClick={cancelEdit} className="p-1.5 bg-stone-100 text-stone-500 rounded hover:bg-stone-200"><X size={16}/></button>
                              </div>
                            ) : (
                              <div className="flex gap-2 justify-center">
                                <button onClick={()=>startEdit(row)} className="p-1.5 hover:bg-amber-50 text-amber-500 rounded transition-colors"><Edit2 size={16}/></button>
                                <button onClick={()=>handleDelete(row.id)} className="p-1.5 hover:bg-rose-50 text-rose-500 rounded transition-colors"><Trash2 size={16}/></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    
                    {!isLoading && filteredData.length === 0 && (
                      <tr>
                        <td colSpan={20} className="p-10 text-center text-stone-400">
                          該日期區間無相關資料
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden py-2 text-center text-stone-400 text-xs flex justify-center items-center gap-1 bg-stone-50 rounded-b-xl border-t border-stone-100">
                <ArrowLeft size={12}/> 左右滑動以查看更多 <ArrowRight size={12}/>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </ViewWrapper>
  );
};

export default HistoryView;