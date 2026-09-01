# CURRENT_STATE.md

> 用途：記錄「目前正式環境已確認到哪個狀態」。這不是 CHANGELOG。  
> 優先順序：使用者提供的目前正式部署 source > 本檔案 > 其他 Knowledge Base 文件。  
> 最後整併更新：**2026-09-01（UTC+8）**。

# 0. 2026-08-31 Source Reconciliation Baseline（Git 已整合／尚未部署）

Source Rebaseline / Reconciliation 已完成並收斂回正式專案目錄：

```text
Official working directory = ~/cyj-new
HEAD                        = 31d8ac6306669bfc300a9a3640605c51efc78b1c
origin/main                 = 31d8ac6306669bfc300a9a3640605c51efc78b1c
branch                      = main
worktree                    = clean

Current production gh-pages tree = a4938a074c5ee2bfb401c9c513ffa592073e7a50
Earlier identical gh-pages commit = 378fc961fe78dc385d7e8bae98be73117d760bb9
```

原 `cyj-new` 兩支未提交 Security source（`LoginView.jsx`、`TelegramAlertControlCenter.jsx`）已確認是 Batch 5 lineage 遺漏的正式 Security delta；reconciliation 同時補上 `global_settings/telegram_security_alerts` 的 Backend authority、Rules protection 與 revision race control：

```text
Frontend
→ updateTelegramSecurityAlertConfig
→ Firebase request auth
→ Trusted Device + Super Admin credential re-verification
→ single-document transaction + expectedRevision conflict check
→ global_settings/telegram_security_alerts
```

Firestore Rules 禁止 `telegram_security_alerts` 前端直寫；其他一層 `global_settings/{settingId}` 維持既有登入後存取。多人同時儲存採 optimistic revision / HTTP 409 conflict，避免 silent last-write-wins。

使用者已在真正 Source of Truth `~/cyj-new` 實際完成：

```text
Functions syntax     = PASS
Security regression  = 63 / 63 PASS
Full regression      = 286 / 286 PASS
npm run build        = PASS
git diff --check     = PASS
Git integrated       = YES
```

目前正式狀態：

```text
IMPLEMENTED = YES
VALIDATED = YES
GIT INTEGRATED = YES
DEPLOYED = NO
PRODUCTION CONFIRMED = NO
CURRENT_APP_VERSION = 3.5.3（未提高）
```

Production frontend 仍停留在 rollback 後的 gh-pages tree；不得因 source / Git 已收斂，就把本段描述為已正式上線。舊 `cyj-new` 現場仍保留於 `stash@{0}: pre-reanchor-cyj-new-20260831`，未經明確需要不得直接 `stash pop`。

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
- blank / missing base target 仍為未設定；明確 numeric 0 自 Batch 5E-1B 起為 configured `VALID_ZERO`
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

# 13. Summary Writer Semantic Migration — Batch 4 已正式確認

2026-08-28 完成 Batch 4「Summary Writer Semantic Migration」正式部署與 Production 驗證。

本 Batch 的核心目的不是切換 Dashboard consumer，而是先讓 Historical Summary Writer 具備可稽核、可比較、可逐步遷移的正式 KPI semantics，同時維持既有 legacy fields / consumers 相容。

## Source / Commit

本次正式部署來源：

```text
Git commit = 7ab92f1
branch = main
origin/main = 7ab92f1
```

部署前另以 exact commit 建立 clean worktree：

```text
/Users/joelo/cyj-batch4-7ab92f1
```

並在該 clean worktree 重新完成 validation，避免原主要 working tree 中其他未提交的 Login / Telegram 變更混入本次 Build / Deploy。

`CURRENT_APP_VERSION` 維持：

```text
3.5.3
```

未提高版本號。

## Implemented Semantics

Batch 4 新增 additive formal KPI semantics；既有 legacy Summary numeric fields 不原地改義。

正式現金語意：

```text
grossCash
= Σ Raw cash

formalNetCash
= grossCash
- refund
- skincareRefund
```

真實 `0` 與負值維持有效值；missing / invalid 不得被默認轉成 `0`。

正式權責語意：

```text
CYJ / 伊啵
totalAccrual  = Σ accrual
formalAccrual = Σ accrual

安妞
totalAccrual  = Σ accrual
formalAccrual = Σ operationalAccrual
```

