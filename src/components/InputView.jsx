/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useContext, useMemo } from "react";
import { 
  FileText, Upload, DollarSign,
  RotateCcw, Activity, AlertCircle, X, CheckCircle 
} from "lucide-react";
import { 
  collection, addDoc, setDoc, doc, serverTimestamp 
} from "firebase/firestore";

// --- 路徑修正 ---
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
    inputDate,
    setInputDate,
    showToast,
    logActivity,
    rawData,
  } = useContext(AppContext);

  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  
  // 預設表單值
  const defaultFormData = {
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
  };

  const [formData, setFormData] = useState(defaultFormData);
  
  // 新增狀態
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false); 
  const [existingReportId, setExistingReportId] = useState(null); 

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

  // ==========================================
  // ★★★ 1. 自動暫存 (Auto-Save) 機制 ★★★
  // ==========================================
  // A. 載入暫存
  useEffect(() => {
    const savedDraft = localStorage.getItem("cyj_input_draft_v3");
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        if (parsed.formData) setFormData(parsed.formData);
        if (parsed.store) setSelectedStore(parsed.store);
        if (parsed.manager) setSelectedManager(parsed.manager);
        if (parsed.date) setInputDate(parsed.date);
      } catch (e) {
        console.error("暫存讀取失敗", e);
        localStorage.removeItem("cyj_input_draft_v3");
      }
    }
  }, []);

  // B. 寫入暫存
  useEffect(() => {
    const draft = {
      formData,
      store: selectedStore,
      manager: selectedManager,
      date: inputDate,
      timestamp: Date.now()
    };
    localStorage.setItem("cyj_input_draft_v3", JSON.stringify(draft));
  }, [formData, selectedStore, selectedManager, inputDate]);

  // ==========================================
  // 邏輯處理區
  // ==========================================

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

  // --- 初始化選擇 (僅在沒有暫存還原時執行) ---
  useEffect(() => {
    if (!selectedStore && userRole === "store" && currentUser) {
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
    } else if (!selectedManager && userRole === "manager" && currentUser) {
      setSelectedManager(currentUser.name);
    }
  }, [userRole, currentUser, managers]);

  // --- 重置功能 ---
  const handleReset = () => {
    if (confirm("確定要清空目前輸入的所有內容嗎？")) {
      setFormData(defaultFormData);
      localStorage.removeItem("cyj_input_draft_v3");
      showToast("表格已重置", "info");
    }
  };

  // ==========================================
  // ★★★ 2. 提交與確認邏輯 ★★★
  // ==========================================

  // 第一步：預先檢查 -> 打開確認視窗
  const handlePreSubmit = (e) => {
    e.preventDefault();
    if (!selectedStore) {
      showToast("請選擇店家", "error");
      return;
    }
    if (inputDate > today) {
      showToast("⛔ 不可以提交未來業績！", "error");
      return;
    }
    
    // 檢查是否為覆蓋舊資料
    const formattedInputDate = toStandardDateFormat(inputDate);
    const existingReport = rawData.find((d) => {
      const recordDate = toStandardDateFormat(d.date);
      return recordDate === formattedInputDate && d.storeName === selectedStore;
    });

    setExistingReportId(existingReport ? existingReport.id : null);
    setShowConfirmModal(true); // 打開視窗
  };

  // 第二步：最終提交 (寫入資料庫)
  const handleFinalSubmit = async () => {
    setIsSubmitting(true);
    try {
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
        submittedBy: currentUser?.name || "unknown", // 紀錄提交者
      };

      if (existingReportId) {
        // 更新舊資料
        await setDoc(
          doc(db, "artifacts", appId, "public", "data", "daily_reports", existingReportId),
          payload
        );
        showToast("資料已更新 (覆蓋舊資料)", "success");
        logActivity(userRole, currentUser?.name, "更新日報(覆蓋)", `${selectedStore} ${normalizedDate}`);
      } else {
        // 新增資料
        await addDoc(
          collection(db, "artifacts", appId, "public", "data", "daily_reports"),
          payload
        );
        showToast("日報提交成功", "success");
        logActivity(userRole, currentUser?.name, "提交日報", `${selectedStore} ${normalizedDate}`);
      }

      // 清除狀態與暫存
      setFormData(defaultFormData);
      localStorage.removeItem("cyj_input_draft_v3");
      setShowConfirmModal(false);
      setExistingReportId(null);

    } catch (err) {
      console.error(err);
      showToast("提交失敗，請檢查網路", "error");
    } finally {
      setIsSubmitting(false);
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
      <div className="max-w-2xl mx-auto space-y-6 pb-20">
        <Card title="日報數據回報">
          <div className="space-y-6">
            
            {/* 自動暫存提示 */}
            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 p-2 rounded-lg justify-center">
               <CheckCircle size={14} /> 系統已啟用自動暫存保護，輸入內容將自動保存
            </div>

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

            {/* 日報輸入表格 */}
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
              <h3 className="font-bold text-stone-600 mb-4 flex items-center gap-2">
                <FileText size={18} className="text-stone-400" /> 業績與客流數據
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
              
              <div className="flex gap-3">
                <button
                  onClick={handleReset}
                  className="px-4 py-4 bg-stone-100 text-stone-500 rounded-xl font-bold hover:bg-stone-200 transition-colors flex items-center gap-2"
                >
                  <RotateCcw size={20} />
                </button>
                <button
                  onClick={handlePreSubmit}
                  disabled={isSubmitting}
                  className="flex-1 bg-gradient-to-r from-stone-800 to-stone-700 hover:from-stone-700 hover:to-stone-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-stone-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? <Activity className="animate-spin" /> : <Upload size={20} />} 
                  提交日報數據
                </button>
              </div>
            </div>
          </div>
        </Card>

        {/* ========================================== */}
        {/* ★★★ 提交確認視窗 (Modal) ★★★ */}
        {/* ========================================== */}
        {showConfirmModal && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
              
              {/* 標題 */}
              <div className="bg-amber-400 p-4 flex items-center justify-between">
                <h3 className="text-white text-lg font-bold flex items-center gap-2">
                  <AlertCircle className="text-white" /> 請再次確認數據
                </h3>
                <button onClick={() => setShowConfirmModal(false)} className="text-white/80 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              {/* 內容清單 */}
              <div className="p-6 space-y-4">
                <div className="bg-stone-50 p-4 rounded-xl border border-stone-100 space-y-2">
                   <div className="flex justify-between border-b border-stone-200 pb-2 mb-2">
                      <span className="text-stone-500 font-bold">日期</span>
                      <span className="text-stone-800 font-mono font-bold text-lg">{inputDate}</span>
                   </div>
                   <div className="flex justify-between border-b border-stone-200 pb-2 mb-2">
                      <span className="text-stone-500 font-bold">店家</span>
                      <span className="text-stone-800 font-bold text-lg">{selectedStore}</span>
                   </div>
                   <div className="flex justify-between items-center">
                      <span className="text-stone-500 font-bold">現金業績</span>
                      <span className="text-amber-600 font-mono font-bold text-xl">${formData.cash || 0}</span>
                   </div>
                   <div className="flex justify-between items-center">
                      <span className="text-stone-500 font-bold">總權責</span>
                      <span className="text-indigo-600 font-mono font-bold text-xl">${formData.accrual || 0}</span>
                   </div>
                </div>

                {existingReportId && (
                  <div className="flex items-start gap-2 text-xs text-rose-500 bg-rose-50 p-3 rounded-lg border border-rose-100">
                     <AlertCircle size={14} className="mt-0.5 shrink-0"/>
                     <p className="font-bold">注意：系統偵測到當日已有資料，提交將會「覆蓋」原有紀錄。</p>
                  </div>
                )}

                <div className="flex items-start gap-2 text-xs text-stone-500 bg-blue-50 p-3 rounded-lg">
                   <AlertCircle size={14} className="text-blue-500 mt-0.5 shrink-0"/>
                   <p>請確認日期與金額無誤。提交後若需修改，請至「數據修正中心」進行調整。</p>
                </div>
              </div>

              {/* 按鈕區 */}
              <div className="p-4 bg-stone-50 flex gap-3 border-t border-stone-100">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 py-3 bg-white border border-stone-300 text-stone-600 rounded-xl font-bold hover:bg-stone-100 transition-colors"
                >
                  <RotateCcw size={16} className="inline mr-1"/> 返回修改
                </button>
                <button
                  onClick={handleFinalSubmit}
                  disabled={isSubmitting}
                  className="flex-1 py-3 bg-stone-800 text-white rounded-xl font-bold hover:bg-stone-700 shadow-md transition-all flex items-center justify-center gap-2"
                >
                  {isSubmitting ? '提交中...' : '確認提交'} <CheckCircle size={18}/>
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </ViewWrapper>
  );
};

export default InputView;