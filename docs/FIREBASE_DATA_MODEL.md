# FIREBASE_DATA_MODEL.md

> Project Knowledge Base / 第二層文件  
> 由原 2026-08-18 Data Model 基線，加上截至 2026-08-25 已正式確認／已驗證的 Security sources 整併。  
> 本文件描述「目前程式實際讀寫到的 Firestore logical model」，不是 Firebase Console 的完整 schema 匯出。  
> 若某欄位未被目前正式程式讀寫，本文件不自行猜測。

---

# 1. 資料路徑總則

目前前端透過 `App.jsx` 的兩個 resolver 統一處理大多數品牌資料：

```text
getCollectionPath(collectionName)
getDocPath(docName)
```

## CYJ legacy path

Collection：

```text
artifacts/{appId}/public/data/{collectionName}
```

Global settings document：

```text
artifacts/{appId}/public/data/global_settings/{docName}
```

## 安妞／伊啵 standard path

Collection：

```text
brands/{brandId}/{collectionName}
```

Settings document：

```text
brands/{brandId}/settings/{docName}
```

其中前端 `appId` 預設 fallback 為：

```text
default-app-id
```

若環境有注入 `window.__app_id` / `__app_id`，則使用注入值並把 `/` 轉成 `_`。

> 注意：不要把 CYJ 與新品牌的實體 Firestore root 視為相同。  
> 跨品牌功能應優先透過 path resolver，而不是在頁面硬寫路徑。

---

# 2. 文件分級

本文件使用三種標記：

- **Collection**：目前程式有實際 collection read/write。
- **Settings Doc**：透過 `getDocPath()` 或 `global_settings` 存放。
- **Derived Data**：由 Raw / backend worker / aggregation 產生，不應被當成原始輸入資料。

---

# 3. 營運 Raw Data

## 3.1 `daily_reports`

**類型：Collection / Raw Source**

主要用途：

- 店家日報
- Dashboard 當月即時資料
- DailyView
- HistoryView
- AuditView
- Regional / Store / Ranking 分析
- Telegram 店家 KPI
- Summary / monthly aggregate 的來源

目前可由正式程式確認的常見欄位：

```text
date
storeName / store
cash
accrual
operationalAccrual
skincareSales
skincareRefund
traffic
newCustomers
newCustomerClosings
newCustomerSales
refund
```

其他 metadata 會依輸入流程存在，例如操作人、代理資訊、更新時間等。

### Source-of-truth 原則

對歷史店家營運資料，`daily_reports` 是 Raw Source of Truth。

Derived data 若不一致：

```text
daily_reports
  ↓
normalize / identity
  ↓
monthly_aggregated / Summary
```

應先追上游，不要直接猜哪份 Summary 正確。

### Store Identity

歷史 `daily_reports` 可能保留 legacy storeName。

特別是 CYJ 新店：

```text
CYJ新店
CYJ新店店
```

歷史 Raw 不因 canonical 治理而批次改名。詳見：

```text
DATA_IDENTITY_RULES.md
```

---

# 4. Therapist Raw Data

## 4.1 `therapist_daily_reports`

**類型：Collection / Raw Source**

主要用途：

- 管理師日報
- 管理師 Dashboard
- DailyView 人員模式
- HistoryView
- AuditView
- Telegram 個人 KPI
- therapist monthly aggregation / summary

目前可由正式 HistoryView 確認的核心欄位：

```text
date
therapistId
therapistName
storeName
totalRevenue
newCustomerRevenue
newCustomerCount
newCustomerClosings
oldCustomerRevenue
oldCustomerCount
returnRevenue
```

### Source Authority

Telegram Agent 已明確定義：

```text
店家 KPI      → daily_reports
管理師個人 KPI → therapist_daily_reports
```

不得把店家日報的新客數當作某位管理師個人 KPI 的分母／分子。

---

# 5. 月度彙總

## 5.1 `monthly_aggregated`

**類型：Collection / Derived Data**

由店家日報 aggregation / recalibration 產生。

常見識別：

```text
yearMonth
storeName
```

Document key 常見設計：

```text
YYYY-MM_{storeName}
```

目前 backend 對 CYJ 新店有 canonical guard：

