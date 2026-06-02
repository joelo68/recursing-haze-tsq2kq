const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const functions = require("firebase-functions/v1"); 
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

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
  const promises = [];

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

    promises.push(flagRef.set({
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
    }, { merge: true }));

    promises.push(queueRef.set({
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
    }, { merge: true }));
  });

  return promises.length ? Promise.all(promises) : null;
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
// ★ Telegram 設定
// ==========================================
const TELEGRAM_BOT_TOKEN = '8787208059:AAF0AiGfUaV69YouI_b_0MuMcXpwu9EK0RA';
const TARGET_CHAT_ID_MAIN = '-4991191955'; 
const TARGET_CHAT_ID_MANAGER = '-4991191955'; 
const BRANDS = [{ id: 'cyj', name: 'CYJ' }, { id: 'anniu', name: '安妞' }, { id: 'yibo', name: '伊啵' }];

// ==========================================
// ★ 2. AI 戰略雙引擎：1. 日常精準推估引擎
// ==========================================
function calculateExactFrontendProjection(dailyCashMap, year, month, currentDayNum) {
    const daysInMonth = new Date(year, month, 0).getDate();
    let cashTotal = 0;
    const dailyCashArray = [];
    const normalizedMap = {};
    for(let [k, v] of Object.entries(dailyCashMap)) {
        const normK = k.replace(/\//g, '-');
        normalizedMap[normK] = (normalizedMap[normK] || 0) + v;
    }
    for (let i = 1; i <= currentDayNum; i++) {
        const dayStr = String(i).padStart(2, '0');
        const dateTarget = `${year}-${String(month).padStart(2, '0')}-${dayStr}`;
        const cash = normalizedMap[dateTarget] || 0;
        dailyCashArray.push(cash);
        cashTotal += cash;
    }
    if (currentDayNum <= 5) return currentDayNum > 0 ? Math.round((cashTotal / currentDayNum) * daysInMonth) : 0;
    const sortedCash = [...dailyCashArray].sort((a, b) => a - b);
    const mid = Math.floor(sortedCash.length / 2);
    const median = sortedCash.length % 2 !== 0 ? sortedCash[mid] : (sortedCash[mid - 1] + sortedCash[mid]) / 2;
    const threshold = median * 2;
    const dowData = { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] };
    let normalCashSum = 0; let normalDaysCount = 0;
    for (let i = 1; i <= currentDayNum; i++) {
        const cash = dailyCashArray[i - 1]; 
        if (cash <= threshold || median === 0) {
           const dObj = new Date(year, month - 1, i);
           dowData[dObj.getDay()].push(cash); normalCashSum += cash; normalDaysCount++;
        }
    }
    const fallbackAvg = normalDaysCount > 0 ? (normalCashSum / normalDaysCount) : 0;
    const dowAvg = {};
    for (let i = 0; i < 7; i++) dowAvg[i] = dowData[i].length > 0 ? dowData[i].reduce((a,b) => a+b, 0) / dowData[i].length : fallbackAvg; 
    let projectedRemaining = 0;
    for (let d = currentDayNum + 1; d <= daysInMonth; d++) projectedRemaining += dowAvg[new Date(year, month - 1, d).getDay()];
    return Math.round(cashTotal + projectedRemaining);
}

