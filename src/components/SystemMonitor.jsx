// src/components/SystemMonitor.jsx
import React, { useState, useMemo, useContext, useEffect } from "react";
import {
  Smartphone, Monitor, ChevronLeft, ChevronRight, RefreshCw,
  Calendar, Search, RotateCcw, ShieldAlert, ShieldCheck, Laptop
} from "lucide-react";
import { 
  query, limit, where, Timestamp, getDocs, orderBy, doc, setDoc, increment 
} from "firebase/firestore";

import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";
import { db, appId } from "../config/firebase";
import { formatLocalYYYYMMDD } from "../utils/helpers";

const SystemMonitor = () => {
  const { getCollectionPath, currentBrand, currentUser, userRole } = useContext(AppContext);
  
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

  const fetchLogs = async (rangeOverride = null) => {
    setLoading(true);
    setLogs([]);
    setExpandedLogId(null);

    const activeRange = rangeOverride || queryDateRange;
    const startDate = new Date(`${activeRange.start}T00:00:00`);
    const endDate = new Date(`${activeRange.end}T23:59:59`);

    try {
      const q = query(
        getCollectionPath("system_logs"),
        where("timestamp", ">=", Timestamp.fromDate(startDate)),
        where("timestamp", "<=", Timestamp.fromDate(endDate)),
        orderBy("timestamp", "desc"),
        limit(500)
      );

      const snapshot = await getDocs(q);
      const logsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLogs(logsData);
      setLastQueryInfo({
        count: logsData.length,
        start: activeRange.start,
        end: activeRange.end,
        queriedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      });
    } catch (error) {
      console.error("Fetch logs error:", error);
      setLastQueryInfo({ count: 0, error: error.message, queriedAt: new Date().toLocaleString("zh-TW", { hour12: false }) });
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
        const newCount = deviceList.filter((d) => d.trusted === false || d.status === "new" || d.status === "suspicious" || d.status === "blocked" || d.status === "global_blocked").length;
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

  const filteredDeviceProfiles = useMemo(() => {
    const key = deviceKeyword.trim().toLowerCase();
    if (!key) return deviceProfiles;

    return deviceProfiles.filter((profile) => {
      const text = [
        profile.userName,
        profile.accountId,
        profile.role,
        profile.brandLabel,
        profile.id,
        ...(profile.deviceList || []).flatMap((device) => [
          device.device,
          device.browser,
          device.os,
          device.deviceShort,
          device.status,
          device.source,
        ]),
      ].join(" ").toLowerCase();
      return text.includes(key);
    });
  }, [deviceProfiles, deviceKeyword]);

  const deviceSummary = useMemo(() => {
    const totalDevices = deviceProfiles.reduce((sum, item) => sum + (item.deviceList?.length || 0), 0);
    const newDevices = deviceProfiles.reduce((sum, item) => sum + (item.newCount || 0), 0);
    const pcDevices = deviceProfiles.reduce((sum, item) => sum + (item.deviceList || []).filter((d) => d.device === "PC").length, 0);
    return {
      accounts: deviceProfiles.length,
      totalDevices,
      newDevices,
      mobileDevices: totalDevices - pcDevices,
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

  const sanitizeSecurityKey = (value) => {
    return String(value || "unknown")
      .replace(/[\/.#$\[\]]/g, "_")
      .replace(/\s+/g, "_")
      .trim();
  };

  const getGlobalBlockedDeviceRef = (profile, device) => {
    const role = profile?.role || "unknown";
    const accountId = profile?.accountId || profile?.userName || profile?.id || "unknown";
    const deviceId = device?.deviceId || "unknown_device";
    const globalKey = sanitizeSecurityKey(`${role}_${accountId}_${deviceId}`);
    return doc(db, "artifacts", appId, "public", "data", "global_blocked_devices", globalKey);
  };

  const getDeviceTrustMeta = (device = {}) => {
    if (device.source === "manual_global_blocked" || device.status === "global_blocked") {
      return {
        label: "全品牌封鎖",
        className: "bg-stone-100 text-stone-800 border-stone-300",
      };
    }
    if (device.status === "blocked" || device.source === "manual_blocked") {
      return {
        label: "已封鎖",
        className: "bg-stone-100 text-stone-700 border-stone-200",
      };
    }
    if (device.status === "suspicious" || device.source === "manual_suspicious") {
      return {
        label: "可疑裝置",
        className: "bg-rose-50 text-rose-700 border-rose-100",
      };
    }
    if (device.trusted === false || device.status === "new") {
      return {
        label: "新裝置",
        className: "bg-rose-50 text-rose-600 border-rose-100",
      };
    }
    return {
      label: "已信任",
      className: "bg-emerald-50 text-emerald-700 border-emerald-100",
    };
  };

  const updateDeviceTrust = async (profile, device, nextStatus) => {
    if (!profile?.id || !device?.deviceId) return;

    const actionKey = `${profile.id}_${device.deviceId}_${nextStatus}`;
    setDeviceActionKey(actionKey);

    const nowText = new Date().toISOString();
    const reviewerName = currentUser?.name || (userRole === "director" ? "高階主管" : "系統管理者");
    const isTrusted = nextStatus === "trusted";
    const isGlobalBlocked = nextStatus === "global_blocked";
    const isBlocked = nextStatus === "blocked" || isGlobalBlocked;

    const nextDevice = {
      ...device,
      trusted: isTrusted,
      status: isTrusted ? "trusted" : (isGlobalBlocked ? "global_blocked" : (isBlocked ? "blocked" : "suspicious")),
      source: isTrusted ? "manual_trusted" : (isGlobalBlocked ? "manual_global_blocked" : (isBlocked ? "manual_blocked" : "manual_suspicious")),
      reviewedBy: reviewerName,
      reviewedRole: userRole || "",
      reviewedAtText: nowText,
      updatedAtText: nowText,
      ...(isBlocked ? {
        blockedBy: reviewerName,
        blockedAtText: nowText,
        blockScope: isGlobalBlocked ? "all_brands" : "current_brand",
      } : {}),
    };

    try {
      await setDoc(doc(getCollectionPath("account_devices"), profile.id), {
        devices: {
          [device.deviceId]: nextDevice,
        },
        updatedAtText: nowText,
      }, { merge: true });

      const globalBlockRef = getGlobalBlockedDeviceRef(profile, device);
      if (isGlobalBlocked) {
        await setDoc(globalBlockRef, {
          active: true,
          status: "global_blocked",
          source: "manual_global_blocked",
          scope: "all_brands",
          role: profile?.role || "",
          accountId: profile?.accountId || "",
          userName: profile?.userName || profile?.accountId || profile?.id || "",
          deviceId: nextDevice.deviceId,
          deviceShort: nextDevice.deviceShort,
          device: nextDevice.device,
          browser: nextDevice.browser,
          os: nextDevice.os,
          blockedBy: reviewerName,
          blockedRole: userRole || "",
          blockedAtText: nowText,
          updatedAtText: nowText,
        }, { merge: true });
      }

      if (isTrusted) {
        await setDoc(globalBlockRef, {
          active: false,
          status: "resolved",
          source: "manual_trusted",
          resolvedBy: reviewerName,
          resolvedRole: userRole || "",
          resolvedAtText: nowText,
          updatedAtText: nowText,
        }, { merge: true });
      }

      const wasPendingDevice = device.trusted === false || device.status === "new" || device.status === "suspicious" || device.status === "blocked" || device.status === "global_blocked";
      if (isTrusted && wasPendingDevice) {
        await setDoc(doc(getCollectionPath("security_summary"), "device_alerts"), {
          pendingNewDeviceCount: increment(-1),
          lastResolvedDeviceShort: nextDevice.deviceShort,
          lastResolvedUserName: profile.userName || profile.accountId || profile.id,
          lastResolvedBy: reviewerName,
          lastResolvedAtText: nowText,
          updatedAtText: nowText,
        }, { merge: true });
      }

      setDeviceProfiles((prev) => prev.map((item) => {
        if (item.id !== profile.id) return item;

        const deviceList = (item.deviceList || []).map((d) =>
          d.deviceId === device.deviceId ? nextDevice : d
        );

        return {
          ...item,
          deviceList,
          trustedCount: deviceList.filter((d) => d.trusted === true && d.status !== "blocked").length,
          newCount: deviceList.filter((d) => d.trusted === false || d.status === "new" || d.status === "suspicious" || d.status === "blocked" || d.status === "global_blocked").length,
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
            resolvedPending: isTrusted && wasPendingDevice,
            globalBlocked: isGlobalBlocked,
            blockScope: isGlobalBlocked ? "all_brands" : (isBlocked ? "current_brand" : ""),
          },
        }));
      } catch (eventError) {
        console.warn("裝置信任狀態同步事件發送失敗:", eventError);
      }
    } catch (error) {
      console.error("更新裝置信任狀態失敗:", error);
      alert("更新裝置信任狀態失敗：" + error.message);
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
    fetchLogs(nextRange);
  };

  const handleResetQuery = () => {
    setUiDateRange({ start: todayStr, end: todayStr });
    setQueryDateRange({ start: todayStr, end: todayStr });
    setHasQueried(false); // ★ 重置時關閉開關，清空畫面
    setCurrentPage(1);
    setLogs([]);
    setKeyword("");
    setActivityFilter("all");
    setExpandedLogId(null);
    setLastQueryInfo(null);
  };

  return (
    <ViewWrapper>
      <div className="space-y-6 pb-20 w-full max-w-full min-w-0 overflow-x-hidden">
        <Card className="!overflow-visible z-30 relative w-full max-w-full min-w-0">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4 w-full max-w-full min-w-0">
            <div>
              <h3 className="text-lg font-bold text-stone-700">{monitorMode === "logs" ? "系統操作日誌" : "裝置登入管理"} ({currentBrand.label})</h3>
              <p className="text-xs text-stone-400">{monitorMode === "logs" ? "追蹤系統內的所有操作紀錄" : "查看帳號已記錄的常用裝置與新裝置狀態"}</p>
            </div>
            
            <div className="flex items-center gap-2 rounded-2xl border border-stone-100 bg-white p-1 shadow-sm">
              <button type="button" onClick={() => setMonitorMode("logs")} className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${monitorMode === "logs" ? "bg-stone-800 text-white shadow-sm" : "text-stone-500 hover:bg-stone-50"}`}>操作日誌</button>
              <button type="button" onClick={() => setMonitorMode("devices")} className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${monitorMode === "devices" ? "bg-stone-800 text-white shadow-sm" : "text-stone-500 hover:bg-stone-50"}`}>裝置管理</button>
            </div>

            {monitorMode === "logs" && (
            <div className="flex flex-col md:flex-row md:flex-wrap items-stretch md:items-center gap-2 bg-stone-50 p-2 rounded-xl border border-stone-200 relative z-50 w-full xl:w-auto max-w-full min-w-0">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-stone-400" />
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
              
              <div className="flex items-center gap-2 w-full md:w-auto mt-2 md:mt-0 xl:ml-2 min-w-0">
                <button 
                  onClick={handleExecuteQuery} 
                  className="flex-1 sm:flex-none px-4 py-2 bg-stone-800 text-white rounded-lg text-sm font-bold flex gap-2 hover:bg-stone-900 transition-colors shadow-sm items-center justify-center whitespace-nowrap active:scale-95"
                >
                  <Search size={16} /> 查詢
                </button>
                <button 
                  onClick={handleResetQuery} 
                  title="重置為今天"
                  className="px-3 py-2 bg-white border border-stone-200 text-stone-500 rounded-lg hover:bg-stone-50 transition-colors shadow-sm flex items-center justify-center"
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
                {lastQueryInfo && <span className="hidden xl:inline text-[11px] font-bold text-stone-400 whitespace-nowrap">本次讀取 {lastQueryInfo.count || 0} 筆｜{lastQueryInfo.queriedAt}</span>}
              </div>
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
                請在上方設定好日期範圍後，點擊「<strong className="text-stone-600">查詢</strong>」以調閱紀錄。
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

              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mt-4 pt-2 px-2 w-full max-w-full">
                  <span className="text-sm text-stone-400 font-medium">頁次 {currentPage} / {totalPages}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 border-2 border-stone-100 rounded-xl hover:bg-stone-50 disabled:opacity-50 text-stone-500"><ChevronLeft size={18} /></button>
                    <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 border-2 border-stone-100 rounded-xl hover:bg-stone-50 disabled:opacity-50 text-stone-500"><ChevronRight size={18} /></button>
                  </div>
                </div>
              )}
            </>
          )
          )}

          {monitorMode === "devices" && (
            <div className="space-y-4 w-full max-w-full min-w-0">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div className="rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3">
                  <p className="text-xs font-black text-sky-700">已記錄帳號</p>
                  <p className="mt-1 text-2xl font-black text-sky-700">{deviceSummary.accounts}</p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
                  <p className="text-xs font-black text-emerald-700">裝置總數</p>
                  <p className="mt-1 text-2xl font-black text-emerald-700">{deviceSummary.totalDevices}</p>
                </div>
                <div className="rounded-2xl border border-rose-100 bg-rose-50/60 px-4 py-3">
                  <p className="text-xs font-black text-rose-700">待觀察新裝置</p>
                  <p className="mt-1 text-2xl font-black text-rose-700">{deviceSummary.newDevices}</p>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3">
                  <p className="text-xs font-black text-amber-700">行動裝置</p>
                  <p className="mt-1 text-2xl font-black text-amber-700">{deviceSummary.mobileDevices}</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-stone-100 bg-stone-50/70 p-3">
                <div className="flex items-center gap-2 text-sm font-black text-stone-600">
                  <Laptop size={18} className="text-stone-400" />
                  裝置信任資料直接讀取 account_devices；請先設定區間與筆數，再手動載入。
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
                    <span className="text-[11px] font-black text-stone-400">讀取筆數</span>
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

              {!deviceHasLoaded && !deviceLoading ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white rounded-2xl border-2 border-dashed border-stone-200">
                  <Laptop size={44} className="text-stone-300 mb-4" />
                  <h4 className="text-stone-600 font-black text-lg mb-2">裝置資料尚未載入</h4>
                  <p className="text-stone-400 text-sm max-w-sm leading-6">
                    為節省 reads，切換到裝置管理時不會自動讀取 account_devices。請使用上方篩選列設定區間與筆數後，再點擊右側「載入資料」。
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
                                      <span className="block text-stone-400 font-black">來源</span>
                                      {device.source || device.status || "-"}
                                    </div>
                                  </div>

                                  <div className="mt-3 flex flex-col sm:flex-row gap-2 justify-end">
                                    {(device.trusted === false || device.status === "new" || device.status === "suspicious" || device.status === "blocked" || device.status === "global_blocked") && (
                                      <button
                                        type="button"
                                        disabled={deviceActionKey === `${profile.id}_${device.deviceId}_trusted`}
                                        onClick={() => updateDeviceTrust(profile, device, "trusted")}
                                        className="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 text-xs font-black hover:bg-emerald-100 disabled:opacity-60 active:scale-95"
                                      >
                                        {deviceActionKey === `${profile.id}_${device.deviceId}_trusted` ? "處理中..." : (device.status === "blocked" || device.status === "global_blocked" ? "解除封鎖並信任" : "設為信任")}
                                      </button>
                                    )}
                                    {!(device.status === "suspicious" || device.source === "manual_suspicious" || device.status === "blocked" || device.source === "manual_blocked") && (
                                      <button
                                        type="button"
                                        disabled={deviceActionKey === `${profile.id}_${device.deviceId}_suspicious`}
                                        onClick={() => updateDeviceTrust(profile, device, "suspicious")}
                                        className="px-3 py-2 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 text-xs font-black hover:bg-rose-100 disabled:opacity-60 active:scale-95"
                                      >
                                        {deviceActionKey === `${profile.id}_${device.deviceId}_suspicious` ? "處理中..." : "標記可疑"}
                                      </button>
                                    )}
                                    {!(device.status === "blocked" || device.source === "manual_blocked" || device.status === "global_blocked" || device.source === "manual_global_blocked") && (
                                      <button
                                        type="button"
                                        disabled={deviceActionKey === `${profile.id}_${device.deviceId}_blocked`}
                                        onClick={() => {
                                          if (window.confirm("確定要封鎖這台裝置嗎？封鎖後此瀏覽器環境將無法登入目前品牌。")) {
                                            updateDeviceTrust(profile, device, "blocked");
                                          }
                                        }}
                                        className="px-3 py-2 rounded-xl bg-stone-100 text-stone-700 border border-stone-200 text-xs font-black hover:bg-stone-200 disabled:opacity-60 active:scale-95"
                                      >
                                        {deviceActionKey === `${profile.id}_${device.deviceId}_blocked` ? "處理中..." : "封鎖裝置"}
                                      </button>
                                    )}
                                    {!(device.status === "global_blocked" || device.source === "manual_global_blocked") && (
                                      <button
                                        type="button"
                                        disabled={deviceActionKey === `${profile.id}_${device.deviceId}_global_blocked`}
                                        onClick={() => {
                                          if (window.confirm("確定要全品牌封鎖這台裝置嗎？封鎖後此帳號在所有品牌使用此瀏覽器環境都無法登入。")) {
                                            updateDeviceTrust(profile, device, "global_blocked");
                                          }
                                        }}
                                        className="px-3 py-2 rounded-xl bg-rose-100 text-rose-700 border border-rose-200 text-xs font-black hover:bg-rose-200 disabled:opacity-60 active:scale-95"
                                      >
                                        {deviceActionKey === `${profile.id}_${device.deviceId}_global_blocked` ? "處理中..." : "全品牌封鎖"}
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