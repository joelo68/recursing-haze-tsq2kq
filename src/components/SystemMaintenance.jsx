// src/components/SystemMaintenance.jsx
import React, { useState, useContext } from "react";
import { db } from "../config/firebase";
import { collection, getDocs, doc, writeBatch } from "firebase/firestore";
import { AppContext } from "../AppContext";
import { Loader2, Database, Download, RefreshCw, AlertTriangle, Play } from "lucide-react";

export default function SystemMaintenance() {
  const { currentBrand, userRole, showToast, getCollectionPath } = useContext(AppContext);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  // 權限防護：只允許總監使用
  if (userRole !== "director") {
    return (
      <div className="p-8 text-center text-stone-400 bg-stone-50 rounded-2xl border border-stone-200">
        <AlertTriangle className="mx-auto mb-2" />
        <p>此區域僅限總監存取</p>
      </div>
    );
  }

  const addLog = (msg) => setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);

  // 工具 1: ★ 光速級資料格式深度清洗 (Batch Update) ★
  const handleFixDateFormats = async () => {
    if (!window.confirm(`確定要對【${currentBrand.label}】執行深度日期清洗嗎？\n此操作不可逆，將強制統一所有混亂日期格式。`)) return;
    
    setLoading(true);
    setLogs([]);
    addLog(`🚀 啟動光速深度清洗引擎... 目標品牌：${currentBrand.label}`);
    
    try {
      let totalFixedCount = 0;
      const collectionsToFix = ["daily_reports", "therapist_daily_reports"];
      
      let batch = writeBatch(db);
      let operationCount = 0;

      for (const colName of collectionsToFix) {
        addLog(`📂 正在掃描資料表：${colName}...`);
        const snapshot = await getDocs(getCollectionPath(colName));
        let colFixedCount = 0;

        for (const document of snapshot.docs) {
          const data = document.data();
          if (data.date) {
            let cleanStr = String(data.date).replace(/\//g, '-').trim();
            const parts = cleanStr.split('-');
            if (parts.length === 3) {
              const y = parts[0];
              const m = String(parseInt(parts[1], 10)).padStart(2, '0');
              const d = String(parseInt(parts[2], 10)).padStart(2, '0');
              
              if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                const newDate = `${y}-${m}-${d}`;
                
                if (newDate !== data.date) {
                  // ★★★ 新增詳細 Log 追蹤 ★★★
                  const storeDisplay = data.storeName || data.store || "未知店家";
                  const personDisplay = data.therapistName ? ` - ${data.therapistName}` : "";
                  addLog(`✏️ 修正 [${data.date} ➡️ ${newDate}] ${storeDisplay}${personDisplay}`);

                  batch.update(doc(getCollectionPath(colName), document.id), { date: newDate });
                  colFixedCount++;
                  totalFixedCount++;
                  operationCount++;

                  if (operationCount === 490) {
                    await batch.commit(); 
                    addLog(`⚡ 已批次寫入 ${operationCount} 筆修正...`);
                    batch = writeBatch(db); 
                    operationCount = 0;
                  }
                }
              }
            }
          }
        }
        addLog(`✅ [${colName}] 掃描完畢，發現 ${colFixedCount} 筆需修正。`);
      }

      if (operationCount > 0) {
        await batch.commit();
        addLog(`⚡ 已批次寫入最後 ${operationCount} 筆修正...`);
      }

      addLog(`🎉 深度清洗完美結束！總計修復：${totalFixedCount} 筆資料。`);
      showToast(`清洗完成！共修復 ${totalFixedCount} 筆資料`, "success");
    } catch (error) {
      addLog(`❌ 執行失敗: ${error.message}`);
      showToast("清洗過程發生錯誤", "error");
    } finally {
      setLoading(false);
    }
  };

  // 工具 2: 全量備份匯出
  const handleBackupData = async () => {
    setLoading(true);
    setLogs([]);
    addLog(`📦 正在準備打包 ${currentBrand.label} 所有日報數據...`);

    try {
      const snapshot = await getDocs(getCollectionPath("daily_reports"));
      const allData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const jsonString = JSON.stringify(allData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const fileName = `${currentBrand.id}_backup_${new Date().toISOString().split('T')[0]}.json`;
      
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
      setLoading(false);
    }
  };

  // 工具 3: 強制重整
  const handleHardReset = () => {
    if(!window.confirm("這將清除瀏覽器快取並重新載入系統，確定嗎？")) return;
    addLog(`🔄 正在清除本地快取並強制重載...`);
    localStorage.clear(); 
    window.location.reload(true); 
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-6 bg-stone-800 rounded-full"></div>
        <h2 className="text-xl font-bold text-stone-800">系統維護工具箱</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-all">
          <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 mb-4">
            <Database size={24} />
          </div>
          <h3 className="font-bold text-stone-700 mb-1">資料格式深度標準化</h3>
          <p className="text-xs text-stone-400 mb-4 h-10">光速批次清洗資料庫中混亂的日期格式，統一修正為 YYYY-MM-DD 標準格式。</p>
          <button 
            onClick={handleFixDateFormats} 
            disabled={loading}
            className="w-full py-2 bg-stone-800 text-white rounded-lg text-sm font-bold hover:bg-stone-700 disabled:bg-stone-300 flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? <Loader2 className="animate-spin" size={16}/> : <Play size={16}/>}
            執行深度清洗
          </button>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-all">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 mb-4">
            <Download size={24} />
          </div>
          <h3 className="font-bold text-stone-700 mb-1">全量數據備份</h3>
          <p className="text-xs text-stone-400 mb-4 h-10">下載目前品牌所有歷史日報為 JSON 檔案，以供備份或移轉使用。</p>
          <button 
            onClick={handleBackupData} 
            disabled={loading}
            className="w-full py-2 bg-white border border-stone-200 text-stone-600 rounded-lg text-sm font-bold hover:bg-stone-50 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            <Download size={16}/>
            下載備份
          </button>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-all">
          <div className="w-12 h-12 bg-rose-100 rounded-xl flex items-center justify-center text-rose-600 mb-4">
            <RefreshCw size={24} />
          </div>
          <h3 className="font-bold text-stone-700 mb-1">強制系統重置</h3>
          <p className="text-xs text-stone-400 mb-4 h-10">若遇畫面異常或卡頓，可使用此功能清除快取並重新載入。</p>
          <button 
            onClick={handleHardReset} 
            className="w-full py-2 bg-white border border-rose-100 text-rose-600 rounded-lg text-sm font-bold hover:bg-rose-50 flex items-center justify-center gap-2 transition-colors"
          >
            <RefreshCw size={16}/>
            重置系統
          </button>
        </div>
      </div>

      <div className="bg-stone-900 rounded-2xl p-4 font-mono text-xs text-green-400 h-64 overflow-y-auto shadow-inner border border-stone-800">
        <div className="flex justify-between items-center mb-2 border-b border-stone-800 pb-2">
          <span className="font-bold text-stone-500 tracking-wider">SYSTEM LOGS</span>
          {loading && <span className="text-amber-400 animate-pulse flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> Processing...</span>}
        </div>
        <div className="space-y-1.5">
          {logs.length === 0 && <span className="text-stone-700">系統待命中，請選擇上方工具執行...</span>}
          {logs.map((log, i) => <div key={i} className="break-all">{log}</div>)}
        </div>
      </div>
    </div>
  );
}