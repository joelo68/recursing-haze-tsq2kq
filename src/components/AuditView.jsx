// src/components/AuditView.jsx
import React, { useState, useMemo, useContext } from "react";
import { AlertCircle, UserX, CheckCircle } from "lucide-react"; // 新增 icon

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
    // ★ 新增引用 (用於管理師檢核)
    therapists,
    therapistReports,
    therapistSchedules
  } = useContext(AppContext);

  const [checkDate, setCheckDate] = useState(formatLocalYYYYMMDD(new Date()));
  const [auditType, setAuditType] = useState("daily"); // 'daily' | 'target' | 'therapist'

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

  // --- A. 日報檢核邏輯 (保留您原本的程式碼) ---
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

  // --- B. 目標檢核邏輯 (保留您原本的程式碼) ---
  const targetAuditData = useMemo(() => {
    const missingByManager = {};
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    
    Object.entries(managers).forEach(([manager, stores]) => {
      const missing = [];
      stores.forEach((s) => {
        const name = `CYJ${s}店`;
        // ★★★ 關鍵修正：直接檢查 budgets (目標資料庫) ★★★
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

  // --- C. ★ 新增：管理師日報檢核 (含排休過濾) ---
  const therapistAuditData = useMemo(() => {
    if (!checkDate) return { missing: [], missingByManager: {} };
    
    const targetDate = new Date(checkDate);
    const targetDateStr = toStandardDateFormat(checkDate);
    const year = targetDate.getFullYear().toString();
    const month = targetDate.getMonth() + 1;
    const day = targetDate.getDate();

    // 1. 找出當日已提交的人員 ID
    const submittedIds = new Set(
      (therapistReports || [])
        .filter(r => toStandardDateFormat(r.date) === targetDateStr)
        .map(r => r.therapistId)
    );

    // 2. 準備分區容器
    const missingByManager = {};
    
    // 3. 遍歷所有活躍管理師
    (therapists || []).filter(t => t.status === 'active').forEach(t => {
      // 檢查排休：如果該員在該年該月有排休紀錄，且包含當日 -> 跳過
      const scheduleKey = `${t.id}_${year}_${month}`;
      const schedule = therapistSchedules[scheduleKey];
      const isOff = schedule?.daysOff?.includes(day);

      if (isOff) return; // 休假中，不需回報

      // 沒休假且沒提交 -> 記上一筆
      if (!submittedIds.has(t.id)) {
        const mgr = t.manager || "未分區";
        if (!missingByManager[mgr]) missingByManager[mgr] = [];
        // 顯示 姓名 (店名)
        missingByManager[mgr].push(`${t.name} (${t.store}店)`);
      }
    });

    return { 
        missing: Object.values(missingByManager).flat(), 
        missingByManager 
    };
  }, [checkDate, therapists, therapistReports, therapistSchedules]);

  // 決定目前要顯示哪一份數據
  const activeData = 
    auditType === "daily" ? auditData : 
    auditType === "target" ? targetAuditData : 
    therapistAuditData;

  const handleCopy = () => {
    let text = "";
    if (auditType === 'target') {
        text = `未設定目標(${selectedYear}/${selectedMonth})：\n`;
    } else if (auditType === 'therapist') {
        text = `管理師未回報(${checkDate})：\n`;
    } else {
        text = `未回報(${checkDate})：\n`;
    }

    Object.entries(activeData.missingByManager).forEach(([mgr, list]) => {
      // 針對店家名稱做簡化 (移除 CYJ/店)，針對管理師名單則保持原樣
      const cleanList = list.map(s => auditType === 'therapist' ? s : s.replace("CYJ", "").replace("店", ""));
      text += `${mgr}區：${cleanList.join("、")}\n`;
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
            <div className="bg-stone-100 p-1 rounded-xl flex shrink-0 self-start overflow-x-auto max-w-full">
              <button
                onClick={() => setAuditType("daily")}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                  auditType === "daily"
                    ? "bg-white text-stone-800 shadow-sm"
                    : "text-stone-400 hover:text-stone-600"
                }`}
              >
                店家日報
              </button>
              <button
                onClick={() => setAuditType("target")}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                  auditType === "target"
                    ? "bg-white text-stone-800 shadow-sm"
                    : "text-stone-400 hover:text-stone-600"
                }`}
              >
                店家目標
              </button>
              {/* ★ 新增：管理師檢核按鈕 ★ */}
              <button
                onClick={() => setAuditType("therapist")}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                  auditType === "therapist"
                    ? "bg-white text-stone-800 shadow-sm"
                    : "text-stone-400 hover:text-stone-600"
                }`}
              >
                管理師檢核
              </button>
            </div>

            {/* 日報 & 管理師檢核需要選日期 */}
            {(auditType === "daily" || auditType === "therapist") && (
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
          {auditType !== "target" && (
            <div className="flex items-center gap-4 text-sm font-medium text-stone-600 self-start md:self-center pl-1 hidden md:flex">
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
          <div className="bg-rose-50 px-6 py-4 flex justify-between items-center flex-wrap gap-2">
            <h4 className="font-bold text-rose-600 flex items-center gap-2">
              <AlertCircle size={20} /> 
              {auditType === 'therapist' ? "未回報人員 (已排除休假)" : "未完成名單"} 
              <span className="bg-white px-2 py-0.5 rounded-full text-xs border border-rose-200 shadow-sm">{activeData.missing.length}</span>
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
              ([mgr, list]) => (
                <div key={mgr} className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                  <div className="font-bold text-stone-600 mb-2">{mgr} 區</div>
                  <div className="flex flex-wrap gap-2">
                    {list.map((s, idx) => (
                      <span
                        key={idx}
                        className="bg-white px-2 py-1 rounded-lg text-xs border border-stone-200 text-stone-600 font-medium flex items-center gap-1"
                      >
                        {auditType === 'therapist' && <UserX size={10} className="text-rose-400"/>}
                        {auditType === 'therapist' ? s : s.replace("CYJ", "").replace("店", "")}
                      </span>
                    ))}
                  </div>
                </div>
              )
            )}
            {activeData.missing.length === 0 && (
              <div className="col-span-3 text-center py-10">
                <div className="inline-flex flex-col items-center gap-2 text-emerald-500 font-bold text-lg">
                   <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-2">
                     <CheckCircle size={24}/>
                   </div>
                   全數完成！
                   {auditType === 'therapist' && <span className="text-xs text-stone-400 font-normal">休假人員已自動排除</span>}
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