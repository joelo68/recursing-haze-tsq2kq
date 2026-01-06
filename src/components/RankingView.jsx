import React, { useState, useMemo, useContext } from "react";
import { Download } from "lucide-react";
import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";

const RankingView = () => {
  const { analytics, fmtMoney, fmtNum } = useContext(AppContext);
  const [sortConfig, setSortConfig] = useState({
    key: "achievement",
    direction: "desc",
  });

  const sortedData = useMemo(() => {
    let items = [...analytics.storeList];
    if (sortConfig.key) {
      items.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key])
          return sortConfig.direction === "ascending" ? -1 : 1;
        if (a[sortConfig.key] > b[sortConfig.key])
          return sortConfig.direction === "ascending" ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [analytics.storeList, sortConfig]);

  const requestSort = (key) =>
    setSortConfig({
      key,
      direction:
        sortConfig.key === key && sortConfig.direction === "desc"
          ? "ascending"
          : "desc",
    });

  const handleExportCSV = () => {
    const headers = [
      "排名,店名,區域,現金業績,達成率,保養品業績,課程操作人數,消耗客單,新客數,新客留單",
    ];
    const rows = sortedData.map((store, index) => {
      const name = store.name.replace("CYJ", "").replace("店", "");
      return [
        index + 1,
        name,
        store.manager,
        store.cashTotal,
        store.achievement.toFixed(2) + "%",
        store.skincareSalesTotal,
        store.trafficTotal,
        store.trafficASP,
        store.newCustomersTotal,
        store.newCustomerClosingsTotal,
      ].join(",");
    });
    const csvContent = "\uFEFF" + [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `詳細報表_${new Date().toISOString().split("T")[0]}.csv`
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <ViewWrapper>
      <Card title="詳細報表與排名" subtitle="各店關鍵指標排名分析">
        <div className="flex justify-end mb-4">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors border border-emerald-100"
          >
            <Download size={16} /> 匯出 CSV
          </button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-stone-100 min-h-[500px]">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="bg-stone-50 font-bold text-xs text-stone-500 uppercase">
              <tr>
                <th className="p-4 w-16 text-center">排名</th>
                <th
                  className="p-4 cursor-pointer"
                  onClick={() => requestSort("name")}
                >
                  店名
                </th>
                <th
                  className="p-4 cursor-pointer text-right"
                  onClick={() => requestSort("cashTotal")}
                >
                  現金業績
                </th>
                <th
                  className="p-4 cursor-pointer text-right"
                  onClick={() => requestSort("achievement")}
                >
                  達成率
                </th>
                <th
                  className="p-4 cursor-pointer text-right"
                  onClick={() => requestSort("trafficTotal")}
                >
                  課程操作人數
                </th>
                <th
                  className="p-4 cursor-pointer text-right"
                  onClick={() => requestSort("newCustomersTotal")}
                >
                  新客數
                </th>
                <th
                  className="p-4 cursor-pointer text-right"
                  onClick={() => requestSort("newCustomerClosingsTotal")}
                >
                  留單數
                </th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-stone-50">
              {sortedData.map((store, index) => (
                <tr key={store.name} className="hover:bg-stone-50">
                  <td className="p-4 text-center text-stone-400 font-bold">
                    {index + 1}
                  </td>
                  <td className="p-4 font-bold text-stone-700">
                    {store.name.replace("CYJ", "").replace("店", "")}
                  </td>
                  <td className="p-4 text-right font-mono font-bold text-stone-700">
                    {fmtMoney(store.cashTotal)}
                  </td>
                  <td className="p-4 text-right font-mono font-bold text-emerald-600">
                    {store.achievement.toFixed(1)}%
                  </td>
                  <td className="p-4 text-right font-mono text-stone-600">
                    {fmtNum(store.trafficTotal)}
                  </td>
                  <td className="p-4 text-right font-mono text-stone-600">
                    {fmtNum(store.newCustomersTotal)}
                  </td>
                  <td className="p-4 text-right font-mono text-stone-600">
                    {fmtNum(store.newCustomerClosingsTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </ViewWrapper>
  );
};

export default RankingView;