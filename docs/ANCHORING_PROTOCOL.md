# ANCHORING_PROTOCOL.md

> 用途：不論開新對話、上下文滿、外部修改、緊急事故或 AI 回答變調，都能快速恢復相同工作方式。

# 1. 三層定錨

```text
第一層：Permanent Working Rules
PROJECT_OPERATING_RULES.md

第二層：Current Project State
AI_START_HERE.md
CURRENT_STATE.md
README.md
相關 Knowledge Base

第三層：Current Work Evidence
本次最新正式 source
git diff / patch
Regression Tests
Production runtime 驗證
```

第一層回答「永遠怎麼做」。  
第二層回答「現在系統是什麼」。  
第三層回答「這一次真正要改哪個版本」。

# 2. 不同情境使用哪個 Prompt

| 情境 | 使用文件 |
|---|---|
| 新開對話 | `prompts/01_NEW_CHAT_BOOTSTRAP.md` |
| 回答開始變調／用舊記憶猜 | `prompts/02_REANCHOR_MID_CHAT.md` |
| 對話快達上限，要換視窗 | `prompts/03_CONTEXT_LIMIT_HANDOFF.md` |
| 其他工程師／AI 改過程式 | `prompts/04_EXTERNAL_CHANGE_AUDIT.md` |
| 正式環境緊急 Hotfix | `prompts/05_EMERGENCY_HOTFIX.md` |
| 懷疑 docs 已落後 | `prompts/06_FULL_DOCS_AUDIT.md` |
| 只需要部署已完成程式 | `prompts/07_DEPLOYMENT_ONLY.md` |
| 只想做 code review、不改檔 | `prompts/08_CODE_REVIEW_ONLY.md` |
| 換另一個 AI／工程師正式接手 | `prompts/09_NEW_AI_HANDOFF.md` |
| 部署後要更新 Production 狀態 | `prompts/10_PRODUCTION_CONFIRMATION.md` |

# 3. 最短重新定錨口令

如果不想貼完整 Prompt，只要貼：

```text
重新定錨 DRCYJ SaaS 專案。
先遵守 docs/PROJECT_OPERATING_RULES.md，
再讀 docs/AI_START_HERE.md、docs/CURRENT_STATE.md、docs/README.md。
任何修改以前先確認我本次提供的是目前正式上線 source；不得依舊對話或 AI 記憶直接修改。
維持完整檔案交付、驗證、Documentation Impact、Git 與精準 Deploy 的既定流程。
```

# 4. Context Limit 前的固定動作

在舊對話結束前，要求產生：

```text
SESSION CHECKPOINT
- Current objective
- Production source snapshot
- Current app/backend versions that are actually confirmed
- Files changed
- Files deliberately not changed
- Implemented
- Validated
- Deployed
- Production confirmed
- Pending work
- Known risks
- Documentation Impact
- Exact next commands
```

新視窗先貼 checkpoint，再貼 `01_NEW_CHAT_BOOTSTRAP.md`。

# 5. AI 變調判斷

若出現以下任何情況，視為需要重新定錨：

- 未看 source 就直接給修改碼。
- 開始拿舊檔／舊記憶拼接。
- 只給 snippet，不再提供完整檔案。
- 忘記 regression / build / syntax。
- 忘記 Git / Deploy。
- 未區分 Implemented 與 Production Confirmed。
- 不再做 Documentation Impact Check。
- 對 reads / 品牌隔離只給模糊保證。

立即使用 `02_REANCHOR_MID_CHAT.md`。
