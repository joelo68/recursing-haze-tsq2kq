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

# Phase 1C-3 — Event-driven 排程與正式版本理解確認（feature only）
- `cyjCampaignScheduleTrigger` 與 `brandCampaignScheduleTrigger` 僅對活動文件的 `approved` 排程轉換建立**單活動 Cloud Tasks**，不開三品牌定時掃描、不加前端 listener/polling；`activitySalesScheduledPublish` 以 current campaign + immutable version transaction 做狀態與版本比對，再原子寫入 `activity_sales_publications`、campaign revision、audit。
- Cloud Tasks 單次最多 30 日，本階段每次最多排到 25 日，較長排程以同一活動的下一個延遲任務接續；多次觸發／重試以已發布或已取消狀態拒絕重複寫入。排程日期採固定 `Asia/Taipei`，UI 的無時區時間會先轉成帶時區的 UTC ISO。
- 排程工作不得繞過正式活動版本：當前品牌／活動 ID／版本／releaseMode／scheduledPublishAt 必須匹配；取消、停止、不同版本或過期時不建立新展示資料。人工 `publish` 的既有安全驗證仍維持。
- `acknowledgeActivitySalesPublication` 用 Firebase Application Identity + Trusted Device + fresh credential 驗證；單次讀同品牌正式展示 1 doc + 使用者/版本確認 1 doc，確認時僅 `create` 一筆不可覆寫的 `activity_sales_acknowledgements`。新版必須重新確認；Browser Rules 封閉該 collection。
- 第一線理解確認由使用者主動操作，沒有背景同步／全品牌掃描。理解確認不屬於活動成交、也不影響 `daily_reports` 正式營收。
- 本機 `demo-drcyj-activity-sales` Emulator 必須由 CLI 設置 `CLOUD_TASKS_EMULATOR_HOST` 才允許佇列請求；若缺少則 fail-closed，**不得**發送到真實 Cloud Tasks。Cloud Tasks Emulator 與實際環境的派送重試語意不完全相同，未做 remote Staging/UAT 前不得宣稱 Production readiness。
- Cloud Tasks 正式 Staging/Production 的 IAM、重試、queue 建立及監控必須在 Release Gate 另行審核；本批不部署任何遠端環境，不更動 `CURRENT_APP_VERSION=3.6.2`。
- Functions + Cloud Tasks 的隔離端對端測試為 `tests/activitySalesScheduledFunctionsEmulator.test.mjs`，只允許在三項 Emulator 與 `demo-drcyj-activity-sales` 下執行；會在 Emulator 內寫入三個測試活動並確認三品牌都由排程發布。它不代表遠端 Staging 或正式環境已測試。

# Phase 1C-4 — 已發布重大異動重新送審（feature branch only）
- 正式活動 `status=published`、`currentVersionId` 與 `activity_sales_publications/{campaignId}` 在修訂送審期間保持不變；修訂存於同一私人 campaign 的 `amendment`（`draft / pending_approval / returned / approved`），不得直接修改公開投影。
- `begin_amendment` 從當前不可變版本快照複製草稿；`update_amendment` 僅可編輯私人修訂；`submit_amendment` 必須具體指定審核人員，**即使可免審核直發，也禁止重大修訂 mode=none**。每次送審以新 versionId `vNNN` 建立 immutable version，包含 `baseVersionId`。
- `approve / return_for_changes` 依當前修訂 versionId 的 immutable reviewer snapshot 處理；`all` quorum / Inbox key / OCC 仍在同一 Firestore transaction 更新。核准完成後：immediate 在同一交易換版；manual 等授權 publisher 呼叫 `publish_amendment`；scheduled 沿用 **單活動 Cloud Task** 在到時再檢查 immutable version 與當前 base projection，才原子換版。
- `discard_amendment`、緊急 `stop` 會原子清理未完成修訂與其待核准索引；排程過期／改版／停止後的舊任務因版本與狀態核對而跳過。舊版本理解確認紀錄保留為歷史但不能替新 versionId 確認。
- Backend `getActivitySalesWorkspace` 僅在修訂待審時讀取該版本一筆 approval；Browser Rules 不加新讀寫權限。沒有大型 query、polling、listener 或額外 collection/index。
- 此子批次不碰 Phase 2 正式日報營收／歸屬，亦不開 Phase 3 分析；Production `main`、Firestore、Functions、Hosting 與 `CURRENT_APP_VERSION=3.6.2` 均不變。

