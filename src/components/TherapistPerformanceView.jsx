// src/components/TherapistPerformanceView.jsx
import React, { useContext } from "react";
import { Flame, Crown, AlertTriangle, Zap, Frown, DollarSign, Sparkles, TrendingUp, Activity, FileWarning, Download, ArrowLeft, ArrowRight, Store, ArrowUp, ArrowDown, Target, Users, Receipt, Award } from "lucide-react";
import { AppContext } from "../AppContext";
import { Card } from "./SharedUI";

// ★ 專屬的 SVG 半圓儀表板元件
const GaugeChart = ({ progress }) => {
  const safeProgress = Math.min(100, Math.max(0, progress));
  const radius = 70;
  const circumference = Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * safeProgress) / 100;
  const needleAngle = -90 + (safeProgress / 100) * 180;

  return (
    <div className="relative w-48 h-32 mx-auto flex flex-col items-center justify-end">
      <svg viewBox="0 0 200 120" className="w-full h-full overflow-visible absolute top-0">
        <path d="M 30 100 A 70 70 0 0 1 170 100" fill="none" stroke="#f5f5f4" strokeWidth="18" strokeLinecap="round" />
        <path 
          d="M 30 100 A 70 70 0 0 1 170 100" 
          fill="none" 
          stroke="#f59e0b" 
          strokeWidth="18" 
          strokeLinecap="round" 
          strokeDasharray={circumference} 
          strokeDashoffset={strokeDashoffset} 
          className="transition-all duration-1000 ease-out"
        />
        <g transform={`rotate(${needleAngle} 100 100)`} className="transition-transform duration-1000 ease-out">
          <polygon points="96,100 104,100 100,50" fill="#44403c" />
        </g>
        <circle cx="100" cy="100" r="8" fill="#44403c" />
        <circle cx="100" cy="100" r="3" fill="#ffffff" />
      </svg>
      <div className="relative z-10 bg-white/80 backdrop-blur-sm px-4 py-1 rounded-xl mb-1">
        <span className="text-3xl font-black text-stone-800 font-mono tracking-tighter">{safeProgress}%</span>
      </div>
    </div>
  );
};

