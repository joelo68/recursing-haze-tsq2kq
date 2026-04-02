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