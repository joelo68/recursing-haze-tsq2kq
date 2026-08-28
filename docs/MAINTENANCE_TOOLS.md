# MAINTENANCE_TOOLS.md

> 本文件描述目前正式 `SystemMaintenance.jsx` 的用途、資料影響、風險分級與操作順序。  
> 維護中心不是「看到問題就全部按一次」的工具箱。

---

# 1. 維護中心定位

正式 `SystemMaintenance.jsx` 同時負責：

- 日常健康檢查
- 月結前檢查
- Summary 維護
- Queue / pending 檢查
- Core Consistency Audit
- 備份／快照
- 日期／重複資料處理
- Firestore reads 監控
- 資料量觀察
- 年度 Target Summary 過渡整理

因此修改這支檔案時，要先判斷：

```text
Audit / Read-only
Rebuild / Derived data
Raw mutation
Restore
Traffic observation
```

是哪一類。

---

# 2. Guided Scenarios

目前正式情境：

```text
daily
closing
issue
backup
traffic
```

UI label：

```text
日常檢查
月結前作業
資料異常
備份與快照
流量監控
```

---

# 3. 日常檢查

目標：

```text
確認本月資料、排除店家、待重算狀態是否正常
```

適用：

- 平常巡檢
- 主管覺得數字怪
- 大量補報後

特性：

```text
只讀取檢查資料
不修改 Raw 日報
```

建議順序：

```text
資料健康檢查
→ 有異常再看明細
→ 本月 pending 若是無效待辦再整理
```

---

# 4. 月結前作業

目標：

```text
把補報 / 修正後資料整理成可月結狀態
```

適用：

- 月底
- 月初關帳
- 最終月報確認

Guided flow 目前會：

```text
closing check
health check
recalc queue
Dashboard Summary status
```

再依狀態判斷：

```text
可以月結
需注意
不建議月結
```

---

# 5. 月結前主要判斷

至少包含：

```text
缺少店日報
健康檢查 danger / warning
pending queue
Summary status
```

有高風險問題：

```text
先處理
→ 再校準
```

不要反過來用校準掩蓋 Raw 資料異常。

---

# 6. 資料健康檢查

用途：

```text
找出資料本身異常
```

結果會依風險分：

```text
danger
warning
success / normal
```

並可展開：

```text
collection
date
store
therapist
reason
fields
document ID
```

先看明細，再決定是否需要 repair。

---

# 7. 資料異常情境

Guided `issue` flow：

```text
health check
recalc queue
archived duplicates
```

結果包含：

```text
異常類型
高風險數
需注意數
待校準數
```

下一步原則：

```text
先修資料
→ 再做單月校準
```

---

# 8. Core Consistency Audit

正式工具：

```text
核心資料一致性健檢
```

定位：

```text
Audit Only
```

它不等於 repair button。

---

# 9. Core Audit Sources

目前正式會讀：

```text
org_structure
monthly_targets
monthly_aggregated
daily_reports
therapist_daily_reports
therapist_monthly_aggregated
therapists
monthly_targets_summary
```

---

# 10. Core Audit Scope

支援：

```text
month
year
```

全年：

```text
1–12 月
```

會一次讀大量店家／管理師日報並逐月比較 target summary。

UI 明確提醒：

> 適合資料治理或人工檢查，不建議高頻執行。

---

# 11. Core Audit Output

Report 至少記：

```text
scope
range
year / month
status
scanned
conflicts
warnings
safeDuplicates
summaryMismatches
issues
sourceCounts
auditOnly = true
```

並寫：

```text
maintenance_logs
type = core_data_consistency_audit
```

---

# 12. Duplicate 分類

Target duplicate 至少分：

```text
duplicate_zero
duplicate_safe
duplicate_identical
conflict
```

---

# 13. Conflict 原則

若同一門市／月份：

```text
兩份以上不同的有效目標
```

則：

```text
severity = danger
```

正式 recommendation：

> 禁止自動合併或相加，必須人工確認正式值。

這個原則不能被後續「一鍵修復」改掉。

---

# 14. Safe Duplicate

如果：

```text
一份有效 target
+
一份全 0 legacy duplicate
```

可被標成：

```text
duplicate_safe
```

但 Audit 本身仍不修改。

---

# 15. Store Identity Incident Repair

一次性的 CYJ 新店歷史 V2 repair tool：

```text
不應長期存在正式 UI
```

現在保留的是：

```text
Audit
Canonical Guard
Regression Test
Governance Document
```

---

# 16. Summary Status

Maintenance 可查：

```text
Dashboard Summary status
```

目的：

- Summary 是否存在
- 是否 dirty
- 是否 verified
- 是否 mismatch
- pending 狀態

它是診斷工具，不是直接改 Raw。

---

# 17. Summary Build / Compare

月結／歷史整理可有：

```text
Summary rebuild
Summary compare with Raw
```

正確順序：

```text
先確認 Raw 健康
→ build/rebuild
→ compare
→ verified
```

