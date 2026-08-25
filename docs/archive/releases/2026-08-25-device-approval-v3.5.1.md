# Device Approval v3.5.1 — 即時更新目前裝置狀態

## 修正內容

Monitor（先觀察）模式下，新裝置已能進入系統。當另一台既有已信任裝置核准後：

- 原本 `device_approval_inbox` 的 pendingCount 會即時歸零，所以紅色數字會消失。
- 但登入中的新裝置只把 `currentDeviceTrust` 保存在 React 記憶體，沒有監聽自己的 approval request，因此 Header 仍顯示「待確認」直到重新登入。

v3.5.1 在 App.jsx 增加一個非常小的即時監聽：

- 只監聽 Backend 在登入時回傳的那一筆 `device_approval_requests/{requestId}`。
- 只有目前裝置狀態為「待確認／需要管理者確認」時才存在。
- request 變成 `approved` 後，立即把 Header 更新成「已信任」，然後停止監聽。
- 不讀完整 `account_devices`，不改變既有的省 reads 設計。

## 影響檔案

- `src/App.jsx`
- `tests/deviceApproval.test.js`

Backend Functions、Firestore Rules、其他 JSX 都不需要修改。

## 驗證

已執行：

```bash
node --check functions/deviceApproval.js
node --check functions/index.js
node --test tests/deviceApproval.test.js
```

結果：25 / 25 PASS。

完整 repository 仍需執行：

```bash
npm run build
```

## 部署

若 build 成功，本次只需部署 Frontend：

```bash
npm run deploy
```

不需要重新部署 Functions 或 Firestore Rules。
