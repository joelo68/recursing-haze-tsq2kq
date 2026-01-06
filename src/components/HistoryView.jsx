// src/components/HistoryView.jsx
import React, { useState, useContext, useMemo } from "react";
import { Edit2, Trash2, Save, X, ChevronDown, RotateCcw } from "lucide-react";
import {
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

import { db, appId } from "../config/firebase";
import { ViewWrapper, Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";
import { AppContext } from "../AppContext";
import { toStandardDateFormat } from "../utils/helpers";

const HistoryView = () => {
  const { rawData, showToast, managers } = useContext(AppContext);
  const [filterDate, setFilterDate] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const fmt = (val) => (typeof val === "number" ? val.toLocaleString() : val);
  
  const allStores = useMemo(
    () =>
      Object.values(managers)
        .flat()
        .map((s) => `CYJ${s}店`)
        .sort(),
    [managers]
  );

  const filteredData = useMemo(() => {
    return rawData.filter((d) => {
      const rowDate = toStandardDateFormat(d.date);
      const targetDate = filterDate ? toStandardDateFormat(filterDate) : null;
      const matchDate = targetDate ? rowDate === targetDate : true;
      const matchStore = filterStore ? d.storeName === filterStore : true;
      return matchDate && matchStore;
    });
  }, [rawData, filterDate, filterStore]);

  const startEdit = (report) => {
    setEditId(report.id);
    // 編輯開始時，確保日期格式標準化，方便 input type="date" 使用
    setEditForm({ 
      ...report,
      date: toStandardDateFormat(report.date) // 確保轉換為 YYYY-MM-DD
    });
  };
  
  const cancelEdit = () => {
    setEditId(null);
    setEditForm({});
  };
  
  const handleEditChange = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveEdit = async () => {
    try {
      const docRef = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "daily_reports",
        editId
      );
      const cleanData = {
        ...editForm,
        // 確保日期被儲存
        date: editForm.date, 
        cash: Number(editForm.cash),
        accrual: Number(editForm.accrual),
        operationalAccrual: Number(editForm.operationalAccrual),
        skincareSales: Number(editForm.skincareSales),
        skincareRefund: Number(editForm.skincareRefund),
        traffic: Number(editForm.traffic),
        newCustomers: Number(editForm.newCustomers),
        newCustomerClosings: Number(editForm.newCustomerClosings),
        newCustomerSales: Number(editForm.newCustomerSales),
        refund: Number(editForm.refund),
      };
      await updateDoc(docRef, cleanData);
      showToast("資料更新成功", "success");
      setEditId(null);
    } catch (e) {
      console.error(e);
      showToast("更新失敗", "error");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("確定刪除此筆資料?")) return;
    try {
      await deleteDoc(
        doc(db, "artifacts", appId, "public", "data", "daily_reports", id)
      );
      showToast("資料已刪除", "success");
    } catch (e) {
      showToast("刪除失敗", "error");
    }
  };

  return (
    <ViewWrapper>
      <Card title="數據修正中心" subtitle="查詢並修正歷史日報數據">
        <div className="grid grid-cols-1 gap-6 w-full">
          
          {/* 篩選器區域 */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 bg-stone-50 p-4 rounded-2xl border border-stone-100 items-end w-full">
            <div className="w-full min-w-0">
              <label className="block text-xs font-bold text-stone-400 mb-1">
                篩選日期
              </label>
              <div className="w-full">
                <SmartDatePicker 
                    selectedDate={filterDate}
                    onDateSelect={setFilterDate}
                    stores={[]}
                    salesData={[]}
                />
              </div>
            </div>

            <div className="w-full min-w-0">
              <label className="block text-xs font-bold text-stone-400 mb-1">
                篩選店家
              </label>
              <div className="relative w-full">
                <select
                  value={filterStore}
                  onChange={(e) => setFilterStore(e.target.value)}
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl text-stone-700 font-bold focus:ring-2 focus:ring-amber-200 outline-none appearance-none bg-white truncate pr-8"
                >
                  <option value="">全部店家</option>
                  {allStores.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="absolute right-3 top-3 text-stone-400 pointer-events-none"
                />
              </div>
            </div>

            <button
              onClick={() => {
                setFilterDate("");
                setFilterStore("");
              }}
              className="px-4 py-2 bg-white border border-stone-200 text-stone-600 rounded-xl font-bold hover:bg-stone-100 hover:text-stone-800 transition-colors shadow-sm flex items-center justify-center gap-2 h-[42px] whitespace-nowrap"
            >
              <RotateCcw size={16} /> <span className="hidden sm:inline">重置</span>
            </button>
          </div>

          <div className="w-full overflow-x-auto border border-stone-200 rounded-xl bg-white shadow-sm">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-stone-100 text-stone-500 font-bold uppercase text-xs">
                <tr>
                  <th className="p-4">日期</th>
                  <th className="p-4">店名</th>
                  <th className="p-4 text-right">現金</th>
                  <th className="p-4 text-right">退費</th>
                  <th className="p-4 text-right">總權責</th>
                  <th className="p-4 text-right">操作權責</th>
                  <th className="p-4 text-right">保養品</th>
                  <th className="p-4 text-right">保養退費</th>
                  <th className="p-4 text-right">操作人數</th>
                  <th className="p-4 text-right">新客</th>
                  <th className="p-4 text-right">留單</th>
                  <th className="p-4 text-center bg-stone-100 sticky right-0 shadow-l">動作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredData.slice(0, 50).map((row) => {
                  const isEditing = editId === row.id;
                  return (
                    <tr key={row.id} className="group hover:bg-stone-50 transition-colors">
                      {/* === 修改點：日期欄位加入 max 屬性 === */}
                      <td className="p-4 font-mono font-bold text-stone-600">
                        {isEditing ? (
                          <input
                            type="date"
                            // ★ 設定最大日期為今天，防堵未來日期
                            max={new Date().toLocaleDateString("en-CA")}
                            value={editForm.date}
                            onChange={(e) => handleEditChange("date", e.target.value)}
                            className="w-32 px-2 py-1 border border-amber-300 rounded outline-none focus:ring-2 focus:ring-amber-200 bg-white shadow-sm font-mono text-sm"
                          />
                        ) : (
                          toStandardDateFormat(row.date)
                        )}
                      </td>

                      {/* 店名欄位 (維持不可編輯) */}
                      <td className="p-4 font-bold text-stone-700">
                        {row.storeName.replace("CYJ", "").replace("店", "")}
                      </td>

                      {/* 數值欄位 (維持原有邏輯) */}
                      {[
                        "cash",
                        "refund",
                        "accrual",
                        "operationalAccrual",
                        "skincareSales",
                        "skincareRefund",
                        "traffic",
                        "newCustomers",
                        "newCustomerClosings",
                      ].map((field) => (
                        <td key={field} className="p-4 text-right font-mono">
                          {isEditing ? (
                            <input
                              type="number"
                              value={editForm[field]}
                              onChange={(e) =>
                                handleEditChange(field, e.target.value)
                              }
                              className="w-20 px-2 py-1 border border-amber-300 rounded text-right outline-none focus:ring-2 focus:ring-amber-200 bg-white shadow-sm"
                            />
                          ) : (
                            <span
                              className={
                                field === "refund" || field === "skincareRefund"
                                  ? "text-rose-500 font-bold"
                                  : field === "accrual"
                                  ? "text-stone-400"
                                  : "text-stone-700"
                              }
                            >
                              {fmt(row[field])}
                            </span>
                          )}
                        </td>
                      ))}
                      
                      {/* 動作按鈕 (維持原有邏輯) */}
                      <td className="p-4 text-center sticky right-0 bg-white group-hover:bg-stone-50">
                        {isEditing ? (
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={saveEdit}
                              className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-200 shadow-sm"
                            >
                              <Save size={16} />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1.5 bg-stone-100 text-stone-500 rounded-lg hover:bg-stone-200 shadow-sm"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => startEdit(row)}
                              className="p-1.5 hover:bg-amber-50 text-amber-500 rounded-lg transition-colors"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(row.id)}
                              className="p-1.5 hover:bg-rose-50 text-rose-500 rounded-lg transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredData.length === 0 && (
                  <tr>
                    <td colSpan="12" className="p-10 text-center text-stone-400 bg-stone-50/30">
                      <div className="flex flex-col items-center gap-2">
                         <span className="text-2xl">🔍</span>
                         <p>沒有符合條件的資料</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          <p className="text-xs text-stone-400 text-center">
            * 僅顯示最近 50 筆符合條件的紀錄，請使用上方篩選器縮小範圍
          </p>
        </div>
      </Card>
    </ViewWrapper>
  );
};

export default HistoryView;