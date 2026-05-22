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
  const [closingReport, setClosingReport] = useState(null);
  const [dataVolumeRows, setDataVolumeRows] = useState([]);
  const [archivedDuplicates, setArchivedDuplicates] = useState([]);
  const [backupRecords, setBackupRecords] = useState([]);
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
  const countNegativeNumbers = (data) => Object.entries(data || {}).filter(([, value]) => typeof value === "number" && value < 0).length;

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

  const getAllStoresFromOrg = async () => {
    try {
      const snap = await getDoc(getDocPath("org_structure"));
      const managers = snap.exists() ? snap.data()?.managers || {} : {};
      return [...new Set(Object.values(managers).flat().filter(Boolean))];
    } catch {
      return [];
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

  const StatList = ({ rows, emptyIcon: EmptyIcon, emptyText, valueClass = "text-[#B7863D]" }) => (
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
    setLoadingAction("healthCheck"); setLogs([]); addLog(`🩺 啟動 ${brandLabel} 資料健康檢查...`);
    try {
      const stores = await getAllStoresFromOrg();
      const storeSet = new Set(stores);
      const issues = [];
      let scanned = 0;
      for (const colName of ["daily_reports", "therapist_daily_reports"]) {
        const snap = await getDocs(getCollectionPath(colName));
        const row = { missingDate: 0, invalidDate: 0, missingStore: 0, unknownStore: 0, negativeNumbers: 0, archivedDuplicates: 0 };
        snap.docs.forEach((docSnap) => {
          scanned++;
          const data = docSnap.data();
          const date = data.date || "";
          const store = getStoreName(data);
          if (!date) row.missingDate++;
          else if (!isValidYYYYMMDD(formatDateString(date))) row.invalidDate++;
          if (!store) row.missingStore++;
          else if (storeSet.size && !storeSet.has(store)) row.unknownStore++;
          row.negativeNumbers += countNegativeNumbers(data);
          if (data.isArchivedDuplicate === true) row.archivedDuplicates++;
        });
        Object.entries(row).forEach(([key, count]) => { if (count) issues.push({ label: `${colName}｜${key}`, count }); });
        addLog(`✅ ${colName}: ${snap.size.toLocaleString()} 筆，提醒 ${Object.values(row).reduce((a,b)=>a+b,0).toLocaleString()} 項。`);
      }
      setHealthReport({ scanned, issues, createdAt: new Date().toLocaleString("zh-TW", { hour12: false }) });
      showToast(issues.length ? `健康檢查完成，發現 ${issues.length} 類提醒` : "健康檢查完成，未發現明顯異常", issues.length ? "info" : "success");
    } catch (error) { addLog(`❌ 健康檢查失敗: ${error.message}`); showToast("資料健康檢查失敗", "error"); }
    finally { setLoadingAction(null); }
  };

  // 新增工具：月結前檢查
  const handleRunClosingCheck = async () => {
    setLoadingAction("closingCheck"); setLogs([]); addLog(`📅 啟動 ${calMonth} 月結前檢查...`);
    try {
      const monthDates = getMonthDates(calMonth);
      const stores = await getAllStoresFromOrg();
      const [dailySnap, therapistSnap, targetSnap, therapistListSnap] = await Promise.all([getDocs(getCollectionPath("daily_reports")), getDocs(getCollectionPath("therapist_daily_reports")), getDocs(getCollectionPath("monthly_targets")), getDocs(getCollectionPath("therapists"))]);
      const dailyThisMonth = dailySnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => String(d.date || "").startsWith(calMonth) && d.isArchivedDuplicate !== true);
      const therapistThisMonth = therapistSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => String(d.date || "").startsWith(calMonth) && d.isArchivedDuplicate !== true);
      const activeTherapists = therapistListSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => !(t.isResigned === true || t.status === "resigned" || t.status === "離職" || t.isActive === false));
      const dailyKeys = new Set(dailyThisMonth.map((d) => `${d.date}_${getStoreName(d)}`));
      const therapistKeys = new Set(therapistThisMonth.map((d) => `${d.date}_${getStoreName(d)}_${getTherapistName(d)}`));
      const missingStoreReports = [];
      stores.forEach((store) => monthDates.forEach((date) => { if (!dailyKeys.has(`${date}_${store}`)) missingStoreReports.push({ date, store }); }));
      const missingTherapistReports = [];
      activeTherapists.forEach((t) => {
        const store = t.store || t.storeName || ""; const name = t.name || t.therapistName || "";
        if (!store || !name) return;
        monthDates.forEach((date) => { if (!therapistKeys.has(`${date}_${store}_${name}`)) missingTherapistReports.push({ date, store, name }); });
      });
      const duplicateDailyCount = dailyThisMonth.length - new Set(dailyThisMonth.map((d) => `${d.date}_${getStoreName(d)}`)).size;
      const duplicateTherapistCount = therapistThisMonth.length - new Set(therapistThisMonth.map((d) => `${d.date}_${getStoreName(d)}_${getTherapistName(d)}`)).size;
      const warnings = [
        { label: "缺少店日報", count: missingStoreReports.length },
        { label: "缺少管理師日報", count: missingTherapistReports.length },
        { label: "疑似重複店日報", count: Math.max(0, duplicateDailyCount) },
        { label: "疑似重複管理師日報", count: Math.max(0, duplicateTherapistCount) },
        { label: "本月目標文件數", count: targetSnap.size, neutral: true },
      ];
      setClosingReport({ month: calMonth, checkedDays: monthDates.length, stores: stores.length, activeTherapists: activeTherapists.length, dailyReports: dailyThisMonth.length, therapistReports: therapistThisMonth.length, targetsCount: targetSnap.size, missingStoreReports: missingStoreReports.slice(0, 30), missingTherapistReports: missingTherapistReports.slice(0, 30), warnings, createdAt: new Date().toLocaleString("zh-TW", { hour12: false }) });
      addLog(`✅ 月結前檢查完成：店日報 ${dailyThisMonth.length.toLocaleString()} 筆、管理師日報 ${therapistThisMonth.length.toLocaleString()} 筆。`);
      showToast("月結前檢查完成", "success");
    } catch (error) { addLog(`❌ 月結前檢查失敗: ${error.message}`); showToast("月結前檢查失敗", "error"); }
    finally { setLoadingAction(null); }
  };

  // 既有主要工具：校準與備份
  const backupCollections = { daily: ["daily_reports", "therapist_daily_reports"], settings: ["monthly_targets", "therapist_targets", "therapist_schedules", "therapists"], full: ["daily_reports", "therapist_daily_reports", "monthly_aggregated", "therapist_monthly_aggregated", "monthly_targets", "therapist_targets", "therapist_schedules", "therapists"] };
  const backupDocs = ["org_structure", "store_account_data", "manager_auth", "permissions", "trainer_auth", "audit_exclusions", "security_config", "read_tracker_config", "director_auth", "master_auth"];

  const handleCalibrateData = async () => {
    if (!window.confirm(`確定要針對【${brandId}】在 ${calMonth} 的數據執行校準嗎？`)) return;
    setLoadingAction("calibrate"); setLogs([]); addLog(`🔄 啟動數據盤點與校準... 目標: ${brandId}, 月份: ${calMonth}`);
    try {
      const response = await fetch(`https://recalculatemonthlydata-hyhcwrnyaa-uc.a.run.app?brandId=${brandId}&yearMonth=${calMonth}`);
      if (!response.ok) throw new Error("伺服器回應異常");
      const result = await response.text(); addLog(result); showToast("校準完成", "success");
    } catch (err) { addLog(`❌ 校準失敗: ${err.message}`); showToast("校準失敗", "error"); }
    finally { setLoadingAction(null); }
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
    setLoadingAction("dataVolume"); setLogs([]); addLog(`📊 載入 ${brandLabel} 資料量概況...`);
    try {
      const rows = [];
      for (const colName of ["daily_reports", "therapist_daily_reports", "monthly_aggregated", "therapist_monthly_aggregated", "monthly_targets", "therapist_targets", "therapist_schedules", "therapists"]) {
        const snap = await getDocs(getCollectionPath(colName));
        rows.push({ colName, count: snap.size, archivedCount: snap.docs.filter((d) => d.data()?.isArchivedDuplicate === true).length });
        addLog(`✅ ${colName}: ${snap.size.toLocaleString()} 筆`);
      }
      setDataVolumeRows(rows.sort((a, b) => b.count - a.count)); showToast("資料量概況已更新", "success");
    } catch (error) { addLog(`❌ 載入資料量失敗: ${error.message}`); showToast("資料量概況載入失敗", "error"); }
    finally { setLoadingAction(null); }
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
    setLoadingAction("loadArchived"); setLogs([]); addLog("📦 載入封存資料清單...");
    try { const rows = []; for (const colName of ["daily_reports", "therapist_daily_reports"]) { const snap = await getDocs(getCollectionPath(colName)); snap.docs.forEach((docSnap) => { const data = docSnap.data(); if (data.isArchivedDuplicate !== true) return; if (archiveFilterMonth && data.date && !String(data.date).startsWith(archiveFilterMonth)) return; rows.push({ id: docSnap.id, colName, date: data.date || "—", store: getStoreName(data) || "—", person: getTherapistName(data) || "店務總表", keepId: data.duplicateKeepId || "—", archivedAt: data.duplicateArchivedAtText || "—" }); }); } setArchivedDuplicates(rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,200)); showToast(`已載入 ${rows.length.toLocaleString()} 筆封存資料`, "success"); }
    catch (error) { addLog(`❌ 載入封存資料失敗: ${error.message}`); showToast("封存資料載入失敗", "error"); }
    finally { setLoadingAction(null); }
  };

  const handleRestoreArchivedDuplicate = async (row) => {
    if (!window.confirm(`確定要還原這筆封存資料嗎？\n${row.date}｜${row.store}｜${row.person}\n還原後可能會重新納入報表與月結計算。`)) return;
    setLoadingAction(`restore_${row.id}`);
    try { await updateDoc(doc(getCollectionPath(row.colName), row.id), { isArchivedDuplicate: false, restoredFromDuplicateArchiveAt: serverTimestamp(), restoredFromDuplicateArchiveAtText: new Date().toISOString(), restoredBy: currentUser?.name || "director" }); setArchivedDuplicates((prev)=>prev.filter((item)=>!(item.id===row.id && item.colName===row.colName))); addLog(`↩️ 已還原封存資料：${row.colName}｜${row.date}｜${row.store}｜${row.person}`); showToast("封存資料已還原", "success"); }
    catch (error) { addLog(`❌ 還原失敗: ${error.message}`); showToast("還原封存資料失敗", "error"); }
    finally { setLoadingAction(null); }
  };

  const handleClearLocalCache = () => { if (!window.confirm("這只會清除目前瀏覽器暫存，不會刪除雲端資料。確定要繼續嗎？")) return; addLog("🧹 清除本機快取並重新載入..."); localStorage.clear(); window.location.reload(true); };

  return (
    <ViewWrapper>
      <div className="max-w-5xl mx-auto space-y-6 pb-10 animate-in fade-in duration-500">
        <section className="rounded-[2rem] border border-[#EEDFC7] bg-gradient-to-br from-[#FFFCF7] via-white to-[#FFF7E8] p-6 shadow-[0_22px_70px_rgba(120,90,40,0.06)]">
          <SectionTitle eyebrow="Maintenance Core" title="主要維護工具" desc="保留長期必要功能：月度校準、品牌備份與資料品質檢查。" icon={Settings} />
          <div className="mt-6 space-y-3">
            <ToolRow icon={CheckCircle2} title="資料健康檢查" desc="掃描日期、店家、負數欄位、封存重複資料等常見異常。只讀取、不修改資料。" badge="低風險" tone="emerald">
              <BeautyButton onClick={handleRunDataHealthCheck} disabled={loadingAction !== null} variant="primary">{loadingAction === "healthCheck" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}執行檢查</BeautyButton>
            </ToolRow>
            {healthReport && <div className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50/30 p-4"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3"><p className="text-sm font-black text-stone-800">健康檢查結果</p><p className="text-[11px] font-bold text-stone-400">掃描 {healthReport.scanned.toLocaleString()} 筆｜{healthReport.createdAt}</p></div>{healthReport.issues.length === 0 ? <p className="text-xs font-bold text-emerald-700">目前未發現明顯異常。</p> : <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{healthReport.issues.map((item)=><div key={item.label} className="bg-white/90 border border-stone-100 rounded-2xl p-3 flex items-center justify-between"><span className="text-xs font-black text-stone-600">{item.label}</span><span className="text-sm font-black text-[#B7863D]">{item.count.toLocaleString()}</span></div>)}</div>}</div>}
            <ToolRow icon={Calendar} title="月結前檢查" desc="檢查指定月份缺報、重複資料與目標設定。只讀取、不修改資料。" badge="月結流程">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><input type="month" value={calMonth} onChange={(e)=>setCalMonth(e.target.value)} className="bg-transparent text-xs font-black text-stone-700 outline-none w-28" /></div>
              <BeautyButton onClick={handleRunClosingCheck} disabled={loadingAction !== null} variant="primary">{loadingAction === "closingCheck" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}檢查月結</BeautyButton>
            </ToolRow>
            {closingReport && <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50/30 p-4 space-y-3"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><p className="text-sm font-black text-stone-800">{closingReport.month} 月結前檢查</p><p className="text-[11px] font-bold text-stone-400">檢查 {closingReport.checkedDays} 天｜店家 {closingReport.stores}｜在職管理師 {closingReport.activeTherapists}</p></div><div className="grid grid-cols-1 md:grid-cols-5 gap-2">{closingReport.warnings.map((item)=><div key={item.label} className="bg-white/90 border border-stone-100 rounded-2xl p-3"><p className="text-[11px] font-black text-stone-400">{item.label}</p><p className={`mt-1 text-xl font-black ${item.neutral ? "text-stone-700" : item.count ? "text-[#B7863D]" : "text-emerald-600"}`}>{item.count.toLocaleString()}</p></div>)}</div></div>}
            <ToolRow icon={Play} title="月度數據重新校準" desc="重新掃描指定月份日報並修正彙整表，適合數字對帳或月結資料異常時使用。" badge="建議保留" tone="emerald">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><input type="month" value={calMonth} onChange={(e) => setCalMonth(e.target.value)} className="bg-transparent text-xs font-black text-stone-700 outline-none w-28" /></div>
              <BeautyButton onClick={handleCalibrateData} disabled={loadingAction !== null} variant="primary">{loadingAction === "calibrate" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}啟動校準</BeautyButton>
            </ToolRow>
            <ToolRow icon={Download} title="品牌資料備份" desc="依需求匯出日報、設定或完整品牌資料，並寫入備份紀錄。" badge="升級版">
              <div className="relative min-w-[180px]"><select value={backupType} onChange={(e)=>setBackupType(e.target.value)} className="h-11 w-full appearance-none rounded-2xl bg-white border border-stone-200 px-4 pr-9 text-xs font-black text-stone-700 outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-50"><option value="daily">日報備份</option><option value="settings">設定備份</option><option value="full">完整品牌備份</option></select><ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" /></div>
              <BeautyButton onClick={handleBackupData} disabled={loadingAction !== null} variant="primary">{loadingAction === "backup" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}下載備份</BeautyButton>
            </ToolRow>
          </div>
        </section>

        <section className="rounded-[2rem] border border-[#EEDFC7] bg-white/95 shadow-[0_22px_70px_rgba(120,90,40,0.05)] overflow-hidden">
          <div className="p-6 border-b border-[#F0E3CF]"><SectionTitle eyebrow="Data Observability" title="資料量概況與備份紀錄" desc="掌握資料規模、封存筆數與備份歷史。" icon={BarChart3} /></div>
          <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between"><div className="flex items-center gap-2"><BarChart3 size={16} className="text-[#B7863D]" /><span className="text-sm font-black text-stone-700">資料量概況</span></div><button onClick={handleLoadDataVolume} disabled={loadingAction !== null} className="text-[11px] font-black px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-amber-200 disabled:opacity-40 flex items-center gap-1.5">{loadingAction === "dataVolume" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}載入概況</button></div><div className="p-4 space-y-2 max-h-[320px] overflow-y-auto">{dataVolumeRows.length === 0 ? <div className="h-40 flex flex-col items-center justify-center text-stone-300 gap-2"><BarChart3 size={30} /><p className="text-xs font-black">尚未載入資料量</p></div> : dataVolumeRows.map((row)=><div key={row.colName} className="bg-white rounded-2xl border border-stone-100 p-3 flex items-center justify-between gap-3"><div><p className="text-xs font-black text-stone-700">{row.colName}</p><p className="text-[10px] font-bold text-stone-400">封存重複 {row.archivedCount.toLocaleString()} 筆</p></div><p className="text-sm font-black text-[#B7863D]">{row.count.toLocaleString()}</p></div>)}</div></div>
            <div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between"><div className="flex items-center gap-2"><ClipboardList size={16} className="text-[#B7863D]" /><span className="text-sm font-black text-stone-700">備份紀錄</span></div><button onClick={handleLoadBackupRecords} disabled={loadingAction !== null} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-40 flex items-center gap-1.5">{loadingAction === "backupRecords" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}載入紀錄</button></div><div className="p-4 space-y-2 max-h-[320px] overflow-y-auto">{backupRecords.length === 0 ? <div className="h-40 flex flex-col items-center justify-center text-stone-300 gap-2"><ClipboardList size={30} /><p className="text-xs font-black">尚未載入備份紀錄</p></div> : backupRecords.map((row)=><div key={row.id} className="bg-white rounded-2xl border border-stone-100 p-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-black text-stone-700 truncate">{row.fileName || row.backupType}</p><span className="text-[10px] font-black text-[#B7863D] bg-amber-50 border border-amber-100 rounded-full px-2 py-1">{row.backupType}</span></div><p className="mt-1 text-[10px] font-bold text-stone-400">{row.createdAtText || "—"}｜{row.exportedBy || "—"}｜{Number(row.totalDocs || 0).toLocaleString()} docs</p></div>)}</div></div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-[#EEDFC7] bg-white/95 shadow-[0_22px_70px_rgba(120,90,40,0.05)] overflow-hidden">
          <div className="p-6 border-b border-[#F0E3CF] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"><SectionTitle eyebrow="Traffic Diagnosis" title="讀取來源追蹤" desc="用來判斷晚間讀取暴增是由哪一個資料來源、頁面或角色造成。" icon={Radio} />
            <div className="flex flex-wrap gap-2">{[{ id: "off", label: "關閉", icon: Power }, { id: "local", label: "本機模式", icon: Monitor }, { id: "global", label: "全域上報", icon: Globe2 }].map((mode)=><button key={mode.id} onClick={()=>handleChangeReadTrackerMode(mode.id)} className={`px-4 py-2 rounded-2xl text-xs font-black border flex items-center gap-2 transition-all ${readTrackerMode === mode.id ? "bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border-amber-200 shadow-[0_10px_24px_rgba(190,145,70,0.16)]" : "bg-white text-stone-500 border-stone-200 hover:bg-stone-50"}`}><mode.icon size={14} />{mode.label}</button>)}</div>
          </div>
          <div className="p-6 border-b border-[#F0E3CF] bg-[#FFFCF7]"><div className="rounded-[1.75rem] border border-[#EEDFC7] bg-white shadow-sm overflow-hidden"><div className="p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 border-b border-stone-100"><div className="min-w-0"><h3 className="text-sm font-black text-stone-800 flex items-center gap-2"><Clock size={18} className="text-[#B7863D]" />排程式全域上報</h3><p className="text-xs text-stone-400 font-bold mt-1">固定晚間診斷區間，讓每天數據可比較；支援跨日，例如 19:00～07:00。</p></div><div className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-black border ${!scheduleForm.scheduleEnabled ? "bg-stone-50 text-stone-500 border-stone-200" : scheduleStatus.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-amber-50 text-amber-700 border-amber-100"}`}><CheckCircle2 size={15} />{scheduleStatus.label}｜現在 {scheduleStatus.nowTime}</div></div>
            <div className="p-5 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr_1fr_auto] gap-3 items-end"><div className="rounded-2xl border border-stone-100 bg-stone-50/70 p-3 flex items-center justify-between gap-3"><div><p className="text-xs font-black text-stone-700">啟用排程</p><p className="text-[11px] text-stone-400 font-bold mt-0.5">排程時段內自動切為全域上報。</p></div><button onClick={()=>setScheduleForm((prev)=>({ ...prev, scheduleEnabled: !prev.scheduleEnabled }))} className={`w-12 h-7 rounded-full p-1 transition-all ${scheduleForm.scheduleEnabled ? "bg-[#D8B46B]" : "bg-stone-300"}`}><span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${scheduleForm.scheduleEnabled ? "translate-x-5" : "translate-x-0"}`} /></button></div><div><label className="text-[11px] font-black text-stone-400 block mb-1.5 tracking-wider">開始時間</label><SoftInput type="time" value={scheduleForm.startTime} onChange={(e)=>setScheduleForm((prev)=>({ ...prev, startTime: e.target.value }))} /></div><div><label className="text-[11px] font-black text-stone-400 block mb-1.5 tracking-wider">結束時間</label><SoftInput type="time" value={scheduleForm.endTime} onChange={(e)=>setScheduleForm((prev)=>({ ...prev, endTime: e.target.value }))} /></div><div className="flex gap-2"><BeautyButton onClick={handleApplyScheduleNow} variant="secondary" className="whitespace-nowrap">立即套用</BeautyButton><BeautyButton onClick={handleSaveReadTrackerSchedule} variant="primary" className="whitespace-nowrap"><Save size={14} />儲存排程</BeautyButton></div></div><div className="px-5 py-3 bg-amber-50/50 border-t border-amber-100/60 text-[11px] text-amber-700 font-bold leading-relaxed">目前套用品牌：{brandLabel}。排程啟用後，非排程時段會自動關閉追蹤；排程時段內會自動啟用全域上報。</div></div></div>
          <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-6"><div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between"><div className="flex items-center gap-2"><Activity size={16} className="text-emerald-500" /><span className="text-sm font-black text-stone-700">目前裝置統計</span></div><div className="flex items-center gap-2"><button onClick={handleManualFlushReadTracker} disabled={loadingReadStats || readTrackerMode !== "global"} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-40">手動上報</button><button onClick={handleClearReadTracker} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-rose-100 text-rose-500 hover:bg-rose-50">清除</button></div></div><StatList rows={readStatsRows} emptyIcon={BarChart3} emptyText="尚無本機讀取追蹤資料" /></div><div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between"><div className="flex items-center gap-2"><Globe2 size={16} className="text-blue-500" /><span className="text-sm font-black text-stone-700">近 24 小時全域排行</span></div><button onClick={handleLoadGlobalReadStats} disabled={loadingReadStats} className="text-[11px] font-black px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-amber-200 disabled:opacity-40 flex items-center gap-1.5">{loadingReadStats ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}載入排行</button></div>{globalReadStats.length > 0 && <div className="p-4 pb-0 text-[11px] text-stone-400 font-bold">已彙整近 24 小時 {globalRowsCount.toLocaleString()} 筆上報工作階段</div>}<StatList rows={globalReadStats} emptyIcon={Globe2} emptyText="尚未載入全域讀取排行" valueClass="text-blue-600" /></div></div>
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
