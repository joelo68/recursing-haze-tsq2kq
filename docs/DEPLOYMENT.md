# DEPLOYMENT.md

# FRD-A5 Annual Data Authority Production Closeout — 2026-10-01

本節記錄 `Frontend Responsibility Decomposition A5 — Annual Data Authority Extraction` 的正式 Frontend deployment 與 human production smoke。Runtime 將 App-level Annual Firestore I/O 與 8 個 Annual runtime states 從 `src/App.jsx` 收斂至 `src/hooks/useAnnualDataAuthority.js`；`App.jsx` 保留 hook wiring / AppContext publication，`AnnualView.jsx` 的 precise `monthly_targets` point-read fallback 維持 consumer-specific ownership。

正式 lineage：

```text
runtime source commit                = dda5279996be66552a362026862b4fed96c98f9d
runtime parent                       = 5e249af7cee8691d6874c027de15cf15d279455c
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

Validation：

```text
targeted regression                  = 90 / 90 PASS
local detached-staging validation    = PASS
full ci:validate                     = PASS
production build                     = PASS
git diff / exact scope gate          = PASS
runtime correction after validation  = NO
```

精準 Frontend deployment：

```bash
npm run deploy
```

Repository deploy contract：

```text
npm run deploy
→ npm run build
→ gh-pages -d dist
Firebase Hosting                     = NOT DEPLOYED
Functions                            = NOT DEPLOYED
Firestore Rules                      = NOT DEPLOYED
```

Frontend Production evidence：

```text
previous gh-pages                    = 3e87d54187d3325d2aeb2b04c68718eb642883e2
production gh-pages                  = 0dc5f94005173720d33fd71f3308585cae6cff02
production index asset               = assets/index-Cqu-qZiT.js
live convergence                     = PASS
live index HTTP                      = 200
live asset HTTP                      = 200
technical production smoke           = PASS
human production smoke               = PASS
```

Human smoke scope：

```text
Annual current year                  = PASS
Annual historical trusted month      = PASS
quarter / month / custom interval    = PASS
manager / store filters              = PASS
CYJ -> Anniu -> Yibo -> CYJ isolation = PASS
```

Runtime / read boundary：

```text
Annual App-level I/O owner           = src/hooks/useAnnualDataAuthority.js
App.jsx responsibility               = hook wiring + AppContext publication
AnnualView precise target fallback   = preserved
dashboard_summary                    = selected-year query + onSnapshot
summary_recalc_flags                 = selected-year query + onSnapshot
monthly_targets_summary              = selected-brand-year getDocs
monthly_aggregated                   = fallback-month-only query + onSnapshot
Firestore read topology delta        = 0
listener topology delta              = 0
new read                             = 0
new listener                         = 0
new query                            = 0
new polling                          = 0
brand path resolver                  = unchanged getCollectionPath()
security authority                   = unchanged
Backend deployment                   = NO / NOT REQUIRED
Firestore Rules deployment           = NO / NOT REQUIRED
```

最終狀態：

```text
IMPLEMENTED                          = YES
VALIDATED                            = YES
COMMITTED                            = YES
PUSHED                               = YES
DEPLOYED                             = YES
PRODUCTION CONFIRMED                 = YES
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

Documentation Impact：`CURRENT_STATE.md`、`DEPLOYMENT.md`；`SYSTEM_SOURCE_MAP.md` ownership 已於 runtime commit 完成，無需再改。Docs-only closeout commit 不需要重新部署 Frontend。

---

# FRD-A4 Dead Dashboard Read-Policy Mirror Production Closeout — 2026-10-01

本節記錄 `Frontend Responsibility Decomposition A4 — Dead Dashboard Read-Policy Mirror Retirement` 的正式 Frontend deployment 與 human production smoke。Runtime 退役 `useDashboardStats.js` 內沒有 consumer 的 `dashboardTargetReadPolicy` mirror，並移除其未使用的 `resolveHistoricalDashboardReadPolicy` / `inspectHistoricalReportingCalendarTrust` dependencies。真正的 historical `daily_reports` read-topology authority 維持在 `src/App.jsx`；Dashboard 的 Summary presentation trust / fail-closed semantics 保持不變。

正式 lineage：

