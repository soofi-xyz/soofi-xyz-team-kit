# Adding a validation profile

A profile holds the domain knowledge for one family of directional mappings:
vocabulary, datasets, invariants, repositories, evidence, and workflow order.
The agent and core skill never branch on a profile name. Any registered
language pair can be validated through one of three paths.

## Path 1: an existing profile matches

Profiles are data: keep them in any directory and pass it with `--profiles` (this kit's
schema-valid examples live in `examples/profiles/`, with calibration dossiers in
`examples/calibrations/`; no tool reads them by default). The resolver matches a profile when
its `directions` declare the exact `id@version` of every workflow step. Nothing to add. Profile drift findings
(`ProfileRegistrationStatusDrift`, `ProfileOutputDatasetDrift`,
`ProfileParityDrift`) mean the profile needs a reviewed update. They do not
mean the mapping is wrong.

## Path 2: an auto-generated draft (no profile yet)

```bash
python3 skills/validate-transform-configuration/scripts/resolve-transform-intent.py draft-profile \
  --request "test <source> to <target>" --lexicon-root … --main-lexicon-root … --registry dev=… --out draft.json
```

The draft conforms to `transform-configuration-profile-draft.schema.json`. Facts
derived from the registry are `INFERRED`, and everything else is `MISSING` with
the next question. Keep the draft local (`local://transform-configuration-intake/…`).
Ask the questions, then promote it: fill every strict-schema field, set
`promotionEligible`, and validate against
`transform-configuration-profile.schema.json`. A promoted draft may run once
without being committed. Commit it only through a reviewed PR to this kit.

## Path 3: author a committed profile

1. Name it `<domain>-<purpose>.json`, with `id` equal to the filename.
2. Start from `draft-profile` for the target request: its `derivedDirections` are the directions
   regenerated from the registration and language definitions (`outputContracts` with required
   inputs, format, columns and key). Copy them, then:
   - registered mappings use `"status": "registered"` with `id`, `version`,
     `repository`, `sourcePaths` (the checked-in registration or generator
     path), `artifactPath` (`transform-mappings/<id>/<version>/mapping.json`),
     and `expectedOutputDatasets` exactly as registered;
   - mappings not yet on Lexicon `main` use `"status": "not-registered"` with
     `expectedId`, `owner`, `reason`, and a `plannedSource`.
3. Set `parityPolicy`:
   `{"fieldSource": "language-definition-and-registration", "declaredFields": "minimum", "undefinedDatasets": "block"}`.
   Add `parityDatasets` only for fields that must be named in the report; the
   language definition supplies the rest.
4. Declare `validationWorkflow.steps` in execution order and choose
   `persistPolicy` (`forbidden` unless a Persist readback is part of the
   contract).
5. Do not copy the shared `reference/forbidden-concepts.json` into the profile.
   It applies to every profile: forbidden labels, scoped properties that must
   not appear in `lexicon.json`, and retired mapping versions. Add a label to
   `lexiconConceptPolicy.forbiddenConcepts` only when one profile needs an
   extra restriction. Add to the shared list through a reviewed PR with the
   pinned Lexicon evidence.
   Optional contracts, all closed in the schema:
   - `outputContracts` per direction: per-output `requiredInputs`, `format`
     (`csv` needs a one-character `delimiter` and `header`), `columnSource`,
     `columns`, `columnConstraints`, `status` (`planned`/`verified`), `tbd`;
   - `outputDatasetMatch: includes` when the profile runs a subset of a large
     generated mapping;
   - `lexiconModelPolicy` to forbid any candidate `lexicon.json` diff against `main`,
     with `approvedAdditions` naming each owner-approved new property and its approval;
   - `roundTripStrategy` for source-sample reprojection and column diffs;
   - `partialInputPolicy` with pinned Transform evidence and accepted/rejected cases;
   - `artifactStatus: planned` with `tbd` for a reserved, unstaged DEV package.
6. Add `validationSources`: the registry's mapping contract test as a `repository-test`,
   plus `existing-dev-artifact` or `sanitized-evidence-package` entries that follow
   `test-dataset-recommendations.md`.
7. Add the required `sourceWindowPolicy` for the mandatory final PROD-derived validation: the
   source families the first workflow step reads, the coverage signals a complete day must show,
   `minimumCompleteUtcDays` and `allowLongerRange`, plus `origin` (`profile-declared` or
   `derived-at-intake`), `recordedDefaults` for every value you did not choose explicitly, and
   `evidenceIds`. Start from `draft-profile`'s `derivedSourceWindowPolicy` or
   `source_window.py policy --profile <profile>`; a profile without the policy cannot be promoted.
8. Declare mapping-specific semantics as data, never as code:
   - `derivationOverrides`: each `(dataset, field)` the profile intentionally declares instead of
     deriving (for example consumer-contract `columns` for a dataset the target language does not
     define, or the subset of columns a projection fills), with a reason;
   - `columnConstraints` on an output contract (`const`, `enum`, `pattern`, or `nonEmpty`);
   - invariants with a declarative `check` (`column-constraint`, `unique-key`, `row-count`,
     `columns-exact`, `matches-oracle`); rules that cannot be expressed that way stay prose and
     need an oracle dataset;
   - `oracles` (`part-bytes`, `sorted-rows`, or `keyed` comparisons against a reference dataset)
     and `allowedLosses` (`emptied` or `any`) that a keyed oracle may cite.
9. Prove the profile regenerates from the registry:
   `resolve-transform-intent.py check-profile --profile <file> ...` must report
   `derivedEqualsProfileModuloOverrides: true`. Example profiles in this kit are schema-checked by
   `scripts/test-validate-transform-configuration.py`; run `scripts/validate-plugin.sh`.

