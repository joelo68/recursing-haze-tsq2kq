# Device Approval v1 — 2026-08-24

## 目的

將既有「登入後才觀察新裝置」升級為可分階段啟用的「新裝置登入保護」。

正式前端用語刻意維持生活美容／醫學美容從業人員容易理解的表達，不顯示 Device Approval、fingerprint、requestId、Firestore collection 等工程術語。

## 本包內容

修改：
- `src/App.jsx`（v3.4.2 → v3.5.0）
- `src/components/LoginView.jsx`
- `src/components/SystemMonitor.jsx`
- `src/components/SettingsView.jsx`
- `functions/index.js`
- `firestore.rules`

新增：
- `src/components/DeviceApprovalGate.jsx`
- `src/components/DeviceApprovalPanel.jsx`
- `functions/deviceApproval.js`
- `tests/deviceApproval.test.js`

不修改：Dashboard / Summary / Ranking / Telegram / Store Identity。

## 功能政策

`security_config.deviceApprovalMode`：
- `off`：維持目前方式。新版部署不會自動阻擋現行使用者。
- `monitor`：建立待確認紀錄與右上角提醒，但暫時仍可登入。
- `enforce`：新裝置完成確認後才能進入系統。

預設：
- 全五種現行角色納入可設定範圍。
- 確認碼 15 分鐘。
- 允許使用另一台既有信任裝置自行確認。
- 既有 Trusted Device 全部保留，不要求重新認證。
- 第一次使用、沒有其他信任裝置時，直接提示由最高管理者協助。
- suspicious 不允許本人自助通過。

## 安全邊界

這一版防護的目標是：阻止取得在職員工帳密的人，從自己的新手機／電腦透過正常網站流程直接進入系統。

它不是完整企業級 Zero-Trust。現行 Firebase Auth 仍為匿名／Custom Token 混合架構，大部分營運資料仍以 signed-in 作為 Rules 基礎。若未來要防止技術性繞過前端，仍需另做 server-side identity / Custom Claims 架構升級。

## 部署前驗證

在 repository 根目錄：

```bash
node --check functions/deviceApproval.js
node --check functions/index.js
node --test tests/deviceApproval.test.js
npm run build
```

本包在交付環境已完成：
- Backend syntax：PASS
- 6 支 JSX syntax parse：PASS
- Device Approval regression：24 / 24 PASS

`npm run build` 必須在正式 repository（含完整 node_modules）再執行。

## 安全部署順序

### 1. 先部署新 Backend Functions

```bash
firebase deploy --only functions:checkDeviceAccess,functions:reviewDeviceApproval,functions:manageAccountDevice,functions:emergencyUnblockDevice,functions:cleanupExpiredDeviceApprovals --project cyjsituation-analysis
```

此時 `deviceApprovalMode` 預設仍是 `off`。

### 2. 部署 Frontend v3.5.0

```bash
git add src/App.jsx \
  src/components/LoginView.jsx \
  src/components/SystemMonitor.jsx \
  src/components/SettingsView.jsx \
  src/components/DeviceApprovalGate.jsx \
  src/components/DeviceApprovalPanel.jsx \
  functions/index.js functions/deviceApproval.js \
  firestore.rules tests/deviceApproval.test.js

git commit -m "Add staged new-device login protection"
git push origin main
npm run deploy
```

先確認正式畫面版本為 `v3.5.0`，並使用既有已信任裝置登入確認正常。

### 3. 確認新版前端已生效後，再部署 Rules

```bash
firebase deploy --only firestore:rules --project cyjsituation-analysis
```

這一步會禁止前端直接修改裝置信任、安全提醒與核准資料，改由 Cloud Functions 寫入。不要在舊版 Frontend 尚未更新時先做。

### 4. CYJ 先切「先觀察」

系統設定 → 權限資安 → 新裝置登入保護：
- 選「先觀察」
- 套用五種角色
- 15 分鐘
- 開啟「本人可用舊裝置完成確認」

建議觀察 1～2 天。

### 5. Monitor 驗證項目

- 舊 Trusted Device：登入無感。
- 新瀏覽器／新設備：可登入，但顯示「新裝置待確認」。
- 舊 Trusted Device Header：出現待確認數字。
- 點右上角提醒：直接打開「待確認裝置」，不再繞到完整裝置管理。
- 輸入 6 位確認碼：新裝置變為可使用。
- 「不是我」：轉成需最高管理者確認。
- 第一次使用、沒有其他信任裝置：不顯示無法完成的自助步驟，直接提示管理者協助。
- SystemMonitor 完整裝置歷史仍需手動載入，不新增大型背景監聽。

### 6. 確認 Monitor 穩定後，再切「正式啟用」

切成「正式啟用」後，新裝置才會真正停在確認畫面，核准前不進 Dashboard。

## Rollback

若 Monitor 有任何異常，先在設定頁切回「維持目前方式」。

如果 Frontend 本身有問題，回退至 v3.4.2；若 Rules 已部署而回退舊前端，應同步回退舊 `firestore.rules`，因為舊前端仍有直接寫裝置安全資料的流程。

## Knowledge Base

本次屬於 device/security、Firestore schema、Cloud Functions、Rules 與 major security flow 變更。正式部署並完成 runtime 驗證後應更新：
- `docs/AUTH_AND_SECURITY.md`
- `docs/FIREBASE_DATA_MODEL.md`
- `docs/DATA_FLOW.md`
- `SYSTEM_SOURCE_MAP.md`
- `CURRENT_STATE.md`

未部署前不要把本包寫成 Production State。
