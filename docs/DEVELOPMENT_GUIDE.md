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

# 6.5 Canonical KPI Contracts / Validity Semantics

Formal KPI 公式與 validity 不得再由各頁面、Summary Writer、Telegram 或 Annual 各自定義。

Batch 2 的正式 contract owner：

```text
Frontend
src/utils/kpiContracts.js

Backend
functions/kpiContracts.js

Parity / Regression
tests/kpiContracts.test.js
```

目前 Frontend 是 ESM，`functions/` 是 Node 22 CommonJS，因此採：

```text
Frontend pure contract
+
Backend pure contract mirror
+
parity regression
```

任何一端修改 formal KPI contract，都必須同步另一端並讓 parity regression 通過；禁止只有 Frontend 或只有 Backend 偷改公式。

目前正式核心 contract 至少包括：

```text
formalNetCash = cash - refund - skincareRefund

formalAccrual
  CYJ / 伊啵 → accrual
  安妞       → operationalAccrual

VALID_ZERO != FIELD_MISSING != DATA_INVALID
blank / null / 0 base target => TARGET_NOT_SET
ratio denominator = 0 => N/A
```

特別注意：

`helpers.js` 的 `parseNumber()` 是一般 parsing utility，空值會得到 `0`。因此它**不能單獨作為 Target 是否已設定的 business authority**。Target Writer / Coverage 必須透過 formal target validity contract 判斷。

Batch 2 contract module 本身不得：

- 直接讀寫 Firestore；
- 新增 listener / polling；
- import UI component；
- 為了兼容 consumer 而偷偷改變 raw value。

修改 contract 最低驗證：

```bash
node --check src/utils/kpiContracts.js
npx -y node@22 --check functions/kpiContracts.js
node --test tests/kpiContracts.test.js
npm run build
```

若正式 consumer 開始 import contract，還要再跑該 consumer 所屬 Batch 的 regression，並依實際改動精準部署。


# 6.6 Target Writer / KPI Settings / Coverage Authority

Batch 3 把 Target authority 分成三層：

```text
Raw target writer
  src/components/TargetView.jsx
        ↓
monthly_targets
        ↓ Firestore onWrite
Derived target authority
  functions/targetCoverage.js
        ↓
monthly_targets_summary
        ↑
Lifecycle monthly cohort
  src/utils/storeLifecycle.js
  functions/storeLifecycle.js
```

## Store Target Writer rules

必須使用 canonical KPI target validity：

```text
blank / missing / 0 base target
→ TARGET_NOT_SET
→ raw monthly_targets 不保留 numeric 0 欄位

valid base target
→ > 0

challenge blank / 0
→ CHALLENGE_NOT_SET

challenge configured
→ 必須 > 同類型 base target
```

禁止重新使用：

```js
parseNumber("") === 0
```

來判斷「目標已設定」。`parseNumber()` 仍只是一個一般 UI parsing helper。

TargetView 只寫有實際異動的月份，不應在按一次「儲存」時重寫未修改 12 個月份。

## Derived Target Summary rules

`monthly_targets_summary` 是 Derived Data，Batch 3 起正常 writer authority 在：

```text
functions/targetCoverage.js
```

Frontend 不直接寫這份 Summary。

Coverage 必須：

- 以 `store_lifecycle/master` 且 `datasetStatus=READY` 的 monthly eligible cohort 為分母；
- Cash / Accrual 獨立；
- 保留 `cashMissingStores` / `accrualMissingStores`；
- Lifecycle 未 READY 不得標 complete；
- 舊 Summary writer 改 target map 時重新套用 coverage metadata；
- derived writer 必須有 recursion guard；
- target map 變更時必須同步重算既有相容 `storeCount / cashTargetTotal / accrualTargetTotal`，不可留下 stale totals 給尚未切換 consumer；
- 正常 Target event 不得 full-scan `monthly_targets` collection；
- 不新增 polling / Dashboard broad listener。

