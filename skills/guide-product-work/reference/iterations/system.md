# System capability map

Use Zygarde for framework capabilities and Celebi for supported configurations.
Apply the [shared workflow](../../SKILL.md) to the scoped dependency plan. These
seven capability areas are a starting inventory; a feature may need several
increments. Scenario families and the four fixture configurations are test
coverage, not a count of implementation pieces.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `template-invocation` — invoke one template-backed flow | Approved input/output example | Deliver the minimum definition, schemas, template compilation, flow binding and invocation path for one mocked leaf; configure valid and invalid requests. | Inspect the actual execution, schema rejection and leaf input/output/logs. Support one usable path before expanding its compiler. |
| `template-bindings` — reuse a template | Template invocation | Deliver reusable parameter/leaf bindings; configure two flows against the same template with different mocked responses. | Inspect resolved binding and output; show different behavior without an engine change and reject an invalid binding. |
| `flow-composition` — pass data between steps | Template invocation and bindings | Deliver multi-step sequencing/data mapping; configure Connect → Transform → Persist and vary its supported mapping. | Inspect each state boundary and correlated logs; compare normalized output, write acknowledgment and failed/missing data behavior. |
| `conditional-branches` — route by a result | Flow composition | Deliver rule/choice compilation; configure Rule → Schedule/Persist branching with eligible/rejected cases. | Inspect taken/skipped states and logs; rejection must not schedule or persist. Keep Schedule explicitly mocked. |
| `retry-policy` — recover a failed step | Executable flows | Deliver scoped configurable retries, timeouts and catches; configure a transient mock failure and an exhausted retry case. | Inspect actual attempts/backoff, timeout/catch and terminal cause; verify successful recovery and bounded failure. |
| `waterfalls` — try another flow | Reusable flows and failure propagation | Deliver ordered primary/fallback attempts; configure fallback success and all-failed cases. | Inspect both flow attempts, outputs and error logs; prove success stops further attempts and terminal failure is preserved. |
| `invocation-lifecycle` — inspect and safely repeat a run | Template invocation; richer flows for coverage | Complete supported invocation status/result/correlation and replay behavior beyond the minimal first run; configure duplicate/repeated calls with stable identities. | Correlate request, execution and leaf logs; compare status/result and duplicate-write behavior. Verify supported lifecycle semantics before claiming replay support. |

Order independent features by the requested outcome; lifecycle work can precede
branching. Include core diagnostics in the first path rather than deferring all
observability to the last feature. Use [the mock scenarios](../../../build-system-product/reference/mock-scenarios.md)
where they cover a feature and add target-repository acceptance cases for schema
validation, retry policy or other uncovered capabilities. Demonstrate each piece,
implement only that piece, then have the person invoke its framework configuration
and inspect AWS before the next piece. Finish with cumulative acceptance of every
selected feature before introducing real integrations within scope.
