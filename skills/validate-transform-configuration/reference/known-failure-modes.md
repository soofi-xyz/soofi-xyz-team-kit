# Known failure modes

| Failure | Detection | Result and route |
| --- | --- | --- |
| Product behavior is hidden as a profile setting | Reject representation family, identity scheme, executable path, dependency type, storage mode, or failure semantics in configuration | `BLOCKED`; hand off to the owning product/builder |
| Non-deterministic behavior is evaluated only with deterministic equality checks | Require confidence outputs, thresholds, human-review policy, and Test evidence | `BLOCKED`; Test and owning product must supply supported mechanics |
| Unsupported mapping option is accepted or ignored | Validate format-specific allowlists at publication and resolution | `FAIL`; Kecleon removes or implements the option with fixtures |
| Optional JSON property is omitted and Spark inference drops/mistypes it | Derive an explicit schema from the language definition; fixture omits the nullable field | `FAIL`; Kecleon fixes schema-bound reading |
| Local Spark behavior differs from deployed Spark 3.3 | Execute compatibility fixtures at the deployed major/minor and compare plans/types | `FAIL` or `BLOCKED` when runtime cannot be reproduced; Kecleon owns |
| Deployment drift or latest-PR-wins race | Compare deployed package/template/configuration digests with the evaluated commit and mapping | `FAIL`; deployment owner/Kecleon owns a pinned release |
| Persist and Lexicon revisions disagree | Bind Persist canary validation and readback to the same language-definition digest | `FAIL`; Conkeldurr with Mew/Unown |
| Export window uses local time or shifts day boundaries | Assert UTC source watermark and inclusive/exclusive bounds around offset transitions | `FAIL`; product owner |
| Graph edge points at an absent/differently normalized vertex | Distributed anti-join endpoints against declared vertex IDs | `FAIL`; Kecleon for bindings, Mew/Unown for proven model gaps |
| Hashes differ because ordering/canonicalization is unstable | Apply profile canonicalization, sort only declared unordered sets, preserve array order | `FAIL`; Kecleon or product owner |
| Artifact pointer exists but content was not hydrated | Compare immutable manifest object/count/hash set with physical readback | `FAIL`; adapter/product owner |
| Mutable manifests or branch refs are treated as evidence | Reject refs without commit SHA/version/content digest | `FAIL`; release owner |
| Workflow says success but rows/files are missing | Reconcile committed metadata with physical object/row/byte counts | `FAIL`; Kecleon |
| Retry reuses partial outputs or a changed plan | Require a fresh execution identity and operation-specific approval after inspecting partials | `BLOCKED` until authorized; never blind retry |
| Secret, PII, ID, or credential-bearing URL enters evidence | Scan and reject before artifact publication | `FAIL`; redact and recollect, never preserve the value |
| PROD proof requires a write | Stop and produce a specialist/operator handoff | `BLOCKED`; PROD remains read-only |

Do not convert a detected failure into a warning. Re-validate against new immutable artifacts after the owning specialist supplies the missing proof.
