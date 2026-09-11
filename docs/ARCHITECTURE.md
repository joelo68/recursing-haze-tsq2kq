# ARCHITECTURE.md

> 本文件描述目前正式部署版本的系統架構。  
> 已整併至 2026-09-11 Frontend UX ownership closeout（Smart Forecast Accuracy / System Maintenance / Permission Matrix）。
> `CURRENT_STATE.md` 專門區分「已正式確認」、「待部署」與「Production 觀察中」的 Security 工作。

# Frontend UX Ownership Architecture Override — 2026-09-11

本次正式 Frontend 把「營運推估」、「資料治理」、「權限設定」三個 UI responsibility 重新分界，但不改其 Backend / Firestore authority。

```text
SmartForecastView
  ├─ 本月情境 / Projection method
  ├─ SmartForecastAccuracyPanel
  │    ├─ projection_accuracy/{YYYY-MM} point read
  │    └─ projection_accuracy_history/{YYYY} lazy yearly point read
  └─ 本月活動 / projection_context

SystemMaintenance
  ├─ 檢查本月資料
  ├─ 整理月份報表
  ├─ 處理異常資料
  ├─ 備份或救回資料
  └─ secondary / advanced governance tools

SettingsView / Permission Matrix
  ├─ local permission draft
  ├─ sticky role identity / active column safety
  └─ existing updateModulePermissions(...) save authority
```

架構邊界：

- Projection Accuracy 的 writer / scoring / data model 不因 UI 搬移而改變。
- System Maintenance 仍是資料治理中心，但不再作為 Projection Accuracy product UI。
- Permission Matrix 的變更是 presentation safety；沒有新增前端直接 permission write，也沒有改 Backend authorization / Rules。
- System Maintenance IA 重排不建立第二套 handler / writer；既有正式 handler 與 data authority 繼續被沿用。

Firestore / runtime topology delta：

```text
selected-month Accuracy read = +1 bounded point read / uncached brand-month
history read                 = +1 yearly point read / required uncached year after expand
new persistent listener      = 0
new polling                  = 0
new Firestore path/schema    = 0
Functions / Rules change     = 0 / 0
```

---

# Smart Forecast / Event Context B3B Production Architecture Override — 2026-09-11

Smart Forecast 是獨立的營運情境模組，不放進 `SystemMaintenance`，也不直接改 Projection formula。

```text
Browser / PWA
  │
  ├─ Navigation + module permission
  │
  ▼
SmartForecastView
  │
  ├─ SmartMonthPicker
  ├─ SmartDatePicker
  ├─ manager-first store selection
  ├─ brand + month memory cache
  └─ selected brand-month
        │
        ├─ read → 1 point getDoc
        ▼
projection_context/{YYYY-MM}
        ▲
        │
        └─ write
             App.updateProjectionContext
             → manageProjectionContext
             → Auth + highest-admin
             → Trusted Device + credential
             → expectedRevision OCC
             → transaction
                  ├─ context
                  ├─ store_lifecycle/master
                  ├─ audit_exclusions
                  └─ maintenance_logs
```

Context schema：

```text
projection-context-v2
one brand × one month × one document

events[]
  ├─ campaignId
  ├─ event period / type / level / metrics
  ├─ brand or selected-store scope
  └─ storeSchedule[]
       └─ per-store startDate / endDate
```

Backend uses shared Store Lifecycle identity and System Exclusion authority. Store schedules do not trigger per-store document reads；Lifecycle stores reside in the single master document already read by the transaction.

Frontend topology：

```text
cache miss / selected brand-month = 1 point getDoc
force refresh                    = 1 point getDoc
persistent listener              = 0
query                            = 0
polling                          = 0
```

Backend successful save：

```text
3 point reads
2 writes
```

DEV local preview is isolated by account + brand + month in browser localStorage and cannot write Production. Production runtime uses the secure Backend writer.

## Projection Boundary

```text
projection_context
= prospective operational context

projection_models/current
= current Production Projection authority

B3C offline research artifacts
= research evidence only
```

B3B 不把 Event Context 自動接入 Projection v2 calculation。CYJ / 安妞既有 Projection v2 authority 不變；伊啵仍走標準 / V1 Projection。

## Shared Picker Layer

本次正式 tree 同時建立：

```text
SmartMonthPicker
SmartDatePicker
```

作為系統共用 month/date interaction layer。它們是 presentation components：

