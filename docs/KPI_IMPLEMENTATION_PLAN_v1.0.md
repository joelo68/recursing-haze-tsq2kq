# DRCYJ SaaS KPI_IMPLEMENTATION_PLAN v1.0

> Status: IMPLEMENTATION PLANNING ONLY / NO RUNTIME CHANGE
> Formalized: 2026-08-27
> Business Rule Source of Truth: `KPI_DEFINITIONS_v1.0.md`
> Project operating authority: `PROJECT_OPERATING_RULES.md`
> Runtime state authority at implementation time: then-current production source + `CURRENT_STATE.md`
> Version policy: do **not** increase `CURRENT_APP_VERSION` unless explicitly requested.
> Telegram alert thresholds remain out of scope and belong to a separate Alert Policy domain.

---

## 1. Purpose

This document translates `KPI_DEFINITIONS_v1.0.md` into a safe implementation sequence for the production DRCYJ SaaS.

It answers:

- which upstream problems must be fixed first;
- which changes must be deployed together;
- which changes must **not** be bundled together;
- what current production source must be re-supplied before each batch;
- what brand/path, Firestore read/write, Summary, migration and security risks apply;
- what validation and production confirmation are required before proceeding to the next batch.

This file does **not** authorize code modification by itself.

Before every batch, the implementation must stop and re-anchor against the latest production source for that batch. Old audit attachments, old conversations, this plan, and AI memory are not valid substitutes for current production source.

---

## 2. Non-negotiable implementation principles

### 2.1 Source anchoring

For every batch:

```text
current user-designated production source
↓
CURRENT_STATE.md
↓
Project Knowledge Base
↓
Regression tests / Git history
↓
older files / prior conversations / AI memory
```

If any file that actually owns the behavior is missing or version-inconsistent, implementation stops until the correct source is provided.

### 2.2 Fix upstream authority, not page symptoms

Required diagnostic order:

```text
Identity / Master / Settings
↓
Raw Source
↓
Writer / Trigger
↓
Aggregation / Derived Data
↓
Summary / Queue / Trust State
↓
Resolver / Query
↓
View / UI
```

No page-only workaround may conceal a Data Model, Store Lifecycle, Target Coverage, Summary semantic, Writer, Permission or Security defect.

### 2.3 Brand isolation

Existing roots remain distinct:

```text
CYJ
artifacts/{appId}/public/data/{collection}

安妞 / 伊啵
brands/{brandId}/{collection}
```

New logical resources must use the existing brand-aware path resolver or a backend equivalent. Do not hardcode a unified `brands/{brandId}` path for CYJ.

### 2.4 Read-cost policy

Prefer:

```text
Summary-first
single-document master/settings listeners
event-driven rebuilds
small scoped queries
view-based loading
```

Avoid:

```text
polling
per-store persistent listeners
large all-brand listeners
raw-history fallback as the normal path
```

### 2.5 Compatibility policy

High-risk semantic migrations must be additive first:

```text
write new explicit fields / schema version
↓
validate rebuilt data
↓
move consumers
↓
production confirm
↓
only then consider legacy-field cleanup
```

Do not reuse an old field name for a different semantic meaning in-place when historical consumers may still read it.

### 2.6 Status discipline

Every implementation delivery must distinguish:

```text
IMPLEMENTED
VALIDATED
DEPLOYED
PRODUCTION CONFIRMED
```

Writing code is not deployment. Deployment is not production confirmation.

---

## 3. Dependency overview

Current execution checkpoint (2026-08-27): Batch 1 Store Lifecycle foundation has been implemented and production-confirmed. Batch 1.1 corrects the existing-store opening/KPI-boundary semantics before formal dataset initialization/READY and before any KPI consumer cutover. Batch 2+ remains pending.

```text
Gate 0 — Re-anchor current production source
   ↓
Batch 1 — Store Lifecycle foundation ✅ production-confirmed
   ↓
Batch 1.1 — Existing-store openDate / KPI-boundary correction ⏳ implemented, deployment pending
   ↓
Batch 2 — Canonical KPI contracts / validity semantics
   ↓
Batch 3 — Target & KPI Settings authority
   ↓
Batch 4 — Summary Writer semantic migration
   ↓
Batch 5 — Dashboard / Regional / Ranking / Audit consumers
   ↓
Batch 6 — Store Health / Therapist consistency
   ↓
Batch 7 — Annual / Annual Benchmark
   ↓
Batch 8 — Projection unification + Telegram Projection consumer
   ↓
Batch 9 — Final cross-module regression / compatibility cleanup decision
```

Batches 1–4 establish upstream authority. Batches 5–8 consume it. This order is intentional.

---

# Gate 0 — Batch-by-batch Source Re-anchoring

## Goal

Prevent cross-version splicing and ensure every batch starts from the actual production code currently responsible for the behavior.

## Required action before each batch

1. User supplies or explicitly designates the current production source files for that batch.
2. Confirm file roles against `SYSTEM_SOURCE_MAP.md` and actual imports/call sites.
3. Confirm `CURRENT_APP_VERSION` but do not change it.
4. Confirm current Firestore paths and brand resolver behavior.
5. Confirm current relevant Functions exports before writing deploy commands.
6. Confirm current regression tests and package scripts.

