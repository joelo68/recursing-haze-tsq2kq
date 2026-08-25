# SYSTEM_SOURCE_MAP.md

> 狀態：Project Knowledge Base / Source Map v0.1  
> 建立原則：本文件只根據使用者於 2026-08-18 明確提供的「目前正常部署版本」程式建立。  
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
- `monthly_targets_summary`
- `recalc_queue`

目前正式版本已具有：

- canonical target store name
- canonical target document key
- legacy CYJ 新店 read fallback
- canonical write
- legacy key migration on write / unlock

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

- `LoginView.jsx`
- `LoginCounter.jsx`
- `App.jsx`
- `SystemMonitor.jsx`
- `firestore.rules`
- `functions/index.js`

目前正式來源可確認包含：

- 多角色登入
- 品牌登入流程
- password update / forced password update
- account directory status
- login location resolution
- device profile
- security alerts
- device management
- security summary
- system logs

`LoginCounter.jsx` 只負責授權名單同步狀態與人數呈現，
不應被視為身份驗證邏輯本身。

---

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

---

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

# 20. 尚未由目前正式來源確認的項目

以下不是「不存在」，而是目前 Source Batch 尚無可追溯檔案：

## `.firebaserc`

使用者確認目前專案目錄未看到。

因此 Knowledge Base 目前只記：

> Firebase project alias 未由 source-controlled `.firebaserc` 確認。

不得自行建立 alias 或宣稱 deploy CLI 一定使用哪個 alias。

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

## 修改 Target

```text
TargetView.jsx
DATA_IDENTITY_RULES.md
tests/storeIdentity.test.js
functions/index.js
```

## 修改 Organization / 區長代理

```text
SettingsView.jsx
delegationResolver.js
App.jsx
firestore.rules
```

## 修改 Login / Security

```text
LoginView.jsx
LoginCounter.jsx
App.jsx
SystemMonitor.jsx
functions/index.js
firestore.rules
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