```text
runtime source commit                = 0ae25e5bed7dbd442b956e796de251e1e91514c9
runtime parent                       = 00136d77a3b61d17e2da5eb2fc0d961193ebe690
GitHub CI Validation Gate            = 36834767988 / SUCCESS
Critical Browser E2E                 = 36834768078 / SUCCESS
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

Validation note：

```text
initial targeted regression          = 63 PASS / 1 stale assertion FAIL
stale assertion                      = expected removed Dashboard targetYearMonth mirror
correction                           = tests/dashboardHistoricalReads.test.js only
final targeted regression            = PASS
local full ci:validate               = PASS
local production build               = PASS
runtime correction after first run   = NO
```

精準 Frontend deployment：

```bash
npm run build
npx --no-install gh-pages -d dist
```

Frontend Production evidence：

```text
previous gh-pages                    = d15bd422e3537db98ecbc9141a5224ce78c741c6
production gh-pages                  = 3e87d54187d3325d2aeb2b04c68718eb642883e2
production index asset               = assets/index-BCrs-BGv.js
production asset SHA-256             = e621019aa59039cddd721d02f3e8808f49106e2b7d8d5a7cc43cb74245414f0b
live convergence                     = PASS
live index HTTP                      = 200
live asset HTTP                      = 200
human production smoke               = PASS
```

Human smoke scope：

```text
CYJ current-month Dashboard          = PASS
CYJ verified historical Dashboard    = PASS
historical manager/store filters     = PASS
CYJ -> Anniu -> Yibo isolation       = PASS
dirty/unverified detail fallback     = PASS
```

Runtime / read boundary：

```text
historical daily_reports policy owner = src/App.jsx
Dashboard dead read-policy mirror     = removed
Dashboard presentation trust owner    = preserved
Dashboard direct Firestore primitive  = 0
Firestore read topology delta         = 0
listener topology delta               = 0
new read                              = 0
new listener                          = 0
new query                             = 0
new polling                           = 0
brand physical paths                  = unchanged
security authority                    = unchanged
Backend deployment                    = NO / NOT REQUIRED
Firestore Rules deployment            = NO / NOT REQUIRED
```

最終狀態：

```text
IMPLEMENTED                          = YES
VALIDATED                            = YES
COMMITTED                            = YES
PUSHED                               = YES
DEPLOYED                             = YES
PRODUCTION CONFIRMED                 = YES
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

Documentation Impact：`CURRENT_STATE.md`、`DEPLOYMENT.md`；`SYSTEM_SOURCE_MAP.md` ownership 已於 runtime commit 更新，無需再改。

---

# FRD-A3 Therapist Summary Listener Production Closeout — 2026-10-01

本節記錄 `Frontend Responsibility Decomposition A3 — Therapist Summary Listener Extraction` 的正式 Frontend deployment 與 human production smoke。Runtime 將歷史 Dashboard 人員績效 `therapist_summary/{selectedYearMonth}` 的單文件 listener / local load-state owner 從 `useDashboardStats.js` 抽離至 `useDashboardTherapistSummary.js`。Dashboard 保留 Summary trust、Formal fallback 與 Therapist KPI filtering / ranking / presentation composition。

正式 lineage：

```text
runtime source commit                = a32066c82c6fb81e1e940cf285b548a6535d6ead
runtime parent                       = 14b82a6c00ae34d3dca363912c21f03738a7ae02
GitHub CI Validation Gate            = 36831328670 / SUCCESS
Critical Browser E2E                 = 36831328601 / SUCCESS
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

精準 Frontend deployment：

```bash
npm run build
npx --no-install gh-pages -d dist
```

Frontend Production evidence：

```text
previous gh-pages                    = 86c745d25243fec93d7a9d8fbefc79d5680177dc
production gh-pages                  = d15bd422e3537db98ecbc9141a5224ce78c741c6
production index asset               = assets/index-DIFOcXH2.js
production asset SHA-256             = 1f8c567c9fd9dad9b9ffcab56136215bccd709748458a960ad8fa32bfaa79aa9
live convergence                     = PASS
live index HTTP                      = 200
live asset HTTP                      = 200
human production smoke               = PASS
```

Human smoke scope：

```text
CYJ current-month store mode         = PASS
CYJ current-month therapist mode     = PASS
CYJ historical therapist Summary     = PASS
CYJ -> Anniu -> Yibo isolation       = PASS
switch-back to CYJ same month        = PASS
therapist -> store -> therapist      = PASS
```

Runtime / read boundary：

```text
therapist Summary path               = getCollectionPath("therapist_summary") / selectedYearMonth
listener activation                 = historical + therapist view + module enabled only
listener count                      = one single-document onSnapshot when active
steady-state read topology delta     = 0
new query                            = 0
new polling                          = 0
brand physical path resolver         = unchanged
consumer authority anchor            = brand + yearMonth
Dashboard direct Firestore primitive = 0
Annual KPI owner                     = unchanged
Projection Model owner               = unchanged
Backend deployment                   = NO / NOT REQUIRED
Firestore Rules deployment           = NO / NOT REQUIRED
```

最終狀態：

```text
IMPLEMENTED                          = YES
VALIDATED                            = YES
COMMITTED                            = YES
PUSHED                               = YES
DEPLOYED                             = YES
PRODUCTION CONFIRMED                 = YES
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

Documentation Impact：`CURRENT_STATE.md`、`DEPLOYMENT.md`；`SYSTEM_SOURCE_MAP.md` ownership 已於 runtime commit 更新，無需再改。

---

# FRD-A2 Projection Model Loader Production Closeout — 2026-10-01

本節記錄 `Frontend Responsibility Decomposition A2 — Projection Model Loader Extraction` 的正式 Frontend deployment 與 human production smoke。Runtime 將 Dashboard `projection_models/current` 的單一 Firestore point-read / load-state owner 從 `useDashboardStats.js` 抽離至 `useDashboardProjectionModel.js`；Projection trust、Lifecycle、Reporting Calendar、System Exclusion 與 projection presentation semantics 仍由 Dashboard owner 組合。