## Stop condition

If the real owner file is missing, do not begin implementation.

## Runtime impact

None.

---

# Batch 1 — Store Lifecycle Foundation

## Why this must be first

`KPI_DEFINITIONS_v1.0` establishes Store Lifecycle as the authority for:

- monthly KPI eligibility;
- Target Coverage cohort;
- opening/closing month handling;
- full-month exemptions;
- daily expected-report boundaries;
- Annual cohort;
- full-month Benchmark eligibility;
- Projection date boundaries.

The Store Lifecycle Master, brand-aware writer, security gate and administration UI are now established. KPI consumer resolver/cutover is intentionally still pending; fixing consumers before the Lifecycle contract is fully correct would create page-specific eligibility logic.

## Business contract

Per store:

```text
firstEligibleMonth
lastEligibleMonth
exemptMonths
openDate
closeDate
```

Monthly eligibility:

```text
firstEligibleMonth <= yearMonth
AND (lastEligibleMonth is null OR yearMonth <= lastEligibleMonth)
AND yearMonth not in exemptMonths
```

Boundary relationship:

```text
month(openDate) <= firstEligibleMonth
```

`openDate` is the real store operating start date. `firstEligibleMonth` is the first month this SaaS formally includes the store in the KPI cohort. Existing stores may therefore have an `openDate` earlier than `firstEligibleMonth`; new stores will normally use the same month.

Daily eligibility:

```text
monthlyEligible(date.yearMonth)
AND openDate <= date
AND (closeDate is null OR date <= closeDate)
```

This prevents a pre-existing store's earlier real `openDate` from making pre-SaaS months report-expected. `closeDate`, when present, remains inside `lastEligibleMonth`; the final month is still eligible.

## Data-model direction

Use a **separate small brand-aware Master resource** for Store Lifecycle. Do not add lifecycle fields blindly into `org_structure`, because current organization writers may overwrite unknown fields and because Store Lifecycle is not organization/personnel history.

Recommended logical resource name:

```text
store_lifecycle
```

The exact physical path and document shape must be frozen only after inspecting the then-current production path resolver. The implementation must preserve CYJ legacy-path isolation.

Preferred runtime shape:

- one small document per current brand, not one permanent listener per store;
- store key should use the current canonical Store Identity contract;
- include schema/version metadata if needed for migration readiness;
- do not infer closure from missing reports or zero performance.

## Existing-store migration

Existing stores require one-time administrative confirmation.

For an existing store, administrators must preserve both truths independently:

```text
openDate            = actual known operating start date
firstEligibleMonth  = first formal SaaS KPI month
```

Do not move `openDate` forward merely to match the SaaS start month, and do not move `firstEligibleMonth` backward into years where this SaaS has no formal KPI authority.

System may **suggest** earliest known activity from reports/targets, but must not automatically declare that suggestion authoritative.

Migration sequence:

```text
create lifecycle resource
↓
seed / confirm all currently known stores
↓
verify all three brands
↓
verify opening/closed-store edge cases
↓
mark lifecycle dataset ready
↓
only then switch KPI consumers
```

No historical Raw Data rewrite is required.

## Security / permission check

Store Lifecycle changes affect formal KPI eligibility and therefore are high-impact administrative writes.

Before implementation, inspect current:

- admin permissions;
- Settings write model;
- Firestore Rules;
- backend authorization if a callable/API write path is used.

Do not assume a frontend role check is sufficient security authority.

## Expected source to request again

At minimum, current production versions of the files that actually own these responsibilities. Likely candidates:

```text
src/App.jsx
src/components/SettingsView.jsx
src/constants/index.js
src/utils/helpers.js
firestore.rules
functions/index.js                if backend consumers/write validation are involved
src/components/SystemMaintenance.jsx  only if the migration UI/tool is placed there
```

If imports reveal a separate path/identity/permission owner, request that file before coding.

## Firestore reads/writes impact

Steady-state target:

```text
+ one small current-brand lifecycle Master `getDoc()` when the Lifecycle administration view is opened
+ writes only when an administrator changes lifecycle data
```

Do not add App-global, per-store persistent listeners or polling.

One-time migration may add controlled administrative writes, but should not create recurring read amplification.

## Validation plan

Planned targeted tests should cover:

- existing store whose actual `openDate` predates `firstEligibleMonth`;
- reject an `openDate` later than `firstEligibleMonth`;
- new store opening mid-month;
- permanent closure mid-month;
- final eligible month inclusion;
- post-close exclusion;
- explicit `exemptMonths`;
- scheduled rest day still expected within lifecycle;
- CYJ / 安妞 / 伊啵 path isolation;
- current organization changes do not rewrite lifecycle history.

At implementation time run, as applicable:

```bash
npm run build
node --check functions/index.js        # only if changed
node --test tests/storeIdentity.test.js # if Store Identity path/key logic is touched
```

plus new lifecycle-specific regression tests created in this batch.

## Deploy scope

Only the affected frontend and/or exact Functions/Rules changed in this batch.

Do **not** deploy all Functions mechanically. Exact function names must be taken from the then-current source.

## Documentation impact

