# DEPLOYMENT.md

> 本文件分成「目前 source 可確認的部署設定」與「不可由目前 repository 確認的項目」。  
> 不把過去聊天中的部署習慣自動當成 repository 事實。

# 1. Frontend

Root `package.json`：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "predeploy": "npm run build",
    "deploy": "npm run build && gh-pages -d dist"
  }
}
```

因此目前 source 可確認的前端發布：

```bash
npm run deploy
```

實際執行：

```text
npm run build
    ↓
vite build
    ↓
dist/
    ↓
gh-pages -d dist
```

Homepage：

```text
https://joelo68.github.io/recursing-haze-tsq2kq
```

Vite base：

```text
/recursing-haze-tsq2kq/
```

# 2. PWA

`vite.config.js`：

```text
VitePWA
registerType = autoUpdate
display      = standalone
```

因此前端 build/deploy 修改可能同時影響 PWA cache / installed app 更新。

`index.html` 另外使用 no-cache meta，但真正 PWA lifecycle 仍由 Vite PWA plugin 產物管理。

# 3. Firebase Functions

`functions/package.json`：

```json
{
  "engines": {
    "node": "22"
  },
  "scripts": {
    "serve": "firebase emulators:start --only functions",
    "shell": "firebase functions:shell",
    "start": "npm run shell",
    "deploy": "firebase deploy --only functions",
    "logs": "firebase functions:log"
  }
}
```

完整 Functions deploy：

```bash
cd functions
npm run deploy
```

等同：

```bash
firebase deploy --only functions
```

Functions runtime：

```text
Node.js 22
```

# 4. Firebase Root Config

`firebase.json` 目前配置：

## Firestore Rules

```text
firestore.rules
```

## Functions

```text
source = functions
codebase = default
disallowLegacyRuntimeConfig = true
```

## Hosting

```text
public = dist
rewrite ** → /index.html
```

## Emulator

```text
functions = 5001
firestore = 8080
UI enabled
singleProjectMode = true
```

# 5. GitHub Pages 與 Firebase Hosting 的關係

目前 repository 同時存在：

- Root `package.json` 的 GitHub Pages deploy script
- `firebase.json` 的 Firebase Hosting config

但目前提供的 source **沒有一個 root script 明確執行 `firebase deploy --only hosting`**。

因此文件只記錄：

> GitHub Pages deploy 是 package script 可直接確認的 frontend deploy 路徑。  
> Firebase Hosting config 存在，但目前不能只靠 repository 判定它是否為正式日常發布入口。

如果未來要把 Firebase Hosting 正式納入標準發布流程，應再明確建立 script / documented command。

# 6. `.github/workflows`

使用者已在專案根目錄執行：

```bash
find .github -maxdepth 2 -type f 2>/dev/null
```

結果沒有輸出。

因此目前可確認：

```text
沒有可見的 .github/workflows workflow 檔案
```

不應假設 GitHub Actions 自動部署存在。

# 7. `.firebaserc`

使用者目前專案未看到 `.firebaserc`。

因此：

- Firebase CLI project alias 未由 repository 確認
- 不在 Knowledge Base 中硬寫 alias
- 執行 Firebase deploy 前應由操作者自行確認目前 CLI project context

# 8. `firestore.indexes.json`

使用者目前專案未看到 `firestore.indexes.json`。

`firebase.json` 也只指定：

```json
"firestore": {
  "rules": "firestore.rules"
}
```

因此目前：

> Composite Indexes 未由 repository source file 文件化。

若日後要納入版本控管，應以 Firebase 實際 index 設定為來源建立，不要從 query 程式碼猜測。

# 9. 部署前驗證

依實際改動範圍跑對應檢查。

Frontend：

```bash
npm run build
```

Store Identity：

```bash
node --test tests/storeIdentity.test.js
```

一般 Functions entry：

```bash
node --check functions/index.js
```

Device Security：

```bash
node --check functions/deviceApproval.js
node --test tests/deviceApproval.test.js
```

若目前版本含 Summary-first 最高管理者提醒專項測試：

```bash
node --test tests/superAdminDeviceNotice.test.js
```

Telegram prompt：

```bash
node --check functions/telegram/prompts.js
```

Security／Summary／Data Model 類修改，不能只用「網頁有打開」當唯一驗證。

# 10. 變更範圍原則

只部署真的有改的範圍。

| 修改內容 | 一般部署方式 |
|---|---|
| docs only | 只需 Git，不需 runtime deploy |
| React／Vite frontend | build + 實際使用的 frontend hosting target |
| Device Security Function 行為 | 只部署受影響的 Firebase Functions |
| Firestore Rules | `firebase deploy --only firestore:rules` |
| frontend + Device Security summary contract | Functions 先、Frontend 後 |
| `functions/index.js` Telegram trigger | 只部署受影響 trigger Functions |

## Root `npm run deploy` 不等於 Firebase Hosting

目前 repository 文件記錄：

```text
npm run deploy
→ npm run build
→ gh-pages -d dist
```

也就是 GitHub Pages 路徑。

Firebase Hosting 是另外的 CLI target：

```bash
firebase deploy --only hosting
```

因此除非先確認目前 `package.json` 的 `deploy` script 已改成 Firebase Hosting，否則不能直接把「不用 Hosting」等同於「不用 npm run deploy」。

## Summary-first 最高管理者提醒 — 2026-08-25 已部署基線

2026-08-25 版本同時修改 Frontend 與 `functions/deviceApproval.js` 的 pending lifecycle，使用者已確認完成正式部署且初步 Production 測試成功。`CURRENT_APP_VERSION` 維持 3.5.3。

未來若再次修改這條流程，正式 repository 仍應先跑：

```bash
node --check functions/deviceApproval.js
node --test tests/deviceApproval.test.js tests/superAdminDeviceNotice.test.js
npm run build
```

若未來再次變更相同 frontend/backend contract，仍建議先部署會建立／結束 pending request 的 Functions：

```bash
firebase deploy --only "functions:checkDeviceAccess,functions:reviewDeviceApproval,functions:manageAccountDevice,functions:emergencyUnblockDevice,functions:cleanupExpiredDeviceApprovals"
```

再部署實際正式使用的 Frontend target。

如果正式前端是 Firebase Hosting：

```bash
firebase deploy --only hosting
```

如果正式前端是 GitHub Pages，則使用已確認的 root package deploy script。

2026-08-25 這次 Summary-first 欄位本身沒有要求 Rules 變更。未來也只有 `firestore.rules` 實際有改時才部署 Rules；不得因為 Security 功能相關就機械式重部署 Rules。

# 11. PWA 版本注意事項

目前 `App.jsx` 有：

```text
CURRENT_APP_VERSION = 3.5.3
```

而 Vite PWA 使用：

```text
autoUpdate
```

因此版本／快取問題涉及兩層：

1. App 自己的版本檢查邏輯
2. Service Worker / PWA 更新

未來修改強制更新機制時要一起確認，不要只改其中一層。

# 12. 部署後驗證

依修改類型驗證：

Frontend：

- 正式 URL 可開啟
- lazy-loaded page 可正常切換
- PWA 不出現舊 chunk 載入錯誤

Data / Summary：

- Dashboard data source status 正確
- Summary / Raw fallback 符合預期

Store Identity：

- regression test PASS
- 必要時執行 Core Consistency Audit

Security：

- login log 正常
- device trust 不阻斷合法登入
- SystemMonitor 可讀到紀錄

Telegram：

- config / policy / schedule 前端讀寫正常
- Functions log 無異常
- 測試訊息與正式群組 routing 依當次需求驗證
# 10. Reconciliation Security Config Hardening — Scoped Deploy Order

此段只適用於 `updateTelegramSecurityAlertConfig` reconciliation candidate。它同時涉及 Backend endpoint、Firestore Rules 與 Frontend，部署不可只發其中一層。

安全順序：

```bash
# 1. 先讓 Backend writer 可用
firebase deploy --only functions:updateTelegramSecurityAlertConfig

# 2. 再封鎖 telegram_security_alerts client direct write
firebase deploy --only firestore:rules

# 3. 最後發布改走 Backend 的 Frontend
npm run deploy
```

理由：Rules 一旦先禁止 client write，而 Backend endpoint 尚未存在，新的安全設定 UI 會暫時無法儲存；反向先上 Backend 再收緊 Rules，既有 Production frontend 不會被中斷。

本 hardening 沒有修改既有 Security alert Firestore triggers，因此不要機械式全量部署全部 Functions。

> 在正式 validation / commit / push 前，本節只是部署邊界說明，不代表已部署。
