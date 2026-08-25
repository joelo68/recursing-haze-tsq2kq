// src/components/SystemMonitor.jsx
import React, { useState, useMemo, useContext, useEffect } from "react";
import {
  Smartphone, Monitor, ChevronLeft, ChevronRight, RefreshCw,
  Calendar, Search, RotateCcw, ShieldAlert, ShieldCheck, Laptop, ChevronDown
} from "lucide-react";
import { 
  query, limit, where, Timestamp, getDocs, orderBy, startAfter 
} from "firebase/firestore";

import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";
import DeviceApprovalPanel from "./DeviceApprovalPanel";
import { formatLocalYYYYMMDD } from "../utils/helpers";

const SystemMonitor = () => {
  const {
    getCollectionPath, currentBrand, currentUser, userRole,
    currentDeviceTrust, currentSecurityAccountKey,
    manageDeviceSecurityAction, reviewDeviceApprovalAction, canManageDeviceSecurity
  } = useContext(AppContext);
  
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // ★ 極致效能防護：新增一個開關，預設為 false (不載入資料)
  const [hasQueried, setHasQueried] = useState(false);
  const [activityFilter, setActivityFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [lastQueryInfo, setLastQueryInfo] = useState(null);
  const [monitorMode, setMonitorMode] = useState("logs");
  const [deviceProfiles, setDeviceProfiles] = useState([]);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [deviceHasLoaded, setDeviceHasLoaded] = useState(false);
  const [deviceKeyword, setDeviceKeyword] = useState("");
  const [deviceQuickFilter, setDeviceQuickFilter] = useState("all");
  const canReviewDeviceSecurity = Boolean(canManageDeviceSecurity && currentDeviceTrust?.status === "trusted");
  const [expandedDeviceId, setExpandedDeviceId] = useState(null);
  const [deviceDateRange, setDeviceDateRange] = useState(() => {
    const today = formatLocalYYYYMMDD(new Date());
    return {
      start: today,
      end: today,
    };
  });
  const [deviceLimitCount, setDeviceLimitCount] = useState(50);
  const [deviceActionKey, setDeviceActionKey] = useState("");

  useEffect(() => {
    const handler = () => {
      setMonitorMode("devices");
    };
    window.addEventListener("cyj_open_device_management", handler);
    return () => window.removeEventListener("cyj_open_device_management", handler);
  }, []);

  const todayStr = formatLocalYYYYMMDD(new Date());

  const [uiDateRange, setUiDateRange] = useState({
    start: todayStr,
    end: todayStr
  });

  const [queryDateRange, setQueryDateRange] = useState({
    start: todayStr,
    end: todayStr
  });
  const [logTypeFilter, setLogTypeFilter] = useState("all");
  const [logRoleFilter, setLogRoleFilter] = useState("all");
  const [logUserFilter, setLogUserFilter] = useState("");
  const [logLimitCount, setLogLimitCount] = useState(100);
  const [logCursor, setLogCursor] = useState(null);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);

  const LOG_TYPE_FILTER_LABELS = {
    all: "全部紀錄",
    auth: "登入 / 登出",
    login: "只看登入",
    logout: "只看登出",
    device: "裝置安全",
    page: "頁面瀏覽",
    query: "查詢行為",
    data: "資料異動",
    password: "密碼更新",
  };

  const ROLE_FILTER_LABELS = {
    all: "全部身份",
    director: "高階主管",
    manager: "區長",
    store: "店經理",
    therapist: "管理師",
    trainer: "教專",
    master: "最高管理者",
  };

  const normalizeLogFilterText = (value = "") => String(value || "")
    .toLowerCase()
    .replace(/[　\s]+/g, "")
    .trim();

  const buildLogSearchText = (log = {}) => {
    const details = log.details || {};
    return [
      log.user,
      log.userName,
      log.role,
      log.roleLabel,
      log.action,
      log.activityType,
      log.view,
      log.brand,
      log.brandLabel,
      log.device,
      log.browser,
      log.os,
      log.deviceShort,
      details.user,
      details.userName,
      details.targetUserName,
      details.targetRole,
      details.role,
      details.roleLabel,
      details.message,
      details.viewLabel,
      details.deviceShort,
      ...(Array.isArray(log.riskTags) ? log.riskTags : []),
      ...(Array.isArray(details.riskTags) ? details.riskTags : []),
    ].filter(Boolean).join(" ");
  };

  const logMatchesTypeFilter = (log = {}) => {
    if (logTypeFilter === "all") return true;
    const type = String(log.activityType || log.details?.activityType || "");
    const action = String(log.action || "");

    if (logTypeFilter === "login") return type === "auth.login" || action.includes("登入系統");
    if (logTypeFilter === "logout") return type === "auth.logout" || action.includes("登出系統");
    if (logTypeFilter === "auth") return type === "auth.login" || type === "auth.logout" || action.includes("登入系統") || action.includes("登出系統");
    if (logTypeFilter === "device") return type === "auth.device_check" || type === "auth.device_check_failed" || type === "auth.blocked_device" || action.includes("裝置安全") || action.includes("停用此品牌");
    if (logTypeFilter === "page") return type === "page.view" || action.includes("頁面瀏覽");
    if (logTypeFilter === "query") return type.startsWith("query") || action.includes("查詢");
    if (logTypeFilter === "data") return type.startsWith("data.") || action.includes("修改") || action.includes("更新") || action.includes("刪除") || action.includes("封存") || action.includes("還原");
    if (logTypeFilter === "password") return type === "auth.password_update" || action.includes("密碼") || action.includes("安全更新");
    return true;
  };

  const logMatchesRoleFilter = (log = {}) => {
    if (logRoleFilter === "all") return true;
    const roleText = normalizeLogFilterText([
      log.role,
      log.roleLabel,
      log.details?.role,
      log.details?.roleLabel,
      log.details?.targetRole,
      log.user,
      log.details?.userName,
      log.details?.targetUserName,
    ].filter(Boolean).join(" "));

    if (logRoleFilter === "director") {
      return ["director", "master", "高階", "主管", "董事長", "總經理", "營運長", "總監", "財務"].some((token) => roleText.includes(normalizeLogFilterText(token)));
    }
    if (logRoleFilter === "manager") return roleText.includes("manager") || roleText.includes("區長");
    if (logRoleFilter === "store") return roleText.includes("store") || roleText.includes("店經理") || roleText.includes("店長");
    if (logRoleFilter === "therapist") return roleText.includes("therapist") || roleText.includes("管理師");
    if (logRoleFilter === "trainer") return roleText.includes("trainer") || roleText.includes("教專");
    if (logRoleFilter === "master") return roleText.includes("master") || roleText.includes("最高管理者");
    return true;
  };

  const logMatchesUserFilter = (log = {}) => {
    const target = normalizeLogFilterText(logUserFilter);
    if (!target) return true;
    const userText = normalizeLogFilterText(buildLogSearchText(log));
    return userText.includes(target);
  };

  const applyLogQueryFilters = (items = []) => items.filter((log) => (
    logMatchesTypeFilter(log) &&
    logMatchesRoleFilter(log) &&
    logMatchesUserFilter(log)
  ));

  const getActivityMeta = (log = {}) => {
    const type = String(log.activityType || log.details?.activityType || "");
    const action = String(log.action || "");

    if (type === "auth.device_check" || type === "auth.device_check_failed" || action.includes("裝置安全檢查")) {
      return { key: "auth", label: "裝置檢查", badge: "bg-violet-50 text-violet-700 border border-violet-100" };
    }
    if (type.startsWith("auth.") || action.includes("登入") || action.includes("登出")) {
      return { key: "auth", label: action.includes("登出") ? "登出" : "登入", badge: "bg-emerald-50 text-emerald-700 border border-emerald-100" };
    }
    if (type === "page.view" || action.includes("頁面瀏覽")) {
      return { key: "page", label: "頁面瀏覽", badge: "bg-sky-50 text-sky-700 border border-sky-100" };
    }
    if (type.startsWith("query") || action.includes("查詢")) {
      return { key: "query", label: "查詢", badge: "bg-amber-50 text-amber-700 border border-amber-100" };
    }
    if (type.startsWith("data.") || action.includes("修改") || action.includes("更新") || action.includes("刪除")) {
      return { key: "data", label: action.includes("刪除") ? "資料刪除" : "資料異動", badge: "bg-rose-50 text-rose-700 border border-rose-100" };
    }
    if (type.startsWith("summary") || action.includes("Summary") || action.includes("整理") || action.includes("校準")) {
      return { key: "system", label: "系統維護", badge: "bg-violet-50 text-violet-700 border border-violet-100" };
    }
    return { key: "general", label: "一般操作", badge: "bg-stone-50 text-stone-600 border border-stone-100" };
  };

  const describeLog = (log = {}) => {
    const details = log.details || {};
    if (typeof details === "string") return details;
    if (details.viewLabel) return `進入 ${details.viewLabel}`;
    if (details.tabLabel) return `${details.tabLabel}｜${details.startDate || ""} ~ ${details.endDate || ""}｜${details.filterStore || ""}`;
    if (details.storeName || details.therapistName || details.affectedDate) {
      const subject = [details.storeName, details.therapistName].filter(Boolean).join("｜");
      const changed = details.changedFields ? Object.entries(details.changedFields).slice(0, 3).map(([k, v]) => `${k}: ${v.before}→${v.after}`).join("、") : "";
      return `${details.affectedDate || ""}${subject ? `｜${subject}` : ""}${changed ? `｜${changed}` : ""}`;
    }
    if (details.message) return details.message;
    return JSON.stringify(details || {});
  };

  const fetchLogs = async (rangeOverride = null, options = {}) => {
    const append = Boolean(options.append);
    setLoading(true);
    if (!append) {
      setLogs([]);
      setLogCursor(null);
      setHasMoreLogs(false);
    }
    setExpandedLogId(null);

    const activeRange = rangeOverride || queryDateRange;
    const startDate = new Date(`${activeRange.start}T00:00:00`);
    const endDate = new Date(`${activeRange.end}T23:59:59`);
    const safeLimit = Math.min(Math.max(Number(logLimitCount) || 100, 20), 1000);

    const runLogQuery = async ({ field = "timestamp", useCursor = true } = {}) => {
      const isTimestampField = field === "timestamp";
      const constraints = isTimestampField
        ? [
            where("timestamp", ">=", Timestamp.fromDate(startDate)),
            where("timestamp", "<=", Timestamp.fromDate(endDate)),
            orderBy("timestamp", "desc"),
            limit(safeLimit),
          ]
        : [
            // 舊版或少數異常紀錄可能 timestamp 尚未落地，但 createdAtText 已寫入 ISO 字串。
            // 當 timestamp 查不到資料時，用 createdAtText 做備援，避免登入監控誤判為 0 筆。
            where("createdAtText", ">=", startDate.toISOString()),
            where("createdAtText", "<=", endDate.toISOString()),
            orderBy("createdAtText", "desc"),
            limit(safeLimit),
          ];

      if (append && useCursor && logCursor) {
        constraints.splice(constraints.length - 1, 0, startAfter(logCursor));
      }

      const q = query(getCollectionPath("system_logs"), ...constraints);
      const snapshot = await getDocs(q);
      return { snapshot, sourceField: field };
    };

    try {
      let result = await runLogQuery({ field: "timestamp", useCursor: true });

      // 如果 timestamp 查詢沒有任何結果，改用 createdAtText 備援查詢。
      // 備援只在第一頁啟用，避免 cursor 混用不同欄位造成分頁錯位。
      if (!append && result.snapshot.empty) {
        try {
          const fallbackResult = await runLogQuery({ field: "createdAtText", useCursor: false });
          if (!fallbackResult.snapshot.empty) result = fallbackResult;
        } catch (fallbackError) {
          console.warn("createdAtText 備援查詢失敗，維持 timestamp 查詢結果:", fallbackError?.message || fallbackError);
        }
      }

      let snapshot = result.snapshot;
      let logsData = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      let matchedLogsData = applyLogQueryFilters(logsData);

      // 若 timestamp 有資料但條件過濾後為 0，仍嘗試 createdAtText 備援一次。
      // 這可以相容舊紀錄 timestamp / role / user 欄位落地不一致的情況。
      if (!append && matchedLogsData.length === 0 && result.sourceField === "timestamp") {
        try {
          const fallbackResult = await runLogQuery({ field: "createdAtText", useCursor: false });
          const fallbackLogs = fallbackResult.snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
          const fallbackMatchedLogs = applyLogQueryFilters(fallbackLogs);
          if (fallbackMatchedLogs.length > 0 || logsData.length === 0) {
            result = fallbackResult;
            snapshot = fallbackResult.snapshot;
            logsData = fallbackLogs;
            matchedLogsData = fallbackMatchedLogs;
          }
        } catch (fallbackError) {
          console.warn("createdAtText 條件備援查詢失敗，維持 timestamp 查詢結果:", fallbackError?.message || fallbackError);
        }
      }

      setLogs((prev) => (append ? [...prev, ...matchedLogsData] : matchedLogsData));
      setLogCursor(snapshot.docs.length ? snapshot.docs[snapshot.docs.length - 1] : (append ? logCursor : null));
      setHasMoreLogs(result.sourceField === "timestamp" && snapshot.docs.length >= safeLimit);
      setLastQueryInfo({
        count: matchedLogsData.length,
        rawCount: logsData.length,
        totalCount: append ? logs.length + matchedLogsData.length : matchedLogsData.length,
        readLimit: safeLimit,
        start: activeRange.start,
        end: activeRange.end,
        type: logTypeFilter,
        typeLabel: LOG_TYPE_FILTER_LABELS[logTypeFilter] || logTypeFilter,
        role: logRoleFilter,
        roleLabel: ROLE_FILTER_LABELS[logRoleFilter] || logRoleFilter,
        user: logUserFilter.trim(),
        sourceField: result.sourceField,
        clientFiltered: logTypeFilter !== "all" || logRoleFilter !== "all" || Boolean(logUserFilter.trim()),
        append,
        queriedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      });
    } catch (error) {
      console.error("Fetch logs error:", error);
      setLastQueryInfo({
        count: 0,
        error: error.message,
        queriedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchDeviceProfiles = async () => {
    setDeviceLoading(true);
    setExpandedDeviceId(null);
    try {
      const q = query(getCollectionPath("account_devices"), limit(Number(deviceLimitCount) || 50));
      const snapshot = await getDocs(q);
      const startTime = new Date(`${deviceDateRange.start}T00:00:00`).getTime();
      const endTime = new Date(`${deviceDateRange.end}T23:59:59`).getTime();

      const profiles = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() || {};
        const rawDeviceList = Object.values(data.devices || {}).map((device) => ({
          ...device,
          deviceShort: device.deviceShort || String(device.deviceId || "").replace(/^dev_/, "").slice(-8),
        }));

        const deviceList = rawDeviceList.filter((device) => {
          const timeText = device.lastSeenAtText || device.firstSeenAtText || "";
          const time = timeText ? new Date(timeText).getTime() : 0;
          if (!time || Number.isNaN(time)) return true;
          return time >= startTime && time <= endTime;
        });

        const trustedCount = deviceList.filter((d) => d.trusted !== false && d.status !== "new").length;
        const newCount = deviceList.filter((d) => d.trusted === false || ["new", "observing", "reverify_required", "suspicious", "blocked", "global_blocked"].includes(d.status)).length;
        const lastSeenText = deviceList
          .map((d) => d.lastSeenAtText || d.firstSeenAtText || "")
          .filter(Boolean)
          .sort()
          .pop() || "";

        return {
          id: docSnap.id,
          ...data,
          deviceList: deviceList.sort((a, b) => String(b.lastSeenAtText || b.firstSeenAtText || "").localeCompare(String(a.lastSeenAtText || a.firstSeenAtText || ""))),
          trustedCount,
          newCount,
          lastSeenText,
        };
      }).filter((profile) => (profile.deviceList || []).length > 0);

      profiles.sort((a, b) => String(b.lastSeenText || "").localeCompare(String(a.lastSeenText || "")));
      setDeviceProfiles(profiles);
    } catch (error) {
      console.error("Fetch account devices error:", error);
      alert("裝置資料讀取失敗：" + error.message);
    } finally {
      setDeviceHasLoaded(true);
      setDeviceLoading(false);
    }
  };

  const isPendingDevice = (device = {}) => {
    return (
      device.trusted === false ||
      ["new", "observing", "reverify_required", "suspicious", "blocked", "global_blocked"].includes(device.status) ||
      ["manual_observing", "manual_reverify_required", "manual_suspicious", "manual_blocked", "manual_global_blocked", "self_reported_not_me"].includes(device.source)
    );
  };

  const isMobileDevice = (device = {}) => {
    const deviceText = String(device.device || "").toLowerCase();
    const osText = String(device.os || "").toLowerCase();
    const uaText = String(device.userAgent || device.ua || "").toLowerCase();

    if (deviceText === "pc" || deviceText === "mac" || osText.includes("windows") || osText.includes("mac") || uaText.includes("macintosh")) return false;

    return (
      deviceText.includes("mobile") ||
      deviceText.includes("tablet") ||
      deviceText.includes("ios") ||
      deviceText.includes("android") ||
      deviceText.includes("iphone") ||
      deviceText.includes("ipad") ||
      osText.includes("ios") ||
      osText.includes("android") ||
      uaText.includes("iphone") ||
      uaText.includes("ipad") ||
      uaText.includes("android")
    );
  };

  const getFilteredDeviceListByQuickFilter = (deviceList = []) => {
    if (deviceQuickFilter === "pending") return deviceList.filter(isPendingDevice);
    if (deviceQuickFilter === "mobile") return deviceList.filter(isMobileDevice);
    return deviceList;
  };

  const handleDeviceQuickFilter = (nextFilter) => {
    setDeviceQuickFilter((prev) => (prev === nextFilter ? "all" : nextFilter));
    setExpandedDeviceId(null);
  };

  const filteredDeviceProfiles = useMemo(() => {
    const key = deviceKeyword.trim().toLowerCase();

    return deviceProfiles
      .map((profile) => {
        const filteredDeviceList = getFilteredDeviceListByQuickFilter(profile.deviceList || []);
        if (filteredDeviceList.length === 0) return null;

        const text = [
          profile.userName,
          profile.accountId,
          profile.role,
          profile.brandLabel,
          profile.id,
          ...(filteredDeviceList || []).flatMap((device) => [
            device.device,
            device.browser,
            device.os,
            device.deviceShort,
            device.status,
            device.source,
            typeof device.lastLoginLocation === "string" ? device.lastLoginLocation : device.lastLoginLocation?.display,
            typeof device.loginLocation === "string" ? device.loginLocation : device.loginLocation?.display,
            typeof device.firstLoginLocation === "string" ? device.firstLoginLocation : device.firstLoginLocation?.display,
            typeof device.location === "string" ? device.location : device.location?.display,
          ]),
        ].join(" ").toLowerCase();

        if (key && !text.includes(key)) return null;

        const trustedCount = filteredDeviceList.filter((d) => d.trusted !== false && d.status !== "new").length;
        const newCount = filteredDeviceList.filter(isPendingDevice).length;
        const lastSeenText = filteredDeviceList
          .map((d) => d.lastSeenAtText || d.firstSeenAtText || "")
          .filter(Boolean)
          .sort()
          .pop() || "";

        return {
          ...profile,
          deviceList: filteredDeviceList,
          trustedCount,
          newCount,
          lastSeenText,
        };
      })
      .filter(Boolean);
  }, [deviceProfiles, deviceKeyword, deviceQuickFilter]);

  const deviceSummary = useMemo(() => {
    const totalDevices = deviceProfiles.reduce((sum, item) => sum + (item.deviceList?.length || 0), 0);
    const newDevices = deviceProfiles.reduce((sum, item) => sum + (item.newCount || 0), 0);
    const mobileDevices = deviceProfiles.reduce((sum, item) => sum + (item.deviceList || []).filter(isMobileDevice).length, 0);
    return {
      accounts: deviceProfiles.length,
      totalDevices,
      newDevices,
      mobileDevices,
    };
  }, [deviceProfiles]);

  const formatDeviceTime = (value) => {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleString("zh-TW", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return value;
    }
  };

  const getLoginLocationDisplay = (device = {}) => {
    const location =
      device.lastLoginLocation ||
      device.loginLocation ||
      device.firstLoginLocation ||
      device.location ||
      null;

    if (!location) return "未知位置";
    if (typeof location === "string") return location || "未知位置";
    return location.display || [location.countryName, location.city, location.district].filter(Boolean).join("・") || "未知位置";
  };

  const getLogLoginLocationDisplay = (log = {}) => {
    const location =
      log.loginLocation ||
      log.details?.loginLocation ||
      log.details?.deviceInfo?.loginLocation ||
      null;

    if (!location) return "未知位置";
    if (typeof location === "string") return location || "未知位置";
    return location.display || [location.countryName, location.city, location.district].filter(Boolean).join("・") || "未知位置";
  };

  const getDeviceDisplayName = (device = {}) => {
    const rawDevice = String(device.device || "").trim();
    const os = String(device.os || "").toLowerCase();
    const ua = String(device.userAgent || device.ua || "").toLowerCase();
    const rawLower = rawDevice.toLowerCase();

    const isIPad =
      os.includes("ipados") ||
      ua.includes("ipad") ||
      rawLower.includes("ipad");

    const isIPhone =
      ua.includes("iphone") ||
      rawLower.includes("iphone") ||
      (os.includes("ios") && !isIPad);

    const isAndroid = os.includes("android") || ua.includes("android");
    const isAndroidTablet =
      isAndroid &&
      (
        rawLower.includes("tablet") ||
        ua.includes("tablet") ||
        !ua.includes("mobile")
      );

    const isAndroidPhone =
      isAndroid &&
      (
        rawLower.includes("mobile") ||
        ua.includes("mobile") ||
        !isAndroidTablet
      );

    // iPadOS 13+ 有時會偽裝成 Macintosh，但通常仍可從 UA / 裝置名稱辨識 iPad。
    if (isIPad) return "iPad";
    if (isIPhone) return "iPhone";

    if (os.includes("mac") || ua.includes("macintosh")) return "MAC";

    if (isAndroidTablet) return "Android 平板";
    if (isAndroidPhone) return "Android 手機";

    if (os.includes("windows") || ua.includes("windows")) return "PC";
    if (os.includes("chrome os") || os.includes("cros") || ua.includes("cros")) return "Chromebook";
    if (os.includes("linux") || ua.includes("linux")) return "Linux";

    if (rawDevice === "PC") return "PC";
    if (rawDevice === "Mobile") return "手機";
    if (rawDevice === "Tablet") return "平板";

    return rawDevice || "裝置";
  };

  const getLogDeviceDisplayName = (log = {}) => {
    return getDeviceDisplayName({
      device: log.device || log.details?.deviceInfo?.device || log.details?.device || "",
      os: log.os || log.details?.deviceInfo?.os || log.details?.os || "",
      browser: log.browser || log.details?.deviceInfo?.browser || log.details?.browser || "",
      userAgent: log.userAgent || log.details?.deviceInfo?.userAgent || log.details?.userAgent || "",
    });
  };

  const getLogDeviceShortLabel = (displayName = "") => {
    if (displayName === "Android 手機") return "Android";
    if (displayName === "Android 平板") return "平板";
    if (displayName === "Chromebook") return "ChromeOS";
    return displayName || "裝置";
  };

  const getLogDeviceIcon = (log = {}) => {
    const displayName = getLogDeviceDisplayName(log);
    const shortLabel = getLogDeviceShortLabel(displayName);

    const isMobile =
      displayName === "iPhone" ||
      displayName === "Android 手機" ||
      displayName === "手機";

    const isTablet =
      displayName === "iPad" ||
      displayName === "Android 平板" ||
      displayName === "平板";

    const Icon = isMobile || isTablet ? Smartphone : Monitor;
    const toneClass = isMobile || isTablet ? "text-stone-500" : "text-stone-400";

    return (
      <div
        className={`inline-flex items-center gap-1 ${toneClass} bg-stone-50 px-1.5 lg:px-2 py-1 rounded-lg text-xs whitespace-nowrap max-w-[82px] overflow-hidden`}
        title={displayName}
      >
        <Icon size={12} className="shrink-0" />
        <span className="truncate min-w-0">{shortLabel}</span>
      </div>
    );
  };

  const getDeviceTrustMeta = (device = {}) => {
    if (device.source === "manual_global_blocked" || device.status === "global_blocked") {
      return { label: "所有品牌皆停用", className: "bg-stone-100 text-stone-800 border-stone-300" };
    }
    if (device.status === "blocked" || device.source === "manual_blocked") {
      return { label: "此品牌已停用", className: "bg-stone-100 text-stone-700 border-stone-200" };
    }
    if (device.status === "reverify_required" || device.source === "manual_reverify_required") {
      return { label: "要求重新驗證", className: "bg-orange-50 text-orange-700 border-orange-100" };
    }
    if (device.status === "observing" || device.source === "manual_observing") {
      return { label: "繼續觀察", className: "bg-amber-50 text-amber-700 border-amber-100" };
    }
    if (device.status === "suspicious" || device.source === "manual_suspicious" || device.source === "self_reported_not_me") {
      return { label: "需要主管確認", className: "bg-rose-50 text-rose-700 border-rose-100" };
    }
    if (device.trusted === false || device.status === "new") {
      return { label: "等待確認", className: "bg-rose-50 text-rose-600 border-rose-100" };
    }
    return { label: "已信任", className: "bg-emerald-50 text-emerald-700 border-emerald-100" };
  };

  const updateDeviceTrust = async (profile, device, nextStatus) => {
    if (!profile?.id || !device?.deviceId) return;
    if (!canReviewDeviceSecurity) {
      alert(canManageDeviceSecurity ? "請改用已信任的裝置進行這項操作。" : "此功能僅限最高管理者使用。");
      return;
    }

    const actionKey = `${profile.id}_${device.deviceId}_${nextStatus}`;
    setDeviceActionKey(actionKey);
    try {
      const result = await manageDeviceSecurityAction?.(profile, device, nextStatus);
      if (!result?.ok) throw new Error(result?.message || "裝置狀態更新失敗");
      const nextDevice = result.device || device;
      setDeviceProfiles((prev) => prev.map((item) => {
        if (item.id !== profile.id) return item;
        const deviceList = (item.deviceList || []).map((row) => row.deviceId === device.deviceId ? nextDevice : row);
        return {
          ...item,
          deviceList,
          trustedCount: deviceList.filter((row) => !isPendingDevice(row)).length,
          newCount: deviceList.filter(isPendingDevice).length,
        };
      }));

      try {
        window.dispatchEvent(new CustomEvent("cyj_device_trust_updated", {
          detail: {
            deviceId: nextDevice.deviceId,
            deviceShort: nextDevice.deviceShort,
            trusted: nextDevice.trusted,
            status: nextDevice.status,
            source: nextDevice.source,
            reviewedBy: nextDevice.reviewedBy,
            reviewedAtText: nextDevice.reviewedAtText,
            resolvedPending: nextDevice.status === "trusted",
            globalBlocked: nextDevice.status === "global_blocked",
          },
        }));
      } catch (eventError) {
        console.warn("裝置狀態同步事件發送失敗:", eventError);
      }
    } catch (error) {
      console.error("更新裝置狀態失敗:", error);
      alert(error.message || "裝置狀態更新失敗，請稍後再試。");
    } finally {
      setDeviceActionKey("");
    }
  };

  const filteredLogs = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return logs.filter((log) => {
      const meta = getActivityMeta(log);
      if (activityFilter !== "all" && meta.key !== activityFilter) return false;
      if (!key) return true;
      const text = [log.user, log.role, log.action, log.device, log.browser, log.os, log.deviceShort, (log.riskTags || []).join(" "), meta.label, describeLog(log), JSON.stringify(log.details || {})].join(" ").toLowerCase();
      return text.includes(key);
    });
  }, [logs, activityFilter, keyword]);

  const summary = useMemo(() => {
    const result = { authUsers: new Set(), loginCount: 0, pageCount: 0, queryCount: 0, dataCount: 0, mobileCount: 0 };
    logs.forEach((log) => {
      const meta = getActivityMeta(log);
      if (meta.key === "auth" && String(log.action || "").includes("登入")) {
        result.loginCount += 1;
        if (log.user) result.authUsers.add(log.user);
      }
      if (meta.key === "page") result.pageCount += 1;
      if (meta.key === "query") result.queryCount += 1;
      if (meta.key === "data") result.dataCount += 1;
      if (["iOS", "Android", "Mobile"].includes(log.device)) result.mobileCount += 1;
    });
    return {
      loginUsers: result.authUsers.size,
      loginCount: result.loginCount,
      pageCount: result.pageCount,
      queryCount: result.queryCount,
      dataCount: result.dataCount,
      mobileRate: logs.length ? Math.round((result.mobileCount / logs.length) * 100) : 0,
    };
  }, [logs]);

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage) || 1;
  const currentData = filteredLogs.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  
  const formatTime = (ts) => {
    if (!ts) return "-";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return `${date.getMonth() + 1}/${date.getDate()} ${date
      .getHours()
      .toString()
      .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case "director":
        return <span className="inline-flex bg-rose-50 text-rose-600 px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap">高階</span>;
      case "manager":
        return <span className="inline-flex bg-teal-50 text-teal-600 px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap">區長</span>;
      case "store":
        return <span className="inline-flex bg-amber-50 text-amber-600 px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap">店經理</span>;
      case "therapist":
        return <span className="inline-flex bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap">管理師</span>;
      default:
        return <span className="inline-flex bg-stone-50 text-stone-500 px-2.5 py-1 rounded-lg text-xs whitespace-nowrap">未知</span>;
    }
  };

  const getDeviceIcon = (device) =>
    device === "iOS" || device === "Android" || device === "Mobile" ? (
      <div className="inline-flex items-center gap-1 text-stone-500 bg-stone-50 px-2 py-1 rounded-lg text-xs whitespace-nowrap">
        <Smartphone size={12} /> {device}
      </div>
    ) : (
      <div className="inline-flex items-center gap-1 text-stone-400 bg-stone-50 px-2 py-1 rounded-lg text-xs whitespace-nowrap">
        <Monitor size={12} /> PC
      </div>
    );

  const getSecurityBadges = (log = {}) => {
    const details = log.details || {};
    const tags = Array.isArray(log.riskTags) && log.riskTags.length > 0
      ? log.riskTags
      : (Array.isArray(details.riskTags) ? details.riskTags : []);

    const badges = [];

    if (log.isNewDevice || details.isNewDevice || tags.includes("新裝置")) {
      badges.push({
        key: "new-device",
        label: "新裝置",
        className: "bg-rose-50 text-rose-600 border border-rose-100",
        icon: <ShieldAlert size={12} />,
      });
    }

    if (tags.includes("初始信任裝置") || details.autoTrusted) {
      badges.push({
        key: "trusted-device",
        label: "初始信任",
        className: "bg-emerald-50 text-emerald-600 border border-emerald-100",
        icon: <ShieldCheck size={12} />,
      });
    }

    return badges;
  };

  const handleExecuteQuery = () => {
    const nextRange = { ...uiDateRange };
    setCurrentPage(1);
    setQueryDateRange(nextRange);
    setHasQueried(true);
    setActivityFilter("all");
    fetchLogs(nextRange, { append: false });
  };

  const handleLoadMoreLogs = () => {
    setCurrentPage(1);
    fetchLogs(queryDateRange, { append: true });
  };

  const handleResetQuery = () => {
    setUiDateRange({ start: todayStr, end: todayStr });
    setQueryDateRange({ start: todayStr, end: todayStr });
    setHasQueried(false); // ★ 重置時關閉開關，清空畫面
    setCurrentPage(1);
    setLogs([]);
    setKeyword("");
    setActivityFilter("all");
    setLogTypeFilter("all");
    setLogRoleFilter("all");
    setLogUserFilter("");
    setLogLimitCount(100);
    setLogCursor(null);
    setHasMoreLogs(false);
    setExpandedLogId(null);
    setLastQueryInfo(null);
  };

  return (
    <ViewWrapper>
      <div className="space-y-6 pb-20 w-full max-w-full min-w-0 overflow-x-hidden">
        <Card className="!overflow-visible z-30 relative w-full max-w-full min-w-0">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4 w-full max-w-full min-w-0">
            <div>
              <h3 className="text-lg font-bold text-stone-700">{monitorMode === "logs" ? "系統操作日誌" : monitorMode === "approvals" ? "待確認裝置" : "裝置登入管理"} ({currentBrand.label})</h3>
              <p className="text-xs text-stone-400">{monitorMode === "logs" ? "追蹤系統內的所有操作紀錄" : monitorMode === "approvals" ? "集中處理目前正在等待確認的新裝置" : "查看帳號已記錄的常用裝置與新裝置狀態"}</p>
            </div>
            
            <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white p-1 shadow-sm">
              <button type="button" onClick={() => setMonitorMode("logs")} className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${monitorMode === "logs" ? "bg-[#EFD399] text-[#6A4D26] shadow-sm" : "text-stone-500 hover:bg-stone-50"}`}>操作日誌</button>
              <button type="button" onClick={() => setMonitorMode("approvals")} className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${monitorMode === "approvals" ? "bg-[#EFD399] text-[#6A4D26] shadow-sm" : "text-stone-500 hover:bg-stone-50"}`}>待確認裝置</button>
              <button type="button" onClick={() => setMonitorMode("devices")} className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${monitorMode === "devices" ? "bg-[#EFD399] text-[#6A4D26] shadow-sm" : "text-stone-500 hover:bg-stone-50"}`}>裝置管理</button>
            </div>

            {monitorMode === "logs" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[auto_auto_auto_auto_auto_auto] items-end gap-2 bg-stone-50 p-2 rounded-xl border border-stone-200 relative z-50 w-full xl:w-auto max-w-full min-w-0">
              <div className="flex flex-col gap-1 sm:col-span-2 xl:col-span-1">
                <span className="text-[11px] font-black text-stone-400 flex items-center gap-1"><Calendar size={13} /> 日期區間</span>
                <div className="flex items-center gap-2">
                  <div className="relative w-full sm:w-36 min-w-0">
                    <SmartDatePicker
                      selectedDate={uiDateRange.start}
                      onDateSelect={(val) => setUiDateRange(prev => {
                        const newEnd = val > prev.end ? val : prev.end;
                        return { start: val, end: newEnd };
                      })}
                      maxDate={todayStr}
                    />
                  </div>
                  <span className="text-stone-300">~</span>
                  <div className="relative w-full sm:w-36 min-w-0">
                    <SmartDatePicker
                      selectedDate={uiDateRange.end}
                      onDateSelect={(val) => setUiDateRange(prev => ({ ...prev, end: val }))}
                      align="right"
                      minDate={uiDateRange.start}
                      maxDate={todayStr}
                    />
                  </div>
                </div>
              </div>

              <label className="flex flex-col gap-1 min-w-0">
                <span className="text-[11px] font-black text-stone-400">紀錄類型</span>
                <select value={logTypeFilter} onChange={(e) => setLogTypeFilter(e.target.value)} className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm font-black text-stone-600 outline-none focus:border-amber-300">
                  <option value="all">全部紀錄</option>
                  <option value="auth">登入 / 登出</option>
                  <option value="login">只看登入</option>
                  <option value="logout">只看登出</option>
                  <option value="device">裝置安全</option>
                  <option value="page">頁面瀏覽</option>
                  <option value="query">查詢行為</option>
                  <option value="data">資料異動</option>
                  <option value="password">密碼更新</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 min-w-0">
                <span className="text-[11px] font-black text-stone-400">身份</span>
                <select value={logRoleFilter} onChange={(e) => setLogRoleFilter(e.target.value)} className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm font-black text-stone-600 outline-none focus:border-amber-300">
                  <option value="all">全部身份</option>
                  <option value="director">高階主管</option>
                  <option value="manager">區長</option>
                  <option value="store">店經理</option>
                  <option value="therapist">管理師</option>
                  <option value="trainer">教專</option>
                  <option value="master">最高管理者</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 min-w-0">
                <span className="text-[11px] font-black text-stone-400">特定人員</span>
                <input value={logUserFilter} onChange={(e) => setLogUserFilter(e.target.value)} placeholder="輸入姓名或關鍵字" className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-600 outline-none focus:border-amber-300" />
              </label>

              <label className="flex flex-col gap-1 min-w-0">
                <span className="text-[11px] font-black text-stone-400">讀取數量</span>
                <select value={logLimitCount} onChange={(e) => setLogLimitCount(Number(e.target.value))} className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm font-black text-stone-600 outline-none focus:border-amber-300">
                  <option value={50}>50 筆</option>
                  <option value={100}>100 筆</option>
                  <option value={300}>300 筆</option>
                  <option value={500}>500 筆</option>
                  <option value={1000}>1000 筆</option>
                </select>
              </label>

              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={handleExecuteQuery}
                  className="h-10 flex-1 sm:flex-none px-4 bg-stone-800 text-white rounded-xl text-sm font-bold flex gap-2 hover:bg-stone-900 transition-colors shadow-sm items-center justify-center whitespace-nowrap active:scale-95"
                >
                  <Search size={16} /> 查詢
                </button>
                <button
                  onClick={handleResetQuery}
                  title="重置為今天"
                  className="h-10 px-3 bg-white border border-stone-200 text-stone-500 rounded-xl hover:bg-stone-50 transition-colors shadow-sm flex items-center justify-center"
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            </div>
            )}
          </div>


          {monitorMode === "logs" && hasQueried && (
            <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 w-full max-w-full min-w-0">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/55 px-4 py-3 min-w-0">
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <p className="text-xs font-black text-emerald-700 whitespace-nowrap truncate">登入人數 / 次數</p>
                  <p className="text-2xl xl:text-[26px] leading-none font-black text-emerald-700 whitespace-nowrap">{summary.loginUsers} / {summary.loginCount}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/55 px-4 py-3 min-w-0">
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <p className="text-xs font-black text-sky-700 whitespace-nowrap truncate">頁面瀏覽</p>
                  <p className="text-2xl xl:text-[26px] leading-none font-black text-sky-700 whitespace-nowrap">{summary.pageCount}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-amber-50/55 px-4 py-3 min-w-0">
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <p className="text-xs font-black text-amber-700 whitespace-nowrap truncate">查詢行為</p>
                  <p className="text-2xl xl:text-[26px] leading-none font-black text-amber-700 whitespace-nowrap">{summary.queryCount}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-rose-100 bg-rose-50/55 px-4 py-3 min-w-0">
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <p className="text-xs font-black text-rose-700 whitespace-nowrap truncate">資料異動</p>
                  <p className="text-2xl xl:text-[26px] leading-none font-black text-rose-700 whitespace-nowrap">{summary.dataCount}</p>
                </div>
              </div>
            </div>
          )}

          {monitorMode === "logs" && hasQueried && (
            <div className="mb-4 flex flex-col xl:flex-row gap-3 xl:items-center justify-between rounded-2xl border border-stone-100 bg-stone-50/70 p-3 w-full max-w-full min-w-0 overflow-hidden">
              <div className="flex flex-wrap gap-2 min-w-0">
                {[
                  ["all", "全部"],
                  ["auth", "登入 / 登出"],
                  ["page", "頁面瀏覽"],
                  ["query", "查詢"],
                  ["data", "資料異動"],
                  ["system", "系統維護"],
                ].map(([key, label]) => (
                  <button key={key} type="button" onClick={() => { setActivityFilter(key); setCurrentPage(1); }} className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-black border transition-all whitespace-nowrap ${activityFilter === key ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-500 border-stone-200 hover:bg-stone-100"}`}>{label}</button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input value={keyword} onChange={(e) => { setKeyword(e.target.value); setCurrentPage(1); }} placeholder="搜尋使用者、動作、店家..." className="h-9 w-full xl:w-64 rounded-xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-600 outline-none focus:border-amber-300 min-w-0" />
                {lastQueryInfo && <span className="hidden xl:inline text-[11px] font-bold text-stone-400 whitespace-nowrap">已載入 {logs.length || 0} 筆｜本次顯示 {lastQueryInfo.count || 0} / 讀取 {lastQueryInfo.rawCount ?? lastQueryInfo.count ?? 0} 筆｜上限 {lastQueryInfo.readLimit || logLimitCount}{lastQueryInfo.sourceField === "createdAtText" ? "｜備援欄位" : ""}｜{lastQueryInfo.queriedAt}</span>}
              </div>
            </div>
          )}

          {monitorMode === "logs" && hasQueried && (logTypeFilter !== "all" || logRoleFilter !== "all" || logUserFilter.trim()) && (
            <div className="mb-4 rounded-2xl border border-amber-100 bg-amber-50/50 px-4 py-3 text-xs font-bold text-amber-700">
              已套用查詢條件：
              {logTypeFilter !== "all" && <span className="ml-1">類型 {LOG_TYPE_FILTER_LABELS[logTypeFilter] || logTypeFilter}</span>}
              {logRoleFilter !== "all" && <span className="ml-2">身份 {ROLE_FILTER_LABELS[logRoleFilter] || logRoleFilter}</span>}
              {logUserFilter.trim() && <span className="ml-2">人員 {logUserFilter.trim()}</span>}
              <span className="ml-2 text-amber-500">系統會先依日期區間讀取，再用相容條件過濾；若查不到較早紀錄，請提高讀取數量或按「載入更多」。</span>
            </div>
          )}

          {/* ★ 畫面呈現邏輯：尚未查詢 -> 讀取中 -> 顯示表格 */}
          {monitorMode === "logs" && (
            !hasQueried ? (
            <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-stone-50/50 rounded-2xl border-2 border-dashed border-stone-200">
              <ShieldAlert size={48} className="text-stone-300 mb-4" />
              <h4 className="text-stone-500 font-bold text-lg mb-2 tracking-wide">日誌查詢待命區</h4>
              <p className="text-stone-400 text-sm max-w-sm">
                系統日誌資料量龐大，為保護系統效能與節省雲端資源，進入此頁面時不會預先載入資料。<br/><br/>
                請在上方設定好日期、類型、人員與讀取數量後，點擊「<strong className="text-stone-600">查詢</strong>」以調閱紀錄。
              </p>
            </div>
          ) : loading && logs.length === 0 ? (
            <div className="space-y-4 p-4 text-center text-stone-400 py-20">
              <RefreshCw className="animate-spin mx-auto mb-2" size={32} />
              <p className="font-bold tracking-widest">資料調閱中...</p>
            </div>
          ) : (
            <>
              <div className="w-full max-w-full min-w-0 relative z-10">
                {/* 手機：卡片式；避免小螢幕硬塞表格 */}
                <div className="md:hidden space-y-3">
                  {currentData.map((log) => {
                    const meta = getActivityMeta(log);
                    const desc = describeLog(log);
                    const securityBadges = getSecurityBadges(log);
                    const isExpanded = expandedLogId === log.id;
                    return (
                      <div
                        key={log.id}
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm active:scale-[0.99] transition-all max-w-full min-w-0"
                      >
                        <div className="flex items-start justify-between gap-3 min-w-0">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs text-stone-400 whitespace-nowrap">{formatTime(log.timestamp)}</span>
                              {getLogDeviceIcon(log)}
                              {getRoleBadge(log.role)}
                              {securityBadges.map((badge) => (
                                <span key={badge.key} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold whitespace-nowrap ${badge.className}`}>
                                  {badge.icon}{badge.label}
                                </span>
                              ))}
                            </div>
                            <p className="mt-2 font-black text-stone-700 truncate">{log.user}</p>
                          </div>
                          <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap ${meta.badge}`}>
                            {meta.label}
                          </span>
                        </div>

                        <div className="mt-3 rounded-xl bg-stone-50/70 px-3 py-2 min-w-0">
                          <p className="text-sm font-black text-stone-700 truncate">{log.action}</p>
                          <p className="mt-1 text-xs text-stone-500 break-words">{desc}</p>
                        </div>

                        {isExpanded && (
                          <div className="mt-3 rounded-2xl bg-white border border-stone-100 p-3 text-xs text-stone-600 leading-relaxed min-w-0">
                            <div className="grid grid-cols-1 gap-2 mb-3">
                              <div><span className="font-black text-stone-400">來源頁面：</span>{log.details?.viewLabel || log.details?.view || log.view || "-"}</div>
                              <div><span className="font-black text-stone-400">品牌：</span>{log.brandLabel || log.brand || "-"}</div>
                              <div><span className="font-black text-stone-400">事件：</span>{log.activityType || log.details?.activityType || "-"}</div>
                              <div><span className="font-black text-stone-400">登入位置：</span>{getLogLoginLocationDisplay(log)}</div>
                              <div><span className="font-black text-stone-400">裝置：</span>{[getLogDeviceDisplayName(log), log.browser, log.os].filter(Boolean).join(" / ") || "-"}</div>
                              <div><span className="font-black text-stone-400">裝置碼：</span>{log.deviceShort || log.details?.deviceShort || "-"}</div>
                            </div>
                            <pre className="whitespace-pre-wrap break-words rounded-xl bg-stone-50 border border-stone-100 p-3 text-[11px] max-h-64 overflow-auto max-w-full">{JSON.stringify(log.details || {}, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {currentData.length === 0 && (
                    <div className="p-10 text-center text-stone-400 font-bold rounded-2xl border border-stone-100 bg-white">
                      在此日期範圍內無相關紀錄
                    </div>
                  )}
                </div>

                {/* 平板 / 桌機：維持表格呈現，不用超大 min-width，避免撐出瀏覽器 */}
                <div className="hidden md:block w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-stone-100 bg-white">
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead className="bg-stone-50/70 text-stone-400 font-bold text-xs tracking-wider border-b border-stone-100">
                      <tr>
                        <th className="px-3 py-4 w-[11%] whitespace-nowrap">時間</th>
                        <th className="px-2 py-4 w-[9%] whitespace-nowrap">裝置</th>
                        <th className="px-2 py-4 w-[8%] whitespace-nowrap">身份</th>
                        <th className="px-3 py-4 w-[13%] whitespace-nowrap">使用者</th>
                        <th className="px-2 py-4 w-[10%] whitespace-nowrap">類型</th>
                        <th className="px-3 py-4 w-[13%] whitespace-nowrap">動作</th>
                        <th className="px-3 py-4 w-[36%] whitespace-nowrap">詳細內容</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50 text-sm bg-white">
                      {currentData.map((log) => {
                        const meta = getActivityMeta(log);
                        const desc = describeLog(log);
                        const securityBadges = getSecurityBadges(log);
                        const isExpanded = expandedLogId === log.id;
                        return (
                          <React.Fragment key={log.id}>
                            <tr onClick={() => setExpandedLogId(isExpanded ? null : log.id)} className="hover:bg-stone-50/80 transition-colors cursor-pointer">
                              <td className="px-3 py-4 font-mono text-stone-400 text-xs whitespace-nowrap">{formatTime(log.timestamp)}</td>
                              <td className="px-2 py-4 whitespace-nowrap overflow-hidden">{getLogDeviceIcon(log)}</td>
                              <td className="px-2 py-4 whitespace-nowrap overflow-hidden">{getRoleBadge(log.role)}</td>
                              <td className="px-3 py-4 font-bold text-stone-700 whitespace-nowrap truncate" title={log.user}>{log.user}</td>
                              <td className="px-2 py-4 whitespace-nowrap overflow-hidden">
                                <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold whitespace-nowrap max-w-full ${meta.badge}`}>{meta.label}</span>
                              </td>
                              <td className="px-3 py-4 font-bold text-stone-700 whitespace-nowrap truncate" title={log.action}>
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className="truncate">{log.action}</span>
                                  {securityBadges.map((badge) => (
                                    <span key={badge.key} className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-black whitespace-nowrap ${badge.className}`}>
                                      {badge.label}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-3 py-4 text-stone-500 text-xs truncate" title={desc}>{desc}</td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-stone-50/70">
                                <td colSpan="7" className="p-4 border-t border-stone-100">
                                  <div className="rounded-2xl bg-white border border-stone-100 p-4 text-xs text-stone-600 leading-relaxed overflow-hidden">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                                      <div><span className="font-black text-stone-400">來源頁面：</span>{log.details?.viewLabel || log.details?.view || log.view || "-"}</div>
                                      <div><span className="font-black text-stone-400">品牌：</span>{log.brandLabel || log.brand || "-"}</div>
                                      <div><span className="font-black text-stone-400">事件：</span>{log.activityType || log.details?.activityType || "-"}</div>
                                      <div><span className="font-black text-stone-400">登入位置：</span>{getLogLoginLocationDisplay(log)}</div>
                                      <div><span className="font-black text-stone-400">裝置：</span>{[getLogDeviceDisplayName(log), log.browser, log.os].filter(Boolean).join(" / ") || "-"}</div>
                                      <div><span className="font-black text-stone-400">裝置碼：</span>{log.deviceShort || log.details?.deviceShort || "-"}</div>
                                    </div>
                                    <pre className="whitespace-pre-wrap break-words rounded-xl bg-stone-50 border border-stone-100 p-3 text-[11px] max-w-full overflow-auto">{JSON.stringify(log.details || {}, null, 2)}</pre>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {currentData.length === 0 && (
                        <tr>
                          <td colSpan="7" className="p-10 text-center text-stone-400 font-bold">在此日期範圍內無相關紀錄</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mt-4 pt-2 px-2 w-full max-w-full">
                <span className="text-sm text-stone-400 font-medium">頁次 {currentPage} / {totalPages}｜已載入 {logs.length} 筆{hasMoreLogs ? "｜尚可載入更多" : ""}</span>
                <div className="flex flex-wrap gap-2 justify-end">
                  {totalPages > 1 && (
                    <>
                      <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 border-2 border-stone-100 rounded-xl hover:bg-stone-50 disabled:opacity-50 text-stone-500"><ChevronLeft size={18} /></button>
                      <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 border-2 border-stone-100 rounded-xl hover:bg-stone-50 disabled:opacity-50 text-stone-500"><ChevronRight size={18} /></button>
                    </>
                  )}
                  {hasMoreLogs && (
                    <button
                      type="button"
                      onClick={handleLoadMoreLogs}
                      disabled={loading}
                      className="px-4 py-2 rounded-xl border border-stone-200 bg-white text-stone-600 text-sm font-black hover:bg-stone-50 disabled:opacity-50 flex items-center gap-2"
                    >
                      {loading ? <RefreshCw size={15} className="animate-spin" /> : <ChevronDown size={15} />}
                      載入更多
                    </button>
                  )}
                </div>
              </div>
            </>
          )
          )}

          {monitorMode === "approvals" && (
            <DeviceApprovalPanel
              open
              embedded
              getCollectionPath={getCollectionPath}
              accountKey={currentSecurityAccountKey}
              currentDeviceTrusted={currentDeviceTrust?.status === "trusted"}
              isSuperAdmin={Boolean(canManageDeviceSecurity)}
              onReview={reviewDeviceApprovalAction}
            />
          )}

          {monitorMode === "devices" && (
            <div className="space-y-4 w-full max-w-full min-w-0">
              {!canReviewDeviceSecurity && (
                <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-xs font-bold leading-6 text-amber-800">
                  {canManageDeviceSecurity
                    ? "目前這台裝置尚未完成確認；請改用已信任的裝置處理允許、停用或其他安全設定。"
                    : "您可以查看裝置紀錄；允許、停用或變更裝置狀態僅限最高管理者處理。"}
                </div>
              )}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {[
                  {
                    key: "all",
                    label: "已記錄帳號",
                    value: deviceSummary.accounts,
                    className: "border-sky-100 bg-sky-50/60 text-sky-700",
                    activeClassName: "ring-2 ring-sky-300 border-sky-200 bg-sky-50",
                  },
                  {
                    key: "all",
                    label: "裝置總數",
                    value: deviceSummary.totalDevices,
                    className: "border-emerald-100 bg-emerald-50/60 text-emerald-700",
                    activeClassName: "ring-2 ring-emerald-300 border-emerald-200 bg-emerald-50",
                  },
                  {
                    key: "pending",
                    label: "待確認裝置",
                    value: deviceSummary.newDevices,
                    className: "border-rose-100 bg-rose-50/60 text-rose-700",
                    activeClassName: "ring-2 ring-rose-300 border-rose-200 bg-rose-50",
                  },
                  {
                    key: "mobile",
                    label: "行動裝置",
                    value: deviceSummary.mobileDevices,
                    className: "border-amber-100 bg-amber-50/60 text-amber-700",
                    activeClassName: "ring-2 ring-amber-300 border-amber-200 bg-amber-50",
                  },
                ].map((card) => {
                  const active = deviceQuickFilter === card.key || (card.key === "all" && deviceQuickFilter === "all");
                  return (
                    <button
                      key={`${card.label}_${card.key}`}
                      type="button"
                      onClick={() => handleDeviceQuickFilter(card.key)}
                      className={`rounded-2xl border px-4 py-3 text-left transition-all active:scale-[0.98] hover:shadow-sm ${card.className} ${active ? card.activeClassName : ""}`}
                      title={`點擊篩選：${card.label}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-black">{card.label}</p>
                        {active && <span className="text-[10px] font-black opacity-70">篩選中</span>}
                      </div>
                      <p className="mt-1 text-2xl font-black">{card.value}</p>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-stone-100 bg-stone-50/70 p-3">
                <div className="flex items-center gap-2 text-sm font-black text-stone-600">
                  <Laptop size={18} className="text-stone-400" />
                  完整裝置紀錄資料較多；請先設定日期區間與顯示數量，再手動載入。
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-end">
                  <input
                    value={deviceKeyword}
                    onChange={(e) => setDeviceKeyword(e.target.value)}
                    placeholder="搜尋使用者、裝置碼、瀏覽器..."
                    className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-600 outline-none focus:border-amber-300"
                  />

                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-black text-stone-400">開始</span>
                    <div className="relative w-full lg:w-40">
                      <SmartDatePicker
                        selectedDate={deviceDateRange.start}
                        onDateSelect={(val) => setDeviceDateRange((prev) => {
                          const nextEnd = val > prev.end ? val : prev.end;
                          return { start: val, end: nextEnd };
                        })}
                        maxDate={deviceDateRange.end || todayStr}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-black text-stone-400">結束</span>
                    <div className="relative w-full lg:w-40">
                      <SmartDatePicker
                        selectedDate={deviceDateRange.end}
                        onDateSelect={(val) => setDeviceDateRange((prev) => ({ ...prev, end: val }))}
                        align="right"
                        minDate={deviceDateRange.start}
                        maxDate={todayStr}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-black text-stone-400">顯示數量</span>
                    <select
                      value={deviceLimitCount}
                      onChange={(e) => setDeviceLimitCount(Number(e.target.value))}
                      className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm font-black text-stone-600 outline-none focus:border-amber-300"
                    >
                      <option value={20}>20 筆</option>
                      <option value={50}>50 筆</option>
                      <option value={100}>100 筆</option>
                      <option value={200}>200 筆</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={fetchDeviceProfiles}
                    className="h-10 px-4 rounded-xl bg-stone-800 text-white text-sm font-black flex items-center justify-center gap-2 active:scale-95 whitespace-nowrap"
                  >
                    {deviceLoading ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                    {deviceHasLoaded ? "重新載入" : "載入資料"}
                  </button>
                </div>
              </div>

              {deviceHasLoaded && deviceQuickFilter !== "all" && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-2xl border border-rose-100 bg-rose-50/50 px-4 py-3">
                  <div className="text-sm font-black text-rose-700">
                    目前篩選：{deviceQuickFilter === "pending" ? "待確認裝置" : "行動裝置"}
                    <span className="ml-2 text-xs font-bold text-rose-400">共 {filteredDeviceProfiles.reduce((sum, profile) => sum + (profile.deviceList?.length || 0), 0)} 台</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDeviceQuickFilter("all");
                      setExpandedDeviceId(null);
                    }}
                    className="px-3 py-2 rounded-xl bg-white text-rose-600 border border-rose-100 text-xs font-black hover:bg-rose-50 active:scale-95"
                  >
                    清除篩選
                  </button>
                </div>
              )}

              {!deviceHasLoaded && !deviceLoading ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white rounded-2xl border-2 border-dashed border-stone-200">
                  <Laptop size={44} className="text-stone-300 mb-4" />
                  <h4 className="text-stone-600 font-black text-lg mb-2">裝置資料尚未載入</h4>
                  <p className="text-stone-400 text-sm max-w-sm leading-6">
                    為了維持系統順暢，進入裝置管理時不會自動載入完整紀錄。請先設定日期區間與顯示數量，再點擊右側「載入資料」。
                  </p>

                </div>
              ) : deviceLoading ? (
                <div className="py-20 text-center text-stone-400 font-black">
                  <RefreshCw className="animate-spin mx-auto mb-3" size={32} />
                  裝置資料讀取中...
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredDeviceProfiles.map((profile) => {
                    const isExpanded = expandedDeviceId === profile.id;
                    return (
                      <div key={profile.id} className="rounded-2xl border border-stone-100 bg-white shadow-sm overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setExpandedDeviceId(isExpanded ? null : profile.id)}
                          className="w-full p-4 text-left hover:bg-stone-50/70 transition-colors"
                        >
                          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {getRoleBadge(profile.role)}
                                <span className="font-black text-stone-800">{profile.userName || profile.accountId || profile.id}</span>
                                {profile.newCount > 0 && (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 text-rose-600 border border-rose-100 text-xs font-black">
                                    <ShieldAlert size={12} /> {profile.newCount} 台新裝置
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xs font-bold text-stone-400 truncate">帳號識別：{profile.accountId || profile.id}</p>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center shrink-0">
                              <div className="rounded-xl bg-stone-50 px-3 py-2">
                                <p className="text-[11px] font-black text-stone-400">裝置</p>
                                <p className="text-sm font-black text-stone-700">{profile.deviceList?.length || 0}</p>
                              </div>
                              <div className="rounded-xl bg-emerald-50 px-3 py-2">
                                <p className="text-[11px] font-black text-emerald-500">信任</p>
                                <p className="text-sm font-black text-emerald-700">{profile.trustedCount}</p>
                              </div>
                              <div className="rounded-xl bg-stone-50 px-3 py-2">
                                <p className="text-[11px] font-black text-stone-400">最後</p>
                                <p className="text-xs font-black text-stone-600">{formatDeviceTime(profile.lastSeenText)}</p>
                              </div>
                            </div>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="border-t border-stone-100 p-4 bg-stone-50/40">
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                              {(profile.deviceList || []).map((device) => (
                                <div key={device.deviceId} className="rounded-2xl border border-stone-100 bg-white p-4">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {getDeviceIcon(device.device)}
                                        <span className="font-black text-stone-700">{getDeviceDisplayName(device)} / {device.browser || "-"} / {device.os || "-"}</span>
                                      </div>
                                      <p className="mt-2 text-xs font-mono text-stone-400 break-all">裝置碼：{device.deviceShort || "-"}</p>
                                    </div>
                                    <span className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-black border ${getDeviceTrustMeta(device).className}`}>
                                      {getDeviceTrustMeta(device).label}
                                    </span>
                                  </div>
                                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-stone-500">
                                    <div className="rounded-xl bg-stone-50 p-2">
                                      <span className="block text-stone-400 font-black">首次記錄</span>
                                      {formatDeviceTime(device.firstSeenAtText)}
                                    </div>
                                    <div className="rounded-xl bg-stone-50 p-2">
                                      <span className="block text-stone-400 font-black">最後登入</span>
                                      {formatDeviceTime(device.lastSeenAtText)}
                                    </div>
                                    <div className="rounded-xl bg-stone-50 p-2">
                                      <span className="block text-stone-400 font-black">登入次數</span>
                                      {device.loginCount || 1}
                                    </div>
                                    <div className="rounded-xl bg-stone-50 p-2">
                                      <span className="block text-stone-400 font-black">裝置類型</span>
                                      {getDeviceDisplayName(device)}
                                    </div>
                                    <div className="rounded-xl bg-stone-50 p-2">
                                      <span className="block text-stone-400 font-black">登入位置</span>
                                      {getLoginLocationDisplay(device)}
                                    </div>
                                    <div className="rounded-xl bg-stone-50 p-2">
                                      <span className="block text-stone-400 font-black">目前狀態</span>
                                      {getDeviceTrustMeta(device).label}
                                    </div>
                                  </div>

                                  <div className="mt-3 flex flex-col sm:flex-row gap-2 justify-end">
                                    {(device.trusted === false || ["new", "observing", "reverify_required", "suspicious", "blocked", "global_blocked"].includes(device.status)) && (
                                      <button
                                        type="button"
                                        disabled={!canReviewDeviceSecurity || deviceActionKey === `${profile.id}_${device.deviceId}_trusted`}
                                        onClick={() => updateDeviceTrust(profile, device, "trusted")}
                                        className="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 text-xs font-black hover:bg-emerald-100 disabled:opacity-60 active:scale-95"
                                      >
                                        {deviceActionKey === `${profile.id}_${device.deviceId}_trusted` ? "處理中..." : (device.status === "blocked" || device.status === "global_blocked" ? "恢復並信任" : "允許使用")}
                                      </button>
                                    )}
                                    {!(device.status === "observing" || device.source === "manual_observing" || device.status === "blocked" || device.source === "manual_blocked" || device.status === "global_blocked" || device.source === "manual_global_blocked") && (
                                      <button
                                        type="button"
                                        disabled={!canReviewDeviceSecurity || deviceActionKey === `${profile.id}_${device.deviceId}_observing`}
                                        onClick={() => updateDeviceTrust(profile, device, "observing")}
                                        className="px-3 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 text-xs font-black hover:bg-amber-100 disabled:opacity-60 active:scale-95"
                                        title="先不列為信任，不影響目前觀察階段的使用"
                                      >
                                        {deviceActionKey === `${profile.id}_${device.deviceId}_observing` ? "處理中..." : "繼續觀察"}
                                      </button>
                                    )}
                                    {!(device.status === "reverify_required" || device.source === "manual_reverify_required" || device.status === "blocked" || device.source === "manual_blocked" || device.status === "global_blocked" || device.source === "manual_global_blocked") && (
                                      <button
                                        type="button"
                                        disabled={!canReviewDeviceSecurity || deviceActionKey === `${profile.id}_${device.deviceId}_reverify_required`}
                                        onClick={() => updateDeviceTrust(profile, device, "reverify_required")}
                                        className="px-3 py-2 rounded-xl bg-orange-50 text-orange-700 border border-orange-100 text-xs font-black hover:bg-orange-100 disabled:opacity-60 active:scale-95"
                                        title="保留重新驗證要求；正式啟用裝置驗證後，下次登入需完成確認"
                                      >
                                        {deviceActionKey === `${profile.id}_${device.deviceId}_reverify_required` ? "處理中..." : "要求重新驗證"}
                                      </button>
                                    )}
                                    {!(device.status === "blocked" || device.source === "manual_blocked" || device.status === "global_blocked" || device.source === "manual_global_blocked") && (
                                      <button
                                        type="button"
                                        disabled={!canReviewDeviceSecurity || deviceActionKey === `${profile.id}_${device.deviceId}_blocked`}
                                        onClick={() => {
                                          if (window.confirm("確定要停用這台裝置嗎？停用後，這個帳號將無法再用這台裝置進入目前品牌。")) {
                                            updateDeviceTrust(profile, device, "blocked");
                                          }
                                        }}
                                        className="px-3 py-2 rounded-xl bg-stone-100 text-stone-700 border border-stone-200 text-xs font-black hover:bg-stone-200 disabled:opacity-60 active:scale-95"
                                      >
                                        {deviceActionKey === `${profile.id}_${device.deviceId}_blocked` ? "處理中..." : "停用此裝置"}
                                      </button>
                                    )}
                                    {!(device.status === "global_blocked" || device.source === "manual_global_blocked") && (
                                      <button
                                        type="button"
                                        disabled={!canReviewDeviceSecurity || deviceActionKey === `${profile.id}_${device.deviceId}_global_blocked`}
                                        onClick={() => {
                                          if (window.confirm("確定要停止這台裝置使用所有品牌嗎？完成後，這個帳號將無法再用這台裝置進入任何品牌。")) {
                                            updateDeviceTrust(profile, device, "global_blocked");
                                          }
                                        }}
                                        className="px-3 py-2 rounded-xl bg-rose-100 text-rose-700 border border-rose-200 text-xs font-black hover:bg-rose-200 disabled:opacity-60 active:scale-95"
                                      >
                                        {deviceActionKey === `${profile.id}_${device.deviceId}_global_blocked` ? "處理中..." : "所有品牌停用"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {filteredDeviceProfiles.length === 0 && (
                    <div className="p-10 text-center text-stone-400 font-bold rounded-2xl border border-stone-100 bg-white">
                      目前沒有符合條件的裝置資料
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </Card>
      </div>
    </ViewWrapper>
  );
};

export default SystemMonitor;