Expected updates after implementation:

```text
FIREBASE_DATA_MODEL.md
DATA_FLOW.md
SYSTEM_SOURCE_MAP.md
DEVELOPMENT_GUIDE.md
AUTH_AND_SECURITY.md   only if write authorization / Rules change
CURRENT_STATE.md       after deployment/production confirmation
```

---

# Batch 2 — Canonical KPI Contracts and Validity Semantics

## Goal

Create a single authoritative calculation contract for the formulas repeatedly used by Frontend and Backend, before changing high-level pages.

## Contracts to centralize

At minimum:

```text
formalNetCash(cash, refund, skincareRefund)
formalAccrual(brand, accrual, operationalAccrual)
validBaseTarget(value)
validChallengeTarget(base, challenge)
validRatio(numerator, denominator)
VALID_ZERO vs N/A vs FIELD_MISSING / DATA_INVALID
Store Health benchmark validity
```

Therapist/store-specific formulas should use the same primitive semantics but retain their separate source authorities.

## Architecture requirement

Do not create two silently divergent formula libraries.

Because Frontend and Functions may not share the same bundling/runtime path, choose the exact code-sharing mechanism only after inspecting the then-current repository structure. Acceptable approaches include:

- a genuinely shared pure module imported by both runtimes; or
- deliberately mirrored pure modules protected by parity regression tests.

The unacceptable state is duplicated undocumented formulas drifting independently.

## No data-model write required

This batch should not add Firestore listeners or queries.

## Expected source to request again

Likely:

```text
src/utils/helpers.js
src/constants/index.js
functions/index.js
package.json
functions/package.json
relevant existing tests
```

If a new shared module location is chosen, inspect Vite/Node import compatibility first.

## Regression requirements

Pure-function tests should cover all confirmed edge semantics:

- net cash includes both refund types;
- negative net cash preserved;
- 安妞 formal accrual = operational accrual;
- 安妞 total accrual remains distinct;
- target blank/missing/0 invalid;
- true zero actual valid;
- denominator zero => N/A where defined;
- negative product ratio preserved at raw KPI layer;
- benchmark min/max validity.

## Deploy scope

If the new module is not yet imported by runtime code, no production deployment is required merely to store unused code. Prefer integrating the contract into an actual owner in the same controlled batch rather than deploying dead code.

## Documentation impact

Usually `DEVELOPMENT_GUIDE.md` and `SYSTEM_SOURCE_MAP.md` if a new canonical KPI module becomes an official source owner.

---

# Batch 3 — Target Writer, KPI Settings and Coverage Authority

## Goal

Fix target/settings authority before Summary and consumers rely on it.

## Scope

### Store Target Writer

Implement confirmed semantics:

```text
blank / missing / 0 => 目標未設定
valid base target   => > 0
challenge target    => optional and > base target
```

Do not let `parseNumber("") -> 0` collapse unset into a valid-looking numeric target.

### Independent target coverage

Cash and accrual coverage must be independent and Store-Lifecycle-aware.

Target Summary/derived data should expose enough metadata to answer, per month/scope:

```text
cashCoverageComplete
accrualCoverageComplete
cashMissingStores
accrualMissingStores
eligibleStoreCount
```

Exact field names may be adjusted after current source inspection, but the contract must preserve independent coverage.

### KPI Settings

`newASP` and Store Health benchmarks are brand runtime parameters.

Rules:

- missing/invalid `newASP` => 「目標未設定」;
- benchmark `min`/`max` finite numeric;
- `min > 0`;
- `max > min`;
- canonical stored benchmark format = decimal ratio;
- invalid settings blocked before write;
- no hardcoded fallback becomes authoritative.

### App runtime propagation

If `SettingsView` writes `benchmarks`, the current runtime state consumed by analysis views must actually receive them. Fix the authority chain, not each consumer independently.

## Existing invalid data

Do not silently rewrite historical target values.

Prepare an audit report for:

- base target = 0;
- challenge <= base;
- challenge exists without valid base;
- malformed benchmark ranges.

Require explicit repair for ambiguous historical/admin configuration.

## Expected source to request again

Likely:

```text
src/components/TargetView.jsx
src/components/SettingsView.jsx
src/App.jsx
src/components/TherapistTargetView.jsx
src/utils/helpers.js
src/constants/index.js
functions/index.js          if backend target-summary/coverage logic is involved
firestore.rules             if write surface/path changes
```

## Read/write impact

Target/KPI settings should remain Summary-first and low-cost:

- no new all-target persistent listener;
- keep `kpi_targets` as small single-doc settings state;
- write coverage metadata as part of existing target update/event flow where possible;
- avoid scanning all `monthly_targets` on every Dashboard render.

## Validation

Cases:

- one store missing only cash target;
- one store missing only accrual target;
- cash complete / accrual incomplete and vice versa;
- opening/closing eligible month;
- exempt month;
- challenge partial coverage with base fallback at aggregate scope;
- missing `newASP`;
- invalid benchmark blocked;
- each brand path isolated.

Expected checks as applicable:

```bash
npm run build
node --check functions/index.js
```

plus target/coverage/settings regression tests.

## Deploy scope