```text
YYYY-MM_CYJ新店店
```

### 使用定位

- 年度／月度省讀取資料來源
- Telegram fallback
- 月結／校準
- 歷史資料備援

### 限制

當月即時資料若可以讀到 `daily_reports`，不能因為 `monthly_aggregated` 比較省而假設它一定比即時 Raw 更新。

正式 Telegram backend 已把當月 `monthly_aggregated` 定義為 fallback。

---

## 5.2 `therapist_monthly_aggregated`

**類型：Collection / Derived Data**

由 `therapist_daily_reports` onWrite aggregation 更新。

目前 backend 對 create / update / delete 以差額方式調整人員月彙總。

主要識別：

```text
year
yearMonth
therapistId
therapistName
storeName
```

實績欄位依 therapist daily report 聚合。

---

# 6. Store Targets

## 6.1 `monthly_targets`

**類型：Collection / 原始目標設定**

Document ID 主要由：

```text
{canonicalStoreName}_{year}_{month}
```

形成。

目前 TargetView：

- 讀取：canonical 優先、legacy fallback
- 寫入：只寫 canonical
- 若讀到特定 legacy CYJ 新店 key，重新儲存時安全遷移

### 主要 target fields

```text
cashTarget
accrualTarget
challengeCashTarget
challengeAccrualTarget
isUnlocked
updatedAt
updatedBy
```

### 高成本資料源

App 已將完整 `monthly_targets` listener 限制在真正需要的功能：

```text
年度目標設定
回報檢核 > 店家目標
```

Dashboard / Ranking / Annual 優先使用 Summary。

---

## 6.2 `monthly_targets_summary`

**類型：Collection / Derived Target Summary**

Document ID：

```text
YYYY-MM
```

目前 TargetView 寫入的 row 至少包含：

```text
brandId
brandLabel
yearMonth
updatedAt
updatedAtText
updatedBy
source
targets.{storeName}.storeName
targets.{storeName}.cashTarget
targets.{storeName}.accrualTarget
targets.{storeName}.challengeCashTarget
targets.{storeName}.challengeAccrualTarget
targets.{storeName}.isUnlocked
```

### 完整性規則

正式 backend 在使用 target Summary 前會檢查正式店家 coverage。

有正式店家 roster 時：

```text
逐店有效目標完整
```

才可視為 complete。

全 0 active-store target 不應被誤判成完整有效 coverage。

若不足：

```text
monthly_targets_summary
  ↓ fallback
dashboard_summary target map
  ↓ fallback
monthly_targets raw
```

---

## 6.3 `kpi_targets`

**類型：Settings / KPI parameter**

App 註解顯示 `kpi_targets` 已拆成低成本、獨立常駐 1-doc 類型讀取，
目的為避免完整 monthly target listener 為了 KPI 參數常駐。

目前本批正式來源未提供完整欄位 schema，因此不在本文件自行列欄位。

---

# 7. Dashboard Summary

## 7.1 `dashboard_summary`

**類型：Collection / Derived Data**

Document ID：

```text
YYYY-MM
```

主要用途：

- 歷史月份 Dashboard
- Telegram verified historical data
- Annual KPI summary 的 completed-month source
- Ranking / Regional / Annual historical summary path

重要結構目前程式可確認包含：

```text
yearMonth
stores
grandTotal
storeRankings
updatedAt / updatedAtText
```

實際 payload 還有更多欄位，應以 builder function 為準。

### 使用條件

歷史月份不是「有 document 就能用」。

必須配合：

```text
summary_recalc_flags/{YYYY-MM}
```

確認 verified / not dirty / mismatch=0。

---

## 7.2 `rankings_summary`

**類型：Collection / Derived Data**

與 Dashboard Summary repair flow 同屬歷史月結衍生資料。

目前 AppContext 有：

```text
currentRankingsSummary
```

History dirty backend 的註解也明確把它與：

```text
dashboard_summary
therapist_summary
```

一起視為需要避免「明細已改但仍維持 verified」的衍生資料。

本批來源未完整展開 rankings_summary payload schema，因此只記錄其資料角色，不猜欄位。

---

## 7.3 `therapist_summary`

