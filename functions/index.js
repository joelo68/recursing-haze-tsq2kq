const { onSchedule } = require("firebase-functions/v2/scheduler");
const axios = require("axios");
const functions = require("firebase-functions/v1"); // ★ 關鍵修改：明確指定使用 v1 穩定版 API
const admin = require("firebase-admin");

// 初始化 Firebase 後端管理員權限
admin.initializeApp();
const db = admin.firestore();

/**
 * 共用的核心邏輯：計算差額並更新總帳卡
 */
async function updateMonthlyAggregation(change, basePath) {
  // 取得修改前與修改後的資料
  const beforeData = change.before.data() || {};
  const afterData = change.after.data() || {};

  // 如果這筆日報沒有店名或日期，就不處理
  const storeName = afterData.storeName || beforeData.storeName;
  const date = afterData.date || beforeData.date;
  if (!storeName || !date) return null;

  // 算出這是哪一個月、哪一年的資料
  const yearMonth = date.substring(0, 7); 
  const year = date.substring(0, 4);      
  const key = `${yearMonth}_${storeName}`;

  // 🌟 神奇的「差額運算法」：(新數字 - 舊數字)
  const diff = {
    cash: (Number(afterData.cash) || 0) - (Number(beforeData.cash) || 0),
    refund: (Number(afterData.refund) || 0) - (Number(beforeData.refund) || 0),
    accrual: (Number(afterData.accrual) || 0) - (Number(beforeData.accrual) || 0),
    operationalAccrual: (Number(afterData.operationalAccrual) || 0) - (Number(beforeData.operationalAccrual) || 0),
    traffic: (Number(afterData.traffic) || 0) - (Number(beforeData.traffic) || 0),
  };

  // 定義要寫入的目標總帳卡路徑
  const aggRef = db.collection(basePath).doc(key);

  const updates = {
    id: key,
    yearMonth: yearMonth,
    year: year,
    storeName: storeName,
  };

  let hasChanges = false;

  // 將有變動的數字，轉換成 Firebase 自動加減指令 (Increment)
  for (const [field, val] of Object.entries(diff)) {
    if (val !== 0) {
      updates[field] = admin.firestore.FieldValue.increment(val);
      hasChanges = true;
    }
  }

  // 如果數字完全沒變，就不浪費寫入次數
  if (!hasChanges) return null;

  return aggRef.set(updates, { merge: true });
}

// ========================================================
// 監聽器 1：負責監聽 CYJ 
// ========================================================
exports.aggregateLegacyReports = functions.firestore
  .document("artifacts/{appId}/public/data/daily_reports/{reportId}")
  .onWrite(async (change, context) => {
    const appId = context.params.appId;
    const basePath = `artifacts/${appId}/public/data/monthly_aggregated`;
    return updateMonthlyAggregation(change, basePath);
  });

// ========================================================
// 監聽器 2：負責監聽 安妞/伊啵 
// ========================================================
exports.aggregateBrandReports = functions.firestore
  .document("brands/{brandId}/daily_reports/{reportId}")
  .onWrite(async (change, context) => {
    const brandId = context.params.brandId;
    const basePath = `brands/${brandId}/monthly_aggregated`;
    return updateMonthlyAggregation(change, basePath);
  });

// ==========================================
// ★ Telegram 動態推播巡邏員 (每 1 分鐘巡邏一次)
// ==========================================
const TELEGRAM_BOT_TOKEN = '8787208059:AAF0AiGfUaV69YouI_b_0MuMcXpwu9EK0RA';
const TARGET_CHAT_ID_MAIN = '-4991191955'; // 預設營運大群組
const TARGET_CHAT_ID_MANAGER = '-4991191955'; // 若未來有高階群組可填入獨立ID