Frontend + only exact affected Functions/Rules if changed.

No version bump unless explicitly requested.

## Documentation impact

Likely:

```text
FIREBASE_DATA_MODEL.md
DATA_FLOW.md
SYSTEM_SOURCE_MAP.md
DEVELOPMENT_GUIDE.md
CURRENT_STATE.md after production confirmation
```

---

# Batch 4 — Summary Writer Semantic Migration

## Goal

Correct historical Summary authority before migrating Summary-first consumers.

This is one of the highest-risk batches because historical Dashboard/Regional/Annual/Ranking/Telegram consumers can all depend on Summary fields.

## Core semantic fixes

### Cash

Formal Summary semantics must preserve enough information for:

```text
gross cash
refund
skincareRefund
formal net cash
```

Do not continue a field contract where some writers treat `cash` as partially netted while consumers subtract refund again.

### Accrual

安妞 must preserve both:

```text
operationalAccrual = 權責業績
accrual/totalAccrual = 總權責業績
```

Do not overload one field with two meanings.

### Versioning / compatibility

Prefer an additive semantic migration, for example conceptually:

```text
semanticVersion
explicit net/formal fields
legacy fields retained temporarily for compatibility
```

Exact field names must be decided from the then-current source and existing production documents.

## Historical rebuild

After the writer is corrected:

1. rebuild selected representative historical months first;
2. compare Raw → Summary at store and scope level;
3. verify trust flags;
4. expand rebuild only after comparisons match;
5. never mutate Raw daily reports merely to make Summary agree.

Existing Summary dirty/rebuild architecture should be reused instead of adding a second repair pipeline.

## Target coverage in Summary

If `dashboard_summary` or related Summary is the historical authority for target/achievement, it must carry the independent cash/accrual coverage contract derived from Batch 3 and Lifecycle from Batch 1.

## Ranking summary

Historical ranking data must use formal cash achievement rather than absolute cash amount where that Summary field is meant to represent the formal store ranking metric.

Do not change the user-approved Detailed Ranking table interaction where rank/index follows the currently selected table sort.

## Expected source to request again

Likely:

```text
functions/index.js
src/hooks/useDashboardStats.js       for compatibility read contract
src/components/SystemMaintenance.jsx if existing rebuild/compare UI is used
src/utils/helpers.js or canonical KPI module
relevant Summary regression tests
```

Also request any separate backend module imported by the current Summary worker if `functions/index.js` is no longer the sole owner.

## Firestore cost impact

Steady-state goal: no material persistent-read increase.

One-time rebuild may be read/write intensive. It must be:

- controlled;
- month/brand scoped;
- observable;
- not implemented as recurring polling;
- scheduled outside peak usage if large.

Before running a bulk rebuild, estimate expected source documents and written Summary documents.

## Validation matrix

At minimum compare:

### CYJ

- month with general refunds;
- month with `skincareRefund`;
- store and brand totals.

### 安妞

- `operationalAccrual` vs total `accrual`;
- product sales/refunds;
- store and scope totals.

### 伊啵

- formal net cash;
- accrual;
- target coverage.

For every case:

```text
Raw calculated authority
= rebuilt Summary explicit fields
= consumer output after switch
```

## Deploy scope

Deploy only exact Summary/repair Functions changed. Do not full-deploy unrelated security/Telegram Functions.

Exact Firebase CLI target names must be resolved from the current exports at implementation time.

## Rollback

Because migration is additive, old readers should continue working during the transition. If rebuilt vNext fields fail validation, consumers must not be switched to them.

## Documentation impact

Likely:

```text
FIREBASE_DATA_MODEL.md
DASHBOARD_SUMMARY.md
DATA_FLOW.md
SYSTEM_SOURCE_MAP.md
MAINTENANCE_TOOLS.md if rebuild tooling changes
CURRENT_STATE.md after deployment/confirmation
```

---

# Batch 5 — Dashboard, Regional, Ranking, Daily/Audit Consumers

## Goal

Switch core store-facing consumers to the now-correct Lifecycle, KPI and Summary authorities without adding page-local formulas.

## Dashboard

Use:

- current-month Raw with canonical KPI semantics;
- historical trusted Summary with explicit semantic version/fields;
- independent cash/accrual target coverage;
- `TARGET_INCOMPLETE` and `DATA_INCOMPLETE` as separate states;
- Store Lifecycle cohort.

## Regional

Maintain the approved organization interpretation:

```text
historical region view = 目前所轄門市的歷史彙整
```

Use current `org_structure` grouping over Store×Month authority; do not attempt historical manager reconstruction.

## Ranking

Formal store ranking metric remains cash achievement.

Eligibility:

- valid cash target;
- valid KPI data;
- true 0 and negative net cash remain rank-eligible;
- missing target / DATA_INVALID are not rank-eligible.

Preserve the explicitly retained current behavior where the displayed rank/index follows the user-selected table sort.

Bottom Segment uses only rank-eligible stores and keeps the confirmed size tiers.

## Daily / Audit

Expected reports must use Lifecycle daily boundaries:

- before `openDate` not missing;
- operating/rest day within lifecycle requires a report, including zero rest-day report;
- after `closeDate` not missing.

