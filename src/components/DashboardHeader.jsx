// src/components/DashboardHeader.jsx
import React, { useContext, useEffect } from "react";
import { Store as StoreIcon, User, CheckCircle2, AlertTriangle, Clock3, Database, Radio } from "lucide-react";
import { AppContext } from "../AppContext";

const DashboardHeader = ({
  brandInfo, dailyLoginCount, yesterdayLoginCount, dashboardSummaryStatus, viewMode, setViewMode,
  selectedDashboardManager, setSelectedDashboardManager,
  selectedDashboardStore, setSelectedDashboardStore,
  groupedStoresForFilter, availableStoresForDropdown
}) => {
  const { userRole, therapistModuleEnabled } = useContext(AppContext);
  const isTherapistModuleEnabled = therapistModuleEnabled !== false;

  useEffect(() => {
    if (!isTherapistModuleEnabled && viewMode === "therapist") {
      setViewMode("store");
    }
  }, [isTherapistModuleEnabled, viewMode, setViewMode]);


  const summaryStatus = dashboardSummaryStatus || {};
  const statusKey = summaryStatus.statusKey || "unknown";
  const dataSourceMode = summaryStatus.dataSourceMode || "unknown";
  const isUsingSummary = dataSourceMode === "verified_summary";
  const isLive = dataSourceMode === "live" || statusKey === "current";
  const isLoading = statusKey === "loading" || summaryStatus.ready === false;
  const isWarning = !isLive && !isUsingSummary && !isLoading;

  const statusTheme = isLive
    ? {
        wrap: "border-emerald-100 bg-emerald-50/70 text-emerald-700",
        icon: Radio,
        dot: "bg-emerald-400",
        label: "本月即時明細",
      }
    : isUsingSummary
    ? {
        wrap: "border-emerald-100 bg-emerald-50/70 text-emerald-700",
        icon: CheckCircle2,
        dot: "bg-emerald-400",
        label: "已整理 Summary",
      }
    : isLoading
    ? {
        wrap: "border-stone-100 bg-stone-50 text-stone-500",
        icon: Clock3,
        dot: "bg-stone-300",
        label: "資料來源檢查中",
      }
    : {
        wrap: "border-amber-100 bg-amber-50/80 text-amber-700",
        icon: AlertTriangle,
        dot: "bg-amber-400",
        label: "明細暫代顯示",
      };

  const StatusIcon = statusTheme.icon;
  const formatStatusTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  const statusTime = isUsingSummary
    ? formatStatusTime(summaryStatus.lastCompareAtText || summaryStatus.lastUpdatedAtText)
    : "";

  return (
    <div className="bg-white p-4 md:p-5 rounded-3xl border border-stone-200 shadow-sm animate-in fade-in slide-in-from-top-2 mb-6">
      <div className="flex flex-col xl:flex-row justify-between gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 md:gap-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-8 rounded-full ${brandInfo.id.toLowerCase().includes('anniu') ? 'bg-teal-500' : brandInfo.id.toLowerCase().includes('yibo') ? 'bg-purple-500' : 'bg-amber-500'}`}></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl md:text-2xl font-extrabold text-stone-800 tracking-tight">{brandInfo.name} 營運總覽</h1>
                {(userRole === 'director' || userRole === 'trainer' || userRole === 'manager') && (
                  <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-1 sm:py-1.5 bg-stone-50 border border-stone-200 rounded-lg sm:rounded-xl shadow-sm">
                    <div className="flex items-center gap-1.5" title="今日系統登入次數">
                      <div className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </div>
                      <span className="text-[10px] font-bold text-stone-500 tracking-widest">今日</span>
                      <span className="text-sm font-mono font-black text-stone-700">{dailyLoginCount || 0}</span>
                    </div>
                    <div className="w-px h-3 sm:h-4 bg-stone-200"></div>
                    <div className="flex items-center gap-1.5" title="昨日系統登入次數">
                      <div className="h-2 w-2 rounded-full bg-stone-300"></div>
                      <span className="text-[10px] font-bold text-stone-400 tracking-widest">昨日</span>
                      <span className="text-sm font-mono font-bold text-stone-500">{yesterdayLoginCount || 0}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-[11px] md:text-xs text-stone-400 font-bold tracking-wider uppercase">Dashboard</p>
                <div
                  title={summaryStatus.statusHint || "Dashboard 資料來源狀態"}
                  className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${statusTheme.wrap}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusTheme.dot}`} />
                  <StatusIcon size={11} strokeWidth={2.2} />
                  <span className="whitespace-nowrap">{statusTheme.label}</span>
                  {summaryStatus.yearMonth && !isLive && (
                    <span className="hidden text-[10px] font-bold opacity-70 sm:inline">{summaryStatus.yearMonth}</span>
                  )}
                  {statusTime && (
                    <span className="hidden text-[10px] font-bold opacity-70 md:inline">{statusTime}</span>
                  )}
                  {isWarning && summaryStatus.pendingCount > 0 && (
                    <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[9px] font-black opacity-80">待整理 {summaryStatus.pendingCount}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {userRole !== 'therapist' && userRole !== 'trainer' && isTherapistModuleEnabled && (
            <>
              <div className="hidden sm:block w-px h-10 bg-stone-100"></div>
              <div className="bg-stone-100/80 p-1 rounded-2xl flex shadow-inner w-fit border border-stone-200/50">
                 <button onClick={() => setViewMode('store')} className={`px-4 md:px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all duration-200 ${viewMode === 'store' ? 'bg-white text-stone-800 shadow-sm ring-1 ring-stone-200/50' : 'text-stone-500 hover:text-stone-700 hover:bg-stone-200/50'}`}><StoreIcon size={16}/> 門市營運</button>
                 <button onClick={() => setViewMode('therapist')} className={`px-4 md:px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all duration-200 ${viewMode === 'therapist' ? 'bg-white text-stone-800 shadow-sm ring-1 ring-stone-200/50' : 'text-stone-500 hover:text-stone-700 hover:bg-stone-200/50'}`}><User size={16}/> 人員績效</button>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap xl:flex-nowrap items-center gap-2 md:gap-3">
          {(userRole === 'director' || userRole === 'trainer' || userRole === 'manager') && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {(userRole === 'director' || userRole === 'trainer') && (
                <select
                    value={selectedDashboardManager}
                    onChange={(e) => {
                        setSelectedDashboardManager(e.target.value);
                        setSelectedDashboardStore(""); 
                    }}
                    className="flex-1 sm:flex-none px-4 py-2.5 border border-stone-200 rounded-xl text-sm font-bold text-stone-600 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 bg-stone-50 hover:bg-white transition-all cursor-pointer min-w-[120px]"
                >
                    <option value="">全品牌</option>
                    {Object.keys(groupedStoresForFilter).map(m => (
                        <option key={m} value={m}>{m}區</option>
                    ))}
                </select>
              )}
              
              <select
                  value={selectedDashboardStore}
                  onChange={(e) => setSelectedDashboardStore(e.target.value)}
                  className="flex-1 sm:flex-none px-4 py-2.5 border border-stone-200 rounded-xl text-sm font-bold text-stone-600 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 bg-stone-50 hover:bg-white transition-all cursor-pointer min-w-[140px]"
              >
                  <option value="" className="font-bold text-stone-800">
                      {selectedDashboardManager || userRole === 'manager' ? "全區店家" : "顯示全區"}
                  </option>
                  
                  {(!selectedDashboardManager && userRole !== 'manager') ? (
                      Object.entries(groupedStoresForFilter).map(([mgrName, stores]) => (
                          <optgroup key={mgrName} label={`${mgrName} 區`} className="font-bold text-stone-400 bg-stone-50">
                              {stores.map(s => (
                                  <option key={s} value={s} className="font-medium text-stone-700 bg-white">{s}</option>
                              ))}
                          </optgroup>
                      ))
                  ) : (
                      availableStoresForDropdown.map(s => (
                          <option key={s} value={s} className="font-medium text-stone-700 bg-white">{s}</option>
                      ))
                  )}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardHeader;