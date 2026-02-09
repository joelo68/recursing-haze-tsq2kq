// src/components/AuditView.jsx
import React, { useState, useMemo, useContext } from "react";
import { AlertCircle, UserX, CheckCircle, Target, FileText, Settings, X, Save, Ban } from "lucide-react"; 

import { AppContext } from "../AppContext";
import { formatLocalYYYYMMDD, toStandardDateFormat } from "../utils/helpers";
import { ViewWrapper, Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";

const AuditView = () => {
  const {
    managers,      
    showToast,
    budgets,        
    selectedYear,
    selectedMonth,
    rawData,        
    therapists,
    therapistReports,
    therapistSchedules,
    userRole,
    therapistTargets,
    auditExclusions,
    handleUpdateAuditExclusions
  } = useContext(AppContext);

  const [checkDate, setCheckDate] = useState(formatLocalYYYYMMDD(new Date()));
  const [auditType, setAuditType] = useState(userRole === 'trainer' ? "therapist-daily" : "daily"); 

  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [localExclusions, setLocalExclusions] = useState([]);

  const openConfigModal = () => {
    setLocalExclusions(auditExclusions || []);
    setIsConfigModalOpen(true);
  };

  const saveConfig = async () => {
    await handleUpdateAuditExclusions(localExclusions);
    setIsConfigModalOpen(false);
    showToast("排除名單已更新", "success");
  };

  const toggleExclusion = (store) => {
    setLocalExclusions(prev => {
      if (prev.includes(store)) return prev.filter(s => s !== store);
      return [...prev, store];
    });
  };

  // --- 資料源準備 (給 SmartDatePicker 用) ---

  const activeStoresForCalendar = useMemo(() => {
    const allMyStores = Object.values(managers).flat();
    return allMyStores
      .filter(storeName => !auditExclusions.includes(storeName)) // 日曆排除免檢核店家
      .map(storeName => ({
        id: storeName,
        name: `${storeName}店`,
        stores: [storeName] 
      }));
  }, [managers, auditExclusions]);

  const activeTherapistsForCalendar = useMemo(() => {
    return therapists
      .filter(t => t.status === 'active')
      .map(t => ({
        id: t.id,
        name: t.name,     
        // 使用 ID 作為檢核鍵值，確保準確度
        stores: [t.id] 
      }));
  }, [therapists]);

  const normalizedRawData = useMemo(() => {
    return rawData.map(report => ({
      ...report,
      storeName: report.storeName ? report.storeName.replace(/CYJ|店/g, "") : "",
      date: toStandardDateFormat(report.date) 
    }));
  }, [rawData]);

  // ★★★ 修正核心：整合排班表，解決紅燈問題 ★★★
  const normalizedTherapistReports = useMemo(() => {
    // 1. 真實回報資料 (改用 ID 對應)
    const realReports = therapistReports.map(report => ({
      ...report,
      storeName: report.therapistId, 
      date: toStandardDateFormat(report.date)
    }));

    // 如果不是管理師日報模式，直接回傳
    if (auditType !== 'therapist-daily') return realReports;

    // 2. 自動產生「休假幽靈回報」
    // 原理：日曆元件只認「有無資料」，不知道排休。
    // 我們主動幫排休的人補上一筆 "isGhost" 資料，讓日曆認為該員「已完成 (休假)」，
    // 這樣當天上班的人全交時，就會顯示綠燈。
    const ghostReports = [];
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    // 取得當月天數
    const daysInMonth = new Date(y, m, 0).getDate();

    // 遍歷所有在職管理師
    therapists.filter(t => t.status === 'active').forEach(t => {
      // 取得該員當月排班表
      const scheduleKey = `${t.id}_${y}_${m}`;
      const schedule = therapistSchedules[scheduleKey];
      const daysOff = schedule?.daysOff || []; // 例如 [1, 5, 6]

      // 針對每一個休假日，建立假資料
      daysOff.forEach(day => {
        const dateStr = `${y}/${m.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
        
        ghostReports.push({
          id: `ghost_${t.id}_${dateStr}`, // 唯一 ID
          storeName: t.id,                // 對應管理師 ID
          date: dateStr,
          isGhost: true,                  // 標記為幽靈資料
          revenue: 0                      // 避免影響數值計算 (如果有顯示的話)
        });
      });
    });

    // 合併 真實回報 + 休假回報
    return [...realReports, ...ghostReports];

  }, [therapistReports, auditType, selectedYear, selectedMonth, therapists, therapistSchedules]);

  const isTherapistMode = auditType === 'therapist-daily';
  const calendarStores = isTherapistMode ? activeTherapistsForCalendar : activeStoresForCalendar;
  const calendarSalesData = isTherapistMode ? normalizedTherapistReports : normalizedRawData;


  // --- 下方列表檢核邏輯 ---

  // 1. 店家日報檢核
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
        if (auditExclusions.includes(s)) return; // 排除免檢核店家

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
  }, [checkDate, rawData, managers, auditExclusions]);

  // 2. 店家目標檢核
  const targetAuditData = useMemo(() => {
    const missingByManager = {};
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    
    Object.entries(managers).forEach(([manager, stores]) => {
      const missing = [];
      stores.forEach((s) => {
        if (auditExclusions.includes(s)) return;

        const name = `CYJ${s}店`;
        const key = `${name}_${y}_${m}`;
        const b = budgets[key];
        if (!b || (!b.cashTarget && !b.accrualTarget)) missing.push(name);
      });
      if (missing.length) missingByManager[manager] = missing;
    });
    return {
      missing: Object.values(missingByManager).flat(),
      missingByManager,
    };
  }, [budgets, managers, selectedYear, selectedMonth, auditExclusions]);

  // 3. 管理師日報檢核 (這裡本來就有排休邏輯，保持不變)
  const therapistAuditData = useMemo(() => {
    if (!checkDate) return { missing: [], missingByManager: {} };
    
    const targetDate = new Date(checkDate);
    const targetDateStr = toStandardDateFormat(checkDate);
    const year = targetDate.getFullYear().toString();
    const month = targetDate.getMonth() + 1;
    const day = targetDate.getDate();

    const submittedIds = new Set(
      (therapistReports || [])
        .filter(r => toStandardDateFormat(r.date) === targetDateStr)
        .map(r => r.therapistId)
    );

    const missingByManager = {};
    
    (therapists || []).filter(t => t.status === 'active').forEach(t => {
      const scheduleKey = `${t.id}_${year}_${month}`;
      const schedule = therapistSchedules[scheduleKey];
      const isOff = schedule?.daysOff?.includes(day);

      if (isOff) return; // 休假者不列入未回報

      if (!submittedIds.has(t.id)) {
        const mgr = t.manager || "未分區";
        if (!missingByManager[mgr]) missingByManager[mgr] = [];
        missingByManager[mgr].push(`${t.name} (${t.store}店)`);
      }
    });

    return { 
        missing: Object.values(missingByManager).flat(), 
        missingByManager 
    };
  }, [checkDate, therapists, therapistReports, therapistSchedules]);

  // 4. 管理師目標檢核
  const therapistTargetAuditData = useMemo(() => {
    const missingByManager = {};
    const year = selectedYear;
    const monthKey = parseInt(selectedMonth).toString(); 

    (therapists || []).filter(t => t.status === 'active').forEach(t => {
       const docId = `${t.id}_${year}`;
       const data = therapistTargets[docId];
       const targetVal = data?.monthlyTargets?.[monthKey];
       const hasTarget = targetVal && parseInt(targetVal) > 0;

       if (!hasTarget) {
         const mgr = t.manager || "未分區";
         if (!missingByManager[mgr]) missingByManager[mgr] = [];
         missingByManager[mgr].push(`${t.name} (${t.store}店)`);
       }
    });

    return { 
        missing: Object.values(missingByManager).flat(), 
        missingByManager 
    };
  }, [therapists, therapistTargets, selectedYear, selectedMonth]);


  const activeData = 
    auditType === "daily" ? auditData : 
    auditType === "target" ? targetAuditData : 
    auditType === "therapist-daily" ? therapistAuditData :
    therapistTargetAuditData; 

  const handleCopy = () => {
    let text = "";
    if (auditType === 'target') text = `店家未設定目標(${selectedYear}/${selectedMonth})：\n`;
    else if (auditType === 'therapist-target') text = `管理師未設目標(${selectedYear}/${selectedMonth})：\n`;
    else if (auditType === 'therapist-daily') text = `管理師未回報(${checkDate})：\n`;
    else text = `店家未回報(${checkDate})：\n`;

    Object.entries(activeData.missingByManager).forEach(([mgr, list]) => {
      const cleanList = list.map(s => (auditType.includes('therapist')) ? s : s.replace("CYJ", "").replace("店", ""));
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
            <div className="bg-stone-100 p-1 rounded-xl flex shrink-0 self-start overflow-x-auto max-w-full">
              
              {userRole !== 'trainer' && (
                <>
                  <button
                    onClick={() => setAuditType("daily")}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                      auditType === "daily" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400 hover:text-stone-600"
                    }`}
                  >
                    店家日報
                  </button>
                  <button
                    onClick={() => setAuditType("target")}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                      auditType === "target" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400 hover:text-stone-600"
                    }`}
                  >
                    店家目標
                  </button>
                </>
              )}

              <button
                onClick={() => setAuditType("therapist-daily")}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                  auditType === "therapist-daily" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400 hover:text-stone-600"
                }`}
              >
                管理師日報
              </button>
              <button
                onClick={() => setAuditType("therapist-target")}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                  auditType === "therapist-target" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400 hover:text-stone-600"
                }`}
              >
                管理師目標
              </button>
            </div>

            <div className="flex gap-2 items-center w-full sm:w-auto">
                {(auditType === "daily" || auditType === "therapist-daily") ? (
                   <div className="w-full sm:w-auto relative z-10">
                      <SmartDatePicker 
                        selectedDate={checkDate}
                        onDateSelect={setCheckDate}
                        stores={calendarStores}       
                        salesData={calendarSalesData} 
                      />
                   </div>
                ) : (
                   <div className="px-4 py-2 bg-indigo-50 text-indigo-600 font-bold rounded-xl text-sm border border-indigo-100 flex items-center gap-2 self-start flex-grow">
                      <Target size={16}/> 檢核月份：{selectedYear} 年 {selectedMonth} 月
                   </div>
                )}

                {/* 只有在店家相關檢核 (daily 或 target) 且有權限時才顯示設定按鈕 */}
                {(userRole === 'director' || userRole === 'manager') && (auditType === 'daily' || auditType === 'target') && (
                  <button onClick={openConfigModal} className="p-2 bg-stone-100 text-stone-500 rounded-xl hover:bg-stone-200" title="設定排除店家">
                    <Settings size={20}/>
                  </button>
                )}
            </div>
          </div>

          {(auditType === "daily" || auditType === "therapist-daily") && (
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
              {auditType === 'therapist-daily' ? "未回報人員 (已排除休假)" : 
               auditType === 'therapist-target' ? "未設定目標人員" :
               "未完成名單"} 
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
                        {auditType.includes('therapist') && <UserX size={10} className="text-rose-400"/>}
                        {auditType.includes('therapist') ? s : s.replace("CYJ", "").replace("店", "")}
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
                   {auditType === 'therapist-daily' && <span className="text-xs text-stone-400 font-normal">休假人員已自動排除</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-stone-800 text-white p-4 font-bold text-lg flex justify-between items-center shrink-0">
              <span className="flex items-center gap-2"><Ban size={20} className="text-rose-400"/> 設定免檢核店家</span>
              <button onClick={() => setIsConfigModalOpen(false)} className="hover:bg-white/10 p-1 rounded-lg transition-colors"><X size={20}/></button>
            </div>
            <div className="p-4 bg-stone-50 border-b border-stone-200 shrink-0 text-sm text-stone-500">
              <p>勾選的店家將 <span className="font-bold text-rose-500">不會</span> 出現在未回報名單與目標檢核中。</p>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              {Object.entries(managers).map(([mgr, stores]) => (
                <div key={mgr}>
                  <h4 className="font-bold text-stone-400 text-xs uppercase mb-2 ml-1">{mgr} 區</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {stores.map(store => {
                      const isExcluded = localExclusions.includes(store);
                      return (
                        <button
                          key={store}
                          onClick={() => toggleExclusion(store)}
                          className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 ${
                            isExcluded 
                              ? "bg-rose-50 border-rose-500 text-rose-600 shadow-sm" 
                              : "bg-white border-stone-200 text-stone-500 hover:border-stone-400"
                          }`}
                        >
                          {isExcluded && <CheckCircle size={14}/>}
                          {store}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-stone-100 bg-white shrink-0 flex justify-end gap-3">
              <button onClick={() => setIsConfigModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-stone-500 hover:bg-stone-50">取消</button>
              <button onClick={saveConfig} className="px-6 py-2.5 rounded-xl font-bold bg-stone-800 text-white hover:bg-stone-700 shadow-lg flex items-center gap-2">
                <Save size={18}/> 儲存設定
              </button>
            </div>
          </div>
        </div>
      )}
    </ViewWrapper>
  );
};

export default AuditView;