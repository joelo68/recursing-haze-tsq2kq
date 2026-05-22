// src/components/SystemMaintenance.jsx
import React, { useState, useContext, useEffect, useMemo } from "react";
import { db } from "../config/firebase";
import {
  getDocs,
  getDoc,
  setDoc,
  doc,
  writeBatch,
  collection,
  query,
  where,
  limit,
} from "firebase/firestore";
import { AppContext } from "../AppContext";
import {
  Database,
  Download,
  RefreshCw,
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
} from "lucide-react";
import { ViewWrapper } from "./SharedUI";
import {
  getReadTrackerMode,
  setReadTrackerMode,
  getReadTrackerStats,
  clearReadTrackerStats,
  flushReadTrackerToFirestore,
} from "../utils/readTracker";

export default function SystemMaintenance() {
  const {
    currentBrand,
    userRole,
    currentUser,
    showToast,
    getCollectionPath,
    getDocPath,
  } = useContext(AppContext);

  const [logs, setLogs] = useState([]);
  const [loadingAction, setLoadingAction] = useState(null);
  const [calMonth, setCalMonth] = useState(new Date().toISOString().substring(0, 7));

  // 讀取來源追蹤
  const [readTrackerMode, setReadTrackerModeState] = useState(getReadTrackerMode());
  const [localReadStats, setLocalReadStats] = useState({});
  const [globalReadStats, setGlobalReadStats] = useState([]);
  const [loadingReadStats, setLoadingReadStats] = useState(false);
  const [globalRowsCount, setGlobalRowsCount] = useState(0);

  // 權限防護
  if (userRole !== "director") return null;

  const addLog = (msg) => {
    const timeStr = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    setLogs((prev) => [{ id: Date.now() + Math.random(), time: timeStr, text: msg }, ...prev]);
  };

  const getReadTrackerConfigRef = () => {
    if (typeof getDocPath === "function") {
      return getDocPath("read_tracker_config");
    }

    const brandId = currentBrand?.id || "default";
    return doc(db, "read_tracker_config", brandId);
  };

  // 讀取全域追蹤設定
  useEffect(() => {
    const loadReadTrackerConfig = async () => {
      try {
        const ref = getReadTrackerConfigRef();
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const mode = snap.data()?.mode || "off";
          setReadTrackerMode(mode);
          setReadTrackerModeState(mode);
        } else {
          setReadTrackerModeState(getReadTrackerMode());
        }
      } catch (error) {
        console.warn("讀取追蹤設定載入失敗：", error);
      }
    };

    loadReadTrackerConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBrand?.id]);

  // 本機統計每 3 秒刷新
  useEffect(() => {
    const refreshLocalStats = () => {
      setLocalReadStats(getReadTrackerStats());
    };

    refreshLocalStats();

    const timer = setInterval(refreshLocalStats, 3000);

    return () => clearInterval(timer);
  }, []);

  const readStatsRows = useMemo(() => {
    return Object.entries(localReadStats || {})
      .map(([label, item]) => ({
        label,
        docs: item.docs || 0,
        triggers: item.triggers || 0,
        avg: item.triggers ? Math.round((item.docs || 0) / item.triggers) : 0,
        lastAt: item.lastAt || "-",
      }))
      .sort((a, b) => b.docs - a.docs);
  }, [localReadStats]);

  const handleChangeReadTrackerMode = async (mode) => {
    try {
      const ref = getReadTrackerConfigRef();

      await setDoc(
        ref,
        {
          mode,
          brandId: currentBrand?.id || "unknown",
          brandLabel: currentBrand?.label || "unknown",
          updatedAtText: new Date().toISOString(),
          updatedBy: currentUser?.name || "director",
        },
        { merge: true }
      );

      setReadTrackerMode(mode);
      setReadTrackerModeState(mode);

      if (mode === "off") {
        showToast("讀取來源追蹤已關閉", "info");
      } else if (mode === "local") {
        showToast("已啟用本機讀取追蹤", "success");
      } else if (mode === "global") {
        showToast("已啟用全域上報模式，每 5 分鐘彙整一次", "success");
      }
    } catch (error) {
      console.error(error);
      showToast("讀取追蹤模式更新失敗", "error");
    }
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
      const result = await flushReadTrackerToFirestore({
        db,
        brandId: currentBrand?.id || "unknown",
        brandLabel: currentBrand?.label || "unknown",
        userRole,
        userName: currentUser?.name || "maintenance_user",
        activeView: "system_maintenance",
        force: true,
      });

      if (result.skipped) {
        showToast(`未上報：${result.reason}`, "info");
      } else {
        showToast(`已上報 ${result.totalReadDocs.toLocaleString()} docs`, "success");
        setLocalReadStats(getReadTrackerStats());
      }
    } catch (error) {
      console.error(error);
      showToast("手動上報失敗", "error");
    } finally {
      setLoadingReadStats(false);
    }
  };

  const normalizeSourcesFromRow = (row) => {
    if (row.sources && typeof row.sources === "object") {
      return row.sources;
    }

    // 防呆：若 readTracker 早期版本把 sources.xxx.docs 寫成扁平欄位，這裡也能讀
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

      const yesterdayObj = new Date(now);
      yesterdayObj.setDate(yesterdayObj.getDate() - 1);
      const yesterday = yesterdayObj.toISOString().slice(0, 10);

      // 免 Firestore 複合索引版本：
      // 只用 date == today / yesterday 查詢，不使用 orderBy。
      const qToday = query(
        collection(db, "read_debug_sessions"),
        where("date", "==", today),
        limit(300)
      );

      const qYesterday = query(
        collection(db, "read_debug_sessions"),
        where("date", "==", yesterday),
        limit(300)
      );

      const [todaySnap, yesterdaySnap] = await Promise.all([
        getDocs(qToday),
        getDocs(qYesterday),
      ]);

      const rows = [
        ...todaySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        ...yesterdaySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      ];

      const since = Date.now() - 24 * 60 * 60 * 1000;
      const targetBrandId = currentBrand?.id || "";

      const recentRows = rows
        .filter((row) => {
          const t = row.updatedAtText ? new Date(row.updatedAtText).getTime() : 0;
          const isRecent = t >= since;
          const isSameBrand = !targetBrandId || !row.brandId || row.brandId === targetBrandId;

          return isRecent && isSameBrand;
        })
        .sort((a, b) => {
          const timeA = a.updatedAtText || "";
          const timeB = b.updatedAtText || "";
          return timeB.localeCompare(timeA);
        });

      const sourceSummary = {};

      recentRows.forEach((row) => {
        const sources = normalizeSourcesFromRow(row);

        Object.entries(sources || {}).forEach(([label, item]) => {
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

          const docs = Number(item.docs || 0);
          const triggers = Number(item.triggers || 0);

          sourceSummary[label].docs += docs;
          sourceSummary[label].triggers += triggers;
          sourceSummary[label].users.add(row.userName || row.userRole || "unknown");
          sourceSummary[label].roles.add(row.userRole || "unknown");
          sourceSummary[label].devices.add(row.device || "unknown");

          if (!sourceSummary[label].lastAt || item.lastAt > sourceSummary[label].lastAt) {
            sourceSummary[label].lastAt = item.lastAt;
          }
        });
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

      setGlobalReadStats(summaryRows);
      setGlobalRowsCount(recentRows.length);

      if (summaryRows.length === 0) {
        showToast("近 24 小時尚未找到可彙整的全域追蹤資料", "info");
      } else {
        showToast(`已載入近 24 小時排行，共 ${summaryRows.length} 個來源`, "success");
      }
    } catch (error) {
      console.error(error);
      showToast("讀取全域追蹤失敗，請確認 read_debug_sessions 權限或資料是否存在", "error");
    } finally {
      setLoadingReadStats(false);
    }
  };

  // ==========================================
  // 工具 1: 光速級資料格式深度清洗
  // ==========================================
  const handleFixDateFormats = async () => {
    const brandName = currentBrand?.label || "目前品牌";
    if (
      !window.confirm(
        `確定要對【${brandName}】執行深度日期清洗嗎？\n此操作不可逆，將強制統一所有混亂日期格式。`
      )
    ) {
      return;
    }

    setLoadingAction("fixDates");
    setLogs([]);
    addLog(`🚀 啟動光速深度清洗引擎... 目標品牌：${brandName}`);

    try {
      let totalFixedCount = 0;
      const collectionsToFix = ["daily_reports", "therapist_daily_reports"];
      let batch = writeBatch(db);
      let operationCount = 0;

      for (const colName of collectionsToFix) {
        addLog(`📂 正在掃描資料表：${colName}...`);
        const snapshot = await getDocs(getCollectionPath(colName));
        let colFixedCount = 0;

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();

          if (data.date) {
            const origDate = String(data.date).trim();
            let newDate = origDate;

            if (/^\d{8}$/.test(origDate)) {
              newDate = `${origDate.substring(0, 4)}-${origDate.substring(
                4,
                6
              )}-${origDate.substring(6, 8)}`;
            } else {
              let cleanStr = origDate
                .replace(/[\/\.年月]/g, "-")
                .replace(/日/g, "")
                .replace(/-+/g, "-")
                .trim();

              cleanStr = cleanStr.replace(/^-+|-+$/g, "");

              const parts = cleanStr.split("-");

              if (parts.length === 3) {
                const y = parts[0];
                const m = String(parseInt(parts[1], 10)).padStart(2, "0");
                const d = String(parseInt(parts[2], 10)).padStart(2, "0");

                if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                  newDate = `${y}-${m}-${d}`;
                }
              }
            }

            if (newDate !== origDate) {
              const storeDisplay = data.storeName || data.store || "未知店家";
              const personDisplay = data.therapistName ? ` - ${data.therapistName}` : "";

              addLog(`✏️ 修正 [${origDate} ➡️ ${newDate}] ${storeDisplay}${personDisplay}`);

              batch.update(doc(getCollectionPath(colName), docSnap.id), { date: newDate });

              colFixedCount++;
              totalFixedCount++;
              operationCount++;

              if (operationCount === 490) {
                await batch.commit();
                batch = writeBatch(db);
                operationCount = 0;
              }
            }
          }
        }

        addLog(
          `✅ [${colName}] 掃描完畢，共檢查 ${snapshot.size} 筆，發現 ${colFixedCount} 筆需修正。`
        );
      }

      if (operationCount > 0) await batch.commit();

      if (totalFixedCount > 0) {
        addLog(`🎉 深度清洗完美結束！總計修復：${totalFixedCount} 筆資料。`);
        showToast(`清洗完成！共修復 ${totalFixedCount} 筆資料`, "success");
      } else {
        addLog(`✨ 系統日期格式非常完美，無須修正！`);
        showToast(`無須清洗，資料格式正常`, "info");
      }
    } catch (error) {
      addLog(`❌ 執行失敗: ${error.message}`);
      showToast("清洗過程發生錯誤", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  // ==========================================
  // 工具 2: 重複數據掃描與清理
  // ==========================================
  const handleRemoveDuplicates = async () => {
    const brandName = currentBrand?.label || "目前品牌";

    if (
      !window.confirm(
        `確定要啟動【重複數據清道夫】嗎？\n系統會掃描同一天、同店、同人的重複報表，並自動「保留最新的一筆、刪除舊的」。此操作不可逆！`
      )
    ) {
      return;
    }

    setLoadingAction("removeDups");
    setLogs([]);
    addLog(`🕵️‍♂️ 啟動重複數據掃描雷達... 目標品牌：${brandName}`);

    try {
      let totalDeletedCount = 0;
      const collectionsToCheck = ["daily_reports", "therapist_daily_reports"];
      let batch = writeBatch(db);
      let operationCount = 0;

      for (const colName of collectionsToCheck) {
        addLog(`📂 正在抓取並分析：${colName}...`);
        const snapshot = await getDocs(getCollectionPath(colName));
        const groupedData = {};

        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const date = data.date || "無日期";
          const store = data.storeName || data.store || "無店名";
          const person = data.therapistName || "店務總表";
          const uniqueKey = `${date}_${store}_${person}`;

          if (!groupedData[uniqueKey]) groupedData[uniqueKey] = [];
          groupedData[uniqueKey].push({ id: docSnap.id, ...data });
        });

        let colDuplicateCount = 0;

        for (const key in groupedData) {
          const records = groupedData[key];

          if (records.length > 1) {
            records.sort((a, b) => {
              const timeA = a.timestamp?.toMillis
                ? a.timestamp.toMillis()
                : a.createdAt?.toMillis
                ? a.createdAt.toMillis()
                : 0;

              const timeB = b.timestamp?.toMillis
                ? b.timestamp.toMillis()
                : b.createdAt?.toMillis
                ? b.createdAt.toMillis()
                : 0;

              return timeB - timeA;
            });

            const duplicatesToDelete = records.slice(1);

            for (const delRecord of duplicatesToDelete) {
              const storeDisplay = delRecord.storeName || delRecord.store || "未知店家";
              const personDisplay = delRecord.therapistName ? ` - ${delRecord.therapistName}` : "";

              addLog(`🗑️ 發現重複！移除 ➡️ [${delRecord.date}] ${storeDisplay}${personDisplay}`);
              batch.delete(doc(getCollectionPath(colName), delRecord.id));

              colDuplicateCount++;
              totalDeletedCount++;
              operationCount++;

              if (operationCount === 490) {
                await batch.commit();
                batch = writeBatch(db);
                operationCount = 0;
              }
            }
          }
        }

        addLog(
          `✅ [${colName}] 分析完畢，共檢查 ${snapshot.size} 筆，清除 ${colDuplicateCount} 筆重複垃圾。`
        );
      }

      if (operationCount > 0) await batch.commit();

      if (totalDeletedCount > 0) {
        addLog(`🎉 掃描清理完成！總計為系統移除了：${totalDeletedCount} 筆重複數據。`);
        showToast(`清理完成！共移除 ${totalDeletedCount} 筆重複資料`, "success");
      } else {
        addLog(`✨ 太棒了！系統非常乾淨，沒有發現任何重複數據。`);
        showToast(`系統非常乾淨，無重複資料`, "info");
      }
    } catch (error) {
      addLog(`❌ 掃描失敗: ${error.message}`);
      showToast("掃描過程發生錯誤", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  // ==========================================
  // 工具 3: 全量備份匯出
  // ==========================================
  const handleBackupData = async () => {
    const brandName = currentBrand?.label || "目前品牌";
    const brandId = currentBrand?.id || "unknown";

    setLoadingAction("backup");
    setLogs([]);
    addLog(`📦 正在準備打包 ${brandName} 所有日報數據...`);

    try {
      const snapshot = await getDocs(getCollectionPath("daily_reports"));
      const allData = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      const jsonString = JSON.stringify(allData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const fileName = `${brandId}_backup_${new Date().toISOString().split("T")[0]}.json`;

      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      addLog(`🎉 匯出成功！檔案已準備下載: ${fileName}`);
      addLog(`📊 總共匯出筆數: ${allData.length} 筆`);
      showToast("備份檔案已下載", "success");
    } catch (error) {
      addLog(`❌ 匯出失敗: ${error.message}`);
      showToast("備份失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  // ==========================================
  // 工具 4: 強制重整
  // ==========================================
  const handleHardReset = () => {
    if (!window.confirm("這將清除瀏覽器快取並重新載入系統，確定嗎？")) return;

    addLog(`🔄 正在清除本地快取並強制重載...`);
    localStorage.clear();
    window.location.reload(true);
  };

  // ==========================================
  // 工具 5: 數據一致性校準器
  // ==========================================
  const handleCalibrateData = async () => {
    const brandId = currentBrand?.id || "cyj";

    if (
      !window.confirm(
        `確定要針對【${brandId}】在 ${calMonth} 的數據執行校準嗎？\n此操作將重新掃描當月所有日報並強制修正彙整表與達成率。`
      )
    ) {
      return;
    }

    setLoadingAction("calibrate");
    setLogs([]);
    addLog(`🔄 啟動數據盤點與校準... 目標: ${brandId}, 月份: ${calMonth}`);

    try {
      const functionUrl = "https://recalculatemonthlydata-hyhcwrnyaa-uc.a.run.app";
      const response = await fetch(`${functionUrl}?brandId=${brandId}&yearMonth=${calMonth}`);

      if (!response.ok) throw new Error("伺服器回應異常");

      const result = await response.text();
      addLog(result);
      showToast("校準完成", "success");
    } catch (err) {
      addLog(`❌ 校準失敗: ${err.message}`);
      showToast("校準失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <ViewWrapper>
      <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500 pb-10">
        {/* 精緻頁面表頭 */}
        <div className="mb-8 border-b border-stone-100 pb-6">
          <h1 className="text-2xl font-bold text-stone-800 tracking-tight flex items-center gap-3">
            <Settings className="text-amber-500" size={26} strokeWidth={2} />
            系統維護控制台
          </h1>
          <p className="text-stone-400 mt-2 text-sm">
            數據結構優化、離線備份、流量診斷與效能重整作業。
          </p>
        </div>

        {/* 工具清單 */}
        <div className="grid gap-3">
          {[
            {
              id: "fixDates",
              icon: Database,
              title: "資料格式清洗",
              desc: "統一全庫日期為 YYYY-MM-DD 格式，修正輸入異常。",
              action: handleFixDateFormats,
              btnTxt: "執行清洗",
            },
            {
              id: "removeDups",
              icon: Scissors,
              title: "重複數據過濾",
              desc: "移除同天、同店、同人的重複報表，保留最新紀錄。",
              action: handleRemoveDuplicates,
              btnTxt: "掃描清除",
            },
            {
              id: "backup",
              icon: Download,
              title: "數據完整匯出",
              desc: "將當前品牌所有日報資料匯出為 JSON 離線備份。",
              action: handleBackupData,
              btnTxt: "下載備份",
            },
            {
              id: "reset",
              icon: RefreshCw,
              title: "強制系統重置",
              desc: "若發生畫面異常或卡頓，清除快取並重啟服務。",
              action: handleHardReset,
              btnTxt: "重置快取",
              danger: true,
            },
            {
              id: "calibrate",
              icon: Play,
              title: "數據一致性校準",
              desc: "針對指定月份重新掃描並計算達標數據，修復對帳落差。",
              action: handleCalibrateData,
              btnTxt: "啟動校準",
              highlight: true,
            },
          ].map((tool) => (
            <div
              key={tool.id}
              className={`bg-white p-5 rounded-2xl border transition-all duration-300 flex flex-col md:flex-row items-start md:items-center gap-5 ${
                tool.highlight
                  ? "border-amber-200 shadow-sm"
                  : "border-stone-100 hover:border-stone-200 shadow-[0_2px_4px_-1px_rgba(0,0,0,0.02)]"
              }`}
            >
              <div
                className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center ${
                  tool.danger
                    ? "bg-rose-50 text-rose-500"
                    : tool.highlight
                    ? "bg-emerald-50 text-emerald-500"
                    : "bg-stone-50 text-stone-500"
                }`}
              >
                <tool.icon size={20} strokeWidth={1.5} />
              </div>

              <div className="flex-1 min-w-0 w-full">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-bold text-stone-800">{tool.title}</h3>

                  {tool.danger && (
                    <span className="text-[10px] font-bold bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded border border-rose-100">
                      風險操作
                    </span>
                  )}

                  {tool.highlight && (
                    <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded border border-amber-100">
                      推薦工具
                    </span>
                  )}
                </div>

                <p className="text-xs text-stone-400 mt-0.5 truncate">{tool.desc}</p>

                {tool.id === "calibrate" && (
                  <div className="mt-3 flex items-center gap-2 bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-100 w-fit">
                    <Calendar size={14} className="text-stone-400" />
                    <span className="text-xs font-bold text-stone-500">指定月份：</span>
                    <input
                      type="month"
                      value={calMonth}
                      onChange={(e) => setCalMonth(e.target.value)}
                      className="bg-transparent text-xs font-bold text-stone-800 outline-none w-24 cursor-pointer"
                    />
                  </div>
                )}
              </div>

              <div className="w-full md:w-auto mt-2 md:mt-0 pt-3 md:pt-0 border-t md:border-0 border-stone-50 shrink-0">
                <button
                  onClick={tool.action}
                  disabled={loadingAction !== null}
                  className={`w-full md:w-auto text-xs font-bold px-6 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                    tool.danger
                      ? "bg-white border border-rose-200 text-rose-600 hover:bg-rose-50"
                      : tool.highlight
                      ? "bg-stone-800 text-white hover:bg-stone-700 shadow-md"
                      : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  {loadingAction === tool.id ? (
                    <Loader2 className="animate-spin text-current" size={14} />
                  ) : (
                    <tool.icon size={14} />
                  )}
                  {tool.btnTxt}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 讀取來源追蹤 */}
        <div className="bg-white rounded-3xl border border-stone-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-stone-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-stone-800 flex items-center gap-2">
                <Radio className="text-amber-500" size={22} />
                讀取來源追蹤
              </h2>
              <p className="text-xs text-stone-400 mt-1 font-bold">
                用來判斷晚間讀取暴增是由哪一個資料來源、頁面或角色造成。
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { id: "off", label: "關閉", icon: Power },
                { id: "local", label: "本機模式", icon: Monitor },
                { id: "global", label: "全域上報", icon: Globe2 },
              ].map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => handleChangeReadTrackerMode(mode.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-black border flex items-center gap-2 transition-all ${
                    readTrackerMode === mode.id
                      ? "bg-stone-900 text-white border-stone-900 shadow-md"
                      : "bg-white text-stone-500 border-stone-200 hover:bg-stone-50"
                  }`}
                >
                  <mode.icon size={14} />
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* 本機統計 */}
            <div className="rounded-2xl border border-stone-100 bg-stone-50/50 overflow-hidden">
              <div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="text-emerald-500" />
                  <span className="text-sm font-black text-stone-700">目前裝置統計</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleManualFlushReadTracker}
                    disabled={loadingReadStats || readTrackerMode !== "global"}
                    className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-40"
                  >
                    手動上報
                  </button>

                  <button
                    onClick={handleClearReadTracker}
                    className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-rose-100 text-rose-500 hover:bg-rose-50"
                  >
                    清除
                  </button>
                </div>
              </div>

              <div className="p-4">
                {readStatsRows.length === 0 ? (
                  <div className="h-48 flex flex-col items-center justify-center text-stone-300 gap-2">
                    <BarChart3 size={32} />
                    <p className="text-xs font-black tracking-widest">
                      尚無本機讀取追蹤資料
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                    {readStatsRows.slice(0, 12).map((row, index) => (
                      <div
                        key={row.label}
                        className="bg-white rounded-xl border border-stone-100 p-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-stone-100 text-stone-500 text-[11px] font-black flex items-center justify-center">
                              {index + 1}
                            </span>
                            <p className="text-xs font-black text-stone-700 truncate">
                              {row.label}
                            </p>
                          </div>

                          <p className="text-[10px] text-stone-400 mt-1 ml-8">
                            觸發 {row.triggers.toLocaleString()} 次｜平均{" "}
                            {row.avg.toLocaleString()} docs / 次
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-sm font-black text-amber-600">
                            {row.docs.toLocaleString()}
                          </p>
                          <p className="text-[10px] text-stone-400">docs</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 全域統計 */}
            <div className="rounded-2xl border border-stone-100 bg-stone-50/50 overflow-hidden">
              <div className="px-4 py-3 border-b border-stone-100 bg-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe2 size={16} className="text-blue-500" />
                  <span className="text-sm font-black text-stone-700">近 24 小時全域排行</span>
                </div>

                <button
                  onClick={handleLoadGlobalReadStats}
                  disabled={loadingReadStats}
                  className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-40 flex items-center gap-1.5"
                >
                  {loadingReadStats ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Eye size={13} />
                  )}
                  載入排行
                </button>
              </div>

              <div className="p-4">
                {globalReadStats.length === 0 ? (
                  <div className="h-48 flex flex-col items-center justify-center text-stone-300 gap-2">
                    <Globe2 size={32} />
                    <p className="text-xs font-black tracking-widest">
                      尚未載入全域讀取排行
                    </p>
                    <p className="text-[11px] text-stone-400">
                      需開啟全域上報並累積一段時間
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                    <div className="text-[11px] text-stone-400 font-bold mb-2 px-1">
                      已彙整近 24 小時 {globalRowsCount.toLocaleString()} 筆上報工作階段
                    </div>

                    {globalReadStats.slice(0, 12).map((row, index) => (
                      <div
                        key={row.label}
                        className="bg-white rounded-xl border border-stone-100 p-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-stone-100 text-stone-500 text-[11px] font-black flex items-center justify-center">
                              {index + 1}
                            </span>
                            <p className="text-xs font-black text-stone-700 truncate">
                              {row.label}
                            </p>
                          </div>

                          <p className="text-[10px] text-stone-400 mt-1 ml-8">
                            觸發 {row.triggers.toLocaleString()} 次｜裝置/使用者{" "}
                            {row.users}｜平均 {row.avg.toLocaleString()} docs / 次
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-sm font-black text-blue-600">
                            {row.docs.toLocaleString()}
                          </p>
                          <p className="text-[10px] text-stone-400">docs</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-amber-50/50 border-t border-amber-100/60 text-xs text-amber-700 font-bold leading-relaxed">
            建議只在晚間尖峰或短期診斷期間開啟「全域上報」。此功能採本機累積、低頻彙整，不會每次讀取都寫入資料庫。此版本載入排行採「近 24 小時」並由前端排序，不需要建立 Firestore 複合索引。
          </div>
        </div>

        {/* 稽核日誌區 */}
        <div className="bg-stone-50/50 rounded-3xl p-6 border border-stone-100 shadow-[inset_0_2px_10px_rgba(0,0,0,0.01)] mt-8">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2 text-stone-600">
              <ClipboardList size={18} strokeWidth={2} className="text-stone-400" />
              <span className="font-bold tracking-tight text-sm">
                系統稽核日誌 (SYSTEM LOGS)
              </span>
            </div>

            <div className="flex items-center gap-3">
              {loadingAction && (
                <span className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg font-bold animate-pulse flex items-center gap-1.5 border border-amber-100/50">
                  <Loader2 size={14} className="animate-spin" />
                  執行中...
                </span>
              )}

              {logs.length > 0 && !loadingAction && (
                <button
                  onClick={() => setLogs([])}
                  className="text-xs font-bold text-stone-400 hover:text-rose-500 transition-colors flex items-center gap-1 px-2 py-1"
                >
                  <Trash2 size={14} />
                  清除
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 font-mono text-[13px] h-[280px] overflow-y-auto border border-stone-200/50 shadow-sm space-y-2 selection:bg-amber-100">
            {logs.length === 0 ? (
              <div className="flex h-full items-center justify-center flex-col gap-3 opacity-50">
                <ClipboardList size={36} className="text-stone-300" strokeWidth={1.5} />
                <span className="text-xs font-bold tracking-widest text-stone-400 uppercase">
                  System Ready...
                </span>
              </div>
            ) : (
              logs.map((log) => {
                const isError = log.text.includes("❌");
                const isFix = log.text.includes("✏️");
                const isDel = log.text.includes("🗑️");
                const isSuccess =
                  log.text.includes("✅") ||
                  log.text.includes("🎉") ||
                  log.text.includes("✨") ||
                  log.text.includes("🔄");

                let textColor = "text-stone-500";

                if (isError) textColor = "text-rose-500 font-bold";
                else if (isFix) textColor = "text-amber-600";
                else if (isDel) textColor = "text-stone-400 line-through";
                else if (isSuccess) textColor = "text-stone-800 font-bold";

                return (
                  <div
                    key={log.id}
                    className="border-b border-stone-50 pb-2.5 last:border-0 hover:bg-stone-50 rounded px-2 -mx-2 transition-colors flex items-start gap-3"
                  >
                    <span className="text-stone-400 shrink-0 select-none pt-0.5">
                      [{log.time}]
                    </span>
                    <span className={`${textColor} break-all leading-relaxed`}>
                      {log.text}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </ViewWrapper>
  );
}