`auditExclusions` remains presentation/audit exclusion and must not mutate formal KPI cohort.

## Expected source to request again

Likely:

```text
src/App.jsx
src/hooks/useDashboardStats.js
src/components/DashboardView.jsx
src/components/StorePerformanceView.jsx
src/components/RegionalView.jsx
src/components/RankingView.jsx
src/components/DailyView.jsx
src/components/AuditView.jsx
src/utils/helpers.js / canonical KPI module
```

Request any imported Dashboard composer/header/status component that actually owns the affected rendering.

## Reads impact

No new broad raw listener is expected.

Lifecycle should be one small brand Master read; target coverage and historical status should come from Summary/target-summary contracts rather than per-store target queries.

## Regression

Test current and historical months for all three brands, including:

- target missing only on one KPI;
- true zero store;
- negative net cash;
- new store opening month;
- closed store historical month;
- exempt month;
- missing report vs zero report;
- Bottom Segment with ineligible stores removed;
- current table sorting still behaves as approved.

Expected commands as applicable:

```bash
npm run build
```

plus targeted KPI/Lifecycle/Ranking regressions.

## Deploy scope

Frontend only unless a required backend resolver was changed in the same batch. If Backend changed, deploy only exact affected functions.

## Documentation impact

Likely `DASHBOARD_SUMMARY.md`, `DATA_FLOW.md`, `SYSTEM_SOURCE_MAP.md`, `CURRENT_STATE.md` after production confirmation.

---

# Batch 6 — Store Health and Therapist KPI Consistency

## Goal

Remove remaining hardcoded fallbacks and invalid-zero coercions from Store Health and Therapist analysis.

## Store Health

Implement confirmed formulas and N/A semantics for:

- formal net cash;
- formal accrual;
- net product ratio;
- old-customer share;
- old-customer ASP;
- ASP mining;
- acquisition quality;
- brand runtime benchmarks;
- normalize scoring;
- ratio-of-totals region/brand aggregation.

Invalid KPI must remain N/A and must not become score 0 merely because denominator/sample is invalid.

True valid zero remains a real zero where the rule defines it as valid.

## Therapist

Implement:

- no hardcoded 800,000 monthly target fallback;
- missing target = 「目標未設定」;
- brand runtime `newASP` only;
- zero new-customer sample => N/A, not 0;
- regional/team ratio-of-totals from `therapist_daily_reports` authority;
- TOP top 3;
- DANGER dynamic bottom 20%, no TOP overlap.

## Expected source to request again

Likely:

```text
src/components/StoreAnalysisView.jsx
src/components/TherapistPerformanceView.jsx
src/hooks/useDashboardStats.js
src/App.jsx                  if KPI settings/context contract is involved
src/components/SettingsView.jsx only if settings UI authority changes further
src/utils/helpers.js / canonical KPI module
```

## Reads impact

Target state and KPI settings should reuse existing small Summary/settings state. Do not add broad therapist or store listeners merely to calculate fallback values.

## Regression

Include:

- every Store Health dimension valid/invalid/zero boundary;
- negative net product sales;
- `newCustomers > traffic` => DATA_INVALID;
- no new-customer sample;
- no old-customer sample;
- missing benchmark / invalid benchmark;
- each brand's benchmark isolation;
- therapist target missing;
- therapist 1–3 population TOP-only;
- >=4 therapists dynamic DANGER.

## Deploy scope

Usually frontend only unless canonical backend helper/summary fields are touched.

## Documentation impact

Likely `SYSTEM_SOURCE_MAP.md`, `DATA_FLOW.md`, `CURRENT_STATE.md` after confirmation. `FIREBASE_DATA_MODEL.md` only if schema changes.

---

# Batch 7 — Annual / Annual Benchmark

## Goal

Make Annual calculations lifecycle-aware, target-coverage-safe, future-state-aware and KPI-specific without increasing normal raw reads.

## AnnualView requirements

### Achievement

```text
Σ actual / Σ target
```

using each month’s own lifecycle cohort.

### Target coverage

Cash/accrual independent over:

```text
eligible Store × YearMonth
```

Any required missing target invalidates only the corresponding achievement KPI.

### Future month state

```text
NOT_STARTED
actual = N/A
monthly achievement = N/A
```

while configured future targets may remain in a user-selected full interval denominator.

### Performance completeness

Historical/current incomplete performance may contribute known actual provisionally but must propagate `DATA_INCOMPLETE`.

True complete zero remains valid zero.

## `annual_kpi_summary` requirements

### Additive vs ratio

- additive KPI => sums;
- ratio KPI => ratio-of-totals;
- only explicitly monthly-average volume KPI => monthly total / valid benchmark-month count.

### Full-month benchmark sample

Store×Month must be:

- Lifecycle eligible;
- non-exempt;
- full month, not partial open/close month;
- DATA_COMPLETE for that KPI.

True zero is valid.

### Scope completeness

For each:

```text
Scope × YearMonth × KPI
```

all required benchmark stores must be valid for that KPI before the scope-month enters that KPI’s benchmark.

### KPI-specific sample metadata

Each KPI owns its own:

```text
basedMonths
basedMonthCount
```

Naming:

