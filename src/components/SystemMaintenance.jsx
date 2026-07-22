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
  Target,
  Eye,
  Power,
  Globe2,
  Monitor,
  Clock,
  Save,
  CheckCircle2,
  ChevronDown,
  Shield,
  Sparkles,
} from "lucide-react";
import { ViewWrapper } from "./SharedUI";
import SmartCalendar from "./SmartCalendar";
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
  const [showCoreTools, setShowCoreTools] = useState(false);
  const [activeMaintenanceScenario, setActiveMaintenanceScenario] = useState("daily");
  const [guidedFlowReport, setGuidedFlowReport] = useState(null);
  const [guidedFlowRunning, setGuidedFlowRunning] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
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
  const [summaryStatusReport, setSummaryStatusReport] = useState(null);
  const [archiveFilterMonth, setArchiveFilterMonth] = useState(todayMonth());
  const [targetSummaryYear, setTargetSummaryYear] = useState(String(new Date().getFullYear()));
  const [targetSummaryReport, setTargetSummaryReport] = useState(null);

  const [readTrackerMode, setReadTrackerModeState] = useState(getReadTrackerMode());
  const [localReadStats, setLocalReadStats] = useState({});
  const [localReadClearedAt, setLocalReadClearedAt] = useState(null);
  const [localReadLastRefreshedAt, setLocalReadLastRefreshedAt] = useState(null);
  const [globalReadStats, setGlobalReadStats] = useState([]);
  const [loadingReadStats, setLoadingReadStats] = useState(false);
  const [globalRowsCount, setGlobalRowsCount] = useState(0);
  const [globalReadRangeUnsupportedCount, setGlobalReadRangeUnsupportedCount] = useState(0);
  const [globalReadRangeLegacyFallback, setGlobalReadRangeLegacyFallback] = useState(false);
  const [globalReadScopeLabel, setGlobalReadScopeLabel] = useState("近 24 小時全域排行");
  const [globalReadRange, setGlobalReadRange] = useState(() => {
    const now = new Date();
    const end = new Date(now);
    end.setMinutes(0, 0, 0);
    const start = new Date(end);
    start.setHours(start.getHours() - 1);
    const toLocalInput = (date) => {
      const pad = (num) => String(num).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    return { start: toLocalInput(start), end: toLocalInput(end) };
  });
  const [globalReadCalendarTarget, setGlobalReadCalendarTarget] = useState(null);
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
  const isSelectedCurrentMonth = (month = calMonth) => String(month || "") === todayMonth();

  const toDateKey = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const pad = (num) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const toDateTimeLocalValue = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const pad = (num) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const makeGlobalReadRange = (preset) => {
    const now = new Date();
    const end = new Date(now);
    end.setMinutes(0, 0, 0);
    const start = new Date(end);

    if (preset === "last1h") {
      start.setHours(end.getHours() - 1);
    } else if (preset === "overnight") {
      const base = new Date(now);
      if (base.getHours() < 12) base.setDate(base.getDate() - 1);
      start.setFullYear(base.getFullYear(), base.getMonth(), base.getDate());
      start.setHours(18, 0, 0, 0);
      end.setFullYear(base.getFullYear(), base.getMonth(), base.getDate() + 1);
      end.setHours(7, 0, 0, 0);
    } else if (preset === "early4to5") {
      const base = new Date(now);
      if (base.getHours() < 5) base.setDate(base.getDate() - 1);
      start.setFullYear(base.getFullYear(), base.getMonth(), base.getDate());
      start.setHours(4, 0, 0, 0);
      end.setFullYear(base.getFullYear(), base.getMonth(), base.getDate());
      end.setHours(5, 0, 0, 0);
    }

    return { start: toDateTimeLocalValue(start), end: toDateTimeLocalValue(end) };
  };

  const getDateKeysAroundRange = (startDate, endDate) => {
    const keys = new Set();
    const cursor = new Date(startDate);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - 1);

    const finalDate = new Date(endDate);
    finalDate.setHours(0, 0, 0, 0);
    finalDate.setDate(finalDate.getDate() + 1);

    let safety = 0;
    while (cursor <= finalDate && safety < 10) {
      keys.add(toDateKey(cursor));
      keys.add(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
      safety += 1;
    }
    return Array.from(keys).filter(Boolean);
  };

  const getReadableRangeLabel = (startValue, endValue) => {
    const startDate = new Date(startValue);
    const endDate = new Date(endValue);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "指定時段全域排行";
    const fmt = (date) => date.toLocaleString("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${fmt(startDate)}～${fmt(endDate)} 全域排行`;
  };

  const getReadableRangeText = (startValue, endValue) => {
    const startDate = new Date(startValue);
    const endDate = new Date(endValue);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "目前選擇的時段";
    const fmt = (date) => date.toLocaleString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${fmt(startDate)}～${fmt(endDate)}`;
  };

  const getGlobalRangeDatePart = (value) => {
    const text = String(value || "");
    return text.includes("T") ? text.split("T")[0] : toDateKey(new Date());
  };

  const getGlobalRangeTimePart = (value) => {
    const text = String(value || "");
    return text.includes("T") ? (text.split("T")[1] || "00:00").slice(0, 5) : "00:00";
  };

  const setGlobalRangeDatePart = (key, dateValue) => {
    setGlobalReadRange((prev) => ({
      ...prev,
      [key]: `${dateValue}T${getGlobalRangeTimePart(prev[key])}`,
    }));
    setGlobalReadCalendarTarget(null);
  };

  const setGlobalRangeTimePart = (key, timeValue) => {
    setGlobalReadRange((prev) => ({
      ...prev,
      [key]: `${getGlobalRangeDatePart(prev[key])}T${timeValue}`,
    }));
  };

  const renderGlobalReadRangePicker = (key, label) => {
    const selectedValue = globalReadRange[key] || "";
    const selectedDate = getGlobalRangeDatePart(selectedValue);
    const selectedTime = getGlobalRangeTimePart(selectedValue);
    const selectedHour = selectedTime.slice(0, 2);
    const selectedMinute = selectedTime.slice(3, 5);
    const hourOptions = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
    const minuteOptions = ["00", "10", "20", "30", "40", "50"];

    return (
      <div className="relative">
        <p className="mb-1 text-[11px] font-black text-stone-500">{label}</p>
        <div className="rounded-2xl border border-stone-200 bg-white p-2 shadow-sm">
          <button
            type="button"
            onClick={() => setGlobalReadCalendarTarget((prev) => (prev === key ? null : key))}
            className="w-full rounded-xl border border-stone-100 bg-stone-50 px-3 py-2 text-left text-xs font-black text-stone-700 hover:bg-stone-100 flex items-center justify-between"
          >
            <span>{selectedDate}</span>
            <Calendar size={14} className="text-stone-400" />
          </button>

          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <select
              value={selectedHour}
              onChange={(e) => setGlobalRangeTimePart(key, `${e.target.value}:${selectedMinute}`)}
              className="w-full rounded-xl border border-stone-100 bg-white px-3 py-2 text-xs font-black text-stone-700 outline-none focus:border-blue-200"
            >
              {hourOptions.map((hour) => <option key={hour} value={hour}>{hour} 時</option>)}
            </select>
            <span className="text-xs font-black text-stone-300">:</span>
            <select
              value={selectedMinute}
              onChange={(e) => setGlobalRangeTimePart(key, `${selectedHour}:${e.target.value}`)}
              className="w-full rounded-xl border border-stone-100 bg-white px-3 py-2 text-xs font-black text-stone-700 outline-none focus:border-blue-200"
            >
              {minuteOptions.map((minute) => <option key={minute} value={minute}>{minute} 分</option>)}
            </select>
          </div>
        </div>

        {globalReadCalendarTarget === key && (
          <div className="absolute left-0 top-[104px] z-50">
            <SmartCalendar
              selectedDate={selectedDate}
              onDateSelect={(dateValue) => setGlobalRangeDatePart(key, dateValue)}
              onClose={() => setGlobalReadCalendarTarget(null)}
            />
          </div>
        )}
      </div>
    );
  };

  const buildGlobalReadSummaryRows = (rows, options = {}) => {
    const startMs = options.startMs ?? null;
    const endMs = options.endMs ?? null;
    const sourceSummary = {};
    const scopedRows = [];

    rows.forEach((row) => {
      const rowTime = row.updatedAtText ? new Date(row.updatedAtText).getTime() : 0;
      const isSameBrand = !brandId || !row.brandId || row.brandId === brandId;
      if (!isSameBrand) return;

      const rowSources = normalizeSourcesFromRow(row) || {};
      let rowUsed = false;

      Object.entries(rowSources).forEach(([label, item]) => {
        const sourceTime = item?.lastAt ? new Date(item.lastAt).getTime() : rowTime;
        if (startMs !== null && sourceTime < startMs) return;
        if (endMs !== null && sourceTime >= endMs) return;

        if (!sourceSummary[label]) {
          sourceSummary[label] = {
            label,
            docs: 0,
            triggers: 0,
            users: new Set(),
            roles: new Set(),
            devices: new Set(),
            lastAt: "",
          };
        }

        sourceSummary[label].docs += Number(item.docs || 0);
        sourceSummary[label].triggers += Number(item.triggers || 0);
        sourceSummary[label].users.add(row.userName || row.userRole || "unknown");
        sourceSummary[label].roles.add(row.userRole || "unknown");
        sourceSummary[label].devices.add(row.device || row.deviceShort || "unknown");
        if (!sourceSummary[label].lastAt || String(item.lastAt || row.updatedAtText || "") > sourceSummary[label].lastAt) {
          sourceSummary[label].lastAt = item.lastAt || row.updatedAtText || "";
        }
        rowUsed = true;
      });

      if (rowUsed) scopedRows.push(row);
    });

    const summaryRows = Object.values(sourceSummary)
      .map((item) => ({
        ...item,
        users: item.users.size,
        roles: Array.from(item.roles),
        devices: Array.from(item.devices),
        avg: item.triggers ? Math.round(item.docs / item.triggers) : 0,
      }))
      .sort((a, b) => b.docs - a.docs);

    return { summaryRows, scopedRows };
  };

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
      return { rows, groups, total: rows.length };
    } catch (error) {
      console.error(error);
      addLog(`❌ 載入待重算月份失敗: ${error.message}`);
      showToast("載入待重算月份失敗", "error");
      return { rows: [], groups: [], total: 0, error };
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

  const markSummaryRecalcFlagCompleted = async (month, payload = {}) => {
    if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return;
    try {
      await setDoc(doc(getCollectionPath("summary_recalc_flags"), month), {
        brandId,
        brandLabel,
        yearMonth: month,
        affectedYearMonth: month,
        status: payload.status || "verified",
        dirty: false,
        pendingCount: 0,
        lastCompletedAt: serverTimestamp(),
        lastCompletedAtText: new Date().toISOString(),
        lastCompletedBy: currentUser?.name || "director",
        lastCompletedByRole: userRole || "director",
        lastResult: payload.result || "month_report_finalized",
        lastMismatchCount: Number(payload.mismatchCount || 0),
        completedQueueCount: Number(payload.completedQueueCount || 0),
        updatedAt: serverTimestamp(),
        updatedAtText: new Date().toISOString(),
      }, { merge: true });
    } catch (error) {
      console.warn("summary_recalc_flags completed update failed", error);
    }
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

    // ★ 營業日報判斷：本月只檢查到「昨天」。
    // 店家通常在當日營業結束後才回報，白天不應把今天算成缺報。
    const isCurrentMonth = cursor.getFullYear() === today.getFullYear() && cursor.getMonth() === today.getMonth();
    const finalDay = isCurrentMonth ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1) : end;

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


  const refreshLocalReadStats = () => {
    setReadTrackerModeState(getReadTrackerMode());
    setLocalReadStats(getReadTrackerStats());
    setLocalReadLastRefreshedAt(new Date());
  };

  useEffect(() => {
    refreshLocalReadStats();
    const timer = setInterval(refreshLocalReadStats, 3000);
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
        const scheduledMode = resolveReadTrackerModeFromConfig(config);
        let manualLocalEnabled = false;
        try {
          manualLocalEnabled = localStorage.getItem("read_tracker_manual_local_enabled") === "true";
        } catch (storageError) {
          console.warn("讀取本機追蹤暫存狀態失敗:", storageError);
        }

        const effectiveMode = manualLocalEnabled && scheduledMode === "off" ? "local" : scheduledMode;
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

  useEffect(() => {
    loadDashboardSummaryStatus(calMonth, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBrand?.id, calMonth]);

  const scheduleStatus = useMemo(() => getReadTrackerScheduleStatus({ ...readTrackerConfig, ...scheduleForm, scheduleMode: "global" }), [readTrackerConfig, scheduleForm]);

  const timeSelectHours = useMemo(() => Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")), []);
  const timeSelectMinutes = useMemo(() => ["00", "10", "20", "30", "40", "50"], []);

  const normalizeScheduleTime = (value = "", fallback = "19:00") => {
    const text = String(value || fallback);
    if (/^\d{2}:\d{2}$/.test(text)) return text;
    if (/^\d{1}:\d{2}$/.test(text)) return `0${text}`;
    return fallback;
  };

  const setScheduleTimePart = (field, part, value) => {
    setScheduleForm((prev) => {
      const fallback = field === "startTime" ? "19:00" : "07:00";
      const current = normalizeScheduleTime(prev[field], fallback);
      const [hour, minute] = current.split(":");
      return {
        ...prev,
        [field]: part === "hour" ? `${value}:${minute}` : `${hour}:${value}`,
      };
    });
  };

  const applySchedulePreset = (startTime, endTime) => {
    setScheduleForm((prev) => ({
      ...prev,
      scheduleEnabled: true,
      startTime,
      endTime,
    }));
  };

  const getScheduleRangeHint = () => {
    const start = normalizeScheduleTime(scheduleForm.startTime, "19:00");
    const end = normalizeScheduleTime(scheduleForm.endTime, "07:00");
    if (start === end) return "全天排程：每天 24 小時維持全域上報。";
    return start > end
      ? `跨日排程：每天 ${start} 開啟，隔天 ${end} 關閉。`
      : `當日排程：每天 ${start} 開啟，${end} 關閉。`;
  };

  const renderScheduleTimeSelect = (field, label, fallback) => {
    const value = normalizeScheduleTime(scheduleForm[field], fallback);
    const [hour, minute] = value.split(":");

    return (
      <div className="rounded-2xl border border-stone-100 bg-white/90 p-3 shadow-sm">
        <label className="text-[11px] font-black text-stone-400 block mb-2 tracking-wider">{label}</label>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <select
            value={hour}
            onChange={(e) => setScheduleTimePart(field, "hour", e.target.value)}
            className="h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-black text-stone-700 outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-50"
          >
            {timeSelectHours.map((item) => <option key={`${field}_h_${item}`} value={item}>{item} 時</option>)}
          </select>
          <span className="text-sm font-black text-stone-300">:</span>
          <select
            value={minute}
            onChange={(e) => setScheduleTimePart(field, "minute", e.target.value)}
            className="h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-black text-stone-700 outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-50"
          >
            {timeSelectMinutes.map((item) => <option key={`${field}_m_${item}`} value={item}>{item} 分</option>)}
          </select>
        </div>
      </div>
    );
  };

  const readStatsRows = useMemo(() => Object.entries(localReadStats || {})
    .map(([label, item]) => ({ label, docs: item.docs || 0, triggers: item.triggers || 0, avg: item.triggers ? Math.round((item.docs || 0) / item.triggers) : 0, lastAt: item.lastAt || "-" }))
    .sort((a, b) => b.docs - a.docs), [localReadStats]);

  const localReadModeLabel = readTrackerMode === "global" ? "全域上報中" : readTrackerMode === "local" ? "本機追蹤中" : "追蹤關閉";
  const localReadModeTone = readTrackerMode === "off" ? "text-rose-600 bg-rose-50 border-rose-100" : readTrackerMode === "global" ? "text-blue-600 bg-blue-50 border-blue-100" : "text-emerald-600 bg-emerald-50 border-emerald-100";

  const getReadTrackerModeButtonClass = (modeId) => {
    const isActive = readTrackerMode === modeId;
    if (!isActive) return "bg-white text-stone-500 border-stone-200 hover:bg-stone-50";

    if (modeId === "off") {
      return "bg-rose-50 text-rose-600 border-rose-200 shadow-[0_10px_24px_rgba(244,63,94,0.10)]";
    }

    if (modeId === "local") {
      return "bg-emerald-50 text-emerald-700 border-emerald-200 shadow-[0_10px_24px_rgba(16,185,129,0.10)]";
    }

    return "bg-blue-50 text-blue-700 border-blue-200 shadow-[0_10px_24px_rgba(59,130,246,0.10)]";
  };

  const localReadEmptyText = readTrackerMode === "off"
    ? "目前讀取追蹤已關閉，清除後不會累積新的本機統計"
    : localReadClearedAt
      ? "已清除，等待新的讀取紀錄"
      : "尚無本機讀取追蹤資料";

  const SectionTitle = ({ eyebrow, title, desc, icon: Icon }) => (
    <div>
      {eyebrow && <p className="text-[11px] font-black tracking-[0.28em] text-[#B7863D] uppercase">{eyebrow}</p>}
      <h2 className="mt-1 text-2xl font-black text-[#4F3F33] tracking-tight flex items-center gap-2">
        {Icon && <Icon size={22} className="text-[#B7863D]" strokeWidth={1.8} />}
        {title}
      </h2>
      {desc && <p className="mt-1 text-sm font-bold text-[#9A8978] leading-relaxed">{desc}</p>}
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
      <div className="rounded-[1.75rem] border border-[#E8DDD0] bg-white/90 p-5 shadow-[0_16px_50px_rgba(154,118,84,0.06)]">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${toneClass}`}><Icon size={21} strokeWidth={1.7} /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-black text-[#4F3F33] tracking-tight">{title}</h3>
                {badge && <span className="px-2 py-1 rounded-full bg-amber-50 text-[#B7863D] border border-amber-100 text-[10px] font-black">{badge}</span>}
              </div>
              <p className="mt-1 text-xs font-bold text-[#9A8978] leading-relaxed">{desc}</p>
            </div>
          </div>
          <div className="lg:shrink-0 flex flex-col md:flex-row gap-2 md:items-center">{children}</div>
        </div>
      </div>
    );
  };

  const renderStatList = ({ rows, emptyIcon: EmptyIcon, emptyText, emptySubText = "", valueClass = "text-[#B7863D]" }) => (
    <div className="p-4">
      {rows.length === 0 ? (
        <div className="h-48 flex flex-col items-center justify-center text-stone-300 gap-2 text-center px-6">
          <EmptyIcon size={32} />
          <p className="text-xs font-black tracking-widest">{emptyText}</p>
          {emptySubText && <p className="text-[11px] font-bold text-stone-300 leading-relaxed">{emptySubText}</p>}
        </div>
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


  const scenarioCards = useMemo(() => ([
    {
      id: "daily",
      icon: CheckCircle2,
      title: "日常檢查",
      subtitle: "每天看一下系統是否正常",
      goal: "用來確認本月資料、排除店家、待重算狀態是否正常。",
      when: "平常巡檢、主管覺得數字怪怪、剛有人大量補報後。",
      impact: "只讀取檢查資料，不會修改原始日報。",
      steps: ["先按資料健康檢查", "有異常再展開明細查看", "本月 pending 可先保留到月結前處理"],
      tone: "emerald",
    },
    {
      id: "closing",
      icon: Calendar,
      title: "月結前作業",
      subtitle: "月底一次確認與校準",
      goal: "把本月補報、修正後的資料整理成可月結狀態。",
      when: "月底、月初關帳前、主管要確認最終月報前。",
      impact: "會重建 Dashboard 彙總與清除該月待校準紀錄，但不會修改原始日報。",
      steps: ["先執行月結前檢查", "再執行月份報表整理", "最後執行 Summary 比對確認一致"],
      tone: "amber",
    },
    {
      id: "issue",
      icon: AlertTriangle,
      title: "資料異常處理",
      subtitle: "發現某天、某店、某人數字異常",
      goal: "找出異常來源，必要時封存、還原或重新校準指定月份。",
      when: "日報不見、數字不一致、重複資料、有人修正歷史業績後。",
      impact: "部分工具只檢查；封存、還原、校準會改變報表計算結果，操作前會二次確認。",
      steps: ["先看健康檢查明細", "再看待重新校準月份", "必要時使用封存資料管理或單月校準"],
      tone: "rose",
    },
    {
      id: "backup",
      icon: Shield,
      title: "安全備份與還原",
      subtitle: "誤刪、誤改、架構救援",
      goal: "處理區長架構、設定備份與還原，避免資料救援困難。",
      when: "改區長架構前後、誤刪區長、需要回復設定時。",
      impact: "載入快照只查看；還原會覆蓋目前組織架構，操作前會二次確認。",
      steps: ["先載入組織架構快照", "確認時間與操作者", "必要時才按還原"],
      tone: "emerald",
    },
    {
      id: "traffic",
      icon: Radio,
      title: "流量監控",
      subtitle: "觀察 reads 爆量來源",
      goal: "找出哪些功能或資料來源造成 Firestore reads 上升。",
      when: "晚間全域上報後、費用異常、改版後要觀察節流效果時。",
      impact: "本機模式不寫入雲端；全域上報會產生少量寫入，但可追蹤全體來源。",
      steps: ["晚間開啟全域上報或排程", "隔天載入近 24 小時排行", "依前幾名決定下一步優化"],
      tone: "blue",
    },
  ]), []);

  const activeScenario = useMemo(
    () => scenarioCards.find((item) => item.id === activeMaintenanceScenario) || scenarioCards[0],
    [scenarioCards, activeMaintenanceScenario]
  );

  const ScenarioIcon = activeScenario.icon;
  const getScenarioToneClass = (tone) => {
    if (tone === "emerald") return "border-emerald-100 bg-emerald-50/70 text-emerald-700";
    if (tone === "rose") return "border-rose-100 bg-rose-50/70 text-rose-600";
    if (tone === "blue") return "border-blue-100 bg-blue-50/70 text-blue-600";
    return "border-amber-100 bg-amber-50/70 text-[#B7863D]";
  };


  const getFlowButtonLabel = (scenarioId) => {
    const labels = {
      daily: "一鍵執行日常檢查",
      closing: "一鍵執行月結前流程",
      issue: "一鍵掃描資料異常",
      backup: "載入備份與快照",
      traffic: "載入流量監控",
    };
    return labels[scenarioId] || "執行情境流程";
  };

  const getFlowResultTone = (status) => {
    if (status === "success") return "border-emerald-100 bg-emerald-50/70 text-emerald-700";
    if (status === "warning") return "border-amber-100 bg-amber-50/70 text-[#8A6128]";
    if (status === "danger") return "border-rose-100 bg-rose-50/70 text-rose-600";
    if (status === "running") return "border-blue-100 bg-blue-50/70 text-blue-600";
    return "border-stone-100 bg-stone-50/70 text-stone-500";
  };

  const getFlowStatusMeta = (status) => {
    if (status === "success") return { label: "正常", icon: CheckCircle2, titleClass: "text-emerald-700", badgeClass: "bg-emerald-600 text-white" };
    if (status === "warning") return { label: "需注意", icon: AlertTriangle, titleClass: "text-[#8A6128]", badgeClass: "bg-amber-500 text-white" };
    if (status === "danger") return { label: "需處理", icon: AlertTriangle, titleClass: "text-rose-600", badgeClass: "bg-rose-500 text-white" };
    if (status === "running") return { label: "檢查中", icon: Loader2, titleClass: "text-blue-600", badgeClass: "bg-blue-500 text-white" };
    return { label: "待執行", icon: ClipboardList, titleClass: "text-stone-500", badgeClass: "bg-stone-400 text-white" };
  };

  const getHealthRiskCounts = (report) => {
    const issues = Array.isArray(report?.issues) ? report.issues : [];
    return {
      danger: issues.filter((i) => i.severity === "danger").reduce((sum, i) => sum + Number(i.count || 0), 0),
      warning: issues.filter((i) => i.severity === "warning").reduce((sum, i) => sum + Number(i.count || 0), 0),
      info: issues.filter((i) => i.severity === "info").reduce((sum, i) => sum + Number(i.count || 0), 0),
      issueTypes: issues.length,
    };
  };

  const handleRunGuidedFlow = async (scenarioId = activeMaintenanceScenario) => {
    if (guidedFlowRunning || loadingAction) return;
    const scenario = scenarioCards.find((item) => item.id === scenarioId) || scenarioCards[0];
    const nowText = new Date().toLocaleString("zh-TW", { hour12: false });
    const makeItem = (label, desc, status = "done") => ({ label, desc, status });

    setGuidedFlowRunning(true);
    setGuidedFlowReport({
      scenarioId,
      title: scenario.title,
      status: "running",
      headline: "正在檢查，請稍候",
      message: "系統正在依照此情境自動執行檢查。此區塊高度固定，不會因執行中途更新造成畫面跳動。",
      createdAt: nowText,
      items: [],
      metrics: [],
      nextActions: ["檢查完成後，這裡會直接顯示「正常 / 需注意 / 需處理」。"],
    });
    addLog(`🧭 啟動情境流程：${scenario.title}`);

    try {
      let items = [];
      let metrics = [];
      let status = "success";
      let headline = "檢查完成｜正常";
      let message = "目前沒有需要立即處理的重大異常。";
      let nextActions = [];

      if (scenarioId === "daily") {
        const health = await handleRunDataHealthCheck();
        const queueResult = await handleLoadRecalcQueue();
        await loadDashboardSummaryStatus(calMonth, true);

        const counts = getHealthRiskCounts(health);
        const pendingTotal = Number(queueResult?.total || 0);
        const currentMonthPending = (queueResult?.groups || []).find((g) => g.month === calMonth)?.count || 0;

        metrics = [
          { label: "高風險異常", value: counts.danger, tone: counts.danger ? "danger" : "success" },
          { label: "需注意提醒", value: counts.warning, tone: counts.warning ? "warning" : "success" },
          { label: "待月底校準", value: isSelectedCurrentMonth() ? currentMonthPending : pendingTotal, tone: (isSelectedCurrentMonth() ? currentMonthPending : pendingTotal) ? "warning" : "success" },
          { label: "掃描資料", value: Number(health?.scanned || 0).toLocaleString(), tone: "neutral" },
        ];

        if (counts.danger > 0) status = "danger";
        else if (counts.warning > 0 || pendingTotal > 0) status = "warning";
        else status = "success";

        headline = status === "success" ? "日常檢查完成｜正常" : status === "danger" ? "日常檢查完成｜需處理" : "日常檢查完成｜需注意";
        message = status === "success"
          ? "目前沒有重大異常，也沒有需要立即處理的待辦。"
          : counts.danger > 0
          ? "偵測到高風險異常，建議先展開健康檢查明細，確認是哪一天、哪間店或哪位管理師。"
          : "目前屬於可觀察狀態。本月補報與修正造成的 pending，可以留到月結前一次校準。";
        items = [
          makeItem("資料健康檢查", `高風險 ${counts.danger}｜需注意 ${counts.warning}｜提醒 ${counts.info}`),
          makeItem("待整理異動", isSelectedCurrentMonth() ? `本月待月底校準 ${currentMonthPending} 筆` : `待校準 ${pendingTotal} 筆`),
          makeItem("Dashboard 狀態", "已檢查 Summary 是否建立與是否有異動"),
        ];
        nextActions = status === "danger"
          ? ["先展開健康檢查明細，處理紅色高風險項目。", "處理完成後，再重新執行日常檢查。"]
          : ["本月 pending 不需要每筆立刻校準，月結前一次處理即可。", "若只是排除店家或負數退款提醒，確認合理即可。"];
      } else if (scenarioId === "closing") {
        const closing = await handleRunClosingCheck();
        const health = await handleRunDataHealthCheck();
        const queueResult = await handleLoadRecalcQueue();
        await loadDashboardSummaryStatus(calMonth, true);

        const counts = getHealthRiskCounts(health);
        const pendingTotal = Number(queueResult?.total || 0);
        const readiness = closing?.readiness || "未完成";

        if (readiness === "不建議月結" || counts.danger > 0) status = "danger";
        else if (readiness === "需注意" || counts.warning > 0 || pendingTotal > 0) status = "warning";
        else status = "success";

        headline = status === "success" ? "月結前檢查完成｜可以月結" : status === "danger" ? "月結前檢查完成｜需先處理" : "月結前檢查完成｜需注意";
        message = status === "success"
          ? "檢查結果可進入月份報表整理與比對。"
          : status === "danger"
          ? "目前有會影響月結準確性的項目，建議先處理異常後再校準。"
          : "可先確認提醒項目是否合理；若只是本月 pending，建議執行月份報表整理一次整理。";

        metrics = [
          { label: "月結狀態", value: readiness, tone: status },
          { label: "缺少店日報", value: closing?.missingStoreReports?.length || 0, tone: (closing?.missingStoreReports?.length || 0) ? "danger" : "success" },
          { label: "高風險異常", value: counts.danger, tone: counts.danger ? "danger" : "success" },
          { label: "待校準", value: pendingTotal, tone: pendingTotal ? "warning" : "success" },
        ];
        items = [
          makeItem("月結前檢查", `結果：${readiness}`),
          makeItem("資料健康檢查", `高風險 ${counts.danger}｜需注意 ${counts.warning}`),
          makeItem("待整理異動", `共 ${pendingTotal} 筆 pending`),
          makeItem("Summary 狀態", "已確認彙總資料狀態"),
        ];
        nextActions = status === "success"
          ? ["執行「月份報表整理」。", "校準後再執行 Summary 比對，確認一致。"]
          : ["先處理缺報、重複或紅色高風險異常。", "處理完成後，再重新執行月結前作業。"];
      } else if (scenarioId === "issue") {
        const health = await handleRunDataHealthCheck();
        const queueResult = await handleLoadRecalcQueue();
        await handleLoadArchivedDuplicates();

        const counts = getHealthRiskCounts(health);
        const pendingTotal = Number(queueResult?.total || 0);
        status = counts.danger > 0 ? "danger" : (counts.warning > 0 || pendingTotal > 0 ? "warning" : "success");
        headline = status === "success" ? "異常掃描完成｜未發現明顯異常" : status === "danger" ? "異常掃描完成｜需處理" : "異常掃描完成｜需注意";
        message = status === "success"
          ? "目前沒有明顯異常。"
          : "請優先查看健康檢查明細，確認異常資料的日期、店家、管理師與欄位。";
        metrics = [
          { label: "異常類型", value: counts.issueTypes, tone: counts.issueTypes ? "warning" : "success" },
          { label: "高風險", value: counts.danger, tone: counts.danger ? "danger" : "success" },
          { label: "需注意", value: counts.warning, tone: counts.warning ? "warning" : "success" },
          { label: "待校準", value: pendingTotal, tone: pendingTotal ? "warning" : "success" },
        ];
        items = [
          makeItem("資料異常掃描", `已掃描 ${Number(health?.scanned || 0).toLocaleString()} 筆資料`),
          makeItem("待整理月份", `待校準 ${pendingTotal} 筆`),
          makeItem("封存資料", "已載入目前月份的封存資料"),
        ];
        nextActions = ["先處理資料本身問題，再執行單月校準。", "若資料是誤封存，可在封存資料清單中還原。"];
      } else if (scenarioId === "backup") {
        await handleLoadOrgStructureSnapshots();
        await handleLoadBackupRecords();
        status = "success";
        headline = "備份與快照已載入｜正常";
        message = "目前只是載入紀錄，不會修改資料。還原屬於高風險操作，仍需二次確認。";
        metrics = [
          { label: "動作", value: "只讀取", tone: "success" },
          { label: "風險", value: "低", tone: "success" },
          { label: "還原", value: "需確認", tone: "warning" },
        ];
        items = [makeItem("組織架構快照", "已載入最近快照"), makeItem("備份紀錄", "已載入最近備份")];
        nextActions = ["只有在誤刪、誤改或架構救援時才按還原。", "還原前確認時間點、操作者與品牌月份。"];
      } else if (scenarioId === "traffic") {
        setLocalReadStats(getReadTrackerStats());
        await handleLoadGlobalReadStats();
        status = "success";
        headline = "流量監控已載入｜正常";
        message = "請先看前 3 名來源，判斷是必要即時流量還是可優化的低頻重複讀取。";
        metrics = [
          { label: "全域來源", value: globalReadStats.length || "-", tone: "neutral" },
          { label: "動作", value: "只讀取", tone: "success" },
          { label: "資料影響", value: "不修改", tone: "success" },
        ];
        items = [makeItem("本機讀取統計", "已讀取目前裝置來源排行"), makeItem("全域讀取排行", "已載入全體上報來源排行；也可用時段篩選追查尖峰")];
        nextActions = ["當月日報高通常代表即時戰情成本。", "年度彙總、目標、排班若高，通常是下一波節流方向。"];
      }

      setGuidedFlowReport({ scenarioId, title: scenario.title, status, headline, message, createdAt: nowText, items, metrics, nextActions });
      addLog(`✅ 情境流程完成：${scenario.title}`);
      showToast(`${scenario.title}流程已完成：${getFlowStatusMeta(status).label}`, status === "danger" ? "error" : status === "success" ? "success" : "info");
    } catch (error) {
      console.error(error);
      setGuidedFlowReport({
        scenarioId,
        title: scenario.title,
        status: "danger",
        headline: "流程執行失敗｜需處理",
        message: error?.message || "執行時發生錯誤，請查看操作紀錄。",
        createdAt: nowText,
        items: [makeItem("流程中斷", error?.message || "未知錯誤", "error")],
        metrics: [{ label: "狀態", value: "失敗", tone: "danger" }],
        nextActions: ["請先不要重複操作。", "截圖錯誤訊息後再檢查相關資料。"],
      });
      addLog(`❌ 情境流程失敗：${scenario.title}｜${error?.message || error}`);
      showToast(`${scenario.title}流程失敗`, "error");
    } finally {
      setGuidedFlowRunning(false);
    }
  };

  const handleSelectMaintenanceScenario = (scenarioId) => {
    setActiveMaintenanceScenario(scenarioId);
    // 切換情境時不要沿用上一個情境的結果，避免使用者誤判目前看的仍是舊流程。
    setGuidedFlowReport(null);
  };

  const renderMaintenanceScenarioGuide = () => {
    const isCurrent = isSelectedCurrentMonth();
    const report = guidedFlowReport?.scenarioId === activeMaintenanceScenario ? guidedFlowReport : null;
    const safeReport = report || {
      status: "idle",
      title: activeMaintenanceScenario === "closing" ? "月份報表整理" : activeMaintenanceScenario === "backup" ? "資料安全狀態" : activeMaintenanceScenario === "traffic" ? "流量觀察狀態" : "本月資料狀態",
      headline: "尚未執行檢查",
      message: "請先選擇上方狀態卡，系統會用任務精靈整理成容易判斷的結果。",
      metrics: [],
      items: [],
      nextActions: ["建議先從「本月資料狀態」開始。"],
    };
    const meta = getFlowStatusMeta(safeReport.status);
    const StatusIcon = meta.icon;

    const tonePalette = {
      success: {
        card: "border-[#D7ECDF] bg-[#F7FCF8]",
        icon: "border-[#D7ECDF] bg-[#EEF8F2] text-[#4F8A68]",
        pill: "border-[#D7ECDF] bg-[#EEF8F2] text-[#4F8A68]",
        label: "正常",
      },
      warning: {
        card: "border-[#F2DEB5] bg-[#FFFBF1]",
        icon: "border-[#F2DEB5] bg-[#FFF6E4] text-[#A77732]",
        pill: "border-[#F2DEB5] bg-[#FFF6E4] text-[#A77732]",
        label: "需注意",
      },
      danger: {
        card: "border-[#F3D4DA] bg-[#FFF7F8]",
        icon: "border-[#F3D4DA] bg-[#FFF0F2] text-[#B66A79]",
        pill: "border-[#F3D4DA] bg-[#FFF0F2] text-[#B66A79]",
        label: "需處理",
      },
      idle: {
        card: "border-[#E8DDD0] bg-[#FBF7F1]",
        icon: "border-[#E7D8C7] bg-[#F7F0E7] text-[#8B7056]",
        pill: "border-[#E7D8C7] bg-[#F7F0E7] text-[#8B7056]",
        label: "待處理",
      },
    };

    const getStatusKey = (status) => status === "success" ? "success" : status === "danger" ? "danger" : status === "warning" ? "warning" : "idle";

    const normalizeMetricLabel = (label = "") => String(label)
      .replace("待月底校準", "待月結整理")
      .replace("待校準", "待月結整理")
      .replace("掃描資料", "已檢查資料")
      .replace("月結狀態", "整理狀態")
      .replace("Summary", "歷史報表")
      .replace("pending", "待整理異動");

    const findings = Array.isArray(safeReport.metrics) && safeReport.metrics.length > 0
      ? safeReport.metrics.slice(0, 3).map((item) => ({ ...item, label: normalizeMetricLabel(item.label) }))
      : [
          { label: "目前狀態", value: meta.label, tone: safeReport.status === "idle" ? "neutral" : safeReport.status },
          { label: "資料影響", value: "尚未檢查", tone: "neutral" },
          { label: "建議操作", value: "先執行檢查", tone: "warning" },
        ];

    const metricToneClass = (tone) => {
      if (tone === "success") return "border-[#D7ECDF] bg-[#F3FAF5] text-[#4F8A68]";
      if (tone === "warning") return "border-[#F2DEB5] bg-[#FFF8EA] text-[#A77732]";
      if (tone === "danger") return "border-[#F3D4DA] bg-[#FFF7F8] text-[#B66A79]";
      return "border-[#E8DDD0] bg-[#FBF7F1] text-[#7D6753]";
    };

    const explainMeaning = () => {
      if (safeReport.status === "success") return "目前沒有需要立即處理的重大異常，可以繼續以營運總覽作為本月即時判斷依據。";
      if (safeReport.status === "danger") return "系統偵測到可能影響報表判斷的項目，建議先查看明細並處理紅色高風險資料，再重新檢查。";
      if (safeReport.status === "warning") return isCurrent
        ? "目前多半屬於可觀察狀態。本月補報、修正或目標調整造成的待整理項目，可以留到月結前一次處理。"
        : "此月份有需要注意的資料狀態，若要作為歷史報表依據，建議先完成月份報表整理與數字確認。";
      if (safeReport.status === "running") return "系統正在檢查，請先不要重複點擊或切換高風險工具。";
      return "尚未開始檢查。執行後，系統會用營運語言說明發現什麼、代表什麼、現在該做什麼。";
    };

    const runScenario = (scenarioId) => {
      setActiveMaintenanceScenario(scenarioId);
      setGuidedFlowReport(null);
      setWizardStep(1);
    };

    const selectedSummaryStatus = summaryStatusReport?.month === calMonth ? summaryStatusReport : null;
    const selectedMonthLabel = (() => {
      const [y, m] = String(calMonth || todayMonth()).split("-");
      return y && m ? `${y} 年 ${String(Number(m)).padStart(2, "0")} 月` : calMonth;
    })();
    const shiftMonth = (amount) => {
      const [year, month] = String(calMonth || todayMonth()).split("-").map(Number);
      if (!year || !month) return;
      const next = new Date(year, month - 1 + amount, 1);
      const nextValue = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
      setCalMonth(nextValue);
      setWizardStep(1);
      setGuidedFlowReport(null);
    };
    const handleMonthChange = (value) => {
      if (!value) return;
      setCalMonth(value);
      setWizardStep(1);
      setGuidedFlowReport(null);
    };
    const formatSummaryTime = (value) => {
      if (!value || value === "-") return "尚無紀錄";
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString("zh-TW", { hour12: false });
      return String(value);
    };
    const monthModeLabel = isCurrent ? "本月即時營運中" : "歷史月份檢查";
    const monthStatusLabel = (() => {
      if (isCurrent) return "只檢查，不整理";
      if (!selectedSummaryStatus) return "自動檢查中";
      if (selectedSummaryStatus.statusKey === "verified" || selectedSummaryStatus.statusKey === "ready") return "已整理";
      if (selectedSummaryStatus.statusKey === "missing") return "尚未整理";
      if (selectedSummaryStatus.statusKey === "dirty" || selectedSummaryStatus.pendingCount > 0) return "需要整理";
      if (selectedSummaryStatus.statusKey === "mismatch") return "需處理";
      return "建議檢查";
    })();
    const monthStatusToneClass = isCurrent
      ? "border-[#D7ECDF] bg-[#EEF8F2] text-[#4F8A68]"
      : monthStatusLabel === "已整理"
      ? "border-[#D7ECDF] bg-[#EEF8F2] text-[#4F8A68]"
      : monthStatusLabel === "需處理"
      ? "border-[#F3D4DA] bg-[#FFF0F2] text-[#B66A79]"
      : "border-[#F2DEB5] bg-[#FFF6E4] text-[#A77732]";
    const monthAdviceTitle = isCurrent
      ? "目前建議：檢查本月資料狀態"
      : monthStatusLabel === "已整理"
      ? `目前建議：${calMonth} 報表已整理，可安心查看`
      : monthStatusLabel === "需要整理"
      ? `目前建議：整理 ${calMonth} 報表`
      : monthStatusLabel === "尚未整理"
      ? `目前建議：建立 ${calMonth} 報表整理資料`
      : `目前建議：檢查 ${calMonth} 報表狀態`;
    const monthAdviceBody = isCurrent
      ? "當月資料以即時日報與即時目標為準。平常只需要確認資料是否安心，指定月份資料確認後再整理歷史報表。"
      : monthStatusLabel === "已整理"
      ? `上次整理：${formatSummaryTime(selectedSummaryStatus?.updatedAtText || selectedSummaryStatus?.lastUpdatedAtText)}。目前沒有新的待整理異動，歷史報表可安心查看。`
      : monthStatusLabel === "需要整理"
      ? `此月份在上次整理後仍有 ${Number(selectedSummaryStatus?.pendingCount || 0).toLocaleString()} 筆待整理異動。上次整理：${formatSummaryTime(selectedSummaryStatus?.updatedAtText || selectedSummaryStatus?.lastUpdatedAtText)}，最近異動：${formatSummaryTime(selectedSummaryStatus?.latestPendingAt)}。`
      : monthStatusLabel === "尚未整理"
      ? "此月份尚未建立完整歷史報表整理資料。若該月份資料已確認完成，可以執行月份報表整理。"
      : "系統正在或尚未完成此月份整理狀態判斷，請重新檢查狀態。";

    const shouldShowMonthReportAssistant = !isCurrent && selectedSummaryStatus && ["missing", "dirty", "unverified", "mismatch"].includes(selectedSummaryStatus.statusKey);
    const monthReportAssistantTone = selectedSummaryStatus?.statusKey === "mismatch" ? "rose" : selectedSummaryStatus?.statusKey === "missing" ? "amber" : "amber";
    const monthReportAssistantTitle = selectedSummaryStatus?.statusKey === "mismatch"
      ? `${calMonth} 報表比對異常，建議重新整理後再確認`
      : selectedSummaryStatus?.statusKey === "missing"
      ? `${calMonth} 尚未建立歷史報表整理資料`
      : `${calMonth} 有 ${Number(selectedSummaryStatus?.pendingCount || 0).toLocaleString()} 筆資料待整理`;
    const monthReportAssistantBody = selectedSummaryStatus?.statusKey === "mismatch"
      ? "Dashboard 目前會先以明細暫代，避免主管看到不一致的 Summary。建議重新整理此月份報表，完成後系統會再次比對。"
      : selectedSummaryStatus?.statusKey === "missing"
      ? "此月份還沒有可供 Dashboard 安心使用的歷史報表資料。整理完成後，歷史月份可切回 Summary，減少長期明細讀取。"
      : "Dashboard 目前已改用明細暫代顯示，主管看到的數字仍以明細為準。整理完成並比對正常後，系統會重新切回已整理 Summary。";


    const statusCards = [
      {
        id: "daily",
        title: isCurrent ? "本月資料狀態" : "資料狀態",
        subtitle: isCurrent ? "營運資料是否可信" : `${calMonth} 資料檢查`,
        status: report?.scenarioId === "daily" ? getStatusKey(report.status) : (isCurrent ? "warning" : "idle"),
        summary: report?.scenarioId === "daily" ? report.message : (isCurrent ? "建議先檢查本月資料；平常只檢查，不整理報表。" : `檢查 ${calMonth} 是否有缺報、異常或待整理異動。`),
        action: isCurrent ? "檢查本月資料" : `檢查 ${calMonth} 資料`,
        icon: ClipboardList,
        highlights: ["即時日報", "即時目標", "缺報與異常提醒"],
        scenarioId: "daily",
      },
      {
        id: "closing",
        title: "報表整理狀態",
        subtitle: isCurrent ? "資料確認後使用" : `${calMonth} 報表狀態`,
        status: report?.scenarioId === "closing" ? getStatusKey(report.status) : (isCurrent ? "idle" : (monthStatusLabel === "已整理" ? "success" : monthStatusLabel === "需處理" ? "danger" : "warning")),
        summary: report?.scenarioId === "closing" ? report.message : (isCurrent ? "本月資料仍會變動，建議資料確認完成後再整理報表。" : monthAdviceBody),
        action: isCurrent ? "了解整理時機" : `整理 ${calMonth} 報表`,
        icon: Calendar,
        highlights: ["缺報檢查", "歷史報表整理", "數字一致確認"],
        scenarioId: "closing",
      },
      {
        id: "backup",
        title: "資料安全狀態",
        subtitle: "備份、還原與封存",
        status: report?.scenarioId === "backup" ? getStatusKey(report.status) : "success",
        summary: report?.scenarioId === "backup" ? report.message : "目前沒有需要立即還原或救援的風險提醒。",
        action: "查看安全工具",
        icon: Shield,
        highlights: ["快照可查詢", "還原需確認", "封存可追蹤"],
        scenarioId: "backup",
      },
      {
        id: "traffic",
        title: "流量觀察狀態",
        subtitle: "讀取量是否異常",
        status: report?.scenarioId === "traffic" ? getStatusKey(report.status) : "idle",
        summary: report?.scenarioId === "traffic" ? report.message : "當月即時資料會有必要讀取量，先觀察排行前幾名即可。",
        action: "查看流量",
        icon: Radio,
        highlights: ["必要即時成本", "低頻來源觀察", "3～5 天趨勢"],
        scenarioId: "traffic",
      },
    ];

    const activeCard = statusCards.find((card) => card.scenarioId === activeMaintenanceScenario) || statusCards[0];
    const activeTone = tonePalette[getStatusKey(activeCard.status)];
    const ActiveIcon = activeCard.icon;

    const wizardSteps = [
      {
        title: "你現在想處理什麼？",
        desc: "先選擇上方狀態卡，系統會用任務精靈帶你完成，不需要自己找工具。",
        body: activeCard.summary,
      },
      {
        title: "系統檢查結果",
        desc: "這一步只顯示重點，不把所有進階工具攤開。",
        body: safeReport.status === "idle" ? "按下開始後，系統會整理成正常、需注意或需處理。" : safeReport.message,
      },
      {
        title: "這代表什麼？",
        desc: "把檢查結果轉成營運語言，讓使用者知道是否會影響判斷。",
        body: explainMeaning(),
      },
      {
        title: "你現在要做什麼？",
        desc: "最後只給明確下一步，避免誤按進階工具。",
        body: (safeReport.nextActions || ["先執行檢查，再依照系統建議處理。"])
          .slice(0, 3)
          .map((item, index) => `${index + 1}. ${String(item).replace("Summary", "歷史報表").replace("pending", "待整理異動")}`)
          .join("\n"),
      },
    ];
    const currentStep = wizardSteps[Math.max(0, wizardStep - 1)];

    return (
      <section className="space-y-3">
        <div className="rounded-[1.5rem] border border-[#E8DDD0] bg-gradient-to-br from-[#FFFCF7] via-white to-[#FFF8EC] p-3.5 shadow-[0_12px_30px_rgba(154,118,84,0.06)]">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-[1.1rem] border border-[#F0DDBB] bg-[#FFF6E4] text-[#B7863D] flex items-center justify-center shrink-0">
                <Sparkles size={18} strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 rounded-full border border-[#F2DEB5] bg-[#FFF6E4] text-[#A77732] text-xs font-black">今日建議</span>
                  <span className={`px-3 py-1 rounded-full border text-xs font-black ${monthStatusToneClass}`}>{monthStatusLabel}</span>
                  <span className="px-3 py-1 rounded-full border border-[#E7D8C7] bg-[#F7F0E7] text-[#8B7056] text-xs font-black">{monthModeLabel}</span>
                </div>
                <h2 className="mt-1.5 text-base md:text-lg font-black text-[#4F3F33] tracking-tight">{monthAdviceTitle}</h2>
                <p className="mt-1 text-xs md:text-sm font-bold text-[#7D6753] leading-5 max-w-3xl">{monthAdviceBody}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 xl:items-end shrink-0">
              <div className="flex items-center gap-2 rounded-2xl border border-[#E8DDD0] bg-white/75 p-1.5 shadow-sm">
                <button type="button" onClick={() => shiftMonth(-1)} className="h-9 px-3 rounded-xl bg-[#F7F0E7] text-[#8B7056] text-xs font-black hover:bg-[#EFE3D5]">上一月</button>
                <label className="flex items-center gap-2 px-2 text-xs font-black text-[#7D6753]">
                  <Calendar size={14} className="text-[#B7863D]" />
                  <input type="month" value={calMonth} onChange={(e) => handleMonthChange(e.target.value)} className="bg-transparent outline-none w-[116px] text-center text-[#4F3F33]" />
                </label>
                <button type="button" onClick={() => shiftMonth(1)} className="h-9 px-3 rounded-xl bg-[#F7F0E7] text-[#8B7056] text-xs font-black hover:bg-[#EFE3D5]">下一月</button>
              </div>
              <div className="flex flex-wrap gap-2 xl:justify-end">
                <span className="px-2.5 py-1 rounded-full border border-[#E7D8C7] bg-[#F7F0E7] text-[#8B7056] text-[11px] font-black">目前檢查：{selectedMonthLabel}</span>
                {!isCurrent && <span className="px-2.5 py-1 rounded-full border border-[#F2DEB5] bg-[#FFF6E4] text-[#A77732] text-[11px] font-black">上次整理：{formatSummaryTime(selectedSummaryStatus?.updatedAtText || selectedSummaryStatus?.lastUpdatedAtText)}</span>}
                {!isCurrent && <span className="px-2.5 py-1 rounded-full border border-[#F2DEB5] bg-[#FFF6E4] text-[#A77732] text-[11px] font-black">最近異動：{formatSummaryTime(selectedSummaryStatus?.latestPendingAt)}</span>}
              </div>
            </div>
          </div>
        </div>

        {shouldShowMonthReportAssistant && (
          <div className={`rounded-[1.65rem] border p-4 shadow-[0_14px_34px_rgba(154,118,84,0.06)] ${monthReportAssistantTone === "rose" ? "border-rose-100 bg-rose-50/35" : "border-amber-100 bg-amber-50/35"}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-11 h-11 rounded-[1.15rem] border flex items-center justify-center shrink-0 ${monthReportAssistantTone === "rose" ? "border-rose-100 bg-white text-rose-500" : "border-amber-100 bg-white text-[#B7863D]"}`}>
                  <Calendar size={19} strokeWidth={1.8} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-3 py-1 rounded-full border bg-white text-[11px] font-black ${monthReportAssistantTone === "rose" ? "border-rose-100 text-rose-600" : "border-amber-100 text-[#B7863D]"}`}>月份報表整理助手</span>
                    <span className="px-3 py-1 rounded-full border border-stone-100 bg-white/80 text-[11px] font-black text-stone-500">Dashboard 目前明細暫代</span>
                  </div>
                  <h3 className="mt-2 text-lg font-black text-[#4F3F33] tracking-tight">{monthReportAssistantTitle}</h3>
                  <p className="mt-1 text-xs font-bold leading-5 text-[#7D6753] max-w-3xl">{monthReportAssistantBody}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black text-stone-500">
                    <span className="rounded-full border border-stone-100 bg-white/80 px-3 py-1">待整理：{Number(selectedSummaryStatus?.pendingCount || 0).toLocaleString()} 筆</span>
                    <span className="rounded-full border border-stone-100 bg-white/80 px-3 py-1">最近異動：{formatSummaryTime(selectedSummaryStatus?.latestPendingAt || selectedSummaryStatus?.lastDirtyAtText)}</span>
                    <span className="rounded-full border border-stone-100 bg-white/80 px-3 py-1">最後比對：{formatSummaryTime(selectedSummaryStatus?.lastCompareAt)}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row lg:flex-col lg:items-stretch shrink-0">
                <BeautyButton onClick={handleMonthEndDashboardSummaryCalibration} disabled={loadingAction !== null} variant="primary" className="min-w-[170px]">
                  {loadingAction === "monthEndSummaryCalibration" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  立即整理 {calMonth}
                </BeautyButton>
                <BeautyButton onClick={() => loadDashboardSummaryStatus(calMonth)} disabled={loadingAction !== null} variant="soft" className="min-w-[170px]">
                  {loadingAction === "summaryStatus" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                  重新檢查
                </BeautyButton>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5 auto-rows-fr">
          {statusCards.map((card) => {
            const tone = tonePalette[getStatusKey(card.status)];
            const Icon = card.icon;
            const CardStatusIcon = card.status === "success" ? CheckCircle2 : card.status === "warning" ? AlertTriangle : Clock;
            const selected = card.scenarioId === activeMaintenanceScenario;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => runScenario(card.scenarioId)}
                className={`text-left rounded-[1.35rem] border p-3 transition-all shadow-[0_10px_24px_rgba(154,118,84,0.045)] min-h-[130px] h-full ${selected ? "border-[#D8B883] bg-white ring-2 ring-[#F5E7D0]" : `${tone.card} hover:border-[#D8B883]`}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`w-9 h-9 rounded-[1rem] border flex items-center justify-center ${tone.icon}`}>
                    <Icon size={17} strokeWidth={1.8} />
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-black ${tone.pill}`}>
                    <CardStatusIcon size={11} />{tone.label}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-black text-[#4F3F33]">{card.title}</h3>
                <p className="mt-0.5 text-[11px] font-bold text-[#9A8978]">{card.subtitle}</p>
                <p className="mt-2 text-[11px] font-bold text-[#6F5A48] leading-4 line-clamp-2">{card.summary}</p>
                <div className="mt-2 flex items-center justify-between text-[11px] font-black text-[#A77732]">
                  <span>{card.action}</span>
                  <span>→</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="rounded-[1.65rem] border border-[#E8DDD0] bg-white/90 shadow-[0_14px_36px_rgba(154,118,84,0.07)] overflow-hidden">
          <div className="grid min-h-[390px] lg:grid-cols-[0.72fr_1.28fr]">
            <div className="border-b border-[#EFE5DA] bg-[#FFFDF9] p-4 lg:border-b-0 lg:border-r lg:p-4">
              <div className="flex items-start gap-3">
                <div className={`w-11 h-11 rounded-[1.1rem] border flex items-center justify-center shrink-0 ${activeTone.icon}`}>
                  <ActiveIcon size={20} strokeWidth={1.8} />
                </div>
                <div>
                  <span className={`px-3 py-1 rounded-full border text-xs font-black ${activeTone.pill}`}>{activeTone.label}</span>
                  <h2 className="mt-2 text-xl font-black text-[#4F3F33]">{activeCard.title}</h2>
                  <p className="mt-1.5 text-xs font-bold text-[#7D6753] leading-5">{activeCard.summary}</p>
                </div>
              </div>

              <div className="mt-4 rounded-[1.25rem] border border-[#E8DDD0] bg-[#FBF7F1] p-3">
                <p className="text-[11px] font-black tracking-widest text-[#B6A696]">重點摘要</p>
                <div className="mt-2 space-y-1.5">
                  {activeCard.highlights.map((item) => (
                    <div key={item} className="flex items-center gap-2 text-xs font-bold text-[#6F5A48]">
                      <CheckCircle2 size={16} className="text-[#B7863D] shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row lg:flex-col">
                <BeautyButton
                  onClick={() => activeCard.scenarioId === "closing" && !isCurrent ? handleMonthEndDashboardSummaryCalibration() : handleRunGuidedFlow(activeCard.scenarioId)}
                  disabled={guidedFlowRunning || loadingAction !== null}
                  variant="primary"
                  className="h-10 flex-1"
                >
                  {guidedFlowRunning || loadingAction === "monthEndSummaryCalibration" ? <Loader2 size={16} className="animate-spin" /> : activeCard.scenarioId === "closing" && !isCurrent ? <CheckCircle2 size={16} /> : <Play size={16} />}
                  {guidedFlowRunning ? "檢查中..." : loadingAction === "monthEndSummaryCalibration" ? "整理中..." : activeCard.scenarioId === "closing" ? (isCurrent ? "查看整理時機" : `立即整理 ${calMonth}`) : activeCard.scenarioId === "daily" ? "開始本月檢查" : activeCard.action}
                </BeautyButton>
                <BeautyButton onClick={() => setShowCoreTools(true)} variant="soft" className="h-10 flex-1">
                  <Settings size={16} /> 打開進階工具
                </BeautyButton>
              </div>
            </div>

            <div className="p-4 lg:p-4 flex flex-col min-h-[390px]">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full border border-[#F2DEB5] bg-[#FFF6E4] text-[#A77732] text-xs font-black">Step {wizardStep} / 4</span>
                    <span className="px-3 py-1 rounded-full border border-[#E8DDD0] bg-[#FBF7F1] text-[#8B7056] text-xs font-black">任務精靈</span>
                  </div>
                  <h3 className="mt-2 text-xl font-black text-[#4F3F33]">{currentStep.title}</h3>
                  <p className="mt-1.5 text-xs font-bold text-[#9A8978]">{currentStep.desc}</p>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                {[1, 2, 3, 4].map((step) => <div key={step} className={`h-1.5 flex-1 rounded-full ${step <= wizardStep ? "bg-[#C89F68]" : "bg-[#EFE5DA]"}`} />)}
              </div>

              <div className="mt-4 rounded-[1.35rem] border border-[#E8DDD0] bg-[#FBF7F1] p-3.5 min-h-[104px]">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-[1.1rem] border border-[#F0DDBB] bg-[#FFF6E4] text-[#B7863D] flex items-center justify-center shrink-0">
                    {wizardStep === 1 && <Sparkles size={18} />}
                    {wizardStep === 2 && <Eye size={18} />}
                    {wizardStep === 3 && <AlertTriangle size={18} />}
                    {wizardStep === 4 && <CheckCircle2 size={18} />}
                  </div>
                  <p className="text-sm font-bold leading-6 text-[#6F5A48] whitespace-pre-line">{currentStep.body}</p>
                </div>
              </div>

              <div className={`mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 min-h-[66px] ${wizardStep === 2 ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                {findings.map((item) => (
                  <div key={item.label} className={`rounded-2xl border p-3 text-center ${metricToneClass(item.tone)}`}>
                    <p className="text-[10px] font-black tracking-widest opacity-75">{item.label}</p>
                    <p className="mt-0.5 text-lg font-black">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
                <BeautyButton variant="soft" disabled={wizardStep === 1} onClick={() => setWizardStep(Math.max(1, wizardStep - 1))}>上一步</BeautyButton>
                {wizardStep < 4 ? (
                  <BeautyButton onClick={() => setWizardStep(Math.min(4, wizardStep + 1))}>下一步</BeautyButton>
                ) : (
                  <BeautyButton variant="soft" onClick={() => setWizardStep(1)}>完成，回到總覽</BeautyButton>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  // 讀取來源追蹤
  const handleChangeReadTrackerMode = async (mode) => {
    try {
      const nextConfig = {
        ...readTrackerConfig,
        mode,
        brandId,
        brandLabel,
        updatedAt: serverTimestamp(),
        updatedAtText: new Date().toISOString(),
        updatedBy: currentUser?.name || "director",
      };
      await setDoc(getDocPath("read_tracker_config"), nextConfig, { merge: true });

      try {
        if (mode === "local") localStorage.setItem("read_tracker_manual_local_enabled", "true");
        if (mode === "off" || mode === "global") localStorage.removeItem("read_tracker_manual_local_enabled");
      } catch (storageError) {
        console.warn("本機追蹤模式暫存更新失敗:", storageError);
      }

      const scheduledMode = resolveReadTrackerModeFromConfig(nextConfig);
      const manualLocalEnabled = mode === "local";
      const effectiveMode = manualLocalEnabled ? "local" : scheduledMode;

      setReadTrackerConfig(nextConfig);
      setReadTrackerMode(effectiveMode);
      setReadTrackerModeState(effectiveMode);
      showToast(
        mode === "off"
          ? "讀取來源追蹤已切換為關閉；排程設定維持不變"
          : mode === "local"
            ? "已切換為本機模式；排程設定維持不變"
            : "已切換為全域上報模式；排程設定維持不變",
        mode === "off" ? "info" : "success"
      );
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

  const handleEnableLocalReadTracker = () => {
    try {
      localStorage.setItem("read_tracker_manual_local_enabled", "true");
    } catch (storageError) {
      console.warn("本機追蹤狀態暫存失敗:", storageError);
    }

    setReadTrackerMode("local");
    setReadTrackerModeState("local");
    setLocalReadClearedAt(null);
    refreshLocalReadStats();
    showToast("已開啟本機讀取追蹤；排程設定不受影響", "success");
  };

  const handleClearReadTracker = () => {
    if (!window.confirm("確定要清除目前這台裝置的讀取追蹤統計嗎？")) return;
    clearReadTrackerStats();
    setLocalReadStats({});
    setLocalReadClearedAt(new Date());
    setLocalReadLastRefreshedAt(new Date());
    showToast("本機讀取統計已清除，等待新的讀取紀錄", "success");

    window.setTimeout(() => {
      refreshLocalReadStats();
    }, 500);
  };

  const handleManualFlushReadTracker = async () => {
    setLoadingReadStats(true);
    try {
      const result = await flushReadTrackerToFirestore({ db, brandId, brandLabel, userRole, userName: "maintenance_user", activeView: "system_maintenance", force: true });
      if (result.skipped) showToast(`未上報：${result.reason}`, "info");
      else { showToast(`已上報 ${result.totalReadDocs.toLocaleString()} docs`, "success"); refreshLocalReadStats(); }
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

  const normalizeHourlyBucketsFromRow = (row) => {
    if (row.hourlyBuckets && typeof row.hourlyBuckets === "object") return row.hourlyBuckets;

    const parsed = {};
    Object.entries(row || {}).forEach(([key, value]) => {
      if (!key.startsWith("hourlyBuckets.")) return;
      const parts = key.split(".");
      // Firestore field path 會把 2026-06-05T04 中的句點避開，但仍保留這個 fallback 以相容舊寫法。
      const hourKey = parts[1];
      const sourceLabel = parts[3];
      const field = parts[4];
      if (!hourKey || !sourceLabel || !field) return;
      if (!parsed[hourKey]) parsed[hourKey] = { sources: {} };
      if (!parsed[hourKey].sources[sourceLabel]) parsed[hourKey].sources[sourceLabel] = {};
      parsed[hourKey].sources[sourceLabel][field] = value;
    });

    return parsed;
  };

  const getHourKeysInRange = (startMs, endMs) => {
    const keys = [];
    const cursor = new Date(startMs);
    cursor.setMinutes(0, 0, 0);
    const endDate = new Date(endMs);
    endDate.setMinutes(0, 0, 0);

    let safety = 0;
    while (cursor <= endDate && safety < 24 * 8) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}T${String(cursor.getHours()).padStart(2, "0")}`;
      keys.push(key);
      cursor.setHours(cursor.getHours() + 1);
      safety += 1;
    }

    return keys;
  };

  const buildGlobalReadSummaryRowsFromHourlyBuckets = (rows, options = {}) => {
    const startMs = options.startMs ?? null;
    const endMs = options.endMs ?? null;
    const hourKeys = startMs !== null && endMs !== null ? getHourKeysInRange(startMs, endMs) : [];
    const sourceSummary = {};
    const scopedRows = [];
    let unsupportedRows = 0;

    rows.forEach((row) => {
      const isSameBrand = !brandId || !row.brandId || row.brandId === brandId;
      if (!isSameBrand) return;

      const hourlyBuckets = normalizeHourlyBucketsFromRow(row);
      const hasBuckets = hourlyBuckets && Object.keys(hourlyBuckets).length > 0;
      if (!hasBuckets) {
        unsupportedRows += 1;
        return;
      }

      let rowUsed = false;

      hourKeys.forEach((hourKey) => {
        const bucket = hourlyBuckets[hourKey];
        if (!bucket?.sources) return;

        Object.entries(bucket.sources).forEach(([label, item]) => {
          const docs = Number(item?.docs || 0);
          const triggers = Number(item?.triggers || 0);
          if (!docs && !triggers) return;

          if (!sourceSummary[label]) {
            sourceSummary[label] = {
              label,
              docs: 0,
              triggers: 0,
              users: new Set(),
              roles: new Set(),
              devices: new Set(),
              lastAt: "",
            };
          }

          sourceSummary[label].docs += docs;
          sourceSummary[label].triggers += triggers;
          sourceSummary[label].users.add(row.userName || row.userRole || "unknown");
          sourceSummary[label].roles.add(row.userRole || "unknown");
          sourceSummary[label].devices.add(row.device || row.deviceShort || "unknown");

          const lastAt = item?.lastAt || row.updatedAtText || "";
          if (!sourceSummary[label].lastAt || String(lastAt) > String(sourceSummary[label].lastAt)) {
            sourceSummary[label].lastAt = lastAt;
          }

          rowUsed = true;
        });
      });

      if (rowUsed) scopedRows.push(row);
    });

    const summaryRows = Object.values(sourceSummary)
      .map((item) => ({
        ...item,
        users: item.users.size,
        roles: Array.from(item.roles),
        devices: Array.from(item.devices),
        avg: item.triggers ? Math.round(item.docs / item.triggers) : 0,
      }))
      .sort((a, b) => b.docs - a.docs);

    return { summaryRows, scopedRows, unsupportedRows };
  };

  const handleClearGlobalReadStats = () => {
    setGlobalReadStats([]);
    setGlobalRowsCount(0);
    setGlobalReadRangeUnsupportedCount(0);
    setGlobalReadRangeLegacyFallback(false);
    setGlobalReadScopeLabel("尚未載入全域讀取排行");
    showToast("已清除目前畫面上的全域排行結果；Firestore 原始上報資料未刪除", "info");
  };

  const handleLoadGlobalReadStats = async (options = {}) => {
    setLoadingReadStats(true);
    try {
      const scope = options.scope || "all";
      let rows = [];
      let scopeLabel = "近 24 小時全域排行";
      let startMs = null;
      let endMs = null;

      if (scope === "range") {
        const startDate = new Date(globalReadRange.start);
        const endDate = new Date(globalReadRange.end);

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
          showToast("請先選擇正確的開始與結束時間", "error");
          return;
        }

        if (endDate <= startDate) {
          showToast("結束時間必須晚於開始時間", "error");
          return;
        }

        const maxRangeMs = 7 * 24 * 60 * 60 * 1000;
        if (endDate.getTime() - startDate.getTime() > maxRangeMs) {
          showToast("指定時段最多查詢 7 天，避免一次讀取過多追蹤資料", "error");
          return;
        }

        startMs = startDate.getTime();
        endMs = endDate.getTime();
        scopeLabel = getReadableRangeLabel(globalReadRange.start, globalReadRange.end);

        const dateKeys = getDateKeysAroundRange(startDate, endDate);
        const snaps = await Promise.all(
          dateKeys.map((dateKey) => getDocs(query(collection(db, "read_debug_sessions"), where("date", "==", dateKey), limit(600))))
        );
        rows = snaps.flatMap((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } else {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const yesterdayObj = new Date(now);
        yesterdayObj.setDate(yesterdayObj.getDate() - 1);
        const yesterday = yesterdayObj.toISOString().slice(0, 10);

        const [todaySnap, yesterdaySnap] = await Promise.all([
          getDocs(query(collection(db, "read_debug_sessions"), where("date", "==", today), limit(300))),
          getDocs(query(collection(db, "read_debug_sessions"), where("date", "==", yesterday), limit(300))),
        ]);

        rows = [
          ...todaySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          ...yesterdaySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        ];
        startMs = Date.now() - 24 * 60 * 60 * 1000;
        endMs = null;
        scopeLabel = "近 24 小時全域排行";
      }

      let result = scope === "range"
        ? buildGlobalReadSummaryRowsFromHourlyBuckets(rows, { startMs, endMs })
        : buildGlobalReadSummaryRows(rows, { startMs, endMs });

      const selectedRangeText = getReadableRangeText(globalReadRange.start, globalReadRange.end);
      let legacyFallback = false;

      // 舊版全域上報沒有 hourlyBuckets。
      // 若精準小時分桶沒有資料，但有舊版 session，改用舊版 sources.lastAt 粗略彙整，
      // 避免畫面空白造成誤判為「抓不到」。
      if (scope === "range" && (!result.summaryRows || result.summaryRows.length === 0) && Number(result.unsupportedRows || 0) > 0) {
        const fallbackResult = buildGlobalReadSummaryRows(rows, { startMs, endMs });
        if ((fallbackResult.summaryRows || []).length > 0) {
          result = {
            ...fallbackResult,
            unsupportedRows: Number(result.unsupportedRows || 0),
          };
          legacyFallback = true;
        }
      }

      const { summaryRows, scopedRows } = result;
      const unsupportedRows = Number(result.unsupportedRows || 0);

      setGlobalReadStats(summaryRows);
      setGlobalRowsCount(scopedRows.length);
      setGlobalReadScopeLabel(legacyFallback ? `${scopeLabel}（舊版粗略）` : scopeLabel);
      setGlobalReadRangeUnsupportedCount(scope === "range" ? unsupportedRows : 0);
      setGlobalReadRangeLegacyFallback(legacyFallback);

      const rangeUnsupportedText = `此時段找到 ${unsupportedRows.toLocaleString()} 筆舊版全域上報工作階段，但舊資料沒有 hourlyBuckets 小時分桶，無法還原「${selectedRangeText}」的精準來源。已改用舊版 session 時間粗略彙整，僅供初步判斷。`;
      const emptyText = scope === "range"
        ? (unsupportedRows > 0 ? rangeUnsupportedText : `「${selectedRangeText}」尚未找到可彙整的全域追蹤資料`)
        : "近 24 小時尚未找到可彙整的全域追蹤資料";
      const successText = scope === "range"
        ? (legacyFallback ? `已載入${scopeLabel}的舊版粗略排行，共 ${summaryRows.length} 個來源` : `已載入${scopeLabel}，共 ${summaryRows.length} 個來源`)
        : `已載入近 24 小時排行，共 ${summaryRows.length} 個來源`;

      showToast(summaryRows.length === 0 ? emptyText : successText, summaryRows.length === 0 ? "info" : "success");
    } catch (error) {
      console.error(error);
      showToast("讀取全域追蹤失敗，請確認 read_debug_sessions 權限或資料是否存在", "error");
    } finally {
      setLoadingReadStats(false);
    }
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

      const healthResult = {
        month: calMonth,
        scanned,
        orgStores: orgProfile.stores.length,
        activeTherapists: activeTherapists.length,
        issues,
        status,
        dangerCount,
        warningCount,
        createdAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      };
      setHealthReport(healthResult);

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
      return healthResult;
    } catch (error) {
      addLog(`❌ 健康檢查失敗: ${error.message}`);
      showToast("資料健康檢查失敗", "error");
      return { status: "danger", issues: [{ label: "資料健康檢查失敗", count: 1, severity: "danger", hint: error.message }], scanned: 0, dangerCount: 1, warningCount: 0 };
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

      const closingResult = {
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
        riskScore,
        createdAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      };
      setClosingReport(closingResult);

      await addMaintenanceLog({ type: "month_closing_check", action: "run_month_closing_check", month: calMonth, readiness, riskScore, missingStoreReports: missingStoreReports.length, missingTherapistReports: missingTherapistReports.length, duplicateDailyCount: Math.max(0, duplicateDailyCount), duplicateTherapistCount: Math.max(0, duplicateTherapistCount), targetMonthCount, excludedStoreCount: exclusionProfile.storeCoreList.length });

      addLog(`✅ 月結前檢查完成：${readiness}。店日報 ${dailyThisMonth.length.toLocaleString()} 筆、管理師日報 ${therapistThisMonth.length.toLocaleString()} 筆。`);
      showToast(`月結前檢查完成：${readiness}`, readiness === "不建議月結" ? "error" : readiness === "需注意" ? "info" : "success");
      return closingResult;
    } catch (error) {
      addLog(`❌ 月結前檢查失敗: ${error.message}`);
      showToast("月結前檢查失敗", "error");
      return { readiness: "不建議月結", riskScore: 999, error };
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


  const getSummaryStatusMeta = (statusKey) => {
    const map = {
      missing: { label: "尚未建立", tone: "rose", hint: "此品牌月份尚未建立完整 Summary，Dashboard 會使用原本明細計算。" },
      dirty: { label: "需重建", tone: "amber", hint: "此月份有新的日報提交、業績修正或刪除，建議重建並重新比對。" },
      current_dirty: { label: "本月即時累積中", tone: "amber", hint: "本月 Dashboard 目前以即時明細為準，pending 異動可先累積，月結前再一次校準 Summary。" },
      mismatch: { label: "比對有差異", tone: "rose", hint: "Summary 與原始明細重算結果不一致，請先檢查差異再上線使用。" },
      unverified: { label: "已建立，尚未比對", tone: "amber", hint: "三份 Summary 已存在，但尚未完成比對驗證。" },
      verified: { label: "已建立且比對通過", tone: "emerald", hint: "Summary 已建立、無待重算異動，且最近一次比對通過。" },
      ready: { label: "已建立", tone: "emerald", hint: "三份 Summary 已存在。建議仍執行比對確認。" },
    };
    return map[statusKey] || map.ready;
  };

  const loadDashboardSummaryStatus = async (targetMonth = calMonth, silent = false) => {
    if (!/^\d{4}-\d{2}$/.test(String(targetMonth || ""))) {
      if (!silent) showToast("請先選擇正確月份", "error");
      return null;
    }
    if (!silent) setLoadingAction("summaryStatus");
    try {
      const [dashboardSnap, therapistSnap, rankingsSnap, queueSnap, logsSnap, recalcFlagSnap] = await Promise.all([
        getDoc(doc(getCollectionPath("dashboard_summary"), targetMonth)),
        getDoc(doc(getCollectionPath("therapist_summary"), targetMonth)),
        getDoc(doc(getCollectionPath("rankings_summary"), targetMonth)),
        getDocs(query(getCollectionPath("recalc_queue"), where("status", "==", "pending"), limit(500))),
        getDocs(query(getCollectionPath("maintenance_logs"), where("month", "==", targetMonth), limit(120))),
        getDoc(doc(getCollectionPath("summary_recalc_flags"), targetMonth)),
      ]);

      const summaryDocs = {
        dashboard: dashboardSnap.exists(),
        therapist: therapistSnap.exists(),
        rankings: rankingsSnap.exists(),
      };
      const allSummaryExists = summaryDocs.dashboard && summaryDocs.therapist && summaryDocs.rankings;
      const dashboardData = dashboardSnap.exists() ? dashboardSnap.data() || {} : {};
      const therapistData = therapistSnap.exists() ? therapistSnap.data() || {} : {};
      const rankingsData = rankingsSnap.exists() ? rankingsSnap.data() || {} : {};
      const updatedAtText = dashboardData.lastUpdatedAtText || therapistData.lastUpdatedAtText || rankingsData.lastUpdatedAtText || "";
      const summaryUpdatedMs = updatedAtText ? new Date(updatedAtText).getTime() : 0;

      const pendingRows = queueSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => getQueueYearMonth(row) === targetMonth);

      const recalcFlag = recalcFlagSnap.exists() ? { id: recalcFlagSnap.id, ...recalcFlagSnap.data() } : null;
      const recalcFlagStatus = String(recalcFlag?.status || "");
      const flagDirty = Boolean(recalcFlag) && !["completed", "verified", "idle"].includes(recalcFlagStatus);
      const effectivePendingCount = Math.max(pendingRows.length, Number(recalcFlag?.pendingCount || 0));

      const compareLogs = logsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => row.type === "dashboard_summary" && row.action === "compare_summary_with_raw")
        .sort((a, b) => new Date(b.createdAtText || 0).getTime() - new Date(a.createdAtText || 0).getTime());
      const latestCompare = compareLogs[0] || null;
      const latestCompareMs = latestCompare?.createdAtText ? new Date(latestCompare.createdAtText).getTime() : 0;
      const compareAfterBuild = latestCompare && (!summaryUpdatedMs || latestCompareMs >= summaryUpdatedMs - 1000);

      let statusKey = "ready";
      if (!allSummaryExists) statusKey = "missing";
      else if ((effectivePendingCount > 0 || flagDirty) && isSelectedCurrentMonth(targetMonth)) statusKey = "current_dirty";
      else if (effectivePendingCount > 0 || flagDirty) statusKey = "dirty";
      else if (!latestCompare || !compareAfterBuild) statusKey = "unverified";
      else if (latestCompare.status === "matched") statusKey = "verified";
      else statusKey = "mismatch";

      const statusMeta = getSummaryStatusMeta(statusKey);
      const report = {
        month: targetMonth,
        statusKey,
        ...statusMeta,
        summaryDocs,
        updatedAtText: updatedAtText ? new Date(updatedAtText).toLocaleString("zh-TW", { hour12: false }) : "-",
        lastUpdatedAtText: updatedAtText || "",
        pendingCount: effectivePendingCount,
        pendingQueueCount: pendingRows.length,
        pendingSources: [...new Set(pendingRows.map((row) => row.sourceType || row.source || recalcFlag?.latestSourceType || "unknown"))],
        latestPendingAt: pendingRows.map((row) => row.createdAtText || row.updatedAtText || "").filter(Boolean).sort().pop() || recalcFlag?.lastDirtyAtText || "-",
        recalcFlag,
        recalcFlagStatus: recalcFlagStatus || "none",
        recalcFlagRebuildAfterAtText: recalcFlag?.rebuildAfterAtText || "",
        lastDirtyAtText: recalcFlag?.lastDirtyAtText || "",
        lastCompareAt: latestCompare?.createdAtText ? new Date(latestCompare.createdAtText).toLocaleString("zh-TW", { hour12: false }) : "-",
        lastCompareStatus: latestCompare?.status || "-",
        lastCompareMismatchCount: latestCompare?.mismatchCount ?? 0,
        checkedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      };
      setSummaryStatusReport(report);
      if (!silent) showToast(`Summary 狀態：${report.label}`, statusKey === "verified" || statusKey === "ready" ? "success" : statusKey === "missing" || statusKey === "mismatch" ? "error" : "info");
      return report;
    } catch (error) {
      console.error(error);
      if (!silent) showToast("Summary 狀態檢查失敗", "error");
      return null;
    } finally {
      if (!silent) setLoadingAction(null);
    }
  };


  const handleCalibrateAllPendingMonths = async () => {
    const rows = await loadPendingRecalcQueueRows();
    const groups = summarizeRecalcQueueRows(rows).filter((group) => group.month && group.month !== "未知月份");
    if (groups.length === 0) return showToast("目前沒有待重新校準月份", "info");
    if (!window.confirm(`確定要依序校準 ${groups.length} 個月份嗎？\n\n共 ${rows.length.toLocaleString()} 筆 pending 異動會在校準成功後標記完成。`)) return;

    setLoadingAction("calibrateAllQueues");
    setLogs([]);
    addLog(`🔄 啟動批次校準：${brandId}｜${groups.length} 個月份｜${rows.length.toLocaleString()} 筆 pending`);
    let completedMonths = 0;
    let completedRows = 0;
    try {
      await addMaintenanceLog({ type: "recalc_queue", action: "start_calibrate_all_pending_months", status: "started", monthCount: groups.length, queueCount: rows.length });
      for (const group of groups.sort((a, b) => String(a.month).localeCompare(String(b.month)))) {
        addLog(`・校準 ${group.month} 中...`);
        const response = await fetch(`https://recalculatemonthlydata-hyhcwrnyaa-uc.a.run.app?brandId=${brandId}&yearMonth=${group.month}`);
        if (!response.ok) throw new Error(`${group.month} 伺服器回應異常`);
        const result = await response.text();
        const count = await markRecalcQueueCompleted(group.month, group.items || [], result);
        completedMonths += 1;
        completedRows += count;
        await addDoc(getCollectionPath("calibration_logs"), {
          brandId,
          brandLabel,
          month: group.month,
          status: "success",
          source: "recalc_queue_batch",
          queueCount: group.count,
          completedQueueCount: count,
          resultText: result,
          operator: currentUser?.name || "director",
          createdAt: serverTimestamp(),
          createdAtText: new Date().toISOString(),
        });
        addLog(`✅ ${group.month} 完成，${count.toLocaleString()} 筆 queue 已標記完成。`);
      }
      await addMaintenanceLog({ type: "recalc_queue", action: "finish_calibrate_all_pending_months", status: "success", monthCount: completedMonths, completedQueueCount: completedRows });
      setRecalcQueueGroups([]);
      setRecalcQueueTotal(0);
      await loadDashboardSummaryStatus(calMonth, true);
      showToast(`已完成 ${completedMonths} 個月份校準，${completedRows.toLocaleString()} 筆待辦已完成`, "success");
    } catch (error) {
      console.error(error);
      addLog(`❌ 批次校準失敗：${error.message}`);
      await addMaintenanceLog({ type: "recalc_queue", action: "fail_calibrate_all_pending_months", status: "failed", errorMessage: error.message, completedMonths, completedQueueCount: completedRows });
      showToast("批次校準失敗，請查看紀錄", "error");
    } finally {
      setLoadingAction(null);
      handleLoadRecalcQueue();
    }
  };

  const handleMonthEndDashboardSummaryCalibration = async () => {
    if (!/^\d{4}-\d{2}$/.test(String(calMonth || ""))) return showToast("請先選擇正確月份", "error");
    if (!window.confirm(`確定要執行 ${calMonth} 月份報表整理嗎？\n\n流程會重建 dashboard_summary / therapist_summary / rankings_summary、立即比對，並將此月份 pending queue 標記完成。`)) return;

    setLoadingAction("monthEndSummaryCalibration");
    setLogs([]);
    setSummaryBuildReport(null);
    setSummaryCompareReport(null);
    addLog(`🧾 啟動月份報表整理：${brandId}｜${calMonth}`);
    try {
      await addMaintenanceLog({ type: "dashboard_summary", action: "start_month_end_summary_calibration", month: calMonth, status: "started" });
      const { dashboardSummary, therapistSummary, rankingsSummary } = await buildDashboardSummaryPayloads(calMonth);
      const batch = writeBatch(db);
      batch.set(doc(getCollectionPath("dashboard_summary"), calMonth), dashboardSummary);
      batch.set(doc(getCollectionPath("therapist_summary"), calMonth), therapistSummary);
      batch.set(doc(getCollectionPath("rankings_summary"), calMonth), rankingsSummary);
      await batch.commit();

      const rows = makeSummaryCompareRows({ storedDashboard: dashboardSummary, storedTherapist: therapistSummary, freshDashboard: dashboardSummary, freshTherapist: therapistSummary });
      const mismatchRows = rows.filter((row) => !row.matched);
      const isMatched = mismatchRows.length === 0;
      const pendingRows = (await loadPendingRecalcQueueRows()).filter((row) => getQueueYearMonth(row) === calMonth);
      const completedCount = await markRecalcQueueCompleted(calMonth, pendingRows, "month_end_summary_calibration");

      const buildReport = {
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
      const compareReport = {
        month: calMonth,
        matched: isMatched,
        status: isMatched ? "全部一致" : "發現差異",
        mismatchCount: mismatchRows.length,
        rows,
        storedUpdatedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
        comparedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      };
      setSummaryBuildReport(buildReport);
      setSummaryCompareReport(compareReport);

      await addDoc(getCollectionPath("calibration_logs"), {
        brandId,
        brandLabel,
        month: calMonth,
        status: isMatched ? "success" : "mismatch",
        source: "month_end_summary_calibration",
        result: { buildReport, mismatchCount: mismatchRows.length, completedQueueCount: completedCount },
        operator: currentUser?.name || "director",
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
      });
      await addMaintenanceLog({
        type: "dashboard_summary",
        action: "compare_summary_with_raw",
        month: calMonth,
        status: isMatched ? "matched" : "mismatch",
        mismatchCount: mismatchRows.length,
        result: compareReport,
        source: "month_report_assistant",
      });
      await addMaintenanceLog({ type: "dashboard_summary", action: "month_end_summary_calibration", month: calMonth, status: isMatched ? "matched" : "mismatch", mismatchCount: mismatchRows.length, completedQueueCount: completedCount });
      await markSummaryRecalcFlagCompleted(calMonth, {
        status: isMatched ? "verified" : "mismatch",
        result: isMatched ? "month_report_finalized" : "month_report_mismatch",
        mismatchCount: mismatchRows.length,
        completedQueueCount: completedCount,
      });
      addLog(`✅ Summary 已重建並比對：${isMatched ? "全部一致" : `${mismatchRows.length} 項差異`}。`);
      addLog(`✅ ${completedCount.toLocaleString()} 筆 ${calMonth} pending queue 已標記完成。`);
      await loadDashboardSummaryStatus(calMonth, true);
      await handleLoadRecalcQueue();
      showToast(isMatched ? "月份報表整理完成且比對一致" : `月份報表整理完成，但有 ${mismatchRows.length} 項差異`, isMatched ? "success" : "error");
    } catch (error) {
      console.error(error);
      addLog(`❌ 月份報表整理失敗：${error.message}`);
      await addMaintenanceLog({ type: "dashboard_summary", action: "fail_month_end_summary_calibration", month: calMonth, status: "failed", errorMessage: error.message });
      showToast("月份報表整理失敗", "error");
    } finally {
      setLoadingAction(null);
    }
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
      await loadDashboardSummaryStatus(calMonth, true);
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
      await loadDashboardSummaryStatus(calMonth, true);
    } catch (error) {
      console.error(error);
      addLog(`❌ Dashboard Summary 比對失敗：${error.message}`);
      await addMaintenanceLog({ type: "dashboard_summary", action: "fail_compare_summary", month: calMonth, status: "failed", errorMessage: error.message });
      showToast("Dashboard Summary 比對失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };


  // 過渡工具：將既有 monthly_targets 一鍵補整理成全年 monthly_targets_summary。
  // 目的只為導入 Dashboard 輕量目標資料；不改原始 monthly_targets，也不影響 TargetView 儲存邏輯。
  const parseMonthlyTargetDocForSummary = (docId = "", data = {}, selectedYearValue = "") => {
    const idText = String(docId || "");
    const parts = idText.split("_");
    let storeName = data.storeName || data.store || data.shopName || data.branchName || "";
    let year = data.year || data.targetYear || data.selectedYear || "";
    let month = data.month || data.targetMonth || data.selectedMonth || "";

    if ((!storeName || !year || !month) && parts.length >= 3) {
      const maybeMonth = parts[parts.length - 1];
      const maybeYear = parts[parts.length - 2];
      if (/^\d{4}$/.test(String(maybeYear)) && /^\d{1,2}$/.test(String(maybeMonth))) {
        year = year || maybeYear;
        month = month || maybeMonth;
        storeName = storeName || parts.slice(0, -2).join("_");
      }
    }

    const yearMonth = data.yearMonth || data.monthKey || "";
    if ((!year || !month) && /^\d{4}-\d{2}$/.test(String(yearMonth))) {
      year = String(yearMonth).slice(0, 4);
      month = String(Number(String(yearMonth).slice(5, 7)));
    }

    const yearText = String(year || "");
    const monthNum = Number(month || 0);
    if (yearText !== String(selectedYearValue) || !monthNum || monthNum < 1 || monthNum > 12) return null;

    const core = normalizeCoreName(storeName);
    if (!core) return null;

    const rawStore = String(storeName || "").trim();
    const hasBrandPrefix = /^(CYJ|Anew|Yibo|安妞|伊啵)/i.test(rawStore);
    const fullStoreName = hasBrandPrefix
      ? (rawStore.endsWith("店") ? rawStore : `${rawStore}店`)
      : `${brandLabel}${core}店`;

    return {
      year: yearText,
      month: monthNum,
      yearMonth: `${yearText}-${String(monthNum).padStart(2, "0")}`,
      storeName: fullStoreName,
      coreStoreName: core,
      target: {
        storeName: fullStoreName,
        coreStoreName: core,
        cashTarget: Number(data.cashTarget || 0),
        accrualTarget: Number(data.accrualTarget || 0),
        challengeCashTarget: Number(data.challengeCashTarget || 0),
        challengeAccrualTarget: Number(data.challengeAccrualTarget || 0),
        isUnlocked: Boolean(data.isUnlocked),
        updatedAtText: data.updatedAtText || data.updatedAt || "",
        updatedBy: data.updatedBy || "",
        sourceDocId: docId,
      },
    };
  };

  const handleRebuildYearlyTargetSummary = async () => {
    const year = String(targetSummaryYear || new Date().getFullYear()).trim();
    if (!/^\d{4}$/.test(year)) return showToast("請先確認年度格式", "error");

    if (!window.confirm(`確定要補整理 ${brandLabel} ${year} 年 1～12 月店家目標嗎？\n\n這是過渡工具，只會依照目前 monthly_targets 重新整理 monthly_targets_summary，不會修改原始目標。`)) return;

    setLoadingAction("rebuildYearlyTargetSummary");
    setTargetSummaryReport(null);
    setLogs([]);
    addLog(`🎯 開始補整理年度目標 Summary：${brandLabel}｜${year}`);

    try {
      const snap = await getDocs(getCollectionPath("monthly_targets"));
      const monthBuckets = {};
      const skippedDocs = [];

      for (let i = 1; i <= 12; i += 1) {
        const yearMonth = `${year}-${String(i).padStart(2, "0")}`;
        monthBuckets[yearMonth] = { yearMonth, month: i, targets: {}, sourceDocIds: [] };
      }

      snap.docs.forEach((d) => {
        const data = d.data() || {};
        const parsed = parseMonthlyTargetDocForSummary(d.id, data, year);
        if (!parsed) {
          if (String(d.id || "").includes(year)) skippedDocs.push(d.id);
          return;
        }
        monthBuckets[parsed.yearMonth].targets[parsed.storeName] = parsed.target;
        monthBuckets[parsed.yearMonth].sourceDocIds.push(d.id);
      });

      const batch = writeBatch(db);
      const nowText = new Date().toISOString();
      let totalTargets = 0;
      let writtenDocs = 0;
      const rows = [];

      Object.values(monthBuckets).forEach((bucket) => {
        const targetEntries = Object.entries(bucket.targets || {});
        const storeCount = targetEntries.length;
        totalTargets += storeCount;

        const cashTargetTotal = targetEntries.reduce((sum, [, item]) => sum + Number(item.cashTarget || 0), 0);
        const accrualTargetTotal = targetEntries.reduce((sum, [, item]) => sum + Number(item.accrualTarget || 0), 0);

        batch.set(doc(getCollectionPath("monthly_targets_summary"), bucket.yearMonth), {
          brandId,
          brandLabel,
          year,
          month: bucket.month,
          yearMonth: bucket.yearMonth,
          targets: bucket.targets,
          storeCount,
          targetCount: storeCount,
          cashTargetTotal,
          accrualTargetTotal,
          sourceDocCount: bucket.sourceDocIds.length,
          source: "SystemMaintenance_yearly_target_summary_rebuild",
          rebuiltAt: serverTimestamp(),
          rebuiltAtText: nowText,
          rebuiltBy: currentUser?.name || "director",
          rebuiltByRole: userRole || "director",
        });

        writtenDocs += 1;
        rows.push({ month: bucket.yearMonth, storeCount, sourceDocCount: bucket.sourceDocIds.length, cashTargetTotal, accrualTargetTotal });
      });

      await batch.commit();

      const report = {
        brandId,
        brandLabel,
        year,
        sourceDocs: snap.size,
        writtenDocs,
        totalTargets,
        skippedDocs: skippedDocs.length,
        rows,
        createdAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      };

      setTargetSummaryReport(report);
      addLog(`✅ 年度目標 Summary 補整理完成：寫入 ${writtenDocs} 份月份資料，整理 ${totalTargets.toLocaleString()} 筆店家目標。`);

      await addMaintenanceLog({
        type: "monthly_targets_summary",
        action: "rebuild_yearly_monthly_targets_summary",
        status: "success",
        year,
        writtenDocs,
        totalTargets,
        sourceDocs: snap.size,
      });

      showToast(`${year} 年目標 Summary 補整理完成`, "success");
    } catch (error) {
      console.error(error);
      addLog(`❌ 年度目標 Summary 補整理失敗：${error.message}`);
      await addMaintenanceLog({
        type: "monthly_targets_summary",
        action: "fail_rebuild_yearly_monthly_targets_summary",
        status: "failed",
        year,
        errorMessage: error.message,
      });
      showToast("年度目標 Summary 補整理失敗", "error");
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
      <div className="max-w-6xl mx-auto space-y-6 pb-10 animate-in fade-in duration-500">
        {renderMaintenanceScenarioGuide()}

        <section className="rounded-[2rem] border border-[#E8DDD0] bg-gradient-to-br from-[#FFFCF7] via-white to-[#FFF8EC] shadow-[0_22px_70px_rgba(120,90,40,0.06)] overflow-hidden">
          <button type="button" onClick={() => setShowCoreTools((prev) => !prev)} className="w-full p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-left">
            <SectionTitle eyebrow="Advanced Tools" title="進階維護工具" desc="一般人員只需要使用上方三個入口；需要資料救援、報表整理或流量排查時再展開。" icon={Settings} />
            <div className="inline-flex items-center gap-2 text-xs font-black text-stone-500 bg-white/80 border border-stone-200 rounded-2xl px-3 py-2 w-fit">
              {showCoreTools ? "收合工具" : "展開工具"}
              <ChevronDown size={14} className={`transition-transform ${showCoreTools ? "rotate-180" : ""}`} />
            </div>
          </button>
          {showCoreTools && <div className="px-6 pb-6 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
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
            <ToolRow icon={RefreshCw} title="待重新校準月份" desc="彙整 recalc_queue 的 pending 紀錄；當月可先累積，月結前再一次校準；歷史月份若有 pending 則建議優先重建。" badge={recalcQueueTotal ? `${recalcQueueTotal.toLocaleString()} 筆待處理` : "Summary 前置"} tone="amber">
              <BeautyButton onClick={handleLoadRecalcQueue} disabled={loadingAction !== null} variant="secondary">
                {loadingAction === "loadRecalcQueue" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                載入待重算
              </BeautyButton>
              <BeautyButton onClick={handleCalibrateAllPendingMonths} disabled={loadingAction !== null || recalcQueueTotal === 0} variant="primary">
                {loadingAction === "calibrateAllQueues" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                校準全部待辦
              </BeautyButton>
            </ToolRow>
            {recalcQueueGroups.length > 0 && (
              <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50/30 p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-stone-800">待重新校準月份</p>
                    <p className="text-[11px] font-bold text-stone-400 mt-1">依 affectedYearMonth 彙整；本月 pending 可先累積，月結前再一次完成校準。</p>
                  </div>
                  <p className="text-[11px] font-bold text-stone-400">共 {recalcQueueTotal.toLocaleString()} 筆 pending</p>
                </div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {recalcQueueGroups.map((group) => (
                    <div key={group.month} className="bg-white/95 border border-stone-100 rounded-2xl p-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-black text-stone-800">{group.month}</p>
                          {isSelectedCurrentMonth(group.month) && <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 text-[10px] font-black">本月可累積</span>}
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
            {summaryStatusReport && (
              <div className={`rounded-[1.75rem] border p-5 shadow-[0_16px_50px_rgba(120,90,40,0.04)] ${summaryStatusReport.tone === "emerald" ? "border-emerald-100 bg-emerald-50/30" : summaryStatusReport.tone === "rose" ? "border-rose-100 bg-rose-50/30" : "border-amber-100 bg-amber-50/30"}`}>
                <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-black text-stone-800">{summaryStatusReport.month} Summary 狀態</p>
                      <span className={`px-3 py-1.5 rounded-full bg-white border text-[11px] font-black ${summaryStatusReport.tone === "emerald" ? "text-emerald-700 border-emerald-100" : summaryStatusReport.tone === "rose" ? "text-rose-600 border-rose-100" : "text-[#B7863D] border-amber-100"}`}>{summaryStatusReport.label}</span>
                    </div>
                    <p className="mt-1 text-xs font-bold text-[#9A8978] leading-relaxed">{summaryStatusReport.hint}</p>
                  </div>
                  <BeautyButton onClick={() => loadDashboardSummaryStatus(calMonth)} disabled={loadingAction !== null} variant="soft" className="shrink-0">
                    {loadingAction === "summaryStatus" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                    重新檢查狀態
                  </BeautyButton>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2 mt-4">
                  {[
                    ["dashboard_summary", summaryStatusReport.summaryDocs?.dashboard ? "已建立" : "尚未建立"],
                    ["therapist_summary", summaryStatusReport.summaryDocs?.therapist ? "已建立" : "尚未建立"],
                    ["rankings_summary", summaryStatusReport.summaryDocs?.rankings ? "已建立" : "尚未建立"],
                    ["待重算異動", `${Number(summaryStatusReport.pendingCount || 0).toLocaleString()} 筆`],
                    ["最後重建", summaryStatusReport.updatedAtText || "-"],
                    ["最後比對", summaryStatusReport.lastCompareAt || "-"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-stone-100 bg-white/90 p-3 min-w-0">
                      <p className="text-[10px] font-black text-stone-400 truncate">{label}</p>
                      <p className="mt-1 text-xs font-black text-stone-700 truncate">{value}</p>
                    </div>
                  ))}
                </div>
                {summaryStatusReport.pendingCount > 0 && (
                  <div className="mt-3 rounded-2xl border border-amber-100 bg-white/80 p-3 text-[11px] font-bold text-[#B7863D] leading-relaxed">
                    {summaryStatusReport.statusKey === "current_dirty"
                      ? `本月仍有 ${Number(summaryStatusReport.pendingCount || 0).toLocaleString()} 筆異動累積中，來源：${summaryStatusReport.pendingSources?.join("、") || "-"}。本月 Dashboard 以即時明細為準，不必每筆修正後都校準，可在月結前一次執行「月份報表整理」。`
                      : `此月份仍有 ${Number(summaryStatusReport.pendingCount || 0).toLocaleString()} 筆 pending 異動，來源：${summaryStatusReport.pendingSources?.join("、") || "-"}。歷史月份建議先執行「校準此月份」或重新建立 Summary 後再比對。`}
                  </div>
                )}
              </div>
            )}
            <ToolRow icon={CheckCircle2} title="月份報表整理" desc="適合月底大量補報、修正後一次執行：重建本月 Summary、立即比對，並清除該月份 pending queue。" badge="營運模式" tone="emerald">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><input type="month" value={calMonth} onChange={(e) => setCalMonth(e.target.value)} className="bg-transparent text-xs font-black text-stone-700 outline-none w-28" /></div>
              <BeautyButton onClick={handleMonthEndDashboardSummaryCalibration} disabled={loadingAction !== null} variant="primary">
                {loadingAction === "monthEndSummaryCalibration" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                月結前校準
              </BeautyButton>
            </ToolRow>
            <ToolRow icon={Target} title="一鍵補整理年度目標" desc="過渡工具：將今年 1～12 月店家目標整理成輕量資料，供營運總覽後續降低讀取量使用。" badge="過渡工具" tone="amber">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11">
                <Calendar size={14} className="text-stone-400" />
                <input
                  type="number"
                  min="2020"
                  max="2099"
                  value={targetSummaryYear}
                  onChange={(e) => setTargetSummaryYear(e.target.value)}
                  className="bg-transparent text-xs font-black text-stone-700 outline-none w-20"
                />
              </div>
              <BeautyButton onClick={handleRebuildYearlyTargetSummary} disabled={loadingAction !== null} variant="primary">
                {loadingAction === "rebuildYearlyTargetSummary" ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}
                一鍵補整理
              </BeautyButton>
            </ToolRow>
            {targetSummaryReport && (
              <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50/30 p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-stone-800">{targetSummaryReport.year} 年度目標補整理完成</p>
                    <p className="text-[11px] font-bold text-stone-400 mt-1">
                      品牌：{targetSummaryReport.brandLabel}｜寫入 {targetSummaryReport.writtenDocs} 份月份資料｜整理 {Number(targetSummaryReport.totalTargets || 0).toLocaleString()} 筆店家目標｜來源 {Number(targetSummaryReport.sourceDocs || 0).toLocaleString()} 筆
                    </p>
                  </div>
                  <span className="px-3 py-1.5 rounded-full bg-white text-[#B7863D] border border-amber-100 text-[11px] font-black">不修改原始目標</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
                  {(targetSummaryReport.rows || []).map((row) => (
                    <div key={row.month} className="rounded-2xl border border-stone-100 bg-white/90 p-3">
                      <p className="text-[11px] font-black text-stone-400">{row.month}</p>
                      <p className="mt-1 text-lg font-black text-[#B7863D]">{Number(row.storeCount || 0).toLocaleString()}</p>
                      <p className="mt-0.5 text-[10px] font-bold text-stone-400">店家目標</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ToolRow icon={Database} title="進階：重建歷史報表" desc="一般情況請使用上方月份報表整理助手；此工具保留給需要單獨重建資料的人員使用。" badge="進階工具" tone="emerald">
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
            <ToolRow icon={CheckCircle2} title="進階：歷史報表比對" desc="一般情況月份報表整理會自動比對；此工具保留給需要單獨確認數字一致性的人員使用。" badge="進階工具" tone="emerald">
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
          </div>}
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
            <div className="flex flex-wrap gap-2">{[{ id: "off", label: "關閉", icon: Power }, { id: "local", label: "本機模式", icon: Monitor }, { id: "global", label: "全域上報", icon: Globe2 }].map((mode)=><button key={mode.id} onClick={()=>handleChangeReadTrackerMode(mode.id)} className={`px-4 py-2 rounded-2xl text-xs font-black border flex items-center gap-2 transition-all ${getReadTrackerModeButtonClass(mode.id)}`}><mode.icon size={14} />{mode.label}</button>)}</div>
          </div>
          <div className="p-6 border-b border-[#F0E3CF] bg-[#FFFCF7]"><div className="rounded-[1.75rem] border border-[#EEDFC7] bg-white shadow-sm overflow-hidden"><div className="p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 border-b border-stone-100"><div className="min-w-0"><h3 className="text-sm font-black text-stone-800 flex items-center gap-2"><Clock size={18} className="text-[#B7863D]" />排程式全域上報</h3><p className="text-xs text-stone-400 font-bold mt-1">固定晚間診斷區間，讓每天數據可比較；支援跨日，例如 19:00～07:00。</p></div><div className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-black border ${!scheduleForm.scheduleEnabled ? "bg-stone-50 text-stone-500 border-stone-200" : scheduleStatus.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-amber-50 text-amber-700 border-amber-100"}`}><CheckCircle2 size={15} />{scheduleStatus.label}｜現在 {scheduleStatus.nowTime}</div></div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr_1fr_auto] gap-3 items-end">
                <div className="rounded-2xl border border-stone-100 bg-stone-50/70 p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-stone-700">啟用排程</p>
                    <p className="text-[11px] text-stone-400 font-bold mt-0.5">排程時段內自動切為全域上報。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScheduleForm((prev) => ({ ...prev, scheduleEnabled: !prev.scheduleEnabled }))}
                    className={`w-12 h-7 rounded-full p-1 transition-all ${scheduleForm.scheduleEnabled ? "bg-[#D8B46B]" : "bg-stone-300"}`}
                    aria-label="切換排程"
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${scheduleForm.scheduleEnabled ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>

                {renderScheduleTimeSelect("startTime", "開始時間", "19:00")}
                {renderScheduleTimeSelect("endTime", "結束時間", "07:00")}

                <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row gap-2">
                  <BeautyButton onClick={handleApplyScheduleNow} variant="secondary" className="whitespace-nowrap">立即套用</BeautyButton>
                  <BeautyButton onClick={handleSaveReadTrackerSchedule} variant="primary" className="whitespace-nowrap"><Save size={14} />儲存排程</BeautyButton>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-3">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  <p className="text-[11px] font-black text-amber-700 leading-relaxed">{getScheduleRangeHint()}</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ["19:00", "07:00", "晚間診斷 19–07"],
                      ["18:00", "07:00", "提早觀察 18–07"],
                      ["20:00", "07:00", "晚班觀察 20–07"],
                      ["09:00", "10:00", "上午測試 09–10"],
                    ].map(([start, end, label]) => (
                      <button
                        key={`${start}_${end}`}
                        type="button"
                        onClick={() => applySchedulePreset(start, end)}
                        className={`px-3 py-1.5 rounded-xl border text-[11px] font-black transition-all active:scale-[0.98] ${
                          scheduleForm.startTime === start && scheduleForm.endTime === end
                            ? "border-amber-300 bg-white text-[#8A6128] shadow-sm"
                            : "border-amber-100 bg-white/70 text-amber-700 hover:bg-white"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 bg-amber-50/50 border-t border-amber-100/60 text-[11px] text-amber-700 font-bold leading-relaxed">目前套用品牌：{brandLabel}。排程啟用後，排程時段內會自動啟用全域上報；白天若臨時開啟本機追蹤，不會修改晚間排程。</div></div></div>
          <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-6"><div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Activity size={16} className="text-emerald-500" /><span className="text-sm font-black text-stone-700">目前裝置統計</span><span className={`px-2 py-1 rounded-full border text-[10px] font-black ${localReadModeTone}`}>{localReadModeLabel}</span>{localReadLastRefreshedAt && <span className="text-[10px] font-bold text-stone-300">更新 {localReadLastRefreshedAt.toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}</div><div className="flex flex-wrap items-center gap-2">{readTrackerMode === "off" && <button onClick={handleEnableLocalReadTracker} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 hover:bg-emerald-100">開啟本機追蹤</button>}<button onClick={refreshLocalReadStats} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-stone-200 text-stone-500 hover:bg-stone-50">重新整理</button><button onClick={handleClearReadTracker} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-rose-100 text-rose-500 hover:bg-rose-50">清除</button></div></div>{renderStatList({ rows: readStatsRows, emptyIcon: BarChart3, emptyText: localReadEmptyText, emptySubText: readTrackerMode === "off" ? "可按右上「開啟本機追蹤」，或在上方模式切換為本機模式 / 全域上報後再觀察。" : "若切換頁面後仍無資料，代表目前沒有新的被追蹤讀取，或資料已由前端狀態提供。" })}</div><div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex flex-col gap-3"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div className="flex items-center gap-2"><Globe2 size={16} className="text-blue-500" /><span className="text-sm font-black text-stone-700">全域讀取排行</span><span className="text-[10px] font-black text-blue-500 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">可篩選時段</span></div><div className="flex flex-wrap items-center gap-2"><button onClick={() => handleLoadGlobalReadStats({ scope: "all" })} disabled={loadingReadStats} className="text-[11px] font-black px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-amber-200 disabled:opacity-40 flex items-center gap-1.5">{loadingReadStats ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}全部 / 近 24 小時</button><button onClick={() => handleLoadGlobalReadStats({ scope: "range" })} disabled={loadingReadStats} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-blue-100 bg-blue-50 text-blue-600 disabled:opacity-40 flex items-center gap-1.5">{loadingReadStats ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}載入時段</button><button onClick={handleClearGlobalReadStats} disabled={loadingReadStats && globalReadStats.length === 0 && globalReadRangeUnsupportedCount === 0} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-rose-100 bg-white text-rose-500 hover:bg-rose-50 disabled:opacity-40 flex items-center gap-1.5"><Trash2 size={13} />清除</button></div></div><div className="rounded-2xl border border-stone-100 bg-stone-50/70 p-3 space-y-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setGlobalReadRange(makeGlobalReadRange("last1h"))} className="text-[10px] font-black px-2.5 py-1 rounded-full border border-stone-200 bg-white text-stone-500 hover:bg-stone-100">最近 1 小時</button><button type="button" onClick={() => setGlobalReadRange(makeGlobalReadRange("early4to5"))} className="text-[10px] font-black px-2.5 py-1 rounded-full border border-stone-200 bg-white text-stone-500 hover:bg-stone-100">凌晨 04:00～05:00</button><button type="button" onClick={() => setGlobalReadRange(makeGlobalReadRange("overnight"))} className="text-[10px] font-black px-2.5 py-1 rounded-full border border-stone-200 bg-white text-stone-500 hover:bg-stone-100">昨晚 18:00～今早 07:00</button></div><div className="grid grid-cols-1 md:grid-cols-2 gap-3">{renderGlobalReadRangePicker("start", "開始時間")}{renderGlobalReadRangePicker("end", "結束時間")}</div><p className="text-[10px] font-bold text-stone-400 leading-relaxed">「全部 / 近 24 小時」保留原本觀察方式；「載入時段」可用來查凌晨 04:00～05:00 等異常尖峰來源。指定時段最多查詢 7 天，避免一次讀取過多追蹤資料。</p></div></div>{globalReadStats.length > 0 && <div className="p-4 pb-0 text-[11px] text-stone-400 font-bold">已彙整 {globalReadScopeLabel}｜{globalRowsCount.toLocaleString()} 筆上報工作階段</div>}{globalReadRangeUnsupportedCount > 0 && <div className="m-4 mb-0 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-[11px] font-bold text-amber-700 leading-relaxed">{globalReadRangeLegacyFallback ? <>此時段找到 {globalReadRangeUnsupportedCount.toLocaleString()} 筆舊版全域上報工作階段，但舊資料沒有 hourlyBuckets 小時分桶，已改用舊版 session 時間粗略彙整。這份排行可用來初步判斷來源，但不是「{getReadableRangeText(globalReadRange.start, globalReadRange.end)}」的精準小時分桶。</> : <>此時段找到 {globalReadRangeUnsupportedCount.toLocaleString()} 筆舊版全域上報工作階段，但舊資料沒有 hourlyBuckets 小時分桶，無法還原「{getReadableRangeText(globalReadRange.start, globalReadRange.end)}」的精準來源。新版上線後，下一輪全域上報即可用目前選擇的時段正確分析。</>}</div>}{renderStatList({ rows: globalReadStats, emptyIcon: Globe2, emptyText: "尚未載入全域讀取排行", valueClass: "text-blue-600" })}</div></div>
        </section>

        <section className="rounded-[2rem] border border-[#EEDFC7] bg-white/95 shadow-[0_22px_70px_rgba(120,90,40,0.05)] overflow-hidden"><button onClick={()=>setShowAdvancedTools((prev)=>!prev)} className="w-full p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-left"><SectionTitle eyebrow="Protected Area" title="高風險資料處理" desc="還原、封存與批次修復都集中在這裡；沒有明確異常時不建議操作。" icon={AlertTriangle} /><div className="inline-flex items-center gap-2 text-xs font-black text-stone-500 bg-stone-50 border border-stone-200 rounded-2xl px-3 py-2 w-fit">{showAdvancedTools ? "收合工具" : "展開工具"}<ChevronDown size={14} className={`transition-transform ${showAdvancedTools ? "rotate-180" : ""}`} /></div></button>
          {showAdvancedTools && <div className="px-6 pb-6 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300"><ToolRow icon={Database} title="日期格式修復" desc="先掃描日期格式異常，再確認是否批次修復為 YYYY-MM-DD。" badge={dateIssues.length ? `${dateIssues.length} 筆預覽` : "兩段式"}><BeautyButton onClick={handleScanDateFormats} disabled={loadingAction !== null} variant="secondary">{loadingAction === "scanDates" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}掃描日期</BeautyButton><BeautyButton onClick={handleFixDateFormats} disabled={loadingAction !== null || dateIssues.length === 0} variant="primary">{loadingAction === "fixDates" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}修復日期</BeautyButton></ToolRow>{dateIssues.length > 0 && <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50/40 p-4 text-xs font-bold text-amber-800 space-y-1"><p className="font-black">日期異常預覽</p>{dateIssues.slice(0,5).map((item)=><p key={`${item.colName}_${item.id}`}>{item.colName}｜{item.store}｜{item.person}｜{item.oldDate} → {item.newDate}</p>)}</div>}
          <ToolRow icon={Scissors} title="重複資料檢測與封存" desc="預設只檢測，不再一鍵刪除。確認後會將舊資料標記封存。" badge={duplicateGroups.length ? `${duplicateGroups.length} 組預覽` : "安全版"} tone="rose"><BeautyButton onClick={handleScanDuplicates} disabled={loadingAction !== null} variant="secondary">{loadingAction === "scanDups" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}檢測重複</BeautyButton><BeautyButton onClick={handleArchiveDuplicates} disabled={loadingAction !== null || duplicateGroups.length === 0} variant="soft">{loadingAction === "archiveDups" ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}封存舊資料</BeautyButton></ToolRow>{duplicateGroups.length > 0 && <div className="rounded-[1.5rem] border border-rose-100 bg-rose-50/30 p-4 text-xs font-bold text-rose-700 space-y-1"><p className="font-black">重複資料預覽</p>{duplicateGroups.slice(0,5).map((group)=><p key={`${group.colName}_${group.key}`}>{group.colName}｜{group.date}｜{group.store}｜{group.person}｜保留 1 筆、封存 {group.duplicateIds.length} 筆</p>)}</div>}
          <ToolRow icon={RefreshCw} title="封存資料檢視與還原" desc="查看已封存的疑似重複資料，可單筆還原。" badge={archivedDuplicates.length ? `${archivedDuplicates.length} 筆` : "可還原"}><div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><input type="month" value={archiveFilterMonth} onChange={(e)=>setArchiveFilterMonth(e.target.value)} className="bg-transparent text-xs font-black text-stone-700 outline-none w-28" /></div><BeautyButton onClick={handleLoadArchivedDuplicates} disabled={loadingAction !== null} variant="secondary">{loadingAction === "loadArchived" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}載入封存</BeautyButton></ToolRow>{archivedDuplicates.length > 0 && <div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 p-4 space-y-2 max-h-[340px] overflow-y-auto"><p className="text-xs font-black text-stone-700">封存資料清單</p>{archivedDuplicates.slice(0,30).map((row)=><div key={`${row.colName}_${row.id}`} className="bg-white border border-stone-100 rounded-2xl p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div className="min-w-0"><p className="text-xs font-black text-stone-700 truncate">{row.colName}｜{row.date}｜{row.store}｜{row.person}</p><p className="text-[10px] font-bold text-stone-400 mt-1">保留文件：{row.keepId}｜封存時間：{row.archivedAt}</p></div><BeautyButton onClick={()=>handleRestoreArchivedDuplicate(row)} disabled={loadingAction !== null} variant="soft" className="h-9 px-4 shrink-0">{loadingAction === `restore_${row.id}` ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}還原</BeautyButton></div>)}</div>}</div>}
        </section>

        <section className="rounded-[2rem] border border-stone-100 bg-white/90 p-6 shadow-[0_16px_50px_rgba(120,90,40,0.04)]"><ToolRow icon={RefreshCw} title="清除本機快取" desc="只清除目前瀏覽器暫存，不會刪除雲端資料。適合畫面異常、舊版快取或登入狀態卡住時使用。" badge="本機排錯"><BeautyButton onClick={handleClearLocalCache} variant="secondary"><RefreshCw size={14} />清除快取並重載</BeautyButton></ToolRow></section>

        <section className="rounded-[2rem] border border-stone-100 bg-[#FFFCF7] p-6 shadow-[inset_0_2px_10px_rgba(120,90,40,0.02)]"><div className="flex justify-between items-center mb-4"><div className="flex items-center gap-2 text-stone-600"><ClipboardList size={18} strokeWidth={2} className="text-[#B7863D]" /><span className="font-black tracking-tight text-sm">操作紀錄</span></div><div className="flex items-center gap-3">{loadingAction && <span className="text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-xl font-black animate-pulse flex items-center gap-1.5 border border-amber-100/50"><Loader2 size={14} className="animate-spin" />執行中...</span>}{logs.length > 0 && !loadingAction && <button onClick={()=>setLogs([])} className="text-xs font-black text-stone-400 hover:text-rose-500 transition-colors flex items-center gap-1 px-2 py-1"><Trash2 size={14} />清除</button>}</div></div><div className="bg-white rounded-[1.5rem] p-5 font-mono text-[13px] h-[280px] overflow-y-auto border border-stone-200/50 shadow-sm space-y-2 selection:bg-amber-100">{logs.length === 0 ? <div className="flex h-full items-center justify-center flex-col gap-3 opacity-50"><ClipboardList size={36} className="text-stone-300" strokeWidth={1.5} /><span className="text-xs font-black tracking-widest text-stone-400 uppercase">Ready</span></div> : logs.map((log)=>{ const isError = log.text.includes("❌"); const isFix = log.text.includes("✏️"); const isDel = log.text.includes("🗑️"); const isSuccess = log.text.includes("✅") || log.text.includes("🎉") || log.text.includes("✨") || log.text.includes("🔄") || log.text.includes("↩️"); let textColor = "text-stone-500"; if (isError) textColor = "text-rose-500 font-black"; else if (isFix) textColor = "text-amber-600"; else if (isDel) textColor = "text-stone-400 line-through"; else if (isSuccess) textColor = "text-stone-800 font-black"; return <div key={log.id} className="border-b border-stone-50 pb-2.5 last:border-0 hover:bg-stone-50 rounded px-2 -mx-2 transition-colors flex items-start gap-3"><span className="text-stone-400 shrink-0 select-none pt-0.5">[{log.time}]</span><span className={`${textColor} break-all leading-relaxed`}>{log.text}</span></div>; })}</div></section>
      </div>
    </ViewWrapper>
  );
}
