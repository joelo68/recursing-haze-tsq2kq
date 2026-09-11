// src/components/SystemMaintenance.jsx
import React, { useState, useContext, useEffect, useMemo, useRef } from "react";
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
  orderBy,
  startAfter,
  documentId,
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
  Sparkles,
} from "lucide-react";
import { ViewWrapper } from "./SharedUI";
import SmartCalendar from "./SmartCalendar";
import SmartMonthPicker from "./SmartMonthPicker";
import {
  getReadTrackerMode,
  setReadTrackerMode,
  setManualLocalReadTrackerEnabled,
  getReadTrackerStats,
  clearReadTrackerStats,
  flushReadTrackerToFirestore,
  getReadTrackerScheduleStatus,
  resolveReadTrackerModeFromConfig,
} from "../utils/readTracker";
import {
  SUMMARY_SEMANTIC_VERSION,
  aggregateFormalMetrics,
  extractTargetCoverageMetadata,
  buildSummaryTargetAuthoritySnapshot,
  buildScopeFormalAchievement,
  buildFormalStoreRanking,
  buildSummaryStoreSemanticSignature,
  buildFormalRankingSignature,
} from "../utils/summarySemantics";
import {
  THERAPIST_KPI_SEMANTIC_VERSION,
  applyTherapistRankingSemantics,
  buildTherapistAggregateMetrics,
  buildTherapistSummarySignature,
} from "../utils/therapistKpi";
import {
  getLifecycleEligibleStoreEntries,
  normalizeLifecycleMaster,
} from "../utils/storeLifecycle";

import {
  buildProjectionObservabilitySnapshot,
  getProjectionObservabilityTone,
  getTaipeiProjectionYearMonth,
} from "../utils/projectionObservability.js";

const todayMonth = () => new Date().toISOString().substring(0, 7);

// Keep ToolRow at module scope. Defining a component inside SystemMaintenance creates a
// new component identity on every parent state update; controlled inputs nested inside it
// are then remounted and lose focus after each keystroke.
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