# Phase 2A-0 — 日報活動歸屬契約（feature-only；尚未接入 Writer）

- 基線 `feature/activity-sales-center @ a9e3876758c96f09240dbcb564e9e0b655859082`，正式 `main @ 36ee6eff1a198fc7b4d9ab33eee9068c3a882dcd`，`CURRENT_APP_VERSION=3.6.2`。
- 新增 **純函式** `functions/activitySalesAttributionContract.js`（不接 endpoint、不讀寫 Firestore、不修改正式 `daily_reports` / `therapist_daily_reports`）。新測試 `tests/activitySalesAttributionContract.test.js`。
- 三狀態不可混同：`UNCONFIRMED`（沒有確認紀錄，金額/筆數為 null）、`CONFIRMED_ZERO`（明確確認無成交，金額/筆數=0）、`HAS_SALES`（至少一筆成交明細）。若資料狀態互相矛盾，fail closed，不默默轉 0。
- `attributedAmount` 表示 **原已列入業績的活動歸屬**；所有合約輸出的 `formalRevenueDelta` 固定為 **0**，正式總業績不得把歸屬額再次加總。
- 歷史成交必須保留成交當時 `campaignId + versionId`，只對同品牌 immutable version 綁定，不能用改版後 current publication 回填舊成交； opaque event ID 包含品牌、日、角色、帳號、活動、版本、成交 ID。
- `reportDate` 是校驗過的 `YYYY-MM-DD`；日報日期回報時間／補登安全規則仍由已存在日報合約處理，Phase 2 writer 必須沿用並獨立後端驗證。
- **尚未實作**：授權寫入端、日報介面、店經理覆核、特殊成交、更正/退款/取消、活動目標、分析、Firestore collections/index/rules；本批不宣稱 Phase 2 完成。
- 下一個 write gate 必須先驗證最新 `therapist` 憑證主資料所屬門市與 `store` 帳號 `stores` 名單、`daily_reports` / `therapist_daily_reports` 真正資料 ID，並考慮因既有日報 `setDoc` 覆寫造成的競爭條件。不得信任 Browser 傳入門市；不得讓活動歸屬污染正式 Summary／Ranking。
- Reads/Writes budget：本批新增 Firebase Reads = 0，Writes = 0，Functions invocation = 0；沒有 listener、polling、index 或部署。

# Phase 2A-1 — Event attribution Backend writer（feature only）
- `writeActivitySalesAttribution` 是隔離後端入口（尚未接 UI），僅開通 `record_sale` 與 `confirm_zero`；退款、特殊成交、修改、刪除、零轉有成交、店經理覆核尚未開通。
- 必須有已提交且符合品牌／本人／門市／日期的正式日報；使用 `Firebase Application Identity + Trusted Device + fresh credential`；門市來源以 therapist master `store` 或 store credential `stores` 驗證，絕不單憑 Browser 店名。
- Firestore transaction 先讀本人的店／個人日報、正式活動 publication、該活動不可變 version、當日活動歸屬摘要及指定成交 ID；新增成交使用 immutable `create`，摘要 revision OCC，重複同 ID 同內容只回 idempotent，不重複計算。`CONFIRMED_ZERO` 與未回報不同；若已確認 0，後續成交須等更正工作流另行開發。
- `activity_sales_daily_attributions`、`activity_sales_attribution_sales`、`activity_sales_attribution_audit` 都屬**全 Browser read/write DENY** 的私人 Backend collection；三品牌各自 namespace；不得透過 generic fallback 越權。
- 本批不修改 `daily_reports`、`therapist_daily_reports`、Summary、Ranking、正式營收、任一既有 Firestore listener；不新增輪詢或跨品牌查詢。
- 單次寫入核心 transaction：store 4–5 docs read，therapist 5–7 docs read；另有 Trusted Device/credential 讀取，首次成交 3 docs writes，零成交 2 docs writes；此為程式路徑估算，非實際計費量。
- Local Emulator 測試與 Mac 完整回歸 PASS 前，不得 commit/push；Phase 1～3 仍不得部署正式環境。`CURRENT_APP_VERSION=3.6.2` 不變。


