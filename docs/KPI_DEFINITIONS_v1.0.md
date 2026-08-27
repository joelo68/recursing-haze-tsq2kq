# DRCYJ SaaS KPI_DEFINITIONS v1.0

> Status: BUSINESS RULE SOURCE OF TRUTH / READ-ONLY SPECIFICATION
> Formalized: 2026-08-27
> Runtime impact: None. This document is not imported by Frontend or Functions and does not change Firestore reads/writes.
> Source priority: latest user-designated production source > this document > older drafts / prior conversations.
> Telegram alert thresholds are explicitly out of scope and belong to a separate Alert Policy document.

---

## 1. Purpose and Scope

This document defines the authoritative business semantics for DRCYJ SaaS KPI calculation, validity, target coverage, Store Lifecycle, reporting completeness, ranking, Projection, Store Health, Therapist KPI and Annual aggregation.

It does **not** mean the current runtime already conforms to every rule. Current source differences are listed in the Audit Findings appendix and remain `NOT IMPLEMENTED` until separately changed using the then-current production source.

### Status vocabulary

- `BUSINESS CONFIRMED`: business rule formally confirmed.
- `MATCH`: current audited source behavior aligns with this specification.
- `BUSINESS RULE MISMATCH`: current audited source behavior differs from this specification.
- `DATA MODEL / RESOLVER GAP`: current schema/resolver cannot reliably represent the specification.
- `PROVISIONAL / DATA_INCOMPLETE`: a KPI can be shown from known data but source performance data is incomplete.
- `TARGET_INCOMPLETE`: required target denominator is incomplete; corresponding achievement KPI is N/A.
- `N/A`: KPI is not mathematically/business-valid for the current sample; never silently coerce to zero.

---

## 2. Core Data Semantics

### 2.1 Formal net cash

```text
netCash = cash - refund - skincareRefund
```

Definitions:

- `cash`: gross cash sales before refunds.
- `refund`: general refund.
- `skincareRefund`: product/skincare refund.
- `refund` and `skincareRefund` are separate; neither includes the other.

A real `netCash = 0` is a valid zero. A real negative `netCash` is also valid and must remain negative.

### 2.2 Product sales

```text
grossProductSales = skincareSales
netProductSales   = skincareSales - skincareRefund
productRatio      = netProductSales / netCash
```

When `netCash <= 0`, product ratio is N/A. If `netProductSales < 0`, preserve the negative raw ratio; Store Health score floors at 0, while the negative value is separately interpreted as net product refund greater than sales.

### 2.3 安妞 accrual terminology

For 安妞:

- `operationalAccrual` = **權責業績** (technical/operational, excludes product).
- `accrual` = **總權責業績**.

For CYJ / 伊啵, formal accrual KPI uses `accrual`.

Any module displaying 安妞 `operationalAccrual` must label it 「權責業績」. Any module displaying total `accrual` must label it 「總權責業績」.

---

## 3. Store Targets and Achievement

### 3.1 Base targets

For an eligible, non-exempt Store × YearMonth:

```text
cashTarget > 0    => valid cash target
accrualTarget > 0 => valid accrual target
blank / missing / 0 => 目標未設定
```

The system must not auto-prorate opening/closing-month targets by calendar or operating days. Company explicitly sets the formal monthly target.

If a month truly has no target obligation, represent it through the formal exemption mechanism, not `target = 0`.

### 3.2 Store achievement

```text
cashAchievement    = netCash / cashTarget * 100
accrualAchievement = formalAccrual / accrualTarget * 100
```

Where:

```text
formalAccrual = accrual             (CYJ / 伊啵)
formalAccrual = operationalAccrual  (安妞)
```

Target missing/invalid => corresponding achievement is N/A / 「目標未設定」, not 0%.

Valid `netCash = 0` => cash achievement = 0% and is rank-eligible.

Valid `netCash < 0` => preserve negative achievement and rank below 0%.

---

## 4. Challenge Targets

`challengeCashTarget` / `challengeAccrualTarget` are optional second-layer management targets. Base targets remain formal KPI authority.

Rules:

- A configured challenge must be greater than its corresponding valid base target.
- Blank / missing / 0 = no challenge, not a target-coverage gap.
- A valid base target must exist before setting the corresponding challenge.
- Cash and accrual challenge targets are independently optional.

For aggregate scope:

```text
scopeChallengeTarget
= Σ(each eligible store: challenge target if configured, otherwise base target)
```

Challenge targets do not influence Projection. Projection may only be compared against them. Challenge achievement does not change existing Ranking and does not create a separate challenge ranking unless explicitly requested later.

---

## 5. Target Coverage

Cash and accrual target coverage are independent.

For a monthly scope:

```text
cashCoverageComplete
accrualCoverageComplete
```

are evaluated separately against the Store Lifecycle-based eligible cohort.

If cash coverage is incomplete:

- aggregate cash achievement = N/A / `TARGET_INCOMPLETE`;
- accrual achievement may still calculate if accrual coverage is complete.

And vice versa.

Do not silently remove missing-target stores from denominator and continue calculating.

For Annual/custom range, coverage unit is:

```text
eligible Store × YearMonth
```

Every required pair must have a valid target for the corresponding KPI.

---

## 6. Store Lifecycle

Store Lifecycle is independent from current organization/personnel assignments.

Canonical business fields:

```text
firstEligibleMonth  first month this SaaS formally includes the store in the KPI cohort
lastEligibleMonth   only for permanent closure; final month is still eligible
exemptMonths        explicitly approved full-month temporary non-operating exemptions
openDate            actual real-world store operating start date
closeDate           actual permanent real-world operating end date
```

`openDate` and `firstEligibleMonth` are deliberately separate authorities. For an existing store that operated before this SaaS became the formal KPI authority, `openDate` may be earlier than `firstEligibleMonth`; do not falsify either field merely to make them share a month. A store must not become KPI-eligible before it actually exists, therefore:

```text
month(openDate) <= firstEligibleMonth
```

For a newly opened store, these will normally be the same month. For a pre-existing store, the actual opening date may be years earlier than the SaaS KPI boundary.

Monthly eligibility:

```text
firstEligibleMonth <= yearMonth
AND (lastEligibleMonth is null OR yearMonth <= lastEligibleMonth)
AND yearMonth not in exemptMonths
```

A newly opened store's first eligible month is eligible even when it opens mid-month. For pre-existing stores, months before `firstEligibleMonth` remain outside the formal SaaS KPI cohort even though `openDate` is earlier. The permanent closing month remains eligible. Targets are explicitly configured; no automatic proration.

A normal closure does not delete Store Identity. Permanent delete should be reserved for mistaken / never-operated stores.

Store Lifecycle does not manage manager/store-manager history, acting assignments, promotions or departures.

### Organization grouping

Historical KPI authority is Store × YearMonth. Normal historical region/manager views use **current `org_structure` grouping** and should be interpreted as:

> 「目前所轄門市的歷史彙整」

not as the personal historical performance of the manager who held the role at that time.

---

## 7. Daily Reporting Completeness

A submitted report with zero values is a valid report and true zero performance.

```text
submitted report with 0 values => REPORT_COMPLETE
no report document             => REPORT_MISSING
```

Never auto-fill a missing report as zero.

### Scheduled rest day

An eligible store scheduled to rest/close for the day must still submit a zero daily report. Therefore a missing report remains `REPORT_MISSING` even on a scheduled rest day.

### Daily eligibility boundary

Daily expected-report authority combines the monthly Lifecycle cohort with the actual operating dates. A date is expected only when its month is Lifecycle-eligible and the date is inside the real operating boundary:

```text
monthlyEligible(date.yearMonth)
AND date >= openDate
AND (closeDate is null OR date <= closeDate)
```

Therefore:

- a real `openDate` earlier than `firstEligibleMonth` does **not** make pre-eligibility historical dates report-expected in this SaaS;
- within the first eligible month, dates before `openDate` are not expected;
- from `openDate` through `closeDate`, eligible non-exempt dates are expected every day, including rest days;
- after permanent `closeDate`, dates are not expected.

### Current month

Missing expected reports may still allow provisional KPI calculation from received data:

```text
status = PROVISIONAL / DATA_INCOMPLETE
```

The UI must surface reporting coverage/missing status and must not present the result as complete official data.

### Historical month

Incomplete historical performance may still be shown provisionally for audit/operations. Missing reports are never auto-filled as zero.

Per Q019-I, existing Ranking completeness gating is not expanded in v1.0; Ranking remains current behavior except where specific formula/eligibility rules in this document apply.

---

## 8. `auditExclusions` Boundary