export default function SystemMaintenance() {
  const { currentBrand, userRole, showToast, getCollectionPath, getDocPath, currentUser } = useContext(AppContext);

  const [logs, setLogs] = useState([]);
  const [loadingAction, setLoadingAction] = useState(null);
  const [calMonth, setCalMonth] = useState(todayMonth());
  const [backupType, setBackupType] = useState("full");
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [showCoreTools, setShowCoreTools] = useState(false);
  const [showTrafficTools, setShowTrafficTools] = useState(false);
  const [activeMaintenanceScenario, setActiveMaintenanceScenario] = useState("daily");
  const [guidedFlowReport, setGuidedFlowReport] = useState(null);
  const [guidedFlowRunning, setGuidedFlowRunning] = useState(false);
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
  const [recalcQueueHealth, setRecalcQueueHealth] = useState(null);
  const [summaryBuildReport, setSummaryBuildReport] = useState(null);
  const [summaryCompareReport, setSummaryCompareReport] = useState(null);
  const [summaryStatusReport, setSummaryStatusReport] = useState(null);
  const [archiveFilterMonth, setArchiveFilterMonth] = useState(todayMonth());
  const [consistencyReport, setConsistencyReport] = useState(null);
  const [expandedConsistencyIssue, setExpandedConsistencyIssue] = useState("");
  const [consistencyAuditScope, setConsistencyAuditScope] = useState("month");
  const [consistencyAuditYear, setConsistencyAuditYear] = useState(String(new Date().getFullYear()));

  const [projectionObservabilityState, setProjectionObservabilityState] = useState({
    brandId: "",
    status: "idle",
    data: null,
    error: null,
    loadedAtText: "",
  });

  useEffect(() => {
    setProjectionObservabilityState({
      brandId: "",
      status: "idle",
      data: null,
      error: null,
      loadedAtText: "",
    });
  }, [currentBrand?.id]);

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

    // 維護中心必須與 Dashboard / Functions 使用同一套店名核心規則。
    // 「新店」是正式地名；同時相容舊資料曾被錯誤壓成「新」的格式。
    const core = raw
      .replace(/^(DRCYJ|CYJ|Anew安妞|Yibo伊啵|Anew|Yibo|安妞|伊啵)/i, "")
      .replace(/臺/g, "台")
      .trim();

    if (core === "新" || /^新店店?$/.test(core)) return "新店";

    // 其餘店家維持原本行為，避免擴大改動範圍。
    return core
      .replace(/店/g, "")
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

  const buildRecalcQueueHealth = (rows = []) => {
    const currentMonth = todayMonth();
    const duplicateKeys = new Map();
    const health = {
      total: rows.length,
      historical: 0,
      live: 0,
      future: 0,
      invalid: 0,
      duplicate: 0,
    };

    rows.forEach((row) => {
      const month = getQueueYearMonth(row);
      if (month === "未知月份") health.invalid += 1;
      else if (month < currentMonth) health.historical += 1;
      else if (month === currentMonth) health.live += 1;
      else health.future += 1;

      if (month !== "未知月份") {
        const sourceId = row.sourceReportId || row.sourceId || row.id || "";
        const key = `${month}|${row.sourceType || row.source || "unknown"}|${sourceId}`;
        duplicateKeys.set(key, Number(duplicateKeys.get(key) || 0) + 1);
      }
    });

    health.duplicate = Array.from(duplicateKeys.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    return health;
  };

  const loadPendingRecalcQueueRows = async () => {
    try {
      const rows = [];
      let cursor = null;
      const pageSize = 200;
      const safetyLimit = 5000;

      while (rows.length < safetyLimit) {
        const constraints = [
          where("status", "==", "pending"),
          orderBy(documentId()),
        ];
        if (cursor) constraints.push(startAfter(cursor));
        constraints.push(limit(pageSize));

        const snap = await getDocs(query(getCollectionPath("recalc_queue"), ...constraints));
        rows.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        if (snap.size < pageSize) break;
        cursor = snap.docs[snap.docs.length - 1];
      }

      if (rows.length >= safetyLimit) {
        console.warn(`recalc_queue pending 超過安全載入上限 ${safetyLimit} 筆`);
      }
      return rows;
    } catch (error) {
      // 舊環境若查詢不支援，退回前 500 筆，避免維護工具完全失效。
      console.warn("pending recalc_queue paged query failed, fallback to collection scan", error);
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
      const health = buildRecalcQueueHealth(rows);
      setRecalcQueueGroups(groups);
      setRecalcQueueTotal(rows.length);
      setRecalcQueueHealth(health);
      addLog(`✅ 已載入 ${rows.length.toLocaleString()} 筆待重算紀錄：歷史 ${health.historical.toLocaleString()}、本月 ${health.live.toLocaleString()}、未來 ${health.future.toLocaleString()}、格式異常 ${health.invalid.toLocaleString()}。`);
      showToast(groups.length ? `已載入 ${groups.length} 個待重算月份` : "目前沒有待重新校準月份", groups.length ? "success" : "info");
      return { rows, groups, total: rows.length, health };
    } catch (error) {
      console.error(error);
      addLog(`❌ 載入等待清單月份失敗: ${error.message}`);
      showToast("載入等待清單月份失敗", "error");
      return { rows: [], groups: [], total: 0, health: null, error };
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCleanupRecalcQueueNoise = async () => {
    if (!window.confirm("確定整理無效待辦嗎？\n\n本月、未來月份與格式異常的 pending 將移出待重算清單；歷史月份仍會保留等待自動修復。")) return;

    setLoadingAction("cleanupRecalcQueue");
    setLogs([]);
    addLog(`🧹 開始整理 ${brandLabel} recalc_queue...`);
    try {
      const rows = await loadPendingRecalcQueueRows();
      const currentMonth = todayMonth();
      const targets = rows.filter((row) => {
        const month = getQueueYearMonth(row);
        return month === "未知月份" || month >= currentMonth;
      });

      let batch = writeBatch(db);
      let pendingWrites = 0;
      let cleaned = 0;
      const affectedFlagMonths = new Set();
      const nowText = new Date().toISOString();

      for (const row of targets) {
        const month = getQueueYearMonth(row);
        const isInvalid = month === "未知月份";
        const isLive = month === currentMonth;
        batch.update(doc(getCollectionPath("recalc_queue"), row.id), {
          status: isInvalid ? "invalid" : (isLive ? "ignored_live_month" : "ignored_future_month"),
          cleanupReason: isInvalid ? "invalid_year_month" : (isLive ? "live_month_uses_detail" : "future_month_not_supported"),
          cleanedAt: serverTimestamp(),
          cleanedAtText: nowText,
          cleanedBy: currentUser?.name || "director",
          cleanedByRole: userRole || "director",
        });
        if (!isInvalid) affectedFlagMonths.add(month);
        pendingWrites += 1;
        cleaned += 1;
        if (pendingWrites >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          pendingWrites = 0;
        }
      }
      if (pendingWrites > 0) await batch.commit();

      if (affectedFlagMonths.size > 0) {
        const flagBatch = writeBatch(db);
        affectedFlagMonths.forEach((month) => {
          flagBatch.set(doc(getCollectionPath("summary_recalc_flags"), month), {
            brandId,
            brandLabel,
            yearMonth: month,
            affectedYearMonth: month,
            status: month === currentMonth ? "ignored_live_month" : "ignored_future_month",
            dirty: false,
            pendingCount: 0,
            cleanupReason: month === currentMonth ? "live_month_uses_detail" : "future_month_not_supported",
            cleanedAt: serverTimestamp(),
            cleanedAtText: nowText,
            cleanedBy: currentUser?.name || "director",
            updatedAt: serverTimestamp(),
            updatedAtText: nowText,
          }, { merge: true });
        });
        await flagBatch.commit();
      }

      await setDoc(doc(getCollectionPath("summary_worker_state"), "recalc_queue_fallback_scan"), {
        cursorDocId: "",
        nextRunAfterMs: 0,
        scanMode: "steady_after_manual_cleanup",
        consecutiveNoProgressPages: 0,
        lastManualCleanupCount: cleaned,
        lastManualCleanupAt: serverTimestamp(),
        lastManualCleanupAtText: nowText,
      }, { merge: true });

      await addMaintenanceLog({
        type: "recalc_queue",
        action: "cleanup_non_historical_queue",
        status: "success",
        cleanedCount: cleaned,
        currentMonth,
      });
      addLog(`✅ 整理完成：已移出 ${cleaned.toLocaleString()} 筆本月／未來／格式異常待辦。`);
      showToast(cleaned ? `已整理 ${cleaned.toLocaleString()} 筆無效待辦` : "沒有需要整理的無效待辦", cleaned ? "success" : "info");
      await handleLoadRecalcQueue();
    } catch (error) {
      console.error(error);
      addLog(`❌ 整理 recalc_queue 失敗：${error.message}`);
      showToast("整理待重算清單失敗", "error");
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
    if (!month || month === "未知月份") return showToast("此月份格式異常，請先整理無效待辦", "error");
    if (month >= todayMonth()) return showToast("本月或未來月份不應校準 Summary，請使用「整理無效待辦」", "info");
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

  useEffect(() => {
    if (isSelectedCurrentMonth(calMonth)) {
      setSummaryStatusReport(null);
      return;
    }
    loadDashboardSummaryStatus(calMonth, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBrand?.id, calMonth]);

  // 顯示中的「目前排程狀態」必須以已儲存的 readTrackerConfig 為唯一 authority。
  // scheduleForm 只是尚未儲存的編輯草稿，不能拿來宣告目前是否正在排程時段。
  const scheduleStatus = useMemo(
    () => getReadTrackerScheduleStatus({ ...readTrackerConfig, scheduleMode: "global" }),
    [readTrackerConfig]
  );
  const hasUnsavedScheduleChanges = useMemo(() => (
    Boolean(scheduleForm.scheduleEnabled) !== Boolean(readTrackerConfig.scheduleEnabled) ||
    String(scheduleForm.startTime || "19:00") !== String(readTrackerConfig.startTime || "19:00") ||
    String(scheduleForm.endTime || "07:00") !== String(readTrackerConfig.endTime || "07:00")
  ), [scheduleForm, readTrackerConfig]);

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
      title: "檢查本月資料",
      subtitle: "今天或本月營運中，先確認資料有沒有問題",
      goal: "檢查缺報、重複、異常與待整理資料，整理成需要注意的重點。",
      when: "每天巡檢、主管覺得數字怪怪的，或剛完成大量補報後。",
      doesNot: "只做檢查，不會修改原始日報，也不會自動整理歷史月份。",
      result: "會看到「正常／需注意／需處理」，以及建議下一步。",
      tone: "amber",
    },
    {
      id: "closing",
      icon: Calendar,
      title: "整理月份報表",
      subtitle: "月底、月初或歷史月份資料確認完成後使用",
      goal: "先確認缺報與異常，再整理該月份的營運總覽、管理師與排名報表。",
      when: "月底、月初關帳前，或歷史月份補報／修正已完成後。",
      doesNot: "不會改寫原始日報；真正整理前會再次確認。",
      result: "會看到整理結果，以及整理後的數字是否一致。",
      tone: "amber",
    },
    {
      id: "issue",
      icon: AlertTriangle,
      title: "處理異常資料",
      subtitle: "看到數字怪、重複資料或歷史資料需要修正時",
      goal: "先找出真正異常來源，再決定是否需要重新整理、封存或還原。",
      when: "日報不見、數字不一致、資料重複，或有人修正歷史業績後。",
      doesNot: "不會在還沒確認原因前直接改資料；高風險操作仍需二次確認。",
      result: "會看到異常類型、影響範圍與建議處理順序。",
      tone: "rose",
    },
    {
      id: "backup",
      icon: Shield,
      title: "備份或救回資料",
      subtitle: "改設定前想先留底，或誤改後需要救援時",
      goal: "查看備份與組織架構快照，必要時從確認過的時間點還原。",
      when: "改區長架構前後、誤刪或誤改設定，或需要資料救援時。",
      doesNot: "載入備份只會查看；真正還原前會再次確認，不會自動覆蓋。",
      result: "會看到可用的備份／快照，以及可以確認的還原時間點。",
      tone: "emerald",
    },
    {
      id: "traffic",
      icon: Radio,
      title: "系統流量觀察",
      subtitle: "只有需要追查讀取量時才使用",
      goal: "找出哪些功能或資料來源造成 Firestore reads 上升。",
      when: "晚間全域上報後、費用異常，或改版後需要觀察節流效果時。",
      doesNot: "不會修改營運資料；只有全域上報模式會產生少量追蹤寫入。",
      result: "會看到讀取來源排行、尖峰時段與可優化方向。",
      tone: "blue",
    },
  ]), []);

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
      message: "系統正在執行你選擇的工作，完成後會直接顯示結果與建議下一步。",
      createdAt: nowText,
      items: [],
      metrics: [],
      nextActions: ["檢查完成後，這裡會直接顯示「正常／需注意／需處理」。"],
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
          { label: "本月異常待辦", value: currentMonthPending, tone: currentMonthPending ? "warning" : "success" },
          { label: "掃描資料", value: Number(health?.scanned || 0).toLocaleString(), tone: "neutral" },
        ];

        if (counts.danger > 0) status = "danger";
        else if (counts.warning > 0 || pendingTotal > 0) status = "warning";
        else status = "success";

        headline = status === "success" ? "本月資料檢查完成｜正常" : status === "danger" ? "本月資料檢查完成｜需處理" : "本月資料檢查完成｜需注意";
        message = status === "success"
          ? "目前沒有重大異常，也沒有需要立即處理的待辦。"
          : counts.danger > 0
          ? "偵測到高風險異常，建議先展開健康檢查明細，確認是哪一天、哪間店或哪位管理師。"
          : "目前屬於可觀察狀態；若出現本月待整理異動，代表舊版待辦尚未整理，請先依畫面建議處理。";
        items = [
          makeItem("資料健康檢查", `高風險 ${counts.danger}｜需注意 ${counts.warning}｜提醒 ${counts.info}`),
          makeItem("待整理異動", isSelectedCurrentMonth() ? `本月異常待辦 ${currentMonthPending} 筆` : `歷史待校準 ${pendingTotal} 筆`),
          makeItem("營運總覽狀態", "已確認歷史報表是否建立，以及整理後是否又有新異動"),
        ];
        nextActions = status === "danger"
          ? ["先展開健康檢查明細，處理紅色高風險項目。", "處理完成後，再重新執行日常檢查。"]
          : [currentMonthPending > 0 ? "先依畫面建議整理本月待辦；本月資料仍以即時明細為準。" : "目前沒有本月待整理異常。", "若只是排除店家或負數退款提醒，確認合理即可。"];
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
          : "可先確認提醒項目是否合理；若出現本月待整理異動，請先依畫面建議處理。";

        metrics = [
          { label: "月結狀態", value: readiness, tone: status },
          { label: "缺少店日報", value: closing?.missingStoreReports?.length || 0, tone: (closing?.missingStoreReports?.length || 0) ? "danger" : "success" },
          { label: "高風險異常", value: counts.danger, tone: counts.danger ? "danger" : "success" },
          { label: "待校準", value: pendingTotal, tone: pendingTotal ? "warning" : "success" },
        ];
        items = [
          makeItem("月結前檢查", `結果：${readiness}`),
          makeItem("資料健康檢查", `高風險 ${counts.danger}｜需注意 ${counts.warning}`),
          makeItem("待整理異動", `共 ${pendingTotal} 筆待整理資料`),
          makeItem("歷史報表狀態", "已確認月份報表是否已整理完成"),
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

  const renderMaintenanceScenarioGuide = () => {
    const isCurrent = isSelectedCurrentMonth();
    const report = guidedFlowReport?.scenarioId === activeMaintenanceScenario ? guidedFlowReport : null;
    const selectedSummaryStatus = summaryStatusReport?.month === calMonth ? summaryStatusReport : null;

    const getStatusKey = (status) => status === "success"
      ? "success"
      : status === "danger"
      ? "danger"
      : status === "warning"
      ? "warning"
      : status === "running"
      ? "running"
      : "idle";

    const tonePalette = {
      success: {
        card: "border-[#D7ECDF] bg-[#F7FCF8]",
        icon: "border-[#D7ECDF] bg-[#EEF8F2] text-[#4F8A68]",
        pill: "border-[#D7ECDF] bg-[#EEF8F2] text-[#4F8A68]",
      },
      warning: {
        card: "border-[#F2DEB5] bg-[#FFFBF1]",
        icon: "border-[#F2DEB5] bg-[#FFF6E4] text-[#A77732]",
        pill: "border-[#F2DEB5] bg-[#FFF6E4] text-[#A77732]",
      },
      danger: {
        card: "border-[#F3D4DA] bg-[#FFF7F8]",
        icon: "border-[#F3D4DA] bg-[#FFF0F2] text-[#B66A79]",
        pill: "border-[#F3D4DA] bg-[#FFF0F2] text-[#B66A79]",
      },
      running: {
        card: "border-blue-100 bg-blue-50/40",
        icon: "border-blue-100 bg-white text-blue-600",
        pill: "border-blue-100 bg-blue-50 text-blue-600",
      },
      idle: {
        card: "border-[#E8DDD0] bg-[#FBF7F1]",
        icon: "border-[#E7D8C7] bg-[#F7F0E7] text-[#8B7056]",
        pill: "border-[#E7D8C7] bg-[#F7F0E7] text-[#8B7056]",
      },
    };

    const metricToneClass = (tone) => {
      if (tone === "success") return "border-[#D7ECDF] bg-[#F3FAF5] text-[#4F8A68]";
      if (tone === "warning") return "border-[#F2DEB5] bg-[#FFF8EA] text-[#A77732]";
      if (tone === "danger") return "border-[#F3D4DA] bg-[#FFF7F8] text-[#B66A79]";
      return "border-[#E8DDD0] bg-[#FBF7F1] text-[#7D6753]";
    };

    const normalizeMetricLabel = (label = "") => String(label)
      .replace("待月底校準", "待月結整理")
      .replace("待校準", "待月結整理")
      .replace("掃描資料", "已檢查資料")
      .replace("月結狀態", "整理狀態")
      .replace("Summary", "歷史報表")
      .replace("pending", "待整理異動");

    const selectedMonthLabel = (() => {
      const [year, month] = String(calMonth || todayMonth()).split("-");
      return year && month ? `${year} 年 ${String(Number(month)).padStart(2, "0")} 月` : calMonth;
    })();

    const shiftMonth = (amount) => {
      const [year, month] = String(calMonth || todayMonth()).split("-").map(Number);
      if (!year || !month) return;
      const next = new Date(year, month - 1 + amount, 1);
      setCalMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
      setGuidedFlowReport(null);
    };

    const handleMonthChange = (value) => {
      if (!value) return;
      setCalMonth(value);
      setGuidedFlowReport(null);
    };

    const formatSummaryTime = (value) => {
      if (!value || value === "-") return "尚無紀錄";
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString("zh-TW", { hour12: false });
      return String(value);
    };

    const monthStatusLabel = (() => {
      if (isCurrent) return "本月即時資料";
      if (!selectedSummaryStatus) return "狀態檢查中";
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

    const recommendedScenarioId = isCurrent || monthStatusLabel === "已整理" ? "daily" : "closing";
    const recommendationText = isCurrent
      ? "目前是本月營運中，建議先「檢查本月資料」。只檢查，不會整理歷史報表。"
      : monthStatusLabel === "已整理"
      ? `${selectedMonthLabel} 已整理完成；如果只是查看資料，不需要重複整理。`
      : monthStatusLabel === "需要整理"
      ? `${selectedMonthLabel} 有 ${Number(selectedSummaryStatus?.pendingCount || 0).toLocaleString()} 筆待整理異動，建議使用「整理月份報表」。`
      : monthStatusLabel === "尚未整理"
      ? `${selectedMonthLabel} 尚未整理；資料確認完成後，可以使用「整理月份報表」。`
      : monthStatusLabel === "需處理"
      ? `${selectedMonthLabel} 的整理結果需要確認，建議先使用「整理月份報表」重新整理並確認數字。`
      : `先確認 ${selectedMonthLabel} 的資料狀態，再決定是否需要整理月份報表。`;

    const primaryCards = scenarioCards.filter((card) => card.id !== "traffic");
    const activeCard = primaryCards.find((card) => card.id === activeMaintenanceScenario) || primaryCards[0];
    const ActiveIcon = activeCard.icon;
    const activeTone = tonePalette[report ? getStatusKey(report.status) : "idle"];

    const selectScenario = (scenarioId) => {
      setActiveMaintenanceScenario(scenarioId);
      setGuidedFlowReport(null);
    };

    const actionLabel = activeCard.id === "daily"
      ? "開始檢查本月資料"
      : activeCard.id === "closing"
      ? (isCurrent ? "先檢查月結準備" : `整理 ${calMonth} 報表`)
      : activeCard.id === "issue"
      ? "開始檢查異常資料"
      : "載入備份與快照";

    const runActiveTask = () => {
      if (activeCard.id === "closing" && !isCurrent) {
        handleMonthEndDashboardSummaryCalibration();
        return;
      }
      handleRunGuidedFlow(activeCard.id);
    };

    const findings = Array.isArray(report?.metrics)
      ? report.metrics.slice(0, 3).map((item) => ({ ...item, label: normalizeMetricLabel(item.label) }))
      : [];

    const nextActions = Array.isArray(report?.nextActions)
      ? report.nextActions
          .slice(0, 3)
          .map((item) => String(item).replace(/Summary/g, "歷史報表").replace(/pending/g, "待整理異動"))
      : [];

    const resultMeta = getFlowStatusMeta(report?.status || "idle");
    const ResultIcon = resultMeta.icon;

    return (
      <section className="space-y-3">
        <div className="rounded-[1.5rem] border border-[#E8DDD0] bg-gradient-to-br from-[#FFFCF7] via-white to-[#FFF8EC] p-4 shadow-[0_12px_30px_rgba(154,118,84,0.06)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-3 py-1 rounded-full border border-[#E7D8C7] bg-[#F7F0E7] text-[#8B7056] text-xs font-black">系統維護</span>
                <span className={`px-3 py-1 rounded-full border text-xs font-black ${monthStatusToneClass}`}>{monthStatusLabel}</span>
              </div>
              <h2 className="mt-2 text-xl md:text-2xl font-black text-[#4F3F33]">先選月份，再選你現在要做的事</h2>
              <p className="mt-1 text-sm font-bold text-[#7D6753] leading-6">{recommendationText}</p>
            </div>

            <div className="flex items-center gap-2 rounded-2xl border border-[#E8DDD0] bg-white/80 p-1.5 shadow-sm shrink-0">
              <button type="button" onClick={() => shiftMonth(-1)} className="h-9 px-3 rounded-xl bg-[#F7F0E7] text-[#8B7056] text-xs font-black hover:bg-[#EFE3D5]">上一月</button>
              <label className="flex items-center gap-2 px-2 text-xs font-black text-[#7D6753]">
                <Calendar size={14} className="text-[#B7863D]" />
                <SmartMonthPicker value={calMonth} onChange={handleMonthChange} align="right" buttonClassName="!h-9 !min-w-[150px] !border-0 !bg-transparent !px-0 !py-0 !text-xs !shadow-none hover:!bg-transparent" />
              </label>
              <button type="button" onClick={() => shiftMonth(1)} className="h-9 px-3 rounded-xl bg-[#F7F0E7] text-[#8B7056] text-xs font-black hover:bg-[#EFE3D5]">下一月</button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-black">
            <span className="rounded-full border border-stone-100 bg-white/80 px-3 py-1 text-stone-500">目前查看：{selectedMonthLabel}</span>
            {!isCurrent && selectedSummaryStatus?.updatedAtText && (
              <span className="rounded-full border border-stone-100 bg-white/80 px-3 py-1 text-stone-500">上次整理：{formatSummaryTime(selectedSummaryStatus.updatedAtText || selectedSummaryStatus.lastUpdatedAtText)}</span>
            )}
          </div>
        </div>

        <div className="rounded-[1.65rem] border border-[#E8DDD0] bg-white/90 p-4 shadow-[0_14px_36px_rgba(154,118,84,0.07)]">
          <div>
            <h2 className="text-lg md:text-xl font-black text-[#4F3F33]">你現在要做哪一件事？</h2>
            <p className="mt-1 text-xs md:text-sm font-bold text-[#9A8978]">不用先懂系統工具，選最接近你現在情況的一項。</p>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {primaryCards.map((card) => {
              const Icon = card.icon;
              const selected = card.id === activeCard.id;
              const recommended = card.id === recommendedScenarioId;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => selectScenario(card.id)}
                  className={`text-left rounded-[1.35rem] border p-3.5 transition-all min-h-[150px] ${
                    selected
                      ? "border-[#D8B883] bg-[#FFFDF9] ring-2 ring-[#F5E7D0] shadow-[0_12px_28px_rgba(154,118,84,0.07)]"
                      : "border-[#E8DDD0] bg-white hover:border-[#D8B883] hover:bg-[#FFFDF9]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="w-9 h-9 rounded-xl border border-[#F0DDBB] bg-[#FFF6E4] text-[#B7863D] flex items-center justify-center">
                      <Icon size={17} strokeWidth={1.8} />
                    </div>
                    {recommended && <span className="rounded-full border border-[#D7ECDF] bg-[#EEF8F2] px-2 py-0.5 text-[10px] font-black text-[#4F8A68]">建議先做</span>}
                  </div>
                  <h3 className="mt-3 text-sm font-black text-[#4F3F33]">{card.title}</h3>
                  <p className="mt-1 text-[11px] font-bold leading-5 text-[#7D6753]">{card.subtitle}</p>
                  <p className="mt-2 text-[10px] font-black text-[#A77732]">{selected ? "目前選擇" : "選擇這項"} →</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className={`rounded-[1.65rem] border p-4 md:p-5 shadow-[0_14px_36px_rgba(154,118,84,0.07)] ${activeTone.card}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <div className={`w-11 h-11 rounded-[1.1rem] border flex items-center justify-center shrink-0 ${activeTone.icon}`}>
                <ActiveIcon size={20} strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <span className="inline-flex rounded-full border border-[#E7D8C7] bg-white/80 px-3 py-1 text-[11px] font-black text-[#8B7056]">目前選擇</span>
                <h2 className="mt-2 text-xl font-black text-[#4F3F33]">你選的是：{activeCard.title}</h2>
                <p className="mt-1 text-sm font-bold text-[#7D6753]">{activeCard.subtitle}</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
              <BeautyButton
                onClick={runActiveTask}
                disabled={guidedFlowRunning || loadingAction !== null}
                variant="primary"
                className="min-w-[190px]"
              >
                {guidedFlowRunning || loadingAction === "monthEndSummaryCalibration" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {guidedFlowRunning ? "檢查中..." : loadingAction === "monthEndSummaryCalibration" ? "整理中..." : actionLabel}
              </BeautyButton>
              <BeautyButton onClick={() => setShowCoreTools(true)} variant="soft">
                <Settings size={15} /> 需要其他工具
              </BeautyButton>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div className="rounded-2xl border border-white/80 bg-white/75 p-3.5">
              <p className="text-[11px] font-black text-[#B7863D]">適合什麼時候</p>
              <p className="mt-1 text-xs font-bold leading-5 text-[#6F5A48]">{activeCard.when}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/75 p-3.5">
              <p className="text-[11px] font-black text-[#B7863D]">會幫你做什麼</p>
              <p className="mt-1 text-xs font-bold leading-5 text-[#6F5A48]">{activeCard.goal}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/75 p-3.5">
              <p className="text-[11px] font-black text-[#B7863D]">這一步不會做什麼</p>
              <p className="mt-1 text-xs font-bold leading-5 text-[#6F5A48]">{activeCard.doesNot}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/75 p-3.5">
              <p className="text-[11px] font-black text-[#B7863D]">完成後你會看到</p>
              <p className="mt-1 text-xs font-bold leading-5 text-[#6F5A48]">{activeCard.result}</p>
            </div>
          </div>
        </div>

        {(report || guidedFlowRunning) && (
          <div className={`rounded-[1.65rem] border p-4 md:p-5 shadow-[0_14px_36px_rgba(154,118,84,0.06)] ${tonePalette[getStatusKey(report?.status || "running")].card}`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${tonePalette[getStatusKey(report?.status || "running")].icon}`}>
                <ResultIcon size={18} className={report?.status === "running" ? "animate-spin" : ""} />
              </div>
              <div className="min-w-0">
                <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-black ${tonePalette[getStatusKey(report?.status || "running")].pill}`}>{resultMeta.label}</span>
                <h3 className="mt-2 text-lg font-black text-[#4F3F33]">{report?.headline || "正在檢查，請稍候"}</h3>
                <p className="mt-1 text-xs md:text-sm font-bold leading-5 text-[#7D6753]">{report?.message || "系統正在整理檢查結果。"}</p>
              </div>
            </div>

            {findings.length > 0 && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {findings.map((item) => (
                  <div key={item.label} className={`rounded-2xl border p-3 text-center ${metricToneClass(item.tone)}`}>
                    <p className="text-[10px] font-black tracking-widest opacity-75">{item.label}</p>
                    <p className="mt-0.5 text-lg font-black">{item.value}</p>
                  </div>
                ))}
              </div>
            )}

            {nextActions.length > 0 && (
              <div className="mt-4 rounded-2xl border border-white/80 bg-white/75 p-3.5">
                <p className="text-[11px] font-black text-[#B7863D]">建議下一步</p>
                <div className="mt-2 space-y-1.5">
                  {nextActions.map((item, index) => (
                    <div key={`${index}_${item}`} className="flex items-start gap-2 text-xs font-bold leading-5 text-[#6F5A48]">
                      <span className="w-5 h-5 rounded-full bg-[#FFF6E4] text-[#B7863D] flex items-center justify-center text-[10px] font-black shrink-0">{index + 1}</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowTrafficTools(true)}
          className="w-full rounded-[1.35rem] border border-blue-100 bg-blue-50/40 px-4 py-3 text-left shadow-[0_10px_24px_rgba(59,130,246,0.05)] transition-all hover:border-blue-200 hover:bg-blue-50/70"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl border border-blue-100 bg-white text-blue-600 flex items-center justify-center shrink-0">
                <Radio size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black text-[#4F3F33]">系統流量觀察</p>
                <p className="mt-0.5 text-[11px] font-bold text-[#7D6753]">只有費用異常、改版觀察或需要追查讀取來源時才開啟。</p>
              </div>
            </div>
            <span className="text-xs font-black text-blue-600 shrink-0">開啟流量觀察 →</span>
          </div>
        </button>
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

      setManualLocalReadTrackerEnabled(mode === "local");
      const effectiveMode = resolveReadTrackerModeFromConfig(nextConfig);

      setReadTrackerConfig(nextConfig);
      setReadTrackerMode(effectiveMode);
      setReadTrackerModeState(effectiveMode);
      const requestedModeLabel = mode === "off" ? "關閉" : mode === "local" ? "本機模式" : "全域上報";
      const effectiveModeLabel = effectiveMode === "off" ? "關閉" : effectiveMode === "local" ? "本機模式" : "全域上報";
      const scheduleOverrideActive = effectiveMode !== mode;

      showToast(
        scheduleOverrideActive
          ? `已儲存${requestedModeLabel}；目前排程時段優先維持${effectiveModeLabel}`
          : mode === "off"
            ? "讀取來源追蹤已切換為關閉；排程設定維持不變"
            : mode === "local"
              ? "已切換為本機模式；排程設定維持不變"
              : "已切換為全域上報模式；排程設定維持不變",
        mode === "off" && !scheduleOverrideActive ? "info" : "success"
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
    setManualLocalReadTrackerEnabled(true);
    const effectiveMode = resolveReadTrackerModeFromConfig(readTrackerConfig);
    setReadTrackerMode(effectiveMode);
    setReadTrackerModeState(effectiveMode);
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

  // Projection Observability v1：按需單文件讀取，不建立 listener / polling，
  // 不改 Projection Authority，也不在前端重算 Accuracy。
  const handleLoadProjectionObservability = async () => {
    const activeBrandId = String(currentBrand?.id || "").trim().toLowerCase() || "cyj";
    setLoadingAction("projectionObservability");
    setProjectionObservabilityState({
      brandId: activeBrandId,
      status: "loading",
      data: null,
      error: null,
      loadedAtText: "",
    });

    try {
      const modelRef = doc(getCollectionPath("projection_models"), "current");
      const modelSnap = await getDoc(modelRef);
      const model = modelSnap.exists() ? (modelSnap.data() || {}) : null;
      const data = buildProjectionObservabilitySnapshot({
        model,
        brandId: activeBrandId,
        currentYearMonth: getTaipeiProjectionYearMonth(),
      });

      setProjectionObservabilityState({
        brandId: activeBrandId,
        status: "ready",
        data,
        error: null,
        loadedAtText: new Date().toLocaleString("zh-TW", { hour12: false }),
      });

      showToast(
        data.status === "healthy"
          ? `${brandLabel} 推估模型狀態已更新`
          : `${brandLabel} 推估模型有狀態需要確認`,
        data.status === "error" ? "error" : (data.status === "warning" ? "info" : "success")
      );
    } catch (error) {
      console.error("讀取 Projection Model 狀態失敗：", error);
      setProjectionObservabilityState({
        brandId: activeBrandId,
        status: "error",
        data: null,
        error: error?.message || String(error),
        loadedAtText: new Date().toLocaleString("zh-TW", { hour12: false }),
      });
      showToast("讀取業績推估模型狀態失敗", "error");
    } finally {
      setLoadingAction(null);
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

  const loadMonthlyTargetAuthority = async (yearMonth) => {
    try {
      const summarySnap = await getDoc(doc(getCollectionPath("monthly_targets_summary"), yearMonth));
      if (summarySnap.exists()) {
        const summaryData = summarySnap.data() || {};
        const targetMap = {};
        const containers = [
          summaryData.targets,
          summaryData.storeTargets,
          summaryData.storeTargetMap,
          summaryData.monthlyTargets,
          summaryData.targetStores,
        ].filter(Boolean);

        containers.forEach((container) => {
          const entries = Array.isArray(container)
            ? container.map((value, index) => [String(index), value])
            : (container && typeof container === "object" ? Object.entries(container) : []);

          entries.forEach(([key, value]) => {
            if (!value || typeof value !== "object") return;
            const sourceId = value.sourceDocId || value.id || key;
            const storeCore = extractTargetStore(sourceId, value, yearMonth);
            if (!storeCore) return;
            targetMap[storeCore] = {
              id: sourceId,
              sourceDocId: sourceId,
              storeName: value.storeName || value.store || storeCore,
              cashTarget: Object.prototype.hasOwnProperty.call(value, "cashTarget") ? value.cashTarget : null,
              accrualTarget: Object.prototype.hasOwnProperty.call(value, "accrualTarget") ? value.accrualTarget : null,
              challengeCashTarget: Object.prototype.hasOwnProperty.call(value, "challengeCashTarget") ? value.challengeCashTarget : null,
              challengeAccrualTarget: Object.prototype.hasOwnProperty.call(value, "challengeAccrualTarget") ? value.challengeAccrualTarget : null,
            };
          });
        });

        const targetCoverage = extractTargetCoverageMetadata(summaryData);
        if (targetCoverage.available) {
          return {
            targets: targetMap,
            targetCoverage,
            source: "monthly_targets_summary",
            usedRawFallback: false,
          };
        }

        // 舊 Summary 缺 Batch 3 coverage metadata 屬 authority/schema 缺失，才允許 compatibility raw fallback。
        // 合法的 cash/accrual incomplete coverage 不會因 incomplete 而觸發 full scan。
        console.warn(`monthly_targets_summary 缺少 Target Coverage v1 metadata，退回 raw：${brandId}/${yearMonth}`);
      }
    } catch (error) {
      console.warn("monthly_targets_summary read failed; fallback raw only because Summary is unavailable", error);
    }

    // Compatibility safety：只有 target Summary 缺失/無法讀取才掃 raw。
    // Cash/Accrual coverage incomplete 是正式狀態，不應因 incomplete 而 full-scan monthly_targets。
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
        sourceDocId: docSnap.id,
        storeName: data.storeName || data.store || storeCore,
        cashTarget: Object.prototype.hasOwnProperty.call(data, "cashTarget") ? data.cashTarget : null,
        accrualTarget: Object.prototype.hasOwnProperty.call(data, "accrualTarget") ? data.accrualTarget : null,
        challengeCashTarget: Object.prototype.hasOwnProperty.call(data, "challengeCashTarget") ? data.challengeCashTarget : null,
        challengeAccrualTarget: Object.prototype.hasOwnProperty.call(data, "challengeAccrualTarget") ? data.challengeAccrualTarget : null,
      };
    });
    return {
      targets: targetMap,
      targetCoverage: extractTargetCoverageMetadata({}),
      source: "monthly_targets_full_fallback_missing_summary",
      usedRawFallback: true,
    };
  };

  const buildDashboardSummaryPayloads = async (yearMonth) => {
    const range = getReportMonthRange(yearMonth);
    if (!range) throw new Error("月份格式錯誤");

    const orgProfile = await getOrgStructureProfile();
    const [targetAuthority, lifecycleSnap] = await Promise.all([
      loadMonthlyTargetAuthority(yearMonth),
      getDoc(doc(getCollectionPath("store_lifecycle"), "master")),
    ]);
    const targets = targetAuthority.targets || {};
    const targetCoverage = targetAuthority.targetCoverage || extractTargetCoverageMetadata({});
    const lifecycleMaster = normalizeLifecycleMaster(lifecycleSnap.exists() ? (lifecycleSnap.data() || {}) : {}, brandId);
    const lifecycleReady = String(lifecycleMaster.datasetStatus || "") === "READY";
    const lifecycleEligibleEntries = getLifecycleEligibleStoreEntries(lifecycleMaster, yearMonth, { brandId, requireReady: true });
    const lifecycleEligibleStoreKeys = lifecycleEligibleEntries.map((entry) => String(entry.storeKey || entry.coreStoreName || "").trim()).filter(Boolean);
    const lifecycleEligibleStoreSet = new Set(lifecycleEligibleStoreKeys);
    const formalTargetAuthority = buildSummaryTargetAuthoritySnapshot({
      targetMap: targets,
      eligibleStoreKeys: lifecycleEligibleStoreKeys,
      lifecycleReady,
      targetCoverage,
    });
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

    // 與 Backend dashboard-summary-v2 保持 legacy 相容：Maintenance 手動重建不可刪掉每店每日曲線。
    const makeEmptyStoreDailyRows = () => Array.from({ length: range.daysInMonth }, (_, i) => ({
      day: i + 1,
      date: `${range.month}/${i + 1}`,
      fullDate: `${yearMonth}-${String(i + 1).padStart(2, "0")}`,
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
    }));
    const storeDailyTotals = {};
    const ensureStoreDailyRows = (storeCore) => {
      if (!storeDailyTotals[storeCore]) storeDailyTotals[storeCore] = makeEmptyStoreDailyRows();
      return storeDailyTotals[storeCore];
    };

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
      if (day && day >= 1 && day <= range.daysInMonth) {
        const storeDailyRow = ensureStoreDailyRows(storeCore)[day - 1];
        storeDailyRow.cash += cash;
        storeDailyRow.accrual += accrual;
        storeDailyRow.operationalAccrual += operationalAccrual;
        storeDailyRow.skincareSales += skincareSales;
        storeDailyRow.traffic += traffic;
        storeDailyRow.newCustomers += newCustomers;
        storeDailyRow.newCustomerClosings += newCustomerClosings;
        storeDailyRow.newCustomerSales += newCustomerSales;
        storeDailyRow.refund += refund;
        storeDailyRow.skincareRefund += skincareRefund;
      }
    });

    // Batch 4 additive semantic pass：legacy 欄位維持原計算，explicit formal fields 直接由 Raw rows + canonical contract 產生。
    // 不把 missing/invalid 欄位默認為 0；true zero / negative formal net cash 保留。
    const semanticRowsByStore = {};
    dailyRows.forEach((row) => {
      const storeCore = normalizeCoreName(getStoreName(row));
      if (!storeCore) return;
      if (!semanticRowsByStore[storeCore]) semanticRowsByStore[storeCore] = [];
      semanticRowsByStore[storeCore].push(row);
    });

    const formalScopeDailyRows = lifecycleReady
      ? dailyRows.filter((row) => lifecycleEligibleStoreSet.has(normalizeCoreName(getStoreName(row))))
      : [];
    Object.assign(grand, aggregateFormalMetrics(brandId, formalScopeDailyRows));

    // Batch 4 不擴張 storeDailyTotals 的每店×每日 semantic schema，避免 dashboard_summary 單文件膨脹。
    // Maintenance 仍完整保留 Backend dashboard-summary-v2 的 legacy storeDailyTotals compatibility shape。

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
      ensureStoreDailyRows(storeCore);
      grand.budget += store.budget;
      grand.accrualBudget += store.accrualBudget;
      grand.challengeBudget += store.challengeBudget;
      grand.challengeAccrualBudget += store.challengeAccrualBudget;
    });

    // 先 ensure 完整 Store cohort，再套 formal metrics；target-only / org-only store 也會得到明確 FIELD_MISSING 狀態。
    Object.values(storeMap).forEach((store) => {
      Object.assign(store, aggregateFormalMetrics(brandId, semanticRowsByStore[store.store] || []));
      store.formalLifecycleEligible = lifecycleEligibleStoreSet.has(store.store);
    });

    grand.totalAchievement = grand.budget > 0 ? (grand.cash / grand.budget) * 100 : 0;
    grand.totalAccrualAchievement = grand.accrualBudget > 0 ? (grand.accrual / grand.accrualBudget) * 100 : 0;
    grand.challengeAchievement = grand.challengeBudget > 0 ? (grand.cash / grand.challengeBudget) * 100 : 0;
    grand.challengeAccrualAchievement = grand.challengeAccrualBudget > 0 ? (grand.accrual / grand.challengeAccrualBudget) * 100 : 0;

    const formalCashAchievement = buildScopeFormalAchievement({
      actualValue: grand.formalNetCash,
      actualStatus: grand.formalNetCashStatus,
      targetValue: formalTargetAuthority.cashTargetTotal,
      coverageComplete: formalTargetAuthority.cashCoverageTrusted,
    });
    const formalAccrualAchievement = buildScopeFormalAchievement({
      actualValue: grand.formalAccrual,
      actualStatus: grand.formalAccrualStatus,
      targetValue: formalTargetAuthority.accrualTargetTotal,
      coverageComplete: formalTargetAuthority.accrualCoverageTrusted,
    });
    grand.formalCashTarget = formalTargetAuthority.cashTargetTotal;
    grand.formalAccrualTarget = formalTargetAuthority.accrualTargetTotal;
    grand.formalCashAchievement = formalCashAchievement.value;
    grand.formalCashAchievementStatus = formalCashAchievement.status;
    grand.formalAccrualAchievement = formalAccrualAchievement.value;
    grand.formalAccrualAchievementStatus = formalAccrualAchievement.status;

    // Legacy rank 保留給 Batch 5 前 consumer；正式 rank additive 寫入 formalStoreRankings。
    const storeRanking = Object.values(storeMap).sort((a, b) => b.cash - a.cash).map((store, index) => ({ ...store, rank: index + 1 }));
    storeRanking.forEach((store) => { storeMap[store.store].rank = store.rank; });

    const formalStoreRanking = buildFormalStoreRanking(storeMap, targets, { eligibleStoreKeys: lifecycleEligibleStoreKeys });
    Object.entries(formalStoreRanking.byStore || {}).forEach(([storeCore, metadata]) => {
      if (storeMap[storeCore]) Object.assign(storeMap[storeCore], metadata);
    });

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

    const therapistRankings = applyTherapistRankingSemantics(Object.values(therapistMap));
    const therapistGrand = buildTherapistAggregateMetrics(therapistRankings);

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
      semanticVersion: SUMMARY_SEMANTIC_VERSION,
      kpiContractVersion: grand.kpiContractVersion || targetCoverage.kpiContractVersion || "",
      targetAuthoritySource: targetAuthority.source || "",
      targetCoverage,
      formalTargetAuthority,
      lifecycleSnapshot: {
        schemaVersion: String(lifecycleMaster.schemaVersion || ""),
        datasetStatus: String(lifecycleMaster.datasetStatus || "BUILDING"),
        revision: Number(lifecycleMaster.revision || 0),
        eligibleStoreCount: lifecycleEligibleStoreKeys.length,
        eligibleStoreKeys: lifecycleEligibleStoreKeys,
      },
      formalStoreRankings: formalStoreRanking.rankings,
      formalRankEligibleStoreCount: formalStoreRanking.rankEligibleStoreCount,
      monthStart: range.start,
      monthEnd: range.end,
      grandTotal: grand,
      stores: storeMap,
      storeRankings: storeRanking,
      managers: managerMap,
      dailyTotals,
      storeDailyTotals,
      storeTop3: {
        today: storeRevenueByDate(todayStr),
        yesterday: storeRevenueByDate(yesterdayStr),
        monthly: storeRanking.slice(0, 3).map((s) => ({ name: s.displayName, store: s.store, revenue: s.cash, manager: s.manager })),
      },
      sourceCounts: { dailyReports: dailyRows.length, targetStores: Object.keys(targets).length, stores: Object.keys(storeMap).length },
      lastUpdatedAt: serverTimestamp(),
      lastUpdatedAtText: new Date().toISOString(),
      source: "maintenance_summary_rebuild",
      version: "dashboard-summary-v2",
    };

    const therapistSummary = {
      brandId,
      brandLabel,
      yearMonth,
      monthStart: range.start,
      monthEnd: range.end,
      therapistKpiSemanticVersion: THERAPIST_KPI_SEMANTIC_VERSION,
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
      semanticVersion: SUMMARY_SEMANTIC_VERSION,
      kpiContractVersion: grand.kpiContractVersion || targetCoverage.kpiContractVersion || "",
      targetCoverage,
      formalTargetAuthority,
      lifecycleSnapshot: dashboardSummary.lifecycleSnapshot,
      storeTop3: dashboardSummary.storeTop3,
      storeRankings: storeRanking.map((s) => ({ store: s.store, displayName: s.displayName, manager: s.manager, cash: s.cash, budget: s.budget, achievement: s.achievement, rank: s.rank })),
      formalRankEligibleStoreCount: formalStoreRanking.rankEligibleStoreCount,
      formalStoreRankings: formalStoreRanking.rankings.map((s) => ({
        store: s.store,
        displayName: s.displayName,
        manager: s.manager,
        formalNetCash: s.formalNetCash,
        formalCashTarget: s.formalCashTarget,
        formalCashAchievement: s.formalCashAchievement,
        formalCashAchievementStatus: s.formalCashAchievementStatus,
        formalCashAchievementRank: s.formalCashAchievementRank,
        formalRankEligible: s.formalRankEligible,
      })),
      therapistKpiSemanticVersion: THERAPIST_KPI_SEMANTIC_VERSION,
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
      current_dirty: { label: "本月待辦異常", tone: "rose", hint: "本月 Dashboard 使用即時明細，不應存在 pending Queue；請執行「整理無效待辦」。" },
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
        getDocs(query(getCollectionPath("recalc_queue"), where("affectedYearMonth", "==", targetMonth), limit(2000))),
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
        .filter((row) => getQueueYearMonth(row) === targetMonth && String(row.status || "") === "pending");

      const recalcFlag = recalcFlagSnap.exists() ? { id: recalcFlagSnap.id, ...recalcFlagSnap.data() } : null;
      const recalcFlagStatus = String(recalcFlag?.status || "");
      const flagDirty = Boolean(recalcFlag) && !["completed", "verified", "idle", "ignored_live_month", "ignored_future_month", "invalid"].includes(recalcFlagStatus);
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
    const groups = summarizeRecalcQueueRows(rows).filter((group) => group.month && group.month !== "未知月份" && group.month < todayMonth());
    if (groups.length === 0) return showToast("目前沒有需要校準的歷史月份；本月或異常待辦請先整理", "info");
    const historicalQueueCount = groups.reduce((sum, group) => sum + Number(group.count || 0), 0);
    if (!window.confirm(`確定要依序校準 ${groups.length} 個歷史月份嗎？\n\n共 ${historicalQueueCount.toLocaleString()} 筆歷史 pending 會在校準成功後標記完成。`)) return;

    setLoadingAction("calibrateAllQueues");
    setLogs([]);
    addLog(`🔄 啟動批次校準：${brandId}｜${groups.length} 個歷史月份｜${historicalQueueCount.toLocaleString()} 筆 pending`);
    let completedMonths = 0;
    let completedRows = 0;
    try {
      await addMaintenanceLog({ type: "recalc_queue", action: "start_calibrate_all_pending_months", status: "started", monthCount: groups.length, queueCount: historicalQueueCount });
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

      // Trust fix：寫入後重新讀取 persisted Summary，再與本次 Raw rebuild payload 比對。
      // 禁止剛 build 的 object 自己跟自己比造成 false verified。
      const [storedDashboardSnap, storedTherapistSnap, storedRankingsSnap] = await Promise.all([
        getDoc(doc(getCollectionPath("dashboard_summary"), calMonth)),
        getDoc(doc(getCollectionPath("therapist_summary"), calMonth)),
        getDoc(doc(getCollectionPath("rankings_summary"), calMonth)),
      ]);
      if (!storedDashboardSnap.exists() || !storedTherapistSnap.exists() || !storedRankingsSnap.exists()) {
        throw new Error("Summary 寫入後讀回失敗，無法完成 Raw ↔ persisted Summary 驗證");
      }
      const rows = makeSummaryCompareRows({
        storedDashboard: storedDashboardSnap.data() || {},
        storedTherapist: storedTherapistSnap.data() || {},
        storedRankings: storedRankingsSnap.data() || {},
        freshDashboard: dashboardSummary,
        freshTherapist: therapistSummary,
        freshRankings: rankingsSummary,
      });
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
  const getMetricValue = (obj, path, fallback = 0) => path.split(".").reduce(
    (acc, key) => (acc !== null && acc !== undefined && acc[key] !== undefined ? acc[key] : fallback),
    obj || {}
  );

  const makeSummaryCompareRows = ({ storedDashboard, storedTherapist, storedRankings, freshDashboard, freshTherapist, freshRankings }) => {
    const rows = [
      { label: "現金業績（legacy）", stored: getMetricValue(storedDashboard, "grandTotal.cash"), fresh: getMetricValue(freshDashboard, "grandTotal.cash"), type: "money" },
      { label: "權責業績（legacy）", stored: getMetricValue(storedDashboard, "grandTotal.accrual"), fresh: getMetricValue(freshDashboard, "grandTotal.accrual"), type: "money" },
      { label: "Gross Cash", stored: getMetricValue(storedDashboard, "grandTotal.grossCash", null), fresh: getMetricValue(freshDashboard, "grandTotal.grossCash", null), type: "money", exactNull: true },
      { label: "General Refund", stored: getMetricValue(storedDashboard, "grandTotal.refund", null), fresh: getMetricValue(freshDashboard, "grandTotal.refund", null), type: "money", exactNull: true },
      { label: "Skincare Refund", stored: getMetricValue(storedDashboard, "grandTotal.skincareRefund", null), fresh: getMetricValue(freshDashboard, "grandTotal.skincareRefund", null), type: "money", exactNull: true },
      { label: "Formal 淨現金", stored: getMetricValue(storedDashboard, "grandTotal.formalNetCash", null), fresh: getMetricValue(freshDashboard, "grandTotal.formalNetCash", null), type: "money", exactNull: true },
      { label: "總權責", stored: getMetricValue(storedDashboard, "grandTotal.totalAccrual", null), fresh: getMetricValue(freshDashboard, "grandTotal.totalAccrual", null), type: "money", exactNull: true },
      { label: "Formal 權責", stored: getMetricValue(storedDashboard, "grandTotal.formalAccrual", null), fresh: getMetricValue(freshDashboard, "grandTotal.formalAccrual", null), type: "money", exactNull: true },
      { label: "Gross Cash 狀態", stored: getMetricValue(storedDashboard, "grandTotal.grossCashStatus", ""), fresh: getMetricValue(freshDashboard, "grandTotal.grossCashStatus", ""), type: "text", exact: true },
      { label: "General Refund 狀態", stored: getMetricValue(storedDashboard, "grandTotal.refundStatus", ""), fresh: getMetricValue(freshDashboard, "grandTotal.refundStatus", ""), type: "text", exact: true },
      { label: "Skincare Refund 狀態", stored: getMetricValue(storedDashboard, "grandTotal.skincareRefundStatus", ""), fresh: getMetricValue(freshDashboard, "grandTotal.skincareRefundStatus", ""), type: "text", exact: true },
      { label: "Formal 淨現金狀態", stored: getMetricValue(storedDashboard, "grandTotal.formalNetCashStatus", ""), fresh: getMetricValue(freshDashboard, "grandTotal.formalNetCashStatus", ""), type: "text", exact: true },
      { label: "總權責狀態", stored: getMetricValue(storedDashboard, "grandTotal.totalAccrualStatus", ""), fresh: getMetricValue(freshDashboard, "grandTotal.totalAccrualStatus", ""), type: "text", exact: true },
      { label: "Formal 權責狀態", stored: getMetricValue(storedDashboard, "grandTotal.formalAccrualStatus", ""), fresh: getMetricValue(freshDashboard, "grandTotal.formalAccrualStatus", ""), type: "text", exact: true },
      { label: "Formal 現金目標", stored: getMetricValue(storedDashboard, "grandTotal.formalCashTarget", null), fresh: getMetricValue(freshDashboard, "grandTotal.formalCashTarget", null), type: "money", exactNull: true },
      { label: "Formal 權責目標", stored: getMetricValue(storedDashboard, "grandTotal.formalAccrualTarget", null), fresh: getMetricValue(freshDashboard, "grandTotal.formalAccrualTarget", null), type: "money", exactNull: true },
      { label: "Formal 現金達成狀態", stored: getMetricValue(storedDashboard, "grandTotal.formalCashAchievementStatus", ""), fresh: getMetricValue(freshDashboard, "grandTotal.formalCashAchievementStatus", ""), type: "text", exact: true },
      { label: "Formal 權責達成狀態", stored: getMetricValue(storedDashboard, "grandTotal.formalAccrualAchievementStatus", ""), fresh: getMetricValue(freshDashboard, "grandTotal.formalAccrualAchievementStatus", ""), type: "text", exact: true },
      { label: "Cash Coverage", stored: getMetricValue(storedDashboard, "targetCoverage.cashCoverageComplete", null), fresh: getMetricValue(freshDashboard, "targetCoverage.cashCoverageComplete", null), type: "boolean", exact: true },
      { label: "Accrual Coverage", stored: getMetricValue(storedDashboard, "targetCoverage.accrualCoverageComplete", null), fresh: getMetricValue(freshDashboard, "targetCoverage.accrualCoverageComplete", null), type: "boolean", exact: true },
      { label: "Eligible Store Count", stored: getMetricValue(storedDashboard, "formalTargetAuthority.eligibleStoreCount", null), fresh: getMetricValue(freshDashboard, "formalTargetAuthority.eligibleStoreCount", null), type: "count", exactNull: true },
      { label: "Formal Cash Target Total", stored: getMetricValue(storedDashboard, "formalTargetAuthority.cashTargetTotal", null), fresh: getMetricValue(freshDashboard, "formalTargetAuthority.cashTargetTotal", null), type: "money", exactNull: true },
      { label: "Formal Accrual Target Total", stored: getMetricValue(storedDashboard, "formalTargetAuthority.accrualTargetTotal", null), fresh: getMetricValue(freshDashboard, "formalTargetAuthority.accrualTargetTotal", null), type: "money", exactNull: true },
      { label: "Formal Target Coverage Consistent", stored: getMetricValue(storedDashboard, "formalTargetAuthority.coverageConsistent", null), fresh: getMetricValue(freshDashboard, "formalTargetAuthority.coverageConsistent", null), type: "boolean", exact: true },
      { label: "Lifecycle Ready", stored: getMetricValue(storedDashboard, "formalTargetAuthority.lifecycleReady", null), fresh: getMetricValue(freshDashboard, "formalTargetAuthority.lifecycleReady", null), type: "boolean", exact: true },
      { label: "Formal Rank Eligible Count", stored: getMetricValue(storedDashboard, "formalRankEligibleStoreCount", null), fresh: getMetricValue(freshDashboard, "formalRankEligibleStoreCount", null), type: "count", exactNull: true },
      { label: "Summary Semantic Version", stored: getMetricValue(storedDashboard, "semanticVersion", ""), fresh: getMetricValue(freshDashboard, "semanticVersion", ""), type: "text", exact: true },
      { label: "Store-level Formal Signature", stored: buildSummaryStoreSemanticSignature(storedDashboard), fresh: buildSummaryStoreSemanticSignature(freshDashboard), type: "text", exact: true },
      { label: "Ranking Semantic Version", stored: getMetricValue(storedRankings, "semanticVersion", ""), fresh: getMetricValue(freshRankings, "semanticVersion", ""), type: "text", exact: true },
      { label: "Formal Ranking Eligible Count", stored: getMetricValue(storedRankings, "formalRankEligibleStoreCount", null), fresh: getMetricValue(freshRankings, "formalRankEligibleStoreCount", null), type: "count", exactNull: true },
      { label: "Formal Ranking Signature", stored: buildFormalRankingSignature(storedRankings), fresh: buildFormalRankingSignature(freshRankings), type: "text", exact: true },
      { label: "Therapist KPI Signature", stored: buildTherapistSummarySignature(storedTherapist), fresh: buildTherapistSummarySignature(freshTherapist), type: "text", exact: true },
      { label: "人員業績", stored: getMetricValue(storedTherapist, "grandTotal.totalRevenue"), fresh: getMetricValue(freshTherapist, "grandTotal.totalRevenue"), type: "money" },
      { label: "店日報筆數", stored: getMetricValue(storedDashboard, "sourceCounts.dailyReports"), fresh: getMetricValue(freshDashboard, "sourceCounts.dailyReports"), type: "count" },
      { label: "管理師日報筆數", stored: getMetricValue(storedTherapist, "sourceCounts.therapistReports"), fresh: getMetricValue(freshTherapist, "sourceCounts.therapistReports"), type: "count" },
      { label: "店家數", stored: getMetricValue(storedDashboard, "sourceCounts.stores"), fresh: getMetricValue(freshDashboard, "sourceCounts.stores"), type: "count" },
      { label: "管理師數", stored: getMetricValue(storedTherapist, "sourceCounts.therapists"), fresh: getMetricValue(freshTherapist, "sourceCounts.therapists"), type: "count" },
      { label: "目標店數", stored: getMetricValue(storedDashboard, "sourceCounts.targetStores"), fresh: getMetricValue(freshDashboard, "sourceCounts.targetStores"), type: "count" },
    ];

    return rows.map((row) => {
      if (row.exact === true || row.type === "text" || row.type === "boolean") {
        return { ...row, diff: null, diffRate: null, matched: Object.is(row.stored, row.fresh) };
      }

      if (row.exactNull === true && (row.stored === null || row.fresh === null)) {
        return { ...row, diff: null, diffRate: null, matched: row.stored === row.fresh };
      }

      const storedNumber = Number(row.stored);
      const freshNumber = Number(row.fresh);
      const bothFinite = Number.isFinite(storedNumber) && Number.isFinite(freshNumber);
      const diff = bothFinite ? storedNumber - freshNumber : null;
      const diffRate = bothFinite
        ? (freshNumber !== 0 ? (diff / freshNumber) * 100 : (diff === 0 ? 0 : 100))
        : null;
      return { ...row, diff, diffRate, matched: bothFinite && Math.abs(diff) < 0.0001 };
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

      if (!dashboardSnap.exists() || !therapistSnap.exists() || !rankingsSnap.exists()) {
        showToast("尚未找到完整三份 Summary，請先執行重新整理報表", "error");
        addLog("⚠️ 該月份尚未完整建立 dashboard_summary / therapist_summary / rankings_summary。");
        return;
      }

      const storedDashboard = dashboardSnap.data() || {};
      const storedTherapist = therapistSnap.data() || {};
      const storedRankings = rankingsSnap.data() || {};
      const { dashboardSummary: freshDashboard, therapistSummary: freshTherapist, rankingsSummary: freshRankings } = await buildDashboardSummaryPayloads(calMonth);
      const rows = makeSummaryCompareRows({ storedDashboard, storedTherapist, storedRankings, freshDashboard, freshTherapist, freshRankings });
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
  const getTargetSummaryBrandPrefix = () => {
    const normalizedBrandId = String(brandId || "").toLowerCase();
    if (brandLabel === "安妞" || normalizedBrandId.includes("anniu") || normalizedBrandId.includes("anew")) return "安妞";
    if (brandLabel === "伊啵" || normalizedBrandId.includes("yibo")) return "伊啵";
    return "CYJ";
  };

  const getTargetSummaryComparableTime = (value) => {
    if (!value) return 0;
    if (typeof value?.toMillis === "function") {
      const ms = Number(value.toMillis());
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof value?.seconds === "number") {
      return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1000000);
    }
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : 0;
  };

  const hasEffectiveTargetValues = (target = {}) =>
    Number(target?.cashTarget || 0) > 0 || Number(target?.accrualTarget || 0) > 0;

  const getTargetSummarySignature = (target = {}) => JSON.stringify({
    cashTarget: Number(target.cashTarget || 0),
    accrualTarget: Number(target.accrualTarget || 0),
    challengeCashTarget: Number(target.challengeCashTarget || 0),
    challengeAccrualTarget: Number(target.challengeAccrualTarget || 0),
  });

  const shouldReplaceTargetSummaryEntry = (currentMeta, nextMeta) => {
    if (!currentMeta) return true;

    // 同一門市若同時存在「全 0 舊文件」與「有效目標文件」，有效目標一定優先，
    // 避免較新的 0 值 duplicate 把正式目標蓋掉。
    if (Boolean(currentMeta.hasEffectiveTarget) !== Boolean(nextMeta.hasEffectiveTarget)) {
      return Boolean(nextMeta.hasEffectiveTarget);
    }

    // 有效性相同時沿用「較新資料優先」；若時間相同，再以 canonical 店名與文件 ID 穩定排序。
    const currentTime = Number(currentMeta.updatedAtMs || 0);
    const nextTime = Number(nextMeta.updatedAtMs || 0);
    if (currentTime !== nextTime) return nextTime > currentTime;

    if (Boolean(currentMeta.isCanonicalStoreName) !== Boolean(nextMeta.isCanonicalStoreName)) {
      return Boolean(nextMeta.isCanonicalStoreName);
    }

    return String(nextMeta.sourceDocId || "").localeCompare(String(currentMeta.sourceDocId || ""), "zh-Hant") > 0;
  };

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

    const rawStore = String(storeName || "").trim().replace(/[　\s]+/g, "");
    const fullStoreName = `${getTargetSummaryBrandPrefix()}${core}店`;
    const updatedAtValue = data.updatedAtText || data.updatedAt || data.modifiedAtText || data.modifiedAt || data.createdAtText || data.createdAt || "";

    return {
      year: yearText,
      month: monthNum,
      yearMonth: `${yearText}-${String(monthNum).padStart(2, "0")}`,
      storeName: fullStoreName,
      coreStoreName: core,
      isCanonicalStoreName: rawStore === fullStoreName,
      updatedAtMs: getTargetSummaryComparableTime(updatedAtValue),
      sourceDocId: docId,
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
      hasEffectiveTarget: Number(data.cashTarget || 0) > 0 || Number(data.accrualTarget || 0) > 0,
      targetSignature: getTargetSummarySignature({
        cashTarget: Number(data.cashTarget || 0),
        accrualTarget: Number(data.accrualTarget || 0),
        challengeCashTarget: Number(data.challengeCashTarget || 0),
        challengeAccrualTarget: Number(data.challengeAccrualTarget || 0),
      }),
    };
  };

  const getCoreAuditYearMonth = (docId = "", data = {}) => {
    const direct = String(data.yearMonth || data.monthKey || "").trim();
    if (/^\d{4}-\d{2}$/.test(direct)) return direct;
    const dateText = formatDateString(data.date || data.sourceDate || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return dateText.slice(0, 7);
    const match = String(docId || "").match(/(20\d{2})[-_](\d{1,2})/);
    return match ? `${match[1]}-${String(Number(match[2])).padStart(2, "0")}` : "";
  };

  const getCoreAuditRecordTime = (data = {}) =>
    getTargetSummaryComparableTime(
      data.updatedAtText || data.updatedAt || data.modifiedAtText || data.modifiedAt ||
      data.createdAtText || data.createdAt || data.timestamp || ""
    );

  const normalizeCoreAuditStoreMetrics = (data = {}) => ({
    cash: Number(data.cash || 0),
    refund: Number(data.refund || 0),
    accrual: Number(data.accrual || 0),
    operationalAccrual: Number(data.operationalAccrual || 0),
    traffic: Number(data.traffic || 0),
    skincareSales: Number(data.skincareSales || 0),
    skincareRefund: Number(data.skincareRefund || 0),
    newCustomers: Number(data.newCustomers ?? data.newCustomerCount ?? 0),
    newCustomerClosings: Number(data.newCustomerClosings || 0),
    newCustomerSales: Number(data.newCustomerSales ?? data.newCustomerRevenue ?? 0),
    oldCustomerRevenue: Number(data.oldCustomerRevenue || 0),
    oldCustomerCount: Number(data.oldCustomerCount || 0),
  });

  const normalizeCoreAuditTherapistMetrics = (data = {}) => ({
    totalRevenue: Number(data.totalRevenue ?? data.cash ?? 0),
    serviceCount: Number(data.serviceCount || 0),
    newCustomerRevenue: Number(data.newCustomerRevenue || 0),
    oldCustomerRevenue: Number(data.oldCustomerRevenue || 0),
    newCustomerCount: Number(data.newCustomerCount || 0),
    oldCustomerCount: Number(data.oldCustomerCount || 0),
    newCustomerClosings: Number(data.newCustomerClosings || 0),
    returnRevenue: Number(data.returnRevenue || 0),
  });

  const getCoreAuditTherapistIdentity = (data = {}) => {
    const therapistId = String(data.therapistId || "").trim();
    if (therapistId) return `id:${therapistId}`;
    const name = normalizePersonName(getTherapistName(data));
    const store = normalizeCoreName(getStoreName(data));
    return name ? `name:${name}|store:${store || "-"}` : "";
  };

  const summarizeCoreAuditMetrics = (metrics = {}) => Object.entries(metrics)
    .filter(([, value]) => Number(value || 0) !== 0)
    .slice(0, 8)
    .map(([key, value]) => `${key}=${Number(value || 0).toLocaleString()}`)
    .join("｜") || "主要數值皆為 0";

  const makeCoreAuditIssue = ({
    id,
    severity = "warning",
    kind = "duplicate",
    collectionName = "",
    title = "",
    canonicalKey = "",
    reason = "",
    recommendation = "",
    records = [],
  }) => ({
    id,
    severity,
    kind,
    collectionName,
    title,
    canonicalKey,
    reason,
    recommendation,
    records: Array.isArray(records) ? records : [],
  });

  const extractCoreAuditSummaryTargetMap = (data = {}) => {
    const map = {};
    const containers = [
      data.targets,
      data.stores,
      data.storeTargets,
      data.storeTargetMap,
      data.monthlyTargets,
      data.targetStores,
      data.items,
      data.data,
      data.byStore,
      data.storeMap,
      data.storesMap,
      data.summaryByStore,
      data.storeSummaries,
    ];

    const consume = (container) => {
      if (!container) return;
      const entries = Array.isArray(container)
        ? container.map((value, index) => [value?.storeName || value?.store || value?.name || String(index), value])
        : (typeof container === "object" ? Object.entries(container) : []);

      entries.forEach(([rawKey, value]) => {
        if (!value || typeof value !== "object") return;
        const core = normalizeCoreName(value.storeName || value.store || value.coreStoreName || rawKey);
        if (!core) return;
        const candidate = {
          storeName: value.storeName || value.store || rawKey,
          cashTarget: Number(value.cashTarget || value.cash || value.budget || 0),
          accrualTarget: Number(value.accrualTarget || value.accrual || value.accrualBudget || 0),
          challengeCashTarget: Number(value.challengeCashTarget || value.challengeCash || 0),
          challengeAccrualTarget: Number(value.challengeAccrualTarget || value.challengeAccrual || 0),
          sourceDocId: value.sourceDocId || rawKey,
          updatedAtMs: getCoreAuditRecordTime(value),
          isCanonicalStoreName: String(value.storeName || value.store || rawKey).replace(/[　\s]+/g, "") === `${getTargetSummaryBrandPrefix()}${core}店`,
        };
        candidate.hasEffectiveTarget = hasEffectiveTargetValues(candidate);
        const current = map[core];
        if (!current || shouldReplaceTargetSummaryEntry(current, candidate)) map[core] = candidate;
      });
    };

    containers.forEach(consume);
    return map;
  };

  const handleRunCoreConsistencyAudit = async () => {
    const isYearScope = consistencyAuditScope === "year";
    const selectedYear = isYearScope
      ? String(consistencyAuditYear || "").trim()
      : String(calMonth || "").slice(0, 4);

    if (!/^\d{4}$/.test(selectedYear)) {
      showToast("請先確認健檢年度格式", "error");
      return null;
    }

    const auditMonths = isYearScope
      ? Array.from({ length: 12 }, (_, index) => `${selectedYear}-${String(index + 1).padStart(2, "0")}`)
      : [calMonth];

    if (!isYearScope && !/^\d{4}-\d{2}$/.test(String(calMonth || ""))) {
      showToast("請先選擇健檢月份", "error");
      return null;
    }

    const startDate = isYearScope ? `${selectedYear}-01-01` : monthRange(calMonth).startDate;
    const endDate = isYearScope ? `${selectedYear}-12-31` : monthRange(calMonth).endDate;
    const rangeLabel = isYearScope ? `${selectedYear} 全年度` : calMonth;

    setLoadingAction("coreConsistencyAudit");
    setConsistencyReport(null);
    setExpandedConsistencyIssue("");
    setLogs([]);
    addLog(`🧭 啟動核心資料一致性健檢：${brandLabel}｜${rangeLabel}`);
    if (isYearScope) {
      addLog("ℹ️ 全年模式會讀取該年度店家／管理師日報；屬人工維護 Audit，不建議高頻執行。");
    }

    try {
      const summaryDocPromises = auditMonths.map((yearMonth) =>
        getDoc(doc(getCollectionPath("monthly_targets_summary"), yearMonth))
          .then((snap) => [yearMonth, snap])
      );

      const [
        orgProfile,
        targetSnap,
        monthlyAggSnap,
        dailySnap,
        therapistDailySnap,
        therapistMonthlyAggSnap,
        therapistMasterSnap,
        targetSummaryEntries,
      ] = await Promise.all([
        getOrgStructureProfile(),
        getDocs(getCollectionPath("monthly_targets")),
        getDocs(getCollectionPath("monthly_aggregated")),
        getDocs(query(getCollectionPath("daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate))),
        getDocs(query(getCollectionPath("therapist_daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate))),
        getDocs(getCollectionPath("therapist_monthly_aggregated")),
        getDocs(getCollectionPath("therapists")),
        Promise.all(summaryDocPromises),
      ]);

      const targetSummaryByMonth = Object.fromEntries(targetSummaryEntries);
      const issues = [];
      const sourceCounts = {
        monthly_targets: targetSnap.size,
        monthly_aggregated: monthlyAggSnap.size,
        daily_reports: dailySnap.size,
        therapist_daily_reports: therapistDailySnap.size,
        therapist_monthly_aggregated: therapistMonthlyAggSnap.size,
        therapists: therapistMasterSnap.size,
        org_structure: 1,
        monthly_targets_summary: targetSummaryEntries.filter(([, snap]) => snap.exists()).length,
      };

      const addGroupedIssues = ({
        collectionName,
        rows,
        keyOf,
        signatureOf,
        titleOf,
        recordOf,
        targetMode = false,
      }) => {
        const grouped = new Map();
        rows.forEach((row) => {
          const key = keyOf(row);
          if (!key) return;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(row);
        });

        grouped.forEach((records, canonicalKey) => {
          if (records.length <= 1) return;

          if (targetMode) {
            const effective = records.filter((row) => row.hasEffectiveTarget);
            const effectiveSignatures = new Set(effective.map((row) => row.targetSignature));
            let kind = "duplicate_zero";
            let severity = "warning";
            let reason = "同一門市同月份存在多份全 0 目標文件。";
            let recommendation = "先確認是否為歷史空白資料；V1 健檢不會自動修改。";

            if (effective.length === 1) {
              kind = "duplicate_safe";
              reason = "同一門市同月份同時存在有效目標與全 0 文件。";
              recommendation = `建議保留有效目標 ${effective[0].sourceDocId}；其餘列為待確認 duplicate。`;
            } else if (effective.length > 1 && effectiveSignatures.size === 1) {
              kind = "duplicate_identical";
              reason = "同一門市同月份存在多份內容相同的有效目標。";
              recommendation = "內容一致，可列入後續安全整理候選；V1 不自動封存。";
            } else if (effectiveSignatures.size > 1) {
              kind = "conflict";
              severity = "danger";
              reason = "同一門市同月份存在兩份以上不同的有效目標。";
              recommendation = "禁止自動合併或相加，必須人工確認正式值。";
            }

            issues.push(makeCoreAuditIssue({
              id: `${collectionName}:${canonicalKey}`,
              severity,
              kind,
              collectionName,
              title: titleOf(records[0], canonicalKey),
              canonicalKey,
              reason,
              recommendation,
              records: records.map(recordOf),
            }));
            return;
          }

          const signatures = new Set(records.map(signatureOf));
          const identical = signatures.size === 1;
          issues.push(makeCoreAuditIssue({
            id: `${collectionName}:${canonicalKey}`,
            severity: identical ? "warning" : "danger",
            kind: identical ? "duplicate_identical" : "conflict",
            collectionName,
            title: titleOf(records[0], canonicalKey),
            canonicalKey,
            reason: identical ? "同一邏輯鍵存在多份內容相同文件。" : "同一邏輯鍵存在多份不同內容文件。",
            recommendation: identical
              ? "列入後續安全整理候選；V1 只標示，不修改資料。"
              : "禁止自動封存，請先確認哪一份才是正式資料。",
            records: records.map(recordOf),
          }));
        });
      };

      const targetRows = targetSnap.docs
        .map((d) => {
          const parsed = parseMonthlyTargetDocForSummary(d.id, d.data() || {}, selectedYear);
          return parsed ? { ...parsed, raw: d.data() || {} } : null;
        })
        .filter((row) =>
          row &&
          (isYearScope ? row.year === selectedYear : row.yearMonth === calMonth)
        );

      addGroupedIssues({
        collectionName: "monthly_targets",
        rows: targetRows,
        keyOf: (row) => `${row.yearMonth}|${row.coreStoreName}`,
        signatureOf: (row) => row.targetSignature,
        titleOf: (row) => `${brandLabel} ${row.coreStoreName}｜${row.yearMonth} 月目標`,
        recordOf: (row) => ({
          id: row.sourceDocId,
          label: row.target.storeName,
          summary: `現金 ${Number(row.target.cashTarget || 0).toLocaleString()}｜權責 ${Number(row.target.accrualTarget || 0).toLocaleString()}｜${row.isCanonicalStoreName ? "canonical" : "非 canonical"}`,
          effective: row.hasEffectiveTarget,
        }),
        targetMode: true,
      });

      const monthlyAggRows = monthlyAggSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() || {}) }))
        .filter((row) => {
          const yearMonth = getCoreAuditYearMonth(row.id, row);
          return (
            row.isArchivedDuplicate !== true &&
            (isYearScope ? yearMonth.startsWith(`${selectedYear}-`) : yearMonth === calMonth)
          );
        });

      addGroupedIssues({
        collectionName: "monthly_aggregated",
        rows: monthlyAggRows,
        keyOf: (row) => {
          const yearMonth = getCoreAuditYearMonth(row.id, row);
          const core = normalizeCoreName(getStoreName(row) || row.id);
          return yearMonth && core ? `${yearMonth}|${core}` : "";
        },
        signatureOf: (row) => JSON.stringify(normalizeCoreAuditStoreMetrics(row)),
        titleOf: (row) => {
          const yearMonth = getCoreAuditYearMonth(row.id, row);
          return `${brandLabel} ${normalizeCoreName(getStoreName(row) || row.id)}｜${yearMonth} 店家月彙總`;
        },
        recordOf: (row) => ({
          id: row.id,
          label: getStoreName(row) || row.id,
          summary: summarizeCoreAuditMetrics(normalizeCoreAuditStoreMetrics(row)),
        }),
      });

      const dailyRows = dailySnap.docs
        .map((d) => ({ id: d.id, ...(d.data() || {}) }))
        .filter((row) => row.isArchivedDuplicate !== true);

      addGroupedIssues({
        collectionName: "daily_reports",
        rows: dailyRows,
        keyOf: (row) => {
          const date = formatDateString(row.date || "");
          const core = normalizeCoreName(getStoreName(row));
          return date && core ? `${date}|${core}` : "";
        },
        signatureOf: (row) => JSON.stringify(normalizeCoreAuditStoreMetrics(row)),
        titleOf: (row) => `${formatDateString(row.date || "")}｜${normalizeCoreName(getStoreName(row))} 店家日報`,
        recordOf: (row) => ({
          id: row.id,
          label: getStoreName(row) || "-",
          summary: summarizeCoreAuditMetrics(normalizeCoreAuditStoreMetrics(row)),
        }),
      });

      const therapistDailyRows = therapistDailySnap.docs
        .map((d) => ({ id: d.id, ...(d.data() || {}) }))
        .filter((row) => row.isArchivedDuplicate !== true);

      addGroupedIssues({
        collectionName: "therapist_daily_reports",
        rows: therapistDailyRows,
        keyOf: (row) => {
          const date = formatDateString(row.date || "");
          const identity = getCoreAuditTherapistIdentity(row);
          return date && identity ? `${date}|${identity}` : "";
        },
        signatureOf: (row) => JSON.stringify(normalizeCoreAuditTherapistMetrics(row)),
        titleOf: (row) => `${formatDateString(row.date || "")}｜${getTherapistName(row) || row.therapistId || "未知管理師"} 管理師日報`,
        recordOf: (row) => ({
          id: row.id,
          label: `${getTherapistName(row) || "-"}｜${getStoreName(row) || "-"}`,
          summary: summarizeCoreAuditMetrics(normalizeCoreAuditTherapistMetrics(row)),
        }),
      });

      const therapistMonthlyRows = therapistMonthlyAggSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() || {}) }))
        .filter((row) => {
          const yearMonth = getCoreAuditYearMonth(row.id, row);
          return (
            row.isArchivedDuplicate !== true &&
            (isYearScope ? yearMonth.startsWith(`${selectedYear}-`) : yearMonth === calMonth)
          );
        });

      addGroupedIssues({
        collectionName: "therapist_monthly_aggregated",
        rows: therapistMonthlyRows,
        keyOf: (row) => {
          const yearMonth = getCoreAuditYearMonth(row.id, row);
          const identity = getCoreAuditTherapistIdentity(row);
          return yearMonth && identity ? `${yearMonth}|${identity}` : "";
        },
        signatureOf: (row) => JSON.stringify(normalizeCoreAuditTherapistMetrics(row)),
        titleOf: (row) => {
          const yearMonth = getCoreAuditYearMonth(row.id, row);
          return `${getTherapistName(row) || row.therapistId || "未知管理師"}｜${yearMonth} 管理師月彙總`;
        },
        recordOf: (row) => ({
          id: row.id,
          label: `${getTherapistName(row) || "-"}｜${getStoreName(row) || "-"}`,
          summary: summarizeCoreAuditMetrics(normalizeCoreAuditTherapistMetrics(row)),
        }),
      });

      const therapistMasterRows = therapistMasterSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
      const explicitIdGroups = new Map();
      therapistMasterRows.forEach((row) => {
        const explicitId = String(row.therapistId || "").trim();
        if (!explicitId) return;
        if (!explicitIdGroups.has(explicitId)) explicitIdGroups.set(explicitId, []);
        explicitIdGroups.get(explicitId).push(row);
      });

      explicitIdGroups.forEach((records, therapistId) => {
        if (records.length <= 1) return;
        issues.push(makeCoreAuditIssue({
          id: `therapists:id:${therapistId}`,
          severity: "danger",
          kind: "master_duplicate_id",
          collectionName: "therapists",
          title: `管理師主檔 ID 重複｜${therapistId}`,
          canonicalKey: `therapistId:${therapistId}`,
          reason: "不同主檔文件使用相同 therapistId。",
          recommendation: "請人工確認人員主檔，不可自動合併。",
          records: records.map((row) => ({
            id: row.id,
            label: `${row.name || row.therapistName || "-"}｜${row.store || row.storeName || "-"}`,
            summary: `status=${row.status || "-"}｜isActive=${String(row.isActive ?? "-")}`,
          })),
        }));
      });

      const nameStoreGroups = new Map();
      therapistMasterRows.forEach((row) => {
        const name = normalizePersonName(row.name || row.therapistName);
        const store = normalizeCoreName(row.store || row.storeName);
        if (!name) return;
        const key = `${name}|${store || "-"}`;
        if (!nameStoreGroups.has(key)) nameStoreGroups.set(key, []);
        nameStoreGroups.get(key).push(row);
      });

      nameStoreGroups.forEach((records, key) => {
        if (records.length <= 1) return;
        const ids = new Set(records.map((row) => String(row.therapistId || row.id || "")).filter(Boolean));
        if (ids.size <= 1) return;
        issues.push(makeCoreAuditIssue({
          id: `therapists:name-store:${key}`,
          severity: "warning",
          kind: "master_possible_duplicate",
          collectionName: "therapists",
          title: `管理師主檔疑似重複｜${key.replace("|", "｜")}`,
          canonicalKey: key,
          reason: "同姓名、同店家存在不同人員 ID；也可能是真實同名人員。",
          recommendation: "僅列為人工確認，不自動判定重複。",
          records: records.map((row) => ({
            id: row.id,
            label: `${row.name || row.therapistName || "-"}｜${row.store || row.storeName || "-"}`,
            summary: `therapistId=${row.therapistId || row.id || "-"}｜status=${row.status || "-"}`,
          })),
        }));
      });

      (orgProfile.duplicateStores || []).forEach((row, index) => {
        issues.push(makeCoreAuditIssue({
          id: `org_structure:${row.store || index}`,
          severity: "danger",
          kind: "org_duplicate",
          collectionName: "org_structure",
          title: `組織架構重複歸屬｜${row.store || "-"}`,
          canonicalKey: normalizeCoreName(row.store || ""),
          reason: `同一正規化店家同時出現在多個區長：${(row.owners || []).join("、")}`,
          recommendation: "請回組織架構確認正式歸屬。",
          records: (row.owners || []).map((owner, ownerIndex) => ({
            id: `${row.store || "store"}_${ownerIndex}`,
            label: owner,
            summary: "區長歸屬",
          })),
        }));
      });

      // Raw 目標按「年月 + 正規化店名」裁決；全年模式不可跨月份互相覆蓋。
      const targetGroupMap = new Map();
      targetRows.forEach((row) => {
        const key = `${row.yearMonth}|${row.coreStoreName}`;
        if (!targetGroupMap.has(key)) targetGroupMap.set(key, []);
        targetGroupMap.get(key).push(row);
      });

      const rawPreferredTargetsByMonth = {};
      const targetConflictKeys = new Set();

      targetGroupMap.forEach((records, key) => {
        const [yearMonth, core] = key.split("|");
        const effectiveSignatures = new Set(
          records.filter((row) => row.hasEffectiveTarget).map((row) => row.targetSignature)
        );
        if (effectiveSignatures.size > 1) targetConflictKeys.add(key);

        const preferred = records.reduce((current, next) => {
          if (!current) return next;
          return shouldReplaceTargetSummaryEntry(current, next) ? next : current;
        }, null);

        if (!rawPreferredTargetsByMonth[yearMonth]) rawPreferredTargetsByMonth[yearMonth] = {};
        if (preferred) {
          rawPreferredTargetsByMonth[yearMonth][core] = {
            ...preferred.target,
            hasEffectiveTarget: preferred.hasEffectiveTarget,
          };
        }
      });

      // 逐月比對 Raw / monthly_targets_summary；全年模式一次檢查 12 個月份。
      auditMonths.forEach((yearMonth) => {
        const targetSummarySnap = targetSummaryByMonth[yearMonth];
        const rawPreferredTargets = rawPreferredTargetsByMonth[yearMonth] || {};

        if (!targetSummarySnap?.exists()) {
          issues.push(makeCoreAuditIssue({
            id: `monthly_targets_summary:${yearMonth}:missing`,
            severity: "warning",
            kind: "summary_missing",
            collectionName: "monthly_targets_summary",
            title: `${yearMonth} 月目標 Summary 尚未建立`,
            canonicalKey: yearMonth,
            reason: "找不到 monthly_targets_summary 指定月份文件。",
            recommendation: "先確認 raw monthly_targets 無衝突，再執行年度目標補整理。",
            records: [],
          }));
          return;
        }

        const summaryTargets = extractCoreAuditSummaryTargetMap(targetSummarySnap.data() || {});
        const expectedCores = new Set([
          ...(orgProfile.stores || []).map(normalizeCoreName),
          ...Object.keys(rawPreferredTargets),
          ...Object.keys(summaryTargets),
        ].filter(Boolean));

        expectedCores.forEach((core) => {
          if (targetConflictKeys.has(`${yearMonth}|${core}`)) return;

          const rawTarget = rawPreferredTargets[core] || {};
          const summaryTarget = summaryTargets[core] || {};
          const rawCash = Number(rawTarget.cashTarget || 0);
          const rawAccrual = Number(rawTarget.accrualTarget || 0);
          const summaryCash = Number(summaryTarget.cashTarget || 0);
          const summaryAccrual = Number(summaryTarget.accrualTarget || 0);

          if (rawCash === summaryCash && rawAccrual === summaryAccrual) return;

          issues.push(makeCoreAuditIssue({
            id: `monthly_targets_summary:${yearMonth}:${core}`,
            severity: "danger",
            kind: "summary_mismatch",
            collectionName: "monthly_targets_summary",
            title: `${brandLabel} ${core}｜${yearMonth} Raw / Summary 不一致`,
            canonicalKey: `${yearMonth}|${core}`,
            reason: `raw 現金 ${rawCash.toLocaleString()} / 權責 ${rawAccrual.toLocaleString()}；Summary 現金 ${summaryCash.toLocaleString()} / 權責 ${summaryAccrual.toLocaleString()}`,
            recommendation: "先處理 raw duplicate / conflict，再重建 monthly_targets_summary。",
            records: [
              {
                id: rawTarget.sourceDocId || "raw_resolved",
                label: "monthly_targets（裁決後）",
                summary: `現金 ${rawCash.toLocaleString()}｜權責 ${rawAccrual.toLocaleString()}`,
              },
              {
                id: summaryTarget.sourceDocId || yearMonth,
                label: "monthly_targets_summary",
                summary: `現金 ${summaryCash.toLocaleString()}｜權責 ${summaryAccrual.toLocaleString()}`,
              },
            ],
          }));
        });
      });

      const severityRank = { danger: 0, warning: 1, info: 2 };
      issues.sort((a, b) =>
        (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) ||
        String(a.collectionName).localeCompare(String(b.collectionName), "zh-Hant") ||
        String(a.title).localeCompare(String(b.title), "zh-Hant")
      );

      const conflicts = issues.filter((item) => item.severity === "danger").length;
      const warnings = issues.filter((item) => item.severity === "warning").length;
      const safeDuplicates = issues.filter((item) =>
        ["duplicate_safe", "duplicate_identical", "duplicate_zero"].includes(item.kind)
      ).length;
      const summaryMismatches = issues.filter((item) => item.kind === "summary_mismatch").length;
      const scanned = Object.values(sourceCounts).reduce((sum, count) => sum + Number(count || 0), 0);

      const report = {
        brandId,
        brandLabel,
        scope: isYearScope ? "year" : "month",
        rangeLabel,
        year: selectedYear,
        month: isYearScope ? "" : calMonth,
        auditMonths,
        startDate,
        endDate,
        status: conflicts > 0 ? "danger" : (warnings > 0 ? "warning" : "pass"),
        scanned,
        conflicts,
        warnings,
        safeDuplicates,
        summaryMismatches,
        issueCount: issues.length,
        issues: issues.slice(0, isYearScope ? 240 : 120),
        truncatedIssueCount: Math.max(0, issues.length - (isYearScope ? 240 : 120)),
        sourceCounts,
        createdAt: new Date().toLocaleString("zh-TW", { hour12: false }),
        auditOnly: true,
      };

      setConsistencyReport(report);
      await addMaintenanceLog({
        type: "core_data_consistency_audit",
        action: isYearScope ? "run_year_audit_only" : "run_audit_only",
        scope: report.scope,
        year: selectedYear,
        month: isYearScope ? "" : calMonth,
        startDate,
        endDate,
        status: report.status,
        scanned,
        conflicts,
        warnings,
        safeDuplicates,
        summaryMismatches,
        issueCount: issues.length,
      });

      addLog(
        `✅ 核心一致性健檢完成：${rangeLabel}｜掃描 ${scanned.toLocaleString()} docs｜衝突 ${conflicts}｜提醒 ${warnings}｜Summary 差異 ${summaryMismatches}。`
      );
      showToast(
        conflicts
          ? `健檢完成：發現 ${conflicts} 組高風險衝突`
          : (warnings ? `健檢完成：${warnings} 組需確認` : "核心資料一致性正常"),
        conflicts ? "error" : (warnings ? "info" : "success")
      );
      return report;
    } catch (error) {
      console.error(error);
      addLog(`❌ 核心資料一致性健檢失敗：${error.message}`);
      showToast("核心資料一致性健檢失敗", "error");
      return null;
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
            <SectionTitle eyebrow="需要時再開" title="進一步處理" desc="日常只需要使用上方四個主要入口；只有系統提示或已確認資料異常時，再展開這些工具。" icon={Settings} />
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
            <ToolRow
              icon={Activity}
              title="業績推估功能狀態"
              desc="確認目前品牌的業績推估功能是否正常。只有按下重新整理時才讀取 1 份狀態資料；不會修改業績或推估結果。"
              badge="只讀"
              tone={getProjectionObservabilityTone(projectionObservabilityState?.data?.status)}
            >
              <BeautyButton
                onClick={handleLoadProjectionObservability}
                disabled={loadingAction !== null}
                variant="primary"
              >
                {loadingAction === "projectionObservability"
                  ? <Loader2 size={14} className="animate-spin" />
                  : <RefreshCw size={14} />}
                重新整理模型狀態
              </BeautyButton>
            </ToolRow>

            {projectionObservabilityState.status === "idle" && (
              <div className="rounded-2xl border border-stone-100 bg-white/70 px-4 py-3 text-[11px] font-bold text-stone-500 leading-relaxed">
                此區平常不會自動讀取資料；需要確認推估功能狀態時再按「重新整理模型狀態」。推估結果與準確度請到「智慧推估」查看。
              </div>
            )}

            {projectionObservabilityState.status === "error" && (
              <div className="rounded-2xl border border-rose-100 bg-rose-50/40 px-4 py-3 text-[11px] font-bold text-rose-600 leading-relaxed">
                讀取失敗：{projectionObservabilityState.error || "未知錯誤"}
              </div>
            )}

            {projectionObservabilityState.status === "ready" && projectionObservabilityState.data && (() => {
              const data = projectionObservabilityState.data;
              const statusTone = data.status === "healthy"
                ? "text-emerald-700 border-emerald-100 bg-emerald-50"
                : data.status === "error"
                  ? "text-rose-600 border-rose-100 bg-rose-50"
                  : "text-[#9A6A24] border-amber-100 bg-amber-50";
              const phaseText = (metric) => (
                data.v2Expected
                  ? (metric?.reliable
                    ? `READY｜${Number(metric.sourceMonthCount || 0)} 個完整來源月`
                    : `FALLBACK｜${Number(metric?.sourceMonthCount || 0)} 個完整來源月`)
                  : "V1｜不使用品牌 Phase"
              );

              return (
                <div className="rounded-[1.5rem] border border-stone-100 bg-white/90 p-4 space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-black text-stone-800">{brandLabel}｜業績推估模型</p>
                        <span className={`px-2.5 py-1 rounded-full border text-[10px] font-black ${statusTone}`}>
                          {data.statusLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] font-bold text-stone-400">
                        {data.statusDetail || "目前模型文件未回報額外狀態說明"}
                      </p>
                    </div>
                    <p className="text-[10px] font-black text-stone-400">
                      本次讀取：1 doc｜{projectionObservabilityState.loadedAtText || "-"}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    {[
                      ["策略", data.strategyLabel || "-"],
                      ["模型月份", data.modelMonth || "-"],
                      ["來源月份", data.sourceMonths?.join(" / ") || "-"],
                      ["門市模型", `${Number(data.storeCount || 0).toLocaleString()} 店`],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-stone-100 bg-stone-50/60 p-3">
                        <p className="text-[10px] font-black text-stone-400">{label}</p>
                        <p className="mt-1 text-xs font-black text-stone-700 break-words">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {[["現金 Phase", data.cashPhase], ["權責 Phase", data.accrualPhase]].map(([label, metric]) => (
                      <div key={label} className="rounded-2xl border border-stone-100 bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-black text-stone-700">{label}</p>
                          <span className={`px-2 py-1 rounded-full border text-[10px] font-black ${
                            data.v2Expected && metric?.reliable
                              ? "text-emerald-700 border-emerald-100 bg-emerald-50"
                              : "text-[#9A6A24] border-amber-100 bg-amber-50"
                          }`}>
                            {phaseText(metric)}
                          </span>
                        </div>
                        {metric?.completeSourceMonths?.length > 0 && (
                          <p className="mt-2 text-[10px] font-bold text-stone-400">
                            完整月份：{metric.completeSourceMonths.join(" / ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="rounded-2xl border border-stone-100 bg-stone-50/60 p-3">
                      <p className="text-[10px] font-black text-stone-400">Schema / Semantic</p>
                      <p className="mt-1 text-[11px] font-black text-stone-700 break-all">
                        {data.schemaVersion || "-"} / {data.semanticVersion || "-"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-stone-100 bg-stone-50/60 p-3">
                      <p className="text-[10px] font-black text-stone-400">V2 啟用門檻</p>
                      <p className="mt-1 text-[11px] font-black text-stone-700">
                        {data.v2Expected ? `Day ${data.phaseMinDay}+ 且 Phase reliable` : "目前品牌維持 V1"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-stone-100 bg-stone-50/60 p-3">
                      <p className="text-[10px] font-black text-stone-400">最近模型重建</p>
                      <p className="mt-1 text-[11px] font-black text-stone-700 break-words">
                        {data.generatedAtText || "-"}
                      </p>
                      {data.trigger && (
                        <p className="mt-1 text-[10px] font-bold text-stone-400">trigger：{data.trigger}</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-stone-100 bg-stone-50/50 px-3 py-2 text-[10px] font-bold text-stone-400">
                    System Exclusion snapshot：模型文件目前列出 {Number(data.excludedStoreCount || 0).toLocaleString()} 間排除店。此監控只顯示 persisted model metadata，不在前端改寫 Projection Authority。
                  </div>
                </div>
              );
            })()}



            <ToolRow
              icon={Database}
              title="資料一致性檢查"
              desc="比對目標、日報、月資料、人員與組織資料是否一致。可檢查單月或全年；只做檢查，不會修改資料。"
              badge="只讀檢查"
              tone="amber"
            >
              <div className="inline-flex items-center rounded-2xl border border-stone-100 bg-white/80 p-1 h-11">
                {[
                  ["month", "單月"],
                  ["year", "全年"],
                ].map(([scope, label]) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => {
                      setConsistencyAuditScope(scope);
                      if (scope === "year" && /^\d{4}-\d{2}$/.test(String(calMonth || ""))) {
                        setConsistencyAuditYear(String(calMonth).slice(0, 4));
                      }
                    }}
                    className={`h-8 px-3 rounded-xl text-[11px] font-black transition-all ${
                      consistencyAuditScope === scope
                        ? "bg-[#FFF2D8] text-[#9A6A24] border border-amber-200 shadow-sm"
                        : "text-stone-400 border border-transparent hover:text-stone-600"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {consistencyAuditScope === "year" ? (
                <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11">
                  <Calendar size={14} className="text-stone-400" />
                  <input
                    type="number"
                    min="2020"
                    max="2099"
                    value={consistencyAuditYear}
                    onChange={(e) => setConsistencyAuditYear(e.target.value)}
                    className="bg-transparent text-xs font-black text-stone-700 outline-none w-20"
                  />
                  <span className="text-[10px] font-black text-stone-400">1–12 月</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11">
                  <Calendar size={14} className="text-stone-400" />
                  <SmartMonthPicker
                    value={calMonth}
                    onChange={setCalMonth}
                    align="right"
                    buttonClassName="!h-9 !min-w-[140px] !border-0 !bg-transparent !px-0 !py-0 !text-xs !shadow-none hover:!bg-transparent"
                  />
                </div>
              )}

              <BeautyButton onClick={handleRunCoreConsistencyAudit} disabled={loadingAction !== null} variant="primary">
                {loadingAction === "coreConsistencyAudit" ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                {consistencyAuditScope === "year" ? "執行全年健檢" : "執行一致性健檢"}
              </BeautyButton>
            </ToolRow>

            {consistencyAuditScope === "year" && !consistencyReport && (
              <div className="rounded-2xl border border-amber-100 bg-amber-50/40 px-4 py-3 text-[11px] font-bold text-[#9A6A24] leading-relaxed">
                全年模式會一次讀取所選品牌該年度的店家／管理師日報，並逐月比對 12 份 monthly_targets_summary。適合資料治理或月結前人工檢查，不建議高頻執行。
              </div>
            )}

            {consistencyReport && (
              <div className={`rounded-[1.5rem] border p-4 space-y-3 ${
                consistencyReport.status === "danger"
                  ? "border-rose-100 bg-rose-50/30"
                  : consistencyReport.status === "warning"
                    ? "border-amber-100 bg-amber-50/30"
                    : "border-emerald-100 bg-emerald-50/30"
              }`}>
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-black text-stone-800">
                        核心資料一致性健檢｜{consistencyReport.rangeLabel || consistencyReport.month}
                      </p>
                      <span className="px-2.5 py-1 rounded-full bg-white border border-stone-100 text-[10px] font-black text-stone-500">唯讀 Audit</span>
                      {consistencyReport.scope === "year" && (
                        <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-100 text-[10px] font-black text-[#B7863D]">全年 12 個月</span>
                      )}
                    </div>
                    <p className="text-[11px] font-bold text-stone-400 mt-1">
                      品牌：{consistencyReport.brandLabel}｜掃描 {Number(consistencyReport.scanned || 0).toLocaleString()} docs｜{consistencyReport.createdAt}
                    </p>
                  </div>
                  <span className={`px-3 py-1.5 rounded-full bg-white border text-[11px] font-black ${
                    consistencyReport.status === "danger"
                      ? "text-rose-600 border-rose-100"
                      : consistencyReport.status === "warning"
                        ? "text-[#B7863D] border-amber-100"
                        : "text-emerald-700 border-emerald-100"
                  }`}>
                    {consistencyReport.status === "danger" ? "發現高風險衝突" : consistencyReport.status === "warning" ? "有資料需確認" : "一致性正常"}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {[
                    ["異常群組", consistencyReport.issueCount, "text-stone-700"],
                    ["高風險衝突", consistencyReport.conflicts, consistencyReport.conflicts ? "text-rose-600" : "text-emerald-600"],
                    ["需確認", consistencyReport.warnings, consistencyReport.warnings ? "text-[#B7863D]" : "text-emerald-600"],
                    ["可整理重複", consistencyReport.safeDuplicates, consistencyReport.safeDuplicates ? "text-[#B7863D]" : "text-emerald-600"],
                    ["Summary 差異", consistencyReport.summaryMismatches, consistencyReport.summaryMismatches ? "text-rose-600" : "text-emerald-600"],
                  ].map(([label, value, tone]) => (
                    <div key={label} className="rounded-2xl border border-stone-100 bg-white/90 p-3">
                      <p className="text-[10px] font-black text-stone-400">{label}</p>
                      <p className={`mt-1 text-lg font-black ${tone}`}>{Number(value || 0).toLocaleString()}</p>
                    </div>
                  ))}
                </div>

                {consistencyReport.scope === "year" && (
                  <div className="rounded-2xl border border-stone-100 bg-white/80 p-3">
                    <div className="flex flex-wrap gap-2 text-[10px] font-black">
                      <span className="px-2.5 py-1 rounded-full bg-stone-50 text-stone-500 border border-stone-100">
                        日報 {Number(consistencyReport.sourceCounts?.daily_reports || 0).toLocaleString()}
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-stone-50 text-stone-500 border border-stone-100">
                        管理師日報 {Number(consistencyReport.sourceCounts?.therapist_daily_reports || 0).toLocaleString()}
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-stone-50 text-stone-500 border border-stone-100">
                        月目標 Summary {Number(consistencyReport.sourceCounts?.monthly_targets_summary || 0).toLocaleString()} / 12
                      </span>
                    </div>
                  </div>
                )}

                {consistencyReport.issues.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-100 bg-white/90 p-4 text-xs font-black text-emerald-700">
                    本次未發現重複、有效值衝突或目標 Summary 不一致。
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
                    {consistencyReport.issues.map((issue) => {
                      const isExpanded = expandedConsistencyIssue === issue.id;
                      return (
                        <div key={issue.id} className={`rounded-2xl border bg-white/95 ${
                          issue.severity === "danger" ? "border-rose-100" : "border-amber-100"
                        }`}>
                          <button
                            type="button"
                            onClick={() => setExpandedConsistencyIssue(isExpanded ? "" : issue.id)}
                            className="w-full p-3 text-left flex flex-col md:flex-row md:items-center md:justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2 py-1 rounded-full text-[10px] font-black border ${
                                  issue.severity === "danger"
                                    ? "bg-rose-50 text-rose-600 border-rose-100"
                                    : "bg-amber-50 text-[#B7863D] border-amber-100"
                                }`}>
                                  {issue.severity === "danger" ? "需處理" : "需確認"}
                                </span>
                                <span className="px-2 py-1 rounded-full text-[10px] font-black border border-stone-100 bg-stone-50 text-stone-500">
                                  {issue.collectionName}
                                </span>
                                <p className="text-xs font-black text-stone-800">{issue.title}</p>
                              </div>
                              <p className="mt-1 text-[10px] font-bold text-stone-400 break-all">Key：{issue.canonicalKey || "-"}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] font-black text-stone-400">{Number(issue.records?.length || 0).toLocaleString()} 筆</span>
                              <ChevronDown size={14} className={`text-stone-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="border-t border-stone-100 p-3 space-y-3">
                              <div className="rounded-xl bg-stone-50/80 p-3">
                                <p className={`text-[11px] font-black ${issue.severity === "danger" ? "text-rose-600" : "text-[#B7863D]"}`}>{issue.reason}</p>
                                <p className="mt-1 text-[10px] font-bold text-stone-500">{issue.recommendation}</p>
                              </div>

                              {Array.isArray(issue.records) && issue.records.length > 0 && (
                                <div className="space-y-2">
                                  {issue.records.map((record, index) => (
                                    <div key={`${issue.id}_${record.id || index}_${index}`} className="rounded-xl border border-stone-100 bg-white p-3">
                                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1">
                                        <p className="text-[11px] font-black text-stone-700">{record.label || "資料文件"}</p>
                                        <span className="text-[10px] font-black text-stone-400 break-all">ID：{record.id || "-"}</span>
                                      </div>
                                      {record.summary && <p className="mt-1 text-[10px] font-bold text-stone-500 break-words">{record.summary}</p>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {Number(consistencyReport.truncatedIssueCount || 0) > 0 && (
                      <p className="text-[10px] font-black text-stone-400 text-center pt-1">
                        另有 {Number(consistencyReport.truncatedIssueCount || 0).toLocaleString()} 組未顯示；請先處理前述高風險項目後重新掃描。
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <ToolRow icon={Calendar} title="月結前檢查" desc="檢查指定月份缺報、重複資料與目標設定。只讀取、不修改資料。" badge="月結流程">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><SmartMonthPicker value={calMonth} onChange={setCalMonth} align="right" buttonClassName="!h-9 !min-w-[140px] !border-0 !bg-transparent !px-0 !py-0 !text-xs !shadow-none hover:!bg-transparent" /></div>
              <BeautyButton onClick={handleRunClosingCheck} disabled={loadingAction !== null} variant="primary">{loadingAction === "closingCheck" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}檢查月結</BeautyButton>
            </ToolRow>
            {closingReport && <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50/30 p-4 space-y-3"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><p className="text-sm font-black text-stone-800">{closingReport.month} 月結前檢查｜{closingReport.readiness || "檢查完成"}</p><p className="text-[11px] font-bold text-stone-400">檢查 {closingReport.checkedDays} 天｜店家 {closingReport.stores}｜排除 {closingReport.excludedStoreCount || 0}｜在職管理師 {closingReport.activeTherapists}</p></div><div className="grid grid-cols-1 md:grid-cols-5 gap-2">{closingReport.warnings.map((item)=><div key={item.label} className="bg-white/90 border border-stone-100 rounded-2xl p-3"><p className="text-[11px] font-black text-stone-400">{item.label}</p><p className={`mt-1 text-xl font-black ${item.neutral ? "text-stone-700" : item.count ? "text-[#B7863D]" : "text-emerald-600"}`}>{item.count.toLocaleString()}</p></div>)}</div></div>}
            <ToolRow icon={Play} title="重新整理月份數據" desc="當原始日報已確認正確，但月份彙整仍不一致時使用。會重新整理指定月份的彙整資料。" badge="進階處理" tone="emerald">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><SmartMonthPicker value={calMonth} onChange={setCalMonth} align="right" buttonClassName="!h-9 !min-w-[140px] !border-0 !bg-transparent !px-0 !py-0 !text-xs !shadow-none hover:!bg-transparent" /></div>
              <BeautyButton onClick={handleCalibrateData} disabled={loadingAction !== null} variant="primary">{loadingAction === "calibrate" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}重新整理</BeautyButton>
            </ToolRow>
            <ToolRow icon={RefreshCw} title="等待整理的月份" desc="查看有哪些歷史月份仍等待系統整理。本月使用即時資料，不應長期留在等待清單。" badge={recalcQueueTotal ? `${recalcQueueTotal.toLocaleString()} 筆待處理` : "Summary 前置"} tone="amber">
              <BeautyButton onClick={handleLoadRecalcQueue} disabled={loadingAction !== null} variant="secondary">
                {loadingAction === "loadRecalcQueue" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                載入等待清單
              </BeautyButton>
              <BeautyButton onClick={handleCleanupRecalcQueueNoise} disabled={loadingAction !== null} variant="secondary">
                {loadingAction === "cleanupRecalcQueue" ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                整理無效待辦
              </BeautyButton>
              <BeautyButton onClick={handleCalibrateAllPendingMonths} disabled={loadingAction !== null || recalcQueueTotal === 0} variant="primary">
                {loadingAction === "calibrateAllQueues" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                校準全部歷史待辦
              </BeautyButton>
            </ToolRow>
            {recalcQueueHealth && recalcQueueHealth.total > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {[
                  ["歷史待修復", recalcQueueHealth.historical, "text-amber-700"],
                  ["本月應整理", recalcQueueHealth.live, "text-rose-600"],
                  ["未來月份", recalcQueueHealth.future, "text-rose-600"],
                  ["格式異常", recalcQueueHealth.invalid, "text-rose-600"],
                  ["可能重複", recalcQueueHealth.duplicate, "text-stone-600"],
                ].map(([label, value, tone]) => (
                  <div key={label} className="rounded-2xl border border-stone-100 bg-white/90 p-3">
                    <p className="text-[10px] font-black text-stone-400">{label}</p>
                    <p className={`mt-1 text-lg font-black ${tone}`}>{Number(value || 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
            {recalcQueueGroups.length > 0 && (
              <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50/30 p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-stone-800">待重新校準月份</p>
                    <p className="text-[11px] font-bold text-stone-400 mt-1">歷史月份會重新整理報表；本月、未來與格式異常資料應使用「整理無效待辦」移出清單。</p>
                  </div>
                  <p className="text-[11px] font-bold text-stone-400">共 {recalcQueueTotal.toLocaleString()} 筆 pending</p>
                </div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {recalcQueueGroups.map((group) => (
                    <div key={group.month} className="bg-white/95 border border-stone-100 rounded-2xl p-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-black text-stone-800">{group.month}</p>
                          {isSelectedCurrentMonth(group.month) && <span className="px-2 py-1 rounded-full bg-rose-50 text-rose-600 border border-rose-100 text-[10px] font-black">本月不應待重算</span>}
                          <span className="px-2 py-1 rounded-full bg-amber-50 text-[#B7863D] border border-amber-100 text-[10px] font-black">{group.count.toLocaleString()} 筆</span>
                          {group.storeCount > 0 && <span className="px-2 py-1 rounded-full bg-stone-50 text-stone-500 border border-stone-100 text-[10px] font-black">店務 {group.storeCount.toLocaleString()}</span>}
                          {group.therapistCount > 0 && <span className="px-2 py-1 rounded-full bg-stone-50 text-stone-500 border border-stone-100 text-[10px] font-black">管理師 {group.therapistCount.toLocaleString()}</span>}
                        </div>
                        <p className="text-[10px] font-bold text-stone-400 mt-1 truncate">來源：{group.sources.join("、") || "-"}｜原因：{group.reasons.join("、") || "-"}｜最近異動：{group.latestAt || "-"}</p>
                      </div>
                      {group.month < todayMonth() ? (
                        <BeautyButton onClick={() => handleCalibrateRecalcMonth(group)} disabled={loadingAction !== null} variant="primary" className="shrink-0">
                          {loadingAction === `calibrateQueue_${group.month}` ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          校準此月份
                        </BeautyButton>
                      ) : (
                        <span className="shrink-0 px-3 py-2 rounded-xl border border-rose-100 bg-rose-50 text-rose-600 text-[10px] font-black">請整理無效待辦</span>
                      )}
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
                      ? `本月仍有 ${Number(summaryStatusReport.pendingCount || 0).toLocaleString()} 筆舊版或異常待辦，來源：${summaryStatusReport.pendingSources?.join("、") || "-"}。本月 Dashboard 以即時明細為準，請先執行「整理無效待辦」。`
                      : `此月份仍有 ${Number(summaryStatusReport.pendingCount || 0).toLocaleString()} 筆 pending 異動，來源：${summaryStatusReport.pendingSources?.join("、") || "-"}。歷史月份建議先執行「校準此月份」或重新建立 Summary 後再比對。`}
                  </div>
                )}
              </div>
            )}
            <ToolRow icon={CheckCircle2} title="月份報表整理" desc="適合月底大量補報、修正後一次執行：重建本月 Summary、立即比對，並清除該月份 pending queue。" badge="營運模式" tone="emerald">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><SmartMonthPicker value={calMonth} onChange={setCalMonth} align="right" buttonClassName="!h-9 !min-w-[140px] !border-0 !bg-transparent !px-0 !py-0 !text-xs !shadow-none hover:!bg-transparent" /></div>
              <BeautyButton onClick={handleMonthEndDashboardSummaryCalibration} disabled={loadingAction !== null} variant="primary">
                {loadingAction === "monthEndSummaryCalibration" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                月結前校準
              </BeautyButton>
            </ToolRow>
            <div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/60 px-4 py-3 text-[11px] font-bold leading-relaxed text-stone-500">
              舊版年度目標補整理與 Target Coverage 修復入口已從一般維護介面退場。目標完整度由現行事件驅動機制維護；歷史修復能力仍保留在後端受控工具，不在日常介面提供。
            </div>
            <ToolRow icon={Database} title="重新整理歷史月份" desc="一般情況使用月份報表整理即可；只有需要單獨重新建立某個歷史月份時才使用。" badge="進階工具" tone="emerald">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><SmartMonthPicker value={calMonth} onChange={setCalMonth} align="right" buttonClassName="!h-9 !min-w-[140px] !border-0 !bg-transparent !px-0 !py-0 !text-xs !shadow-none hover:!bg-transparent" /></div>
              <BeautyButton onClick={handleRebuildDashboardSummary} disabled={loadingAction !== null} variant="primary">
                {loadingAction === "rebuildSummary" ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                重新整理報表
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
            <ToolRow icon={CheckCircle2} title="確認歷史報表數字" desc="一般情況月份報表整理會自動確認；只有需要單獨再次確認數字時才使用。" badge="進階工具" tone="emerald">
              <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><SmartMonthPicker value={calMonth} onChange={setCalMonth} align="right" buttonClassName="!h-9 !min-w-[140px] !border-0 !bg-transparent !px-0 !py-0 !text-xs !shadow-none hover:!bg-transparent" /></div>
              <BeautyButton onClick={handleCompareDashboardSummary} disabled={loadingAction !== null} variant="primary">
                {loadingAction === "compareSummary" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                確認數字
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

        <section className="rounded-[2rem] border border-blue-100 bg-white/95 shadow-[0_18px_55px_rgba(59,130,246,0.05)] overflow-hidden">
          <button type="button" onClick={() => setShowTrafficTools((prev) => !prev)} className="w-full p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-left">
            <SectionTitle eyebrow="次要診斷" title="系統流量觀察" desc="平常不需要開啟。只有讀取費用異常、改版後觀察或要找出高讀取來源時再使用。" icon={Radio} />
            <div className="inline-flex items-center gap-2 text-xs font-black text-blue-600 bg-blue-50 border border-blue-100 rounded-2xl px-3 py-2 w-fit">
              {showTrafficTools ? "收合工具" : "開啟流量觀察"}
              <ChevronDown size={14} className={`transition-transform ${showTrafficTools ? "rotate-180" : ""}`} />
            </div>
          </button>
        </section>

        {showTrafficTools && (
          <>
        <section className="rounded-[2rem] border border-[#EEDFC7] bg-white/95 shadow-[0_22px_70px_rgba(120,90,40,0.05)] overflow-hidden">
          <div className="p-6 border-b border-[#F0E3CF]"><SectionTitle eyebrow="進階資料規模" title="資料量概況與備份紀錄" desc="資料量概況會讀取多個完整資料集合，只在需要盤點資料規模時手動載入；備份紀錄則可用來確認過去匯出。" icon={BarChart3} /></div>
          <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between"><div className="flex items-center gap-2"><BarChart3 size={16} className="text-[#B7863D]" /><span className="text-sm font-black text-stone-700">資料量概況</span></div><button onClick={handleLoadDataVolume} disabled={loadingAction !== null} className="text-[11px] font-black px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-amber-200 disabled:opacity-40 flex items-center gap-1.5">{loadingAction === "dataVolume" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}載入概況</button></div><div className="p-4 space-y-2 max-h-[320px] overflow-y-auto">{dataVolumeRows.length === 0 ? <div className="h-40 flex flex-col items-center justify-center text-stone-300 gap-2"><BarChart3 size={30} /><p className="text-xs font-black">尚未載入資料量</p></div> : dataVolumeRows.map((row)=><div key={row.colName} className="bg-white rounded-2xl border border-stone-100 p-3 flex items-center justify-between gap-3"><div><p className="text-xs font-black text-stone-700">{row.colName}</p><p className="text-[10px] font-bold text-stone-400">本月 {Number(row.monthCount || 0).toLocaleString()} 筆｜封存重複 {row.archivedCount.toLocaleString()} 筆</p></div><p className="text-sm font-black text-[#B7863D]">{row.count.toLocaleString()}</p></div>)}</div></div>
            <div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 overflow-hidden"><div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between"><div className="flex items-center gap-2"><ClipboardList size={16} className="text-[#B7863D]" /><span className="text-sm font-black text-stone-700">備份紀錄</span></div><button onClick={handleLoadBackupRecords} disabled={loadingAction !== null} className="text-[11px] font-black px-3 py-1.5 rounded-xl border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-40 flex items-center gap-1.5">{loadingAction === "backupRecords" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}載入紀錄</button></div><div className="p-4 space-y-2 max-h-[320px] overflow-y-auto">{backupRecords.length === 0 ? <div className="h-40 flex flex-col items-center justify-center text-stone-300 gap-2"><ClipboardList size={30} /><p className="text-xs font-black">尚未載入備份紀錄</p></div> : backupRecords.map((row)=><div key={row.id} className="bg-white rounded-2xl border border-stone-100 p-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-black text-stone-700 truncate">{row.fileName || row.backupType}</p><span className="text-[10px] font-black text-[#B7863D] bg-amber-50 border border-amber-100 rounded-full px-2 py-1">{row.backupType}</span></div><p className="mt-1 text-[10px] font-bold text-stone-400">{row.createdAtText || "—"}｜{row.exportedBy || "—"}｜{Number(row.totalDocs || 0).toLocaleString()} docs</p></div>)}</div></div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-[#EEDFC7] bg-white/95 shadow-[0_22px_70px_rgba(120,90,40,0.05)] overflow-hidden">
          <div className="p-6 border-b border-[#F0E3CF] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"><SectionTitle eyebrow="流量來源" title="系統流量來源" desc="用來判斷晚間讀取增加主要來自哪個功能、資料來源或角色。" icon={Radio} />
            <div className="flex flex-wrap gap-2">{[{ id: "off", label: "關閉", icon: Power }, { id: "local", label: "本機模式", icon: Monitor }, { id: "global", label: "全域上報", icon: Globe2 }].map((mode)=><button key={mode.id} onClick={()=>handleChangeReadTrackerMode(mode.id)} className={`px-4 py-2 rounded-2xl text-xs font-black border flex items-center gap-2 transition-all ${getReadTrackerModeButtonClass(mode.id)}`}><mode.icon size={14} />{mode.label}</button>)}</div>
          </div>
          <div className="p-6 border-b border-[#F0E3CF] bg-[#FFFCF7]"><div className="rounded-[1.75rem] border border-[#EEDFC7] bg-white shadow-sm overflow-hidden"><div className="p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 border-b border-stone-100"><div className="min-w-0"><h3 className="text-sm font-black text-stone-800 flex items-center gap-2"><Clock size={18} className="text-[#B7863D]" />排程式全域上報</h3><p className="text-xs text-stone-400 font-bold mt-1">固定晚間診斷區間，讓每天數據可比較；支援跨日，例如 19:00～07:00。</p></div><div className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-black border ${!scheduleStatus.scheduleEnabled ? "bg-stone-50 text-stone-500 border-stone-200" : scheduleStatus.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-amber-50 text-amber-700 border-amber-100"}`}><CheckCircle2 size={15} />{scheduleStatus.label}｜現在 {scheduleStatus.nowTime}{hasUnsavedScheduleChanges ? "｜排程草稿尚未儲存" : ""}</div></div>
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

          </>
        )}

        <section className="rounded-[2rem] border border-[#EEDFC7] bg-white/95 shadow-[0_22px_70px_rgba(120,90,40,0.05)] overflow-hidden"><button onClick={()=>setShowAdvancedTools((prev)=>!prev)} className="w-full p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-left"><SectionTitle eyebrow="Protected Area" title="高風險資料處理" desc="還原、封存與批次修復都集中在這裡；沒有明確異常時不建議操作。" icon={AlertTriangle} /><div className="inline-flex items-center gap-2 text-xs font-black text-stone-500 bg-stone-50 border border-stone-200 rounded-2xl px-3 py-2 w-fit">{showAdvancedTools ? "收合工具" : "展開工具"}<ChevronDown size={14} className={`transition-transform ${showAdvancedTools ? "rotate-180" : ""}`} /></div></button>
          {showAdvancedTools && <div className="px-6 pb-6 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300"><ToolRow icon={Database} title="日期資料修正" desc="先掃描日期格式異常，再確認是否批次修復為 YYYY-MM-DD。" badge={dateIssues.length ? `${dateIssues.length} 筆預覽` : "兩段式"}><BeautyButton onClick={handleScanDateFormats} disabled={loadingAction !== null} variant="secondary">{loadingAction === "scanDates" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}掃描日期</BeautyButton><BeautyButton onClick={handleFixDateFormats} disabled={loadingAction !== null || dateIssues.length === 0} variant="primary">{loadingAction === "fixDates" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}修復日期</BeautyButton></ToolRow>{dateIssues.length > 0 && <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50/40 p-4 text-xs font-bold text-amber-800 space-y-1"><p className="font-black">日期異常預覽</p>{dateIssues.slice(0,5).map((item)=><p key={`${item.colName}_${item.id}`}>{item.colName}｜{item.store}｜{item.person}｜{item.oldDate} → {item.newDate}</p>)}</div>}
          <ToolRow icon={Scissors} title="重複資料整理" desc="預設只檢測，不再一鍵刪除。確認後會將舊資料標記封存。" badge={duplicateGroups.length ? `${duplicateGroups.length} 組預覽` : "安全版"} tone="rose"><BeautyButton onClick={handleScanDuplicates} disabled={loadingAction !== null} variant="secondary">{loadingAction === "scanDups" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}檢測重複</BeautyButton><BeautyButton onClick={handleArchiveDuplicates} disabled={loadingAction !== null || duplicateGroups.length === 0} variant="soft">{loadingAction === "archiveDups" ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}封存舊資料</BeautyButton></ToolRow>{duplicateGroups.length > 0 && <div className="rounded-[1.5rem] border border-rose-100 bg-rose-50/30 p-4 text-xs font-bold text-rose-700 space-y-1"><p className="font-black">重複資料預覽</p>{duplicateGroups.slice(0,5).map((group)=><p key={`${group.colName}_${group.key}`}>{group.colName}｜{group.date}｜{group.store}｜{group.person}｜保留 1 筆、封存 {group.duplicateIds.length} 筆</p>)}</div>}
          <ToolRow icon={RefreshCw} title="查看與還原封存資料" desc="查看已封存的疑似重複資料，可單筆還原。" badge={archivedDuplicates.length ? `${archivedDuplicates.length} 筆` : "可還原"}><div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white/70 px-3 h-11"><Calendar size={14} className="text-stone-400" /><SmartMonthPicker value={archiveFilterMonth} onChange={setArchiveFilterMonth} align="right" buttonClassName="!h-9 !min-w-[140px] !border-0 !bg-transparent !px-0 !py-0 !text-xs !shadow-none hover:!bg-transparent" /></div><BeautyButton onClick={handleLoadArchivedDuplicates} disabled={loadingAction !== null} variant="secondary">{loadingAction === "loadArchived" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}載入封存</BeautyButton></ToolRow>{archivedDuplicates.length > 0 && <div className="rounded-[1.5rem] border border-stone-100 bg-stone-50/50 p-4 space-y-2 max-h-[340px] overflow-y-auto"><p className="text-xs font-black text-stone-700">封存資料清單</p>{archivedDuplicates.slice(0,30).map((row)=><div key={`${row.colName}_${row.id}`} className="bg-white border border-stone-100 rounded-2xl p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div className="min-w-0"><p className="text-xs font-black text-stone-700 truncate">{row.colName}｜{row.date}｜{row.store}｜{row.person}</p><p className="text-[10px] font-bold text-stone-400 mt-1">保留文件：{row.keepId}｜封存時間：{row.archivedAt}</p></div><BeautyButton onClick={()=>handleRestoreArchivedDuplicate(row)} disabled={loadingAction !== null} variant="soft" className="h-9 px-4 shrink-0">{loadingAction === `restore_${row.id}` ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}還原</BeautyButton></div>)}</div>}</div>}
        </section>

        {showCoreTools && <section className="rounded-[2rem] border border-stone-100 bg-white/90 p-6 shadow-[0_16px_50px_rgba(120,90,40,0.04)]"><ToolRow icon={RefreshCw} title="清除本機快取" desc="只清除目前瀏覽器暫存，不會刪除雲端資料。適合畫面異常、舊版快取或登入狀態卡住時使用。" badge="本機排錯"><BeautyButton onClick={handleClearLocalCache} variant="secondary"><RefreshCw size={14} />清除快取並重載</BeautyButton></ToolRow></section>}

        <section className="rounded-[2rem] border border-stone-100 bg-[#FFFCF7] p-6 shadow-[inset_0_2px_10px_rgba(120,90,40,0.02)]"><div className="flex justify-between items-center mb-4"><div className="flex items-center gap-2 text-stone-600"><ClipboardList size={18} strokeWidth={2} className="text-[#B7863D]" /><span className="font-black tracking-tight text-sm">操作紀錄</span></div><div className="flex items-center gap-3">{loadingAction && <span className="text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-xl font-black animate-pulse flex items-center gap-1.5 border border-amber-100/50"><Loader2 size={14} className="animate-spin" />執行中...</span>}{logs.length > 0 && !loadingAction && <button onClick={()=>setLogs([])} className="text-xs font-black text-stone-400 hover:text-rose-500 transition-colors flex items-center gap-1 px-2 py-1"><Trash2 size={14} />清除</button>}</div></div><div className="bg-white rounded-[1.5rem] p-5 font-mono text-[13px] h-[280px] overflow-y-auto border border-stone-200/50 shadow-sm space-y-2 selection:bg-amber-100">{logs.length === 0 ? <div className="flex h-full items-center justify-center flex-col gap-3 opacity-50"><ClipboardList size={36} className="text-stone-300" strokeWidth={1.5} /><span className="text-xs font-black tracking-widest text-stone-400 uppercase">Ready</span></div> : logs.map((log)=>{ const isError = log.text.includes("❌"); const isFix = log.text.includes("✏️"); const isDel = log.text.includes("🗑️"); const isSuccess = log.text.includes("✅") || log.text.includes("🎉") || log.text.includes("✨") || log.text.includes("🔄") || log.text.includes("↩️"); let textColor = "text-stone-500"; if (isError) textColor = "text-rose-500 font-black"; else if (isFix) textColor = "text-amber-600"; else if (isDel) textColor = "text-stone-400 line-through"; else if (isSuccess) textColor = "text-stone-800 font-black"; return <div key={log.id} className="border-b border-stone-50 pb-2.5 last:border-0 hover:bg-stone-50 rounded px-2 -mx-2 transition-colors flex items-start gap-3"><span className="text-stone-400 shrink-0 select-none pt-0.5">[{log.time}]</span><span className={`${textColor} break-all leading-relaxed`}>{log.text}</span></div>; })}</div></section>
      </div>
    </ViewWrapper>
  );
}
