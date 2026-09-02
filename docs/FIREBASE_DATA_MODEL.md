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
- Batch 5E-1B 起，base target 的 blank / missing / null 代表 `TARGET_NOT_SET`；明確 numeric `0` 代表 configured `VALID_ZERO`，Frontend 必須保留 0，不能用 deleteField 當成 missing
- challenge target 為 optional；有設定時必須大於同類型 base target，否則 Frontend 阻止寫入
- Frontend 不再直接維護 `monthly_targets_summary`；Derived Target Summary 改由 Backend event-driven writer 生成／修復

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

Batch 3 Backend Derived writer 維護的 target row 至少包含：

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
targets.{storeName}.sourceDocId
targets.{storeName}.canonicalTargetId
targets.{storeName}.isCanonicalSource
targets.{storeName}.authorityConflict
targets.{storeName}.authorityStatus
targets.{storeName}.conflictSourceDocIds
```

### Batch 5E-1B Base Target / Authority refinement

Base target status：

```text
0                  → VALID_ZERO / configured
positive           → VALID / configured
blank/null/missing → TARGET_NOT_SET
negative/malformed → DATA_INVALID
```

Challenge target：

```text
blank / 0 → CHALLENGE_NOT_SET
positive  → only valid when > corresponding valid base target
```

`newASP` 不屬於 monthly base target；仍是 positive-only runtime setting。

Coverage：

```text
VALID / VALID_ZERO → configured
TARGET_NOT_SET      → missing
DATA_INVALID        → invalid
AUTHORITY_CONFLICT  → fail closed
```

若全部 eligible stores 都明確設定 0，該 metric coverage 可以 complete；
aggregate target total = 0，achievement 必須是 `N_A`。

兩份 canonical-equivalent authoritative rows 若語意衝突，Derived Target Summary 會保留：

```text
authorityConflict = true
authorityStatus = AUTHORITY_CONFLICT
conflictSourceDocIds[]
canonicalTargetId
cashTarget / accrualTarget / challenge* = null
```

這不是一般 missing target，consumer 不得以 raw fallback 自動選回其中一份。

### Batch 3 Derived Target Coverage contract

`monthly_targets_summary` 自 Batch 3 起由 Backend `functions/targetCoverage.js` 作為 Derived writer authority。正常 Target 修改事件不掃完整 `monthly_targets` collection，而是只處理受影響月份的單一 Summary document，並讀取單一 `store_lifecycle/master` 判斷該月正式 KPI cohort。

每月 Summary 新增／維護的 coverage metadata 至少包括：

```text
targetCoverageVersion = target-coverage-v1
kpiContractVersion
lifecycleReady
eligibleStoreCount
cashConfiguredStoreCount
accrualConfiguredStoreCount
cashCoverageComplete
accrualCoverageComplete
cashMissingStores[]
accrualMissingStores[]
targetAudit
coverageSource
coverageUpdatedAt / coverageUpdatedAtText
```

為避免尚未切換的新舊 consumer 讀到 stale top-level totals，Backend 每次 canonical target-map 更新時也同步重算既有相容欄位：

```text
brandLabel
year / month
storeCount / targetCount
cashTargetTotal
accrualTargetTotal
sourceDocCount
```

Cash 與 Accrual coverage **獨立判斷**：某店 Cash target 已設定但 Accrual target 未設定時，只能得到 Cash complete / Accrual incomplete，不得合併成一個「有目標就算完整」狀態。

Coverage cohort 來源：

```text
store_lifecycle/master
  datasetStatus = READY
  firstEligibleMonth <= yearMonth
  lastEligibleMonth null OR yearMonth <= lastEligibleMonth
  yearMonth not in exemptMonths