Lifecycle eligibility 規則不得在 `targetCoverage.js` 另寫 first/last/exempt 判斷；正式 runtime 必須呼叫 `functions/storeLifecycle.js` owner。

Challenge aggregate 必須逐 eligible store 處理：合法 challenge 優先，未設定 challenge 才回退 base target；若存在已設定但非法的 challenge，不可靜默 fallback。未知品牌也不可 fallback 到 CYJ physical path。

## Existing invalid target data

Batch 3 不批次修歷史 Raw。Derived `targetAudit` 只報告：

```text
base target = 0
invalid base target
challenge without valid base
challenge <= base
```

有歧義的既有設定需人工確認後才修。

## KPI Settings rules

`kpi_targets` 繼續使用既有單一 Settings doc listener。

```text
newASP
  > 0                 valid
  blank / missing / 0 未設定
```

不得把 `3500` hardcoded fallback 存成 authority。

Store Health benchmark：

```text
min finite && min > 0
max finite && max > min
storage = decimal ratio
```

兩者都空白代表該 benchmark 未設定；只有一端空白或 range invalid 必須阻止寫入。

Settings 更新 benchmark 時只改目前品牌 field path，不能用整份 map overwrite 偷改其他品牌。

## App propagation

Settings 寫入 `benchmarks` 後，App 既有 `kpi_targets` 1-doc listener 必須把它帶入 runtime `targets` state；不可要求 StoreAnalysis / Dashboard 各自再補 hardcoded benchmark。

## Batch 3 minimum regression

```bash
node --test tests/kpiContracts.test.js
node --test tests/storeIdentity.test.js
node --test tests/storeLifecycle.test.js
node --test tests/targetAuthority.test.js

node --check functions/targetCoverage.js
node --check functions/storeLifecycle.js
node --check functions/index.js
npm run build
```

若只完成 isolated regression 而未在最新正式 repo 執行 `npm run build`，不可標記 FULL BUILD PASS。

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

不要把 Frontend role 當成 Firestore server-verified role。

目前 Rules 仍以：

```text
request.auth != null
```

作為 signed-in 基礎。

修改敏感 Device Security 前一起讀：

```text
src/App.jsx
src/components/LoginView.jsx
src/components/DeviceApprovalGate.jsx
src/components/DeviceApprovalPanel.jsx
src/components/SystemMonitor.jsx
src/components/TelegramAlertControlCenter.jsx
functions/deviceApproval.js
functions/index.js
firestore.rules
docs/AUTH_AND_SECURITY.md
```

強制規則：

- 不可重新套用舊「前 N 台裝置 auto trust」架構；
- `account_devices`、approval request、inbox、summary、login security state 都要維持品牌隔離；
- self approval 與最高管理者人工覆核必須分開；
- 最高管理者前端資格不等於 Backend 授權，Backend 要重新驗證 actor；
- 能用小型 summary／單筆 realtime listener 就不要加 polling；
- 多最高管理者同時處理同一 request 時，要保留 first-resolver-wins；
- Security UI 應共用既有 review endpoint，不另造第二套核准引擎。

# 11. System Logs

`system_logs`：

```text
create/read allowed after sign-in
update/delete denied
```

不要用「直接修改既有 log」的方式做後台功能。

# 12. Telegram

