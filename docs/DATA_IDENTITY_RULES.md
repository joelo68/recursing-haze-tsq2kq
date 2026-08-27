# DATA_IDENTITY_RULES.md

## 目的

本文件定義本專案「店家身份（Store Identity）」的長期治理規則，避免未來遇到某頁面抓不到資料時，
以頁面層級 workaround 的方式針對特定店名補判斷，造成同一問題在 Dashboard、TargetView、
Ranking、Telegram Agent、Maintenance 等不同模組重複修補。

若未來任何頁面出現店家資料缺漏、Summary 與 Raw 不一致、同一門市出現兩種名稱、
或「CYJ新店」相關異常，**先依本文件診斷，不得先在個別頁面加入特殊判斷。**

---

# 1. CYJ 新店的正式身份定義

## Canonical identity

- `coreStoreName`：`新店`
- `canonicalStoreName`：`CYJ新店店`

## Legacy aliases

以下名稱在歷史資料中可能代表同一個邏輯門市：

- `CYJ新店`
- `CYJ新店店`
- `DRCYJ新店`
- `DRCYJ新店店`

其中：

- `新店` 是地名本體。
- 最後一個「店」不是可以任意去掉的普通門市後綴。
- 因此 `CYJ新店店` 在目前系統中是正確的 canonical 名稱。

---

# 2. 資料層規則

## 2.1 monthly_targets

所有新的寫入必須使用 canonical document id：

```text
CYJ新店店_YYYY_M
```

禁止新建：

```text
CYJ新店_YYYY_M
```

讀取時可以保留 legacy fallback，目的只在於相容尚未整理的歷史年份。

若讀到 legacy key 後重新儲存或解鎖，應遷移成 canonical key，
並避免同時留下 canonical + legacy 兩份文件。

---

## 2.2 monthly_targets_summary

Summary 中新店的正式 storeName 必須是：

```text
CYJ新店店
```

Summary arbitration 必須遵守：

1. 有效非 0 目標優先於全 0 duplicate。
2. 同月份若有兩份不同的有效非 0 目標，視為 conflict。
3. conflict 不得自動選最新時間、不得自動覆蓋，必須人工確認。
4. active store 的全 0 target 不可被當成「完整 coverage」。

---

## 2.3 monthly_aggregated

CYJ 新店的 aggregate key 必須統一使用：

```text
YYYY-MM_CYJ新店店
```

歷史資料若同時存在：

```text
YYYY-MM_CYJ新店
YYYY-MM_CYJ新店店
```

不得直接挑一份留下，也不得直接把兩份 aggregate 相加。

正確修復方式：

```text
daily_reports
→ normalize logical store identity
→ 從 raw source 重新計算
→ 寫入唯一 canonical monthly_aggregated
```

---

## 2.4 daily_reports

`daily_reports` 是歷史 Source of Truth。

原則：

- 不為了名稱整齊而批次修改歷史 raw 日報。
- 歷史資料可能存在 `CYJ新店` 與 `CYJ新店店`。
- 查歷史 raw 日報時，必須透過 normalize / aliases / canonical 規則識別同一邏輯門市。
- 禁止假設所有歷史資料的 `storeName` 都已經是 canonical。

---

# 3. 2026-08-18 已發生事故紀錄

## 原始問題

2026 年 CYJ `monthly_targets` 曾同時存在：

```text
CYJ新店_2026_M
CYJ新店店_2026_M
```

其中：

- `CYJ新店_2026_M` 為全 0 legacy duplicate。
- `CYJ新店店_2026_M` 為有效正式目標。

此狀況存在於 2026 年 1～12 月。

## 下游影響

曾造成：

- `monthly_targets_summary` Raw / Summary mismatch。
- Telegram Agent 多品牌查詢時可能判定 CYJ 目標缺失。
- 2026-02 `monthly_aggregated` 被拆成：
  - `2026-02_CYJ新店`
  - `2026-02_CYJ新店店`

## 已完成修復

2026-08-18 已完成：

- 清理 2026-01 ～ 2026-12 共 12 筆全 0 `monthly_targets` legacy duplicate。
- 重建 2026 年 12 個月 `monthly_targets_summary`。
- 2026-02 `monthly_aggregated` 已由 raw `daily_reports` 重建。
- 歷史 `daily_reports` 未修改。
- CYJ 2026 全年 Core Consistency Audit 最終結果：
  - 異常群組：0
  - 高風險衝突：0
  - 需確認：0
  - 可整理重複：0
  - Summary 差異：0

---

