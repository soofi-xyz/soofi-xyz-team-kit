# Build capability map

Use Tinkaton to implement Build and Metang to configure existing
capabilities. Follow the [shared workflow](../../SKILL.md). These 7 areas are a
starting inventory, not a fixed iteration count. Order dependencies and split
independently useful features further. Use at least four pieces for a full-product
build; narrow work selects only relevant pieces. Keep automated tests and user/AWS
feedback inside each piece, not as a final testing phase.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `job-intake` — submit and observe a build job | Verified HTTP/auth contract and source fixture | Deliver minimal submit/status/result with stable job identity and a fake runner first. Compare SERVICE/DATA requests, invalid options and another caller’s job. | Trace API request, job record and execution; verify authorization, terminal fake result and correlation without claiming an actual artifact was built. |
| `source-validation` — accept safe source archives | Job intake | Deliver source URL/archive normalization and declarative manifest validation. Exercise valid sources, traversal entries, forbidden lifecycle commands and unsafe URLs. | Inspect validation states and rejection reason; confirm rejected input never starts dependency install or writes deployment resources. |
| `assembly` — produce a portable cloud assembly | Validated source | Deliver isolated dependency install, fixed checks and credentialless CDK synthesis. Compare small SERVICE/DATA projects and a failed test or forbidden account lookup. | Follow the real test runner logs to templates/assets; verify no source-provided buildspec, tenant credentials or deployment effects. Distinguish synth from deploy. |
| `asset-policy` — enforce deployable runtime assets | Synthesized assembly | Deliver final Lambda asset checks for approved bundling, minification, obfuscation and absent source maps; reject forbidden source/package files and unsupported image assets. | Inspect asset-policy report and the actual archive; confirm a deliberately failing fixture cannot produce a successful release artifact. |
| `provenance` — produce verifiable artifact manifests | Accepted assembly/assets | Deliver normalized packaging, source/assembly/template/asset digests and Model release provenance. Compare equivalent inputs and tampered artifacts without promising determinism the contract does not guarantee. | Read result API, manifest and S3 metadata; independently compute hashes and verify no secret URLs or local paths leak into artifacts. |
| `delivery` — deliver job results reliably | Observable artifact result | Deliver supported callback delivery, logs/manifest retrieval and temporary download access. Exercise success, callback timeout/retry and expired URL. | Inspect callback attempts and result retrieval; confirm delivery failure does not silently rewrite a completed build result or expose callback credentials. |
| `recovery-retention` — recover failed jobs and expire owned artifacts | Selected job/artifact capabilities | Deliver supported job timeout/failure reconciliation and retention cleanup. Exercise interrupted runner, repeated delivery and expired versus retained artifacts. | Inspect terminal status and cleanup logs; compare evidence before/after expiry and verify unrelated artifacts remain. Finish with cumulative source-to-artifact acceptance. |

Read [the product contract](../../../build-build-service/reference/PRD.md) and
[synthetic test data](../../../build-build-service/reference/test-data.md).
Discover actual routes, auth, statuses and test adapters from the target revision.
Exercise each piece through the HTTP API, including submission/status/results for
async work. Direct AWS inspection supports evidence; it does not replace API use.
Start with faked dependencies, then run the real test-stack API/workflow using those
fakes. Use live dependencies only within authorized scope. Give one invocation and
at most three AWS inspection steps, collect the person’s redacted ID and observation,
and wait for that feedback before implementing or configuring the next piece.
Keep local tests, synthesis, deployed mocked execution and live effects distinct.

Keep Marketplace publication/review with Regigigas/Registeel and deployment execution with Corviknight/Skarmory. A successful build proves artifact creation, not publication or installation.
