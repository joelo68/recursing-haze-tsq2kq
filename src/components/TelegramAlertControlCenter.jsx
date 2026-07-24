// src/components/TelegramAlertControlCenter.jsx
import React, { useContext, useEffect, useState } from "react";
import {
  Activity,
  Calendar,
  Clock,
  Eye,
  Loader2,
  Play,
  Plus,
  Copy,
  Trash2,
  Radio,
  RefreshCw,
  Save,
  Brain,
  ShieldCheck,
  Settings2,
  UserPlus,
  XCircle,
} from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
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
  sent: "各品牌已正常發送",
  clear_not_sent: "各品牌無異常，依設定未發送",
  partial_error: "部分品牌發送失敗",
  error: "執行失敗",
  disabled: "目前停用",
};

const TELEGRAM_BRAND_STATUS_LABELS = {
  sent: "已發送",
  clear_not_sent: "無異常未發送",
  error: "發送失敗",
  previewed: "已預覽",
};

const TELEGRAM_ALERT_BRANDS = [
  { id: "cyj", label: "DRCYJ" },
  { id: "anniu", label: "安妞" },
  { id: "yibo", label: "伊啵" },
];

const TELEGRAM_ALERT_RULE_DEFINITIONS = [
  {
    id: "progressGap",
    label: "現金進度差距",
    category: "operational",
    description: "比較現金達成率與本月時間進度，可分一般關注與重大預警。",
  },
  {
    id: "cashAchievementRate",
    label: "現金業績達成率",
    category: "operational",
    description: "當現金業績達成率低於設定值時列入預警。",
  },
  {
    id: "closingRate",
    label: "新客締結率",
    category: "operational",
    description: "新客樣本達到最低人數後，締結率低於門檻才判斷。",
  },
  {
    id: "skincareRatio",
    label: "保養品占比",
    category: "operational",
    description: "保養品業績占現金業績比率低於門檻時列入預警。",
  },
  {
    id: "newCustomers",
    label: "本月新客數",
    category: "operational",
    description: "本月累計新客數低於設定人數時列入預警。",
  },
  {
    id: "traffic",
    label: "本月來客人次",
    category: "operational",
    description: "本月累計來客人次低於設定值時列入預警。",
  },
  {
    id: "missingReport",
    label: "店家日報缺漏",
    category: "data",
    description: "正式納管店家本月沒有日報時列入資料待補。",
  },
  {
    id: "missingTarget",
    label: "現金目標缺漏",
    category: "data",
    description: "正式納管店家沒有本月現金目標時列入資料待補。",
  },
];

const getTelegramAlertBrandLabel = (brandId) =>
  TELEGRAM_ALERT_BRANDS.find((item) => item.id === brandId)?.label || brandId;

const TELEGRAM_POLICY_SCOPES = [
  { id: "telegram_analysis", label: "Telegram 營運分析" },
  { id: "ranking", label: "排行" },
  { id: "brand_totals", label: "品牌總計" },
  { id: "active_alert", label: "主動巡察" },
  { id: "data_audit", label: "回報與資料檢核" },
];

const TELEGRAM_POLICY_RULES = [
  { id: "progressGap", label: "現金進度差距" },
  { id: "cashAchievementRate", label: "現金業績達成率" },
  { id: "closingRate", label: "新客締結率" },
  { id: "skincareRatio", label: "保養品占比" },
  { id: "newCustomers", label: "本月新客數" },
  { id: "traffic", label: "本月來客人次" },
  { id: "missingReport", label: "店家日報缺漏" },
  { id: "missingTarget", label: "現金目標缺漏" },
  { id: "limit", label: "每品牌顯示上限" },
];

const createDefaultPolicyEditor = () => ({
  type: "exclude_store",
  ownerScope: "brand",
  brandId: "cyj",
  storeName: "",
  scopes: ["telegram_analysis", "ranking", "brand_totals", "active_alert"],
  excludeFromBrandTotals: true,
  ruleId: "progressGap",
  enabledValue: true,
  threshold: 10,
  watchThreshold: 10,
  criticalThreshold: 20,
  minSample: 5,
  severity: "watch",
  limit: 8,
  preferenceKey: "generic",
  instruction: "",
  userId: "",
  effectiveUntil: "",
  priority: 100,
});

const createDefaultPermissionDraft = () => ({
  userId: "",
  displayName: "",
  role: "viewer",
  brandIds: [],
  enabled: true,
  allowPersonalPreferences: true,
});

const normalizePolicyStoreCore = (value = "") =>
  String(value || "")
    .trim()
    .replace(/^(DRCYJ|CYJ|安妞|伊啵)/i, "")
    .replace(/店$/, "")
    .trim();

const getPolicyConflictKey = (policy = {}) => {
  if (policy.type === "exclude_store") {
    return `exclude_store:${policy.brandId || "global"}:${normalizePolicyStoreCore(policy.storeCore || policy.storeName)}`;
  }
  if (policy.type === "alert_rule") {
    return `alert_rule:${policy.brandId || "global"}:${policy.ruleId || ""}`;
  }
  return `response_preference:${policy.userId || "global"}:${policy.preferenceKey || "generic"}`;
};

const isPolicyActiveNow = (policy = {}) => {
  if (policy.enabled === false || String(policy.status || "active") !== "active") return false;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  if (policy.effectiveFrom && today < policy.effectiveFrom) return false;
  if (policy.effectiveUntil && today > policy.effectiveUntil) return false;
  return true;
};


const createDefaultTelegramAlertRules = () => ({
  progressGap: { enabled: true, watchThreshold: 10, criticalThreshold: 20 },
  cashAchievementRate: { enabled: false, threshold: 50, severity: "watch" },
  closingRate: { enabled: true, threshold: 35, minSample: 5, severity: "watch" },
  skincareRatio: { enabled: true, threshold: 5, severity: "watch" },
  newCustomers: { enabled: false, threshold: 10, severity: "watch" },
  traffic: { enabled: false, threshold: 50, severity: "watch" },
  missingReport: { enabled: true, category: "data" },
  missingTarget: { enabled: true, category: "data" },
});

const createDefaultTelegramBrandProfile = () => ({
  limit: 8,
  rules: createDefaultTelegramAlertRules(),
});

const createDefaultTelegramAlertForm = () => ({
  enabled: false,
  sendTime: "09:35",
  weekdays: [1, 2, 3, 4, 5],
  brandIds: ["cyj", "anniu", "yibo"],
  chatTargets: ["main", "manager"],
  brandProfiles: {
    cyj: createDefaultTelegramBrandProfile(),
    anniu: createDefaultTelegramBrandProfile(),
    yibo: createDefaultTelegramBrandProfile(),
  },
  sendWhenClear: false,
  pausedUntil: "",
  timezone: "Asia/Taipei",
});