```text
Firestore read  = 0
Firestore write = 0
listener        = 0
polling         = 0
```

已 migration 的 date/month-only consumers 包含 Smart Forecast、Annual、Notification、Store Lifecycle、System Maintenance、Telegram Alert Control。Native time inputs 仍保留在真正的時間排程 controls。

---

# Projection v2 Production Architecture Override — 2026-09-08

```text
previous 3 complete months daily_reports
        │
        ├─ Formal KPI semantics
        ├─ Store Lifecycle / Reporting Calendar
        └─ System Exclusion
        ▼
functions/projectionAuthority.js
        │
        ├─ Store × weekday median baseline (v1)
        └─ CYJ / ANNIU brand cumulative month-phase curve (v2)
        ▼
projection_models/current
        │
        ├─ Dashboard → src/utils/projectionModelConsumer.js
        └─ Telegram  → functions/telegram/projectionConsumer.js
```

v2 不建立第二份 model document。Persisted `projection-model-v1` / `projection-semantic-v1` 維持；CYJ / 安妞以 additive `strategyVersion` + `brand.phaseCalibration` 啟用，伊啵維持 v1。

```text
phaseMultiplier
= calendarProgress / historicalCumulativeCompletionShare

v2
= currentActual
+ (shadowV1Forecast - currentActual) × phaseMultiplier
```

Day 1–4 或 phase 不可靠時回 v1；model 不可信時回 current pace。Phase 只修正 remaining forecast，不改 actual。

System Exclusion own-store 的 `selfViewExcluded` scope 會關閉 brand fallback / phase，避免排除店透過 Projection 間接取得品牌 aggregate signal。

Telegram exact parity 不改 Firestore model：consumer 以 runtime-only `projectionRange.aggregationBasis` 保存 pre-round basis，scope aggregate 後才 phase / round，與 Dashboard 同序。

Topology delta：

```text
reads      +0
listeners  +0
writes     +0
polling    +0
```

---

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
    │    ├─ Security / Device Approval
    │    ├─ Security Summary / Guided Approval
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
CURRENT_APP_VERSION = 3.5.3
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

Effective Mode 是共用 authority，而不是由 App / Maintenance 各自判斷：

```text
active persisted schedule
→ manual-local device preference
→ persisted config mode
→ off
```

`read_tracker_config` 依既有品牌 path resolver 隔離；`SystemMaintenance.scheduleForm` 是 editor draft，不是 runtime schedule authority。

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

### Annual Read Policy — Batch 5B-2B

Annual 現在不是「進年度頁就監聽整年 aggregate」：

```text
selected-year dashboard_summary + summary_recalc_flags
→ resolveAnnualReadPlan()
→ trusted historical months use Summary
→ current / dirty / missing / stale months only enter monthly_aggregated fallback
```

`therapist_monthly_aggregated` 的 whole-year Annual listener 已退休。Normal trusted path 不載入 historical `daily_reports`、whole-year `monthly_aggregated`、whole-year `therapist_monthly_aggregated` 或 Raw `monthly_targets`。

Owner：

```text
src/App.jsx
src/utils/annualReadPolicy.js
tests/annualHistoricalReads.test.js
```

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

主要來源：

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
tests/deviceApproval.test.js
```

目前 Device Security 已不是舊「前 N 台裝置 auto trust」架構。

正式 logical mode：

```text
off
monitor
enforce
```

核心資料流：

```text
Login credential accepted
↓
checkDeviceAccess
↓
security_config + account_devices
↓
Trusted?
├─ yes → allow
└─ no
   ↓
   approval mode / device state
   ↓
   device_approval_requests
   ├─ device_approval_inbox/{accountKey}
   └─ security_summary/device_approvals
```

在 enforce：

```text
還有其他 Trusted Device
→ selfApprovalAllowed = true
→ 6 位碼 self verification
→ 原 Trusted Device 可被 Guided Flow 主動帶入