Historical Summary 新增／確認的 formal metadata / structures 包含：

```text
version = dashboard-summary-v2
semanticVersion = summary-semantics-v1
kpiContractVersion = kpi-contract-v1

storeDailyTotals
formalStoreRankings
formalTargetAuthority
targetCoverage
lifecycleSnapshot
```

Formal Ranking 以 canonical formal cash achievement 為基礎，並尊重 Lifecycle eligibility、target validity 與 missing-data semantics。

## Persisted Trust Verification

Batch 4 已將 Historical Summary trust verification 改為 persisted readback：

```text
Raw rebuild
↓
write dashboard_summary
write therapist_summary
write rankings_summary
↓
重新從 Firestore 讀回 3 份 persisted Summary documents
↓
compare semantic fields / signatures
↓
只有 matched 才可通過
```

不再以 freshly-built object 自我比較作為 verified 證據。

## Validation

正式 repository / exact-commit validation：

```text
KPI Contracts                15 / 15 PASS
Store Identity                7 / 7 PASS
Store Lifecycle              22 / 22 PASS
Target Authority             13 / 13 PASS
Summary Repair Pre-System     3 / 3 PASS
Summary Semantics            21 / 21 PASS
-----------------------------------------
Total                        81 / 81 PASS

npm run build                PASS
```

Batch 4 regression 亦確認：

```text
Frontend / Backend Summary Semantics parity = PASS
Batch 4 source wiring additive              = PASS
Summary-first / store-level comparable      = PASS
新增 polling                                = 0
Backend call graph 僅改 Summary repair path = PASS
```

## Production Deploy

Backend 精準部署：

```text
functions:repairDirtySummaryNow
functions:repairDirtySummaries
```

兩支 Node.js 22 / 2nd Gen Functions 均 Successful update。

Frontend：

```text
npm run deploy
→ build PASS
→ GitHub Pages Published
```

Firestore Rules、Target Coverage Functions、Security Functions、Telegram Functions 均未因 Batch 4 額外部署。

## Production Confirmation — 三品牌代表月份

### CYJ / 2026-07

Rebuild 前 Core Consistency Audit：

```text
異常群組       0
高風險衝突     0
需確認         0
可整理重複     0
Summary 差異   0
```

代表月包含一般退款與生活美容退款，Production rebuild：

```text
Gross Cash       = 38,650,243
General Refund   =    244,776
Skincare Refund  =     18,770
Formal Net Cash  = 38,386,697
```

符合：

```text
38,650,243 - 244,776 - 18,770
= 38,386,697
```

同時 legacy Dashboard 仍顯示：

```text
現金業績 = 38,405,467
權責業績 = 38,725,138
```

證明 Batch 4 為 additive writer migration，尚未提前切換 Batch 5 consumer。

Production persisted compare：

```text
matched = true
mismatchCount = 0
writtenDocs = 3
```

Store-level Formal Signature 與 Formal Ranking Signature 均 persisted `stored == fresh`。

### 安妞 / 2026-06

Rebuild 前 Core Consistency Audit：

```text
異常群組       0
高風險衝突     0
需確認         0
可整理重複     0
Summary 差異   0
```

Production 正式驗證安妞 brand-specific accrual semantics：

```text
totalAccrual  = 30,633,603
formalAccrual = 30,436,598
```

並確認代表店家「文心」：

```text
totalAccrual       = 2,760,573
operationalAccrual = 2,748,793
formalAccrual      = 2,748,793
```

因此：

```text
formalAccrual == operationalAccrual
formalAccrual != totalAccrual
```

Production persisted compare：

```text
matched = true
mismatchCount = 0
writtenDocs = 3
```

### 伊啵 / 2026-06

本月位於伊啵正式系統起始月 `2026-04` 之後，未觸碰 `2026-01～03` pre-system months。

Rebuild 前 Core Consistency Audit：

```text
異常群組       0
高風險衝突     0
需確認         0
可整理重複     0
Summary 差異   0
```

Production 正式驗證：

```text
totalAccrual  = 1,445,218
formalAccrual = 1,445,218
```

符合伊啵 formal accrual 使用 `accrual` 的品牌規則。

Lifecycle / Ranking 亦確認：

```text
stores = 5
eligibleStoreCount = 4
formalRankEligibleStoreCount = 4
```

非 eligible 店不進 Formal Ranking。