```

Lifecycle 尚未 `READY` 時，coverage metadata 不得被標記為 complete。

`targetAudit` 只報告既有可疑資料，不自動改寫歷史/admin 設定，包含例如：

```text
base target = 0（VALID_ZERO informational；不計入 issueCount）
malformed / negative base target
canonical-equivalent authority conflict
challenge exists without valid base
challenge <= base
```

若舊維護工具或其他 phased writer 改寫 `monthly_targets_summary` 的 target map，Backend Summary onWrite 會重新套用 Lifecycle-aware coverage metadata；自己的 derived write 會避免 recursion。

Challenge aggregate semantics 仍遵守正式 KPI contract：某 eligible store 有合法 challenge 時使用 challenge，未設定 challenge 時回退該店 base target；若 challenge 已設定但不合法，不能偷偷當成「未設定」回退 base，需由 `targetAudit` 顯示並人工修正。

目前既有 Dashboard / Ranking / Annual / Telegram consumer 尚未全部切換直接信任上述新 metadata；consumer migration 依後續 Batch 進行。

---

## 6.3 `kpi_targets`

**類型：Settings / KPI parameter**

`kpi_targets` 維持低成本、品牌隔離的單一 Settings document；App 以既有 1-doc realtime listener 載入，不新增第二條 listener。

目前正式欄位至少包括：

```text
newASP
trafficASP
benchmarks
```

Batch 3 authority rules：

```text
newASP
  > 0                  → valid runtime setting
  blank / missing / 0  → 目標未設定（不以 3500 fallback 寫回 Firestore）

benchmarks.{brandKey}.{category}
  min / max 使用 decimal ratio 儲存
  min finite && min > 0
  max finite && max > min
  invalid → Settings 阻止寫入
  both missing → 該 benchmark 未設定
```

`benchmarks` 必須由 App 的同一份 `kpi_targets` listener 傳入 runtime `targets` state；不得只在 Settings 寫入後由各 consumer 使用不同 hardcoded defaults。

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
revision
updatedAt / updatedAtText
updatedBy / updatedByRole / updatedByAccountId
authorityBrandId
```

Writer authority（`31d8ac6` 已驗證／Git integrated，尚未部署）：

```text
Frontend direct write = DENY
Backend writer = updateTelegramSecurityAlertConfig
Authorization = Firebase Auth + Trusted Device + Super Admin credential
Concurrency = expectedRevision transaction / 409 conflict
```

只有真的有 `security_alerts` 要求 Telegram delivery 時才讀這份 config；正常成功登入不需要每次都讀。控制中心載入 Alerts 分頁時仍只做一筆設定 document read；儲存時 Backend transaction 只讀同一份設定 document，不新增 listener 或 polling。

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

store_lifecycle/master
     │ READY monthly cohort
     ▼
monthly_targets
     │ Backend onWrite
     ├─► monthly_targets_summary
     │      ├─ cash coverage
     │      ├─ accrual coverage
     │      └─ target audit metadata
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

---

# 19. Store Lifecycle v1 — Batch 1 Production Foundation / Batch 1.1 Boundary Correction

> 2026-08-27：Batch 1 Store Lifecycle Foundation 與 Batch 1.1「Existing Store Lifecycle Boundary Fix」均已完成部署與 production confirmation。Batch 3 開始只把 Lifecycle `READY` monthly cohort 接入 Target Coverage authority；Dashboard / Ranking / Annual / Regional / Projection / Telegram 等其他 KPI consumer 仍依後續 Batch 分階段切換。

Store Lifecycle 是獨立於 `org_structure` 的品牌層級 Master，用來保存正式門市 KPI eligibility 與實際營運日期邊界；目前 Dashboard / Ranking / Annual / Regional / Projection / Telegram consumer 仍未切換讀取它。

Physical path：

```text
CYJ
artifacts/default-app-id/public/data/store_lifecycle/master

安妞
brands/anniu/store_lifecycle/master

伊啵
brands/yibo/store_lifecycle/master
```

Master schema：

```text
schemaVersion = store-lifecycle-v1
brandId

datasetStatus
  BUILDING
  READY

revision
stores.{storeKey}

updatedAt
updatedAtText
updatedBy
updatedByRole
updatedByAccountId

READY 時另有：
certifiedAt
certifiedAtText
certifiedBy
certifiedByRole
certifiedByAccountId
```

Store entry：

```text
storeKey
coreStoreName
canonicalStoreName

firstEligibleMonth
lastEligibleMonth
exemptMonths[]
openDate
closeDate

entryStatus
  INCOMPLETE
  COMPLETE
  INVALID

revision
createdAtText
createdBy
createdByAccountId
updatedAtText
updatedBy
updatedByRole
updatedByAccountId
```

日期 canonical format：

```text
Month: YYYY-MM
Date:  YYYY-MM-DD
Business timezone: Asia/Taipei
```

### Lifecycle boundary semantics

Batch 1.1 將兩個時間 authority 明確分開：

```text
openDate
= 門市真實開始營運日期

firstEligibleMonth
= 本 SaaS 正式開始把該門市納入 KPI cohort 的月份
```

因此既有門市允許：

```text
month(openDate) < firstEligibleMonth
```

