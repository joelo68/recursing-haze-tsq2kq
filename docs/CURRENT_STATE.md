# CURRENT_STATE.md

> 用途：記錄「目前正式環境已確認到哪個狀態」。這不是 CHANGELOG。  
> 優先順序：使用者提供的目前正式部署 source > 本檔案 > 其他 Knowledge Base 文件。  
> 最後整併更新：**2026-08-25 18:10（UTC+8）**。

# 1. Production Source Snapshot

## Frontend — 已確認目前上線

使用者於 2026-08-25 明確提供兩支「目前上線」檔案：

```text
src/App.jsx
→ App(20260825-082252).jsx

src/components/DeviceApprovalPanel.jsx
→ DeviceApprovalPanel(5).jsx
```

目前 `App.jsx` 可直接確認：

```text
Framework: React + Vite
CURRENT_APP_VERSION = 3.5.3
Firebase project endpoint: cyjsituation-analysis
```

因此 App／Header／Guided Device Approval 的目前正式前端行為，以這兩支 source 為準。

## Backend — 正式部署確認邊界

本次整理文件時，沒有再由使用者同時提供「目前實際部署中的 `functions/deviceApproval.js`」作為最新 Production snapshot。

因此後續 Backend 狀態必須分成：

```text
已由 Production source／使用者實測確認
vs
程式已完成＋Regression 已通過，但尚待正式部署確認
```

不可把後者默認寫成已上線。

# 2. 目前正式前端 Security State

v3.5.3 `App.jsx` 可確認：

- `security_config.deviceApprovalMode`：`off | monitor | enforce`
- 預設 Device Approval roles：`director`、`trainer`、`manager`、`store`、`therapist`
- 預設確認期限：15 分鐘
- Trusted Device self approval 設定存在
- 最高管理者會即時監聽 `security_summary/device_approvals`
- 目前登入帳號會監聽 `device_approval_inbox/{accountKey}`
- Header 的「目前裝置信任狀態」與「待確認 Badge」是兩個不同狀態
- enforce 模式已有自己的 Guided Device Approval
- Guided Flow 只處理「目前帳號自己的另一台裝置」
- `DeviceApprovalPanel` 是共用處理介面

目前上線的 `DeviceApprovalPanel.jsx` 可確認：

- 自己的 6 位碼 self approval 與最高管理者人工覆核是兩條不同路徑
- 最高管理者人工覆核要求目前操作裝置為 Trusted
- 管理操作包含允許、繼續觀察、要求重新驗證、禁止裝置
- Guided Flow 會先問「是否本人正在另一台裝置登入」
- 「不是我」可進入拒絕／阻止新裝置的安全流程

# 3. Current App Version

```text
CURRENT_APP_VERSION = 3.5.3
```

不得因為歷史 README 或舊 Knowledge Base 還寫 3.4.x／3.5.0～3.5.2，就反過來改掉目前正式版本號。

# 4. Device Approval 目前正式前端可確認行為

## Current Device Status

目前 App UI 至少理解：

```text
trusted
new
observing
reverify_required
suspicious
blocked
```

對應前端用語包含：

```text
🛡 目前裝置已信任
⚠ 新裝置待確認
⚠ 新裝置待觀察
⚠ 主管要求重新驗證
⛔ 此裝置已停用
```

## Guided Self Verification

在 enforce 模式，原本 Trusted Device 可以主動被帶入自己的新裝置確認流程，不再要求一般使用者自己注意 Header Badge。

目前正式前端使用小型 inbox `pendingCount` 當 trigger；真的有自己的待確認案件時，才做 account-scoped pending lookup。

# 5. Telegram Login Security State

登入安全 Telegram 與一般 Gemini Telegram Agent 是兩條不同 pipeline。

目前已完成／驗證的安全事件類型包括：

```text
password_failed_threshold
device_code_failed_limit
manager_assistance_required
self_reported_not_me
rapid_multi_location_login
blocked_device_login
```

正常 Trusted 登入與成功的正常自我認證，不需要發送 Telegram Security Alert。

Security Telegram 是事件驅動，不是固定週期輪詢 Firestore。

此功能先前已在專案工作流程中完成實際推播測試；未來只要再次修改相關 Functions／Rules／前端設定，仍需重新做部署後驗證。

