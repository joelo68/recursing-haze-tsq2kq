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