**類型：Collection / Derived Data**

用途：

- 歷史月份人員績效 Summary
- Telegram historical therapist source
- Dashboard historical therapist view

當月人員績效仍應使用即時 detail，而不是 Summary，以避免今日回報後排名不即時。

---

# 8. Summary Trust / Recalculation

## 8.1 `summary_recalc_flags`

**類型：Collection / Summary trust state**

Document ID：

```text
YYYY-MM
```

目前前端／後端可確認的重要欄位概念：

```text
status
dirty
lastMismatchCount / mismatchCount
lastCompletedAtText / completedAtText
lastDirtyAtText
rebuildAfterAtText
updatedAtText
```

### Dashboard trust

歷史 Summary 信任條件之一：

```text
status = completed / verified
dirty != true
mismatch = 0
```

正式 Dashboard 已允許 backend worker 寫回 verified 後直接恢復 Summary，
不再強制依賴 Maintenance compare log 的時間先後。

---

## 8.2 `recalc_queue`

**類型：Collection / recalculation work queue**

可能來源：

```text
daily report historical change
therapist daily historical change
monthly target update
```

TargetView 目前寫入的 queue metadata 至少包括：

```text
status = pending
affectedYearMonth
sourceType
sourceId
storeName
reason
createdAt
createdAtText
createdBy
createdByRole
```

### 角色

目前 backend 註解明確指出：

```text
summary_recalc_flags = 正常歷史異動主流程
recalc_queue fallback = 防漏保險
```

Queue fallback 不應被理解成每次正常 Summary repair 唯一來源。

---

## 8.3 `summary_worker_state`

**類型：Collection / Worker State**

目前 backend 使用其中一個 state doc：

```text
recalc_queue_fallback_scan
```

保存：

```text
cursorDocId
lastRunMs
nextRunAfterMs
nextRunAfterAtText
scanMode
lastPageSize
wrappedToStart
...
```

目的：

- queue fallback 分頁
- 不反覆卡在固定前幾十筆
- backlog catch-up

---

# 9. Annual KPI

## 9.1 `annual_kpi_summary`

**類型：Collection / Derived Data**

Document ID：

```text
YYYY
```

正式 backend builder：

```text
rebuildAnnualKpiSummaryForBrand()
```

主要來源：

```text
該年度已完成月份的 dashboard_summary
前一年 annual_kpi_summary
前一年 12 月 dashboard_summary
annualAverageSettings
```

主要用途：

- 建立年度平均基準
- 判斷 established store
- Dashboard annual KPI benchmark

若某月份 `dashboard_summary` 不存在，builder 會記為 skipped month，
不應自行用未知來源填補。

---

# 10. Organization / Accounts

## 10.1 `org_structure`

**類型：Settings Doc**

正式組織架構 Source。

目前至少包含：

```text
managers
managerOrder
```

Store ↔ manager 的正式關係應以這裡為主，而不是 delegation。

---

## 10.2 `store_account_data`

**類型：Settings Doc**

店經理帳號資料來源。

App 會一次載入正式帳號目錄。

目前完整 account schema 不在本文件猜測；正式 Login / Settings 程式為準。

---

## 10.3 `manager_auth`

**類型：Settings Doc**

區長帳號／密碼資料。

知識文件不記載實際密碼值。

---

## 10.4 `trainer_auth`

**類型：Settings Doc**

目前支援：

```text
accounts
trainerOrder
legacy single-password compatibility
active status
```

知識文件不記錄實際 default password。

---

## 10.5 `director_auth`

**類型：Settings Doc**

目前支援：

```text
accounts
directorOrder
level
isActive
```

知識文件不記錄實際 password。

---

## 10.6 `master_auth`

**類型：Settings Doc**

最高管理帳號。

本 Knowledge Base 僅記錄它存在與使用角色，不保存 credential。

---

## 10.7 `permissions`

**類型：Settings Doc**

Menu / view permission 設定來源之一。

實際 view access 還會再受：

- role
- director level
- feature flags

共同影響。

---

# 11. Delegation

## 11.1 `management_delegations`

**類型：Collection**

正式 organization 不被 delegation 改寫。

