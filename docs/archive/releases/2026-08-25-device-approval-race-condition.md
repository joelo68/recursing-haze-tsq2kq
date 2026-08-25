# Device Approval Race Condition Hardening — 2026-08-25

> 歷史／已驗證修正紀錄。Production 狀態以 `docs/CURRENT_STATE.md` 為準。

## 目的

多位最高管理者同時處理同一筆 pending 裝置申請時，採 first-resolver-wins：

```text
第一位 transaction 成功者 → 實際生效
第二位／後續處理者         → 回傳 alreadyResolved，不得假成功
```

後續處理者可取得：

```text
status
resolvedBy
resolvedAtText
alreadyResolved
message
```

race loser 不應再執行 secret deletion、額外 Telegram side effect、成功 audit log 或 `ok: true` 成功回應。

## 主要來源

```text
functions/deviceApproval.js
tests/deviceApproval.test.js
```

前端沿用既有 `DeviceApprovalPanel` 的 `result.message` 顯示能力，不需要為 race-condition 另做第二套審核 UI。
