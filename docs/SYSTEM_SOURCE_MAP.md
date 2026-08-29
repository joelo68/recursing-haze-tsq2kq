# SYSTEM_SOURCE_MAP.md

> 狀態：Project Knowledge Base / Source Map v0.1
> 已整併至 2026-08-29。目前正式部署 source 仍是最高依據；`CURRENT_STATE.md` 會區分「已上線」與「已驗證待部署」。
> 禁止以舊對話、舊版檔案、AI 記憶或未提供的檔案補足事實。
> 無法由目前正式程式確認的內容，必須標記為「未由目前正式來源確認」。

---

# 1. 本文件的用途

`SYSTEM_SOURCE_MAP.md` 是整套 Project Knowledge Base 的「來源索引」。

它回答的不是「系統應該怎麼做」，而是：

- 現在正式系統有哪些主要模組？
- 每一項功能真正由哪些正式程式檔負責？
- 哪些資料來源、權限、Summary、Telegram、維護功能可以由哪支程式證明？
- 未來修改某功能前，應先閱讀哪些檔案？
- 哪些結論目前仍缺正式來源，不可以猜？

後續 `ARCHITECTURE.md`、`FIREBASE_DATA_MODEL.md`、`DASHBOARD_SUMMARY.md`、
`AUTH_AND_SECURITY.md` 等文件，都應以本 Source Map 為追溯入口。

---

# 2. 正式來源清單

## 2.1 專案／啟動／部署

- `package.json`
- `firebase.json`
- `src/main.jsx`
- `vite.config.js`
- `src/config/firebase.js`
- `firestore.rules`
- `functions/package.json`

目前正式來源中：

- 前端為 React + Vite。
- `src/main.jsx` 建立 React root 並載入 `App.jsx`。
- `vite.config.js` 使用 React plugin 與 `vite-plugin-pwa`。
- GitHub Pages base path 為 `/recursing-haze-tsq2kq/`。
- `package.json` 的正式前端 deploy script 使用 `gh-pages -d dist`。
- `firebase.json` 同時保留 Firestore Rules、Functions、Firebase Hosting 與 Emulator 設定。
- 目前正式來源未提供 `.firebaserc`。
- 目前正式來源未提供 `firestore.indexes.json`，且 `firebase.json` 的 Firestore 區段只明確指定 `firestore.rules`。
- 因此目前不可從專案來源宣稱 Firebase CLI project alias 或 Firestore composite indexes 已被 source control 管理。

---

# 3. 前端入口與 App Shell

## 3.1 啟動鏈

```text
src/main.jsx
  ↓
src/App.jsx
  ↓
AppContext.Provider
  ↓
Navigation / Shared UI / Feature Views
```

主要來源：

- `src/main.jsx`
- `src/App.jsx`
- `src/AppContext.js`
- `src/constants/index.js`
- `src/components/Navigation.jsx`
- `src/components/SharedUI.jsx`

## 3.2 App.jsx 的角色

目前正式 `App.jsx` 是前端主要 orchestration layer，包含：

- Firebase Auth 初始化後的登入狀態管理
- 品牌切換
- 使用者角色與帳號資料
- 動態資料路徑
- AppContext 組裝
- 多個 Firestore listener / query
- Summary / 月度資料載入
- 年度資料載入
- Security / Device 資料
- Delegation access
- 讀取節流
- 頁面 lazy loading
- Login / logout / activity log
- 功能旗標
- therapist module 啟閉

目前 lazy-loaded 主要 View：

- `DashboardView`
- `DailyView`
- `RegionalView`
- `RankingView`
- `StoreAnalysisView`
- `AuditView`
- `HistoryView`
- `InputView`
- `SystemMonitor`
- `SettingsView`
- `AnnualView`
- `TargetView`
- `TherapistTargetView`
- `TherapistScheduleView`
- `NotificationManager`

---

# 4. 品牌與資料路徑架構

正式品牌定義：

```text
cyj   → CYJ
anniu → 安妞
yibo  → 伊啵
```

目前正式系統存在兩套 Firestore data root：

## CYJ legacy path

```text
artifacts/{appId}/public/data/{collection}
```

Global settings：

```text
artifacts/{appId}/public/data/global_settings/{doc}
```

## 安妞 / 伊啵 standard path

```text
brands/{brandId}/{collection}
```

Settings：

```text
brands/{brandId}/settings/{doc}
```

主要來源：

- `src/constants/index.js`
- `src/App.jsx`
- `src/config/firebase.js`
- `firestore.rules`

重要維護原則：

> 修改 collection 路徑前，必須確認該功能是否透過 `getCollectionPath()` / `getDocPath()`；
> 不得把 CYJ legacy path 與新品牌 standard path 視為完全相同的實體路徑。

---

# 5. 共用核心模組

## 5.1 `src/utils/helpers.js`

目前負責：

- UUID
- 日期格式
- 數字格式／parse
- 下拉選單排序
- org_structure `managerOrder` 排序支援
- store / manager / therapist 排序
- 一般性 `normalizeStoreCoreName`

注意：

目前正式系統的 Store Identity normalization **尚未完全由 helpers 單一集中管理**。
部分模組仍存在自己的相容／特殊正規化規則。

因此：

> 不可在文件中宣稱「所有店名 normalization 已全部統一到 helpers.js」。

## 5.2 `src/utils/delegationResolver.js`

定位：

> 期間式代理與托管的單一判斷來源。

正式組織歸屬仍由：

- `org_structure`
- `store_account_data`

保存。

Delegation layer 只計算額外可管理範圍。

主要 default permissions：

- viewOperations
- editReports
- editHistory
- deleteReports
- receiveAlerts
- manageTasks
- editTargets
- editOrganization

其中 `editOrganization` default 為 false。

## 5.3 `src/utils/readTracker.js`

Firestore read tracking 模式：

```text
off
local
global
```

包含：

- localStorage read stats
- hourlyBuckets
- source docs / triggers
- global flush
- schedule status
- Firestore-safe field key

主要使用者：

- `App.jsx`
- `SystemMaintenance.jsx`
- `StoreAnalysisView.jsx`

---

## 5.4 Canonical KPI Contracts — Batch 2

Batch 2 已建立 formal KPI 的純函式 contract owner，但目前尚未切換任何正式 runtime consumer。

Owner：

```text
src/utils/kpiContracts.js
  → Frontend formal KPI / validity pure contract

functions/kpiContracts.js
  → Backend CommonJS mirror of the same pure contract

tests/kpiContracts.test.js
  → Frontend ↔ Backend parity + edge-semantics regression
```

