// src/components/LoginView.jsx
import React, { useState, useEffect, useMemo } from "react";
import { Coffee, AlertCircle, Loader2, MapPin, Store, UserCheck, Lock, Sparkles, Crown, ArrowRight, ChevronLeft } from "lucide-react";
import { ROLES, BRANDS } from "../constants/index"; 

// ★★★ 自定義各品牌總監密碼 (請在此修改) ★★★
const BRAND_DIRECTOR_PASSWORDS = {
  'cyj': '16500',     // CYJ 總監密碼
  'anniu': '8888',   // 安妞 總監密碼 (範例)
  'yibo': '9999'     // 伊啵 總監密碼 (範例)
};

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
  currentBrandId,
  onSwitchBrand,
  therapists = [] 
}) => {
  // 控制是否顯示初始品牌選擇遮罩
  const [showBrandSelector, setShowBrandSelector] = useState(true);

  const [role, setRole] = useState("director");
  const [password, setPassword] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [tRegion, setTRegion] = useState("");   
  const [tStore, setTStore] = useState("");     
  const [tPersonId, setTPersonId] = useState(""); 
  const [tPassword, setTPassword] = useState(""); 

  const currentBrandConfig = useMemo(() => 
    BRANDS.find(b => b.id === currentBrandId) || BRANDS[0]
  , [currentBrandId]);

  // ★★★ 極簡風格配色 (Minimalist Theme) ★★★
  const themeColors = useMemo(() => {
    // 只保留細微的重點色，大部分使用黑白灰
    switch(currentBrandId) {
      case 'anniu': return { text: "text-rose-900", accent: "bg-rose-600 hover:bg-rose-700", border: "focus:border-rose-400", ring: "focus:ring-rose-100" };
      case 'yibo': return { text: "text-yellow-900", accent: "bg-yellow-500 hover:bg-yellow-600", border: "focus:border-yellow-400", ring: "focus:ring-yellow-100" };
      default: return { text: "text-stone-800", accent: "bg-stone-800 hover:bg-stone-900", border: "focus:border-stone-400", ring: "focus:ring-stone-100" }; 
    }
  }, [currentBrandId]);

  const handleInitialBrandSelect = (brandId) => {
    if (onSwitchBrand) onSwitchBrand(brandId);
    setTimeout(() => {
        setShowBrandSelector(false);
    }, 150);
  };

  useEffect(() => {
    setTRegion(""); setTStore(""); setTPersonId(""); 
  }, [role, currentBrandId]);

  const filteredStores = useMemo(() => {
    return tRegion ? (managers[tRegion] || []) : [];
  }, [tRegion, managers]);

  const filteredTherapists = useMemo(() => {
    if (!tStore) return [];
    return therapists.filter(t => t.store === tStore);
  }, [tStore, therapists]);

  // 登入邏輯
  const handleAuth = async () => {
    setError(""); setIsLoading(true); await new Promise((r) => setTimeout(r, 600));
    try {
      if (role === "director") {
        // ★★★ 修改：根據當前品牌 ID 取得對應密碼 ★★★
        // 優先使用 BRAND_DIRECTOR_PASSWORDS 設定的密碼，若找不到則預設 0000
        const correctPass = BRAND_DIRECTOR_PASSWORDS[currentBrandId] || "0000";
        
        if (password === correctPass) {
           // 登入成功，名稱顯示該品牌的總監 (例如：安妞總監)
           onLogin("director", { name: `${currentBrandConfig.label}總監` }); 
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
    if (!newPassword || !oldPassword) { setError("請輸入舊密碼與新密碼"); return; }
    setIsLoading(true);
    let isVerified = false;
    if (role === "store" && selectedUser) { const account = storeAccounts.find((a) => a.id === selectedUser); if (account && account.password === oldPassword) isVerified = true; } 
    else if (role === "manager" && selectedUser) { const correctPass = managerAuth[selectedUser] || "0000"; if (correctPass === oldPassword) isVerified = true; } 
    else if (role === "therapist" && tPersonId) { const therapist = therapists.find(t => t.id === tPersonId); if (therapist && therapist.password === oldPassword) isVerified = true; } 
    else if (role === "trainer") { const correctPass = trainerAuth?.password || "0000"; if (correctPass === oldPassword) isVerified = true; }
    // 注意：目前總監密碼是寫死的，若要開放總監修改密碼，需要後端支援或寫入 constants

    if (!isVerified) { setError("舊密碼錯誤"); setIsLoading(false); return; }
    let success = false;
    if (role === "store" && selectedUser) { success = await onUpdatePassword(selectedUser, newPassword); } 
    else if (role === "manager" && selectedUser) { success = await onUpdateManagerPassword(selectedUser, newPassword); } 
    else if (role === "therapist" && tPersonId) { success = await onUpdateTherapistPassword(tPersonId, newPassword); }
    else if (role === "trainer") { success = await handleUpdateTrainerAuth(newPassword); }

    if (success) { alert("密碼更新成功，請重新登入"); setIsResetting(false); setNewPassword(""); setOldPassword(""); setPassword(""); setTPassword(""); } else { setError("更新失敗"); }
    setIsLoading(false);
  };

  // 共用輸入框樣式
  const inputClass = `w-full px-4 py-3 bg-white border border-stone-200 rounded-lg outline-none text-stone-700 transition-all focus:border-stone-400 focus:ring-2 ${themeColors.ring}`;
  const selectClass = `w-full px-4 py-3 bg-white border border-stone-200 rounded-lg outline-none text-stone-700 appearance-none transition-all focus:border-stone-400 focus:ring-2 ${themeColors.ring} disabled:bg-stone-50 disabled:text-stone-400`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4 font-sans text-stone-800">
      
      {/* ★★★ 主登入卡片 (極簡版) ★★★ */}
      <div 
        className={`w-full max-w-md bg-white p-8 rounded-2xl shadow-sm border border-stone-200 transition-all duration-500 transform 
          ${showBrandSelector ? "opacity-0 scale-95 pointer-events-none absolute" : "opacity-100 scale-100 relative"}
        `}
      >
        {/* 返回選擇品牌按鈕 */}
        <button 
          onClick={() => setShowBrandSelector(true)}
          className="absolute top-6 left-6 text-stone-400 hover:text-stone-600 transition-colors flex items-center gap-1 text-sm font-medium"
        >
          <ChevronLeft size={16}/> 切換品牌
        </button>

        <div className="text-center mb-10 mt-2">
          {/* Logo 簡化為圖標 */}
          <div className="flex justify-center mb-4">
             {currentBrandId === 'yibo' ? <Sparkles size={40} className={themeColors.text} strokeWidth={1.5} /> : 
              currentBrandId === 'anniu' ? <Coffee size={40} className={themeColors.text} strokeWidth={1.5} /> :
              <Crown size={40} className={themeColors.text} strokeWidth={1.5} />}
          </div>
          <h1 className={`text-2xl font-bold tracking-tight ${themeColors.text}`}>{currentBrandConfig.label} 營運管理</h1>
          <p className="text-stone-400 text-sm mt-1">請登入您的帳戶</p>
        </div>

        {/* 角色切換 (極簡線條風) */}
        <div className="flex justify-center mb-8 border-b border-stone-100 pb-1">
          {Object.entries(ROLES).map(([key, r]) => (
            <button
              key={key}
              onClick={() => { setRole(r.id); setError(""); setPassword(""); setSelectedUser(""); setIsResetting(false); setTRegion(""); setTStore(""); setTPersonId(""); setTPassword(""); }}
              className={`px-4 py-2 text-sm font-medium transition-all relative ${
                role === r.id ? `text-stone-800` : "text-stone-400 hover:text-stone-600"
              }`}
            >
              {r.label}
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
                    <select value={tRegion} onChange={(e) => { setTRegion(e.target.value); setTStore(""); setTPersonId(""); }} className={`${selectClass} pl-12`}>
                      <option value="">選擇區域</option>{Object.keys(managers).map((m) => (<option key={m} value={m}>{m}區</option>))}
                    </select>
                  </div>
                  <div className="relative"><Store className="absolute left-4 top-3.5 text-stone-400" size={18} />
                    <select value={tStore} onChange={(e) => { setTStore(e.target.value); setTPersonId(""); }} disabled={!tRegion} className={`${selectClass} pl-12`}>
                      <option value="">選擇店家</option>{filteredStores.map((s) => (<option key={s} value={s}>{s}</option>))}
                    </select>
                  </div>
                  <div className="relative"><UserCheck className="absolute left-4 top-3.5 text-stone-400" size={18} />
                    <select value={tPersonId} onChange={(e) => setTPersonId(e.target.value)} disabled={!tStore} className={`${selectClass} pl-12`}>
                      <option value="">選擇姓名</option>{filteredTherapists.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
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
              {role === "manager" && (
                <div className="relative"><select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}><option value="">選擇區長</option>{Object.keys(managers).map((m) => (<option key={m} value={m}>{m}</option>))}</select></div>
              )}
              {role === "store" && (
                <div className="relative"><select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}><option value="">選擇店經理</option>{storeAccounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></div>
              )}

              {!isResetting ? (
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="輸入密碼" className={inputClass} onKeyDown={(e) => e.key === "Enter" && handleAuth()} />
              ) : (
                <div className="space-y-3">
                  <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} placeholder="舊密碼" className={inputClass} />
                  <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="新密碼" className={inputClass} />
                </div>
              )}

              {error && <div className="text-rose-500 text-sm font-medium flex items-center justify-center gap-2 py-1"><AlertCircle size={14} /> {error}</div>}

              {!isResetting ? (
                <button onClick={handleAuth} disabled={isLoading} className={`w-full py-3.5 text-white rounded-lg font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${themeColors.accent}`}>{isLoading ? <Loader2 className="animate-spin mx-auto" /> : "登入"}</button>
              ) : (
                <button onClick={handlePasswordReset} disabled={isLoading} className="w-full py-3.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg font-bold shadow-sm transition-all">{isLoading ? <Loader2 className="animate-spin mx-auto" /> : "更新密碼"}</button>
              )}

              {(role === "store" || role === "manager" || role === "trainer") && (
                <button onClick={() => { setIsResetting(!isResetting); setError(""); }} className="w-full text-center text-xs text-stone-400 hover:text-stone-600 py-2 transition-colors">{isResetting ? "返回登入" : "修改密碼?"}</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ★★★ 2. 品牌選擇遮罩 (極簡風格) ★★★ */}
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
                
                if (brand.id === 'anniu') { btnIcon = Coffee; activeClass = "hover:border-rose-200 hover:bg-rose-50 hover:text-rose-900"; }
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