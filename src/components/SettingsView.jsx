// src/components/SettingsView.jsx
import React, { useState, useContext, useEffect, useMemo } from "react";
import {
  Save, Plus, Trash2, Edit2, Edit, Lock, User, Store, Target,
  CheckCircle, AlertCircle, X, Shield, ChevronDown, Search,
  UserCheck, UserX, Key, Calendar, DollarSign, Users, LayoutGrid,
  Database, Activity, Clock, Archive, MoreVertical
} from "lucide-react";
import { 
  doc, setDoc, updateDoc, deleteField, collection, addDoc, deleteDoc, getDoc,
  serverTimestamp, arrayUnion, arrayRemove
} from "firebase/firestore";

import { db, appId } from "../config/firebase";
import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";
import { DEFAULT_PERMISSIONS, ALL_MENU_ITEMS } from "../constants/index";
import { generateUUID } from "../utils/helpers";
import SystemMaintenance from "./SystemMaintenance";

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DEFAULT_BENCHMARKS_INIT = {
  default: {
    financial: { min: 0.8, max: 1.2, label: "現權責比" }, 
    sales:     { min: 0.1, max: 0.45, label: "產品佔比" },
    loyalty:   { min: 0.5, max: 0.8, label: "舊客佔比" },
    mining:    { min: 0.8, max: 1.2, label: "舊客強度" },
    acquisition: { min: 0.8, max: 1.2, label: "新客含金" }
  },
  "伊啵": {
    financial: { min: 0.7, max: 1.1, label: "現權責比" },
    sales:     { min: 0.1, max: 0.40, label: "產品佔比" }, 
    loyalty:   { min: 0.3, max: 0.6, label: "舊客佔比" },
    mining:    { min: 0.8, max: 1.2, label: "舊客強度" },
    acquisition: { min: 0.8, max: 1.2, label: "新客含金" }
  }
};

const BENCHMARK_CATEGORIES = [
  { id: 'financial', title: '財務健康 (回收率)', sub: '現金佔權責比例 (建議 80% 以上)', type: 'percent', suffix: '%', step: 5 },
  { id: 'sales', title: '銷售結構 (產品比)', sub: '產品業績佔比 (建議 10%-45%)', type: 'percent', suffix: '%', step: 1 },
  { id: 'loyalty', title: '顧客黏著 (留客率)', sub: '舊客佔總客數比 (建議 50% 以上)', type: 'percent', suffix: '%', step: 1 },
  { id: 'mining', title: '客單挖掘 (舊客強度)', sub: '舊客客單是新客的幾% (建議 >100%)', type: 'percent', suffix: '%', step: 5 },
  { id: 'acquisition', title: '新客質量 (達標率)', sub: '新客客單達成目標的幾% (基準 100%)', type: 'percent', suffix: '%', step: 5 },
];

