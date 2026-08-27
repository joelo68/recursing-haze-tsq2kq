# DATA_FLOW.md

> 本文件把目前正式系統的「資料從哪裡來、經過什麼、最後去哪裡」串成可追查流程。  
> 用途：未來某頁數字錯時，先沿資料流找上游，不要直接在畫面補判斷。

---

# 1. 核心原則

系統資料可分：

```text
Master / Settings
Raw Input
Derived Data
Trust State / Queue
Presentation
Audit / Observability
```

問題診斷時：

```text
Presentation
  ↑
Derived
  ↑
Raw
  ↑
Master / Identity
```

由下往上追。

---

# 2. Brand / Path Flow

```text
currentBrand
   │
   ▼
App.getCollectionPath / getDocPath
   │
   ├─ CYJ
   │   artifacts/{appId}/public/data
   │
   └─ 安妞 / 伊啵
       brands/{brandId}
```

因此同一 logical collection：

```text
daily_reports
monthly_targets
system_logs
...
```

實體 path 可能不同。

---

# 3. Organization Flow

```text
SettingsView
   │
   ▼
org_structure
   │
   ├─ managers
   └─ managerOrder
   │
   ▼
App
   │
   ├─ visibleManagers
   ├─ sorting
   ├─ store ownership
   └─ access scope
```

---

# 4. Delegation Flow

```text
SettingsView
   │
   ▼
management_delegations
   │
   ▼
delegationResolver
   │
   ▼
App delegationAccess
   │
   ├─ accessibleStores
   ├─ delegatedStores
   ├─ canEditStoreReport
   └─ getActiveDelegationForStore
   │
   ▼
Dashboard / Input / History / Daily / Audit
```

Formal organization：

```text
不被 delegation 改寫
```

---

# 5. Store Daily Input

```text
Store / Manager / authorized operator
   │
   ▼
InputView
   │
   ├─ validation
   ├─ selected date
   ├─ store / manager context
   └─ delegation metadata
   │
   ▼
daily_reports
```

InputView 本身不再負責歷史 Summary queue 的重複寫入。

---

# 6. Store Daily Backend

```text
daily_reports onWrite
   │
   ├─ aggregateLegacyReports / aggregateBrandReports
   │       │
   │       ▼
   │   monthly_aggregated
   │
   └─ markSummaryDirtyFromDailyWrite
           │
           ├─ historical meaningful change?
           │
           ▼
       summary_recalc_flags / recalculation state
```

---

# 7. Therapist Daily Input

```text
Therapist / authorized operator
   │
   ▼
InputView
   │
   ▼
therapist_daily_reports
```

---

# 8. Therapist Daily Backend

```text
therapist_daily_reports onWrite
   │
   ├─ updateTherapistMonthlyAggregation
   │       ▼
   │   therapist_monthly_aggregated
   │
   └─ markSummaryDirtyFromDailyWrite
           ▼
       historical Summary repair state
```

---

# 9. History Edit Flow

```text
HistoryView
   │
   ├─ date range query
   ├─ permission / delegation check
   ├─ updateDoc or deleteDoc
   └─ logActivity before/after
   │
   ▼
daily_reports / therapist_daily_reports
   │
   ▼
backend onWrite
   │
   ├─ aggregate correction
   └─ dirty / repair
```

HistoryView 不再額外隨機建立 recalc queue。

---

# 10. Store Target Flow

```text
TargetView
   │
   ├─ canonical read/write resolver
   ├─ lock/unlock
   └─ writeBatch
   │
   ├────────► monthly_targets
   │
   ├────────► monthly_targets_summary
   │
   └────────► recalc_queue
```

CYJ 新店：

```text
write canonical only
CYJ新店店
```

---

# 11. Target Read Flow

普通 Dashboard / Ranking / Annual：

```text
monthly_targets_summary
   │
   ├─ complete?
   │    YES → use
   │
   └─ NO
       → targeted/raw fallback when needed
```

完整 monthly_targets listener：

```text
只在真正編輯／完整檢核目標時啟動
```

---

# 12. Dashboard Current Month

```text
daily_reports
   │
   ▼
App scoped current-month data
   │
   ▼
useDashboardStats
   │
   ├─ current targets
   ├─ filters
   ├─ projection
   ├─ rankings
   └─ KPI
   │
   ▼
DashboardView
   ├─ DashboardHeader
   ├─ StorePerformanceView
   └─ TherapistPerformanceView
```

---

# 13. Dashboard Historical Month