Production persisted compare：

```text
matched = true
mismatchCount = 0
writtenDocs = 3
```

## Dashboard Compatibility

三個代表月份均完成正式 Dashboard smoke test。

全品牌歷史 Dashboard：

```text
CYJ   2026-07 → 正常
安妞  2026-06 → 正常
伊啵  2026-06 → 正常
```

舊 consumer 仍使用 legacy display semantics，未因 Batch 4 自動切換 Formal KPI。

單店 historical UI：

```text
CYJ新莊店  → 日營運走勢 / 達成進度 / 排名正常
安妞文心店 → 日營運走勢 / 達成進度 / 排名正常
伊啵園區店 → 日營運走勢 / 達成進度 / 排名正常
```

均未出現白畫面、資料不存在或已知 JS runtime failure。

## Scheduled Repair Runtime

Batch 4 Backend 部署後，`repairDirtySummaries` 新 revision：

```text
repairdirtysummaries-00024-nuc
```

成功啟動，STARTUP TCP probe 正常。

部署後觀察約 `05:14Z～07:19Z`：

```text
排程持續每 5 分鐘正常執行
目前沒有到期 dirty / pending 月份
Summary repair failure = 0（觀察期間未發現）
mismatch failure       = 0（觀察期間未發現）
ERROR / CRITICAL       = 0（觀察期間未發現）
```

部署前 `00:14Z` 曾處理 7 個安妞 recalc_queue 月份，均 `matched=true`；因時間早於 Batch 4 Backend deploy，不作為 Batch 4 新 writer 的 Production 證據。

## Target Coverage Compatibility / Pre-Batch-5 Gate

三個代表歷史月份均觀察到：

```text
monthly_targets_summary missing Target Coverage v1 metadata;
compatibility raw fallback
```

原因是部分 historical `monthly_targets_summary` 仍為 Batch 3 以前的 legacy schema，缺 `target-coverage-v1` 所需的 coverage contract metadata。

Batch 4 對這種 legacy historical month 的正確行為是：

```text
coverage authority 不可信
→ targetCoverage.available = false
→ aggregate achievement fail-closed
→ TARGET_INCOMPLETE
```

不得因 target totals 看似存在，就自行宣稱 coverage complete。

本 Batch 不修改 `functions/targetCoverage.js`，也不以 Dashboard workaround 掩蓋此 migration gap。

**Pre-Batch-5 Gate：CLOSED（2026-08-29）**

2026-08-29 已完成兩階段 Historical Target Coverage 收斂：

```text
Phase A：read-only historical audit
Phase B：metadata-only historical migration
```

Phase A `auditHistoricalTargetCoverage` 只讀：

```text
monthly_targets_summary/{YYYY-MM}
+
store_lifecycle/master
```

分類：

```text
ALREADY_V1
SUMMARY_BACKFILL_SAFE
RAW_RECONSTRUCTION_REQUIRED
LIFECYCLE_NOT_READY
PRE_SYSTEM_SKIP
```

Production Audit 結果：

```text
CYJ
  historical months         7
  SUMMARY_BACKFILL_SAFE     7
  RAW_RECONSTRUCTION        0

安妞
  historical months         7
  SUMMARY_BACKFILL_SAFE     7
  RAW_RECONSTRUCTION        0

伊啵
  historical months         7
  ALREADY_V1                4（2026-04～07）
  PRE_SYSTEM_SKIP           3（2026-01～03）
  RAW_RECONSTRUCTION        0
```

三品牌 Phase A 均觀察到：

```text
Raw Target Reads = 0
Writes           = 0
```

Phase B `migrateHistoricalTargetCoverageMetadata` 只處理 Phase A `SUMMARY_BACKFILL_SAFE` 月份。Backend 會在單一品牌 transaction 內重新讀取 Lifecycle + 指定 historical `monthly_targets_summary`，重新分類全部月份；任一月份不再安全時整批 `0 Writes`，不信任舊 Audit 結果。

Migration 只 merge Coverage metadata；禁止改寫 legacy target map / totals / counts。寫入後另做 persisted point-read verification，確認 metadata 已落盤且 legacy snapshot 未被改動。

正式 repo 驗證：

```text
Full regression  = 105 / 105 PASS
npm run build    = PASS
```

部署：

