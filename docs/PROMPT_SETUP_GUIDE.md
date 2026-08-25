# PROMPT_SETUP_GUIDE.md

> 目的：把 DRCYJ SaaS 的工作方式從「某一個對話的默契」變成可跨視窗、跨 AI、跨工程師重複使用的固定協作規則。

# 1. 不要只靠一份超長 Prompt

最穩定的方式是分層：

```text
A. Persistent Instructions
   永久工作習慣

B. Project Operating Rules
   DRCYJ 專案固定 SOP

C. Current State / Knowledge Base
   現在 Production 架構與狀態

D. Current Source
   本次真正最新正式上線 source

E. Scenario Prompt
   新視窗／Hotfix／外部變更／交接等情境
```

這樣版本變動時只更新 C / D，不需要一直重寫 A / B。

# 2. 建議設定方式

## A. 長期保存的個人／工作指示欄位

貼入：

```text
prompts/00_PERSISTENT_INSTRUCTIONS.md
```

這一層只記錄穩定習慣，不寫 App version、Function revision、目前 bug 或待部署事項。

## B. DRCYJ 專案的固定規範

專案資料夾永久保留：

```text
PROJECT_OPERATING_RULES.md
```

任何新 AI 或新工程師都先讀它。

## C. 每個新視窗

第一則貼：

```text
prompts/01_NEW_CHAT_BOOTSTRAP.md
```

如果平台已經能直接讀 repository docs，也可以只貼裡面的短 Prompt，要求依序讀文件。

## D. 對話中途變調

貼：

```text
prompts/02_REANCHOR_MID_CHAT.md
```

## E. 對話快到上限

貼：

```text
prompts/03_CONTEXT_LIMIT_HANDOFF.md
```

把產生的 Session Checkpoint 帶到下一視窗。

# 3. 不應寫進 Persistent Prompt 的內容

以下內容會過期，不能寫死：

```text
CURRENT_APP_VERSION
目前 Functions revision
目前已部署 feature
當前 bug
本次修改檔名日期
當前 pending deploy
實際 Telegram chat id / secrets
```

這些都應放在：

```text
CURRENT_STATE.md
相關 Knowledge Base
最新正式 source
```

# 4. 最常見使用流程

平常開發：

```text
新 Chat Bootstrap
↓
AI 讀 Operating Rules + Current State
↓
使用者提供本次最新正式 source
↓
修改 / 驗證 / Docs Impact / Git / Deploy
↓
部署後 Production Confirmation
```

上下文快滿：

```text
Context Limit Handoff
↓
Session Checkpoint
↓
新 Chat Bootstrap
↓
貼 Checkpoint
↓
重新確認最新 source
```

外部修改：

```text
External Change Audit
↓
同步 source / docs / tests
↓
再做新修改
```

# 5. 使用者最少需要記住的三句話

日常新視窗：

```text
延續 DRCYJ SaaS，請依 PROJECT_OPERATING_RULES + AI_START_HERE + CURRENT_STATE 工作。
```

AI 變調：

```text
重新定錨，不要依舊記憶猜 source。
```

換視窗前：

```text
先產生 SESSION CHECKPOINT，再換視窗。
```

其餘細節由本資料夾 prompts 接手。