const TherapistPerformanceView = ({ therapistStats, brandInfo }) => {
  const { fmtMoney, fmtNum, userRole, currentUser, therapistTargets, selectedYear, selectedMonth } = useContext(AppContext);

  const handleExportCSV = () => {
    const dataToExport = therapistStats.rankings.filter(t => userRole !== 'therapist' || t.id === currentUser?.id);
    const headers = ["排名,姓名,所屬店家,個人總業績,今明業績,舊客業績,新舊客佔比,新客締結率,新客人數,新客留單數,新客平均業績,舊客平均業績,在職狀態"];
    const rows = dataToExport.map(t => [
      t.rank, t.name, t.storeDisplay, t.totalRevenue, t.newCustomerRevenue, t.oldCustomerRevenue,
      `"${t.revenueMix}"`, `${t.newClosingRate.toFixed(0)}%`, t.newCustomerCount, t.newCustomerClosings,
      Math.round(t.newAsp), Math.round(t.oldAsp), t.isSystemStaff ? "在職" : "支援/離職"
    ].join(","));

    const csvContent = "\uFEFF" + [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    const today = new Date().toISOString().split("T")[0];
    link.setAttribute("href", url);
    link.setAttribute("download", `${brandInfo.name}_管理師績效排行_${today}.csv`);
    
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getMotivationalMessage = (stats) => {
      if (!stats) return { title: "努力加載中...", sub: "Data Loading..." };
      const { rank, totalPeers, status, gapToNext } = stats;
      const beaten = totalPeers - rank;
      if (status === "TOP") return { title: rank === 1 ? "全區制霸！無人能敵" : "表現卓越！王者風範", sub: "請繼續保持這份榮耀", icon: Crown };
      else if (status === "DANGER") return { title: `警報！您僅贏過 ${beaten} 人`, sub: `距離上一名還差 ${fmtMoney(gapToNext)}，請加油好嗎？`, icon: AlertTriangle };
      else return { title: `表現平穩，擊敗了 ${beaten} 位夥伴`, sub: `再多做 ${fmtMoney(gapToNext)} 就能前進一名！`, icon: Zap };
  };

  const MiniKpiCard = ({ title, value, subText, icon: Icon, color }) => (
    <div className="bg-white p-5 rounded-3xl border border-stone-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden h-full flex flex-col">
      <div className={`absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity ${color}`}><Icon size={64} /></div>
      <div className="flex flex-col h-full justify-between relative z-10">
        <div><p className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-1">{title}</p><h3 className="text-2xl font-extrabold text-stone-700 font-mono tracking-tight">{value}</h3></div>
        {subText && <div className="mt-3 pt-3 border-t border-stone-50 text-xs font-medium text-stone-500 flex flex-col gap-1">{subText}</div>}
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full min-w-0">
      
      {/* ========================================================= */}
      {/* ★ 頂部版塊：個人英雄卡 + KPI分析小卡 + 本月戰績 Top 5 ★ */}
      {/* ========================================================= */}
      {therapistStats.myStats && (() => {
        const info = getMotivationalMessage(therapistStats.myStats);
        const status = therapistStats.myStats.status;
        let bgClass = "bg-gradient-to-br from-indigo-600 to-purple-700"; 
        let shadowClass = "shadow-indigo-200";
        if (status === "TOP") { bgClass = "bg-gradient-to-br from-amber-400 to-orange-500"; shadowClass = "shadow-amber-200"; } 
        else if (status === "DANGER") { bgClass = "bg-gradient-to-br from-rose-600 to-red-700"; shadowClass = "shadow-rose-200"; }
        
        return ( 
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5">
            
            {/* 1. 紫色英雄卡 (5/12) */}
            <div className={`lg:col-span-12 xl:col-span-5 ${bgClass} rounded-3xl p-6 md:p-8 text-white shadow-xl ${shadowClass} relative overflow-hidden transition-all duration-500 flex flex-col justify-between`}> 
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none"><info.icon size={160} /></div> 
                <div className="relative z-10 flex flex-col justify-between h-full w-full"> 
                    <div>
                      <div className="flex items-center gap-3 mb-3">
                          <span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm flex items-center gap-1">{status === 'DANGER' && <Flame size={12} className="animate-pulse"/>}No.{therapistStats.myStats.rank}</span>
                          <span className="text-white/80 font-bold tracking-wider text-sm">{therapistStats.myStats.storeDisplay}</span>
                      </div>
                      <h2 className="text-4xl md:text-5xl font-extrabold mb-1 tracking-tight">{therapistStats.myStats.name}</h2>
                    </div>
                    
                    <div className="mt-8 flex flex-col sm:flex-row xl:flex-col 2xl:flex-row justify-between items-start sm:items-end gap-6 w-full">
                      <div className="p-3.5 bg-black/10 rounded-2xl backdrop-blur-md border border-white/10 w-full sm:max-w-sm xl:max-w-full 2xl:max-w-sm">
                          <p className="font-bold text-sm flex items-center gap-2">{status === 'DANGER' && <Frown size={18}/>}{info.title}</p>
                          <p className="text-xs text-white/70 mt-1 font-medium">{info.sub}</p>
                      </div> 
                      <div className="flex gap-6 text-right w-full md:w-auto justify-end"> 
                          <div><p className="text-xs text-white/60 font-bold uppercase mb-1 whitespace-nowrap">個人總業績</p><p className="text-2xl sm:text-3xl font-mono font-bold tracking-tight">{fmtMoney(therapistStats.myStats.totalRevenue)}</p></div> 
                          <div><p className="text-xs text-white/60 font-bold uppercase mb-1 whitespace-nowrap">新客締結率</p><p className="text-2xl sm:text-3xl font-mono font-bold tracking-tight">{therapistStats.myStats.newClosingRate.toFixed(0)}%</p></div> 
                      </div> 
                    </div>
                </div> 
            </div>

            {/* 2. 分析 KPI 小卡 (3/12) */}
            <div className="lg:col-span-6 xl:col-span-3 flex flex-col gap-4 lg:gap-5">
               {/* 小卡 1: 新舊客佔比分析 (雙色推擠進度條) */}
               <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col flex-1 h-full">
                 <div className="bg-amber-50/80 px-4 py-3 text-amber-900 flex items-center gap-1.5 border-b border-amber-100/60">
                   <Activity size={16} strokeWidth={2.5} className="text-amber-500"/>
                   <h3 className="text-xs font-bold tracking-wide">本月新舊客佔比</h3>
                 </div>
                 <div className="p-4 md:p-5 flex-1 flex flex-col justify-center bg-stone-50/30">
                    {(() => {
                        const newRev = therapistStats.myStats.newCustomerRevenue || 0;
                        const oldRev = therapistStats.myStats.oldCustomerRevenue || 0;
                        const totalRev = therapistStats.myStats.totalRevenue || 1; // 防呆
                        const newPct = Math.round((newRev / totalRev) * 100);
                        const oldPct = Math.max(0, 100 - newPct);

                        return (
                            <>
                               <div className="flex justify-between items-end mb-2">
                                 <div>
                                   <div className="flex items-center gap-1.5 mb-0.5">
                                     <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                     <p className="text-[10px] font-bold text-stone-500">新客 <span className="text-amber-600">{newPct}%</span></p>
                                   </div>
                                   <p className="text-lg md:text-xl font-black font-mono text-stone-800 leading-none">{fmtMoney(newRev)}</p>
                                 </div>
                                 <div className="text-right">
                                   <div className="flex items-center justify-end gap-1.5 mb-0.5">
                                     <p className="text-[10px] font-bold text-stone-500">舊客 <span className="text-cyan-600">{oldPct}%</span></p>
                                     <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                                   </div>
                                   <p className="text-lg md:text-xl font-black font-mono text-stone-800 leading-none">{fmtMoney(oldRev)}</p>
                                 </div>
                               </div>
                               <div className="w-full bg-stone-100 h-1.5 md:h-2 rounded-full flex overflow-hidden">
                                  <div className="bg-amber-500 h-full transition-all duration-1000" style={{ width: `${newPct}%` }}></div>
                                  <div className="bg-cyan-400 h-full transition-all duration-1000" style={{ width: `${oldPct}%` }}></div>
                               </div>
                            </>
                        )
                    })()}
                 </div>
               </div>

               {/* ★ 小卡 2: 全新設計 - 客單價目標達標追蹤器 ★ */}
               <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col flex-1 h-full">
                 <div className="bg-amber-50/80 px-4 py-3 text-amber-900 flex items-center gap-1.5 border-b border-amber-100/60">
                   <Target size={16} strokeWidth={2.5} className="text-amber-500"/>
                   <h3 className="text-xs font-bold tracking-wide">新客客單達標率</h3>
                 </div>
                 <div className="p-4 md:p-5 flex-1 flex flex-col justify-center bg-stone-50/30">
                    {(() => {
                        const newAsp = Math.round(therapistStats.myStats.newAsp || 0);
                        const targetAsp = 25000; // 從主管截圖得知的公司目標
                        const achieveRate = targetAsp > 0 ? Math.round((newAsp / targetAsp) * 100) : 0;
                        const safeRate = Math.min(100, achieveRate);
                        const isReached = achieveRate >= 100;

                        return (
                            <>
                              <div className="flex justify-between items-end mb-2">
                                <div>
                                  <p className="text-[11px] font-bold text-stone-500 mb-1">您的平均客單</p>
                                  <p className="text-lg md:text-xl font-black font-mono text-stone-800 leading-none">{fmtMoney(newAsp)}</p>
                                </div>
                                <div className="text-right">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isReached ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-stone-100 text-stone-500 border-stone-200'}`}>
                                    目標 {fmtMoney(targetAsp)}
                                  </span>
                                  <p className={`text-sm mt-1 font-black ${isReached ? 'text-emerald-500' : 'text-amber-600'}`}>
                                    達標 {achieveRate}%
                                  </p>
                                </div>
                              </div>
                              
                              {/* 帶有終點線的狀態進度條 */}
                              <div className="relative w-full bg-stone-200 h-1.5 md:h-2 rounded-full mt-2">
                                 <div 
                                   className={`h-full rounded-full transition-all duration-1000 ${isReached ? 'bg-emerald-500' : 'bg-amber-500'}`} 
                                   style={{ width: `${safeRate}%` }}
                                 ></div>
                                 {/* 100% 目標衝線點 */}
                                 <div className="absolute top-[-4px] bottom-[-4px] right-0 w-[3px] bg-stone-400 rounded-full z-10 opacity-60"></div>
                              </div>
                            </>
                        )
                    })()}
                 </div>
               </div>
            </div>

            {/* 3. 本月風雲榜 (Top 5) (4/12) */}
            <div className="lg:col-span-6 xl:col-span-4 bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col h-full">
               <div className="bg-amber-50/80 px-5 py-4 text-amber-900 flex items-center gap-2 border-b border-amber-100/60">
                 <Award size={18} strokeWidth={2.5} className="text-amber-500"/>
                 <h3 className="text-sm font-extrabold tracking-wide">本月風雲榜 (Top 5)</h3>
               </div>
               <div className="p-4 md:p-5 space-y-3 flex-1 bg-stone-50/30 flex flex-col justify-center">
                 {therapistStats.rankings.slice(0, 5).map((t, i) => (
                   <div 
                     key={t.id} 
                     className={`flex justify-between items-center p-2.5 md:p-3 rounded-2xl border transition-colors ${t.id === currentUser?.id ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)]'}`}
                   >
                     <div className="flex items-center gap-3 text-sm font-bold text-stone-700 flex-1 min-w-0 pr-2">
                       <span className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-xs font-black shadow-inner ${i===0?'bg-gradient-to-br from-yellow-300 to-amber-500 text-white':i===1?'bg-gradient-to-br from-stone-200 to-stone-400 text-white':i===2?'bg-gradient-to-br from-orange-200 to-orange-400 text-white':'bg-stone-100 text-stone-400'}`}>{i+1}</span>
                       <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                         <span className="text-stone-700 font-bold">{t.name}</span>
                         <span className="shrink-0 text-[10px] text-stone-500 bg-stone-100/80 px-1.5 py-0.5 rounded font-medium border border-stone-200/50 tracking-wider">{t.storeDisplay}</span>
                         {t.id === currentUser?.id && <span className="shrink-0 text-[9px] bg-indigo-500 text-white px-1.5 py-0.5 rounded-full tracking-wider">ME</span>}
                       </div>
                     </div>
                     <span className={`shrink-0 font-mono font-black text-right pl-1 ${t.id === currentUser?.id ? 'text-indigo-600' : 'text-stone-600'}`}>{fmtMoney(t.totalRevenue)}</span>
                   </div>
                 ))}
                 {therapistStats.rankings.length === 0 && <div className="text-xs font-bold text-stone-400 text-center py-6">本月尚無排名資料</div>}
               </div>
            </div>

          </div>
        );
      })()}

      {/* ========================================================= */}
      {/* ★ 底部版塊：今日 Top 3 + 昨日 Top 3 + 大盤雷達 + 衝刺進度條 ★ */}
      {/* ========================================================= */}
      {therapistStats.myStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 lg:gap-5">
          
          {/* 1. 今日即時戰績 (Top 3) */}
          <div className="md:col-span-1 xl:col-span-3 bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col relative group">
            <div className="absolute top-0 right-0 p-4 opacity-5 text-rose-500"><Flame size={80} /></div>
            <div className="bg-rose-50/80 px-5 py-4 text-rose-900 flex items-center justify-between border-b border-rose-100/60">
              <div className="flex items-center gap-2">
                <Flame size={18} strokeWidth={2.5} className="text-rose-500 animate-pulse"/>
                <h3 className="text-sm font-extrabold tracking-wide">今日即時戰神</h3>
              </div>
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span></span>
            </div>
            <div className="p-5 space-y-4 flex-1 bg-stone-50/30 flex flex-col justify-center relative z-10">
              {therapistStats.todayTop3?.length > 0 ? therapistStats.todayTop3.map((t, i) => {
                const matchedInfo = therapistStats.rankings.find(r => r.id === t.id);
                const displayStore = matchedInfo?.storeDisplay || t.storeDisplay || "未知店";
                return (
                  <div key={t.id} className="flex justify-between items-center bg-white p-3 rounded-2xl border border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)]">
                    <div className="flex items-center gap-3 text-sm font-bold text-stone-700 flex-1 min-w-0 pr-2">
                      <span className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-xs font-black shadow-inner ${i===0?'bg-gradient-to-br from-rose-400 to-red-600 text-white':i===1?'bg-gradient-to-br from-stone-200 to-stone-400 text-white':'bg-gradient-to-br from-orange-200 to-orange-400 text-white'}`}>{i+1}</span>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-1.5 whitespace-nowrap overflow-hidden">
                            <span className="truncate text-stone-800">{t.name}</span>
                            {t.id === currentUser?.id && <span className="shrink-0 text-[9px] bg-indigo-500 text-white px-1.5 py-0.5 rounded-full tracking-wider">ME</span>}
                        </div>
                        <span className="text-[9px] text-stone-400 font-medium tracking-wider">{displayStore}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 font-mono font-black text-right pl-1 ${t.id === currentUser?.id ? 'text-indigo-600' : 'text-rose-600'}`}>{fmtMoney(t.revenue)}</span>
                  </div>
                );
              }) : <div className="text-xs font-bold text-stone-400 text-center py-6 bg-stone-50 rounded-2xl border border-dashed border-stone-200">今日戰火尚未點燃</div>}
            </div>
          </div>

          {/* 2. 昨日戰績 (Top 3) */}
          <div className="md:col-span-1 xl:col-span-3 bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
            <div className="bg-amber-50/80 px-5 py-4 text-amber-900 flex items-center gap-2 border-b border-amber-100/60">
              <Crown size={18} strokeWidth={2.5} className="text-amber-500"/>
              <h3 className="text-sm font-extrabold tracking-wide">昨日戰績 (Top 3)</h3>
            </div>
            <div className="p-5 space-y-4 flex-1 bg-stone-50/30 flex flex-col justify-center">
              {therapistStats.yesterdayTop3?.length > 0 ? therapistStats.yesterdayTop3.map((t, i) => {
                const matchedInfo = therapistStats.rankings.find(r => r.id === t.id);
                const displayStore = matchedInfo?.storeDisplay || t.storeDisplay || "未知店";
                return (
                  <div key={t.id} className="flex justify-between items-center bg-white p-3 rounded-2xl border border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)]">
                    <div className="flex items-center gap-3 text-sm font-bold text-stone-700 flex-1 min-w-0 pr-2">
                      <span className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-xs font-black shadow-inner ${i===0?'bg-gradient-to-br from-yellow-300 to-amber-500 text-white':i===1?'bg-gradient-to-br from-stone-200 to-stone-400 text-white':'bg-gradient-to-br from-orange-200 to-orange-400 text-white'}`}>{i+1}</span>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-1.5 whitespace-nowrap overflow-hidden">
                            <span className="truncate">{t.name}</span>
                            {t.id === currentUser?.id && <span className="shrink-0 text-[9px] bg-indigo-500 text-white px-1.5 py-0.5 rounded-full tracking-wider">ME</span>}
                        </div>
                        <span className="text-[9px] text-stone-400 font-medium tracking-wider">{displayStore}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 font-mono font-black text-right pl-1 ${t.id === currentUser?.id ? 'text-indigo-600' : 'text-stone-700'}`}>{fmtMoney(t.revenue)}</span>
                  </div>
                );
              }) : <div className="text-xs font-bold text-stone-400 text-center py-6 bg-stone-50 rounded-2xl border border-dashed border-stone-200">昨日無業績紀錄</div>}
            </div>
          </div>

          {/* 3. 全區營運大盤雷達 */}
          <div className="md:col-span-1 xl:col-span-3 bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
             <div className="bg-amber-50/80 px-5 py-4 text-amber-900 flex items-center gap-2 border-b border-amber-100/60">
               <Target size={18} strokeWidth={2.5} className="text-amber-500"/>
               <h3 className="text-sm font-extrabold tracking-wide">全區營運雷達</h3>
             </div>
             <div className="p-5 space-y-6 flex-1 bg-stone-50/30 flex flex-col justify-center">
               
               <div className="flex justify-between items-center border-b border-stone-100 pb-5">
                 <div>
                   <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">全區締結率</p>
                   <div className="flex items-baseline gap-2">
                     <span className="text-3xl font-black text-stone-800 font-mono tracking-tighter">{therapistStats.grandTotal.regionalNewClosingRate.toFixed(0)}%</span>
                   </div>
                 </div>
                 <div className="text-right">
                   <p className="text-[10px] font-bold text-stone-400 mb-1">您的表現</p>
                   <div className={`flex items-center gap-1 font-black text-xl font-mono ${therapistStats.myStats.newClosingRate >= therapistStats.grandTotal.regionalNewClosingRate ? 'text-emerald-500' : 'text-rose-500'}`}>
                     {therapistStats.myStats.newClosingRate.toFixed(0)}%
                     {therapistStats.myStats.newClosingRate >= therapistStats.grandTotal.regionalNewClosingRate ? <ArrowUp size={18} strokeWidth={3}/> : <ArrowDown size={18} strokeWidth={3}/>}
                   </div>
                 </div>
               </div>

               <div className="flex justify-between items-center">
                 <div>
                   <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">全區均單</p>
                   <div className="flex items-baseline gap-2">
                     <span className="text-2xl font-black text-stone-800 font-mono tracking-tighter">{fmtMoney(Math.round(therapistStats.grandTotal.regionalNewAsp))}</span>
                   </div>
                 </div>
                 <div className="text-right">
                   <p className="text-[10px] font-bold text-stone-400 mb-1">您的表現</p>
                   <div className={`flex items-center justify-end gap-1 font-black text-xl font-mono ${therapistStats.myStats.newAsp >= therapistStats.grandTotal.regionalNewAsp ? 'text-emerald-500' : 'text-rose-500'}`}>
                     {fmtMoney(Math.round(therapistStats.myStats.newAsp))}
                     {therapistStats.myStats.newAsp >= therapistStats.grandTotal.regionalNewAsp ? <ArrowUp size={18} strokeWidth={3}/> : <ArrowDown size={18} strokeWidth={3}/>}
                   </div>
                 </div>
               </div>

             </div>
          </div>

          {/* 4. 個人衝刺進度條 (Gauge) */}
          <div className="md:col-span-1 xl:col-span-3 bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
              <div className="bg-amber-50/80 px-5 py-4 text-amber-900 flex items-center gap-2 border-b border-amber-100/60">
                <Zap size={18} strokeWidth={2.5} className="text-amber-500"/>
                <h3 className="text-sm font-extrabold tracking-wide">個人衝刺中！</h3>
              </div>
              
              <div className="p-5 flex-1 bg-stone-50/30 flex flex-col items-center justify-between">
                  {(() => {
                      const getMyTarget = () => {
                        if (!therapistTargets) return 0;
                        const myId = therapistStats.myStats.id;
                        const myName = therapistStats.myStats.name;
                        const yStr = String(selectedYear);
                        const mStr = String(selectedMonth);
                        const mPad = mStr.padStart(2, '0');

                        const targetList = Object.values(therapistTargets);
                        const matchedDoc = targetList.find(t => 
                          (t.therapistId === myId || t.name === myName || t.therapistName === myName) && 
                          String(t.year) === yStr
                        );

                        if (matchedDoc) {
                          if (matchedDoc[mStr] !== undefined && matchedDoc[mStr] !== "") return Number(matchedDoc[mStr]);
                          if (matchedDoc[mPad] !== undefined && matchedDoc[mPad] !== "") return Number(matchedDoc[mPad]);
                          if (matchedDoc[`month_${mStr}`]) return Number(matchedDoc[`month_${mStr}`]);
                          if (matchedDoc.target) return Number(matchedDoc.target);
                        }
                        return 0;
                      };
                      
                      let myTargetVal = getMyTarget();
                      if (myTargetVal === 0) myTargetVal = 800000;
                      
                      const rev = therapistStats.myStats.totalRevenue;
                      const progress = Math.min(100, Math.round((rev / myTargetVal) * 100));
                      const remaining = Math.max(0, myTargetVal - rev);
                      return (
                          <>
                            <div className="flex-1 flex flex-col justify-center w-full mt-2">
                              <GaugeChart progress={progress} />
                            </div>
                            
                            <div className="text-center mt-6 w-full bg-white p-3 md:p-4 rounded-2xl border border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)]">
                               <p className="text-[11px] font-bold text-stone-500 leading-relaxed">
                                 距離本月目標 <span className="font-mono font-black text-stone-800">{fmtMoney(myTargetVal)}</span><br/>
                                 還差 <span className="text-rose-500 font-mono font-black">{fmtMoney(remaining)}</span>
                               </p>
                            </div>
                          </>
                      );
                  })()}
              </div>
          </div>

        </div>
      )}
      
      {(userRole !== 'therapist' || userRole === 'trainer') && ( 
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4"> 
          <MiniKpiCard title="管理師總業績" value={fmtMoney(therapistStats.grandTotal.totalRevenue)} icon={DollarSign} color="text-indigo-500" subText={`${therapistStats.grandTotal.count} 位在職人員`} /> 
          <MiniKpiCard title="管理師新客業績" value={fmtMoney(therapistStats.grandTotal.newCustomerRevenue)} icon={Sparkles} color="text-amber-500" /> 
          <MiniKpiCard title="管理師舊客業績" value={fmtMoney(therapistStats.grandTotal.oldCustomerRevenue)} icon={TrendingUp} color="text-cyan-500" /> 
          <MiniKpiCard title="管理師新舊客佔比" value={`${Math.round((therapistStats.grandTotal.newCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100)}% / ${Math.round((therapistStats.grandTotal.oldCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100)}%`} icon={Activity} color="text-fuchsia-500" subText="新客 / 舊客" /> 
          <MiniKpiCard title="管理師退費總額" value={fmtMoney(therapistStats.grandTotal.returnRevenue)} icon={FileWarning} color="text-rose-500" /> 
        </div> 
      )}
      
      <Card title="管理師績效排行榜" subtitle="依本月個人總業績排序 (即時更新)">
        <div className="grid grid-cols-1 w-full">
          <div className="flex justify-end mb-4"><button onClick={handleExportCSV} className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors border border-emerald-100"><Download size={16} /> 匯出 CSV</button></div>
          <div className="overflow-x-auto w-full pb-2"><table className="w-full text-left border-collapse min-w-[1200px] whitespace-nowrap"><thead><tr className="text-xs font-bold text-stone-400 border-b border-stone-100 bg-stone-50/50"><th className="p-3 md:p-4 w-16 text-center">排名</th><th className="p-3 md:p-4">姓名</th><th className="p-3 md:p-4">所屬店家</th><th className="p-3 md:p-4 text-right">個人總業績</th><th className="p-3 md:p-4 text-right">新客業績</th><th className="p-3 md:p-4 text-right">舊客業績</th><th className="p-3 md:p-4 text-center">新舊客佔比</th><th className="p-3 md:p-4 text-right">新客締結率</th><th className="p-3 md:p-4 text-right">新客人數</th><th className="p-3 md:p-4 text-right">新客留單數</th><th className="p-3 md:p-4 text-right">新客平均業績</th><th className="p-3 md:p-4 text-right">舊客平均業績</th></tr></thead><tbody className="text-sm">
            {therapistStats.rankings.filter(t => userRole !== 'therapist' || t.id === currentUser?.id).map((t, idx) => (
              <tr key={t.id} className={`border-b border-stone-50 hover:bg-stone-50 transition-colors ${currentUser?.id === t.id ? "bg-indigo-50 hover:bg-indigo-100" : ""}`}>
                <td className="p-3 md:p-4 text-center"><span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${t.rank <= 3 ? "bg-amber-100 text-amber-700 ring-4 ring-amber-50" : t.status === "DANGER" ? "bg-rose-100 text-rose-700 ring-4 ring-rose-50" : "bg-stone-100 text-stone-500"}`}>{t.rank}</span></td>
                <td className="p-3 md:p-4 font-bold text-stone-700 flex flex-wrap items-center gap-2">
                  {t.name}
                  {!t.isSystemStaff && <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded font-bold border border-stone-200">支援/離職</span>}
                  {currentUser?.id === t.id && <span className="px-2 py-0.5 bg-indigo-200 text-indigo-700 text-[10px] rounded-full">ME</span>}
                  {t.status === "DANGER" && <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-bold">加油</span>}
                </td>
                <td className="p-3 md:p-4 text-stone-500">{t.storeDisplay}</td><td className="p-3 md:p-4 text-right font-mono font-bold text-indigo-600">{fmtMoney(t.totalRevenue)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtMoney(t.newCustomerRevenue)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtMoney(t.oldCustomerRevenue)}</td><td className="p-3 md:p-4 text-center font-mono text-xs text-stone-400">{t.revenueMix}</td><td className="p-3 md:p-4 text-right font-mono font-bold text-stone-700">{t.newClosingRate.toFixed(0)}%</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(t.newCustomerCount)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(t.newCustomerClosings)}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(Math.round(t.newAsp))}</td><td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(Math.round(t.oldAsp))}</td>
              </tr>
            ))} 
            {therapistStats.rankings.length === 0 && (<tr><td colSpan={12} className="p-8 text-center text-stone-400">本月尚無資料</td></tr>)}
          </tbody></table></div>
          <div className="md:hidden py-2 text-center text-stone-400 text-xs flex justify-center items-center gap-1 bg-stone-50 rounded-b-xl border-t border-stone-100"><ArrowLeft size={12}/> 左右滑動以查看更多 <ArrowRight size={12}/></div>
        </div>
      </Card>
    </div>
  );
};

export default TherapistPerformanceView;