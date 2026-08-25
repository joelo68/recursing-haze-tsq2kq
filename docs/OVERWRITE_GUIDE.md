# docs 安全完整覆蓋指南

> 本資料夾是 2026-08-25 整理後的 Project Knowledge Base。  
> 只包含 Markdown / 文字文件，不包含 React、Firebase Functions、Firestore Rules 或其他 runtime source code。

## 建議覆蓋方式

在專案根目錄先備份既有 `docs/`：

```bash
mv docs docs_backup_20260825
```

再把本包中的完整 `docs/` 複製到專案根目錄。

確認至少存在：

```text
docs/AI_START_HERE.md
docs/CURRENT_STATE.md
docs/README.md
docs/ARCHITECTURE.md
docs/AUTH_AND_SECURITY.md
docs/FIREBASE_DATA_MODEL.md
docs/DATA_FLOW.md
docs/DEPLOYMENT.md
docs/DEVELOPMENT_GUIDE.md
docs/SYSTEM_SOURCE_MAP.md
docs/DASHBOARD_SUMMARY.md
docs/DATA_IDENTITY_RULES.md
docs/MAINTENANCE_TOOLS.md
docs/TELEGRAM_AGENT.md
```

## 覆蓋後不需要做的事

只替換 `docs/` 不會改動 SaaS 執行程式，因此不需要：

```text
npm run build
npm run deploy
firebase deploy
```

也不需要提高 `CURRENT_APP_VERSION`。

## Git 建議

若要把文件整理提交到版本庫：

```bash
git add docs
git commit -m "refresh project knowledge base"
git push origin main
```

## Source of Truth

文件若與目前正式部署 source 衝突，仍以正式 source 為準，並回頭更新文件。

`CURRENT_STATE.md` 對「正式上線」與「已完成但尚待部署確認」有明確區分；不要因 archive release note 或舊對話而覆蓋這個邊界。
