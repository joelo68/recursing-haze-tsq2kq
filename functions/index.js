/**
 * 引入 Firebase 核心功能
 */
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

// 初始化 Firebase Admin
initializeApp();
const db = getFirestore();

/**
 * 核心功能：自動計算月報表 (最終發布版 - 含圖表數據)
 * 支援：多品牌、幽靈路徑、每日走勢圖數據
 */
exports.aggregateDailyReports = onDocumentWritten("brands/{brandId}/daily_reports/{reportId}", async (event) => {
    // 1. 取得觸發事件的參數
    const brandId = event.params.brandId; 
    
    // 取得資料
    const reportData = event.data.after.data() || event.data.before.data();
    if (!reportData) return; 

    // 2. 解析日期
    let dateStr = "";
    if (reportData.date) {
        if (typeof reportData.date === 'string') {
            dateStr = reportData.date; // "2026-02-01"
        } else if (reportData.date.toDate) {
            dateStr = reportData.date.toDate().toISOString().split('T')[0];
        }
    }

    if (!dateStr) {
        console.log(`[略過] 品牌 ${brandId} 的資料缺少 date 欄位`);
        return;
    }

    // 取得月份 ID (例如 "2026_2")
    const [year, month] = dateStr.split("-"); 
    const monthId = `${year}_${parseInt(month)}`; 

    console.log(`正在計算: 品牌 [${brandId}] - 月份 [${monthId}] (含圖表數據)...`);

    // 3. 讀取該品牌、該月份的「所有日報」
    const reportsRef = db.collection(`brands/${brandId}/daily_reports`);
    const querySnapshot = await reportsRef
        .where('date', '>=', `${year}-${month}-01`)
        .where('date', '<=', `${year}-${month}-31`) 
        .get();

    // 4. 開始累加數值
    let totalRevenue = 0;      
    let totalAccrual = 0;      
    let totalTraffic = 0;      
    let totalNewCustomers = 0; 
    let totalOldCustomers = 0; 
    let totalNewSales = 0;     
    let totalOldSales = 0;     
    let opAccrual = 0;
    
    // ★ 新增：每日數據明細 (給圖表用)
    let dailyBreakdown = {}; 

    // 數值轉換函數
    const safeNum = (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') return parseFloat(val.replace(/,/g, '')) || 0;
        return 0;
    };

    querySnapshot.forEach(doc => {
        const data = doc.data();
        
        const cash = safeNum(data.cash) - safeNum(data.refund);
        const accrual = safeNum(data.accrual);
        const skincare = safeNum(data.skincareSales);
        const traffic = safeNum(data.traffic);
        
        // 累加總額
        totalRevenue += cash;
        totalAccrual += accrual;
        totalTraffic += traffic;
        totalNewCustomers += safeNum(data.newCustomers);
        totalOldCustomers += safeNum(data.oldCustomerCount); 
        totalNewSales += safeNum(data.newCustomerSales); 
        totalOldSales += safeNum(data.oldCustomerRevenue); 
        opAccrual += (safeNum(data.operationalAccrual) || (accrual - skincare));

        // ★ 累加每日數據
        // 從 date "2026-02-05" 抓出 "5"
        let dayKey = "1";
        if (data.date) {
             const dParts = typeof data.date === 'string' ? data.date.split('-') : data.date.toDate().toISOString().split('T')[0].split('-');
             dayKey = parseInt(dParts[2]).toString(); // "5"
        }

        if (!dailyBreakdown[dayKey]) {
            dailyBreakdown[dayKey] = { cash: 0, traffic: 0 };
        }
        dailyBreakdown[dayKey].cash += cash;
        dailyBreakdown[dayKey].traffic += traffic;
    });

    // 5. 準備寫入資料
    const statsData = {
        totalRevenue,
        totalAccrual,
        totalTraffic,
        totalNewCustomers,
        totalOldCustomers,
        totalNewSales,
        totalOldSales,
        opAccrual,
        dailyBreakdown, // ★ 這會存入每天的 cash 和 traffic
        updatedAt: new Date(),
        reportCount: querySnapshot.size
    };

    // 6. 寫入到「影子測試區」
    const outputRef = db.doc(`brands/${brandId}/test_monthly_stats/${monthId}`);
    await outputRef.set(statsData, { merge: true });

    console.log(`✅ 計算完成: [${brandId}] ${monthId} 已更新 (含 Daily Breakdown)`);
});