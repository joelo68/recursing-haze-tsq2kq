// src/components/AuditView.jsx
import React, { useState, useMemo, useContext, useCallback, useEffect } from "react";
import { AlertCircle, UserX, CheckCircle, Target, Settings, X, Save, Ban, HelpCircle } from "lucide-react"; 

import { AppContext } from "../AppContext";
import { formatLocalYYYYMMDD } from "../utils/helpers";
import { ViewWrapper, Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";

// ★ 終極翻譯蒟蒻：日期標準化
const safeGetDateStr = (val) => {
    if (!val) return "";
    if (typeof val?.toDate === 'function') {
        const d = val.toDate();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    if (val instanceof Date) return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
    if (typeof val === 'string') {
        const m = val.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
        if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    }
    return String(val);
};

const AuditView = ({ auditType: controlledAuditType, setAuditType: setControlledAuditType } = {}) => {
  const {
    managers, showToast, budgets, selectedYear, selectedMonth, rawData,
    therapists, therapistReports, therapistSchedules, userRole, therapistTargets,
    auditExclusions = [], handleUpdateAuditExclusions, currentBrand
  } = useContext(AppContext);

  const [checkDate, setCheckDate] = useState(formatLocalYYYYMMDD(new Date()));
  const [localAuditType, setLocalAuditType] = useState(userRole === 'trainer' ? "therapist-daily" : "daily");
  const auditType = controlledAuditType || localAuditType;
  const setAuditType = setControlledAuditType || setLocalAuditType; 
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [localExclusions, setLocalExclusions] = useState([]);

  // trainer 角色只能使用管理師檢核；auditType 由 App 控制時也要保留原本預設行為。
  useEffect(() => {
    if (userRole === 'trainer' && auditType !== 'therapist-daily' && auditType !== 'therapist-target') {
      setAuditType('therapist-daily');
    }
  }, [userRole, auditType, setAuditType]);

  useEffect(() => {
    if (!checkDate || !selectedYear || !selectedMonth) return;
    const currentObj = new Date(checkDate);
    if (currentObj.getFullYear().toString() !== selectedYear || (currentObj.getMonth() + 1).toString() !== selectedMonth) {
      setCheckDate(`${selectedYear}-${selectedMonth.padStart(2, '0')}-01`);
    }
  }, [selectedYear, selectedMonth]);

  const { minBoundary, maxBoundary } = useMemo(() => {
    const y = parseInt(selectedYear), m = parseInt(selectedMonth);
    return {
      minBoundary: `${y}-${String(m).padStart(2, '0')}-01`,
      maxBoundary: `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`
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
    return String(name)
      .replace(/^(DRCYJ|DR\.CYJ|CYJ|Anew\s*\(安妞\)|Yibo\s*\(伊啵\)|安妞|伊啵|Anew|Yibo)\s*/i, '')
      .replace(/店$/i, '')
      .replace(/[　\s]+/g, '')
      .trim();
  }, []);

  const normalizeText = useCallback((value) => {
    return String(value || "")
      .toLowerCase()
      .replace(/[　\s\-_/()（）.]/g, "")
      .trim();
  }, []);

  const getChineseText = useCallback((value) => {
    return (String(value || "").match(/[\u4e00-\u9fa5]+/g) || []).join("");
  }, []);

  const getTherapistStore = useCallback((t = {}) => {
    return cleanStoreName(
      t.storeName || t.store || t.homeStore || t.branch || t.branchName || t.primaryStore || t.currentStore || ""
    );
  }, [cleanStoreName]);

  const getTherapistDisplayName = useCallback((t = {}) => {
    return t.name || t.therapistName || t.displayName || String(t.id || "未命名");
  }, []);

  const getTherapistManager = useCallback((t = {}) => {
    if (t.manager || t.managerName || t.areaManager) return t.manager || t.managerName || t.areaManager;
    const storeCore = getTherapistStore(t);
    if (!storeCore) return "未分區";
    const found = Object.entries(managers || {}).find(([, stores]) =>
      (stores || []).some((s) => cleanStoreName(s) === storeCore)
    );
    return found?.[0] || "未分區";
  }, [managers, cleanStoreName, getTherapistStore]);

  const isTherapistMatch = useCallback((str, t) => {
    if (!str || !t) return false;

    const source = normalizeText(str);
    if (!source) return false;

    const candidates = [
      t.id,
      t.uid,
      t.therapistId,
      t.employeeId,
      t.name,
      t.therapistName,
      t.displayName,
    ].map(normalizeText).filter(Boolean);

    if (candidates.some((candidate) =>
      source === candidate ||
      source.includes(candidate) ||
      (candidate.length >= 2 && candidate.includes(source))
    )) return true;

    const sourceChinese = getChineseText(str);
    if (sourceChinese.length >= 2) {
      const chineseCandidates = [
        t.name,
        t.therapistName,
        t.displayName,
      ].map(getChineseText).filter((v) => v.length >= 2);

      if (chineseCandidates.some((candidate) =>
        sourceChinese === candidate ||
        sourceChinese.includes(candidate) ||
        candidate.includes(sourceChinese)
      )) return true;
    }

    return false;
  }, [normalizeText, getChineseText]);

  const isTargetInSelectedMonth = useCallback((key, targetObj = {}) => {
    const y = String(selectedYear);
    const m = String(parseInt(selectedMonth, 10));
    const mm = m.padStart(2, "0");
    const keyText = String(key || "");

    if (String(targetObj.yearMonth || targetObj.monthKey || "") === `${y}-${mm}`) return true;
    if (String(targetObj.year || targetObj.targetYear || "") === y && String(targetObj.month || targetObj.targetMonth || "").padStart(2, "0") === mm) return true;
    if (keyText.includes(`${y}_${m}`) || keyText.includes(`${y}_${mm}`) || keyText.includes(`${y}-${mm}`)) return true;
    if (keyText.includes(y) && (keyText.includes(`_${m}`) || keyText.includes(`_${mm}`) || keyText.includes(`-${mm}`))) return true;

    return false;
  }, [selectedYear, selectedMonth]);

  const readTargetNumber = useCallback((value) => {
    if (value == null) return 0;
    if (typeof value === "number" || typeof value === "string") return Number(value) || 0;
    if (typeof value === "object") {
      return Number(
        value.target ??
        value.revenueTarget ??
        value.targetRevenue ??
        value.totalRevenueTarget ??
        value.performanceTarget ??
        value.cashTarget ??
        value.accrualTarget ??
        value.goal ??
        value.value ??
        0
      ) || 0;
    }
    return 0;
  }, []);

  const getTherapistMonthlyTarget = useCallback((targetObj = {}) => {
    const m = String(parseInt(selectedMonth, 10));
    const mm = m.padStart(2, "0");
    const monthlyTargets = targetObj.monthlyTargets || targetObj.targets || targetObj.monthTargets || null;

    if (Array.isArray(monthlyTargets)) {
      return readTargetNumber(monthlyTargets[parseInt(m, 10) - 1] ?? monthlyTargets[parseInt(m, 10)]);
    }

    if (monthlyTargets && typeof monthlyTargets === "object") {
      const candidate = monthlyTargets[m] ?? monthlyTargets[mm] ?? monthlyTargets[`month_${m}`] ?? monthlyTargets[`month_${mm}`] ?? monthlyTargets[`m${m}`] ?? monthlyTargets[`m${mm}`];
      const value = readTargetNumber(candidate);
      if (value > 0) return value;
    }

    return readTargetNumber(
      targetObj[m] ??
      targetObj[mm] ??
      targetObj[`month_${m}`] ??
      targetObj[`month_${mm}`] ??
      targetObj[`m${m}`] ??
      targetObj[`m${mm}`] ??
      targetObj.target ??
      targetObj.revenueTarget ??
      targetObj.targetRevenue ??
      targetObj.totalRevenueTarget ??
      targetObj.performanceTarget
    );
  }, [selectedMonth, readTargetNumber]);

  const openConfigModal = () => { setLocalExclusions(auditExclusions || []); setIsConfigModalOpen(true); };
  const saveConfig = async () => { await handleUpdateAuditExclusions(localExclusions); setIsConfigModalOpen(false); showToast("排除名單已更新", "success"); };
  const toggleExclusion = (store) => {
    const cleanS = cleanStoreName(store);
    setLocalExclusions(prev => prev.includes(cleanS) || prev.includes(store) ? prev.filter(s => s !== store && s !== cleanS) : [...prev, cleanS]);
  };

  const activeStoresForCalendar = useMemo(() => {
    const allMyStores = Object.values(managers).flat();
    return allMyStores.filter(s => !auditExclusions.includes(s) && !auditExclusions.includes(cleanStoreName(s))) 
      .map(s => ({ id: s, name: `${s}店`, stores: [s, `${s}店`, `${brandPrefix}${s}`, `${brandPrefix}${s}店`, `CYJ${s}店`] }));
  }, [managers, auditExclusions, brandPrefix, cleanStoreName]);

  const validTherapistsForMonth = useMemo(() => {
      const y = parseInt(selectedYear), m = parseInt(selectedMonth);
      const start = new Date(y, m - 1, 1), end = new Date(y, m, 0, 23, 59, 59);
      const activeStoreSet = new Set(activeStoresForCalendar.map((s) => cleanStoreName(s.id)).filter(Boolean));

      return (therapists || []).filter(t => {
          const ob = t.onboardDate ? new Date(t.onboardDate) : new Date(2000,0,1);
          if (ob > end) return false; 
          if (t.resignDate && new Date(t.resignDate) < start) return false; 
          if (!t.resignDate && (t.status === 'resigned' || t.isActive === false)) return false;

          // 管理師檢核必須跟目前品牌 / 區長架構的店家範圍一致；
          // 避免 Summary 改版後 therapists 來源變成全集團時，把其他品牌或離群資料算進來。
          const therapistStore = getTherapistStore(t);
          if (therapistStore && activeStoreSet.size > 0 && !activeStoreSet.has(therapistStore)) return false;

          return true;
      });
  }, [therapists, selectedYear, selectedMonth, activeStoresForCalendar, cleanStoreName, getTherapistStore]);

  const activeTherapistsForCalendar = useMemo(() => validTherapistsForMonth.map(t => {
      const displayName = getTherapistDisplayName(t);
      return {
        id: String(t.id || t.therapistId || displayName),
        name: displayName,
        stores: [String(t.id || ""), String(t.therapistId || ""), displayName].filter(Boolean)
      };
  }), [validTherapistsForMonth, getTherapistDisplayName]);

  // ============================================================================
  // ★ 大腦中心 (Single Source of Truth)
  // ============================================================================
  const dailyMatrix = useMemo(() => {
      const matrix = { stores: {}, therapists: {} };
      const yStr = String(selectedYear), mNum = parseInt(selectedMonth, 10);
      const mStr = String(mNum).padStart(2, '0');
      const days = new Date(parseInt(yStr), mNum, 0).getDate();

      for (let d = 1; d <= days; d++) {
          const dateStr = `${yStr}-${mStr}-${d.toString().padStart(2, '0')}`;
          const dateObj = new Date(dateStr);
          
          const subStores = rawData.filter(r => safeGetDateStr(r.date) === dateStr).map(r => r.storeName);
          matrix.stores[dateStr] = activeStoresForCalendar.map(s => s.id).filter(id => !subStores.some(sub => sub && sub.includes(id))).map(id => `${brandPrefix}${id}店`);

          const missingT = [];
          validTherapistsForMonth.forEach(t => {
              const ob = t.onboardDate ? new Date(t.onboardDate) : null;
              const rs = t.resignDate ? new Date(t.resignDate) : null;
              if (ob && dateObj < ob) return;
              if (rs && dateObj > rs) return;

              let isOff = false;
              Object.entries(therapistSchedules || {}).forEach(([k, sched]) => {
                  const matchedTherapist = isTherapistMatch(k, t) || isTherapistMatch(sched?.therapistId, t) || isTherapistMatch(sched?.therapistName, t) || isTherapistMatch(sched?.name, t);
                  if (!matchedTherapist) return;

                  const scheduleYearMonth = String(sched?.yearMonth || sched?.monthKey || "");
                  const sameMonth =
                      scheduleYearMonth === `${yStr}-${mStr}` ||
                      (String(sched?.year) === yStr && String(sched?.month).padStart(2, "0") === mStr) ||
                      (String(k).includes(yStr) && (String(k).includes(`_${mNum}`) || String(k).includes(`_${mStr}`) || String(k).includes(`-${mStr}`)));

                  if (!sameMonth) return;

                  if ((sched?.daysOff || []).some(off => {
                      const offDate = typeof off === "object" && off !== null ? (off.date || off.day || off.value) : off;
                      return String(offDate).includes("-") ? safeGetDateStr(offDate) === dateStr : Number(offDate) === d;
                  })) isOff = true;
              });
              if (isOff) return;

              const hasSub = (therapistReports || []).some(r => {
                  const reportDate = safeGetDateStr(r.date || r.reportDate || r.sourceDate);
                  const reportId = String(r.id || "");
                  if (reportDate !== dateStr && !reportId.includes(dateStr)) return false;

                  return (
                    isTherapistMatch(r.therapistId, t) ||
                    isTherapistMatch(r.therapistName, t) ||
                    isTherapistMatch(r.name, t) ||
                    isTherapistMatch(r.personName, t) ||
                    isTherapistMatch(reportId, t)
                  );
              });

              if (!hasSub) {
                  const displayName = getTherapistDisplayName(t);
                  const storeName = getTherapistStore(t);
                  missingT.push(`${displayName}${storeName ? ` (${storeName}店)` : ""}`);
              }
          });
          matrix.therapists[dateStr] = missingT;
      }
      return matrix;
  }, [selectedYear, selectedMonth, rawData, activeStoresForCalendar, validTherapistsForMonth, therapistSchedules, therapistReports, isTherapistMatch, brandPrefix, getTherapistDisplayName, getTherapistStore]);

  // ============================================================================
  // ★ 完美日曆資料：既服從大腦，又保留真實業績
  // ============================================================================
  const calendarSalesData = useMemo(() => {
      const reports = [];
      const days = new Date(parseInt(selectedYear), parseInt(selectedMonth), 0).getDate();
      const yStr = String(selectedYear), mStr = String(selectedMonth).padStart(2, '0');

      if (auditType === 'daily') {
          const rawNorm = rawData.map(r => ({ ...r, date: safeGetDateStr(r.date) }));
          for (let d = 1; d <= days; d++) {
              const dateStr = `${yStr}-${mStr}-${d.toString().padStart(2, '0')}`;
              const missingStores = dailyMatrix.stores[dateStr] || [];

              activeStoresForCalendar.forEach(s => {
                  const isMissing = missingStores.includes(`${brandPrefix}${s.id}店`);
                  const real = rawNorm.find(r => r.date === dateStr && r.storeName === s.id);

                  if (!isMissing) {
                      // 沒缺漏，有真實報告就給真實報告(確保大於0)，沒報告就發幽靈綠燈
                      if (real) reports.push({ ...real, cash: Number(real.cash) > 0 ? Number(real.cash) : 0.0001 });
                      else reports.push({ storeName: s.id, date: dateStr, cash: 0.0001, isGhost: true });
                  } else {
                      // 有缺漏，如果他傳了無效報告，強制把金額壓成0，讓日曆亮紅燈
                      if (real) reports.push({ ...real, cash: 0 });
                  }
              });
          }
      } else if (auditType === 'therapist-daily') {
          const thNorm = (therapistReports || []).map(r => {
              let dStr = safeGetDateStr(r.date);
              if (!dStr && r.id) { const m = String(r.id).match(/(\d{4}-\d{2}-\d{2})/); if (m) dStr = m[1]; }
              return { ...r, parsedDate: dStr };
          });

          for (let d = 1; d <= days; d++) {
              const dateStr = `${yStr}-${mStr}-${d.toString().padStart(2, '0')}`;
              const missingT = dailyMatrix.therapists[dateStr] || [];

              validTherapistsForMonth.forEach(t => {
                  const displayName = getTherapistDisplayName(t);
                  const storeName = getTherapistStore(t);
                  const missingName = `${displayName}${storeName ? ` (${storeName}店)` : ""}`;
                  const isMissing = missingT.includes(missingName);
                  const sid = String(t.id || t.therapistId || displayName).trim();
                  const real = thNorm.find(r => r.parsedDate === dateStr && (isTherapistMatch(r.therapistId, t) || isTherapistMatch(r.therapistName, t) || isTherapistMatch(r.name, t) || isTherapistMatch(r.id, t)));

                  if (!isMissing) {
                      // 沒缺漏：給真實業績，若為0則墊底 0.0001 確保綠燈
                      if (real) {
                          const rev = Number(real.totalRevenue) || 0;
                          reports.push({ ...real, storeName: sid, date: dateStr, cash: rev > 0 ? rev : 0.0001, revenue: rev > 0 ? rev : 0.0001 });
                      } else {
                          reports.push({ storeName: sid, date: dateStr, cash: 0.0001, revenue: 0.0001, isGhost: true });
                      }
                  } else {
                      // 有缺漏：強壓金額為0
                      if (real) reports.push({ ...real, storeName: sid, date: dateStr, cash: 0, revenue: 0 });
                  }
              });
          }
      }
      return reports;
  }, [dailyMatrix, auditType, activeStoresForCalendar, validTherapistsForMonth, selectedYear, selectedMonth, rawData, therapistReports, isTherapistMatch, brandPrefix, getTherapistDisplayName, getTherapistStore]);

  const activeData = useMemo(() => {
      let missing = [];
      const missingByManager = {};

      if (auditType === 'daily') missing = dailyMatrix.stores[checkDate] || [];
      else if (auditType === 'therapist-daily') missing = dailyMatrix.therapists[checkDate] || [];
      else if (auditType === 'target') {
          Object.entries(managers).forEach(([mgr, stores]) => {
              stores.forEach(s => {
                  if (auditExclusions.includes(s) || auditExclusions.includes(cleanStoreName(s))) return;
                  const name = `${brandPrefix}${s}店`, key = `${name}_${parseInt(selectedYear)}_${parseInt(selectedMonth)}`;
                  const b = budgets[key];
                  if (!b || (!b.cashTarget && !b.accrualTarget)) { missing.push(name); if(!missingByManager[mgr]) missingByManager[mgr]=[]; missingByManager[mgr].push(name); }
              });
          });
          return { missing, missingByManager };
      }
      else if (auditType === 'therapist-target') {
          validTherapistsForMonth.forEach(t => {
              let hasTarget = false;

              Object.entries(therapistTargets || {}).forEach(([k, targetObj]) => {
                  const matchedTherapist =
                    isTherapistMatch(k, t) ||
                    isTherapistMatch(targetObj?.therapistId, t) ||
                    isTherapistMatch(targetObj?.therapistName, t) ||
                    isTherapistMatch(targetObj?.name, t);

                  if (!matchedTherapist) return;

                  const sameMonth = isTargetInSelectedMonth(k, targetObj);
                  const targetVal = getTherapistMonthlyTarget(targetObj);

                  // 兼容兩種格式：
                  // 1. 一人一份全年目標：monthlyTargets[5] / monthlyTargets["05"]
                  // 2. 一人一月一份目標：docId 或欄位直接帶 year/month/yearMonth + target
                  if (sameMonth || targetObj?.monthlyTargets || targetObj?.targets || targetObj?.monthTargets) {
                      if (targetVal > 0) hasTarget = true;
                  }
              });

              if (!hasTarget) {
                  const displayName = getTherapistDisplayName(t);
                  const storeName = getTherapistStore(t);
                  const name = `${displayName}${storeName ? ` (${storeName}店)` : ""}`;
                  const mgr = getTherapistManager(t);
                  missing.push(name); if(!missingByManager[mgr]) missingByManager[mgr]=[]; missingByManager[mgr].push(name);
              }
          });
          return { missing, missingByManager };
      }

      missing.forEach(nameStr => {
          let mgr = "未分區";
          if (auditType === 'daily') {
              const rawStore = nameStr.replace(/^(CYJ|安妞|伊啵)/, '').replace(/店$/, '');
              Object.entries(managers).forEach(([m, stores]) => { if (stores.includes(rawStore)) mgr = m; });
          } else {
              const t = validTherapistsForMonth.find(v => nameStr.includes(getTherapistDisplayName(v)));
              if (t) mgr = getTherapistManager(t);
          }
          if (!missingByManager[mgr]) missingByManager[mgr] = [];
          missingByManager[mgr].push(nameStr);
      });

      return { missing, missingByManager };
  }, [auditType, checkDate, dailyMatrix, managers, budgets, therapistTargets, selectedYear, selectedMonth, auditExclusions, brandPrefix, cleanStoreName, validTherapistsForMonth, isTherapistMatch, isTargetInSelectedMonth, getTherapistMonthlyTarget, getTherapistDisplayName, getTherapistStore, getTherapistManager]);

  const calendarStores = auditType.includes('therapist') ? activeTherapistsForCalendar : activeStoresForCalendar;

  const handleCopy = () => {
    let text = `未完成名單(${checkDate})：\n`;
    Object.entries(activeData.missingByManager).forEach(([mgr, list]) => { text += `${mgr}區：${list.join("、")}\n`; });
    navigator.clipboard.writeText(text);
    showToast("已複製", "success");
  };

  return (
    <ViewWrapper>
      <Card title="回報檢核中心">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <div className="bg-stone-100 p-1 rounded-xl flex shrink-0 self-start overflow-x-auto max-w-full">
              {userRole !== 'trainer' && (
                <>
                  <button onClick={() => setAuditType("daily")} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${auditType === "daily" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400"}`}>店家日報</button>
                  <button onClick={() => setAuditType("target")} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${auditType === "target" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400"}`}>店家目標</button>
                </>
              )}
              <button onClick={() => setAuditType("therapist-daily")} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${auditType === "therapist-daily" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400"}`}>管理師日報</button>
              <button onClick={() => setAuditType("therapist-target")} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${auditType === "therapist-target" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400"}`}>管理師目標</button>
            </div>

            <div className="flex gap-2 items-center w-full sm:w-auto">
                {(auditType === "daily" || auditType === "therapist-daily") ? (
                   <div className="w-full sm:w-auto relative z-10">
                        <SmartDatePicker 
                          selectedDate={checkDate} onDateSelect={setCheckDate}
                          stores={calendarStores} salesData={calendarSalesData} 
                          min={minBoundary} max={maxBoundary}
                        />
                   </div>
                ) : (
                   <div className="px-4 py-2 bg-indigo-50 text-indigo-600 font-bold rounded-xl text-sm border border-indigo-100 flex items-center gap-2"><Target size={16}/> {selectedYear} 年 {selectedMonth} 月</div>
                )}
                {(userRole === 'master' || userRole === 'director' || userRole === 'manager') && (auditType === 'daily' || auditType === 'target') && (
                  <button onClick={openConfigModal} className="p-2 bg-stone-100 text-stone-500 rounded-xl hover:bg-stone-200"><Settings size={20}/></button>
                )}
            </div>
          </div>
        </div>
        
        <div className="border border-rose-100 rounded-3xl overflow-hidden shadow-sm mb-8">
          <div className="bg-rose-50 px-6 py-4 flex justify-between items-center">
            <h4 className="font-bold text-rose-600 flex items-center gap-2"><AlertCircle size={20} /> 未完成名單 <span className="bg-white px-2 py-0.5 rounded-full text-xs border border-rose-200">{activeData.missing.length}</span></h4>
            <button onClick={handleCopy} className="text-xs bg-white text-rose-500 px-4 py-2 rounded-xl border border-rose-200 font-bold">複製名單</button>
          </div>
          <div className="p-6 bg-white grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(activeData.missingByManager).map(([mgr, list]) => (
              <div key={mgr} className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                <div className="font-bold text-stone-600 mb-2">{mgr} 區</div>
                <div className="flex flex-wrap gap-2">
                  {list.map((s, idx) => (<span key={idx} className="bg-white px-2 py-1 rounded-lg text-xs border border-stone-200 text-stone-600 flex items-center gap-1"><UserX size={10} className="text-rose-400"/>{s}</span>))}
                </div>
              </div>
            ))}
            {activeData.missing.length === 0 && (
              <div className="col-span-3 text-center py-10 text-emerald-500 font-bold text-lg">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-2"><CheckCircle size={24}/></div>全數完成！
              </div>
            )}
          </div>
        </div>
      </Card>

      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-stone-800 text-white p-4 font-bold text-lg flex justify-between items-center"><span className="flex items-center gap-2"><Ban size={20} className="text-rose-400"/> 排除店家</span><button onClick={() => setIsConfigModalOpen(false)}><X size={20}/></button></div>
            <div className="p-6 overflow-y-auto space-y-6">
              {Object.entries(managers).map(([mgr, stores]) => (
                <div key={mgr}>
                  <h4 className="font-bold text-stone-400 text-xs mb-2">{mgr} 區</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {stores.map(store => {
                      const cleanS = cleanStoreName(store), isEx = localExclusions.includes(store) || localExclusions.includes(cleanS);
                      return <button key={store} onClick={() => toggleExclusion(store)} className={`px-3 py-2 rounded-xl text-sm font-bold border-2 flex items-center gap-2 ${isEx ? "bg-rose-50 border-rose-500 text-rose-600" : "bg-white border-stone-200 text-stone-500"}`}>{isEx && <CheckCircle size={14}/>}{cleanS}</button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-stone-100 bg-white flex justify-end gap-3"><button onClick={() => setIsConfigModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-stone-500">取消</button><button onClick={saveConfig} className="px-6 py-2.5 rounded-xl font-bold bg-stone-800 text-white"><Save size={18}/> 儲存</button></div>
          </div>
        </div>
      )}
    </ViewWrapper>
  );
};

export default AuditView;