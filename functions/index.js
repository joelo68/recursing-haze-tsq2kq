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
// ★ 1. 核心資料結算邏輯
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
// ★ 2. Webhook 雙向對話接收器
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
        let reply = "";
        let nlp = { intent: "unknown", storeName: null, personName: null, dateRange: [currentYearMonth + "-01", todayStr] };
        
        if (/(你好|安安|嗨|help|\/help)/.test(command)) {
            nlp.intent = "help";
        } else {
            try {
                const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                
                // ★★★ 加入 "missing" (未交名單) 的認知 ★★★
                const prompt = `你是一位高階戰情分析秘書。
今天的日期是：${todayStr}
使用者說：「${command}」

請將這句話解析為 JSON 查詢條件。
【JSON 格式】
{"intent": "分類意圖", "storeName": "店名", "personName": "人名", "dateRange": ["YYYY-MM-DD", "YYYY-MM-DD"]}

【分類意圖 (intent) 判斷順序】(嚴格遵守)
1. 若語句包含「沒交、未交、沒回報、沒填」，intent 必填 "missing"。
2. 若語句包含「特定員工/管理師的名字」，intent 必填 "person"，並將名字填入 personName。若同時有店名，將店名填入 storeName (去掉"店"字)。
3. 若只提到「特定店名」沒提人名，intent 必填 "store"，並將店名填入 storeName (去掉"店"字)。
4. 若以上皆非，只是問全區、總業績，intent 必填 "progress"。

【時間規則】
1. 前天：精準計算為前天的日期。
2. 昨天：計算為昨天的日期。
3. 若沒提時間：預設為 ["${currentYearMonth}-01", "${todayStr}"]。

請只輸出純 JSON，嚴禁包含任何解釋。`;

                const result = await model.generateContent(prompt);
                const jsonMatch = result.response.text().match(/\{[\s\S]*\}/);
                if (!jsonMatch) throw new Error("AI 回傳了非 JSON 格式的廢話");
                nlp = JSON.parse(jsonMatch[0]);

            } catch (aiError) {
                console.error("AI 翻譯失敗:", aiError);
                throw new Error("AI 解析失敗 (" + aiError.message + ")");
            }
        }

        const [startDate, endDate] = nlp.dateRange || [currentYearMonth + "-01", todayStr];

        // ------------------------------------------------
        // 📤 數據查詢邏輯
        // ------------------------------------------------
        
        // ★ 新增：未回報名單查詢邏輯 ★
        if (nlp.intent === "missing") {
            const past14Days = new Date(startDate);
            past14Days.setDate(past14Days.getDate() - 14);
            const past14Str = past14Days.toISOString().split('T')[0];

            // 抓活躍名單
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

            // 抓區間內有交的名單
            const submittedSnap = await db.collectionGroup('daily_reports').where('date', '>=', startDate).where('date', '<=', endDate).get();
            const submittedStoresByBrand = { cyj: new Set(), anniu: new Set(), yibo: new Set() };
            submittedSnap.forEach(doc => {
                const data = doc.data();
                let bId = data.brandId || 'cyj';
                if (bId.includes('anniu') || bId.includes('anew')) bId = 'anniu';
                else if (bId.includes('yibo')) bId = 'yibo';
                else bId = 'cyj';
                if(data.storeName) submittedStoresByBrand[bId].add(data.storeName.trim());
            });

            const dateStr = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
            reply = `🚨 *【未回報名單查詢】*\n📅 查詢日期：${dateStr}\n\n`;
            let allClear = true;

            BRANDS.forEach(brand => {
                const expectedStores = Array.from(activeRosterByBrand[brand.id]);
                const submittedStores = submittedStoresByBrand[brand.id];
                const missing = expectedStores.filter(store => !submittedStores.has(store));
                
                if (expectedStores.length > 0 && missing.length > 0) { 
                    allClear = false;
                    reply += `*${brand.name}* (${missing.length} 間未交):\n${missing.map(s => `• ${s}`).join('\n')}\n\n`;
                }
            });

            if (allClear) {
                reply += "✅ 表現優異，這段期間全區皆已完成回報！";
            }
        }
        else if (nlp.intent === "store" && nlp.storeName) {
            const snap = await db.collectionGroup('daily_reports').where('date', '>=', startDate).where('date', '<=', endDate).get();
            let storeMap = {};
            snap.forEach(doc => {
                const data = doc.data();
                if (data.storeName && data.storeName.includes(nlp.storeName)) {
                    const sName = data.storeName.trim();
                    if (!storeMap[sName]) storeMap[sName] = { cash: 0, accrual: 0, bId: 'CYJ' };
                    let bId = 'CYJ';
                    const path = doc.ref.path.toLowerCase();
                    if (path.includes('anniu') || path.includes('anew')) bId = '安妞';
                    else if (path.includes('yibo')) bId = '伊啵';
                    storeMap[sName].bId = bId;
                    storeMap[sName].cash += (Number(data.cash) || 0) - (Number(data.refund) || 0);
                    storeMap[sName].accrual += (bId === '安妞') ? (Number(data.operationalAccrual) || 0) : (Number(data.accrual) || 0);
                }
            });

            let found = Object.keys(storeMap).map(key => `🏢 *${key}* (${storeMap[key].bId})\n▫️ 區間現金：$${storeMap[key].cash.toLocaleString()}\n▫️ 區間權責：$${storeMap[key].accrual.toLocaleString()}`);
            const dateStr = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
            reply = found.length > 0 ? `📍 *【店家表現查詢】*\n📅 ${dateStr}\n\n${found.join("\n\n")}` : `找不到「${nlp.storeName}」在該時段的數據。`;
        }
        else if (nlp.intent === "person" && nlp.personName) {
            const tSnap = await db.collectionGroup('therapist_daily_reports').where('date', '>=', startDate).where('date', '<=', endDate).get();
            let personMap = {}; 
            tSnap.forEach(doc => {
                const data = doc.data();
                const tName = data.therapistName || "";
                const sName = data.storeName ? data.storeName.trim().replace(/店$/, '') + '店' : "未知店";
                if (tName.toLowerCase().includes(nlp.personName.toLowerCase()) && (!nlp.storeName || sName.includes(nlp.storeName))) {
                    const mapKey = `${sName}_${tName}`;
                    if (!personMap[mapKey]) personMap[mapKey] = { name: tName, store: sName, revenue: 0, count: 0 };
                    personMap[mapKey].revenue += (Number(data.totalRevenue) || 0);
                    personMap[mapKey].count++;
                }
            });

            const persons = Object.values(personMap);
            const dateStr = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
            if (persons.length === 0) reply = `找不到「${nlp.personName}」在 ${dateStr} 的紀錄。`;
            else {
                reply = `🌟 *【管理師個人戰績】*\n📅 ${dateStr}\n\n`;
                persons.sort((a,b) => b.revenue - a.revenue).forEach(p => {
                    reply += `👤 *${p.name}* (${p.store})\n💰 區間業績：*$${p.revenue.toLocaleString()}*\n📅 回報天數：${p.count} 天\n\n`;
                });
            }
        }
        else if (nlp.intent === "progress") {
            const snap = await db.collectionGroup('daily_reports').where('date', '>=', startDate).where('date', '<=', endDate).get();
            let pMap = { cyj: { name: 'CYJ', cash: 0, accrual: 0 }, anniu: { name: '安妞', cash: 0, accrual: 0 }, yibo: { name: '伊啵', cash: 0, accrual: 0 } };
            snap.forEach(doc => {
                const data = doc.data();
                let bId = data.brandId || 'cyj';
                const path = doc.ref.path.toLowerCase();
                if (path.includes('anniu') || path.includes('anew') || bId.includes('anniu')) bId = 'anniu';
                else if (path.includes('yibo') || bId.includes('yibo')) bId = 'yibo';
                else bId = 'cyj';
                pMap[bId].cash += (Number(data.cash) || 0) - (Number(data.refund) || 0);
                pMap[bId].accrual += (bId === '安妞') ? (Number(data.operationalAccrual) || 0) : (Number(data.accrual) || 0);
            });
            const dateStr = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
            reply = `📊 *【即時進度查詢】*\n📅 ${dateStr}\n\n` + Object.values(pMap).filter(b=>b.cash>0||b.accrual>0).map(b=>`*${b.name}*\n▫️ 現金：$${b.cash.toLocaleString()}\n▫️ 權責：$${b.accrual.toLocaleString()}`).join("\n\n");
        } 
        else if (nlp.intent === "help") {
            reply = "🤖 您好！我是您的戰情小助手。\n您可以這樣直接跟我說話：\n\n🔹 「這個月的進度」\n🔹 「安平店昨天的業績」\n🔹 「昨天有誰沒交報表？」";
        }

        if (reply === "") {
            reply = "🤖 抱歉，我不太懂您的意思。您可以試著說：「昨天沒回報業績的店家」。";
        }

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: reply, parse_mode: 'Markdown' });

    } catch (error) {
        console.error("Webhook 嚴重錯誤:", error);
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { 
            chat_id: chatId, 
            text: `❌ 機器人腦部異常：\n\`${error.message}\`` 
        });
    }
    res.sendStatus(200);
});

// ==========================================
// ★ 3. Telegram 動態定時推播巡邏員
// ==========================================
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