正式 lineage：

```text
runtime source commit                = a301aedbac3256f2164733d6ec405d0e4f12559a
runtime parent                       = fcd06f82f043139d482375e9abadb82afc51ade7
GitHub CI Validation Gate            = 36827548200 / SUCCESS
Critical Browser E2E                 = 36827548219 / SUCCESS
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

精準 Frontend deployment：

```bash
npm run build
npx --no-install gh-pages -d dist
```

Frontend Production evidence：

```text
previous gh-pages                    = 42132459e2daff375b1910baaa595abc9b75fd42
production gh-pages                  = 86c745d25243fec93d7a9d8fbefc79d5680177dc
production index asset               = assets/index-DR_namU9.js
production asset SHA-256             = 715c8e7613fe61ac9a295c417c00da830769545ffd022a946f15852e0373dac4
live convergence                     = PASS
live asset HTTP                      = 200
human production smoke               = PASS
```

Human smoke scope：

```text
CYJ current-month Dashboard          = PASS
Anniu current-month Dashboard        = PASS
Yibo current-month V1/fallback       = PASS
cross-brand switch-back isolation    = PASS
manager/store filter + projection    = PASS
therapist performance page           = PASS
```

Runtime / read boundary：

```text
projection model path                = getCollectionPath("projection_models") / current
normal activated reads               = 1 point read / current brand-month activation
steady-state read delta              = 0
new listener                         = 0
new query                            = 0
new polling                          = 0
brand physical path resolver         = unchanged
Projection trust owner               = useDashboardStats
therapist_summary listener owner     = useDashboardStats
Backend deployment                   = NO / NOT REQUIRED
Firestore Rules deployment           = NO / NOT REQUIRED
```

最終狀態：

```text
IMPLEMENTED                          = YES
VALIDATED                            = YES
COMMITTED                            = YES
PUSHED                               = YES
DEPLOYED                             = YES
PRODUCTION CONFIRMED                 = YES
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

Documentation Impact：`CURRENT_STATE.md`、`DEPLOYMENT.md`；`SYSTEM_SOURCE_MAP.md` ownership 無變更。

---

# FRD-A1 Annual KPI Benchmark Loader Deployment Reconciliation — 2026-10-01

本節補齊 FRD-A1 `Annual KPI Benchmark Loader Extraction` 的實際 deployment evidence，修正文檔仍停留在 local/pending 的狀態。Runtime 本身沒有在本 docs-only reconciliation 中再修改。

正式 lineage：

```text
runtime source commit                = de12ab8e20ed67484fcdd65bdfdc0e8ae1323c45
runtime parent                       = 5f1d3e8faed0fd2931894e5bac9357d40d0a8243
GitHub CI Validation Gate            = 36821708412 / SUCCESS
Critical Browser E2E                 = 36821708537 / SUCCESS
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

Frontend Production evidence：

```text
previous gh-pages                    = a7054ef71738413caf5df1c72596adb758a349dc
production gh-pages                  = 31c2ed6964122bcb055de9087cbb2eeb46e1f874
production index asset               = assets/index-B76_SBCQ.js
live convergence                     = PASS
live asset HTTP                      = 200
```

Runtime / read boundary：

```text
annual_kpi_summary/{year}            = same single-document getDoc path
brand-year session cache             = unchanged semantics
normal cache miss reads              = 1 point read / activated brand-year
steady-state read delta              = 0
new listener                         = 0
new query                            = 0
new polling                          = 0
brand paths changed                  = NO
Backend deployment                   = NO / NOT REQUIRED
Firestore Rules deployment           = NO / NOT REQUIRED
```

Human verification boundary：

```text
FRD-A1 specific three-brand benchmark/cache-isolation smoke
= NOT INDEPENDENTLY EXECUTED

Annual YTD smoke performed later
= PASS for Annual YTD interval behavior
= intentionally not counted as FRD-A1-specific benchmark/cache evidence
```

因此本節只把已實際完成的 deployment / automated validation 寫實，不把未執行的 FRD-A1-specific human smoke 虛構成 PASS。

狀態：

```text
IMPLEMENTED                          = YES
VALIDATED                            = YES
COMMITTED                            = YES
PUSHED                               = YES
DEPLOYED                             = YES
PRODUCTION CONFIRMED                 = NO / FRD-A1-SPECIFIC HUMAN SMOKE NOT INDEPENDENTLY EXECUTED
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

Documentation Impact：`CURRENT_STATE.md`、`DEPLOYMENT.md`；`SYSTEM_SOURCE_MAP.md` ownership 無變更。

---

# Annual YTD Provisional-Month Fix Production Closeout — 2026-10-01

本次為 Frontend-only Production deployment；修正 Annual 共用 interval aggregation contract，使 current-month `PROVISIONAL` 尚未形成 numeric actual 時，不會抹除既有 YTD actual，同時保留 historical `DATA_INCOMPLETE` fail-closed。

正式 lineage：

