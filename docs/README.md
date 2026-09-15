# docs/README.md

> Project Knowledge Base 正式索引。
> 最後整併更新：2026-09-15（UTC+8）。
> 本次最新正式 source 永遠高於文件；Production 狀態與 repository lineage 以 `CURRENT_STATE.md` 為準。

# 1. 正式文件清單

| 文件 | 主要用途 |
|---|---|
| `PROJECT_OPERATING_RULES.md` | 永久不隨版本變動的 AI／工程協作規範 |
| `AI_START_HERE.md` | 新 AI／新工程師固定接手入口 |
| `CURRENT_STATE.md` | 目前 Production、已部署 runtime、repository lineage |
| `README.md` | Canonical Project Knowledge Base 索引 |
| `ARCHITECTURE.md` | 高階系統架構與模組邊界 |
| `DEVELOPMENT_GUIDE.md` | 修改正式系統時不可破壞的開發規則 |
| `SYSTEM_SOURCE_MAP.md` | 每個功能真正的 source owner |
| `FIREBASE_DATA_MODEL.md` | Firestore logical model、path、Raw／Derived／Settings／Security |
| `DATA_FLOW.md` | 報表、Summary、登入、裝置安全、Telegram 資料流 |
| `AUTH_AND_SECURITY.md` | Login、角色、Credential、Trusted Device、Device Approval |
| `DEPLOYMENT.md` | GitHub Pages、Functions、Hosting、Rules 部署邊界 |
| `DASHBOARD_SUMMARY.md` | Dashboard／Summary／Formal readiness |
| `DATA_IDENTITY_RULES.md` | Store Identity 治理，特別是 CYJ 新店 |
| `MAINTENANCE_TOOLS.md` | System Maintenance 工具、風險與操作順序 |
| `TELEGRAM_AGENT.md` | Telegram Agent／Policy／Schedule／Task |
| `PROMPT_SETUP_GUIDE.md` | Persistent Prompt / Project Rules 設定 |
| `ANCHORING_PROTOCOL.md` | 新視窗／外部修改／Hotfix 重新定錨 |
| `prompts/` | 可直接複製的情境式 Prompt Pack |

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

Dashboard／Summary／歷史資料：

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

Store Identity：

```text
docs/DATA_IDENTITY_RULES.md
→ tests/storeIdentity.test.js
```

維護／修復／Reads：

```text
docs/MAINTENANCE_TOOLS.md
```

Telegram：

```text
docs/TELEGRAM_AGENT.md
```

# 4. Canonical / Compatibility Pointer 邊界

正式 Knowledge Base 只維護 `docs/` 這一套。

Repository root 為相容舊連結而暫時保留以下檔名：

```text
AI_START_HERE.md
ARCHITECTURE.md
DATA_IDENTITY_RULES.md
DEPLOYMENT.md
DEVELOPMENT_GUIDE.md
SYSTEM_SOURCE_MAP.md
```

這些 root 檔案只能是 pointer，不得再保存第二份正式內容。Root `README.md` 只作 repository landing page。

舊重複檔：

```text
SYSTEM_SOURCE_MAP.md.md
```

正式退休，不再追蹤。

# 5. Archive 原則

`docs/archive/` 保存歷史 release note 與一次性 Knowledge Base 更新紀錄。Archive 不追改最新版本，也不可取代 canonical docs。

Repository root 不保存一次性交付 artifacts。下列類型若已完成正式 promotion／驗證，應由 Git history 保存，不繼續留在 live root：

```text
歷史 deploy README
一次性 validation report
舊 SHA / Knowledge Base manifest
一次性 source tree dump
已失效 patch / delivery patch
```

只有仍屬正式入口、相容 pointer、runtime source、tests、必要 config 或 canonical `docs/` 的檔案才應留在目前 repository tree。

# 6. 目前版本／正式狀態

不要在本索引複製完整 Production 狀態。只固定：

```text
CURRENT_APP_VERSION = 3.6.0
```

其餘 Production runtime commit、Frontend gh-pages、已部署 Functions、Production confirmation 均讀：

```text
docs/CURRENT_STATE.md
```

# 7. Source of Truth

```text
本次最新正式 source
↓
docs/CURRENT_STATE.md
↓
docs/ Project Knowledge Base
↓
Regression Tests
↓
Git History / Production Tag
↓
舊對話 / AI 記憶
```

如果文件與最新正式 source 衝突，修文件；不得為了配合舊文件而修改正式程式。

# 8. Prompt Anchoring

永久工作方式由：

```text
docs/PROJECT_OPERATING_RULES.md
```

定義。新視窗、重新定錨、Context Limit、外部修改與 Hotfix 使用 `docs/prompts/`。
