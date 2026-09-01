# DASHBOARD_SUMMARY.md

> 本文件記錄目前正式 Dashboard Summary / Historical Data 信任與 fallback 架構。  
> 建立來源：目前正式 `App.jsx`、`useDashboardStats.js`、`functions/index.js`、`SystemMaintenance.jsx`、`AnnualView.jsx`、相關 View。

---

# 1. 為什麼有 Summary

本系統同時需要：

- 當月即時性
- 歷史月份正確性
- 降低 Firestore reads
- Dashboard / Telegram / Annual 共用可信的月結資料

因此正式架構不是「所有月份都直接撈 daily_reports」，而是：

```text
當月
→ 即時 Raw / detail 優先

歷史月份
→ verified Summary 優先
→ 不可信時 fallback
```

---

# 2. 主要資料元件

核心 collections：

```text
daily_reports
therapist_daily_reports

monthly_aggregated
therapist_monthly_aggregated

monthly_targets
monthly_targets_summary

dashboard_summary
rankings_summary
therapist_summary

summary_recalc_flags
recalc_queue
summary_worker_state
```

---

# 3. 當月 Dashboard

## 店家

當月屬於即時戰情。

設計原則：

```text
daily_reports
→ 目前月份 detail / exact scoped data
→ Dashboard 計算
```

不應因為存在歷史 Summary 架構，就把當月切成 stale Summary。

Telegram backend 也使用相同概念：

```text
當月 daily_reports exact
若真的讀不到 → monthly_aggregated fallback
```

---

## 管理師

當月人員績效同樣保留即時 detail。

`useDashboardStats.js` 明確禁止當月使用 historical therapist summary，
避免晚上陸續回報後：

```text
今日戰神
排行榜
人員 KPI
```

不即時更新。

---

# 4. 歷史月份 Dashboard

歷史月份的目標是：

```text
可信 Summary
+
低 reads
```

因此只有當 Summary 被判定為 trusted 才使用。

---

# 5. Summary Trust State

Dashboard 會組合：

```text
dashboard_summary
therapist_summary
rankings_summary
summary_recalc_flags
recalc_queue
maintenance compare logs
```

判斷狀態。

主要 statusKey：

```text
missing
current_dirty
dirty
unverified
verified
mismatch
```

---

# 6. `summary_recalc_flags`

歷史月 Summary 信任狀態的核心。

目前正式前端可確認：

```text
flagStatus
flagMismatchCount
flagCompletedAtText
dirty
rebuildAfterAtText
lastDirtyAtText
```

### Verified

目前條件核心為：

```text
status = completed / verified
dirty != true
mismatch = 0
```

只要 backend auto repair worker 已把 flag 寫回 verified，
Dashboard 就應恢復 Summary。

### 重要設計

以前 compare maintenance log 可能成為額外阻擋條件。

目前正式修正已明確：

> backend flag verified 足以讓 Dashboard 回到可信 Summary，  
> 不應因為舊 maintenance compare log 時間而一直卡在 detail fallback。

---

# 7. Dirty 如何產生

正式 backend 對：

```text
daily_reports
therapist_daily_reports
```

的 onWrite 同時：

1. 更新 monthly aggregation。
2. 檢查是否是會影響 Summary 的 meaningful change。
3. 標記歷史月份 dirty / 建立重算工作。

HistoryView 已不再自己建立隨機 queue。

---

# 8. Dirty Debounce

目前 backend：

```text
SUMMARY_DIRTY_DEBOUNCE_MINUTES = 1
```

目的：

如果同一歷史月份短時間連續被多筆修改，
先給一小段 debounce，再集中重建，而不是每筆修改立即完整重算。

---

# 9. `recalc_queue` 的角色

目前正式註解明確區分：

```text
summary_recalc_flags
= 正常歷史異動的主要修復訊號

recalc_queue fallback
= 防漏保險
```

因此看到 queue 不代表：

```text
每次 repair 都必須全掃 queue
```

---

# 10. Queue Fallback 節流

正式 worker：

```text
steady：
每 30 分鐘
每頁 50 筆 pending

backlog：
若還有下一頁
暫時每 5 分鐘續頁
```

查詢另多取 1 筆確認是否有下一頁。

Worker state：

```text
summary_worker_state/recalc_queue_fallback_scan
```

記住：

```text
cursorDocId
nextRunAfterMs
scanMode
lastPageSize
```

避免每次都掃同一批前 50 筆。

---

# 11. Auto Repair