目前 contract 固定的核心語意：

```text
formalNetCash = cash - refund - skincareRefund

formalAccrual
  CYJ / 伊啵 → accrual
  安妞       → operationalAccrual

VALID_ZERO != FIELD_MISSING != DATA_INVALID
base target: blank / null / 0 => TARGET_NOT_SET
ratio denominator = 0 => N/A
```

架構邊界：

- `src/utils/kpiContracts.js` 與 `functions/kpiContracts.js` 都是 pure module，不直接讀寫 Firestore。
- Root Frontend 為 ESM、`functions/` 為 Node 22 CommonJS，因此目前採「雙端 mirror + parity regression」，避免為了共用單一 runtime module 改變既有 module boundary。
- `src/utils/helpers.js` 的 `parseNumber()` 仍是一般 UI / 輸入 parsing 工具；它會把空值轉為 `0`，**不得**被當成 formal target validity authority。
- Dashboard、Summary Writer、Ranking、Annual、Telegram 等 consumer 在各自 Batch 切換前，現有 runtime 公式仍可能與 formal contract 不一致；不得把「contract 已建立」誤寫成「全系統已完成 KPI migration」。

Batch 2 建立 contract 本身：

```text
Firestore Reads      +0
Firestore Writes     +0
Persistent Listener  +0
Cloud Function export +0
```

---

# 6. UI 共用元件

## `SharedUI.jsx`

主要基礎元件：

- `ViewWrapper`
- `Card`
- `Skeleton`
- `Toast`
- `ConfirmModal`

## `SmartCalendar.jsx`

主要能力：

- 月份切換
- 日期選取
- min / max boundary
- 依 salesData + stores 判斷日報 complete / incomplete
- 相容字串 / Date 日期來源

## `SmartDatePicker.jsx`

使用 `SmartCalendar`，並依 viewport 提供：

- Desktop：portal 浮動 calendar
- Mobile：置中 modal calendar

被多個功能頁使用。

---

# 7. Navigation / Role / Menu

正式角色：

- director：高階主管
- trainer：教專
- manager：區長
- store：店經理
- therapist：管理師

主要選單：

- 營運總覽
- 每日分析
- 年度分析
- 年度設定
- 區域分析
- 單店分析
- 詳細報表
- 回報檢核
- 業績修正
- 日報輸入
- 登入監控
- 推播管理
- 管師目標
- 管師排休
- 管師帳號
- 系統設定

主要來源：

- `src/constants/index.js`
- `src/components/Navigation.jsx`
- `src/App.jsx`

Therapist module 可透過 feature flag 關閉，
Navigation 會同步移除相關 menu items。

---

# 8. Dashboard

入口：

```text
DashboardView.jsx
  ├─ DashboardHeader.jsx
  ├─ StorePerformanceView.jsx
  └─ TherapistPerformanceView.jsx
        ↑
  useDashboardStats.js
```

## `useDashboardStats.js`

為 Dashboard 主要計算與資料整合層。

目前正式來源可確認包含：

- Dashboard store / manager 篩選
- 排名區段判斷
- 月底 Projection
- annual KPI benchmark
- Summary 狀態
- target fallback
- store / therapist performance aggregation
- Firestore fallback read

## `DashboardHeader.jsx`

負責：

- store / manager filters
- delegated store 顯示
- store / therapist mode
- Dashboard Summary data source status

正式 Summary UI 至少區分：

- 本月即時明細
- 已整理 Summary
- 資料來源檢查中
- warning / fallback 狀態

## `StorePerformanceView.jsx`

店家營運 Dashboard 呈現層：

- store total
- target / achievement
- pace gap
- projection
- annual KPI benchmark
- ranking
- operational KPI cards

## `TherapistPerformanceView.jsx`

管理師績效呈現層：

- therapist targets
- KPI / achievement
- ranking
- store / therapist related performance visualization

---

# 9. 日報與歷史資料

## `InputView.jsx`

正式寫入來源：

- `daily_reports`
- `therapist_daily_reports`

目前前端註解明確指出：

> Summary dirty 與 recalc_queue 改由後端 Firestore onWrite 統一建立；
> 前端只負責正式日報寫入與本機草稿暫存。

## `DailyView.jsx`

用途：

- 單日店家 / 管理師日報查看
- 店家 / 區長篩選
- audit exclusion
- 單日精準 query
- therapist module mode

## `HistoryView.jsx`

用途：

- 日期區間歷史查詢
- 店家 / 管理師日報修正
- delete / update
- 分頁
- delegation edit access

## `AuditView.jsx`

用途：

- 回報檢核
- Taipei timezone
- daily audit cutoff
- 店家 / 管理師缺報與目標檢核
- audit exclusion

---

# 10. Target / Store Identity

## `TargetView.jsx`

主要資料：

- `monthly_targets`
- `recalc_queue`

`monthly_targets_summary` 自 Batch 3 起改由 Backend event-driven writer 維護，Frontend 不再直接寫 Derived Target Summary。

目前 Batch 3 source 已具有：

- canonical target store name
- canonical target document key
- legacy CYJ 新店 read fallback
- canonical write
- legacy key migration on write / unlock
- `validBaseTarget()` / `validChallengeTarget()` canonical validity
- blank / 0 base target → 未設定欄位，不再經 `parseNumber("")` 寫成 numeric 0
- challenge 有設定時必須 > 同類型 base target
- dirty-month scoped write，未修改月份不因「儲存全部」被重寫

## `DATA_IDENTITY_RULES.md`

正式治理規則：

```text
coreStoreName      = 新店
canonicalStoreName = CYJ新店店
```

legacy aliases 包括：

- CYJ新店
- CYJ新店店
- DRCYJ新店
- DRCYJ新店店

核心原則：

> Store Identity 是資料層規則，不是頁面顯示 workaround。

## `tests/storeIdentity.test.js`

Regression guard 不連 Firebase、不修改正式資料。

目前測試守住：

- CYJ 新店 aliases → core 新店
- CYJ 新店 canonical → CYJ新店店
- TargetView legacy read + canonical write
- backend target resolver guard
- backend monthly_aggregated canonical guard
- SystemMaintenance Audit Only
- governance 文件存在

## 現況提醒

正式程式仍存在多個模組局部 store normalization，例如：

- TargetView
- RegionalView
- RankingView
- InputView
- SettingsView
- TherapistManagerView
- delegationResolver
- helpers

因此現況應記載為：

> 「已有 Store Identity governance 與關鍵 canonical guards；
> 但前端各模組 normalization 尚未全面重構為單一共用 Store Identity module。」

