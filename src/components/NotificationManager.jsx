// src/components/NotificationManager.jsx
import React, { useState, useEffect } from "react";
import { 
  Bell, Clock, Database, Send, Plus, Trash2, Edit3, 
  Save, ToggleLeft, ToggleRight, PlayCircle, Activity
} from "lucide-react";
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "../config/firebase";
import { ViewWrapper, Card } from "./SharedUI";

const DATA_SOURCES = {
  progress: {
    label: "目前現金、權責進度",
    vars: ["{cashTotal}", "{accrualTotal}", "{cashRate}", "{accrualRate}"],
    defaultTemplate: "📊 *【營運進度戰報】*\n目前現金業績：${cashTotal} (達成率 {cashRate}%)\n目前總權責：${accrualTotal} (達成率 {accrualRate}%)"
  },
  top5_stores: {
    label: "昨日業績 TOP 5 (店家)",
    vars: ["{top5Stores}", "{date}"],
    defaultTemplate: "☀️ *【晨間戰報】昨日全區 TOP 5* ☀️\n\n早安！{date} 的激烈廝殺結果出爐：\n\n{top5Stores}\n\n今日戰火已經點燃，繼續保持火力！🔥"
  },
  top5_therapists: {
    label: "昨日 TOP 5 (管理師)",
    vars: ["{top5Therapists}", "{date}"],
    defaultTemplate: "🌟 *【個人榮耀】昨日管理師 TOP 5* 🌟\n\n{date} 個人戰績排行：\n\n{top5Therapists}\n\n締造佳績，突破自我！🚀"
  },
  bottom5_stores: {
    label: "需關注 5 店家 (進度落後)",
    vars: ["{bottom5Stores}", "{date}"],
    defaultTemplate: "⚠️ *【營運關注名單】*\n\n主管們請留意，以下門市目前累積進度嚴重落後，請盡速關心支援：\n\n{bottom5Stores}\n\n目標未達，緊咬不放！"
  },
  unreported: {
    label: "未回報店家清單",
    vars: ["{missingStores}", "{missingCount}", "{date}"],
    defaultTemplate: "🚨 *【系統警報】日報未繳交* 🚨\n\n截至目前，共有 {missingCount} 間門市尚未送出 {date} 的日報：\n\n{missingStores}\n\n請區長協助追蹤回報進度！"
  }
};

