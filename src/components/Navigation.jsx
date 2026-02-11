// src/components/Navigation.jsx
import React, { useMemo, useContext } from "react";
import { User, LogOut, Sparkles, Coffee, Crown } from "lucide-react";
import { ROLES, ALL_MENU_ITEMS } from "../constants";
import { AppContext } from "../AppContext";

export const Sidebar = ({
  activeView,
  setActiveView,
  isSidebarOpen,
  setSidebarOpen,
  userRole,
  onLogout,
  permissions,
  currentUser,
}) => {
  // ★★★ 1. 引入 AppContext 取得當前品牌 ★★★
  const { currentBrand } = useContext(AppContext);

  // ★★★ 2. 定義品牌主題與樣式 ★★★
  const brandConfig = useMemo(() => {
    let id = "cyj";
    let label = "CYJ";
    
    if (currentBrand) {
        id = typeof currentBrand === 'string' ? currentBrand : (currentBrand.id || "cyj");
        // 優先使用標準化名稱
        if (id.includes('anniu')) { id = 'anniu'; label = '安妞'; }
        else if (id.includes('yibo')) { id = 'yibo'; label = '伊啵'; }
        else { id = 'cyj'; label = 'CYJ'; }
    }

    // 預設 CYJ 主題 (Amber/Orange)
    let theme = {
        gradient: "from-amber-400 to-orange-600",
        shadow: "shadow-orange-200",
        activeBg: "bg-amber-50",
        activeText: "text-amber-700",
        iconColor: "text-amber-600",
        indicator: "bg-amber-500",
        logoChar: "C",
        Icon: Crown
    };

    // 安妞主題 (Rose/Pink)
    if (id === 'anniu') {
        theme = {
            gradient: "from-rose-400 to-pink-600",
            shadow: "shadow-rose-200",
            activeBg: "bg-rose-50",
            activeText: "text-rose-700",
            iconColor: "text-rose-600",
            indicator: "bg-rose-500",
            logoChar: "A",
            Icon: Coffee
        };
    } 
    // 伊啵主題 (Yellow)
    else if (id === 'yibo') {
        theme = {
            gradient: "from-yellow-400 to-yellow-600",
            shadow: "shadow-yellow-200",
            activeBg: "bg-yellow-50",
            activeText: "text-yellow-700",
            iconColor: "text-yellow-600",
            indicator: "bg-yellow-500",
            logoChar: "Y",
            Icon: Sparkles
        };
    }

    return { id, label, theme };
  }, [currentBrand]);

  const { theme, label } = brandConfig;

  const menuItems = useMemo(() => {
    if (!userRole) return [];
    if (userRole === "director") return ALL_MENU_ITEMS;
    const allowed = permissions[userRole] || [];
    return ALL_MENU_ITEMS.filter((item) => allowed.includes(item.id));
  }, [userRole, permissions]);

  return (
    <>
      <div
        className={`fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-30 md:hidden transition-opacity duration-300 ${
          isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        className={`fixed top-0 left-0 h-full bg-white border-r border-stone-200 z-50 transition-all duration-300 flex flex-col ${
          isSidebarOpen ? "w-64 translate-x-0" : "w-20 -translate-x-full md:translate-x-0"
        }`}
      >
        {/* ★★★ 3. 品牌 Logo 區域 ★★★ */}
        <div className="h-20 flex items-center px-6 border-b border-stone-100 shrink-0">
          <div className={`w-8 h-8 bg-gradient-to-br ${theme.gradient} rounded-xl flex items-center justify-center shadow-lg ${theme.shadow} mr-3 shrink-0 transition-all duration-500`}>
            {/* 顯示品牌 Logo 圖示或首字母 */}
            {brandConfig.id === 'cyj' ? <span className="text-white font-bold text-lg">C</span> : <theme.Icon size={18} className="text-white" />}
          </div>
          <span className={`font-extrabold text-lg text-stone-800 tracking-tight transition-opacity duration-300 ${isSidebarOpen ? "opacity-100" : "opacity-0 w-0 hidden"}`}>
            {label} 營運系統
          </span>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1 custom-scrollbar">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveView(item.id);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
                // ★★★ 4. 動態套用品牌顏色 ★★★
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-200 group relative ${
                  isActive ? `${theme.activeBg} ${theme.activeText} shadow-sm` : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
                }`}
                title={!isSidebarOpen ? item.label : ""}
              >
                <Icon size={22} className={`shrink-0 transition-colors ${isActive ? theme.iconColor : "text-stone-400 group-hover:text-stone-600"}`} />
                <span className={`font-bold text-sm whitespace-nowrap transition-all duration-300 ${isSidebarOpen ? "opacity-100" : "opacity-0 w-0 hidden"}`}>
                  {item.label}
                </span>
                {isActive && <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 ${theme.indicator} rounded-l-full`} />}
              </button>
            );
          })}
        </div>
        
        <div className="p-4 border-t border-stone-100 shrink-0">
          <div className={`bg-stone-50 rounded-2xl p-3 flex items-center gap-3 mb-3 transition-all ${!isSidebarOpen && "justify-center"}`}>
            <div className="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center shrink-0 overflow-hidden">
              <User size={20} className="text-stone-400" />
            </div>
            {isSidebarOpen && (
              <div className="overflow-hidden">
                <p className="text-sm font-bold text-stone-700 truncate">{currentUser?.name || (userRole === "director" ? "總監" : "使用者")}</p>
                <p className="text-xs text-stone-400 truncate capitalize">{ROLES[userRole?.toUpperCase()]?.label || userRole}</p>
              </div>
            )}
          </div>
          <button onClick={onLogout} className={`w-full flex items-center gap-2 text-stone-400 hover:text-rose-500 hover:bg-rose-50 px-3 py-2 rounded-xl transition-all ${!isSidebarOpen && "justify-center"}`}>
            <LogOut size={20} />
            {isSidebarOpen && <span className="font-bold text-sm">登出系統</span>}
          </button>
        </div>
      </aside>
    </>
  );
};

export const MobileTopNav = ({ activeView, setActiveView, permissions, userRole, onLogout }) => {
  // ★★★ 手機版也需要 Context 來變色 ★★★
  const { currentBrand } = useContext(AppContext);
  
  const themeClass = useMemo(() => {
    const id = currentBrand?.id || 'cyj';
    if (id.includes('anniu')) return "bg-rose-600 text-white shadow-rose-200";
    if (id.includes('yibo')) return "bg-yellow-500 text-white shadow-yellow-200";
    return "bg-stone-800 text-white shadow-stone-200"; // CYJ Default
  }, [currentBrand]);

  const menuItems = useMemo(() => {
    if (!userRole) return [];
    if (userRole === "director") return ALL_MENU_ITEMS;
    const allowed = permissions[userRole] || [];
    return ALL_MENU_ITEMS.filter((item) => allowed.includes(item.id));
  }, [userRole, permissions]);

  return (
    <div className="md:hidden bg-white border-b border-stone-200 overflow-x-auto no-scrollbar">
      <div className="flex items-center px-4 h-14 gap-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                isActive ? `${themeClass} shadow-md` : "bg-stone-100 text-stone-500"
              }`}
            >
              <Icon size={14} />
              {item.label}
            </button>
          );
        })}
        <button onClick={onLogout} className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap bg-stone-100 text-stone-500 hover:bg-rose-50 hover:text-rose-500 transition-all">
          <LogOut size={14} />
          登出
        </button>
      </div>
    </div>
  );
};