# Validation report

Render the validated Transform configuration/readiness package into this order:

1. **Configuration-readiness verdict** — `READY`, `NOT_READY`, or `BLOCKED`; one-sentence reason. State explicitly that this is not platform or product approval. For `READY`, name the confirmed PROD-derived window the final DEV run used and state that it ran on real data only; for a run without it, state `FinalProdDerivedValidationRequired` and what is still needed.
2. **Scope and discovery** — profile, all required directions, environment, mode and consumers; repositories searched, required paths, candidate-selection method, matching pull requests, selected commit SHAs and rejected candidates. Include the source-window policy (declared or derived, with recorded defaults), the sanitized complete-UTC-day candidate comparison, recommended half-open window, minimum-day policy, confirmation status and evidence IDs before any staging approval.
3. **Reusable package** — package version; Transform product/version; every source/target language and mapping digest; Lexicon digest; dependencies; Test evidence; Deploy-owned environment digest; Marketplace-registration readiness.
4. **Phase results** — all 12 phases in order with status, evidence IDs and concise reason, plus any dry-run result as `modeScopedResult`.
   **PROD actuals** — per slice, the baseline kind and where it came from, counts by outcome, or the explicit statement that none exists and the fallback used.
   **Canary** — 10 real events per slice (outcome mix), execution ids, S3 inputs and outputs, row counts, comparison with the PROD actual, and the gate: the user's answer, the owner's pre-approval, or `CANARY_FAILED` (in which case the full run is not suggested).
   **Final PROD-derived validation** — confirmed window, staging approval digests and manifest SHA-256s, DEV execution approval digests, and the full-window comparison with PROD actuals; or why it is `BLOCKED`.
5. **Boundary decisions** — every proposal labeled `CONFIGURATION` or `PRODUCT_CHANGE`, with evidence, state and owner handoff; owner-accepted product changes stay listed and flagged for Kecleon.
6. **Dataset reconciliation** — sanitized schema digests, counts, hashes and credential-free locations.
7. **Graph and Persist** — identities, endpoint closure, canary and readback, or explicit not-required rationale; preserve Model/Persist ownership.
8. **Export, hydration and parity** — window/timezone, manifests, counts and field mismatches.
9. **Approvals and cost** — each DEV operation digest, approval chronology, ceiling, estimate and actual.
10. **Failures and blockers** — safe failure code, phase, effect and evidence.
11. **Recommended remediation** — one entry per failure/blocker: `CONFIGURATION`, `PRODUCT_CHANGE`, or `ACCESS_OR_EVIDENCE`; owner/repository; exact pinned and evidence-backed source location; smallest recommended change; regression evidence; phases/directions to rerun.
12. **Specialist handoffs** — owner, exact failed contract, pinned evidence and required proof for re-validation.
13. **Limitations** — untested scale tiers, unavailable evidence and expected losses.

## Reporting rules

- Put the verdict first and make it identical to the artifact.
- When `versionSelection.rule` is `latest-published-semver`, repeat its `notice` with the configuration identity.
- Distinguish observed runtime behavior from static/test evidence.
- Show numbers for counts, mismatches, endpoints and costs.
- Do not include raw rows, PII, business identifiers, secret values, credentials or signed URLs.
- Do not call `APPROVAL_REQUIRED` a failure. It yields a blocked validation until approved evidence exists.
- Do not imply PROD readiness from DEV evidence. PROD remains read-only and receives a handoff.
- Never report `READY` from a dry run or a canary alone; only a passing canary followed by the approved full-window DEV run on the confirmed PROD-derived window can support it.
- Do not hide failed gates behind an overall narrative; any required `FAIL` means `NOT_READY`.
- Do not classify by repository alone. Mapping declarations stored in Lexicon remain Transform configuration; executable reader/schema/failure behavior remains a Transform product change.
- Recommend fixes without editing code, weakening validation, or claiming the recommendation has passed.
- Never report “likely” paths. Trace generated artifacts to checked-in source and provide location evidence, or state that source discovery remains unresolved.
- Never present a PROD-derived source window as selected until the user explicitly confirms the recommended day or a permitted longer range.