修改前先分清楚是哪一條 Telegram pipeline。

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
functions/deviceApproval.js Security Event
→ security_alerts
→ functions/index.js Firestore trigger
→ telegram_security_alerts config
→ Telegram API
```

除非產品需求真的需要，登入安全 pipeline 不應額外加入 Gemini／KPI tool／大量資料讀取。

Security Alert 要保留 cooldown／false-positive guard，也不可把 password、secret、token 寫進通知 payload。

# 13. Gemini 模型

目前正式 backend：

```text
Primary  = gemini-3.7-flash
Fallback = gemini-3.6-flash
```

模型/API 版本不是一般 UI 修正的一部分。

除非需求明確是 Agent model migration，否則不要順便更換。

# 14. Regression Test

Regression Test 是架構的一部分，不是可省略的附加項目。

例如：

```bash
node --test tests/storeIdentity.test.js
node --test tests/deviceApproval.test.js
```

若目前套件包含：

```bash
node --test tests/superAdminDeviceNotice.test.js
```

Device Security 修改也要跑：

```bash
node --check functions/deviceApproval.js
npm run build
```

新功能能運作，不代表舊 Security path 沒被破壞；應一起做 regression。

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

Store Identity / Lifecycle / Target Authority：

```bash
node --test tests/storeIdentity.test.js
node --test tests/storeLifecycle.test.js
node --test tests/kpiContracts.test.js
node --test tests/targetAuthority.test.js
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

新的 AI 或工程師開始前，固定先讀：

```text
PROJECT_OPERATING_RULES.md
→ AI_START_HERE.md
→ CURRENT_STATE.md
→ README.md
→ ARCHITECTURE.md
→ DEVELOPMENT_GUIDE.md
→ SYSTEM_SOURCE_MAP.md
```

如果是新對話，可先貼：

```text
prompts/01_NEW_CHAT_BOOTSTRAP.md
```

若對方無法讀 repository，
由使用者先提供上述文件，再依本次修改範圍提供目前正式 source。

不得要求使用者重新口述整段專案歷史，
也不得用 AI 記憶取代目前正式 source。


# 21. Prompt Anchoring

開發紀律不得依賴單一對話記憶。

永久規則：

```text
PROJECT_OPERATING_RULES.md
```

情境式重新定錨：

```text
prompts/
```

Context Limit 前必須先產生 Session Checkpoint，再換視窗。
若外部人員／AI 修改過 source，先做 External Change Audit，再繼續開發。


# 22. Summary Writer Semantic Contract — Batch 4

歷史 Summary 的 formal KPI 不得再由 Backend 與 Maintenance 各自寫公式。

Owner：

```text
Frontend ESM    src/utils/summarySemantics.js
Backend CJS     functions/summarySemantics.js
Parity test     tests/summarySemantics.test.js
```

兩端只能透過既有 canonical KPI contracts 定義：

```text
formalNetCash
formalAccrual
validBaseTarget
validRatio
```

## Additive migration

Batch 4 必須保留 legacy field semantic，不可把 `cash` 或 `accrual` 原地換意思：

```text
legacy fields retained
+
summary-semantics-v1 explicit fields/status
```

安妞必須同時保留 `totalAccrual` 與 `formalAccrual=operationalAccrual`。

## Target Coverage / Lifecycle

Historical Summary scope target authority 必須來自：

```text
monthly_targets_summary/{YYYY-MM}
+
store_lifecycle/master READY cohort
```

Cash / Accrual coverage 獨立。合法 incomplete coverage 必須輸出 `TARGET_INCOMPLETE` / null achievement，不得為了得到數字而 full-scan raw target 或縮小 denominator。

若 Target Summary 缺失或根本沒有 `target-coverage-v1` metadata，才允許 compatibility raw fallback；fallback 是 authority/schema recovery，不是 incomplete business-state recovery。

## Ranking

Legacy ranking 暫留。Formal ranking：

```text
formalNetCash / valid cashTarget
```

只有 valid target + valid KPI + Lifecycle eligible Store 進 rank denominator；true zero / negative net cash 仍 eligible。

## Trust compare

禁止：

```text
freshPayload vs freshPayload
```

正確：

```text
write 3 Summary docs
→ read persisted dashboard / therapist / rankings
→ compare against Raw-calculated payload
```

Compare 要覆蓋 store-level semantics 與 formal ranking signature，避免 grand total 一樣但 store distribution 不一致仍被 verified。

## Document-size guard