但不得出現尚未開店就先納入 KPI：

```text
month(openDate) > firstEligibleMonth  => INVALID
```

新開門市通常 `month(openDate) == firstEligibleMonth`。永久結束仍維持 `closeDate` 必須落在 `lastEligibleMonth`，且最後月份仍 eligible。

未來 Daily expected-report resolver 必須同時套用 monthly eligibility 與實際日期 boundary：

```text
monthlyEligible(date.yearMonth)
AND date >= openDate
AND (closeDate is null OR date <= closeDate)
```

因此真實 `openDate` 早於 SaaS 起算月，不會讓 `firstEligibleMonth` 以前的歷史日期變成漏報。

Store Identity：Lifecycle 延續既有 canonical Store Identity；例如 CYJ `新店 / CYJ新店 / CYJ新店店 / DRCYJ新店店` 均歸一為：

```text
storeKey = 新店
coreStoreName = 新店
canonicalStoreName = CYJ新店店
```

Security：

- Frontend signed-in read allowed。
- Frontend direct write denied by Firestore Rules。
- Write authority = `manageStoreLifecycle` Backend endpoint。
- Backend 再驗證 Firebase ID Token + Trusted Device + current Super Admin / Master credential。
- Backend 使用 Firestore transaction + per-store revision 防止同店 multi-admin silent overwrite。

Read cost：Batch 1 Lifecycle UI 只在使用者開啟該管理分頁時 `getDoc()` 一份 `master`；不新增 polling、per-store listener 或 App-level persistent listener。

Compatibility / Safety：

```text
datasetStatus READY
!= KPI consumer cutover
```

Batch 1 / 1.1 不修改任何既有 Raw、Target、Summary、Queue 或 `org_structure` 資料。Boundary Fix 只修正 Lifecycle validation / derived `entryStatus` 語意；Consumer 切換仍屬後續 Batch。

`entryStatus` 是由 Lifecycle 欄位與當前規則衍生的狀態，不應被當成獨立人工 authority；讀取 normalization 應依當前規則重新計算，避免舊版 validation 留下過時的 `INVALID` / `COMPLETE` 狀態。

# 20. Target Authority / Coverage — Batch 3（PRODUCTION CONFIRMED）

新增 Backend derived owner：

```text
functions/targetCoverage.js
```

新增 Firestore event handlers（由 `functions/index.js` export）：

```text
onLegacyMonthlyTargetChange
onBrandMonthlyTargetChange
onLegacyMonthlyTargetSummaryChange
onBrandMonthlyTargetSummaryChange
onLegacyStoreLifecycleCoverageChange
onBrandStoreLifecycleCoverageChange
```

Steady-state normal Target write cost：每個受影響 Store×Month 主要為 `monthly_targets_summary/{yearMonth}` + `store_lifecycle/master` 的小範圍讀取，再寫回單一 Target Summary；legacy alias migration 才可能額外 point-read canonical target。沒有新增 Frontend persistent listener、polling 或每次正常 Target write 的 full `monthly_targets` collection scan。

Lifecycle `BUILDING → BUILDING` 的大量初始化不掃 Target Summary；只有 READY 進出或 READY 期間 Lifecycle cohort 改變時，才低頻掃描既有 `monthly_targets_summary` documents 重新計算 coverage metadata。

此 Batch 不修改 Firestore Rules，Admin SDK derived writer 沿用既有品牌實體 root。

2026-08-28 已完成 6 支 Target Coverage Functions 與 Frontend 正式部署，Production smoke test 已確認 blank target 不寫 numeric `0`、Cash / Accrual coverage 可獨立 complete/incomplete、清空 target 會反向更新 coverage、challenge 必須大於 base。詳細 runtime 狀態以 `CURRENT_STATE.md` 為準。


---

# 21. Summary Semantics v1 — Batch 4（IMPLEMENTED / ISOLATED VALIDATED / NOT DEPLOYED）

Batch 4 對 `dashboard_summary` / `rankings_summary` 採 **additive semantic migration**。既有 legacy 欄位暫時保留給 Batch 5 前 consumer，不把舊欄位原地換成新語意。

新增 pure semantic owner：

```text
Frontend  src/utils/summarySemantics.js
Backend   functions/summarySemantics.js
Regression tests/summarySemantics.test.js
```

`dashboard_summary/{YYYY-MM}` 新增的 top-level semantic metadata：

