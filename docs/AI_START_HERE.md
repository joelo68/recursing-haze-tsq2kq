# AI_START_HERE.md

> 本檔案是本專案給「新對話、新 AI、新工程師」的固定接手入口。  
> 在修改任何正式程式前，先閱讀本檔案，再依指定順序閱讀 Project Knowledge Base。  
> 若本文件與目前正式部署 source 衝突，以使用者提供的「目前正式部署版本」為準，並同步修正 Knowledge Base。

---

# 1. 最重要的 Source of Truth

處理本專案時，資訊優先順序固定為：

```text
目前正式部署程式
↓
CURRENT_STATE.md
↓
Project Knowledge Base
↓
Regression Tests
↓
Git History / Production Tag
↓
舊對話 / AI 記憶
```

## 強制規則

- 不可因為 AI「記得以前看過這支程式」就直接修改。
- 要修改哪支程式，必須取得目前正式部署版本。
- 舊對話、舊附件、AI 記憶只可作為線索，不可作為目前正式架構的唯一依據。
- 如果 Knowledge Base 與目前正式 source 不一致，以正式 source 為準，並把文件同步更新。

---

# 2. 接手後第一步

依序閱讀：

```text
1. docs/AI_START_HERE.md
2. docs/CURRENT_STATE.md
3. docs/README.md
4. docs/ARCHITECTURE.md
5. docs/DEVELOPMENT_GUIDE.md
6. docs/SYSTEM_SOURCE_MAP.md
```

然後依本次需求閱讀 `docs/` 內的專門文件。

---

# 3. 依功能選讀

## Dashboard / Summary / 歷史資料

```text
docs/DASHBOARD_SUMMARY.md
docs/DATA_FLOW.md
docs/FIREBASE_DATA_MODEL.md
```

必要時再看：

```text
DATA_IDENTITY_RULES.md
tests/storeIdentity.test.js
```

## Firestore / Collection / 資料流

```text
docs/FIREBASE_DATA_MODEL.md
docs/DATA_FLOW.md
```

## 登入 / 權限 / 裝置 / 安全

```text
docs/AUTH_AND_SECURITY.md
```

## Telegram Agent / Gemini / Policy / Schedule / Task

```text
docs/TELEGRAM_AGENT.md
```

## SystemMaintenance / Audit / 修復 / Read Tracker

```text
docs/MAINTENANCE_TOOLS.md
```

## Store Identity / CYJ 新店 / canonical / legacy alias

一定先讀：

```text
DATA_IDENTITY_RULES.md
tests/storeIdentity.test.js
```

禁止先在單一頁面做 workaround。

---

# 4. 開始修改程式前

AI / 工程師必須先回答：

```text
1. 這次修改影響哪個功能？
2. 真正負責這個功能的是哪些 source files？
3. 這些檔案是否已取得目前正式部署版本？
4. 是否涉及 Firestore collection / Summary / Identity / Security / Telegram？
5. 是否存在 regression test 或維護工具可驗證？
```

若無法確認第 2 或第 3 項：

> 不得靠猜測開始改。  
> 應先向使用者要求缺少的目前正式檔案。

---

# 5. 不可跨版本拼接

禁止把：

```text
舊 App.jsx
+
新 useDashboardStats.js
+
記憶中的 functions/index.js
```

拼成一個「看起來完整」的修改版本。

同一個修正涉及多支檔案時，
每一支都應確認是目前正式版本。

---

# 6. Store Identity 強制規則

CYJ 新店目前的治理規則由：

```text
DATA_IDENTITY_RULES.md
```

定義。

核心概念：

```text
coreStoreName      = 新店
canonicalStoreName = CYJ新店店
```

遇到新店資料問題時：

```text
Core Consistency Audit
→ Collection
→ Raw document / storeName
→ canonical / alias
→ writer
→ derived data
→ 最後才看 page query
```

禁止：

```text
if (storeName === "新店") {
  // 單頁臨時補資料
}
```

