# AUTH_AND_SECURITY.md

> 本文件描述目前正式登入、帳號、閒置節流、裝置信任、登入監控與 Firestore Rules 邊界。  
> 安全文件刻意不保存實際帳號密碼、API Key、Bot Token 或其他 credential。

---

# 1. 身份架構現況

目前 Firestore Rules 明確註解：

```text
專案採匿名登入／自訂 Token 混合架構
```

Rules 的基礎 gate：

```text
signedIn() = request.auth != null
```

因此：

> 前端顯示的 `role` 不是等同於 Firestore Rules 已做 server-side role verification。

Rules 註解也指出，若日後改用 Custom Claims，
可以再把 director / master 等職級提升成 server-side 身份驗證。

---

# 2. 正式角色

目前一般前端角色：

```text
director   高階主管
trainer    教專
manager    區長
store      店經理
therapist  管理師
```

「最高管理者」不是另一個一般 role id，而是在 `director` 之下解析，例如：

```text
directorLevel = super_admin
```

程式另外保留 master credential／master login 類型的緊急或高權限驗證路徑。不要把 `master` 當成與 `director` 並列的一般員工角色。

# 3. 帳號資料來源

App 啟動／切品牌後會載入帳號目錄：

```text
store_account_data
manager_auth
therapists
trainer_auth
director_auth
master_auth
permissions
```

以及：

```text
org_structure
management_delegations
security_config
feature_flags
audit_exclusions
```

部分為必要資料、部分為 optional 設定。

---

# 4. LoginView 的角色

`LoginView.jsx` 是前端帳號選擇、password check 與首次安全更新 UI。

目前可確認：

- director 選帳號
- trainer 選帳號
- manager 選區長
- store 選店經理帳號
- therapist 依人員 master 登入
- inactive account 阻擋
- 初始密碼偵測
- 強制第一次安全更新

Knowledge Base 不記錄任何實際 default password。

---

# 5. First-login 強制更新

LoginView 對多角色有：

```text
isInitialPasswordLogin()
```

如果判定仍使用初始密碼：

```text
不直接完成正常登入
→ openForcePasswordUpdate
→ 更新密碼
→ 再進正式登入流程
```

目的：

- 避免預設密碼長期使用
- 不依賴人員自己記得去 Settings 修改

---

# 6. LoginCounter

`LoginCounter.jsx` 只負責顯示：

```text
授權名單載入狀態
目前品牌授權人數
retry 狀態
```

它不是 authentication engine。

狀態：

```text
loading
complete
ready
refreshing
error
```

---

# 7. 登入紀錄優先

App 目前正式登入順序有一個重要安全／稽核設計：

```text
登入成功
  ↓
先寫 system_logs「登入系統」
  ↓
再背景 registerAccountDevice
```

原因：

> Device check 失敗不能讓「登入事件」本身消失。

因此不要把 device check 改成：

```text
device check 成功後才寫 login log
```

否則登入監控可能再次出現只看到登出、看不到登入。

---

# 8. `system_logs`

登入與一般操作使用：

```text
system_logs
```

主要欄位：

```text
timestamp
createdAtText

role
user
action
activityType
view

details

brand
brandLabel

device
browser
os
deviceId
deviceShort

loginLocation
riskTags
isNewDevice
deviceTrusted
```

---

# 9. System Log Firestore Rule

兩種品牌 path 都：

```text
create → signedIn
read   → signedIn

update → deny
delete → deny
```

因此 `system_logs` 是 append-oriented audit log。

未來管理頁如果需要「標註」log，
應另存 review metadata / new audit，而不是 update 舊事件。

---

# 10. Login Counter Statistics

當 action 是：

```text
登入系統
```

App 會 increment：

```text
system_stats/{YYYY-MM-DD}
```

所以 Dashboard / Login 頁看到的 daily login count
與 `system_logs` 是相關但不同用途的資料。

---

# 11. Default Security Config