```text
runtime source commit                = cd57c97bb944756bd344c3acead6ced72b5ae17c
runtime parent                       = de12ab8e20ed67484fcdd65bdfdc0e8ae1323c45
GitHub CI Validation Gate            = 36823578014 / SUCCESS
Critical Browser E2E                 = 36823578115 / SUCCESS
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

精準 Frontend deployment：

```bash
npm run build
npx --no-install gh-pages -d dist
```

Frontend Production evidence：

```text
previous gh-pages                    = 31c2ed6964122bcb055de9087cbb2eeb46e1f874
production gh-pages                  = 42132459e2daff375b1910baaa595abc9b75fd42
production index asset               = assets/index-DU1Od94X.js
production asset SHA-256             = 0f1ecf8de26f725e4973bc9bff3ae4407fb081ec36d013440939b3b1c2d14e71
live asset convergence               = PASS
live asset HTTP                      = 200
human production smoke               = PASS
```

Human smoke scope：

```text
2026 / 整年度 / 全品牌
upper Annual interval KPI cards      = numeric / expected YTD behavior
current PROVISIONAL null             = does not erase historical YTD
result                               = PASS
```

Runtime impact：

```text
Firestore reads change               = 0
new listener                         = 0
new query                            = 0
new polling                          = 0
brand paths changed                  = NO
Backend deployment                   = NO / NOT REQUIRED
Firestore Rules deployment           = NO / NOT REQUIRED
```

最終狀態：

```text
IMPLEMENTED                          = YES
VALIDATED                            = YES
COMMITTED                            = YES
PUSHED                               = YES
DEPLOYED                             = YES
PRODUCTION CONFIRMED                 = YES
CURRENT_APP_VERSION                  = 3.6.0 unchanged
```

Documentation Impact：`CURRENT_STATE.md`、`DEPLOYMENT.md`。

---

# P2-B1B1 Annual KPI Frontend Mirror Alias Retirement Production Closeout — 2026-10-01

本節記錄 P2-B1B1 的正式 Frontend deployment 與 human production smoke。Runtime 只退役 Frontend Annual KPI normalized / filtered view-model 已無 consumer 的 top-level mirror aliases；V1 persisted `annual_kpi_summary` input reader、Backend persisted compatibility writer、manual rebuild response、scheduled rebuild 與 top-level `basedMonths / basedMonthCount` 均保留。

正式 lineage：

```text
source commit                       = 7f3558885454e7863b259ee645e14b7d385eeb2b
parent source                       = 1591c60b5cda253409025daa054b437826e4a8cc
GitHub CI Validation Gate           = 36818278205 / SUCCESS
Critical Browser E2E                = 36818278168 / SUCCESS
CURRENT_APP_VERSION                 = 3.6.0
```

精準 Frontend deployment：

```bash
npm run build
npx --no-install gh-pages -d dist
```

`package.json` 的 `npm run deploy` 會因 `predeploy` 與 `deploy` 各自執行 build 而重複建置，因此本批採上述等價的單次 production build + `gh-pages -d dist` publish；沒有擴大 deployment scope。

Frontend Production evidence：

```text
previous gh-pages                   = 2b148aeaedbfcd3c8c096e631ea91b7aefaef597
production gh-pages                 = a7054ef71738413caf5df1c72596adb758a349dc
production index asset              = assets/index-DzMFEHWb.js
initial live convergence probe      = PENDING
live asset HTTP                     = NOT_RECORDED
human production smoke              = PASS
```

第一次 deployment script 的 CDN convergence probe 尚未收斂，因此不把未實際取得的 live asset HTTP 狀態寫成 PASS。其後 GitHub `gh-pages` branch 已確認指向新 production asset，並完成使用者 requested human production smoke；因此本批 `PRODUCTION CONFIRMED = YES`。

Human Production smoke：

```text
requested scope                     = CYJ / 安妞 / 伊啵
Dashboard / Annual benchmark smoke  = PASS
manager / store scope interaction   = PASS (requested smoke scope)
```

本批沒有 Backend change、Firestore Rules change、Firestore path change、新 listener/query/polling 或 `CURRENT_APP_VERSION` bump；steady-state Firestore reads change = 0。因此沒有 Functions / Rules deployment。

最終狀態：

```text
IMPLEMENTED                         = YES
VALIDATED                           = YES
COMMITTED                           = YES
PUSHED                              = YES
DEPLOYED                            = YES
PRODUCTION CONFIRMED                = YES
BACKEND DEPLOYED                    = NO / NOT REQUIRED
FIRESTORE RULES DEPLOYED            = NO / NOT REQUIRED
CURRENT_APP_VERSION                 = 3.6.0 unchanged
```

Documentation Impact：production closeout 更新 `CURRENT_STATE.md`、`DEPLOYMENT.md`；其他 canonical docs = None。

---

# P2-B1A Dashboard Legacy Shadow Retirement Production Closeout — 2026-10-01

本節記錄 P2-B1A 的正式 Frontend deployment 與 human production smoke。Runtime 只退役 Historical Dashboard 已無 consumer 的 shadow aliases；沒有修改 Summary Writer、Formal KPI semantics、System Exclusion、Identity、Firestore path、Backend、Rules 或品牌隔離。

正式 lineage：

```text
source commit                       = 87961bc7c1ae0f7d38ef204f332bd0cf53736e8a
GitHub CI Validation Gate           = 36812133431 / SUCCESS
Critical Browser E2E                = 36812133231 / SUCCESS
CURRENT_APP_VERSION                 = 3.6.0
```

精準 Frontend deployment：

```bash
npm run deploy
```

Frontend Production evidence：

```text
previous gh-pages                   = ee102ca9813323df1b81ee281a0569f79861174d
production gh-pages                 = 2b148aeaedbfcd3c8c096e631ea91b7aefaef597
production index asset              = assets/index-DrGETCuQ.js
live asset convergence              = PASS
live asset HTTP                     = 200 PASS
```

本批沒有 Backend change、Firestore Rules change、Firestore path change、新 listener/query/polling 或 `CURRENT_APP_VERSION` bump，因此沒有 Functions / Rules deployment；steady-state Firestore reads change = 0。

Human Production smoke：

```text
CYJ Dashboard                       = PASS
安妞 Dashboard                      = PASS
伊啵 Dashboard                      = NOT_TESTED
```

伊啵本次未執行 human smoke，因此不宣稱伊啵 smoke PASS；這不改寫已完成的 automated validation，也不把未測品牌描述成已人工確認。

最終狀態：

```text
IMPLEMENTED                         = YES
VALIDATED                           = YES
COMMITTED                           = YES
PUSHED                              = YES
DEPLOYED                            = YES
PRODUCTION CONFIRMED                = YES (CYJ / 安妞 human smoke)
CURRENT_APP_VERSION                 = 3.6.0
```

Documentation Impact：`CURRENT_STATE.md`、`DEPLOYMENT.md`。

---

# Trainer / Therapist Account Authority Production Closeout — 2026-10-01

本節記錄 `管師帳號` 教專 authority incident 的正式 Production deployment 與 human smoke。Runtime source、Backend、Frontend、CI 與正式畫面已完成收斂。

正式 lineage：

```text
source commit                       = 948c46140897812a4914320d0129395f0df7f11c
GitHub CI Validation Gate           = 36713591814 / SUCCESS
Critical Browser E2E                = 36713591849 / SUCCESS
CURRENT_APP_VERSION                 = 3.6.0
```

精準 Backend deployment：

```bash
firebase deploy \
  --project cyjsituation-analysis \
  --only functions:manageTherapistMaster
