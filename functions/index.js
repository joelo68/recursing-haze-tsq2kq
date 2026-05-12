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
// ★ 1. 核心資料結算邏輯 (店鋪日報) - 已擴充精細指標
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
exports.aggregateLegacyReports = functions.firestore.document("artifacts/{appId}/public/data/daily_reports/{reportId}").onWrite(async (change, context) => updateMonthlyAggregation(change, `artifacts/${context.params.appId}/public/data/monthly_aggregated`));
exports.aggregateBrandReports = functions.firestore.document("brands/{brandId}/daily_reports/{reportId}").onWrite(async (change, context) => updateMonthlyAggregation(change, `brands/${context.params.brandId}/monthly_aggregated`));

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
exports.aggregateLegacyTherapistReports = functions.firestore.document("artifacts/{appId}/public/data/therapist_daily_reports/{reportId}").onWrite(async (change, context) => updateTherapistMonthlyAggregation(change, `artifacts/${context.params.appId}/public/data/therapist_monthly_aggregated`));
exports.aggregateBrandTherapistReports = functions.firestore.document("brands/{brandId}/therapist_daily_reports/{reportId}").onWrite(async (change, context) => updateTherapistMonthlyAggregation(change, `brands/${context.params.brandId}/therapist_monthly_aggregated`));

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
// ★ 2.5 AI 戰略雙引擎：2. 宏觀大數據分析引擎 (NEW!)
// ==========================================
async function getMacroStrategicAnalysis(startMonth, endMonth, storeName = null, brandName = null) {
    if (storeName && !brandName) {
        const sUpper = storeName.toUpperCase();
        if (sUpper === 'CYJ' || sUpper.includes('安妞') || sUpper.includes('伊啵')) {
            brandName = storeName; storeName = null;
        }
    }

    // 1. 直接讀取輕量級的「月結算表」
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

        // 彙整跨月趨勢
        if(!monthlyMap[ym]) monthlyMap[ym] = { cash: 0, accrual: 0, skincare: 0, traffic: 0, newRev: 0, newCount: 0 };
        monthlyMap[ym].cash += cash; monthlyMap[ym].accrual += accrual; monthlyMap[ym].skincare += skincare;
        monthlyMap[ym].traffic += traffic; monthlyMap[ym].newRev += newRev; monthlyMap[ym].newCount += newCount;

        // 彙整單店跨期總和 (用來體檢)
        if(!storeMap[sName]) storeMap[sName] = { brand: bId, cash: 0, accrual: 0, skincare: 0, traffic: 0, newRev: 0, newCount: 0 };
        storeMap[sName].cash += cash; storeMap[sName].accrual += accrual; storeMap[sName].skincare += skincare;
        storeMap[sName].traffic += traffic; storeMap[sName].newRev += newRev; storeMap[sName].newCount += newCount;
    });

    // 2. 讀取「預算目標表」(抓漏與達標追蹤)
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

    // 3. 交叉比對產出「門市體檢報告」
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
            description: "【單月內日常查詢】查詢店鋪/品牌的營運狀況，包含現金、權責、保養品、客單價、締結率與【月底推估業績(projection)】。",
            parameters: { 
                type: "OBJECT", 
                properties: { 
                    startDate: { type: "STRING", description: "選填，必須為 YYYY-MM-DD" }, 
                    endDate: { type: "STRING", description: "選填，必須為 YYYY-MM-DD" }, 
                    storeName: { type: "STRING", description: "單一店鋪名稱（請勿填入品牌名），例如：復北, 左營" }, 
                    brandName: { type: "STRING", description: "品牌名稱，例如：CYJ, 安妞, 伊啵" } 
                } 
            }
        },
        {
            name: "getTherapistPerformance",
            description: "【單月內日常查詢】查詢人員/諮詢師的個人業績、新舊客、客單價、締結率與【月底推估業績(projection)】。",
            parameters: { 
                type: "OBJECT", 
                properties: { 
                    startDate: { type: "STRING", description: "選填，必須為 YYYY-MM-DD" }, 
                    endDate: { type: "STRING", description: "選填，必須為 YYYY-MM-DD" }, 
                    personName: { type: "STRING" }, 
                    storeName: { type: "STRING", description: "單一店鋪名稱（請勿填入品牌名），例如：復北, 左營" }, 
                    brandName: { type: "STRING", description: "品牌名稱，例如：CYJ, 安妞, 伊啵" } 
                } 
            }
        },
        {
            name: "getMissingReports",
            description: "查詢未交日報名單。",
            parameters: { type: "OBJECT", properties: { startDate: { type: "STRING", description: "必須為 YYYY-MM-DD" }, endDate: { type: "STRING", description: "必須為 YYYY-MM-DD" } } }
        },
        // ★ 新增：大數據戰略引擎工具宣告
        {
            name: "getMacroStrategicAnalysis",
            description: "【跨月/跨季/長區間大數據專用】查詢多個月份的宏觀趨勢、各店預算達標率預警、以及店鋪體質交叉比對(如客單價、保養品佔比)。",
            parameters: { 
                type: "OBJECT", 
                properties: { 
                    startMonth: { type: "STRING", description: "開始月份，強制格式為 YYYY-MM，例如 2026-01" }, 
                    endMonth: { type: "STRING", description: "結束月份，強制格式為 YYYY-MM，例如 2026-04" }, 
                    storeName: { type: "STRING", description: "選填，單一店鋪名稱" }, 
                    brandName: { type: "STRING", description: "選填，品牌名稱，例如：CYJ, 安妞, 伊啵" } 
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
            systemInstruction: `你是一位醫美集團的高階戰情分析秘書。現在日期是 ${todayStr}。
【最高防偽與精準原則】
1. 絕對禁止捏造數據！
2. 回答時必須直接讀取 API 提供給你的欄位數字，嚴禁自己計算。
3. 【公司專用術語】：cash ➔ 現金業績, accrual ➔ 實作業績, skincare ➔ 保養品業績, traffic ➔ 客流/來客數。
4. 【參數填寫警告】：CYJ、安妞、伊啵為「品牌名」。若使用者問「CYJ」，絕對不可填入 storeName 中！
5. 【動態輸出策略】：
   ▶ 當使用者查詢「單月內整體概況、總結」時，請依照以下格式輸出：
      🏢 [品牌/店鋪名稱] 營運概況
      💰 月底推估業績: [數值]
      💰 現金業績: [數值]
      💰 實作業績: [數值]
      💲 新客業績: [數值]
      🤝 新客締結率: [數值]%
      🧍 客單價 (新客/舊客): [數值] / [數值]
      🧴 保養品業績: [數值]
   ▶ 當使用者查詢「單月內的週間趨勢、星期幾來客最多」時，讀取 'overall_summary.daily_trends' 給出結論，不需套用制式格式。
   ▶ 當使用者查詢「跨月趨勢、對比不同月份/季度、各店達標率抓漏、體質對比」時，呼叫 getMacroStrategicAnalysis 工具，並以專家的口吻給出深度洞察與管理建議，不需套用制式格式。
6. 輸出環境為純文字，絕對禁止使用 Markdown 符號（如 **、#、_、[]）。所有金額請加上千分位逗號。`
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

            // ★ 根據不同引擎，進行路由分發與防護
            if (name === "getMacroStrategicAnalysis") {
                // 大數據引擎：使用結算表，無須 31 天防爆盾限制
                apiData = await getMacroStrategicAnalysis(args.startMonth, args.endMonth, args.storeName, args.brandName);
            } else {
                // 日常引擎：啟動 31 天防爆盾
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
                    dateWarning = "\n\n⚠️ *(系統保護機制：您查詢的區間過長，秘書已為您自動切換為近 30 天數據。若需查詢跨月對比，請改問「比較第一季」或「分析1到4月體質」等明確大範圍指令)*";
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
// ★ 4. Telegram 動態定時推播巡邏員 (一字未改，安全保留)
// ==========================================
exports.notificationPatrol = onSchedule({ schedule: "* * * * *", timeZone: "Asia/Taipei" }, async (event) => {
    const now = new Date();
    const utcHours = now.getUTCHours();
    now.setHours(utcHours + 8); 
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMin = String(now.getMinutes()).padStart(2, '0');
    const timeString = `${currentHour}:${currentMin}`; 
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() - 1);
    const yesterdayStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
    const currentYearMonth = yesterdayStr.substring(0, 7); 

    try {
        const rulesSnapshot = await db.collection("notification_rules").where("isActive", "==", true).where("time", "==", timeString).get();
        if (rulesSnapshot.empty) return;

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

        const currentYearStr = targetDate.getFullYear().toString();
        const currentMonthStr = (targetDate.getMonth() + 1).toString();
        const budgetSuffix = `_${currentYearStr}_${currentMonthStr}`;
        const targetsSnap = await db.collectionGroup('monthly_targets').get();
        const monthlyBudgetsByBrand = { cyj: { cash: 0, accrual: 0 }, anniu: { cash: 0, accrual: 0 }, yibo: { cash: 0, accrual: 0 } };
        const processedBudgetStores = { cyj: new Set(), anniu: new Set(), yibo: new Set() };

        targetsSnap.forEach(doc => {
            if (doc.id.endsWith(budgetSuffix)) {
                const docStoreName = doc.id.replace(budgetSuffix, ''); 
                const data = doc.data();
                const path = doc.ref.path.toLowerCase();
                const lowerId = doc.id.toLowerCase();
                let bId = 'cyj';
                if (path.includes('anniu') || path.includes('anew') || lowerId.includes('anniu') || lowerId.includes('anew')) bId = 'anniu';
                else if (path.includes('yibo') || lowerId.includes('yibo')) bId = 'yibo';

                if (activeRosterByBrand[bId].has(docStoreName) && !processedBudgetStores[bId].has(docStoreName)) {
                    monthlyBudgetsByBrand[bId].cash += (Number(data.cashTarget) || 0);
                    monthlyBudgetsByBrand[bId].accrual += (Number(data.accrualTarget) || 0);
                    processedBudgetStores[bId].add(docStoreName);
                }
            }
        });

        for (const ruleDoc of rulesSnapshot.docs) {
            const rule = ruleDoc.data();
            const chatId = rule.targetGroup === 'manager' ? TARGET_CHAT_ID_MANAGER : TARGET_CHAT_ID_MAIN;
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

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
                    await axios.post(url, { chat_id: chatId, text: finalMessage, parse_mode: 'Markdown' });
                }
            }
        }
    } catch (error) {
        console.error("❌ 巡邏員執行錯誤：", error);
    }
}); // ⬅️ ★★★ 加上這行，幫巡邏員關門！★★★
// ==========================================
// ★ 5. 自動人數計數器：監控人員增減並更新公佈欄
// ==========================================

// 5.1 監控管理師名單 (Therapists)
async function handleUserCountChange(change) {
  const isDocCreated = !change.before.exists && change.after.exists;
  const isDocDeleted = change.before.exists && !change.after.exists;

  if (!isDocCreated && !isDocDeleted) return null; // 只是改資料，不改人數

  const statsRef = db.collection("public_info").doc("stats");
  const increment = isDocCreated ? 1 : -1;

  return statsRef.set({
    totalUsers: admin.firestore.FieldValue.increment(increment)
  }, { merge: true });
}

// 針對舊系統路徑的監控
exports.onLegacyTherapistChange = functions.firestore
  .document("artifacts/{appId}/public/data/therapists/{id}")
  .onWrite(async (change) => handleUserCountChange(change));

// 針對新品牌系統路徑的監控
exports.onBrandTherapistChange = functions.firestore
  .document("brands/{brandId}/therapists/{id}")
  .onWrite(async (change) => handleUserCountChange(change));

// 5.2 監控店長/主管名單 (Managers)
exports.onManagerChange = functions.firestore
  .document("artifacts/{appId}/public/data/managers/{id}")
  .onWrite(async (change) => handleUserCountChange(change));
// ==========================================
// ★ 6. 終極盤點機：一次性精準計算全系統總人數
// ==========================================
exports.calibrateUserCount = onRequest(async (req, res) => {
    try {
        let totalCount = 0;

        // 1. 盤點全集團所有的管理師 (透過 collectionGroup 一次撈取所有品牌)
        const therapistsSnap = await db.collectionGroup('therapists').get();
        therapistsSnap.forEach(doc => {
            // 系統預設計算所有建檔人員。
            // 若您只想計算「在職」人員，請將下一行改為類似：if(doc.data().status === 'active') totalCount++;
            totalCount++; 
        });

        // 2. 盤點全集團所有的店長/主管
        const managersSnap = await db.collectionGroup('managers').get();
        managersSnap.forEach(doc => {
            totalCount++;
        });

        // 3. 將最精準的數字強制覆寫到公佈欄
        await db.collection("public_info").doc("stats").set({
            totalUsers: totalCount
        }, { merge: true });

        res.status(200).send(`
            <h2 style="color: #4CAF50;">🎉 報告老闆：全區盤點完成！</h2>
            <p style="font-size: 18px;">系統中目前共有 <b>${totalCount}</b> 個授權帳號。</p>
            <p>登入畫面的數字已經為您 100% 精準校正完畢！您可以直接關閉這個網頁了。</p>
        `);
    } catch (error) {
        console.error("盤點失敗:", error);
        res.status(500).send("❌ 盤點發生錯誤: " + error.message);
    }
});