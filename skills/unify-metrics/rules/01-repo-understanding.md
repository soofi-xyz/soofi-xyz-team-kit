# Repository Understanding

Start every `metrics` workflow by rebuilding context from the repositories that own the work.

## Scope

Scan these repositories first:

- `skills`
- `lexicon`
- `livevox-metrics-pipeline`
- `main-dashboard`

Do not treat the older analysis-oriented `metrics-skill` contents as current design authority beyond the preserved principles in the replacement `SKILL.md`.

## Required Output

Produce a short repo summary that covers:

- tech stack
- ownership boundaries
- reusable files and constructs
- likely target repos for the requested change

Use `reference/repo-map.md` as the default ownership map.

## Reuse-First Rules

- Reuse an existing canonical metric name before inventing a new one.
- Reuse an existing pipeline lane before designing a new ingestion path.
- Reuse an existing widget factory or construct before adding widget infrastructure.
- Reuse repo-native validation commands and CI patterns before proposing new checks.

## Repo-Specific Expectations

### `skills`

- Keep `SKILL.md` concise.
- Split detail into `rules/` and `reference/` files.
- Keep file references one level deep from `SKILL.md`.

### `lexicon`

- Treat `cloudwatch-metrics.json` as the CloudWatch metric registry.
- Treat `lexicon.json` as the graph schema.
- Update nearby tests whenever definitions change.

### `livevox-metrics-pipeline`

- Treat `docs/metrics-inventory.md` and `app/services/livevox_dashboard_contract.py` as the semantic source for current pipeline metrics.
- Treat `scripts/check_lexicon_contract.py` as the naming gate.
- Prefer config-driven patterns under `app/config/metrics/`.

### `main-dashboard`

- Treat `lib/constructs/daily-value-widget-factory.ts` as the default path for single-value cards.
- Treat grouped constructs as templates for metric families.
- Treat `test/dashboard.test.ts` as a required update point when widget counts or section order change.

## Stop Conditions

Stop and ask before proceeding when:

- repo ownership is unclear
- the requested metric spans multiple repos but the expected deliverable is not stated
- existing patterns conflict with the requested behavior
- a repo lacks the source contract needed to support the requested metric
