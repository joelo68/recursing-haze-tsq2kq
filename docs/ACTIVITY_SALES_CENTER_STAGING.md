# ACTIVITY_SALES_CENTER_STAGING.md

> 目的：確保 Phase 1～3 全程不碰正式營運環境。
> 本文件屬 feature branch 開發文件，不代表 Production 已改變。

# 1. Source baseline

Phase 0 Source Gate：
- main / origin-main：36ee6eff1a198fc7b4d9ab33eee9068c3a882dcd
- CURRENT_APP_VERSION：3.6.2
- worktree：clean

開發分支：
feature/activity-sales-center

開發 worktree：
~/cyj-new-activity-sales-center

# 2. Firebase 隔離

Activity Sales 本機環境固定使用：
demo-drcyj-activity-sales

只允許：
- Auth Emulator：127.0.0.1:9199
- Firestore Emulator：127.0.0.1:8180
- Functions Emulator：127.0.0.1:5501
- Emulator UI：127.0.0.1:4400

只要 VITE_ACTIVITY_SALES_DEV=true：
- Firebase config 改用 demo project。
- Auth / Firestore 直接接 Emulator。
- `runtimeEnvironment.js` 安裝 dev-only network guard。
- App.jsx 原本的正式 Function endpoint 常數完全保留，不改 production source contract。
- fetch 真正送出前，已登錄 Production Function URL 才會被改寫到本機 Functions Emulator。
- 若開發模式碰到未登錄的 Production Cloud Function / Cloud Run endpoint，直接阻擋，而不是偷偷打正式環境。
- project id 非 demo-* 時直接拋錯。

此設計刻意保留既有 App endpoint source shape，避免 staging infrastructure 改壞現行 Security / Authority regression contracts。

# 3. Production 不允許事項

Phase 1～3：
- 不 deploy gh-pages。
- 不 firebase deploy。
- 不改 Production Rules。
- 不寫 Production Firestore。
- 不把測試資料寫進正式三品牌。
- 不提高 Production CURRENT_APP_VERSION。
- 不 merge main。

# 4. Reads 原則

本機 Emulator reads 不計入 Production。
正式設計仍遵守：
Summary-first / event-driven / small scoped query / conditional loading。

活動中心 Phase 1 預計：
- 活動列表以「目前品牌 + 有效期間」小範圍讀取。
- 活動詳情按需讀取。
- 不在 App 全域建立大型常駐 listener。
- 管理端編輯用 Backend authority + OCC / transaction。

Phase 2 / Phase 3 的正式 reads 預算會在各 Phase 開工前再鎖定。

# 5. Security 原則

Activity Sales 將採 Backend authority 作為敏感 writer：
- 發布 / 審核
- 版本切換
- 特殊成交核准
- 取消 / 退款 / 更正
- 目標設定（依權限）

Frontend 顯示權限不等於 Backend 授權。
多人同時審核 / 修改必須有 revision OCC 或 transaction。

# 6. Staging 層級

目前 Phase 0B 建立的是「完全本機、demo project、Emulator」環境。

當 Phase 1 核心流程完成後，再建立第二層 remote Staging Firebase project。
該 project 必須與 cyjsituation-analysis 完全不同，且需要明確 project id 後才會設定。
在使用者提供 / 建立 remote Staging project 前，不會猜 project id，也不會拿 Production 代替。

# Phase 1A 隔離
`manageActivitySalesPolicy` 與 `manageActivityCampaign` 只加入 feature branch。
本機 Activity Sales dev mode 已將兩個 endpoint 納入 localhost Functions Emulator route guard。
本階段不部署正式 Functions / Rules。
- Phase 1A 尚未啟用自動排程 publisher；`scheduled_after_approval` 只允許到時後由正式 publisher 動作放行，絕不提前發布。
- Activity Sales Rules 另以 demo project Emulator regression 驗證同品牌唯讀、Browser write deny、跨品牌 deny。


