# L3B2B4A｜特殊價格政策與裝置安全：正式啟用前唯讀盤點

**Status:** ISOLATED CANDIDATE / HOLD_NO_POSTING。 **Git source gate:** `feature/activity-sales-center @ 48276818b6f16bdc4a81b8d8490155c761f88958`。**Version:** `3.6.2` (unchanged)。

## 本批適用範圍（不是正式啟用批准）

本批新增 `functions/activitySalesL3B2B4ReadinessAudit.js` 純函式、`scripts/activitySalesL3B2B4ReadinessAudit.mjs` 離線 CLI 和測試，**沒有寫入與部署能力**。命名為 `audit` 的離線結果不證明任何 Firestore 資料已經被後端認證。它不能授予建立／撤銷審核人員權限，也不能允許特殊價格入帳。

來源交叉確認（本次上游 Git Blob 必須由 Mac Source Gate 再檢）：

- `functions/deviceApproval.js`：`163eeac74f08f332ea3ae3c6e52f1b5f157b369c`；`isTrustedDeviceRecord` 允許 `trusted !== false` 且不是風險 status/source 的歷史紀錄；`verifyTrustedApproverDevice` 同時讀品牌受信裝置與「指定 deviceId」全域標記；登入時可能用 `deviceFingerprint` 尋找歷史 deviceId，且可能對多個 deviceId 讀全域標記。
- `functions/activitySalesSpecialPriceSignoffAuthorityManagementWriter.js`：`d7ebfbf049b93c7c7b1a61c702b68467fff96c4f`；SET／DISABLE 驗證 Transaction 內管理者身分與裝置，未註冊 Cloud Function。
- `functions/activitySalesSpecialPricePolicySignoffWriter.js`：`e623d502b4f83e697ad7021b0450c284b1dd78ee`；只能得到 `SIGNED_NO_POSTING`，不建立正式入帳。
- `docs/ACTIVITY_SALES_SPECIAL_PRICE_POLICY_SIGNOFF.md`：`0fc42cee67f00b5f41b3b33b0f629c42dadf6b71`；九項認列、跨月、關帳、對帳等政策尚未核准。

## 盤點輸入與發現

輸入只允許 `schemaVersion` 與最多 120 個 `profiles`；每份帳戶 profile 最多 100 個已明確標示的 devices，總量最多 1,500。profile 包含 `brandId`、`roleId`、`accountId`、`devices` 與 `globalMarkers`。`globalMarkers` 的每一個 key 必須為同一 profile 的 deviceId；`null` 代表提供者聲稱該文件不存在，**並非經系統驗證不存在**。若未提供 marker，列為缺口；禁止把「沒傳」理解為未封鎖。

盤點代碼：`LEGACY_IMPLICIT_TRUST`（舊式隱含信任）、`FINGERPRINT_ALIAS_CLUSTER`（同一帳號 fingerprint 指向多個 deviceId）、`BLOCKED_FINGERPRINT_ALIAS_REVIEW`（別名組內封鎖/未封鎖衝突）、`TRUSTED_DEVICE_HAS_GLOBAL_BLOCK`、`GLOBAL_MARKER_NOT_PROVIDED`、`GLOBAL_BLOCK_STATUS_SOURCE_AMBIGUOUS`、`FINGERPRINT_UNAVAILABLE`。結果使用本次執行的序號化 profile ID；輸出不包含原始帳號 ID、裝置 ID、fingerprint 或密碼。

**重要：** fingerprint 不是可靠身分憑證，不能據此自動解除封鎖、跨裝置信任或推導「全品牌同裝置」。活動管理不應有獨立繞過共用 Device Authority 的 fallback。

## 人工核定／正式安全關卡

1. 受控讀回三品牌真正授權帳號的品牌內 `account_devices/{accountKey}` 和每個候選 deviceId 的全域 `global_blocked_devices/{role_account_device}`；如要探索 fingerprint 歷史別名，**必須由既有單筆 profile 的 devices map 得出**，不得全表搜尋。讀取估算每個候選帳號 1 筆 profile + N 筆 exact marker（如 N=10 → 11 reads）；另需考慮 Firebase Auth 和 credential 相關讀取。本批不新增這些 reads，未經明確核准不得連正式資料庫。
2. 由正式安全權責人核定缺失 `trusted` 欄位之遷移策略與回復程序，保留已有合法裝置並處理匿名化診斷，不能直接大規模更動裝置資料。
3. 決定 fingerprint 多 ID 的權威對應模型、跨品牌封鎖／恢復語意及 OCC transaction 範圍；新增真實 Emulator race/regression（包括被封鎖別名不得藉重設裝置 ID 繞過）。
4. 明確核定 BUSINESS／FINANCE 簽核者及九項財務認列政策。L3B2B2 `SIGNED_NO_POSTING` **不是**財務政策簽核，也不是可入帳狀態。
5. 正式 Frontend／Backend／Rules、SA/Token、帳號停用與 master-credential fallback 的安全回歸，另行通過正式 release gate，且需使用者明確指示才可部署。

## 本機執行（人工提供脫敏離線 JSON；不接 Firebase）

`node scripts/activitySalesL3B2B4ReadinessAudit.mjs fixtures/l3b2b4.synthetic.json`

CLI **永遠**輸出 `status=HOLD_NO_POSTING`，exit code 3 代表「需要進一步驗證」，exit code 2 代表輸入不符合契約；不會輸出 READY、部署許可或入帳許可。所有測試僅使用合成資料。

**Documentation Impact:** 只新增本文件及修改 `docs/ACTIVITY_SALES_CENTER_STAGING.md`。不修改 canonical Production docs。
