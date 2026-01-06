/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useContext } from "react";
import { 
  Target, FileText, Upload, DollarSign, CreditCard 
} from "lucide-react";
import { 
  collection, addDoc, setDoc, doc, serverTimestamp 
} from "firebase/firestore";

// --- 路徑修正：根據你的專案結構，這些應該在上一層 ---
import { db, appId } from "../config/firebase"; 
import { parseNumber, formatNumber, toStandardDateFormat } from "../utils/helpers";
import { AppContext } from "../AppContext";

// --- 引入共享 UI 元件 ---
import { ViewWrapper, Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";

const InputView = () => {
  const {
    currentUser,
    userRole,
    managers,
    budgets,
    inputDate,
    setInputDate,
    showToast,
    logActivity,
    rawData,
    openConfirm,
  } = useContext(AppContext);

  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [formData, setFormData] = useState({
    cash: "",
    accrual: "",
    operationalAccrual: "",
    skincareSales: "",
    skincareRefund: "",
    traffic: "",
    newCustomers: "",
    newCustomerClosings: "",
    newCustomerSales: "",
    refund: "",
  });
  const [targetInput, setTargetInput] = useState({ cash: "", accrual: "" });

  const LABELS = {
    cash: "現金業績",
    accrual: "總權責業績 (自動計算)",
    operationalAccrual: "操作權責 (技術)",
    skincareSales: "保養品業績",
    skincareRefund: "當日保養品退費",
    traffic: "課程操作人數",
    newCustomers: "新客數",
    newCustomerClosings: "新客留單人數",
    newCustomerSales: "新客業績",
    refund: "當日退費",
  };
  
  const today = new Date().toISOString().split("T")[0];
  const isFirstDay = inputDate.endsWith("-01");
  const canEditTargets =
    userRole === "director" ||
    userRole === "manager" ||
    (userRole === "store" && isFirstDay);

  // --- 自動計算總權責 ---
  useEffect(() => {
    const op = parseNumber(formData.operationalAccrual);
    const skin = parseNumber(formData.skincareSales);
    const total = op + skin;
    setFormData((prev) => {
      const currentTotal = parseNumber(prev.accrual);
      if (currentTotal !== total) {
        return { ...prev, accrual: formatNumber(total) };
      }
      return prev;
    });
  }, [formData.operationalAccrual, formData.skincareSales]);

  // --- 處理數字輸入 ---
  const handleNumberChange = (key, value) => {
    const rawValue = value.replace(/,/g, "");
    if (!/^\d*$/.test(rawValue)) return;
    if (
      (key === "traffic" ||
        key === "newCustomers" ||
        key === "newCustomerClosings") &&
      rawValue.length > 2
    ) {
      showToast("⚠️ 人數限制：不能超過兩位數 (最大 99)", "error");
      return;
    }
    setFormData((prev) => ({ ...prev, [key]: formatNumber(rawValue) }));
  };

  // --- 計算可選店家 ---
  const availableStores = React.useMemo(() => {
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

  // --- 初始化選擇 ---
  useEffect(() => {
    if (userRole === "store" && currentUser) {
      const myStores = currentUser.stores || [currentUser.storeName];
      if (myStores.length > 0) {
        const shortName = myStores[0].replace("CYJ", "").replace("店", "");
        const foundMgr = Object.keys(managers).find((mgr) =>
          managers[mgr].includes(shortName)
        );
        if (foundMgr) setSelectedManager(foundMgr);
        const fullName = myStores[0].startsWith("CYJ")
          ? myStores[0]
          : `CYJ${myStores[0]}店`;
        setSelectedStore(fullName);
      }
    } else if (userRole === "manager" && currentUser) {
      setSelectedManager(currentUser.name);
    }
  }, [userRole, currentUser, managers]);

  // --- 初始化目標輸入框 ---
  useEffect(() => {
    if (!selectedStore || !inputDate) {
      setTargetInput({ cash: "", accrual: "" });
      return;
    }
    const dateObj = new Date(inputDate);
    if (isNaN(dateObj.getTime())) return;
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const budgetKey = `${selectedStore}_${year}_${month}`;
    const budget = budgets[budgetKey];
    if (budget) {
      setTargetInput({
        cash: budget.cashTarget || "",
        accrual: budget.accrualTarget || "",
      });
    } else {
      setTargetInput({ cash: "", accrual: "" });
    }
  }, [selectedStore, inputDate, budgets]);

  // --- 儲存報表 ---
  const saveReport = async (existingId = null) => {
    try {
      if (isFirstDay) {
        await handleUpdateTargets(true);
      }
      const normalizedDate = toStandardDateFormat(inputDate);
      const payload = {
        date: normalizedDate,
        storeName: selectedStore,
        cash: parseNumber(formData.cash),
        accrual: parseNumber(formData.accrual),
        operationalAccrual: parseNumber(formData.operationalAccrual),
        skincareSales: parseNumber(formData.skincareSales),
        skincareRefund: parseNumber(formData.skincareRefund),
        traffic: parseNumber(formData.traffic),
        newCustomers: parseNumber(formData.newCustomers),
        newCustomerClosings: parseNumber(formData.newCustomerClosings),
        newCustomerSales: parseNumber(formData.newCustomerSales),
        refund: parseNumber(formData.refund),
        timestamp: serverTimestamp(),
      };
      if (existingId) {
        await setDoc(
          doc(
            db,
            "artifacts",
            appId,
            "public",
            "data",
            "daily_reports",
            existingId
          ),
          payload
        );
        showToast("資料已更新 (覆蓋舊資料)", "success");
        logActivity(
          userRole,
          currentUser?.name,
          "更新日報(覆蓋)",
          `${selectedStore} ${normalizedDate}`
        );
      } else {
        await addDoc(
          collection(db, "artifacts", appId, "public", "data", "daily_reports"),
          payload
        );
        showToast("日報提交成功", "success");
        logActivity(
          userRole,
          currentUser?.name,
          "提交日報",
          `${selectedStore} ${normalizedDate}`
        );
      }
      setFormData({
        cash: "",
        accrual: "",
        operationalAccrual: "",
        skincareSales: "",
        skincareRefund: "",
        traffic: "",
        newCustomers: "",
        newCustomerClosings: "",
        newCustomerSales: "",
        refund: "",
      });
    } catch (err) {
      console.error(err);
      showToast("提交失敗", "error");
    }
  };

  // --- 提交表單處理 ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedStore) {
      showToast("請選擇店家", "error");
      return;
    }
    if (inputDate > today) {
      showToast("⛔ 不可以提交未來業績！\n請確認日期符合規定。", "error");
      return;
    }
    if (isFirstDay) {
      const cashT = Number(targetInput.cash);
      const accrualT = Number(targetInput.accrual);
      if (!cashT || !accrualT || cashT <= 0 || accrualT <= 0) {
        showToast(
          "⚠️ 每月1號為目標設定日，請務必填寫當月「現金」與「權責」目標！",
          "error"
        );
        return;
      }
    }
    const formattedInputDate = toStandardDateFormat(inputDate);
    const existingReport = rawData.find((d) => {
      const recordDate = toStandardDateFormat(d.date);
      return recordDate === formattedInputDate && d.storeName === selectedStore;
    });
    if (existingReport) {
      openConfirm(
        "⚠️ 資料覆蓋確認",
        `系統檢測到 ${selectedStore} 在 ${formattedInputDate} 已經有一筆回報紀錄。\n\n您確定要提交並「覆蓋」原有的資料嗎？`,
        () => saveReport(existingReport.id)
      );
    } else {
      saveReport();
    }
  };

  // --- 更新目標 ---
  const handleUpdateTargets = async (silent = false) => {
    if (!selectedStore || !inputDate) return;
    const dateObj = new Date(inputDate);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const budgetKey = `${selectedStore}_${year}_${month}`;
    try {
      await setDoc(
        doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "monthly_targets",
          budgetKey
        ),
        {
          cashTarget: Number(targetInput.cash),
          accrualTarget: Number(targetInput.accrual),
        },
        { merge: true }
      );
      if (!silent) {
        showToast(`${month}月目標已更新`, "success");
        logActivity(
          userRole,
          currentUser?.name,
          "更新月目標",
          `${selectedStore} ${year}/${month}`
        );
      }
    } catch (e) {
      console.error(e);
      showToast("目標更新失敗", "error");
    }
  };

  const formKeys = [
    "cash",
    "refund",
    "accrual",
    "operationalAccrual",
    "skincareSales",
    "skincareRefund",
    "traffic",
    "newCustomers",
    "newCustomerClosings",
    "newCustomerSales",
  ];

  return (
    <ViewWrapper>
      <div className="max-w-2xl mx-auto space-y-6">
        <Card title="日報與目標管理">
          <div className="space-y-6">
            <div className="bg-stone-50 p-5 rounded-2xl border border-stone-100 space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1.5 text-stone-400 uppercase">
                  回報日期 (不可選未來日期)
                </label>
                <SmartDatePicker 
                  selectedDate={inputDate}
                  onDateSelect={(newDate) => {
                    if (newDate > today) {
                        alert("無法選擇未來日期！");
                        return;
                    }
                    setInputDate(newDate);
                  }}
                  stores={[]}
                  salesData={[]}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-stone-400 uppercase">
                    選擇區域
                  </label>
                  <select
                    value={selectedManager}
                    onChange={(e) => {
                      setSelectedManager(e.target.value);
                      setSelectedStore("");
                    }}
                    disabled={userRole !== "director"}
                    className="w-full border-2 border-stone-200 p-3 rounded-xl focus:border-amber-400 outline-none font-bold text-stone-700 bg-white disabled:bg-stone-100 disabled:text-stone-400"
                  >
                    <option value="">請選擇...</option>
                    {Object.keys(managers).map((m) => (
                      <option key={m} value={m}>
                        {m}區
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-stone-400 uppercase">
                    選擇店家
                  </label>
                  <select
                    value={selectedStore}
                    onChange={(e) => setSelectedStore(e.target.value)}
                    disabled={!selectedManager}
                    className="w-full border-2 border-stone-200 p-3 rounded-xl focus:border-amber-400 outline-none font-bold text-stone-700 bg-white disabled:bg-stone-100 disabled:text-stone-400"
                  >
                    <option value="">請選擇...</option>
                    {availableStores.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            {selectedStore && (
              <div
                className={`p-5 rounded-2xl border transition-all ${
                  canEditTargets
                    ? "bg-white border-stone-200 shadow-sm"
                    : "bg-stone-50 border-stone-100 opacity-90"
                }`}
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-stone-600 flex items-center gap-2">
                    <Target size={18} className="text-amber-500" /> 當月營運目標
                    ({new Date(inputDate).getMonth() + 1}月){" "}
                    {isFirstDay && (
                      <span className="text-xs bg-rose-100 text-rose-500 px-2 py-0.5 rounded-full ml-2">
                        1號必填
                      </span>
                    )}
                  </h3>
                  {canEditTargets && (
                    <button
                      onClick={() => handleUpdateTargets(false)}
                      className="text-xs bg-stone-800 text-white px-3 py-1.5 rounded-lg hover:bg-stone-700 transition-colors font-bold shadow-md active:scale-95"
                    >
                      更新目標
                    </button>
                  )}
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1">
                      現金目標{" "}
                      {isFirstDay && <span className="text-rose-500">*</span>}
                    </label>
                    <div className="relative">
                      <DollarSign
                        size={14}
                        className="absolute left-3 top-3 text-stone-400"
                      />
                      <input
                        type="number"
                        value={targetInput.cash}
                        onChange={(e) =>
                          setTargetInput({
                            ...targetInput,
                            cash: e.target.value,
                          })
                        }
                        disabled={!canEditTargets}
                        placeholder="0"
                        className={`w-full pl-8 pr-3 py-2 border-2 rounded-xl font-mono font-bold outline-none transition-all ${
                          canEditTargets
                            ? "border-stone-200 focus:border-amber-400 bg-white text-stone-700"
                            : "border-transparent bg-stone-100 text-stone-500"
                        }`}
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1">
                      權責目標{" "}
                      {isFirstDay && <span className="text-rose-500">*</span>}
                    </label>
                    <div className="relative">
                      <CreditCard
                        size={14}
                        className="absolute left-3 top-3 text-stone-400"
                      />
                      <input
                        type="number"
                        value={targetInput.accrual}
                        onChange={(e) =>
                          setTargetInput({
                            ...targetInput,
                            accrual: e.target.value,
                          })
                        }
                        disabled={!canEditTargets}
                        placeholder="0"
                        className={`w-full pl-8 pr-3 py-2 border-2 rounded-xl font-mono font-bold outline-none transition-all ${
                          canEditTargets
                            ? "border-stone-200 focus:border-cyan-400 bg-white text-stone-700"
                            : "border-transparent bg-stone-100 text-stone-500"
                        }`}
                      />
                    </div>
                  </div>
                </div>
                {!canEditTargets && (
                  <p className="text-[10px] text-stone-400 mt-2 text-right">
                    * 僅區長或每月1號可修改
                  </p>
                )}
              </div>
            )}
            <form
              onSubmit={handleSubmit}
              className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm"
            >
              <h3 className="font-bold text-stone-600 mb-4 flex items-center gap-2">
                <FileText size={18} className="text-stone-400" /> 日報數據輸入
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {formKeys.map((key) => {
                  const isReadOnly = key === "accrual";
                  const isRefund = key === "refund" || key === "skincareRefund";
                  return (
                    <div key={key}>
                      <label
                        className={`block text-xs font-bold mb-1.5 ${
                          isRefund ? "text-rose-500" : "text-stone-500"
                        }`}
                      >
                        {LABELS[key] || key}
                      </label>
                      <input
                        type="text"
                        value={formData[key]}
                        onChange={(e) =>
                          handleNumberChange(key, e.target.value)
                        }
                        readOnly={isReadOnly}
                        placeholder="0"
                        inputMode="numeric"
                        className={`w-full border-2 p-3 rounded-xl outline-none font-bold transition-all focus:shadow-lg focus:shadow-amber-50 focus:bg-amber-50/10 ${
                          isReadOnly
                            ? "bg-stone-100 text-stone-500 border-stone-100 cursor-not-allowed"
                            : `border-stone-100 focus:border-amber-400 ${
                                isRefund
                                  ? "text-rose-500 font-extrabold"
                                  : "text-stone-700"
                              }`
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
              <button
                type="submit"
                className="w-full bg-gradient-to-r from-stone-800 to-stone-700 hover:from-stone-700 hover:to-stone-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-stone-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Upload size={20} /> 提交日報數據
              </button>
            </form>
          </div>
        </Card>
      </div>
    </ViewWrapper>
  );
};

export default InputView;