# Phase 2A-2 — 日報活動歸屬唯讀面板（isolated feature）
- 基線 `feature/activity-sales-center @ e4a8f3c75faa3641df2e2bb7625a099d77a08874`，Production `main @ 36ee6eff1a198fc7b4d9ab33eee9068c3a882dcd`，`CURRENT_APP_VERSION=3.6.2` 不變。
- `InputView` 僅在 `VITE_ACTIVITY_SALES_DEV=true` 且 `store` / `therapist` 權限下顯示唯讀面板；由使用者點擊才用現有公開 `activity_sales_publications` small scoped query（單次最多 30 檔）載入目前正式活動，再選一個 `campaignId+versionId` 手動要求後端讀回。
- `getActivitySalesAttributionStatus` 是獨立 Backend HTTP POST；必須 Firebase Application Identity claims、同品牌/帳號/角色、Trusted Device、fresh credential，並由 `store_account_data.stores` 或 `therapists` master 驗證門市／存在正式日報。僅以 `summaryDocumentId(brand,role,account,date,campaign,version)` 從私人 `activity_sales_daily_attributions` 讀**一筆**。原 Browser deny Rules 保留；不新增 query index、listener、polling 或后台掃描。
- Status 契約：不存在摘要才 `UNCONFIRMED`（`saleCount` / `attributedAmount` = null）；`CONFIRMED_ZERO` = 0/0；`HAS_SALES` = 正整數。資料衝突、未有正式日報、改版後 current version 不一致均 fail closed；不得默默變 0。
- 本面板**只檢索目前正式版本**；不稱其為完整歷史活動版本列表。舊版成交須另有明確版本查詢工作流，不能誤讀目前新版無紀錄為歷史零成交。
- 不修改/重算 `daily_reports`、`therapist_daily_reports`、Summary/Ranking、formal revenue；僅顯示歸屬，`formalRevenueDelta=0`。不提供 Browser Activity Sale writer、新增成交、更正、退款、零轉成交或主管覆核按鈕。
- 估計每次手動查詢：公開正式活動列表最多讀取 30 documents（限量 query），個別歸屬查詢 store 4 docs / therapist 5 docs transaction reads，另計 Identity/Trusted Device credential reads；無 listener/polling。需以 Emulator/部署後 Firebase Usage 確認實際費用，不把估值寫成實際 reads。
- 只有 Mac 全 CI、build、Rules/Firestore emulator 通過後才能 commit/push 隔離 feature；Phase 1～3 不得正式 Deploy。


# Phase 2A-3 — 日報活動成交填報入口（isolated feature）
- 基線：`feature/activity-sales-center @ 90ad85dedf039ec64ede1e00e71a88e62d93f196`，Production `main @ 36ee6eff1a198fc7b4d9ab33eee9068c3a882dcd`，`CURRENT_APP_VERSION=3.6.2` 保持不變。
- 沿用 Phase 2A-2 的 `ActivitySalesAttributionStatusPanel`：僅 `VITE_ACTIVITY_SALES_DEV=true`、已驗證 store／therapist 才會在 `InputView` 看見。本次新增 `ActivitySalesAttributionEntryForm`；先由使用者查當日目前正式活動、本人歸屬狀態及 revision，再選套組與數量，或在無歸屬時明確勾選 0 成交。沒有日報必須由 Backend 409 拒絕，**不會代替正式日報提交**。
- 入口僅透過既有 `writeActivitySalesAttribution` HTTP Backend POST，攜帶 Firebase token、Trusted Device ID、目前帳號密碼、brand/role/account、原活動 versionId、報表日期和 `expectedRevision`。套組售價與金額取自當前 publication，Backend 仍以 immutable version 的正式價格與本人日報作為唯一 authority。使用者輸入可核對且不含個資的交易識別碼（英數字、-、_）；同一交易跨頁重填必須使用同一編號。失敗或網路回應不明時保留同一 saleId/請求內容供安全重試；確認為既有成交的 idempotent response 必須重新認證查詢，不能自造成交結果。
- `CONFIRMED_ZERO` 不允許直接轉有成交；`HAS_SALES` 可用最新 revision 新增不可變成交，但不得確認 0；更正／退款／特殊成交／刪除／店經理覆核仍不開通。
- 無 Browser 私有 Firestore 讀寫，不增加 listener／polling／大型 query；一次手動讀活動清單最多 30、狀態讀單一摘要、一次 Backend writer 有限 transaction。`formalRevenueDelta=0`；不改正式 `daily_reports`/`therapist_daily_reports`、Summary/Ranking、Revenue。Production build 隱藏入口，Phase 1–3 **不得 Deploy**。
- 本地契約/Reader/Writer/填報單元測試須通過；完整 CI、build、Rules 及三品牌 Firestore Emulator 需由 Mac feature worktree 執行後才可判定 `VALIDATED=YES`，未通過前不得 commit/push。

