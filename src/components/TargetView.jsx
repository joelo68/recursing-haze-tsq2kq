// src/components/TargetView.jsx
import React, { useState, useContext, useEffect, useMemo } from "react";
import { 
  Save, Calendar, Store, DollarSign, CreditCard, TrendingUp, Lock, Unlock, CheckCircle, Star, X 
} from "lucide-react";
import { doc, writeBatch, setDoc } from "firebase/firestore";

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
    getCollectionPath,
    currentBrand
  } = useContext(AppContext);

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [monthTargets, setMonthTargets] = useState(
    Array.from({ length: 12 }, (_, i) => ({ 
      month: i + 1, 
      cashTarget: "", 
      accrualTarget: "",
      challengeCashTarget: "",
      challengeAccrualTarget: "",
      isUnlocked: false,
      isChallengeExpanded: false 
    }))
  );

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

  const availableStores = useMemo(() => {
    const formatStoreName = (s) => {
      const coreName = s.replace(/CYJ|安妞|伊啵|Anew|Yibo|店/gi, "").trim();
      return `${brandPrefix}${coreName}店`;
    };

    if (userRole === "director" || userRole === "trainer") 
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

  useEffect(() => {
    if (selectedStore && !availableStores.includes(selectedStore)) {
      setSelectedStore("");
    }

    if (userRole === "store" && currentUser) {
      const myStores = currentUser.stores || [currentUser.storeName];
      if (myStores.length > 0) {
        let rawName = myStores[0];
        rawName = rawName.replace(/CYJ|安妞|伊啵|Anew|Yibo|店/gi, "").trim();

        const foundMgr = Object.keys(managers).find((mgr) =>
          managers[mgr].includes(rawName)
        );
        if (foundMgr) setSelectedManager(foundMgr);
        
        const fullName = `${brandPrefix}${rawName}店`;
        setSelectedStore(fullName);
      }
    } else if (userRole === "manager" && currentUser) {
      setSelectedManager(currentUser.name);
    }
  }, [userRole, currentUser, managers, brandPrefix, availableStores]); 

  useEffect(() => {
    if (!selectedStore) {
      setMonthTargets(Array.from({ length: 12 }, (_, i) => ({ 
        month: i + 1, cashTarget: "", accrualTarget: "", challengeCashTarget: "", challengeAccrualTarget: "", isUnlocked: false, isChallengeExpanded: false 
      })));
      return;
    }

    const newTargets = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const key = `${selectedStore}_${selectedYear}_${month}`;
      const existing = budgets[key];
      const hasChallenge = existing && (existing.challengeCashTarget > 0 || existing.challengeAccrualTarget > 0);
      
      return {
        month,
        cashTarget: existing && existing.cashTarget > 0 ? formatNumber(existing.cashTarget) : "",
        accrualTarget: existing && existing.accrualTarget > 0 ? formatNumber(existing.accrualTarget) : "",
        challengeCashTarget: existing && existing.challengeCashTarget > 0 ? formatNumber(existing.challengeCashTarget) : "",
        challengeAccrualTarget: existing && existing.challengeAccrualTarget > 0 ? formatNumber(existing.challengeAccrualTarget) : "",
        isUnlocked: existing ? !!existing.isUnlocked : false,
        isChallengeExpanded: !!hasChallenge 
      };
    });
    
    setMonthTargets(newTargets);
  }, [selectedStore, selectedYear, budgets]);

  const isDataLockedForStore = (monthIndex) => {
    if (monthTargets[monthIndex].isUnlocked) {
        return false;
    }
    const month = monthIndex + 1;
    const key = `${selectedStore}_${selectedYear}_${month}`;
    const existing = budgets[key];
    return !!(existing && (existing.cashTarget > 0 || existing.accrualTarget > 0));
  };

  const isInputDisabled = (monthIndex) => {
    if (userRole === "director" || userRole === "manager" || userRole === "trainer") {
      return false; 
    }
    return isDataLockedForStore(monthIndex);
  };

  const handleUnlock = async (monthIndex) => {
    const month = monthIndex + 1;
    const confirmUnlock = window.confirm(`確定要「解鎖開放」 ${selectedStore} ${month} 月的目標嗎？\n\n(注意：解鎖後原數字會保留，店長可重新登入修改，存檔後將再次鎖定)`);
    
    if (!confirmUnlock) return;

    setIsSaving(true);
    try {
      const key = `${selectedStore}_${selectedYear}_${month}`;
      const docRef = doc(getCollectionPath("monthly_targets"), key);

      await setDoc(docRef, {
        isUnlocked: true,
        updatedAt: new Date().toISOString(),
        updatedBy: `${currentUser?.name || "主管"} (開放解鎖)`
      }, { merge: true });

      setMonthTargets(prev => {
        const newData = [...prev];
        newData[monthIndex] = { ...newData[monthIndex], isUnlocked: true };
        return newData;
      });

      showToast(`${month} 月目標已解鎖！請通知店長進行修改`, "success");
      logActivity(userRole, currentUser?.name, "開放解鎖年度目標", `${selectedStore} ${selectedYear}年 ${month}月`);

    } catch (error) {
      console.error("Unlock error:", error);
      showToast("解鎖失敗，請檢查網路連線", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleInputChange = (index, field, value) => {
    if (isInputDisabled(index)) return;
    const rawValue = value.replace(/,/g, "");
    if (!/^\d*$/.test(rawValue)) return;

    setMonthTargets(prev => {
      const newData = [...prev];
      newData[index] = { ...newData[index], [field]: formatNumber(rawValue) };
      return newData;
    });
  };

  const toggleChallenge = (index, e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (isInputDisabled(index)) return; 

    setMonthTargets(prev => {
      const newData = [...prev];
      const currentItem = newData[index];
      const isExpanding = !currentItem.isChallengeExpanded;

      if (!isExpanding && (currentItem.challengeCashTarget || currentItem.challengeAccrualTarget)) {
         const confirm = window.confirm("關閉挑戰目標將會清空該月已輸入的「挑戰數字」，確定嗎？");
         if (confirm) {
            newData[index] = {
               ...currentItem,
               challengeCashTarget: "",
               challengeAccrualTarget: "",
               isChallengeExpanded: false
            };
         }
      } else {
         newData[index] = {
            ...currentItem,
            isChallengeExpanded: isExpanding
         };
      }
      return newData;
    });
  };

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
        if (isInputDisabled(index)) return;

        const cash = parseNumber(item.cashTarget);
        const accrual = parseNumber(item.accrualTarget);
        const challengeCash = parseNumber(item.challengeCashTarget);
        const challengeAccrual = parseNumber(item.challengeAccrualTarget);

        if (cash >= 0 || accrual >= 0) {
           const key = `${selectedStore}_${selectedYear}_${item.month}`;
           const docRef = doc(getCollectionPath("monthly_targets"), key);
           
           batch.set(docRef, {
             cashTarget: cash,
             accrualTarget: accrual,
             challengeCashTarget: challengeCash,
             challengeAccrualTarget: challengeAccrual,
             isUnlocked: false, 
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
      
      setMonthTargets(prev => prev.map(item => ({ ...item, isUnlocked: false })));

      showToast(`${selectedYear}年度 目標更新成功`, "success");
      logActivity(userRole, currentUser?.name, "更新年度目標", `${selectedStore} ${selectedYear}年`);

    } catch (error) {
      console.error("Save targets error:", error);
      showToast("儲存失敗，請檢查網路", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const isManagementRole = userRole === "director" || userRole === "manager" || userRole === "trainer";

  return (
    <ViewWrapper>
      <div className="max-w-4xl mx-auto space-y-6 pb-20">
        
        <Card>
          <div className="flex flex-col md:flex-row gap-4 items-end md:items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
                 <TrendingUp size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-stone-800">年度目標設定</h2>
                <div className="flex items-center gap-2 text-xs text-stone-500 mt-1">
                  <p>Annual Budget Planning ({brandPrefix})</p>
                  {userRole === 'store' ? (
                    <span className="flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-bold">
                      <Lock size={10} /> 鎖定規則：已存檔月份，若需修改請聯繫區長
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-bold">
                      <Unlock size={10} /> 主管權限：可直接修改數字覆寫，或點選鎖頭開放店長修改
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 w-full md:w-auto">
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

              <div className="relative min-w-[120px] flex-1 md:flex-none">
                 <select
                    value={selectedManager}
                    onChange={(e) => {
                      setSelectedManager(e.target.value);
                      setSelectedStore("");
                    }}
                    disabled={!isManagementRole}
                    className="w-full pl-3 pr-8 py-3 md:py-2 bg-stone-50 border border-stone-200 rounded-xl font-bold text-stone-700 outline-none focus:border-indigo-400 disabled:opacity-50"
                  >
                    <option value="">選擇區域...</option>
                    {Object.keys(managers).map((m) => (
                      <option key={m} value={m}>{m}區</option>
                    ))}
                  </select>
              </div>

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
            <div className="hidden md:block animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Card title={`${selectedStore} - ${selectedYear} 年度預算表`}>
                <div className="overflow-hidden rounded-xl border border-stone-200">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-stone-50 text-stone-500 font-bold border-b border-stone-200">
                      <tr>
                        <th className="py-3 pl-4">月份</th>
                        <th className="py-3 px-2">現金目標 (Cash)</th>
                        <th className="py-3 px-2">權責目標 (Accrual)</th>
                        <th className="py-3 px-2 w-[80px] text-center">狀態</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {monthTargets.map((item, idx) => {
                        const storeLocked = isDataLockedForStore(idx);
                        const disabled = isInputDisabled(idx);
                        
                        return (
                          <React.Fragment key={item.month}>
                            <tr className={`transition-colors ${disabled ? 'bg-stone-50/50' : 'hover:bg-stone-50 group'}`}>
                              <td className="py-2 pl-4 font-bold text-stone-600 w-[80px] align-middle">
                                <div className="flex flex-col gap-1">
                                  <span>{item.month} 月</span>
                                </div>
                              </td>
                              <td className="py-2 px-2 align-middle">
                                <div className="relative">
                                  <DollarSign size={14} className={`absolute left-3 top-3 ${disabled ? 'text-stone-300' : 'text-stone-400'}`} />
                                  <input
                                    type="text"
                                    placeholder={disabled ? "-" : "0"}
                                    value={item.cashTarget}
                                    onChange={(e) => handleInputChange(idx, 'cashTarget', e.target.value)}
                                    disabled={disabled}
                                    className={`w-full pl-8 pr-3 py-2 border rounded-lg font-mono font-bold outline-none transition-colors
                                      ${disabled
                                        ? "bg-transparent text-stone-400 border-transparent cursor-not-allowed" 
                                        : "bg-white text-stone-700 border-stone-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                                      }
                                    `}
                                  />
                                </div>
                              </td>
                              <td className="py-2 px-2 align-middle">
                                 <div className="relative">
                                  <CreditCard size={14} className={`absolute left-3 top-3 ${disabled ? 'text-stone-300' : 'text-stone-400'}`} />
                                  <input
                                    type="text"
                                    placeholder={disabled ? "-" : "0"}
                                    value={item.accrualTarget}
                                    onChange={(e) => handleInputChange(idx, 'accrualTarget', e.target.value)}
                                    disabled={disabled}
                                    className={`w-full pl-8 pr-3 py-2 border rounded-lg font-mono font-bold outline-none transition-colors
                                      ${disabled
                                        ? "bg-transparent text-stone-400 border-transparent cursor-not-allowed" 
                                        : "bg-white text-stone-700 border-stone-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                                      }
                                    `}
                                  />
                                </div>
                              </td>
                              <td className="py-2 px-2 text-center align-middle">
                                <div className="flex flex-col items-center justify-center gap-2">
                                  <div className="h-6 flex items-center">
                                    {storeLocked ? (
                                      isManagementRole ? (
                                        <button 
                                          type="button"
                                          onClick={() => handleUnlock(idx)}
                                          title="點擊解鎖開放編輯"
                                          className="flex items-center justify-center text-stone-400 hover:text-amber-500 hover:bg-amber-50 p-1.5 rounded-lg transition-all mx-auto group/btn shadow-sm border border-transparent hover:border-amber-100"
                                        >
                                          <Lock size={16} className="block group-hover/btn:hidden transition-transform" />
                                          <Unlock size={16} className="hidden group-hover/btn:block scale-110 transition-transform" />
                                        </button>
                                      ) : (
                                        <div className="flex items-center justify-center text-stone-300" title="已鎖定 (如需修改請聯繫區長解鎖)">
                                          <Lock size={16} />
                                        </div>
                                      )
                                    ) : (
                                      (item.cashTarget || item.isUnlocked) ? (
                                        <div className={`flex items-center justify-center ${item.isUnlocked ? 'text-amber-500 animate-pulse' : 'text-emerald-500'}`} title={item.isUnlocked ? "已為您解鎖，請盡快修改存檔" : "可編輯 / 已填寫"}>
                                          {item.isUnlocked ? <Unlock size={16} /> : <CheckCircle size={16} className={`${isManagementRole ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'} transition-opacity`} />}
                                        </div>
                                      ) : (
                                        <div className="flex items-center justify-center text-stone-200">
                                          <TrendingUp size={16} />
                                        </div>
                                      )
                                    )}
                                  </div>
                                  
                                  {!item.isChallengeExpanded && !disabled && (
                                     <button
                                       type="button"
                                       onClick={(e) => toggleChallenge(idx, e)}
                                       className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5 transition-all bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200 opacity-0 group-hover:opacity-100"
                                       title="新增週慶/活動挑戰數字"
                                     >
                                       <Star size={10} /> 挑戰
                                     </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            
                            {item.isChallengeExpanded && (
                               <tr className={`transition-colors ${disabled ? 'bg-stone-50/50' : 'bg-amber-50/30'} border-b border-amber-100`}>
                                  <td className="py-2 pl-4 w-[80px] align-middle relative">
                                     <div className="absolute left-6 top-0 bottom-1/2 border-l-2 border-b-2 border-amber-200 w-3 rounded-bl-lg"></div>
                                     <div className="pl-6">
                                       <div className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-200/50 px-1.5 py-0.5 rounded w-fit">
                                         <Star size={10}/> 挑戰
                                       </div>
                                     </div>
                                  </td>
                                  <td className="py-2 px-2 align-middle">
                                     <div className="relative">
                                      <DollarSign size={14} className={`absolute left-3 top-3 ${disabled ? 'text-stone-300' : 'text-amber-500'}`} />
                                      <input
                                        type="text"
                                        placeholder={disabled ? "-" : "輸入挑戰現金..."}
                                        value={item.challengeCashTarget}
                                        onChange={(e) => handleInputChange(idx, 'challengeCashTarget', e.target.value)}
                                        disabled={disabled}
                                        className={`w-full pl-8 pr-3 py-2 border rounded-lg font-mono font-bold outline-none transition-colors
                                          ${disabled
                                            ? "bg-transparent text-stone-400 border-transparent cursor-not-allowed" 
                                            : "bg-white text-amber-700 border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                                          }
                                        `}
                                      />
                                    </div>
                                  </td>
                                  <td className="py-2 px-2 align-middle">
                                     <div className="relative">
                                      <CreditCard size={14} className={`absolute left-3 top-3 ${disabled ? 'text-stone-300' : 'text-amber-500'}`} />
                                      <input
                                        type="text"
                                        placeholder={disabled ? "-" : "輸入挑戰權責..."}
                                        value={item.challengeAccrualTarget}
                                        onChange={(e) => handleInputChange(idx, 'challengeAccrualTarget', e.target.value)}
                                        disabled={disabled}
                                        className={`w-full pl-8 pr-3 py-2 border rounded-lg font-mono font-bold outline-none transition-colors
                                          ${disabled
                                            ? "bg-transparent text-stone-400 border-transparent cursor-not-allowed" 
                                            : "bg-white text-amber-700 border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                                          }
                                        `}
                                      />
                                    </div>
                                  </td>
                                  <td className="py-2 px-2 text-center align-middle">
                                     {!disabled && (
                                       <button 
                                         type="button"
                                         onClick={(e) => toggleChallenge(idx, e)} 
                                         className="p-1.5 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors mx-auto block"
                                         title="移除挑戰目標"
                                       >
                                         <X size={16} />
                                       </button>
                                     )}
                                  </td>
                               </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div className="md:hidden space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between px-2">
                <h3 className="font-bold text-stone-700 text-lg flex items-center gap-2">
                  <Store size={18} className="text-amber-500"/> 
                  {selectedStore} 
                  <span className="text-xs font-normal text-stone-400 bg-white px-2 py-1 rounded-full border">{selectedYear}</span>
                </h3>
              </div>

              {monthTargets.map((item, idx) => {
                const storeLocked = isDataLockedForStore(idx);
                const disabled = isInputDisabled(idx);
                
                return (
                  <div 
                    key={item.month} 
                    className={`p-4 rounded-2xl border shadow-sm transition-all relative overflow-hidden
                      ${disabled 
                        ? "bg-stone-100 border-stone-200 opacity-95" 
                        : (item.isUnlocked ? "bg-amber-50/30 border-amber-200" : "bg-white border-stone-100")
                      }
                    `}
                  >
                    {item.isChallengeExpanded && (
                       <div className="absolute -top-10 -right-10 w-32 h-32 bg-amber-400 opacity-5 rounded-full blur-2xl pointer-events-none"></div>
                    )}

                    <div className="flex justify-between items-center mb-4 border-b border-stone-100 pb-2 relative z-10">
                      <h4 className="font-bold text-lg text-stone-700 flex items-center gap-2">
                        <span className="bg-stone-800 text-white text-xs px-2 py-1 rounded-md">{item.month} 月</span>
                        {(item.cashTarget || item.isUnlocked) && !storeLocked && (
                            item.isUnlocked ? <Unlock size={16} className="text-amber-500 animate-pulse" /> : <CheckCircle size={16} className="text-emerald-500"/>
                        )}
                      </h4>
                      {storeLocked ? (
                         isManagementRole ? (
                           <button 
                             type="button"
                             onClick={() => handleUnlock(idx)}
                             className="flex items-center gap-1 text-xs font-bold text-stone-500 bg-stone-100 border border-stone-200 px-3 py-1.5 rounded-lg hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 transition-all shadow-sm group"
                           >
                             <Lock size={12} className="block group-hover:hidden" />
                             <Unlock size={12} className="hidden group-hover:block" />
                             點擊解鎖
                           </button>
                         ) : (
                           <div className="flex items-center gap-1 text-xs font-bold text-stone-400 bg-stone-200 px-2 py-1 rounded-lg">
                             <Lock size={12} /> 已鎖定
                           </div>
                         )
                      ) : (
                         <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg shadow-sm ${item.isUnlocked ? 'text-amber-600 bg-amber-50 border border-amber-100 animate-pulse' : 'text-emerald-600 bg-emerald-50 border border-emerald-100'}`}>
                           {item.isUnlocked ? '已解鎖開放' : '可編輯'}
                         </div>
                      )}
                    </div>

                    <div className="space-y-4 relative z-10">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-bold text-stone-400 mb-1 block flex items-center gap-1">
                            <DollarSign size={12}/> 現金目標
                          </label>
                          <input
                            type="text"
                            inputMode="numeric" 
                            placeholder={disabled ? "-" : "0"}
                            value={item.cashTarget}
                            onChange={(e) => handleInputChange(idx, 'cashTarget', e.target.value)}
                            disabled={disabled}
                            className={`w-full p-2.5 border-2 rounded-xl font-bold outline-none transition-all text-sm
                              ${disabled
                                ? "bg-transparent border-transparent text-stone-400" 
                                : "bg-stone-50 border-stone-100 text-stone-800 focus:bg-white focus:border-amber-400 focus:shadow-lg"
                              }
                            `}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-stone-400 mb-1 block flex items-center gap-1">
                            <CreditCard size={12}/> 權責目標
                          </label>
                          <input
                            type="text"
                            inputMode="numeric" 
                            placeholder={disabled ? "-" : "0"}
                            value={item.accrualTarget}
                            onChange={(e) => handleInputChange(idx, 'accrualTarget', e.target.value)}
                            disabled={disabled}
                            className={`w-full p-2.5 border-2 rounded-xl font-bold outline-none transition-all text-sm
                              ${disabled
                                ? "bg-transparent border-transparent text-stone-400" 
                                : "bg-stone-50 border-stone-100 text-stone-800 focus:bg-white focus:border-indigo-400 focus:shadow-lg"
                              }
                            `}
                          />
                        </div>
                      </div>

                      {/* ★ 改名為 挑戰目標 (Challenge) */}
                      {!item.isChallengeExpanded ? (
                        !disabled && (
                           <button 
                             type="button"
                             onClick={(e) => toggleChallenge(idx, e)} 
                             className="w-full py-2.5 mt-2 border border-dashed border-amber-300 text-amber-600 text-xs font-bold rounded-xl flex justify-center items-center gap-1 hover:bg-amber-50 transition-colors"
                           >
                             <Star size={14} /> 新增挑戰目標 (週慶/加碼)
                           </button>
                        )
                      ) : (
                        <div className="mt-4 p-3.5 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl space-y-3 relative shadow-inner">
                           {!disabled && (
                              <button 
                                type="button"
                                onClick={(e) => toggleChallenge(idx, e)} 
                                className="absolute top-2 right-2 text-stone-400 hover:text-rose-500 bg-white rounded-full p-1 shadow-sm transition-colors"
                              >
                                 <X size={14}/>
                              </button>
                           )}
                           <h5 className="text-xs font-bold text-amber-700 flex items-center gap-1 mb-1">
                             <Star size={14} /> 挑戰目標 (Challenge)
                           </h5>
                           <div className="grid grid-cols-2 gap-3">
                             <div>
                                <input
                                  type="text"
                                  inputMode="numeric" 
                                  placeholder={disabled ? "-" : "現金..."}
                                  value={item.challengeCashTarget}
                                  onChange={(e) => handleInputChange(idx, 'challengeCashTarget', e.target.value)}
                                  disabled={disabled}
                                  className={`w-full p-2 border-2 rounded-xl font-bold outline-none transition-all text-sm
                                    ${disabled
                                      ? "bg-transparent border-transparent text-stone-400" 
                                      : "bg-white border-amber-100 text-amber-800 focus:border-amber-400 focus:shadow-lg"
                                    }
                                  `}
                                />
                             </div>
                             <div>
                                <input
                                  type="text"
                                  inputMode="numeric" 
                                  placeholder={disabled ? "-" : "權責..."}
                                  value={item.challengeAccrualTarget}
                                  onChange={(e) => handleInputChange(idx, 'challengeAccrualTarget', e.target.value)}
                                  disabled={disabled}
                                  className={`w-full p-2 border-2 rounded-xl font-bold outline-none transition-all text-sm
                                    ${disabled
                                      ? "bg-transparent border-transparent text-stone-400" 
                                      : "bg-white border-amber-100 text-amber-800 focus:border-amber-400 focus:shadow-lg"
                                    }
                                  `}
                                />
                             </div>
                           </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="fixed bottom-6 left-0 right-0 px-4 md:static md:px-0 z-50 md:mt-6 md:flex md:justify-end">
               <button
                 type="button"
                 onClick={handleSaveAll}
                 disabled={isSaving}
                 className="w-full md:w-auto px-8 py-4 md:py-3 bg-stone-800 text-white rounded-2xl md:rounded-xl font-bold shadow-2xl md:shadow-lg hover:bg-stone-700 hover:shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
               >
                 {isSaving ? "儲存中..." : <><Save size={20} /> 儲存設定</>}
               </button>
            </div>
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