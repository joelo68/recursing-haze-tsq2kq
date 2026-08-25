# docs/README.md

> Project Knowledge Base 正式索引。  
> 最後整併更新：2026-08-25（UTC+8）。  
> 任何情況下，「目前正式部署 source」都高於本文件；`CURRENT_STATE.md` 專門區分「已確認正式上線」、「已完成但尚待部署」與「正式上線後觀察中」。

# 1. 正式文件清單

| 文件 | 主要用途 |
|---|---|
| `PROJECT_OPERATING_RULES.md` | 永久不隨版本變動的 AI／工程協作規範 |
| `AI_START_HERE.md` | 新 AI／新工程師固定接手入口 |
| `CURRENT_STATE.md` | 目前正式環境狀態＋已完成／待部署／觀察中項目 |
| `ARCHITECTURE.md` | 高階系統架構與模組邊界 |
| `DEVELOPMENT_GUIDE.md` | 修改正式系統時不可破壞的開發規則 |
| `SYSTEM_SOURCE_MAP.md` | 每個功能實際由哪些 source files 負責 |
| `FIREBASE_DATA_MODEL.md` | Firestore logical model、path、Raw／Derived／Settings／Security |
| `DATA_FLOW.md` | 報表、Summary、登入、裝置安全、Telegram 的完整資料流 |
| `AUTH_AND_SECURITY.md` | Login、角色、強制改密碼、Low Power、自動登出、Trusted Device、Device Approval、Security Telegram |
| `DEPLOYMENT.md` | Build、GitHub Pages、Firebase Functions／Hosting／Rules 的部署邊界 |
| `DASHBOARD_SUMMARY.md` | 當月即時、歷史 verified Summary、repair、fallback |
| `DATA_IDENTITY_RULES.md` | Store Identity 治理，特別是 CYJ 新店 |
| `MAINTENANCE_TOOLS.md` | SystemMaintenance 工具、風險與操作順序 |
| `TELEGRAM_AGENT.md` | Telegram Agent／Gemini／Policy／Schedule／Snapshot／Task，以及獨立的登入安全 Telegram 流程 |
| `PROMPT_SETUP_GUIDE.md` | Persistent Prompt、Project Rules、新 Chat、Context Limit 的設定方式 |
| `ANCHORING_PROTOCOL.md` | 新視窗／AI 變調／外部修改／Hotfix 的重新定錨協議 |
| `prompts/` | 可直接複製使用的情境式 Prompt Pack |

# 2. 固定閱讀順序

```text
1. docs/PROJECT_OPERATING_RULES.md
2. docs/AI_START_HERE.md
3. docs/CURRENT_STATE.md
4. docs/README.md
5. docs/ARCHITECTURE.md
6. docs/DEVELOPMENT_GUIDE.md
7. docs/SYSTEM_SOURCE_MAP.md
```

之後再依功能選讀專門文件。

# 3. 功能閱讀路徑

Dashboard／歷史 Summary：

```text
docs/DASHBOARD_SUMMARY.md
→ docs/DATA_FLOW.md
→ docs/FIREBASE_DATA_MODEL.md
```

登入／權限／裝置／安全：

```text
docs/AUTH_AND_SECURITY.md
→ docs/DATA_FLOW.md
→ docs/FIREBASE_DATA_MODEL.md
→ docs/SYSTEM_SOURCE_MAP.md
```

Telegram Agent／營運主動預警：

```text
docs/TELEGRAM_AGENT.md
```

Store Identity：

```text
docs/DATA_IDENTITY_RULES.md
→ tests/storeIdentity.test.js
```

維護／修復／Reads：

```text
docs/MAINTENANCE_TOOLS.md
```

# 4. Archive 原則

`docs/archive/` 保存歷史 release note 與一次性的 Knowledge Base 更新紀錄。這些檔案**不應為了追最新版本而改寫舊版號**，因為它們的價值就是保留「那一次 release 當時改了什麼」。

```text
docs/archive/releases/
docs/archive/updates/
```

Archive 不可拿來取代目前正式架構文件。

# 5. 重複文件治理

只維護一份正式的：

```text
SYSTEM_SOURCE_MAP.md
```

舊的重複檔 `SYSTEM_SOURCE_MAP.md.md` 已刻意不放入本整理包，避免未來雙軌維護。

# 6. 目前 Security 文件邊界

截至 2026-08-25 整併：

- 最近可直接檢視的 Production `App.jsx` snapshot 可確認 `CURRENT_APP_VERSION = 3.5.3`；2026-08-25 晚間部署後版本仍由使用者確認維持 3.5.3，但最新完整 source 尚需在下一次修改前重新取得。
- 目前上線前端 source 已包含 Guided Trusted-Device self approval。
- Security Telegram v1 與 Device Approval backend 皆有實作與 regression coverage。
- 最新 **Summary-first 最高管理者 Security Action Card** 已於 2026-08-25 完成正式部署，初步 Production 測試成功；`CURRENT_APP_VERSION` 維持 3.5.3，目前進入觀察期。

未先讀 `CURRENT_STATE.md`，不得自行推定功能是否仍待部署、已正式上線或正在 Production 觀察中。

# 7. Source of Truth

```text
目前正式部署 source
↓
CURRENT_STATE.md
↓
Project Knowledge Base
↓
Regression Tests
↓
Git History / Production Tag
↓
舊對話 / AI 記憶
```

若文件與目前正式 source 衝突，應修正文件，不可以為了配合舊 `.md` 而反過來修改正式程式。


# 8. Prompt Anchoring

工作方式固定由：

```text
PROJECT_OPERATING_RULES.md
```

定義，不把會過期的 App version／部署狀態寫進永久 Prompt。

新視窗、重新定錨、Context Limit、外部修改與 Hotfix 使用：

```text
prompts/
```

設定方式詳見 `PROMPT_SETUP_GUIDE.md` 與 `ANCHORING_PROTOCOL.md`。
