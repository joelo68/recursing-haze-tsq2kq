const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const functions = require("firebase-functions/v1"); 
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

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
async function updateMonthlyAggregation(change, basePath) {
  const beforeData = change.before.data() || {};
  const afterData = change.after.data() || {};
  const storeName = afterData.storeName || beforeData.storeName;
  const date = afterData.date || beforeData.date;
  if (!storeName || !date) return null;
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
const BRANDS = [{ id: 'cyj', name: 'CYJ' }, { id: 'anniu', name: '安妞' }, { id: 'yibo', name: '伊啵' }];
const TELEGRAM_ALLOWED_CHAT_IDS = new Set([TARGET_CHAT_ID_MAIN, TARGET_CHAT_ID_MANAGER]);

function getTelegramBotToken() {
    const token = String(TELEGRAM_BOT_TOKEN_SECRET.value() || '').trim();
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN 尚未設定');
    return token;
}

function getTelegramApiUrl(method = 'sendMessage') {
    return `https://api.telegram.org/bot${getTelegramBotToken()}/${method}`;
}

function isTelegramChatAuthorized(chatId) {
    return TELEGRAM_ALLOWED_CHAT_IDS.has(String(chatId));
}

async function sendTelegramMessage(chatId, text, extra = {}) {
    return axios.post(getTelegramApiUrl('sendMessage'), {
        chat_id: String(chatId),
        text: String(text || ''),
        ...extra,
    });
}

// ==========================================
// ★ 2. DRCYJ Telegram 營運戰情 Agent v1
// Summary-first／最多三個工具／短期記憶／查詢稽核／成本護欄
// ==========================================
const TELEGRAM_AGENT_VERSION = "drcyj-agent-v1.5-alert-control-center";
const TELEGRAM_AGENT_MAX_TOOL_CALLS = 3;
const TELEGRAM_AGENT_MAX_READS = 2500;
const TELEGRAM_AGENT_MAX_DAILY_RANGE_DAYS = 31;
const TELEGRAM_AGENT_MAX_MACRO_MONTHS = 12;
const TELEGRAM_AGENT_MEMORY_TURNS = 8;
const TELEGRAM_AGENT_CACHE_TTL_MS = 2 * 60 * 1000;
const TELEGRAM_AGENT_TOOL_CACHE = new Map();


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

function getTelegramAgentMetricDictionary(keys = []) {
    const requested = Array.isArray(keys) && keys.length > 0 ? keys : Object.keys(TELEGRAM_AGENT_METRIC_DICTIONARY);
    return requested.reduce((acc, key) => {
        if (TELEGRAM_AGENT_METRIC_DICTIONARY[key]) acc[key] = TELEGRAM_AGENT_METRIC_DICTIONARY[key];
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
    const sourceConfidence = /daily_reports_current_month_exact|verified_dashboard_summary/.test(sourceText)
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
        missingReportStores: normalizeTelegramAgentStoreNames(missingReportStores),
        missingTargetStores: normalizeTelegramAgentStoreNames(missingTargetStores),
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
        sources: [],
        warnings: [],
        usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
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

function recordTelegramAgentUsage(ctx, response) {
    if (!ctx || !response) return;
    const usage = response.usageMetadata || response.usage || {};
    ctx.usage.promptTokenCount += Number(usage.promptTokenCount || usage.inputTokenCount || 0);
    ctx.usage.candidatesTokenCount += Number(usage.candidatesTokenCount || usage.outputTokenCount || 0);
    ctx.usage.totalTokenCount += Number(usage.totalTokenCount || 0);
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

function normalizeTelegramAgentStoreNames(values = []) {
    const rows = Array.isArray(values) ? values : [values];
    return [...new Set(rows.map((value) => normalizeSummaryCoreName(value)).filter(Boolean))].slice(0, 20);
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

async function loadTelegramAgentOrgProfile(brandId, ctx) {
    const ref = getOrgStructureDocRef(brandId);
    const result = await readTelegramAgentDoc(ref, ctx, "org_structure", { brandId, sourcePath: ref.path }, 300);
    const managers = result.exists ? (result.data?.managers || {}) : {};
    const storeOwner = {};
    Object.entries(managers).forEach(([managerName, stores]) => {
        (Array.isArray(stores) ? stores : []).forEach((store) => {
            const core = normalizeSummaryCoreName(store);
            if (core) storeOwner[core] = managerName;
        });
    });
    return { managers, stores: Object.keys(storeOwner), storeOwner, sourcePath: ref.path };
}

async function loadTelegramAgentTargetMap(brandId, yearMonth, ctx, dashboardData = null) {
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
        if (Object.keys(map).length > 0) return { map, source: "monthly_targets_summary", updatedAtText: summaryResult.updatedAtText };
    }

    if (dashboardData) {
        const map = extractAutoTargetMapFromSummaryData(dashboardData, yearMonth);
        if (Object.keys(map).length > 0) return { map, source: "dashboard_summary_targets", updatedAtText: dashboardData.lastUpdatedAtText || "" };
    }

    assertTelegramAgentReadBudget(ctx, 200);
    const rawResult = await queryTelegramAgentDocs(
        getSummaryCollection(brandId, "monthly_targets"),
        `query:${getSummaryCollection(brandId, "monthly_targets").path}:all`,
        ctx,
        "monthly_targets_fallback",
        { brandId, yearMonth },
        300
    );
    const map = {};
    rawResult.rows.forEach((row) => {
        const built = buildAutoTargetRow(row.id, row, yearMonth);
        if (built) map[built.storeCore] = built.target;
    });
    if (ctx) ctx.warnings.push(`${getTelegramAgentBrandLabel(brandId)} ${yearMonth} 目標摘要缺漏，本題已啟用完整目標 fallback。`);
    return { map, source: "monthly_targets_fallback", updatedAtText: "" };
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
    overall.achievement = overall.budget > 0 ? Number(((overall.cash / overall.budget) * 100).toFixed(1)) : 0;
    overall.projection = calculateTelegramAgentProjection(overall.cash, yearMonth, endDate);
    return overall;
}

async function loadTelegramAgentStoreMonth(brandId, yearMonth, ctx) {
    const taipeiNow = getTelegramAgentTaipeiNow();
    const isCurrentMonth = yearMonth === taipeiNow.yearMonth;
    let dashboardData = null;
    let summaryStatus = null;

    // 當月必須與前端區域分析使用的即時日報口徑一致。
    // monthly_aggregated 可能因啟用時間或歷史補登而不完整，因此只能作為當月 fallback。
    if (isCurrentMonth) {
        const liveResult = await loadTelegramAgentRawStoreRange(
            brandId,
            `${yearMonth}-01`,
            taipeiNow.todayStr,
            ctx,
            { includeTargets: true }
        );
        if (liveResult.rows.length > 0) {
            return { ...liveResult, source: "daily_reports_current_month_exact" };
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
                const rows = (Array.isArray(dashboardData.stores) ? dashboardData.stores : Object.values(dashboardData.stores || {}))
                    .map((row) => normalizeTelegramAgentStoreRow(row, brandId, row, { cashIsNet: true, skincareIsNet: false }));
                return {
                    rows,
                    overall: aggregateTelegramAgentStoreRows(rows, yearMonth, getTelegramAgentMonthEnd(yearMonth)),
                    source: "verified_dashboard_summary",
                    updatedAtText: dashboardResult.updatedAtText || summaryStatus.updatedAtText,
                };
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
        const [targetResult, org] = await Promise.all([
            loadTelegramAgentTargetMap(brandId, yearMonth, ctx, dashboardData),
            loadTelegramAgentOrgProfile(brandId, ctx),
        ]);
        const rows = aggregatedResult.rows.map((row) => {
            const core = normalizeSummaryCoreName(row.storeName || row.store || row.id || "");
            return normalizeTelegramAgentStoreRow({ ...row, manager: org.storeOwner[core] || row.manager || "未分配" }, brandId, targetResult.map[core] || {}, { cashIsNet: false, skincareIsNet: false });
        });
        return {
            rows,
            overall: aggregateTelegramAgentStoreRows(rows, yearMonth, isCurrentMonth ? taipeiNow.todayStr : getTelegramAgentMonthEnd(yearMonth)),
            source: `monthly_aggregated+${targetResult.source}`,
            updatedAtText: targetResult.updatedAtText || "",
        };
    }

    const rawFallback = await loadTelegramAgentRawStoreRange(
        brandId,
        `${yearMonth}-01`,
        isCurrentMonth ? taipeiNow.todayStr : getTelegramAgentMonthEnd(yearMonth),
        ctx
    );
    if (rawFallback.rows.length > 0 && ctx) {
        ctx.warnings.push(`${getTelegramAgentBrandLabel(brandId)} ${yearMonth} 月彙總缺漏，本題已改讀品牌限定日報。`);
    }
    return {
        ...rawFallback,
        source: rawFallback.rows.length > 0 ? "daily_reports_month_fallback" : "no_data",
    };
}

async function loadTelegramAgentRawStoreRange(brandId, startDate, endDate, ctx, options = {}) {
    const collectionRef = getSummarySourceCollection(brandId, "daily_reports");
    const result = await queryTelegramAgentDocs(
        collectionRef.where("date", ">=", startDate).where("date", "<=", endDate),
        `query:${collectionRef.path}:date=${startDate}..${endDate}`,
        ctx,
        "daily_reports_scoped",
        { brandId, yearMonth: startDate.slice(0, 7) },
        45
    );
    const storeMap = {};
    const dailyCash = {};
    result.rows.forEach((sourceRow) => {
        if (sourceRow.isArchivedDuplicate === true) return;
        const core = normalizeSummaryCoreName(sourceRow.storeName || sourceRow.store || sourceRow.storeId || "");
        if (!core) return;
        if (!storeMap[core]) storeMap[core] = { storeName: core, __rawDaily: true };
        const row = storeMap[core];
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
        dailyCash[sourceRow.date] = (dailyCash[sourceRow.date] || 0) + (Number(sourceRow.cash) || 0) - (Number(sourceRow.refund) || 0);
    });

    const yearMonth = startDate.slice(0, 7);
    const shouldLoadTargets = options.includeTargets === true || startDate.slice(0, 7) === endDate.slice(0, 7);
    const [org, targetResult] = await Promise.all([
        loadTelegramAgentOrgProfile(brandId, ctx),
        shouldLoadTargets
            ? loadTelegramAgentTargetMap(brandId, yearMonth, ctx)
            : Promise.resolve({ map: {}, source: "not_requested", updatedAtText: "" }),
    ]);
    const rows = Object.values(storeMap).map((row) => {
        const core = normalizeSummaryCoreName(row.storeName || "");
        return normalizeTelegramAgentStoreRow(
            { ...row, manager: org.storeOwner[core] || "未分配" },
            brandId,
            targetResult.map[core] || {},
            { cashIsNet: true, skincareIsNet: false }
        );
    });
    const [year, month] = yearMonth.split("-").map(Number);
    const daysPassed = getClampedDaysPassed(dailyCash, year, month);
    const overall = aggregateTelegramAgentStoreRows(rows, yearMonth, endDate);
    overall.projection = calculateExactFrontendProjection(dailyCash, year, month, daysPassed);
    return { rows, overall, source: "daily_reports_scoped", updatedAtText: targetResult.updatedAtText || "" };
}

async function getStorePerformance(startDate, endDate, storeName = null, brandName = null, agentContext = null) {
    if (storeName && !brandName && normalizeTelegramAgentBrandId(storeName)) {
        brandName = storeName;
        storeName = null;
    }
    const ctx = agentContext;
    const brands = resolveTelegramAgentBrands(brandName, storeName);
    const start = normalizeTelegramAgentDate(startDate);
    const end = normalizeTelegramAgentDate(endDate);
    const useMonthSummary = isTelegramAgentMonthRange(start, end);
    const allRows = [];
    const sourceMeta = [];

    for (const brandId of brands) {
        assertTelegramAgentReadBudget(ctx, 1);
        const loaded = useMonthSummary
            ? await loadTelegramAgentStoreMonth(brandId, start.slice(0, 7), ctx)
            : await loadTelegramAgentRawStoreRange(brandId, start, end, ctx);
        loaded.rows.forEach((row) => allRows.push(row));
        sourceMeta.push({ brand: getTelegramAgentBrandLabel(brandId), source: loaded.source, updatedAtText: loaded.updatedAtText });
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
        data_note: useMonthSummary ? "整月／本月查詢優先使用 Summary 或月彙總。" : "指定日期區間使用品牌限定日報。",
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

async function loadTelegramAgentTherapistMonth(brandId, yearMonth, ctx) {
    const taipeiNow = getTelegramAgentTaipeiNow();
    const isCurrentMonth = yearMonth === taipeiNow.yearMonth;

    // 當月人員分析直接使用品牌限定管理師日報，避免人員月彙總尚未完整造成少算。
    if (isCurrentMonth) {
        const liveResult = await loadTelegramAgentRawTherapistRange(
            brandId,
            `${yearMonth}-01`,
            taipeiNow.todayStr,
            ctx
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
        ctx
    );
    if (rawFallback.rows.length > 0 && ctx) {
        ctx.warnings.push(`${getTelegramAgentBrandLabel(brandId)} ${yearMonth} 人員月彙總缺漏，本題已改讀品牌限定管理師日報。`);
    }
    return {
        ...rawFallback,
        source: rawFallback.rows.length > 0 ? "therapist_daily_reports_month_fallback" : "no_data",
    };
}

async function loadTelegramAgentRawTherapistRange(brandId, startDate, endDate, ctx) {
    const collectionRef = getSummarySourceCollection(brandId, "therapist_daily_reports");
    const result = await queryTelegramAgentDocs(
        collectionRef.where("date", ">=", startDate).where("date", "<=", endDate),
        `query:${collectionRef.path}:date=${startDate}..${endDate}`,
        ctx,
        "therapist_daily_reports_scoped",
        { brandId, yearMonth: startDate.slice(0, 7) },
        45
    );
    const map = {};
    result.rows.forEach((sourceRow) => {
        if (sourceRow.isArchivedDuplicate === true) return;
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

async function getTherapistPerformance(startDate, endDate, personName = null, storeName = null, brandName = null, agentContext = null, storeNames = []) {
    if (storeName && !brandName && normalizeTelegramAgentBrandId(storeName)) {
        brandName = storeName;
        storeName = null;
    }
    const ctx = agentContext;
    const brands = resolveTelegramAgentBrands(brandName, storeName);
    const start = normalizeTelegramAgentDate(startDate);
    const end = normalizeTelegramAgentDate(endDate);
    const useMonthSummary = isTelegramAgentMonthRange(start, end);
    const allRows = [];
    const sourceMeta = [];
    for (const brandId of brands) {
        const loaded = useMonthSummary
            ? await loadTelegramAgentTherapistMonth(brandId, start.slice(0, 7), ctx)
            : await loadTelegramAgentRawTherapistRange(brandId, start, end, ctx);
        loaded.rows.forEach((row) => allRows.push(row));
        sourceMeta.push({ brand: getTelegramAgentBrandLabel(brandId), source: loaded.source, updatedAtText: loaded.updatedAtText });
    }

    const personQuery = normalizeSummaryPersonName(personName || "").toLowerCase();
    const storeQuery = normalizeSummaryCoreName(storeName || "");
    const inheritedStores = new Set(normalizeTelegramAgentStoreNames(storeNames || []));
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

async function getMissingReports(startDate, endDate, brandName = null, agentContext = null) {
    const ctx = agentContext;
    const brands = resolveTelegramAgentBrands(brandName, "");
    const start = normalizeTelegramAgentDate(startDate);
    const end = normalizeTelegramAgentDate(endDate);
    const results = [];
    for (const brandId of brands) {
        const org = await loadTelegramAgentOrgProfile(brandId, ctx);
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
        const expected = org.stores;
        const missing = expected.filter((store) => !submitted.has(store));
        results.push({
            brand: getTelegramAgentBrandLabel(brandId),
            expectedCount: expected.length,
            submittedCount: submitted.size,
            missingCount: missing.length,
            missingStores: missing,
            source: "org_structure + daily_reports_scoped",
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
            const loaded = await loadTelegramAgentStoreMonth(brandId, yearMonth, ctx);
            const rows = requestedStore
                ? loaded.rows.filter((row) => normalizeSummaryCoreName(row.storeName).includes(requestedStore))
                : loaded.rows;
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
                source: loaded.source,
                updatedAtText: loaded.updatedAtText,
            });
            if (!brandTotals[brandId]) brandTotals[brandId] = { brand: getTelegramAgentBrandLabel(brandId), cash: 0, accrual: 0, traffic: 0, newRev: 0, newCount: 0, budget: 0 };
            ["cash", "accrual", "traffic", "newRev", "newCount", "budget"].forEach((field) => { brandTotals[brandId][field] += Number(overall[field] || 0); });
            rows.forEach((row) => {
                const key = `${brandId}:${row.storeName}`;
                if (!storeTotals[key]) storeTotals[key] = { storeName: row.storeName, brand: getTelegramAgentBrandLabel(brandId), cash: 0, accrual: 0, traffic: 0, newRev: 0, newCount: 0, budget: 0 };
                ["cash", "accrual", "traffic", "newRev", "newCount", "budget"].forEach((field) => { storeTotals[key][field] += Number(row[field] || 0); });
            });
        }
    }

    Object.values(brandTotals).forEach((row) => {
        row.achievement = row.budget > 0 ? Number(((row.cash / row.budget) * 100).toFixed(1)) : 0;
        row.newCustomerASP = row.newCount > 0 ? Math.round(row.newRev / row.newCount) : 0;
    });
    const storeHealth = Object.values(storeTotals).map((row) => ({
        ...row,
        achievementRate: row.budget > 0 ? Number(((row.cash / row.budget) * 100).toFixed(1)) : 0,
        newCustomerASP: row.newCount > 0 ? Math.round(row.newRev / row.newCount) : 0,
    })).sort((a, b) => b.cash - a.cash).slice(0, 80);

    return {
        analysis_range: `${months[0]} ~ ${months[months.length - 1]}`,
        monthly_trends: monthlyTrends,
        brand_summaries: Object.values(brandTotals),
        store_health_and_targets: storeHealth,
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
            const hasManager = Object.keys(org.managers || {}).some((name) => {
                const normalized = normalizeTelegramAgentManagerName(name);
                return normalized === managerQuery || normalized.includes(managerQuery) || managerQuery.includes(normalized);
            });
            if (hasManager) matchedBrands.push(brand.id);
        }
        if (matchedBrands.length > 0) brands = matchedBrands;
    }

    const allRows = [];
    const brandQuality = [];

    for (const brandId of brands) {
        const org = orgCache[brandId] || await loadTelegramAgentOrgProfile(brandId, ctx);
        const loaded = await loadTelegramAgentStoreMonth(brandId, ym, ctx);
        const targetResult = await loadTelegramAgentTargetMap(brandId, ym, ctx);

        const rowByCore = {};
        loaded.rows.forEach((row) => {
            const core = normalizeSummaryCoreName(row.storeName);
            if (core) rowByCore[core] = row;
        });

        const managerMap = {};
        const assignedStores = new Set();

        Object.entries(org.managers || {}).forEach(([manager, stores]) => {
            const normalizedStores = normalizeTelegramAgentStoreNames(stores || []);
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
                const budget = Number(row?.budget || target.cashTarget || 0);
                const cash = Number(row?.cash || 0);
                const accrual = Number(row?.accrual || 0);
                const skincare = Number(row?.skincareGross ?? row?.skincare ?? 0);
                const traffic = Number(row?.traffic || 0);
                const newRev = Number(row?.newRev || 0);
                const newCount = Number(row?.newCount || 0);
                const newClosings = Number(row?.newClosings || 0);
                const targetManager = managerMap[manager];

                targetManager.stores.push(storeCore);
                if (row) targetManager.reportedStoreCount += 1;
                else targetManager.missingReportStores.push(storeCore);
                if (budget > 0) targetManager.targetedStoreCount += 1;
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
                    cashAchievementRate: budget > 0 ? Number(((cash / budget) * 100).toFixed(1)) : null,
                    hasReportData: Boolean(row),
                    hasTargetData: budget > 0,
                });
                targetManager.cash += cash;
                targetManager.accrual += accrual;
                targetManager.skincare += skincare;
                targetManager.traffic += traffic;
                targetManager.newRev += newRev;
                targetManager.newCount += newCount;
                targetManager.newClosings += newClosings;
                targetManager.budget += budget;
            });
        });

        // 正式組織架構以外但存在日報的店家歸入未分配，保留資料但不參與正式排名。
        loaded.rows.forEach((row) => {
            const storeCore = normalizeSummaryCoreName(row.storeName);
            if (!storeCore || assignedStores.has(storeCore)) return;
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
            const budget = Number(row.budget || targetResult.map[storeCore]?.cashTarget || 0);
            target.stores.push(storeCore);
            target.reportedStoreCount += 1;
            if (budget > 0) target.targetedStoreCount += 1;
            target.storeDetails.push({
                storeName: storeCore,
                cash: Number(row.cash || 0),
                accrual: Number(row.accrual || 0),
                skincare: Number(row.skincareGross ?? row.skincare ?? 0),
                traffic: Number(row.traffic || 0),
                newCustomers: Number(row.newCount || 0),
                retainedOrders: Number(row.newClosings || 0),
                budget,
                cashAchievementRate: budget > 0 ? Number(((Number(row.cash || 0) / budget) * 100).toFixed(1)) : null,
                hasReportData: true,
                hasTargetData: budget > 0,
            });
            target.cash += Number(row.cash || 0);
            target.accrual += Number(row.accrual || 0);
            target.skincare += Number(row.skincareGross ?? row.skincare ?? 0);
            target.traffic += Number(row.traffic || 0);
            target.newRev += Number(row.newRev || 0);
            target.newCount += Number(row.newCount || 0);
            target.newClosings += Number(row.newClosings || 0);
            target.budget += budget;
        });

        const managerRows = Object.values(managerMap).map((row) => {
            const cashAchievementRate = row.budget > 0 ? Number(((row.cash / row.budget) * 100).toFixed(1)) : null;
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
            allRows.push(row);
        });

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
        brandDataQuality: brandQuality,
        ranking_scope: "只有正式組織架構、日報與現金目標皆完整的區長才參與同品牌排名。achievementRank／brandRank=現金業績達成率排名；cashRank=現金總業績排名；另提供進度差距、新客、締結率與保養品占比排名。",
        data_quality_rule: "rankingEligible=false 時禁止宣稱第幾名，必須先說明缺少哪些店家日報或目標。",
        metric_dictionary: getTelegramAgentMetricDictionary([
            "cash", "accrual", "skincare", "traffic", "newCustomers", "retainedOrders",
            "cashAchievementRate", "expectedProgress", "progressGap", "achievementRank", "cashRank",
            "closingRateRank", "newCustomerRank", "skincareRatioRank",
        ]),
    };
}

async function getOperationalAlerts(yearMonth, brandName = null, limit = 10, agentContext = null, alertOptions = null) {
    const ctx = agentContext;
    const ym = normalizeTelegramAgentYearMonth(yearMonth) || getTelegramAgentTaipeiNow().yearMonth;
    const brands = resolveTelegramAgentBrands(brandName, "");
    const expectedProgress = getTelegramAgentExpectedProgress(ym);
    const rules = normalizeTelegramActiveAlertThresholds(alertOptions || {});
    const alerts = [];
    const brandSummaries = [];

    for (const brandId of brands) {
        // 依序載入以共享同一題快取；避免 loadStoreMonth 與 org/target 同時啟動造成重複讀取。
        const loaded = await loadTelegramAgentStoreMonth(brandId, ym, ctx);
        const org = await loadTelegramAgentOrgProfile(brandId, ctx);
        const targetResult = await loadTelegramAgentTargetMap(brandId, ym, ctx);
        const rowByCore = {};
        loaded.rows.forEach((row) => {
            const core = normalizeSummaryCoreName(row.storeName);
            if (core) rowByCore[core] = row;
        });
        const storeCores = [...new Set([...org.stores, ...Object.keys(rowByCore)])];
        let brandCash = 0;
        let brandBudget = 0;
        let reportedStoreCount = 0;
        let targetedStoreCount = 0;
        const missingReportStores = [];
        const missingTargetStores = [];
        let criticalCount = 0;
        let watchCount = 0;

        storeCores.forEach((storeCore) => {
            const row = rowByCore[storeCore] || null;
            const target = targetResult.map[storeCore] || {};
            const cash = Number(row?.cash || 0);
            const budget = Number(row?.budget || target.cashTarget || 0);
            const achievement = budget > 0 ? Number(((cash / budget) * 100).toFixed(1)) : null;
            const progressGap = achievement === null ? null : Number((achievement - expectedProgress).toFixed(1));
            const newCount = Number(row?.newCount || 0);
            const newClosings = Number(row?.newClosings || 0);
            const closingRate = newCount > 0 ? Number(((newClosings / newCount) * 100).toFixed(1)) : null;
            const skincare = Number(row?.skincareGross ?? row?.skincare ?? 0);
            const skincareRatio = cash > 0 ? Number(((skincare / cash) * 100).toFixed(1)) : null;
            const reasons = [];
            let severity = "normal";

            brandCash += cash;
            brandBudget += budget;
            if (row) reportedStoreCount += 1;
            else missingReportStores.push(storeCore);
            if (budget > 0) targetedStoreCount += 1;
            else missingTargetStores.push(storeCore);

            if (!row && rules.missingReportEnabled) {
                severity = "critical";
                reasons.push("本月尚無日報資料");
            }
            if (budget <= 0) {
                if (rules.missingTargetEnabled) {
                    if (severity === "normal") severity = "watch";
                    reasons.push("現金目標缺漏");
                }
            } else if (progressGap <= -rules.criticalProgressGap) {
                severity = "critical";
                reasons.push(`現金進度落後 ${Math.abs(progressGap).toFixed(1)} 個百分點`);
            } else if (progressGap <= -rules.watchProgressGap) {
                if (severity === "normal") severity = "watch";
                reasons.push(`現金進度落後 ${Math.abs(progressGap).toFixed(1)} 個百分點`);
            }
            if (newCount >= rules.minNewCustomers && closingRate !== null && closingRate < rules.closingRate) {
                if (severity === "normal") severity = "watch";
                reasons.push(`新客締結率 ${closingRate.toFixed(1)}%`);
            }
            if (cash > 0 && skincareRatio !== null && skincareRatio < rules.skincareRatio) {
                if (severity === "normal") severity = "watch";
                reasons.push(`保養品占比 ${skincareRatio.toFixed(1)}%`);
            }

            if (severity !== "normal" || reasons.length > 0) {
                if (severity === "critical") criticalCount += 1;
                else if (severity === "watch") watchCount += 1;
                alerts.push({
                    brand: getTelegramAgentBrandLabel(brandId),
                    brandId,
                    storeName: storeCore,
                    manager: org.storeOwner[storeCore] || row?.manager || "未分配",
                    cash,
                    budget,
                    cashAchievementRate: achievement,
                    achievement,
                    expectedProgress,
                    progressGap,
                    traffic: Number(row?.traffic || 0),
                    newCustomerCount: newCount,
                    newClosingRate: closingRate,
                    skincareRatio,
                    severity,
                    reasons,
                    hasReportData: Boolean(row),
                    hasTargetData: budget > 0,
                    source: loaded.source,
                });
            }
        });

        const dataQuality = buildTelegramAgentDataQuality({
            expectedStoreCount: org.stores.length,
            reportedStoreCount,
            targetedStoreCount,
            source: loaded.source,
            missingReportStores,
            missingTargetStores,
        });
        brandSummaries.push({
            brand: getTelegramAgentBrandLabel(brandId),
            brandId,
            cash: brandCash,
            budget: brandBudget,
            cashAchievementRate: brandBudget > 0 ? Number(((brandCash / brandBudget) * 100).toFixed(1)) : null,
            expectedProgress,
            progressGap: brandBudget > 0 ? Number((((brandCash / brandBudget) * 100) - expectedProgress).toFixed(1)) : null,
            criticalCount,
            watchCount,
            dataQuality,
            source: loaded.source,
            targetSource: targetResult.source,
            orgSourcePath: org.sourcePath,
        });
    }

    const severityWeight = { critical: 3, high: 2, watch: 1, normal: 0 };
    alerts.sort((a, b) => (severityWeight[b.severity] - severityWeight[a.severity]) || ((a.progressGap ?? 999) - (b.progressGap ?? 999)));
    return {
        yearMonth: ym,
        expectedProgress,
        brandSummaries,
        alerts: alerts.slice(0, Math.min(20, Math.max(1, Number(limit) || 10))),
        alertCount: alerts.length,
        rule_note: `依目前設定：現金進度落後 ${rules.watchProgressGap} 個百分點以上、新客締結率低於 ${rules.closingRate}%、保養品占比低於 ${rules.skincareRatio}%${rules.missingReportEnabled ? "、日報缺漏" : ""}${rules.missingTargetEnabled ? "、現金目標缺漏" : ""}時列入提醒。`,
        metric_dictionary: getTelegramAgentMetricDictionary(["cashAchievementRate", "expectedProgress", "progressGap"]),
    };
}

async function getDataHealth(yearMonth, brandName = null, agentContext = null) {
    const ctx = agentContext;
    const ym = normalizeTelegramAgentYearMonth(yearMonth) || getTelegramAgentTaipeiNow().yearMonth;
    const brands = resolveTelegramAgentBrands(brandName, "");
    const results = [];

    for (const brandId of brands) {
        // 依序載入以共享同一題快取，避免相同 org/target 被重複讀取。
        const loaded = await loadTelegramAgentStoreMonth(brandId, ym, ctx);
        const org = await loadTelegramAgentOrgProfile(brandId, ctx);
        const targetResult = await loadTelegramAgentTargetMap(brandId, ym, ctx);
        const summaryStatus = await loadTelegramAgentSummaryStatus(brandId, ym, ctx);
        const reported = new Set(loaded.rows.map((row) => normalizeSummaryCoreName(row.storeName)).filter(Boolean));
        const targeted = new Set(Object.entries(targetResult.map || {}).filter(([, value]) => Number(value?.cashTarget || 0) > 0).map(([key]) => key));
        const expected = new Set(org.stores || []);
        const missingReportStores = [...expected].filter((store) => !reported.has(store));
        const missingTargetStores = [...expected].filter((store) => !targeted.has(store));
        const unexpectedReportStores = [...reported].filter((store) => !expected.has(store));
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
        if (!result.exists || result.data?.version !== TELEGRAM_AGENT_VERSION) {
            return { turns: [], state: sanitizeTelegramAgentScopeState({}) };
        }
        const turns = Array.isArray(result.data?.turns) ? result.data.turns : [];
        return {
            turns: turns.slice(-TELEGRAM_AGENT_MEMORY_TURNS),
            state: sanitizeTelegramAgentScopeState(result.data?.state || {}),
        };
    } catch (error) {
        console.warn("Telegram Agent 記憶讀取失敗:", error.message);
        return { turns: [], state: sanitizeTelegramAgentScopeState({}) };
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString(),
        version: TELEGRAM_AGENT_VERSION,
    }, { merge: true });
    if (ctx) ctx.writeCount += 1;
}

function buildTelegramAgentSourceFooter(ctx) {
    const sourceLabels = {
        verified_dashboard_summary: "已驗證歷史月結 Summary",
        dashboard_summary: "歷史月結 Summary",
        dashboard_summary_fallback: "Dashboard Summary fallback",
        dashboard_summary_targets: "Dashboard 目標",
        monthly_aggregated: "本月即時月彙總",
        monthly_targets_summary: "目標 Summary",
        monthly_targets_fallback: "完整目標 fallback",
        daily_reports_scoped: "品牌限定店家日報",
        daily_reports_current_month_exact: "當月品牌限定即時店家日報",
        daily_reports_month_fallback: "品牌限定整月日報 fallback",
        verified_therapist_summary: "已驗證歷史人員 Summary",
        therapist_summary: "歷史人員 Summary",
        therapist_summary_fallback: "人員 Summary fallback",
        therapist_monthly_aggregated: "本月人員月彙總",
        therapist_daily_reports_scoped: "品牌限定管理師日報",
        therapist_daily_reports_current_month_exact: "當月品牌限定即時管理師日報",
        therapist_daily_reports_month_fallback: "品牌限定整月管理師日報 fallback",
        org_structure: "正式組織架構",
        daily_reports_submitted: "回報日報",
        summary_recalc_flags: "Summary 驗證狀態",
        telegram_agent_memory: "短期對話記憶",
        telegram_agent_config: "主動預警設定",
    };
    const unique = [];
    const seen = new Set();
    (ctx?.sources || []).forEach((item) => {
        const key = `${item.source}:${item.brandId}:${item.yearMonth}`;
        if (seen.has(key)) return;
        seen.add(key);
        const label = sourceLabels[item.source] || item.source;
        const brand = item.brandId ? getTelegramAgentBrandLabel(item.brandId) : "";
        unique.push(`${brand ? `${brand} ` : ""}${label}`.trim());
    });
    const sourceText = unique.slice(0, 6).join("、") || "一般管理知識";
    const warningText = (ctx?.warnings || []).length > 0 ? `\n⚠️ ${ctx.warnings.slice(0, 2).join("；")}` : "";
    return `\n\n資料基準：${sourceText}\n查詢負載：約 ${ctx?.readCount || 0} 筆文件讀取｜工具 ${ctx?.toolCalls?.length || 0}/${TELEGRAM_AGENT_MAX_TOOL_CALLS}${warningText}`;
}

async function writeTelegramAgentAuditLog(message, ctx, finalReply, status = "success", errorMessage = "") {
    try {
        await db.collection("telegram_agent_logs").add({
            version: TELEGRAM_AGENT_VERSION,
            status,
            chatId: String(message?.chat?.id || ""),
            chatTitle: String(message?.chat?.title || ""),
            userId: String(message?.from?.id || ""),
            userName: [message?.from?.first_name, message?.from?.last_name].filter(Boolean).join(" "),
            username: String(message?.from?.username || ""),
            question: String(message?.text || "").slice(0, 1200),
            answerPreview: String(finalReply || "").slice(0, 1500),
            toolCalls: ctx?.toolCalls || [],
            sources: ctx?.sources || [],
            warnings: ctx?.warnings || [],
            readCount: Number(ctx?.readCount || 0),
            writeCount: Number(ctx?.writeCount || 0),
            usage: ctx?.usage || {},
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

async function finalizeTelegramAgentAnswer(genAI, question, memoryText, scopeText, toolOutputs, dateInfo) {
    const finalizer = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: `你是 DRCYJ 集團營運戰情秘書。現在日期 ${dateInfo.todayStr}。請只根據提供的工具結果完成結論，不可再要求查資料，不可捏造。只能提及工具結果實際包含的品牌、店家、人員與區長。區長「整體表現／進度排名」只能使用 achievementRank（或相容欄位 brandRank），並明確稱為「現金業績達成率排名」；營收規模才使用 cashRank，稱為「現金總業績排名」。achievement／cashAchievementRate 的固定定義是「現金業績達成率＝現金÷現金目標」，絕對不可寫成「權責業績達成率」。權責總業績使用 accrual；安妞 operationalAccrual 只是操作權責子項。工具沒有可驗證的 accrualBudget 或 accrualAchievement 時，不得自行描述權責達成率。只有 rankingEligible=true 且名次欄位不是 null 時才能宣稱排名；rankingEligible=false 時必須說明資料缺漏，禁止自行補排名。回答需包含：結論、關鍵異常、資料可信度與優先行動。語氣專業、精準、冷靜。`,
    });
    const payload = JSON.stringify(toolOutputs).slice(0, 45000);
    const result = await finalizer.generateContent(`最近對話：
${memoryText}

結構化查詢範圍：
${scopeText}

本題：${question}

已取得資料：
${payload}`);
    return result;
}

// ==========================================
// ★ 3. Webhook：DRCYJ Telegram 營運戰情 Agent
// ==========================================
exports.telegramWebhook = onRequest({
    secrets: [GEMINI_API_KEY, TELEGRAM_BOT_TOKEN_SECRET],
    timeoutSeconds: 120,
    memory: "512MiB",
}, async (req, res) => {
    const message = req.body?.message;
    if (!message?.text) return res.sendStatus(200);

    const chatId = message.chat?.id;
    const userId = message.from?.id || "unknown";
    const rawCommand = String(message.text || "").trim();
    const command = expandTelegramAgentCommand(rawCommand);
    if (!isTelegramChatAuthorized(chatId)) {
        console.warn(`Telegram 未授權聊天室已拒絕：${chatId}`);
        return res.sendStatus(200);
    }

    const ctx = createTelegramAgentContext({ chatId, userId, question: command });
    const dateInfo = getTelegramAgentTaipeiNow();
    let finalReply = "";
    let memoryTurns = [];

    try {
        if (/^\/(reset|new)$/i.test(rawCommand) || /^(重置對話|清除對話|重新開始)$/.test(rawCommand)) {
            await resetTelegramAgentMemory(chatId, userId);
            await sendTelegramMessage(chatId, "✅ 已清除個人查詢脈絡。下一題會重新判斷品牌、店家與月份。");
            return res.sendStatus(200);
        }

        const memoryPayload = await loadTelegramAgentMemory(chatId, userId, ctx);
        memoryTurns = memoryPayload.turns;
        ctx.scopeState = sanitizeTelegramAgentScopeState(memoryPayload.state || {});
        const explicitBrandId = getTelegramAgentExplicitBrandId(command);
        if (explicitBrandId) ctx.scopeState.activeBrandId = explicitBrandId;
        if (isTelegramAgentAllBrandIntent(command)) ctx.scopeState.activeBrandId = "";
        const memoryText = formatTelegramAgentMemory(memoryTurns);
        const scopeText = formatTelegramAgentScopeState(ctx.scopeState);
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            tools: [aiTools],
            systemInstruction: `你是 DRCYJ 全方位美學集團的營運戰情 Agent，具備資深總經理特助、營運分析師與管理顧問能力。現在日期是 ${dateInfo.todayStr}。

【資料原則】
1. 涉及本公司真實業績、目標、排行、人員、店家、區長或回報狀態時，必須呼叫工具，不得憑空回答。
2. 一般管理觀念可以直接回答，但必須明確標示為「一般管理建議」，不可假裝是公司數據結論。
3. CYJ／DRCYJ、安妞、伊啵是品牌；不可誤填為店名。
4. 工具最多三次。先使用最精準、範圍最小的工具；已有資料時不要重複查詢。
5. 可以進行多步驟分析，例如先找異常店，再查管理師或區長，但只查回答本題真正需要的資料。
6. 所有金額、比率與排行必須以工具結果為準；可以解讀，不可捏造。
7. 品牌範圍由後端結構化脈絡鎖定。除非使用者本題明確要求全品牌／跨品牌比較，不可把上一題 CYJ 擴張成安妞或伊啵。
8. 「這三家店／那些店／上述店家」必須沿用結構化脈絡中的關注店家，不可改查其他店。
9. 詢問區長時優先使用 getManagerPerformance；「整體表現／進度排名」引用 achievementRank（相容欄位 brandRank），並稱為「現金業績達成率排名」；「現金規模／營收金額排名」引用 cashRank，並稱為「現金總業績排名」。區域數字必須使用工具回傳的同口徑欄位。
10. achievement／cashAchievementRate 固定代表「現金業績達成率＝現金÷現金目標」，不可寫成「權責業績達成率」。權責總業績固定使用 accrual；安妞 operationalAccrual 只代表操作權責子項。除非工具明確提供可驗證的 accrualBudget／accrualAchievement，否則禁止推算或敘述權責達成率。
11. 所有名次都必須同時檢查 rankingEligible。rankingEligible=false 或名次為 null 時，禁止稱第幾名，必須先說明日報或目標缺漏。
12. 使用者詢問「整體表現」時，至少區分現金業績達成率排名與現金總業績排名；可補充進度差距、新客、締結率及保養品占比排名，不得把單一排名包裝成綜合排名。
13. 輸入 /today 優先使用 getDailyBattleBrief；/datahealth 優先使用 getDataHealth；/alerts 優先使用 getOperationalAlerts。

【分析框架】
- 先直接回答結論。
- 再指出：業績進度、來客、締結率、新舊客客單、保養品占比或目標缺口中的主要問題。
- 最後提出 1～3 個可執行且有優先順序的行動。
- 發現資料缺漏或來源 fallback 時，必須明確提醒。
- 語氣專業、精準、冷靜，像特助對總經理匯報。`,
        });

        const prompt = `以下是這位使用者最近的個人對話脈絡，只用於理解「那家店、上個月、剛才那位管理師」等追問：\n${memoryText}\n\n目前問題：${command}`;
        const aiChat = model.startChat();
        let result = await aiChat.sendMessage(prompt);
        recordTelegramAgentUsage(ctx, result.response);
        const toolOutputs = [];
        let totalToolCalls = 0;

        for (let round = 0; round < TELEGRAM_AGENT_MAX_TOOL_CALLS; round += 1) {
            const calls = typeof result.response.functionCalls === "function" ? (result.response.functionCalls() || []) : [];
            if (!calls.length) {
                finalReply = result.response.text();
                break;
            }

            const responses = [];
            for (const call of calls) {
                if (totalToolCalls >= TELEGRAM_AGENT_MAX_TOOL_CALLS) break;
                if (ctx.readCount >= TELEGRAM_AGENT_MAX_READS) break;
                totalToolCalls += 1;
                try {
                    const toolExecution = await executeTelegramAgentTool(call.name, call.args || {}, ctx, dateInfo);
                    const effectiveArgs = toolExecution.effectiveArgs || call.args || {};
                    const toolResult = toolExecution.result;
                    toolOutputs.push({ name: call.name, args: effectiveArgs, result: toolResult });
                    responses.push({ functionResponse: { name: call.name, response: { result: toolResult } } });
                } catch (toolError) {
                    const errorResult = { ok: false, error: toolError.message };
                    ctx.toolCalls.push({ name: call.name, args: call.args || {}, ok: false, error: toolError.message, readCountAfter: ctx.readCount });
                    toolOutputs.push({ name: call.name, args: call.args || {}, result: errorResult });
                    responses.push({ functionResponse: { name: call.name, response: { result: errorResult } } });
                }
            }

            if (!responses.length) break;
            result = await aiChat.sendMessage(responses);
            recordTelegramAgentUsage(ctx, result.response);
        }

        if (!finalReply) {
            const callsRemain = typeof result.response.functionCalls === "function" ? (result.response.functionCalls() || []) : [];
            if (!callsRemain.length) finalReply = result.response.text();
            else {
                const finalResult = await finalizeTelegramAgentAnswer(genAI, command, memoryText, formatTelegramAgentScopeState(ctx.scopeState), toolOutputs, dateInfo);
                recordTelegramAgentUsage(ctx, finalResult.response);
                finalReply = finalResult.response.text();
            }
        }

        finalReply = cleanTelegramAgentReply(finalReply);
        const replyWithFooter = `${finalReply}${buildTelegramAgentSourceFooter(ctx)}`;
        await sendTelegramMessage(chatId, replyWithFooter);
        await Promise.allSettled([
            saveTelegramAgentMemory(chatId, userId, memoryTurns, rawCommand, finalReply, ctx),
            writeTelegramAgentAuditLog(message, ctx, finalReply, "success"),
        ]);
    } catch (error) {
        console.error("Telegram Agent 嚴重錯誤:", error);
        const errorText = error instanceof TelegramAgentBudgetError
            ? `⚠️ ${error.message}`
            : `❌ 戰情秘書暫時失聯：\n${error.message}`;
        try {
            await sendTelegramMessage(chatId, errorText);
        } catch (sendError) {
            console.error("Telegram 錯誤通知發送失敗:", sendError.message);
        }
        await writeTelegramAgentAuditLog(message, ctx, finalReply, "error", error.message);
    }
    return res.sendStatus(200);
});



// ==========================================
// ★ DRCYJ Telegram 預警管理中心 v1.6
// 使用者於 SaaS「推播管理 > 智慧戰情預警」操作；設定不再寫死於程式碼。
// 設定路徑：artifacts/default-app-id/public/data/global_settings/telegram_active_alerts
// 狀態路徑：artifacts/default-app-id/public/data/global_settings/telegram_active_alert_status
// 排程每 5 分鐘只讀設定；到達指定時間才載入營運資料並推播。
// ==========================================
const TELEGRAM_ACTIVE_ALERT_DEFAULTS = Object.freeze({
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

function normalizeTelegramActiveAlertThresholds(raw = {}) {
    const defaults = TELEGRAM_ACTIVE_ALERT_DEFAULTS.thresholds;
    const watchProgressGap = clampTelegramAlertNumber(raw.watchProgressGap, defaults.watchProgressGap, 0, 100);
    const criticalProgressGap = Math.max(
        watchProgressGap,
        clampTelegramAlertNumber(raw.criticalProgressGap, defaults.criticalProgressGap, 0, 100)
    );
    return {
        watchProgressGap,
        criticalProgressGap,
        closingRate: clampTelegramAlertNumber(raw.closingRate, defaults.closingRate, 0, 100),
        skincareRatio: clampTelegramAlertNumber(raw.skincareRatio, defaults.skincareRatio, 0, 100),
        minNewCustomers: Math.round(clampTelegramAlertNumber(raw.minNewCustomers, defaults.minNewCustomers, 0, 999)),
        missingReportEnabled: raw.missingReportEnabled !== false,
        missingTargetEnabled: raw.missingTargetEnabled !== false,
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
    return {
        enabled: raw.enabled === true,
        sendTime,
        weekdays: weekdays.length ? weekdays : [...TELEGRAM_ACTIVE_ALERT_DEFAULTS.weekdays],
        brandIds: brandIds.length ? brandIds : [...TELEGRAM_ACTIVE_ALERT_DEFAULTS.brandIds],
        chatTargets: chatTargets.length ? chatTargets : [...TELEGRAM_ACTIVE_ALERT_DEFAULTS.chatTargets],
        limit: Math.round(clampTelegramAlertNumber(raw.limit, TELEGRAM_ACTIVE_ALERT_DEFAULTS.limit, 1, 20)),
        sendWhenClear: raw.sendWhenClear === true,
        pausedUntil: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.pausedUntil || "")) ? String(raw.pausedUntil) : "",
        timezone: "Asia/Taipei",
        thresholds: normalizeTelegramActiveAlertThresholds(raw.thresholds || {}),
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

function resolveTelegramActiveAlertBrandName(config) {
    return config.brandIds.length === 1 ? getTelegramAgentBrandLabel(config.brandIds[0]) : null;
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

function formatTelegramAgentActiveAlertMessage(result, ctx, todayStr, config = {}) {
    const rows = Array.isArray(result?.alerts) ? result.alerts : [];
    const summaries = Array.isArray(result?.brandSummaries) ? result.brandSummaries : [];
    const lines = [`🚨 DRCYJ 主動戰情預警｜${todayStr}`, `月份時間進度：${result?.expectedProgress ?? "-"}%`];
    summaries.forEach((row) => {
        const rate = row.cashAchievementRate === null ? "目標缺漏" : `${row.cashAchievementRate}%`;
        const quality = row.dataQuality?.level || "unknown";
        lines.push(`${row.brand}：現金達成 ${rate}｜重大 ${row.criticalCount || 0}｜關注 ${row.watchCount || 0}｜資料 ${quality}`);
    });
    if (rows.length === 0) {
        lines.push("目前沒有符合預警門檻的店家。");
    } else {
        lines.push("", "優先關注：");
        rows.slice(0, config.limit || 8).forEach((row, index) => {
            const icon = row.severity === "critical" ? "🔴" : "🟠";
            const rate = row.cashAchievementRate === null ? "無目標" : `${row.cashAchievementRate}%`;
            lines.push(`${index + 1}. ${icon} ${row.brand}${row.storeName}店｜現金達成 ${rate}｜${(row.reasons || []).join("、")}`);
        });
    }
    lines.push("", `查詢負載：約 ${ctx?.readCount || 0} 筆文件讀取｜固定規則引擎，未使用 Gemini`);
    return lines.join("\n").slice(0, 3900);
}

async function buildTelegramActiveAlertMessage(config, actor = "scheduled") {
    const normalized = normalizeTelegramActiveAlertConfig(config);
    const now = getTelegramAlertTaipeiClock();
    const ctx = createTelegramAgentContext({ chatId: actor, userId: actor, question: "active alerts" });
    const result = await getOperationalAlerts(
        now.yearMonth,
        resolveTelegramActiveAlertBrandName(normalized),
        normalized.limit,
        ctx,
        normalized.thresholds
    );
    return {
        config: normalized,
        now,
        ctx,
        result,
        message: formatTelegramAgentActiveAlertMessage(result, ctx, now.todayStr, normalized),
    };
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
    const sentKey = `${now.todayStr}|${config.sendTime}`;
    if (statusSnap.exists && statusSnap.data()?.lastSentKey === sentKey) return;

    try {
        const built = await buildTelegramActiveAlertMessage(config, "scheduled");
        const alertCount = Number(built.result?.alertCount || 0);
        if (alertCount === 0 && !config.sendWhenClear) {
            await statusRef.set({
                status: "clear_not_sent",
                lastSentKey: sentKey,
                lastCheckedAtText: new Date().toISOString(),
                lastCheckedDate: now.todayStr,
                lastScheduledTime: config.sendTime,
                alertCount: 0,
                readCount: Number(built.ctx.readCount || 0),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            return;
        }

        const chatIds = resolveTelegramActiveAlertChatIds(config);
        if (chatIds.length === 0) throw new Error("尚未選擇有效的 Telegram 接收群組");
        await Promise.all(chatIds.map((id) => sendTelegramMessage(id, built.message)));
        await statusRef.set({
            status: "sent",
            lastSentKey: sentKey,
            lastSentDate: now.todayStr,
            lastSentTime: config.sendTime,
            lastSentAtText: new Date().toISOString(),
            alertCount,
            readCount: Number(built.ctx.readCount || 0),
            chatTargets: config.chatTargets,
            brandIds: config.brandIds,
            messagePreview: built.message.slice(0, 500),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (error) {
        await statusRef.set({
            status: "error",
            lastError: error.message,
            lastErrorAtText: new Date().toISOString(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        throw error;
    }
});

// SaaS 介面的「預覽」與「測試推播」透過 Firestore command document 觸發，
// 避免使用者接觸 Firebase Console，也不需要把 Bot Token 暴露到前端。
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
        const built = await buildTelegramActiveAlertMessage(config, `command:${event.params.commandId}`);
        const action = String(data.action || "preview");
        let sentChatIds = [];
        if (action === "test") {
            sentChatIds = resolveTelegramActiveAlertChatIds(config);
            if (sentChatIds.length === 0) throw new Error("尚未選擇有效的 Telegram 接收群組");
            const testMessage = `🧪 測試推播（不影響正式排程）\n\n${built.message}`.slice(0, 3900);
            await Promise.all(sentChatIds.map((id) => sendTelegramMessage(id, testMessage)));
        }
        await ref.set({
            status: "completed",
            completedAtText: new Date().toISOString(),
            previewText: built.message,
            alertCount: Number(built.result?.alertCount || 0),
            readCount: Number(built.ctx.readCount || 0),
            sentChatIds,
            resultSummary: {
                expectedProgress: built.result?.expectedProgress ?? null,
                brandSummaries: built.result?.brandSummaries || [],
            },
        }, { merge: true });
        await getTelegramActiveAlertStatusRef().set({
            lastManualAction: action,
            lastManualActionAtText: new Date().toISOString(),
            lastManualAlertCount: Number(built.result?.alertCount || 0),
            lastManualReadCount: Number(built.ctx.readCount || 0),
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
// ★ 4. Telegram 動態定時推播巡邏員（規則感知節流版）
// 只在 08:00～11:59 每分鐘檢查規則；真正符合通知時間後，
// 再依規則類型載入必要資料，避免每次通知都掃描所有大型集合。
// ==========================================
exports.notificationPatrol = onSchedule({
    schedule: "* 8-11 * * *",
    timeZone: "Asia/Taipei",
    secrets: [TELEGRAM_BOT_TOKEN_SECRET],
}, async () => {
    const now = new Date();
    const utcHours = now.getUTCHours();
    now.setHours(utcHours + 8);
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMin = String(now.getMinutes()).padStart(2, '0');
    const timeString = `${currentHour}:${currentMin}`;

    try {
        const allRulesSnap = await db.collectionGroup("notification_rules").get();
        const uniqueRules = {};

        allRulesSnap.forEach((doc) => {
            const data = doc.data() || {};
            if (String(data.isActive) !== "true") return;
            if (data.time !== timeString) return;
            uniqueRules[data.source] = data;
        });

        const rulesList = Object.values(uniqueRules);
        if (rulesList.length === 0) {
            console.log(`目前時間 ${timeString} 查無符合任務，機器人休眠。`);
            return;
        }

        const sourceSet = new Set(rulesList.map((rule) => String(rule.source || '')));
        const needsStoreReports = sourceSet.has('top5_stores') || sourceSet.has('unreported');
        const needsTherapistReports = sourceSet.has('top5_therapists');
        const needsRoster = sourceSet.has('unreported');
        const needsProgress = sourceSet.has('progress');

        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() - 1);
        const yesterdayStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
        const currentYearMonth = yesterdayStr.substring(0, 7);

        const emptyBrandArrays = () => ({ cyj: [], anniu: [], yibo: [] });
        const emptyBrandSets = () => ({ cyj: new Set(), anniu: new Set(), yibo: new Set() });

        const [dailySnap, therapistSnap, aggSnap, activeRosterByBrand, monthlyBudgetsByBrand] = await Promise.all([
            needsStoreReports
                ? db.collectionGroup('daily_reports').where('date', '==', yesterdayStr).get()
                : Promise.resolve(null),
            needsTherapistReports
                ? db.collectionGroup('therapist_daily_reports').where('date', '==', yesterdayStr).get()
                : Promise.resolve(null),
            needsProgress
                ? db.collectionGroup('monthly_aggregated').where('yearMonth', '==', currentYearMonth).get()
                : Promise.resolve(null),
            needsRoster
                ? loadTelegramActiveRosterByBrand()
                : Promise.resolve(emptyBrandSets()),
            needsProgress
                ? loadTelegramMonthlyBudgetsByBrand(currentYearMonth)
                : Promise.resolve({
                    cyj: { cash: 0, accrual: 0, source: 'not_required' },
                    anniu: { cash: 0, accrual: 0, source: 'not_required' },
                    yibo: { cash: 0, accrual: 0, source: 'not_required' },
                }),
        ]);

        const reportsByBrand = emptyBrandArrays();
        const submittedStoresByBrand = emptyBrandSets();
        if (dailySnap) {
            dailySnap.forEach((doc) => {
                const data = doc.data() || {};
                const bId = resolveTelegramBrandId(data, doc.ref.path);
                reportsByBrand[bId].push(data);
                const storeCore = normalizeSummaryCoreName(data.storeName || data.store || '');
                if (storeCore) submittedStoresByBrand[bId].add(storeCore);
            });
        }

        const therapistReportsByBrand = emptyBrandArrays();
        if (therapistSnap) {
            therapistSnap.forEach((doc) => {
                const data = doc.data() || {};
                const bId = resolveTelegramBrandId(data, doc.ref.path);
                therapistReportsByBrand[bId].push(data);
            });
        }

        const monthlyAggByBrand = emptyBrandArrays();
        const processedAggStores = emptyBrandSets();
        if (aggSnap) {
            aggSnap.forEach((doc) => {
                const data = doc.data() || {};
                const bId = resolveTelegramBrandId(data, doc.ref.path);
                const storeCore = normalizeSummaryCoreName(data.storeName || data.store || '');
                if (storeCore && !processedAggStores[bId].has(storeCore)) {
                    monthlyAggByBrand[bId].push(data);
                    processedAggStores[bId].add(storeCore);
                }
            });
        }

        for (const rule of rulesList) {
            const chatId = rule.targetGroup === 'manager' ? TARGET_CHAT_ID_MANAGER : TARGET_CHAT_ID_MAIN;

            for (const brand of [
                { id: 'cyj', name: 'DRCYJ' },
                { id: 'anniu', name: '安妞' },
                { id: 'yibo', name: '伊啵' },
            ]) {
                let finalMessage = String(rule.template || '').replace(/{date}/g, yesterdayStr);
                let shouldSend = false;

                if (rule.source === 'top5_stores') {
                    const storeMap = {};
                    reportsByBrand[brand.id].forEach((data) => {
                        const sName = String(data.storeName || '').replace(/店$/, '').trim() + '店';
                        if (!storeMap[sName]) storeMap[sName] = 0;
                        storeMap[sName] += (Number(data.cash) || 0) - (Number(data.refund) || 0);
                    });
                    const top5 = Object.entries(storeMap)
                        .map(([name, rev]) => ({ name, rev }))
                        .sort((a, b) => b.rev - a.rev)
                        .slice(0, 5)
                        .filter((store) => store.rev > 0);
                    if (top5.length > 0) {
                        shouldSend = true;
                        const badges = ['🥇', '🥈', '🥉', '4.', '5.'];
                        const top5Text = top5
                            .map((store, idx) => `${badges[idx]} ${store.name} ($${store.rev.toLocaleString()})`)
                            .join('\n');
                        finalMessage = finalMessage.replace(/{top5Stores}/g, `${top5Text}\n`);
                        finalMessage = `🏢 *【${brand.name} 專屬戰報】*\n${finalMessage}`;
                    }
                }

                if (rule.source === 'unreported') {
                    const expectedStores = Array.from(activeRosterByBrand[brand.id]);
                    const submittedStores = submittedStoresByBrand[brand.id];
                    const missing = expectedStores.filter((store) => !submittedStores.has(store));
                    if (expectedStores.length > 0) {
                        shouldSend = true;
                        if (missing.length > 0) {
                            const missingText = missing.map((store) => `• ${store}`).join('\n');
                            finalMessage = finalMessage.replace(/{missingStores}/g, missingText);
                            finalMessage = finalMessage.replace(/{missingCount}/g, String(missing.length));
                            finalMessage = `🚨 *【${brand.name} 異常通報】*\n${finalMessage}`;
                        } else {
                            finalMessage = finalMessage.replace(/{missingStores}/g, '✅ 表現優異，全區皆已完成回報！');
                            finalMessage = finalMessage.replace(/{missingCount}/g, '0');
                            finalMessage = `✅ *【${brand.name} 回報總結】*\n${finalMessage}`;
                        }
                    }
                }

                if (rule.source === 'top5_therapists') {
                    const top5T = [...therapistReportsByBrand[brand.id]]
                        .sort((a, b) => (Number(b.totalRevenue) || 0) - (Number(a.totalRevenue) || 0))
                        .slice(0, 5)
                        .filter((row) => (Number(row.totalRevenue) || 0) > 0);
                    if (top5T.length > 0) {
                        shouldSend = true;
                        const badges = ['🥇', '🥈', '🥉', '4.', '5.'];
                        const top5Text = top5T.map((row, idx) => {
                            const storeName = String(row.storeName || '').replace(/店$/, '').trim() + '店';
                            return `${badges[idx]} ${row.therapistName} (${storeName}) - $${(Number(row.totalRevenue) || 0).toLocaleString()}`;
                        }).join('\n');
                        finalMessage = finalMessage.replace(/{top5Therapists}/g, `${top5Text}\n`);
                        finalMessage = `🌟 *【${brand.name} 個人榮耀】*\n${finalMessage}`;
                    }
                }

                if (rule.source === 'progress') {
                    let cashTotal = 0;
                    let accrualTotal = 0;
                    monthlyAggByBrand[brand.id].forEach((data) => {
                        cashTotal += (Number(data.cash) || 0) - (Number(data.refund) || 0);
                        accrualTotal += brand.id === 'anniu'
                            ? (Number(data.operationalAccrual) || 0)
                            : (Number(data.accrual) || 0);
                    });

                    const brandBudget = monthlyBudgetsByBrand[brand.id] || { cash: 0, accrual: 0 };
                    const cashRate = brandBudget.cash > 0 ? ((cashTotal / brandBudget.cash) * 100).toFixed(1) : '0.0';
                    const accrualRate = brandBudget.accrual > 0 ? ((accrualTotal / brandBudget.accrual) * 100).toFixed(1) : '0.0';

                    if (cashTotal > 0 || accrualTotal > 0) {
                        shouldSend = true;
                        finalMessage = finalMessage.replace(/{cashTotal}/g, cashTotal.toLocaleString());
                        finalMessage = finalMessage.replace(/{accrualTotal}/g, accrualTotal.toLocaleString());
                        finalMessage = finalMessage.replace(/{cashRate}/g, cashRate);
                        finalMessage = finalMessage.replace(/{accrualRate}/g, accrualRate);
                        finalMessage = `📊 *【${brand.name} 本月累積進度】*\n${finalMessage}`;
                    }
                }

                if (shouldSend) {
                    try {
                        await sendTelegramMessage(chatId, finalMessage, { parse_mode: 'Markdown' });
                    } catch (error) {
                        console.error(`❌ Telegram 發送失敗：${error.message}`);
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ 巡邏員執行錯誤：', error);
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
            const sName = data.storeName;
            if (!sName) return;
            
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

// Queue fallback 是「防漏保險」，不是正常主流程。
// 正常歷史異動由 summary_recalc_flags 每 5 分鐘即時處理；
// fallback 平時每 30 分鐘分頁巡檢 50 筆；若尚有下一頁則暫時每 5 分鐘續掃，快速消化既有 backlog。
// 保留舊資料／漏寫 flag 的補救能力，同時避免平時每 5 分鐘全掃 500 筆。
const SUMMARY_QUEUE_FALLBACK_LIMIT = 50;
const SUMMARY_QUEUE_FALLBACK_INTERVAL_MS = 30 * 60 * 1000;
const SUMMARY_QUEUE_FALLBACK_CATCHUP_INTERVAL_MS = 5 * 60 * 1000;
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
  return raw
    .replace(/^(CYJ|DRCYJ|Anew安妞|Yibo伊啵|Anew|Yibo|安妞|伊啵)/i, "")
    .replace(/店/g, "")
    .replace(/臺/g, "台")
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
    .limit(SUMMARY_QUEUE_FALLBACK_LIMIT);

  if (cursorDocId) query = query.startAfter(cursorDocId);

  const queueSnap = await query.get();
  const hasMorePages = queueSnap.size >= SUMMARY_QUEUE_FALLBACK_LIMIT;
  const nextCursorDocId = hasMorePages
    ? queueSnap.docs[queueSnap.docs.length - 1].id
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
    lastPageSize: queueSnap.size,
    wrappedToStart: nextCursorDocId === "",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText,
  }, { merge: true });

  return {
    due: true,
    docs: queueSnap.docs,
    cursorDocId: nextCursorDocId,
    nextRunAfterMs,
    scanMode: hasMorePages ? "catchup" : "steady",
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

function buildAutoTargetRow(id, value = {}, yearMonth = "") {
  if (!value || typeof value !== "object") return null;
  const targetMonth = extractAutoTargetYearMonth(id, value);
  if (targetMonth && yearMonth && targetMonth !== yearMonth) return null;
  const storeCore = extractAutoTargetStore(id, value, yearMonth);
  if (!storeCore || !hasOwnTargetField(value)) return null;
  return {
    storeCore,
    target: {
      id: value.id || id,
      storeName: value.storeName || value.store || value.name || storeCore,
      cashTarget: Number(value.cashTarget || value.cash || value.budget || value.target || value.targetCash || value.cashBudget || 0),
      accrualTarget: Number(value.accrualTarget || value.accrual || value.accrualBudget || value.targetAccrual || 0),
      challengeCashTarget: Number(value.challengeCashTarget || value.challengeCash || value.challengeTarget || 0),
      challengeAccrualTarget: Number(value.challengeAccrualTarget || value.challengeAccrual || 0),
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
        const id = value?.id || value?.storeName || value?.store || value?.name || String(index);
        const row = buildAutoTargetRow(id, value, yearMonth);
        if (row) targetMap[row.storeCore] = row.target;
      });
      return;
    }
    if (typeof container === "object") {
      Object.entries(container).forEach(([id, value]) => {
        const row = buildAutoTargetRow(id, value, yearMonth);
        if (row) targetMap[row.storeCore] = row.target;
      });
    }
  };

  containers.forEach(consumeContainer);
  return targetMap;
}

function getAutoTargetCoverage(targetMap = {}, expectedStores = []) {
  const expected = new Set((expectedStores || []).map(normalizeSummaryCoreName).filter(Boolean));
  const actual = new Set(Object.keys(targetMap || {}).map(normalizeSummaryCoreName).filter(Boolean));
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
    if (row) targetMap[row.storeCore] = row.target;
  });
  return targetMap;
}

async function loadAutoMonthlyTargetMap(brandId, yearMonth, expectedStores = []) {
  try {
    const summarySnap = await getSummaryCollection(brandId, "monthly_targets_summary").doc(yearMonth).get();
    if (summarySnap.exists) {
      const summaryMap = extractAutoTargetMapFromSummaryData(summarySnap.data() || {}, yearMonth);
      const coverage = getAutoTargetCoverage(summaryMap, expectedStores);
      const minimumCoverage = (expectedStores || []).length >= 5 ? 0.9 : 0.5;
      if (Object.keys(summaryMap).length > 0 && coverage >= minimumCoverage) {
        return summaryMap;
      }
      console.warn(`monthly_targets_summary coverage insufficient; fallback full collection: ${brandId}/${yearMonth}, coverage=${coverage.toFixed(2)}`);
    }
  } catch (error) {
    console.warn(`monthly_targets_summary read failed; fallback full collection: ${brandId}/${yearMonth}`, error.message);
  }
  return loadRawMonthlyTargetMap(brandId, yearMonth);
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
      const cashTotal = pickTelegramSummaryTotal(data, ["totalCashTarget", "cashTargetTotal", "cashTotal", "cashTarget", "cashBudget"]);
      const accrualTotal = pickTelegramSummaryTotal(data, ["totalAccrualTarget", "accrualTargetTotal", "accrualTotal", "accrualTarget", "accrualBudget"]);
      if ((cashTotal !== null && cashTotal > 0) || (accrualTotal !== null && accrualTotal > 0)) {
        return { cash: cashTotal || 0, accrual: accrualTotal || 0, source: "monthly_targets_summary_totals" };
      }

      const summaryMap = extractAutoTargetMapFromSummaryData(data, yearMonth);
      const coverage = getAutoTargetCoverage(summaryMap, expectedStores);
      const minimumCoverage = expectedStores.length >= 5 ? 0.9 : 0.5;
      if (Object.keys(summaryMap).length > 0 && coverage >= minimumCoverage) {
        return { ...sumTelegramTargetMap(summaryMap), source: "monthly_targets_summary_stores" };
      }
    }
  } catch (error) {
    console.warn(`Telegram monthly_targets_summary read failed: ${brandId}/${yearMonth}`, error.message);
  }

  try {
    const dashboardSnap = await getSummaryCollection(brandId, "dashboard_summary").doc(yearMonth).get();
    if (dashboardSnap.exists) {
      const dashboardMap = extractAutoTargetMapFromSummaryData(dashboardSnap.data() || {}, yearMonth);
      if (Object.keys(dashboardMap).length > 0) {
        return { ...sumTelegramTargetMap(dashboardMap), source: "dashboard_summary" };
      }
    }
  } catch (error) {
    console.warn(`Telegram dashboard_summary target fallback failed: ${brandId}/${yearMonth}`, error.message);
  }

  const rawMap = await loadRawMonthlyTargetMap(brandId, yearMonth);
  return { ...sumTelegramTargetMap(rawMap), source: "monthly_targets_full_fallback" };
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
  const targets = await loadAutoMonthlyTargetMap(brandId, yearMonth, orgProfile.stores);
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

  const therapistRankings = Object.values(therapistMap).sort((a, b) => b.totalRevenue - a.totalRevenue);
  therapistRankings.forEach((item, index) => {
    item.rank = index + 1;
    item.totalPeers = therapistRankings.length;
    item.status = item.rank <= 3 ? "TOP" : item.rank > therapistRankings.length - 10 ? "DANGER" : "NORMAL";
    item.newClosingRate = item.newCustomerCount > 0 ? (item.newCustomerClosings / item.newCustomerCount) * 100 : 0;
    item.newAsp = item.newCustomerCount > 0 ? item.newCustomerRevenue / item.newCustomerCount : 0;
    item.oldAsp = item.oldCustomerCount > 0 ? item.oldCustomerRevenue / item.oldCustomerCount : 0;
  });

  const therapistGrand = therapistRankings.reduce((acc, item) => {
    acc.totalRevenue += item.totalRevenue;
    acc.serviceCount += item.serviceCount;
    acc.newCustomerRevenue += item.newCustomerRevenue;
    acc.oldCustomerRevenue += item.oldCustomerRevenue;
    acc.newCustomerCount += item.newCustomerCount;
    acc.oldCustomerCount += item.oldCustomerCount;
    acc.newCustomerClosings += item.newCustomerClosings;
    acc.returnRevenue += item.returnRevenue;
    return acc;
  }, { totalRevenue: 0, serviceCount: 0, newCustomerRevenue: 0, oldCustomerRevenue: 0, newCustomerCount: 0, oldCustomerCount: 0, newCustomerClosings: 0, returnRevenue: 0, count: therapistRankings.length });
  therapistGrand.regionalNewClosingRate = therapistGrand.newCustomerCount > 0 ? (therapistGrand.newCustomerClosings / therapistGrand.newCustomerCount) * 100 : 0;
  therapistGrand.regionalNewAsp = therapistGrand.newCustomerCount > 0 ? therapistGrand.newCustomerRevenue / therapistGrand.newCustomerCount : 0;

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
    grandTotal: grand,
    stores: storeMap,
    storeRankings: storeRanking,
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
    storeTop3: dashboardSummary.storeTop3,
    storeRankings: storeRanking.map((s) => ({ store: s.store, displayName: s.displayName, manager: s.manager, cash: s.cash, budget: s.budget, achievement: s.achievement, rank: s.rank })),
    therapistTop3: { today: therapistSummary.todayTop3, yesterday: therapistSummary.yesterdayTop3, monthly: therapistSummary.monthlyTop5.slice(0, 3) },
    therapistRankings: therapistRankings.map((t) => ({ id: t.id, name: t.name, storeDisplay: t.storeDisplay, manager: t.manager, totalRevenue: t.totalRevenue, rank: t.rank, status: t.status })),
    lastUpdatedAt: nowTimestamp,
    lastUpdatedAtText: nowIso,
    source: "auto_summary_repair",
    version: "rankings-summary-v1",
  };

  return { dashboardSummary, therapistSummary, rankingsSummary, brandLabel };
}

function getAutoMetricValue(obj, path) {
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : 0), obj || {});
}

function makeAutoSummaryCompareRows({ storedDashboard, storedTherapist, freshDashboard, freshTherapist }) {
  const rows = [
    { label: "現金業績", stored: getAutoMetricValue(storedDashboard, "grandTotal.cash"), fresh: getAutoMetricValue(freshDashboard, "grandTotal.cash"), type: "money" },
    { label: "權責業績", stored: getAutoMetricValue(storedDashboard, "grandTotal.accrual"), fresh: getAutoMetricValue(freshDashboard, "grandTotal.accrual"), type: "money" },
    { label: "人員業績", stored: getAutoMetricValue(storedTherapist, "grandTotal.totalRevenue"), fresh: getAutoMetricValue(freshTherapist, "grandTotal.totalRevenue"), type: "money" },
    { label: "店日報筆數", stored: getAutoMetricValue(storedDashboard, "sourceCounts.dailyReports"), fresh: getAutoMetricValue(freshDashboard, "sourceCounts.dailyReports"), type: "count" },
    { label: "管理師日報筆數", stored: getAutoMetricValue(storedTherapist, "sourceCounts.therapistReports"), fresh: getAutoMetricValue(freshTherapist, "sourceCounts.therapistReports"), type: "count" },
    { label: "店家數", stored: getAutoMetricValue(storedDashboard, "sourceCounts.stores"), fresh: getAutoMetricValue(freshDashboard, "sourceCounts.stores"), type: "count" },
    { label: "管理師數", stored: getAutoMetricValue(storedTherapist, "sourceCounts.therapists"), fresh: getAutoMetricValue(freshTherapist, "sourceCounts.therapists"), type: "count" },
    { label: "目標店數", stored: getAutoMetricValue(storedDashboard, "sourceCounts.targetStores"), fresh: getAutoMetricValue(freshDashboard, "sourceCounts.targetStores"), type: "count" },
  ];

  return rows.map((row) => {
    const diff = Number(row.stored || 0) - Number(row.fresh || 0);
    const diffRate = Number(row.fresh || 0) !== 0 ? (diff / Number(row.fresh || 0)) * 100 : (diff === 0 ? 0 : 100);
    return { ...row, diff, diffRate, matched: Math.abs(diff) < 0.0001 };
  });
}

async function loadPendingQueueRowsForAutoRepair(brandId, yearMonth) {
  const queueRef = getSummaryCollection(brandId, "recalc_queue");

  // 指定月份重建時，只讀取該月份的 queue 文件；不再掃描其他月份的 pending。
  // 不加 status 複合條件，避免本次修正依賴新的複合索引；取回後只保留 pending。
  // 舊格式 pending 會由低頻 fallback 分頁巡檢時補上 affectedYearMonth，再進入同一條精準流程。
  const exactMonthSnap = await queueRef
    .where("affectedYearMonth", "==", yearMonth)
    .get();

  return exactMonthSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((row) => String(row.status || "") === "pending");
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

    const rows = makeAutoSummaryCompareRows({ storedDashboard: dashboardSummary, storedTherapist: therapistSummary, freshDashboard: dashboardSummary, freshTherapist: therapistSummary });
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

      flagSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const yearMonth = data.affectedYearMonth || data.yearMonth || docSnap.id;
        if (!/^\d{4}-\d{2}$/.test(String(yearMonth || ""))) return;
        // 當月與未來月份仍屬即時營運期，不應交給 Summary 自動修復處理。
        if (!isHistoricalYearMonthForAutoRepair(yearMonth)) return;

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
      const legacyBackfillBatch = db.batch();
      let legacyBackfillCount = 0;
      const normalizedAtText = new Date(now).toISOString();

      fallbackPage.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const yearMonth = getQueueMonth(data);
        if (!yearMonth) return;

        // 舊格式相容：早期 queue 可能只有 yearMonth / date / sourceDate。
        // 巡檢讀到後先補齊 affectedYearMonth，讓同一次與後續重建都能使用精準月份查詢。
        if (!/^\d{4}-\d{2}$/.test(String(data.affectedYearMonth || ""))) {
          legacyBackfillBatch.set(docSnap.ref, {
            affectedYearMonth: yearMonth,
            normalizedBy: "auto_summary_queue_fallback",
            normalizedAt: admin.firestore.FieldValue.serverTimestamp(),
            normalizedAtText,
          }, { merge: true });
          legacyBackfillCount += 1;
        }

        // 只自動整理已成為歷史的月份；本月與未來月份不處理，避免 0 日報或預先目標造成錯誤重建。
        if (!isHistoricalYearMonthForAutoRepair(yearMonth)) return;
        if (!queueGroups[yearMonth]) {
          queueGroups[yearMonth] = { count: 0, latestAt: "" };
        }
        queueGroups[yearMonth].count += 1;
        const t = data.updatedAtText || data.createdAtText || data.date || data.sourceDate || "";
        if (!queueGroups[yearMonth].latestAt || String(t) > String(queueGroups[yearMonth].latestAt)) {
          queueGroups[yearMonth].latestAt = String(t);
        }
      });

      // 必須先完成舊格式補欄位，再讓本輪工作進入月份精準查詢。
      if (legacyBackfillCount > 0) await legacyBackfillBatch.commit();

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