const normalizeTelegramAlertRules = (raw = {}, legacy = {}) => {
  const defaults = createDefaultTelegramAlertRules();
  const numberOr = (value, fallback) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, fallback, min, max) =>
    Math.min(max, Math.max(min, numberOr(value, fallback)));
  const hasStructuredRules = Object.values(raw || {}).some(
    (value) => value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "enabled")
  );
  const progressRaw = raw.progressGap && typeof raw.progressGap === "object" ? raw.progressGap : {};
  const closingRaw = raw.closingRate && typeof raw.closingRate === "object" ? raw.closingRate : {};
  const skincareRaw = raw.skincareRatio && typeof raw.skincareRatio === "object" ? raw.skincareRatio : {};
  const watchThreshold = clamp(
    progressRaw.watchThreshold ?? legacy.watchProgressGap,
    defaults.progressGap.watchThreshold,
    0,
    100
  );
  const criticalThreshold = Math.max(
    watchThreshold,
    clamp(
      progressRaw.criticalThreshold ?? legacy.criticalProgressGap,
      defaults.progressGap.criticalThreshold,
      0,
      100
    )
  );
  const normalizeSingleRule = (key, fallbackThreshold, max = 100) => {
    const source = raw[key] && typeof raw[key] === "object" ? raw[key] : {};
    return {
      enabled: source.enabled === true,
      threshold: clamp(source.threshold, fallbackThreshold, 0, max),
      severity: source.severity === "critical" ? "critical" : "watch",
    };
  };

  return {
    progressGap: {
      enabled: hasStructuredRules ? progressRaw.enabled === true : true,
      watchThreshold,
      criticalThreshold,
    },
    cashAchievementRate: normalizeSingleRule(
      "cashAchievementRate",
      defaults.cashAchievementRate.threshold
    ),
    closingRate: {
      enabled: hasStructuredRules ? closingRaw.enabled === true : true,
      threshold: clamp(
        closingRaw.threshold ?? legacy.closingRate,
        defaults.closingRate.threshold,
        0,
        100
      ),
      minSample: Math.round(
        clamp(
          closingRaw.minSample ?? legacy.minNewCustomers,
          defaults.closingRate.minSample,
          0,
          999
        )
      ),
      severity: closingRaw.severity === "critical" ? "critical" : "watch",
    },
    skincareRatio: {
      enabled: hasStructuredRules ? skincareRaw.enabled === true : true,
      threshold: clamp(
        skincareRaw.threshold ?? legacy.skincareRatio,
        defaults.skincareRatio.threshold,
        0,
        100
      ),
      severity: skincareRaw.severity === "critical" ? "critical" : "watch",
    },
    newCustomers: normalizeSingleRule("newCustomers", defaults.newCustomers.threshold, 999999),
    traffic: normalizeSingleRule("traffic", defaults.traffic.threshold, 999999),
    missingReport: {
      enabled: hasStructuredRules
        ? raw.missingReport?.enabled === true
        : legacy.missingReportEnabled !== false,
      category: "data",
    },
    missingTarget: {
      enabled: hasStructuredRules
        ? raw.missingTarget?.enabled === true
        : legacy.missingTargetEnabled !== false,
      category: "data",
    },
  };
};

const normalizeTelegramBrandProfile = (raw = {}, legacyLimit = 8, legacyThresholds = {}) => {
  const numberOr = (value, fallback) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  return {
    limit: Math.max(1, Math.min(20, Math.round(numberOr(raw.limit, legacyLimit)))),
    rules: normalizeTelegramAlertRules(
      raw.rules && typeof raw.rules === "object" ? raw.rules : {},
      legacyThresholds
    ),
  };
};

const normalizeTelegramAlertForm = (raw = {}) => {
  const defaults = createDefaultTelegramAlertForm();
  const weekdays = Array.isArray(raw.weekdays)
    ? [...new Set(raw.weekdays.map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))]
    : defaults.weekdays;
  const brandIds = Array.isArray(raw.brandIds)
    ? [...new Set(raw.brandIds.map(String).filter((value) => TELEGRAM_ALERT_BRANDS.some((item) => item.id === value)))]
    : defaults.brandIds;
  const chatTargets = Array.isArray(raw.chatTargets)
    ? [...new Set(raw.chatTargets.map(String).filter((value) => ["main", "manager"].includes(value)))]
    : defaults.chatTargets;
  const legacyLimit = Number.isFinite(Number(raw.limit)) ? Number(raw.limit) : 8;
  const legacyThresholds = raw.thresholds && typeof raw.thresholds === "object" ? raw.thresholds : {};
  const brandProfiles = Object.fromEntries(
    TELEGRAM_ALERT_BRANDS.map((brand) => [
      brand.id,
      normalizeTelegramBrandProfile(
        raw.brandProfiles?.[brand.id] || {},
        legacyLimit,
        legacyThresholds
      ),
    ])
  );

  return {
    enabled: raw.enabled === true,
    sendTime: /^\d{2}:\d{2}$/.test(String(raw.sendTime || ""))
      ? String(raw.sendTime)
      : defaults.sendTime,
    weekdays: weekdays.length ? weekdays : defaults.weekdays,
    brandIds: brandIds.length ? brandIds : defaults.brandIds,
    chatTargets: chatTargets.length ? chatTargets : defaults.chatTargets,
    brandProfiles,
    sendWhenClear: raw.sendWhenClear === true,
    pausedUntil: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.pausedUntil || ""))
      ? String(raw.pausedUntil)
      : "",
    timezone: "Asia/Taipei",
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
    primary: "bg-sky-600 text-white hover:bg-sky-700 border-sky-600",
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

const TelegramRuleNumberField = ({ label, value, onChange, unit, max = 100 }) => (
  <label className="rounded-xl border border-stone-100 bg-stone-50/80 p-3">
    <span className="mb-1.5 block text-[10px] font-black text-stone-500">{label}</span>
    <div className="flex items-center gap-2">
      <input
        type="number"
        min="0"
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-transparent text-base font-black text-stone-700 outline-none"
      />
      <span className="whitespace-nowrap text-[10px] font-black text-stone-400">{unit}</span>
    </div>
  </label>
);

const TelegramRuleSeverityField = ({ value, onChange }) => (
  <label className="rounded-xl border border-stone-100 bg-stone-50/80 p-3">
    <span className="mb-1.5 block text-[10px] font-black text-stone-500">警示等級</span>
    <select
      value={value === "critical" ? "critical" : "watch"}
      onChange={(event) => onChange(event.target.value)}
      className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"
    >
      <option value="watch">🟠 營運黃燈</option>
      <option value="critical">🔴 營運紅燈</option>
    </select>
  </label>
);

