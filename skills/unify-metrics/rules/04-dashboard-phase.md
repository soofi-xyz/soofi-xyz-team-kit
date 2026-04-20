# Dashboard Phase

Run this phase only after the lexicon name, unit, and pipeline semantics are stable.

## Core Rules

- Use confirmed lexicon metric names only.
- Reuse existing widget patterns before creating new infrastructure.
- Keep titles, labels, dimensions, and periods aligned with the pipeline contract.
- Stop and ask if the correct dashboard audience, section, or ownership boundary is unclear.

## Routing Rules

Choose the dashboard implementation path that matches the lane:

- source-owned business widgets: start from repo-owned widget specs such as `livevox-metrics-pipeline/dashboard/socapital-dashboard-widgets.json`
- shared CloudWatch cards: reuse `main-dashboard/lib/constructs/daily-value-widget-factory.ts`
- grouped metric families: reuse grouped constructs such as `livevox-call-metrics-widget.ts`, `livevox-agent-metrics-widget.ts`, or `livevox-service-efficiency-widget.ts`

Do not create a parallel widget pattern when one of these already fits.

## Naming And UX Rules

- Titles should default to concise and audience-friendly labels.
- If the repo convention or the user explicitly requests raw metric-name titles, use the exact confirmed `metricName` as the widget title.
- Descriptions should reflect business meaning, not implementation trivia.
- Dimensions should remain low-cardinality and operationally meaningful.
- Time windows and periods must match the metric lane semantics.
- Snapshot-card fallback behavior should match the lane semantics for missing observation days.

## Validation Rules

When touching `main-dashboard`:

- update the stack wiring if a construct must be mounted
- update tests in `test/dashboard.test.ts` when section order, card titles, snapshot fallback settings, or custom widget counts change
- use the repo validation commands before delivery

When touching source-owned widget JSON:

- keep `MetricName`, namespace, dimensions, labels, and units aligned with the pipeline contract
- update inventory docs if widget ownership or semantics change

## Stop Conditions

Stop and ask when:

- the correct dashboard section is unclear
- the requested dimensions are high-cardinality
- the requested visualization does not match the metric semantics
- the metric belongs in logs or reports rather than a dashboard card
- the source repo and shared dashboard repo disagree on ownership for the widget definition
