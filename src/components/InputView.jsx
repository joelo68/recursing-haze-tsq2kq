/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useContext, useMemo } from "react";
import { 
  FileText, Upload, DollarSign,
  RotateCcw, Activity, AlertCircle, X, CheckCircle, User, Star, Bug,
  Layers, Users, TrendingDown, Calendar, AlertTriangle, Calculator
} from "lucide-react";
import { 
  collection, addDoc, setDoc, doc, serverTimestamp, getDocFromServer 
} from "firebase/firestore";

import { db, appId } from "../config/firebase"; 
import { parseNumber, formatNumber, toStandardDateFormat } from "../utils/helpers";
import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";

// ★★★ 輔助函式：取得當地時間的 YYYY-MM-DD (修正 UTC 時差問題) ★★★
const getLocalTodayString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// ============================================================================
// ★★★ 子元件 A：店長專用輸入介面 (StoreInputView) - 維持不變 ★★★
// ============================================================================
const StoreInputView = () => {
  const {
    currentUser, userRole, managers, inputDate, setInputDate, showToast, logActivity, rawData,
  } = useContext(AppContext);

  const [selectedManager, setSelectedManager] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const defaultFormData = {
    cash: "", accrual: "", operationalAccrual: "", skincareSales: "", skincareRefund: "",
    traffic: "", newCustomers: "", newCustomerClosings: "", newCustomerSales: "", refund: "",
  };
  const [formData, setFormData] = useState(defaultFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [showConfirmModal, setShowConfirmModal] = useState(false); 
  const [showDateWarningModal, setShowDateWarningModal] = useState(false); 
  const [existingReportId, setExistingReportId] = useState(null); 
  
  const LABELS = {
    cash: "現金業績", accrual: "總權責業績 (自動計算)", operationalAccrual: "操作權責 (技術)",
    skincareSales: "保養品業績", skincareRefund: "當日保養品退費", traffic: "課程操作人數",
    newCustomers: "新客數", newCustomerClosings: "新客留單人數", newCustomerSales: "新客業績", refund: "當日退費",
  };
  
  const today = getLocalTodayString();

  useEffect(() => {
    const handleWakeUp = () => {
      if (document.visibilityState === "visible" || document.hasFocus()) {
        const realToday = getLocalTodayString(); 
        const isFormEmpty = Object.values(formData).every(val => val === "");
        
        if (inputDate !== realToday && isFormEmpty) {
           console.log(`[系統喚醒] 日期校正: ${inputDate} -> ${realToday}`);
           setInputDate(realToday);
        }
      }
    };

    document.addEventListener("visibilitychange", handleWakeUp);
    window.addEventListener("focus", handleWakeUp);

    return () => {
      document.removeEventListener("visibilitychange", handleWakeUp);
      window.removeEventListener("focus", handleWakeUp);
    };
  }, [inputDate, formData, setInputDate]);

  useEffect(() => {
    const savedDraft = localStorage.getItem("cyj_input_draft_v3");
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        if (parsed.formData) setFormData(parsed.formData);
        if (parsed.store) setSelectedStore(parsed.store);
        if (parsed.manager) setSelectedManager(parsed.manager);
        
        const draftDate = parsed.date;
        if (draftDate === getLocalTodayString()) {
           setInputDate(draftDate);
        }
      } catch (e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    const draft = { formData, store: selectedStore, manager: selectedManager, date: inputDate, timestamp: Date.now() };
    localStorage.setItem("cyj_input_draft_v3", JSON.stringify(draft));
  }, [formData, selectedStore, selectedManager, inputDate]);

  useEffect(() => {
    const op = parseNumber(formData.operationalAccrual);
    const skin = parseNumber(formData.skincareSales);
    setFormData(prev => {
      const total = op + skin;
      return parseNumber(prev.accrual) !== total ? { ...prev, accrual: formatNumber(total) } : prev;
    });
  }, [formData.operationalAccrual, formData.skincareSales]);

  const handleNumberChange = (key, value) => {
    const rawValue = value.replace(/,/g, "");
    if (!/^\d*$/.test(rawValue)) return;
    setFormData(prev => ({ ...prev, [key]: formatNumber(rawValue) }));
  };

  const availableStores = useMemo(() => {
    if (!selectedManager) {
      if (userRole === "store" && currentUser) {
        return (currentUser.stores || [currentUser.storeName]).map((s) => s.startsWith("CYJ") ? s : `CYJ${s}店`);
      }
      return [];
    }
    return (managers[selectedManager] || []).map((s) => `CYJ${s}店`);
  }, [selectedManager, managers, userRole, currentUser]);

  useEffect(() => {
    if (!selectedStore && userRole === "store" && currentUser) {
      const myStores = currentUser.stores || [currentUser.storeName];
      if (myStores.length > 0) {
        const shortName = myStores[0].replace("CYJ", "").replace("店", "");
        const foundMgr = Object.keys(managers).find((mgr) => managers[mgr].includes(shortName));
        if (foundMgr) setSelectedManager(foundMgr);
        const fullName = myStores[0].startsWith("CYJ") ? myStores[0] : `CYJ${myStores[0]}店`;
        setSelectedStore(fullName);
      }
    } else if (!selectedManager && userRole === "manager" && currentUser) {
      setSelectedManager(currentUser.name);
    }
  }, [userRole, currentUser, managers]);

  const handleReset = () => {
    if (confirm("確定要重置嗎？")) {
      setFormData(defaultFormData);
      localStorage.removeItem("cyj_input_draft_v3");
      showToast("表格已重置", "info");
    }
  };

  const handlePreSubmit = (e) => {
    e.preventDefault();
    if (!selectedStore) return showToast("請選擇店家", "error");
    if (inputDate > today) return showToast("不可提交未來日期", "error");

    const formattedInputDate = toStandardDateFormat(inputDate);
    const existingReport = rawData.find((d) => toStandardDateFormat(d.date) === formattedInputDate && d.storeName === selectedStore);
    setExistingReportId(existingReport ? existingReport.id : null);

    if (inputDate !== today) {
      setShowDateWarningModal(true);
    } else {
      setShowConfirmModal(true);
    }
  };

  const handleDateWarningConfirm = () => {
    setShowDateWarningModal(false);
    setShowConfirmModal(true);
  };

  const handleFinalSubmit = async () => {
    setIsSubmitting(true);
    try {
      const normalizedDate = toStandardDateFormat(inputDate);
      const payload = {
        date: normalizedDate,
        storeName: selectedStore,
        ...Object.keys(formData).reduce((acc, key) => ({ ...acc, [key]: parseNumber(formData[key]) }), {}),
        timestamp: serverTimestamp(),
        submittedBy: currentUser?.name || "unknown",
      };

      if (existingReportId) {
        await setDoc(doc(db, "artifacts", appId, "public", "data", "daily_reports", existingReportId), payload);
        logActivity(userRole, currentUser?.name, "更新日報(覆蓋)", `${selectedStore} ${normalizedDate}`);
      } else {
        await addDoc(collection(db, "artifacts", appId, "public", "data", "daily_reports"), payload);
        logActivity(userRole, currentUser?.name, "提交日報", `${selectedStore} ${normalizedDate}`);
      }

      setFormData(defaultFormData);
      localStorage.removeItem("cyj_input_draft_v3");
      setShowConfirmModal(false);
      setExistingReportId(null);
      showToast("提交成功", "success");
    } catch (err) {
      console.error(err);
      showToast("提交失敗", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderField = (key) => (
    <div key={key}>
      <label className={`block text-xs font-bold mb-1.5 ${key.includes('Refund') ? "text-rose-500" : "text-stone-500"}`}>
        {LABELS[key] || key}
      </label>
      <input 
        type="text" 
        value={formData[key]} 
        onChange={(e) => handleNumberChange(key, e.target.value)} 
        readOnly={key === "accrual"} 
        placeholder="0" 
        inputMode="numeric" 
        className={`w-full border-2 p-3 rounded-xl outline-none font-bold transition-all ${
          key === "accrual" 
            ? "bg-stone-100 text-stone-500 cursor-not-allowed border-stone-100" 
            : "border-stone-100 focus:border-amber-400 focus:shadow-sm focus:bg-white bg-stone-50/50"
        }`} 
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 p-2 rounded-lg justify-center">
         <CheckCircle size={14} /> 店務日報：輸入內容將自動暫存
      </div>

      <div className="bg-white p-6 rounded-2xl border border-stone-100 shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-bold mb-1.5 text-stone-400 uppercase">回報日期</label>
          <SmartDatePicker selectedDate={inputDate} onDateSelect={setInputDate} stores={[]} salesData={[]} />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-bold mb-1.5 text-stone-400">區域</label>
            <div className="relative">
              <select value={selectedManager} onChange={(e) => { setSelectedManager(e.target.value); setSelectedStore(""); }} disabled={userRole !== "director"} className="w-full border-2 border-stone-100 p-3 rounded-xl font-bold text-stone-700 bg-white disabled:bg-stone-50 outline-none focus:border-amber-400 appearance-none">
                <option value="">請選擇...</option>
                {Object.keys(managers).map((m) => <option key={m} value={m}>{m}區</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5 text-stone-400">店家</label>
            <div className="relative">
              <select value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} disabled={!selectedManager} className="w-full border-2 border-stone-100 p-3 rounded-xl font-bold text-stone-700 bg-white disabled:bg-stone-50 outline-none focus:border-amber-400 appearance-none">
                <option value="">請選擇...</option>
                {availableStores.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-lg space-y-8">
        <div className="flex items-center gap-2 pb-2 border-b border-stone-100">
           <FileText size={20} className="text-amber-500" /> 
           <h3 className="font-bold text-stone-700 text-lg">店務數據回報</h3>
        </div>
        
        <div>
          <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Layers size={14}/> 核心業績數據
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {renderField("cash")}
            {renderField("accrual")}
            {renderField("operationalAccrual")}
            {renderField("skincareSales")}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Users size={14}/> 新客與客流
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {renderField("newCustomerSales")}
            {renderField("traffic")}
            {renderField("newCustomers")}
            {renderField("newCustomerClosings")}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold text-rose-300 uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-rose-50 pb-1 w-full">
            <TrendingDown size={14}/> 退費資訊 (若無則留白)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {renderField("refund")}
            {renderField("skincareRefund")}
          </div>
        </div>

        <div className="flex gap-4 pt-4 border-t border-stone-100">
          <button onClick={handleReset} className="px-6 py-4 bg-stone-100 text-stone-500 rounded-xl hover:bg-stone-200 transition-colors">
            <RotateCcw size={20} />
          </button>
          <button onClick={handlePreSubmit} disabled={isSubmitting} className="flex-1 bg-stone-800 text-white py-4 rounded-xl font-bold shadow-xl hover:bg-stone-900 transition-all active:scale-95 disabled:opacity-70">
            {isSubmitting ? <Activity className="animate-spin mx-auto"/> : "提交日報"}
          </button>
        </div>
      </div>

      {showDateWarningModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-stone-900/80 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 border-4 border-rose-100">
            <div className="bg-rose-500 p-6 flex flex-col items-center text-center">
              <div className="bg-white/20 p-3 rounded-full mb-3">
                <Calendar size={32} className="text-white"/>
              </div>
              <h3 className="text-white text-xl font-extrabold tracking-wide">日期確認</h3>
            </div>
            <div className="p-6 space-y-6 text-center">
              <div>
                <p className="text-stone-500 font-bold mb-1">您選擇的回報日期是</p>
                <p className="text-3xl font-mono font-black text-rose-600">{inputDate}</p>
              </div>
              
              <div className="bg-rose-50 p-4 rounded-xl border border-rose-100 text-left">
                <p className="flex items-start gap-2 text-rose-800 text-sm font-bold">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5"/>
                  <span>
                    系統偵測到此日期 <u>並非今天</u> ({today})。
                    {existingReportId && (
                      <span className="block mt-2 pt-2 border-t border-rose-200 text-rose-600">
                        ⚠️ 注意：該日期已有日報紀錄，繼續提交將會 <span className="underline font-black">覆蓋舊資料</span>！
                      </span>
                    )}
                  </span>
                </p>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setShowDateWarningModal(false)} 
                  className="flex-1 py-3.5 bg-stone-100 text-stone-500 rounded-xl font-bold hover:bg-stone-200 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={handleDateWarningConfirm} 
                  className="flex-1 py-3.5 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 shadow-lg shadow-rose-200 transition-all active:scale-95"
                >
                  確認日期無誤
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showConfirmModal && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
            <div className="bg-amber-400 p-4 flex justify-between items-center"><h3 className="text-white font-bold flex gap-2"><AlertCircle/> 確認提交</h3><button onClick={()=>setShowConfirmModal(false)}><X className="text-white"/></button></div>
            <div className="p-6 space-y-4">
              <div className="bg-stone-50 p-4 rounded-xl space-y-2">
                 <div className="flex justify-between font-bold text-stone-700"><span>日期</span><span>{inputDate}</span></div>
                 <div className="flex justify-between font-bold text-stone-700"><span>店家</span><span>{selectedStore}</span></div>
                 <div className="flex justify-between font-bold text-amber-600 border-t pt-2"><span>現金業績</span><span>${formData.cash}</span></div>
                 <div className="flex justify-between font-bold text-indigo-600"><span>總權責</span><span>${formData.accrual}</span></div>
              </div>
              {existingReportId && <p className="text-xs text-rose-500 font-bold bg-rose-50 p-2 rounded">⚠️ 提醒：資料將覆蓋當日舊紀錄。</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={()=>setShowConfirmModal(false)} className="flex-1 py-3 border rounded-xl font-bold text-stone-500 hover:bg-stone-50">返回</button>
                <button onClick={handleFinalSubmit} className="flex-1 py-3 bg-stone-800 text-white rounded-xl font-bold hover:bg-stone-900">確認提交</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// ★★★ 子元件 B: 管理師專用輸入介面 (TherapistInputView) - 修正欄位名稱 ★★★
// ============================================================================
const TherapistInputView = () => {
  const { currentUser, inputDate, setInputDate, showToast, logActivity } = useContext(AppContext);
  
  const defaultPersonalData = {
    totalRevenue: "",        // 1. 今日總業績 (新+舊-退)
    newCustomerRevenue: "",  // 2. 今日新客業績
    newCustomerCount: "",    // 3. 今日新客人數
    newCustomerClosings: "", // 4. 今日新客留單人數 (變數名不變，僅改 UI Label)
    oldCustomerRevenue: "",  // 5. 今日舊客業績
    oldCustomerCount: "",    // 6. 今日舊客人數
    returnRevenue: "",       // 7. 今日當月退費業績
  };
  
  const [formData, setFormData] = useState(defaultPersonalData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmittedToday, setHasSubmittedToday] = useState(false);

  // 視窗狀態
  const [showConfirmModal, setShowConfirmModal] = useState(false); 
  const [showDateWarningModal, setShowDateWarningModal] = useState(false); 

  const [debugInfo, setDebugInfo] = useState(null);

  // ★ 更新：修改標籤名稱
  const LABELS = {
    totalRevenue: "今日總業績 (新客+舊客-退費)", 
    newCustomerRevenue: "新客業績",
    newCustomerCount: "新客人數",
    newCustomerClosings: "新客留單人數", // ★ 更新為「留單」
    oldCustomerRevenue: "舊客業績",
    oldCustomerCount: "舊客人數",
    returnRevenue: "今日當月退費業績", 
  };

  const today = getLocalTodayString();

  // 喚醒監聽
  useEffect(() => {
    const handleWakeUp = () => {
      if (document.visibilityState === "visible" || document.hasFocus()) {
        const realToday = getLocalTodayString();
        const isFormEmpty = !formData.newCustomerRevenue && !formData.oldCustomerRevenue;
        
        if (inputDate !== realToday && isFormEmpty) {
           console.log(`[系統喚醒] 日期校正: ${inputDate} -> ${realToday}`);
           setInputDate(realToday);
        }
      }
    };

    document.addEventListener("visibilitychange", handleWakeUp);
    window.addEventListener("focus", handleWakeUp);
    
    return () => {
      document.removeEventListener("visibilitychange", handleWakeUp);
      window.removeEventListener("focus", handleWakeUp);
    };
  }, [inputDate, formData, setInputDate]);

  // 暫存讀取
  useEffect(() => {
    const savedDraft = localStorage.getItem("cyj_therapist_draft_v2"); 
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        if (parsed.formData) setFormData(parsed.formData);
        
        const draftDate = parsed.date;
        if (draftDate === getLocalTodayString()) {
           setInputDate(draftDate);
        }
      } catch (e) { console.error(e); }
    }
  }, []);

  // 寫入暫存
  useEffect(() => {
    const draft = { formData, date: inputDate, timestamp: Date.now() };
    localStorage.setItem("cyj_therapist_draft_v2", JSON.stringify(draft));
  }, [formData, inputDate]);

  // 自動計算總業績
  useEffect(() => {
    const newRev = parseNumber(formData.newCustomerRevenue) || 0;
    const oldRev = parseNumber(formData.oldCustomerRevenue) || 0;
    const returnRev = parseNumber(formData.returnRevenue) || 0; 
    const total = newRev + oldRev - returnRev; 
    
    if (parseNumber(formData.totalRevenue) !== total) {
      setFormData(prev => ({ ...prev, totalRevenue: formatNumber(total) }));
    }
  }, [formData.newCustomerRevenue, formData.oldCustomerRevenue, formData.returnRevenue]); 

  useEffect(() => {
    const checkSubmission = async () => {
      if (!currentUser?.id) return;
      try {
        const normalizedDate = toStandardDateFormat(inputDate);
        const safeDate = normalizedDate.replace(/\//g, "-");
        const docId = `${safeDate}_${currentUser.id}`;
        
        const docRef = doc(db, "artifacts", appId, "public", "data", "therapist_daily_reports", docId);
        const docSnap = await getDocFromServer(docRef);
        setHasSubmittedToday(docSnap.exists());
      } catch (e) {
        console.error("檢查重複提交失敗", e);
      }
    };
    checkSubmission();
  }, [inputDate, currentUser]);

  const handleNumberChange = (key, value) => {
    const rawValue = value.replace(/,/g, "");
    if (!/^\d*$/.test(rawValue)) return;
    setFormData(prev => ({ ...prev, [key]: formatNumber(rawValue) }));
  };

  const handlePreSubmit = () => {
    const hasData = formData.newCustomerRevenue || formData.oldCustomerRevenue || formData.newCustomerCount || formData.oldCustomerCount || formData.returnRevenue;
    if (!hasData) return showToast("請至少輸入一項業績或人數數據", "error");
    
    if (inputDate !== today) {
      setShowDateWarningModal(true);
    } else {
      setShowConfirmModal(true);
    }
  };

  const handleDateWarningConfirm = () => {
    setShowDateWarningModal(false);
    setShowConfirmModal(true);
  };

  const handleFinalSubmit = async () => {
    setIsSubmitting(true);
    setDebugInfo(null); 

    try {
      if (!currentUser || !currentUser.id) {
        throw new Error("目前使用者 ID 無法辨識，請重新登入！");
      }

      const normalizedDate = toStandardDateFormat(inputDate);
      const safeDate = normalizedDate.replace(/\//g, "-");
      const docId = `${safeDate}_${currentUser.id}`;
      
      const payload = {
        date: normalizedDate, 
        therapistId: currentUser.id,
        therapistName: currentUser.name,
        storeName: currentUser.store || "未註記店家", 
        
        totalRevenue: parseNumber(formData.totalRevenue),
        newCustomerRevenue: parseNumber(formData.newCustomerRevenue),
        newCustomerCount: parseNumber(formData.newCustomerCount),
        newCustomerClosings: parseNumber(formData.newCustomerClosings),
        oldCustomerRevenue: parseNumber(formData.oldCustomerRevenue),
        oldCustomerCount: parseNumber(formData.oldCustomerCount),
        returnRevenue: parseNumber(formData.returnRevenue),
        
        updatedAt: serverTimestamp(),
      };

      const docRef = doc(db, "artifacts", appId, "public", "data", "therapist_daily_reports", docId);
      
      await setDoc(docRef, payload);
      
      const verifySnap = await getDocFromServer(docRef);
      
      if (verifySnap.exists()) {
        logActivity("therapist", currentUser.name, "個人日報提交", `${normalizedDate} 業績`);
        showToast("提交成功！", "success");
        setHasSubmittedToday(true);
        setFormData(defaultPersonalData);
        localStorage.removeItem("cyj_therapist_draft_v2");
        setShowConfirmModal(false); 
      } else {
        throw new Error("寫入失敗，雲端查無資料。");
      }

    } catch (e) {
      console.error("提交過程發生錯誤:", e);
      setDebugInfo({
        error: e.message,
        code: e.code || "unknown",
        path: `artifacts/${appId}/.../therapist_daily_reports`,
      });
      showToast("提交失敗", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6 pb-20">
      <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-2xl font-bold flex items-center gap-2 mb-1">
            <User className="text-indigo-200" /> {currentUser?.name} 您好
          </h2>
          <p className="text-indigo-100 text-sm opacity-90">
            所屬店家：{currentUser?.store || "未綁定 (請重新登入)"}店
          </p>
        </div>
        <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none">
          <Star size={120} />
        </div>
      </div>

      <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 flex justify-between items-center">
         <span className="text-stone-500 font-bold text-sm">回報日期</span>
         <div className="relative">
            <input 
              type="date" 
              value={inputDate} 
              max={new Date().toISOString().split("T")[0]}
              onChange={(e) => setInputDate(e.target.value)}
              className="bg-white border border-stone-300 rounded-lg px-3 py-1 font-mono font-bold text-stone-700 outline-none focus:border-indigo-500"
            />
         </div>
      </div>

      {hasSubmittedToday && (
        <div className="bg-emerald-50 text-emerald-600 p-3 rounded-xl text-sm font-bold flex items-center gap-2 border border-emerald-100">
          <CheckCircle size={16}/> 您已完成今日 ({inputDate}) 的回報。
        </div>
      )}

      {debugInfo && (
        <div className="bg-rose-50 border-l-4 border-rose-500 p-4 rounded-r-xl space-y-2 animate-in slide-in-from-top-2">
          <h3 className="text-rose-800 font-bold flex items-center gap-2"><Bug/> 提交失敗</h3>
          <p className="text-rose-700 text-sm font-bold">{debugInfo.error}</p>
        </div>
      )}

      <Card title="個人績效回報">
        <div className="space-y-6">
          
          {/* 1. 總業績 (唯讀) */}
          <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
             <label className="text-xs font-bold text-indigo-500 mb-1 flex items-center gap-1">
                <Calculator size={12}/> {LABELS.totalRevenue} (自動加總)
             </label>
             <div className="relative">
                <DollarSign size={18} className="absolute left-3 top-3.5 text-indigo-400"/>
                <input 
                  type="text" 
                  value={formData.totalRevenue} 
                  readOnly 
                  className="w-full pl-10 pr-3 py-3 border-2 border-indigo-200 rounded-xl font-mono text-2xl font-bold text-indigo-700 bg-white outline-none" 
                  placeholder="0"
                />
             </div>
          </div>

          {/* 2. 新客數據區 */}
          <div>
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Star size={12}/> 新客數據
            </h4>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-bold text-stone-500 mb-1 block">{LABELS.newCustomerRevenue}</label>
                    <input type="text" value={formData.newCustomerRevenue} onChange={(e) => handleNumberChange("newCustomerRevenue", e.target.value)} placeholder="0" className="w-full border-2 p-3 rounded-xl font-bold text-amber-600 focus:border-amber-400 outline-none" inputMode="numeric"/>
                </div>
                <div>
                    <label className="text-xs font-bold text-stone-500 mb-1 block">{LABELS.newCustomerCount}</label>
                    <input type="text" value={formData.newCustomerCount} onChange={(e) => handleNumberChange("newCustomerCount", e.target.value)} placeholder="0" className="w-full border-2 p-3 rounded-xl font-bold text-stone-700 focus:border-amber-400 outline-none" inputMode="numeric"/>
                </div>
                <div className="col-span-2">
                    <label className="text-xs font-bold text-stone-500 mb-1 block">{LABELS.newCustomerClosings}</label>
                    <input type="text" value={formData.newCustomerClosings} onChange={(e) => handleNumberChange("newCustomerClosings", e.target.value)} placeholder="0" className="w-full border-2 p-3 rounded-xl font-bold text-stone-700 focus:border-amber-400 outline-none" inputMode="numeric"/>
                </div>
            </div>
          </div>

          {/* 3. 舊客數據區 */}
          <div>
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Users size={12}/> 舊客數據
            </h4>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-bold text-stone-500 mb-1 block">{LABELS.oldCustomerRevenue}</label>
                    <input type="text" value={formData.oldCustomerRevenue} onChange={(e) => handleNumberChange("oldCustomerRevenue", e.target.value)} placeholder="0" className="w-full border-2 p-3 rounded-xl font-bold text-indigo-600 focus:border-indigo-400 outline-none" inputMode="numeric"/>
                </div>
                <div>
                    <label className="text-xs font-bold text-stone-500 mb-1 block">{LABELS.oldCustomerCount}</label>
                    <input type="text" value={formData.oldCustomerCount} onChange={(e) => handleNumberChange("oldCustomerCount", e.target.value)} placeholder="0" className="w-full border-2 p-3 rounded-xl font-bold text-stone-700 focus:border-indigo-400 outline-none" inputMode="numeric"/>
                </div>
            </div>
          </div>

          {/* 4. 退費 */}
          <div>
             <label className="text-xs font-bold text-rose-500 mb-1 block flex items-center gap-1"><TrendingDown size={12}/> {LABELS.returnRevenue}</label>
             <input type="text" value={formData.returnRevenue} onChange={(e) => handleNumberChange("returnRevenue", e.target.value)} placeholder="0" className="w-full border-2 p-3 rounded-xl font-bold text-rose-600 border-rose-100 focus:border-rose-400 outline-none mb-4" inputMode="numeric"/>
          </div>

          <button onClick={handlePreSubmit} disabled={isSubmitting} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50">
            {isSubmitting ? <Activity className="animate-spin"/> : <Upload size={20}/>}
            提交個人日報
          </button>
        </div>
      </Card>

      {/* 日期警示視窗 */}
      {showDateWarningModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-stone-900/80 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 border-4 border-rose-100">
            <div className="bg-rose-500 p-6 flex flex-col items-center text-center">
              <div className="bg-white/20 p-3 rounded-full mb-3">
                <Calendar size={32} className="text-white"/>
              </div>
              <h3 className="text-white text-xl font-extrabold tracking-wide">日期確認</h3>
            </div>
            <div className="p-6 space-y-6 text-center">
              <div>
                <p className="text-stone-500 font-bold mb-1">您選擇的回報日期是</p>
                <p className="text-3xl font-mono font-black text-rose-600">{inputDate}</p>
              </div>
              
              <div className="bg-rose-50 p-4 rounded-xl border border-rose-100 text-left">
                <p className="flex items-start gap-2 text-rose-800 text-sm font-bold">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5"/>
                  <span>
                    系統偵測到此日期 <u>並非今天</u> ({today})。
                    {hasSubmittedToday && (
                      <span className="block mt-2 pt-2 border-t border-rose-200 text-rose-600">
                        ⚠️ 注意：該日期已有您的回報紀錄，繼續提交將會 <span className="underline font-black">覆蓋舊資料</span>！
                      </span>
                    )}
                  </span>
                </p>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setShowDateWarningModal(false)} 
                  className="flex-1 py-3.5 bg-stone-100 text-stone-500 rounded-xl font-bold hover:bg-stone-200 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={handleDateWarningConfirm} 
                  className="flex-1 py-3.5 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 shadow-lg shadow-rose-200 transition-all active:scale-95"
                >
                  確認日期無誤
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 資料確認視窗 */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
            <div className="bg-indigo-600 p-4 flex justify-between items-center">
              <h3 className="text-white font-bold flex gap-2"><AlertCircle/> 確認提交</h3>
              <button onClick={()=>setShowConfirmModal(false)}><X className="text-white"/></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-stone-50 p-4 rounded-xl space-y-2 text-sm">
                 <div className="flex justify-between font-bold text-stone-700"><span>日期</span><span>{inputDate}</span></div>
                 <div className="flex justify-between font-bold text-stone-700"><span>人員</span><span>{currentUser?.name}</span></div>
                 
                 <div className="border-t border-stone-200 my-2 pt-2 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-stone-500">今日總業績</span>
                      <span className="font-mono font-bold text-indigo-600 text-lg">${formData.totalRevenue || 0}</span>
                    </div>
                    <div className="flex justify-between text-xs text-stone-400 pl-2">
                      <span>(新客 ${formData.newCustomerRevenue || 0} + 舊客 ${formData.oldCustomerRevenue || 0})</span>
                    </div>
                    
                    <div className="flex justify-between mt-2">
                      <span className="text-stone-500">退費業績</span>
                      <span className="font-mono font-bold text-rose-500">${formData.returnRevenue || 0}</span>
                    </div>
                 </div>
              </div>
              
              {hasSubmittedToday && (
                <p className="text-xs text-rose-500 font-bold bg-rose-50 p-2 rounded flex items-center gap-1">
                  <AlertTriangle size={12}/> 提醒：資料將覆蓋當日舊紀錄。
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={()=>setShowConfirmModal(false)} className="flex-1 py-3 border rounded-xl font-bold text-stone-500 hover:bg-stone-50">返回</button>
                <button onClick={handleFinalSubmit} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-md">確認提交</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

const InputView = () => {
  const { userRole } = useContext(AppContext);
  return (
    <ViewWrapper>
      {userRole === "therapist" ? <TherapistInputView /> : <StoreInputView />}
    </ViewWrapper>
  );
};

export default InputView;