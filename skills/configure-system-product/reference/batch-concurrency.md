# Batch concurrency

A System `Batch` state runs its `Steps` once per item of `ItemsPath` or
`ItemsFile`, such as an array a Connect job returned. Set at most one of these on
the batch to bound how many items run at once:

| Template                                  | Items in flight                                   |
| ----------------------------------------- | ------------------------------------------------- |
| neither field                             | 4                                                 |
| `"MaxConcurrency": 10`                    | 10; an integer from 1 to 1000                     |
| `"MaxConcurrency.$": "$.input.concurrency"` | the invocation's `input.concurrency`, or 4 when it is missing or null |

`MaxConcurrency.$` is a dotted path to the invocation input or a step that has
already run, such as `$.steps.Plan.output.limit`; it cannot read `$.item`.
System rejects, when the template is saved, a fixed value that is not an
integer from 1 to 1000, a path that is not dotted or that the batch cannot read,
and a batch that sets both fields. A referenced value that is present but is not
an integer from 1 to 1000 (`0`, `-1`, `2.5`, `"4"`) fails the run at
`<Batch>.System.Invalid` with `System.InvalidMaxConcurrency` before any item
starts; the batch's `Catch` does not apply. Bound the input in the definition's
`inputSchema` (`"type": "integer"`, `minimum`, `maximum`) so a caller's bad value
is refused at invocation instead.

```json
"Events": {
  "Type": "Batch",
  "ItemsPath": "$.steps.ListEvents.output.values.events",
  "MaxConcurrency.$": "$.input.concurrency",
  "Steps": { "StartAt": "StartEvent", "States": { "...": {} } }
}
```

The default was 10 before System 7407ee9 (prismteam-ai/system#47). A stored
template keeps the value it was saved with, but the next save of a source that
sets neither field runs at 4. Set `"MaxConcurrency": 10` explicitly where a
batch should keep 10.

The bound counts batch items, not child work. An item that stops waiting for a
child System invocation (for example after a poll limit, recorded as
`TIMED_OUT`) frees its slot while the child keeps running, so more children than
the bound can be in flight. Size downstream budgets such as Glue concurrency for
that, and check a run's `TimeoutSeconds` at the lowest concurrency a caller may
pass: `ceil(max items / lowest concurrency) x per-item time` must fit.

To verify, invoke with a value, without one and with `0`, then read
`$.steps.<Batch>.concurrency` and the map run's maximum concurrency in the
Step Functions execution, and the `System.InvalidMaxConcurrency` failure.
