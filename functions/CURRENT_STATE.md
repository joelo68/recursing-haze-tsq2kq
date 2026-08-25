# CURRENT_STATE.md

> 用途：記錄「目前正式環境已確認到哪個狀態」。  
> 這不是 CHANGELOG，也不是開發歷史。  
> 只有可由目前正式 source、使用者明確確認或實際驗證支持的資訊才能填入。  
> 無法確認時寫「未由目前正式來源確認」，不得靠 AI 記憶補值。

---

# 1. Production Source Snapshot

```text
Source snapshot date:
2026-08-18

Source basis:
使用者於本次 Project Knowledge Base 建立過程提供，
並明確指定為「目前正常部署版本」的正式程式檔案。
```

---

# 2. Frontend

目前正式 source 可確認：

```text
Framework:
React + Vite

CURRENT_APP_VERSION:
3.4.1

Frontend package deploy script:
npm run deploy
→ npm run build
→ gh-pages -d dist
```

### Production URL / Runtime Health

```text
Production runtime health:
本次建立 CURRENT_STATE.md 時未重新進行線上 runtime 驗證。

Git commit:
未由目前正式來源確認。

Production Git tag:
目前尚未建立 / 未由正式來源確認。
```

---

# 3. Firebase / Backend

目前正式 source 可確認：

```text
Firebase projectId:
cyjsituation-analysis

Functions runtime:
Node.js 22
```

目前 Knowledge Base 已解析正式 `functions/index.js` 與：

```text
functions/telegram/prompts.js
```

### Backend Deployment State

```text
目前程式版本：
使用者指定為目前正常部署版本。

最後一次 backend deploy 的 Git commit:
未由目前正式來源確認。

最後一次 backend deploy 時間:
未由目前正式來源確認。
```

---

# 4. Current Architecture State

目前正式架構文件已確認：

```text
✅ React / Vite entry
✅ App orchestration
✅ 三品牌 Firestore path
✅ Dashboard / Summary
✅ Store / Therapist Raw data flow
✅ Target / Store Identity
✅ Historical dirty / repair flow
✅ Delegation
✅ Login / Device Security
✅ SystemMaintenance
✅ Read Tracker
✅ Telegram Agent
✅ Policy / Schedule / Snapshot / Task
✅ Firestore Rules current boundary
```

---

# 5. Store Identity State

目前正式治理：

```text
coreStoreName      = 新店
canonicalStoreName = CYJ新店店
```

正式保護：

```text
✅ DATA_IDENTITY_RULES.md
✅ tests/storeIdentity.test.js
✅ TargetView canonical write
✅ legacy read fallback
✅ backend monthly aggregation canonical guard
✅ SystemMaintenance Core Consistency Audit
```

### Runtime validation

```text
本次新增 AI_START_HERE / CURRENT_STATE 為 docs-only 變更，
未重新執行正式環境 Core Consistency Audit。
```

---

# 6. Dashboard Summary State

目前正式架構：

```text
當月：
即時 detail 優先

歷史：
verified Summary 優先
dirty / mismatch / unverified → fallback
```

Backend：

```text
summary_recalc_flags = 正常 historical repair 主訊號
recalc_queue = fallback / 防漏保險
```

### Runtime validation

```text
本次文件更新未重新對 production 執行 Summary compare。
目前只記錄正式 source 所定義的架構。
```

---

# 7. Authentication / Security State

目前正式 source 可確認：

```text
Low-power default:
30 分鐘

Auto logout default:
240 分鐘

Auto logout exempt:
director / master（另受 security_config 設定影響）

Device auto-trust limit:
2
```

Firestore Rules 現況：

```text
request.auth != null
```

並針對：

```text
management_delegations
system_logs
```

有額外保護。

### Security architecture note

```text
目前不是完整 server-side role / Custom Claims authorization。
```

---

# 8. Telegram Agent State

目前正式 source 可確認：

```text
Agent version:
drcyj-agent-v5.0-snapshot-schedule-task-loop

Primary model:
gemini-3.7-flash

Primary API:
v1beta/interactions

Fallback model:
gemini-3.6-flash

Fallback API:
v1/interactions

Max tool calls:
3

Max reads:
2500

Memory turns:
8
```

