# Short-request intent resolution

Silvally accepts requests as short as `test <source> to <target>`,
`test <hub> <output words> to <target>`, or `test <hub> (<producer>) to <target>`. This
reference defines how such a request becomes an exact `(source language, target language,
direction, mapping id@version)` plan. It is read-only discovery; no step here
writes outside a disposable local directory. The resolver knows no language, mapping or
dataset in advance: every word is matched against what the inspected registry declares.

## Grammar

```text
[/silvally] <verb> <source terms> [(<qualifiers>)] <to|into|->|=>|→> <target terms> [hints]
verb      := test | validate | check | verify | run | try | prove
hints     := @<x.y.z> | v<x.y.z>        mapping version
           | in dev | in prod           environment (prod is always read-only)
           | round trip | one way       direction mode
```

- A side naming the hub language (the layout's `hubLanguage`) plus other words treats those
  words as **qualifiers** (`<hub> <output words>`, `<hub> (<producer>)`, `<target> <output words>`):
  they select which hub slice or which output feeds the projection.
  `(<a>/<b>)` lists alternatives; each word is a qualifier.
- Two non-hub languages on one side is `AMBIGUOUS`.
- Words that are not registered languages remain terms; they are never mapped
  to a language by prose similarity. Close spellings are offered as candidates
  only.

## Registry sources

Resolve against pinned, immutable inputs. Record each in the discovery trace. Paths and
parameter names below are keys of `registry-layout.json`; pass `--layout` for another registry.

| Source | What it proves | How to materialize read-only |
| --- | --- | --- |
| Registry candidate checkout at a pinned SHA | language definitions (`languageDefinitionPath`), registry keys (`languageRegistry`), declared language parameters (`languageParameters.declaredIn`), checked-in registrations (`registrationGlob`) | isolated checkout at the selected SHA |
| Registry `main` checkout at a pinned SHA | current active concepts (`conceptModelPath`); retired mapping ids (`retiredMappingIds`) | isolated checkout at the resolved `main` SHA |
| Published registry per environment | exact deployed `transform-mappings/<id>/<version>/mapping.json`, including generator-only mappings | `aws ssm get-parameter --name <publishedRegistry.uriParameter>`, then a filtered `aws s3 sync` of `*/mapping.json` and `*/queries/*` |
| Published parameter names per environment | which languages each environment actually publishes | `aws ssm get-parameters-by-path --path <publishedRegistry.parameterPath>` |

All AWS reads use an operator-selected profile in the layout's default region (or `--region`).
They are control-plane or object reads; PROD reads never change state.

Generated mappings exist only in the published registry or a materialized build. Never infer
them from prose. When checked-in registrations and a published registry disagree for the same
`id@version`, report `RegistrySourceDrift`: the deployed artifact is not the pinned candidate.

## Language states

| State | Meaning |
| --- | --- |
| `DEFINED` | registered and its definition file (`languageDefinitionPath`) declares datasets |
| `REGISTERED_WITHOUT_DEFINITION` | registry key or SSM name exists but no definition file declares datasets |
| `MAPPING_ENDPOINT_ONLY` | only appears as a mapping `from`/`to`; Lexicon does not govern its schema |
| `UNKNOWN` | not registered and not a mapping endpoint |

Any non-`DEFINED` endpoint produces `LanguageDefinitionMissing`. Parity for
that side cannot be derived from Lexicon (see `execution-and-parity.md`).

## Mapping selection

1. List `ENABLED` mappings with `from == source` and `to == target`.
2. One candidate: `RESOLVED`.
3. Several versions: a version hint selects exactly one. Otherwise a qualifier
   selects a version only through a **hard chain signal** on that version's
   *discriminating* inputs, which are the inputs not shared by every competing
   version:
   - `chain-producer`: `<qualifier>-to-<hub>` outputs overlap them;
   - `chain-sibling`: `<hub>-to-<qualifier>` inputs overlap them;
   - `output-dataset`: a run of qualifier words joined with `_` (a trailing
     plural `s` is also tried) equals one of that version's discriminating
     outputs, for example `ledger summaries` -> `ledger_summary`.
   A dataset-name substring match is a soft signal and never selects alone.
   A single enabled candidate resolves on its own; qualifiers then only steer
   the continuation (see below).
4. Zero or several hard matches: `AMBIGUOUS`; list every version with its
   outputs and the qualifiers it serves.
5. No direct mapping: `NO_MAPPING`. Rank candidates by inverse direction,
   producers of the inverse mapping's inputs, dataset mentions, same source or
   target, profile aliases, and retired ids. Do not select one.

Two kinds of mapping are listed but never offered in `mapping-choice` and never
selected:

- **Retired**: ids in the registry's retired list (`retiredMappingIds`), and
  exact `id@version` keys in the shared `forbidden-concepts.json`
  `retiredMappings`. A retired key still present in a registry is filtered out
  of selection and reported as `RetiredMappingInRegistry`.
- **Planned**: a profile direction with `status: not-registered` for the same
  language pair whose `id@version` no inspected registry holds. It appears with
  `status: PLANNED`, and its matching outputs are listed as reasons. It is
  reported as `PlannedMappingNotRegistered`, with `matchesRequest` set when the
  qualifiers name its outputs. When it is registered on a candidate branch,
  pass that checkout as `--lexicon-root` or its `cdk synth` output as
  `--registry`.

### Cumulative versions

When several enabled versions of one mapping id match a request and no version is requested,
the resolver selects the highest version if its outputs include every other matching version's
outputs (`selectionRule: cumulative-superset`), for example a `2.0.0` that still carries every
`1.0.0` output. `@<version>` still pins an older version. Versions whose outputs are not a subset
keep the request ambiguous.

## Workflow derivation

- `X -> <hub>` with an inverse `<hub> -> X`: forward, then inverse
  (default round-trip). With several inverse versions, the one whose outputs
  the qualifiers name is chosen, otherwise the highest version. If the
  qualifiers name only a planned inverse, the workflow stops after the forward
  step instead of substituting another version. Any `<hub> -> Y` whose
  inputs consume forward outputs is offered as an optional cross-source step.
- `<hub> -> Y` qualified by `Q` with exactly one `Q -> <hub>` producer:
  producer, then projection (default one-way). The producer's inverse is
  offered as an optional round trip.
- `<hub> -> Y` with no unique producer: `UpstreamSourceUnresolved`; ask for
  the upstream mapping or an existing immutable graph export.

Each later step binds only to the preceding step's committed physical output.

## Profile matching

A profile is selected when its directions declare the exact `id@version` of
**every** resolved workflow step, and exactly one profile does. `id` comes from
`mapping.id` or `mapping.expectedId`. `version` comes from `mapping.version` or
the planned `logicalArtifactPath`. A profile that reuses a large shared mapping
as its first step therefore does not capture unrelated round trips through that mapping. Aliases in
`terminologyAliases` only rank candidates.

The selected profile then shapes the plan. Its `validationWorkflow` appears as
`profileWorkflow`, and its first step becomes the `upstream-source` default. A
fixed `persistPolicy` removes the Persist question. For a direction declared
with `outputDatasetMatch: includes`, concept checks cover only the declared
outputs; the rest are recorded as `NOT_SELECTED`, because the run selects them
through the request's `outputDatasets`. The candidate `lexicon.json` is
compared with `main` (`lexiconModel`) on every run. Under
`lexiconModelPolicy.candidateLexiconDiff: forbidden`, a difference is reported
as `LexiconModelDiffersFromMain`, and a missing `main` checkout as
`LexiconModelUnchecked`. When the profile lists `approvedAdditions`
(`concept`, `property`, `approval`), the resolver removes exactly those
properties from the candidate and compares the rest with `main` as canonical
JSON, index definitions included. An exact match is reported as
`LexiconModelApprovedAdditions`; any other difference, including a stale
branch that lacks newer `main` concepts, stays `LexiconModelDiffersFromMain`.

After matching, compare the profile against the registry:

- `ProfileRegistrationStatusDrift`: the profile says `not-registered`, but an
  environment registry has the mapping `ENABLED`. Record which environments.
- `ProfileOutputDatasetDrift`: the profile's expected output datasets differ
  from the registered outputs (`exact`), or are not all registered
  (`includes`).
- `ProfileOutputInputDrift`: an `outputContracts` entry's `requiredInputs`
  differ from the registered output's `requiredInputs`.
- `OutputFormatDrift`: the registered `output.format`, `options.delimiter`
  (Transform default `,`), or `options.header` (default `false`) differ from
  the contract's `format`.

Drift is a finding for the profile owner. Silvally does not edit the profile,
mapping, or language during a run.

## Resolver

`scripts/resolve-transform-intent.py` implements this reference with the Python
standard library only. With `--workspace` it fetches what is not supplied,
read-only: registry candidate (`--candidate-pr` or `--candidate-ref`) and main
(`--main-ref`, default branch) checkouts pinned by SHA through `gh`/`git`, and for
each `--aws label=<profile>` the published registry and language parameter names
(see `fetch_validation_inputs.py`). The workspace's `inputs-manifest.json` records
every SHA, registry digest and `VersionId`. Generated mappings have no checked-in
registration; add `--materialize-candidate` to build them in the fetched checkout with the
layout's `materialize` commands and load them as registry `candidate-build`. A published
registry that lacks the candidate version (pruned by another deploy) is then visible as a
digest difference instead of an absent mapping.

```bash
python3 skills/validate-transform-configuration/scripts/resolve-transform-intent.py discover \
  --request "test <source> to <target> <output words>" \
  --workspace "$WS" --candidate-pr <registry-pr> --materialize-candidate --aws dev=<dev-profile> \
  --profiles <profile-dir> --out "$WS/intent.json"
```

Equivalent with inputs you already materialized:

```bash
python3 skills/validate-transform-configuration/scripts/resolve-transform-intent.py discover \
  --request "test <hub> (<producer>) to <target>" \
  --lexicon-root "$CANDIDATE" --main-lexicon-root "$MAIN" \
  --registry dev="$REGISTRY_DEV" --registry prod="$REGISTRY_PROD" \
  --ssm-parameters dev="$SSM_DEV" --ssm-parameters prod="$SSM_PROD" \
  --profiles <profile-dir> --window <startZ>_<endExclusiveZ> --out "$WORK/intent.json"
```

Other commands share the same inputs:

- `contracts --mapping <id>@<version>`: per-output contracts derived from the registration and
  the target definition (required inputs, format, columns, key, graph binding, endpoints) plus
  derivation findings (`EndpointDatasetNotRequired`, `RequiredInputUndeclared`, `DatasetUndefined`);
- `draft-profile`: a draft conforming to `transform-configuration-profile-draft.schema.json`,
  with `derivedDirections` regenerated from the registry when the request resolves;
- `check-profile --profile <file>`: regenerate every registered direction of a profile and compare;
  only the `(dataset, field)` pairs in its `derivationOverrides` may differ, and an override that
  matches no difference is stale. Exit status 1 on undeclared or stale differences.

The `discover` output contains `status`, `intent`, `languages`, `selection`,
`lexiconModel`, `workflow`, `profileWorkflow`, `profileMatches`,
`selectedProfile`, `parityPolicy`, `partialInputPolicy`, `conceptChecks`,
`sqlScan`, `parityDerivation`, `datasetRecommendations`, `findings`, and
`questions`. `--forbidden-concepts` defaults to
`reference/forbidden-concepts.json`. Pass a full-history `main` clone so added concepts are
checked against `main` history. Pin the resolver's SHA-256 as
`intentResolution.resolverSha256` in the run package.

## Example resolutions

The synthetic registry in `fixtures/synthetic-registry/` (hub `canon`; languages `alpha`,
`omega`, `sigma`) produces these results; the contract tests assert them.

| Request | Status | Plan or candidates |
| --- | --- | --- |
| `test canon (alpha) to omega ledger summary` | `RESOLVED` | `alpha-to-canon@1.0.0` then `canon-to-omega@2.0.0` (`output-dataset` signal on the only version that outputs `ledger_summary`); fixture profile selected |
| `test canon to omega member report` | `RESOLVED` | `canon-to-omega@2.0.0` by `cumulative-superset`; `UpstreamSourceUnresolved` asks for the producer |
| `test canon to omega@1.0.0` | `RESOLVED` | the pinned older version |
| `test canon to omega` | `AMBIGUOUS` | both versions offered with their outputs |
| `test alpha to omega` | `NO_MAPPING` | ranked candidates; the retired `alpha-to-omega@0.9.0` is listed, never offered |
| `test alhpa to canon` | `UNKNOWN_LANGUAGE` | `spelling-close-to-alhpa` candidate `alpha` |
| `test canon to omega sigma` | `AMBIGUOUS` | two target languages on one side |
