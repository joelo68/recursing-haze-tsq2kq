# Release Control Security Override — 2026-10-04

Release Control 將 `system_version` 從「最高管理者登入後自動發布 CURRENT_APP_VERSION」改成最高管理者在 System Monitor 明確執行的全系統版本發布動作。

正式安全鏈：

```text
CYJ highest administrator control surface
→ server-issued Application Identity
→ Trusted Device
→ fresh credential re-verification
→ Backend manageAdministrativeSetting
→ canonical GitHub Pages release.json verification
→ stable-version / no-downgrade validation
→ system_version revision OCC transaction
→ maintenance audit log
```

Browser 仍不可直接寫 `global_settings/system_version`；`firestore.rules` 既有 `system_version` direct-write deny 不放寬。Backend 不相信 Browser 自報的 release identity，正式 `appVersion / sourceCommit / entryAsset` 必須重新由 GitHub Pages `release.json` 驗證。

全系統版本是 Application-level control，不做三品牌各自版本。UI 只在 CYJ 最高管理者控制面提供發布按鈕；發布後的 marker 仍作用於 CYJ／安妞／伊啵同一套 frontend。

多管理者同時發布以 `system_version.revision` 做 OCC；revision 不一致時拒絕後到 mutation。禁止將版本 marker 降到較舊 stable semantic version。

Release Control 不新增 Firestore listener/query/polling。持續沿用 App 既有單一 `system_version` listener；只有人工發布時才有 on-demand transaction / audit write。Backend 另對 canonical static `release.json` 做一次 HTTPS GET，不建立 Firestore release collection。

第一次 Production rollout 經使用者明確核准：

```text
CURRENT_APP_VERSION = 3.6.2
```

此一次性 bump 用來確保舊的 3.6.1 client 進入新的 asset-aware updater。後續同版本 hotfix 可在正式 `entryAsset` 改變時，透過 Release Control 發布該正式 release，不必為每個 hotfix 強制提高 semantic version。

---

# Canonical Role Metadata v1 Security Boundary — 2026-10-03

Frontend 角色顯示 metadata 現在由 `src/constants/index.js` 的 `APPLICATION_ROLE_METADATA` 統一提供五個正式 Application Role 的顯示名稱與 badge 名稱：

```text
director   → 高階主管
trainer    → 教專
manager    → 區長
store      → 店經理
therapist  → 管理師
```

`master` 只存在於 `SECURITY_ACTOR_ROLE_METADATA`，代表 Security / Audit 特殊 actor 的 presentation；它**不是**可登入的 Application Identity role，也不得因此被加入 Login、Custom Claims、Module Permission 或 Firestore Rules role allowlist。

Canonical Role Metadata 是 Frontend presentation authority，不是 authorization authority。舊 `ROLES` 中未被登入流程使用的 client-side credential-like `pass` metadata 同時退役；正式登入仍只走既有 Backend credential / Application Identity authority。以下 Backend / Rules owner 維持自己的 fail-closed allowlist，這次不改語意、不改 path、不放寬權限：

```text
functions/applicationIdentity.js         → APPLICATION_IDENTITY_ROLES
functions/modulePermissions.js            → MODULE_PERMISSION_ROLES
functions/accountAuthority.js             → password / managed-account role allowlists
functions/administrativeSettingsAuthority.js
                                         → Security config supported roles
functions/deviceApproval.js               → Device Security protected roles
firestore.rules                           → server-issued Application Identity role validation
```

因此「改角色中文名稱／badge」應修改 canonical presentation metadata；「改誰能登入、看頁面、寫資料或執行管理操作」仍必須走對應 Backend / Rules / Permission owner，不得把 Frontend metadata 當成 Security authority。

本批不新增 Firestore listener/query/polling/write，也不修改 Backend / Rules / brand path。`CURRENT_APP_VERSION = 3.6.1` 不變。

---

# Trainer Therapist-Account Authority Security Override — 2026-09-30

`therapist-manager` 不再等同 highest-admin-only 頁面。正式營運 contract 是：教專可查看管理師帳號名單、查看 sanitized 單筆主檔、新增、修改、封存／重新啟用與重設密碼；教專不可查看目前密碼，也不可永久刪除。

