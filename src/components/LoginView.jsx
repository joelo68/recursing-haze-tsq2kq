// src/components/LoginView.jsx
import React, { useState } from "react";
import { Coffee, AlertCircle, Loader2 } from "lucide-react";
import { ROLES } from "../constants"; // 確保路徑正確

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

        <div className="bg-stone-100 p-1.5 rounded-2xl flex mb-8">
          {Object.entries(ROLES).map(([key, r]) => (
            <button
              key={key}
              onClick={() => {
                setRole(r.id);
                setError("");
                setPassword("");
                setSelectedUser("");
                setIsResetting(false);
              }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
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
        </div>
      </div>
    </div>
  );
};

export default LoginView;