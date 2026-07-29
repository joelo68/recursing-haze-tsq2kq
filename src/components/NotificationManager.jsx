// src/components/NotificationManager.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BellRing,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  Edit3,
  FileClock,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { ViewWrapper } from "./SharedUI";
import TelegramAlertControlCenter from "./TelegramAlertControlCenter";

const WEEKDAYS = [
  { id: 1, label: "一" },
  { id: 2, label: "二" },
  { id: 3, label: "三" },
  { id: 4, label: "四" },
  { id: 5, label: "五" },
  { id: 6, label: "六" },
  { id: 0, label: "日" },
];

const BRAND_OPTIONS = [
  { id: "cyj", label: "DRCYJ" },
  { id: "anniu", label: "安妞" },
  { id: "yibo", label: "伊啵" },
];

const REPORT_TYPES = {
  weekday_morning_brief: {
    label: "三品牌工作日晨報",
    description: "一次收到三品牌現金、權責、達成率、進度差與昨日最佳／最差店家。",
    icon: Sparkles,
    defaultName: "三品牌工作日晨報",
    defaultTime: "10:00",
    defaultWeekdays: [1, 2, 3, 4, 5],
    defaultTarget: "manager",
    cutoffMode: "yesterday",
    vars: [],
    defaultTemplate: "",
  },
  progress: {
    label: "品牌營運進度",
    description: "固定回報所選品牌的現金、權責與目標達成率。",
    icon: Building2,
    defaultName: "品牌營運進度",
    defaultTime: "10:00",
    defaultWeekdays: [1, 2, 3, 4, 5],
    defaultTarget: "manager",
    cutoffMode: "current",
    vars: ["{cashTotal}", "{accrualTotal}", "{cashRate}", "{accrualRate}"],
    defaultTemplate: "📊 *【營運進度】*\n現金業績：{cashTotal}（達成率 {cashRate}%）\n權責業績：{accrualTotal}（達成率 {accrualRate}%）",
  },
  top5_stores: {
    label: "昨日店家排行榜",
    description: "依昨日現金業績列出表現最好的店家。",
    icon: Bell,
    defaultName: "昨日店家排行榜",
    defaultTime: "10:00",
    defaultWeekdays: [1, 2, 3, 4, 5],
    defaultTarget: "main",
    cutoffMode: "yesterday",
    vars: ["{top5Stores}", "{date}"],
    defaultTemplate: "🏆 *【昨日店家排行榜】*\n{date}\n\n{top5Stores}",
  },
  bottom5_stores: {
    label: "進度落後店家",
    description: "依本月現金達成率列出目前最需要關注的店家。",
    icon: BellRing,
    defaultName: "進度落後店家",
    defaultTime: "10:00",
    defaultWeekdays: [1, 2, 3, 4, 5],
    defaultTarget: "manager",
    cutoffMode: "yesterday",
    vars: ["{bottom5Stores}", "{date}"],
    defaultTemplate: "⚠️ *【營運關注名單】*\n{date}\n\n{bottom5Stores}",
  },
  top5_therapists: {
    label: "昨日管理師排行榜",
    description: "依昨日個人業績列出表現最好的管理師。",
    icon: CheckCircle2,
    defaultName: "昨日管理師排行榜",
    defaultTime: "10:00",
    defaultWeekdays: [1, 2, 3, 4, 5],
    defaultTarget: "main",
    cutoffMode: "yesterday",
    vars: ["{top5Therapists}", "{date}"],
    defaultTemplate: "🌟 *【昨日管理師排行榜】*\n{date}\n\n{top5Therapists}",
  },
  unreported: {
    label: "未繳日報提醒",
    description: "提醒主管追蹤昨天尚未完成日報的正式店家。",
    icon: FileClock,
    defaultName: "未繳日報提醒",
    defaultTime: "11:30",
    defaultWeekdays: [1, 2, 3, 4, 5],
    defaultTarget: "manager",
    cutoffMode: "yesterday",
    vars: ["{missingStores}", "{missingCount}", "{date}"],
    defaultTemplate: "🚨 *【日報尚未完成】*\n截至目前，共有 {missingCount} 間門市尚未送出 {date} 的日報：\n\n{missingStores}",
  },
};

