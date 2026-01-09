// src/components/LoginView.jsx
import React, { useState, useEffect, useMemo } from "react";
import { Coffee, AlertCircle, Loader2, MapPin, Store, UserCheck, Lock } from "lucide-react";
import { collection, query, where, getDocs } from "firebase/firestore"; // ★ 新增引用
import { db, appId } from "../config/firebase"; // ★ 新增引用
import { ROLES } from "../constants"; 

const LoginView = ({
  onLogin,
  storeAccounts,
  managers,
  managerAuth,
  onUpdatePassword,
  onUpdateManagerPassword,
}) => {
  const [role, setRole] = useState("director");
  const [password, setPassword] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // ==========================================
  // ★★★ 新增：管理師登入專用狀態 ★★★
  // ==========================================
  const [therapistList, setTherapistList] = useState([]); 
  const [loadingTherapists, setLoadingTherapists] = useState(false);
  const [tRegion, setTRegion] = useState("");   
  const [tStore, setTStore] = useState("");     
  const [tPersonId, setTPersonId] = useState(""); 
  const [tPassword, setTPassword] = useState(""); 

  // 當選擇「管理師」身份時，去 Firebase 抓取名單
  useEffect(() => {
    if (role === "therapist") {
      const fetchTherapists = async () => {
        setLoadingTherapists(true);
        try {
          const q = query(
            collection(db, "artifacts", appId, "public", "data", "therapists"),
            where("status", "==", "active")
          );
          const snapshot = await getDocs(q);
          const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setTherapistList(list);
        } catch (err) {
          console.error("無法讀取管理師名單", err);
          setError("讀取人員名單失敗，請檢查網路");
        } finally {
          setLoadingTherapists(false);
        }
      };
      fetchTherapists();
    }
  }, [role]);

  // 計算連動選單：區域 -> 店家 -> 人員
  const filteredStores = useMemo(() => {
    return tRegion ? (managers[tRegion] || []) : [];
  }, [tRegion, managers]);

  const filteredTherapists = useMemo(() => {
    return tStore ? therapistList.filter(t => t.store === tStore) : [];
  }, [tStore, therapistList]);

  // ==========================================
  // 原有一般登入邏輯 (總監/區長/店長)
  // ==========================================
  const handleAuth = async () => {
    setError("");
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 600));

    try {
      if (role === "director") {
        if (password === ROLES.DIRECTOR.pass) {
          onLogin("director", { name: "總監" });
        } else {
          setError("密碼錯誤");
        }
      } else if (role === "manager") {
        if (!selectedUser) {
          setError("請選擇區長");
          setIsLoading(false);
          return;
        }
        const correctPass = managerAuth[selectedUser] || "0000";
        if (password === correctPass) {
          onLogin("manager", { name: selectedUser });
        } else {
          setError("密碼錯誤");
        }
      } else if (role === "store") {
        if (!selectedUser) {
          setError("請選擇帳號");
          setIsLoading(false);
          return;
        }
        const account = storeAccounts.find((a) => a.id === selectedUser);
        if (account && account.password === password) {
          onLogin("store", {
            name: account.name,
            storeName: account.stores?.[0] || account.storeName,
            stores: account.stores,
          });
        } else {
          setError("密碼錯誤");
        }
      }
    } catch (e) {
      setError("登入發生錯誤");
    } finally {
      setIsLoading(false);
    }
  };

  // ==========================================
  // ★★★ 新增：管理師登入邏輯 ★★★
  // ==========================================
  const handleTherapistLogin = async () => {
    setError("");
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 600));

    try {
      if (!tPersonId) {
        setError("請選擇姓名");
        setIsLoading(false);
        return;
      }
      const therapist = therapistList.find(t => t.id === tPersonId);
      if (therapist && therapist.password === tPassword) {
        onLogin("therapist", therapist);
      } else {
        setError("密碼錯誤 (預設 0000)");
      }
    } catch (e) {
      setError("登入發生錯誤");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    setError("");
    if (!newPassword || !oldPassword) {
      setError("請輸入舊密碼與新密碼");
      return;
    }
    setIsLoading(true);
    let isVerified = false;
    if (role === "store" && selectedUser) {
      const account = storeAccounts.find((a) => a.id === selectedUser);
      if (account && account.password === oldPassword) isVerified = true;
    } else if (role === "manager" && selectedUser) {
      const correctPass = managerAuth[selectedUser] || "0000";
      if (correctPass === oldPassword) isVerified = true;
    }

    if (!isVerified) {
      setError("舊密碼錯誤");
      setIsLoading(false);
      return;
    }

    let success = false;
    if (role === "store" && selectedUser) {
      success = await onUpdatePassword(selectedUser, newPassword);
    } else if (role === "manager" && selectedUser) {
      success = await onUpdateManagerPassword(selectedUser, newPassword);
    }

    if (success) {
      alert("密碼更新成功");
      setIsResetting(false);
      setNewPassword("");
      setOldPassword("");
      setPassword("");
    } else {
      setError("更新失敗");
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9F8F6] p-4">
      <div className="bg-white w-full max-w-md p-8 rounded-3xl shadow-xl shadow-stone-200/50 border border-stone-100">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200 mx-auto mb-4">
            <Coffee size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-stone-800 tracking-tight">
            DRCYJ OPC Cloud
          </h1>
          <p className="text-stone-400 font-medium mt-2">智慧營運管理系統</p>
        </div>

        {/* 角色切換按鈕 (自動包含管理師) */}
        <div className="bg-stone-100 p-1.5 rounded-2xl flex mb-8 overflow-x-auto">
          {Object.entries(ROLES).map(([key, r]) => (
            <button
              key={key}
              onClick={() => {
                setRole(r.id);
                setError("");
                setPassword("");
                setSelectedUser("");
                setIsResetting(false);
                // 重置管理師表單
                setTRegion("");
                setTStore("");
                setTPersonId("");
                setTPassword("");
              }}
              className={`flex-1 py-2.5 px-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                role === r.id
                  ? "bg-white text-stone-800 shadow-sm"
                  : "text-stone-400 hover:text-stone-600"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          
          {/* ==================== 情境 A: 管理師登入表單 ==================== */}
          {role === "therapist" ? (
            loadingTherapists ? (
              <div className="py-10 text-center text-stone-400 flex flex-col items-center gap-2">
                <Loader2 className="animate-spin text-amber-400" size={32}/>
                <p className="text-xs">正在載入人員名單...</p>
              </div>
            ) : (
              <>
                {/* 1. 選擇區域 */}
                <div className="relative">
                  <MapPin className="absolute left-4 top-3.5 text-stone-400" size={18} />
                  <select
                    value={tRegion}
                    onChange={(e) => { setTRegion(e.target.value); setTStore(""); setTPersonId(""); }}
                    className="w-full pl-12 pr-4 py-3 bg-stone-50 border-2 border-stone-100 rounded-2xl outline-none font-bold text-stone-700 appearance-none"
                  >
                    <option value="">請選擇區域...</option>
                    {Object.keys(managers).map((m) => (
                      <option key={m} value={m}>{m}區</option>
                    ))}
                  </select>
                </div>

                {/* 2. 選擇店家 */}
                <div className="relative">
                  <Store className="absolute left-4 top-3.5 text-stone-400" size={18} />
                  <select
                    value={tStore}
                    onChange={(e) => { setTStore(e.target.value); setTPersonId(""); }}
                    disabled={!tRegion}
                    className="w-full pl-12 pr-4 py-3 bg-stone-50 border-2 border-stone-100 rounded-2xl outline-none font-bold text-stone-700 appearance-none disabled:opacity-50"
                  >
                    <option value="">請選擇店家...</option>
                    {filteredStores.map((s) => (
                      <option key={s} value={s}>{s}店</option>
                    ))}
                  </select>
                </div>

                {/* 3. 選擇姓名 */}
                <div className="relative">
                  <UserCheck className="absolute left-4 top-3.5 text-stone-400" size={18} />
                  <select
                    value={tPersonId}
                    onChange={(e) => setTPersonId(e.target.value)}
                    disabled={!tStore}
                    className="w-full pl-12 pr-4 py-3 bg-stone-50 border-2 border-stone-100 rounded-2xl outline-none font-bold text-stone-700 appearance-none disabled:opacity-50"
                  >
                    <option value="">請選擇姓名...</option>
                    {filteredTherapists.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                {tStore && filteredTherapists.length === 0 && (
                   <p className="text-xs text-rose-400 pl-2 text-center font-bold">⚠️ 該店尚無人員資料，請聯繫總監建立</p>
                )}

                {/* 4. 輸入密碼 */}
                <div className="relative">
                  <Lock className="absolute left-4 top-3.5 text-stone-400" size={18} />
                  <input
                    type="password"
                    value={tPassword}
                    onChange={(e) => setTPassword(e.target.value)}
                    placeholder="請輸入密碼"
                    className="w-full pl-12 pr-4 py-3 bg-stone-50 border-2 border-stone-100 rounded-2xl outline-none font-bold text-stone-700"
                    onKeyDown={(e) => e.key === "Enter" && handleTherapistLogin()}
                  />
                </div>

                {error && (
                  <div className="p-3 bg-rose-50 text-rose-500 text-sm font-bold rounded-xl flex items-center gap-2">
                    <AlertCircle size={16} /> {error}
                  </div>
                )}

                <button
                  onClick={handleTherapistLogin}
                  disabled={isLoading || !tPersonId || !tPassword}
                  className="w-full py-4 bg-stone-800 hover:bg-stone-900 text-white rounded-2xl font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? <Loader2 className="animate-spin" /> : "管理師登入"}
                </button>
              </>
            )
          ) : (
            // ==================== 情境 B: 一般角色登入 (保留原有邏輯) ====================
            <>
              {role === "manager" && (
                <div className="relative">
                  <select
                    value={selectedUser}
                    onChange={(e) => setSelectedUser(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-50 border-2 border-stone-100 rounded-2xl outline-none font-bold text-stone-700"
                  >
                    <option value="">請選擇區長...</option>
                    {Object.keys(managers).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {role === "store" && (
                <div className="relative">
                  <select
                    value={selectedUser}
                    onChange={(e) => setSelectedUser(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-50 border-2 border-stone-100 rounded-2xl outline-none font-bold text-stone-700"
                  >
                    <option value="">請選擇店經理...</option>
                    {storeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!isResetting ? (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="請輸入密碼"
                  className="w-full px-4 py-3 bg-stone-50 border-2 border-stone-100 rounded-2xl outline-none font-bold text-stone-700"
                  onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                />
              ) : (
                <div className="space-y-3">
                  <input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="舊密碼"
                    className="w-full px-4 py-3 bg-white border-2 border-stone-200 rounded-2xl font-bold"
                  />
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="新密碼"
                    className="w-full px-4 py-3 bg-white border-2 border-stone-200 rounded-2xl font-bold"
                  />
                </div>
              )}

              {error && (
                <div className="p-3 bg-rose-50 text-rose-500 text-sm font-bold rounded-xl flex items-center gap-2">
                  <AlertCircle size={16} /> {error}
                </div>
              )}

              {!isResetting ? (
                <button
                  onClick={handleAuth}
                  disabled={isLoading}
                  className="w-full py-4 bg-stone-800 hover:bg-stone-900 text-white rounded-2xl font-bold shadow-lg"
                >
                  {isLoading ? <Loader2 className="animate-spin" /> : "登入系統"}
                </button>
              ) : (
                <button
                  onClick={handlePasswordReset}
                  disabled={isLoading}
                  className="w-full py-4 bg-rose-500 hover:bg-rose-600 text-white rounded-2xl font-bold shadow-lg"
                >
                  {isLoading ? <Loader2 className="animate-spin" /> : "確認修改"}
                </button>
              )}

              {(role === "store" || role === "manager") && selectedUser && (
                <button
                  onClick={() => {
                    setIsResetting(!isResetting);
                    setError("");
                  }}
                  className="w-full text-center text-xs text-stone-400 hover:text-stone-600 font-bold py-2"
                >
                  {isResetting ? "返回登入" : "修改密碼?"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginView;