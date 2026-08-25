# 05_EMERGENCY_HOTFIX.md

> Production 正在出錯，需要快速修，但仍維持安全邊界時使用。

```text
這是 DRCYJ SaaS Production Hotfix。

優先速度，但不可跳過 Source of Truth。
請採最小修正流程：
1. 確認目前正式出錯版本與真正責任 source。
2. 只修造成事故的最小範圍，不順便重構。
3. 明確列出可能受影響的既有功能與品牌。
4. 跑最低必要 syntax + 關鍵 regression + build。
5. 提供可直接替換的完整檔案與 rollback 方式。
6. 只部署真正必要的 target。
7. 列出部署後立即驗證項目。
8. 完成 Documentation Impact Check；事故穩定後再補完整文件／測試，不可永久略過。

若缺少目前正式 source，先要求檔案，不要拿舊版硬修。
```