---


## `functions/targetCoverage.js` — Batch 3

定位：

> Store Target Derived Summary / independent coverage 的 Backend authority。

責任：

```text
monthly_targets onWrite
  → canonical target row
  → Lifecycle READY monthly cohort
  → monthly_targets_summary/{yearMonth}

monthly_targets_summary onWrite
  → phased / legacy writer target-map change
  → coverage self-heal

store_lifecycle/master onWrite
  → only READY enter/leave or READY cohort change
  → low-frequency target-summary coverage refresh
```

正式 metadata：

```text
targetCoverageVersion
kpiContractVersion
lifecycleReady
eligibleStoreCount
cashConfiguredStoreCount
accrualConfiguredStoreCount
cashCoverageComplete
accrualCoverageComplete
cashMissingStores
accrualMissingStores
targetAudit
coverageSource
coverageUpdatedAtText
```

Compatibility fields are recomputed from the canonical target map on every derived update so old consumers do not retain stale totals:

```text
brandLabel
year / month
storeCount / targetCount
cashTargetTotal / accrualTargetTotal
sourceDocCount
```

Target Coverage runtime 必須引用 `functions/storeLifecycle.js` 的 monthly eligibility / identity owner，不得在 Target writer 複製 first/last/exempt 規則。

Challenge aggregate helper 以 canonical KPI contract 判定合法 challenge；部分店未設定 challenge 時逐店回退 base target，既有非法 challenge 不會被靜默當成未設定。未知品牌 ID 會拒絕／跳過，禁止 fallback 到 CYJ path。

Regression owner：

```text
tests/targetAuthority.test.js
```

# 11. 年度 / 區域 / 單店 / 詳細報表

## `AnnualView.jsx`

主要來源：

- annual aggregated data
- historical dashboard summaries
- monthly targets / target summaries

用途：

- 年度現金 / 權責實績
- 年度預算
- 月度趨勢
- historical Summary 優先使用

## `RegionalView.jsx`

主要來源：

- AppContext allReports
- budgets
- monthlyTargetSummary
- currentDashboardSummary

用途：

- 區域層績效分析
- manager / region aggregates
- target resolution

## `StoreAnalysisView.jsx`

用途：

- 單店分析
- store scoped reports
- monthly target fallback
- benchmarks
- store-level read tracking

## `RankingView.jsx`

用途：

- 詳細報表
- 現金 / 權責目標與達成
- 排名
- audit exclusion
- Summary / raw fallback

---

# 12. Therapist 模組

主要檔案：

- `TherapistManagerView.jsx`
- `TherapistTargetView.jsx`
- `TherapistScheduleView.jsx`
- `TherapistPerformanceView.jsx`
- `InputView.jsx`
- `DailyView.jsx`
- `HistoryView.jsx`
- `AuditView.jsx`

主要 collections：

- `therapists`
- `therapist_targets`
- `therapist_schedules`
- `therapist_daily_reports`
- `therapist_monthly_aggregated`
- `therapist_summary`

Therapist module 可以由 feature flag 關閉。

---

# 13. Settings / Organization / Delegation

## `SettingsView.jsx`

Batch 3 KPI Settings authority：

- `newASP` blank / 0 = 未設定，不再把 3500 hardcoded fallback 寫回 `kpi_targets`
- Store Health benchmark 需 `min > 0`、`max > min`，canonical storage 使用 decimal ratio
- benchmark invalid 時阻止寫入；兩端都空白代表未設定
- 只更新目前 brand benchmark field path，避免跨品牌覆寫其他品牌設定

目前正式來源可確認管理：

- org_structure
- manager auth
- store account
- permissions
- security config
- feature flags
- therapists
- therapist target / schedule
- delegation
- annual KPI related rebuild
- maintenance entry

並直接嵌入：

```text
SystemMaintenance
```

## Delegation

核心來源：

- `SettingsView.jsx`
- `delegationResolver.js`
- `App.jsx`
- `firestore.rules`

Firestore Rules 對 `management_delegations` 有獨立 schema validation，
並禁止 delete；結束代理應保留歷史狀態。

---

# 14. Login / Security / Device

主要來源：

- `src/LoginView.jsx`
- `src/LoginCounter.jsx`
- `src/App.jsx`
- `src/components/DeviceApprovalGate.jsx`
- `src/components/DeviceApprovalPanel.jsx`
- `src/components/SystemMonitor.jsx`
- `src/components/TelegramAlertControlCenter.jsx`
- `functions/deviceApproval.js`
- `functions/index.js`
- `firestore.rules`
- `tests/deviceApproval.test.js`
- active package 若有 `tests/superAdminDeviceNotice.test.js` 也必須列入

目前可由正式／已驗證來源確認的責任包含：

- 多角色登入與品牌帳號選擇
- 初始密碼強制更新
- login location resolution
- stable device id / device profile
- `security_config.deviceApprovalMode`
- Trusted／observing／reverify／suspicious／blocked 狀態
- `device_approval_requests`
- `device_approval_inbox`
- `security_summary/device_approvals`
- Guided Trusted-device 6 位碼 self approval
- 最高管理者人工覆核
- Backend actor re-verification
- 多最高管理者同時處理 request 的 race hardening（最新待部署 Backend）
- login security event／cooldown state
- Security Telegram delivery trigger
- system audit logs

`LoginCounter.jsx` 只負責授權名單同步狀態與人數呈現，不是 authentication engine。

最新 Summary-first 主管通知是否已正式部署，不可從 Source Map 自行推定，必須讀 `CURRENT_STATE.md`。

# 15. Maintenance / Data Governance

## `SystemMaintenance.jsx`

目前正式維護中心包含多項：

- health / data issue 檢查
- monthly closing
- backup / snapshot
- data volume
- read tracker
- global read ranking
- summary rebuild / compare / status
- target summary rebuild
- recalc queue
- core consistency audit

正式版本的 Core Consistency：

- 支援單月
- 支援全年
- Audit Only
- 不保留一次性的 CYJ 新店 V2 repair UI

## Store Identity 安全網

配合：

- `DATA_IDENTITY_RULES.md`
- `tests/storeIdentity.test.js`

未來遇到 CYJ 新店相關資料問題：

1. 先跑 Core Consistency Audit
2. 確認 collection
3. 確認 raw document / storeName
4. 確認 normalization / canonical layer
5. 確認 writer
6. 再考慮頁面 query
7. 禁止一開始 page-level workaround

---

# 16. Notification / Telegram

## 前端控制層

