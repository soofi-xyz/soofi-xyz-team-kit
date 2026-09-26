# Rule evaluation and query composition

## Definitions and scope

Consume governed, versioned rule artifacts separately from the
[entity-selection query](entity-selection.md). Each rule needs a stable identity,
supported predicate/query representation, scope, result interpretation and model
compatibility. Keep actual business predicates and their inventories in the
governed source; use only abstract predicates when explaining this product.

Support entity-level predicates and explicitly declared related-candidate scopes.
Normalize each predicate's inclusion/exclusion representation to `passes: boolean`
before aggregation. Do not infer meaning from a rule name or treat an execution
error as `false`. Separate metadata-only projections from pass/fail predicates.

For a required candidate scope, require at least one candidate that passes all
applicable predicates for that scope. Evaluate each candidate independently; two
different candidates passing different predicates do not jointly form a passing
candidate. Require all selected scopes unless an explicit, versioned alternative
composition contract exists. Define absence handling for each scope.

## Ruleset composition

Resolve context against published catalog metadata, pin the selected manifests and
versions, and reject an unknown/incompatible selection. Context selects rulesets;
it does not select the input entity population or determine candidate requirements
by itself. Make precedence between explicit artifacts and catalog selection clear.

Combine compatible manifests in deterministic order. Deduplicate identical rule
identities/content and reject conflicting definitions. Do not silently omit an
unsupported rule or apply an implicit fallback policy. Reject an empty effective
ruleset unless the caller explicitly selected a documented projection-only mode.
Keep the [existing catalog contract](implementation/rules-and-queries.md) for
legacy callers; generic requirements do not change its defaults.

Treat rule independence and mutual exclusivity as different concepts. Multiple
predicates may legitimately fail for the same entity. Neither overlapping failure
counts nor overlapping traversals alone establishes a business-definition error.

## Compilation pipeline

1. Validate artifacts and declared entity/candidate scopes against the adapter and
   model version. Parse the supported query language into an intermediate form.
2. Bind entity IDs to the adapter's canonical root. Extract supported relative
   predicates; preserve relationship direction, identity, absence behavior and
   candidate boundaries. Reject unsupported syntax before source evaluation.
3. Compose the predicates into a bounded query for each partition of selected
   IDs. Use pushed-down predicates in filter mode; use keyed boolean projections
   in report mode. Require equivalent accepted IDs and candidates in both modes.
4. Add the configured metadata projection without turning optional missing data
   into rejection. Keep audit maps separate from accepted result payloads.
5. Record rule/query identity and report keys so each decision can be traced back
   to its definition and source observations.

Distinguish **deduplicating identical rules** from **sharing subtraversals**. A
query optimizer may share a traversal only when scope, bindings, source visibility,
cardinality, ordering, time and side-effect behavior are equivalent. Preserve
per-rule explanations after optimization. Do not claim that the current compiler
performs common-subexpression elimination without inspecting its implementation.

## Time and reproducibility

Pin one evaluation instant for a run. Define timezone and boundary behavior in the
applicable adapter/metadata, bind time placeholders after compiled-cache lookup,
and fail unresolved placeholders. Include artifact/model versions and compiler
options in cache identity; define invalidation and allowable staleness.

A fixed evaluation instant makes temporal predicates consistent; it does not
freeze facts read during separate queries. Record the data revision/visibility
available from the data service. Promise reproducible replay only when the required
rule artifacts, bindings and source snapshot/history remain available.

Use [verification](verification.md) to prove equivalence, overlap accounting and
candidate semantics. Use [performance](performance-and-consumers.md) to evaluate
optimization against measurements rather than rule count alone.
