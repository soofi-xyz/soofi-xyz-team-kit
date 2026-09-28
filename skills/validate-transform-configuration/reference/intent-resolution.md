# Short-request intent resolution

Silvally accepts requests as short as `test lexicon to interprose form 1281`,
`test lexicon payment plan to interprose`, or `test sms to lexicon`. This reference
defines how such a request becomes an exact `(source language, target language,
direction, mapping id@version)` plan. It is read-only discovery; no step here
writes outside a disposable local directory.

## Grammar

```text
[/silvally] <verb> <source terms> [(<qualifiers>)] <to|into|->|=>|→> <target terms> [hints]
verb      := test | validate | check | verify | run | try | prove
hints     := @<x.y.z> | v<x.y.z>        mapping version
           | in dev | in prod           environment (prod is always read-only)
           | round trip | one way       direction mode
```

- A side naming the hub `lexicon` plus other words treats those words as
  **qualifiers** (`lexicon payment plan`, `lexicon (sms)`, `interprose form 1281`):
  they select which Lexicon slice or which output feeds the projection.
  `(sms/payment/anything)` lists alternatives; each word is a qualifier.
- Two non-hub languages on one side is `AMBIGUOUS`.
- Words that are not registered languages remain terms; they are never mapped
  to a language by prose similarity. Close spellings are offered as candidates
  only.

## Registry sources

Resolve against pinned, immutable inputs. Record each in the discovery trace.

| Source | What it proves | How to materialize read-only |
| --- | --- | --- |
| Lexicon candidate checkout at a pinned SHA | language definitions `src/data/<language>.json`, registry keys in `src/data/lexicons.ts`, SSM names declared in `infra/lib/lexicon-stack.ts`, checked-in `src/transform/mappings/**/registration.json` | isolated `git worktree` at the selected SHA |
| Lexicon `main` checkout at a pinned SHA | current active concepts in `src/data/lexicon.json`; retired mapping ids in `infra/test/transform-mappings.spec.ts` | isolated `git worktree` at the resolved `main` SHA |
| Published registry per environment | exact deployed `transform-mappings/<id>/<version>/mapping.json`, including generator-only mappings | `aws ssm get-parameter --name /lexicon/transform-mappings-uri`, then `aws s3 cp --recursive --exclude '*' --include '*/mapping.json'` to a local temp directory |
| Published SSM names per environment | which languages each environment actually publishes | `aws ssm get-parameters-by-path --path /lexicon --query 'Parameters[].Name'` |

All AWS reads target `us-east-2` with an operator-selected profile. They are
control-plane or object reads; PROD reads never change state.

Mappings produced by `infra/lib/transform-mapping-artifacts.ts` exist only in
the published registry or a `cdk synth` output. Never infer them from prose.
When checked-in registrations and a published registry disagree for the same
`id@version`, report `RegistrySourceDrift`: the deployed artifact is not the
pinned candidate.

## Language states

| State | Meaning |
| --- | --- |
| `DEFINED` | registered and `src/data/<language>.json` declares datasets |
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
   - `chain-producer`: `<qualifier>-to-lexicon` outputs overlap them;
   - `chain-sibling`: `lexicon-to-<qualifier>` inputs overlap them;
   - `output-dataset`: a run of qualifier words joined with `_` (a trailing
     plural `s` is also tried) equals one of that version's discriminating
     outputs, for example `form 1281` -> `form_1281` or `payment plans` ->
     `payment_plan`.
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

- **Retired**: ids in Lexicon's `transform-mappings.spec.ts` retired list, and
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

## Workflow derivation

- `X -> lexicon` with an inverse `lexicon -> X`: forward, then inverse
  (default round-trip). With several inverse versions, the one whose outputs
  the qualifiers name is chosen, otherwise the highest version. If the
  qualifiers name only a planned inverse, the workflow stops after the forward
  step instead of substituting another version. Any `lexicon -> Y` whose
  inputs consume forward outputs is offered as an optional cross-source step.
- `lexicon -> Y` qualified by `Q` with exactly one `Q -> lexicon` producer:
  producer, then projection (default one-way). The producer's inverse is
  offered as an optional round trip.
- `lexicon -> Y` with no unique producer: `UpstreamSourceUnresolved`; ask for
  the upstream mapping or an existing immutable graph export.

Each later step binds only to the preceding step's committed physical output.

## Profile matching

