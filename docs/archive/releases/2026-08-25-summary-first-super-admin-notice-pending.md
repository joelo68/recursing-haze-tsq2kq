# Summary-first 最高管理者新裝置提醒 — 2026-08-25

> 狀態：程式已完成／已驗證，但在本次文件整理時仍列為「待 Production deployment confirmation」。正式狀態以 `docs/CURRENT_STATE.md` 為準。

## 目的

在不新增固定輪詢的前提下，讓最高管理者對「需要主管協助建立第一台 Trusted Device」的 request 有高辨識度 Security Action Card，同時移除為判斷提醒而額外掃 pending collection 的 read。

## Summary-first

`security_summary/device_approvals` 準備直接維護：

```text
adminAssistancePendingCount
adminAssistancePendingItems
latestAdminAssistanceRequestId
latestAdminAssistanceUserName
latestAdminAssistanceRole
latestAdminAssistanceDevice
latestAdminAssistanceAtText
```

只有 enforce 且 `selfApprovalAllowed === false` 的 request 進入最高管理者協助佇列。

最高管理者沿用原本的 summary `onSnapshot`，只有真的顯示某一筆通知卡時才對該 request 建立單筆 realtime listener。

## UX

```text
新 admin-only request
→ Header Badge 即時更新
→ 右上 Security Action Card 滑入
→ [查看並確認] / [稍後處理]
```

「查看並確認」才開啟正式 `DeviceApprovalPanel`；通知卡本身不是大型 Panel。

如果另一位最高管理者先處理，通知卡可顯示「已由 XXX 完成確認」後收起。

## 主要來源

```text
src/App.jsx
src/components/DeviceApprovalPanel.jsx
functions/deviceApproval.js
tests/deviceApproval.test.js
tests/superAdminDeviceNotice.test.js
```

## Reads 原則

- 不新增 `setInterval` / polling。
- 不新增全品牌 `account_devices` 常駐 listener。
- 移除「brand pending 變動後再 query admin-only pending」的額外 query。
- 使用既有 summary listener + 真正顯示時的單筆 request listener。
