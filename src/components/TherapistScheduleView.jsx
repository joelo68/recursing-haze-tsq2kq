// src/components/TherapistScheduleView.jsx
import React, { useState, useContext, useEffect } from "react";
import { Save, Calendar } from "lucide-react";
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
    currentUser
  } = useContext(AppContext);

  const [tScheduleYear, setTScheduleYear] = useState(new Date().getFullYear().toString());
  const [tScheduleMonth, setTScheduleMonth] = useState((new Date().getMonth() + 1).toString());
  const [tScheduleTherapist, setTScheduleTherapist] = useState("");
  const [tLocalSchedule, setTLocalSchedule] = useState([]); // Array of days off

  const activeTherapists = therapists
    .filter(t => t.status === 'active')
    .sort((a, b) => a.store.localeCompare(b.store));

  useEffect(() => {
    if (userRole === 'therapist' && currentUser?.id) {
      setTScheduleTherapist(currentUser.id);
    }
  }, [userRole, currentUser]);

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

  const handleSaveTherapistSchedule = async () => {
    if (!tScheduleTherapist) return showToast("請選擇管理師", "error");
    try {
      const docId = `${tScheduleTherapist}_${tScheduleYear}_${parseInt(tScheduleMonth)}`;
      await setDoc(doc(db, "artifacts", appId, "public", "data", "therapist_schedules", docId), {
        therapistId: tScheduleTherapist,
        year: tScheduleYear,
        month: parseInt(tScheduleMonth),
        daysOff: tLocalSchedule,
        updatedAt: serverTimestamp()
      }, { merge: true });
      showToast("排休已儲存", "success");
    } catch (e) {
      showToast("儲存失敗", "error");
    }
  };

  const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();

  return (
    <ViewWrapper>
      <Card title="管理師每月排修設定" subtitle="點擊日期設定休假 (紅色代表休假)">
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
              <label className="block text-xs font-bold text-stone-400 mb-1">選擇管理師</label>
              <select 
                value={tScheduleTherapist} 
                onChange={(e) => setTScheduleTherapist(e.target.value)} 
                disabled={userRole === 'therapist'}
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
              <select value={tScheduleYear} onChange={(e) => setTScheduleYear(e.target.value)} className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl font-bold bg-white"><option value="2024">2024</option><option value="2025">2025</option><option value="2026">2026</option></select>
            </div>
            <div className="w-full md:w-32">
              <label className="block text-xs font-bold text-stone-400 mb-1">月份</label>
              <select value={tScheduleMonth} onChange={(e) => setTScheduleMonth(e.target.value)} className="w-full px-4 py-2 border-2 border-stone-200 rounded-xl font-bold bg-white">{Array.from({length: 12}, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}</select>
            </div>
            <button onClick={handleSaveTherapistSchedule} className="w-full md:w-auto bg-stone-800 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-stone-700 shadow-sm flex items-center justify-center gap-2">
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
            <div className="py-12 text-center text-stone-400 border-2 border-dashed border-stone-100 rounded-2xl">
              <Calendar size={48} className="mx-auto mb-2 opacity-20"/>
              <p>請先選擇管理師以進行排休</p>
            </div>
          )}
        </div>
      </Card>
    </ViewWrapper>
  );
};

export default TherapistScheduleView;