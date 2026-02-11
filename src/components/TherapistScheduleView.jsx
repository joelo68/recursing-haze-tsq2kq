// src/components/TherapistScheduleView.jsx
import React, { useState, useContext, useEffect, useMemo } from "react";
import { Save, Calendar, MapPin, Store, User } from "lucide-react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, appId } from "../config/firebase";
import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";

const TherapistScheduleView = () => {
  const {
    showToast,
    therapists,
    therapistSchedules,
    userRole,
    currentUser,
    managers,
    // ★★★ 1. 引入動態路徑與品牌資訊 ★★★
    getCollectionPath,
    currentBrand
  } = useContext(AppContext);

  const [tScheduleYear, setTScheduleYear] = useState(new Date().getFullYear().toString());
  const [tScheduleMonth, setTScheduleMonth] = useState((new Date().getMonth() + 1).toString());
  
  // 三層篩選狀態
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [tScheduleTherapist, setTScheduleTherapist] = useState("");
  
  const [tLocalSchedule, setTLocalSchedule] = useState([]); // Array of days off

  // ★★★ 2. 定義品牌前綴 (與 Dashboard/TargetView 一致，確保穩健) ★★★
  const brandPrefix = useMemo(() => {
    let name = "CYJ";
    if (currentBrand) {
      const id = typeof currentBrand === 'string' ? currentBrand : (currentBrand.id || "CYJ");
      const normalizedId = id.toLowerCase();
      
      if (normalizedId.includes("anniu") || normalizedId.includes("anew")) {
        name = "安妞";
      } else if (normalizedId.includes("yibo")) {
        name = "伊啵";
      } else {
        name = "CYJ";
      }
    }
    return name;
  }, [currentBrand]);

  // 1. 初始化權限與預設值
  useEffect(() => {
    // 切換品牌時重置
    setSelectedRegion("");
    setSelectedStore("");
    setTScheduleTherapist("");

    // 輔助函式：清理店名 (使用正規表達式移除所有可能前綴)
    const cleanStoreName = (name) => {
      if (!name) return "";
      return name.replace(/CYJ|安妞|伊啵|Anew|Yibo|店/gi, "").trim();
    };

    if (userRole === 'therapist' && currentUser) {
      // 管理師：全部鎖定，直接選自己
      const rawStoreName = currentUser.storeName || currentUser.store || "";
      const cleanName = cleanStoreName(rawStoreName);

      const myRegion = Object.keys(managers).find(mgr => managers[mgr].includes(cleanName));
      if (myRegion) setSelectedRegion(myRegion);
      
      // 設定店名 (使用清洗後的核心店名)
      setSelectedStore(cleanName || currentUser.store);
      setTScheduleTherapist(currentUser.id);
    } 
    else if (userRole === 'store' && currentUser) {
      // 店長：鎖定區域(選第一個找到的)，店家限制在自己管轄範圍
      const myStores = currentUser.stores || [currentUser.storeName];
      if (myStores.length > 0) {
        const firstRawName = myStores[0];
        const cleanFirst = cleanStoreName(firstRawName);

        const myRegion = Object.keys(managers).find(mgr => managers[mgr].includes(cleanFirst));
        if (myRegion) setSelectedRegion(myRegion);
        
        // 若只有一家店，直接選中
        if (myStores.length === 1) {
             setSelectedStore(cleanFirst);
        }
      }
    }
    else if (userRole === 'manager' && currentUser) {
      // 區長：鎖定區域為自己
      setSelectedRegion(currentUser.name);
    }
  }, [userRole, currentUser, managers, brandPrefix, currentBrand]);

  // 2. 計算可用的店家列表 (依據區域)
  const availableStores = useMemo(() => {
    if (!selectedRegion) return [];
    
    const regionStores = managers[selectedRegion] || [];
    
    // 如果是店長，只能看自己管轄的店 (取交集)
    if (userRole === 'store' && currentUser) {
      const myStoresRaw = (currentUser.stores || [currentUser.storeName]);
      // 將店長管轄的店名清乾淨
      const myStoresClean = myStoresRaw.map(s => s.replace(/CYJ|安妞|伊啵|Anew|Yibo|店/gi, "").trim());
      return regionStores.filter(s => myStoresClean.includes(s));
    }
    
    return regionStores;
  }, [selectedRegion, managers, userRole, currentUser]);

  // 3. 計算可用的管理師列表 (依據店家)
  const availableTherapists = useMemo(() => {
    if (!selectedStore) return [];
    // Therapists 資料庫裡的 store 欄位通常存的是 "簡稱" (例如 "中山")
    // 所以這裡 selectedStore 也必須是簡稱
    return therapists
      .filter(t => t.status === 'active' && t.store === selectedStore)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedStore, therapists]);

  // 4. 讀取排休資料
  useEffect(() => {
    if (tScheduleTherapist && tScheduleYear && tScheduleMonth) {
      const docId = `${tScheduleTherapist}_${tScheduleYear}_${parseInt(tScheduleMonth)}`;
      const data = therapistSchedules[docId] || {};
      setTLocalSchedule(data.daysOff || []);
    } else {
      setTLocalSchedule([]);
    }
  }, [tScheduleTherapist, tScheduleYear, tScheduleMonth, therapistSchedules]);

  const toggleDayOff = (day) => {
    setTLocalSchedule(prev => {
      if (prev.includes(day)) return prev.filter(d => d !== day);
      return [...prev, day].sort((a,b) => a - b);
    });
  };

  // 5. 儲存排休 (修正寫入路徑)
  const handleSaveTherapistSchedule = async () => {
    if (!tScheduleTherapist) return showToast("請選擇管理師", "error");
    try {
      const docId = `${tScheduleTherapist}_${tScheduleYear}_${parseInt(tScheduleMonth)}`;
      
      // ★★★ 3. 使用動態路徑 getCollectionPath ★★★
      await setDoc(doc(getCollectionPath("therapist_schedules"), docId), {
        therapistId: tScheduleTherapist,
        year: tScheduleYear,
        month: parseInt(tScheduleMonth),
        daysOff: tLocalSchedule,
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      showToast("排休已儲存", "success");
    } catch (e) {
      console.error(e);
      showToast("儲存失敗", "error");
    }
  };

  const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();

  return (
    <ViewWrapper>
      <Card title="管理師每月排修設定" subtitle="點擊日期設定休假 (紅色代表休假)">
        <div className="space-y-6">
          {/* 三層篩選器 */}
          <div className="flex flex-col md:flex-row gap-4 items-end bg-stone-50 p-4 rounded-xl border border-stone-200">
            
            {/* 1. 區域選擇 */}
            <div className="flex-1 w-full">
              <label className="block text-xs font-bold text-stone-400 mb-1 flex items-center gap-1">
                <MapPin size={12}/> 區域 (區長)
              </label>
              <select 
                value={selectedRegion} 
                onChange={(e) => { 
                  setSelectedRegion(e.target.value); 
                  setSelectedStore(""); 
                  setTScheduleTherapist(""); 
                }}
                disabled={userRole === 'manager' || userRole === 'therapist' || (userRole === 'store' && selectedRegion !== "")}
                className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl outline-none focus:border-amber-400 font-bold bg-white disabled:bg-stone-100 disabled:text-stone-500"
              >
                <option value="">請選擇區域...</option>
                {Object.keys(managers).map(mgr => (
                  <option key={mgr} value={mgr}>{mgr}區</option>
                ))}
              </select>
            </div>

            {/* 2. 店家選擇 */}
            <div className="flex-1 w-full">
              <label className="block text-xs font-bold text-stone-400 mb-1 flex items-center gap-1">
                <Store size={12}/> 店家
              </label>
              <select 
                value={selectedStore} 
                onChange={(e) => { 
                  setSelectedStore(e.target.value); 
                  setTScheduleTherapist(""); 
                }} 
                disabled={!selectedRegion || userRole === 'therapist'}
                className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl outline-none focus:border-amber-400 font-bold bg-white disabled:bg-stone-100 disabled:text-stone-500"
              >
                <option value="">請選擇店家...</option>
                {availableStores.map(store => (
                  // 顯示：加上品牌前綴 (如：安妞中山店)
                  // 值：維持簡稱 (如：中山) 以便後續篩選
                  <option key={store} value={store}>{brandPrefix}{store}店</option>
                ))}
              </select>
            </div>

            {/* 3. 管理師選擇 */}
            <div className="flex-1 w-full">
              <label className="block text-xs font-bold text-stone-400 mb-1 flex items-center gap-1">
                <User size={12}/> 管理師
              </label>
              <select 
                value={tScheduleTherapist} 
                onChange={(e) => setTScheduleTherapist(e.target.value)} 
                disabled={!selectedStore || userRole === 'therapist'}
                className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl outline-none focus:border-amber-400 font-bold bg-white disabled:bg-stone-100 disabled:text-stone-500"
              >
                <option value="">請選擇管理師...</option>
                {availableTherapists.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* 年月選擇 */}
            <div className="flex gap-2 w-full md:w-auto">
              <div className="w-1/2 md:w-24">
                <label className="block text-xs font-bold text-stone-400 mb-1">年度</label>
                <select value={tScheduleYear} onChange={(e) => setTScheduleYear(e.target.value)} className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl font-bold bg-white">
                  {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="w-1/2 md:w-24">
                <label className="block text-xs font-bold text-stone-400 mb-1">月份</label>
                <select value={tScheduleMonth} onChange={(e) => setTScheduleMonth(e.target.value)} className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl font-bold bg-white">{Array.from({length: 12}, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}</select>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveTherapistSchedule} disabled={!tScheduleTherapist} className="w-full md:w-auto bg-stone-800 text-white px-8 py-3 rounded-xl font-bold hover:bg-stone-700 shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95">
              <Save size={18}/> 儲存排休
            </button>
          </div>

          {tScheduleTherapist ? (
            <div className="bg-stone-50 p-6 rounded-2xl border border-stone-200 animate-in fade-in">
              <div className="grid grid-cols-7 gap-2 mb-2 text-center">
                {['日','一','二','三','四','五','六'].map(d => <div key={d} className="text-xs font-bold text-stone-400">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {Array.from({length: new Date(tScheduleYear, tScheduleMonth - 1, 1).getDay()}).map((_, i) => <div key={`empty-${i}`} />)}
                {Array.from({length: getDaysInMonth(tScheduleYear, tScheduleMonth)}).map((_, i) => {
                  const day = i + 1;
                  const isOff = tLocalSchedule.includes(day);
                  return (
                    <button
                      key={day}
                      onClick={() => toggleDayOff(day)}
                      className={`aspect-square rounded-xl font-bold text-sm flex items-center justify-center transition-all ${
                        isOff 
                          ? "bg-rose-500 text-white shadow-md shadow-rose-200 scale-95" 
                          : "bg-white text-stone-700 border border-stone-200 hover:border-amber-400"
                      }`}
                    >
                      {day}
                      {isOff && <span className="absolute bottom-1 text-[8px] opacity-80">休</span>}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center justify-center gap-4 text-xs font-bold text-stone-500">
                <div className="flex items-center gap-1"><div className="w-3 h-3 bg-white border border-stone-300 rounded"></div> 上班日</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 bg-rose-500 rounded"></div> 休假日</div>
              </div>
            </div>
          ) : (
            <div className="py-20 text-center text-stone-400 border-2 border-dashed border-stone-100 rounded-2xl flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center">
                 <Calendar size={32} className="opacity-20"/>
              </div>
              <p>請依序選擇 區域 &gt; 店家 &gt; 管理師 以進行排休</p>
            </div>
          )}
        </div>
      </Card>
    </ViewWrapper>
  );
};

export default TherapistScheduleView;