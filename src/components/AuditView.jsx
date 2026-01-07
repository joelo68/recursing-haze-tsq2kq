import React, { useState, useMemo, useContext } from "react";
import { AlertCircle } from "lucide-react";

import { AppContext } from "../AppContext";
import { formatLocalYYYYMMDD, toStandardDateFormat } from "../utils/helpers";
import { ViewWrapper, Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";

const AuditView = () => {
  const {
    managers,      
    showToast,
    budgets,        // 這是關鍵：我們改用這裡的資料來檢核目標
    selectedYear,
    selectedMonth,
    rawData,        // 日報檢核依然用這裡
  } = useContext(AppContext);

  const [checkDate, setCheckDate] = useState(formatLocalYYYYMMDD(new Date()));
  const [auditType, setAuditType] = useState("daily"); // 'daily' 或 'target'

  // 1. 標準化檢查清單 (給日曆元件用)
  const activeStoresForCalendar = useMemo(() => {
    const allMyStores = Object.values(managers).flat();
    return allMyStores.map(storeName => ({
      id: storeName,
      name: `${storeName}店`,
      stores: [storeName] 
    }));
  }, [managers]);

  // 2. 雙重標準化資料副本 (修正日期格式問題)
  const normalizedRawData = useMemo(() => {
    return rawData.map(report => ({
      ...report,
      storeName: report.storeName ? report.storeName.replace(/CYJ|店/g, "") : "",
      date: toStandardDateFormat(report.date) 
    }));
  }, [rawData]);

  // --- 日報檢核邏輯 ---
  const auditData = useMemo(() => {
    if (!checkDate) return { submitted: [], missing: [], missingByManager: {} };
    const targetDate = toStandardDateFormat(checkDate);
    
    // 檢查 rawData (日報資料庫)
    const submitted = new Set(
      rawData
        .filter((d) => toStandardDateFormat(d.date) === targetDate)
        .map((d) => d.storeName)
    );
    
    const missingByManager = {};
    Object.entries(managers).forEach(([manager, stores]) => {
      const missing = [];
      stores.forEach((s) => {
        const fullName = `CYJ${s}店`;
        // 支援檢查全名或簡稱
        if (!submitted.has(fullName) && !submitted.has(s)) {
             missing.push(fullName);
        }
      });
      if (missing.length) missingByManager[manager] = missing;
    });
    return {
      submitted: Array.from(submitted),
      missing: Object.values(missingByManager).flat(),
      missingByManager,
    };
  }, [checkDate, rawData, managers]);

  // --- 目標檢核邏輯 (對應新的 TargetView) ---
  const targetAuditData = useMemo(() => {
    const missingByManager = {};
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    
    Object.entries(managers).forEach(([manager, stores]) => {
      const missing = [];
      stores.forEach((s) => {
        const name = `CYJ${s}店`;
        // ★★★ 關鍵修正：直接檢查 budgets (目標資料庫) ★★★
        // 這樣就不會受到日報格式改變的影響
        const key = `${name}_${y}_${m}`;
        const b = budgets[key];
        
        // 如果沒設定，或數值都為 0，視為未完成
        if (!b || (!b.cashTarget && !b.accrualTarget)) missing.push(name);
      });
      if (missing.length) missingByManager[manager] = missing;
    });
    return {
      missing: Object.values(missingByManager).flat(),
      missingByManager,
    };
  }, [budgets, managers, selectedYear, selectedMonth]);

  // 決定目前要顯示哪一份數據
  const activeData = auditType === "daily" ? auditData : targetAuditData;

  const handleCopy = () => {
    let text =
      auditType === "daily"
        ? `未回報(${checkDate})：\n`
        : `未設定目標(${selectedYear}/${selectedMonth})：\n`;
    Object.entries(activeData.missingByManager).forEach(([mgr, stores]) => {
      text += `${mgr}區：${stores
        .map((s) => s.replace("CYJ", "").replace("店", ""))
        .join("、")}\n`;
    });
    navigator.clipboard.writeText(text);
    showToast("已複製未完成名單", "success");
  };

  return (
    <ViewWrapper>
      <Card title="回報檢核中心">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            {/* 切換按鈕 */}
            <div className="bg-stone-100 p-1 rounded-xl flex shrink-0 self-start">
              <button
                onClick={() => setAuditType("daily")}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                  auditType === "daily"
                    ? "bg-white text-stone-800 shadow-sm"
                    : "text-stone-400 hover:text-stone-600"
                }`}
              >
                日報檢核
              </button>
              <button
                onClick={() => setAuditType("target")}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                  auditType === "target"
                    ? "bg-white text-stone-800 shadow-sm"
                    : "text-stone-400 hover:text-stone-600"
                }`}
              >
                目標檢核
              </button>
            </div>

            {/* 只有日報檢核需要選日期 (目標檢核看全域年/月) */}
            {auditType === "daily" && (
               <div className="w-full sm:w-auto relative z-10">
                  <SmartDatePicker 
                    selectedDate={checkDate}
                    onDateSelect={setCheckDate}
                    stores={activeStoresForCalendar}  
                    salesData={normalizedRawData}     
                  />
               </div>
            )}
            
            {/* 目標檢核時顯示當前月份提示 */}
            {auditType === "target" && (
               <div className="px-4 py-2 bg-indigo-50 text-indigo-600 font-bold rounded-xl text-sm border border-indigo-100 flex items-center gap-2 self-start">
                  檢核月份：{selectedYear} 年 {selectedMonth} 月
               </div>
            )}
          </div>

          {/* 右上角狀態圖例 */}
          {auditType === "daily" && (
            <div className="flex items-center gap-4 text-sm font-medium text-stone-600 self-start md:self-center pl-1">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm"></span>
                <span className="whitespace-nowrap">全數回報</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm"></span>
                <span className="whitespace-nowrap">回報不完全</span>
              </div>
            </div>
          )}

        </div>
        
        {/* 未完成名單列表 */}
        <div className="border border-rose-100 rounded-3xl overflow-hidden shadow-sm mb-8">
          <div className="bg-rose-50 px-6 py-4 flex justify-between items-center">
            <h4 className="font-bold text-rose-600 flex items-center gap-2">
              <AlertCircle size={20} /> 未完成名單 ({activeData.missing.length})
            </h4>
            <button
              onClick={handleCopy}
              className="text-xs bg-white text-rose-500 px-4 py-2 rounded-xl border border-rose-200 font-bold hover:bg-rose-50 transition-colors"
            >
              複製名單
            </button>
          </div>
          <div className="p-6 bg-white grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(activeData.missingByManager).map(
              ([mgr, stores]) => (
                <div key={mgr} className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                  <div className="font-bold text-stone-600 mb-2">{mgr} 區</div>
                  <div className="flex flex-wrap gap-2">
                    {stores.map((s) => (
                      <span
                        key={s}
                        className="bg-white px-2 py-1 rounded-lg text-xs border border-stone-200 text-stone-600 font-medium"
                      >
                        {s.replace("CYJ", "").replace("店", "")}
                      </span>
                    ))}
                  </div>
                </div>
              )
            )}
            {activeData.missing.length === 0 && (
              <div className="col-span-3 text-center py-10">
                <div className="inline-flex items-center gap-2 text-emerald-500 font-bold text-lg">
                   <span className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">✓</span>
                   全數完成！
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </ViewWrapper>
  );
};

export default AuditView;