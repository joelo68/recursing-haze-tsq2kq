# docs/README.md

# 第二層專門文件索引

第二層把第一層的「總架構」拆成可以直接拿來除錯、交接與維護的專門文件。

| 文件 | 主要用途 |
|---|---|
| `FIREBASE_DATA_MODEL.md` | Firestore logical collections、path、Raw / Derived / Settings 關係 |
| `DASHBOARD_SUMMARY.md` | 當月即時、歷史 verified Summary、dirty / queue / repair / fallback |
| `AUTH_AND_SECURITY.md` | Login、初始密碼、low power、自動登出、device trust、Rules |
| `TELEGRAM_AGENT.md` | Gemini、tool、memory、policy、schedule、snapshot、task、source authority |
| `MAINTENANCE_TOOLS.md` | 維護中心工具用途、風險、正確操作順序 |
| `DATA_FLOW.md` | 從 Input / Raw 到 Summary / Dashboard / Telegram 的完整資料流 |

## 閱讀順序

一般接手：

```text
../README.md
→ ../ARCHITECTURE.md
→ ../DEVELOPMENT_GUIDE.md
→ DATA_FLOW.md
```

資料錯誤：

```text
FIREBASE_DATA_MODEL.md
→ DATA_FLOW.md
→ DASHBOARD_SUMMARY.md
→ ../DATA_IDENTITY_RULES.md
```

登入／安全：

```text
AUTH_AND_SECURITY.md
```

Telegram：

```text
TELEGRAM_AGENT.md
```

維護中心：

```text
MAINTENANCE_TOOLS.md
```

## Source-of-truth

這些文件只根據使用者提供的 2026-08-18 目前正常部署版本建立。

未從正式 source 確認的 schema / function behavior，不應靠 AI 補寫。