`auditExclusions` is a presentation/report/audit exclusion mechanism. It does **not** alter the formal KPI cohort.

Only Store Lifecycle plus explicit full-month exemption controls formal monthly eligibility.

Therefore `auditExclusions` must not silently change brand/region/Annual formal achievement denominators or numerators.

---

## 9. Store Ranking and Bottom Segment

### 9.1 Store ranking metric

Store/regional formal ranking metric is cash achievement rate, not absolute cash amount.

```text
cashAchievement = netCash / valid cashTarget
```

Current and historical definitions are the same.

Detailed Ranking table interaction remains current behavior: when the user sorts by another column, displayed rank/index may follow the current table sort. v1.0 does not add a separate immutable `officialRank` field for this table interaction.

### 9.2 Bottom Segment size

Only rank-eligible stores enter the denominator.

```text
<= 1 store  => 0 bottom stores
2–5         => last 1
6–9         => last 2
>= 10       => last max(2, ceil(total * 20%))
```

Bottom Segment is a relative ranking position, not automatically an operational failure.

「區內待關注」 requires:

```text
Bottom Segment membership
+ genuine lagging operational-progress condition
```

---

## 10. Therapist KPI

### 10.1 Core therapist KPI

```text
totalRevenue
newCustomerRevenue
oldCustomerRevenue
newCustomerCount
oldCustomerCount
newCustomerClosings
```

```text
newCustomerASP     = newCustomerRevenue / newCustomerCount
newCustomerClosing = newCustomerClosings / newCustomerCount
oldCustomerASP     = oldCustomerRevenue / oldCustomerCount
```

When the corresponding customer count is 0, the ratio is N/A / 無樣本, not `$0` or `0%`, and must not be interpreted as underperformance.

### 10.2 Therapist monthly target

Primary source:

```text
therapist_targets/{therapistId}_{year}.monthlyTargets[month]
```

If no valid positive monthly target exists:

```text
status = 目標未設定
```

Never substitute 800,000 or another hardcoded amount.

### 10.3 `newASP`

`newASP` is a brand-level runtime parameter shared by StoreAnalysis and TherapistPerformance for the current brand/current settings.

Missing / invalid / zero => 「目標未設定」. No hardcoded 3500 / 16000 / 25000 authority.

### 10.4 Regional/team therapist ratios

Use ratio-of-totals:

```text
regionalNewASP = ΣnewCustomerRevenue / ΣnewCustomerCount
regionalClosingRate = ΣnewCustomerClosings / ΣnewCustomerCount
```

Therapist Performance regional baselines use `therapist_daily_reports`, current and historical, not store `daily_reports`.

### 10.5 Therapist rank states

- Rank metric: `totalRevenue` descending.
- TOP: top 3 fixed.
- DANGER: bottom 20% of eligible therapists, dynamic `ceil`.
- 1–3 therapists: TOP only, no DANGER.
- >=4 therapists: at least 1 DANGER.
- TOP and DANGER must never overlap.

---

## 11. Store Health

All five benchmark ranges are brand-specific runtime parameters. Missing benchmark => 「標準未設定」. Invalid benchmark => 「標準設定無效」. Do not borrow defaults from another brand.

Canonical benchmark storage is decimal ratio:

```text
80%  => 0.8
120% => 1.2
```

UI handles percent conversion.

Valid benchmark:

```text
min/max finite numeric
min > 0
max > min
```

Invalid settings should be blocked before Firestore write.

### 11.1 Financial health

```text
cashToAccrual = netCash / formalAccrual
```

Denominator zero/invalid => N/A; no score and no financial-risk classification solely because denominator is missing.

### 11.2 Sales structure

```text
productRatio = netProductSales / netCash
```

- `netCash > 0`, `netProductSales = 0` => valid 0%.
- `netCash <= 0` => N/A.
- negative net product => preserve negative raw ratio; Store Health sales score floor 0; separately classify net refund > sales risk.

### 11.3 Customer loyalty

```text
traffic = newCustomers + oldCustomers
oldCustomers = traffic - newCustomers
retention = oldCustomers / traffic
```

Valid only when `traffic > 0` and `0 <= newCustomers <= traffic`.

- `traffic = 0`, `newCustomers = 0` => N/A / 無樣本.
- `newCustomers > traffic` => DATA INVALID; do not clamp to 0.

### 11.4 ASP mining

