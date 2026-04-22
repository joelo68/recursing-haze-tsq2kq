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
// ★ 1. 核心資料結算邏輯 (完美保留您的原始設定)
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
// ★ Telegram 設定
// ==========================================
const TELEGRAM_BOT_TOKEN = '8787208059:AAF0AiGfUaV69YouI_b_0MuMcXpwu9EK0RA';
const TARGET_CHAT_ID_MAIN = '-4991191955'; 
const TARGET_CHAT_ID_MANAGER = '-4991191955'; 
const BRANDS = [{ id: 'cyj', name: 'CYJ' }, { id: 'anniu', name: '安妞' }, { id: 'yibo', name: '伊啵' }];

// ==========================================
// ★ 2. 終極精準：全知查詢工具 (加入前端公式與去重複防護)
// ==========================================
async function getStorePerformance(startDate, endDate, storeName = null, brandName = null) {
    const snap = await db.collectionGroup('daily_reports').where('date', '>=', startDate).where('date', '<=', endDate).get();
    let storeMap = {};
    let processed = new Set(); // ★ 去重複防護罩
    let overall = { cash: 0, accrual: 0, skincare: 0, traffic: 0, newRev: 0, newCount: 0, newClosings: 0, oldRev: 0, oldCount: 0 };

    snap.forEach(doc => {
        const data = doc.data();
        if(!data.storeName || !data.date) return;
        const sName = data.storeName.trim();
        
        // 確保同一天同一間店只算一次！
        const uniqueKey = `${data.date}_${sName}`;
        if (processed.has(uniqueKey)) return;
        processed.add(uniqueKey);

        let bId = 'CYJ';
        const path = doc.ref.path.toLowerCase();
        if (path.includes('anniu') || path.includes('anew')) bId = '安妞';
        else if (path.includes('yibo')) bId = '伊啵';

        if (brandName && !bId.toUpperCase().includes(brandName.toUpperCase()) && !brandName.toUpperCase().includes(bId.toUpperCase())) return;
        if (storeName && !sName.includes(storeName)) return;

        if (!storeMap[sName]) {
            storeMap[sName] = { storeName: sName, brand: bId, cash: 0, accrual: 0, skincare: 0, traffic: 0, newRev: 0, newCount: 0, newClosings: 0, oldRev: 0, oldCount: 0 };
        }
        
        const cash = (Number(data.cash) || 0) - (Number(data.refund) || 0);
        const accrual = (bId === '安妞') ? (Number(data.operationalAccrual) || 0) : (Number(data.accrual) || 0);
        const skincare = (Number(data.skincareSales) || 0) - (Number(data.skincareRefund) || 0);
        const traffic = Number(data.traffic) || 0;
        
        const newRev = Number(data.newCustomerSales) || Number(data.newCustomerRevenue) || 0;
        // ★ 自動導出舊客業績 (網頁前端的公式)
        const oldRev = Number(data.oldCustomerRevenue) || (cash - newRev > 0 ? cash - newRev : 0);
        
        const newCount = Number(data.newCustomers) || Number(data.newCustomerCount) || 0;
        const newClosings = Number(data.newCustomerClosings) || 0;
        // ★ 自動導出舊客數
        const oldCount = Number(data.oldCustomerCount) || (traffic - newCount > 0 ? traffic - newCount : 0);

        storeMap[sName].cash += cash;
        storeMap[sName].accrual += accrual;
        storeMap[sName].skincare += skincare;
        storeMap[sName].traffic += traffic;
        storeMap[sName].newRev += newRev;
        storeMap[sName].newCount += newCount;
        storeMap[sName].newClosings += newClosings;
        storeMap[sName].oldRev += oldRev;
        storeMap[sName].oldCount += oldCount;

        overall.cash += cash;
        overall.accrual += accrual;
        overall.skincare += skincare;
        overall.traffic += traffic;
        overall.newRev += newRev;
        overall.newCount += newCount;
        overall.newClosings += newClosings;
        overall.oldRev += oldRev;
        overall.oldCount += oldCount;
    });

    Object.values(storeMap).forEach(s => {
        s.newAvg = s.newCount > 0 ? Math.round(s.newRev / s.newCount) : 0;
        s.oldAvg = s.oldCount > 0 ? Math.round(s.oldRev / s.oldCount) : 0;
        s.newClosingRate = s.newCount > 0 ? Number(((s.newClosings / s.newCount) * 100).toFixed(1)) : 0; 
    });

    overall.newAvg = overall.newCount > 0 ? Math.round(overall.newRev / overall.newCount) : 0;
    overall.oldAvg = overall.oldCount > 0 ? Math.round(overall.oldRev / overall.oldCount) : 0;
    overall.newClosingRate = overall.newCount > 0 ? Number(((overall.newClosings / overall.newCount) * 100).toFixed(1)) : 0;

    return { overall_summary: overall, stores_details: Object.values(storeMap) }; 
}

