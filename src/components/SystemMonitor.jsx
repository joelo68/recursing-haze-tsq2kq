// src/components/SystemMonitor.jsx
import React, { useState, useEffect, useContext } from "react";
import {
  Smartphone, Monitor, ChevronLeft, ChevronRight, RefreshCw,
  Calendar, Search, RotateCcw, ShieldAlert
} from "lucide-react";
import { 
  query, limit, onSnapshot, where, Timestamp 
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

  const todayStr = formatLocalYYYYMMDD(new Date());

  const [uiDateRange, setUiDateRange] = useState({
    start: todayStr,
    end: todayStr
  });

  const [queryDateRange, setQueryDateRange] = useState({
    start: todayStr,
    end: todayStr
  });

  const fetchLogs = () => {
    setLoading(true);
    setLogs([]); 

    const startDate = new Date(`${queryDateRange.start}T00:00:00`);
    const endDate = new Date(`${queryDateRange.end}T23:59:59`);

    const q = query(
      getCollectionPath("system_logs"),
      where("timestamp", ">=", Timestamp.fromDate(startDate)),
      where("timestamp", "<=", Timestamp.fromDate(endDate)),
      limit(500) 
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      logsData.sort((a, b) => {
        const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
        const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
        return timeB - timeA;
      });

      setLogs(logsData);
      setLoading(false);
    }, (error) => {
      console.error("Fetch logs error:", error);
      setLoading(false);
    });

    return unsubscribe;
  };

  // ★ 核心優化：如果 hasQueried 是 false，直接打斷，絕對不發送 Firebase 請求
  useEffect(() => {
    if (!hasQueried) {
      setLogs([]); // 確保資料是空的
      return;
    }
    const unsub = fetchLogs();
    return () => {
      if (unsub) unsub();
    };
  }, [queryDateRange, currentBrand, hasQueried]);

  const totalPages = Math.ceil(logs.length / itemsPerPage);
  const currentData = logs.slice(
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
    setCurrentPage(1); 
    setQueryDateRange(uiDateRange);
    setHasQueried(true); // ★ 點擊查詢後才開啟開關
  };

  const handleResetQuery = () => {
    setUiDateRange({ start: todayStr, end: todayStr });
    setQueryDateRange({ start: todayStr, end: todayStr });
    setHasQueried(false); // ★ 重置時關閉開關，清空畫面
    setCurrentPage(1);
    setLogs([]);
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
                      <th className="p-4 w-32">動作</th>
                      <th className="p-4">詳細內容</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50 text-sm bg-white">
                    {currentData.map((log) => (
                      <tr key={log.id} className="hover:bg-stone-50 transition-colors">
                        <td className="p-4 font-mono text-stone-400 text-xs">{formatTime(log.timestamp)}</td>
                        <td className="p-4">{getDeviceIcon(log.device)}</td>
                        <td className="p-4">{getRoleBadge(log.role)}</td>
                        <td className="p-4 font-bold text-stone-700">{log.user}</td>
                        <td className="p-4 font-medium text-stone-600">{log.action}</td>
                        <td className="p-4 text-stone-500 text-xs max-w-xs truncate" title={typeof log.details === "string" ? log.details : JSON.stringify(log.details)}>
                          {typeof log.details === "string" ? log.details : JSON.stringify(log.details)}
                        </td>
                      </tr>
                    ))}
                    {currentData.length === 0 && (
                      <tr>
                        <td colSpan="6" className="p-10 text-center text-stone-400 font-bold">在此日期範圍內無相關紀錄</td>
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