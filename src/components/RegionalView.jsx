import React, { useMemo, useContext } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";

const RegionalView = () => {
  const { analytics, fmtMoney, fmtNum, userRole } = useContext(AppContext);

  const pieData = useMemo(
    () =>
      analytics.regionalStats
        .map((r) => ({ name: r.manager, value: r.cashTotal }))
        .filter((i) => i.value > 0),
    [analytics.regionalStats]
  );

  const COLORS = [
    "#0088FE",
    "#00C49F",
    "#FFBB28",
    "#FF8042",
    "#8884d8",
    "#82ca9d",
  ];

  return (
    <ViewWrapper>
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {analytics.regionalStats.map((region) => (
            <Card
              key={region.manager}
              className="hover:shadow-lg transition-shadow duration-300 border-l-4 border-l-stone-200"
            >
              <div className="flex justify-between items-start mb-6 border-b border-stone-50 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center font-bold text-stone-500 text-lg">
                    {region.manager.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-stone-700">
                      {region.manager} 區
                    </h3>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`px-3 py-1 rounded-lg text-sm font-bold mb-1 inline-block ${
                      region.achievement >= 100
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-50 text-amber-600"
                    }`}
                  >
                    {region.achievement.toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center">
                  <span className="text-stone-500 text-sm">現金總業績</span>
                  <span className="text-lg font-bold text-stone-700">
                    {fmtMoney(region.cashTotal)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-stone-500 text-sm">權責總業績</span>
                  <span className="text-base font-bold text-stone-600">
                    {fmtMoney(region.accrualTotal)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-stone-500 text-sm">保養品業績</span>
                  <span className="text-base font-bold text-rose-500">
                    {fmtMoney(region.skincareSalesTotal)}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 py-4 border-t border-stone-100 bg-stone-50/50 -mx-6 px-6">
                <div className="text-center">
                  <p className="text-[10px] text-stone-400 font-bold uppercase mb-1">
                    課程操作人數
                  </p>
                  <p className="text-stone-700 font-bold">
                    {fmtNum(region.trafficTotal)}
                  </p>
                </div>
                <div className="text-center border-l border-stone-200">
                  <p className="text-[10px] text-stone-400 font-bold uppercase mb-1">
                    新客數
                  </p>
                  <p className="text-stone-700 font-bold">
                    {fmtNum(region.newCustomersTotal)}
                  </p>
                </div>
                <div className="text-center border-l border-stone-200">
                  <p className="text-[10px] text-stone-400 font-bold uppercase mb-1">
                    留單數
                  </p>
                  <p className="text-stone-700 font-bold">
                    {fmtNum(region.newCustomerClosingsTotal)}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
        {userRole === "director" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-bottom-4 duration-500">
            <Card title="各區現金業績貢獻佔比" subtitle="區長業績分佈分析">
              <div className="h-[350px] w-full flex justify-center items-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={true}
                      label={({ name, percent }) =>
                        `${name} ${(percent * 100).toFixed(0)}%`
                      }
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(value) => fmtMoney(value)} />
                    <Legend verticalAlign="bottom" height={36} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        ) : (
          <div className="space-y-6">
            {analytics.regionalStats.map((region) => {
              const regionStores = analytics.storeList.filter(
                (s) => s.manager === region.manager
              );
              return (
                <div
                  key={region.manager}
                  className="bg-white rounded-3xl border border-stone-100 overflow-hidden shadow-sm mb-6"
                >
                  <div className="bg-stone-50/80 px-6 py-4 border-b border-stone-100 flex justify-between items-center">
                    <h3 className="font-bold text-stone-700">
                      {region.manager} 區分店列表
                    </h3>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {regionStores.map((store) => (
                      <div
                        key={store.name}
                        className="bg-white border border-stone-100 rounded-2xl p-5 hover:shadow-lg transition-all"
                      >
                        <div className="flex justify-between items-start mb-4">
                          <h4 className="font-bold text-stone-700">
                            {store.name.replace("CYJ", "").replace("店", "")}
                          </h4>
                          <span className="text-sm font-bold text-emerald-600">
                            {store.achievement.toFixed(1)}%
                          </span>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-stone-400">現金</span>
                            <span className="font-bold">
                              {fmtMoney(store.cashTotal)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-stone-400">權責</span>
                            <span className="font-bold">
                              {fmtMoney(store.accrualTotal)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ViewWrapper>
  );
};

export default RegionalView;