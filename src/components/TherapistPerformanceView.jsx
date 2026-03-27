// src/components/TherapistPerformanceView.jsx
import React, { useContext } from "react";
import { Flame, Crown, AlertTriangle, Zap, Frown, DollarSign, Sparkles, TrendingUp, Activity, FileWarning, Download, ArrowLeft, ArrowRight, Store } from "lucide-react";
import { AppContext } from "../AppContext";
import { Card } from "./SharedUI";

const TherapistPerformanceView = ({ therapistStats, brandInfo }) => {
  const { fmtMoney, fmtNum, userRole, currentUser } = useContext(AppContext);

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
      {therapistStats.myStats && (() => {
        const info = getMotivationalMessage(therapistStats.myStats);
        const status = therapistStats.myStats.status;
        let bgClass = "bg-gradient-to-br from-indigo-600 to-purple-700"; 
        let shadowClass = "shadow-indigo-200";
        if (status === "TOP") { bgClass = "bg-gradient-to-br from-amber-400 to-orange-500"; shadowClass = "shadow-amber-200"; } 
        else if (status === "DANGER") { bgClass = "bg-gradient-to-br from-rose-600 to-red-700"; shadowClass = "shadow-rose-200"; }
        return ( <div className={`${bgClass} rounded-3xl p-6 text-white shadow-xl ${shadowClass} relative overflow-hidden transition-all duration-500`}> <div className="absolute top-0 right-0 p-4 opacity-10"><info.icon size={140} /></div> <div className="relative z-10 flex flex-col md:flex-row justify-between items-end gap-6"> <div> <div className="flex items-center gap-3 mb-2"><span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm flex items-center gap-1">{status === 'DANGER' && <Flame size={12} className="animate-pulse"/>}No.{therapistStats.myStats.rank}</span><span className="text-white/80 font-bold tracking-wider text-sm">{therapistStats.myStats.storeDisplay}</span></div><h2 className="text-3xl md:text-4xl font-extrabold mb-1">{therapistStats.myStats.name}</h2><div className="mt-2 p-3 bg-black/10 rounded-xl backdrop-blur-md border border-white/10 max-w-md"><p className="font-bold text-sm flex items-center gap-2">{status === 'DANGER' && <Frown size={16}/>}{info.title}</p><p className="text-xs text-white/70 mt-1">{info.sub}</p></div> </div> <div className="flex gap-6 text-right"> <div><p className="text-xs text-white/60 font-bold uppercase mb-1">個人總業績</p><p className="text-3xl font-mono font-bold">{fmtMoney(therapistStats.myStats.totalRevenue)}</p></div> <div><p className="text-xs text-white/60 font-bold uppercase mb-1">新客締結率</p><p className="text-3xl font-mono font-bold">{therapistStats.myStats.newClosingRate.toFixed(0)}%</p></div> </div> </div> </div> );
      })()}
      
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