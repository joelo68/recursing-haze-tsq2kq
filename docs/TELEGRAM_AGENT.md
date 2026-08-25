# TELEGRAM_AGENT.md

> 本文件記錄 DRCYJ Telegram 營運戰情 Agent、主動預警、排程、Policy、報表快照與改善任務架構，並明確區分獨立的登入安全 Telegram event pipeline。  
> 不記錄 Bot Token、Gemini API Key 等 secrets。

---

# 1. 系統構成

```text
Telegram
   │
   ▼
functions/index.js
   │
   ├─ webhook / command router
   ├─ Gemini Interactions
   ├─ tool layer
   ├─ source authority / guards
   ├─ short-term memory
   ├─ Policy Center
   ├─ schedules
   ├─ report snapshots
   ├─ improvement tasks
   └─ active alert patrol
   │
   └────► functions/telegram/prompts.js

Frontend Control:
NotificationManager.jsx
   ↓
TelegramAlertControlCenter.jsx
```

---

# 2. Agent Version

目前正式：

```text
drcyj-agent-v5.0-snapshot-schedule-task-loop
```

Backend 保留部分舊 compatible versions，
使舊 session 可以視版本相容情況繼續讀取。

---

# 3. Gemini Model

目前正式：

```text
Primary  = gemini-3.7-flash
Fallback = gemini-3.6-flash
```

API：

```text
gemini-3.7-flash → v1beta/interactions
gemini-3.6-flash → v1/interactions
```

不要因一般 UI / Firestore 修正順便改 model 或 API version。

---

# 4. Cost / Safety Guard

目前正式：

```text
Max tool calls       = 3
Max reads            = 2500
Max daily range days = 31
Max macro months     = 12
Memory turns         = 8
Tool cache TTL       = 2 minutes
Gemini timeout       = 35 seconds
```

這些不是 UI 顯示值，而是 backend safety guard。

---

# 5. Prompt Module

正式 prompt 已拆到：

```text
functions/telegram/prompts.js
```

透過：

```text
createTelegramAgentPrompts(...)
```

由 `functions/index.js` 注入 runtime functions。

輸出 helpers：

```text
Evidence Guard
Inference Guard
Beauty Service Tone
Reply Mode
Cross-source Instruction
System Instruction
Finalizer Instruction
```

---

# 6. 為什麼 Prompt 與 Backend 分開

`prompts.js` 負責：

```text
語氣
回答規格
Evidence / Inference 邊界
格式
finalizer
```

`index.js` 負責：

```text
真實資料讀取
Policy runtime
工具
資料來源
Scope state
Memory
Schedule
Task
Firestore
Gemini API
```

因此：

> 回答錯誤不一定是 prompt 問題。  
> 若數字來源錯，先查 tool / data source，不應只調 prompt。

---

# 7. Agent 資料原則

正式 system prompt 規則包括：

- 公司真實業績／目標／排行／人員／店家／區長／回報狀態，必須用工具。
- 一般管理建議可以不呼叫工具，但不能假裝是公司數據結論。
- 品牌不可誤填成店名。
- 工具範圍要最小化。
- 所有金額、比率與排名依工具結果。
- 品牌 scope 不可無故從上一題擴張。

---

# 8. Tool Layer

目前正式 tool router 至少可執行：

```text
getStorePerformance
getTherapistPerformance
getMissingReports
getMacroStrategicAnalysis
getManagerPerformance
getOperationalAlerts
getDataHealth
getDailyBattleBrief
```

工具結果會：

```text
record evidence
update scope
record toolCalls
record read count
```

再交給 Gemini 完成回答。

---

# 9. Source Authority

這是目前非常重要的治理規則。

## Store KPI

```text
source = daily_reports
```

規則：

> 全店 KPI 以店家工具結果為準，不得拿 therapist daily data 反推／覆寫全店 KPI。

## Therapist KPI

```text
source = therapist_daily_reports
```

規則：

> 個人 KPI 只使用同一位人員工具明確提供的 numerator / denominator。

---

# 10. Cross-source Difference

如果店家與管理師來源數字不同：

```text
differenceIsError = false
```

可能原因：

- KEY IN 時間差
- 一方缺報
- 修正尚未同步
- 兩來源統計口徑本來不同

Agent 不得：

```text
用店家 newCustomers
÷
管理師 newClosings
```

拼成不存在的個人締結率。

---

# 11. Ranking Eligibility

Manager / store ranking 不只看數字。

Backend 會先建立 data quality：

```text
expected store count
reported store count
targeted store count
missing reports
missing targets
source confidence
```

資料不完整：

```text
rankingEligible = false
```

則不能對外宣稱：

```text
第 X 名
```

---

# 12. Summary-first Data Loading

Telegram Agent 與 Dashboard 的資料信任原則一致。

## 當月

```text
daily_reports exact
→ monthly_aggregated fallback
→ raw fallback as needed
```

## 歷史月份

```text
summary_recalc_flags verified
→ dashboard_summary
→ monthly_aggregated
→ daily_reports fallback
```

---

# 13. Target Loading

正式 target loading：

