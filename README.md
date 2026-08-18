# CYJ 營運系統

> Project Knowledge Base v1  
> 本文件依 2026-08-18 使用者提供的「目前正常部署版本」程式建立。  
> 若文件與正式程式衝突，以目前正式部署程式為準，並同步更新本 Knowledge Base。

## 系統定位

本專案是以 React / Vite / Firebase 建置的多品牌營運管理系統，目前正式品牌包含：

- CYJ
- 安妞
- 伊啵

系統涵蓋營運 Dashboard、日報、年度分析、目標、區域／單店／詳細報表、回報檢核、歷史修正、管理師模組、登入安全、裝置管理、維護中心，以及 Telegram 營運 Agent／推播管理。

## 技術棧

目前正式 `package.json` 可確認：

- React 19
- React DOM 19
- Vite 7
- Firebase Web SDK 12
- Recharts 3
- Tailwind CSS 3
- Lucide React
- vite-plugin-pwa
- gh-pages

後端 `functions/package.json` 可確認：

- Node.js 22
- firebase-admin
- firebase-functions
- axios

## 專案入口

```text
index.html
  ↓
src/main.jsx
  ↓
src/App.jsx
  ↓
AppContext.Provider
  ↓
Navigation + 各功能 View
```

`src/main.jsx` 同時對整個頁面套用 `translate="no"` / `notranslate`，避免瀏覽器自動翻譯誤改姓名、店名與金額文字。

## 主要功能

目前正式選單包含：

- 營運總覽
- 每日分析
- 年度分析
- 年度設定
- 區域分析
- 單店分析
- 詳細報表
- 回報檢核
- 業績修正
- 日報輸入
- 登入監控
- 推播管理
- 管師目標
- 管師排休
- 管師帳號
- 系統設定

Therapist 模組可由 feature flag 關閉；關閉後相關選單與資料讀取應同步停用。

## 三品牌 Firestore 路徑

### CYJ：legacy path

```text
artifacts/{appId}/public/data/{collection}
```

Global settings：

```text
artifacts/{appId}/public/data/global_settings/{doc}
```

### 安妞／伊啵：standard path

```text
brands/{brandId}/{collection}
```

Settings：

```text
brands/{brandId}/settings/{doc}
```

所有跨品牌功能在修改資料路徑前，都必須先確認是否透過 `getCollectionPath()` / `getDocPath()`。

## Dashboard 架構

```text
DashboardView.jsx
  ├─ DashboardHeader.jsx
  ├─ StorePerformanceView.jsx
  └─ TherapistPerformanceView.jsx
        ↑
  useDashboardStats.js
```

Dashboard 的大量資料整合與計算不在 `DashboardView.jsx` 本身，而在 `useDashboardStats.js`。

## Store Identity

CYJ「新店」目前有正式治理文件：

```text
DATA_IDENTITY_RULES.md
tests/storeIdentity.test.js
```

核心規則：

```text
coreStoreName      = 新店
canonicalStoreName = CYJ新店店
```

遇到新店資料問題時，不得先在單一頁面新增 workaround。先依 `DATA_IDENTITY_RULES.md` 的診斷順序確認 Raw、Summary、canonical writer 與 Store Identity layer。

## 開發前先讀

依修改內容閱讀：

- 系統總架構：`ARCHITECTURE.md`
- 開發規則：`DEVELOPMENT_GUIDE.md`
- 部署：`DEPLOYMENT.md`
- 完整來源地圖：`SYSTEM_SOURCE_MAP.md`
- Store Identity：`DATA_IDENTITY_RULES.md`

## 常用指令

```bash
npm run dev
npm run build
npm run lint
npm run preview
npm run deploy
```

Store Identity regression：

```bash
node --test tests/storeIdentity.test.js
```

Functions：

```bash
cd functions
npm run serve
npm run deploy
npm run logs
```

## 目前 Repository 未確認／不存在的項目

目前正式來源與使用者專案檢查結果：

- 未看到 `.firebaserc`
- 未看到 `firestore.indexes.json`
- 未看到 `.github/workflows`

因此目前不得假設：

- Firebase CLI project alias 已由 repository 管理
- Composite Indexes 已由 `firestore.indexes.json` 管理
- GitHub Actions 有自動 build / deploy workflow

## 文件維護原則

1. 正式程式優先於文件。
2. 重大架構變更後同步更新相關 `.md`。
3. 不以 AI 記憶補寫無法由目前程式確認的事實。
4. 不把一次性修復工具寫成永久架構。
5. 程式已存在的特殊相容規則，必須記錄「目前狀態」與「未來建議」的差別。
