# PROJECT_OPERATING_RULES.md

> DRCYJ SaaS 專案的固定 AI／工程協作作業規範。  
> 本文件描述「永遠怎麼工作」，不記錄會隨版本變動的 Production 狀態。  
> 目前版本、已部署項目與待部署項目一律以 `CURRENT_STATE.md` 與最新正式 source 為準。

---

# 1. 核心定位

這是一套正在正式營運的 SaaS，不是一次性 Demo，也不是可自由重構的實驗專案。

所有工作優先順序固定為：

```text
正確性
→ 不破壞既有功能
→ 資料一致性
→ 品牌隔離
→ 安全性
→ Firestore / Functions 成本
→ 使用者體驗
→ 程式碼優雅程度
```

快速交付不能高於 Production 安全。

---

# 2. Source of Truth

任何修改前，資訊優先順序固定為：

```text
本次由使用者明確指定的目前正式上線 source
↓
docs/CURRENT_STATE.md
↓
docs/Project Knowledge Base
↓
Regression Tests
↓
Git diff / Git history / Production tag
↓
舊對話、舊附件、AI 記憶
```

強制規則：

- 不可因為 AI 記得以前看過某支程式就直接修改。
- 要修改哪支程式，必須先確認真正負責該功能的 source files。
- 涉及多支檔案時，每一支都要確認版本一致。
- 不可把不同日期、不同 release 的 source 拼成一個「看起來完整」的新版本。
- Knowledge Base 與目前正式 source 衝突時，以正式 source 為準，並同步做 Documentation Impact Check。
- 若缺少真正負責該功能的目前正式 source，先列出缺少檔案，不得靠猜測開始改。

---

# 3. 開工前固定檢查

每次程式工作開始前，先回答：

```text
1. 本次真正要解決的問題是什麼？
2. 哪些 source files 真正負責這個功能？
3. 這些檔案是否已確認為目前正式上線版本？
4. 是否涉及 Firestore / Summary / Identity / Security / Telegram / Permission？
5. 是否跨品牌？
6. 是否會新增 reads / writes / Function invocation？
7. 有哪些 regression tests 或 runtime 驗證方式？
8. 本次應修改最小範圍是什麼？
```

只要第 2 或第 3 項無法確認，就停止實作並補 source。

---

# 4. 問題診斷原則

禁止「看到哪頁壞就補哪頁」。

資料／數字問題固定由上游往下查：

```text
Identity / Master / Settings
↓
Raw Source
↓
Writer / Trigger
↓
Aggregation / Derived Data
↓
Summary / Queue / Trust State
↓
Resolver / Query
↓
View / UI
```

尤其不能用單頁 workaround 掩蓋：

- Store Identity
- path resolver
- backend writer
- Summary
- permission
- Device Security

問題修在真正責任層。

---

# 5. 三品牌隔離

系統至少包含 CYJ、安妞、伊啵。

任何跨品牌修改前必須確認：

- CYJ legacy path 與新品牌 standard path 是否不同。
- 是否使用正式 `getCollectionPath()` / `getDocPath()` 或 backend 對等 resolver。
- 品牌設定是否獨立。
- account/device/security key 是否包含 brand scope。
- 修 CYJ 時不可默默改變安妞／伊啵既有營運邏輯。

禁止因為三品牌畫面相似，就假設 Firestore root 或 business logic 完全相同。

---

# 6. Firestore / 流量原則

本專案長期採：

```text
Summary-first
Event-driven
Small scoped query
Single-document listener
Conditional loading
View-based throttling
```

避免：

```text
polling
setInterval 固定重查
無條件大型 collection listener
頁面沒使用仍背景載入
為了一個 badge 讀完整歷史
同一資訊建立第二套 listener
```

新增 listener / query 時必須說明：

- 是常駐還是事件式。
- 觸發頻率。
- 每次約讀幾份 documents。
- 能否沿用既有 summary。
- 能否縮到單店／單人／單日／單 request。
- 即時性與 reads 的取捨。

不能只說「流量應該不大」。

---

# 7. Security 原則

登入、帳號、Trusted Device、Device Approval、Telegram Security、最高管理者權限都屬高風險修改。

修改前至少同時檢查對應的：

```text
src/App.jsx
src/components/LoginView.jsx
src/components/DeviceApprovalGate.jsx
src/components/DeviceApprovalPanel.jsx
src/components/SystemMonitor.jsx
src/components/TelegramAlertControlCenter.jsx
functions/deviceApproval.js
functions/index.js
firestore.rules
相關 tests
docs/AUTH_AND_SECURITY.md
```

規則：

- Frontend 顯示有權限，不代表 Backend 可以相信。
- 敏感 action 必須由 Backend 重新驗證 actor。
- 多管理者可能同時操作時必須考慮 race condition。
- UI success 不等於 transaction success。
- self approval 與 admin review 不可混成同一條安全捷徑。
- 不可重新引入已淘汰的 auto-trust 假設，除非目前正式 source 明確存在。
- Security Telegram 應維持事件驅動，不為通知額外掃大量營運資料。
- 不把 password、token、secret 寫入 log、alert 或 Knowledge Base。

---

# 8. UI / UX 原則

主要使用者不是工程人員。

正式 UI 應：

- 用容易理解的生活／營運語言。
- 必要技術詞轉成使用者看得懂的說法。
- 保持資訊密度高但不雜亂。
- 桌機與行動版都必須評估。
- 新提醒優先採非阻斷式設計，除非安全上必須阻擋。
- 避免黑色作為主要操作按鈕。
- 不因新增一欄或一個 badge 就破壞既有 RWD。
- 不讓工程術語直接暴露給一般營運人員。

若 UI 改動可能改變既有閱讀／操作習慣，實作前先分析影響。

---

# 9. App Version 原則

