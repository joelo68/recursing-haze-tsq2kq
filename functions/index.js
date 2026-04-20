const { onSchedule } = require("firebase-functions/v2/scheduler");
const axios = require("axios");
const functions = require("firebase-functions/v1"); 
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/**
 * 共用的核心邏輯：計算差額並更新總帳卡
 */
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

// 監聽器 1 & 2
exports.aggregateLegacyReports = functions.firestore
  .document("artifacts/{appId}/public/data/daily_reports/{reportId}")
  .onWrite(async (change, context) => updateMonthlyAggregation(change, `artifacts/${context.params.appId}/public/data/monthly_aggregated`));

exports.aggregateBrandReports = functions.firestore
  .document("brands/{brandId}/daily_reports/{reportId}")
  .onWrite(async (change, context) => updateMonthlyAggregation(change, `brands/${context.params.brandId}/monthly_aggregated`));

// ==========================================
// ★ Telegram 動態推播巡邏員 (支援多品牌獨立發送)
// ==========================================
const TELEGRAM_BOT_TOKEN = '8787208059:AAF0AiGfUaV69YouI_b_0MuMcXpwu9EK0RA';
const TARGET_CHAT_ID_MAIN = '-4991191955'; 
const TARGET_CHAT_ID_MANAGER = '-4991191955'; 

// 定義系統內的三大品牌
const BRANDS = [
    { id: 'cyj', name: 'CYJ' },
    { id: 'anniu', name: '安妞' },
    { id: 'yibo', name: '伊啵' }
];

exports.notificationPatrol = onSchedule({
    schedule: "* * * * *", // 每 1 分鐘執行一次
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

    try {
        const rulesSnapshot = await db.collection("notification_rules")
            .where("isActive", "==", true)
            .where("time", "==", timeString)
            .get();

        if (rulesSnapshot.empty) return;
        console.log(`[${timeString}] 偵測到排程，開始進行多品牌結算...`);

        // 1. 抓取昨天的所有日報，並依照品牌自動分組
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

        // 2. 智慧名單：抓取過去 14 天的資料，自動建構「各品牌營業中門市名單」
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

        // 3. 處理每一個推播任務
        for (const ruleDoc of rulesSnapshot.docs) {
            const rule = ruleDoc.data();
            const chatId = rule.targetGroup === 'manager' ? TARGET_CHAT_ID_MANAGER : TARGET_CHAT_ID_MAIN;
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

            // ★ 對三個品牌分別執行，各自發送一則推播
            for (const brand of BRANDS) {
                let finalMessage = rule.template || "";
                finalMessage = finalMessage.replace(/{date}/g, yesterdayStr);
                let shouldSend = false;

                // ----------------------------------------
                // 邏輯 A：TOP 5 店家
                // ----------------------------------------
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
                        .slice(0, 5);

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

                // ----------------------------------------
                // 邏輯 B：未回報檢核
                // ----------------------------------------
                if (rule.source === "unreported") {
                    const expectedStores = Array.from(activeRosterByBrand[brand.id]);
                    const submittedStores = submittedStoresByBrand[brand.id];
                    const missing = expectedStores.filter(store => !submittedStores.has(store));
                    
                    if (expectedStores.length > 0) { // 只有當該品牌有店面營業時才發送
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

                // 如果該品牌有產生資料，就單獨發送給群組
                if (shouldSend) {
                    await axios.post(url, {
                        chat_id: chatId,
                        text: finalMessage,
                        parse_mode: 'Markdown'
                    });
                }
            } // end of BRANDS loop
        }
    } catch (error) {
        console.error("❌ 巡邏員執行錯誤：", error);
    }
});