// src/components/SystemMonitor.jsx
import React, { useState, useMemo, useContext } from "react";
import {
  Smartphone, Monitor, ChevronLeft, ChevronRight, RefreshCw,
  Calendar, Search, RotateCcw, ShieldAlert
} from "lucide-react";
import { 
  query, limit, where, Timestamp, getDocs, orderBy 
} from "firebase/firestore";

import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";
import { formatLocalYYYYMMDD } from "../utils/helpers";

const SystemMonitor = () => {
  const { getCollectionPath, currentBrand } = useContext(AppContext);
  
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

    if (type.startsWith("auth.") || action.includes("登入") || action.includes("登出")) {
      return { key: "auth", label: action.includes("登出") ? "登出" : "登入", badge: "bg-emerald-100 text-emerald-700" };
    }
    if (type === "page.view" || action.includes("頁面瀏覽")) {
      return { key: "page", label: "頁面瀏覽", badge: "bg-blue-100 text-blue-700" };
    }
    if (type.startsWith("query") || action.includes("查詢")) {
      return { key: "query", label: "查詢", badge: "bg-amber-100 text-amber-700" };
    }
    if (type.startsWith("data.") || action.includes("修改") || action.includes("更新") || action.includes("刪除")) {
      return { key: "data", label: action.includes("刪除") ? "資料刪除" : "資料異動", badge: "bg-rose-100 text-rose-700" };
    }
    if (type.startsWith("summary") || action.includes("Summary") || action.includes("整理") || action.includes("校準")) {
      return { key: "system", label: "系統維護", badge: "bg-purple-100 text-purple-700" };
    }
    return { key: "general", label: "一般操作", badge: "bg-stone-100 text-stone-600" };
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

  const filteredLogs = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return logs.filter((log) => {
      const meta = getActivityMeta(log);
      if (activityFilter !== "all" && meta.key !== activityFilter) return false;
      if (!key) return true;
      const text = [log.user, log.role, log.action, log.device, meta.label, describeLog(log), JSON.stringify(log.details || {})].join(" ").toLowerCase();
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
        return <span className="bg-rose-100 text-rose-600 px-2 py-0.5 rounded text-xs font-bold">高階</span>;
      case "manager":
        return <span className="bg-teal-100 text-teal-600 px-2 py-0.5 rounded text-xs font-bold">區長</span>;
      case "store":
        return <span className="bg-amber-100 text-amber-600 px-2 py-0.5 rounded text-xs font-bold">店經理</span>;
      case "therapist":
        return <span className="bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded text-xs font-bold">管理師</span>;
      default:
        return <span className="bg-stone-100 text-stone-500 px-2 py-0.5 rounded text-xs">未知</span>;
    }
  };

  const getDeviceIcon = (device) =>
    device === "iOS" || device === "Android" || device === "Mobile" ? (
      <div className="flex items-center gap-1 text-stone-500 bg-stone-50 px-2 py-1 rounded text-xs w-max">
        <Smartphone size={12} /> {device}
      </div>
    ) : (
      <div className="flex items-center gap-1 text-stone-400 bg-stone-50 px-2 py-1 rounded text-xs w-max">
        <Monitor size={12} /> PC
      </div>
    );

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
      <div className="space-y-6 pb-20">
        <Card className="!overflow-visible z-30 relative">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
            <div>
              <h3 className="text-lg font-bold text-stone-700">系統操作日誌 ({currentBrand.label})</h3>
              <p className="text-xs text-stone-400">追蹤系統內的所有操作紀錄</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 bg-stone-50 p-2 rounded-xl border border-stone-200 relative z-50 w-full lg:w-auto">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-stone-400" />
                <div className="flex items-center gap-2">
                  <div className="relative w-32 sm:w-36">
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
                  <div className="relative w-32 sm:w-36">
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
              
              <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0 lg:ml-2">
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
          </div>


          {hasQueried && (
            <div className="mb-4 grid grid-cols-1 lg:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                <p className="text-[11px] font-black text-emerald-700 tracking-widest">登入人數 / 次數</p>
                <p className="mt-1 text-xl font-black text-emerald-700">{summary.loginUsers} / {summary.loginCount}</p>
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                <p className="text-[11px] font-black text-blue-700 tracking-widest">頁面瀏覽</p>
                <p className="mt-1 text-xl font-black text-blue-700">{summary.pageCount}</p>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
                <p className="text-[11px] font-black text-amber-700 tracking-widest">查詢行為</p>
                <p className="mt-1 text-xl font-black text-amber-700">{summary.queryCount}</p>
              </div>
              <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
                <p className="text-[11px] font-black text-rose-700 tracking-widest">資料異動</p>
                <p className="mt-1 text-xl font-black text-rose-700">{summary.dataCount}</p>
              </div>
            </div>
          )}

          {hasQueried && (
            <div className="mb-4 flex flex-col lg:flex-row gap-3 lg:items-center justify-between rounded-2xl border border-stone-100 bg-stone-50/70 p-3">
              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "全部"],
                  ["auth", "登入 / 登出"],
                  ["page", "頁面瀏覽"],
                  ["query", "查詢"],
                  ["data", "資料異動"],
                  ["system", "系統維護"],
                ].map(([key, label]) => (
                  <button key={key} type="button" onClick={() => { setActivityFilter(key); setCurrentPage(1); }} className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all ${activityFilter === key ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-500 border-stone-200 hover:bg-stone-100"}`}>{label}</button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input value={keyword} onChange={(e) => { setKeyword(e.target.value); setCurrentPage(1); }} placeholder="搜尋使用者、動作、店家..." className="h-9 w-full lg:w-64 rounded-xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-600 outline-none focus:border-amber-300" />
                {lastQueryInfo && <span className="hidden xl:inline text-[11px] font-bold text-stone-400 whitespace-nowrap">本次讀取 {lastQueryInfo.count || 0} 筆｜{lastQueryInfo.queriedAt}</span>}
              </div>
            </div>
          )}

          {/* ★ 畫面呈現邏輯：尚未查詢 -> 讀取中 -> 顯示表格 */}
          {!hasQueried ? (
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
              <div className="overflow-x-auto min-h-[400px] rounded-2xl border border-stone-100 relative z-10">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead className="bg-stone-50/50 text-stone-400 font-bold text-xs uppercase tracking-wider border-b border-stone-100">
                    <tr>
                      <th className="p-4 w-32">時間</th>
                      <th className="p-4 w-24">裝置</th>
                      <th className="p-4 w-24">身份</th>
                      <th className="p-4 w-32">使用者</th>
                      <th className="p-4 w-28">類型</th>
                      <th className="p-4 w-32">動作</th>
                      <th className="p-4">詳細內容</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50 text-sm bg-white">
                    {currentData.map((log) => {
                      const meta = getActivityMeta(log);
                      const desc = describeLog(log);
                      const isExpanded = expandedLogId === log.id;
                      return (
                        <React.Fragment key={log.id}>
                          <tr onClick={() => setExpandedLogId(isExpanded ? null : log.id)} className="hover:bg-stone-50 transition-colors cursor-pointer">
                            <td className="p-4 font-mono text-stone-400 text-xs">{formatTime(log.timestamp)}</td>
                            <td className="p-4">{getDeviceIcon(log.device)}</td>
                            <td className="p-4">{getRoleBadge(log.role)}</td>
                            <td className="p-4 font-bold text-stone-700">{log.user}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded text-xs font-black ${meta.badge}`}>{meta.label}</span></td>
                            <td className="p-4 font-medium text-stone-600">{log.action}</td>
                            <td className="p-4 text-stone-500 text-xs max-w-sm truncate" title={desc}>{desc}</td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-stone-50/80">
                              <td colSpan="7" className="p-4 border-t border-stone-100">
                                <div className="rounded-2xl bg-white border border-stone-100 p-4 text-xs text-stone-600 leading-relaxed overflow-x-auto">
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                                    <div><span className="font-black text-stone-400">來源頁面：</span>{log.details?.viewLabel || log.details?.view || log.view || "-"}</div>
                                    <div><span className="font-black text-stone-400">品牌：</span>{log.brandLabel || log.brand || "-"}</div>
                                    <div><span className="font-black text-stone-400">事件：</span>{log.activityType || log.details?.activityType || "-"}</div>
                                  </div>
                                  <pre className="whitespace-pre-wrap break-words rounded-xl bg-stone-50 border border-stone-100 p-3 text-[11px]">{JSON.stringify(log.details || {}, null, 2)}</pre>
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
              {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4 pt-2 px-2">
                  <span className="text-sm text-stone-400 font-medium">頁次 {currentPage} / {totalPages}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 border-2 border-stone-100 rounded-xl hover:bg-stone-50 disabled:opacity-50 text-stone-500"><ChevronLeft size={18} /></button>
                    <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 border-2 border-stone-100 rounded-xl hover:bg-stone-50 disabled:opacity-50 text-stone-500"><ChevronRight size={18} /></button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </ViewWrapper>
  );
};

export default SystemMonitor;