```text
migrateHistoricalTargetCoverageMetadata(us-central1) = DEPLOYED
SystemMaintenance frontend                           = Published
CURRENT_APP_VERSION                                  = 3.5.3（未提高）
```

Production 最終 post-migration Audit：

```text
CYJ   2026-01～07  ALREADY_V1 = 7 / 7
安妞  2026-01～07  ALREADY_V1 = 7 / 7
伊啵  2026-01～03  PRE_SYSTEM_SKIP = 3
伊啵  2026-04～07  ALREADY_V1 = 4 / 4

Raw reconstruction required = 0
```

因此 Pre-Batch-5 Historical Target Coverage Gate 已正式關閉；Batch 5 consumer cutover 可在後續獨立 Batch 進行。未來 consumer 仍必須對缺失／不可信 Coverage metadata fail-closed，不得因本次歷史 migration 已完成就移除 runtime guard。

## Batch 5A-1 — Historical Dashboard Formal Consumer Cutover（PRODUCTION CONFIRMED）

2026-08-29 已完成第一階段 Dashboard historical consumer cutover。此階段只切換「歷史 verified Summary」的 KPI consumer semantics；本月 live/detail flow、Backend Summary writer、Firestore Rules 與 Target Coverage migration 均未修改。

正式 consumer owner：

```text
src/utils/dashboardFormalConsumer.js
  → Historical verified Summary 的 Formal KPI / Target / Achievement / Ranking authority

src/hooks/useDashboardStats.js
  → 歷史 Dashboard scope aggregation / Summary trust integration

src/components/StorePerformanceView.jsx
  → 歷史門市績效排名使用 Formal ranking contract

tests/dashboardFormalConsumer.test.js
  → Formal cash / accrual / target / coverage / ranking / scope regression
```

Historical verified Summary 現在正式使用：

```text
現金
  → formalNetCash

權責
  → formalAccrual

Base 現金目標
  → formalCashTarget

Base 權責目標
  → formalAccrualTarget

達成率
  → Formal achievement + status

門市排名
  → formalStoreRankings
  → formalRankEligibleStoreCount
```

Coverage / validity fail-closed：

```text
Target Coverage incomplete
→ TARGET_INCOMPLETE / N/A
→ 不縮小 denominator

FIELD_MISSING / DATA_INVALID
→ 不得以 Number(x || 0) 偽裝為合法 0
```

品牌 semantics 仍由 Summary contract 決定，Frontend 不自行重建：

```text
CYJ
formalNetCash = gross cash - general refund - skincare refund

安妞
formalAccrual = operationalAccrual

伊啵
formalAccrual = accrual
```

`challengeCashTarget` / `challengeAccrualTarget` 本階段仍屬 compatibility layer；尚未新增 `formalChallenge*` persisted contract，因此 Dashboard 不得把 challenge compatibility 欄位宣稱為 Formal authority。

### Production validation

正式 repo：

```text
HEAD / origin/main = b4f907777d60d4b7e594b83e37e1c5218bf076b1
Full regression    = 115 / 115 PASS
npm run build      = PASS
Frontend           = Published
CURRENT_APP_VERSION = 3.5.3（未提高）
```

代表性 Production 驗證：

```text
CYJ 2026-07
  formalNetCash = 38,386,697
  Dashboard historical 現金 = 38,386,697
  legacy cash 38,405,467 不再作 Historical Formal display authority

安妞 2026-06
  formalAccrual = 30,436,598
  Dashboard historical 權責 = 30,436,598
```

使用者已完成並確認正常：

```text
CYJ historical Formal KPI
安妞 historical Formal KPI
伊啵 historical KPI
區長篩選
單店篩選
Store Performance 排名
2026-08 本月 live/detail regression
```

因此 Batch 5A-1 狀態：

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED
```

### Batch 5A-2 Historical Reads Cutover — Production Confirmed

Batch 5A-2 已於 2026-08-29 完成 verified historical Store Dashboard 的 reads cutover。此階段只改 Frontend read policy / listener topology，不改 Batch 5A-1 已確認的 Formal KPI semantics。

正式 Runtime source scope：

```text
src/App.jsx
src/hooks/useDashboardStats.js
src/utils/dashboardReadPolicy.js
tests/dashboardHistoricalReads.test.js
```

正常 verified historical Store Dashboard 現在採：

```text
dashboard_summary / monthly_targets_summary / summary_recalc_flags 等 small-scoped Summary authority
→ 不再正常載入整月 daily_reports
→ 不做 raw monthly_targets fallback
→ 不依賴 recalc_queue 大型 resident query
→ 不依賴 maintenance_logs resident query
→ 不在 hook 重複掛載已由 App 提供的 Summary / ranking / recalc trust listeners
```

read policy 明確區分：

```text
CURRENT_LIVE
LOADING
SUMMARY_TRUSTED
DETAIL_FALLBACK
DIRTY_REFRESH
```

安全邊界：

```text
Summary loading
→ 先等 trust state，不搶先讀 Raw