```text
semanticVersion = summary-semantics-v1
kpiContractVersion
targetAuthoritySource
targetCoverage
formalTargetAuthority
lifecycleSnapshot
formalStoreRankings
formalRankEligibleStoreCount
```

`stores.{store}` 與 `grandTotal` 在保留既有 `cash / accrual / refund / skincareRefund / operationalAccrual` 的前提下，新增 explicit fields / status：

```text
grossCash
grossCashStatus
refundStatus
skincareRefundStatus
formalNetCash
formalNetCashStatus

totalAccrual
totalAccrualStatus
operationalAccrualStatus
formalAccrual
formalAccrualStatus
formalAccrualSource

formalCashTarget
formalCashTargetStatus
formalCashAchievement
formalCashAchievementStatus
formalAccrualTarget
formalAccrualTargetStatus
formalAccrualAchievement
formalAccrualAchievementStatus
formalLifecycleEligible
formalRankEligible
formalCashAchievementRank
```

語意：

```text
grossCash = Raw cash
formalNetCash = cash - refund - skincareRefund

安妞：
  totalAccrual  = Raw accrual（總權責業績）
  formalAccrual = operationalAccrual（權責業績）

CYJ / 伊啵：
  totalAccrual  = Raw accrual
  formalAccrual = Raw accrual
```

Formal brand/scope achievement 只在對應 KPI 的 Batch 3 coverage 經 `kpi-contract-v1` + Lifecycle READY cohort 驗證一致時成立；Cash / Accrual 各自獨立。Coverage incomplete 是正式 business state，**不會因 incomplete 本身而 full-scan `monthly_targets`**。

`rankings_summary/{YYYY-MM}` 保留 legacy cash-amount rank，同時新增 `formalStoreRankings`，正式排序依：

```text
formalNetCash / valid cashTarget
```

缺目標、KPI invalid、Lifecycle 非 eligible 不進 formal rank；真實 0 與負數 net cash 仍可 rank-eligible。

### Summary document size boundary

Batch 4 **不把 explicit semantic fields 複製到每店 × 每日 `storeDailyTotals` row**。既有 `dashboard-summary-v2` 的 `storeDailyTotals` legacy shape 保留，避免單一 Summary document 因 store×day 欄位膨脹接近 Firestore 1 MiB 上限。

### Writer / Trust

正式上存在兩個 writer：

```text
Backend auto repair
functions/index.js

Frontend Maintenance manual rebuild
src/components/SystemMaintenance.jsx
```

兩者都必須使用同一組 parity-protected Summary Semantics contract。Maintenance manual writer 保留 `dashboard-summary-v2` / `storeDailyTotals`，不得用較舊 payload 覆蓋掉 Backend v2 curve。

Batch 4 compare 改為 Summary 三文件寫入後重新讀取 persisted：

```text
dashboard_summary
therapist_summary
rankings_summary
```

再與同次 Raw rebuild payload 比較。不可用 freshly-built object 自己跟自己比後標 verified。

本 Batch 不修改 Firestore Rules、不新增 collection、不修改 Raw schema。

# 22. Batch 5E-1A / 5E-1A.1 — Legacy Zero Placeholder + Target Summary Replacement Semantics（PRODUCTION CONFIRMED）

## Raw `monthly_targets` cleanup result

2026-08-31 Production read-only inventory：

```text
CYJ  numeric-zero base target docs = 0
安妞 numeric-zero base target docs = 0
伊啵 numeric-zero base target docs = 27
```

使用者確認伊啵 27 docs 為 legacy/unset placeholder，不是 intentional configured zero。

經 fail-closed migration：

```text
伊啵 Raw placeholder docs 27 → 0
remaining explicit-zero Raw docs = 0
```

沒有跨品牌 Raw mutation。

## `monthly_targets_summary.targets` persisted-map rule

Batch 5E-1A.1 修正一個 Derived writer data-model bug。

錯誤模式：

```text
delete targetMap[store]
+
set({ targets: targetMap }, { merge:true })
```

Firestore nested-map merge 可能保留舊的：

```text
targets.<store>
```

因此從 5E-1A.1 起，canonical `monthly_targets` event writer 對 Summary target map 使用：

```text
read existing Summary in transaction
→ preserve unrelated top-level fields
→ construct complete canonical targets map
→ construct complete replacement Summary document
→ set(..., { merge:false })
```

這個 full-document replacement **不是**把 Summary 其他 top-level data 丟棄；replacement document 以 transaction 讀到的 existing Summary 為底，再覆蓋由 Target Coverage authority 管理的 fields。

