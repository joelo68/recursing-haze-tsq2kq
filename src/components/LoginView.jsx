// src/components/LoginView.jsx
import React, { useState, useEffect, useMemo } from "react";
import { 
  Coffee, AlertCircle, Loader2, MapPin, Store, UserCheck, Lock, 
  Sparkles, Crown, ArrowRight, ChevronLeft, Heart 
} from "lucide-react";
import { ROLES, BRANDS } from "../constants/index"; 
import LoginCounter from './LoginCounter';

const LoginView = ({
  appVersion = "2.2.5", 
  onLogin,
  storeAccounts,
  managers,
  managerAuth,
  onUpdatePassword,
  onUpdateManagerPassword,
  onUpdateTherapistPassword,
  trainerAuth,
  handleUpdateTrainerAuth,
  directorAuth,             
  handleUpdateDirectorAuth,
  masterAuth, 
  currentBrandId,
  onSwitchBrand,
  therapists = [],
  hasSelectedBrand = false 
}) => {
  const [showBrandSelector, setShowBrandSelector] = useState(!hasSelectedBrand);

  const [role, setRole] = useState("director");
  const [password, setPassword] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [forcePasswordUpdate, setForcePasswordUpdate] = useState(null);
  const [forceNewPassword, setForceNewPassword] = useState("");
  const [forceConfirmPassword, setForceConfirmPassword] = useState("");
  
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [directorManageMode, setDirectorManageMode] = useState("edit-pass"); 
  const [newDirectorName, setNewDirectorName] = useState("");

  const [tRegion, setTRegion] = useState("");   
  const [tStore, setTStore] = useState("");     
  const [tPersonId, setTPersonId] = useState(""); 
  const [tPassword, setTPassword] = useState(""); 

  const currentBrandConfig = useMemo(() => 
    BRANDS.find(b => b.id === currentBrandId) || BRANDS[0]
  , [currentBrandId]);

  const themeColors = useMemo(() => {
    switch(currentBrandId) {
      case 'anniu': return { text: "text-rose-900", accent: "bg-rose-600 hover:bg-rose-700", border: "focus:border-rose-400", ring: "focus:ring-rose-100" };
      case 'yibo': return { text: "text-yellow-900", accent: "bg-yellow-500 hover:bg-yellow-600", border: "focus:border-yellow-400", ring: "focus:ring-yellow-100" };
      default: return { text: "text-stone-800", accent: "bg-stone-800 hover:bg-stone-900", border: "focus:border-stone-400", ring: "focus:ring-stone-100" }; 
    }
  }, [currentBrandId]);

  const handleInitialBrandSelect = (brandId) => {
    if (onSwitchBrand) onSwitchBrand(brandId);
    setTimeout(() => { setShowBrandSelector(false); }, 150);
  };

  useEffect(() => {
    setTRegion(""); setTStore(""); setTPersonId(""); 
    setError(""); setPassword(""); setSelectedUser(""); setIsResetting(false);
    setForcePasswordUpdate(null); setForceNewPassword(""); setForceConfirmPassword("");
    setOldPassword(""); setNewPassword(""); setNewDirectorName(""); setDirectorManageMode("edit-pass");
  }, [role, currentBrandId]);

  const filteredStores = useMemo(() => {
    return tRegion ? (managers[tRegion] || []) : [];
  }, [tRegion, managers]);

  const filteredTherapists = useMemo(() => {
    if (!tStore) return [];
    return therapists.filter(t => {
      if (t.store !== tStore) return false;
      const isResigned = t.isResigned === true || t.resigned === true || t.status === 'resigned' || t.status === '離職' || t.isActive === false;
      return !isResigned; 
    });
  }, [tStore, therapists]);

 // ★★★ 終極全職級脫水計數器（日誌完全對齊版） ★★★
  const totalActiveUsers = useMemo(() => {
    let count = 0;
    
    // 1. 管理師 (精準脫水)
    const activeTherapists = (therapists || []).filter(t => {
      const isResigned = t.isResigned === true || t.resigned === true || t.status === 'resigned' || t.status === '離職' || t.isActive === false;
      return !isResigned;
    });
    count += activeTherapists.length;

    // 2. 店經理
    const storeCount = (storeAccounts || []).length;
    count += storeCount;

    // 3. 區長
    const managerCount = Object.keys(managerAuth || {}).length;
    count += managerCount;

    // 4. 高階主管
    const directorCount = Object.keys(directorAuth || {}).length;
    count += directorCount;

    // 5. 固定系統基數 (教專 + Master)
    count += 2;

    // 🔍 修正後的日誌：把 2 位系統帳號補上，讓加總剛好等於 13
    console.log("=== 📋 全集團授權帳號脫水點名簿 ===");
    console.log(`總計人數：${count} 人`);
    console.log(`➔ 🟢 現役管理師：${activeTherapists.length} 人`, activeTherapists.map(t => `${t.name}(${t.store}店)`).join(', '));
    console.log(`➔ 🏪 活躍店經理：${storeCount} 人`, (storeAccounts || []).map(a => a.name).join(', '));
    console.log(`➔ 🗺️ 區域負責人：${managerCount} 人`, Object.keys(managerAuth || {}).join(', '));
    console.log(`➔ 👑 總部高階主管：${directorCount} 人`, Object.keys(directorAuth || {}).join(', '));
    console.log(`➔ 🛠️ 系統固定帳號 (教專 + 最高管理員)：2 人`); // ★ 補上這行，帳目就完美了！
    console.log("==================================");

    return count;
  }, [therapists, storeAccounts, managerAuth, directorAuth]);

  const sortedDirectorNames = useMemo(() => {
    const getTitleWeight = (name) => {
      if (name.includes("總經理")) return 1;
      if (name.includes("營運長")) return 2;
      if (name.includes("總監")) return 3;
      if (name.includes("財務")) return 4;
      return 5; 
    };

    return Object.keys(directorAuth || {}).sort((a, b) => {
      const weightA = getTitleWeight(a);
      const weightB = getTitleWeight(b);
      if (weightA !== weightB) return weightA - weightB;
      return a.localeCompare(b);
    });
  }, [directorAuth]);

  const currentMasterKey = masterAuth?.password || "BOSS888";

  const getInitialPasswordsForRole = (roleId) => {
    if (roleId === "director") {
      if (currentBrandId === "anniu") return ["8888", "0000"];
      if (currentBrandId === "yibo") return ["9999", "0000"];
      return ["16500", "0000"];
    }
    if (["manager", "store", "therapist", "trainer"].includes(roleId)) return ["0000"];
    return ["0000"];
  };

  const isInitialPasswordLogin = (roleId, enteredPassword, correctPassword, options = {}) => {
    // Master Key 是最高管理備援，不納入首次密碼更新判斷，避免最高權限被鎖住。
    if (options.isMasterLogin) return false;
    if (!enteredPassword || enteredPassword !== correctPassword) return false;
    return getInitialPasswordsForRole(roleId).includes(String(enteredPassword));
  };

  const isWeakNewPassword = (value) => {
    const text = String(value || "").trim();
    if (text.length < 4) return true;
    return ["0000", "1111", "1234", "8888", "9999", "password", "PASSWORD"].includes(text);
  };

  const openForcePasswordUpdate = ({ roleId, accountId, userInfo, currentPassword, displayName }) => {
    setForcePasswordUpdate({ roleId, accountId, userInfo, currentPassword, displayName });
    setForceNewPassword("");
    setForceConfirmPassword("");
    setError("");
  };

  const handleForcePasswordUpdate = async () => {
    if (!forcePasswordUpdate) return;
    const nextPass = String(forceNewPassword || "").trim();
    const confirmPass = String(forceConfirmPassword || "").trim();

    if (!nextPass || !confirmPass) {
      setError("請輸入新密碼並再次確認");
      return;
    }
    if (nextPass !== confirmPass) {
      setError("兩次輸入的新密碼不一致");
      return;
    }
    if (nextPass === String(forcePasswordUpdate.currentPassword || "")) {
      setError("新密碼不可與初始密碼相同");
      return;
    }
    if (isWeakNewPassword(nextPass)) {
      setError("請設定至少 4 碼，並避免使用 0000、1234、8888、9999 等簡易密碼");
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      let success = false;
      const { roleId, accountId } = forcePasswordUpdate;
      if (roleId === "store") success = await onUpdatePassword(accountId, nextPass);
      else if (roleId === "manager") success = await onUpdateManagerPassword(accountId, nextPass);
      else if (roleId === "therapist") success = await onUpdateTherapistPassword(accountId, nextPass);
      else if (roleId === "trainer") success = await handleUpdateTrainerAuth(nextPass);
      else if (roleId === "director") success = await handleUpdateDirectorAuth("update", accountId, nextPass);

      if (!success) {
        setError("密碼更新失敗，請確認網路後再試一次");
        return;
      }

      const loginPayload = {
        ...(forcePasswordUpdate.userInfo || {}),
        passwordUpdatedOnFirstLogin: true,
      };
      const loginRole = forcePasswordUpdate.roleId;

      setForcePasswordUpdate(null);
      setForceNewPassword("");
      setForceConfirmPassword("");
      setPassword("");
      setTPassword("");
      onLogin(loginRole, loginPayload);
    } catch (e) {
      console.error("首次密碼更新失敗:", e);
      setError("密碼更新失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuth = async () => {
    setError(""); setIsLoading(true); await new Promise((r) => setTimeout(r, 600));
    try {
      if (role === "director") {
        if (!selectedUser) { setError("請選擇高管帳號"); setIsLoading(false); return; }
        const correctPass = directorAuth[selectedUser] || "0000";
        const isMasterLogin = password === currentMasterKey;
        if (password === correctPass || isMasterLogin) {
           const userInfo = { name: selectedUser };
           if (isInitialPasswordLogin("director", password, correctPass, { isMasterLogin })) {
             openForcePasswordUpdate({ roleId: "director", accountId: selectedUser, userInfo, currentPassword: password, displayName: selectedUser });
           } else {
             onLogin("director", userInfo);
           }
        } else {
           setError("密碼錯誤");
        }
      } else if (role === "trainer") {
        const correctPass = trainerAuth?.password || "0000";
        if (password === correctPass) {
          const userInfo = { name: "教專" };
          if (isInitialPasswordLogin("trainer", password, correctPass)) {
            openForcePasswordUpdate({ roleId: "trainer", accountId: "trainer", userInfo, currentPassword: password, displayName: "教專" });
          } else {
            onLogin("trainer", userInfo);
          }
        } else setError("密碼錯誤");
      } else if (role === "manager") {
        if (!selectedUser) { setError("請選擇區長"); setIsLoading(false); return; }
        const correctPass = managerAuth[selectedUser] || "0000";
        if (password === correctPass) {
          const userInfo = { name: selectedUser };
          if (isInitialPasswordLogin("manager", password, correctPass)) {
            openForcePasswordUpdate({ roleId: "manager", accountId: selectedUser, userInfo, currentPassword: password, displayName: selectedUser });
          } else {
            onLogin("manager", userInfo);
          }
        } else setError("密碼錯誤");
      } else if (role === "store") {
        if (!selectedUser) { setError("請選擇帳號"); setIsLoading(false); return; }
        const account = storeAccounts.find((a) => a.id === selectedUser);
        if (account && account.password === password) {
          const userInfo = { name: account.name, storeName: account.stores?.[0] || account.storeName, stores: account.stores };
          if (isInitialPasswordLogin("store", password, account.password)) {
            openForcePasswordUpdate({ roleId: "store", accountId: selectedUser, userInfo, currentPassword: password, displayName: account.name });
          } else {
            onLogin("store", userInfo);
          }
        } else setError("密碼錯誤");
      }
    } catch (e) { setError("登入發生錯誤"); } finally { setIsLoading(false); }
  };

  const handleTherapistLogin = async () => {
    setError(""); setIsLoading(true); await new Promise((r) => setTimeout(r, 600));
    try {
      if (!tPersonId) { setError("請選擇姓名"); setIsLoading(false); return; }
      const therapist = therapists.find(t => t.id === tPersonId);
      
      const isUserResigned = therapist?.isResigned === true || therapist?.resigned === true || therapist?.status === 'resigned' || therapist?.status === '離職' || therapist?.isActive === false;

      if (isUserResigned) { setError("此帳號已停用"); setIsLoading(false); return; }
      
      if (therapist && therapist.password === tPassword) {
        if (isInitialPasswordLogin("therapist", tPassword, therapist.password)) {
          openForcePasswordUpdate({ roleId: "therapist", accountId: therapist.id, userInfo: therapist, currentPassword: tPassword, displayName: therapist.name });
        } else {
          onLogin("therapist", therapist);
        }
      } else setError("密碼錯誤 (預設 0000)");
    } catch (e) { setError("登入發生錯誤"); } finally { setIsLoading(false); }
  };

  const handlePasswordReset = async () => {
    setError("");
    setIsLoading(true);
    
    if (role === "director") {
       const isMaster = (oldPassword === currentMasterKey);
       let success = false;

       if (directorManageMode === 'add') {
           if (!isMaster) { setError("❌ 權限不足：僅最高管理員(Master Key)可新增帳號"); setIsLoading(false); return; }
           if (!newDirectorName || !newPassword) { setError("請填寫新高管名稱與密碼"); setIsLoading(false); return; }
           if (directorAuth[newDirectorName]) { setError("此名稱已存在"); setIsLoading(false); return; }
           success = await handleUpdateDirectorAuth('add', newDirectorName, newPassword);
       
       } else if (directorManageMode === 'rename') {
           if (!isMaster) { setError("❌ 權限不足：僅最高管理員(Master Key)可修改帳號名稱"); setIsLoading(false); return; }
           if (!selectedUser || !newDirectorName) { setError("請選擇原帳號並填寫新名稱"); setIsLoading(false); return; }
           if (directorAuth[newDirectorName]) { setError("新名稱已存在，請更換其他名稱"); setIsLoading(false); return; }
           const currentPass = directorAuth[selectedUser];
           success = await handleUpdateDirectorAuth('rename', selectedUser, currentPass, newDirectorName);
       
       } else if (directorManageMode === 'delete') {
           if (!isMaster) { setError("❌ 權限不足：僅最高管理員(Master Key)可刪除帳號"); setIsLoading(false); return; }
           if (!selectedUser) { setError("請選擇要刪除的高管"); setIsLoading(false); return; }
           const confirmDel = window.confirm(`確定要刪除「${selectedUser}」的登入權限嗎？`);
           if (!confirmDel) { setIsLoading(false); return; }
           success = await handleUpdateDirectorAuth('delete', selectedUser, null);
       
       } else if (directorManageMode === 'edit-pass') {
           let isSelf = false;
           if (selectedUser && directorAuth[selectedUser] === oldPassword) {
               isSelf = true;
           }
           if (!isMaster && !isSelf) {
               setError("舊密碼 或 Master Key 錯誤！"); 
               setIsLoading(false); 
               return;
           }
           if (!selectedUser || !newPassword) { setError("請選擇要修改的主管並填寫新密碼"); setIsLoading(false); return; }
           success = await handleUpdateDirectorAuth('update', selectedUser, newPassword);
       }

       if (success) { 
         alert("高階主管權限更新成功！"); 
         setIsResetting(false); setNewPassword(""); setOldPassword(""); setPassword(""); setNewDirectorName(""); setSelectedUser("");
       } else { 
         setError("更新失敗，請檢查網路"); 
       }
       setIsLoading(false);
       return; 
    }

    if (!newPassword || !oldPassword) { setError("欄位不可為空"); setIsLoading(false); return; }
    let isVerified = false;
    
    if (role === "store" && selectedUser) { const account = storeAccounts.find((a) => a.id === selectedUser); if (account && account.password === oldPassword) isVerified = true; } 
    else if (role === "manager" && selectedUser) { const correctPass = managerAuth[selectedUser] || "0000"; if (correctPass === oldPassword) isVerified = true; } 
    else if (role === "therapist" && tPersonId) { const therapist = therapists.find(t => t.id === tPersonId); if (therapist && therapist.password === oldPassword) isVerified = true; } 
    else if (role === "trainer") { const correctPass = trainerAuth?.password || "0000"; if (correctPass === oldPassword) isVerified = true; }

    if (!isVerified) { setError("舊密碼錯誤"); setIsLoading(false); return; }
    
    let success = false;
    if (role === "store" && selectedUser) { success = await onUpdatePassword(selectedUser, newPassword); } 
    else if (role === "manager" && selectedUser) { success = await onUpdateManagerPassword(selectedUser, newPassword); } 
    else if (role === "therapist" && tPersonId) { success = await onUpdateTherapistPassword(tPersonId, newPassword); }
    else if (role === "trainer") { success = await handleUpdateTrainerAuth(newPassword); }

    if (success) { 
      alert("密碼更新成功，請重新登入"); 
      setIsResetting(false); setNewPassword(""); setOldPassword(""); setPassword(""); setTPassword(""); 
    } else { 
      setError("更新失敗，請檢查網路"); 
    }
    setIsLoading(false);
  };

  const inputClass = `w-full px-4 py-3 bg-white border border-stone-200 rounded-lg outline-none text-stone-700 transition-all focus:border-stone-400 focus:ring-2 ${themeColors.ring}`;
  const selectClass = `w-full px-4 py-3 bg-white border border-stone-200 rounded-lg outline-none text-stone-700 appearance-none transition-all focus:border-stone-400 focus:ring-2 ${themeColors.ring} disabled:bg-stone-50 disabled:text-stone-400`;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-4 font-sans text-stone-800">
      
      <div className={`w-full max-w-md bg-white p-8 rounded-2xl shadow-sm border border-stone-200 transition-all duration-500 transform ${showBrandSelector ? "opacity-0 scale-95 pointer-events-none absolute" : "opacity-100 scale-100 relative"}`}>
        <button onClick={() => setShowBrandSelector(true)} className="absolute top-6 left-6 text-stone-400 hover:text-stone-600 transition-colors flex items-center gap-1 text-sm font-medium"><ChevronLeft size={16}/> 切換品牌</button>

        <div className="text-center mb-10 mt-2">
          <div className="flex justify-center mb-4">
             {currentBrandId === 'yibo' ? <Sparkles size={40} className={themeColors.text} strokeWidth={1.5} /> : 
              currentBrandId === 'anniu' ? <Heart size={40} className={themeColors.text} strokeWidth={1.5} /> :
              <Crown size={40} className={themeColors.text} strokeWidth={1.5} />}
          </div>
          <h1 className={`text-2xl font-bold tracking-tight ${themeColors.text}`}>{currentBrandConfig.label} 營運管理</h1>
          <p className="text-stone-400 text-sm mt-1">請登入您的帳戶</p>
        </div>

        <div className="flex justify-center mb-8 border-b border-stone-100 pb-1">
          {Object.entries(ROLES).map(([key, r]) => (
            <button
              key={key}
              onClick={() => { setRole(r.id); setError(""); setPassword(""); setSelectedUser(""); setIsResetting(false); setTRegion(""); setTStore(""); setTPersonId(""); setTPassword(""); }}
              className={`px-4 py-2 text-sm font-medium transition-all relative ${role === r.id ? `text-stone-800` : "text-stone-400 hover:text-stone-600"}`}
            >
              {r.id === 'director' ? '高階主管' : r.label}
              {role === r.id && <span className="absolute bottom-[-5px] left-0 w-full h-[2px] bg-stone-800 rounded-full"></span>}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {forcePasswordUpdate ? (
            <div className="space-y-5 animate-in fade-in duration-300">
              <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-left">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-white p-2 text-amber-600 shadow-sm">
                    <Lock size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-stone-800">首次安全更新</h3>
                    <p className="mt-1 text-xs font-medium leading-relaxed text-stone-500">
                      為保護您的個人業績與門市資料，首次登入請先更新密碼。完成後即可進入系統。
                    </p>
                    <p className="mt-2 text-[11px] font-bold text-stone-500">
                      帳號：{forcePasswordUpdate.displayName || forcePasswordUpdate.userInfo?.name || "目前帳號"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <input
                  type="password"
                  value={forceNewPassword}
                  onChange={(e) => setForceNewPassword(e.target.value)}
                  placeholder="設定新密碼"
                  className={inputClass}
                  autoFocus
                />
                <input
                  type="password"
                  value={forceConfirmPassword}
                  onChange={(e) => setForceConfirmPassword(e.target.value)}
                  placeholder="再次輸入新密碼"
                  className={inputClass}
                  onKeyDown={(e) => e.key === "Enter" && handleForcePasswordUpdate()}
                />
                <p className="text-[11px] leading-relaxed text-stone-400">
                  請避免使用 0000、1234、8888、9999，或與姓名相同的簡易密碼。
                </p>
              </div>

              {error && <div className="text-rose-500 text-sm font-medium flex items-center justify-center gap-2 py-1"><AlertCircle size={14} /> {error}</div>}

              <button
                onClick={handleForcePasswordUpdate}
                disabled={isLoading}
                className={`w-full py-3.5 text-white rounded-lg font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${themeColors.accent}`}
              >
                {isLoading ? <Loader2 className="animate-spin mx-auto" /> : "完成更新並進入系統"}
              </button>
            </div>
          ) : (
            <>
          {role === "therapist" ? (
            <>
              {!isResetting ? (
                <>
                  <div className="relative"><MapPin className="absolute left-4 top-3.5 text-stone-400" size={18} />
                    <select value={tRegion} onChange={(e) => { setTRegion(e.target.value); setTStore(""); setTPersonId(""); }} className={`${selectClass} pl-12`}><option value="">選擇區域</option>{Object.keys(managers).map((m) => (<option key={m} value={m}>{m}區</option>))}</select>
                  </div>
                  <div className="relative"><Store className="absolute left-4 top-3.5 text-stone-400" size={18} />
                    <select value={tStore} onChange={(e) => { setTStore(e.target.value); setTPersonId(""); }} disabled={!tRegion} className={`${selectClass} pl-12`}><option value="">選擇店家</option>{filteredStores.map((s) => (<option key={s} value={s}>{s}</option>))}</select>
                  </div>
                  <div className="relative"><UserCheck className="absolute left-4 top-3.5 text-stone-400" size={18} />
                    <select value={tPersonId} onChange={(e) => setTPersonId(e.target.value)} disabled={!tStore} className={`${selectClass} pl-12`}><option value="">選擇姓名</option>{filteredTherapists.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}</select>
                  </div>
                  <div className="relative"><Lock className="absolute left-4 top-3.5 text-stone-400" size={18} />
                    <input type="password" value={tPassword} onChange={(e) => setTPassword(e.target.value)} placeholder="輸入密碼" className={`${inputClass} pl-12`} onKeyDown={(e) => e.key === "Enter" && handleTherapistLogin()} />
                  </div>
                </>
              ) : (
                <div className="space-y-3 animate-in fade-in">
                  <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} placeholder="舊密碼" className={inputClass}/>
                  <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="新密碼" className={inputClass}/>
                </div>
              )}
              
              {error && <div className="text-rose-500 text-sm font-medium flex items-center justify-center gap-2 py-1"><AlertCircle size={14} /> {error}</div>}
              
              {!isResetting ? (
                <button onClick={handleTherapistLogin} disabled={isLoading || !tPersonId || !tPassword} className={`w-full py-3.5 text-white rounded-lg font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${themeColors.accent}`}>{isLoading ? <Loader2 className="animate-spin mx-auto" /> : "登入"}</button>
              ) : (
                <button onClick={handlePasswordReset} disabled={isLoading} className="w-full py-3.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg font-bold shadow-sm transition-all">{isLoading ? <Loader2 className="animate-spin mx-auto" /> : "更新密碼"}</button>
              )}
              
              {tPersonId && <button onClick={() => { setIsResetting(!isResetting); setError(""); }} className="w-full text-center text-xs text-stone-400 hover:text-stone-600 py-2 transition-colors">{isResetting ? "返回登入" : "修改密碼?"}</button>}
            </>
          ) : (
            <>
              {role === "director" && !isResetting && (
                <div className="relative">
                  <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}>
                    <option value="">選擇高階主管</option>
                    {sortedDirectorNames.map((dName) => (
                      <option key={dName} value={dName}>{dName}</option>
                    ))}
                  </select>
                </div>
              )}
              {role === "manager" && !isResetting && (
                <div className="relative"><select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}><option value="">選擇區長</option>{Object.keys(managers).map((m) => (<option key={m} value={m}>{m}</option>))}</select></div>
              )}
              {role === "store" && !isResetting && (
                <div className="relative"><select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}><option value="">選擇店經理</option>{storeAccounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></div>
              )}

              {!isResetting ? (
                <input 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  placeholder={role === 'director' ? "密碼 (或 Master Key)" : "輸入密碼"} 
                  className={inputClass} 
                  onKeyDown={(e) => e.key === "Enter" && handleAuth()} 
                />
              ) : (
                <div className="space-y-3 animate-in fade-in">
                  
                  {role === "director" ? (
                    <>
                      <div className="flex flex-wrap gap-2 mb-2 bg-stone-100 p-1 rounded-lg">
                        <button onClick={() => {setDirectorManageMode('edit-pass'); setError("");}} className={`flex-1 py-1.5 text-xs font-bold rounded-md ${directorManageMode === 'edit-pass' ? 'bg-white shadow-sm text-stone-800' : 'text-stone-400 hover:text-stone-600'}`}>改密碼</button>
                        <button onClick={() => {setDirectorManageMode('rename'); setError("");}} className={`flex-1 py-1.5 text-xs font-bold rounded-md ${directorManageMode === 'rename' ? 'bg-white shadow-sm text-stone-800' : 'text-stone-400 hover:text-stone-600'}`}>改名稱</button>
                        <button onClick={() => {setDirectorManageMode('add'); setError("");}} className={`flex-1 py-1.5 text-xs font-bold rounded-md ${directorManageMode === 'add' ? 'bg-white shadow-sm text-stone-800' : 'text-stone-400 hover:text-stone-600'}`}>新增</button>
                        <button onClick={() => {setDirectorManageMode('delete'); setError("");}} className={`flex-1 py-1.5 text-xs font-bold rounded-md ${directorManageMode === 'delete' ? 'bg-white shadow-sm text-rose-600' : 'text-stone-400 hover:text-rose-500'}`}>刪除</button>
                      </div>
                      
                      {directorManageMode !== 'edit-pass' && (
                        <p className="text-[11px] text-rose-500 mb-2 px-1 font-medium">* 此操作僅限最高管理員 (Master Key) 執行</p>
                      )}

                      <input 
                        type="password" 
                        value={oldPassword} 
                        onChange={(e) => setOldPassword(e.target.value)} 
                        placeholder={directorManageMode === 'edit-pass' ? "舊密碼 或 Master Key" : "請輸入 Master Key"} 
                        className={inputClass} 
                      />

                      {directorManageMode === 'add' && (
                        <>
                          <input type="text" value={newDirectorName} onChange={(e) => setNewDirectorName(e.target.value)} placeholder="輸入新主管名稱" className={inputClass} />
                          <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="設定新密碼" className={inputClass} />
                        </>
                      )}
                      
                      {directorManageMode === 'edit-pass' && (
                        <>
                          <div className="relative">
                            <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}>
                              <option value="">選擇主管帳號</option>
                              {sortedDirectorNames.map((dName) => (<option key={dName} value={dName}>{dName}</option>))}
                            </select>
                          </div>
                          <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="輸入新密碼" className={inputClass} />
                        </>
                      )}

                      {directorManageMode === 'rename' && (
                        <>
                          <div className="relative">
                            <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}>
                              <option value="">選擇原帳號</option>
                              {sortedDirectorNames.map((dName) => (<option key={dName} value={dName}>{dName}</option>))}
                            </select>
                          </div>
                          <input type="text" value={newDirectorName} onChange={(e) => setNewDirectorName(e.target.value)} placeholder="輸入新名稱" className={inputClass} />
                        </>
                      )}
                      
                      {directorManageMode === 'delete' && (
                        <div className="relative">
                          <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={`${selectClass} text-rose-600`}>
                            <option value="">選擇要刪除的帳號</option>
                            {sortedDirectorNames.map((dName) => (<option key={dName} value={dName}>{dName}</option>))}
                          </select>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} placeholder="舊密碼" className={inputClass} />
                      <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="新密碼" className={inputClass} />
                    </>
                  )}
                </div>
              )}

              {error && <div className="text-rose-500 text-sm font-medium flex items-center justify-center gap-2 py-1"><AlertCircle size={14} /> {error}</div>}

              {!isResetting ? (
                <button onClick={handleAuth} disabled={isLoading} className={`w-full py-3.5 text-white rounded-lg font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${themeColors.accent}`}>{isLoading ? <Loader2 className="animate-spin mx-auto" /> : "登入"}</button>
              ) : (
                <button onClick={handlePasswordReset} disabled={isLoading} className={`w-full py-3.5 text-white rounded-lg font-bold shadow-sm transition-all ${role === 'director' && directorManageMode === 'delete' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-stone-800 hover:bg-stone-900'}`}>{isLoading ? <Loader2 className="animate-spin mx-auto" /> : (role === 'director' && directorManageMode === 'delete' ? "確認刪除" : "確認執行")}</button>
              )}

              <button onClick={() => { setIsResetting(!isResetting); setError(""); }} className="w-full text-center text-xs text-stone-400 hover:text-stone-600 py-2 transition-colors">{isResetting ? "返回登入" : "管理帳號密碼?"}</button>
            </>
          )}
            </>
          )}
        </div>
      </div>
      
      {/* ★ 把算好的精準數字傳進去 ★ */}
      <div className={`transition-all duration-500 transform ${showBrandSelector ? "opacity-0 scale-95 pointer-events-none absolute" : "opacity-100 scale-100 relative"}`}>
        <LoginCounter 
        totalUsers={totalActiveUsers}
        brandName={currentBrandConfig?.label}
        />
      </div>

      <div className={`mt-8 text-center transition-all duration-500 transform ${showBrandSelector ? "opacity-0 scale-95 pointer-events-none absolute" : "opacity-100 scale-100 relative"}`}>
         <p className="text-[10px] text-stone-400 font-medium tracking-widest uppercase flex items-center justify-center gap-1.5">
           DRCYJ Cloud System
           <span className="text-[10px] font-mono bg-stone-200/50 text-stone-400 px-1.5 py-0.5 rounded border border-stone-200/60 shadow-inner select-all tracking-normal lowercase">
             v{appVersion}
           </span>
         </p>
      </div>

      {showBrandSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-lg p-8">
            <div className="text-center mb-12">
              <h2 className="text-2xl font-bold text-stone-800 mb-2 tracking-tight">歡迎回來</h2>
              <p className="text-stone-400">請選擇要登入的品牌系統</p>
            </div>
            
            <div className="space-y-4">
              {BRANDS.map(brand => {
                let btnIcon = Crown;
                let activeClass = "hover:border-stone-400 hover:bg-stone-50";
                
                if (brand.id === 'anniu') { btnIcon = Heart; activeClass = "hover:border-rose-200 hover:bg-rose-50 hover:text-rose-900"; }
                else if (brand.id === 'yibo') { btnIcon = Sparkles; activeClass = "hover:border-yellow-200 hover:bg-yellow-50 hover:text-yellow-900"; }
                else { activeClass = "hover:border-stone-400 hover:bg-stone-50 hover:text-stone-900"; }

                const Icon = btnIcon;

                return (
                  <button
                    key={brand.id}
                    onClick={() => handleInitialBrandSelect(brand.id)}
                    className={`w-full flex items-center justify-between p-6 rounded-xl border border-stone-200 bg-white transition-all duration-200 group ${activeClass}`}
                  >
                    <div className="flex items-center gap-5">
                      <Icon size={24} strokeWidth={1.5} className="text-stone-400 group-hover:text-current transition-colors"/>
                      <div className="text-left">
                        <h3 className="text-lg font-bold text-stone-700 group-hover:text-current transition-colors">{brand.label}</h3>
                      </div>
                    </div>
                    <ArrowRight size={20} className="text-stone-300 group-hover:text-current transition-colors opacity-0 group-hover:opacity-100 transform group-hover:translate-x-1 duration-300" />
                  </button>
                );
              })}
            </div>
            
            <div className="mt-12 text-center">
              <p className="text-[10px] text-stone-400 font-medium tracking-widest uppercase flex items-center justify-center gap-1.5">
                DRCYJ Cloud System
                <span className="text-[10px] font-mono bg-stone-100 text-stone-400 px-1.5 py-0.5 rounded border border-stone-200 shadow-inner select-all tracking-normal lowercase">
                  v{appVersion}
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default LoginView;