Delegation schema 至少要求：

```text
schemaVersion
type

principalRole
principalId
principalName

delegateRole
delegateId
delegateName

scopeMode
storeNames
principalStoreSnapshot

startDate
endDate
status
permissions

updatedByRole
```

常見 permissions：

```text
viewOperations
editReports
editHistory
deleteReports
receiveAlerts
manageTasks
editTargets
editOrganization
```

其中：

```text
editOrganization = false
```

是系統治理規則。

### Firestore Rules

兩種品牌路徑皆：

```text
read          → signedIn
create/update → signedIn + validDelegation
delete        → forbidden
```

結束 delegation 應保留歷史狀態，不硬刪。

---

# 12. Therapist Master / Targets / Schedule

## 12.1 `therapists`

**類型：Collection / Master Data**

App global account directory 必要資料。

目前 normalization 會補：

```text
id
store / storeName
manager / managerName
normalizedStoreCore
```

實際 master 還有 account / status 等欄位，由 TherapistManagerView 管理。

---

## 12.2 `therapist_targets`

**類型：Collection**

管理師年度／月目標來源。

由 TherapistTargetView 管理。

完整 doc ID / payload schema 本批來源未全部展開，因此不猜。

---

## 12.3 `therapist_schedules`

**類型：Collection**

管理師排休來源。

由 TherapistScheduleView 管理。

---

# 13. Audit / Feature / Security Settings

## 13.1 `audit_exclusions`

**類型：Settings Doc**

回報檢核排除設定。

Daily / Audit / Ranking 等功能會依需求讀取或套用。

---

## 13.2 `security_config`

**類型：Settings Doc**

App normalization currently recognizes session / low-power keys plus Device Approval policy:

```text
enabled
timeoutMinutes
warningSeconds
exemptRoles
lowPowerEnabled
lowPowerIdleMinutes
autoLogoutEnabled
autoLogoutMinutes
logoutWarningSeconds

deviceApprovalMode
deviceApprovalRoles
deviceApprovalExpiryMinutes
allowTrustedDeviceSelfApproval
```

目前 App 預設 Device Approval values：

```text
deviceApprovalMode = off
deviceApprovalRoles = director, trainer, manager, store, therapist
deviceApprovalExpiryMinutes = 15
allowTrustedDeviceSelfApproval = true
```

See `AUTH_AND_SECURITY.md` for behavior and deployment safety boundaries.

## 13.3 `feature_flags`

**類型：Settings Doc**

目前正式可確認：

```text
therapistModuleEnabled

annualAverageSettings:
  brandStartMonth
  autoDetectFirstCompleteMonth
  excludePartialFirstMonth
  storeStartMonthOverrides
```

---

# 14. Device / Security Data

## 14.1 `account_devices`

**類型：品牌範圍 Collection**

每個 account profile 保存一份 devices map，常見 logical fields：

```text
brandId
brandLabel
role
accountId
userName
updatedAt / updatedAtText

devices.{deviceId}:
  deviceId / deviceShort / stableDeviceId
  deviceFingerprint / deviceStorageStatus
  device / browser / os
  trusted
  status
  source
  firstSeenAt / firstSeenAtText
  lastSeenAt / lastSeenAtText
  loginCount
  loginLocation
  firstLoginLocation
  lastLoginLocation
  review metadata
```

可能的 Security state 包含 `trusted`、`new`、`observing`、`reverify_required`、`suspicious`、`blocked` 與 global-block 相關狀態。

---

## 14.2 `device_approval_requests`

**類型：品牌範圍 Collection / Security Workflow**

用途：

```text
one account + one target device
→ pending / resolved Device Approval request
```

常見 logical fields：

```text
requestId
brandId
accountKey
role
accountId / credentialAccountId
userName
deviceId / deviceShort
device / browser / os
loginLocation
status
approvalMode
selfApprovalAllowed
hasTrustedApproverDevice
likelyKnownDevice
requestedAtText
lastAttemptAtText
expiresAtMs / expiresAtText
resolvedBy / resolvedRole / resolvedAtText
```

Private verification material is stored beneath the request in a private verification document/subcollection and is not a normal public workflow field.

---