```text
netCash = cash - refund - skincareRefund
oldCustomerSales = netCash - newCustomerSales
oldCustomers = traffic - newCustomers
oldCustomerASP = oldCustomerSales / oldCustomers
aspMining = oldCustomerASP / newCustomerASP
```

Requires valid old and new customer samples and `newCustomerASP > 0`; otherwise N/A.

### 11.5 Acquisition quality

```text
acquisitionQuality = newCustomerASP / currentBrand.newASP
```

Requires valid new-customer sample and valid positive runtime `newASP`; otherwise N/A / no score.

### 11.6 Normalize score

For valid KPI and valid benchmark:

```text
KPI <= 0      => 0
0 < KPI < min => linear 0–60
KPI = min     => 60
min < KPI < max => linear 60–100
KPI >= max    => 100
```

Clamp score to 0–100. N/A/invalid KPI => score N/A, never 0.

### 11.7 Region/brand aggregation

Aggregate underlying numerators/denominators first, then calculate KPI and score. Do not simple-average store scores. No new overall five-force composite score unless explicitly requested later.

---

## 12. Projection

### 12.1 Formal KPI semantics

Projection must forecast the same KPI displayed by Dashboard:

```text
cash projection = formal netCash
CYJ/伊啵 accrual projection = accrual
安妞 權責 projection = operationalAccrual
```

### 12.2 Lifecycle-aware current-month samples

Projection is Store-specific.

Projection is defined only for a Store × YearMonth that is Lifecycle-eligible and not exempt. Within such a month, the current-month sample denominator is the number of actually submitted valid daily-report dates within:

```text
max(monthStart, openDate)
through
min(cutoff, closeDate)
```

An `openDate` earlier than `firstEligibleMonth` never creates Projection/reporting authority for months before `firstEligibleMonth`.

A submitted zero report counts as a valid sample. `REPORT_MISSING` does not count as zero or as a submitted sample; Projection may remain provisional with `DATA_INCOMPLETE`.

Future projection window ends at:

```text
min(monthEnd, closeDate)
```

### 12.3 Historical weekday model

Keep the most recent 3 months grouped by weekday.

A Store × Weekday historical curve requires at least 3 valid submitted samples.

Fallback order:

```text
Store weekday history
→ same-brand weekday history
→ current-month store valid-report average
```

Submitted zero reports remain valid history. If sufficient samples produce weekday baseline 0, preserve 0.

### 12.4 Robust baseline

Valid submitted reports are never deleted from Raw Data merely because unusually high/low.

For historical Store × Weekday Projection baseline, use Median of valid submitted samples rather than hardcoded outlier deletion followed by mean.

Zero and negative values remain valid samples. Only `REPORT_MISSING` is excluded.

Dashboard and Telegram must ultimately use the same Projection definition. No authoritative `$100,000`, `median×4`, `avg×2.5`, or `median×2` module-specific outlier rules.

### 12.5 Current/history blend weights

Per Store, based on current-month valid submitted report dates:

```text
1–5   => current 30% / historical 70%
6–15  => 50% / 50%
16–24 => 70% / 30%
>=25  => 85% / 15%
```

Boundary behavior:

- 0 current samples + reliable history => 100% historical.
- 0 current samples + no reliable history => Projection N/A.
- current samples exist + no history => 100% current-month.

### 12.6 Projection scenarios

For each future eligible day:

```text
conservative = lower(Current, Historical)
standard     = sample-confidence weighted blend
aggressive   = higher(Current, Historical)
```

No arbitrary multiplier. Aggressive does not equal Challenge Target.

These are operational scenarios, not statistical confidence intervals or guarantees. Missing reports propagate `DATA_INCOMPLETE` but do not artificially widen/narrow the range.

If only one trusted baseline exists, all three scenarios use it. If neither exists, Projection is N/A.

---

## 13. Annual / Custom-Range KPI

### 13.1 Achievement aggregation

Use ratio-of-totals:

```text
rangeCashAchievement    = ΣactualNetCash / ΣcashTarget
rangeAccrualAchievement = ΣformalAccrual / ΣaccrualTarget
```

Do not average monthly achievement percentages.

Each month uses its own Store Lifecycle eligible cohort. `auditExclusions` does not alter formal Annual KPI cohort.

### 13.2 Future months

For `yearMonth > currentYearMonth`:

```text
status = NOT_STARTED
actual / monthly achievement = N/A
```

