# L3B2B4D｜活動銷售中心正式啟用阻擋條件總表（隔離分支）

**Status: HOLD_NOT_RELEASE_AUTHORIZED / HOLD_NO_POSTING。** Source Gate：`feature/activity-sales-center @ 641b84a9df26645ab8c62a6ac3f8d61cde58284e`。`CURRENT_APP_VERSION=3.6.2` 不變。本文件不是正式核准、也不是部署證明。

## Release Gate 結論

Phase 1 前後台建立與 Phase 2 成交／覆核／特殊價格流程已有候選程式，但仍停在隔離分支。不能把 Git PUSH、合成測試 PASS、`SIGNED_NO_POSTING`，或離線審核草案提升成正式啟用權限。本批只新增純離線 release blocker inventory、CLI、測試與本文件；不修改現有權限與正式路徑、不寫入 Firestore、不部署。

| 關卡 | 狀態 | 解除前必須拿到的證據 |
|---|---|---|
| G1 Source / Deploy identity | HOLD | 真實 Production runtime commit、gh-pages asset、functions/rules 版本與目標 project 同一性 |
| G2 Production Firestore read | HOLD | 獨立授權者、不可自簽憑證、指定三品牌受控帳號、可信 principal、最小 IAM、時限與防重播；不得使用原 `--ack` 解鎖 |
| G3 Legacy trusted / alias | HOLD | 舊 `trusted`、fingerprint 多 ID、全域封鎖與撤銷策略；多管理員 OCC／Emulator 檢驗 |
| G4 九項財務政策 | HOLD | `ACTIVITY_RECOGNITION_DATE`、`ACTIVITY_AMOUNT_BASIS`、`ACTIVITY_QUANTITY_BASIS`、`ACTIVITY_ASP_FORMULA`、`DAILY_REPORT_RECONCILIATION`、`CROSS_MONTH_ATTRIBUTION`、`CLOSED_PERIOD_TREATMENT`、`REJECTED_REOPEN_FLOW`、`DAY_LOCK_TERMINAL_RELEASE`，逐品牌明確核定 |
| G5 簽核名單／管理入口 | HOLD | 三品牌獨立 BUSINESS／FINANCE 角色與可信裝置名單、撤銷交易與稽核；不得預設任何人有權 |
| G6 Settlement Writer | HOLD | 對日報、個人日報與正式 KPI 的去重、防雙重入帳、月結對帳與 transaction regression |
| G7 Phase 3 | HOLD | 活動分析、歸屬績效與正式 KPI 完整對帳 |
| G8 Staging / UAT / Release | HOLD | Frontend／Backend／Rules、品牌隔離、Emulator race、端到端、reads 預估、操作實測與明確部署核准 |

## 九項財務核定的權威邊界

以 `docs/ACTIVITY_SALES_SPECIAL_PRICE_POLICY_SIGNOFF.md` 為待簽核文件。只有業務／財務權責人真實核定，才可進入下一階段設計。任何草案文字、AI 建議或測試 fixture 均不能提升 `approvedCount` 或啟用 posting。

## Production Reads／安全邊界

本批新增的 CLI 不接受參數、不載入 Firebase SDK、0 reads／writes／listeners／queries／polling。舊受控讀取工具仍由 L3B2B4C 在正式授權缺席時 hard block。原先的 96 次 document get 請求只是研究工具的 *上限估算*，不是 Firebase 計費保證、也不是批准。三品牌路徑與登入權限須待上游正式驗證，不能跨品牌繼承。

## 執行與解讀

`node scripts/activitySalesL3B2B4DReleaseGate.mjs` 預期 exit code **3**，JSON `status=HOLD_NOT_RELEASE_AUTHORIZED`；exit 3 是刻意的 HOLD，不是驗證失敗也不是核准通過。測試：`node --test tests/activitySalesL3B2B4DReleaseGate.test.js`。任何 `--approved` 類命令列參數直接拒絕。此 inventory 不可用於解鎖讀取、金額結算、merge 或部署。

## 後續真正需要的決策

先由正式權責人確定九項政策及逐品牌簽核角色，再另行取得 Production IAM／抽樣授權及舊裝置遷移策略。據此在新的明確核准批次實作結算 authority、正式 UAT 和 Release Gate，不能因本文件成立即部署。

**Documentation Impact:** 新增本專項 Staging 文件；未修改 canonical Production docs。
