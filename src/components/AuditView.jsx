import React, { useState, useMemo, useContext } from "react";
import { AlertCircle } from "lucide-react";

import { AppContext } from "../AppContext";
import { formatLocalYYYYMMDD, toStandardDateFormat } from "../utils/helpers";
import { ViewWrapper, Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";

const AuditView = () => {
  const {
    analytics,
    managers,      
    showToast,
    budgets,
    selectedYear,
    selectedMonth,
    rawData,       
  } = useContext(AppContext);

  const [checkDate, setCheckDate] = useState(formatLocalYYYYMMDD(new Date()));
  const [auditType, setAuditType] = useState("daily");

  // 1. 標準化檢查清單 (保持上一版的正確邏輯)
  const activeStoresForCalendar = useMemo(() => {
    const allMyStores = Object.values(managers).flat();
    return allMyStores.map(storeName => ({
      id: storeName,
      name: `${storeName}店`,
      stores: [storeName] 
    }));
  }, [managers]);

  // ★ 2. 雙重標準化資料副本 (修正日期問題)
  const normalizedRawData = useMemo(() => {
    return rawData.map(report => ({
      ...report,
      // 清洗店名：強制轉為簡稱
      storeName: report.storeName ? report.storeName.replace(/CYJ|店/g, "") : "",
      // ★ 新增：清洗日期
      // 確保無論資料庫存 "2025/12/01" 還是 "2025-12-1"，通通轉成 "2025-12-01"
      // 這樣日曆元件一定能比對成功！
      date: toStandardDateFormat(report.date) 
    }));
  }, [rawData]);

  // --- 下方列表邏輯 (保持不變) ---
  const auditData = useMemo(() => {
    if (!checkDate) return { submitted: [], missing: [], missingByManager: {} };
    const targetDate = toStandardDateFormat(checkDate);
    
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

  // --- 目標檢核邏輯 ---
  const targetAuditData = useMemo(() => {
    const missingByManager = {};
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    Object.entries(managers).forEach(([manager, stores]) => {
      const missing = [];
      stores.forEach((s) => {
        const name = `CYJ${s}店`;
        const b = budgets[`${name}_${y}_${m}`];
        if (!b || (!b.cashTarget && !b.accrualTarget)) missing.push(name);
      });
      if (missing.length) missingByManager[manager] = missing;
    });
    return {
      missing: Object.values(missingByManager).flat(),
      missingByManager,
    };
  }, [budgets, managers, selectedYear, selectedMonth]);

  const activeData = auditType === "daily" ? auditData : targetAuditData;

  const handleCopy = () => {
    let text =
      auditType === "daily"
        ? `未回報(${checkDate})：\n`
        : `未設定目標(${selectedMonth}月)：\n`;
    Object.entries(activeData.missingByManager).forEach(([mgr, stores]) => {
      text += `${mgr}區：${stores
        .map((s) => s.replace("CYJ", "").replace("店", ""))
        .join("、")}\n`;
    });
    navigator.clipboard.writeText(text);
    showToast("已複製", "success");
  };

  return (
    <ViewWrapper>
      <Card title="回報檢核中心">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
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
          </div>

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
        
        <div className="border border-rose-100 rounded-3xl overflow-hidden shadow-sm mb-8">
          <div className="bg-rose-50 px-6 py-4 flex justify-between items-center">
            <h4 className="font-bold text-rose-600 flex items-center gap-2">
              <AlertCircle size={20} /> 未完成名單 ({activeData.missing.length})
            </h4>
            <button
              onClick={handleCopy}
              className="text-xs bg-white text-rose-500 px-4 py-2 rounded-xl border border-rose-200 font-bold"
            >
              複製名單
            </button>
          </div>
          <div className="p-6 bg-white grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(activeData.missingByManager).map(
              ([mgr, stores]) => (
                <div key={mgr} className="bg-stone-50 p-4 rounded-2xl border">
                  <div className="font-bold text-stone-600 mb-2">{mgr} 區</div>
                  <div className="flex flex-wrap gap-2">
                    {stores.map((s) => (
                      <span
                        key={s}
                        className="bg-white px-2 py-1 rounded-lg text-xs border"
                      >
                        {s.replace("CYJ", "").replace("店", "")}
                      </span>
                    ))}
                  </div>
                </div>
              )
            )}
            {activeData.missing.length === 0 && (
              <div className="col-span-3 text-center text-emerald-500 font-bold py-10">
                全數完成！
              </div>
            )}
          </div>
        </div>
      </Card>
    </ViewWrapper>
  );
};

export default AuditView;