Concurrency：

```text
transaction read Summary
→ concurrent change before commit
→ Firestore transaction retry
→ rebuild from fresh Summary
```

## Production derived repair

受舊 merge semantics 影響的伊啵 11 個 Summary：

```text
2026-01～07（不含 08）
2026-09～12
```

由 secured temporary endpoint 做 bounded Derived repair。

Execute：

```text
Raw target deletes     = 0
Summary writes         = 11
repairedMonths         = 11
```

Verify：

```text
verified                       = true
remainingExplicitZeroDocIds    = []
stale matchingRows             = []
lingeringStores                = []
targetAuditIssueCount          = 0
targetAuditZeroBaseTargets     = []
```

2026-09～12：

```text
eligibleStoreCount          = 5
configured cash/accrual     = 1 / 1
coverage complete           = false / false
missing stores              = 4
```

所以 Derived repair 沒有把尚未設定 target 的 store 改成 configured zero。

## Temporary endpoint

```text
normalizeLegacyZeroTargetPlaceholders
```

角色：

- 5E-1A exact 27-doc fail-closed Raw normalization；
- 5E-1A.1 post-delete exact 11-month fail-closed Derived repair；
- dry-run / verify 為 0 writes；
- 不是一般營運 CRUD authority。

完成 5E closeout 後應評估移除／退役，避免一次性 mutation endpoint 永久保留。

## Contract boundary

本段資料清理**不代表**已支援 intentional base target `$0`。

目前 production runtime：

```text
base target numeric 0 → TARGET_NOT_SET
```

Batch 5E-1B 才會正式處理：

```text
field missing / blank → TARGET_NOT_SET
explicit configured 0 → VALID_ZERO
```

在 5E-1B Production Confirmed 前，不可把 numeric zero 當成新的正式 configured-target schema。

---

# Batch 5 Final Addendum — `monthly_targets_summary` Metadata Integrity

`monthly_targets_summary/{YYYY-MM}` 的 `targets` map 與 Coverage contract 是同一 Derived document 中的兩種 authority surface，但完整性判斷不能只看 target map 是否變更。

## Coverage metadata completeness invariant

至少需維持：

```text
targetCoverageVersion = target-coverage-v1
kpiContractVersion    = kpi-contract-v1
brandId / yearMonth   = exact match
lifecycleReady        = boolean

eligibleStoreCount
cashConfiguredStoreCount
accrualConfiguredStoreCount
→ finite non-negative

cashCoverageComplete
accrualCoverageComplete
→ boolean

cashMissingStores
accrualMissingStores
→ arrays

targetAudit
→ object

coverageSource
coverageUpdatedAtText
→ non-empty
```

`coverageSource` 可以來自正常 event writer 或受控 metadata migration；只要完整 contract 與 identity/version 相容，不應因 source 名稱不同就無條件重寫。

## Same-map metadata-loss self-heal

若 persisted Summary：

```text
targets map unchanged
+
Coverage metadata missing / incompatible
```

Backend `functions/targetCoverage.js` 不得 blind-return。

正確 flow：

```text
Summary onWrite
→ transaction read CURRENT Summary
→ transaction read CURRENT store_lifecycle/master
→ rebuild compatibility + Coverage metadata
→ merge metadata only
```

Recovery **不得**寫 `targets`。

這可避免 stale trigger event 在 concurrent writer 之後覆蓋較新的 target authority；Firestore transaction retry 負責 race protection。

## Reads / writes

Normal Raw target writer：

```text
額外 reads = 0
```

Exceptional metadata self-heal：

```text
2 transaction point reads
1 Summary merge write
```

沒有新增 collection、path、listener、query、polling 或 Rules。

## Physical path isolation

```text
CYJ:
artifacts/default-app-id/public/data/
  monthly_targets_summary/{YYYY-MM}
  store_lifecycle/master

安妞 / 伊啵:
brands/{brandId}/
  monthly_targets_summary/{YYYY-MM}
  store_lifecycle/master
```

Self-heal 不跨 brand root。

## Zero target final contract reminder

```text
explicit base 0 → VALID_ZERO / configured
missing         → TARGET_NOT_SET
denominator 0   → N_A
AUTHORITY_CONFLICT → fail closed
```

Legacy Yibo placeholder zero cleanup 是歷史 migration evidence，不可反向把 future intentional zero 定義回「未設定」。
