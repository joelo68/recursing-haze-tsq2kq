// src/components/AnnualView.jsx
import React, { useContext, useMemo, useState, useEffect } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Area
} from "recharts";
import { Target, TrendingUp, DollarSign, Activity, Calendar, Award, Filter, ArrowRight, Settings, X, Ban, CheckCircle, Save, Star } from "lucide-react";

import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";

// ★★★ 自定義圖例元件 ★★★
const CustomLegend = () => {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 pb-2 select-none">
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#fef3c7', border: '2px solid #fbbf24' }}></div>
        <span className="text-xs font-bold text-stone-600">現金預算</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex items-center justify-center w-6">
          <div className="w-full h-0 border-t-2 border-dashed border-[#818cf8]"></div>
        </div>
        <span className="text-xs font-bold text-stone-600">權責預算</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-[2px] bg-[#f59e0b]"></div>
        <span className="text-xs font-bold text-stone-600">實際現金</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="relative flex items-center justify-center w-6">
           <div className="w-full h-[2px] bg-[#4f46e5]"></div>
           <div className="absolute w-2.5 h-2.5 rounded-full bg-[#4f46e5]"></div>
        </div>
        <span className="text-xs font-bold text-stone-600">實際權責</span>
      </div>
      {/* 挑戰目標標記說明 */}
      <div className="flex items-center gap-1.5">
        <Star size={14} className="text-amber-500 fill-amber-500" />
        <span className="text-xs font-bold text-stone-600">挑戰目標 (當月有加碼時)</span>
      </div>
    </div>
  );
};

