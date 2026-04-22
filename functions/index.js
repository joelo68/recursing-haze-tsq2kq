const { onSchedule } = require("firebase-functions/v2/scheduler");
const axios = require("axios");
const functions = require("firebase-functions/v1"); 
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

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
  };

  const aggRef = db.collection(basePath).doc(key);
  const updates = { id: key, yearMonth: yearMonth, year: year, storeName: storeName };
  let hasChanges = false;

  for (const [field, val] of Object.entries(diff)) {
    if (val !== 0) {
      updates[field] = admin.firestore.FieldValue.increment(val);
      hasChanges = true;
    }
  }

  if (!hasChanges) return null;
  return aggRef.set(updates, { merge: true });
}

exports.aggregateLegacyReports = functions.firestore
  .document("artifacts/{appId}/public/data/daily_reports/{reportId}")
  .onWrite(async (change, context) => updateMonthlyAggregation(change, `artifacts/${context.params.appId}/public/data/monthly_aggregated`));

exports.aggregateBrandReports = functions.firestore
  .document("brands/{brandId}/daily_reports/{reportId}")
  .onWrite(async (change, context) => updateMonthlyAggregation(change, `brands/${context.params.brandId}/monthly_aggregated`));

// ==========================================
// ★ Telegram 動態推播巡邏員 (完全體 - 業績精準校正版)
// ==========================================
const TELEGRAM_BOT_TOKEN = '8787208059:AAF0AiGfUaV69YouI_b_0MuMcXpwu9EK0RA';
const TARGET_CHAT_ID_MAIN = '-4991191955'; 
const TARGET_CHAT_ID_MANAGER = '-4991191955'; 

const BRANDS = [
    { id: 'cyj', name: 'CYJ' },
    { id: 'anniu', name: '安妞' },
    { id: 'yibo', name: '伊啵' }
];

