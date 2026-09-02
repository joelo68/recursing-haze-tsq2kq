const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const axios = require("axios");
const functions = require("firebase-functions/v1"); 
const admin = require("firebase-admin");
const { createTelegramAgentPrompts } = require("./telegram/prompts");
const {
  isValidNumericStatus,
  isTelegramFormalPreSystemMonth,
  inspectTelegramFormalSummaryTrust,
  buildTelegramFormalMetricsFromCanonical,
  buildTelegramFormalRawMetrics,
  buildTelegramFormalSummaryMetrics,
  aggregateTelegramFormalRows,
} = require("./telegram/formalKpi");
const {
  resolveTargetAuthorityConflict,
} = require("./targetAuthorityConflict");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ==========================================
// ★ Device Approval v1：新裝置確認與裝置管理後端
// UI 使用貼近日常工作的中文；內部仍保留清楚的 security schema。
// ==========================================
const { createDeviceApprovalFunctions } = require("./deviceApproval");
const deviceApprovalFunctions = createDeviceApprovalFunctions({ admin, db });
exports.checkDeviceAccess = deviceApprovalFunctions.checkDeviceAccess;
exports.reviewDeviceApproval = deviceApprovalFunctions.reviewDeviceApproval;
exports.manageAccountDevice = deviceApprovalFunctions.manageAccountDevice;
exports.emergencyUnblockDevice = deviceApprovalFunctions.emergencyUnblockDevice;
exports.cleanupExpiredDeviceApprovals = deviceApprovalFunctions.cleanupExpiredDeviceApprovals;
exports.reportLoginSecurityEvent = deviceApprovalFunctions.reportLoginSecurityEvent;
exports.updateTelegramSecurityAlertConfig = deviceApprovalFunctions.updateTelegramSecurityAlertConfig;

// ==========================================
// ★ Store Lifecycle v1：門市生命週期 Master administrative writer
// 僅建立上游 authority；Batch 1 不切換 Dashboard / Ranking / Annual / Telegram consumer。
// ==========================================
const {
  createStoreLifecycleFunctions,
  REPORTING_COMPLETENESS_SCHEMA_VERSION,
  getLifecycleEligibleStoreEntries,
  buildLifecycleReportingCompleteness,
} = require("./storeLifecycle");
const storeLifecycleFunctions = createStoreLifecycleFunctions({ admin, db });
exports.manageStoreLifecycle = storeLifecycleFunctions.manageStoreLifecycle;


// ==========================================
// ★ Target Coverage v1：Target Summary event-driven authority
// monthly_targets → monthly_targets_summary，並由 Store Lifecycle READY cohort 獨立計算 cash/accrual coverage。
// 不新增 Dashboard listener、不 polling、不在每次 target write 掃完整 monthly_targets collection。
// ==========================================
const { createTargetCoverageFunctions } = require("./targetCoverage");
const targetCoverageFunctions = createTargetCoverageFunctions({ admin, db });
exports.onLegacyMonthlyTargetChange = targetCoverageFunctions.onLegacyMonthlyTargetChange;
exports.onBrandMonthlyTargetChange = targetCoverageFunctions.onBrandMonthlyTargetChange;
exports.onLegacyMonthlyTargetSummaryChange = targetCoverageFunctions.onLegacyMonthlyTargetSummaryChange;
exports.onBrandMonthlyTargetSummaryChange = targetCoverageFunctions.onBrandMonthlyTargetSummaryChange;
exports.onLegacyStoreLifecycleCoverageChange = targetCoverageFunctions.onLegacyStoreLifecycleCoverageChange;
exports.onBrandStoreLifecycleCoverageChange = targetCoverageFunctions.onBrandStoreLifecycleCoverageChange;

// ==========================================
// ★ Pre-Batch-5：Historical Target Coverage Read-only Audit
// 只讀 monthly_targets_summary + store_lifecycle，分類歷史月份 migration readiness。
// 不掃 Raw monthly_targets、不寫資料、不新增 polling / listener。
// ==========================================
const { createTargetCoverageAuditFunctions } = require("./targetCoverageAudit");
const targetCoverageAuditFunctions = createTargetCoverageAuditFunctions({ admin, db });
exports.auditHistoricalTargetCoverage = targetCoverageAuditFunctions.auditHistoricalTargetCoverage;

// ==========================================
// ★ Batch 5E-0 / 5E-0.5：Production Explicit Zero Target + Lifecycle Read-only Audit
// 只查 monthly_targets 中 cashTarget / accrualTarget == 0 的 index 命中文件，
// 再 point-read 受影響月份 Summary 與單一 store_lifecycle/master；0 writes、無 polling、無 collection-wide Raw scan。
// ==========================================
const { createZeroTargetInventoryFunctions } = require("./zeroTargetInventory");
const zeroTargetInventoryFunctions = createZeroTargetInventoryFunctions({ admin, db });
exports.auditExplicitZeroTargets = zeroTargetInventoryFunctions.auditExplicitZeroTargets;

// ==========================================
// ★ Pre-Batch-5 Phase B：Historical Target Coverage metadata-only migration
// 僅對 Phase A 重新驗證仍安全的歷史月份，以單品牌 atomic transaction 補 Coverage metadata。
// 不掃 Raw monthly_targets、不改 legacy target map / totals / counts。
// ==========================================
const { createTargetCoverageMigrationFunctions } = require("./targetCoverageMigration");
const targetCoverageMigrationFunctions = createTargetCoverageMigrationFunctions({ admin, db });
exports.migrateHistoricalTargetCoverageMetadata = targetCoverageMigrationFunctions.migrateHistoricalTargetCoverageMetadata;


// ==========================================
// ★ Summary Semantics v1：Batch 4 additive semantic contract
// 只新增 explicit formal fields / coverage snapshot / formal ranking；舊 Summary 欄位暫時保留給 Batch 5 前 consumer。
// ==========================================
const {
  SUMMARY_SEMANTIC_VERSION,
  aggregateFormalMetrics,
  extractTargetCoverageMetadata,
  buildSummaryTargetAuthoritySnapshot,
  buildScopeFormalAchievement,
  buildFormalStoreRanking,
  buildSummaryStoreSemanticSignature,
  buildFormalRankingSignature,
} = require("./summarySemantics");
const {
  THERAPIST_KPI_SEMANTIC_VERSION,
  applyTherapistRankingSemantics,
  buildTherapistAggregateMetrics,
  buildTherapistSummarySignature,
} = require("./therapistKpi");


const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const TELEGRAM_BOT_TOKEN_SECRET = defineSecret('TELEGRAM_BOT_TOKEN');

// ==========================================
// ★ Device Location v1：登入位置粗略判斷
// 目的：以後端 request IP 進行粗略定位，供裝置安全判斷使用。
// 注意：IP 定位可能因 VPN、行動網路、電信機房而失準；不使用 GPS，不儲存完整 IP。
// ==========================================
function getRequestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const cfIp = String(req.headers["cf-connecting-ip"] || "").trim();
  const fastlyIp = String(req.headers["fastly-client-ip"] || "").trim();
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  const rawIp = forwarded || cfIp || fastlyIp || realIp || req.ip || req.socket?.remoteAddress || "";
  return String(rawIp || "").replace(/^::ffff:/, "").trim();
}

function isPrivateOrLocalIp(ip = "") {
  const text = String(ip || "").trim();
  return (
    !text ||
    text === "::1" ||
    text === "127.0.0.1" ||
    text.startsWith("10.") ||
    text.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(text)
  );
}

function maskIp(ip = "") {
  const text = String(ip || "").trim();
  if (!text) return "";
  if (text.includes(":")) {
    const parts = text.split(":").filter(Boolean);
    return parts.length ? `${parts[0]}:${parts[1] || "****"}:****` : "";
  }
  const parts = text.split(".");
  if (parts.length !== 4) return "";
  return `${parts[0]}.***.***.${parts[3]}`;
}

function normalizeTaiwanLocationName(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const map = {
    "Taiwan": "台灣",
    "Taiwan, Province of China": "台灣",
    "Taipei": "台北市",
    "Taipei City": "台北市",
    "New Taipei": "新北市",
    "New Taipei City": "新北市",
    "Taoyuan": "桃園市",
    "Taoyuan City": "桃園市",
    "Taichung": "台中市",
    "Taichung City": "台中市",
    "Tainan": "台南市",
    "Tainan City": "台南市",
    "Kaohsiung": "高雄市",
    "Kaohsiung City": "高雄市",
    "Keelung": "基隆市",
    "Hsinchu": "新竹市",
    "Hsinchu City": "新竹市",
    "Hsinchu County": "新竹縣",
    "Miaoli": "苗栗縣",
    "Miaoli County": "苗栗縣",
    "Changhua": "彰化縣",
    "Changhua County": "彰化縣",
    "Nantou": "南投縣",
    "Nantou County": "南投縣",
    "Yunlin": "雲林縣",
    "Yunlin County": "雲林縣",
    "Chiayi": "嘉義市",
    "Chiayi City": "嘉義市",
    "Chiayi County": "嘉義縣",
    "Pingtung": "屏東縣",
    "Pingtung County": "屏東縣",
    "Yilan": "宜蘭縣",
    "Yilan County": "宜蘭縣",
    "Hualien": "花蓮縣",
    "Hualien County": "花蓮縣",
    "Taitung": "台東縣",
    "Taitung County": "台東縣",
    "Penghu": "澎湖縣",
    "Penghu County": "澎湖縣",
    "Kinmen": "金門縣",
    "Kinmen County": "金門縣",
    "Lienchiang": "連江縣",
    "Lienchiang County": "連江縣",
    "Zhongzheng District": "中正區",
    "Datong District": "大同區",
    "Zhongshan District": "中山區",
    "Songshan District": "松山區",
    "Daan District": "大安區",
    "Da’an District": "大安區",
    "Wanhua District": "萬華區",
    "Xinyi District": "信義區",
    "Shilin District": "士林區",
    "Beitou District": "北投區",
    "Neihu District": "內湖區",
    "Nangang District": "南港區",
    "Wenshan District": "文山區",
  };

  return map[raw] || raw
    .replace("Taipei County", "新北市")
    .replace("Taipei", "台北市")
    .replace("Taiwan", "台灣");
}

function buildLoginLocation(raw = {}, ip = "") {
  const countryName = normalizeTaiwanLocationName(raw.country || raw.countryName || "");
  const regionName = normalizeTaiwanLocationName(raw.regionName || raw.region || "");
  const city = normalizeTaiwanLocationName(raw.city || "");
  const district = normalizeTaiwanLocationName(raw.district || raw.subdivision || raw.suburb || "");

  const displayParts = [];
  if (countryName) displayParts.push(countryName);
  const cityText = city || regionName;
  if (cityText && cityText !== countryName) displayParts.push(cityText);
  if (district && district !== cityText && district !== regionName) displayParts.push(district);

  const display = displayParts.length ? displayParts.join("・") : "未知位置";

  return {
    display,
    countryCode: raw.countryCode || raw.country_code || "",
    countryName: countryName || "",
    region: regionName || "",
    city: cityText || "",
    district: district || "",
    timezone: raw.timezone || "",
    isp: raw.isp || raw.org || "",
    ipMasked: maskIp(ip),
    source: display === "未知位置" ? "unknown" : "ip_geolocation",
    confidence: district ? "medium" : (cityText ? "low" : "unknown"),
    isProxy: Boolean(raw.proxy || raw.hosting),
    isMobileNetwork: Boolean(raw.mobile),
    updatedAtText: new Date().toISOString(),
  };
}

exports.resolveLoginLocation = onRequest({ cors: true, timeoutSeconds: 10 }, async (req, res) => {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }

  res.set("Access-Control-Allow-Origin", "*");

  const ip = getRequestIp(req);
  if (isPrivateOrLocalIp(ip)) {
    return res.status(200).json({
      ok: true,
      location: {
        display: "未知位置",
        source: "unknown",
        confidence: "unknown",
        ipMasked: maskIp(ip),
        updatedAtText: new Date().toISOString(),
      },
      reason: "private_or_local_ip",
    });
  }

  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city,district,timezone,isp,org,mobile,proxy,hosting,query`;
    const response = await axios.get(url, { timeout: 3000 });
    const data = response.data || {};

    if (data.status && data.status !== "success") {
      return res.status(200).json({
        ok: true,
        location: {
          display: "未知位置",
          source: "unknown",
          confidence: "unknown",
          ipMasked: maskIp(ip),
          updatedAtText: new Date().toISOString(),
        },
        reason: data.message || "ip_geolocation_failed",
      });
    }

    return res.status(200).json({
      ok: true,
      location: buildLoginLocation(data, ip),
    });
  } catch (error) {
    console.warn("resolveLoginLocation failed", error.message);
    return res.status(200).json({
      ok: true,
      location: {
        display: "未知位置",
        source: "unknown",
        confidence: "unknown",
        ipMasked: maskIp(ip),
        updatedAtText: new Date().toISOString(),
      },
      reason: "lookup_error",
    });
  }
});


// ==========================================
// ★ 0.5 Summary 後端保底：歷史日報異動後自動標記 dirty
// 目的：避免歷史月份明細已被改動，但 dashboard_summary / therapist_summary / rankings_summary 仍維持 verified，導致自動修復略過。
// ==========================================
const SUMMARY_DIRTY_DEBOUNCE_MINUTES = 1;

function getBackendDirtyBrandId(rawBrandId) {
  const id = String(rawBrandId || "").trim();
  if (!id || id === "default-app-id" || id === "default") return "cyj";
  return id;
}

function getYearMonthFromReportDate(value) {
  const dateText = String(value || "").replace(/\//g, "-").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(dateText) ? dateText.slice(0, 7) : "";
}

function getDirtyQueueOperation(change) {
  if (!change.before.exists && change.after.exists) return "create";
  if (change.before.exists && !change.after.exists) return "delete";
  return "update";
}

function hasMeaningfulReportChange(beforeData = {}, afterData = {}, fields = []) {
  if (!beforeData || !afterData) return true;
  return fields.some((field) => {
    const beforeValue = beforeData[field];
    const afterValue = afterData[field];
    return JSON.stringify(beforeValue ?? null) !== JSON.stringify(afterValue ?? null);
  });
}

function getSummaryDirtyRebuildAfterText() {
  return new Date(Date.now() + SUMMARY_DIRTY_DEBOUNCE_MINUTES * 60 * 1000).toISOString();
}

async function markSummaryDirtyFromDailyWrite(change, context, options = {}) {
  const beforeData = change.before.exists ? (change.before.data() || {}) : {};
  const afterData = change.after.exists ? (change.after.data() || {}) : {};
  const operation = getDirtyQueueOperation(change);

  const {
    brandId: rawBrandId,
    reportId,
    sourceCollection,
    sourceType,
    watchedFields,
  } = options;

  if (!hasMeaningfulReportChange(beforeData, afterData, watchedFields || [])) {
    return null;
  }

  const brandId = getBackendDirtyBrandId(rawBrandId);
  const sourceReportId = String(reportId || context?.params?.reportId || change.after.id || change.before.id || "unknown").replace(/[\/#?\[\]]/g, "_");

  const affectedMonths = new Set();
  const beforeYearMonth = getYearMonthFromReportDate(beforeData.date);
  const afterYearMonth = getYearMonthFromReportDate(afterData.date);
  if (beforeYearMonth) affectedMonths.add(beforeYearMonth);
  if (afterYearMonth) affectedMonths.add(afterYearMonth);

  if (!affectedMonths.size) return null;

  const nowText = new Date().toISOString();
  const rebuildAfterAtText = getSummaryDirtyRebuildAfterText();

  // 資料正確性保護：flag 與 queue 必須同批提交。
  // 過去使用兩個獨立 Promise，極少數網路／服務異常時可能只成功其中一筆；
  // 改成 Firestore WriteBatch 後，要嘛一起成功，要嘛一起失敗，避免只留 queue 或只留 dirty flag。
  const batch = db.batch();
  let writeCount = 0;

  affectedMonths.forEach((yearMonth) => {
    // Summary 自動修復只處理歷史月份；當月仍由前端即時明細讀取，不寫 dirty，避免每日日報造成不必要重建。
    if (typeof isHistoricalYearMonthForAutoRepair === "function" && !isHistoricalYearMonthForAutoRepair(yearMonth)) {
      return;
    }

    const flagRef = getSummaryCollection(brandId, "summary_recalc_flags").doc(yearMonth);
    const queueId = `${sourceType || sourceCollection || "daily_report"}_${yearMonth}_${sourceReportId}`;
    const queueRef = getSummaryCollection(brandId, "recalc_queue").doc(queueId);

    const displayStoreName = afterData.storeName || beforeData.storeName || "";
    const displayTherapistName = afterData.therapistName || beforeData.therapistName || "";
    const sourceDate = afterData.date || beforeData.date || "";

    batch.set(flagRef, {
      brandId,
      yearMonth,
      affectedYearMonth: yearMonth,
      status: "dirty",
      dirtyReason: "backend_daily_report_changed",
      dirtySources: admin.firestore.FieldValue.arrayUnion(sourceCollection || "daily_reports"),
      pendingCount: admin.firestore.FieldValue.increment(1),
      lastDirtyAt: admin.firestore.FieldValue.serverTimestamp(),
      lastDirtyAtText: nowText,
      rebuildAfterAtText,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: nowText,
      updatedBy: "backend_onwrite_guard",
      updatedByRole: "system",
    }, { merge: true });
    writeCount += 1;

    batch.set(queueRef, {
      id: queueId,
      brandId,
      yearMonth,
      affectedYearMonth: yearMonth,
      status: "pending",
      source: sourceCollection || "daily_reports",
      sourceType: sourceType || sourceCollection || "daily_report",
      sourceReportId,
      sourceDate,
      operation,
      storeName: displayStoreName,
      therapistName: displayTherapistName,
      reason: "backend_daily_report_changed",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtText: nowText,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: nowText,
      createdBy: "backend_onwrite_guard",
      createdByRole: "system",
    }, { merge: true });
    writeCount += 1;
  });

  return writeCount > 0 ? batch.commit() : null;
}

const STORE_DAILY_REPORT_DIRTY_FIELDS = [
  "date",
  "storeName",
  "cash",
  "refund",
  "accrual",
  "operationalAccrual",
  "traffic",
  "skincareSales",
  "skincareRefund",
  "newCustomers",
  "newCustomerClosings",
  "newCustomerSales",
  "newCustomerRevenue",
  "oldCustomerRevenue",
  "oldCustomerCount",
];

const THERAPIST_DAILY_REPORT_DIRTY_FIELDS = [
  "date",
  "therapistId",
  "therapistName",
  "storeName",
  "totalRevenue",
  "cash",
  "serviceCount",
  "newCustomerRevenue",
  "oldCustomerRevenue",
  "newCustomerCount",
  "oldCustomerCount",
  "newCustomerClosings",
  "returnRevenue",
  "traffic",
  "customerCount",
];


// ==========================================
// ★ 1. 核心資料結算邏輯 (店鋪日報)
// ==========================================
// CYJ「新店」是正式地名；歷史上曾同時出現 CYJ新店 / CYJ新店店。
// 只針對這個已驗證案例做 canonical guard，避免再產生兩個 monthly_aggregated bucket。
// 其他品牌、其他店名完全維持既有 key 行為，縮小風險。
function getMonthlyAggregationCanonicalStoreName(rawStoreName = "", basePath = "") {
  const raw = String(rawStoreName || "").trim();
  if (!raw) return "";
  const isCyjPath =
    String(basePath || "").includes("artifacts/default-app-id/public/data/monthly_aggregated") ||
    /brands\/(cyj|default-app-id)\/monthly_aggregated/i.test(String(basePath || ""));
  if (!isCyjPath) return raw;
  return normalizeSummaryCoreName(raw) === "新店" ? "CYJ新店店" : raw;
}

async function updateMonthlyAggregation(change, basePath) {
  const beforeData = change.before.data() || {};
  const afterData = change.after.data() || {};
  const rawStoreName = afterData.storeName || beforeData.storeName;
  const date = afterData.date || beforeData.date;
  if (!rawStoreName || !date) return null;
  const storeName = getMonthlyAggregationCanonicalStoreName(rawStoreName, basePath);
  const yearMonth = date.substring(0, 7); 
  const year = date.substring(0, 4);      
  const key = `${yearMonth}_${storeName}`;
  
  const diff = {
    cash: (Number(afterData.cash) || 0) - (Number(beforeData.cash) || 0),
    refund: (Number(afterData.refund) || 0) - (Number(beforeData.refund) || 0),
    accrual: (Number(afterData.accrual) || 0) - (Number(beforeData.accrual) || 0),
    operationalAccrual: (Number(afterData.operationalAccrual) || 0) - (Number(beforeData.operationalAccrual) || 0),
    traffic: (Number(afterData.traffic) || 0) - (Number(beforeData.traffic) || 0),
    skincareSales: (Number(afterData.skincareSales) || 0) - (Number(beforeData.skincareSales) || 0),
    skincareRefund: (Number(afterData.skincareRefund) || 0) - (Number(beforeData.skincareRefund) || 0),
    newCustomers: (Number(afterData.newCustomers) || 0) - (Number(beforeData.newCustomers) || 0),
    newCustomerClosings: (Number(afterData.newCustomerClosings) || 0) - (Number(beforeData.newCustomerClosings) || 0),
    newCustomerSales: (Number(afterData.newCustomerSales) || 0) - (Number(beforeData.newCustomerSales) || 0)
  };
  
  const aggRef = db.collection(basePath).doc(key);
  const updates = { id: key, yearMonth, year, storeName };
  let hasChanges = false;
  for (const [field, val] of Object.entries(diff)) {
    if (val !== 0) { updates[field] = admin.firestore.FieldValue.increment(val); hasChanges = true; }
  }
  return hasChanges ? aggRef.set(updates, { merge: true }) : null;
}
exports.aggregateLegacyReports = functions.firestore.document("artifacts/{appId}/public/data/daily_reports/{reportId}").onWrite(async (change, context) => Promise.all([
  updateMonthlyAggregation(change, `artifacts/${context.params.appId}/public/data/monthly_aggregated`),
  markSummaryDirtyFromDailyWrite(change, context, {
    brandId: getBackendDirtyBrandId(context.params.appId),
    reportId: context.params.reportId,
    sourceCollection: "daily_reports",
    sourceType: "store_daily_report",
    watchedFields: STORE_DAILY_REPORT_DIRTY_FIELDS,
  }),
]));
exports.aggregateBrandReports = functions.firestore.document("brands/{brandId}/daily_reports/{reportId}").onWrite(async (change, context) => Promise.all([
  updateMonthlyAggregation(change, `brands/${context.params.brandId}/monthly_aggregated`),
  markSummaryDirtyFromDailyWrite(change, context, {
    brandId: context.params.brandId,
    reportId: context.params.reportId,
    sourceCollection: "daily_reports",
    sourceType: "store_daily_report",
    watchedFields: STORE_DAILY_REPORT_DIRTY_FIELDS,
  }),
]));

// ==========================================
// ★ 1.5 核心資料結算邏輯 (管理師日報)
// ==========================================
async function updateTherapistMonthlyAggregation(change, basePath) {
  const beforeData = change.before.data() || {};
  const afterData = change.after.data() || {};
  const therapistId = afterData.therapistId || beforeData.therapistId;
  const date = afterData.date || beforeData.date;
  
  if (!therapistId || !date) return null;
  const yearMonth = date.substring(0, 7); 
  const year = date.substring(0, 4);      
  const key = `${yearMonth}_${therapistId}`;
  
  const diff = {
    totalRevenue: (Number(afterData.totalRevenue) || 0) - (Number(beforeData.totalRevenue) || 0),
    serviceCount: (Number(afterData.serviceCount) || 0) - (Number(beforeData.serviceCount) || 0),
    newCustomerRevenue: (Number(afterData.newCustomerRevenue) || 0) - (Number(beforeData.newCustomerRevenue) || 0),
    oldCustomerRevenue: (Number(afterData.oldCustomerRevenue) || 0) - (Number(beforeData.oldCustomerRevenue) || 0),
    newCustomerCount: (Number(afterData.newCustomerCount) || 0) - (Number(beforeData.newCustomerCount) || 0),
    oldCustomerCount: (Number(afterData.oldCustomerCount) || 0) - (Number(beforeData.oldCustomerCount) || 0),
    newCustomerClosings: (Number(afterData.newCustomerClosings) || 0) - (Number(beforeData.newCustomerClosings) || 0),
    returnRevenue: (Number(afterData.returnRevenue) || 0) - (Number(beforeData.returnRevenue) || 0),
  };

  const aggRef = db.collection(basePath).doc(key);
  const updates = { id: key, yearMonth, year, therapistId, therapistName: afterData.therapistName || beforeData.therapistName || "", storeName: afterData.storeName || beforeData.storeName || "" };
  let hasChanges = false;
  for (const [field, val] of Object.entries(diff)) {
    if (val !== 0) { updates[field] = admin.firestore.FieldValue.increment(val); hasChanges = true; }
  }
  return hasChanges ? aggRef.set(updates, { merge: true }) : null;
}
exports.aggregateLegacyTherapistReports = functions.firestore.document("artifacts/{appId}/public/data/therapist_daily_reports/{reportId}").onWrite(async (change, context) => Promise.all([
  updateTherapistMonthlyAggregation(change, `artifacts/${context.params.appId}/public/data/therapist_monthly_aggregated`),
  markSummaryDirtyFromDailyWrite(change, context, {
    brandId: getBackendDirtyBrandId(context.params.appId),
    reportId: context.params.reportId,
    sourceCollection: "therapist_daily_reports",
    sourceType: "therapist_daily_report",
    watchedFields: THERAPIST_DAILY_REPORT_DIRTY_FIELDS,
  }),
]));
exports.aggregateBrandTherapistReports = functions.firestore.document("brands/{brandId}/therapist_daily_reports/{reportId}").onWrite(async (change, context) => Promise.all([
  updateTherapistMonthlyAggregation(change, `brands/${context.params.brandId}/therapist_monthly_aggregated`),
  markSummaryDirtyFromDailyWrite(change, context, {
    brandId: context.params.brandId,
    reportId: context.params.reportId,
    sourceCollection: "therapist_daily_reports",
    sourceType: "therapist_daily_report",
    watchedFields: THERAPIST_DAILY_REPORT_DIRTY_FIELDS,
  }),
]));

// ==========================================
// ★ Telegram 設定（Secret Manager + 聊天室白名單）
// ==========================================
const TARGET_CHAT_ID_MAIN = '-4991191955';
const TARGET_CHAT_ID_MANAGER = '-1002361008620';
const TARGET_CHAT_ID_AGENT_TEST = '-5241604208';
const TELEGRAM_BOT_USERNAME = 'DRCYJBot';
const BRANDS = [{ id: 'cyj', name: 'CYJ' }, { id: 'anniu', name: '安妞' }, { id: 'yibo', name: '伊啵' }];
const TELEGRAM_ALLOWED_CHAT_IDS = new Set([
    TARGET_CHAT_ID_MAIN,
    TARGET_CHAT_ID_MANAGER,
    TARGET_CHAT_ID_AGENT_TEST,
]);

function getTelegramBotToken() {
    const token = String(TELEGRAM_BOT_TOKEN_SECRET.value() || '').trim();
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN 尚未設定');
    return token;
}

function getTelegramApiUrl(method = 'sendMessage') {
    return `https://api.telegram.org/bot${getTelegramBotToken()}/${method}`;
}

function isTelegramChatAuthorized(chatId) {
    return TELEGRAM_ALLOWED_CHAT_IDS.has(String(chatId || "").trim());
}

function normalizeTelegramIncomingText(rawText = "") {
    const text = String(rawText || "").trim();
    if (!text) return "";
    const escapedUsername = TELEGRAM_BOT_USERNAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text
        .replace(new RegExp(`^@${escapedUsername}(?:\\s+|[,，:：]?\\s*)`, "i"), "")
        .trim();
}

function getTelegramChatDebugMeta(message = {}) {
    return {
        chatId: String(message?.chat?.id || ""),
        chatType: String(message?.chat?.type || ""),
        chatTitle: String(message?.chat?.title || ""),
        migrateToChatId: message?.migrate_to_chat_id ? String(message.migrate_to_chat_id) : "",
        migrateFromChatId: message?.migrate_from_chat_id ? String(message.migrate_from_chat_id) : "",
    };
}

async function sendTelegramMessage(chatId, text, extra = {}) {
    return axios.post(getTelegramApiUrl('sendMessage'), {
        chat_id: String(chatId),
        text: String(text || ''),
        ...extra,
    });
}


// ==========================================
// ★ Login Security Telegram Alert v1
// 安全事件與營運預警分流：預設關閉、預設不指定群組。
// 先保存 security_alerts，只有管理者在 SaaS 選定 Telegram 群組後才主動推播。
// ==========================================
const TELEGRAM_SECURITY_TARGETS = Object.freeze({
    main: { chatId: TARGET_CHAT_ID_MAIN, label: '高階主管主群' },
    manager: { chatId: TARGET_CHAT_ID_MANAGER, label: '主管群' },
    agent_test: { chatId: TARGET_CHAT_ID_AGENT_TEST, label: 'Agent 測試群' },
});
const TELEGRAM_SECURITY_CONFIG_REF = db
    .collection('artifacts').doc('default-app-id')
    .collection('public').doc('data')
    .collection('global_settings').doc('telegram_security_alerts');

function normalizeTelegramSecurityConfig(raw = {}) {
    const chatTargets = [...new Set((Array.isArray(raw.chatTargets) ? raw.chatTargets : [])
        .map(String)
        .filter((target) => Object.prototype.hasOwnProperty.call(TELEGRAM_SECURITY_TARGETS, target)))];
    return {
        enabled: raw.enabled === true,
        chatTargets,
        configVersion: String(raw.configVersion || 'security-alert-v1'),
        updatedAtText: String(raw.updatedAtText || ''),
    };
}

function resolveTelegramSecurityChatIds(config = {}) {
    return [...new Set((config.chatTargets || [])
        .map((target) => TELEGRAM_SECURITY_TARGETS[target]?.chatId || '')
        .filter((chatId) => chatId && isTelegramChatAuthorized(chatId)))];
}

function getLoginSecurityEventLabel(type = '') {
    return ({
        password_failed_threshold: '密碼重複輸入錯誤',
        device_code_failed_limit: '6 位裝置確認失敗',
        manager_assistance_required: '裝置需要最高管理者協助',
        self_reported_not_me: '使用者回報非本人裝置',
        rapid_multi_location_login: '疑似異地短時間登入',
        blocked_device_login: '已停用裝置再次嘗試登入',
    })[String(type || '')] || '登入安全事件';
}

function getSecuritySeverityIcon(severity = '') {
    if (String(severity) === 'critical') return '🚨';
    if (String(severity) === 'high') return '🔴';
    return '🟠';
}

function formatTelegramSecurityLocation(raw = {}) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return String(value.display || [value.countryName, value.region, value.city].filter(Boolean).join('・') || '未知位置').trim();
}

function buildTelegramSecurityAlertMessage(data = {}) {
    const type = String(data.telegramSecurityType || data.type || '');
    const lines = [
        `${getSecuritySeverityIcon(data.severity)} SaaS 登入安全提醒`,
        '',
        `事件：${getLoginSecurityEventLabel(type)}`,
        `品牌：${String(data.brandLabel || data.brandId || '-').trim()}`,
        `帳號：${String(data.userName || data.accountId || '-').trim()}${data.role ? `（${String(data.role)}）` : ''}`,
    ];

    const deviceText = [data.device, data.browser, data.os].map((item) => String(item || '').trim()).filter(Boolean).join(' / ');
    if (deviceText) lines.push(`裝置：${deviceText}`);
    if (data.deviceShort) lines.push(`裝置碼：${String(data.deviceShort)}`);
    lines.push(`位置：${formatTelegramSecurityLocation(data.loginLocation)}`);

    if (type === 'password_failed_threshold') {
        lines.push(`狀況：${Number(data.failedCount || 0)} 次錯誤密碼／${Number(data.windowMinutes || 10)} 分鐘`);
    } else if (type === 'device_code_failed_limit') {
        lines.push(`狀況：6 位確認碼已達 ${Number(data.failedAttempts || 3)} 次錯誤上限`);
    } else if (type === 'rapid_multi_location_login') {
        lines.push(`前次位置：${formatTelegramSecurityLocation(data.previousLoginLocation)}`);
        if (data.previousLoginAtText) lines.push(`前次登入：${String(data.previousLoginAtText)}`);
        lines.push(`狀況：${Number(data.windowMinutes || 10)} 分鐘內由不同裝置、不同位置登入`);
    } else if (type === 'manager_assistance_required') {
        lines.push('狀況：沒有可用的既有信任裝置，需由最高管理者協助確認');
    } else if (type === 'self_reported_not_me') {
        lines.push('狀況：使用者已在原信任裝置回報「不是我」');
    } else if (type === 'blocked_device_login') {
        lines.push('狀況：已停用的裝置再次嘗試登入');
    } else if (data.message) {
        lines.push(`狀況：${String(data.message).slice(0, 240)}`);
    }

    lines.push('', '請至 SaaS「登入監控／裝置管理」查看完整紀錄。');
    return lines.join('\n').slice(0, 3900);
}

async function dispatchTelegramSecurityAlert(event) {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    if (data.notifyTelegram !== true || !String(data.telegramSecurityType || '').trim()) return;

    try {
        const configSnap = await TELEGRAM_SECURITY_CONFIG_REF.get();
        const config = normalizeTelegramSecurityConfig(configSnap.exists ? (configSnap.data() || {}) : {});
        if (!config.enabled) {
            await snap.ref.set({
                telegramDeliveryStatus: 'disabled',
                telegramDeliveryUpdatedAtText: new Date().toISOString(),
            }, { merge: true });
            return;
        }

        const chatIds = resolveTelegramSecurityChatIds(config);
        if (!chatIds.length) {
            await snap.ref.set({
                telegramDeliveryStatus: 'waiting_target',
                telegramDeliveryUpdatedAtText: new Date().toISOString(),
            }, { merge: true });
            return;
        }

        const message = buildTelegramSecurityAlertMessage(data);
        const settled = await Promise.allSettled(chatIds.map((chatId) => sendTelegramMessage(chatId, message)));
        const sentChatIds = settled
            .map((result, index) => result.status === 'fulfilled' ? chatIds[index] : '')
            .filter(Boolean);
        const errors = settled
            .map((result) => result.status === 'rejected' ? String(result.reason?.message || result.reason || 'send_failed') : '')
            .filter(Boolean);

        await snap.ref.set({
            telegramDeliveryStatus: errors.length ? (sentChatIds.length ? 'partial' : 'error') : 'sent',
            telegramSentChatCount: sentChatIds.length,
            telegramSentChatIds: sentChatIds,
            telegramDeliveryError: errors.join('；').slice(0, 1000),
            telegramSentAt: sentChatIds.length ? admin.firestore.FieldValue.serverTimestamp() : null,
            telegramSentAtText: sentChatIds.length ? new Date().toISOString() : '',
            telegramDeliveryUpdatedAtText: new Date().toISOString(),
        }, { merge: true });
    } catch (error) {
        console.error('Login Security Telegram 推播失敗:', error);
        await snap.ref.set({
            telegramDeliveryStatus: 'error',
            telegramDeliveryError: String(error?.message || error || 'unknown').slice(0, 1000),
            telegramDeliveryUpdatedAtText: new Date().toISOString(),
        }, { merge: true }).catch(() => {});
    }
}

exports.onLegacySecurityAlertCreated = onDocumentCreated({
    document: 'artifacts/default-app-id/public/data/security_alerts/{alertId}',
    secrets: [TELEGRAM_BOT_TOKEN_SECRET],
    timeoutSeconds: 30,
    memory: '256MiB',
}, dispatchTelegramSecurityAlert);

exports.onBrandSecurityAlertCreated = onDocumentCreated({
    document: 'brands/{brandId}/security_alerts/{alertId}',
    secrets: [TELEGRAM_BOT_TOKEN_SECRET],
    timeoutSeconds: 30,
    memory: '256MiB',
}, dispatchTelegramSecurityAlert);

async function answerTelegramCallbackQuery(callbackQueryId, text = "") {
    if (!callbackQueryId) return null;
    return axios.post(getTelegramApiUrl("answerCallbackQuery"), {
        callback_query_id: String(callbackQueryId),
        text: String(text || "").slice(0, 180),
        show_alert: false,
    });
}

// ==========================================
// ★ 2. DRCYJ Telegram 營運戰情 Agent v1
// Summary-first／最多三個工具／短期記憶／查詢稽核／成本護欄
// ==========================================
const TELEGRAM_AGENT_VERSION = "drcyj-agent-v5.0-snapshot-schedule-task-loop";
const TELEGRAM_AGENT_COMPATIBLE_VERSIONS = new Set([
    "drcyj-agent-v1.5-alert-control-center",
    "drcyj-agent-v2.0-gemini-3.6-interactions",
    "drcyj-agent-v4.0-controlled-learning",
    "drcyj-agent-v4.1-cost-throttled-learning",
    "drcyj-agent-v4.2-scheduled-data-unified",
    "drcyj-agent-v4.3-stable-api-schedule-query",
    TELEGRAM_AGENT_VERSION,
]);
const TELEGRAM_AGENT_PRIMARY_MODEL = "gemini-3.7-flash";
const TELEGRAM_AGENT_FALLBACK_MODEL = "gemini-3.6-flash";

// Gemini 3.7 Flash 官方 REST quickstart 目前使用 v1beta/interactions；
// 3.6 Flash 備援維持既有已驗證的 stable v1/interactions，避免同時改動兩個可用路徑。
const GEMINI_INTERACTIONS_API_URL_V1 = "https://generativelanguage.googleapis.com/v1/interactions";
const GEMINI_INTERACTIONS_API_URL_V1BETA = "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_INTERACTIONS_V1BETA_MODELS = new Set(["gemini-3.7-flash"]);

function getGeminiInteractionsApiUrl(model = TELEGRAM_AGENT_PRIMARY_MODEL) {
    return GEMINI_INTERACTIONS_V1BETA_MODELS.has(String(model || ""))
        ? GEMINI_INTERACTIONS_API_URL_V1BETA
        : GEMINI_INTERACTIONS_API_URL_V1;
}

function getGeminiInteractionsApiLabel(model = TELEGRAM_AGENT_PRIMARY_MODEL) {
    return GEMINI_INTERACTIONS_V1BETA_MODELS.has(String(model || ""))
        ? "interactions-v1beta-rest"
        : "interactions-v1-rest";
}

const GEMINI_INTERACTIONS_TIMEOUT_MS = 35000;
const TELEGRAM_AGENT_MAX_TOOL_CALLS = 3;
const TELEGRAM_AGENT_MAX_READS = 2500;
const TELEGRAM_AGENT_MAX_DAILY_RANGE_DAYS = 31;
const TELEGRAM_AGENT_MAX_MACRO_MONTHS = 12;
const TELEGRAM_AGENT_MEMORY_TURNS = 8;
const TELEGRAM_AGENT_CACHE_TTL_MS = 2 * 60 * 1000;
const TELEGRAM_AGENT_TOOL_CACHE = new Map();

// ==========================================
// ★ Telegram 戰情秘書 v4：可控式長期記憶與自然語言規則管理
// 正式規則不直接訓練模型，而是以可稽核、可撤銷的結構化政策保存於 Firestore。
// ==========================================
const TELEGRAM_AGENT_POLICY_SCHEMA_VERSION = 1;
const TELEGRAM_AGENT_POLICY_APP_ID = "default-app-id";
const TELEGRAM_AGENT_POLICY_PENDING_MINUTES = 30;
const TELEGRAM_AGENT_POLICY_CACHE_TTL_MS = 90 * 1000;
const TELEGRAM_AGENT_POLICY_RUNTIME_CACHE = {
    permissionDoc: null,
    activeCatalog: null,
    allCatalog: null,
};
const TELEGRAM_AGENT_POLICY_SCOPES = Object.freeze([
    "telegram_analysis",
    "ranking",
    "brand_totals",
    "active_alert",
    "data_audit",
]);
const TELEGRAM_AGENT_POLICY_SCOPE_LABELS = Object.freeze({
    telegram_analysis: "Telegram 營運分析",
    ranking: "排行",
    brand_totals: "品牌總計",
    active_alert: "主動巡察",
    data_audit: "回報與資料檢核",
});
const TELEGRAM_AGENT_ALL_EXCLUSION_SCOPES = Object.freeze([
    "telegram_analysis",
    "ranking",
    "brand_totals",
    "active_alert",
    "data_audit",
]);

function isTelegramPolicyAllDataExclusionText(text = "") {
    const command = String(text || "");
    return /(?:任何資料|所有資料|全部資料|任何分析|所有分析|全部分析|不論.*(?:資料|分析)|一律排除|完全排除|所有營運分析)/.test(command);
}
const TELEGRAM_AGENT_POLICY_RULE_LABELS = Object.freeze({
    progressGap: "現金進度差距",
    cashAchievementRate: "現金業績達成率",
    closingRate: "新客締結率",
    skincareRatio: "保養品占比",
    newCustomers: "本月新客數",
    traffic: "本月來客人次",
    missingReport: "店家日報缺漏",
    missingTarget: "現金目標缺漏",
    limit: "每品牌顯示上限",
});

function getTelegramAgentPolicyDataRootRef() {
    return db.collection("artifacts").doc(TELEGRAM_AGENT_POLICY_APP_ID).collection("public").doc("data");
}

function getTelegramAgentPoliciesRef() {
    return getTelegramAgentPolicyDataRootRef().collection("telegram_agent_policies");
}

function getTelegramAgentPolicyAuditsRef() {
    return getTelegramAgentPolicyDataRootRef().collection("telegram_agent_policy_audits");
}

function getTelegramAgentPolicyPermissionsRef() {
    return getTelegramAgentPolicyDataRootRef().collection("global_settings").doc("telegram_agent_policy_permissions");
}

// ==========================================
// ★ Telegram 戰情秘書 v5：可重現報表、自然語言排程、改善任務閉環
// ==========================================
const TELEGRAM_V5_SCHEMA_VERSION = 1;
const TELEGRAM_V5_METRIC_VERSION = "metric-v5.0-unified";
const TELEGRAM_V5_PENDING_MINUTES = 30;
const TELEGRAM_V5_DEFAULT_TASK_REMINDER_HOUR = 9;
const TELEGRAM_V5_SCHEDULE_SOURCES = Object.freeze({
    weekday_morning_brief: "三品牌工作日晨報",
    progress: "品牌本月進度",
    top5_stores: "昨日店家前五名",
    bottom5_stores: "現金進度後五店",
    top5_therapists: "昨日管理師前五名",
    unreported: "昨日缺報店家",
});
const TELEGRAM_V5_TASK_STATUS_LABELS = Object.freeze({
    open: "待處理",
    in_progress: "處理中",
    completed: "已完成",
    cancelled: "已取消",
    overdue: "已逾期",
});

function getTelegramReportSnapshotsRef() {
    return getTelegramAgentPolicyDataRootRef().collection("telegram_report_snapshots");
}

function getTelegramAgentTasksRef() {
    return getTelegramAgentPolicyDataRootRef().collection("telegram_agent_tasks");
}

function getTelegramAgentTaskAuditsRef() {
    return getTelegramAgentPolicyDataRootRef().collection("telegram_agent_task_audits");
}

function getTelegramScheduleAuditsRef() {
    return getTelegramAgentPolicyDataRootRef().collection("telegram_schedule_audits");
}

function getTelegramNotificationRulesRef() {
    return db.collection("notification_rules");
}

function makeTelegramReadableCode(prefix = "ID", seed = "") {
    const now = getTelegramAlertTaipeiClock();
    const suffix = String(seed || Math.random().toString(36).slice(2, 8))
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 6)
        .toUpperCase()
        .padEnd(6, "0");
    return `${prefix}-${now.todayStr.replace(/-/g, "")}-${suffix}`;
}

function normalizeTelegramWeekdays(values, fallback = [1, 2, 3, 4, 5]) {
    const source = Array.isArray(values) ? values : fallback;
    const normalized = [...new Set(source
        .map(Number)
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))];
    return normalized.length ? normalized.sort((a, b) => a - b) : [...fallback];
}

function parseTelegramTimeText(text = "", fallback = "") {
    const source = String(text || "");
    const colon = source.match(/(?:上午|早上|下午|晚上)?\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/);
    const point = source.match(/(?:上午|早上|下午|晚上)?\s*(\d{1,2})\s*點(?:\s*(\d{1,2})\s*分?)?/);
    const match = colon || point;
    if (!match) return fallback;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const prefix = match[0];
    if (/下午|晚上/.test(prefix) && hour < 12) hour += 12;
    if (/上午|早上/.test(prefix) && hour === 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTelegramDateText(text = "", baseDate = getTelegramAlertTaipeiClock().todayStr) {
    const source = String(text || "");
    const iso = source.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
    if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;
    const md = source.match(/(\d{1,2})月(\d{1,2})日/);
    if (md) return `${baseDate.slice(0, 4)}-${String(Number(md[1])).padStart(2, "0")}-${String(Number(md[2])).padStart(2, "0")}`;
    if (/明天/.test(source)) return shiftTelegramAgentDate(baseDate, 1);
    if (/後天/.test(source)) return shiftTelegramAgentDate(baseDate, 2);
    if (/月底/.test(source)) {
        const [year, month] = baseDate.slice(0, 7).split("-").map(Number);
        return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    }
    return "";
}

function getTelegramMonthProgressAtDate(dateText = "") {
    const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return 0;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Number(((day / totalDays) * 100).toFixed(1));
}

function normalizeTelegramScheduleRule(raw = {}, id = "") {
    const source = Object.prototype.hasOwnProperty.call(TELEGRAM_V5_SCHEDULE_SOURCES, raw.source)
        ? String(raw.source)
        : "progress";
    return {
        id: String(id || raw.id || raw.ruleId || ""),
        scheduleCode: String(raw.scheduleCode || ""),
        name: String(raw.name || TELEGRAM_V5_SCHEDULE_SOURCES[source] || "Telegram 排程").trim(),
        source,
        reportType: String(raw.reportType || source),
        brandIds: Array.isArray(raw.brandIds) ? [...new Set(raw.brandIds.map(normalizeTelegramAgentBrandId).filter(Boolean))] : [],
        time: /^\d{2}:\d{2}$/.test(String(raw.time || "")) ? String(raw.time) : "10:00",
        weekdays: normalizeTelegramWeekdays(raw.weekdays, source === "weekday_morning_brief" ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]),
        targetGroup: ["main", "manager"].includes(String(raw.targetGroup || "")) ? String(raw.targetGroup) : "manager",
        targetChatId: String(raw.targetChatId || ""),
        template: String(raw.template || ""),
        isActive: raw.isActive === true || String(raw.isActive || "").toLowerCase() === "true",
        pausedUntil: normalizeTelegramPolicyDate(raw.pausedUntil || ""),
        cutoffMode: raw.cutoffMode === "current"
            ? "current"
            : raw.cutoffMode === "yesterday"
                ? "yesterday"
                : source === "weekday_morning_brief" ? "yesterday" : "current",
        topCount: Math.max(1, Math.min(10, Math.round(Number(raw.topCount || 3)))),
        bottomCount: Math.max(1, Math.min(10, Math.round(Number(raw.bottomCount || 3)))),
        includeMissingReports: raw.includeMissingReports !== false,
        createdByUserId: String(raw.createdByUserId || ""),
        createdByName: String(raw.createdByName || ""),
        createdAtText: String(raw.createdAtText || raw.createdAt || ""),
        updatedAtText: String(raw.updatedAtText || ""),
        lastRunKey: String(raw.lastRunKey || ""),
        lastSnapshotId: String(raw.lastSnapshotId || ""),
    };
}

function isTelegramScheduleDueOnDay(rule = {}, clock = getTelegramAlertTaipeiClock()) {
    const normalized = normalizeTelegramScheduleRule(rule, rule.id);
    if (!normalized.isActive) return false;
    if (normalized.pausedUntil && clock.todayStr <= normalized.pausedUntil) return false;
    return normalized.weekdays.includes(Number(clock.weekday));
}

function resolveTelegramScheduleChatId(rule = {}) {
    if (String(rule.targetChatId || "").trim()) return String(rule.targetChatId).trim();
    return rule.targetGroup === "main" ? TARGET_CHAT_ID_MAIN : TARGET_CHAT_ID_MANAGER;
}

async function writeTelegramScheduleAudit(action, schedule, actor = {}, details = {}) {
    try {
        await getTelegramScheduleAuditsRef().add({
            schemaVersion: TELEGRAM_V5_SCHEMA_VERSION,
            action: String(action || ""),
            scheduleId: String(schedule?.id || ""),
            scheduleCode: String(schedule?.scheduleCode || ""),
            scheduleSnapshot: schedule || {},
            actor: {
                source: String(actor.source || "telegram"),
                userId: String(actor.userId || ""),
                name: String(actor.name || ""),
                chatId: String(actor.chatId || ""),
            },
            details,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAtText: new Date().toISOString(),
        });
    } catch (error) {
        console.warn("Telegram schedule audit failed:", error.message);
    }
}

async function writeTelegramTaskAudit(action, task, actor = {}, details = {}) {
    try {
        await getTelegramAgentTaskAuditsRef().add({
            schemaVersion: TELEGRAM_V5_SCHEMA_VERSION,
            action: String(action || ""),
            taskId: String(task?.id || ""),
            taskCode: String(task?.taskCode || ""),
            taskSnapshot: task || {},
            actor: {
                source: String(actor.source || "telegram"),
                userId: String(actor.userId || ""),
                name: String(actor.name || ""),
                chatId: String(actor.chatId || ""),
            },
            details,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAtText: new Date().toISOString(),
        });
    } catch (error) {
        console.warn("Telegram task audit failed:", error.message);
    }
}


function getTelegramAgentTaskDraftsRef() {
    return getTelegramAgentPolicyDataRootRef().collection("telegram_agent_task_drafts");
}

function getTelegramV5Actor(ctx = {}, source = "telegram") {
    return {
        source,
        userId: String(ctx.userId || ""),
        name: String(ctx.userName || ""),
        chatId: String(ctx.chatId || ""),
    };
}

function assertTelegramSchedulePermission(permission = {}, schedule = {}) {
    const role = String(permission.role || "viewer");
    if (role === "director") return true;
    if (role !== "brand_manager") throw new Error("目前權限只能查詢，無法建立或修改排程");
    const requestedBrands = Array.isArray(schedule.brandIds) && schedule.brandIds.length
        ? schedule.brandIds.map(normalizeTelegramAgentBrandId).filter(Boolean)
        : [];
    if (!requestedBrands.length) throw new Error("品牌主管只能建立指定品牌排程，不能建立三品牌或全公司排程");
    const allowed = new Set((permission.brandIds || []).map(normalizeTelegramAgentBrandId).filter(Boolean));
    if (requestedBrands.some((brandId) => !allowed.has(brandId))) throw new Error("排程包含超出目前權限的品牌");
    return true;
}

function assertTelegramTaskPermission(permission = {}, task = {}) {
    const role = String(permission.role || "viewer");
    if (role === "director") return true;
    if (role !== "brand_manager") throw new Error("目前權限只能查詢，無法建立或修改改善任務");
    const brandId = normalizeTelegramAgentBrandId(task.brandId || "");
    const allowed = new Set((permission.brandIds || []).map(normalizeTelegramAgentBrandId).filter(Boolean));
    if (brandId && !allowed.has(brandId)) throw new Error("此任務品牌超出目前管理權限");
    return true;
}

function normalizeTelegramTask(raw = {}, id = "") {
    const status = Object.prototype.hasOwnProperty.call(TELEGRAM_V5_TASK_STATUS_LABELS, raw.status)
        ? String(raw.status)
        : "open";
    return {
        id: String(id || raw.id || ""),
        taskCode: String(raw.taskCode || ""),
        title: String(raw.title || "營運改善任務").trim().slice(0, 160),
        description: String(raw.description || "").trim().slice(0, 1500),
        brandId: normalizeTelegramAgentBrandId(raw.brandId || ""),
        brand: String(raw.brand || getTelegramAgentBrandLabel(raw.brandId || "")),
        storeCore: normalizeSummaryCoreName(raw.storeCore || raw.storeName || ""),
        storeName: normalizeSummaryCoreName(raw.storeName || raw.storeCore || ""),
        ownerName: String(raw.ownerName || "待指派").trim().slice(0, 100),
        ownerUserId: String(raw.ownerUserId || ""),
        ownerChatId: String(raw.ownerChatId || ""),
        dueDate: normalizeTelegramPolicyDate(raw.dueDate || ""),
        targetText: String(raw.targetText || "").trim().slice(0, 500),
        status,
        priority: ["low", "normal", "high", "critical"].includes(String(raw.priority || "")) ? String(raw.priority) : "normal",
        sourceType: String(raw.sourceType || "manual"),
        sourceAlertId: String(raw.sourceAlertId || ""),
        sourceSnapshotId: String(raw.sourceSnapshotId || ""),
        sourcePolicyIds: Array.isArray(raw.sourcePolicyIds) ? raw.sourcePolicyIds.map(String).slice(0, 20) : [],
        createdByUserId: String(raw.createdByUserId || ""),
        createdByName: String(raw.createdByName || ""),
        createdByChatId: String(raw.createdByChatId || ""),
        createdAtText: String(raw.createdAtText || ""),
        updatedAtText: String(raw.updatedAtText || ""),
        completedAtText: String(raw.completedAtText || ""),
        resultText: String(raw.resultText || "").slice(0, 1000),
        baseline: raw.baseline && typeof raw.baseline === "object" ? raw.baseline : null,
        latestCheck: raw.latestCheck && typeof raw.latestCheck === "object" ? raw.latestCheck : null,
        reminderCount: Number(raw.reminderCount || 0),
        lastReminderAtText: String(raw.lastReminderAtText || ""),
    };
}

async function createTelegramSchedule(scheduleInput, actor, ctx) {
    const permission = ctx.policyPermission || await loadTelegramAgentPolicyPermission(ctx.chatId, ctx.userId, ctx);
    const ref = getTelegramNotificationRulesRef().doc();
    const normalized = normalizeTelegramScheduleRule({
        ...scheduleInput,
        id: ref.id,
        scheduleCode: scheduleInput.scheduleCode || makeTelegramReadableCode("SCH", ref.id),
        isActive: scheduleInput.isActive !== false,
        createdByUserId: actor.userId,
        createdByName: actor.name,
        createdAtText: new Date().toISOString(),
        updatedAtText: new Date().toISOString(),
    }, ref.id);
    assertTelegramSchedulePermission(permission, normalized);
    await ref.create({
        ...normalized,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (ctx) ctx.writeCount += 1;
    await writeTelegramScheduleAudit("create", normalized, actor);
    return normalized;
}

async function loadTelegramSchedules(ctx = null, options = {}) {
    const snap = await getTelegramNotificationRulesRef().limit(Math.max(1, Math.min(200, Number(options.limit || 100)))).get();
    if (ctx) recordTelegramAgentRead(ctx, Math.max(1, snap.size), "telegram_schedules", {});
    return snap.docs
        .map((docSnap) => normalizeTelegramScheduleRule(docSnap.data() || {}, docSnap.id))
        .filter((row) => options.includeInactive !== false || row.isActive)
        .sort((a, b) => `${a.time}|${a.name}`.localeCompare(`${b.time}|${b.name}`));
}

async function findTelegramSchedule(reference, ctx = null, includeInactive = true) {
    const queryText = String(reference || "").trim().toLowerCase();
    if (!queryText) return null;
    const schedules = await loadTelegramSchedules(ctx, { includeInactive, limit: 150 });
    return schedules.find((row) =>
        row.id === reference ||
        row.scheduleCode.toLowerCase() === queryText ||
        row.name.toLowerCase() === queryText
    ) || schedules.find((row) => row.name.toLowerCase().includes(queryText) || queryText.includes(row.name.toLowerCase())) || null;
}

async function updateTelegramSchedule(scheduleId, patch, actor, ctx) {
    const ref = getTelegramNotificationRulesRef().doc(String(scheduleId));
    const snap = await ref.get();
    if (ctx) recordTelegramAgentRead(ctx, 1, "telegram_schedules", { scheduleId });
    if (!snap.exists) throw new Error("找不到指定排程");
    const before = normalizeTelegramScheduleRule(snap.data() || {}, snap.id);
    const permission = ctx.policyPermission || await loadTelegramAgentPolicyPermission(ctx.chatId, ctx.userId, ctx);
    assertTelegramSchedulePermission(permission, before);
    const after = normalizeTelegramScheduleRule({ ...before, ...patch, id: before.id, scheduleCode: before.scheduleCode }, before.id);
    await ref.set({
        ...patch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString(),
    }, { merge: true });
    if (ctx) ctx.writeCount += 1;
    await writeTelegramScheduleAudit("update", after, actor, { before });
    return after;
}


async function loadTelegramReportSnapshots(ctx = null, options = {}) {
    const snap = await getTelegramReportSnapshotsRef()
        .orderBy("createdAtText", "desc")
        .limit(Math.max(1, Math.min(200, Number(options.limit || 50))))
        .get();
    if (ctx) recordTelegramAgentRead(ctx, Math.max(1, snap.size), "telegram_report_snapshots", {});
    return snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
        .sort((a, b) => String(b.createdAtText || "").localeCompare(String(a.createdAtText || "")));
}

async function findTelegramReportSnapshot(reference, ctx = null) {
    const queryText = String(reference || "").trim().toLowerCase();
    if (!queryText) return null;
    const snapshots = await loadTelegramReportSnapshots(ctx, { limit: 100 });
    return snapshots.find((row) => String(row.snapshotId || "").toLowerCase() === queryText || row.id === reference) || null;
}

function formatTelegramSnapshotList(snapshots = []) {
    if (!snapshots.length) return "目前沒有報表快照。";
    const lines = [`最近 ${Math.min(snapshots.length, 20)} 份報表快照：`, ""];
    snapshots.slice(0, 20).forEach((row, index) => {
        lines.push(`${index + 1}. ${row.snapshotId || row.id}｜${row.scheduleName || row.reportType}`);
        lines.push(`   截止：${row.cutoffAtText || row.cutoffDate || "-"}｜口徑：${row.metricVersion || "-"}`);
    });
    return lines.join("\n");
}

async function createTelegramTask(taskInput, actor, ctx) {
    const permission = ctx.policyPermission || await loadTelegramAgentPolicyPermission(ctx.chatId, ctx.userId, ctx);
    assertTelegramTaskPermission(permission, taskInput || {});

    const sourceAlertId = String(taskInput?.sourceAlertId || "").trim();
    if (sourceAlertId) {
        const duplicateSnap = await getTelegramAgentTasksRef()
            .where("sourceAlertId", "==", sourceAlertId)
            .limit(20)
            .get();
        if (ctx) recordTelegramAgentRead(ctx, Math.max(1, duplicateSnap.size), "telegram_agent_tasks_duplicate_guard", { sourceAlertId });
        const existing = duplicateSnap.docs
            .map((docSnap) => normalizeTelegramTask(docSnap.data() || {}, docSnap.id))
            .find((task) => ["open", "in_progress", "overdue"].includes(task.status));
        if (existing) return { ...existing, duplicateExisting: true };
    }

    const ref = getTelegramAgentTasksRef().doc();
    const normalized = normalizeTelegramTask({
        ...taskInput,
        id: ref.id,
        taskCode: taskInput.taskCode || makeTelegramReadableCode("TASK", ref.id),
        createdByUserId: actor.userId,
        createdByName: actor.name,
        createdByChatId: actor.chatId,
        createdAtText: new Date().toISOString(),
        updatedAtText: new Date().toISOString(),
    }, ref.id);
    assertTelegramTaskPermission(permission, normalized);
    await ref.create({
        ...normalized,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (ctx) ctx.writeCount += 1;
    await writeTelegramTaskAudit("create", normalized, actor);
    return normalized;
}

async function loadTelegramTasks(ctx = null, options = {}) {
    const statusList = Array.isArray(options.statuses)
        ? [...new Set(options.statuses.map(String).filter((status) => Object.prototype.hasOwnProperty.call(TELEGRAM_V5_TASK_STATUS_LABELS, status)))].slice(0, 10)
        : [];
    let queryRef = getTelegramAgentTasksRef();
    if (statusList.length === 1) queryRef = queryRef.where("status", "==", statusList[0]);
    else if (statusList.length > 1) queryRef = queryRef.where("status", "in", statusList);
    else queryRef = queryRef.orderBy("createdAtText", "desc");
    const snap = await queryRef.limit(Math.max(1, Math.min(300, Number(options.limit || 100)))).get();
    if (ctx) recordTelegramAgentRead(ctx, Math.max(1, snap.size), "telegram_agent_tasks", { statuses: statusList });
    return snap.docs
        .map((docSnap) => normalizeTelegramTask(docSnap.data() || {}, docSnap.id))
        .sort((a, b) => String(b.createdAtText || "").localeCompare(String(a.createdAtText || "")));
}

async function findTelegramTask(reference, ctx = null) {
    const queryText = String(reference || "").trim().toLowerCase();
    if (!queryText) return null;
    const tasks = await loadTelegramTasks(ctx, { limit: 200 });
    return tasks.find((task) => task.id === reference || task.taskCode.toLowerCase() === queryText) ||
        tasks.find((task) => task.title.toLowerCase().includes(queryText) || queryText.includes(task.title.toLowerCase())) || null;
}

async function updateTelegramTask(taskId, patch, actor, ctx, action = "update") {
    const ref = getTelegramAgentTasksRef().doc(String(taskId));
    const snap = await ref.get();
    if (ctx) recordTelegramAgentRead(ctx, 1, "telegram_agent_tasks", { taskId });
    if (!snap.exists) throw new Error("找不到指定改善任務");
    const before = normalizeTelegramTask(snap.data() || {}, snap.id);
    const permission = ctx.policyPermission || await loadTelegramAgentPolicyPermission(ctx.chatId, ctx.userId, ctx);
    assertTelegramTaskPermission(permission, before);
    const nextPatch = {
        ...patch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString(),
    };
    if (patch.status === "completed" && !patch.completedAtText) {
        nextPatch.completedAt = admin.firestore.FieldValue.serverTimestamp();
        nextPatch.completedAtText = new Date().toISOString();
    }
    await ref.set(nextPatch, { merge: true });
    if (ctx) ctx.writeCount += 1;
    const after = normalizeTelegramTask({ ...before, ...nextPatch }, before.id);
    await writeTelegramTaskAudit(action, after, actor, { before });
    return after;
}


async function checkTelegramTaskOutcome(task, actor, ctx) {
    const normalized = normalizeTelegramTask(task || {}, task?.id || "");
    if (!normalized.brandId || !normalized.storeName) throw new Error("此任務沒有明確品牌與店家，無法自動驗證改善結果");
    const clock = getTelegramAlertTaipeiClock();
    const monthStart = `${clock.yearMonth}-01`;
    const result = await getStorePerformance(
        monthStart,
        clock.todayStr,
        normalized.storeName,
        getTelegramAgentBrandLabel(normalized.brandId),
        ctx,
        ["telegram_analysis", "ranking", "brand_totals"]
    );
    const row = (result.stores_details || []).find((item) => normalizeSummaryCoreName(item.storeName) === normalizeSummaryCoreName(normalized.storeName)) || null;
    if (!row) throw new Error("目前找不到這家店的最新營運資料");
    const baselineRate = normalized.baseline?.cashAchievementRate === null || normalized.baseline?.cashAchievementRate === undefined
        ? null
        : Number(normalized.baseline.cashAchievementRate);
    const currentRate = row.cashAchievementRate === null || row.cashAchievementRate === undefined
        ? (Number(row.budget || 0) > 0 ? Number(((Number(row.cash || 0) / Number(row.budget)) * 100).toFixed(1)) : null)
        : Number(row.cashAchievementRate);
    const rateDiff = baselineRate === null || currentRate === null ? null : Number((currentRate - baselineRate).toFixed(1));
    const latestCheck = {
        checkedAtText: new Date().toISOString(),
        cash: Number(row.cash || 0),
        cashTarget: Number(row.budget || 0),
        cashAchievementRate: currentRate,
        baselineCashAchievementRate: baselineRate,
        cashAchievementRateDiff: rateDiff,
        reasons: Array.isArray(normalized.baseline?.reasons) ? normalized.baseline.reasons : [],
    };
    await getTelegramAgentTasksRef().doc(normalized.id).set({
        latestCheck,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString(),
    }, { merge: true });
    await writeTelegramTaskAudit("outcome_check", { ...normalized, latestCheck }, actor);
    return {
        task: { ...normalized, latestCheck },
        message: [
            `📈 改善驗證｜${normalized.taskCode}`,
            `${normalized.brand} ${normalized.storeName}店`,
            `基準現金達成率：${baselineRate === null ? "無基準" : `${baselineRate}%`}`,
            `目前現金達成率：${currentRate === null ? "目標缺漏" : `${currentRate}%`}`,
            `變化：${rateDiff === null ? "無法比較" : `${rateDiff >= 0 ? "+" : ""}${rateDiff} 個百分點`}`,
            `目前現金：$${Number(row.cash || 0).toLocaleString()}｜目標：$${Number(row.budget || 0).toLocaleString()}`,
        ].join("\n"),
    };
}

function formatTelegramScheduleList(schedules = []) {
    if (!schedules.length) return "目前沒有固定排程。";
    const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
    const lines = [`目前共有 ${schedules.length} 個排程：`, ""];
    schedules.slice(0, 30).forEach((schedule, index) => {
        const days = schedule.weekdays.map((day) => weekdayLabels[day]).join("、");
        const status = schedule.isActive ? (schedule.pausedUntil ? `暫停至 ${schedule.pausedUntil}` : "啟用") : "停用";
        lines.push(`${index + 1}. ${schedule.scheduleCode || schedule.id}｜${schedule.name}`);
        lines.push(`   週${days} ${schedule.time}｜${TELEGRAM_V5_SCHEDULE_SOURCES[schedule.source] || schedule.source}｜${status}`);
    });
    return lines.join("\n");
}

function formatTelegramTaskList(tasks = []) {
    if (!tasks.length) return "目前沒有待處理或進行中的改善任務。";
    const lines = [`目前共有 ${tasks.length} 個改善任務：`, ""];
    tasks.slice(0, 30).forEach((task, index) => {
        lines.push(`${index + 1}. ${task.taskCode || task.id}｜${TELEGRAM_V5_TASK_STATUS_LABELS[task.status] || task.status}｜${task.title}`);
        lines.push(`   ${task.brand || ""}${task.storeName ? ` ${task.storeName}店` : ""}｜負責人：${task.ownerName || "待指派"}｜期限：${task.dueDate || "未設定"}`);
    });
    return lines.join("\n");
}

async function saveTelegramPendingV5Action(chatId, userId, action) {
    const expiresAtMs = Date.now() + TELEGRAM_V5_PENDING_MINUTES * 60 * 1000;
    await getTelegramAgentSessionRef(chatId, userId).set({
        pendingV5Action: { ...action, createdAtText: new Date().toISOString(), expiresAtText: new Date(expiresAtMs).toISOString() },
        pendingV5ExpiresAtMs: expiresAtMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString(),
    }, { merge: true });
}

async function clearTelegramPendingV5Action(chatId, userId) {
    await getTelegramAgentSessionRef(chatId, userId).set({
        pendingV5Action: admin.firestore.FieldValue.delete(),
        pendingV5ExpiresAtMs: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString(),
    }, { merge: true });
}

function buildTelegramV5PendingMessage(action = {}) {
    const lines = ["我理解的執行內容如下：", ""];
    if (action.kind === "create_schedule") {
        const schedule = normalizeTelegramScheduleRule(action.schedule || {});
        lines.push(`排程：${schedule.name}`);
        lines.push(`時間：${schedule.time}｜星期：${schedule.weekdays.join("、")}`);
        lines.push(`內容：${TELEGRAM_V5_SCHEDULE_SOURCES[schedule.source] || schedule.source}`);
        lines.push(`資料截止：${schedule.cutoffMode === "yesterday" ? "前一日 23:59" : "執行當下"}`);
        lines.push(`接收：${schedule.targetChatId ? "目前聊天室" : schedule.targetGroup === "main" ? "營運大群組" : "主管群組"}`);
    } else if (["update_schedule", "pause_schedule", "delete_schedule"].includes(action.kind)) {
        lines.push(`排程：${action.scheduleName || action.scheduleCode || action.scheduleId}`);
        lines.push(`動作：${action.kind === "update_schedule" ? "修改" : action.kind === "pause_schedule" ? `暫停至 ${action.pausedUntil}` : "停用／刪除"}`);
        if (action.patch?.time) lines.push(`新時間：${action.patch.time}`);
    } else if (action.kind === "create_task") {
        const task = normalizeTelegramTask(action.task || {});
        lines.push(`任務：${task.title}`);
        lines.push(`品牌／店家：${task.brand || "未指定"}${task.storeName ? ` ${task.storeName}店` : ""}`);
        lines.push(`負責人：${task.ownerName || "待指派"}`);
        lines.push(`期限：${task.dueDate || "未設定"}`);
        if (task.targetText) lines.push(`目標：${task.targetText}`);
    } else if (action.kind === "update_task") {
        lines.push(`任務：${action.taskCode || action.taskId}`);
        lines.push(`動作：更新為 ${TELEGRAM_V5_TASK_STATUS_LABELS[action.patch?.status] || action.patch?.status || "新狀態"}`);
    }
    lines.push("", "確認執行嗎？");
    return lines.join("\n");
}

async function executeTelegramPendingV5Action(action, actor, ctx) {
    if (!action || typeof action !== "object") throw new Error("目前沒有待確認的動作");
    if (action.expiresAtText && Date.parse(action.expiresAtText) <= Date.now()) throw new Error("這筆確認已逾時，請重新下達指令");
    if (action.kind === "create_schedule") {
        const schedule = await createTelegramSchedule(action.schedule || {}, actor, ctx);
        return `✅ 已建立固定排程\n${schedule.scheduleCode}\n${schedule.name}｜${schedule.time}`;
    }
    if (["update_schedule", "pause_schedule", "delete_schedule"].includes(action.kind)) {
        const patch = action.kind === "delete_schedule"
            ? { isActive: false, status: "deleted", deletedAtText: new Date().toISOString() }
            : action.kind === "pause_schedule"
                ? { pausedUntil: action.pausedUntil }
                : (action.patch || {});
        const schedule = await updateTelegramSchedule(action.scheduleId, patch, actor, ctx);
        return `✅ 已更新排程 ${schedule.scheduleCode || schedule.id}\n${schedule.name}`;
    }
    if (action.kind === "create_task") {
        const task = await createTelegramTask(action.task || {}, actor, ctx);
        if (action.taskDraftId) {
            try {
                await getTelegramAgentTaskDraftsRef().doc(String(action.taskDraftId)).delete();
            } catch (draftError) {
                console.warn("Telegram task draft cleanup failed:", draftError.message);
            }
        }
        if (task.duplicateExisting) {
            return `ℹ️ 此巡察警示已有進行中的改善任務
${task.taskCode}
${task.title}
狀態：${TELEGRAM_V5_TASK_STATUS_LABELS[task.status] || task.status}`;
        }
        return `✅ 已建立改善任務
${task.taskCode}
${task.title}
負責人：${task.ownerName}｜期限：${task.dueDate || "未設定"}`;
    }
    if (action.kind === "update_task") {
        const task = await updateTelegramTask(action.taskId, action.patch || {}, actor, ctx, "status_change");
        return `✅ 已更新任務 ${task.taskCode || task.id}\n狀態：${TELEGRAM_V5_TASK_STATUS_LABELS[task.status] || task.status}`;
    }
    throw new Error(`不支援的 v5 動作：${action.kind}`);
}

function buildTelegramV5InlineKeyboard(options = {}) {
    if (options.pending) {
        return { inline_keyboard: [[
            { text: "✅ 確認執行", callback_data: "v5_confirm" },
            { text: "取消", callback_data: "v5_cancel" },
        ]] };
    }
    if (options.task) {
        const taskId = String(options.task.id || "");
        return { inline_keyboard: [[
            { text: "開始處理", callback_data: `task_start:${taskId}`.slice(0, 64) },
            { text: "驗證改善", callback_data: `task_check:${taskId}`.slice(0, 64) },
            { text: "標記完成", callback_data: `task_done:${taskId}`.slice(0, 64) },
        ]] };
    }
    return null;
}

function detectTelegramScheduleSource(text = "") {
    const source = String(text || "");
    if (/(三個品牌|三品牌|全品牌).*(現金|權責)|(工作日晨報|三品牌晨報)/s.test(source)) return "weekday_morning_brief";
    if (/管理師.*(?:前|TOP|排行)/i.test(source)) return "top5_therapists";
    if (/(?:店家|門市).*(?:後|最差|最低|落後|需關注)/i.test(source)) return "bottom5_stores";
    if (/店家.*(?:前|TOP|最好|最佳)/i.test(source)) return "top5_stores";
    if (/缺報|未繳|未回報/.test(source)) return "unreported";
    return "progress";
}

function detectTelegramScheduleWeekdays(text = "") {
    const source = String(text || "");
    if (/工作日|平日|週一至週五|星期一至星期五/.test(source)) return [1, 2, 3, 4, 5];
    if (/每天|每日/.test(source)) return [0, 1, 2, 3, 4, 5, 6];
    const map = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    const matches = [...source.matchAll(/(?:週|星期)([日天一二三四五六])/g)].map((match) => map[match[1]]);
    return matches.length ? [...new Set(matches)] : [1, 2, 3, 4, 5];
}

async function parseTelegramV5Command(command, ctx, memoryPayload = {}, callbackData = "") {
    const raw = String(command || "").trim();
    const lower = raw.toLowerCase();
    const actor = getTelegramV5Actor(ctx);
    const permission = ctx.policyPermission || await loadTelegramAgentPolicyPermission(ctx.chatId, ctx.userId, ctx);
    ctx.policyPermission = permission;

    if (callbackData === "v5_confirm" || (memoryPayload.pendingV5Action && /^(確認|確定|是的|套用|確認執行|確認排程|確認任務)$/i.test(raw))) {
        const pending = memoryPayload.pendingV5Action;
        if (!pending) return { handled: false };
        const result = await executeTelegramPendingV5Action(pending, actor, ctx);
        await clearTelegramPendingV5Action(ctx.chatId, ctx.userId);
        return { handled: true, reply: result };
    }
    if (callbackData === "v5_cancel" || (memoryPayload.pendingV5Action && /^(取消|不要|不執行|取消執行|取消排程|取消任務)$/i.test(raw))) {
        if (!memoryPayload.pendingV5Action) return { handled: false };
        await clearTelegramPendingV5Action(ctx.chatId, ctx.userId);
        return { handled: true, reply: "已取消這次排程／任務操作。" };
    }
    if (callbackData.startsWith("task_alert:")) {
        const draftId = callbackData.slice("task_alert:".length);
        const snap = await getTelegramAgentTaskDraftsRef().doc(draftId).get();
        recordTelegramAgentRead(ctx, 1, "telegram_agent_task_drafts", { draftId });
        if (!snap.exists) return { handled: true, reply: "這筆巡察任務草稿已不存在，請重新執行巡察。" };
        const draft = snap.data() || {};
        const action = { kind: "create_task", task: draft.task || {}, taskDraftId: draftId };
        await saveTelegramPendingV5Action(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramV5PendingMessage(action) };
    }
    if (callbackData.startsWith("task_check:")) {
        const taskId = callbackData.split(":")[1];
        const task = await findTelegramTask(taskId, ctx);
        if (!task) return { handled: true, reply: "找不到這筆改善任務。" };
        const checked = await checkTelegramTaskOutcome(task, actor, ctx);
        return { handled: true, task: checked.task, reply: checked.message };
    }
    if (callbackData.startsWith("task_start:") || callbackData.startsWith("task_done:")) {
        const isDone = callbackData.startsWith("task_done:");
        const taskId = callbackData.split(":")[1];
        const task = await updateTelegramTask(taskId, {
            status: isDone ? "completed" : "in_progress",
            ...(isDone ? { resultText: "由 Telegram 按鈕標記完成" } : {}),
        }, actor, ctx, "callback_status_change");
        return { handled: true, task, reply: `✅ ${task.taskCode}\n${TELEGRAM_V5_TASK_STATUS_LABELS[task.status]}` };
    }

    if (/^\/snapshots$/i.test(raw) || /查看.*快照|最近.*快照/.test(raw)) {
        const snapshots = await loadTelegramReportSnapshots(ctx, { limit: 50 });
        return { handled: true, reply: formatTelegramSnapshotList(snapshots) };
    }
    const snapshotRead = raw.match(/^\/snapshot\s+(.+)/i);
    if (snapshotRead) {
        const snapshot = await findTelegramReportSnapshot(snapshotRead[1], ctx);
        if (!snapshot) return { handled: true, reply: "找不到這份報表快照。" };
        return {
            handled: true,
            reply: `${snapshot.messagePreview || "此快照沒有訊息預覽"}\n\n資料截止：${snapshot.cutoffAtText || snapshot.cutoffDate || "-"}\n報表快照：${snapshot.snapshotId || snapshot.id}｜口徑：${snapshot.metricVersion || "-"}`,
        };
    }
    if (/重新顯示.*(?:晨報|戰報)|今天.*(?:10點|10:00).*快照/.test(raw)) {
        const snapshots = await loadTelegramReportSnapshots(ctx, { limit: 100 });
        const today = getTelegramAlertTaipeiClock().todayStr;
        const found = snapshots.find((row) => String(row.runKey || "").startsWith(today) && row.reportType === "weekday_morning_brief") || snapshots.find((row) => row.reportType === "weekday_morning_brief");
        if (!found) return { handled: true, reply: "目前找不到工作日晨報快照。" };
        return { handled: true, reply: `${found.messagePreview}\n\n資料截止：${found.cutoffAtText || found.cutoffDate}\n報表快照：${found.snapshotId}` };
    }

    if (/^\/(schedules|schedule)$/i.test(raw) || /查看.*排程|目前.*排程/.test(raw)) {
        const schedules = await loadTelegramSchedules(ctx, { includeInactive: true, limit: 100 });
        return { handled: true, reply: formatTelegramScheduleList(schedules) };
    }
    if (/^\/tasks$/i.test(raw) || /查看.*(?:改善)?任務|目前.*待辦/.test(raw)) {
        const tasks = await loadTelegramTasks(ctx, { statuses: ["open", "in_progress", "overdue"], limit: 100 });
        return { handled: true, reply: formatTelegramTaskList(tasks), tasks };
    }
    const taskRead = raw.match(/^\/task\s+(.+)/i);
    if (taskRead) {
        const task = await findTelegramTask(taskRead[1], ctx);
        if (!task) return { handled: true, reply: "找不到這筆改善任務。" };
        return {
            handled: true,
            task,
            reply: `${task.taskCode}\n${task.title}\n狀態：${TELEGRAM_V5_TASK_STATUS_LABELS[task.status] || task.status}\n負責人：${task.ownerName}\n期限：${task.dueDate || "未設定"}\n目標：${task.targetText || "未設定"}\n${task.description || ""}`,
        };
    }
    const taskCheck = raw.match(/^\/taskcheck\s+(.+)/i);
    if (taskCheck) {
        const task = await findTelegramTask(taskCheck[1], ctx);
        if (!task) return { handled: true, reply: "找不到這筆改善任務。" };
        const checked = await checkTelegramTaskOutcome(task, actor, ctx);
        return { handled: true, task: checked.task, reply: checked.message };
    }
    const taskDone = raw.match(/^\/taskdone\s+(.+)/i);
    if (taskDone) {
        const task = await findTelegramTask(taskDone[1], ctx);
        if (!task) return { handled: true, reply: "找不到這筆改善任務。" };
        const action = { kind: "update_task", taskId: task.id, taskCode: task.taskCode, patch: { status: "completed", resultText: "由指令標記完成" } };
        await saveTelegramPendingV5Action(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramV5PendingMessage(action) };
    }

    const deleteSchedule = raw.match(/(?:刪除|取消|停用)(?:固定)?排程\s*[：:]?\s*(.+)/);
    if (deleteSchedule) {
        const schedule = await findTelegramSchedule(deleteSchedule[1], ctx, true);
        if (!schedule) return { handled: true, reply: "找不到指定排程，請先使用 /schedules。" };
        assertTelegramSchedulePermission(permission, schedule);
        const action = { kind: "delete_schedule", scheduleId: schedule.id, scheduleCode: schedule.scheduleCode, scheduleName: schedule.name };
        await saveTelegramPendingV5Action(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramV5PendingMessage(action) };
    }
    const pauseSchedule = raw.match(/暫停(.+?)(?:排程)?(?:到|至)(.+)/);
    if (pauseSchedule) {
        const schedule = await findTelegramSchedule(pauseSchedule[1].replace(/排程/g, "").trim(), ctx, true);
        if (!schedule) return { handled: true, reply: "找不到指定排程，請先使用 /schedules。" };
        const pausedUntil = parseTelegramDateText(pauseSchedule[2]);
        if (!pausedUntil) return { handled: true, reply: "請提供明確的暫停截止日期。" };
        assertTelegramSchedulePermission(permission, schedule);
        const action = { kind: "pause_schedule", scheduleId: schedule.id, scheduleCode: schedule.scheduleCode, scheduleName: schedule.name, pausedUntil };
        await saveTelegramPendingV5Action(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramV5PendingMessage(action) };
    }
    const updateTime = raw.match(/(?:把|將)(.+?)(?:排程)?改成\s*(.+)/);
    if (updateTime) {
        const schedule = await findTelegramSchedule(updateTime[1].replace(/排程/g, "").trim(), ctx, true);
        const time = parseTelegramTimeText(updateTime[2]);
        if (schedule && time) {
            assertTelegramSchedulePermission(permission, schedule);
            const action = { kind: "update_schedule", scheduleId: schedule.id, scheduleCode: schedule.scheduleCode, scheduleName: schedule.name, patch: { time } };
            await saveTelegramPendingV5Action(ctx.chatId, ctx.userId, action);
            return { handled: true, pending: true, reply: buildTelegramV5PendingMessage(action) };
        }
    }

    const isScheduleCreate = /(每週|每天|每日|工作日|平日|週一|星期一).*(?:\d{1,2}\s*[:：點]|早上|上午|下午|晚上).*(提供|發送|推播|戰報|晨報)/s.test(raw);
    if (isScheduleCreate) {
        const source = detectTelegramScheduleSource(raw);
        const time = parseTelegramTimeText(raw, "10:00");
        const weekdays = detectTelegramScheduleWeekdays(raw);
        const targetGroup = /營運大群組|全體群組|主群組/.test(raw) ? "main" : "manager";
        const targetChatId = /提供我|傳給我|這個群組|目前群組/.test(raw) ? String(ctx.chatId) : "";
        const name = source === "weekday_morning_brief" ? "三品牌工作日晨報" : `${TELEGRAM_V5_SCHEDULE_SOURCES[source]} ${time}`;
        const schedule = {
            name,
            source,
            reportType: source,
            time,
            weekdays,
            targetGroup,
            targetChatId,
            isActive: true,
            cutoffMode: source === "progress" && /即時|目前/.test(raw) ? "current" : "yesterday",
            topCount: 3,
            bottomCount: 3,
            includeMissingReports: true,
            brandIds: source === "weekday_morning_brief"
                ? ["cyj", "anniu", "yibo"]
                : (getTelegramAgentExplicitBrandId(raw) ? [getTelegramAgentExplicitBrandId(raw)] : []),
        };
        assertTelegramSchedulePermission(permission, schedule);
        const action = { kind: "create_schedule", schedule };
        await saveTelegramPendingV5Action(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramV5PendingMessage(action) };
    }

    if (/建立(?:改善)?任務|新增(?:改善)?任務|指派任務/.test(raw)) {
        const preferredBrandId = getTelegramAgentExplicitBrandId(raw) || ctx.scopeState?.activeBrandId || "";
        const storeMatches = await resolveTelegramPolicyStoreMention(raw, preferredBrandId, ctx);
        const store = storeMatches[0] || null;
        const ownerMatch = raw.match(/負責人\s*[：:]?\s*([^，,。\n]+?)(?=期限|目標|$)/);
        const targetMatch = raw.match(/目標\s*[：:]?\s*([^。\n]+)/);
        const dueDate = parseTelegramDateText(raw);
        const task = {
            title: store ? `改善 ${getTelegramAgentBrandLabel(store.brandId)} ${store.storeName}店營運表現` : "營運改善任務",
            description: raw,
            brandId: store?.brandId || preferredBrandId,
            storeName: store?.storeName || "",
            ownerName: ownerMatch ? ownerMatch[1].trim() : "待指派",
            dueDate,
            targetText: targetMatch ? targetMatch[1].trim() : "",
            status: "open",
            priority: /重大|緊急|紅燈/.test(raw) ? "critical" : "normal",
            sourceType: "telegram_natural_language",
        };
        assertTelegramTaskPermission(permission, task);
        const action = { kind: "create_task", task };
        await saveTelegramPendingV5Action(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramV5PendingMessage(action) };
    }

    return { handled: false };
}

function getTelegramAgentPolicyRuntimeCache(key) {
    const item = TELEGRAM_AGENT_POLICY_RUNTIME_CACHE[key];
    if (!item) return null;
    if ((Date.now() - Number(item.createdAtMs || 0)) > TELEGRAM_AGENT_POLICY_CACHE_TTL_MS) {
        TELEGRAM_AGENT_POLICY_RUNTIME_CACHE[key] = null;
        return null;
    }
    return item.value;
}

function setTelegramAgentPolicyRuntimeCache(key, value) {
    TELEGRAM_AGENT_POLICY_RUNTIME_CACHE[key] = {
        createdAtMs: Date.now(),
        value,
    };
}

function invalidateTelegramAgentPolicyRuntimeCache(options = {}) {
    if (options.permissions !== false) TELEGRAM_AGENT_POLICY_RUNTIME_CACHE.permissionDoc = null;
    if (options.policies !== false) {
        TELEGRAM_AGENT_POLICY_RUNTIME_CACHE.activeCatalog = null;
        TELEGRAM_AGENT_POLICY_RUNTIME_CACHE.allCatalog = null;
    }
}

function normalizeTelegramPolicyDate(value = "") {
    const text = String(value || "").trim().replace(/\//g, "-");
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function getTelegramPolicyToday() {
    return getTelegramAgentTaipeiNow().todayStr;
}

function isTelegramPolicyActive(policy = {}, today = getTelegramPolicyToday()) {
    if (policy.enabled === false || String(policy.status || "active") !== "active") return false;
    const from = normalizeTelegramPolicyDate(policy.effectiveFrom || "");
    const until = normalizeTelegramPolicyDate(policy.effectiveUntil || "");
    if (from && today < from) return false;
    if (until && today > until) return false;
    return true;
}

function normalizeTelegramPolicyScopes(values = []) {
    const source = Array.isArray(values) ? values : [values];
    return [...new Set(source.map(String).filter((value) => TELEGRAM_AGENT_POLICY_SCOPES.includes(value)))];
}

function getTelegramPolicyConflictKey(policy = {}) {
    const type = String(policy.type || "").trim();
    const brandId = normalizeTelegramAgentBrandId(policy.brandId || "") || String(policy.brandId || "global");
    if (type === "exclude_store") {
        return `${type}:${brandId}:${normalizeSummaryCoreName(policy.storeCore || policy.storeName || "")}`;
    }
    if (type === "alert_rule") {
        return `${type}:${brandId}:${String(policy.ruleId || "")}`;
    }
    if (type === "response_preference") {
        return `${type}:${String(policy.userId || "global")}:${String(policy.preferenceKey || "generic")}`;
    }
    return `${type}:${brandId}:${String(policy.policyCode || policy.id || "generic")}`;
}

function normalizeTelegramAgentPolicy(raw = {}, id = "") {
    const type = ["exclude_store", "alert_rule", "response_preference"].includes(String(raw.type || ""))
        ? String(raw.type)
        : "response_preference";
    const brandId = normalizeTelegramAgentBrandId(raw.brandId || "") || "";
    const storeCore = normalizeSummaryCoreName(raw.storeCore || raw.storeName || "");
    const ownerScope = raw.ownerScope === "user" ? "user" : (raw.ownerScope === "brand" ? "brand" : "global");
    const sourceText = String(raw.sourceText || "").slice(0, 1200);
    let scopes = normalizeTelegramPolicyScopes(raw.scopes || []);
    if (type === "exclude_store" && isTelegramPolicyAllDataExclusionText(sourceText)) {
        scopes = [...TELEGRAM_AGENT_ALL_EXCLUSION_SCOPES];
    }
    const policy = {
        id: String(id || raw.id || ""),
        policyCode: String(raw.policyCode || ""),
        schemaVersion: Number(raw.schemaVersion || TELEGRAM_AGENT_POLICY_SCHEMA_VERSION),
        type,
        ownerScope,
        brandId,
        storeCore,
        storeName: String(raw.storeName || storeCore || ""),
        scopes: scopes.length ? scopes : (type === "exclude_store" ? ["telegram_analysis"] : []),
        excludeFromBrandTotals: raw.excludeFromBrandTotals === true || scopes.includes("brand_totals"),
        ruleId: String(raw.ruleId || ""),
        value: raw.value && typeof raw.value === "object" ? raw.value : {},
        preferenceKey: String(raw.preferenceKey || "generic"),
        instruction: String(raw.instruction || "").slice(0, 800),
        userId: String(raw.userId || ""),
        chatId: String(raw.chatId || ""),
        enabled: raw.enabled !== false,
        status: String(raw.status || "active"),
        priority: Math.max(0, Math.min(999, Number(raw.priority || 100))),
        effectiveFrom: normalizeTelegramPolicyDate(raw.effectiveFrom || ""),
        effectiveUntil: normalizeTelegramPolicyDate(raw.effectiveUntil || ""),
        sourceText,
        source: String(raw.source || "telegram"),
        createdByUserId: String(raw.createdByUserId || raw.userId || ""),
        createdByName: String(raw.createdByName || ""),
        createdAtText: String(raw.createdAtText || ""),
        updatedAtText: String(raw.updatedAtText || ""),
        conflictKey: String(raw.conflictKey || ""),
        revision: Math.max(1, Number(raw.revision || 1)),
    };
    policy.conflictKey = policy.conflictKey || getTelegramPolicyConflictKey(policy);
    return policy;
}

async function loadTelegramAgentPolicyPermission(chatId, userId, ctx = null, options = {}) {
    if (ctx?.policyPermission && options.forceReload !== true) return ctx.policyPermission;

    let data = null;
    const cached = options.forceReload === true ? null : getTelegramAgentPolicyRuntimeCache("permissionDoc");
    if (cached) {
        data = cached;
        recordTelegramAgentRead(ctx, 0, "telegram_agent_policy_permissions", { cacheHit: true });
    } else {
        const result = await readTelegramAgentDoc(
            getTelegramAgentPolicyPermissionsRef(),
            ctx,
            "telegram_agent_policy_permissions",
            {},
            0
        );
        data = result.exists ? (result.data || {}) : {};
        setTelegramAgentPolicyRuntimeCache("permissionDoc", data);
    }

    const users = data.users && typeof data.users === "object" ? data.users : {};
    const configuredIds = Object.keys(users);
    const configured = users[String(userId)] || null;
    let role = "viewer";
    let brandIds = [];
    let source = "configured";

    if (configured && configured.enabled !== false) {
        role = ["director", "brand_manager", "viewer"].includes(configured.role) ? configured.role : "viewer";
        brandIds = Array.isArray(configured.brandIds)
            ? configured.brandIds.map(normalizeTelegramAgentBrandId).filter(Boolean)
            : [];
    } else if (configuredIds.length === 0) {
        source = "group_default";
        if (String(chatId) === String(TARGET_CHAT_ID_MAIN)) {
            role = "director";
            brandIds = BRANDS.map((item) => item.id);
        } else if (String(chatId) === String(TARGET_CHAT_ID_MANAGER)) {
            role = "brand_manager";
            brandIds = BRANDS.map((item) => item.id);
        }
    }

    const permission = {
        role,
        brandIds: [...new Set(brandIds)],
        canManageGlobal: role === "director",
        canManageBrand: role === "director" || role === "brand_manager",
        canManagePersonal: role !== "viewer" || Boolean(configured?.allowPersonalPreferences),
        source,
    };
    if (ctx) ctx.policyPermission = permission;
    return permission;
}

function assertTelegramPolicyPermission(permission = {}, policy = {}) {
    if (policy.type === "response_preference" && policy.ownerScope === "user") {
        if (!permission.canManagePersonal) throw new Error("目前帳號沒有建立個人偏好的權限");
        return;
    }
    if (!permission.canManageBrand) throw new Error("目前帳號只有查詢權限，不能修改正式營運規則");
    const brandId = normalizeTelegramAgentBrandId(policy.brandId || "");
    if (permission.role === "brand_manager" && brandId && !permission.brandIds.includes(brandId)) {
        throw new Error(`目前帳號沒有修改 ${getTelegramAgentBrandLabel(brandId)} 規則的權限`);
    }
    if (!brandId && !permission.canManageGlobal) throw new Error("只有 director 可以建立全公司規則");
}

async function loadTelegramAgentPolicyCatalog(ctx, options = {}) {
    const includeInactive = options.includeInactive === true;
    const requiredMode = includeInactive ? "all" : "active";
    if (
        Array.isArray(ctx?.policyCatalog) &&
        options.forceReload !== true &&
        (ctx.policyCatalogMode === "all" || ctx.policyCatalogMode === requiredMode)
    ) {
        return ctx.policyCatalog;
    }

    const cacheKey = includeInactive ? "allCatalog" : "activeCatalog";
    const cached = options.forceReload === true ? null : getTelegramAgentPolicyRuntimeCache(cacheKey);
    let policies;
    if (cached) {
        policies = cached;
        recordTelegramAgentRead(ctx, 0, "telegram_agent_policies", { cacheHit: true });
    } else {
        const baseRef = getTelegramAgentPoliciesRef();
        const queryRef = includeInactive ? baseRef : baseRef.where("status", "==", "active");
        const result = await queryTelegramAgentDocs(
            queryRef,
            `query:${baseRef.path}:${requiredMode}`,
            ctx,
            "telegram_agent_policies",
            { catalogMode: requiredMode },
            0
        );
        policies = result.rows.map((row) => normalizeTelegramAgentPolicy(row, row.id));
        setTelegramAgentPolicyRuntimeCache(cacheKey, policies);
    }

    if (ctx) {
        ctx.policyCatalog = policies;
        ctx.policyCatalogMode = requiredMode;
    }
    return policies;
}

function applyTelegramAgentPolicyState(ctx, policies = [], permission = null, options = {}) {
    if (!ctx) return { policies: [], activePolicies: [], permission: permission || { role: "viewer", brandIds: [] } };
    const today = getTelegramPolicyToday();
    const relevant = policies.filter((policy) => {
        if (policy.ownerScope === "user" && policy.userId !== String(ctx.userId)) return false;
        if (!options.includeInactive && !isTelegramPolicyActive(policy, today)) return false;
        return true;
    }).sort((a, b) => (Number(b.priority || 0) - Number(a.priority || 0)) || String(b.updatedAtText || b.createdAtText).localeCompare(String(a.updatedAtText || a.createdAtText)));
    const transientPolicies = Array.isArray(ctx.transientPolicies)
        ? ctx.transientPolicies.map((item, index) => normalizeTelegramAgentPolicy({ ...item, source: "one_shot" }, `one-shot-${index}`))
        : [];
    ctx.policyPermission = permission || ctx.policyPermission || { role: "viewer", brandIds: [] };
    ctx.policies = [...transientPolicies, ...relevant];
    ctx.activePolicyIds = [];
    ctx.policyConflicts = detectTelegramPolicyConflicts(ctx.policies);
    ctx.policyStateLoaded = true;
    return { policies, activePolicies: ctx.policies, permission: ctx.policyPermission };
}

async function loadTelegramAgentPolicyState(ctx, options = {}) {
    if (!ctx) return { policies: [], activePolicies: [], permission: { role: "viewer", brandIds: [] } };
    const permission = options.skipPermission === true
        ? (ctx.policyPermission || { role: "viewer", brandIds: [] })
        : await loadTelegramAgentPolicyPermission(ctx.chatId, ctx.userId, ctx, options);
    const policies = await loadTelegramAgentPolicyCatalog(ctx, options);
    return applyTelegramAgentPolicyState(ctx, policies, permission, options);
}

function detectTelegramPolicyConflicts(policies = []) {
    const groups = {};
    policies.filter((policy) => isTelegramPolicyActive(policy)).forEach((policy) => {
        const key = policy.conflictKey || getTelegramPolicyConflictKey(policy);
        if (!groups[key]) groups[key] = [];
        groups[key].push(policy);
    });
    return Object.entries(groups)
        .filter(([, rows]) => rows.length > 1)
        .map(([conflictKey, rows]) => ({ conflictKey, policyIds: rows.map((row) => row.id), count: rows.length }));
}

function getTelegramPolicyExcludedStoreSet(ctx, brandId, scopes = ["telegram_analysis"]) {
    const requested = new Set(normalizeTelegramPolicyScopes(scopes));
    const excluded = new Set();
    (ctx?.policies || []).forEach((policy) => {
        if (!isTelegramPolicyActive(policy) || policy.type !== "exclude_store") return;
        if (policy.brandId && policy.brandId !== brandId) return;
        if (!policy.scopes.some((scope) => requested.has(scope))) return;
        const storeCore = normalizeSummaryCoreName(policy.storeCore || policy.storeName || "");
        if (storeCore) {
            excluded.add(storeCore);
            if (policy.id && !String(policy.id).startsWith("one-shot-")) ctx.activePolicyIds.push(policy.policyCode || policy.id);
        }
    });
    return excluded;
}

function filterTelegramAgentRowsByPolicies(rows = [], brandId, ctx, scopes = ["telegram_analysis"]) {
    const excluded = getTelegramPolicyExcludedStoreSet(ctx, brandId, scopes);
    if (!excluded.size) return rows;
    return rows.filter((row) => !excluded.has(normalizeSummaryCoreName(row.storeName || row.store || "")));
}

function filterTelegramAgentStoresByPolicies(stores = [], brandId, ctx, scopes = ["telegram_analysis"]) {
    const excluded = getTelegramPolicyExcludedStoreSet(ctx, brandId, scopes);
    // 這裡是實際營運範圍，不可套用對話 scope 的 20 家上限。
    return normalizeTelegramAgentStoreNamesFull(stores || []).filter((store) => !excluded.has(store));
}

function applyTelegramAgentAlertPolicies(baseRules = {}, brandId, ctx) {
    const rules = JSON.parse(JSON.stringify(baseRules || {}));
    const candidates = (ctx?.policies || []).filter((policy) =>
        isTelegramPolicyActive(policy) &&
        policy.type === "alert_rule" &&
        (!policy.brandId || policy.brandId === brandId)
    );
    candidates.reverse().forEach((policy) => {
        const ruleId = String(policy.ruleId || "");
        const value = policy.value && typeof policy.value === "object" ? policy.value : {};
        if (ruleId === "limit") return;
        if (!rules[ruleId]) rules[ruleId] = {};
        rules[ruleId] = { ...rules[ruleId], ...value };
        if (policy.id) ctx.activePolicyIds.push(policy.policyCode || policy.id);
    });
    return normalizeTelegramActiveAlertRules(rules);
}

function getTelegramAgentAlertLimit(baseLimit, brandId, ctx) {
    let value = Math.min(20, Math.max(1, Number(baseLimit) || 8));
    const policies = (ctx?.policies || []).filter((policy) =>
        isTelegramPolicyActive(policy) && policy.type === "alert_rule" && policy.ruleId === "limit" && (!policy.brandId || policy.brandId === brandId)
    );
    policies.reverse().forEach((policy) => {
        const next = Number(policy.value?.limit ?? policy.value?.threshold);
        if (Number.isFinite(next)) value = Math.min(20, Math.max(1, Math.round(next)));
        if (policy.id) ctx.activePolicyIds.push(policy.policyCode || policy.id);
    });
    return value;
}

function getTelegramAgentPreferenceInstructions(ctx) {
    return (ctx?.policies || [])
        .filter((policy) => isTelegramPolicyActive(policy) && policy.type === "response_preference" && policy.instruction)
        .map((policy) => {
            if (policy.id) ctx.activePolicyIds.push(policy.policyCode || policy.id);
            return policy.instruction;
        })
        .slice(0, 12);
}

function formatTelegramAgentPolicyContext(ctx, options = {}) {
    const command = String(options.command || ctx?.question || "");
    const explicitBrandId = getTelegramAgentExplicitBrandId(command);
    const activeBrandId = explicitBrandId || normalizeTelegramAgentBrandId(ctx?.scopeState?.activeBrandId || "");
    const analysisScopes = new Set(["telegram_analysis", "ranking", "brand_totals"]);
    const alertIntent = /(?:\/alerts|主動巡察|主動預警|預警門檻|警示規則)/i.test(command);
    const active = (ctx?.policies || []).filter((policy) => {
        if (!isTelegramPolicyActive(policy)) return false;
        if (policy.type === "response_preference") return true;
        if (activeBrandId && policy.brandId && policy.brandId !== activeBrandId) return false;
        if (policy.type === "exclude_store") {
            return policy.scopes.some((scope) => analysisScopes.has(scope));
        }
        if (policy.type === "alert_rule") return alertIntent;
        return false;
    });
    if (!active.length) return "（無與本題相關的長期規則）";
    return active.slice(0, 10).map((policy) => {
        if (policy.type === "exclude_store") {
            const scopes = policy.scopes
                .filter((scope) => analysisScopes.has(scope))
                .map((scope) => TELEGRAM_AGENT_POLICY_SCOPE_LABELS[scope] || scope)
                .join("、");
            return `- 排除 ${getTelegramAgentBrandLabel(policy.brandId)} ${policy.storeName || policy.storeCore}店：${scopes}`;
        }
        if (policy.type === "alert_rule") {
            return `- ${getTelegramAgentBrandLabel(policy.brandId)} ${TELEGRAM_AGENT_POLICY_RULE_LABELS[policy.ruleId] || policy.ruleId} 覆寫：${JSON.stringify(policy.value)}`;
        }
        return `- 回答偏好：${policy.instruction}`;
    }).join("\n");
}

function getTelegramPolicyActor(message = {}, ctx = {}) {
    return {
        chatId: String(message?.chat?.id || ctx?.chatId || ""),
        userId: String(message?.from?.id || ctx?.userId || ""),
        userName: [message?.from?.first_name, message?.from?.last_name].filter(Boolean).join(" ") || String(message?.from?.username || ""),
    };
}

async function writeTelegramPolicyAudit(action, policy, actor, details = {}) {
    await getTelegramAgentPolicyAuditsRef().add({
        schemaVersion: TELEGRAM_AGENT_POLICY_SCHEMA_VERSION,
        action,
        policyId: String(policy?.id || ""),
        policyCode: String(policy?.policyCode || ""),
        conflictKey: String(policy?.conflictKey || ""),
        policySnapshot: policy || {},
        actor: actor || {},
        details,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtText: new Date().toISOString(),
    });
}

async function createTelegramAgentPolicy(input, actor, ctx) {
    const nowText = new Date().toISOString();
    const policyRef = getTelegramAgentPoliciesRef().doc();
    const policy = normalizeTelegramAgentPolicy({
        ...input,
        id: policyRef.id,
        policyCode: input.policyCode || `POL-${getTelegramPolicyToday().replace(/-/g, "")}-${policyRef.id.slice(0, 6).toUpperCase()}`,
        createdByUserId: actor.userId,
        createdByName: actor.userName,
        chatId: actor.chatId,
        userId: input.ownerScope === "user" ? actor.userId : String(input.userId || ""),
        createdAtText: nowText,
        updatedAtText: nowText,
        enabled: true,
        status: "active",
    }, policyRef.id);
    assertTelegramPolicyPermission(ctx?.policyPermission || {}, policy);

    const conflictQuery = getTelegramAgentPoliciesRef().where("conflictKey", "==", policy.conflictKey);
    const existingResult = await queryTelegramAgentDocs(
        conflictQuery,
        `query:${getTelegramAgentPoliciesRef().path}:conflict:${policy.conflictKey}`,
        ctx,
        "telegram_agent_policies",
        { conflictKey: policy.conflictKey },
        0
    );
    const conflicts = existingResult.rows
        .map((row) => normalizeTelegramAgentPolicy(row, row.id))
        .filter((row) => row.id !== policy.id && isTelegramPolicyActive(row) && row.conflictKey === policy.conflictKey);

    const batch = db.batch();
    conflicts.forEach((row) => {
        batch.set(getTelegramAgentPoliciesRef().doc(row.id), {
            enabled: false,
            status: "superseded",
            supersededByPolicyId: policy.id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: nowText,
        }, { merge: true });
    });
    batch.set(policyRef, {
        ...policy,
        conflictsResolved: conflicts.map((row) => row.id),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    if (ctx) ctx.writeCount += conflicts.length + 1;
    invalidateTelegramAgentPolicyRuntimeCache({ permissions: false, policies: true });
    if (ctx && Array.isArray(ctx.policyCatalog)) {
        const conflictIds = new Set(conflicts.map((row) => row.id));
        ctx.policyCatalog = [
            ...ctx.policyCatalog.filter((row) => !conflictIds.has(row.id) && row.id !== policy.id),
            policy,
        ];
        applyTelegramAgentPolicyState(ctx, ctx.policyCatalog, ctx.policyPermission || null);
    }
    await writeTelegramPolicyAudit("create", policy, actor, { supersededPolicyIds: conflicts.map((row) => row.id) });
    return policy;
}

async function setTelegramAgentPolicyEnabled(policyId, enabled, actor, ctx, reason = "manual") {
    const ref = getTelegramAgentPoliciesRef().doc(String(policyId));
    let before = Array.isArray(ctx?.policyCatalog)
        ? ctx.policyCatalog.find((row) => row.id === String(policyId)) || null
        : null;
    if (!before) {
        const result = await readTelegramAgentDoc(ref, ctx, "telegram_agent_policies", { policyId: String(policyId) }, 0);
        if (!result.exists) throw new Error("找不到指定規則");
        before = normalizeTelegramAgentPolicy(result.data || {}, result.id);
    }
    assertTelegramPolicyPermission(ctx?.policyPermission || {}, before);
    const nowText = new Date().toISOString();
    await ref.set({
        enabled: Boolean(enabled),
        status: enabled ? "active" : "inactive",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: nowText,
        updatedByUserId: actor.userId,
        updatedByName: actor.userName,
        statusReason: reason,
    }, { merge: true });
    if (ctx) ctx.writeCount += 1;
    const after = { ...before, enabled: Boolean(enabled), status: enabled ? "active" : "inactive", updatedAtText: nowText };
    invalidateTelegramAgentPolicyRuntimeCache({ permissions: false, policies: true });
    if (ctx && Array.isArray(ctx.policyCatalog)) {
        const nextCatalog = ctx.policyCatalog.filter((row) => row.id !== before.id);
        if (enabled || ctx.policyCatalogMode === "all") nextCatalog.push(after);
        ctx.policyCatalog = nextCatalog;
        applyTelegramAgentPolicyState(ctx, ctx.policyCatalog, ctx.policyPermission || null, { includeInactive: ctx.policyCatalogMode === "all" });
    }
    await writeTelegramPolicyAudit(enabled ? "reactivate" : "deactivate", after, actor, { before, reason });
    return { before, after };
}

async function findTelegramAgentPolicy(identifier, ctx, includeInactive = true) {
    const needle = String(identifier || "").trim();
    const lowered = needle.toLowerCase();
    const local = Array.isArray(ctx?.policyCatalog)
        ? ctx.policyCatalog.find((row) =>
            (includeInactive || isTelegramPolicyActive(row)) &&
            [row.id, row.policyCode].some((value) => String(value || "").toLowerCase() === lowered)
        )
        : null;
    if (local) return local;

    let result = null;
    if (/^POL-/i.test(needle)) {
        const snap = await getTelegramAgentPoliciesRef().where("policyCode", "==", needle).limit(1).get();
        recordTelegramAgentRead(ctx, Math.max(1, snap.size), "telegram_agent_policies", { lookup: "policyCode" });
        if (!snap.empty) result = normalizeTelegramAgentPolicy(snap.docs[0].data() || {}, snap.docs[0].id);
    } else {
        const readResult = await readTelegramAgentDoc(
            getTelegramAgentPoliciesRef().doc(needle),
            ctx,
            "telegram_agent_policies",
            { lookup: "documentId" },
            0
        );
        if (readResult.exists) result = normalizeTelegramAgentPolicy(readResult.data || {}, readResult.id);
    }
    if (!result || (!includeInactive && !isTelegramPolicyActive(result))) return null;
    return result;
}

async function listTelegramAgentPoliciesText(ctx, options = {}) {
    const state = await loadTelegramAgentPolicyState(ctx, { includeInactive: options.includeInactive === true });
    const rows = state.activePolicies.filter((policy) => options.includeInactive === true || isTelegramPolicyActive(policy));
    if (!rows.length) return { text: "目前沒有生效中的長期規則。", rows: [] };
    const lines = ["目前生效的長期規則："];
    rows.slice(0, 30).forEach((policy, index) => {
        if (policy.type === "exclude_store") {
            const scopes = policy.scopes.map((scope) => TELEGRAM_AGENT_POLICY_SCOPE_LABELS[scope] || scope).join("、");
            lines.push(`${index + 1}. ${policy.policyCode || policy.id}｜排除 ${getTelegramAgentBrandLabel(policy.brandId)} ${policy.storeName || policy.storeCore}店｜${scopes}${policy.effectiveUntil ? `｜至 ${policy.effectiveUntil}` : ""}`);
        } else if (policy.type === "alert_rule") {
            lines.push(`${index + 1}. ${policy.policyCode || policy.id}｜${getTelegramAgentBrandLabel(policy.brandId)} ${TELEGRAM_AGENT_POLICY_RULE_LABELS[policy.ruleId] || policy.ruleId}｜${JSON.stringify(policy.value)}${policy.effectiveUntil ? `｜至 ${policy.effectiveUntil}` : ""}`);
        } else {
            lines.push(`${index + 1}. ${policy.policyCode || policy.id}｜個人偏好｜${policy.instruction}`);
        }
    });
    if (state.activePolicies.length > 30) lines.push(`…另有 ${state.activePolicies.length - 30} 條`);
    if (ctx.policyConflicts?.length) lines.push(`⚠️ 偵測到 ${ctx.policyConflicts.length} 組規則衝突，系統每日會自動整理。`);
    return { text: lines.join("\n"), rows };
}

function parseTelegramPolicyEffectiveUntil(text, dateInfo) {
    const command = String(text || "");
    const full = command.match(/(?:到|至|直到)\s*(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (full) return `${full[1]}-${String(full[2]).padStart(2, "0")}-${String(full[3]).padStart(2, "0")}`;
    const short = command.match(/(?:到|至|直到)\s*(\d{1,2})月(\d{1,2})日/);
    if (short) return `${dateInfo.year}-${String(short[1]).padStart(2, "0")}-${String(short[2]).padStart(2, "0")}`;
    if (/(到|至|直到)月底/.test(command)) return getTelegramAgentMonthEnd(dateInfo.yearMonth);
    return "";
}

function parseTelegramPolicyScopes(text) {
    const command = String(text || "");
    if (isTelegramPolicyAllDataExclusionText(command)) {
        return [...TELEGRAM_AGENT_ALL_EXCLUSION_SCOPES];
    }
    const scopes = [];
    if (/一般分析|Telegram分析|戰情分析/.test(command)) scopes.push("telegram_analysis");
    if (/排名|排行/.test(command)) scopes.push("ranking");
    if (/品牌總計|品牌加總|總業績/.test(command)) scopes.push("brand_totals");
    if (/主動巡察|主動預警|預警推播|固定排程|定時推播/.test(command)) scopes.push("active_alert");
    if (/缺報|回報檢核|資料檢核|日報未繳交/.test(command)) scopes.push("data_audit");
    return normalizeTelegramPolicyScopes(scopes.length ? scopes : ["telegram_analysis"]);
}

async function resolveTelegramPolicyStoreMention(command, preferredBrandId, ctx) {
    const compact = String(command || "").replace(/\s+/g, "");
    const brands = preferredBrandId ? [preferredBrandId] : BRANDS.map((item) => item.id);
    const matches = [];
    for (const brandId of brands) {
        const org = await loadTelegramAgentOrgProfile(brandId, ctx);
        (org.stores || []).forEach((storeCore) => {
            const core = normalizeSummaryCoreName(storeCore);
            if (!core) return;
            const variants = [core, `${core}店`, `${getSummaryBrandPrefix(brandId)}${core}店`].filter(Boolean);
            if (variants.some((variant) => compact.includes(String(variant).replace(/\s+/g, "")))) {
                matches.push({ brandId, storeCore: core, storeName: core });
            }
        });
    }
    const unique = [...new Map(matches.map((item) => [`${item.brandId}:${item.storeCore}`, item])).values()];
    unique.sort((a, b) => b.storeCore.length - a.storeCore.length);
    return unique;
}

function detectTelegramAlertRuleIntent(command) {
    const text = String(command || "");
    const definitions = [
        ["progressGap", /現金進度差距|現金進度|進度落後/],
        ["cashAchievementRate", /現金業績達成率|現金達成率/],
        ["closingRate", /新客締結率|締結率/],
        ["skincareRatio", /保養品占比/],
        ["newCustomers", /本月新客數|新客數/],
        ["traffic", /本月來客人次|來客人次|課程操作/],
        ["missingReport", /店家日報缺漏|日報缺漏|缺報/],
        ["missingTarget", /現金目標缺漏|目標缺漏/],
        ["limit", /最多顯示|顯示上限/],
    ];
    const found = definitions.find(([, pattern]) => pattern.test(text));
    if (!found) return null;
    const ruleId = found[0];
    const disable = /不需要判斷|不要判斷|停用|關閉|取消判斷/.test(text);
    const enable = /啟用|開始判斷|納入判斷|重新判斷/.test(text);
    const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(%|％|百分點|人次|人|家)?/g)].map((match) => Number(match[1]));
    const value = {};
    if (disable) value.enabled = false;
    if (enable) value.enabled = true;
    const severity = /紅燈|重大/.test(text) ? "critical" : "watch";
    if (ruleId === "progressGap") {
        const watch = text.match(/(?:黃燈|一般關注).*?(\d+(?:\.\d+)?)/);
        const critical = text.match(/(?:紅燈|重大預警).*?(\d+(?:\.\d+)?)/);
        if (watch) value.watchThreshold = Number(watch[1]);
        if (critical) value.criticalThreshold = Number(critical[1]);
        if (!watch && !critical && numbers.length) value.watchThreshold = numbers[0];
    } else if (ruleId === "limit") {
        if (numbers.length) value.limit = Math.round(numbers[0]);
    } else if (["missingReport", "missingTarget"].includes(ruleId)) {
        if (!disable && !enable) value.enabled = true;
    } else {
        if (numbers.length) value.threshold = numbers[0];
        value.severity = severity;
        if (ruleId === "closingRate") {
            const sample = text.match(/(?:至少|最低樣本|樣本)\s*(\d+)\s*人/);
            if (sample) value.minSample = Number(sample[1]);
        }
    }
    return { ruleId, value };
}

function detectTelegramPreferenceIntent(command) {
    const text = String(command || "");
    if (/先(講|說|給).*結論|回答先.*結論/.test(text)) return { preferenceKey: "conclusion_first", instruction: "回答時先給結論，再補充原因與行動。" };
    if (/金額.*萬元|用萬元|以萬元/.test(text)) return { preferenceKey: "money_in_ten_thousands", instruction: "金額優先換算成萬元顯示，必要時在括號保留原始元數。" };
    if (/只列.*三項|只要.*三項|最多.*三項/.test(text)) return { preferenceKey: "top_three", instruction: "回答最多列出三項重點或三項優先行動。" };
    if (/不要顯示.*資料來源|省略.*資料來源/.test(text)) return { preferenceKey: "hide_source_detail", instruction: "正文不要重複展開資料來源細節，但系統頁尾仍保留稽核資訊。" };
    return null;
}

function buildTelegramPolicyPendingMessage(action = {}) {
    const policy = action.policy || {};
    const lines = ["我理解的正式規則如下：", ""];
    if (action.kind === "create_policy" && policy.type === "exclude_store") {
        lines.push(`品牌：${getTelegramAgentBrandLabel(policy.brandId)}`);
        lines.push(`店家：${policy.storeName || policy.storeCore}店`);
        lines.push(`生效範圍：${normalizeTelegramPolicyScopes(policy.scopes).map((scope) => TELEGRAM_AGENT_POLICY_SCOPE_LABELS[scope] || scope).join("、")}`);
    } else if (action.kind === "create_policy" && policy.type === "alert_rule") {
        lines.push(`品牌：${getTelegramAgentBrandLabel(policy.brandId)}`);
        lines.push(`預警項目：${TELEGRAM_AGENT_POLICY_RULE_LABELS[policy.ruleId] || policy.ruleId}`);
        lines.push(`設定：${JSON.stringify(policy.value)}`);
    } else if (action.kind === "create_policy" && policy.type === "response_preference") {
        lines.push(`個人回答偏好：${policy.instruction}`);
    } else if (action.kind === "restore_store") {
        lines.push(`恢復：${getTelegramAgentBrandLabel(action.brandId)} ${action.storeName || action.storeCore}店`);
        lines.push("將停用符合的長期排除規則。");
    } else if (action.kind === "deactivate_policy") {
        lines.push(`停用規則：${action.policyCode || action.policyId}`);
    }
    lines.push(`有效期間：${policy.effectiveUntil ? `即日起至 ${policy.effectiveUntil}` : "即日起，直到人工撤銷"}`);
    lines.push("", "確認套用嗎？");
    return lines.join("\n");
}

async function saveTelegramPendingPolicyAction(chatId, userId, action) {
    const expiresAtMs = Date.now() + TELEGRAM_AGENT_POLICY_PENDING_MINUTES * 60 * 1000;
    const expiresAtText = new Date(expiresAtMs).toISOString();
    await getTelegramAgentSessionRef(chatId, userId).set({
        pendingPolicyAction: { ...action, createdAtText: new Date().toISOString(), expiresAtText },
        pendingPolicyExpiresAtMs: expiresAtMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString(),
    }, { merge: true });
}

async function clearTelegramPendingPolicyAction(chatId, userId) {
    await getTelegramAgentSessionRef(chatId, userId).set({
        pendingPolicyAction: admin.firestore.FieldValue.delete(),
        pendingPolicyExpiresAtMs: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString(),
    }, { merge: true });
}

async function saveTelegramOneShotPolicies(chatId, userId, policies) {
    const expiresAtMs = Date.now() + TELEGRAM_AGENT_POLICY_PENDING_MINUTES * 60 * 1000;
    await getTelegramAgentSessionRef(chatId, userId).set({
        oneShotPolicies: Array.isArray(policies) ? policies : [],
        oneShotExpiresAtText: new Date(expiresAtMs).toISOString(),
        oneShotExpiresAtMs: expiresAtMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString(),
    }, { merge: true });
}

async function consumeTelegramOneShotPolicies(chatId, userId, memoryPayload) {
    const expires = Number(memoryPayload?.oneShotExpiresAtMs || 0) || Date.parse(memoryPayload?.oneShotExpiresAtText || "");
    const policies = expires > Date.now() && Array.isArray(memoryPayload?.oneShotPolicies) ? memoryPayload.oneShotPolicies : [];
    if (policies.length || memoryPayload?.oneShotPolicies) {
        await getTelegramAgentSessionRef(chatId, userId).set({
            oneShotPolicies: admin.firestore.FieldValue.delete(),
            oneShotExpiresAtText: admin.firestore.FieldValue.delete(),
            oneShotExpiresAtMs: admin.firestore.FieldValue.delete(),
        }, { merge: true });
    }
    return policies;
}

async function executeTelegramPendingPolicyAction(action, actor, ctx) {
    if (!action || typeof action !== "object") throw new Error("目前沒有待確認的規則");
    if (action.expiresAtText && Date.parse(action.expiresAtText) <= Date.now()) throw new Error("這筆確認已逾時，請重新下達規則");
    if (action.kind === "create_policy") {
        const policy = await createTelegramAgentPolicy(action.policy || {}, actor, ctx);
        return { message: `✅ 已建立長期規則\n${policy.policyCode}\n${action.summary || policy.sourceText || "規則已生效"}`, lastPolicyChange: { action: "create", policyId: policy.id, policyCode: policy.policyCode } };
    }
    if (action.kind === "restore_store") {
        const state = await loadTelegramAgentPolicyState(ctx);
        const matches = state.activePolicies.filter((policy) =>
            policy.type === "exclude_store" && policy.enabled !== false && policy.brandId === action.brandId && normalizeSummaryCoreName(policy.storeCore || policy.storeName) === normalizeSummaryCoreName(action.storeCore || action.storeName)
        );
        if (!matches.length) return { message: "目前沒有符合的排除規則，不需要恢復。", lastPolicyChange: null };
        for (const policy of matches) await setTelegramAgentPolicyEnabled(policy.id, false, actor, ctx, "restore_store");
        return { message: `✅ 已恢復 ${getTelegramAgentBrandLabel(action.brandId)} ${action.storeName || action.storeCore}店，共停用 ${matches.length} 條排除規則。`, lastPolicyChange: { action: "deactivate_many", policyIds: matches.map((item) => item.id) } };
    }
    if (action.kind === "deactivate_policy") {
        const changed = await setTelegramAgentPolicyEnabled(action.policyId, false, actor, ctx, "forget");
        return { message: `✅ 已停用規則 ${changed.before.policyCode || changed.before.id}`, lastPolicyChange: { action: "deactivate", policyId: changed.before.id, policyCode: changed.before.policyCode } };
    }
    throw new Error(`不支援的規則動作：${action.kind}`);
}

async function undoTelegramAgentLastPolicyChange(chatId, userId, actor, ctx, memoryPayload) {
    const change = memoryPayload?.lastPolicyChange;
    if (!change) return "目前沒有可以撤銷的最近規則變更。";
    if (change.action === "create") {
        await setTelegramAgentPolicyEnabled(change.policyId, false, actor, ctx, "undo_create");
        return `✅ 已撤銷最近新增的規則 ${change.policyCode || change.policyId}`;
    }
    if (change.action === "deactivate") {
        await setTelegramAgentPolicyEnabled(change.policyId, true, actor, ctx, "undo_deactivate");
        return `✅ 已恢復規則 ${change.policyCode || change.policyId}`;
    }
    if (change.action === "deactivate_many") {
        for (const policyId of change.policyIds || []) await setTelegramAgentPolicyEnabled(policyId, true, actor, ctx, "undo_restore_store");
        return `✅ 已恢復最近停用的 ${(change.policyIds || []).length} 條規則`;
    }
    return "最近一筆變更無法自動撤銷，請使用 /rules 查看後手動調整。";
}

function detectTelegramLearningCandidate(command) {
    const preference = detectTelegramPreferenceIntent(command);
    if (!preference) return null;
    if (/(以後|從今後|記住|永久)/.test(String(command || ""))) return null;
    return preference;
}

function updateTelegramLearningCandidates(existing = {}, candidate = null) {
    const next = existing && typeof existing === "object" ? { ...existing } : {};
    if (!candidate) return next;
    const previous = next[candidate.preferenceKey] || { count: 0 };
    next[candidate.preferenceKey] = {
        preferenceKey: candidate.preferenceKey,
        instruction: candidate.instruction,
        count: Number(previous.count || 0) + 1,
        lastSeenAtText: new Date().toISOString(),
    };
    return next;
}

async function parseTelegramPolicyCommand(rawCommand, ctx, dateInfo, memoryPayload) {
    const command = String(rawCommand || "").trim();
    const lower = command.toLowerCase();
    const actorPermission = ctx.policyPermission || await loadTelegramAgentPolicyPermission(ctx.chatId, ctx.userId, ctx);
    ctx.policyPermission = actorPermission;

    if (/^\/(rules|規則)(\s|$)/i.test(command) || /^(查看|列出).*(長期規則|記憶規則)$/.test(command)) {
        const listed = await listTelegramAgentPoliciesText(ctx);
        return { handled: true, reply: listed.text, rules: listed.rows };
    }
    if (/^\/(permissions|權限)(\s|$)/i.test(command)) {
        return { handled: true, reply: `目前規則權限：${actorPermission.role}\n可管理品牌：${actorPermission.brandIds.map(getTelegramAgentBrandLabel).join("、") || "無"}\n權限來源：${actorPermission.source}` };
    }
    if (/^\/(undo|撤銷)$/i.test(command) || /^撤銷(最近|上一筆)/.test(command)) {
        const actor = { chatId: ctx.chatId, userId: ctx.userId, userName: ctx.userName || "Telegram user" };
        const reply = await undoTelegramAgentLastPolicyChange(ctx.chatId, ctx.userId, actor, ctx, memoryPayload);
        await getTelegramAgentSessionRef(ctx.chatId, ctx.userId).set({ lastPolicyChange: admin.firestore.FieldValue.delete() }, { merge: true });
        return { handled: true, reply };
    }
    const forgetMatch = command.match(/^\/(?:forget|移除規則|停用規則)\s+(.+)$/i);
    if (forgetMatch) {
        const policy = await findTelegramAgentPolicy(forgetMatch[1], ctx, false);
        if (!policy) return { handled: true, reply: "找不到這條生效中的規則，請先使用 /rules 查看規則編號。" };
        const action = { kind: "deactivate_policy", policyId: policy.id, policyCode: policy.policyCode, summary: `停用 ${policy.policyCode}` };
        await saveTelegramPendingPolicyAction(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramPolicyPendingMessage(action) };
    }
    if (/^(確認|是的|確定|套用)$/i.test(command) || lower === "policy_confirm") {
        const pending = memoryPayload?.pendingPolicyAction;
        if (!pending) return { handled: true, reply: "目前沒有待確認的規則。" };
        const actor = { chatId: ctx.chatId, userId: ctx.userId, userName: ctx.userName || "Telegram user" };
        const result = await executeTelegramPendingPolicyAction(pending, actor, ctx);
        await clearTelegramPendingPolicyAction(ctx.chatId, ctx.userId);
        if (result.lastPolicyChange) {
            await getTelegramAgentSessionRef(ctx.chatId, ctx.userId).set({ lastPolicyChange: result.lastPolicyChange }, { merge: true });
        }
        return { handled: true, reply: result.message };
    }
    if (/^(取消|不要|不套用)$/i.test(command) || lower === "policy_cancel") {
        await clearTelegramPendingPolicyAction(ctx.chatId, ctx.userId);
        return { handled: true, reply: "已取消這次規則變更。" };
    }
    if (/^記住這個偏好$/.test(command) && memoryPayload?.lastLearningSuggestion) {
        const suggestion = memoryPayload.lastLearningSuggestion;
        const action = {
            kind: "create_policy",
            policy: {
                type: "response_preference",
                ownerScope: "user",
                preferenceKey: suggestion.preferenceKey,
                instruction: suggestion.instruction,
                sourceText: command,
            },
            summary: suggestion.instruction,
        };
        await saveTelegramPendingPolicyAction(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramPolicyPendingMessage(action) };
    }

    const preferredBrandId = getTelegramAgentExplicitBrandId(command) || ctx.scopeState?.activeBrandId || "";
    const storeMatches = /(排除|不列入|不要分析|忽略|恢復|取消排除|重新納入|解除排除)/.test(command)
        ? await resolveTelegramPolicyStoreMention(command, preferredBrandId, ctx)
        : [];
    const restore = /(恢復|取消排除|重新納入|解除排除)/.test(command);
    const exclude = !restore && /(排除|不列入|不要分析|忽略)/.test(command) && storeMatches.length > 0;
    const longTerm = /(從今後|從現在起|以後|永久|未來.*都|記住這個規則|直到)/.test(command);
    const temporary = /(這次|本次|本題|今天先|暫時先)/.test(command);

    if ((exclude || restore) && storeMatches.length > 1) {
        return { handled: true, reply: `找到多個可能店家：${storeMatches.map((item) => `${getTelegramAgentBrandLabel(item.brandId)} ${item.storeName}店`).join("、")}。請補上品牌與完整店名。` };
    }
    if ((exclude || restore) && storeMatches.length === 1) {
        const match = storeMatches[0];
        if (restore) {
            const action = { kind: "restore_store", brandId: match.brandId, storeCore: match.storeCore, storeName: match.storeName };
            await saveTelegramPendingPolicyAction(ctx.chatId, ctx.userId, action);
            return { handled: true, pending: true, reply: buildTelegramPolicyPendingMessage(action) };
        }
        const policy = {
            type: "exclude_store",
            ownerScope: "brand",
            brandId: match.brandId,
            storeCore: match.storeCore,
            storeName: match.storeName,
            scopes: parseTelegramPolicyScopes(command),
            excludeFromBrandTotals: /品牌總計|全部分析|所有分析|任何資料|所有資料|全部資料|一律排除/.test(command),
            effectiveFrom: dateInfo.todayStr,
            effectiveUntil: parseTelegramPolicyEffectiveUntil(command, dateInfo),
            sourceText: command,
        };
        if (temporary) {
            const remainder = command
                .replace(/這次|本次|本題|今天先|暫時先/g, "")
                .replace(/排除|不列入|不要分析|忽略/g, "")
                .replace(new RegExp(match.storeName, "g"), "")
                .replace(/DRCYJ|CYJ|安妞|伊啵|店/g, "")
                .trim();
            if (remainder.length < 5) {
                await saveTelegramOneShotPolicies(ctx.chatId, ctx.userId, [policy]);
                return { handled: true, reply: `✅ 已記住一次性範圍：下一次分析會排除 ${getTelegramAgentBrandLabel(match.brandId)} ${match.storeName}店，使用後自動清除。` };
            }
            ctx.transientPolicies = [...(ctx.transientPolicies || []), policy];
            await loadTelegramAgentPolicyState(ctx);
            return { handled: false, command };
        }
        if (!longTerm) {
            return { handled: true, reply: `你要「只排除本次分析」，還是建立長期規則？\n本次可說：這次排除${match.storeName}店\n長期可說：從今後排除${match.storeName}店的所有分析` };
        }
        const action = { kind: "create_policy", policy, summary: `排除 ${getTelegramAgentBrandLabel(match.brandId)} ${match.storeName}店` };
        await saveTelegramPendingPolicyAction(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramPolicyPendingMessage(action) };
    }

    const ruleIntent = detectTelegramAlertRuleIntent(command);
    if (ruleIntent && preferredBrandId && /(設定|改成|調整|低於|落後|停用|關閉|啟用|不需要判斷|最多顯示|以後|從今後)/.test(command)) {
        const policy = {
            type: "alert_rule",
            ownerScope: "brand",
            brandId: preferredBrandId,
            ruleId: ruleIntent.ruleId,
            value: ruleIntent.value,
            effectiveFrom: dateInfo.todayStr,
            effectiveUntil: parseTelegramPolicyEffectiveUntil(command, dateInfo),
            sourceText: command,
        };
        const action = { kind: "create_policy", policy, summary: `${getTelegramAgentBrandLabel(preferredBrandId)} ${TELEGRAM_AGENT_POLICY_RULE_LABELS[ruleIntent.ruleId] || ruleIntent.ruleId}` };
        await saveTelegramPendingPolicyAction(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramPolicyPendingMessage(action) };
    }

    const rememberMatch = command.match(/^\/(?:remember|記住)\s+(.+)$/i);
    const preference = detectTelegramPreferenceIntent(command);
    if (rememberMatch || (preference && /(以後|從今後|記住|永久)/.test(command))) {
        const resolved = preference || { preferenceKey: "generic", instruction: rememberMatch[1].slice(0, 500) };
        const action = {
            kind: "create_policy",
            policy: {
                type: "response_preference",
                ownerScope: "user",
                preferenceKey: resolved.preferenceKey,
                instruction: resolved.instruction,
                sourceText: command,
            },
            summary: resolved.instruction,
        };
        await saveTelegramPendingPolicyAction(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramPolicyPendingMessage(action) };
    }

    return { handled: false, command };
}

function buildTelegramPolicyInlineKeyboard(options = {}) {
    if (options.pending) {
        return { inline_keyboard: [[
            { text: "✅ 確認套用", callback_data: "policy_confirm" },
            { text: "取消", callback_data: "policy_cancel" },
        ]] };
    }
    if (Array.isArray(options.rules) && options.rules.length) {
        const rows = options.rules.slice(0, 6).map((policy) => [{
            text: `停用 ${policy.policyCode || policy.id}`.slice(0, 50),
            callback_data: `policy_forget:${policy.id}`.slice(0, 64),
        }]);
        rows.push([{ text: "↩️ 撤銷最近變更", callback_data: "policy_undo" }]);
        return { inline_keyboard: rows };
    }
    return null;
}

async function handleTelegramPolicyCallbackData(callbackData, ctx, memoryPayload) {
    const data = String(callbackData || "");
    if (data === "policy_confirm" || data === "policy_cancel") {
        return parseTelegramPolicyCommand(data, ctx, getTelegramAgentTaipeiNow(), memoryPayload);
    }
    if (data === "policy_undo") {
        return parseTelegramPolicyCommand("/undo", ctx, getTelegramAgentTaipeiNow(), memoryPayload);
    }
    if (data.startsWith("policy_forget:")) {
        const policyId = data.slice("policy_forget:".length);
        const policy = await findTelegramAgentPolicy(policyId, ctx, false);
        if (!policy) return { handled: true, reply: "這條規則已不存在或已停用。" };
        const action = { kind: "deactivate_policy", policyId: policy.id, policyCode: policy.policyCode };
        await saveTelegramPendingPolicyAction(ctx.chatId, ctx.userId, action);
        return { handled: true, pending: true, reply: buildTelegramPolicyPendingMessage(action) };
    }
    return { handled: false };
}


// 集中式營運指標字典：公式與名稱由後端固定，Gemini 只負責解讀，不得自行改名或改公式。
const TELEGRAM_AGENT_METRIC_DICTIONARY = Object.freeze({
    cash: { label: "現金總業績", definition: "現金業績－退費", unit: "元", sourceField: "cash - refund" },
    accrual: { label: "權責總業績", definition: "權責總業績", unit: "元", sourceField: "accrual" },
    operationalAccrual: { label: "操作權責", definition: "安妞操作權責子項，不等於權責總業績", unit: "元", sourceField: "operationalAccrual" },
    skincare: { label: "保養品業績", definition: "區域卡片採保養品銷售毛額", unit: "元", sourceField: "skincareSales" },
    traffic: { label: "課程操作", definition: "課程操作人次", unit: "人次", sourceField: "traffic" },
    newCustomers: { label: "新客數", definition: "新客人數", unit: "人", sourceField: "newCustomers" },
    retainedOrders: { label: "留單數", definition: "新客留單人數", unit: "筆", sourceField: "newCustomerClosings" },
    cashAchievementRate: { label: "現金業績達成率", definition: "現金總業績 ÷ 現金目標 × 100%", unit: "%", sourceField: "cash / cashTarget" },
    expectedProgress: { label: "月份時間進度", definition: "本月已過日數 ÷ 當月總日數 × 100%", unit: "%", sourceField: "calendar" },
    progressGap: { label: "現金進度差距", definition: "現金業績達成率－月份時間進度", unit: "百分點", sourceField: "cashAchievementRate - expectedProgress" },
    achievementRank: { label: "現金業績達成率排名", definition: "同品牌區長依現金業績達成率由高至低排序", unit: "名", sourceField: "cashAchievementRate" },
    cashRank: { label: "現金總業績排名", definition: "同品牌區長依現金總業績金額由高至低排序", unit: "名", sourceField: "cash" },
    closingRateRank: { label: "新客締結率排名", definition: "同品牌區長依新客留單數 ÷ 新客數排序", unit: "名", sourceField: "newClosings / newCount" },
    newCustomerRank: { label: "新客開發排名", definition: "同品牌區長依新客數由高至低排序", unit: "名", sourceField: "newCount" },
    skincareRatioRank: { label: "保養品占比排名", definition: "同品牌區長依保養品業績 ÷ 現金總業績排序", unit: "名", sourceField: "skincare / cash" },
});

const TELEGRAM_AGENT_FORMAL_METRIC_OVERRIDES = Object.freeze({
    cash: { label: "現金總業績", definition: "正式淨現金＝現金業績－一般退費－保養品退費", unit: "元", sourceField: "formalNetCash" },
    accrual: { label: "權責總業績", definition: "正式權責：CYJ／伊啵使用 accrual；安妞使用 operationalAccrual", unit: "元", sourceField: "formalAccrual" },
    operationalAccrual: { label: "操作權責", definition: "安妞品牌的正式權責來源欄位；其他品牌僅為相容欄位", unit: "元", sourceField: "operationalAccrual" },
    cashAchievementRate: { label: "現金業績達成率", definition: "正式淨現金 ÷ 正式現金目標 × 100%；目標 Coverage 不完整時為 N/A", unit: "%", sourceField: "formalCashAchievement" },
});

function getTelegramAgentMetricDictionary(keys = [], options = {}) {
    const requested = Array.isArray(keys) && keys.length > 0 ? keys : Object.keys(TELEGRAM_AGENT_METRIC_DICTIONARY);
    const formalMode = options.formalMode === true;
    return requested.reduce((acc, key) => {
        const metric = formalMode && TELEGRAM_AGENT_FORMAL_METRIC_OVERRIDES[key]
            ? TELEGRAM_AGENT_FORMAL_METRIC_OVERRIDES[key]
            : TELEGRAM_AGENT_METRIC_DICTIONARY[key];
        if (metric) acc[key] = metric;
        return acc;
    }, {});
}

function getTelegramAgentExpectedProgress(yearMonth) {
    const ym = normalizeTelegramAgentYearMonth(yearMonth) || getTelegramAgentTaipeiNow().yearMonth;
    const [year, month] = ym.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const now = getTelegramAgentTaipeiNow();
    const elapsedDays = ym === now.yearMonth ? Math.min(now.day, daysInMonth) : daysInMonth;
    return daysInMonth > 0 ? Number(((elapsedDays / daysInMonth) * 100).toFixed(1)) : 100;
}

function buildTelegramAgentDataQuality({
    expectedStoreCount = 0,
    reportedStoreCount = 0,
    targetedStoreCount = 0,
    source = "",
    missingReportStores = [],
    missingTargetStores = [],
} = {}) {
    const expected = Math.max(0, Number(expectedStoreCount) || 0);
    const reported = Math.max(0, Number(reportedStoreCount) || 0);
    const targeted = Math.max(0, Number(targetedStoreCount) || 0);
    const reportCoverage = expected > 0 ? Number(((reported / expected) * 100).toFixed(1)) : 0;
    const targetCoverage = expected > 0 ? Number(((targeted / expected) * 100).toFixed(1)) : 0;
    const sourceText = String(source || "");
    const sourceConfidence = /daily_reports_current_month_exact|verified_(?:formal_)?dashboard_summary/.test(sourceText)
        ? "high"
        : /daily_reports_scoped|monthly_aggregated/.test(sourceText)
            ? "medium"
            : "low";
    const rankingEligible = expected > 0 && reported >= expected && targeted >= expected;
    let level = "low";
    if (rankingEligible && sourceConfidence === "high") level = "high";
    else if (expected > 0 && reportCoverage >= 90 && targetCoverage >= 90) level = "medium";
    return {
        level,
        sourceConfidence,
        expectedStoreCount: expected,
        reportedStoreCount: reported,
        targetedStoreCount: targeted,
        reportCoverage,
        targetCoverage,
        missingReportStores: normalizeTelegramAgentStoreNamesFull(missingReportStores),
        missingTargetStores: normalizeTelegramAgentStoreNamesFull(missingTargetStores),
        rankingEligible,
        rankingBlockedReason: rankingEligible
            ? ""
            : expected <= 0
                ? "正式組織架構沒有可計算店家"
                : `資料完整度不足：日報 ${reportCoverage}%／目標 ${targetCoverage}%`,
    };
}

function assignTelegramAgentRank(rows, field, selector) {
    const sorted = [...rows].sort((a, b) => {
        const diff = Number(selector(b) || 0) - Number(selector(a) || 0);
        if (diff !== 0) return diff;
        return Number(b.cash || 0) - Number(a.cash || 0);
    });
    sorted.forEach((row, index) => { row[field] = index + 1; });
}

class TelegramAgentBudgetError extends Error {
    constructor(message) {
        super(message);
        this.name = "TelegramAgentBudgetError";
    }
}

function createTelegramAgentContext({ chatId, userId, question }) {
    return {
        chatId: String(chatId || ""),
        userId: String(userId || "unknown"),
        question: String(question || "").slice(0, 1200),
        startedAtMs: Date.now(),
        readCount: 0,
        writeCount: 0,
        toolCalls: [],
        toolEvidence: [],
        crossSourceDataAwareness: [],
        crossSourceEvidenceByScope: {},
        sources: [],
        warnings: [],
        usage: {
            // Gemini Interactions API token usage（本題所有 model calls 加總）
            promptTokenCount: 0,
            inputTokenCount: 0,
            cachedTokenCount: 0,
            nonCachedInputTokenCount: 0,
            cacheHitRatePct: 0,
            candidatesTokenCount: 0,
            outputTokenCount: 0,
            thoughtTokenCount: 0,
            toolUseTokenCount: 0,
            totalTokenCount: 0,
            modelCallCount: 0,
        },
        modelUsageSteps: [],
        modelName: TELEGRAM_AGENT_PRIMARY_MODEL,
        fallbackUsed: false,
        geminiApi: getGeminiInteractionsApiLabel(TELEGRAM_AGENT_PRIMARY_MODEL),
        policies: [],
        policyCatalog: [],
        policyCatalogMode: "",
        policyStateLoaded: false,
        activePolicyIds: [],
        transientPolicies: [],
        policyPermission: null,
        policyConflicts: [],
        learningCandidates: {},
        memorySuggestion: null,
        replyGuardActions: [],
        scopeState: {
            activeBrandId: "",
            activeYearMonth: "",
            focusStores: [],
            focusManagers: [],
            lastToolName: "",
            lastIntent: "",
        },
    };
}

function assertTelegramAgentReadBudget(ctx, estimatedReads = 0) {
    if (!ctx) return;
    if ((ctx.readCount + Math.max(0, Number(estimatedReads) || 0)) > TELEGRAM_AGENT_MAX_READS) {
        throw new TelegramAgentBudgetError(
            `本題預估讀取量將超過 ${TELEGRAM_AGENT_MAX_READS} 筆安全上限，請縮小品牌、店家或日期範圍。`
        );
    }
}

function recordTelegramAgentRead(ctx, count, source, meta = {}) {
    if (!ctx) return;
    const safeCount = Math.max(0, Number(count) || 0);
    ctx.readCount += safeCount;
    ctx.sources.push({
        source: String(source || "unknown"),
        brandId: meta.brandId || "",
        yearMonth: meta.yearMonth || "",
        updatedAtText: meta.updatedAtText || "",
        readCount: safeCount,
        cacheHit: Boolean(meta.cacheHit),
    });
    if (ctx.readCount > TELEGRAM_AGENT_MAX_READS) {
        ctx.warnings.push(`本題實際資料讀取已達約 ${ctx.readCount} 筆，後續工具已停止。`);
    }
}

function getTelegramAgentUsageNumber(usage = {}, keys = []) {
    for (const key of keys) {
        const value = Number(usage?.[key]);
        if (Number.isFinite(value) && value >= 0) return value;
    }
    return 0;
}

function recordTelegramAgentUsage(ctx, response) {
    if (!ctx || !response) return;
    const usage = response.usageMetadata || response.usage || {};

    const inputTokens = getTelegramAgentUsageNumber(usage, [
        "promptTokenCount",
        "inputTokenCount",
        "total_input_tokens",
    ]);
    const cachedTokens = getTelegramAgentUsageNumber(usage, [
        "cachedTokenCount",
        "cachedContentTokenCount",
        "total_cached_tokens",
    ]);
    const outputTokens = getTelegramAgentUsageNumber(usage, [
        "candidatesTokenCount",
        "outputTokenCount",
        "total_output_tokens",
    ]);
    const thoughtTokens = getTelegramAgentUsageNumber(usage, [
        "thoughtTokenCount",
        "thoughtsTokenCount",
        "total_thought_tokens",
    ]);
    const toolUseTokens = getTelegramAgentUsageNumber(usage, [
        "toolUseTokenCount",
        "total_tool_use_tokens",
    ]);
    const totalTokens = getTelegramAgentUsageNumber(usage, [
        "totalTokenCount",
        "total_tokens",
    ]);

    ctx.usage.promptTokenCount += inputTokens;
    ctx.usage.inputTokenCount += inputTokens;
    ctx.usage.cachedTokenCount += cachedTokens;
    ctx.usage.candidatesTokenCount += outputTokens;
    ctx.usage.outputTokenCount += outputTokens;
    ctx.usage.thoughtTokenCount += thoughtTokens;
    ctx.usage.toolUseTokenCount += toolUseTokens;
    ctx.usage.totalTokenCount += totalTokens;
    ctx.usage.modelCallCount += 1;

    // cached tokens 仍屬於 input tokens 的一部分；此欄只用來觀察 cache 命中情況，
    // 不把它誤當成「免費 token」或直接等同實際帳單。
    ctx.usage.nonCachedInputTokenCount = Math.max(
        0,
        Number(ctx.usage.inputTokenCount || 0) - Number(ctx.usage.cachedTokenCount || 0)
    );
    ctx.usage.cacheHitRatePct = ctx.usage.inputTokenCount > 0
        ? Number(((ctx.usage.cachedTokenCount / ctx.usage.inputTokenCount) * 100).toFixed(1))
        : 0;

    if (!Array.isArray(ctx.modelUsageSteps)) ctx.modelUsageSteps = [];
    ctx.modelUsageSteps.push({
        call: ctx.usage.modelCallCount,
        interactionId: String(response?.id || ""),
        model: String(response?.model || ctx.modelName || TELEGRAM_AGENT_PRIMARY_MODEL),
        inputTokenCount: inputTokens,
        cachedTokenCount: cachedTokens,
        nonCachedInputTokenCount: Math.max(0, inputTokens - cachedTokens),
        cacheHitRatePct: inputTokens > 0
            ? Number(((cachedTokens / inputTokens) * 100).toFixed(1))
            : 0,
        outputTokenCount: outputTokens,
        thoughtTokenCount: thoughtTokens,
        toolUseTokenCount: toolUseTokens,
        totalTokenCount: totalTokens,
    });
}

function getTelegramAgentCache(key) {
    const item = TELEGRAM_AGENT_TOOL_CACHE.get(String(key || ""));
    if (!item) return null;
    if ((Date.now() - item.createdAtMs) > TELEGRAM_AGENT_CACHE_TTL_MS) {
        TELEGRAM_AGENT_TOOL_CACHE.delete(String(key || ""));
        return null;
    }
    return item.value;
}

function setTelegramAgentCache(key, value) {
    TELEGRAM_AGENT_TOOL_CACHE.set(String(key || ""), { createdAtMs: Date.now(), value });
    if (TELEGRAM_AGENT_TOOL_CACHE.size > 250) {
        const oldestKey = TELEGRAM_AGENT_TOOL_CACHE.keys().next().value;
        if (oldestKey) TELEGRAM_AGENT_TOOL_CACHE.delete(oldestKey);
    }
}

async function readTelegramAgentDoc(ref, ctx, source, meta = {}, cacheSeconds = 120) {
    const cacheKey = `doc:${ref.path}`;
    const cached = cacheSeconds > 0 ? getTelegramAgentCache(cacheKey) : null;
    if (cached) {
        recordTelegramAgentRead(ctx, 0, source, { ...meta, updatedAtText: cached.updatedAtText || "", cacheHit: true });
        return cached;
    }

    assertTelegramAgentReadBudget(ctx, 1);
    const snap = await ref.get();
    const value = {
        exists: snap.exists,
        id: snap.id,
        data: snap.exists ? (snap.data() || {}) : null,
        updatedAtText: snap.exists ? String(snap.data()?.lastUpdatedAtText || snap.data()?.updatedAtText || "") : "",
    };
    recordTelegramAgentRead(ctx, 1, source, { ...meta, updatedAtText: value.updatedAtText });
    if (cacheSeconds > 0) setTelegramAgentCache(cacheKey, value);
    return value;
}

async function queryTelegramAgentDocs(query, cacheKey, ctx, source, meta = {}, cacheSeconds = 120) {
    const cached = cacheSeconds > 0 ? getTelegramAgentCache(cacheKey) : null;
    if (cached) {
        recordTelegramAgentRead(ctx, 0, source, { ...meta, updatedAtText: cached.updatedAtText || "", cacheHit: true });
        return cached;
    }

    const snap = await query.get();
    const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    const billedReads = Math.max(1, snap.size);
    recordTelegramAgentRead(ctx, billedReads, source, meta);
    const value = { rows, size: snap.size, updatedAtText: "" };
    if (cacheSeconds > 0) setTelegramAgentCache(cacheKey, value);
    return value;
}

function normalizeTelegramAgentDate(value) {
    const text = String(value || "").trim().replace(/\//g, "-");
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeTelegramAgentYearMonth(value) {
    const text = String(value || "").trim().replace(/\//g, "-");
    const match = text.match(/^(20\d{2})-(\d{1,2})$/);
    if (!match) return "";
    const month = Number(match[2]);
    if (month < 1 || month > 12) return "";
    return `${match[1]}-${String(month).padStart(2, "0")}`;
}

function getTelegramAgentTaipeiNow() {
    const taipei = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const year = taipei.getUTCFullYear();
    const month = taipei.getUTCMonth() + 1;
    const day = taipei.getUTCDate();
    return {
        year,
        month,
        day,
        todayStr: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        yearMonth: `${year}-${String(month).padStart(2, "0")}`,
    };
}

function normalizeTelegramAgentBrandId(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";
    if (raw.includes("anniu") || raw.includes("anew") || raw.includes("安妞")) return "anniu";
    if (raw.includes("yibo") || raw.includes("伊啵")) return "yibo";
    if (raw.includes("cyj") || raw.includes("drcyj")) return "cyj";
    return "";
}

function getTelegramAgentBrandLabel(brandId) {
    if (brandId === "anniu") return "安妞";
    if (brandId === "yibo") return "伊啵";
    return "DRCYJ";
}

function resolveTelegramAgentBrands(brandName = "", storeName = "") {
    const brandId = normalizeTelegramAgentBrandId(brandName || storeName);
    return brandId ? [brandId] : BRANDS.map((brand) => brand.id);
}

function getTelegramAgentExplicitBrandId(text = "") {
    const raw = String(text || "");
    if (/安妞|Anew|anniu/i.test(raw)) return "anniu";
    if (/伊啵|Yibo|yibo/i.test(raw)) return "yibo";
    if (/DRCYJ|CYJ/i.test(raw)) return "cyj";
    return "";
}

function isTelegramAgentAllBrandIntent(text = "") {
    const raw = String(text || "");
    return /全品牌|三品牌|各品牌|跨品牌|品牌比較|比較.{0,12}(CYJ|DRCYJ|安妞|伊啵)/i.test(raw);
}


function expandTelegramAgentCommand(command = "") {
    const raw = String(command || "").trim();
    const match = raw.match(/^\/(today|alerts|datahealth)(?:@\w+)?(?:\s+(.+))?$/i);
    if (!match) return raw;
    const action = String(match[1] || "").toLowerCase();
    const scope = String(match[2] || "").trim();
    const scopeText = scope ? `，範圍限定為「${scope}」` : "";
    if (action === "today") {
        return `請使用每日戰情摘要工具，提供截至今天的營運戰情：各品牌現金進度、最需要關注的店家、資料完整度與三項優先行動${scopeText}。`;
    }
    if (action === "alerts") {
        return `請列出本月目前最需要關注的店家，說明異常原因、嚴重程度與處理順序${scopeText}。`;
    }
    return `請檢查本月營運資料健康度，包括正式店家數、已有日報店家數、已有目標店家數、缺漏名單、資料來源與是否允許進行排名${scopeText}。`;
}

function normalizeTelegramAgentManagerName(value = "") {
    return String(value || "")
        .trim()
        .replace(/[　\s]+/g, "")
        .replace(/(區長|主管|經理)$/g, "")
        .replace(/區$/g, "")
        .trim();
}

function normalizeTelegramAgentStoreNamesFull(values = []) {
    const rows = Array.isArray(values) ? values : [values];
    return [...new Set(rows.map((value) => normalizeSummaryCoreName(value)).filter(Boolean))];
}

function normalizeTelegramAgentStoreNames(values = []) {
    // 對話 scope / 短期記憶仍保留最多 20 家，避免無界限擴張；
    // 完整營運檢核請使用 normalizeTelegramAgentStoreNamesFull()。
    return normalizeTelegramAgentStoreNamesFull(values).slice(0, 20);
}

function sanitizeTelegramAgentScopeState(state = {}) {
    return {
        activeBrandId: normalizeTelegramAgentBrandId(state.activeBrandId || state.activeBrandName || ""),
        activeYearMonth: normalizeTelegramAgentYearMonth(state.activeYearMonth || ""),
        focusStores: normalizeTelegramAgentStoreNames(state.focusStores || []),
        focusManagers: [...new Set((Array.isArray(state.focusManagers) ? state.focusManagers : [])
            .map(normalizeTelegramAgentManagerName).filter(Boolean))].slice(0, 10),
        lastToolName: String(state.lastToolName || "").slice(0, 80),
        lastIntent: String(state.lastIntent || "").slice(0, 80),
    };
}

function formatTelegramAgentScopeState(state = {}) {
    const safe = sanitizeTelegramAgentScopeState(state);
    return [
        `品牌：${safe.activeBrandId ? getTelegramAgentBrandLabel(safe.activeBrandId) : "未鎖定"}`,
        `月份：${safe.activeYearMonth || "未鎖定"}`,
        `關注店家：${safe.focusStores.length ? safe.focusStores.join("、") : "無"}`,
        `關注區長：${safe.focusManagers.length ? safe.focusManagers.join("、") : "無"}`,
        `上一工具：${safe.lastToolName || "無"}`,
    ].join("｜");
}

function getTelegramAgentRequestedStoreCount(text = "") {
    const raw = String(text || "");
    const numeric = raw.match(/(\d{1,2})\s*家/);
    if (numeric) return Math.min(20, Math.max(1, Number(numeric[1]) || 3));
    const chineseMap = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const chinese = raw.match(/([一二兩三四五六七八九十])\s*家/);
    return chinese ? (chineseMap[chinese[1]] || 3) : 3;
}

function shouldInheritTelegramAgentFocusStores(text = "") {
    return /這(三|幾|些)?家|那(三|幾|些)?家|上述店家|剛才.{0,8}店|前面.{0,8}店|這些店|那些店/i.test(String(text || ""));
}

function resolveTelegramAgentToolArgs(name, args = {}, ctx, dateInfo) {
    const resolved = { ...(args || {}) };
    const question = String(ctx?.question || "");
    const explicitBrandId = getTelegramAgentExplicitBrandId(question);
    const allBrandIntent = isTelegramAgentAllBrandIntent(question);
    const inheritedBrandId = normalizeTelegramAgentBrandId(ctx?.scopeState?.activeBrandId || "");

    if (explicitBrandId) {
        resolved.brandName = getTelegramAgentBrandLabel(explicitBrandId);
        if (ctx?.scopeState) ctx.scopeState.activeBrandId = explicitBrandId;
    } else if (!allBrandIntent && inheritedBrandId) {
        // 追問時由程式鎖定上一題品牌，不能讓模型自行擴張成三品牌。
        resolved.brandName = getTelegramAgentBrandLabel(inheritedBrandId);
    } else if (allBrandIntent) {
        delete resolved.brandName;
    }

    if (!resolved.yearMonth && ctx?.scopeState?.activeYearMonth) {
        resolved.yearMonth = ctx.scopeState.activeYearMonth;
    }

    if (name === "getTherapistPerformance") {
        const inheritedFocusStores = normalizeTelegramAgentStoreNames(ctx?.scopeState?.focusStores || []);
        if (shouldInheritTelegramAgentFocusStores(question) && inheritedFocusStores.length > 0) {
            // 「這三家店」以後端保存的店家清單為準，即使模型自行填了別的 storeName 也要覆蓋。
            delete resolved.storeName;
            resolved.storeNames = inheritedFocusStores;
        }
    }

    if (name === "getManagerPerformance" && resolved.managerName) {
        resolved.managerName = normalizeTelegramAgentManagerName(resolved.managerName);
    }

    if (name === "getOperationalAlerts" && !resolved.limit) {
        resolved.limit = getTelegramAgentRequestedStoreCount(question);
    }

    return resolved;
}

function updateTelegramAgentScopeFromToolResult(name, args = {}, result = {}, ctx) {
    if (!ctx) return;
    const next = sanitizeTelegramAgentScopeState(ctx.scopeState || {});
    const argBrandId = normalizeTelegramAgentBrandId(args.brandName || "");
    if (argBrandId) next.activeBrandId = argBrandId;
    if (result?.yearMonth) next.activeYearMonth = normalizeTelegramAgentYearMonth(result.yearMonth) || next.activeYearMonth;
    if (result?.query_range && /^20\d{2}-\d{2}/.test(result.query_range)) {
        next.activeYearMonth = result.query_range.slice(0, 7);
    }

    if (name === "getOperationalAlerts") {
        const count = getTelegramAgentRequestedStoreCount(ctx.question);
        next.focusStores = normalizeTelegramAgentStoreNames((result.alerts || []).slice(0, count).map((row) => row.storeName));
        const brands = [...new Set((result.alerts || []).map((row) => normalizeTelegramAgentBrandId(row.brand)).filter(Boolean))];
        if (brands.length === 1) next.activeBrandId = brands[0];
        next.lastIntent = "operational_alerts";
    } else if (name === "getStorePerformance") {
        const explicitStore = normalizeSummaryCoreName(args.storeName || "");
        if (explicitStore) next.focusStores = [explicitStore];
        const sourceBrands = [...new Set((result.source_meta || []).map((row) => normalizeTelegramAgentBrandId(row.brand)).filter(Boolean))];
        if (sourceBrands.length === 1) next.activeBrandId = sourceBrands[0];
        next.lastIntent = "store_performance";
    } else if (name === "getTherapistPerformance") {
        const inherited = normalizeTelegramAgentStoreNames(args.storeNames || args.storeName || []);
        if (inherited.length) next.focusStores = inherited;
        const sourceBrands = [...new Set((result.source_meta || []).map((row) => normalizeTelegramAgentBrandId(row.brand)).filter(Boolean))];
        if (sourceBrands.length === 1) next.activeBrandId = sourceBrands[0];
        next.lastIntent = "therapist_performance";
    } else if (name === "getManagerPerformance") {
        next.focusManagers = [...new Set((result.managers || []).map((row) => normalizeTelegramAgentManagerName(row.manager)).filter(Boolean))].slice(0, 10);
        const brands = [...new Set((result.managers || []).map((row) => normalizeTelegramAgentBrandId(row.brand)).filter(Boolean))];
        if (brands.length === 1) next.activeBrandId = brands[0];
        next.lastIntent = "manager_performance";
    }

    next.lastToolName = name;
    ctx.scopeState = next;
}

function getTelegramAgentDateDiffDays(startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    return Math.floor((end - start) / 86400000);
}

function getTelegramAgentMonthEnd(yearMonth) {
    const [year, month] = yearMonth.split("-").map(Number);
    const days = new Date(year, month, 0).getDate();
    return `${yearMonth}-${String(days).padStart(2, "0")}`;
}

function isTelegramAgentMonthRange(startDate, endDate) {
    if (!startDate || !endDate || startDate.slice(0, 7) !== endDate.slice(0, 7)) return false;
    const yearMonth = startDate.slice(0, 7);
    const taipeiNow = getTelegramAgentTaipeiNow();
    const expectedEnd = yearMonth === taipeiNow.yearMonth ? taipeiNow.todayStr : getTelegramAgentMonthEnd(yearMonth);
    return startDate === `${yearMonth}-01` && endDate === expectedEnd;
}

function enumerateTelegramAgentMonths(startMonth, endMonth) {
    const start = normalizeTelegramAgentYearMonth(startMonth);
    const end = normalizeTelegramAgentYearMonth(endMonth);
    if (!start || !end || start > end) return [];
    const [startYear, startM] = start.split("-").map(Number);
    const [endYear, endM] = end.split("-").map(Number);
    const result = [];
    let year = startYear;
    let month = startM;
    while (year < endYear || (year === endYear && month <= endM)) {
        result.push(`${year}-${String(month).padStart(2, "0")}`);
        month += 1;
        if (month > 12) { month = 1; year += 1; }
        if (result.length > TELEGRAM_AGENT_MAX_MACRO_MONTHS) break;
    }
    return result;
}

function calculateTelegramAgentProjection(total, yearMonth, endDate = "") {
    const [year, month] = String(yearMonth || "").split("-").map(Number);
    if (!year || !month) return Number(total) || 0;
    const daysInMonth = new Date(year, month, 0).getDate();
    const taipeiNow = getTelegramAgentTaipeiNow();
    if (yearMonth !== taipeiNow.yearMonth) return Math.round(Number(total) || 0);
    const day = Number(String(endDate || taipeiNow.todayStr).slice(8, 10)) || taipeiNow.day;
    return day > 0 ? Math.round((Number(total) || 0) / day * daysInMonth) : 0;
}

function calculateExactFrontendProjection(dailyCashMap, year, month, currentDayNum) {
    const daysInMonth = new Date(year, month, 0).getDate();
    let cashTotal = 0;
    const dailyCashArray = [];
    const normalizedMap = {};
    for (const [key, value] of Object.entries(dailyCashMap || {})) {
        const normKey = key.replace(/\//g, "-");
        normalizedMap[normKey] = (normalizedMap[normKey] || 0) + (Number(value) || 0);
    }
    for (let day = 1; day <= currentDayNum; day += 1) {
        const dateTarget = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const cash = normalizedMap[dateTarget] || 0;
        dailyCashArray.push(cash);
        cashTotal += cash;
    }
    if (currentDayNum <= 5) return currentDayNum > 0 ? Math.round((cashTotal / currentDayNum) * daysInMonth) : 0;
    const sortedCash = [...dailyCashArray].sort((a, b) => a - b);
    const mid = Math.floor(sortedCash.length / 2);
    const median = sortedCash.length % 2 !== 0 ? sortedCash[mid] : (sortedCash[mid - 1] + sortedCash[mid]) / 2;
    const threshold = median * 2;
    const dowData = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    let normalCashSum = 0;
    let normalDaysCount = 0;
    for (let day = 1; day <= currentDayNum; day += 1) {
        const cash = dailyCashArray[day - 1];
        if (cash <= threshold || median === 0) {
            dowData[new Date(year, month - 1, day).getDay()].push(cash);
            normalCashSum += cash;
            normalDaysCount += 1;
        }
    }
    const fallbackAvg = normalDaysCount > 0 ? normalCashSum / normalDaysCount : 0;
    const dowAvg = {};
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
        const values = dowData[dayOfWeek];
        dowAvg[dayOfWeek] = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : fallbackAvg;
    }
    let projectedRemaining = 0;
    for (let day = currentDayNum + 1; day <= daysInMonth; day += 1) {
        projectedRemaining += dowAvg[new Date(year, month - 1, day).getDay()];
    }
    return Math.round(cashTotal + projectedRemaining);
}

function getClampedDaysPassed(overallDailyCash, year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const taipeiNow = getTelegramAgentTaipeiNow();
    const isCurrentMonth = year === taipeiNow.year && month === taipeiNow.month;
    let daysPassed = isCurrentMonth ? Math.max(0, taipeiNow.day) : daysInMonth;
    let maxDataDay = 0;
    Object.keys(overallDailyCash || {}).forEach((dateStr) => {
        const dayNum = parseInt(dateStr.replace(/\//g, "-").split("-")[2], 10);
        if (dayNum > maxDataDay) maxDataDay = dayNum;
    });
    if (isCurrentMonth) daysPassed = Math.min(Math.max(daysPassed, maxDataDay), taipeiNow.day);
    else daysPassed = maxDataDay > 0 ? maxDataDay : daysInMonth;
    return daysPassed;
}

async function loadTelegramAgentSummaryStatus(brandId, yearMonth, ctx) {
    const result = await readTelegramAgentDoc(
        getSummaryCollection(brandId, "summary_recalc_flags").doc(yearMonth),
        ctx,
        "summary_recalc_flags",
        { brandId, yearMonth },
        60
    );
    const data = result.exists ? (result.data || {}) : {};
    const status = String(data.status || "").toLowerCase();
    const verified = result.exists && status === "verified" && data.dirty !== true && Number(data.lastMismatchCount || 0) === 0;
    return {
        exists: result.exists,
        verified,
        status: status || (result.exists ? "unknown" : "missing"),
        dirty: data.dirty === true,
        updatedAtText: data.updatedAtText || data.lastCompletedAtText || result.updatedAtText || "",
    };
}

function getOrgStructureDocRef(brandId) {
    // 必須與前端 App.getDocPath("org_structure") 完全一致：
    // CYJ legacy 使用 artifacts/default-app-id/public/data/global_settings/org_structure；
    // 安妞／伊啵使用 brands/{brandId}/settings/org_structure。
    if (isLegacyCyjBrand(brandId)) {
        return getLegacyCyjDataRootRef().collection("global_settings").doc("org_structure");
    }
    return getBrandRootRef(brandId).collection("settings").doc("org_structure");
}

function getManagementDelegationsCollectionRef(brandId) {
    // 與前端 getCollectionPath("management_delegations") 完全一致。
    return getSummaryCollection(brandId, "management_delegations");
}

function normalizeTelegramDelegation(raw = {}, id = "") {
    const normalizeDate = (value) => normalizeTelegramAgentDate(value || "");
    const storeNames = Array.isArray(raw.storeNames)
        ? raw.storeNames
        : (Array.isArray(raw.stores) ? raw.stores : []);
    return {
        ...raw,
        id: String(id || raw.id || "").trim(),
        type: raw.type === "store_manager" ? "store_manager" : "regional_manager",
        principalRole: String(raw.principalRole || raw.ownerRole || "manager").trim().toLowerCase(),
        principalId: String(raw.principalId || raw.ownerId || "").trim(),
        principalName: String(raw.principalName || raw.ownerName || "").trim(),
        delegateRole: String(raw.delegateRole || raw.proxyRole || raw.principalRole || "manager").trim().toLowerCase(),
        delegateId: String(raw.delegateId || raw.proxyId || "").trim(),
        delegateName: String(raw.delegateName || raw.proxyName || "").trim(),
        scopeMode: raw.scopeMode === "selected_stores" ? "selected_stores" : "all_assigned_stores",
        storeNames: [...new Set(storeNames.map(normalizeSummaryCoreName).filter(Boolean))],
        principalStoreSnapshot: [...new Set((Array.isArray(raw.principalStoreSnapshot) ? raw.principalStoreSnapshot : []).map(normalizeSummaryCoreName).filter(Boolean))],
        startDate: normalizeDate(raw.startDate),
        endDate: normalizeDate(raw.endDate),
        status: String(raw.status || "active").trim().toLowerCase(),
        permissions: {
            viewOperations: raw.permissions?.viewOperations !== false,
            editReports: raw.permissions?.editReports !== false,
            editHistory: raw.permissions?.editHistory !== false,
            deleteReports: raw.permissions?.deleteReports === true,
            receiveAlerts: raw.permissions?.receiveAlerts !== false,
            manageTasks: raw.permissions?.manageTasks !== false,
            editTargets: raw.permissions?.editTargets === true,
            editOrganization: false,
        },
        endedAtText: String(raw.endedAtText || ""),
        endedEarly: raw.endedEarly === true,
    };
}

function isTelegramDelegationActive(item = {}, dateText = getTelegramAgentTaipeiNow().todayStr) {
    const delegation = normalizeTelegramDelegation(item, item?.id);
    if (!["active", "scheduled"].includes(delegation.status)) return false;
    if (delegation.endedAtText || delegation.endedEarly) return false;
    if (!delegation.startDate || !delegation.endDate) return false;
    return delegation.startDate <= dateText && dateText <= delegation.endDate;
}

function resolveTelegramDelegationStores(item = {}, managers = {}) {
    const delegation = normalizeTelegramDelegation(item, item?.id);
    if (delegation.scopeMode === "selected_stores" && delegation.storeNames.length) {
        return delegation.storeNames;
    }
    if (delegation.principalRole === "manager" || delegation.type === "regional_manager") {
        const managerName = Object.keys(managers || {}).find(
            (name) => normalizeTelegramAgentManagerName(name) === normalizeTelegramAgentManagerName(delegation.principalName)
        );
        if (managerName) {
            const stores = (managers[managerName] || []).map(normalizeSummaryCoreName).filter(Boolean);
            if (stores.length) return [...new Set(stores)];
        }
    }
    return delegation.principalStoreSnapshot.length
        ? delegation.principalStoreSnapshot
        : delegation.storeNames;
}

async function loadTelegramAgentDelegations(brandId, managers, ctx) {
    const ref = getManagementDelegationsCollectionRef(brandId);
    const result = await queryTelegramAgentDocs(
        ref.where("status", "in", ["active", "scheduled"]).limit(200),
        `query:${ref.path}:status=active|scheduled`,
        ctx,
        "management_delegations",
        { brandId, sourcePath: ref.path },
        120
    );
    const all = (result.rows || []).map((row) => normalizeTelegramDelegation(row, row.id));
    const active = all
        .filter((item) => isTelegramDelegationActive(item))
        .map((item) => ({ ...item, resolvedStores: resolveTelegramDelegationStores(item, managers) }))
        .filter((item) => item.resolvedStores.length > 0)
        .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)) || String(a.id).localeCompare(String(b.id)));
    return { all, active, sourcePath: ref.path };
}

async function loadTelegramAgentOrgProfile(brandId, ctx) {
    const ref = getOrgStructureDocRef(brandId);
    const result = await readTelegramAgentDoc(ref, ctx, "org_structure", { brandId, sourcePath: ref.path }, 300);
    const managers = result.exists ? (result.data?.managers || {}) : {};
    const storeOwner = {};
    const managementStoresByManager = {};
    Object.entries(managers).forEach(([managerName, stores]) => {
        const normalizedStores = [...new Set((Array.isArray(stores) ? stores : []).map(normalizeSummaryCoreName).filter(Boolean))];
        managementStoresByManager[managerName] = [...normalizedStores];
        normalizedStores.forEach((core) => {
            if (core) storeOwner[core] = managerName;
        });
    });

    const delegationState = await loadTelegramAgentDelegations(brandId, managers, ctx);
    const actingManagerByStore = {};
    const actingDelegationByStore = {};
    const delegatedStoresByManager = {};
    delegationState.active.forEach((delegation) => {
        if (!delegation.delegateName) return;
        if (!delegatedStoresByManager[delegation.delegateName]) delegatedStoresByManager[delegation.delegateName] = [];
        if (!managementStoresByManager[delegation.delegateName]) managementStoresByManager[delegation.delegateName] = [];
        delegation.resolvedStores.forEach((storeCore) => {
            // 衝突資料以較早到期的安排優先，並保留正式組織歸屬不變。
            if (!actingManagerByStore[storeCore]) {
                actingManagerByStore[storeCore] = delegation.delegateName;
                actingDelegationByStore[storeCore] = delegation;
            }
            if (delegation.permissions?.viewOperations !== false) {
                if (!delegatedStoresByManager[delegation.delegateName].includes(storeCore)) delegatedStoresByManager[delegation.delegateName].push(storeCore);
                if (!managementStoresByManager[delegation.delegateName].includes(storeCore)) managementStoresByManager[delegation.delegateName].push(storeCore);
            }
        });
    });

    return {
        managers,
        stores: Object.keys(storeOwner),
        storeOwner,
        sourcePath: ref.path,
        activeDelegations: delegationState.active,
        delegationSourcePath: delegationState.sourcePath,
        actingManagerByStore,
        actingDelegationByStore,
        delegatedStoresByManager,
        managementStoresByManager,
    };
}

function getAuditExclusionsDocRef(brandId) {
    // 與前端 App.getDocPath("audit_exclusions") 完全一致。
    if (isLegacyCyjBrand(brandId)) {
        return getLegacyCyjDataRootRef().collection("global_settings").doc("audit_exclusions");
    }
    return getBrandRootRef(brandId).collection("settings").doc("audit_exclusions");
}

function normalizeTelegramAuditExclusionStores(raw = {}) {
    let values = [];
    if (Array.isArray(raw.stores)) values = raw.stores;
    else if (raw.stores && typeof raw.stores === "object") {
        values = Object.keys(raw.stores).filter((key) => raw.stores[key]);
    } else if (Array.isArray(raw.excludedStores)) values = raw.excludedStores;
    else if (Array.isArray(raw.storeNames)) values = raw.storeNames;

    return [...new Set(values.map(normalizeSummaryCoreName).filter(Boolean))];
}

async function loadTelegramAgentAuditExclusions(brandId, ctx) {
    const ref = getAuditExclusionsDocRef(brandId);
    const result = await readTelegramAgentDoc(
        ref,
        ctx,
        "audit_exclusions",
        { brandId, sourcePath: ref.path },
        300
    );
    const stores = result.exists ? normalizeTelegramAuditExclusionStores(result.data || {}) : [];
    return {
        stores,
        storeSet: new Set(stores),
        sourcePath: ref.path,
    };
}

function mergeTelegramAgentTargetMaps(baseMap = {}, supplementMap = {}) {
    const merged = { ...(baseMap || {}) };
    const targetFields = ["cashTarget", "accrualTarget", "challengeCashTarget", "challengeAccrualTarget"];
    const hasPresentField = (row, field) => (
        row
        && Object.prototype.hasOwnProperty.call(row, field)
        && row[field] !== null
        && row[field] !== undefined
        && row[field] !== ""
    );

    Object.entries(supplementMap || {}).forEach(([rawKey, rawValue]) => {
        const storeCore = normalizeSummaryCoreName(rawKey || rawValue?.storeName || rawValue?.store || "");
        if (!storeCore) return;
        const current = merged[storeCore] || {};
        const next = rawValue || {};

        const preferred = choosePreferredAutoTarget(current, next, storeCore) || {};
        if (preferred?.authorityConflict === true) {
            merged[storeCore] = preferred;
            return;
        }

        const currentCanonical = isAutoTargetCanonicalSource(current, storeCore);
        const nextCanonical = isAutoTargetCanonicalSource(next, storeCore);
        if (currentCanonical !== nextCanonical) {
            merged[storeCore] = {
                ...(nextCanonical ? next : current),
                storeName: storeCore,
            };
            return;
        }

        const secondary = preferred === next ? current : next;
        const combined = { ...secondary, ...preferred, storeName: storeCore };
        targetFields.forEach((field) => {
            if (hasPresentField(preferred, field)) combined[field] = preferred[field];
            else if (hasPresentField(secondary, field)) combined[field] = secondary[field];
            else combined[field] = null;
        });
        merged[storeCore] = combined;
    });
    return merged;
}

function getTelegramAgentMissingCashTargetStores(targetMap = {}, expectedStores = []) {
    return normalizeTelegramAgentStoreNamesFull(expectedStores || []).filter((storeCore) => {
        const row = targetMap?.[storeCore] || {};
        if (row?.authorityConflict === true || row?.status === "AUTHORITY_CONFLICT") return false;
        return !isConfiguredAutoBaseTargetValue(row?.cashTarget);
    });
}

function formatTelegramAgentStoreLabel(storeName = "") {
    const storeCore = normalizeSummaryCoreName(storeName || "");
    if (!storeCore) return "";
    // 「新店」本身就是地名，不能再補一個「店」變成「新店店」。
    return storeCore === "新店" ? "新店" : `${storeCore}店`;
}

function pushTelegramAgentWarning(ctx, warning) {
    const text = String(warning || "").trim();
    if (!ctx || !text) return;
    if (!Array.isArray(ctx.warnings)) ctx.warnings = [];
    if (!ctx.warnings.includes(text)) ctx.warnings.push(text);
}

function getTelegramAgentRawTargetDocIds(brandId, yearMonth, storeName) {
    const storeCore = normalizeSummaryCoreName(storeName || "");
    const match = String(yearMonth || "").match(/^(20\d{2})-(\d{2})$/);
    if (!storeCore || !match) return [];

    const year = match[1];
    const monthPadded = match[2];
    const monthPlain = String(Number(monthPadded));
    const brandPrefix = getSummaryBrandPrefix(brandId);
    const brandIdText = String(brandId || "").toLowerCase();
    const prefixes = new Set([brandPrefix]);

    // 相容舊資料曾使用的品牌前綴；只用於精準 doc-id fallback，不改正式店名。
    if (isLegacyCyjBrand(brandId)) {
        prefixes.add("CYJ");
        prefixes.add("DRCYJ");
    } else if (brandIdText.includes("anniu") || brandIdText.includes("anew")) {
        prefixes.add("安妞");
        prefixes.add("Anew");
        prefixes.add("Anew安妞");
    } else if (brandIdText.includes("yibo")) {
        prefixes.add("伊啵");
        prefixes.add("Yibo");
        prefixes.add("Yibo伊啵");
    }

    const storeKeys = [];
    prefixes.forEach((prefix) => {
        if (!prefix) return;
        if (storeCore === "新店") {
            storeKeys.push(`${prefix}新店店`, `${prefix}新店`);
        } else {
            storeKeys.push(`${prefix}${storeCore}店`);
        }
    });

    // 少數早期資料可能沒有品牌前綴，保留低成本相容候選。
    if (storeCore === "新店") storeKeys.push("新店店", "新店");
    else storeKeys.push(`${storeCore}店`, storeCore);

    const ids = [];
    [...new Set(storeKeys.filter(Boolean))].forEach((storeKey) => {
        ids.push(`${storeKey}_${year}_${monthPlain}`);
        if (monthPadded !== monthPlain) ids.push(`${storeKey}_${year}_${monthPadded}`);
    });
    return [...new Set(ids)];
}

async function loadTelegramAgentTargetedRawMap(brandId, yearMonth, ctx, stores = []) {
    const requestedStores = normalizeTelegramAgentStoreNamesFull(stores || []).slice(0, 6);
    const collectionRef = getSummaryCollection(brandId, "monthly_targets");
    const rawMap = {};

    for (const storeCore of requestedStores) {
        const candidateIds = getTelegramAgentRawTargetDocIds(brandId, yearMonth, storeCore);
        for (const candidateId of candidateIds) {
            const docResult = await readTelegramAgentDoc(
                collectionRef.doc(candidateId),
                ctx,
                "monthly_targets_targeted_fallback",
                { brandId, yearMonth, storeName: storeCore, sourceId: candidateId },
                yearMonth === getTelegramAgentTaipeiNow().yearMonth ? 60 : 600
            );
            if (!docResult.exists) continue;
            const built = buildAutoTargetRow(candidateId, docResult.data || {}, yearMonth);
            if (!built) continue;
            rawMap[built.storeCore] = built.target;
            if (isAutoTargetCanonicalSource(built.target, built.storeCore) || isAutoTargetEffective(built.target)) break;
        }
    }

    return rawMap;
}

async function loadTelegramAgentTargetMap(brandId, yearMonth, ctx, dashboardData = null, expectedStores = []) {
    const normalizedExpectedStores = normalizeTelegramAgentStoreNamesFull(expectedStores || []);
    let bestMap = {};
    let bestSource = "";
    let bestUpdatedAtText = "";

    const summaryRef = getSummaryCollection(brandId, "monthly_targets_summary").doc(yearMonth);
    const summaryResult = await readTelegramAgentDoc(
        summaryRef,
        ctx,
        "monthly_targets_summary",
        { brandId, yearMonth },
        yearMonth === getTelegramAgentTaipeiNow().yearMonth ? 60 : 600
    );
    if (summaryResult.exists) {
        const map = extractAutoTargetMapFromSummaryData(summaryResult.data || {}, yearMonth);
        if (Object.keys(map).length > 0) {
            bestMap = mergeTelegramAgentTargetMaps(bestMap, map);
            bestSource = "monthly_targets_summary";
            bestUpdatedAtText = summaryResult.updatedAtText || "";
            if (
                normalizedExpectedStores.length === 0 ||
                getTelegramAgentMissingCashTargetStores(bestMap, normalizedExpectedStores).length === 0
            ) {
                return { map: bestMap, source: bestSource, updatedAtText: bestUpdatedAtText };
            }
        }
    }

    if (dashboardData) {
        const map = extractAutoTargetMapFromSummaryData(dashboardData, yearMonth);
        if (Object.keys(map).length > 0) {
            bestMap = mergeTelegramAgentTargetMaps(bestMap, map);
            bestSource = bestSource ? `${bestSource}+dashboard_summary_targets` : "dashboard_summary_targets";
            bestUpdatedAtText = dashboardData.lastUpdatedAtText || bestUpdatedAtText;
            if (
                normalizedExpectedStores.length === 0 ||
                getTelegramAgentMissingCashTargetStores(bestMap, normalizedExpectedStores).length === 0
            ) {
                return { map: bestMap, source: bestSource, updatedAtText: bestUpdatedAtText };
            }
        }
    }

    let missingBeforeFallback = getTelegramAgentMissingCashTargetStores(bestMap, normalizedExpectedStores);

    // ★ 精準 fallback：只有少數店缺目標時，只讀缺少店家的原始 doc，不再掃整個 monthly_targets。
    if (missingBeforeFallback.length > 0 && missingBeforeFallback.length <= 6) {
        const targetedMap = await loadTelegramAgentTargetedRawMap(
            brandId,
            yearMonth,
            ctx,
            missingBeforeFallback
        );
        if (Object.keys(targetedMap).length > 0) {
            bestMap = mergeTelegramAgentTargetMaps(bestMap, targetedMap);
            bestSource = bestSource
                ? `${bestSource}+monthly_targets_targeted_fallback`
                : "monthly_targets_targeted_fallback";

            const missingAfterTargeted = getTelegramAgentMissingCashTargetStores(bestMap, normalizedExpectedStores);
            const recoveredStores = missingBeforeFallback.filter((store) => !missingAfterTargeted.includes(store));
            if (recoveredStores.length > 0) {
                const labels = recoveredStores.slice(0, 6).map(formatTelegramAgentStoreLabel).filter(Boolean).join("、");
                pushTelegramAgentWarning(
                    ctx,
                    `${getTelegramAgentBrandLabel(brandId)} ${yearMonth} 目標 Summary 缺漏${labels ? `（${labels}）` : ""}，已僅補讀缺少店家目標，不影響本題數字。`
                );
            }
            if (missingAfterTargeted.length === 0) {
                return { map: bestMap, source: bestSource, updatedAtText: bestUpdatedAtText };
            }
            missingBeforeFallback = missingAfterTargeted;
        }
    }

    // 若缺漏很多，或精準候選仍找不到，才保留原本完整集合 fallback，確保資料正確性不退步。
    assertTelegramAgentReadBudget(ctx, 200);
    const rawResult = await queryTelegramAgentDocs(
        getSummaryCollection(brandId, "monthly_targets"),
        `query:${getSummaryCollection(brandId, "monthly_targets").path}:all`,
        ctx,
        "monthly_targets_fallback",
        { brandId, yearMonth },
        300
    );
    const rawMap = {};
    rawResult.rows.forEach((row) => {
        const built = buildAutoTargetRow(row.id, row, yearMonth);
        if (built) mergeAutoTargetMapEntry(rawMap, built);
    });
    const mergedMap = mergeTelegramAgentTargetMaps(bestMap, rawMap);
    const fallbackSource = bestSource ? `${bestSource}+monthly_targets_fallback` : "monthly_targets_fallback";
    const names = missingBeforeFallback.slice(0, 8).map(formatTelegramAgentStoreLabel).filter(Boolean).join("、");
    pushTelegramAgentWarning(
        ctx,
        `${getTelegramAgentBrandLabel(brandId)} ${yearMonth} 目標摘要仍有缺漏${names ? `（${names}${missingBeforeFallback.length > 8 ? "…" : ""}）` : ""}，本題才啟用完整目標 fallback。`
    );
    return { map: mergedMap, source: fallbackSource, updatedAtText: bestUpdatedAtText };
}

function normalizeTelegramAgentStoreRow(row = {}, brandId = "cyj", target = {}, options = {}) {
    const storeCore = normalizeSummaryCoreName(row.store || row.storeName || row.displayName || row.id || "");
    const cash = Number(row.cash || 0) - (options.cashIsNet ? 0 : Number(row.refund || 0));
    const operationalAccrual = Number(row.operationalAccrual || 0);
    // 與前端 RegionalView 對齊：權責總業績一律使用 accrual。
    // 安妞的 operationalAccrual 是「操作權責」子項，不是權責總業績。
    const accrual = Number(row.accrual || 0);
    const skincareGross = Number(row.skincareGross ?? row.skincareSales ?? row.skincareSalesTotal ?? 0);
    const skincareRefund = Number(row.skincareRefund ?? row.skincareRefundTotal ?? 0);
    const skincare = options.skincareIsNet ? skincareGross : (skincareGross - skincareRefund);
    const traffic = Number(row.traffic || 0);
    const newRev = Number(row.newCustomerSales || row.newCustomerRevenue || 0);
    const newCount = Number(row.newCustomers || row.newCustomerCount || 0);
    const newClosings = Number(row.newCustomerClosings || 0);
    const oldRev = Number(row.oldCustomerRevenue || 0) || Math.max(0, cash - newRev);
    const oldCount = Number(row.oldCustomerCount || 0) || Math.max(0, traffic - newCount);
    const budget = Number(row.budget || row.cashTarget || target.cashTarget || 0);
    const accrualBudget = Number(row.accrualBudget || row.accrualTarget || target.accrualTarget || 0);
    return {
        storeName: storeCore,
        displayName: row.displayName || `${getSummaryBrandPrefix(brandId)}${storeCore}店`,
        brandId,
        brand: getTelegramAgentBrandLabel(brandId),
        manager: row.manager || "未分配",
        cash,
        accrual,
        skincare,
        skincareGross,
        skincareRefund,
        traffic,
        newRev,
        newCount,
        newClosings,
        oldRev,
        oldCount,
        budget,
        accrualBudget,
        achievement: budget > 0 ? Number(((cash / budget) * 100).toFixed(1)) : 0,
    };
}

function aggregateTelegramAgentStoreRows(rows = [], yearMonth = "", endDate = "") {
    const overall = {
        cash: 0, accrual: 0, skincare: 0, traffic: 0,
        newRev: 0, newCount: 0, newClosings: 0, oldRev: 0, oldCount: 0,
        budget: 0, accrualBudget: 0, projection: 0,
    };
    rows.forEach((row) => {
        overall.cash += Number(row.cash || 0);
        overall.accrual += Number(row.accrual || 0);
        overall.skincare += Number(row.skincare || 0);
        overall.traffic += Number(row.traffic || 0);
        overall.newRev += Number(row.newRev || 0);
        overall.newCount += Number(row.newCount || 0);
        overall.newClosings += Number(row.newClosings || 0);
        overall.oldRev += Number(row.oldRev || 0);
        overall.oldCount += Number(row.oldCount || 0);
        overall.budget += Number(row.budget || 0);
        overall.accrualBudget += Number(row.accrualBudget || 0);
    });
    overall.newAvg = overall.newCount > 0 ? Math.round(overall.newRev / overall.newCount) : 0;
    overall.oldAvg = overall.oldCount > 0 ? Math.round(overall.oldRev / overall.oldCount) : 0;
    overall.newClosingRate = overall.newCount > 0 ? Number(((overall.newClosings / overall.newCount) * 100).toFixed(1)) : 0;
    if (rows.some((row) => row?.formalKpiMode)) {
        Object.assign(overall, aggregateTelegramFormalRows(rows));
    } else {
        overall.achievement = overall.budget > 0 ? Number(((overall.cash / overall.budget) * 100).toFixed(1)) : 0;
    }
    overall.projection = Number.isFinite(Number(overall.cash)) ? calculateTelegramAgentProjection(overall.cash, yearMonth, endDate) : null;
    return overall;
}

async function loadTelegramAgentStoreMonth(brandId, yearMonth, ctx, options = {}) {
    const taipeiNow = getTelegramAgentTaipeiNow();
    const scopedStores = normalizeTelegramAgentStoreNamesFull(options.storeNames || options.targetStores || []);
    const scopedStoreSet = new Set(scopedStores);
    const isCurrentMonth = yearMonth === taipeiNow.yearMonth;
    const formalKpiMode = options.formalKpiMode === true;
    let dashboardData = null;
    let summaryStatus = null;

    if (formalKpiMode && isTelegramFormalPreSystemMonth(brandId, yearMonth)) {
        pushTelegramAgentWarning(ctx, `${getTelegramAgentBrandLabel(brandId)} ${yearMonth} 為正式系統使用前月份，不提供 0 業績推論。`);
        return {
            rows: [],
            overall: null,
            source: "pre_system_skip",
            updatedAtText: "",
            formalKpiMode: true,
            preSystem: true,
            dataStatus: "PRE_SYSTEM_SKIP",
        };
    }

    // 當月維持即時 daily_reports source，但 Formal analytical consumer 使用同一套 canonical KPI contract。
    if (isCurrentMonth) {
        const liveResult = await loadTelegramAgentRawStoreRange(
            brandId,
            `${yearMonth}-01`,
            taipeiNow.todayStr,
            ctx,
            { includeTargets: true, storeNames: scopedStores, formalKpiMode }
        );
        if (liveResult.rows.length > 0) {
            return {
                ...liveResult,
                source: formalKpiMode ? "daily_reports_current_month_exact_formal" : "daily_reports_current_month_exact",
                formalKpiMode,
            };
        }
        if (ctx) ctx.warnings.push(`${getTelegramAgentBrandLabel(brandId)} ${yearMonth} 當月日報讀取為 0，已改用月彙總 fallback。`);
    }

    if (!isCurrentMonth) {
        summaryStatus = await loadTelegramAgentSummaryStatus(brandId, yearMonth, ctx);
        if (summaryStatus.verified) {
            const dashboardResult = await readTelegramAgentDoc(
                getSummaryCollection(brandId, "dashboard_summary").doc(yearMonth),
                ctx,
                "dashboard_summary",
                { brandId, yearMonth },
                900
            );
            if (dashboardResult.exists && dashboardResult.data?.stores) {
                dashboardData = dashboardResult.data;
                if (formalKpiMode) {
                    const trust = inspectTelegramFormalSummaryTrust({ brandId, yearMonth, summaryStatus, summaryData: dashboardData });
                    if (trust.trusted) {
                        const rows = (Array.isArray(dashboardData.stores) ? dashboardData.stores : Object.values(dashboardData.stores || {}))
                            .filter((row) => row?.formalLifecycleEligible === true)
                            .filter((row) => scopedStoreSet.size === 0 || scopedStoreSet.has(normalizeSummaryCoreName(row.store || row.storeName || row.displayName || row.id || "")))
                            .map((row) => ({
                                ...normalizeTelegramAgentStoreRow(row, brandId, row, { cashIsNet: true, skincareIsNet: false }),
                                ...buildTelegramFormalSummaryMetrics(row),
                            }));
                        return {
                            rows,
                            overall: aggregateTelegramAgentStoreRows(rows, yearMonth, getTelegramAgentMonthEnd(yearMonth)),
                            source: "verified_formal_dashboard_summary",
                            updatedAtText: dashboardResult.updatedAtText || summaryStatus.updatedAtText,
                            formalKpiMode: true,
                            formalTrustReason: trust.reason,
                        };
                    }
                    pushTelegramAgentWarning(ctx, `${getTelegramAgentBrandLabel(brandId)} ${yearMonth} Formal Summary 不符合信任契約（${trust.reason}），已改走 correctness fallback。`);
                } else {
                    const rows = (Array.isArray(dashboardData.stores) ? dashboardData.stores : Object.values(dashboardData.stores || {}))
                        .map((row) => normalizeTelegramAgentStoreRow(row, brandId, row, { cashIsNet: true, skincareIsNet: false }));
                    return {
                        rows,
                        overall: aggregateTelegramAgentStoreRows(rows, yearMonth, getTelegramAgentMonthEnd(yearMonth)),
                        source: "verified_dashboard_summary",
                        updatedAtText: dashboardResult.updatedAtText || summaryStatus.updatedAtText,
                    };
                }
            }
        } else if (ctx) {
            ctx.warnings.push(`${getTelegramAgentBrandLabel(brandId)} ${yearMonth} Summary 狀態為 ${summaryStatus.status}，已改讀月彙總避免使用可能過期資料。`);
        }
    }

    const aggregatedCollection = getSummarySourceCollection(brandId, "monthly_aggregated");
    const aggregatedResult = await queryTelegramAgentDocs(
        aggregatedCollection.where("yearMonth", "==", yearMonth),
        `query:${aggregatedCollection.path}:yearMonth=${yearMonth}`,
        ctx,
        "monthly_aggregated",
        { brandId, yearMonth },
        isCurrentMonth ? 60 : 600
    );

    if (aggregatedResult.rows.length > 0) {
        const org = await loadTelegramAgentOrgProfile(brandId, ctx);
        const targetStores = scopedStores.length > 0 ? scopedStores : (org.stores || []);
        const targetResult = await loadTelegramAgentTargetMap(brandId, yearMonth, ctx, dashboardData, targetStores);
        const scopedAggregatedRows = scopedStoreSet.size > 0
            ? aggregatedResult.rows.filter((row) => scopedStoreSet.has(normalizeSummaryCoreName(row.storeName || row.store || row.id || "")))
            : aggregatedResult.rows;
        const rows = scopedAggregatedRows.map((row) => {
            const core = normalizeSummaryCoreName(row.storeName || row.store || row.id || "");
            const target = targetResult.map[core] || {};
            const normalized = normalizeTelegramAgentStoreRow({ ...row, manager: org.storeOwner[core] || row.manager || "未分配" }, brandId, target, { cashIsNet: false, skincareIsNet: false });
            return formalKpiMode ? { ...normalized, ...buildTelegramFormalRawMetrics(brandId, row, target) } : normalized;
        });
        return {
            rows,
            overall: aggregateTelegramAgentStoreRows(rows, yearMonth, isCurrentMonth ? taipeiNow.todayStr : getTelegramAgentMonthEnd(yearMonth)),
            source: `${formalKpiMode ? "formal_" : ""}monthly_aggregated+${targetResult.source}`,
            updatedAtText: targetResult.updatedAtText || "",
            formalKpiMode,
        };
    }

    const rawFallback = await loadTelegramAgentRawStoreRange(
        brandId,
        `${yearMonth}-01`,
        isCurrentMonth ? taipeiNow.todayStr : getTelegramAgentMonthEnd(yearMonth),
        ctx,
        { storeNames: scopedStores, formalKpiMode }
    );
    if (rawFallback.rows.length > 0 && ctx) {
        ctx.warnings.push(`${getTelegramAgentBrandLabel(brandId)} ${yearMonth} 月彙總缺漏，本題已改讀品牌限定日報。`);
    }
    return {
        ...rawFallback,
        source: rawFallback.rows.length > 0 ? (formalKpiMode ? "daily_reports_month_fallback_formal" : "daily_reports_month_fallback") : "no_data",
        formalKpiMode,
    };
}

async function loadTelegramAgentRawStoreRange(brandId, startDate, endDate, ctx, options = {}) {
    const requestedStores = normalizeTelegramAgentStoreNamesFull(options.storeNames || options.targetStores || []);
    const requestedStoreSet = new Set(requestedStores);
    const collectionRef = getSummarySourceCollection(brandId, "daily_reports");

    // ★ 單店 Firestore query-level 節流：
    // 過去即使只問一間店，也會先把整品牌日期區間全部讀回，再在記憶體中過濾，
    // 造成單店查詢仍產生數百筆 reads。現在只有「明確單店 scope」時才優先使用
    // storeName + date 的精準查詢；全品牌／區長／排行／多店查詢完全保留原流程。
    // 若正式店名格式不相容、該店查不到資料，或 Firestore 尚未建立所需複合索引，
    // 會自動退回原本品牌日期查詢，確保資料正確性不因節流而退步。
    let result = null;

    if (requestedStores.length === 1) {
        const storeCore = requestedStores[0];
        const firestoreStoreName = `${getSummaryBrandPrefix(brandId)}${storeCore}店`;
        try {
            const exactResult = await queryTelegramAgentDocs(
                collectionRef
                    .where("storeName", "==", firestoreStoreName)
                    .where("date", ">=", startDate)
                    .where("date", "<=", endDate),
                `query:${collectionRef.path}:storeName=${firestoreStoreName}:date=${startDate}..${endDate}`,
                ctx,
                "daily_reports_scoped",
                {
                    brandId,
                    yearMonth: startDate.slice(0, 7),
                    storeName: storeCore,
                    firestoreStoreName,
                    queryMode: "single_store_exact",
                },
                45
            );

            // 有命中才採用精準結果；0 筆時保留舊流程 fallback，避免歷史別名／舊格式造成漏算。
            if (exactResult.rows.length > 0) result = exactResult;
        } catch (error) {
            console.warn(
                `[Telegram Agent] daily_reports 單店精準查詢失敗，改用品牌日期 fallback: ${brandId}/${firestoreStoreName}/${startDate}..${endDate}`,
                error?.message || error
            );
        }
    }

    if (!result) {
        result = await queryTelegramAgentDocs(
            collectionRef.where("date", ">=", startDate).where("date", "<=", endDate),
            `query:${collectionRef.path}:date=${startDate}..${endDate}`,
            ctx,
            "daily_reports_scoped",
            {
                brandId,
                yearMonth: startDate.slice(0, 7),
                queryMode: requestedStores.length === 1 ? "brand_date_fallback" : "brand_date_range",
                requestedStores,
            },
            45
        );
    }

    const storeMap = {};
    const dailyCash = {};
    result.rows.forEach((sourceRow) => {
        if (sourceRow.isArchivedDuplicate === true) return;
        const core = normalizeSummaryCoreName(sourceRow.storeName || sourceRow.store || sourceRow.storeId || "");
        if (!core) return;
        if (requestedStoreSet.size > 0 && !requestedStoreSet.has(core)) return;
        if (!storeMap[core]) storeMap[core] = { storeName: core, __rawDaily: true, __formalRawRows: [] };
        const row = storeMap[core];
        if (options.formalKpiMode === true) row.__formalRawRows.push(sourceRow);
        row.grossCash = Number(row.grossCash || 0) + (Number(sourceRow.cash) || 0);
        row.refund = Number(row.refund || 0) + (Number(sourceRow.refund) || 0);
        row.cash = Number(row.cash || 0) + (Number(sourceRow.cash) || 0) - (Number(sourceRow.refund) || 0);
        row.accrual = Number(row.accrual || 0) + (Number(sourceRow.accrual) || 0);
        row.operationalAccrual = Number(row.operationalAccrual || 0) + (Number(sourceRow.operationalAccrual) || 0);
        // 保留毛保養品與退費，區域卡片採毛保養品，其他分析可使用淨額。
        row.skincareSales = Number(row.skincareSales || 0) + (Number(sourceRow.skincareSales) || 0);
        row.skincareRefund = Number(row.skincareRefund || 0) + (Number(sourceRow.skincareRefund) || 0);
        row.traffic = Number(row.traffic || 0) + (Number(sourceRow.traffic) || 0);
        row.newCustomerSales = Number(row.newCustomerSales || 0) + (Number(sourceRow.newCustomerSales || sourceRow.newCustomerRevenue) || 0);
        row.newCustomers = Number(row.newCustomers || 0) + (Number(sourceRow.newCustomers || sourceRow.newCustomerCount) || 0);
        row.newCustomerClosings = Number(row.newCustomerClosings || 0) + (Number(sourceRow.newCustomerClosings) || 0);
        dailyCash[sourceRow.date] = (dailyCash[sourceRow.date] || 0) + (Number(sourceRow.cash) || 0) - (Number(sourceRow.refund) || 0) - (options.formalKpiMode === true ? (Number(sourceRow.skincareRefund) || 0) : 0);
    });

    const yearMonth = startDate.slice(0, 7);
    const shouldLoadTargets = options.includeTargets === true || startDate.slice(0, 7) === endDate.slice(0, 7);
    const org = await loadTelegramAgentOrgProfile(brandId, ctx);
    const targetStores = requestedStores.length > 0 ? requestedStores : Object.keys(storeMap);
    const targetResult = shouldLoadTargets
        ? await loadTelegramAgentTargetMap(brandId, yearMonth, ctx, null, targetStores)
        : { map: {}, source: "not_requested", updatedAtText: "" };
    const rows = Object.values(storeMap).map((row) => {
        const core = normalizeSummaryCoreName(row.storeName || "");
        const target = targetResult.map[core] || {};
        const normalized = normalizeTelegramAgentStoreRow(
            { ...row, manager: org.storeOwner[core] || "未分配" },
            brandId,
            target,
            { cashIsNet: true, skincareIsNet: false }
        );
        if (options.formalKpiMode === true) {
            const canonicalActual = aggregateFormalMetrics(brandId, row.__formalRawRows || []);
            return { ...normalized, ...buildTelegramFormalMetricsFromCanonical(canonicalActual, target, "raw_canonical") };
        }
        return normalized;
    });
    const [year, month] = yearMonth.split("-").map(Number);
    const daysPassed = getClampedDaysPassed(dailyCash, year, month);
    const overall = aggregateTelegramAgentStoreRows(rows, yearMonth, endDate);
    overall.projection = calculateExactFrontendProjection(dailyCash, year, month, daysPassed);
    return {
        rows,
        overall,
        source: options.formalKpiMode === true ? "daily_reports_scoped_formal" : "daily_reports_scoped",
        updatedAtText: targetResult.updatedAtText || "",
        formalKpiMode: options.formalKpiMode === true,
    };
}

async function getStorePerformance(startDate, endDate, storeName = null, brandName = null, agentContext = null, policyScopes = ["telegram_analysis", "brand_totals"]) {
    if (storeName && !brandName && normalizeTelegramAgentBrandId(storeName)) {
        brandName = storeName;
        storeName = null;
    }
    const ctx = agentContext;
    const brands = resolveTelegramAgentBrands(brandName, storeName);
    const start = normalizeTelegramAgentDate(startDate);
    const end = normalizeTelegramAgentDate(endDate);
    const useMonthSummary = isTelegramAgentMonthRange(start, end);
    const requestedStoreCore = normalizeSummaryCoreName(storeName || "");
    // Batch 5C-2: policy scope only controls which stores/policies apply. It must not downgrade KPI authority.
    const formalKpiMode = true;
    const storeScopeOptions = {
        ...(requestedStoreCore ? { storeNames: [requestedStoreCore] } : {}),
        formalKpiMode,
    };
    const allRows = [];
    const sourceMeta = [];

    for (const brandId of brands) {
        assertTelegramAgentReadBudget(ctx, 1);
        const loaded = useMonthSummary
            ? await loadTelegramAgentStoreMonth(brandId, start.slice(0, 7), ctx, storeScopeOptions)
            : await loadTelegramAgentRawStoreRange(brandId, start, end, ctx, storeScopeOptions);
        if (loaded.preSystem === true) {
            sourceMeta.push({
                brand: getTelegramAgentBrandLabel(brandId),
                source: loaded.source,
                updatedAtText: "",
                dataStatus: "PRE_SYSTEM_SKIP",
                formalKpiMode,
                activeDelegationCount: 0,
                policyExcludedCount: 0,
            });
            continue;
        }
        const org = await loadTelegramAgentOrgProfile(brandId, ctx);
        const basePolicyRows = filterTelegramAgentRowsByPolicies(loaded.rows, brandId, ctx, policyScopes);
        const rowsNeedingTargetRepair = loaded.formalKpiMode === true ? [] : basePolicyRows
            .filter((row) => !requestedStoreCore || normalizeSummaryCoreName(row.storeName) === requestedStoreCore)
            .filter((row) => Number(row?.budget || 0) <= 0)
            .map((row) => normalizeSummaryCoreName(row.storeName))
            .filter(Boolean);
        const targetRepair = rowsNeedingTargetRepair.length > 0
            ? await loadTelegramAgentTargetMap(brandId, start.slice(0, 7), ctx, null, rowsNeedingTargetRepair)
            : { map: {}, source: loaded.formalKpiMode === true ? "formal_row_authority" : "not_needed", updatedAtText: "" };
        const policyRows = basePolicyRows.map((row) => {
                const storeCore = normalizeSummaryCoreName(row.storeName);
                const delegation = org.actingDelegationByStore?.[storeCore] || null;
                const repairedTarget = targetRepair.map?.[storeCore] || {};
                const budget = loaded.formalKpiMode === true ? row?.budget : Number(row?.budget || repairedTarget.cashTarget || 0);
                const accrualBudget = loaded.formalKpiMode === true ? row?.accrualBudget : Number(row?.accrualBudget || repairedTarget.accrualTarget || 0);
                return {
                    ...row,
                    manager: org.storeOwner?.[storeCore] || row.manager || "未分配",
                    actingManager: delegation?.delegateName || "",
                    delegationId: delegation?.id || "",
                    delegationEndDate: delegation?.endDate || "",
                    budget,
                    accrualBudget,
                    achievement: loaded.formalKpiMode === true
                        ? row?.achievement ?? null
                        : (budget > 0 ? Number(((Number(row?.cash || 0) / budget) * 100).toFixed(1)) : 0),
                    cashAchievementRate: loaded.formalKpiMode === true ? row?.cashAchievementRate ?? row?.achievement ?? null : undefined,
                };
            });
        policyRows.forEach((row) => allRows.push(row));
        sourceMeta.push({
            brand: getTelegramAgentBrandLabel(brandId),
            source: loaded.source,
            updatedAtText: loaded.updatedAtText,
            activeDelegationCount: Array.isArray(org.activeDelegations) ? org.activeDelegations.length : 0,
            policyExcludedCount: Math.max(0, loaded.rows.length - policyRows.length),
            formalKpiMode: loaded.formalKpiMode === true,
        });
    }

    const requestedCore = normalizeSummaryCoreName(storeName || "");
    const filteredRows = requestedCore
        ? allRows.filter((row) => normalizeSummaryCoreName(row.storeName).includes(requestedCore) || requestedCore.includes(normalizeSummaryCoreName(row.storeName)))
        : allRows;
    const yearMonth = start.slice(0, 7);
    const overall = aggregateTelegramAgentStoreRows(filteredRows, yearMonth, end);
    const sortedRows = filteredRows
        .map((row) => ({
            ...row,
            projection: calculateTelegramAgentProjection(row.cash, yearMonth, end),
            newAvg: row.newCount > 0 ? Math.round(row.newRev / row.newCount) : 0,
            oldAvg: row.oldCount > 0 ? Math.round(row.oldRev / row.oldCount) : 0,
            newClosingRate: row.newCount > 0 ? Number(((row.newClosings / row.newCount) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.cash - a.cash)
        .slice(0, 80);

    return {
        query_range: `${start} ~ ${end}`,
        overall_summary: overall,
        stores_details: sortedRows,
        source_meta: sourceMeta,
        data_note: "查詢使用 Formal KPI contract；policy scope 僅控制納入範圍，不改變 KPI authority。歷史 verified 月優先使用 Formal Summary，本月／日期區間使用即時資料套用同一 KPI 語意。",
        formal_kpi_mode: formalKpiMode,
        pre_system_skips: sourceMeta.filter((row) => row.dataStatus === "PRE_SYSTEM_SKIP").map((row) => row.brand),
    };
}

function normalizeTelegramAgentTherapistRow(row = {}, brandId = "cyj") {
    const totalRevenue = Number(row.totalRevenue || row.revenue || 0);
    const newRev = Number(row.newCustomerRevenue || row.newRev || 0);
    const oldRev = Number(row.oldCustomerRevenue || row.oldRev || 0) || Math.max(0, totalRevenue - newRev);
    const newCount = Number(row.newCustomerCount || row.newCount || 0);
    const oldCount = Number(row.oldCustomerCount || row.oldCount || 0);
    const newClosings = Number(row.newCustomerClosings || row.newClosings || 0);
    return {
        id: row.id || row.therapistId || "",
        personName: row.name || row.personName || row.therapistName || "未知",
        storeName: normalizeSummaryCoreName(row.store || row.storeName || row.storeDisplay || ""),
        manager: row.manager || "未分配",
        brandId,
        brand: getTelegramAgentBrandLabel(brandId),
        revenue: totalRevenue,
        serviceCount: Number(row.serviceCount || 0),
        newRev,
        oldRev,
        newCount,
        oldCount,
        newClosings,
        newClosingRate: newCount > 0 ? Number(((newClosings / newCount) * 100).toFixed(1)) : 0,
        newAvg: newCount > 0 ? Math.round(newRev / newCount) : 0,
        oldAvg: oldCount > 0 ? Math.round(oldRev / oldCount) : 0,
        rank: Number(row.rank || 0),
    };
}

function aggregateTelegramAgentTherapistRows(rows = [], yearMonth = "", endDate = "") {
    const overall = { revenue: 0, serviceCount: 0, newRev: 0, oldRev: 0, newCount: 0, oldCount: 0, newClosings: 0, projection: 0 };
    rows.forEach((row) => {
        overall.revenue += Number(row.revenue || 0);
        overall.serviceCount += Number(row.serviceCount || 0);
        overall.newRev += Number(row.newRev || 0);
        overall.oldRev += Number(row.oldRev || 0);
        overall.newCount += Number(row.newCount || 0);
        overall.oldCount += Number(row.oldCount || 0);
        overall.newClosings += Number(row.newClosings || 0);
    });
    overall.newClosingRate = overall.newCount > 0 ? Number(((overall.newClosings / overall.newCount) * 100).toFixed(1)) : 0;
    overall.newAvg = overall.newCount > 0 ? Math.round(overall.newRev / overall.newCount) : 0;
    overall.oldAvg = overall.oldCount > 0 ? Math.round(overall.oldRev / overall.oldCount) : 0;
    overall.projection = calculateTelegramAgentProjection(overall.revenue, yearMonth, endDate);
    return overall;
}

async function loadTelegramAgentTherapistMonth(brandId, yearMonth, ctx, options = {}) {
    const taipeiNow = getTelegramAgentTaipeiNow();
    const scopedStores = normalizeTelegramAgentStoreNamesFull(options.storeNames || options.targetStores || []);
    const isCurrentMonth = yearMonth === taipeiNow.yearMonth;

    // 當月人員分析直接使用品牌限定管理師日報，避免人員月彙總尚未完整造成少算。
    // 若上層已指定單店 scope，將 scope 往 raw loader 傳遞，讓 Firestore 可直接做單店精準查詢。
    if (isCurrentMonth) {
        const liveResult = await loadTelegramAgentRawTherapistRange(
            brandId,
            `${yearMonth}-01`,
            taipeiNow.todayStr,
            ctx,
            { storeNames: scopedStores }
        );
        if (liveResult.rows.length > 0) return { ...liveResult, source: "therapist_daily_reports_current_month_exact" };
        if (ctx) ctx.warnings.push(`${getTelegramAgentBrandLabel(brandId)} ${yearMonth} 當月管理師日報讀取為 0，已改用人員月彙總 fallback。`);
    }

    if (!isCurrentMonth) {
        const summaryStatus = await loadTelegramAgentSummaryStatus(brandId, yearMonth, ctx);
        if (summaryStatus.verified) {
            const summaryResult = await readTelegramAgentDoc(
                getSummaryCollection(brandId, "therapist_summary").doc(yearMonth),
                ctx,
                "therapist_summary",
                { brandId, yearMonth },
                900
            );
            if (summaryResult.exists && Array.isArray(summaryResult.data?.rankings)) {
                const rows = summaryResult.data.rankings.map((row) => normalizeTelegramAgentTherapistRow(row, brandId));
                return { rows, overall: aggregateTelegramAgentTherapistRows(rows, yearMonth, getTelegramAgentMonthEnd(yearMonth)), source: "verified_therapist_summary", updatedAtText: summaryResult.updatedAtText || summaryStatus.updatedAtText };
            }
        } else if (ctx) {
            ctx.warnings.push(`${getTelegramAgentBrandLabel(brandId)} ${yearMonth} 人員 Summary 狀態為 ${summaryStatus.status}，已改讀人員月彙總。`);
        }
    }

    const collectionRef = getSummarySourceCollection(brandId, "therapist_monthly_aggregated");
    const aggregatedResult = await queryTelegramAgentDocs(
        collectionRef.where("yearMonth", "==", yearMonth),
        `query:${collectionRef.path}:yearMonth=${yearMonth}`,
        ctx,
        "therapist_monthly_aggregated",
        { brandId, yearMonth },
        isCurrentMonth ? 60 : 600
    );
    if (aggregatedResult.rows.length > 0) {
        const org = await loadTelegramAgentOrgProfile(brandId, ctx);
        const rows = aggregatedResult.rows.map((row) => {
            const core = normalizeSummaryCoreName(row.storeName || row.store || "");
            return normalizeTelegramAgentTherapistRow({ ...row, manager: org.storeOwner[core] || row.manager || "未分配" }, brandId);
        });
        rows.sort((a, b) => b.revenue - a.revenue).forEach((row, index) => { row.rank = index + 1; });
        return { rows, overall: aggregateTelegramAgentTherapistRows(rows, yearMonth, isCurrentMonth ? taipeiNow.todayStr : getTelegramAgentMonthEnd(yearMonth)), source: "therapist_monthly_aggregated", updatedAtText: "" };
    }

    const rawFallback = await loadTelegramAgentRawTherapistRange(
        brandId,
        `${yearMonth}-01`,
        isCurrentMonth ? taipeiNow.todayStr : getTelegramAgentMonthEnd(yearMonth),
        ctx,
        { storeNames: scopedStores }
    );
    if (rawFallback.rows.length > 0 && ctx) {
        ctx.warnings.push(`${getTelegramAgentBrandLabel(brandId)} ${yearMonth} 人員月彙總缺漏，本題已改讀品牌限定管理師日報。`);
    }
    return {
        ...rawFallback,
        source: rawFallback.rows.length > 0 ? "therapist_daily_reports_month_fallback" : "no_data",
    };
}


function getTelegramAgentTherapistStoreQueryNames(brandId, storeName) {
    const storeCore = normalizeSummaryCoreName(storeName || "");
    if (!storeCore) return [];

    const brandPrefix = getSummaryBrandPrefix(brandId);
    const brandIdText = String(brandId || "").toLowerCase();
    const prefixes = new Set([brandPrefix]);

    // therapist_daily_reports 的現行前端會把店名正規化後寫入 core（例如「崇學」）。
    // 同時保留舊版可能曾寫入的「崇學店 / CYJ崇學店 / DRCYJ崇學店」等格式，
    // 以多個低成本精準 query 合併，避免只命中新格式卻漏掉同月份舊格式文件。
    if (isLegacyCyjBrand(brandId)) {
        prefixes.add("CYJ");
        prefixes.add("DRCYJ");
    } else if (brandIdText.includes("anniu") || brandIdText.includes("anew")) {
        prefixes.add("安妞");
        prefixes.add("Anew");
        prefixes.add("Anew安妞");
    } else if (brandIdText.includes("yibo")) {
        prefixes.add("伊啵");
        prefixes.add("Yibo");
        prefixes.add("Yibo伊啵");
    }

    const names = new Set();
    names.add(storeCore);

    if (storeCore === "新店") {
        names.add("新店店");
        prefixes.forEach((prefix) => {
            if (!prefix) return;
            names.add(`${prefix}新店`);
            names.add(`${prefix}新店店`);
        });
    } else {
        names.add(`${storeCore}店`);
        prefixes.forEach((prefix) => {
            if (!prefix) return;
            names.add(`${prefix}${storeCore}`);
            names.add(`${prefix}${storeCore}店`);
        });
    }

    return [...names].filter(Boolean);
}

async function loadTelegramAgentRawTherapistRange(brandId, startDate, endDate, ctx, options = {}) {
    const requestedStores = normalizeTelegramAgentStoreNamesFull(options.storeNames || options.targetStores || []);
    const requestedStoreSet = new Set(requestedStores);
    const collectionRef = getSummarySourceCollection(brandId, "therapist_daily_reports");

    // ★ 單店管理師 Firestore query-level 節流：
    // 過去即使只問一間店，也會先讀完整品牌管理師日報，再於 getTherapistPerformance 最後過濾店家。
    // 現在只有「明確單店 scope」且問題不是要求全品牌名次時，才優先使用 storeName + date 精準查詢。
    // 若索引未建立、正式店名格式不相容或精準查詢 0 筆，會自動退回原本品牌日期查詢。
    const rankingRequested = /排名|排行|第幾|名次|前\s*\d+|後\s*\d+/i.test(String(ctx?.question || ""));
    let result = null;

    if (requestedStores.length === 1 && !rankingRequested) {
        const storeCore = requestedStores[0];
        const storeNameCandidates = getTelegramAgentTherapistStoreQueryNames(brandId, storeCore);
        const exactRowsById = new Map();
        let exactQuerySucceeded = false;

        try {
            for (const firestoreStoreName of storeNameCandidates) {
                const exactResult = await queryTelegramAgentDocs(
                    collectionRef
                        .where("storeName", "==", firestoreStoreName)
                        .where("date", ">=", startDate)
                        .where("date", "<=", endDate),
                    `query:${collectionRef.path}:storeName=${firestoreStoreName}:date=${startDate}..${endDate}`,
                    ctx,
                    "therapist_daily_reports_scoped",
                    {
                        brandId,
                        yearMonth: startDate.slice(0, 7),
                        storeName: storeCore,
                        firestoreStoreName,
                        queryMode: "single_store_exact_variant",
                    },
                    45
                );
                exactQuerySucceeded = true;
                exactResult.rows.forEach((row) => {
                    const rowId = String(row.id || `${row.therapistId || ""}_${row.date || ""}_${firestoreStoreName}`);
                    if (!exactRowsById.has(rowId)) exactRowsById.set(rowId, row);
                });
            }

            if (exactRowsById.size > 0) {
                result = {
                    rows: [...exactRowsById.values()],
                    size: exactRowsById.size,
                    updatedAtText: "",
                };
            }
        } catch (error) {
            console.warn(
                `[Telegram Agent] therapist_daily_reports 單店多格式精準查詢失敗，改用品牌日期 fallback: ${brandId}/${storeCore}/${startDate}..${endDate}`,
                error?.message || error
            );
        }

        if (exactQuerySucceeded && exactRowsById.size === 0) {
            console.warn(
                `[Telegram Agent] therapist_daily_reports 單店多格式精準查詢為 0，改用品牌日期 fallback: ${brandId}/${storeCore}/${startDate}..${endDate}`
            );
        }
    }

    if (!result) {
        result = await queryTelegramAgentDocs(
            collectionRef.where("date", ">=", startDate).where("date", "<=", endDate),
            `query:${collectionRef.path}:date=${startDate}..${endDate}`,
            ctx,
            "therapist_daily_reports_scoped",
            {
                brandId,
                yearMonth: startDate.slice(0, 7),
                queryMode: requestedStores.length === 1 ? (rankingRequested ? "brand_date_ranking_guard" : "brand_date_fallback") : "brand_date_range",
                requestedStores,
            },
            45
        );
    }

    const map = {};
    result.rows.forEach((sourceRow) => {
        if (sourceRow.isArchivedDuplicate === true) return;

        const sourceStoreCore = normalizeSummaryCoreName(sourceRow.storeName || sourceRow.store || sourceRow.storeId || "");
        if (requestedStoreSet.size > 0 && !requestedStoreSet.has(sourceStoreCore)) return;

        const id = sourceRow.therapistId || normalizeSummaryPersonName(sourceRow.therapistName || "");
        if (!id) return;
        if (!map[id]) map[id] = { id, therapistName: sourceRow.therapistName || "未知", storeName: sourceRow.storeName || "" };
        const row = map[id];
        ["totalRevenue", "serviceCount", "newCustomerRevenue", "oldCustomerRevenue", "newCustomerCount", "oldCustomerCount", "newCustomerClosings"].forEach((field) => {
            row[field] = Number(row[field] || 0) + (Number(sourceRow[field]) || 0);
        });
    });
    const org = await loadTelegramAgentOrgProfile(brandId, ctx);
    const rows = Object.values(map).map((row) => {
        const core = normalizeSummaryCoreName(row.storeName || "");
        return normalizeTelegramAgentTherapistRow({ ...row, manager: org.storeOwner[core] || "未分配" }, brandId);
    });
    rows.sort((a, b) => b.revenue - a.revenue).forEach((row, index) => { row.rank = index + 1; });
    return { rows, overall: aggregateTelegramAgentTherapistRows(rows, startDate.slice(0, 7), endDate), source: "therapist_daily_reports_scoped", updatedAtText: "" };
}

async function getTherapistPerformance(startDate, endDate, personName = null, storeName = null, brandName = null, agentContext = null, storeNames = [], policyScopes = ["telegram_analysis", "ranking"]) {
    if (storeName && !brandName && normalizeTelegramAgentBrandId(storeName)) {
        brandName = storeName;
        storeName = null;
    }
    const ctx = agentContext;
    const brands = resolveTelegramAgentBrands(brandName, storeName);
    const start = normalizeTelegramAgentDate(startDate);
    const end = normalizeTelegramAgentDate(endDate);
    const useMonthSummary = isTelegramAgentMonthRange(start, end);
    const storeQuery = normalizeSummaryCoreName(storeName || "");
    const inheritedStoreList = normalizeTelegramAgentStoreNames(storeNames || []);
    const scopedStoreNames = storeQuery ? [storeQuery] : inheritedStoreList;
    const therapistScopeOptions = scopedStoreNames.length > 0 ? { storeNames: scopedStoreNames } : {};
    const allRows = [];
    const sourceMeta = [];
    for (const brandId of brands) {
        const loaded = useMonthSummary
            ? await loadTelegramAgentTherapistMonth(brandId, start.slice(0, 7), ctx, therapistScopeOptions)
            : await loadTelegramAgentRawTherapistRange(brandId, start, end, ctx, therapistScopeOptions);
        const policyRows = filterTelegramAgentRowsByPolicies(loaded.rows, brandId, ctx, policyScopes);
        policyRows.forEach((row) => allRows.push(row));
        sourceMeta.push({
            brand: getTelegramAgentBrandLabel(brandId),
            source: loaded.source,
            updatedAtText: loaded.updatedAtText,
            policyExcludedCount: Math.max(0, loaded.rows.length - policyRows.length),
        });
    }

    const personQuery = normalizeSummaryPersonName(personName || "").toLowerCase();
    const inheritedStores = new Set(inheritedStoreList);
    const filtered = allRows.filter((row) => {
        if (personQuery && !normalizeSummaryPersonName(row.personName).toLowerCase().includes(personQuery)) return false;
        const rowStore = normalizeSummaryCoreName(row.storeName);
        if (storeQuery && !rowStore.includes(storeQuery)) return false;
        if (inheritedStores.size > 0 && !inheritedStores.has(rowStore)) return false;
        return true;
    });
    const yearMonth = start.slice(0, 7);
    const sortedRows = filtered.sort((a, b) => b.revenue - a.revenue).slice(0, 100);
    return {
        query_range: `${start} ~ ${end}`,
        overall_summary: aggregateTelegramAgentTherapistRows(sortedRows, yearMonth, end),
        therapists_details: sortedRows,
        source_meta: sourceMeta,
        applied_scope: {
            brands: sourceMeta.map((row) => row.brand),
            stores: inheritedStores.size > 0 ? [...inheritedStores] : (storeQuery ? [storeQuery] : []),
        },
        data_note: useMonthSummary ? "當月使用品牌限定管理師日報；歷史整月優先使用已驗證人員 Summary。" : "指定日期區間使用品牌限定管理師日報。",
    };
}

async function getMissingReports(startDate, endDate, brandName = null, agentContext = null, policyScopes = ["data_audit"]) {
    const ctx = agentContext;
    const brands = resolveTelegramAgentBrands(brandName, "");
    const start = normalizeTelegramAgentDate(startDate);
    const end = normalizeTelegramAgentDate(endDate);
    const results = [];
    for (const brandId of brands) {
        const org = await loadTelegramAgentOrgProfile(brandId, ctx);
        const auditExclusions = await loadTelegramAgentAuditExclusions(brandId, ctx);
        const collectionRef = getSummarySourceCollection(brandId, "daily_reports");
        const submittedResult = await queryTelegramAgentDocs(
            collectionRef.where("date", ">=", start).where("date", "<=", end),
            `query:${collectionRef.path}:submitted=${start}..${end}`,
            ctx,
            "daily_reports_submitted",
            { brandId, yearMonth: start.slice(0, 7) },
            45
        );
        const submitted = new Set();
        submittedResult.rows.forEach((row) => {
            if (row.isArchivedDuplicate === true) return;
            const core = normalizeSummaryCoreName(row.storeName || row.store || "");
            if (core) submitted.add(core);
        });
        const officialStores = normalizeTelegramAgentStoreNamesFull(org.stores || [])
            .filter((store) => !auditExclusions.storeSet.has(store));
        const expected = filterTelegramAgentStoresByPolicies(officialStores, brandId, ctx, policyScopes);
        const submittedExpectedCount = expected.filter((store) => submitted.has(store)).length;
        const missing = expected.filter((store) => !submitted.has(store));
        const missingDetails = missing.map((storeName) => {
            const delegation = org.actingDelegationByStore?.[storeName] || null;
            return {
                storeName,
                officialManager: org.storeOwner?.[storeName] || "未分配",
                actingManager: delegation?.permissions?.receiveAlerts !== false ? (delegation?.delegateName || "") : "",
                delegationId: delegation?.id || "",
                delegationEndDate: delegation?.endDate || "",
            };
        });
        results.push({
            brand: getTelegramAgentBrandLabel(brandId),
            brandId,
            expectedCount: expected.length,
            submittedCount: submittedExpectedCount,
            missingCount: missing.length,
            missingStores: missing,
            missingDetails,
            activeDelegationCount: Array.isArray(org.activeDelegations) ? org.activeDelegations.length : 0,
            excludedStoreCount: Math.max(0, normalizeTelegramAgentStoreNamesFull(org.stores || []).length - expected.length),
            source: "org_structure + management_delegations + audit_exclusions + telegram_agent_policies + daily_reports_scoped",
        });
    }
    return { query_range: `${start} ~ ${end}`, brands: results };
}

async function getMacroStrategicAnalysis(startMonth, endMonth, storeName = null, brandName = null, agentContext = null) {
    const ctx = agentContext;
    const months = enumerateTelegramAgentMonths(startMonth, endMonth);
    if (months.length === 0) throw new Error("跨月查詢月份格式錯誤");
    if (months.length > TELEGRAM_AGENT_MAX_MACRO_MONTHS) throw new Error(`跨月查詢最多 ${TELEGRAM_AGENT_MAX_MACRO_MONTHS} 個月`);
    const brands = resolveTelegramAgentBrands(brandName, storeName);
    const requestedStore = normalizeSummaryCoreName(storeName || "");
    const monthlyTrends = [];
    const storeTotals = {};
    const brandTotals = {};

    for (const yearMonth of months) {
        for (const brandId of brands) {
            const loaded = await loadTelegramAgentStoreMonth(
                brandId,
                yearMonth,
                ctx,
                { ...(requestedStore ? { storeNames: [requestedStore] } : {}), formalKpiMode: true }
            );
            if (loaded.preSystem === true) {
                monthlyTrends.push({
                    yearMonth,
                    brand: getTelegramAgentBrandLabel(brandId),
                    status: "PRE_SYSTEM_SKIP",
                    source: loaded.source,
                });
                continue;
            }
            const policyRows = filterTelegramAgentRowsByPolicies(loaded.rows, brandId, ctx, ["telegram_analysis", "brand_totals"]);
            const rows = requestedStore
                ? policyRows.filter((row) => normalizeSummaryCoreName(row.storeName).includes(requestedStore))
                : policyRows;
            const overall = aggregateTelegramAgentStoreRows(rows, yearMonth, getTelegramAgentMonthEnd(yearMonth));
            monthlyTrends.push({
                yearMonth,
                brand: getTelegramAgentBrandLabel(brandId),
                cash: overall.cash,
                accrual: overall.accrual,
                traffic: overall.traffic,
                newRev: overall.newRev,
                newCount: overall.newCount,
                budget: overall.budget,
                achievement: overall.achievement,
                cashAchievementStatus: overall.cashAchievementStatus || "",
                accrualAchievement: overall.accrualAchievement ?? null,
                accrualAchievementStatus: overall.accrualAchievementStatus || "",
                source: loaded.source,
                updatedAtText: loaded.updatedAtText,
            });
            if (!brandTotals[brandId]) brandTotals[brandId] = { brand: getTelegramAgentBrandLabel(brandId), cash: 0, accrual: 0, traffic: 0, newRev: 0, newCount: 0, budget: 0, cashTargetComplete: true };
            ["cash", "accrual", "traffic", "newRev", "newCount"].forEach((field) => { brandTotals[brandId][field] += Number(overall[field] || 0); });
            if (overall.budget === null || overall.budget === undefined) brandTotals[brandId].cashTargetComplete = false;
            else brandTotals[brandId].budget += Number(overall.budget || 0);
            rows.forEach((row) => {
                const key = `${brandId}:${row.storeName}`;
                if (!storeTotals[key]) storeTotals[key] = { storeName: row.storeName, brand: getTelegramAgentBrandLabel(brandId), cash: 0, accrual: 0, traffic: 0, newRev: 0, newCount: 0, budget: 0, cashTargetComplete: true };
                ["cash", "accrual", "traffic", "newRev", "newCount"].forEach((field) => { storeTotals[key][field] += Number(row[field] || 0); });
                if (row.budget === null || row.budget === undefined) storeTotals[key].cashTargetComplete = false;
                else storeTotals[key].budget += Number(row.budget || 0);
            });
        }
    }

    Object.values(brandTotals).forEach((row) => {
        row.achievement = row.cashTargetComplete && row.budget > 0 ? Number(((row.cash / row.budget) * 100).toFixed(1)) : null;
        row.cashAchievementStatus = row.cashTargetComplete ? (row.budget > 0 ? "VALID" : "TARGET_NOT_SET") : "TARGET_INCOMPLETE";
        row.newCustomerASP = row.newCount > 0 ? Math.round(row.newRev / row.newCount) : 0;
    });
    const storeHealth = Object.values(storeTotals).map((row) => ({
        ...row,
        achievementRate: row.cashTargetComplete && row.budget > 0 ? Number(((row.cash / row.budget) * 100).toFixed(1)) : null,
        cashAchievementStatus: row.cashTargetComplete ? (row.budget > 0 ? "VALID" : "TARGET_NOT_SET") : "TARGET_INCOMPLETE",
        newCustomerASP: row.newCount > 0 ? Math.round(row.newRev / row.newCount) : 0,
    })).sort((a, b) => Number(b.cash || 0) - Number(a.cash || 0)).slice(0, 80);

    return {
        analysis_range: `${months[0]} ~ ${months[months.length - 1]}`,
        monthly_trends: monthlyTrends,
        brand_summaries: Object.values(brandTotals),
        store_health_and_targets: storeHealth,
        formal_kpi_mode: true,
        pre_system_skips: monthlyTrends.filter((row) => row.status === "PRE_SYSTEM_SKIP"),
    };
}

async function getManagerPerformance(yearMonth, managerName = null, brandName = null, agentContext = null) {
    const ctx = agentContext;
    const ym = normalizeTelegramAgentYearMonth(yearMonth) || getTelegramAgentTaipeiNow().yearMonth;
    const expectedProgress = getTelegramAgentExpectedProgress(ym);
    const managerQuery = normalizeTelegramAgentManagerName(managerName || "");
    let brands = resolveTelegramAgentBrands(brandName, "");
    const orgCache = {};

    // 未指定品牌但指定區長時，先以正式 org_structure 找到所屬品牌，避免混入其他品牌。
    if (!normalizeTelegramAgentBrandId(brandName || "") && managerQuery) {
        const matchedBrands = [];
        for (const brand of BRANDS) {
            const org = await loadTelegramAgentOrgProfile(brand.id, ctx);
            orgCache[brand.id] = org;
            const hasManager = Object.keys(org.managementStoresByManager || org.managers || {}).some((name) => {
                const normalized = normalizeTelegramAgentManagerName(name);
                return normalized === managerQuery || normalized.includes(managerQuery) || managerQuery.includes(normalized);
            });
            if (hasManager) matchedBrands.push(brand.id);
        }
        if (matchedBrands.length > 0) brands = matchedBrands;
    }

    const allRows = [];
    const managementScopes = [];
    const brandQuality = [];

    for (const brandId of brands) {
        const org = orgCache[brandId] || await loadTelegramAgentOrgProfile(brandId, ctx);
        const loaded = await loadTelegramAgentStoreMonth(brandId, ym, ctx, { formalKpiMode: true });
        if (loaded.preSystem === true) {
            brandQuality.push({
                brand: getTelegramAgentBrandLabel(brandId),
                brandId,
                yearMonth: ym,
                dataStatus: "PRE_SYSTEM_SKIP",
                source: loaded.source,
                targetSource: "pre_system_skip",
                orgSourcePath: org.sourcePath,
            });
            continue;
        }
        const useFormalRowTargetAuthority = loaded.source === "verified_formal_dashboard_summary";
        const targetResult = useFormalRowTargetAuthority
            ? { map: {}, source: "formal_row_authority", updatedAtText: loaded.updatedAtText || "" }
            : await loadTelegramAgentTargetMap(brandId, ym, ctx, null, org.stores || []);

        const rowByCore = {};
        loaded.rows.forEach((row) => {
            const core = normalizeSummaryCoreName(row.storeName);
            if (core) rowByCore[core] = row;
        });

        const managerMap = {};
        const assignedStores = new Set();

        Object.entries(org.managers || {}).forEach(([manager, stores]) => {
            const normalizedStores = filterTelegramAgentStoresByPolicies(
                stores || [],
                brandId,
                ctx,
                ["telegram_analysis", "ranking", "brand_totals"]
            );
            managerMap[manager] = {
                manager,
                brand: getTelegramAgentBrandLabel(brandId),
                brandId,
                stores: [],
                storeDetails: [],
                cash: 0,
                accrual: 0,
                skincare: 0,
                traffic: 0,
                newRev: 0,
                newCount: 0,
                newClosings: 0,
                budget: 0,
                expectedStoreCount: normalizedStores.length,
                reportedStoreCount: 0,
                targetedStoreCount: 0,
                missingReportStores: [],
                missingTargetStores: [],
                orgSourcePath: org.sourcePath || getOrgStructureDocRef(brandId).path,
            };

            normalizedStores.forEach((storeCore) => {
                assignedStores.add(storeCore);
                const row = rowByCore[storeCore] || null;
                const target = targetResult.map[storeCore] || {};
                const budget = loaded.formalKpiMode === true ? (row?.budget ?? target.cashTarget ?? null) : Number(row?.budget || target.cashTarget || 0);
                const hasReportData = loaded.formalKpiMode === true
                    ? Boolean(row && ["VALID", "VALID_ZERO"].includes(String(row.cashStatus || "")))
                    : Boolean(row);
                const hasTargetData = loaded.formalKpiMode === true
                    ? Boolean((row && isValidNumericStatus(String(row.cashTargetStatus || ""))) || isConfiguredAutoBaseTargetValue(target.cashTarget))
                    : budget > 0;
                const cash = Number(row?.cash || 0);
                const accrual = Number(row?.accrual || 0);
                const skincare = Number(row?.skincareGross ?? row?.skincare ?? 0);
                const traffic = Number(row?.traffic || 0);
                const newRev = Number(row?.newRev || 0);
                const newCount = Number(row?.newCount || 0);
                const newClosings = Number(row?.newClosings || 0);
                const targetManager = managerMap[manager];

                targetManager.stores.push(storeCore);
                if (hasReportData) targetManager.reportedStoreCount += 1;
                else targetManager.missingReportStores.push(storeCore);
                if (hasTargetData) targetManager.targetedStoreCount += 1;
                else targetManager.missingTargetStores.push(storeCore);

                targetManager.storeDetails.push({
                    storeName: storeCore,
                    cash,
                    accrual,
                    skincare,
                    traffic,
                    newCustomers: newCount,
                    retainedOrders: newClosings,
                    budget,
                    cashAchievementRate: loaded.formalKpiMode === true
                        ? row?.cashAchievementRate ?? row?.achievement ?? null
                        : (budget > 0 ? Number(((cash / budget) * 100).toFixed(1)) : null),
                    cashStatus: loaded.formalKpiMode === true ? row?.cashStatus || "" : "",
                    accrualStatus: loaded.formalKpiMode === true ? row?.accrualStatus || "" : "",
                    cashTargetStatus: loaded.formalKpiMode === true ? row?.cashTargetStatus || "" : "",
                    hasReportData,
                    hasTargetData,
                });
                targetManager.cash += cash;
                targetManager.accrual += accrual;
                targetManager.skincare += skincare;
                targetManager.traffic += traffic;
                targetManager.newRev += newRev;
                targetManager.newCount += newCount;
                targetManager.newClosings += newClosings;
                if (hasTargetData) targetManager.budget += Number(budget || 0);
            });
        });

        // 正式組織架構以外但存在日報的店家歸入未分配，保留資料但不參與正式排名。
        const managerPolicyExcludedStores = getTelegramPolicyExcludedStoreSet(ctx, brandId, ["telegram_analysis", "ranking", "brand_totals"]);
        loaded.rows.forEach((row) => {
            const storeCore = normalizeSummaryCoreName(row.storeName);
            if (!storeCore || assignedStores.has(storeCore) || managerPolicyExcludedStores.has(storeCore)) return;
            const manager = "未分配";
            if (!managerMap[manager]) {
                managerMap[manager] = {
                    manager,
                    brand: getTelegramAgentBrandLabel(brandId),
                    brandId,
                    stores: [],
                    storeDetails: [],
                    cash: 0,
                    accrual: 0,
                    skincare: 0,
                    traffic: 0,
                    newRev: 0,
                    newCount: 0,
                    newClosings: 0,
                    budget: 0,
                    expectedStoreCount: 0,
                    reportedStoreCount: 0,
                    targetedStoreCount: 0,
                    missingReportStores: [],
                    missingTargetStores: [],
                    orgSourcePath: org.sourcePath || getOrgStructureDocRef(brandId).path,
                };
            }
            const target = managerMap[manager];
            const budget = loaded.formalKpiMode === true ? (row?.budget ?? targetResult.map[storeCore]?.cashTarget ?? null) : Number(row.budget || targetResult.map[storeCore]?.cashTarget || 0);
            const hasTargetData = loaded.formalKpiMode === true ? (isValidNumericStatus(String(row?.cashTargetStatus || "")) || isConfiguredAutoBaseTargetValue(targetResult.map[storeCore]?.cashTarget)) : budget > 0;
            const hasReportData = loaded.formalKpiMode === true ? ["VALID", "VALID_ZERO"].includes(String(row?.cashStatus || "")) : true;
            target.stores.push(storeCore);
            if (hasReportData) target.reportedStoreCount += 1;
            if (hasTargetData) target.targetedStoreCount += 1;
            target.storeDetails.push({
                storeName: storeCore,
                cash: Number(row.cash || 0),
                accrual: Number(row.accrual || 0),
                skincare: Number(row.skincareGross ?? row.skincare ?? 0),
                traffic: Number(row.traffic || 0),
                newCustomers: Number(row.newCount || 0),
                retainedOrders: Number(row.newClosings || 0),
                budget,
                cashAchievementRate: loaded.formalKpiMode === true ? row?.cashAchievementRate ?? row?.achievement ?? null : (budget > 0 ? Number(((Number(row.cash || 0) / budget) * 100).toFixed(1)) : null),
                cashStatus: loaded.formalKpiMode === true ? row?.cashStatus || "" : "",
                cashTargetStatus: loaded.formalKpiMode === true ? row?.cashTargetStatus || "" : "",
                hasReportData,
                hasTargetData,
            });
            target.cash += Number(row.cash || 0);
            target.accrual += Number(row.accrual || 0);
            target.skincare += Number(row.skincareGross ?? row.skincare ?? 0);
            target.traffic += Number(row.traffic || 0);
            target.newRev += Number(row.newRev || 0);
            target.newCount += Number(row.newCount || 0);
            target.newClosings += Number(row.newClosings || 0);
            if (hasTargetData) target.budget += Number(budget || 0);
        });

        const managerRows = Object.values(managerMap).map((row) => {
            const scopeComplete = row.expectedStoreCount > 0 && row.reportedStoreCount >= row.expectedStoreCount && row.targetedStoreCount >= row.expectedStoreCount;
            const cashAchievementRate = scopeComplete && row.budget > 0 ? Number(((row.cash / row.budget) * 100).toFixed(1)) : null;
            const newClosingRate = row.newCount > 0 ? Number(((row.newClosings / row.newCount) * 100).toFixed(1)) : null;
            const skincareRatio = row.cash > 0 ? Number(((row.skincare / row.cash) * 100).toFixed(1)) : null;
            const dataQuality = buildTelegramAgentDataQuality({
                expectedStoreCount: row.expectedStoreCount,
                reportedStoreCount: row.reportedStoreCount,
                targetedStoreCount: row.targetedStoreCount,
                source: loaded.source,
                missingReportStores: row.missingReportStores,
                missingTargetStores: row.missingTargetStores,
            });
            return {
                ...row,
                achievement: cashAchievementRate,
                cashAchievementRate,
                expectedProgress,
                progressGap: cashAchievementRate === null ? null : Number((cashAchievementRate - expectedProgress).toFixed(1)),
                newCustomerASP: row.newCount > 0 ? Math.round(row.newRev / row.newCount) : 0,
                newClosingRate,
                skincareRatio,
                courseOperations: row.traffic,
                retainedOrders: row.newClosings,
                source: loaded.source,
                targetSource: targetResult.source,
                formalKpiMode: loaded.formalKpiMode === true,
                cashAchievementStatus: cashAchievementRate === null ? (row.targetedStoreCount < row.expectedStoreCount ? "TARGET_INCOMPLETE" : "DATA_INCOMPLETE") : "VALID",
                dataQuality,
                rankingEligible: dataQuality.rankingEligible,
                rankingStatus: dataQuality.rankingEligible ? "eligible" : "blocked_incomplete_data",
                achievementRank: null,
                brandRank: null,
                cashRank: null,
                progressGapRank: null,
                newCustomerRank: null,
                closingRateRank: null,
                skincareRatioRank: null,
            };
        });

        const formalRows = managerRows.filter(
            (row) => normalizeTelegramAgentManagerName(row.manager) !== normalizeTelegramAgentManagerName("未分配")
        );
        const eligibleRows = formalRows.filter((row) => row.rankingEligible);
        assignTelegramAgentRank(eligibleRows, "cashRank", (row) => row.cash);
        assignTelegramAgentRank(eligibleRows, "achievementRank", (row) => row.cashAchievementRate);
        assignTelegramAgentRank(eligibleRows, "progressGapRank", (row) => row.progressGap);
        assignTelegramAgentRank(eligibleRows, "newCustomerRank", (row) => row.newCount);
        assignTelegramAgentRank(eligibleRows.filter((row) => row.newClosingRate !== null), "closingRateRank", (row) => row.newClosingRate);
        assignTelegramAgentRank(eligibleRows.filter((row) => row.skincareRatio !== null), "skincareRatioRank", (row) => row.skincareRatio);

        formalRows.forEach((row) => {
            row.brandRank = row.achievementRank;
            row.brandManagerCount = eligibleRows.length;
            row.brandTotalManagerCount = formalRows.length;
            row.primaryRankMetric = "cash_achievement_rate";
            row.primaryRankLabel = "現金業績達成率排名";
            row.cashRankLabel = "現金總業績排名";
            row.rankNote = row.rankingEligible
                ? `排名以同品牌 ${eligibleRows.length} 位資料完整區長計算。`
                : `本區資料不完整，不提供名次：${row.dataQuality.rankingBlockedReason}`;
            const delegatedStores = org.delegatedStoresByManager?.[row.manager] || [];
            row.delegatedStoreNames = [...delegatedStores];
            row.temporaryManagementActive = delegatedStores.length > 0;
            allRows.push(row);
        });

        // 代理管理範圍獨立呈現，不把受託店家的績效併入正式區長排名。
        if (managerQuery) {
            const managementManagerName = Object.keys(org.managementStoresByManager || {}).find((name) => {
                const normalized = normalizeTelegramAgentManagerName(name);
                return normalized === managerQuery || normalized.includes(managerQuery) || managerQuery.includes(normalized);
            });
            if (managementManagerName) {
                const officialStoreSet = new Set(
                    ((org.managers || {})[managementManagerName] || []).map(normalizeSummaryCoreName).filter(Boolean)
                );
                const accessibleStores = filterTelegramAgentStoresByPolicies(
                    org.managementStoresByManager?.[managementManagerName] || [],
                    brandId,
                    ctx,
                    ["telegram_analysis", "ranking", "brand_totals"]
                );
                const delegatedStores = accessibleStores.filter((storeCore) => !officialStoreSet.has(storeCore));
                if (delegatedStores.length > 0) {
                    const storeDetails = accessibleStores.map((storeCore) => {
                        const row = rowByCore[storeCore] || null;
                        const target = targetResult.map[storeCore] || {};
                        const budget = loaded.formalKpiMode === true ? (row?.budget ?? target.cashTarget ?? null) : Number(row?.budget || target.cashTarget || 0);
                        const hasReportData = loaded.formalKpiMode === true ? Boolean(row && ["VALID", "VALID_ZERO"].includes(String(row.cashStatus || ""))) : Boolean(row);
                        const hasTargetData = loaded.formalKpiMode === true ? Boolean((row && isValidNumericStatus(String(row.cashTargetStatus || ""))) || isConfiguredAutoBaseTargetValue(target.cashTarget)) : budget > 0;
                        const cash = Number(row?.cash || 0);
                        const delegation = org.actingDelegationByStore?.[storeCore] || null;
                        return {
                            storeName: storeCore,
                            scopeType: officialStoreSet.has(storeCore) ? "official" : "delegated",
                            officialManager: org.storeOwner?.[storeCore] || "未分配",
                            actingManager: org.actingManagerByStore?.[storeCore] || "",
                            delegationId: delegation?.id || "",
                            delegationEndDate: delegation?.endDate || "",
                            cash,
                            accrual: Number(row?.accrual || 0),
                            budget,
                            cashAchievementRate: loaded.formalKpiMode === true ? row?.cashAchievementRate ?? row?.achievement ?? null : (budget > 0 ? Number(((cash / budget) * 100).toFixed(1)) : null),
                            hasReportData,
                            hasTargetData,
                        };
                    });
                    const totals = storeDetails.reduce((acc, row) => {
                        acc.cash += Number(row.cash || 0);
                        acc.accrual += Number(row.accrual || 0);
                        if (row.hasTargetData) acc.budget += Number(row.budget || 0);
                        if (row.hasReportData) acc.reportedStoreCount += 1;
                        if (row.hasTargetData) acc.targetedStoreCount += 1;
                        return acc;
                    }, { cash: 0, accrual: 0, budget: 0, reportedStoreCount: 0, targetedStoreCount: 0 });
                    managementScopes.push({
                        manager: managementManagerName,
                        brand: getTelegramAgentBrandLabel(brandId),
                        brandId,
                        scopeType: "official_plus_temporary_delegation",
                        officialStores: [...officialStoreSet],
                        delegatedStores,
                        accessibleStores,
                        storeDetails,
                        ...totals,
                        cashAchievementRate: totals.targetedStoreCount >= accessibleStores.length && totals.reportedStoreCount >= accessibleStores.length && totals.budget > 0 ? Number(((totals.cash / totals.budget) * 100).toFixed(1)) : null,
                        expectedProgress,
                        progressGap: totals.targetedStoreCount >= accessibleStores.length && totals.reportedStoreCount >= accessibleStores.length && totals.budget > 0 ? Number((((totals.cash / totals.budget) * 100) - expectedProgress).toFixed(1)) : null,
                        rankingEligible: false,
                        rankingNote: "代理管理範圍只供當期管理與責任追蹤，不併入正式組織排名。",
                    });
                }
            }
        }

        const brandExpectedStores = formalRows.reduce((sum, row) => sum + row.expectedStoreCount, 0);
        const brandReportedStores = formalRows.reduce((sum, row) => sum + row.reportedStoreCount, 0);
        const brandTargetedStores = formalRows.reduce((sum, row) => sum + row.targetedStoreCount, 0);
        brandQuality.push({
            brand: getTelegramAgentBrandLabel(brandId),
            brandId,
            totalManagerCount: formalRows.length,
            rankingEligibleManagerCount: eligibleRows.length,
            dataQuality: buildTelegramAgentDataQuality({
                expectedStoreCount: brandExpectedStores,
                reportedStoreCount: brandReportedStores,
                targetedStoreCount: brandTargetedStores,
                source: loaded.source,
                missingReportStores: formalRows.flatMap((row) => row.missingReportStores),
                missingTargetStores: formalRows.flatMap((row) => row.missingTargetStores),
            }),
            source: loaded.source,
            targetSource: targetResult.source,
            orgSourcePath: org.sourcePath,
        });
    }

    const filtered = managerQuery
        ? allRows.filter((row) => {
            const normalized = normalizeTelegramAgentManagerName(row.manager);
            return normalized === managerQuery || normalized.includes(managerQuery) || managerQuery.includes(normalized);
        })
        : allRows;

    return {
        yearMonth: ym,
        expectedProgress,
        managers: filtered,
        managementScopes,
        delegation_note: managementScopes.length
            ? "managementScopes 為正式轄區加上目前有效代理範圍；只供管理檢視，不參與正式區長排名。"
            : "目前查詢對象沒有有效代理店家；正式排名仍依 org_structure 計算。",
        brandDataQuality: brandQuality,
        ranking_scope: "只有正式組織架構、日報與現金目標皆完整的區長才參與同品牌排名。achievementRank／brandRank=現金業績達成率排名；cashRank=現金總業績排名；另提供進度差距、新客、締結率與保養品占比排名。",
        data_quality_rule: "rankingEligible=false 時禁止宣稱第幾名，必須先說明缺少哪些店家日報或目標。",
        metric_dictionary: getTelegramAgentMetricDictionary([
            "cash", "accrual", "skincare", "traffic", "newCustomers", "retainedOrders",
            "cashAchievementRate", "expectedProgress", "progressGap", "achievementRank", "cashRank",
            "closingRateRank", "newCustomerRank", "skincareRatioRank",
        ], { formalMode: true }),
    };
}

async function getOperationalAlerts(yearMonth, brandName = null, limit = 10, agentContext = null, alertOptions = null) {
    const ctx = agentContext;
    const ym = normalizeTelegramAgentYearMonth(yearMonth) || getTelegramAgentTaipeiNow().yearMonth;
    const brands = resolveTelegramAgentBrands(brandName, "");
    const expectedProgress = getTelegramAgentExpectedProgress(ym);
    const baseRules = normalizeTelegramActiveAlertRules(alertOptions || {});
    const alerts = [];
    const dataIssues = [];
    const brandSummaries = [];
    const enabledRuleLabelSet = new Set();
    const effectiveLimits = [];

    for (const brandId of brands) {
        const rules = applyTelegramAgentAlertPolicies(baseRules, brandId, ctx);
        const enabledRuleLabels = getTelegramActiveAlertEnabledRuleLabels(rules);
        enabledRuleLabels.forEach((label) => enabledRuleLabelSet.add(label));
        const effectiveLimit = getTelegramAgentAlertLimit(limit, brandId, ctx);
        effectiveLimits.push(effectiveLimit);

        // Batch 5C-2: Active Alert always consumes Formal KPI. Policy scope only controls inclusion/exclusion.
        const loaded = await loadTelegramAgentStoreMonth(brandId, ym, ctx, { formalKpiMode: true });
        if (loaded.preSystem === true) {
            brandSummaries.push({
                brand: getTelegramAgentBrandLabel(brandId),
                brandId,
                yearMonth: ym,
                dataStatus: "PRE_SYSTEM_SKIP",
                cash: null,
                budget: null,
                cashAchievementRate: null,
                expectedProgress,
                progressGap: null,
                operationalCriticalCount: 0,
                operationalWatchCount: 0,
                criticalCount: 0,
                watchCount: 0,
                dataIssueCount: 0,
                activeStoreCount: 0,
                formalStoreCount: 0,
                excludedStoreCount: 0,
                excludedStores: [],
                auditExcludedStores: [],
                policyExcludedStores: [],
                excludedFormalStores: [],
                unexpectedReportStoreCount: 0,
                unexpectedReportStores: [],
                rosterIssue: false,
                enabledRuleLabels,
                dataQuality: buildTelegramAgentDataQuality({ source: loaded.source }),
                source: loaded.source,
                targetSource: "pre_system_skip",
                formalKpiMode: true,
            });
            continue;
        }

        // 保留既有 Active Alert presentation scope：正式組織架構、audit_exclusions、active_alert policy。
        const org = await loadTelegramAgentOrgProfile(brandId, ctx);
        const exclusions = await loadTelegramAgentAuditExclusions(brandId, ctx);
        const policyExcludedStores = getTelegramPolicyExcludedStoreSet(ctx, brandId, ["active_alert"]);
        const rowByCore = {};
        loaded.rows.forEach((row) => {
            const core = normalizeSummaryCoreName(row.storeName);
            if (core) rowByCore[core] = row;
        });

        const formalStoreCores = [...new Set((org.stores || []).map(normalizeSummaryCoreName).filter(Boolean))];
        const formalStoreSet = new Set(formalStoreCores);
        const combinedExcludedSet = new Set([...exclusions.storeSet, ...policyExcludedStores]);
        const activeStoreCores = formalStoreCores.filter((storeCore) => !combinedExcludedSet.has(storeCore));
        const excludedFormalStores = formalStoreCores.filter((storeCore) => combinedExcludedSet.has(storeCore));
        const missingRowStoreCores = activeStoreCores.filter((storeCore) => !rowByCore[storeCore]);
        // Formal rows own their target authority. Only stores with no row need a scoped target lookup for data-quality reporting.
        const targetResult = missingRowStoreCores.length > 0
            ? await loadTelegramAgentTargetMap(brandId, ym, ctx, null, missingRowStoreCores)
            : { map: {}, source: "formal_row_authority", updatedAtText: loaded.updatedAtText || "" };
        const unexpectedReportStores = Object.keys(rowByCore).filter(
            (storeCore) => !formalStoreSet.has(storeCore) && !combinedExcludedSet.has(storeCore)
        );

        let brandCashSum = 0;
        let brandBudgetSum = 0;
        let reportedStoreCount = 0;
        let targetedStoreCount = 0;
        const missingReportStores = [];
        const missingTargetStores = [];
        const brandAlerts = [];
        const brandDataIssues = [];
        let operationalCriticalCount = 0;
        let operationalWatchCount = 0;

        activeStoreCores.forEach((storeCore) => {
            const row = rowByCore[storeCore] || null;
            const fallbackTarget = targetResult.map[storeCore] || {};
            const cashStatus = String(row?.cashStatus || "");
            const fallbackCashTargetConfigured = isConfiguredAutoBaseTargetValue(fallbackTarget.cashTarget);
            const cashTargetStatus = row
                ? String(row?.cashTargetStatus || "")
                : (fallbackCashTargetConfigured
                    ? (Number(fallbackTarget.cashTarget) === 0 ? "VALID_ZERO" : "VALID")
                    : "TARGET_NOT_SET");
            const cashAchievementStatus = String(row?.cashAchievementStatus || "");
            const hasReportData = Boolean(row && isValidNumericStatus(cashStatus));
            const hasTargetData = row
                ? isValidNumericStatus(cashTargetStatus)
                : fallbackCashTargetConfigured;
            const cash = hasReportData ? Number(row.cash) : null;
            const budget = row
                ? (hasTargetData ? Number(row.budget) : null)
                : (hasTargetData ? Number(fallbackTarget.cashTarget) : null);
            const achievement = row && isValidNumericStatus(cashAchievementStatus)
                ? Number(row?.cashAchievementRate ?? row?.achievement)
                : null;
            const progressGap = achievement === null ? null : Number((achievement - expectedProgress).toFixed(1));
            const newCount = Number(row?.newCount || 0);
            const newClosings = Number(row?.newClosings || 0);
            const closingRate = newCount > 0 ? Number(((newClosings / newCount) * 100).toFixed(1)) : null;
            const skincare = Number(row?.skincareGross ?? row?.skincare ?? 0);
            const skincareRatio = hasReportData && cash > 0 ? Number(((skincare / cash) * 100).toFixed(1)) : null;
            const traffic = Number(row?.traffic || 0);
            const operationalReasons = [];
            const dataReasons = [];
            let severity = "normal";

            const escalateSeverity = (nextSeverity) => {
                const weight = { normal: 0, watch: 1, critical: 2 };
                if ((weight[nextSeverity] || 0) > (weight[severity] || 0)) severity = nextSeverity;
            };
            const addOperationalReason = (rule, condition, reason) => {
                if (!rule?.enabled || !condition) return;
                operationalReasons.push(reason);
                escalateSeverity(rule.severity === "critical" ? "critical" : "watch");
            };

            if (hasReportData) {
                reportedStoreCount += 1;
                brandCashSum += Number(cash);
            } else {
                missingReportStores.push(storeCore);
            }
            if (hasTargetData) {
                targetedStoreCount += 1;
                brandBudgetSum += Number(budget);
            } else {
                missingTargetStores.push(storeCore);
            }

            if (rules.missingReport.enabled) {
                if (!row) dataReasons.push("本月尚無日報資料");
                else if (!hasReportData) dataReasons.push(`現金實績資料無效（${cashStatus || "DATA_INVALID"}）`);
            }
            if (!hasTargetData && rules.missingTarget.enabled) dataReasons.push("現金目標缺漏");

            if (rules.progressGap.enabled && hasReportData && hasTargetData && progressGap !== null) {
                if (progressGap <= -rules.progressGap.criticalThreshold) {
                    severity = "critical";
                    operationalReasons.push(`現金進度落後 ${Math.abs(progressGap).toFixed(1)} 個百分點`);
                } else if (progressGap <= -rules.progressGap.watchThreshold) {
                    escalateSeverity("watch");
                    operationalReasons.push(`現金進度落後 ${Math.abs(progressGap).toFixed(1)} 個百分點`);
                }
            }

            addOperationalReason(
                rules.cashAchievementRate,
                hasReportData && hasTargetData && achievement !== null && achievement < rules.cashAchievementRate.threshold,
                `現金達成率 ${achievement === null ? "無法計算" : `${achievement.toFixed(1)}%`}`
            );
            addOperationalReason(
                rules.closingRate,
                Boolean(row) && newCount >= rules.closingRate.minSample && closingRate !== null && closingRate < rules.closingRate.threshold,
                `新客締結率 ${closingRate === null ? "無法計算" : `${closingRate.toFixed(1)}%`}`
            );
            addOperationalReason(
                rules.skincareRatio,
                Boolean(row) && hasReportData && cash > 0 && skincareRatio !== null && skincareRatio < rules.skincareRatio.threshold,
                `保養品占比 ${skincareRatio === null ? "無法計算" : `${skincareRatio.toFixed(1)}%`}`
            );
            addOperationalReason(
                rules.newCustomers,
                Boolean(row) && newCount < rules.newCustomers.threshold,
                `本月新客 ${newCount} 人`
            );
            addOperationalReason(
                rules.traffic,
                Boolean(row) && traffic < rules.traffic.threshold,
                `本月來客 ${traffic} 人次`
            );

            const activeDelegation = org.actingDelegationByStore?.[storeCore] || null;
            const baseRow = {
                brand: getTelegramAgentBrandLabel(brandId),
                brandId,
                storeName: storeCore,
                manager: org.storeOwner[storeCore] || row?.manager || "未分配",
                actingManager: activeDelegation?.permissions?.receiveAlerts !== false ? (activeDelegation?.delegateName || "") : "",
                taskOwnerName: activeDelegation?.permissions?.manageTasks !== false ? (activeDelegation?.delegateName || "") : "",
                delegationId: activeDelegation?.id || "",
                cash,
                cashStatus: cashStatus || (row ? "DATA_INVALID" : "FIELD_MISSING"),
                budget,
                cashTargetStatus,
                cashAchievementStatus: cashAchievementStatus || (hasTargetData ? "DATA_INVALID" : "TARGET_NOT_SET"),
                cashAchievementRate: achievement,
                achievement,
                expectedProgress,
                progressGap,
                traffic,
                newCustomerCount: newCount,
                newClosingRate: closingRate,
                skincareRatio,
                hasReportData,
                hasTargetData,
                source: loaded.source,
                formalKpiMode: true,
            };

            if (severity !== "normal" && operationalReasons.length > 0) {
                if (severity === "critical") operationalCriticalCount += 1;
                else operationalWatchCount += 1;
                brandAlerts.push({ ...baseRow, severity, reasons: operationalReasons });
            }
            if (dataReasons.length > 0) {
                brandDataIssues.push({ ...baseRow, severity: "data", reasons: dataReasons });
            }
        });

        const severityWeight = { critical: 3, watch: 1, normal: 0 };
        brandAlerts.sort(
            (a, b) =>
                (severityWeight[b.severity] - severityWeight[a.severity]) ||
                ((a.progressGap ?? 999) - (b.progressGap ?? 999))
        );
        brandDataIssues.sort((a, b) => {
            const aMissingReport = a.hasReportData ? 0 : 1;
            const bMissingReport = b.hasReportData ? 0 : 1;
            return bMissingReport - aMissingReport || String(a.storeName).localeCompare(String(b.storeName), "zh-Hant");
        });

        alerts.push(...brandAlerts);
        dataIssues.push(...brandDataIssues);

        const todayText = getTelegramAgentTaipeiNow().todayStr;
        const delegationsExpiringSoon = (org.activeDelegations || [])
            .map((delegation) => ({
                delegationId: delegation.id,
                principalName: delegation.principalName,
                delegateName: delegation.delegateName,
                endDate: delegation.endDate,
                daysRemaining: getTelegramAgentDateDiffDays(todayText, delegation.endDate),
                storeNames: delegation.resolvedStores || [],
            }))
            .filter((item) => item.daysRemaining >= 0 && item.daysRemaining <= 3);

        const dataQuality = buildTelegramAgentDataQuality({
            expectedStoreCount: activeStoreCores.length,
            reportedStoreCount,
            targetedStoreCount,
            source: loaded.source,
            missingReportStores,
            missingTargetStores,
        });
        const reportComplete = activeStoreCores.length > 0 && reportedStoreCount >= activeStoreCores.length;
        const targetComplete = activeStoreCores.length > 0 && targetedStoreCount >= activeStoreCores.length;
        const brandCash = reportComplete ? brandCashSum : null;
        const brandBudget = targetComplete ? brandBudgetSum : null;
        const brandAchievement = reportComplete && targetComplete && brandBudget > 0
            ? Number(((brandCash / brandBudget) * 100).toFixed(1))
            : null;
        const brandAchievementStatus = !targetComplete
            ? "TARGET_INCOMPLETE"
            : !reportComplete
                ? "DATA_INCOMPLETE"
                : brandBudget === 0
                    ? "N_A"
                    : (brandAchievement === null ? "DATA_INCOMPLETE" : "VALID");
        brandSummaries.push({
            brand: getTelegramAgentBrandLabel(brandId),
            brandId,
            cash: brandCash,
            budget: brandBudget,
            cashAchievementRate: brandAchievement,
            cashAchievementStatus: brandAchievementStatus,
            expectedProgress,
            progressGap: brandAchievement === null ? null : Number((brandAchievement - expectedProgress).toFixed(1)),
            operationalCriticalCount,
            operationalWatchCount,
            criticalCount: operationalCriticalCount,
            watchCount: operationalWatchCount,
            dataIssueCount: brandDataIssues.length,
            activeStoreCount: activeStoreCores.length,
            formalStoreCount: formalStoreCores.length,
            excludedStoreCount: combinedExcludedSet.size,
            excludedStores: [...combinedExcludedSet],
            auditExcludedStores: exclusions.stores,
            policyExcludedStores: [...policyExcludedStores],
            excludedFormalStores,
            unexpectedReportStoreCount: unexpectedReportStores.length,
            unexpectedReportStores,
            rosterIssue: formalStoreCores.length === 0,
            enabledRuleLabels,
            dataQuality,
            source: loaded.source,
            targetSource: targetResult.source,
            formalKpiMode: true,
            orgSourcePath: org.sourcePath,
            delegationSourcePath: org.delegationSourcePath || "",
            activeDelegationCount: Array.isArray(org.activeDelegations) ? org.activeDelegations.length : 0,
            delegatedStoreCount: Object.keys(org.actingManagerByStore || {}).length,
            delegationExpiryReminderCount: delegationsExpiringSoon.length,
            delegationsExpiringSoon,
            auditExclusionsSourcePath: exclusions.sourcePath,
        });
    }

    const perBrandLimit = effectiveLimits.length ? Math.max(...effectiveLimits) : Math.min(20, Math.max(1, Number(limit) || 10));
    const enabledRuleLabels = [...enabledRuleLabelSet];
    const severityWeight = { critical: 3, watch: 1, normal: 0 };
    alerts.sort((a, b) => (severityWeight[b.severity] - severityWeight[a.severity]) || ((a.progressGap ?? 999) - (b.progressGap ?? 999)));
    return {
        yearMonth: ym,
        expectedProgress,
        brandSummaries,
        alerts: alerts.slice(0, perBrandLimit),
        dataIssues: dataIssues.slice(0, perBrandLimit),
        operationalAlertCount: alerts.length,
        dataIssueCount: dataIssues.length,
        alertCount: alerts.length + dataIssues.length,
        perBrandLimit,
        enabledRuleLabels,
        rule_note: enabledRuleLabels.length
            ? `本次依品牌設定啟用：${enabledRuleLabels.join("、")}。`
            : "本品牌目前未啟用任何預警判斷項目。",
        metric_dictionary: getTelegramAgentMetricDictionary(["cashAchievementRate", "expectedProgress", "progressGap"], { formalMode: true }),
        formal_kpi_mode: true,
        data_note: "Active Alert 使用 Formal KPI contract；active_alert / audit exclusion 僅控制預警納入範圍，不改變 KPI authority。",
    };
}
async function getDataHealth(yearMonth, brandName = null, agentContext = null) {
    const ctx = agentContext;
    const ym = normalizeTelegramAgentYearMonth(yearMonth) || getTelegramAgentTaipeiNow().yearMonth;
    const brands = resolveTelegramAgentBrands(brandName, "");
    const results = [];

    for (const brandId of brands) {
        // 依序載入以共享同一題快取，避免相同 org/target 被重複讀取。
        const loaded = await loadTelegramAgentStoreMonth(brandId, ym, ctx, { formalKpiMode: true });
        const org = await loadTelegramAgentOrgProfile(brandId, ctx);
        if (loaded.preSystem === true) {
            results.push({
                brand: getTelegramAgentBrandLabel(brandId),
                brandId,
                yearMonth: ym,
                status: "pre_system",
                dataStatus: "PRE_SYSTEM_SKIP",
                storeDataSource: loaded.source,
                targetDataSource: "pre_system_skip",
            });
            continue;
        }
        const summaryStatus = await loadTelegramAgentSummaryStatus(brandId, ym, ctx);
        const auditExclusions = await loadTelegramAgentAuditExclusions(brandId, ctx);
        const reported = new Set(loaded.rows.filter((row) => loaded.formalKpiMode !== true || ["VALID", "VALID_ZERO"].includes(String(row.cashStatus || ""))).map((row) => normalizeSummaryCoreName(row.storeName)).filter(Boolean));
        const formalStores = new Set(normalizeTelegramAgentStoreNamesFull(org.stores || []));
        const officialStores = [...formalStores].filter((store) => !auditExclusions.storeSet.has(store));
        const expected = new Set(filterTelegramAgentStoresByPolicies(officialStores, brandId, ctx, ["data_audit"]));
        const formalRowByCore = Object.fromEntries((loaded.rows || []).map((row) => [normalizeSummaryCoreName(row.storeName), row]).filter(([key]) => Boolean(key)));
        const useFormalRowTargetAuthority = loaded.source === "verified_formal_dashboard_summary";
        const targetResult = useFormalRowTargetAuthority
            ? { map: {}, source: "formal_row_authority" }
            : await loadTelegramAgentTargetMap(brandId, ym, ctx, null, [...expected]);
        const targeted = useFormalRowTargetAuthority
            ? new Set([...expected].filter((store) => isValidNumericStatus(String(formalRowByCore[store]?.cashTargetStatus || ""))))
            : new Set(Object.entries(targetResult.map || {}).filter(([, value]) => isConfiguredAutoBaseTargetValue(value?.cashTarget)).map(([key]) => key));
        const missingReportStores = [...expected].filter((store) => !reported.has(store));
        const missingTargetStores = [...expected].filter((store) => !targeted.has(store));
        const unexpectedReportStores = [...reported].filter((store) => !formalStores.has(store) && !auditExclusions.storeSet.has(store));
        const dataQuality = buildTelegramAgentDataQuality({
            expectedStoreCount: expected.size,
            reportedStoreCount: [...expected].filter((store) => reported.has(store)).length,
            targetedStoreCount: [...expected].filter((store) => targeted.has(store)).length,
            source: loaded.source,
            missingReportStores,
            missingTargetStores,
        });
        let status = "healthy";
        if (expected.size === 0 || dataQuality.reportCoverage < 80 || dataQuality.targetCoverage < 80) status = "critical";
        else if (!dataQuality.rankingEligible || unexpectedReportStores.length > 0) status = "watch";
        results.push({
            brand: getTelegramAgentBrandLabel(brandId),
            brandId,
            yearMonth: ym,
            status,
            expectedStoreCount: expected.size,
            reportedStoreCount: dataQuality.reportedStoreCount,
            targetedStoreCount: dataQuality.targetedStoreCount,
            missingReportStores,
            missingTargetStores,
            unexpectedReportStores,
            excludedFormalStoreCount: [...formalStores].filter((store) => !expected.has(store)).length,
            dataQuality,
            rankingAllowed: dataQuality.rankingEligible,
            storeDataSource: loaded.source,
            targetSource: targetResult.source,
            orgSourcePath: org.sourcePath,
            summaryStatus: {
                exists: summaryStatus.exists,
                verified: summaryStatus.verified,
                status: summaryStatus.status,
                dirty: summaryStatus.dirty,
                updatedAtText: summaryStatus.updatedAtText,
            },
        });
    }

    return {
        yearMonth: ym,
        brands: results,
        overallStatus: results.some((row) => row.status === "critical") ? "critical" : results.some((row) => row.status === "watch") ? "watch" : "healthy",
        rule_note: "區長與店家排名只有在正式店家、日報與現金目標皆完整時才允許產生。",
    };
}

async function getDailyBattleBrief(yearMonth, brandName = null, agentContext = null) {
    const ctx = agentContext;
    const ym = normalizeTelegramAgentYearMonth(yearMonth) || getTelegramAgentTaipeiNow().yearMonth;
    const alerts = await getOperationalAlerts(ym, brandName, 10, ctx);
    const health = await getDataHealth(ym, brandName, ctx);
    return {
        yearMonth: ym,
        expectedProgress: alerts.expectedProgress,
        brandSummaries: alerts.brandSummaries,
        topAlerts: alerts.alerts,
        alertCount: alerts.alertCount,
        dataHealth: health.brands.map((row) => ({
            brand: row.brand,
            status: row.status,
            reportCoverage: row.dataQuality.reportCoverage,
            targetCoverage: row.dataQuality.targetCoverage,
            rankingAllowed: row.rankingAllowed,
            missingReportStores: row.missingReportStores,
            missingTargetStores: row.missingTargetStores,
        })),
        instruction: "先摘要全品牌進度，再列出最嚴重異常，最後提出三項跨品牌優先行動。資料不完整的品牌不得做排名。",
        metric_dictionary: getTelegramAgentMetricDictionary(["cashAchievementRate", "expectedProgress", "progressGap"]),
    };
}

const aiTools = {
    functionDeclarations: [
        {
            name: "getStorePerformance",
            description: "查詢品牌或店家在指定日期區間的現金、權責、來客、新客、客單、締結率、目標與月底預估。整月查詢會自動使用 Summary-first。",
            parameters: {
                type: "OBJECT",
                properties: {
                    startDate: { type: "STRING", description: "YYYY-MM-DD" },
                    endDate: { type: "STRING", description: "YYYY-MM-DD" },
                    storeName: { type: "STRING" },
                    brandName: { type: "STRING", description: "CYJ／DRCYJ、安妞或伊啵" },
                },
            },
        },
        {
            name: "getTherapistPerformance",
            description: "查詢管理師個人、門市或品牌的人員業績、排行、新舊客、客單與締結率。當使用者說『這三家店／那些店』時必須沿用上一題品牌與店家清單，不可擴張到其他品牌。",
            parameters: {
                type: "OBJECT",
                properties: {
                    startDate: { type: "STRING", description: "YYYY-MM-DD" },
                    endDate: { type: "STRING", description: "YYYY-MM-DD" },
                    personName: { type: "STRING" },
                    storeName: { type: "STRING" },
                    storeNames: { type: "ARRAY", items: { type: "STRING" }, description: "追問前一題多家店時使用" },
                    brandName: { type: "STRING" },
                },
            },
        },
        {
            name: "getMissingReports",
            description: "查詢指定日期未交店家日報名單；正式店家名冊取自 org_structure，不再用過去日報反推。",
            parameters: {
                type: "OBJECT",
                properties: {
                    startDate: { type: "STRING", description: "YYYY-MM-DD" },
                    endDate: { type: "STRING", description: "YYYY-MM-DD" },
                    brandName: { type: "STRING" },
                },
            },
        },
        {
            name: "getMacroStrategicAnalysis",
            description: "查詢跨月、跨季或年度內最多 12 個月的品牌／店家趨勢、目標達成與營運體質。",
            parameters: {
                type: "OBJECT",
                properties: {
                    startMonth: { type: "STRING", description: "YYYY-MM" },
                    endMonth: { type: "STRING", description: "YYYY-MM" },
                    storeName: { type: "STRING" },
                    brandName: { type: "STRING" },
                },
                required: ["startMonth", "endMonth"],
            },
        },
        {
            name: "getManagerPerformance",
            description: "查詢區長／主管所轄店家與區域卡片同口徑數據，並提供現金達成率、現金金額、進度差距、新客、締結率與保養品占比等多維排名。只有正式店家日報與現金目標完整時 rankingEligible 才為 true；資料不完整時禁止宣稱名次。",
            parameters: {
                type: "OBJECT",
                properties: {
                    yearMonth: { type: "STRING", description: "YYYY-MM，未填則本月" },
                    managerName: { type: "STRING" },
                    brandName: { type: "STRING" },
                },
            },
        },
        {
            name: "getDataHealth",
            description: "檢查指定月份的正式組織架構、店家日報、現金目標與 Summary 狀態是否完整，並判斷是否允許產生排名。使用者詢問資料正確性、數據缺漏、為何不能排名或輸入 /datahealth 時使用。",
            parameters: {
                type: "OBJECT",
                properties: {
                    yearMonth: { type: "STRING", description: "YYYY-MM，未填則本月" },
                    brandName: { type: "STRING" },
                },
            },
        },
        {
            name: "getDailyBattleBrief",
            description: "取得本月截至今日的全品牌或指定品牌戰情摘要，包含品牌現金進度、最嚴重異常與資料完整度。輸入 /today 或詢問今日戰情摘要時優先使用。",
            parameters: {
                type: "OBJECT",
                properties: {
                    yearMonth: { type: "STRING", description: "YYYY-MM，未填則本月" },
                    brandName: { type: "STRING" },
                },
            },
        },
        {
            name: "getOperationalAlerts",
            description: "找出指定月份最需要關注的店家。使用者問『哪三家／幾家需要關注』時優先使用本工具，並將結果作為下一題『這三家店』的固定店家範圍。",
            parameters: {
                type: "OBJECT",
                properties: {
                    yearMonth: { type: "STRING", description: "YYYY-MM，未填則本月" },
                    brandName: { type: "STRING" },
                    limit: { type: "NUMBER" },
                },
            },
        },
    ],
};

function normalizeTelegramInteractionSchema(value) {
    if (Array.isArray(value)) return value.map(normalizeTelegramInteractionSchema);
    if (!value || typeof value !== "object") return value;
    return Object.entries(value).reduce((acc, [key, item]) => {
        if (key === "type" && typeof item === "string") {
            acc[key] = item.toLowerCase();
        } else {
            acc[key] = normalizeTelegramInteractionSchema(item);
        }
        return acc;
    }, {});
}

const TELEGRAM_AGENT_INTERACTION_TOOLS = Object.freeze(
    aiTools.functionDeclarations.map((declaration) => ({
        type: "function",
        name: declaration.name,
        description: declaration.description,
        parameters: normalizeTelegramInteractionSchema(declaration.parameters || {
            type: "object",
            properties: {},
        }),
    }))
);

function getTelegramAgentSafeDateRange(args, todayStr, currentYearMonth) {
    let startDate = normalizeTelegramAgentDate(args?.startDate) || `${currentYearMonth}-01`;
    let endDate = normalizeTelegramAgentDate(args?.endDate) || todayStr;
    if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
    const diffDays = getTelegramAgentDateDiffDays(startDate, endDate);
    let warning = "";
    if (diffDays > TELEGRAM_AGENT_MAX_DAILY_RANGE_DAYS) {
        const end = new Date(`${endDate}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() - TELEGRAM_AGENT_MAX_DAILY_RANGE_DAYS);
        startDate = end.toISOString().slice(0, 10);
        warning = `查詢區間超過 ${TELEGRAM_AGENT_MAX_DAILY_RANGE_DAYS} 天，已自動縮短為 ${startDate}～${endDate}。`;
    }
    return { startDate, endDate, warning };
}


function getTelegramAgentEvidenceNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function getTelegramAgentCrossSourceScopeKey(name, args = {}, result = {}) {
    const brand = String(args?.brandName || "").trim().toLowerCase();
    const store = normalizeSummaryCoreName(args?.storeName || "");
    const range = String(result?.query_range || "").trim();
    const person = name === "getTherapistPerformance"
        ? normalizeSummaryPersonName(args?.personName || "").trim().toLowerCase()
        : "";

    return {
        key: `${brand || "all"}|${store || "all"}|${range || "unknown"}`,
        brand,
        store,
        range,
        person,
    };
}

function buildTelegramAgentToolEvidence(name, args = {}, result = {}) {
    const scope = getTelegramAgentCrossSourceScopeKey(name, args, result);

    if (name === "getStorePerformance") {
        const overall = result?.overall_summary || {};
        return {
            tool: name,
            sourceAuthority: "store_kpi",
            sourceCollection: "daily_reports",
            brandName: String(args?.brandName || ""),
            storeName: String(args?.storeName || ""),
            queryRange: scope.range,
            scopeKey: scope.key,
            overall: {
                newCount: getTelegramAgentEvidenceNumber(overall?.newCount),
                newClosings: getTelegramAgentEvidenceNumber(overall?.newClosings),
                newClosingRate: getTelegramAgentEvidenceNumber(overall?.newClosingRate),
                cash: getTelegramAgentEvidenceNumber(overall?.cash),
                traffic: getTelegramAgentEvidenceNumber(overall?.traffic),
            },
        };
    }

    if (name === "getTherapistPerformance") {
        const overall = result?.overall_summary || {};
        const therapists = (Array.isArray(result?.therapists_details) ? result.therapists_details : [])
            .slice(0, 12)
            .map((row) => {
                const newCount = getTelegramAgentEvidenceNumber(row?.newCount);
                const newClosings = getTelegramAgentEvidenceNumber(row?.newClosings);
                const newClosingRate = Number.isFinite(Number(row?.newClosingRate))
                    ? Number(row.newClosingRate)
                    : (newCount > 0 ? Number(((newClosings / newCount) * 100).toFixed(1)) : 0);

                return {
                    personName: String(row?.personName || ""),
                    storeName: String(row?.storeName || ""),
                    revenue: getTelegramAgentEvidenceNumber(row?.revenue),
                    newCount,
                    newClosings,
                    newClosingRate,
                };
            });

        return {
            tool: name,
            sourceAuthority: "therapist_kpi",
            sourceCollection: "therapist_daily_reports",
            brandName: String(args?.brandName || ""),
            storeName: String(args?.storeName || ""),
            personName: String(args?.personName || ""),
            queryRange: scope.range,
            scopeKey: scope.key,
            isPersonFiltered: Boolean(scope.person),
            overall: {
                newCount: getTelegramAgentEvidenceNumber(overall?.newCount),
                newClosings: getTelegramAgentEvidenceNumber(overall?.newClosings),
                newClosingRate: getTelegramAgentEvidenceNumber(overall?.newClosingRate),
                revenue: getTelegramAgentEvidenceNumber(overall?.revenue),
            },
            therapists,
        };
    }

    return null;
}

function updateTelegramAgentCrossSourceDataAwareness(ctx, evidence) {
    if (!ctx || !evidence) return null;
    if (!Array.isArray(ctx.toolEvidence)) ctx.toolEvidence = [];
    if (!Array.isArray(ctx.crossSourceDataAwareness)) ctx.crossSourceDataAwareness = [];
    if (!ctx.crossSourceEvidenceByScope || typeof ctx.crossSourceEvidenceByScope !== "object") {
        ctx.crossSourceEvidenceByScope = {};
    }

    ctx.toolEvidence.push(evidence);

    // 個人篩選的人員工具不能拿來與全店日報總量直接比較。
    if (evidence.tool === "getTherapistPerformance" && evidence.isPersonFiltered) {
        return null;
    }

    const scopeKey = String(evidence.scopeKey || "");
    if (!scopeKey) return null;

    const slot = ctx.crossSourceEvidenceByScope[scopeKey] || {};
    if (evidence.tool === "getStorePerformance") slot.store = evidence;
    if (evidence.tool === "getTherapistPerformance") slot.therapist = evidence;
    ctx.crossSourceEvidenceByScope[scopeKey] = slot;

    if (!slot.store || !slot.therapist) return null;

    const storeNewCount = getTelegramAgentEvidenceNumber(slot.store?.overall?.newCount);
    const storeNewClosings = getTelegramAgentEvidenceNumber(slot.store?.overall?.newClosings);
    const therapistNewCount = getTelegramAgentEvidenceNumber(slot.therapist?.overall?.newCount);
    const therapistNewClosings = getTelegramAgentEvidenceNumber(slot.therapist?.overall?.newClosings);

    const newCountDiff = therapistNewCount - storeNewCount;
    const newClosingsDiff = therapistNewClosings - storeNewClosings;
    const aligned = newCountDiff === 0 && newClosingsDiff === 0;

    const awareness = {
        scopeKey,
        brandName: slot.store?.brandName || slot.therapist?.brandName || "",
        storeName: slot.store?.storeName || slot.therapist?.storeName || "",
        queryRange: slot.store?.queryRange || slot.therapist?.queryRange || "",
        status: aligned ? "aligned" : "difference_detected",
        differenceIsError: false,
        possibleReasons: aligned ? [] : [
            "店家與人員 KEY IN 時間差",
            "其中一方缺報",
            "其中一方資料輸入錯誤或後續修正未同步",
            "店家日報與人員日報統計口徑差異",
        ],
        store: {
            source: "daily_reports",
            newCount: storeNewCount,
            newClosings: storeNewClosings,
            newClosingRate: getTelegramAgentEvidenceNumber(slot.store?.overall?.newClosingRate),
        },
        therapists: {
            source: "therapist_daily_reports",
            newCount: therapistNewCount,
            newClosings: therapistNewClosings,
            newClosingRate: getTelegramAgentEvidenceNumber(slot.therapist?.overall?.newClosingRate),
        },
        difference: {
            newCount: newCountDiff,
            newClosings: newClosingsDiff,
        },
        sourcePolicy: {
            storeKpiSource: "daily_reports",
            therapistKpiSource: "therapist_daily_reports",
            crossSourceInferenceAllowed: false,
            storeMetricsMustNotBeUsedAsTherapistDenominator: true,
            therapistMetricsMustNotBeUsedAsStoreDenominator: true,
        },
    };

    const index = ctx.crossSourceDataAwareness.findIndex((item) => item?.scopeKey === scopeKey);
    if (index >= 0) ctx.crossSourceDataAwareness[index] = awareness;
    else ctx.crossSourceDataAwareness.push(awareness);

    return awareness;
}

function attachTelegramAgentSourceAuthority(name, result, awareness = null) {
    if (!result || typeof result !== "object") return result;

    if (name === "getStorePerformance") {
        return {
            ...result,
            source_authority: {
                scope: "store_kpi",
                source: "daily_reports",
                rule: "全店 KPI 以本工具結果為準；不得拿人員日報數字反推或覆寫全店 KPI。",
            },
            ...(awareness ? { cross_source_data_awareness: awareness } : {}),
        };
    }

    if (name === "getTherapistPerformance") {
        return {
            ...result,
            source_authority: {
                scope: "therapist_kpi",
                source: "therapist_daily_reports",
                rule: "個人 KPI 以本工具結果為準；不得拿店家日報的新客數／締結數作為個人 KPI 的分母或分子。",
                numerator_denominator_rule: "只有本工具同一位人員明確提供的 newCount / newClosings 才可換算或描述個人締結人數。",
            },
            ...(awareness ? { cross_source_data_awareness: awareness } : {}),
        };
    }

    return result;
}

function recordTelegramAgentCrossSourceEvidence(name, args, result, ctx) {
    if (!["getStorePerformance", "getTherapistPerformance"].includes(name)) {
        return result;
    }

    const evidence = buildTelegramAgentToolEvidence(name, args, result);
    const awareness = updateTelegramAgentCrossSourceDataAwareness(ctx, evidence);

    // 即使另一來源尚未讀取，也先把來源權責規則送給 Gemini。
    return attachTelegramAgentSourceAuthority(name, result, awareness);
}


async function executeTelegramAgentTool(name, args, ctx, dateInfo) {
    const startedAt = Date.now();
    const effectiveArgs = resolveTelegramAgentToolArgs(name, args || {}, ctx, dateInfo);
    let result;
    let warning = "";
    if (["getStorePerformance", "getTherapistPerformance", "getMissingReports"].includes(name)) {
        const safeRange = getTelegramAgentSafeDateRange(effectiveArgs, dateInfo.todayStr, dateInfo.yearMonth);
        warning = safeRange.warning;
        if (name === "getStorePerformance") {
            result = await getStorePerformance(safeRange.startDate, safeRange.endDate, effectiveArgs?.storeName, effectiveArgs?.brandName, ctx);
        } else if (name === "getTherapistPerformance") {
            result = await getTherapistPerformance(
                safeRange.startDate,
                safeRange.endDate,
                effectiveArgs?.personName,
                effectiveArgs?.storeName,
                effectiveArgs?.brandName,
                ctx,
                effectiveArgs?.storeNames || []
            );
        } else {
            result = await getMissingReports(safeRange.startDate, safeRange.endDate, effectiveArgs?.brandName, ctx);
        }
    } else if (name === "getMacroStrategicAnalysis") {
        const startMonth = normalizeTelegramAgentYearMonth(effectiveArgs?.startMonth) || dateInfo.yearMonth;
        const endMonth = normalizeTelegramAgentYearMonth(effectiveArgs?.endMonth) || dateInfo.yearMonth;
        const months = enumerateTelegramAgentMonths(startMonth, endMonth);
        if (months.length > TELEGRAM_AGENT_MAX_MACRO_MONTHS) throw new Error(`跨月查詢最多 ${TELEGRAM_AGENT_MAX_MACRO_MONTHS} 個月`);
        result = await getMacroStrategicAnalysis(startMonth, endMonth, effectiveArgs?.storeName, effectiveArgs?.brandName, ctx);
    } else if (name === "getManagerPerformance") {
        result = await getManagerPerformance(effectiveArgs?.yearMonth || dateInfo.yearMonth, effectiveArgs?.managerName, effectiveArgs?.brandName, ctx);
    } else if (name === "getOperationalAlerts") {
        result = await getOperationalAlerts(effectiveArgs?.yearMonth || dateInfo.yearMonth, effectiveArgs?.brandName, effectiveArgs?.limit, ctx);
    } else if (name === "getDataHealth") {
        result = await getDataHealth(effectiveArgs?.yearMonth || dateInfo.yearMonth, effectiveArgs?.brandName, ctx);
    } else if (name === "getDailyBattleBrief") {
        result = await getDailyBattleBrief(effectiveArgs?.yearMonth || dateInfo.yearMonth, effectiveArgs?.brandName, ctx);
    } else {
        throw new Error(`不支援的工具：${name}`);
    }

    result = recordTelegramAgentCrossSourceEvidence(name, effectiveArgs, result, ctx);
    updateTelegramAgentScopeFromToolResult(name, effectiveArgs, result, ctx);
    const toolRecord = {
        name,
        args: effectiveArgs,
        requestedArgs: args || {},
        durationMs: Date.now() - startedAt,
        readCountAfter: ctx.readCount,
        ok: true,
    };
    ctx.toolCalls.push(toolRecord);
    if (warning) ctx.warnings.push(warning);
    return { result, effectiveArgs };
}

function getTelegramAgentSessionRef(chatId, userId) {
    const id = `${String(chatId || "chat")}_${String(userId || "user")}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    return db.collection("telegram_agent_sessions").doc(id);
}

async function loadTelegramAgentMemory(chatId, userId, ctx) {
    try {
        const result = await readTelegramAgentDoc(
            getTelegramAgentSessionRef(chatId, userId),
            ctx,
            "telegram_agent_memory",
            {},
            0
        );
        if (!result.exists || !TELEGRAM_AGENT_COMPATIBLE_VERSIONS.has(String(result.data?.version || ""))) {
            return {
                turns: [],
                state: sanitizeTelegramAgentScopeState({}),
                pendingPolicyAction: null,
                pendingPolicyExpiresAtMs: 0,
                oneShotPolicies: [],
                oneShotExpiresAtText: "",
                oneShotExpiresAtMs: 0,
                learningCandidates: {},
                lastLearningSuggestion: null,
                lastPolicyChange: null,
                pendingV5Action: null,
                pendingV5ExpiresAtMs: 0,
            };
        }
        const turns = Array.isArray(result.data?.turns) ? result.data.turns : [];
        return {
            turns: turns.slice(-TELEGRAM_AGENT_MEMORY_TURNS),
            state: sanitizeTelegramAgentScopeState(result.data?.state || {}),
            pendingPolicyAction: result.data?.pendingPolicyAction || null,
            pendingPolicyExpiresAtMs: Number(result.data?.pendingPolicyExpiresAtMs || 0),
            oneShotPolicies: Array.isArray(result.data?.oneShotPolicies) ? result.data.oneShotPolicies : [],
            oneShotExpiresAtText: String(result.data?.oneShotExpiresAtText || ""),
            oneShotExpiresAtMs: Number(result.data?.oneShotExpiresAtMs || 0),
            learningCandidates: result.data?.learningCandidates && typeof result.data.learningCandidates === "object" ? result.data.learningCandidates : {},
            lastLearningSuggestion: result.data?.lastLearningSuggestion || null,
            lastPolicyChange: result.data?.lastPolicyChange || null,
            pendingV5Action: result.data?.pendingV5Action || null,
            pendingV5ExpiresAtMs: Number(result.data?.pendingV5ExpiresAtMs || 0),
        };
    } catch (error) {
        console.warn("Telegram Agent 記憶讀取失敗:", error.message);
        return {
            turns: [],
            state: sanitizeTelegramAgentScopeState({}),
            pendingPolicyAction: null,
            pendingPolicyExpiresAtMs: 0,
            oneShotPolicies: [],
            oneShotExpiresAtText: "",
            oneShotExpiresAtMs: 0,
            learningCandidates: {},
            lastLearningSuggestion: null,
            lastPolicyChange: null,
        };
    }
}

async function resetTelegramAgentMemory(chatId, userId) {
    await getTelegramAgentSessionRef(chatId, userId).delete();
}

function formatTelegramAgentMemory(turns = []) {
    if (!turns.length) return "（無前文）";
    return turns.map((turn, index) => {
        const userText = String(turn.user || "").slice(0, 500);
        const assistantText = String(turn.assistant || "").slice(0, 700);
        return `${index + 1}. 使用者：${userText}\n   戰情秘書：${assistantText}`;
    }).join("\n");
}

async function saveTelegramAgentMemory(chatId, userId, turns, question, answer, ctx) {
    const nextTurns = [
        ...(Array.isArray(turns) ? turns : []),
        {
            user: String(question || "").slice(0, 800),
            assistant: String(answer || "").slice(0, 1200),
            atText: new Date().toISOString(),
        },
    ].slice(-TELEGRAM_AGENT_MEMORY_TURNS);
    await getTelegramAgentSessionRef(chatId, userId).set({
        chatId: String(chatId),
        userId: String(userId),
        turns: nextTurns,
        state: sanitizeTelegramAgentScopeState(ctx?.scopeState || {}),
        learningCandidates: ctx?.learningCandidates || {},
        lastLearningSuggestion: ctx?.memorySuggestion || admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString(),
        version: TELEGRAM_AGENT_VERSION,
    }, { merge: true });
    if (ctx) ctx.writeCount += 1;
}

function buildTelegramAgentSourceFooter(ctx) {
    const sources = Array.isArray(ctx?.sources) ? ctx.sources : [];
    const brandIds = [...new Set(sources.map((item) => String(item?.brandId || "")).filter(Boolean))];
    const brandText = brandIds.length > 0
        ? brandIds.slice(0, 3).map((id) => getTelegramAgentBrandLabel(id)).join("／")
        : "";

    const sourceNames = new Set(sources.map((item) => String(item?.source || "")));
    const hasLive = [
        "daily_reports_scoped",
        "daily_reports_current_month_exact",
        "therapist_daily_reports_scoped",
        "therapist_daily_reports_current_month_exact",
        "monthly_aggregated",
        "therapist_monthly_aggregated",
    ].some((name) => sourceNames.has(name));

    const hasHistoricalSummary = [
        "verified_dashboard_summary",
        "dashboard_summary",
        "verified_therapist_summary",
        "therapist_summary",
    ].some((name) => sourceNames.has(name));

    const hasStructureOrTarget = [
        "monthly_targets_summary",
        "monthly_targets_targeted_fallback",
        "org_structure",
        "management_delegations",
    ].some((name) => sourceNames.has(name));

    const basisParts = [];
    if (hasLive) basisParts.push("即時營運資料");
    else if (hasHistoricalSummary) basisParts.push("已驗證月結資料");
    if (hasStructureOrTarget) basisParts.push("正式目標／組織");
    if (!basisParts.length) basisParts.push(sources.length ? "系統資料" : "一般管理知識");

    const uniqueWarnings = [...new Set(
        (ctx?.warnings || []).map((item) => String(item || "").trim()).filter(Boolean)
    )];
    const warningText = uniqueWarnings.length > 0
        ? `\n⚠️ 資料提醒：${uniqueWarnings.slice(0, 2).join("；")}`
        : "";

    const suggestionText = ctx?.memorySuggestion
        ? `\n💡 可回覆「記住這個偏好」保存：${String(ctx.memorySuggestion.instruction || "").slice(0, 80)}`
        : "";

    return `\n\n────────\n資料：${brandText ? `${brandText}｜` : ""}${basisParts.join("＋")}${warningText}${suggestionText}`;
}

async function writeTelegramAgentAuditLog(message, ctx, finalReply, status = "success", errorMessage = "") {
    try {
        await db.collection("telegram_agent_logs").add({
            version: TELEGRAM_AGENT_VERSION,
            replyFormat: "telegram-mobile-v7.1-cross-source-final-cleanup",
            replyMode: getTelegramAgentReplyMode(ctx),
            replyGuardVersion: "deterministic-hard-guard-v1",
            replyLanguagePolishVersion: "beauty-language-quality-v2.2-final-polish",
            crossSourceAwarenessVersion: "cross-source-data-awareness-v1.1-final-cleanup",
            replyGuardActionCount: Array.isArray(ctx?.replyGuardActions) ? ctx.replyGuardActions.length : 0,
            replyGuardActions: Array.isArray(ctx?.replyGuardActions) ? ctx.replyGuardActions.slice(0, 12) : [],
            geminiApi: ctx?.geminiApi || getGeminiInteractionsApiLabel(ctx?.modelName || TELEGRAM_AGENT_PRIMARY_MODEL),
            modelName: ctx?.modelName || TELEGRAM_AGENT_PRIMARY_MODEL,
            primaryModel: TELEGRAM_AGENT_PRIMARY_MODEL,
            fallbackModel: TELEGRAM_AGENT_FALLBACK_MODEL,
            fallbackUsed: Boolean(ctx?.fallbackUsed),
            status,
            chatId: String(message?.chat?.id || ""),
            chatTitle: String(message?.chat?.title || ""),
            userId: String(message?.from?.id || ""),
            userName: [message?.from?.first_name, message?.from?.last_name].filter(Boolean).join(" "),
            username: String(message?.from?.username || ""),
            question: String(message?.text || "").slice(0, 1200),
            answerPreview: String(finalReply || "").slice(0, 1500),
            toolCalls: ctx?.toolCalls || [],
            toolEvidence: Array.isArray(ctx?.toolEvidence) ? ctx.toolEvidence.slice(0, 12) : [],
            crossSourceDataAwareness: Array.isArray(ctx?.crossSourceDataAwareness)
                ? ctx.crossSourceDataAwareness.slice(0, 6)
                : [],
            sources: ctx?.sources || [],
            warnings: [...new Set((ctx?.warnings || []).map((item) => String(item || "").trim()).filter(Boolean))],
            activePolicyIds: [...new Set(ctx?.activePolicyIds || [])],
            policyConflicts: ctx?.policyConflicts || [],
            policyPermission: ctx?.policyPermission || null,
            readCount: Number(ctx?.readCount || 0),
            writeCount: Number(ctx?.writeCount || 0),
            usage: ctx?.usage || {},
            modelUsageSteps: Array.isArray(ctx?.modelUsageSteps) ? ctx.modelUsageSteps.slice(0, 10) : [],
            durationMs: Date.now() - Number(ctx?.startedAtMs || Date.now()),
            errorMessage: String(errorMessage || "").slice(0, 1000),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAtText: new Date().toISOString(),
        });
        if (ctx) ctx.writeCount += 1;
    } catch (error) {
        console.warn("Telegram Agent 稽核紀錄寫入失敗:", error.message);
    }
}

function cleanTelegramAgentReply(text) {
    let reply = String(text || "").replace(/[*#`_\[\]]/g, "").trim();
    if (!reply) reply = "🤖 戰情秘書目前無法完成這個分析，請將問題縮小到品牌、店家或月份後再試一次。";
    if (reply.length > 3500) reply = `${reply.slice(0, 3500)}\n\n...（內容已依 Telegram 長度限制截短）`;
    return reply;
}


function parseTelegramMarkdownTableRow(line = "") {
    const trimmed = String(line || "").trim();
    if (!trimmed.startsWith("|")) return [];
    return trimmed
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
}

function isTelegramMarkdownTableSeparator(cells = []) {
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(String(cell || "").trim()));
}

function convertTelegramMarkdownTablesToCards(text = "") {
    const lines = String(text || "").split("\n");
    const output = [];

    for (let i = 0; i < lines.length; i += 1) {
        const current = String(lines[i] || "");
        if (!current.trim().startsWith("|")) {
            output.push(current);
            continue;
        }

        const block = [];
        while (i < lines.length && String(lines[i] || "").trim().startsWith("|")) {
            block.push(lines[i]);
            i += 1;
        }
        i -= 1;

        const parsed = block
            .map(parseTelegramMarkdownTableRow)
            .filter((cells) => cells.length >= 2);

        if (parsed.length < 2) {
            output.push(...block.map((line) => String(line || "").replace(/\|/g, "｜")));
            continue;
        }

        const separatorIndex = parsed.findIndex(isTelegramMarkdownTableSeparator);
        const headerIndex = separatorIndex > 0 ? separatorIndex - 1 : 0;
        const headers = parsed[headerIndex];
        const rows = parsed.filter((cells, index) =>
            index !== headerIndex && !isTelegramMarkdownTableSeparator(cells)
        );

        if (!rows.length) continue;

        rows.forEach((cells) => {
            const title = cells[0] || headers[0] || "項目";
            output.push(`• ${title}`);
            for (let col = 1; col < cells.length; col += 1) {
                if (!cells[col]) continue;
                const label = headers[col] || `欄位 ${col}`;
                output.push(`  ${label}：${cells[col]}`);
            }
        });
    }

    return output.join("\n");
}


function isTelegramAgentTargetSettingRequest(ctx = null) {
    return /(?:幫我|請|替我)?(?:制定|設定|設計|訂定|規劃|建議).{0,12}(?:目標|KPI|門檻|標準|指標)|(?:目標|KPI|門檻|標準).{0,12}(?:訂多少|設多少|建議多少)/i
        .test(String(ctx?.question || ""));
}

function getTelegramAgentTargetEvidenceText(ctx = null) {
    const policyText = (ctx?.policies || []).map((policy) => [
        policy?.instruction || "",
        policy?.sourceText || "",
        JSON.stringify(policy?.value || {}),
    ].join(" ")).join("\n");

    return `${String(ctx?.question || "")}\n${policyText}`;
}

function normalizeTelegramAgentEvidenceToken(value = "") {
    return String(value || "")
        .replace(/[,\s，]/g, "")
        .replace(/NT\$/gi, "$")
        .toLowerCase();
}

function hasTelegramAgentAuthorizedNumericEvidence(ctx, matchedText = "") {
    if (isTelegramAgentTargetSettingRequest(ctx)) return true;

    const evidence = normalizeTelegramAgentEvidenceToken(getTelegramAgentTargetEvidenceText(ctx));
    const numericTokens = String(matchedText || "").match(
        /(?:NT\$|\$)?\s*\d[\d,]*(?:\.\d+)?\s*(?:%|元|萬|千|天|日|次|分鐘|小時|堂)?/gi
    ) || [];

    return numericTokens.some((token) => {
        const normalized = normalizeTelegramAgentEvidenceToken(token);
        return normalized.length >= 2 && evidence.includes(normalized);
    });
}

function recordTelegramAgentReplyGuardAction(ctx, action, beforeText = "", afterText = "") {
    if (!ctx) return;
    if (!Array.isArray(ctx.replyGuardActions)) ctx.replyGuardActions = [];

    const key = `${action}:${String(beforeText || "").slice(0, 80)}:${String(afterText || "").slice(0, 80)}`;
    if (ctx.replyGuardActions.some((item) => item.key === key)) return;

    ctx.replyGuardActions.push({
        key,
        action: String(action || "rewrite"),
        before: String(beforeText || "").slice(0, 160),
        after: String(afterText || "").slice(0, 160),
    });
}

function replaceTelegramAgentGuardedPattern(reply, regex, replacement, ctx, action, options = {}) {
    return String(reply || "").replace(regex, (...args) => {
        const fullMatch = args[0];
        if (options.numericTarget === true && hasTelegramAgentAuthorizedNumericEvidence(ctx, fullMatch)) {
            return fullMatch;
        }

        const next = typeof replacement === "function"
            ? replacement(...args)
            : String(replacement);

        if (next !== fullMatch) {
            recordTelegramAgentReplyGuardAction(ctx, action, fullMatch, next);
        }
        return next;
    });
}

function applyTelegramAgentDeterministicReplyGuard(text, ctx = null) {
    let reply = String(text || "");

    // ----------------------------------------------------------
    // A. KPI hard guard：
    // Prompt 已要求 Gemini 不可把「目前數值」自行變成未來 KPI。
    // 這裡再做 deterministic 防線，避免「30.8% 現況 → 維持 30%以上」漏出。
    // 若使用者正在要求制定 KPI，或正式 Policy/使用者文字已有該數字，則保留。
    // ----------------------------------------------------------
    reply = replaceTelegramAgentGuardedPattern(
        reply,
        /維持[^。\n]{0,32}?\d+(?:\.\d+)?\s*%\s*以上(?:的)?(?:新客)?締結率/g,
        "延續近期已改善的新客諮詢與締結動能",
        ctx,
        "remove_unsupported_conversion_target",
        { numericTarget: true }
    );

    reply = replaceTelegramAgentGuardedPattern(
        reply,
        /(?:新客)?締結率(?:需|要|應|必須|務必)?(?:維持|穩定)?(?:在)?\s*\d+(?:\.\d+)?\s*%\s*以上/g,
        "新客締結動能持續維持近期改善趨勢",
        ctx,
        "remove_unsupported_conversion_target",
        { numericTarget: true }
    );

    reply = replaceTelegramAgentGuardedPattern(
        reply,
        /(?:新客)?均單[^。\n]{0,16}?(?:至少|不低於|站上|達到)\s*(?:NT\$|\$)?\s*\d[\d,]*(?:\.\d+)?(?:\s*元)?/g,
        "持續提升新客均單表現",
        ctx,
        "remove_unsupported_ticket_target",
        { numericTarget: true }
    );

    reply = replaceTelegramAgentGuardedPattern(
        reply,
        /(?:維持|穩定|保持)[^。\n]{0,28}?\d+(?:\.\d+)?\s*%\s*以上[^。\n]{0,16}?(?:締結|成交)(?:率|表現|動能)?/g,
        "延續近期已改善的新客締結動能",
        ctx,
        "remove_unsupported_conversion_performance_target",
        { numericTarget: true }
    );

    reply = replaceTelegramAgentGuardedPattern(
        reply,
        /(?:每日|每天)[^。\n]{0,18}?(?:最低|至少)[^。\n]{0,8}?(?:進帳|現金|業績)[^。\n]{0,10}?(?:NT\$|\$)?\s*\d[\d,]*(?:\.\d+)?(?:\s*萬|\s*元)?/g,
        "持續追蹤每日進帳節奏",
        ctx,
        "remove_unsupported_daily_target",
        { numericTarget: true }
    );

    reply = replaceTelegramAgentGuardedPattern(
        reply,
        /(?:每週|每周)[^。\n]{0,16}?(?:至少|固定)\s*\d+(?:\.\d+)?\s*(?:天|日|次)/g,
        "依實際尖峰與人力狀況安排支援頻率",
        ctx,
        "remove_unsupported_staffing_frequency",
        { numericTarget: true }
    );

    // ----------------------------------------------------------
    // B. Inference hard guard：
    // 只處理高風險、反覆出現且沒有 KPI 可以直接證實的因果／心理敘述。
    // 不移除分析，而是改成「結果已改善／存在風險／可評估」。
    // ----------------------------------------------------------
    const inferenceRules = [
        {
            regex: /(?:印證|證明|證實)(?:了)?客群具備(?:極高|高度|良好)?(?:的)?變現彈性/g,
            replacement: "顯示近期變現結果明顯改善",
            action: "soften_customer_monetization_inference",
        },
        {
            regex: /(?:這)?顯示門市客群具備(?:極高|高度|良好)?(?:的)?(?:消費力|支付能力)/g,
            replacement: "這顯示近期現金與轉化結果明顯改善",
            action: "soften_customer_spending_power_inference",
        },
        {
            regex: /近期(?:現場)?促單動能(?:已)?(?:有)?實質啟動/g,
            replacement: "近期現金與轉化結果同步改善",
            action: "soften_sales_causality_inference",
        },
        {
            regex: /這代表現場諮詢已成功切入較高價值的方案組合/g,
            replacement: "這顯示近期新客轉化與均單同步改善",
            action: "soften_consulting_process_inference",
        },
        {
            regex: /(?:已|成功)(?:建立|形成)(?:起)?更具說服力的諮詢流程/g,
            replacement: "近期諮詢轉化結果有所改善",
            action: "soften_consulting_process_inference",
        },
        {
            regex: /(?:成功)?引導(?:新客|顧客)[^。；\n]{0,36}(?:高價值|高單價)(?:療程|套組|方案)[^。；\n]*/g,
            replacement: "近期較高客單的成交結果有所增加",
            action: "soften_product_mix_inference",
        },
        {
            regex: /(?:證明|印證|顯示)[^。；\n]{0,20}(?:既有|存量)?客戶[^。；\n]{0,24}(?:信任度|滿意度)[^。；\n]*/g,
            replacement: "舊客近期產值與均單有所改善",
            action: "soften_customer_trust_inference",
        },
        {
            regex: /(?:瓶頸|核心瓶頸)(?:已)?轉移至單兵產能(?:極限)?/g,
            replacement: "單兵產能成為主要營運風險",
            action: "soften_staffing_bottleneck_inference",
        },
        {
            regex: /(?:需|必須)進駐(?:人力|支援)/g,
            replacement: "可優先評估人力支援",
            action: "soften_staffing_directive",
        },
        {
            regex: /(?:需|必須)進駐支援/g,
            replacement: "可優先評估支援",
            action: "soften_staffing_directive",
        },
        {
            regex: /(?:主因|根本原因)(?:就是|是|在於)/g,
            replacement: "可能原因之一是",
            action: "soften_causal_claim",
        },
    ];

    inferenceRules.forEach((rule) => {
        reply = replaceTelegramAgentGuardedPattern(
            reply,
            rule.regex,
            rule.replacement,
            ctx,
            rule.action
        );
    });

    // 清掉 deterministic rewrite 可能產生的少量重複詞。
    reply = reply
        .replace(/近期現金與轉化結果明顯改善，近期現金與轉化結果同步改善/g, "近期現金與轉化結果同步改善")
        .replace(/延續近期已改善的新客諮詢與締結動能[^。\n]*新客締結動能持續維持近期改善趨勢/g, "延續近期已改善的新客諮詢與締結動能")
        .replace(/[ \t]{2,}/g, " ");


    // ----------------------------------------------------------
    // C. 生活美容／醫美用詞 Hard Guard：
    // 避免軍事化、過度剛硬或不符合門市現場語境的詞彙。
    // ----------------------------------------------------------
    const beautyToneRules = [
        {
            regex: /單兵作戰/g,
            replacement: "由單一管理師主要承接",
            action: "beauty_tone_single_staff",
        },
        {
            regex: /單兵支撐/g,
            replacement: "由單一管理師主要承接",
            action: "beauty_tone_single_staff",
        },
        {
            regex: /單兵產能(?:成為|是)?主要營運風險/g,
            replacement: "目前人力配置較集中，服務與諮詢量能需特別留意",
            action: "beauty_tone_staffing_capacity",
        },
        {
            regex: /單兵產能(?:極限)?/g,
            replacement: "單一管理師服務量能",
            action: "beauty_tone_staffing_capacity",
        },
        {
            regex: /(?:由)?單兵(?:承擔|承接|支撐)/g,
            replacement: "由單一管理師主要承接",
            action: "beauty_tone_single_staff",
        },
        {
            regex: /單兵/g,
            replacement: "單一管理師",
            action: "beauty_tone_single_staff",
        },
        {
            regex: /進駐支援/g,
            replacement: "到店支援",
            action: "beauty_tone_on_site_support",
        },
        {
            regex: /(?:人力)?進駐/g,
            replacement: "安排現場支援",
            action: "beauty_tone_on_site_support",
        },
        {
            regex: /推進大單/g,
            replacement: "提升高價值方案成交",
            action: "beauty_tone_high_value_sale",
        },
        {
            regex: /鎖定大單/g,
            replacement: "聚焦高價值成交機會",
            action: "beauty_tone_high_value_sale",
        },
        {
            regex: /大單/g,
            replacement: "高價值方案",
            action: "beauty_tone_high_value_sale",
        },
        {
            regex: /高強度變現節奏/g,
            replacement: "穩定提升業績節奏",
            action: "beauty_tone_monetization",
        },
        {
            regex: /變現彈性/g,
            replacement: "業績提升空間",
            action: "beauty_tone_monetization",
        },
        {
            regex: /變現能力/g,
            replacement: "成交表現",
            action: "beauty_tone_monetization",
        },
        {
            regex: /變現結果/g,
            replacement: "營收表現",
            action: "beauty_tone_monetization",
        },
        {
            regex: /變現節奏/g,
            replacement: "業績提升節奏",
            action: "beauty_tone_monetization",
        },
        {
            regex: /變現/g,
            replacement: "業績轉換",
            action: "beauty_tone_monetization",
        },
        {
            regex: /搶救門市/g,
            replacement: "優先改善門市",
            action: "beauty_tone_rescue",
        },
        {
            regex: /重點搶救/g,
            replacement: "重點改善",
            action: "beauty_tone_rescue",
        },
        {
            regex: /填補(?:百萬|目標)?缺口/g,
            replacement: "縮小目標差距",
            action: "beauty_tone_gap",
        },
        {
            regex: /作戰/g,
            replacement: "執行",
            action: "beauty_tone_battle",
        },
        {
            regex: /攻堅/g,
            replacement: "重點推進",
            action: "beauty_tone_battle",
        },
        {
            regex: /火力/g,
            replacement: "人力與執行資源",
            action: "beauty_tone_battle",
        },
        {
            regex: /戰線/g,
            replacement: "營運面向",
            action: "beauty_tone_battle",
        },
        {
            regex: /狙擊/g,
            replacement: "聚焦",
            action: "beauty_tone_battle",
        },
        {
            regex: /產能受限/g,
            replacement: "服務量能受限",
            action: "beauty_tone_capacity_wording",
        },
        {
            regex: /單一人力產能/g,
            replacement: "單一管理師服務量能",
            action: "beauty_tone_capacity_wording",
        },
        {
            regex: /鎖定(?=高潛力|即將|重點|客戶|顧客)/g,
            replacement: "優先關注",
            action: "beauty_tone_focus_wording",
        },
        {
            regex: /主力管理師/g,
            replacement: "主要管理師",
            action: "beauty_tone_staff_wording",
        },
        {
            regex: /維持目前的成交均單與進帳節奏/g,
            replacement: "持續提升近期成交與進帳表現",
            action: "beauty_tone_goal_gap_wording",
        },
        {
            regex: /目前在線主要由/g,
            replacement: "目前資料顯示，門市主要服務與業績集中於",
            action: "beauty_tone_online_staff",
        },
        {
            regex: /持續延續/g,
            replacement: "延續",
            action: "beauty_tone_duplicate_wording",
        },
        {
            regex: /優質客單(?:表現)?/g,
            replacement: "客單表現",
            action: "beauty_tone_ticket_wording",
        },
        {
            regex: /聚焦高潛力舊客續約/g,
            replacement: "優先關注近期有續約需求的舊客",
            action: "beauty_tone_customer_relationship",
        },
        {
            regex: /高潛力舊客/g,
            replacement: "近期較有續約需求的舊客",
            action: "beauty_tone_customer_relationship",
        },
    ];

    beautyToneRules.forEach((rule) => {
        reply = replaceTelegramAgentGuardedPattern(
            reply,
            rule.regex,
            rule.replacement,
            ctx,
            rule.action
        );
    });

    // 修正常見替換後語句，避免生硬重複。
    reply = reply
        .replace(/目前人力配置較集中，服務與諮詢量能需特別留意，(?:可優先)?評估人力支援/g,
            "目前人力配置較集中，建議優先評估支援安排")
        .replace(/目前人力配置較集中，建議優先評估支援安排(?:釋放諮詢|，?增加諮詢)/g,
            "目前人力配置較集中，建議優先評估支援安排，增加主要管理師的諮詢時間")
        .replace(/可優先評估人力支援釋放諮詢/g,
            "可優先評估支援安排，增加主要管理師的諮詢時間")
        .replace(/可優先評估支援安排釋放諮詢/g,
            "可優先評估支援安排，增加主要管理師的諮詢時間")
        .replace(/到店支援釋放諮詢/g,
            "到店支援，增加主要管理師的諮詢時間")
        .replace(/全店百位來客主要由由單一管理師主要承接/g,
            "全店百位來客主要由單一管理師承接")
        .replace(/主要由由單一管理師主要承接/g,
            "主要由單一管理師承接")
        .replace(/由由單一管理師主要承接/g,
            "由單一管理師承接")
        .replace(/由單一管理師主要承接百位來客/g,
            "百位來客主要由單一管理師承接")
        .replace(/重點優先改善門市/g,
            "重點關注門市")
        .replace(/優先改善門市門市/g,
            "優先改善門市")
        .replace(/這顯示近期新客締結率與均單同步改善，轉化品質明顯改善/g,
            "這顯示近期新客成交品質明顯改善")
        .replace(/近期成交與營收表現明顯改善，近期較高客單的成交結果有所增加/g,
            "近期成交與營收表現明顯改善")
        .replace(/延續近期已改善的新客諮詢與締結動能與客單表現/g,
            "延續近期已改善的新客締結與客單表現")
        .replace(/持續提升近期成交與進帳表現[^。\n]*若要達成全月目標/g,
            "若要持續縮小目標差距，下半月仍需比目前整月平均更積極的業績表現")
        .replace(/[ \t]{2,}/g, " ");

    return reply;
}


function polishTelegramAgentNarrativeQuality(text, ctx = null) {
    let reply = String(text || "");

    const sentenceRules = [
        {
            regex: /(?:這)?顯示[^。\n]{0,22}(?:顧客|客群)[^。\n]{0,20}(?:消費意願|支付能力)[^。\n]*。/g,
            replacement: "近期現金、締結與客單表現同步改善；至於改善主要來自客群、方案組合或諮詢方式，現有資料無法單獨判定。",
            action: "polish_unverified_customer_intent_sentence",
        },
        {
            regex: /[^。\n]*(?:高價值(?:護理)?方案(?:的)?推廣|推廣高價值(?:護理)?方案)[^。\n]*(?:初步|實質)?成效[^。\n]*。/g,
            replacement: "近期成交與客單表現同步改善，但現有資料無法單獨判定是否由特定方案推廣造成。",
            action: "polish_unverified_solution_effect_sentence",
        },
        {
            regex: /[^。\n]*(?:現場)?諮詢(?:流程)?[^。\n]*(?:有效引導|成功引導)[^。\n]*(?:完整|高價值)[^。\n]*(?:護理|療程|方案|組合)[^。\n]*。/g,
            replacement: "近期新客締結率與均單同步改善；至於改善是否主要來自諮詢方式或方案組合，現有資料無法單獨判定。",
            action: "polish_unverified_consulting_effect_sentence",
        },
        {
            regex: /[^。\n]*近期成交與營收表現明顯改善[^。\n]*(?:回購潛力|近期成交與客單表現同步改善)[^。\n]*。/g,
            replacement: "近期現金與客單表現同步改善，顯示門市成交動能明顯回升。",
            action: "polish_duplicate_revenue_sentence",
        },
        {
            regex: /[^。\n]*舊客持續提升新客均單表現[^。\n]*。/g,
            replacement: (sentence) => {
                const cleaned = String(sentence || "")
                    .replace(/，?舊客持續提升新客均單表現/g, "")
                    .replace(/舊客持續提升新客均單表現，?/g, "")
                    .replace(/，。/g, "。")
                    .trim();
                return cleaned && cleaned !== "。" ? cleaned : "";
            },
            action: "polish_invalid_subject_object_sentence",
        },
        {
            regex: /若要實質縮小全月目標落差，下半月每日平均進帳節奏需維持在穩定高檔。/g,
            replacement: "由目前月底預估來看，現有整月平均節奏仍不足以達成目標，下半月需要進一步提升成交表現。",
            action: "polish_goal_gap_sentence",
        },
        {
            regex: /確保進店顧客能持續轉化為長期穩定的護理會員/g,
            replacement: "持續觀察近期改善的諮詢與成交表現是否能穩定延續",
            action: "polish_membership_overclaim",
        },
        {
            regex: /近期新客締結率與均單同步改善；至於改善[^。\n]*現有資料無法單獨判定。\s*現有資料無法單獨判定顧客購買[^。\n]*，但[^。\n]*。/g,
            replacement: "近期新客締結率與均單同步改善；至於改善主要來自諮詢方式、方案組合或其他因素，現有資料無法單獨判定，但整體成交表現的改善方向明確。",
            action: "polish_duplicate_evidence_caveat",
        },
        {
            regex: /目前門市主要業績與轉化高度集中於單一管理師([^（。\n]+)(（[^。\n]+）)?。/g,
            replacement: (full, person, metrics) => `目前取得的人員業績資料顯示${String(person || "").trim()}${metrics || ""}；但現有資料無法直接確認實際排班、操作分工與其他支援人力。`,
            action: "polish_staffing_evidence_boundary",
        },
        {
            regex: /目前門市主要業績與轉化(?:較為|相對)?集中於單一管理師([^（。\n]+)(（[^。\n]+）)?。/g,
            replacement: (full, person, metrics) => `目前取得的人員業績資料顯示${String(person || "").trim()}${metrics || ""}；但現有資料無法直接確認實際排班、操作分工與其他支援人力。`,
            action: "polish_staffing_evidence_boundary",
        },
        {
            regex: /在單一管理師承接多數諮詢與操作的情況下，[^。\n]*。/g,
            replacement: "若實際服務人力同樣較集中，則可能壓縮主要管理師可用於完整諮詢與顧客溝通的時間。",
            action: "polish_staffing_workload_inference",
        },
        {
            regex: /(?:當)?單一管理師[^。\n]*(?:大量|多數)[^。\n]*(?:操作|諮詢)[^。\n]*，[^。\n]*(?:諮詢時間|服務量能)[^。\n]*。/g,
            replacement: "若實際服務人力較集中，可能使主要管理師可用於完整諮詢與顧客溝通的時間受到壓縮。",
            action: "polish_staffing_workload_inference",
        },
        {
            regex: /現有資料無法直接判定個人排班與操作工時，但適度分擔基礎護理將有助於釋放核心諮詢量能。/g,
            replacement: "現有資料無法直接判定個人排班與操作工時；若實際服務人力較集中，可評估分擔部分基礎服務，以增加主要管理師可用於諮詢與顧客溝通的時間。",
            action: "polish_staffing_action_evidence",
        },
        {
            regex: /若維持目前進度節奏，月底預估[^。\n]+。\s*下半月仍需維持穩定的成交步調。/g,
            replacement: "由目前月底預估來看，現有整月平均表現仍不足以達成目標；下半月需要進一步提升成交表現，才能持續縮小目標差距。",
            action: "polish_progress_logic",
        },
        {
            regex: /若維持目前進度節奏，月底預估[^。\n]+，下半月仍需維持穩定的成交步調。/g,
            replacement: "由目前月底預估來看，現有整月平均表現仍不足以達成目標；下半月需要進一步提升成交表現，才能持續縮小目標差距。",
            action: "polish_progress_logic",
        },
        {
            regex: /(?:延續|維持)近期[^。\n]*(?:新客)?諮詢[^。\n]*，確保每位到店新客[^。\n]*維持成交均單。/g,
            replacement: "優先保留完整的顧客需求溝通時間，持續觀察近期改善的締結率與客單表現是否能穩定延續。",
            action: "polish_new_customer_action_overclaim",
        },
        {
            regex: /確保每位到店新客皆有充足諮詢時間以維持成交均單。/g,
            replacement: "優先保留完整的顧客需求溝通時間，持續觀察近期改善的締結率與客單表現是否能穩定延續。",
            action: "polish_new_customer_action_overclaim",
        },
        {
            regex: /於護理服務中適度融入居家保養品建議，在提升顧客護理效果的同時穩健增加營收動能。/g,
            replacement: "依顧客實際護理需求提供合適的居家保養建議，同時觀察產品銷售與整體客單表現。",
            action: "polish_homecare_effect_overclaim",
        },
        {
            regex: /月底(?:現金)?預估[^。\n]+(?:，|。)\s*下半月仍需維持(?:穩健|穩定)[^。\n]*(?:進帳|成交)[^。\n]*。/g,
            replacement: "由目前月底預估來看，現有整月平均表現仍不足以達成目標；下半月需要進一步提升成交表現，才能持續縮小目標差距。",
            action: "polish_forecast_progress_logic",
        },
        {
            regex: /這顯示(?:主力|主要)人員在諮詢與成交上具備良好表現，但(?:現場)?實際排班與(?:操作|服務)分工(?:細節)?仍無法由現有(?:數據|資料)直接確認。/g,
            replacement: "就目前可確認的績效結果而言，該管理師的個人業績與新客締結表現相對突出；但實際排班與服務分工仍無法由現有資料直接確認。",
            action: "polish_staff_consulting_overclaim",
        },
        {
            regex: /針對近期成交(?:之|的)新客建立主動關懷節奏，(?:維繫|提升)(?:服務|顧客)?滿意度並(?:穩定|維持)後續排約進度。/g,
            replacement: "針對近期成交的新客持續安排服務關懷，了解後續護理狀況與回訪需求。",
            action: "polish_customer_satisfaction_overclaim",
        },
    ];

    sentenceRules.forEach((rule) => {
        reply = replaceTelegramAgentGuardedPattern(
            reply,
            rule.regex,
            rule.replacement,
            ctx,
            rule.action
        );
    });

    const safePhraseRules = [
        {
            regex: /釋放諮詢量能/g,
            replacement: "增加主要管理師的諮詢時間",
            action: "polish_consulting_capacity_phrase",
        },
        {
            regex: /人員負載/g,
            replacement: "人員服務負荷",
            action: "polish_staff_load_phrase",
        },
        {
            regex: /人力負荷集中/g,
            replacement: "人力配置較集中",
            action: "polish_staffing_phrase",
        },
        {
            regex: /成交體質/g,
            replacement: "成交表現",
            action: "polish_conversion_wording",
        },
        {
            regex: /服務單價/g,
            replacement: "客單表現",
            action: "polish_ticket_wording",
        },
        {
            regex: /固化新客諮詢節奏/g,
            replacement: "延續近期新客諮詢改善",
            action: "polish_rigid_wording",
        },
        {
            regex: /轉化動能與均單顯著修復/g,
            replacement: "新客轉化與客單表現明顯改善",
            action: "polish_repair_wording",
        },
        {
            regex: /轉化與均單顯著修復/g,
            replacement: "新客轉化與客單表現明顯改善",
            action: "polish_repair_wording",
        },
        {
            regex: /轉化動能與均單顯著改善/g,
            replacement: "新客轉化與客單表現明顯改善",
            action: "polish_conversion_wording_final",
        },
        {
            regex: /深耕舊客續約機會/g,
            replacement: "關注舊客續約機會",
            action: "polish_customer_relationship_wording",
        },
        {
            regex: /釋放核心諮詢量能/g,
            replacement: "增加主要管理師可用於諮詢與顧客溝通的時間",
            action: "polish_consulting_capacity_phrase",
        },
        {
            regex: /人力負荷較集中/g,
            replacement: "人力配置較集中",
            action: "polish_staffing_phrase",
        },
        {
            regex: /持續推動居家保養搭配/g,
            replacement: "持續提供居家保養建議",
            action: "polish_homecare_wording",
        },
        {
            regex: /穩定新客諮詢節奏/g,
            replacement: "延續近期新客諮詢改善",
            action: "polish_new_customer_action_title",
        },
        {
            regex: /分擔基礎服務操作/g,
            replacement: "分擔部分基礎服務",
            action: "polish_basic_service_wording",
        },
    ];

    safePhraseRules.forEach((rule) => {
        reply = replaceTelegramAgentGuardedPattern(
            reply,
            rule.regex,
            rule.replacement,
            ctx,
            rule.action
        );
    });

    reply = reply
        .replace(/近期現金與客單表現同步改善，顯示門市成交動能明顯回升。現場近期成交與客單表現同步改善。/g,
            "近期現金與客單表現同步改善，顯示門市成交動能明顯回升。")
        .replace(/這顯示近期新客締結率與均單同步改善，成交表現與客單表現皆呈現良好修復/g,
            "這顯示近期新客締結率與均單同步改善")
        .replace(/延續近期已改善的新客締結動能與高均單引導流程/g,
            "延續近期已改善的新客諮詢與成交表現")
        .replace(/現有資料無法單獨判定。\s*現有資料無法單獨判定/g,
            "現有資料無法單獨判定")
        .replace(/現有資料無法直接確認實際排班、操作分工與其他支援人力。若實際服務人力同樣較集中，則可能壓縮主要管理師可用於完整諮詢與顧客溝通的時間。現有資料無法直接判定個人排班與操作工時；若實際服務人力較集中，可評估分擔部分基礎服務，以增加主要管理師可用於諮詢與顧客溝通的時間。/g,
            "現有資料無法直接確認實際排班、操作分工與其他支援人力。若實際服務人力較集中，可能壓縮主要管理師可用於完整諮詢與顧客溝通的時間；可再評估是否需要分擔部分基礎服務。")
        .replace(/現有資料無法直接確認實際排班、操作分工與其他支援人力。\s*現有資料無法直接判定個人排班與操作工時；/g,
            "現有資料無法直接確認實際排班、操作分工與其他支援人力；")
        .replace(/下半月仍需維持穩健的進帳動能以縮小目標差距/g,
            "下半月需要進一步提升成交表現，才能持續縮小目標差距")
        .replace(/下半月仍需維持穩定的進帳動能以縮小目標差距/g,
            "下半月需要進一步提升成交表現，才能持續縮小目標差距")
        .replace(/維繫服務滿意度/g, "了解後續護理狀況與回訪需求")
        .replace(/提升服務滿意度/g, "了解後續護理狀況與回訪需求")
        .replace(/持續維持/g, "維持")
        .replace(/持續延續/g, "延續")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/，{2,}/g, "，")
        .replace(/。{2,}/g, "。");

    return reply;
}

function compactTelegramAgentDetailedKpis(text, ctx = null) {
    if (getTelegramAgentReplyMode(ctx) !== "detailed") return String(text || "");

    const lines = String(text || "").split("\n");
    const idxKpi = lines.findIndex((line) => String(line || "").trim().startsWith("📊"));
    const idxChange = lines.findIndex((line) => String(line || "").trim().startsWith("🔎"));

    if (idxKpi < 0 || idxChange < 0 || idxChange <= idxKpi) {
        return String(text || "");
    }

    const rawKpis = lines
        .slice(idxKpi + 1, idxChange)
        .map((line) => String(line || "").trim())
        .filter((line) => line.startsWith("•"));

    const normalized = normalizeTelegramAgentMobileKpiLines(rawKpis);

    const find = (regex) => normalized.find((line) => regex.test(line)) || "";
    const cash = find(/^•\s*現金[:：]/);
    const gap = find(/^•\s*缺口[:：]/);
    const forecast = find(/^•\s*月底預估[:：]/);
    const accrual = find(/^•\s*權責[:：]/);
    const traffic = find(/^•\s*來客[:：]/);
    const newCustomer = find(/^•\s*新客[:：]/);
    const staffing = find(/^•\s*(?:人力|人員)[:：]/);

    const selected = [];

    if (cash) selected.push(cash);

    if (gap && forecast) {
        const gapValue = gap.replace(/^•\s*缺口[:：]\s*/, "").trim();
        const forecastValue = forecast.replace(/^•\s*月底預估[:：]\s*/, "").trim();
        selected.push(`• 缺口：${gapValue}｜月底預估 ${forecastValue}`);
    } else {
        if (gap) selected.push(gap);
        if (forecast) selected.push(forecast);
    }

    if (accrual) selected.push(accrual);
    if (traffic) selected.push(traffic);
    if (newCustomer) selected.push(newCustomer);
    if (staffing) {
        selected.push(staffing.replace(/^•\s*人員[:：]/, "• 人力："));
    }

    for (const line of normalized) {
        if (selected.length >= 6) break;
        if (!selected.includes(line) && !/^•\s*舊客[:：]/.test(line)) {
            selected.push(line);
        }
    }

    const compactedKpis = selected.slice(0, 6);
    const output = [
        ...lines.slice(0, idxKpi + 1),
        ...compactedKpis,
        "",
        ...lines.slice(idxChange),
    ].join("\n").replace(/\n{3,}/g, "\n\n").trim();

    if (output !== String(text || "").trim()) {
        recordTelegramAgentReplyGuardAction(
            ctx,
            "compact_detailed_mobile_kpis",
            rawKpis.join(" ").slice(0, 160),
            compactedKpis.join(" ").slice(0, 160)
        );
    }

    return output;
}

function normalizeTelegramAgentMobileKpiLines(lines = []) {
    const output = [];

    (Array.isArray(lines) ? lines : []).forEach((rawLine) => {
        const line = String(rawLine || "").trim();
        if (!line) return;

        let match = line.match(/^•\s*缺口[:：]\s*([^｜]+)｜月底預估\s*(.+)$/);
        if (match) {
            output.push(`• 缺口：${match[1].trim()}`);
            output.push(`• 月底預估：${match[2].trim()}`);
            return;
        }

        match = line.match(/^•\s*轉化[:：]\s*新客締結\s*([^｜]+)｜新客均單\s*([^・]+)・舊客均單\s*(.+)$/);
        if (match) {
            output.push(`• 新客：締結 ${match[1].trim()}｜均單 ${match[2].trim()}`);
            output.push(`• 舊客：均單 ${match[3].trim()}`);
            return;
        }

        match = line.match(/^•\s*人力[:：]\s*(.+?)\s*個人業績\s*([^｜]+)｜新客締結\s*(.+)$/);
        if (match) {
            output.push(`• 人力：${match[1].trim()}｜業績 ${match[2].trim()}`);
            output.push(`• ${match[1].trim()}新客：締結 ${match[3].trim()}`);
            return;
        }

        output.push(line);
    });

    return output;
}

function compactTelegramAgentBriefReply(text, ctx = null) {
    if (getTelegramAgentReplyMode(ctx) !== "brief") return String(text || "");

    const lines = String(text || "")
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => String(line || "").trimEnd());

    const findSection = (prefix) => lines.findIndex((line) => line.trim().startsWith(prefix));
    const idxKpi = findSection("📊");
    const idxChange = findSection("🔎");
    const idxAction = findSection("🎯");

    // 若模型沒有產生標準區塊，不冒險重組；只讓原有長度護欄處理。
    if (idxKpi < 0 || idxChange < 0 || idxAction < 0) return String(text || "");

    const headerLines = lines.slice(0, idxKpi).filter((line) => line.trim());
    const kpiLinesRaw = lines.slice(idxKpi + 1, idxChange).filter((line) => line.trim().startsWith("•"));
    const kpiLines = normalizeTelegramAgentMobileKpiLines(kpiLinesRaw);

    const preferredKpis = [];
    const pickFirst = (regex) => {
        const found = kpiLines.find((line) => regex.test(line));
        if (found && !preferredKpis.includes(found)) preferredKpis.push(found);
    };

    // 快速摘要的預設 KPI 優先順序：現金 → 缺口/預估 → 來客 → 新客轉化。
    pickFirst(/^•\s*現金[:：]/);
    pickFirst(/^•\s*缺口[:：]/);
    pickFirst(/^•\s*月底預估[:：]/);
    pickFirst(/^•\s*來客[:：]/);
    pickFirst(/^•\s*新客[:：]/);

    // 若本題明確問權責／保養品／人力，優先納入對應 KPI。
    const question = String(ctx?.question || "");
    if (/權責/.test(question)) pickFirst(/^•\s*權責[:：]/);
    if (/保養品|產品/.test(question)) {
        const productLine = kpiLines.find((line) => /保養品/.test(line));
        if (productLine && !preferredKpis.includes(productLine)) preferredKpis.push(productLine);
    }
    if (/人力|管理師|人員|排班/.test(question)) pickFirst(/^•\s*人力[:：]/);

    // 補到最多 5 行，但不讓簡易回答變成 KPI 清單大全。
    for (const line of kpiLines) {
        if (preferredKpis.length >= 5) break;
        if (!preferredKpis.includes(line)) preferredKpis.push(line);
    }

    // 主要變化：只保留 ↑ ↓ ⚠ 的標題摘要行，完全移除其下說明段落。
    const changeLines = lines
        .slice(idxChange + 1, idxAction)
        .map((line) => line.trim())
        .filter((line) => /^(↑|↓|⚠)\s/.test(line))
        .slice(0, 3);

    // 優先行動：最多 2 項，每項 title + 第一個短說明。
    const actionSource = lines.slice(idxAction + 1);
    const actionBlocks = [];
    let current = null;

    for (const raw of actionSource) {
        const line = raw.trim();
        if (!line) continue;
        const titleMatch = line.match(/^(\d+[.、])\s*(.+)$/);
        if (titleMatch) {
            if (current) actionBlocks.push(current);
            current = {
                title: `${titleMatch[1]} ${titleMatch[2]}`.trim(),
                body: "",
            };
            continue;
        }
        if (current && !current.body && !line.startsWith("────────") && !line.startsWith("資料：")) {
            current.body = line.length > 62 ? `${line.slice(0, 61).replace(/[，、；]\s*$/, "")}。` : line;
        }
    }
    if (current) actionBlocks.push(current);

    const selectedActions = actionBlocks.slice(0, 2);

    const output = [];
    output.push(...headerLines);

    output.push("", "📊 關鍵數字");
    output.push(...preferredKpis.slice(0, 5));

    if (changeLines.length) {
        output.push("", "🔎 主要變化");
        output.push(...changeLines);
    }

    if (selectedActions.length) {
        output.push("", "🎯 優先行動");
        selectedActions.forEach((item, index) => {
            if (index > 0) output.push("");
            output.push(item.title);
            if (item.body) output.push(item.body);
        });
    }

    const compacted = output.join("\n").replace(/\n{3,}/g, "\n\n").trim();

    if (compacted && compacted !== String(text || "").trim()) {
        recordTelegramAgentReplyGuardAction(
            ctx,
            "compact_brief_mobile_reply",
            String(text || "").slice(0, 160),
            compacted.slice(0, 160)
        );
    }

    return compacted || String(text || "");
}


function applyTelegramAgentCrossSourceReplyGuard(text, ctx = null) {
    let reply = String(text || "");
    const awarenessList = Array.isArray(ctx?.crossSourceDataAwareness)
        ? ctx.crossSourceDataAwareness
        : [];
    const mismatch = awarenessList.find((item) => item?.status === "difference_detected");

    if (!mismatch) return reply;

    // ----------------------------------------------------------
    // A. 禁止把「全店新客數」與「個人締結率」混成同一母體。
    // 若個人 KPI 自己已有 numerator / denominator，仍可保留個人資料；
    // 但移除容易讓讀者誤認為是全店同一批新客的人數括號。
    // ----------------------------------------------------------
    reply = replaceTelegramAgentGuardedPattern(
        reply,
        /(新客締結率(?:為|達)?\s*\d+(?:\.\d+)?\s*%)（\s*\d+\s*位新客[^）]{0,32}(?:締結|成交)\s*\d+\s*(?:位|人次)?\s*）/g,
        "$1（人員日報口徑）",
        ctx,
        "cross_source_remove_ambiguous_person_count"
    );

    reply = replaceTelegramAgentGuardedPattern(
        reply,
        /(新客締結(?:率)?\s*\d+(?:\.\d+)?\s*%)（\s*\d+\s*位新客[^）]{0,32}(?:締結|成交)\s*\d+\s*(?:位|人次)?\s*）/g,
        "$1（人員日報口徑）",
        ctx,
        "cross_source_remove_ambiguous_person_count"
    );

    // ----------------------------------------------------------
    // B. 有差異時，不允許使用需要「店家總量 vs 個人數量」比較才能成立的說法。
    // 個人的業績、締結次數、締結率仍可正常呈現，因為它們屬於人員日報自身資料。
    // ----------------------------------------------------------
    const crossSourceComparisonRules = [
        {
            regex: /⚠\s*人力配置較集中[:：]\s*單一管理師承接多數成交/g,
            replacement: "⚠ 人員資料觀察：個人業績與新客締結表現較突出",
            action: "cross_source_remove_majority_comparison",
        },
        {
            regex: /⚠\s*(?:業績集中度|人力配置|服務量能與人力分布)[^。\n]*[:：][^。\n]*(?:單一管理師承接多數成交|主要成交集中於單一管理師)[^。\n]*/g,
            replacement: "⚠ 人員資料觀察：個人業績與新客締結表現較突出",
            action: "cross_source_remove_majority_comparison",
        },
        {
            regex: /單一管理師承接多數成交/g,
            replacement: "該管理師個人業績與新客締結表現相對突出",
            action: "cross_source_remove_majority_comparison",
        },
        {
            regex: /(?:主要|多數)成交集中於(?:單一|特定)管理師/g,
            replacement: "該管理師個人業績與新客締結表現相對突出",
            action: "cross_source_remove_majority_comparison",
        },
        {
            regex: /(?:主要業績|整體業績|成交)集中於(?:單一|特定)管理師/g,
            replacement: "該管理師個人業績表現相對突出",
            action: "cross_source_remove_majority_comparison",
        },
        {
            regex: /(?:占|佔)(?:全店)?(?:多數|大多數)[^。\n]{0,12}(?:新客|成交|締結)/g,
            replacement: "個人新客締結表現相對突出",
            action: "cross_source_remove_majority_comparison",
        },
    ];

    crossSourceComparisonRules.forEach((rule) => {
        reply = replaceTelegramAgentGuardedPattern(
            reply,
            rule.regex,
            rule.replacement,
            ctx,
            rule.action
        );
    });

    // ----------------------------------------------------------
    // C. Gemini 偶爾仍會自行產生「⚠️ 資料提醒」。
    // 先移除所有與本 Cross-source 差異相同內容的模型提醒，
    // 再由 backend 在固定位置只插入一次 canonical note。
    // ----------------------------------------------------------
    const canonicalSentence = "店家與人員日報部分統計存在差異；本次全店指標依店家日報、人員指標依人員日報呈現，未交叉換算。";

    const beforeDuplicateCleanup = reply;

    // heading + canonical sentence
    reply = reply.replace(
        new RegExp(
            `(?:\\n|^)[ \\t]*(?:⚠️?|ℹ️)?[ \\t]*(?:資料提醒|資料口徑)[:：]?[ \\t]*\\n?[ \\t]*${canonicalSentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*(?=\\n|$)`,
            "g"
        ),
        "\n"
    );

    // canonical sentence without heading
    reply = reply.replace(
        new RegExp(
            `(?:\\n|^)[ \\t]*${canonicalSentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*(?=\\n|$)`,
            "g"
        ),
        "\n"
    );

    if (reply !== beforeDuplicateCleanup) {
        recordTelegramAgentReplyGuardAction(
            ctx,
            "cross_source_remove_duplicate_model_note",
            "模型自行產生資料提醒",
            "由 backend 統一插入 canonical data-scope note"
        );
    }

    reply = reply.replace(/\n{3,}/g, "\n\n").trim();

    // Brief 不主動顯示資料差異，維持快速閱讀。
    if (getTelegramAgentReplyMode(ctx) !== "detailed") {
        return reply;
    }

    const note = `ℹ️ 資料口徑：${canonicalSentence}`;

    // Detailed 固定只在「主要變化」與「優先行動」之間出現一次。
    if (!reply.includes("ℹ️ 資料口徑：") && /🎯\s*優先行動/.test(reply)) {
        reply = reply.replace(
            /\n\s*🎯\s*優先行動/,
            `\n\n${note}\n\n🎯 優先行動`
        );
        recordTelegramAgentReplyGuardAction(
            ctx,
            "cross_source_add_detailed_scope_note",
            "",
            note
        );
    }

    return reply.replace(/\n{3,}/g, "\n\n").trim();
}

function optimizeTelegramAgentMobileLayout(text, ctx = null) {
    let reply = String(text || "");

    // 所有模式都處理最常見的 KPI 長行，詳細版也能改善手機折行。
    const lines = reply.split("\n");
    const output = [];
    let insideKpi = false;

    for (const rawLine of lines) {
        const trimmed = String(rawLine || "").trim();
        if (trimmed.startsWith("📊")) {
            insideKpi = true;
            output.push(rawLine);
            continue;
        }
        if (/^(🔎|🎯)/.test(trimmed)) {
            insideKpi = false;
            output.push(rawLine);
            continue;
        }

        if (insideKpi && trimmed.startsWith("•")) {
            output.push(...normalizeTelegramAgentMobileKpiLines([trimmed]));
        } else {
            output.push(rawLine);
        }
    }

    reply = output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    reply = compactTelegramAgentBriefReply(reply, ctx);
    reply = compactTelegramAgentDetailedKpis(reply, ctx);

    return reply;
}

function formatTelegramAgentAnalysisReply(text, ctx = null) {
    let reply = String(text || "")
        .replace(/\r/g, "")
        .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z0-9_-]*\n?/g, "").replace(/```/g, ""))
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^#{1,6}\s*/gm, "")
        .replace(/^\s*---+\s*$/gm, "")
        .trim();

    reply = convertTelegramMarkdownTablesToCards(reply);

    reply = reply
        .replace(/^\s*[-*]\s+/gm, "• ")
        .replace(/^一、\s*核心結論\s*$/gm, "📌 核心結論")
        .replace(/^二、\s*.*(?:營運指標|數據|盤點|變化).*/gm, "📊 關鍵數字")
        .replace(/^三、\s*.*(?:優先|行動|改善).*/gm, "🎯 優先行動")
        .replace(/\n(?=\d+[.、]\s)/g, "\n\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (!reply) {
        reply = "🤖 戰情秘書目前無法完成這個分析，請將問題縮小到品牌、店家或月份後再試一次。";
    }

    // v2：預設戰情簡報版限制更短；明確要求詳細分析時才放寬。
    const replyMode = getTelegramAgentReplyMode(ctx);
    const maxLength = replyMode === "detailed" ? 2000 : 950;
    const preferredCut = replyMode === "detailed" ? 1880 : 850;
    const safeFloor = replyMode === "detailed" ? 1650 : 700;

    if (reply.length > maxLength) {
        const cutAt = Math.max(
            reply.lastIndexOf("\n", preferredCut),
            reply.lastIndexOf("。", preferredCut),
            safeFloor
        );
        reply = `${reply.slice(0, cutAt > 0 ? cutAt + 1 : preferredCut).trim()}\n\n…（已精簡較次要說明）`;
    }

    return reply;
}

function escapeTelegramHtml(text = "") {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function renderTelegramAgentReadableHtml(text = "") {
    return String(text || "")
        .split("\n")
        .map((line) => {
            const raw = String(line || "");
            const trimmed = raw.trim();
            const escaped = escapeTelegramHtml(raw);

            if (/^(📌|📊|🔎|🎯)\s/.test(trimmed)) {
                return `<b>${escaped}</b>`;
            }

            if (/^判斷[:：]/.test(trimmed)) {
                const match = raw.match(/^(\s*判斷[:：])\s*(.*)$/);
                if (match) {
                    return `${escapeTelegramHtml(match[1])}<b>${escapeTelegramHtml(match[2])}</b>`;
                }
            }

            if (/^⚠️\s*資料提醒[:：]/.test(trimmed)) {
                return `<b>${escaped}</b>`;
            }

            // 詳細版的「主要變化」標題行加粗，手機掃讀時更容易分段。
            if (/^(↑|↓|⚠)\s/.test(trimmed) && trimmed.length <= 96) {
                return `<b>${escaped}</b>`;
            }

            // KPI：只粗體行首指標名稱，避免整行變粗而失去層級。
            const kpiMatch = raw.match(/^(\s*•\s*)([^：:]{1,14})([:：])(.*)$/);
            if (kpiMatch) {
                return `${escapeTelegramHtml(kpiMatch[1])}<b>${escapeTelegramHtml(kpiMatch[2])}</b>${escapeTelegramHtml(kpiMatch[3])}${escapeTelegramHtml(kpiMatch[4])}`;
            }

            // 行動標題若是短行，整行粗體；下一行做法保持正常字重。
            if (/^\s*\d+[.、]\s*\S+/.test(raw) && trimmed.length <= 34) {
                return `<b>${escaped}</b>`;
            }

            return escaped;
        })
        .join("\n");
}


function getTelegramAgentReplyMode(ctx = null) {
    const question = String(ctx?.question || "").trim();
    const detailedRequested = /詳細|完整分析|完整報告|完整說明|展開|深入|細節|詳述|逐項|全面分析|原因分析|為什麼會|請分析原因/i.test(question);
    return detailedRequested ? "detailed" : "brief";
}

// ==========================================
// ★ Telegram Prompt 模組
// Prompt 文字集中於 ./telegram/prompts.js。
// Runtime Policy / Preference / Reply Mode 仍由本檔提供。
// ==========================================
const {
    getTelegramAgentEvidenceGuardInstruction,
    getTelegramAgentInferenceGuardInstruction,
    getTelegramAgentBeautyServiceToneInstruction,
    getTelegramAgentReplyModeInstruction,
    getTelegramAgentCrossSourceInstruction,
    getTelegramAgentSystemInstruction,
    getTelegramAgentFinalizerInstruction,
} = createTelegramAgentPrompts({
    getTelegramAgentReplyMode,
    formatTelegramAgentPolicyContext,
    getTelegramAgentPreferenceInstructions,
});



function getGeminiApiKey() {
    const apiKey = String(GEMINI_API_KEY.value() || "").trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY 尚未設定");
    return apiKey;
}


function serializeTelegramToolResult(value, maxLength = 50000) {
    let raw;
    try {
        raw = JSON.stringify(value);
    } catch (error) {
        raw = JSON.stringify({ ok: false, error: `工具結果無法序列化：${error.message}` });
    }
    if (raw.length <= maxLength) return raw;
    return JSON.stringify({
        truncated: true,
        originalLength: raw.length,
        preview: raw.slice(0, Math.max(1000, maxLength - 200)),
    });
}

function getGeminiInteractionFunctionCalls(interaction) {
    return (Array.isArray(interaction?.steps) ? interaction.steps : [])
        .filter((step) => step?.type === "function_call" && step?.name);
}

function getGeminiInteractionText(interaction) {
    if (typeof interaction?.output_text === "string" && interaction.output_text.trim()) {
        return interaction.output_text.trim();
    }
    const chunks = [];
    (Array.isArray(interaction?.steps) ? interaction.steps : []).forEach((step) => {
        if (step?.type !== "model_output" || !Array.isArray(step.content)) return;
        step.content.forEach((part) => {
            if (part?.type === "text" && part?.text) chunks.push(String(part.text));
        });
    });
    return chunks.join("\n").trim();
}

function getGeminiErrorStatus(error) {
    return Number(
        error?.response?.status ||
        error?.status ||
        error?.statusCode ||
        0
    );
}

function isRecoverableGeminiError(error) {
    const status = getGeminiErrorStatus(error);
    const code = String(error?.cause?.code || error?.code || "").toUpperCase();
    return [404, 408, 409, 429, 500, 502, 503, 504].includes(status) ||
        ["ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(code);
}

function getGeminiErrorMessage(error) {
    const status = getGeminiErrorStatus(error);
    const apiMessage =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        "Gemini API 未知錯誤";
    return `${status ? `[${status}] ` : ""}${apiMessage}`;
}

async function requestGeminiInteraction({
    model,
    input,
    systemInstruction,
    tools = [],
}) {
    const payload = {
        model,
        input,
        store: false,
        system_instruction: String(systemInstruction || ""),
    };
    if (Array.isArray(tools) && tools.length > 0) payload.tools = tools;

    try {
        const response = await axios.post(
            getGeminiInteractionsApiUrl(model),
            payload,
            {
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": getGeminiApiKey(),
                },
                timeout: GEMINI_INTERACTIONS_TIMEOUT_MS,
            }
        );
        const interaction = response.data || {};
        if (interaction.status === "failed" || interaction.status === "cancelled") {
            const stateError = new Error(`Gemini interaction 狀態異常：${interaction.status}`);
            stateError.status = interaction.status === "failed" ? 503 : 500;
            throw stateError;
        }
        return interaction;
    } catch (error) {
        const wrapped = new Error(getGeminiErrorMessage(error));
        wrapped.status = getGeminiErrorStatus(error);
        wrapped.response = error?.response;
        wrapped.cause = error;
        throw wrapped;
    }
}

async function finalizeTelegramAgentAnswer(
    question,
    memoryText,
    scopeText,
    toolOutputs,
    dateInfo,
    ctx,
    modelName = TELEGRAM_AGENT_PRIMARY_MODEL
) {
    const payload = JSON.stringify(toolOutputs).slice(0, 120000);
    const interaction = await requestGeminiInteraction({
        model: modelName,
        systemInstruction: getTelegramAgentFinalizerInstruction(dateInfo, ctx),
        input: `最近對話：
${memoryText}

結構化查詢範圍：
${scopeText}

本題：${question}

已取得資料：
${payload}`,
    });
    recordTelegramAgentUsage(ctx, interaction);
    return interaction;
}

async function runTelegramAgentInteractionLoop({
    modelName,
    prompt,
    command,
    memoryText,
    dateInfo,
    ctx,
}) {
    const history = [
        {
            type: "user_input",
            content: [{ type: "text", text: prompt }],
        },
    ];
    const toolOutputs = [];
    let totalToolCalls = 0;
    let interaction;

    try {
        interaction = await requestGeminiInteraction({
            model: modelName,
            input: history,
            systemInstruction: getTelegramAgentSystemInstruction(dateInfo, ctx),
            tools: TELEGRAM_AGENT_INTERACTION_TOOLS,
        });
        recordTelegramAgentUsage(ctx, interaction);

        for (let round = 0; round <= TELEGRAM_AGENT_MAX_TOOL_CALLS; round += 1) {
            const steps = Array.isArray(interaction?.steps) ? interaction.steps : [];
            history.push(...steps);
            const calls = getGeminiInteractionFunctionCalls(interaction);

            if (!calls.length) {
                const text = getGeminiInteractionText(interaction);
                if (text) return { finalReply: text, toolOutputs, interaction };
                break;
            }

            const functionResults = [];
            for (const call of calls) {
                const callId = String(call.id || "").trim();
                const callName = String(call.name || "").trim();
                if (!callId) throw new Error(`Gemini function_call 缺少 call id：${callName || "unknown"}`);

                if (totalToolCalls >= TELEGRAM_AGENT_MAX_TOOL_CALLS) {
                    functionResults.push({
                        type: "function_result",
                        name: callName,
                        call_id: callId,
                        result: [{
                            type: "text",
                            text: JSON.stringify({
                                ok: false,
                                error: `本題工具呼叫上限為 ${TELEGRAM_AGENT_MAX_TOOL_CALLS} 次，請依現有資料完成回答。`,
                            }),
                        }],
                    });
                    continue;
                }

                if (ctx.readCount >= TELEGRAM_AGENT_MAX_READS) {
                    functionResults.push({
                        type: "function_result",
                        name: callName,
                        call_id: callId,
                        result: [{
                            type: "text",
                            text: JSON.stringify({
                                ok: false,
                                error: `本題已達約 ${TELEGRAM_AGENT_MAX_READS} 筆文件讀取上限，請依現有資料完成回答。`,
                            }),
                        }],
                    });
                    continue;
                }

                totalToolCalls += 1;
                const requestedArgs = call.arguments && typeof call.arguments === "object"
                    ? call.arguments
                    : {};

                try {
                    const toolExecution = await executeTelegramAgentTool(
                        callName,
                        requestedArgs,
                        ctx,
                        dateInfo
                    );
                    const effectiveArgs = toolExecution.effectiveArgs || requestedArgs;
                    const toolResult = toolExecution.result;
                    toolOutputs.push({
                        name: callName,
                        callId,
                        args: effectiveArgs,
                        result: toolResult,
                    });
                    functionResults.push({
                        type: "function_result",
                        name: callName,
                        call_id: callId,
                        result: [{
                            type: "text",
                            text: serializeTelegramToolResult({ ok: true, result: toolResult }),
                        }],
                    });
                } catch (toolError) {
                    const errorResult = { ok: false, error: toolError.message };
                    ctx.toolCalls.push({
                        name: callName,
                        args: requestedArgs,
                        ok: false,
                        error: toolError.message,
                        readCountAfter: ctx.readCount,
                    });
                    toolOutputs.push({
                        name: callName,
                        callId,
                        args: requestedArgs,
                        result: errorResult,
                    });
                    functionResults.push({
                        type: "function_result",
                        name: callName,
                        call_id: callId,
                        result: [{
                            type: "text",
                            text: serializeTelegramToolResult(errorResult),
                        }],
                    });
                }
            }

            if (!functionResults.length) break;
            history.push(...functionResults);
            interaction = await requestGeminiInteraction({
                model: modelName,
                input: history,
                systemInstruction: getTelegramAgentSystemInstruction(dateInfo, ctx),
                tools: TELEGRAM_AGENT_INTERACTION_TOOLS,
            });
            recordTelegramAgentUsage(ctx, interaction);
        }

        const remainingText = getGeminiInteractionText(interaction);
        if (remainingText && !getGeminiInteractionFunctionCalls(interaction).length) {
            return { finalReply: remainingText, toolOutputs, interaction };
        }

        const finalInteraction = await finalizeTelegramAgentAnswer(
            command,
            memoryText,
            formatTelegramAgentScopeState(ctx.scopeState),
            toolOutputs,
            dateInfo,
            ctx,
            modelName
        );
        return {
            finalReply: getGeminiInteractionText(finalInteraction),
            toolOutputs,
            interaction: finalInteraction,
        };
    } catch (error) {
        error.telegramToolOutputs = toolOutputs;
        throw error;
    }
}

// ==========================================
// ★ 3. Webhook：DRCYJ Telegram 營運戰情 Agent
// Gemini 3.7 Flash + Interactions API（store=false）
// ==========================================
exports.telegramWebhook = onRequest({
    secrets: [GEMINI_API_KEY, TELEGRAM_BOT_TOKEN_SECRET],
    timeoutSeconds: 120,
    memory: "512MiB",
}, async (req, res) => {
    const callbackQuery = req.body?.callback_query || null;
    const message = callbackQuery?.message || req.body?.message;
    if (!message) return res.sendStatus(200);

    const chatMeta = getTelegramChatDebugMeta(message);
    if (chatMeta.migrateToChatId || chatMeta.migrateFromChatId) {
        console.warn(
            `Telegram 群組 Chat ID migration：from=${chatMeta.migrateFromChatId || chatMeta.chatId} ` +
            `to=${chatMeta.migrateToChatId || chatMeta.chatId} title=${chatMeta.chatTitle || "-"}`
        );
    }

    const incomingText = callbackQuery?.data || message?.text;
    if (!incomingText) {
        console.log(
            `Telegram 非文字 update 已略過：chatId=${chatMeta.chatId} ` +
            `type=${chatMeta.chatType || "-"} title=${chatMeta.chatTitle || "-"}`
        );
        return res.sendStatus(200);
    }

    const chatId = message.chat?.id;
    const actor = callbackQuery?.from || message.from || {};
    const userId = actor?.id || "unknown";
    const originalRawCommand = String(incomingText || "").trim();
    const rawCommand = callbackQuery
        ? originalRawCommand
        : normalizeTelegramIncomingText(originalRawCommand);

    console.log(
        `Telegram update 收到：chatId=${chatMeta.chatId} type=${chatMeta.chatType || "-"} ` +
        `title=${chatMeta.chatTitle || "-"} userId=${userId} text=${originalRawCommand.slice(0, 120)}`
    );

    if (!isTelegramChatAuthorized(chatId)) {
        console.warn(
            `Telegram 未授權聊天室已拒絕：${chatId} ` +
            `type=${chatMeta.chatType || "-"} title=${chatMeta.chatTitle || "-"}`
        );
        return res.sendStatus(200);
    }

    console.log(
        `Telegram 聊天室授權通過：chatId=${chatMeta.chatId} ` +
        `type=${chatMeta.chatType || "-"} title=${chatMeta.chatTitle || "-"}`
    );

    if (callbackQuery?.id) {
        try {
            await answerTelegramCallbackQuery(callbackQuery.id, "已收到");
        } catch (callbackError) {
            console.warn("Telegram callback answer failed:", callbackError.message);
        }
    }

    // 群組連線快速診斷：不使用 Gemini、不讀 Firestore。
    if (!callbackQuery && /^\/(?:ping|chatid)(?:@\w+)?$/i.test(originalRawCommand)) {
        const diagnosticReply = [
            "✅ DRCYJ Agent 已連線",
            `群組：${chatMeta.chatTitle || "私人對話"}`,
            `Chat ID：${chatMeta.chatId}`,
            `類型：${chatMeta.chatType || "unknown"}`,
            "白名單：已授權",
        ].join("\n");
        try {
            await sendTelegramMessage(chatId, diagnosticReply);
            console.log(`Telegram /ping 回覆成功：chatId=${chatMeta.chatId}`);
        } catch (pingError) {
            console.error(
                `Telegram /ping 回覆失敗：chatId=${chatMeta.chatId} ` +
                `status=${pingError?.response?.status || ""} ` +
                `data=${JSON.stringify(pingError?.response?.data || {})} ` +
                `message=${pingError.message}`
            );
        }
        return res.sendStatus(200);
    }

    const expandedCommand = callbackQuery ? rawCommand : expandTelegramAgentCommand(rawCommand);
    const ctx = createTelegramAgentContext({ chatId, userId, question: expandedCommand });
    ctx.userName = [actor?.first_name, actor?.last_name].filter(Boolean).join(" ") || String(actor?.username || "Telegram user");
    const auditMessage = {
        ...message,
        from: actor,
        text: callbackQuery ? `[callback] ${rawCommand}` : rawCommand,
    };
    const dateInfo = getTelegramAgentTaipeiNow();
    let finalReply = "";
    let memoryTurns = [];

    try {
        if (!callbackQuery && (/^\/(reset|new)$/i.test(rawCommand) || /^(重置對話|清除對話|重新開始)$/.test(rawCommand))) {
            await resetTelegramAgentMemory(chatId, userId);
            await sendTelegramMessage(chatId, "✅ 已清除短期對話脈絡。長期營運規則與個人偏好仍會保留；可用 /rules 查看。");
            return res.sendStatus(200);
        }

        const memoryPayload = await loadTelegramAgentMemory(chatId, userId, ctx);
        memoryTurns = memoryPayload.turns;
        ctx.scopeState = sanitizeTelegramAgentScopeState(memoryPayload.state || {});
        ctx.learningCandidates = memoryPayload.learningCandidates || {};

        const explicitBrandId = getTelegramAgentExplicitBrandId(expandedCommand);
        if (explicitBrandId) ctx.scopeState.activeBrandId = explicitBrandId;
        if (isTelegramAgentAllBrandIntent(expandedCommand)) ctx.scopeState.activeBrandId = "";

        await loadTelegramAgentPolicyState(ctx);

        const v5Result = await parseTelegramV5Command(
            rawCommand,
            ctx,
            memoryPayload,
            callbackQuery ? rawCommand : ""
        );
        if (v5Result?.handled) {
            finalReply = cleanTelegramAgentReply(v5Result.reply || "已完成排程／任務操作。")
                .replace(/\n\n資料基準：[\s\S]*$/, "");
            const replyMarkup = buildTelegramV5InlineKeyboard({
                pending: v5Result.pending,
                task: v5Result.task,
            });
            await sendTelegramMessage(chatId, finalReply, replyMarkup ? { reply_markup: replyMarkup } : {});
            await writeTelegramAgentAuditLog(auditMessage, ctx, finalReply, "v5_command");
            return res.sendStatus(200);
        }

        const policyResult = callbackQuery
            ? await handleTelegramPolicyCallbackData(rawCommand, ctx, memoryPayload)
            : await parseTelegramPolicyCommand(rawCommand, ctx, dateInfo, memoryPayload);

        if (policyResult?.handled) {
            finalReply = cleanTelegramAgentReply(policyResult.reply || "已完成規則操作。")
                .replace(/\n\n資料基準：[\s\S]*$/, "");
            const replyMarkup = buildTelegramPolicyInlineKeyboard({
                pending: policyResult.pending,
                rules: policyResult.rules,
            });
            await sendTelegramMessage(chatId, finalReply, replyMarkup ? { reply_markup: replyMarkup } : {});
            await writeTelegramAgentAuditLog(auditMessage, ctx, finalReply, "policy_command");
            return res.sendStatus(200);
        }

        const oneShotPolicies = await consumeTelegramOneShotPolicies(chatId, userId, memoryPayload);
        if (oneShotPolicies.length) {
            ctx.transientPolicies = [...(ctx.transientPolicies || []), ...oneShotPolicies];
        }
        await loadTelegramAgentPolicyState(ctx);

        const learningCandidate = detectTelegramLearningCandidate(rawCommand);
        ctx.learningCandidates = updateTelegramLearningCandidates(ctx.learningCandidates, learningCandidate);
        if (learningCandidate) {
            const candidateState = ctx.learningCandidates[learningCandidate.preferenceKey];
            const alreadyRemembered = (ctx.policies || []).some((policy) =>
                policy.type === "response_preference" &&
                policy.preferenceKey === learningCandidate.preferenceKey &&
                isTelegramPolicyActive(policy)
            );
            if (!alreadyRemembered && Number(candidateState?.count || 0) >= 2) {
                ctx.memorySuggestion = learningCandidate;
            }
        }

        const command = policyResult?.command || expandedCommand;
        const memoryText = formatTelegramAgentMemory(memoryTurns);
        const policyContext = formatTelegramAgentPolicyContext(ctx, { command });
        const prompt = `以下是這位使用者最近的個人對話脈絡，只用於理解「那家店、上個月、剛才那位管理師」等追問：
${memoryText}

目前生效的長期規則：
${policyContext}

目前問題：${command}`;

        ctx.modelName = TELEGRAM_AGENT_PRIMARY_MODEL;
        ctx.geminiApi = getGeminiInteractionsApiLabel(TELEGRAM_AGENT_PRIMARY_MODEL);
        let agentResult;
        try {
            agentResult = await runTelegramAgentInteractionLoop({
                modelName: TELEGRAM_AGENT_PRIMARY_MODEL,
                prompt,
                command,
                memoryText,
                dateInfo,
                ctx,
            });
        } catch (primaryError) {
            if (!isRecoverableGeminiError(primaryError)) throw primaryError;

            ctx.fallbackUsed = true;
            ctx.modelName = TELEGRAM_AGENT_FALLBACK_MODEL;
            ctx.geminiApi = getGeminiInteractionsApiLabel(TELEGRAM_AGENT_FALLBACK_MODEL);
            ctx.warnings.push(
                `主要模型 ${TELEGRAM_AGENT_PRIMARY_MODEL} 暫時不可用，已切換 ${TELEGRAM_AGENT_FALLBACK_MODEL}。`
            );

            const partialToolOutputs = Array.isArray(primaryError.telegramToolOutputs)
                ? primaryError.telegramToolOutputs
                : [];

            if (partialToolOutputs.length > 0) {
                const fallbackFinal = await finalizeTelegramAgentAnswer(
                    command,
                    memoryText,
                    formatTelegramAgentScopeState(ctx.scopeState),
                    partialToolOutputs,
                    dateInfo,
                    ctx,
                    TELEGRAM_AGENT_FALLBACK_MODEL
                );
                agentResult = {
                    finalReply: getGeminiInteractionText(fallbackFinal),
                    toolOutputs: partialToolOutputs,
                    interaction: fallbackFinal,
                };
            } else {
                agentResult = await runTelegramAgentInteractionLoop({
                    modelName: TELEGRAM_AGENT_FALLBACK_MODEL,
                    prompt,
                    command,
                    memoryText,
                    dateInfo,
                    ctx,
                });
            }
        }

        finalReply = formatTelegramAgentAnalysisReply(agentResult?.finalReply || "", ctx);
        finalReply = applyTelegramAgentDeterministicReplyGuard(finalReply, ctx);
        finalReply = polishTelegramAgentNarrativeQuality(finalReply, ctx);
        finalReply = applyTelegramAgentCrossSourceReplyGuard(finalReply, ctx);
        finalReply = optimizeTelegramAgentMobileLayout(finalReply, ctx);
        const replyWithFooter = `${finalReply}${buildTelegramAgentSourceFooter(ctx)}`;
        const readableHtml = renderTelegramAgentReadableHtml(replyWithFooter);
        await sendTelegramMessage(chatId, readableHtml, { parse_mode: "HTML" });
        await Promise.allSettled([
            saveTelegramAgentMemory(chatId, userId, memoryTurns, rawCommand, finalReply, ctx),
            writeTelegramAgentAuditLog(auditMessage, ctx, finalReply, "success"),
        ]);
    } catch (error) {
        console.error("Telegram Agent 嚴重錯誤:", error);
        const errorText = error instanceof TelegramAgentBudgetError
            ? `⚠️ ${error.message}`
            : `❌ 戰情秘書暫時失聯：\n${error.message}`;
        try {
            await sendTelegramMessage(chatId, errorText);
        } catch (sendError) {
            console.error(
                "Telegram 錯誤通知發送失敗:",
                sendError.message,
                "status=",
                sendError?.response?.status || "",
                "data=",
                JSON.stringify(sendError?.response?.data || {})
            );
        }
        await writeTelegramAgentAuditLog(auditMessage, ctx, finalReply, "error", error.message);
    }
    return res.sendStatus(200);
});


// 每日整理失效、重複規則與逾時確認，避免長期記憶累積成互相衝突的設定。
// 成本節流：只查 active 規則與已到期 session 索引欄位，不再掃描全部歷史規則與全部 session。
async function cleanupExpiredTelegramAgentSessions(fieldName, deleteFields, nowMs) {
    let matchedCount = 0;
    let writeCount = 0;
    let rounds = 0;
    while (rounds < 10) {
        rounds += 1;
        const snap = await db.collection("telegram_agent_sessions")
            .where(fieldName, "<=", nowMs)
            .limit(400)
            .get();
        if (snap.empty) break;

        const batch = db.batch();
        const nowText = new Date().toISOString();
        snap.docs.forEach((sessionDoc) => {
            const patch = {
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAtText: nowText,
            };
            deleteFields.forEach((field) => {
                patch[field] = admin.firestore.FieldValue.delete();
            });
            batch.set(sessionDoc.ref, patch, { merge: true });
        });
        await batch.commit();
        matchedCount += snap.size;
        writeCount += snap.size;
        if (snap.size < 400) break;
    }
    return { matchedCount, writeCount, rounds };
}

exports.cleanupTelegramAgentPolicies = onSchedule({
    schedule: "20 3 * * *",
    timeZone: "Asia/Taipei",
    timeoutSeconds: 120,
    memory: "256MiB",
}, async () => {
    const today = getTelegramPolicyToday();
    const nowMs = Date.now();
    const nowText = new Date(nowMs).toISOString();

    const policySnap = await getTelegramAgentPoliciesRef().where("status", "==", "active").get();
    const policies = policySnap.docs
        .map((snap) => normalizeTelegramAgentPolicy(snap.data() || {}, snap.id))
        .filter((policy) => policy.enabled !== false);
    const activeByConflict = {};
    policies.forEach((policy) => {
        const key = policy.conflictKey || getTelegramPolicyConflictKey(policy);
        if (!activeByConflict[key]) activeByConflict[key] = [];
        activeByConflict[key].push(policy);
    });

    const updateMap = new Map();
    policies.forEach((policy) => {
        if (policy.effectiveUntil && policy.effectiveUntil < today) {
            updateMap.set(policy.id, { id: policy.id, status: "expired", reason: "effective_until_passed" });
        }
    });
    Object.values(activeByConflict).forEach((rows) => {
        const validRows = rows.filter((policy) => !(policy.effectiveUntil && policy.effectiveUntil < today));
        if (validRows.length <= 1) return;
        validRows.sort((a, b) => String(b.updatedAtText || b.createdAtText).localeCompare(String(a.updatedAtText || a.createdAtText)));
        validRows.slice(1).forEach((policy) => {
            if (!updateMap.has(policy.id)) {
                updateMap.set(policy.id, { id: policy.id, status: "superseded", reason: `duplicate_of:${validRows[0].id}` });
            }
        });
    });
    const updates = [...updateMap.values()];

    for (let index = 0; index < updates.length; index += 400) {
        const batch = db.batch();
        updates.slice(index, index + 400).forEach((item) => {
            batch.set(getTelegramAgentPoliciesRef().doc(item.id), {
                enabled: false,
                status: item.status,
                statusReason: item.reason,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAtText: nowText,
            }, { merge: true });
        });
        await batch.commit();
    }
    if (updates.length > 0) invalidateTelegramAgentPolicyRuntimeCache({ permissions: false, policies: true });

    const pendingCleanup = await cleanupExpiredTelegramAgentSessions(
        "pendingPolicyExpiresAtMs",
        ["pendingPolicyAction", "pendingPolicyExpiresAtMs"],
        nowMs
    );
    const oneShotCleanup = await cleanupExpiredTelegramAgentSessions(
        "oneShotExpiresAtMs",
        ["oneShotPolicies", "oneShotExpiresAtText", "oneShotExpiresAtMs"],
        nowMs
    );
    const v5PendingCleanup = await cleanupExpiredTelegramAgentSessions(
        "pendingV5ExpiresAtMs",
        ["pendingV5Action", "pendingV5ExpiresAtMs"],
        nowMs
    );

    let expiredTaskDraftCount = 0;
    const expiredTaskDrafts = await getTelegramAgentTaskDraftsRef()
        .where("expiresAtMs", "<=", nowMs)
        .limit(400)
        .get();
    if (!expiredTaskDrafts.empty) {
        const batch = db.batch();
        expiredTaskDrafts.docs.forEach((docSnap) => batch.delete(docSnap.ref));
        await batch.commit();
        expiredTaskDraftCount = expiredTaskDrafts.size;
    }

    await getTelegramAgentPolicyDataRootRef().collection("global_settings").doc("telegram_agent_policy_cleanup_status").set({
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        lastRunAtText: nowText,
        policyQueryMode: "status_active_only",
        sessionQueryMode: "indexed_expiry_fields",
        scannedPolicyCount: policies.length,
        changedPolicyCount: updates.length,
        matchedPendingSessionCount: pendingCleanup.matchedCount,
        matchedOneShotSessionCount: oneShotCleanup.matchedCount,
        matchedV5PendingSessionCount: v5PendingCleanup.matchedCount,
        expiredTaskDraftCount,
        scannedSessionCount: pendingCleanup.matchedCount + oneShotCleanup.matchedCount + v5PendingCleanup.matchedCount,
        cleanedSessionCount: pendingCleanup.writeCount + oneShotCleanup.writeCount + v5PendingCleanup.writeCount,
        status: "completed",
    }, { merge: true });
});

// ==========================================
// ★ DRCYJ Telegram 預警管理中心 v3.0
// 每品牌獨立規則、可選指標庫、品牌獨立顯示上限。
// 設定路徑：artifacts/default-app-id/public/data/global_settings/telegram_active_alerts
// 狀態路徑：artifacts/default-app-id/public/data/global_settings/telegram_active_alert_status
// ==========================================
const TELEGRAM_ALERT_BRAND_IDS = ["cyj", "anniu", "yibo"];
const TELEGRAM_ACTIVE_ALERT_RULE_LABELS = Object.freeze({
    progressGap: "現金進度差距",
    cashAchievementRate: "現金業績達成率",
    closingRate: "新客締結率",
    skincareRatio: "保養品占比",
    newCustomers: "本月新客數",
    traffic: "本月來客人次",
    missingReport: "店家日報缺漏",
    missingTarget: "現金目標缺漏",
});

function createTelegramActiveAlertDefaultRules() {
    return {
        progressGap: { enabled: true, watchThreshold: 10, criticalThreshold: 20 },
        cashAchievementRate: { enabled: false, threshold: 50, severity: "watch" },
        closingRate: { enabled: true, threshold: 35, minSample: 5, severity: "watch" },
        skincareRatio: { enabled: true, threshold: 5, severity: "watch" },
        newCustomers: { enabled: false, threshold: 10, severity: "watch" },
        traffic: { enabled: false, threshold: 50, severity: "watch" },
        missingReport: { enabled: true, category: "data" },
        missingTarget: { enabled: true, category: "data" },
    };
}

function createTelegramActiveAlertDefaultBrandProfile() {
    return { limit: 8, rules: createTelegramActiveAlertDefaultRules() };
}

const TELEGRAM_ACTIVE_ALERT_DEFAULTS = Object.freeze({
    enabled: false,
    sendTime: "09:35",
    weekdays: [1, 2, 3, 4, 5],
    brandIds: [...TELEGRAM_ALERT_BRAND_IDS],
    chatTargets: ["main", "manager"],
    sendWhenClear: false,
    pausedUntil: "",
    timezone: "Asia/Taipei",
});

const TELEGRAM_ALERT_APP_ID = "default-app-id";

function getTelegramAlertDataRootRef() {
    return db.collection("artifacts").doc(TELEGRAM_ALERT_APP_ID).collection("public").doc("data");
}

function getTelegramActiveAlertConfigRef() {
    return getTelegramAlertDataRootRef().collection("global_settings").doc("telegram_active_alerts");
}

function getTelegramActiveAlertStatusRef() {
    return getTelegramAlertDataRootRef().collection("global_settings").doc("telegram_active_alert_status");
}

function clampTelegramAlertNumber(value, fallback, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
}

function normalizeTelegramAlertSeverity(value, fallback = "watch") {
    return value === "critical" ? "critical" : fallback;
}

function normalizeTelegramActiveAlertRules(raw = {}) {
    const defaults = createTelegramActiveAlertDefaultRules();
    const legacy = raw && typeof raw === "object" ? raw : {};
    const progressRaw = raw?.progressGap && typeof raw.progressGap === "object" ? raw.progressGap : {};
    const watchThreshold = clampTelegramAlertNumber(
        progressRaw.watchThreshold ?? legacy.watchProgressGap,
        defaults.progressGap.watchThreshold,
        0,
        100
    );
    const criticalThreshold = Math.max(
        watchThreshold,
        clampTelegramAlertNumber(
            progressRaw.criticalThreshold ?? legacy.criticalProgressGap,
            defaults.progressGap.criticalThreshold,
            0,
            100
        )
    );

    const normalizeSingleThresholdRule = (key, fallbackThreshold, max = 100) => {
        const source = raw?.[key] && typeof raw[key] === "object" ? raw[key] : {};
        return {
            enabled: source.enabled === true,
            threshold: clampTelegramAlertNumber(source.threshold, fallbackThreshold, 0, max),
            severity: normalizeTelegramAlertSeverity(source.severity),
        };
    };

    const closingRaw = raw?.closingRate && typeof raw.closingRate === "object" ? raw.closingRate : {};
    const skincareRaw = raw?.skincareRatio && typeof raw.skincareRatio === "object" ? raw.skincareRatio : {};
    const hasStructuredRules = Object.values(raw || {}).some((value) => value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "enabled"));

    return {
        progressGap: {
            enabled: hasStructuredRules ? progressRaw.enabled === true : true,
            watchThreshold,
            criticalThreshold,
        },
        cashAchievementRate: normalizeSingleThresholdRule("cashAchievementRate", defaults.cashAchievementRate.threshold),
        closingRate: {
            enabled: hasStructuredRules ? closingRaw.enabled === true : true,
            threshold: clampTelegramAlertNumber(
                closingRaw.threshold ?? legacy.closingRate,
                defaults.closingRate.threshold,
                0,
                100
            ),
            minSample: Math.round(clampTelegramAlertNumber(
                closingRaw.minSample ?? legacy.minNewCustomers,
                defaults.closingRate.minSample,
                0,
                999
            )),
            severity: normalizeTelegramAlertSeverity(closingRaw.severity),
        },
        skincareRatio: {
            enabled: hasStructuredRules ? skincareRaw.enabled === true : true,
            threshold: clampTelegramAlertNumber(
                skincareRaw.threshold ?? legacy.skincareRatio,
                defaults.skincareRatio.threshold,
                0,
                100
            ),
            severity: normalizeTelegramAlertSeverity(skincareRaw.severity),
        },
        newCustomers: normalizeSingleThresholdRule("newCustomers", defaults.newCustomers.threshold, 999999),
        traffic: normalizeSingleThresholdRule("traffic", defaults.traffic.threshold, 999999),
        missingReport: {
            enabled: hasStructuredRules
                ? raw?.missingReport?.enabled === true
                : legacy.missingReportEnabled !== false,
            category: "data",
        },
        missingTarget: {
            enabled: hasStructuredRules
                ? raw?.missingTarget?.enabled === true
                : legacy.missingTargetEnabled !== false,
            category: "data",
        },
    };
}

function getTelegramActiveAlertEnabledRuleLabels(rules = {}) {
    return Object.entries(TELEGRAM_ACTIVE_ALERT_RULE_LABELS)
        .filter(([key]) => rules?.[key]?.enabled === true)
        .map(([, label]) => label);
}

function normalizeTelegramActiveAlertBrandProfile(rawProfile = {}, legacyLimit = 8, legacyThresholds = {}) {
    const fallback = createTelegramActiveAlertDefaultBrandProfile();
    return {
        limit: Math.round(clampTelegramAlertNumber(rawProfile?.limit, legacyLimit || fallback.limit, 1, 20)),
        rules: normalizeTelegramActiveAlertRules(
            rawProfile?.rules && typeof rawProfile.rules === "object" ? rawProfile.rules : legacyThresholds
        ),
    };
}

function normalizeTelegramActiveAlertConfig(raw = {}) {
    const sendTime = /^\d{2}:\d{2}$/.test(String(raw.sendTime || "")) ? String(raw.sendTime) : TELEGRAM_ACTIVE_ALERT_DEFAULTS.sendTime;
    const weekdays = [...new Set((Array.isArray(raw.weekdays) ? raw.weekdays : TELEGRAM_ACTIVE_ALERT_DEFAULTS.weekdays)
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
    const brandIds = [...new Set((Array.isArray(raw.brandIds) ? raw.brandIds : TELEGRAM_ACTIVE_ALERT_DEFAULTS.brandIds)
        .map(normalizeTelegramAgentBrandId)
        .filter(Boolean))];
    const chatTargets = [...new Set((Array.isArray(raw.chatTargets) ? raw.chatTargets : TELEGRAM_ACTIVE_ALERT_DEFAULTS.chatTargets)
        .map(String)
        .filter((target) => ["main", "manager"].includes(target)))];
    const legacyLimit = Math.round(clampTelegramAlertNumber(raw.limit, 8, 1, 20));
    const legacyThresholds = raw.thresholds && typeof raw.thresholds === "object" ? raw.thresholds : {};
    const brandProfiles = Object.fromEntries(
        TELEGRAM_ALERT_BRAND_IDS.map((brandId) => [
            brandId,
            normalizeTelegramActiveAlertBrandProfile(raw?.brandProfiles?.[brandId] || {}, legacyLimit, legacyThresholds),
        ])
    );

    return {
        enabled: raw.enabled === true,
        sendTime,
        weekdays: weekdays.length ? weekdays : [...TELEGRAM_ACTIVE_ALERT_DEFAULTS.weekdays],
        brandIds: brandIds.length ? brandIds : [...TELEGRAM_ACTIVE_ALERT_DEFAULTS.brandIds],
        chatTargets: chatTargets.length ? chatTargets : [...TELEGRAM_ACTIVE_ALERT_DEFAULTS.chatTargets],
        brandProfiles,
        sendWhenClear: raw.sendWhenClear === true,
        pausedUntil: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.pausedUntil || "")) ? String(raw.pausedUntil) : "",
        timezone: "Asia/Taipei",
        updatedAtText: String(raw.updatedAtText || ""),
        updatedBy: String(raw.updatedBy || ""),
    };
}

function getTelegramAlertTaipeiClock() {
    const taipei = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const year = taipei.getUTCFullYear();
    const month = taipei.getUTCMonth() + 1;
    const day = taipei.getUTCDate();
    const hour = taipei.getUTCHours();
    const minute = taipei.getUTCMinutes();
    return {
        year,
        month,
        day,
        hour,
        minute,
        weekday: taipei.getUTCDay(),
        todayStr: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        yearMonth: `${year}-${String(month).padStart(2, "0")}`,
        timeText: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        totalMinutes: hour * 60 + minute,
    };
}

function resolveTelegramActiveAlertChatIds(config) {
    const ids = [];
    if ((config.chatTargets || []).includes("main")) ids.push(TARGET_CHAT_ID_MAIN);
    if ((config.chatTargets || []).includes("manager")) ids.push(TARGET_CHAT_ID_MANAGER);
    const legacyIds = Array.isArray(config.chatIds) ? config.chatIds.map(String) : [];
    return [...new Set([...ids, ...legacyIds])].filter((id) => isTelegramChatAuthorized(id));
}

function isTelegramAlertDue(config, now) {
    if (!config.enabled) return { due: false, reason: "disabled" };
    if (!config.weekdays.includes(now.weekday)) return { due: false, reason: "weekday_disabled" };
    if (config.pausedUntil && now.todayStr <= config.pausedUntil) return { due: false, reason: "paused" };
    const [hour, minute] = config.sendTime.split(":").map(Number);
    const targetMinutes = hour * 60 + minute;
    const delta = now.totalMinutes - targetMinutes;
    return { due: delta >= 0 && delta < 5, reason: delta < 0 ? "not_yet" : "outside_window" };
}

function formatTelegramAlertProgressGap(progressGap) {
    if (!Number.isFinite(Number(progressGap))) return "無法計算時間進度差距";
    const value = Number(progressGap);
    if (value < 0) return `落後時間進度 ${Math.abs(value).toFixed(1)} 個百分點`;
    if (value > 0) return `領先時間進度 ${value.toFixed(1)} 個百分點`;
    return "與月份時間進度一致";
}

function getTelegramActiveAlertDailyMissingRows(result = {}) {
    const rows = Array.isArray(result?.dailyMissingReports) ? result.dailyMissingReports : [];
    const seen = new Set();
    return rows
        .map((row) => ({
            storeName: normalizeSummaryCoreName(row?.storeName || ""),
            officialManager: String(row?.officialManager || "未分配").trim() || "未分配",
            actingManager: String(row?.actingManager || "").trim(),
            delegationId: String(row?.delegationId || "").trim(),
            delegationEndDate: String(row?.delegationEndDate || "").trim(),
        }))
        .filter((row) => {
            if (!row.storeName) return false;
            const key = `${row.storeName}|${row.actingManager}|${row.officialManager}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function buildTelegramActiveAlertMissingReportGroups(rows = []) {
    const groups = new Map();
    rows.forEach((row) => {
        const actingManager = String(row?.actingManager || "").trim();
        const officialManager = String(row?.officialManager || "未分配").trim() || "未分配";
        const responsibilityType = actingManager ? "delegated" : "official";
        const responsibleManager = actingManager || officialManager;
        const key = `${responsibilityType}|${responsibleManager}|${officialManager}`;
        if (!groups.has(key)) {
            groups.set(key, {
                responsibilityType,
                responsibleManager,
                officialManager,
                stores: [],
            });
        }
        const group = groups.get(key);
        if (!group.stores.includes(row.storeName)) group.stores.push(row.storeName);
    });
    return [...groups.values()].sort((a, b) => {
        if (a.responsibilityType !== b.responsibilityType) return a.responsibilityType === "delegated" ? -1 : 1;
        return a.responsibleManager.localeCompare(b.responsibleManager, "zh-Hant");
    });
}

function formatTelegramAgentActiveAlertMessage(result, ctx, todayStr, brandProfile = {}) {
    const rows = Array.isArray(result?.alerts) ? result.alerts : [];
    const dataIssues = Array.isArray(result?.dataIssues) ? result.dataIssues : [];
    const dailyMissingRows = getTelegramActiveAlertDailyMissingRows(result);
    const dailyMissingReportDate = String(result?.dailyMissingReportDate || "").trim();
    const dailyMissingReportCount = dailyMissingRows.length;
    const summary = Array.isArray(result?.brandSummaries) ? result.brandSummaries[0] : null;
    const brand = summary?.brand || rows[0]?.brand || "目前品牌";
    const rate = summary?.dataStatus === "PRE_SYSTEM_SKIP"
        ? "正式系統使用前月份，不計算"
        : summary?.cashAchievementRate === null || summary?.cashAchievementRate === undefined
            ? (
                summary?.cashAchievementStatus === "TARGET_INCOMPLETE"
                    ? "現金目標資料不足，無法計算"
                    : summary?.cashAchievementStatus === "N_A"
                        ? "N/A（目標為 0）"
                        : "現金實績資料不足，無法計算"
            )
            : `${summary.cashAchievementRate}%`;
    const activeStoreCount = Number(summary?.activeStoreCount || 0);
    const excludedStoreCount = Number(summary?.excludedStoreCount || 0);
    const criticalCount = Number(summary?.operationalCriticalCount || 0);
    const watchCount = Number(summary?.operationalWatchCount || 0);
    const dataIssueCount = Number(summary?.dataIssueCount || 0);
    const limit = Math.min(20, Math.max(1, Number(brandProfile?.limit) || 8));
    const enabledRuleLabels = Array.isArray(result?.enabledRuleLabels)
        ? result.enabledRuleLabels
        : getTelegramActiveAlertEnabledRuleLabels(brandProfile?.rules || {});
    const lines = [
        `🚨 ${brand} 主動戰情巡察｜${todayStr}`,
        `月份時間進度：${result?.expectedProgress ?? "-"}%`,
        `整體現金達成：${rate}｜${formatTelegramAlertProgressGap(summary?.progressGap)}`,
        `正式納管：${activeStoreCount} 家｜已排除：${excludedStoreCount} 家`,
        `🔴 營運紅燈 ${criticalCount} 家｜🟠 營運黃燈 ${watchCount} 家｜📋 資料待補 ${dataIssueCount} 家`,
        ...(dailyMissingReportCount > 0 ? [`🗓 ${dailyMissingReportDate || "昨日"} 日報未回報 ${dailyMissingReportCount} 家`] : []),
        `本次判斷：${enabledRuleLabels.length ? enabledRuleLabels.join("、") : "未啟用任何項目"}`,
    ];

    if (rows.length > 0) {
        lines.push("", `優先關注（最多顯示 ${limit} 家）：`);
        rows.slice(0, limit).forEach((row, index) => {
            const icon = row.severity === "critical" ? "🔴" : "🟠";
            const storeRate = row.cashAchievementRate === null
                ? (
                    row.cashAchievementStatus === "N_A"
                        ? "N/A（目標為 0）"
                        : !isValidNumericStatus(String(row.cashTargetStatus || ""))
                            ? "現金目標資料不足"
                            : "現金實績資料不足"
                )
                : `${row.cashAchievementRate}%`;
            lines.push(`${index + 1}. ${icon} ${row.storeName}店｜現金達成 ${storeRate}`);
            if (row.actingManager) lines.push(`   目前代理：${row.actingManager}｜正式主管：${row.manager || "未分配"}`);
            lines.push(`   原因：${(row.reasons || []).join("、") || "符合目前預警規則"}`);
        });
        if (Number(result?.operationalAlertCount || rows.length) > rows.length) {
            lines.push(`   …另有 ${Number(result.operationalAlertCount) - rows.length} 家符合營運預警門檻`);
        }
    } else {
        lines.push("", "✅ 目前沒有符合門檻的營運紅燈或黃燈店家。");
    }

    if (dailyMissingReportCount > 0) {
        lines.push("", `🗓 ${dailyMissingReportDate || "昨日"} 店家日報未回報（${dailyMissingReportCount} 家）：`);
        buildTelegramActiveAlertMissingReportGroups(dailyMissingRows).forEach((group) => {
            const storeText = group.stores.map((storeName) => `${storeName}店`).join("、");
            const ownerText = group.responsibilityType === "delegated"
                ? `${group.responsibleManager}（代理｜正式主管：${group.officialManager}）`
                : group.responsibleManager;
            lines.push(`• ${ownerText}：${storeText}`);
        });
    }

    if (dataIssues.length > 0) {
        lines.push("", "📋 資料待補：");
        dataIssues.slice(0, limit).forEach((row) => {
            const ownerText = row.actingManager ? `｜目前代理：${row.actingManager}` : "";
            lines.push(`• ${row.storeName}店｜${(row.reasons || []).join("、")}${ownerText}`);
        });
        if (dataIssueCount > dataIssues.length) {
            lines.push(`• 另有 ${dataIssueCount - dataIssues.length} 家資料待補`);
        }
    }

    const expiringDelegations = Array.isArray(summary?.delegationsExpiringSoon) ? summary.delegationsExpiringSoon : [];
    if (expiringDelegations.length > 0) {
        lines.push("", "⏰ 代理安排即將到期：");
        expiringDelegations.slice(0, 5).forEach((item) => {
            const timing = item.daysRemaining === 0 ? "今天到期" : `${item.daysRemaining} 天後到期`;
            lines.push(`• ${item.delegateName} 代理 ${item.principalName}｜${item.endDate}（${timing}）`);
        });
    }

    const reportCount = Number(summary?.dataQuality?.reportedStoreCount || 0);
    const targetCount = Number(summary?.dataQuality?.targetedStoreCount || 0);
    lines.push("", `資料完整度：日報 ${reportCount}/${activeStoreCount}｜現金目標 ${targetCount}/${activeStoreCount}`);

    if (excludedStoreCount > 0) {
        const names = Array.isArray(summary?.excludedStores) ? summary.excludedStores.slice(0, 6) : [];
        lines.push(`排除規則：已排除 ${excludedStoreCount} 家${names.length ? `（${names.join("、")}${excludedStoreCount > names.length ? "…" : ""}）` : ""}`);
    }
    if (Number(summary?.unexpectedReportStoreCount || 0) > 0) {
        const names = Array.isArray(summary?.unexpectedReportStores) ? summary.unexpectedReportStores.slice(0, 5) : [];
        lines.push(`⚠️ 資料治理：${summary.unexpectedReportStoreCount} 家非正式納管店家仍有資料，已不納入巡察${names.length ? `（${names.join("、")}）` : ""}`);
    }
    if (summary?.rosterIssue) {
        lines.push("⚠️ 正式組織架構沒有可納管店家，請先檢查 org_structure。");
    }

    lines.push("", `查詢負載：約 ${ctx?.readCount || 0} 筆文件讀取｜固定規則引擎，未使用 Gemini`);
    return lines.join("\n").slice(0, 3900);
}

async function buildTelegramActiveAlertMessages(config, actor = "scheduled") {
    const normalized = normalizeTelegramActiveAlertConfig(config);
    const now = getTelegramAlertTaipeiClock();
    const brandMessages = [];

    const sharedPolicyCtx = createTelegramAgentContext({
        chatId: `${actor}:shared-policy`,
        userId: actor,
        question: "active alerts:shared policy catalog",
    });
    await loadTelegramAgentPolicyState(sharedPolicyCtx, { skipPermission: true });

    for (const [brandIndex, brandId] of normalized.brandIds.entries()) {
        const brand = getTelegramAgentBrandLabel(brandId);
        const brandProfile = normalized.brandProfiles[brandId] || createTelegramActiveAlertDefaultBrandProfile();
        const ctx = createTelegramAgentContext({
            chatId: `${actor}:${brandId}`,
            userId: actor,
            question: `active alerts:${brandId}`,
        });
        ctx.policyCatalog = sharedPolicyCtx.policyCatalog;
        ctx.policyCatalogMode = sharedPolicyCtx.policyCatalogMode;
        applyTelegramAgentPolicyState(ctx, sharedPolicyCtx.policyCatalog, sharedPolicyCtx.policyPermission, { includeInactive: false });
        recordTelegramAgentRead(ctx, 0, "telegram_agent_policies", { cacheHit: true, sharedCatalog: true });

        if (brandIndex === 0 && sharedPolicyCtx.readCount > 0) {
            ctx.readCount += sharedPolicyCtx.readCount;
            ctx.sources.unshift(...sharedPolicyCtx.sources);
        }

        const result = await getOperationalAlerts(
            now.yearMonth,
            brand,
            brandProfile.limit,
            ctx,
            brandProfile.rules
        );

        // 每日主動巡察的「店家日報缺漏」應以已完整結束的前一日為口徑，
        // 不能只依本月是否曾出現日報資料判斷；並沿用 getMissingReports 的職務代理責任資訊。
        const dailyMissingReportDate = shiftTelegramAgentDate(now.todayStr, -1);
        const shouldCheckDailyMissingReports = brandProfile.rules?.missingReport?.enabled === true;
        const dailyMissingResult = shouldCheckDailyMissingReports
            ? await getMissingReports(
                dailyMissingReportDate,
                dailyMissingReportDate,
                brand,
                ctx,
                ["data_audit", "active_alert"]
            )
            : null;
        const dailyMissingBrand = Array.isArray(dailyMissingResult?.brands) ? dailyMissingResult.brands[0] : null;
        const dailyMissingDetails = Array.isArray(dailyMissingBrand?.missingDetails)
            ? dailyMissingBrand.missingDetails
            : [];
        const dailyMissingStores = Array.isArray(dailyMissingBrand?.missingStores)
            ? dailyMissingBrand.missingStores
            : [];
        const dailyMissingReports = dailyMissingDetails.length > 0
            ? dailyMissingDetails
            : dailyMissingStores.map((storeName) => ({ storeName, officialManager: "未分配", actingManager: "" }));
        result.dailyMissingReportDate = dailyMissingReportDate;
        result.dailyMissingReports = dailyMissingReports;
        result.dailyMissingReportCount = dailyMissingReports.length;

        const summary = Array.isArray(result.brandSummaries) ? result.brandSummaries[0] : null;
        const operationalAlertCount = Number(result.operationalAlertCount || 0);
        const dataIssueCount = Number(result.dataIssueCount || 0);
        const dailyMissingReportCount = Number(result.dailyMissingReportCount || 0);
        const governanceIssueCount = Number(summary?.unexpectedReportStoreCount || 0)
            + (summary?.rosterIssue ? 1 : 0)
            + Number(summary?.delegationExpiryReminderCount || 0);
        const alertCount = operationalAlertCount + dataIssueCount + dailyMissingReportCount;
        const enabledRuleLabels = Array.isArray(result.enabledRuleLabels)
            ? result.enabledRuleLabels
            : getTelegramActiveAlertEnabledRuleLabels(brandProfile.rules);
        brandMessages.push({
            brandId,
            brand,
            brandProfile: { ...brandProfile, limit: result.perBrandLimit || brandProfile.limit },
            enabledRuleLabels,
            ctx,
            result,
            summary,
            operationalAlertCount,
            dataIssueCount,
            dailyMissingReportCount,
            governanceIssueCount,
            alertCount,
            shouldSend: normalized.sendWhenClear || alertCount > 0 || governanceIssueCount > 0,
            message: formatTelegramAgentActiveAlertMessage(result, ctx, now.todayStr, brandProfile),
        });
    }

    return {
        config: normalized,
        now,
        brandMessages,
        alertCount: brandMessages.reduce((sum, item) => sum + item.alertCount, 0),
        operationalAlertCount: brandMessages.reduce((sum, item) => sum + item.operationalAlertCount, 0),
        dataIssueCount: brandMessages.reduce((sum, item) => sum + item.dataIssueCount, 0),
        dailyMissingReportCount: brandMessages.reduce((sum, item) => sum + Number(item.dailyMissingReportCount || 0), 0),
        readCount: brandMessages.reduce((sum, item) => sum + Number(item.ctx?.readCount || 0), 0),
        previewText: brandMessages.map((item) => item.message).join("\n\n━━━━━━━━━━━━━━━━\n\n"),
    };
}


async function createTelegramAlertTaskKeyboard(item, chatId) {
    const alerts = Array.isArray(item?.result?.alerts) ? item.result.alerts.slice(0, 3) : [];
    if (!alerts.length) return null;
    const rows = [];
    for (const alert of alerts) {
        const ref = getTelegramAgentTaskDraftsRef().doc();
        const task = normalizeTelegramTask({
            title: `改善 ${item.brand} ${normalizeSummaryCoreName(alert.storeName)}店營運警示`,
            description: `巡察原因：${(alert.reasons || []).join("、") || "符合目前營運預警規則"}`,
            brandId: item.brandId,
            storeName: normalizeSummaryCoreName(alert.storeName),
            ownerName: alert.taskOwnerName || alert.manager || "待指派",
            officialManager: alert.manager || "",
            actingManager: alert.actingManager || "",
            delegationId: alert.delegationId || "",
            dueDate: shiftTelegramAgentDate(getTelegramAlertTaipeiClock().todayStr, 3),
            targetText: "解除目前紅燈／黃燈原因，並回報改善措施與結果。",
            status: "open",
            priority: alert.severity === "critical" ? "critical" : "high",
            sourceType: "active_alert",
            sourceAlertId: `${item.brandId}:${normalizeSummaryCoreName(alert.storeName)}:${getTelegramAlertTaipeiClock().todayStr}`,
            sourceSnapshotId: String(item.snapshotId || ""),
            sourcePolicyIds: item.ctx?.activePolicyIds || [],
            baseline: {
                capturedAtText: new Date().toISOString(),
                severity: String(alert.severity || "watch"),
                cashAchievementRate: alert.cashAchievementRate === null || alert.cashAchievementRate === undefined ? null : Number(alert.cashAchievementRate),
                cash: Number(alert.cash || 0),
                cashTarget: Number(alert.cashTarget || alert.budget || 0),
                reasons: Array.isArray(alert.reasons) ? alert.reasons.slice(0, 20) : [],
            },
            createdByUserId: "notificationPatrol",
            createdByName: "主動巡察",
            createdByChatId: String(chatId || ""),
        });
        await ref.create({
            schemaVersion: TELEGRAM_V5_SCHEMA_VERSION,
            task,
            expiresAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAtText: new Date().toISOString(),
        });
        rows.push([{
            text: `建立 ${task.storeName}店改善任務`.slice(0, 40),
            callback_data: `task_alert:${ref.id}`.slice(0, 64),
        }]);
    }
    return rows.length ? { inline_keyboard: rows } : null;
}

exports.telegramAgentDailyPatrol = onSchedule({
    schedule: "*/5 * * * *",
    timeZone: "Asia/Taipei",
    secrets: [TELEGRAM_BOT_TOKEN_SECRET],
    timeoutSeconds: 180,
    memory: "512MiB",
}, async () => {
    const configSnap = await getTelegramActiveAlertConfigRef().get();
    if (!configSnap.exists) return;
    const config = normalizeTelegramActiveAlertConfig(configSnap.data() || {});
    const now = getTelegramAlertTaipeiClock();
    const dueCheck = isTelegramAlertDue(config, now);
    if (!dueCheck.due) return;

    const statusRef = getTelegramActiveAlertStatusRef();
    const statusSnap = await statusRef.get();
    const previousStatus = statusSnap.exists ? (statusSnap.data() || {}) : {};
    const sentKey = `${now.todayStr}|${config.sendTime}`;
    const brandSentKeys = { ...(previousStatus.brandSentKeys || {}) };
    const pendingBrandIds = config.brandIds.filter((brandId) => brandSentKeys[brandId] !== sentKey);
    if (pendingBrandIds.length === 0) return;

    const chatIds = resolveTelegramActiveAlertChatIds(config);
    if (chatIds.length === 0) throw new Error("尚未選擇有效的 Telegram 接收群組");

    const built = await buildTelegramActiveAlertMessages({ ...config, brandIds: pendingBrandIds }, "scheduled");
    const brandResults = { ...(previousStatus.brandResults || {}) };
    const errors = [];
    let sentAny = false;

    for (const item of built.brandMessages) {
        if (!item.shouldSend) {
            brandSentKeys[item.brandId] = sentKey;
            brandResults[item.brandId] = {
                brand: item.brand,
                runKey: sentKey,
                status: "clear_not_sent",
                alertCount: item.alertCount,
                operationalAlertCount: item.operationalAlertCount,
                dataIssueCount: item.dataIssueCount,
                dailyMissingReportCount: item.dailyMissingReportCount,
                readCount: Number(item.ctx?.readCount || 0),
                limit: Number(item.brandProfile?.limit || 0),
                enabledRuleLabels: item.enabledRuleLabels || [],
                checkedAtText: new Date().toISOString(),
            };
            continue;
        }

        try {
            const alertSnapshot = await createTelegramReportSnapshot({
                reportType: "active_alert",
                scheduleName: `${item.brand} 主動戰情巡察`,
                runKey: sentKey,
                cutoffDate: now.todayStr,
                cutoffAtText: `${now.todayStr} ${now.timeText} Asia/Taipei`,
                policyIds: item.ctx?.activePolicyIds || [],
                brandPayloads: { [item.brandId]: item.summary || {} },
                rankingPayload: {
                    alerts: Array.isArray(item.result?.alerts) ? item.result.alerts.slice(0, 20) : [],
                    dataIssues: Array.isArray(item.result?.dataIssues) ? item.result.dataIssues.slice(0, 20) : [],
                    dailyMissingReportDate: String(item.result?.dailyMissingReportDate || ""),
                    dailyMissingReports: Array.isArray(item.result?.dailyMissingReports) ? item.result.dailyMissingReports.slice(0, 100) : [],
                },
                messagePreview: item.message,
                sourceMeta: item.result?.source_meta || [],
                readCount: Number(item.ctx?.readCount || 0),
                createdBy: "telegramAgentDailyPatrol",
            });
            item.snapshotId = alertSnapshot.snapshotId;
            const alertMessage = `${String(item.message || "").slice(0, 3450)}

資料截止：${alertSnapshot.cutoffAtText}
報表快照：${alertSnapshot.snapshotId}｜口徑：${alertSnapshot.metricVersion}`.slice(0, 3900);
            const taskKeyboard = await createTelegramAlertTaskKeyboard(item, chatIds[0]);
            await Promise.all(chatIds.map((id) => sendTelegramMessage(
                id,
                alertMessage,
                taskKeyboard ? { reply_markup: taskKeyboard } : {}
            )));
            sentAny = true;
            brandSentKeys[item.brandId] = sentKey;
            brandResults[item.brandId] = {
                brand: item.brand,
                runKey: sentKey,
                status: "sent",
                alertCount: item.alertCount,
                operationalAlertCount: item.operationalAlertCount,
                dataIssueCount: item.dataIssueCount,
                dailyMissingReportCount: item.dailyMissingReportCount,
                readCount: Number(item.ctx?.readCount || 0),
                limit: Number(item.brandProfile?.limit || 0),
                enabledRuleLabels: item.enabledRuleLabels || [],
                sentAtText: new Date().toISOString(),
                snapshotId: item.snapshotId || "",
                messagePreview: item.message.slice(0, 500),
            };
        } catch (error) {
            errors.push(`${item.brand}：${error.message}`);
            brandResults[item.brandId] = {
                brand: item.brand,
                runKey: sentKey,
                status: "error",
                alertCount: item.alertCount,
                operationalAlertCount: item.operationalAlertCount,
                dataIssueCount: item.dataIssueCount,
                dailyMissingReportCount: item.dailyMissingReportCount,
                readCount: Number(item.ctx?.readCount || 0),
                limit: Number(item.brandProfile?.limit || 0),
                enabledRuleLabels: item.enabledRuleLabels || [],
                error: error.message,
                errorAtText: new Date().toISOString(),
            };
        }
    }

    const allComplete = config.brandIds.every((brandId) => brandSentKeys[brandId] === sentKey);
    const currentResults = config.brandIds
        .map((brandId) => brandResults[brandId])
        .filter((item) => item && item.runKey === sentKey);
    const totalAlertCount = currentResults.reduce((sum, item) => sum + Number(item.alertCount || 0), 0);
    const totalOperationalAlertCount = currentResults.reduce((sum, item) => sum + Number(item.operationalAlertCount || 0), 0);
    const totalDataIssueCount = currentResults.reduce((sum, item) => sum + Number(item.dataIssueCount || 0), 0);
    const totalDailyMissingReportCount = currentResults.reduce((sum, item) => sum + Number(item.dailyMissingReportCount || 0), 0);
    const totalReadCount = currentResults.reduce((sum, item) => sum + Number(item.readCount || 0), 0);
    const hasCurrentSent = currentResults.some((item) => item.status === "sent");
    const status = errors.length > 0
        ? (hasCurrentSent ? "partial_error" : "error")
        : (hasCurrentSent ? "sent" : "clear_not_sent");

    await statusRef.set({
        status,
        lastSentKey: allComplete ? sentKey : String(previousStatus.lastSentKey || ""),
        brandSentKeys,
        brandResults,
        lastCheckedAtText: new Date().toISOString(),
        lastCheckedDate: now.todayStr,
        lastScheduledTime: config.sendTime,
        ...(sentAny ? { lastSentAtText: new Date().toISOString(), lastSentDate: now.todayStr, lastSentTime: config.sendTime } : {}),
        alertCount: totalAlertCount,
        operationalAlertCount: totalOperationalAlertCount,
        dataIssueCount: totalDataIssueCount,
        dailyMissingReportCount: totalDailyMissingReportCount,
        readCount: totalReadCount,
        chatTargets: config.chatTargets,
        brandIds: config.brandIds,
        lastError: errors.join("；"),
        lastErrorAtText: errors.length ? new Date().toISOString() : "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (errors.length > 0) throw new Error(errors.join("；"));
});

// SaaS 介面的「預覽」與「測試推播」透過 Firestore command document 觸發，
// 每個品牌會獨立產生一則訊息，測試推播也完全模擬正式排程。
exports.processTelegramAlertCommand = onDocumentCreated({
    document: `artifacts/${TELEGRAM_ALERT_APP_ID}/public/data/telegram_alert_commands/{commandId}`,
    secrets: [TELEGRAM_BOT_TOKEN_SECRET],
    timeoutSeconds: 180,
    memory: "512MiB",
}, async (event) => {
    const snap = event.data;
    if (!snap) return;
    const ref = snap.ref;
    const data = snap.data() || {};
    if (data.type !== "telegram_alert_command" || data.status !== "pending") return;

    try {
        await ref.set({ status: "processing", processingAtText: new Date().toISOString() }, { merge: true });
        const config = normalizeTelegramActiveAlertConfig(data.config || {});
        const built = await buildTelegramActiveAlertMessages(config, `command:${event.params.commandId}`);
        const action = String(data.action || "preview");
        let sentChatIds = [];
        const brandSendResults = {};

        if (action === "test") {
            sentChatIds = resolveTelegramActiveAlertChatIds(config);
            if (sentChatIds.length === 0) throw new Error("尚未選擇有效的 Telegram 接收群組");
            for (const item of built.brandMessages) {
                const testMessage = `🧪 測試推播（不影響正式排程）\n\n${item.message}`.slice(0, 3900);
                await Promise.all(sentChatIds.map((id) => sendTelegramMessage(id, testMessage)));
                brandSendResults[item.brandId] = { brand: item.brand, status: "sent", sentChatCount: sentChatIds.length };
            }
        }

        const brandPreviews = built.brandMessages.map((item) => ({
            brandId: item.brandId,
            brand: item.brand,
            previewText: item.message,
            alertCount: item.alertCount,
            operationalAlertCount: item.operationalAlertCount,
            dataIssueCount: item.dataIssueCount,
            dailyMissingReportCount: item.dailyMissingReportCount,
            readCount: Number(item.ctx?.readCount || 0),
            activeStoreCount: Number(item.summary?.activeStoreCount || 0),
            excludedStoreCount: Number(item.summary?.excludedStoreCount || 0),
            reportedStoreCount: Number(item.summary?.dataQuality?.reportedStoreCount || 0),
            targetedStoreCount: Number(item.summary?.dataQuality?.targetedStoreCount || 0),
            shouldSend: item.shouldSend,
            limit: Number(item.brandProfile?.limit || 0),
            enabledRuleLabels: item.enabledRuleLabels || [],
        }));

        await ref.set({
            status: "completed",
            completedAtText: new Date().toISOString(),
            previewText: built.previewText,
            brandPreviews,
            alertCount: built.alertCount,
            operationalAlertCount: built.operationalAlertCount,
            dataIssueCount: built.dataIssueCount,
            dailyMissingReportCount: built.dailyMissingReportCount,
            readCount: built.readCount,
            sentChatIds,
            brandSendResults,
            resultSummary: {
                expectedProgress: built.now ? getTelegramAgentExpectedProgress(built.now.yearMonth) : null,
                brandSummaries: built.brandMessages.map((item) => item.summary).filter(Boolean),
            },
        }, { merge: true });
        await getTelegramActiveAlertStatusRef().set({
            lastManualAction: action,
            lastManualActionAtText: new Date().toISOString(),
            lastManualAlertCount: built.alertCount,
            lastManualOperationalAlertCount: built.operationalAlertCount,
            lastManualDataIssueCount: built.dataIssueCount,
            lastManualDailyMissingReportCount: built.dailyMissingReportCount,
            lastManualReadCount: built.readCount,
            lastManualBrandResults: Object.fromEntries(
                brandPreviews.map((item) => [item.brandId, {
                    brand: item.brand,
                    status: action === "test" ? "sent" : "previewed",
                    alertCount: item.alertCount,
                    operationalAlertCount: item.operationalAlertCount,
                    dataIssueCount: item.dataIssueCount,
                    dailyMissingReportCount: item.dailyMissingReportCount,
                    readCount: item.readCount,
                    limit: item.limit,
                    enabledRuleLabels: item.enabledRuleLabels || [],
                }])
            ),
            lastManualOperator: String(data.operator || ""),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (error) {
        await ref.set({
            status: "error",
            errorMessage: error.message,
            completedAtText: new Date().toISOString(),
        }, { merge: true });
        console.error("Telegram alert command failed:", error);
    }
});


// ==========================================
// ★ 4. Telegram 動態定時推播巡邏員 v5
// 精準讀取目前分鐘規則、工作日晨報、不可變報表快照、執行去重。
// ==========================================
function shiftTelegramAgentDate(dateText, days) {
    const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
}

function createTelegramNotificationPolicyContext(sharedPolicyCtx, brandId, question) {
    const ctx = createTelegramAgentContext({
        chatId: `notificationPatrol:${brandId}`,
        userId: "notificationPatrol",
        question,
    });
    ctx.policyCatalog = sharedPolicyCtx.policyCatalog;
    ctx.policyCatalogMode = sharedPolicyCtx.policyCatalogMode;
    applyTelegramAgentPolicyState(ctx, sharedPolicyCtx.policyCatalog, sharedPolicyCtx.policyPermission, { includeInactive: false });
    recordTelegramAgentRead(ctx, 0, "telegram_agent_policies", { cacheHit: true, sharedCatalog: true });
    return ctx;
}

function appendTelegramScheduledDataFooter(message, result, ctx, snapshot = null) {
    const sourceLabels = {
        daily_reports_current_month_exact: "當月品牌限定即時店家日報",
        daily_reports_scoped: "品牌限定店家日報",
        daily_reports_month_fallback: "品牌限定整月日報 fallback",
        monthly_aggregated: "月彙總 fallback",
        verified_dashboard_summary: "已驗證歷史月結 Summary",
        therapist_daily_reports_scoped: "品牌限定管理師日報",
        therapist_daily_reports_current_month_exact: "當月品牌限定即時管理師日報",
    };
    const sourceMeta = Array.isArray(result?.source_meta) ? result.source_meta : [];
    const sourceText = [...new Set(sourceMeta.map((row) => {
        const raw = String(row.source || "");
        if (!raw) return "";
        if (sourceLabels[raw]) return sourceLabels[raw];
        if (raw.includes("org_structure") && raw.includes("daily_reports")) return "正式組織架構＋品牌限定店家日報";
        return raw.replace(/_/g, " ");
    }).filter(Boolean))].join("、") || "品牌限定即時資料";
    const policyText = Array.isArray(ctx?.activePolicyIds) && ctx.activePolicyIds.length > 0
        ? `｜已套用長期規則 ${[...new Set(ctx.activePolicyIds)].slice(0, 4).join("、")}`
        : "";
    const snapshotText = snapshot?.snapshotId
        ? `\n資料截止：${snapshot.cutoffAtText || snapshot.cutoffDate || "-"}\n報表快照：${snapshot.snapshotId}｜口徑：${snapshot.metricVersion || TELEGRAM_V5_METRIC_VERSION}`
        : "";
    return `${String(message || "").trim()}\n\n資料口徑：${sourceText}${policyText}${snapshotText}`.slice(0, 3900);
}

function isTelegramNotificationRuleActive(rule = {}) {
    return rule.isActive === true || String(rule.isActive || "").toLowerCase() === "true";
}

function normalizeTelegramNotificationRule(docSnap) {
    const data = docSnap?.data?.() || {};
    return normalizeTelegramScheduleRule({
        ...data,
        id: String(docSnap?.id || ""),
        ruleId: String(docSnap?.id || ""),
        rulePath: String(docSnap?.ref?.path || ""),
    }, String(docSnap?.id || ""));
}

async function loadTelegramNotificationRulesAtTime(timeString) {
    const normalizedTime = /^\d{2}:\d{2}$/.test(String(timeString || "")) ? String(timeString) : "";
    if (!normalizedTime) return [];
    const matchingRulesSnap = await getTelegramNotificationRulesRef()
        .where("time", "==", normalizedTime)
        .get();
    return matchingRulesSnap.docs
        .map(normalizeTelegramNotificationRule)
        .filter(isTelegramNotificationRuleActive)
        .sort((a, b) => {
            const createdDiff = String(a.createdAtText || "").localeCompare(String(b.createdAtText || ""));
            if (createdDiff !== 0) return createdDiff;
            return String(a.id || "").localeCompare(String(b.id || ""));
        });
}

async function claimTelegramNotificationRuleRun(rule, runKey) {
    const ref = getTelegramNotificationRulesRef().doc(String(rule.id));
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const data = snap.data() || {};
        if (String(data.lastRunKey || "") === String(runKey)) return false;
        tx.set(ref, {
            lastRunKey: String(runKey),
            lastRunStatus: "running",
            lastRunStartedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastRunStartedAtText: new Date().toISOString(),
        }, { merge: true });
        return true;
    });
}

async function finalizeTelegramNotificationRuleRun(ruleId, payload = {}) {
    await getTelegramNotificationRulesRef().doc(String(ruleId)).set({
        ...payload,
        lastRunCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastRunCompletedAtText: new Date().toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString(),
    }, { merge: true });
}

async function createTelegramReportSnapshot(payload = {}) {
    const ref = getTelegramReportSnapshotsRef().doc();
    const clock = getTelegramAlertTaipeiClock();
    const snapshotId = makeTelegramReadableCode("RPT", ref.id);
    const snapshot = {
        schemaVersion: TELEGRAM_V5_SCHEMA_VERSION,
        snapshotId,
        reportType: String(payload.reportType || "scheduled_report"),
        scheduleId: String(payload.scheduleId || ""),
        scheduleCode: String(payload.scheduleCode || ""),
        scheduleName: String(payload.scheduleName || ""),
        runKey: String(payload.runKey || ""),
        cutoffDate: String(payload.cutoffDate || clock.todayStr),
        cutoffAtText: String(payload.cutoffAtText || `${payload.cutoffDate || clock.todayStr} 23:59 Asia/Taipei`),
        metricVersion: String(payload.metricVersion || TELEGRAM_V5_METRIC_VERSION),
        policyIds: [...new Set((payload.policyIds || []).map(String).filter(Boolean))],
        brandPayloads: payload.brandPayloads || {},
        rankingPayload: payload.rankingPayload || null,
        dataQuality: payload.dataQuality || null,
        messagePreview: String(payload.messagePreview || "").slice(0, 3900),
        sourceMeta: Array.isArray(payload.sourceMeta) ? payload.sourceMeta.slice(0, 100) : [],
        readCount: Number(payload.readCount || 0),
        createdBy: String(payload.createdBy || "notificationPatrol"),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtText: new Date().toISOString(),
        immutable: true,
    };
    await ref.create(snapshot);
    return { id: ref.id, ...snapshot };
}

function buildTelegramWeekdayMorningBrief(rule, brandConfigs, dataByBrand, cutoffDate) {
    const expectedProgress = getTelegramMonthProgressAtDate(cutoffDate);
    const brandPayloads = {};
    const storeRows = [];
    const missingRows = [];
    const lines = [
        "📊 三品牌工作日營運晨報",
        `統計截止：${cutoffDate} 23:59｜月份時間進度 ${expectedProgress}%`,
        "",
    ];

    brandConfigs.forEach((brand) => {
        const data = dataByBrand[brand.id] || {};
        const overall = data.progressYesterday?.overall_summary || data.progress?.overall_summary || {};
        const cash = Number(overall.cash || 0);
        const accrual = Number(overall.accrual || 0);
        const cashTarget = Number(overall.budget || 0);
        const accrualTarget = Number(overall.accrualBudget || 0);
        const cashRate = cashTarget > 0 ? Number(((cash / cashTarget) * 100).toFixed(1)) : null;
        const accrualRate = accrualTarget > 0 ? Number(((accrual / accrualTarget) * 100).toFixed(1)) : null;
        const cashGap = cashRate === null ? null : Number((cashRate - expectedProgress).toFixed(1));
        const accrualGap = accrualRate === null ? null : Number((accrualRate - expectedProgress).toFixed(1));
        const detailRows = Array.isArray(data.yesterdayStores?.stores_details) ? data.yesterdayStores.stores_details : [];
        detailRows.forEach((row) => {
            const value = Number(row.cash || 0);
            if (!Number.isFinite(value)) return;
            storeRows.push({
                brandId: brand.id,
                brand: brand.name,
                storeName: normalizeSummaryCoreName(row.storeName),
                cash: value,
            });
        });
        const missingBrand = Array.isArray(data.missingReports?.brands) ? data.missingReports.brands[0] : null;
        const missing = Array.isArray(missingBrand?.missingStores) ? missingBrand.missingStores : [];
        const missingDetails = Array.isArray(missingBrand?.missingDetails) ? missingBrand.missingDetails : [];
        if (missingDetails.length > 0) {
            missingDetails.forEach((row) => missingRows.push({
                brandId: brand.id,
                brand: brand.name,
                storeName: normalizeSummaryCoreName(row.storeName),
                officialManager: row.officialManager || "未分配",
                actingManager: row.actingManager || "",
                delegationId: row.delegationId || "",
            }));
        } else {
            missing.forEach((storeName) => missingRows.push({ brandId: brand.id, brand: brand.name, storeName: normalizeSummaryCoreName(storeName) }));
        }
        brandPayloads[brand.id] = {
            brand: brand.name,
            cash,
            accrual,
            cashTarget,
            accrualTarget,
            cashAchievementRate: cashRate,
            accrualAchievementRate: accrualRate,
            expectedProgress,
            cashProgressGap: cashGap,
            accrualProgressGap: accrualGap,
            reportedStoreCount: detailRows.length,
            missingStoreCount: missing.length,
        };
        lines.push(`【${brand.name}】`);
        lines.push(`現金：$${cash.toLocaleString()}｜達成 ${cashRate === null ? "目標缺漏" : `${cashRate}%`}｜進度差 ${cashGap === null ? "-" : `${cashGap >= 0 ? "+" : ""}${cashGap}pp`}`);
        lines.push(`權責：$${accrual.toLocaleString()}｜達成 ${accrualRate === null ? "目標缺漏" : `${accrualRate}%`}｜進度差 ${accrualGap === null ? "-" : `${accrualGap >= 0 ? "+" : ""}${accrualGap}pp`}`);
        lines.push("");
    });

    const topCount = Math.max(1, Math.min(10, Number(rule.topCount || 3)));
    const bottomCount = Math.max(1, Math.min(10, Number(rule.bottomCount || 3)));
    const sorted = [...storeRows].sort((a, b) => b.cash - a.cash || `${a.brand}${a.storeName}`.localeCompare(`${b.brand}${b.storeName}`));
    const top = sorted.slice(0, topCount);
    const bottom = [...sorted].sort((a, b) => a.cash - b.cash || `${a.brand}${a.storeName}`.localeCompare(`${b.brand}${b.storeName}`)).slice(0, bottomCount);

    lines.push(`🏆 昨日現金業績最佳 ${topCount} 店`);
    top.forEach((row, index) => lines.push(`${index + 1}. ${row.brand} ${row.storeName}店｜$${row.cash.toLocaleString()}`));
    lines.push("", `⚠️ 昨日現金業績後 ${bottomCount} 店`);
    bottom.forEach((row, index) => lines.push(`${index + 1}. ${row.brand} ${row.storeName}店｜$${row.cash.toLocaleString()}`));

    if (rule.includeMissingReports !== false) {
        lines.push("", `資料完整度：昨日缺報 ${missingRows.length} 店`);
        if (missingRows.length) {
            lines.push(`缺報：${missingRows.slice(0, 12).map((row) => `${row.brand} ${row.storeName}店${row.actingManager ? `（代理：${row.actingManager}）` : ""}`).join("、")}${missingRows.length > 12 ? "…" : ""}`);
            lines.push("未回報店家不列入最佳／最差排行。");
        }
    }

    return {
        message: lines.join("\n").slice(0, 3500),
        brandPayloads,
        rankingPayload: { top, bottom },
        dataQuality: { missingReports: missingRows, reportedStoreCount: storeRows.length },
    };
}

function buildTelegramScheduledBrandMessage(rule, brand, brandData, yesterdayStr) {
    const ctx = brandData.ctx;
    let finalMessage = String(rule.template || "").replace(/{date}/g, yesterdayStr);
    let shouldSend = false;
    let sourceResult = null;

    if (rule.source === "top5_stores" && brandData.yesterdayStores) {
        const top5 = (brandData.yesterdayStores.stores_details || [])
            .map((row) => ({ name: `${normalizeSummaryCoreName(row.storeName)}店`, rev: Number(row.cash || 0) }))
            .filter((row) => Number.isFinite(row.rev) && row.rev > 0)
            .sort((a, b) => b.rev - a.rev)
            .slice(0, 5);
        if (top5.length > 0) {
            shouldSend = true;
            const badges = ["🥇", "🥈", "🥉", "4.", "5."];
            const top5Text = top5.map((row, idx) => `${badges[idx]} ${row.name} ($${row.rev.toLocaleString()})`).join("\n");
            finalMessage = (finalMessage || "{top5Stores}").replace(/{top5Stores}/g, `${top5Text}\n`);
            finalMessage = `🏢 *【${brand.name} 專屬戰報】*\n${finalMessage}`;
            sourceResult = brandData.yesterdayStores;
        }
    }
    if (rule.source === "unreported" && brandData.missingReports) {
        const missingBrand = Array.isArray(brandData.missingReports.brands) ? brandData.missingReports.brands[0] : null;
        const detail = Array.isArray(missingBrand?.missingStores) ? missingBrand.missingStores : [];
        const detailRows = Array.isArray(missingBrand?.missingDetails) ? missingBrand.missingDetails : [];
        if (detail.length > 0) {
            shouldSend = true;
            const missingText = (detailRows.length > 0 ? detailRows : detail.map((storeName) => ({ storeName })))
                .map((row) => `• ${normalizeSummaryCoreName(row.storeName)}店${row.actingManager ? `｜目前代理：${row.actingManager}` : ""}`)
                .join("\n");
            finalMessage = (finalMessage || "{missingStores}")
                .replace(/{missingStores}/g, missingText)
                .replace(/{missingCount}/g, String(detail.length));
            finalMessage = `🚨 *【${brand.name} 異常通報】*\n${finalMessage}`;
            sourceResult = brandData.missingReports;
        }
    }
    if (rule.source === "bottom5_stores") {
        const progressResult = rule.cutoffMode === "yesterday" ? brandData.progressYesterday : brandData.progress;
        const expectedProgress = getTelegramMonthProgressAtDate(rule.cutoffMode === "yesterday" ? yesterdayStr : getTelegramAlertTaipeiClock().todayStr);
        const bottom5 = (progressResult?.stores_details || [])
            .map((row) => {
                const cash = Number(row.cash || 0);
                const budget = Number(row.budget || 0);
                const rate = row.cashAchievementRate === null || row.cashAchievementRate === undefined
                    ? (budget > 0 ? Number(((cash / budget) * 100).toFixed(1)) : null)
                    : Number(row.cashAchievementRate);
                return {
                    name: `${normalizeSummaryCoreName(row.storeName)}店`,
                    cash,
                    budget,
                    rate,
                    gap: rate === null ? null : Number((rate - expectedProgress).toFixed(1)),
                };
            })
            .filter((row) => row.rate !== null)
            .sort((a, b) => a.rate - b.rate || a.cash - b.cash)
            .slice(0, 5);
        if (bottom5.length > 0) {
            shouldSend = true;
            const bottom5Text = bottom5
                .map((row, idx) => `${idx + 1}. ${row.name}｜達成 ${row.rate.toFixed(1)}%｜進度差 ${row.gap >= 0 ? "+" : ""}${row.gap}pp｜$${row.cash.toLocaleString()}`)
                .join("\n");
            finalMessage = (finalMessage || "{bottom5Stores}").replace(/{bottom5Stores}/g, `${bottom5Text}\n`);
            finalMessage = `⚠️ *【${brand.name} 現金進度關注名單】*\n${finalMessage}`;
            sourceResult = progressResult;
        }
    }
    if (rule.source === "top5_therapists" && brandData.therapists) {
        const top5T = (brandData.therapists.therapists_details || [])
            .map((row) => ({ ...row, revenue: Number(row.revenue || row.totalRevenue || 0) }))
            .filter((row) => Number.isFinite(row.revenue) && row.revenue > 0)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);
        if (top5T.length > 0) {
            shouldSend = true;
            const badges = ["🥇", "🥈", "🥉", "4.", "5."];
            const top5Text = top5T.map((row, idx) => `${badges[idx]} ${row.personName} (${normalizeSummaryCoreName(row.storeName)}店) - $${row.revenue.toLocaleString()}`).join("\n");
            finalMessage = (finalMessage || "{top5Therapists}").replace(/{top5Therapists}/g, `${top5Text}\n`);
            finalMessage = `🌟 *【${brand.name} 個人榮耀】*\n${finalMessage}`;
            sourceResult = brandData.therapists;
        }
    }
    if (rule.source === "progress") {
        const progressResult = rule.cutoffMode === "yesterday" ? brandData.progressYesterday : brandData.progress;
        if (!progressResult) return { shouldSend, finalMessage, sourceResult, ctx };
        const overall = progressResult.overall_summary || {};
        const cashTotal = Number(overall.cash || 0);
        const accrualTotal = Number(overall.accrual || 0);
        const cashTarget = Number(overall.budget || 0);
        const accrualTarget = Number(overall.accrualBudget || 0);
        const cashRate = cashTarget > 0 ? ((cashTotal / cashTarget) * 100).toFixed(1) : "0.0";
        const accrualRate = accrualTarget > 0 ? ((accrualTotal / accrualTarget) * 100).toFixed(1) : "0.0";
        if (cashTotal !== 0 || accrualTotal !== 0 || cashTarget > 0 || accrualTarget > 0) {
            shouldSend = true;
            finalMessage = (finalMessage || "現金 {cashTotal}（{cashRate}%）\n權責 {accrualTotal}（{accrualRate}%）")
                .replace(/{cashTotal}/g, cashTotal.toLocaleString())
                .replace(/{accrualTotal}/g, accrualTotal.toLocaleString())
                .replace(/{cashRate}/g, cashRate)
                .replace(/{accrualRate}/g, accrualRate);
            finalMessage = `📊 *【${brand.name} 本月累積進度】*\n${finalMessage}`;
            sourceResult = progressResult;
        }
    }
    return { shouldSend, finalMessage, sourceResult, ctx };
}

exports.notificationPatrol = onSchedule({
    schedule: "* * * * *",
    timeZone: "Asia/Taipei",
    secrets: [TELEGRAM_BOT_TOKEN_SECRET],
    timeoutSeconds: 240,
    memory: "512MiB",
}, async () => {
    const clock = getTelegramAlertTaipeiClock();
    const timeString = clock.timeText;
    const runKey = `${clock.todayStr}|${timeString}`;

    try {
        const rulesAtTime = await loadTelegramNotificationRulesAtTime(timeString);
        const rulesList = rulesAtTime.filter((rule) => isTelegramScheduleDueOnDay(rule, clock));
        if (rulesList.length === 0) {
            console.log(`目前時間 ${timeString} 查無符合工作日與啟用條件的任務。`);
            return;
        }

        const claimedRules = [];
        for (const rule of rulesList) {
            if (await claimTelegramNotificationRuleRun(rule, runKey)) claimedRules.push(rule);
        }
        if (!claimedRules.length) return;

        const sourceSet = new Set(claimedRules.map((rule) => String(rule.source || "")));
        const yesterdayStr = shiftTelegramAgentDate(clock.todayStr, -1);
        const monthStart = `${yesterdayStr.slice(0, 7)}-01`;
        const scheduledScopes = ["telegram_analysis", "ranking", "brand_totals", "active_alert"];
        const auditScopes = ["data_audit", "active_alert"];

        const sharedPolicyCtx = createTelegramAgentContext({
            chatId: "notificationPatrol:shared-policy",
            userId: "notificationPatrol",
            question: `notification patrol ${timeString}`,
        });
        await loadTelegramAgentPolicyState(sharedPolicyCtx, { skipPermission: true });

        const brandConfigs = [
            { id: "cyj", name: "DRCYJ" },
            { id: "anniu", name: "安妞" },
            { id: "yibo", name: "伊啵" },
        ];
        const dataByBrand = {};
        const needsBrief = sourceSet.has("weekday_morning_brief");
        const needsProgressCurrent = claimedRules.some((rule) => ["progress", "bottom5_stores"].includes(rule.source) && rule.cutoffMode === "current");
        const needsProgressYesterday = needsBrief || claimedRules.some((rule) => ["progress", "bottom5_stores"].includes(rule.source) && rule.cutoffMode === "yesterday");
        const hasAllBrandRule = needsBrief || claimedRules.some((rule) => !(rule.brandIds || []).length);
        const requestedBrandIds = new Set(claimedRules.flatMap((rule) => (rule.brandIds || []).map(normalizeTelegramAgentBrandId).filter(Boolean)));
        const dataBrandConfigs = hasAllBrandRule
            ? brandConfigs
            : brandConfigs.filter((brand) => requestedBrandIds.has(brand.id));

        await Promise.all(dataBrandConfigs.map(async (brand, index) => {
            const ctx = createTelegramNotificationPolicyContext(sharedPolicyCtx, brand.id, `scheduled reports:${brand.id}`);
            if (index === 0 && sharedPolicyCtx.readCount > 0) {
                ctx.readCount += sharedPolicyCtx.readCount;
                ctx.sources.unshift(...sharedPolicyCtx.sources);
            }
            const [progressCurrent, progressYesterday, yesterdayStores, missingReports, therapists] = await Promise.all([
                needsProgressCurrent ? getStorePerformance(`${clock.yearMonth}-01`, clock.todayStr, null, brand.name, ctx, scheduledScopes) : Promise.resolve(null),
                needsProgressYesterday ? getStorePerformance(monthStart, yesterdayStr, null, brand.name, ctx, scheduledScopes) : Promise.resolve(null),
                (sourceSet.has("top5_stores") || needsBrief) ? getStorePerformance(yesterdayStr, yesterdayStr, null, brand.name, ctx, scheduledScopes) : Promise.resolve(null),
                (sourceSet.has("unreported") || needsBrief) ? getMissingReports(yesterdayStr, yesterdayStr, brand.name, ctx, auditScopes) : Promise.resolve(null),
                sourceSet.has("top5_therapists") ? getTherapistPerformance(yesterdayStr, yesterdayStr, null, null, brand.name, ctx, [], scheduledScopes) : Promise.resolve(null),
            ]);
            dataByBrand[brand.id] = { ctx, progress: progressCurrent, progressYesterday, yesterdayStores, missingReports, therapists };
        }));

        for (const rule of claimedRules) {
            const chatId = resolveTelegramScheduleChatId(rule);
            try {
                if (rule.source === "weekday_morning_brief") {
                    const built = buildTelegramWeekdayMorningBrief(rule, brandConfigs, dataByBrand, yesterdayStr);
                    const readCount = Object.values(dataByBrand).reduce((sum, item) => sum + Number(item.ctx?.readCount || 0), 0);
                    const policyIds = Object.values(dataByBrand).flatMap((item) => item.ctx?.activePolicyIds || []);
                    const sourceMeta = Object.values(dataByBrand).flatMap((item) => item.progress?.source_meta || []);
                    const snapshot = await createTelegramReportSnapshot({
                        reportType: "weekday_morning_brief",
                        scheduleId: rule.id,
                        scheduleCode: rule.scheduleCode,
                        scheduleName: rule.name,
                        runKey,
                        cutoffDate: yesterdayStr,
                        cutoffAtText: `${yesterdayStr} 23:59 Asia/Taipei`,
                        policyIds,
                        brandPayloads: built.brandPayloads,
                        rankingPayload: built.rankingPayload,
                        dataQuality: built.dataQuality,
                        messagePreview: built.message,
                        sourceMeta,
                        readCount,
                    });
                    const message = `${built.message}\n\n資料截止：${snapshot.cutoffAtText}\n報表快照：${snapshot.snapshotId}｜口徑：${snapshot.metricVersion}`.slice(0, 3900);
                    await sendTelegramMessage(chatId, message);
                    await finalizeTelegramNotificationRuleRun(rule.id, {
                        lastRunStatus: "sent",
                        lastSnapshotId: snapshot.snapshotId,
                        lastSnapshotDocId: snapshot.id,
                        lastMessagePreview: message.slice(0, 800),
                    });
                    continue;
                }

                const ruleBrandSet = new Set((rule.brandIds || []).map(normalizeTelegramAgentBrandId).filter(Boolean));
                const targetBrandConfigs = ruleBrandSet.size
                    ? brandConfigs.filter((brand) => ruleBrandSet.has(brand.id))
                    : brandConfigs;
                const prepared = targetBrandConfigs
                    .map((brand) => ({ brand, ...buildTelegramScheduledBrandMessage(rule, brand, dataByBrand[brand.id] || {}, yesterdayStr) }))
                    .filter((item) => item.shouldSend);
                const brandPayloads = Object.fromEntries(prepared.map((item) => [item.brand.id, item.sourceResult?.overall_summary || item.sourceResult || {}]));
                const readCount = prepared.reduce((sum, item) => sum + Number(item.ctx?.readCount || 0), 0);
                const policyIds = prepared.flatMap((item) => item.ctx?.activePolicyIds || []);
                const snapshot = await createTelegramReportSnapshot({
                    reportType: rule.source,
                    scheduleId: rule.id,
                    scheduleCode: rule.scheduleCode,
                    scheduleName: rule.name,
                    runKey,
                    cutoffDate: rule.source === "progress" && rule.cutoffMode === "current" ? clock.todayStr : yesterdayStr,
                    cutoffAtText: rule.source === "progress" && rule.cutoffMode === "current" ? `${clock.todayStr} ${timeString} Asia/Taipei` : `${yesterdayStr} 23:59 Asia/Taipei`,
                    policyIds,
                    brandPayloads,
                    messagePreview: prepared.map((item) => item.finalMessage).join("\n\n"),
                    sourceMeta: prepared.flatMap((item) => item.sourceResult?.source_meta || []),
                    readCount,
                });
                for (const item of prepared) {
                    const messageWithFooter = appendTelegramScheduledDataFooter(item.finalMessage, item.sourceResult, item.ctx, snapshot);
                    await sendTelegramMessage(chatId, messageWithFooter, { parse_mode: "Markdown" });
                }
                await finalizeTelegramNotificationRuleRun(rule.id, {
                    lastRunStatus: prepared.length ? "sent" : "clear_not_sent",
                    lastSnapshotId: snapshot.snapshotId,
                    lastSnapshotDocId: snapshot.id,
                    lastMessagePreview: snapshot.messagePreview.slice(0, 800),
                });
            } catch (error) {
                console.error(`❌ 排程 ${rule.name || rule.id} 執行失敗：`, error);
                await finalizeTelegramNotificationRuleRun(rule.id, {
                    lastRunStatus: "error",
                    lastErrorMessage: String(error.message || error).slice(0, 1000),
                });
            }
        }
    } catch (error) {
        console.error("❌ notificationPatrol 執行錯誤：", error);
    }
});


exports.telegramTaskFollowUp = onSchedule({
    schedule: "0 9 * * 1-5",
    timeZone: "Asia/Taipei",
    secrets: [TELEGRAM_BOT_TOKEN_SECRET],
    timeoutSeconds: 120,
    memory: "256MiB",
}, async () => {
    const clock = getTelegramAlertTaipeiClock();
    const tasks = await loadTelegramTasks(null, { statuses: ["open", "in_progress", "overdue"], limit: 300 });
    for (const task of tasks) {
        if (!task.dueDate || task.lastReminderAtText?.slice(0, 10) === clock.todayStr) continue;
        const daysToDue = Math.round((Date.parse(`${task.dueDate}T00:00:00+08:00`) - Date.parse(`${clock.todayStr}T00:00:00+08:00`)) / 86400000);
        if (daysToDue > 1) continue;
        const isOverdue = daysToDue < 0;
        const nextStatus = isOverdue ? "overdue" : task.status;
        const targetChatId = task.ownerChatId || task.createdByChatId || TARGET_CHAT_ID_MANAGER;
        const message = [
            isOverdue ? "🚨 改善任務已逾期" : daysToDue === 0 ? "⏰ 改善任務今日到期" : "⏳ 改善任務明日到期",
            `${task.taskCode}｜${task.title}`,
            `${task.brand || ""}${task.storeName ? ` ${task.storeName}店` : ""}`,
            `負責人：${task.ownerName || "待指派"}｜期限：${task.dueDate}`,
            task.targetText ? `目標：${task.targetText}` : "",
        ].filter(Boolean).join("\n");
        try {
            await sendTelegramMessage(targetChatId, message, {
                reply_markup: buildTelegramV5InlineKeyboard({ task }),
            });
            await getTelegramAgentTasksRef().doc(task.id).set({
                status: nextStatus,
                reminderCount: admin.firestore.FieldValue.increment(1),
                lastReminderAt: admin.firestore.FieldValue.serverTimestamp(),
                lastReminderAtText: new Date().toISOString(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAtText: new Date().toISOString(),
            }, { merge: true });
            await writeTelegramTaskAudit(isOverdue ? "overdue_reminder" : "due_reminder", { ...task, status: nextStatus }, { source: "telegramTaskFollowUp" });
        } catch (error) {
            console.error(`Task reminder failed ${task.taskCode}:`, error.message);
        }
    }
});

// ==========================================
// ★ 5. 自動人數計數器：監控人員增減並更新公佈欄
// ==========================================

async function handleUserCountChange(change) {
  const isDocCreated = !change.before.exists && change.after.exists;
  const isDocDeleted = change.before.exists && !change.after.exists;
  if (!isDocCreated && !isDocDeleted) return null; 

  const statsRef = db.collection("public_info").doc("stats");
  const increment = isDocCreated ? 1 : -1;

  return statsRef.set({
    totalUsers: admin.firestore.FieldValue.increment(increment)
  }, { merge: true });
}

exports.onLegacyTherapistChange = functions.firestore.document("artifacts/{appId}/public/data/therapists/{id}").onWrite(async (change) => handleUserCountChange(change));
exports.onBrandTherapistChange = functions.firestore.document("brands/{brandId}/therapists/{id}").onWrite(async (change) => handleUserCountChange(change));
exports.onManagerChange = functions.firestore.document("artifacts/{appId}/public/data/managers/{id}").onWrite(async (change) => handleUserCountChange(change));
exports.onBrandManagerChange = functions.firestore.document("brands/{brandId}/managers/{id}").onWrite(async (change) => handleUserCountChange(change));

exports.onStoreAccountChange = functions.firestore.document("brands/{brandId}/settings/store_account_data").onWrite(async (change) => {
     const beforeData = change.before.data() || {};
     const afterData = change.after.data() || {};
     const beforeCount = (beforeData.accounts || []).length;
     const afterCount = (afterData.accounts || []).length;
     const diff = afterCount - beforeCount;
     if (diff === 0) return null;
     return db.collection("public_info").doc("stats").set({ totalUsers: admin.firestore.FieldValue.increment(diff) }, { merge: true });
});

exports.onManagerAuthChange = functions.firestore.document("brands/{brandId}/settings/manager_auth").onWrite(async (change) => {
     const beforeData = change.before.data() || {};
     const afterData = change.after.data() || {};
     const beforeCount = Object.keys(beforeData).length;
     const afterCount = Object.keys(afterData).length;
     const diff = afterCount - beforeCount;
     if (diff === 0) return null;
     return db.collection("public_info").doc("stats").set({ totalUsers: admin.firestore.FieldValue.increment(diff) }, { merge: true });
});

// ==========================================
// ★ 6. 終極盤點機
// ==========================================
exports.calibrateUserCount = onRequest(async (req, res) => {
    try {
        let totalCount = 0;
        const therapistsSnap = await db.collectionGroup('therapists').get();
        therapistsSnap.forEach(() => { totalCount++; });
        const managersSnap = await db.collectionGroup('managers').get();
        managersSnap.forEach(() => { totalCount++; });
        const settingsSnap = await db.collectionGroup('settings').get();
        settingsSnap.forEach(doc => {
            if (doc.id === 'store_account_data') { totalCount += (doc.data().accounts || []).length; }
            if (doc.id === 'manager_auth') { totalCount += Object.keys(doc.data() || {}).length; }
        });
        await db.collection("public_info").doc("stats").set({ totalUsers: totalCount }, { merge: true });
        res.status(200).send(`<h2 style="color: #4CAF50;">🎉 盤點完成！系統中共 ${totalCount} 個帳號。</h2>`);
    } catch (error) { res.status(500).send("❌ 錯誤: " + error.message); }
});

// ==========================================
// ★ 7. 深夜精算師 5.0
// ==========================================
exports.calculateHistoricalProjectionCurve = onSchedule({ schedule: "0 3 1 * *", timeZone: "Asia/Taipei", timeoutSeconds: 540, memory: "1GiB" }, async (event) => {
    const brands = ['cyj', 'anniu', 'yibo'];
    const today = new Date();
    const pastMonths = [];
    for (let i = 1; i <= 3; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        pastMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    for (const brand of brands) {
        try {
            let storeDowData = { "BRAND_TOTAL": {} };
            for(let i=0; i<7; i++) storeDowData["BRAND_TOTAL"][i] = { cash: [], accrual: [] };
            for (const targetMonth of pastMonths) {
                const reportsRef = db.collection("brands").doc(brand).collection("daily_reports");
                const reportsSnap = await reportsRef.where("date", ">=", `${targetMonth}-01`).where("date", "<=", `${targetMonth}-31`).get();
                reportsSnap.forEach(doc => {
                    const data = doc.data();
                    const store = data.storeName || data.store || "未知店";
                    const cash = Number(data.cash) || 0;
                    const accrual = Number(data.accrual) || 0;
                    const dow = new Date(data.date).getDay();
                    if (!storeDowData[store]) {
                        storeDowData[store] = {};
                        for(let i=0; i<7; i++) storeDowData[store][i] = { cash: [], accrual: [] };
                    }
                    storeDowData[store][dow].cash.push(cash);
                    storeDowData[store][dow].accrual.push(accrual);
                    storeDowData["BRAND_TOTAL"][dow].cash.push(cash);
                    storeDowData["BRAND_TOTAL"][dow].accrual.push(accrual);
                });
            }
            const curveRef = db.collection("brands").doc(brand).collection("settings").doc("projection_curves").collection("stores");
            const processList = (list) => {
                if (list.length > 2) {
                    const sorted = [...list].sort((a,b)=>a-b);
                    const mid = Math.floor(sorted.length/2);
                    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
                    const avg = list.reduce((a,b)=>a+b,0)/list.length;
                    const threshold = Math.max(median * 4, avg * 2.5, 100000); 
                    list = list.filter(v => v <= threshold);
                }
                return list.length > 0 ? Math.round(list.reduce((a,b)=>a+b,0)/list.length) : 0;
            };
            for (const [storeName, dowMap] of Object.entries(storeDowData)) {
                let cashAverages = {}; let accrualAverages = {};
                for (let i = 0; i < 7; i++) {
                    cashAverages[i] = processList(dowMap[i].cash);
                    accrualAverages[i] = processList(dowMap[i].accrual);
                }
                const docId = storeName === "BRAND_TOTAL" ? "BRAND_TOTAL" : storeName.replace(/\s+/g, '').toLowerCase();
                await curveRef.doc(docId).set({ storeName, cashAverages, accrualAverages, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
            }
            console.log(`✅ [${brand}] 更新完畢！`);
        } catch (error) { console.error(`❌ [${brand}] 更新失敗:`, error); }
    }
});

// ==========================================
// ★ 8. V5 終極除垢清道夫
// ==========================================
exports.healTherapistData = onRequest(async (req, res) => {
    try {
        let batch = db.batch(); let commitCount = 0; let reportCount = 0, scheduleCount = 0;
        const commitAndReset = async () => { if (commitCount > 0) { await batch.commit(); batch = db.batch(); commitCount = 0; } };

        const reportsSnap = await db.collectionGroup('therapist_daily_reports').get();
        for (const doc of reportsSnap.docs) {
            const data = doc.data(); let updateData = {}; let changed = false;
            if (data.totalRevenue !== undefined) {
                let cleanRev = data.totalRevenue;
                if (typeof cleanRev === 'string') cleanRev = Number(cleanRev.replace(/[^0-9.-]+/g, ""));
                const finalRev = Number(cleanRev) || 0;
                if (data.totalRevenue !== finalRev) { updateData.totalRevenue = finalRev; updateData.cash = finalRev; changed = true; }
            }
            if (changed) { batch.update(doc.ref, updateData); commitCount++; reportCount++; if (commitCount >= 400) await commitAndReset(); }
        }

        const schedulesSnap = await db.collectionGroup('therapist_schedules').get();
        for (const doc of schedulesSnap.docs) {
            const data = doc.data(); let updateData = {}; let changed = false;
            if (data.daysOff && Array.isArray(data.daysOff)) {
                const cleanDaysOff = data.daysOff.map(d => {
                    if (typeof d === 'object' && d !== null) return Number(d.day || d.date || d.value || 0);
                    if (typeof d === 'string' && d.includes('-')) return d; 
                    return Number(d) || 0;
                }).filter(d => d !== 0); 
                if (JSON.stringify(data.daysOff) !== JSON.stringify(cleanDaysOff)) { updateData.daysOff = cleanDaysOff; changed = true; }
            }
            if (changed) { batch.update(doc.ref, updateData); commitCount++; scheduleCount++; if (commitCount >= 400) await commitAndReset(); }
        }
        await commitAndReset();
        res.status(200).send(`<h2>✅ 格式洗淨完成</h2><p>日報: ${reportCount}, 班表: ${scheduleCount}</p>`);
    } catch (error) { res.status(500).send("❌ 錯誤: " + error.message); }
});
// ★ 9. 全局數據校準器 (支援 CYJ 與各品牌)
exports.recalculateMonthlyData = onRequest({ cors: true }, async (req, res) => {
    // ... 下面都不要動，維持原本的程式碼
    const brandId = req.query.brandId || 'cyj'; // 預設撈 cyj
    const yearMonth = req.query.yearMonth || '2026-04';
    
    try {
        let dailyReportsRef;
        let aggRef;

        // ★ 邏輯分流：自動辨識是 CYJ 還是其他品牌
        if (brandId === 'cyj' || brandId === 'default-app-id') {
            dailyReportsRef = db.collection('artifacts/default-app-id/public/data/daily_reports');
            aggRef = db.collection('artifacts/default-app-id/public/data/monthly_aggregated');
        } else {
            dailyReportsRef = db.collection('brands').doc(brandId).collection('daily_reports');
            aggRef = db.collection('brands').doc(brandId).collection('monthly_aggregated');
        }

        // 1. 取得該路徑下該月份所有日報
        const reportsSnap = await dailyReportsRef
            .where('date', '>=', `${yearMonth}-01`).where('date', '<=', `${yearMonth}-31`).get();
            
        // 2. 累加邏輯
        let storeTotals = {};
        reportsSnap.forEach(doc => {
            const data = doc.data();
            const rawStoreName = data.storeName;
            if (!rawStoreName) return;

            // 與即時 aggregate trigger 使用同一個 CYJ 新店 canonical 規則。
            // 其他店家不改名，避免在既有資料上製造新的 aggregate key。
            const sName = (brandId === 'cyj' || brandId === 'default-app-id')
                ? getMonthlyAggregationCanonicalStoreName(
                    rawStoreName,
                    'artifacts/default-app-id/public/data/monthly_aggregated'
                  )
                : rawStoreName;

            if (!storeTotals[sName]) {
                storeTotals[sName] = { newCustomers: 0, cash: 0, accrual: 0, count: 0 };
            }
            storeTotals[sName].newCustomers += (Number(data.newCustomers) || 0);
            storeTotals[sName].cash += (Number(data.cash) || 0) - (Number(data.refund) || 0);
            storeTotals[sName].accrual += (Number(data.accrual) || 0);
            storeTotals[sName].count += 1;
        });

        // 3. 寫入目標路徑
        let batch = db.batch();
        let updateCount = 0;
        for (const [sName, totals] of Object.entries(storeTotals)) {
            const key = `${yearMonth}_${sName}`;
            batch.set(aggRef.doc(key), {
                id: key,
                yearMonth: yearMonth,
                storeName: sName,
                newCustomers: totals.newCustomers,
                cash: totals.cash,
                accrual: totals.accrual,
                recordCount: totals.count,
                lastCalibrated: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            updateCount++;
        }
        await batch.commit();

        res.send(`✅ 校準完成！[${brandId}] ${yearMonth}，共更新 ${updateCount} 家店鋪數據。`);
    } catch (err) { res.status(500).send("❌ 錯誤: " + err.message); }
});


// ==========================================
// ★ 10. Dashboard Summary 自動修復 Worker
// Queue 節流安全修正版：flags 維持每 5 分鐘；queue fallback 平時每 30 分鐘分頁 50 筆，backlog 期間每 5 分鐘續頁。
// 目的：處理 summary_recalc_flags 裡已到時間的 dirty 月份。
// 手動測試入口：repairDirtySummaryNow?brandId=cyj&yearMonth=2026-05
// 自動排程：每 5 分鐘巡檢一次。
// ==========================================

const SUMMARY_REPAIR_BRANDS = ["cyj", "anniu", "yibo"];

// ★ 品牌正式進入本系統的 Summary 自動修復起始月。
// 這不是品牌成立日期，而是「自此月份起，歷史資料才允許被自動 Summary Repair 處理」的安全下限。
// 伊啵於 2026-01～2026-03 尚未正式使用本系統，因此這些月份若殘留舊 flag / queue，
// 應直接結案為 pre-system month，不能每 5 分鐘反覆讀完整 monthly_targets 後再失敗。
// 僅先鎖定已確認案例；其他品牌維持既有行為，避免擴大影響範圍。
const SUMMARY_REPAIR_DATA_START_MONTH = Object.freeze({
  yibo: "2026-04",
});

function getSummaryRepairDataStartMonth(brandId = "") {
  const normalizedBrandId = getBackendDirtyBrandId(brandId);
  const yearMonth = String(SUMMARY_REPAIR_DATA_START_MONTH[normalizedBrandId] || "").trim();
  return /^\d{4}-\d{2}$/.test(yearMonth) ? yearMonth : "";
}

function isBeforeSummaryRepairDataStartMonth(brandId = "", yearMonth = "") {
  const normalizedYearMonth = String(yearMonth || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalizedYearMonth)) return false;
  const startMonth = getSummaryRepairDataStartMonth(brandId);
  return Boolean(startMonth && normalizedYearMonth < startMonth);
}

// Queue fallback 是「防漏保險」，不是正常主流程。
// 正常歷史異動由 summary_recalc_flags 每 5 分鐘即時處理；
// fallback 平時每 30 分鐘分頁巡檢 50 筆；若尚有下一頁則暫時每 5 分鐘續掃，快速消化既有 backlog。
// 保留舊資料／漏寫 flag 的補救能力，同時避免平時每 5 分鐘全掃 500 筆。
const SUMMARY_QUEUE_FALLBACK_LIMIT = 50;
const SUMMARY_QUEUE_FALLBACK_INTERVAL_MS = 30 * 60 * 1000;
const SUMMARY_QUEUE_FALLBACK_CATCHUP_INTERVAL_MS = 5 * 60 * 1000;
const SUMMARY_QUEUE_FALLBACK_NO_PROGRESS_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SUMMARY_QUEUE_FALLBACK_STATE_DOC = "recalc_queue_fallback_scan";

function getTaipeiYearForAnnualKpiSummary() {
  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return taipei.getUTCFullYear();
}

function getAnnualKpiSummaryCandidateMonths(yearInput) {
  const year = Number(yearInput) || getTaipeiYearForAnnualKpiSummary();
  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const currentYear = taipei.getUTCFullYear();
  const currentMonth = taipei.getUTCMonth() + 1;
  const lastCompletedMonth = year === currentYear ? currentMonth - 1 : (year < currentYear ? 12 : 0);

  if (lastCompletedMonth <= 0) return [];

  return Array.from({ length: lastCompletedMonth }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    return `${year}-${month}`;
  });
}

function normalizeAnnualKpiStoreCore(value = "", brandLabel = "") {
  const prefix = String(brandLabel || "").trim();
  let core = String(value || "")
    .trim()
    .replace(/[　\s]+/g, "")
    .replace(/[（）()]/g, "")
    .replace(/^DRCYJ/i, "CYJ")
    .replace(/^(CYJ|Anew安妞|Yibo伊啵|Anew|Yibo|安妞|伊啵)/i, "");

  if (prefix) {
    core = core.replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), "");
  }

  // CYJ 新店是正式店名，不能把「新店」誤裁成「新」。
  if (core === "新" || /^新店店?$/.test(core)) return "新店";

  return core
    .replace(/臺/g, "台")
    .replace(/店$/, "")
    .trim();
}

function getAnnualKpiStoreCoreFromSummaryEntry(key = "", store = {}, brandLabel = "") {
  const candidates = [
    key,
    store?.__canonicalStoreName,
    store?.storeName,
    store?.store,
    store?.displayName,
    store?.name,
    store?.id,
  ];

  for (const item of candidates) {
    const core = normalizeAnnualKpiStoreCore(item, brandLabel);
    if (core) return core;
  }

  return "";
}

function toAnnualKpiStoreRows(stores = {}, brandLabel = "") {
  if (Array.isArray(stores)) {
    return stores.map((store, index) => ({
      key: store?.id || store?.storeName || store?.store || store?.displayName || `store_${index}`,
      store: store && typeof store === "object" ? store : {},
    }));
  }

  return Object.entries(stores || {}).map(([key, value]) => ({
    key,
    store: value && typeof value === "object" ? value : {},
  }));
}

function hasAnnualKpiActivity(metrics = {}) {
  return (
    Number(metrics.traffic || 0) > 0 ||
    Number(metrics.newCustomers || 0) > 0 ||
    Number(metrics.cash || 0) > 0 ||
    Number(metrics.accrual || 0) > 0
  );
}

function normalizeAnnualAverageSettings(raw = {}) {
  const source = raw?.annualAverageSettings && typeof raw.annualAverageSettings === "object"
    ? raw.annualAverageSettings
    : {};
  const brandStartMonth = /^\d{4}-\d{2}$/.test(String(source.brandStartMonth || ""))
    ? String(source.brandStartMonth)
    : "";
  const rawOverrides =
    source.storeStartMonthOverrides && typeof source.storeStartMonthOverrides === "object"
      ? source.storeStartMonthOverrides
      : {};

  const storeStartMonthOverrides = Object.fromEntries(
    Object.entries(rawOverrides)
      .map(([storeCore, yearMonth]) => [
        normalizeAnnualKpiStoreCore(storeCore),
        /^\d{4}-\d{2}$/.test(String(yearMonth || "")) ? String(yearMonth) : "",
      ])
      .filter(([storeCore, yearMonth]) => Boolean(storeCore && yearMonth))
  );

  return {
    brandStartMonth,
    autoDetectFirstCompleteMonth: source.autoDetectFirstCompleteMonth !== false,
    excludePartialFirstMonth: source.excludePartialFirstMonth !== false,
    storeStartMonthOverrides,
  };
}

async function loadAnnualAverageSettings(brandId) {
  try {
    const snap = await getSummaryCollection(brandId, "settings").doc("feature_flags").get();
    return normalizeAnnualAverageSettings(snap.exists ? (snap.data() || {}) : {});
  } catch (error) {
    console.warn(`loadAnnualAverageSettings failed for ${brandId}`, error.message);
    return normalizeAnnualAverageSettings({});
  }
}

function getNextAnnualYearMonth(yearMonth = "") {
  const match = String(yearMonth || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month >= 12) return `${year + 1}-01`;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function getLaterAnnualYearMonth(...values) {
  return values
    .map((value) => String(value || ""))
    .filter((value) => /^\d{4}-\d{2}$/.test(value))
    .sort()
    .pop() || "";
}

function hasAnnualKpiDailyActivity(row = {}) {
  return (
    Number(row.traffic || 0) > 0 ||
    Number(row.newCustomers || 0) > 0 ||
    Number(row.cash || 0) > 0 ||
    Number(row.accrual || 0) > 0 ||
    Number(row.operationalAccrual || 0) > 0 ||
    Number(row.skincareSales || 0) > 0 ||
    Number(row.newCustomerSales || 0) > 0 ||
    Number(row.refund || 0) > 0 ||
    Number(row.skincareRefund || 0) > 0
  );
}

function getAnnualKpiFirstActivityDay(summaryData = {}, storeCore = "", brandLabel = "", store = {}) {
  const explicitDate =
    store?.firstReportDate ||
    store?.firstActivityDate ||
    store?.firstDataDate ||
    "";
  const explicitMatch = String(explicitDate || "").match(/^\d{4}-\d{2}-(\d{2})/);
  if (explicitMatch) return Number(explicitMatch[1]);

  const dailyMap = summaryData?.storeDailyTotals && typeof summaryData.storeDailyTotals === "object"
    ? summaryData.storeDailyTotals
    : {};

  for (const [key, rows] of Object.entries(dailyMap)) {
    const normalizedKey = normalizeAnnualKpiStoreCore(key, brandLabel);
    if (normalizedKey !== storeCore || !Array.isArray(rows)) continue;

    const activeDays = rows
      .filter((row) => hasAnnualKpiDailyActivity(row))
      .map((row) => Number(row?.day || String(row?.fullDate || "").slice(8, 10)))
      .filter((day) => Number.isFinite(day) && day >= 1 && day <= 31);

    if (activeDays.length > 0) return Math.min(...activeDays);
  }

  return null;
}

function collectAnnualKpiEstablishedStoresFromPayload(data = {}, brandLabel = "") {
  const established = new Set();
  const stores = data?.stores && typeof data.stores === "object" ? data.stores : {};
  toAnnualKpiStoreRows(stores, brandLabel).forEach(({ key, store }) => {
    const core = getAnnualKpiStoreCoreFromSummaryEntry(key, store, brandLabel);
    if (!core) return;
    const hasHistory =
      Number(store?.basedMonthCount || 0) > 0 ||
      (Array.isArray(store?.basedMonths) && store.basedMonths.length > 0) ||
      hasAnnualKpiActivity(store || {});
    if (hasHistory) established.add(core);
  });
  return established;
}

async function rebuildAnnualKpiSummaryForBrand(brandId, yearInput, options = {}) {
  const normalizedBrandId = getBackendDirtyBrandId(brandId || "cyj");
  const year = Number(yearInput) || getTaipeiYearForAnnualKpiSummary();
  const candidateMonths = getAnnualKpiSummaryCandidateMonths(year);
  const dashboardSummaryRef = getSummaryCollection(normalizedBrandId, "dashboard_summary");
  const annualSummaryRef = getSummaryCollection(normalizedBrandId, "annual_kpi_summary");
  const targetRef = annualSummaryRef.doc(String(year));
  const brandLabel = await getSummaryBrandLabel(normalizedBrandId).catch(() => getSummaryBrandPrefix(normalizedBrandId));

  const [
    annualAverageSettings,
    previousAnnualSnap,
    previousDecemberSnap,
    ...snaps
  ] = await Promise.all([
    loadAnnualAverageSettings(normalizedBrandId),
    annualSummaryRef.doc(String(year - 1)).get(),
    dashboardSummaryRef.doc(`${year - 1}-12`).get(),
    ...candidateMonths.map((yearMonth) => dashboardSummaryRef.doc(yearMonth).get()),
  ]);

  const previousEstablishedStores = new Set();
  if (previousAnnualSnap.exists) {
    collectAnnualKpiEstablishedStoresFromPayload(previousAnnualSnap.data() || {}, brandLabel)
      .forEach((core) => previousEstablishedStores.add(core));
  }
  if (previousDecemberSnap.exists) {
    collectAnnualKpiEstablishedStoresFromPayload(previousDecemberSnap.data() || {}, brandLabel)
      .forEach((core) => previousEstablishedStores.add(core));
  }

  const storeCandidates = {};
  const legacyBrandMonths = {};
  const skippedMonths = [];

  snaps.forEach((snap, index) => {
    const yearMonth = candidateMonths[index];
    if (!snap.exists) {
      skippedMonths.push({ yearMonth, reason: "missing_dashboard_summary" });
      return;
    }

    const data = snap.data() || {};
    const grand = data.grandTotal || {};
    const grandMetrics = {
      traffic: Number(grand.traffic || 0),
      newCustomers: Number(grand.newCustomers || 0),
      cash: Number(grand.cash || 0),
      accrual: Number(grand.accrual || 0),
    };
    const grandHasActivity = hasAnnualKpiActivity(grandMetrics);
    let storeActivityCount = 0;

    toAnnualKpiStoreRows(data.stores || {}, brandLabel).forEach(({ key, store }) => {
      const core = getAnnualKpiStoreCoreFromSummaryEntry(key, store, brandLabel);
      if (!core) return;

      const metrics = {
        traffic: Number(store.traffic || 0),
        newCustomers: Number(store.newCustomers || 0),
        cash: Number(store.cash || 0),
        accrual: Number(store.accrual || 0),
      };
      if (!hasAnnualKpiActivity(metrics)) return;

      storeActivityCount += 1;
      if (!storeCandidates[core]) {
        storeCandidates[core] = {
          storeCore: core,
          storeName: `${core}店`,
          monthlyCandidates: {},
        };
      }

      storeCandidates[core].monthlyCandidates[yearMonth] = {
        ...metrics,
        firstActivityDay: getAnnualKpiFirstActivityDay(data, core, brandLabel, store),
      };
    });

    if (storeActivityCount === 0 && grandHasActivity) {
      legacyBrandMonths[yearMonth] = grandMetrics;
    }
    if (storeActivityCount === 0 && !grandHasActivity) {
      skippedMonths.push({ yearMonth, reason: "empty_or_zero_summary" });
    }
  });

  const brandMonthlyTotals = {};
  const storeSummaries = {};

  Object.entries(storeCandidates).forEach(([core, item]) => {
    const candidateEntries = Object.entries(item.monthlyCandidates || {}).sort(([a], [b]) => a.localeCompare(b));
    const firstActiveMonth = candidateEntries[0]?.[0] || "";
    const firstActivityDay = candidateEntries[0]?.[1]?.firstActivityDay ?? null;
    const existedBeforeTargetYear = previousEstablishedStores.has(core);

    let autoStartMonth = firstActiveMonth;
    let startMonthSource = "auto_first_active_month";

    if (
      annualAverageSettings.autoDetectFirstCompleteMonth &&
      annualAverageSettings.excludePartialFirstMonth &&
      !existedBeforeTargetYear &&
      firstActiveMonth &&
      Number(firstActivityDay || 0) > 1
    ) {
      autoStartMonth = getNextAnnualYearMonth(firstActiveMonth);
      startMonthSource = "auto_next_complete_month";
    } else if (existedBeforeTargetYear) {
      startMonthSource = "established_before_target_year";
    }

    let effectiveStartMonth = getLaterAnnualYearMonth(
      autoStartMonth,
      annualAverageSettings.brandStartMonth
    );
    if (annualAverageSettings.brandStartMonth && effectiveStartMonth === annualAverageSettings.brandStartMonth) {
      startMonthSource = startMonthSource === "auto_next_complete_month"
        ? "auto_next_complete_month_with_brand_floor"
        : "brand_start_month_floor";
    }

    const overrideStartMonth = annualAverageSettings.storeStartMonthOverrides?.[core] || "";
    if (overrideStartMonth) {
      effectiveStartMonth = overrideStartMonth;
      startMonthSource = "store_override";
    }

    const monthlyValues = {};
    const excludedMonths = [];
    candidateEntries.forEach(([yearMonth, metrics]) => {
      if (effectiveStartMonth && yearMonth < effectiveStartMonth) {
        excludedMonths.push(yearMonth);
        return;
      }
      monthlyValues[yearMonth] = {
        traffic: Number(metrics.traffic || 0),
        newCustomers: Number(metrics.newCustomers || 0),
        cash: Number(metrics.cash || 0),
        accrual: Number(metrics.accrual || 0),
      };

      if (!brandMonthlyTotals[yearMonth]) {
        brandMonthlyTotals[yearMonth] = {
          traffic: 0,
          newCustomers: 0,
          cash: 0,
          accrual: 0,
          eligibleStoreCount: 0,
        };
      }
      brandMonthlyTotals[yearMonth].traffic += Number(metrics.traffic || 0);
      brandMonthlyTotals[yearMonth].newCustomers += Number(metrics.newCustomers || 0);
      brandMonthlyTotals[yearMonth].cash += Number(metrics.cash || 0);
      brandMonthlyTotals[yearMonth].accrual += Number(metrics.accrual || 0);
      brandMonthlyTotals[yearMonth].eligibleStoreCount += 1;
    });

    const basedMonths = Object.keys(monthlyValues).sort();
    const totals = basedMonths.reduce((acc, yearMonth) => {
      const metrics = monthlyValues[yearMonth] || {};
      acc.traffic += Number(metrics.traffic || 0);
      acc.newCustomers += Number(metrics.newCustomers || 0);
      acc.cash += Number(metrics.cash || 0);
      acc.accrual += Number(metrics.accrual || 0);
      return acc;
    }, { traffic: 0, newCustomers: 0, cash: 0, accrual: 0 });
    const basedMonthCount = basedMonths.length;

    storeSummaries[core] = {
      storeCore: core,
      storeName: item.storeName,
      firstActiveMonth,
      firstActivityDay,
      existedBeforeTargetYear,
      autoStartMonth,
      effectiveStartMonth,
      startMonthSource,
      overrideStartMonth,
      excludedMonths,
      monthlyValues,
      basedMonths,
      basedMonthCount,
      trafficTotal: totals.traffic,
      newCustomerTotal: totals.newCustomers,
      cashTotal: totals.cash,
      accrualTotal: totals.accrual,
      trafficMonthlyAverage: basedMonthCount > 0 ? Math.round(totals.traffic / basedMonthCount) : 0,
      newCustomerMonthlyAverage: basedMonthCount > 0 ? Math.round(totals.newCustomers / basedMonthCount) : 0,
      cashMonthlyAverage: basedMonthCount > 0 ? Math.round(totals.cash / basedMonthCount) : 0,
      accrualMonthlyAverage: basedMonthCount > 0 ? Math.round(totals.accrual / basedMonthCount) : 0,
    };
  });

  // 舊版 Summary 若只有 grandTotal、缺少 stores，仍保留全品牌年均；有 stores 時則以逐店完整月份重新加總。
  Object.entries(legacyBrandMonths).forEach(([yearMonth, metrics]) => {
    if (brandMonthlyTotals[yearMonth]) return;
    if (annualAverageSettings.brandStartMonth && yearMonth < annualAverageSettings.brandStartMonth) return;
    brandMonthlyTotals[yearMonth] = {
      ...metrics,
      eligibleStoreCount: 0,
      legacyGrandTotalFallback: true,
    };
  });

  const basedMonths = Object.keys(brandMonthlyTotals).sort();
  const totals = basedMonths.reduce((acc, yearMonth) => {
    const metrics = brandMonthlyTotals[yearMonth] || {};
    acc.traffic += Number(metrics.traffic || 0);
    acc.newCustomers += Number(metrics.newCustomers || 0);
    acc.cash += Number(metrics.cash || 0);
    acc.accrual += Number(metrics.accrual || 0);
    return acc;
  }, { traffic: 0, newCustomers: 0, cash: 0, accrual: 0 });
  const basedMonthCount = basedMonths.length;

  candidateMonths.forEach((yearMonth) => {
    if (!brandMonthlyTotals[yearMonth] && !skippedMonths.some((item) => item.yearMonth === yearMonth)) {
      skippedMonths.push({ yearMonth, reason: "no_eligible_complete_store_month" });
    }
  });

  const payload = {
    brandId: normalizedBrandId,
    brandLabel,
    year,
    yearText: String(year),
    source: "dashboard_summary",
    basis: "first_complete_month_by_store",
    scopeSupport: "brand_store_manager",
    annualAverageSettings,
    trafficTotal: totals.traffic,
    newCustomerTotal: totals.newCustomers,
    cashTotal: totals.cash,
    accrualTotal: totals.accrual,
    trafficMonthlyAverage: basedMonthCount > 0 ? Math.round(totals.traffic / basedMonthCount) : 0,
    newCustomerMonthlyAverage: basedMonthCount > 0 ? Math.round(totals.newCustomers / basedMonthCount) : 0,
    cashMonthlyAverage: basedMonthCount > 0 ? Math.round(totals.cash / basedMonthCount) : 0,
    accrualMonthlyAverage: basedMonthCount > 0 ? Math.round(totals.accrual / basedMonthCount) : 0,
    monthlyValues: brandMonthlyTotals,
    stores: storeSummaries,
    storeCount: Object.keys(storeSummaries).length,
    basedMonths,
    basedMonthCount,
    skippedMonths: skippedMonths.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth)),
    candidateMonths,
    trigger: options.trigger || "manual",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: new Date().toISOString(),
  };

  // annual_kpi_summary 是完整重建產物，必須整份覆寫。
  // 若使用 merge，已被排除的月份可能仍殘留在 stores.{店}.monthlyValues，
  // 導致全品牌已排除，但區域／單店又把舊月份算回平均。
  await targetRef.set(payload);
  return payload;
}


function normalizeSummaryCoreName(value) {
  const raw = String(value || "")
    .trim()
    .replace(/[　\s]+/g, "")
    .replace(/[（）()]/g, "");
  if (!raw) return "";

  const core = raw
    .replace(/^(CYJ|DRCYJ|Anew安妞|Yibo伊啵|Anew|Yibo|安妞|伊啵)/i, "")
    .replace(/臺/g, "台")
    .trim();

  // ★ 「新店」是正式地名，不是「新 + 店」。
  // 同時相容舊 Summary 曾誤寫成「新」的資料；其他店名仍維持既有去除「店」字的規則，縮小變更範圍。
  if (core === "新" || /^新店店?$/.test(core)) return "新店";

  return core
    .replace(/店/g, "")
    .trim();
}

function normalizeSummaryPersonName(value) {
  return String(value || "")
    .trim()
    .replace(/[　\s]+/g, "")
    .replace(/[（）()]/g, "");
}

function getSummaryMonthRange(yearMonth) {
  const [year, month] = String(yearMonth || "").split("-").map(Number);
  if (!year || !month) return null;
  const lastDay = new Date(year, month, 0).getDate();
  return {
    year,
    month,
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    daysInMonth: lastDay,
  };
}


function getTaipeiYearMonthForAutoRepair() {
  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return `${taipei.getUTCFullYear()}-${String(taipei.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isHistoricalYearMonthForAutoRepair(yearMonth) {
  const ym = String(yearMonth || "");
  if (!/^\d{4}-\d{2}$/.test(ym)) return false;
  return ym < getTaipeiYearMonthForAutoRepair();
}

function getSummaryBrandPrefix(brandId, brandLabel = "") {
  const id = String(brandId || "").toLowerCase();
  if (id.includes("anniu") || id.includes("anew") || brandLabel === "安妞") return "安妞";
  if (id.includes("yibo") || brandLabel === "伊啵") return "伊啵";
  return "CYJ";
}

function isLegacyCyjBrand(brandId) {
  const id = String(brandId || "").toLowerCase();
  return id === "cyj" || id === "default-app-id" || id === "default";
}

function getBrandRootRef(brandId) {
  return db.collection("brands").doc(String(brandId || "cyj"));
}

function getLegacyCyjDataRootRef() {
  return db.collection("artifacts").doc("default-app-id").collection("public").doc("data");
}

// CYJ 仍使用 legacy app data path：artifacts/default-app-id/public/data。
// 安妞 / 伊啵等品牌則使用 brands/{brandId}。
// 這裡必須跟前端維護中心讀取路徑一致，否則會出現後端已重建成功，但後台仍顯示 dirty。
function getSummaryCollection(brandId, collectionName) {
  if (isLegacyCyjBrand(brandId)) {
    return getLegacyCyjDataRootRef().collection(collectionName);
  }
  return getBrandRootRef(brandId).collection(collectionName);
}

function getSummaryQueueFallbackStateRef(brandId) {
  return getSummaryCollection(brandId, "summary_worker_state").doc(SUMMARY_QUEUE_FALLBACK_STATE_DOC);
}

// 每次只讀取一小頁 pending queue，並記住文件 ID 游標。
// 即使前面堆著當月或舊格式資料，游標仍會逐頁前進，不會永遠卡在固定前 50 筆。
// 這個查詢只沿用 status 單欄位索引，排序使用 Firestore 預設的文件 ID。
async function loadPendingQueueFallbackPage(brandId, nowMs = Date.now()) {
  const stateRef = getSummaryQueueFallbackStateRef(brandId);
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
  const lastRunMs = Number(state.lastRunMs || 0);
  const scheduledNextRunMs = Number(
    state.nextRunAfterMs ||
    (lastRunMs > 0 ? lastRunMs + SUMMARY_QUEUE_FALLBACK_INTERVAL_MS : 0)
  );

  if (scheduledNextRunMs > nowMs) {
    return {
      due: false,
      docs: [],
      cursorDocId: String(state.cursorDocId || ""),
      nextRunAfterMs: scheduledNextRunMs,
    };
  }

  const queueRef = getSummaryCollection(brandId, "recalc_queue");
  const cursorDocId = String(state.cursorDocId || "").trim();
  let query = queueRef
    .where("status", "==", "pending")
    .orderBy(admin.firestore.FieldPath.documentId())
    // 多取 1 筆確認是否真的有下一頁，避免「剛好 50 筆」被誤判為 backlog。
    .limit(SUMMARY_QUEUE_FALLBACK_LIMIT + 1);

  if (cursorDocId) query = query.startAfter(cursorDocId);

  const queueSnap = await query.get();
  const hasMorePages = queueSnap.size > SUMMARY_QUEUE_FALLBACK_LIMIT;
  const pageDocs = queueSnap.docs.slice(0, SUMMARY_QUEUE_FALLBACK_LIMIT);
  const nextCursorDocId = hasMorePages && pageDocs.length
    ? pageDocs[pageDocs.length - 1].id
    : "";
  const nextIntervalMs = hasMorePages
    ? SUMMARY_QUEUE_FALLBACK_CATCHUP_INTERVAL_MS
    : SUMMARY_QUEUE_FALLBACK_INTERVAL_MS;
  const nextRunAfterMs = nowMs + nextIntervalMs;
  const nowText = new Date(nowMs).toISOString();

  await stateRef.set({
    brandId,
    cursorDocId: nextCursorDocId,
    lastRunMs: nowMs,
    nextRunAfterMs,
    nextRunAfterAtText: new Date(nextRunAfterMs).toISOString(),
    scanMode: hasMorePages ? "catchup" : "steady",
    lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    lastRunAtText: nowText,
    lastPageSize: pageDocs.length,
    peekedExtraDocument: hasMorePages,
    wrappedToStart: nextCursorDocId === "",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText,
  }, { merge: true });

  return {
    due: true,
    docs: pageDocs,
    cursorDocId: nextCursorDocId,
    nextRunAfterMs,
    scanMode: hasMorePages ? "catchup" : "steady",
    hasMorePages,
    previousNoProgressPages: Number(state.consecutiveNoProgressPages || 0),
  };
}

// 原 CYJ 日報與 Summary 都在 artifacts/default-app-id/public/data；其他品牌在 brands/{brandId}。
function getSummarySourceCollection(brandId, collectionName) {
  return getSummaryCollection(brandId, collectionName);
}

async function getSummaryBrandLabel(brandId) {
  try {
    const snap = await getBrandRootRef(brandId).get();
    const data = snap.exists ? snap.data() || {} : {};
    return data.label || data.name || getSummaryBrandPrefix(brandId);
  } catch (error) {
    return getSummaryBrandPrefix(brandId);
  }
}

async function getAutoOrgStructureProfile(brandId) {
  const snap = await getOrgStructureDocRef(brandId).get();
  const managers = snap.exists ? snap.data()?.managers || {} : {};
  const storeOwner = {};
  const duplicateStores = [];

  Object.entries(managers || {}).forEach(([managerName, stores]) => {
    (Array.isArray(stores) ? stores : []).filter(Boolean).forEach((store) => {
      const core = normalizeSummaryCoreName(store);
      if (!core) return;
      if (storeOwner[core] && storeOwner[core] !== managerName) {
        duplicateStores.push({ store: core, owners: [storeOwner[core], managerName] });
      }
      storeOwner[core] = managerName;
    });
  });

  return {
    managers,
    stores: Object.keys(storeOwner),
    storeSet: new Set(Object.keys(storeOwner)),
    duplicateStores,
    unassignedStores: (Array.isArray(managers["未分配"]) ? managers["未分配"] : []).map(normalizeSummaryCoreName).filter(Boolean),
  };
}

function extractAutoTargetYearMonth(docId, data = {}) {
  if (data.yearMonth && /^\d{4}-\d{2}$/.test(String(data.yearMonth))) return String(data.yearMonth);
  const y = data.year || data.targetYear;
  const m = data.month || data.targetMonth;
  if (y && m) return `${y}-${String(m).padStart(2, "0")}`;
  const id = String(docId || "");
  const match = id.match(/(20\d{2})[-_](\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}`;
  return "";
}

function extractAutoTargetStore(docId, data = {}, yearMonth = "") {
  const raw = data.storeName || data.store || data.storeId || data.shopName || data.shop || data.name || "";
  if (raw) return normalizeSummaryCoreName(raw);
  let id = String(docId || "");
  const [year, month] = String(yearMonth || "").split("-");
  if (year && month) {
    id = id
      .replace(new RegExp(`[_-]?${year}[_-]?${Number(month)}$`), "")
      .replace(new RegExp(`[_-]?${year}[_-]?${month}$`), "");
  }
  return normalizeSummaryCoreName(id);
}

function hasOwnTargetField(value = {}) {
  if (!value || typeof value !== "object") return false;
  return [
    "cashTarget", "cash", "budget", "target", "targetCash", "cashBudget",
    "accrualTarget", "accrual", "accrualBudget", "targetAccrual",
    "challengeCashTarget", "challengeCash", "challengeTarget",
    "challengeAccrualTarget", "challengeAccrual",
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function getAutoTargetComparableTime(value = {}) {
  const raw = value?.updatedAtText || value?.updatedAt || value?.modifiedAtText || value?.modifiedAt || value?.createdAtText || value?.createdAt || "";
  if (!raw) return 0;
  if (typeof raw?.toMillis === "function") {
    const ms = Number(raw.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof raw?.seconds === "number") {
    return Number(raw.seconds) * 1000 + Math.floor(Number(raw.nanoseconds || 0) / 1000000);
  }
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : 0;
}

function readAutoTargetAlias(value = {}, keys = []) {
  for (const key of keys) {
    if (!value || !Object.prototype.hasOwnProperty.call(value, key)) continue;
    const raw = value[key];
    if (raw === null || raw === undefined || raw === "") continue;
    return { found: true, value: raw };
  }
  return { found: false, value: null };
}

function isConfiguredAutoBaseTargetValue(value) {
  if (value === null || value === undefined || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function isAutoTargetEffective(target = {}) {
  if (target?.authorityConflict === true || target?.status === "AUTHORITY_CONFLICT") return false;
  return isConfiguredAutoBaseTargetValue(target?.cashTarget)
    || isConfiguredAutoBaseTargetValue(target?.accrualTarget);
}

function isAutoTargetCanonicalSource(target = {}, storeCore = "") {
  if (target?.authorityConflict === true || target?.isCanonicalSource === true) return true;

  const sourceDocId = String(target?.sourceDocId || target?.id || "")
    .trim()
    .replace(/[　\s]+/g, "");
  const canonicalTargetId = String(target?.canonicalTargetId || "")
    .trim()
    .replace(/[　\s]+/g, "");

  if (canonicalTargetId && sourceDocId) return sourceDocId === canonicalTargetId;

  const core = normalizeSummaryCoreName(storeCore || target?.storeName || "");
  if (!core) return false;

  const expectedSuffix = core === "新店" ? "新店店" : `${core}店`;
  const canonicalStoreNames = new Set([
    `CYJ${expectedSuffix}`,
    `安妞${expectedSuffix}`,
    `伊啵${expectedSuffix}`,
  ]);

  const sourceBase = sourceDocId.replace(/[_-]20\d{2}[_-]\d{1,2}$/, "");
  if (sourceBase) return canonicalStoreNames.has(sourceBase);

  const rawStore = String(target?.storeName || "")
    .trim()
    .replace(/[　\s]+/g, "");
  return canonicalStoreNames.has(rawStore);
}

// 目標資料可能因歷史命名差異出現同一門市多份文件。
// 裁決順序固定為：有效正式目標 > 全 0；有效性相同時較新資料優先；最後才用 canonical 店名與文件 ID 穩定排序。
// 不再使用「Firestore 最後讀到的文件」覆蓋，避免 0 值 duplicate 把有效目標蓋掉。
function choosePreferredAutoTarget(currentTarget = null, nextTarget = null, storeCore = "") {
  if (!currentTarget) return nextTarget || null;
  if (!nextTarget) return currentTarget;

  const currentCanonical = isAutoTargetCanonicalSource(currentTarget, storeCore);
  const nextCanonical = isAutoTargetCanonicalSource(nextTarget, storeCore);
  const conflict = resolveTargetAuthorityConflict(currentTarget, nextTarget, {
    currentAuthoritative: currentCanonical,
    incomingAuthoritative: nextCanonical,
    storeName: storeCore,
    canonicalTargetId: currentTarget?.canonicalTargetId || nextTarget?.canonicalTargetId || "",
  });
  if (conflict) return conflict;

  if (currentCanonical !== nextCanonical) return nextCanonical ? nextTarget : currentTarget;

  const currentEffective = isAutoTargetEffective(currentTarget);
  const nextEffective = isAutoTargetEffective(nextTarget);
  if (currentEffective !== nextEffective) return nextEffective ? nextTarget : currentTarget;

  const currentTime = Number(currentTarget?.updatedAtMs || 0);
  const nextTime = Number(nextTarget?.updatedAtMs || 0);
  if (currentTime !== nextTime) return nextTime > currentTime ? nextTarget : currentTarget;

  return String(nextTarget?.sourceDocId || nextTarget?.id || "").localeCompare(
    String(currentTarget?.sourceDocId || currentTarget?.id || ""),
    "zh-Hant"
  ) > 0 ? nextTarget : currentTarget;
}

function mergeAutoTargetMapEntry(targetMap = {}, row = null) {
  if (!row?.storeCore || !row?.target) return targetMap;
  targetMap[row.storeCore] = choosePreferredAutoTarget(
    targetMap[row.storeCore] || null,
    row.target,
    row.storeCore
  );
  return targetMap;
}

function buildAutoTargetRow(id, value = {}, yearMonth = "") {
  if (!value || typeof value !== "object") return null;
  const targetMonth = extractAutoTargetYearMonth(id, value);
  if (targetMonth && yearMonth && targetMonth !== yearMonth) return null;
  const storeCore = extractAutoTargetStore(id, value, yearMonth);
  if (!storeCore || !hasOwnTargetField(value)) return null;
  const updatedAtMs = getAutoTargetComparableTime(value);
  const authorityConflict = value?.authorityConflict === true || String(value?.status || "") === "AUTHORITY_CONFLICT";
  const cashTarget = readAutoTargetAlias(value, ["cashTarget", "cash", "budget", "target", "targetCash", "cashBudget"]);
  const accrualTarget = readAutoTargetAlias(value, ["accrualTarget", "accrual", "accrualBudget", "targetAccrual"]);
  const challengeCashTarget = readAutoTargetAlias(value, ["challengeCashTarget", "challengeCash", "challengeTarget"]);
  const challengeAccrualTarget = readAutoTargetAlias(value, ["challengeAccrualTarget", "challengeAccrual"]);
  return {
    storeCore,
    target: {
      id: value.id || id,
      sourceDocId: value.sourceDocId || id,
      storeName: value.storeName || value.store || value.name || storeCore,
      cashTarget: authorityConflict ? null : (cashTarget.found ? cashTarget.value : null),
      accrualTarget: authorityConflict ? null : (accrualTarget.found ? accrualTarget.value : null),
      challengeCashTarget: authorityConflict ? null : (challengeCashTarget.found ? challengeCashTarget.value : null),
      challengeAccrualTarget: authorityConflict ? null : (challengeAccrualTarget.found ? challengeAccrualTarget.value : null),
      canonicalTargetId: String(value.canonicalTargetId || ""),
      isCanonicalSource: authorityConflict ? true : value.isCanonicalSource === true,
      authorityConflict,
      authorityStatus: authorityConflict ? "AUTHORITY_CONFLICT" : String(value.authorityStatus || ""),
      status: authorityConflict ? "AUTHORITY_CONFLICT" : String(value.status || ""),
      conflictSourceDocIds: authorityConflict && Array.isArray(value.conflictSourceDocIds)
        ? [...value.conflictSourceDocIds].map((entry) => String(entry || "").trim()).filter(Boolean)
        : [],
      updatedAtText: value.updatedAtText || value.updatedAt || value.modifiedAtText || value.modifiedAt || value.createdAtText || value.createdAt || "",
      updatedAtMs,
    },
  };
}

function extractAutoTargetMapFromSummaryData(data = {}, yearMonth = "") {
  const targetMap = {};
  const containers = [
    data.stores,
    data.storeTargets,
    data.storeTargetMap,
    data.monthlyTargets,
    data.targets,
    data.targetStores,
    data.items,
    data.data,
    data.byStore,
    data.storeMap,
    data.storesMap,
    data.summaryByStore,
    data.storeSummaries,
  ];

  const consumeContainer = (container) => {
    if (!container) return;
    if (Array.isArray(container)) {
      container.forEach((value, index) => {
        const id = value?.sourceDocId || value?.id || value?.storeName || value?.store || value?.name || String(index);
        const row = buildAutoTargetRow(id, value, yearMonth);
        if (row) mergeAutoTargetMapEntry(targetMap, row);
      });
      return;
    }
    if (typeof container === "object") {
      Object.entries(container).forEach(([id, value]) => {
        const row = buildAutoTargetRow(value?.sourceDocId || id, value, yearMonth);
        if (row) mergeAutoTargetMapEntry(targetMap, row);
      });
    }
  };

  containers.forEach(consumeContainer);
  return targetMap;
}

function getAutoTargetCoverage(targetMap = {}, expectedStores = []) {
  const expected = new Set((expectedStores || []).map(normalizeSummaryCoreName).filter(Boolean));
  const actual = new Set(
    Object.entries(targetMap || {})
      .filter(([, target]) => isAutoTargetEffective(target))
      .map(([store]) => normalizeSummaryCoreName(store))
      .filter(Boolean)
  );
  if (actual.size === 0) return 0;
  if (expected.size === 0) return 1;
  let matched = 0;
  expected.forEach((store) => { if (actual.has(store)) matched += 1; });
  return matched / expected.size;
}

async function loadRawMonthlyTargetMap(brandId, yearMonth) {
  const snap = await getSummaryCollection(brandId, "monthly_targets").get();
  const targetMap = {};
  snap.docs.forEach((docSnap) => {
    const row = buildAutoTargetRow(docSnap.id, docSnap.data() || {}, yearMonth);
    if (row) mergeAutoTargetMapEntry(targetMap, row);
  });
  return targetMap;
}

async function loadAutoMonthlyTargetAuthority(brandId, yearMonth, expectedStores = []) {
  try {
    const summarySnap = await getSummaryCollection(brandId, "monthly_targets_summary").doc(yearMonth).get();
    if (summarySnap.exists) {
      const summaryData = summarySnap.data() || {};
      const summaryMap = extractAutoTargetMapFromSummaryData(summaryData, yearMonth);
      const targetCoverage = extractTargetCoverageMetadata(summaryData);

      if (targetCoverage.available) {
        return {
          targets: summaryMap,
          targetCoverage,
          source: "monthly_targets_summary",
          usedRawFallback: false,
        };
      }

      // 舊 target Summary 若尚未具備 Batch 3 coverage contract，不可假裝是可信任 authority。
      // 這種 schema/authority 缺失才允許 compatibility raw fallback；合法的 incomplete coverage 本身不會 fallback。
      console.warn(`monthly_targets_summary missing Target Coverage v1 metadata; compatibility raw fallback: ${brandId}/${yearMonth}`);
    }
  } catch (error) {
    console.warn(`monthly_targets_summary read failed; fallback full collection only because Summary is unavailable: ${brandId}/${yearMonth}`, error.message);
  }

  // Compatibility safety: only a missing/unreadable Summary may fall back to raw.
  // Cash/Accrual coverage incomplete is a valid business state and must NOT trigger a full monthly_targets scan.
  const rawMap = await loadRawMonthlyTargetMap(brandId, yearMonth);
  return {
    targets: rawMap,
    targetCoverage: extractTargetCoverageMetadata({}),
    source: "monthly_targets_full_fallback_missing_summary",
    usedRawFallback: true,
    expectedStoreCount: Array.isArray(expectedStores) ? expectedStores.length : 0,
  };
}

async function loadAutoMonthlyTargetMap(brandId, yearMonth, expectedStores = []) {
  return (await loadAutoMonthlyTargetAuthority(brandId, yearMonth, expectedStores)).targets;
}

function resolveTelegramBrandId(data = {}, path = "") {
  const raw = String(data.brandId || data.brand || path || "cyj").toLowerCase();
  if (raw.includes("anniu") || raw.includes("anew") || raw.includes("安妞")) return "anniu";
  if (raw.includes("yibo") || raw.includes("伊啵")) return "yibo";
  return "cyj";
}

async function loadTelegramActiveRosterByBrand() {
  const result = { cyj: new Set(), anniu: new Set(), yibo: new Set() };
  await Promise.all(BRANDS.map(async (brand) => {
    try {
      const profile = await getAutoOrgStructureProfile(brand.id);
      (profile.stores || []).forEach((store) => {
        const core = normalizeSummaryCoreName(store);
        if (core) result[brand.id].add(core);
      });
    } catch (error) {
      console.warn(`Telegram org_structure read failed: ${brand.id}`, error.message);
    }
  }));
  return result;
}

function sumTelegramTargetMap(targetMap = {}) {
  const totals = { cash: 0, accrual: 0 };
  Object.values(targetMap || {}).forEach((target) => {
    totals.cash += Number(target?.cashTarget || 0);
    totals.accrual += Number(target?.accrualTarget || 0);
  });
  return totals;
}

function pickTelegramSummaryTotal(data = {}, keys = []) {
  const sources = [data.totals, data.total, data.summary, data];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const value = Number(source[key]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

async function loadTelegramMonthlyBudgetForBrand(brandId, yearMonth) {
  const expectedStores = [];
  try {
    const profile = await getAutoOrgStructureProfile(brandId);
    expectedStores.push(...(profile.stores || []));
  } catch (error) {
    console.warn(`Telegram target expected stores read failed: ${brandId}`, error.message);
  }

  try {
    const summarySnap = await getSummaryCollection(brandId, "monthly_targets_summary").doc(yearMonth).get();
    if (summarySnap.exists) {
      const data = summarySnap.data() || {};
      const summaryMap = extractAutoTargetMapFromSummaryData(data, yearMonth);
      const coverage = getAutoTargetCoverage(summaryMap, expectedStores);
      const isComplete = expectedStores.length > 0 ? coverage >= 1 : Object.keys(summaryMap).length > 0;

      // 有正式店家清單時，必須先驗證逐店目標完整，不能只因 Summary totals > 0 就接受部分總額。
      if (isComplete) {
        return { ...sumTelegramTargetMap(summaryMap), source: "monthly_targets_summary_stores", coverage, complete: true };
      }

      if (expectedStores.length === 0) {
        const cashTotal = pickTelegramSummaryTotal(data, ["totalCashTarget", "cashTargetTotal", "cashTotal", "cashTarget", "cashBudget"]);
        const accrualTotal = pickTelegramSummaryTotal(data, ["totalAccrualTarget", "accrualTargetTotal", "accrualTotal", "accrualTarget", "accrualBudget"]);
        if ((cashTotal !== null && cashTotal > 0) || (accrualTotal !== null && accrualTotal > 0)) {
          return { cash: cashTotal || 0, accrual: accrualTotal || 0, source: "monthly_targets_summary_totals_no_roster", coverage, complete: false };
        }
      }

      console.warn(`Telegram monthly_targets_summary target completeness insufficient: ${brandId}/${yearMonth}, coverage=${coverage.toFixed(2)}`);
    }
  } catch (error) {
    console.warn(`Telegram monthly_targets_summary read failed: ${brandId}/${yearMonth}`, error.message);
  }

  try {
    const dashboardSnap = await getSummaryCollection(brandId, "dashboard_summary").doc(yearMonth).get();
    if (dashboardSnap.exists) {
      const dashboardMap = extractAutoTargetMapFromSummaryData(dashboardSnap.data() || {}, yearMonth);
      const coverage = getAutoTargetCoverage(dashboardMap, expectedStores);
      const isComplete = expectedStores.length > 0 ? coverage >= 1 : Object.keys(dashboardMap).length > 0;
      if (isComplete) {
        return { ...sumTelegramTargetMap(dashboardMap), source: "dashboard_summary", coverage, complete: true };
      }
    }
  } catch (error) {
    console.warn(`Telegram dashboard_summary target fallback failed: ${brandId}/${yearMonth}`, error.message);
  }

  const rawMap = await loadRawMonthlyTargetMap(brandId, yearMonth);
  const coverage = getAutoTargetCoverage(rawMap, expectedStores);
  return {
    ...sumTelegramTargetMap(rawMap),
    source: "monthly_targets_full_fallback",
    coverage,
    complete: expectedStores.length > 0 ? coverage >= 1 : Object.keys(rawMap).length > 0,
  };
}

async function loadTelegramMonthlyBudgetsByBrand(yearMonth) {
  const entries = await Promise.all(BRANDS.map(async (brand) => [
    brand.id,
    await loadTelegramMonthlyBudgetForBrand(brand.id, yearMonth),
  ]));
  return Object.fromEntries(entries);
}

async function buildAutoDashboardSummaryPayloads(brandId, yearMonth) {
  const brandLabel = await getSummaryBrandLabel(brandId);
  const range = getSummaryMonthRange(yearMonth);
  if (!range) throw new Error("月份格式錯誤");

  const orgProfile = await getAutoOrgStructureProfile(brandId);
  const [targetAuthority, lifecycleSnap] = await Promise.all([
    loadAutoMonthlyTargetAuthority(brandId, yearMonth, orgProfile.stores),
    getSummaryCollection(brandId, "store_lifecycle").doc("master").get(),
  ]);
  const targets = targetAuthority.targets || {};
  const targetCoverage = targetAuthority.targetCoverage || extractTargetCoverageMetadata({});
  const lifecycleMaster = lifecycleSnap.exists ? (lifecycleSnap.data() || {}) : { datasetStatus: "BUILDING", stores: {} };
  const lifecycleReady = String(lifecycleMaster.datasetStatus || "") === "READY";
  const lifecycleEligibleEntries = getLifecycleEligibleStoreEntries(lifecycleMaster, yearMonth, { brandId, requireReady: true });
  const lifecycleEligibleStoreKeys = lifecycleEligibleEntries.map((entry) => String(entry.storeKey || entry.coreStoreName || "").trim()).filter(Boolean);
  const lifecycleEligibleStoreSet = new Set(lifecycleEligibleStoreKeys);
  const formalTargetAuthority = buildSummaryTargetAuthoritySnapshot({
    targetMap: targets,
    eligibleStoreKeys: lifecycleEligibleStoreKeys,
    lifecycleReady,
    targetCoverage,
  });
  const storeOwner = {};
  Object.entries(orgProfile.managers || {}).forEach(([managerName, stores]) => {
    (Array.isArray(stores) ? stores : []).forEach((store) => {
      const core = normalizeSummaryCoreName(store);
      if (core) storeOwner[core] = managerName;
    });
  });

  const [dailySnap, therapistSnap, therapistListSnap] = await Promise.all([
    getSummarySourceCollection(brandId, "daily_reports").where("date", ">=", range.start).where("date", "<=", range.end).get(),
    getSummarySourceCollection(brandId, "therapist_daily_reports").where("date", ">=", range.start).where("date", "<=", range.end).get(),
    getSummarySourceCollection(brandId, "therapists").get(),
  ]);

  const dailyRows = dailySnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((row) => row.isArchivedDuplicate !== true);
  const therapistRows = therapistSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((row) => row.isArchivedDuplicate !== true);

  // Batch 5D-1：Reporting Completeness 直接重用本次 Summary Writer 已讀取的 Lifecycle Master + dailyRows。
  // 不新增 Firestore query/listener，也不把每店×每日 missing dates 寫入 dashboard_summary。
  const taipeiTodayForReporting = getTelegramAgentTaipeiNow().todayStr;
  const currentTaipeiYearMonth = taipeiTodayForReporting.slice(0, 7);
  const reportingCutoffDate = yearMonth < currentTaipeiYearMonth
    ? range.end
    : yearMonth === currentTaipeiYearMonth
      ? (taipeiTodayForReporting < range.end ? taipeiTodayForReporting : range.end)
      : shiftTelegramAgentDate(range.start, -1);
  const reportingCompleteness = buildLifecycleReportingCompleteness({
    master: lifecycleMaster,
    yearMonth,
    reports: dailyRows,
    brandId,
    cutoffDate: reportingCutoffDate,
    requireReady: true,
    includeMissingDates: false,
  });

  // 安全防護：若此月份有店家架構或目標，但原始日報讀到 0 筆，通常代表讀錯來源路徑。
  // 這時不可寫出「0 業績 verified Summary」，避免 Dashboard 被錯誤 Summary 誤導。
  if (dailyRows.length === 0 && (orgProfile.stores.length > 0 || Object.keys(targets).length > 0)) {
    throw new Error(`自動整理中止：${brandId} ${yearMonth} 原始店日報為 0 筆，但已有店家或目標資料，請確認來源路徑。`);
  }

  const brandPrefix = getSummaryBrandPrefix(brandId, brandLabel);

  const dailyTotals = Array.from({ length: range.daysInMonth }, (_, i) => ({
    day: i + 1,
    date: `${range.month}/${i + 1}`,
    cash: 0,
    traffic: 0,
  }));

  // Summary v2：保留每間店每日曲線，讓歷史月份切「區長 / 單店」時不必再用比例縮放。
  // 這是向下相容欄位；舊前端會忽略，新前端會優先使用。原本 dailyTotals / stores / rankings 皆不改動。
  const makeEmptyStoreDailyRows = () => Array.from({ length: range.daysInMonth }, (_, i) => ({
    day: i + 1,
    date: `${range.month}/${i + 1}`,
    fullDate: `${yearMonth}-${String(i + 1).padStart(2, "0")}`,
    cash: 0,
    accrual: 0,
    operationalAccrual: 0,
    skincareSales: 0,
    traffic: 0,
    newCustomers: 0,
    newCustomerClosings: 0,
    newCustomerSales: 0,
    refund: 0,
    skincareRefund: 0,
  }));
  const storeDailyTotals = {};
  const ensureStoreDailyRows = (storeCore) => {
    if (!storeDailyTotals[storeCore]) storeDailyTotals[storeCore] = makeEmptyStoreDailyRows();
    return storeDailyTotals[storeCore];
  };

  const storeMap = {};
  const managerMap = {};
  const ensureStore = (storeCore) => {
    if (!storeMap[storeCore]) {
      const manager = storeOwner[storeCore] || "未分配";
      storeMap[storeCore] = {
        store: storeCore,
        displayName: `${brandPrefix}${storeCore}店`,
        manager,
        cash: 0,
        accrual: 0,
        operationalAccrual: 0,
        skincareSales: 0,
        traffic: 0,
        newCustomers: 0,
        newCustomerClosings: 0,
        newCustomerSales: 0,
        refund: 0,
        skincareRefund: 0,
        budget: 0,
        accrualBudget: 0,
        challengeBudget: 0,
        challengeAccrualBudget: 0,
        achievement: 0,
        rank: 0,
      };
    }
    return storeMap[storeCore];
  };

  const grand = {
    cash: 0,
    accrual: 0,
    operationalAccrual: 0,
    skincareSales: 0,
    traffic: 0,
    newCustomers: 0,
    newCustomerClosings: 0,
    newCustomerSales: 0,
    refund: 0,
    skincareRefund: 0,
    budget: 0,
    accrualBudget: 0,
    challengeBudget: 0,
    challengeAccrualBudget: 0,
    totalAchievement: 0,
    totalAccrualAchievement: 0,
    challengeAchievement: 0,
    challengeAccrualAchievement: 0,
    projection: 0,
    accrualProjection: 0,
  };

  dailyRows.forEach((row) => {
    const storeCore = normalizeSummaryCoreName(row.storeName || row.store || row.storeId || "");
    if (!storeCore) return;
    const store = ensureStore(storeCore);
    const cash = (Number(row.cash) || 0) - (Number(row.refund) || 0);
    const operationalAccrual = Number(row.operationalAccrual) || 0;
    const skincareSales = Number(row.skincareSales) || 0;
    const accrual = brandPrefix === "安妞" ? operationalAccrual : Number(row.accrual) || 0;
    const traffic = Number(row.traffic) || 0;
    const newCustomers = Number(row.newCustomers) || 0;
    const newCustomerClosings = Number(row.newCustomerClosings) || 0;
    const newCustomerSales = Number(row.newCustomerSales) || 0;
    const refund = Number(row.refund) || 0;
    const skincareRefund = Number(row.skincareRefund) || 0;

    store.cash += cash;
    store.accrual += accrual;
    store.operationalAccrual += operationalAccrual;
    store.skincareSales += skincareSales;
    store.traffic += traffic;
    store.newCustomers += newCustomers;
    store.newCustomerClosings += newCustomerClosings;
    store.newCustomerSales += newCustomerSales;
    store.refund += refund;
    store.skincareRefund += skincareRefund;

    grand.cash += cash;
    grand.accrual += accrual;
    grand.operationalAccrual += operationalAccrual;
    grand.skincareSales += skincareSales;
    grand.traffic += traffic;
    grand.newCustomers += newCustomers;
    grand.newCustomerClosings += newCustomerClosings;
    grand.newCustomerSales += newCustomerSales;
    grand.refund += refund;
    grand.skincareRefund += skincareRefund;

    const day = Number(String(row.date || "").slice(8, 10));
    if (day && dailyTotals[day - 1]) {
      dailyTotals[day - 1].cash += cash;
      dailyTotals[day - 1].traffic += traffic;
    }
    if (day && day >= 1 && day <= range.daysInMonth) {
      const storeDailyRow = ensureStoreDailyRows(storeCore)[day - 1];
      storeDailyRow.cash += cash;
      storeDailyRow.accrual += accrual;
      storeDailyRow.operationalAccrual += operationalAccrual;
      storeDailyRow.skincareSales += skincareSales;
      storeDailyRow.traffic += traffic;
      storeDailyRow.newCustomers += newCustomers;
      storeDailyRow.newCustomerClosings += newCustomerClosings;
      storeDailyRow.newCustomerSales += newCustomerSales;
      storeDailyRow.refund += refund;
      storeDailyRow.skincareRefund += skincareRefund;
    }
  });

  // Batch 4 additive semantics：舊 cash/accrual 欄位不改語意；formal fields 另由 canonical KPI contract 計算。
  const semanticRowsByStore = {};
  dailyRows.forEach((row) => {
    const storeCore = normalizeSummaryCoreName(row.storeName || row.store || row.storeId || "");
    if (!storeCore) return;
    if (!semanticRowsByStore[storeCore]) semanticRowsByStore[storeCore] = [];
    semanticRowsByStore[storeCore].push(row);
  });

  Object.keys({ ...storeOwner, ...storeMap, ...targets }).forEach((storeCore) => {
    if (!storeCore) return;
    const store = ensureStore(storeCore);
    const target = targets[storeCore];
    if (target) {
      store.budget = Number(target.cashTarget || 0);
      store.accrualBudget = Number(target.accrualTarget || 0);
      store.challengeBudget = Number(target.challengeCashTarget || 0) || store.budget;
      store.challengeAccrualBudget = Number(target.challengeAccrualTarget || 0) || store.accrualBudget;
    }
    store.achievement = store.budget > 0 ? (store.cash / store.budget) * 100 : 0;
    ensureStoreDailyRows(storeCore);
    grand.budget += store.budget;
    grand.accrualBudget += store.accrualBudget;
    grand.challengeBudget += store.challengeBudget;
    grand.challengeAccrualBudget += store.challengeAccrualBudget;
  });

  Object.values(storeMap).forEach((store) => {
    Object.assign(store, aggregateFormalMetrics(brandId, semanticRowsByStore[store.store] || []));
    store.formalLifecycleEligible = lifecycleEligibleStoreSet.has(store.store);
  });
  const formalScopeDailyRows = lifecycleReady
    ? dailyRows.filter((row) => lifecycleEligibleStoreSet.has(normalizeSummaryCoreName(row.storeName || row.store || row.storeId || "")))
    : [];
  Object.assign(grand, aggregateFormalMetrics(brandId, formalScopeDailyRows));

  // Batch 4 不擴張 storeDailyTotals 的每店×每日 schema，避免把 dashboard_summary 單文件推近 Firestore 1 MiB 上限。
  // Store / brand monthly formal authority 先以 explicit store + grandTotal fields 建立；daily semantic cutover 留給後續 consumer/projection Batch。

  const formalCashAchievement = buildScopeFormalAchievement({
    actualValue: grand.formalNetCash,
    actualStatus: grand.formalNetCashStatus,
    targetValue: formalTargetAuthority.cashTargetTotal,
    coverageComplete: formalTargetAuthority.cashCoverageTrusted,
  });
  const formalAccrualAchievement = buildScopeFormalAchievement({
    actualValue: grand.formalAccrual,
    actualStatus: grand.formalAccrualStatus,
    targetValue: formalTargetAuthority.accrualTargetTotal,
    coverageComplete: formalTargetAuthority.accrualCoverageTrusted,
  });
  grand.formalCashTarget = formalTargetAuthority.cashTargetTotal;
  grand.formalAccrualTarget = formalTargetAuthority.accrualTargetTotal;
  grand.formalCashAchievement = formalCashAchievement.value;
  grand.formalCashAchievementStatus = formalCashAchievement.status;
  grand.formalAccrualAchievement = formalAccrualAchievement.value;
  grand.formalAccrualAchievementStatus = formalAccrualAchievement.status;

  const formalStoreRanking = buildFormalStoreRanking(storeMap, targets, { eligibleStoreKeys: lifecycleEligibleStoreKeys });
  Object.entries(formalStoreRanking.byStore || {}).forEach(([storeCore, metadata]) => {
    if (storeMap[storeCore]) Object.assign(storeMap[storeCore], metadata);
  });

  grand.totalAchievement = grand.budget > 0 ? (grand.cash / grand.budget) * 100 : 0;
  grand.totalAccrualAchievement = grand.accrualBudget > 0 ? (grand.accrual / grand.accrualBudget) * 100 : 0;
  grand.challengeAchievement = grand.challengeBudget > 0 ? (grand.cash / grand.challengeBudget) * 100 : 0;
  grand.challengeAccrualAchievement = grand.challengeAccrualBudget > 0 ? (grand.accrual / grand.challengeAccrualBudget) * 100 : 0;

  const storeRanking = Object.values(storeMap).sort((a, b) => b.cash - a.cash).map((store, index) => ({ ...store, rank: index + 1 }));
  storeRanking.forEach((store) => { storeMap[store.store].rank = store.rank; });

  Object.entries(orgProfile.managers || {}).forEach(([managerName, stores]) => {
    if (managerName === "未分配") return;
    managerMap[managerName] = {
      manager: managerName,
      stores: (Array.isArray(stores) ? stores : []).map(normalizeSummaryCoreName).filter(Boolean),
      cash: 0,
      accrual: 0,
      budget: 0,
      achievement: 0,
      rank: 0,
    };
  });
  Object.values(storeMap).forEach((store) => {
    const managerName = store.manager || "未分配";
    if (!managerMap[managerName]) managerMap[managerName] = { manager: managerName, stores: [], cash: 0, accrual: 0, budget: 0, achievement: 0, rank: 0 };
    if (!managerMap[managerName].stores.includes(store.store)) managerMap[managerName].stores.push(store.store);
    managerMap[managerName].cash += store.cash;
    managerMap[managerName].accrual += store.accrual;
    managerMap[managerName].budget += store.budget;
  });
  Object.values(managerMap).forEach((manager) => { manager.achievement = manager.budget > 0 ? (manager.cash / manager.budget) * 100 : 0; });
  Object.values(managerMap).sort((a, b) => b.cash - a.cash).forEach((manager, index) => { manager.rank = index + 1; });

  const storeRevenueByDate = (date) => Object.values(dailyRows.reduce((acc, row) => {
    if (row.date !== date) return acc;
    const storeCore = normalizeSummaryCoreName(row.storeName || row.store || row.storeId || "");
    if (!storeCore) return acc;
    if (!acc[storeCore]) acc[storeCore] = { store: storeCore, name: `${brandPrefix}${storeCore}店`, revenue: 0, manager: storeOwner[storeCore] || "未分配" };
    acc[storeCore].revenue += (Number(row.cash) || 0) - (Number(row.refund) || 0);
    return acc;
  }, {})).sort((a, b) => b.revenue - a.revenue).slice(0, 3);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  const therapistMaster = {};
  therapistListSnap.docs.forEach((d) => {
    const data = d.data() || {};
    therapistMaster[d.id] = { id: d.id, name: data.name || "", store: normalizeSummaryCoreName(data.store || data.storeName || ""), status: data.status || "" };
  });

  const therapistMap = {};
  therapistRows.forEach((row) => {
    const id = row.therapistId || row.id || normalizeSummaryPersonName(row.therapistName);
    if (!id) return;
    const storeCore = normalizeSummaryCoreName(row.storeName || row.store || row.storeId || "");
    if (!therapistMap[id]) {
      therapistMap[id] = {
        id,
        name: therapistMaster[id]?.name || row.therapistName || "未命名",
        store: storeCore,
        storeDisplay: storeCore ? `${storeCore}店` : "未知店",
        manager: storeOwner[storeCore] || "未分配",
        totalRevenue: 0,
        serviceCount: 0,
        newCustomerRevenue: 0,
        oldCustomerRevenue: 0,
        newCustomerCount: 0,
        oldCustomerCount: 0,
        newCustomerClosings: 0,
        returnRevenue: 0,
        newClosingRate: 0,
        newAsp: 0,
        oldAsp: 0,
        rank: 0,
        status: "NORMAL",
      };
    }
    const t = therapistMap[id];
    t.totalRevenue += Number(row.totalRevenue) || 0;
    t.serviceCount += Number(row.serviceCount) || 0;
    t.newCustomerRevenue += Number(row.newCustomerRevenue) || 0;
    t.oldCustomerRevenue += Number(row.oldCustomerRevenue) || 0;
    t.newCustomerCount += Number(row.newCustomerCount) || 0;
    t.oldCustomerCount += Number(row.oldCustomerCount) || 0;
    t.newCustomerClosings += Number(row.newCustomerClosings) || 0;
    t.returnRevenue += Number(row.returnRevenue) || 0;
  });

  const therapistRankings = applyTherapistRankingSemantics(Object.values(therapistMap));
  const therapistGrand = buildTherapistAggregateMetrics(therapistRankings);

  const topTherapistsByDate = (date) => Object.values(therapistRows.reduce((acc, row) => {
    if (row.date !== date) return acc;
    const id = row.therapistId || normalizeSummaryPersonName(row.therapistName);
    if (!id) return acc;
    if (!acc[id]) acc[id] = { id, name: therapistMaster[id]?.name || row.therapistName || "未命名", storeDisplay: `${normalizeSummaryCoreName(row.storeName || row.store || row.storeId || "")}店`, revenue: 0 };
    acc[id].revenue += Number(row.totalRevenue) || 0;
    return acc;
  }, {})).sort((a, b) => b.revenue - a.revenue).slice(0, 3);

  const nowIso = new Date().toISOString();
  const nowTimestamp = admin.firestore.FieldValue.serverTimestamp();

  const dashboardSummary = {
    brandId,
    brandLabel,
    brandPrefix,
    yearMonth,
    monthStart: range.start,
    monthEnd: range.end,
    semanticVersion: SUMMARY_SEMANTIC_VERSION,
    kpiContractVersion: grand.kpiContractVersion || targetCoverage.kpiContractVersion || "",
    targetAuthoritySource: targetAuthority.source || "",
    targetCoverage,
    formalTargetAuthority,
    lifecycleSnapshot: {
      schemaVersion: String(lifecycleMaster.schemaVersion || ""),
      datasetStatus: String(lifecycleMaster.datasetStatus || "BUILDING"),
      revision: Number(lifecycleMaster.revision || 0),
      eligibleStoreCount: lifecycleEligibleStoreKeys.length,
      eligibleStoreKeys: lifecycleEligibleStoreKeys,
    },
    reportingCompleteness: {
      ...reportingCompleteness,
      schemaVersion: REPORTING_COMPLETENESS_SCHEMA_VERSION,
    },
    grandTotal: grand,
    stores: storeMap,
    storeRankings: storeRanking,
    formalStoreRankings: formalStoreRanking.rankings,
    formalRankEligibleStoreCount: formalStoreRanking.rankEligibleStoreCount,
    managers: managerMap,
    dailyTotals,
    storeDailyTotals,
    storeTop3: {
      today: storeRevenueByDate(todayStr),
      yesterday: storeRevenueByDate(yesterdayStr),
      monthly: storeRanking.slice(0, 3).map((s) => ({ name: s.displayName, store: s.store, revenue: s.cash, manager: s.manager })),
    },
    sourceCounts: { dailyReports: dailyRows.length, targetStores: Object.keys(targets).length, stores: Object.keys(storeMap).length },
    lastUpdatedAt: nowTimestamp,
    lastUpdatedAtText: nowIso,
    source: "auto_summary_repair",
    version: "dashboard-summary-v2",
  };

  const therapistSummary = {
    brandId,
    brandLabel,
    yearMonth,
    monthStart: range.start,
    monthEnd: range.end,
    therapistKpiSemanticVersion: THERAPIST_KPI_SEMANTIC_VERSION,
    grandTotal: therapistGrand,
    rankings: therapistRankings,
    todayTop3: topTherapistsByDate(todayStr),
    yesterdayTop3: topTherapistsByDate(yesterdayStr),
    monthlyTop5: therapistRankings.slice(0, 5),
    sourceCounts: { therapistReports: therapistRows.length, therapists: therapistRankings.length },
    lastUpdatedAt: nowTimestamp,
    lastUpdatedAtText: nowIso,
    source: "auto_summary_repair",
    version: "therapist-summary-v1",
  };

  const rankingsSummary = {
    brandId,
    brandLabel,
    yearMonth,
    semanticVersion: SUMMARY_SEMANTIC_VERSION,
    kpiContractVersion: grand.kpiContractVersion || targetCoverage.kpiContractVersion || "",
    targetCoverage,
    formalTargetAuthority,
    lifecycleSnapshot: dashboardSummary.lifecycleSnapshot,
    storeTop3: dashboardSummary.storeTop3,
    storeRankings: storeRanking.map((s) => ({ store: s.store, displayName: s.displayName, manager: s.manager, cash: s.cash, budget: s.budget, achievement: s.achievement, rank: s.rank })),
    formalRankEligibleStoreCount: formalStoreRanking.rankEligibleStoreCount,
    formalStoreRankings: formalStoreRanking.rankings.map((s) => ({
      store: s.store,
      displayName: s.displayName,
      manager: s.manager,
      formalNetCash: s.formalNetCash,
      formalCashTarget: s.formalCashTarget,
      formalCashAchievement: s.formalCashAchievement,
      formalCashAchievementStatus: s.formalCashAchievementStatus,
      formalCashAchievementRank: s.formalCashAchievementRank,
      formalRankEligible: s.formalRankEligible,
    })),
    therapistKpiSemanticVersion: THERAPIST_KPI_SEMANTIC_VERSION,
    therapistTop3: { today: therapistSummary.todayTop3, yesterday: therapistSummary.yesterdayTop3, monthly: therapistSummary.monthlyTop5.slice(0, 3) },
    therapistRankings: therapistRankings.map((t) => ({ id: t.id, name: t.name, storeDisplay: t.storeDisplay, manager: t.manager, totalRevenue: t.totalRevenue, rank: t.rank, status: t.status })),
    lastUpdatedAt: nowTimestamp,
    lastUpdatedAtText: nowIso,
    source: "auto_summary_repair",
    version: "rankings-summary-v1",
  };

  return { dashboardSummary, therapistSummary, rankingsSummary, brandLabel };
}

function getAutoMetricValue(obj, path, fallback = 0) {
  return path.split(".").reduce((acc, key) => (
    acc !== null && acc !== undefined && acc[key] !== undefined ? acc[key] : fallback
  ), obj || {});
}

function buildAutoReportingCompletenessSignature(summary = {}) {
  const completeness = summary?.reportingCompleteness && typeof summary.reportingCompleteness === "object"
    ? summary.reportingCompleteness
    : {};
  const stores = completeness?.stores && typeof completeness.stores === "object" && !Array.isArray(completeness.stores)
    ? completeness.stores
    : {};
  const storeRows = Object.entries(stores)
    .map(([storeKey, row]) => ({
      storeKey,
      expected: Number(row?.expectedReportDayCount || 0),
      submitted: Number(row?.submittedReportDayCount || 0),
      missing: Number(row?.missingReportDayCount || 0),
      status: String(row?.reportingStatus || ""),
      fullMonthLifecycleEligible: row?.fullMonthLifecycleEligible === true,
    }))
    .sort((a, b) => a.storeKey.localeCompare(b.storeKey, "zh-Hant"));
  return JSON.stringify({
    schemaVersion: String(completeness?.schemaVersion || ""),
    cutoffDate: String(completeness?.cutoffDate || ""),
    lifecycleReady: completeness?.lifecycleReady === true,
    eligibleStoreCount: Number(completeness?.eligibleStoreCount || 0),
    expectedStoreDayCount: Number(completeness?.expectedStoreDayCount || 0),
    submittedStoreDayCount: Number(completeness?.submittedStoreDayCount || 0),
    missingStoreDayCount: Number(completeness?.missingStoreDayCount || 0),
    reportingStatus: String(completeness?.reportingStatus || ""),
    stores: storeRows,
  });
}

function makeAutoSummaryCompareRows({ storedDashboard, storedTherapist, storedRankings, freshDashboard, freshTherapist, freshRankings }) {
  const rows = [
    { label: "現金業績（legacy）", stored: getAutoMetricValue(storedDashboard, "grandTotal.cash"), fresh: getAutoMetricValue(freshDashboard, "grandTotal.cash"), type: "money" },
    { label: "權責業績（legacy）", stored: getAutoMetricValue(storedDashboard, "grandTotal.accrual"), fresh: getAutoMetricValue(freshDashboard, "grandTotal.accrual"), type: "money" },
    { label: "Gross Cash", stored: getAutoMetricValue(storedDashboard, "grandTotal.grossCash", null), fresh: getAutoMetricValue(freshDashboard, "grandTotal.grossCash", null), type: "money", exactNull: true },
    { label: "General Refund", stored: getAutoMetricValue(storedDashboard, "grandTotal.refund", null), fresh: getAutoMetricValue(freshDashboard, "grandTotal.refund", null), type: "money", exactNull: true },
    { label: "Skincare Refund", stored: getAutoMetricValue(storedDashboard, "grandTotal.skincareRefund", null), fresh: getAutoMetricValue(freshDashboard, "grandTotal.skincareRefund", null), type: "money", exactNull: true },
    { label: "Formal 淨現金", stored: getAutoMetricValue(storedDashboard, "grandTotal.formalNetCash", null), fresh: getAutoMetricValue(freshDashboard, "grandTotal.formalNetCash", null), type: "money", exactNull: true },
    { label: "總權責", stored: getAutoMetricValue(storedDashboard, "grandTotal.totalAccrual", null), fresh: getAutoMetricValue(freshDashboard, "grandTotal.totalAccrual", null), type: "money", exactNull: true },
    { label: "Formal 權責", stored: getAutoMetricValue(storedDashboard, "grandTotal.formalAccrual", null), fresh: getAutoMetricValue(freshDashboard, "grandTotal.formalAccrual", null), type: "money", exactNull: true },
    { label: "Gross Cash 狀態", stored: getAutoMetricValue(storedDashboard, "grandTotal.grossCashStatus", ""), fresh: getAutoMetricValue(freshDashboard, "grandTotal.grossCashStatus", ""), type: "text", exact: true },
    { label: "General Refund 狀態", stored: getAutoMetricValue(storedDashboard, "grandTotal.refundStatus", ""), fresh: getAutoMetricValue(freshDashboard, "grandTotal.refundStatus", ""), type: "text", exact: true },
    { label: "Skincare Refund 狀態", stored: getAutoMetricValue(storedDashboard, "grandTotal.skincareRefundStatus", ""), fresh: getAutoMetricValue(freshDashboard, "grandTotal.skincareRefundStatus", ""), type: "text", exact: true },
    { label: "Formal 淨現金狀態", stored: getAutoMetricValue(storedDashboard, "grandTotal.formalNetCashStatus", ""), fresh: getAutoMetricValue(freshDashboard, "grandTotal.formalNetCashStatus", ""), type: "text", exact: true },
    { label: "總權責狀態", stored: getAutoMetricValue(storedDashboard, "grandTotal.totalAccrualStatus", ""), fresh: getAutoMetricValue(freshDashboard, "grandTotal.totalAccrualStatus", ""), type: "text", exact: true },
    { label: "Formal 權責狀態", stored: getAutoMetricValue(storedDashboard, "grandTotal.formalAccrualStatus", ""), fresh: getAutoMetricValue(freshDashboard, "grandTotal.formalAccrualStatus", ""), type: "text", exact: true },
    { label: "Formal 現金目標", stored: getAutoMetricValue(storedDashboard, "grandTotal.formalCashTarget", null), fresh: getAutoMetricValue(freshDashboard, "grandTotal.formalCashTarget", null), type: "money", exactNull: true },
    { label: "Formal 權責目標", stored: getAutoMetricValue(storedDashboard, "grandTotal.formalAccrualTarget", null), fresh: getAutoMetricValue(freshDashboard, "grandTotal.formalAccrualTarget", null), type: "money", exactNull: true },
    { label: "Formal 現金達成狀態", stored: getAutoMetricValue(storedDashboard, "grandTotal.formalCashAchievementStatus", ""), fresh: getAutoMetricValue(freshDashboard, "grandTotal.formalCashAchievementStatus", ""), type: "text", exact: true },
    { label: "Formal 權責達成狀態", stored: getAutoMetricValue(storedDashboard, "grandTotal.formalAccrualAchievementStatus", ""), fresh: getAutoMetricValue(freshDashboard, "grandTotal.formalAccrualAchievementStatus", ""), type: "text", exact: true },
    { label: "Cash Coverage", stored: getAutoMetricValue(storedDashboard, "targetCoverage.cashCoverageComplete", null), fresh: getAutoMetricValue(freshDashboard, "targetCoverage.cashCoverageComplete", null), type: "boolean", exact: true },
    { label: "Accrual Coverage", stored: getAutoMetricValue(storedDashboard, "targetCoverage.accrualCoverageComplete", null), fresh: getAutoMetricValue(freshDashboard, "targetCoverage.accrualCoverageComplete", null), type: "boolean", exact: true },
    { label: "Eligible Store Count", stored: getAutoMetricValue(storedDashboard, "formalTargetAuthority.eligibleStoreCount", null), fresh: getAutoMetricValue(freshDashboard, "formalTargetAuthority.eligibleStoreCount", null), type: "count", exactNull: true },
    { label: "Formal Cash Target Total", stored: getAutoMetricValue(storedDashboard, "formalTargetAuthority.cashTargetTotal", null), fresh: getAutoMetricValue(freshDashboard, "formalTargetAuthority.cashTargetTotal", null), type: "money", exactNull: true },
    { label: "Formal Accrual Target Total", stored: getAutoMetricValue(storedDashboard, "formalTargetAuthority.accrualTargetTotal", null), fresh: getAutoMetricValue(freshDashboard, "formalTargetAuthority.accrualTargetTotal", null), type: "money", exactNull: true },
    { label: "Formal Target Coverage Consistent", stored: getAutoMetricValue(storedDashboard, "formalTargetAuthority.coverageConsistent", null), fresh: getAutoMetricValue(freshDashboard, "formalTargetAuthority.coverageConsistent", null), type: "boolean", exact: true },
    { label: "Lifecycle Ready", stored: getAutoMetricValue(storedDashboard, "formalTargetAuthority.lifecycleReady", null), fresh: getAutoMetricValue(freshDashboard, "formalTargetAuthority.lifecycleReady", null), type: "boolean", exact: true },
    { label: "Reporting Completeness Version", stored: getAutoMetricValue(storedDashboard, "reportingCompleteness.schemaVersion", ""), fresh: getAutoMetricValue(freshDashboard, "reportingCompleteness.schemaVersion", ""), type: "text", exact: true },
    { label: "Reporting Status", stored: getAutoMetricValue(storedDashboard, "reportingCompleteness.reportingStatus", ""), fresh: getAutoMetricValue(freshDashboard, "reportingCompleteness.reportingStatus", ""), type: "text", exact: true },
    { label: "Expected Store-Day Count", stored: getAutoMetricValue(storedDashboard, "reportingCompleteness.expectedStoreDayCount", null), fresh: getAutoMetricValue(freshDashboard, "reportingCompleteness.expectedStoreDayCount", null), type: "count", exactNull: true },
    { label: "Submitted Store-Day Count", stored: getAutoMetricValue(storedDashboard, "reportingCompleteness.submittedStoreDayCount", null), fresh: getAutoMetricValue(freshDashboard, "reportingCompleteness.submittedStoreDayCount", null), type: "count", exactNull: true },
    { label: "Missing Store-Day Count", stored: getAutoMetricValue(storedDashboard, "reportingCompleteness.missingStoreDayCount", null), fresh: getAutoMetricValue(freshDashboard, "reportingCompleteness.missingStoreDayCount", null), type: "count", exactNull: true },
    { label: "Store Reporting Signature", stored: buildAutoReportingCompletenessSignature(storedDashboard), fresh: buildAutoReportingCompletenessSignature(freshDashboard), type: "text", exact: true },
    { label: "Formal Rank Eligible Count", stored: getAutoMetricValue(storedDashboard, "formalRankEligibleStoreCount", null), fresh: getAutoMetricValue(freshDashboard, "formalRankEligibleStoreCount", null), type: "count", exactNull: true },
    { label: "Summary Semantic Version", stored: getAutoMetricValue(storedDashboard, "semanticVersion", ""), fresh: getAutoMetricValue(freshDashboard, "semanticVersion", ""), type: "text", exact: true },
    { label: "Store-level Formal Signature", stored: buildSummaryStoreSemanticSignature(storedDashboard), fresh: buildSummaryStoreSemanticSignature(freshDashboard), type: "text", exact: true },
    { label: "Ranking Semantic Version", stored: getAutoMetricValue(storedRankings, "semanticVersion", ""), fresh: getAutoMetricValue(freshRankings, "semanticVersion", ""), type: "text", exact: true },
    { label: "Formal Ranking Eligible Count", stored: getAutoMetricValue(storedRankings, "formalRankEligibleStoreCount", null), fresh: getAutoMetricValue(freshRankings, "formalRankEligibleStoreCount", null), type: "count", exactNull: true },
    { label: "Formal Ranking Signature", stored: buildFormalRankingSignature(storedRankings), fresh: buildFormalRankingSignature(freshRankings), type: "text", exact: true },
    { label: "Therapist KPI Signature", stored: buildTherapistSummarySignature(storedTherapist), fresh: buildTherapistSummarySignature(freshTherapist), type: "text", exact: true },
    { label: "人員業績", stored: getAutoMetricValue(storedTherapist, "grandTotal.totalRevenue"), fresh: getAutoMetricValue(freshTherapist, "grandTotal.totalRevenue"), type: "money" },
    { label: "店日報筆數", stored: getAutoMetricValue(storedDashboard, "sourceCounts.dailyReports"), fresh: getAutoMetricValue(freshDashboard, "sourceCounts.dailyReports"), type: "count" },
    { label: "管理師日報筆數", stored: getAutoMetricValue(storedTherapist, "sourceCounts.therapistReports"), fresh: getAutoMetricValue(freshTherapist, "sourceCounts.therapistReports"), type: "count" },
    { label: "店家數", stored: getAutoMetricValue(storedDashboard, "sourceCounts.stores"), fresh: getAutoMetricValue(freshDashboard, "sourceCounts.stores"), type: "count" },
    { label: "管理師數", stored: getAutoMetricValue(storedTherapist, "sourceCounts.therapists"), fresh: getAutoMetricValue(freshTherapist, "sourceCounts.therapists"), type: "count" },
    { label: "目標店數", stored: getAutoMetricValue(storedDashboard, "sourceCounts.targetStores"), fresh: getAutoMetricValue(freshDashboard, "sourceCounts.targetStores"), type: "count" },
  ];

  return rows.map((row) => {
    if (row.exact === true || row.type === "text" || row.type === "boolean") {
      return {
        ...row,
        diff: null,
        diffRate: null,
        matched: Object.is(row.stored, row.fresh),
      };
    }

    if (row.exactNull === true && (row.stored === null || row.fresh === null)) {
      return {
        ...row,
        diff: null,
        diffRate: null,
        matched: row.stored === row.fresh,
      };
    }

    const storedNumber = Number(row.stored);
    const freshNumber = Number(row.fresh);
    const bothFinite = Number.isFinite(storedNumber) && Number.isFinite(freshNumber);
    const diff = bothFinite ? storedNumber - freshNumber : null;
    const diffRate = bothFinite
      ? (freshNumber !== 0 ? (diff / freshNumber) * 100 : (diff === 0 ? 0 : 100))
      : null;
    return { ...row, diff, diffRate, matched: bothFinite && Math.abs(diff) < 0.0001 };
  });
}

async function loadPendingQueueRowsForAutoRepair(brandId, yearMonth) {
  const queueRef = getSummaryCollection(brandId, "recalc_queue");

  // 正常主流程直接由 Firestore 篩出「指定月份 + pending」，避免先讀完整月份 queue
  // 再於 Node.js 過濾 status，降低已 completed / ignored 等歷史文件造成的 reads。
  // 兩個條件皆為 equality (==)，不新增 orderBy / range；保留舊月份查詢作為容錯 fallback。
  try {
    const exactPendingSnap = await queueRef
      .where("affectedYearMonth", "==", yearMonth)
      .where("status", "==", "pending")
      .get();

    return exactPendingSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
  } catch (error) {
    console.warn(
      `⚠️ Summary 自動修復：recalc_queue 精準查詢失敗，退回月份查詢 ${brandId}/${yearMonth}`,
      error?.message || error
    );

    // 容錯：若環境索引設定或 Firestore 查詢暫時異常，維持修正前的查詢行為，
    // 先讀指定月份再於程式端保留 pending，避免歷史 Summary 修復流程中斷。
    const exactMonthSnap = await queueRef
      .where("affectedYearMonth", "==", yearMonth)
      .get();

    return exactMonthSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
      .filter((row) => String(row.status || "") === "pending");
  }
}

async function markAutoRecalcQueueCompleted(brandId, yearMonth, rows = [], resultText = "") {
  if (!rows.length) return 0;

  let batch = db.batch();
  let pendingWrites = 0;
  let updated = 0;
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    if (!row.id) continue;
    batch.update(getSummaryCollection(brandId, "recalc_queue").doc(row.id), {
      status: "completed",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedAtText: nowIso,
      completedBy: "auto_summary_repair_worker",
      completedByRole: "system",
      calibrationResult: resultText ? String(resultText).slice(0, 500) : "auto_completed",
    });
    pendingWrites += 1;
    updated += 1;
    if (pendingWrites >= 450) {
      await batch.commit();
      batch = db.batch();
      pendingWrites = 0;
    }
  }

  if (pendingWrites > 0) await batch.commit();
  return updated;
}

async function writeAutoMaintenanceLog(brandId, payload) {
  const brandLabel = payload.brandLabel || await getSummaryBrandLabel(brandId);
  return getSummaryCollection(brandId, "maintenance_logs").add({
    brandId,
    brandLabel,
    operator: "auto_summary_repair_worker",
    operatorRole: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtText: new Date().toISOString(),
    ...payload,
  });
}

async function finalizeMonthReportAuto({ brandId, yearMonth, trigger = "auto_worker", force = false }) {
  if (!brandId || !/^\d{4}-\d{2}$/.test(String(yearMonth || ""))) {
    throw new Error("brandId 或 yearMonth 格式錯誤");
  }

  // 非正式使用期間不應建立 0 業績 Summary，也不應進入 monthly_targets full fallback。
  // force=true 保留人工診斷能力；一般排程 / 非強制手動呼叫則安全略過。
  if (!force && isBeforeSummaryRepairDataStartMonth(brandId, yearMonth)) {
    return {
      skipped: true,
      reason: "before_brand_data_start_month",
      brandId,
      yearMonth,
      dataStartMonth: getSummaryRepairDataStartMonth(brandId),
    };
  }

  const flagRef = getSummaryCollection(brandId, "summary_recalc_flags").doc(yearMonth);
  const flagSnap = await flagRef.get();
  const flagData = flagSnap.exists ? flagSnap.data() || {} : {};

  if (!force && !isHistoricalYearMonthForAutoRepair(yearMonth)) {
    return { skipped: true, reason: "not_historical_month", brandId, yearMonth, currentMonth: getTaipeiYearMonthForAutoRepair() };
  }

  const hasQueueFallback = Number(arguments?.[0]?.pendingCount || 0) > 0 && Array.isArray(arguments?.[0]?.sources) && arguments[0].sources.includes("recalc_queue");

  if (!force) {
    const status = String(flagData.status || "");
    // 若 recalc_queue 仍有 pending，即使 flag 已是 verified，也要允許重跑一次並把 queue 清乾淨。
    if (!hasQueueFallback && status && status !== "dirty" && status !== "mismatch" && status !== "pending") {
      return { skipped: true, reason: `status_is_${status}`, brandId, yearMonth };
    }
    if (flagData.rebuildAfterAtText && !hasQueueFallback) {
      const rebuildAt = new Date(flagData.rebuildAfterAtText);
      if (!Number.isNaN(rebuildAt.getTime()) && rebuildAt.getTime() > Date.now()) {
        return { skipped: true, reason: "debounce_not_ready", brandId, yearMonth, rebuildAfterAtText: flagData.rebuildAfterAtText };
      }
    }
  }

  const lockId = `auto_${Date.now()}`;
  const lockUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.runTransaction(async (tx) => {
    const latestSnap = await tx.get(flagRef);
    const latest = latestSnap.exists ? latestSnap.data() || {} : {};
    const latestStatus = String(latest.status || "");
    const latestLockUntil = latest.lockUntilText ? new Date(latest.lockUntilText).getTime() : 0;

    if (!force && latestStatus === "rebuilding" && latestLockUntil > Date.now()) {
      throw new Error(`此月份正在整理中，鎖定到 ${latest.lockUntilText}`);
    }

    if (!force && latest.rebuildAfterAtText && !hasQueueFallback) {
      const rebuildAt = new Date(latest.rebuildAfterAtText);
      if (!Number.isNaN(rebuildAt.getTime()) && rebuildAt.getTime() > Date.now()) {
        throw new Error(`尚未到整理時間：${latest.rebuildAfterAtText}`);
      }
    }

    tx.set(flagRef, {
      brandId,
      yearMonth,
      affectedYearMonth: yearMonth,
      status: "rebuilding",
      dirty: true,
      lockedBy: "auto_summary_repair_worker",
      lockId,
      lockedAt: admin.firestore.FieldValue.serverTimestamp(),
      lockedAtText: new Date().toISOString(),
      lockUntilText: lockUntil,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: new Date().toISOString(),
    }, { merge: true });
  });

  let isMatched = false;
  let mismatchRows = [];
  let completedCount = 0;
  let buildReport = null;
  let compareReport = null;
  let brandLabel = await getSummaryBrandLabel(brandId);

  try {
    await writeAutoMaintenanceLog(brandId, { type: "dashboard_summary", action: "start_auto_month_report_finalize", month: yearMonth, status: "started", trigger, lockId, brandLabel });

    const { dashboardSummary, therapistSummary, rankingsSummary } = await buildAutoDashboardSummaryPayloads(brandId, yearMonth);
    brandLabel = dashboardSummary.brandLabel || brandLabel;

    const batch = db.batch();
    batch.set(getSummaryCollection(brandId, "dashboard_summary").doc(yearMonth), dashboardSummary);
    batch.set(getSummaryCollection(brandId, "therapist_summary").doc(yearMonth), therapistSummary);
    batch.set(getSummaryCollection(brandId, "rankings_summary").doc(yearMonth), rankingsSummary);
    await batch.commit();

    // Trust fix：寫入後重新讀取 Firestore persisted Summary，再與同次 Raw rebuild payload 比對。
    // 不再用剛 build 的 object 自己跟自己比，避免 false verified。
    const [storedDashboardSnap, storedTherapistSnap, storedRankingsSnap] = await Promise.all([
      getSummaryCollection(brandId, "dashboard_summary").doc(yearMonth).get(),
      getSummaryCollection(brandId, "therapist_summary").doc(yearMonth).get(),
      getSummaryCollection(brandId, "rankings_summary").doc(yearMonth).get(),
    ]);
    if (!storedDashboardSnap.exists || !storedTherapistSnap.exists || !storedRankingsSnap.exists) {
      throw new Error("Summary 寫入後讀回失敗，無法完成 Raw ↔ persisted Summary 驗證");
    }
    const rows = makeAutoSummaryCompareRows({
      storedDashboard: storedDashboardSnap.data() || {},
      storedTherapist: storedTherapistSnap.data() || {},
      storedRankings: storedRankingsSnap.data() || {},
      freshDashboard: dashboardSummary,
      freshTherapist: therapistSummary,
      freshRankings: rankingsSummary,
    });
    mismatchRows = rows.filter((row) => !row.matched);
    isMatched = mismatchRows.length === 0;

    const pendingRows = await loadPendingQueueRowsForAutoRepair(brandId, yearMonth);
    completedCount = await markAutoRecalcQueueCompleted(brandId, yearMonth, pendingRows, isMatched ? "auto_month_report_finalized" : "auto_month_report_mismatch");

    buildReport = {
      month: yearMonth,
      dailyReports: dashboardSummary.sourceCounts.dailyReports,
      therapistReports: therapistSummary.sourceCounts.therapistReports,
      stores: dashboardSummary.sourceCounts.stores,
      therapists: therapistSummary.sourceCounts.therapists,
      cash: dashboardSummary.grandTotal.cash,
      accrual: dashboardSummary.grandTotal.accrual,
      therapistRevenue: therapistSummary.grandTotal.totalRevenue,
      targetStores: dashboardSummary.sourceCounts.targetStores,
      reportingStatus: dashboardSummary.reportingCompleteness?.reportingStatus || "",
      expectedStoreDays: Number(dashboardSummary.reportingCompleteness?.expectedStoreDayCount || 0),
      submittedStoreDays: Number(dashboardSummary.reportingCompleteness?.submittedStoreDayCount || 0),
      missingStoreDays: Number(dashboardSummary.reportingCompleteness?.missingStoreDayCount || 0),
      reportingIncompleteStores: Number(dashboardSummary.reportingCompleteness?.incompleteStoreCount || 0),
      writtenDocs: 3,
      createdAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      source: "auto_summary_repair_worker",
    };

    compareReport = {
      month: yearMonth,
      matched: isMatched,
      status: isMatched ? "全部一致" : "發現差異",
      mismatchCount: mismatchRows.length,
      rows,
      storedUpdatedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      comparedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      source: "auto_summary_repair_worker",
    };

    await getSummaryCollection(brandId, "calibration_logs").add({
      brandId,
      brandLabel,
      month: yearMonth,
      status: isMatched ? "success" : "mismatch",
      source: "auto_month_report_finalize",
      result: { buildReport, mismatchCount: mismatchRows.length, completedQueueCount: completedCount },
      operator: "auto_summary_repair_worker",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtText: new Date().toISOString(),
    });

    await writeAutoMaintenanceLog(brandId, {
      type: "dashboard_summary",
      action: "compare_summary_with_raw",
      month: yearMonth,
      status: isMatched ? "matched" : "mismatch",
      mismatchCount: mismatchRows.length,
      result: compareReport,
      source: "auto_summary_repair_worker",
      brandLabel,
    });

    await writeAutoMaintenanceLog(brandId, {
      type: "dashboard_summary",
      action: "auto_month_report_finalize",
      month: yearMonth,
      status: isMatched ? "matched" : "mismatch",
      mismatchCount: mismatchRows.length,
      completedQueueCount: completedCount,
      trigger,
      lockId,
      brandLabel,
    });

    await flagRef.set({
      brandId,
      brandLabel,
      yearMonth,
      affectedYearMonth: yearMonth,
      status: isMatched ? "verified" : "mismatch",
      dirty: !isMatched,
      pendingCount: isMatched ? 0 : completedCount,
      lastCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastCompletedAtText: new Date().toISOString(),
      lastCompletedBy: "auto_summary_repair_worker",
      lastCompletedByRole: "system",
      lastResult: isMatched ? "auto_month_report_finalized" : "auto_month_report_mismatch",
      lastMismatchCount: mismatchRows.length,
      completedQueueCount: completedCount,
      lockedBy: admin.firestore.FieldValue.delete(),
      lockId: admin.firestore.FieldValue.delete(),
      lockUntilText: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: new Date().toISOString(),
    }, { merge: true });

    return { brandId, yearMonth, matched: isMatched, mismatchCount: mismatchRows.length, completedQueueCount: completedCount, buildReport, compareReport };
  } catch (error) {
    await flagRef.set({
      brandId,
      brandLabel,
      yearMonth,
      affectedYearMonth: yearMonth,
      status: "dirty",
      dirty: true,
      lastError: error.message,
      lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
      lastErrorAtText: new Date().toISOString(),
      lockedBy: admin.firestore.FieldValue.delete(),
      lockId: admin.firestore.FieldValue.delete(),
      lockUntilText: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: new Date().toISOString(),
    }, { merge: true });

    await writeAutoMaintenanceLog(brandId, {
      type: "dashboard_summary",
      action: "fail_auto_month_report_finalize",
      month: yearMonth,
      status: "failed",
      errorMessage: error.message,
      trigger,
      lockId,
      brandLabel,
    });
    throw error;
  }
}

async function collectReadyDirtySummaryFlags() {
  const jobs = [];
  const jobMap = new Map();
  const now = Date.now();

  const addJob = (job) => {
    const brandId = String(job.brandId || "").trim();
    const yearMonth = String(job.yearMonth || "").trim();
    if (!brandId || !/^\d{4}-\d{2}$/.test(yearMonth)) return;
    const key = `${brandId}_${yearMonth}`;
    const existing = jobMap.get(key);
    if (existing) {
      jobMap.set(key, {
        ...existing,
        ...job,
        pendingCount: Math.max(Number(existing.pendingCount || 0), Number(job.pendingCount || 0)),
        sources: Array.from(new Set([...(existing.sources || []), ...(job.sources || [])])),
      });
      return;
    }
    jobMap.set(key, { ...job, brandId, yearMonth, sources: job.sources || [] });
  };

  const getQueueMonth = (row = {}) => {
    const raw = row.affectedYearMonth || row.yearMonth || String(row.date || row.sourceDate || "").slice(0, 7);
    return /^\d{4}-\d{2}$/.test(String(raw || "")) ? String(raw) : "";
  };

  for (const brandId of SUMMARY_REPAIR_BRANDS) {
    // 來源 A：summary_recalc_flags。這是最理想的 dirty 標記來源。
    try {
      const flagSnap = await getSummaryCollection(brandId, "summary_recalc_flags")
        .where("status", "in", ["dirty", "mismatch", "pending"])
        .limit(20)
        .get();

      const flagCleanupBatch = db.batch();
      let flagCleanupCount = 0;
      const currentYearMonth = getTaipeiYearMonthForAutoRepair();
      const cleanupAtText = new Date(now).toISOString();

      flagSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const yearMonth = data.affectedYearMonth || data.yearMonth || docSnap.id;
        if (!/^\d{4}-\d{2}$/.test(String(yearMonth || ""))) {
          flagCleanupBatch.set(docSnap.ref, {
            status: "invalid",
            dirty: false,
            pendingCount: 0,
            cleanupReason: "invalid_year_month",
            cleanedBy: "auto_summary_repair_worker",
            cleanedAt: admin.firestore.FieldValue.serverTimestamp(),
            cleanedAtText: cleanupAtText,
          }, { merge: true });
          flagCleanupCount += 1;
          return;
        }

        // 當月與未來月份使用即時明細，不應持續保留 dirty / pending flag。
        if (!isHistoricalYearMonthForAutoRepair(yearMonth)) {
          flagCleanupBatch.set(docSnap.ref, {
            status: yearMonth === currentYearMonth ? "ignored_live_month" : "ignored_future_month",
            dirty: false,
            pendingCount: 0,
            cleanupReason: yearMonth === currentYearMonth ? "live_month_uses_detail" : "future_month_not_supported",
            cleanedBy: "auto_summary_repair_worker",
            cleanedAt: admin.firestore.FieldValue.serverTimestamp(),
            cleanedAtText: cleanupAtText,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: cleanupAtText,
          }, { merge: true });
          flagCleanupCount += 1;
          return;
        }

        // 品牌正式使用本系統前的歷史月份不是「資料遺失」；
        // 直接結案，避免舊 dirty flag 每 5 分鐘反覆觸發 Summary rebuild。
        if (isBeforeSummaryRepairDataStartMonth(brandId, yearMonth)) {
          flagCleanupBatch.set(docSnap.ref, {
            status: "ignored_pre_system_month",
            dirty: false,
            pendingCount: 0,
            cleanupReason: "before_brand_data_start_month",
            dataStartMonth: getSummaryRepairDataStartMonth(brandId),
            lastError: admin.firestore.FieldValue.delete(),
            lastErrorAt: admin.firestore.FieldValue.delete(),
            lastErrorAtText: admin.firestore.FieldValue.delete(),
            rebuildAfterAtText: admin.firestore.FieldValue.delete(),
            lockedBy: admin.firestore.FieldValue.delete(),
            lockId: admin.firestore.FieldValue.delete(),
            lockUntilText: admin.firestore.FieldValue.delete(),
            cleanedBy: "auto_summary_repair_worker",
            cleanedAt: admin.firestore.FieldValue.serverTimestamp(),
            cleanedAtText: cleanupAtText,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: cleanupAtText,
          }, { merge: true });
          flagCleanupCount += 1;
          return;
        }

        const rebuildAtText = data.rebuildAfterAtText || data.updatedAtText || data.lastDirtyAtText || "";
        if (rebuildAtText) {
          const t = new Date(rebuildAtText).getTime();
          if (!Number.isNaN(t) && t > now) return;
        }

        addJob({
          brandId,
          yearMonth,
          status: data.status || "dirty",
          pendingCount: Number(data.pendingCount || 0),
          rebuildAfterAtText: data.rebuildAfterAtText || "",
          sources: ["summary_recalc_flags"],
        });
      });

      if (flagCleanupCount > 0) await flagCleanupBatch.commit();
    } catch (error) {
      console.warn(`⚠️ Summary 自動修復：讀取 flags 失敗 ${brandId}`, error.message);
    }

    // 來源 B：recalc_queue pending 防漏巡檢。
    // 正常主流程仍由 flags 每 5 分鐘處理；Queue fallback 平時每 30 分鐘只讀 50 筆並用游標分頁，
    // 若本頁讀滿 50 筆，表示仍可能有下一頁，暫時每 5 分鐘續掃直到 backlog 消化完畢。
    // 保留「flag 漏寫／舊格式 queue」的補救能力，同時避免固定重讀同一批 500 筆。
    try {
      const fallbackPage = await loadPendingQueueFallbackPage(brandId, now);
      if (!fallbackPage.due) continue;

      const queueGroups = {};
      const queueCleanupBatch = db.batch();
      let normalizedCount = 0;
      let ignoredLiveCount = 0;
      let ignoredFutureCount = 0;
      let ignoredPreSystemCount = 0;
      let invalidCount = 0;
      let actionableCount = 0;
      const normalizedAtText = new Date(now).toISOString();
      const currentYearMonth = getTaipeiYearMonthForAutoRepair();

      fallbackPage.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const yearMonth = getQueueMonth(data);

        if (!yearMonth) {
          queueCleanupBatch.set(docSnap.ref, {
            status: "invalid",
            cleanupReason: "invalid_year_month",
            cleanedBy: "auto_summary_queue_fallback",
            cleanedAt: admin.firestore.FieldValue.serverTimestamp(),
            cleanedAtText: normalizedAtText,
          }, { merge: true });
          invalidCount += 1;
          return;
        }

        const needsNormalization = !/^\d{4}-\d{2}$/.test(String(data.affectedYearMonth || ""));

        // 本月使用即時明細，未來月份不支援；兩者都不應永久保持 pending。
        if (!isHistoricalYearMonthForAutoRepair(yearMonth)) {
          const isLiveMonth = yearMonth === currentYearMonth;
          queueCleanupBatch.set(docSnap.ref, {
            ...(needsNormalization ? {
              affectedYearMonth: yearMonth,
              normalizedBy: "auto_summary_queue_fallback",
              normalizedAt: admin.firestore.FieldValue.serverTimestamp(),
              normalizedAtText,
            } : {}),
            status: isLiveMonth ? "ignored_live_month" : "ignored_future_month",
            cleanupReason: isLiveMonth ? "live_month_uses_detail" : "future_month_not_supported",
            cleanedBy: "auto_summary_queue_fallback",
            cleanedAt: admin.firestore.FieldValue.serverTimestamp(),
            cleanedAtText: normalizedAtText,
          }, { merge: true });
          if (needsNormalization) normalizedCount += 1;
          if (isLiveMonth) ignoredLiveCount += 1;
          else ignoredFutureCount += 1;
          return;
        }

        // 品牌正式使用本系統前的歷史月份不應進入 Summary repair queue。
        // 在建立 queueGroups 前直接結案，避免 fallback 再把它重新加回 jobMap。
        if (isBeforeSummaryRepairDataStartMonth(brandId, yearMonth)) {
          queueCleanupBatch.set(docSnap.ref, {
            ...(needsNormalization ? {
              affectedYearMonth: yearMonth,
              normalizedBy: "auto_summary_queue_fallback",
              normalizedAt: admin.firestore.FieldValue.serverTimestamp(),
              normalizedAtText,
            } : {}),
            status: "ignored_pre_system_month",
            cleanupReason: "before_brand_data_start_month",
            dataStartMonth: getSummaryRepairDataStartMonth(brandId),
            cleanedBy: "auto_summary_queue_fallback",
            cleanedAt: admin.firestore.FieldValue.serverTimestamp(),
            cleanedAtText: normalizedAtText,
          }, { merge: true });
          if (needsNormalization) normalizedCount += 1;
          ignoredPreSystemCount += 1;
          return;
        }

        // 舊格式相容：歷史 queue 可能只有 yearMonth / date / sourceDate。
        if (needsNormalization) {
          queueCleanupBatch.set(docSnap.ref, {
            affectedYearMonth: yearMonth,
            normalizedBy: "auto_summary_queue_fallback",
            normalizedAt: admin.firestore.FieldValue.serverTimestamp(),
            normalizedAtText,
          }, { merge: true });
          normalizedCount += 1;
        }

        actionableCount += 1;
        if (!queueGroups[yearMonth]) {
          queueGroups[yearMonth] = { count: 0, latestAt: "" };
        }
        queueGroups[yearMonth].count += 1;
        const t = data.updatedAtText || data.createdAtText || data.date || data.sourceDate || "";
        if (!queueGroups[yearMonth].latestAt || String(t) > String(queueGroups[yearMonth].latestAt)) {
          queueGroups[yearMonth].latestAt = String(t);
        }
      });

      const cleanupCount = ignoredLiveCount + ignoredFutureCount + ignoredPreSystemCount + invalidCount;
      if (normalizedCount + cleanupCount > 0) await queueCleanupBatch.commit();

      // 防循環：連續三頁既沒有可處理月份，也沒有任何可清理／正規化資料時，暫停六小時。
      const madeProgress = actionableCount + cleanupCount + normalizedCount > 0 || fallbackPage.docs.length === 0;
      const consecutiveNoProgressPages = madeProgress ? 0 : Number(fallbackPage.previousNoProgressPages || 0) + 1;
      const pauseForNoProgress = consecutiveNoProgressPages >= 3;
      const statePatch = {
        lastScannedCount: fallbackPage.docs.length,
        lastActionableCount: actionableCount,
        lastNormalizedCount: normalizedCount,
        lastIgnoredLiveCount: ignoredLiveCount,
        lastIgnoredFutureCount: ignoredFutureCount,
        lastIgnoredPreSystemCount: ignoredPreSystemCount,
        lastInvalidCount: invalidCount,
        consecutiveNoProgressPages,
        lastCleanupAtText: normalizedAtText,
      };
      if (pauseForNoProgress) {
        const nextRunAfterMs = now + SUMMARY_QUEUE_FALLBACK_NO_PROGRESS_INTERVAL_MS;
        Object.assign(statePatch, {
          cursorDocId: "",
          scanMode: "paused_no_progress",
          nextRunAfterMs,
          nextRunAfterAtText: new Date(nextRunAfterMs).toISOString(),
          pauseReason: "three_pages_without_action_or_cleanup",
        });
      }
      await getSummaryQueueFallbackStateRef(brandId).set(statePatch, { merge: true });

      Object.entries(queueGroups).forEach(([yearMonth, group]) => {
        // recalc_queue 沒有 rebuildAfterAtText 時，代表 flag 可能漏寫。
        // 為避免待整理月份卡住，排程看到 pending queue 就允許處理。
        addJob({
          brandId,
          yearMonth,
          status: "pending_queue",
          pendingCount: Number(group.count || 0),
          latestPendingAt: group.latestAt || "",
          sources: ["recalc_queue"],
        });
      });
    } catch (error) {
      console.warn(`⚠️ Summary 自動修復：讀取 recalc_queue fallback 失敗 ${brandId}`, error.message);
    }
  }

  jobs.push(...Array.from(jobMap.values()).sort((a, b) => `${a.brandId}_${a.yearMonth}`.localeCompare(`${b.brandId}_${b.yearMonth}`)));
  return jobs;
}

exports.rebuildAnnualKpiSummaryNow = onRequest({ cors: true, timeoutSeconds: 540, memory: "512MiB" }, async (req, res) => {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }

  res.set("Access-Control-Allow-Origin", "*");

  try {
    const body = req.body || {};
    const rawBrandId = String(req.query.brandId || body.brandId || "all").trim().toLowerCase();
    const year = Number(req.query.year || body.year || getTaipeiYearForAnnualKpiSummary());
    const brands = rawBrandId === "all" ? SUMMARY_REPAIR_BRANDS : [rawBrandId || "cyj"];

    const results = [];
    for (const brandId of brands) {
      const result = await rebuildAnnualKpiSummaryForBrand(brandId, year, { trigger: "manual_http" });
      results.push({
        brandId: result.brandId,
        brandLabel: result.brandLabel,
        year: result.year,
        trafficMonthlyAverage: result.trafficMonthlyAverage,
        newCustomerMonthlyAverage: result.newCustomerMonthlyAverage,
        basedMonthCount: result.basedMonthCount,
        basedMonths: result.basedMonths,
        storeCount: result.storeCount || 0,
      });
    }

    return res.status(200).json({ ok: true, year, results });
  } catch (error) {
    console.error("rebuildAnnualKpiSummaryNow failed", error);
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

exports.rebuildAnnualKpiSummaries = onSchedule({ schedule: "20 5 * * *", timeZone: "Asia/Taipei", timeoutSeconds: 540, memory: "512MiB" }, async () => {
  const year = getTaipeiYearForAnnualKpiSummary();
  const results = [];

  for (const brandId of SUMMARY_REPAIR_BRANDS) {
    try {
      const result = await rebuildAnnualKpiSummaryForBrand(brandId, year, { trigger: "daily_schedule" });
      results.push({ brandId, year, basedMonthCount: result.basedMonthCount });
    } catch (error) {
      console.error(`rebuildAnnualKpiSummaries failed for ${brandId}`, error);
      results.push({ brandId, year, error: error.message || String(error) });
    }
  }

  console.log("rebuildAnnualKpiSummaries completed", results);
  return null;
});

exports.repairDirtySummaryNow = onRequest({ cors: true, timeoutSeconds: 540, memory: "1GiB" }, async (req, res) => {
  const brandId = String(req.query.brandId || "cyj").trim();
  const yearMonth = String(req.query.yearMonth || "").trim();
  const force = String(req.query.force || "false") === "true";

  try {
    const result = await finalizeMonthReportAuto({ brandId, yearMonth, trigger: "manual_http", force });
    res.status(200).json({ ok: true, result });
  } catch (error) {
    console.error("repairDirtySummaryNow failed", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

exports.repairDirtySummaries = onSchedule({ schedule: "every 5 minutes", timeZone: "Asia/Taipei", timeoutSeconds: 540, memory: "1GiB" }, async () => {
  const jobs = await collectReadyDirtySummaryFlags();
  if (!jobs.length) {
    console.log("✅ Summary 自動修復：目前沒有到期的 dirty / pending 月份。");
    return;
  }

  console.log(`🧾 Summary 自動修復：本次找到 ${jobs.length} 個待處理月份：${jobs.map((j) => `${j.brandId}/${j.yearMonth}/${(j.sources || []).join('+') || j.status}/${j.pendingCount || 0}`).join(', ')}`);

  for (const job of jobs) {
    try {
      const result = await finalizeMonthReportAuto({ ...job, trigger: "scheduled_worker", force: false });
      if (result?.skipped) {
        console.log(`⏭️ Summary 自動修復略過：${job.brandId}｜${job.yearMonth}｜${result.reason}`);
      } else {
        console.log(`✅ Summary 自動修復完成：${job.brandId}｜${job.yearMonth}｜matched=${result.matched}｜completed=${result.completedQueueCount}`);
      }
    } catch (error) {
      console.error(`❌ Summary 自動修復失敗：${job.brandId}｜${job.yearMonth}`, error);
    }
  }
});