verified historical
→ Summary-first / raw reads 0

dirty / missing / unverified
→ 保留一次 detail fallback，優先正確性

current month
→ 維持既有 live/detail flow
```

另外以 `brandId + yearMonth` 雙重 anchoring 防止切品牌／月份時短暫沿用上一個 Summary trust state。歷史人員績效仍保留既有 therapist detail fallback；門市歷史 reads cutover 不冒充為 therapist flow 已同步完成。

Validation：

```text
127 / 127 tests PASS
npm run build PASS
Frontend Published
CURRENT_APP_VERSION = 3.5.3
```

Production regression：

```text
CYJ historical Dashboard      PASS
安妞 historical Dashboard     PASS
伊啵 historical Dashboard     PASS
manager filter                PASS
single-store filter           PASS
Store Performance             PASS
2026-08 current-month         PASS
```

Production read tracker 在正常 verified historical 操作中未觀察到：

```text
historical daily_reports
raw monthly_targets fallback
recalc_queue large query
maintenance_logs query
```

此結果只代表上述高成本來源沒有被觸發；不宣稱整個 Dashboard 只有 1 次 Firestore read，必要的 Summary / config single-document reads 仍可能存在。

Batch 5A-2 狀態：

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED
```


### Batch 5B-1 Regional + Ranking Formal Consumer Cutover — Production Confirmed

Batch 5B-1 已於 2026-08-29 完成 `RegionalView` 與 `RankingView` 的 historical Formal consumer cutover。此階段延續 Batch 5A 的 Formal KPI / verified Summary authority，不修改 Backend writer、Firestore Rules 或 current-month live/detail contract。

正式 Runtime source scope：

```text
src/App.jsx
src/components/RegionalView.jsx
src/components/RankingView.jsx
src/utils/reportFormalConsumer.js
tests/reportFormalConsumer.test.js
```

Historical verified Regional 現在以 Lifecycle eligible store rows 與 persisted Formal fields 作為 authority：

```text
formalNetCash
formalAccrual
formalCashTarget / formalCashAchievement
formalAccrualTarget / formalAccrualAchievement
Target Coverage v1
Lifecycle eligibility
```

若 selected regional scope 的 target coverage 不完整，achievement 必須 fail-closed 為 `N/A` / incomplete semantics；不得只加總有 target 的店而縮小 denominator。

Historical verified Ranking 現在以：

```text
formalStoreRankings
formalRankEligibleStoreCount
```

作為排名 authority，並合併 store-level Formal KPI / target / achievement semantics。Lifecycle 非 eligible store 不應進 Formal ranking denominator；missing / invalid 不得再被壓成合法 `0`。既有明確 ranking exclusion 設定仍屬 presentation / operational filtering，不改 Backend persisted Formal ranking contract。

Batch 5A-2 的 historical reads policy 同步延伸到 Ranking / Regional：

```text
verified historical
→ Summary-first
→ 不正常載入整月 daily_reports

missing / dirty / unverified / Formal contract incompatible
→ fail-closed
→ 允許 detail fallback

current month
→ 維持既有 live/detail flow
```

沒有新增 Firestore listener、query、polling、Functions deploy 或 Rules deploy；品牌 Firestore path / isolation 維持既有 resolver。

Validation：

```text
140 / 140 tests PASS
npm run build PASS
Frontend Published
CURRENT_APP_VERSION = 3.5.3（未提高）
```

Production regression：

```text
CYJ historical Ranking / Regional     PASS
安妞 historical Ranking / Regional    PASS
伊啵 historical Ranking / Regional    PASS
區域／月份切換                        PASS
current-month regression              PASS
```