Frontend capability 不是 security authority。教專操作 `manageTherapistMaster` 時 Backend 必須重新驗證：

```text
server-issued Application Identity
→ drcyjIdentity = true
→ identityVersion = application-identity-v1
→ exact brandId
→ roleId = trainer
→ exact accountId binding
→ Trusted Device
→ current credential re-verification
→ current trainer therapist-manager permission
```

Trainer action allowlist：

```text
get             ALLOW
create          ALLOW
update          ALLOW
archive         ALLOW
restore         ALLOW
reset_password  ALLOW

delete          DENY
list            DENY
```

`delete` 不因 UI 隱藏而視為安全；Backend allowlist 亦 fail-closed。密碼查看仍走既有 single-account credential reveal authority，並維持 highest-management-key + personal super-admin session 的既有安全邊界；trainer Frontend 不提供 reveal control，也不呼叫該 authority。

多管理者／撤權 race：trainer mutation transaction 會重新讀目前品牌 `permissions` authority；若管理者在操作期間撤銷 `therapist-manager`，交易不得依賴先前 Frontend state 繼續寫入。

Firestore Rules 不放寬：

```text
therapists              frontend write = deny
therapist_credentials   frontend read/write = deny
```

品牌隔離維持既有 resolver：

```text
CYJ    → legacy physical root
anniu  → brands/anniu/...
yibo   → brands/yibo/...
```

本批沒有新增 Firestore listener、polling、scheduler 或 collection scan。教專 selected-record / mutation 的新增成本只限 current permission single-document point read。

Security regression owners：

```text
tests/trainerTherapistManagerAuthority.test.js
tests/therapistMasterAuthority.test.js
tests/therapistMasterWriteLockdown.test.js
tests/applicationLoginDirectoryFrontendCutover.test.js
tests/therapistManagerBackendCutover.test.js
tests/therapistManagerOptimization.test.js
e2e/tests/trainer-therapist-manager.spec.js
```

`CURRENT_APP_VERSION = 3.6.0` 不變。

---

# AUTH_AND_SECURITY.md

# P2-A2.4 Current Store-Month Read Security Boundary — 2026-09-28

B3-2 consumer readiness mutation 已使用 server-issued Application Identity 綁定 actor，並完成 Production negative probe：anonymous Firebase session 即使聲稱最高管理者 actor，也會在 credential / audit / write 前被 `admin_application_identity_mismatch` 拒絕。

正式 promotion security chain：

```text
Firebase request auth
→ Application Identity pre-bind
→ Trusted Device
→ current credential re-verification
→ super_admin
→ Application Identity post-bind to verified actorAccountId
→ explicit confirmation
→ revision OCC transaction
→ consumerReady promotion
→ immediate post-audit fail-closed
```

B4 Frontend projection read 不新增 Browser write authority：

```text
current_store_month_reports_status
current_store_month_reports
```

仍由 Firestore Rules 限制為 same-brand Application Identity read、Browser write deny。Frontend 只在已驗證 application session 下啟動 current-month read flow，且 status 的 brand/month/schema/readiness/signature contract 不可信時回 Raw source，不跨品牌沿用上一品牌 readiness。

B4 不修改 credential、Trusted Device、Rules、Backend mutation authority 或 IAM。

---

# P0 Administrative Authority Security Override — 2026-09-24

P0 已完成 Browser administrative writer retirement 與 Rules 收口。

## Application Identity Boundary

正式管理資料權限不以單純 Firebase signed-in 作為 authority；Rules / Backend 使用 server-issued Application Identity 的 brand / role / account 身份，管理性 mutation 另外要求高階管理者安全鏈。

## Organization Mutation

```text
Frontend intent
→ manageManagerOrganization
→ authenticated director identity
→ highest-admin / Trusted Device / credential verification
→ transaction / OCC
→ Backend write
```

`org_structure` 與對應 restore / mutation surface 不再接受 Browser 直接寫入。

## Management Delegation Mutation

```text
Frontend intent
→ manageManagementDelegation
→ POST only
→ Firebase request auth
→ server-issued director Application Identity
→ highest-admin verification
→ Trusted Device
→ current credential re-verification
→ brand-scoped transaction
```

正式 action：

```text
create
update
end
```

安全要求：

