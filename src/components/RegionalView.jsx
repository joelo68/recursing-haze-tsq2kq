// src/components/RegionalView.jsx
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
import { Loader2 } from "lucide-react";

const RegionalView = () => {
  const { 
    fmtMoney, 
    fmtNum, 
    userRole, 
    currentBrand,
    // ★ 改用原始資料自行運算，不再依賴舊的 analytics
    allReports,
    managers,
    budgets,
    selectedYear,
    selectedMonth
  } = useContext(AppContext);

  // 1. 定義品牌前綴與名稱
  const { brandInfo, brandPrefix } = useMemo(() => {
    let id = "CYJ";
    let name = "CYJ";
    
    if (currentBrand) {
      if (typeof currentBrand === 'string') {
        id = currentBrand;
      } else if (typeof currentBrand === 'object') {
        id = currentBrand.id || "CYJ";
        name = currentBrand.name || currentBrand.label || id;
      }
    }

    const normalizedId = id.toLowerCase();
    if (normalizedId.includes("anniu") || normalizedId.includes("anew")) {
      name = "安妞";
    } else if (normalizedId.includes("yibo")) {
      name = "伊啵";
    } else {
      name = "CYJ";
    }

    return { brandInfo: { id, name }, brandPrefix: name };
  }, [currentBrand]);

  // 2. 通用店名清洗函式
  const cleanStoreName = (name) => {
    if (!name) return "";
    return name.replace(new RegExp(`^(${brandPrefix}|CYJ|Anew|Yibo)`, 'i'), '').replace(/店$/, '').trim();
  };

  // ★★★ 3. 本地即時運算區域數據 (核心修正) ★★★
  const regionalData = useMemo(() => {
    if (!allReports || !managers) return null;

    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);

    // 準備容器
    const stats = Object.keys(managers).map(mgr => ({
      manager: mgr,
      stores: [],
      cashTotal: 0,
      accrualTotal: 0,
      skincareSalesTotal: 0,
      trafficTotal: 0,
      newCustomersTotal: 0,
      newCustomerClosingsTotal: 0,
      budgetTotal: 0,
      achievement: 0
    }));

    // 遍歷每個區域
    stats.forEach(region => {
      const storeList = managers[region.manager] || [];
      
      // 遍歷該區的每家店
      storeList.forEach(storeName => { // storeName 是簡稱 (如: 中山)
        const fullName = `${brandPrefix}${storeName}店`; // 組合完整名稱
        
        // 初始單店數據
        const storeStat = {
          name: fullName,
          cleanName: storeName,
          cashTotal: 0,
          accrualTotal: 0,
          budget: 0,
          achievement: 0
        };

        // 1. 加總業績 (從 allReports)
        allReports.forEach(r => {
          const rDate = new Date(r.date);
          if (rDate.getFullYear() !== y || (rDate.getMonth() + 1) !== m) return;
          if (r.storeName !== fullName) return; // 精準比對

          const cash = (Number(r.cash) || 0) - (Number(r.refund) || 0);
          const accrual = Number(r.accrual) || 0;

          storeStat.cashTotal += cash;
          storeStat.accrualTotal += accrual;

          // 累加到區域總計
          region.cashTotal += cash;
          region.accrualTotal += accrual;
          region.skincareSalesTotal += (Number(r.skincareSales) || 0);
          region.trafficTotal += (Number(r.traffic) || 0);
          region.newCustomersTotal += (Number(r.newCustomers) || 0);
          region.newCustomerClosingsTotal += (Number(r.newCustomerClosings) || 0);
        });

        // 2. 取得目標 (從 budgets)
        const budgetKey = `${fullName}_${y}_${m}`;
        const b = budgets[budgetKey];
        if (b) {
          storeStat.budget = Number(b.cashTarget) || 0;
          region.budgetTotal += storeStat.budget;
        }

        // 計算單店達成率
        storeStat.achievement = storeStat.budget > 0 ? (storeStat.cashTotal / storeStat.budget) * 100 : 0;
        
        region.stores.push(storeStat);
      });

      // 計算區域達成率
      region.achievement = region.budgetTotal > 0 ? (region.cashTotal / region.budgetTotal) * 100 : 0;
    });

    // 排序：業績高的區域排前面
    return stats.sort((a, b) => b.cashTotal - a.cashTotal);

  }, [allReports, managers, budgets, selectedYear, selectedMonth, brandPrefix]);

  const pieData = useMemo(
    () => {
      if (!regionalData) return [];
      return regionalData
        .map((r) => ({ name: r.manager, value: r.cashTotal }))
        .filter((i) => i.value > 0);
    },
    [regionalData]
  );

  const COLORS = [
    "#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#82ca9d",
  ];

  if (!regionalData) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-stone-300" /><span className="ml-3 text-stone-400 font-bold">數據載入中...</span></div>;

  return (
    <ViewWrapper>
      <div className="space-y-8">
        
        {/* 標題區 */}
        <div className="flex items-center gap-3 mb-2 px-2">
            <div className={`w-2 h-8 rounded-full ${brandInfo.id.toLowerCase().includes('anniu') ? 'bg-teal-500' : brandInfo.id.toLowerCase().includes('yibo') ? 'bg-purple-500' : 'bg-amber-500'}`}></div>
            <h1 className="text-2xl font-bold text-stone-700">{brandInfo.name} 區域分析</h1>
        </div>

        {/* 區域卡片列表 */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {regionalData.map((region) => (
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
                    {region.achievement.toFixed(0)}%
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
                    課程操作
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

        {/* 總監視角：圓餅圖 */}
        {userRole === "director" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-bottom-4 duration-500">
            <Card title={`各區現金業績貢獻佔比 (${brandPrefix})`} subtitle="區長業績分佈分析">
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
          /* 非總監視角 (區長/店長)：顯示分店細節 */
          <div className="space-y-6">
            {regionalData.map((region) => {
              // 權限過濾：如果是區長，只顯示自己那一區
              if (userRole === 'manager' && currentUser && currentUser.name !== region.manager) return null;

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
                    {region.stores.map((store) => (
                      <div
                        key={store.name}
                        className="bg-white border border-stone-100 rounded-2xl p-5 hover:shadow-lg transition-all"
                      >
                        <div className="flex justify-between items-start mb-4">
                          <h4 className="font-bold text-stone-700">
                            {store.cleanName}
                          </h4>
                          <span className={`text-sm font-bold ${store.achievement >= 100 ? 'text-emerald-600' : 'text-amber-500'}`}>
                            {store.achievement.toFixed(0)}%
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