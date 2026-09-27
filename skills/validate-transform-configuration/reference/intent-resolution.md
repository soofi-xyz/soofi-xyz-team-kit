# Short-request intent resolution

Silvally accepts requests as short as `test decision to lexicon`,
`test sms to lexicon`, or `test lexicon decision to interprose`. This reference
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

- A side naming the hub `lexicon` plus another word treats that word as a
  **qualifier** (`lexicon decision`, `lexicon (sms)`): it selects which Lexicon
  slice feeds the projection. `(sms/decision/anything)` lists alternatives; each
  word is a qualifier.
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
   - `chain-sibling`: `lexicon-to-<qualifier>` inputs overlap them.
   A dataset-name token match is a soft signal and never selects alone.
4. Zero or several hard matches: `AMBIGUOUS`; list every version with its
   outputs and the qualifiers it serves.
5. No direct mapping: `NO_MAPPING`. Rank candidates by inverse direction,
   producers of the inverse mapping's inputs, dataset mentions, same source or
   target, profile aliases, and retired ids. Do not select one.

## Workflow derivation

- `X -> lexicon` with an inverse `lexicon -> X`: forward, then inverse
  (default round-trip). Any `lexicon -> Y` whose inputs consume forward
  outputs is offered as an optional cross-source step.
- `lexicon -> Y` qualified by `Q` with exactly one `Q -> lexicon` producer:
  producer, then projection (default one-way). The producer's inverse is
  offered as an optional round trip.
- `lexicon -> Y` with no unique producer: `UpstreamSourceUnresolved`; ask for
  the upstream mapping or an existing immutable graph export.

Each later step binds only to the preceding step's committed physical output.

## Profile matching

A profile matches when one of its directions declares the exact registered
`id@version` of the first workflow step. `id` comes from `mapping.id` or
`mapping.expectedId`. `version` comes from `mapping.version` or the planned
`logicalArtifactPath`. Aliases in `terminologyAliases` only rank candidates.

After matching, compare the profile against the registry:

- `ProfileRegistrationStatusDrift`: the profile says `not-registered`, but an
  environment registry has the mapping `ENABLED`. Record which environments.
- `ProfileOutputDatasetDrift`: the profile's expected output datasets differ
  from the registered outputs.

Drift is a finding for the profile owner. Silvally does not edit the profile,
mapping, or language during a run.

## Resolver

`scripts/resolve-transform-intent.py` implements this reference with the Python
standard library only.

```bash
python3 skills/validate-transform-configuration/scripts/resolve-transform-intent.py discover \
  --request "test lexicon decision to interprose" \
  --lexicon-root "$LEXICON_CANDIDATE" --main-lexicon-root "$LEXICON_MAIN" \
  --registry dev="$REGISTRY_DEV" --registry prod="$REGISTRY_PROD" \
  --ssm-parameters dev="$SSM_DEV" --ssm-parameters prod="$SSM_PROD" \
  --window 2026-09-26T000000Z_2026-09-27T000000Z --out "$WORK/intent.json"
```

`draft-profile` emits a draft conforming to
`transform-configuration-profile-draft.schema.json` when no profile matches.
The output contains `status`, `intent`, `languages`, `selection`, `workflow`,
`profileMatches`, `selectedProfile`, `parityPolicy`, `conceptChecks`,
`sqlScan`, `parityDerivation`, `datasetRecommendations`, `findings`, and
`questions`. Pass a full-history `main` clone (a worktree of a non-shallow
clone works) so added concepts are checked against `main` history.
Pin the resolver's SHA-256 as `intentResolution.resolverSha256` in the run
package.

## Example resolutions

Observed on 2026-09-27 against Lexicon PR #796 head
`f259b25f4be0a1f2b13699632ce385e001cc5284`, Lexicon `main`
`6f7a2ebf0877d9a25adf473577e5a711a1262f7b`, and the DEV/PROD registries, and
re-observed with the same plans against head
`6955717b16b65285f7c5efa7569f6a3548940b1a` and the DEV registry.

| Request | Status | Plan or candidates |
| --- | --- | --- |
| `test decision to lexicon` | `RESOLVED` | `decision-to-lexicon@1.0.0` then `lexicon-to-decision@1.0.0`; optional `lexicon-to-interprose@3.0.0` |
| `test lexicon decision to interprose` | `RESOLVED` | `decision-to-lexicon@1.0.0` then `lexicon-to-interprose@3.0.0` (chain-producer on `company_represents_debt`) |
| `test lexicon (sms) to interprose` | `RESOLVED` | `lexicon-to-interprose@2.0.0` (chain-sibling through `lexicon-to-sms@1.0.0`); upstream source must be chosen |
| `test lexicon to interprose` | `AMBIGUOUS` | versions `1.0.0` (email), `2.0.0` (sms/quiq), `3.0.0` (decision) |
| `test sms to lexicon` | `NO_MAPPING` | `sms` is `MAPPING_ENDPOINT_ONLY`; candidates `lexicon-to-sms@1.0.0`, `quiq-to-lexicon@1.0.0`, `lexicon-to-interprose@2.0.0`; `sms-to-interprose` is retired |