正式 backend 有：

```text
repairDirtySummaryNow
repairDirtySummaries
```

以及自動排程 worker。

`repairDirtySummaries` 的核心工作是處理到時間的 historical dirty months。

成功後：

```text
rebuild Summary
compare / verify
flag → verified
dirty → false
mismatch → 0
```

前端 Dashboard status listener 會因此重新切回 Summary。

---

# 12. Historical Fallback 順序

概念上：

```text
歷史月份
   │
   ├─ summary verified?
   │       │
   │       YES
   │       ▼
   │  dashboard_summary
   │
   └─ NO
           ▼
     monthly_aggregated
           │
           └─ 若仍缺
                  ▼
             scoped raw daily_reports
```

Telegram backend 已明確實作這個安全路徑：

```text
verified_dashboard_summary
→ monthly_aggregated + target fallback
→ daily_reports_month_fallback
```

這個架構的意義：

> 「Summary 不可信」不是畫面顯示 0，也不是硬吃 stale Summary，  
> 而是退回較昂貴但較可信的來源。

---

# 13. Dashboard 前端 Summary Status

`DashboardHeader` 會把資料來源轉成使用者可理解狀態。

至少有：

```text
本月即時明細
已整理 Summary
資料來源檢查中
fallback / warning
```

目的不是只顯示技術狀態，而是讓主管知道現在看的數字來源。

---

# 14. Target Summary

Dashboard 不應常駐監聽全年完整 `monthly_targets`。

App 已把完整 monthly targets 限制在：

```text
activeView === targets
或
Audit 的 target mode
```

Dashboard / Ranking / Annual 優先：

```text
monthly_targets_summary
dashboard_summary target info
```

---

# 15. Target Summary 完整性

有 `monthly_targets_summary` 不代表可以直接使用。

目前 backend：

1. 取得正式店家 roster。
2. 對逐店有效 target 做 coverage。
3. coverage 完整才接受。
4. 不完整就 fallback。

若無 roster，才可能以 totals 做較弱的 fallback。

---

# 16. Target Fallback

目前 Telegram backend target 解析順序：

```text
monthly_targets_summary stores
   ↓ incomplete
dashboard_summary targets
   ↓ incomplete
monthly_targets full fallback
```

Dashboard 前端另外有 targeted fallback，
避免只因一、兩家缺 Summary target 就讀完整年度大量 targets。

`VALID_ZERO` 是 present/configured，不得因此開啟 fallback。
`AUTHORITY_CONFLICT` 是 terminal fail-closed authority state，也不得透過 fallback 復活衝突來源。

---

# 17. 「0 目標」是 configured target；denominator=0 時 achievement=N/A

Batch 5E-1B 正式語意：

```text
0                  → VALID_ZERO / configured
positive           → VALID / configured
blank/null/missing → TARGET_NOT_SET
negative/malformed → DATA_INVALID
```

Lifecycle eligible store 的 explicit 0 可計入 target coverage。
若整個 selected scope 的 configured target total = 0：

```text
coverage = complete
target total = 0 / VALID_ZERO
achievement = N_A
```

不得顯示為 0%、Infinity 或「目標未設定」。

zero-target store 不具 achievement ranking eligibility，也不進 progress-gap attention。

過去 canonical / legacy duplicate 問題的根因是 Identity authority，不是「0 不能是 target」：

```text
canonical source > legacy alias
canonical explicit 0 cannot be replaced by legacy positive
```

若兩個 canonical-equivalent authoritative sources KPI 語意衝突：

```text
AUTHORITY_CONFLICT
→ denominator unavailable
→ Coverage incomplete
→ no updatedAt / score / document-id winner
→ fallback cannot clear conflict
```

---

# 18. Summary Store Identity

`useDashboardStats.js` 對 Summary store row 的解析有額外保護：

若 `stores` 是 map：

```text
map key
```

可能比 row 內：

```text
store
storeName
```

更可靠。

原因是歷史資料可能發生：

```text
key = 新店 / CYJ新店店
row.store = 新
```

因此 Summary normalization 不能只相信單一顯示欄位。

---

# 19. Store Identity 與 Summary

CYJ 新店：

```text
core = 新店
canonical = CYJ新店店
```

正式寫入：

```text
monthly_targets       → canonical
monthly_aggregated    → canonical
monthly_targets_summary → canonical
```

歷史 Raw：

```text
daily_reports
```

不批次改名。

因此 Summary build / fallback 必須 normalize aliases。

