# System tiered review (operator only)

The tiered review checks a sample of the sale-availability facade's Tier 1
answers against Transform's Tier 2 assessment, asynchronously and after the
answer is recorded. It is internal quality control: the client API, the GET
body and callbacks never change, and the answer is always Tier 1. Never
describe it in client-facing documentation.

Implemented in [prismteam-ai/system#42](https://github.com/prismteam-ai/system/pull/42);
the full design, metrics, alarms and cost model are in the System repository's
`docs/tiered-review.md`. Zygarde owns the worker and stack; Celebi operates the
flag on an installation.

## Production status

System-prod installed it on 2026-10-23 (16:19 to 16:23 UTC) with Install
parameter `TieredReview` `Enabled` and Tier 2 from `Transform-prod-tier2`
(`TieredReviewTier2ApiUrl`, `TieredReviewTier2InvokePolicyArn`,
`TieredReviewTier2Pins`). The worker's role is
`arn:aws:iam::708502238428:role/System-prod-tiered-review-worker`, which
Transform allows as its Tier 2 caller. Every installation creates the flag
**OFF at 0%**.

## How it works

1. A rule queues every succeeded template run; the worker reads the AppConfig
   flag (cached 30 s; any read or parse error counts as OFF).
2. It keeps only facade runs and selects a property by a SHA-256 bucket of its
   normalized address (`bucket < trafficPercent × 100`).
3. The adaptive sampler commits one decision per invocation. The four scored
   fields (`availability_status`, `is_for_sale`, `list_price_amount_minor`,
   `list_price_currency`) have a 100% floor. `reason_codes` is recorded, not
   scored.
4. **DRY_RUN** stops after the decision. **ACTIVE_SHADOW** reserves the Tier 2
   cost ceiling against the daily and monthly caps, calls Transform's Tier 2
   `POST /runs` (SigV4) and records the field comparison in the append-only
   `TieredReviewLedger`.

## Operate the flag

```bash
TARGET_ENV=prod just tiered-review status                 # flag, recent deployments, budget
TARGET_ENV=prod just tiered-review set DRY_RUN 1          # decisions only, 1% of properties
TARGET_ENV=prod just tiered-review set ACTIVE_SHADOW 1    # also call Tier 2
TARGET_ENV=prod just tiered-review off                    # OFF at 0%
```

`mode` is `OFF | DRY_RUN | ACTIVE_SHADOW`; `trafficPercent` is `0..100`.
Workers see a change within about a minute. Run `status` and check the alarms
before every `set`, and get approval before raising traffic or switching to
ACTIVE_SHADOW in production.

## Budgets and stops

| Limit | System-prod |
| --- | --- |
| Per Tier 2 call (`TieredReviewTier2CostCeilingUsd`) | USD 1.50 reserved, settled to the reported cost |
| Per UTC day (`TieredReviewDailyBudgetUsd`) | USD 16.50; then `BUDGET_EXHAUSTED` until the next day |
| Per UTC month (`TieredReviewMonthlyBudgetUsd`) | USD 500, a hard stop |

`TieredReviewTier2ErrorsAlarm` (5 or more Tier 2 failures in 15 minutes) and
`TieredReviewMonthlyBudgetAlarm` turn the flag OFF through
`TieredReviewAutoOffFn`. EventBridge reacts only to a change into ALARM, so an
alarm still in ALARM does not stop a later `set`. Other alarms:
`TieredReviewDlqAlarm`, `TieredReviewRuleDlqAlarm`, `TieredReviewQueueAgeAlarm`
and `TieredReviewAutoOffErrorsAlarm`. Their names are stack outputs.

## Evidence

Record the flag before and after each change, the `status` budget lines, the
`System/TieredReview` metrics (`ReviewSampled`, `ReviewVerified`,
`FieldMismatch`, `Tier2Errors`, `BudgetExhausted`) and the ledger outcome for
sampled invocations. A DRY_RUN decision is not a Tier 2 verification.