不要把每個 formal field 複製到每店×每日 `storeDailyTotals`。Batch 4 只在 store / grand / top-level 建 authority；daily semantic expansion 要有獨立 document-size / consumer need 評估。

## Minimum Batch 4 validation

```bash
node --check functions/index.js
node --check functions/summarySemantics.js
node --check src/utils/summarySemantics.js

node --test tests/kpiContracts.test.js
node --test tests/storeIdentity.test.js
node --test tests/storeLifecycle.test.js
node --test tests/targetAuthority.test.js
node --test tests/summaryRepairPreSystem.test.js
node --test tests/summarySemantics.test.js

npm run build
```

只有完整正式 repo 執行過的 checks 才能標 PASS。

部署後先選代表 historical months 做 Raw → rebuilt Summary compare，再擴大 rebuild；不得直接全歷史批量重建。

# 23. Historical Target Coverage Migration Contract — Pre-Batch-5

2026-08-29 已完成 Historical Target Coverage Gate。未來若再處理 legacy `monthly_targets_summary`，必須沿用這次建立的 Audit-first / metadata-only 原則，不得直接寫補丁。

## Owner chain

```text
functions/targetCoverage.js
  → Target Coverage path / target-map / coverage authority

functions/storeLifecycle.js
  → monthly eligible Store cohort

functions/targetCoverageAudit.js
  → historical safety classification

functions/targetCoverageMigration.js
  → atomic metadata-only migration

functions/deviceApproval.js
  → high-privilege request auth / highest-admin verification

functions/index.js
  → HTTP exports

src/components/SystemMaintenance.jsx
  → operator UI only
```

UI 不得複製 Backend classification 或自行決定某月份可寫。

## Audit-first

先執行：

```text
auditHistoricalTargetCoverage
```

只允許讀：

```text
monthly_targets_summary
store_lifecycle/master
```

Phase A 不得掃 Raw `monthly_targets`，也不得有 writes。

只有：

```text
SUMMARY_BACKFILL_SAFE
```

可以成為 Phase B candidate。以下狀態必須 fail-closed：

```text
RAW_RECONSTRUCTION_REQUIRED
LIFECYCLE_NOT_READY
PRE_SYSTEM_SKIP
SUMMARY_DOCUMENT_MISSING
```

## Atomic revalidation

Phase B 不得相信幾分鐘前的 Audit snapshot。

正確：

```text
begin brand-scoped transaction
→ read current Lifecycle
→ read all requested Summary docs
→ reclassify all months
→ if any blocked: 0 Writes
→ otherwise merge metadata
```

Firestore 因 concurrent change retry transaction 時，全部 read / classification 必須重新執行。不要用 page state、client timestamp 或先前 Audit token 代替資料 reread。

## Metadata-only boundary

允許寫 Coverage contract metadata；禁止改：

```text
target map
storeCount
targetCount
sourceDocCount
cashTargetTotal
accrualTargetTotal
```

若 historical Summary 本身 totals / counts / map 不一致，該問題屬 Raw reconstruction / upstream repair，不能由 metadata migration 掩蓋。

## Persisted verification

Transaction 成功不等於 migration 已驗證。

必須：

```text
write
→ read persisted written Summary docs
→ compare expected Coverage metadata
→ compare pre/post legacy target snapshot
```

只有全部通過才可回報 `allVerified=true`。

## Brand isolation

Path 必須由 Target Coverage resolver 取得：

```text
CYJ
artifacts/default-app-id/public/data/{collection}

安妞 / 伊啵
brands/{brandId}/{collection}
```

禁止自行在 migration code 拼接另一套 brand path。

## Reads discipline

Historical migration 不得新增 listener / polling。

正常 Phase A：

```text
1 Lifecycle master
+ scoped historical monthly_targets_summary query
+ security point reads
```

正常 Phase B：

