// src/components/StorePerformanceView.jsx
import React, { useContext, useEffect, useState } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Line, ComposedChart, Area } from "recharts";
import { AlertTriangle, Trophy, Medal, Star, Activity, Target, DollarSign, CreditCard, ShoppingBag, Users, TrendingUp, Sparkles, CheckSquare, Award, PieChart, Crown, Map as MapIcon, Flame, Info, X } from "lucide-react";
import { AppContext } from "../AppContext";
import { Card } from "./SharedUI";

const StorePerformanceView = ({ dashboardStats, myStoreRankings, brandInfo }) => {
  const { fmtMoney, fmtNum, targets, userRole } = useContext(AppContext);
  const [isProjectionDrawerMounted, setProjectionDrawerMounted] = useState(false);
  const [isProjectionDrawerClosing, setProjectionDrawerClosing] = useState(false);

  const openProjectionDrawer = () => {
    setProjectionDrawerClosing(false);
    setProjectionDrawerMounted(true);
  };

  const closeProjectionDrawer = () => {
    if (!isProjectionDrawerMounted || isProjectionDrawerClosing) return;
    setProjectionDrawerClosing(true);
    window.setTimeout(() => {
      setProjectionDrawerMounted(false);
      setProjectionDrawerClosing(false);
    }, 340);
  };

  useEffect(() => {
    if (!isProjectionDrawerMounted) return;

    const handleEscClose = (event) => {
      if (event.key === "Escape") {
        closeProjectionDrawer();
      }
    };

    window.addEventListener("keydown", handleEscClose);
    return () => window.removeEventListener("keydown", handleEscClose);
  }, [isProjectionDrawerMounted, isProjectionDrawerClosing]);

  if (!dashboardStats) return null;

  const { grandTotal: storeGrandTotal, dailyTotals, totalAchievement, daysPassed, daysInMonth } = dashboardStats;
  const timeProgress = daysInMonth > 0 ? (daysPassed / daysInMonth) * 100 : 0;
  const paceGap = totalAchievement - timeProgress;
  const isSmallStoreRanking = myStoreRankings.length > 0 && myStoreRankings.length <= 6;

  const getProgressStatusMeta = (store = {}) => {
    const target = Number(store.target || 0);
    const rate = Number(store.rate || 0);
    const expectedRate = Math.min(Math.max(Number(timeProgress || 0), 0), 100);
    const progressGap = rate - expectedRate;

    if (!target || target <= 0) {
      return {
        key: "missing-target",
        label: "目標缺漏",
        className: "bg-stone-100 text-stone-500 border-stone-200",
        barClassName: "bg-stone-300",
        textClassName: "text-stone-500",
      };
    }

    if (rate >= 100) {
      return {
        key: "achieved",
        label: "已達標",
        className: "bg-emerald-50 text-emerald-700 border-emerald-100",
        barClassName: "bg-emerald-400",
        textClassName: "text-emerald-600",
      };
    }

    if (progressGap >= 5) {
      return {
        key: "ahead",
        label: "超前進度",
        className: "bg-emerald-50 text-emerald-700 border-emerald-100",
        barClassName: "bg-emerald-400",
        textClassName: "text-emerald-600",
      };
    }

    if (progressGap >= -5) {
      return {
        key: "on-track",
        label: "符合進度",
        className: "bg-blue-50 text-blue-700 border-blue-100",
        barClassName: "bg-blue-400",
        textClassName: "text-blue-600",
      };
    }

    if (progressGap >= -15) {
      return {
        key: "behind",
        label: "落後進度",
        className: "bg-amber-50 text-amber-700 border-amber-100",
        barClassName: "bg-amber-400",
        textClassName: "text-amber-600",
      };
    }

    return {
      key: "attention",
      label: "需關注",
      className: "bg-rose-50 text-rose-700 border-rose-100",
      barClassName: "bg-rose-500",
      textClassName: "text-rose-600",
    };
  };

  const smallRankingSummary = {
    achievedCount: myStoreRankings.filter((store) => Number(store.rate || 0) >= 100).length,
    averageRate: myStoreRankings.length > 0
      ? myStoreRankings.reduce((sum, store) => sum + Number(store.rate || 0), 0) / myStoreRankings.length
      : 0,
    totalGap: myStoreRankings.reduce((sum, store) => {
      const actual = Number(store.actual || 0);
      const target = Number(store.target || 0);
      return sum + Math.max(0, target - actual);
    }, 0),
  };

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

  const projectionRange = storeGrandTotal.projectionRange || {};
  const projectionProfile = projectionRange.profile || null;
  const projectionWeightText = projectionProfile
    ? `${projectionProfile.label || "標準推估"}｜本月 ${Math.round((projectionProfile.currentWeight || 0) * 100)}% / 歷史節奏 ${Math.round((projectionProfile.historyWeight || 0) * 100)}%`
    : "依本月營運表現與歷史節奏推估";

  const formatProjectionValue = (value) => {
    const numeric = Number(value || 0);
    if (!numeric) return "尚無資料";
    return fmtMoney(numeric);
  };

  const ProjectionScenarioColumn = ({ title, value, desc, active = false, tone = "amber" }) => (
    <div className={`rounded-2xl border px-3.5 py-3 ${active ? (tone === "indigo" ? "border-indigo-100 bg-indigo-50/70" : "border-amber-100 bg-amber-50/70") : "border-stone-100 bg-white/90"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[11px] font-black ${active ? (tone === "indigo" ? "text-indigo-600" : "text-amber-700") : "text-stone-400"}`}>{title}</p>
        {active && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black text-stone-400">主畫面</span>}
      </div>
      <p className={`mt-1.5 whitespace-nowrap font-mono text-lg font-black tracking-tight ${active ? (tone === "indigo" ? "text-indigo-600" : "text-amber-700") : "text-stone-600"}`}>{formatProjectionValue(value)}</p>
      <p className="mt-1.5 text-[11px] font-bold leading-4 text-stone-400">{desc}</p>
    </div>
  );

  const ProjectionDrawerGroup = ({ title, type, tone = "amber", icon: Icon }) => {
    const range = projectionRange?.[type];
    const toneClasses = tone === "indigo"
      ? { icon: "bg-indigo-50 text-indigo-600 border-indigo-100", label: "text-indigo-600", dot: "bg-indigo-500" }
      : { icon: "bg-amber-50 text-amber-700 border-amber-100", label: "text-amber-700", dot: "bg-amber-500" };

    return (
      <section className="rounded-[1.45rem] border border-stone-100 bg-white/85 p-3.5 shadow-sm">
        <div className="mb-3 flex items-center gap-2.5">
          <div className={`flex h-9 w-9 items-center justify-center rounded-2xl border ${toneClasses.icon}`}>
            <Icon size={17} />
          </div>
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black tracking-widest text-stone-400">
              <span className={`h-1.5 w-1.5 rounded-full ${toneClasses.dot}`} />
              推估情境
            </div>
            <h4 className="mt-0.5 text-base font-black text-stone-700">{title}</h4>
          </div>
        </div>

        {range ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <ProjectionScenarioColumn title="偏穩" value={range.conservative} desc="後續維持穩定服務與成交時，月底較保守的可能落點。" tone={tone} />
            <ProjectionScenarioColumn title="主推估" value={range.standard} desc="目前主畫面採用的推估值，適合日常追蹤與會議判讀。" active tone={tone} />
            <ProjectionScenarioColumn title="衝刺" value={range.aggressive} desc="若活動、回購與成交動能拉升，月底可能觸及的上緣。" tone={tone} />
          </div>
        ) : (
          <div className="rounded-2xl border border-stone-100 bg-stone-50/70 px-4 py-5 text-center text-xs font-bold text-stone-400">
            目前資料量還不足以拆出更多情境，主畫面會先以主要推估金額作為營運參考。
          </div>
        )}
      </section>
    );
  };

  const ProjectionInfoDrawer = () => {
    if (!isProjectionDrawerMounted) return null;

    return (
      <div
        className={`fixed inset-0 z-[9999] flex justify-end bg-stone-900/20 backdrop-blur-[2px] ${isProjectionDrawerClosing ? "animate-out fade-out duration-300" : "animate-in fade-in duration-300"}`}
      >
        <button
          type="button"
          aria-label="關閉推估說明背景"
          onClick={closeProjectionDrawer}
          className="absolute inset-0 h-full w-full cursor-default"
        />

        <aside
          className={`relative z-10 flex h-full w-full max-w-[660px] flex-col overflow-hidden border-l border-stone-100 bg-[#FFFCF7] shadow-[-22px_0_70px_rgba(80,65,45,0.16)] ${isProjectionDrawerClosing ? "animate-out slide-out-to-right duration-300 ease-in" : "animate-in slide-in-from-right duration-300 ease-out"}`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-stone-100 bg-white/90 px-5 py-4 backdrop-blur">
            <div>
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-stone-100 bg-stone-50 px-2.5 py-1 text-[10px] font-black text-stone-500">
                <Info size={11} />
                月底推估說明
              </div>
              <h3 className="text-xl font-black text-stone-700">月底推估怎麼看？</h3>
              <p className="mt-1 max-w-xl text-[11px] font-bold leading-5 text-stone-400">
                主畫面保留最需要追蹤的推估數字；這裡補充現金與權責在不同營運情境下的可能落點，方便主管判斷後續衝刺空間。
              </p>
            </div>
            <button
              type="button"
              onClick={closeProjectionDrawer}
              className="rounded-2xl border border-stone-100 bg-white p-2 text-stone-400 transition-colors hover:bg-stone-50 hover:text-stone-600"
              aria-label="關閉推估說明"
            >
              <X size={17} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-3">
              <ProjectionDrawerGroup title="現金推估" type="cash" tone="amber" icon={DollarSign} />
              <ProjectionDrawerGroup title="權責推估" type="accrual" tone="indigo" icon={CreditCard} />
            </div>

            <div className="mt-4 rounded-[1.35rem] border border-stone-100 bg-white/90 px-4 py-3 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] font-black text-stone-500">目前推估口徑</p>
                <span className="w-fit rounded-full border border-stone-100 bg-stone-50 px-2.5 py-1 text-[10px] font-black text-stone-500">{projectionWeightText}</span>
              </div>
              <p className="mt-2 text-[11px] font-bold leading-5 text-stone-500">
                系統會參考本月已回報業績，也會納入過去相似營業日的表現節奏。越接近月底，推估會越貼近本月實際狀況；實際結果仍以月底結算為準。
              </p>
            </div>
          </div>
        </aside>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full min-w-0">
      <ProjectionInfoDrawer />
      

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
            <div className="mb-4 flex items-center justify-between gap-3 shrink-0">
              <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                <Target size={14} /> 月底推估
              </p>
              <button
                type="button"
                onClick={openProjectionDrawer}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-bold text-stone-500 transition-colors hover:bg-stone-50 hover:text-stone-700"
              >
                <Info size={12} />
                推估說明
              </button>
            </div>
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
        <div className="bg-white rounded-3xl border border-stone-200 shadow-xl overflow-hidden relative">
          <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-6 flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center text-white relative overflow-hidden">
            <div className="absolute right-0 top-0 p-4 opacity-10"><MapIcon size={100} /></div>
            <div className="relative z-10 flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md"><Crown size={24} className="text-white" /></div>
              <div>
                <h3 className="text-xl font-bold tracking-wide">{isSmallStoreRanking ? `${brandInfo?.name || "門市"} 達成進度` : "戰情排行分析"}</h3>
                <p className="text-amber-100 text-xs font-medium">{isSmallStoreRanking ? "Progress & Ranking Status" : "Rankings & Performance"}</p>
              </div>
            </div>
            <div className="relative z-10 grid grid-cols-3 gap-3 text-right sm:flex sm:items-center sm:gap-5">
              <div>
                <p className="text-[10px] text-amber-100 font-bold uppercase">目前顯示店家數</p>
                <p className="text-2xl font-mono font-bold text-white">{myStoreRankings.length}</p>
              </div>
              {isSmallStoreRanking && (
                <>
                  <div>
                    <p className="text-[10px] text-amber-100 font-bold uppercase">本月應達</p>
                    <p className="text-2xl font-mono font-bold text-white">{timeProgress.toFixed(0)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-amber-100 font-bold uppercase">已達標</p>
                    <p className="text-2xl font-mono font-bold text-white">{smallRankingSummary.achievedCount}/{myStoreRankings.length}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {isSmallStoreRanking ? (
            <div className="p-4 sm:p-6 bg-orange-50/20">
              <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] font-black uppercase text-stone-400">平均達成</p>
                  <p className="mt-1 font-mono text-xl font-black text-stone-700">{smallRankingSummary.averageRate.toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-stone-400">本月時間進度</p>
                  <p className="mt-1 font-mono text-xl font-black text-stone-700">{timeProgress.toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-stone-400">未達標總差距</p>
                  <p className={`mt-1 font-mono text-xl font-black ${smallRankingSummary.totalGap > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {smallRankingSummary.totalGap > 0 ? fmtMoney(smallRankingSummary.totalGap) : "全數達標"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {myStoreRankings.map((store) => {
                  const progressMeta = getProgressStatusMeta(store);
                  const gap = Number(store.actual || 0) - Number(store.target || 0);
                  const isOverTarget = gap >= 0;

                  return (
                    <div key={store.storeName} className="rounded-3xl border border-stone-100 bg-white p-4 shadow-sm transition-all hover:shadow-md">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black ${store.rank === 1 ? "bg-amber-100 text-amber-700" : store.rank === 2 ? "bg-stone-200 text-stone-600" : store.rank === 3 ? "bg-orange-100 text-orange-700" : "bg-stone-50 text-stone-400"}`}>
                            {store.rank}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="truncate text-base font-black text-stone-700">{store.storeName}</h4>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${progressMeta.className}`}>{progressMeta.label}</span>
                              {store.isBottom5 && (
                                <span className="rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">
                                  排名後段
                                </span>
                              )}
                              {store.passedChallenge && (
                                <span className="rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2 py-0.5 text-[10px] font-black text-white shadow-sm">
                                  突破挑戰
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-[11px] font-bold text-stone-400">全區排名 No.{store.rank} / {store.totalStores || myStoreRankings.length}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-mono text-2xl font-black ${progressMeta.textClassName}`}>
                            {Number(store.rate || 0).toFixed(0)}%
                          </p>
                        </div>
                      </div>

                      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-stone-100">
                        <div className={`h-full rounded-full ${progressMeta.barClassName}`} style={{ width: `${Math.min(Number(store.rate || 0), 100)}%` }} />
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-2xl bg-stone-50 px-3 py-2">
                          <p className="text-[10px] font-black text-stone-400">目前業績</p>
                          <p className="mt-1 font-mono font-black text-stone-700">{fmtMoney(store.actual)}</p>
                        </div>
                        <div className="rounded-2xl bg-stone-50 px-3 py-2">
                          <p className="text-[10px] font-black text-stone-400">目標金額</p>
                          <p className="mt-1 font-mono font-black text-stone-500">{fmtMoney(store.target)}</p>
                        </div>
                        <div className={`col-span-2 rounded-2xl px-3 py-2 ${isOverTarget ? "bg-emerald-50" : "bg-rose-50"}`}>
                          <div className="flex items-center justify-between gap-3">
                            <p className={`text-[10px] font-black ${isOverTarget ? "text-emerald-600" : "text-rose-600"}`}>{isOverTarget ? "超標金額" : "尚差金額"}</p>
                            <p className={`font-mono font-black ${isOverTarget ? "text-emerald-700" : "text-rose-700"}`}>{fmtMoney(Math.abs(gap))}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-0 sm:p-2 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[350px]">
                <thead>
                  <tr className="text-xs font-bold text-stone-400 border-b border-stone-100">
                    <th className="p-3 sm:p-4 w-16 sm:w-20 text-center">全區排名</th>
                    <th className="p-3 sm:p-4">門市名稱</th>
                    <th className="p-3 sm:p-4 text-right">目前業績</th>
                    <th className="p-3 sm:p-4 text-right hidden sm:table-cell">目標金額</th>
                    <th className="p-3 sm:p-4 text-right">達成率</th>
                  </tr>
                </thead>
                <tbody>
                  {myStoreRankings.map((store) => {
                    const progressMeta = getProgressStatusMeta(store);

                    return (
                      <tr key={store.storeName} className={`group transition-colors border-b last:border-0 border-stone-50 ${store.isBottom5 ? "bg-rose-50 hover:bg-rose-100" : "hover:bg-stone-50" }`}>
                        <td className="p-3 sm:p-4 text-center">
                          <span className={`inline-flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full text-xs font-bold ${store.rank === 1 ? "bg-amber-100 text-amber-700" : store.rank === 2 ? "bg-stone-200 text-stone-600" : store.rank === 3 ? "bg-orange-100 text-orange-700" : "bg-stone-50 text-stone-400"}`}>{store.rank}</span>
                        </td>
                        <td className="p-3 sm:p-4">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                            <span className={`font-bold text-sm sm:text-base ${store.isBottom5 ? "text-rose-700" : "text-stone-700"}`}>{store.storeName}</span>
                            <span className={`w-fit text-[10px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 ${progressMeta.className}`}>
                              {progressMeta.key === "attention" && <AlertTriangle size={10} />}
                              <span className="hidden sm:inline">{progressMeta.label}</span>
                            </span>
                            {store.isBottom5 && (
                              <span className="w-fit text-[10px] font-bold px-1.5 py-0.5 bg-rose-100 text-rose-600 rounded border border-rose-100 flex items-center gap-1">
                                <AlertTriangle size={10} /> <span className="hidden sm:inline">排名後段</span>
                              </span>
                            )}
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
                            <span className={`text-base sm:text-lg font-bold font-mono ${progressMeta.textClassName}`}>{store.rate.toFixed(0)}%</span>
                            <div className="w-16 sm:w-24 h-1 sm:h-1.5 bg-stone-100 rounded-full mt-1 overflow-hidden">
                              <div className={`h-full rounded-full ${progressMeta.barClassName}`} style={{ width: `${Math.min(store.rate, 100)}%` }}></div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StorePerformanceView;