exports.notificationPatrol = onSchedule({
    schedule: "* * * * *", // 每 1 分鐘執行一次
    timeZone: "Asia/Taipei"
}, async (event) => {
    // 1. 取得現在的台灣時間 (HH:mm) 與 昨天的日期 (YYYY-MM-DD)
    const now = new Date();
    const utcHours = now.getUTCHours();
    now.setHours(utcHours + 8); 
    
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMin = String(now.getMinutes()).padStart(2, '0');
    const timeString = `${currentHour}:${currentMin}`; // 產出如 "09:00"

    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() - 1);
    const yYear = targetDate.getFullYear();
    const yMonth = String(targetDate.getMonth() + 1).padStart(2, '0');
    const yDay = String(targetDate.getDate()).padStart(2, '0');
    const yesterdayStr = `${yYear}-${yMonth}-${yDay}`;

    try {
        // 2. 去資料庫找：狀態是開啟的，而且時間剛好等於現在時間的任務
        const rulesSnapshot = await db.collection("notification_rules")
            .where("isActive", "==", true)
            .where("time", "==", timeString)
            .get();

        if (rulesSnapshot.empty) {
            return; // 這個時間點沒有排程，巡邏員繼續睡覺
        }

        console.log(`[${timeString}] 偵測到 ${rulesSnapshot.size} 個推播任務，開始執行結算...`);

        // 3. 針對每個符合條件的任務，開始抓資料並替換變數
        for (const ruleDoc of rulesSnapshot.docs) {
            const rule = ruleDoc.data();
            let finalMessage = rule.template || "";
            
            // 全域變數替換
            finalMessage = finalMessage.replace(/{date}/g, yesterdayStr);

            // ==========================================
            // ★ 資料積木 A：昨日業績 TOP 5 (店家)
            // ==========================================
            if (rule.source === "top5_stores") {
                const snap = await db.collectionGroup('daily_reports').where('date', '==', yesterdayStr).get();
                const storeMap = {};
                snap.forEach(doc => {
                    const data = doc.data();
                    const sName = String(data.storeName || '').replace(/店$/, '').trim() + '店';
                    if (!storeMap[sName]) storeMap[sName] = 0;
                    storeMap[sName] += (Number(data.cash) || 0) - (Number(data.refund) || 0);
                });

                const top5 = Object.entries(storeMap)
                    .map(([name, rev]) => ({ name, rev }))
                    .sort((a, b) => b.rev - a.rev)
                    .slice(0, 5);

                let top5Text = "";
                const badges = ["🥇", "🥈", "🥉", "4.", "5."];
                top5.forEach((store, idx) => {
                    top5Text += `${badges[idx]} ${store.name} ($${store.rev.toLocaleString()})\n`;
                });
                
                finalMessage = finalMessage.replace(/{top5Stores}/g, top5Text || "昨日無業績資料");
            }

            // ==========================================
            // ★ 資料積木 B：未回報店家清單
            // ==========================================
            if (rule.source === "unreported") {
                // 這裡暫時列出所有直營店名單做比對
                const allStores = ["安平店", "永康店", "崇學店", "大順店", "前鎮店", "左營店", "古亭店", "蘆洲店", "北車店", "三重店", "桃園店", "中壢店", "八德店", "內湖店", "安和店", "士林店", "南港店", "頂溪店", "園區店", "新竹店", "竹北店", "林口店", "新莊店", "北大店", "河南店", "站前店", "豐原店", "太平店", "仁愛店", "板橋店", "新店店", "復北店"];
                
                const snap = await db.collectionGroup('daily_reports').where('date', '==', yesterdayStr).get();
                const submittedStores = [];
                snap.forEach(doc => {
                    const name = String(doc.data().storeName || '').replace(/店$/, '').trim() + '店';
                    submittedStores.push(name);
                });

                const missing = allStores.filter(store => !submittedStores.includes(store));
                let missingText = missing.map(s => `• ${s}`).join('\n');
                
                finalMessage = finalMessage.replace(/{missingStores}/g, missingText || "✅ 全區皆已完成回報！");
                finalMessage = finalMessage.replace(/{missingCount}/g, missing.length);
                
                // 如果大家都交了，不發送這則警報
                if (missing.length === 0) continue; 
            }

            // 4. 發送到 Telegram
            const chatId = rule.targetGroup === 'manager' ? TARGET_CHAT_ID_MANAGER : TARGET_CHAT_ID_MAIN;
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
            
            await axios.post(url, {
                chat_id: chatId,
                text: finalMessage,
                parse_mode: 'Markdown'
            });

            console.log(`✅ 任務 [${rule.name}] 執行完畢！`);
        }

    } catch (error) {
        console.error("❌ 巡邏員執行發生錯誤：", error);
    }
});