Production read tracker 未觀察到 historical `daily_reports` 大量讀取、raw `monthly_targets`、`recalc_queue` large query 或 `maintenance_logs` large query 回歸。當次 tracker 可見 `read_tracker_config` 2 docs、`system_stats_today` 1 doc；此結果只證明高成本 historical Raw / large-query sources 未被觸發，不代表整頁僅有 3 個 Firestore reads。

正式 Runtime / main：

```text
HEAD = origin/main
5d3d370a9d4cb045f718020ddd390050a3d0b9aa
```

Batch 5B-1 狀態：

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED
```

### Batch 5B-2A Annual Formal Semantics — Production Confirmed

Batch 5B-2A 已於 2026-08-29 完成 Annual historical Formal semantics cutover，並在 Production 驗證中修正「排除店家儲存後 AppContext state 未立即同步」的既有 scope bug。最終正式 main：

```text
HEAD = origin/main
d0a231ca5a816b2a5ef42e2b6e38690dfc1656df
```

正式 Runtime source scope：

```text
src/App.jsx
src/components/AnnualView.jsx
src/utils/annualFormalConsumer.js
tests/annualFormalConsumer.test.js
```

Historical trusted month 必須同時符合：

```text
dashboard-summary-v2
summary-semantics-v1
kpi-contract-v1
exact brandId / yearMonth
summary_recalc_flags = verified/completed
dirty = false
mismatch = 0
pending = 0
```

符合後 Annual 使用 persisted Formal authority：

```text
formalNetCash
formalAccrual
Formal Target Coverage v1
Lifecycle eligibility
```

Coverage 不完整時 achievement fail-closed 為 `N/A` / incomplete semantics；不得只加總有 target 的店後縮小 denominator。Trusted historical month 不再用 raw `monthly_targets` 補 target。Current month / compatibility fallback 本階段維持既有 contract。

伊啵 2026 年度遵守 data start boundary：

```text
2026-01 ~ 2026-03 -> PRE_SYSTEM_SKIP
2026-04 起 -> 正式年度計算範圍
```

Annual audit exclusion scope 現在同時作用於實績與目標；若全品牌存在排除店家，不得直接使用未扣除排除店的 `grandTotal`。Production 發現的 exclusion state bug 已修正為：

```text
setDoc(audit_exclusions) success
→ 同 brand race guard
→ setAuditExclusions(nextExclusions)
→ Annual 立即重新計算實績 / 現金目標 / 權責目標
```

寫入失敗時不得顯示假成功，也不得關閉設定視窗。此修正沒有新增 Firestore read、listener、query 或 polling；品牌 path 仍使用既有 resolver。

Validation / Production：

```text
Initial Batch 5B-2A regression   156 / 156 PASS
Exclusion fix regression          158 / 158 PASS
npm run build                     PASS
Frontend Published                PASS
Annual Formal semantics           PASS
Exclusion save immediate recalc   PASS
Exclusion remove immediate restore PASS
Brand switch isolation            PASS
CURRENT_APP_VERSION               3.5.3（未提高）
```

Batch 5B-2A 狀態：

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED
```

Batch 5B-2B Annual Reads Cutover 尚未開始。它只處理 Annual reads topology（year-scoped Summary / flags、current-month fallback scope、移除未使用 annual listeners 等），不得重新改寫本節已 Production Confirmed 的 Annual Formal semantics。

## Observation

安妞 `2026-06` Dashboard Header 的 Summary badge 曾顯示較舊 timestamp，但：

```text
Firestore persisted Summary 已為本次新 rebuild
Dashboard legacy totals 正確
persisted compare mismatchCount = 0
```

因此目前記為非阻斷 Observation；Batch 4 不以單頁 UI workaround 處理。若後續持續出現或影響資料判讀，應以當時最新正式 Dashboard source 重新追查 timestamp metadata owner。

## Final Status

