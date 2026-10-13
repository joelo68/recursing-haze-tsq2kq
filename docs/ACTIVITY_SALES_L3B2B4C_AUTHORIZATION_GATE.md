# L3B2B4C｜正式抽樣前：授權、Project、IAM 與讀取守門

**來源：** `feature/activity-sales-center @ f716d9b14e46d83e3a3377b79692f2a3db3bd218`（隔離分支最新已知來源，不等同 Production 已部署版本）。
**狀態：** `HOLD_AUTHORIZATION_NOT_ATTESTED` / `HOLD_NO_POSTING`。本階段**不讀取正式 Firestore**，不合併 `main`、不部署 Functions／Rules／Hosting、`CURRENT_APP_VERSION` 不變（3.6.2）。

## 為何不能沿用既有 --mode=read

L3B2B4B 的讀回界限已可限制為 CYJ／安妞／伊啵每品牌 1–2 個指定帳號、每帳號最多 15 個裝置、總計最多 96 次文件 `get()` 請求。但過去 CLI 使用 `--ack=I_AUTHORIZE_BOUNDED_READ_ONLY` 和 `DRCYJ_AUDIT_PROJECT_ID` 環境變數，這些是操作者**自行宣稱**，不能證明誰批准真實 Project、哪些帳號、哪個 IAM 主體、何時核准與何時到期。Firebase Admin SDK 具高權限，Frontend Rules 不能代替 IAM 唯讀檢查。若不先補真實權威驗證，單憑 ACK 無法當正式授權。

## 本批實作的上游防護

- **真正的 Live Read CLI 入口阻擋：** `scripts/activitySalesL3B2B4ControlledRead.mjs --mode=read` 一律在讀取 Scope 檔案或載入 Firebase SDK **之前**回傳 `L3B2B4C_AUTHORITATIVE_APPROVAL_REQUIRED`，退出碼 `2`；即使提供舊的 ACK、Project ID、環境變數亦相同。這是針對隔離分支研究工具的 Fail-Closed 守門；**不代表 Production 全系統任何路徑均已阻擋**。
- **保留正常離線計畫：** 原 `--mode=plan` 使用合成 fixture 繼續顯示 0 reads，退出碼 3。
- **新增純函式／CLI 的 Preflight：** 使用原 L3B2B4B `checkScope()` 驗證三品牌品牌隔離、指定帳號及 96 次讀取上限，接收 `REVIEW_ONLY_NOT_AUTHORIZATION` 申請；永遠回傳 `HOLD_AUTHORIZATION_NOT_ATTESTED`，禁止讀取、授權、入帳、部署。只輸出品牌數量／整體數量和缺少的權威證據，**不輸出 accountId、deviceId、fingerprint、Project ID、聲明的 Principal 或原始 Firestore 文件**。
- 不新增 Query、Listener、Polling、Firestore 寫入、Function 註冊或監聽；本批合成／離線測試的正式 Firestore reads = 0。

## 離線 Preflight 執行（無 Firebase）

```bash
node scripts/activitySalesL3B2B4CPreflight.mjs \
  --scope=fixtures/l3b2b4b.synthetic.scope.json \
  --request=fixtures/l3b2b4c.synthetic.review.json
```

輸出 `status=HOLD_AUTHORIZATION_NOT_ATTESTED`、`readsPerformed=0`；退出碼 `3` 表示尚無正式授權，絕不是已可執行。`--request` 是**尚未核定的申請**，不接受任何 `approved`、`signature`、`canReadProduction` 等自稱可授權欄位，也不產生可自行解鎖的 Token。請勿在 Git、Evidence ZIP 或聊天訊息放入真實帳號名單或敏感資料。

## 解除 HOLD 必須由使用者及正式權責人另外核定

1. **確認 Production Project 與部署版本：** 需要真實 Firebase Project ID、來源／部署同一性證據與執行區域；隔離 Git HEAD 並不等於正式部署證據。
2. **具體三品牌抽樣範圍：** 每品牌 1–2 名確實存在的被核准帳號，Role／Account ID 用安全的 Repo 外私人 `0600` Scope 文件保存；由權責人審閱原件，聊天只交換無個資的數量與證據代號。
3. **IAM 最小權限：** 真正可驗證的 ADC 執行主體、唯讀存取權、限定 Project、受控有效期；不能單靠操作者宣稱 Principal、專案環境變數或 Admin SDK 本身。Firestore Rules 不會限制 Admin SDK 特權。不得在報告顯示 service-account 私鑰／存取 Token。
4. **獨立核准與防重播：** 需要可信簽署者及核驗用鑰、公鑰錨點、範圍／主體／Project 綁定、時間窗與 nonce 防重播策略；本批**尚未實作**且未拿到使用者核定，故 Live Read 持續封鎖。僅憑 Repo 檔案或自製核准 JSON 不足以證明授權。
5. **讀取實績及中斷策略：** 6 個帳號 ×（1 profile + 最多 15 global markers）= 最多 96 次**程式提出的文件讀取請求**，非 Firebase 計費上限保證（SDK 重試可能增加）；超量立即停止，禁止全表掃描、Listener、Polling、寫回或透過 fingerprint 擴大查詢。讀回非交易一致快照，不涵蓋被刪除或跨帳號的歷史別名。
6. **財務政策獨立批准：** 既有九項認列政策仍未核准；`SIGNED_NO_POSTING` 不代表財務入帳許可。安全 Preflight 或 Admin 裝置信任不可提升 `canPost`。

**正式執行前還必須修或核實的事項：** 替換目前不可由程式核驗的操作者自我聲明，核對最小 IAM、部署 Source、主體及範圍；在下一個明確批准後的隔離批次另行設計可驗證權威，並執行 FE／BE／Rules／OCC／Regression；**不得自行移除 CLI Hard Block**。

**Documentation Impact：** 修改原 `docs/ACTIVITY_SALES_L3B2B4B_CONTROLLED_READ.md` 的現行讀取說明，新增本文件；不修改 canonical Production docs。