App fallback 同時包含 Session 保護與 Device Approval 設定：

```text
enabled = true

lowPowerEnabled = true
lowPowerIdleMinutes = 30

autoLogoutEnabled = true
autoLogoutMinutes = 240
logoutWarningSeconds = 60

exemptRoles = director, master

deviceApprovalMode = off
deviceApprovalRoles = director, trainer, manager, store, therapist
deviceApprovalExpiryMinutes = 15
allowTrustedDeviceSelfApproval = true
```

仍保留 legacy compatible normalization：

```text
timeoutMinutes
warningSeconds
```

`deviceApprovalMode = off` 是安全預設；部署 Device Approval 程式碼本身，不代表系統會立刻把所有現有使用者切到 enforce。

# 12. Low Power Mode

低功耗／省流模式不是登出。

流程：

```text
使用者一段時間無操作
→ elapsed > lowPowerIdleMinutes
→ isLowPowerMode = true
→ 大型 listener 可停止
```

目前 default：

```text
30 分鐘
```

目的：

- 降低 Firestore reads
- 保留使用者 session
- 使用者回來後恢復資料

---

# 13. Auto Logout

自動登出與 low power 分開。

目前 default：

```text
240 分鐘
```

高階角色例外：

```text
director
master
```

App 還會依 securityConfig 的 `exemptRoles` 判斷。

---

# 14. 裝置 ID

App 會建立 client stable device ID。

優先保存 localStorage。

若 storage 無法使用：

```text
dev_session_...
```

作 session fallback。

Device fingerprint 目前由：

```text
device
browser
os
```

等資訊組成。

---

# 15. Device Approval Model

舊 Knowledge Base 的：

```text
autoTrustLimit = 2
```

已退役，不再代表目前架構。

目前模式：

```text
off      → Device Approval 不介入正常登入
monitor  → 記錄／分類新裝置，但依 monitor policy 允許使用
enforce  → 未信任新裝置完成核准後才能進入
```

目前 App 預設納入：

```text
director
trainer
manager
store
therapist
```

---

# 16. `account_devices`

每個帳號 profile 內保存 devices map。

常見 logical fields：

```text
brandId
brandLabel
role
accountId
userName
updatedAt / updatedAtText

devices.{deviceId}:
  deviceId / deviceShort
  stableDeviceId
  deviceFingerprint
  deviceStorageStatus
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

目前裝置狀態可能包含：

```text
trusted
new
observing
reverify_required
suspicious
blocked
global_blocked
```

---

# 17. 新裝置登入／Approval Decision

Application credential 驗證成功後，Backend Device Security 會讀 `security_config` 與 `account_devices` 進行判斷。

在 enforce 模式：

```text
新裝置且尚未 Trusted
↓
是否還有可使用的 Trusted approver device？
├─ 有
│  → selfApprovalAllowed = true
│  → 建立／刷新 pending request
│  → 新裝置顯示 6 位碼
│  → 原 Trusted Device 完成自我認證
│
└─ 沒有
   → selfApprovalAllowed = false
   → adminOnly
   → 由最高管理者建立第一台 Trusted Device