const MAIN_TABS = [
  { id: "overview", label: "總覽", description: "今天是否正常、有什麼需要處理", icon: LayoutDashboard },
  { id: "reports", label: "定時報表", description: "固定時間收到營運資料", icon: CalendarClock },
  { id: "alerts", label: "主動提醒", description: "店家表現異常時通知主管", icon: BellRing },
  { id: "tasks", label: "改善追蹤", description: "追蹤問題由誰處理及是否改善", icon: ListChecks },
  { id: "governance", label: "規則與權限", description: "管理例外、長期規則與人員權限", icon: ShieldCheck },
];

const createDefaultRule = (source = "weekday_morning_brief") => {
  const definition = REPORT_TYPES[source] || REPORT_TYPES.progress;
  return {
    id: "",
    name: definition.defaultName,
    source,
    reportType: source,
    time: definition.defaultTime,
    weekdays: [...definition.defaultWeekdays],
    targetGroup: definition.defaultTarget,
    brandIds: source === "weekday_morning_brief" ? ["cyj", "anniu", "yibo"] : ["cyj", "anniu", "yibo"],
    template: definition.defaultTemplate,
    isActive: true,
    pausedUntil: "",
    cutoffMode: definition.cutoffMode,
    topCount: 3,
    bottomCount: 3,
    includeMissingReports: true,
  };
};

const normalizeRule = (rule = {}) => {
  const source = REPORT_TYPES[rule.source] ? rule.source : "progress";
  const defaults = createDefaultRule(source);
  return {
    ...defaults,
    ...rule,
    id: rule.id || "",
    source,
    reportType: rule.reportType || source,
    weekdays: Array.isArray(rule.weekdays) && rule.weekdays.length ? rule.weekdays.map(Number) : defaults.weekdays,
    brandIds: Array.isArray(rule.brandIds) && rule.brandIds.length ? rule.brandIds : defaults.brandIds,
    isActive: rule.isActive === true || String(rule.isActive || "").toLowerCase() === "true",
    topCount: Number(rule.topCount || defaults.topCount),
    bottomCount: Number(rule.bottomCount || defaults.bottomCount),
    includeMissingReports: rule.includeMissingReports !== false,
  };
};

const formatScheduleDays = (rule) => {
  const days = Array.isArray(rule.weekdays) ? rule.weekdays.map(Number) : [];
  if (days.length === 7) return "每天";
  if ([1, 2, 3, 4, 5].every((day) => days.includes(day)) && days.length === 5) return "週一至週五";
  return days.length ? `週${days.map((day) => WEEKDAYS.find((item) => item.id === day)?.label).filter(Boolean).join("、")}` : "未設定星期";
};

