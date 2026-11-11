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
backfills or activates. This is one narrow piece of work: the user's checkpoint
is the proposal decisions and the pull request, not a multi-piece walkthrough.

## Read first, at `main`

- `src/data/metric-definitions/README.md`: the `lexicon-short-metric-definition/v1`
  format, the generator, the Persist check and "From merge to live numbers".
  Lexicon owns the format; follow the README at the pinned commit, not a copy.
- `src/data/lexicon.json`: the vocabulary (vertices, edges, properties, enums).
- `src/data/financial-metrics/metrics-catalog.v3.json` `families` and
  `src/data/metric-definitions/families/`: the families that exist, with their
  election strategies.
- The family's existing short definitions, if it has any.

Record the commit SHA you read.

## Translate each proposal, then run four gates

Translate each proposal into a short file as literally as it allows, then check
it against these gates in order.

| Gate | Passes when | Reason when it fails |
| --- | --- | --- |
| 1. Vocabulary | Every vertex, edge, property and enum value it names exists in `lexicon.json` at the pinned commit. | `<element> is not in the lexicon` |
| 2. Family | Its family already has a block in `metrics-catalog.v3.json` and a `families/<family>.json`. | `family <name> has no catalog family block` (a new family is a Dialga decision) |
| 3. Short format | `npm run generate:metrics-catalog` accepts the file. | The business reason (inferred when the message names only the first blocker), with the generator's message in parentheses |
| 4. Persist | `POST /persist/metrics/catalog/validate` accepts the generated catalog, run with `PERSIST_CATALOG_VALIDATION=required npm run check:metrics-catalog-persist` against Persist DEV. | Persist's reasons, verbatim |

Gate 3's message is about the format, so state the business reason it stands for:

| Proposal asks for | Business reason | Typical generator message |
| --- | --- | --- |
| One count per item dated by its first or latest status (`business_time_election`) | counts each item once by its first/latest status; the family has no such election | `an elected status needs an elected: filter`, `family <f> has no <STRATEGY> election` |
| An item that reached status A and later B (`qualifying_conditions` on two events) | two status conditions on different events are not supported | same as above |
| An edge-exists condition, a multi-hop path, a non-text value | the format cannot state `<condition>` | `the short format cannot express this definition: …` |
| A filter on a vertex the family's items don't reach (for example `template`) | needs a family change | `a filter reads <label>, which family <f> does not reach` |
| A ratio | ratios are not supported | (not translatable) |
| A scope other than `DEBT`/`GLOBAL` (for example per phone number) | scope `<x>` is not supported | (not translatable) |

- Check each candidate alone first (add only its file, generate, validate), so a
  refusal names the metric that caused it, then restore the generated catalogs
  and `releases.json` before the next one, so no stray release is committed.
  Then check all candidates together.
- Gate 4 signs requests with the user's own AWS sign-in for the DEV account. Ask
  the user to sign in; never look for other credentials. If Persist gives no
  verdict (no credentials, 403, or 404 from a Persist without the endpoint),
  mark the metric `unchecked`, not buildable. A pull request's CI runs the same
  check, so you may open the pull request as a draft and use CI's verdict; never
  report a metric as buildable without a Persist verdict.

## Propose the closest buildable rescope, never adopt it alone

When a proposal fails gate 3 only because of how it counts or dates items, you
may propose the closest buildable metric, usually one count per status event
(`read: EACH_EVENT`) instead of one count per item. A rescope counts something
different, so:

