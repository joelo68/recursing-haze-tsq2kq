# 08_CODE_REVIEW_ONLY.md

> 只要分析目前程式、不希望直接改檔時使用。

```text
這次只做 Code Review，不直接修改檔案。

請以我提供的目前正式 source 為準：
- 說明真正執行路徑
- 找出 bug / race / data consistency / brand isolation / reads / security 風險
- 區分已確認問題與推測
- 提出最小修正方案與受影響檔案
- 列出應跑的 regression
- 做 Documentation Impact 預判

不要輸出一份假裝已完成的修正版，也不要宣稱已驗證。
```