---

# 18. Recalc Queue

Maintenance 可：

```text
載入待校準 queue
整理無效 pending
```

但 backend 現況：

```text
summary_recalc_flags 是正常 auto repair 主訊號
queue fallback 是保險
```

所以不要把 queue 頁面當成唯一 Summary health indicator。

---

# 19. 月度數據重新校準

用途：

```text
指定月份重新掃 Raw
→ 修正月彙總
```

適合：

- 數字對帳
- 月結 aggregate 異常
- Raw 正確但 aggregate 不一致

不適合：

```text
Raw 本身還錯
```

---

# 20. CYJ 新店 aggregate

Backend recalibration 已使用與即時 aggregate 相同 canonical 規則。

CYJ 新店：

```text
YYYY-MM_CYJ新店店
```

不要再用 Maintenance 手動把兩個 aggregate 直接相加。

---

# 21. Target Summary 年度整理

Maintenance 目前有過渡工具：

```text
補整理年度目標 Summary
```

會：

```text
monthly_targets
→ 1–12 月 monthly_targets_summary
```

不修改原始 target。

UI 也明確把它標為「過渡工具」。

---

# 22. Organization Snapshot

維護中心可載入：

```text
org_structure_snapshots
```

用途：

- 區長架構大改前後
- 誤改
- 救援

---

# 23. Restore Organization Snapshot

這是高風險 mutation。

正式流程：

```text
選 snapshot
→ 二次確認
→ 先讀目前 org_structure
→ 自動建立 before_restore snapshot
→ 覆蓋 org_structure.managers
→ 寫 maintenance log
```

因此即使 restore 本身出錯，
也有還原前 snapshot 可以追。

---

# 24. Backup Records

Backup 情境：

```text
載入 backup records
載入 org snapshots
```

預設只是讀取。

真正 restore：

```text
需二次確認
```

---

# 25. High-risk Area

Maintenance UI 有：

```text
Protected Area / 高風險資料處理
```

用來集中：

- 還原
- 封存
- 批次修復

沒有明確異常時，不應隨便操作。

---

# 26. 日期格式修復

正式設計是兩階段：

```text
掃描
→ 預覽
→ 再決定批次修復
```

不是打開頁面就自動改日期。

掃描來源：

```text
daily_reports
therapist_daily_reports
```

---

# 27. Archived Duplicates

Maintenance 可載入封存／重複資料，
用於異常修復與還原。

在不了解 Raw / logical key 前，
不要只因看到 duplicate 就刪掉。

---

# 28. Read Tracker

正式 utility：

```text
readTracker.js
```

模式：

```text
off
local
global
```

---

# 29. Local Read Tracking

本機模式：

```text
localStorage
```

追蹤：

```text
source
docs
triggers
lastAt
hourlyBuckets
```

不必為了每次分析都寫 Firestore。

---

# 30. Global Read Tracking

Global mode 可 flush 到 Firestore。

Maintenance 可手動：

```text
立即上報
```

或使用排程。

---

# 31. Global Read Source Ranking

Maintenance 會把來源依：

```text
docs
```

排序，並顯示：

```text
觸發次數
平均 docs / 次
總 docs
```

使用時先看前幾名，再判斷：

```text
必要即時成本
or
低頻但可優化的重複讀取
```

---

# 32. Hourly Buckets

新版 global tracking 有：

```text
hourlyBuckets
```

因此可以指定時段分析：

```text
某日 04:00–05:00
晚間尖峰
跨夜區間
```

---

# 33. Read Range Limit

Maintenance UI 限制指定時段：

```text
最多 7 天
```

避免為了查監控本身又產生大量讀取。

---

# 34. 舊版 Read Session

舊版：

```text
沒有 hourlyBuckets
```

Maintenance 若遇到：

```text
精準時段沒有 bucket
但舊 session 有資料
```

會 fallback：

```text
用 session 時間做粗略彙整
```

UI 會明確標記：

```text
舊版粗略
```

不能把它當精準小時分析。

---

# 35. 流量監控情境

Guided `traffic`：

```text
載入 local stats
載入 global ranking
```

它本身：

```text
只讀取
不修改業務資料
```

---

# 36. 什麼時候使用 Read Tracker

適合：

- 改版後
- Firestore reads 費用異常
- 晚間流量爆量
- 懷疑某 listener 常駐
- 新節流策略驗證

不適合：

```text
長期 global mode 全開卻從不分析
```

---

# 37. 維護風險分級

## 低風險／唯讀

```text
日常 health
closing check
Summary status
Core Audit
backup list
snapshot list
read stats
data volume
```

## 中風險／Derived Data

```text
Summary rebuild
target Summary rebuild
monthly recalibration
cleanup invalid pending
```

## 高風險／Raw or Organization mutation

```text
日期批次修復
封存／還原
org restore
批次資料修復
```

---

# 38. 維護前必問四件事