```text
security point reads
+ 1 Lifecycle master
+ N requested Summary docs
+ N-written persisted verification reads
```

Transaction retry 可增加 reads；Raw `monthly_targets` reads 必須維持 0。

## Regression minimum

修改 Audit / Migration / Target Coverage / Lifecycle 時，至少覆蓋：

```bash
node --check functions/index.js
node --check functions/targetCoverageAudit.js
node --check functions/targetCoverageMigration.js

node --test tests/kpiContracts.test.js tests/storeIdentity.test.js tests/storeLifecycle.test.js tests/targetAuthority.test.js tests/summaryRepairPreSystem.test.js tests/summarySemantics.test.js tests/targetCoverageAudit.test.js tests/targetCoverageMigration.test.js

npm run build
```

只有正式 repo 實跑結果才能標 PASS。2026-08-29 Phase B closeout 的正式結果為：

```text
105 / 105 tests PASS
npm run build PASS
```

## Current production boundary

截至 2026-08-29：

```text
CYJ   2026-01～07 → target-coverage-v1
安妞  2026-01～07 → target-coverage-v1
伊啵  2026-01～03 → pre-system skip
伊啵  2026-04～07 → target-coverage-v1
```

這只代表已處理的 historical cohort 已收斂，不代表未來 consumer 可以移除 Coverage fail-closed guard。

`CURRENT_APP_VERSION` 仍為 `3.5.3`，本次 migration 沒有提高版本。
# 24. Historical Dashboard Formal Consumer Contract — Batch 5A-1

Batch 5A-1 已於 2026-08-29 Production Confirmed。後續修改 historical Dashboard 時，Formal semantics 必須由共用 consumer authority 處理，不可在單一 View 再自行拼公式。

## Owner chain

```text
dashboard_summary/{YYYY-MM}
  → Summary writer persisted Formal contract

src/utils/dashboardFormalConsumer.js
  → historical Formal value / status / target / ranking interpretation

src/hooks/useDashboardStats.js
  → brand / manager / store scope aggregation

src/components/StorePerformanceView.jsx
  → historical Formal ranking display
```

## Historical / current-month boundary

只有符合既有 verified historical Summary trust gate 的月份才能走 Formal Summary consumer。

```text
historical + verified Summary
→ Formal consumer

current month
→ 保留既有 live/detail flow
```

不得為了共用程式而把 current-month raw/detail flow 強制改成 Historical Summary semantics。

## Formal field authority

Historical verified Dashboard：

```text
cash
  = formalNetCash

accrual
  = formalAccrual

base cash target
  = formalCashTarget

base accrual target
  = formalAccrualTarget
```

品牌差異由 writer persisted contract 決定：

```text
CYJ formalNetCash
  = gross cash - general refund - skincare refund

CYJ / 伊啵 formalAccrual
  = accrual

安妞 formalAccrual
  = operationalAccrual
```

Frontend 不得重新推導安妞 operational accrual，也不得忽略 CYJ skincare refund。

## Validity / Coverage

Formal status 是資料 contract 的一部分，不只是 UI 樣式。

```text
VALID / VALID_ZERO
→ 可顯示與計算

FIELD_MISSING / DATA_INVALID
→ fail-closed
→ 不得轉成 0
```

Target Coverage：

```text
coverage complete
→ 可計算 achievement

coverage incomplete / unavailable
→ TARGET_INCOMPLETE / N/A
→ denominator 不得只加總「有目標的店」
```

## Scope-aware aggregation

全品牌、區長與單店 historical filter 必須使用同一套 Lifecycle / Formal target / Formal metric authority。

```text
selected eligible stores
→ aggregate Formal store rows
→ aggregate Formal target authority
→ calculate scope achievement
```

不可用全品牌 grand total 乘比例估算區長／單店，也不可讓 Lifecycle 非 eligible 店進 formal ranking denominator。

## Ranking

歷史門市排名 authority：

