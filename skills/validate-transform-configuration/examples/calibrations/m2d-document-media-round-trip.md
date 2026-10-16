# M2D document/media round-trip calibration

Use only with `m2d-document-media.json`. The boundaries come from the team-kit M2D/Connect contracts: Connect fetches or lands external media; M2D owns unpacking, extraction and classification; Persist may provide classification reuse. This dossier does not invent a direct external-system call from Transform.

Classification: `deterministic` for document/media metadata and linkage mappings only. M2D extraction or model-based classification is product runtime behavior; confidence/review mechanics would require a separate non-deterministic contract and Test evidence before readiness.

## Real-window coverage

The window should contain API-fetched documents, cross-account object pointers, encrypted seller drops and Azure-landed objects, with repeated content, varied media types and nullable metadata. The canary picks 10 real events per slice with both accepted and rejected PROD outcomes. Behaviors absent from the window are reported as not covered, never simulated. Retain only aggregate counts and digests.

## Expected flow

1. Validate source manifest immutability and content digests.
2. Hydrate only declared artifacts and reject stale/missing entries.
3. Transform metadata into document/media vertices and linkage edges.
4. Prove deterministic content/metadata identity and zero dangling endpoints.
5. Use a bounded Persist canary and read classification linkage back.
6. Reconcile classified-media/export manifests through the declared consumer boundary.

Expected passing evidence: every manifest entry hydrated, one metadata record per entry, content-digest counts equal to the PROD actual, complete linkage, zero dangling endpoints and preserved provenance revisions.

## Final PROD-derived validation

Everything runs on real data. Compare at least 7 recent complete UTC days of `document-manifests` from
read-only PROD metadata against the profile's `sourceWindowPolicy` (derived at intake with recorded defaults) and ask the user
to confirm the recommended window (or use the owner's "most recent full UTC day with real data
per slice"). If a slice has no data that day, say so and suggest the nearest UTC day with data.
Stage a canary of 10 real events per slice (mixed outcomes) into DEV under its own approval
digest, run it in `observed-dev`, and compare it with what PROD actually did (the slice's PROD
actual in `reference/prod-actuals.json`). Show the execution ids, S3 inputs and outputs, row
counts and the comparison, and ask before the full window unless the owner pre-approved a
passing canary. A failed canary stops the validation. After approval, stage and run the full
window and pass the regression expectations below against the PROD actuals. If PROD access,
the confirmation, the canary gate or an approval is missing, the verdict stays `BLOCKED`.

## Regression expectations

- Mutable or overwritten manifest: phase 6 `FAIL`.
- Missing hydrated object despite a workflow success status: phase 9 `FAIL`.
- Persist validates against a different Lexicon digest: phase 10 `FAIL`.
- Nondeterministic document/media hashing or dangling linkage: phase 10 `FAIL`.
- Classified output loses source digest/provenance: phase 11 `FAIL`.
- Replay without partial-artifact inspection and new approval: `BLOCKED`.
