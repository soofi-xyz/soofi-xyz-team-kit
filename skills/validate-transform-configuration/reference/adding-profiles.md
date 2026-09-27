# Adding a validation profile

A profile holds the domain knowledge for one family of directional mappings:
vocabulary, datasets, invariants, repositories, evidence, and workflow order.
The agent and core skill never branch on a profile name. Any registered
language pair can be validated through one of three paths.

## Path 1: an existing profile matches

The resolver matches a profile when one of its `directions` declares the exact
`id@version` of the first workflow step. Nothing to add. Profile drift findings
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

1. Name it `reference/profiles/<domain>-<purpose>.json`, with `id` equal to the
   filename.
2. Start from the resolver output for the target request. Copy `directions`
   from `workflow.steps` and `optionalCrossSource`:
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
5. Add `lexiconConceptPolicy.forbiddenConcepts` for any concepts that were
   removed from Lexicon and must not come back.
6. Add `validationSources`: the Lexicon `infra/test/transform-mappings.spec.ts`
   repository test, plus `existing-dev-artifact` or `sanitized-evidence-package`
   entries that follow `test-dataset-recommendations.md`.
7. Add `sourceWindowPolicy` when validation copies or derives data from PROD.
8. Add the filename to `PROFILE_NAMES` and a calibration dossier to
   `CALIBRATION_NAMES` in `scripts/test-validate-transform-configuration.py`.
   Then run `scripts/validate-plugin.sh`.

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
  "repositories": [{ "slug": "Spring-Oaks-Capital-LLC/lexicon", "purpose": "<why>", "role": "configuration-source", "revisionPolicy": "commit-sha", "candidateDiscovery": "requested-ref-then-matching-open-pr-then-default-branch", "requiredPaths": ["src/data/<source>.json"] }],
  "discoveryProbes": [{ "id": "resolve-active-mappings", "kind": "configuration", "description": "Resolve exact enabled directional mappings and digests", "readOnly": true }],
  "directions": [{ "id": "<source>-to-<target>", "fromLanguage": "<source>", "toLanguage": "<target>", "required": true, "mapping": { "status": "registered", "id": "<source>-to-<target>", "version": "<x.y.z>", "repository": "Spring-Oaks-Capital-LLC/lexicon", "sourcePaths": ["<path>"], "artifactPath": "transform-mappings/<source>-to-<target>/<x.y.z>/mapping.json", "expectedOutputDatasets": ["<dataset>"] } }],
  "validationWorkflow": { "steps": [{ "sequence": 1, "id": "forward", "direction": "<source>-to-<target>", "inputSource": "profile-evidence" }], "persistPolicy": "forbidden" },
  "validationSources": [{ "id": "lexicon-mapping-contract-tests", "kind": "repository-test", "repository": "Spring-Oaks-Capital-LLC/lexicon", "path": "infra/test/transform-mappings.spec.ts", "appliesTo": ["<source>-to-<target>"], "required": true }],
  "evidencePolicy": { "sensitivity": "restricted", "sanitization": "aggregates-and-digests-only", "allowed": ["counts", "schemas", "sha256", "statuses", "durations", "costs", "credential-free-locations"], "prohibited": ["raw-pii", "business-identifiers", "secret-values", "credentials", "signed-urls", "source-rows"] },
  "graph": { "required": true, "identityRules": ["<rule>"], "endpointRules": ["Dangling endpoint count must equal zero"] },
  "adapters": [],
  "consumers": [{ "name": "<consumer>", "owner": "<agent>", "contract": "<contract>" }],
  "parityPolicy": { "fieldSource": "language-definition-and-registration", "declaredFields": "minimum", "undefinedDatasets": "block" },
  "scaleTiers": [{ "id": "synthetic", "maximumRows": 100, "maximumCostUsd": 0, "evidenceRequired": true }],
  "approvals": { "devWrites": "explicit", "prodWrites": "forbidden", "perOperation": true }
}
```

## SMS status (Lexicon `main` `6f7a2eb`, 2026-09-27)

- There is no `sms` language definition: no `src/data/sms.json`, no
  `lexicons.ts` key, and no `/lexicon/sms-data-uri` in DEV or PROD.
  `lexicon-to-sms@1.0.0` targets `sms` anyway, so `sms` is
  `MAPPING_ENDPOINT_ONLY`.
- There is no `sms-to-lexicon` mapping. `sms-to-interprose` and
  `sms-log-to-interprose` are retired.
- `lexicon-to-interprose@2.0.0` outputs `sms_log`, which `interprose.json` does
  not declare (it declares `txt_msg_log`).
- The SMS lifecycle is validated through the existing Quiq SMS lifecycle
  profile (`quiq-to-lexicon@1.0.0`, `lexicon-to-sms@1.0.0`,
  `lexicon-to-interprose@2.0.0`). `test sms to lexicon` returns `NO_MAPPING`
  and offers those mappings. Derived parity for the `sms` side stays
  `BLOCKED` until Lexicon defines the language, or the profile adopts
  `undefinedDatasets: consumer-contract` with a pinned sms-workflow contract.
  Route the language definition to Mew/Unown and mapping changes to Kecleon.