```text
NotificationManager.jsx
  ↓
TelegramAlertControlCenter.jsx
```

`NotificationManager.jsx` 包含：

- notification rules
- scheduled reports
- report type settings

`TelegramAlertControlCenter.jsx` 包含：

- active alert config
- alert rules
- brand profiles
- policy center
- policy permissions
- report snapshots
- schedules
- improvement tasks
- command dispatch
- audit logs

Telegram 主動預警使用固定 legacy data root：

```text
artifacts/default-app-id/public/data
```

這是目前正式前端程式明確定義的特殊路徑；
修改 Telegram Functions 時必須與此路徑保持一致。

## Login-security Telegram path

Separate from the Gemini Agent / operational alert pipeline:

```text
functions/deviceApproval.js
→ security_alerts
→ onLegacySecurityAlertCreated / onBrandSecurityAlertCreated
→ global_settings/telegram_security_alerts
→ sendTelegramMessage()
```

This path is event-driven and should not load operational KPI datasets or call Gemini unless a future requirement explicitly asks for that.

## Backend Prompt

`functions/telegram/prompts.js`

集中管理：

- Gemini system/finalizer
- Evidence Guard
- Inference Guard
- Reply mode / policy instructions

runtime policy / preference / reply mode 由 `functions/index.js` 注入。

---

# 17. Firebase Functions

正式 `functions/index.js` 目前匯出的 functions：

- `resolveLoginLocation`
- `aggregateLegacyReports`
- `aggregateBrandReports`
- `aggregateLegacyTherapistReports`
- `aggregateBrandTherapistReports`
- `telegramWebhook`
- `cleanupTelegramAgentPolicies`
- `telegramAgentDailyPatrol`
- `processTelegramAlertCommand`
- `notificationPatrol`
- `telegramTaskFollowUp`
- `onLegacyTherapistChange`
- `onBrandTherapistChange`
- `onManagerChange`
- `onBrandManagerChange`
- `onStoreAccountChange`
- `onManagerAuthChange`
- `calibrateUserCount`
- `calculateHistoricalProjectionCurve`
- `healTherapistData`
- `recalculateMonthlyData`
- `rebuildAnnualKpiSummaryNow`
- `rebuildAnnualKpiSummaries`
- `repairDirtySummaryNow`
- `repairDirtySummaries`

主要責任群：

```text
登入位置
Aggregation
Summary repair
Annual KPI
Therapist data maintenance
Telegram Agent
Telegram notification / schedule / task
User count / projections
Firestore change listeners
```

Batch 2 另新增：

```text
functions/kpiContracts.js
```

Batch 3 起，`functions/kpiContracts.js` 已被 Target authority runtime 使用，因此不再是 unused-only module。

Batch 3 新增：

```text
functions/targetCoverage.js
```

以及 `functions/index.js` exports：

```text
onLegacyMonthlyTargetChange
onBrandMonthlyTargetChange
onLegacyMonthlyTargetSummaryChange
onBrandMonthlyTargetSummaryChange
onLegacyStoreLifecycleCoverageChange
onBrandStoreLifecycleCoverageChange
```

這 6 支是 Target / Target Summary / Lifecycle 的 scoped Firestore event handlers；沒有新增 polling 或 Dashboard persistent listener。

---



Device Security module / exports to include when diagnosing login-device behavior:

```text
functions/deviceApproval.js
checkDeviceAccess
reviewDeviceApproval
manageAccountDevice
emergencyUnblockDevice
cleanupExpiredDeviceApprovals
reportLoginSecurityEvent
```

Security Telegram Firestore triggers in `functions/index.js` include legacy CYJ and standard-brand security-alert creation handlers.

# 18. Firestore Rules 現況

目前 Rules 採：

```text
request.auth != null
```

作為基礎 signed-in gate。

特別保護：

## management_delegations

- create / update 需通過 schema validation
- delete 禁止
- `editOrganization` 必須 false

## system_logs

- create / read
- update / delete 禁止

其他品牌資料與 legacy data root，
目前大部分仍為登入後可讀寫。

重要架構註記：

> Rules 註解明確指出，目前為匿名登入／自訂 Token 混合架構，
> 真正職級不可只信任前端欄位；
> 若未來改 Custom Claims，再進一步強化 server-side role verification。

---

# 19. 目前已確認的主要 Firestore logical collections

以下名稱來自目前正式程式的實際讀寫引用，不代表完整 schema 已完成文件化：

## 營運核心

- daily_reports
- monthly_aggregated
- monthly_targets
- monthly_targets_summary
- dashboard_summary
- rankings_summary
- summary_recalc_flags
- recalc_queue
- annual_kpi_summary
- kpi_targets

## Therapist

- therapists
- therapist_daily_reports
- therapist_targets
- therapist_schedules
- therapist_monthly_aggregated
- therapist_summary

## Organization / Account

- org_structure
- store_account_data
- manager_auth
- trainer_auth
- director_auth
- master_auth
- permissions
- management_delegations

## Feature / Security

- feature_flags
- security_config
- account_devices
- security_alerts
- security_summary
- system_logs
- system_stats

### Device Approval / Login Security

- `account_devices`
- `device_approval_requests`
- `device_approval_inbox`
- `security_summary`
- `security_alerts`
- `login_security_state`
- `global_blocked_devices`

## Maintenance

- maintenance_logs
- maintenance_backup_logs
- calibration_logs
- org_structure_snapshots
- read_tracker_config
- read_debug_sessions
- summary_worker_state

## Telegram / Notification

- notification_rules
- telegram_alert_commands
- telegram_agent_logs
- telegram_agent_policies
- telegram_agent_policy_audits
- telegram_agent_sessions
- telegram_agent_tasks
- telegram_agent_task_audits
- telegram_agent_task_drafts
- telegram_report_snapshots
- telegram_schedule_audits

---

# 20. Source-control confirmation status

以下不是「不存在」，而是目前 Source Batch 尚無可追溯檔案：

## `.firebaserc` — 2026-08-27 已重新確認

最新正式 source 已確認專案根目錄存在 `.firebaserc`：

```json
{
  "projects": {
    "default": "cyjsituation-analysis"
  }
}
```

因此 Firebase CLI default alias 已由目前 source 確認為 `cyjsituation-analysis`。實際部署仍建議明確加上 `--project cyjsituation-analysis`。

## `firestore.indexes.json`

使用者確認目前專案目錄未看到。

目前 `firebase.json` 亦未宣告 indexes file。

因此 Knowledge Base 目前只記：

> Composite indexes 目前未由 repository source file 管理／確認。

