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
// ★ Telegram 晨間戰報自動排程 (每天 07:00 執行)
// ==========================================
const TELEGRAM_BOT_TOKEN = '8787208059:AAF0AiGfUaV69YouI_b_0MuMcXpwu9EK0RA';
const TARGET_CHAT_ID = '-4991191955'; // DRCYJ營運中心群組

exports.sendMorningReport = onSchedule({
    schedule: "0 7 * * *",
    timeZone: "Asia/Taipei"
}, async (event) => {
    // 確保可以抓到 firebase-admin 的 db
    const admin = require("firebase-admin");
    if (!admin.apps.length) {
        admin.initializeApp();
    }
    const db = admin.firestore();

    console.log("啟動晨間戰報結算程序...");

    const now = new Date();
    const utcHours = now.getUTCHours();
    now.setHours(utcHours + 8); 
    now.setDate(now.getDate() - 1); 
    
    const yYear = now.getFullYear();
    const yMonth = String(now.getMonth() + 1).padStart(2, '0');
    const yDay = String(now.getDate()).padStart(2, '0');
    const targetDateStr = `${yYear}-${yMonth}-${yDay}`;

    try {
        // ★ 關鍵修正：使用 collectionGroup 一次抓取所有品牌底下的 daily_reports
        const snapshot = await db.collectionGroup('daily_reports').where('date', '==', targetDateStr).get();

        if (snapshot.empty) {
            console.log(`[${targetDateStr}] 找不到昨日的日報資料，停止推播。`);
            return;
        }

        // ★ 依照品牌 (brandId) 進行分組統計
        const brandData = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            // 讀取日報上的 brandId，如果沒有就預設為 cyj
            const bId = (data.brandId || 'cyj').toLowerCase(); 
            
            if (!brandData[bId]) brandData[bId] = {};
            
            const sName = String(data.storeName || '').replace(/店$/, '').trim() + '店';
            if (!brandData[bId][sName]) brandData[bId][sName] = 0;
            brandData[bId][sName] += (Number(data.cash) || 0) - (Number(data.refund) || 0);
        });

        // ★ 針對每個品牌，分別計算 Top 3 並發送推播
        for (const [bId, storeMap] of Object.entries(brandData)) {
            const top3 = Object.entries(storeMap)
                .map(([name, rev]) => ({ name, rev }))
                .sort((a, b) => b.rev - a.rev)
                .slice(0, 3);

            if (top3.length === 0) continue;

            // 判斷品牌中文名稱
            let brandName = "CYJ";
            let targetChatId = TARGET_CHAT_ID; // 預設發到營運中心

            if (bId.includes('anniu') || bId.includes('anew')) {
                brandName = "安妞";
                // targetChatId = '-100XXXXXXXXX'; // 未來若安妞有獨立群組，填入此處
            } else if (bId.includes('yibo')) {
                brandName = "伊啵";
            }

            const badges = ["底氣十足", "緊咬不放", "穩紮穩打"];
            let message = `🏆 *【${brandName} 晨間戰報】昨日全區 TOP 3* 🏆\n\n早安！昨日的激烈廝殺結果出爐：\n\n`;

            top3.forEach((store, idx) => {
                const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
                message += `${medal} 第${idx + 1}名：${store.name} ($${store.rev.toLocaleString()}) - *[${badges[idx]}]*\n`;
            });

            message += `\n今日戰火已經點燃，誰能奪下今天的榜首？🔥`;

            // 發送至 Telegram
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
            await axios.post(url, {
                chat_id: targetChatId,
                text: message,
                parse_mode: 'Markdown'
            });
            
            console.log(`✅ [${brandName}] 晨間戰報推播成功！`);
        }

    } catch (error) {
        console.error("❌ 晨間戰報推播發生錯誤：", error);
    }
});