```text
0 months  => 尚無完整月份
1–2       => 近 N 個完整月平均
>=3       => 年均 + 基於 N 個完整月
```

## Schema migration

`annual_kpi_summary` likely requires additive schema/version changes. Do not overwrite old ambiguous fields until the new builder is validated and consumers are switched.

## Expected source to request again

Likely:

```text
src/components/AnnualView.jsx
src/App.jsx                         if annual summary loading/state is owned there
functions/index.js                  annual KPI builder
src/utils/helpers.js / canonical KPI module
```

plus any extracted Annual backend module if present in the current source.

## Reads impact

Normal user view should remain Summary-first.

Do not calculate Annual by loading the entire year of Raw Data into every client view. Annual backend rebuild may read historical Summary in a controlled event/scheduled process.

## Regression

Test:

- new store opening year;
- permanent closure year;
- partial opening/closing month excluded only from full-month benchmark, not Annual total;
- future months;
- independent cash/accrual coverage;
- KPI-specific missing field;
- true zero month;
- brand/region scope completeness;
- 0/1/2/3+ based-month naming.

## Deploy scope

Frontend + exact Annual builder Function(s) only.

## Documentation impact

Likely:

```text
FIREBASE_DATA_MODEL.md
DATA_FLOW.md
SYSTEM_SOURCE_MAP.md
DASHBOARD_SUMMARY.md if Annual summary trust contract is documented there
CURRENT_STATE.md after confirmation
```

---

# Batch 8 — Projection Unification and Telegram Projection Consumer

## Goal

Eliminate divergent Dashboard/Telegram projection algorithms and align Projection with formal KPI, Lifecycle and Reporting semantics.

## Canonical Projection rules

### Metric semantics

```text
cash projection   => formal net cash
CYJ/伊啵 accrual   => accrual
安妞 accrual       => operationalAccrual
```

### Current-month sample

Per store, use actual submitted report dates within Lifecycle boundaries.

- submitted zero rest-day report counts;
- `REPORT_MISSING` does not count as zero/sample;
- Projection may remain `DATA_INCOMPLETE`.

### Historical weekday model

Recent 3 months grouped by weekday.

Store×Weekday requires at least 3 valid samples.

Fallback:

```text
store weekday
→ same-brand weekday
→ current-month store valid-report average
```

### Robust baseline

Use median of valid samples. Remove current module-specific hardcoded outlier deletion rules.

### Current/history weight

Per store valid current-month sample count:

```text
1–5   => 30 / 70
6–15  => 50 / 50
16–24 => 70 / 30
>=25  => 85 / 15
```

Boundary:

- 0 current + history => 100% history;
- current + no history => 100% current;
- neither => N/A.

### Scenarios

```text
conservative = lower trusted baseline
standard     = weighted blend
aggressive   = higher trusted baseline
```

Challenge Target never feeds back into Prediction.

## Projection derived-data contract

Prefer one canonical derived Projection contract that both Dashboard and Telegram can consume, rather than duplicated raw-history scans.

If a projection curve document remains in Firestore, it should expose enough metadata to diagnose trust:

```text
metric semantic/schema version
sample count
source tier (store / brand / current)
completeness status
calculatedAt
```

Exact schema must be confirmed from current production source before implementation.

## CYJ path risk

The audited Projection worker used `brands/{brand}/daily_reports` for all brands. Before any code change, explicitly verify the production CYJ Raw path and fix the backend resolver rather than copying that hardcoded path.

## Telegram boundary

Telegram alert thresholds remain out of scope.

Only Projection **calculation semantics** are unified here. Alert severity/push policy is not changed unless separately authorized.

## UI wording

Adjust 「衝刺」 explanatory text so it does not claim the model consumes future activity/rebuy campaign inputs when it does not.

## Expected source to request again

Likely:

```text
functions/index.js
functions/telegram/prompts.js
src/hooks/useDashboardStats.js
src/components/StorePerformanceView.jsx
src/components/TelegramAlertControlCenter.jsx only if it owns affected Projection presentation/policy boundary
```

plus any extracted Projection/Telegram backend modules imported by current `functions/index.js`.

## Reads impact

Projection historical work should remain scheduled/event-driven and bounded to required 3-month history.

Avoid:

- Telegram recalculating large raw history independently on every request;
- polling;
- duplicate Dashboard + Telegram raw scans for the same derived Projection state.

Before deployment, estimate worker reads per brand/run and compare with current behavior.

## Regression

Test:

- all three brands;
- 安妞 operational accrual;
- `skincareRefund` cash impact;
- mid-month opening/closing;
- missing report vs zero report;
- 0/1/2/3+ weekday sample counts;
- all-zero weekday history;
- negative values;
- brand fallback;
- 0 current samples;
- 1–5 / 6–15 / 16–24 / >=25 weights;
- Dashboard and Telegram return the same Projection for the same fixture.

## Deploy scope

Frontend + only exact Projection/Telegram calculation Functions affected.

Do not deploy unrelated Telegram security Functions.

## Documentation impact

Likely:

```text
DATA_FLOW.md
FIREBASE_DATA_MODEL.md if Projection schema changes
SYSTEM_SOURCE_MAP.md
TELEGRAM_AGENT.md calculation-consumer section only
CURRENT_STATE.md after confirmation
```