## 14.3 `device_approval_inbox`

**類型：品牌範圍 Collection / 每帳號小型 Summary**

Document id:

```text
{accountKey}
```

用途：

```text
small pending count for the signed-in account
→ Header Badge / Guided Device Approval trigger
```

目的就是避免只為了知道「是否有待確認」而讀完整 device history。

---

## 14.4 `security_summary`

**類型：品牌範圍 Collection / 小型 Summary Documents**

重要 documents：

```text
device_approvals
device_alerts   (legacy / earlier alert summary use)
```

`device_approvals` is the realtime brand summary used by the v3.5.3 App for highest-manager pending count.

已驗證的 Summary-first 套件新增最高管理者協助欄位：

```text
adminAssistancePendingCount
adminAssistancePendingItems
latestAdminAssistanceRequestId
latestAdminAssistanceUserName
latestAdminAssistanceRole
latestAdminAssistanceDevice
latestAdminAssistanceAtText
```

These additional fields are implemented / validated but must not be labeled production-active until `CURRENT_STATE.md` confirms deployment.

---

## 14.5 `security_alerts`

**類型：品牌範圍 Collection / Security Event**

目前已驗證的 Login Security event 類型：

```text
password_failed_threshold
device_code_failed_limit
manager_assistance_required
self_reported_not_me
rapid_multi_location_login
blocked_device_login
```

Security-alert documents may request Telegram delivery using event metadata such as:

```text
telegramSecurityType
notifyTelegram
telegramDeliveryStatus
severity
status
brandId / brandLabel
accountKey
user / role / device / location context
```

正常 Trusted login 與正常成功 self-verification 不需要建立 Telegram Security Alert。

---

## 14.6 `login_security_state`

**類型：品牌範圍 Collection / Backend-only Security State**

用途：

```text
password-failure window / counters
successful-login security observation
Telegram alert cooldown timestamps
```

Frontend broad read/write should not be allowed for this collection.

Successful-login location risk logic reuses the already-read `account_devices` profile where possible instead of adding an extra Firestore read solely for location comparison.

---

## 14.7 `global_blocked_devices`

**類型：跨品牌 Security Collection**

用途：

```text
hard block a device identity across brands
```

這與 `account_devices` 裡的品牌內 blocked state 刻意分開。

---

## 14.8 `system_logs`

**類型：Collection / 近似不可變更 Audit Log**

App writes fields such as:

```text
timestamp
createdAtText
role
user
action
details
loginLocation
activityType
view
device
browser
os
deviceId
deviceShort
isNewDevice
deviceTrusted
riskTags
brand
brandLabel
```

### Firestore Rules

```text
create/read  → signedIn
update/delete → forbidden
```

Do not design an audit correction that requires clients to rewrite old log entries.

---

## 14.9 `system_stats`

**類型：Collection**

Login activity can increment:

```text
system_stats/{YYYY-MM-DD}
```

這是統計資料，不是 Device Approval authority。

---

# 15. Maintenance Data

目前可確認：

## `maintenance_logs`

維護操作／Audit 記錄。

例如：

```text
core_data_consistency_audit
org_structure_restore
```

---

## `maintenance_backup_logs`

維護中心讀取的備份紀錄來源。

---

## `org_structure_snapshots`

組織架構快照。

還原前會先再建立一份 `before_restore_org_structure` snapshot，
降低誤還原風險。

---

## `read_debug_sessions`

全域 Firestore read tracking sessions。

新版資料可包含：

```text
hourlyBuckets
sources
```

舊版 session 若沒有 hourlyBuckets，只能做較粗略的時間範圍分析。

---

## `read_tracker_config`

ReadTracker 排程／模式相關設定來源。

---

# 16. Telegram / Notification Data

Telegram 主動預警與 Policy Center 有一個重要特殊點：

```text
固定使用 CYJ legacy root：
artifacts/default-app-id/public/data
```

不是跟著 UI currentBrand 切換 root。

---

## 16.1 `global_settings/telegram_active_alerts`

主動預警設定。

主要概念：

```text
enabled
sendTime
weekdays
brandIds
chatTargets
brandProfiles
sendWhenClear
pausedUntil
timezone
```