## Keep profiles portable

- Never put machine-specific paths, local checkout locations, personal AWS profile names or
  account IDs in a profile. Repositories are slugs plus required paths; evidence is an S3
  prefix with manifest SHA-256 and VersionId; environments are names the operator maps to
  their own AWS profiles at run time.
- Mapping-specific oracles (precedence rules, reconstructions, cutoffs) belong in the profile's
  invariants, `oracles` and `allowedLosses`, with expected aggregates in the calibration dossier,
  not in scripts that only exist on one machine.

## Testing a new mapping before it has a profile

1. Materialize the candidate mapping from its pinned repository:
   `fetch_validation_inputs.py repo ...` then `fetch_validation_inputs.py materialize --command "<repo's materialization command with {out}>"`.
2. Write a small PII-free fixture and an oracle from the specification (not from the SQL), in
   the shape of `fixtures/synthetic-registry/` (inputs, `expected/`, a manifest).
3. Run `local_mapping_run.py --mapping <mapping.json> --input <table>=<fixture> --negatives --out <dir>`,
   derive contracts with `resolve-transform-intent.py contracts --mapping <id>@<version>`, and run
   `compare_datasets.py check --contracts ... --dataset <dataset>=<dir>/<dataset> --oracle <id>=<oracle>`.
4. Run `resolve-transform-intent.py draft-profile ...`, promote the draft (Path 3), and check it
   with `check-profile`; `evaluate_run.py --mode synthetic-local` then computes phases 1–11 as an
   earlier proof (`modeScopedResult`). The verdict stays `BLOCKED` until the final PROD-derived
   validation runs in `observed-dev` on a confirmed window.

## Minimal skeleton

Every `<…>` must be replaced with a verified value. The strict schema rejects
the skeleton as written.

```json
{
  "id": "<domain>-<purpose>.json",
  "contractVersion": 1,
  "terminologyAliases": { "<term>": ["<user phrase>"] },
  "roles": { "source": "<meaning>", "target": "<meaning>" },
  "transformClassification": { "kind": "deterministic", "evidenceBasis": "<why>", "expectedOutputTests": ["<id>"], "negativeTests": ["<id>"] },
  "configurationChoices": { "fieldNames": [], "schemaShape": [], "formats": [], "normalizationRules": [], "mappingExpressions": ["<id>@<version>"], "profileInputs": [], "vocabularySelections": [] },
  "productBoundary": { "prohibitedAsConfiguration": ["representation-family", "identity-scheme", "executable-code-path", "dependency-type", "storage-engine-mode", "failure-semantics"], "onDetection": "block-and-handoff" },
  "datasets": [{ "name": "<dataset>", "role": "source", "required": true, "schemaSource": "lexicon-language-definition" }],
  "invariants": [{ "id": "<id>", "description": "<rule>", "phase": 11, "failureCode": "<Code>" }],
  "repositories": [{ "slug": "<owner>/<registry-repo>", "purpose": "<why>", "role": "configuration-source", "revisionPolicy": "commit-sha", "candidateDiscovery": "requested-ref-then-matching-open-pr-then-default-branch", "requiredPaths": ["<language definition path>"] }],
  "discoveryProbes": [{ "id": "resolve-active-mappings", "kind": "configuration", "description": "Resolve exact enabled directional mappings and digests", "readOnly": true }],
  "directions": [{ "id": "<source>-to-<target>", "fromLanguage": "<source>", "toLanguage": "<target>", "required": true, "mapping": { "status": "registered", "id": "<source>-to-<target>", "version": "<x.y.z>", "repository": "<owner>/<registry-repo>", "sourcePaths": ["<path>"], "artifactPath": "transform-mappings/<source>-to-<target>/<x.y.z>/mapping.json", "expectedOutputDatasets": ["<dataset>"] } }],
  "validationWorkflow": { "steps": [{ "sequence": 1, "id": "forward", "direction": "<source>-to-<target>", "inputSource": "profile-evidence" }], "persistPolicy": "forbidden" },
  "validationSources": [{ "id": "registry-mapping-contract-tests", "kind": "repository-test", "repository": "<owner>/<registry-repo>", "path": "<contract test path>", "appliesTo": ["<source>-to-<target>"], "required": true }],
  "evidencePolicy": { "sensitivity": "restricted", "sanitization": "aggregates-and-digests-only", "allowed": ["counts", "schemas", "sha256", "statuses", "durations", "costs", "credential-free-locations"], "prohibited": ["raw-pii", "business-identifiers", "secret-values", "credentials", "signed-urls", "source-rows"] },
  "graph": { "required": true, "identityRules": ["<rule>"], "endpointRules": ["Dangling endpoint count must equal zero"] },
  "adapters": [],
  "consumers": [{ "name": "<consumer>", "owner": "<agent>", "contract": "<contract>" }],
  "parityPolicy": { "fieldSource": "language-definition-and-registration", "declaredFields": "minimum", "undefinedDatasets": "block" },
  "sourceWindowPolicy": { "kind": "prod-derived-complete-utc-days", "minimumCompleteUtcDays": 1, "allowLongerRange": true, "requiredSourceFamilies": ["<dataset>"], "requiredCoverageSignals": ["<dataset>-rows-present"], "origin": "derived-at-intake", "recordedDefaults": { "minimumCompleteUtcDays": 1, "allowLongerRange": true }, "evidenceIds": ["profile-source-datasets"] },
  "scaleTiers": [{ "id": "synthetic", "maximumRows": 100, "maximumCostUsd": 0, "evidenceRequired": true }],
  "approvals": { "devWrites": "explicit", "prodWrites": "forbidden", "perOperation": true }
}
```