```text
formalStoreRankings
formalRankEligibleStoreCount
```

不得在 consumer 回退到 legacy `storeRankings` 後仍標示為 Formal ranking。

## Challenge Target boundary

Batch 5A-1 沒有新增 persisted：

```text
formalChallengeCashTarget
formalChallengeAccrualTarget
formalChallengeAchievement
```

因此既有：

```text
challengeCashTarget
challengeAccrualTarget
```

仍是 compatibility layer。若未來要 canonicalize Challenge Target，必須先從 writer / KPI contract upstream 擴充，禁止 Dashboard-only workaround。

## Historical Dashboard reads contract（Batch 5A-2）

Batch 5A-2 已完成 verified historical Store Dashboard 的 reads cutover。後續維護不得退回「Summary 已 verified 仍整月抓 Raw」的舊模式。

正式 read policy owner：

```text
src/utils/dashboardReadPolicy.js
```

核心狀態：

```text
CURRENT_LIVE
LOADING
SUMMARY_TRUSTED
DETAIL_FALLBACK
DIRTY_REFRESH
```

規則：

```text
current month
→ 維持 live/detail flow

historical + trust state loading
→ 先等 Summary / flag，不搶先 getDocs(daily_reports)

historical + verified Formal Summary
→ 不讀整月 daily_reports
→ 不做 raw monthly_targets fallback

dirty / missing / unverified / trust error
→ 允許一次 detail fallback
→ repair / verified 後回到 Summary-first
```

禁止用「有 summary document」單一 boolean 直接關 Raw；必須同時尊重 brand、yearMonth、verification / dirty state，避免 stale trust state 或跨品牌誤用。

正常 historical Store Dashboard 不應再使用：

```text
recalc_queue status=pending limit 500
maintenance_logs month query limit 120
hook 內重複 dashboard_summary / rankings_summary / summary_recalc_flags listeners
```

若未來重新新增 listener / query，必須先做 reads impact；優先 single-document、event-driven、small scoped authority，不以 polling 或 large resident query 取代 `summary_recalc_flags/{yearMonth}`。

Production read tracker 的 2026-08-29 驗證只證明高成本 historical sources 未被觸發，不可寫成「整個 Dashboard 只有 1 read」。

## Regression minimum

修改 Historical Formal Dashboard consumer 時，至少覆蓋：

```bash
node --check src/utils/dashboardFormalConsumer.js
node --check src/hooks/useDashboardStats.js

node --test tests/kpiContracts.test.js tests/storeIdentity.test.js tests/storeLifecycle.test.js tests/targetAuthority.test.js tests/summaryRepairPreSystem.test.js tests/summarySemantics.test.js tests/targetCoverageAudit.test.js tests/targetCoverageMigration.test.js tests/dashboardFormalConsumer.test.js

npm run build
```

並做 Production smoke / semantic validation：

```text
CYJ：選有 skincare refund 的 historical month
安妞：選 formalAccrual != totalAccrual 的 historical month
伊啵：正式系統起始月之後 historical month
manager scope
single-store scope
formal store ranking
current-month regression
```

2026-08-29 Batch 5A-1 closeout 的正式結果：

```text
115 / 115 tests PASS
npm run build PASS
Frontend Published
Production validation PASS
CURRENT_APP_VERSION = 3.5.3
```

## Batch 5A-2 regression minimum

修改 Historical Dashboard read policy / Summary trust / raw fallback 時，至少覆蓋：

```bash
node --check src/hooks/useDashboardStats.js
node --check src/utils/dashboardReadPolicy.js

node --test tests/kpiContracts.test.js tests/storeIdentity.test.js tests/storeLifecycle.test.js tests/targetAuthority.test.js tests/summaryRepairPreSystem.test.js tests/summarySemantics.test.js tests/targetCoverageAudit.test.js tests/targetCoverageMigration.test.js tests/dashboardFormalConsumer.test.js tests/dashboardHistoricalReads.test.js

npm run build
```

