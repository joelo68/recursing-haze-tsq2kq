# Login Security → Telegram Alert v1 — 2026-08-25

> 歷史 release note。保留當時安全通知功能的設計與驗證紀錄；目前狀態以 `docs/CURRENT_STATE.md` 為準。

## 功能

獨立於一般 Telegram Gemini Agent 的登入安全事件通知，支援：

- 密碼在指定時間窗內連續錯誤達門檻
- 6 位裝置確認碼達失敗上限
- enforce 模式的新裝置沒有可用 Trusted approver，需要最高管理者協助
- 使用者在 Trusted Device 回報「不是我」
- 同帳號短時間不同裝置、具意義的異地登入
- 已停用／全品牌停用裝置再次嘗試登入

正常 Trusted 登入、一般成功登入與成功自我認證不主動發 Telegram 安全警示。

## 降噪與 Reads 原則

- account + event type 有 cooldown；「不是我」使用較短 cooldown。
- 行動網路城市漂移不直接當成異常。
- Telegram security routing 與營運 Telegram routing 分開。
- 異地判斷優先重用 `checkDeviceAccess` 已讀取的 `account_devices`，避免正常登入再多一次同類大型 read。
- Telegram 設定只在實際建立需要投遞的 `security_alerts` 事件時讀取。
- 不使用固定秒數 polling。

## 主要來源

```text
src/App.jsx
src/components/LoginView.jsx
src/components/TelegramAlertControlCenter.jsx
functions/deviceApproval.js
functions/index.js
firestore.rules
tests/deviceApproval.test.js
```

## 驗證紀錄

當時交付包已做 backend syntax、相關 JSX parser 與 Device Approval regression 驗證。

> Knowledge Base 不保存實際 Bot Token、API Key 或 numeric chat IDs。
