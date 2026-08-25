# 04_EXTERNAL_CHANGE_AUDIT.md

> 中間由資訊公司、其他 AI、工程師或自己手動改過程式時使用。

```text
這套 DRCYJ SaaS 在上一輪之後有外部修改。先不要直接開發新功能，請做 External Change Audit。

請以我這次提供的最新正式 source / git diff / patch 為最高 Source of Truth，並：
1. 找出與目前 Knowledge Base 不一致的地方。
2. 列出外部修改真正影響的功能與檔案。
3. 判斷是否改變 Firestore path/schema、Summary、Identity、Security、Telegram、Permission、Deployment。
4. 評估是否新增 reads/writes/listeners。
5. 找出 regression coverage 是否已落後。
6. 列出必須更新的 docs。
7. 先完成「現況同步」，再開始下一個新修改。

不要因為 docs 寫某種架構就反過來覆蓋最新正式 source。
```