const SettingsView = () => {
  const {
    targets, setTargets, showToast, managers, storeAccounts,
    managerAuth, userRole, permissions, currentUser,
    therapists, therapistTargets, therapistSchedules,
    trainerAuth, handleUpdateTrainerAuth,
    getDocPath, getCollectionPath,
    currentBrand, securityConfig 
  } = useContext(AppContext);

  const [activeTab, setActiveTab] = useState("");
  const [localTargets, setLocalTargets] = useState(targets || {});
  const [localPermissions, setLocalPermissions] = useState(permissions || DEFAULT_PERMISSIONS);
  const [localManagers, setLocalManagers] = useState(managers || {});
  
  const [localSecurityConfig, setLocalSecurityConfig] = useState({
    enabled: true, timeoutMinutes: 3, warningSeconds: 15, exemptRoles: ["director", "master"]
  });

  const { brandKey, brandLabel } = useMemo(() => {
    let key = "default"; let label = "通用預設 (CYJ)";
    if (currentBrand) {
      const id = typeof currentBrand === 'string' ? currentBrand : (currentBrand.id || "CYJ");
      const normalizedId = id.toLowerCase();
      if (normalizedId.includes("anniu") || normalizedId.includes("anew")) { key = "安妞"; label = "安妞"; } 
      else if (normalizedId.includes("yibo")) { key = "伊啵"; label = "伊啵"; }
    }
    return { brandKey: key, brandLabel: label };
  }, [currentBrand]);

  useEffect(() => { if (managers) setLocalManagers(managers); }, [managers]);
  useEffect(() => { if (permissions) setLocalPermissions(permissions); }, [permissions]);
  useEffect(() => { 
    if (targets) { setLocalTargets(prev => ({ ...prev, ...targets, benchmarks: targets.benchmarks || DEFAULT_BENCHMARKS_INIT })); }
  }, [targets]);
  
  useEffect(() => {
    if (securityConfig) setLocalSecurityConfig(securityConfig);
  }, [securityConfig]);

  const [newStoreAccount, setNewStoreAccount] = useState({ name: "", password: "", stores: "" });
  const [editingStoreAccount, setEditingStoreAccount] = useState(null);
  const [editStoreForm, setEditStoreForm] = useState({ name: "", password: "", stores: [] });
  const [newManager, setNewManager] = useState({ name: "", password: "" });
  const [editingManager, setEditingManager] = useState(null);
  const [editingManagerStores, setEditingManagerStores] = useState([]);
  const [newShop, setNewShop] = useState({ name: "", manager: "" });
  const [isAddingTherapist, setIsAddingTherapist] = useState(false);
  const [editingTherapist, setEditingTherapist] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formManager, setFormManager] = useState("");
  const [formStore, setFormStore] = useState("");
  const [formName, setFormName] = useState("");
  const [formPassword, setFormPassword] = useState("0000");
  
  const [formOnboardDate, setFormOnboardDate] = useState("");
  const [formResignDate, setFormResignDate] = useState("");
  
  const [newTrainerPass, setNewTrainerPass] = useState("");
  
  const [showResigned, setShowResigned] = useState(false);

  const UNASSIGNED_KEY = "未分配"; 

  const visibleTabs = useMemo(() => {
    const tabs = [];
    const myPerms = permissions?.[userRole] || [];
    const allTabsDefinition = [
      { id: "kpi", label: "KPI 參數", isAdminOnly: true, icon: Target },
      { id: "health", label: "體質診斷", isAdminOnly: true, icon: Activity },
      { id: "permissions", label: "權限與資安", isAdminOnly: true, icon: Shield },
      { id: "trainer-account", label: "教專帳號", isAdminOnly: true, icon: Users }, 
      { id: "shops", label: "店家管理", isAdminOnly: true, icon: Store },
      { id: "stores", label: "店經理帳號", isAdminOnly: true, icon: UserCheck },
      { id: "managers", label: "組織架構", isAdminOnly: true, icon: LayoutGrid },
      { id: "therapists", label: "人員帳號", isAdminOnly: true, icon: User },
      { id: "maintenance", label: "系統維護", isAdminOnly: true, icon: Database }
    ];
    allTabsDefinition.forEach(tab => {
      if (userRole === 'director') tabs.push(tab);
      else if (!tab.isAdminOnly && tab.permissionId && myPerms.includes(tab.permissionId)) tabs.push(tab);
    });
    return tabs;
  }, [userRole, permissions]);

  useEffect(() => {
    if (visibleTabs.length > 0) {
      const isCurrentTabValid = visibleTabs.some(t => t.id === activeTab);
      if (!activeTab || !isCurrentTabValid) setActiveTab(visibleTabs[0].id);
    }
  }, [visibleTabs, activeTab]);

  const managerEntries = useMemo(() => {
    const currentManagers = localManagers || {};
    const entries = Object.entries(currentManagers);
    const hasUnassigned = entries.some(([key]) => key === UNASSIGNED_KEY);
    if (!hasUnassigned) entries.push([UNASSIGNED_KEY, []]);
    return entries.sort((a, b) => {
      if (a[0] === UNASSIGNED_KEY) return 1; 
      if (b[0] === UNASSIGNED_KEY) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [localManagers]);

  const handleUpdateTrainer = async () => { if (!newTrainerPass) return showToast("請輸入新密碼", "error"); const success = await handleUpdateTrainerAuth(newTrainerPass); if (success) { showToast("教專密碼已更新", "success"); setNewTrainerPass(""); } else { showToast("更新失敗", "error"); } };
  const handleSaveTargets = async () => { try { await setDoc(getDocPath("kpi_targets"), localTargets); setTargets(localTargets); showToast("設定已儲存", "success"); } catch (e) { showToast("儲存失敗", "error"); } };
  const handleSavePermissions = async () => { try { await setDoc(getDocPath("permissions"), localPermissions); showToast("權限設定已更新", "success"); } catch (e) { showToast("更新失敗", "error"); } };
  const togglePermission = (role, menuId) => { const current = localPermissions[role] || []; const updated = current.includes(menuId) ? current.filter((id) => id !== menuId) : [...current, menuId]; setLocalPermissions({ ...localPermissions, [role]: updated }); };
  
  const handleSaveSecurityConfig = async () => { 
    try { 
      await setDoc(getDocPath("security_config"), localSecurityConfig); 
      showToast("資安與登入控管已更新", "success"); 
    } catch (e) { showToast("更新失敗", "error"); } 
  };

  const handleBenchmarkChange = (categoryId, field, value, type) => {
    let numValue = parseFloat(value);
    if (isNaN(numValue)) numValue = 0;
    if (type === 'percent') numValue = numValue / 100;
    setLocalTargets(prev => ({ ...prev, benchmarks: { ...prev.benchmarks, [brandKey]: { ...(prev.benchmarks?.[brandKey] || DEFAULT_BENCHMARKS_INIT["default"]), [categoryId]: { ...(prev.benchmarks?.[brandKey]?.[categoryId] || DEFAULT_BENCHMARKS_INIT["default"][categoryId]), [field]: numValue } } } }));
  };

  const handleAddGlobalStore = async () => { if (!newShop.name || !newShop.manager) return showToast("請輸入完整資訊", "error"); try { const targetManager = newShop.manager; const docRef = getDocPath("org_structure"); const docSnap = await getDoc(docRef); let newManagers = docSnap.exists() ? { ...docSnap.data().managers } : {}; if (!newManagers[targetManager]) newManagers[targetManager] = []; if (!newManagers[targetManager].includes(newShop.name)) { newManagers[targetManager].push(newShop.name); } await setDoc(docRef, { managers: newManagers }); setLocalManagers(newManagers); setNewShop({ name: "", manager: "" }); showToast("已新增", "success"); } catch (e) { showToast("失敗: " + e.message, "error"); } };
  const handleDeleteGlobalStore = async (storeName, managerName) => { const isPermanentDelete = managerName === UNASSIGNED_KEY; if(!confirm(isPermanentDelete ? "確定永久刪除此店家？" : "確定將此店家移至『未分配』名單？")) return; try { const docRef = getDocPath("org_structure"); const docSnap = await getDoc(docRef); if (!docSnap.exists()) throw new Error("讀取設定檔失敗"); let newManagers = JSON.parse(JSON.stringify(docSnap.data().managers || {})); if (Array.isArray(newManagers[managerName])) { newManagers[managerName] = newManagers[managerName].filter(x => x !== storeName); } if (!isPermanentDelete) { if (!Array.isArray(newManagers[UNASSIGNED_KEY])) { newManagers[UNASSIGNED_KEY] = []; } if (!newManagers[UNASSIGNED_KEY].includes(storeName)) { newManagers[UNASSIGNED_KEY].push(storeName); } } await setDoc(docRef, { managers: newManagers }); setLocalManagers(newManagers); showToast(isPermanentDelete ? "已永久刪除" : "已移至未分配", "success"); } catch(e) { console.error(e); showToast("失敗: " + e.message, "error"); } };
  const handleSaveManagerStores = async (name) => { try { const docRef = getDocPath("org_structure"); const docSnap = await getDoc(docRef); let newManagers = docSnap.exists() ? JSON.parse(JSON.stringify(docSnap.data().managers)) : {}; const newStores = editingManagerStores; const originalStores = newManagers[name] || []; const removedStores = originalStores.filter(s => !newStores.includes(s)); const addedStores = newStores.filter(s => !originalStores.includes(s)); newManagers[name] = newStores; if (!Array.isArray(newManagers[UNASSIGNED_KEY])) { newManagers[UNASSIGNED_KEY] = []; } removedStores.forEach(s => { if (!newManagers[UNASSIGNED_KEY].includes(s)) newManagers[UNASSIGNED_KEY].push(s); }); newManagers[UNASSIGNED_KEY] = newManagers[UNASSIGNED_KEY].filter(s => !addedStores.includes(s)); await setDoc(docRef, { managers: newManagers }); setLocalManagers(newManagers); setEditingManager(null); showToast("已更新", "success"); } catch(e){ showToast("失敗", "error"); } };
  const availableUnassignedStores = useMemo(() => { const all = Object.values(localManagers || {}).flat(); const assigned = storeAccounts.flatMap(a=>a.stores||[]); return all.filter(s=>!assigned.includes(s)).sort(); }, [localManagers, storeAccounts]);
  const availableStoresForManagerEdit = useMemo(() => { return (localManagers && localManagers[UNASSIGNED_KEY]) ? localManagers[UNASSIGNED_KEY].sort() : []; }, [localManagers]);
  const availableStoresForEditing = useMemo(() => { const all = Object.values(localManagers || {}).flat(); const assigned = storeAccounts.filter(a=>a.id!==editingStoreAccount?.id).flatMap(a=>a.stores||[]); return all.filter(s=>!assigned.includes(s) && !editStoreForm.stores.includes(s)).sort(); }, [localManagers, storeAccounts, editingStoreAccount, editStoreForm]);
  const handleAddStoreAccount = async () => { if(!newStoreAccount.name || !newStoreAccount.password) return showToast("請輸入完整", "error"); const newAcc = { id: generateUUID(), ...newStoreAccount, stores: newStoreAccount.stores?[newStoreAccount.stores]:[] }; try { await setDoc(getDocPath("store_account_data"), { accounts: [...storeAccounts, newAcc] }); setNewStoreAccount({name:"", password:"", stores:""}); showToast("已新增", "success"); } catch(e){ showToast("失敗", "error"); } };
  const openEditStoreAccount = (account) => { setEditingStoreAccount(account); setEditStoreForm({ name: account.name, password: account.password, stores: account.stores || [] }); };
  const handleAddStoreToEditForm = (storeName) => { if (storeName && !editStoreForm.stores.includes(storeName)) { setEditStoreForm({ ...editStoreForm, stores: [...editStoreForm.stores, storeName] }); } };
  const handleRemoveStoreFromEditForm = (storeName) => { setEditStoreForm({ ...editStoreForm, stores: editStoreForm.stores.filter(s => s !== storeName) }); };
  const handleUpdateStoreAccount = async () => { if(!editStoreForm.name) return; const newAccs = storeAccounts.map(a => a.id === editingStoreAccount.id ? { ...a, ...editStoreForm } : a); await setDoc(getDocPath("store_account_data"), { accounts: newAccs }); setEditingStoreAccount(null); showToast("已更新", "success"); };
  const handleDeleteStoreAccount = async (id) => { if(!confirm("確定?")) return; const newAccs = storeAccounts.filter(a=>a.id!==id); await setDoc(getDocPath("store_account_data"), { accounts: newAccs }); showToast("已刪除", "success"); };
  const handleAddManager = async () => { if(!newManager.name) return; try { const docRef = getDocPath("org_structure"); const docSnap = await getDoc(docRef); let newManagers = docSnap.exists() ? docSnap.data().managers : {}; newManagers[newManager.name] = []; await setDoc(docRef, { managers: newManagers }); setLocalManagers(newManagers); await setDoc(getDocPath("manager_auth"), { [newManager.name]: newManager.password }, {merge:true}); setNewManager({name:"", password:""}); showToast("已新增", "success"); } catch(e){ showToast("失敗", "error"); } };
  const handleAddStoreToEditing = (storeName) => { if (!storeName) return; if (!editingManagerStores.includes(storeName)) { setEditingManagerStores([...editingManagerStores, storeName]); } };
  const handleRemoveStoreFromEditing = (storeName) => { setEditingManagerStores( editingManagerStores.filter((s) => s !== storeName) ); };
  const handleDeleteManager = async (name) => { if(!confirm("確定?")) return; try { const docRef = getDocPath("org_structure"); const docSnap = await getDoc(docRef); let newManagers = docSnap.exists() ? docSnap.data().managers : {}; delete newManagers[name]; await setDoc(docRef, { managers: newManagers }); setLocalManagers(newManagers); showToast("已刪除", "success"); } catch (e) { showToast("刪除失敗", "error"); } };
  
  const handleAddTherapist = async () => { 
    if(!formName) return showToast("請輸入姓名", "error"); 
    try { 
      await addDoc(getCollectionPath("therapists"), { 
        name: formName, store: formStore, manager: formManager, password: formPassword, 
        status: 'active', 
        onboardDate: formOnboardDate, // 仍使用 onboardDate 欄位記錄，但 UI 顯示為上線日
        resignDate: formResignDate,   
        createdAt: serverTimestamp() 
      }); 
      setIsAddingTherapist(false); 
      setFormName(""); 
      showToast("已新增", "success"); 
    } catch(e) { showToast("失敗", "error"); } 
  };

  const handleUpdateTherapist = async () => { 
    if(!editingTherapist) return; 
    const ref = doc(getCollectionPath("therapists"), editingTherapist.id); 
    await updateDoc(ref, { 
      name: formName, store: formStore, manager: formManager, password: formPassword,
      onboardDate: formOnboardDate,
      resignDate: formResignDate
    }); 
    setEditingTherapist(null); 
    showToast("已更新", "success"); 
  };

  const toggleStatus = async (t) => { 
    const ref = doc(getCollectionPath("therapists"), t.id); 
    const isNowActive = t.status === 'active';
    const updates = { status: isNowActive ? 'resigned' : 'active' };
    
    if (isNowActive && !t.resignDate) {
      updates.resignDate = getTodayStr();
    } else if (!isNowActive) {
      updates.resignDate = "";
    }
    
    await updateDoc(ref, updates); 
    showToast(isNowActive ? "帳號已停用並記錄停權日" : "帳號已重新啟用", "success"); 
  };

  const handleDeleteTherapist = async (id) => { if(!confirm("確定要永久刪除此帳號？(這將導致該員歷史報表數據遺失，建議使用帳號暫停代替)")) return; await deleteDoc(doc(getCollectionPath("therapists"), id)); showToast("已徹底刪除", "success"); };
  
  const openEdit = (t) => { 
    setEditingTherapist(t); 
    setFormManager(t.manager || ""); 
    setFormStore(t.store); 
    setFormName(t.name); 
    setFormPassword(t.password); 
    setFormOnboardDate(t.onboardDate || "");
    setFormResignDate(t.resignDate || "");
  };

  const openAddTherapist = () => {
    setIsAddingTherapist(true);
    setFormName(""); 
    setFormPassword("0000"); 
    setFormStore(""); 
    setFormManager("");
    setFormOnboardDate(getTodayStr()); // 預設上線日為今天
    setFormResignDate("");
  };

  const availableStoresForTherapist = useMemo(() => formManager ? (localManagers && localManagers[formManager]?localManagers[formManager]:[]) : [], [formManager, localManagers]);
  
  const filteredTherapists = useMemo(() => { 
    return therapists.filter(t => {
      const searchMatch = (t.name || "").includes(searchTerm) || (t.store || "").includes(searchTerm);
      if (!searchMatch) return false;

      const isResigned = t.isResigned === true || t.resigned === true || t.status === 'resigned' || t.status === '離職' || t.isActive === false;

      return showResigned ? isResigned : !isResigned;
    }); 
  }, [therapists, searchTerm, showResigned]);

  if (visibleTabs.length === 0) return <ViewWrapper><Card title="權限不足"><div className="text-center py-10 text-stone-400"><Lock size={48} className="mx-auto mb-4 opacity-50" /><p>您沒有權限存取此頁面</p></div></Card></ViewWrapper>;

  return (
    <ViewWrapper>
      <div className="grid grid-cols-1 w-[99%] max-w-full gap-6 pb-20 mx-auto">
        
        <div className="flex flex-col gap-4 w-full min-w-0">
          <h2 className="text-2xl font-bold text-stone-800 px-1">系統管理中心</h2>
          
          <div className="w-full bg-white p-1 rounded-xl shadow-sm border border-stone-100 overflow-x-auto no-scrollbar">
            <div className="flex gap-2 min-w-max p-1">
                {visibleTabs.map((tab) => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all flex items-center gap-2 ${activeTab === tab.id ? "bg-stone-800 text-white shadow-md" : "text-stone-500 hover:bg-stone-50"}`}>{tab.icon && <tab.icon size={16}/>}{tab.label}</button>
                ))}
            </div>
          </div>
        </div>

        {activeTab === "kpi" && (<Card title="KPI 目標參數"><div className="max-w-md w-full space-y-6 min-w-0"><div><label className="block text-sm font-bold text-stone-500 mb-2">目標新客客單</label><input type="number" value={localTargets.newASP || 3500} onChange={(e) => setLocalTargets({...localTargets, newASP: Number(e.target.value)})} className="w-full px-4 py-3 border-2 rounded-xl outline-none focus:border-amber-400"/></div><div><label className="block text-sm font-bold text-stone-500 mb-2">目標消耗客單</label><input type="number" value={localTargets.trafficASP || 1200} onChange={(e) => setLocalTargets({...localTargets, trafficASP: Number(e.target.value)})} className="w-full px-4 py-3 border-2 rounded-xl outline-none focus:border-amber-400"/></div><button onClick={handleSaveTargets} className="w-full bg-stone-800 text-white py-3 rounded-xl font-bold active:scale-95 transition-transform">儲存設定</button></div></Card>)}
        
        {activeTab === "health" && (
            <Card title="門市體質診斷標準">
                <div className="space-y-6 w-full min-w-0">
                    <div className="bg-stone-50 p-4 rounded-xl border border-stone-200 flex items-center gap-2"><Lock size={18} className="text-amber-500" /><span className="text-sm font-bold text-stone-600">當前設定品牌：</span><span className="text-lg font-bold text-amber-600">{brandLabel}</span></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                        {BENCHMARK_CATEGORIES.map(cat => {
                            const currentVal = localTargets.benchmarks?.[brandKey]?.[cat.id] || DEFAULT_BENCHMARKS_INIT[brandKey]?.[cat.id] || DEFAULT_BENCHMARKS_INIT["default"][cat.id];
                            const displayMin = (currentVal.min * 100).toFixed(0);
                            const displayMax = (currentVal.max * 100).toFixed(0);
                            return (
                                <div key={cat.id} className="bg-stone-50 border border-stone-200 rounded-xl p-4 hover:shadow-sm transition-shadow">
                                    <div className="mb-3 flex justify-between items-start"><div><h4 className="font-bold text-stone-700">{cat.title}</h4><p className="text-[10px] text-stone-400 mt-0.5">{cat.sub}</p></div><span className="text-[10px] font-bold text-stone-400 bg-white px-2 py-1 rounded border border-stone-100 ml-2 whitespace-nowrap">標準: {displayMin}% - {displayMax}%</span></div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div><label className="block text-[10px] font-bold text-stone-400 mb-1">及格 ({cat.suffix})</label><div className="relative"><input type="number" step={cat.step} value={displayMin} onChange={(e) => handleBenchmarkChange(cat.id, 'min', e.target.value, cat.type)} className="w-full pl-3 pr-8 py-2 border rounded-lg font-mono font-bold text-stone-700 focus:border-amber-400 outline-none text-center bg-white"/><span className="absolute right-3 top-2 text-xs font-bold text-stone-400 pointer-events-none">{cat.suffix}</span></div></div>
                                        <div><label className="block text-[10px] font-bold text-stone-400 mb-1">滿分 ({cat.suffix})</label><div className="relative"><input type="number" step={cat.step} value={displayMax} onChange={(e) => handleBenchmarkChange(cat.id, 'max', e.target.value, cat.type)} className="w-full pl-3 pr-8 py-2 border rounded-lg font-mono font-bold text-stone-700 focus:border-amber-400 outline-none text-center bg-white"/><span className="absolute right-3 top-2 text-xs font-bold text-stone-400 pointer-events-none">{cat.suffix}</span></div></div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex justify-end pt-4 border-t border-stone-100"><button onClick={handleSaveTargets} className="w-full md:w-auto bg-stone-800 text-white px-8 py-3 rounded-xl font-bold hover:bg-stone-700 shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"><Save size={18} /> 儲存體質標準</button></div>
                </div>
            </Card>
        )}

        {activeTab === "permissions" && (
          <div className="space-y-6 w-full max-w-full min-w-0">
            <Card title="模組讀寫權限管理">
              <div className="overflow-x-auto w-full pb-2">
                <div className="min-w-[600px]">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="border-b border-stone-200"><th className="p-4 font-bold text-stone-500 sticky left-0 bg-white z-10">功能模組</th><th className="p-4 font-bold text-stone-700 text-center bg-rose-50/50">教專</th><th className="p-4 font-bold text-stone-700 text-center bg-teal-50/50">區長</th><th className="p-4 font-bold text-stone-700 text-center bg-amber-50/50">店經理</th><th className="p-4 font-bold text-stone-700 text-center bg-indigo-50/50">管理師</th></tr></thead>
                    <tbody className="divide-y divide-stone-100">
                      {ALL_MENU_ITEMS.map((item) => (
                        <tr key={item.id} className="hover:bg-stone-50">
                          <td className="p-4 flex items-center gap-3 sticky left-0 bg-white/95 backdrop-blur-sm z-10 border-r border-stone-100 md:border-none shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] md:shadow-none"><div className="p-2 bg-stone-100 rounded-lg text-stone-500 shrink-0"><item.icon size={18} /></div><span className="font-bold text-stone-700 whitespace-nowrap">{item.label}</span></td>
                          <td className="p-4 text-center bg-rose-50/30"><input type="checkbox" checked={localPermissions.trainer?.includes(item.id)} onChange={() => togglePermission("trainer", item.id)} className="w-5 h-5 rounded border-stone-300 text-rose-600 focus:ring-rose-500 cursor-pointer"/></td>
                          <td className="p-4 text-center bg-teal-50/30"><input type="checkbox" checked={localPermissions.manager?.includes(item.id)} onChange={() => togglePermission("manager", item.id)} className="w-5 h-5 rounded cursor-pointer"/></td>
                          <td className="p-4 text-center bg-amber-50/30"><input type="checkbox" checked={localPermissions.store?.includes(item.id)} onChange={() => togglePermission("store", item.id)} className="w-5 h-5 rounded cursor-pointer"/></td>
                          <td className="p-4 text-center bg-indigo-50/30"><input type="checkbox" checked={localPermissions.therapist?.includes(item.id)} onChange={() => togglePermission("therapist", item.id)} className="w-5 h-5 rounded cursor-pointer"/></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button onClick={handleSavePermissions} className="w-full md:w-auto bg-stone-800 text-white px-8 py-3 rounded-xl font-bold hover:bg-stone-700 shadow-lg active:scale-95 transition-all">儲存模組權限</button>
              </div>
            </Card>

            <Card title="資安與閒置登入控管">
              <div className="space-y-6">
                <div>
                   <label className="block text-sm font-bold text-stone-500 mb-2 flex items-center gap-2"><Clock size={16}/> 閒置自動登出時間</label>
                   <div className="relative max-w-sm">
                     <select
                       value={localSecurityConfig.enabled ? localSecurityConfig.timeoutMinutes : 0}
                       onChange={(e) => {
                         const val = Number(e.target.value);
                         if (val === 0) setLocalSecurityConfig({...localSecurityConfig, enabled: false});
                         else setLocalSecurityConfig({...localSecurityConfig, enabled: true, timeoutMinutes: val});
                       }}
                       className="w-full pl-4 pr-10 py-3 border-2 border-stone-200 rounded-xl outline-none focus:border-amber-400 font-bold text-stone-700 bg-white appearance-none cursor-pointer hover:border-stone-300 transition-colors"
                     >
                       <option value={1}>1 分鐘</option>
                       <option value={3}>3 分鐘 (建議)</option>
                       <option value={5}>5 分鐘</option>
                       <option value={15}>15 分鐘</option>
                       <option value={30}>30 分鐘</option>
                       <option value={60}>60 分鐘</option>
                       <option value={0}>不限制 (永不登出，注意資安風險)</option>
                     </select>
                     <ChevronDown size={18} className="absolute right-4 top-3.5 text-stone-400 pointer-events-none" />
                   </div>
                </div>

                <div>
                   <label className="block text-sm font-bold text-stone-500 mb-2 flex items-center gap-2"><Shield size={16}/> 豁免自動登出的職務 <span className="text-xs font-normal text-stone-400 ml-2">(打勾代表該職務不會被強制登出)</span></label>
                   <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                     
                     <label className="flex items-center gap-3 p-3 border-2 border-amber-100 rounded-xl bg-amber-50 text-amber-700 cursor-not-allowed opacity-80">
                       <input type="checkbox" checked disabled className="w-5 h-5 rounded text-amber-500" />
                       <span className="font-bold">高階主管 <br/><span className="text-[10px] font-normal opacity-80">系統絕對豁免</span></span>
                     </label>

                     {[{id:'trainer', label:'教專'}, {id:'manager', label:'區長'}, {id:'store', label:'店經理'}, {id:'therapist', label:'管理師'}].map(role => (
                       <label key={role.id} className={`flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer transition-all ${localSecurityConfig.exemptRoles?.includes(role.id) ? 'border-amber-400 bg-amber-50/30' : 'border-stone-100 bg-white hover:border-stone-200'}`}>
                         <input type="checkbox"
                           checked={localSecurityConfig.exemptRoles?.includes(role.id)}
                           onChange={(e) => {
                             const checked = e.target.checked;
                             let newRoles = [...(localSecurityConfig.exemptRoles || ["director", "master"])];
                             if(checked && !newRoles.includes(role.id)) newRoles.push(role.id);
                             if(!checked) newRoles = newRoles.filter(r => r !== role.id);
                             setLocalSecurityConfig({...localSecurityConfig, exemptRoles: newRoles});
                           }}
                           className="w-5 h-5 rounded border-stone-300 text-amber-500 focus:ring-amber-500"
                         />
                         <span className={`font-bold ${localSecurityConfig.exemptRoles?.includes(role.id) ? 'text-amber-700' : 'text-stone-600'}`}>{role.label}</span>
                       </label>
                     ))}
                   </div>
                </div>
                
                <div className="flex justify-end pt-4 border-t border-stone-100">
                   <button onClick={handleSaveSecurityConfig} className="w-full md:w-auto bg-stone-800 text-white px-8 py-3 rounded-xl font-bold hover:bg-stone-700 shadow-lg active:scale-95 transition-all flex items-center gap-2 justify-center">
                     <Save size={18} /> 儲存資安設定
                   </button>
                </div>
              </div>
            </Card>
          </div>
        )}
        
        {activeTab === "trainer-account" && (<Card title="教專帳號管理"><div className="max-w-md w-full space-y-6 min-w-0"><div className="bg-stone-50 p-4 rounded-xl border border-stone-200"><p className="text-xs font-bold text-stone-400 uppercase mb-1">目前設定</p><div className="flex justify-between items-center"><span className="font-bold text-stone-700">教專 (Trainer)</span><span className="font-mono bg-white px-3 py-1 rounded border text-stone-500">{trainerAuth?.password || "0000"}</span></div></div><div><label className="block text-sm font-bold text-stone-500 mb-2">設定新密碼</label><input type="text" value={newTrainerPass} onChange={(e) => setNewTrainerPass(e.target.value)} placeholder="輸入新密碼" className="w-full px-4 py-3 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"/></div><button onClick={handleUpdateTrainer} className="w-full bg-stone-800 text-white py-3 rounded-xl font-bold hover:bg-stone-900 shadow-lg">更新密碼</button></div></Card>)}
        {activeTab === "shops" && ( <div className="space-y-6 w-full max-w-full min-w-0"><Card title="新增營運店家"><div className="flex flex-col md:flex-row gap-4 items-end"><div className="flex-1 w-full"><label className="block text-xs font-bold text-stone-400 mb-1">分店簡稱</label><input type="text" value={newShop.name} onChange={(e) => setNewShop({ ...newShop, name: e.target.value })} placeholder="例如: 中山" className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"/></div><div className="flex-1 w-full"><label className="block text-xs font-bold text-stone-400 mb-1">所屬區域</label><div className="relative"><select value={newShop.manager} onChange={(e) => setNewShop({ ...newShop, manager: e.target.value })} className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold appearance-none bg-white text-stone-700"><option value="">請選擇...</option>{Object.keys(localManagers).map((m) => (<option key={m} value={m}>{m} 區</option>))}</select><ChevronDown size={16} className="absolute right-3 top-3 text-stone-400 pointer-events-none"/></div></div><button onClick={handleAddGlobalStore} className="w-full md:w-auto bg-stone-800 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-stone-700 shadow-sm flex items-center justify-center gap-2"><Plus size={18} /> 新增</button></div></Card><Card title="全域店家列表"><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{managerEntries.map(([mgr, stores]) => (<div key={mgr} className={`bg-stone-50 rounded-2xl p-4 border ${mgr === UNASSIGNED_KEY ? "border-stone-300 shadow-inner" : "border-stone-100"}`}><div className="flex items-center gap-2 mb-3 border-b border-stone-200 pb-2"><span className={`font-bold ${mgr === UNASSIGNED_KEY ? "text-stone-500" : "text-stone-700"}`}>{mgr} {mgr!==UNASSIGNED_KEY && "區"}</span><span className="text-xs text-stone-400 ml-auto">{stores.length} 間</span></div><div className="flex flex-wrap gap-2">{stores.map((store) => (<div key={store} className="group relative flex items-center"><span className={`px-3 py-1.5 border rounded-lg text-xs font-bold shadow-sm pr-7 ${mgr === UNASSIGNED_KEY ? "bg-white text-stone-500 border-stone-200" : "bg-white text-stone-600 border-stone-200"}`}>{store}</span><button onClick={() => handleDeleteGlobalStore(store, mgr)} className="absolute right-1 p-1 text-stone-300 hover:text-rose-500 transition-colors"><X size={12} /></button></div>))}</div></div>))}</div></Card></div> )}
        {activeTab === "stores" && ( <div className="space-y-6 w-full max-w-full min-w-0"><Card title="新增店經理帳號"><div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end"><div><label className="block text-xs font-bold text-stone-400 mb-1">姓名 / 帳號</label><input type="text" value={newStoreAccount.name} onChange={(e) => setNewStoreAccount({ ...newStoreAccount, name: e.target.value })} placeholder="例如: 王小明" className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"/></div><div><label className="block text-xs font-bold text-stone-400 mb-1">登入密碼</label><input type="text" value={newStoreAccount.password} onChange={(e) => setNewStoreAccount({ ...newStoreAccount, password: e.target.value })} placeholder="設定密碼" className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"/></div><div className="md:col-span-2"><label className="block text-xs font-bold text-stone-400 mb-1">分配管理店家</label><div className="flex gap-2"><div className="relative w-full"><Store size={16} className="absolute left-3 top-3 text-stone-400 pointer-events-none"/><select value={newStoreAccount.stores} onChange={(e) => setNewStoreAccount({ ...newStoreAccount, stores: e.target.value })} className="w-full pl-10 pr-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold appearance-none bg-white text-stone-700"><option value="">請選擇未分配店家...</option>{availableUnassignedStores.map((s) => (<option key={s} value={s}>{s}</option>))}</select><ChevronDown size={16} className="absolute right-3 top-3 text-stone-400 pointer-events-none"/></div><button onClick={handleAddStoreAccount} className="bg-stone-800 text-white px-4 rounded-xl font-bold shrink-0 hover:bg-stone-700"><Plus size={20} /></button></div></div></div></Card><Card title="現有店經理列表"><div className="overflow-x-auto w-full pb-2"><div className="min-w-[600px]"><table className="w-full text-left text-sm"><thead className="bg-stone-50 font-bold text-stone-500 uppercase"><tr><th className="p-4 rounded-tl-xl">姓名</th><th className="p-4">密碼</th><th className="p-4">負責店家</th><th className="p-4 rounded-tr-xl text-right">操作</th></tr></thead><tbody className="divide-y divide-stone-100">{storeAccounts.map((account) => (<tr key={account.id} className="hover:bg-stone-50"><td className="p-4 font-bold text-stone-700">{account.name}</td><td className="p-4 font-mono text-stone-500">{account.password}</td><td className="p-4"><div className="flex flex-wrap gap-1">{account.stores && account.stores.map((s) => (<span key={s} className="px-2 py-1 bg-stone-100 rounded text-xs font-bold text-stone-600">{s}</span>))}</div></td><td className="p-4 text-right flex justify-end gap-1"><button onClick={() => openEditStoreAccount(account)} className="text-stone-400 hover:text-stone-600 hover:bg-stone-100 p-2 rounded-lg transition-colors"><Edit2 size={18} /></button><button onClick={() => handleDeleteStoreAccount(account.id)} className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 p-2 rounded-lg transition-colors"><Trash2 size={18} /></button></td></tr>))}</tbody></table></div></div></Card>{editingStoreAccount && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"><div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95"><div className="bg-amber-400 p-4 font-bold text-white flex justify-between items-center"><span>編輯店經理帳號</span><button onClick={() => setEditingStoreAccount(null)}><X size={20}/></button></div><div className="p-6 space-y-4"><div><label className="text-xs font-bold text-stone-400 block mb-1">姓名 / 帳號</label><input type="text" value={editStoreForm.name} onChange={(e) => setEditStoreForm({...editStoreForm, name: e.target.value})} className="w-full p-2 border rounded-lg font-bold"/></div><div><label className="text-xs font-bold text-stone-400 block mb-1">密碼</label><input type="text" value={editStoreForm.password} onChange={(e) => setEditStoreForm({...editStoreForm, password: e.target.value})} className="w-full p-2 border rounded-lg font-mono"/></div><div><label className="text-xs font-bold text-stone-400 block mb-1">管理店家 (可多選)</label><div className="flex flex-wrap gap-2 mb-2 p-2 bg-stone-50 rounded-lg min-h-[40px]">{editStoreForm.stores.map(s => (<span key={s} className="px-2 py-1 bg-white border border-stone-200 rounded text-xs font-bold text-stone-600 shadow-sm flex items-center gap-1">{s} <button onClick={() => handleRemoveStoreFromEditForm(s)} className="text-stone-300 hover:text-rose-500"><X size={12}/></button></span>))}</div><div className="relative"><select onChange={(e) => { handleAddStoreToEditForm(e.target.value); e.target.value = ""; }} className="w-full p-2 border rounded-lg font-bold bg-white"><option value="">+ 加入負責店家</option>{availableStoresForEditing.map(s => <option key={s} value={s}>{s}</option>)}</select></div></div><div className="pt-4 flex gap-3"><button onClick={() => setEditingStoreAccount(null)} className="flex-1 py-3 bg-stone-100 text-stone-500 rounded-xl font-bold">取消</button><button onClick={handleUpdateStoreAccount} className="flex-1 py-3 bg-stone-800 text-white rounded-xl font-bold">儲存變更</button></div></div></div></div>)}</div> )}
        {activeTab === "managers" && ( <div className="space-y-6 w-full max-w-full min-w-0"><Card title="新增區長"><div className="flex flex-col md:flex-row gap-4 items-end"><div className="flex-1 w-full"><label className="block text-xs font-bold text-stone-400 mb-1">區長姓名</label><input type="text" value={newManager.name} onChange={(e) => setNewManager({ ...newManager, name: e.target.value })} placeholder="例如: Jonas" className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold" /></div><div className="flex-1 w-full"><label className="block text-xs font-bold text-stone-400 mb-1">預設密碼</label><input type="text" value={newManager.password} onChange={(e) => setNewManager({ ...newManager, password: e.target.value })} placeholder="設定密碼" className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold" /></div><button onClick={handleAddManager} className="w-full md:w-auto bg-stone-800 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-stone-700 shadow-sm flex items-center justify-center gap-2"><Plus size={18} /> 新增區長</button></div></Card><div className="grid grid-cols-1 md:grid-cols-2 gap-6">{managerEntries.map(([managerName, stores]) => (<Card key={managerName} className={`border ${managerName === UNASSIGNED_KEY ? "border-stone-300 bg-stone-50" : "border-stone-200"}`}><div className="flex flex-wrap justify-between items-start gap-3 mb-4"><div><h3 className={`text-lg font-bold flex items-center gap-2 ${managerName === UNASSIGNED_KEY ? "text-stone-500" : "text-stone-700"}`}>{managerName === UNASSIGNED_KEY ? <LayoutGrid size={20} /> : <User size={20} className="text-amber-500" />}{managerName} {managerName !== UNASSIGNED_KEY && "區"}</h3>{managerName !== UNASSIGNED_KEY && <p className="text-xs text-stone-400 mt-1 font-mono">密碼: {managerAuth[managerName] || "未設定"}</p>}</div>{managerName !== UNASSIGNED_KEY && (<div className="flex gap-2"><button onClick={() => { setEditingManager(managerName); setEditingManagerStores(stores); }} className="text-xs bg-stone-100 text-stone-600 px-3 py-1.5 rounded-lg hover:bg-stone-200 font-bold whitespace-nowrap">編輯轄區</button><button onClick={() => handleDeleteManager(managerName)} className="text-rose-400 hover:bg-rose-50 p-1.5 rounded-lg"><Trash2 size={16} /></button></div>)}</div>{editingManager === managerName ? (<div className="mt-4 animate-in fade-in bg-stone-50 p-4 rounded-xl border border-stone-200"><label className="block text-xs font-bold text-stone-400 mb-2">已分配店家</label><div className="flex flex-wrap gap-2 mb-4">{editingManagerStores.map((s) => (<div key={s} className="group relative flex items-center"><span className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold text-stone-600 shadow-sm pr-7">{s}</span><button onClick={() => handleRemoveStoreFromEditing(s)} className="absolute right-1 p-1 text-stone-300 hover:text-rose-500 transition-colors"><X size={12} /></button></div>))}</div><div className="mb-4"><label className="block text-xs font-bold text-stone-400 mb-1">新增未分配店家 (從未分配清單選擇)</label><div className="relative"><select onChange={(e) => { handleAddStoreToEditing(e.target.value); e.target.value = ""; }} className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl font-bold bg-white appearance-none text-stone-700"><option value="">+ 點擊選擇店家</option>{availableStoresForManagerEdit.filter((s) => !editingManagerStores.includes(s)).map((s) => (<option key={s} value={s}>{s}</option>))}</select><ChevronDown size={16} className="absolute right-3 top-3 text-stone-400 pointer-events-none"/></div></div><div className="flex gap-2 justify-end"><button onClick={() => setEditingManager(null)} className="px-3 py-1.5 text-xs font-bold text-stone-400 hover:text-stone-600">取消</button><button onClick={() => handleSaveManagerStores(managerName)} className="px-4 py-1.5 bg-stone-800 text-white text-xs font-bold rounded-lg hover:bg-stone-700 shadow-sm">儲存變更</button></div></div>) : (<div className="flex flex-wrap gap-2 mt-4">{stores.map((s) => (<span key={s} className={`px-2.5 py-1 border rounded-lg text-xs font-bold ${managerName === UNASSIGNED_KEY ? "bg-white border-stone-200 text-stone-400" : "bg-stone-50 border-stone-100 text-stone-600"}`}>{s}</span>))}</div>)}</Card>))}</div></div> )}
        
        {activeTab === "therapists" && ( 
          <div className="space-y-6 w-full max-w-full min-w-0">
            
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
                          {Object.keys(localManagers).map(m => <option key={m} value={m}>{m}區</option>)}
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
                    
                    {/* ★ 更新這裡：改為上線日 */}
                    <div className="grid grid-cols-2 gap-4 pt-1 border-t border-stone-100">
                      <div>
                        <label className="text-xs font-bold text-stone-400 block mb-1.5 uppercase tracking-wider flex items-center gap-1">
                          <Calendar size={12}/> 上線日 (生效日)
                        </label>
                        <input type="date" value={formOnboardDate} onChange={(e) => setFormOnboardDate(e.target.value)} className="w-full px-4 py-3 border border-stone-200 rounded-xl font-mono font-bold text-sm bg-stone-50 outline-none focus:border-amber-400 focus:bg-white transition-colors" />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-stone-400 block mb-1.5 uppercase tracking-wider flex items-center gap-1">
                          <Calendar size={12}/> 停權日 (選填)
                        </label>
                        <input type="date" value={formResignDate} onChange={(e) => setFormResignDate(e.target.value)} className="w-full px-4 py-3 border border-stone-200 rounded-xl font-mono font-bold text-sm bg-stone-50 outline-none focus:border-amber-400 focus:bg-white transition-colors" />
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
                            {/* ★ 更新這裡：改為顯示上線日 */}
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
        )}
        
        {activeTab === "maintenance" && <SystemMaintenance />}
        
      </div>
    </ViewWrapper>
  );
};

export default SettingsView;