```

Backend Production evidence：

```text
Function                            = manageTherapistMaster
generation                          = Gen2
state                               = ACTIVE
updateTime                          = 2026-09-30T12:20:46.072943598Z
unauthenticated POST                = HTTP 401 PASS
```

精準 Frontend deployment：

```bash
npm run deploy
```

Frontend Production evidence：

```text
previous gh-pages                   = ea1153245b6777d262ba37b1c53cacb47d07f525
Production gh-pages                 = ee102ca9813323df1b81ee281a0569f79861174d
Production index asset              = assets/index-D1S6Yt07.js
live asset convergence              = PASS
live asset HTTP                     = 200 PASS
```

本 incident 沒有修改 `firestore.rules`，因此沒有 Rules deploy；也沒有 blanket Functions deploy、Firebase Hosting deploy、IAM change 或 `CURRENT_APP_VERSION` bump。

正式 Human Production smoke：

```text
brand                               = 安妞

trainer login                       = PASS
therapist-manager no sync hang      = PASS
search / open therapist             = PASS

trainer create control              = VISIBLE
trainer update control              = VISIBLE
trainer archive control             = VISIBLE
trainer reset-password control      = VISIBLE
trainer reveal-password control     = HIDDEN
trainer permanent-delete control    = HIDDEN

highest-admin login                 = PASS
highest-admin therapist-manager     = PASS
highest-admin reveal-password       = VISIBLE
highest-admin permanent-delete      = VISIBLE

representative trainer mutation
archive → restore                   = PASS
```

Production mutation smoke 刻意採可逆的 `archive → restore`；沒有為了 closeout 對正式帳號逐項執行 `create`、`update` 或 `reset_password` destructive smoke。

最終狀態：

```text
IMPLEMENTED                         = YES
VALIDATED                           = YES
COMMITTED / PUSHED                  = YES
BACKEND DEPLOYED                    = YES
FRONTEND DEPLOYED                   = YES
FIRESTORE RULES DEPLOYED            = NO / NOT REQUIRED
PRODUCTION CONFIRMED                = YES
INCIDENT CLOSED                     = YES
CURRENT_APP_VERSION                 = 3.6.0 unchanged
```

Documentation Impact：本 Production closeout 更新 `CURRENT_STATE.md`、`DEPLOYMENT.md`；其他 canonical docs = None。

---

# P1-C Production Observability Deployment Record — 2026-09-24

P1-C runtime 只包含一支新 Function 與既有 GitHub Pages Frontend 更新。

精準部署：

```bash
firebase deploy \
  --project cyjsituation-analysis \
  --only functions:getProductionHealthSnapshot