```text
same-brand principal / delegate identity
authorized store scope
no self-delegation
valid date range / scope
editOrganization = false
semantic OCC on update/end
overlap protection across different delegation IDs
```

多最高管理者同時寫入時，以 Backend-only `management_delegation_authority/state` 作 brand mutation serialization surface；不得依賴 Browser 先查後寫避免 race。

## Rules Boundary

兩套 physical roots：

```text
brands/{brandId}/management_delegations/{delegationId}
artifacts/{appId}/public/data/management_delegations/{delegationId}
```

正式 Rules：

```text
read  = same-brand Application Identity
write = false from Browser
```

Backend-only authority state：

```text
brands/{brandId}/management_delegation_authority/state
artifacts/{appId}/public/data/management_delegation_authority/state
```

Frontend read/write 均不得作為 authority。

## Audit / Secret Boundary

Delegation mutation 的 audit 與正式 mutation 在 Backend authority 流程內產生；Browser 不再另寫 delegation maintenance log。Audit 不保存 submitted password、token 或其他 secret material。

## Production Evidence

```text
Backend function ACTIVE / Node.js 22
Frontend Production release confirmed
Firestore Rules active release + source match confirmed
pre-Rules create/update/end smoke = PASS
post-Rules create/update/end smoke = PASS
CURRENT_APP_VERSION = 3.6.0 unchanged
P0 = CLOSED
```

---

# Therapist Credential Separation / Legacy Retirement Security Override — 2026-09-15

正式 Production lineage：

```text
Official repo                    = ~/cyj-new
Production runtime commit        = 8e69eb27c59ae4aa81353cd3af879f7b80a3c6ff
origin/main                       = 8e69eb27c59ae4aa81353cd3af879f7b80a3c6ff
Frontend Production gh-pages     = 3126b4bc3df034dd4565b6f0a9aadae1f1c2171c
CURRENT_APP_VERSION              = 3.6.0
Credential retirement ancestor   = cce7c7d93a5a8907f122f18d480f30b1d1b90f9f
Annual mobile stability ancestor = 7c461156f2cab5ea3c0cb8b8e33778624b73b3c0
Dashboard UX2A ancestor          = 65a8e327b9cb8c60ed8573066c5fe2228b9e3d1c
Dashboard UX2B ancestor          = d7b5de96238e1889cb6830220d80f7f23d55ba97
Annual/Daily UX2C runtime        = 8e69eb27c59ae4aa81353cd3af879f7b80a3c6ff
```


正式管理師 credential 安全邊界：

```text
therapists
→ 人員主檔
→ credentialStorageMode 必須是 separated_v1
→ password 不得存在

therapist_credentials
→ credential document
→ schemaVersion = therapist-credential-v1
→ Frontend read/write = deny
→ Backend Admin SDK authority
```

正式 password consumers / writers 全部經 shared Backend authority：

```text
Login
→ deviceApproval.loadTherapistCredentialSource(...)

Self password change
→ accountAuthority
→ updateTherapistCredentialPasswordInTransaction(...)

Admin reset
→ therapistMasterAuthority
→ resetTherapistCredentialPasswordInTransaction(...)

Create therapist
→ therapist master transaction
→ create separated credential directly
```

Fail-closed states：

```text
credentialStorageMode missing
embedded_legacy
embedded_legacy_pending_migration
master password still present
separated credential missing
separated credential invalid
dual source
```

這些狀態不得 fallback 回 `therapists.password`。

正式退役：

```text
migrate_credential
credential_migration_inventory
single-account migration action
System Maintenance batch migration UI
legacy compatibility read
```

Rules 對兩套 physical roots 都維持 therapist credential frontend deny；本 closeout 不新增 Rules 寬鬆例外。

Regression owner：

```text
tests/therapistCredentialRetirement.test.js
```

安全文件不得記錄任何實際 password / API key / token；此原則不變。

---


> 本文件描述目前正式登入、帳號、閒置節流、裝置信任、登入監控與 Firestore Rules 邊界。  
> 安全文件刻意不保存實際帳號密碼、API Key、Bot Token 或其他 credential。

---

# Smart Forecast / Projection Context Security Override — 2026-09-11

Smart Forecast 的「看得到頁面」與「可以改正式情境資料」是兩層不同 authority。