```text
summary_recalc_flags
   │
   ├─ verified?
   │       │
   │       YES
   │       ▼
   │  dashboard_summary / therapist_summary / rankings_summary
   │
   └─ NO
           ▼
       fallback detail / aggregation
```

---

# 14. Summary Repair Flow

```text
History / Raw historical change
   │
   ▼
markSummaryDirty
   │
   ▼
summary_recalc_flags
   │
   ▼
repairDirtySummaries
   │
   ├─ rebuild dashboard summary
   ├─ rebuild therapist summary
   ├─ rebuild rankings summary
   ├─ compare
   └─ update flag
          │
          ▼
       verified
          │
          ▼
Dashboard auto switches back to Summary
```

---

# 15. Queue Fallback Flow

```text
recalc_queue pending
   │
   ▼
summary_worker_state cursor
   │
   ▼
50-doc page
   │
   ├─ has more → 5-min catch-up
   └─ no more  → 30-min steady
```

它是防漏保險，不是正常主流程唯一入口。

---

# 16. Dashboard Header Trust UI

```text
Dashboard summary state
   │
   ▼
DashboardHeader
   │
   ├─ 本月即時明細
   ├─ 已整理 Summary
   ├─ 資料來源檢查中
   └─ fallback warning
```

主管可以知道目前看的是什麼來源。

---

# 17. Regional Flow

```text
AppContext
   ├─ allReports
   ├─ budgets / target summary
   ├─ dashboard summary
   └─ managers
       │
       ▼
RegionalView
       │
       └─ manager / region aggregation
```

---

# 18. Ranking Flow

```text
allReports
target summary
dashboard / rankings summary
audit exclusions
   │
   ▼
RankingView
   │
   ├─ achievement
   ├─ cash / accrual
   ├─ traffic
   ├─ new customer metrics
   └─ ranking
```

資料不完整時，不應用頁面 workaround 製造排名。

---

# 19. Store Analysis Flow

```text
selected store
   │
   ▼
StoreAnalysisView
   │
   ├─ scoped reports
   ├─ target fallback
   ├─ benchmarks
   └─ read tracker
```

StoreAnalysis 是容易產生「為單店多撈資料」的頁面，
修改 query 時要特別注意 read scope。

---

# 20. Annual Flow

```text
completed historical dashboard_summary
   │
   ├────────► AnnualView historical summaries
   │
   └────────► rebuildAnnualKpiSummary
                    │
                    ▼
             annual_kpi_summary
```

本月 / 未整理月份：

```text
annualAggregatedData
```

可作 fallback。

---

# 21. Annual KPI Benchmark

```text
dashboard_summary completed months
previous annual summary
previous December
annualAverageSettings
   │
   ▼
annual_kpi_summary/{year}
   │
   ▼
useDashboardStats
   │
   ▼
StorePerformanceView benchmark display
```

---

# 22. Login Flow

```text
LoginView
   │
   ├─ role/account selection
   ├─ password validation
   └─ initial-password check
   │
   ├─ initial password?
   │      YES → force update
   │
   ▼
App.handleLogin
   │
   ├─ set user/role
   ├─ write auth.login system log
   └─ background device registration
```

---

# 23. Device Flow

```text
LoginView / App Login
   │
   ▼
checkDeviceAccess
   │
   ├─ application credential verification
   ├─ security_config
   ├─ account_devices
   └─ login location / security observation
   │
   ▼
Device decision
   │
   ├─ Trusted
   │    └─ allow
   │
   ├─ blocked / global_blocked
   │    └─ deny + security event（需要時）
   │
   └─ untrusted new / review state
        │
        ▼
   device_approval_requests
        │
        ├─ device_approval_inbox/{accountKey}
        └─ security_summary/device_approvals
                │
                ▼
          enforce approval
                │
       ┌────────┴────────┐
       │                 │
有其他 Trusted       沒有 Trusted
approver device      approver device
       │                 │
selfApprovalAllowed   adminOnly
       │                 │
6 位碼 Guided         最高管理者
Self Approval         人工覆核
       │                 │
       └────────┬────────┘
                ▼
       reviewDeviceApproval
                │
                ▼
 account_devices / request status / summary 更新
```

Realtime UI 刻意使用小型 summary document／單筆 request listener，不把完整 device history 常駐監聽。

### 最高管理者 Security Action Card — Summary-first 待部署版本

2026-08-25 已完成／已驗證：