# 6. 已完成且 Regression 通過，但尚待正式部署確認

最新整合套件：

```text
summary-first-super-admin-notice-20260825
```

App version 維持 3.5.3，新增「最高管理者 admin-only first-device approval」的非阻斷式 Security Action Card。

## Summary-first 設計

舊一版需要：

```text
brandPendingCount 改變
→ 再 query pending collection
→ 判斷是否真的需要提醒最高管理者
```

最新版本改成讓：

```text
security_summary/device_approvals
```

直接維護：

```text
adminAssistancePendingCount
adminAssistancePendingItems
latestAdminAssistanceRequestId
latestAdminAssistanceUserName
latestAdminAssistanceRole
latestAdminAssistanceDevice
latestAdminAssistanceAtText
```

只有：

```text
deviceApprovalMode = enforce
＋
selfApprovalAllowed = false
```

才進入最高管理者協助佇列。

前端沿用原本 summary listener；Security Action Card 真正顯示後，才只監聽那一筆 request。

## Multi-super-admin Race Condition Hardening

這個整合版也包含 first-resolver-wins 的交易處理：多位最高管理者同時處理同一筆 request 時，只讓第一位成功；第二位收到「已由誰完成處理」的 conflict response，而不是 false success。

## 已完成驗證

```text
functions/deviceApproval.js syntax：PASS
deviceApproval regression：49 / 49 PASS
superAdminDeviceNotice regression：13 / 13 PASS
App.jsx JSX parser diagnostics：0
DeviceApprovalPanel.jsx JSX parser diagnostics：0
```

**正式部署與 runtime 測試完成前，不得把本章移到 Production-confirmed。**

# 7. Dashboard / Summary State

本次 2026-08-25 整理沒有改 Dashboard 資料邏輯。

現有正式原則仍是：

- 當月優先 realtime／detail
- 歷史月份優先 verified Summary
- dirty／pending／mismatch 時安全 fallback
- Summary Repair 維持 backend-driven
- 2026-08-24 Yibo pre-system month 防循環修正仍由 `DASHBOARD_SUMMARY.md`、`MAINTENANCE_TOOLS.md` 記錄

# 8. Store Identity State

`DATA_IDENTITY_RULES.md` 仍是 CYJ 新店正式規則：

```text
coreStoreName      = 新店
canonicalStoreName = CYJ新店店
```

本輪 Security 升級不改 Store Identity。

# 9. Deployment Command Boundary

Root `npm run deploy` 與 Firebase Hosting 不是天然同一件事。

目前既有 repository 文件記錄 root package script：

```text
npm run deploy
→ npm run build
→ gh-pages -d dist
```

Firebase Hosting 是另一個 Firebase CLI target：

```bash
firebase deploy --only hosting
```

Device Security 修改應依實際改動範圍，只部署必要 Functions／Hosting／Rules。詳細見 `DEPLOYMENT.md`。

# 10. 目前待完成的 Production 動作

在把 Summary-first 最高管理者提醒寫成「已上線」以前，應在正式 repository 執行：

```bash
node --check functions/deviceApproval.js
node --test tests/deviceApproval.test.js tests/superAdminDeviceNotice.test.js
npm run build
```

然後先部署會建立／結束 pending request 的 Device Approval Functions，再部署會讀取新 summary 欄位的前端。

部署後實測確認正常，再更新本檔，把該功能移入 Production-confirmed。

# 11. 本次文件整理已完成的清理

- Canonical 文件不再把 3.4.1／3.4.2 當目前版本。
- 舊「前幾台裝置 auto trust」模型已從目前 Security 架構移除。
- Data Model 已補 Device Approval／Login Security collections。
- Telegram 文件已區分「Gemini Agent」與「登入安全 Telegram Event」。
- v3.5.0／v3.5.1／v3.5.2 舊 release note 保持原內容，移入 `docs/archive/`。
- 重複的 `SYSTEM_SOURCE_MAP.md.md` 不再列入正式維護文件。

# 12. 本文件更新原則

只有目前正式 source、使用者明確確認、或部署後 runtime 驗證可以支持「已部署／已正式啟用」。

無法確認時一律寫：

```text
未由目前正式來源確認
```
