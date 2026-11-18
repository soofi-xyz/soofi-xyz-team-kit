# Living artifact prompt

Use this prompt to build a living context canvas for a story in progress.
Replace the placeholders in angle brackets. The prompt follows
[SKILL.md](../SKILL.md), [the problem drawing reference](problem-drawing.md)
and [the implementation status reference](implementation-status.md).

```text
Build a living context canvas for <story link>, used by <people> in standups and status meetings. Title it with the story's exact title. Top to bottom:
1. Goal in one line, story link, due date.
2. A 'Now' callout: the current state in 2-3 sentences, timestamped in <primary zone> with <reader zone> in parentheses.
3. Today at a glance: a horizontal timeline of today's milestones, done filled, now in the accent colour, next hollow.
4. The problem: a swimlane drawing under the minimal sequence of real events that reproduces the bug. Lanes: source of truth, what the system records today, the outcome today (wrong part in red, labelled), then the records and outcome after the fix. Legend, and a 2-3 sentence caption naming the root cause.
5. How the fix works: one drawing per mechanism (for example a backfill), with lanes per case showing which record wins and why.
6. Where it lives: the components in flow order as a wrapping grid; for each, the store type, a one-line role, and the linked pull request that changes it.
7. Path to done: columns left to right, boxes in one column run in parallel, each with a status dot; a collapsed table proving each dependency.
8. While something long runs: a run panel with id, start, phase progress, before-numbers and the checks to run after.
9. Meeting agenda, pull requests (every one linked), decisions with owners, and a done-when callout.
10. Collapsed: evidence as labelled numbers with sources, and outside-scope findings with priority, owner and next step.
Rules: link every pull request and issue; use people's names, never 'you'; verify every owner, approver, decision and number against a source; flat design, theme colours, full width, no overlapping labels; update the canvas at every milestone; prune stale or pedantic rows, but list deletions and ask before removing content the owner may still want.
```
