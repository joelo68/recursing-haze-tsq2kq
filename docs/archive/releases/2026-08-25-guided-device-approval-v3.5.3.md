# Guided Device Approval — v3.5.3 — 2026-08-25

> 歷史 release note。App 版本維持 `3.5.3`。

## 主要變更

- enforce 模式下，若目前是 Trusted 原裝置，而且自己的另一台新裝置有可自行驗證的 pending request，系統主動顯示引導，不要求一般使用者自行注意 Header Badge。
- 原裝置已在線時，自己的 `pendingCount` 出現後可主動進入確認流程。
- 原裝置尚未登入時，登入後若符合條件，優先顯示引導流程。
- 「是我本人」後才要求輸入新裝置顯示的 6 位碼。
- 「不是我」會拒絕該 request、將新裝置提高為風險狀態，並沿用登入安全 Telegram 通知。
- Guided flow 即使對最高管理者也只處理自己的 request，不把其他人的 admin-only 待辦強制跳進同一流程。
- 6 位碼達失敗上限時，request 結束，避免原 Trusted 裝置被失效 request 長時間卡住。

## 主要來源

```text
src/App.jsx
src/components/DeviceApprovalGate.jsx
src/components/DeviceApprovalPanel.jsx
functions/deviceApproval.js
tests/deviceApproval.test.js
```

## 架構原則

此功能使用極小的 account-scoped pending 訊號與特定 request realtime listener；不讀完整裝置歷史，也不使用固定秒數 polling。