function getClampedDaysPassed(overallDailyCash, year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const now = new Date(); now.setHours(now.getUTCHours() + 8); 
    let daysPassed = daysInMonth;
    const isCurrentMonth = (year === now.getFullYear() && month === (now.getMonth() + 1));
    if (isCurrentMonth) daysPassed = Math.max(0, now.getDate() - 1);
    let maxDataDay = 0;
    Object.keys(overallDailyCash).forEach(dateStr => {
        const dayNum = parseInt(dateStr.replace(/\//g, '-').split('-')[2], 10);
        if (dayNum > maxDataDay) maxDataDay = dayNum;
    });
    if (isCurrentMonth) {
        if (maxDataDay > daysPassed) daysPassed = maxDataDay;
        if (daysPassed > now.getDate()) daysPassed = now.getDate(); 
    } else { daysPassed = maxDataDay > 0 ? maxDataDay : daysInMonth; }
    return daysPassed;
}

async function getStorePerformance(startDate, endDate, storeName = null, brandName = null) {
    if (storeName && !brandName) {
        const sUpper = storeName.toUpperCase();
        if (sUpper === 'CYJ' || sUpper.includes('安妞') || sUpper.includes('伊啵')) { brandName = storeName; storeName = null; }
    }
    const snap = await db.collectionGroup('daily_reports').where('date', '>=', startDate).where('date', '<=', endDate).get();
    let storeMap = {}; let processed = new Set();
    let overall = { cash: 0, accrual: 0, skincare: 0, traffic: 0, newRev: 0, newCount: 0, newClosings: 0, oldRev: 0, oldCount: 0, dailyCash: {}, dailyTrends: {} };

    snap.forEach(doc => {
        const data = doc.data(); if(!data.storeName || !data.date) return;
        const sName = data.storeName.trim(); const uniqueKey = `${data.date}_${sName}`;
        if (processed.has(uniqueKey)) return; processed.add(uniqueKey);

        let bId = 'CYJ'; const path = doc.ref.path.toLowerCase();
        if (path.includes('anniu') || path.includes('anew')) bId = '安妞'; else if (path.includes('yibo')) bId = '伊啵';

        if (brandName && !bId.toUpperCase().includes(brandName.toUpperCase()) && !brandName.toUpperCase().includes(bId.toUpperCase())) return;
        if (storeName && !sName.includes(storeName)) return;

        if (!storeMap[sName]) storeMap[sName] = { storeName: sName, brand: bId, cash: 0, accrual: 0, skincare: 0, traffic: 0, newRev: 0, newCount: 0, newClosings: 0, oldRev: 0, oldCount: 0, dailyCash: {} };
        
        const cash = (Number(data.cash) || 0) - (Number(data.refund) || 0);
        const accrual = (bId === '安妞') ? (Number(data.operationalAccrual) || 0) : (Number(data.accrual) || 0);
        const skincare = (Number(data.skincareSales) || 0) - (Number(data.skincareRefund) || 0);
        const traffic = Number(data.traffic) || 0;
        const newRev = Number(data.newCustomerSales) || Number(data.newCustomerRevenue) || 0;
        const oldRev = Number(data.oldCustomerRevenue) || (cash - newRev > 0 ? cash - newRev : 0);
        const newCount = Number(data.newCustomers) || Number(data.newCustomerCount) || 0;
        const newClosings = Number(data.newCustomerClosings) || 0;
        const oldCount = Number(data.oldCustomerCount) || (traffic - newCount > 0 ? traffic - newCount : 0);

        storeMap[sName].cash += cash; storeMap[sName].accrual += accrual; storeMap[sName].skincare += skincare; storeMap[sName].traffic += traffic;
        storeMap[sName].newRev += newRev; storeMap[sName].newCount += newCount; storeMap[sName].newClosings += newClosings; storeMap[sName].oldRev += oldRev; storeMap[sName].oldCount += oldCount;
        storeMap[sName].dailyCash[data.date] = (storeMap[sName].dailyCash[data.date] || 0) + cash;

        overall.cash += cash; overall.accrual += accrual; overall.skincare += skincare; overall.traffic += traffic;
        overall.newRev += newRev; overall.newCount += newCount; overall.newClosings += newClosings; overall.oldRev += oldRev; overall.oldCount += oldCount;
        overall.dailyCash[data.date] = (overall.dailyCash[data.date] || 0) + cash;

        if (!overall.dailyTrends[data.date]) overall.dailyTrends[data.date] = { cash: 0, traffic: 0 };
        overall.dailyTrends[data.date].cash += cash; overall.dailyTrends[data.date].traffic += traffic;
    });

    const year = parseInt(startDate.split('-')[0], 10); const month = parseInt(startDate.split('-')[1], 10);
    const currentDayNum = getClampedDaysPassed(overall.dailyCash, year, month);

    overall.projection = calculateExactFrontendProjection(overall.dailyCash, year, month, currentDayNum);
    overall.daily_trends = Object.keys(overall.dailyTrends).sort().map(dateStr => {
        const parts = dateStr.replace(/\//g, '-').split('-');
        const dObj = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
        return { date: dateStr, weekday: `星期${['日', '一', '二', '三', '四', '五', '六'][dObj.getDay()]}`, cash: overall.dailyTrends[dateStr].cash, traffic: overall.dailyTrends[dateStr].traffic };
    });

    Object.values(storeMap).forEach(s => {
        s.newAvg = s.newCount > 0 ? Math.round(s.newRev / s.newCount) : 0;
        s.oldAvg = s.oldCount > 0 ? Math.round(s.oldRev / s.oldCount) : 0;
        s.newClosingRate = s.newCount > 0 ? Number(((s.newClosings / s.newCount) * 100).toFixed(1)) : 0; 
        s.projection = calculateExactFrontendProjection(s.dailyCash, year, month, currentDayNum);
        delete s.dailyCash;
    });

    overall.newAvg = overall.newCount > 0 ? Math.round(overall.newRev / overall.newCount) : 0;
    overall.oldAvg = overall.oldCount > 0 ? Math.round(overall.oldRev / overall.oldCount) : 0;
    overall.newClosingRate = overall.newCount > 0 ? Number(((overall.newClosings / overall.newCount) * 100).toFixed(1)) : 0;
    delete overall.dailyCash; delete overall.dailyTrends;

    return { overall_summary: overall, stores_details: Object.values(storeMap) }; 
}

async function getTherapistPerformance(startDate, endDate, personName = null, storeName = null, brandName = null) {
    if (storeName && !brandName) {
        const sUpper = storeName.toUpperCase();
        if (sUpper === 'CYJ' || sUpper.includes('安妞') || sUpper.includes('伊啵')) { brandName = storeName; storeName = null; }
    }
    const snap = await db.collectionGroup('therapist_daily_reports').where('date', '>=', startDate).where('date', '<=', endDate).get();
    let pMap = {}; let processed = new Set();
    let overall = { revenue: 0, newRev: 0, newCount: 0, newClosings: 0, oldRev: 0, oldCount: 0, dailyCash: {}, dailyTrends: {} };

    snap.forEach(doc => {
        const data = doc.data();
        const tName = data.therapistName || "未知"; const sName = data.storeName ? data.storeName.trim().replace(/店$/, '') : "未知";
        if (!data.date || tName === "未知") return;
        const uniqueKey = `${data.date}_${sName}_${tName}`;
        if (processed.has(uniqueKey)) return; processed.add(uniqueKey);

        let bId = data.brandId || 'CYJ'; const path = doc.ref.path.toLowerCase();
        if (path.includes('anniu') || path.includes('anew')) bId = '安妞'; else if (path.includes('yibo')) bId = '伊啵'; else bId = 'CYJ';

        if (brandName && !bId.toUpperCase().includes(brandName.toUpperCase()) && !brandName.toUpperCase().includes(bId.toUpperCase())) return;
        if (storeName && !sName.includes(storeName)) return;
        if (personName && !tName.toLowerCase().includes(personName.toLowerCase())) return;

        const key = `${bId}_${sName}_${tName}`;
        if (!pMap[key]) pMap[key] = { brand: bId, storeName: sName, personName: tName, revenue: 0, newRev: 0, newCount: 0, newClosings: 0, oldRev: 0, oldCount: 0, dailyCash: {} };
        
        const rev = Number(data.totalRevenue) || 0;
        const newRev = Number(data.newCustomerRevenue) || 0;
        const oldRev = Number(data.oldCustomerRevenue) || (rev - newRev > 0 ? rev - newRev : 0);
        const newCount = Number(data.newCustomerCount) || 0;
        const newClosings = Number(data.newCustomerClosings) || 0;
        const traffic = Number(data.traffic) || Number(data.customerCount) || 0;
        const oldCount = Number(data.oldCustomerCount) || (traffic - newCount > 0 ? traffic - newCount : 0);

        pMap[key].revenue += rev; pMap[key].newRev += newRev; pMap[key].oldRev += oldRev;
        pMap[key].newCount += newCount; pMap[key].oldCount += oldCount; pMap[key].newClosings += newClosings;
        pMap[key].dailyCash[data.date] = (pMap[key].dailyCash[data.date] || 0) + rev;

        overall.revenue += rev; overall.newRev += newRev; overall.oldRev += oldRev;
        overall.newCount += newCount; overall.oldCount += oldCount; overall.newClosings += newClosings;
        overall.dailyCash[data.date] = (overall.dailyCash[data.date] || 0) + rev;

        if (!overall.dailyTrends[data.date]) overall.dailyTrends[data.date] = { revenue: 0, traffic: 0 };
        overall.dailyTrends[data.date].revenue += rev; overall.dailyTrends[data.date].traffic += traffic;
    });

    const year = parseInt(startDate.split('-')[0], 10); const month = parseInt(startDate.split('-')[1], 10);
    const currentDayNum = getClampedDaysPassed(overall.dailyCash, year, month);

    overall.projection = calculateExactFrontendProjection(overall.dailyCash, year, month, currentDayNum);
    overall.daily_trends = Object.keys(overall.dailyTrends).sort().map(dateStr => {
        const parts = dateStr.replace(/\//g, '-').split('-');
        const dObj = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
        return { date: dateStr, weekday: `星期${['日', '一', '二', '三', '四', '五', '六'][dObj.getDay()]}`, revenue: overall.dailyTrends[dateStr].revenue, traffic: overall.dailyTrends[dateStr].traffic };
    });

    Object.values(pMap).forEach(p => {
        p.newAvg = p.newCount > 0 ? Math.round(p.newRev / p.newCount) : 0;
        p.oldAvg = p.oldCount > 0 ? Math.round(p.oldRev / p.oldCount) : 0;
        p.newClosingRate = p.newCount > 0 ? Number(((p.newClosings / p.newCount) * 100).toFixed(1)) : 0; 
        p.projection = calculateExactFrontendProjection(p.dailyCash, year, month, currentDayNum);
        delete p.dailyCash;
    });

    overall.newAvg = overall.newCount > 0 ? Math.round(overall.newRev / overall.newCount) : 0;
    overall.oldAvg = overall.oldCount > 0 ? Math.round(overall.oldRev / overall.oldCount) : 0;
    overall.newClosingRate = overall.newCount > 0 ? Number(((overall.newClosings / overall.newCount) * 100).toFixed(1)) : 0;
    delete overall.dailyCash; delete overall.dailyTrends;

    return { overall_summary: overall, therapists_details: Object.values(pMap).sort((a,b) => b.revenue - a.revenue) };
}

async function getMissingReports(startDate, endDate) {
    const past14Days = new Date(startDate);
    past14Days.setDate(past14Days.getDate() - 14);
    const past14Str = past14Days.toISOString().split('T')[0];
    const rosterSnap = await db.collectionGroup('daily_reports').where('date', '>=', past14Str).get();
    const activeStores = { cyj: new Set(), anniu: new Set(), yibo: new Set() };
    rosterSnap.forEach(doc => {
        let bId = doc.data().brandId || 'cyj';
        if (bId.includes('anniu') || bId.includes('anew')) bId = 'anniu';
        else if (bId.includes('yibo')) bId = 'yibo';
        else bId = 'cyj';
        if(doc.data().storeName) activeStores[bId].add(doc.data().storeName.trim());
    });
    const submittedSnap = await db.collectionGroup('daily_reports').where('date', '>=', startDate).where('date', '<=', endDate).get();
    const submittedStores = { cyj: new Set(), anniu: new Set(), yibo: new Set() };
    submittedSnap.forEach(doc => {
        let bId = doc.data().brandId || 'cyj';
        if (bId.includes('anniu') || bId.includes('anew')) bId = 'anniu';
        else if (bId.includes('yibo')) bId = 'yibo';
        else bId = 'cyj';
        if(doc.data().storeName) submittedStores[bId].add(doc.data().storeName.trim());
    });
    let results = [];
    BRANDS.forEach(brand => {
        const expected = Array.from(activeStores[brand.id]);
        const submitted = submittedStores[brand.id];
        const missing = expected.filter(store => !submitted.has(store));
        if (expected.length > 0) results.push({ brand: brand.name, missingCount: missing.length, missingStores: missing });
    });
    return results;
}

// ==========================================
// ★ 2.5 AI 戰略雙引擎：2. 宏觀大數據分析引擎
// ==========================================
async function getMacroStrategicAnalysis(startMonth, endMonth, storeName = null, brandName = null) {
    if (storeName && !brandName) {
        const sUpper = storeName.toUpperCase();
        if (sUpper === 'CYJ' || sUpper.includes('安妞') || sUpper.includes('伊啵')) {
            brandName = storeName; storeName = null;
        }
    }

    const aggSnap = await db.collectionGroup('monthly_aggregated')
        .where('yearMonth', '>=', startMonth)
        .where('yearMonth', '<=', endMonth)
        .get();

    let monthlyMap = {};
    let storeMap = {};

    aggSnap.forEach(doc => {
        const data = doc.data();
        if(!data.storeName || !data.yearMonth) return;
        const sName = data.storeName.trim();
        const ym = data.yearMonth;

        let bId = 'CYJ';
        const path = doc.ref.path.toLowerCase();
        if (path.includes('anniu') || path.includes('anew')) bId = '安妞';
        else if (path.includes('yibo')) bId = '伊啵';

        if (brandName && !bId.toUpperCase().includes(brandName.toUpperCase()) && !brandName.toUpperCase().includes(bId.toUpperCase())) return;
        if (storeName && !sName.includes(storeName)) return;

        const cash = (Number(data.cash) || 0) - (Number(data.refund) || 0);
        const accrual = (bId === '安妞') ? (Number(data.operationalAccrual) || 0) : (Number(data.accrual) || 0);
        const skincare = (Number(data.skincareSales) || 0) - (Number(data.skincareRefund) || 0);
        const traffic = Number(data.traffic) || 0;
        const newRev = Number(data.newCustomerSales) || 0;
        const newCount = Number(data.newCustomers) || 0;

        if(!monthlyMap[ym]) monthlyMap[ym] = { cash: 0, accrual: 0, skincare: 0, traffic: 0, newRev: 0, newCount: 0 };
        monthlyMap[ym].cash += cash; monthlyMap[ym].accrual += accrual; monthlyMap[ym].skincare += skincare;
        monthlyMap[ym].traffic += traffic; monthlyMap[ym].newRev += newRev; monthlyMap[ym].newCount += newCount;

        if(!storeMap[sName]) storeMap[sName] = { brand: bId, cash: 0, accrual: 0, skincare: 0, traffic: 0, newRev: 0, newCount: 0 };
        storeMap[sName].cash += cash; storeMap[sName].accrual += accrual; storeMap[sName].skincare += skincare;
        storeMap[sName].traffic += traffic; storeMap[sName].newRev += newRev; storeMap[sName].newCount += newCount;
    });

    const targetsSnap = await db.collectionGroup('monthly_targets').get();
    let targetMap = {};
    targetsSnap.forEach(doc => {
         const parts = doc.id.split('_');
         if(parts.length >= 3) {
             const tStore = parts[0].replace(/CYJ|安妞|伊啵|店/g, '').trim();
             const ym = `${parts[1]}-${parts[2].padStart(2, '0')}`;
             if (ym >= startMonth && ym <= endMonth) {
                 if(!targetMap[tStore]) targetMap[tStore] = { cash: 0, accrual: 0 };
                 targetMap[tStore].cash += (Number(doc.data().cashTarget) || 0);
                 targetMap[tStore].accrual += (Number(doc.data().accrualTarget) || 0);
             }
         }
    });

    const storeHealth = Object.keys(storeMap).map(s => {
        const coreName = s.replace(/CYJ|安妞|伊啵|店/g, '').trim();
        const target = targetMap[coreName]?.cash || 0;
        const cash = storeMap[s].cash;
        return {
            storeName: s,
            brand: storeMap[s].brand,
            totalCash: cash,
            targetCash: target,
            achievementRate: target > 0 ? ((cash / target) * 100).toFixed(1) + '%' : '無目標資料',
            skincareRatio: cash > 0 ? ((storeMap[s].skincare / cash) * 100).toFixed(1) + '%' : '0%',
            newCustomerASP: storeMap[s].newCount > 0 ? Math.round(storeMap[s].newRev / storeMap[s].newCount) : 0,
        };
    }).sort((a, b) => b.totalCash - a.totalCash);

    return {
        analysis_range: `${startMonth} ~ ${endMonth}`,
        monthly_trends: Object.keys(monthlyMap).sort().map(m => ({ month: m, ...monthlyMap[m] })),
        store_health_and_targets: storeHealth
    };
}


const aiTools = {
    functionDeclarations: [
        {
            name: "getStorePerformance",
            description: "【單月內日常查詢】查詢店鋪/品牌的營運狀況。",
            parameters: { 
                type: "OBJECT", 
                properties: { 
                    startDate: { type: "STRING" }, 
                    endDate: { type: "STRING" }, 
                    storeName: { type: "STRING" }, 
                    brandName: { type: "STRING" } 
                } 
            }
        },
        {
            name: "getTherapistPerformance",
            description: "【單月內日常查詢】查詢人員/諮詢師的個人業績。",
            parameters: { 
                type: "OBJECT", 
                properties: { 
                    startDate: { type: "STRING" }, 
                    endDate: { type: "STRING" }, 
                    personName: { type: "STRING" }, 
                    storeName: { type: "STRING" }, 
                    brandName: { type: "STRING" } 
                } 
            }
        },
        {
            name: "getMissingReports",
            description: "查詢未交日報名單。",
            parameters: { type: "OBJECT", properties: { startDate: { type: "STRING" }, endDate: { type: "STRING" } } }
        },
        {
            name: "getMacroStrategicAnalysis",
            description: "【跨月/跨季/長區間大數據專用】查詢多個月份的宏觀趨勢、各店預算達標率。",
            parameters: { 
                type: "OBJECT", 
                properties: { 
                    startMonth: { type: "STRING" }, 
                    endMonth: { type: "STRING" }, 
                    storeName: { type: "STRING" }, 
                    brandName: { type: "STRING" } 
                },
                required: ["startMonth", "endMonth"]
            }
        }
    ]
};

// ==========================================
// ★ 3. Webhook: AI Agent 對話總機 
// ==========================================
exports.telegramWebhook = onRequest({ secrets: [GEMINI_API_KEY] }, async (req, res) => {
    if (!req.body || !req.body.message || !req.body.message.text) return res.sendStatus(200);

    const { chat, text } = req.body.message;
    const chatId = chat.id;
    const command = text.trim();

    const now = new Date();
    now.setHours(now.getHours() + 8);
    const todayStr = now.toISOString().split('T')[0];
    const currentYearMonth = todayStr.substring(0, 7);

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            tools: [aiTools],
            systemInstruction: `你是一位擁有30年資歷的醫學與生活美容集團總經理特助。現在日期是 ${todayStr}。
            【你的核心職責】：
1. 絕對禁止捏造數據！
2. 回答時必須直接讀取 API 提供給你的欄位數字，嚴禁自己計算。
3. 【參數填寫警告】：CYJ、安妞、伊啵為「品牌名」。若使用者問「CYJ」，絕對不可填入 storeName 中！
4. 異常監控：不僅報出數字，當發現客單價下降或締結率異常時，必須主動標註並提出警訊。
5. 營運診斷：使用漏斗分析法，當業績未達標時，分析是來客數(Traffic)不足還是締結率(Closing Rate)太低。
6. 行動建議：不要只給統計結果，請根據數據給出下一步建議（例如：如果保養品業績佔比過低，建議針對新客增加保養品衛教）。
7. 深度洞察：分析跨月趨勢，找出淡旺季的獲利邏輯，並對比CYJ、安妞、伊啵三個品牌的體質差異。
8. 語氣限制：專業、精準、冷靜。以特助對老闆匯報的角度進行分析。`
        });

        const aiChat = model.startChat();
        const result = await aiChat.sendMessage(command);
        
        const calls = result.response.functionCalls ? result.response.functionCalls() : null;
        const functionCall = (calls && calls.length > 0) ? calls[0] : null;

        let finalReply = "";

        if (functionCall) {
            const { name, args } = functionCall;
            let apiData = [];
            let dateWarning = "";

            if (name === "getMacroStrategicAnalysis") {
                apiData = await getMacroStrategicAnalysis(args.startMonth, args.endMonth, args.storeName, args.brandName);
            } else {
                const dateRegex = /^\d{4}[-/]\d{2}[-/]\d{2}$/;
                let safeStartDate = args.startDate;
                if (!safeStartDate || !dateRegex.test(safeStartDate)) safeStartDate = `${currentYearMonth}-01`;
                else safeStartDate = safeStartDate.replace(/\//g, '-');
                
                let safeEndDate = args.endDate;
                if (!safeEndDate || !dateRegex.test(safeEndDate)) safeEndDate = todayStr;
                else safeEndDate = safeEndDate.replace(/\//g, '-');

                const dStart = new Date(safeStartDate);
                const dEnd = new Date(safeEndDate);
                const diffDays = (dEnd - dStart) / (1000 * 60 * 60 * 24);
                
                if (diffDays > 31) {
                    dStart.setDate(dEnd.getDate() - 31);
                    const mm = String(dStart.getMonth() + 1).padStart(2, '0');
                    const dd = String(dStart.getDate()).padStart(2, '0');
                    safeStartDate = `${dStart.getFullYear()}-${mm}-${dd}`;
                    dateWarning = "\n\n⚠️ *(系統保護機制：您查詢的區間過長，秘書已為您自動切換為近 30 天數據)*";
                }

                if (name === "getStorePerformance") apiData = await getStorePerformance(safeStartDate, safeEndDate, args.storeName, args.brandName);
                else if (name === "getTherapistPerformance") apiData = await getTherapistPerformance(safeStartDate, safeEndDate, args.personName, args.storeName, args.brandName);
                else if (name === "getMissingReports") apiData = await getMissingReports(safeStartDate, safeEndDate);
            }

            try {
                const secondResult = await aiChat.sendMessage([{
                    functionResponse: { name: name, response: { result: apiData } }
                }]);
                finalReply = secondResult.response.text();
                if (dateWarning) finalReply += dateWarning;
                
            } catch (innerError) {
                console.error("AI 產生報告時崩潰:", innerError);
                finalReply = "🤖 秘書已成功撈取數據，但分析範圍過大。請試著將問題縮小，例如只查詢特定單店。";
            }
        } else {
            finalReply = result.response.text();
        }

        if (!finalReply || finalReply.trim() === "") {
            finalReply = "🤖 秘書目前無法總結這個數據，請換個具體一點的方式問問看。";
        }

        finalReply = finalReply.replace(/[*#`_\[\]]/g, '');
        if (finalReply.length > 3800) {
            finalReply = finalReply.substring(0, 3800) + "\n\n... (字數已達通訊軟體上限，後續洞察報告自動截斷)。";
        }

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { 
            chat_id: chatId, 
            text: finalReply 
        });

    } catch (error) {
        console.error("Agent 嚴重錯誤:", error);
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { 
            chat_id: chatId, 
            text: `❌ 戰情秘書暫時失聯：\n${error.message}` 
        });
    }
    res.sendStatus(200);
});

// ==========================================
// ★ 4. Telegram 動態定時推播巡邏員 (★ 終極抓預算通吃版)
// ==========================================
exports.notificationPatrol = onSchedule({ schedule: "* * * * *", timeZone: "Asia/Taipei" }, async (event) => {
    const now = new Date();
    const utcHours = now.getUTCHours();
    now.setHours(utcHours + 8); 
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMin = String(now.getMinutes()).padStart(2, '0');
    const timeString = `${currentHour}:${currentMin}`; 

    try {
        const allRulesSnap = await db.collectionGroup("notification_rules").get();
        const uniqueRules = {};
        
        allRulesSnap.forEach(doc => {
            const data = doc.data();
            if (String(data.isActive) !== "true") return;
            
            // ==========================================
            // 🚨 上帝測試模式開啟中：目前已取消時間限制
            // 測試成功後，請將下面這行開頭的 `//` 刪掉以恢復正常！
            // ==========================================
            if (data.time !== timeString) return; 
            
            uniqueRules[data.source] = data; 
        });

        const rulesList = Object.values(uniqueRules);
        
        if (rulesList.length === 0) {
            console.log(`目前時間 ${timeString} 查無符合任務，機器人休眠。`);
            return;
        }

        // ---------------- 以下是「有任務」時才准執行的邏輯 ----------------
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() - 1);
        const yesterdayStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
        const currentYearMonth = yesterdayStr.substring(0, 7); 

        // 抓日報
        const dailySnap = await db.collectionGroup('daily_reports').where('date', '==', yesterdayStr).get();
        const reportsByBrand = { cyj: [], anniu: [], yibo: [] };
        const submittedStoresByBrand = { cyj: new Set(), anniu: new Set(), yibo: new Set() };
        dailySnap.forEach(doc => {
            const data = doc.data();
            let bId = data.brandId || 'cyj';
            if (bId.includes('anniu') || bId.includes('anew')) bId = 'anniu';
            else if (bId.includes('yibo')) bId = 'yibo';
            else bId = 'cyj';
            reportsByBrand[bId].push(data);
            if(data.storeName) submittedStoresByBrand[bId].add(data.storeName.trim());
        });

        // 抓管理師報告
        const therapistSnap = await db.collectionGroup('therapist_daily_reports').where('date', '==', yesterdayStr).get();
        const therapistReportsByBrand = { cyj: [], anniu: [], yibo: [] };
        therapistSnap.forEach(doc => {
            const data = doc.data();
            let bId = data.brandId || 'cyj';
            if (bId.includes('anniu') || bId.includes('anew')) bId = 'anniu';
            else if (bId.includes('yibo')) bId = 'yibo';
            else bId = 'cyj';
            therapistReportsByBrand[bId].push(data);
        });

        // 抓過去排班 (用來推算誰沒交)
        const past14Days = new Date(now);
        past14Days.setDate(past14Days.getDate() - 14);
        const past14Str = `${past14Days.getFullYear()}-${String(past14Days.getMonth() + 1).padStart(2, '0')}-${String(past14Days.getDate()).padStart(2, '0')}`;
        const rosterSnap = await db.collectionGroup('daily_reports').where('date', '>=', past14Str).get();
        const activeRosterByBrand = { cyj: new Set(), anniu: new Set(), yibo: new Set() };
        rosterSnap.forEach(doc => {
            const data = doc.data();
            let bId = data.brandId || 'cyj';
            if (bId.includes('anniu') || bId.includes('anew')) bId = 'anniu';
            else if (bId.includes('yibo')) bId = 'yibo';
            else bId = 'cyj';
            if(data.storeName) activeRosterByBrand[bId].add(data.storeName.trim());
        });

        // 抓本月彙整
        const aggSnap = await db.collectionGroup('monthly_aggregated').where('yearMonth', '==', currentYearMonth).get();
        const monthlyAggByBrand = { cyj: [], anniu: [], yibo: [] };
        const processedAggStores = { cyj: new Set(), anniu: new Set(), yibo: new Set() };
        aggSnap.forEach(doc => {
            const data = doc.data();
            const path = doc.ref.path.toLowerCase();
            let bId = 'cyj';
            if (path.includes('anniu') || path.includes('anew')) bId = 'anniu';
            else if (path.includes('yibo')) bId = 'yibo';
            const storeName = data.storeName ? data.storeName.trim() : null;
            if (storeName && !processedAggStores[bId].has(storeName)) {
                monthlyAggByBrand[bId].push(data);
                processedAggStores[bId].add(storeName);
            }
        });

        // ==========================================
        // ★ 終極修復：直接切 UID 拿年份，並且強制算入沒交日報的預算！
        // ==========================================
        const currentYearStr = targetDate.getFullYear().toString();
        const currentMonthNum = targetDate.getMonth() + 1;
        const currentMonthPadded = String(currentMonthNum).padStart(2, '0'); 
        
        // 直接撈所有的目標，不再依賴不穩定的內部 year 欄位
        const allTargetsSnapshot = await db.collectionGroup('monthly_targets').get();

        const monthlyBudgetsByBrand = { cyj: { cash: 0, accrual: 0 }, anniu: { cash: 0, accrual: 0 }, yibo: { cash: 0, accrual: 0 } };
        const processedBudgetStores = { cyj: new Set(), anniu: new Set(), yibo: new Set() };

        allTargetsSnapshot.forEach(doc => {
            const data = doc.data();
            const docId = doc.id;

            // 統一從檔案名稱 (doc.id) 拆解，絕對不會出錯 (例如: CYJ復北_2026_05 或 復北_2026_5)
            const parts = docId.split('_');
            if (parts.length < 3) return;

            const targetStoreName = parts[0];
            const targetYearStr = parts[1];
            const targetMonthStr = parts[2];

            // 1. 年份與月份對齊 (補零防護通吃)
            if (targetYearStr !== currentYearStr) return;
            if (targetMonthStr.padStart(2, '0') !== currentMonthPadded) return;

            // 2. 最強店名萃取機
            const coreStoreName = targetStoreName.replace(/CYJ|DRCYJ|安妞|伊啵|店/ig, '').trim();

            if (coreStoreName !== "") {
                const path = doc.ref.path.toLowerCase();
                const lowerId = docId.toLowerCase();
                let bId = 'cyj';
                if (path.includes('anniu') || path.includes('anew') || lowerId.includes('anniu') || lowerId.includes('anew')) bId = 'anniu';
                else if (path.includes('yibo') || lowerId.includes('yibo')) bId = 'yibo';

                let actualStoreName = null;
                for (const rosterStore of activeRosterByBrand[bId]) {
                    const rosterCore = rosterStore.replace(/CYJ|DRCYJ|安妞|伊啵|店/ig, '').trim();
                    if (coreStoreName === rosterCore) {
                        actualStoreName = rosterStore;
                        break;
                    }
                }

                // ★ 破案關鍵：就算這家店沒交日報(不在名冊裡)，預算也必須強硬加進去算！
                if (!actualStoreName) actualStoreName = coreStoreName;

                if (!processedBudgetStores[bId].has(actualStoreName)) {
                    monthlyBudgetsByBrand[bId].cash += (Number(data.cashTarget) || 0);
                    monthlyBudgetsByBrand[bId].accrual += (Number(data.accrualTarget) || 0);
                    processedBudgetStores[bId].add(actualStoreName);
                }
            }
        });

        // ================= 發送推播邏輯 =================
        for (const rule of rulesList) {
            const chatId = rule.targetGroup === 'manager' ? "-1002361008620" : "-4991191955"; 
            const url = `https://api.telegram.org/bot8787208059:AAF0AiGfUaV69YouI_b_0MuMcXpwu9EK0RA/sendMessage`; 

            const BRANDS = [
                { id: 'cyj', name: 'DRCYJ' },
                { id: 'anniu', name: '安妞' },
                { id: 'yibo', name: '伊啵' }
            ];

            for (const brand of BRANDS) {
                let finalMessage = rule.template || "";
                finalMessage = finalMessage.replace(/{date}/g, yesterdayStr);
                let shouldSend = false;

                if (rule.source === "top5_stores") {
                    const brandReports = reportsByBrand[brand.id];
                    const storeMap = {};
                    brandReports.forEach(data => {
                        const sName = String(data.storeName || '').replace(/店$/, '').trim() + '店';
                        if (!storeMap[sName]) storeMap[sName] = 0;
                        storeMap[sName] += (Number(data.cash) || 0) - (Number(data.refund) || 0);
                    });
                    const top5 = Object.entries(storeMap).map(([name, rev]) => ({ name, rev })).sort((a, b) => b.rev - a.rev).slice(0, 5).filter(s => s.rev > 0);
                    if (top5.length > 0) {
                        shouldSend = true;
                        let top5Text = "";
                        const badges = ["🥇", "🥈", "🥉", "4.", "5."];
                        top5.forEach((store, idx) => { top5Text += `${badges[idx]} ${store.name} ($${store.rev.toLocaleString()})\n`; });
                        finalMessage = finalMessage.replace(/{top5Stores}/g, top5Text);
                        finalMessage = `🏢 *【${brand.name} 專屬戰報】*\n` + finalMessage;
                    }
                }

                if (rule.source === "unreported") {
                    const expectedStores = Array.from(activeRosterByBrand[brand.id]);
                    const submittedStores = submittedStoresByBrand[brand.id];
                    const missing = expectedStores.filter(store => !submittedStores.has(store));
                    if (expectedStores.length > 0) { 
                        shouldSend = true;
                        if (missing.length > 0) {
                            let missingText = missing.map(s => `• ${s}`).join('\n');
                            finalMessage = finalMessage.replace(/{missingStores}/g, missingText);
                            finalMessage = finalMessage.replace(/{missingCount}/g, missing.length);
                            finalMessage = `🚨 *【${brand.name} 異常通報】*\n` + finalMessage;
                        } else {
                            finalMessage = finalMessage.replace(/{missingStores}/g, "✅ 表現優異，全區皆已完成回報！");
                            finalMessage = finalMessage.replace(/{missingCount}/g, "0");
                            finalMessage = `✅ *【${brand.name} 回報總結】*\n` + finalMessage;
                        }
                    }
                }

                if (rule.source === "top5_therapists") {
                    const brandTReports = therapistReportsByBrand[brand.id];
                    const top5T = brandTReports.sort((a, b) => (Number(b.totalRevenue) || 0) - (Number(a.totalRevenue) || 0)).slice(0, 5).filter(t => (Number(t.totalRevenue) || 0) > 0);
                    if (top5T.length > 0) {
                        shouldSend = true;
                        let top5Text = "";
                        const badges = ["🥇", "🥈", "🥉", "4.", "5."];
                        top5T.forEach((t, idx) => {
                            const storeName = String(t.storeName || '').replace(/店$/, '').trim() + '店';
                            const rev = Number(t.totalRevenue) || 0;
                            top5Text += `${badges[idx]} ${t.therapistName} (${storeName}) - $${rev.toLocaleString()}\n`;
                        });
                        finalMessage = finalMessage.replace(/{top5Therapists}/g, top5Text);
                        finalMessage = `🌟 *【${brand.name} 個人榮耀】*\n` + finalMessage;
                    }
                }

                if (rule.source === "progress") {
                    const aggData = monthlyAggByBrand[brand.id];
                    let cashTotal = 0, accrualTotal = 0;
                    aggData.forEach(data => {
                        cashTotal += (Number(data.cash) || 0) - (Number(data.refund) || 0);
                        if (brand.id === 'anniu') accrualTotal += (Number(data.operationalAccrual) || 0);
                        else accrualTotal += (Number(data.accrual) || 0);
                    });
                    
                    const brandBudget = monthlyBudgetsByBrand[brand.id];
                    const cashRate = brandBudget.cash > 0 ? ((cashTotal / brandBudget.cash) * 100).toFixed(1) : "0.0";
                    const accrualRate = brandBudget.accrual > 0 ? ((accrualTotal / brandBudget.accrual) * 100).toFixed(1) : "0.0";

                    if (cashTotal > 0 || accrualTotal > 0) {
                        shouldSend = true;
                        finalMessage = finalMessage.replace(/{cashTotal}/g, cashTotal.toLocaleString());
                        finalMessage = finalMessage.replace(/{accrualTotal}/g, accrualTotal.toLocaleString());
                        finalMessage = finalMessage.replace(/{cashRate}/g, cashRate);
                        finalMessage = finalMessage.replace(/{accrualRate}/g, accrualRate);
                        finalMessage = `📊 *【${brand.name} 本月累積進度】*\n` + finalMessage;
                    }
                }

                if (shouldSend) {
                    const axios = require("axios"); 
                    try {
                        await axios.post(url, { chat_id: chatId, text: finalMessage, parse_mode: 'Markdown' });
                    } catch (err) {
                        console.error(`❌ Telegram 發送失敗：${err.message}`);
                    }
                }
            }
        }
    } catch (error) {
        console.error("❌ 巡邏員執行錯誤：", error);
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
// 目的：處理 summary_recalc_flags 裡已到時間的 dirty 月份。
// 手動測試入口：repairDirtySummaryNow?brandId=cyj&yearMonth=2026-05
// 自動排程：每 5 分鐘巡檢一次。
// ==========================================

const SUMMARY_REPAIR_BRANDS = ["cyj", "anniu", "yibo"];

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
  const snap = await getBrandRootRef(brandId).collection("settings").doc("org_structure").get();
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

async function loadAutoMonthlyTargetMap(brandId, yearMonth) {
  const snap = await getSummaryCollection(brandId, "monthly_targets").get();
  const targetMap = {};
  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const targetMonth = extractAutoTargetYearMonth(docSnap.id, data);
    if (targetMonth && targetMonth !== yearMonth) return;
    const storeCore = extractAutoTargetStore(docSnap.id, data, yearMonth);
    if (!storeCore) return;
    targetMap[storeCore] = {
      id: docSnap.id,
      cashTarget: Number(data.cashTarget || data.cash || data.budget || data.target || 0),
      accrualTarget: Number(data.accrualTarget || data.accrual || data.accrualBudget || 0),
      challengeCashTarget: Number(data.challengeCashTarget || data.challengeCash || data.challengeTarget || 0),
      challengeAccrualTarget: Number(data.challengeAccrualTarget || data.challengeAccrual || 0),
    };
  });
  return targetMap;
}

async function buildAutoDashboardSummaryPayloads(brandId, yearMonth) {
  const brandLabel = await getSummaryBrandLabel(brandId);
  const range = getSummaryMonthRange(yearMonth);
  if (!range) throw new Error("月份格式錯誤");

  const orgProfile = await getAutoOrgStructureProfile(brandId);
  const targets = await loadAutoMonthlyTargetMap(brandId, yearMonth);
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
    storeTop3: {
      today: storeRevenueByDate(todayStr),
      yesterday: storeRevenueByDate(yesterdayStr),
      monthly: storeRanking.slice(0, 3).map((s) => ({ name: s.displayName, store: s.store, revenue: s.cash, manager: s.manager })),
    },
    sourceCounts: { dailyReports: dailyRows.length, targetStores: Object.keys(targets).length, stores: Object.keys(storeMap).length },
    lastUpdatedAt: nowTimestamp,
    lastUpdatedAtText: nowIso,
    source: "auto_summary_repair",
    version: "dashboard-summary-v1",
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
  const snap = await getSummaryCollection(brandId, "recalc_queue")
    .where("status", "==", "pending")
    .limit(500)
    .get();

  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((row) => {
      const raw = row.affectedYearMonth || row.yearMonth || String(row.date || row.sourceDate || "").slice(0, 7);
      return raw === yearMonth;
    });
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

    // 來源 B：recalc_queue pending。
    // 防止某些歷史修改只寫入 recalc_queue，卻沒有建立 summary_recalc_flags，造成排程永遠掃不到。
    try {
      const queueSnap = await getSummaryCollection(brandId, "recalc_queue")
        .where("status", "==", "pending")
        .limit(500)
        .get();

      const queueGroups = {};
      queueSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const yearMonth = getQueueMonth(data);
        if (!yearMonth) return;
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
      console.warn(`⚠️ Summary 自動修復：讀取 recalc_queue 失敗 ${brandId}`, error.message);
    }
  }

  jobs.push(...Array.from(jobMap.values()).sort((a, b) => `${a.brandId}_${a.yearMonth}`.localeCompare(`${b.brandId}_${b.yearMonth}`)));
  return jobs;
}
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