# Phase 1B 第一線唯讀投影（isolated feature）
- Backend 每次成功 `published`，在同一 Firestore transaction 寫入 `activity_sales_publications/{campaignId}`；stop 時同 transaction 移除，預防狀態與展示分離。
- Private collections（policy/campaigns/versions/approvals/audit） Browser read/write 一律 deny；第一線只讀已發布白名單投影。
- 展示資料明確不含審核者清單、建立者登入身分、審核歷程、未發布草稿或權限設定。
- 發布詳情一次讀出套組/售價/拆帳/FAQ；前端列表只做有限範圍 `endDate >= today` 單次查詢，不開常駐 listener。
- 本批第一線 UI 僅 `VITE_ACTIVITY_SALES_DEV=true` 顯示，沒有理解確認 / 日報成交 / 正式管理操作。
- 不 deploy Production，CURRENT_APP_VERSION 維持 3.6.2。

# Phase 1C-1 活動管理工作台（本機 DEV 隔離）
- 新增 `getActivitySalesWorkspace` Backend read-only entry；任何讀取皆要求 Application Identity brand/account 一致、Trusted Device 與最新帳號密碼重新驗證。沒有權限時拒絕回傳私人草稿。
- `capabilities` 最多讀同品牌 `activity_sales_policy/current` 1 筆，回傳本人可建立／直發／發布的布林權限與授權建立者可用的 group id/label；**不回傳群組成員、policy 全量或 credential**。
- `get_campaign` 僅接受完整活動 ID；唯讀 transaction 中同品牌 policy 1 筆、campaign 1 筆、`pending_approval` 時 approval 1 筆；無跨品牌 query、無常駐 listener、無 polling。後端繼續實施 creator/publisher 權限與「送審時核准快照」的審核者可見性。
- 管理工作台 `ActivitySalesManagementView.jsx` 僅透過 `VITE_ACTIVITY_SALES_DEV=true` 之既有本機入口顯示，提供 8 段式草稿編輯、價格／歸屬檢查、依 ID 查詢、送審、核准、退回、手動發布、停止與取消；Backend `manageActivityCampaign` 仍為寫入 authority，revision OCC 不變。
- 私有 `activity_campaigns`、`activity_campaign_approvals`、`activity_sales_policy` 等 Firestore Rules 仍禁止 Browser 直接讀寫；新增讀取 gateway 不新增 Firestore listener/query/index，且不改既有正式業績。
- **尚未實作：**後台清單／待核准 inbox、最高管理者 policy 設定 UI、排程自動 publisher、已發布內容重大異動重送審、第一線理解確認、Phase 2 日報成交歸屬／目標、Phase 3 分析；不以本子批次宣稱 Phase 1 全部完成。
- 不部署 Production；不提高 `CURRENT_APP_VERSION`，僅於隔離 feature branch 開發驗證。

# Phase 1C-2 — 待核准 Inbox 與最高管理者 Policy UI（feature only）
- `getActivitySalesWorkspace` 新增 `approval_inbox`：以已驗證品牌與身分產生 reviewer key，僅查本品牌 `activity_campaign_approvals` `activeReviewerKeys array-contains`，一次最多 20 筆，按鈕觸發單次查詢，無 listener / polling / 跨品牌 collection-group query。
- 審核人員索引在送審、部分核准、移交下一關、完成或退回的**原 transaction** 更新，避免 Inbox 沿用舊關卡；已表態的核准人員不再列入同關可操作名單。只有 Phase 1C-2 新寫入／流轉的 approval 包含 `activeReviewerKeys`；既有舊測試資料若缺欄位，不會自動被 Inbox 找到。本批不做 Production migration / backfill。
- Inbox 回傳只含 activity id、正式版本 id、標題、審核關卡、提交時間等最小內容；後端再驗證 approval 狀態、目前關卡與 actor，不能用前端傳入 reviewer key 偽造其他管理者。
- `get_policy` 僅最高管理者可讀完整品牌 Policy；其他登入帳號只能取得 Phase 1C-1 最小 capabilities。Policy 編輯透過既有 `manageActivitySalesPolicy`、`expectedRevision` OCC 更新；不開放 Browser 直接讀／寫 Policy。
- 前端僅本機 Activity Sales DEV 模式顯示，且切換品牌時清空私人草稿及待辦；所有請求沿用 Application Identity、Trusted Device 與新鮮憑證驗證。
- **未納入**排程 auto-publisher、第一線理解確認、日報歸屬、目標及 AI 功能；Production `main`、正式資料及 `CURRENT_APP_VERSION=3.6.2` 不變。