來掩蓋資料身份問題。

---

# 7. Raw / Derived Data 原則

看到數字不一致時先判斷：

```text
Raw
Master
Settings
Derived
Queue
Audit
```

不要把 Summary / aggregate 當成永遠正確的原始資料。

基本追查順序：

```text
Master / Identity
↓
Raw
↓
Aggregation
↓
Summary
↓
View
```

---

# 8. 跨品牌路徑

CYJ 與安妞／伊啵 Firestore root 不同。

修改跨品牌功能時，優先確認：

```text
getCollectionPath()
getDocPath()
```

不要把 CYJ legacy path 硬套到所有品牌。

---

# 9. Firestore Reads

如果新增 listener / query：

先確認：

```text
是否真的需要常駐？
能不能限制到單店？
能不能限制到單日？
能不能用 Summary？
是否會破壞 App 現有 view-based throttling？
```

不要為了「保證有資料」就讓大型 collection 在所有頁面常駐讀取。

---

# 10. Security

目前 Firestore Rules 仍不等於完整的 server-side role authorization。

因此：

```text
Frontend role
≠
Firestore server-verified role
```

修改 Login／Device／Security 前，必須同時讀正式文件與目前 source：

```text
docs/AUTH_AND_SECURITY.md
docs/CURRENT_STATE.md
src/App.jsx
src/components/LoginView.jsx
src/components/DeviceApprovalGate.jsx
src/components/DeviceApprovalPanel.jsx
src/components/SystemMonitor.jsx
functions/deviceApproval.js
firestore.rules
```

最高管理者 UI 能看到操作，不代表 Backend 可以直接相信該身份；Device Approval backend action 必須自己重新驗證 actor。

除非目前正式 Backend 明確存在，否則禁止重新套用舊文件的「前 N 台裝置 auto trust」假設。

# 11. Telegram

現在有兩條不同 Telegram pipeline，修改前一定要先分清楚。

營運／Gemini Agent：

```text
functions/index.js
functions/telegram/prompts.js
NotificationManager.jsx
TelegramAlertControlCenter.jsx
docs/TELEGRAM_AGENT.md
```

登入安全 Telegram：

```text
Security Event
→ security_alerts
→ Firestore onCreate trigger
→ telegram_security_alerts config
→ sendTelegramMessage()
```

修改 Telegram 前，先確認本次屬於哪一條。

Agent pipeline 至少確認：

```text
資料來源
tool
scope
source authority
model/API
policy
schedule
snapshot
task
```

登入安全 Telegram 至少確認：

```text
event type
cooldown
brand path
chat targets
security_alerts write
Functions trigger
```

不要把公司數據錯誤只當 prompt 問題；也不要為了發一則登入安全提醒，額外加入不必要的 Gemini／KPI tool reads。

# 12. 一次性修復工具

事故修復完成後：

```text
Repair Tool 退場
Audit 留下
Preventive Guard 留下
Regression Test 留下
Knowledge Base 留下
```

不要讓一次性 mutation UI 永久留在正式系統。

---

# 13. 修改完成不代表工作完成

每次功能新增／修改完成後，強制執行：

```text
程式修改
↓
Syntax / Build
↓
Regression Test
↓
功能驗證
↓
Knowledge Base Impact Check
↓
需要 → 更新受影響 .md
不需要 → 明確標示「本次 Knowledge Base 不需更新」
↓
更新 CURRENT_STATE.md
↓
Git Commit
↓
Deploy
↓
部署後驗證
↓
Production Tag（若採用）
```

---

# 14. Knowledge Base Impact Check

每次修改後都要逐項判斷：

```text
docs/README.md
docs/ARCHITECTURE.md
docs/DEVELOPMENT_GUIDE.md
docs/DEPLOYMENT.md
docs/SYSTEM_SOURCE_MAP.md
docs/CURRENT_STATE.md

docs/FIREBASE_DATA_MODEL.md
docs/DASHBOARD_SUMMARY.md
docs/AUTH_AND_SECURITY.md
docs/TELEGRAM_AGENT.md
docs/MAINTENANCE_TOOLS.md
docs/DATA_FLOW.md

DATA_IDENTITY_RULES.md
tests/storeIdentity.test.js
```