# Phase 2A-4R1 — 店經理單管理師活動歸屬覆核（isolated feature）
- Source Gate：`feature/activity-sales-center @ 1a5ea2dae0d20a197e1c58934f096f25d9ad80d3`；Production `main @ 36ee6eff1a198fc7b4d9ab33eee9068c3a882dcd`；`CURRENT_APP_VERSION=3.6.2` 不變。
- `manager` 為區長，**店經理使用 `store` 角色**，憑 `store_account_data.stores` 的最新後端憑證與 Application Identity、Trusted Device 驗證。`manager` 不得直接視為店經理覆核；只允許核對同品牌、自己可管門市、已存在正式日報的 `therapist` 歸屬。
- `manageActivitySalesAttributionReview` 僅提供明確 `subject` 的 `inspect`（唯讀）與 `review`（`verified`／`flagged` 固定理由碼）。每次核對 1 位管理師＋1 日期＋1 活動版本；不允許全品牌查詢、列表或 Browser 私有集合讀寫。前端覆核頁／列表本批尚未建立。
- 覆核與不可變成交/歸屬**不同集合**：`activity_sales_attribution_reviews/{summaryId}` 存覆核狀態，`activity_sales_attribution_review_audit/{summaryId}_rN` `create` 永久稽核。Firebase Rules Browser 全 deny（CYJ legacy + Anniu/Yibo）。
- 單一 transaction 依序讀管理師 master、正式管理師日報、目前活動發布投影、immutable version、歸屬摘要、舊覆核；覆核時只寫覆核狀態＋audit 共 2 筆，**不寫**正式日報、sale event、Summary、Ranking 或 Revenue。
- 覆核必須綁定 **歸屬 revision + 正式日報 `updateTime` 秒/奈秒 token + review revision OCC**。管理師新增成交或日報重新上報後，`inspect` 會回 `STALE`；重複相同覆核可 idempotent，但不同審核者或決策需新的 review revision。`UNCONFIRMED` 不可覆核，`CONFIRMED_ZERO` 才是明確 0。
- 只允許核對目前正式版本，不將新版 `UNCONFIRMED` 當作舊版 `CONFIRMED_ZERO`；正式活動換版須重新操作。批次不啟用退款、更正、取消、特殊成交、店經理列表、正式日報關帳或自動對帳。
- 每次 `inspect`／`review` 固定 7 筆**同品牌單文件** transaction reads，另計認證/可信裝置 reads。`review` 另外寫 2 筆，無 listener / polling / collection-group query。此為邏輯估算，非實際計費。
- 僅 `demo-drcyj-activity-sales` Mac Emulator 測試通過後可 commit/push feature；Phase 1–3 一律不得 Production Deploy。

## LOCAL SHOWCASE（獨立記憶體展示入口，2026-10-08）

