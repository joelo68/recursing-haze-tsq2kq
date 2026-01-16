// src/components/TherapistTargetView.jsx
import React, { useState, useContext, useEffect } from "react";
import { Save, DollarSign, Target } from "lucide-react";
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
    currentUser
  } = useContext(AppContext);

  const [tTargetYear, setTTargetYear] = useState(new Date().getFullYear().toString());
  const [tTargetTherapist, setTTargetTherapist] = useState("");
  const [tLocalTargets, setTLocalTargets] = useState({});

  // 1. 權限判斷：可見的管理師名單
  const activeTherapists = therapists
    .filter(t => t.status === 'active')
    .sort((a, b) => a.store.localeCompare(b.store));

  // 2. 初始載入：如果是管理師本人，自動選取自己
  useEffect(() => {
    if (userRole === 'therapist' && currentUser?.id) {
      setTTargetTherapist(currentUser.id);
    }
  }, [userRole, currentUser]);

  // 3. 讀取目標資料
  useEffect(() => {
    if (tTargetTherapist && tTargetYear) {
      const docId = `${tTargetTherapist}_${tTargetYear}`;
      const data = therapistTargets[docId] || {};
      setTLocalTargets(data.monthlyTargets || {});
    } else {
      setTLocalTargets({});
    }
  }, [tTargetTherapist, tTargetYear, therapistTargets]);

  // 4. 儲存處理
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
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
              <label className="block text-xs font-bold text-stone-400 mb-1">選擇管理師</label>
              <select 
                value={tTargetTherapist} 
                onChange={(e) => setTTargetTherapist(e.target.value)} 
                disabled={userRole === 'therapist'} // 管理師鎖定
                className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl outline-none focus:border-amber-400 font-bold bg-white disabled:bg-stone-100 disabled:text-stone-500"
              >
                <option value="">請選擇...</option>
                {activeTherapists.map(t => (
                  <option key={t.id} value={t.id}>{t.store}店 - {t.name}</option>
                ))}
              </select>
            </div>
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
            <button onClick={handleSaveTherapistTargets} className="w-full md:w-auto bg-stone-800 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-stone-700 shadow-sm flex items-center justify-center gap-2">
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
                      className="w-full pl-8 pr-3 py-2 border border-stone-200 rounded-lg font-mono font-bold text-stone-700 focus:border-amber-400 outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-stone-400 border-2 border-dashed border-stone-100 rounded-2xl">
              <Target size={48} className="mx-auto mb-2 opacity-20"/>
              <p>請先選擇管理師以載入資料</p>
            </div>
          )}
        </div>
      </Card>
    </ViewWrapper>
  );
};

export default TherapistTargetView;