# 特殊價格成交認列政策｜待決策簽核表（隔離 Staging）

> Phase 2A-5B3B2-L3B2A；**本文件不是已核准政策，也不是正式環境設定。**
> Source anchor: `feature/activity-sales-center @ b35521313938d9b22d7f0cf3dc103c9a22740724`。
> `CURRENT_APP_VERSION=3.6.2` 不變。**禁止在政策、權限、跨月／關帳與測試完成前開通成交 Writer。**

## 決策原則

- 這套活動成交歸屬是 **活動分析用的候選資料**，不能自行加總進既有 `daily_reports`、`therapist_daily_reports`、Summary 或正式營收。正式 KPI 如何對帳仍須明示。
- 每項需要業務負責人提出文字方案、判斷依據與核准角色；**不應由 AI 代替決策**。完成九項文字草案 ≠ 取得授權。
- 三品牌（CYJ、安妞、伊啵）可以有不同政策，但必須保持品牌隔離；不能以跨品牌全域預設取代個別核准。
- 每項後續均須有：版本號、修改者／核准者授權校驗、信任裝置、時間、審計紀錄、Revision OCC、撤銷／更新管道及原始日報鎖定依據。

## 九項需要明確簽核的業務規則

| 代碼 | 必須明確回答的問題 | 狀態 |
|---|---|---|
| `ACTIVITY_RECOGNITION_DATE` | 特殊成交依原始回報日、提出申請日或核准日認列？跨日如何處理？ | 未定案 |
| `ACTIVITY_AMOUNT_BASIS` | 活動金額採實付額、拆分後額或其他？退費、折抵與其他優惠如何處理？ | 未定案 |
| `ACTIVITY_QUANTITY_BASIS` | 成交組數如何定義？部分套組及跨日服務如何計數？ | 未定案 |
| `ACTIVITY_ASP_FORMULA` | ASP 分子及分母如何選擇？特殊價與零成交是否納入？ | 未定案 |
| `DAILY_REPORT_RECONCILIATION` | 活動成交如何與既有日報核對，避免重複加總及金額不一致？ | 未定案 |
| `CROSS_MONTH_ATTRIBUTION` | 原回報月份與主管核准月份不同時，業績應歸入哪月？ | 未定案 |
| `CLOSED_PERIOD_TREATMENT` | 月結／關帳後才核准時，允許追溯、更正還是停在人工審查？ | 未定案 |
| `REJECTED_REOPEN_FLOW` | 退回後是否允許修訂再送？如何管理新的申請 ID、鎖與稽核鏈？ | 未定案 |
| `DAY_LOCK_TERMINAL_RELEASE` | 哪些終態允許解除每日鎖、再次確認零成交？誰有權操作？ | 未定案 |

## 授權簽核守門（未實作）

- [ ] 九項方案與理由皆已明確決定，且三品牌政策已核對。
- [ ] 財務／營運權責已明確核准跨月、關帳與正式報表對帳原則。
- [ ] 已指定允許修改政策的人員角色，並建立 Backend Authority 和受信裝置校驗。
- [ ] 每次政策修訂有品牌內 Revision OCC 與 append-only 審計。
- [ ] 現有日報／Summary／KPI 不可重複入帳的整合測試與 Regression 完成。
- [ ] 多主管同時核准、退回、跨月及關帳等 Emulator 測試完成。
- [ ] 正式部署／上線由使用者另行核准（目前禁止）。

## 本次 L3B2A 實作範圍

`functions/activitySalesSpecialPricePolicyDecisionDraft.js` 只是**純草案整理器**：

- 接受與 L3B1 工作底稿一致的九個代碼及文字提案；缺少條目保持 `UNDECIDED`。
- 防止傳入不存在的代碼、虛構核准欄位與偽造的 `postingAllowed`。
- 產生穩定 `draftFingerprint`，供未來專門審核系統參考；不能當授權 token。
- 九項齊備僅顯示 `READY_FOR_BUSINESS_REVIEW_NO_POSTING`。
- **永遠回傳 `postingAllowed=false`、金額／組數／ASP／認列月份均為 null，且 `financialPeriodAuthority=NOT_GRANTED`。**

本子批次只新增純契約／測試／Staging 文件，**不新增 Firestore reads、writes、queries、listener、Cloud Function、Security Rule 修改或正式部署**。

## L3B2B1 簽核狀態候選契約（純契約，尚未啟用）

- 來源錨點：隔離分支 `7e03cd4ae8d7cb3b404394e57e15825a1ee0639c`。
- 建議驗證順序：先由本品牌明確指定的 **BUSINESS 營運帳號** 表態，再由不同人的 **FINANCE 財務帳號** 表態。這是待授權的流程模型，**不是已確定的管理權限配置**。
- 每品牌授權名單需另行由具正式權限的管理流程建立 `activity-sales-special-price-signoff-authority-v1`；當文件不存在、停用、名單或修訂不符時，預設拒絕。身份不得自行跨品牌繼承權限。
- 每筆申請草案有獨立的 opaque `signoffId`，須鎖定草案 fingerprint 和簽核授權 revision/hash；多管理員以 `expectedRevision` OCC 排他，拒絕繞過營運關、本人核准、重複同人簽核、政策／草案被換版。
- **本批未實作**：授權名單管理 Writer、Credential/Trusted Device 現行授權查驗、Firestore transaction/私有簽核文件持久化、Rules、append-only Audit Backend 寫入、正式財務政策批准及特殊成交入帳。
- 即使兩關均通過，結果也只會是 `SIGNED_NO_POSTING`、`authorityVerified=false`、`businessPolicyApproved=false`、`postingAllowed=false`、`financialPeriodAuthority=NOT_GRANTED`，九項業務規則仍須經正式負責人確認。
- 本次只是新增純契約與測試、更新本簽核表／Staging；**沒有 Firestore reads/writes、Listener、Query、正式部署或 CURRENT_APP_VERSION 修改**。


## L3B2B2 — 隔離 Backend 簽核入口（未註冊，不能入帳）

本批新增待驗證的 Backend 簽核 Writer，必須驗證 Firebase Application Identity、目前 Trusted Device／credential 和品牌私有營運／財務名單，所有交易錨點重新在同一 Firestore Transaction 內驗證。
品牌政策 `activity_sales_special_price_signoff_authority/current` 目前**沒有正式管理入口或預設核准者**；未提供明確授權時拒絕執行。本批不代表使用者已核定上述九項財務政策。
簽核日誌為不可變審計，終態 `SIGNED_NO_POSTING`，仍然 **不允許**產生活動成交、ASP／組數、正式 KPI、關帳調整或解除日鎖。
