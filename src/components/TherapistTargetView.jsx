// src/components/TherapistTargetView.jsx
import React, { useState, useContext, useEffect, useMemo } from "react";
import { Save, DollarSign, Target, MapPin, Store, User } from "lucide-react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, appId } from "../config/firebase";
import { AppContext } from "../AppContext";
import { ViewWrapper, Card } from "./SharedUI";

const TherapistTargetView = () => {
  const {
    showToast,
    therapists,
    therapistTargets,
    userRole,
    currentUser,
    managers // 引入區域資料
  } = useContext(AppContext);

  const [tTargetYear, setTTargetYear] = useState(new Date().getFullYear().toString());
  
  // 三層篩選狀態
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [tTargetTherapist, setTTargetTherapist] = useState("");
  
  const [tLocalTargets, setTLocalTargets] = useState({});

  // 1. 初始化權限與預設值
  useEffect(() => {
    if (userRole === 'therapist' && currentUser) {
      // 管理師：全部鎖定，直接選自己
      // 反查自己的區域與店家 (為了顯示好看，雖然邏輯上只需 ID)
      const myRegion = Object.keys(managers).find(mgr => managers[mgr].includes(currentUser.storeName?.replace("CYJ","").replace("店","")));
      if (myRegion) setSelectedRegion(myRegion);
      setSelectedStore(currentUser.store || "");
      setTTargetTherapist(currentUser.id);
    } 
    else if (userRole === 'store' && currentUser) {
      // 店長：鎖定區域(選第一個找到的)，店家限制在自己管轄範圍
      const myStores = currentUser.stores || [currentUser.storeName];
      // 簡單起見，預設選第一個店的區域
      if (myStores.length > 0) {
        const firstStore = myStores[0].replace("CYJ", "").replace("店", "");
        const myRegion = Object.keys(managers).find(mgr => managers[mgr].includes(firstStore));
        if (myRegion) setSelectedRegion(myRegion);
        // 若只有一家店，直接選中
        if (myStores.length === 1) setSelectedStore(firstStore);
      }
    }
    else if (userRole === 'manager' && currentUser) {
      // 區長：鎖定區域為自己
      setSelectedRegion(currentUser.name);
    }
  }, [userRole, currentUser, managers]);

  // 2. 計算可用的店家列表 (依據區域)
  const availableStores = useMemo(() => {
    if (!selectedRegion) return [];
    
    const regionStores = managers[selectedRegion] || [];
    
    // 如果是店長，只能看自己管轄的店 (取交集)
    if (userRole === 'store' && currentUser) {
      const myStores = (currentUser.stores || [currentUser.storeName]).map(s => s.replace("CYJ", "").replace("店", ""));
      return regionStores.filter(s => myStores.includes(s));
    }
    
    return regionStores;
  }, [selectedRegion, managers, userRole, currentUser]);

  // 3. 計算可用的管理師列表 (依據店家)
  const availableTherapists = useMemo(() => {
    if (!selectedStore) return [];
    return therapists
      .filter(t => t.status === 'active' && t.store === selectedStore)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedStore, therapists]);

  // 4. 讀取目標資料
  useEffect(() => {
    if (tTargetTherapist && tTargetYear) {
      const docId = `${tTargetTherapist}_${tTargetYear}`;
      const data = therapistTargets[docId] || {};
      setTLocalTargets(data.monthlyTargets || {});
    } else {
      setTLocalTargets({});
    }
  }, [tTargetTherapist, tTargetYear, therapistTargets]);

  // 5. 儲存處理
  const handleSaveTherapistTargets = async () => {
    if (!tTargetTherapist) return showToast("請選擇管理師", "error");
    try {
      const docId = `${tTargetTherapist}_${tTargetYear}`;
      await setDoc(doc(db, "artifacts", appId, "public", "data", "therapist_targets", docId), {
        therapistId: tTargetTherapist,
        year: tTargetYear,
        monthlyTargets: tLocalTargets,
        updatedAt: serverTimestamp()
      }, { merge: true });
      showToast("目標已儲存", "success");
    } catch (e) {
      showToast("儲存失敗", "error");
    }
  };

  return (
    <ViewWrapper>
      <Card title="管理師年度目標設定" subtitle="預先設定每月的個人業績目標">
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
                  setTTargetTherapist(""); 
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
                  setTTargetTherapist(""); 
                }} 
                disabled={!selectedRegion || userRole === 'therapist'}
                className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl outline-none focus:border-amber-400 font-bold bg-white disabled:bg-stone-100 disabled:text-stone-500"
              >
                <option value="">請選擇店家...</option>
                {availableStores.map(store => (
                  <option key={store} value={store}>{store}店</option>
                ))}
              </select>
            </div>

            {/* 3. 管理師選擇 */}
            <div className="flex-1 w-full">
              <label className="block text-xs font-bold text-stone-400 mb-1 flex items-center gap-1">
                <User size={12}/> 管理師
              </label>
              <select 
                value={tTargetTherapist} 
                onChange={(e) => setTTargetTherapist(e.target.value)} 
                disabled={!selectedStore || userRole === 'therapist'}
                className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl outline-none focus:border-amber-400 font-bold bg-white disabled:bg-stone-100 disabled:text-stone-500"
              >
                <option value="">請選擇管理師...</option>
                {availableTherapists.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* 年度選擇 */}
            <div className="w-full md:w-32">
              <label className="block text-xs font-bold text-stone-400 mb-1">年度</label>
              <select 
                value={tTargetYear} 
                onChange={(e) => setTTargetYear(e.target.value)} 
                className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl outline-none focus:border-amber-400 font-bold bg-white"
              >
                {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-end">
             <button onClick={handleSaveTherapistTargets} disabled={!tTargetTherapist} className="w-full md:w-auto bg-stone-800 text-white px-8 py-3 rounded-xl font-bold hover:bg-stone-700 shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95">
              <Save size={18}/> 儲存設定
            </button>
          </div>

          {tTargetTherapist ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-in slide-in-from-top-2">
              {Array.from({length: 12}, (_, i) => i + 1).map(m => (
                <div key={m} className="bg-stone-50 p-4 rounded-xl border border-stone-200">
                  <div className="text-xs font-bold text-stone-400 mb-2 uppercase">{m} 月目標</div>
                  <div className="relative">
                    <DollarSign size={14} className="absolute left-3 top-3 text-stone-400"/>
                    <input 
                      type="number" 
                      value={tLocalTargets[m] || ""} 
                      onChange={(e) => setTLocalTargets({...tLocalTargets, [m]: e.target.value})}
                      placeholder="0"
                      className="w-full pl-8 pr-3 py-2 border border-stone-200 rounded-lg font-mono font-bold text-stone-700 focus:border-amber-400 outline-none transition-colors focus:bg-white"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-20 text-center text-stone-400 border-2 border-dashed border-stone-100 rounded-2xl flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center">
                 <Target size={32} className="opacity-20"/>
              </div>
              <p>請依序選擇 區域 &gt; 店家 &gt; 管理師 以載入資料</p>
            </div>
          )}
        </div>
      </Card>
    </ViewWrapper>
  );
};

export default TherapistTargetView;