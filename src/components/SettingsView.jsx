// src/components/SettingsView.jsx
import React, { useState, useContext, useEffect, useMemo } from "react";
import {
  Save, Plus, Trash2, Edit2, Edit, Lock, User, Store, Target,
  CheckCircle, AlertCircle, X, Shield, ChevronDown, Search,
  UserCheck, UserX, Key, Calendar, DollarSign, Users, LayoutGrid
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

const SettingsView = () => {
  const {
    targets, setTargets, showToast, managers, storeAccounts,
    managerAuth, userRole, permissions, currentUser,
    therapists, therapistTargets, therapistSchedules,
    trainerAuth, handleUpdateTrainerAuth,
    getDocPath, getCollectionPath
  } = useContext(AppContext);

  const [activeTab, setActiveTab] = useState("");
  const [localTargets, setLocalTargets] = useState(targets);
  const [localPermissions, setLocalPermissions] = useState(permissions || DEFAULT_PERMISSIONS);
  
  // ★★★ 關鍵修正：引入本地狀態，解決畫面不更新問題 ★★★
  const [localManagers, setLocalManagers] = useState(managers || {});

  // 當 Context 的 managers 改變時 (例如切換品牌)，同步更新本地狀態
  useEffect(() => {
    if (managers) setLocalManagers(managers);
  }, [managers]);

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
  const [newTrainerPass, setNewTrainerPass] = useState("");

  const UNASSIGNED_KEY = "未分配"; 

  const visibleTabs = useMemo(() => {
    const tabs = [];
    const myPerms = permissions?.[userRole] || [];
    const allTabsDefinition = [
      { id: "kpi", label: "KPI 參數", isAdminOnly: true },
      { id: "permissions", label: "權限設定", isAdminOnly: true },
      { id: "trainer-account", label: "教專帳號", isAdminOnly: true, icon: Users }, 
      { id: "shops", label: "店家管理", isAdminOnly: true },
      { id: "stores", label: "店經理帳號", isAdminOnly: true },
      { id: "managers", label: "組織架構", isAdminOnly: true },
      { id: "therapists", label: "人員帳號", isAdminOnly: true }
    ];
    allTabsDefinition.forEach(tab => {
      if (userRole === 'director') {
        tabs.push(tab);
      } else {
        if (!tab.isAdminOnly && tab.permissionId && myPerms.includes(tab.permissionId)) {
          tabs.push(tab);
        }
      }
    });
    return tabs;
  }, [userRole, permissions]);

  useEffect(() => {
    if (visibleTabs.length > 0) {
      const isCurrentTabValid = visibleTabs.some(t => t.id === activeTab);
      if (!activeTab || !isCurrentTabValid) {
        setActiveTab(visibleTabs[0].id);
      }
    }
  }, [visibleTabs, activeTab]);

  // ★★★ 修改：使用 localManagers 進行渲染 ★★★
  const managerEntries = useMemo(() => {
    const currentManagers = localManagers || {};
    const entries = Object.entries(currentManagers);
    const hasUnassigned = entries.some(([key]) => key === UNASSIGNED_KEY);
    if (!hasUnassigned) {
      entries.push([UNASSIGNED_KEY, []]);
    }
    return entries.sort((a, b) => {
      if (a[0] === UNASSIGNED_KEY) return 1; 
      if (b[0] === UNASSIGNED_KEY) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [localManagers]); // 依賴改為 localManagers

  const availableTherapists = useMemo(() => {
    let list = therapists.filter(t => t.status === 'active');
    if (userRole === 'director' || userRole === 'trainer') return list.sort((a,b) => a.store.localeCompare(b.store)); 
    if (userRole === 'manager') { const myStores = localManagers[currentUser?.name] || []; return list.filter(t => myStores.includes(t.store)).sort((a,b) => a.store.localeCompare(b.store)); }
    if (userRole === 'store') { const myStores = currentUser?.stores || [currentUser?.storeName]; const cleanMyStores = myStores.map(s => s.replace("CYJ", "").replace("店", "")); return list.filter(t => cleanMyStores.includes(t.store)); }
    if (userRole === 'therapist') { return list.filter(t => t.id === currentUser?.id); }
    return [];
  }, [therapists, userRole, currentUser, localManagers]);

  const handleUpdateTrainer = async () => {
    if (!newTrainerPass) return showToast("請輸入新密碼", "error");
    const success = await handleUpdateTrainerAuth(newTrainerPass);
    if (success) {
      showToast("教專密碼已更新", "success");
      setNewTrainerPass("");
    } else {
      showToast("更新失敗", "error");
    }
  };

  useEffect(() => { if (permissions) setLocalPermissions(permissions); }, [permissions]);
  useEffect(() => { if (targets) setLocalTargets(targets); }, [targets]);
  
  const handleSaveTargets = async () => { try { await setDoc(getDocPath("kpi_targets"), localTargets); setTargets(localTargets); showToast("KPI 參數已儲存", "success"); } catch (e) { showToast("儲存失敗", "error"); } };
  const handleSavePermissions = async () => { try { await setDoc(getDocPath("permissions"), localPermissions); showToast("權限設定已更新", "success"); } catch (e) { showToast("更新失敗", "error"); } };
  const togglePermission = (role, menuId) => { const current = localPermissions[role] || []; const updated = current.includes(menuId) ? current.filter((id) => id !== menuId) : [...current, menuId]; setLocalPermissions({ ...localPermissions, [role]: updated }); };
  
  // ------------------------------------------------------------------
  // 核心邏輯：店家管理 (本地更新 + 遠端寫入)
  // ------------------------------------------------------------------

  const handleAddGlobalStore = async () => { 
    if (!newShop.name || !newShop.manager) return showToast("請輸入完整資訊", "error"); 
    try { 
      const targetManager = newShop.manager;
      const docRef = getDocPath("org_structure");
      
      const docSnap = await getDoc(docRef);
      let newManagers = docSnap.exists() ? { ...docSnap.data().managers } : {};
      
      if (!newManagers[targetManager]) newManagers[targetManager] = [];
      if (!newManagers[targetManager].includes(newShop.name)) {
          newManagers[targetManager].push(newShop.name);
      }

      await setDoc(docRef, { managers: newManagers }); 
      setLocalManagers(newManagers); // ★ 立即更新 UI

      setNewShop({ name: "", manager: "" }); 
      showToast("已新增", "success"); 
    } catch (e) { showToast("失敗: " + e.message, "error"); } 
  };

  const handleDeleteGlobalStore = async (storeName, managerName) => { 
    const isPermanentDelete = managerName === UNASSIGNED_KEY;
    if(!confirm(isPermanentDelete ? "確定永久刪除此店家？" : "確定將此店家移至『未分配』名單？")) return; 
    
    try { 
      const docRef = getDocPath("org_structure");
      
      // 1. 讀取最新
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) throw new Error("讀取設定檔失敗");

      let newManagers = JSON.parse(JSON.stringify(docSnap.data().managers || {}));

      // 2. 移除
      if (Array.isArray(newManagers[managerName])) {
        newManagers[managerName] = newManagers[managerName].filter(x => x !== storeName);
      }

      // 3. 加入未分配
      if (!isPermanentDelete) {
        if (!Array.isArray(newManagers[UNASSIGNED_KEY])) {
          newManagers[UNASSIGNED_KEY] = [];
        }
        if (!newManagers[UNASSIGNED_KEY].includes(storeName)) {
          newManagers[UNASSIGNED_KEY].push(storeName);
        }
      }

      // 4. 存檔並更新 UI
      await setDoc(docRef, { managers: newManagers }); 
      setLocalManagers(newManagers); // ★ 立即更新 UI
      
      showToast(isPermanentDelete ? "已永久刪除" : "已移至未分配", "success"); 
    } catch(e) { 
      console.error(e);
      showToast("失敗: " + e.message, "error"); 
    } 
  };

  const handleSaveManagerStores = async (name) => { 
    try { 
      const docRef = getDocPath("org_structure");
      const docSnap = await getDoc(docRef);
      let newManagers = docSnap.exists() ? JSON.parse(JSON.stringify(docSnap.data().managers)) : {};

      const newStores = editingManagerStores;
      const originalStores = newManagers[name] || [];

      const removedStores = originalStores.filter(s => !newStores.includes(s));
      const addedStores = newStores.filter(s => !originalStores.includes(s));

      newManagers[name] = newStores;

      if (!Array.isArray(newManagers[UNASSIGNED_KEY])) {
          newManagers[UNASSIGNED_KEY] = [];
      }
      
      removedStores.forEach(s => {
        if (!newManagers[UNASSIGNED_KEY].includes(s)) newManagers[UNASSIGNED_KEY].push(s);
      });

      newManagers[UNASSIGNED_KEY] = newManagers[UNASSIGNED_KEY].filter(s => !addedStores.includes(s));

      await setDoc(docRef, { managers: newManagers }); 
      setLocalManagers(newManagers); // ★ 立即更新 UI
      
      setEditingManager(null); 
      showToast("已更新", "success"); 
    } catch(e){ showToast("失敗", "error"); } 
  };

  // ------------------------------------------------------------------

  const availableUnassignedStores = useMemo(() => { const all = Object.values(localManagers || {}).flat(); const assigned = storeAccounts.flatMap(a=>a.stores||[]); return all.filter(s=>!assigned.includes(s)).sort(); }, [localManagers, storeAccounts]);
  const availableStoresForManagerEdit = useMemo(() => { return (localManagers && localManagers[UNASSIGNED_KEY]) ? localManagers[UNASSIGNED_KEY].sort() : []; }, [localManagers]);
  const availableStoresForEditing = useMemo(() => { const all = Object.values(localManagers || {}).flat(); const assigned = storeAccounts.filter(a=>a.id!==editingStoreAccount?.id).flatMap(a=>a.stores||[]); return all.filter(s=>!assigned.includes(s) && !editStoreForm.stores.includes(s)).sort(); }, [localManagers, storeAccounts, editingStoreAccount, editStoreForm]);
  
  const handleAddStoreAccount = async () => { 
    if(!newStoreAccount.name || !newStoreAccount.password) return showToast("請輸入完整", "error"); 
    const newAcc = { id: generateUUID(), ...newStoreAccount, stores: newStoreAccount.stores?[newStoreAccount.stores]:[] }; 
    try { 
      await setDoc(getDocPath("store_account_data"), { accounts: [...storeAccounts, newAcc] }); 
      setNewStoreAccount({name:"", password:"", stores:""}); 
      showToast("已新增", "success"); 
    } catch(e){ showToast("失敗", "error"); } 
  };

  const openEditStoreAccount = (account) => { setEditingStoreAccount(account); setEditStoreForm({ name: account.name, password: account.password, stores: account.stores || [] }); };
  const handleAddStoreToEditForm = (storeName) => { if (storeName && !editStoreForm.stores.includes(storeName)) { setEditStoreForm({ ...editStoreForm, stores: [...editStoreForm.stores, storeName] }); } };
  const handleRemoveStoreFromEditForm = (storeName) => { setEditStoreForm({ ...editStoreForm, stores: editStoreForm.stores.filter(s => s !== storeName) }); };
  const handleUpdateStoreAccount = async () => { if(!editStoreForm.name) return; const newAccs = storeAccounts.map(a => a.id === editingStoreAccount.id ? { ...a, ...editStoreForm } : a); await setDoc(getDocPath("store_account_data"), { accounts: newAccs }); setEditingStoreAccount(null); showToast("已更新", "success"); };
  const handleDeleteStoreAccount = async (id) => { if(!confirm("確定?")) return; const newAccs = storeAccounts.filter(a=>a.id!==id); await setDoc(getDocPath("store_account_data"), { accounts: newAccs }); showToast("已刪除", "success"); };
  
  const handleAddManager = async () => { 
    if(!newManager.name) return; 
    try { 
      const docRef = getDocPath("org_structure");
      const docSnap = await getDoc(docRef);
      let newManagers = docSnap.exists() ? docSnap.data().managers : {};
      newManagers[newManager.name] = [];
      await setDoc(docRef, { managers: newManagers }); 
      setLocalManagers(newManagers); // ★ 更新 UI
      
      await setDoc(getDocPath("manager_auth"), { [newManager.name]: newManager.password }, {merge:true}); 
      setNewManager({name:"", password:""}); 
      showToast("已新增", "success"); 
    } catch(e){ showToast("失敗", "error"); } 
  };
  
  const handleAddStoreToEditing = (storeName) => { if (!storeName) return; if (!editingManagerStores.includes(storeName)) { setEditingManagerStores([...editingManagerStores, storeName]); } };
  const handleRemoveStoreFromEditing = (storeName) => { setEditingManagerStores( editingManagerStores.filter((s) => s !== storeName) ); };
  const handleDeleteManager = async (name) => { 
    if(!confirm("確定?")) return; 
    try {
        const docRef = getDocPath("org_structure");
        const docSnap = await getDoc(docRef);
        let newManagers = docSnap.exists() ? docSnap.data().managers : {};
        delete newManagers[name]; 
        await setDoc(docRef, { managers: newManagers }); 
        setLocalManagers(newManagers); // ★ 更新 UI
        showToast("已刪除", "success");
    } catch (e) { showToast("刪除失敗", "error"); }
  };
  
  const handleAddTherapist = async () => { if(!formName) return showToast("請輸入姓名", "error"); try { await addDoc(getCollectionPath("therapists"), { name: formName, store: formStore, manager: formManager, password: formPassword, status: 'active', createdAt: serverTimestamp() }); setIsAddingTherapist(false); setFormName(""); showToast("已新增", "success"); } catch(e){ showToast("失敗", "error"); } };
  const handleUpdateTherapist = async () => { if(!editingTherapist) return; const ref = doc(getCollectionPath("therapists"), editingTherapist.id); await updateDoc(ref, { name: formName, store: formStore, manager: formManager, password: formPassword }); setEditingTherapist(null); showToast("已更新", "success"); };
  const toggleStatus = async (t) => { const ref = doc(getCollectionPath("therapists"), t.id); await updateDoc(ref, { status: t.status==='active'?'resigned':'active' }); showToast("狀態已更新", "success"); };
  const handleDeleteTherapist = async (id) => { if(!confirm("確定?")) return; await deleteDoc(doc(getCollectionPath("therapists"), id)); showToast("已刪除", "success"); };
  const openEdit = (t) => { setEditingTherapist(t); setFormManager(t.manager || ""); setFormStore(t.store); setFormName(t.name); setFormPassword(t.password); };
  
  const availableStoresForTherapist = useMemo(() => formManager ? (localManagers && localManagers[formManager]?localManagers[formManager]:[]) : [], [formManager, localManagers]);
  const filteredTherapists = useMemo(() => {
    return therapists.filter(t => (t.name || "").includes(searchTerm) || (t.store || "").includes(searchTerm) || (t.status === 'resigned' && searchTerm === '離職'));
  }, [therapists, searchTerm]);

  if (visibleTabs.length === 0) return <ViewWrapper><Card title="權限不足"><div className="text-center py-10 text-stone-400"><Lock size={48} className="mx-auto mb-4 opacity-50" /><p>您沒有權限存取此頁面</p></div></Card></ViewWrapper>;

  return (
    <ViewWrapper>
      <div className="space-y-6">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <h2 className="text-2xl font-bold text-stone-800 shrink-0">系統管理中心</h2>
          <div className="w-full xl:w-auto min-w-0 bg-white p-1 rounded-xl shadow-sm border border-stone-100 flex overflow-x-auto no-scrollbar">
            {visibleTabs.map((tab) => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all flex items-center gap-1 ${activeTab === tab.id ? "bg-stone-800 text-white shadow" : "text-stone-500 hover:bg-stone-50"}`}>{tab.icon && <tab.icon size={14}/>}{tab.label}</button>
            ))}
          </div>
        </div>

        {activeTab === "kpi" && (<Card title="KPI 目標參數設定"><div className="max-w-md space-y-6"><div><label className="block text-sm font-bold text-stone-500 mb-2">目標新客客單</label><input type="number" value={localTargets.newASP} onChange={(e) => setLocalTargets({...localTargets, newASP: Number(e.target.value)})} className="w-full px-4 py-3 border-2 rounded-xl"/></div><div><label className="block text-sm font-bold text-stone-500 mb-2">目標消耗客單</label><input type="number" value={localTargets.trafficASP} onChange={(e) => setLocalTargets({...localTargets, trafficASP: Number(e.target.value)})} className="w-full px-4 py-3 border-2 rounded-xl"/></div><button onClick={handleSaveTargets} className="w-full bg-stone-800 text-white py-3 rounded-xl font-bold">儲存 KPI 設定</button></div></Card>)}
        {activeTab === "trainer-account" && (<Card title="教專帳號管理"><div className="max-w-md space-y-6"><div className="bg-stone-50 p-4 rounded-xl border border-stone-200"><p className="text-xs font-bold text-stone-400 uppercase mb-1">目前設定</p><div className="flex justify-between items-center"><span className="font-bold text-stone-700">教專 (Trainer)</span><span className="font-mono bg-white px-3 py-1 rounded border text-stone-500">{trainerAuth?.password || "0000"}</span></div></div><div><label className="block text-sm font-bold text-stone-500 mb-2">設定新密碼</label><input type="text" value={newTrainerPass} onChange={(e) => setNewTrainerPass(e.target.value)} placeholder="輸入新密碼" className="w-full px-4 py-3 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"/></div><button onClick={handleUpdateTrainer} className="w-full bg-stone-800 text-white py-3 rounded-xl font-bold hover:bg-stone-900 shadow-lg">更新密碼</button></div></Card>)}
        {activeTab === "permissions" && (<Card title="角色權限管理"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-stone-200"><th className="p-4 font-bold text-stone-500">功能模組</th><th className="p-4 font-bold text-stone-700 text-center bg-rose-50/50">教專</th><th className="p-4 font-bold text-stone-700 text-center bg-teal-50/50">區長</th><th className="p-4 font-bold text-stone-700 text-center bg-amber-50/50">店經理</th><th className="p-4 font-bold text-stone-700 text-center bg-indigo-50/50">管理師</th></tr></thead><tbody className="divide-y divide-stone-100">{ALL_MENU_ITEMS.map((item) => (<tr key={item.id} className="hover:bg-stone-50"><td className="p-4 flex items-center gap-3"><div className="p-2 bg-stone-100 rounded-lg text-stone-500"><item.icon size={18} /></div><span className="font-bold text-stone-700">{item.label}</span></td><td className="p-4 text-center bg-rose-50/30"><input type="checkbox" checked={localPermissions.trainer?.includes(item.id)} onChange={() => togglePermission("trainer", item.id)} className="w-5 h-5 rounded border-stone-300 text-rose-600 focus:ring-rose-500 cursor-pointer"/></td><td className="p-4 text-center bg-teal-50/30"><input type="checkbox" checked={localPermissions.manager?.includes(item.id)} onChange={() => togglePermission("manager", item.id)} className="w-5 h-5 rounded cursor-pointer"/></td><td className="p-4 text-center bg-amber-50/30"><input type="checkbox" checked={localPermissions.store?.includes(item.id)} onChange={() => togglePermission("store", item.id)} className="w-5 h-5 rounded cursor-pointer"/></td><td className="p-4 text-center bg-indigo-50/30"><input type="checkbox" checked={localPermissions.therapist?.includes(item.id)} onChange={() => togglePermission("therapist", item.id)} className="w-5 h-5 rounded cursor-pointer"/></td></tr>))}</tbody></table></div><div className="mt-6 flex justify-end"><button onClick={handleSavePermissions} className="bg-stone-800 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-stone-700 shadow-lg active:scale-95 transition-all">儲存權限設定</button></div></Card>)}
        {activeTab === "shops" && ( <div className="space-y-6"><Card title="新增營運店家"><div className="flex flex-col md:flex-row gap-4 items-end"><div className="flex-1 w-full"><label className="block text-xs font-bold text-stone-400 mb-1">分店簡稱</label><input type="text" value={newShop.name} onChange={(e) => setNewShop({ ...newShop, name: e.target.value })} placeholder="例如: 中山" className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"/></div><div className="flex-1 w-full"><label className="block text-xs font-bold text-stone-400 mb-1">所屬區域 (區長)</label><div className="relative"><select value={newShop.manager} onChange={(e) => setNewShop({ ...newShop, manager: e.target.value })} className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold appearance-none bg-white text-stone-700"><option value="">請選擇...</option>{Object.keys(localManagers).map((m) => (<option key={m} value={m}>{m} 區</option>))}</select><ChevronDown size={16} className="absolute right-3 top-3 text-stone-400 pointer-events-none"/></div></div><button onClick={handleAddGlobalStore} className="w-full md:w-auto bg-stone-800 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-stone-700 shadow-sm flex items-center justify-center gap-2"><Plus size={18} /> 新增店家</button></div></Card><Card title="全域店家列表"><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{managerEntries.map(([mgr, stores]) => (<div key={mgr} className={`bg-stone-50 rounded-2xl p-4 border ${mgr === UNASSIGNED_KEY ? "border-stone-300 shadow-inner" : "border-stone-100"}`}><div className="flex items-center gap-2 mb-3 border-b border-stone-200 pb-2"><span className={`font-bold ${mgr === UNASSIGNED_KEY ? "text-stone-500" : "text-stone-700"}`}>{mgr} {mgr!==UNASSIGNED_KEY && "區"}</span><span className="text-xs text-stone-400 ml-auto">{stores.length} 間</span></div><div className="flex flex-wrap gap-2">{stores.map((store) => (<div key={store} className="group relative flex items-center"><span className={`px-3 py-1.5 border rounded-lg text-xs font-bold shadow-sm pr-7 ${mgr === UNASSIGNED_KEY ? "bg-white text-stone-500 border-stone-200" : "bg-white text-stone-600 border-stone-200"}`}>{store}</span><button onClick={() => handleDeleteGlobalStore(store, mgr)} className="absolute right-1 p-1 text-stone-300 hover:text-rose-500 transition-colors"><X size={12} /></button></div>))}</div></div>))}</div></Card></div> )}
        {activeTab === "stores" && ( <div className="space-y-6"><Card title="新增店經理帳號"><div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end"><div><label className="block text-xs font-bold text-stone-400 mb-1">姓名 / 帳號名稱</label><input type="text" value={newStoreAccount.name} onChange={(e) => setNewStoreAccount({ ...newStoreAccount, name: e.target.value })} placeholder="例如: 王小明" className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"/></div><div><label className="block text-xs font-bold text-stone-400 mb-1">登入密碼</label><input type="text" value={newStoreAccount.password} onChange={(e) => setNewStoreAccount({ ...newStoreAccount, password: e.target.value })} placeholder="設定密碼" className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold"/></div><div className="md:col-span-2"><label className="block text-xs font-bold text-stone-400 mb-1">分配管理店家</label><div className="flex gap-2"><div className="relative w-full"><Store size={16} className="absolute left-3 top-3 text-stone-400 pointer-events-none"/><select value={newStoreAccount.stores} onChange={(e) => setNewStoreAccount({ ...newStoreAccount, stores: e.target.value })} className="w-full pl-10 pr-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold appearance-none bg-white text-stone-700"><option value="">請選擇未分配店家...</option>{availableUnassignedStores.map((s) => (<option key={s} value={s}>{s}</option>))}</select><ChevronDown size={16} className="absolute right-3 top-3 text-stone-400 pointer-events-none"/></div><button onClick={handleAddStoreAccount} className="bg-stone-800 text-white px-4 rounded-xl font-bold shrink-0 hover:bg-stone-700"><Plus size={20} /></button></div></div></div></Card><Card title="現有店經理列表"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-stone-50 font-bold text-stone-500 uppercase"><tr><th className="p-4 rounded-tl-xl">姓名</th><th className="p-4">密碼</th><th className="p-4">負責店家</th><th className="p-4 rounded-tr-xl text-right">操作</th></tr></thead><tbody className="divide-y divide-stone-100">{storeAccounts.map((account) => (<tr key={account.id} className="hover:bg-stone-50"><td className="p-4 font-bold text-stone-700">{account.name}</td><td className="p-4 font-mono text-stone-500">{account.password}</td><td className="p-4"><div className="flex flex-wrap gap-1">{account.stores && account.stores.map((s) => (<span key={s} className="px-2 py-1 bg-stone-100 rounded text-xs font-bold text-stone-600">{s}</span>))}</div></td><td className="p-4 text-right flex justify-end gap-1"><button onClick={() => openEditStoreAccount(account)} className="text-stone-400 hover:text-stone-600 hover:bg-stone-100 p-2 rounded-lg transition-colors"><Edit2 size={18} /></button><button onClick={() => handleDeleteStoreAccount(account.id)} className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 p-2 rounded-lg transition-colors"><Trash2 size={18} /></button></td></tr>))}</tbody></table></div></Card>{editingStoreAccount && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"><div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95"><div className="bg-amber-400 p-4 font-bold text-white flex justify-between items-center"><span>編輯店經理帳號</span><button onClick={() => setEditingStoreAccount(null)}><X size={20}/></button></div><div className="p-6 space-y-4"><div><label className="text-xs font-bold text-stone-400 block mb-1">姓名 / 帳號</label><input type="text" value={editStoreForm.name} onChange={(e) => setEditStoreForm({...editStoreForm, name: e.target.value})} className="w-full p-2 border rounded-lg font-bold"/></div><div><label className="text-xs font-bold text-stone-400 block mb-1">密碼</label><input type="text" value={editStoreForm.password} onChange={(e) => setEditStoreForm({...editStoreForm, password: e.target.value})} className="w-full p-2 border rounded-lg font-mono"/></div><div><label className="text-xs font-bold text-stone-400 block mb-1">管理店家 (可多選)</label><div className="flex flex-wrap gap-2 mb-2 p-2 bg-stone-50 rounded-lg min-h-[40px]">{editStoreForm.stores.map(s => (<span key={s} className="px-2 py-1 bg-white border border-stone-200 rounded text-xs font-bold text-stone-600 shadow-sm flex items-center gap-1">{s} <button onClick={() => handleRemoveStoreFromEditForm(s)} className="text-stone-300 hover:text-rose-500"><X size={12}/></button></span>))}</div><div className="relative"><select onChange={(e) => { handleAddStoreToEditForm(e.target.value); e.target.value = ""; }} className="w-full p-2 border rounded-lg font-bold bg-white"><option value="">+ 加入負責店家</option>{availableStoresForEditing.map(s => <option key={s} value={s}>{s}</option>)}</select></div></div><div className="pt-4 flex gap-3"><button onClick={() => setEditingStoreAccount(null)} className="flex-1 py-3 bg-stone-100 text-stone-500 rounded-xl font-bold">取消</button><button onClick={handleUpdateStoreAccount} className="flex-1 py-3 bg-stone-800 text-white rounded-xl font-bold">儲存變更</button></div></div></div></div>)}</div> )}
        {activeTab === "managers" && (
          <div className="space-y-6">
            <Card title="新增區長">
              <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 w-full"><label className="block text-xs font-bold text-stone-400 mb-1">區長姓名</label><input type="text" value={newManager.name} onChange={(e) => setNewManager({ ...newManager, name: e.target.value })} placeholder="例如: Jonas" className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold" /></div>
                <div className="flex-1 w-full"><label className="block text-xs font-bold text-stone-400 mb-1">預設密碼</label><input type="text" value={newManager.password} onChange={(e) => setNewManager({ ...newManager, password: e.target.value })} placeholder="設定密碼" className="w-full px-4 py-2 border-2 border-stone-100 rounded-xl outline-none focus:border-amber-400 font-bold" /></div>
                <button onClick={handleAddManager} className="w-full md:w-auto bg-stone-800 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-stone-700 shadow-sm flex items-center justify-center gap-2"><Plus size={18} /> 新增區長</button>
              </div>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {managerEntries.map(([managerName, stores]) => (
                <Card key={managerName} className={`border ${managerName === UNASSIGNED_KEY ? "border-stone-300 bg-stone-50" : "border-stone-200"}`}>
                  <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
                    <div><h3 className={`text-lg font-bold flex items-center gap-2 ${managerName === UNASSIGNED_KEY ? "text-stone-500" : "text-stone-700"}`}>{managerName === UNASSIGNED_KEY ? <LayoutGrid size={20} /> : <User size={20} className="text-amber-500" />}{managerName} {managerName !== UNASSIGNED_KEY && "區"}</h3>{managerName !== UNASSIGNED_KEY && <p className="text-xs text-stone-400 mt-1 font-mono">密碼: {managerAuth[managerName] || "未設定"}</p>}</div>
                    {managerName !== UNASSIGNED_KEY && (<div className="flex gap-2"><button onClick={() => { setEditingManager(managerName); setEditingManagerStores(stores); }} className="text-xs bg-stone-100 text-stone-600 px-3 py-1.5 rounded-lg hover:bg-stone-200 font-bold whitespace-nowrap">編輯轄區</button><button onClick={() => handleDeleteManager(managerName)} className="text-rose-400 hover:bg-rose-50 p-1.5 rounded-lg"><Trash2 size={16} /></button></div>)}
                  </div>
                  {editingManager === managerName ? (
                    <div className="mt-4 animate-in fade-in bg-stone-50 p-4 rounded-xl border border-stone-200"><label className="block text-xs font-bold text-stone-400 mb-2">已分配店家</label><div className="flex flex-wrap gap-2 mb-4">{editingManagerStores.map((s) => (<div key={s} className="group relative flex items-center"><span className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold text-stone-600 shadow-sm pr-7">{s}</span><button onClick={() => handleRemoveStoreFromEditing(s)} className="absolute right-1 p-1 text-stone-300 hover:text-rose-500 transition-colors"><X size={12} /></button></div>))}</div><div className="mb-4"><label className="block text-xs font-bold text-stone-400 mb-1">新增未分配店家 (從未分配清單選擇)</label><div className="relative"><select onChange={(e) => { handleAddStoreToEditing(e.target.value); e.target.value = ""; }} className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl font-bold bg-white appearance-none text-stone-700"><option value="">+ 點擊選擇店家</option>{availableStoresForManagerEdit.filter((s) => !editingManagerStores.includes(s)).map((s) => (<option key={s} value={s}>{s}</option>))}</select><ChevronDown size={16} className="absolute right-3 top-3 text-stone-400 pointer-events-none"/></div></div><div className="flex gap-2 justify-end"><button onClick={() => setEditingManager(null)} className="px-3 py-1.5 text-xs font-bold text-stone-400 hover:text-stone-600">取消</button><button onClick={() => handleSaveManagerStores(managerName)} className="px-4 py-1.5 bg-stone-800 text-white text-xs font-bold rounded-lg hover:bg-stone-700 shadow-sm">儲存變更</button></div></div>
                  ) : (
                    <div className="flex flex-wrap gap-2 mt-4">{stores.map((s) => (<span key={s} className={`px-2.5 py-1 border rounded-lg text-xs font-bold ${managerName === UNASSIGNED_KEY ? "bg-white border-stone-200 text-stone-400" : "bg-stone-50 border-stone-100 text-stone-600"}`}>{s}</span>))}</div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
        {activeTab === "therapists" && ( <div className="space-y-6"><Card><div className="flex flex-col md:flex-row gap-4 justify-between items-center"><div className="relative w-full md:w-64"><Search className="absolute left-3 top-2.5 text-stone-400" size={16} /><input type="text" placeholder="搜尋姓名或店家..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-amber-400" /></div><button onClick={() => setIsAddingTherapist(true)} className="w-full md:w-auto px-4 py-2 bg-stone-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-stone-700 transition-colors"><Plus size={18} /> 新增人員</button></div></Card>{(isAddingTherapist || editingTherapist) && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"><div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95"><div className="bg-amber-400 p-4 font-bold text-white flex justify-between items-center"><span>{editingTherapist ? "編輯人員資料" : "新增管理師"}</span><button onClick={() => { setIsAddingTherapist(false); setEditingTherapist(null); }}><X size={20}/></button></div><div className="p-6 space-y-4"><div className="grid grid-cols-2 gap-4"><div><label className="text-xs font-bold text-stone-400 block mb-1">區域</label><select value={formManager} onChange={(e) => { setFormManager(e.target.value); setFormStore(""); }} className="w-full p-2 border rounded-lg font-bold bg-stone-50"><option value="">選擇區域</option>{Object.keys(localManagers).map(m => <option key={m} value={m}>{m}區</option>)}</select></div><div><label className="text-xs font-bold text-stone-400 block mb-1">所屬店家</label><select value={formStore} onChange={(e) => setFormStore(e.target.value)} className="w-full p-2 border rounded-lg font-bold bg-stone-50" disabled={!formManager}><option value="">選擇店家</option>{availableStoresForTherapist.map(s => <option key={s} value={s}>{s}</option>)}</select></div></div><div><label className="text-xs font-bold text-stone-400 block mb-1">姓名</label><input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full p-2 border rounded-lg font-bold" placeholder="請輸入姓名" /></div><div><label className="text-xs font-bold text-stone-400 block mb-1">登入密碼 (預設 0000)</label><input type="text" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} className="w-full p-2 border rounded-lg font-mono" placeholder="0000" /></div><div className="pt-4 flex gap-3"><button onClick={() => { setIsAddingTherapist(false); setEditingTherapist(null); }} className="flex-1 py-3 bg-stone-100 text-stone-500 rounded-xl font-bold">取消</button><button onClick={editingTherapist ? handleUpdateTherapist : handleAddTherapist} className="flex-1 py-3 bg-stone-800 text-white rounded-xl font-bold">{editingTherapist ? "儲存修改" : "確認新增"}</button></div></div></div></div>)}<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{filteredTherapists.map(t => (<div key={t.id} className={`bg-white p-4 rounded-xl border-l-4 shadow-sm flex flex-col gap-2 ${t.status === 'resigned' ? 'border-stone-200 opacity-60' : 'border-amber-400'}`}><div className="flex justify-between items-start"><div><div className="text-xs text-stone-400 font-bold mb-1 flex items-center gap-1"><Store size={12}/> {t.store}店</div><div className="text-lg font-bold text-stone-700 flex items-center gap-2">{t.name}{t.status === 'resigned' && <span className="text-[10px] bg-stone-100 px-2 rounded text-stone-500">已離職</span>}</div></div><div className="flex gap-1"><button onClick={() => openEdit(t)} className="p-2 hover:bg-stone-100 rounded-lg text-stone-400" title="編輯"><Edit size={16}/></button><button onClick={() => toggleStatus(t)} className={`p-2 rounded-lg ${t.status === 'active' ? 'hover:bg-rose-50 text-stone-400 hover:text-rose-500' : 'hover:bg-emerald-50 text-stone-400 hover:text-emerald-600'}`} title={t.status === 'active' ? "設為離職" : "復職"}>{t.status === 'active' ? <UserX size={16}/> : <UserCheck size={16}/>}</button></div></div><div className="mt-2 pt-2 border-t border-stone-100 flex justify-between items-center text-sm"><span className="text-stone-400 font-mono text-xs flex items-center gap-1"><Key size={12}/> 密碼: {t.password}</span><button onClick={() => handleDeleteTherapist(t.id)} className="text-stone-300 hover:text-rose-400"><Trash2 size={14}/></button></div></div>))}</div></div> )}
      </div>
    </ViewWrapper>
  );
};

export default SettingsView;