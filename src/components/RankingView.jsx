// src/components/RankingView.jsx
import React, { useState, useMemo, useContext } from "react";
import { Download, TrendingUp, DollarSign, Users, Briefcase, Settings, X, Save, Ban, CheckCircle } from "lucide-react";
import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";

const RankingView = () => {
  const { 
    // ★★★ 1. 改用原始報表資料 (allReports) ★★★
    allReports,
    fmtMoney, 
    fmtNum, 
    budgets, 
    selectedYear, 
    selectedMonth,
    managers,
    auditExclusions,
    handleUpdateAuditExclusions,
    showToast,
    currentBrand
  } = useContext(AppContext);

  const [sortConfig, setSortConfig] = useState({
    key: "achievement",
    direction: "desc",
  });

  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [localExclusions, setLocalExclusions] = useState([]);

  // --- 品牌前綴與清洗邏輯 ---
  const brandPrefix = useMemo(() => {
    let name = "CYJ";
    if (currentBrand) {
      const id = typeof currentBrand === 'string' ? currentBrand : (currentBrand.id || "CYJ");
      const normalizedId = id.toLowerCase();
      if (normalizedId.includes("anniu") || normalizedId.includes("anew")) name = "安妞";
      else if (normalizedId.includes("yibo")) name = "伊啵";
      else name = "CYJ";
    }
    return name;
  }, [currentBrand]);

  const getCoreStoreName = (fullName) => {
    if (!fullName) return "";
    return fullName
      .replace(new RegExp(`^(${brandPrefix}|CYJ|安妞|伊啵|Anew|Yibo)`, 'i'), '')
      .replace(/店$/, '')
      .trim();
  };

  // --- 設定視窗函式 ---
  const openConfigModal = () => {
    setLocalExclusions(auditExclusions || []);
    setIsConfigModalOpen(true);
  };

  const saveConfig = async () => {
    await handleUpdateAuditExclusions(localExclusions);
    setIsConfigModalOpen(false);
    showToast("排除名單已更新", "success");
  };

  const toggleExclusion = (store) => {
    setLocalExclusions(prev => {
      if (prev.includes(store)) return prev.filter(s => s !== store);
      return [...prev, store];
    });
  };

  // ★★★ 2. 核心計算邏輯：直接從 allReports 聚合數據 ★★★
  const processedData = useMemo(() => {
    if (!allReports) return [];

    const targetYear = parseInt(selectedYear);
    const targetMonth = parseInt(selectedMonth);
    const storeMap = {};

    // 1. 遍歷所有報表進行加總
    allReports.forEach(report => {
      // 日期過濾
      const rDate = new Date(report.date);
      if (rDate.getFullYear() !== targetYear || (rDate.getMonth() + 1) !== targetMonth) return;

      const storeName = report.storeName;
      if (!storeName) return;

      // 初始化店家數據容器
      if (!storeMap[storeName]) {
        storeMap[storeName] = {
          name: storeName,
          displayName: getCoreStoreName(storeName),
          manager: "未分配", // 稍後補上
          cashTotal: 0,
          refundTotal: 0,
          accrualTotal: 0,
          operationalAccrualTotal: 0,
          skincareSalesTotal: 0,
          trafficTotal: 0,
          newCustomersTotal: 0,
          newCustomerClosingsTotal: 0
        };
      }

      const d = storeMap[storeName];
      d.cashTotal += (Number(report.cash) || 0);
      d.refundTotal += (Number(report.refund) || 0);
      d.accrualTotal += (Number(report.accrual) || 0);
      d.operationalAccrualTotal += (Number(report.operationalAccrual) || 0);
      d.skincareSalesTotal += (Number(report.skincareSales) || 0);
      d.trafficTotal += (Number(report.traffic) || 0);
      d.newCustomersTotal += (Number(report.newCustomers) || 0);
      d.newCustomerClosingsTotal += (Number(report.newCustomerClosings) || 0);
    });

    // 2. 轉換為陣列並計算衍生指標
    let results = Object.values(storeMap).map(store => {
      // 補上區長資訊
      const coreName = store.displayName;
      const foundManager = Object.keys(managers).find(mgr => managers[mgr].includes(coreName));
      store.manager = foundManager || "未分配";

      // 計算淨現金 (扣除退費)
      const netCash = store.cashTotal - store.refundTotal;
      store.cashTotal = netCash; // 更新為淨額以便顯示

      // 讀取目標
      const budgetKey = `${store.name}_${targetYear}_${targetMonth}`;
      const budgetData = budgets[budgetKey];
      const cashTarget = budgetData ? Number(budgetData.cashTarget || 0) : 0;
      const accrualTarget = budgetData ? Number(budgetData.accrualTarget || 0) : 0;

      // 計算達成率與客單
      return {
        ...store,
        cashTarget,
        achievement: cashTarget > 0 ? (netCash / cashTarget) * 100 : 0,
        accrualTarget,
        accrualAchievement: accrualTarget > 0 ? (store.accrualTotal / accrualTarget) * 100 : 0,
        trafficASP: store.trafficTotal > 0 ? Math.round(store.operationalAccrualTotal / store.trafficTotal) : 0
      };
    });

    // 3. 過濾排除名單
    results = results.filter(store => !(auditExclusions || []).includes(store.displayName));

    return results;
  }, [allReports, budgets, selectedYear, selectedMonth, auditExclusions, managers, brandPrefix]); // brandPrefix 用於 getCoreStoreName

  // --- 排序邏輯 ---
  const sortedData = useMemo(() => {
    let items = [...processedData];
    if (sortConfig.key) {
      items.sort((a, b) => {
        const valA = a[sortConfig.key] || 0;
        const valB = b[sortConfig.key] || 0;
        if (valA < valB) return sortConfig.direction === "ascending" ? -1 : 1;
        if (valA > valB) return sortConfig.direction === "ascending" ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [processedData, sortConfig]);

  const requestSort = (key) =>
    setSortConfig({
      key,
      direction:
        sortConfig.key === key && sortConfig.direction === "desc"
          ? "ascending"
          : "desc",
    });

  // --- CSV 匯出 ---
  const handleExportCSV = () => {
    const headers = [
      "排名,店名,區域,現金業績,現金達成率,權責業績,權責目標,權責達成率,保養品業績,課程操作人數,消耗客單,新客數,新客留單",
    ];
    const rows = sortedData.map((store, index) => {
      return [
        index + 1,
        store.displayName,
        store.manager,
        store.cashTotal || 0,
        (store.achievement || 0).toFixed(2) + "%",
        store.accrualTotal || 0,
        store.accrualTarget || 0,
        (store.accrualAchievement || 0).toFixed(2) + "%",
        store.skincareSalesTotal || 0,
        store.trafficTotal || 0,
        store.trafficASP || 0,
        store.newCustomersTotal || 0,
        store.newCustomerClosingsTotal || 0,
      ].join(",");
    });

    const csvContent = "\uFEFF" + [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${brandPrefix}_詳細報表_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  // --- 手機版卡片 ---
  const MobileCard = ({ store, index }) => {
    return (
      <div className="bg-white p-4 rounded-2xl border border-stone-100 shadow-sm mb-3">
        <div className="flex justify-between items-center mb-3 pb-3 border-b border-stone-50">
          <div className="flex items-center gap-3">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${index < 3 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500'}`}>
              {index + 1}
            </span>
            <div>
              <h4 className="font-bold text-stone-700 text-lg">{store.displayName}</h4>
              <p className="text-xs text-stone-400">{store.manager}區</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-stone-400 font-bold uppercase">現金達成</div>
            <div className={`text-xl font-mono font-bold ${store.achievement >= 100 ? 'text-emerald-500' : 'text-stone-700'}`}>
              {store.achievement.toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-stone-400 flex items-center gap-1"><DollarSign size={10}/> 現金業績</p>
            <p className="font-mono font-bold text-stone-700">{fmtMoney(store.cashTotal)}</p>
          </div>
          <div className="space-y-1">
             <p className="text-xs text-stone-400 flex items-center gap-1"><Briefcase size={10}/> 權責達成</p>
             <p className={`font-mono font-bold ${store.accrualAchievement >= 100 ? 'text-emerald-600' : 'text-blue-600'}`}>
               {store.accrualAchievement.toFixed(1)}%
             </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-stone-400 flex items-center gap-1"><TrendingUp size={10}/> 權責業績</p>
            <p className="font-mono font-bold text-stone-600">{fmtMoney(store.accrualTotal)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-stone-400 flex items-center gap-1"><Users size={10}/> 客流/新客</p>
            <p className="font-mono text-stone-600 text-sm">
              {fmtNum(store.trafficTotal)} / <span className="text-stone-800 font-bold">{fmtNum(store.newCustomersTotal)}</span>
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <ViewWrapper>
      <Card title={`${brandPrefix} 詳細報表與排名`} subtitle="各店關鍵指標排名分析">
        <div className="flex flex-col sm:flex-row justify-end mb-4 gap-2">
          <button
            onClick={openConfigModal}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-stone-100 text-stone-600 rounded-xl text-sm font-bold hover:bg-stone-200 transition-colors"
          >
            <Settings size={16} /> 設定排除店家
          </button>
          
          <button
            onClick={handleExportCSV}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors border border-emerald-100"
          >
            <Download size={16} /> 匯出 CSV
          </button>
        </div>

        <div className="block md:hidden">
          {sortedData.map((store, index) => (
            <MobileCard key={store.name} store={store} index={index} />
          ))}
        </div>

        <div className="hidden md:block w-full overflow-hidden rounded-2xl border border-stone-100">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="bg-stone-50 font-bold text-xs text-stone-500 uppercase sticky top-0 z-10">
                <tr>
                  <th className="p-4 w-16 text-center">排名</th>
                  <th className="p-4 cursor-pointer hover:text-stone-700" onClick={() => requestSort("displayName")}>店名</th>
                  <th className="p-4 cursor-pointer text-right hover:text-stone-700" onClick={() => requestSort("cashTotal")}>現金業績</th>
                  <th className="p-4 cursor-pointer text-right hover:text-stone-700" onClick={() => requestSort("achievement")}>現金達成</th>
                  
                  <th className="p-4 cursor-pointer text-right hover:text-blue-700 text-blue-600/80" onClick={() => requestSort("accrualTotal")}>權責業績</th>
                  <th className="p-4 cursor-pointer text-right hover:text-blue-700 text-blue-600/80" onClick={() => requestSort("accrualAchievement")}>權責達成</th>
                  
                  <th className="p-4 cursor-pointer text-right hover:text-stone-700" onClick={() => requestSort("trafficTotal")}>客流</th>
                  <th className="p-4 cursor-pointer text-right hover:text-stone-700" onClick={() => requestSort("newCustomersTotal")}>新客數</th>
                  <th className="p-4 cursor-pointer text-right hover:text-stone-700" onClick={() => requestSort("newCustomerClosingsTotal")}>留單</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-stone-50">
                {sortedData.map((store, index) => (
                  <tr key={store.name} className="hover:bg-stone-50 transition-colors">
                    <td className="p-4 text-center text-stone-400 font-bold">{index + 1}</td>
                    <td className="p-4 font-bold text-stone-700">{store.displayName}</td>
                    <td className="p-4 text-right font-mono font-bold text-stone-700">{fmtMoney(store.cashTotal)}</td>
                    
                    <td className={`p-4 text-right font-mono font-bold ${store.achievement >= 100 ? "text-emerald-500" : "text-amber-500"}`}>
                      {store.achievement.toFixed(1)}%
                    </td>

                    <td className="p-4 text-right font-mono font-bold text-blue-600">
                      {fmtMoney(store.accrualTotal)}
                    </td>
                    
                    <td className={`p-4 text-right font-mono font-bold ${store.accrualAchievement >= 100 ? "text-emerald-500" : "text-blue-400"}`}>
                      {store.accrualAchievement.toFixed(1)}%
                    </td>

                    <td className="p-4 text-right font-mono text-stone-600">{fmtNum(store.trafficTotal)}</td>
                    <td className="p-4 text-right font-mono text-stone-600">{fmtNum(store.newCustomersTotal)}</td>
                    <td className="p-4 text-right font-mono text-stone-600">{fmtNum(store.newCustomerClosingsTotal)}</td>
                  </tr>
                ))}
                {sortedData.length === 0 && (
                  <tr><td colSpan={13} className="p-8 text-center text-stone-400">目前尚無資料</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-stone-800 text-white p-4 font-bold text-lg flex justify-between items-center shrink-0">
              <span className="flex items-center gap-2"><Ban size={20} className="text-rose-400"/> 設定排除店家 ({brandPrefix})</span>
              <button onClick={() => setIsConfigModalOpen(false)} className="hover:bg-white/10 p-1 rounded-lg transition-colors"><X size={20}/></button>
            </div>
            <div className="p-4 bg-stone-50 border-b border-stone-200 shrink-0 text-sm text-stone-500">
              <p>勾選的店家將 <span className="font-bold text-rose-500">不會</span> 出現在詳細報表與排名中。</p>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              {Object.entries(managers).map(([mgr, stores]) => (
                <div key={mgr}>
                  <h4 className="font-bold text-stone-400 text-xs uppercase mb-2 ml-1">{mgr} 區</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {stores.map(store => {
                      const isExcluded = localExclusions.includes(store);
                      return (
                        <button
                          key={store}
                          onClick={() => toggleExclusion(store)}
                          className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 ${
                            isExcluded 
                              ? "bg-rose-50 border-rose-500 text-rose-600 shadow-sm" 
                              : "bg-white border-stone-200 text-stone-500 hover:border-stone-400"
                          }`}
                        >
                          {isExcluded && <CheckCircle size={14}/>}
                          {store}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-stone-100 bg-white shrink-0 flex justify-end gap-3">
              <button onClick={() => setIsConfigModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-stone-500 hover:bg-stone-50">取消</button>
              <button onClick={saveConfig} className="px-6 py-2.5 rounded-xl font-bold bg-stone-800 text-white hover:bg-stone-700 shadow-lg flex items-center gap-2">
                <Save size={18}/> 儲存設定
              </button>
            </div>
          </div>
        </div>
      )}
    </ViewWrapper>
  );
};

export default RankingView;