// src/components/TherapistManagerView.jsx
import React, { useState, useContext, useMemo } from "react";
import { 
  UserCheck, Archive, Search, Plus, Edit2, X, Key, Calendar, 
  UserX, User, Store, Trash2 
} from "lucide-react";
import { doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

import { db } from "../config/firebase";
import { AppContext } from "../AppContext";
import { ViewWrapper } from "./SharedUI";
import SmartDatePicker from "./SmartDatePicker";
import { formatLocalYYYYMMDD } from "../utils/helpers";

const TherapistManagerView = () => {
  const { 
    therapists, 
    managers, 
    showToast, 
    getCollectionPath 
  } = useContext(AppContext);

  // --- 狀態控制 ---
  const [showResigned, setShowResigned] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // --- 表單控制 ---
  const [isAddingTherapist, setIsAddingTherapist] = useState(false);
  const [editingTherapist, setEditingTherapist] = useState(null);

  const [formManager, setFormManager] = useState("");
  const [formStore, setFormStore] = useState("");
  const [formName, setFormName] = useState("");
  const [formPassword, setFormPassword] = useState("0000");
  const [formOnboardDate, setFormOnboardDate] = useState("");
  const [formResignDate, setFormResignDate] = useState("");

  const getTodayStr = () => formatLocalYYYYMMDD(new Date());

  // --- 資料篩選邏輯 ---
  const availableStoresForTherapist = useMemo(() => {
    if (!formManager || !managers) return [];
    return managers[formManager] || [];
  }, [formManager, managers]);

  const filteredTherapists = useMemo(() => {
    let list = therapists || [];

    // 1. 過濾 在職/離職狀態
    list = list.filter(t => {
      const isArchived = t.isResigned === true || t.status === 'resigned' || t.status === '離職';
      return showResigned ? isArchived : !isArchived;
    });

    // 2. 關鍵字過濾
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      list = list.filter(t => 
        (t.name || "").toLowerCase().includes(q) || 
        (t.id || "").toLowerCase().includes(q) ||
        (t.store || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [therapists, showResigned, searchTerm]);

  // --- 動作處理函式 ---
  const openAddTherapist = () => {
    setEditingTherapist(null);
    setFormManager("");
    setFormStore("");
    setFormName("");
    setFormPassword("0000");
    setFormOnboardDate(getTodayStr());
    setFormResignDate("");
    setIsAddingTherapist(true);
  };

  const openEdit = (t) => {
    setEditingTherapist(t);
    // 反查該店隸屬哪個區長
    let foundManager = "";
    if (managers) {
      for (const [mgr, stores] of Object.entries(managers)) {
        if (stores.includes(t.store)) {
          foundManager = mgr;
          break;
        }
      }
    }
    setFormManager(foundManager);
    setFormStore(t.store || "");
    setFormName(t.name || "");
    setFormPassword(t.password || "");
    setFormOnboardDate(t.onboardDate || "");
    setFormResignDate(t.resignDate || "");
    setIsAddingTherapist(true);
  };

  const handleAddTherapist = async () => {
    if (!formStore || !formName.trim() || !formPassword.trim()) {
      showToast("請填寫完整人員資訊 (含門市、姓名與密碼)", "error");
      return;
    }
    
    // 自動產生帳號代號 ID
    const newId = `T${Date.now().toString().slice(-6)}`;

    try {
      const docRef = doc(db, getCollectionPath("therapists"), newId);
      await setDoc(docRef, {
        id: newId,
        name: formName.trim(),
        store: formStore,
        password: formPassword.trim(),
        onboardDate: formOnboardDate,
        resignDate: formResignDate,
        isActive: true,
        isResigned: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      showToast("新增人員成功", "success");
      setIsAddingTherapist(false);
    } catch (error) {
      showToast("新增失敗", "error");
    }
  };

  const handleUpdateTherapist = async () => {
    if (!editingTherapist || !formStore || !formName.trim()) {
      showToast("資料不完整", "error");
      return;
    }
    try {
      const docRef = doc(db, getCollectionPath("therapists"), editingTherapist.id);
      await setDoc(docRef, {
        name: formName.trim(),
        store: formStore,
        password: formPassword.trim(),
        onboardDate: formOnboardDate,
        resignDate: formResignDate,
        updatedAt: serverTimestamp()
      }, { merge: true });
      showToast("資料更新成功", "success");
      setIsAddingTherapist(false);
      setEditingTherapist(null);
    } catch (error) {
      showToast("更新失敗", "error");
    }
  };

  const toggleStatus = async (t) => {
    const isArchived = t.isResigned === true || t.status === 'resigned' || t.status === '離職';
    const nextResigned = !isArchived;
    const actionName = nextResigned ? "暫停帳號並封存" : "重新啟用帳號";

    if (window.confirm(`確定要${actionName}「${t.name}」嗎？`)) {
      try {
        const docRef = doc(db, getCollectionPath("therapists"), t.id);
        await setDoc(docRef, { 
          isResigned: nextResigned, 
          status: nextResigned ? "離職" : "在職",
          isActive: !nextResigned,
          resignDate: nextResigned ? getTodayStr() : "",
          updatedAt: serverTimestamp() 
        }, { merge: true });
        showToast(`已${actionName}`, "success");
      } catch (error) {
        showToast("狀態更新失敗", "error");
      }
    }
  };

  const handleDeleteTherapist = async (id) => {
    if (window.confirm("警告：這是永久實體刪除，將無法復原！確定刪除嗎？")) {
      try {
        await deleteDoc(doc(db, getCollectionPath("therapists"), id));
        showToast("人員已永久刪除", "success");
      } catch (error) {
        showToast("刪除失敗", "error");
      }
    }
  };

  // ============================================================================
  // ★ UI 渲染區 (完全保留老闆的精美網格設計)
  // ============================================================================
  return (
    <ViewWrapper>
      <div className="space-y-6 w-full max-w-full min-w-0">
        
        {/* 1. 頂部控制列 */}
        <div className="bg-white p-2 rounded-2xl border border-stone-100 shadow-sm flex flex-col xl:flex-row gap-3 items-center justify-between">
          <div className="flex bg-stone-100/60 p-1 rounded-xl w-full xl:w-auto relative border border-stone-200/50">
            <div 
              className="absolute inset-y-1 w-[calc(50%-4px)] bg-white rounded-lg shadow-sm transition-transform duration-300 ease-out"
              style={{ transform: `translateX(${showResigned ? 'calc(100% + 4px)' : '4px'})` }}
            />
            <button 
              onClick={() => setShowResigned(false)} 
              className={`relative z-10 flex-1 xl:w-40 py-2.5 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${!showResigned ? 'text-stone-800' : 'text-stone-400 hover:text-stone-600'}`}
            >
              <UserCheck size={16} className={!showResigned ? "text-emerald-500" : ""} /> 在職戰力
            </button>
            <button 
              onClick={() => setShowResigned(true)} 
              className={`relative z-10 flex-1 xl:w-[200px] py-2.5 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${showResigned ? 'text-stone-800' : 'text-stone-400 hover:text-stone-600'}`}
            >
              <Archive size={16} className={showResigned ? "text-stone-600" : ""} /> 停權 / 封存庫
            </button>
          </div>

          <div className="flex w-full xl:w-auto gap-3">
            <div className="relative flex-1 xl:w-72">
              <Search className="absolute left-3.5 top-3 text-stone-400" size={18} />
              <input 
                type="text" 
                placeholder="搜尋姓名或店家..." 
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} 
                className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border-none rounded-xl outline-none focus:ring-2 focus:ring-amber-400 transition-all font-medium text-stone-700 placeholder-stone-400" 
              />
            </div>
            <button 
              onClick={openAddTherapist} 
              className="px-5 py-2.5 bg-stone-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-stone-700 transition-all shadow-md hover:shadow-lg active:scale-95 shrink-0"
            >
              <Plus size={18} /> 新增
            </button>
          </div>
        </div>

        {/* 2. 新增/編輯 彈出視窗 */}
        {(isAddingTherapist || editingTherapist) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 max-h-[90vh] overflow-y-auto border border-stone-200">
              <div className="bg-stone-50 px-6 py-4 border-b border-stone-100 flex justify-between items-center">
                <h3 className="font-bold text-lg text-stone-800 flex items-center gap-2">
                  {editingTherapist ? <Edit2 size={20} className="text-amber-500"/> : <Plus size={20} className="text-amber-500"/>}
                  {editingTherapist ? "編輯人員資料" : "新增管理師"}
                </h3>
                <button onClick={() => { setIsAddingTherapist(false); setEditingTherapist(null); }} className="text-stone-400 hover:text-stone-600 bg-white p-1 rounded-full shadow-sm"><X size={20}/></button>
              </div>
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-stone-400 block mb-1.5 uppercase tracking-wider">所屬區域</label>
                    <select value={formManager} onChange={(e) => { setFormManager(e.target.value); setFormStore(""); }} className="w-full px-4 py-3 border border-stone-200 rounded-xl font-bold bg-stone-50 outline-none focus:border-amber-400 focus:bg-white transition-colors appearance-none">
                      <option value="">選擇區域</option>
                      {Object.keys(managers || {}).map(m => <option key={m} value={m}>{m}區</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-stone-400 block mb-1.5 uppercase tracking-wider">配屬店家</label>
                    <select value={formStore} onChange={(e) => setFormStore(e.target.value)} className="w-full px-4 py-3 border border-stone-200 rounded-xl font-bold bg-stone-50 outline-none focus:border-amber-400 focus:bg-white transition-colors appearance-none disabled:opacity-50" disabled={!formManager}>
                      <option value="">選擇店家</option>
                      {availableStoresForTherapist.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-stone-400 block mb-1.5 uppercase tracking-wider">員工姓名</label>
                  <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full px-4 py-3 border border-stone-200 rounded-xl font-bold bg-stone-50 outline-none focus:border-amber-400 focus:bg-white transition-colors" placeholder="請輸入姓名" />
                </div>
                <div>
                  <label className="text-xs font-bold text-stone-400 block mb-1.5 uppercase tracking-wider flex items-center gap-1"><Key size={12}/> 登入密碼</label>
                  <input type="text" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} className="w-full px-4 py-3 border border-stone-200 rounded-xl font-mono bg-stone-50 outline-none focus:border-amber-400 focus:bg-white transition-colors" placeholder="預設 0000" />
                </div>
                
                <div className="grid grid-cols-2 gap-4 pt-1 border-t border-stone-100">
                  <div>
                    <label className="text-xs font-bold text-stone-400 block mb-1.5 uppercase tracking-wider flex items-center gap-1">
                      <Calendar size={12}/> 上線日 (生效日)
                    </label>
                    <SmartDatePicker selectedDate={formOnboardDate || getTodayStr()} onDateSelect={setFormOnboardDate} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-stone-400 block mb-1.5 uppercase tracking-wider flex items-center gap-1">
                      <Calendar size={12}/> 停權日 (選填)
                    </label>
                    <div className="relative">
                      <SmartDatePicker selectedDate={formResignDate || "未設定"} onDateSelect={setFormResignDate} />
                      {formResignDate && (
                        <button 
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFormResignDate(""); }} 
                          className="absolute right-[36px] top-1/2 -translate-y-1/2 p-1 text-stone-300 hover:text-rose-500 z-10 transition-colors bg-white rounded-full"
                          title="清除日期"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex gap-3">
                  <button onClick={() => { setIsAddingTherapist(false); setEditingTherapist(null); }} className="flex-1 py-3.5 bg-white border border-stone-200 text-stone-500 rounded-xl font-bold hover:bg-stone-50 transition-colors">取消</button>
                  <button onClick={editingTherapist ? handleUpdateTherapist : handleAddTherapist} className="flex-1 py-3.5 bg-stone-800 text-white rounded-xl font-bold hover:bg-stone-700 shadow-md transition-all active:scale-95">{editingTherapist ? "儲存修改" : "確認新增"}</button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* 3. 人員卡片列表區 (無資料 與 網格卡片) */}
        {filteredTherapists.length === 0 ? (
          <div className="text-center py-20 bg-white/50 rounded-3xl border border-stone-100 border-dashed">
            <div className="bg-stone-100/50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
              <UserX size={32} className="text-stone-300" />
            </div>
            <h3 className="text-lg font-bold text-stone-600 mb-1">{showResigned ? "查無停權資料" : "查無在職人員"}</h3>
            <p className="text-stone-400 text-sm">請嘗試更換搜尋關鍵字，或是新增人員。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredTherapists.map(t => {
              const isArchived = showResigned;
              return (
                <div key={t.id} className={`bg-white rounded-3xl p-5 border transition-all duration-300 relative group overflow-hidden ${isArchived ? 'border-stone-200 shadow-sm opacity-80 hover:opacity-100 bg-stone-50' : 'border-stone-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] hover:shadow-lg hover:-translate-y-0.5 hover:border-amber-200'}`}>
                  
                  <div className="absolute -right-4 -top-4 opacity-[0.02] group-hover:opacity-[0.06] transition-opacity duration-500 pointer-events-none">
                    <User size={120} />
                  </div>

                  <div className="relative z-10 flex flex-col h-full">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-500 text-[10px] font-bold tracking-wider">
                            <Store size={10}/> {t.store}店
                          </span>
                          {isArchived && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-stone-200/80 text-stone-500 text-[10px] font-bold tracking-wider border border-stone-300/50">
                              <Archive size={10}/> 帳號暫停
                            </span>
                          )}
                        </div>
                        <h3 className={`text-xl font-bold tracking-tight flex items-center gap-2 ${isArchived ? 'text-stone-600' : 'text-stone-800'}`}>
                          {t.name}
                        </h3>
                        <div className="text-[10px] font-mono text-stone-400 mt-1 flex flex-col gap-0.5">
                          {t.onboardDate && <span>上線: {t.onboardDate}</span>}
                          {t.resignDate && <span className="text-rose-400/80">停權: {t.resignDate}</span>}
                        </div>
                      </div>

                      <div className="flex gap-1 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => toggleStatus(t)} 
                          className={`p-2 rounded-xl transition-all ${!isArchived ? 'bg-stone-50 hover:bg-rose-50 text-stone-400 hover:text-rose-600' : 'bg-white border border-stone-200 hover:bg-emerald-50 text-stone-500 hover:text-emerald-600 shadow-sm'}`} 
                          title={!isArchived ? "暫停帳號 (適用離職/留停)" : "重新啟用帳號 (復職/歸隊)"}
                        >
                          {!isArchived ? <Archive size={16} strokeWidth={2.5}/> : <UserCheck size={16} strokeWidth={2.5}/>}
                        </button>
                        <button onClick={() => openEdit(t)} className={`p-2 rounded-xl transition-all ${isArchived ? 'bg-white border border-stone-200 shadow-sm' : 'bg-stone-50 hover:bg-amber-50'} text-stone-400 hover:text-amber-600`} title="編輯資料">
                          <Edit2 size={16} strokeWidth={2.5}/>
                        </button>
                      </div>
                    </div>

                    <div className="mt-auto pt-4 border-t border-stone-100/80 flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2 text-stone-400">
                        <div className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center">
                          <Key size={12} className="text-stone-500"/>
                        </div>
                        <span className="font-mono text-xs tracking-widest">{t.password}</span>
                      </div>
                      
                      <button onClick={() => handleDeleteTherapist(t.id)} className="p-1.5 text-stone-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="永久實體刪除 (危險)">
                        <Trash2 size={14}/>
                      </button>
                    </div>
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

export default TherapistManagerView;