不得自行提高 `CURRENT_APP_VERSION`。

只有使用者明確決定要觸發版本更新／強制更新機制，或有明確版本管理需求時才調整。

一般 bug fix、backend fix、UI 微調不因「有修改」就自動升版。

---

# 10. 程式交付格式

實作完成後，交付不能只給概念或零碎 snippet。

依修改範圍提供：

```text
1. 修改後完整 source files
2. 可直接使用的 ZIP（多檔案時）
3. Patch / diff（重要修改時）
4. 本次修改檔案清單
5. 明確未修改範圍（高風險／大型修改時）
6. Syntax / regression / build 結果
7. Documentation Impact Check
8. Git add / commit / push 指令
9. 精準 Deploy 指令
10. Production 驗證步驟
```

能提供完整檔案時，不以大量手動貼片取代完整版本。

若某項驗證未實際執行，明確寫「未執行」，不可寫成 PASS。

---

# 11. 驗證原則

依實際改動範圍執行。

常見：

```bash
npm run build
node --check functions/index.js
node --check functions/deviceApproval.js
node --test tests/storeIdentity.test.js
node --test tests/deviceApproval.test.js
node --test tests/superAdminDeviceNotice.test.js
```

驗證回報必須標示：

```text
PASS / FAIL
通過數 / 總數
未執行項目與原因
```

「網頁打得開」不能取代 regression test。

---

# 12. 部署原則

只部署真正有修改的 runtime 範圍。

每次交付前先確認目前 repository 的實際 deploy target，不把歷史習慣當成現在事實。

原則：

```text
docs only → Git 即可，不需 runtime deploy
Frontend only → build + 正式 frontend target
Functions only → syntax/tests + 只部署受影響 Functions
Rules only → 只部署 firestore:rules
Frontend + Backend contract → 依相容性決定順序，通常 Backend first
```

禁止為了省事一律全量 `firebase deploy`。

Git 指令必須對應本次真正修改檔案：

```bash
git add <本次真正修改檔案>
git commit -m "<符合本次修改內容>"
git push origin main
```

不得機械式提供與本次無關的部署命令。

---

# 13. Production 狀態分級

回答與文件固定區分：

```text
IMPLEMENTED
程式已完成

VALIDATED
測試／語法／build 已驗證

DEPLOYED
已完成正式部署

PRODUCTION CONFIRMED
使用者已在正式 runtime 實測確認
```

禁止把「已寫好」描述成「現在正式環境就是這樣」。

`CURRENT_STATE.md` 只記錄可確認的 Production 狀態；尚未上線項目必須標記為 pending / awaiting production confirmation。

---

# 14. Documentation Impact Check

每一次正式程式修改都必須做。

至少判斷：

```text
CURRENT_STATE.md
ARCHITECTURE.md
AUTH_AND_SECURITY.md
DATA_FLOW.md
FIREBASE_DATA_MODEL.md
SYSTEM_SOURCE_MAP.md
DEPLOYMENT.md
DASHBOARD_SUMMARY.md
MAINTENANCE_TOOLS.md
TELEGRAM_AGENT.md
DATA_IDENTITY_RULES.md
DEVELOPMENT_GUIDE.md
```

交付時固定寫其中一種：

```text
Documentation Impact: None
```

或：

```text
Documentation Impact:
需要更新：
- docs/...
- docs/...
```

只更新受影響文件，不每次重寫整個 docs。

大型重構、長期外部修改未同步、或正式交接前，才做 Full Documentation Audit。

---

# 15. 新對話 / Context Limit / AI 變調

新對話開始固定閱讀：

```text
1. docs/PROJECT_OPERATING_RULES.md
2. docs/AI_START_HERE.md
3. docs/CURRENT_STATE.md
4. docs/README.md
5. 本次功能相關 docs
6. 本次最新正式 source
```

若對話過長、上下文即將滿：

- 先建立 Session Checkpoint。
- 明確列出 Production source、已修改檔案、Implemented / Validated / Deployed / Confirmed 狀態、待做事項與 Docs Impact。
- 新對話不得只靠「延續上一個視窗」猜前情。

若 AI 回答開始變成只給片段、跳過驗證、用舊記憶猜 source，立即使用 `docs/prompts/02_REANCHOR_MID_CHAT.md`。

---

# 16. 外部修改

如果中間由資訊公司、其他 AI、工程師或使用者自行修改過程式：

- 不假設 Knowledge Base 仍同步。
- 優先取得最新正式 source 或 git diff / patch。
- 先做 External Change Audit。
- 判斷哪些 docs 已 drift。
- 再開始下一輪修改。

使用：

```text
docs/prompts/04_EXTERNAL_CHANGE_AUDIT.md
```

---

# 17. Emergency Hotfix

緊急事故仍不能跳過 Source of Truth。

Hotfix 可以縮小流程，但不可省略：

```text
確認最新 source
→ 鎖定最小修正範圍
→ 語法／關鍵 regression
→ 精準 deploy
→ runtime 驗證
→ Documentation Impact
```

使用：

```text
docs/prompts/05_EMERGENCY_HOTFIX.md
```

---

# 18. 回答方式

固定使用繁體中文。

技術回答：

```text
先結論
→ 再原因
→ 再實際影響
→ 再實作／驗證／部署
```

當使用者問：

```text
會不會影響原功能？
會不會增加 reads？
其他品牌會不會受影響？
```

必須根據實際程式執行路徑回答，不能只說「應該不會」。

---

# 19. 最終不可違反原則

```text
不要改錯版本。
不要跨版本拼接。
不要破壞已正常功能。
不要製造資料不一致。
不要增加不必要流量。
不要默默改其他品牌。
不要把未部署寫成已上線。
不要因換 Chat 或換 AI 就改變開發紀律。
```
