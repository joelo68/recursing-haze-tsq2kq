// src/components/TherapistPerformanceView.jsx
import React, { useContext, useMemo } from "react";
import { Flame, Crown, AlertTriangle, Zap, Frown, DollarSign, Sparkles, TrendingUp, Activity, FileWarning, Download, ArrowLeft, ArrowRight, Store, ArrowUp, ArrowDown, Target, Users, Receipt, Award, UsersRound, Trophy } from "lucide-react";
import { AppContext } from "../AppContext";
import { Card } from "./SharedUI";

// ★ 專屬的 SVG 半圓儀表板元件
const GaugeChart = ({ progress, color = "#f59e0b" }) => {
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
          stroke={color}
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
  const { fmtMoney, fmtNum, userRole, currentUser, managers, therapistTargets, selectedYear, selectedMonth, targets, therapists } = useContext(AppContext);

  const isManagerial = userRole !== 'therapist';

  // ============================================================================
  // ★ [完美修復] 全方位目標抓取引擎：針對 monthlyTargets 結構進行深度解析
  // ============================================================================
  const resolveTherapistTarget = (memberId, memberName) => {
    let foundTarget = 0;
    const yStr = String(selectedYear);
    const mStr = String(selectedMonth);
    const mPad = mStr.padStart(2, '0');
    const targetList = Object.values(therapistTargets || {});
    
    const matchedDoc = targetList.find(t => 
        (t.therapistId === memberId || t.name === memberName || t.therapistName === memberName) && 
        String(t.year) === yStr
    );

    if (matchedDoc) {
        // 1. 優先進入 monthlyTargets 物件尋找 (對應 TherapistTargetView.jsx 的寫入邏輯)
        if (matchedDoc.monthlyTargets && matchedDoc.monthlyTargets[mStr] !== undefined && matchedDoc.monthlyTargets[mStr] !== "") {
            foundTarget = Number(matchedDoc.monthlyTargets[mStr]);
        } 
        // 2. 若無，則掃描外層的舊版結構
        else {
            const possibleKeys = [mStr, mPad, `month_${mStr}`, `month_${mPad}`, 'target'];
            for (let k of possibleKeys) {
                if (matchedDoc[k] !== undefined && matchedDoc[k] !== null && matchedDoc[k] !== "") {
                    foundTarget = Number(matchedDoc[k]);
                    break;
                }
            }
        }
    }

    if (foundTarget === 0 && therapists) {
        const tInfo = therapists.find(t => t.id === memberId || t.name === memberName);
        if (tInfo?.target) foundTarget = Number(tInfo.target);
        else if (tInfo?.monthlyTarget) foundTarget = Number(tInfo.monthlyTarget);
    }

    return foundTarget > 0 ? foundTarget : 800000; 
  };

  const myTeamStats = useMemo(() => {
    if (!isManagerial || (userRole !== 'store' && userRole !== 'manager')) return null;

    let myStores = [];
    if (userRole === 'store') myStores = currentUser.stores || [currentUser.storeName] || [];
    if (userRole === 'manager') myStores = managers[currentUser.name] || [];

    const isMyTeam = (storeDisplay) => {
        if (!storeDisplay) return false;
        return myStores.some(ms => {
            const core = ms.replace(/店$/, '').trim();
            return storeDisplay.includes(core);
        });
    };

    const teamMembers = therapistStats.rankings.filter(t => isMyTeam(t.storeDisplay));
    if (teamMembers.length === 0) return null;

    const totalRev = teamMembers.reduce((sum, t) => sum + t.totalRevenue, 0);
    const newRev = teamMembers.reduce((sum, t) => sum + t.newCustomerRevenue, 0);
    const oldRev = teamMembers.reduce((sum, t) => sum + t.oldCustomerRevenue, 0);
    const newCount = teamMembers.reduce((sum, t) => sum + t.newCustomerCount, 0);
    const newClosings = teamMembers.reduce((sum, t) => sum + t.newCustomerClosings, 0);

    const teamNewAsp = newCount > 0 ? newRev / newCount : 0;
    const teamClosingRate = newCount > 0 ? (newClosings / newCount) * 100 : 0;
    const mvp = teamMembers.length > 0 ? teamMembers[0] : null;

    const regionClosingRate = therapistStats.grandTotal.regionalNewClosingRate || 0;
    const warnings = teamMembers.filter(t => t.newClosingRate < regionClosingRate);

    let teamTarget = 0;
    teamMembers.forEach(member => {
        teamTarget += resolveTherapistTarget(member.id, member.name);
    });

    return { teamMembers, totalRev, newRev, oldRev, teamNewAsp, teamClosingRate, mvp, warnings, teamTarget, isMyTeam };
  }, [isManagerial, userRole, currentUser, managers, therapistStats.rankings, therapistStats.grandTotal.regionalNewClosingRate, therapistTargets, selectedYear, selectedMonth, therapists]);

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
    link.setAttribute("href", url);
    link.setAttribute("download", `${brandInfo.name}_人員績效報告_${new Date().toISOString().split("T")[0]}.csv`);
    link.click();
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
      
      {/* ============================================================================== */}
      {/* ★ [視角 1] 管理師個人視角 ★                                                  */}
      {/* ============================================================================== */}
      {!isManagerial && therapistStats.myStats && (() => {
        const info = getMotivationalMessage(therapistStats.myStats);
        const status = therapistStats.myStats.status;
        let bgClass = "bg-gradient-to-br from-indigo-600 to-purple-700"; 
        let shadowClass = "shadow-indigo-200";
        if (status === "TOP") { bgClass = "bg-gradient-to-br from-amber-400 to-orange-500"; shadowClass = "shadow-amber-200"; } 
        else if (status === "DANGER") { bgClass = "bg-gradient-to-br from-rose-600 to-red-700"; shadowClass = "shadow-rose-200"; }

        return (
          <>
            {/* --- 管理師頂部版塊 --- */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 mb-8">
              {/* 1. 紫色英雄卡 */}
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

              {/* 2. 分析 KPI 小卡 */}
              <div className="lg:col-span-6 xl:col-span-3 flex flex-col gap-4 lg:gap-5">
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

                 <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col flex-1 h-full">
                   <div className="bg-amber-50/80 px-4 py-3 text-amber-900 flex items-center gap-1.5 border-b border-amber-100/60">
                     <Target size={16} strokeWidth={2.5} className="text-amber-500"/>
                     <h3 className="text-xs font-bold tracking-wide">新客客單達標率</h3>
                   </div>
                   <div className="p-4 md:p-5 flex-1 flex flex-col justify-center bg-stone-50/30">
                      {(() => {
                          const newAsp = Math.round(therapistStats.myStats.newAsp || 0);
                          
                          let targetAsp = targets?.newASP;
                          if (!targetAsp || targetAsp === 3500) { 
                              if (brandInfo?.id === 'cyj' || brandInfo?.name?.toUpperCase().includes('CYJ')) {
                                  targetAsp = 16000;
                              } else if (brandInfo?.id === 'anniu' || brandInfo?.name?.includes('安妞')) {
                                  targetAsp = 25000;
                              } else {
                                  targetAsp = 25000;
                              }
                          }
                          
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
                                <div className="relative w-full bg-stone-200 h-1.5 md:h-2 rounded-full mt-2">
                                   <div className={`h-full rounded-full transition-all duration-1000 ${isReached ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${safeRate}%` }}></div>
                                   <div className="absolute top-[-4px] bottom-[-4px] right-0 w-[3px] bg-stone-400 rounded-full z-10 opacity-60"></div>
                                </div>
                              </>
                          )
                      })()}
                   </div>
                 </div>
              </div>

              {/* 3. 本月風雲榜 (Top 5) */}
              <div className="lg:col-span-6 xl:col-span-4 bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col h-full">
                 <div className="bg-amber-50/80 px-5 py-4 text-amber-900 flex items-center gap-2 border-b border-amber-100/60">
                   <Award size={18} strokeWidth={2.5} className="text-amber-500"/>
                   <h3 className="text-sm font-extrabold tracking-wide">本月風雲榜 (Top 5)</h3>
                 </div>
                 <div className="p-4 md:p-5 space-y-3 flex-1 bg-stone-50/30 flex flex-col justify-center">
                   {therapistStats.rankings.slice(0, 5).map((t, i) => (
                     <div key={t.id} className={`flex justify-between items-center p-2.5 md:p-3 rounded-2xl border transition-colors ${t.id === currentUser?.id ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)]'}`}>
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

            {/* --- 管理師底部即時戰況 --- */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 lg:gap-5 mb-8">
              {/* 今日即時戰神 */}
              <div className="md:col-span-1 xl:col-span-3 bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col relative group">
                <div className="absolute top-0 right-0 p-4 opacity-5 text-rose-500"><Flame size={80} /></div>
                <div className="bg-rose-50/80 px-5 py-4 text-rose-900 flex items-center justify-between border-b border-rose-100/60">
                  <div className="flex items-center gap-2"><Flame size={18} strokeWidth={2.5} className="text-rose-500 animate-pulse"/><h3 className="text-sm font-extrabold tracking-wide">今日即時戰神</h3></div>
                  <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span></span>
                </div>
                <div className="p-5 space-y-4 flex-1 bg-stone-50/30 flex flex-col justify-center relative z-10">
                  {therapistStats.todayTop3?.length > 0 ? therapistStats.todayTop3.map((t, i) => {
                    const matchedInfo = therapistStats.rankings.find(r => r.id === t.id);
                    const displayStore = matchedInfo?.storeDisplay || t.storeDisplay || "未知店";
                    return (
                      <div key={t.id} className="flex justify-between items-center bg-white p-3 md:p-4 rounded-2xl border border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)]">
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

              {/* 昨日戰績 */}
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
                      <div key={t.id} className="flex justify-between items-center bg-white p-3 md:p-4 rounded-2xl border border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)]">
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

              {/* 全區營運大盤雷達 */}
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

              {/* 個人衝刺進度條 (Gauge) */}
              <div className="md:col-span-1 xl:col-span-3 bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="bg-amber-50/80 px-5 py-4 text-amber-900 flex items-center gap-2 border-b border-amber-100/60">
                    <Zap size={18} strokeWidth={2.5} className="text-amber-500"/>
                    <h3 className="text-sm font-extrabold tracking-wide">個人衝刺中！</h3>
                  </div>
                  <div className="p-5 flex-1 bg-stone-50/30 flex flex-col items-center justify-between">
                      {(() => {
                          // ★ 使用最新開發的引擎解析目標金額
                          const myTargetVal = resolveTherapistTarget(therapistStats.myStats.id, therapistStats.myStats.name);
                          
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
          </>
        );
      })()}

      {/* ============================================================================== */}
      {/* ★ [視角 2] 店長與區長專屬視角 (新增：我的戰隊實時監控)                           */}
      {/* ============================================================================== */}
      {isManagerial && myTeamStats && myTeamStats.teamMembers.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 mb-8">
             
             {/* 1. 輕量通透版：全區 TOP 5 看板 (4/12) */}
             <div className="lg:col-span-12 xl:col-span-4 bg-white rounded-3xl border border-stone-200 shadow-sm relative overflow-hidden flex flex-col h-full min-h-[320px]">
                <div className="absolute top-0 right-0 p-4 opacity-[0.03] text-amber-900 pointer-events-none"><Trophy size={180} /></div> 
                <div className="bg-amber-50/80 px-5 py-4 text-amber-900 flex items-center gap-2 border-b border-amber-100/60 relative z-10">
                  <Trophy size={18} strokeWidth={2.5} className="text-amber-500"/>
                  <h3 className="text-sm font-extrabold tracking-wide">本月全區 Top 5 榮耀榜</h3>
                </div>
                <div className="p-4 md:p-5 flex-1 bg-stone-50/30 flex flex-col justify-center gap-3 relative z-10">
                  {therapistStats.rankings.slice(0, 5).map((t, i) => {
                    const isMyOwnTeam = myTeamStats.isMyTeam(t.storeDisplay);
                    return (
                      <div key={t.id} className={`flex justify-between items-center p-3 rounded-2xl border transition-shadow ${isMyOwnTeam ? 'bg-amber-50/60 border-amber-100 shadow-sm' : 'bg-white border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.04)] hover:shadow-md'}`}>
                        <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                          <span className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-xs font-black shadow-inner ${i===0 ? 'bg-gradient-to-br from-yellow-300 to-amber-500 text-white ring-2 ring-yellow-100/50' : i===1 ? 'bg-gradient-to-br from-stone-200 to-stone-400 text-white' : i===2 ? 'bg-gradient-to-br from-orange-200 to-orange-400 text-white' : 'bg-stone-100 text-stone-400'}`}>
                            {i+1}
                          </span>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-nowrap overflow-hidden">
                            <span className="font-extrabold text-[15px] text-stone-800 truncate">{t.name}</span>
                            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium border tracking-wider ${isMyOwnTeam ? 'bg-amber-100 text-amber-700 border-amber-200/50' : 'text-stone-500 bg-stone-100/80 border-stone-200/50'}`}>
                              {t.storeDisplay}
                            </span>
                          </div>
                        </div>
                        <span className={`shrink-0 font-mono font-bold text-lg ${isMyOwnTeam ? 'text-amber-600' : 'text-stone-700'}`}>{fmtMoney(t.totalRevenue)}</span>
                      </div>
                    )
                  })}
                </div>
             </div>

             {/* 2. ✨ 我的戰隊實時監控 (8/12) */}
             <div className="lg:col-span-12 xl:col-span-8 bg-white rounded-3xl border border-stone-200 shadow-sm relative overflow-hidden flex flex-col h-full min-h-[320px]">
                 {/* 專屬 Header */}
                 <div className="bg-indigo-50/80 px-5 py-4 text-indigo-900 flex items-center justify-between border-b border-indigo-100/60 relative z-10">
                    <div className="flex items-center gap-2">
                        <Sparkles size={18} strokeWidth={2.5} className="text-indigo-500"/>
                        <h3 className="text-sm font-extrabold tracking-wide">
                            ✨ 我的戰隊實時監控 
                            <span className="ml-2 font-normal text-indigo-600/80">
                                ({userRole === 'manager' ? currentUser?.name + '區' : (currentUser?.storeName || '門市')})
                            </span>
                        </h3>
                    </div>
                    <span className="text-[10px] font-bold bg-white text-indigo-600 px-2 py-0.5 rounded border border-indigo-100 shadow-sm">管轄 {myTeamStats.teamMembers.length} 人</span>
                 </div>
                 
                 {/* 三欄式管理面板 */}
                 <div className="p-4 md:p-5 flex-1 bg-stone-50/30 grid grid-cols-1 md:grid-cols-3 gap-4">
                     
                     {/* Col 1: 團隊進度 */}
                     <div className="flex flex-col gap-3 bg-white p-4 md:p-5 rounded-2xl border border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-50 rounded-bl-full -mr-8 -mt-8"></div>
                        <p className="text-[11px] font-bold text-stone-400 uppercase tracking-wider">團隊進度 (達成率)</p>
                        <div className="flex items-baseline gap-1 mt-1">
                            <span className="text-4xl font-black text-stone-800 font-mono tracking-tighter">
                                {Math.round((myTeamStats.totalRev / (myTeamStats.teamTarget || 1))*100)}%
                            </span>
                        </div>
                        <div className="w-full bg-stone-100 h-2.5 rounded-full overflow-hidden mt-2 mb-1 shadow-inner">
                            <div className="bg-indigo-500 h-full transition-all duration-1000" style={{width: `${Math.min(100, (myTeamStats.totalRev / (myTeamStats.teamTarget || 1))*100)}%`}}></div>
                        </div>
                        <div className="flex flex-col text-[10px] font-bold mt-auto pt-2 gap-1">
                            <div className="flex justify-between items-center"><span className="text-stone-400">目前總業績</span><span className="text-stone-700 font-mono text-xs">{fmtMoney(myTeamStats.totalRev)}</span></div>
                            <div className="flex justify-between items-center"><span className="text-stone-400">本月總目標</span><span className="text-stone-600 font-mono text-xs">{fmtMoney(myTeamStats.teamTarget)}</span></div>
                        </div>
                     </div>

                     {/* Col 2: 團隊健康度 (對標全區) */}
                     <div className="flex flex-col gap-0 bg-white p-4 md:p-5 rounded-2xl border border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] justify-between">
                        <div>
                            <p className="text-[11px] font-bold text-stone-400 uppercase tracking-wider mb-2">戰隊均單 vs 全區</p>
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-xl font-black font-mono text-stone-800 leading-none mb-1">{fmtMoney(Math.round(myTeamStats.teamNewAsp))}</span>
                                    <span className="text-[9px] text-stone-400">全區 {fmtMoney(Math.round(therapistStats.grandTotal.regionalNewAsp))}</span>
                                </div>
                                {myTeamStats.teamNewAsp >= therapistStats.grandTotal.regionalNewAsp ? (
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg flex items-center gap-1 border border-emerald-100"><ArrowUp size={12}/> 領先</span>
                                ) : (
                                    <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-lg flex items-center gap-1 border border-rose-100"><ArrowDown size={12}/> 落後</span>
                                )}
                            </div>
                        </div>
                        <div className="border-t border-stone-100 my-4 border-dashed"></div>
                        <div>
                            <p className="text-[11px] font-bold text-stone-400 uppercase tracking-wider mb-2">戰隊締結率 vs 全區</p>
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-xl font-black font-mono text-stone-800 leading-none mb-1">{myTeamStats.teamClosingRate.toFixed(0)}%</span>
                                    <span className="text-[9px] text-stone-400">全區 {therapistStats.grandTotal.regionalNewClosingRate.toFixed(0)}%</span>
                                </div>
                                {myTeamStats.teamClosingRate >= therapistStats.grandTotal.regionalNewClosingRate ? (
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg flex items-center gap-1 border border-emerald-100"><ArrowUp size={12}/> 領先</span>
                                ) : (
                                    <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-lg flex items-center gap-1 border border-rose-100"><ArrowDown size={12}/> 落後</span>
                                )}
                            </div>
                        </div>
                     </div>

                     {/* Col 3: 戰隊異常與亮點 */}
                     <div className="flex flex-col gap-3">
                        <div className="bg-amber-50/80 p-3.5 rounded-2xl border border-amber-200/60 flex flex-col gap-1 shadow-sm">
                            <p className="text-[10px] font-extrabold text-amber-700 uppercase flex items-center gap-1.5 mb-1"><Flame size={14}/> 本月戰神 (MVP)</p>
                            {myTeamStats.mvp ? (
                                <div className="flex items-center justify-between">
                                    <span className="font-extrabold text-[15px] text-stone-800">{myTeamStats.mvp.name}</span>
                                    <span className="font-mono font-black text-amber-600 text-lg">{fmtMoney(myTeamStats.mvp.totalRevenue)}</span>
                                </div>
                            ) : (
                                <span className="text-xs text-stone-500 font-bold">尚無資料</span>
                            )}
                        </div>
                        <div className="bg-rose-50/80 p-3.5 rounded-2xl border border-rose-200/60 flex flex-col gap-2 flex-1 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-2 opacity-10 text-rose-600 pointer-events-none"><AlertTriangle size={40}/></div>
                            <p className="text-[10px] font-extrabold text-rose-700 uppercase flex items-center gap-1.5 relative z-10"><AlertTriangle size={14}/> 締結警訊 ({myTeamStats.warnings.length}人)</p>
                            <div className="flex flex-wrap gap-1.5 mt-1 relative z-10">
                                {myTeamStats.warnings.length > 0 ? myTeamStats.warnings.map(w => (
                                    <span key={w.id} className="text-[10px] font-bold bg-white text-rose-600 px-2 py-0.5 rounded-md shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-rose-100">{w.name} ({w.newClosingRate.toFixed(0)}%)</span>
                                )) : (
                                    <span className="text-xs font-bold text-emerald-600 flex items-center gap-1"><CheckCircle size={14}/> 全員表現健康</span>
                                )}
                            </div>
                            <p className="text-[9px] font-bold text-rose-400/80 mt-auto pt-1 relative z-10 tracking-wider">低於全區平均締結率</p>
                        </div>
                     </div>
                 </div>
             </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* ★ [視角 3] 高階總監視角 (Director/Master - 維持原版全區三拼)                   */}
      {/* ============================================================================== */}
      {isManagerial && (!myTeamStats || myTeamStats.teamMembers.length === 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 mb-8">
             {/* 輕量通透版：本月全區 TOP 5 看板 (5/12) */}
             <div className="lg:col-span-12 xl:col-span-5 bg-white rounded-3xl border border-stone-200 shadow-sm relative overflow-hidden flex flex-col h-full min-h-[320px]">
                <div className="absolute top-0 right-0 p-4 opacity-[0.03] text-amber-900 pointer-events-none"><Trophy size={180} /></div> 
                <div className="bg-amber-50/80 px-5 py-4 text-amber-900 flex items-center gap-2 border-b border-amber-100/60 relative z-10">
                  <Trophy size={18} strokeWidth={2.5} className="text-amber-500"/>
                  <h3 className="text-sm font-extrabold tracking-wide">本月全區 Top 5 榮耀榜</h3>
                </div>
                <div className="p-4 md:p-5 flex-1 bg-stone-50/30 flex flex-col justify-center gap-3 relative z-10">
                  {therapistStats.rankings.slice(0, 5).map((t, i) => (
                    <div key={t.id} className="flex justify-between items-center bg-white p-3 rounded-2xl border border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.04)] hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                        <span className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-xs font-black shadow-inner ${i===0 ? 'bg-gradient-to-br from-yellow-300 to-amber-500 text-white ring-2 ring-yellow-100/50' : i===1 ? 'bg-gradient-to-br from-stone-200 to-stone-400 text-white' : i===2 ? 'bg-gradient-to-br from-orange-200 to-orange-400 text-white' : 'bg-stone-100 text-stone-400'}`}>
                          {i+1}
                        </span>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-nowrap overflow-hidden">
                          <span className="font-extrabold text-[15px] text-stone-800 truncate">{t.name}</span>
                          <span className="shrink-0 text-[10px] text-stone-500 bg-stone-100/80 px-1.5 py-0.5 rounded font-medium border border-stone-200/50 tracking-wider">
                            {t.storeDisplay}
                          </span>
                        </div>
                      </div>
                      <span className={`shrink-0 font-mono font-bold text-lg text-stone-700`}>{fmtMoney(t.totalRevenue)}</span>
                    </div>
                  ))}
                  {therapistStats.rankings.length === 0 && <div className="text-sm font-bold text-stone-400 text-center py-10">本月尚無排名資料</div>}
                </div>
             </div>

             {/* 全區新舊客佔比分析 (3/12) */}
             <div className="lg:col-span-6 xl:col-span-3 bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
                <div className="bg-amber-50/80 px-5 py-4 text-amber-900 flex items-center gap-2 border-b border-amber-100/60">
                  <UsersRound size={18} strokeWidth={2.5} className="text-amber-500"/>
                  <h3 className="text-sm font-extrabold tracking-wide">團隊客源結構</h3>
                </div>
                <div className="p-5 flex-1 bg-stone-50/30 flex flex-col justify-center space-y-5">
                   <div className="flex justify-between items-center">
                      <div>
                          <p className="text-[10px] font-bold text-stone-400 uppercase">全區新客總額</p>
                          <p className="text-xl font-black font-mono text-stone-800">{fmtMoney(therapistStats.grandTotal.newCustomerRevenue)}</p>
                      </div>
                      <div className="text-right">
                          <p className="text-[10px] font-bold text-stone-400">平均締結</p>
                          <p className="text-lg font-bold text-amber-600 font-mono">{therapistStats.grandTotal.regionalNewClosingRate.toFixed(0)}%</p>
                      </div>
                   </div>
                   <div className="flex justify-between items-center">
                      <div>
                          <p className="text-[10px] font-bold text-stone-400 uppercase">全區舊客總額</p>
                          <p className="text-xl font-black font-mono text-stone-800">{fmtMoney(therapistStats.grandTotal.oldCustomerRevenue)}</p>
                      </div>
                      <div className="text-right">
                          <p className="text-[10px] font-bold text-stone-400">客源佔比</p>
                          <p className="text-lg font-bold text-cyan-600 font-mono">
                              {Math.round((therapistStats.grandTotal.newCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100)}% / {Math.round((therapistStats.grandTotal.oldCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100)}%
                          </p>
                      </div>
                   </div>
                   <div className="w-full bg-stone-200 h-2.5 rounded-full flex overflow-hidden shadow-inner">
                      <div className="bg-amber-500 h-full transition-all duration-1000" style={{ width: `${(therapistStats.grandTotal.newCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100}%` }}></div>
                      <div className="bg-cyan-400 h-full transition-all duration-1000" style={{ width: `${(therapistStats.grandTotal.oldCustomerRevenue / (therapistStats.grandTotal.totalRevenue || 1)) * 100}%` }}></div>
                   </div>
                </div>
             </div>

             {/* 團隊達標率雷達 (4/12) */}
             <div className="lg:col-span-6 xl:col-span-4 bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
                <div className="bg-amber-50/80 px-5 py-4 text-amber-900 flex items-center gap-2 border-b border-amber-100/60">
                  <Target size={18} strokeWidth={2.5} className="text-amber-500"/>
                  <h3 className="text-sm font-extrabold tracking-wide">團隊達標雷達</h3>
                </div>
                <div className="p-5 flex-1 bg-stone-50/30 flex flex-col items-center justify-between">
                   {(() => {
                      const reachedCount = therapistStats.rankings.filter(t => t.totalRevenue >= 800000).length;
                      const totalCount = therapistStats.rankings.length || 1;
                      const teamProgress = Math.round((reachedCount / totalCount) * 100);
                      return (
                          <>
                            <div className="flex-1 flex flex-col justify-center w-full mt-2">
                               <GaugeChart progress={teamProgress} color="#10b981" />
                            </div>
                            <div className="text-center mt-6 w-full bg-white p-4 rounded-2xl border border-stone-100 shadow-sm flex justify-around items-center">
                               <div className="flex flex-col items-center">
                                  <p className="text-[10px] font-bold text-stone-400 mb-1">全區總業績</p>
                                  <p className="text-lg sm:text-xl font-black text-indigo-600 font-mono">{fmtMoney(therapistStats.grandTotal.totalRevenue)}</p>
                               </div>
                               <div className="w-px h-10 bg-stone-100"></div>
                               <div className="flex flex-col items-center">
                                  <p className="text-[10px] font-bold text-stone-400 mb-1">達標人數</p>
                                  <p className="text-lg sm:text-xl font-black text-emerald-500 font-mono">{reachedCount} <span className="text-[10px] text-emerald-500/70">/{totalCount}</span></p>
                               </div>
                               <div className="w-px h-10 bg-stone-100"></div>
                               <div className="flex flex-col items-center">
                                  <p className="text-[10px] font-bold text-stone-400 mb-1">人均產值</p>
                                  <p className="text-lg sm:text-xl font-black text-stone-800 font-mono">{fmtMoney(Math.round(therapistStats.grandTotal.totalRevenue / totalCount))}</p>
                               </div>
                            </div>
                          </>
                      )
                   })()}
                </div>
             </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* ★ 共通底部即時戰況 (今日與昨日Top3)                                            */}
      {/* ============================================================================== */}
      {isManagerial && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5 mb-8">
          {/* 今日即時戰神 */}
          <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col relative group">
            <div className="absolute top-0 right-0 p-4 opacity-5 text-rose-500"><Flame size={80} /></div>
            <div className="bg-rose-50/80 px-5 py-4 text-rose-900 flex items-center justify-between border-b border-rose-100/60">
              <div className="flex items-center gap-2"><Flame size={18} strokeWidth={2.5} className="text-rose-500 animate-pulse"/><h3 className="text-sm font-extrabold tracking-wide">今日即時戰神</h3></div>
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span></span>
            </div>
            <div className="p-5 space-y-4 flex-1 bg-stone-50/30 flex flex-col justify-center relative z-10">
              {therapistStats.todayTop3?.length > 0 ? therapistStats.todayTop3.map((t, i) => {
                const matchedInfo = therapistStats.rankings.find(r => r.id === t.id);
                const displayStore = matchedInfo?.storeDisplay || t.storeDisplay || "未知店";
                return (
                  <div key={t.id} className="flex justify-between items-center bg-white p-3 md:p-4 rounded-2xl border border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-4 text-sm font-bold text-stone-700 flex-1 min-w-0 pr-2">
                      <span className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-xs font-black shadow-inner ${i===0?'bg-gradient-to-br from-rose-400 to-red-600 text-white':i===1?'bg-gradient-to-br from-stone-200 to-stone-400 text-white':'bg-gradient-to-br from-orange-200 to-orange-400 text-white'}`}>{i+1}</span>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-nowrap overflow-hidden">
                          <span className="truncate text-stone-800 text-[15px]">{t.name}</span>
                          <span className="shrink-0 text-[10px] text-stone-500 bg-stone-100/80 px-1.5 py-0.5 rounded font-medium border border-stone-200/50 tracking-wider">{displayStore}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 font-mono font-black text-lg text-rose-600`}>{fmtMoney(t.revenue)}</span>
                  </div>
                );
              }) : <div className="text-sm font-bold text-stone-400 text-center py-8 bg-stone-50 rounded-2xl border border-dashed border-stone-200">今日戰火尚未點燃</div>}
            </div>
          </div>

          {/* 昨日戰績 */}
          <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
            <div className="bg-amber-50/80 px-5 py-4 text-amber-900 flex items-center gap-2 border-b border-amber-100/60">
              <Crown size={18} strokeWidth={2.5} className="text-amber-500"/>
              <h3 className="text-sm font-extrabold tracking-wide">昨日戰績 (Top 3)</h3>
            </div>
            <div className="p-5 space-y-4 flex-1 bg-stone-50/30 flex flex-col justify-center">
              {therapistStats.yesterdayTop3?.length > 0 ? therapistStats.yesterdayTop3.map((t, i) => {
                const matchedInfo = therapistStats.rankings.find(r => r.id === t.id);
                const displayStore = matchedInfo?.storeDisplay || t.storeDisplay || "未知店";
                return (
                  <div key={t.id} className="flex justify-between items-center bg-white p-3 md:p-4 rounded-2xl border border-stone-100 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-4 text-sm font-bold text-stone-700 flex-1 min-w-0 pr-2">
                      <span className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-xs font-black shadow-inner ${i===0?'bg-gradient-to-br from-yellow-300 to-amber-500 text-white':i===1?'bg-gradient-to-br from-stone-200 to-stone-400 text-white':'bg-gradient-to-br from-orange-200 to-orange-400 text-white'}`}>{i+1}</span>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-nowrap overflow-hidden">
                          <span className="truncate text-stone-800 text-[15px]">{t.name}</span>
                          <span className="shrink-0 text-[10px] text-stone-500 bg-stone-100/80 px-1.5 py-0.5 rounded font-medium border border-stone-200/50 tracking-wider">{displayStore}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 font-mono font-black text-lg text-stone-700`}>{fmtMoney(t.revenue)}</span>
                  </div>
                );
              }) : <div className="text-sm font-bold text-stone-400 text-center py-8 bg-stone-50 rounded-2xl border border-dashed border-stone-200">昨日無業績紀錄</div>}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ★ 共通底部表格：全區大排行 (結合店長大魚缸高光機制) ★              */}
      {/* ========================================================= */}
      <Card title="管理師績效排行榜" subtitle="依本月個人總業績排序 (全區視角)">
        <div className="grid grid-cols-1 w-full">
          <div className="flex justify-end mb-4"><button onClick={handleExportCSV} className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors border border-emerald-100"><Download size={16} /> 匯出 CSV</button></div>
          <div className="overflow-x-auto w-full pb-2">
            <table className="w-full text-left border-collapse min-w-[1200px] whitespace-nowrap">
              <thead><tr className="text-xs font-bold text-stone-400 border-b border-stone-100 bg-stone-50/50"><th className="p-3 md:p-4 w-16 text-center">排名</th><th className="p-3 md:p-4">姓名</th><th className="p-3 md:p-4">所屬店家</th><th className="p-3 md:p-4 text-right">個人總業績</th><th className="p-3 md:p-4 text-right">新客業績</th><th className="p-3 md:p-4 text-right">舊客業績</th><th className="p-3 md:p-4 text-center">新舊客佔比</th><th className="p-3 md:p-4 text-right">新客締結率</th><th className="p-3 md:p-4 text-right">新客人數</th><th className="p-3 md:p-4 text-right">新客留單數</th><th className="p-3 md:p-4 text-right">新客平均業績</th><th className="p-3 md:p-4 text-right">舊客平均業績</th></tr></thead>
              <tbody className="text-sm">
                {therapistStats.rankings.filter(t => !(!isManagerial && t.id !== currentUser?.id)).map((t, idx) => {
                  // ★ 判斷是否為「我的團隊成員」(給予高光標示)
                  const isMyOwnTeam = myTeamStats && myTeamStats.isMyTeam(t.storeDisplay);
                  const rowClass = currentUser?.id === t.id 
                      ? "bg-indigo-50 border-indigo-100" 
                      : isMyOwnTeam 
                          ? "bg-amber-50/60 border-amber-100/50 hover:bg-amber-50/80" 
                          : "border-stone-50 hover:bg-stone-50";

                  return (
                    <tr key={t.id} className={`border-b transition-colors ${rowClass}`}>
                      <td className="p-3 md:p-4 text-center"><span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${t.rank <= 3 ? "bg-amber-100 text-amber-700 ring-4 ring-amber-50" : t.status === "DANGER" ? "bg-rose-100 text-rose-700 ring-4 ring-rose-50" : "bg-stone-100 text-stone-500"}`}>{t.rank}</span></td>
                      <td className="p-3 md:p-4 font-bold text-stone-700 flex flex-wrap items-center gap-2">
                        <span className={isMyOwnTeam ? "text-amber-900 font-extrabold" : ""}>{t.name}</span>
                        {currentUser?.id === t.id && <span className="px-2 py-0.5 bg-indigo-200 text-indigo-700 text-[10px] rounded-full">ME</span>}
                        {t.status === "DANGER" && <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-bold">加油</span>}
                      </td>
                      <td className="p-3 md:p-4">
                        <span className={`text-[11px] px-2 py-0.5 rounded font-medium border ${isMyOwnTeam ? "bg-amber-100/80 text-amber-700 border-amber-200/50" : "text-stone-500 bg-stone-100/80 border-stone-200/50"}`}>{t.storeDisplay}</span>
                      </td>
                      <td className={`p-3 md:p-4 text-right font-mono font-bold ${isMyOwnTeam ? "text-amber-600" : "text-indigo-600"}`}>{fmtMoney(t.totalRevenue)}</td>
                      <td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtMoney(t.newCustomerRevenue)}</td>
                      <td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtMoney(t.oldCustomerRevenue)}</td>
                      <td className="p-3 md:p-4 text-center font-mono text-xs text-stone-400">{t.revenueMix}</td>
                      <td className="p-3 md:p-4 text-right font-mono font-bold text-stone-700">{t.newClosingRate.toFixed(0)}%</td>
                      <td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(t.newCustomerCount)}</td>
                      <td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(t.newCustomerClosings)}</td>
                      <td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(Math.round(t.newAsp))}</td>
                      <td className="p-3 md:p-4 text-right font-mono text-stone-600">{fmtNum(Math.round(t.oldAsp))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="md:hidden py-2 text-center text-stone-400 text-xs flex justify-center items-center gap-1 bg-stone-50 rounded-b-xl"><ArrowLeft size={12}/> 左右滑動查看 <ArrowRight size={12}/></div>
        </div>
      </Card>
    </div>
  );
};

export default TherapistPerformanceView;