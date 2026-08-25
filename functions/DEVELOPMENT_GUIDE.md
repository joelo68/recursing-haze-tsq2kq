# DEVELOPMENT_GUIDE.md

> 目的：讓未來工程師或 AI 在修改正式系統前，先理解「不能破壞的架構規則」。

# 1. Source of Truth

開發時的優先順序：

```text
目前正式部署程式
    ↓
Project Knowledge Base
    ↓
Regression Tests
    ↓
Git History
    ↓
舊對話／記憶（不可作為唯一依據）
```

如果 Knowledge Base 與正式程式衝突：

> 先停止推測，確認正式 source，再更新文件。

# 2. 禁止「看到哪頁壞就補哪頁」

當資料抓不到、數字不同、店名不一致時：

1. 先確認 collection。
2. 確認 Raw Source。
3. 確認 derived data（Summary / aggregate）。
4. 確認 identity / normalization。
5. 確認 writer。
6. 確認 read resolver。
7. 最後才修改頁面。

尤其 CYJ 新店問題必須先讀：

```text
DATA_IDENTITY_RULES.md
tests/storeIdentity.test.js
```

# 3. Store Identity

CYJ 新店：

```text
coreStoreName      = 新店
canonicalStoreName = CYJ新店店
```

禁止：

```js
if (storeName === "新店") {
  // 在某一頁臨時改資料來源
}
```

來掩蓋資料身份問題。

也禁止未確認語意就直接：

```js
storeName.replace(/店$/, "")
```

因為「新店」的「店」是地名本體的一部分。

變更 Store Identity 前至少：

```bash
node --test tests/storeIdentity.test.js
npm run build
```

若 backend 有改：

```bash
node --check functions/index.js
```

# 4. 三品牌 path

不得把 CYJ 和安妞／伊啵當成完全相同 Firestore root。

優先使用：

```js
getCollectionPath()
getDocPath()
```

CYJ：

```text
artifacts/{appId}/public/data
```

安妞／伊啵：

```text
brands/{brandId}
```

若功能故意固定 legacy root，必須在程式與文件明確註記原因。

# 5. Dashboard 修改規則

修改 Dashboard 前先讀：

```text
App.jsx
DashboardView.jsx
useDashboardStats.js
DashboardHeader.jsx
StorePerformanceView.jsx
TherapistPerformanceView.jsx
```

碰 historical Summary 再讀：

```text
functions/index.js
SystemMaintenance.jsx
```

不要只改 `DashboardView.jsx` 就假設改到資料邏輯；它主要是 view composer。

# 6. Summary / Aggregate

Derived data 出現錯誤時：

```text
Raw source
  ↓
normalization
  ↓
aggregation
  ↓
Summary
```

優先查上游。

不要：

- 看到兩份 aggregate 就直接相加
- 看到兩份 target 就挑較新的
- 為了修 derived data 批次改歷史 Raw

Store Identity 文件已明確規定 CYJ 新店的歷史 raw 保留策略。

# 7. InputView

`InputView.jsx` 目前設計原則：

> 前端只負責正式日報寫入與本機草稿；Summary dirty / recalc_queue 由後端 onWrite 統一建立。

因此不要重新在 InputView 裡大量加入 Summary queue 寫入，除非先確認 backend architecture 已改變。

# 8. Firestore Reads

`App.jsx` 已有 view-based load throttling。

修改資料監聽時，先確認：

```text
ANNUAL_DATA_VIEWS
MONTHLY_REPORT_DATA_VIEWS
MONTHLY_DAILY_REPORT_DATA_VIEWS
MONTHLY_THERAPIST_REPORT_DATA_VIEWS
```

禁止為了「確保有資料」就讓大型 collection 在所有頁面背景常駐監聽。

增加 Firestore query 前：

- 評估觸發頻率
- 評估每次 docs
- 使用最精準 scope
- 能單店 query 不撈整品牌
- 能單日 query 不撈整月
- 能 Summary 不應無條件回退大量 Raw

如需觀察 reads，使用：

```text
readTracker.js
SystemMaintenance → 流量監控
```