## View / Read Boundary

`smart-forecast` 已加入 module permission：

```text
director
→ 依既有 director view gate

其他 role
→ 依 permissions.{role} 是否包含 smart-forecast
```

Firestore `projection_context` 本身採：

```text
signedIn → read
frontend write → deny
```

因此 module permission 是前端 product access gate；**Firestore read rule 不是細粒度 server-side role authorization**。不可把「頁面沒顯示」誤寫成「Rules 已禁止所有其他登入角色讀取」。

## Mutation Boundary

正式 writer：

```text
manageProjectionContext
```

安全鏈：

```text
POST
→ requireFirebaseRequestAuth
→ strict brand / YYYY-MM validation
→ verifySuperAdminActor
   → highest-admin identity
   → Trusted Device
   → current credential re-verification
→ expectedRevision
→ Firestore transaction
```

Frontend `canEdit` 只決定 UX；Backend 不信任前端 `role` / `canEdit` 作 mutation authorization。

## Multi-admin Race Safety

Transaction 先讀目前：

```text
projection_context/{YYYY-MM}
```

若：

```text
currentRevision != expectedRevision
```

則：

```text
HTTP 409
PROJECTION_CONTEXT_CONFLICT
currentContext = latest persisted context
```

Frontend 必須以 `currentContext` 更新目前畫面，再由操作者重新確認後儲存；不得 silent last-write-wins。

同一 transaction 也重新讀：

```text
store_lifecycle/master
audit_exclusions
```

所以活動範圍與店級日期不是只信任前端先前載入的名單；Backend commit 前會用目前 Lifecycle / System Exclusion authority 再驗證。

## Rules / Audit

兩套品牌 root 都有 explicit protection：

```text
brands/{brandId}/projection_context/{...}
artifacts/{appId}/public/data/projection_context/{...}

read  = signedIn
write = false
```

`projection_context` 同時從 broad signed-in write catch-all 排除，避免較寬鬆規則覆蓋 explicit deny。

每次成功更新另 append：

```text
maintenance_logs
type = projection_context
source = manageProjectionContext
brandId / yearMonth / revision
eventCount / scheduledStoreCount
operator metadata
```

Audit 不保存使用者 credential。

## Production Confirmation

本次已部署：

```text
Firestore Rules
manageProjectionContext
GitHub Pages frontend
```

使用者已在 Production 確認：

```text
real save + reload persistence          PASS
logout/login persistence                PASS
cross-brand isolation                   PASS
per-store scheduled dates               PASS
stale-revision OCC                      PASS
```

`CURRENT_APP_VERSION` 維持 `3.5.3`。

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

## 2.1 高階主管頁面權限（Module Permissions v2）

`director` 之下的頁面進入權限不再由 `App.jsx` 的固定清單單獨決定。

目前正式設計：

```text
directorLevel = super_admin
→ 固定可使用全部系統頁面
→ 不接受角色矩陣取消

directorLevel = operation_admin / finance_admin / viewer
→ 由目前品牌的 permissions.directorLevels 決定可進入頁面
```

安全固定規則：

```text
dashboard
→ 所有高階主管層級固定保留，作為登入首頁

settings
→ 固定只允許 super_admin
→ 不可由權限矩陣授予其他 directorLevel
```

這一層的語意是：

> 頁面進入 / 顯示權限。

它**不是**通用的 action-level 唯讀 ACL。若某角色可以進入某頁，該頁內具體寫入 action 仍必須依該功能既有的 Frontend guard、Backend authority 與 Firestore Rules 判斷；不得因為「僅查看」角色名稱就推論所有頁面內 action 已自動唯讀。

角色矩陣的正式 writer 沿用：

```text
manageModulePermissions
```

Backend 仍會重新驗證：

- Application Identity
- `super_admin`
- Trusted Device
- fresh credential / actor authority
- brand scope
- `expectedRevision` / revision OCC

Browser 不直接寫 `permissions`。

多管理者同時修改時，transaction 會比對目前 `revision`；若版本已被其他最高管理者更新，回傳 conflict，Frontend 必須重新載入目前 authority，不得 last-write-wins 覆蓋。

三品牌保持獨立：