A profile is selected when its directions declare the exact `id@version` of
**every** resolved workflow step, and exactly one profile does. `id` comes from
`mapping.id` or `mapping.expectedId`. `version` comes from `mapping.version` or
the planned `logicalArtifactPath`. A profile that reuses a large shared mapping
(such as `interprose-to-lexicon@1.0.0`) as its first step therefore does not
capture unrelated round trips through that mapping. Aliases in
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
`LexiconModelUnchecked`.

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
standard library only.

```bash
python3 skills/validate-transform-configuration/scripts/resolve-transform-intent.py discover \
  --request "test lexicon to interprose form 1281" \
  --lexicon-root "$LEXICON_CANDIDATE" --main-lexicon-root "$LEXICON_MAIN" \
  --registry dev="$REGISTRY_DEV" --registry prod="$REGISTRY_PROD" \
  --ssm-parameters dev="$SSM_DEV" --ssm-parameters prod="$SSM_PROD" \
  --window 2026-09-26T000000Z_2026-09-27T000000Z --out "$WORK/intent.json"
```

`draft-profile` emits a draft conforming to
`transform-configuration-profile-draft.schema.json` when no profile matches.
The output contains `status`, `intent`, `languages`, `selection`,
`lexiconModel`, `workflow`, `profileWorkflow`, `profileMatches`,
`selectedProfile`, `parityPolicy`, `partialInputPolicy`, `conceptChecks`,
`sqlScan`, `parityDerivation`, `datasetRecommendations`, `findings`, and
`questions`. `--forbidden-concepts` defaults to
`reference/forbidden-concepts.json`. Pass a full-history `main` clone (a worktree of a non-shallow
clone works) so added concepts are checked against `main` history.
Pin the resolver's SHA-256 as `intentResolution.resolverSha256` in the run
package.

## Example resolutions

Observed on 2026-09-28, read-only, against Lexicon `main`
`6f7a2ebf0877d9a25adf473577e5a711a1262f7b` (full-history clone, used as both
candidate and `main`), the DEV registry from `/lexicon/transform-mappings-uri`
in `us-east-2` (five packages: `interprose-to-lexicon@1.0.0`,
`lexicon-to-interprose@1.0.0` and `@2.0.0`, `lexicon-to-sms@1.0.0`,
`quiq-to-lexicon@1.0.0`), and DEV `/lexicon/*` names. `lexicon-to-interprose@4.0.0`
is not registered anywhere yet. The PROD registry was not read.

| Request | Status | Plan or candidates |
| --- | --- | --- |
| `test lexicon to interprose form 1281` | `AMBIGUOUS` | `1.0.0`, `2.0.0`, and `lexicon-to-interprose@4.0.0` `PLANNED` (`output-dataset-form_1281`, profile `lexicon-interprose-v4.json`); `PlannedMappingNotRegistered` |
| `test lexicon payment plan to interprose` | `AMBIGUOUS` | same, with `output-dataset-payment_plan` |
| `test lexicon to interprose` | `AMBIGUOUS` | `1.0.0` (email), `2.0.0` (sms/quiq); `4.0.0` listed as planned |
| `test interprose to lexicon round trip form 1281` | `RESOLVED` | `interprose-to-lexicon@1.0.0` only (the named inverse is planned); profile `lexicon-interprose-v4.json`; all 12 v4 graph inputs `ACTIVE_ON_MAIN`, other outputs `NOT_SELECTED` |
| `test lexicon (sms) to interprose` | `RESOLVED` | `lexicon-to-interprose@2.0.0` (chain-sibling through `lexicon-to-sms@1.0.0`); upstream source must be chosen |
| `test decision to lexicon` | `UNKNOWN_LANGUAGE` | `decision` is no longer published; `decision-to-lexicon@1.0.0` and `lexicon-to-decision@1.0.0` are listed as `retired-in-kit` and not offered |
| `test sms to lexicon` | `NO_MAPPING` | `sms` is `MAPPING_ENDPOINT_ONLY`; candidates `lexicon-to-sms@1.0.0`, `quiq-to-lexicon@1.0.0`, `lexicon-to-interprose@2.0.0`; `sms-to-interprose` is retired |

Observed again on 2026-09-28 after Lexicon PR #811 deployed to DEV: with the
PR head as candidate and the DEV registry holding `lexicon-to-interprose@4.0.0`,
`test lexicon to interprose form 1281` and `test lexicon payment plan to
interprose` both return `RESOLVED` with `lexicon-to-interprose@4.0.0`, an
`output-dataset` signal, and profile `lexicon-interprose-v4.json`. The contract
tests assert this, and keep the planned-profile behavior above as a regression.
