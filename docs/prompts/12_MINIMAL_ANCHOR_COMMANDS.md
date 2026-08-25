# 12_MINIMAL_ANCHOR_COMMANDS.md

> 不想貼完整 Prompt 時的最短口令。

## 新視窗

```text
延續 DRCYJ SaaS。依 PROJECT_OPERATING_RULES + AI_START_HERE + CURRENT_STATE 工作；本次最新正式 source 最高優先。先確認 source 再改，完整檔案交付，做 regression/build、Documentation Impact、Git、精準 Deploy，不自行升 CURRENT_APP_VERSION。
```

## 中途變調

```text
重新定錨：停止依舊記憶推測，回到 PROJECT_OPERATING_RULES → CURRENT_STATE → 本次 docs → 最新正式 source。若缺 source 先列出，不要猜。
```

## 換視窗前

```text
先不要繼續開發，請依 03_CONTEXT_LIMIT_HANDOFF 產生完整 SESSION CHECKPOINT。
```

## 外部程式變更後

```text
先做 External Change Audit：以最新正式 source / git diff 為準同步 docs 與 tests，再開始新修改。
```

## 部署後

```text
做 Production Confirmation：只把有正式證據的項目升級為 PRODUCTION CONFIRMED，並更新 CURRENT_STATE 與受影響 docs。
```