Production regression 至少確認：

```text
CYJ / 安妞 / 伊啵 verified historical Dashboard
manager filter
single-store filter
Store Performance
current-month live/detail
normal verified historical read tracker
```

正常 verified historical read tracker 應沒有：

```text
historical daily_reports full-month load
raw monthly_targets fallback
recalc_queue large query
maintenance_logs query
```

dirty / unverified case 若出現一次 detail fallback 是 correctness behavior，不應誤判為 regression。

2026-08-29 Batch 5A-2 closeout：

```text
127 / 127 tests PASS
npm run build PASS
Frontend Published
Production regression PASS
historical high-cost raw sources not observed
CURRENT_APP_VERSION = 3.5.3
```
# 25. Regional / Ranking Formal Consumer Contract — Batch 5B-1

Batch 5B-1 已於 2026-08-29 Production Confirmed。後續維護 `RegionalView` / `RankingView` 時，不得重新在 View 內用 legacy `cash / refund / accrual / budget` 拼出一套與 Summary writer 不同的 KPI semantics。

## Regional historical contract

verified historical Regional 應由共用 consumer authority解讀：

```text
Lifecycle eligible stores
+
formalNetCash
formalAccrual
formalCashTarget / formalCashAchievement
formalAccrualTarget / formalAccrualAchievement
Target Coverage v1
```

scope aggregation 規則：

```text
selected eligible store rows
→ aggregate Formal actuals
→ aggregate Formal target authority
→ coverage complete 才計算 achievement
```

若 selected scope coverage incomplete：

```text
achievement = N/A / TARGET_INCOMPLETE semantics
```

禁止只加總有 target 的店後繼續算百分比。

## Ranking historical contract

Historical verified Ranking authority：

```text
formalStoreRankings
formalRankEligibleStoreCount
```

Ranking View 不得把 legacy store cash / target 前端重算後仍稱為 Formal ranking。

必須保留：

```text
Lifecycle eligibility
missing / invalid status semantics
Formal target validity / coverage
Formal cash achievement rank authority
```

既有明確 ranking exclusion 設定可作 operational / presentation filter；若套用 exclusion 後重新編號 display rank，不得覆寫或偽造 persisted Formal rank authority。

## Read policy

Batch 5A-2 的 historical read policy適用於 Dashboard / Ranking / Regional：

```text
verified historical
→ Summary-first
→ normal daily_reports full-month load = 0

trust loading
→ 先等 Summary / flags，不搶先讀 Raw

dirty / missing / unverified / incompatible contract
→ detail fallback allowed

current month
→ existing live/detail flow
```

新增 Regional / Ranking consumer 不得重新掛大型常駐 query，也不得重新引入 `recalc_queue` / `maintenance_logs` 作 normal historical trust authority。

## Regression minimum

修改 Regional / Ranking Formal consumer 時至少覆蓋：

```bash
node --check src/utils/reportFormalConsumer.js

node --test tests/kpiContracts.test.js tests/storeIdentity.test.js tests/storeLifecycle.test.js tests/targetAuthority.test.js tests/summaryRepairPreSystem.test.js tests/summarySemantics.test.js tests/targetCoverageAudit.test.js tests/targetCoverageMigration.test.js tests/dashboardFormalConsumer.test.js tests/dashboardHistoricalReads.test.js tests/reportFormalConsumer.test.js

npm run build
```

Production smoke 至少確認：

```text
CYJ historical Ranking / Regional
安妞 historical Ranking / Regional
伊啵 historical Ranking / Regional
不同區域／月份切換
current-month Ranking / Regional regression
normal verified historical read tracker
```

2026-08-29 Batch 5B-1 closeout：

```text
140 / 140 tests PASS
npm run build PASS
Frontend Published
Production regression PASS
historical high-cost raw sources not observed
CURRENT_APP_VERSION = 3.5.3
Runtime main = 5d3d370a9d4cb045f718020ddd390050a3d0b9aa
```

