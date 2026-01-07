// src/components/DashboardView.jsx
import React, { useContext } from "react";

// 1. 引入圖表庫 (Recharts)
import {
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Line, ComposedChart, Area
} from "recharts";

// 2. 引入所有圖示 (Lucide Icons)
import {
  TrendingUp, DollarSign, Target, Users, Award, Loader2,
  CheckSquare, Activity, Sparkles, ShoppingBag, CreditCard,
  FileWarning
} from "lucide-react";

// 3. 引入共用元件與工具
import { ViewWrapper, Card } from "./SharedUI";
import { formatNumber } from "../utils/helpers";
// 4. 引入 Context
import { AppContext } from "../AppContext";

const DashboardView = () => {
  const { analytics, fmtMoney, fmtNum, targets, selectedYear } = useContext(AppContext);

  // 防護機制：避免資料載入前白畫面
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
      <div
        className={`absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity ${color}`}
      >
        <Icon size={64} />
      </div>
      <div className="flex flex-col h-full justify-between relative z-10">
        <div>
          <p className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-1">
            {title}
          </p>
          <h3 className="text-2xl font-extrabold text-stone-700 font-mono tracking-tight">
            {value}
          </h3>
        </div>
        {subText && (
          <div className="mt-3 pt-3 border-t border-stone-50 text-xs font-medium text-stone-500 flex items-center gap-1">
            {subText}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <ViewWrapper>
      <div className="space-y-8 pb-10">
        {/* 月度監控區塊 (Day X) */}
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