Telegram alert thresholds remain outside `KPI_DEFINITIONS` and outside this batch unless separately authorized.

---

# Batch 9 — Final Cross-Module Regression and Compatibility Cleanup Decision

## Goal

Prove the complete KPI contract works across modules before removing compatibility behavior.

## Cross-module fixture matrix

At minimum prepare fixtures covering:

### Brand

```text
CYJ
安妞
伊啵
```

### Lifecycle

```text
normal store
mid-month new store
mid-month permanent closure
full-month exemption
```

### Data completeness

```text
complete positive data
complete true zero
negative net cash
REPORT_MISSING
FIELD_MISSING / DATA_INVALID
```

### Target state

```text
cash+accrual complete
cash missing only
accrual missing only
challenge partial
invalid challenge
```

### Time

```text
current month
verified historical month
historical DATA_INCOMPLETE
future month
custom Annual range including future months
```

## Cross-module equality assertions

For the same fixture, verify relevant modules agree on:

```text
formal net cash
formal accrual
cash/accrual target validity
cash/accrual achievement
Store Lifecycle eligibility
report completeness
N/A vs true zero
Summary semantic fields
Annual aggregation
Projection result
```

UI-specific presentation may differ, but the underlying KPI authority must match.

## Compatibility cleanup

Only after production confirmation decide whether to remove:

- legacy Summary semantic fields;
- hardcoded KPI fallbacks;
- old Projection fields/algorithms;
- transitional compatibility readers.

Do not remove compatibility in the same deploy that first introduces the new authority unless the dependency graph proves it is safe.

## Full validation

Run all targeted tests introduced in Batches 1–8 plus existing affected regressions.

Expected baseline commands, depending on touched scope:

```bash
npm run build
node --check functions/index.js
node --check functions/telegram/prompts.js
node --test tests/storeIdentity.test.js
```

and every new KPI/Lifecycle/Summary/Annual/Projection regression test created during implementation.

Do not state PASS for any command that was not actually run.

## Production confirmation

Production confirmation should use representative real months/stores from all three brands, comparing visible UI values against authoritative Raw/Summary calculations without bulk-changing Raw data.

---

# 4. Recommended rollout gates

Each batch should satisfy all gates before the next dependent batch begins.

## Gate A — Source Confirmed

All actual owner files for that batch are confirmed current production source.

## Gate B — Implemented

Patch complete with no unrelated refactor.

## Gate C — Validated

Required syntax/build/regression actually executed.

## Gate D — Diff Reviewed

Confirm:

- no accidental `CURRENT_APP_VERSION` increase;
- no cross-brand path leakage;
- no unexpected persistent listener/query;
- no unrelated permission/security change;
- no duplicated old/new formula path remaining in the same owner unintentionally.

## Gate E — Deployed

Only precise changed frontend/functions/rules scope deployed.

## Gate F — Production Confirmed

Representative production cases verified before progressing to high-risk dependent batches.

---

# 5. Source request matrix for future implementation

The exact list must be re-derived at implementation time from the current import/call graph. The table below is a planning checklist, not permission to reuse old audit copies.

| Batch | Minimum likely current source to request |
|---|---|
| 1 Lifecycle | `App.jsx`, `SettingsView.jsx`, `constants/index.js`, `helpers.js`, `firestore.rules`, backend owner if used, migration UI owner if used |
| 2 KPI contracts | `helpers.js`/candidate shared util, `functions/index.js`, root/functions package files, relevant tests |
| 3 Targets/Settings | `TargetView.jsx`, `SettingsView.jsx`, `App.jsx`, `TherapistTargetView.jsx`, target-summary backend owner, `firestore.rules` if needed |
| 4 Summary | `functions/index.js` or extracted Summary modules, `useDashboardStats.js`, rebuild/maintenance owner, Summary tests |
| 5 Core consumers | `App.jsx`, `useDashboardStats.js`, `DashboardView.jsx`, `StorePerformanceView.jsx`, `RegionalView.jsx`, `RankingView.jsx`, `DailyView.jsx`, `AuditView.jsx` |
| 6 Store/Therapist | `StoreAnalysisView.jsx`, `TherapistPerformanceView.jsx`, KPI settings/context owners, canonical KPI util |
| 7 Annual | `AnnualView.jsx`, `App.jsx` if it loads Annual state, Annual builder backend owner |
| 8 Projection | Projection worker/backend owner, `useDashboardStats.js`, `StorePerformanceView.jsx`, Telegram Projection consumer/prompt owners |
| 9 Final | all files actually changed in Batches 1–8 + all affected tests |

If a current source import points to an owner not listed here, that owner becomes required before code modification.

---

# 6. Firestore read/write impact summary