如果未來需要完整文件化 indexes，
應由 Firebase Console / CLI 的實際設定匯出後再加入，
不得靠查詢程式碼反推成「正式 index」。

---

# 21. 修改功能前的閱讀路徑

## 修改 Dashboard

先讀：

```text
App.jsx
DashboardView.jsx
useDashboardStats.js
DashboardHeader.jsx
StorePerformanceView.jsx
TherapistPerformanceView.jsx
```

如碰 historical Summary，再讀：

```text
functions/index.js
SystemMaintenance.jsx
```

## 修改日報寫入

```text
InputView.jsx
App.jsx
functions/index.js
```

若碰店名：

```text
DATA_IDENTITY_RULES.md
tests/storeIdentity.test.js
helpers.js
```

## 修改 Target / Target Coverage / KPI Settings

```text
TargetView.jsx
SettingsView.jsx
App.jsx
src/utils/kpiContracts.js
src/utils/storeLifecycle.js
functions/kpiContracts.js
functions/storeLifecycle.js
functions/targetCoverage.js
functions/index.js
DATA_IDENTITY_RULES.md
tests/storeIdentity.test.js
tests/storeLifecycle.test.js
tests/kpiContracts.test.js
tests/targetAuthority.test.js
```

若修改 coverage writer，先確認三品牌 physical path 與 Lifecycle `READY` semantics；禁止直接在 Dashboard / Ranking / Annual 補 combined coverage workaround。

## 修改 Organization / 區長代理

```text
SettingsView.jsx
delegationResolver.js
App.jsx
firestore.rules
```

## 修改 Login / Security

```text
src/App.jsx
src/LoginView.jsx
src/components/DeviceApprovalGate.jsx
src/components/DeviceApprovalPanel.jsx
src/components/SystemMonitor.jsx
src/components/TelegramAlertControlCenter.jsx
functions/deviceApproval.js
functions/index.js
firestore.rules
docs/AUTH_AND_SECURITY.md
docs/FIREBASE_DATA_MODEL.md
```

If multiple highest managers / proactive manager notices are involved, also read:

```text
tests/deviceApproval.test.js
tests/superAdminDeviceNotice.test.js (if present)
docs/CURRENT_STATE.md
```

## 修改 Telegram

```text
NotificationManager.jsx
TelegramAlertControlCenter.jsx
functions/index.js
functions/telegram/prompts.js
```

---

# 22. Knowledge Base 建立規則

後續建立正式文件時：

1. 優先以目前正常部署的 source file 為事實。
2. 文件內容必須能追溯到本 Source Map 中的檔案。
3. 無法確認的架構不可由 AI 記憶補上。
4. 使用者若提供更新正式版本，舊 Source Map 對應項目必須更新。
5. 重大架構修正完成後，同步更新相關 `.md` 與 regression tests。
6. 不把一次性事故 workaround 寫成永久架構規則。
7. 不把「程式目前如此」與「未來建議重構方向」混在一起。

---

# 23. 下一階段文件

在目前 Source Map 基礎上，可以開始建立：

```text
README.md
ARCHITECTURE.md
DEVELOPMENT_GUIDE.md
DEPLOYMENT.md

docs/
├─ FIREBASE_DATA_MODEL.md
├─ DASHBOARD_SUMMARY.md
├─ AUTH_AND_SECURITY.md
├─ TELEGRAM_AGENT.md
├─ MAINTENANCE_TOOLS.md
└─ DATA_FLOW.md
```

其中 `CHANGELOG.md` 不從舊聊天記憶倒填；
只能加入有正式來源或由使用者確認的版本紀錄。


---

# 24. Source Batch 3 補充

2026-08-18 後續正式來源新增：

- `src/index.css`
- `index.html`
- `tailwind.config.js`
- `postcss.config.js`
- 原始 Vite template `README.md`
- `SmartCalendar.jsx`
- `SmartDatePicker.jsx`
- `LoginCounter.jsx`
- `TelegramAlertControlCenter.jsx`
- 正式 `DATA_IDENTITY_RULES.md`
- 正式 `tests/storeIdentity.test.js`

## Frontend Style

`index.css` 目前只載入：

```text
@tailwind base
@tailwind components
@tailwind utilities
```

Tailwind content scan：

```text
./index.html
./src/**/*.{js,ts,jsx,tsx}
```

Plugin：

```text
tailwindcss-animate
```

PostCSS：

```text
tailwindcss
autoprefixer
```

## HTML Shell

`index.html` 可確認：

- root element：`#root`
- entry：`/src/main.jsx`
- no-cache meta
- Apple mobile web app meta
- PWA icon
- mobile viewport

## Original README

使用者提供的原始 `README.md` 仍是 create-vite template 說明，
不包含本系統的正式架構、部署與維護知識。

因此 Project Knowledge Base v1 會以新的專案 README 取代其「文件用途」；
不影響程式 runtime。

## GitHub Actions

使用者已在專案根目錄執行：

```bash
find .github -maxdepth 2 -type f 2>/dev/null
```

無輸出。

目前 Source Map 正式標記：

```text
未發現 .github/workflows
```

---

# 25. Store Lifecycle v1 — Batch 1 / 1.1（PRODUCTION CONFIRMED）

2026-08-27 Batch 1 Foundation 與 Batch 1.1 boundary fix 已完成部署及 production confirmation。Batch 3 開始只讓 Target Coverage 使用 READY monthly cohort；其他 KPI consumer 仍依後續 Batch 分批切換。

新增 owner：

```text
src/components/StoreLifecycleManager.jsx
  → Lifecycle 管理 UI / view-scoped single-doc read

src/utils/storeLifecycle.js
  → Frontend Store Identity / lifecycle normalization / defensive validation

functions/storeLifecycle.js
  → High-impact Lifecycle Backend writer / READY certification / race control

tests/storeLifecycle.test.js
  → Lifecycle identity / validation / rules / no-polling / no-existing-KPI-write regression
```

既有 owner 小幅整合：

```text
src/components/SettingsView.jsx
  → 新增「門市生命週期」管理分頁

functions/deviceApproval.js
  → 只 export 既有 requireFirebaseRequestAuth / verifySuperAdminActor / brand path helpers

functions/index.js
  → export manageStoreLifecycle

firestore.rules
  → store_lifecycle signed-in read / direct frontend write deny
```

本 Batch 明確沒有修改：

```text
App.jsx
useDashboardStats.js
DashboardView.jsx
RankingView.jsx
AnnualView.jsx
RegionalView.jsx
DailyView.jsx
AuditView.jsx
TargetView.jsx
InputView.jsx
```