---

# 20. Ranking Summary

歷史排名資料也屬 derived data。

Backend dirty guard 的目的之一：

當歷史日報變更時，不能留下：

```text
dashboard_summary verified
therapist_summary verified
rankings_summary verified
```

但實際 Raw 已不同。

---

# 21. Historical Delegation Scope

歷史 verified Summary 並不代表忽略目前存取範圍。

`useDashboardStats.js` 對 store manager / delegated multi-store：

```text
effectiveStores
```

仍會套用在 historical Summary ranking / display scope。

---

# 22. Annual Data

AnnualView 使用：

```text
annualAggregatedData
annualDashboardSummaries
annualSummaryStatusMap
```

歷史已驗證月份以 Summary 為可信口徑。

本月／未整理月份可有 aggregation fallback。

---

# 23. `annual_kpi_summary`

與 AnnualView 年度實績不同，`annual_kpi_summary` 是年度 KPI benchmark 資料。

Backend build：

```text
completed month dashboard_summary
→ established store / averages
→ annual_kpi_summary/{year}
```

缺少 dashboard summary 的月份會 skip，
不會自行猜出一個月的 benchmark。

---

# 24. Maintenance 與 Summary

SystemMaintenance 提供：

```text
Summary status
Summary rebuild
Summary compare
月結前檢查
月份報表整理
recalc queue
target summary rebuild
Core Consistency Audit
```

### 月結標準思路

```text
健康檢查
→ 缺報 / 異常確認
→ pending / queue 確認
→ 月份整理 / 校準
→ Summary compare
→ verified
```

---

# 25. Core Consistency Audit

它不是 Summary worker。

定位是：

```text
Audit Only
```

跨來源檢查：

```text
monthly_targets
monthly_aggregated
daily_reports
therapist_daily_reports
therapist_monthly_aggregated
therapists
org_structure
monthly_targets_summary
```

可跑：

```text
單月
全年
```

全年會大量讀取，不適合高頻執行。

---

# 26. 當數字怪怪時的診斷順序

不要直接修改 Dashboard component。

先判斷：

```text
1. 目前月份還是歷史月份？
2. DashboardHeader 顯示哪個 data source？
3. summary_recalc_flags 狀態？
4. pending queue 是否存在？
5. dashboard_summary 是否存在？
6. monthly_aggregated 是否完整？
7. Raw daily_reports 是否正確？
8. target Summary 是否完整？
9. Store Identity 是否拆成 alias？
10. 最後才檢查 useDashboardStats / view filter
```

---

# 27. 禁止事項

未確認根因前，不應：

- 為單一店家硬寫 Summary 數字。
- 把 dirty Summary 強制視為 verified。
- 因為 Summary 缺一店，就永遠讀完整年度 targets。
- 把當月 therapist Summary 當作即時人員排行榜。
- 直接修改歷史 Raw 店名來讓 Summary 對上。
- 看到 queue backlog 就改成高頻全表掃描。
- 看到 aggregate split 就直接把兩份 aggregate 相加。

---

# 28. 修改此架構時的最低檢查

如果改：

```text
useDashboardStats.js
functions/index.js
SystemMaintenance.jsx
TargetView.jsx
```

至少執行：

```bash
npm run build
node --check functions/index.js
node --test tests/storeIdentity.test.js
```

若只改前端，backend check 可依實際變更範圍省略。

重大 Summary 行為改變後，應用 Maintenance：

```text
Summary status
Core Consistency Audit
```

做部署後驗證。

---

# Production Update 2026-08-24：品牌正式資料起始月保護

## 問題

`repairDirtySummaries` 會每 5 分鐘巡檢 historical dirty / pending months。

已確認案例：

```text
yibo / 2026-01
yibo / 2026-02
yibo / 2026-03
```

伊啵在上述月份尚未正式使用本系統，因此：

```text
daily_reports = 0
```

是正常的「系統啟用前月份」，不是 Raw 資料遺失。

舊流程會：

```text
dirty flag
→ Summary repair
→ monthly_targets_summary coverage 不完整
→ full monthly_targets fallback
→ daily_reports = 0
→ 安全中止
→ flag 回到 dirty
→ 5 分鐘後再次重試
```

造成無效重試與大量 Firestore reads。

## 正式治理規則

目前自動 Summary Repair 增加品牌資料起始下限：

```text
yibo:
dataStartMonth = 2026-04
```

意義：