const NotificationManager = () => {
  const [rules, setRules] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [currentRule, setCurrentRule] = useState(null);

  const fetchRules = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, "notification_rules"));
      const rulesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      rulesData.sort((a, b) => a.time.localeCompare(b.time));
      setRules(rulesData);
    } catch (error) {
      console.error("載入推播規則失敗:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleSaveRule = async (e) => {
    e.preventDefault();
    try {
      if (currentRule.id) {
        await updateDoc(doc(db, "notification_rules", currentRule.id), currentRule);
      } else {
        await addDoc(collection(db, "notification_rules"), {
          ...currentRule,
          createdAt: new Date().toISOString()
        });
      }
      setIsEditing(false);
      setCurrentRule(null);
      fetchRules();
    } catch (error) {
      alert("儲存失敗：" + error.message);
    }
  };

  const handleDelete = async (id) => {
    if(window.confirm("確定要刪除這個推播任務嗎？刪除後無法復原。")) {
      try {
        await deleteDoc(doc(db, "notification_rules", id));
        fetchRules();
      } catch (error) {
        alert("刪除失敗");
      }
    }
  };

  const toggleActive = async (rule) => {
    try {
      await updateDoc(doc(db, "notification_rules", rule.id), { isActive: !rule.isActive });
      fetchRules();
    } catch (error) {
      console.error("切換狀態失敗", error);
    }
  };

  const generatePreview = (template, sourceKey) => {
    if (!template) return "請輸入推播文案...";
    let text = template;
    const today = new Date().toLocaleDateString();
    text = text.replace(/{date}/g, today);
    text = text.replace(/{cashTotal}/g, "1,250,000");
    text = text.replace(/{accrualTotal}/g, "1,420,000");
    text = text.replace(/{cashRate}/g, "85");
    text = text.replace(/{accrualRate}/g, "92");
    text = text.replace(/{top5Stores}/g, "🥇 1. 大安店 ($150,000)\n🥈 2. 信義店 ($120,000)\n🥉 3. 中山店 ($90,000)\n4. 崇學店 ($85,000)\n5. 巨蛋店 ($80,000)");
    text = text.replace(/{top5Therapists}/g, "🥇 1. 林小美 ($50,000)\n🥈 2. 陳大明 ($42,000)\n🥉 3. 張雅婷 ($39,000)\n4. 王大鈞 ($35,000)\n5. 吳佳玲 ($31,000)");
    text = text.replace(/{bottom5Stores}/g, "1. 新莊店 (-15%)\n2. 蘆洲店 (-12%)\n3. 板橋店 (-10%)\n4. 桃園店 (-8%)\n5. 中壢店 (-5%)");
    text = text.replace(/{missingStores}/g, "• 南港店\n• 內湖店");
    text = text.replace(/{missingCount}/g, "2");
    return text;
  };

  return (
    <ViewWrapper>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div className="flex items-center gap-2">
          <div className="bg-amber-50 p-2 rounded-xl border border-amber-100">
            <Bell className="text-amber-600" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-stone-800 tracking-tight">動態推播控制中心</h2>
            <p className="text-stone-500 text-[13px] font-medium mt-0.5">自訂您的 Telegram 戰報排程與內容</p>
          </div>
        </div>
        {!isEditing && (
          <button 
            onClick={() => {
              setCurrentRule({
                name: "", time: "09:00", source: "top5_stores", 
                targetGroup: "main", template: DATA_SOURCES["top5_stores"].defaultTemplate, isActive: true
              });
              setIsEditing(true);
            }}
            className="bg-stone-800 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 hover:bg-stone-900 transition-all shadow-sm active:scale-95"
          >
            <Plus size={16} strokeWidth={2.5} /> 新增排程
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 animate-in slide-in-from-bottom-4 duration-300">
          <div className="lg:col-span-7">
            <Card title="排程與文案設定" icon={<Edit3 className="text-stone-400" size={18}/>}>
              <form onSubmit={handleSaveRule} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5">任務名稱</label>
                  <input type="text" required value={currentRule.name} onChange={e => setCurrentRule({...currentRule, name: e.target.value})} className="w-full border-2 border-stone-100 p-2.5 rounded-xl outline-none focus:border-amber-400 font-bold text-stone-700 bg-stone-50 focus:bg-white text-sm" placeholder="例如：每日晨間激勵"/>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Clock size={12}/> 觸發時間</label>
                    <input type="time" required value={currentRule.time} onChange={e => setCurrentRule({...currentRule, time: e.target.value})} className="w-full border-2 border-stone-100 p-2.5 rounded-xl outline-none focus:border-amber-400 font-bold text-stone-700 bg-stone-50 focus:bg-white text-sm"/>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Send size={12}/> 發送群組</label>
                    <select value={currentRule.targetGroup} onChange={e => setCurrentRule({...currentRule, targetGroup: e.target.value})} className="w-full border-2 border-stone-100 p-2.5 rounded-xl outline-none focus:border-amber-400 font-bold text-stone-700 bg-stone-50 focus:bg-white text-sm appearance-none cursor-pointer">
                      <option value="main">營運大群組 (全體)</option>
                      <option value="manager">主管戰情室 (限高階)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Database size={12}/> 資料來源</label>
                  <select 
                    value={currentRule.source} 
                    onChange={e => {
                      const newSource = e.target.value;
                      setCurrentRule({...currentRule, source: newSource, template: DATA_SOURCES[newSource].defaultTemplate});
                    }} 
                    className="w-full border-2 border-stone-100 p-2.5 rounded-xl outline-none focus:border-amber-400 font-bold text-stone-700 bg-stone-50 focus:bg-white text-sm appearance-none cursor-pointer"
                  >
                    {Object.entries(DATA_SOURCES).map(([key, data]) => (
                      <option key={key} value={key}>{data.label}</option>
                    ))}
                  </select>
                </div>
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">自訂推播文案</label>
                    <span className="text-[10px] text-stone-400">支援 Markdown 格式</span>
                  </div>
                  <div className="bg-stone-50 px-2 py-1.5 rounded-lg mb-2 text-[11px] text-stone-500 font-medium flex flex-wrap gap-1 items-center border border-stone-100">
                    <span className="font-bold text-stone-600">可用變數：</span>
                    {DATA_SOURCES[currentRule.source].vars.map(v => (
                      <code key={v} className="bg-white px-1.5 py-0.5 rounded shadow-sm border border-stone-200 font-mono text-indigo-600">{v}</code>
                    ))}
                  </div>
                  <textarea 
                    rows={7} 
                    value={currentRule.template} 
                    onChange={e => setCurrentRule({...currentRule, template: e.target.value})} 
                    className="w-full border-2 border-stone-100 p-3 rounded-xl outline-none focus:border-amber-400 font-mono text-[13px] text-stone-700 leading-relaxed bg-stone-50 focus:bg-white resize-none"
                  />
                </div>
                <div className="flex gap-3 pt-3 border-t border-stone-100">
                  <button type="button" onClick={() => setIsEditing(false)} className="flex-1 py-2.5 bg-stone-100 text-stone-500 text-sm font-bold rounded-xl hover:bg-stone-200 transition-colors">取消</button>
                  <button type="submit" className="flex-1 py-2.5 bg-stone-800 text-white text-sm font-bold rounded-xl hover:bg-stone-900 transition-colors flex justify-center items-center gap-1.5"><Save size={16}/> 儲存排程</button>
                </div>
              </form>
            </Card>
          </div>

          <div className="lg:col-span-5 flex flex-col">
             <h3 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 pl-1"><PlayCircle size={14}/> Telegram 實機預覽</h3>
             <div className="bg-[#E4EFE9] flex-1 rounded-3xl p-4 sm:p-5 shadow-inner border-4 border-stone-200/50 flex flex-col justify-start max-h-[600px] overflow-y-auto">
                <div className="bg-white p-4 rounded-2xl rounded-tl-sm shadow-sm max-w-[92%] whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-stone-800 break-words relative">
                  <div className="absolute -left-1.5 top-0 w-3 h-3 bg-white transform rotate-45 origin-top-right"></div>
                  <div className="relative z-10">{generatePreview(currentRule.template, currentRule.source)}</div>
                  <span className="block text-right text-[10px] text-stone-400 mt-1">{currentRule.time}</span>
                </div>
             </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {isLoading ? (
            <div className="col-span-full py-16 text-center text-stone-400 font-bold flex flex-col items-center gap-2"><Activity className="animate-spin text-stone-300" size={24} /> 載入中...</div>
          ) : rules.length === 0 ? (
            <div className="col-span-full py-16 bg-white rounded-3xl border border-dashed border-stone-200 text-center flex flex-col items-center">
              <div className="bg-stone-50 p-3 rounded-xl mb-3"><Bell size={24} className="text-stone-300"/></div>
              <h3 className="text-stone-600 font-bold text-base mb-1">目前沒有任何推播排程</h3>
              <p className="text-stone-400 text-[13px]">點擊右上方「新增排程」建立</p>
            </div>
          ) : (
            rules.map(rule => (
              <div key={rule.id} className={`bg-white rounded-2xl p-5 border transition-all flex flex-col h-full ${rule.isActive ? 'border-stone-200 shadow-sm hover:shadow-md' : 'border-stone-100 opacity-60'}`}>
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${rule.isActive ? 'bg-amber-50 text-amber-600' : 'bg-stone-100 text-stone-400'}`}>
                      <Clock size={16} strokeWidth={2.5} />
                    </div>
                    <span className={`text-xl font-mono font-black tracking-tight ${rule.isActive ? 'text-stone-800' : 'text-stone-400'}`}>{rule.time}</span>
                  </div>
                  <button onClick={() => toggleActive(rule)} className={`p-1 transition-transform active:scale-95 ${rule.isActive ? 'text-emerald-500' : 'text-stone-300'}`}>
                    {rule.isActive ? <ToggleRight size={28} strokeWidth={2.5} /> : <ToggleLeft size={28} strokeWidth={2.5} />}
                  </button>
                </div>

                <div className="space-y-2 flex-1">
                  <h3 className={`font-bold text-[15px] truncate ${rule.isActive ? 'text-stone-800' : 'text-stone-500'}`} title={rule.name}>{rule.name}</h3>
                  <div className="flex flex-col gap-1.5 mt-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-stone-500">
                      <Database size={12} className="text-stone-400 shrink-0"/>
                      <span className="truncate">{DATA_SOURCES[rule.source]?.label || rule.source}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-stone-500">
                      <Send size={12} className="text-stone-400 shrink-0"/>
                      {rule.targetGroup === 'manager' ? (
                        <span className="text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">主管戰情室</span>
                      ) : (
                        <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">營運大群組</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-4 mt-4 border-t border-stone-100">
                  <button onClick={() => { setCurrentRule(rule); setIsEditing(true); }} className="flex-1 py-2 bg-stone-50 hover:bg-stone-100 text-stone-600 text-[13px] font-bold rounded-lg flex justify-center items-center gap-1.5 transition-colors"><Edit3 size={14}/> 編輯</button>
                  <button onClick={() => handleDelete(rule.id)} className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-lg transition-colors"><Trash2 size={16}/></button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </ViewWrapper>
  );
};

export default NotificationManager;