# 4. 現行防呆層

目前系統應維持以下保護：

## TargetView

- 讀取：canonical 優先，legacy fallback。
- 寫入：只寫 canonical。
- CYJ 新店 canonical：`CYJ新店店`。
- `recalc_queue.sourceId` 使用 canonical key。
- `recalc_queue.storeName` 使用 canonical storeName。

## Backend / index.js

- target resolver：有效非 0 target 優先於全 0 duplicate。
- Summary coverage：全 0 active-store target 不可偽裝為完整 coverage。
- `monthly_aggregated`：CYJ 新店統一 canonical key。
- 手動 recalibration 與即時 aggregate trigger 必須使用同一 canonical 規則。

## SystemMaintenance

- 保留 Core Consistency Audit。
- 支援單月 / 全年檢查。
- 正式版只做 Audit Only。
- 一次性的「CYJ 新店歷史命名安全修復 V2」不應長期留在正式 UI。

---

# 5. 未來出現「某頁抓不到新店資料」時的固定診斷順序

禁止一開始就修改出問題的頁面。

必須依序檢查：

1. **先跑 Core Consistency Audit**
   - 看 Raw / Summary 是否一致。
   - 看是否出現 duplicate / conflict。

2. **確認該頁真正讀取的 collection**
   - `monthly_targets`
   - `monthly_targets_summary`
   - `monthly_aggregated`
   - `daily_reports`
   - `therapist_daily_reports`
   - 其他來源

3. **確認資料層實際 storeName / document id**
   - canonical？
   - legacy alias？
   - 是否同一 logical store 被拆成不同 key？

4. **確認讀取流程是否有經過 normalization / alias / canonical layer**

5. **確認 writer 是否產生非 canonical key**

6. **確認 Summary / aggregate 是否為衍生資料問題**
   - 若是衍生資料，優先從 Raw Source of Truth 重建。
   - 不要猜哪份 aggregate / summary 才是對的。

7. **最後才判斷是否真的需要修改頁面**

如果問題只發生在單一頁面，但 Raw、Summary、canonical writer、Audit 都正常，
才進一步檢查該頁自己的查詢或 selector。

---

# 6. 禁止事項

未來任何工程師或 AI 不應：

- 在單一頁面直接新增：
  ```js
  if (storeName === "新店") ...
  ```
  來掩蓋資料身份問題。

- 自行使用：
  ```js
  storeName.replace(/店$/, "")
  ```
  而不考慮「新店」是地名本體。

- 自行拼接：
  ```js
  `${brand}${store}店`
  ```
  而不經既有 canonical 規則。

- 看到兩份 `monthly_aggregated` 就直接相加。

- 看到兩份不同有效 target 就選更新時間較新的那一份。

- 為了名稱統一批次修改歷史 `daily_reports`。

---

# 7. 變更 Store Identity 規則前的最低要求

任何涉及店名 normalization、canonical key、alias、store query variant 的修改，都必須至少：

1. 執行：
   ```bash
   node --test tests/storeIdentity.test.js
   ```

2. 執行：
   ```bash
   npm run build
   ```

3. 若後端有改：
   ```bash
   node --check functions/index.js
   ```

4. 部署後以 Core Consistency Audit 驗證相關品牌 / 月份。

---

# 8. 核心原則

> Store Identity 是資料層規則，不是頁面顯示 workaround。

當某頁抓不到資料時，先追資料鏈與 identity layer，
不要再回到「哪個頁面壞就在哪個頁面補一個新店特例」的維護方式。

---

# Store Lifecycle Identity Extension — Batch 1（NOT DEPLOYED）

Store Lifecycle 不建立新的 Store Identity 系統；它必須沿用本文件既有 canonical store contract。

Lifecycle 每個品牌各有獨立 Master，因此 identity namespace 為：

```text
brandId + coreStoreName
```

例如 CYJ：

```text
新店
CYJ新店
CYJ新店店
DRCYJ新店
DRCYJ新店店

→ coreStoreName = 新店
→ storeKey = 新店
→ canonicalStoreName = CYJ新店店
```

禁止因 Lifecycle 管理頁、Firestore map key 或新 Backend writer 再建立另一套 alias 規則。

`store_lifecycle` 若遇到未知品牌 ID 必須拒絕操作，不得把未知品牌 fallback 到 CYJ；這是品牌隔離的一部分。

Batch 1 尚未把 Store Lifecycle 接到 KPI consumers，因此新增 Master 不會改寫既有 Raw / Target / Summary / Ranking / Annual 資料。