```text
security_summary/device_approvals
  adminAssistancePendingCount
  adminAssistancePendingItems
  latestAdminAssistanceRequestId
  ...
        │
        ▼
最高管理者既有 onSnapshot
        │
        ▼
非阻斷式 Security Action Card
        │
        ├─ 稍後處理 → 卡片收起，Header pending 保留
        └─ 查看並確認 → 打開既有 DeviceApprovalPanel
```

只有需要最高管理者協助的 request 才進這個 Summary queue，所以判斷是否滑出提醒不再需要額外 query pending collection。

是否已正式部署，以 `CURRENT_STATE.md` 為準。

### Login Security Telegram Side Flow

```text
Security Event
   │
   ▼
security_alerts
   │ Firestore onCreate
   ▼
telegram_security_alerts config
   │
   ▼
Telegram API
```

這條流程與 Gemini Telegram Agent 的 question/tool flow 分開，而且不是固定秒數 polling。

# 24. Login Location Flow

```text
Browser login
   │
   ▼
resolveLoginLocation Cloud Function
   │
   ├─ success → normalized location
   └─ failure → unknown location
   │
   ▼
system_logs / account_devices
```

定位失敗不阻止登入。

---

# 25. System Logs Flow

```text
App.logActivity
   │
   ▼
system_logs
   │
   ▼
SystemMonitor
   │
   ├─ auth filters
   ├─ device filters
   ├─ query
   ├─ data changes
   └─ password
```

Rules：

```text
create/read only
no update/delete
```

---

# 26. Read Tracker Flow

```text
onSnapshot / getDocs locations
   │
   ▼
trackSnapshotRead / trackReadSource
   │
   ▼
readTracker.js
   │
   ├─ local mode → localStorage
   └─ global mode
           │
           ▼
     read_debug_sessions
           │
           ▼
   SystemMaintenance ranking / hourly analysis
```

---

# 27. Telegram Question Flow

> 本節是 Gemini／Agent 問答路徑。登入安全 Telegram Alert 使用 Device Flow 與 `AUTH_AND_SECURITY.md` 記錄的 event-driven security path，不進入 Agent question/tool pipeline。

```text
Telegram message
   │
   ▼
telegramWebhook
   │
   ├─ authorized chat?
   ├─ memory
   ├─ policy
   ├─ scope
   └─ intent
   │
   ▼
Gemini Interactions
   │
   ▼ function_call
executeTelegramAgentTool
   │
   ├─ exact Firestore source
   ├─ read budget
   ├─ source authority
   └─ tool evidence
   │
   ▼
Gemini final answer
   │
   ├─ prompt guards
   ├─ deterministic cleanup
   ├─ source footer
   └─ audit log
   │
   ▼
Telegram reply
```

---

# 28. Telegram Store KPI Flow

```text
question
   │
   ▼
getStorePerformance
   │
   ├─ current → daily_reports
   ├─ historical verified → dashboard_summary
   └─ fallback → monthly_aggregated / raw
   │
   ▼
source_authority = store_kpi
```

---

# 29. Telegram Therapist KPI Flow

```text
question
   │
   ▼
getTherapistPerformance
   │
   ▼
therapist_daily_reports / trusted therapist source
   │
   ▼
source_authority = therapist_kpi
```

---

# 30. Telegram Cross-source Guard

```text
store evidence
+
therapist evidence
   │
   ▼
crossSourceDataAwareness
   │
   ├─ aligned
   └─ difference_detected
          │
          └─ differenceIsError = false
```

Agent 不做跨來源 numerator / denominator 混算。

---

# 31. Telegram Policy Flow

```text
Telegram / Control Center
   │
   ▼
telegram_agent_policies
   │
   ├─ permission check
   ├─ active dates
   ├─ brand scope
   └─ analysis scopes
   │
   ▼
tool / alert / prompt behavior
```

每次變更：

```text
telegram_agent_policy_audits
```

---

# 32. Telegram Schedule Flow

```text
UI or natural language
   │
   ▼
pending / permission
   │
   ▼
notification_rules
   │
   ▼
notificationPatrol
   │
   ├─ build data
   ├─ apply policy
   ├─ create snapshot
   └─ send Telegram
```

---

# 33. Snapshot Flow

```text
scheduled report result
   │
   ▼
telegram_report_snapshots
   │
   ├─ cutoff
   ├─ metric version
   ├─ source meta
   ├─ payload
   └─ message preview
   │
   ▼
future replay
```

不是未來重新用新資料計算過去報表。

---

# 34. Improvement Task Flow