因此 Batch 1 不進行 KPI consumer cutover。

`.firebaserc` 最新正式 source 已於 2026-08-27 重新確認存在：

```json
{
  "projects": {
    "default": "cyjsituation-analysis"
  }
}
```

之後 Firebase deploy 仍建議明確使用 `--project cyjsituation-analysis` 降低操作錯專案風險。

---

# 26. Canonical KPI Contracts — Batch 2（VALIDATED / NO RUNTIME CONSUMER）

2026-08-27 Batch 2 Gate 0 以最新正式 source 重新定錨後，已建立 Frontend / Backend Canonical KPI pure contracts。

新增 source owner：

```text
src/utils/kpiContracts.js
functions/kpiContracts.js
tests/kpiContracts.test.js
```

本批實際驗證狀態：

```text
KPI contract regression  15 / 15 PASS
npm run build             PASS（使用者於正式 repo 執行確認）
```

Batch 2 完成當下沒有 runtime consumer，因此當時不需要 deployment。Batch 3 implementation package 已開始讓 `TargetView`、`SettingsView`、`App.jsx` 與 `functions/targetCoverage.js` 引用這份 contract；在 Batch 3 尚未部署／production confirmation 前，不可描述為 production-active consumer。

```text
BATCH 2 IMPLEMENTED / VALIDATED  YES
BATCH 2 STANDALONE DEPLOY        NOT REQUIRED
BATCH 3 RUNTIME IMPORT           IMPLEMENTED / NOT DEPLOYED
PRODUCTION CONSUMER              NOT YET CONFIRMED
```

後續 Summary Writer 與各 consumer migration 必須繼續引用這份 contract（或 parity-protected mirror），不得重新在頁面或 writer 發明不同的 formal net cash / formal accrual / validity semantics。

# 27. Target Writer / KPI Settings / Coverage Authority — Batch 3（PRODUCTION CONFIRMED）

最新 owner：

```text
src/components/TargetView.jsx
  → Raw monthly target writer；canonical validity；dirty-month scoped write

src/components/SettingsView.jsx
  → newASP / Store Health benchmark validation

src/App.jsx
  → existing kpi_targets 1-doc listener propagates newASP + benchmarks

src/utils/storeLifecycle.js
functions/storeLifecycle.js
  → monthly Lifecycle eligibility resolver owner

functions/targetCoverage.js
  → Derived monthly_targets_summary / independent cash-accrual coverage

tests/targetAuthority.test.js
  → Batch 3 authority / reads / brand-path / writer regression
```

Target Summary normal write flow：

```text
monthly_targets/{targetId}
  → event-driven Backend
  → read one monthly_targets_summary/{yearMonth}
  → read one store_lifecycle/master
  → write one monthly_targets_summary/{yearMonth}
```

Legacy CYJ target migration event may add one canonical-target point read；正常 Target write 不做 full `monthly_targets` scan。

Lifecycle rebuild rule：

```text
BUILDING → BUILDING
  no summary scan

READY enter / leave
or READY cohort change
  scoped low-frequency monthly_targets_summary scan
```

正式狀態（2026-08-28）：

```text
KPI + Store Identity + Lifecycle + Target Authority regression: 57 / 57 PASS
Full production-repo npm run build: PASS
6 scoped Target Coverage Functions: DEPLOYED
Frontend GitHub Pages: Published
Production smoke test: PASS
PRODUCTION CONFIRMED: YES
CURRENT_APP_VERSION: 3.5.3 unchanged
```


---

# 28. Summary Writer Semantic Migration — Batch 4（DEPLOYED / PRODUCTION CONFIRMED）

新增 pure owners：

```text
src/utils/summarySemantics.js
  → Frontend Maintenance Summary semantic contract（ESM）

functions/summarySemantics.js
  → Backend Summary semantic contract（CommonJS mirror）

tests/summarySemantics.test.js
  → Frontend ↔ Backend parity / semantics / wiring / call-graph regression
```

Runtime owners：

```text
functions/index.js
  → Backend historical Summary builder / repair / persisted trust compare

src/components/SystemMaintenance.jsx
  → Manual Summary builder / compare; must mirror Backend Summary contract
```

Batch 4 明確不修改：

```text
src/hooks/useDashboardStats.js runtime read contract
Dashboard / Regional / Ranking / Annual consumer cutover
functions/targetCoverage.js
src/utils/kpiContracts.js
functions/kpiContracts.js
src/utils/storeLifecycle.js
functions/storeLifecycle.js
Firestore Rules
CURRENT_APP_VERSION
```

Summary semantic contract：

```text
semanticVersion = summary-semantics-v1
formalNetCash = cash - refund - skincareRefund

安妞：
  totalAccrual = accrual
  formalAccrual = operationalAccrual

CYJ / 伊啵：
  totalAccrual = accrual
  formalAccrual = accrual
```

Legacy `cash / accrual / rank` 等欄位暫時保留；Batch 4 不原地重新定義它們。新 formal ranking 以 cash achievement 排序，寫入 additive `formalStoreRankings`。

Target authority 使用 Batch 3 `monthly_targets_summary` + Lifecycle READY cohort。Coverage incomplete 不等於 Summary failure，也不會因此掃完整 `monthly_targets`。

Trust compare 在 Backend auto repair 與 Maintenance manual rebuild 都改成寫入後重新讀取：

```text
dashboard_summary
therapist_summary
rankings_summary
```

再與同次 Raw rebuild payload 比對；store-level semantic signature 與 ranking signature 也納入 compare。

Backend call graph 目前只有：

```text
repairDirtySummaryNow
repairDirtySummaries
```

會走修改後的 Summary builder，因此 Batch 4 Backend deploy scope 應只包含這兩支 Functions。`summarySemantics.js` 是 dependency module，不是新的 Function export。

Read/write impact：

```text
Persistent listeners  +0
Polling               +0
Summary writes        仍為每次 rebuild 3 docs
Lifecycle read        +1 single master doc / rebuild
Persisted trust read  +3 point reads / rebuild
Target normal path    1 target-summary doc；incomplete 不 full-scan raw targets
```

為控制 Firestore document size，formal semantic fields 只加在 store / grand / top-level authority，不擴張每店×每日 `storeDailyTotals` row schema；Maintenance 仍保留既有 `dashboard-summary-v2` `storeDailyTotals`。

