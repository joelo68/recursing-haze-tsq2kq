// src/components/StorePerformanceView.jsx
import React, { useContext } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Line, ComposedChart, Area } from "recharts";
import { AlertTriangle, Trophy, Medal, Star, Activity, Target, DollarSign, CreditCard, ShoppingBag, Users, TrendingUp, Sparkles, CheckSquare, Award, PieChart, Crown, Map as MapIcon, Flame } from "lucide-react";
import { AppContext } from "../AppContext";
import { Card } from "./SharedUI";
import DailyTelegramTrigger from "./DailyTelegramTrigger"; // ★ 引入隱形推播觸發器

const StorePerformanceView = ({ dashboardStats, myStoreRankings, brandInfo }) => {
  const { fmtMoney, fmtNum, targets, userRole } = useContext(AppContext);

  if (!dashboardStats) return null;

  const { grandTotal: storeGrandTotal, dailyTotals, totalAchievement, daysPassed, daysInMonth } = dashboardStats;
  const timeProgress = daysInMonth > 0 ? (daysPassed / daysInMonth) * 100 : 0;
  const paceGap = totalAchievement - timeProgress;

  const MiniKpiCard = ({ title, value, subText, icon: Icon, color }) => (
    <div className="bg-white p-5 rounded-3xl border border-stone-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden h-full flex flex-col">
      <div className={`absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity ${color}`}><Icon size={64} /></div>
      <div className="flex flex-col h-full justify-between relative z-10">
        <div>
           <p className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
           <h3 className="text-2xl font-extrabold text-stone-700 font-mono tracking-tight">{value}</h3>
        </div>
        {subText && <div className="mt-3 pt-3 border-t border-stone-50 text-xs font-medium text-stone-500 flex flex-col gap-1">{subText}</div>}
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full min-w-0">
      
      {/* ★ 裝上隱形推播觸發器 (沒有畫面，只會在背景判定時間與發送) */}
      <DailyTelegramTrigger />

      {/* 我的店家戰情卡 (僅店經理顯示) */}
      {userRole === 'store' && myStoreRankings.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{myStoreRankings.map((storeRank) => ( 
          <div key={storeRank.storeName} className={`rounded-3xl p-6 text-white shadow-xl relative overflow-hidden transition-all ${storeRank.isBottom5 ? "bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-200" : "bg-gradient-to-br from-amber-400 to-orange-600 shadow-amber-200"}`}>
            <div className="absolute top-0 right-0 p-4 opacity-10">{storeRank.isBottom5 ? <AlertTriangle size={120} /> : <Trophy size={120} />}</div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4">
                <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">{storeRank.isBottom5 ? <Activity size={20} className="text-white" /> : <Medal size={20} className="text-yellow-100" />}</div>
                <h3 className="font-bold text-lg tracking-wider opacity-90">{storeRank.storeName}</h3>
                {storeRank.passedChallenge && (
                  <span className="bg-gradient-to-r from-yellow-300 to-amber-500 text-amber-900 px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 shadow-sm ml-1 animate-pulse">
                    <Star size={12} className="fill-current" /> 突破挑戰
                  </span>
                )}
                {storeRank.isBottom5 && <span className="ml-auto bg-white/20 px-2 py-1 rounded text-xs font-bold flex items-center gap-1">需加強</span>}
              </div>
              <div className="flex items-end gap-4 mb-2">
                <div>
                  <p className="text-white/80 text-xs font-bold uppercase mb-1">全區排名</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-extrabold font-mono text-white tracking-tighter">No.{storeRank.rank}</span>
                    <span className="text-white/60 font-bold text-sm">/ {storeRank.totalStores}</span>
                  </div>
                </div>
                <div className="flex-1 text-right">
                  <p className="text-white/80 text-xs font-bold uppercase mb-1">預算目標達成率</p>
                  <p className="text-3xl font-mono font-bold text-white">{storeRank.rate.toFixed(0)}%</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-white/20 flex flex-col gap-1 text-xs font-medium text-white/90">
                <div className="flex justify-between">
                   <span>目前業績: {fmtMoney(storeRank.actual)}</span>
                   <span>預算目標: {fmtMoney(storeRank.target)}</span>
                 </div>
                {storeRank.hasChallenge && (
                   <div className="flex justify-between text-yellow-200 mt-1 pt-1 border-t border-white/10">
                     <span>挑戰目標達成率: {storeRank.challengeRate.toFixed(0)}%</span>
                     <span>挑戰目標: {fmtMoney(storeRank.challengeTarget)}</span>
                   </div>
                )}
              </div>
            </div>
          </div> 
        ))}</div>
      )}
      
      {/* 營運節奏監控 與 全新月底推估 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-3xl p-6 md:p-8 border border-stone-100 shadow-xl shadow-stone-200/50 relative overflow-hidden group flex flex-col h-full">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-60"></div>
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 relative z-10 shrink-0">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 bg-indigo-50 rounded-lg"><Activity size={16} className="text-indigo-500" /></div>
                <span className="text-xs font-bold uppercase tracking-widest text-stone-400">營運節奏監控</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold font-mono tracking-tight text-stone-700">Day {daysPassed} <span className="text-lg text-stone-300 font-sans">/ {daysInMonth}</span></h2>
            </div>
            <div className={`mt-4 md:mt-0 px-4 py-2 rounded-xl flex items-center gap-2 ${paceGap >= 0 ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-rose-50 text-rose-600 border border-rose-100"}`}>
              <span className="text-sm font-bold">{paceGap >= 0 ? "超前預算" : "落後預算"}</span>
              <span className="text-xl font-mono font-bold">{Math.abs(paceGap).toFixed(0)}%</span>
            </div>
          </div>
          
          <div className="flex-1 flex flex-col relative z-10">
            <div className="flex-1 flex flex-col justify-center gap-8 pb-8">
              <div className="space-y-3">
                <div className="flex justify-between text-sm md:text-base font-bold">
                  <span className="text-stone-500">實際達成率 (預算)</span>
                  <span className={totalAchievement >= timeProgress ? "text-emerald-500" : "text-rose-500"}>{totalAchievement.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-stone-100 h-3.5 md:h-4 rounded-full overflow-hidden shadow-inner">
                  <div className={`h-full rounded-full transition-all duration-1000 ${totalAchievement >= 100 ? "bg-gradient-to-r from-emerald-400 to-teal-400" : totalAchievement >= timeProgress ? "bg-emerald-400" : "bg-rose-400"}`} style={{ width: `${Math.min(totalAchievement, 100)}%` }} />
                </div>
              </div>
              
              {storeGrandTotal.hasChallengeCash && (
                 <div className="space-y-3">
                   <div className="flex justify-between text-sm md:text-base font-bold">
                     <span className="text-amber-600 flex items-center gap-1"><Star size={14} className="fill-amber-500"/> 挑戰目標達成率 (加碼)</span>
                     <span className={dashboardStats.challengeAchievement >= 100 ? "text-amber-500 drop-shadow-sm" : "text-amber-600/70"}>
                       {dashboardStats.challengeAchievement.toFixed(0)}%
                     </span>
                   </div>
                   <div className="w-full bg-amber-50 h-3 md:h-3.5 rounded-full overflow-hidden border border-amber-100">
                     <div 
                       className={`h-full rounded-full transition-all duration-1000 ${dashboardStats.challengeAchievement >= 100 ? "bg-gradient-to-r from-amber-400 to-yellow-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]" : "bg-amber-300"}`} 
                       style={{ width: `${Math.min(dashboardStats.challengeAchievement, 100)}%` }} 
                     />
                   </div>
                 </div>
              )}
            </div>

            <div className="space-y-2 pt-4 md:pt-5 border-t border-stone-100 mt-auto shrink-0">
              <div className="flex justify-between text-xs md:text-sm font-medium">
                <span className="text-stone-400">時間進度 (應達)</span>
                <span className="text-stone-400">{timeProgress.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-stone-50 h-2 rounded-full overflow-hidden">
                <div className="h-full bg-stone-300 rounded-full" style={{ width: `${Math.min(timeProgress, 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 border border-stone-100 shadow-lg shadow-stone-100 flex flex-col relative overflow-hidden group h-full">
          <div className="relative z-10 flex flex-col h-full">
            <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-1 shrink-0">
              <Target size={14} /> 月底推估
            </p>
            <div className="flex flex-col gap-5 flex-1 justify-center">
              <div className="bg-stone-50/50 rounded-2xl p-4 border border-stone-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-stone-500 text-xs font-bold flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>現金推估
                  </div>
                </div>
                <h3 className="text-3xl font-extrabold text-stone-700 font-mono tracking-tight mb-3">
                  {fmtMoney(storeGrandTotal.projection)}
                </h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md text-[11px] font-bold border border-emerald-100">
                    <span>{storeGrandTotal.hasChallengeCash ? '預算達成' : '預估達成'}</span>
                    <span>{storeGrandTotal.budget > 0 ? ((storeGrandTotal.projection / storeGrandTotal.budget) * 100).toFixed(0) : 0}%</span>
                  </div>
                  {storeGrandTotal.hasChallengeCash && (
                    <div className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 rounded-md text-[11px] font-bold border border-amber-100 shadow-sm">
                      <Star size={10} className="fill-amber-500 text-amber-500" />
                      <span>挑戰達成</span>
                      <span>{storeGrandTotal.challengeBudget > 0 ? ((storeGrandTotal.projection / storeGrandTotal.challengeBudget) * 100).toFixed(0) : 0}%</span>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 pt-3 border-t border-stone-200/60">
                  <div className="flex justify-between items-center text-[11px]">
                     <span className="text-stone-400">預算目標</span>
                     <span className="font-mono font-bold text-stone-500">{fmtMoney(storeGrandTotal.budget)}</span>
                  </div>
                  {storeGrandTotal.hasChallengeCash && (
                     <div className="flex justify-between items-center text-[11px]">
                       <span className="text-amber-600/80">挑戰目標</span>
                       <span className="font-mono font-bold text-amber-600">{fmtMoney(storeGrandTotal.challengeBudget)}</span>
                     </div>
                  )}
                </div>
              </div>

              <div className="bg-stone-50/50 rounded-2xl p-4 border border-stone-100">
                 <div className="flex items-center justify-between mb-2">
                  <div className="text-stone-500 text-xs font-bold flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>權責推估
                  </div>
                </div>
                <h3 className="text-3xl font-extrabold text-stone-700 font-mono tracking-tight mb-3">
                  {fmtMoney(storeGrandTotal.accrualProjection)}
                </h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md text-[11px] font-bold border border-emerald-100">
                    <span>{storeGrandTotal.hasChallengeAccrual ? '預算達成' : '預估達成'}</span>
                    <span>{storeGrandTotal.accrualBudget > 0 ? ((storeGrandTotal.accrualProjection / storeGrandTotal.accrualBudget) * 100).toFixed(0) : 0}%</span>
                  </div>
                  {storeGrandTotal.hasChallengeAccrual && (
                    <div className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 rounded-md text-[11px] font-bold border border-amber-100 shadow-sm">
                      <Star size={10} className="fill-amber-500 text-amber-500" />
                      <span>挑戰達成</span>
                      <span>{storeGrandTotal.challengeAccrualBudget > 0 ? ((storeGrandTotal.accrualProjection / storeGrandTotal.challengeAccrualBudget) * 100).toFixed(0) : 0}%</span>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 pt-3 border-t border-stone-200/60">
                  <div className="flex justify-between items-center text-[11px]">
                     <span className="text-stone-400">預算目標</span>
                     <span className="font-mono font-bold text-stone-500">{fmtMoney(storeGrandTotal.accrualBudget)}</span>
                  </div>
                  {storeGrandTotal.hasChallengeAccrual && (
                     <div className="flex justify-between items-center text-[11px]">
                       <span className="text-amber-600/80">挑戰目標</span>
                       <span className="font-mono font-bold text-amber-600">{fmtMoney(storeGrandTotal.challengeAccrualBudget)}</span>
                     </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* 財務與營運卡片 */}
      <div><h3 className="text-lg font-bold text-stone-700 mb-4 flex items-center gap-2 pl-1"><div className="w-1 h-6 bg-amber-500 rounded-full"></div>財務績效</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MiniKpiCard title="總現金業績" value={fmtMoney(storeGrandTotal.cash)} icon={DollarSign} color="text-amber-500" 
            subText={
              <div className="flex flex-col gap-1 w-full">
                <div className="flex items-center justify-between"><span className={`font-bold ${totalAchievement >= 100 ? "text-emerald-600" : "text-stone-500"}`}>預算目標達成率</span><span className={`font-bold ${totalAchievement >= 100 ? "text-emerald-600" : "text-stone-500"}`}>{totalAchievement.toFixed(0)}%</span></div>
                {storeGrandTotal.hasChallengeCash && (
                   <div className="flex items-center justify-between border-t border-stone-100 pt-1">
                     <span className={`font-bold text-[11px] ${dashboardStats.challengeAchievement >= 100 ? "text-amber-600" : "text-amber-600/60"}`}><Star size={10} className="inline mb-0.5"/> 挑戰目標達成率</span>
                     <span className={`font-bold text-[11px] ${dashboardStats.challengeAchievement >= 100 ? "text-amber-600" : "text-amber-600/60"}`}>{dashboardStats.challengeAchievement.toFixed(0)}%</span>
                   </div>
                )}
              </div>
            } 
          />
          <MiniKpiCard title="總權責業績" value={fmtMoney(storeGrandTotal.accrual)} icon={CreditCard} color="text-cyan-500" 
            subText={
              <div className="flex flex-col gap-1 w-full">
                <div className="flex items-center justify-between"><span className={`font-bold ${dashboardStats.totalAccrualAchievement >= 100 ? "text-emerald-600" : "text-stone-500"}`}>預算目標達成率</span><span className={`font-bold ${dashboardStats.totalAccrualAchievement >= 100 ? "text-emerald-600" : "text-stone-500"}`}>{dashboardStats.totalAccrualAchievement.toFixed(0)}%</span></div>
                {storeGrandTotal.hasChallengeAccrual && (
                   <div className="flex items-center justify-between border-t border-stone-100 pt-1">
                     <span className={`font-bold text-[11px] ${dashboardStats.challengeAccrualAchievement >= 100 ? "text-amber-600" : "text-amber-600/60"}`}><Star size={10} className="inline mb-0.5"/> 挑戰目標達成率</span>
                     <span className={`font-bold text-[11px] ${dashboardStats.challengeAccrualAchievement >= 100 ? "text-amber-600" : "text-amber-600/60"}`}>{dashboardStats.challengeAccrualAchievement.toFixed(0)}%</span>
                   </div>
                )}
              </div>
            } 
          />
          <MiniKpiCard title="總保養品業績" value={fmtMoney(storeGrandTotal.skincareSales)} icon={ShoppingBag} color="text-rose-500" 
            subText={
              <div className="flex items-center gap-3 w-full">
                 <span>佔現金 <span className="font-bold text-stone-700 ml-1">{storeGrandTotal.cash > 0 ? ((storeGrandTotal.skincareSales / storeGrandTotal.cash) * 100).toFixed(0) : 0}%</span></span>
                 <span className="w-px h-3 bg-stone-300"></span>
                 <span>佔權責 <span className="font-bold text-stone-700 ml-1">{storeGrandTotal.accrual > 0 ? ((storeGrandTotal.skincareSales / storeGrandTotal.accrual) * 100).toFixed(0) : 0}%</span></span>
              </div>
            } 
          />
        </div>
      </div>
      
      {/* 營運效率與客流 */}
      <div>
         <h3 className="text-lg font-bold text-stone-700 mb-4 flex items-center gap-2 pl-1"><div className="w-1 h-6 bg-cyan-500 rounded-full"></div>營運效率與客流</h3>
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
           <MiniKpiCard title="課程操作人數" value={fmtNum(storeGrandTotal.traffic)} icon={Users} color="text-blue-500" subText="本月累計操作人數" />
           <MiniKpiCard title="平均操作權責" value={fmtMoney(dashboardStats.avgTrafficASP)} icon={TrendingUp} color="text-indigo-500" subText={<span className={dashboardStats.avgTrafficASP >= targets.trafficASP ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>{dashboardStats.avgTrafficASP >= targets.trafficASP ? "達標" : "未達標"} (目標 {fmtNum(targets.trafficASP)})</span>} />
           <MiniKpiCard title="總新客數" value={fmtNum(storeGrandTotal.newCustomers)} icon={Sparkles} color="text-purple-500" subText="本月新增體驗人數" />
           <MiniKpiCard title="總新客留單" value={fmtNum(storeGrandTotal.newCustomerClosings)} icon={CheckSquare} color="text-teal-500" subText={<span>留單率 <span className="font-bold">{storeGrandTotal.newCustomers > 0 ? ((storeGrandTotal.newCustomerClosings / storeGrandTotal.newCustomers) * 100).toFixed(0) : 0}%</span></span>} />
           <MiniKpiCard 
             title="新客平均客單" 
             value={fmtMoney(dashboardStats.avgNewCustomerASP)} 
             icon={Award} 
             color="text-fuchsia-500" 
             subText={
               <div className="flex items-center justify-between w-full">
                 <span className={dashboardStats.avgNewCustomerASP >= targets.newASP ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>
                   {dashboardStats.avgNewCustomerASP >= targets.newASP ? "達標" : "未達標"} (目標 {fmtNum(targets.newASP)})
                 </span>
                 <span className="text-[10px] text-stone-400 font-mono flex items-center gap-0.5">
                   總業績 <span className="text-stone-500 font-bold">{fmtMoney(storeGrandTotal.newCustomerSales)}</span>
                 </span>
               </div>
             } 
           />
           <MiniKpiCard title="新 / 舊客 結構比" value={`${dashboardStats.newCountMix}% / ${dashboardStats.oldCountMix}%`} icon={PieChart} color="text-pink-500" subText={<span className="flex items-center gap-1 text-stone-500">業績比 <span className="font-bold text-stone-700">{dashboardStats.newRevMix}% / {dashboardStats.oldRevMix}%</span></span>} />
         </div>
      </div>

      {/* ============================================================================== */}
      {/* ★ 全區門市實時戰報 (加入「戰鬥挑釁風」小方塊)                                       */}
      {/* ============================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5 mb-2 mt-4">
        
        {/* 1. 本月全區門市 Top 3 */}
        <div className="bg-white rounded-3xl border border-stone-100 shadow-sm hover:shadow-md transition-all relative overflow-hidden flex flex-col h-full group">
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-10 transition-opacity text-amber-500 pointer-events-none"><Trophy size={80} /></div>
          <div className="p-5 flex flex-col h-full relative z-10">
            <p className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-5 flex items-center gap-1.5">
              <Trophy size={14} className="text-amber-400"/> 本月全區 TOP 3
            </p>
            <div className="flex flex-col gap-4 flex-1 justify-center">
              {dashboardStats.storeMonthlyTop3?.length > 0 ? dashboardStats.storeMonthlyTop3.map((s, i) => (
                <div key={s.name} className="flex justify-between items-center w-full group/item">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-bold ${i===0 ? 'bg-amber-50 text-amber-500' : i===1 ? 'bg-stone-50 text-stone-400' : 'bg-orange-50 text-orange-400'}`}>
                      {i+1}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-stone-600 group-hover/item:text-stone-800 transition-colors">{s.name}</span>
                      {s.streak && (
                        <span className="text-[9px] font-bold bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded shadow-sm border border-stone-200 tracking-wider">
                          {s.badgeText}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="font-mono font-bold text-stone-600 tracking-tight">{fmtMoney(s.revenue)}</span>
                </div>
              )) : <div className="text-xs font-medium text-stone-300 text-center py-6">本月尚無紀錄</div>}
            </div>
          </div>
        </div>

        {/* 2. 昨日全區門市 Top 3 */}
        <div className="bg-white rounded-3xl border border-stone-100 shadow-sm hover:shadow-md transition-all relative overflow-hidden flex flex-col h-full group">
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-10 transition-opacity text-orange-500 pointer-events-none"><Crown size={80} /></div>
          <div className="p-5 flex flex-col h-full relative z-10">
            <p className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-5 flex items-center gap-1.5">
              <Crown size={14} className="text-orange-400"/> 昨日全區 TOP 3
            </p>
            <div className="flex flex-col gap-4 flex-1 justify-center">
              {dashboardStats.storeYesterdayTop3?.length > 0 ? dashboardStats.storeYesterdayTop3.map((s, i) => (
                <div key={s.name} className="flex justify-between items-center w-full group/item">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-bold ${i===0 ? 'bg-orange-50 text-orange-500' : i===1 ? 'bg-stone-50 text-stone-400' : 'bg-amber-50/60 text-amber-600/70'}`}>
                      {i+1}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-stone-600 group-hover/item:text-stone-800 transition-colors">{s.name}</span>
                      {s.streak && (
                        <span className="text-[9px] font-bold bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded shadow-sm border border-stone-200 tracking-wider">
                          {s.badgeText}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="font-mono font-bold text-stone-600 tracking-tight">{fmtMoney(s.revenue)}</span>
                </div>
              )) : <div className="text-xs font-medium text-stone-300 text-center py-6">昨日尚無紀錄</div>}
            </div>
          </div>
        </div>

        {/* 3. 今日全區門市 Top 3 */}
        <div className="bg-white rounded-3xl border border-stone-100 shadow-sm hover:shadow-md transition-all relative overflow-hidden flex flex-col h-full group">
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-10 transition-opacity text-rose-500 pointer-events-none"><Flame size={80} /></div>
          <div className="p-5 flex flex-col h-full relative z-10">
            <p className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-5 flex items-center gap-1.5">
              <Flame size={14} className="text-rose-400"/> 今日全區 TOP 3
              <span className="relative flex h-1.5 w-1.5 ml-1">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-300 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-400"></span>
              </span>
            </p>
            <div className="flex flex-col gap-4 flex-1 justify-center">
              {dashboardStats.storeTodayTop3?.length > 0 ? dashboardStats.storeTodayTop3.map((s, i) => (
                <div key={s.name} className="flex justify-between items-center w-full group/item">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-bold ${i===0 ? 'bg-rose-50 text-rose-500' : i===1 ? 'bg-stone-50 text-stone-400' : 'bg-rose-50/50 text-rose-400'}`}>
                      {i+1}
                    </span>
                    <span className="text-sm font-bold text-stone-600 group-hover/item:text-stone-800 transition-colors">{s.name}</span>
                  </div>
                  <span className="font-mono font-bold text-stone-600 tracking-tight">{fmtMoney(s.revenue)}</span>
                </div>
              )) : <div className="text-xs font-medium text-stone-300 text-center py-6">今日尚未開單</div>}
            </div>
          </div>
        </div>

      </div>
      
      {/* 走勢圖 */}
      <Card title={`${brandInfo.name} 日營運走勢`} subtitle="現金業績 vs 課程操作人數趨勢分析"><div className="h-[300px] w-full"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={dailyTotals} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" /><XAxis dataKey="date" stroke="#a8a29e" tick={{ fontSize: 12 }} dy={10} /><YAxis yAxisId="left" stroke="#a8a29e" tick={{ fontSize: 12 }} width={60} tickFormatter={(val) => val === 0 ? "0" : `$${(val / 1000).toFixed(0)}k`} /><YAxis yAxisId="right" orientation="right" stroke="#a8a29e" tick={{ fontSize: 12 }} tickFormatter={(val) => fmtNum(val)} /><RechartsTooltip contentStyle={{ borderRadius: "16px", border: "none", padding: "12px", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)", }} cursor={{ fill: "#fafaf9" }} formatter={(value, name) => { if (name === "現金業績") return [fmtMoney(value), name]; return [fmtNum(value), name]; }} /><Area yAxisId="left" type="monotone" dataKey="cash" name="現金業績" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} strokeWidth={3} /><Line yAxisId="right" type="monotone" dataKey="traffic" name="課程操作人數" stroke="#0ea5e9" strokeWidth={3} /></ComposedChart></ResponsiveContainer></div></Card>

      {/* 戰情排行分析 */}
      {(userRole === 'manager' || userRole === 'director' || userRole === 'store') && myStoreRankings.length > 0 && (
        <div className="bg-white rounded-3xl border border-stone-200 shadow-xl overflow-hidden relative"><div className="bg-gradient-to-r from-amber-500 to-orange-600 p-6 flex justify-between items-center text-white relative overflow-hidden"><div className="absolute right-0 top-0 p-4 opacity-10"><MapIcon size={100} /></div><div className="relative z-10 flex items-center gap-3"><div className="p-2 bg-white/20 rounded-xl backdrop-blur-md"><Crown size={24} className="text-white" /></div><div><h3 className="text-xl font-bold tracking-wide">戰情排行分析</h3><p className="text-amber-100 text-xs font-medium">Rankings & Performance</p></div></div><div className="relative z-10 text-right"><p className="text-xs text-amber-100 font-bold uppercase">目前顯示店家數</p><p className="text-2xl font-mono font-bold text-white">{myStoreRankings.length}</p></div></div><div className="p-0 sm:p-2 overflow-x-auto"><table className="w-full text-left border-collapse min-w-[350px]"><thead><tr className="text-xs font-bold text-stone-400 border-b border-stone-100"><th className="p-3 sm:p-4 w-16 sm:w-20 text-center">全區排名</th><th className="p-3 sm:p-4">門市名稱</th><th className="p-3 sm:p-4 text-right">目前業績</th><th className="p-3 sm:p-4 text-right hidden sm:table-cell">目標金額</th><th className="p-3 sm:p-4 text-right">達成率</th></tr></thead><tbody>{myStoreRankings.map((store) => (<tr key={store.storeName} className={`group transition-colors border-b last:border-0 border-stone-50 ${store.isBottom5 ? "bg-rose-50 hover:bg-rose-100" : "hover:bg-stone-50" }`}>
          <td className="p-3 sm:p-4 text-center"><span className={`inline-flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full text-xs font-bold ${store.rank === 1 ? "bg-amber-100 text-amber-700" : store.rank === 2 ? "bg-stone-200 text-stone-600" : store.rank === 3 ? "bg-orange-100 text-orange-700" : "bg-stone-50 text-stone-400"}`}>{store.rank}</span></td>
          <td className="p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <span className={`font-bold text-sm sm:text-base ${store.isBottom5 ? "text-rose-700" : "text-stone-700"}`}>{store.storeName}</span>
              {store.isBottom5 && (<span className="w-fit text-[10px] font-bold px-1.5 py-0.5 bg-rose-200 text-rose-700 rounded flex items-center gap-1 animate-pulse"><AlertTriangle size={10} /> <span className="hidden sm:inline">需關注</span></span>)}
              {store.passedChallenge && (
                <span className="w-fit text-[10px] font-bold px-1.5 py-0.5 bg-gradient-to-r from-amber-400 to-orange-500 text-white rounded flex items-center gap-1 shadow-sm">
                  <Star size={10} className="fill-current" /> <span className="hidden sm:inline">突破挑戰</span>
                </span>
              )}
            </div>
          </td>
          <td className="p-3 sm:p-4 text-right font-mono font-medium text-stone-600 text-sm sm:text-base">{fmtMoney(store.actual)}</td>
          <td className="p-3 sm:p-4 text-right font-mono text-stone-400 text-sm hidden sm:table-cell">
             {fmtMoney(store.target)}
             {store.hasChallenge && (
               <div className="text-[10px] text-amber-500 mt-0.5 flex items-center justify-end gap-0.5">
                 <Star size={8} className="fill-amber-500"/> {fmtMoney(store.challengeTarget)}
               </div>
             )}
          </td>
          <td className="p-3 sm:p-4 text-right">
            <div className="flex flex-col items-end">
              <span className={`text-base sm:text-lg font-bold font-mono ${store.isBottom5 ? "text-rose-600" : (store.rate >= 100 ? "text-emerald-500" : "text-stone-600")}`}>{store.rate.toFixed(0)}%</span>
              <div className="w-16 sm:w-24 h-1 sm:h-1.5 bg-stone-100 rounded-full mt-1 overflow-hidden"><div className={`h-full rounded-full ${store.isBottom5 ? "bg-rose-500" : (store.rate >= 100 ? "bg-emerald-400" : "bg-stone-400")}`} style={{ width: `${Math.min(store.rate, 100)}%` }}></div></div>
            </div>
          </td>
        </tr>))}</tbody></table></div></div>
      )}
    </div>
  );
};

export default StorePerformanceView;