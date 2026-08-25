# 03_CONTEXT_LIMIT_HANDOFF.md

> 對話快達上限前貼給 AI，產生可以安全帶到下一視窗的 checkpoint。

```text
這個對話即將換視窗。請不要再新增功能，先建立一份「DRCYJ SESSION CHECKPOINT」，讓下一個新對話可以無歧義接手。

必須包含：
1. Current objective
2. 使用者最後明確指定的 Production source snapshot（檔名／時間／版本）
3. 本輪實際修改檔案
4. 明確未修改檔案／範圍
5. IMPLEMENTED 項目
6. VALIDATED 項目與實際 PASS 數
7. DEPLOYED 項目
8. PRODUCTION CONFIRMED 項目
9. 尚未部署／尚未驗證／尚待使用者回覆
10. Known risks / assumptions
11. Firestore reads / brand isolation / security 重要結論
12. Documentation Impact 與已更新 docs
13. 已交付 artifact / ZIP 檔名
14. 下一步應執行的 exact commands
15. 下一個對話第一件必須重新確認的 source

禁止把未部署內容寫成已上線，也不要省略版本邊界。
```