const NotificationManager = () => {
  const [activeTab, setActiveTab] = useState("overview");
  const [reportTab, setReportTab] = useState("mine");
  const [rules, setRules] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [currentRule, setCurrentRule] = useState(createDefaultRule());
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const fetchRules = async () => {
    setIsLoading(true);
    try {
      const snapshot = await getDocs(collection(db, "notification_rules"));
      const nextRules = snapshot.docs
        .map((item) => normalizeRule({ id: item.id, ...item.data() }))
        .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
      setRules(nextRules);
    } catch (error) {
      console.error("載入定時報表失敗:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const activeRuleCount = useMemo(
    () => rules.filter((rule) => rule.isActive).length,
    [rules]
  );

  const chooseReportType = (source) => {
    setCurrentRule(createDefaultRule(source));
    setAdvancedOpen(false);
  };

  const editRule = (rule) => {
    setCurrentRule(normalizeRule(rule));
    setAdvancedOpen(false);
    setReportTab("create");
  };

  const saveRule = async (event) => {
    event.preventDefault();
    const sourceDefinition = REPORT_TYPES[currentRule.source];
    if (!sourceDefinition) return;
    if (!currentRule.name.trim()) return window.alert("請輸入報表名稱");
    if (!currentRule.weekdays.length) return window.alert("請至少選擇一個發送日");
    if (!currentRule.brandIds.length) return window.alert("請至少選擇一個品牌");

    const { id: ruleId, ...ruleValues } = currentRule;
    const payload = {
      ...ruleValues,
      name: currentRule.name.trim(),
      reportType: currentRule.source,
      weekdays: [...new Set(currentRule.weekdays.map(Number))],
      brandIds: currentRule.source === "weekday_morning_brief"
        ? ["cyj", "anniu", "yibo"]
        : [...new Set(currentRule.brandIds)],
      topCount: Math.max(1, Math.min(10, Number(currentRule.topCount) || 3)),
      bottomCount: Math.max(1, Math.min(10, Number(currentRule.bottomCount) || 3)),
      isActive: currentRule.isActive !== false,
      updatedAt: serverTimestamp(),
      updatedAtText: new Date().toISOString(),
    };

    setIsSaving(true);
    try {
      if (ruleId) {
        await setDoc(doc(db, "notification_rules", ruleId), payload, { merge: true });
      } else {
        await addDoc(collection(db, "notification_rules"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdAtText: new Date().toISOString(),
        });
      }
      await fetchRules();
      setCurrentRule(createDefaultRule());
      setReportTab("mine");
    } catch (error) {
      window.alert(`儲存失敗：${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (rule) => {
    try {
      await updateDoc(doc(db, "notification_rules", rule.id), {
        isActive: !rule.isActive,
        updatedAt: serverTimestamp(),
        updatedAtText: new Date().toISOString(),
      });
      await fetchRules();
    } catch (error) {
      window.alert(`狀態更新失敗：${error.message}`);
    }
  };

  const deleteRule = async (rule) => {
    if (!window.confirm(`確定刪除「${rule.name}」嗎？`)) return;
    try {
      await deleteDoc(doc(db, "notification_rules", rule.id));
      await fetchRules();
    } catch (error) {
      window.alert(`刪除失敗：${error.message}`);
    }
  };

  const toggleWeekday = (day) => {
    setCurrentRule((previous) => ({
      ...previous,
      weekdays: previous.weekdays.includes(day)
        ? previous.weekdays.filter((item) => item !== day)
        : [...previous.weekdays, day],
    }));
  };

  const toggleBrand = (brandId) => {
    setCurrentRule((previous) => ({
      ...previous,
      brandIds: previous.brandIds.includes(brandId)
        ? previous.brandIds.filter((item) => item !== brandId)
        : [...previous.brandIds, brandId],
    }));
  };

  const renderReportManager = () => {
    const reportDefinition = REPORT_TYPES[currentRule.source] || REPORT_TYPES.progress;
    return (
      <section className="rounded-[2rem] border border-stone-100 bg-white shadow-sm">
        <div className="border-b border-stone-100 p-5 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-black text-stone-800">定時報表</h3>
              <p className="mt-1 text-xs font-bold text-stone-400">設定機器人在什麼時間，固定傳送哪些營運資料。</p>
            </div>
            <div className="flex flex-wrap gap-2 rounded-2xl bg-stone-50 p-1.5">
              {[
                { id: "mine", label: "我的報表" },
                { id: "create", label: currentRule.id ? "編輯報表" : "新增報表" },
                { id: "history", label: "報表紀錄" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (tab.id === "create" && reportTab !== "create") setCurrentRule(createDefaultRule());
                    setReportTab(tab.id);
                  }}
                  className={`rounded-xl px-4 py-2 text-xs font-black transition ${reportTab === tab.id ? "bg-white text-sky-700 shadow-sm" : "text-stone-400 hover:text-stone-600"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {reportTab === "mine" && (
          <div className="p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-stone-700">已建立 {rules.length} 份報表</p>
                <p className="mt-1 text-[11px] font-bold text-stone-400">其中 {activeRuleCount} 份目前正在使用。</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCurrentRule(createDefaultRule());
                  setReportTab("create");
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-sky-700"
              >
                <Plus size={15} /> 新增報表
              </button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm font-black text-stone-400"><Loader2 size={18} className="animate-spin" />載入報表中...</div>
            ) : rules.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50/50 py-16 text-center">
                <CalendarClock className="mx-auto text-stone-300" size={30} />
                <p className="mt-3 text-sm font-black text-stone-600">目前沒有定時報表</p>
                <p className="mt-1 text-xs font-bold text-stone-400">建立第一份晨報後，機器人會依設定時間自動傳送。</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {rules.map((rule) => {
                  const definition = REPORT_TYPES[rule.source] || REPORT_TYPES.progress;
                  const Icon = definition.icon;
                  return (
                    <article key={rule.id} className={`rounded-2xl border p-5 transition ${rule.isActive ? "border-sky-100 bg-sky-50/30" : "border-stone-100 bg-stone-50 opacity-65"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className={`rounded-xl p-2.5 ${rule.isActive ? "bg-white text-sky-600 shadow-sm" : "bg-stone-100 text-stone-400"}`}><Icon size={17} /></div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-stone-800">{rule.name}</p>
                            <p className="mt-1 text-[11px] font-bold text-stone-500">{definition.label}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => toggleActive(rule)} className={rule.isActive ? "text-emerald-500" : "text-stone-300"} title={rule.isActive ? "暫停" : "啟用"}>
                          {rule.isActive ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                        </button>
                      </div>
                      <div className="mt-4 space-y-2 rounded-xl bg-white/80 p-3 text-[11px] font-bold text-stone-500">
                        <p><Clock size={12} className="mr-1.5 inline text-sky-500" />{formatScheduleDays(rule)}，{rule.time}</p>
                        <p><Send size={12} className="mr-1.5 inline text-indigo-500" />{rule.targetGroup === "main" ? "高階主管主群" : "主管群"}</p>
                        <p><Building2 size={12} className="mr-1.5 inline text-amber-500" />{rule.brandIds.map((id) => BRAND_OPTIONS.find((brand) => brand.id === id)?.label).filter(Boolean).join("、") || "全部品牌"}</p>
                      </div>
                      <div className="mt-4 flex gap-2 border-t border-stone-100 pt-4">
                        <button type="button" onClick={() => editRule(rule)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-black text-stone-600 shadow-sm"><Edit3 size={13} />編輯</button>
                        <button type="button" onClick={() => deleteRule(rule)} className="rounded-xl bg-rose-50 px-3 py-2 text-rose-500"><Trash2 size={15} /></button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {reportTab === "create" && (
          <form onSubmit={saveRule} className="p-5 sm:p-6">
            <div className="mx-auto max-w-5xl space-y-6">
              <section>
                <div className="mb-3">
                  <span className="rounded-full bg-sky-50 px-3 py-1 text-[10px] font-black text-sky-700">第 1 步</span>
                  <h4 className="mt-2 text-sm font-black text-stone-800">你想固定收到什麼？</h4>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {Object.entries(REPORT_TYPES).map(([source, definition]) => {
                    const Icon = definition.icon;
                    const active = currentRule.source === source;
                    return (
                      <button key={source} type="button" onClick={() => chooseReportType(source)} className={`rounded-2xl border p-4 text-left transition ${active ? "border-sky-300 bg-sky-50 shadow-sm" : "border-stone-100 bg-white hover:border-sky-100 hover:bg-sky-50/30"}`}>
                        <div className="flex items-center gap-2"><Icon size={16} className={active ? "text-sky-600" : "text-stone-400"} /><span className="text-xs font-black text-stone-700">{definition.label}</span></div>
                        <p className="mt-2 text-[10px] font-bold leading-4 text-stone-400">{definition.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-3xl border border-stone-100 bg-stone-50/50 p-5">
                <div className="mb-4">
                  <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black text-indigo-700">第 2 步</span>
                  <h4 className="mt-2 text-sm font-black text-stone-800">決定時間與接收對象</h4>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="rounded-2xl border border-stone-100 bg-white p-4">
                    <span className="mb-2 block text-[10px] font-black text-stone-400">報表名稱</span>
                    <input value={currentRule.name} onChange={(event) => setCurrentRule((previous) => ({ ...previous, name: event.target.value }))} className="w-full bg-transparent text-sm font-black text-stone-700 outline-none" />
                  </label>
                  <label className="rounded-2xl border border-stone-100 bg-white p-4">
                    <span className="mb-2 block text-[10px] font-black text-stone-400">發送時間</span>
                    <input type="time" value={currentRule.time} onChange={(event) => setCurrentRule((previous) => ({ ...previous, time: event.target.value }))} className="w-full bg-transparent text-sm font-black text-stone-700 outline-none" />
                  </label>
                  <label className="rounded-2xl border border-stone-100 bg-white p-4">
                    <span className="mb-2 block text-[10px] font-black text-stone-400">傳送到</span>
                    <select value={currentRule.targetGroup} onChange={(event) => setCurrentRule((previous) => ({ ...previous, targetGroup: event.target.value }))} className="w-full bg-transparent text-sm font-black text-stone-700 outline-none">
                      <option value="manager">主管群</option>
                      <option value="main">高階主管主群</option>
                    </select>
                  </label>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-stone-100 bg-white p-4">
                    <p className="mb-3 text-[10px] font-black text-stone-400">哪幾天發送？</p>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((day) => {
                        const active = currentRule.weekdays.includes(day.id);
                        return <button key={day.id} type="button" onClick={() => toggleWeekday(day.id)} className={`h-9 w-9 rounded-xl border text-[11px] font-black ${active ? "border-sky-500 bg-sky-500 text-white" : "border-stone-200 bg-white text-stone-400"}`}>{day.label}</button>;
                      })}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-stone-100 bg-white p-4">
                    <p className="mb-3 text-[10px] font-black text-stone-400">要看哪些品牌？</p>
                    {currentRule.source === "weekday_morning_brief" ? (
                      <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-3 text-[11px] font-black text-indigo-700">
                        三品牌工作日晨報固定包含 DRCYJ、安妞與伊啵。
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {BRAND_OPTIONS.map((brand) => {
                          const active = currentRule.brandIds.includes(brand.id);
                          return <button key={brand.id} type="button" onClick={() => toggleBrand(brand.id)} className={`rounded-xl border px-4 py-2 text-xs font-black ${active ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-stone-200 bg-white text-stone-400"}`}>{brand.label}</button>;
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {currentRule.source === "weekday_morning_brief" && (
                <section className="rounded-3xl border border-amber-100 bg-amber-50/40 p-5">
                  <div className="mb-4">
                    <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black text-amber-700">第 3 步</span>
                    <h4 className="mt-2 text-sm font-black text-stone-800">晨報要包含哪些排行？</h4>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <label className="rounded-2xl border border-amber-100 bg-white p-4"><span className="mb-2 block text-[10px] font-black text-stone-400">昨日最佳店家數</span><input type="number" min="1" max="10" value={currentRule.topCount} onChange={(event) => setCurrentRule((previous) => ({ ...previous, topCount: event.target.value }))} className="w-full bg-transparent text-sm font-black text-stone-700 outline-none" /></label>
                    <label className="rounded-2xl border border-amber-100 bg-white p-4"><span className="mb-2 block text-[10px] font-black text-stone-400">昨日最差店家數</span><input type="number" min="1" max="10" value={currentRule.bottomCount} onChange={(event) => setCurrentRule((previous) => ({ ...previous, bottomCount: event.target.value }))} className="w-full bg-transparent text-sm font-black text-stone-700 outline-none" /></label>
                    <label className="flex items-center justify-between rounded-2xl border border-amber-100 bg-white p-4"><span className="text-xs font-black text-stone-700">附上未繳日報名單</span><input type="checkbox" checked={currentRule.includeMissingReports} onChange={(event) => setCurrentRule((previous) => ({ ...previous, includeMissingReports: event.target.checked }))} className="h-5 w-5" /></label>
                  </div>
                </section>
              )}

              <section className="rounded-3xl border border-stone-100 bg-white">
                <button type="button" onClick={() => setAdvancedOpen((previous) => !previous)} className="flex w-full items-center justify-between px-5 py-4 text-left">
                  <div><p className="text-xs font-black text-stone-700">進階設定</p><p className="mt-1 text-[10px] font-bold text-stone-400">一般情況不需要調整；有特殊文案或資料截止需求時再展開。</p></div>
                  <ChevronDown size={16} className={`text-stone-400 transition ${advancedOpen ? "rotate-180" : ""}`} />
                </button>
                {advancedOpen && (
                  <div className="space-y-4 border-t border-stone-100 p-5">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <label className="rounded-2xl border border-stone-100 bg-stone-50 p-4"><span className="mb-2 block text-[10px] font-black text-stone-400">資料計算到</span><select value={currentRule.cutoffMode} onChange={(event) => setCurrentRule((previous) => ({ ...previous, cutoffMode: event.target.value }))} className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"><option value="yesterday">前一天結束</option><option value="current">發送當下</option></select></label>
                      <label className="block rounded-2xl border border-stone-100 bg-stone-50 p-4"><span className="mb-2 block text-[10px] font-black text-stone-400">暫停至（含當日）</span><div className="flex min-h-12 min-w-0 items-center rounded-xl border border-stone-200 bg-white px-3"><input type="date" value={currentRule.pausedUntil || ""} onChange={(event) => setCurrentRule((previous) => ({ ...previous, pausedUntil: event.target.value }))} className="block h-11 min-w-0 flex-1 bg-transparent px-1 text-sm font-black leading-none text-stone-700 outline-none" style={{ colorScheme: "light" }} /></div></label>
                    </div>
                    {reportDefinition.vars.length > 0 && (
                      <label className="block rounded-2xl border border-stone-100 bg-stone-50 p-4"><span className="mb-2 block text-[10px] font-black text-stone-400">自訂訊息內容</span><p className="mb-2 text-[10px] font-bold text-stone-400">可用欄位：{reportDefinition.vars.join("、")}</p><textarea rows={5} value={currentRule.template} onChange={(event) => setCurrentRule((previous) => ({ ...previous, template: event.target.value }))} className="w-full resize-none bg-transparent text-xs font-bold leading-5 text-stone-700 outline-none" /></label>
                    )}
                  </div>
                )}
              </section>

              <div className="flex flex-col-reverse gap-3 border-t border-stone-100 pt-5 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => { setCurrentRule(createDefaultRule()); setReportTab("mine"); }} className="rounded-xl bg-stone-100 px-5 py-3 text-xs font-black text-stone-500">取消</button>
                <button type="submit" disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-6 py-3 text-xs font-black text-white shadow-sm disabled:opacity-60">{isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{currentRule.id ? "儲存修改" : "建立定時報表"}</button>
              </div>
            </div>
          </form>
        )}

        {reportTab === "history" && (
          <div className="p-5 sm:p-6"><TelegramAlertControlCenter view="reportHistory" /></div>
        )}
      </section>
    );
  };

  return (
    <ViewWrapper>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3"><Bell className="text-amber-600" size={22} /></div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-stone-800">Telegram 營運助手</h2>
            <p className="mt-1 max-w-3xl text-sm font-bold leading-6 text-stone-400">依照你現在想完成的事情分類，不需要先理解程式或系統架構。</p>
          </div>
        </div>
        <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-700">任務導向介面</span>
      </div>

      <nav className="mb-6 grid grid-cols-2 gap-2 rounded-3xl border border-stone-100 bg-white p-2 shadow-sm md:grid-cols-5">
        {MAIN_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`rounded-2xl px-3 py-3 text-left transition ${active ? "bg-sky-600 text-white shadow-md shadow-sky-100" : "text-stone-500 hover:bg-stone-50"}`}>
              <div className="flex items-center gap-2"><Icon size={16} /><span className="text-xs font-black">{tab.label}</span></div>
              <p className={`mt-1 hidden text-[9px] font-bold leading-4 xl:block ${active ? "text-sky-100" : "text-stone-400"}`}>{tab.description}</p>
            </button>
          );
        })}
      </nav>

      {activeTab === "reports"
        ? renderReportManager()
        : <TelegramAlertControlCenter view={activeTab} onNavigate={setActiveTab} />}
    </ViewWrapper>
  );
};

export default NotificationManager;
