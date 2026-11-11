# Governed ruleset rule changes

Use this reference when removing, renaming, loosening or re-thresholding a rule
that production Filter loads. Rule semantics are governed data: change them
through a reviewed, versioned source change and recertify behavior; never patch
a deployed artifact.

## Where rules live today

Model governs ruleset definitions and owns the `/lexicon/rulesets-uri` consumer
boundary. Until `prismteam-ai/model` publishes that boundary, production rulesets
are authored in the legacy implementation `Spring-Oaks-Capital-LLC/lexicon` under
`src/data/rulesets/`. Change rules there only to keep the current consumer
correct, and record each change as a Dialga migration item so Model's ruleset
catalog validation and governed publication can take it over. This is a
rule-specific interim boundary: it does not relax the
[metric catalog contract](business-financial-metric-catalogs.md), which forbids
authoring metric definitions in the legacy repository.

Follow the legacy repository's own `AGENTS.md` and
`.agents/skills/rule-validation/SKILL.md`; they win over this summary where they
are stricter.

## Resolve the rule before editing

1. Treat story wording as intent, not a locator. Stories often use the UI display
   label (for example "Daily Sms Limit 2 Per Day"). Find the rule `id`, then
   confirm its semantics from the rule JSON `description` and its `.gremlin`
   query before deciding it is the rule the story means.
2. Do not trust the ruleset a story names. A rule may live elsewhere; for
   example, a "multi-debt" block requested for an SMS ruleset lived in
   `number-risk-communication-controls` as `has_single_debt_for_person_owner`.
3. Find every reference before removing or renaming. One rule id can appear in
   several manifests (a `communication-compliance-baseline` rule can also be
   listed in `sms-interactions`). Search all of:

   ```bash
   git grep -n '<rule_id>' -- \
     'src/data/rulesets/**/ruleset.json' \
     src/data/rulesets/index.json \
     src/data/rule-query-artifacts.json \
     src/data/certifications/ \
     src/data/lexicon.json
   ```

   Include INACTIVE `-next` staging rulesets, `certifications/current.json` and
   `certifications/rules/<rule-slug>/`, and example text in `lexicon.json`.

## Remove a rule

1. Remove the entry from every manifest that lists it.
2. Delete the rule folder (`.json`, `.gremlin`, `.sql`).
3. Delete its `rule-query-artifacts.json` entry.
4. Remove its certification bundle and its `certifications/current.json` entry.
5. Bump the version of every changed ruleset in both its `ruleset.json` and
   `rulesets/index.json`.
6. Leave `order` gaps; do not renumber the remaining rules.

## Change a threshold or semantics

1. Create a new rule id and folder that names the new behavior (for example
   `daily_sms_limit` becomes `daily_sms_limit_5_per_day`). Never change the
   meaning behind an existing id.
2. Swap the manifest entries and the `rule-query-artifacts.json` entry to the new
   id, remove the old rule as above and bump ruleset versions.
3. Recertify through the legacy repository's `rule-validation` skill: varied,
   source-verified DEV data through Transform, Persist, direct graph readback
   and Filter, with strict per-debt agreement. Commit a certification bundle
   only after a publishable pass.

## Ship urgent loosening safely

Put removals in their own PR, separate from new or re-thresholded rules that need
certification, so the removals reach production first and do not wait on DEV
validation.

## Gates for every rule PR

Run these for every rule PR, including pure removals:

```bash
bun run test:run
npm run check:filter-compat -- --filter-dir <filter-checkout> \
  --context '<rule_context json>'   # repeat per production Filter run context
```

Run the compatibility check on `main` first as a control, then on the branch.
Pass `--context` for each production Filter run context that loads a changed
ruleset, using a Filter checkout at its deployed `main`. A missing Filter
checkout, environment, data or authorization makes that gate `BLOCKED`; never
report it as passed.

## Return

Report the resolved rule ids and their source rulesets, every reference changed,
version bumps, PR split, gate results (`PASSED`, `FAILED` or `BLOCKED`) and the
Model migration item each change creates.
