# ARCHITECTURE.md

> 本文件描述目前正式部署版本的系統架構。  
> 只記錄可由 2026-08-18 正式來源確認的內容。

# 1. 高階架構

```text
Browser / PWA
    │
    ▼
React 19 + Vite
    │
    ├─ App.jsx ── AppContext
    │    │
    │    ├─ Auth / Account Directory
    │    ├─ Brand / Role / Permission
    │    ├─ Firestore Path Resolver
    │    ├─ Global Data Loading
    │    ├─ Read Throttling
    │    ├─ Security / Device
    │    └─ Feature Flags
    │
    ├─ Dashboard / Reports / Input / Settings
    │
    ▼
Firebase
    ├─ Firestore
    ├─ Authentication
    └─ Cloud Functions
          │
          ├─ Aggregation
          ├─ Summary Repair
          ├─ Annual KPI
          ├─ Login Location
          ├─ Therapist Maintenance
          └─ Telegram Agent / Notification
```

# 2. 前端核心

## 2.1 `src/main.jsx`

責任：

- 載入 `index.css`
- 建立 React root
- 掛載 `App`
- 啟用全頁面 `notranslate` 保護

## 2.2 `src/App.jsx`

目前是前端最主要 orchestration layer。

包含：

- 使用者登入狀態
- 角色
- current user
- 品牌
- App 版本
- Security config
- Feature flags
- Delegation access
- Firestore 路徑 resolver
- 全域核心資料載入
- 月度／年度資料讀取
- Dashboard historical detail fallback
- low-power / auto logout
- device trust
- system logging
- lazy-loaded feature views
- AppContext provider

### App Version

目前正式：

```text
CURRENT_APP_VERSION = 3.4.1
```

## 2.3 AppContext

`src/AppContext.js` 本身只建立：

```js
React.createContext(null)
```

真正提供的 context value 由 `App.jsx` 組裝，因此查某個 context 欄位來源時，必須回到 `App.jsx`。

# 3. 品牌資料架構

品牌定義來源：

```text
src/constants/index.js
```

```text
CYJ   → pathType=legacy
安妞  → pathType=standard
伊啵  → pathType=standard
```

## 3.1 CYJ

Collection：

```text
artifacts/{appId}/public/data/{collectionName}
```

Global document：

```text
artifacts/{appId}/public/data/global_settings/{docName}
```

## 3.2 安妞／伊啵

Collection：

```text
brands/{brandId}/{collectionName}
```

Settings document：

```text
brands/{brandId}/settings/{docName}
```

### 架構限制

CYJ 與新品牌並非只有顯示名稱不同，而是實際 Firestore root 不同。

因此跨品牌功能必須：

- 優先使用 `getCollectionPath()`
- 優先使用 `getDocPath()`
- 避免直接硬寫 CYJ path，除非該模組本身被設計成固定使用 legacy root

Telegram 主動預警控制中心就是目前正式存在的固定 legacy-root 特例。

# 4. 角色與功能

正式角色：

```text
director   高階主管
trainer    教專
manager    區長
store      店經理
therapist  管理師
```

另有程式內使用的 `master` 最高管理者角色。

選單定義集中在：

```text
src/constants/index.js
```

Navigation 還會依：

- role
- permissions
- therapistModuleEnabled

進一步過濾。

# 5. 共用工具

## 5.1 `helpers.js`

共用：

- UUID
- 日期
- 數字格式
- store / manager / therapist 排序
- org_structure managerOrder
- 通用 store core normalization

### 重要現況

目前 **Store Identity 尚未完全收斂到單一 helper**。

正式程式內仍可看到：

- `helpers.js`
- `delegationResolver.js`
- `TargetView.jsx`
- `RegionalView.jsx`
- `RankingView.jsx`
- `InputView.jsx`
- `SettingsView.jsx`
- `TherapistManagerView.jsx`

各自存在 normalization / legacy compatibility。

這是「目前正式架構」，不是建議未來繼續擴散。

## 5.2 `delegationResolver.js`

定位：

```text
期間式代理與托管的單一判斷來源
```

正式組織歸屬仍由：

```text
org_structure
store_account_data
```

保存。

Delegation 只增加期間內的管理範圍，不改正式組織。

## 5.3 `readTracker.js`

模式：

```text
off
local
global
```

可記錄：

- docs
- triggers
- lastAt
- hourlyBuckets

用於分析 Firestore reads 來源。

# 6. Dashboard

```text
DashboardView
    │
    ├─ DashboardHeader
    ├─ StorePerformanceView
    └─ TherapistPerformanceView
           ▲
           │
    useDashboardStats
```

## 6.1 `DashboardView.jsx`

主要是 view composer。

## 6.2 `useDashboardStats.js`

主要 Dashboard business/data layer：

- filters
- store rankings
- therapist stats
- Summary status
- projection
- annual KPI benchmark
- target resolution
- fallback reads

## 6.3 Summary source presentation

DashboardHeader 可辨識：

```text
live
verified_summary
loading
fallback / warning
```

UI 對應至少包含：

- 本月即時明細
- 已整理 Summary
- 資料來源檢查中

# 7. 日報資料流

## 7.1 Store report

```text
InputView
   ↓
daily_reports
   ↓
Cloud Functions onWrite / aggregation
   ├─ monthly_aggregated
   ├─ summary dirty / recalc
   └─ downstream Summary
```

`InputView.jsx` 的正式註解指出：

> Summary dirty 與 recalc_queue 改由後端 Firestore onWrite 統一建立；前端只負責正式日報寫入與本機草稿暫存。

