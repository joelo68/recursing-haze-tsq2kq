// src/components/SystemMaintenance.jsx
import React, { useState, useContext } from "react";
import { db } from "../config/firebase";
import { getDocs, doc, writeBatch } from "firebase/firestore"; 
import { AppContext } from "../AppContext";
import { Loader2, Database, Download, RefreshCw, AlertTriangle, Play, Scissors, ClipboardList, Trash2, Calendar, Settings } from "lucide-react";

export default function SystemMaintenance() {
  const { currentBrand, userRole, showToast, getCollectionPath } = useContext(AppContext);
  const [logs, setLogs] = useState([]);
  
  const [loadingAction, setLoadingAction] = useState(null);
  const [calMonth, setCalMonth] = useState(new Date().toISOString().substring(0, 7));

  // 權限防護
  if (userRole !== "director") {
    return (
      <div className="p-8 text-center text-stone-400 bg-stone-50 rounded-3xl border border-stone-200 animate-in fade-in duration-300 flex flex-col items-center justify-center min-h-[300px]">
        <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4">
          <AlertTriangle className="w-8 h-8 text-stone-300" />
        </div>
        <p className="font-bold text-lg text-stone-600">系統維護區塊</p>
        <p className="text-sm mt-1">此區域僅限集團總監存取</p>
      </div>
    );
  }

  const addLog = (msg) => {
    const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    setLogs((prev) => [{ id: Date.now() + Math.random(), time: timeStr, text: msg }, ...prev]);
  };

  // ==========================================
  // 工具 1: 光速級資料格式深度清洗
  // ==========================================
  const handleFixDateFormats = async () => {
    const brandName = currentBrand?.label || "目前品牌";
    if (!window.confirm(`確定要對【${brandName}】執行深度日期清洗嗎？\n此操作不可逆，將強制統一所有混亂日期格式。`)) return;
    
    setLoadingAction('fixDates'); 
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
            let origDate = String(data.date).trim();
            let newDate = origDate;

            if (/^\d{8}$/.test(origDate)) {
                newDate = `${origDate.substring(0,4)}-${origDate.substring(4,6)}-${origDate.substring(6,8)}`;
            } else {
                let cleanStr = origDate.replace(/[\/\.年月]/g, '-').replace(/日/g, '').replace(/-+/g, '-').trim();
                cleanStr = cleanStr.replace(/^-+|-+$/g, ''); 
                
                const parts = cleanStr.split('-');
                if (parts.length === 3) {
                  const y = parts[0];
                  const m = String(parseInt(parts[1], 10)).padStart(2, '0');
                  const d = String(parseInt(parts[2], 10)).padStart(2, '0');
                  if (!isNaN(y) && !isNaN(m) && !isNaN(d)) newDate = `${y}-${m}-${d}`;
                }
            }

            if (newDate !== origDate) {
              const storeDisplay = data.storeName || data.store || "未知店家";
              const personDisplay = data.therapistName ? ` - ${data.therapistName}` : "";
              addLog(`✏️ 修正 [${origDate} ➡️ ${newDate}] ${storeDisplay}${personDisplay}`);

              batch.update(doc(getCollectionPath(colName), docSnap.id), { date: newDate });
              colFixedCount++; totalFixedCount++; operationCount++;

              if (operationCount === 490) {
                await batch.commit(); 
                batch = writeBatch(db); 
                operationCount = 0;
              }
            }
          }
        }
        addLog(`✅ [${colName}] 掃描完畢，共檢查 ${snapshot.size} 筆，發現 ${colFixedCount} 筆需修正。`);
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
    if (!window.confirm(`確定要啟動【重複數據清道夫】嗎？\n系統會掃描同一天、同店、同人的重複報表，並自動「保留最新的一筆、刪除舊的」。此操作不可逆！`)) return;

    setLoadingAction('removeDups'); 
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
              const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
              const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
              return timeB - timeA; 
            });

            const duplicatesToDelete = records.slice(1);

            for (const delRecord of duplicatesToDelete) {
              const storeDisplay = delRecord.storeName || delRecord.store || "未知店家";
              const personDisplay = delRecord.therapistName ? ` - ${delRecord.therapistName}` : "";

              addLog(`🗑️ 發現重複！移除 ➡️ [${delRecord.date}] ${storeDisplay}${personDisplay}`);
              batch.delete(doc(getCollectionPath(colName), delRecord.id));
              
              colDuplicateCount++; totalDeletedCount++; operationCount++;

              if (operationCount === 490) {
                await batch.commit();
                batch = writeBatch(db);
                operationCount = 0;
              }
            }
          }
        }
        addLog(`✅ [${colName}] 分析完畢，共檢查 ${snapshot.size} 筆，清除 ${colDuplicateCount} 筆重複垃圾。`);
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
    
    setLoadingAction('backup'); 
    setLogs([]);
    addLog(`📦 正在準備打包 ${brandName} 所有日報數據...`);

    try {
      const snapshot = await getDocs(getCollectionPath("daily_reports"));
      const allData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const jsonString = JSON.stringify(allData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const fileName = `${brandId}_backup_${new Date().toISOString().split('T')[0]}.json`;
      
      link.href = url; link.download = fileName;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      
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
    if(!window.confirm("這將清除瀏覽器快取並重新載入系統，確定嗎？")) return;
    addLog(`🔄 正在清除本地快取並強制重載...`);
    localStorage.clear(); 
    window.location.reload(true); 
  };

  // ==========================================
  // 工具 5: 數據一致性校準器
  // ==========================================
  const handleCalibrateData = async () => {
    const brandId = currentBrand?.id || 'cyj';
    if (!window.confirm(`確定要校準【${brandId}】在 ${calMonth} 的數據嗎？\n此操作將重新掃描當月所有日報並強制修正彙整表與達成率。`)) return;

    setLoadingAction('calibrate');
    setLogs([]); 
    addLog(`🔄 啟動數據校準引擎... 目標: ${brandId}, 月份: ${calMonth}`);

    try {
      const functionUrl = "https://recalculatemonthlydata-hyhcwrnyaa-uc.a.run.app"; 
      const response = await fetch(`${functionUrl}?brandId=${brandId}&yearMonth=${calMonth}`);
      
      if (!response.ok) throw new Error("伺服器回應異常");
      
      const result = await response.text();
      addLog(result);
      showToast("數據校準完成", "success");
    } catch (err) {
      addLog(`❌ 校準失敗: ${err.message}`);
      showToast("校準失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  // ============================================================================
  // ★ 全新 UI 設計：優雅條列式面板 (List View)
  // ============================================================================
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-5xl mx-auto">
      
      {/* 標題區 */}
      <div className="flex items-center gap-4 bg-white p-6 rounded-3xl border border-stone-100 shadow-sm">
        <div className="w-12 h-12 bg-amber-50 rounded-2xl border border-amber-100 flex items-center justify-center">
          <Settings className="text-amber-600" size={24} strokeWidth={1.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-stone-800 tracking-tight">系統維護控制台</h1>
          <p className="text-sm text-stone-500 mt-1">執行核心資料庫的清理、備份與效能校準作業。</p>
        </div>
      </div>

      {/* 條列式工具區 */}
      <div className="space-y-4">
        {[
          { id: 'fixDates', icon: Database, iconBg: 'bg-indigo-50 text-indigo-600 border-indigo-100', title: '格式標準化', desc: '自動掃描資料庫，並批次統一所有混亂的日期格式為標準的 YYYY-MM-DD。', action: handleFixDateFormats, btnTxt: '執行清洗' },
          { id: 'removeDups', icon: Scissors, iconBg: 'bg-purple-50 text-purple-600 border-purple-100', title: '重複清道夫', desc: '偵測同一天、同店、同人的異常重複報表，並自動保留最新紀錄以清除垃圾數據。', action: handleRemoveDuplicates, btnTxt: '掃描清除' },
          { id: 'backup', icon: Download, iconBg: 'bg-blue-50 text-blue-600 border-blue-100', title: '全量數據備份', desc: '將當前品牌的所有歷史日報完整匯出為 JSON 檔案，提供離線備份使用。', action: handleBackupData, btnTxt: '下載備份' },
          { id: 'reset', icon: RefreshCw, iconBg: 'bg-rose-50 text-rose-600 border-rose-100', title: '強制系統重置', desc: '當系統畫面發生異常或長時間未更新時，點擊此按鈕清除本地快取並強制重載。', action: handleHardReset, btnTxt: '重置快取', danger: true },
          { id: 'calibrate', icon: Play, iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-100', title: '數據一致性校準', desc: '當儀表板與日報數字出現落差時，可針對指定月份啟動強制重新盤點與校正。', action: handleCalibrateData, btnTxt: '啟動校準', highlight: true },
        ].map((tool, i) => {
          const Icon = tool.icon;
          const isThisLoading = loadingAction === tool.id;
          const isAnyLoading = loadingAction !== null;

          return (
            <div key={i} className={`group bg-white p-5 rounded-2xl border transition-all duration-300 flex flex-col md:flex-row items-start md:items-center gap-5 ${tool.highlight ? 'border-amber-200 shadow-sm' : 'border-stone-200 hover:border-amber-300 hover:shadow-md'}`}>
              
              {/* 圖示區 */}
              <div className={`w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center border ${tool.iconBg} shadow-inner`}>
                <Icon size={26} strokeWidth={1.5} />
              </div>

              {/* 文字說明區 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-lg font-bold text-stone-800 tracking-tight">{tool.title}</h3>
                  {tool.danger && <span className="text-[10px] font-bold bg-rose-100 text-rose-600 px-2 py-0.5 rounded-md border border-rose-200">風險操作</span>}
                  {tool.highlight && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200">推薦工具</span>}
                </div>
                <p className="text-sm text-stone-500 leading-relaxed pr-4">{tool.desc}</p>

                {/* 工具 5 專用的月份選擇器，優雅地嵌在敘述下方 */}
                {tool.id === 'calibrate' && (
                  <div className="mt-4 flex items-center gap-3 bg-stone-50 px-4 py-2 rounded-xl border border-stone-200 w-fit transition-colors group-hover:bg-white group-hover:border-amber-200">
                    <Calendar size={16} className="text-stone-400" />
                    <span className="text-sm font-bold text-stone-600">指定月份：</span>
                    <input 
                      type="month" 
                      value={calMonth} 
                      onChange={(e) => setCalMonth(e.target.value)} 
                      className="bg-transparent font-bold text-stone-800 outline-none w-28 cursor-pointer"
                    />
                  </div>
                )}
              </div>

              {/* 操作按鈕區 */}
              <div className="w-full md:w-auto shrink-0 mt-2 md:mt-0 pt-4 md:pt-0 border-t md:border-0 border-stone-100">
                <button 
                  onClick={tool.action} 
                  disabled={isAnyLoading} 
                  className={`w-full md:w-36 py-3 rounded-xl text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                    ${tool.danger 
                      ? 'bg-white border border-rose-200 text-rose-600 hover:bg-rose-50' 
                      : tool.highlight
                        ? 'bg-stone-800 text-white hover:bg-stone-700 hover:shadow-md'
                        : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50 hover:text-stone-800 hover:border-stone-300'
                    }
                  `}
                >
                  {isThisLoading ? <Loader2 className="animate-spin" size={16}/> : <Icon size={16}/>}
                  {tool.btnTxt}
                </button>
              </div>

            </div>
          );
        })}
      </div>

      {/* 稽核日誌區 (移除厚重邊框，改為無邊框內嵌設計) */}
      <div className="bg-stone-50 rounded-3xl p-6 border border-stone-200 shadow-inner">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
             <ClipboardList className="text-stone-400" size={18} />
             <span className="font-bold text-stone-700 tracking-tight text-sm">系統稽核日誌 (SYSTEM LOGS)</span>
          </div>
          {loadingAction && <span className="text-xs text-amber-600 bg-amber-100 px-3 py-1 rounded-full font-bold animate-pulse flex items-center gap-1.5"><Loader2 size={12} className="animate-spin"/> 執行中...</span>}
          {logs.length > 0 && !loadingAction && <button onClick={() => setLogs([])} className="text-xs text-stone-500 hover:text-rose-600 flex items-center gap-1 px-3 py-1.5 bg-white border border-stone-200 hover:border-rose-200 rounded-lg transition-colors shadow-sm"><Trash2 size={12}/> 清除紀錄</button>}
        </div>
        
        <div className="bg-white rounded-2xl p-5 font-mono text-[13px] h-[300px] overflow-y-auto border border-stone-200/60 shadow-sm space-y-2 selection:bg-amber-100">
          {logs.length === 0 ? (
            <div className="flex h-full items-center justify-center flex-col gap-3 opacity-60">
              <ClipboardList size={32} className="text-stone-300" strokeWidth={1.5} />
              <span className="text-xs font-bold tracking-wider text-stone-400 uppercase">System Ready...</span>
            </div>
          ) : (
            logs.map((log) => {
              const isError = log.text.includes('❌');
              const isFix = log.text.includes('✏️');
              const isDel = log.text.includes('🗑️');
              const isSuccess = log.text.includes('✅') || log.text.includes('🎉') || log.text.includes('✨') || log.text.includes('🔄');
              
              let textColor = 'text-stone-600';
              if (isError) textColor = 'text-rose-500';
              else if (isFix) textColor = 'text-amber-600';
              else if (isDel) textColor = 'text-stone-400 line-through';
              else if (isSuccess) textColor = 'text-stone-800 font-bold';

              return (
                <div key={log.id} className="border-b border-stone-100/50 pb-2 last:border-0 hover:bg-stone-50 rounded transition-colors flex gap-2">
                  <span className="text-stone-400 shrink-0 select-none">[{log.time}]</span>
                  <span className={`${textColor} break-all`}>{log.text}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}