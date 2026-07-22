# DRCYJ Telegram 營運戰情 Agent v1.4

版本：`drcyj-agent-v1.4-trust-active-alerts`

## 主要升級

1. 集中式營運指標字典：現金、權責、現金達成率、月份進度與各類排名由後端固定定義。
2. 區長多維排名：現金達成率、現金金額、進度差距、新客、締結率、保養品占比。
3. 排名可信度護欄：正式店家、日報或現金目標不完整時，`rankingEligible=false`，Agent 禁止宣稱名次。
4. 資料健康工具：新增 `getDataHealth` 與 `/datahealth`。
5. 每日戰情摘要：新增 `getDailyBattleBrief` 與 `/today`。
6. 快速異常查詢：`/alerts`。
7. 主動預警基礎版：新增 `telegramAgentDailyPatrol`，每日 09:35 檢查；預設停用，不呼叫 Gemini。

## 部署

將本套件的 `index.js` 覆蓋至：

```text
functions/index.js
```

檢查語法：

```bash
node --check functions/index.js
```

部署 Telegram Webhook 與主動預警排程：

```bash
firebase deploy --only functions:telegramWebhook,functions:telegramAgentDailyPatrol
```

不需要重新設定 Telegram Token，也不需要重新設定 Webhook。

## Telegram 測試

```text
/reset
/datahealth 安妞
/today
/alerts CYJ
安妞 Amanda 區長本月整體表現如何？請列出所有排名與資料可信度。
```

## 啟用主動預警

在 Firestore 建立：

```text
telegram_agent_config/active_alerts
```

可使用套件內的 `active_alerts_config.example.json` 作為欄位範例。

- `enabled=false`：每天只讀取 1 筆設定，不執行營運掃描。
- `enabled=true`：每天 09:35 執行一次固定規則異常掃描。
- 主動預警不呼叫 Gemini，因此不產生 Gemini Token 費用。
- `chatIds` 若省略，預設發送至程式內既有兩個授權主管群組。

## 排名規則

只有以下條件全部成立，區長才會參與排名：

- 正式組織架構中至少有一間店。
- 該區所有正式店家都有本月資料。
- 該區所有正式店家都有現金目標。

資料不完整時，回覆應說明缺少的日報或目標，不得自行稱為第幾名。

## 驗證範圍

已完成：

- `node --check`
- 明碼 Telegram Token 掃描
- ZIP 完整性檢查
- 排名欄位與指標名稱靜態檢查

尚未連線替你執行正式 Firebase 部署或正式 Firestore 資料驗證。