# 26. Annual Formal Consumer Contract — Batch 5B-2A

Batch 5B-2A 已於 2026-08-29 Production Confirmed。後續維護 `AnnualView` 時，不得重新以 legacy `grandTotal.cash / accrual / budget / accrualBudget` 或 store legacy fields 拼出 historical annual KPI。

## Historical month trust contract

Annual historical month 只有在下列條件全部成立時才可進 Formal mode：

```text
summary version = dashboard-summary-v2
semanticVersion = summary-semantics-v1
kpiContractVersion = kpi-contract-v1
brandId / yearMonth exact match
summary_recalc_flags verified/completed
dirty = false
mismatch = 0
pending = 0
```

沒有 flag、flag loading、dirty、mismatch、brand/month mismatch 或 incompatible contract 都不得自動視為 trusted。

## Formal annual semantics

Trusted historical month 使用：

```text
formalNetCash
formalAccrual
Target Coverage v1
Lifecycle eligibility
```

Annual scope（全品牌／manager／single-store／排除店）必須先建立 eligible store set，再 aggregate Formal actuals / targets。Coverage incomplete 時：

```text
achievement = N/A / TARGET_INCOMPLETE semantics
```

禁止用「有 target 的店」縮小 denominator 後繼續算達成率。Trusted historical month 不得 raw `monthly_targets` fallback；current-month / compatibility fallback 由既有 live contract處理。

## Yibo pre-system boundary

```text
Yibo 2026-01 ~ 2026-03 = PRE_SYSTEM_SKIP
Yibo 2026-04 起 = 正式年度計算範圍
```

Pre-system month 不得進實績、目標或 interval / quarter / annual denominator。

## Annual audit exclusion contract

設定排除店家時，排除必須同時作用於：

```text
Cash actual
Accrual actual
Cash target
Accrual target
```

存在排除店家時，不可直接採用未扣除排除店的 all-brand `grandTotal`；必須由 Formal store rows 依 eligible + exclusion scope 重算。

寫入 exclusion 的 state contract：

```text
Firestore setDoc success
→ confirm same brand
→ update AppContext auditExclusions immediately
→ Annual recomputes without page reload
```

若 write failure：

```text
do not close modal
do not show success
show failure state
```

不得用 reload / forced refetch / polling 修補 state sync。此次修正新增 Firestore reads = 0。

## Regression minimum

後續修改 Annual Formal semantics / exclusion state 時至少執行：

```bash
node --test tests/kpiContracts.test.js tests/storeIdentity.test.js tests/storeLifecycle.test.js tests/targetAuthority.test.js tests/summaryRepairPreSystem.test.js tests/summarySemantics.test.js tests/targetCoverageAudit.test.js tests/targetCoverageMigration.test.js tests/dashboardFormalConsumer.test.js tests/dashboardHistoricalReads.test.js tests/reportFormalConsumer.test.js tests/annualFormalConsumer.test.js

npm run build
```

2026-08-29 Batch 5B-2A closeout：

```text
Initial regression 156 / 156 PASS
Exclusion fix regression 158 / 158 PASS
npm run build PASS
Frontend Published
Production Annual semantics PASS
Exclusion immediate recalc / restore PASS
Brand isolation regression PASS
CURRENT_APP_VERSION = 3.5.3
Runtime main = d0a231ca5a816b2a5ef42e2b6e38690dfc1656df
```

## Batch 5B-2B boundary

Batch 5B-2A 只完成 Annual semantics / state correctness。Batch 5B-2B 才處理 reads topology，例如 year-scoped Summary / flag query、current-month aggregate scope、移除未使用 annual listeners。5B-2B 不得藉 reads optimization 改變本節已確認的 KPI、Coverage、Lifecycle、pre-system 或 exclusion semantics。
