# DRCYJ SaaS / CYJ 營運系統

> Repository landing page。
> 本頁只提供入口，不再複製 Project Knowledge Base 的正式內容，避免 root 與 `docs/` 雙軌漂移。

## 正式接手入口

修改任何正式程式前，依序閱讀：

```text
1. docs/PROJECT_OPERATING_RULES.md
2. docs/AI_START_HERE.md
3. docs/CURRENT_STATE.md
4. docs/README.md
5. docs/ARCHITECTURE.md
6. docs/DEVELOPMENT_GUIDE.md
7. docs/SYSTEM_SOURCE_MAP.md
```

## Source of Truth

```text
本次最新正式 source
↓
docs/CURRENT_STATE.md
↓
docs/ 內 canonical Project Knowledge Base
↓
Regression Tests
↓
Git History / Production Tag
↓
舊對話 / AI 記憶
```

Repository `HEAD / origin/main` 必須在每次工作開始時 live resolve；docs-only commit 也可能比目前已部署 runtime 新。Production runtime 與 Frontend gh-pages 狀態請讀 `docs/CURRENT_STATE.md`，不要從本 README 推定。

## 常用入口

- 永久工作規則：`docs/PROJECT_OPERATING_RULES.md`
- 新 AI／新工程師：`docs/AI_START_HERE.md`
- 正式環境狀態：`docs/CURRENT_STATE.md`
- 架構：`docs/ARCHITECTURE.md`
- 開發規則：`docs/DEVELOPMENT_GUIDE.md`
- 部署：`docs/DEPLOYMENT.md`
- Source Map：`docs/SYSTEM_SOURCE_MAP.md`
- Store Identity：`docs/DATA_IDENTITY_RULES.md`

## Runtime

Frontend / Backend / Firestore source 仍在既有位置，例如：

```text
src/
functions/
firestore.rules
firebase.json
package.json
```

本批 repository hygiene 不改 runtime source、Firestore path、Security、KPI、Summary 或 brand isolation。

## Root compatibility pointers

為避免外部舊連結失效，下列 root 檔名暫時保留，但內容只指向 `docs/` canonical：

```text
AI_START_HERE.md
ARCHITECTURE.md
DATA_IDENTITY_RULES.md
DEPLOYMENT.md
DEVELOPMENT_GUIDE.md
SYSTEM_SOURCE_MAP.md
```

它們不是第二份 Knowledge Base，不得單獨更新。