## 7.2 Therapist report

```text
InputView
   ↓
therapist_daily_reports
   ↓
Cloud Functions
   └─ therapist_monthly_aggregated / related summary
```

# 8. 讀取節流

`App.jsx` 目前有 view-based loading：

```text
ANNUAL_DATA_VIEWS
MONTHLY_REPORT_DATA_VIEWS
MONTHLY_DAILY_REPORT_DATA_VIEWS
MONTHLY_THERAPIST_REPORT_DATA_VIEWS
```

已確認：

- Annual 資料只在年度頁啟用
- 店日報月度明細只在需要的頁面啟用
- therapist_daily_reports 比店日報監聽範圍更窄
- Dashboard 預設店家模式不應無條件常駐讀 therapist_daily_reports

這是控制 Firestore reads 的重要架構，不得在改頁面時隨意移除。

# 9. Store Identity

正式治理：

```text
DATA_IDENTITY_RULES.md
tests/storeIdentity.test.js
```

CYJ 新店 canonical：

```text
core = 新店
canonical = CYJ新店店
```

資料層：

```text
monthly_targets          canonical write
monthly_targets_summary  canonical storeName
monthly_aggregated       canonical key
daily_reports            保留歷史 raw aliases
```

歷史 raw 不等於應全部重新命名。

# 10. Organization / Delegation

```text
SettingsView
    │
    ├─ org_structure
    ├─ store_account_data
    ├─ manager_auth
    ├─ permissions
    └─ management_delegations
           │
           ▼
    delegationResolver
           │
           ▼
    App access profile
```

Firestore Rules 對 `management_delegations` 額外保護：

- schema validation
- create / update allowed after validation
- delete 禁止
- `editOrganization` 強制 false

# 11. Login / Security / Device

主要檔案：

```text
LoginView.jsx
LoginCounter.jsx
App.jsx
SystemMonitor.jsx
functions/index.js
firestore.rules
```

已確認能力：

- 多角色登入 UI
- account directory 載入
- password update / first-login security update
- login activity log
- client device fingerprint/profile
- login location backend endpoint
- trust / suspicious / blocked
- current-brand block
- global block
- security logs / filters

登入紀錄的正式流程明確設計成：

```text
先寫入「登入系統」log
再背景執行 device check
```

避免 device check 失敗造成登入監控沒有登入紀錄。

# 12. Maintenance

`SystemMaintenance.jsx` 是正式資料治理中心。

主要功能群：

- health
- monthly closing
- backup / snapshots
- data volume
- read tracker
- global read ranking
- summary rebuild / compare / status
- target summary rebuild
- recalc queue
- Core Consistency Audit

Core Consistency 正式版：

```text
Audit Only
```

一次性 CYJ 新店 repair UI 不應長期存在。

# 13. Telegram / Notification

前端：

```text
NotificationManager
    ↓
TelegramAlertControlCenter
```

後端：

```text
functions/index.js
    ↔
functions/telegram/prompts.js
```

## Prompt module

`prompts.js` 集中：

- system / finalizer
- Evidence Guard
- Inference Guard
- Reply Mode instructions
- Policy instructions

Runtime policy / preference / reply mode 由 `index.js` 注入。

## Agent backend

目前正式 `functions/index.js` 可確認：

```text
Primary model  = gemini-3.7-flash
Fallback model = gemini-3.6-flash
Max tool calls = 3
Max reads      = 2500
```

## Telegram control data

`TelegramAlertControlCenter.jsx` 明確固定使用：

```text
artifacts/default-app-id/public/data
```

並管理：

- active alerts
- brand profiles
- policies
- policy permissions
- schedules
- snapshots
- improvement tasks
- commands
- audits

# 14. Firebase Functions

目前正式 backend export 25 個 functions：

```text
resolveLoginLocation
aggregateLegacyReports
aggregateBrandReports
aggregateLegacyTherapistReports
aggregateBrandTherapistReports
telegramWebhook
cleanupTelegramAgentPolicies
telegramAgentDailyPatrol
processTelegramAlertCommand
notificationPatrol
telegramTaskFollowUp
onLegacyTherapistChange
onBrandTherapistChange
onManagerChange
onBrandManagerChange
onStoreAccountChange
onManagerAuthChange
calibrateUserCount
calculateHistoricalProjectionCurve
healTherapistData
recalculateMonthlyData
rebuildAnnualKpiSummaryNow
rebuildAnnualKpiSummaries
repairDirtySummaryNow
repairDirtySummaries
```

# 15. Firestore Rules

目前基礎 gate：

```text
request.auth != null
```

Rules 的正式註解指出目前為：

```text
匿名登入 / 自訂 Token 混合架構
```

因此現在不能把前端 role 欄位當成 server-side 身份保證。

目前特別加強：

- `management_delegations`
- `system_logs`

其他大部分 collections 仍是 signed-in 後可讀寫。

# 16. PWA / UI

Vite 設定：

```text
base = /recursing-haze-tsq2kq/
VitePWA registerType = autoUpdate
display = standalone
```

Tailwind：

```text
tailwindcss
tailwindcss-animate
autoprefixer
```

`index.html` 另設定：

- no-cache meta
- Apple web app meta
- PWA icon path
- mobile viewport

# 17. 未由 Repository 確認

目前使用者已確認專案中沒有看到：

```text
.firebaserc
firestore.indexes.json
.github/workflows
```

因此 Architecture 文件不假設：

- Firebase CLI alias 由 repository 管理
- Composite Index 設定已 source-controlled
- GitHub Actions 自動部署存在
