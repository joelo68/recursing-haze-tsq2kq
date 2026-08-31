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
  FileText,
  ListChecks,
  CheckCircle2,
  LayoutDashboard,
  CalendarClock,
  BellRing,
  ChevronRight,
  AlertTriangle,
  Users,
} from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
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

const createDefaultV5ScheduleEditor = () => ({
  name: "三品牌工作日晨報",
  source: "weekday_morning_brief",
  reportType: "weekday_morning_brief",
  time: "10:00",
  weekdays: [1, 2, 3, 4, 5],
  targetGroup: "manager",
  isActive: true,
  pausedUntil: "",
  cutoffMode: "yesterday",
  topCount: 3,
  bottomCount: 3,
  includeMissingReports: true,
});

const V5_WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

const getV5TaskStatusLabel = (status) => ({
  open: "待處理",
  in_progress: "處理中",
  completed: "已完成",
  cancelled: "已取消",
  overdue: "已逾期",
}[status] || status || "未知");

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


const TELEGRAM_SECURITY_TARGET_OPTIONS = [
  { id: "main", label: "高階主管主群", hint: "Chat ID -4991191955｜既有正式主群" },
  { id: "manager", label: "主管群", hint: "Chat ID -1002361008620｜既有主管群" },
  { id: "agent_test", label: "Agent 測試群", hint: "Chat ID -5241604208｜既有測試白名單" },
];

const createDefaultTelegramSecurityForm = () => ({
  enabled: false,
  chatTargets: [],
});

const normalizeTelegramSecurityForm = (raw = {}) => ({
  enabled: raw.enabled === true,
  chatTargets: [...new Set((Array.isArray(raw.chatTargets) ? raw.chatTargets : [])
    .map(String)
    .filter((value) => TELEGRAM_SECURITY_TARGET_OPTIONS.some((item) => item.id === value)))],
});

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