# 9. Delegation

Delegation 的 single resolver：

```text
delegationResolver.js
```

不要在各頁重新發明代理權限演算法。

正式組織：

```text
org_structure
store_account_data
```

代理：

```text
management_delegations
```

代理不能取得：

```text
editOrganization
```

Firestore Rules 也會阻止此權限為 true。

# 10. Security

不要把 UI role 當成 Firestore Rules 的 server-verified role。

目前 Rules 主要依：

```text
request.auth != null
```

而且程式註解明確指出身份架構仍是 anonymous / custom token hybrid。

修改敏感功能前同時讀：

```text
App.jsx
LoginView.jsx
SystemMonitor.jsx
firestore.rules
functions/index.js
```

# 11. System Logs

`system_logs`：

```text
create/read allowed after sign-in
update/delete denied
```

不要用「直接修改既有 log」的方式做後台功能。

# 12. Telegram

修改 Telegram 前至少讀：

```text
NotificationManager.jsx
TelegramAlertControlCenter.jsx
functions/index.js
functions/telegram/prompts.js
```

不要只改 prompt 就假設資料來源邏輯也改了。

不要只改 frontend alert config path；Functions 必須讀到相同 data root。

目前主動預警控制中心固定：

```text
artifacts/default-app-id/public/data
```

# 13. Gemini 模型

目前正式 backend：

```text
Primary  = gemini-3.7-flash
Fallback = gemini-3.6-flash
```

模型/API 版本不是一般 UI 修正的一部分。

除非需求明確是 Agent model migration，否則不要順便更換。

# 14. Regression Test

目前已正式存在：

```text
tests/storeIdentity.test.js
```

它不連 Firebase，也不改正式資料。

未來每新增一個「不能再被改壞」的架構保護，優先增加 regression test，而不是只寫註解。

# 15. 一次性修復工具

事故修復工具完成任務後：

```text
修復工具退場
Audit 留下
Preventive Guard 留下
Regression Test 留下
Knowledge Base 留下
```

不要讓一次性 mutation UI 永久留在正式維護中心。

# 16. 文件更新規則

以下情況應同步更新 Knowledge Base：

- collection / path 改變
- role / permission 改變
- Summary source priority 改變
- major Cloud Function 新增／移除
- Telegram model / tool / policy architecture 改變
- Store Identity 規則改變
- 部署方式改變
- Security architecture 改變

小型 UI 微調不必每次更新架構文件。

# 17. Secrets

Knowledge Base 不保存：

- API Key
- Telegram Bot Token
- Gemini Secret
- 密碼
- private credential

只記錄 secret 名稱與用途。

# 18. 修改後基本驗證

Frontend：

```bash
npm run build
```

Store Identity：

```bash
node --test tests/storeIdentity.test.js
```

Backend：

```bash
node --check functions/index.js
```

若修改 `functions/telegram/prompts.js`：

```bash
node --check functions/telegram/prompts.js
```

再依實際改動範圍部署。
# 19. 強制收尾：Knowledge Base Impact Check

每一次正式功能新增或修改完成後，都必須做一次 Knowledge Base Impact Check。

固定流程：

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
更新受影響文件
↓
更新 CURRENT_STATE.md
↓
Git / Deploy
↓
部署後驗證
```

交付時必須明確寫其中一種：

```text
Knowledge Base Impact Check：
本次不需更新。
```

或：

```text
Knowledge Base Impact Check：
需更新：
- docs/DATA_FLOW.md
- docs/FIREBASE_DATA_MODEL.md
```

不可省略這一步。

# 20. 新對話 / 新 AI 接手

新的 AI 或工程師開始前，第一份文件固定為：

```text
AI_START_HERE.md
```

接著：

```text
CURRENT_STATE.md
README.md
ARCHITECTURE.md
DEVELOPMENT_GUIDE.md
SYSTEM_SOURCE_MAP.md
```

若對方無法讀 repository，
由使用者先提供上述文件，再依本次修改範圍提供目前正式 source。

不得要求使用者重新口述整段專案歷史，
也不得用 AI 記憶取代目前正式 source。