Source Authority：

```text
Store KPI:
daily_reports

Therapist KPI:
therapist_daily_reports

Cross-source inference:
禁止
```

### Runtime validation

```text
本次文件更新沒有重新發 Telegram test message。
```

---

# 9. Maintenance State

目前正式 `SystemMaintenance.jsx` 可確認：

```text
✅ 日常檢查
✅ 月結前檢查
✅ 資料健康檢查
✅ Summary 維護
✅ Recalc Queue
✅ 備份 / 組織快照
✅ Read Tracker
✅ 高風險資料處理區
✅ Core Consistency Audit
```

Core Consistency：

```text
Audit Only
支援單月 / 全年
```

一次性 CYJ 新店 repair UI：

```text
不應存在於目前正式永久工具。
```

---

# 10. Repository Governance State

Project Knowledge Base：

```text
✅ README.md
✅ ARCHITECTURE.md
✅ DEVELOPMENT_GUIDE.md
✅ DEPLOYMENT.md
✅ SYSTEM_SOURCE_MAP.md
✅ DATA_IDENTITY_RULES.md
✅ AI_START_HERE.md
✅ CURRENT_STATE.md
```

第二層：

```text
✅ docs/FIREBASE_DATA_MODEL.md
✅ docs/DASHBOARD_SUMMARY.md
✅ docs/AUTH_AND_SECURITY.md
✅ docs/TELEGRAM_AGENT.md
✅ docs/MAINTENANCE_TOOLS.md
✅ docs/DATA_FLOW.md
```

Regression：

```text
✅ tests/storeIdentity.test.js
```

---

# 11. Repository Items Not Confirmed

目前使用者已確認專案沒有看到：

```text
.firebaserc
firestore.indexes.json
.github/workflows
```

因此目前不假設：

```text
Firebase CLI alias 已 repository-managed
Composite Index 已 repository-managed
GitHub Actions 自動部署存在
```

---

# 12. Pending Changes

目前：

```text
Project Knowledge Base v3 文件建立完成。
```

這是：

```text
docs-only change
```

因此：

```text
不需要 Firebase Functions deploy
不需要 frontend runtime deploy
```

需要做的是：

```text
將 Knowledge Base v3 放入 repository
Git commit
Git push
```

---

# 13. Known Issues

目前：

```text
沒有由本次正式 source / 使用者明確提供的新 Known Issue。
```

如果系統有已知未解問題，
必須由使用者明確確認後才加入本節。

---

# 14. Validation Status for This Documentation Change

本次改動只新增／更新 Markdown 與 Knowledge Base metadata。

因此 runtime validation：

```text
Frontend build:
不是本次文件變更的必要條件

Functions syntax:
不是本次文件變更的必要條件

Firebase deploy:
不需要

Frontend deploy:
不需要
```

Knowledge Base 本身：

```text
✅ 文件結構建立
✅ Manifest 更新
✅ Security redaction scan
✅ 內容基本完整性檢查
```

---

# 15. Next Production Update Procedure

下一次正式程式修改完成後：

```text
1. Build / Syntax
2. Regression Test
3. 功能驗證
4. Knowledge Base Impact Check
5. 更新受影響的 .md
6. 更新 CURRENT_STATE.md
7. Git commit
8. Deploy
9. 部署後驗證
10. 建立 Production Tag（若採用）
```

---

# 16. 建議 Production Tag Format

若開始採用 tag：

```text
prod-YYYY-MM-DD-v{appVersion}
```

例如：

```text
prod-2026-08-18-v3.4.1
```

若同一天多次部署：

```text
prod-YYYY-MM-DD-HHmm
```

實際建立 tag 前，
應先確認該 commit 的 production deploy 已成功。

---

# 17. 本文件更新原則

只在以下情況更新：

```text
正式 deployment
production source snapshot 改變
app version 改變
backend function architecture 改變
重大功能驗證完成
新增 known issue
issue resolved
Production Tag 建立
Knowledge Base 版本更新
```

純討論、未部署實驗、未確認草稿：

```text
不要寫成 production state
```