- 本機執行：`npm run activity:showcase`，開啟 `http://127.0.0.1:5175/activity-sales-showcase.html`。不必啟動 Firebase Emulator，也不必使用正式帳號或密碼。
- 此入口是獨立 Vite HTML entry，使用既有 `ActivitySalesCenterView`、`ActivitySalesManagementView`、`ActivitySalesAcknowledgement` React 元件，依賴 `activitySalesShowcaseStore.js` 的**虛構記憶體資料**。展示專屬 Vite alias 以 `firebaseShowcaseStub.js` 替代 Firebase 初始化，無需啟動 Emulator；不是將 Firestore Rules 或 Production Identity 關閉。
- 可選品牌：CYJ／安妞／伊啵；展示角色：高階主管／店經理／管理師。支援模擬已發布活動、套組試算、八步驟草稿／送審／核准、Policy、重大異動修訂及理解確認；另有獨立模擬成交填報，用於驗收 N/A／零成交／有成交與防重複呈現。
- 隔離：僅 `VITE_ACTIVITY_SALES_LOCAL_SHOWCASE=true`、`VITE_ACTIVITY_SALES_DEV=true`、`VITE_ACTIVITY_SALES_PROJECT_ID=demo-drcyj-activity-sales`，且 Browser host 為 `localhost`／`127.0.0.1` 才會 mount。`vite.activity-sales-showcase.config.mjs` 僅包含 `activity-sales-showcase.html`，不修改 Production `index.html`、`src/main.jsx`、`App.jsx` 或現有 Firebase/Functions/Rules。
- 此模式不向 Firestore／Functions 傳送展示操作，不持久化資料（重新整理就重置）；所顯示的角色限制、Revision OCC、審核及理解確認只是**介面模擬**，不是 Backend Security/UAT 或真實交易驗證。
- 真正的 Auth／Trusted Device／Application Identity／Rules／Backend 容錯及三品牌交易驗證仍必須使用原有隔離 Emulator 流程執行。先前 `deviceApproval.js` timestamp 錯誤仍是獨立的 Backend blocker，不應因展示頁可操作而宣告已修正。
- `npm run activity:showcase:build` 僅建置 `dist-activity-sales-showcase-local/`；**不得部署這份展示產物**。正式 Production deploy：NONE。

# Phase 2A-4R2A — 店經理限定日期待核對候選資料（feature only）
- Source anchor: `feature/activity-sales-center @ 0b6bd2a42ea8827e4d7df74b0afb194d145ddbb7`, Production `main @ 36ee6eff1a198fc7b4d9ab33eee9068c3a882dcd`, version `3.6.2`. 本批不部署正式環境。
- `getActivitySalesReviewCandidates` 新增 POST-only Backend read-only gateway。要求 Firebase Application Identity、Trusted Device、新鮮憑證與 `store` 店經理角色。`manager` 是區長，不得沿用。店經理對 `store_account_data.stores` 的權限會在唯讀 transaction 內再次確認，**以 transaction 快照為準**；正式覆核 writer 仍在寫入 transaction 內重驗權限。
- 只查同品牌 `activity_sales_daily_attributions` 的 `storeCore + reportDate + roleId=therapist`，每次 query 最多 13 docs、回傳最多 12 筆，不提供全品牌／跨日期瀏覽、常駐 listener 或 polling。每筆候選還會讀取管理師 master、目前正式 publication 和 immutable version，排除轉店、離職及舊版歸屬；`UNCONFIRMED` 不在候選中，空清單**不等於**確認零成交。Browser 不能讀私人集合。
- 回應欄位只含可做下一步 `manageActivitySalesAttributionReview.inspect` 的最小 subject 與非加總歸屬額。不得視這份「候選」為已完成覆核；最後覆核仍必須重新 `inspect` 取得日報 `updateTime` 秒/奈秒 + attribution/review revision，使用原有 OCC 安全 writer。
- 讀取預算（程式路徑上限，未含登入裝置驗證與查詢計費細節）：授權 doc 1、query 最多 13、每位候選 master/publication/version 各 1，共最多約 **50 document reads/點擊**，0 writes，無 listener；資料多於 12 只回 `truncated=true`，**分頁尚未完成，不得當完整名單**。
- 新增 `firestore.activity-sales.indexes.json` 作為隔離開發三個 equality filters 的複合索引宣告，僅 `firebase.activity-sales.local.json` 引用；正式 Staging/Production index 尚未部署、必須於 Release Gate 檢查。
- 本批**尚未完成**：店經理覆核 UI、候選分頁、退款更正與 POS 對帳；不改日報、Summary、Ranking、Revenue、Firestore Rules、CURRENT_APP_VERSION，不開通前端私有資料直讀。

