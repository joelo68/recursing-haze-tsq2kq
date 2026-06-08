// src/components/SettingsView.jsx
import React, { useState, useContext, useEffect, useMemo } from "react";
import {
  Save, Plus, Trash2, Edit2, Edit, Lock, User, Store, Target,
  CheckCircle, AlertCircle, X, Shield, ChevronDown, Search,
  UserCheck, UserX, Key, Calendar, DollarSign, Users, LayoutGrid,
  Database, Activity, Clock, Archive, MoreVertical, CheckSquare
} from "lucide-react";
// ★ 確保這裡有引入 getDocs 和 writeBatch
import { 
  doc, setDoc, updateDoc, deleteField, collection, addDoc, deleteDoc, getDoc,
  serverTimestamp, arrayUnion, arrayRemove, getDocs, writeBatch
} from "firebase/firestore";

import { db, appId } from "../config/firebase";
import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";
import { DEFAULT_PERMISSIONS, ALL_MENU_ITEMS } from "../constants/index";
import { generateUUID, normalizeManagerOrder, sortManagersByOrgOrder, sortStoresByOrgOrder } from "../utils/helpers";
import SystemMaintenance from "./SystemMaintenance";

// ★ 引入自訂日曆元件
import SmartDatePicker from "./SmartDatePicker";

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};


const LEGACY_TRAINER_ID = "trainer_default";

const normalizeTrainerAuthData = (data = {}) => {
  const raw = data || {};
  const hasAccounts = raw.accounts && typeof raw.accounts === "object";
  const accounts = hasAccounts ? { ...raw.accounts } : {};
  let trainerOrder = Array.isArray(raw.trainerOrder) ? [...raw.trainerOrder] : [];

  // 舊版相容：原本只有 trainer_auth.password。
  if (!hasAccounts) {
    accounts[LEGACY_TRAINER_ID] = {
      id: LEGACY_TRAINER_ID,
      name: raw.name || "教專",
      password: raw.password || "0000",
      isActive: raw.isActive !== false,
      isLegacyDefault: true,
      createdAtText: raw.createdAtText || "",
      updatedAtText: raw.updatedAtText || "",
    };
    trainerOrder = [LEGACY_TRAINER_ID];
  } else if (Object.keys(accounts).length === 0) {
    accounts[LEGACY_TRAINER_ID] = {
      id: LEGACY_TRAINER_ID,
      name: "教專",
      password: raw.password || "0000",
      isActive: true,
      isLegacyDefault: true,
      createdAtText: "",
      updatedAtText: "",
    };
    trainerOrder = [LEGACY_TRAINER_ID];
  }

  const existingIds = Object.keys(accounts);
  const seen = new Set();
  const normalizedOrder = [];

  trainerOrder.forEach((id) => {
    const key = String(id || "").trim();
    if (key && accounts[key] && !seen.has(key)) {
      seen.add(key);
      normalizedOrder.push(key);
    }
  });

  existingIds
    .filter((id) => !seen.has(id))
    .sort((a, b) => String(accounts[a]?.name || a).localeCompare(String(accounts[b]?.name || b), "zh-Hant", { numeric: true, sensitivity: "base" }))
    .forEach((id) => normalizedOrder.push(id));

  const normalizedAccounts = {};
  normalizedOrder.forEach((id, index) => {
    const account = accounts[id] || {};
    normalizedAccounts[id] = {
      id,
      name: account.name || (id === LEGACY_TRAINER_ID ? "教專" : "未命名教專"),
      password: account.password || "0000",
      isActive: account.isActive !== false,
      sortOrder: Number.isFinite(Number(account.sortOrder)) ? Number(account.sortOrder) : index,
      createdAtText: account.createdAtText || "",
      updatedAtText: account.updatedAtText || "",
      ...account,
    };
  });

  return {
    ...raw,
    accounts: normalizedAccounts,
    trainerOrder: normalizedOrder,
    password: raw.password || normalizedAccounts[normalizedOrder[0]]?.password || "0000",
  };
};