Batch 4 正式狀態已由 `CURRENT_STATE.md` 的部署與 Production 驗證收斂為：

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED
CURRENT_APP_VERSION = 3.5.3
```

---

# 29. Pre-Batch-5 Historical Target Coverage Audit / Metadata Migration（PRODUCTION CONFIRMED）

新增／正式 owner：

```text
functions/targetCoverageAudit.js
  → historical Target Coverage read-only classifier
  → ALREADY_V1 / SUMMARY_BACKFILL_SAFE / RAW_RECONSTRUCTION_REQUIRED /
    LIFECYCLE_NOT_READY / PRE_SYSTEM_SKIP

functions/targetCoverageMigration.js
  → brand-scoped atomic metadata-only historical migration
  → persisted metadata + legacy snapshot verification

functions/targetCoverage.js
  → brand path resolver / Summary target-map authority / Coverage builder

functions/storeLifecycle.js
  → monthly Lifecycle READY cohort

functions/deviceApproval.js
  → requireFirebaseRequestAuth / verifySuperAdminActor

functions/index.js
  → exports.auditHistoricalTargetCoverage
  → exports.migrateHistoricalTargetCoverageMetadata

src/components/SystemMaintenance.jsx
  → Phase A Audit UI
  → Phase B Migration UI

tests/targetCoverageAudit.test.js
  → read-only / classification / pre-system / UI wiring regression

tests/targetCoverageMigration.test.js
  → metadata-only / forbidden legacy fields / atomic blocking /
    persisted verification / endpoint wiring regression
```

## Runtime flow

Phase A：

```text
SystemMaintenance
  → auditHistoricalTargetCoverage
  → verify Firebase Auth + highest admin + trusted device + credential
  → resolve brand path
  → read store_lifecycle/master
  → scoped historical monthly_targets_summary query
  → classify
  → Raw monthly_targets reads = 0
  → writes = 0
```

Phase B：

```text
SystemMaintenance
  → latest same-brand Phase A candidates
  → migrateHistoricalTargetCoverageMetadata
  → verify Firebase Auth + highest admin + trusted device + credential
  → brand-scoped Firestore transaction
      read Lifecycle
      read all requested Summary docs
      reclassify all months
      any blocked month => 0 Writes
      safe set => merge Coverage metadata only
  → point-read written Summary docs
  → verify metadata matched + legacy snapshot preserved
```

## Brand paths

Target Coverage resolver：

```text
CYJ
artifacts/default-app-id/public/data
  /monthly_targets_summary/{YYYY-MM}
  /store_lifecycle/master

安妞 / 伊啵
brands/{brandId}
  /monthly_targets_summary/{YYYY-MM}
  /store_lifecycle/master
```

Phase A / B 不跨 brand collection，也不把 CYJ legacy root 套用到其他品牌。

## Migration write boundary

允許欄位：

```text
targetCoverageVersion
kpiContractVersion
lifecycleReady
eligibleStoreCount
cashConfiguredStoreCount
accrualConfiguredStoreCount
cashCoverageComplete
accrualCoverageComplete
cashMissingStores
accrualMissingStores
targetAudit
coverageSource
coverageUpdatedAt
coverageUpdatedAtText
```

禁止欄位：

```text
targets / equivalent target-map containers
storeCount
targetCount
sourceDocCount
cashTargetTotal
accrualTargetTotal
```

所以此流程是 Derived Summary metadata migration，不是 Raw Target reconstruction。

## Production closeout（2026-08-29）

Phase A：

```text
CYJ   7 historical months → 7 SUMMARY_BACKFILL_SAFE
安妞  7 historical months → 7 SUMMARY_BACKFILL_SAFE
伊啵  2026-01～03         → 3 PRE_SYSTEM_SKIP
伊啵  2026-04～07         → 4 ALREADY_V1

Raw reconstruction required = 0
Raw Target Reads             = 0
Writes                       = 0
```

Phase B 後 post-audit：

```text
CYJ   2026-01～07 → ALREADY_V1 7 / 7
安妞  2026-01～07 → ALREADY_V1 7 / 7
伊啵  2026-01～03 → PRE_SYSTEM_SKIP
伊啵  2026-04～07 → ALREADY_V1 4 / 4
```

正式驗證／部署：

```text
Full regression: 105 / 105 PASS
npm run build: PASS
migrateHistoricalTargetCoverageMetadata: DEPLOYED (us-central1)
SystemMaintenance frontend: Published
Pre-Batch-5 Gate: CLOSED
CURRENT_APP_VERSION: 3.5.3 unchanged
```

Pre-Batch-5 Gate 本身不會自動切換 consumer；其後 Batch 5A-1 Historical Dashboard Formal Consumer 已獨立完成並 Production Confirmed，詳見下一節。
---

# 30. Batch 5A-1 Historical Dashboard Formal Consumer（PRODUCTION CONFIRMED）

新增／正式 owner：

```text
src/utils/dashboardFormalConsumer.js
  → verified historical dashboard_summary 的 Formal KPI / Target / Coverage / Ranking interpreter

src/hooks/useDashboardStats.js
  → historical brand / manager / store scope Formal aggregation

src/components/StorePerformanceView.jsx
  → historical Formal store-ranking consumer

tests/dashboardFormalConsumer.test.js
  → Formal consumer contract regression
```

Backend Summary writer / Formal schema owner維持：

```text
functions/index.js
functions/summarySemantics.js
functions/kpiContracts.js
functions/storeLifecycle.js
functions/targetCoverage.js
```

Batch 5A-1 沒有修改上述 Backend writer authority，只把 Historical Dashboard consumer 接到已 persisted 的 Formal contract。

## Runtime flow

```text
historical month
  → dashboard_summary/{YYYY-MM}
  → existing Summary verification / trust gate
  → dashboardFormalConsumer
      formalNetCash
      formalAccrual
      formal cash/accrual target authority
      achievement/status
      lifecycle-aware scope
      formalStoreRankings
  → useDashboardStats
  → Dashboard / StorePerformanceView
```

Current month：

```text
current month
  → existing live/detail flow
```

5A-1 不把本月切到 Historical Summary consumer。

## Formal semantic authority

```text
CYJ historical cash
  → formalNetCash
  → gross cash - general refund - skincare refund

安妞 historical accrual
  → formalAccrual
  → operationalAccrual

伊啵 historical accrual
  → formalAccrual
  → accrual