exports.notificationPatrol = onSchedule({
    schedule: "* * * * *", 
    timeZone: "Asia/Taipei"
}, async (event) => {
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
        const rulesSnapshot = await db.collection("notification_rules")
            .where("isActive", "==", true)
            .where("time", "==", timeString)
            .get();

        if (rulesSnapshot.empty) return;

        // 1. 抓取昨天的【店家】日報
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

        // 2. 抓取昨天的【管理師】日報
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

        // 3. 智慧名單：過去 14 天有營業的活躍店家 (作為校正基準)
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

        // 4. 預先抓取本月總帳卡 (加入防重複鎖)
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
            // 確保同一個店家在同一個月只被計算一次 (避開新舊路徑雙胞胎)
            if (storeName && !processedAggStores[bId].has(storeName)) {
                monthlyAggByBrand[bId].push(data);
                processedAggStores[bId].add(storeName);
            }
        });

        // 5. 預先抓取本月目標 (加入防重複鎖 + 活躍店家過濾)
        const currentYearStr = targetDate.getFullYear().toString();
        const currentMonthStr = (targetDate.getMonth() + 1).toString();
        const budgetSuffix = `_${currentYearStr}_${currentMonthStr}`;

        const targetsSnap = await db.collectionGroup('monthly_targets').get();
        const monthlyBudgetsByBrand = { cyj: { cash: 0, accrual: 0 }, anniu: { cash: 0, accrual: 0 }, yibo: { cash: 0, accrual: 0 } };
        const processedBudgetStores = { cyj: new Set(), anniu: new Set(), yibo: new Set() };

        targetsSnap.forEach(doc => {
            if (doc.id.endsWith(budgetSuffix)) {
                const docStoreName = doc.id.replace(budgetSuffix, ''); // 抽出店名
                const data = doc.data();
                const path = doc.ref.path.toLowerCase();
                const lowerId = doc.id.toLowerCase();
                
                let bId = 'cyj';
                if (path.includes('anniu') || path.includes('anew') || lowerId.includes('anniu') || lowerId.includes('anew')) bId = 'anniu';
                else if (path.includes('yibo') || lowerId.includes('yibo')) bId = 'yibo';

                // ★ 關鍵：只有在「活躍名單內」且「還沒被算過」的目標，才能加進分母
                if (activeRosterByBrand[bId].has(docStoreName) && !processedBudgetStores[bId].has(docStoreName)) {
                    monthlyBudgetsByBrand[bId].cash += (Number(data.cashTarget) || 0);
                    monthlyBudgetsByBrand[bId].accrual += (Number(data.accrualTarget) || 0);
                    processedBudgetStores[bId].add(docStoreName);
                }
            }
        });

        // 6. 處理每一個推播任務
        for (const ruleDoc of rulesSnapshot.docs) {
            const rule = ruleDoc.data();
            const chatId = rule.targetGroup === 'manager' ? TARGET_CHAT_ID_MANAGER : TARGET_CHAT_ID_MAIN;
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

            for (const brand of BRANDS) {
                let finalMessage = rule.template || "";
                finalMessage = finalMessage.replace(/{date}/g, yesterdayStr);
                let shouldSend = false;

                // A：TOP 5 店家
                if (rule.source === "top5_stores") {
                    const brandReports = reportsByBrand[brand.id];
                    const storeMap = {};
                    brandReports.forEach(data => {
                        const sName = String(data.storeName || '').replace(/店$/, '').trim() + '店';
                        if (!storeMap[sName]) storeMap[sName] = 0;
                        storeMap[sName] += (Number(data.cash) || 0) - (Number(data.refund) || 0);
                    });

                    const top5 = Object.entries(storeMap)
                        .map(([name, rev]) => ({ name, rev }))
                        .sort((a, b) => b.rev - a.rev)
                        .slice(0, 5)
                        .filter(s => s.rev > 0);

                    if (top5.length > 0) {
                        shouldSend = true;
                        let top5Text = "";
                        const badges = ["🥇", "🥈", "🥉", "4.", "5."];
                        top5.forEach((store, idx) => {
                            top5Text += `${badges[idx]} ${store.name} ($${store.rev.toLocaleString()})\n`;
                        });
                        finalMessage = finalMessage.replace(/{top5Stores}/g, top5Text);
                        finalMessage = `🏢 *【${brand.name} 專屬戰報】*\n` + finalMessage;
                    }
                }

                // B：未回報檢核
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

                // C：TOP 5 管理師
                if (rule.source === "top5_therapists") {
                    const brandTReports = therapistReportsByBrand[brand.id];
                    const top5T = brandTReports
                        .sort((a, b) => (Number(b.totalRevenue) || 0) - (Number(a.totalRevenue) || 0))
                        .slice(0, 5)
                        .filter(t => (Number(t.totalRevenue) || 0) > 0);

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

                // D：本月現金、權責進度 (★ 已經完全校正對齊前端系統)
                if (rule.source === "progress") {
                    const aggData = monthlyAggByBrand[brand.id];
                    let cashTotal = 0;
                    let accrualTotal = 0;

                    aggData.forEach(data => {
                        // ★ 修復 1：現金扣除退費 (精準對齊前端的 4386 萬)
                        cashTotal += (Number(data.cash) || 0) - (Number(data.refund) || 0);
                        
                        // 安妞專屬權責邏輯
                        if (brand.id === 'anniu') {
                            accrualTotal += (Number(data.operationalAccrual) || 0);
                        } else {
                            accrualTotal += (Number(data.accrual) || 0);
                        }
                    });

                    // ★ 修復 2：採用防重複後的正確分母 (精準對齊前端的 88%)
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
                    await axios.post(url, {
                        chat_id: chatId,
                        text: finalMessage,
                        parse_mode: 'Markdown'
                    });
                }
            }
        }
    } catch (error) {
        console.error("❌ 巡邏員執行錯誤：", error);
    }
});