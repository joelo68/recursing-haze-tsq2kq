// src/utils/telegramBot.js

const TELEGRAM_BOT_TOKEN = '8787208059:AAF0AiGfUaV69YouI_b_0MuMcXpwu9EK0RA';

// ★ 設定各品牌的專屬群組 ID (目前先全部統一發到營運中心測試)
const CHAT_IDS = {
  'cyj': '-4991191955',    
  'anniu': '-4991191955',  
  'yibo': '-4991191955',   
  'default': '-4991191955'
};

// 支援傳入 brandId 進行路由分流
export const sendTelegramAlert = async (message, brandId = 'default') => {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  // 根據傳進來的品牌 ID 尋找對應的群組
  let targetChatId = CHAT_IDS.default;
  if (brandId.includes('anniu') || brandId.includes('anew')) targetChatId = CHAT_IDS.anniu;
  else if (brandId.includes('yibo')) targetChatId = CHAT_IDS.yibo;
  else if (brandId.includes('cyj')) targetChatId = CHAT_IDS.cyj;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    
    const data = await response.json();
    if (data.ok) {
      console.log('✅ Telegram 推播成功！');
    } else {
      console.error('❌ Telegram 推播失敗：', data.description);
    }
  } catch (error) {
    console.error('❌ Telegram 網路連線錯誤：', error.message);
  }
};