```text
alert / natural language
   │
   ▼
task draft / pending confirmation
   │
   ▼
telegram_agent_tasks
   │
   ├─ open
   ├─ in_progress
   ├─ completed
   └─ overdue
   │
   ├────────► task audits
   └────────► weekday follow-up
```

---

# 35. Maintenance Diagnostic Flow

當主管說「數字怪」：

```text
SystemMaintenance
   │
   ├─ Daily health
   ├─ Core Audit
   ├─ Summary status
   ├─ queue
   └─ reads
   │
   ▼
判斷問題屬於：
Raw / Identity / Target / Aggregate / Summary / View / Cost
```

不是一開始就 rewrite page。

---

# 36. CYJ 新店問題的正確追法

```text
畫面少資料
   │
   ▼
Core Audit
   │
   ▼
是哪個 collection?
   │
   ▼
raw storeName / doc ID?
   │
   ▼
canonical / alias?
   │
   ▼
writer?
   │
   ▼
summary / aggregate?
   │
   ▼
最後才 page query
```

禁止：

```text
每頁加一個 if 新店
```

---

# 37. Read-cost Diagnostic Flow

```text
reads 上升
   │
   ▼
ReadTracker global
   │
   ▼
SystemMaintenance
   │
   ├─ top source
   ├─ triggers
   ├─ docs / trigger
   └─ hourly bucket
   │
   ▼
判斷：
必要即時
or
不必要常駐
or
scope 太大
```

---

# 38. 什麼時候要更新 DATA_FLOW

以下變更要更新：

- 新 Raw collection
- 新 Summary / aggregate
- Summary trust priority
- path root
- Login / device sequence
- Telegram tool source
- Schedule / snapshot / task flow
- Delegation access flow
- Maintenance repair architecture

純視覺調整不需要更新。

---

# Production Update 2026-08-24：Pre-system Month Repair Flow

歷史 Summary repair 在進入 rebuild 前，新增品牌資料起始月份判斷：

```text
summary_recalc_flags / recalc_queue
        │
        ▼
yearMonth 是否早於 brand dataStartMonth？
        │
   ┌────┴────┐
  YES       NO
   │         │
   ▼         ▼
ignored     正常 historical
pre-system  Summary repair
month
   │
   ├─ dirty = false
   ├─ pending = 0
   ├─ queue 不再形成 job
   └─ 不進 monthly_targets full fallback
```

目前已確認：

```text
yibo dataStartMonth = 2026-04
```

因此：

```text
yibo 2026-01～03
→ 系統啟用前月份
→ 不視為資料遺失
→ 不建立 Summary
```

但正式使用月份仍保留：

```text
daily_reports = 0
+
已有 org / targets
→ 中止 rebuild
→ 報錯
```

這個安全防護不可取消。

---

# 39. Store Lifecycle Foundation Flow — Batch 1（NOT DEPLOYED）

> 2026-08-27 實作套件已完成並通過本地 regression；尚未部署前不可描述為 Production active。

```text
System Settings
  ↓ 使用者真正開啟「門市生命週期」
getDoc(store_lifecycle/master)
  ↓
顯示目前 org_structure 店家 + 已存在的歷史 Lifecycle 店家
  ↓
最高管理者編輯
  ↓
再次輸入 current credential
  ↓
HTTPS manageStoreLifecycle
  ↓
Firebase ID Token 驗證
  ↓
Trusted Device + Super Admin / Master 再驗證
  ↓
Schema / Store Identity / date boundary validation
  ↓
Firestore transaction
  ↓
store_lifecycle/master
  ↓
maintenance_logs audit
```

Multi-admin：

```text
不同店同時修改
→ transaction retry 後保留雙方修改

同一店同時修改
→ expectedStoreRevision mismatch
→ HTTP 409 LIFECYCLE_CONFLICT
→ 第二位管理者重新載入，不 silent overwrite
```

READY certification：

```text
set_dataset_status = READY
  ↓
transaction read store_lifecycle/master + current org_structure
  ↓
檢查所有 Lifecycle entry COMPLETE
  ↓
檢查目前 org_structure 每間店均已有 Lifecycle
  ↓
通過才 READY
```

重要隔離：

```text
Batch 1 不接入
Dashboard
Ranking
Annual
Regional
Daily/Audit completeness
Projection
Telegram
```

因此 Lifecycle 建置不會改變現行 KPI 數字；正式 consumer cutover 必須在後續 Batch 重新驗證後才進行。