```text
yearMonth < dataStartMonth
→ ignored_pre_system_month
→ dirty = false
→ pendingCount = 0
→ 不建立 0 業績 verified Summary
→ 不進 monthly_targets full fallback
```

這不是品牌成立日期，也不是年度 KPI 平均值起算設定，而是：

> Summary 自動修復可處理歷史資料的安全下限。

目前只設定已由正式營運事實確認的伊啵案例；其他品牌維持既有行為。

## 安全性

原有 Raw=0 防護仍保留。

因此：

```text
伊啵 2026-01～03
→ pre-system month → ignore

伊啵 2026-04 之後
→ 若已有店家／目標但 daily_reports = 0
→ 仍中止 Summary rebuild 並報錯
```

不可把所有「0 Raw」都視為正常月份。

## Flag / Queue

`summary_recalc_flags`：

```text
status: ignored_pre_system_month
cleanupReason: before_brand_data_start_month
dirty: false
pendingCount: 0
```

`recalc_queue` fallback 掃描到相同月份時：

```text
status: ignored_pre_system_month
```

並且不再建立 repair job。

`force=true` 的人工診斷入口仍可強制執行。

## Production Validation

2026-08-24 已完成較長時間 Production observation：

```text
12:12～13:30（UTC+8）
約 77 分 54 秒
16 個連續 repairDirtySummaries 週期
16 / 16 無到期 dirty / pending
16 / 16 HTTP 200
2026-01～03 不再進 repair job
monthly_targets full fallback warning = 0
Summary repair failure = 0
ERROR / CRITICAL = 0
```

觀察時間已超過兩個 30 分鐘 queue fallback steady interval，未觀察到 queue fallback 將 pre-system months 重新帶回 repair loop。

Final status：

```text
PRODUCTION VERIFIED
INCIDENT CLOSED
```



---

# 29. Summary Semantics v1 — Batch 4

Batch 4 的責任是先把歷史 Summary authority 寫出明確 formal semantics，**不是在本 Batch 就切換 Dashboard consumer**。因此採 additive migration：

```text
legacy Summary fields retained
+
semanticVersion = summary-semantics-v1
+
explicit formal fields/status
```

## Writer parity

目前 `dashboard_summary / therapist_summary / rankings_summary` 同時可能由：

```text
Backend auto repair
SystemMaintenance manual rebuild
```

寫入。兩條路徑都必須套用 `summarySemantics` contract；Maintenance rebuild 亦維持 `dashboard-summary-v2` 的 `storeDailyTotals`，避免手動工具把 Backend v2 欄位覆蓋掉。

## Target authority

Summary rebuild 先讀：

```text
monthly_targets_summary/{YYYY-MM}   1 doc
store_lifecycle/master              1 doc
```

只要 Target Summary 已具備 Batch 3 `target-coverage-v1` metadata，即使 Cash 或 Accrual coverage 為 incomplete，也把它視為有效的「不完整狀態」，不因 incomplete 而掃完整 `monthly_targets`。

只有 Target Summary 缺失、不可讀或缺舊 schema compatibility 所需的 coverage contract 時，才允許 raw target compatibility fallback。

## Formal fields

Brand / Store Summary 額外保存：

```text
grossCash
formalNetCash
formalNetCashStatus

totalAccrual
formalAccrual
formalAccrualStatus
formalAccrualSource

formalCashTarget / formalCashAchievement
formalAccrualTarget / formalAccrualAchievement
```

安妞的 `totalAccrual` 與 `formalAccrual=operationalAccrual` 不再共用一個 ambiguous field。

## Ranking

Legacy `storeRankings` 暫時不變；新增 `formalStoreRankings` 依 formal cash achievement 排序。Batch 5 consumer 才切換讀取。

## Trust compare

Summary rebuild 後必須：

```text
write dashboard + therapist + rankings Summary
↓
read back all 3 persisted docs
↓
compare with Raw-calculated fresh payload
↓
match 才可 verified
```

Compare 至少涵蓋 scope formal metrics/status、Lifecycle/target coverage、store-level semantic signature、formal ranking signature 與既有 source counts；不可 freshly-built self-compare。

## Read cost

不新增 listener / polling。每次低頻歷史 rebuild 新增的正常小型 point reads 主要是：

```text
+1 store_lifecycle/master
+3 persisted Summary readback for trust compare
```

Target normal path由可能的 full `monthly_targets` scan 改為 1-doc Target Summary；因此合法 target-incomplete month 不再產生全 Target collection fallback reads。