const AnnualView = () => {
  const { 
    rawData, 
    budgets, 
    managers, 
    fmtMoney, 
    fmtNum, 
    selectedYear,
    auditExclusions,
    handleUpdateAuditExclusions,
    userRole,
    showToast,
    currentBrand
  } = useContext(AppContext);

  const [startMonthStr, setStartMonthStr] = useState(`${selectedYear}-01`);
  const [endMonthStr, setEndMonthStr] = useState(`${selectedYear}-12`);
  
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [localExclusions, setLocalExclusions] = useState([]);

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

  const cleanStoreName = (name) => {
    if (!name) return "";
    return name.replace(/CYJ|安妞|伊啵|Anew|Yibo|店/gi, "").trim();
  };

  useEffect(() => {
    setStartMonthStr(`${selectedYear}-01`);
    setEndMonthStr(`${selectedYear}-12`);
  }, [selectedYear]);

  const openConfigModal = () => {
    setLocalExclusions(auditExclusions || []);
    setIsConfigModalOpen(true);
  };

  const saveConfig = async () => {
    await handleUpdateAuditExclusions(localExclusions);
    setIsConfigModalOpen(false);
    showToast("排除名單已更新，報表已重新計算", "success");
  };

  const toggleExclusion = (store) => {
    setLocalExclusions(prev => {
      if (prev.includes(store)) return prev.filter(s => s !== store);
      return [...prev, store];
    });
  };

  const handleQuarterClick = (q) => {
    let start = "01";
    let end = "03";
    switch (q) {
      case 1: start = "01"; end = "03"; break;
      case 2: start = "04"; end = "06"; break;
      case 3: start = "07"; end = "09"; break;
      case 4: start = "10"; end = "12"; break;
      case 'ALL': start = "01"; end = "12"; break; 
      default: break;
    }
    setStartMonthStr(`${selectedYear}-${start}`);
    setEndMonthStr(`${selectedYear}-${end}`);
  };

  const activeQuarter = useMemo(() => {
    if (startMonthStr === `${selectedYear}-01` && endMonthStr === `${selectedYear}-03`) return 1;
    if (startMonthStr === `${selectedYear}-04` && endMonthStr === `${selectedYear}-06`) return 2;
    if (startMonthStr === `${selectedYear}-07` && endMonthStr === `${selectedYear}-09`) return 3;
    if (startMonthStr === `${selectedYear}-10` && endMonthStr === `${selectedYear}-12`) return 4;
    if (startMonthStr === `${selectedYear}-01` && endMonthStr === `${selectedYear}-12`) return 'ALL';
    return null;
  }, [startMonthStr, endMonthStr, selectedYear]);

  // ==========================================
  // 核心計算邏輯：精準區分「現金挑戰」與「權責挑戰」
  // ==========================================
  const annualData = useMemo(() => {
    const visibleStoreNames = Object.values(managers)
      .flat()
      .filter(storeName => !auditExclusions.includes(storeName)) 
      .map(s => `${brandPrefix}${s}店`); 

    const monthList = [];
    let current = new Date(`${startMonthStr}-01`);
    const end = new Date(`${endMonthStr}-01`);

    if (current > end) current = new Date(`${startMonthStr}-01`);

    while (current <= end) {
      const y = current.getFullYear();
      const m = current.getMonth() + 1;
      monthList.push({
        label: `${y}/${m}`,
        y, 
        m,
        dateKey: `${y}/${m.toString().padStart(2, '0')}`
      });
      current.setMonth(current.getMonth() + 1);
    }

    const statsMap = monthList.map(item => ({
      ...item,
      cash: 0, accrual: 0, traffic: 0, budget: 0, accrualBudget: 0,
      challengeBudget: 0, challengeAccrualBudget: 0, 
      hasChallenge: false,
      hasChallengeCash: false,       // ★ 標記該月是否有現金挑戰
      hasChallengeAccrual: false     // ★ 標記該月是否有權責挑戰
    }));

    rawData.forEach(d => {
      const rawStoreName = cleanStoreName(d.storeName);
      if (auditExclusions.includes(rawStoreName)) return;

      if (!d.date) return;
      const dateStr = d.date.replace(/-/g, "/");
      const parts = dateStr.split("/");
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      const realYear = y < 1911 ? y + 1911 : y;
      
      const targetStat = statsMap.find(s => s.y === realYear && s.m === m);
      if (targetStat) {
        targetStat.cash += (Number(d.cash) || 0) - (Number(d.refund) || 0);
        
        let currentAccrual = Number(d.accrual) || 0;
        if (brandPrefix === '安妞') {
            currentAccrual = Number(d.operationalAccrual) || 0;
        }
        targetStat.accrual += currentAccrual;
        targetStat.traffic += (Number(d.traffic) || 0);
      }
    });

    let totalCash = 0, totalBudget = 0, totalAccrual = 0, totalAccrualBudget = 0, totalTraffic = 0;

    statsMap.forEach(stat => {
      visibleStoreNames.forEach(storeName => {
        const key = `${storeName}_${stat.y}_${stat.m}`;
        if (budgets[key]) {
          const bCash = Number(budgets[key].cashTarget) || 0;
          const bAcc = Number(budgets[key].accrualTarget) || 0;
          const chalCash = Number(budgets[key].challengeCashTarget) || 0;
          const chalAcc = Number(budgets[key].challengeAccrualTarget) || 0;

          stat.budget += bCash;
          stat.accrualBudget += bAcc;
          
          stat.challengeBudget += (chalCash > 0 ? chalCash : bCash);
          stat.challengeAccrualBudget += (chalAcc > 0 ? chalAcc : bAcc);

          if (chalCash > 0 || chalAcc > 0) stat.hasChallenge = true;
          if (chalCash > 0) stat.hasChallengeCash = true;
          if (chalAcc > 0) stat.hasChallengeAccrual = true;
        }
      });

      stat.achievement = stat.budget > 0 ? (stat.cash / stat.budget) * 100 : 0;
      stat.accrualAchievement = stat.accrualBudget > 0 ? (stat.accrual / stat.accrualBudget) * 100 : 0;
      
      totalCash += stat.cash;
      totalBudget += stat.budget;
      totalAccrual += stat.accrual;
      totalAccrualBudget += stat.accrualBudget;
      totalTraffic += stat.traffic;
    });

    return {
      monthlyStats: statsMap,
      totals: {
        cash: totalCash, budget: totalBudget, cashAch: totalBudget > 0 ? (totalCash / totalBudget) * 100 : 0,
        accrual: totalAccrual, accrualBudget: totalAccrualBudget, accrualAch: totalAccrualBudget > 0 ? (totalAccrual / totalAccrualBudget) * 100 : 0,
        traffic: totalTraffic,
      }
    };
  }, [rawData, budgets, managers, startMonthStr, endMonthStr, auditExclusions, brandPrefix]); 

  const { monthlyStats, totals } = annualData;

  // ★★★ 智慧型客製化 Tooltip：動態判斷顯示項目 ★★★
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload; 
      
      return (
        <div className="bg-white p-3.5 rounded-2xl shadow-xl border border-stone-100 text-sm min-w-[180px]">
          <p className="font-bold text-stone-700 mb-3 border-b border-stone-100 pb-2">{label}</p>
          <div className="space-y-2.5">
            {/* 如果有挑戰現金，才顯示這一行 */}
            {data.hasChallengeCash && (
              <div className="flex items-center justify-between gap-6 font-bold bg-amber-50 px-2 py-1.5 rounded-lg text-amber-700 shadow-sm border border-amber-100">
                <span className="flex items-center gap-1.5 text-xs"><Star size={12} className="fill-amber-500 text-amber-500"/>挑戰現金</span>
                <span className="font-mono">{fmtMoney(data.challengeBudget)}</span>
              </div>
            )}
            {/* 如果有挑戰權責，才顯示這一行 */}
            {data.hasChallengeAccrual && (
              <div className="flex items-center justify-between gap-6 font-bold bg-indigo-50 px-2 py-1.5 rounded-lg text-indigo-700 shadow-sm border border-indigo-100">
                <span className="flex items-center gap-1.5 text-xs"><Star size={12} className="fill-indigo-500 text-indigo-500"/>挑戰權責</span>
                <span className="font-mono">{fmtMoney(data.challengeAccrualBudget)}</span>
              </div>
            )}
            
            <div className="flex items-center justify-between gap-6 text-stone-500 text-xs mt-2">
              <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-[2px] bg-[#fef3c7] border border-[#fbbf24]"></div>預算現金</span>
              <span className="font-mono">{fmtMoney(data.budget)}</span>
            </div>
            <div className="flex items-center justify-between gap-6 text-stone-500 text-xs">
              <span className="flex items-center gap-1.5"><div className="w-2.5 h-0.5 bg-[#818cf8]"></div>預算權責</span>
              <span className="font-mono">{fmtMoney(data.accrualBudget)}</span>
            </div>
            <div className="flex items-center justify-between gap-6 font-bold text-amber-600 text-xs pt-1">
              <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-[2px] bg-[#f59e0b]"></div>實際現金</span>
              <span className="font-mono">{fmtMoney(data.cash)}</span>
            </div>
            <div className="flex items-center justify-between gap-6 font-bold text-indigo-600 text-xs">
              <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#4f46e5]"></div>實際權責</span>
              <span className="font-mono">{fmtMoney(data.accrual)}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <ViewWrapper>
      <div className="space-y-6 pb-12">
        
        <div className="flex flex-col gap-4 mb-2">
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
             <div className="flex items-center gap-3">
               <div className="p-3 bg-amber-100 text-amber-600 rounded-xl shadow-sm">
                 <Calendar size={24} />
               </div>
               <div>
                 <h1 className="text-2xl font-bold text-stone-800">經營績效分析 ({brandPrefix})</h1>
                 <p className="text-xs text-stone-500 font-medium">Performance Analytics</p>
               </div>
             </div>
             
             <div className="flex items-center gap-2 self-start md:self-auto md:ml-auto">
               <div className="px-4 py-1.5 bg-stone-100 text-stone-500 text-xs font-bold rounded-full">
                 權限範圍: 自動篩選 ({Object.values(managers).flat().filter(s => !auditExclusions.includes(s)).length} 店)
               </div>
               {(userRole === 'director' || userRole === 'manager') && (
                  <button 
                    onClick={openConfigModal} 
                    className="p-1.5 bg-stone-100 text-stone-500 rounded-full hover:bg-stone-200 transition-colors" 
                    title="設定排除店家 (不計入目標與業績)"
                  >
                    <Settings size={16}/>
                  </button>
               )}
             </div>
           </div>

           <div className="bg-white p-4 rounded-2xl border border-stone-100 shadow-sm flex flex-col xl:flex-row items-start xl:items-center gap-4">
              <div className="flex items-center gap-2 text-stone-600 font-bold text-sm whitespace-nowrap shrink-0">
                <Filter size={18} className="text-amber-500"/>
                <span>快速篩選：</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => handleQuarterClick('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    activeQuarter === 'ALL' ? 'bg-stone-800 text-white border-stone-800' : 'bg-stone-50 text-stone-500 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  整年度
                </button>
                {[1, 2, 3, 4].map(q => (
                  <button
                    key={q}
                    onClick={() => handleQuarterClick(q)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                      activeQuarter === q ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-200' : 'bg-stone-50 text-stone-500 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    Q{q}
                  </button>
                ))}
              </div>
              <div className="hidden xl:block w-px h-8 bg-stone-200 mx-2"></div>
              <div className="flex items-center gap-2 text-stone-600 font-bold text-sm whitespace-nowrap xl:ml-0 shrink-0">
                <span>自訂區間：</span>
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <input 
                  type="month" value={startMonthStr} onChange={(e) => setStartMonthStr(e.target.value)}
                  className="bg-stone-50 border border-stone-200 text-stone-700 text-sm rounded-lg focus:ring-amber-500 focus:border-amber-500 block w-full p-2 font-mono"
                />
                <span className="text-stone-400"><ArrowRight size={16}/></span>
                <input 
                  type="month" value={endMonthStr} onChange={(e) => setEndMonthStr(e.target.value)}
                  className="bg-stone-50 border border-stone-200 text-stone-700 text-sm rounded-lg focus:ring-amber-500 focus:border-amber-500 block w-full p-2 font-mono"
                />
              </div>
           </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-20"><DollarSign size={100} /></div>
            <div className="relative z-10">
              <p className="text-amber-100 font-bold text-sm mb-1 flex items-center gap-1"><Target size={14}/> 區間現金達成</p>
              <h2 className="text-4xl font-extrabold font-mono tracking-tight mb-4">{fmtMoney(totals.cash)}</h2>
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-amber-100">
                  <span>區間目標 {fmtMoney(totals.budget)}</span>
                  <span>{totals.cashAch.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-black/20 h-2 rounded-full overflow-hidden">
                  <div className="bg-white h-full rounded-full transition-all duration-1000" style={{ width: `${Math.min(totals.cashAch, 100)}%` }}></div>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white border-2 border-indigo-100 rounded-2xl p-6 shadow-sm relative overflow-hidden flex flex-col justify-center">
             <div className="absolute top-0 right-0 p-4 opacity-5 text-indigo-600"><Activity size={100} /></div>
             <div className="relative z-10">
              <p className="text-indigo-400 font-bold text-sm mb-1 flex items-center gap-1"><Award size={14}/> 區間權責達成</p>
              <h2 className={`text-4xl font-extrabold font-mono tracking-tight text-stone-700 ${brandPrefix === '安妞' ? 'mb-1' : 'mb-4'}`}>{fmtMoney(totals.accrual)}</h2>
              {brandPrefix === '安妞' && (
                <p className="text-[11px] text-indigo-400 mb-3 font-medium flex items-center gap-1">
                  <span className="inline-block w-1 h-1 bg-indigo-400 rounded-full"></span> 僅含技術操作 (排除產品)
                </p>
              )}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-stone-400">
                  <span>區間目標 {fmtMoney(totals.accrualBudget)}</span>
                  <span className={totals.accrualAch >= 100 ? "text-emerald-500" : "text-stone-500"}>{totals.accrualAch.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-indigo-500 h-full rounded-full transition-all duration-1000" style={{ width: `${Math.min(totals.accrualAch, 100)}%` }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Card title="區間營收趨勢分析" subtitle={`實際 vs 預算 (現金/權責${brandPrefix === '安妞' ? ' - 不含產品' : ''})`}>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyStats} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#78716c' }} axisLine={false} tickLine={false} dy={10} />
                <YAxis 
                  width={50} 
                  tick={{ fontSize: 11, fill: '#a8a29e' }} 
                  axisLine={false} 
                  tickLine={false} 
                  tickFormatter={(val) => `${(val/10000).toFixed(0)}萬`} 
                />
                
                {/* ★ 掛上客製化的精準 Tooltip */}
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#fafaf9' }} />
                
                <Legend content={<CustomLegend />} verticalAlign="top" height={36} />
                <Area type="monotone" dataKey="budget" name="現金預算" stroke="#fbbf24" fill="#fef3c7" strokeWidth={2} fillOpacity={0.5} />
                <Line type="monotone" dataKey="accrualBudget" name="權責預算" stroke="#818cf8" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                
                {/* ★ 挑戰現金星星標記 */}
                <Line 
                  type="monotone" 
                  dataKey="challengeBudget" 
                  name="挑戰現金" 
                  stroke="none" 
                  isAnimationActive={false}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    if (payload.hasChallengeCash) {
                      return (
                        <svg x={cx - 8} y={cy - 8} width="16" height="16" viewBox="0 0 24 24" fill="#f59e0b" stroke="#b45309" strokeWidth="1" xmlns="http://www.w3.org/2000/svg">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                      );
                    }
                    return null;
                  }}
                  activeDot={false}
                />
                
                {/* ★ 挑戰權責星星標記 */}
                <Line 
                  type="monotone" 
                  dataKey="challengeAccrualBudget" 
                  name="挑戰權責" 
                  stroke="none" 
                  isAnimationActive={false}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    if (payload.hasChallengeAccrual) {
                      return (
                        <svg x={cx - 8} y={cy - 8} width="16" height="16" viewBox="0 0 24 24" fill="#818cf8" stroke="#4f46e5" strokeWidth="1" xmlns="http://www.w3.org/2000/svg">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                      );
                    }
                    return null;
                  }}
                  activeDot={false}
                />

                <Bar dataKey="cash" name="實際現金" barSize={12} radius={[4, 4, 0, 0]} fill="#f59e0b" />
                <Line type="monotone" dataKey="accrual" name="實際權責" stroke="#4f46e5" strokeWidth={3} dot={{r:3}} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 區塊 3: 詳細數據表 */}
        <Card title="區間詳細數據表">
          <div className="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="text-stone-400 font-bold border-b border-stone-100 text-xs uppercase">
                <tr>
                  <th className="pb-3 pl-2">月份</th>
                  <th className="pb-3 text-right text-amber-500/60">現金目標</th>
                  <th className="pb-3 text-right text-amber-600">現金業績</th>
                  <th className="pb-3 text-right">達成率</th>
                  <th className="pb-3 text-right text-indigo-400/60 pl-4 border-l border-dashed border-stone-200">權責目標</th>
                  <th className="pb-3 text-right text-indigo-600">
                    權責業績 {brandPrefix === '安妞' && <span className="text-[10px] text-indigo-400 font-normal normal-case ml-1">(純操作)</span>}
                  </th>
                  <th className="pb-3 text-right">達成率</th>
                  <th className="pb-3 text-right pl-4 border-l border-dashed border-stone-200">操作人次</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {monthlyStats.map((stat, idx) => {
                   // 表格星星的 Hover 提示字眼動態組合
                   let titleText = [];
                   if (stat.hasChallengeCash) titleText.push(`現金: ${fmtMoney(stat.challengeBudget)}`);
                   if (stat.hasChallengeAccrual) titleText.push(`權責: ${fmtMoney(stat.challengeAccrualBudget)}`);
                   const starTitle = titleText.length > 0 ? `挑戰目標\n${titleText.join('\n')}` : "";

                   return (
                     <tr key={idx} className="group hover:bg-stone-50 transition-colors">
                       <td className="py-4 pl-2 font-bold text-stone-700">
                         {stat.label}
                         {stat.hasChallenge && <Star size={10} className="inline ml-1 mb-1 text-amber-500 fill-amber-500 cursor-help" title={starTitle}/>}
                       </td>
                       <td className="py-4 text-right font-mono text-stone-400 text-xs">{fmtMoney(stat.budget)}</td>
                       <td className="py-4 text-right font-mono text-stone-700 font-bold">{fmtMoney(stat.cash)}</td>
                       <td className="py-4 text-right font-bold">
                          <span className={`px-2 py-1 rounded-md text-xs ${stat.achievement >= 100 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-400'}`}>
                            {stat.achievement.toFixed(1)}%
                          </span>
                       </td>
                       <td className="py-4 text-right font-mono text-stone-400 text-xs pl-4 border-l border-dashed border-stone-100">{fmtMoney(stat.accrualBudget)}</td>
                       <td className="py-4 text-right font-mono text-indigo-600 font-bold">{fmtMoney(stat.accrual)}</td>
                       <td className="py-4 text-right font-bold">
                          <span className={`px-2 py-1 rounded-md text-xs ${stat.accrualAchievement >= 100 ? 'bg-indigo-100 text-indigo-700' : 'bg-stone-100 text-stone-400'}`}>
                            {stat.accrualAchievement.toFixed(1)}%
                          </span>
                       </td>
                       <td className="py-4 text-right font-mono text-stone-600 pl-4 border-l border-dashed border-stone-100">{fmtNum(stat.traffic)}</td>
                     </tr>
                   );
                })}
              </tbody>
              <tfoot className="bg-stone-50 font-bold text-stone-800 border-t-2 border-stone-100">
                <tr>
                  <td className="py-4 pl-2 text-stone-500">區間總計</td>
                  <td className="py-4 text-right font-mono text-stone-500 text-xs">{fmtMoney(totals.budget)}</td>
                  <td className="py-4 text-right font-mono text-amber-600">{fmtMoney(totals.cash)}</td>
                  <td className="py-4 text-right text-emerald-600">{totals.cashAch.toFixed(1)}%</td>
                  <td className="py-4 text-right font-mono text-stone-500 text-xs pl-4 border-l border-dashed border-stone-200">{fmtMoney(totals.accrualBudget)}</td>
                  <td className="py-4 text-right font-mono text-indigo-600">{fmtMoney(totals.accrual)}</td>
                  <td className="py-4 text-right text-emerald-600">{totals.accrualAch.toFixed(1)}%</td>
                  <td className="py-4 text-right font-mono pl-4 border-l border-dashed border-stone-200">{fmtNum(totals.traffic)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

      </div>

      {/* ★★★ 設定視窗 (Modal) ★★★ */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-stone-800 text-white p-4 font-bold text-lg flex justify-between items-center shrink-0">
              <span className="flex items-center gap-2"><Ban size={20} className="text-rose-400"/> 設定不計算店家 ({brandPrefix})</span>
              <button onClick={() => setIsConfigModalOpen(false)} className="hover:bg-white/10 p-1 rounded-lg transition-colors"><X size={20}/></button>
            </div>
            <div className="p-4 bg-stone-50 border-b border-stone-200 shrink-0 text-sm text-stone-500">
              <p>勾選的店家將 <span className="font-bold text-rose-500">不會</span> 計入年度預算與實際業績。</p>
              <p className="text-xs mt-1 text-stone-400">(此設定與「回報檢核」共用排除名單)</p>
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

export default AnnualView;