## Phase 2A-4R2B — 店經理成交覆核分頁與操作面板（feature only）

- R2A `getActivitySalesReviewCandidates` 加入以文件 ID 固定排序的 cursor 分頁（每次查詢最多 13 筆原始歸屬，最多檢視 12 筆）；cursor 僅用於導覽，不授予權限。每頁都重新驗證 Firebase Application Identity、最新密碼、Trusted Device、`store_account_data.stores` 及品牌隔離。
- `ActivitySalesAttributionReviewPanel` 只在 Activity Sales DEV 且 `store` 角色顯示，使用本帳號授權門市＋日期手動查詢。不直接讀私人 Firestore，不使用 listener/polling；頁面結果依目前正式版本與管理師主資料過濾，可能空頁仍有下一頁，不能當作全店完成率。
- 使用者點單筆後必須重新輸入密碼呼叫 R1 `manageActivitySalesAttributionReview.inspect`，取得 attribution revision、正式日報秒/奈秒版本與 review revision，才可再驗證密碼送 `verified` 或 `flagged`（固定原因碼）至既有 OCC transaction writer。成功後要求重新查詢。
- 不啟用更正／退款／取消／正式營收調整。`formalRevenueDelta=0`。本次與 R2A 均尚未套用 Mac 正式 feature worktree；完整 CI、Build、Firestore Emulator / 複合索引查詢尚未驗證；不得宣稱 VALIDATED／DEPLOYED。

## Phase 2A-5A — Lifecycle pure contract / NOT ACTIVATED（2026-10-09）

- 本次最新隔離 Source Gate：`feature/activity-sales-center @ 978b5adea2d4893b4586fc4162459123a5671c43`，`CURRENT_APP_VERSION=3.6.2`。正式 `main` 及 Production 全程不變。
- 先前 4R2B 段落之「尚未套用」為當時候選階段的歷史註記；目前 R2AB 已於隔離 Feature 分支提交至 `978b5ad`。
- 新增 `functions/activitySalesLifecycleContract.js` 純函式與 `tests/activitySalesLifecycleContract.test.js`。**沒有新增 HTTP 入口、Firebase import、Firestore document、Rules/query/listener/index、UI 開關或任何實際退款／更正執行權限。**
- 純函式定義標準價與特殊價差額、原因碼、**特殊成交預設 PENDING**；不允許 Browser 自行宣告已核准，不變更正式價與既有 Writer。
- `CORRECTION` / `CANCELLATION` / `REFUND` 以 immutable 交易身分與 append-only `eventId` 作為候選資料契約；含 revision 驗證、防重放、跨品牌／帳號／活動版本隔離、不得超額退款、不可從終結狀態再沖銷、正式業績變動永遠 0。
- `evaluateLifecycle` 僅為**單筆交易局部暫擬稽核投影**，返回 `officialKpiAllocation=UNDECIDED`，**不是已上線的活動日／月／目標 KPI**。不改原始成交紀錄、既有 `activity_sales_daily_attributions`、覆核 revision 或正式日報。
- 尚未定案且**不擅自啟用**：特殊價格誰可核准與在待核准時是否計入績效；跨日退款應歸哪個 KPI 月；組數與平均單價口徑；關帳後更正權限與補報政策。下一批實作 Writer／Rules／Emulator 前需鎖定口徑並重驗上游最新檔案。
- 成本：本批新增實際 Firebase reads/writes=0，functions invocation=0；Node 測試為純函式，無 Emulator 存取；不會接觸任何正式或 demo 專案。
- Documentation Impact：僅更新本 staging 設計／狀態文件；正式資料模型文件尚不增列未啟用的 Firestore Schema。

