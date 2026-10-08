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