- list the original as not buildable with its reason, and the rescope as a
  separate candidate that says what changed ("counts each SENT event, not each
  message");
- run all four gates on the rescope;
- write it only after the user approves it. One rescope may stand for several
  proposals; name them all. A proposal that says "no interim
  per-event metrics" needs the user to override that explicitly. Without a user
  (for example in a subagent run), report rescopes as `held for approval` and do
  not write them.

## Check the data before writing

Buildable is not the same as useful. For each candidate, get evidence that its
filter values occur and that its items reach the scope: the proposal's own
evidence, or a read-only count the user or `uxie` runs in the target
environment. Never take evidence from a Persist deployment other than the target.

- A filter value that never occurs (for example a `provider` no status edge
  carries): drop the filter, or the metric, with the user.
- Items that mostly lack the scope edge (for example Quiq opt-outs hang off phone
  numbers, not debts): a `DEBT`-scoped count misses them; hand the metric to Dialga
  for another scope.
- A status with no occurrence evidence: report it as `held for data`, do not
  write it.

A scope the user approved covers the drops it implies (for example a status it
leaves out because it never occurs).

## Write the approved buildable ones

- One file per definition at `src/data/metric-definitions/<family>/<definition>.json`.
- **Definition ID:** `<family>.<what>.<value>.<measure>@v1`, using the segments
  of the family's existing IDs; for a status-event count,
  `<family>.status.<status>.event_count@v1`. Leave out segments for filters you
  dropped (no `provider.quiq` without a provider filter). **Name:** the business
  name, for example "Sent Text Message Events".
- **`dimensions`:** `[]` unless the proposal asks for a slice. A dimension needs
  one unambiguous equality selector; adding one can make other filters fail
  gate 3. Never copy another family's dimensions.
- **Direction:** where the item has a direction and both directions occur for the
  counted statuses, write separate inbound and outbound metrics with a direction
  filter. When every counted status is single-direction, say so and add no filter.
- **Layout:** expand every nested object with one key per line, as the
  `text_message` files merged in #912 do; then run Prettier.
- `activation` is `BACKFILLING` in every environment. Never write `ACTIVE`.
- Run `npm run generate:metrics-catalog` and commit what it writes. Never edit
  the generated catalog files, digests, counts or `releases.json` by hand.
- Commit, then run `npm run check:metrics-catalog` and `npm run test:run` (the
  release builder needs a clean tree).

## Open the Lexicon pull request only when at least one is buildable

When no metric is buildable and approved, open no pull request; return the lists.

- Branch `jirachi/<topic>-metrics`, from current `main`.
- Description, in this order:
  1. Buildable metrics: definition ID, name and one line on what it counts.
  2. Not buildable yet (Dialga handoff): one line per proposal with its gate and
     business reason.
  3. Held: rescopes awaiting approval and metrics held for data.
  4. Data caveats and decisions (dropped filters, direction, rescopes and who
     approved them) with the evidence.
  5. The Persist check result (local or CI) and the catalog release the
     generator recorded.
  6. What happens after merge: link the README's "From merge to live numbers".
- Work the pull request until checks and bots are clean. A human merges.
- Lexicon DEV is shared: each pull request's CI deploys its own catalog to DEV.
  Say so when someone wants to prove the metrics in DEV before merge.

## Return

```text
Buildable (N), in Lexicon PR <link> | no PR: <why>:
1. <definition id> — <name> [rescope of <proposal>[, <proposal>…], approved by <who>]
   <short definition file>

Not buildable yet (M), handed to Dialga:
- <proposal>: <gate> — <business reason>

Held (K): <candidate> — held for approval and/or held for data: <why>
Unchecked (J): <proposal> — <why Persist gave no verdict>
Data caveats: …
Pinned: Lexicon <sha>, catalog release <release id as generated>
```

Put buildable metrics first. Each other proposal takes one line. The catalog
release ID depends on `releases.json` at the time of generation; compare content,
not release IDs.

## After merge

Hand `uxie` the definition IDs. Uxie confirms Persist synced them as
`BACKFILLING`, sends the backfill plan (`POST /persist/metrics/backfills`
without `confirm`), runs it with `confirm: true` and activates them behind
Persist's gates when the user asks. Jirachi never calls the backfill or
activation APIs.

## Proof fixture

Run this path on the Quiq proposals in Lexicon PR #900: proposals for inbound
and outbound volume, SMS/MMS and template-family slices, per-message status
counts (a SENT cohort's later outcomes and the first time a message reached a
status), plus ratios kept apart in `ratios[]`. Every proposal is filtered to
`provider = QUIQ`.

To rerun it on a checkout of `main`, strip the four `text_message` definitions
from the short files and from both generated catalogs first, because the
generator refuses a deleted published file. Delete only those entries with a
script, run Prettier so the diff is pure deletions, and leave the `counts`
header for the generator. Keep the family block.

Expected, with the story owner's 11 Nov 2026 approval of the four-metric scope
(which approves these per-event rescopes):

- buildable: the four `text_message.status.{sent,delivered,failed,rejected}.event_count@v1`
  files on `main` (merged in #912), byte for byte, and both regenerated catalogs
  matching `main`;
- not buildable, one line each: volume and slices (counts each message once by
  its first status), SENT-cohort outcomes (two status conditions on different
  events), first-time status counts (no family election), ratios;
- data caveats: the provider filter dropped (no PROD status edge carries a
  provider), no direction filter (these statuses are outbound only),
  DELIVERY_DELAYED dropped (never in PROD), CANCELLED, RESTRICTED and COMPLAINT
  held for data.