## Phase 2A-5B1 — 未啟用的 Lifecycle 申請 Writer（隔離開發候選）

- 開發基準：隔離 `feature/activity-sales-center @ c591549c4b6f77f8c38f4a655362f883cb45517d`，正式系統繼續 3.6.2。
- 新增 `functions/activitySalesLifecycleRequestWriter.js`，只提供**未在 functions/index.js 註冊**的可注入測試 Handler。**沒有部署、沒有前端按鈕、沒有可對外呼叫的 Cloud Function。**
- 原始成交與正式日報、Summary、Ranking、目標一律不改。驗證本帳號 Application Identity、Trusted Device／即時憑證、現存帳號與門市歸屬、正式日報、單筆原始成交、不可變更活動版本後，最多寫入兩個 Backend 私有文件：`activity_sales_lifecycle_requests` 和 `activity_sales_lifecycle_request_state`。只允許 `PENDING_REVIEW`，`officialKpiAllocation=UNDECIDED`、`formalRevenueDelta=0`；不產生已生效沖銷。
- 僅可有一筆未決申請；Event ID 冪等，Revision 與交易衝突 fail-closed。任一申請可重試，不可從申請宣稱已批准。取消、退款、更正真正生效需 B2/B3 加入授權、結算事件與財務口徑。
- Firestore Rules 對 CYJ legacy 與安妞／伊啵兩種路徑明示 `read/write:false`，同時加入 fallback exclude；已擴充 Rules Emulator 回歸清單，另新增真實 Firestore Transaction 競態 Emulator 測試（等待 Mac 執行）。
- 讀取估算：每件申請驗證約 7~8 筆單文件讀取（視角色而定，僅在測試／未來實際呼叫時發生），無常駐 listener/query/polling；每件新申請最多 2 筆私有文件寫入。
- 仍未決定退款入帳月、部分退款組數、特殊成交核准權限、歷史關帳規則；所以沒有正式退款執行、核准或 KPI 匯總。本段為候選 source，Mac CI／Emulator 未驗證前不得宣稱 VALIDATED。
- Documentation Impact：僅更新本 staging 文件；正式 CURRENT_STATE 與正式資料模型待上線門檻再更新。


## Phase 2A-5B2 — Lifecycle Review Policy and INERT Decision Writer (2026-10-09)

- Source Gate baseline: isolated `feature/activity-sales-center @ 9a23af8d4356db69b6ce85eab944150eb0c3c90f` (not Production source). MAC LOCAL SHOWCASE uncommitted work retained untouched. CURRENT_APP_VERSION remains 3.6.2.
- Separate brand-private `activity_sales_lifecycle_review_policy/current` from campaign publication approvals. **No policy configuration endpoint supplied**; missing/disabled policy always denies review. Policy v1 has explicit brand, revision, group-expanded named reviewers, ANY/ALL quorum and sequential steps. Account privileges depend on current named account, never merely role title. Requester's self-approval forbidden unless explicit `allowRequesterApproval=true`.
- `activitySalesLifecycleReviewPolicy.js` is pure; `activitySalesLifecycleReviewWriter.js` is **UNREGISTERED**, not imported by `functions/index.js` or frontend. It validates token Application Identity, fresh credential + Trusted Device, current brand actor record, existing B1 PENDING request and authoritative sale/version/daily anchors inside read-only phase of a transaction; writes only append-only `activity_sales_lifecycle_review_decisions` plus OCC `activity_sales_lifecycle_review_state`.
- Approval success only means **`APPROVED_PENDING_SETTLEMENT`**; REJECT creates an auditable `REJECTED` state. Neither changes the original pending request/lock nor settles a sale, refund, daily attribution, official KPI, Summary, ranking or reporting revenue. `formalRevenueDelta=0`, `officialKpiAllocation=UNDECIDED`. B1 pending lock is intentionally retained even after rejection pending later settlement/reopen policy.
- Security: both brand paths and CYJ legacy paths deny browser reads/writes to the three new private collections; generic wildcard grants explicitly exclude them. Backend policy is current revision and an immutable `planHash` is recorded with each vote; changed policy midflow rejects stale revisions. Current account/store membership is re-read inside the transaction.
- Performance: each review action reads up to 9 exact docs (policy, request, state, previous decision, actor, B1 lock, original sale, daily attribution, immutable version), writes 1 decision + 1 state; no listener, query, polling or Production deployment.
- Still **NOT IMPLEMENTED**: real policy management UI/writer, special-price application writer, business settlement/refund execution, after-close correction, KPI month and quantity allocation, unlock/re-request after rejection. No official approval authority exists unless a trusted future policy writer provisions a valid scoped policy.
- Documentation Impact: only this staging file; `FIREBASE_DATA_MODEL` Production canonical docs deliberately not changed for unregistered staging collections.