| Batch | Steady-state read impact target | Write/rebuild impact |
|---|---|---|
| 1 Lifecycle | Low: one small current-brand Master doc | Rare admin writes + one-time seed |
| 2 KPI contracts | None | None |
| 3 Targets/Settings | No new broad listener; Summary-first | Existing target/settings writes + coverage metadata |
| 4 Summary | No persistent increase | Controlled historical rebuild, potentially high one-time reads/writes |
| 5 Consumers | Neutral or lower if Summary-first | None expected |
| 6 Store/Therapist | Neutral | None expected |
| 7 Annual | Summary-first; avoid year-of-Raw client reads | Annual summary rebuild/update |
| 8 Projection | Bounded scheduled/event-driven history | Derived Projection writes; avoid duplicate Telegram raw scans |
| 9 Final | None | Cleanup only if separately approved |

Any implementation that materially exceeds this profile requires a fresh reads analysis before coding continues.

---

# 7. Security and race-condition boundary

Most KPI formula work is not security work, but the following are sensitive:

- Store Lifecycle administrative writer;
- Target/benchmark settings writer validation;
- any new backend repair/rebuild endpoint;
- any change to Firestore Rules.

For these, inspect Frontend, Backend and Rules together.

If multiple administrators can update the same lifecycle/target resource, avoid blind last-write-wins overwriting of unrelated stores/fields. Use the current safe write pattern supported by the actual source (transaction/batch/field update/version check as appropriate after source review).

Do not invent a security mechanism before reading the then-current production implementation.

---

# 8. Git / deploy delivery policy for every implementation batch

After each actual code batch, delivery must include **the exact files changed in that batch**, not a generic all-project command.

Format:

```bash
# Validation — only commands actually required/run for the batch
...

# Git
git add <exact changed files>
git commit -m "<batch-specific message>"
git push origin main

# Deploy
<precise frontend deploy and/or exact affected Firebase functions/rules only>
```

Frontend repository-confirmed release command is currently:

```bash
npm run deploy
```

Functions must be deployed only by exact affected targets after current exports are confirmed, for example conceptually:

```bash
firebase deploy --only functions:<exactExportName>
```

Do not copy this placeholder as a production command before resolving the actual export names.

Rules deploy only if `firestore.rules` actually changes.

Because repository source currently does not confirm `.firebaserc`, Firebase CLI project context must be explicitly checked by the operator before any Firebase deploy.

---

# 9. Documentation Impact Plan

`KPI_DEFINITIONS_v1.0.md` remains the Business Rule Source of Truth.

This implementation plan does not by itself change runtime architecture documentation.

After each implementation batch, update only documents whose runtime truth changed.

Typical mapping:

| Change | Docs likely affected |
|---|---|
| Store Lifecycle | `FIREBASE_DATA_MODEL.md`, `DATA_FLOW.md`, `SYSTEM_SOURCE_MAP.md`, possibly `AUTH_AND_SECURITY.md` |
| Target/Settings contract | `FIREBASE_DATA_MODEL.md`, `DATA_FLOW.md`, `SYSTEM_SOURCE_MAP.md` |
| Summary schema | `FIREBASE_DATA_MODEL.md`, `DASHBOARD_SUMMARY.md`, `DATA_FLOW.md`, `SYSTEM_SOURCE_MAP.md` |
| Annual schema | `FIREBASE_DATA_MODEL.md`, `DATA_FLOW.md`, `SYSTEM_SOURCE_MAP.md` |
| Projection | `DATA_FLOW.md`, `SYSTEM_SOURCE_MAP.md`, `TELEGRAM_AGENT.md` calculation-consumer section |
| Deployment flow | `DEPLOYMENT.md` only if actual deployment mechanics change |

If a batch has no documentation impact, delivery must explicitly state:

```text
Documentation Impact: None
```

---

# 10. What is intentionally NOT included in this plan

- Telegram alert thresholds, severity and escalation policy.
- Automatic `CURRENT_APP_VERSION` increase.
- Historical organization/personnel reconstruction.
- Per-store productivity KPI not already defined in `KPI_DEFINITIONS_v1.0`.
- Bulk mutation of historical Raw reports to fit new Summary semantics.
- A full-project refactor unrelated to KPI authority.
- Any assumption that the audit-time source remains production-current when implementation begins.

---

# 11. Recommended first implementation batch

When runtime implementation is explicitly authorized, start with **Batch 1 — Store Lifecycle Foundation**.

Do **not** start by fixing `AnnualView`, `RankingView`, `StoreAnalysisView` or Projection individually, because they all depend on upstream eligibility/semantic authority.

Before Batch 1 coding, request the then-current production files that actually own:

```text
brand path resolution
Store Identity
organization/settings administration
Firestore write permission/rules
backend consumers that will need lifecycle
```

Only after those files are confirmed should a patch be designed.

---

## Current status at creation of this plan

```text
KPI Business Rules           CONFIRMED / COMPLETE
Cross-module KPI Audit       COMPLETED (READ-ONLY)
KPI_DEFINITIONS v1.0         FORMALIZED
KPI_IMPLEMENTATION_PLAN v1.0 FORMALIZED
Runtime KPI implementation   NOT IMPLEMENTED
Runtime validation           NOT RUN for this planning document
Deployment                   NONE
Production confirmation      NOT APPLICABLE yet
CURRENT_APP_VERSION          unchanged
Firestore runtime impact     NONE from this document
```

## Documentation Impact

This file is a new implementation-planning document. It does not change production runtime behavior or existing runtime documentation by itself.
