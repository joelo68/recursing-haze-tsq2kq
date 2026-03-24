// src/components/DailyView.jsx
import React, { useContext, useMemo, useState } from "react";
import { 
  Calendar, Search, DollarSign, CreditCard, Users, Sparkles, 
  AlertCircle, TrendingUp, CheckCircle, Map as MapIcon, Store as StoreIcon,
  Settings, X, Ban, Save 
} from "lucide-react";
import { ViewWrapper, Card } from "./SharedUI";
import { AppContext } from "../AppContext";
import SmartDatePicker from "./SmartDatePicker"; // ★ 引入智慧日曆元件

const DailyView = () => {
  const { 
    fmtMoney, fmtNum, userRole, currentUser, 
    allReports, managers, currentBrand,
    auditExclusions, handleUpdateAuditExclusions, showToast 
  } = useContext(AppContext);

  // 預設日期為「昨天」
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });

  // ★ 取得「今天」的日期字串，作為未來日期的阻擋上限
  const today = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: 'cash', direction: 'desc' });

  // 設定視窗專用狀態
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [localExclusions, setLocalExclusions] = useState([]);

  // 品牌與權限邏輯
  const { brandInfo, brandPrefix } = useMemo(() => {
    let id = "CYJ", name = "CYJ"; 
    if (currentBrand) {
      if (typeof currentBrand === 'string') id = currentBrand;
      else if (typeof currentBrand === 'object') { id = currentBrand.id || "CYJ"; name = currentBrand.name || currentBrand.label || id; }
    }
    const normalizedId = id.toLowerCase();
    if (normalizedId.includes("anniu") || normalizedId.includes("anew")) name = "安妞";
    else if (normalizedId.includes("yibo")) name = "伊啵";
    return { brandInfo: { id: normalizedId, name }, brandPrefix: name };
  }, [currentBrand]);

  const cleanName = useMemo(() => (name) => {
    if (!name) return "";
    let core = String(name).replace(new RegExp(`^(${brandPrefix}|CYJ|Anew|Yibo|安妞|伊啵)`, 'i'), '').trim();
    if (core === "新店") return "新店"; 
    return core.replace(/店$/, '').trim();
  }, [brandPrefix]);

  const baseVisibleStores = useMemo(() => {
    if (userRole === 'director' || userRole === 'trainer' || userRole === 'therapist') return Object.values(managers).flat().map(cleanName).filter(Boolean);
    if (userRole === 'manager' && currentUser) return (managers[currentUser.name] || []).map(cleanName).filter(Boolean);
    if (userRole === 'store' && currentUser) return (currentUser.stores || [currentUser.storeName]).map(cleanName).filter(Boolean);
    return []; 
  }, [userRole, currentUser, managers, cleanName]);

  const groupedStoresForFilter = useMemo(() => {
    const groups = {};
    const availableSet = new Set(baseVisibleStores.map(s => `${brandPrefix}${s}店`));
    Object.entries(managers || {}).forEach(([mgrName, rawStores]) => {
        const mgrValidStores = [];
        (rawStores || []).forEach(rs => {
            const fullName = `${brandPrefix}${cleanName(rs)}店`;
            if (availableSet.has(fullName) && !mgrValidStores.includes(fullName)) mgrValidStores.push(fullName);
        });
        if (mgrValidStores.length > 0) groups[mgrName] = mgrValidStores.sort();
    });
    return groups;
  }, [managers, baseVisibleStores, cleanName, brandPrefix]);

  const availableStoresForDropdown = useMemo(() => {
    if (selectedManager && groupedStoresForFilter[selectedManager]) return groupedStoresForFilter[selectedManager];
    return Object.values(groupedStoresForFilter).flat().sort();
  }, [selectedManager, groupedStoresForFilter]);

  const effectiveStores = useMemo(() => {
    if (selectedStore) return [cleanName(selectedStore)];
    if (selectedManager) return (managers[selectedManager] || []).map(cleanName).filter(Boolean);
    return baseVisibleStores;
  }, [baseVisibleStores, selectedStore, selectedManager, managers, cleanName]);

  // 核心資料處理：抓取選定日期的資料 (加入黑名單排除)
  const dailyData = useMemo(() => {
    const targetDateObj = new Date(selectedDate);
    const targetY = targetDateObj.getFullYear();
    const targetM = targetDateObj.getMonth() + 1;
    const targetD = targetDateObj.getDate();

    const storeDataMap = {};
    let totalCash = 0, totalAccrual = 0, totalTraffic = 0, totalNewCust = 0, totalSkincare = 0;

    // 初始化所有應顯示的店家
    effectiveStores.forEach(storeName => {
      // 防呆：如果店家在排除名單中，直接略過，不列入計算與清單
      if (auditExclusions.includes(storeName)) return;

      storeDataMap[storeName] = {
        storeName,
        isReported: false,
        cash: 0, accrual: 0, traffic: 0, newCustomers: 0, newCustomerSales: 0, skincareSales: 0
      };
    });

    if (allReports) {
      allReports.forEach(report => {
        const rDate = new Date(report.date);
        if (rDate.getFullYear() === targetY && (rDate.getMonth() + 1) === targetM && rDate.getDate() === targetD) {
          const cName = cleanName(report.storeName);
          
          // 防呆：略過排除名單的報表數據
          if (auditExclusions.includes(cName)) return;

          if (storeDataMap[cName]) {
            const cash = (Number(report.cash) || 0) - (Number(report.refund) || 0);
            let accrual = Number(report.accrual) || 0;
            if (brandPrefix === '安妞') accrual = Number(report.operationalAccrual) || 0;
            const traffic = Number(report.traffic) || 0;
            const newCust = Number(report.newCustomers) || 0;
            const skincare = Number(report.skincareSales) || 0;

            storeDataMap[cName] = {
              storeName: cName,
              isReported: true,
              cash, accrual, traffic, newCustomers: newCust, skincareSales: skincare,
              newCustomerSales: Number(report.newCustomerSales) || 0
            };

            totalCash += cash;
            totalAccrual += accrual;
            totalTraffic += traffic;
            totalNewCust += newCust;
            totalSkincare += skincare;
          }
        }
      });
    }

    // 轉換為陣列並排序
    let list = Object.values(storeDataMap);
    list.sort((a, b) => {
      if (!a.isReported && b.isReported) return 1;
      if (a.isReported && !b.isReported) return -1;
      if (sortConfig.direction === 'asc') return a[sortConfig.key] - b[sortConfig.key];
      return b[sortConfig.key] - a[sortConfig.key];
    });

    // 加上排名
    let currentRank = 1;
    list = list.map(item => {
      if (item.isReported) {
        item.rank = currentRank++;
      } else {
        item.rank = "-";
      }
      return item;
    });

    return { 
      list, 
      totals: { cash: totalCash, accrual: totalAccrual, traffic: totalTraffic, newCustomers: totalNewCust, skincare: totalSkincare },
      reportedCount: list.filter(s => s.isReported).length,
      totalCount: list.length
    };
  }, [allReports, effectiveStores, selectedDate, cleanName, brandPrefix, sortConfig, auditExclusions]);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // 處理黑名單設定視窗邏輯
  const toggleExclusion = (store) => {
    setLocalExclusions(prev => 
      prev.includes(store) ? prev.filter(s => s !== store) : [...prev, store]
    );
  };

  const saveConfig = async () => {
    const success = await handleUpdateAuditExclusions(localExclusions);
    if (success) {
      setIsConfigModalOpen(false);
      if(showToast) showToast("店家排除設定已更新", "success");
    } else {
      if(showToast) showToast("更新失敗，請稍後再試", "error");
    }
  };

  const MiniKpiCard = ({ title, value, icon: Icon, color, subText }) => (
    <div className="bg-white p-5 rounded-3xl border border-stone-100 shadow-sm relative overflow-hidden flex items-center gap-4">
      <div className={`p-4 rounded-2xl ${color.bg} ${color.text}`}><Icon size={24} /></div>
      <div>
        <p className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
        <h3 className="text-2xl font-extrabold text-stone-700 font-mono tracking-tight">{value}</h3>
        {subText && <p className="text-[10px] text-stone-400 font-bold mt-1">{subText}</p>}
      </div>
    </div>
  );

  return (
    <ViewWrapper>
      <div className="space-y-6 pb-10 w-full min-w-0 relative">
        
        {/* Header & Controls */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-2 animate-in fade-in slide-in-from-left-2 duration-500">
          <div className="flex items-center gap-3 shrink-0">
            <div className={`p-2.5 rounded-xl ${brandInfo.id.includes('anniu') ? 'bg-teal-100 text-teal-600' : brandInfo.id.includes('yibo') ? 'bg-purple-100 text-purple-600' : 'bg-amber-100 text-amber-600'}`}>
              <Calendar size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-stone-700">每日戰情看板</h1>
              <p className="text-xs text-stone-400 font-bold tracking-wide">Daily Operations Report</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            
            {/* ★ 替換為 SmartDatePicker，統一 UI 體驗與防呆 */}
            <div className="w-full sm:w-auto relative z-20">
              <SmartDatePicker 
                selectedDate={selectedDate}
                onDateSelect={setSelectedDate}
                maxDate={today} // 防呆：阻擋點擊未來日期
              />
            </div>

            {/* 區域/店家篩選 */}
            {(userRole === 'director' || userRole === 'trainer' || userRole === 'manager') && (
              <div className="flex items-center gap-2">
                {(userRole === 'director' || userRole === 'trainer') && (
                  <select value={selectedManager} onChange={(e) => { setSelectedManager(e.target.value); setSelectedStore(""); }} className="px-4 py-2.5 border border-stone-200 rounded-xl text-sm font-bold text-stone-600 outline-none focus:border-amber-400 bg-white shadow-sm cursor-pointer min-w-[120px]">
                    <option value="">全區</option>
                    {Object.keys(groupedStoresForFilter).map(m => <option key={m} value={m}>{m}區</option>)}
                  </select>
                )}
                <select value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} className="px-4 py-2.5 border border-stone-200 rounded-xl text-sm font-bold text-stone-600 outline-none focus:border-amber-400 bg-white shadow-sm cursor-pointer min-w-[140px]">
                  <option value="">{selectedManager || userRole === 'manager' ? "全區店家" : "顯示全區"}</option>
                  {availableStoresForDropdown.map(s => <option key={s} value={s} className="font-medium text-stone-700">{s}</option>)}
                </select>

                {/* 排除店家設定按鈕 */}
                <button 
                  onClick={() => { setLocalExclusions(auditExclusions || []); setIsConfigModalOpen(true); }} 
                  className="p-2.5 bg-stone-100 text-stone-500 rounded-xl hover:bg-stone-200 transition-colors shadow-sm border border-stone-200"
                  title="設定不計算店家"
                >
                  <Settings size={18}/>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 總結數據卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
          <MiniKpiCard title="單日現金總額" value={fmtMoney(dailyData.totals.cash)} icon={DollarSign} color={{bg: 'bg-amber-50', text: 'text-amber-500'}} subText={`共 ${dailyData.reportedCount} 間門市產生業績`} />
          <MiniKpiCard title="單日權責總額" value={fmtMoney(dailyData.totals.accrual)} icon={CreditCard} color={{bg: 'bg-cyan-50', text: 'text-cyan-500'}} />
          <MiniKpiCard title="單日操作人次" value={fmtNum(dailyData.totals.traffic)} icon={Users} color={{bg: 'bg-blue-50', text: 'text-blue-500'}} />
          <MiniKpiCard title="單日新客數" value={fmtNum(dailyData.totals.newCustomers)} icon={Sparkles} color={{bg: 'bg-purple-50', text: 'text-purple-500'}} />
        </div>

        {/* 報表狀態提示 */}
        <div className="flex items-center gap-3 px-2 animate-in fade-in duration-500 delay-200">
          <div className="flex-1 h-px bg-stone-200"></div>
          <span className="text-xs font-bold text-stone-400 uppercase tracking-widest px-2 flex items-center gap-2">
            回報狀態: {dailyData.reportedCount} / {dailyData.totalCount} 店 
            {dailyData.reportedCount < dailyData.totalCount && <span className="text-rose-500 flex items-center gap-1"><AlertCircle size={14}/> 缺交提醒</span>}
          </span>
          <div className="flex-1 h-px bg-stone-200"></div>
        </div>

        {/* 詳細數據表格 */}
        <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
          <div className="overflow-x-auto w-full pb-2">
            <table className="w-full text-left border-collapse min-w-[800px] whitespace-nowrap">
              <thead>
                <tr className="text-xs font-bold text-stone-400 border-b border-stone-100 bg-stone-50/50">
                  <th className="p-4 w-16 text-center">排名</th>
                  <th className="p-4">門市名稱</th>
                  <th className="p-4 text-center cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('cash')}>
                    現金業績 {sortConfig.key === 'cash' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="p-4 text-center cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('accrual')}>
                    權責業績 {sortConfig.key === 'accrual' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="p-4 text-center cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('traffic')}>
                    操作客流 {sortConfig.key === 'traffic' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="p-4 text-center cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('newCustomers')}>
                    新客數 {sortConfig.key === 'newCustomers' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="p-4 text-center">保養品</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {dailyData.list.map((store) => (
                  <tr key={store.storeName} className={`border-b border-stone-50 transition-colors ${!store.isReported ? "bg-rose-50/30" : "hover:bg-stone-50"}`}>
                    <td className="p-4 text-center">
                      {!store.isReported ? (
                        <AlertCircle size={20} className="text-rose-400 mx-auto" />
                      ) : (
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${store.rank <= 3 ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-500"}`}>
                          {store.rank}
                        </span>
                      )}
                    </td>
                    <td className="p-4 font-bold text-stone-700 flex items-center gap-2">
                      {brandPrefix}{store.storeName}店
                      {!store.isReported && <span className="px-2 py-0.5 bg-rose-100 text-rose-600 text-[10px] rounded animate-pulse">未回報</span>}
                    </td>
                    
                    {store.isReported ? (
                      <>
                        <td className="p-4 text-center font-mono font-bold text-amber-600">{fmtMoney(store.cash)}</td>
                        <td className="p-4 text-center font-mono font-bold text-indigo-600">{fmtMoney(store.accrual)}</td>
                        <td className="p-4 text-center font-mono text-stone-600">{fmtNum(store.traffic)}</td>
                        <td className="p-4 text-center font-mono text-emerald-600">{fmtNum(store.newCustomers)}</td>
                        <td className="p-4 text-center font-mono text-stone-500">{fmtMoney(store.skincareSales)}</td>
                      </>
                    ) : (
                      <td colSpan="5" className="p-4 text-center text-rose-400 font-bold text-xs tracking-widest">
                        --- 無資料 / 等待回報中 ---
                      </td>
                    )}
                  </tr>
                ))}
                
                {dailyData.list.length === 0 && (
                  <tr><td colSpan="7" className="p-8 text-center text-stone-400 font-bold">目前無相關店家資料</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

      </div>

      {/* 排除店家設定視窗 Modal */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            <div className="bg-stone-800 text-white p-4 font-bold text-lg flex justify-between items-center shrink-0">
              <span className="flex items-center gap-2"><Ban size={20} className="text-rose-400"/> 設定不計算店家</span>
              <button onClick={() => setIsConfigModalOpen(false)} className="hover:bg-white/10 p-1 rounded-lg transition-colors">
                <X size={20}/>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              {Object.entries(managers).map(([mgr, stores]) => {
                const cleanStores = stores.map(cleanName).filter(Boolean);
                if (cleanStores.length === 0) return null;
                
                return (
                  <div key={mgr}>
                    <h4 className="font-bold text-stone-400 text-xs uppercase mb-2 ml-1">{mgr} 區</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {cleanStores.map(store => {
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
                );
              })}
            </div>
            
            <div className="p-4 border-t border-stone-100 bg-white shrink-0 flex justify-end gap-3">
              <button onClick={() => setIsConfigModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-stone-500 hover:bg-stone-50 transition-colors">取消</button>
              <button onClick={saveConfig} className="px-6 py-2.5 rounded-xl font-bold bg-stone-800 text-white hover:bg-stone-700 shadow-lg flex items-center gap-2 transition-colors">
                <Save size={18}/> 儲存設定
              </button>
            </div>
            
          </div>
        </div>
      )}

    </ViewWrapper>
  );
};

export default DailyView;