const TelegramRuleEditorCard = ({ definition, rule, onChange, onRemove }) => {
  const update = (field, value) => onChange({ ...rule, [field]: value });
  const isDataRule = definition.category === "data";

  return (
    <article className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black text-stone-800">{definition.label}</p>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${isDataRule ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"}`}>
              {isDataRule ? "資料待補" : "營運判斷"}
            </span>
          </div>
          <p className="mt-1 text-[10px] font-bold leading-4 text-stone-400">{definition.description}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-stone-100 bg-stone-50 px-2 py-1 text-[9px] font-black text-stone-400 transition hover:border-rose-100 hover:bg-rose-50 hover:text-rose-500"
        >
          <Trash2 size={11} />
          移除
        </button>
      </div>

      {!isDataRule && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {definition.id === "progressGap" && (
            <>
              <TelegramRuleNumberField
                label="一般關注落後"
                value={rule.watchThreshold}
                onChange={(value) => update("watchThreshold", value)}
                unit="百分點"
              />
              <TelegramRuleNumberField
                label="重大預警落後"
                value={rule.criticalThreshold}
                onChange={(value) => update("criticalThreshold", value)}
                unit="百分點"
              />
            </>
          )}
          {definition.id === "closingRate" && (
            <>
              <TelegramRuleNumberField
                label="締結率低於"
                value={rule.threshold}
                onChange={(value) => update("threshold", value)}
                unit="%"
              />
              <TelegramRuleNumberField
                label="最低新客樣本"
                value={rule.minSample}
                onChange={(value) => update("minSample", value)}
                unit="人"
                max={999}
              />
              <TelegramRuleSeverityField
                value={rule.severity}
                onChange={(value) => update("severity", value)}
              />
            </>
          )}
          {["cashAchievementRate", "skincareRatio", "newCustomers", "traffic"].includes(definition.id) && (
            <>
              <TelegramRuleNumberField
                label={
                  definition.id === "cashAchievementRate"
                    ? "達成率低於"
                    : definition.id === "skincareRatio"
                      ? "占比低於"
                      : definition.id === "newCustomers"
                        ? "新客少於"
                        : "來客少於"
                }
                value={rule.threshold}
                onChange={(value) => update("threshold", value)}
                unit={
                  ["cashAchievementRate", "skincareRatio"].includes(definition.id)
                    ? "%"
                    : definition.id === "traffic"
                      ? "人次"
                      : "人"
                }
                max={["newCustomers", "traffic"].includes(definition.id) ? 999999 : 100}
              />
              <TelegramRuleSeverityField
                value={rule.severity}
                onChange={(value) => update("severity", value)}
              />
            </>
          )}
        </div>
      )}
    </article>
  );
};

const TelegramAlertControlCenter = () => {
  const { currentUser, userRole, showToast } = useContext(AppContext);
  const [form, setForm] = useState(createDefaultTelegramAlertForm);
  const [status, setStatus] = useState(null);
  const [previewItems, setPreviewItems] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadingAction, setLoadingAction] = useState(null);
  const [lastMessage, setLastMessage] = useState("");
  const [activeBrandId, setActiveBrandId] = useState("cyj");
  const [rulePickerOpen, setRulePickerOpen] = useState(false);
  const [policies, setPolicies] = useState([]);
  const [policyEditor, setPolicyEditor] = useState(createDefaultPolicyEditor);
  const [policyPermissions, setPolicyPermissions] = useState({ users: {} });
  const [permissionDraft, setPermissionDraft] = useState(createDefaultPermissionDraft);
  const [policyPanelOpen, setPolicyPanelOpen] = useState(true);
  const canManagePolicyCenter = ["master", "director"].includes(String(userRole || ""));

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
  const policyCollectionRef = collection(
    db,
    ...TELEGRAM_ALERT_DATA_PATH,
    "telegram_agent_policies"
  );
  const policyAuditCollectionRef = collection(
    db,
    ...TELEGRAM_ALERT_DATA_PATH,
    "telegram_agent_policy_audits"
  );
  const policyPermissionsRef = doc(
    db,
    ...TELEGRAM_ALERT_DATA_PATH,
    "global_settings",
    "telegram_agent_policy_permissions"
  );

  const notify = (message, type = "info") => {
    setLastMessage(message);
    if (typeof showToast === "function") showToast(message, type);
  };

  const refreshPolicies = async ({ silent = false } = {}) => {
    if (!silent) setLoadingAction("refreshPolicies");
    try {
      const [policySnap, permissionSnap] = await Promise.all([
        getDocs(policyCollectionRef),
        getDoc(policyPermissionsRef),
      ]);
      setPolicies(policySnap.docs.map((item) => ({ id: item.id, ...item.data() })));
      setPolicyPermissions(permissionSnap.exists() ? permissionSnap.data() : { users: {} });
      if (!silent) notify("長期規則與權限已更新", "success");
    } catch (error) {
      notify(error.message || "長期規則載入失敗", "error");
    } finally {
      if (!silent) setLoadingAction(null);
    }
  };

  const writePolicyAudit = async (action, policy, details = {}) => {
    await addDoc(policyAuditCollectionRef, {
      action,
      policyId: policy?.id || "",
      policyCode: policy?.policyCode || "",
      conflictKey: policy?.conflictKey || getPolicyConflictKey(policy),
      policySnapshot: policy || {},
      actor: {
        source: "saas_control_center",
        name: currentUser?.name || "director",
        role: userRole || "director",
      },
      details,
      createdAt: serverTimestamp(),
      createdAtText: new Date().toISOString(),
    });
  };

  const buildPolicyPayload = () => {
    const editor = policyEditor;
    const nowText = new Date().toISOString();
    const base = {
      schemaVersion: 1,
      type: editor.type,
      ownerScope: editor.type === "response_preference" ? editor.ownerScope : "brand",
      brandId: editor.type === "response_preference" ? "" : editor.brandId,
      enabled: true,
      status: "active",
      priority: Math.max(0, Math.min(999, Number(editor.priority) || 100)),
      effectiveFrom: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }),
      effectiveUntil: editor.effectiveUntil || "",
      source: "saas_control_center",
      sourceText: "由 Telegram 戰情設定中心建立",
      createdByName: currentUser?.name || "director",
      createdByUserId: currentUser?.id || currentUser?.uid || "",
      createdAtText: nowText,
      updatedAtText: nowText,
    };

    if (editor.type === "exclude_store") {
      const storeCore = normalizePolicyStoreCore(editor.storeName);
      if (!storeCore) throw new Error("請輸入要排除的店家名稱");
      const scopes = Array.isArray(editor.scopes) ? editor.scopes : [];
      if (!scopes.length) throw new Error("請至少選擇一個排除範圍");
      return {
        ...base,
        storeCore,
        storeName: storeCore,
        scopes,
        excludeFromBrandTotals: scopes.includes("brand_totals"),
      };
    }

    if (editor.type === "alert_rule") {
      const value = {};
      if (editor.ruleId === "progressGap") {
        value.enabled = editor.enabledValue !== false;
        value.watchThreshold = Number(editor.watchThreshold) || 0;
        value.criticalThreshold = Math.max(value.watchThreshold, Number(editor.criticalThreshold) || 0);
      } else if (editor.ruleId === "limit") {
        value.limit = Math.max(1, Math.min(20, Math.round(Number(editor.limit) || 8)));
      } else if (["missingReport", "missingTarget"].includes(editor.ruleId)) {
        value.enabled = editor.enabledValue !== false;
      } else {
        value.enabled = editor.enabledValue !== false;
        value.threshold = Number(editor.threshold) || 0;
        value.severity = editor.severity === "critical" ? "critical" : "watch";
        if (editor.ruleId === "closingRate") {
          value.minSample = Math.max(0, Math.round(Number(editor.minSample) || 0));
        }
      }
      return { ...base, ruleId: editor.ruleId, value };
    }

    const instruction = String(editor.instruction || "").trim();
    if (!instruction) throw new Error("請輸入要記住的回答偏好");
    if (editor.ownerScope === "user" && !String(editor.userId || "").trim()) {
      throw new Error("個人偏好需要填寫 Telegram 使用者 ID");
    }
    return {
      ...base,
      ownerScope: editor.ownerScope === "user" ? "user" : "global",
      userId: editor.ownerScope === "user" ? String(editor.userId).trim() : "",
      preferenceKey: String(editor.preferenceKey || "generic").trim() || "generic",
      instruction: instruction.slice(0, 800),
    };
  };

  const savePolicy = async () => {
    if (!canManagePolicyCenter) {
      notify("只有 master／director 可以修改長期規則與權限", "error");
      return;
    }
    try {
      setLoadingAction("savePolicy");
      const payload = buildPolicyPayload();
      const conflictKey = getPolicyConflictKey(payload);
      const conflicts = policies.filter(
        (item) => item.id && isPolicyActiveNow(item) && getPolicyConflictKey(item) === conflictKey
      );
      const nowText = new Date().toISOString();
      await Promise.all(
        conflicts.map((item) =>
          setDoc(
            doc(policyCollectionRef, item.id),
            {
              enabled: false,
              status: "superseded",
              statusReason: "replaced_by_control_center",
              updatedAt: serverTimestamp(),
              updatedAtText: nowText,
            },
            { merge: true }
          )
        )
      );
      const documentRef = await addDoc(policyCollectionRef, {
        ...payload,
        conflictKey,
        conflictsResolved: conflicts.map((item) => item.id),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const policyCode = `POL-${payload.effectiveFrom.replace(/-/g, "")}-${documentRef.id.slice(0, 6).toUpperCase()}`;
      await setDoc(documentRef, { policyCode }, { merge: true });
      await writePolicyAudit("create", { id: documentRef.id, ...payload, conflictKey, policyCode }, {
        supersededPolicyIds: conflicts.map((item) => item.id),
      });
      setPolicyEditor(createDefaultPolicyEditor());
      await refreshPolicies({ silent: true });
      notify(`已建立長期規則 ${policyCode}`, "success");
    } catch (error) {
      notify(error.message || "建立長期規則失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const togglePolicyEnabled = async (policy) => {
    if (!canManagePolicyCenter) {
      notify("只有 master／director 可以修改長期規則與權限", "error");
      return;
    }
    try {
      setLoadingAction(`policy:${policy.id}`);
      const nextEnabled = !isPolicyActiveNow(policy);
      const next = {
        enabled: nextEnabled,
        status: nextEnabled ? "active" : "inactive",
        updatedAt: serverTimestamp(),
        updatedAtText: new Date().toISOString(),
        updatedByName: currentUser?.name || "director",
      };
      await setDoc(doc(policyCollectionRef, policy.id), next, { merge: true });
      await writePolicyAudit(nextEnabled ? "reactivate" : "deactivate", { ...policy, ...next });
      await refreshPolicies({ silent: true });
      notify(`${policy.policyCode || policy.id} 已${nextEnabled ? "啟用" : "停用"}`, "success");
    } catch (error) {
      notify(error.message || "規則狀態更新失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const cleanupPolicyConflicts = async () => {
    if (!canManagePolicyCenter) {
      notify("只有 master／director 可以修改長期規則與權限", "error");
      return;
    }
    try {
      setLoadingAction("cleanupPolicies");
      const active = policies.filter(isPolicyActiveNow);
      const groups = active.reduce((acc, policy) => {
        const key = getPolicyConflictKey(policy);
        if (!acc[key]) acc[key] = [];
        acc[key].push(policy);
        return acc;
      }, {});
      const expired = policies.filter((policy) => {
        if (!isPolicyActiveNow(policy) && policy.enabled === false) return false;
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
        return policy.effectiveUntil && policy.effectiveUntil < today;
      });
      const duplicates = Object.values(groups).flatMap((rows) => {
        if (rows.length <= 1) return [];
        const sorted = [...rows].sort((a, b) =>
          String(b.updatedAtText || b.createdAtText || "").localeCompare(String(a.updatedAtText || a.createdAtText || ""))
        );
        return sorted.slice(1);
      });
      const targets = [...new Map([...expired, ...duplicates].map((item) => [item.id, item])).values()];
      await Promise.all(
        targets.map((item) =>
          setDoc(
            doc(policyCollectionRef, item.id),
            {
              enabled: false,
              status: expired.some((row) => row.id === item.id) ? "expired" : "superseded",
              statusReason: "manual_cleanup",
              updatedAt: serverTimestamp(),
              updatedAtText: new Date().toISOString(),
            },
            { merge: true }
          )
        )
      );
      await refreshPolicies({ silent: true });
      notify(`規則整理完成，共處理 ${targets.length} 條`, "success");
    } catch (error) {
      notify(error.message || "規則整理失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const savePermission = async () => {
    if (!canManagePolicyCenter) {
      notify("只有 master／director 可以修改長期規則與權限", "error");
      return;
    }
    const userId = String(permissionDraft.userId || "").trim();
    if (!userId) {
      notify("請輸入 Telegram 使用者 ID", "error");
      return;
    }
    try {
      setLoadingAction("savePermission");
      const users = {
        ...(policyPermissions.users || {}),
        [userId]: {
          displayName: String(permissionDraft.displayName || "").trim(),
          role: permissionDraft.role,
          brandIds: permissionDraft.role === "director" ? TELEGRAM_ALERT_BRANDS.map((item) => item.id) : permissionDraft.brandIds,
          enabled: permissionDraft.enabled !== false,
          allowPersonalPreferences: permissionDraft.allowPersonalPreferences !== false,
          updatedAtText: new Date().toISOString(),
        },
      };
      await setDoc(
        policyPermissionsRef,
        {
          users,
          updatedAt: serverTimestamp(),
          updatedAtText: new Date().toISOString(),
          updatedBy: currentUser?.name || "director",
        },
        { merge: true }
      );
      setPolicyPermissions((previous) => ({ ...previous, users }));
      setPermissionDraft(createDefaultPermissionDraft());
      notify("Telegram 規則權限已儲存", "success");
    } catch (error) {
      notify(error.message || "權限儲存失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const removePermission = async (userId) => {
    if (!canManagePolicyCenter) {
      notify("只有 master／director 可以修改長期規則與權限", "error");
      return;
    }
    if (!window.confirm(`確定移除 Telegram 使用者 ${userId} 的規則管理權限嗎？`)) return;
    try {
      setLoadingAction(`permission:${userId}`);
      const users = { ...(policyPermissions.users || {}) };
      delete users[userId];
      await setDoc(
        policyPermissionsRef,
        {
          users,
          updatedAt: serverTimestamp(),
          updatedAtText: new Date().toISOString(),
          updatedBy: currentUser?.name || "director",
        },
        { merge: true }
      );
      setPolicyPermissions((previous) => ({ ...previous, users }));
      notify("權限已移除", "success");
    } catch (error) {
      notify(error.message || "權限移除失敗", "error");
    } finally {
      setLoadingAction(null);
    }
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
        const [configSnap, statusSnap, policySnap, permissionSnap] = await Promise.all([
          getDoc(configRef),
          getDoc(statusRef),
          getDocs(policyCollectionRef),
          getDoc(policyPermissionsRef),
        ]);
        if (cancelled) return;
        setForm(normalizeTelegramAlertForm(configSnap.exists() ? configSnap.data() : {}));
        setStatus(statusSnap.exists() ? statusSnap.data() : null);
        setPolicies(policySnap.docs.map((item) => ({ id: item.id, ...item.data() })));
        setPolicyPermissions(permissionSnap.exists() ? permissionSnap.data() : { users: {} });
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

  const updateBrandProfile = (brandId, updater) => {
    setForm((previous) => {
      const currentProfile = previous.brandProfiles?.[brandId] || createDefaultTelegramBrandProfile();
      const nextProfile = typeof updater === "function" ? updater(currentProfile) : updater;
      return {
        ...previous,
        brandProfiles: {
          ...previous.brandProfiles,
          [brandId]: nextProfile,
        },
      };
    });
  };

  const updateBrandRule = (brandId, ruleId, nextRule) => {
    updateBrandProfile(brandId, (profile) => ({
      ...profile,
      rules: {
        ...profile.rules,
        [ruleId]: typeof nextRule === "function" ? nextRule(profile.rules?.[ruleId] || {}) : nextRule,
      },
    }));
  };

  const enableRule = (ruleId) => {
    updateBrandRule(activeBrandId, ruleId, (current) => ({ ...current, enabled: true }));
    setRulePickerOpen(false);
  };

  const disableRule = (ruleId) => {
    updateBrandRule(activeBrandId, ruleId, (current) => ({ ...current, enabled: false }));
  };

  const copyActiveBrandProfile = (targetBrandId) => {
    const source = form.brandProfiles?.[activeBrandId] || createDefaultTelegramBrandProfile();
    const sourceLabel = getTelegramAlertBrandLabel(activeBrandId);
    const targetLabel = getTelegramAlertBrandLabel(targetBrandId);
    if (!window.confirm(`確定要用 ${sourceLabel} 的預警設定覆蓋 ${targetLabel} 嗎？`)) return;
    updateBrandProfile(targetBrandId, JSON.parse(JSON.stringify(source)));
    notify(`已將 ${sourceLabel} 設定複製到 ${targetLabel}，尚未儲存正式設定`, "success");
  };

  const validate = (normalized) => {
    if (!normalized.weekdays.length) throw new Error("請至少選擇一個推播星期");
    if (!normalized.brandIds.length) throw new Error("請至少選擇一個品牌");
    if (!normalized.chatTargets.length) throw new Error("請至少選擇一個接收群組");

    normalized.brandIds.forEach((brandId) => {
      const profile = normalized.brandProfiles?.[brandId] || createDefaultTelegramBrandProfile();
      const enabledRules = Object.values(profile.rules || {}).filter((rule) => rule?.enabled === true);
      if (!enabledRules.length) {
        throw new Error(`${getTelegramAlertBrandLabel(brandId)} 請至少啟用一個預警判斷項目`);
      }
      const progressRule = profile.rules?.progressGap;
      if (
        progressRule?.enabled &&
        Number(progressRule.criticalThreshold) < Number(progressRule.watchThreshold)
      ) {
        throw new Error(`${getTelegramAlertBrandLabel(brandId)} 的重大預警落後幅度不可小於一般關注門檻`);
      }
    });
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
          configVersion: "v3.0-brand-rule-profiles",
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

  const normalizePreviewItems = (result = {}) => {
    if (Array.isArray(result.brandPreviews) && result.brandPreviews.length > 0) {
      return result.brandPreviews;
    }
    if (result.previewText) {
      return [{
        brandId: "legacy",
        brand: "預覽",
        previewText: result.previewText,
        alertCount: Number(result.alertCount || 0),
        operationalAlertCount: Number(result.operationalAlertCount || result.alertCount || 0),
        dataIssueCount: Number(result.dataIssueCount || 0),
        readCount: Number(result.readCount || 0),
      }];
    }
    return [];
  };

  const previewToday = async () => {
    try {
      setLoadingAction("preview");
      const result = await runCommand("preview");
      const items = normalizePreviewItems(result);
      setPreviewItems(items);
      notify(
        `已產生 ${items.length} 個品牌預覽：營運異常 ${Number(result.operationalAlertCount || 0).toLocaleString()} 家、資料待補 ${Number(result.dataIssueCount || 0).toLocaleString()} 家`,
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
    const selectedBrands = [
      { id: "cyj", label: "DRCYJ" },
      { id: "anniu", label: "安妞" },
      { id: "yibo", label: "伊啵" },
    ].filter((item) => form.brandIds.includes(item.id));
    if (
      !window.confirm(
        `確定要將 ${selectedBrands.length} 則品牌測試預警發送到：${targetLabels.join("、")}？

每個品牌會獨立發送一則，測試不會改變正式排程的已發送狀態。`
      )
    ) {
      return;
    }

    try {
      setLoadingAction("test");
      const result = await runCommand("test");
      const items = normalizePreviewItems(result);
      setPreviewItems(items);
      notify(
        `Telegram 測試推播完成：已發送 ${items.length} 則品牌訊息`,
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
    setActiveBrandId("cyj");
    setRulePickerOpen(false);
    setPreviewItems([]);
    setLastMessage("已恢復畫面建議值，尚未寫入正式設定");
  };

  const isBusy = loadingAction !== null;
  const activePolicies = policies.filter(isPolicyActiveNow);
  const policyConflictGroups = Object.values(
    activePolicies.reduce((acc, policy) => {
      const key = getPolicyConflictKey(policy);
      if (!acc[key]) acc[key] = [];
      acc[key].push(policy);
      return acc;
    }, {})
  ).filter((rows) => rows.length > 1);
  const permissionEntries = Object.entries(policyPermissions.users || {});

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
              每個品牌獨立設定判斷項目、門檻與顯示上限；可從既有指標庫自由加入或移除，儲存後不需重新部署 Functions。
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-2xl bg-rose-50 p-3">
                  <p className="text-[10px] font-black text-rose-400">營運異常</p>
                  <p className="mt-1 text-lg font-black text-rose-600">
                    {Number(status?.operationalAlertCount ?? status?.lastManualOperationalAlertCount ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-2xl bg-amber-50 p-3">
                  <p className="text-[10px] font-black text-amber-500">資料待補</p>
                  <p className="mt-1 text-lg font-black text-amber-600">
                    {Number(status?.dataIssueCount ?? status?.lastManualDataIssueCount ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-2xl bg-sky-50 p-3">
                  <p className="text-[10px] font-black text-sky-400">文件讀取</p>
                  <p className="mt-1 text-lg font-black text-sky-600">
                    {Number(status?.readCount ?? status?.lastManualReadCount ?? 0).toLocaleString()}
                  </p>
                </div>
              </div>
              {status?.brandResults && Object.keys(status.brandResults).length > 0 && (
                <div className="space-y-2 rounded-2xl border border-stone-100 bg-white p-3">
                  <p className="text-[10px] font-black text-stone-400">各品牌最近結果</p>
                  {Object.entries(status.brandResults).filter(([brandId]) => (status?.brandIds || form.brandIds).includes(brandId)).map(([brandId, item]) => (
                    <div key={brandId} className="flex items-center justify-between gap-3 text-[11px] font-bold text-stone-600">
                      <span>{item?.brand || brandId}</span>
                      <span className={item?.status === "error" ? "text-rose-600" : item?.status === "sent" ? "text-emerald-600" : "text-stone-400"}>
                        {TELEGRAM_BRAND_STATUS_LABELS[item?.status] || item?.status || "尚無紀錄"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
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
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-black text-stone-800">各品牌預警判斷設定</p>
              <p className="mt-1 text-[11px] font-bold text-stone-400">
                每個品牌有獨立規則。移除只會停用該項目，之後可從指標庫重新加入。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {TELEGRAM_ALERT_BRANDS.filter((brand) => brand.id !== activeBrandId).map((brand) => (
                <button
                  key={brand.id}
                  type="button"
                  onClick={() => copyActiveBrandProfile(brand.id)}
                  className="inline-flex items-center gap-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[10px] font-black text-stone-500 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                >
                  <Copy size={12} />
                  複製到{brand.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-stone-50 p-1.5">
            {TELEGRAM_ALERT_BRANDS.map((brand) => {
              const active = activeBrandId === brand.id;
              const included = form.brandIds.includes(brand.id);
              const enabledCount = Object.values(form.brandProfiles?.[brand.id]?.rules || {}).filter((rule) => rule?.enabled).length;
              return (
                <button
                  key={brand.id}
                  type="button"
                  onClick={() => {
                    setActiveBrandId(brand.id);
                    setRulePickerOpen(false);
                  }}
                  className={`rounded-xl px-3 py-2.5 text-center transition ${active ? "bg-white text-sky-700 shadow-sm" : "text-stone-400 hover:text-stone-600"}`}
                >
                  <span className="block text-xs font-black">{brand.label}</span>
                  <span className="mt-0.5 block text-[9px] font-bold">
                    {included ? `已納入｜${enabledCount} 項` : `未納入｜${enabledCount} 項`}
                  </span>
                </button>
              );
            })}
          </div>

          {(() => {
            const activeProfile = form.brandProfiles?.[activeBrandId] || createDefaultTelegramBrandProfile();
            const enabledDefinitions = TELEGRAM_ALERT_RULE_DEFINITIONS.filter(
              (definition) => activeProfile.rules?.[definition.id]?.enabled === true
            );
            const disabledDefinitions = TELEGRAM_ALERT_RULE_DEFINITIONS.filter(
              (definition) => activeProfile.rules?.[definition.id]?.enabled !== true
            );
            return (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 rounded-2xl border border-sky-100 bg-sky-50/50 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-xs font-black text-sky-800">
                      {getTelegramAlertBrandLabel(activeBrandId)}｜已啟用 {enabledDefinitions.length} 項判斷
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-sky-500">
                      這些設定只套用到 {getTelegramAlertBrandLabel(activeBrandId)} 的獨立巡察訊息。
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-black text-stone-600">
                    最多顯示
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={activeProfile.limit}
                      onChange={(event) => updateBrandProfile(activeBrandId, (profile) => ({ ...profile, limit: event.target.value }))}
                      className="w-16 rounded-xl border border-sky-100 bg-white px-2 py-2 text-center outline-none"
                    />
                    家
                  </label>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setRulePickerOpen((previous) => !previous)}
                    disabled={!disabledDefinitions.length}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-black text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus size={14} />
                    {disabledDefinitions.length ? "新增判斷項目" : "所有可用項目皆已加入"}
                  </button>
                  {rulePickerOpen && disabledDefinitions.length > 0 && (
                    <div className="absolute left-0 top-12 z-20 w-full max-w-xl rounded-2xl border border-stone-200 bg-white p-2 shadow-2xl">
                      <p className="px-3 py-2 text-[10px] font-black text-stone-400">選擇要加入 {getTelegramAlertBrandLabel(activeBrandId)} 的判斷項目</p>
                      <div className="max-h-72 space-y-1 overflow-y-auto">
                        {disabledDefinitions.map((definition) => (
                          <button
                            key={definition.id}
                            type="button"
                            onClick={() => enableRule(definition.id)}
                            className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-sky-50"
                          >
                            <span>
                              <span className="block text-xs font-black text-stone-700">{definition.label}</span>
                              <span className="mt-0.5 block text-[10px] font-bold leading-4 text-stone-400">{definition.description}</span>
                            </span>
                            <Plus size={14} className="mt-0.5 shrink-0 text-sky-500" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {enabledDefinitions.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {enabledDefinitions.map((definition) => (
                      <TelegramRuleEditorCard
                        key={definition.id}
                        definition={definition}
                        rule={activeProfile.rules[definition.id]}
                        onChange={(nextRule) => updateBrandRule(activeBrandId, definition.id, nextRule)}
                        onRemove={() => disableRule(definition.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/60 p-8 text-center">
                    <p className="text-xs font-black text-amber-700">此品牌尚未啟用任何判斷項目</p>
                    <p className="mt-1 text-[10px] font-bold text-amber-500">請按「新增判斷項目」至少加入一項後再儲存。</p>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <div className="space-y-4 rounded-[1.5rem] border border-violet-100 bg-white/95 p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-violet-50 p-3 text-violet-600">
                <Brain size={20} />
              </div>
              <div>
                <p className="text-sm font-black text-stone-800">可控式長期記憶與營運規則</p>
                <p className="mt-1 text-[11px] font-bold leading-5 text-stone-400">
                  Telegram 可從自然語言建立規則，但正式生效前會要求確認；此處可直接檢視、建立、停用與整理規則。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-violet-50 px-3 py-1.5 text-[10px] font-black text-violet-600">
                生效 {activePolicies.length} 條
              </span>
              <span className={`rounded-full px-3 py-1.5 text-[10px] font-black ${policyConflictGroups.length ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"}`}>
                衝突 {policyConflictGroups.length} 組
              </span>
              <button
                type="button"
                onClick={() => setPolicyPanelOpen((previous) => !previous)}
                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-[10px] font-black text-stone-500"
              >
                {policyPanelOpen ? "收合" : "展開"}
              </button>
            </div>
          </div>

          {policyPanelOpen && (
            <div className="space-y-5">
              {!canManagePolicyCenter && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-700">
                  目前帳號可查看規則，但只有 master／director 可以在後台新增、停用規則或調整 Telegram 權限。
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr]">
                <div className="space-y-4 rounded-2xl border border-violet-100 bg-violet-50/30 p-4">
                  <div className="flex items-center gap-2">
                    <Settings2 size={15} className="text-violet-600" />
                    <p className="text-xs font-black text-stone-700">建立長期規則</p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="rounded-xl border border-stone-100 bg-white p-3">
                      <span className="mb-1.5 block text-[10px] font-black text-stone-400">規則類型</span>
                      <select
                        value={policyEditor.type}
                        onChange={(event) => setPolicyEditor((previous) => ({
                          ...createDefaultPolicyEditor(),
                          type: event.target.value,
                          ownerScope: event.target.value === "response_preference" ? "global" : "brand",
                        }))}
                        className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"
                      >
                        <option value="exclude_store">排除／暫停店家分析</option>
                        <option value="alert_rule">品牌預警門檻覆寫</option>
                        <option value="response_preference">回答偏好</option>
                      </select>
                    </label>

                    {policyEditor.type !== "response_preference" && (
                      <label className="rounded-xl border border-stone-100 bg-white p-3">
                        <span className="mb-1.5 block text-[10px] font-black text-stone-400">品牌</span>
                        <select
                          value={policyEditor.brandId}
                          onChange={(event) => setPolicyEditor((previous) => ({ ...previous, brandId: event.target.value }))}
                          className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"
                        >
                          {TELEGRAM_ALERT_BRANDS.map((brand) => (
                            <option key={brand.id} value={brand.id}>{brand.label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>

                  {policyEditor.type === "exclude_store" && (
                    <div className="space-y-3">
                      <label className="block rounded-xl border border-stone-100 bg-white p-3">
                        <span className="mb-1.5 block text-[10px] font-black text-stone-400">店家名稱</span>
                        <input
                          value={policyEditor.storeName}
                          onChange={(event) => setPolicyEditor((previous) => ({ ...previous, storeName: event.target.value }))}
                          placeholder="例如：中美店"
                          className="w-full bg-transparent text-sm font-black text-stone-700 outline-none"
                        />
                      </label>
                      <div className="rounded-xl border border-stone-100 bg-white p-3">
                        <p className="mb-2 text-[10px] font-black text-stone-400">作用範圍</p>
                        <div className="flex flex-wrap gap-2">
                          {TELEGRAM_POLICY_SCOPES.map((scope) => {
                            const active = policyEditor.scopes.includes(scope.id);
                            return (
                              <button
                                key={scope.id}
                                type="button"
                                onClick={() => setPolicyEditor((previous) => ({
                                  ...previous,
                                  scopes: active
                                    ? previous.scopes.filter((item) => item !== scope.id)
                                    : [...previous.scopes, scope.id],
                                }))}
                                className={`rounded-xl border px-3 py-2 text-[10px] font-black transition ${active ? "border-violet-200 bg-violet-50 text-violet-700" : "border-stone-100 bg-stone-50 text-stone-400"}`}
                              >
                                {scope.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {policyEditor.type === "alert_rule" && (
                    <div className="space-y-3">
                      <label className="block rounded-xl border border-stone-100 bg-white p-3">
                        <span className="mb-1.5 block text-[10px] font-black text-stone-400">預警項目</span>
                        <select
                          value={policyEditor.ruleId}
                          onChange={(event) => setPolicyEditor((previous) => ({ ...previous, ruleId: event.target.value }))}
                          className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"
                        >
                          {TELEGRAM_POLICY_RULES.map((rule) => (
                            <option key={rule.id} value={rule.id}>{rule.label}</option>
                          ))}
                        </select>
                      </label>

                      {policyEditor.ruleId !== "limit" && (
                        <label className="flex items-center justify-between rounded-xl border border-stone-100 bg-white p-3 text-xs font-black text-stone-600">
                          啟用此項判斷
                          <input
                            type="checkbox"
                            checked={policyEditor.enabledValue !== false}
                            onChange={(event) => setPolicyEditor((previous) => ({ ...previous, enabledValue: event.target.checked }))}
                            className="h-4 w-4"
                          />
                        </label>
                      )}

                      {policyEditor.ruleId === "progressGap" ? (
                        <div className="grid grid-cols-2 gap-2">
                          <TelegramRuleNumberField
                            label="黃燈落後"
                            value={policyEditor.watchThreshold}
                            onChange={(value) => setPolicyEditor((previous) => ({ ...previous, watchThreshold: value }))}
                            unit="百分點"
                          />
                          <TelegramRuleNumberField
                            label="紅燈落後"
                            value={policyEditor.criticalThreshold}
                            onChange={(value) => setPolicyEditor((previous) => ({ ...previous, criticalThreshold: value }))}
                            unit="百分點"
                          />
                        </div>
                      ) : policyEditor.ruleId === "limit" ? (
                        <TelegramRuleNumberField
                          label="每品牌最多顯示"
                          value={policyEditor.limit}
                          onChange={(value) => setPolicyEditor((previous) => ({ ...previous, limit: value }))}
                          unit="家"
                          max={20}
                        />
                      ) : !["missingReport", "missingTarget"].includes(policyEditor.ruleId) ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <TelegramRuleNumberField
                            label="判斷門檻"
                            value={policyEditor.threshold}
                            onChange={(value) => setPolicyEditor((previous) => ({ ...previous, threshold: value }))}
                            unit={["cashAchievementRate", "closingRate", "skincareRatio"].includes(policyEditor.ruleId) ? "%" : policyEditor.ruleId === "traffic" ? "人次" : "人"}
                            max={["newCustomers", "traffic"].includes(policyEditor.ruleId) ? 999999 : 100}
                          />
                          <TelegramRuleSeverityField
                            value={policyEditor.severity}
                            onChange={(value) => setPolicyEditor((previous) => ({ ...previous, severity: value }))}
                          />
                          {policyEditor.ruleId === "closingRate" && (
                            <TelegramRuleNumberField
                              label="最低新客樣本"
                              value={policyEditor.minSample}
                              onChange={(value) => setPolicyEditor((previous) => ({ ...previous, minSample: value }))}
                              unit="人"
                              max={999}
                            />
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {policyEditor.type === "response_preference" && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="rounded-xl border border-stone-100 bg-white p-3">
                          <span className="mb-1.5 block text-[10px] font-black text-stone-400">套用對象</span>
                          <select
                            value={policyEditor.ownerScope}
                            onChange={(event) => setPolicyEditor((previous) => ({ ...previous, ownerScope: event.target.value }))}
                            className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"
                          >
                            <option value="global">所有 Telegram 使用者</option>
                            <option value="user">指定使用者</option>
                          </select>
                        </label>
                        {policyEditor.ownerScope === "user" && (
                          <label className="rounded-xl border border-stone-100 bg-white p-3">
                            <span className="mb-1.5 block text-[10px] font-black text-stone-400">Telegram 使用者 ID</span>
                            <input
                              value={policyEditor.userId}
                              onChange={(event) => setPolicyEditor((previous) => ({ ...previous, userId: event.target.value }))}
                              className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"
                            />
                          </label>
                        )}
                      </div>
                      <label className="block rounded-xl border border-stone-100 bg-white p-3">
                        <span className="mb-1.5 block text-[10px] font-black text-stone-400">偏好識別名稱</span>
                        <input
                          value={policyEditor.preferenceKey}
                          onChange={(event) => setPolicyEditor((previous) => ({ ...previous, preferenceKey: event.target.value }))}
                          placeholder="例如：conclusion_first"
                          className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"
                        />
                      </label>
                      <label className="block rounded-xl border border-stone-100 bg-white p-3">
                        <span className="mb-1.5 block text-[10px] font-black text-stone-400">回答偏好內容</span>
                        <textarea
                          value={policyEditor.instruction}
                          onChange={(event) => setPolicyEditor((previous) => ({ ...previous, instruction: event.target.value }))}
                          placeholder="例如：回答時先給結論，再列出最多三項優先行動。"
                          rows={3}
                          className="w-full resize-none bg-transparent text-xs font-bold leading-5 text-stone-700 outline-none"
                        />
                      </label>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="rounded-xl border border-stone-100 bg-white p-3">
                      <span className="mb-1.5 block text-[10px] font-black text-stone-400">有效期限</span>
                      <input
                        type="date"
                        value={policyEditor.effectiveUntil}
                        onChange={(event) => setPolicyEditor((previous) => ({ ...previous, effectiveUntil: event.target.value }))}
                        className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"
                      />
                      <span className="mt-1 block text-[9px] font-bold text-stone-300">留空代表持續有效，直到人工撤銷。</span>
                    </label>
                    <TelegramRuleNumberField
                      label="規則優先權"
                      value={policyEditor.priority}
                      onChange={(value) => setPolicyEditor((previous) => ({ ...previous, priority: value }))}
                      unit="分"
                      max={999}
                    />
                  </div>

                  <ActionButton onClick={savePolicy} disabled={isBusy || !canManagePolicyCenter} className="w-full">
                    {loadingAction === "savePolicy" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    建立長期規則
                  </ActionButton>
                </div>

                <div className="space-y-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-black text-stone-700">目前規則</p>
                      <p className="mt-1 text-[10px] font-bold text-stone-400">Telegram 的 /rules 會顯示生效規則；每日 03:20 自動整理過期與重複規則。</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => refreshPolicies()}
                        disabled={isBusy}
                        className="rounded-xl border border-stone-200 bg-white p-2 text-stone-500"
                        title="重新整理"
                      >
                        <RefreshCw size={14} className={loadingAction === "refreshPolicies" ? "animate-spin" : ""} />
                      </button>
                      <button
                        type="button"
                        onClick={cleanupPolicyConflicts}
                        disabled={isBusy || !canManagePolicyCenter}
                        className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] font-black text-amber-600"
                      >
                        整理衝突
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[640px] space-y-2 overflow-y-auto pr-1">
                    {policies.length ? (
                      [...policies]
                        .sort((a, b) => String(b.updatedAtText || b.createdAtText || "").localeCompare(String(a.updatedAtText || a.createdAtText || "")))
                        .map((policy) => {
                          const active = isPolicyActiveNow(policy);
                          const isConflict = policyConflictGroups.some((rows) => rows.some((item) => item.id === policy.id));
                          const brandLabel = policy.brandId ? getTelegramAlertBrandLabel(policy.brandId) : "全域";
                          const title = policy.type === "exclude_store"
                            ? `${brandLabel}｜排除 ${policy.storeName || policy.storeCore}店`
                            : policy.type === "alert_rule"
                              ? `${brandLabel}｜${TELEGRAM_POLICY_RULES.find((item) => item.id === policy.ruleId)?.label || policy.ruleId}`
                              : `${policy.ownerScope === "user" ? `使用者 ${policy.userId}` : "全域"}｜回答偏好`;
                          const detail = policy.type === "exclude_store"
                            ? (policy.scopes || []).map((scope) => TELEGRAM_POLICY_SCOPES.find((item) => item.id === scope)?.label || scope).join("、")
                            : policy.type === "alert_rule"
                              ? JSON.stringify(policy.value || {})
                              : policy.instruction;
                          return (
                            <article key={policy.id} className={`rounded-2xl border bg-white p-3 ${isConflict ? "border-rose-200" : active ? "border-violet-100" : "border-stone-100 opacity-60"}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-xs font-black text-stone-700">{title}</p>
                                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${active ? "bg-emerald-50 text-emerald-600" : "bg-stone-100 text-stone-400"}`}>
                                      {active ? "生效" : policy.status || "停用"}
                                    </span>
                                    {isConflict && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-black text-rose-600">衝突</span>}
                                  </div>
                                  <p className="mt-1 break-words text-[10px] font-bold leading-4 text-stone-400">{detail || "未提供細節"}</p>
                                  <p className="mt-1 text-[9px] font-bold text-stone-300">
                                    {policy.policyCode || policy.id}｜優先權 {Number(policy.priority || 100)}
                                    {policy.effectiveUntil ? `｜至 ${policy.effectiveUntil}` : "｜無期限"}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => togglePolicyEnabled(policy)}
                                  disabled={isBusy || !canManagePolicyCenter}
                                  className={`shrink-0 rounded-xl border px-3 py-2 text-[10px] font-black ${active ? "border-rose-100 bg-rose-50 text-rose-600" : "border-emerald-100 bg-emerald-50 text-emerald-600"}`}
                                >
                                  {loadingAction === `policy:${policy.id}` ? <Loader2 size={12} className="animate-spin" /> : active ? "停用" : "啟用"}
                                </button>
                              </div>
                            </article>
                          );
                        })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center text-xs font-black text-stone-400">
                        尚未建立長期規則
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-sky-600" />
                  <div>
                    <p className="text-xs font-black text-stone-700">Telegram 規則修改權限</p>
                    <p className="mt-1 text-[10px] font-bold text-stone-400">一旦建立個人權限名單，未列入名單的人會自動降為只讀。</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
                  <label className="rounded-xl border border-stone-100 bg-white p-3">
                    <span className="mb-1 block text-[10px] font-black text-stone-400">Telegram 使用者 ID</span>
                    <input
                      value={permissionDraft.userId}
                      onChange={(event) => setPermissionDraft((previous) => ({ ...previous, userId: event.target.value }))}
                      className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"
                    />
                  </label>
                  <label className="rounded-xl border border-stone-100 bg-white p-3">
                    <span className="mb-1 block text-[10px] font-black text-stone-400">名稱</span>
                    <input
                      value={permissionDraft.displayName}
                      onChange={(event) => setPermissionDraft((previous) => ({ ...previous, displayName: event.target.value }))}
                      className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"
                    />
                  </label>
                  <label className="rounded-xl border border-stone-100 bg-white p-3">
                    <span className="mb-1 block text-[10px] font-black text-stone-400">角色</span>
                    <select
                      value={permissionDraft.role}
                      onChange={(event) => setPermissionDraft((previous) => ({ ...previous, role: event.target.value }))}
                      className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"
                    >
                      <option value="director">Director｜全公司規則</option>
                      <option value="brand_manager">品牌主管｜指定品牌</option>
                      <option value="viewer">Viewer｜只讀</option>
                    </select>
                  </label>
                  <ActionButton onClick={savePermission} disabled={isBusy || !canManagePolicyCenter} className="self-stretch lg:self-end">
                    <UserPlus size={14} />
                    儲存權限
                  </ActionButton>
                </div>

                {permissionDraft.role === "brand_manager" && (
                  <div className="flex flex-wrap gap-2 rounded-xl border border-stone-100 bg-white p-3">
                    {TELEGRAM_ALERT_BRANDS.map((brand) => {
                      const active = permissionDraft.brandIds.includes(brand.id);
                      return (
                        <button
                          key={brand.id}
                          type="button"
                          onClick={() => setPermissionDraft((previous) => ({
                            ...previous,
                            brandIds: active
                              ? previous.brandIds.filter((item) => item !== brand.id)
                              : [...previous.brandIds, brand.id],
                          }))}
                          className={`rounded-xl border px-3 py-2 text-[10px] font-black ${active ? "border-sky-200 bg-sky-50 text-sky-700" : "border-stone-100 bg-stone-50 text-stone-400"}`}
                        >
                          {brand.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {permissionEntries.length ? permissionEntries.map(([userId, permission]) => (
                    <div key={userId} className="flex items-center justify-between gap-3 rounded-xl border border-stone-100 bg-white p-3">
                      <div>
                        <p className="text-xs font-black text-stone-700">{permission.displayName || userId}</p>
                        <p className="mt-1 text-[9px] font-bold text-stone-400">
                          {permission.role || "viewer"}｜{(permission.brandIds || []).map(getTelegramAlertBrandLabel).join("、") || "無品牌"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePermission(userId)}
                        disabled={isBusy || !canManagePolicyCenter}
                        className="rounded-lg border border-rose-100 bg-rose-50 p-2 text-rose-500"
                        title="移除權限"
                      >
                        {loadingAction === `permission:${userId}` ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={13} />}
                      </button>
                    </div>
                  )) : (
                    <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50 p-3 text-[10px] font-bold text-amber-700 md:col-span-2 xl:col-span-3">
                      尚未設定個人名單：高階主管主群暫以 director、主管群暫以品牌主管預設權限運作。建立第一筆名單後，未列入的人會改為只讀。
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
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

        {previewItems.length > 0 && (
          <div className="rounded-[1.5rem] border border-sky-100 bg-[#F8FCFF] p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-black text-stone-800">各品牌 Telegram 預覽</p>
                <p className="mt-1 text-[10px] font-bold text-stone-400">正式排程與測試推播都會依下列卡片，一個品牌獨立發送一則。</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItems([])}
                className="text-[10px] font-black text-stone-400 hover:text-rose-500"
              >
                關閉預覽
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              {previewItems.map((item, index) => (
                <article key={item.brandId || `${item.brand}-${index}`} className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-sky-50 bg-sky-50/60 px-4 py-3">
                    <div>
                      <p className="text-sm font-black text-stone-800">{item.brand || "品牌預覽"}</p>
                      <p className="mt-0.5 text-[10px] font-bold text-stone-400">
                        營運異常 {Number(item.operationalAlertCount || 0).toLocaleString()}｜資料待補 {Number(item.dataIssueCount || 0).toLocaleString()}｜最多 {Number(item.limit || 0).toLocaleString()} 家
                      </p>
                      {Array.isArray(item.enabledRuleLabels) && item.enabledRuleLabels.length > 0 && (
                        <p className="mt-1 text-[9px] font-bold text-sky-500">
                          判斷：{item.enabledRuleLabels.join("、")}
                        </p>
                      )}
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-sky-600 shadow-sm">
                      排除 {Number(item.excludedStoreCount || 0).toLocaleString()} 家
                    </span>
                  </div>
                  <pre className="max-h-[520px] overflow-y-auto whitespace-pre-wrap break-words p-4 font-sans text-xs font-bold leading-6 text-stone-600">
                    {item.previewText || "目前沒有可預覽內容"}
                  </pre>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default TelegramAlertControlCenter;
