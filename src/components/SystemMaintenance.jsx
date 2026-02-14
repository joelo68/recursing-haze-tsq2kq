import React, { useState, useContext } from "react";
import { db } from "../config/firebase";
import { collection, getDocs, doc, writeBatch } from "firebase/firestore";
import { AppContext } from "../AppContext";
import { Loader2, Database, Download, RefreshCw, CheckCircle, AlertTriangle, Play } from "lucide-react";

export default function SystemMaintenance() {
  const { currentBrand, userRole, showToast } = useContext(AppContext);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

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

  // 工具 1: 資料格式修正
  const handleFixDateFormats = async () => {
    if (!confirm(`確定要修正【${currentBrand.name}】所有日期格式嗎？\n這將統一轉為 YYYY-MM-DD 格式。`)) return;
    
    setLoading(true);
    setLogs([]);
    addLog(`🚀 開始掃描 ${currentBrand.name} 資料庫...`);
    
    try {
      const reportsRef = collection(db, "brands", currentBrand.id, "daily_reports");
      const snapshot = await getDocs(reportsRef);
      addLog(`📊 掃描完成，共 ${snapshot.size} 筆資料。`);
      
      let batch = writeBatch(db);
      let batchCount = 0;
      let fixedCount = 0;
      let processed = 0;

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        processed++;
        setProgress(Math.round((processed / snapshot.size) * 100));

        if (data.date && data.date.includes("/")) {
          const newDate = data.date.replace(/\//g, "-");
          const docRef = doc(db, "brands", currentBrand.id, "daily_reports", docSnap.id);
          batch.update(docRef, { date: newDate });
          fixedCount++;
          batchCount++;
        }

        if (batchCount >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          batchCount = 0;
          addLog(`💾 已批次儲存修正...`);
        }
      }

      if (batchCount > 0) await batch.commit();
      
      addLog(`✅ 完成！共修正 ${fixedCount} 筆資料格式。`);
      showToast("日期格式修正完成", "success");
    } catch (error) {
      addLog(`❌ 錯誤: ${error.message}`);
    } finally {
      setLoading(false);
      setProgress(0);
    }
  };

  // 工具 2: 全量備份匯出
  const handleBackupData = async () => {
    setLoading(true);
    setLogs([]);
    addLog(`📦 正在打包 ${currentBrand.name} 所有數據...`);

    try {
      const reportsRef = collection(db, "brands", currentBrand.id, "daily_reports");
      const snapshot = await getDocs(reportsRef);
      
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
      
      addLog(`🎉 匯出成功！檔案: ${fileName}`);
      addLog(`📊 總筆數: ${allData.length}`);
      showToast("備份檔案已下載", "success");
    } catch (error) {
      addLog(`❌ 匯出失敗: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 工具 3: 強制重整
  const handleHardReset = () => {
    if(!confirm("這將清除瀏覽器快取並重新載入，確定嗎？")) return;
    localStorage.clear(); // 清除本地暫存
    window.location.reload(true); // 強制從伺服器重載
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-6 bg-stone-800 rounded-full"></div>
        <h2 className="text-xl font-bold text-stone-800">系統維護工具箱</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 卡片 1: 資料格式清洗 */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-all">
          <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 mb-4">
            <Database size={24} />
          </div>
          <h3 className="font-bold text-stone-700 mb-1">資料格式標準化</h3>
          <p className="text-xs text-stone-400 mb-4 h-10">將資料庫中混亂的 YYYY/MM/DD 統一修正為 YYYY-MM-DD 標準格式。</p>
          <button 
            onClick={handleFixDateFormats} 
            disabled={loading}
            className="w-full py-2 bg-stone-800 text-white rounded-lg text-sm font-bold hover:bg-stone-700 disabled:bg-stone-300 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={16}/> : <Play size={16}/>}
            執行修正
          </button>
        </div>

        {/* 卡片 2: 數據備份 */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-all">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 mb-4">
            <Download size={24} />
          </div>
          <h3 className="font-bold text-stone-700 mb-1">全量數據備份</h3>
          <p className="text-xs text-stone-400 mb-4 h-10">下載目前品牌所有歷史日報為 JSON 檔案，以供備份或移轉使用。</p>
          <button 
            onClick={handleBackupData} 
            disabled={loading}
            className="w-full py-2 bg-white border border-stone-200 text-stone-600 rounded-lg text-sm font-bold hover:bg-stone-50 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Download size={16}/>
            下載備份
          </button>
        </div>

        {/* 卡片 3: 系統重置 */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-all">
          <div className="w-12 h-12 bg-rose-100 rounded-xl flex items-center justify-center text-rose-600 mb-4">
            <RefreshCw size={24} />
          </div>
          <h3 className="font-bold text-stone-700 mb-1">強制系統重置</h3>
          <p className="text-xs text-stone-400 mb-4 h-10">若遇畫面異常或卡頓，可使用此功能清除快取並重新載入。</p>
          <button 
            onClick={handleHardReset} 
            className="w-full py-2 bg-white border border-rose-100 text-rose-600 rounded-lg text-sm font-bold hover:bg-rose-50 flex items-center justify-center gap-2"
          >
            <RefreshCw size={16}/>
            重置系統
          </button>
        </div>
      </div>

      {/* 執行日誌區 */}
      <div className="bg-stone-900 rounded-2xl p-4 font-mono text-xs text-green-400 h-48 overflow-y-auto shadow-inner border border-stone-800">
        <div className="flex justify-between items-center mb-2 border-b border-stone-800 pb-2">
          <span className="font-bold text-stone-500">SYSTEM LOGS</span>
          {loading && <span className="text-amber-400 animate-pulse">Processing... {progress}%</span>}
        </div>
        <div className="space-y-1">
          {logs.length === 0 && <span className="text-stone-700">系統待命中...</span>}
          {logs.map((log, i) => <div key={i}>{log}</div>)}
        </div>
      </div>
    </div>
  );
}