```text
CYJ
→ artifacts/default-app-id/public/data/global_settings/permissions

安妞
→ brands/anniu/settings/permissions

伊啵
→ brands/yibo/settings/permissions
```

因此調整 CYJ 的高階主管頁面權限不會默默改到安妞或伊啵。

相容性規則：

- `module-permissions-v1` / 缺少 `directorLevels` 的舊文件會以既有 Production hardcoded director 預設作 fallback。
- 新版 Backend 若收到舊 client 的 module-permission save、payload 沒有 `directorLevels`，transaction 會保留目前文件中的 `directorLevels`，避免舊 client 把新權限矩陣清掉。

Reads：

```text
new listener = 0
new query    = 0
new polling  = 0
```

沿用 App 登入／切品牌後既有的單次：

```text
getDoc(getDocPath("permissions"))
```

---

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
- store 先選「區長」作帳號篩選，再選店經理帳號
- therapist 依人員 master 登入
- inactive account 阻擋
- 初始密碼偵測
- 強制第一次安全更新

店經理登入的第一層「區長」是 **discovery / presentation filter**，不是 authentication authority：

```text
Backend sanitized login organization（manager → stores）
+ sanitized store account directory（account → stores）
→ 前端只做交集篩選
→ 選定 store account id
→ 既有 Backend password / Application Identity / Device Security 驗證
```

因此切換區長時只清空已選店經理，不改 account identity、角色、權限或 Device Approval 規則。若存在尚未映射到正式區長的店經理帳號，登入頁保留「未分區／其他」入口，避免帳號因組織資料缺口而從登入 UI 消失。

這個 UX 沿用登入 bootstrap 已取得的 sanitized directory / organization，不新增 Firestore listener、query 或 polling。

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

## 22.1 Manual Device Review Atomicity

`SystemMonitor` 的手動裝置處置與最高管理者救援都屬於 Security authority mutation。

正式 writer contract：

```text
account_devices
+ global_blocked_devices（需要時）
+ device_approval_requests（若仍 pending）
+ device_approval_inbox / security_summary（若 pending request 被結束）
→ 同一 Firestore transaction
```

目的：

- 避免 account device 已改、global block 尚未改的 partial state。
- 避免多位最高管理者同時操作時，跨文件 Security authority 互相矛盾。
- transaction 會讀取相關 authority document 後再寫入，使並發 mutation 由 Firestore retry/serialization 處理。
- verification secret cleanup 與 append-only security audit log 在 transaction 成功後執行，不作為 authority commit 的一部分。

這項 hardening 不新增 listener、polling 或 collection scan；Frontend 與 Firestore Rules 的 writer boundary 不變。

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

目前仍以：

```text
signedIn()
```

作為多數既有資料的基礎 gate；**不能**因此宣稱整套 Firestore 已做到完整 server-side role authorization。

但目前正式 Rules 已對多個敏感 authority 做 explicit protection，例如：

```text
management_delegations
system_logs
account_devices / Device Approval / Security state
store_lifecycle
permissions / audit_exclusions
projection_models
projection_accuracy
projection_accuracy_history
projection_context
```

其中 `projection_context`：

```text
signed-in read = allowed
frontend write = false
```

正式 mutation 只能走 `manageProjectionContext` Backend writer。

因此正確描述是：

```text
部分敏感 authority 已 Backend-only / write-deny
+
大量一般既有營運資料仍沿用 broad signed-in access
!= 全系統已完成 server-side role authorization
```

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

# 33. Projection Model Administrative Security — Batch 8

`projection_models/current` 是 Backend-owned derived authority，不是一般 Settings。

Firestore Rules：

```text
brands/{brandId}/projection_models/{document=**}
artifacts/{appId}/public/data/projection_models/{document=**}

allow read  = signedIn()
allow write = false
```

因此 Frontend / browser 不可直接建立或覆寫 Projection Model。

正式 writer：

```text
functions/projectionAuthority.js
Admin SDK
```

## Manual rebuild

```text
rebuildProjectionModelNow
```

安全邊界：

```text
POST only
→ requireFirebaseRequestAuth()
→ normalize brand
→ verifySuperAdminActor()
→ highest admin
→ Trusted Device / credential protection
→ rebuild
```

未通過 Firebase request auth：

