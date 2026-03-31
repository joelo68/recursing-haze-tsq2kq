import { useMemo } from 'react';
import { toStandardDateFormat } from '../utils/helpers';

export const useAnalytics = (rawData, managers, budgets, selectedYear, selectedMonth) => {
  return useMemo(() => {
    const targetYear = parseInt(selectedYear);
    const monthInt = parseInt(selectedMonth);
    const rocYear = targetYear - 1911;

    // ==========================================
    // 1. 年度數據計算 (YTD - Year to Date)
    // ==========================================
    const yearlyData = rawData.filter((d) => {
      if (!d.date) return false;
      const dateStr = d.date.replace(/-/g, "/");
      const [y] = dateStr.split("/").map(Number);
      return (y === targetYear || y === rocYear);
    });

    const yearlyActual = yearlyData.reduce((acc, d) => ({
      cash: acc.cash + (d.cash || 0) - (d.refund || 0),
      accrual: acc.accrual + (d.accrual || 0),
    }), { cash: 0, accrual: 0 });

    let yearlyBudget = { cash: 0, accrual: 0 };
    const visibleStoreNames = Object.values(managers).flat().map(s => `CYJ${s}店`);

    for (let m = 1; m <= 12; m++) {
      visibleStoreNames.forEach(storeName => {
        const budgetKey = `${storeName}_${targetYear}_${m}`;
        if (budgets[budgetKey]) {
          yearlyBudget.cash += (budgets[budgetKey].cashTarget || 0);
          yearlyBudget.accrual += (budgets[budgetKey].accrualTarget || 0);
        }
      });
    }

    const yearlyStats = {
      cashActual: yearlyActual.cash,
      cashTarget: yearlyBudget.cash,
      cashAchievement: yearlyBudget.cash > 0 ? (yearlyActual.cash / yearlyBudget.cash) * 100 : 0,
      accrualActual: yearlyActual.accrual,
      accrualTarget: yearlyBudget.accrual,
      accrualAchievement: yearlyBudget.accrual > 0 ? (yearlyActual.accrual / yearlyBudget.accrual) * 100 : 0,
    };

    // ==========================================
    // 2. 當月數據計算
    // ==========================================
    const currentMonthData = yearlyData.filter((d) => { 
      const dateStr = d.date.replace(/-/g, "/");
      const [, m] = dateStr.split("/").map(Number);
      return m === monthInt;
    });

    const dates = [
      ...new Set(currentMonthData.map((d) => toStandardDateFormat(d.date))),
    ].sort();
    
    const latestDate = dates[dates.length - 1] || "無資料";
    const daysInMonth = new Date(targetYear, monthInt, 0).getDate();
    let currentDayNum = 1;
    if (latestDate !== "無資料") {
      currentDayNum = parseInt(latestDate.split("/")[2]);
    }

    const dailyTotals = dates.map((date) => {
      const dayRecs = currentMonthData.filter(
        (r) => toStandardDateFormat(r.date) === date
      );
      return {
        date: date.split("/")[2],
        fullDate: date,
        cash: dayRecs.reduce((a, b) => a + (b.cash || 0) - (b.refund || 0), 0),
        traffic: dayRecs.reduce((a, b) => a + (b.traffic || 0), 0),
      };
    });

    const storeList = Object.entries(managers).flatMap(([mgr, stores]) =>
      stores.map((s) => ({ name: `CYJ${s}店`, manager: mgr }))
    );
    
    const storeStats = storeList.map((s) => {
      const storeRecs = currentMonthData.filter((r) => r.storeName === s.name);
      
      const grossCashTotal = storeRecs.reduce((a, b) => a + (b.cash || 0), 0);
      const refundTotal = storeRecs.reduce((a, b) => a + (b.refund || 0), 0);
      const cashTotal = grossCashTotal - refundTotal;
      
      const accrualTotal = storeRecs.reduce((a, b) => a + (b.accrual || 0), 0);
      const operationalAccrualTotal = storeRecs.reduce((a, b) => a + (b.operationalAccrual || 0), 0);
      const trafficTotal = storeRecs.reduce((a, b) => a + (b.traffic || 0), 0);
      const newCustomersTotal = storeRecs.reduce((a, b) => a + (b.newCustomers || 0), 0);
      const newCustomerClosingsTotal = storeRecs.reduce((a, b) => a + (b.newCustomerClosings || 0), 0);
      const newCustomerSalesTotal = storeRecs.reduce((a, b) => a + (b.newCustomerSales || 0), 0);
      const grossSkincareSales = storeRecs.reduce((a, b) => a + (b.skincareSales || 0), 0);
      const skincareRefundTotal = storeRecs.reduce((a, b) => a + (b.skincareRefund || 0), 0);
      const skincareSalesTotal = grossSkincareSales - skincareRefundTotal;
      
      const budgetKey = `${s.name}_${targetYear}_${monthInt}`;
      const budget = budgets[budgetKey] || { cashTarget: 0, accrualTarget: 0 };

      // ★★★ 核心升級：雙引擎推估邏輯 (自動基準線分離法) ★★★
      let projection = 0;
      if (currentDayNum > 0) {
        if (currentDayNum <= 5) {
          // 引擎 A：1~5 號樣本太少，走傳統線性平均
          projection = Math.round((cashTotal / currentDayNum) * daysInMonth);
        } else {
          // 引擎 B：6 號開始，啟動異常值過濾
          // 1. 抓出這家店這幾天的「每日淨業績」陣列
          const dailyCashArray = [];
          for (let i = 1; i <= currentDayNum; i++) {
            const dayStr = String(i).padStart(2, '0');
            const dateTarget = `${targetYear}/${String(monthInt).padStart(2, '0')}/${dayStr}`;
            const dayRecs = storeRecs.filter(r => toStandardDateFormat(r.date) === dateTarget);
            const dayCash = dayRecs.reduce((a, b) => a + (b.cash || 0) - (b.refund || 0), 0);
            dailyCashArray.push(dayCash);
          }

          // 2. 計算中位數
          const sortedCash = [...dailyCashArray].sort((a, b) => a - b);
          const mid = Math.floor(sortedCash.length / 2);
          const median = sortedCash.length % 2 !== 0 ? sortedCash[mid] : (sortedCash[mid - 1] + sortedCash[mid]) / 2;

          // 3. 過濾 2 倍以上的茶會/極端值，算出「純淨常態日均」
          const threshold = median * 2;
          let normalCashSum = 0;
          let normalDaysCount = 0;

          dailyCashArray.forEach(cash => {
            if (cash <= threshold) {
              normalCashSum += cash;
              normalDaysCount++;
            }
          });

          const normalDailyAvg = normalDaysCount > 0 ? (normalCashSum / normalDaysCount) : 0;
          const remainingDays = daysInMonth - currentDayNum;
          
          // 4. 精準預測：已經入袋的總業績 + (純淨日均 * 剩下天數)
          projection = Math.round(cashTotal + (normalDailyAvg * remainingDays));
        }
      }
      
      return {
        ...s,
        cashTotal,
        accrualTotal,
        operationalAccrualTotal,
        trafficTotal,
        newCustomersTotal,
        newCustomerClosingsTotal,
        newCustomerSalesTotal,
        skincareSalesTotal,
        skincareRefundTotal,
        refundTotal,
        cashBudget: budget.cashTarget,
        accrualBudget: budget.accrualTarget,
        projection, // 替換為新引擎算出的數值
        achievement: budget.cashTarget > 0 ? (cashTotal / budget.cashTarget) * 100 : 0,
        trafficASP: trafficTotal > 0 ? Math.round(operationalAccrualTotal / trafficTotal) : 0,
        newCustomerASP: newCustomersTotal > 0 ? Math.round(newCustomerSalesTotal / newCustomersTotal) : 0,
      };
    });

    const grandTotal = storeStats.reduce(
      (acc, s) => ({
        cash: acc.cash + s.cashTotal,
        accrual: acc.accrual + s.accrualTotal,
        operationalAccrual: acc.operationalAccrual + s.operationalAccrualTotal,
        skincareSales: acc.skincareSales + s.skincareSalesTotal,
        skincareRefund: acc.skincareRefund + s.skincareRefundTotal,
        traffic: acc.traffic + s.trafficTotal,
        newCustomers: acc.newCustomers + s.newCustomersTotal,
        newCustomerClosings: acc.newCustomerClosings + s.newCustomerClosingsTotal,
        newCustomerSales: acc.newCustomerSales + s.newCustomerSalesTotal,
        refund: acc.refund + s.refundTotal,
        budget: acc.budget + s.cashBudget,
        accrualBudget: acc.accrualBudget + s.accrualBudget,
        projection: acc.projection + s.projection, // 總推估自動繼承各店的精準推估加總
      }),
      {
        cash: 0, accrual: 0, operationalAccrual: 0, skincareSales: 0, skincareRefund: 0,
        traffic: 0, newCustomers: 0, newCustomerClosings: 0, newCustomerSales: 0,
        refund: 0, budget: 0, accrualBudget: 0, projection: 0,
      }
    );

    const regionalStats = Object.entries(managers).map(
      ([mgr, stores]) => {
        const managed = storeStats.filter((s) => s.manager === mgr);
        const cashTotal = managed.reduce((a, b) => a + b.cashTotal, 0);
        const accrualTotal = managed.reduce((a, b) => a + b.accrualTotal, 0);
        const operationalAccrualTotal = managed.reduce((a, b) => a + b.operationalAccrualTotal, 0);
        const budget = managed.reduce((a, b) => a + b.cashBudget, 0);
        const skincareSalesTotal = managed.reduce((a, b) => a + b.skincareSalesTotal, 0);
        const skincareRefundTotal = managed.reduce((a, b) => a + b.skincareRefundTotal, 0);
        const trafficTotal = managed.reduce((a, b) => a + b.trafficTotal, 0);
        const newCustomersTotal = managed.reduce((a, b) => a + b.newCustomersTotal, 0);
        const newCustomerClosingsTotal = managed.reduce((a, b) => a + b.newCustomerClosingsTotal, 0);
        const refundTotal = managed.reduce((a, b) => a + b.refundTotal, 0);
        const projection = managed.reduce((a, b) => a + b.projection, 0); // 區塊推估同步繼承
        const trafficASP = trafficTotal > 0 ? Math.round(operationalAccrualTotal / trafficTotal) : 0;
        
        return {
          manager: mgr,
          cashTotal,
          accrualTotal,
          operationalAccrualTotal,
          skincareSalesTotal,
          skincareRefundTotal,
          trafficTotal,
          newCustomersTotal,
          newCustomerClosingsTotal,
          refundTotal,
          trafficASP,
          projection,
          achievement: budget > 0 ? (cashTotal / budget) * 100 : 0,
        };
      }
    );

    // ==========================================
    // 3. 回傳計算結果
    // ==========================================
    return {
      latestDate,
      daysPassed: currentDayNum,
      daysInMonth,
      remainingDays: daysInMonth - currentDayNum,
      dailyTotals,
      storeList: storeStats,
      grandTotal,
      regionalStats,
      yearlyStats, 
      totalAchievement: grandTotal.budget > 0 ? (grandTotal.cash / grandTotal.budget) * 100 : 0,
      avgTrafficASP: grandTotal.traffic > 0 ? Math.round(grandTotal.operationalAccrual / grandTotal.traffic) : 0,
      avgNewCustomerASP: grandTotal.newCustomers > 0 ? Math.round(grandTotal.newCustomerSales / grandTotal.newCustomers) : 0,
      allDates: dates,
    };
  }, [rawData, managers, budgets, selectedYear, selectedMonth]);
};