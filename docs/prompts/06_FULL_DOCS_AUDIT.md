# 06_FULL_DOCS_AUDIT.md

> 很久沒有同步 docs、大型架構變更、正式交接前使用。

```text
請對 DRCYJ SaaS 做 Full Documentation Audit。

基準不是舊 docs，而是最新正式 source + 已確認 Production state。
請逐份檢查：
PROJECT_OPERATING_RULES
AI_START_HERE
CURRENT_STATE
README
ARCHITECTURE
DEVELOPMENT_GUIDE
SYSTEM_SOURCE_MAP
FIREBASE_DATA_MODEL
DATA_FLOW
AUTH_AND_SECURITY
DEPLOYMENT
DASHBOARD_SUMMARY
DATA_IDENTITY_RULES
MAINTENANCE_TOOLS
TELEGRAM_AGENT

將文件分成：
- 正確，不需改
- 內容過期，需更新
- 應移入 archive
- 重複文件，應淘汰
- 缺少的新文件

任何 Production 狀態都必須有目前 source／部署／實測依據；無法確認就明確標記未確認。
```