Do not display future actual as 0 / 0%.

If the user-selected interval includes future months, officially configured future targets remain in the interval denominator. The aggregate should be interpreted/labeled as 「區間目標完成進度」 rather than 「截至今日達成率」.

A fully elapsed range may be labeled 「區間達成率」.

### 13.3 Performance completeness

Current month: show actual/progress through cutoff. Missing expected reports => `DATA_INCOMPLETE / PROVISIONAL`.

Historical incomplete month: currently known actual may still contribute to Annual aggregate, but monthly and aggregate result must be marked provisional; never auto-fill missing reports as zero.

Fully complete true-zero month => actual 0, achievement 0%, valid.

### 13.4 Additive vs ratio KPI

Additive KPI:

```text
Annual / range = Σvalue
```

Ratio KPI (ASP, achievement, close rate, shares):

```text
Annual / range = Σnumerator / Σdenominator
```

Do not average monthly ratios/ASPs.

Only explicitly defined monthly-average volume benchmarks use:

```text
Σmonthly value / valid benchmark month count
```

### 13.5 Annual benchmark valid month

A Store × Month benchmark sample must be:

- Store Lifecycle eligible;
- non-exempt;
- Performance DATA_COMPLETE.

A true zero month remains valid.

Opening/closing partial months still contribute to formal Annual Performance/totals, but do not enter the **full-month monthly-average benchmark**. Use authoritative `openDate` / `closeDate`, not first non-zero activity inference.

### 13.6 Scope monthly averages

Brand/region annual-average traffic/new customers/cash represent monthly average **total volume for the selected scope**, measuring organizational scale/output.

Do not divide these existing KPIs by store count. Opening/closure changes may legitimately change scope totals.

A Scope × Month may enter a formal monthly-average benchmark only if all required benchmark stores for that scope/month are DATA_COMPLETE for that KPI.

Per-store productivity, if needed later, is a separate KPI such as 「每店月均客流」 and must not redefine existing 「年均○○」.

### 13.7 KPI-specific based months

Each Annual benchmark KPI owns its own:

```text
basedMonths
basedMonthCount
```

Completeness is evaluated at:

```text
Scope × YearMonth × KPI
```

Invalid/missing data for one KPI affects only that KPI.

Explicit numeric zero is a valid zero. Missing/invalid/unverifiable fields are `DATA_INVALID / FIELD_MISSING`, not zero.

Ratio benchmark samples require both numerator and denominator valid.

### 13.8 Minimum sample naming

Per KPI:

```text
basedMonthCount = 0   => N/A / 尚無完整月份
basedMonthCount = 1–2 => 「近 N 個完整月平均」
basedMonthCount >= 3  => may label 「年均」 + 「基於 N 個完整月」
```

---

## 14. Telegram Boundary

`KPI_DEFINITIONS v1.0` does not define Telegram alert thresholds, severity, push conditions or escalation rules.

Telegram consumers must use the same formal KPI semantics (net cash, formal accrual, validity/N/A, Projection definition), but alert policy belongs to a separate `TELEGRAM_ALERT_POLICY.md` domain.

---

# Appendix A — Cross-Module Audit Findings (Current Audited Source)

The following are audit findings only. They are **not runtime changes**.

## A1. High-priority BUSINESS RULE MISMATCH clusters