```text
monthly_targets_summary
→ coverage complete?
    YES → use
    NO
      ↓
dashboard_summary targets
      ↓
monthly_targets full fallback
```

有正式 roster 時，
不因 Summary total > 0 就認定逐店完整。

---

# 14. 短期 Memory

Firestore：

```text
telegram_agent_sessions
```

ID：

```text
chatId + userId
```

目前保留：

```text
最後 8 turns
scope state
pending policy action
one-shot policy
learning candidates
last learning suggestion
last policy change
pending V5 action
```

---

# 15. Memory 長度

正式：

```text
TELEGRAM_AGENT_MEMORY_TURNS = 8
```

保存前會限制單 turn 文字長度，
避免 session 無限膨脹。

---

# 16. Scope State

Memory 不只保存聊天文字。

還保存結構化 scope，例如：

```text
active brand
store focus
manager focus
date/month context
```

目的：

讓「這三家店」「那些店」「剛才那個區長」等 follow-up
不需要完全重新查詢意圖。

---

# 17. Reset Memory

Backend 有：

```text
resetTelegramAgentMemory(chatId, userId)
```

會刪除該 session。

因此短期記憶是可清除的 session data，
不等於永久公司治理規則。

---

# 18. Policy Center

長期規則存：

```text
telegram_agent_policies
```

主要類型：

```text
exclude_store
alert_rule
response_preference
```

與短期 memory 分開。

---

# 19. Policy Scope

可作用的 scope 包括：

```text
telegram_analysis
ranking
brand_totals
active_alert
data_audit
```

所以「某店排除」可以只影響某一類分析，
不一定是全資料永久刪除。

---

# 20. Policy Permission

Backend 會把 policy user 解析成：

```text
director
brand_manager
viewer
```

能力概念：

```text
director      → global
brand_manager → assigned brands
viewer        → query / limited personal preference
```

只有符合 permission 才能正式改規則。

---

# 21. Policy Audit

規則變更另存：

```text
telegram_agent_policy_audits
```

不要把正式規則修改只留在 Telegram 對話文字裡。

---

# 22. Reply Preference

`response_preference` 可以影響：

```text
回答偏好
格式偏好
表達方式
```

Prompt layer 會把 active preferences 注入回答規格。

---

# 23. Reply Mode / Finalizer

Prompts 對 brief / detailed 有不同限制。

目前正式 detailed reply 也有：

- 關鍵數字行數上限
- 不自行創造不存在 KPI target
- 不輸出模型／工具／reads／Policy ID 技術內容
- 無 warning 時不額外堆「資料可信度」
- 語氣是冷靜、管理層可直接閱讀的戰情報告

---

# 24. Active Alert

Frontend：

```text
TelegramAlertControlCenter
```

Backend：

```text
notificationPatrol / alert builder
```

預警規則至少包括：

```text
progressGap
cashAchievementRate
closingRate
skincareRatio
newCustomers
traffic
missingReport
missingTarget
```

---

# 25. 營運 Rule vs Data Rule

Active Alert 將規則分成：

```text
operational
data
```

例如：

```text
progressGap → 營運判斷
missingReport → 資料待補
```

避免把資料缺漏直接解讀成營運能力差。

---

# 26. Active Alert Config

正式設定概念：

```text
enabled
sendTime
weekdays
brandIds
chatTargets
brandProfiles
sendWhenClear
pausedUntil
timezone = Asia/Taipei
```

每品牌可以有不同：

```text
limit
rules
thresholds
```

---

# 27. NotificationManager

`NotificationManager.jsx` 是推播入口之一。

它提供報表類型與一般 notification rule 管理，
並嵌入：

```text
TelegramAlertControlCenter
```

因此 Telegram UI 不是只有一個檔案。

---

# 28. V5 Scheduled Reports

正式 schedule sources：

```text
weekday_morning_brief
progress
top5_stores
bottom5_stores
top5_therapists
unreported
```

自然語言也能產生排程草稿。

---

# 29. Natural-language Schedule

Backend 會辨識：

```text
每天 / 每週 / 工作日
時間
報表類型
目標群組
品牌
```

先形成：

```text
pending action
```

而不是看到一句話就無條件永久寫入。

---

# 30. Schedule Storage

目前 schedule 正式集合：

```text
notification_rules
```

這是 root collection，
不是透過 currentBrand collection path。

---

# 31. Report Snapshot

每次 scheduled report 可以建立：

```text
telegram_report_snapshots
```

保存：

```text
資料截止時間
metric version
source meta
policy ids
brand payloads
message preview
read count
run key
```

用途：

> 之後「重新顯示當時晨報」可以讀當時 snapshot，  
> 而不是用今天更新後的資料重算一份看似同樣的舊報表。

---

# 32. Snapshot Commands

Agent 已支援：

```text
/snapshots
/snapshot ...
```

以及自然語言查看最近報表快照。

---

# 33. Improvement Tasks

Firestore：

```text
telegram_agent_tasks
```

狀態：

```text
open
in_progress
completed
cancelled
overdue
```

可建立：

```text
brand
store
owner
due date
target text
priority
```

---

# 34. Task Draft

主動巡察可以先產生：

```text
telegram_agent_task_drafts
```

