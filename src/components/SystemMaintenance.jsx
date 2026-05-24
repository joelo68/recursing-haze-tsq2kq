// src/components/SystemMaintenance.jsx
import React, { useState, useContext, useEffect, useMemo } from "react";
import { db } from "../config/firebase";
import {
  getDocs,
  getDoc,
  doc,
  writeBatch,
  collection,
  query,
  where,
  limit,
  setDoc,
  addDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { AppContext } from "../AppContext";
import {
  Database,
  Download,
  RefreshCw,
  AlertTriangle,
  Play,
  Scissors,
  ClipboardList,
  Trash2,
  Calendar,
  Settings,
  Loader2,
  Radio,
  BarChart3,
  Activity,
  Eye,
  Power,
  Globe2,
  Monitor,
  Clock,
  Save,
  CheckCircle2,
  ChevronDown,
  Shield,
} from "lucide-react";
import { ViewWrapper } from "./SharedUI";
import {
  getReadTrackerMode,
  setReadTrackerMode,
  getReadTrackerStats,
  clearReadTrackerStats,
  flushReadTrackerToFirestore,
  getReadTrackerScheduleStatus,
  resolveReadTrackerModeFromConfig,
} from "../utils/readTracker";

const todayMonth = () => new Date().toISOString().substring(0, 7);

export default function SystemMaintenance() {
  const { currentBrand, userRole, showToast, getCollectionPath, getDocPath, currentUser } = useContext(AppContext);

  const [logs, setLogs] = useState([]);
  const [loadingAction, setLoadingAction] = useState(null);
  const [calMonth, setCalMonth] = useState(todayMonth());
  const [backupType, setBackupType] = useState("full");
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [dateIssues, setDateIssues] = useState([]);
  const [duplicateGroups, setDuplicateGroups] = useState([]);

  const [healthReport, setHealthReport] = useState(null);
  const [expandedHealthIssue, setExpandedHealthIssue] = useState("");
  const [closingReport, setClosingReport] = useState(null);
  const [dataVolumeRows, setDataVolumeRows] = useState([]);
  const [archivedDuplicates, setArchivedDuplicates] = useState([]);
  const [backupRecords, setBackupRecords] = useState([]);
  const [orgStructureSnapshots, setOrgStructureSnapshots] = useState([]);
  const [recalcQueueGroups, setRecalcQueueGroups] = useState([]);
  const [recalcQueueTotal, setRecalcQueueTotal] = useState(0);
  const [summaryBuildReport, setSummaryBuildReport] = useState(null);
  const [summaryCompareReport, setSummaryCompareReport] = useState(null);
  const [archiveFilterMonth, setArchiveFilterMonth] = useState(todayMonth());

  const [readTrackerMode, setReadTrackerModeState] = useState(getReadTrackerMode());
  const [localReadStats, setLocalReadStats] = useState({});
  const [globalReadStats, setGlobalReadStats] = useState([]);
  const [loadingReadStats, setLoadingReadStats] = useState(false);
  const [globalRowsCount, setGlobalRowsCount] = useState(0);
  const [readTrackerConfig, setReadTrackerConfig] = useState({
    mode: getReadTrackerMode(),
    scheduleEnabled: false,
    scheduleMode: "global",
    startTime: "19:00",
    endTime: "07:00",
    timezone: "Asia/Taipei",
  });
  const [scheduleForm, setScheduleForm] = useState({
    scheduleEnabled: false,
    startTime: "19:00",
    endTime: "07:00",
  });

  if (userRole !== "director") return null;

  const brandId = currentBrand?.id || "unknown";
  const brandLabel = currentBrand?.label || "目前品牌";

  const addLog = (msg) => {
    const timeStr = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    setLogs((prev) => [{ id: Date.now() + Math.random(), time: timeStr, text: msg }, ...prev]);
  };

  const formatDateString = (value) => {
    if (!value) return "";
    const origDate = String(value).trim();
    let newDate = origDate;
    if (/^\d{8}$/.test(origDate)) {
      newDate = `${origDate.substring(0, 4)}-${origDate.substring(4, 6)}-${origDate.substring(6, 8)}`;
    } else {
      let cleanStr = origDate.replace(/[\/\.年月]/g, "-").replace(/日/g, "").replace(/-+/g, "-").trim();
      cleanStr = cleanStr.replace(/^-+|-+$/g, "");
      const parts = cleanStr.split("-");
      if (parts.length === 3) {
        const y = parts[0];
        const m = String(parseInt(parts[1], 10)).padStart(2, "0");
        const d = String(parseInt(parts[2], 10)).padStart(2, "0");
        if (!Number.isNaN(Number(y)) && !Number.isNaN(Number(m)) && !Number.isNaN(Number(d))) newDate = `${y}-${m}-${d}`;
      }
    }
    return newDate;
  };

  const isValidYYYYMMDD = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  const getStoreName = (data) => data?.storeName || data?.store || data?.storeId || "";
  const getTherapistName = (data) => data?.therapistName || data?.name || data?.therapist || "";
  const getNegativeFields = (data) => Object.entries(data || {})
    .filter(([, value]) => typeof value === "number" && value < 0)
    .map(([field, value]) => ({ field, value }));
  const countNegativeNumbers = (data) => getNegativeFields(data).length;

  const normalizeCoreName = (value) => {
    const raw = String(value || "")
      .trim()
      .replace(/[　\s]+/g, "")
      .replace(/[（）()]/g, "");
    if (!raw) return "";

    // 維護中心必須與 Dashboard / 回報檢核中心使用相同思路：
    // 將品牌前綴、括號品牌名、店字尾與空白全部排除，避免「安妞中美店」與「中美」被誤判為不同店。
    return raw
      .replace(/^(CYJ|Anew安妞|Yibo伊啵|Anew|Yibo|安妞|伊啵)/i, "")
      .replace(/店/g, "")
      .replace(/臺/g, "台")
      .trim();
  };

  const normalizePersonName = (value) => String(value || "")
    .trim()
    .replace(/[　\s]+/g, "")
    .replace(/[（）()]/g, "");

  const isWithinRange = (dateValue, startValue, endValue) => {
    const date = formatDateString(dateValue);
    const start = startValue ? formatDateString(startValue) : "";
    const end = endValue ? formatDateString(endValue) : "";
    if (!isValidYYYYMMDD(date)) return true;
    if (start && isValidYYYYMMDD(start) && date < start) return false;
    if (end && isValidYYYYMMDD(end) && date > end) return false;
    return true;
  };

  const isTherapistValidOnDate = (therapist, dateValue) => {
    if (!therapist) return false;
    const status = String(therapist.status || "").trim();
    const isHardInactive = therapist.isActive === false || therapist.isResigned === true || therapist.resigned === true || status === "離職" || status === "resigned";
    const hasResignDate = Boolean(therapist.resignDate || therapist.resignedDate || therapist.leaveDate);

    // 若有離職日，以日期判斷歷史有效性；若沒有離職日且已標記離職，才視為目前無效。
    if (isHardInactive && !hasResignDate) return false;

    return isWithinRange(dateValue, therapist.onboardDate || therapist.startDate || therapist.createdAtText, therapist.resignDate || therapist.resignedDate || therapist.leaveDate);
  };

  const buildTherapistMatchers = (therapists = []) => therapists.map((t) => ({
    raw: t,
    id: String(t.id || t.therapistId || "").trim(),
    name: normalizePersonName(t.name || t.therapistName),
    store: normalizeCoreName(t.store || t.storeName),
  })).filter((t) => t.id || t.name);

  const isKnownTherapistReport = (matchers, data) => {
    const reportId = String(data.therapistId || data.id || "").trim();
    const reportName = normalizePersonName(getTherapistName(data));
    const reportStore = normalizeCoreName(getStoreName(data));
    const reportDate = data.date || "";

    return matchers.some((item) => {
      if (!isTherapistValidOnDate(item.raw, reportDate)) return false;
      if (reportId && item.id && reportId === item.id) return true;
      if (reportName && item.name && reportName === item.name) {
        // 有店名時優先比對店，避免同名管理師誤判；沒有店名則以姓名視為有效。
        return !reportStore || !item.store || reportStore === item.store;
      }
      return false;
    });
  };

  const monthRange = (yearMonth) => {
    const [year, month] = String(yearMonth || todayMonth()).split("-").map(Number);
    const last = new Date(year, month, 0).getDate();
    return {
      startDate: `${year}-${String(month).padStart(2, "0")}-01`,
      endDate: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
    };
  };

  const pushIssue = (issues, label, count, severity = "warning", hint = "", details = []) => {
    if (!count) return;
    issues.push({ label, count, severity, hint, details: Array.isArray(details) ? details : [] });
  };

  const makeHealthDetail = ({ collectionName, docId, data = {}, reason = "", fields = [] }) => ({
    id: docId || "-",
    collectionName: collectionName || "-",
    date: data.date || "-",
    store: getStoreName(data) || "-",
    therapist: getTherapistName(data) || "-",
    reason,
    fields,
  });

  const addMaintenanceLog = async (payload) => {
    try {
      await addDoc(getCollectionPath("maintenance_logs"), {
        brandId,
        brandLabel,
        operator: currentUser?.name || "director",
        operatorRole: userRole || "director",
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
        ...payload,
      });
    } catch (error) {
      console.warn("maintenance log write failed", error);
    }
  };

  const getQueueYearMonth = (row = {}) => {
    const raw = row.affectedYearMonth || row.yearMonth || String(row.date || row.sourceDate || "").slice(0, 7);
    return /^\d{4}-\d{2}$/.test(String(raw || "")) ? String(raw) : "未知月份";
  };

  const summarizeRecalcQueueRows = (rows = []) => {
    const groups = {};
    rows.forEach((row) => {
      const month = getQueueYearMonth(row);
      if (!groups[month]) {
        groups[month] = {
          month,
          count: 0,
          storeCount: 0,
          therapistCount: 0,
          sources: new Set(),
          reasons: new Set(),
          latestAt: "",
          items: [],
        };
      }
      const group = groups[month];
      group.count += 1;
      if (row.sourceType === "daily_reports") group.storeCount += 1;
      if (row.sourceType === "therapist_daily_reports") group.therapistCount += 1;
      if (row.sourceType) group.sources.add(row.sourceType);
      if (row.reason) group.reasons.add(row.reason);
      const t = row.createdAtText || row.updatedAtText || row.createdAt || "";
      if (!group.latestAt || String(t) > String(group.latestAt)) group.latestAt = t;
      group.items.push(row);
    });

    return Object.values(groups)
      .map((group) => ({
        ...group,
        sources: Array.from(group.sources),
        reasons: Array.from(group.reasons),
      }))
      .sort((a, b) => String(b.month).localeCompare(String(a.month)));
  };

  const loadPendingRecalcQueueRows = async () => {
    try {
      const q = query(getCollectionPath("recalc_queue"), where("status", "==", "pending"), limit(500));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
      // 若使用者資料庫尚未建立索引或舊資料沒有 status，退回讀取前 500 筆後在前端過濾，避免功能完全失效。
      console.warn("pending recalc_queue query failed, fallback to collection scan", error);
      const snap = await getDocs(query(getCollectionPath("recalc_queue"), limit(500)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => !row.status || row.status === "pending");
    }
  };

  const handleLoadRecalcQueue = async () => {
    setLoadingAction("loadRecalcQueue");
    setLogs([]);
    addLog(`🧭 載入 ${brandLabel} 待重新校準月份...`);
    try {
      const rows = await loadPendingRecalcQueueRows();
      const groups = summarizeRecalcQueueRows(rows);
      setRecalcQueueGroups(groups);
      setRecalcQueueTotal(rows.length);
      addLog(`✅ 已載入 ${rows.length.toLocaleString()} 筆待重算紀錄，彙整為 ${groups.length.toLocaleString()} 個月份。`);
      showToast(groups.length ? `已載入 ${groups.length} 個待重算月份` : "目前沒有待重新校準月份", groups.length ? "success" : "info");
    } catch (error) {
      console.error(error);
      addLog(`❌ 載入待重算月份失敗: ${error.message}`);
      showToast("載入待重算月份失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const markRecalcQueueCompleted = async (month, rows = [], resultText = "") => {
    const targetRows = rows.length ? rows : (await loadPendingRecalcQueueRows()).filter((row) => getQueueYearMonth(row) === month);
    if (targetRows.length === 0) return 0;

    let batch = writeBatch(db);
    let pendingWrites = 0;
    let updated = 0;

    for (const row of targetRows) {
      if (!row.id) continue;
      batch.update(doc(getCollectionPath("recalc_queue"), row.id), {
        status: "completed",
        completedAt: serverTimestamp(),
        completedAtText: new Date().toISOString(),
        completedBy: currentUser?.name || "director",
        calibrationResult: resultText ? String(resultText).slice(0, 500) : "completed",
      });
      pendingWrites += 1;
      updated += 1;
      if (pendingWrites >= 450) {
        await batch.commit();
        batch = writeBatch(db);
        pendingWrites = 0;
      }
    }

    if (pendingWrites > 0) await batch.commit();
    return updated;
  };

  const handleCalibrateRecalcMonth = async (group) => {
    const month = group?.month;
    if (!month || month === "未知月份") return showToast("此月份格式異常，無法校準", "error");
    if (!window.confirm(`確定要重新校準 ${month} 嗎？\n\n將呼叫月度校準，完成後會把此月份 ${group.count.toLocaleString()} 筆 recalc_queue 標記為 completed。`)) return;

    setLoadingAction(`calibrateQueue_${month}`);
    setLogs([]);
    addLog(`🔄 啟動待重算月份校準：${brandId}｜${month}`);
    try {
      await addMaintenanceLog({ type: "recalc_queue", action: "start_recalc_queue_calibration", month, status: "started", queueCount: group.count });
      const response = await fetch(`https://recalculatemonthlydata-hyhcwrnyaa-uc.a.run.app?brandId=${brandId}&yearMonth=${month}`);
      if (!response.ok) throw new Error("伺服器回應異常");
      const result = await response.text();
      addLog(result);

      const completedCount = await markRecalcQueueCompleted(month, group.items || [], result);
      await addDoc(getCollectionPath("calibration_logs"), {
        brandId,
        brandLabel,
        month,
        status: "success",
        source: "recalc_queue",
        queueCount: group.count,
        completedQueueCount: completedCount,
        resultText: result,
        operator: currentUser?.name || "director",
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
      });
      await addMaintenanceLog({ type: "recalc_queue", action: "finish_recalc_queue_calibration", month, status: "success", queueCount: group.count, completedQueueCount: completedCount });

      setRecalcQueueGroups((prev) => prev.filter((item) => item.month !== month));
      setRecalcQueueTotal((prev) => Math.max(0, prev - completedCount));
      showToast(`${month} 已重新校準，${completedCount.toLocaleString()} 筆待重算紀錄已完成`, "success");
    } catch (error) {
      console.error(error);
      addLog(`❌ 待重算月份校準失敗: ${error.message}`);
      await addMaintenanceLog({ type: "recalc_queue", action: "fail_recalc_queue_calibration", month, status: "failed", errorMessage: error.message, queueCount: group.count });
      showToast("待重算月份校準失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const getMonthDates = (yearMonth) => {
    const [year, month] = String(yearMonth || "").split("-").map(Number);
    if (!year || !month) return [];
    const dates = [];
    const cursor = new Date(year, month - 1, 1);
    const today = new Date();
    const end = new Date(year, month, 0);
    const finalDay = cursor.getFullYear() === today.getFullYear() && cursor.getMonth() === today.getMonth() ? today : end;
    while (cursor <= finalDay) {
      dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`);
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  };

  const getOrgStructureProfile = async () => {
    const snap = await getDoc(getDocPath("org_structure"));
    const managers = snap.exists() ? snap.data()?.managers || {} : {};
    const storeOwner = {};
    const duplicateStores = [];
    Object.entries(managers || {}).forEach(([managerName, stores]) => {
      (Array.isArray(stores) ? stores : []).filter(Boolean).forEach((store) => {
        const core = normalizeCoreName(store);
        if (!core) return;
        if (storeOwner[core] && storeOwner[core] !== managerName) {
          duplicateStores.push({ store: core, owners: [storeOwner[core], managerName] });
        }
        storeOwner[core] = managerName;
      });
    });
    return {
      managers,
      stores: Object.keys(storeOwner),
      storeSet: new Set(Object.keys(storeOwner)),
      duplicateStores,
      unassignedStores: (Array.isArray(managers["未分配"]) ? managers["未分配"] : []).map(normalizeCoreName).filter(Boolean),
    };
  };

  const getAllStoresFromOrg = async () => {
    try {
      const profile = await getOrgStructureProfile();
      return profile.stores;
    } catch {
      return [];
    }
  };
  const getAuditExclusionProfile = async () => {
    try {
      const snap = await getDoc(getDocPath("audit_exclusions"));
      const data = snap.exists() ? snap.data() || {} : {};

      // 回報檢核中心目前以 { stores: [...] } 儲存排除店家；
      // 這裡同時相容物件格式，避免舊資料或手動編輯造成讀不到。
      let rawStores = [];
      if (Array.isArray(data.stores)) rawStores = data.stores;
      else if (data.stores && typeof data.stores === "object") rawStores = Object.keys(data.stores).filter((key) => data.stores[key]);
      else if (Array.isArray(data.excludedStores)) rawStores = data.excludedStores;
      else if (Array.isArray(data.storeNames)) rawStores = data.storeNames;

      const storeCoreList = [...new Set(rawStores.map(normalizeCoreName).filter(Boolean))];
      return {
        rawStores,
        storeCoreList,
        storeCoreSet: new Set(storeCoreList),
      };
    } catch (error) {
      console.warn("audit exclusions load failed", error);
      return { rawStores: [], storeCoreList: [], storeCoreSet: new Set() };
    }
  };


  useEffect(() => {
    const refreshLocalStats = () => setLocalReadStats(getReadTrackerStats());
    refreshLocalStats();
    const timer = setInterval(refreshLocalStats, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadReadTrackerConfig = async () => {
      try {
        const snap = await getDoc(getDocPath("read_tracker_config"));
        const data = snap.exists() ? snap.data() : {};
        const config = {
          mode: data.mode || getReadTrackerMode(),
          scheduleEnabled: Boolean(data.scheduleEnabled),
          scheduleMode: data.scheduleMode || "global",
          startTime: data.startTime || "19:00",
          endTime: data.endTime || "07:00",
          timezone: data.timezone || "Asia/Taipei",
        };
        const effectiveMode = resolveReadTrackerModeFromConfig(config);
        setReadTrackerConfig(config);
        setScheduleForm({ scheduleEnabled: config.scheduleEnabled, startTime: config.startTime, endTime: config.endTime });
        setReadTrackerMode(effectiveMode);
        setReadTrackerModeState(effectiveMode);
      } catch (error) {
        console.warn("讀取追蹤設定載入失敗：", error);
      }
    };
    loadReadTrackerConfig();
  }, [currentBrand?.id, getDocPath]);

  const scheduleStatus = useMemo(() => getReadTrackerScheduleStatus({ ...readTrackerConfig, ...scheduleForm, scheduleMode: "global" }), [readTrackerConfig, scheduleForm]);

  const readStatsRows = useMemo(() => Object.entries(localReadStats || {})
    .map(([label, item]) => ({ label, docs: item.docs || 0, triggers: item.triggers || 0, avg: item.triggers ? Math.round((item.docs || 0) / item.triggers) : 0, lastAt: item.lastAt || "-" }))
    .sort((a, b) => b.docs - a.docs), [localReadStats]);

  const SectionTitle = ({ eyebrow, title, desc, icon: Icon }) => (
    <div>
      {eyebrow && <p className="text-[11px] font-black tracking-[0.28em] text-[#B7863D] uppercase">{eyebrow}</p>}
      <h2 className="mt-1 text-2xl font-black text-stone-800 tracking-tight flex items-center gap-2">
        {Icon && <Icon size={22} className="text-[#B7863D]" strokeWidth={1.8} />}
        {title}
      </h2>
      {desc && <p className="mt-1 text-sm font-bold text-stone-400 leading-relaxed">{desc}</p>}
    </div>
  );

  const BeautyButton = ({ children, onClick, disabled, variant = "primary", className = "", type = "button" }) => {
    const styles = variant === "primary"
      ? "border border-amber-200 bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] shadow-[0_10px_24px_rgba(190,145,70,0.16)] hover:brightness-[1.02]"
      : variant === "danger"
      ? "border border-rose-100 bg-white text-rose-500 hover:bg-rose-50"
      : variant === "soft"
      ? "border border-amber-100 bg-amber-50/70 text-amber-700 hover:bg-amber-50"
      : "border border-stone-200 bg-white text-stone-500 hover:bg-stone-50 hover:text-stone-700";
    return <button type={type} onClick={onClick} disabled={disabled} className={`h-11 px-5 rounded-2xl text-xs font-black transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${styles} ${className}`}>{children}</button>;
  };

  const SoftInput = ({ className = "", ...props }) => <input {...props} className={`h-11 px-3 rounded-2xl bg-white/90 border border-stone-200 text-sm font-black text-stone-700 outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-50 transition-all ${className}`} />;

  const ToolRow = ({ icon: Icon, title, desc, badge, children, tone = "amber" }) => {
    const toneClass = tone === "emerald" ? "text-emerald-600 bg-emerald-50 border-emerald-100" : tone === "rose" ? "text-rose-500 bg-rose-50 border-rose-100" : "text-[#B7863D] bg-amber-50 border-amber-100";
    return (
      <div className="rounded-[1.75rem] border border-[#EFE3D0] bg-white/90 p-5 shadow-[0_16px_50px_rgba(120,90,40,0.04)]">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${toneClass}`}><Icon size={21} strokeWidth={1.7} /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-black text-stone-800 tracking-tight">{title}</h3>
                {badge && <span className="px-2 py-1 rounded-full bg-amber-50 text-[#B7863D] border border-amber-100 text-[10px] font-black">{badge}</span>}
              </div>
              <p className="mt-1 text-xs font-bold text-stone-400 leading-relaxed">{desc}</p>
            </div>
          </div>
          <div className="lg:shrink-0 flex flex-col md:flex-row gap-2 md:items-center">{children}</div>
        </div>
      </div>
    );
  };

  const renderStatList = ({ rows, emptyIcon: EmptyIcon, emptyText, valueClass = "text-[#B7863D]" }) => (
    <div className="p-4">
      {rows.length === 0 ? (
        <div className="h-48 flex flex-col items-center justify-center text-stone-300 gap-2"><EmptyIcon size={32} /><p className="text-xs font-black tracking-widest">{emptyText}</p></div>
      ) : (
        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
          {rows.slice(0, 12).map((row, index) => (
            <div key={row.label} className="bg-white rounded-2xl border border-stone-100 p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="w-7 h-7 rounded-xl bg-amber-50 text-[#B7863D] text-[11px] font-black flex items-center justify-center border border-amber-100">{index + 1}</span><p className="text-xs font-black text-stone-700 truncate">{row.label}</p></div>
                <p className="text-[10px] text-stone-400 mt-1 ml-9">觸發 {row.triggers.toLocaleString()} 次｜平均 {row.avg.toLocaleString()} docs / 次</p>
              </div>
              <div className="text-right shrink-0"><p className={`text-sm font-black ${valueClass}`}>{row.docs.toLocaleString()}</p><p className="text-[10px] text-stone-400">docs</p></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // 讀取來源追蹤
  const handleChangeReadTrackerMode = async (mode) => {
    try {
      const nextConfig = { ...readTrackerConfig, mode, brandId, brandLabel, updatedAt: serverTimestamp(), updatedAtText: new Date().toISOString(), updatedBy: currentUser?.name || "director" };
      await setDoc(getDocPath("read_tracker_config"), nextConfig, { merge: true });
      const effectiveMode = resolveReadTrackerModeFromConfig(nextConfig);
      setReadTrackerConfig((prev) => ({ ...prev, mode }));
      setReadTrackerMode(effectiveMode);
      setReadTrackerModeState(effectiveMode);
      showToast(mode === "off" ? "讀取來源追蹤已切換為關閉" : mode === "local" ? "已切換為本機模式" : "已切換為全域上報模式", mode === "off" ? "info" : "success");
    } catch (error) {
      console.error(error);
      showToast("追蹤模式儲存失敗，請檢查資料庫權限", "error");
    }
  };

  const handleSaveReadTrackerSchedule = async () => {
    try {
      const nextConfig = { ...readTrackerConfig, scheduleEnabled: Boolean(scheduleForm.scheduleEnabled), scheduleMode: "global", startTime: scheduleForm.startTime || "19:00", endTime: scheduleForm.endTime || "07:00", timezone: "Asia/Taipei", brandId, brandLabel, updatedAt: serverTimestamp(), updatedAtText: new Date().toISOString(), updatedBy: currentUser?.name || "director" };
      await setDoc(getDocPath("read_tracker_config"), nextConfig, { merge: true });
      const effectiveMode = resolveReadTrackerModeFromConfig(nextConfig);
      setReadTrackerConfig(nextConfig);
      setReadTrackerMode(effectiveMode);
      setReadTrackerModeState(effectiveMode);
      showToast(nextConfig.scheduleEnabled ? `排程已儲存：${nextConfig.startTime}～${nextConfig.endTime} 自動全域上報` : "排程已停用", "success");
    } catch (error) {
      console.error(error);
      showToast("排程設定儲存失敗", "error");
    }
  };

  const handleApplyScheduleNow = () => {
    const effectiveMode = resolveReadTrackerModeFromConfig({ ...readTrackerConfig, ...scheduleForm, scheduleMode: "global" });
    setReadTrackerMode(effectiveMode);
    setReadTrackerModeState(effectiveMode);
    showToast(`已依目前時間套用排程：${effectiveMode}`, "info");
  };

  const handleClearReadTracker = () => {
    if (!window.confirm("確定要清除目前這台裝置的讀取追蹤統計嗎？")) return;
    clearReadTrackerStats();
    setLocalReadStats({});
    showToast("本機讀取統計已清除", "success");
  };

  const handleManualFlushReadTracker = async () => {
    setLoadingReadStats(true);
    try {
      const result = await flushReadTrackerToFirestore({ db, brandId, brandLabel, userRole, userName: "maintenance_user", activeView: "system_maintenance", force: true });
      if (result.skipped) showToast(`未上報：${result.reason}`, "info");
      else { showToast(`已上報 ${result.totalReadDocs.toLocaleString()} docs`, "success"); setLocalReadStats(getReadTrackerStats()); }
    } catch (error) { console.error(error); showToast("手動上報失敗", "error"); }
    finally { setLoadingReadStats(false); }
  };

  const normalizeSourcesFromRow = (row) => {
    if (row.sources && typeof row.sources === "object") return row.sources;
    const parsed = {};
    Object.entries(row || {}).forEach(([key, value]) => {
      if (!key.startsWith("sources.")) return;
      const parts = key.split(".");
      const label = parts[1];
      const field = parts[2];
      if (!label || !field) return;
      if (!parsed[label]) parsed[label] = {};
      parsed[label][field] = value;
    });
    return parsed;
  };

  const handleLoadGlobalReadStats = async () => {
    setLoadingReadStats(true);
    try {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const yesterdayObj = new Date(now); yesterdayObj.setDate(yesterdayObj.getDate() - 1);
      const yesterday = yesterdayObj.toISOString().slice(0, 10);
      const [todaySnap, yesterdaySnap] = await Promise.all([
        getDocs(query(collection(db, "read_debug_sessions"), where("date", "==", today), limit(300))),
        getDocs(query(collection(db, "read_debug_sessions"), where("date", "==", yesterday), limit(300))),
      ]);
      const rows = [...todaySnap.docs.map((d) => ({ id: d.id, ...d.data() })), ...yesterdaySnap.docs.map((d) => ({ id: d.id, ...d.data() }))];
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const recentRows = rows.filter((row) => {
        const t = row.updatedAtText ? new Date(row.updatedAtText).getTime() : 0;
        const isSameBrand = !brandId || !row.brandId || row.brandId === brandId;
        return t >= since && isSameBrand;
      });
      const sourceSummary = {};
      recentRows.forEach((row) => {
        Object.entries(normalizeSourcesFromRow(row) || {}).forEach(([label, item]) => {
          if (!sourceSummary[label]) sourceSummary[label] = { label, docs: 0, triggers: 0, users: new Set(), roles: new Set(), devices: new Set(), lastAt: "" };
          sourceSummary[label].docs += Number(item.docs || 0);
          sourceSummary[label].triggers += Number(item.triggers || 0);
          sourceSummary[label].users.add(row.userName || row.userRole || "unknown");
          sourceSummary[label].roles.add(row.userRole || "unknown");
          sourceSummary[label].devices.add(row.device || "unknown");
          if (!sourceSummary[label].lastAt || item.lastAt > sourceSummary[label].lastAt) sourceSummary[label].lastAt = item.lastAt;
        });
      });
      const summaryRows = Object.values(sourceSummary).map((item) => ({ ...item, users: item.users.size, roles: Array.from(item.roles), devices: Array.from(item.devices), avg: item.triggers ? Math.round(item.docs / item.triggers) : 0 })).sort((a, b) => b.docs - a.docs);
      setGlobalReadStats(summaryRows);
      setGlobalRowsCount(recentRows.length);
      showToast(summaryRows.length === 0 ? "近 24 小時尚未找到可彙整的全域追蹤資料" : `已載入近 24 小時排行，共 ${summaryRows.length} 個來源`, summaryRows.length === 0 ? "info" : "success");
    } catch (error) { console.error(error); showToast("讀取全域追蹤失敗，請確認 read_debug_sessions 權限或資料是否存在", "error"); }
    finally { setLoadingReadStats(false); }
  };

  // 新增工具：資料健康檢查
  const handleRunDataHealthCheck = async () => {
    const { startDate, endDate } = monthRange(calMonth);
    setLoadingAction("healthCheck");
    setLogs([]);
    setExpandedHealthIssue("");
    addLog(`🩺 啟動 ${brandLabel} 資料健康檢查... 範圍：${calMonth}`);

    try {
      const orgProfile = await getOrgStructureProfile();
      const exclusionProfile = await getAuditExclusionProfile();
      const therapistSnap = await getDocs(getCollectionPath("therapists"));
      const therapistProfiles = therapistSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const therapistMatchers = buildTherapistMatchers(therapistProfiles);
      const activeTherapists = therapistProfiles.filter((t) => isTherapistValidOnDate(t, endDate));

      const issues = [];
      let scanned = 0;
      const issueDetails = {};
      const addIssueDetail = (key, detail, max = 30) => {
        if (!issueDetails[key]) issueDetails[key] = [];
        if (issueDetails[key].length < max) issueDetails[key].push(detail);
      };

      orgProfile.duplicateStores.forEach((item) => addIssueDetail("org_duplicate", {
        store: item.store || item.core || "-",
        reason: `重複歸屬：${(item.owners || []).join("、")}`,
      }));
      pushIssue(issues, "org_structure｜店家重複歸屬", orgProfile.duplicateStores.length, "danger", "同一店家不應同時存在於多個區長或未分配區塊", issueDetails.org_duplicate || []);

      const unassignedRequiredStores = orgProfile.unassignedStores.filter((store) => !exclusionProfile.storeCoreSet.has(normalizeCoreName(store)));
      unassignedRequiredStores.forEach((store) => addIssueDetail("org_unassigned", { store, reason: "位於未分配，建議重新指派區長" }));
      pushIssue(issues, "org_structure｜未分配店家", unassignedRequiredStores.length, "warning", "未分配店家仍會保留資料，但建議盡快重新指派區長；已列入回報檢核排除的店家不計入此提醒", issueDetails.org_unassigned || []);

      exclusionProfile.storeCoreList.forEach((store) => addIssueDetail("audit_exclusions", { store, reason: "已列入回報檢核排除，不列入缺報檢查" }));
      pushIssue(issues, "audit_exclusions｜排除店家", exclusionProfile.storeCoreList.length, "info", exclusionProfile.storeCoreList.join("、"), issueDetails.audit_exclusions || []);

      for (const colName of ["daily_reports", "therapist_daily_reports"]) {
        const snap = await getDocs(query(getCollectionPath(colName), where("date", ">=", startDate), where("date", "<=", endDate)));
        const row = {
          missingDate: 0,
          invalidDate: 0,
          missingStore: 0,
          unknownStore: 0,
          unknownTherapist: 0,
          duplicateActive: 0,
          negativeNumbers: 0,
          archivedDuplicates: 0,
        };
        const activeKeys = {};
        const activeKeyDocs = {};

        snap.docs.forEach((docSnap) => {
          scanned++;
          const data = docSnap.data();
          const date = data.date || "";
          const store = getStoreName(data);
          const storeCore = normalizeCoreName(store);
          const therapistName = String(getTherapistName(data) || "").trim();

          if (!date) {
            row.missingDate++;
            addIssueDetail(`${colName}_missingDate`, makeHealthDetail({ collectionName: colName, docId: docSnap.id, data, reason: "缺少日期欄位" }));
          } else if (!isValidYYYYMMDD(formatDateString(date))) {
            row.invalidDate++;
            addIssueDetail(`${colName}_invalidDate`, makeHealthDetail({ collectionName: colName, docId: docSnap.id, data, reason: `日期格式異常：${date}` }));
          }

          if (!storeCore) {
            row.missingStore++;
            addIssueDetail(`${colName}_missingStore`, makeHealthDetail({ collectionName: colName, docId: docSnap.id, data, reason: "缺少店名欄位" }));
          }
          else if (orgProfile.storeSet.size && !orgProfile.storeSet.has(storeCore) && !exclusionProfile.storeCoreSet.has(storeCore)) {
            row.unknownStore++;
            addIssueDetail(`${colName}_unknownStore`, makeHealthDetail({ collectionName: colName, docId: docSnap.id, data, reason: "店名無法對應 org_structure" }));
          }

          if (colName === "therapist_daily_reports" && therapistName && !isKnownTherapistReport(therapistMatchers, data)) {
            row.unknownTherapist++;
            addIssueDetail(`${colName}_unknownTherapist`, makeHealthDetail({ collectionName: colName, docId: docSnap.id, data, reason: "管理師姓名 / ID 無法對應該日期有效人員名單" }));
          }

          const negativeFields = getNegativeFields(data);
          row.negativeNumbers += negativeFields.length;
          if (negativeFields.length > 0) addIssueDetail(`${colName}_negativeNumbers`, makeHealthDetail({ collectionName: colName, docId: docSnap.id, data, reason: "此筆資料含負數欄位", fields: negativeFields }));
          if (data.isArchivedDuplicate === true) {
            row.archivedDuplicates++;
            addIssueDetail(`${colName}_archivedDuplicates`, makeHealthDetail({ collectionName: colName, docId: docSnap.id, data, reason: "已封存重複資料" }));
          }

          if (data.isArchivedDuplicate !== true) {
            const key = colName === "daily_reports"
              ? `${date || "無日期"}_${storeCore || "無店名"}`
              : `${date || "無日期"}_${storeCore || "無店名"}_${therapistName || "無管理師"}`;
            activeKeys[key] = (activeKeys[key] || 0) + 1;
            if (!activeKeyDocs[key]) activeKeyDocs[key] = [];
            activeKeyDocs[key].push(makeHealthDetail({ collectionName: colName, docId: docSnap.id, data, reason: "疑似重複有效資料" }));
          }
        });

        row.duplicateActive = Object.values(activeKeys).filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
        Object.entries(activeKeys).forEach(([key, count]) => {
          if (count > 1) (activeKeyDocs[key] || []).forEach((detail) => addIssueDetail(`${colName}_duplicateActive`, detail));
        });

        pushIssue(issues, `${colName}｜缺少日期`, row.missingDate, "danger", "", issueDetails[`${colName}_missingDate`] || []);
        pushIssue(issues, `${colName}｜日期格式異常`, row.invalidDate, "warning", "", issueDetails[`${colName}_invalidDate`] || []);
        pushIssue(issues, `${colName}｜缺少店名`, row.missingStore, "danger", "", issueDetails[`${colName}_missingStore`] || []);
        pushIssue(issues, `${colName}｜店名無對應 org_structure`, row.unknownStore, "danger", "", issueDetails[`${colName}_unknownStore`] || []);
        pushIssue(issues, `${colName}｜有效資料疑似重複`, row.duplicateActive, "danger", "", issueDetails[`${colName}_duplicateActive`] || []);
        pushIssue(issues, `${colName}｜負數欄位`, row.negativeNumbers, "warning", "請確認是否為退款 / 沖銷 / 修正；若不是，建議回原日報修正", issueDetails[`${colName}_negativeNumbers`] || []);
        pushIssue(issues, `${colName}｜已封存重複資料`, row.archivedDuplicates, "info", "", issueDetails[`${colName}_archivedDuplicates`] || []);
        if (colName === "therapist_daily_reports") pushIssue(issues, `${colName}｜管理師無對應在職名單`, row.unknownTherapist, "warning", "", issueDetails[`${colName}_unknownTherapist`] || []);

        addLog(`✅ ${colName}: 掃描 ${snap.size.toLocaleString()} 筆，異常/提醒 ${Object.values(row).reduce((a, b) => a + b, 0).toLocaleString()} 項。`);
      }

      const dangerCount = issues.filter((i) => i.severity === "danger").reduce((sum, i) => sum + i.count, 0);
      const warningCount = issues.filter((i) => i.severity === "warning").reduce((sum, i) => sum + i.count, 0);
      const status = dangerCount ? "danger" : warningCount ? "warning" : "pass";

      setHealthReport({
        month: calMonth,
        scanned,
        orgStores: orgProfile.stores.length,
        activeTherapists: activeTherapists.length,
        issues,
        status,
        createdAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      });

      await addMaintenanceLog({
        type: "data_health_check",
        action: "run_data_health_check",
        month: calMonth,
        scanned,
        issueTypes: issues.length,
        dangerCount,
        warningCount,
        status,
      });

      showToast(issues.length ? `健康檢查完成：${issues.length} 類提醒` : "健康檢查完成，未發現明顯異常", issues.length ? "info" : "success");
    } catch (error) {
      addLog(`❌ 健康檢查失敗: ${error.message}`);
      showToast("資料健康檢查失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  // 新增工具：月結前檢查
  const handleRunClosingCheck = async () => {
    const { startDate, endDate } = monthRange(calMonth);
    setLoadingAction("closingCheck");
    setLogs([]);
    addLog(`📅 啟動 ${calMonth} 月結前檢查...`);

    try {
      const monthDates = getMonthDates(calMonth);
      const orgProfile = await getOrgStructureProfile();
      const exclusionProfile = await getAuditExclusionProfile();
      const stores = orgProfile.stores.filter((store) => !exclusionProfile.storeCoreSet.has(normalizeCoreName(store)));

      const [dailySnap, therapistSnap, targetSnap, therapistListSnap] = await Promise.all([
        getDocs(query(getCollectionPath("daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate))),
        getDocs(query(getCollectionPath("therapist_daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate))),
        getDocs(getCollectionPath("monthly_targets")),
        getDocs(getCollectionPath("therapists")),
      ]);

      const dailyThisMonth = dailySnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.isArchivedDuplicate !== true);
      const therapistThisMonth = therapistSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.isArchivedDuplicate !== true);
      const archivedDaily = dailySnap.docs.filter((d) => d.data()?.isArchivedDuplicate === true).length;
      const archivedTherapist = therapistSnap.docs.filter((d) => d.data()?.isArchivedDuplicate === true).length;
      const therapistProfiles = therapistListSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const activeTherapists = therapistProfiles.filter((t) => isTherapistValidOnDate(t, endDate));

      const dailyKeys = new Set(dailyThisMonth.map((d) => `${d.date}_${normalizeCoreName(getStoreName(d))}`));
      const therapistKeys = new Set(therapistThisMonth.map((d) => `${d.date}_${normalizeCoreName(getStoreName(d))}_${normalizePersonName(getTherapistName(d))}`));
      const missingStoreReports = [];
      stores.forEach((store) => monthDates.forEach((date) => {
        const key = `${date}_${normalizeCoreName(store)}`;
        if (!dailyKeys.has(key)) missingStoreReports.push({ date, store });
      }));

      // 管理師日報不能用「所有在職管理師 × 每一天」硬算，否則休假 / 排班不同會大量誤判。
      // 目前先做安全版：只檢查已有報表的格式與重複，不把未排班的日子列為缺報。
      // 後續若要做到精準缺報，需要串接 therapist_schedules 的實際排班資料。
      const missingTherapistReports = [];

      const duplicateDailyCount = dailyThisMonth.length - new Set(dailyThisMonth.map((d) => `${d.date}_${normalizeCoreName(getStoreName(d))}`)).size;
      const duplicateTherapistCount = therapistThisMonth.length - new Set(therapistThisMonth.map((d) => `${d.date}_${normalizeCoreName(getStoreName(d))}_${normalizePersonName(getTherapistName(d))}`)).size;

      const targetMonthCount = targetSnap.docs.filter((d) => {
        const data = d.data() || {};
        const id = d.id || "";
        return id.includes(calMonth.replace("-", "_")) || id.includes(calMonth) || (String(data.year) === calMonth.slice(0, 4) && String(data.month).padStart(2, "0") === calMonth.slice(5, 7));
      }).length;

      const unassignedRequiredStores = orgProfile.unassignedStores.filter((store) => !exclusionProfile.storeCoreSet.has(normalizeCoreName(store)));
      const riskScore = missingStoreReports.length + missingTherapistReports.length + Math.max(0, duplicateDailyCount) + Math.max(0, duplicateTherapistCount) + orgProfile.duplicateStores.length + unassignedRequiredStores.length;
      const readiness = riskScore === 0 ? "可以月結" : riskScore < 10 ? "需注意" : "不建議月結";
      const warnings = [
        { label: "月結狀態", count: readiness === "可以月結" ? 0 : riskScore, neutral: readiness === "可以月結" },
        { label: "缺少店日報", count: missingStoreReports.length },
        { label: "缺少管理師日報", count: missingTherapistReports.length },
        { label: "疑似重複店日報", count: Math.max(0, duplicateDailyCount) },
        { label: "疑似重複管理師日報", count: Math.max(0, duplicateTherapistCount) },
        { label: "未分配店家", count: unassignedRequiredStores.length },
        { label: "排除店家", count: exclusionProfile.storeCoreList.length, neutral: true },
        { label: "店家重複歸屬", count: orgProfile.duplicateStores.length },
        { label: "本月目標文件數", count: targetMonthCount, neutral: targetMonthCount > 0 },
        { label: "本月封存資料", count: archivedDaily + archivedTherapist, neutral: true },
      ];

      setClosingReport({
        month: calMonth,
        readiness,
        checkedDays: monthDates.length,
        stores: stores.length,
        excludedStores: exclusionProfile.storeCoreList,
        excludedStoreCount: exclusionProfile.storeCoreList.length,
        activeTherapists: activeTherapists.length,
        dailyReports: dailyThisMonth.length,
        therapistReports: therapistThisMonth.length,
        targetsCount: targetMonthCount,
        archivedCount: archivedDaily + archivedTherapist,
        missingStoreReports: missingStoreReports.slice(0, 30),
        missingTherapistReports: missingTherapistReports.slice(0, 30),
        warnings,
        createdAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      });

      await addMaintenanceLog({ type: "month_closing_check", action: "run_month_closing_check", month: calMonth, readiness, riskScore, missingStoreReports: missingStoreReports.length, missingTherapistReports: missingTherapistReports.length, duplicateDailyCount: Math.max(0, duplicateDailyCount), duplicateTherapistCount: Math.max(0, duplicateTherapistCount), targetMonthCount, excludedStoreCount: exclusionProfile.storeCoreList.length });

      addLog(`✅ 月結前檢查完成：${readiness}。店日報 ${dailyThisMonth.length.toLocaleString()} 筆、管理師日報 ${therapistThisMonth.length.toLocaleString()} 筆。`);
      showToast(`月結前檢查完成：${readiness}`, readiness === "不建議月結" ? "error" : readiness === "需注意" ? "info" : "success");
    } catch (error) {
      addLog(`❌ 月結前檢查失敗: ${error.message}`);
      showToast("月結前檢查失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };


  // Dashboard Summary 重建工具：先產出 summary，不直接切換 Dashboard 讀取來源。
  const getReportMonthRange = (yearMonth) => {
    const [year, month] = String(yearMonth || "").split("-").map(Number);
    if (!year || !month) return null;
    const lastDay = new Date(year, month, 0).getDate();
    return {
      year,
      month,
      start: `${year}-${String(month).padStart(2, "0")}-01`,
      end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      daysInMonth: lastDay,
    };
  };

  const extractTargetYearMonth = (docId, data = {}) => {
    if (data.yearMonth && /^\d{4}-\d{2}$/.test(String(data.yearMonth))) return String(data.yearMonth);
    const y = data.year || data.targetYear;
    const m = data.month || data.targetMonth;
    if (y && m) return `${y}-${String(m).padStart(2, "0")}`;
    const id = String(docId || "");
    const match = id.match(/(20\d{2})[-_](\d{1,2})/);
    if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}`;
    return "";
  };

  const extractTargetStore = (docId, data = {}, yearMonth = "") => {
    const raw = data.storeName || data.store || data.storeId || data.shopName || data.shop || data.name || "";
    if (raw) return normalizeCoreName(raw);
    let id = String(docId || "");
    const [year, month] = String(yearMonth || "").split("-");
    if (year && month) {
      id = id
        .replace(new RegExp(`[_-]?${year}[_-]?${Number(month)}$`), "")
        .replace(new RegExp(`[_-]?${year}[_-]?${month}$`), "");
    }
    return normalizeCoreName(id);
  };

  const loadMonthlyTargetMap = async (yearMonth) => {
    const snap = await getDocs(getCollectionPath("monthly_targets"));
    const targetMap = {};
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const targetMonth = extractTargetYearMonth(docSnap.id, data);
      if (targetMonth && targetMonth !== yearMonth) return;
      const storeCore = extractTargetStore(docSnap.id, data, yearMonth);
      if (!storeCore) return;
      targetMap[storeCore] = {
        id: docSnap.id,
        cashTarget: Number(data.cashTarget || data.cash || data.budget || data.target || 0),
        accrualTarget: Number(data.accrualTarget || data.accrual || data.accrualBudget || 0),
        challengeCashTarget: Number(data.challengeCashTarget || data.challengeCash || data.challengeTarget || 0),
        challengeAccrualTarget: Number(data.challengeAccrualTarget || data.challengeAccrual || 0),
      };
    });
    return targetMap;
  };

  const buildDashboardSummaryPayloads = async (yearMonth) => {
    const range = getReportMonthRange(yearMonth);
    if (!range) throw new Error("月份格式錯誤");

    const orgProfile = await getOrgStructureProfile();
    const targets = await loadMonthlyTargetMap(yearMonth);
    const storeOwner = {};
    Object.entries(orgProfile.managers || {}).forEach(([managerName, stores]) => {
      (Array.isArray(stores) ? stores : []).forEach((store) => {
        const core = normalizeCoreName(store);
        if (core) storeOwner[core] = managerName;
      });
    });

    const [dailySnap, therapistSnap, therapistListSnap] = await Promise.all([
      getDocs(query(getCollectionPath("daily_reports"), where("date", ">=", range.start), where("date", "<=", range.end))),
      getDocs(query(getCollectionPath("therapist_daily_reports"), where("date", ">=", range.start), where("date", "<=", range.end))),
      getDocs(getCollectionPath("therapists")),
    ]);

    const dailyRows = dailySnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((row) => row.isArchivedDuplicate !== true);
    const therapistRows = therapistSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((row) => row.isArchivedDuplicate !== true);

    const brandPrefix = brandLabel === "安妞" || String(brandId).toLowerCase().includes("anniu") || String(brandId).toLowerCase().includes("anew")
      ? "安妞"
      : brandLabel === "伊啵" || String(brandId).toLowerCase().includes("yibo")
      ? "伊啵"
      : "CYJ";

    const dailyTotals = Array.from({ length: range.daysInMonth }, (_, i) => ({
      day: i + 1,
      date: `${range.month}/${i + 1}`,
      cash: 0,
      traffic: 0,
    }));

    const storeMap = {};
    const managerMap = {};
    const ensureStore = (storeCore) => {
      if (!storeMap[storeCore]) {
        const manager = storeOwner[storeCore] || "未分配";
        storeMap[storeCore] = {
          store: storeCore,
          displayName: `${brandPrefix}${storeCore}店`,
          manager,
          cash: 0,
          accrual: 0,
          operationalAccrual: 0,
          skincareSales: 0,
          traffic: 0,
          newCustomers: 0,
          newCustomerClosings: 0,
          newCustomerSales: 0,
          refund: 0,
          skincareRefund: 0,
          budget: 0,
          accrualBudget: 0,
          challengeBudget: 0,
          challengeAccrualBudget: 0,
          achievement: 0,
          rank: 0,
        };
      }
      return storeMap[storeCore];
    };

    const grand = {
      cash: 0,
      accrual: 0,
      operationalAccrual: 0,
      skincareSales: 0,
      traffic: 0,
      newCustomers: 0,
      newCustomerClosings: 0,
      newCustomerSales: 0,
      refund: 0,
      skincareRefund: 0,
      budget: 0,
      accrualBudget: 0,
      challengeBudget: 0,
      challengeAccrualBudget: 0,
      totalAchievement: 0,
      totalAccrualAchievement: 0,
      challengeAchievement: 0,
      challengeAccrualAchievement: 0,
      projection: 0,
      accrualProjection: 0,
    };

    dailyRows.forEach((row) => {
      const storeCore = normalizeCoreName(getStoreName(row));
      if (!storeCore) return;
      const store = ensureStore(storeCore);
      const cash = (Number(row.cash) || 0) - (Number(row.refund) || 0);
      const operationalAccrual = Number(row.operationalAccrual) || 0;
      const skincareSales = Number(row.skincareSales) || 0;
      const accrual = brandPrefix === "安妞" ? operationalAccrual : Number(row.accrual) || 0;
      const traffic = Number(row.traffic) || 0;
      const newCustomers = Number(row.newCustomers) || 0;
      const newCustomerClosings = Number(row.newCustomerClosings) || 0;
      const newCustomerSales = Number(row.newCustomerSales) || 0;
      const refund = Number(row.refund) || 0;
      const skincareRefund = Number(row.skincareRefund) || 0;

      store.cash += cash;
      store.accrual += accrual;
      store.operationalAccrual += operationalAccrual;
      store.skincareSales += skincareSales;
      store.traffic += traffic;
      store.newCustomers += newCustomers;
      store.newCustomerClosings += newCustomerClosings;
      store.newCustomerSales += newCustomerSales;
      store.refund += refund;
      store.skincareRefund += skincareRefund;

      grand.cash += cash;
      grand.accrual += accrual;
      grand.operationalAccrual += operationalAccrual;
      grand.skincareSales += skincareSales;
      grand.traffic += traffic;
      grand.newCustomers += newCustomers;
      grand.newCustomerClosings += newCustomerClosings;
      grand.newCustomerSales += newCustomerSales;
      grand.refund += refund;
      grand.skincareRefund += skincareRefund;

      const day = Number(String(row.date || "").slice(8, 10));
      if (day && dailyTotals[day - 1]) {
        dailyTotals[day - 1].cash += cash;
        dailyTotals[day - 1].traffic += traffic;
      }
    });

    Object.keys({ ...storeOwner, ...storeMap, ...targets }).forEach((storeCore) => {
      if (!storeCore) return;
      const store = ensureStore(storeCore);
      const target = targets[storeCore];
      if (target) {
        store.budget = Number(target.cashTarget || 0);
        store.accrualBudget = Number(target.accrualTarget || 0);
        store.challengeBudget = Number(target.challengeCashTarget || 0) || store.budget;
        store.challengeAccrualBudget = Number(target.challengeAccrualTarget || 0) || store.accrualBudget;
      }
      store.achievement = store.budget > 0 ? (store.cash / store.budget) * 100 : 0;
      grand.budget += store.budget;
      grand.accrualBudget += store.accrualBudget;
      grand.challengeBudget += store.challengeBudget;
      grand.challengeAccrualBudget += store.challengeAccrualBudget;
    });

    grand.totalAchievement = grand.budget > 0 ? (grand.cash / grand.budget) * 100 : 0;
    grand.totalAccrualAchievement = grand.accrualBudget > 0 ? (grand.accrual / grand.accrualBudget) * 100 : 0;
    grand.challengeAchievement = grand.challengeBudget > 0 ? (grand.cash / grand.challengeBudget) * 100 : 0;
    grand.challengeAccrualAchievement = grand.challengeAccrualBudget > 0 ? (grand.accrual / grand.challengeAccrualBudget) * 100 : 0;

    const storeRanking = Object.values(storeMap).sort((a, b) => b.cash - a.cash).map((store, index) => ({ ...store, rank: index + 1 }));
    storeRanking.forEach((store) => { storeMap[store.store].rank = store.rank; });

    Object.entries(orgProfile.managers || {}).forEach(([managerName, stores]) => {
      if (managerName === "未分配") return;
      managerMap[managerName] = {
        manager: managerName,
        stores: (Array.isArray(stores) ? stores : []).map(normalizeCoreName).filter(Boolean),
        cash: 0,
        accrual: 0,
        budget: 0,
        achievement: 0,
        rank: 0,
      };
    });
    Object.values(storeMap).forEach((store) => {
      const managerName = store.manager || "未分配";
      if (!managerMap[managerName]) managerMap[managerName] = { manager: managerName, stores: [], cash: 0, accrual: 0, budget: 0, achievement: 0, rank: 0 };
      if (!managerMap[managerName].stores.includes(store.store)) managerMap[managerName].stores.push(store.store);
      managerMap[managerName].cash += store.cash;
      managerMap[managerName].accrual += store.accrual;
      managerMap[managerName].budget += store.budget;
    });
    Object.values(managerMap).forEach((manager) => { manager.achievement = manager.budget > 0 ? (manager.cash / manager.budget) * 100 : 0; });
    Object.values(managerMap).sort((a, b) => b.cash - a.cash).forEach((manager, index) => { manager.rank = index + 1; });

    const storeRevenueByDate = (date) => Object.values(dailyRows.reduce((acc, row) => {
      if (row.date !== date) return acc;
      const storeCore = normalizeCoreName(getStoreName(row));
      if (!storeCore) return acc;
      if (!acc[storeCore]) acc[storeCore] = { store: storeCore, name: `${brandPrefix}${storeCore}店`, revenue: 0, manager: storeOwner[storeCore] || "未分配" };
      acc[storeCore].revenue += (Number(row.cash) || 0) - (Number(row.refund) || 0);
      return acc;
    }, {})).sort((a, b) => b.revenue - a.revenue).slice(0, 3);

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

    const therapistMaster = {};
    therapistListSnap.docs.forEach((d) => {
      const data = d.data() || {};
      therapistMaster[d.id] = { id: d.id, name: data.name || "", store: normalizeCoreName(data.store || data.storeName || ""), status: data.status || "" };
    });

    const therapistMap = {};
    therapistRows.forEach((row) => {
      const id = row.therapistId || row.id || normalizePersonName(row.therapistName);
      if (!id) return;
      const storeCore = normalizeCoreName(getStoreName(row));
      if (!therapistMap[id]) {
        therapistMap[id] = {
          id,
          name: therapistMaster[id]?.name || row.therapistName || "未命名",
          store: storeCore,
          storeDisplay: storeCore ? `${storeCore}店` : "未知店",
          manager: storeOwner[storeCore] || "未分配",
          totalRevenue: 0,
          serviceCount: 0,
          newCustomerRevenue: 0,
          oldCustomerRevenue: 0,
          newCustomerCount: 0,
          oldCustomerCount: 0,
          newCustomerClosings: 0,
          returnRevenue: 0,
          newClosingRate: 0,
          newAsp: 0,
          oldAsp: 0,
          rank: 0,
          status: "NORMAL",
        };
      }
      const t = therapistMap[id];
      t.totalRevenue += Number(row.totalRevenue) || 0;
      t.serviceCount += Number(row.serviceCount) || 0;
      t.newCustomerRevenue += Number(row.newCustomerRevenue) || 0;
      t.oldCustomerRevenue += Number(row.oldCustomerRevenue) || 0;
      t.newCustomerCount += Number(row.newCustomerCount) || 0;
      t.oldCustomerCount += Number(row.oldCustomerCount) || 0;
      t.newCustomerClosings += Number(row.newCustomerClosings) || 0;
      t.returnRevenue += Number(row.returnRevenue) || 0;
    });

    const therapistRankings = Object.values(therapistMap).sort((a, b) => b.totalRevenue - a.totalRevenue);
    therapistRankings.forEach((item, index) => {
      item.rank = index + 1;
      item.totalPeers = therapistRankings.length;
      item.status = item.rank <= 3 ? "TOP" : item.rank > therapistRankings.length - 10 ? "DANGER" : "NORMAL";
      item.newClosingRate = item.newCustomerCount > 0 ? (item.newCustomerClosings / item.newCustomerCount) * 100 : 0;
      item.newAsp = item.newCustomerCount > 0 ? item.newCustomerRevenue / item.newCustomerCount : 0;
      item.oldAsp = item.oldCustomerCount > 0 ? item.oldCustomerRevenue / item.oldCustomerCount : 0;
    });

    const therapistGrand = therapistRankings.reduce((acc, item) => {
      acc.totalRevenue += item.totalRevenue;
      acc.serviceCount += item.serviceCount;
      acc.newCustomerRevenue += item.newCustomerRevenue;
      acc.oldCustomerRevenue += item.oldCustomerRevenue;
      acc.newCustomerCount += item.newCustomerCount;
      acc.oldCustomerCount += item.oldCustomerCount;
      acc.newCustomerClosings += item.newCustomerClosings;
      acc.returnRevenue += item.returnRevenue;
      return acc;
    }, { totalRevenue: 0, serviceCount: 0, newCustomerRevenue: 0, oldCustomerRevenue: 0, newCustomerCount: 0, oldCustomerCount: 0, newCustomerClosings: 0, returnRevenue: 0, count: therapistRankings.length });
    therapistGrand.regionalNewClosingRate = therapistGrand.newCustomerCount > 0 ? (therapistGrand.newCustomerClosings / therapistGrand.newCustomerCount) * 100 : 0;
    therapistGrand.regionalNewAsp = therapistGrand.newCustomerCount > 0 ? therapistGrand.newCustomerRevenue / therapistGrand.newCustomerCount : 0;

    const topTherapistsByDate = (date) => Object.values(therapistRows.reduce((acc, row) => {
      if (row.date !== date) return acc;
      const id = row.therapistId || normalizePersonName(row.therapistName);
      if (!id) return acc;
      if (!acc[id]) acc[id] = { id, name: therapistMaster[id]?.name || row.therapistName || "未命名", storeDisplay: `${normalizeCoreName(getStoreName(row))}店`, revenue: 0 };
      acc[id].revenue += Number(row.totalRevenue) || 0;
      return acc;
    }, {})).sort((a, b) => b.revenue - a.revenue).slice(0, 3);

    const dashboardSummary = {
      brandId,
      brandLabel,
      brandPrefix,
      yearMonth,
      monthStart: range.start,
      monthEnd: range.end,
      grandTotal: grand,
      stores: storeMap,
      storeRankings: storeRanking,
      managers: managerMap,
      dailyTotals,
      storeTop3: {
        today: storeRevenueByDate(todayStr),
        yesterday: storeRevenueByDate(yesterdayStr),
        monthly: storeRanking.slice(0, 3).map((s) => ({ name: s.displayName, store: s.store, revenue: s.cash, manager: s.manager })),
      },
      sourceCounts: { dailyReports: dailyRows.length, targetStores: Object.keys(targets).length, stores: Object.keys(storeMap).length },
      lastUpdatedAt: serverTimestamp(),
      lastUpdatedAtText: new Date().toISOString(),
      source: "maintenance_summary_rebuild",
      version: "dashboard-summary-v1",
    };

    const therapistSummary = {
      brandId,
      brandLabel,
      yearMonth,
      monthStart: range.start,
      monthEnd: range.end,
      grandTotal: therapistGrand,
      rankings: therapistRankings,
      todayTop3: topTherapistsByDate(todayStr),
      yesterdayTop3: topTherapistsByDate(yesterdayStr),
      monthlyTop5: therapistRankings.slice(0, 5),
      sourceCounts: { therapistReports: therapistRows.length, therapists: therapistRankings.length },
      lastUpdatedAt: serverTimestamp(),
      lastUpdatedAtText: new Date().toISOString(),
      source: "maintenance_summary_rebuild",
      version: "therapist-summary-v1",
    };

    const rankingsSummary = {
      brandId,
      brandLabel,
      yearMonth,
      storeTop3: dashboardSummary.storeTop3,
      storeRankings: storeRanking.map((s) => ({ store: s.store, displayName: s.displayName, manager: s.manager, cash: s.cash, budget: s.budget, achievement: s.achievement, rank: s.rank })),
      therapistTop3: { today: therapistSummary.todayTop3, yesterday: therapistSummary.yesterdayTop3, monthly: therapistSummary.monthlyTop5.slice(0, 3) },
      therapistRankings: therapistRankings.map((t) => ({ id: t.id, name: t.name, storeDisplay: t.storeDisplay, manager: t.manager, totalRevenue: t.totalRevenue, rank: t.rank, status: t.status })),
      lastUpdatedAt: serverTimestamp(),
      lastUpdatedAtText: new Date().toISOString(),
      source: "maintenance_summary_rebuild",
      version: "rankings-summary-v1",
    };

    return { dashboardSummary, therapistSummary, rankingsSummary };
  };

  const handleRebuildDashboardSummary = async () => {
    if (!/^\d{4}-\d{2}$/.test(String(calMonth || ""))) return showToast("請先選擇正確月份", "error");
    if (!window.confirm(`確定要重建 ${calMonth} 的 Dashboard Summary 嗎？\n\n這不會改動原始日報，只會產生 dashboard_summary / therapist_summary / rankings_summary。`)) return;
    setLoadingAction("rebuildSummary");
    setLogs([]);
    setSummaryBuildReport(null);
    addLog(`🧱 開始重建 Dashboard Summary：${brandId}｜${calMonth}`);
    try {
      await addMaintenanceLog({ type: "dashboard_summary", action: "start_rebuild_summary", month: calMonth, status: "started" });
      const { dashboardSummary, therapistSummary, rankingsSummary } = await buildDashboardSummaryPayloads(calMonth);

      const batch = writeBatch(db);
      batch.set(doc(getCollectionPath("dashboard_summary"), calMonth), dashboardSummary);
      batch.set(doc(getCollectionPath("therapist_summary"), calMonth), therapistSummary);
      batch.set(doc(getCollectionPath("rankings_summary"), calMonth), rankingsSummary);
      await batch.commit();

      const report = {
        month: calMonth,
        dailyReports: dashboardSummary.sourceCounts.dailyReports,
        therapistReports: therapistSummary.sourceCounts.therapistReports,
        stores: dashboardSummary.sourceCounts.stores,
        therapists: therapistSummary.sourceCounts.therapists,
        cash: dashboardSummary.grandTotal.cash,
        accrual: dashboardSummary.grandTotal.accrual,
        therapistRevenue: therapistSummary.grandTotal.totalRevenue,
        targetStores: dashboardSummary.sourceCounts.targetStores,
        writtenDocs: 3,
        createdAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      };
      setSummaryBuildReport(report);
      addLog(`✅ dashboard_summary / therapist_summary / rankings_summary 已寫入 ${calMonth}`);
      addLog(`📊 店日報 ${report.dailyReports.toLocaleString()} 筆｜管理師日報 ${report.therapistReports.toLocaleString()} 筆｜店家 ${report.stores.toLocaleString()}｜管理師 ${report.therapists.toLocaleString()}`);
      await addDoc(getCollectionPath("calibration_logs"), {
        brandId,
        brandLabel,
        month: calMonth,
        status: "success",
        source: "dashboard_summary_rebuild",
        result: report,
        operator: currentUser?.name || "director",
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
      });
      await addMaintenanceLog({ type: "dashboard_summary", action: "finish_rebuild_summary", month: calMonth, status: "success", result: report });
      showToast(`${calMonth} Dashboard Summary 已重建`, "success");
    } catch (error) {
      console.error(error);
      addLog(`❌ Dashboard Summary 重建失敗：${error.message}`);
      await addMaintenanceLog({ type: "dashboard_summary", action: "fail_rebuild_summary", month: calMonth, status: "failed", errorMessage: error.message });
      showToast("Dashboard Summary 重建失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };


  // Dashboard Summary 比對工具：讀取已寫入 summary，並用同月份原始明細重新計算一次，確認 summary-first 上線前數字一致。
  const getMetricValue = (obj, path) => path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : 0), obj || {});

  const makeSummaryCompareRows = ({ storedDashboard, storedTherapist, freshDashboard, freshTherapist }) => {
    const rows = [
      { label: "現金業績", stored: getMetricValue(storedDashboard, "grandTotal.cash"), fresh: getMetricValue(freshDashboard, "grandTotal.cash"), type: "money" },
      { label: "權責業績", stored: getMetricValue(storedDashboard, "grandTotal.accrual"), fresh: getMetricValue(freshDashboard, "grandTotal.accrual"), type: "money" },
      { label: "人員業績", stored: getMetricValue(storedTherapist, "grandTotal.totalRevenue"), fresh: getMetricValue(freshTherapist, "grandTotal.totalRevenue"), type: "money" },
      { label: "店日報筆數", stored: getMetricValue(storedDashboard, "sourceCounts.dailyReports"), fresh: getMetricValue(freshDashboard, "sourceCounts.dailyReports"), type: "count" },
      { label: "管理師日報筆數", stored: getMetricValue(storedTherapist, "sourceCounts.therapistReports"), fresh: getMetricValue(freshTherapist, "sourceCounts.therapistReports"), type: "count" },
      { label: "店家數", stored: getMetricValue(storedDashboard, "sourceCounts.stores"), fresh: getMetricValue(freshDashboard, "sourceCounts.stores"), type: "count" },
      { label: "管理師數", stored: getMetricValue(storedTherapist, "sourceCounts.therapists"), fresh: getMetricValue(freshTherapist, "sourceCounts.therapists"), type: "count" },
      { label: "目標店數", stored: getMetricValue(storedDashboard, "sourceCounts.targetStores"), fresh: getMetricValue(freshDashboard, "sourceCounts.targetStores"), type: "count" },
    ];

    return rows.map((row) => {
      const diff = Number(row.stored || 0) - Number(row.fresh || 0);
      const diffRate = Number(row.fresh || 0) !== 0 ? (diff / Number(row.fresh || 0)) * 100 : (diff === 0 ? 0 : 100);
      return { ...row, diff, diffRate, matched: Math.abs(diff) < 0.0001 };
    });
  };

  const handleCompareDashboardSummary = async () => {
    if (!/^\d{4}-\d{2}$/.test(String(calMonth || ""))) return showToast("請先選擇正確月份", "error");
    setLoadingAction("compareSummary");
    setLogs([]);
    setSummaryCompareReport(null);
    addLog(`🔎 開始比對 Dashboard Summary：${brandId}｜${calMonth}`);
    try {
      const [dashboardSnap, therapistSnap, rankingsSnap] = await Promise.all([
        getDoc(doc(getCollectionPath("dashboard_summary"), calMonth)),
        getDoc(doc(getCollectionPath("therapist_summary"), calMonth)),
        getDoc(doc(getCollectionPath("rankings_summary"), calMonth)),
      ]);

      if (!dashboardSnap.exists() || !therapistSnap.exists()) {
        showToast("尚未找到該月份 Summary，請先執行重建 Summary", "error");
        addLog("⚠️ 該月份尚未建立 dashboard_summary 或 therapist_summary。");
        return;
      }

      const storedDashboard = dashboardSnap.data() || {};
      const storedTherapist = therapistSnap.data() || {};
      const { dashboardSummary: freshDashboard, therapistSummary: freshTherapist } = await buildDashboardSummaryPayloads(calMonth);
      const rows = makeSummaryCompareRows({ storedDashboard, storedTherapist, freshDashboard, freshTherapist });
      const mismatchRows = rows.filter((row) => !row.matched);
      const isMatched = mismatchRows.length === 0;

      const report = {
        month: calMonth,
        status: isMatched ? "一致" : "有差異",
        matched: isMatched,
        rows,
        mismatchCount: mismatchRows.length,
        hasRankingsSummary: rankingsSnap.exists(),
        storedUpdatedAt: storedDashboard.lastUpdatedAtText || storedTherapist.lastUpdatedAtText || "-",
        comparedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      };
      setSummaryCompareReport(report);

      addLog(isMatched ? "✅ Summary 與明細重算結果一致。" : `⚠️ Summary 與明細重算有 ${mismatchRows.length} 項差異。`);
      await addMaintenanceLog({
        type: "dashboard_summary",
        action: "compare_summary_with_raw",
        month: calMonth,
        status: isMatched ? "matched" : "mismatch",
        mismatchCount: mismatchRows.length,
        result: report,
      });
      showToast(isMatched ? "Summary 比對一致" : `Summary 比對發現 ${mismatchRows.length} 項差異`, isMatched ? "success" : "error");
    } catch (error) {
      console.error(error);
      addLog(`❌ Dashboard Summary 比對失敗：${error.message}`);
      await addMaintenanceLog({ type: "dashboard_summary", action: "fail_compare_summary", month: calMonth, status: "failed", errorMessage: error.message });
      showToast("Dashboard Summary 比對失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  // 既有主要工具：校準與備份
  const backupCollections = { daily: ["daily_reports", "therapist_daily_reports"], settings: ["monthly_targets", "therapist_targets", "therapist_schedules", "therapists"], full: ["daily_reports", "therapist_daily_reports", "monthly_aggregated", "therapist_monthly_aggregated", "monthly_targets", "therapist_targets", "therapist_schedules", "therapists"] };
  const backupDocs = ["org_structure", "store_account_data", "manager_auth", "permissions", "trainer_auth", "audit_exclusions", "security_config", "read_tracker_config", "director_auth", "master_auth"];

  const handleCalibrateData = async () => {
    if (!window.confirm(`確定要針對【${brandId}】在 ${calMonth} 的數據執行校準嗎？\n\n建議先完成「資料健康檢查」與「月結前檢查」。`)) return;
    setLoadingAction("calibrate");
    setLogs([]);
    addLog(`🔄 啟動數據盤點與校準... 目標: ${brandId}, 月份: ${calMonth}`);

    try {
      await addMaintenanceLog({ type: "calibration", action: "start_monthly_calibration", month: calMonth, status: "started" });
      const response = await fetch(`https://recalculatemonthlydata-hyhcwrnyaa-uc.a.run.app?brandId=${brandId}&yearMonth=${calMonth}`);
      if (!response.ok) throw new Error("伺服器回應異常");
      const result = await response.text();
      addLog(result);
      const completedQueueCount = await markRecalcQueueCompleted(calMonth, [], result);
      await addDoc(getCollectionPath("calibration_logs"), { brandId, brandLabel, month: calMonth, status: "success", resultText: result, source: "manual_calibration", completedQueueCount, operator: currentUser?.name || "director", createdAt: serverTimestamp(), createdAtText: new Date().toISOString() });
      await addMaintenanceLog({ type: "calibration", action: "finish_monthly_calibration", month: calMonth, status: "success", completedQueueCount });
      if (completedQueueCount > 0) {
        setRecalcQueueGroups((prev) => prev.filter((item) => item.month !== calMonth));
        setRecalcQueueTotal((prev) => Math.max(0, prev - completedQueueCount));
      }
      addLog(`✅ ${calMonth} 校準完成。${completedQueueCount ? `已同步完成 ${completedQueueCount.toLocaleString()} 筆待重算紀錄。` : ""}`);
      showToast(completedQueueCount ? `校準完成，${completedQueueCount.toLocaleString()} 筆待重算紀錄已完成` : "校準完成並已寫入紀錄", "success");
    } catch (err) {
      await addMaintenanceLog({ type: "calibration", action: "fail_monthly_calibration", month: calMonth, status: "failed", errorMessage: err.message });
      addLog(`❌ 校準失敗: ${err.message}`);
      showToast("校準失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleBackupData = async () => {
    setLoadingAction("backup"); setLogs([]); addLog(`📦 啟動 ${brandLabel} 備份作業... 類型：${backupType}`);
    try {
      const collectionsToExport = backupCollections[backupType] || backupCollections.full;
      const payload = { meta: { brandId, brandLabel, backupType, exportedAt: new Date().toISOString(), exportedBy: currentUser?.name || "director", version: "maintenance-backup-v3" }, collections: {}, docs: {} };
      for (const colName of collectionsToExport) { const snap = await getDocs(getCollectionPath(colName)); payload.collections[colName] = snap.docs.map((d) => ({ id: d.id, ...d.data() })); addLog(`✅ ${colName}：${snap.size.toLocaleString()} 筆`); }
      if (backupType === "settings" || backupType === "full") for (const docName of backupDocs) { try { const snap = await getDoc(getDocPath(docName)); payload.docs[docName] = snap.exists() ? { id: snap.id, ...snap.data() } : null; } catch (error) { payload.docs[docName] = { error: error.message }; } }
      const jsonString = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const fileName = `${brandId}_${backupType}_backup_${new Date().toISOString().split("T")[0]}.json`;
      link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
      const totalDocs = Object.values(payload.collections).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
      await addDoc(collection(db, "maintenance_backup_logs"), { brandId, brandLabel, backupType, fileName, totalDocs, collections: collectionsToExport, exportedBy: currentUser?.name || "director", createdAt: serverTimestamp(), createdAtText: new Date().toISOString() });
      addLog(`🎉 備份匯出成功：${fileName}`); addLog(`🧾 已寫入備份紀錄：${totalDocs.toLocaleString()} 筆資料。`); showToast("備份檔案已下載並記錄", "success");
    } catch (error) { addLog(`❌ 匯出失敗: ${error.message}`); showToast("備份失敗", "error"); }
    finally { setLoadingAction(null); }
  };

  // 資料量概況 / 備份紀錄
  const handleLoadDataVolume = async () => {
    const { startDate, endDate } = monthRange(calMonth);
    setLoadingAction("dataVolume");
    setLogs([]);
    addLog(`📊 載入 ${brandLabel} 資料量概況...`);

    try {
      const rows = [];
      for (const colName of ["daily_reports", "therapist_daily_reports", "monthly_aggregated", "therapist_monthly_aggregated", "monthly_targets", "therapist_targets", "therapist_schedules", "therapists"]) {
        const snap = await getDocs(getCollectionPath(colName));
        const archivedCount = snap.docs.filter((d) => d.data()?.isArchivedDuplicate === true).length;
        const monthCount = snap.docs.filter((d) => {
          const data = d.data() || {};
          if (data.date) return String(data.date) >= startDate && String(data.date) <= endDate;
          if (data.yearMonth) return String(data.yearMonth) === calMonth;
          if (data.year && data.month) return `${data.year}-${String(data.month).padStart(2, "0")}` === calMonth;
          return false;
        }).length;
        rows.push({ colName, count: snap.size, monthCount, archivedCount });
        addLog(`✅ ${colName}: ${snap.size.toLocaleString()} 筆｜${calMonth}：${monthCount.toLocaleString()} 筆｜封存 ${archivedCount.toLocaleString()} 筆`);
      }
      setDataVolumeRows(rows.sort((a, b) => b.count - a.count));
      await addMaintenanceLog({ type: "data_volume", action: "load_data_volume", month: calMonth, collections: rows.length });
      showToast("資料量概況已更新", "success");
    } catch (error) {
      addLog(`❌ 載入資料量失敗: ${error.message}`);
      showToast("資料量概況載入失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleLoadBackupRecords = async () => {
    setLoadingAction("backupRecords");
    try {
      const snap = await getDocs(query(collection(db, "maintenance_backup_logs"), limit(100)));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((row) => !brandId || !row.brandId || row.brandId === brandId).sort((a, b) => String(b.createdAtText || "").localeCompare(String(a.createdAtText || ""))).slice(0, 20);
      setBackupRecords(rows); showToast(`已載入 ${rows.length.toLocaleString()} 筆備份紀錄`, "success");
    } catch (error) { console.error(error); showToast("備份紀錄載入失敗", "error"); }
    finally { setLoadingAction(null); }
  };

  const handleLoadOrgStructureSnapshots = async () => {
    setLoadingAction("loadOrgSnapshots");
    try {
      const snap = await getDocs(query(getCollectionPath("org_structure_snapshots"), limit(50)));
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.createdAtText || "").localeCompare(String(a.createdAtText || "")))
        .slice(0, 20);

      setOrgStructureSnapshots(rows);
      showToast(rows.length ? `已載入 ${rows.length.toLocaleString()} 筆組織架構快照` : "目前尚無組織架構快照", rows.length ? "success" : "info");
    } catch (error) {
      console.error(error);
      showToast("讀取組織架構快照失敗，請檢查權限或資料路徑", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRestoreOrgStructureSnapshot = async (snapshot) => {
    const managerKeys = Object.keys(snapshot?.managers || {});
    if (!snapshot?.managers || managerKeys.length === 0) {
      showToast("此快照沒有可還原的 managers 資料", "error");
      return;
    }

    if (!window.confirm(`確定要還原這份組織架構快照嗎？\n\n快照時間：${snapshot.createdAtText || "-"}\n區塊數：${managerKeys.length}\n\n此操作會覆蓋目前 org_structure.managers。`)) return;

    setLoadingAction(`restoreOrg_${snapshot.id}`);
    try {
      const currentSnap = await getDoc(getDocPath("org_structure"));
      const currentManagers = currentSnap.exists() ? currentSnap.data()?.managers || {} : {};

      await addDoc(getCollectionPath("org_structure_snapshots"), {
        brandId,
        brandLabel,
        action: "before_restore_org_structure",
        managers: JSON.parse(JSON.stringify(currentManagers || {})),
        managerKeys: Object.keys(currentManagers || {}),
        storeCount: Object.values(currentManagers || {}).flat().filter(Boolean).length,
        operator: currentUser?.name || "director",
        operatorRole: userRole || "director",
        restoredFromSnapshotId: snapshot.id,
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
        details: "還原 org_structure 前自動建立目前狀態快照",
      });

      await setDoc(getDocPath("org_structure"), { managers: snapshot.managers }, { merge: true });

      await addDoc(getCollectionPath("maintenance_logs"), {
        type: "org_structure_restore",
        action: "restore_org_structure_snapshot",
        brandId,
        brandLabel,
        operator: currentUser?.name || "director",
        operatorRole: userRole || "director",
        snapshotId: snapshot.id,
        snapshotCreatedAtText: snapshot.createdAtText || "",
        restoredManagerKeys: managerKeys,
        restoredStoreCount: Object.values(snapshot.managers || {}).flat().filter(Boolean).length,
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
        details: `已還原 org_structure 快照 ${snapshot.id}`,
      });

      addLog(`🛡️ 已還原組織架構快照：${snapshot.createdAtText || snapshot.id}`);
      showToast("組織架構已還原，請重新整理或切換頁面確認", "success");
      await handleLoadOrgStructureSnapshots();
    } catch (error) {
      console.error(error);
      showToast("還原組織架構快照失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  // 進階修復：日期與重複封存
  const handleScanDateFormats = async () => {
    setLoadingAction("scanDates"); setLogs([]); addLog("🔎 掃描日期格式異常...");
    try {
      const issues = [];
      for (const colName of ["daily_reports", "therapist_daily_reports"]) {
        const snap = await getDocs(getCollectionPath(colName));
        snap.docs.forEach((docSnap) => { const data = docSnap.data(); if (!data.date) return; const oldDate = String(data.date).trim(); const newDate = formatDateString(oldDate); if (newDate !== oldDate) issues.push({ id: docSnap.id, colName, oldDate, newDate, store: getStoreName(data) || "未知店家", person: getTherapistName(data) || "店務總表" }); });
      }
      setDateIssues(issues); addLog(`✅ 掃描完成，發現 ${issues.length.toLocaleString()} 筆需修復。`); showToast(issues.length ? `發現 ${issues.length.toLocaleString()} 筆日期異常` : "日期格式正常", issues.length ? "info" : "success");
    } catch (error) { addLog(`❌ 掃描失敗: ${error.message}`); showToast("日期掃描失敗", "error"); }
    finally { setLoadingAction(null); }
  };

  const handleFixDateFormats = async () => {
    if (dateIssues.length === 0) return showToast("請先掃描日期格式", "info");
    if (!window.confirm(`確定修復 ${dateIssues.length.toLocaleString()} 筆日期格式嗎？`)) return;
    setLoadingAction("fixDates"); setLogs([]); addLog("🛠️ 開始修復日期格式...");
    try {
      let batch = writeBatch(db); let count = 0;
      for (const item of dateIssues) { batch.update(doc(getCollectionPath(item.colName), item.id), { date: item.newDate }); count++; if (count % 490 === 0) { await batch.commit(); batch = writeBatch(db); } }
      if (count % 490 !== 0) await batch.commit();
      setDateIssues([]); addLog(`🎉 日期修復完成：${count.toLocaleString()} 筆。`); showToast("日期修復完成", "success");
    } catch (error) { addLog(`❌ 修復失敗: ${error.message}`); showToast("日期修復失敗", "error"); }
    finally { setLoadingAction(null); }
  };

  const handleScanDuplicates = async () => {
    setLoadingAction("scanDups"); setLogs([]); addLog("🔎 掃描疑似重複資料...");
    try {
      const allGroups = [];
      for (const colName of ["daily_reports", "therapist_daily_reports"]) {
        const snap = await getDocs(getCollectionPath(colName));
        const grouped = {};
        snap.docs.forEach((docSnap) => { const data = docSnap.data(); if (data.isArchivedDuplicate === true) return; const key = `${data.date || "無日期"}_${getStoreName(data) || "無店名"}_${getTherapistName(data) || "店務總表"}`; if (!grouped[key]) grouped[key] = []; grouped[key].push({ id: docSnap.id, colName, ...data }); });
        Object.entries(grouped).forEach(([key, records]) => { if (records.length <= 1) return; const sorted = [...records].sort((a, b) => (b.timestamp?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || a.createdAt?.toMillis?.() || 0)); allGroups.push({ key, colName, keepId: sorted[0].id, duplicateIds: sorted.slice(1).map((item) => item.id), count: sorted.length, date: sorted[0].date || "無日期", store: getStoreName(sorted[0]) || "無店名", person: getTherapistName(sorted[0]) || "店務總表" }); });
      }
      setDuplicateGroups(allGroups.slice(0, 100)); const duplicateCount = allGroups.reduce((sum, group) => sum + group.duplicateIds.length, 0); addLog(`✅ 重複檢測完成：${allGroups.length.toLocaleString()} 組、${duplicateCount.toLocaleString()} 筆可封存。`); showToast(`重複檢測完成：${duplicateCount.toLocaleString()} 筆可處理`, duplicateCount ? "info" : "success");
    } catch (error) { addLog(`❌ 檢測失敗: ${error.message}`); showToast("重複資料檢測失敗", "error"); }
    finally { setLoadingAction(null); }
  };

  const handleArchiveDuplicates = async () => {
    if (duplicateGroups.length === 0) return showToast("請先執行重複資料檢測", "info");
    const total = duplicateGroups.reduce((sum, group) => sum + group.duplicateIds.length, 0);
    if (!window.confirm(`確定要將 ${total.toLocaleString()} 筆疑似重複舊資料標記為封存嗎？\n此操作不會永久刪除資料。`)) return;
    setLoadingAction("archiveDups"); setLogs([]); addLog("📦 開始封存疑似重複資料...");
    try { let batch = writeBatch(db); let count = 0; for (const group of duplicateGroups) { for (const id of group.duplicateIds) { batch.update(doc(getCollectionPath(group.colName), id), { isArchivedDuplicate: true, duplicateArchivedAt: serverTimestamp(), duplicateArchivedAtText: new Date().toISOString(), duplicateKeepId: group.keepId, duplicateReason: "maintenance_duplicate_scan" }); count++; if (count % 490 === 0) { await batch.commit(); batch = writeBatch(db); } } } if (count % 490 !== 0) await batch.commit(); setDuplicateGroups([]); addLog(`✅ 已封存 ${count.toLocaleString()} 筆疑似重複舊資料。`); showToast(`已封存 ${count.toLocaleString()} 筆疑似重複資料`, "success"); }
    catch (error) { addLog(`❌ 封存失敗: ${error.message}`); showToast("封存重複資料失敗", "error"); }
    finally { setLoadingAction(null); }
  };

  const handleLoadArchivedDuplicates = async () => {
    const { startDate, endDate } = monthRange(archiveFilterMonth);
    setLoadingAction("loadArchived");
    setLogs([]);
    addLog(`📦 載入封存資料清單... 範圍：${archiveFilterMonth}`);

    try {
      const rows = [];
      for (const colName of ["daily_reports", "therapist_daily_reports"]) {
        const snap = await getDocs(query(getCollectionPath(colName), where("date", ">=", startDate), where("date", "<=", endDate)));
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.isArchivedDuplicate !== true) return;
          rows.push({
            id: docSnap.id,
            colName,
            date: data.date || "—",
            store: getStoreName(data) || "—",
            person: getTherapistName(data) || "店務總表",
            keepId: data.duplicateKeepId || "—",
            archivedAt: data.duplicateArchivedAtText || "—",
          });
        });
      }
      const sorted = rows.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 200);
      setArchivedDuplicates(sorted);
      addLog(`✅ 已載入 ${rows.length.toLocaleString()} 筆封存資料。`);
      showToast(`已載入 ${rows.length.toLocaleString()} 筆封存資料`, rows.length ? "success" : "info");
    } catch (error) {
      addLog(`❌ 載入封存資料失敗: ${error.message}`);
      showToast("封存資料載入失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRestoreArchivedDuplicate = async (row) => {
    if (!window.confirm(`確定要還原這筆封存資料嗎？\n${row.date}｜${row.store}｜${row.person}\n\n還原後可能會重新納入報表與月結計算，並建議重新校準 ${String(row.date || "").slice(0, 7)}。`)) return;
    setLoadingAction(`restore_${row.id}`);

    try {
      await updateDoc(doc(getCollectionPath(row.colName), row.id), {
        isArchivedDuplicate: false,
        restoredFromDuplicateArchiveAt: serverTimestamp(),
        restoredFromDuplicateArchiveAtText: new Date().toISOString(),
        restoredBy: currentUser?.name || "director",
      });
      await addMaintenanceLog({ type: "archive_restore", action: "restore_archived_duplicate", sourceCollection: row.colName, sourceId: row.id, date: row.date, store: row.store, person: row.person, affectedYearMonth: String(row.date || "").slice(0, 7) });
      setArchivedDuplicates((prev) => prev.filter((item) => !(item.id === row.id && item.colName === row.colName)));
      addLog(`↩️ 已還原封存資料：${row.colName}｜${row.date}｜${row.store}｜${row.person}`);
      showToast("封存資料已還原，建議重新校準對應月份", "success");
    } catch (error) {
      addLog(`❌ 還原失敗: ${error.message}`);
      showToast("還原封存資料失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleClearLocalCache = () => { if (!window.confirm("這只會清除目前瀏覽器暫存，不會刪除雲端資料。確定要繼續嗎？")) return; addLog("🧹 清除本機快取並重新載入..."); localStorage.clear(); window.location.reload(true); };

  return (
    <ViewWrapper>
      <div className="max-w-5xl mx-auto space-y-6 pb-10 animate-in fade-in duration-500">
        <section className="rounded-[2rem] border border-[#EEDFC7] bg-gradient-to-br from-[#FFFCF7] via-white to-[#FFF7E8] p-6 shadow-[0_22px_70px_rgba(120,90,40,0.06)]">
          <SectionTitle eyebrow="Maintenance Core" title="主要維護工具" desc="保留長期必要功能：月度校準、品牌備份與資料品質檢查。" icon={Settings} />
          <div className="mt-6 space-y-3">
            <ToolRow icon={Shield} title="組織架構快照與還原" desc="讀取區長架構修改前自動建立的 org_structure 快照；誤刪或誤改時可回復 managers 結構。" badge="資料安全" tone="emerald">
              <BeautyButton onClick={handleLoadOrgStructureSnapshots} disabled={loadingAction !== null} variant="primary">
                {loadingAction === "loadOrgSnapshots" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                載入快照
              </BeautyButton>
            </ToolRow>
            {orgStructureSnapshots.length > 0 && (
              <div className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50/30 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-black text-stone-800">最近組織架構快照</p>
                  <p className="text-[11px] font-bold text-stone-400">最多顯示 20 筆</p>
                </div>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {orgStructureSnapshots.map((row) => (
                    <div key={row.id} className="bg-white/90 border border-stone-100 rounded-2xl p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-stone-700 truncate">{row.action || "org_structure_snapshot"}</p>
                        <p className="text-[10px] font-bold text-stone-400 mt-1">
                          {row.createdAtText || "-"}｜操作者：{row.operator || "-"}｜區塊 {Object.keys(row.managers || {}).length}｜店家 {(Object.values(row.managers || {}).flat().filter(Boolean).length).toLocaleString()}
                        </p>
                        {row.details && <p className="text-[10px] font-bold text-[#B7863D] mt-1 truncate">{row.details}</p>}
                      </div>
                      <BeautyButton
                        onClick={() => handleRestoreOrgStructureSnapshot(row)}
                        disabled={loadingAction !== null}
                        variant="soft"
                        className="shrink-0"
                      >
                        {loadingAction === `restoreOrg_${row.id}` ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        還原
                      </BeautyButton>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ToolRow icon={CheckCircle2} title="資料健康檢查" desc="掃描日期、店家、負數欄位、封存重複資料等常見異常。只讀取、不修改資料。" badge="低風險" tone="emerald">
              <BeautyButton onClick={handleRunDataHealthCheck} disabled={loadingAction !== null} variant="primary">{loadingAction === "healthCheck" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}執行檢查</BeautyButton>
            </ToolRow>
            {healthReport && (
              <div className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50/30 p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                  <p className="text-sm font-black text-stone-800">健康檢查結果</p>
                  <p className="text-[11px] font-bold text-stone-400">掃描 {healthReport.scanned.toLocaleString()} 筆｜{healthReport.month || calMonth}｜{healthReport.createdAt}</p>
                </div>
                {healthReport.issues.length === 0 ? (
                  <p className="text-xs font-bold text-emerald-700">目前未發現明顯異常。</p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {healthReport.issues.map((item) => {
                        const hasDetails = Array.isArray(item.details) && item.details.length > 0;
                        const isExpanded = expandedHealthIssue === item.label;
                        return (
                          <button
                            key={item.label}
                            type="button"
                            title={item.hint || ""}
                            onClick={() => hasDetails && setExpandedHealthIssue(isExpanded ? "" : item.label)}
                            className={`bg-white/90 border rounded-2xl p-3 flex items-center justify-between text-left transition-all ${hasDetails ? "border-amber-100 hover:bg-amber-50/40 cursor-pointer" : "border-stone-100 cursor-default"}`}
                          >
                            <div className="min-w-0">
                              <span className={`text-xs font-black ${item.severity === "danger" ? "text-rose-600" : item.severity === "warning" ? "text-[#B7863D]" : "text-stone-600"}`}>{item.label}</span>
                              {hasDetails && <p className="mt-1 text-[10px] font-bold text-stone-400">點擊查看明細</p>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-sm font-black ${item.severity === "danger" ? "text-rose-600" : item.severity === "warning" ? "text-[#B7863D]" : "text-stone-500"}`}>{item.count.toLocaleString()}</span>
                              {hasDetails && <ChevronDown size={14} className={`text-stone-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {expandedHealthIssue && (() => {
                      const issue = healthReport.issues.find((item) => item.label === expandedHealthIssue);
                      const details = issue?.details || [];
                      if (!issue || details.length === 0) return null;
                      return (
                        <div className="rounded-[1.25rem] border border-amber-100 bg-white/95 p-4 animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                            <div>
                              <p className="text-sm font-black text-stone-800">{issue.label} 明細</p>
                              {issue.hint && <p className="text-[11px] font-bold text-stone-400 mt-1">{issue.hint}</p>}
                            </div>
                            <p className="text-[11px] font-bold text-stone-400">顯示前 {details.length.toLocaleString()} 筆</p>
                          </div>
                          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                            {details.map((detail, index) => (
                              <div key={`${issue.label}_${detail.id || index}_${index}`} className="rounded-2xl border border-stone-100 bg-stone-50/70 p-3">
                                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                  <p className="text-xs font-black text-stone-700 truncate">
                                    {detail.collectionName && detail.collectionName !== "-" ? `${detail.collectionName}｜` : ""}
                                    {detail.date && detail.date !== "-" ? `${detail.date}｜` : ""}
                                    {detail.store && detail.store !== "-" ? `${detail.store}｜` : ""}
                                    {detail.therapist && detail.therapist !== "-" ? `${detail.therapist}` : ""}
                                  </p>
                                  <span className="text-[10px] font-black text-stone-400 bg-white border border-stone-100 rounded-full px-2 py-1 shrink-0">ID：{detail.id || "-"}</span>
                                </div>
                                {detail.reason && <p className="mt-1 text-[11px] font-bold text-[#B7863D]">{detail.reason}</p>}
                                {Array.isArray(detail.fields) && detail.fields.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {detail.fields.map((field) => (
                                      <span key={`${field.field}_${field.value}`} className="px-2 py-1 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 text-[10px] font-black">
                                        {field.field}: {String(field.value)}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
            <ToolRow icon={Calendar} title="月結前檢查" desc="檢查指定月份缺報、重複資料與目標設定。只讀取、不修改資料。" badge="月結流程">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><input type="month" value={calMonth} onChange={(e)=>setCalMonth(e.target.value)} className="bg-transparent text-xs font-black text-stone-700 outline-none w-28" /></div>
              <BeautyButton onClick={handleRunClosingCheck} disabled={loadingAction !== null} variant="primary">{loadingAction === "closingCheck" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}檢查月結</BeautyButton>
            </ToolRow>
            {closingReport && <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50/30 p-4 space-y-3"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><p className="text-sm font-black text-stone-800">{closingReport.month} 月結前檢查｜{closingReport.readiness || "檢查完成"}</p><p className="text-[11px] font-bold text-stone-400">檢查 {closingReport.checkedDays} 天｜店家 {closingReport.stores}｜排除 {closingReport.excludedStoreCount || 0}｜在職管理師 {closingReport.activeTherapists}</p></div><div className="grid grid-cols-1 md:grid-cols-5 gap-2">{closingReport.warnings.map((item)=><div key={item.label} className="bg-white/90 border border-stone-100 rounded-2xl p-3"><p className="text-[11px] font-black text-stone-400">{item.label}</p><p className={`mt-1 text-xl font-black ${item.neutral ? "text-stone-700" : item.count ? "text-[#B7863D]" : "text-emerald-600"}`}>{item.count.toLocaleString()}</p></div>)}</div></div>}
            <ToolRow icon={Play} title="月度數據重新校準" desc="重新掃描指定月份日報並修正彙整表，適合數字對帳或月結資料異常時使用。" badge="建議保留" tone="emerald">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><input type="month" value={calMonth} onChange={(e) => setCalMonth(e.target.value)} className="bg-transparent text-xs font-black text-stone-700 outline-none w-28" /></div>
              <BeautyButton onClick={handleCalibrateData} disabled={loadingAction !== null} variant="primary">{loadingAction === "calibrate" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}啟動校準</BeautyButton>
            </ToolRow>
            <ToolRow icon={RefreshCw} title="待重新校準月份" desc="彙整 recalc_queue 的 pending 紀錄；日報提交、業績修正或刪除後，會在此顯示需要重新校準的月份。" badge={recalcQueueTotal ? `${recalcQueueTotal.toLocaleString()} 筆待處理` : "Summary 前置"} tone="amber">
              <BeautyButton onClick={handleLoadRecalcQueue} disabled={loadingAction !== null} variant="secondary">
                {loadingAction === "loadRecalcQueue" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                載入待重算
              </BeautyButton>
            </ToolRow>
            {recalcQueueGroups.length > 0 && (
              <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50/30 p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-stone-800">待重新校準月份</p>
                    <p className="text-[11px] font-bold text-stone-400 mt-1">依 affectedYearMonth 彙整，校準完成後會標記 recalc_queue 為 completed。</p>
                  </div>
                  <p className="text-[11px] font-bold text-stone-400">共 {recalcQueueTotal.toLocaleString()} 筆 pending</p>
                </div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {recalcQueueGroups.map((group) => (
                    <div key={group.month} className="bg-white/95 border border-stone-100 rounded-2xl p-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-black text-stone-800">{group.month}</p>
                          <span className="px-2 py-1 rounded-full bg-amber-50 text-[#B7863D] border border-amber-100 text-[10px] font-black">{group.count.toLocaleString()} 筆</span>
                          {group.storeCount > 0 && <span className="px-2 py-1 rounded-full bg-stone-50 text-stone-500 border border-stone-100 text-[10px] font-black">店務 {group.storeCount.toLocaleString()}</span>}
                          {group.therapistCount > 0 && <span className="px-2 py-1 rounded-full bg-stone-50 text-stone-500 border border-stone-100 text-[10px] font-black">管理師 {group.therapistCount.toLocaleString()}</span>}
                        </div>
                        <p className="text-[10px] font-bold text-stone-400 mt-1 truncate">來源：{group.sources.join("、") || "-"}｜原因：{group.reasons.join("、") || "-"}｜最近異動：{group.latestAt || "-"}</p>
                      </div>
                      <BeautyButton onClick={() => handleCalibrateRecalcMonth(group)} disabled={loadingAction !== null} variant="primary" className="shrink-0">
                        {loadingAction === `calibrateQueue_${group.month}` ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        校準此月份
                      </BeautyButton>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ToolRow icon={Database} title="Dashboard Summary 重建" desc="依指定月份讀取店務日報、管理師日報、目標與組織架構，產生 dashboard_summary / therapist_summary / rankings_summary。暫不改動現有 Dashboard 顯示邏輯。" badge="Summary v1" tone="emerald">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><input type="month" value={calMonth} onChange={(e) => setCalMonth(e.target.value)} className="bg-transparent text-xs font-black text-stone-700 outline-none w-28" /></div>
              <BeautyButton onClick={handleRebuildDashboardSummary} disabled={loadingAction !== null} variant="primary">
                {loadingAction === "rebuildSummary" ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                重建 Summary
              </BeautyButton>
            </ToolRow>
            {summaryBuildReport && (
              <div className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50/30 p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-stone-800">{summaryBuildReport.month} Dashboard Summary 重建完成</p>
                    <p className="text-[11px] font-bold text-stone-400 mt-1">已寫入 dashboard_summary、therapist_summary、rankings_summary，共 {summaryBuildReport.writtenDocs} 份文件｜{summaryBuildReport.createdAt}</p>
                  </div>
                  <span className="px-3 py-1.5 rounded-full bg-white text-emerald-700 border border-emerald-100 text-[11px] font-black">不影響原始日報</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    ["店日報", summaryBuildReport.dailyReports],
                    ["管理師日報", summaryBuildReport.therapistReports],
                    ["店家數", summaryBuildReport.stores],
                    ["管理師數", summaryBuildReport.therapists],
                    ["現金業績", summaryBuildReport.cash],
                    ["權責業績", summaryBuildReport.accrual],
                    ["人員業績", summaryBuildReport.therapistRevenue],
                    ["目標店數", summaryBuildReport.targetStores],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-stone-100 bg-white/90 p-3">
                      <p className="text-[11px] font-black text-stone-400">{label}</p>
                      <p className="mt-1 text-lg font-black text-[#B7863D]">{Number(value || 0).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ToolRow icon={CheckCircle2} title="Dashboard Summary 比對" desc="讀取已建立的 summary，並用同月份原始明細即時計算一次，確認 summary 與明細結果是否一致。建議在 summary-first 上線前使用。" badge="驗證工具" tone="emerald">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><input type="month" value={calMonth} onChange={(e) => setCalMonth(e.target.value)} className="bg-transparent text-xs font-black text-stone-700 outline-none w-28" /></div>
              <BeautyButton onClick={handleCompareDashboardSummary} disabled={loadingAction !== null} variant="primary">
                {loadingAction === "compareSummary" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                比對 Summary
              </BeautyButton>
            </ToolRow>
            {summaryCompareReport && (
              <div className={`rounded-[1.5rem] border p-4 space-y-3 ${summaryCompareReport.matched ? "border-emerald-100 bg-emerald-50/30" : "border-rose-100 bg-rose-50/30"}`}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-stone-800">{summaryCompareReport.month} Summary 比對結果｜{summaryCompareReport.status}</p>
                    <p className="text-[11px] font-bold text-stone-400 mt-1">已建立 Summary 更新時間：{summaryCompareReport.storedUpdatedAt}｜比對時間：{summaryCompareReport.comparedAt}</p>
                  </div>
                  <span className={`px-3 py-1.5 rounded-full bg-white border text-[11px] font-black ${summaryCompareReport.matched ? "text-emerald-700 border-emerald-100" : "text-rose-600 border-rose-100"}`}>
                    {summaryCompareReport.matched ? "全部一致" : `${summaryCompareReport.mismatchCount} 項差異`}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                  {summaryCompareReport.rows.map((row) => (
                    <div key={row.label} className={`rounded-2xl border bg-white/90 p-3 ${row.matched ? "border-stone-100" : "border-rose-100"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-black text-stone-400">{row.label}</p>
                        <span className={`text-[10px] font-black ${row.matched ? "text-emerald-600" : "text-rose-500"}`}>{row.matched ? "一致" : "差異"}</span>
                      </div>
                      <p className="mt-1 text-lg font-black text-[#B7863D]">{Number(row.stored || 0).toLocaleString()}</p>
                      <p className="mt-1 text-[10px] font-bold text-stone-400">明細重算：{Number(row.fresh || 0).toLocaleString()}</p>
                      {!row.matched && <p className="mt-1 text-[10px] font-black text-rose-500">差異：{Number(row.diff || 0).toLocaleString()}｜{Number(row.diffRate || 0).toFixed(2)}%</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ToolRow icon={Download} title="品牌資料備份" desc="依需求匯出日報、設定或完整品牌資料，並寫入備份紀錄。" badge="升級版">
              <div className="relative min-w-[180px]"><select value={backupType} onChange={(e)=>setBackupType(e.target.value)} className="h-11 w-full appearance-none rounded-2xl bg-white border border-stone-200 px-4 pr-9 text-xs font-black text-stone-700 outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-50"><option value="daily">日報備份</option><option value="settings">設定備份</option><option value="full">完整品牌備份</option></select><ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" /></div>
              <BeautyButton onClick={handleBackupData} disabled={loadingAction !== null} variant="primary">{loadingAction === "backup" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}下載備份</BeautyButton>
            </ToolRow>
          </div>
        </section>

        <section className="rounded-[2rem] border border-[#EEDFC7] bg-white/95 shadow-[0_22px_70px_rgba(120,90,40,0.05)] overflow-hidden">
          <div className="p-6 border-b border-[#F0E3CF]"><SectionTitle eyebrow="Data Observability" title="資料量概況與備份紀錄" desc="掌握資料規模、封存筆數與備份歷史。" icon={BarChart3} /></div>
          <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between"><div className="flex items-center gap-2"><BarChart3 size={16} className="text-[#B7863D]" /><span className="text-sm font-black text-stone-700">資料量概況</span></div><button onClick={handleLoadDataVolume} disabled={loadingAction !== null} className="text-[11px] font-black px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-amber-200 disabled:opacity-40 flex items-center gap-1.5">{loadingAction === "dataVolume" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}載入概況</button></div><div className="p-4 space-y-2 max-h-[320px] overflow-y-auto">{dataVolumeRows.length === 0 ? <div className="h-40 flex flex-col items-center justify-center text-stone-300 gap-2"><BarChart3 size={30} /><p className="text-xs font-black">尚未載入資料量</p></div> : dataVolumeRows.map((row)=><div key={row.colName} className="bg-white rounded-2xl border border-stone-100 p-3 flex items-center justify-between gap-3"><div><p className="text-xs font-black text-stone-700">{row.colName}</p><p className="text-[10px] font-bold text-stone-400">本月 {Number(row.monthCount || 0).toLocaleString()} 筆｜封存重複 {row.archivedCount.toLocaleString()} 筆</p></div><p className="text-sm font-black text-[#B7863D]">{row.count.toLocaleString()}</p></div>)}</div></div>
            <div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between"><div className="flex items-center gap-2"><ClipboardList size={16} className="text-[#B7863D]" /><span className="text-sm font-black text-stone-700">備份紀錄</span></div><button onClick={handleLoadBackupRecords} disabled={loadingAction !== null} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-40 flex items-center gap-1.5">{loadingAction === "backupRecords" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}載入紀錄</button></div><div className="p-4 space-y-2 max-h-[320px] overflow-y-auto">{backupRecords.length === 0 ? <div className="h-40 flex flex-col items-center justify-center text-stone-300 gap-2"><ClipboardList size={30} /><p className="text-xs font-black">尚未載入備份紀錄</p></div> : backupRecords.map((row)=><div key={row.id} className="bg-white rounded-2xl border border-stone-100 p-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-black text-stone-700 truncate">{row.fileName || row.backupType}</p><span className="text-[10px] font-black text-[#B7863D] bg-amber-50 border border-amber-100 rounded-full px-2 py-1">{row.backupType}</span></div><p className="mt-1 text-[10px] font-bold text-stone-400">{row.createdAtText || "—"}｜{row.exportedBy || "—"}｜{Number(row.totalDocs || 0).toLocaleString()} docs</p></div>)}</div></div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-[#EEDFC7] bg-white/95 shadow-[0_22px_70px_rgba(120,90,40,0.05)] overflow-hidden">
          <div className="p-6 border-b border-[#F0E3CF] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"><SectionTitle eyebrow="Traffic Diagnosis" title="讀取來源追蹤" desc="用來判斷晚間讀取暴增是由哪一個資料來源、頁面或角色造成。" icon={Radio} />
            <div className="flex flex-wrap gap-2">{[{ id: "off", label: "關閉", icon: Power }, { id: "local", label: "本機模式", icon: Monitor }, { id: "global", label: "全域上報", icon: Globe2 }].map((mode)=><button key={mode.id} onClick={()=>handleChangeReadTrackerMode(mode.id)} className={`px-4 py-2 rounded-2xl text-xs font-black border flex items-center gap-2 transition-all ${readTrackerMode === mode.id ? "bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border-amber-200 shadow-[0_10px_24px_rgba(190,145,70,0.16)]" : "bg-white text-stone-500 border-stone-200 hover:bg-stone-50"}`}><mode.icon size={14} />{mode.label}</button>)}</div>
          </div>
          <div className="p-6 border-b border-[#F0E3CF] bg-[#FFFCF7]"><div className="rounded-[1.75rem] border border-[#EEDFC7] bg-white shadow-sm overflow-hidden"><div className="p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 border-b border-stone-100"><div className="min-w-0"><h3 className="text-sm font-black text-stone-800 flex items-center gap-2"><Clock size={18} className="text-[#B7863D]" />排程式全域上報</h3><p className="text-xs text-stone-400 font-bold mt-1">固定晚間診斷區間，讓每天數據可比較；支援跨日，例如 19:00～07:00。</p></div><div className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-black border ${!scheduleForm.scheduleEnabled ? "bg-stone-50 text-stone-500 border-stone-200" : scheduleStatus.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-amber-50 text-amber-700 border-amber-100"}`}><CheckCircle2 size={15} />{scheduleStatus.label}｜現在 {scheduleStatus.nowTime}</div></div>
            <div className="p-5 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr_1fr_auto] gap-3 items-end"><div className="rounded-2xl border border-stone-100 bg-stone-50/70 p-3 flex items-center justify-between gap-3"><div><p className="text-xs font-black text-stone-700">啟用排程</p><p className="text-[11px] text-stone-400 font-bold mt-0.5">排程時段內自動切為全域上報。</p></div><button onClick={()=>setScheduleForm((prev)=>({ ...prev, scheduleEnabled: !prev.scheduleEnabled }))} className={`w-12 h-7 rounded-full p-1 transition-all ${scheduleForm.scheduleEnabled ? "bg-[#D8B46B]" : "bg-stone-300"}`}><span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${scheduleForm.scheduleEnabled ? "translate-x-5" : "translate-x-0"}`} /></button></div><div><label className="text-[11px] font-black text-stone-400 block mb-1.5 tracking-wider">開始時間</label><SoftInput type="time" value={scheduleForm.startTime} onChange={(e)=>setScheduleForm((prev)=>({ ...prev, startTime: e.target.value }))} /></div><div><label className="text-[11px] font-black text-stone-400 block mb-1.5 tracking-wider">結束時間</label><SoftInput type="time" value={scheduleForm.endTime} onChange={(e)=>setScheduleForm((prev)=>({ ...prev, endTime: e.target.value }))} /></div><div className="flex gap-2"><BeautyButton onClick={handleApplyScheduleNow} variant="secondary" className="whitespace-nowrap">立即套用</BeautyButton><BeautyButton onClick={handleSaveReadTrackerSchedule} variant="primary" className="whitespace-nowrap"><Save size={14} />儲存排程</BeautyButton></div></div><div className="px-5 py-3 bg-amber-50/50 border-t border-amber-100/60 text-[11px] text-amber-700 font-bold leading-relaxed">目前套用品牌：{brandLabel}。排程啟用後，非排程時段會自動關閉追蹤；排程時段內會自動啟用全域上報。</div></div></div>
          <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-6"><div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between"><div className="flex items-center gap-2"><Activity size={16} className="text-emerald-500" /><span className="text-sm font-black text-stone-700">目前裝置統計</span></div><div className="flex items-center gap-2"><button onClick={handleManualFlushReadTracker} disabled={loadingReadStats || readTrackerMode !== "global"} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-40">手動上報</button><button onClick={handleClearReadTracker} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-rose-100 text-rose-500 hover:bg-rose-50">清除</button></div></div>{renderStatList({ rows: readStatsRows, emptyIcon: BarChart3, emptyText: "尚無本機讀取追蹤資料" })}</div><div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between"><div className="flex items-center gap-2"><Globe2 size={16} className="text-blue-500" /><span className="text-sm font-black text-stone-700">近 24 小時全域排行</span></div><button onClick={handleLoadGlobalReadStats} disabled={loadingReadStats} className="text-[11px] font-black px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-amber-200 disabled:opacity-40 flex items-center gap-1.5">{loadingReadStats ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}載入排行</button></div>{globalReadStats.length > 0 && <div className="p-4 pb-0 text-[11px] text-stone-400 font-bold">已彙整近 24 小時 {globalRowsCount.toLocaleString()} 筆上報工作階段</div>}{renderStatList({ rows: globalReadStats, emptyIcon: Globe2, emptyText: "尚未載入全域讀取排行", valueClass: "text-blue-600" })}</div></div>
        </section>

        <section className="rounded-[2rem] border border-[#EEDFC7] bg-white/95 shadow-[0_22px_70px_rgba(120,90,40,0.05)] overflow-hidden"><button onClick={()=>setShowAdvancedTools((prev)=>!prev)} className="w-full p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-left"><SectionTitle eyebrow="Advanced Repair" title="進階資料修復" desc="高風險或低頻使用工具已收合，避免日常操作誤觸。" icon={AlertTriangle} /><div className="inline-flex items-center gap-2 text-xs font-black text-stone-500 bg-stone-50 border border-stone-200 rounded-2xl px-3 py-2 w-fit">{showAdvancedTools ? "收合工具" : "展開工具"}<ChevronDown size={14} className={`transition-transform ${showAdvancedTools ? "rotate-180" : ""}`} /></div></button>
          {showAdvancedTools && <div className="px-6 pb-6 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300"><ToolRow icon={Database} title="日期格式修復" desc="先掃描日期格式異常，再確認是否批次修復為 YYYY-MM-DD。" badge={dateIssues.length ? `${dateIssues.length} 筆預覽` : "兩段式"}><BeautyButton onClick={handleScanDateFormats} disabled={loadingAction !== null} variant="secondary">{loadingAction === "scanDates" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}掃描日期</BeautyButton><BeautyButton onClick={handleFixDateFormats} disabled={loadingAction !== null || dateIssues.length === 0} variant="primary">{loadingAction === "fixDates" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}修復日期</BeautyButton></ToolRow>{dateIssues.length > 0 && <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50/40 p-4 text-xs font-bold text-amber-800 space-y-1"><p className="font-black">日期異常預覽</p>{dateIssues.slice(0,5).map((item)=><p key={`${item.colName}_${item.id}`}>{item.colName}｜{item.store}｜{item.person}｜{item.oldDate} → {item.newDate}</p>)}</div>}
          <ToolRow icon={Scissors} title="重複資料檢測與封存" desc="預設只檢測，不再一鍵刪除。確認後會將舊資料標記封存。" badge={duplicateGroups.length ? `${duplicateGroups.length} 組預覽` : "安全版"} tone="rose"><BeautyButton onClick={handleScanDuplicates} disabled={loadingAction !== null} variant="secondary">{loadingAction === "scanDups" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}檢測重複</BeautyButton><BeautyButton onClick={handleArchiveDuplicates} disabled={loadingAction !== null || duplicateGroups.length === 0} variant="soft">{loadingAction === "archiveDups" ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}封存舊資料</BeautyButton></ToolRow>{duplicateGroups.length > 0 && <div className="rounded-[1.5rem] border border-rose-100 bg-rose-50/30 p-4 text-xs font-bold text-rose-700 space-y-1"><p className="font-black">重複資料預覽</p>{duplicateGroups.slice(0,5).map((group)=><p key={`${group.colName}_${group.key}`}>{group.colName}｜{group.date}｜{group.store}｜{group.person}｜保留 1 筆、封存 {group.duplicateIds.length} 筆</p>)}</div>}
          <ToolRow icon={RefreshCw} title="封存資料檢視與還原" desc="查看已封存的疑似重複資料，可單筆還原。" badge={archivedDuplicates.length ? `${archivedDuplicates.length} 筆` : "可還原"}><div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><input type="month" value={archiveFilterMonth} onChange={(e)=>setArchiveFilterMonth(e.target.value)} className="bg-transparent text-xs font-black text-stone-700 outline-none w-28" /></div><BeautyButton onClick={handleLoadArchivedDuplicates} disabled={loadingAction !== null} variant="secondary">{loadingAction === "loadArchived" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}載入封存</BeautyButton></ToolRow>{archivedDuplicates.length > 0 && <div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 p-4 space-y-2 max-h-[340px] overflow-y-auto"><p className="text-xs font-black text-stone-700">封存資料清單</p>{archivedDuplicates.slice(0,30).map((row)=><div key={`${row.colName}_${row.id}`} className="bg-white border border-stone-100 rounded-2xl p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div className="min-w-0"><p className="text-xs font-black text-stone-700 truncate">{row.colName}｜{row.date}｜{row.store}｜{row.person}</p><p className="text-[10px] font-bold text-stone-400 mt-1">保留文件：{row.keepId}｜封存時間：{row.archivedAt}</p></div><BeautyButton onClick={()=>handleRestoreArchivedDuplicate(row)} disabled={loadingAction !== null} variant="soft" className="h-9 px-4 shrink-0">{loadingAction === `restore_${row.id}` ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}還原</BeautyButton></div>)}</div>}</div>}
        </section>

        <section className="rounded-[2rem] border border-stone-100 bg-white/90 p-6 shadow-[0_16px_50px_rgba(120,90,40,0.04)]"><ToolRow icon={RefreshCw} title="清除本機快取" desc="只清除目前瀏覽器暫存，不會刪除雲端資料。適合畫面異常、舊版快取或登入狀態卡住時使用。" badge="本機排錯"><BeautyButton onClick={handleClearLocalCache} variant="secondary"><RefreshCw size={14} />清除快取並重載</BeautyButton></ToolRow></section>

        <section className="rounded-[2rem] border border-stone-100 bg-[#FFFCF7] p-6 shadow-[inset_0_2px_10px_rgba(120,90,40,0.02)]"><div className="flex justify-between items-center mb-4"><div className="flex items-center gap-2 text-stone-600"><ClipboardList size={18} strokeWidth={2} className="text-[#B7863D]" /><span className="font-black tracking-tight text-sm">系統稽核日誌</span></div><div className="flex items-center gap-3">{loadingAction && <span className="text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-xl font-black animate-pulse flex items-center gap-1.5 border border-amber-100/50"><Loader2 size={14} className="animate-spin" />執行中...</span>}{logs.length > 0 && !loadingAction && <button onClick={()=>setLogs([])} className="text-xs font-black text-stone-400 hover:text-rose-500 transition-colors flex items-center gap-1 px-2 py-1"><Trash2 size={14} />清除</button>}</div></div><div className="bg-white rounded-[1.5rem] p-5 font-mono text-[13px] h-[280px] overflow-y-auto border border-stone-200/50 shadow-sm space-y-2 selection:bg-amber-100">{logs.length === 0 ? <div className="flex h-full items-center justify-center flex-col gap-3 opacity-50"><ClipboardList size={36} className="text-stone-300" strokeWidth={1.5} /><span className="text-xs font-black tracking-widest text-stone-400 uppercase">System Ready...</span></div> : logs.map((log)=>{ const isError = log.text.includes("❌"); const isFix = log.text.includes("✏️"); const isDel = log.text.includes("🗑️"); const isSuccess = log.text.includes("✅") || log.text.includes("🎉") || log.text.includes("✨") || log.text.includes("🔄") || log.text.includes("↩️"); let textColor = "text-stone-500"; if (isError) textColor = "text-rose-500 font-black"; else if (isFix) textColor = "text-amber-600"; else if (isDel) textColor = "text-stone-400 line-through"; else if (isSuccess) textColor = "text-stone-800 font-black"; return <div key={log.id} className="border-b border-stone-50 pb-2.5 last:border-0 hover:bg-stone-50 rounded px-2 -mx-2 transition-colors flex items-start gap-3"><span className="text-stone-400 shrink-0 select-none pt-0.5">[{log.time}]</span><span className={`${textColor} break-all leading-relaxed`}>{log.text}</span></div>; })}</div></section>
      </div>
    </ViewWrapper>
  );
}
