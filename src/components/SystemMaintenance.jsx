// src/components/SystemMaintenance.jsx
import React, { useState, useContext } from "react";
import { db } from "../config/firebase";
import { getDocs, doc, writeBatch } from "firebase/firestore"; 
import { AppContext } from "../AppContext";
import { Loader2, Database, Download, RefreshCw, AlertTriangle, Play, Scissors, ClipboardList, Trash2 } from "lucide-react";

export default function SystemMaintenance() {
  const { currentBrand, userRole, showToast, getCollectionPath } = useContext(AppContext);
  const [logs, setLogs] = useState([]);
  
  // ★ 修正 Bug 1：將單一 boolean 改為紀錄具體執行動作的 ID
  const [loadingAction, setLoadingAction] = useState(null);

  // 權限防護
  if (userRole !== "director") {
    return (
      <div className="p-8 text-center text-stone-400 bg-stone-50 rounded-2xl border border-stone-200 animate-in fade-in duration-300">
        <AlertTriangle className="mx-auto mb-2 w-8 h-8 text-stone-300" />
        <p className="font-semibold">此區域僅限總監存取</p>
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

            // ★ 修正 Bug 2：強化版日期格式捕捉器 (處理 YYYYMMDD, YYYY.MM.DD, 年月日 等各種奇葩格式)
            if (/^\d{8}$/.test(origDate)) {
                // 處理連續數字無符號: 20260327
                newDate = `${origDate.substring(0,4)}-${origDate.substring(4,6)}-${origDate.substring(6,8)}`;
            } else {
                // 將 / . 年 月 統一替換成 -，並移除 日
                let cleanStr = origDate.replace(/[\/\.年月]/g, '-').replace(/日/g, '').replace(/-+/g, '-').trim();
                cleanStr = cleanStr.replace(/^-+|-+$/g, ''); // 移除頭尾可能多餘的 -
                
                const parts = cleanStr.split('-');
                if (parts.length === 3) {
                  const y = parts[0];
                  const m = String(parseInt(parts[1], 10)).padStart(2, '0');
                  const d = String(parseInt(parts[2], 10)).padStart(2, '0');
                  
                  if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                    newDate = `${y}-${m}-${d}`;
                  }
                }
            }

            // 如果格式被修正了，就寫入資料庫並記錄 Log
            if (newDate !== origDate) {
              const storeDisplay = data.storeName || data.store || "未知店家";
              const personDisplay = data.therapistName ? ` - ${data.therapistName}` : "";
              addLog(`✏️ 修正 [${origDate} ➡️ ${newDate}] ${storeDisplay}${personDisplay}`);

              batch.update(doc(getCollectionPath(colName), docSnap.id), { date: newDate });
              colFixedCount++; totalFixedCount++; operationCount++;

              // Firestore 批次寫入上限是 500
              if (operationCount === 490) {
                await batch.commit(); 
                batch = writeBatch(db); 
                operationCount = 0;
              }
            }
          }
        }
        // ★ 新增：明確印出掃描總數，證明系統有去檢查其他品牌的資料庫
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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <div className="w-1.5 h-8 bg-amber-500 rounded-full shadow-sm shadow-amber-200"></div>
        <h1 className="text-3xl font-extrabold text-stone-900 tracking-tighter">系統維護控制台</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { id: 'fixDates', icon: Database, bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100', title: '格式標準化', desc: '批次統一混亂日期格式，修正為 YYYY-MM-DD。', action: handleFixDateFormats, btnTxt: '執行清洗' },
          { id: 'removeDups', icon: Scissors, bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100', title: '重複清道夫', desc: '掃描同天同人重複送出紀錄，刪除多餘垃圾。', action: handleRemoveDuplicates, btnTxt: '掃描清除' },
          { id: 'backup', icon: Download, bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100', title: '全量數據備份', desc: '下載品牌所有歷史日報為 JSON 供備份使用。', action: handleBackupData, btnTxt: '下載備份' },
          { id: 'reset', icon: RefreshCw, bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-100', title: '強制系統重置', desc: '若遇畫面異常或卡頓，可清除快取並重載。', action: handleHardReset, btnTxt: '強制重置', danger: true },
        ].map((tool, i) => {
          const Icon = tool.icon;
          // ★ 修改：透過比對 loadingAction 來決定要不要禁用按鈕
          const isThisLoading = loadingAction === tool.id;
          const isAnyLoading = loadingAction !== null;

          return (
            <div key={i} className="bg-white p-7 rounded-3xl border border-stone-100 shadow-sm shadow-stone-100/70 hover:shadow-xl hover:shadow-amber-950/5 hover:-translate-y-1 hover:border-amber-100 transition-all duration-300 flex flex-col group">
              <div className={`w-14 h-14 ${tool.bg} ${tool.border} rounded-2xl flex items-center justify-center ${tool.text} mb-6 border shadow-inner transition-colors duration-300 group-hover:bg-white group-hover:shadow-none`}>
                <Icon size={28} strokeWidth={1.5} />
              </div>
              <h3 className="text-xl font-bold text-stone-800 mb-1.5 tracking-tight">{tool.title}</h3>
              <p className="text-sm text-stone-500 mb-6 flex-1 leading-relaxed">{tool.desc}</p>
              {tool.danger ? (
                <button onClick={tool.action} disabled={isAnyLoading} className="w-full py-3 bg-rose-50 text-rose-600 border border-rose-100 rounded-xl text-sm font-semibold hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 active:scale-95 shadow-sm shadow-rose-100/50">
                  <Icon size={16}/> {tool.btnTxt}
                </button>
              ) : (
                <button onClick={tool.action} disabled={isAnyLoading} className="w-full py-3 bg-white text-stone-700 border border-stone-200 rounded-xl text-sm font-semibold hover:bg-stone-50 hover:border-stone-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 active:scale-95 group-hover:bg-amber-50 group-hover:text-amber-700 group-hover:border-amber-100 shadow-sm">
                  {/* ★ 修正 Bug 1：只有被按下的那顆按鈕才會轉圈圈 */}
                  {isThisLoading ? <Loader2 className="animate-spin text-amber-600" size={16}/> : <Icon size={16} className="fill-current"/>}
                  {tool.btnTxt}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-3xl p-7 shadow-sm shadow-stone-100/70 border border-stone-100 transition-all hover:shadow-lg hover:border-amber-50 hover:shadow-amber-950/5">
        <div className="flex justify-between items-center mb-5 pb-5 border-b border-stone-100">
          <div className="flex items-center gap-3">
             <ClipboardList className="text-stone-400" />
             <span className="font-extrabold text-stone-900 tracking-tight text-lg">系統稽核日誌 (SYSTEM LOGS)</span>
          </div>
          {loadingAction && <span className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full font-semibold animate-pulse flex items-center gap-1.5"><Loader2 size={12} className="animate-spin"/> 維護中，請稍候...</span>}
          {logs.length > 0 && !loadingAction && <button onClick={() => setLogs([])} className="text-xs text-stone-400 hover:text-stone-600 flex items-center gap-1.5 px-2 py-1 hover:bg-stone-100 rounded-md transition-colors"><Trash2 size={14}/> 清除日誌</button>}
        </div>
        
        <div className="bg-gradient-to-b from-stone-50 to-white rounded-2xl p-6 font-mono text-sm h-80 overflow-y-auto shadow-inner border border-stone-100 space-y-2.5 selection:bg-amber-100">
          {logs.length === 0 && (
            <div className="flex h-full items-center justify-center flex-col gap-3 text-stone-300">
              <div className="p-4 bg-white rounded-full shadow-sm border border-stone-100"><ClipboardList size={32} strokeWidth={1.5} /></div>
              <span className="text-xs font-semibold tracking-wider text-stone-400">系統待命中，請選擇上方工具執行...</span>
            </div>
          )}
          {logs.map((log) => {
            const isError = log.text.includes('❌');
            const isFix = log.text.includes('✏️');
            const isDel = log.text.includes('🗑️');
            const isSuccess = log.text.includes('✅') || log.text.includes('🎉') || log.text.includes('✨');
            
            let textColor = 'text-stone-600';
            if (isError) textColor = 'text-rose-500';
            else if (isFix) textColor = 'text-amber-600';
            else if (isDel) textColor = 'text-stone-400 line-through';
            else if (isSuccess) textColor = 'text-stone-900 font-bold';

            return (
              <div key={log.id} className="border-b border-stone-100/50 pb-2 last:border-0 hover:bg-stone-100/50 rounded px-2 -mx-2 transition-colors flex gap-2">
                <span className="text-stone-400 shrink-0">[{log.time}]</span>
                <span className={`${textColor} break-all`}>{log.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}