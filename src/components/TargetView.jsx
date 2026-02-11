// src/components/TargetView.jsx
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
    logActivity,
    // ★★★ 1. 引入動態路徑與品牌資訊 ★★★
    getCollectionPath,
    currentBrand
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

  // ★★★ 2. 定義品牌前綴 (與 Dashboard/History 一致，確保穩健) ★★★
  const brandPrefix = useMemo(() => {
    let name = "CYJ";
    if (currentBrand) {
      const id = typeof currentBrand === 'string' ? currentBrand : (currentBrand.id || "CYJ");
      const normalizedId = id.toLowerCase();
      
      if (normalizedId.includes("anniu") || normalizedId.includes("anew")) {
        name = "安妞";
      } else if (normalizedId.includes("yibo")) {
        name = "伊啵";
      } else {
        name = "CYJ";
      }
    }
    return name;
  }, [currentBrand]);

  // ★★★ 3. 計算可選店家 (使用標準化命名邏輯) ★★★
  const availableStores = useMemo(() => {
    // 輔助函式：確保店名格式正確 (前綴 + 店名 + 店)
    const formatStoreName = (s) => {
      // 先移除可能已有的前綴和後綴，取得核心店名
      const coreName = s.replace(/CYJ|安妞|伊啵|Anew|Yibo|店/gi, "").trim();
      return `${brandPrefix}${coreName}店`;
    };

    if (userRole === "director" || userRole === "trainer") // 教專與總監
      return selectedManager
        ? (managers[selectedManager] || []).map(formatStoreName)
        : [];
        
    if (userRole === "manager")
      return Object.values(managers)
        .flat()
        .map(formatStoreName);
        
    if (userRole === "store" && currentUser)
      return (currentUser.stores || [currentUser.storeName]).map(formatStoreName);
      
    return [];
  }, [selectedManager, managers, currentUser, userRole, brandPrefix]);

  // --- 初始化權限與預設店家 (修正自動選擇邏輯) ---
  useEffect(() => {
    // 切換品牌時，若當前選擇的店不在新列表內，則重置
    if (selectedStore && !availableStores.includes(selectedStore)) {
      setSelectedStore("");
    }

    if (userRole === "store" && currentUser) {
      const myStores = currentUser.stores || [currentUser.storeName];
      if (myStores.length > 0) {
        let rawName = myStores[0];
        // 移除常見後綴與前綴，還原成「簡稱」以比對區長名單
        rawName = rawName.replace(/CYJ|安妞|伊啵|Anew|Yibo|店/gi, "").trim();

        const foundMgr = Object.keys(managers).find((mgr) =>
          managers[mgr].includes(rawName)
        );
        if (foundMgr) setSelectedManager(foundMgr);
        
        // 設定選中店名 (使用新前綴)
        const fullName = `${brandPrefix}${rawName}店`;
        setSelectedStore(fullName);
      }
    } else if (userRole === "manager" && currentUser) {
      setSelectedManager(currentUser.name);
    }
  }, [userRole, currentUser, managers, brandPrefix, availableStores]); // 加入 availableStores 依賴

  // --- 從 budgets 載入既有資料 ---
  useEffect(() => {
    if (!selectedStore) {
      // 若沒選店家，重置為空
      setMonthTargets(Array.from({ length: 12 }, (_, i) => ({ month: i + 1, cashTarget: "", accrualTarget: "" })));
      return;
    }

    const newTargets = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      // Key 的格式必須與寫入時完全一致： "安妞中山店_2024_1"
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
    if (userRole === "director" || userRole === "manager" || userRole === "trainer") return false;

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
           // Key: "安妞中山店_2024_1"
           const key = `${selectedStore}_${selectedYear}_${item.month}`;
           
           // ★★★ 3. 修正寫入路徑：使用動態路徑 getCollectionPath ★★★
           const docRef = doc(getCollectionPath("monthly_targets"), key);
           
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
                  <p>Annual Budget Planning ({brandPrefix})</p>
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
              <div className="relative min-w-[100px] flex-1 md:flex-none">
                 <select
                   value={selectedYear}
                   onChange={(e) => setSelectedYear(Number(e.target.value))}
                   className="w-full pl-9 pr-4 py-3 md:py-2 bg-stone-50 border border-stone-200 rounded-xl font-bold text-stone-700 outline-none focus:border-indigo-400 appearance-none"
                 >
                   <option value={currentYear - 1}>{currentYear - 1} 年</option>
                   <option value={currentYear}>{currentYear} 年</option>
                   <option value={currentYear + 1}>{currentYear + 1} 年</option>
                 </select>
                 <Calendar className="absolute left-3 top-3.5 md:top-2.5 text-stone-400 pointer-events-none" size={16} />
              </div>

              {/* 區域選擇 (僅總監/教專) */}
              <div className="relative min-w-[120px] flex-1 md:flex-none">
                 <select
                    value={selectedManager}
                    onChange={(e) => {
                      setSelectedManager(e.target.value);
                      setSelectedStore("");
                    }}
                    disabled={userRole !== "director" && userRole !== "trainer"}
                    className="w-full pl-3 pr-8 py-3 md:py-2 bg-stone-50 border border-stone-200 rounded-xl font-bold text-stone-700 outline-none focus:border-indigo-400 disabled:opacity-50"
                  >
                    <option value="">選擇區域...</option>
                    {Object.keys(managers).map((m) => (
                      <option key={m} value={m}>{m}區</option>
                    ))}
                  </select>
              </div>

              {/* 店家選擇 */}
              <div className="relative min-w-[140px] flex-1 md:flex-none">
                  <select
                    value={selectedStore}
                    onChange={(e) => setSelectedStore(e.target.value)}
                    disabled={!selectedManager}
                    className="w-full pl-9 pr-4 py-3 md:py-2 bg-stone-50 border border-stone-200 rounded-xl font-bold text-stone-700 outline-none focus:border-indigo-400 appearance-none disabled:opacity-50"
                  >
                    <option value="">選擇店家...</option>
                    {availableStores.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <Store className="absolute left-3 top-3.5 md:top-2.5 text-stone-400 pointer-events-none" size={16} />
              </div>
            </div>
          </div>
        </Card>

        {selectedStore ? (
          <>
            {/* 1. 電腦版視圖 (Desktop Table) */}
            <div className="hidden md:block">
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
                                <div className="flex items-center justify-center text-stone-300" title="已鎖定">
                                  <Lock size={16} />
                                </div>
                              ) : (
                                item.cashTarget ? (
                                  <div className="flex items-center justify-center text-emerald-500">
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
              </Card>
            </div>

            {/* 2. 手機版視圖 (Mobile Cards) */}
            <div className="md:hidden space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="font-bold text-stone-700 text-lg flex items-center gap-2">
                  <Store size={18} className="text-amber-500"/> 
                  {selectedStore} 
                  <span className="text-xs font-normal text-stone-400 bg-white px-2 py-1 rounded-full border">{selectedYear}</span>
                </h3>
              </div>

              {monthTargets.map((item, idx) => {
                const locked = isMonthLocked(idx);
                return (
                  <div 
                    key={item.month} 
                    className={`p-4 rounded-2xl border shadow-sm transition-all
                      ${locked 
                        ? "bg-stone-100 border-stone-200 opacity-80" 
                        : "bg-white border-stone-100"
                      }
                    `}
                  >
                    <div className="flex justify-between items-center mb-4 border-b border-stone-100 pb-2">
                      <h4 className="font-bold text-lg text-stone-700 flex items-center gap-2">
                        <span className="bg-stone-800 text-white text-xs px-2 py-1 rounded-md">{item.month} 月</span>
                        {item.cashTarget && !locked && <CheckCircle size={16} className="text-emerald-500"/>}
                      </h4>
                      {locked && (
                        <div className="flex items-center gap-1 text-xs font-bold text-stone-400 bg-stone-200 px-2 py-1 rounded-lg">
                          <Lock size={12} /> 已鎖定
                        </div>
                      )}
                    </div>

                    <div className="space-y-4">
                      {/* 現金目標輸入 */}
                      <div>
                        <label className="text-xs font-bold text-stone-400 mb-1 block flex items-center gap-1">
                          <DollarSign size={12}/> 現金目標 (Cash)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric" // 手機彈出數字鍵盤
                          placeholder={locked ? "未設定" : "輸入金額..."}
                          value={item.cashTarget}
                          onChange={(e) => handleInputChange(idx, 'cashTarget', e.target.value)}
                          disabled={locked}
                          className={`w-full p-3 border-2 rounded-xl text-lg font-bold outline-none transition-all
                            ${locked
                              ? "bg-transparent border-transparent text-stone-400" 
                              : "bg-stone-50 border-stone-100 text-stone-800 focus:bg-white focus:border-amber-400 focus:shadow-lg"
                            }
                          `}
                        />
                      </div>

                      {/* 權責目標輸入 */}
                      <div>
                        <label className="text-xs font-bold text-stone-400 mb-1 block flex items-center gap-1">
                          <CreditCard size={12}/> 權責目標 (Accrual)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric" // 手機彈出數字鍵盤
                          placeholder={locked ? "未設定" : "輸入金額..."}
                          value={item.accrualTarget}
                          onChange={(e) => handleInputChange(idx, 'accrualTarget', e.target.value)}
                          disabled={locked}
                          className={`w-full p-3 border-2 rounded-xl text-lg font-bold outline-none transition-all
                            ${locked
                              ? "bg-transparent border-transparent text-stone-400" 
                              : "bg-stone-50 border-stone-100 text-stone-800 focus:bg-white focus:border-indigo-400 focus:shadow-lg"
                            }
                          `}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 底部懸浮儲存按鈕 (手機版優化) */}
            <div className="fixed bottom-6 left-0 right-0 px-4 md:static md:px-0 z-50 md:mt-6 md:flex md:justify-end">
               <button
                 onClick={handleSaveAll}
                 disabled={isSaving}
                 className="w-full md:w-auto px-8 py-4 md:py-3 bg-stone-800 text-white rounded-2xl md:rounded-xl font-bold shadow-2xl md:shadow-lg hover:bg-stone-700 hover:shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
               >
                 {isSaving ? "儲存中..." : <><Save size={20} /> 儲存設定</>}
               </button>
            </div>
            {/* 墊高底部，避免最後一張卡片被懸浮按鈕擋住 */}
            <div className="h-24 md:hidden"></div>
          </>
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