```

第一次登入的新帳號，不會只因為密碼正確就自動把第一台裝置設為 Trusted。

---

# 18. Guided Trusted-device Self Approval

在 enforce 模式，原 Trusted Device 可以在「自己的另一台裝置」有 pending request 時，被系統主動帶入確認流程。

目前正式前端使用：

```text
device_approval_inbox/{accountKey} pendingCount
→ account-scoped pending lookup
→ guided DeviceApprovalPanel
```

Guided UI 會問：

```text
您剛才是否正在另一台裝置登入系統？
```

若是本人，才輸入新裝置顯示的 6 位碼。

若選「不是我」，可拒絕／阻止該次新裝置登入，並交由登入安全 Telegram pipeline 通知最高管理者。

Guided Flow 不會因為使用者剛好是最高管理者，就把其他人的 pending request 自動塞進自己的引導畫面。

---

# 19. 6 位碼安全限制

目前已驗證 Backend 會限制：

```text
最多錯誤 3 次
```

達上限時 pending request 會被結束／expired，新裝置必須重新登入取得新的申請。

確認碼驗證資料放在 request 的 private verification 路徑／hash 流程，不應當成一般可讀 request 欄位公開。

---

# 20. `device_approval_requests`

品牌範圍內的 Device Approval workflow collection。

常見 logical fields：

```text
requestId
brandId
accountKey
role
accountId
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
expiresAtMs / expiresAtText
resolvedBy / resolvedAtText
```

verification secret 另外放 private subcollection／document。

---

# 21. `device_approval_inbox`

每個帳號一份很小的 pending summary。

用途：

```text
我的 pending count
→ Header Badge / Guided Flow trigger
```

目的就是不要為了知道「有沒有待確認」而載入完整裝置歷史。

---

# 22. 最高管理者人工覆核

最高管理者前端資格通常來自 `director`＋`super_admin`；但 Backend 不可只相信前端，仍要重新驗證 actor 權限、目前 Trusted Device、必要 credential。

人工覆核包含：

```text
允許／Trusted
繼續觀察
要求重新驗證
禁止裝置
```

目前 `DeviceApprovalPanel.jsx` 明確把 self approval 與最高管理者人工覆核分開。

最新已完成的 Backend race hardening 採 first-resolver-wins：第二位較晚處理同一筆 request 的最高管理者，會收到「這筆已由誰完成」而不是 false success。

最新 race／Summary-first 是否已正式部署，必須以 `CURRENT_STATE.md` 為準。

---

# 23. Brand Block vs Global Block

品牌內 block 主要反映在該品牌的 `account_devices`。

Global block 則是跨品牌的 hard block record，用來避免只切換品牌就繞過被封鎖的裝置。

兩者不可以只用一個前端 flag 混在一起。

---

# 24. `security_summary`

Device Approval 使用專門的小型 Summary：

```text
security_summary/device_approvals
```

目前正式 App 已經即時監聽這份 document，取得最高管理者品牌待確認數量。

最新已驗證的 Summary-first 主管提醒版本另外準備：

```text
adminAssistancePendingCount
adminAssistancePendingItems
latestAdminAssistanceRequestId
latestAdminAssistanceUserName
latestAdminAssistanceRole
latestAdminAssistanceDevice
latestAdminAssistanceAtText
```

只有 enforce 且 `selfApprovalAllowed = false` 的 request 才進主管協助 summary queue。

這樣最高管理者要不要滑出通知卡，可以直接由既有 summary listener 判斷，不需要再 query 一次 pending collection。

在部署確認以前，上述新增欄位只可寫成「已完成／已驗證」，不可寫「已正式上線」。

舊 `security_summary/device_alerts` 可能仍存在於較早裝置安全統計用途，不要和新的 `device_approvals` summary 混淆。

---

# 25. Security Alert、Telegram、Login Log 是不同資料流

登入／頁面／稽核活動：

```text
system_logs
```

Device Approval／裝置狀態：

```text
account_devices
device_approval_requests
device_approval_inbox
security_summary/device_approvals
```

登入安全事件：

```text
security_alerts
```

Security Telegram：

```text
security_alerts onCreate
→ telegram security config
→ Telegram API
```

Backend-only failure／cooldown state：

```text
login_security_state
```

因此「有登入」、「有 pending approval」、「有發 Telegram」不能只看同一個 collection 就下結論。

---

# 25A. Known Device Recovery

Known Device Recovery 仍是 compatibility／stability layer，可利用 device fingerprint、歷史裝置資訊與 location signal 協助辨識曾使用過的裝置。

Recovery 不能被當成 permission bypass；blocked／global-blocked／suspicious 仍必須經過各自安全判斷。

---

# 25B. Login Location / IP Privacy

`resolveLoginLocation` 提供的是安全 signal，normalize 後可包含：

```text
display
countryCode / countryName
region / city / district
timezone
isp
ipMasked
source / confidence
isProxy
isMobileNetwork
updatedAtText
```

定位失敗本身不是登入失敗條件。Knowledge Base 不保存完整實際 IP。

---

# 25C. SystemMonitor / Device Management

SystemMonitor 仍是裝置管理操作面，但分類應使用目前三階 review 模型，不再使用舊的單一「標記可疑」思維：

```text
Trusted
Observe
Require re-verification
Block
Global block / recovery（依權限）
```

這些動作會寫回 Backend／Firestore，不是純 UI state。

# 26. Delegation Security

`management_delegations` 有額外 Firestore schema guard。

Rules 驗證至少：

```text
角色
代理人
委託人
範圍
日期
status
permissions
```

並且：

```text
editOrganization = false
```

Delete：

```text
deny
```

代表代理結束要保留 audit history。

---

# 27. 目前 Rules 的限制

除了受保護的：

```text
management_delegations
system_logs
```

其他大部分既有品牌資料仍採：

```text
signedIn → read/write
```

這是目前正式架構，不應被文件寫成「每一個 collection 都已做到嚴格 role-based Firestore authorization」。

---

# 28. 未來若強化 Security

目前 Rules 原始註解已指出理想方向之一：

```text
Custom Claims
→ server-side role verification
```

但這是「未來可能強化方向」，
不是目前已完成能力。

Knowledge Base 必須區分：

```text
目前正式行為
未來建議
```

---

# 29. 安全修改前必讀

改 Login：

```text
LoginView.jsx
LoginCounter.jsx
App.jsx
```

改 device：

```text
App.jsx
SystemMonitor.jsx
functions/index.js
```

改 Firestore authorization：

```text
firestore.rules
App auth architecture
```

改 delegation：

```text
delegationResolver.js
SettingsView.jsx
App.jsx
firestore.rules
```

---

# 30. Security Regression Checklist

修改後至少確認：

```text
□ 正常角色可登入
□ 初始密碼仍會觸發安全更新
□ 登入 log 先出現
□ device check 失敗不會吃掉登入 log
□ trusted device 可正常登入
□ new device 能建立狀態
□ blocked device 被正確處理
□ SystemMonitor 能查到 login / device
□ system_logs 仍不能 update/delete
□ low-power 與 auto-logout 沒有互相覆蓋
□ director/master exemption 符合 securityConfig
```

---

# 31. Store Lifecycle Administrative Security — Batch 1（PRODUCTION CONFIRMED）

Store Lifecycle 會決定未來正式 KPI eligibility，因此 writer 採與 Device Approval 高權限操作一致的 server-side authority，不以 Frontend `userRole` 當作唯一安全依據。

待部署 `manageStoreLifecycle` security chain：

```text
POST only
↓
Firebase Bearer ID Token verify
↓
strict brand id allowlist
↓
actor.roleId = director
↓
目前裝置仍為 trusted device
↓
Backend 再驗 current application credential
↓
Super Admin level 或 Master credential
↓
Lifecycle validation
↓
Firestore transaction
```

Credential 僅供本次 Backend re-verification；Lifecycle payload / audit log 不保存 submitted credential。

Firestore Rules：

```text
brands/{brandId}/store_lifecycle/**
artifacts/{appId}/public/data/store_lifecycle/**

signed-in read  = allow
frontend write  = deny
Admin SDK write = Backend authority
```

Race safety：同一 store entry 使用 `revision` optimistic token；同店 lost-race 回 409，不回假成功。不同店 transaction retry 後保留彼此修改。

Batch 1 沒有修改既有 Device Approval 決策、6 位碼、自助驗證、global block 或 Telegram security alert 行為；`deviceApproval.js` 僅額外 export 已存在的 authentication helpers 供 Lifecycle writer 共用。
# 25. Login Security Telegram Config Authority（31d8ac6 HISTORICAL STATUS；current runtime see CURRENT_STATE）

`artifacts/default-app-id/public/data/global_settings/telegram_security_alerts` 是全品牌登入安全通知設定，不屬於一般營運設定。

正式安全邊界應為：

```text
TelegramAlertControlCenter
→ Backend updateTelegramSecurityAlertConfig
→ Firebase ID token validation
→ verifySuperAdminActor
   ├─ director / master credential re-verification
   └─ current device must be Trusted
→ Firestore transaction
   ├─ read current revision
   ├─ expectedRevision must match
   └─ write revision + 1
```

Frontend 不可再直接 `setDoc(securityConfigRef)`。Firestore Rules 對 `telegram_security_alerts` 禁止 client write；Admin SDK Backend writer 不受 client Rules 限制。

多人同時修改時使用 revision first-writer-wins：第二位管理者若仍持有舊 revision，Backend 回傳 HTTP 409；Frontend 重新讀取該 single document 後要求再次確認，不做 silent overwrite。

Read / write footprint（每次儲存，非 listener）：

```text
Backend point reads:
- account_devices profile: 1
- director_auth: 1
- master_auth: 1
- telegram_security_alerts transaction read: 1

Writes:
- telegram_security_alerts: 1
- system_logs audit: 1
```

沒有新增 polling、collection listener 或大型常駐 query。設定仍是全品牌共用 legacy root；這個 hardening 不改 CYJ / 安妞 / 伊啵的營運資料 path。

> 歷史狀態註記（31d8ac6 當時）：已完成 63/63 Security regression、286/286 full regression、Functions syntax 與 frontend build，並整合 `origin/main`；當時尚未部署。現在是否已部署／Production Confirmed 必須讀最新 `CURRENT_STATE.md` 與目前正式 source，不得沿用此歷史標籤。

---

# 32. System Exclusion Administrative Security — A+B / Stage C

`audit_exclusions` 現在是正式 System Exclusion authority；修改它會改變全系統正式營運 scope，因此不能再使用一般 Settings direct write。

Backend owner：

```text
functions/systemExclusion.js
→ manageSystemExclusions
```

## Request gate

```text
POST only
→ Firebase Bearer ID Token verification
→ strict brand allowlist: cyj / anniu / yibo
→ verifySuperAdminActor
→ Trusted Device + highest-admin actor
→ current application credential re-verification
→ expectedRevision OCC
→ transaction
```

Store payload 會做：

```text
brand mismatch reject
Store Identity normalization
canonical core dedupe
max 250 entries
```

提交 credential 不寫入 System Exclusion document 或 audit log。

## OCC / multi-admin race

`expectedRevision` 必須是 non-negative integer。

```text
current revision != expectedRevision
→ HTTP 409 revision_conflict
→ 回 currentSystemExclusion
→ UI 必須要求重新確認
```

同一 revision 下若 canonical store set 完全相同：

```text
changed=false
no revision bump
no System Exclusion write
no system_logs write
```

所以「重按儲存」不能被當成 trigger hack。

## Firestore Rules source contract

Repository Rules 對兩個 physical path都只允許 signed-in read、禁止 browser write：

```text
brands/{brandId}/settings/audit_exclusions
artifacts/{appId}/public/data/global_settings/audit_exclusions
```

Admin SDK / Backend writer 是正式 mutation authority。

**Production boundary：Stage C 本身沒有修改／重新部署 Rules；本次 closeout 沒有獨立取得 live Rules version。** 因此 source contract 可確認，live Rules deployment confirmation 不得由 Frontend smoke test代替；詳見 `CURRENT_STATE.md`。

## Downstream event safety

只有真正 document change 才會進：

```text
onLegacySystemExclusionChange
onBrandSystemExclusionChange
→ Target Coverage refresh
→ Historical Summary reconciliation
```

no-op 不製造 revision churn，也不增加 downstream reads / writes。
