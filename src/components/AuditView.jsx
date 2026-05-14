// src/components/AuditView.jsx
import React, { useState, useMemo, useContext, useCallback, useEffect } from "react";
import { AlertCircle, UserX, CheckCircle, Target, FileText, Settings, X, Save, Ban, HelpCircle } from "lucide-react"; 

import { AppContext } from "../AppContext";
import { formatLocalYYYYMMDD, toStandardDateFormat } from "../utils/helpers";
import { ViewWrapper, Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";

// ★ 終極翻譯蒟蒻
const safeGetDateStr = (val) => {
    if (!val) return "";
    if (typeof val?.toDate === 'function') {
        const d = val.toDate();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    if (val instanceof Date) {
        return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
    }
    if (typeof val === 'string') {
        const m = val.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
        if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    }
    return String(val);
};

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
    auditExclusions = [], 
    handleUpdateAuditExclusions,
    currentBrand
  } = useContext(AppContext);

  const [checkDate, setCheckDate] = useState(formatLocalYYYYMMDD(new Date()));
  const [auditType, setAuditType] = useState(userRole === 'trainer' ? "therapist-daily" : "daily"); 

  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [localExclusions, setLocalExclusions] = useState([]);

  useEffect(() => {
    if (!checkDate || !selectedYear || !selectedMonth) return;
    const currentObj = new Date(checkDate);
    const currentYearStr = currentObj.getFullYear().toString();
    const currentMonthStr = (currentObj.getMonth() + 1).toString();
    
    if (currentYearStr !== selectedYear || currentMonthStr !== selectedMonth) {
      const newMonth = selectedMonth.padStart(2, '0');
      setCheckDate(`${selectedYear}-${newMonth}-01`);
    }
  }, [selectedYear, selectedMonth]);

  const { minBoundary, maxBoundary } = useMemo(() => {
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    const maxDays = new Date(y, m, 0).getDate(); 
    
    return {
      minBoundary: `${y}-${String(m).padStart(2, '0')}-01`,
      maxBoundary: `${y}-${String(m).padStart(2, '0')}-${maxDays}`
    };
  }, [selectedYear, selectedMonth]);

  const brandPrefix = useMemo(() => {
    let name = "CYJ";
    if (currentBrand) {
      const id = typeof currentBrand === 'string' ? currentBrand : (currentBrand.id || "CYJ");
      const normalizedId = id.toLowerCase();
      if (normalizedId.includes("anniu") || normalizedId.includes("anew")) { name = "安妞"; } 
      else if (normalizedId.includes("yibo")) { name = "伊啵"; } 
    }
    return name;
  }, [currentBrand]);

  const cleanStoreName = useCallback((name) => {
    if (!name) return "";
    let core = String(name).replace(/^(CYJ|Anew\s*\(安妞\)|Yibo\s*\(伊啵\)|安妞|伊啵|Anew|Yibo)\s*/i, '').trim();
    if (core === "新店") return "新店"; 
    return core.replace(/店$/, '').trim();
  }, []);

  // ★ 終極雷達：上帝視角匹配
  const isTherapistMatch = useCallback((str, t) => {
    if (!str || !t) return false;
    const s = String(str).toLowerCase().trim();
    const tid = String(t.id || "").toLowerCase().trim();
    const tname = String(t.name || "").toLowerCase().trim();

    if (!s) return false;
    if (tid && s === tid) return true;
    if (tname && s === tname) return true;
    if (tid.length > 5 && s.includes(tid)) return true;
    if (s.length > 5 && tid.includes(s)) return true;

    const getChi = (x) => (x.match(/[\u4e00-\u9fa5]+/g) || []).join('');
    const sChi = getChi(s);
    const tidChi = getChi(tid);
    const tnameChi = getChi(tname);

    if (sChi.length >= 2) {
        if (tidChi && (sChi.includes(tidChi) || tidChi.includes(sChi))) return true;
        if (tnameChi && (sChi.includes(tnameChi) || tnameChi.includes(sChi))) return true;
    }

    const getEng = (x) => (x.match(/[a-z]+/g) || []).join('');
    const sEng = getEng(s);
    const tidEng = getEng(tid);
    const tnameEng = getEng(tname);

    if (sEng.length >= 3) {
        if (tidEng.length >= 3 && (sEng.includes(tidEng) || tidEng.includes(sEng))) return true;
        if (tnameEng.length >= 3 && (sEng.includes(tnameEng) || tnameEng.includes(sEng))) return true;
    }

    return false;
  }, []);

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
    const cleanS = cleanStoreName(store);
    setLocalExclusions(prev => {
      if (prev.includes(cleanS) || prev.includes(store)) {
          return prev.filter(s => s !== store && s !== cleanS);
      }
      return [...prev, cleanS];
    });
  };

  const activeStoresForCalendar = useMemo(() => {
    const allMyStores = Object.values(managers).flat();
    return allMyStores
      .filter(storeName => !auditExclusions.includes(storeName) && !auditExclusions.includes(cleanStoreName(storeName))) 
      .map(storeName => {
        const aliases = [
          storeName, `${storeName}店`, `${brandPrefix}${storeName}`,       
          `${brandPrefix}${storeName}店`, `CYJ${storeName}店`                 
        ];
        return { id: storeName, name: `${storeName}店`, stores: aliases };
      });
  }, [managers, auditExclusions, brandPrefix, cleanStoreName]);

  const activeTherapistsForCalendar = useMemo(() => {
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0);

    return therapists.filter(t => {
      const obDate = t.onboardDate ? new Date(t.onboardDate) : new Date("2000-01-01");
      if (obDate > monthEnd) return false; 
      
      const isResignedStatus = t.status === 'resigned' || t.isActive === false || t.isResigned === true;
      if (t.resignDate) {
          const rDate = new Date(t.resignDate);
          if (rDate < monthStart) return false; 
      } else if (isResignedStatus) {
          return false; 
      }
      return true;
    }).map(t => ({
      id: t.id, name: t.name, stores: [t.id] 
    }));
  }, [therapists, selectedYear, selectedMonth]);

  const normalizedRawData = useMemo(() => {
    return rawData.map(report => ({
      ...report, 
      storeName: report.storeName, 
      date: safeGetDateStr(report.date) 
    }));
  }, [rawData]);

  // ============================================================================
  // ★ 行事曆大升級：強制換發標準制服，並補發所有到職/離職免死金牌
  // ============================================================================
  const normalizedTherapistReports = useMemo(() => {
    // 1. 整理所有原始報告的日期
    const parsedReports = (therapistReports || []).map(report => {
      let safeDate = safeGetDateStr(report.date);
      if (!safeDate && report.id) {
          const match = String(report.id).match(/(\d{4}-\d{2}-\d{2})/);
          if (match) safeDate = match[1];
      }
      return { ...report, parsedDate: safeDate };
    });

    // 2. 真實報告強制「標準化」：用雷達尋找真正主人，把名字換成系統行事曆看得懂的 t.id
    const realReports = parsedReports.map(report => {
        let standardId = report.therapistId || report.therapistName || report.id;
        const matchedT = therapists.find(t => 
            isTherapistMatch(report.therapistId, t) || 
            isTherapistMatch(report.therapistName, t) || 
            isTherapistMatch(report.id, t) ||
            isTherapistMatch(report.storeName, t)
        );
        if (matchedT) standardId = matchedT.id; // 換上標準制服
        return { ...report, storeName: standardId, date: report.parsedDate };
    });

    if (auditType !== 'therapist-daily') return realReports;

    const ghostReports = [];
    const yStr = String(selectedYear);
    const mNum = parseInt(selectedMonth, 10);
    const daysInMonth = new Date(parseInt(yStr), mNum, 0).getDate();

    therapists.forEach(t => {
      const obDate = t.onboardDate ? new Date(t.onboardDate) : new Date("2000-01-01");
      obDate.setHours(0,0,0,0);
      
      const isResignedStatus = t.status === 'resigned' || t.isActive === false || t.isResigned === true;
      const rDate = t.resignDate ? new Date(t.resignDate) : null;
      if (rDate) rDate.setHours(0,0,0,0);

      if (obDate > new Date(yStr, mNum, 0)) return; 
      if (rDate && rDate < new Date(yStr, mNum - 1, 1)) return;
      if (!rDate && isResignedStatus) return;

      // 抓取本月休假陣列
      let daysOff = [];
      Object.entries(therapistSchedules || {}).forEach(([k, sched]) => {
          if (isTherapistMatch(k, t) || isTherapistMatch(sched?.therapistId, t) || isTherapistMatch(sched?.therapistName, t)) {
              const hasYear = k.includes(yStr) || String(sched?.year) === yStr;
              const hasMonth = k.includes(`_${mNum}`) || k.includes(`_${String(mNum).padStart(2,'0')}`) || String(sched?.month) === String(mNum) || k.includes(`${yStr}-${String(mNum).padStart(2,'0')}`);
              if (hasYear && hasMonth) {
                  daysOff = [...new Set([...daysOff, ...(sched?.daysOff || [])])];
              }
          }
      });

      // 3. 全月掃描：補發休假、到職前、離職後的免死金牌
      for (let d = 1; d <= daysInMonth; d++) {
          const currentDate = new Date(yStr, mNum - 1, d);
          currentDate.setHours(0,0,0,0);
          const dateStr = `${yStr}-${mNum.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;

          let isExcused = false;

          // 未到職 / 已離職
          if (currentDate < obDate) isExcused = true;
          if (rDate && currentDate > rDate) isExcused = true;
          
          // 有休假
          if (!isExcused) {
              const isOff = daysOff.some(offDay => {
                  if (String(offDay).includes('-')) return String(offDay) === dateStr;
                  return Number(offDay) === d;
              });
              if (isOff) isExcused = true;
          }

          if (isExcused) {
              ghostReports.push({ id: `ghost_${t.id}_${dateStr}`, storeName: t.id, date: dateStr, isGhost: true, revenue: 0 });
          }
      }
    });

    return [...realReports, ...ghostReports];
  }, [therapistReports, auditType, selectedYear, selectedMonth, therapists, therapistSchedules, isTherapistMatch]);
  // ============================================================================

  const isTherapistMode = auditType === 'therapist-daily';
  const calendarStores = isTherapistMode ? activeTherapistsForCalendar : activeStoresForCalendar;
  const calendarSalesData = isTherapistMode ? normalizedTherapistReports : normalizedRawData;

  const auditData = useMemo(() => {
    if (!checkDate) return { submitted: [], missing: [], missingByManager: {} };
    const targetDate = safeGetDateStr(checkDate);
    const submittedRaw = rawData.filter((d) => safeGetDateStr(d.date) === targetDate).map((d) => d.storeName);
    const missingByManager = {};
    Object.entries(managers).forEach(([manager, stores]) => {
      const missing = [];
      stores.forEach((s) => {
        const cleanS = cleanStoreName(s);
        if (auditExclusions.includes(s) || auditExclusions.includes(cleanS)) return; 
        
        const isSubmitted = submittedRaw.some(rawName => rawName && rawName.includes(s));
        if (!isSubmitted) missing.push(`${brandPrefix}${s}店`);
      });
      if (missing.length) missingByManager[manager] = missing;
    });
    return { submitted: submittedRaw, missing: Object.values(missingByManager).flat(), missingByManager };
  }, [checkDate, rawData, managers, auditExclusions, brandPrefix, cleanStoreName]);

  const targetAuditData = useMemo(() => {
    const missingByManager = {};
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    Object.entries(managers).forEach(([manager, stores]) => {
      const missing = [];
      stores.forEach((s) => {
        const cleanS = cleanStoreName(s);
        if (auditExclusions.includes(s) || auditExclusions.includes(cleanS)) return;
        
        const name = `${brandPrefix}${s}店`;
        const key = `${name}_${y}_${m}`;
        const b = budgets[key];
        if (!b || (!b.cashTarget && !b.accrualTarget)) missing.push(name);
      });
      if (missing.length) missingByManager[manager] = missing;
    });
    return { missing: Object.values(missingByManager).flat(), missingByManager };
  }, [budgets, managers, selectedYear, selectedMonth, auditExclusions, brandPrefix, cleanStoreName]);

  const therapistAuditData = useMemo(() => {
    if (!checkDate) return { missing: [], missingByManager: {} };
    
    const targetDateStr = safeGetDateStr(checkDate);
    const [yStr, mStr, dStr] = targetDateStr.split('-');
    const year = yStr;
    const month = parseInt(mStr, 10);
    const day = parseInt(dStr, 10);

    const missingByManager = {};
    const targetDateObj = new Date(targetDateStr);
    targetDateObj.setHours(0,0,0,0);
    
    (therapists || []).forEach(t => {
      const obDate = t.onboardDate ? new Date(t.onboardDate) : new Date("2000-01-01");
      obDate.setHours(0,0,0,0);
      if (targetDateObj < obDate) return; 

      const isResignedStatus = t.status === 'resigned' || t.isActive === false || t.isResigned === true;
      if (t.resignDate) {
        const rDate = new Date(t.resignDate);
        rDate.setHours(0,0,0,0);
        if (targetDateObj > rDate) return; 
      } else if (isResignedStatus) {
        return; 
      }

      let isOff = false;
      Object.entries(therapistSchedules || {}).forEach(([k, sched]) => {
          if (isTherapistMatch(k, t) || isTherapistMatch(sched?.therapistId, t) || isTherapistMatch(sched?.therapistName, t)) {
              const hasYear = k.includes(year) || String(sched?.year) === year;
              const hasMonth = k.includes(`_${month}`) || k.includes(`_${String(month).padStart(2,'0')}`) || String(sched?.month) === String(month) || k.includes(`${year}-${String(month).padStart(2,'0')}`);
              if (hasYear && hasMonth) {
                  if (sched?.daysOff?.some(d => {
                      const dStrArg = String(d);
                      if (dStrArg.includes('-')) return dStrArg === targetDateStr;
                      return Number(d) === day;
                  })) {
                      isOff = true;
                  }
              }
          }
      });

      if (isOff) return; 

      let hasSubmitted = false;
      (therapistReports || []).forEach(r => {
          const d1 = safeGetDateStr(r.date);
          const d2 = String(r.id || "");
          const isToday = d1 === targetDateStr || d2.includes(targetDateStr);

          if (isToday) {
              const searchPool = [r.therapistId, r.therapistName, r.id, r.storeName].filter(Boolean);
              if (searchPool.some(val => isTherapistMatch(val, t))) {
                  hasSubmitted = true;
              }
          }
      });

      if (!hasSubmitted) {
        const mgr = t.manager || "未分區";
        if (!missingByManager[mgr]) missingByManager[mgr] = [];
        missingByManager[mgr].push(`${t.name} (${t.store}店)`);
      }
    });

    return { missing: Object.values(missingByManager).flat(), missingByManager };
  }, [checkDate, therapists, therapistReports, therapistSchedules, isTherapistMatch]);
   
  const therapistTargetAuditData = useMemo(() => {
    const missingByManager = {};
    const yStr = String(selectedYear);
    const mNum = parseInt(selectedMonth, 10);
    const monthKey = mNum.toString(); 
    
    const monthStart = new Date(parseInt(yStr), mNum - 1, 1);
    const monthEnd = new Date(parseInt(yStr), mNum, 0);

    (therapists || []).forEach(t => {
       const obDate = t.onboardDate ? new Date(t.onboardDate) : new Date("2000-01-01");
       if (obDate > monthEnd) return; 

       const isResignedStatus = t.status === 'resigned' || t.isActive === false || t.isResigned === true;
       if (t.resignDate) {
           const rDate = new Date(t.resignDate);
           if (rDate < monthStart) return; 
       } else if (isResignedStatus) {
           return;
       }

       let hasTarget = false;
       Object.entries(therapistTargets || {}).forEach(([k, targetObj]) => {
           if (isTherapistMatch(k, t) || isTherapistMatch(targetObj?.therapistId, t) || isTherapistMatch(targetObj?.therapistName, t)) {
               const hasYear = k.includes(yStr) || String(targetObj?.year) === yStr;
               if (hasYear) {
                   const targetVal = targetObj?.monthlyTargets?.[monthKey] || targetObj?.[monthKey];
                   if (targetVal && parseInt(targetVal) > 0) {
                       hasTarget = true;
                   }
               }
           }
       });

       if (!hasTarget) {
         const mgr = t.manager || "未分區";
         if (!missingByManager[mgr]) missingByManager[mgr] = [];
         missingByManager[mgr].push(`${t.name} (${t.store}店)`);
       }
    });

    return { missing: Object.values(missingByManager).flat(), missingByManager };
  }, [therapists, therapistTargets, selectedYear, selectedMonth, isTherapistMatch]);

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
      const cleanList = list.map(s => {
        if (auditType.includes('therapist')) return s;
        return cleanStoreName(s);
      });
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
                  <button onClick={() => setAuditType("daily")} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${auditType === "daily" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400 hover:text-stone-600"}`}>店家日報</button>
                  <button onClick={() => setAuditType("target")} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${auditType === "target" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400 hover:text-stone-600"}`}>店家目標</button>
                </>
              )}
              <button onClick={() => setAuditType("therapist-daily")} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${auditType === "therapist-daily" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400 hover:text-stone-600"}`}>管理師日報</button>
              <button onClick={() => setAuditType("therapist-target")} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${auditType === "therapist-target" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400 hover:text-stone-600"}`}>管理師目標</button>
            </div>

            <div className="flex gap-2 items-center w-full sm:w-auto">
                {(auditType === "daily" || auditType === "therapist-daily") ? (
                   <div className="w-full sm:w-auto relative z-10">
                      {activeStoresForCalendar.length === 0 ? (
                        <div className="px-4 py-3 bg-rose-50 text-rose-600 text-sm font-bold rounded-xl border border-rose-100 flex items-center gap-2 whitespace-nowrap animate-pulse">
                          <HelpCircle size={18} /> 尚未設定檢核店家
                        </div>
                      ) : (
                        <SmartDatePicker 
                          selectedDate={checkDate}
                          onDateSelect={setCheckDate}
                          stores={calendarStores}       
                          salesData={calendarSalesData} 
                          min={minBoundary}
                          max={maxBoundary}
                          minDate={new Date(parseInt(selectedYear), parseInt(selectedMonth) - 1, 1)}
                          maxDate={new Date(parseInt(selectedYear), parseInt(selectedMonth), 0)}
                        />
                      )}
                   </div>
                ) : (
                   <div className="px-4 py-2 bg-indigo-50 text-indigo-600 font-bold rounded-xl text-sm border border-indigo-100 flex items-center gap-2 self-start flex-grow">
                      <Target size={16}/> 檢核月份：{selectedYear} 年 {selectedMonth} 月
                   </div>
                )}

                {(userRole === 'master' || userRole === 'director' || userRole === 'manager') && (auditType === 'daily' || auditType === 'target') && (
                  <button onClick={openConfigModal} className="p-2 bg-stone-100 text-stone-500 rounded-xl hover:bg-stone-200 self-end" title="設定排除店家">
                    <Settings size={20}/>
                  </button>
                )}
            </div>
          </div>

          {(auditType === "daily" || auditType === "therapist-daily") && (
            <div className="flex items-center gap-4 text-sm font-medium text-stone-600 self-start md:self-center pl-1 hidden md:flex">
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm"></span><span className="whitespace-nowrap">全數回報</span></div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm"></span><span className="whitespace-nowrap">回報不完全</span></div>
            </div>
          )}

        </div>
        
        <div className="border border-rose-100 rounded-3xl overflow-hidden shadow-sm mb-8">
          <div className="bg-rose-50 px-6 py-4 flex justify-between items-center flex-wrap gap-2">
            <h4 className="font-bold text-rose-600 flex items-center gap-2">
              <AlertCircle size={20} /> 
              {auditType === 'therapist-daily' ? "未回報人員 (已排除休假/未上線)" : 
               auditType === 'therapist-target' ? "未設定目標人員 (已排除未上線)" :
               "未完成名單"} 
              <span className="bg-white px-2 py-0.5 rounded-full text-xs border border-rose-200 shadow-sm">{activeData.missing.length}</span>
            </h4>
            <button onClick={handleCopy} className="text-xs bg-white text-rose-500 px-4 py-2 rounded-xl border border-rose-200 font-bold hover:bg-rose-50 transition-colors">複製名單</button>
          </div>
          <div className="p-6 bg-white grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(activeData.missingByManager).map(
              ([mgr, list]) => (
                <div key={mgr} className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                  <div className="font-bold text-stone-600 mb-2">{mgr} 區</div>
                  <div className="flex flex-wrap gap-2">
                    {list.map((s, idx) => (
                      <span key={idx} className="bg-white px-2 py-1 rounded-lg text-xs border border-stone-200 text-stone-600 font-medium flex items-center gap-1">
                        {auditType.includes('therapist') && <UserX size={10} className="text-rose-400"/>}
                        {auditType.includes('therapist') ? s : cleanStoreName(s)}
                      </span>
                    ))}
                  </div>
                </div>
              )
            )}
            {activeData.missing.length === 0 && (
              <div className="col-span-3 text-center py-10">
                <div className="inline-flex flex-col items-center gap-2 text-emerald-500 font-bold text-lg">
                   <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-2"><CheckCircle size={24}/></div>
                   全數完成！
                   {auditType === 'therapist-daily' && <span className="text-xs text-stone-400 font-normal">未上線、停權、休假人員已自動排除</span>}
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
                      const cleanS = cleanStoreName(store);
                      const isExcluded = localExclusions.includes(store) || localExclusions.includes(cleanS);
                      return (
                        <button key={store} onClick={() => toggleExclusion(store)} className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 ${isExcluded ? "bg-rose-50 border-rose-500 text-rose-600 shadow-sm" : "bg-white border-stone-200 text-stone-500 hover:border-stone-400"}`}>
                          {isExcluded && <CheckCircle size={14}/>}
                          {cleanS}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-stone-100 bg-white shrink-0 flex justify-end gap-3">
              <button onClick={() => setIsConfigModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-stone-500 hover:bg-stone-50">取消</button>
              <button onClick={saveConfig} className="px-6 py-2.5 rounded-xl font-bold bg-stone-800 text-white hover:bg-stone-700 shadow-lg flex items-center gap-2"><Save size={18}/> 儲存設定</button>
            </div>
          </div>
        </div>
      )}
    </ViewWrapper>
  );
};

export default AuditView;