const TelegramAlertControlCenter = ({ view = "alerts", onNavigate }) => {
  const {
    currentUser,
    userRole,
    showToast,
    currentDeviceTrust,
    canManageDeviceSecurity,
    updateTelegramSecurityAlertConfig,
  } = useContext(AppContext);
  const [form, setForm] = useState(createDefaultTelegramAlertForm);
  const [securityAlertForm, setSecurityAlertForm] = useState(createDefaultTelegramSecurityForm);
  const [securityAlertRevision, setSecurityAlertRevision] = useState(0);
  const [securityCredentialOpen, setSecurityCredentialOpen] = useState(false);
  const [securityCredentialPassword, setSecurityCredentialPassword] = useState("");
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
  const [reportSnapshots, setReportSnapshots] = useState([]);
  const [v5Schedules, setV5Schedules] = useState([]);
  const [improvementTasks, setImprovementTasks] = useState([]);
  const [v5ScheduleEditor, setV5ScheduleEditor] = useState(createDefaultV5ScheduleEditor);
  const [v5PanelOpen, setV5PanelOpen] = useState(true);
  const [alertSection, setAlertSection] = useState("basic");
  const [taskFilter, setTaskFilter] = useState("open");
  const [governanceTab, setGovernanceTab] = useState("rules");
  const canManagePolicyCenter = ["master", "director"].includes(String(userRole || ""));
  const canManageSecurityAlertConfig = canManageDeviceSecurity === true;

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
  const securityConfigRef = doc(
    db,
    ...TELEGRAM_ALERT_DATA_PATH,
    "global_settings",
    "telegram_security_alerts"
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
  const reportSnapshotCollectionRef = collection(
    db,
    ...TELEGRAM_ALERT_DATA_PATH,
    "telegram_report_snapshots"
  );
  const improvementTaskCollectionRef = collection(
    db,
    ...TELEGRAM_ALERT_DATA_PATH,
    "telegram_agent_tasks"
  );
  const v5ScheduleCollectionRef = collection(db, "notification_rules");
  const v5ScheduleAuditCollectionRef = collection(
    db,
    ...TELEGRAM_ALERT_DATA_PATH,
    "telegram_schedule_audits"
  );
  const v5TaskAuditCollectionRef = collection(
    db,
    ...TELEGRAM_ALERT_DATA_PATH,
    "telegram_agent_task_audits"
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



  const refreshV5Operations = async ({ silent = false } = {}) => {
    if (!silent) setLoadingAction("refreshV5Operations");
    try {
      const [snapshotSnap, scheduleSnap, taskSnap] = await Promise.all([
        getDocs(query(reportSnapshotCollectionRef, orderBy("createdAtText", "desc"), limit(30))),
        getDocs(query(v5ScheduleCollectionRef, orderBy("time", "asc"), limit(200))),
        getDocs(query(improvementTaskCollectionRef, orderBy("createdAtText", "desc"), limit(100))),
      ]);
      setReportSnapshots(
        snapshotSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => String(b.createdAtText || "").localeCompare(String(a.createdAtText || "")))
          .slice(0, 30)
      );
      setV5Schedules(
        scheduleSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => `${a.time || ""}|${a.name || ""}`.localeCompare(`${b.time || ""}|${b.name || ""}`))
      );
      setImprovementTasks(
        taskSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => String(b.createdAtText || "").localeCompare(String(a.createdAtText || "")))
          .slice(0, 100)
      );
      if (!silent) notify("v5 報表快照、排程與改善任務已更新", "success");
    } catch (error) {
      notify(error.message || "v5 營運中樞資料載入失敗", "error");
    } finally {
      if (!silent) setLoadingAction(null);
    }
  };

  const saveV5MorningBriefSchedule = async () => {
    if (!canManagePolicyCenter) {
      notify("只有 master／director 可以建立固定排程", "error");
      return;
    }
    try {
      setLoadingAction("saveV5Schedule");
      const payload = {
        ...v5ScheduleEditor,
        weekdays: [...new Set((v5ScheduleEditor.weekdays || []).map(Number))],
        topCount: Math.max(1, Math.min(10, Number(v5ScheduleEditor.topCount) || 3)),
        bottomCount: Math.max(1, Math.min(10, Number(v5ScheduleEditor.bottomCount) || 3)),
        scheduleCode: `SCH-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        createdByName: currentUser?.name || "director",
        createdByUserId: currentUser?.id || currentUser?.uid || "",
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
        updatedAt: serverTimestamp(),
        updatedAtText: new Date().toISOString(),
      };
      const scheduleRef = await addDoc(v5ScheduleCollectionRef, payload);
      await addDoc(v5ScheduleAuditCollectionRef, {
        action: "create",
        scheduleId: scheduleRef.id,
        scheduleCode: payload.scheduleCode,
        scheduleSnapshot: payload,
        actor: { source: "saas_control_center", name: currentUser?.name || "director", role: userRole || "director" },
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
      });
      await refreshV5Operations({ silent: true });
      notify("三品牌工作日晨報排程已建立", "success");
    } catch (error) {
      notify(error.message || "建立工作日晨報排程失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const toggleV5Schedule = async (schedule) => {
    if (!canManagePolicyCenter) return notify("目前權限無法修改排程", "error");
    try {
      setLoadingAction(`v5Schedule:${schedule.id}`);
      const active = schedule.isActive === true || String(schedule.isActive).toLowerCase() === "true";
      await setDoc(doc(v5ScheduleCollectionRef, schedule.id), {
        isActive: !active,
        updatedAt: serverTimestamp(),
        updatedAtText: new Date().toISOString(),
      }, { merge: true });
      await addDoc(v5ScheduleAuditCollectionRef, {
        action: active ? "deactivate" : "activate",
        scheduleId: schedule.id,
        scheduleCode: schedule.scheduleCode || "",
        scheduleSnapshot: { ...schedule, isActive: !active },
        actor: { source: "saas_control_center", name: currentUser?.name || "director", role: userRole || "director" },
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
      });
      await refreshV5Operations({ silent: true });
      notify(active ? "排程已停用" : "排程已啟用", "success");
    } catch (error) {
      notify(error.message || "排程狀態更新失敗", "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const updateV5TaskStatus = async (task, status) => {
    if (!canManagePolicyCenter) return notify("目前權限無法修改改善任務", "error");
    try {
      setLoadingAction(`v5Task:${task.id}`);
      const taskPatch = {
        status,
        ...(status === "completed" ? {
          completedAt: serverTimestamp(),
          completedAtText: new Date().toISOString(),
          resultText: task.resultText || "由 SaaS 營運中樞標記完成",
        } : {}),
        updatedAt: serverTimestamp(),
        updatedAtText: new Date().toISOString(),
      };
      await setDoc(doc(improvementTaskCollectionRef, task.id), taskPatch, { merge: true });
      await addDoc(v5TaskAuditCollectionRef, {
        action: "status_change",
        taskId: task.id,
        taskCode: task.taskCode || "",
        taskSnapshot: { ...task, status },
        actor: { source: "saas_control_center", name: currentUser?.name || "director", role: userRole || "director" },
        createdAt: serverTimestamp(),
        createdAtText: new Date().toISOString(),
      });
      await refreshV5Operations({ silent: true });
      notify(`任務已更新為${getV5TaskStatusLabel(status)}`, "success");
    } catch (error) {
      notify(error.message || "任務狀態更新失敗", "error");
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
      if (!["master", "director"].includes(String(userRole || ""))) {
        if (!cancelled) setIsLoaded(true);
        return;
      }

      const needsAlerts = ["overview", "alerts"].includes(view);
      const needsRules = ["overview", "governance"].includes(view);
      const needsSnapshots = ["overview", "reportHistory"].includes(view);
      const needsSchedules = view === "overview";
      const needsTasks = ["overview", "tasks"].includes(view);

      try {
        const [configSnap, securityConfigSnap, statusSnap, policySnap, permissionSnap, snapshotSnap, scheduleSnap, taskSnap] = await Promise.all([
          needsAlerts ? getDoc(configRef) : Promise.resolve(null),
          needsAlerts ? getDoc(securityConfigRef) : Promise.resolve(null),
          needsAlerts ? getDoc(statusRef) : Promise.resolve(null),
          needsRules ? getDocs(policyCollectionRef) : Promise.resolve(null),
          needsRules ? getDoc(policyPermissionsRef) : Promise.resolve(null),
          needsSnapshots ? getDocs(query(reportSnapshotCollectionRef, orderBy("createdAtText", "desc"), limit(30))) : Promise.resolve(null),
          needsSchedules ? getDocs(query(v5ScheduleCollectionRef, orderBy("time", "asc"), limit(200))) : Promise.resolve(null),
          needsTasks ? getDocs(query(improvementTaskCollectionRef, orderBy("createdAtText", "desc"), limit(100))) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        if (configSnap) setForm(normalizeTelegramAlertForm(configSnap.exists() ? configSnap.data() : {}));
        if (securityConfigSnap) {
          const securityConfigData = securityConfigSnap.exists() ? securityConfigSnap.data() || {} : {};
          setSecurityAlertForm(normalizeTelegramSecurityForm(securityConfigData));
          setSecurityAlertRevision(Math.max(0, Number(securityConfigData.revision || 0)));
        }
        if (statusSnap) setStatus(statusSnap.exists() ? statusSnap.data() : null);
        if (policySnap) setPolicies(policySnap.docs.map((item) => ({ id: item.id, ...item.data() })));
        if (permissionSnap) setPolicyPermissions(permissionSnap.exists() ? permissionSnap.data() : { users: {} });
        if (snapshotSnap) setReportSnapshots(snapshotSnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => String(b.createdAtText || "").localeCompare(String(a.createdAtText || ""))).slice(0, 30));
        if (scheduleSnap) setV5Schedules(scheduleSnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => `${a.time || ""}|${a.name || ""}`.localeCompare(`${b.time || ""}|${b.name || ""}`)));
        if (taskSnap) setImprovementTasks(taskSnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => String(b.createdAtText || "").localeCompare(String(a.createdAtText || ""))).slice(0, 100));
      } catch (error) {
        if (!cancelled) notify(error.message || "Telegram 營運助手載入失敗", "error");
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // 依目前分頁只載入必要資料，避免切換頁面時讀取不相關集合。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole, view]);

  if (!["master", "director"].includes(String(userRole || ""))) return null;

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

  const toggleSecurityTarget = (targetId) => {
    setSecurityAlertForm((previous) => {
      const current = Array.isArray(previous.chatTargets) ? previous.chatTargets : [];
      return {
        ...previous,
        chatTargets: current.includes(targetId)
          ? current.filter((item) => item !== targetId)
          : [...current, targetId],
      };
    });
  };

  const refreshSecurityAlertConfig = async () => {
    const snap = await getDoc(securityConfigRef);
    const data = snap.exists() ? snap.data() || {} : {};
    setSecurityAlertForm(normalizeTelegramSecurityForm(data));
    setSecurityAlertRevision(Math.max(0, Number(data.revision || 0)));
  };

  const requestSaveSecurityAlertConfig = () => {
    const normalized = normalizeTelegramSecurityForm(securityAlertForm);
    if (!canManageSecurityAlertConfig) {
      notify("只有最高管理者可以修改登入安全通知設定", "error");
      return;
    }
    if (currentDeviceTrust?.status !== "trusted") {
      notify("目前裝置尚未完成信任確認，無法修改登入安全通知設定", "error");
      return;
    }
    if (normalized.enabled && !normalized.chatTargets.length) {
      notify("啟用登入安全通知前，請至少選擇一個 Telegram 群組", "error");
      return;
    }
    setSecurityCredentialPassword("");
    setSecurityCredentialOpen(true);
  };

  const confirmSaveSecurityAlertConfig = async () => {
    const normalized = normalizeTelegramSecurityForm(securityAlertForm);
    const password = String(securityCredentialPassword || "").trim();
    if (!password) {
      notify("請輸入目前最高管理者密碼", "error");
      return;
    }
    try {
      setLoadingAction("saveSecurityAlertConfig");
      const result = await updateTelegramSecurityAlertConfig({
        config: normalized,
        expectedRevision: securityAlertRevision,
        credentialPassword: password,
      });
      setSecurityAlertForm(normalizeTelegramSecurityForm(result?.config || normalized));
      setSecurityAlertRevision(Math.max(0, Number(result?.revision || securityAlertRevision + 1)));
      setSecurityCredentialOpen(false);
      setSecurityCredentialPassword("");
      notify(
        normalized.enabled
          ? `登入安全即時通知已啟用：${normalized.chatTargets.length} 個群組`
          : "登入安全即時通知已停用；安全事件仍會保留在 SaaS",
        "success"
      );
    } catch (error) {
      if (Number(error?.status || 0) === 409 || error?.result?.reason === "revision_conflict") {
        await refreshSecurityAlertConfig().catch(() => {});
        setSecurityCredentialOpen(false);
        setSecurityCredentialPassword("");
        notify("設定已被另一位管理者更新，畫面已重新載入最新值，請確認後再儲存", "error");
      } else {
        notify(error.message || "登入安全通知設定儲存失敗", "error");
      }
    } finally {
      setLoadingAction(null);
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

  const taskCounts = improvementTasks.reduce((acc, task) => {
    const key = String(task.status || "open");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const activeSchedules = v5Schedules.filter((schedule) => schedule.isActive === true || String(schedule.isActive || "").toLowerCase() === "true");
  const filteredTasks = improvementTasks.filter((task) => {
    if (taskFilter === "all") return true;
    if (taskFilter === "open") return ["open", "in_progress"].includes(task.status);
    return task.status === taskFilter;
  });

  const goTo = (target) => {
    if (typeof onNavigate === "function") onNavigate(target);
  };

  const viewCopy = {
    overview: {
      icon: LayoutDashboard,
      eyebrow: "今日營運狀態",
      title: "管理總覽",
      description: "先看今天有沒有正常運作，再決定要處理哪一件事。",
    },
    alerts: {
      icon: BellRing,
      eyebrow: "異常時主動通知",
      title: "主動提醒",
      description: "設定什麼情況需要提醒主管，以及各品牌要採用的提醒條件。",
    },
    tasks: {
      icon: ListChecks,
      eyebrow: "問題處理進度",
      title: "改善追蹤",
      description: "追蹤被提醒的問題由誰處理、何時到期，以及是否已改善。",
    },
    governance: {
      icon: ShieldCheck,
      eyebrow: "長期規則與操作範圍",
      title: "規則與人員權限",
      description: "管理店家例外、長期回答偏好，以及哪些人可以修改設定。",
    },
    reportHistory: {
      icon: FileText,
      eyebrow: "當次報表紀錄",
      title: "報表紀錄",
      description: "查看每次正式發送時保存的數據與資料截止時間。",
    },
  };

  const meta = viewCopy[view] || viewCopy.alerts;
  const HeaderIcon = meta.icon;

  const renderOverview = () => {
    const overdueCount = Number(taskCounts.overdue || 0);
    const attentionCount = Number(status?.operationalAlertCount ?? status?.lastManualOperationalAlertCount ?? 0);
    const dataIssueCount = Number(status?.dataIssueCount ?? status?.lastManualDataIssueCount ?? 0);
    const lastSnapshot = reportSnapshots[0];
    const cards = [
      {
        id: "reports",
        title: "定時報表",
        value: `${activeSchedules.length} 份使用中`,
        detail: lastSnapshot ? `最近紀錄：${lastSnapshot.scheduleName || lastSnapshot.reportType || "固定報表"}` : "尚未產生正式報表紀錄",
        icon: CalendarClock,
        tone: "sky",
      },
      {
        id: "alerts",
        title: "主動提醒",
        value: form.enabled ? "目前已開啟" : "目前已停用",
        detail: form.enabled ? `下一次依設定於 ${form.sendTime} 檢查` : "停用期間不會主動檢查店家異常",
        icon: BellRing,
        tone: form.enabled ? "emerald" : "stone",
      },
      {
        id: "tasks",
        title: "改善追蹤",
        value: `${Number(taskCounts.open || 0) + Number(taskCounts.in_progress || 0)} 項待處理`,
        detail: overdueCount ? `其中 ${overdueCount} 項已逾期` : "目前沒有逾期任務",
        icon: ListChecks,
        tone: overdueCount ? "rose" : "amber",
      },
      {
        id: "governance",
        title: "規則與權限",
        value: `${activePolicies.length} 條規則生效`,
        detail: policyConflictGroups.length ? `${policyConflictGroups.length} 組規則需要整理` : "目前沒有規則重複或矛盾",
        icon: ShieldCheck,
        tone: policyConflictGroups.length ? "rose" : "violet",
      },
    ];

    const toneClass = {
      sky: "border-sky-100 bg-sky-50/50 text-sky-700",
      emerald: "border-emerald-100 bg-emerald-50/50 text-emerald-700",
      amber: "border-amber-100 bg-amber-50/50 text-amber-700",
      rose: "border-rose-100 bg-rose-50/50 text-rose-700",
      violet: "border-violet-100 bg-violet-50/50 text-violet-700",
      stone: "border-stone-100 bg-stone-50 text-stone-500",
    };

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => goTo(card.id)}
                className={`rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${toneClass[card.tone]}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-xl bg-white/80 p-2.5 shadow-sm"><Icon size={17} /></div>
                  <ChevronRight size={16} className="opacity-50" />
                </div>
                <p className="mt-4 text-xs font-black opacity-70">{card.title}</p>
                <p className="mt-1 text-lg font-black">{card.value}</p>
                <p className="mt-2 text-[10px] font-bold leading-4 opacity-70">{card.detail}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-stone-800">今天需要注意什麼？</p>
                <p className="mt-1 text-[11px] font-bold text-stone-400">只呈現會影響下一步的狀態，不顯示技術欄位。</p>
              </div>
              <button type="button" onClick={() => Promise.all([refreshStatus({ silent: true }), refreshV5Operations({ silent: true }), refreshPolicies({ silent: true })])} className="rounded-xl border border-stone-200 bg-white p-2 text-stone-500"><RefreshCw size={14} /></button>
            </div>
            <div className="mt-4 space-y-3">
              {attentionCount > 0 && (
                <button type="button" onClick={() => goTo("alerts")} className="flex w-full items-center justify-between rounded-2xl border border-rose-100 bg-rose-50/60 p-4 text-left">
                  <div className="flex items-start gap-3"><AlertTriangle size={17} className="mt-0.5 text-rose-600" /><div><p className="text-xs font-black text-rose-700">有 {attentionCount} 項營運異常需要查看</p><p className="mt-1 text-[10px] font-bold text-rose-500">前往主動提醒查看品牌與店家明細。</p></div></div><ChevronRight size={15} className="text-rose-400" />
                </button>
              )}
              {dataIssueCount > 0 && (
                <button type="button" onClick={() => goTo("alerts")} className="flex w-full items-center justify-between rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-left">
                  <div className="flex items-start gap-3"><FileText size={17} className="mt-0.5 text-amber-600" /><div><p className="text-xs font-black text-amber-700">有 {dataIssueCount} 項資料尚未補齊</p><p className="mt-1 text-[10px] font-bold text-amber-500">可能是日報或目標尚未完成。</p></div></div><ChevronRight size={15} className="text-amber-400" />
                </button>
              )}
              {overdueCount > 0 && (
                <button type="button" onClick={() => goTo("tasks")} className="flex w-full items-center justify-between rounded-2xl border border-rose-100 bg-white p-4 text-left">
                  <div className="flex items-start gap-3"><Clock size={17} className="mt-0.5 text-rose-600" /><div><p className="text-xs font-black text-stone-700">有 {overdueCount} 項改善任務已逾期</p><p className="mt-1 text-[10px] font-bold text-stone-400">建議確認負責人與新的完成期限。</p></div></div><ChevronRight size={15} className="text-stone-300" />
                </button>
              )}
              {attentionCount === 0 && dataIssueCount === 0 && overdueCount === 0 && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5 text-center"><CheckCircle2 size={24} className="mx-auto text-emerald-600" /><p className="mt-2 text-sm font-black text-emerald-700">目前沒有需要立即處理的事項</p><p className="mt-1 text-[10px] font-bold text-emerald-500">定時報表、主動提醒與改善追蹤皆未顯示異常。</p></div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 to-indigo-50 p-5 shadow-sm">
            <p className="text-sm font-black text-stone-800">我現在想做什麼？</p>
            <p className="mt-1 text-[11px] font-bold text-stone-400">直接選擇目的，不需要先理解功能名稱。</p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {[
                ["reports", "建立或調整定時報表", CalendarClock],
                ["alerts", "設定什麼情況要提醒", BellRing],
                ["tasks", "查看誰正在處理問題", ListChecks],
                ["governance", "管理排除店家與人員權限", Users],
              ].map(([target, label, Icon]) => (
                <button key={target} type="button" onClick={() => goTo(target)} className="flex items-center justify-between rounded-xl border border-white bg-white/80 px-4 py-3 text-left text-xs font-black text-stone-700 shadow-sm transition hover:bg-white">
                  <span className="flex items-center gap-2"><Icon size={15} className="text-sky-600" />{label}</span><ChevronRight size={14} className="text-stone-300" />
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  };

  const renderAlertBasic = () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="space-y-5 rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-sm font-black text-stone-800">是否要主動提醒？</p><p className="mt-1 text-[11px] font-bold text-stone-400">開啟後，系統會在指定時間檢查店家是否需要關注。</p></div>
          <button type="button" onClick={() => setForm((previous) => ({ ...previous, enabled: !previous.enabled }))} className={`relative h-9 w-16 rounded-full transition ${form.enabled ? "bg-emerald-500" : "bg-stone-200"}`}><span className={`absolute top-1 h-7 w-7 rounded-full bg-white shadow transition ${form.enabled ? "left-8" : "left-1"}`} /></button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="rounded-2xl border border-stone-100 bg-stone-50 p-4"><span className="mb-2 block text-[10px] font-black text-stone-400">每天幾點檢查？</span><div className="flex items-center gap-2"><Clock size={15} className="text-sky-500" /><input type="time" step="300" value={form.sendTime} onChange={(event) => setForm((previous) => ({ ...previous, sendTime: event.target.value }))} className="w-full bg-transparent text-sm font-black text-stone-700 outline-none" /></div></label>
          <label className="block rounded-2xl border border-stone-100 bg-stone-50 p-4"><span className="mb-2 block text-[10px] font-black text-stone-400">暫停到哪一天？</span><div className="flex min-h-12 min-w-0 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3"><Calendar size={15} className="shrink-0 text-sky-500" /><input type="date" value={form.pausedUntil || ""} onChange={(event) => setForm((previous) => ({ ...previous, pausedUntil: event.target.value }))} className="block h-11 min-w-0 flex-1 bg-transparent px-1 text-sm font-black leading-none text-stone-700 outline-none" style={{ colorScheme: "light" }} /></div></label>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-stone-100 bg-white p-4"><p className="mb-3 text-[10px] font-black text-stone-400">哪幾天檢查？</p><div className="flex flex-wrap gap-2">{TELEGRAM_ALERT_WEEKDAYS.map((day) => { const active = form.weekdays.includes(day.id); return <button key={day.id} type="button" onClick={() => toggleArrayValue("weekdays", day.id)} className={`h-9 w-9 rounded-xl border text-[10px] font-black ${active ? "border-sky-500 bg-sky-500 text-white" : "border-stone-200 bg-white text-stone-400"}`}>{day.label}</button>; })}</div></div>
          <div className="rounded-2xl border border-stone-100 bg-white p-4"><p className="mb-3 text-[10px] font-black text-stone-400">檢查哪些品牌？</p><div className="space-y-2">{TELEGRAM_ALERT_BRANDS.map((brand) => { const active = form.brandIds.includes(brand.id); return <button key={brand.id} type="button" onClick={() => toggleArrayValue("brandIds", brand.id)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-[10px] font-black ${active ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-stone-100 bg-stone-50 text-stone-400"}`}><span>{brand.label}</span><span>{active ? "會檢查" : "不檢查"}</span></button>; })}</div></div>
          <div className="rounded-2xl border border-stone-100 bg-white p-4"><p className="mb-3 text-[10px] font-black text-stone-400">通知哪些群組？</p><div className="space-y-2">{[{ id: "main", label: "高階主管主群" }, { id: "manager", label: "主管群" }].map((target) => { const active = form.chatTargets.includes(target.id); return <button key={target.id} type="button" onClick={() => toggleArrayValue("chatTargets", target.id)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-[10px] font-black ${active ? "border-sky-200 bg-sky-50 text-sky-700" : "border-stone-100 bg-stone-50 text-stone-400"}`}><span>{target.label}</span><span>{active ? "會收到" : "不發送"}</span></button>; })}</div></div>
        </div>

        <label className="flex items-center justify-between gap-4 rounded-2xl border border-stone-100 bg-stone-50 p-4"><div><p className="text-xs font-black text-stone-700">沒有異常時也通知「目前正常」</p><p className="mt-1 text-[10px] font-bold text-stone-400">關閉後，沒有問題就不打擾群組。</p></div><input type="checkbox" checked={form.sendWhenClear} onChange={(event) => setForm((previous) => ({ ...previous, sendWhenClear: event.target.checked }))} className="h-5 w-5" /></label>
      </section>

      <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black text-stone-800">最近一次檢查</p><p className="mt-1 text-[11px] font-bold text-stone-400">確認提醒是否正常執行。</p></div><button type="button" onClick={() => refreshStatus()} className="rounded-xl border border-stone-200 p-2 text-stone-500"><RefreshCw size={14} className={loadingAction === "refreshStatus" ? "animate-spin" : ""} /></button></div>
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl bg-stone-50 p-4"><p className="text-[10px] font-black text-stone-400">執行結果</p><p className="mt-1 text-sm font-black text-stone-700">{TELEGRAM_ALERT_STATUS_LABELS[status?.status] || status?.status || "尚未執行"}</p><p className="mt-1 text-[10px] font-bold text-stone-400">{status?.lastSentAtText ? new Date(status.lastSentAtText).toLocaleString("zh-TW", { hour12: false }) : "尚無發送紀錄"}</p></div>
          <div className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-rose-50 p-4"><p className="text-[10px] font-black text-rose-400">需要關注</p><p className="mt-1 text-xl font-black text-rose-600">{Number(status?.operationalAlertCount ?? status?.lastManualOperationalAlertCount ?? 0)}</p></div><div className="rounded-2xl bg-amber-50 p-4"><p className="text-[10px] font-black text-amber-500">資料待補</p><p className="mt-1 text-xl font-black text-amber-600">{Number(status?.dataIssueCount ?? status?.lastManualDataIssueCount ?? 0)}</p></div></div>
          {status?.brandResults && <div className="space-y-2 rounded-2xl border border-stone-100 p-4">{Object.entries(status.brandResults).filter(([brandId]) => (status?.brandIds || form.brandIds).includes(brandId)).map(([brandId, item]) => <div key={brandId} className="flex items-center justify-between text-[11px] font-bold text-stone-600"><span>{item?.brand || getTelegramAlertBrandLabel(brandId)}</span><span className={item?.status === "error" ? "text-rose-600" : item?.status === "sent" ? "text-emerald-600" : "text-stone-400"}>{TELEGRAM_BRAND_STATUS_LABELS[item?.status] || item?.status || "尚無紀錄"}</span></div>)}</div>}
          {status?.lastError && <div className="rounded-2xl border border-rose-100 bg-rose-50 p-3 text-[11px] font-bold text-rose-600">{status.lastError}</div>}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50/70 via-white to-rose-50/30 p-5 shadow-sm xl:col-span-2">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2"><ShieldCheck size={17} className="text-amber-600" /><p className="text-sm font-black text-stone-800">登入安全即時通知</p></div>
            <p className="mt-1 text-[11px] font-bold leading-5 text-stone-400">只通知真正需要處理的登入安全事件；正常登入、新裝置自行驗證成功都不會推播。安全事件即使未開啟 Telegram，也會保留在 SaaS 登入監控。</p>
          </div>
          <button type="button" onClick={() => setSecurityAlertForm((previous) => ({ ...previous, enabled: !previous.enabled }))} disabled={!canManageSecurityAlertConfig} className={`relative h-9 w-16 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 ${securityAlertForm.enabled ? "bg-emerald-500" : "bg-stone-200"}`}><span className={`absolute top-1 h-7 w-7 rounded-full bg-white shadow transition ${securityAlertForm.enabled ? "left-8" : "left-1"}`} /></button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {TELEGRAM_SECURITY_TARGET_OPTIONS.map((target) => {
            const active = securityAlertForm.chatTargets.includes(target.id);
            return <button key={target.id} type="button" onClick={() => toggleSecurityTarget(target.id)} disabled={!canManageSecurityAlertConfig} className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${active ? "border-amber-200 bg-white text-amber-800 shadow-sm" : "border-stone-100 bg-white/70 text-stone-400"}`}><span className="block text-xs font-black">{target.label}</span><span className="mt-1 block text-[10px] font-bold">{target.hint}</span><span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[9px] font-black ${active ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-400"}`}>{active ? "安全事件會收到" : "目前不發送"}</span></button>;
          })}
        </div>

        {!canManageSecurityAlertConfig && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] font-bold leading-5 text-amber-700">
            登入安全通知屬於全品牌 Security 設定，目前帳號可查看但不可修改；只有最高管理者可從已信任裝置儲存。
          </div>
        )}
        {canManageSecurityAlertConfig && currentDeviceTrust?.status !== "trusted" && (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-[10px] font-bold leading-5 text-rose-600">
            目前裝置尚未完成信任確認。請先完成裝置確認後，再修改登入安全通知。
          </div>
        )}
        <div className="flex flex-col gap-3 rounded-2xl border border-white bg-white/80 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-[11px] font-black text-stone-700">目前狀態：{securityAlertForm.enabled ? "準備主動通知" : "只記錄、不推播"}</p><p className="mt-1 text-[10px] font-bold text-stone-400">可先選群組再開啟；儲存時 Backend 會重新驗證最高管理者、已信任裝置與 revision，避免多人同時覆寫。</p></div>
          <ActionButton onClick={requestSaveSecurityAlertConfig} disabled={isBusy || !canManageSecurityAlertConfig || currentDeviceTrust?.status !== "trusted"}>{loadingAction === "saveSecurityAlertConfig" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}儲存登入安全通知</ActionButton>
        </div>
      </section>
    </div>
  );

  const renderAlertRules = () => {
    const activeProfile = form.brandProfiles?.[activeBrandId] || createDefaultTelegramBrandProfile();
    const enabledDefinitions = TELEGRAM_ALERT_RULE_DEFINITIONS.filter((definition) => activeProfile.rules?.[definition.id]?.enabled === true);
    const disabledDefinitions = TELEGRAM_ALERT_RULE_DEFINITIONS.filter((definition) => activeProfile.rules?.[definition.id]?.enabled !== true);
    return (
      <section className="space-y-5 rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-black text-stone-800">各品牌要在什麼情況提醒？</p><p className="mt-1 text-[11px] font-bold text-stone-400">每個品牌可以使用不同條件。先選品牌，再調整數值。</p></div><div className="flex flex-wrap gap-2">{TELEGRAM_ALERT_BRANDS.filter((brand) => brand.id !== activeBrandId).map((brand) => <button key={brand.id} type="button" onClick={() => copyActiveBrandProfile(brand.id)} className="inline-flex items-center gap-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[10px] font-black text-stone-500"><Copy size={12} />套用到{brand.label}</button>)}</div></div>
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-stone-50 p-1.5">{TELEGRAM_ALERT_BRANDS.map((brand) => { const active = activeBrandId === brand.id; const included = form.brandIds.includes(brand.id); const count = Object.values(form.brandProfiles?.[brand.id]?.rules || {}).filter((rule) => rule?.enabled).length; return <button key={brand.id} type="button" onClick={() => { setActiveBrandId(brand.id); setRulePickerOpen(false); }} className={`rounded-xl px-3 py-2.5 ${active ? "bg-white text-sky-700 shadow-sm" : "text-stone-400"}`}><span className="block text-xs font-black">{brand.label}</span><span className="mt-0.5 block text-[9px] font-bold">{included ? `${count} 項提醒` : "目前未納入"}</span></button>; })}</div>
        <div className="flex flex-col gap-3 rounded-2xl border border-sky-100 bg-sky-50/50 p-4 md:flex-row md:items-center md:justify-between"><div><p className="text-xs font-black text-sky-800">{getTelegramAlertBrandLabel(activeBrandId)}目前使用 {enabledDefinitions.length} 項提醒條件</p><p className="mt-1 text-[10px] font-bold text-sky-500">最多列出幾家店，可以在右側調整。</p></div><label className="flex items-center gap-2 text-xs font-black text-stone-600">最多列出<input type="number" min="1" max="20" value={activeProfile.limit} onChange={(event) => updateBrandProfile(activeBrandId, (profile) => ({ ...profile, limit: event.target.value }))} className="w-16 rounded-xl border border-sky-100 bg-white px-2 py-2 text-center outline-none" />家</label></div>
        <div className="relative"><button type="button" onClick={() => setRulePickerOpen((previous) => !previous)} disabled={!disabledDefinitions.length} className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs font-black text-sky-700 disabled:opacity-40"><Plus size={14} />新增提醒條件</button>{rulePickerOpen && disabledDefinitions.length > 0 && <div className="absolute left-0 top-12 z-20 w-full max-w-xl rounded-2xl border border-stone-200 bg-white p-2 shadow-2xl"><p className="px-3 py-2 text-[10px] font-black text-stone-400">選擇要加入的提醒條件</p>{disabledDefinitions.map((definition) => <button key={definition.id} type="button" onClick={() => enableRule(definition.id)} className="flex w-full items-start justify-between rounded-xl px-3 py-2.5 text-left hover:bg-sky-50"><span><span className="block text-xs font-black text-stone-700">{definition.label}</span><span className="mt-0.5 block text-[10px] font-bold leading-4 text-stone-400">{definition.description}</span></span><Plus size={14} className="mt-0.5 text-sky-500" /></button>)}</div>}</div>
        {enabledDefinitions.length ? <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{enabledDefinitions.map((definition) => <TelegramRuleEditorCard key={definition.id} definition={definition} rule={activeProfile.rules[definition.id]} onChange={(nextRule) => updateBrandRule(activeBrandId, definition.id, nextRule)} onRemove={() => disableRule(definition.id)} />)}</div> : <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 p-8 text-center"><p className="text-xs font-black text-amber-700">尚未設定提醒條件</p><p className="mt-1 text-[10px] font-bold text-amber-500">請至少加入一項。</p></div>}
      </section>
    );
  };

  const renderAlertTest = () => (
    <div className="space-y-4">
      <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm"><div><p className="text-sm font-black text-stone-800">先預覽，再正式使用</p><p className="mt-1 text-[11px] font-bold text-stone-400">預覽不會發送；測試會傳到你設定的群組。</p></div><div className="mt-4 flex flex-wrap gap-2"><ActionButton onClick={previewToday} disabled={isBusy} variant="secondary">{loadingAction === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}預覽今天結果</ActionButton><ActionButton onClick={sendTest} disabled={isBusy} variant="soft">{loadingAction === "test" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}傳送測試訊息</ActionButton><ActionButton onClick={saveConfig} disabled={isBusy}>{loadingAction === "saveConfig" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}儲存主動提醒設定</ActionButton><ActionButton onClick={resetForm} disabled={isBusy} variant="secondary"><RefreshCw size={14} />恢復建議值</ActionButton></div></section>
      {previewItems.length > 0 ? <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">{previewItems.map((item, index) => <article key={item.brandId || `${item.brand}-${index}`} className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm"><div className="border-b border-sky-50 bg-sky-50/60 px-4 py-3"><p className="text-sm font-black text-stone-800">{item.brand || "品牌預覽"}</p><p className="mt-1 text-[10px] font-bold text-stone-400">需要關注 {Number(item.operationalAlertCount || 0)}｜資料待補 {Number(item.dataIssueCount || 0)}</p></div><pre className="max-h-[520px] overflow-y-auto whitespace-pre-wrap break-words p-4 font-sans text-xs font-bold leading-6 text-stone-600">{item.previewText || "目前沒有內容"}</pre></article>)}</div> : <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-10 text-center"><Eye size={24} className="mx-auto text-stone-300" /><p className="mt-2 text-xs font-black text-stone-500">尚未產生預覽</p></div>}
    </div>
  );

  const renderAlerts = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2 rounded-2xl border border-stone-100 bg-white p-1.5 shadow-sm">{[{ id: "basic", label: "基本設定" }, { id: "rules", label: "提醒條件" }, { id: "test", label: "測試與預覽" }].map((tab) => <button key={tab.id} type="button" onClick={() => setAlertSection(tab.id)} className={`rounded-xl px-3 py-2.5 text-xs font-black ${alertSection === tab.id ? "bg-sky-600 text-white shadow-sm" : "text-stone-400 hover:bg-stone-50"}`}>{tab.label}</button>)}</div>
      {alertSection === "basic" ? renderAlertBasic() : alertSection === "rules" ? renderAlertRules() : renderAlertTest()}
      {alertSection !== "test" && <div className="flex justify-end"><ActionButton onClick={saveConfig} disabled={isBusy}>{loadingAction === "saveConfig" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}儲存主動提醒設定</ActionButton></div>}
    </div>
  );

  const renderTasks = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[
        { id: "open", label: "待處理／處理中", count: Number(taskCounts.open || 0) + Number(taskCounts.in_progress || 0), activeClass: "border-amber-200 bg-amber-50" },
        { id: "overdue", label: "已逾期", count: Number(taskCounts.overdue || 0), activeClass: "border-rose-200 bg-rose-50" },
        { id: "completed", label: "已完成", count: Number(taskCounts.completed || 0), activeClass: "border-emerald-200 bg-emerald-50" },
        { id: "all", label: "全部任務", count: improvementTasks.length, activeClass: "border-sky-200 bg-sky-50" },
      ].map((item) => <button key={item.id} type="button" onClick={() => setTaskFilter(item.id)} className={`rounded-2xl border p-4 text-left ${taskFilter === item.id ? item.activeClass : "border-stone-100 bg-white"}`}><p className="text-[10px] font-black text-stone-400">{item.label}</p><p className="mt-1 text-xl font-black text-stone-700">{item.count}</p></button>)}</div>
      <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-sm font-black text-stone-800">改善任務</p><p className="mt-1 text-[11px] font-bold text-stone-400">異常提醒建立任務後，會在這裡追蹤負責人、期限與結果。</p></div><button type="button" onClick={() => refreshV5Operations()} className="rounded-xl border border-stone-200 p-2 text-stone-500"><RefreshCw size={14} className={loadingAction === "refreshV5Operations" ? "animate-spin" : ""} /></button></div>
        <div className="space-y-3">{filteredTasks.length ? filteredTasks.map((task) => { const done = task.status === "completed"; return <article key={task.id} className={`rounded-2xl border p-4 ${task.status === "overdue" ? "border-rose-200 bg-rose-50/50" : done ? "border-emerald-100 bg-emerald-50/40" : "border-amber-100 bg-amber-50/40"}`}><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-black text-stone-800">{task.title || "改善任務"}</p><span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${task.status === "overdue" ? "bg-rose-100 text-rose-700" : done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{getV5TaskStatusLabel(task.status)}</span></div><p className="mt-2 text-[11px] font-bold text-stone-500">{task.brand || ""}{task.storeName ? `｜${task.storeName}店` : ""}｜負責人：{task.ownerName || "待指派"}</p><p className="mt-1 text-[10px] font-bold text-stone-400">期限：{task.dueDate || "未設定"}{task.taskCode ? `｜${task.taskCode}` : ""}</p>{task.reason && <p className="mt-2 rounded-xl bg-white/70 p-3 text-[10px] font-bold leading-5 text-stone-500">{task.reason}</p>}</div><div className="flex shrink-0 gap-2">{!done && task.status !== "in_progress" && <button type="button" onClick={() => updateV5TaskStatus(task, "in_progress")} disabled={isBusy || !canManagePolicyCenter} className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-[10px] font-black text-sky-700">開始處理</button>}{!done && <button type="button" onClick={() => updateV5TaskStatus(task, "completed")} disabled={isBusy || !canManagePolicyCenter} className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-700">標記完成</button>}</div></div></article>; }) : <div className="rounded-2xl border border-dashed border-stone-200 p-10 text-center"><ListChecks size={26} className="mx-auto text-stone-300" /><p className="mt-2 text-xs font-black text-stone-500">這個分類目前沒有任務</p></div>}</div>
      </section>
    </div>
  );

  const renderRuleEditor = () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.15fr]">
      <section className="space-y-4 rounded-2xl border border-violet-100 bg-violet-50/30 p-5">
        <div><p className="text-sm font-black text-stone-800">新增長期規則</p><p className="mt-1 text-[11px] font-bold text-stone-400">例如永久排除店家、改變品牌提醒條件，或記住回答習慣。</p></div>
        {!canManagePolicyCenter && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold text-amber-700">目前帳號只能查看，只有 master／director 可以修改。</div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="rounded-xl border border-stone-100 bg-white p-3"><span className="mb-1 block text-[10px] font-black text-stone-400">我想設定</span><select value={policyEditor.type} onChange={(event) => setPolicyEditor((previous) => ({ ...createDefaultPolicyEditor(), type: event.target.value, ownerScope: event.target.value === "response_preference" ? "global" : "brand" }))} className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"><option value="exclude_store">哪些店家不納入</option><option value="alert_rule">品牌提醒條件例外</option><option value="response_preference">機器人的回答習慣</option></select></label>{policyEditor.type !== "response_preference" && <label className="rounded-xl border border-stone-100 bg-white p-3"><span className="mb-1 block text-[10px] font-black text-stone-400">品牌</span><select value={policyEditor.brandId} onChange={(event) => setPolicyEditor((previous) => ({ ...previous, brandId: event.target.value }))} className="w-full bg-transparent text-xs font-black text-stone-700 outline-none">{TELEGRAM_ALERT_BRANDS.map((brand) => <option key={brand.id} value={brand.id}>{brand.label}</option>)}</select></label>}</div>
        {policyEditor.type === "exclude_store" && <div className="space-y-3"><label className="block rounded-xl border border-stone-100 bg-white p-3"><span className="mb-1 block text-[10px] font-black text-stone-400">店家名稱</span><input value={policyEditor.storeName} onChange={(event) => setPolicyEditor((previous) => ({ ...previous, storeName: event.target.value }))} placeholder="例如：中美店" className="w-full bg-transparent text-xs font-black text-stone-700 outline-none" /></label><div className="rounded-xl border border-stone-100 bg-white p-3"><p className="mb-2 text-[10px] font-black text-stone-400">不納入哪些地方？</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{TELEGRAM_POLICY_SCOPES.map((scope) => { const active = policyEditor.scopes.includes(scope.id); return <button key={scope.id} type="button" onClick={() => setPolicyEditor((previous) => ({ ...previous, scopes: active ? previous.scopes.filter((item) => item !== scope.id) : [...previous.scopes, scope.id] }))} className={`rounded-xl border px-3 py-2 text-left text-[10px] font-black ${active ? "border-violet-200 bg-violet-50 text-violet-700" : "border-stone-100 bg-stone-50 text-stone-400"}`}>{scope.label}</button>; })}</div></div></div>}
        {policyEditor.type === "alert_rule" && <div className="space-y-3"><label className="block rounded-xl border border-stone-100 bg-white p-3"><span className="mb-1 block text-[10px] font-black text-stone-400">要調整的提醒</span><select value={policyEditor.ruleId} onChange={(event) => setPolicyEditor((previous) => ({ ...previous, ruleId: event.target.value }))} className="w-full bg-transparent text-xs font-black text-stone-700 outline-none">{TELEGRAM_POLICY_RULES.map((rule) => <option key={rule.id} value={rule.id}>{rule.label}</option>)}</select></label>{policyEditor.ruleId === "progressGap" ? <div className="grid grid-cols-2 gap-2"><TelegramRuleNumberField label="黃燈落後" value={policyEditor.watchThreshold} onChange={(value) => setPolicyEditor((previous) => ({ ...previous, watchThreshold: value }))} unit="百分點" /><TelegramRuleNumberField label="紅燈落後" value={policyEditor.criticalThreshold} onChange={(value) => setPolicyEditor((previous) => ({ ...previous, criticalThreshold: value }))} unit="百分點" /></div> : policyEditor.ruleId === "limit" ? <TelegramRuleNumberField label="最多顯示" value={policyEditor.limit} onChange={(value) => setPolicyEditor((previous) => ({ ...previous, limit: value }))} unit="家" max={20} /> : !["missingReport", "missingTarget"].includes(policyEditor.ruleId) ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><TelegramRuleNumberField label="提醒門檻" value={policyEditor.threshold} onChange={(value) => setPolicyEditor((previous) => ({ ...previous, threshold: value }))} unit={["cashAchievementRate", "closingRate", "skincareRatio"].includes(policyEditor.ruleId) ? "%" : policyEditor.ruleId === "traffic" ? "人次" : "人"} max={["newCustomers", "traffic"].includes(policyEditor.ruleId) ? 999999 : 100} /><TelegramRuleSeverityField value={policyEditor.severity} onChange={(value) => setPolicyEditor((previous) => ({ ...previous, severity: value }))} />{policyEditor.ruleId === "closingRate" && <TelegramRuleNumberField label="至少多少位新客才判斷" value={policyEditor.minSample} onChange={(value) => setPolicyEditor((previous) => ({ ...previous, minSample: value }))} unit="人" max={999} />}</div> : <label className="flex items-center justify-between rounded-xl border border-stone-100 bg-white p-3 text-xs font-black text-stone-700">要啟用這項提醒<input type="checkbox" checked={policyEditor.enabledValue !== false} onChange={(event) => setPolicyEditor((previous) => ({ ...previous, enabledValue: event.target.checked }))} className="h-4 w-4" /></label>}</div>}
        {policyEditor.type === "response_preference" && <div className="space-y-3"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="rounded-xl border border-stone-100 bg-white p-3"><span className="mb-1 block text-[10px] font-black text-stone-400">套用對象</span><select value={policyEditor.ownerScope} onChange={(event) => setPolicyEditor((previous) => ({ ...previous, ownerScope: event.target.value }))} className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"><option value="global">所有使用者</option><option value="user">指定使用者</option></select></label>{policyEditor.ownerScope === "user" && <label className="rounded-xl border border-stone-100 bg-white p-3"><span className="mb-1 block text-[10px] font-black text-stone-400">Telegram 使用者 ID</span><input value={policyEditor.userId} onChange={(event) => setPolicyEditor((previous) => ({ ...previous, userId: event.target.value }))} className="w-full bg-transparent text-xs font-black text-stone-700 outline-none" /></label>}</div><label className="block rounded-xl border border-stone-100 bg-white p-3"><span className="mb-1 block text-[10px] font-black text-stone-400">希望機器人怎麼回答？</span><textarea value={policyEditor.instruction} onChange={(event) => setPolicyEditor((previous) => ({ ...previous, instruction: event.target.value }))} placeholder="例如：回答時先給結論，再列出最多三項優先行動。" rows={4} className="w-full resize-none bg-transparent text-xs font-bold leading-5 text-stone-700 outline-none" /></label></div>}
        <label className="block rounded-xl border border-stone-100 bg-white p-3"><span className="block text-[10px] font-black text-stone-400">有效到哪一天？</span><div className="mt-2 flex min-h-12 min-w-0 items-center rounded-xl border border-stone-200 bg-stone-50 px-3"><input type="date" value={policyEditor.effectiveUntil} onChange={(event) => setPolicyEditor((previous) => ({ ...previous, effectiveUntil: event.target.value }))} className="block h-11 min-w-0 flex-1 bg-transparent px-1 text-sm font-black leading-none text-stone-700 outline-none" style={{ colorScheme: "light" }} /></div><span className="mt-2 block text-[9px] font-bold leading-4 text-stone-300">留空代表持續有效，直到人工停用。</span></label>
        <ActionButton onClick={savePolicy} disabled={isBusy || !canManagePolicyCenter} className="w-full">{loadingAction === "savePolicy" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}建立長期規則</ActionButton>
      </section>

      <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black text-stone-800">目前生效的規則</p><p className="mt-1 text-[11px] font-bold text-stone-400">查看哪些店家被排除、哪些條件被修改，以及回答偏好。</p></div><div className="flex gap-2"><button type="button" onClick={() => refreshPolicies()} className="rounded-xl border border-stone-200 p-2 text-stone-500"><RefreshCw size={14} className={loadingAction === "refreshPolicies" ? "animate-spin" : ""} /></button><button type="button" onClick={cleanupPolicyConflicts} disabled={isBusy || !canManagePolicyCenter} className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] font-black text-amber-600">整理重複規則</button></div></div><div className="mt-4 max-h-[660px] space-y-2 overflow-y-auto pr-1">{policies.length ? [...policies].sort((a, b) => String(b.updatedAtText || b.createdAtText || "").localeCompare(String(a.updatedAtText || a.createdAtText || ""))).map((policy) => { const active = isPolicyActiveNow(policy); const isConflict = policyConflictGroups.some((rows) => rows.some((item) => item.id === policy.id)); const brandLabel = policy.brandId ? getTelegramAlertBrandLabel(policy.brandId) : "全部品牌"; const title = policy.type === "exclude_store" ? `${brandLabel}｜排除 ${policy.storeName || policy.storeCore}店` : policy.type === "alert_rule" ? `${brandLabel}｜${TELEGRAM_POLICY_RULES.find((item) => item.id === policy.ruleId)?.label || policy.ruleId}` : `${policy.ownerScope === "user" ? `指定使用者 ${policy.userId}` : "所有使用者"}｜回答偏好`; const detail = policy.type === "exclude_store" ? (policy.scopes || []).map((scope) => TELEGRAM_POLICY_SCOPES.find((item) => item.id === scope)?.label || scope).join("、") : policy.type === "alert_rule" ? JSON.stringify(policy.value || {}) : policy.instruction; return <article key={policy.id} className={`rounded-2xl border p-4 ${isConflict ? "border-rose-200 bg-rose-50/30" : active ? "border-violet-100 bg-violet-50/20" : "border-stone-100 bg-stone-50 opacity-60"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-black text-stone-700">{title}</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${active ? "bg-emerald-50 text-emerald-600" : "bg-stone-100 text-stone-400"}`}>{active ? "生效" : "停用"}</span>{isConflict && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black text-rose-600">規則重複</span>}</div><p className="mt-2 break-words text-[10px] font-bold leading-4 text-stone-400">{detail || "未提供細節"}</p><p className="mt-1 text-[9px] font-bold text-stone-300">{policy.effectiveUntil ? `有效至 ${policy.effectiveUntil}` : "持續有效"}</p></div><button type="button" onClick={() => togglePolicyEnabled(policy)} disabled={isBusy || !canManagePolicyCenter} className={`shrink-0 rounded-xl border px-3 py-2 text-[10px] font-black ${active ? "border-rose-100 bg-rose-50 text-rose-600" : "border-emerald-100 bg-emerald-50 text-emerald-600"}`}>{loadingAction === `policy:${policy.id}` ? <Loader2 size={12} className="animate-spin" /> : active ? "停用" : "啟用"}</button></div></article>; }) : <div className="rounded-2xl border border-dashed border-stone-200 p-10 text-center text-xs font-black text-stone-400">尚未建立長期規則</div>}</div></section>
    </div>
  );

  const renderPermissions = () => (
    <section className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm"><div><p className="text-sm font-black text-stone-800">哪些人可以修改設定？</p><p className="mt-1 text-[11px] font-bold text-stone-400">新增個人名單後，未列入的人會自動改為只能查看。</p></div>{!canManagePolicyCenter && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold text-amber-700">目前帳號只能查看人員權限。</div>}<div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]"><label className="rounded-xl border border-stone-100 bg-stone-50 p-3"><span className="mb-1 block text-[10px] font-black text-stone-400">Telegram 使用者 ID</span><input value={permissionDraft.userId} onChange={(event) => setPermissionDraft((previous) => ({ ...previous, userId: event.target.value }))} className="w-full bg-transparent text-xs font-black text-stone-700 outline-none" /></label><label className="rounded-xl border border-stone-100 bg-stone-50 p-3"><span className="mb-1 block text-[10px] font-black text-stone-400">名稱</span><input value={permissionDraft.displayName} onChange={(event) => setPermissionDraft((previous) => ({ ...previous, displayName: event.target.value }))} className="w-full bg-transparent text-xs font-black text-stone-700 outline-none" /></label><label className="rounded-xl border border-stone-100 bg-stone-50 p-3"><span className="mb-1 block text-[10px] font-black text-stone-400">可以做什麼？</span><select value={permissionDraft.role} onChange={(event) => setPermissionDraft((previous) => ({ ...previous, role: event.target.value }))} className="w-full bg-transparent text-xs font-black text-stone-700 outline-none"><option value="director">管理所有品牌與設定</option><option value="brand_manager">管理指定品牌</option><option value="viewer">只能查看</option></select></label><ActionButton onClick={savePermission} disabled={isBusy || !canManagePolicyCenter} className="self-stretch lg:self-end"><UserPlus size={14} />儲存人員權限</ActionButton></div>{permissionDraft.role === "brand_manager" && <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-stone-100 bg-stone-50 p-3">{TELEGRAM_ALERT_BRANDS.map((brand) => { const active = permissionDraft.brandIds.includes(brand.id); return <button key={brand.id} type="button" onClick={() => setPermissionDraft((previous) => ({ ...previous, brandIds: active ? previous.brandIds.filter((item) => item !== brand.id) : [...previous.brandIds, brand.id] }))} className={`rounded-xl border px-3 py-2 text-[10px] font-black ${active ? "border-sky-200 bg-sky-50 text-sky-700" : "border-stone-100 bg-white text-stone-400"}`}>{brand.label}</button>; })}</div>}<div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{permissionEntries.length ? permissionEntries.map(([userId, permission]) => <article key={userId} className="flex items-center justify-between gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-4"><div><p className="text-xs font-black text-stone-700">{permission.displayName || userId}</p><p className="mt-1 text-[10px] font-bold text-stone-400">{permission.role === "director" ? "可管理全部" : permission.role === "brand_manager" ? `可管理 ${(permission.brandIds || []).map(getTelegramAlertBrandLabel).join("、") || "指定品牌"}` : "只能查看"}</p></div><button type="button" onClick={() => removePermission(userId)} disabled={isBusy || !canManagePolicyCenter} className="rounded-xl border border-rose-100 bg-rose-50 p-2 text-rose-500">{loadingAction === `permission:${userId}` ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={14} />}</button></article>) : <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 p-4 text-[10px] font-bold text-amber-700 md:col-span-2 xl:col-span-3">尚未建立個人名單。目前仍使用群組預設權限。</div>}</div></section>
  );

  const renderGovernance = () => (
    <div className="space-y-5"><div className="grid grid-cols-2 gap-2 rounded-2xl border border-stone-100 bg-white p-1.5 shadow-sm"><button type="button" onClick={() => setGovernanceTab("rules")} className={`rounded-xl px-3 py-2.5 text-xs font-black ${governanceTab === "rules" ? "bg-violet-600 text-white" : "text-stone-400"}`}>長期規則</button><button type="button" onClick={() => setGovernanceTab("permissions")} className={`rounded-xl px-3 py-2.5 text-xs font-black ${governanceTab === "permissions" ? "bg-sky-600 text-white" : "text-stone-400"}`}>人員權限</button></div>{governanceTab === "rules" ? renderRuleEditor() : renderPermissions()}</div>
  );

  const renderReportHistory = () => (
    <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black text-stone-800">每次正式發送的報表紀錄</p><p className="mt-1 text-[11px] font-bold text-stone-400">可用來確認當時的數據、資料截止時間與套用規則。</p></div><button type="button" onClick={() => refreshV5Operations()} className="rounded-xl border border-stone-200 p-2 text-stone-500"><RefreshCw size={14} className={loadingAction === "refreshV5Operations" ? "animate-spin" : ""} /></button></div><div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{reportSnapshots.length ? reportSnapshots.map((snapshot) => <article key={snapshot.id} className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black text-stone-700">{snapshot.scheduleName || snapshot.reportType || "固定報表"}</p><p className="mt-1 text-[10px] font-bold text-stone-400">{snapshot.createdAtText ? new Date(snapshot.createdAtText).toLocaleString("zh-TW", { hour12: false }) : snapshot.cutoffAtText || "時間未記錄"}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-[9px] font-black text-indigo-600">已保存</span></div><div className="mt-3 rounded-xl bg-white/80 p-3"><p className="text-[10px] font-black text-stone-400">資料計算到</p><p className="mt-1 text-[11px] font-black text-stone-700">{snapshot.cutoffAtText || snapshot.cutoffDate || "未記錄"}</p></div><details className="mt-3"><summary className="cursor-pointer text-[10px] font-black text-indigo-600">查看技術詳細資料</summary><div className="mt-2 space-y-1 rounded-xl bg-white p-3 text-[9px] font-bold text-stone-400"><p>報表編號：{snapshot.snapshotId || snapshot.id}</p><p>計算方式版本：{snapshot.metricVersion || "metric-v5.0-unified"}</p><p>套用規則：{(snapshot.policyIds || []).join("、") || "無"}</p><p>資料讀取：{Number(snapshot.readCount || 0).toLocaleString()} 筆</p></div></details></article>) : <div className="rounded-2xl border border-dashed border-stone-200 p-12 text-center md:col-span-2 xl:col-span-3"><FileText size={28} className="mx-auto text-stone-300" /><p className="mt-2 text-xs font-black text-stone-500">尚未產生正式報表紀錄</p></div>}</div></section>
  );

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-3xl border border-stone-100 bg-white p-12 text-sm font-black text-stone-400">
        <Loader2 size={18} className="animate-spin" />
        載入 Telegram 營運助手中...
      </div>
    );
  }

  return (
    <section className="rounded-[2rem] border border-sky-100 bg-gradient-to-br from-sky-50/70 via-white to-indigo-50/40 p-5 shadow-[0_18px_60px_rgba(40,110,160,0.07)] sm:p-6">
      <div className="mb-5 flex flex-col gap-3 border-b border-sky-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-sky-100 bg-white p-3 text-sky-600 shadow-sm"><HeaderIcon size={20} /></div>
          <div><p className="text-[10px] font-black tracking-[0.14em] text-sky-500">{meta.eyebrow}</p><h3 className="mt-1 text-xl font-black text-stone-800">{meta.title}</h3><p className="mt-1 max-w-3xl text-xs font-bold leading-5 text-stone-400">{meta.description}</p></div>
        </div>
        {view === "alerts" && <span className={`rounded-full border px-3 py-1.5 text-[10px] font-black ${form.enabled ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-stone-200 bg-stone-50 text-stone-500"}`}>{form.enabled ? "主動提醒使用中" : "主動提醒已停用"}</span>}
      </div>
      {lastMessage && <div className="mb-5 flex items-center gap-2 rounded-2xl border border-sky-100 bg-white/80 px-4 py-3 text-xs font-bold text-stone-600"><Activity size={14} className="text-sky-500" />{lastMessage}</div>}
      {view === "overview" ? renderOverview() : view === "tasks" ? renderTasks() : view === "governance" ? renderGovernance() : view === "reportHistory" ? renderReportHistory() : renderAlerts()}
      {securityCredentialOpen && (
        <div className="fixed inset-0 z-[99990] flex items-center justify-center bg-stone-900/35 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-3xl border border-amber-100 bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-amber-50 p-3 text-amber-600"><ShieldCheck size={20} /></div>
              <div>
                <h4 className="text-base font-black text-stone-800">確認修改登入安全通知</h4>
                <p className="mt-1 text-[11px] font-bold leading-5 text-stone-400">這是全品牌 Security 設定。Backend 會重新確認目前帳號、已信任裝置與最高管理者權限；密碼不會寫入 Firestore 或瀏覽器儲存空間。</p>
              </div>
            </div>
            <label className="mt-5 block">
              <span className="mb-2 block text-xs font-black text-stone-500">最高管理者密碼</span>
              <input
                autoFocus
                type="password"
                autoComplete="current-password"
                value={securityCredentialPassword}
                onChange={(event) => setSecurityCredentialPassword(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && loadingAction !== "saveSecurityAlertConfig") confirmSaveSecurityAlertConfig(); }}
                placeholder="輸入目前最高管理者密碼"
                className="w-full rounded-xl border-2 border-amber-100 bg-amber-50/30 px-4 py-3 text-sm font-bold text-stone-700 outline-none focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-50"
              />
            </label>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => { setSecurityCredentialOpen(false); setSecurityCredentialPassword(""); }} disabled={loadingAction === "saveSecurityAlertConfig"} className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-black text-stone-500 disabled:opacity-40">取消</button>
              <button type="button" onClick={confirmSaveSecurityAlertConfig} disabled={!securityCredentialPassword.trim() || loadingAction === "saveSecurityAlertConfig"} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-100 via-amber-200 to-orange-100 px-4 py-3 text-sm font-black text-amber-900 shadow-sm disabled:opacity-40">
                {loadingAction === "saveSecurityAlertConfig" ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                {loadingAction === "saveSecurityAlertConfig" ? "驗證並儲存中…" : "確認並儲存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default TelegramAlertControlCenter;
