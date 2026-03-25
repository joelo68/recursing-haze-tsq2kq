// src/components/SystemMonitor.jsx
import React, { useState, useEffect, useContext } from "react";
import {
  Smartphone, Monitor, ChevronLeft, ChevronRight, RefreshCw,
  Calendar
} from "lucide-react";
import { 
  query, limit, onSnapshot, where, Timestamp 
} from "firebase/firestore";

import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";
// ★ 僅引入必要的標準化組件與函式
import SmartDatePicker from "./SmartDatePicker";
import { formatLocalYYYYMMDD } from "../utils/helpers";

const SystemMonitor = () => {
  const { getCollectionPath, currentBrand } = useContext(AppContext);
  
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // ★ 使用標準化濾水器初始化，確保時區與格式正確
  const [dateRange, setDateRange] = useState({
    start: formatLocalYYYYMMDD(new Date()),
    end: formatLocalYYYYMMDD(new Date())
  });

  const fetchLogs = () => {
    setLoading(true);
    setLogs([]); 

    const startDate = new Date(`${dateRange.start}T00:00:00`);
    const endDate = new Date(`${dateRange.end}T23:59:59`);

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

  useEffect(() => {
    const unsub = fetchLogs();
    return () => unsub();
  }, [dateRange, currentBrand]);

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

  return (
    <ViewWrapper>
      <div className="space-y-6 pb-20">
        {/* ★ 這裡完全還原您原始的 Card 與 Flex 排版，一個樣式都沒多改。 */}
        <Card>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <div>
              <h3 className="text-lg font-bold text-stone-700">系統操作日誌 ({currentBrand.label})</h3>
              <p className="text-xs text-stone-400">追蹤系統內的所有操作紀錄</p>
            </div>
            
            {/* ★ 這裡也是完全還原您原本的篩選列排版， z-50 保留原本的設定即可 */}
            <div className="flex items-center gap-2 bg-stone-50 p-2 rounded-xl border border-stone-200 relative z-50">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-stone-400" />
                <div className="flex items-center gap-2">
                  {/* ★ 僅精準更換組件，並修正參數名稱為 selectedDate 與 onDateSelect，其餘 relative 設定皆保留 ★ */}
                  <div className="relative">
                    <SmartDatePicker 
                      selectedDate={dateRange.start}
                      onDateSelect={(val) => setDateRange(prev => ({ ...prev, start: val }))}
                    />
                  </div>
                  <span className="text-stone-300">~</span>
                  <div className="relative">
                    <SmartDatePicker 
                      selectedDate={dateRange.end}
                      onDateSelect={(val) => setDateRange(prev => ({ ...prev, end: val }))}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {loading && logs.length === 0 ? (
            <div className="space-y-4 p-4 text-center text-stone-400 py-20">
              <RefreshCw className="animate-spin mx-auto mb-2" />
              <p>資料讀取中...</p>
            </div>
          ) : (
            <>
              {/* 表格排版完全保留 */}
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
                  </tbody>
                </table>
              </div>
              {/* 分頁排版完全保留 */}
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