Batch 4 可正式標記：

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED
```

三品牌代表驗證：

```text
CYJ   2026-07  PASS
安妞  2026-06  PASS
伊啵  2026-06  PASS
```

`CURRENT_APP_VERSION`：

```text
3.5.3
```

未提高。


# 14. 本文件更新原則

只有目前正式 source、使用者明確確認、或部署後 runtime 驗證可以支持「已部署／已正式啟用」。

無法確認時一律寫：

```text
未由目前正式來源確認
```

# 15. Batch 5E-1A / 5E-1A.1 — Legacy Zero Placeholder Cleanup + Target Summary Map Replacement（PRODUCTION CONFIRMED）

2026-08-31 完成 Zero Target Canonical Contract 的前置資料清理與 Target Summary writer 修正。

本次 closeout 的正式 runtime source（docs-only closeout 前）：

```text
Official repo      = ~/cyj-new
branch             = main
HEAD               = fb7299c1c3cd6aadb97024d5d0dff8a0daf98e38
origin/main        = fb7299c1c3cd6aadb97024d5d0dff8a0daf98e38
worktree           = clean
CURRENT_APP_VERSION = 3.5.3（未提高）
```

## Production inventory / business classification

Batch 5E-0 / 5E-0.5 對三品牌 Production target 做 read-only audit：

```text
CYJ    explicit numeric-zero target docs = 0
安妞   explicit numeric-zero target docs = 0
伊啵   explicit numeric-zero target docs = 27
```

使用者確認伊啵這 27 筆不是「管理者有意設定 0 元目標」，而是歷史初始化／開店時間／系統起始時間／未來月份尚未設定目標所留下的 legacy placeholder zero。

因此：

```text
legacy placeholder zero
!= intentional configured zero
```

這 27 筆不可作為 `0 = VALID_ZERO` 的 Production business evidence。

## Batch 5E-1A Raw normalization

正式 migration 僅允許伊啵已稽核的 exact 27 docs，使用 Firebase request auth + Trusted Device + 最高管理者 credential re-verification + fixed manifest + Lifecycle revision + document-shape precondition。

Production execute 已完成：

```text
Raw monthly_targets placeholder docs
27 → 0

remaining explicit-zero Raw docs
0

跨品牌 Raw mutation
0
```

## Batch 5E-1A.1 root cause

第一次 Raw delete 後，11 個 `monthly_targets_summary` 仍殘留 stale `targets.<store>` rows。

正式 root cause：

```text
in-memory targetMap
delete targetMap[store]

transaction.set(
  summaryRef,
  { targets: targetMap, ... },
  { merge: true }
)

→ Firestore nested-map merge 保留被省略的 targets.<store> key
```

因此 metadata / counts 可以由新的 in-memory map 重算正確，但 persisted `targets` container 仍可能殘留已刪 row。

正式上游修正位於：

```text
functions/targetCoverage.js
```

現在 canonical monthly-target event writer：

```text
transaction read current Summary
→ build complete replacement document
→ preserve unrelated top-level Summary fields
→ replace full top-level targets map
→ transaction.set(..., { merge: false })
```

Transaction read 保留 multi-writer race protection；若 concurrent Summary mutation 發生，Firestore transaction 會 retry 並以 fresh Summary 重建 replacement。

此修正同時適用：

```text
CYJ legacy monthly target trigger
安妞 / 伊啵 standard-brand monthly target trigger
```

品牌 Firestore path 不變。

## 11-month targeted Derived repair

既有 secured temporary endpoint：

```text
normalizeLegacyZeroTargetPlaceholders
```

在確認 27 個 exact Raw manifest docs 全部仍不存在後，進入：

```text
executionPhase = derived_summary_repair
```

只 repair 伊啵：

```text
2026-01
2026-02
2026-03
2026-04
2026-05
2026-06
2026-07
2026-09
2026-10
2026-11
2026-12
```

Production execute：

```text
committed            = true
Raw deletes          = 0
direct Summary writes = 11
repairedMonths       = 11
```

Production verify：

```text
verified = true
remainingExplicitZeroDocIds = []

11 / 11 monthResults.ok = true
11 / 11 errors = []
11 / 11 lingeringStores = []
11 / 11 stale container matchingRows = []

targetAuditIssueCount = 0
targetAuditZeroBaseTargets = []
```

2026-09～12 的正式 business state 仍保持：

```text
eligibleStoreCount          = 5
cashConfiguredStoreCount    = 1
accrualConfiguredStoreCount = 1

cashCoverageComplete        = false
accrualCoverageComplete     = false