const getSortedTrainerAccounts = (trainerAuth = {}) => {
  const normalized = normalizeTrainerAuthData(trainerAuth);
  return (normalized.trainerOrder || [])
    .map((id) => normalized.accounts?.[id])
    .filter(Boolean);
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
    targets, setTargets, showToast, managers, managerOrder, storeAccounts,
    managerAuth, userRole, permissions, currentUser,
    therapists, therapistTargets, therapistSchedules,
    trainerAuth, handleUpdateTrainerAuth,
    getDocPath, getCollectionPath,
    currentBrand, securityConfig,
    fetchGlobalData // ★ 新增：提取單次抓取函數
  } = useContext(AppContext);

  // ★ 新增：每次進入設定頁面時，自動抓取一次最新資料
  useEffect(() => {
    if (fetchGlobalData) fetchGlobalData();
  }, [fetchGlobalData]);

  const [activeTab, setActiveTab] = useState("");
  const [localTargets, setLocalTargets] = useState(targets || { newASP: 3500, trafficASP: 1200 });
  const [localPermissions, setLocalPermissions] = useState(permissions || DEFAULT_PERMISSIONS);
  const [localManagers, setLocalManagers] = useState(managers || {});
  const [localManagerOrder, setLocalManagerOrder] = useState(normalizeManagerOrder(managers || {}, managerOrder));
  
  const DEFAULT_SECURITY_CONFIG = {
    // 舊版相容：enabled / timeoutMinutes 仍保留，避免舊程式讀不到
    enabled: true,
    timeoutMinutes: 240,
    warningSeconds: 60,
    exemptRoles: ["director", "master"],

    // 新版：閒置省流量待機
    lowPowerEnabled: true,
    lowPowerIdleMinutes: 30,

    // 新版：自動登出
    autoLogoutEnabled: true,
    autoLogoutMinutes: 240,
    logoutWarningSeconds: 60,
  };

  const [localSecurityConfig, setLocalSecurityConfig] = useState(DEFAULT_SECURITY_CONFIG);

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

  useEffect(() => {
    if (managers) {
      setLocalManagers(managers);
      setLocalManagerOrder(normalizeManagerOrder(managers || {}, managerOrder));
    }
  }, [managers, managerOrder]);
  useEffect(() => { if (permissions) setLocalPermissions(permissions); }, [permissions]);
  useEffect(() => { 
    if (targets) {
      setLocalTargets(prev => ({
        ...prev,
        ...targets,
        newASP: Number(targets?.newASP ?? 3500),
        trafficASP: Number(targets?.trafficASP ?? 1200),
        benchmarks: targets.benchmarks || prev.benchmarks || DEFAULT_BENCHMARKS_INIT
      }));
    }
  }, [targets]);
  
  useEffect(() => {
    if (securityConfig) {
      setLocalSecurityConfig({
        ...DEFAULT_SECURITY_CONFIG,
        ...securityConfig,
        autoLogoutEnabled: securityConfig.autoLogoutEnabled ?? securityConfig.enabled ?? true,
        autoLogoutMinutes: Number(securityConfig.autoLogoutMinutes ?? securityConfig.timeoutMinutes ?? 240),
        logoutWarningSeconds: Number(securityConfig.logoutWarningSeconds ?? securityConfig.warningSeconds ?? 60),
        lowPowerEnabled: securityConfig.lowPowerEnabled ?? true,
        lowPowerIdleMinutes: Number(securityConfig.lowPowerIdleMinutes ?? 30),
      });
    }
  }, [securityConfig]);

  const [newStoreAccount, setNewStoreAccount] = useState({ name: "", password: "", stores: "" });
  const [editingStoreAccount, setEditingStoreAccount] = useState(null);
  const [editStoreForm, setEditStoreForm] = useState({ name: "", password: "", stores: [] });
  const [newManager, setNewManager] = useState({ name: "", password: "" });
  const [editingManager, setEditingManager] = useState(null);
  const [editingManagerStores, setEditingManagerStores] = useState([]);
  const [editingReleasedStores, setEditingReleasedStores] = useState([]);
  const [editingManagerName, setEditingManagerName] = useState("");
  const [editingManagerPassword, setEditingManagerPassword] = useState("");
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
  
  const [newTrainerName, setNewTrainerName] = useState("");
  const [newTrainerPass, setNewTrainerPass] = useState("0000");
  const [editingTrainerId, setEditingTrainerId] = useState("");
  const [editingTrainerName, setEditingTrainerName] = useState("");
  const [editingTrainerPass, setEditingTrainerPass] = useState("");
  
  const [showResigned, setShowResigned] = useState(false);

  const UNASSIGNED_KEY = "未分配"; 

  const directorLevel = currentUser?.directorLevel || currentUser?.adminLevel || (String(currentUser?.name || "").includes("Joe") ? "super_admin" : "operation_admin");
  const isDirectorSuperAdmin = userRole !== "director" || currentUser?.isMasterLogin === true || directorLevel === "super_admin";

  const visibleTabs = useMemo(() => {
    const tabs = [];
    const myPerms = permissions?.[userRole] || [];

    // Director Permission v1：
    // 系統管理中心屬高風險區，第一階段只允許最高管理者 / Master 登入者進入。
    if (userRole === "director" && !isDirectorSuperAdmin) {
      return [];
    }
    const allTabsDefinition = [
      { id: "kpi", label: "KPI 參數", isAdminOnly: true, icon: Target },
      { id: "health", label: "標準設定", isAdminOnly: true, icon: Activity },
      { id: "permissions", label: "權限資安", isAdminOnly: true, icon: Shield },
      { id: "trainer-account", label: "教專帳號", isAdminOnly: true, icon: Users }, 
      { id: "shops", label: "店家管理", isAdminOnly: true, icon: Store },
      { id: "stores", label: "店經帳號", isAdminOnly: true, icon: UserCheck },
      { id: "managers", label: "區長架構", isAdminOnly: true, icon: LayoutGrid },
      //{ id: "therapists", label: "人員帳號", isAdminOnly: true, icon: User },
      { id: "maintenance", label: "系統維護", isAdminOnly: true, icon: Database }
    ];
    allTabsDefinition.forEach(tab => {
      if (userRole === 'director') tabs.push(tab);
      else if (!tab.isAdminOnly && tab.permissionId && myPerms.includes(tab.permissionId)) tabs.push(tab);
    });
    return tabs;
  }, [userRole, permissions, isDirectorSuperAdmin]);

  useEffect(() => {
    if (visibleTabs.length > 0) {
      const isCurrentTabValid = visibleTabs.some(t => t.id === activeTab);
      if (!activeTab || !isCurrentTabValid) setActiveTab(visibleTabs[0].id);
    }
  }, [visibleTabs, activeTab]);

  const normalizeStoreList = (stores = []) => [...new Set((stores || []).filter(Boolean))];

  const buildStableManagerOrder = (nextManagers = localManagers, preferredOrder = localManagerOrder) => {
    return normalizeManagerOrder(nextManagers || {}, preferredOrder || []);
  };

  const saveOrgStructure = async (docRef, nextManagers, preferredOrder = localManagerOrder, useUpdate = false) => {
    const nextManagerOrder = buildStableManagerOrder(nextManagers, preferredOrder);
    const payload = { managers: nextManagers, managerOrder: nextManagerOrder };
    if (useUpdate) await updateDoc(docRef, payload);
    else await setDoc(docRef, payload);
    setLocalManagers(nextManagers);
    setLocalManagerOrder(nextManagerOrder);
  };

  const createOrgStructureSnapshot = async (action, beforeManagers, extra = {}) => {
    try {
      await addDoc(getCollectionPath("org_structure_snapshots"), {
        brandId: currentBrand?.id || "unknown",
        brandLabel: currentBrand?.label || currentBrand?.name || currentBrand?.id || "目前品牌",
        action,
        managers: JSON.parse(JSON.stringify(beforeManagers || {})),
        managerKeys: Object.keys(beforeManagers || {}),
        managerOrder: buildStableManagerOrder(beforeManagers || {}),
        storeCount: Object.values(beforeManagers || {}).flat().filter(Boolean).length,
        operator: currentUser?.name || userRole || "director",
        operatorRole: userRole || "unknown",
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
        ...extra,
      });

      await addDoc(getCollectionPath("maintenance_logs"), {
        type: "org_structure_snapshot",
        action,
        brandId: currentBrand?.id || "unknown",
        brandLabel: currentBrand?.label || currentBrand?.name || currentBrand?.id || "目前品牌",
        operator: currentUser?.name || userRole || "director",
        operatorRole: userRole || "unknown",
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
        details: extra?.details || "org_structure 修改前自動建立快照",
      });
    } catch (error) {
      console.warn("org_structure snapshot failed:", error);
      // 快照失敗不阻擋主要操作，避免維護動作卡住；正式環境會在 console 與 maintenance_logs 追查。
    }
  };


  const trainerAuthData = useMemo(() => normalizeTrainerAuthData(trainerAuth || {}), [trainerAuth]);

  const trainerAccounts = useMemo(() => {
    const normalized = normalizeTrainerAuthData(trainerAuth || {});
    return (normalized.trainerOrder || [])
      .map((id) => normalized.accounts?.[id])
      .filter(Boolean);
  }, [trainerAuth]);

  const beginEditTrainer = (account) => {
    setEditingTrainerId(account?.id || "");
    setEditingTrainerName(account?.name || "");
    setEditingTrainerPass(account?.password || "0000");
  };

  const cancelEditTrainer = () => {
    setEditingTrainerId("");
    setEditingTrainerName("");
    setEditingTrainerPass("");
  };

  const handleAddTrainerAccount = async () => {
    const name = String(newTrainerName || "").trim();
    const password = String(newTrainerPass || "0000").trim() || "0000";
    if (!name) return showToast("請輸入教專姓名", "error");

    const duplicated = trainerAccounts.some((a) => String(a?.name || "").trim() === name);
    if (duplicated) return showToast("教專姓名已存在", "error");

    const success = await handleUpdateTrainerAuth("add", null, { name, password, isActive: true });
    if (success) {
      showToast("已新增教專帳號", "success");
      setNewTrainerName("");
      setNewTrainerPass("0000");
      if (fetchGlobalData) fetchGlobalData();
    } else {
      showToast("新增失敗", "error");
    }
  };

  const handleSaveTrainerAccount = async (id) => {
    const name = String(editingTrainerName || "").trim();
    const password = String(editingTrainerPass || "0000").trim() || "0000";
    if (!id || !name) return showToast("請輸入教專姓名", "error");

    const duplicated = trainerAccounts.some((a) => a.id !== id && String(a?.name || "").trim() === name);
    if (duplicated) return showToast("教專姓名已存在", "error");

    const success = await handleUpdateTrainerAuth("update", id, { name, password });
    if (success) {
      showToast("教專帳號已更新", "success");
      cancelEditTrainer();
      if (fetchGlobalData) fetchGlobalData();
    } else {
      showToast("更新失敗", "error");
    }
  };

  const handleToggleTrainerAccount = async (account) => {
    if (!account?.id) return;
    const nextActive = account.isActive === false;
    const success = await handleUpdateTrainerAuth("toggle", account.id, { isActive: nextActive });
    if (success) {
      showToast(nextActive ? "教專帳號已啟用" : "教專帳號已停用", "success");
      if (fetchGlobalData) fetchGlobalData();
    } else {
      showToast("狀態更新失敗", "error");
    }
  };

  const handleDeleteTrainerAccount = async (account) => {
    if (!account?.id) return;
    if (trainerAccounts.length <= 1) {
      showToast("至少需保留一位教專帳號", "error");
      return;
    }
    if (!window.confirm(`確定刪除「${account.name}」的教專帳號嗎？`)) return;

    const success = await handleUpdateTrainerAuth("delete", account.id);
    if (success) {
      showToast("教專帳號已刪除", "success");
      if (editingTrainerId === account.id) cancelEditTrainer();
      if (fetchGlobalData) fetchGlobalData();
    } else {
      showToast("刪除失敗", "error");
    }
  };

  const moveTrainerAccount = async (id, direction) => {
    const order = trainerAccounts.map((a) => a.id);
    const index = order.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const nextOrder = [...order];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];

    const success = await handleUpdateTrainerAuth("reorder", null, { trainerOrder: nextOrder });
    if (success) {
      showToast("教專排序已更新", "success");
      if (fetchGlobalData) fetchGlobalData();
    } else {
      showToast("排序更新失敗", "error");
    }
  };

  const managerEntries = useMemo(() => {
    const currentManagers = JSON.parse(JSON.stringify(localManagers || {}));

    if (!Array.isArray(currentManagers[UNASSIGNED_KEY])) currentManagers[UNASSIGNED_KEY] = [];

    // 編輯轄區時，畫面上先做「暫存預覽」：
    // 1. 從區長移除的店家，立即顯示在未分配。
    // 2. 從未分配加入區長的店家，立即從未分配隱藏。
    // 實際 Firestore 寫入仍然等到按「儲存名稱與轄區」才執行，取消可完整還原畫面。
    if (editingManager && currentManagers[editingManager]) {
      const originalStores = normalizeStoreList(currentManagers[editingManager] || []);
      const currentEditingStores = normalizeStoreList(editingManagerStores || []);
      const releasedStores = originalStores.filter((s) => !currentEditingStores.includes(s));
      const newlyAssignedStores = currentEditingStores.filter((s) => !originalStores.includes(s));

      currentManagers[UNASSIGNED_KEY] = normalizeStoreList([
        ...(currentManagers[UNASSIGNED_KEY] || []),
        ...releasedStores,
        ...editingReleasedStores,
      ]).filter((s) => !newlyAssignedStores.includes(s));
    }

    const entries = Object.entries(currentManagers);
    const hasUnassigned = entries.some(([key]) => key === UNASSIGNED_KEY);
    if (!hasUnassigned) entries.push([UNASSIGNED_KEY, []]);

    const orderedKeys = normalizeManagerOrder(currentManagers, localManagerOrder);
    const rank = new Map(orderedKeys.map((key, index) => [key, index]));
    return entries.sort((a, b) => {
      const ar = rank.has(a[0]) ? rank.get(a[0]) : 9999;
      const br = rank.has(b[0]) ? rank.get(b[0]) : 9999;
      if (ar !== br) return ar - br;
      return a[0].localeCompare(b[0], "zh-Hant");
    });
  }, [localManagers, localManagerOrder, editingManager, editingManagerStores, editingReleasedStores]);

  
  const handleSaveTargets = async () => {
    try {
      const nextTargets = {
        ...localTargets,
        newASP: Number(localTargets?.newASP ?? 3500),
        trafficASP: Number(localTargets?.trafficASP ?? 1200),
        benchmarks: localTargets?.benchmarks || DEFAULT_BENCHMARKS_INIT,
      };
      await setDoc(getDocPath("kpi_targets"), nextTargets, { merge: true });
      setTargets(nextTargets);
      setLocalTargets(nextTargets);
      showToast("KPI 參數已儲存", "success");
    } catch (e) {
      console.error("KPI 參數儲存失敗:", e);
      showToast("儲存失敗", "error");
    }
  };
  const handleSavePermissions = async () => { try { await setDoc(getDocPath("permissions"), localPermissions); showToast("權限設定已更新", "success"); if (fetchGlobalData) fetchGlobalData(); } catch (e) { showToast("更新失敗", "error"); } };
  const togglePermission = (role, menuId) => { const current = localPermissions[role] || []; const updated = current.includes(menuId) ? current.filter((id) => id !== menuId) : [...current, menuId]; setLocalPermissions({ ...localPermissions, [role]: updated }); };
  
  const handleSaveSecurityConfig = async () => { 
    try {
      const lowPowerIdleMinutes = Math.max(1, Number(localSecurityConfig.lowPowerIdleMinutes || 30));
      const autoLogoutMinutes = Math.max(1, Number(localSecurityConfig.autoLogoutMinutes || localSecurityConfig.timeoutMinutes || 240));
      const logoutWarningSeconds = Math.max(5, Number(localSecurityConfig.logoutWarningSeconds || localSecurityConfig.warningSeconds || 60));

      // 省流量待機與自動登出為兩套獨立邏輯：
      // 主管可豁免自動登出，但仍需要依省流時間進入待機；
      // 因此不再強制要求「省流量時間」必須小於「自動登出時間」。
      if (!Number.isFinite(lowPowerIdleMinutes) || lowPowerIdleMinutes < 1) {
        showToast("省流量待機時間至少需為 1 分鐘", "error");
        return;
      }

      if (!Number.isFinite(autoLogoutMinutes) || autoLogoutMinutes < 1) {
        showToast("自動登出時間至少需為 1 分鐘", "error");
        return;
      }

      if (!Number.isFinite(logoutWarningSeconds) || logoutWarningSeconds < 5) {
        showToast("登出前倒數提醒至少需為 5 秒", "error");
        return;
      }

      const payload = {
        ...localSecurityConfig,
        lowPowerEnabled: Boolean(localSecurityConfig.lowPowerEnabled),
        lowPowerIdleMinutes,
        autoLogoutEnabled: Boolean(localSecurityConfig.autoLogoutEnabled),
        autoLogoutMinutes,
        logoutWarningSeconds,

        // 舊版相容欄位：App 舊邏輯或其他頁面仍可讀
        enabled: Boolean(localSecurityConfig.autoLogoutEnabled),
        timeoutMinutes: autoLogoutMinutes,
        warningSeconds: logoutWarningSeconds,
        exemptRoles: localSecurityConfig.exemptRoles || ["director", "master"],
      };

      await setDoc(getDocPath("security_config"), payload); 
      setLocalSecurityConfig(payload);
      showToast("資安、省流量與閒置控管已更新", "success"); 
      if (fetchGlobalData) fetchGlobalData();
    } catch (e) {
      console.error(e);
      showToast("更新失敗", "error");
    } 
  };

  const handleBenchmarkChange = (categoryId, field, value, type) => {
    let numValue = parseFloat(value);
    if (isNaN(numValue)) numValue = 0;
    if (type === 'percent') numValue = numValue / 100;
    setLocalTargets(prev => ({ ...prev, benchmarks: { ...prev.benchmarks, [brandKey]: { ...(prev.benchmarks?.[brandKey] || DEFAULT_BENCHMARKS_INIT["default"]), [categoryId]: { ...(prev.benchmarks?.[brandKey]?.[categoryId] || DEFAULT_BENCHMARKS_INIT["default"][categoryId]), [field]: numValue } } } }));
  };

  const handleAddGlobalStore = async () => {
    if (!newShop.name || !newShop.manager) return showToast("請輸入完整資訊", "error");

    try {
      const targetManager = newShop.manager;
      const docRef = getDocPath("org_structure");
      const docSnap = await getDoc(docRef);
      const beforeManagers = docSnap.exists() ? JSON.parse(JSON.stringify(docSnap.data().managers || {})) : {};

      await createOrgStructureSnapshot("add_store_to_manager", beforeManagers, {
        targetManager,
        storeName: newShop.name,
        details: `新增店家 ${newShop.name} 至 ${targetManager}`,
      });

      const storeName = String(newShop.name || "").trim();
      const newManagers = JSON.parse(JSON.stringify(beforeManagers || {}));

      // 重要：任何店家被指派到某個區長時，必須先從所有區塊移除，再加入目標區長。
      // 這可避免同一間店同時存在於「未分配」與已分配區長，造成畫面重複與營運總覽歸屬混亂。
      Object.keys(newManagers).forEach((managerName) => {
        if (Array.isArray(newManagers[managerName])) {
          newManagers[managerName] = normalizeStoreList(newManagers[managerName]).filter((s) => s !== storeName);
        } else {
          newManagers[managerName] = [];
        }
      });

      if (!Array.isArray(newManagers[targetManager])) newManagers[targetManager] = [];
      newManagers[targetManager] = normalizeStoreList([...newManagers[targetManager], storeName]);
      if (!Array.isArray(newManagers[UNASSIGNED_KEY])) newManagers[UNASSIGNED_KEY] = [];

      await saveOrgStructure(docRef, newManagers, localManagerOrder, true);
      setNewShop({ name: "", manager: "" });
      showToast("已新增，並建立修改前快照", "success");
      if (fetchGlobalData) fetchGlobalData();
    } catch (e) {
      showToast("失敗: " + e.message, "error");
    }
  };

  const handleDeleteGlobalStore = async (storeName, managerName) => {
    const isPermanentDelete = managerName === UNASSIGNED_KEY;
    if (!confirm(isPermanentDelete ? "確定永久刪除此店家？" : "確定將此店家移至『未分配』名單？")) return;

    try {
      const docRef = getDocPath("org_structure");
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) throw new Error("讀取設定檔失敗");

      const beforeManagers = JSON.parse(JSON.stringify(docSnap.data().managers || {}));
      await createOrgStructureSnapshot(isPermanentDelete ? "permanent_delete_unassigned_store" : "move_store_to_unassigned", beforeManagers, {
        managerName,
        storeName,
        details: isPermanentDelete ? `從未分配永久刪除店家 ${storeName}` : `將 ${managerName} 的 ${storeName} 移至未分配`,
      });

      const newManagers = JSON.parse(JSON.stringify(beforeManagers));
      if (Array.isArray(newManagers[managerName])) {
        newManagers[managerName] = newManagers[managerName].filter((x) => x !== storeName);
      }

      if (!isPermanentDelete) {
        if (!Array.isArray(newManagers[UNASSIGNED_KEY])) newManagers[UNASSIGNED_KEY] = [];
        if (!newManagers[UNASSIGNED_KEY].includes(storeName)) newManagers[UNASSIGNED_KEY].push(storeName);
      }

      await saveOrgStructure(docRef, newManagers, localManagerOrder);
      showToast(isPermanentDelete ? "已永久刪除，並建立快照" : "已移至未分配，並建立快照", "success");
      if (fetchGlobalData) fetchGlobalData();
    } catch (e) {
      console.error(e);
      showToast("失敗: " + e.message, "error");
    }
  };

  const openEditManager = (managerName, stores = []) => {
    setEditingManager(managerName);
    setEditingManagerName(managerName);
    setEditingManagerPassword(managerAuth?.[managerName] || "");
    setEditingManagerStores(normalizeStoreList(stores));
    setEditingReleasedStores([]);
  };

  const cancelEditManager = () => {
    setEditingManager(null);
    setEditingManagerName("");
    setEditingManagerPassword("");
    setEditingManagerStores([]);
    setEditingReleasedStores([]);
  };

  const handleSaveManagerStores = async (name) => {
    try {
      const nextName = String(editingManagerName || "").trim();
      if (!nextName) return showToast("請輸入區長姓名", "error");
      if (nextName === UNASSIGNED_KEY) return showToast("區長姓名不可使用『未分配』", "error");

      const docRef = getDocPath("org_structure");
      const docSnap = await getDoc(docRef);
      const freshManagers = docSnap.exists()
        ? JSON.parse(JSON.stringify(docSnap.data().managers || {}))
        : {};

      if (nextName !== name && freshManagers[nextName]) {
        showToast(`區長「${nextName}」已存在，請使用其他名稱`, "error");
        return;
      }

      const originalStores = normalizeStoreList(freshManagers[name] || []);
      const nextStores = normalizeStoreList(editingManagerStores || []);
      const removedStores = originalStores.filter((s) => !nextStores.includes(s));

      // 重新組裝 managers，避免儲存後被移除的店家消失。
      // 原則：
      // 1. 編輯中的區長使用 nextStores。
      // 2. 從區長移除的店家 + 編輯過程暫存移除店家，一律放回「未分配」。
      // 3. 被重新分配到區長的店家，需從「未分配」移除。
      // 4. 任何店家只允許出現在一個區塊，避免重複造成總覽判讀混亂。
      const finalManagers = {};
      const storesAssignedToEditedManager = new Set(nextStores);

      Object.entries(freshManagers).forEach(([managerName, stores]) => {
        if (managerName === name || managerName === nextName || managerName === UNASSIGNED_KEY) return;

        // 保險：如果某些店家被加入此次編輯區長，其他區長名下要移除，避免重複歸屬。
        finalManagers[managerName] = normalizeStoreList(stores).filter(
          (s) => !storesAssignedToEditedManager.has(s)
        );
      });

      const existingUnassigned = normalizeStoreList(freshManagers[UNASSIGNED_KEY] || []);
      const nextUnassigned = normalizeStoreList([
        ...existingUnassigned,
        ...removedStores,
        ...editingReleasedStores,
      ]).filter((s) => !storesAssignedToEditedManager.has(s));

      finalManagers[nextName] = nextStores;
      finalManagers[UNASSIGNED_KEY] = nextUnassigned;

      await createOrgStructureSnapshot(nextName !== name ? "rename_manager_and_update_stores" : "update_manager_stores", freshManagers, {
        managerName: name,
        nextName,
        removedStores,
        nextStores,
        details: nextName !== name
          ? `區長 ${name} 改名為 ${nextName}，並更新轄區`
          : `更新區長 ${name} 轄區`,
      });

      // 重要：這裡不能用 setDoc(..., { merge: true })。
      // Firestore 對巢狀 map 進行 merge 時，會保留 managers 裡沒有被傳入的舊 key，
      // 造成「改名」時舊區長 key 沒被移除，畫面看起來像複製出一位新區長。
      // 使用 updateDoc({ managers: finalManagers }) 才會把整個 managers map 正確替換。
      const renamedManagerOrder = normalizeManagerOrder(finalManagers, localManagerOrder.map((item) => item === name ? nextName : item));
      await saveOrgStructure(docRef, finalManagers, renamedManagerOrder, true);

      // 同步更新區長登入資料；若有改名，移除舊 key，避免留下無效帳號。
      const authPayload = { [nextName]: editingManagerPassword || managerAuth?.[name] || "" };
      if (nextName !== name) authPayload[name] = deleteField();
      await setDoc(getDocPath("manager_auth"), authPayload, { merge: true });

      cancelEditManager();
      showToast(
        removedStores.length > 0
          ? `區長名稱與轄區已更新，${removedStores.length} 間店已移至未分配`
          : "區長名稱與管理區域已更新",
        "success"
      );
      if (fetchGlobalData) fetchGlobalData();
    } catch (e) {
      console.error(e);
      showToast("更新失敗", "error");
    }
  };
  const availableUnassignedStores = useMemo(() => { const all = Object.values(localManagers || {}).flat(); const assigned = storeAccounts.flatMap(a=>a.stores||[]); return sortStoresByOrgOrder(localManagers, all.filter(s=>!assigned.includes(s)), "", localManagerOrder); }, [localManagers, localManagerOrder, storeAccounts]);
  const availableStoresForManagerEdit = useMemo(() => {
    const base = localManagers && localManagers[UNASSIGNED_KEY] ? localManagers[UNASSIGNED_KEY] : [];
    return sortStoresByOrgOrder(localManagers, normalizeStoreList([...base, ...editingReleasedStores]), "", localManagerOrder);
  }, [localManagers, editingReleasedStores]);
  const availableStoresForEditing = useMemo(() => { const all = Object.values(localManagers || {}).flat(); const assigned = storeAccounts.filter(a=>a.id!==editingStoreAccount?.id).flatMap(a=>a.stores||[]); return sortStoresByOrgOrder(localManagers, all.filter(s=>!assigned.includes(s) && !editStoreForm.stores.includes(s)), "", localManagerOrder); }, [localManagers, localManagerOrder, storeAccounts, editingStoreAccount, editStoreForm]);
  const handleAddStoreAccount = async () => { if(!newStoreAccount.name || !newStoreAccount.password) return showToast("請輸入完整", "error"); const newAcc = { id: generateUUID(), ...newStoreAccount, stores: newStoreAccount.stores?[newStoreAccount.stores]:[] }; try { await setDoc(getDocPath("store_account_data"), { accounts: [...storeAccounts, newAcc] }); setNewStoreAccount({name:"", password:"", stores:""}); showToast("已新增", "success"); if (fetchGlobalData) fetchGlobalData(); } catch(e){ showToast("失敗", "error"); } };
  const openEditStoreAccount = (account) => { setEditingStoreAccount(account); setEditStoreForm({ name: account.name, password: account.password, stores: account.stores || [] }); };
  const handleAddStoreToEditForm = (storeName) => { if (storeName && !editStoreForm.stores.includes(storeName)) { setEditStoreForm({ ...editStoreForm, stores: [...editStoreForm.stores, storeName] }); } };
  const handleRemoveStoreFromEditForm = (storeName) => { setEditStoreForm({ ...editStoreForm, stores: editStoreForm.stores.filter(s => s !== storeName) }); };
  const handleUpdateStoreAccount = async () => { if(!editStoreForm.name) return; const newAccs = storeAccounts.map(a => a.id === editingStoreAccount.id ? { ...a, ...editStoreForm } : a); await setDoc(getDocPath("store_account_data"), { accounts: newAccs }); setEditingStoreAccount(null); showToast("已更新", "success"); if (fetchGlobalData) fetchGlobalData(); };
  const handleDeleteStoreAccount = async (id) => { if(!confirm("確定?")) return; const newAccs = storeAccounts.filter(a=>a.id!==id); await setDoc(getDocPath("store_account_data"), { accounts: newAccs }); showToast("已刪除", "success"); if (fetchGlobalData) fetchGlobalData(); };
  const handleAddManager = async () => {
    if (!newManager.name) return;
    try {
      const docRef = getDocPath("org_structure");
      const docSnap = await getDoc(docRef);
      const beforeManagers = docSnap.exists() ? JSON.parse(JSON.stringify(docSnap.data().managers || {})) : {};

      if (beforeManagers[newManager.name]) {
        showToast(`區長「${newManager.name}」已存在`, "error");
        return;
      }

      await createOrgStructureSnapshot("add_manager", beforeManagers, {
        managerName: newManager.name,
        details: `新增區長 ${newManager.name}`,
      });

      const newManagers = JSON.parse(JSON.stringify(beforeManagers || {}));
      newManagers[newManager.name] = [];
      if (!Array.isArray(newManagers[UNASSIGNED_KEY])) newManagers[UNASSIGNED_KEY] = [];

      const nextManagerOrder = normalizeManagerOrder(newManagers, [
        ...localManagerOrder.filter((name) => name !== UNASSIGNED_KEY),
        newManager.name,
        UNASSIGNED_KEY,
      ]);
      await saveOrgStructure(docRef, newManagers, nextManagerOrder);
      await setDoc(getDocPath("manager_auth"), { [newManager.name]: newManager.password }, { merge: true });
      setNewManager({ name: "", password: "" });
      showToast("已新增區長，並建立快照", "success");
      if (fetchGlobalData) fetchGlobalData();
    } catch (e) {
      showToast("失敗", "error");
    }
  };
  const handleAddStoreToEditing = (storeName) => {
    if (!storeName) return;
    if (!editingManagerStores.includes(storeName)) {
      setEditingManagerStores([...editingManagerStores, storeName]);
    }
    setEditingReleasedStores((prev) => prev.filter((s) => s !== storeName));
  };

  const handleRemoveStoreFromEditing = (storeName) => {
    setEditingManagerStores(editingManagerStores.filter((s) => s !== storeName));
    setEditingReleasedStores((prev) => normalizeStoreList([...prev, storeName]));
  };
  const handleDeleteManager = async (name) => {
    if (!confirm(`確定要刪除區長「${name}」嗎？\n\n此操作不會刪除店家，該區長底下店家會自動移至「未分配」。`)) return;

    try {
      const docRef = getDocPath("org_structure");
      const docSnap = await getDoc(docRef);
      let newManagers = docSnap.exists() ? JSON.parse(JSON.stringify(docSnap.data().managers || {})) : {};

      await createOrgStructureSnapshot("delete_manager", newManagers, {
        managerName: name,
        storesToMove: normalizeStoreList(newManagers[name] || []),
        details: `刪除區長 ${name}，底下店家移至未分配`,
      });

      const storesToMove = normalizeStoreList(newManagers[name] || []);
      if (!Array.isArray(newManagers[UNASSIGNED_KEY])) newManagers[UNASSIGNED_KEY] = [];

      storesToMove.forEach((s) => {
        if (!newManagers[UNASSIGNED_KEY].includes(s)) newManagers[UNASSIGNED_KEY].push(s);
      });

      delete newManagers[name];
      newManagers[UNASSIGNED_KEY] = normalizeStoreList(newManagers[UNASSIGNED_KEY]);

      await setDoc(docRef, { managers: newManagers });
      await setDoc(getDocPath("manager_auth"), { [name]: deleteField() }, { merge: true });

      setLocalManagers(newManagers);
      showToast(`已刪除區長，${storesToMove.length} 間店已移至未分配`, "success");
      if (fetchGlobalData) fetchGlobalData();
    } catch (e) {
      console.error(e);
      showToast("刪除失敗", "error");
    }
  };
  
  const handleAddTherapist = async () => { 
    if(!formName) return showToast("請輸入姓名", "error"); 
    try { 
      await addDoc(getCollectionPath("therapists"), { 
        name: formName,
        store: formStore,
        storeName: formStore,
        stores: formStore ? [formStore] : [],
        manager: formManager,
        managerName: formManager,
        region: formManager,
        password: formPassword, 
        status: 'active',
        isActive: true,
        onboardDate: formOnboardDate, 
        resignDate: formResignDate,   
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedAtText: new Date().toISOString(),
      }); 
      setIsAddingTherapist(false); 
      setFormName(""); 
      showToast("已新增", "success"); 
      if (fetchGlobalData) fetchGlobalData();
    } catch(e) { showToast("失敗", "error"); } 
  };

  const handleUpdateTherapist = async () => { 
    if(!editingTherapist) return; 
    const ref = doc(getCollectionPath("therapists"), editingTherapist.id); 
    await updateDoc(ref, { 
      name: formName,
      store: formStore,
      storeName: formStore,
      stores: formStore ? [formStore] : [],
      manager: formManager,
      managerName: formManager,
      region: formManager,
      password: formPassword,
      onboardDate: formOnboardDate,
      resignDate: formResignDate,
      updatedAt: serverTimestamp(),
      updatedAtText: new Date().toISOString(),
    }); 
    setEditingTherapist(null); 
    showToast("已更新", "success"); 
    if (fetchGlobalData) fetchGlobalData();
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
    if (fetchGlobalData) fetchGlobalData();
  };

  const handleDeleteTherapist = async (id) => { if(!confirm("確定要永久刪除此帳號？(這將導致該員歷史報表數據遺失，建議使用帳號暫停代替)")) return; await deleteDoc(doc(getCollectionPath("therapists"), id)); showToast("已徹底刪除", "success"); if (fetchGlobalData) fetchGlobalData(); };
  
  const openEdit = (t) => { 
    setEditingTherapist(t); 
    setFormManager(t.manager || t.managerName || t.region || ""); 
    setFormStore(t.store || t.storeName || (Array.isArray(t.stores) ? t.stores[0] : "")); 
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
    setFormOnboardDate(getTodayStr()); 
    setFormResignDate("");
  };

  const availableStoresForTherapist = useMemo(() => formManager ? sortStoresByOrgOrder(localManagers, (localManagers && localManagers[formManager]?localManagers[formManager]:[]), "", localManagerOrder) : [], [formManager, localManagers, localManagerOrder]);
  
  const filteredTherapists = useMemo(() => { 
    return therapists.filter(t => {
      const therapistStoreName = t.store || t.storeName || (Array.isArray(t.stores) ? t.stores[0] : "");
      const searchMatch = (t.name || "").includes(searchTerm) || therapistStoreName.includes(searchTerm);
      if (!searchMatch) return false;

      const isResigned = t.isResigned === true || t.resigned === true || t.status === 'resigned' || t.status === '離職' || t.isActive === false;

      return showResigned ? isResigned : !isResigned;
    }); 
  }, [therapists, searchTerm, showResigned]);

  if (visibleTabs.length === 0) return <ViewWrapper><Card title="權限不足"><div className="text-center py-10 text-[#A69C91]"><Lock size={48} className="mx-auto mb-4 opacity-50" /><p>您沒有權限存取此頁面</p></div></Card></ViewWrapper>;

  return (
    <ViewWrapper>
      <div className="grid grid-cols-1 w-[99%] max-w-full gap-6 pb-20 mx-auto">
        
        <div className="relative overflow-hidden rounded-[2rem] border border-[#EFE7DA] bg-gradient-to-br from-[#FFFCF7] via-[#FFF8EF] to-[#F8EFE2] p-6 shadow-[0_18px_50px_rgba(90,74,54,0.08)]">
          <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#F3DFB8]/50 blur-3xl pointer-events-none" />
          <div className="absolute -left-24 bottom-0 h-48 w-48 rounded-full bg-[#FFFCF7]/70 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col gap-4 w-full min-w-0">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
              <div>
                <p className="text-[11px] font-black tracking-[0.28em] text-[#B7863D] mb-2">SYSTEM SETTINGS</p>
                <h2 className="text-2xl md:text-3xl font-black text-[#2F2923] tracking-tight">系統管理中心</h2>
                <p className="text-sm font-bold text-[#A69C91] mt-2">品牌營運參數、權限資安、帳號架構與系統維護設定。</p>
              </div>
              <div className="hidden md:flex h-12 w-12 rounded-2xl bg-[#FFFCF7]/70 border border-[#F3DFB8] items-center justify-center shadow-sm">
                <Shield size={22} className="text-[#B7863D]" />
              </div>
            </div>
            
            <div className="w-full bg-[#FFFCF7]/75 backdrop-blur p-1.5 rounded-2xl shadow-sm border border-[#EFE7DA] overflow-x-auto no-scrollbar">
              <div className="flex gap-2 min-w-max p-1">
                  {visibleTabs.map((tab) => (
                      <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2.5 rounded-xl text-sm font-black whitespace-nowrap transition-all flex items-center gap-2 ${activeTab === tab.id ? "bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] shadow-[0_8px_20px_rgba(183,134,61,0.16)] border border-[#E8C77A]" : "text-[#7C7063] hover:bg-[#FAF7F1]"}`}>{tab.icon && <tab.icon size={16}/>}{tab.label}</button>
                  ))}
              </div>
            </div>
          </div>
        </div>

        {activeTab === "kpi" && (<Card title="KPI 目標參數"><div className="max-w-md w-full space-y-6 min-w-0"><div><label className="block text-sm font-bold text-[#7C7063] mb-2">目標新客客單</label><input type="number" value={localTargets.newASP ?? 3500} onChange={(e) => setLocalTargets({...localTargets, newASP: Number(e.target.value)})} className="w-full px-4 py-3 border-2 rounded-xl outline-none focus:border-[#D6A84F]"/></div><div><label className="block text-sm font-bold text-[#7C7063] mb-2">目標消耗客單</label><input type="number" value={localTargets.trafficASP ?? 1200} onChange={(e) => setLocalTargets({...localTargets, trafficASP: Number(e.target.value)})} className="w-full px-4 py-3 border-2 rounded-xl outline-none focus:border-[#D6A84F]"/></div><button onClick={handleSaveTargets} className="w-full bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-[#E8C77A] py-3 rounded-xl font-bold active:scale-95 transition-transform">儲存設定</button></div></Card>)}
        
        {activeTab === "health" && (
            <Card title="門市體質診斷標準">
                <div className="space-y-6 w-full min-w-0">
                    <div className="bg-[#FAF7F1] p-4 rounded-xl border border-[#E8DDCC] flex items-center gap-2"><Lock size={18} className="text-[#B7863D]" /><span className="text-sm font-bold text-[#675B4E]">當前設定品牌：</span><span className="text-lg font-bold text-[#B7863D]">{brandLabel}</span></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                        {BENCHMARK_CATEGORIES.map(cat => {
                            const currentVal = localTargets.benchmarks?.[brandKey]?.[cat.id] || DEFAULT_BENCHMARKS_INIT[brandKey]?.[cat.id] || DEFAULT_BENCHMARKS_INIT["default"][cat.id];
                            const displayMin = (currentVal.min * 100).toFixed(0);
                            const displayMax = (currentVal.max * 100).toFixed(0);
                            return (
                                <div key={cat.id} className="bg-[#FAF7F1] border border-[#E8DDCC] rounded-xl p-4 hover:shadow-sm transition-shadow">
                                    <div className="mb-3 flex justify-between items-start"><div><h4 className="font-bold text-[#4D4338]">{cat.title}</h4><p className="text-[10px] text-[#A69C91] mt-0.5">{cat.sub}</p></div><span className="text-[10px] font-bold text-[#A69C91] bg-[#FFFCF7] px-2 py-1 rounded border border-[#EFE7DA] ml-2 whitespace-nowrap">標準: {displayMin}% - {displayMax}%</span></div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div><label className="block text-[10px] font-bold text-[#A69C91] mb-1">及格 ({cat.suffix})</label><div className="relative"><input type="number" step={cat.step} value={displayMin} onChange={(e) => handleBenchmarkChange(cat.id, 'min', e.target.value, cat.type)} className="w-full pl-3 pr-8 py-2 border rounded-lg font-mono font-bold text-[#4D4338] focus:border-[#D6A84F] outline-none text-center bg-[#FFFCF7]"/><span className="absolute right-3 top-2 text-xs font-bold text-[#A69C91] pointer-events-none">{cat.suffix}</span></div></div>
                                        <div><label className="block text-[10px] font-bold text-[#A69C91] mb-1">滿分 ({cat.suffix})</label><div className="relative"><input type="number" step={cat.step} value={displayMax} onChange={(e) => handleBenchmarkChange(cat.id, 'max', e.target.value, cat.type)} className="w-full pl-3 pr-8 py-2 border rounded-lg font-mono font-bold text-[#4D4338] focus:border-[#D6A84F] outline-none text-center bg-[#FFFCF7]"/><span className="absolute right-3 top-2 text-xs font-bold text-[#A69C91] pointer-events-none">{cat.suffix}</span></div></div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex justify-end pt-4 border-t border-[#EFE7DA]"><button onClick={handleSaveTargets} className="w-full md:w-auto bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-[#E8C77A] px-8 py-3 rounded-xl font-bold hover:brightness-[1.02] shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"><Save size={18} /> 儲存體質標準</button></div>
                </div>
            </Card>
        )}

        {activeTab === "permissions" && (
          <div className="space-y-6 w-full max-w-full min-w-0">
            <Card title="模組讀寫權限管理">
              <div className="overflow-x-auto w-full pb-2">
                <div className="min-w-[600px]">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="border-b border-[#E8DDCC]"><th className="p-4 font-bold text-[#7C7063] sticky left-0 bg-[#FFFCF7] z-10">功能模組</th><th className="p-4 font-bold text-[#4D4338] text-center bg-rose-50/50">教專</th><th className="p-4 font-bold text-[#4D4338] text-center bg-teal-50/50">區長</th><th className="p-4 font-bold text-[#4D4338] text-center bg-[#FFF7DF]/50">店經理</th><th className="p-4 font-bold text-[#4D4338] text-center bg-indigo-50/50">管理師</th></tr></thead>
                    <tbody className="divide-y divide-stone-100">
                      {ALL_MENU_ITEMS.map((item) => (
                        <tr key={item.id} className="hover:bg-[#FAF7F1]">
                          <td className="p-4 flex items-center gap-3 sticky left-0 bg-[#FFFCF7]/95 backdrop-blur-sm z-10 border-r border-[#EFE7DA] md:border-none shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] md:shadow-none"><div className="p-2 bg-[#F3EEE6] rounded-lg text-[#7C7063] shrink-0"><item.icon size={18} /></div><span className="font-bold text-[#4D4338] whitespace-nowrap">{item.label}</span></td>
                          <td className="p-4 text-center bg-rose-50/30"><input type="checkbox" checked={localPermissions.trainer?.includes(item.id)} onChange={() => togglePermission("trainer", item.id)} className="w-5 h-5 rounded border-stone-300 text-rose-600 focus:ring-rose-500 cursor-pointer"/></td>
                          <td className="p-4 text-center bg-teal-50/30"><input type="checkbox" checked={localPermissions.manager?.includes(item.id)} onChange={() => togglePermission("manager", item.id)} className="w-5 h-5 rounded cursor-pointer"/></td>
                          <td className="p-4 text-center bg-[#FFF7DF]/30"><input type="checkbox" checked={localPermissions.store?.includes(item.id)} onChange={() => togglePermission("store", item.id)} className="w-5 h-5 rounded cursor-pointer"/></td>
                          <td className="p-4 text-center bg-indigo-50/30"><input type="checkbox" checked={localPermissions.therapist?.includes(item.id)} onChange={() => togglePermission("therapist", item.id)} className="w-5 h-5 rounded cursor-pointer"/></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button onClick={handleSavePermissions} className="w-full md:w-auto bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-[#E8C77A] px-8 py-3 rounded-xl font-bold hover:brightness-[1.02] shadow-lg active:scale-95 transition-all">儲存模組權限</button>
              </div>
            </Card>

            <Card title="資安與閒置登入控管">
              <div className="space-y-6">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  {/* 閒置省流量待機 */}
                  <div className="bg-[#FFFCF7] rounded-[1.5rem] border border-emerald-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-emerald-100/70 bg-emerald-50/40 flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-emerald-700 font-black">
                          <Activity size={18} /> 閒置省流量待機
                        </div>
                        <p className="text-xs text-emerald-700/70 font-bold mt-1 leading-relaxed">
                          使用者離開但未登出時，暫停高流量即時監聽，回來操作後自動恢復。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLocalSecurityConfig({
                          ...localSecurityConfig,
                          lowPowerEnabled: !localSecurityConfig.lowPowerEnabled,
                        })}
                        className={`w-14 h-8 rounded-full p-1 transition-all shrink-0 ${localSecurityConfig.lowPowerEnabled ? 'bg-emerald-500' : 'bg-stone-200'}`}
                      >
                        <span className={`block w-6 h-6 rounded-full bg-[#FFFCF7] shadow-md transition-transform ${localSecurityConfig.lowPowerEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                    </div>

                    <div className="p-5 space-y-4">
                      <div>
                        <label className="block text-xs font-black text-[#A69C91] mb-2 tracking-wider">
                          閒置幾分鐘後進入省流量
                        </label>
                        <div className="relative max-w-xs">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={localSecurityConfig.lowPowerIdleMinutes ?? 30}
                            onChange={(e) => setLocalSecurityConfig({
                              ...localSecurityConfig,
                              lowPowerIdleMinutes: e.target.value,
                            })}
                            className="w-full pr-16 pl-4 py-3 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-50 font-black text-[#2F2923] bg-[#FFFCF7] transition-all"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-[#A69C91]">分鐘</span>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-[#FAF7F1] border border-[#EFE7DA] p-4 text-xs text-[#7C7063] font-bold leading-relaxed">
                        省流量待機只暫停高讀取來源，例如當月店日報、管理師日報與年度彙總監聽；不會登出、不會清除表單。
                      </div>
                    </div>
                  </div>

                  {/* 閒置自動登出 */}
                  <div className="bg-[#FFFCF7] rounded-[1.5rem] border border-[#F3DFB8] shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-[#F3DFB8]/70 bg-[#FFF7DF]/40 flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-[#8A632E] font-black">
                          <Clock size={18} /> 閒置自動登出
                        </div>
                        <p className="text-xs text-[#8A632E]/70 font-bold mt-1 leading-relaxed">
                          長時間無操作時啟動登出倒數，作為營業資料與帳號安全的最後防線。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLocalSecurityConfig({
                          ...localSecurityConfig,
                          autoLogoutEnabled: !localSecurityConfig.autoLogoutEnabled,
                          enabled: !localSecurityConfig.autoLogoutEnabled,
                        })}
                        className={`w-14 h-8 rounded-full p-1 transition-all shrink-0 ${localSecurityConfig.autoLogoutEnabled ? 'bg-[#B7863D]' : 'bg-stone-200'}`}
                      >
                        <span className={`block w-6 h-6 rounded-full bg-[#FFFCF7] shadow-md transition-transform ${localSecurityConfig.autoLogoutEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                    </div>

                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-black text-[#A69C91] mb-2 tracking-wider">
                          閒置幾分鐘後自動登出
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={localSecurityConfig.autoLogoutMinutes ?? localSecurityConfig.timeoutMinutes ?? 240}
                            onChange={(e) => setLocalSecurityConfig({
                              ...localSecurityConfig,
                              autoLogoutMinutes: e.target.value,
                              timeoutMinutes: e.target.value,
                            })}
                            className="w-full pr-16 pl-4 py-3 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-amber-300 focus:ring-4 focus:ring-[#FFF7DF] font-black text-[#2F2923] bg-[#FFFCF7] transition-all"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-[#A69C91]">分鐘</span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-black text-[#A69C91] mb-2 tracking-wider">
                          登出前倒數提醒
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min="5"
                            step="5"
                            value={localSecurityConfig.logoutWarningSeconds ?? localSecurityConfig.warningSeconds ?? 60}
                            onChange={(e) => setLocalSecurityConfig({
                              ...localSecurityConfig,
                              logoutWarningSeconds: e.target.value,
                              warningSeconds: e.target.value,
                            })}
                            className="w-full pr-12 pl-4 py-3 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-amber-300 focus:ring-4 focus:ring-[#FFF7DF] font-black text-[#2F2923] bg-[#FFFCF7] transition-all"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-[#A69C91]">秒</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#EFE7DA] bg-[#FAF7F1]/50 p-5">
                  <label className="block text-sm font-bold text-[#7C7063] mb-3 flex items-center gap-2">
                    <Shield size={16}/> 豁免自動登出的職務
                    <span className="text-xs font-normal text-[#A69C91] ml-2">只豁免自動登出，不豁免省流量待機</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    <label className="flex items-center gap-3 p-3 border-2 border-[#F3DFB8] rounded-xl bg-[#FFF7DF] text-[#8A632E] cursor-not-allowed opacity-80">
                      <input type="checkbox" checked disabled className="w-5 h-5 rounded text-[#B7863D]" />
                      <span className="font-bold">高階主管 <br/><span className="text-[10px] font-normal opacity-80">系統預設豁免登出</span></span>
                    </label>

                    {[{id:'trainer', label:'教專'}, {id:'manager', label:'區長'}, {id:'store', label:'店經理'}, {id:'therapist', label:'管理師'}].map(role => (
                      <label key={role.id} className={`flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer transition-all ${localSecurityConfig.exemptRoles?.includes(role.id) ? 'border-[#D6A84F] bg-[#FFF7DF]/30' : 'border-[#EFE7DA] bg-[#FFFCF7] hover:border-[#E8DDCC]'}`}>
                        <input type="checkbox"
                          checked={localSecurityConfig.exemptRoles?.includes(role.id)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            let newRoles = [...(localSecurityConfig.exemptRoles || ["director", "master"])];
                            if(checked && !newRoles.includes(role.id)) newRoles.push(role.id);
                            if(!checked) newRoles = newRoles.filter(r => r !== role.id);
                            setLocalSecurityConfig({...localSecurityConfig, exemptRoles: newRoles});
                          }}
                          className="w-5 h-5 rounded border-stone-300 text-[#B7863D] focus:ring-[#FFF7DF]0"
                        />
                        <span className={`font-bold ${localSecurityConfig.exemptRoles?.includes(role.id) ? 'text-[#8A632E]' : 'text-[#675B4E]'}`}>{role.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl bg-[#FFF7DF]/70 border border-[#F3DFB8] p-4 text-xs text-[#8A632E] font-bold leading-relaxed">
                  省流量與自動登出可分別設定。若某職務豁免自動登出，仍會依省流量時間進入待機；因此省流時間可以大於或小於自動登出時間。建議可依角色管理策略設定，例如一般人員較快登出，高階主管保留登入但進入省流。
                </div>

                <div className="flex justify-end pt-4 border-t border-[#EFE7DA]">
                  <button onClick={handleSaveSecurityConfig} className="w-full md:w-auto bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-[#E8C77A] px-8 py-3 rounded-xl font-bold hover:brightness-[1.02] shadow-lg active:scale-95 transition-all flex items-center gap-2 justify-center">
                    <Save size={18} /> 儲存資安與省流量設定
                  </button>
                </div>
              </div>
            </Card>
          </div>
        )}
        
        {activeTab === "trainer-account" && (
          <Card title="教專帳號管理">
            <div className="w-full space-y-6 min-w-0">
              <div className="rounded-2xl border border-[#EFE7DA] bg-[#FFFCF7] p-5">
                <div className="flex flex-col lg:flex-row gap-4 lg:items-end">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs font-black text-[#A69C91] mb-2">新增教專姓名</label>
                    <input
                      type="text"
                      value={newTrainerName}
                      onChange={(e) => setNewTrainerName(e.target.value)}
                      placeholder="例如：Amy 教專"
                      className="w-full px-4 py-3 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-[#D6A84F] font-bold"
                    />
                  </div>
                  <div className="w-full lg:w-56">
                    <label className="block text-xs font-black text-[#A69C91] mb-2">初始密碼</label>
                    <input
                      type="text"
                      value={newTrainerPass}
                      onChange={(e) => setNewTrainerPass(e.target.value)}
                      placeholder="預設 0000"
                      className="w-full px-4 py-3 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-[#D6A84F] font-bold"
                    />
                  </div>
                  <button
                    onClick={handleAddTrainerAccount}
                    className="w-full lg:w-auto bg-stone-900 text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-stone-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  >
                    <Plus size={18} /> 新增教專
                  </button>
                </div>
                <p className="mt-3 text-xs font-bold text-[#A69C91]">
                  新增後，登入頁的「教專」角色會出現人員選單；首次使用 0000 登入會要求更新密碼。
                </p>
              </div>

              <div className="space-y-3">
                {trainerAccounts.map((account, index) => {
                  const isEditing = editingTrainerId === account.id;
                  const isActive = account.isActive !== false;
                  return (
                    <div key={account.id} className={`rounded-2xl border p-4 transition-all ${isActive ? "border-[#EFE7DA] bg-white" : "border-stone-200 bg-stone-50 opacity-75"}`}>
                      <div className="flex flex-col xl:flex-row gap-4 xl:items-center justify-between">
                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[11px] font-black text-[#A69C91] mb-1">教專姓名</label>
                                <input
                                  value={editingTrainerName}
                                  onChange={(e) => setEditingTrainerName(e.target.value)}
                                  className="w-full px-3 py-2.5 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-[#D6A84F] font-bold"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-black text-[#A69C91] mb-1">登入密碼</label>
                                <input
                                  value={editingTrainerPass}
                                  onChange={(e) => setEditingTrainerPass(e.target.value)}
                                  className="w-full px-3 py-2.5 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-[#D6A84F] font-bold"
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-2xl bg-[#FAF7F1] border border-[#EFE7DA] flex items-center justify-center text-[#B7863D]">
                                <Users size={18} />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-base font-black text-[#3F3A35] truncate">{account.name}</p>
                                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-black ${isActive ? "bg-emerald-50 text-emerald-700" : "bg-stone-200 text-stone-500"}`}>
                                    {isActive ? "啟用中" : "已停用"}
                                  </span>
                                </div>
                                <p className="text-xs font-bold text-[#A69C91] mt-1">排序 {index + 1}｜密碼 {account.password || "0000"}</p>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 justify-end">
                          <button
                            onClick={() => moveTrainerAccount(account.id, -1)}
                            disabled={index === 0}
                            className="px-3 py-2 rounded-xl border border-[#EFE7DA] text-xs font-black text-[#7C7063] disabled:opacity-30 hover:bg-[#FAF7F1]"
                          >
                            上移
                          </button>
                          <button
                            onClick={() => moveTrainerAccount(account.id, 1)}
                            disabled={index === trainerAccounts.length - 1}
                            className="px-3 py-2 rounded-xl border border-[#EFE7DA] text-xs font-black text-[#7C7063] disabled:opacity-30 hover:bg-[#FAF7F1]"
                          >
                            下移
                          </button>

                          {isEditing ? (
                            <>
                              <button onClick={() => handleSaveTrainerAccount(account.id)} className="px-4 py-2 rounded-xl bg-stone-900 text-white text-xs font-black hover:bg-stone-800">
                                儲存
                              </button>
                              <button onClick={cancelEditTrainer} className="px-4 py-2 rounded-xl border border-stone-200 text-xs font-black text-stone-500 hover:bg-stone-50">
                                取消
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => beginEditTrainer(account)} className="px-4 py-2 rounded-xl border border-[#EFE7DA] text-xs font-black text-[#7C7063] hover:bg-[#FAF7F1]">
                                修改
                              </button>
                              <button onClick={() => handleToggleTrainerAccount(account)} className={`px-4 py-2 rounded-xl text-xs font-black ${isActive ? "bg-amber-50 text-amber-700 hover:bg-amber-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
                                {isActive ? "停用" : "啟用"}
                              </button>
                              <button onClick={() => handleDeleteTrainerAccount(account)} className="px-4 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-black hover:bg-rose-100">
                                刪除
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        )}
                {activeTab === "shops" && ( <div className="space-y-6 w-full max-w-full min-w-0"><Card title="新增營運店家"><div className="flex flex-col md:flex-row gap-4 items-end"><div className="flex-1 w-full"><label className="block text-xs font-bold text-[#A69C91] mb-1">分店簡稱</label><input type="text" value={newShop.name} onChange={(e) => setNewShop({ ...newShop, name: e.target.value })} placeholder="例如: 中山" className="w-full px-4 py-2 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-[#D6A84F] font-bold"/></div><div className="flex-1 w-full"><label className="block text-xs font-bold text-[#A69C91] mb-1">所屬區域</label><div className="relative"><select value={newShop.manager} onChange={(e) => setNewShop({ ...newShop, manager: e.target.value })} className="w-full px-4 py-2 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-[#D6A84F] font-bold appearance-none bg-[#FFFCF7] text-[#4D4338]"><option value="">請選擇...</option>{sortManagersByOrgOrder(localManagers, null, localManagerOrder).map((m) => (<option key={m} value={m}>{m} 區</option>))}</select><ChevronDown size={16} className="absolute right-3 top-3 text-[#A69C91] pointer-events-none"/></div></div><button onClick={handleAddGlobalStore} className="w-full md:w-auto bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-[#E8C77A] px-6 py-2.5 rounded-xl font-bold hover:brightness-[1.02] shadow-sm flex items-center justify-center gap-2"><Plus size={18} /> 新增</button></div></Card><Card title="全域店家列表"><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{managerEntries.map(([mgr, stores]) => (<div key={mgr} className={`bg-[#FAF7F1] rounded-2xl p-4 border ${mgr === UNASSIGNED_KEY ? "border-stone-300 shadow-inner" : "border-[#EFE7DA]"}`}><div className="flex items-center gap-2 mb-3 border-b border-[#E8DDCC] pb-2"><span className={`font-bold ${mgr === UNASSIGNED_KEY ? "text-[#7C7063]" : "text-[#4D4338]"}`}>{mgr} {mgr!==UNASSIGNED_KEY && "區"}</span><span className="text-xs text-[#A69C91] ml-auto">{stores.length} 間</span></div><div className="flex flex-wrap gap-2">{stores.map((store) => (<div key={store} className="group relative flex items-center"><span className={`px-3 py-1.5 border rounded-lg text-xs font-bold shadow-sm pr-7 ${mgr === UNASSIGNED_KEY ? "bg-[#FFFCF7] text-[#7C7063] border-[#E8DDCC]" : "bg-[#FFFCF7] text-[#675B4E] border-[#E8DDCC]"}`}>{store}</span><button onClick={() => handleDeleteGlobalStore(store, mgr)} className="absolute right-1 p-1 text-stone-300 hover:text-rose-500 transition-colors"><X size={12} /></button></div>))}</div></div>))}</div></Card></div> )}
        {activeTab === "stores" && ( <div className="space-y-6 w-full max-w-full min-w-0"><Card title="新增店經理帳號"><div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end"><div><label className="block text-xs font-bold text-[#A69C91] mb-1">姓名 / 帳號</label><input type="text" value={newStoreAccount.name} onChange={(e) => setNewStoreAccount({ ...newStoreAccount, name: e.target.value })} placeholder="例如: 王小明" className="w-full px-4 py-2 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-[#D6A84F] font-bold"/></div><div><label className="block text-xs font-bold text-[#A69C91] mb-1">登入密碼</label><input type="text" value={newStoreAccount.password} onChange={(e) => setNewStoreAccount({ ...newStoreAccount, password: e.target.value })} placeholder="設定密碼" className="w-full px-4 py-2 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-[#D6A84F] font-bold"/></div><div className="md:col-span-2"><label className="block text-xs font-bold text-[#A69C91] mb-1">分配管理店家</label><div className="flex gap-2"><div className="relative w-full"><Store size={16} className="absolute left-3 top-3 text-[#A69C91] pointer-events-none"/><select value={newStoreAccount.stores} onChange={(e) => setNewStoreAccount({ ...newStoreAccount, stores: e.target.value })} className="w-full pl-10 pr-4 py-2 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-[#D6A84F] font-bold appearance-none bg-[#FFFCF7] text-[#4D4338]"><option value="">請選擇未分配店家...</option>{availableUnassignedStores.map((s) => (<option key={s} value={s}>{s}</option>))}</select><ChevronDown size={16} className="absolute right-3 top-3 text-[#A69C91] pointer-events-none"/></div><button onClick={handleAddStoreAccount} className="bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-[#E8C77A] px-4 rounded-xl font-bold shrink-0 hover:brightness-[1.02]"><Plus size={20} /></button></div></div></div></Card><Card title="現有店經理列表"><div className="overflow-x-auto w-full pb-2"><div className="min-w-[600px]"><table className="w-full text-left text-sm"><thead className="bg-[#FAF7F1] font-bold text-[#7C7063] uppercase"><tr><th className="p-4 rounded-tl-xl">姓名</th><th className="p-4">密碼</th><th className="p-4">負責店家</th><th className="p-4 rounded-tr-xl text-right">操作</th></tr></thead><tbody className="divide-y divide-stone-100">{storeAccounts.map((account) => (<tr key={account.id} className="hover:bg-[#FAF7F1]"><td className="p-4 font-bold text-[#4D4338]">{account.name}</td><td className="p-4 font-mono text-[#7C7063]">{account.password}</td><td className="p-4"><div className="flex flex-wrap gap-1">{account.stores && account.stores.map((s) => (<span key={s} className="px-2 py-1 bg-[#F3EEE6] rounded text-xs font-bold text-[#675B4E]">{s}</span>))}</div></td><td className="p-4 text-right flex justify-end gap-1"><button onClick={() => openEditStoreAccount(account)} className="text-[#A69C91] hover:text-[#675B4E] hover:bg-[#F3EEE6] p-2 rounded-lg transition-colors"><Edit2 size={18} /></button><button onClick={() => handleDeleteStoreAccount(account.id)} className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 p-2 rounded-lg transition-colors"><Trash2 size={18} /></button></td></tr>))}</tbody></table></div></div></Card>{editingStoreAccount && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/30 backdrop-blur-sm"><div className="bg-[#FFFCF7] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95"><div className="bg-[#FFFCF7] border-b border-[#F3DFB8] p-4 font-bold text-[#5A4225] flex justify-between items-center"><span>編輯店經理帳號</span><button onClick={() => setEditingStoreAccount(null)}><X size={20}/></button></div><div className="p-6 space-y-4"><div><label className="text-xs font-bold text-[#A69C91] block mb-1">姓名 / 帳號</label><input type="text" value={editStoreForm.name} onChange={(e) => setEditStoreForm({...editStoreForm, name: e.target.value})} className="w-full p-2 border rounded-lg font-bold"/></div><div><label className="text-xs font-bold text-[#A69C91] block mb-1">密碼</label><input type="text" value={editStoreForm.password} onChange={(e) => setEditStoreForm({...editStoreForm, password: e.target.value})} className="w-full p-2 border rounded-lg font-mono"/></div><div><label className="text-xs font-bold text-[#A69C91] block mb-1">管理店家 (可多選)</label><div className="flex flex-wrap gap-2 mb-2 p-2 bg-[#FAF7F1] rounded-lg min-h-[40px]">{editStoreForm.stores.map(s => (<span key={s} className="px-2 py-1 bg-[#FFFCF7] border border-[#E8DDCC] rounded text-xs font-bold text-[#675B4E] shadow-sm flex items-center gap-1">{s} <button onClick={() => handleRemoveStoreFromEditForm(s)} className="text-stone-300 hover:text-rose-500"><X size={12}/></button></span>))}</div><div className="relative"><select onChange={(e) => { handleAddStoreToEditForm(e.target.value); e.target.value = ""; }} className="w-full p-2 border rounded-lg font-bold bg-[#FFFCF7]"><option value="">+ 加入負責店家</option>{availableStoresForEditing.map(s => <option key={s} value={s}>{s}</option>)}</select></div></div><div className="pt-4 flex gap-3"><button onClick={() => setEditingStoreAccount(null)} className="flex-1 py-3 bg-[#F3EEE6] text-[#7C7063] rounded-xl font-bold">取消</button><button onClick={handleUpdateStoreAccount} className="flex-1 py-3 bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-[#E8C77A] rounded-xl font-bold">儲存變更</button></div></div></div></div>)}</div> )}
        {activeTab === "managers" && ( <div className="space-y-6 w-full max-w-full min-w-0"><Card title="新增區長"><div className="flex flex-col md:flex-row gap-4 items-end"><div className="flex-1 w-full"><label className="block text-xs font-bold text-[#A69C91] mb-1">區長姓名</label><input type="text" value={newManager.name} onChange={(e) => setNewManager({ ...newManager, name: e.target.value })} placeholder="例如: Jonas" className="w-full px-4 py-2 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-[#D6A84F] font-bold" /></div><div className="flex-1 w-full"><label className="block text-xs font-bold text-[#A69C91] mb-1">預設密碼</label><input type="text" value={newManager.password} onChange={(e) => setNewManager({ ...newManager, password: e.target.value })} placeholder="設定密碼" className="w-full px-4 py-2 border-2 border-[#EFE7DA] rounded-xl outline-none focus:border-[#D6A84F] font-bold" /></div><button onClick={handleAddManager} className="w-full md:w-auto bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-[#E8C77A] px-6 py-2.5 rounded-xl font-bold hover:brightness-[1.02] shadow-sm flex items-center justify-center gap-2"><Plus size={18} /> 新增區長</button></div></Card><div className="grid grid-cols-1 md:grid-cols-2 gap-6">{managerEntries.map(([managerName, stores]) => (<Card key={managerName} className={`border ${managerName === UNASSIGNED_KEY ? "border-stone-300 bg-[#FAF7F1]" : "border-[#E8DDCC]"}`}><div className="flex flex-wrap justify-between items-start gap-3 mb-4"><div><h3 className={`text-lg font-bold flex items-center gap-2 ${managerName === UNASSIGNED_KEY ? "text-[#7C7063]" : "text-[#4D4338]"}`}>{managerName === UNASSIGNED_KEY ? <LayoutGrid size={20} /> : <User size={20} className="text-[#B7863D]" />}{managerName} {managerName !== UNASSIGNED_KEY && "區"}</h3>{managerName !== UNASSIGNED_KEY && <p className="text-xs text-[#A69C91] mt-1 font-mono">密碼: {managerAuth[managerName] || "未設定"}</p>}</div>{managerName !== UNASSIGNED_KEY && (<div className="flex gap-2"><button onClick={() => openEditManager(managerName, stores)} className="text-xs bg-[#F3EEE6] text-[#675B4E] px-3 py-1.5 rounded-lg hover:bg-stone-200 font-bold whitespace-nowrap">編輯轄區</button><button onClick={() => handleDeleteManager(managerName)} className="text-rose-400 hover:bg-rose-50 p-1.5 rounded-lg"><Trash2 size={16} /></button></div>)}</div>{editingManager === managerName ? (<div className="mt-4 animate-in fade-in bg-[#FAF7F1] p-4 rounded-xl border border-[#E8DDCC]">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
    <div>
      <label className="block text-xs font-bold text-[#A69C91] mb-1">區長姓名</label>
      <input
        type="text"
        value={editingManagerName}
        onChange={(e) => setEditingManagerName(e.target.value)}
        className="w-full px-3 py-2 border-2 border-[#E8DDCC] rounded-xl font-bold bg-[#FFFCF7] outline-none focus:border-[#D6A84F]"
      />
    </div>
    <div>
      <label className="block text-xs font-bold text-[#A69C91] mb-1">登入密碼</label>
      <input
        type="text"
        value={editingManagerPassword}
        onChange={(e) => setEditingManagerPassword(e.target.value)}
        className="w-full px-3 py-2 border-2 border-[#E8DDCC] rounded-xl font-mono font-bold bg-[#FFFCF7] outline-none focus:border-[#D6A84F]"
      />
    </div>
  </div>
  <div className="mb-3 rounded-2xl bg-amber-50/60 border border-amber-100 px-4 py-3 text-[11px] font-bold text-amber-700 leading-relaxed">
    從區長轄區移除的店家會自動回到「未分配」，不會再從營運架構中消失。若修改區長姓名，登入帳號也會同步改名。
  </div>
  <label className="block text-xs font-bold text-[#A69C91] mb-2">已分配店家</label><div className="flex flex-wrap gap-2 mb-4">{editingManagerStores.map((s) => (<div key={s} className="group relative flex items-center"><span className="px-3 py-1.5 bg-[#FFFCF7] border border-[#E8DDCC] rounded-lg text-xs font-bold text-[#675B4E] shadow-sm pr-7">{s}</span><button onClick={() => handleRemoveStoreFromEditing(s)} className="absolute right-1 p-1 text-stone-300 hover:text-rose-500 transition-colors"><X size={12} /></button></div>))}</div><div className="mb-4"><label className="block text-xs font-bold text-[#A69C91] mb-1">新增未分配店家 (從未分配清單選擇)</label><div className="relative"><select onChange={(e) => { handleAddStoreToEditing(e.target.value); e.target.value = ""; }} className="w-full px-4 py-2 border-2 border-[#E8DDCC] rounded-xl font-bold bg-[#FFFCF7] appearance-none text-[#4D4338]"><option value="">+ 點擊選擇店家</option>{availableStoresForManagerEdit.filter((s) => !editingManagerStores.includes(s)).map((s) => (<option key={s} value={s}>{s}</option>))}</select><ChevronDown size={16} className="absolute right-3 top-3 text-[#A69C91] pointer-events-none"/></div></div><div className="flex gap-2 justify-end"><button onClick={cancelEditManager} className="px-3 py-1.5 text-xs font-bold text-[#A69C91] hover:text-[#675B4E]">取消</button><button onClick={() => handleSaveManagerStores(managerName)} className="px-4 py-1.5 bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-[#E8C77A] text-xs font-bold rounded-lg hover:brightness-[1.02] shadow-sm">儲存名稱與轄區</button></div></div>) : (<div className="flex flex-wrap gap-2 mt-4">{stores.map((s) => (<span key={s} className={`px-2.5 py-1 border rounded-lg text-xs font-bold ${managerName === UNASSIGNED_KEY ? "bg-[#FFFCF7] border-[#E8DDCC] text-[#A69C91]" : "bg-[#FAF7F1] border-[#EFE7DA] text-[#675B4E]"}`}>{s}</span>))}</div>)}</Card>))}</div></div> )}
        
        {activeTab === "therapists_DISABLED" && ( 
          <div className="space-y-6 w-full max-w-full min-w-0">
            
            <div className="bg-[#FFFCF7] p-2 rounded-2xl border border-[#EFE7DA] shadow-sm flex flex-col xl:flex-row gap-3 items-center justify-between">
              
              <div className="flex bg-[#F3EEE6]/60 p-1 rounded-xl w-full xl:w-auto relative border border-[#E8DDCC]/50">
                <div 
                  className="absolute inset-y-1 w-[calc(50%-4px)] bg-[#FFFCF7] rounded-lg shadow-sm transition-transform duration-300 ease-out"
                  style={{ transform: `translateX(${showResigned ? 'calc(100% + 4px)' : '4px'})` }}
                />
                
                <button 
                  onClick={() => setShowResigned(false)} 
                  className={`relative z-10 flex-1 xl:w-40 py-2.5 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${!showResigned ? 'text-[#2F2923]' : 'text-[#A69C91] hover:text-[#675B4E]'}`}
                >
                  <UserCheck size={16} className={!showResigned ? "text-emerald-500" : ""} /> 在職戰力
                </button>
                <button 
                  onClick={() => setShowResigned(true)} 
                  className={`relative z-10 flex-1 xl:w-[200px] py-2.5 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${showResigned ? 'text-[#2F2923]' : 'text-[#A69C91] hover:text-[#675B4E]'}`}
                >
                  <Archive size={16} className={showResigned ? "text-[#675B4E]" : ""} /> 停權 / 封存庫
                </button>
              </div>

              <div className="flex w-full xl:w-auto gap-3">
                <div className="relative flex-1 xl:w-72">
                  <Search className="absolute left-3.5 top-3 text-[#A69C91]" size={18} />
                  <input 
                    type="text" 
                    placeholder="搜尋姓名或店家..." 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    className="w-full pl-10 pr-4 py-2.5 bg-[#FAF7F1] border-none rounded-xl outline-none focus:ring-2 focus:ring-amber-400 transition-all font-medium text-[#4D4338] placeholder-stone-400" 
                  />
                </div>
                <button 
                  onClick={openAddTherapist} 
                  className="px-5 py-2.5 bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-[#E8C77A] rounded-xl font-bold flex items-center justify-center gap-2 hover:brightness-[1.02] transition-all shadow-md hover:shadow-lg active:scale-95 shrink-0"
                >
                  <Plus size={18} /> 新增
                </button>
              </div>
            </div>

            {(isAddingTherapist || editingTherapist) && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/30 backdrop-blur-sm">
                <div className="bg-[#FFFCF7] w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 max-h-[90vh] overflow-y-auto border border-[#E8DDCC]">
                  <div className="bg-[#FAF7F1] px-6 py-4 border-b border-[#EFE7DA] flex justify-between items-center">
                    <h3 className="font-bold text-lg text-[#2F2923] flex items-center gap-2">
                      {editingTherapist ? <Edit2 size={20} className="text-[#B7863D]"/> : <Plus size={20} className="text-[#B7863D]"/>}
                      {editingTherapist ? "編輯人員資料" : "新增管理師"}
                    </h3>
                    <button onClick={() => { setIsAddingTherapist(false); setEditingTherapist(null); }} className="text-[#A69C91] hover:text-[#675B4E] bg-[#FFFCF7] p-1 rounded-full shadow-sm"><X size={20}/></button>
                  </div>
                  <div className="p-6 space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-bold text-[#A69C91] block mb-1.5 uppercase tracking-wider">所屬區域</label>
                        <select value={formManager} onChange={(e) => { setFormManager(e.target.value); setFormStore(""); }} className="w-full px-4 py-3 border border-[#E8DDCC] rounded-xl font-bold bg-[#FAF7F1] outline-none focus:border-[#D6A84F] focus:bg-[#FFFCF7] transition-colors appearance-none">
                          <option value="">選擇區域</option>
                          {sortManagersByOrgOrder(localManagers, null, localManagerOrder).map(m => <option key={m} value={m}>{m}區</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-[#A69C91] block mb-1.5 uppercase tracking-wider">配屬店家</label>
                        <select value={formStore} onChange={(e) => setFormStore(e.target.value)} className="w-full px-4 py-3 border border-[#E8DDCC] rounded-xl font-bold bg-[#FAF7F1] outline-none focus:border-[#D6A84F] focus:bg-[#FFFCF7] transition-colors appearance-none disabled:opacity-50" disabled={!formManager}>
                          <option value="">選擇店家</option>
                          {availableStoresForTherapist.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#A69C91] block mb-1.5 uppercase tracking-wider">員工姓名</label>
                      <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full px-4 py-3 border border-[#E8DDCC] rounded-xl font-bold bg-[#FAF7F1] outline-none focus:border-[#D6A84F] focus:bg-[#FFFCF7] transition-colors" placeholder="請輸入姓名" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#A69C91] block mb-1.5 uppercase tracking-wider flex items-center gap-1"><Key size={12}/> 登入密碼</label>
                      <input type="text" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} className="w-full px-4 py-3 border border-[#E8DDCC] rounded-xl font-mono bg-[#FAF7F1] outline-none focus:border-[#D6A84F] focus:bg-[#FFFCF7] transition-colors" placeholder="預設 0000" />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 pt-1 border-t border-[#EFE7DA]">
                      <div>
                        <label className="text-xs font-bold text-[#A69C91] block mb-1.5 uppercase tracking-wider flex items-center gap-1">
                          <Calendar size={12}/> 上線日 (生效日)
                        </label>
                        <SmartDatePicker 
                          selectedDate={formOnboardDate || getTodayStr()} 
                          onDateSelect={setFormOnboardDate} 
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-[#A69C91] block mb-1.5 uppercase tracking-wider flex items-center gap-1">
                          <Calendar size={12}/> 停權日 (選填)
                        </label>
                        <div className="relative">
                          <SmartDatePicker 
                            selectedDate={formResignDate || "未設定"} 
                            onDateSelect={setFormResignDate} 
                          />
                          {formResignDate && (
                            <button 
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFormResignDate(""); }} 
                              className="absolute right-[36px] top-1/2 -translate-y-1/2 p-1 text-stone-300 hover:text-rose-500 z-10 transition-colors bg-[#FFFCF7] rounded-full"
                              title="清除日期"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 flex gap-3">
                      <button onClick={() => { setIsAddingTherapist(false); setEditingTherapist(null); }} className="flex-1 py-3.5 bg-[#FFFCF7] border border-[#E8DDCC] text-[#7C7063] rounded-xl font-bold hover:bg-[#FAF7F1] transition-colors">取消</button>
                      <button onClick={editingTherapist ? handleUpdateTherapist : handleAddTherapist} className="flex-1 py-3.5 bg-gradient-to-r from-[#FFF7DF] via-[#F7E8C6] to-[#EACB86] text-[#5A4225] border border-[#E8C77A] rounded-xl font-bold hover:brightness-[1.02] shadow-md transition-all active:scale-95">{editingTherapist ? "儲存修改" : "確認新增"}</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {filteredTherapists.length === 0 ? (
              <div className="text-center py-20 bg-[#FFFCF7]/50 rounded-3xl border border-[#EFE7DA] border-dashed">
                <div className="bg-[#F3EEE6]/50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <UserX size={32} className="text-stone-300" />
                </div>
                <h3 className="text-lg font-bold text-[#675B4E] mb-1">{showResigned ? "查無停權資料" : "查無在職人員"}</h3>
                <p className="text-[#A69C91] text-sm">請嘗試更換搜尋關鍵字，或是新增人員。</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredTherapists.map(t => {
                  const isArchived = showResigned;
                  
                  return (
                    <div key={t.id} className={`bg-[#FFFCF7] rounded-3xl p-5 border transition-all duration-300 relative group overflow-hidden ${isArchived ? 'border-[#E8DDCC] shadow-sm opacity-80 hover:opacity-100 bg-[#FAF7F1]' : 'border-[#EFE7DA] shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] hover:shadow-lg hover:-translate-y-0.5 hover:border-[#E8C77A]'}`}>
                      
                      <div className="absolute -right-4 -top-4 opacity-[0.02] group-hover:opacity-[0.06] transition-opacity duration-500 pointer-events-none">
                        <User size={120} />
                      </div>

                      <div className="relative z-10 flex flex-col h-full">
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <div className="flex items-center gap-1.5 mb-2">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#F3EEE6] text-[#7C7063] text-[10px] font-bold tracking-wider">
                                <Store size={10}/> {t.store}店
                              </span>
                              {isArchived && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-stone-200/80 text-[#7C7063] text-[10px] font-bold tracking-wider border border-stone-300/50">
                                  <Archive size={10}/> 帳號暫停
                                </span>
                              )}
                            </div>
                            <h3 className={`text-xl font-bold tracking-tight flex items-center gap-2 ${isArchived ? 'text-[#675B4E]' : 'text-[#2F2923]'}`}>
                              {t.name}
                            </h3>
                            <div className="text-[10px] font-mono text-[#A69C91] mt-1 flex flex-col gap-0.5">
                              {t.onboardDate && <span>上線: {t.onboardDate}</span>}
                              {t.resignDate && <span className="text-rose-400/80">停權: {t.resignDate}</span>}
                            </div>
                          </div>

                          <div className="flex gap-1 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => toggleStatus(t)} 
                              className={`p-2 rounded-xl transition-all ${!isArchived ? 'bg-[#FAF7F1] hover:bg-rose-50 text-[#A69C91] hover:text-rose-600' : 'bg-[#FFFCF7] border border-[#E8DDCC] hover:bg-emerald-50 text-[#7C7063] hover:text-emerald-600 shadow-sm'}`} 
                              title={!isArchived ? "暫停帳號 (適用離職/留停)" : "重新啟用帳號 (復職/歸隊)"}
                            >
                              {!isArchived ? <Archive size={16} strokeWidth={2.5}/> : <UserCheck size={16} strokeWidth={2.5}/>}
                            </button>
                            <button onClick={() => openEdit(t)} className={`p-2 rounded-xl transition-all ${isArchived ? 'bg-[#FFFCF7] border border-[#E8DDCC] shadow-sm' : 'bg-[#FAF7F1] hover:bg-[#FFF7DF]'} text-[#A69C91] hover:text-[#B7863D]`} title="編輯資料">
                              <Edit2 size={16} strokeWidth={2.5}/>
                            </button>
                          </div>
                        </div>

                        <div className="mt-auto pt-4 border-t border-[#EFE7DA]/80 flex justify-between items-center text-sm">
                          <div className="flex items-center gap-2 text-[#A69C91]">
                            <div className="w-6 h-6 rounded-full bg-[#F3EEE6] flex items-center justify-center">
                              <Key size={12} className="text-[#7C7063]"/>
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

        {/* ========================================================================= */}
        {/* ★ 系統開發維護區 (目前功能已達成，使用註解隱藏以防誤觸，必要時可開啟) ★ */}
        {/* ========================================================================= */}

        {/* {userRole === 'director' && (
          <div className="mt-8 p-6 bg-rose-50 border border-rose-200 rounded-2xl shadow-sm w-full max-w-full">
            <h3 className="text-lg font-bold text-rose-700 mb-2 flex items-center gap-2">
              <AlertCircle size={20} />
              系統維護：歷史日報背景結算 (生成月總計)
            </h3>
            <p className="text-sm text-rose-600 mb-4 leading-relaxed">
              此功能會將系統開站以來的所有歷史日報按月份進行加總，並寫入一個名為 <code>monthly_aggregated</code> 的全新資料表。<br/>
              這是一個<b>唯讀且獨立</b>的操作，絕對<b>不會</b>修改、影響或刪除任何現有的營運日報，對前線營運 100% 零影響。
            </p>
            
            <button 
              onClick={async () => {
                if (!window.confirm("確定要執行歷史結算嗎？這可能會消耗較多讀取數（僅建議執行一次）。")) return;
                
                try {
                  showToast("開始結算歷史資料，請勿關閉視窗...", "info");
                  
                  const reportsRef = getCollectionPath("daily_reports");
                  const snapshot = await getDocs(reportsRef);

                  const aggregatedData = {};

                  snapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    if (!data.date || !data.storeName) return;

                    const yearMonth = data.date.substring(0, 7); 
                    const year = data.date.substring(0, 4);      
                    const store = data.storeName;
                    const key = `${yearMonth}_${store}`; 

                    if (!aggregatedData[key]) {
                      aggregatedData[key] = {
                        id: key,
                        yearMonth,
                        year,
                        storeName: store,
                        recordCount: 0 
                      };
                    }

                    aggregatedData[key].recordCount += 1;

                    Object.keys(data).forEach(field => {
                      if (typeof data[field] === 'number') {
                        aggregatedData[key][field] = (aggregatedData[key][field] || 0) + data[field];
                      }
                    });
                  });

                  const items = Object.values(aggregatedData);
                  const aggregatedRef = getCollectionPath("monthly_aggregated");
                  
                  const chunkArray = (arr, size) => {
                    const chunks = [];
                    for (let i = 0; i < arr.length; i += size) {
                      chunks.push(arr.slice(i, i + size));
                    }
                    return chunks;
                  };

                  const batches = chunkArray(items, 400); 
                  
                  for (const currentBatch of batches) {
                    const batch = writeBatch(db);
                    currentBatch.forEach(item => {
                      const docRef = doc(aggregatedRef, item.id);
                      batch.set(docRef, item, { merge: true }); 
                    });
                    await batch.commit();
                  }

                  showToast(`結算完成！共合併了 ${snapshot.size} 筆日報，成功生成 ${items.length} 筆月份總計。`, "success");
                  
                } catch (error) {
                  console.error("結算失敗:", error);
                  showToast("結算發生錯誤，請查看 Console", "error");
                }
              }}
              className="px-6 py-3 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 active:scale-95 transition-all shadow-md flex items-center justify-center gap-2"
            >
              <Database size={18} /> 一鍵結算歷史總計 (Data Backfill)
            </button>
          </div>
        )}
        */}

        {/* {userRole === 'director' && (
          <div className="mt-6 p-6 bg-[#FFF7DF] border border-[#E8C77A] rounded-2xl shadow-sm w-full max-w-full">
            <h3 className="text-lg font-bold text-[#8A632E] mb-2 flex items-center gap-2">
              <Lock size={20} />
              系統維護：人員排班與目標「時間鎖」標籤升級
            </h3>
            <p className="text-sm text-[#B7863D] mb-4 leading-relaxed">
              此功能會幫過去所有的「人員排班表」與「人員業績目標」補上 <code>year</code> 欄位。<br/>
              完成後我們就能把系統的時間鎖掛回去，徹底封印最後一個無效讀取黑洞！
            </p>
            
            <button 
              onClick={async () => {
                if (!window.confirm("確定要執行時間鎖標籤升級嗎？")) return;
                
                try {
                  showToast("開始掃描並升級資料，請稍候...", "info");
                  
                  const schedulesRef = getCollectionPath("therapist_schedules");
                  const targetsRef = getCollectionPath("therapist_targets");
                  
                  const [schedulesSnap, targetsSnap] = await Promise.all([
                    getDocs(schedulesRef),
                    getDocs(targetsRef)
                  ]);

                  const allUpdates = [];

                  const processSnap = (snap, collName) => {
                    snap.forEach(docSnap => {
                      const data = docSnap.data();
                      if (data.year) return;

                      let yearStr = "2026";
                      if (data.yearMonth) {
                        yearStr = data.yearMonth.substring(0, 4);
                      } else if (docSnap.id.match(/^202\d/)) {
                        yearStr = docSnap.id.substring(0, 4);
                      }

                      allUpdates.push({
                        ref: doc(getCollectionPath(collName), docSnap.id),
                        year: yearStr
                      });
                    });
                  };

                  processSnap(schedulesSnap, "therapist_schedules");
                  processSnap(targetsSnap, "therapist_targets");

                  if (allUpdates.length === 0) {
                    showToast("檢查完畢，所有資料都已經有時間標籤了！", "success");
                    return;
                  }

                  const chunkArray = (arr, size) => {
                    const chunks = [];
                    for (let i = 0; i < arr.length; i += size) {
                      chunks.push(arr.slice(i, i + size));
                    }
                    return chunks;
                  };

                  const batches = chunkArray(allUpdates, 400); 
                  
                  for (const currentBatch of batches) {
                    const batch = writeBatch(db);
                    currentBatch.forEach(item => {
                      batch.update(item.ref, { year: item.year }); 
                    });
                    await batch.commit();
                  }

                  showToast(`升級完成！成功幫 ${allUpdates.length} 筆舊資料掛上時間鎖標籤。`, "success");
                  
                } catch (error) {
                  console.error("升級失敗:", error);
                  showToast("發生錯誤，請查看 Console", "error");
                }
              }}
              className="px-6 py-3 bg-[#FFF7DF]0 text-white font-bold rounded-xl hover:bg-amber-600 active:scale-95 transition-all shadow-md flex items-center justify-center gap-2"
            >
              <CheckSquare size={18} /> 一鍵補齊時間標籤 (Time-Lock Backfill)
            </button>
          </div>
        )}
        */}
        
      </div>
    </ViewWrapper>
  );
};

export default SettingsView;