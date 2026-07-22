// src/components/TelegramAlertControlCenter.jsx
import React, { useContext, useEffect, useState } from "react";
import {
  Activity,
  Calendar,
  Clock,
  Eye,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Save,
} from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { AppContext } from "../AppContext";

// Telegram 主動預警沿用 CYJ legacy data root。
// Functions 端必須使用完全相同的 app id 與路徑，避免前端儲存後排程仍讀到 brands/cyj 的舊設定。
const TELEGRAM_ALERT_APP_ID = "default-app-id";
const TELEGRAM_ALERT_DATA_PATH = [
  "artifacts",
  TELEGRAM_ALERT_APP_ID,
  "public",
  "data",
];

const TELEGRAM_ALERT_WEEKDAYS = [
  { id: 1, label: "一" },
  { id: 2, label: "二" },
  { id: 3, label: "三" },
  { id: 4, label: "四" },
  { id: 5, label: "五" },
  { id: 6, label: "六" },
  { id: 0, label: "日" },
];

const TELEGRAM_ALERT_STATUS_LABELS = {
  sent: "已正常發送",
  clear_not_sent: "無異常，依設定未發送",
  error: "執行失敗",
  disabled: "目前停用",
};

const createDefaultTelegramAlertForm = () => ({
  enabled: false,
  sendTime: "09:35",
  weekdays: [1, 2, 3, 4, 5],
  brandIds: ["cyj", "anniu", "yibo"],
  chatTargets: ["main", "manager"],
  limit: 8,
  sendWhenClear: false,
  pausedUntil: "",
  timezone: "Asia/Taipei",
  thresholds: {
    watchProgressGap: 10,
    criticalProgressGap: 20,
    closingRate: 35,
    skincareRatio: 5,
    minNewCustomers: 5,
    missingReportEnabled: true,
    missingTargetEnabled: true,
  },
});

const normalizeTelegramAlertForm = (raw = {}) => {
  const defaults = createDefaultTelegramAlertForm();
  const numberOr = (value, fallback) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;

  const weekdays = Array.isArray(raw.weekdays)
    ? [...new Set(raw.weekdays.map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))]
    : defaults.weekdays;
  const brandIds = Array.isArray(raw.brandIds)
    ? [...new Set(raw.brandIds.map(String).filter((value) => ["cyj", "anniu", "yibo"].includes(value)))]
    : defaults.brandIds;
  const chatTargets = Array.isArray(raw.chatTargets)
    ? [...new Set(raw.chatTargets.map(String).filter((value) => ["main", "manager"].includes(value)))]
    : defaults.chatTargets;
  const watchProgressGap = Math.max(
    0,
    Math.min(100, numberOr(raw.thresholds?.watchProgressGap, defaults.thresholds.watchProgressGap))
  );
  const criticalProgressGap = Math.max(
    watchProgressGap,
    Math.min(100, numberOr(raw.thresholds?.criticalProgressGap, defaults.thresholds.criticalProgressGap))
  );

  return {
    ...defaults,
    ...raw,
    enabled: raw.enabled === true,
    sendTime: /^\d{2}:\d{2}$/.test(String(raw.sendTime || ""))
      ? String(raw.sendTime)
      : defaults.sendTime,
    weekdays: weekdays.length ? weekdays : defaults.weekdays,
    brandIds: brandIds.length ? brandIds : defaults.brandIds,
    chatTargets: chatTargets.length ? chatTargets : defaults.chatTargets,
    limit: Math.max(1, Math.min(20, Math.round(numberOr(raw.limit, defaults.limit)))),
    sendWhenClear: raw.sendWhenClear === true,
    pausedUntil: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.pausedUntil || ""))
      ? String(raw.pausedUntil)
      : "",
    timezone: "Asia/Taipei",
    thresholds: {
      ...defaults.thresholds,
      ...(raw.thresholds || {}),
      watchProgressGap,
      criticalProgressGap,
      closingRate: Math.max(
        0,
        Math.min(100, numberOr(raw.thresholds?.closingRate, defaults.thresholds.closingRate))
      ),
      skincareRatio: Math.max(
        0,
        Math.min(100, numberOr(raw.thresholds?.skincareRatio, defaults.thresholds.skincareRatio))
      ),
      minNewCustomers: Math.max(
        0,
        Math.min(999, Math.round(numberOr(raw.thresholds?.minNewCustomers, defaults.thresholds.minNewCustomers)))
      ),
      missingReportEnabled: raw.thresholds?.missingReportEnabled !== false,
      missingTargetEnabled: raw.thresholds?.missingTargetEnabled !== false,
    },
  };
};

