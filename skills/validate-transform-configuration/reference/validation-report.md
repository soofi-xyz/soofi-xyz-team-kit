# Validation report

Render the validated Transform configuration/readiness package into this order:

1. **Configuration-readiness verdict** — `READY`, `NOT_READY`, or `BLOCKED`; one-sentence reason. State explicitly that this is not platform or product approval.
2. **Scope and discovery** — profile, all required directions, environment, mode and consumers; repositories searched, required paths, candidate-selection method, matching pull requests, selected commit SHAs and rejected candidates.
3. **Reusable package** — package version; Transform product/version; every source/target language and mapping digest; Lexicon digest; dependencies; Test evidence; Deploy-owned environment digest; Marketplace-registration readiness.
4. **Phase results** — all 12 phases in order with status, evidence IDs and concise reason.
5. **Boundary decisions** — every proposal labeled `CONFIGURATION` or `PRODUCT_CHANGE`, with evidence, state and owner handoff.
6. **Dataset reconciliation** — sanitized schema digests, counts, hashes and credential-free locations.
7. **Graph and Persist** — identities, endpoint closure, canary and readback, or explicit not-required rationale; preserve Model/Persist ownership.
8. **Export, hydration and parity** — window/timezone, manifests, counts and field mismatches.
9. **Approvals and cost** — each DEV operation digest, approval chronology, ceiling, estimate and actual.
10. **Failures and blockers** — safe failure code, phase, effect and evidence.
11. **Specialist handoffs** — owner, exact failed contract, pinned evidence and required proof for re-validation.
12. **Limitations** — untested scale tiers, unavailable evidence and expected losses.

## Reporting rules

- Put the verdict first and make it identical to the artifact.
- Distinguish observed runtime behavior from static/test evidence.
- Show numbers for counts, mismatches, endpoints and costs.
- Do not include raw rows, PII, business identifiers, secret values, credentials or signed URLs.
- Do not call `APPROVAL_REQUIRED` a failure. It yields a blocked validation until approved evidence exists.
- Do not imply PROD readiness from DEV evidence. PROD remains read-only and receives a handoff.
- Do not hide failed gates behind an overall narrative; any required `FAIL` means `NOT_READY`.
