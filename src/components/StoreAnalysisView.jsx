import React, { useState, useEffect, useMemo, useContext } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer
} from "recharts";

// --- 路徑修正 ---
import { AppContext } from "../AppContext";
import { toStandardDateFormat, formatNumber } from "../utils/helpers";
import { ViewWrapper, Card } from "./SharedUI";

const StoreAnalysisView = () => {
  const {
    rawData,
    budgets,
    managers,
    selectedYear,
    selectedMonth,
    fmtMoney,
    fmtNum,
    currentUser,
    userRole,
    activeView,
  } = useContext(AppContext);

  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");

  useEffect(() => {
    if (
      activeView === "store-analysis" &&
      currentUser &&
      managers[currentUser.name]
    )
      setSelectedManager(currentUser.name);
  }, [activeView, currentUser, managers]);

  useEffect(() => {
    const handleStoreNav = (e) => setSelectedStore(e.detail);
    window.addEventListener("navigate-to-store", handleStoreNav);
    return () =>
      window.removeEventListener("navigate-to-store", handleStoreNav);
  }, []);

  const availableStores = useMemo(() => {
    if (userRole === "director")
      return selectedManager
        ? (managers[selectedManager] || []).map((s) => `CYJ${s}店`)
        : [];
    if (userRole === "manager")
      return Object.values(managers)
        .flat()
        .map((s) => `CYJ${s}店`);
    if (userRole === "store" && currentUser)
      return (currentUser.stores || [currentUser.storeName]).map((s) =>
        s.startsWith("CYJ") ? s : `CYJ${s}店`
      );
    return [];
  }, [selectedManager, managers, currentUser, userRole]);

  useEffect(() => {
    if (currentUser && availableStores.length === 1 && !selectedStore)
      setSelectedStore(availableStores[0]);
  }, [currentUser, availableStores, selectedStore]);

  const storeMetrics = useMemo(() => {
    if (!selectedStore) return null;
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;

    const data = rawData
      .filter((d) => {
        if (d.storeName !== selectedStore) return false;
        if (!d.date) return false;
        const parts = d.date.replace(/-/g, "/").split("/");
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        return (y === targetYear || y === rocYear) && m === monthInt;
      })
      .sort((a, b) => {
        const dateA = toStandardDateFormat(a.date);
        const dateB = toStandardDateFormat(b.date);
        return dateA.localeCompare(dateB);
      });

    const grossCash = data.reduce((a, b) => a + (b.cash || 0), 0);
    const totalRefund = data.reduce((a, b) => a + (b.refund || 0), 0);
    const totalCash = grossCash - totalRefund;
    const totalTraffic = data.reduce((a, b) => a + (b.traffic || 0), 0);
    const totalOpAccrual = data.reduce(
      (a, b) => a + (b.operationalAccrual || 0),
      0
    );
    const totalNewCustomers = data.reduce(
      (a, b) => a + (b.newCustomers || 0),
      0
    );
    const totalNewCustomerSales = data.reduce(
      (a, b) => a + (b.newCustomerSales || 0),
      0
    );
    const totalNewCustomerClosings = data.reduce(
      (a, b) => a + (b.newCustomerClosings || 0),
      0
    );

    const budget =
      budgets[`${selectedStore}_${targetYear}_${monthInt}`]?.cashTarget || 0;

    return {
      totalCash,
      achievement: budget > 0 ? (totalCash / budget) * 100 : 0,
      trafficASP:
        totalTraffic > 0 ? Math.round(totalOpAccrual / totalTraffic) : 0,
      newCustomerASP:
        totalNewCustomers > 0
          ? Math.round(totalNewCustomerSales / totalNewCustomers)
          : 0,
      totalNewCustomerClosings,
      totalRefund,
      dailyData: data.map((d) => ({
        date: toStandardDateFormat(d.date).split("/")[2],
        cash: (d.cash || 0) - (d.refund || 0),
        accrual: d.accrual || 0,
        traffic: d.traffic,
      })),
      budget,
    };
  }, [selectedStore, selectedYear, selectedMonth, rawData, budgets]);

  return (
    <ViewWrapper>
      <div className="space-y-6">
        <Card title="單店營運分析">
          <div className="flex gap-4">
            <select
              value={selectedManager}
              onChange={(e) => setSelectedManager(e.target.value)}
              disabled={userRole !== "director"}
              className="px-4 py-2 border rounded-xl"
            >
              <option value="">選擇區長</option>
              {Object.keys(managers).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
              className="px-4 py-2 border rounded-xl"
            >
              <option value="">選擇店家</option>
              {availableStores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </Card>
        {selectedStore && storeMetrics && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  現金業績
                </p>
                <h3 className="text-2xl font-bold text-stone-700">
                  {fmtMoney(storeMetrics.totalCash)}
                </h3>
                <p
                  className={`text-sm font-bold ${
                    storeMetrics.achievement >= 100
                      ? "text-emerald-500"
                      : "text-amber-500"
                  }`}
                >
                  {storeMetrics.achievement.toFixed(1)}% 達成
                </p>
              </div>
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  平均消耗客單
                </p>
                <h3 className="text-2xl font-bold text-stone-700">
                  {fmtMoney(storeMetrics.trafficASP)}
                </h3>
              </div>
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  本月目標
                </p>
                <h3 className="text-2xl font-bold text-stone-700">
                  {fmtMoney(storeMetrics.budget)}
                </h3>
              </div>
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  新客平均客單
                </p>
                <h3 className="text-2xl font-bold text-stone-700">
                  {fmtMoney(storeMetrics.newCustomerASP)}
                </h3>
              </div>
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  總新客留單
                </p>
                <h3 className="text-2xl font-bold text-stone-700">
                  {fmtNum(storeMetrics.totalNewCustomerClosings)}
                </h3>
              </div>
              <div className="bg-white p-5 rounded-2xl border shadow-sm">
                <p className="text-stone-400 text-xs font-bold mb-1">
                  總退費金額
                </p>
                <h3 className="text-2xl font-bold text-rose-500">
                  {fmtMoney(storeMetrics.totalRefund)}
                </h3>
              </div>
            </div>

            <Card
              title="綜合營運趨勢分析"
              subtitle="長條：現金業績｜實線：權責業績｜虛線(右軸)：操作人數"
            >
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={storeMetrics.dailyData}
                    margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#e7e5e4"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12, fill: "#78716c" }}
                      axisLine={{ stroke: "#e7e5e4" }}
                      tickLine={false}
                      dy={10}
                    />
                    <YAxis
                      yAxisId="left"
                      width={80}
                      tickFormatter={(val) =>
                        val === 0 ? "0" : `$${(val / 1000).toFixed(0)}k`
                      }
                      tick={{ fontSize: 12, fill: "#f59e0b" }}
                      axisLine={false}
                      tickLine={false}
                      label={{
                        value: "金額 (NT$)",
                        angle: -90,
                        position: "insideLeft",
                        fill: "#d6d3d1",
                        fontSize: 10,
                      }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      allowDecimals={false}
                      tick={{ fontSize: 12, fill: "#0ea5e9" }}
                      axisLine={false}
                      tickLine={false}
                      label={{
                        value: "人數",
                        angle: 90,
                        position: "insideRight",
                        fill: "#d6d3d1",
                        fontSize: 10,
                      }}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        borderRadius: "16px",
                        border: "none",
                        boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                        padding: "12px",
                      }}
                      formatter={(value, name) => {
                        if (name === "課程操作人數")
                          return [fmtNum(value), name];
                        return [fmtMoney(value), name];
                      }}
                      labelStyle={{
                        color: "#78716c",
                        marginBottom: "0.5rem",
                        fontWeight: "bold",
                      }}
                      cursor={{ fill: "#f5f5f4", opacity: 0.6 }}
                    />
                    <Legend
                      verticalAlign="top"
                      height={36}
                      iconType="circle"
                      wrapperStyle={{
                        paddingBottom: "20px",
                        fontSize: "12px",
                        fontWeight: "bold",
                      }}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="cash"
                      name="現金業績 (淨額)"
                      fill="#fbbf24"
                      radius={[4, 4, 0, 0]}
                      barSize={20}
                      fillOpacity={0.9}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="accrual"
                      name="權責業績"
                      stroke="#8b5cf6"
                      strokeWidth={3}
                      dot={{
                        r: 4,
                        fill: "#8b5cf6",
                        strokeWidth: 2,
                        stroke: "#fff",
                      }}
                      activeDot={{ r: 6 }}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="traffic"
                      name="課程操作人數"
                      stroke="#0ea5e9"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{
                        r: 3,
                        fill: "#0ea5e9",
                        strokeWidth: 2,
                        stroke: "#fff",
                      }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </>
        )}
      </div>
    </ViewWrapper>
  );
};

export default StoreAnalysisView;