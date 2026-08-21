# CURRENT_STATE.md

> 用途：記錄「目前正式環境已確認到哪個狀態」。  
> 這不是 CHANGELOG，也不是開發歷史。  
> 只有可由目前正式 source、使用者明確確認或實際驗證支持的資訊才能填入。  
> 無法確認時寫「未由目前正式來源確認」，不得靠 AI 記憶補值。  
> Last state update: 2026-08-21 15:09 (UTC+8)

---

# 1. Production Source Snapshot

```text
Baseline source snapshot:
2026-08-18

Latest verified production change:
2026-08-21

Source basis:
Knowledge Base 的系統基線來自使用者於建立過程提供、
並明確指定為「目前正常部署版本」的正式程式檔案。

2026-08-21 另外由使用者重新提供當時實際上線版本：
- src/App.jsx
- src/components/RankingView.jsx
- src/components/RegionalView.jsx

上述三支完成「本月 Ranking / Regional 即時資料來源」修正後，
使用者已完成正式前端部署。
```

---

# 2. Frontend

目前正式 source 可確認：

```text
Framework:
React + Vite

CURRENT_APP_VERSION:
3.4.2

Frontend package deploy script:
npm run deploy
→ npm run build
→ gh-pages -d dist
```

### Production URL / Runtime Health

```text
Production runtime health:
2026-08-21 使用者已完成 v3.4.2 前端部署。

正式驗證：
✅ 詳細報表 / Ranking 本月資料已恢復即時更新
✅ CYJ 士林店原先停留在舊數字的問題已排除
✅ 士林店部署後顯示已由使用者確認正確

Regional 同源修正：
✅ 修正已隨 v3.4.2 一併部署
⚠️ 本次尚未另外收到「區域分析」畫面數字的獨立驗證回報

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
2026-08-21 已完成前端資料來源偏差修正。

問題：
Ranking / Regional 在本月只要 dashboard_summary 存在，
就可能優先使用 stale Summary，導致本月資料停在較早時間點。

v3.4.2 修正：
- App.jsx：本月 Ranking / Regional 強制允許 daily_reports 即時監聽
- RankingView.jsx：本月不再使用 dashboard_summary 取代即時明細
- RegionalView.jsx：本月不再以 dashboard_summary 作營運實績來源
- 歷史月份仍維持 Summary-first

Production verification：
✅ Ranking / 詳細報表：CYJ 士林店已確認恢復正確即時數字
⚠️ Regional / 區域分析：修正已部署，但本次尚未收到獨立畫面驗證回報

本次未重新執行歷史月份 Summary compare，
因修正內容是「本月即時來源選擇」，不是歷史 Summary rebuild。
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

目前 Production code：

```text
v3.4.2 已部署。
Ranking 本月即時資料修正已由使用者驗證成功。
```

目前仍待專案治理收尾：

```text
- 將本次更新後的 CURRENT_STATE.md commit / push 至 repository
- 若採用 Production Tag，可在確認 commit 後建立 v3.4.2 對應 tag
- 區域分析可於方便時再做一次畫面層確認
```

本次不需要：

```text
Firebase Functions deploy
Firestore Rules deploy
歷史 Summary rebuild
```

---

# 13. Known Issues

目前已確認：

```text
2026-08-21「詳細報表本月停留舊 Summary」問題：
✅ 已修復
✅ 已部署
✅ CYJ 士林店已由使用者驗證正確
```

尚未列為正式 Known Issue：

```text
Regional 同源修正已部署，但本次尚未取得獨立畫面驗證回報。
這不代表已知仍有錯誤，只代表 runtime verification 尚未單獨完成。
```

除此之外：

```text
沒有由本次正式 source / 使用者明確提供的新未解 Known Issue。
```

---

# 14. Validation Status for This Production Update

本次正式功能修正：

```text
Frontend:
v3.4.2

Changed:
- src/App.jsx
- src/components/RankingView.jsx
- src/components/RegionalView.jsx

Backend:
未修改

Firestore Rules:
未修改
```

驗證狀態：

```text
✅ 修正檔語法 / 邏輯檢查已完成
✅ Frontend 已完成正式部署
✅ 詳細報表 CYJ 士林店數字已由使用者確認正確
⚠️ 區域分析尚未收到獨立畫面驗證回報
```

Knowledge Base Impact Check：

```text
README.md                    不需更新
ARCHITECTURE.md              不需更新
SYSTEM_SOURCE_MAP.md         不需更新
DEVELOPMENT_GUIDE.md         不需更新
DEPLOYMENT.md                不需更新

docs/FIREBASE_DATA_MODEL.md  不需更新
docs/DASHBOARD_SUMMARY.md    不需更新
docs/DATA_FLOW.md            不需更新
docs/AUTH_AND_SECURITY.md    不需更新
docs/TELEGRAM_AGENT.md       不需更新
docs/MAINTENANCE_TOOLS.md    不需更新

DATA_IDENTITY_RULES.md       不需更新
AI_START_HERE.md             不需更新

CURRENT_STATE.md             ✅ 本次已更新
```

理由：

```text
Knowledge Base 原本就定義：
本月 → 即時 detail
歷史 → verified Summary-first

本次是把偏離此既定架構的前端程式修回正確行為，
不是變更系統架構本身。
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
