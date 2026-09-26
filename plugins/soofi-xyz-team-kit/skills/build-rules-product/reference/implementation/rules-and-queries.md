# Rules and Persist queries

Use [the baseline](PRD.md#evidence-baseline). Keep rule authoring and publishing
with Lexicon; own runtime selection and compilation in Filter/Rules.

## Catalog and manifest

Resolve the ruleset root from `/lexicon/rulesets-uri` (or the configured
`LEXICON_RULESETS_URI` used by the evaluator). Read `<root>/index.json`:

```json
{
  "rulesets": [{
    "id": "sms",
    "label": "SMS Interactions",
    "description": "SMS eligibility",
    "version": "1.0.0",
    "manifest_path": "sms-interactions/ruleset.json",
    "status": "ACTIVE",
    "context": { "channel": "SMS" }
  }]
}
```

This illustrates shape, not the contents of any deployed catalog. Catalog items
also allow `category`; contexts may use `consumer`, `channel`, `calling_lane`,
`campaign`. A manifest contains:

```json
{
  "id": "sms",
  "name": "sms_interactions",
  "label": "SMS Interactions",
  "version": "1.0.0",
  "description": "SMS eligibility",
  "status": "ACTIVE",
  "context": { "channel": "SMS" },
  "rules": [{
    "id": "example_rule",
    "path": "sms-interactions/rules/example/definition.json",
    "query_path": "sms-interactions/rules/example/query.gremlin",
    "order": 10
  }]
}
```

Rule definitions contain `id`, `name`, `description`, `filter_type`,
`vertices_used`, `edges_used`, and optional `filter_scope`, `note`,
`legal_compliance_reference`, `status`, `category`, `context`. Do not infer that
all metadata is enforced by the loader; verify the relevant selection code.

## Selection semantics

1. With no/empty `rule_context`, select catalog ID `phone`. Do not claim that
   choosing phone candidates selects channel-specific SMS rules.
2. With context, select catalog entries whose status is not `INACTIVE` and whose
   declared context constraints match the request. Matching checks ruleset values
   against supplied values; additional request fields are allowed. Exclude rulesets
   without context from context-selected runs. Fail if no active catalog match exists.
3. Load selected manifests; omit `INACTIVE` manifests and fail when none remain.
   Sort each manifest's rules by `order`. Deduplicate identical shared rules;
   reject conflicting IDs, names or paths. Join selected manifest names and
   versions for the compiled metadata.
4. Derive supported contact scopes from compiler output and contexts. Channel-to-
   scope mapping recognizes phone/SMS/text as phone, email as email. Context
   matching itself is not a case-normalizing alias service: use actual catalog values.
5. With explicit `rule_s3_uris`, bypass catalog selection. Context may still inform
   contact scopes/capacity, but it does not add missing suppression rules to the
   chosen subset. Validate the subset against the intended channel separately.

For each explicit prefix, require exactly one `.json` and one `.gremlin` object;
reject empty lists, missing objects and duplicate rule IDs/report keys before
Persist evaluation. Current explicit metadata is `phone_interactions_subset` /
`custom`, even when the selected rules are broader than phones. Do not interpret
that internal name as a guarantee of channel or catalog identity.

## Compiler contract

Use `web-tree-sitter` / `tree-sitter-groovy` to parse a bounded Gremlin subset.

- Require a canonical root `g.V().hasLabel('debt').has('debt_identifier', <id>)`.
  Strip supported root aliases from compiled fragments.
- Accept declared scopes `debt`, `phone`, `email`, `metadata`. Skip metadata rules
  for pass/fail compilation; reject inferred/declaration scope mismatches.
- Preserve supported phone entry patterns through person-to-phone edges and
  status hyperedges. Support email candidate traversal/status metadata through
  the compiler's explicit email patterns; do not generalize arbitrary traversals.
- Preserve supported negation, `where`, positive chains, `choose`, `or`, and
  existence patterns. Treat unsupported roots, parse errors and unsupported
  traversal shapes as failures before graph evaluation.
- Keep report keys deterministic from rule names. Use the compiler fixtures to
  establish support; never silently drop an unrecognized business predicate.

## Query modes and time

Use filter mode for predicates pushed into Gremlin and report mode for boolean
rule projections. Read [batch statistics](batch-contract.md#statistics-choose-the-correct-mode)
before interpreting a missing row. The single-entity evaluator always uses report
mode so it can distinguish graph absence from rule rejection.

Pin one evaluation instant across batch files. Replace placeholders at query-build
time, after compiled rules are loaded; do not bake dates into cached rule fragments.
Use `America/New_York` business-day boundaries for current business-day placeholders.

| Placeholder family | Current meaning |
| --- | --- |
| `__NOW__` | Exact evaluation instant as an escaped ISO timestamp |
| `__TODAY__`, `__TODAY_START__`, `__TOMORROW_START__` | NY date and day boundaries |
| `__TODAY_DAY_OF_WEEK__`, `__LOCAL_DAY_OF_WEEK__` | NY uppercase weekday |
| `__ONE_DAY_AGO__`, `__THIRTY_DAYS_AGO__`, `__FIVE_YEARS_AGO__` | Calendar-relative NY dates |
| `__SEVEN_DAYS_AGO__` | Existing legacy date arithmetic in `replaceRuntimePlaceholders`; preserve/test its timezone behavior before changing it |
| Day-start offset placeholders | Exact keys in `DAY_START_PLACEHOLDER_OFFSETS`; use those supported keys for campaign windows |

Reject unresolved `__[A-Z0-9_]+__` placeholders. Cover midnight and DST boundaries,
exact-time rules and caller-pinned evaluator instants when changing time behavior.

## Persist API

Sign requests with SigV4 service `execute-api` and use the discovered Persist base
URL. The current client still hardcodes `us-east-2`; see the portability gap.

| Operation | Request | Response consumed |
| --- | --- | --- |
| Discover debt IDs | `POST /persist/gremlin-async` with `{ "gremlin": "g.V().hasLabel('debt').values('debt_identifier')" }` | `data.requestId` |
| Poll discovery | `GET /persist/gremlin-async/{requestId}` | `data.status` and terminal `data.resultS3Uri` |
| Evaluate | `POST /persist/gremlin` with `{ "gremlin": "<compiled query>" }` | `data.results[]` |

Discovery statuses are `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`. Poll at 30-second
intervals on the legacy path; fail terminal discovery errors. Prepare successful
async results through Glue; see [snapshots](debt-universe.md).

Use a single equality root for one debt and the supported batched ID clause for
multiple debts. Escape identifiers through the query builder. Batch fetches use
bounded retries and adaptive concurrency on 503/504 saturation; direct evaluation
uses exactly one bounded read and no batch retry loop. Never turn a Persist error
into an accepted/rejected business decision.

## Source and verification anchors

Read `src/ruleset-loader.ts`, `src/lexicon-rule-compiler.ts`, `src/lexicon-rules.ts`,
`src/lexicon-rule-ir.ts`, `src/gremlin-parser.ts`, `src/query-builder.ts`, and
`src/neptune-client.ts` in Filter. Use the corresponding parser/compiler/loader/
query/client tests and the checked-in Lexicon phone fixture. That fixture does
not certify deployed SMS/email suppression coverage.
