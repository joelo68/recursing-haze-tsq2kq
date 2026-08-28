# CURRENT_STATE.md

> 用途：記錄「目前正式環境已確認到哪個狀態」。這不是 CHANGELOG。  
> 優先順序：使用者提供的目前正式部署 source > 本檔案 > 其他 Knowledge Base 文件。  
> 最後整併更新：**2026-08-28（UTC+8）**。

# 1. Production Source Snapshot

## Frontend — Production 狀態與最近可直接檢視的 source snapshot

使用者於 2026-08-25 稍早曾明確提供兩支當時「目前上線」檔案：

```text
src/App.jsx
→ App(20260825-082252).jsx

src/components/DeviceApprovalPanel.jsx
→ DeviceApprovalPanel(5).jsx
```

該批 `App.jsx` 可直接確認：

```text
Framework: React + Vite
CURRENT_APP_VERSION = 3.5.3
Firebase project endpoint: cyjsituation-analysis
```

2026-08-25 晚間，使用者已在上述正式基線與 race-condition backend 基礎上完成 Summary-first 最高管理者通知整合、測試與正式部署；`CURRENT_APP_VERSION` 仍維持 3.5.3。

因此：

```text
目前 Production 功能狀態 → 可由使用者部署／runtime 確認支持
最近可直接檢視的 source snapshot → 上述兩支部署前正式檔案
最新部署後完整 source snapshot → 尚未重新附回本對話
```

未來再修改這條 Security 流程前，必須重新取得部署後最新正式 source；不得把上述兩支舊 snapshot 直接當成目前最新可修改版本。


## Frontend / Target Authority — 2026-08-28 Production 補充

2026-08-28，使用者以本次最新正式 source 完成 Batch 3「Target Authority / Lifecycle-aware Coverage」整合、正式 repo regression、production build、GitHub Pages 發布與 Production smoke test。

本次可由正式 source／deploy log／runtime 驗證確認：

```text
CURRENT_APP_VERSION = 3.5.3（未提高）

Target Writer：
- blank / missing / 0 base target 不再被當成已設定目標
- 未設定欄位在 monthly_targets Raw document 中不建立 numeric 0
- challenge target 必須大於 valid base target

Target Coverage：
- cash / accrual coverage 獨立計算
- eligibility 由 READY Store Lifecycle monthly cohort 提供
- 正常 monthly_targets 異動採 event-driven scoped rebuild
- 不新增前端大型 listener / polling
```

已正式確認的 Production case（CYJ / 2026-09）：

```text
eligibleStoreCount = 33

cashConfiguredStoreCount = 33
cashCoverageComplete = true

accrualConfiguredStoreCount = 32
accrualCoverageComplete = false
accrualMissingStores = ["CYJ北大店"]
```

將該店 cash target 清空後，Production Summary 正確變更為：

```text
cashConfiguredStoreCount = 32
cashCoverageComplete = false
cashMissingStores 包含 CYJ北大店
```

Challenge validity 也已完成正式測試：

```text
challenge == base  → 拒絕
challenge < base   → 拒絕
challenge > base   → 允許
```

因此 Batch 3 runtime 狀態可標記為：

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED
```

未來若再次修改 Target / Coverage / Lifecycle consumer，仍必須重新取得當時最新正式 source，不得直接沿用本次部署前附件。

## Backend — 正式部署確認邊界

2026-08-25 晚間，使用者已明確確認最新 Summary-first 最高管理者 Security Action Card 套件已完成正式發布部署，且初步 Production 測試成功。該套件整合上一輪已完成 race-condition hardening 的 Device Approval backend，`CURRENT_APP_VERSION` 維持 3.5.3。

目前本 Knowledge Base 可把此功能標記為：

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED（初步）
OBSERVATION（持續觀察可能 Bug）
```

但本輪部署完成後的最新 `functions/deviceApproval.js`／`App.jsx`／`DeviceApprovalPanel.jsx` 尚未重新作為 source snapshot 附回本對話，因此未來若要再次修改相關功能，仍必須重新取得「目前正式上線 source」，不得直接拿部署前附件修改。

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

# 6. Summary-first 最高管理者 Security Action Card — 已正式部署

最新整合套件：

```text
summary-first-super-admin-notice-20260825
```

App version 維持 3.5.3，正式啟用「最高管理者 admin-only first-device approval」的非阻斷式 Security Action Card。

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

## Production Confirmation

2026-08-25 晚間使用者已確認：

```text
正式發布部署：完成
初步 Production 測試：成功
CURRENT_APP_VERSION：3.5.3（未提高）
目前狀態：持續觀察是否出現 Bug／邊界案例
```

因此本功能已可標記為 `DEPLOYED` 與初步 `PRODUCTION CONFIRMED`；後續若觀察到異常，應以最新正式 source 重新診斷，不回退使用本次部署前附件。

# 7. Dashboard / Summary State

本次 2026-08-25 整理沒有改 Dashboard 資料邏輯。

現有正式原則仍是：

