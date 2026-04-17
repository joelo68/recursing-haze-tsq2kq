// src/components/DailyTelegramTrigger.jsx
import { useEffect, useContext, useRef } from 'react';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { AppContext } from '../AppContext';
import { sendTelegramAlert } from '../utils/telegramBot';

const DailyTelegramTrigger = () => {
  const { getCollectionPath, currentBrand } = useContext(AppContext);
  const hasChecked = useRef(false);

  useEffect(() => {
    // 確保只執行一次
    if (hasChecked.current) return;
    hasChecked.current = true;

    const checkAndSendDailyReport = async () => {
      const now = new Date();
      
      // ⚠️ 限制：只在早上 7 點之後才允許觸發
      if (now.getHours() < 7) return;

      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      try {
        const statusRef = doc(db, getCollectionPath('system_settings'), 'telegram_push_status');
        const statusSnap = await getDoc(statusRef);

        // 如果今天已經發送過，就安靜退出
        if (statusSnap.exists() && statusSnap.data().lastDailyPushDate === todayStr) {
          console.log("🌅 晨間戰報今日已推播過，跳過執行。");
          return; 
        }

        // 抓取昨天日期
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

        const reportsRef = collection(db, getCollectionPath('daily_reports'));
        const q = query(reportsRef, where("date", "==", yStr));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
           await setDoc(statusRef, { lastDailyPushDate: todayStr }, { merge: true });
           return;
        }

        // 計算昨日全區 TOP 3
        const storeMap = {};
        querySnapshot.forEach(document => {
          const data = document.data();
          const sName = String(data.storeName).replace(/店$/, '').trim() + '店'; 
          if (!storeMap[sName]) storeMap[sName] = 0;
          storeMap[sName] += (Number(data.cash) || 0) - (Number(data.refund) || 0);
        });

        const top3 = Object.entries(storeMap)
          .map(([name, rev]) => ({ name, rev }))
          .sort((a, b) => b.rev - a.rev)
          .slice(0, 3);

        if (top3.length > 0) {
          // 解析品牌名稱
          let brandName = "CYJ";
          if (currentBrand) {
             const bId = typeof currentBrand === 'string' ? currentBrand : (currentBrand.id || "cyj");
             if (bId.toLowerCase().includes("anniu") || bId.toLowerCase().includes("anew")) brandName = "安妞";
             else if (bId.toLowerCase().includes("yibo")) brandName = "伊啵";
             else if (typeof currentBrand === 'object' && currentBrand.name) brandName = currentBrand.name;
          }

          const badges = ["底氣十足", "緊咬不放", "穩紮穩打"];
          let message = `🏆 *【${brandName} 晨間戰報】昨日全區 TOP 3* 🏆\n\n早安！昨日的激烈廝殺結果出爐：\n`;

          top3.forEach((store, idx) => {
            const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
            message += `${medal} 第${idx + 1}名：${store.name} ($${store.rev.toLocaleString()}) - *[${badges[idx]}]*\n`;
          });

          message += `\n今日戰火已經點燃，誰能奪下今天的榜首？🔥`;

          // 發送至 Telegram (帶入 brandId)
          const bIdForRoute = typeof currentBrand === 'string' ? currentBrand : (currentBrand?.id || "cyj");
          await sendTelegramAlert(message, bIdForRoute.toLowerCase());
        }

        // 寫入 Firebase 記號，防止下一位登入的主管重複發送
        await setDoc(statusRef, { lastDailyPushDate: todayStr }, { merge: true });
        console.log(`✅ ${todayStr} 晨間戰報已觸發推播！`);

      } catch (error) {
        console.error("❌ 自動推播晨間戰報失敗:", error);
      }
    };

    checkAndSendDailyReport();
  }, [getCollectionPath, currentBrand]);

  return null; 
};

export default DailyTelegramTrigger;