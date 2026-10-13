# L3B2B4B｜三品牌裝置安全：受控唯讀抽樣診斷

**狀態：ISOLATED CANDIDATE / HOLD_NO_POSTING**
**固定 Git 基準：** `feature/activity-sales-center @ 4262da29f00702d023090322d339678d09fc337d`。
**來源性質：** 隔離 Feature Branch；不是最新正式部署狀態的證明。
**CURRENT_APP_VERSION：** 3.6.2（不修改）。

## 目的與安全限制

延續 L3B2B4A 純離線分類器，L3B2B4B 提供**明確授權後才能使用**的精準 Firestore `doc().get()` 讀取器。沒有任何 `set/create/update/delete`、collection query、listener、polling、Cloud Function 註冊或正式資料移轉。

- 最多**每品牌 2 個指定帳號，三品牌合計 3–6 個**，每帳號最多 15 個 `account_devices` map entries。
- 理論上限 **6×(1 個 profile 文件 + 15 個 global marker 文件) = 96 次指定文件讀取請求**。Firestore 計費量可能因 SDK 重試或環境不同而有差異；不可當作保證的帳單上限。
- 每帳號只讀**完整的單一** `account_devices/{accountKey}` 文件，然後針對該文件中**已知的**每一個 deviceId 讀相應全域標記。即使超過上限，也不執行集合掃描；直接拒絕。
- 只輸出累計風險數量、抽樣覆蓋與 reads 統計，**不輸出帳號 ID、裝置 ID、deviceFingerprint、密碼、Raw Firestore 文件、UID 或裝置使用者資訊**。
- 缺少 profile、異常欄位／識別碼正規化衝突直接列缺口或拒絕，不做「安全／可信任」推定。
- 樣本資料沒有可證明的全品牌完整度，並非單一交易時間點的完整快照；**無法看見已從 profile map 刪除的舊 deviceId 或跨帳號／跨品牌的 fingerprint 歷史別名**。

## 精準 Firestore 路徑（目前 Feature Branch 驗證）

| 資料 | CYJ legacy | 安妞／伊啵 |
|---|---|---|
| 受信裝置 | `artifacts/default-app-id/public/data/account_devices/{brand_role_account}` | `brands/{brand}/account_devices/{brand_role_account}` |
| 全域封鎖 | `artifacts/default-app-id/public/data/global_blocked_devices/{role_account_device}` | **同一份全域路徑** |

帳號、裝置 key 正規化**依 `functions/deviceApproval.js` 現行 `sanitizeSecurityKey()` 語意**：`trim`、將 `/ . # $ [ ]` 和空白取代為 `_`、長度截到 160。身份／路徑碰撞會拒絕執行。來源必須核對：

- `functions/deviceApproval.js` Git Blob `163eeac74f08f332ea3ae3c6e52f1b5f157b369c`。
- `functions/activitySalesL3B2B4ReadinessAudit.js` Git Blob `8ac46f17e9ff84e85ff9639ce4758c4c8f3ca956`。
- `functions/activitySalesSpecialPriceSignoffAuthorityManagementWriter.js` Git Blob `d7ebfbf049b93c7c7b1a61c702b68467fff96c4f`。

這些是已確認的隔離來源，**不是對部署中 Production 文件的同一性保證**。如正式來源已不同，應先更新上游基準，不得把此工具直接視為正式安全稽核。

## L3B2B4C 安全變更（2026-10-13，僅隔離候選）

L3B2B4B 原有 `--mode=read` 自行輸入 ACK／環境變數無法證明獨立授權，**後續 L3B2B4C 已在 CLI 入口強制拒絕任何 Live Read**，錯誤代碼 `L3B2B4C_AUTHORITATIVE_APPROVAL_REQUIRED`，且發生於開啟 Scope 檔案、載入 Firebase SDK、取得身分權杖或存取正式資料之前。下列 L3B2B4B 原先列出的正式讀取流程是**歷史設計說明，現階段禁止執行**；無論指定什麼專案、IAM 或 ACK 都不能解除。`--mode=plan` 完全保留，L3B2B4C 新增僅供離線審查的 Preflight。重新啟用 Live Read 需要另行批准真實 Project／執行身分／品牌及帳號 Scope、可驗證的獨立簽核與到期限制，並再做上游 Security Regression，**不可自行刪除 Guard**。

## 操作模式

**1. 無網路 PLAN（安全，使用合成 fixture）**

```bash
node scripts/activitySalesL3B2B4ControlledRead.mjs --mode=plan --scope=fixtures/l3b2b4b.synthetic.scope.json
```

只產生選取帳號數、品牌覆蓋及理論讀取上限；`readsPerformed=0`。退出碼 `3` 代表 **HOLD_NO_POSTING，不是失敗或授權完成**。

**2. 真實專案抽樣（目前尚未獲使用者授權，不執行）**

只有在資料權責人與使用者明確核准個別品牌帳號範圍、Firebase projectId、讀取上限和 IAM 之後，才可由 Mac 操作者準備**存於 Repo 外、權限為 `0600`** 的 JSON，格式與上述 fixture 相同，但填入已核准的實際 accountId。此檔案不得納入 Git、ZIP、聊天或上傳 Evidence。事先 `chmod 600 <private_scope_file>`，並清楚核對使用的 service account/ADC 所屬專案。不要使用 `master_auth` 密碼或匯出完整 account_devices 文件。

工具的 `--mode=read` 具有雙重 projectId 確認、顯式讀取核可字串、檔案權限與位置守門；未滿足任一條件就退出。即使執行成功，**所有輸出仍固定 `HOLD_NO_POSTING`、`canDeploy=false`、`canGrantAuthority=false`、`canSettle=false`、`canPost=false`**。必須由授權操作者審閱彙總結果，不是程式對正式資料安全性的自動認證。

**重要：這包的 Mac Validation Runner 只做合成與模擬測試，絕不觸發 `--mode=read`。** 不要把上述文字視為使用者已核准查詢正式資料。

## 讀取成本與限縮

先讀每個指定 profile（3–6 個），每份 map 最多 15 個 deviceId，對每個 deviceId 只讀一筆 global block marker。無任何全 collection query，因此本批沒有新增業務常駐 reads。若帳號裝置超出上限，工具拒絕而非分批擴大掃描；若結果不完整，必須由使用者重新核准新的抽樣範圍。

## 獨立後續關卡

1. 審核抽樣帳號身分、正式 IAM 可讀範圍、目前 `deviceApproval.js` 的 Production 部署版本。
2. 限量彙總報告只作風險檢查，不得當成已看完全部裝置或可以自動修改全域封鎖標記。
3. 指定實際正規化碰撞、歷史缺漏 `trusted` 和已刪除別名的人工處置與回復策略，才設計 Event-driven 上游 Security 變更。
4. 九項財務認列／跨月／關帳政策仍需營運、財務正式核准； `SIGNED_NO_POSTING` 保持禁入帳。
5. 將來如新增後端高權限 API，需獨立檢查 FE／BE／Rules、SA/Token、Transaction OCC、完整 Regression、成本及正式部署流程。

**Documentation Impact:** 本批新增本文件；不修改 canonical Production docs、`functions/index.js` 或正式部署設定。