async function getTherapistPerformance(startDate, endDate, personName = null, storeName = null, brandName = null) {
    const snap = await db.collectionGroup('therapist_daily_reports').where('date', '>=', startDate).where('date', '<=', endDate).get();
    let pMap = {};
    let processed = new Set();
    let overall = { revenue: 0, newRev: 0, newCount: 0, newClosings: 0, oldRev: 0, oldCount: 0 };

    snap.forEach(doc => {
        const data = doc.data();
        const tName = data.therapistName || "未知";
        const sName = data.storeName ? data.storeName.trim().replace(/店$/, '') : "未知";
        if (!data.date || tName === "未知") return;
        
        // 確保同人同天同店只算一次
        const uniqueKey = `${data.date}_${sName}_${tName}`;
        if (processed.has(uniqueKey)) return;
        processed.add(uniqueKey);

        let bId = data.brandId || 'CYJ';
        const path = doc.ref.path.toLowerCase();
        if (path.includes('anniu') || path.includes('anew')) bId = '安妞';
        else if (path.includes('yibo')) bId = '伊啵';
        else bId = 'CYJ';

        if (brandName && !bId.toUpperCase().includes(brandName.toUpperCase()) && !brandName.toUpperCase().includes(bId.toUpperCase())) return;
        if (storeName && !sName.includes(storeName)) return;
        if (personName && !tName.toLowerCase().includes(personName.toLowerCase())) return;

        const key = `${bId}_${sName}_${tName}`;
        if (!pMap[key]) {
            pMap[key] = { brand: bId, storeName: sName, personName: tName, revenue: 0, newRev: 0, newCount: 0, newClosings: 0, oldRev: 0, oldCount: 0 };
        }
        
        const rev = Number(data.totalRevenue) || 0;
        const newRev = Number(data.newCustomerRevenue) || 0;
        const oldRev = Number(data.oldCustomerRevenue) || (rev - newRev > 0 ? rev - newRev : 0);
        const newCount = Number(data.newCustomerCount) || 0;
        const newClosings = Number(data.newCustomerClosings) || 0;
        const traffic = Number(data.traffic) || Number(data.customerCount) || 0;
        const oldCount = Number(data.oldCustomerCount) || (traffic - newCount > 0 ? traffic - newCount : 0);

        pMap[key].revenue += rev;
        pMap[key].newRev += newRev;
        pMap[key].oldRev += oldRev;
        pMap[key].newCount += newCount;
        pMap[key].oldCount += oldCount;
        pMap[key].newClosings += newClosings;

        overall.revenue += rev;
        overall.newRev += newRev;
        overall.oldRev += oldRev;
        overall.newCount += newCount;
        overall.oldCount += oldCount;
        overall.newClosings += newClosings;
    });

    Object.values(pMap).forEach(p => {
        p.newAvg = p.newCount > 0 ? Math.round(p.newRev / p.newCount) : 0;
        p.oldAvg = p.oldCount > 0 ? Math.round(p.oldRev / p.oldCount) : 0;
        p.newClosingRate = p.newCount > 0 ? Number(((p.newClosings / p.newCount) * 100).toFixed(1)) : 0; 
    });

    overall.newAvg = overall.newCount > 0 ? Math.round(overall.newRev / overall.newCount) : 0;
    overall.oldAvg = overall.oldCount > 0 ? Math.round(overall.oldRev / overall.oldCount) : 0;
    overall.newClosingRate = overall.newCount > 0 ? Number(((overall.newClosings / overall.newCount) * 100).toFixed(1)) : 0;

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

const aiTools = {
    functionDeclarations: [
        {
            name: "getStorePerformance",
            description: "查詢店鋪/品牌的營運狀況，包含現金、權責、保養品、客單價、締結率。",
            parameters: { type: "OBJECT", properties: { startDate: { type: "STRING", description: "選填" }, endDate: { type: "STRING", description: "選填" }, storeName: { type: "STRING" }, brandName: { type: "STRING" } } }
        },
        {
            name: "getTherapistPerformance",
            description: "查詢人員/諮詢師的個人業績、客單價與締結率。",
            parameters: { type: "OBJECT", properties: { startDate: { type: "STRING", description: "選填" }, endDate: { type: "STRING", description: "選填" }, personName: { type: "STRING" }, storeName: { type: "STRING" }, brandName: { type: "STRING" } } }
        },
        {
            name: "getMissingReports",
            description: "查詢未交日報名單。",
            parameters: { type: "OBJECT", properties: { startDate: { type: "STRING" }, endDate: { type: "STRING" } } }
        }
    ]
};

// ==========================================
// ★ 3. Webhook: AI Agent 對話總機 (完美防彈+精準版)
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
        // ★ 換上最高階聰明的付費大腦
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            tools: [aiTools],
            systemInstruction: `你是一位醫美集團的高階戰情分析秘書。現在日期是 ${todayStr}。
【最高防偽與精準原則】
1. 絕對禁止捏造數據！
2. 當你需要回答「整體概況」時，【絕對禁止你自己計算】，必須直接讀取工具回傳的 'overall_summary' 裡的數字。
3. 【嚴格套用公司專用術語】：
   - cash ➔ 「現金業績」
   - accrual ➔ 「實作業績/權責業績」
   - skincare ➔ 「保養品業績」(嚴禁說成美膚)
   - newRev ➔ 「新客業績」
   - newAvg / oldAvg ➔ 「客單價」
   - newClosingRate ➔ 「新客締結率」
4. 收到指令後，【最多只能呼叫一個工具】。拿到資料後請立刻分析，絕對不准因為貪心而等待呼叫第二個工具！
5. 【輸出排版極度嚴格 - 避免 Telegram 當機】：
   - 輸出環境為純文字，絕對禁止使用任何 Markdown 排版符號（例如禁止使用 **、#、_、[] 等符號）。
   - 請多使用 Emoji (如 📊, 🏢, 💰, 💡, ⚠️) 搭配換行來美化。
   - 強制使用「繁體中文」，所有金額加上千分位逗號。`
        });

        const aiChat = model.startChat();
        const result = await aiChat.sendMessage(command);
        
        const calls = result.response.functionCalls ? result.response.functionCalls() : null;
        const functionCall = (calls && calls.length > 0) ? calls[0] : null;

        let finalReply = "";

        if (functionCall) {
            const { name, args } = functionCall;
            // 防呆：AI 偷懶不填日期時，自動幫他填好本月區間
            const safeStartDate = args.startDate || `${currentYearMonth}-01`;
            const safeEndDate = args.endDate || todayStr;

            let apiData = [];

            if (name === "getStorePerformance") apiData = await getStorePerformance(safeStartDate, safeEndDate, args.storeName, args.brandName);
            else if (name === "getTherapistPerformance") apiData = await getTherapistPerformance(safeStartDate, safeEndDate, args.personName, args.storeName, args.brandName);
            else if (name === "getMissingReports") apiData = await getMissingReports(safeStartDate, safeEndDate);

            try {
                const secondResult = await aiChat.sendMessage([{
                    functionResponse: { name: name, response: { result: apiData } }
                }]);
                finalReply = secondResult.response.text();
            } catch (innerError) {
                console.error("AI 產生報告時崩潰:", innerError);
                finalReply = "🤖 秘書已成功撈取數據，但您要求的分析範圍過大。請試著將問題縮小，例如只查詢特定單店。";
            }
        } else {
            finalReply = result.response.text();
        }

        if (!finalReply || finalReply.trim() === "") {
            finalReply = "🤖 秘書目前無法總結這個數據，請換個具體一點的方式問問看。";
        }

        // ★ 暴力清洗所有會讓 Telegram 報 400 錯誤的排版符號
        finalReply = finalReply.replace(/[*#`_\[\]]/g, '');
        // ★ 自動截斷過長的萬字報告，保護傳送安全
        if (finalReply.length > 3800) {
            finalReply = finalReply.substring(0, 3800) + "\n\n... (字數已達通訊軟體上限，後續洞察報告已自動截斷)。";
        }

        // ★ 拔除 parse_mode: 'Markdown'，改用純文字模式強勢通關
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
// ★ 4. Telegram 動態定時推播巡邏員 (完美保留原始設定)
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
});