```text
401
```

未通過最高管理者安全驗證：

```text
403
```

Lifecycle authority 未 READY 或 rebuild scope / snapshot 衝突：

```text
409 / fail closed
```

## Race condition

Projection Model rebuild 不是「讀完就直接寫」。

正式流程：

```text
read Lifecycle + System Exclusion
→ build bounded model
→ transaction re-read Lifecycle + System Exclusion
→ same authority snapshot?
    YES → publish
    NO  → abort stale publish
```

因此多管理者／設定變更與 scheduled rebuild 同時發生時，不應由舊 snapshot 覆蓋新 authority。

Consumer trust 仍會再次核對 current Lifecycle / Reporting Calendar / System Exclusion；Rules write protection不能取代 runtime trust check。

# Activity Sales Center Security（Phase 1A feature branch）
- Policy 修改：既有最高管理者 + Trusted Device 安全邊界。
- Campaign action：Firebase Application Identity + Trusted Device + fresh credential。
- 建立 / 直接發布 / 手動發布不硬編職務，由品牌 policy 的帳號 / 群組配置。
- campaign revision + transaction 防 lost update。
- `allowCreatorApproval=false` 時建立者不可核准自己。
- Browser 對 Activity Sales authority collections 全部禁止寫入。
- Campaign mutation 在同一 transaction 內讀取 current Activity Sales policy，再做 creator / direct publisher / publisher 授權，避免 policy 變更 race 使用 stale authority。
- `allowCreatorApproval=false` 對 `all` quorum 採 fail-closed：只要該步驟包含建立者即拒絕送審，避免形成永遠無法完成的審核步驟。


## Activity Sales Phase 1B 讀權限收斂（feature only）
- `activity_sales_policy`, `activity_campaigns`, `activity_campaign_versions`, `activity_campaign_approvals`, `activity_sales_audit`：Browser read/write 全部 deny，不能透過同品牌登入繞過管理權限看到未發布內容。
- `activity_sales_publications`：僅已通過正式 Application Identity 的同品牌用戶可 read；write deny；CYJ legacy 路徑同等保護。
- 發布/停止透過 Backend transaction 同步刷新展示投影；不依賴 UI 的條件過濾代替 Security。
- Backend 寫入 additionally 比對 Auth custom claims（brandId / roleId / accountId）與重新驗證的 actor，跨品牌/跨帳號 Token 一律拒絕。

## Activity Sales Phase 1C-1 隔離讀取權限（feature branch only）
`getActivitySalesWorkspace` 是 Backend-only、POST-only 的 Activity Sales 管理讀取入口。透過有效 Firebase Application Identity token 與 body actor 的 brand/role/account 完全匹配，再重新執行 Trusted Device + 目前憑證驗證；不得只憑前端 UI 判斷或從 Browser 直接讀私人 collections。`capabilities` 僅輸出本人權限旗標與可用群組名稱；`get_campaign` 按 ID 單筆取得並檢查 creator/publisher 或目前審核人員快照，非授權者回 403。當 creator policy 權限遭撤銷，單靠歷史 createdBy 不可繼續觀看草稿。權限與資料的讀取置於同一唯讀 transaction，避免政策與活動狀態取自不同快照。對版本／審核識別不一致一律拒絕。所有寫入仍經 Phase 1A writer + revision OCC；此 API 不對外提供寫入。尚未部署正式環境。

## Activity Sales Phase 1C-2（隔離 feature）
- 待辦讀取入口僅由 Backend 驗證 Application Identity + 品牌 + 裝置 + 目前憑證後執行；`activeReviewerKeys` 不接受客戶端傳入，而是從已驗證帳號計算。Inbox 讀取限同品牌 `array-contains` 單次 20 筆；回應不包含 policy 全量、私有 approval 決策或審核人員名冊。
- `get_policy` 將 Policy 群組成員等敏感資訊只提供予通過 `verifySuperAdminActor` 的最高管理者；寫入仍由既有 OCC transaction authority；前端 Rules 不新增 Policy read/write 授權。
- 審核 inbox key 以提交時 resolved approver snapshot 為準；多核准者表態後在同一 transaction 更新，revision OCC 保護 campaign，避免重複核准與舊待辦殘留。
