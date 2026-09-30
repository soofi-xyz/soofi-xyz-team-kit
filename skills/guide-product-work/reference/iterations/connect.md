# Connect capability map

Use Lapras for the engine and Wingull for supported partner/flow configurations.
Apply the [shared workflow](../../SKILL.md) to the requested capabilities. These
nine areas are an inventory; expand driver, verb and activation families into
separate usable pieces when their behaviors require separate explanations/tests.
Use an authorized mock/sandbox, tiny samples, secret references and disabled
activations. Keep parsing, graph writes and internal product actions outside Connect.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `direct-exchange` — fetch or call once | One approved connection | Deliver one supported verb through job submission, execution and reply; configure a single safe exchange and an invalid resource. | Inspect job/task logs and returned artifact/reply; match status, payload pointer and checksum. |
| `connection-drivers` — reuse flows with another transport/auth | Direct exchange | Add each requested driver/auth capability as its own increment; configure connection references without embedding secrets in flows. | Inspect resolved driver and sanitized auth diagnostics; compare successful and rejected credentials using safe fixtures. |
| `listing-pagination` — enumerate a bounded source | A listing-capable driver | Deliver LIST/pagination limits; configure different prefixes, page sizes and empty results. | Inspect page/worker logs and the final inventory; verify counts, termination and limit handling. |
| `flow-composition` — run dependent or bounded parallel tasks | Direct exchange; listing for fan-out | Deliver the required sequencing/bindings and Map concurrency; configure a small multi-task flow and vary its limits. | Inspect task transitions, bindings, concurrency and partial failure; show downstream input derives from the expected result. |
| `outbound-verbs` — deliver or move an external artifact | Relevant driver and safe destination | Deliver each requested PUT/MOVE or other supported write verb in separate pieces where independently useful; configure a sandbox destination. | Inspect execution and delivery receipts/checksums; test safe duplicate/error behavior without contacting real recipients. |
| `polling` — await partner completion | CALL-capable connection | Deliver bounded POLL behavior; configure completion, timeout and transient-error fixtures. | Inspect attempts, wait states and terminal result; prove polling stops at the configured bound. |
| `webhook-wait` — resume from a callback | Supported callback connection/runtime | Deliver WAIT_FOR_WEBHOOK and correlation; configure valid, mismatched and duplicate test callbacks. | Inspect suspended/resumed execution and callback logs; verify only the correct callback advances it. |
| `activations` — invoke a pinned flow automatically | Runnable versioned flow | Deliver each required schedule/drop-zone/webhook activation type separately; configure and enable it only for the authorized test, then disable it. | Inspect activation → job correlation, actual execution and cleanup; distinguish trigger receipt from job completion. |
| `ledger-replay` — suppress duplicates and recover delivery | Relevant exchange/flow | Deliver supported ledger/replay controls; configure duplicate inputs, transient failure and a safe retry. | Inspect actual attempts, ledger decisions and artifacts/replies; prove recovered work does not repeat a completed external effect. |

Use [the block contracts](../../../build-connect-product/reference/blocks.md)
and [runtime scope](../../../build-connect-product/reference/aws-runtime.md).
Driver/verb entries describe scoped feature families, not permission to implement
every provider. Missing runtime support belongs to Lapras. New-partner configuration
selects existing capabilities; it does not rebuild the engine. Preserve the approval
boundary for production partner reads and never send real messages/files/payments
to satisfy a teaching checkpoint.
