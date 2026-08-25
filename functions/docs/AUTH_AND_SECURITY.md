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

目前前端正式角色：

```text
director   高階主管
trainer    教專
manager    區長
store      店經理
therapist  管理師
```

程式內另有：

```text
master
```

作最高管理者。

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

App 目前 fallback：

```text
enabled = true

lowPowerEnabled = true
lowPowerIdleMinutes = 30

autoLogoutEnabled = true
autoLogoutMinutes = 240

logoutWarningSeconds = 60

exemptRoles = director, master
```

另保留 legacy-compatible：

```text
timeoutMinutes
warningSeconds
```

---

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

# 15. Device Auto Trust

目前正式：

```text
autoTrustLimit = 2
```

也就是帳號前幾台符合條件的裝置可以建立初始信任，
之後的新裝置才進入更明確的 pending / alert 流程。

Alert role：

```text
director
trainer
manager
store
```

目前不包含 therapist。

---

# 16. `account_devices`

每個帳號 profile 下保存 devices map。

Device 狀態目前可看到：

```text
trusted
new
suspicious
blocked
global_blocked
```

資料還會記：

```text
firstSeen
lastSeen
loginCount
loginLocation
browser / os / device
source
review metadata
```

---

# 17. 新裝置登入

如果是未知 device：

```text
trusted device count < autoTrustLimit
→ auto-trust
```

否則：

```text
status = new
trusted = false
```

若 role 在 alertRoles：

```text
security_alerts
```

新增 `new_device_login` alert。

---

# 18. Known Device Recovery

App 有「疑似原裝置」recover 機制。

會參考：

```text
fingerprint
location
known device history
```

找到可恢復舊 device identity 時，
避免瀏覽器 storage 改變就無限制創造「全新裝置」。

這是 compatibility / stability 邏輯，
不可只因看到 deviceId 不同就直接刪除。

---

# 19. Login Location

App 使用 backend endpoint：

```text
resolveLoginLocation
```

回傳 normalize 後至少包含：

```text
display
countryCode
countryName
region
city
district
timezone
isp
ipMasked
source
confidence
isProxy
isMobileNetwork
updatedAtText
```

如果定位服務失敗：

```text
ok = true
location = 未知位置
source = unknown
```

也就是：

> 定位失敗不是登入失敗條件。

---

# 20. IP Privacy

Backend 回傳的是：

```text
ipMasked
```

而不是要求前端保存完整 IP 作 UI 展示。

知識文件不保存使用者實際 IP。

---

# 21. SystemMonitor

主要兩種模式：

```text
logs
devices
```

Log filters：

```text
登入 / 登出
只看登入
只看登出
裝置安全
頁面瀏覽
查詢行為
資料異動
密碼更新
```

Role filters：

```text
高階主管
區長
店經理
管理師
教專
最高管理者
```

---

# 22. Device Management Actions

SystemMonitor 可執行：

```text
設為信任
標記可疑
封鎖目前品牌
全品牌封鎖
解除封鎖並信任
```

這些不是只改 UI state，而會寫回 Firestore。

---

# 23. Brand Block vs Global Block

## Brand block

主要更新：

```text
account_devices
```

目前品牌 device status。

## Global block

SystemMonitor 另取得 global block ref，
寫入：

```text
active
status = global_blocked
scope = all_brands
account
device
blockedBy
blockedAtText
...
```

因此「全品牌封鎖」不等同於普通品牌 device flag。

---

# 24. `security_summary`

SystemMonitor 在 pending device 被正式處理為 trusted 時，
會更新：

```text
security_summary/device_alerts
```

例如降低：

```text
pendingNewDeviceCount
```

並記錄最後處理者。

---

# 25. Security Alert 與 Login Log 是兩條資料

登入：

```text
system_logs
```

裝置異常：

```text
security_alerts
account_devices
security_summary
```

因此未來除錯不能只看 security_alerts
就判斷「這次有沒有登入」。

---

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