npm run deploy
```

不得改成全量 Functions deploy；本批沒有 Firestore Rules、Firebase Hosting、Firestore data 或 IAM 變更。

部署順序：

```text
1. source / CI / Browser E2E green
2. deploy functions:getProductionHealthSnapshot
3. confirm Gen2 Function ACTIVE
4. unauthenticated POST returns 401
5. npm run deploy
6. confirm gh-pages advanced
7. confirm live index asset convergence + HTTP 200
8. human Production smoke across CYJ / 安妞 / 伊啵
```

正式 Production：

```text
source commit             = af5cf63556ddd908edd1c4307a2ddaddc6f1383f
Function                  = getProductionHealthSnapshot
Function state            = ACTIVE
Function updateTime       = 2026-09-24T06:33:00.349869783Z
Production gh-pages       = 20e3919932334b3b26cb252b21489f78ee0ad88d
Production index asset    = assets/index-BeSH78jj.js
Unauthenticated guard     = HTTP 401 PASS
Live asset                = HTTP 200 PASS
Human Production smoke    = PASS
CURRENT_APP_VERSION       = 3.6.0
```

P1-C 沒有 Rules rollout window，因此不需要 P0 類型的 Backend → Frontend → Rules lockdown sequencing。

---


# P0 Authority Cutover Deployment Order Override — 2026-09-24

當安全改版同時符合以下條件：

```text
old Frontend = 仍直接寫某 Firestore path
new Frontend = 改走 Backend authority
new Rules    = 將該 Browser write 關閉
```

不得機械式使用固定「Backend → Rules → Frontend」順序；若 Rules 先鎖，舊 Frontend 會在 rollout window 暫時失去寫入能力。

A2-2 驗證過的安全順序：

```text
1. deploy Backend authority
2. confirm Backend ACTIVE
3. deploy new Frontend
4. confirm live asset convergence
5. Production UI smoke through Backend
6. deploy Firestore Rules lockdown
7. active Rules release / source readback
8. final post-Rules Production UI smoke
```

本次正式 deploy：

```bash
firebase deploy \
  --project cyjsituation-analysis \
  --only functions:manageManagementDelegation

npm run deploy

firebase deploy \
  --project cyjsituation-analysis \
  --only firestore:rules
```

只部署真正異動 runtime；不得改成 blanket `firebase deploy`。

Rules deployment 與 Rules readback 是兩個不同 evidence：

```text
firebase deploy 顯示 compiled / released / Deploy complete
→ Rules 已發布

active release/source readback
→ 額外確認 live Rules 與 repository source 一致
```

若 readback API 因本機 OAuth quota-project / API access 失敗，不可把它誤判成「Rules deploy 沒有成功」；應補 readback verification，不重複部署已成功 release 的 Rules。

A2-2 runtime anchors：

```text
runtime source commit = 6c0ea5104d4b75927c2b58edd9cfa37113476c6f
production gh-pages   = 918ef50f364801eb0f4882ce2b08706259f75672
active ruleset        = projects/cyjsituation-analysis/rulesets/aca6332c-620d-4b89-87a7-e6cde6b62475
CURRENT_APP_VERSION   = 3.6.0
```

---

> 本文件分成「目前 source 可確認的部署設定」與「不可由目前 repository 確認的項目」。  
> 不把過去聊天中的部署習慣自動當成 repository 事實。

# 1. Frontend

Root `package.json`：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "predeploy": "npm run build",
    "deploy": "npm run build && gh-pages -d dist"
  }
}
```

因此目前 source 可確認的前端發布：

```bash
npm run deploy
```

實際執行：

```text
npm run build
    ↓
vite build
    ↓
dist/
    ↓
gh-pages -d dist
```

Homepage：

```text
https://joelo68.github.io/recursing-haze-tsq2kq
```

Vite base：

```text
/recursing-haze-tsq2kq/
```

# 2. PWA

`vite.config.js`：

```text
VitePWA
registerType = autoUpdate
display      = standalone
```

因此前端 build/deploy 修改可能同時影響 PWA cache / installed app 更新。

`index.html` 另外使用 no-cache meta，但真正 PWA lifecycle 仍由 Vite PWA plugin 產物管理。

# 3. Firebase Functions

`functions/package.json`：

```json
{
  "engines": {
    "node": "22"
  },
  "scripts": {
    "serve": "firebase emulators:start --only functions",
    "shell": "firebase functions:shell",
    "start": "npm run shell",
    "deploy": "firebase deploy --only functions",
    "logs": "firebase functions:log"
  }
}
```

完整 Functions deploy：

```bash
cd functions
npm run deploy
```

等同：

```bash
firebase deploy --only functions
```

Functions runtime：

```text
Node.js 22
```

## 3.1 Functions deployment package hygiene

`firebase.json` 的 Functions source 是整個：

```text
functions/
```

因此 `functions/` 內未被 ignore 的非 runtime 檔案，也可能被帶入 Functions deployment package。

正式規則：

```text
functions/
→ 只保留 runtime source、runtime support module、package metadata 與必要 config

docs/
→ 唯一 canonical Project Knowledge Base
```