1. **Formal net cash incomplete**: multiple current modules/Summary Writer use `cash - refund` and omit `skincareRefund`; some historical consumers may subtract `refund` again from Summary cash, creating double-subtraction risk.
2. **Summary accrual semantic collision for 安妞**: Summary `accrual` is used as operational accrual, while total accrual semantic is not safely preserved for consumers that interpret `accrual` as total.
3. **Store/product ratio semantics**: Store Health uses gross product / incomplete net cash and coerces several invalid/N/A states to 0.
4. **Therapist target fallback**: current TherapistPerformance uses hardcoded 800,000 when no valid monthly target exists.
5. **`newASP` hardcoded fallbacks**: current modules contain 3500 / 16000 / 25000 fallback behavior instead of treating missing runtime setting as target-not-set.
6. **Benchmark propagation/authority**: Settings writes `benchmarks`, while App runtime target state does not reliably propagate it; hardcoded defaults differ between modules and invalid benchmark validation is absent.
7. **Target Writer unset semantics**: blank fields are parsed to numeric 0 and may be written as targets, collapsing unset vs zero. Challenge > base validation is also absent.
8. **Store ranking authority**: Backend historical `storeRanking` currently sorts by cash amount, not formal cash achievement rate.
9. **Therapist DANGER**: current source uses fixed bottom 10 rather than confirmed dynamic bottom 20% without TOP overlap.
10. **Target coverage cohort**: current resolvers use current roster/available target rows rather than Store Lifecycle monthly cohort, and cash/accrual coverage is not consistently independent.
11. **Annual cohort / state**: AnnualView uses current roster and `auditExclusions` in formal aggregation, future months are initialized as numeric zero, and cash/accrual fallback/coverage is partly coupled.
12. **Annual benchmark eligibility**: current Annual KPI summary uses activity > 0 and shared based-month concepts, which can exclude true-zero months and lacks KPI-specific validity semantics.
13. **Projection semantics**: current historical curve uses raw/incomplete cash/accrual semantics, calendar-based blend weights, Sunday-only zero exception and module-specific outlier deletion.
14. **Projection cross-module/path risk**: Dashboard and Telegram have different algorithms; Projection worker reads `brands/{brand}/daily_reports` for all brands, requiring explicit CYJ production-path verification before implementation.
15. **Audit/report cohort**: Daily/Audit and other current views rely on current organization lists; Store Lifecycle daily/monthly eligibility resolver does not yet exist.
16. **Projection UI wording**: current aggressive/「衝刺」 wording may imply activity/rebuy inputs the model does not actually consume.

## A2. DATA MODEL / RESOLVER GAP clusters

1. **Store Lifecycle consumer resolver/cutover remains incomplete**: the brand-aware `store_lifecycle/master` foundation and administrative writer now exist, but Dashboard / Ranking / Annual / Regional / Projection / reporting consumers have not yet been switched to a canonical Lifecycle eligibility resolver. Batch 1.1 additionally separates real `openDate` from the later SaaS `firstEligibleMonth` boundary before consumer cutover.
2. **KPI-specific data validity metadata is missing**: current code commonly converts absent fields to 0, making `VALID ZERO` vs `FIELD_MISSING` difficult to preserve.
3. **Independent target-coverage metadata is incomplete**: cash/accrual coverage and missing Store×Month lists are not a consistent first-class contract across Summary/Annual/Regional/Telegram.
4. **Accrual semantic contract needs explicit fields**: 安妞 requires both formal operational accrual and total accrual without overloading a single `accrual` semantic.
5. **Projection curve trust metadata is insufficient**: sample counts, source tier (store/brand/current), completeness and metric semantic version should be explicit if/when runtime is refactored.
6. **Annual benchmark schema needs KPI-specific `basedMonths/basedMonthCount` and completeness metadata**.

## A3. Confirmed MATCH / intentionally retained behaviors

1. Therapist target writer uses brand-aware `getCollectionPath()` and writes recalc queue entries.
2. Challenge aggregate concept already falls back to base target for stores without challenge, preserving cohort.
3. Store Bottom Segment size formula matches confirmed business rule.
4. Detailed Ranking table rank/index following current user-selected sort is intentionally retained.
5. Daily reporting model can distinguish an existing zero report from a missing document (`isReported`).
6. Annual core achievement uses ratio-of-totals concept; lifecycle/coverage/state handling still needs upstream correction.
7. Summary-first architecture remains the desired historical-data direction; the issue is semantic correctness of Summary fields and trust/completeness contracts, not removal of Summary-first.

---

# Appendix B — Implementation Order (Future, Not Yet Authorized)

When implementation is explicitly authorized and current production source is re-supplied, use this order to avoid page-level workarounds:

1. Store Lifecycle Master + resolver + brand paths.
2. Canonical KPI helpers/contracts: formal net cash, formal accrual, validity/N/A states.
3. Target Writer / Settings validation and independent target coverage.
4. Summary Writer schema/semantic fixes and compatibility migration.
5. Annual/Regional/Ranking/Dashboard consumers.
6. Store Health + Therapist resolver consistency.
7. Projection Writer/consumer unification and Telegram projection consumer.
8. Regression tests covering all confirmed rules.

Do not increase `CURRENT_APP_VERSION` unless explicitly requested.

---

## Documentation Impact

This document is a new formal business-rule specification. No runtime documentation is changed by this file alone. Future implementation must separately update only the affected architecture/data-model/deployment docs.
