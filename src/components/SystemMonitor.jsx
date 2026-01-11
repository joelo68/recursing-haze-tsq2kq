// src/components/SystemMonitor.jsx
import React, { useState, useEffect } from "react";
import {
  Smartphone, Monitor, ChevronLeft, ChevronRight, RefreshCw,
  Calendar
} from "lucide-react";
import { 
  query, collection, limit, onSnapshot, where, Timestamp 
} from "firebase/firestore";

import { db, appId } from "../config/firebase";
import { ViewWrapper, Card } from "./SharedUI";

const SystemMonitor = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // 日期篩選狀態 (預設今天)
  const todayStr = new Date().toISOString().split('T')[0];
  const [dateRange, setDateRange] = useState({
    start: todayStr,
    end: todayStr
  });

  // 搜尋系統日誌 (支援日期篩選)
  const fetchLogs = () => {
    setLoading(true);
    setLogs([]); 

    const startDate = new Date(dateRange.start);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(dateRange.end);
    endDate.setHours(23, 59, 59, 999);

    const q = query(
      collection(db, "artifacts", appId, "public", "data", "system_logs"),
      where("timestamp", ">=", Timestamp.fromDate(startDate)),
      where("timestamp", "<=", Timestamp.fromDate(endDate)),
      limit(500) // 移除後端排序，避免索引問題
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let fetchedLogs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      // 前端排序：最新時間在最上面
      fetchedLogs.sort((a, b) => {
         const tA = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
         const tB = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
         return tB - tA;
      });
      setLogs(fetchedLogs);
      setLoading(false);
    });

    return unsubscribe;
  };

  // 當日期改變時重新訂閱
  useEffect(() => {
    const unsub = fetchLogs();
    return () => unsub(); 
  }, [dateRange]);

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
        return <span className="bg-rose-100 text-rose-600 px-2 py-0.5 rounded text-xs font-bold">總監</span>;
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

  return (
    <ViewWrapper>
      <div className="space-y-6 pb-20">
        
        {/* 系統操作日誌 (含日期篩選器) */}
        <Card>
          {/* ★ RWD 修正區塊：items-end 改為 items-start，讓手機版靠左對齊 ★ */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <div>
              <h3 className="text-lg font-bold text-stone-700">系統操作日誌</h3>
              <p className="text-xs text-stone-400">追蹤系統內的所有操作紀錄</p>
            </div>
            
            {/* ★ 日期篩選器 RWD 優化：加入 w-full md:w-auto, flex-wrap, 並讓 input flex-1 自動填滿 ★ */}
            <div className="flex flex-wrap items-center gap-2 bg-stone-50 p-1.5 rounded-xl border border-stone-200 w-full md:w-auto">
              <div className="flex items-center gap-2 px-2">
                <Calendar size={14} className="text-stone-400"/>
                <span className="text-xs font-bold text-stone-500 whitespace-nowrap">日期範圍</span>
              </div>
              
              {/* 日期輸入框區域 */}
              <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
                <input 
                  type="date" 
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs font-bold text-stone-600 outline-none focus:border-amber-400 flex-1 min-w-[110px]"
                />
                <span className="text-stone-300">~</span>
                <input 
                  type="date" 
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs font-bold text-stone-600 outline-none focus:border-amber-400 flex-1 min-w-[110px]"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4 p-4 text-center text-stone-400 py-20">
              <RefreshCw className="animate-spin mx-auto mb-2" />
              <p>資料讀取中...</p>
            </div>
          ) : (
            <>
              {/* 表格區塊：加入 overflow-x-auto 確保手機不破版 */}
              <div className="overflow-x-auto min-h-[400px] rounded-2xl border border-stone-100">
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
                    {currentData.length > 0 ? currentData.map((log) => (
                      <tr
                        key={log.id}
                        className="hover:bg-stone-50 transition-colors"
                      >
                        <td className="p-4 font-mono text-stone-400 text-xs">
                          {formatTime(log.timestamp)}
                        </td>
                        <td className="p-4">{getDeviceIcon(log.device)}</td>
                        <td className="p-4">{getRoleBadge(log.role)}</td>
                        <td className="p-4 font-bold text-stone-700">
                          {log.user}
                        </td>
                        <td className="p-4 font-medium text-stone-600">
                          {log.action}
                        </td>
                        <td className="p-4 text-stone-500 text-xs max-w-xs truncate" title={typeof log.details === "string" ? log.details : JSON.stringify(log.details)}>
                          {typeof log.details === "string"
                            ? log.details
                            : JSON.stringify(log.details)}
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="6" className="p-10 text-center text-stone-400">
                          在此日期範圍內無相關紀錄
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4 pt-2 px-2">
                  <span className="text-sm text-stone-400 font-medium">
                    頁次 {currentPage} / {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-2 border-2 border-stone-100 rounded-xl hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed text-stone-500"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      onClick={() =>
                        setCurrentPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={currentPage === totalPages}
                      className="p-2 border-2 border-stone-100 rounded-xl hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed text-stone-500"
                    >
                      <ChevronRight size={18} />
                    </button>
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