沒有任何其他 Trusted Device
→ selfApprovalAllowed = false
→ adminOnly
→ 由最高管理者人工建立第一台 Trusted Device
```

`DeviceApprovalGate.jsx` 負責新裝置等待／阻擋入口；`DeviceApprovalPanel.jsx` 負責 self verification 與最高管理者人工覆核；`functions/deviceApproval.js` 是 Device Approval backend authority。

裝置 review state 包含：

```text
trusted
observing
reverify_required
suspicious
blocked
global_blocked
```

最高管理者是 `director` 之下解析為 `super_admin` 的帳號（另可能存在 master-login emergency path）。Frontend 顯示可操作，不代表 Backend 可以省略 actor verification。

### Realtime 設計

App 主要使用小型 realtime surface：

```text
device_approval_inbox/{accountKey}
security_summary/device_approvals
真正需要時才監聽單筆 device_approval_requests/{requestId}
```

目的就是避免為了 Badge／approval 狀態而常駐監聽完整 `account_devices`。

### Summary-first 最高管理者通知（Production）

2026-08-25 正式版本新增非阻斷式 Security Action Card，並把需要主管協助的摘要直接寫入 `security_summary/device_approvals`，移除「為了判斷要不要跳提醒而再 query 一次 pending collection」的額外讀取。

使用者已確認正式部署完成且初步 Production 測試成功；`CURRENT_APP_VERSION` 維持 3.5.3，目前持續觀察可能的 Bug／邊界案例。

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

## Login-security Telegram is a separate pipeline

The operational Telegram Agent above is not the same as login-security Telegram delivery.

Security path:

```text
functions/deviceApproval.js writes security_alerts
↓
functions/index.js Firestore onCreate trigger
↓
global_settings/telegram_security_alerts
↓
selected authorized chat target(s)
↓
sendTelegramMessage()
```

This path is event-driven and does not require Gemini, Agent tools, monthly KPI reads, schedules or polling.

Security event categories currently include password failure threshold, 6-digit failure limit, manager assistance required, “not me”, rapid multi-location login, and blocked-device retry.

# 14. Firebase Functions

早期基線列出的主要 Functions exports 如下；目前正式 source 已另包含 Device Security、Store Lifecycle、Target Coverage、System Exclusion、Audit / Migration 等 exports，完整 current list 必須回到 `functions/index.js` / `SYSTEM_SOURCE_MAP.md`，不得再用「25 個」作現在的固定總數：

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



Device Security is factored into `functions/deviceApproval.js` and exported through the Functions entry layer. Logical endpoints / jobs include:

```text
checkDeviceAccess
reviewDeviceApproval
manageAccountDevice
emergencyUnblockDevice
cleanupExpiredDeviceApprovals
reportLoginSecurityEvent
```

Security Telegram delivery triggers in `functions/index.js` handle legacy CYJ and standard-brand `security_alerts` creation events.

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

目前 repository source 已確認：

```text
.firebaserc exists
default project = cyjsituation-analysis
firestore.indexes.json 未提供 / 未由 firebase.json 宣告
.github/workflows 未發現 repository workflow file
```

因此：

- Firebase CLI default alias 可由 repository 確認，但 deploy 仍建議明確 `--project cyjsituation-analysis`
- Composite Index 設定仍不可假設已 source-controlled
- GitHub Pages publish 由 `gh-pages` branch / platform deployment完成，不等於 repository 內存在 `.github/workflows`

---

# 18. System Exclusion Authority Layer — A+B / Stage C

System Exclusion 現在是介於 Lifecycle cohort 與所有 Formal consumer 之間的正式 scope authority：

```text
Store Lifecycle READY monthly cohort
        ↓
System Exclusion v1
        ↓
Formal Store Scope
        ├─ Current Detail / Dashboard
        ├─ Daily observed reporting
        ├─ Target Coverage
        ├─ Historical Summary / Ranking
        ├─ Annual / Regional / Ranking / Store Analysis
        └─ Telegram formal operational analysis
```

Physical authority：

```text
CYJ legacy
artifacts/default-app-id/public/data/global_settings/audit_exclusions

standard brands
brands/{brandId}/settings/audit_exclusions
```

Frontend 不常駐監聽大型 exclusion collection；`App.jsx` 只維持目前 brand 的單一 Settings doc realtime authority。

Derived Data 用 `systemExclusionSnapshot` 做 revision trust；Current Detail 直接使用 live authority。Historical Summary stale 時沿用既有 dirty / repair worker，不另建第二套 writer。

## 18.1 Store Self-View is a separate presentation authority

System Exclusion 的 Formal scope 不變，但 Dashboard 另有一條受限的 own-store self-view branch：

```text
System Excluded
        ├─ Formal consumers
        │    → excluded
        │
        └─ store role + own official store
             → Dashboard self-view only
             → NOT Formal eligible