由使用者確認後才正式建立 task。

---

# 35. Task Audit

任務變動寫：

```text
telegram_agent_task_audits
```

不只覆寫 task document 而沒有歷史。

---

# 36. Task Follow-up

Backend 有固定排程：

```text
週一～週五 09:00
Asia/Taipei
```

檢查：

```text
open
in_progress
overdue
```

接近到期或逾期任務。

---

# 37. Task Outcome Check

Task 若有明確：

```text
brand
store
```

Agent 可以重新讀該店實際 performance，
做改善結果檢查。

這不是把 task 標 completed 就自動等同於 KPI 已改善。

---

# 38. Telegram Data Root

Policy / alert control 大部分固定：

```text
artifacts/default-app-id/public/data
```

前端註解明確要求：

> Functions 必須與前端使用完全相同的 app id / path。

因此若改 Telegram Firestore path，
前後端必須一起核對。

---

# 39. Notification Root Exception

`notification_rules` 是 root collection：

```text
db.collection("notification_rules")
```

這是 Telegram architecture 中的特殊路徑。

不要因其他 policy 都在 legacy root，
就把 schedule collection 自動搬到同一層。

---

# 40. Chat Allowlist

Backend 有 Telegram chat allowlist。

Knowledge Base 不列出實際 numeric chat IDs，
只記錄目前存在：

```text
Main group
Manager group
Agent test group
```

實際 ID 以正式 backend config 為準。

---

# 41. Secrets

Backend 透過 Secret Manager / function secret 取得：

```text
Telegram Bot Token
Gemini API Key
```

本文件永遠不保存 secret value。

---

# 42. Agent Audit

Firestore：

```text
telegram_agent_logs
```

記錄：

```text
version
reply format
reply guard versions
model/API
tool calls
sources
warnings
policies
reads/writes
usage
duration
error
```

用於：

- 查成本
- 查工具選擇
- 查 fallback
- 查 reply guard 是否觸發
- 查資料來源

---

# 43. Source Footer

Agent 可依 tool sources 顯示資料基礎：

```text
即時營運資料
已驗證月結資料
正式目標／組織
```

有 warning 才額外顯示資料提醒。

---

# 43A. Login Security Telegram — 與 Agent 分離

登入安全 Telegram **不是 Gemini Agent tool flow**。

流程：

```text
Login / Device Security Event
   │
   ▼
functions/deviceApproval.js
   │ 寫入
   ▼
security_alerts
   │ Firestore onCreate
   ▼
functions/index.js Security Alert Trigger
   │ 只有需要 delivery 時才讀
   ▼
global_settings/telegram_security_alerts
   │
   ▼
已授權且已選定的 Telegram 群組
```

目前已驗證 event type：

```text
password_failed_threshold
device_code_failed_limit
manager_assistance_required
self_reported_not_me
rapid_multi_location_login
blocked_device_login
```

降噪規則：

```text
account + event type cooldown
正常 Trusted login → 不發 Security Telegram
正常成功 self verification → 不發 Security Telegram
同國行動網路城市漂移 → 不直接升級為異地登入警示
```

Read 行為：

- rapid-location 比對可沿用 `checkDeviceAccess` 已讀取的 `account_devices`；
- 正常成功登入不需要為了 location comparison 再額外 read 一次 `login_security_state`；
- 只有真的建立需要 Telegram delivery 的 security alert，才讀 Security Telegram config；
- 沒有固定 Firestore polling loop。

不要只為了格式化登入安全通知，就把 Agent 的 KPI source authority、Gemini prompt 或大量 tool read 接進這條 pipeline。

---

# 44. 修改 Telegram 前的診斷順序

第一步先判斷本次修改屬於「營運／Gemini Agent」或「Login Security Event Alert」；兩者的 source files 與 read-cost profile 不同。


遇到回答問題：

```text
1. 使用者問的是哪個 scope？
2. Router 選到哪個 tool？
3. Tool args 是否正確？
4. Data source 是哪個？
5. Summary 是否 verified？
6. target coverage 是否完整？
7. rankingEligible？
8. Cross-source authority 有沒有被違反？
9. 最後才看 prompt / finalizer
```

---

# 45. 禁止事項

不要：

- 真實公司數字不查工具就回答。
- 因 prompt 調整去改 Gemini model。
- 用人員日報反推店家 KPI。
- 用店家日報反推個人 KPI。
- Summary dirty 還宣稱是 verified historical result。
- 資料不完整仍給排名。
- 自然語言一句話直接永久建立高影響規則而無 permission / confirmation。
- 把 report snapshot 改成每次即時重算。
- 把 secrets 寫進 `.md`。

---

# 46. 修改後驗證

Backend：

```bash
node --check functions/index.js
node --check functions/telegram/prompts.js
```

若 frontend Control Center 有改：

```bash
npm run build
```

部署後依改動類型驗證：

```text
□ /ping 或基本 webhook
□ Agent test group query
□ source footer
□ store KPI
□ therapist KPI
□ historical verified summary
□ incomplete-data ranking block
□ Policy read/write
□ schedule list
□ snapshot list
□ task workflow
□ notification patrol
```