## Phase 2A-5B3A — 特殊價格「成交前」待審申請（隔離候選，NOT ACTIVATED）

- Source anchor：隔離 Feature `feature/activity-sales-center @ 169f7d67198a442ec493744b03533fda9c588fb1`；正式版本仍 3.6.2，本批不改 `functions/index.js`、前端入口或正式日報。
- 特殊價格**不是既有 B1 `CORRECTION/CANCELLATION/REFUND` 事件**。B1/B2 必須有已存在的原始 sale 才能核對；B3A 為原始 sale 尚未產生之前的申請，所以使用獨立的 `activity_sales_special_price_requests` 與 `activity_sales_special_price_request_state`，不假裝已接通 B2 決策 Writer。
- `activitySalesSpecialPriceRequestContract.js` 只接受最小輸入與受信身份：禁止前端自稱 `approvalState`、正式售價、核准者或任意 `formalRevenueDelta`；正式售價只由 Transaction 中已發布活動版本的 `packages` 取得。實付與正式總價不同才可提出申請，必須填固定差異原因。
- `activitySalesSpecialPriceRequestWriter.js` 是**未註冊的內部候選 handler**；每次檢查 Firebase Application Identity、Trusted Device／即時憑證、目前管理師／店主管門市、正式日報、目前已發布投影與不可變版本、品牌 `activity_sales_lifecycle_review_policy/current` 中的 `SPECIAL_PRICE` flow。政策缺失／停用即拒絕。
- 待審請求以品牌／角色／帳號／回報日期／活動及版本／saleId 的不透明 ID 當作唯一交易錨點，Firestore Transaction 僅對**兩個私有文件** `tx.create`；完全不新增原始成交、活動每日歸屬、退款、Summary 或 KPI。相同申請允許 idempotent replay，內容不同拒絕；同交易也禁止與已存在 sale 或 lifecycle 申請混用。
- Firestore Rules 對 CYJ legacy path 和安妞／伊啵 brand path 均明確禁讀禁寫新增私有集合，並在舊有通用 allow fallback 中排除兩個名稱。
- 申請狀態一律 `PENDING_REVIEW`，`officialKpiAllocation=UNDECIDED`，`formalRevenueDelta=0`。B2 的 `SPECIAL_PRICE` plan 僅作為**核准政策格式**，目前 B2 決策 Writer 仍只能處理已有原始成交的 Lifecycle 申請；**本批沒有核准決策、成交入帳、核銷或退款生效能力**。
- 待後續：B3B 需新增特殊價格專用決策與正式成交入帳的狀態機，交易內檢查仍有效之價格政策／正式版本與已提交日報、核准修訂與金額防重複；是否允許核准後跨日成交及月結政策需另外確認。
- Firestore 估算：每筆申請最多讀取 11 個單筆文件（含管理師或店主管 master），成功只建立 2 個 private docs；不加入 listener、輪詢、索引或大查詢。真實讀數仍以 Emulator/帳單為準。
- Source 在 Mac 尚須核對 HEAD、工作樹 SHA，再跑 Node CI、Build、三品牌 Rules Emulator 與真實交易競態，才可標記 VALIDATED；不可未實測先 Commit／Push。
- Documentation Impact：本批只更新此 staging 文件；Production canonical docs 不描述尚未啟用的資料流程。