```text
1. 目前要修 Raw 還是 Derived？
2. 有沒有 backup / snapshot？
3. 問題是單月還是全年？
4. 這個工具會不會改正式資料？
```

---

# 39. 出錯時的處理

Guided flow 本身的 error UI 已提醒：

```text
先不要重複操作
截圖錯誤
再檢查資料
```

這應保留。

不要因第一次失敗就連按 mutation button。

---

# 40. 維護中心不要變成巨型補丁場

新增工具前先問：

```text
這是一次性事故 repair？
還是永久治理能力？
```

一次性：

```text
完成修復後退場
```

永久：

```text
Audit
Health
Backup
Preventive Guard
Regression Test
```

才適合長留正式版。

---

# 41. 維護操作後的驗證

如果動到 Summary：

```text
Summary status
Raw compare
Dashboard data source
```

如果動到 Store Identity：

```bash
node --test tests/storeIdentity.test.js
```

再跑：

```text
Core Consistency Audit
```

如果動到 monthly aggregate：

```text
Raw vs aggregate
store count
canonical key
```

如果動到 org：

```text
manager order
store assignment
delegation
login scope
```

---

# 42. 修改 SystemMaintenance 本身

因檔案很大，改動前先定位實際 handler。

不要因名稱相似就改錯：

```text
Health
Closing
Summary
Consistency
Read Tracker
Backup
Advanced Tools
```

修改後：

```bash
npm run build
```

如果 Maintenance 調用的 backend function 也改：

```bash
node --check functions/index.js
```

---

# Production Update 2026-08-24：Summary Repair 防循環治理

## 背景

已確認伊啵 2026-01～03 尚未正式使用本系統。

舊 `summary_recalc_flags` 若殘留 dirty，
會讓 `repairDirtySummaries` 每 5 分鐘重新嘗試，
並在 build 前讀取完整年度 `monthly_targets` fallback。

## 現行處理

自動 worker 遇到品牌正式資料起始月份以前的 historical month：

```text
status = ignored_pre_system_month
cleanupReason = before_brand_data_start_month
dirty = false
pendingCount = 0
```

並清除舊 repair error / lock / rebuild debounce 狀態。

Queue fallback 掃描到同類 pending 文件時也會結案為：

```text
ignored_pre_system_month
```

而不是重新加入 repair job。

## 操作原則

看到：

```text
ignored_pre_system_month
```

不要手動重建該月份 Summary，除非已確認該品牌當時其實已有正式系統資料。

人工 HTTP repair 的 `force=true` 保留作診斷能力，
但不應用來把「尚未使用系統的月份」強制建立成 0 業績 Summary。

## 流量觀察

此次事故曾表現為：

```text
/brands/*/monthly_targets
每次完整讀取約 60 docs
```

根因不是 Telegram Agent，而是歷史 Summary Repair 的 pre-system month retry loop。

部署後應優先觀察：

```text
repairDirtySummaries logs
monthly_targets Query Insights
summary_recalc_flags
recalc_queue
```

而不是削弱當月 `daily_reports` 即時監聽。



---

# 43. Summary Build / Compare — Batch 4 Semantic Migration

Batch 4 後，SystemMaintenance 的 Summary rebuild 不再是獨立公式實作；它與 Backend repair 共用 parity-protected `summarySemantics` contract。

Manual rebuild Target source：

```text
monthly_targets_summary/{YYYY-MM}
+
store_lifecycle/master
```

若 Target Summary 已有 `target-coverage-v1`，Cash / Accrual incomplete 會原樣保留為正式不完整狀態，**不因 incomplete 而掃完整 `monthly_targets`**。只有 Summary 缺失／不可讀／缺 coverage schema 時才 compatibility raw fallback。

Maintenance writer 必須保留：

```text
version = dashboard-summary-v2
storeDailyTotals
legacy cash / accrual / rank
```

同時 additive 新增：

```text
semanticVersion = summary-semantics-v1
formal metrics/status
formalTargetAuthority
lifecycleSnapshot
formalStoreRankings
```

避免手動重建把 Backend v2 的每店每日 curve 刪掉。

## Persisted compare

「月份報表整理」與手動 Summary compare 都必須讀回 persisted 三文件：

```text
dashboard_summary/{YYYY-MM}
therapist_summary/{YYYY-MM}
rankings_summary/{YYYY-MM}
```

再與新的 Raw rebuild payload 比對；禁止 freshly-built object self-compare。

Compare 需涵蓋：

```text
legacy totals / source counts
formal net cash / total & formal accrual + status
formal target totals / independent coverage trust
Lifecycle snapshot
store-level semantic signature
formal ranking signature
```

## Risk / reads

仍屬中風險 Derived Data tool。沒有新增 polling 或 persistent listener。

每次 manual rebuild 相較舊流程，正常增加少量 point reads：Lifecycle master 1 doc + persisted 3 Summary readback；而 Target normal path 從 full target collection scan 改為單一 Target Summary doc。大量歷史重建仍應離峰、逐 brand/month 控制執行。
