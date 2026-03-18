// src/components/LoginView.jsx
import React, { useState, useEffect, useMemo } from "react";
import { 
  Coffee, AlertCircle, Loader2, MapPin, Store, UserCheck, Lock, 
  Sparkles, Crown, ArrowRight, ChevronLeft, Heart 
} from "lucide-react";
import { ROLES, BRANDS } from "../constants/index"; 

const LoginView = ({
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
  masterAuth, // ★ 接收從資料庫撈來的 Master Key
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
    setOldPassword(""); setNewPassword(""); setNewDirectorName(""); setDirectorManageMode("edit-pass");
  }, [role, currentBrandId]);

  const filteredStores = useMemo(() => {
    return tRegion ? (managers[tRegion] || []) : [];
  }, [tRegion, managers]);

  const filteredTherapists = useMemo(() => {
    if (!tStore) return [];
    return therapists.filter(t => t.store === tStore);
  }, [tStore, therapists]);

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

  // ★ 取得雲端動態的 Master Key，如果沒有就用預設值 BOSS888
  const currentMasterKey = masterAuth?.password || "BOSS888";

  const handleAuth = async () => {
    setError(""); setIsLoading(true); await new Promise((r) => setTimeout(r, 600));
    try {
      if (role === "director") {
        if (!selectedUser) { setError("請選擇高管帳號"); setIsLoading(false); return; }
        const correctPass = directorAuth[selectedUser] || "0000";
        // ★ 登入時一樣支援 Master Key 當作無敵鑰匙
        if (password === correctPass || password === currentMasterKey) {
           onLogin("director", { name: selectedUser }); 
        } else {
           setError("密碼錯誤");
        }
      } else if (role === "trainer") {
        const correctPass = trainerAuth?.password || "0000";
        if (password === correctPass) onLogin("trainer", { name: "教專" }); else setError("密碼錯誤");
      } else if (role === "manager") {
        if (!selectedUser) { setError("請選擇區長"); setIsLoading(false); return; }
        const correctPass = managerAuth[selectedUser] || "0000";
        if (password === correctPass) onLogin("manager", { name: selectedUser }); else setError("密碼錯誤");
      } else if (role === "store") {
        if (!selectedUser) { setError("請選擇帳號"); setIsLoading(false); return; }
        const account = storeAccounts.find((a) => a.id === selectedUser);
        if (account && account.password === password) onLogin("store", { name: account.name, storeName: account.stores?.[0] || account.storeName, stores: account.stores }); else setError("密碼錯誤");
      }
    } catch (e) { setError("登入發生錯誤"); } finally { setIsLoading(false); }
  };

  const handleTherapistLogin = async () => {
    setError(""); setIsLoading(true); await new Promise((r) => setTimeout(r, 600));
    try {
      if (!tPersonId) { setError("請選擇姓名"); setIsLoading(false); return; }
      const therapist = therapists.find(t => t.id === tPersonId);
      if (therapist && therapist.password === tPassword) onLogin("therapist", therapist); else setError("密碼錯誤 (預設 0000)");
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
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4 font-sans text-stone-800">
      
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
                          <input type="text" value={newDirectorName} onChange={(e) => setNewDirectorName(e.target.value)} placeholder="輸入新主管名稱 (例如：營運長)" className={inputClass} />
                          <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="設定新密碼" className={inputClass} />
                        </>
                      )}
                      
                      {directorManageMode === 'edit-pass' && (
                        <>
                          <div className="relative">
                            <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}>
                              <option value="">選擇要修改密碼的主管</option>
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
                          <input type="text" value={newDirectorName} onChange={(e) => setNewDirectorName(e.target.value)} placeholder="輸入新的名稱 (例如：陳營運長)" className={inputClass} />
                        </>
                      )}
                      
                      {directorManageMode === 'delete' && (
                        <div className="relative">
                          <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={`${selectClass} text-rose-600`}>
                            <option value="">選擇要刪除的主管</option>
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

              {(role === "director" || role === "store" || role === "manager" || role === "trainer") && (
                <button onClick={() => { setIsResetting(!isResetting); setError(""); }} className="w-full text-center text-xs text-stone-400 hover:text-stone-600 py-2 transition-colors">{isResetting ? "取消並返回登入" : "帳號與密碼管理?"}</button>
              )}
            </>
          )}
        </div>
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
                
                if (brand.id === 'anniu') { 
                    btnIcon = Heart; 
                    activeClass = "hover:border-rose-200 hover:bg-rose-50 hover:text-rose-900"; 
                }
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
              <p className="text-[10px] text-stone-300 font-medium tracking-widest uppercase">DRCYJ Cloud System</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default LoginView;