```

Owner：

```text
src/utils/storeSelfView.js
src/hooks/useDashboardStats.js
src/components/StorePerformanceView.jsx
```

Self-view 必須同時滿足：

```text
role = store
+ store ∈ officialStores
+ current brand System Exclusion authority confirms excluded
```

Delegated / temporary managed excluded store 不取得 own-store exception；brand / store name不得 hardcode。

Current self-view 重用既有 scoped detail rows；historical self-view 重用 trusted `dashboard_summary` retained store row與 selected-month `monthly_targets_summary`，重新套 canonical KPI contract。這條 branch 不會把 excluded row重新標成 Formal eligible，也不把它加入 Ranking / Regional / Annual / Benchmark / Target Coverage。

本次沒有新增 listener / query / point read / polling；historical self-view 維持 Summary-first，不為了自店可見性重新打開 full-month Raw historical read。


# 19. Reporting Completeness vs Observed Actual

Stage C 正式把 Daily reporting completeness 與「已觀測到的實績」拆開：

```text
missing report
!= numeric zero
!= 已回報 store 的 actual 無效
```

因此 partial reporting 可以同時成立：

```text
reportedCount < totalCount
reporting = incomplete
observed cash/accrual/traffic/new customer = numeric（若已回報 rows 本身 valid）
```

這是 business-state separation，不是 UI workaround。

# 20. Documentation canonical path

Project Knowledge Base 的 canonical path 是：

```text
docs/*.md
```

Root 與 `functions/` 下仍可存在歷史副本；它們不得在沒有最新 source gate 的情況下覆蓋 canonical docs。

# 21. Projection Model Authority — Batch 8

Batch 8 把「月底推估」從各 consumer 自己維護歷史曲線，收斂成 Backend-owned derived authority。

```text
previous 3 complete months daily_reports
    │
    ├─ Formal KPI contract
    ├─ Store Lifecycle
    ├─ Reporting Calendar
    └─ System Exclusion
    ▼
functions/projectionAuthority.js
    ▼
projection_models/current
    ├─ Dashboard current-month consumer
    └─ Telegram Current-MTD store consumer
```

## 21.1 Backend writer

Owner：

```text
functions/projectionAuthority.js
```

正式 export：

```text
rebuildProjectionModelNow
calculateHistoricalProjectionCurve
```

`calculateHistoricalProjectionCurve` 保留舊 export 名稱，但 implementation 已不再寫 legacy `settings/projection_curves/stores`。

Writer 只建立 Backend derived model；Firestore client write 被 Rules 封鎖。

## 21.2 Model trust boundary

Consumer 不因文件存在就直接信任。

至少驗證：

```text
projection-model-v1
projection-semantic-v1
kpi-contract-v1
brandId
modelMonth
previous 3 sourceMonths
Lifecycle READY + revision
Reporting Calendar source-month revisions
System Exclusion snapshot
model payload completeness
```

任一 authority stale / missing：

```text
historical model = untrusted
→ current pace fallback
```

這是 fail-closed correctness boundary，不是 UI fallback。

## 21.3 Dashboard consumer

Owners：

```text
src/utils/projectionModelConsumer.js
src/hooks/useDashboardStats.js
```

Current-month Dashboard 只做一個 `projection_models/current` point read，不建立 listener / polling。
目前實績仍由 Current Detail Formal authority 提供；Projection Model 只提供未來 operating days 的歷史 weekday baseline。

未來日期會再經 Lifecycle / Reporting Calendar 判斷，關店日不應被當成應營運日估算。

System Excluded own-store self-view 不能吃 brand historical baseline，避免 self-view 例外重新引入 Formal aggregate scope。

## 21.4 Telegram consumer

Owners：

```text
functions/telegram/projectionConsumer.js
functions/index.js → getStorePerformance()
```

只在 Current MTD 套用 Projection Model。每 execution / brand 以單次 BatchGet 讀：

```text
projection_models/current
store_lifecycle/master
audit_exclusions
```

billed reads = 3 documents；execution cache 避免同一 brand-month 重複讀取。

Store actual / target / achievement 仍服從 Formal KPI / Target authority；Projection authority 不可覆寫 actual。

## 21.5 Consumer parity

Dashboard 與 Telegram 有 regression contract，要求：

```text
same model trust semantics
same current/history blend profile
same VALID_ZERO behavior
same Lifecycle future-day skip
same System Exclusion fail-closed boundary
same Projection range math
```

Therapist Projection 不在 Batch 8C 範圍內。