```

Base target / achievement：

```text
formalCashTarget
formalAccrualTarget
Formal achievement/status
```

Coverage incomplete 時 fail-closed，不縮 denominator。

Formal ranking：

```text
formalStoreRankings
formalRankEligibleStoreCount
```

## Challenge compatibility

Batch 5A-1 未新增 `formalChallenge*` persisted fields。既有 challenge targets 仍為 compatibility layer，不能被 consumer 當成 canonical Formal contract。

## Brand isolation / Firestore path

5A-1 沒有新增 Firestore path resolver 或跨品牌 query。Historical Summary 仍沿用既有 brand-resolved collections；Formal aggregation只在目前選定 brand / manager / store scope 內運作。

## Reads impact

Batch 5A-1 本身沒有改 reads topology；Batch 5A-2 已於 2026-08-29 完成 verified historical Store Dashboard reads cutover。

Batch 5A-2 runtime owners：

```text
src/App.jsx
  historical detail loading gate
  Summary trust / brand-month anchoring integration

src/hooks/useDashboardStats.js
  historical Summary consumer read path
  raw target fallback gate
  duplicate / legacy trust listener cleanup

src/utils/dashboardReadPolicy.js
  CURRENT_LIVE / LOADING / SUMMARY_TRUSTED / DETAIL_FALLBACK / DIRTY_REFRESH
  shouldLoadDailyReports
  allowRawTargetFallback

tests/dashboardHistoricalReads.test.js
  historical reads regression contract
```

正常 verified historical Store Dashboard：

```text
historical daily_reports full-month load = 0
raw monthly_targets fallback             = 0
recalc_queue large query                 = 0
maintenance_logs query                   = 0
polling                                  = 0
```

Summary dirty / missing / unverified 時仍保留一次 detail fallback；這是 correctness path，不應移除。

## Production closeout（2026-08-29）

正式 Git：

```text
HEAD = origin/main
b4f907777d60d4b7e594b83e37e1c5218bf076b1
```

Validation：

```text
Full regression 115 / 115 PASS
npm run build PASS
Frontend Published
CURRENT_APP_VERSION 3.5.3 unchanged
```

Production：

```text
CYJ 2026-07
  Dashboard historical cash = 38,386,697
  confirmed formalNetCash authority

安妞 2026-06
  Dashboard historical accrual = 30,436,598
  confirmed formalAccrual authority

伊啵 historical KPI = normal
manager filter = normal
single-store filter = normal
Store Performance ranking = normal
current-month live/detail regression = normal
```

狀態：

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED
```

Batch 5A-2 已完成並 Production Confirmed。正式 Runtime commit / main：

```text
HEAD = origin/main
a43e1d92c1c2d3d71177a7aaaa020d72e2b7ab55
```

Validation：

```text
127 / 127 tests PASS
npm run build PASS
Frontend Published
CURRENT_APP_VERSION 3.5.3 unchanged
```

Production：

```text
CYJ / 安妞 / 伊啵 historical Dashboard normal
manager filter normal
single-store filter normal
Store Performance normal
2026-08 current-month normal

read tracker:
historical daily_reports not observed
raw monthly_targets fallback not observed
recalc_queue large query not observed
maintenance_logs query not observed
```

上述 tracker 結果不代表整個 Dashboard 只有 1 Firestore read；Summary / config 等必要 single-document reads 仍可能存在。

狀態：

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED
```

Batch 5B-1 Regional / Ranking Formal Consumer 已於 2026-08-29完成並 Production Confirmed；Annual 仍留待獨立 Batch 5B-2。
# 31. Batch 5B-1 Regional / Ranking Formal Consumer（PRODUCTION CONFIRMED）

Batch 5B-1 runtime owners：

```text
src/App.jsx
  → Ranking / Regional historical Formal trust integration
  → Batch 5A-2 historical read policy 延伸

src/utils/reportFormalConsumer.js
  → verified historical Regional / Ranking Formal interpreter
  → Formal KPI / target / coverage / lifecycle / ranking authority

src/components/RegionalView.jsx
  → historical Regional Formal aggregation consumer

src/components/RankingView.jsx
  → historical Formal ranking consumer

tests/reportFormalConsumer.test.js
  → Batch 5B-1 regression contract
```

Backend persisted authority維持：

```text
functions/index.js
functions/summarySemantics.js
functions/kpiContracts.js
functions/storeLifecycle.js
functions/targetCoverage.js
```

Batch 5B-1 沒有修改 Backend writer；Frontend 只接到已 persisted 的：

```text
formalNetCash
formalAccrual
formalCashTarget / formalCashAchievement
formalAccrualTarget / formalAccrualAchievement
formalStoreRankings
formalRankEligibleStoreCount
Formal Target Coverage / Lifecycle authority
```

## Regional flow

```text
historical month
→ verified dashboard_summary + trust flags
→ reportFormalConsumer
→ Lifecycle eligible store scope
→ Formal actuals + Formal target authority
→ coverage-complete achievement
→ RegionalView
```

Coverage incomplete 時 fail-closed；不縮 denominator。

## Ranking flow

```text
historical month
→ verified Summary / ranking authority
→ formalStoreRankings
→ formalRankEligibleStoreCount
→ reportFormalConsumer
→ RankingView
```

Lifecycle non-eligible / invalid target / missing data 不得被前端壓成合法 `0` 後重新排名。既有顯式 ranking exclusion 可作 presentation / operational filter，但不重寫 persisted Formal authority。

## Reads / brand isolation

Batch 5A-2 historical read policy 延伸到 Dashboard / Ranking / Regional；正常 verified historical 不重新載入整月 `daily_reports`，dirty / missing / unverified 才允許 detail fallback。

沒有新增：

```text
Firestore listener
query
polling
Backend Function
Rules path
```

三品牌仍沿用既有 brand-resolved Firestore path；Batch 5B-1 不跨品牌共用 Summary 或 ranking document。

## Production closeout（2026-08-29）

正式 Git：

```text
HEAD = origin/main
5d3d370a9d4cb045f718020ddd390050a3d0b9aa
```

Validation：

```text
140 / 140 tests PASS
npm run build PASS
Frontend Published
CURRENT_APP_VERSION 3.5.3 unchanged
```

Production：

```text
CYJ historical Ranking / Regional normal
安妞 historical Ranking / Regional normal
伊啵 historical Ranking / Regional normal
區域／月份切換 normal
current-month regression normal
```

Read tracker 未觀察到 historical `daily_reports` 大量讀取、raw `monthly_targets`、`recalc_queue` large query 或 `maintenance_logs` large query 回歸；當次可見 `read_tracker_config` 2 docs、`system_stats_today` 1 doc，但不可推論整頁只有 3 次 Firestore read。

狀態：

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED
```

Batch 5B-2 Annual 尚未開始；其 Source of Truth 必須以當時最新正式 main 重新取得，不得直接從 5B-1 artifact 延伸修改。