只更新真正受影響的文件。

---

# 15. 什麼情況通常不用更新 Knowledge Base

通常不需要：

```text
純 CSS
顏色
字級
間距
小型 RWD
文案
不影響資料邏輯的版面調整
```

但仍需完成 Impact Check，並在交付中寫：

```text
Knowledge Base Impact Check：
本次不需更新。
```

---

# 16. 什麼情況一定要考慮更新

```text
新增 / 移除 major View
新增 Cloud Function
新增 / 修改 collection
修改 document schema
修改 Summary source priority
修改 fallback
修改 Store Identity
修改 role / permission
修改 device / security
修改 Telegram model / tool / policy / schedule / task
修改部署方式
修改 maintenance repair architecture
```

---

# 17. CURRENT_STATE.md

`CURRENT_STATE.md` 用來回答：

> 「目前正式環境到底到哪一版？」

它不等於 CHANGELOG。

部署完成後應更新：

```text
Production source snapshot
Frontend app version
Git commit（若可確認）
Production tag（若有）
Backend deployment
Frontend deployment
Validation results
Pending changes
Known issues
```

如果某欄位無法確認：

```text
未由目前正式來源確認
```

不要猜。

---

# 18. 驗證指令

一般前端：

```bash
npm run build
```

Store Identity：

```bash
node --test tests/storeIdentity.test.js
```

一般 Backend entry：

```bash
node --check functions/index.js
```

Device Security Backend：

```bash
node --check functions/deviceApproval.js
node --test tests/deviceApproval.test.js
```

若目前套件有最高管理者通知專項測試：

```bash
node --test tests/superAdminDeviceNotice.test.js
```

Telegram prompt：

```bash
node --check functions/telegram/prompts.js
```

依本次改動範圍決定實際要跑哪些，但不可跳過保護該模組的 syntax／build／regression test。

# 19. 部署原則

不要因為改 frontend 就自動 deploy 所有 backend。

不要因為改 backend 就自動 deploy frontend。

依本次真正修改範圍：

```text
Frontend changed?
Backend changed?
Rules changed?
Docs only?
```

決定部署內容。

Docs-only：

```text
不需要 Firebase / frontend runtime deploy
```

只需 Git version control。

---

# 20. 新對話建議開場

使用者可以直接告訴新的 AI：

```text
這是我目前正式使用中的 SaaS 專案。

開始任何修改前，先閱讀：
AI_START_HERE.md
CURRENT_STATE.md

再按照 AI_START_HERE.md 指定的順序閱讀 Project Knowledge Base。

重要：
1. 不可使用舊對話記憶中的程式版本直接修改。
2. 要修改什麼檔案，由我提供目前正式部署版本。
3. Knowledge Base 與正式 source 衝突時，以正式 source 為準。
4. 修改完成後必須做 Knowledge Base Impact Check。
5. 未確認資料層根因前，不做 page-level workaround。

先理解目前架構，再開始本次需求。
```

---

# 21. 接手成功的判斷

新的 AI / 工程師如果真的理解本專案，
應該可以回答：

```text
CYJ 與其他品牌 Firestore path 有何不同？
當月 Dashboard 與歷史月份資料來源有何不同？
Summary 什麼狀態才可信？
recalc_queue 是主流程還是 fallback？
CYJ 新店 canonical 是什麼？
店家 KPI 與管理師 KPI 的 Source Authority 是什麼？
SystemMaintenance 哪些是 Audit、哪些可能改資料？
登入 log 與 device check 的順序為何？
修改完成後為什麼還要做 Knowledge Base Impact Check？
```

若這些都不清楚，不應直接進入大範圍程式修改。
