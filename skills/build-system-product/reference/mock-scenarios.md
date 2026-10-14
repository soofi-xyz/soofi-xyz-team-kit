# Guided System mock scenarios

Use [the scenario fixtures](mock-scenarios.json) within
[the scoped System feature plan](../../guide-product-work/reference/iterations/system.md).
Repeat these phases for the current increment before implementing the next one:

1. **Demonstration:** create runnable examples with mocked leaf Lambdas and Step
   Functions in the authorized target repository/environment. Give the person
   the invocation command, actual response and execution link. Have them inspect
   the transitions and explain the observed result.
2. **Framework acceptance:** implement the current capability and configure the
   actual framework increment with that outcome. Have the person invoke it and
   inspect its execution and logs. Wait for their observations and verify them
   before starting the next piece. The framework must compile the templates;
   hard-coded PoCs do not prove configuration support.

Map cases to stable feature IDs: `baseline` success exercises `flow-composition`,
`alternate-transform` exercises `template-bindings`, baseline replay exercises
`invocation-lifecycle`, `rule-gate` exercises `conditional-branches`, and
`waterfall` exercises `waterfalls`. Assign actual iteration numbers from the
scoped dependency plan; fixtures do not fix their order or the total count.
These four configurations span three scenario families and are only part of
feature acceptance. Add tests for other selected features, including the first
single-leaf invocation, schema rejection and configurable retry/timeout policy.
`alternate-transform` uses a different mocked Transform binding that
returns twice the amount, proving configuration reuse without an engine edit.
Discover the actual service's binding fields; these labels are fixture concepts.

| Scenario | Demonstrate | Expected behavior |
| --- | --- | --- |
| Connect → Transform → Persist | Exchange, normalize and persist one mock fact. | Return the normalized fact and write acknowledgment; a retry must not duplicate it. |
| Connect → Transform → Rule → Schedule → Persist | Evaluate eligibility before scheduling and persistence. | Accepted input schedules once and persists; rejected input skips both. Schedule is an explicitly mocked dependency, not a claim of a deployed product. |
| Primary/fallback flow waterfall | Exercise a failed primary flow and a successful fallback. | Record both attempts, return the fallback result, and stop further attempts; all-failed input returns a terminal failure. |

The JSON fixtures define teaching inputs and expected results, not a new System
wire format. Bind them to the current target contract. Keep mock responses
independent from the orchestration implementation so tests can detect wiring errors.

For each case, capture `phase` (`demonstration` or `framework-acceptance`),
`iteration` (positive index in the actual plan), `featureId` (as specified in the fixture), `scenarioId`, `caseId`,
`configurationId`, `requestId`, `executionArn`, `logReference`, `invokedBy: "user"`,
`actualResponse`, ordered `observedSteps`, `humanObservation`, and `mocked: true`.
Use the same actual configuration ID for cases sharing a fixture configuration;
use distinct IDs for the different fixture configurations. Link the correlated log
event/stream in `logReference`; also retain checkpoint order in the progress record.
Use actual execution evidence. Store the records as a JSON array in the target
test evidence directory, outside this plugin. Do not copy sensitive payloads.

Validate that the recorded acceptance evidence covers the expected results:

```bash
python3 scripts/check-system-acceptance.py path/to/recorded-evidence.json
```

This command checks only this scenario pack's evidence and comparisons. It does
not prove coverage of the complete feature plan, contact AWS or authenticate the
record. Maintain evidence for all other selected features in the target repository.
Inspect the actual executions before
claiming live acceptance. It does not enforce when code was implemented or prove
who ran it. Local checks, synthesis, demonstration PoCs and framework acceptance
remain separate. If the user explicitly changes the checkpoint requirement,
report omissions instead of manufacturing evidence or calling guided acceptance complete.
