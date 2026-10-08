# ACTIVITY_SALES_CENTER_BLUEPRINT.md

> 狀態：Phase 0B 開發基線。這不是 Production CURRENT_STATE。
> Production 仍以 main 與 CURRENT_STATE.md 為準。

# 1. 產品定位

活動銷售中心不是公告欄，而是：
活動建立 → 可配置審核 → 正式發布 → 第一線理解 / 查詢 / 試算 →
日報內活動成交歸屬 → 店經理檢核 → 目標追蹤 → 活動分析 → 復盤。

# 2. 已確認需求

- Phase 1：活動建立、可配置審核、發布、版本、搜尋、快速試算、FAQ、理解確認。
- Phase 2：日報活動成交、今日無成交 / 尚未確認、特殊成交、更正 / 取消 / 退款、店經理檢核、活動目標。
- Phase 3：品牌 / 區域 / 門市 / 人員分析、活動占比、客群、復盤。
- Phase 4：只保留 AI interface；本次不開發 AI 問答、推薦、預測、自動設計活動。

# 3. 核心語意

活動成交是既有日報業績的「活動歸屬」，不是第二筆營收。
因此不得把活動成交金額再次加到 daily_reports 的正式總業績。

每日活動狀態固定區分：
- HAS_SALES：有活動成交。
- CONFIRMED_ZERO：已確認今日無活動成交。
- UNCONFIRMED：尚未確認。

0 與未回報不可混為同一狀態。

# 4. 審核模型

不綁死職務，也不強制雙重核准。

每檔活動可設定：
- 直接發布
- 1 人核准
- 指定多人其中 1 人
- 指定多人全部核准
- 依序核准
- 自訂流程

核准者可由「人 / 群組 / 權限集合」決定。
建立者是否可自行核准亦為活動設定。

# 5. 活動版本

已發布活動不得原地覆蓋歷史事實。
售價、組合、拆帳、資格、優惠等重大變更產生新版本，成交永遠綁定成交當時版本。

# 6. 既有 Smart Forecast 活動資料的邊界

現有 projection_context 是「智慧推估活動情境」，不是銷售活動正式 authority。
兩者不可共用同一份正式資料模型。

未來可以由活動銷售中心「選擇性投影」必要的日期 / 影響資訊給 Smart Forecast，
但 Sales Campaign 必須有自己的生命週期、版本、售價、拆帳、審核與成交 authority。

# 7. 正式版本策略

Phase 1～3 開發 / Staging 不修改 Production CURRENT_APP_VERSION。
正式 Production 大型 Release 時才同步升版，暫定 3.6.2 → 4.0.0，
實際版本以 Release Gate 當時最新 Production 為準。

# Phase 1A 實作基線（feature branch）
- 活動建立 / 直接發布 / 手動發布權限改為品牌可配置的「人員或群組」，不綁死職務。
- 每檔活動可選免審核、任一人、全部、依序或自訂流程。
- `allowCreatorApproval` 明確決定建立者能否自行核准。
- 送審時把核准群組解析為當下實際人員快照，群組後續異動不改寫既有版本。
- 每次送審建立 immutable `activity_campaign_versions`。
- campaign `revision` + Firestore transaction 處理多人 race。
- 正式售價必須等於套組內部歸屬金額合計。
- Phase 1A 尚未做 UI、日報成交、分析、AI。
- `scheduled_after_approval` 在 Phase 1A 採 fail-closed：審核完成先停在 `approved`，未到指定時間不得發布；自動排程 publisher 留待後續子階段接上。
- `allowCreatorApproval=false` 時，若 `all` quorum 仍包含建立者，視為不可完成的流程並在送審前拒絕。
- Campaign 權限在 mutation transaction 內重讀最新 policy，避免權限調整與活動操作 race 使用舊 policy。