禁止在 `functions/` 重新放入：

```text
Project Knowledge Base 的 .md 副本
functions/docs/ 文件鏡像
KNOWLEDGE_BASE_MANIFEST.json
index.backup.js 或其他 runtime source backup copy
```

Runtime rollback／歷史版本應使用 Git history，不在 Functions source directory 保存 backup source。

2026-09-15 A2B-1 hygiene retirement 已移除 17 個無 runtime/test/script reference 的舊副本／backup；稽核時它們合計 270,897 bytes，且原本全部屬於 package-eligible。

正式 Functions deploy 前仍必須先確認：

```text
branch / HEAD / origin/main 正確
worktree clean
實際異動 function 已完成 syntax / regression
```

# 4. Firebase Root Config

`firebase.json` 目前配置：

## Firestore Rules

```text
firestore.rules
```

## Functions

```text
source = functions
codebase = default
disallowLegacyRuntimeConfig = true
```

## Hosting

```text
public = dist
rewrite ** → /index.html
```

## Emulator

```text
functions = 5001
firestore = 8080
UI enabled
singleProjectMode = true
```

# 5. GitHub Pages 與 Firebase Hosting 的關係

目前 repository 同時存在：

- Root `package.json` 的 GitHub Pages deploy script
- `firebase.json` 的 Firebase Hosting config

但目前提供的 source **沒有一個 root script 明確執行 `firebase deploy --only hosting`**。

因此文件只記錄：

> GitHub Pages deploy 是 package script 可直接確認的 frontend deploy 路徑。  
> Firebase Hosting config 存在，但目前不能只靠 repository 判定它是否為正式日常發布入口。

如果未來要把 Firebase Hosting 正式納入標準發布流程，應再明確建立 script / documented command。

# 6. `.github/workflows`

使用者已在專案根目錄執行：

```bash
find .github -maxdepth 2 -type f 2>/dev/null
```

結果沒有輸出。

因此目前可確認：

```text
沒有可見的 .github/workflows workflow 檔案
```

不應假設 GitHub Actions 自動部署存在。

# 7. `.firebaserc`

目前 repository root 已確認存在 `.firebaserc`：

```json
{
  "projects": {
    "default": "cyjsituation-analysis"
  }
}
```

因此 default alias 可由 source 確認；正式 deploy 仍建議明確加上 `--project cyjsituation-analysis`，避免 CLI context 誤用。

# 8. `firestore.indexes.json`

使用者目前專案未看到 `firestore.indexes.json`。

`firebase.json` 也只指定：

```json
"firestore": {
  "rules": "firestore.rules"
}
```

因此目前：

> Composite Indexes 未由 repository source file 文件化。

若日後要納入版本控管，應以 Firebase 實際 index 設定為來源建立，不要從 query 程式碼猜測。

# 9. 部署前驗證

依實際改動範圍跑對應檢查。

Frontend：

```bash
npm run build
```

Store Identity：

```bash
node --test tests/storeIdentity.test.js
```

一般 Functions entry：

```bash
node --check functions/index.js
```

Device Security：

```bash
node --check functions/deviceApproval.js
node --test tests/deviceApproval.test.js
```

若目前版本含 Summary-first 最高管理者提醒專項測試：

```bash
node --test tests/superAdminDeviceNotice.test.js
```

Telegram prompt：

```bash
node --check functions/telegram/prompts.js
```

Security／Summary／Data Model 類修改，不能只用「網頁有打開」當唯一驗證。

# 10. 變更範圍原則

只部署真的有改的範圍。

| 修改內容 | 一般部署方式 |
|---|---|
| docs only | 只需 Git，不需 runtime deploy |
| React／Vite frontend | build + 實際使用的 frontend hosting target |
| Device Security Function 行為 | 只部署受影響的 Firebase Functions |
| Firestore Rules | `firebase deploy --only firestore:rules` |
| frontend + Device Security summary contract | Functions 先、Frontend 後 |
| `functions/index.js` Telegram trigger | 只部署受影響 trigger Functions |

## Root `npm run deploy` 不等於 Firebase Hosting

目前 repository 文件記錄：

```text
npm run deploy
→ npm run build
→ gh-pages -d dist
```

也就是 GitHub Pages 路徑。

Firebase Hosting 是另外的 CLI target：

```bash
firebase deploy --only hosting
```

因此除非先確認目前 `package.json` 的 `deploy` script 已改成 Firebase Hosting，否則不能直接把「不用 Hosting」等同於「不用 npm run deploy」。

## Summary-first 最高管理者提醒 — 2026-08-25 已部署基線

2026-08-25 版本同時修改 Frontend 與 `functions/deviceApproval.js` 的 pending lifecycle，使用者已確認完成正式部署且初步 Production 測試成功。`CURRENT_APP_VERSION` 維持 3.5.3。

未來若再次修改這條流程，正式 repository 仍應先跑：

```bash
node --check functions/deviceApproval.js
node --test tests/deviceApproval.test.js tests/superAdminDeviceNotice.test.js
npm run build
```