- 當月優先 realtime／detail
- 歷史月份優先 verified Summary
- dirty／pending／mismatch 時安全 fallback
- Summary Repair 維持 backend-driven
- 2026-08-24 Yibo pre-system month 防循環修正仍由 `DASHBOARD_SUMMARY.md`、`MAINTENANCE_TOOLS.md` 記錄


## 7.1 Pre-system Month Repair — Production Verification Closed

2026-08-24 針對 Summary Repair 的 pre-system month 防循環修正完成正式 Production 長時間驗證。

Production validation：

```text
觀察時間：2026-08-24 12:12～13:30（UTC+8）
總觀察：約 77 分 54 秒
```

Result：

```text
✅ 16 個連續 repairDirtySummaries 週期
✅ 16 / 16 皆回報沒有到期 dirty / pending
✅ 16 / 16 HTTP 200
✅ 2026-01～03 不再進 repair job
✅ monthly_targets full fallback warning = 0
✅ Summary repair failure = 0
✅ ERROR / CRITICAL = 0
✅ 觀察時間已超過兩個 30 分鐘尺度
✅ 未觀察到 queue fallback 將 pre-system months 重新帶回 repair loop
```

Final status：

```text
PRODUCTION VERIFIED
INCIDENT CLOSED
```

這項結論只適用於已完成驗證的 pre-system month repair incident；未來若 Summary Repair source 再有修改，仍需重新依最新正式 source 與 runtime observation 驗證。

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

# 10. 目前 Production 觀察事項

Summary-first 最高管理者提醒已完成正式部署與初步 Production 測試，目前不再有「待部署」動作。

後續觀察重點：

```text
Security Action Card 是否只在 admin assistance pending 時出現
「稍後處理」後 Header pending 是否仍保留
request resolved 後 Card／Summary 是否正確清除
多位最高管理者同時操作時是否維持 first-resolver-wins
是否出現重複通知、殘留 pending 或錯誤成功狀態
Firestore reads 是否維持 Summary-first 設計，沒有重新引入 pending collection 常駐 query
```

若後續要修正任何觀察到的 Bug，開工前必須重新取得部署後的最新正式 `App.jsx`、`DeviceApprovalPanel.jsx`、`functions/deviceApproval.js`，以及實際受影響的其他 source。

# 11. 本次文件整理已完成的清理

- Canonical 文件不再把 3.4.1／3.4.2 當目前版本。
- 舊「前幾台裝置 auto trust」模型已從目前 Security 架構移除。
- Data Model 已補 Device Approval／Login Security collections。
- Telegram 文件已區分「Gemini Agent」與「登入安全 Telegram Event」。
- v3.5.0／v3.5.1／v3.5.2 舊 release note 保持原內容，移入 `docs/archive/`。
- 重複的 `SYSTEM_SOURCE_MAP.md.md` 不再列入正式維護文件。


# 12. Target Authority / Lifecycle-aware Coverage — Batch 3 已正式確認

2026-08-28 完成 Batch 3 正式部署與 Production smoke test。

## Source / Architecture

主要 runtime owner：

```text
src/components/TargetView.jsx
src/components/SettingsView.jsx
src/App.jsx
src/utils/storeLifecycle.js

functions/storeLifecycle.js
functions/targetCoverage.js
functions/index.js
```

Regression：

```text
tests/kpiContracts.test.js
tests/storeIdentity.test.js
tests/storeLifecycle.test.js
tests/targetAuthority.test.js
```

## Validation

正式 repository 實際完成：

```text
KPI Contracts       15 / 15 PASS
Store Identity       7 / 7 PASS
Store Lifecycle     22 / 22 PASS
Target Authority    13 / 13 PASS
--------------------------------
Total               57 / 57 PASS

npm run build        PASS
```

Production deploy：

```text
Backend:
6 scoped Target Coverage Functions deployed successfully

Frontend:
GitHub Pages deployment → Published
```

正式 Production runtime 已確認：

```text
Raw blank target
→ monthly_targets 不建立 numeric 0 欄位

Derived missing target
→ monthly_targets_summary 使用 null / missing semantics
→ 不與 real zero 混淆

Cash Coverage
!=
Accrual Coverage

Store Lifecycle datasetStatus = READY
→ monthly eligible cohort 才可作 coverage authority
```

## Deployed Functions

```text
onLegacyMonthlyTargetChange
onBrandMonthlyTargetChange

onLegacyMonthlyTargetSummaryChange
onBrandMonthlyTargetSummaryChange

onLegacyStoreLifecycleCoverageChange
onBrandStoreLifecycleCoverageChange
```

本 Batch：

```text
CURRENT_APP_VERSION = 3.5.3（未提高）
Firestore Rules      = unchanged
Frontend polling     = +0
Frontend broad listener = +0
```

## Documentation Impact

本 Batch 已同步更新：

```text
docs/FIREBASE_DATA_MODEL.md
docs/DATA_FLOW.md
docs/SYSTEM_SOURCE_MAP.md
docs/DEVELOPMENT_GUIDE.md
CURRENT_STATE.md
```

# 13. 本文件更新原則

只有目前正式 source、使用者明確確認、或部署後 runtime 驗證可以支持「已部署／已正式啟用」。

無法確認時一律寫：

```text
未由目前正式來源確認
```
