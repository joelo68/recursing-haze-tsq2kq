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

Frontend：

```bash
npm run build
```

如要 lint：

```bash
npm run lint
```

Store Identity：

```bash
node --test tests/storeIdentity.test.js
```

Backend：

```bash
node --check functions/index.js
```

Telegram prompt 有改：

```bash
node --check functions/telegram/prompts.js
```

# 10. 變更範圍原則

只修改 frontend：

```text
不需要因為 frontend 修改而重新 deploy 所有 Functions
```

只修改 Functions：

```text
不需要因為 backend 修改而重新發布 GitHub Pages frontend
```

同時修改：

```text
各自 build/check 後，分別發布
```

這是部署治理原則；實際 deploy command 應以當次改動範圍與 Firebase CLI context 為準。

# 11. PWA 版本注意事項

目前 `App.jsx` 有：

```text
CURRENT_APP_VERSION = 3.4.1
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
