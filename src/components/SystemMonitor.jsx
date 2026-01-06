import React, { useState, useEffect, useContext } from "react";
import {
  Smartphone, Monitor, ChevronLeft, ChevronRight
} from "lucide-react";
import { 
  query, collection, orderBy, limit, onSnapshot 
} from "firebase/firestore";

// --- 路徑修正 ---
import { db, appId } from "../config/firebase";
import { AppContext } from "../AppContext";
import { ViewWrapper, Card, Skeleton } from "./SharedUI";

const SystemMonitor = () => {
  // 注意：這裡直接使用了 appId，雖然我們也從 AppContext 引入了，
  // 但因為 onSnapshot 需要直接存取 db，所以直接用 import 進來的 db/appId 也可以。
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => {
    const q = query(
      collection(db, "artifacts", appId, "public", "data", "system_logs"),
      orderBy("timestamp", "desc"),
      limit(200)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const totalPages = Math.ceil(logs.length / itemsPerPage);
  const currentData = logs.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  
  const formatTime = (ts) => {
    if (!ts) return "-";
    const date = ts.toDate();
    return `${date.getMonth() + 1}/${date.getDate()} ${date
      .getHours()
      .toString()
      .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case "director":
        return (
          <span className="bg-rose-100 text-rose-600 px-2.5 py-1 rounded-lg text-xs font-bold">
            總監
          </span>
        );
      case "manager":
        return (
          <span className="bg-teal-100 text-teal-600 px-2.5 py-1 rounded-lg text-xs font-bold">
            區長
          </span>
        );
      case "store":
        return (
          <span className="bg-amber-100 text-amber-600 px-2.5 py-1 rounded-lg text-xs font-bold">
            店經理
          </span>
        );
      default:
        return (
          <span className="bg-stone-100 text-stone-500 px-2.5 py-1 rounded-lg text-xs">
            未知
          </span>
        );
    }
  };

  const getDeviceIcon = (device) =>
    device === "iOS" || device === "Android" || device === "Mobile" ? (
      <div className="flex items-center gap-1 text-stone-500 font-bold bg-stone-100 px-2 py-1 rounded text-xs w-max">
        <Smartphone size={14} className="text-stone-400" /> {device}
      </div>
    ) : (
      <div className="flex items-center gap-1 text-stone-400 text-xs w-max">
        <Monitor size={14} /> PC
      </div>
    );

  return (
    <ViewWrapper>
      <Card
        title="系統監控日誌"
        subtitle="即時追蹤系統使用狀況 (顯示最近 200 筆紀錄)"
      >
        {loading ? (
          <div className="space-y-4 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto min-h-[400px] rounded-2xl border border-stone-100">
              <table className="w-full text-left border-collapse">
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
                    <tr
                      key={log.id}
                      className="hover:bg-rose-50/30 transition-colors"
                    >
                      <td className="p-4 font-mono text-stone-400 text-xs">
                        {formatTime(log.timestamp)}
                      </td>
                      <td className="p-4">{getDeviceIcon(log.device)}</td>
                      <td className="p-4">{getRoleBadge(log.role)}</td>
                      <td className="p-4 font-bold text-stone-700">
                        {log.user}
                      </td>
                      <td className="p-4 font-medium text-rose-500">
                        {log.action}
                      </td>
                      <td className="p-4 text-stone-500 text-xs">
                        {typeof log.details === "string"
                          ? log.details
                          : JSON.stringify(log.details)}
                      </td>
                    </tr>
                  ))}
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
    </ViewWrapper>
  );
};

export default SystemMonitor;