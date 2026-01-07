import React, { useState, useContext, useEffect, useMemo } from "react";
import { 
  Save, Calendar, Store, DollarSign, CreditCard, TrendingUp, Lock, CheckCircle 
} from "lucide-react";
import { doc, writeBatch } from "firebase/firestore";

import { db, appId } from "../config/firebase";
import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";
import { formatNumber, parseNumber } from "../utils/helpers";

const TargetView = () => {
  const { 
    userRole, 
    managers, 
    currentUser, 
    budgets, 
    showToast, 
    logActivity 
  } = useContext(AppContext);

  // --- 狀態管理 ---
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // 12個月份的預設資料
  const [monthTargets, setMonthTargets] = useState(
    Array.from({ length: 12 }, (_, i) => ({ 
      month: i + 1, 
      cashTarget: "", 
      accrualTarget: "" 
    }))
  );

  // --- 計算可選店家 ---
  const availableStores = useMemo(() => {
    if (!selectedManager) {
      if (userRole === "store" && currentUser) {
        return (currentUser.stores || [currentUser.storeName]).map((s) =>
          s.startsWith("CYJ") ? s : `CYJ${s}店`
        );
      }
      return [];
    }
    return (managers[selectedManager] || []).map((s) => `CYJ${s}店`);
  }, [selectedManager, managers, userRole, currentUser]);

  // --- 初始化權限與預設店家 ---
  useEffect(() => {
    if (userRole === "store" && currentUser) {
      const myStores = currentUser.stores || [currentUser.storeName];
      if (myStores.length > 0) {
        const shortName = myStores[0].replace("CYJ", "").replace("店", "");
        const foundMgr = Object.keys(managers).find((mgr) =>
          managers[mgr].includes(shortName)
        );
        if (foundMgr) setSelectedManager(foundMgr);
        const fullName = myStores[0].startsWith("CYJ") ? myStores[0] : `CYJ${myStores[0]}店`;
        setSelectedStore(fullName);
      }
    } else if (userRole === "manager" && currentUser) {
      setSelectedManager(currentUser.name);
    }
  }, [userRole, currentUser, managers]);

  // --- 從 budgets 載入既有資料 ---
  useEffect(() => {
    if (!selectedStore) return;

    const newTargets = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const key = `${selectedStore}_${selectedYear}_${month}`;
      const existing = budgets[key];
      
      return {
        month,
        cashTarget: existing ? formatNumber(existing.cashTarget) : "",
        accrualTarget: existing ? formatNumber(existing.accrualTarget) : ""
      };
    });
    
    setMonthTargets(newTargets);
  }, [selectedStore, selectedYear, budgets]);

  // ★★★ 核心邏輯：判斷該月份是否鎖定 ★★★
  const isMonthLocked = (monthIndex) => {
    // 1. 總監和區長永遠不鎖定
    if (userRole === "director" || userRole === "manager") return false;

    // 2. 店長：檢查資料庫是否已經有數字
    const month = monthIndex + 1;
    const key = `${selectedStore}_${selectedYear}_${month}`;
    const existing = budgets[key];

    // 如果已經有設定過目標 (且大於0)，就鎖定，不讓店長修改
    if (existing && (existing.cashTarget > 0 || existing.accrualTarget > 0)) {
      return true;
    }

    // 3. 如果是空的 (或是0)，店長可以設定 (第一次設定)
    return false;
  };

  // --- 處理輸入變更 ---
  const handleInputChange = (index, field, value) => {
    // 如果該月被鎖定，直接擋掉
    if (isMonthLocked(index)) return;

    const rawValue = value.replace(/,/g, "");
    if (!/^\d*$/.test(rawValue)) return;

    setMonthTargets(prev => {
      const newData = [...prev];
      newData[index] = { ...newData[index], [field]: formatNumber(rawValue) };
      return newData;
    });
  };

  // --- 批次儲存 ---
  const handleSaveAll = async () => {
    if (!selectedStore) {
      showToast("請選擇店家", "error");
      return;
    }

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      let hasData = false;
      
      monthTargets.forEach((item, index) => {
        // 如果被鎖定，就不重複寫入 (避免覆蓋)
        if (isMonthLocked(index)) return;

        const cash = parseNumber(item.cashTarget);
        const accrual = parseNumber(item.accrualTarget);

        // 有輸入才存
        if (cash > 0 || accrual > 0) {
           const key = `${selectedStore}_${selectedYear}_${item.month}`;
           const docRef = doc(db, "artifacts", appId, "public", "data", "monthly_targets", key);
           batch.set(docRef, {
             cashTarget: cash,
             accrualTarget: accrual,
             updatedAt: new Date().toISOString(),
             updatedBy: currentUser?.name || "unknown"
           }, { merge: true });
           hasData = true;
        }
      });

      if (!hasData) {
        showToast("沒有新增任何可儲存的目標數據", "info");
        setIsSaving(false);
        return;
      }

      await batch.commit();
      showToast(`${selectedYear}年度 目標更新成功`, "success");
      logActivity(userRole, currentUser?.name, "更新年度目標", `${selectedStore} ${selectedYear}年`);

    } catch (error) {
      console.error("Save targets error:", error);
      showToast("儲存失敗，請檢查網路", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ViewWrapper>
      <div className="max-w-4xl mx-auto space-y-6 pb-20">
        
        {/* 頂部控制列 */}
        <Card>
          <div className="flex flex-col md:flex-row gap-4 items-end md:items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
                 <TrendingUp size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-stone-800">年度目標設定</h2>
                <div className="flex items-center gap-2 text-xs text-stone-500">
                  <p>Annual Budget Planning</p>
                  {userRole === 'store' && (
                    <span className="flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      <Lock size={10} /> 鎖定規則：已設定月份僅區長可修改
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 w-full md:w-auto">
              {/* 年份選擇 */}
              <div className="relative min-w-[100px]">
                 <select
                   value={selectedYear}
                   onChange={(e) => setSelectedYear(Number(e.target.value))}
                   className="w-full pl-9 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl font-bold text-stone-700 outline-none focus:border-indigo-400 appearance-none"
                 >
                   <option value={currentYear - 1}>{currentYear - 1} 年</option>
                   <option value={currentYear}>{currentYear} 年</option>
                   <option value={currentYear + 1}>{currentYear + 1} 年</option>
                 </select>
                 <Calendar className="absolute left-3 top-2.5 text-stone-400 pointer-events-none" size={16} />
              </div>

              {/* 區域選擇 (僅總監) */}
              <div className="relative min-w-[120px]">
                 <select
                    value={selectedManager}
                    onChange={(e) => {
                      setSelectedManager(e.target.value);
                      setSelectedStore("");
                    }}
                    disabled={userRole !== "director"}
                    className="w-full pl-3 pr-8 py-2 bg-stone-50 border border-stone-200 rounded-xl font-bold text-stone-700 outline-none focus:border-indigo-400 disabled:opacity-50"
                  >
                    <option value="">選擇區域...</option>
                    {Object.keys(managers).map((m) => (
                      <option key={m} value={m}>{m}區</option>
                    ))}
                  </select>
              </div>

              {/* 店家選擇 */}
              <div className="relative min-w-[140px]">
                  <select
                    value={selectedStore}
                    onChange={(e) => setSelectedStore(e.target.value)}
                    disabled={!selectedManager}
                    className="w-full pl-9 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl font-bold text-stone-700 outline-none focus:border-indigo-400 appearance-none disabled:opacity-50"
                  >
                    <option value="">選擇店家...</option>
                    {availableStores.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <Store className="absolute left-3 top-2.5 text-stone-400 pointer-events-none" size={16} />
              </div>
            </div>
          </div>
        </Card>

        {/* 12個月輸入表格 */}
        {selectedStore ? (
          <Card title={`${selectedStore} - ${selectedYear} 年度預算表`}>
            <div className="overflow-hidden rounded-xl border border-stone-200">
              <table className="w-full text-sm text-left">
                <thead className="bg-stone-50 text-stone-500 font-bold border-b border-stone-200">
                  <tr>
                    <th className="py-3 pl-4">月份</th>
                    <th className="py-3 px-2">現金目標 (Cash)</th>
                    <th className="py-3 px-2">權責目標 (Accrual)</th>
                    <th className="py-3 px-2 w-[80px]">狀態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {monthTargets.map((item, idx) => {
                    const locked = isMonthLocked(idx);
                    
                    return (
                      <tr key={item.month} className={`transition-colors ${locked ? 'bg-stone-50/50' : 'hover:bg-stone-50'}`}>
                        <td className="py-2 pl-4 font-bold text-stone-600 w-[80px]">
                          {item.month} 月
                        </td>
                        <td className="py-2 px-2">
                          <div className="relative">
                            <DollarSign size={14} className={`absolute left-3 top-3 ${locked ? 'text-stone-300' : 'text-stone-400'}`} />
                            <input
                              type="text"
                              placeholder={locked ? "-" : "0"}
                              value={item.cashTarget}
                              onChange={(e) => handleInputChange(idx, 'cashTarget', e.target.value)}
                              disabled={locked}
                              className={`w-full pl-8 pr-3 py-2 border rounded-lg font-mono font-bold outline-none transition-colors
                                ${locked
                                  ? "bg-transparent text-stone-400 border-transparent cursor-not-allowed" 
                                  : "bg-white text-stone-700 border-stone-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                                }
                              `}
                            />
                          </div>
                        </td>
                        <td className="py-2 px-2">
                           <div className="relative">
                            <CreditCard size={14} className={`absolute left-3 top-3 ${locked ? 'text-stone-300' : 'text-stone-400'}`} />
                            <input
                              type="text"
                              placeholder={locked ? "-" : "0"}
                              value={item.accrualTarget}
                              onChange={(e) => handleInputChange(idx, 'accrualTarget', e.target.value)}
                              disabled={locked}
                              className={`w-full pl-8 pr-3 py-2 border rounded-lg font-mono font-bold outline-none transition-colors
                                ${locked
                                  ? "bg-transparent text-stone-400 border-transparent cursor-not-allowed" 
                                  : "bg-white text-stone-700 border-stone-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                                }
                              `}
                            />
                          </div>
                        </td>
                        <td className="py-2 px-2 text-center">
                          {locked ? (
                            <div className="flex items-center justify-center text-stone-300" title="已鎖定 (僅區長可修改)">
                              <Lock size={16} />
                            </div>
                          ) : (
                            item.cashTarget ? (
                              <div className="flex items-center justify-center text-emerald-500" title="待儲存">
                                <CheckCircle size={16} className="opacity-0 group-hover:opacity-50" />
                              </div>
                            ) : (
                              <div className="flex items-center justify-center text-stone-200">
                                <TrendingUp size={16} />
                              </div>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex justify-end">
               <button
                 onClick={handleSaveAll}
                 disabled={isSaving}
                 className="px-8 py-3 bg-stone-800 text-white rounded-xl font-bold shadow-lg hover:bg-stone-700 hover:shadow-xl active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
               >
                 {isSaving ? "儲存中..." : <><Save size={18} /> 儲存設定</>}
               </button>
            </div>
          </Card>
        ) : (
          <div className="py-20 text-center text-stone-400 bg-stone-50 rounded-2xl border-2 border-dashed border-stone-200">
             <Store size={48} className="mx-auto mb-2 opacity-20" />
             <p>請先選擇上方的「區域」與「店家」以開始設定目標</p>
          </div>
        )}

      </div>
    </ViewWrapper>
  );
};

export default TargetView;