missing:
- 伊啵中山店
- 伊啵天母店
- 伊啵新莊店
- 伊啵站前店
```

因此 cleanup 沒有把「尚未設定」誤變成 `$0 已設定`。

## Runtime cost / topology

正常 Target event 沒有新增 listener、polling 或 Raw full scan：

```text
monthly_targets one event
→ monthly_targets_summary/{yearMonth} point read
→ store_lifecycle/master point read
→ one monthly_targets_summary write
```

5E-1A.1 repair 是一次性 bounded repair：

```text
exact Raw manifest point reads = 27
Lifecycle point read           = 1
Summary point reads            = 11
Security point reads           ≈ 3
direct Summary writes          = 11
Raw writes                     = 0
```

沒有讀 `daily_reports` / `therapist_daily_reports`，也沒有 Dashboard Summary rebuild。

## Status

```text
5E-0 Production Zero Inventory         PRODUCTION CONFIRMED
5E-0.5 Placeholder/Lifecycle Audit     PRODUCTION CONFIRMED
5E-1A Raw Placeholder Normalization    PRODUCTION CONFIRMED
5E-1A.1 Summary Map Writer Fix         PRODUCTION CONFIRMED
5E-1A.1 11-month Derived Repair        PRODUCTION CONFIRMED
```

Temporary endpoint `normalizeLegacyZeroTargetPlaceholders` 已完成本次 Production 任務；它不是一般營運工具。後續 Batch 應評估退場／移除，不應讓一次性 mutation endpoint 永久成為常態操作入口。

## 5E-1B boundary

本 closeout **沒有**修改 canonical Zero Target business contract。

截至本段 closeout：

```text
現行 runtime contract：
blank / missing / base target numeric 0
→ TARGET_NOT_SET

下一批 5E-1B 才處理：
explicit user-entered 0
→ VALID_ZERO / configured

actual ÷ target 0
→ N/A

zero-target row
→ achievement ranking 不 eligible
→ progress-gap neutral / N/A
```

因此不得把「legacy placeholder 已清完」描述成「0 元正式目標已經支援」。

`newASP=0` 仍維持未設定／非法 business setting；Challenge Target `0` 仍維持未設定。

# Batch 5E-1B Zero Target Canonical Contract — Staging Validated / Pending Promotion

2026-09-01 已完成獨立 Final Contract Audit V3。

```text
FULL 5E-1B VALIDATED: YES — staging
5E-1B.1 VALIDATED: YES
5E-1B.2A VALIDATED: YES
5E-1B.2B VALIDATED: YES
5E-1B.3 VALIDATED: YES

OFFICIAL ~/cyj-new MODIFIED: NO
DEPLOYED: NO
PRODUCTION CONFIRMED: NO
CURRENT_APP_VERSION: 3.5.3
KPI_CONTRACT_VERSION: kpi-contract-v1
SUMMARY_SEMANTIC_VERSION: summary-semantics-v1
```

Validated cumulative runtime artifact：

```text
DRCYJ_BATCH5E1B_CUMULATIVE_1B3_V2_a047cb6.patch
SHA256 = 7d285ea4b24b4f8e7058d59cb0199ec6c4f1aa6139062991d2e1841fa2e3e765
```

正式 Target Contract：

```text
base target 0                  => VALID_ZERO / configured
base target positive           => VALID / configured
base target blank/null/missing => TARGET_NOT_SET
base target negative/malformed => DATA_INVALID

achievement denominator = 0    => N_A
challenge blank / 0            => CHALLENGE_NOT_SET
newASP = 0                     => invalid / unset（positive-only）
```

zero-target store：

```text
achievement ranking eligible = false
progress-gap attention eligible = false
```

Identity authority：

```text
canonical source > legacy alias
canonical explicit 0 cannot be replaced by legacy positive

canonical-equivalent authoritative semantic disagreement
=> AUTHORITY_CONFLICT
=> target denominator unavailable
=> Coverage incomplete
=> no updatedAt / score / document-id winner
=> conflict remains terminal across fallback
```

Validation evidence：

```text
Independent Final Audit V3     PASS
Full repository tests          345 / 345 PASS
Production build               PASS
Target Coverage conflict       PASS
FE/BE authority parity         PASS
Telegram sticky conflict       PASS
git diff --check               PASS
```

Read / path impact：

```text
new listener         0
new query primitive  0
new read primitive   0
new polling          0
Firestore Rules      unchanged
Firestore paths      unchanged
brand topology       unchanged
```

此節只記錄 staging validated truth；official promotion、部署及 Production readback 完成前，
不得寫成 `DEPLOYED` 或 `PRODUCTION CONFIRMED`。