const ActionButton = ({
  children,
  onClick,
  disabled = false,
  variant = "primary",
  className = "",
}) => {
  const variants = {
    primary: "bg-stone-800 text-white hover:bg-stone-900 border-stone-800",
    soft: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-100",
    secondary: "bg-white text-stone-600 hover:bg-stone-50 border-stone-200",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-black transition-all disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant] || variants.primary} ${className}`}
    >
      {children}
    </button>
  );
};

const TelegramAlertControlCenter = () => {
  const { currentUser, userRole, showToast } = useContext(AppContext);
  const [form, setForm] = useState(createDefaultTelegramAlertForm);
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadingAction, setLoadingAction] = useState(null);
  const [lastMessage, setLastMessage] = useState("");

  const configRef = doc(
    db,
    ...TELEGRAM_ALERT_DATA_PATH,
    "global_settings",
    "telegram_active_alerts"
  );
  const statusRef = doc(
    db,
    ...TELEGRAM_ALERT_DATA_PATH,
    "global_settings",
    "telegram_active_alert_status"
  );
  const commandRef = collection(
    db,
    ...TELEGRAM_ALERT_DATA_PATH,
    "telegram_alert_commands"
  );

  const notify = (message, type = "info") => {
    setLastMessage(message);
    if (typeof showToast === "function") showToast(message, type);
  };

  const refreshStatus = async ({ silent = false } = {}) => {
    if (!silent) setLoadingAction("refreshStatus");
    try {
      const snap = await getDoc(statusRef);
      setStatus(snap.exists() ? snap.data() : null);
      if (!silent) notify("Telegram 執行狀態已更新", "success");
    } catch (error) {
      notify(error.message || "Telegram 執行狀態載入失敗", "error");
    } finally {
      if (!silent) setLoadingAction(null);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (userRole !== "director") {
        if (!cancelled) setIsLoaded(true);
        return;
      }

      try {
        const [configSnap, statusSnap] = await Promise.all([
          getDoc(configRef),
          getDoc(statusRef),
        ]);
        if (cancelled) return;
        setForm(normalizeTelegramAlertForm(configSnap.exists() ? configSnap.data() : {}));
        setStatus(statusSnap.exists() ? statusSnap.data() : null);
      } catch (error) {
        if (!cancelled) notify(error.message || "Telegram 戰情設定載入失敗", "error");
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // 固定 legacy path；角色變更時重新判斷權限。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole]);

  if (userRole !== "director") return null;

  const toggleArrayValue = (field, value) => {
    setForm((previous) => {
      const current = Array.isArray(previous[field]) ? previous[field] : [];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      return { ...previous, [field]: next };
    });
  };

  const updateThreshold = (field, value) => {
    setForm((previous) => ({
      ...previous,
      thresholds: {
        ...previous.thresholds,
        [field]: value,
      },
    }));
  };

  const validate = (normalized) => {
    if (!normalized.weekdays.length) throw new Error("請至少選擇一個推播星期");
    if (!normalized.brandIds.length) throw new Error("請至少選擇一個品牌");
    if (!normalized.chatTargets.length) throw new Error("請至少選擇一個接收群組");
    if (
      Number(normalized.thresholds.criticalProgressGap) <
      Number(normalized.thresholds.watchProgressGap)
    ) {
      throw new Error("重大預警落後幅度不可小於一般關注門檻");
    }
  };

  const saveConfig = async () => {
    const normalized = normalizeTelegramAlertForm(form);
    try {
      validate(normalized);
      setLoadingAction("saveConfig");
      await setDoc(
        configRef,
        {
          ...normalized,
          updatedAt: serverTimestamp(),
          updatedAtText: new Date().toISOString(),
          updatedBy: currentUser?.name || "director",
          updatedByRole: userRole || "director",
          configVersion: "v1.6-notification-manager",
        },
        { merge: true }
      );
      setForm(normalized);
      notify(
        `Telegram 戰情設定已儲存：${normalized.enabled ? "已啟用" : "已停用"}｜${normalized.sendTime}`,
        "success"
      );
    } catch (error) {
      notify(error.message || "Telegram 戰情設定儲存失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const waitForCommand = async (documentRef) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      const snap = await getDoc(documentRef);
      if (!snap.exists()) continue;
      const data = snap.data() || {};
      if (data.status === "completed") return data;
      if (data.status === "error") {
        throw new Error(data.errorMessage || "後端執行失敗");
      }
    }
    throw new Error("後端處理逾時，請稍後更新執行狀態");
  };

  const runCommand = async (action) => {
    const normalized = normalizeTelegramAlertForm(form);
    validate(normalized);
    const documentRef = await addDoc(commandRef, {
      type: "telegram_alert_command",
      action,
      status: "pending",
      config: normalized,
      operator: currentUser?.name || "director",
      operatorRole: userRole || "director",
      createdAt: serverTimestamp(),
      createdAtText: new Date().toISOString(),
    });
    return waitForCommand(documentRef);
  };

  const previewToday = async () => {
    try {
      setLoadingAction("preview");
      const result = await runCommand("preview");
      setPreview(result.previewText || "目前沒有可預覽內容");
      notify(
        `已產生預警預覽：異常 ${Number(result.alertCount || 0).toLocaleString()} 項，讀取約 ${Number(result.readCount || 0).toLocaleString()} 筆`,
        "success"
      );
      await refreshStatus({ silent: true });
    } catch (error) {
      notify(error.message || "預覽失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const sendTest = async () => {
    const targetLabels = form.chatTargets.map((value) =>
      value === "main" ? "高階主管主群" : "主管群"
    );
    if (
      !window.confirm(
        `確定要將測試預警發送到：${targetLabels.join("、")}？\n\n測試不會改變正式排程的已發送狀態。`
      )
    ) {
      return;
    }

    try {
      setLoadingAction("test");
      const result = await runCommand("test");
      setPreview(result.previewText || "");
      notify(
        `Telegram 測試推播完成：異常 ${Number(result.alertCount || 0).toLocaleString()} 項`,
        "success"
      );
      await refreshStatus({ silent: true });
    } catch (error) {
      notify(error.message || "測試推播失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const resetForm = () => {
    if (
      !window.confirm(
        "確定要將畫面恢復為建議預設值嗎？尚未儲存前不會影響目前正式設定。"
      )
    ) {
      return;
    }
    setForm(createDefaultTelegramAlertForm());
    setPreview("");
    setLastMessage("已恢復畫面建議值，尚未寫入正式設定");
  };

  const isBusy = loadingAction !== null;

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-3xl border border-stone-100 bg-white p-12 text-sm font-black text-stone-400">
        <Loader2 size={18} className="animate-spin" />
        載入 Telegram 戰情設定中...
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-sky-100 bg-gradient-to-br from-sky-50/80 via-white to-indigo-50/60 shadow-[0_22px_70px_rgba(40,110,160,0.08)]">
      <div className="flex flex-col gap-4 border-b border-sky-100/70 p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-sky-100 bg-white p-2.5 shadow-sm">
            <Radio size={20} className="text-sky-600" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-500">
              Telegram Agent Control
            </p>
            <h3 className="mt-1 text-lg font-black text-stone-800">Telegram 戰情設定中心</h3>
            <p className="mt-1 max-w-3xl text-xs font-bold leading-5 text-stone-400">
              調整主動預警開關、時間、星期、品牌、接收群組與判斷門檻；儲存後不需重新部署 Functions。
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1.5 text-[11px] font-black ${
              form.enabled
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : "border-stone-200 bg-stone-50 text-stone-500"
            }`}
          >
            {form.enabled ? "主動預警已開啟" : "主動預警已停用"}
          </span>
          <span className="rounded-full border border-sky-100 bg-white px-3 py-1.5 text-[11px] font-black text-sky-700">
            台北時間
          </span>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {lastMessage && (
          <div className="flex items-center gap-2 rounded-2xl border border-sky-100 bg-white/80 px-4 py-3 text-xs font-bold text-stone-600">
            <Activity size={14} className="shrink-0 text-sky-500" />
            {lastMessage}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="space-y-5 rounded-[1.5rem] border border-white bg-white/90 p-5 shadow-sm xl:col-span-2">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-black text-stone-800">排程與開關</p>
                <p className="mt-1 text-[11px] font-bold text-stone-400">
                  後端每 5 分鐘確認一次設定，只有到達指定時間才載入營運資料。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForm((previous) => ({ ...previous, enabled: !previous.enabled }))}
                className={`relative h-9 w-16 rounded-full transition-all ${
                  form.enabled
                    ? "bg-emerald-500 shadow-lg shadow-emerald-100"
                    : "bg-stone-200"
                }`}
                aria-label={form.enabled ? "停用主動預警" : "啟用主動預警"}
              >
                <span
                  className={`absolute top-1 h-7 w-7 rounded-full bg-white shadow transition-all ${
                    form.enabled ? "left-8" : "left-1"
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[11px] font-black text-stone-500">每日推播時間</span>
                <div className="flex h-12 items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4">
                  <Clock size={16} className="text-sky-500" />
                  <input
                    type="time"
                    step="300"
                    value={form.sendTime}
                    onChange={(event) => setForm((previous) => ({ ...previous, sendTime: event.target.value }))}
                    className="w-full bg-transparent text-sm font-black text-stone-700 outline-none"
                  />
                </div>
              </label>
              <label className="space-y-2">
                <span className="text-[11px] font-black text-stone-500">暫停推播至（含當日）</span>
                <div className="flex h-12 items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4">
                  <Calendar size={16} className="text-sky-500" />
                  <input
                    type="date"
                    value={form.pausedUntil || ""}
                    onChange={(event) => setForm((previous) => ({ ...previous, pausedUntil: event.target.value }))}
                    className="w-full bg-transparent text-sm font-black text-stone-700 outline-none"
                  />
                  {form.pausedUntil && (
                    <button
                      type="button"
                      onClick={() => setForm((previous) => ({ ...previous, pausedUntil: "" }))}
                      className="text-[10px] font-black text-stone-400 hover:text-rose-500"
                    >
                      清除
                    </button>
                  )}
                </div>
              </label>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-black text-stone-500">推播星期</p>
              <div className="flex flex-wrap gap-2">
                {TELEGRAM_ALERT_WEEKDAYS.map((day) => {
                  const active = form.weekdays.includes(day.id);
                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => toggleArrayValue("weekdays", day.id)}
                      className={`h-10 w-10 rounded-xl border text-xs font-black transition-all ${
                        active
                          ? "border-sky-500 bg-sky-500 text-white shadow-md shadow-sky-100"
                          : "border-stone-200 bg-white text-stone-400"
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-[11px] font-black text-stone-500">納入品牌</p>
                <div className="space-y-2">
                  {[
                    { id: "cyj", label: "CYJ" },
                    { id: "anniu", label: "安妞" },
                    { id: "yibo", label: "伊啵" },
                  ].map((brand) => {
                    const active = form.brandIds.includes(brand.id);
                    return (
                      <button
                        key={brand.id}
                        type="button"
                        onClick={() => toggleArrayValue("brandIds", brand.id)}
                        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-xs font-black transition-all ${
                          active
                            ? "border-sky-200 bg-sky-50 text-sky-700"
                            : "border-stone-200 bg-white text-stone-400"
                        }`}
                      >
                        <span>{brand.label}</span>
                        <span>{active ? "已納入" : "未納入"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-black text-stone-500">接收群組</p>
                <div className="space-y-2">
                  {[
                    { id: "main", label: "高階主管主群" },
                    { id: "manager", label: "主管群" },
                  ].map((target) => {
                    const active = form.chatTargets.includes(target.id);
                    return (
                      <button
                        key={target.id}
                        type="button"
                        onClick={() => toggleArrayValue("chatTargets", target.id)}
                        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-xs font-black transition-all ${
                          active
                            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                            : "border-stone-200 bg-white text-stone-400"
                        }`}
                      >
                        <span>{target.label}</span>
                        <span>{active ? "會收到" : "不發送"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-stone-100 bg-stone-50/70 p-4">
              <div>
                <p className="text-xs font-black text-stone-700">沒有異常時也發送正常通知</p>
                <p className="mt-1 text-[10px] font-bold text-stone-400">
                  關閉後，當日無異常就不打擾群組。
                </p>
              </div>
              <input
                type="checkbox"
                checked={form.sendWhenClear}
                onChange={(event) => setForm((previous) => ({ ...previous, sendWhenClear: event.target.checked }))}
                className="h-5 w-5 rounded border-stone-300 text-sky-500 focus:ring-sky-200"
              />
            </label>
          </div>

          <div className="space-y-4 rounded-[1.5rem] border border-white bg-white/90 p-5 shadow-sm">
            <div>
              <p className="text-sm font-black text-stone-800">最近執行狀態</p>
              <p className="mt-1 text-[11px] font-bold text-stone-400">
                顯示正式排程或手動測試的最新結果。
              </p>
            </div>
            <div className="space-y-3 text-xs">
              <div className="rounded-2xl bg-stone-50 p-3">
                <p className="text-[10px] font-black text-stone-400">正式排程狀態</p>
                <p className="mt-1 font-black text-stone-700">
                  {TELEGRAM_ALERT_STATUS_LABELS[status?.status] || status?.status || "尚未執行"}
                </p>
              </div>
              <div className="rounded-2xl bg-stone-50 p-3">
                <p className="text-[10px] font-black text-stone-400">最近正式發送</p>
                <p className="mt-1 font-black text-stone-700">
                  {status?.lastSentAtText
                    ? new Date(status.lastSentAtText).toLocaleString("zh-TW", { hour12: false })
                    : "尚無紀錄"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-rose-50 p-3">
                  <p className="text-[10px] font-black text-rose-400">異常項目</p>
                  <p className="mt-1 text-lg font-black text-rose-600">
                    {Number(status?.alertCount || status?.lastManualAlertCount || 0).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-2xl bg-sky-50 p-3">
                  <p className="text-[10px] font-black text-sky-400">文件讀取</p>
                  <p className="mt-1 text-lg font-black text-sky-600">
                    {Number(status?.readCount || status?.lastManualReadCount || 0).toLocaleString()}
                  </p>
                </div>
              </div>
              {status?.lastError && (
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-3 text-[11px] font-bold text-rose-600">
                  {status.lastError}
                </div>
              )}
            </div>
            <ActionButton
              onClick={() => refreshStatus()}
              disabled={isBusy}
              variant="secondary"
              className="w-full"
            >
              {loadingAction === "refreshStatus" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              更新狀態
            </ActionButton>
          </div>
        </div>

        <div className="space-y-4 rounded-[1.5rem] border border-white bg-white/90 p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-black text-stone-800">預警判斷門檻</p>
              <p className="mt-1 text-[11px] font-bold text-stone-400">
                由後端固定規則判斷，不交由 Gemini 自由猜測。
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-black text-stone-600">
              最多顯示
              <input
                type="number"
                min="1"
                max="20"
                value={form.limit}
                onChange={(event) => setForm((previous) => ({ ...previous, limit: event.target.value }))}
                className="w-16 rounded-xl border border-stone-200 bg-stone-50 px-2 py-2 text-center outline-none"
              />
              項
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              { key: "watchProgressGap", label: "一般關注落後", unit: "百分點", max: 100 },
              { key: "criticalProgressGap", label: "重大預警落後", unit: "百分點", max: 100 },
              { key: "closingRate", label: "新客締結率低於", unit: "%", max: 100 },
              { key: "skincareRatio", label: "保養品占比低於", unit: "%", max: 100 },
              { key: "minNewCustomers", label: "締結率最少新客數", unit: "人", max: 999 },
            ].map((item) => (
              <label key={item.key} className="rounded-2xl border border-stone-100 bg-stone-50/70 p-3">
                <span className="mb-2 block text-[10px] font-black text-stone-500">{item.label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max={item.max}
                    value={form.thresholds[item.key]}
                    onChange={(event) => updateThreshold(item.key, event.target.value)}
                    className="w-full bg-transparent text-lg font-black text-stone-700 outline-none"
                  />
                  <span className="text-[10px] font-black text-stone-400">{item.unit}</span>
                </div>
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-stone-100 bg-stone-50/70 p-4">
              <span className="text-xs font-black text-stone-700">日報缺漏列為重大預警</span>
              <input
                type="checkbox"
                checked={form.thresholds.missingReportEnabled}
                onChange={(event) => updateThreshold("missingReportEnabled", event.target.checked)}
                className="h-5 w-5 rounded text-sky-500"
              />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-stone-100 bg-stone-50/70 p-4">
              <span className="text-xs font-black text-stone-700">現金目標缺漏列為關注</span>
              <input
                type="checkbox"
                checked={form.thresholds.missingTargetEnabled}
                onChange={(event) => updateThreshold("missingTargetEnabled", event.target.checked)}
                className="h-5 w-5 rounded text-sky-500"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-sky-100 pt-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={resetForm} disabled={isBusy} variant="secondary">
              <RefreshCw size={14} />
              恢復建議值
            </ActionButton>
            <ActionButton onClick={previewToday} disabled={isBusy} variant="secondary">
              {loadingAction === "preview" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Eye size={14} />
              )}
              預覽今日內容
            </ActionButton>
            <ActionButton onClick={sendTest} disabled={isBusy} variant="soft">
              {loadingAction === "test" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              發送測試
            </ActionButton>
          </div>
          <ActionButton onClick={saveConfig} disabled={isBusy} className="lg:min-w-[180px]">
            {loadingAction === "saveConfig" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            儲存正式設定
          </ActionButton>
        </div>

        {preview && (
          <div className="rounded-[1.5rem] border border-sky-100 bg-[#F8FCFF] p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-black text-stone-800">Telegram 預覽內容</p>
              <button
                type="button"
                onClick={() => setPreview("")}
                className="text-[10px] font-black text-stone-400 hover:text-rose-500"
              >
                關閉預覽
              </button>
            </div>
            <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs font-bold leading-6 text-stone-600">
              {preview}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
};

export default TelegramAlertControlCenter;