若未來再次變更相同 frontend/backend contract，仍建議先部署會建立／結束 pending request 的 Functions：

```bash
firebase deploy --only "functions:checkDeviceAccess,functions:reviewDeviceApproval,functions:manageAccountDevice,functions:emergencyUnblockDevice,functions:cleanupExpiredDeviceApprovals"
```

再部署實際正式使用的 Frontend target。

如果正式前端是 Firebase Hosting：

```bash
firebase deploy --only hosting
```

如果正式前端是 GitHub Pages，則使用已確認的 root package deploy script。

2026-08-25 這次 Summary-first 欄位本身沒有要求 Rules 變更。未來也只有 `firestore.rules` 實際有改時才部署 Rules；不得因為 Security 功能相關就機械式重部署 Rules。

# 11. PWA 版本注意事項

目前 `App.jsx` 有：

```text
CURRENT_APP_VERSION = 3.5.3
```

而 Vite PWA 使用：

```text
autoUpdate
```

因此版本／快取問題涉及兩層：

1. App 自己的版本檢查邏輯
2. Service Worker / PWA 更新

未來修改強制更新機制時要一起確認，不要只改其中一層。

# 12. 部署後驗證

依修改類型驗證：

Frontend：

- 正式 URL 可開啟
- lazy-loaded page 可正常切換
- PWA 不出現舊 chunk 載入錯誤

Data / Summary：

- Dashboard data source status 正確
- Summary / Raw fallback 符合預期

Store Identity：

- regression test PASS
- 必要時執行 Core Consistency Audit

Security：

- login log 正常
- device trust 不阻斷合法登入
- SystemMonitor 可讀到紀錄

Telegram：

- config / policy / schedule 前端讀寫正常
- Functions log 無異常
- 測試訊息與正式群組 routing 依當次需求驗證
# Historical Appendix — Reconciliation Security Config Hardening（SUPERSEDED AS PENDING STATE）

此段適用於已驗證並 Git-integrated 的 `updateTelegramSecurityAlertConfig`（source commit `31d8ac6`）。它同時涉及 Backend endpoint、Firestore Rules 與 Frontend，部署不可只發其中一層。

安全順序：

```bash
# 1. 先讓 Backend writer 可用
firebase deploy --only functions:updateTelegramSecurityAlertConfig

# 2. 再封鎖 telegram_security_alerts client direct write
firebase deploy --only firestore:rules

# 3. 最後發布改走 Backend 的 Frontend
npm run deploy
```

理由：Rules 一旦先禁止 client write，而 Backend endpoint 尚未存在，新的安全設定 UI 會暫時無法儲存；反向先上 Backend 再收緊 Rules，既有 Production frontend 不會被中斷。

本 hardening 沒有修改既有 Security alert Firestore triggers，因此不要機械式全量部署全部 Functions。

> 此段保留 2026-08-31 當時的 deployment-order evidence；目前 Production runtime 已高於 `31d8ac6`，不得再把它解讀成「仍待部署」。最新狀態以 `CURRENT_STATE.md` 為準。

---

# 13. System Exclusion Stage C — Production Deploy / Recovery Order

2026-09-03 split-runtime recovery 採 Backend / data authority / Frontend 分段 gate，避免再次把 stale Target Coverage authority直接交給新 Frontend。

正式順序：

```text
1. Stage C source / regression / Node 22 / build gate
2. Git commit + push main
3. scoped Backend deploy
4. CYJ Target Coverage read-only audit
5. CYJ metadata-only migration + persisted verify
6. CYJ historical Summary reconciliation readback
7. 安妞 / 伊啵 read-only regression
8. Frontend GitHub Pages deploy
9. Production UI validation
```

Stage C scoped Backend deploy：

```bash
firebase deploy \
  --project cyjsituation-analysis \
  --only "functions:manageSystemExclusions,functions:auditHistoricalTargetCoverage,functions:migrateHistoricalTargetCoverageMetadata"
```

這不是 blanket Functions deploy，也沒有 Stage C Rules deploy。

Frontend 正式路徑：

```bash
npm run deploy
```

`npm run deploy` = Vite build + `gh-pages -d dist`；不是 Firebase Hosting。

本次 rollback anchor 在 deploy gate 鎖定為：

```text
ec8681826f1e047020f7f024abcc364eb269a2bd
```

此 SHA 只代表 Stage C 前的 gh-pages rollback anchor，不代表目前新 frontend SHA。

## Docs-only closeout

本次 `.md` closeout：

```text
runtime source change = 0
Functions change      = 0
Rules change          = 0
CURRENT_APP_VERSION   = unchanged
runtime deploy        = NOT REQUIRED
```

只需 documentation git commit / push。

## Rules deployment boundary

System Exclusion repository Rules source已有 direct-write deny；Stage C 沒有修改 Rules，也沒有在本次 closeout 重新 readback live Rules version。若後續需要把 live Rules 狀態正式收斂，必須先以當時最新 `firestore.rules` Source of Truth 做 independent verification；不要因為 Frontend 已改走 Backend endpoint 就推論 live Rules 一定相同。
