# Real-time Persist metrics through Lexicon short definitions

Use this path when the user wants metrics counted live by Persist (per-scope day
cells with a `GLOBAL` rollup), for example from a metric proposal such as
`Spring-Oaks-Capital-LLC/lexicon` PR #900. Persist reads its metrics catalog from
`Spring-Oaks-Capital-LLC/lexicon` today (`/lexicon/metrics-catalog-v3-uri`), so
this is the one path where Jirachi writes to that repository. Every other metric
workflow (KPI suggestions, Model releases, in-family variant drafts,
visualization) keeps Model as its only source.

Jirachi decides which proposals Persist can build, writes the buildable ones as
short definitions and opens a Lexicon pull request. It never merges, publishes,
backfills or activates.

## Read first, at `main`

- `src/data/metric-definitions/README.md`: the `lexicon-short-metric-definition/v1`
  format, the generator, the Persist check and "From merge to live numbers".
  Lexicon owns the format; follow the README at the pinned commit, not a copy.
- `src/data/lexicon.json` and the domain files it uses: the vocabulary.
- `src/data/financial-metrics/metrics-catalog.v3.json` `families` and
  `src/data/metric-definitions/families/`: the families that exist.
- The sibling short definitions of the same family, to copy their shape.

Record the commit SHA you read.

## Decide buildability: four gates in order

Check each proposed metric against these gates in order. The first gate it fails
gives its reason; keep Persist's or the generator's own wording.

| Gate | Passes when | Reason when it fails |
| --- | --- | --- |
| 1. Vocabulary | Every vertex, edge, property and enum value it names exists in the Lexicon vocabulary at the pinned commit. | `<element> is not in the lexicon` |
| 2. Family | Its family already has a block in `metrics-catalog.v3.json` and a `families/<family>.json`. | `family <name> has no catalog family block` (a new family is a Dialga decision) |
| 3. Short format | `npm run generate:metrics-catalog` accepts the file. | The generator's message, for example `the short format cannot express this definition: path a -> b has more than one hop` |
| 4. Persist | `POST /persist/metrics/catalog/validate` accepts the generated catalog, run with `PERSIST_CATALOG_VALIDATION=required npm run check:metrics-catalog-persist` against Persist DEV. | Persist's reasons, verbatim |

- Check each candidate alone first (add only its file, generate, validate), so a
  refusal names the metric that caused it. Then check all buildable candidates
  together.
- Gate 4 signs requests with the user's AWS credentials for the DEV account. Ask
  the user to sign in; never look for other credentials. If Persist gives no
  verdict (no credentials, 403, or 404 from a Persist without the endpoint),
  mark the metric `unchecked`, not buildable. A pull request's CI runs the same
  check, so you may open the pull request as a draft and use CI's verdict; never
  report a metric as buildable without a Persist verdict.
- Patterns Persist's engine cannot express today, all Dialga handoffs: two status
  conditions on different events ("SENT and later FAILED"), the latest status of
  an item without a family election strategy, ratios, scopes other than `DEBT`
  and `GLOBAL` (for example per phone number), multi-hop paths and business-time
  elections. The gates still decide; these are what to expect.

Buildable is not the same as useful. For each buildable metric, check from the
proposal's evidence or a read-only count that its filter values occur and that
items reach the scope. Report a filter value that never occurs, or items that
mostly lack the scope edge, as a data caveat, and drop or rescope the metric
with the user before writing it. (Example: Quiq opt-outs hang off phone numbers,
not debts, so a `DEBT`-scoped count misses almost all of them.)

## Write the buildable ones

- One file per definition at `src/data/metric-definitions/<family>/<definition>.json`,
  copying a sibling's shape.
- Where the item has a direction and both directions occur, write separate
  inbound and outbound metrics with a direction filter. When every counted
  status is single-direction, say so and add no filter.
- `activation` is `BACKFILLING` in every environment. Never write `ACTIVE`.
- Run `npm run generate:metrics-catalog` and commit what it writes. Never edit
  the generated catalog files, digests, counts or `releases.json` by hand.
- Run `npm run check:metrics-catalog` and `npm run test:run` before pushing.

## Open the Lexicon pull request only when at least one is buildable

When no metric is buildable, open no pull request; return the handoff list.

- Branch `jirachi/<topic>-metrics`, from current `main`.
- Description, in this order:
  1. Buildable metrics: definition ID, name and one line on what it counts.
  2. Not buildable yet (Dialga handoff): one line per proposal with its gate and
     reason.
  3. Data caveats and decisions (dropped filters, direction splits, rescoped
     metrics) with the evidence.
  4. The Persist check result (local or CI) and the catalog release the
     generator recorded.
  5. What happens after merge: link the README's "From merge to live numbers".
- Work the pull request until checks and bots are clean. A human merges.
- Lexicon DEV is shared: each pull request's CI deploys its own catalog to DEV.
  Say so when someone wants to prove the metrics in DEV before merge.

## Return

```text
Buildable (N), in Lexicon PR <link>:
1. <definition id> — <name>
   <short definition file>

Not buildable yet (M), handed to Dialga:
- <proposal>: <gate> — <reason>

Unchecked (K): <proposal> — <why Persist gave no verdict>
Data caveats: …
Pinned: Lexicon <sha>, catalog release <release id>
```

Put buildable metrics first. Each unbuildable or unchecked proposal takes one
line.

## After merge

Hand `uxie` the definition IDs. Uxie confirms Persist synced them as
`BACKFILLING`, sends the backfill plan (`POST /persist/metrics/backfills`
without `confirm`), runs it with `confirm: true` and activates them behind
Persist's gates when the user asks. Jirachi never calls the backfill or
activation APIs.

## Proof fixture

Run this path on the Quiq proposals in Lexicon PR #900. Expect the four
`text_message.status.{sent,delivered,failed,rejected}.event_count@v1` files on
`main` (merged in #912) byte for byte, and one line each for the dropped
proposals: SENT-cohort outcomes and "SENT and later FAILED" (two status
conditions), latest status, ratios, opt-in and opt-out (need a phone-number or
global scope), DELIVERY_DELAYED (never occurs in PROD) and the provider filter
(no PROD status edge carries a provider).