---

## 16.2 `global_settings/telegram_active_alert_status`

主動預警最後執行狀態。

---

## 16.3 `telegram_alert_commands`

前端控制中心送給 backend 的 command queue。

---

## 16.4 `telegram_agent_policies`

長期營運規則。

Policy 類型至少包括：

```text
exclude_store
alert_rule
response_preference
```

---

## 16.5 `telegram_agent_policy_audits`

Policy 變更 audit。

---

## 16.6 `global_settings/telegram_agent_policy_permissions`

Telegram Policy Center 權限。

Backend 會解析：

```text
director
brand_manager
viewer
```

等 policy-role 概念。

---

## 16.7 `telegram_agent_sessions`

短期對話記憶與 scope state。

Document key 由：

```text
chatId + userId
```

產生。

目前保存：

```text
turns
state
learningCandidates
lastLearningSuggestion
pending actions / temporary policy state
version
updatedAt
updatedAtText
```

保留最後 8 turns。

---

## 16.8 `telegram_agent_logs`

Agent query / answer audit。

至少記錄：

```text
version
replyFormat
replyMode
guard versions
model / API metadata
toolCalls
sources
warnings
readCount
writeCount
usage
duration
error
```

---

## 16.9 `notification_rules`

**類型：Root Collection**

目前 Telegram V5 schedule 由 root：

```text
notification_rules
```

讀寫。

它不是品牌 path resolver collection。

---

## 16.10 `telegram_report_snapshots`

不可變／可重現報表快照來源。

至少可保存：

```text
reportType
scheduleId
scheduleCode
scheduleName
runKey
cutoffDate
cutoffAtText
policyIds
brandPayloads
messagePreview
sourceMeta
readCount
snapshotId
metricVersion
```

---

## 16.11 `telegram_agent_tasks`

改善任務。

狀態：

```text
open
in_progress
completed
cancelled
overdue
```

可由 Telegram callback / natural language workflow 更新。

---

## 16.12 `telegram_agent_task_audits`

任務異動 audit。

---

## 16.13 `telegram_agent_task_drafts`

主動巡察產生的待確認 task draft。

---

## 16.14 `telegram_schedule_audits`

排程變更／執行相關 audit。

---

## 16.15 `global_settings/telegram_security_alerts`

**Type: Security Telegram Settings Doc**

此設定與一般營運 Telegram Agent／Alert 設定分離。

常見 logical fields：

```text
enabled
chatTargets
configVersion
updatedAtText
```

只有真的有 `security_alerts` 要求 Telegram delivery 時才讀這份 config；正常成功登入不需要每次都讀。

Security delivery is handled by Firestore creation triggers for both the CYJ legacy security-alert path and standard-brand security-alert path.

---

# 17. Collections 的資料角色圖

```text
                    ┌──────────────┐
                    │ org_structure │
                    └──────┬───────┘
                           │ roster / manager
                           ▼
daily_reports ─────────► Dashboard / Analysis
     │                     │
     │ onWrite             │ current month
     ▼                     │
monthly_aggregated         │
     │                     │
     └──────────┬──────────┘
                ▼
        dashboard_summary
                │
                ├─ historical Dashboard
                ├─ Telegram historical
                └─ annual_kpi_summary

monthly_targets
     │
     ├─► monthly_targets_summary
     │
     └─► recalc_queue
              │
daily history change
     │        │
     ▼        ▼
summary_recalc_flags
              │
              ▼
      Summary Repair Worker

therapist_daily_reports
     │
     ├─► therapist_monthly_aggregated
     └─► therapist_summary
```

---

# 18. Schema 維護原則

未來若新增 collection / doc：

1. 先確認它是 Raw、Master、Settings、Derived、Queue、Audit 中哪一類。
2. 若是跨品牌資料，明確定義 CYJ legacy / standard path。
3. 若是 Derived Data，文件要寫明 Raw Source。
4. 若是 Queue / Worker State，寫明正常主流程與 fallback 關係。
5. 若是 Audit Log，寫明能否 update/delete。
6. Schema 改變後同步更新本文件。
7. 不把 Firebase Console 中未提供給專案的欄位靠 AI 猜進文件。
