// src/components/DashboardView.jsx
import React, { useContext, useMemo } from "react";

// 1. 引入圖表庫 (Recharts)
import {
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Line, ComposedChart, Area
} from "recharts";

// 2. 引入所有圖示 (Lucide Icons)
import {
  TrendingUp, DollarSign, Target, Users, Award, Loader2,
  CheckSquare, Activity, Sparkles, ShoppingBag, CreditCard,
  FileWarning, Trophy, Medal, AlertTriangle, Crown, Map
} from "lucide-react";

// 3. 引入共用元件與工具
import { ViewWrapper, Card } from "./SharedUI";
import { formatNumber } from "../utils/helpers";
// 4. 引入 Context
import { AppContext } from "../AppContext";

const DashboardView = () => {
  const { analytics, fmtMoney, fmtNum, targets, userRole, currentUser, allReports, budgets, managers, selectedYear, selectedMonth } = useContext(AppContext);

  // --- 通用排名計算邏輯 (支援 店長 & 區長) ---
  const myRankings = useMemo(() => {
    if ((userRole !== 'store' && userRole !== 'manager') || !allReports) return [];

    // 1. 計算「全區」所有店家的當月業績
    const storeStats = {};
    allReports.forEach(report => {
      const rDate = new Date(report.date);
      if (rDate.getFullYear() !== parseInt(selectedYear) || (rDate.getMonth() + 1) !== parseInt(selectedMonth)) {
        return;
      }
      const sName = report.storeName;
      if (!storeStats[sName]) storeStats[sName] = 0;
      storeStats[sName] += (Number(report.cash) || 0);
    });

    // 2. 轉換為陣列並計算達成率
    const rankingList = Object.keys(storeStats).map(storeName => {
      const budgetKey = `${storeName}_${selectedYear}_${parseInt(selectedMonth)}`;
      const budgetData = budgets[budgetKey];
      const target = budgetData ? Number(budgetData.cashTarget || 0) : 0;
      const actual = storeStats[storeName];
      const rate = target > 0 ? (actual / target) * 100 : 0;

      return { storeName, actual, target, rate };
    });

    // 3. 全區排序 (高 -> 低)
    rankingList.sort((a, b) => b.rate - a.rate);

    // 4. 標記名次與是否為後段班
    const fullRankedList = rankingList.map((item, index) => ({
      ...item,
      rank: index + 1,
      totalStores: rankingList.length,
      isBottom5: (index + 1) > (rankingList.length - 5)
    }));

    // 5. 根據角色篩選「我管理的店家」
    let myManagedStores = [];
    if (userRole === 'store' && currentUser) {
      myManagedStores = currentUser.stores || [currentUser.storeName];
    } else if (userRole === 'manager' && managers) {
      // 區長：從 managers 物件中取出該區長名下的所有店
      myManagedStores = Object.values(managers).flat().map(s => `CYJ${s}店`);
    }

    // 6. 過濾結果
    const myResults = fullRankedList.filter(item => 
      myManagedStores.some(myStore => {
         const cleanMy = myStore.replace("CYJ","").replace("店","");
         const cleanItem = item.storeName.replace("CYJ","").replace("店","");
         return cleanItem === cleanMy;
      })
    );

    return myResults;

  }, [userRole, allReports, currentUser, managers, budgets, selectedYear, selectedMonth]);


  // 防護機制
  if (!analytics || !analytics.grandTotal) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-stone-300" />
        <span className="ml-3 text-stone-400 font-bold">數據載入中...</span>
      </div>
    );
  }

  const { grandTotal, dailyTotals, totalAchievement, yearlyStats } = analytics;
  
  const timeProgress =
    analytics.daysInMonth > 0
      ? (analytics.daysPassed / analytics.daysInMonth) * 100
      : 0;
  const paceGap = totalAchievement - timeProgress;

  const MiniKpiCard = ({ title, value, subText, icon: Icon, color }) => (
    <div className="bg-white p-5 rounded-3xl border border-stone-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
      <div className={`absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity ${color}`}>
        <Icon size={64} />
      </div>
      <div className="flex flex-col h-full justify-between relative z-10">
        <div>
          <p className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
          <h3 className="text-2xl font-extrabold text-stone-700 font-mono tracking-tight">{value}</h3>
        </div>
        {subText && <div className="mt-3 pt-3 border-t border-stone-50 text-xs font-medium text-stone-500 flex items-center gap-1">{subText}</div>}
      </div>
    </div>
  );

  return (
    <ViewWrapper>
      <div className="space-y-8 pb-10">
        
        {/* =====================================================================================
            1. 店經理視圖 (Store View) - 維持原本的卡片式設計
           ===================================================================================== */}
        {userRole === 'store' && myRankings.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-4 duration-500">
            {myRankings.map((storeRank) => (
              <div 
                key={storeRank.storeName} 
                className={`rounded-3xl p-6 text-white shadow-xl relative overflow-hidden transition-all
                  ${storeRank.isBottom5 
                    ? "bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-200" 
                    : "bg-gradient-to-br from-amber-400 to-orange-600 shadow-amber-200"
                  }
                `}
              >
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  {storeRank.isBottom5 ? <AlertTriangle size={120} /> : <Trophy size={120} />}
                </div>
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
                      {storeRank.isBottom5 ? <Activity size={20} className="text-white" /> : <Medal size={20} className="text-yellow-100" />}
                    </div>
                    <h3 className="font-bold text-lg tracking-wider opacity-90">{storeRank.storeName}</h3>
                    {storeRank.isBottom5 && (
                      <span className="ml-auto bg-white/20 px-2 py-1 rounded text-xs font-bold flex items-center gap-1">需加強</span>
                    )}
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
                      <p className="text-white/80 text-xs font-bold uppercase mb-1">目標達成率</p>
                      <p className="text-3xl font-mono font-bold text-white">{storeRank.rate.toFixed(1)}%</p>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/20 flex justify-between text-xs font-medium text-white/90">
                    <span>目前業績: {fmtMoney(storeRank.actual)}</span>
                    <span>目標: {fmtMoney(storeRank.target)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* =====================================================================================
            2. 區長視圖 (Manager View) - RWD 優化版
           ===================================================================================== */}
        {userRole === 'manager' && myRankings.length > 0 && (
          <div className="animate-in slide-in-from-top-4 duration-500">
            <div className="bg-white rounded-3xl border border-stone-200 shadow-xl overflow-hidden relative">
              {/* 頂部標題列 */}
              <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-6 flex justify-between items-center text-white relative overflow-hidden">
                <div className="absolute right-0 top-0 p-4 opacity-10"><Map size={100} /></div>
                <div className="relative z-10 flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
                    <Crown size={24} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold tracking-wide">區域門市戰情排行</h3>
                    <p className="text-amber-100 text-xs font-medium">Rankings & Performance</p>
                  </div>
                </div>
                <div className="relative z-10 text-right">
                  <p className="text-xs text-amber-100 font-bold uppercase">管理店家數</p>
                  <p className="text-2xl font-mono font-bold text-white">{myRankings.length}</p>
                </div>
              </div>

              {/* 列表內容 - 加入 overflow-x-auto 支援橫向捲動 */}
              <div className="p-0 sm:p-2 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[350px]">
                  <thead>
                    <tr className="text-xs font-bold text-stone-400 border-b border-stone-100">
                      {/* RWD 優化：縮小手機版 padding */}
                      <th className="p-3 sm:p-4 w-16 sm:w-20 text-center">排名</th>
                      <th className="p-3 sm:p-4">門市名稱</th>
                      <th className="p-3 sm:p-4 text-right">目前業績</th>
                      {/* RWD 優化：手機版隱藏「目標金額」欄位 */}
                      <th className="p-3 sm:p-4 text-right hidden sm:table-cell">目標金額</th>
                      <th className="p-3 sm:p-4 text-right">達成率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myRankings.map((store, idx) => (
                      <tr 
                        key={store.storeName} 
                        className={`group transition-colors border-b last:border-0 border-stone-50
                          ${store.isBottom5 
                            ? "bg-rose-50 hover:bg-rose-100" 
                            : "hover:bg-stone-50" 
                          }
                        `}
                      >
                        {/* 排名 */}
                        <td className="p-3 sm:p-4 text-center">
                          <span className={`inline-flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full text-xs font-bold
                            ${idx === 0 ? "bg-amber-100 text-amber-700" : 
                              idx === 1 ? "bg-stone-200 text-stone-600" : 
                              idx === 2 ? "bg-orange-100 text-orange-700" : 
                              "bg-stone-50 text-stone-400"}
                          `}>
                            {store.rank}
                          </span>
                        </td>

                        {/* 店名 */}
                        <td className="p-3 sm:p-4">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                            <span className={`font-bold text-sm sm:text-base ${store.isBottom5 ? "text-rose-700" : "text-stone-700"}`}>
                              {store.storeName}
                            </span>
                            {store.isBottom5 && (
                              <span className="w-fit text-[10px] font-bold px-1.5 py-0.5 bg-rose-200 text-rose-700 rounded flex items-center gap-1 animate-pulse">
                                <AlertTriangle size={10} /> <span className="hidden sm:inline">需關注</span>
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 業績 */}
                        <td className="p-3 sm:p-4 text-right font-mono font-medium text-stone-600 text-sm sm:text-base">
                          {fmtMoney(store.actual)}
                        </td>

                        {/* 目標 (手機版隱藏) */}
                        <td className="p-3 sm:p-4 text-right font-mono text-stone-400 text-sm hidden sm:table-cell">
                          {fmtMoney(store.target)}
                        </td>

                        {/* 達成率 */}
                        <td className="p-3 sm:p-4 text-right">
                          <div className="flex flex-col items-end">
                            <span className={`text-base sm:text-lg font-bold font-mono ${store.isBottom5 ? "text-rose-600" : (store.rate >= 100 ? "text-emerald-500" : "text-amber-500")}`}>
                              {store.rate.toFixed(1)}%
                            </span>
                            {/* 進度條 */}
                            <div className="w-16 sm:w-24 h-1 sm:h-1.5 bg-stone-100 rounded-full mt-1 overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${store.isBottom5 ? "bg-rose-500" : (store.rate >= 100 ? "bg-emerald-400" : "bg-amber-400")}`}
                                style={{ width: `${Math.min(store.rate, 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 月度監控區塊 (Day X) - 維持不變 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-3xl p-6 md:p-8 border border-stone-100 shadow-xl shadow-stone-200/50 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-60"></div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 relative z-10">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 bg-indigo-50 rounded-lg">
                    <Activity size={16} className="text-indigo-500" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-widest text-stone-400">
                    營運節奏監控
                  </span>
                </div>
                <h2 className="text-3xl md:text-4xl font-extrabold font-mono tracking-tight text-stone-700">
                  Day {analytics.daysPassed}{" "}
                  <span className="text-lg text-stone-300 font-sans">
                    / {analytics.daysInMonth}
                  </span>
                </h2>
              </div>
              <div
                className={`mt-4 md:mt-0 px-4 py-2 rounded-xl flex items-center gap-2 ${
                  paceGap >= 0
                    ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                    : "bg-rose-50 text-rose-600 border border-rose-100"
                }`}
              >
                <span className="text-sm font-bold">
                  {paceGap >= 0 ? "超前進度" : "落後進度"}
                </span>
                <span className="text-xl font-mono font-bold">
                  {Math.abs(paceGap).toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="space-y-6 relative z-10">
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-stone-500">實際達成率</span>
                  <span
                    className={
                      totalAchievement >= timeProgress
                        ? "text-emerald-500"
                        : "text-rose-500"
                    }
                  >
                    {totalAchievement.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-stone-100 h-3 rounded-full overflow-hidden shadow-inner">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      totalAchievement >= 100
                        ? "bg-gradient-to-r from-emerald-400 to-teal-400"
                        : totalAchievement >= timeProgress
                        ? "bg-emerald-400"
                        : "bg-rose-400"
                    }`}
                    style={{ width: `${Math.min(totalAchievement, 100)}%` }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-medium">
                  <span className="text-stone-400">時間進度 (應達)</span>
                  <span className="text-stone-400">
                    {timeProgress.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-stone-50 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-stone-300 rounded-full"
                    style={{ width: `${Math.min(timeProgress, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-3xl p-6 border border-stone-100 shadow-lg shadow-stone-100 flex flex-col justify-center relative overflow-hidden group">
            <div className="relative z-10">
              <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
                <Target size={14} /> 月底現金推估
              </p>
              <h3 className="text-3xl xl:text-4xl font-extrabold text-stone-700 font-mono mb-4">
                {fmtMoney(grandTotal.projection)}
              </h3>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold">
                <span>預估達成</span>
                <span>
                  {grandTotal.budget > 0
                    ? (
                        (grandTotal.projection / grandTotal.budget) *
                        100
                      ).toFixed(1)
                    : 0}
                  %
                </span>
              </div>
              <div className="mt-4 pt-4 border-t border-stone-50">
                <div className="flex justify-between items-center text-xs text-stone-400">
                  <span>本月目標</span>
                  <span className="font-mono font-bold text-stone-500">
                    {fmtMoney(grandTotal.budget)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 財務績效區塊 */}
        <div>
          <h3 className="text-lg font-bold text-stone-700 mb-4 flex items-center gap-2 pl-1">
            <div className="w-1 h-6 bg-amber-500 rounded-full"></div>財務績效
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MiniKpiCard
              title="總現金業績"
              value={fmtMoney(grandTotal.cash)}
              icon={DollarSign}
              color="text-amber-500"
              subText={
                <span
                  className={`font-bold ${
                    totalAchievement >= 100
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}
                >
                  {totalAchievement.toFixed(1)}% 目標達成率
                </span>
              }
            />
            <MiniKpiCard
              title="總權責業績"
              value={fmtMoney(grandTotal.accrual)}
              icon={CreditCard}
              color="text-cyan-500"
              subText="含技術操作與產品銷售"
            />
            <MiniKpiCard
              title="總保養品業績"
              value={fmtMoney(grandTotal.skincareSales)}
              icon={ShoppingBag}
              color="text-rose-500"
              subText={
                <>
                  佔權責{" "}
                  <span className="font-bold text-stone-700 ml-1">
                    {grandTotal.accrual > 0
                      ? (
                          (grandTotal.skincareSales / grandTotal.accrual) *
                          100
                        ).toFixed(1)
                      : 0}
                    %
                  </span>
                </>
              }
            />
            <MiniKpiCard
              title="總退費金額"
              value={fmtMoney(grandTotal.refund)}
              icon={FileWarning}
              color="text-rose-600"
              subText={
                <>
                  佔現金{" "}
                  <span className="font-bold text-stone-700 ml-1">
                    {grandTotal.cash > 0
                      ? ((grandTotal.refund / grandTotal.cash) * 100).toFixed(1)
                      : 0}
                    %
                  </span>
                </>
              }
            />
          </div>
        </div>

        {/* 營運效率區塊 */}
        <div>
          <h3 className="text-lg font-bold text-stone-700 mb-4 flex items-center gap-2 pl-1">
            <div className="w-1 h-6 bg-cyan-500 rounded-full"></div>
            營運效率與客流
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <MiniKpiCard
              title="課程操作人數"
              value={fmtNum(grandTotal.traffic)}
              icon={Users}
              color="text-blue-500"
              subText="本月累計操作人數"
            />
            <MiniKpiCard
              title="平均操作權責"
              value={fmtMoney(analytics.avgTrafficASP)}
              icon={TrendingUp}
              color="text-indigo-500"
              subText={
                <span
                  className={
                    analytics.avgTrafficASP >= targets.trafficASP
                      ? "text-emerald-500 font-bold"
                      : "text-rose-500 font-bold"
                  }
                >
                  {analytics.avgTrafficASP >= targets.trafficASP
                    ? "達標"
                    : "未達標"}{" "}
                  (目標 {fmtNum(targets.trafficASP)})
                </span>
              }
            />
            <MiniKpiCard
              title="總新客數"
              value={fmtNum(grandTotal.newCustomers)}
              icon={Sparkles}
              color="text-purple-500"
              subText="本月新增體驗人數"
            />
            <MiniKpiCard
              title="總新客留單"
              value={fmtNum(grandTotal.newCustomerClosings)}
              icon={CheckSquare}
              color="text-teal-500"
              subText={
                <span>
                  留單率{" "}
                  <span className="font-bold">
                    {grandTotal.newCustomers > 0
                      ? (
                          (grandTotal.newCustomerClosings /
                            grandTotal.newCustomers) *
                          100
                        ).toFixed(0)
                      : 0}
                    %
                  </span>
                </span>
              }
            />
            <MiniKpiCard
              title="新客平均客單"
              value={fmtMoney(analytics.avgNewCustomerASP)}
              icon={Award}
              color="text-fuchsia-500"
              subText={
                <span
                  className={
                    analytics.avgNewCustomerASP >= targets.newASP
                      ? "text-emerald-500 font-bold"
                      : "text-rose-500 font-bold"
                  }
                >
                  {analytics.avgNewCustomerASP >= targets.newASP
                    ? "達標"
                    : "未達標"}{" "}
                  (目標 {fmtNum(targets.newASP)})
                </span>
              }
            />
          </div>
        </div>

        {/* 圖表區塊 */}
        <Card
          title="全品牌日營運走勢"
          subtitle="現金業績 vs 課程操作人數趨勢分析"
        >
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={dailyTotals}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#f5f5f4"
                />
                <XAxis
                  dataKey="date"
                  stroke="#a8a29e"
                  tick={{ fontSize: 12 }}
                  dy={10}
                />
                <YAxis
                  yAxisId="left"
                  stroke="#a8a29e"
                  tick={{ fontSize: 12 }}
                  width={60}
                  tickFormatter={(val) =>
                    val === 0 ? "0" : `$${(val / 1000).toFixed(0)}k`
                  }
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#a8a29e"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(val) => fmtNum(val)}
                />
                <RechartsTooltip
                  contentStyle={{
                    borderRadius: "16px",
                    border: "none",
                    padding: "12px",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                  cursor={{ fill: "#fafaf9" }}
                  formatter={(value, name) => {
                    if (name === "現金業績") return [fmtMoney(value), name];
                    return [fmtNum(value), name];
                  }}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="cash"
                  name="現金業績"
                  stroke="#f59e0b"
                  fill="#f59e0b"
                  fillOpacity={0.2}
                  strokeWidth={3}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="traffic"
                  name="課程操作人數"
                  stroke="#0ea5e9"
                  strokeWidth={3}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </ViewWrapper>
  );
};

export default DashboardView;