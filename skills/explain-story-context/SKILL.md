---
name: explain-story-context
description: "Produce a standalone context artifact (canvas, or Markdown when no canvas is available) for a story, task, or change: business context first, then why each involved component exists and how it serves the business, then the problem drawn as a timeline, the fix, the done signal, and the repositories involved. Depth scales with the size and impact of the change. Once work starts, keep the artifact current as the story's status page. Use when asked for an understanding doc, story context, an explanation of why a change matters, to make the problem statement visual, for a status canvas for a meeting, or to keep the story artifact updated during implementation."
---

# Explain Story Context

Give the reader the smallest accurate mental model that makes a story, task,
or change make sense. The reader needs to act on the work, not to learn the
whole system.

## Output

Produce one standalone artifact:

- a canvas when the environment supports canvases
- otherwise a single Markdown document

Keep implementation steps out of the core; link to the pull request or plan
instead. Once implementation starts, add the
[implementation status layer](#implementation-status-layer) below the core and
keep it current, so the same artifact serves as the story's status page.

## Size to the change

Match depth to the change and its consequences, not to how much is known.

- **Small, low-risk change** (a constant, a flag, a copy edit): readable in
  about two minutes on one screen. The chain diagram and one before/after visual
  should make the change self-evident before any prose is read.
- **Larger change, or one with material consequences** (money movement,
  compliance, customer impact, irreversible operations, other teams affected):
  keep the same short core, then add the supporting detail below it.

In either case, put the core first and collapse supporting detail (evidence,
totals, edge cases, glossary) so the reader can stop after the core.

## Core, in order

Open with the business, not with an internal component name.

1. **Context.** What the business does and what outcome matters, in at most
   two sentences.
2. **Constraint.** The limited resource or rule that makes the system necessary,
   in one or two sentences.
3. **Chain.** The components involved, in flow order. For each one, give its
   name, what it does (about 12 words) and why it exists, meaning how it serves
   the business (about 10 words). Highlight the component the work changes.
4. **Concept.** The single idea the work depends on. Where it helps, show what
   happens on either side of it (for example: too small, matched, too large).
5. **Problem and fix.** State the problem in business terms first, then name
   the setting or value that changes. Draw the problem instead of describing it
   in prose (see [Problem drawing](#problem-drawing)).
6. **Done signal.** The observable evidence that the change worked.
7. **Repositories.** Link every repository involved, in two groups:
   - **Directly involved:** repositories the work changes or must inspect.
     These are the ones to attach to the workspace or agent.
   - **Context:** repositories behind the other components in the chain,
     linked for reference. They do not need to be inspected.

   Mark any repository name that could not be confirmed.

## Supporting detail, when warranted

- **Evidence.** A few labeled numbers with their source.
- **Unchanged.** What explicitly does not change, so the reader does not
  over-read the work.
- **Terms.** Only terms the reader will meet next, one line each.

## Problem drawing

Draw the problem as a swimlane timeline, not as prose. The reader should see
what goes wrong, and what the fix changes, before reading any text. Follow
[the problem drawing reference](reference/problem-drawing.md) for lane
contents, a backfill example and a Markdown fallback.

- **Events.** Align the lanes under the minimal sequence of real-world events
  that reproduces the bug. Verify that the sequence is minimal and still
  reproduces the bug: if an existing workaround corrects the outcome after one
  cycle, show two cycles.
- **Lanes, top to bottom.** The source of truth (what really happened); what
  the system records today; the outcome derived today; a divider; what the
  system records after the fix; the outcome derived after the fix.
- **Wrong outcome.** Mark the wrong part of today's outcome in red (the theme's
  error color) with a label of two to four words, such as "called while
  represented".
- **Legend and caption.** Add a legend. Add a caption of two or three sentences
  that states the root cause in one sentence.
- **One drawing per mechanism.** Give each mechanism its own drawing. For
  example, show how a data backfill or migration repairs existing records in a
  separate drawing, with one lane per case showing which record wins and why.
- **Named examples.** Attach a named real example (an identifier, a customer
  case) to a drawing only after verifying that it follows exactly that
  pattern. Otherwise list it separately as a related case.

## Implementation status layer

The core stays free of implementation steps. Add this optional layer once work
starts and keep it current, so the artifact can serve standups and status
meetings. Place it after the core drawings, in this order:

1. **Now.** The current state in two or three sentences, timestamped.
2. **Today at a glance.** For status meetings, a horizontal timeline of the
   day's milestones: done (filled), now (accent color), next (hollow), each
   with a time and a two-line label. Draw the axis solid up to now and dashed
   after it.
3. **Path to done.** Columns from left to right; boxes in one column run in
   parallel; each box has a status dot. Below it, a collapsed "Why these run in
   parallel or in order" table with proof for each dependency.
4. **Live run.** While something long runs: the run identifier, start time,
   phase-by-phase progress, the before-numbers, and the checks that will run
   after it.
5. **Meeting agenda.** Each topic and what to settle.
6. **Pull requests.** A table of every pull request, each linked.
7. **Decisions.** Topic, decision and owner.
8. **Done when.** A callout with the conditions that close the story.
9. **Collapsed detail.** Evidence, and outside-scope findings with priority,
   finding, owner and next step.

When the artifact mainly serves status meetings, pin Now and Today at a glance
directly under the title. Follow
[the implementation status reference](reference/implementation-status.md) for
the contents of each panel. Use
[the living artifact prompt](reference/living-artifact-prompt.md) to build the
whole artifact in one request.

Keep the layer current:

- Update the artifact at every milestone, not at the end: a decision made, a
  validation passed or gone stale, a pull request opened, approved or merged,
  a run started or finished.
- Link every pull request and issue, including inside tables.
- Use people's names. Never address the reader as "you".
- Verify every claim about owners, approvers, decisions and numbers against a
  source before writing it. Do not infer an owner or approver from an
  ambiguous reply.
- State times in the team's primary time zone, with the reader's local zone in
  parentheses.
- Prune stale or pedantic content: passed checklists, superseded options,
  proofs once the decision is made, and rows nobody acts on. When the owner
  asks which parts are verbose, list the candidates and wait for confirmation
  before deleting.
- Keep a single coordination owner when several agents or threads work on the
  same story. Do not let two threads edit the same pull request description.

## Wording

- Use neutral, professional, technical language suitable for any organization
  that uses this kit. Avoid slang, humor, and loaded or judgmental terms.
- Describe people and business processes factually. Prefer the organization's
  canonical terms, such as those in a repository's `CONTEXT.md` or glossary.
- Define a term the first time it appears.
- Cut any sentence that does not change what the reader understands or does.
- Prefer one concrete number to an adjective.
- Mark inferred facts as inferred, and cite the source for business facts.
- Verify changing facts (capacities, flags, defaults) against current code
  before including them.

## Visuals

- A chain diagram with the changed component highlighted.
- A before/after chart for the value that changes.
- The problem as a swimlane timeline, one drawing per mechanism.
- Evidence as a few labeled numbers.
- A supply, demand or risk check when the fix depends on one.
- Once work starts, Today at a glance and the path-to-done drawing.

Label every chart with the metric, units and source. Use no decoration that
carries no information.

### Canvas layout

- Use the full width of the canvas.
- Lay out groups of boxes as wrapping grids, for example CSS grid with
  `repeat(auto-fit, minmax(190px, 1fr))`. A single row of many narrow boxes
  crowds and overlaps.
- Let long tokens (identifiers, paths, links) wrap, for example with
  `overflow-wrap: anywhere`.
- Check every SVG label for overlap with other labels, marks and lines.
- Use flat design and the theme's colors only.

## Sources

Build context from current sources, in this order:

1. The story or task itself, including its evidence and acceptance criteria.
2. The target repository's architecture or overview docs, glossary
   (`CONTEXT.md` or equivalent), and accepted ADRs.
3. Executable code and tests, for any value the artifact states.
4. For products in this kit, `skills/guide-product-work/reference/product-catalog.json`
   for product ownership and boundaries.

## Example core

For a story that raises a call scheduler's capacity for two peak hours:

- Context: what the organization does and why agents place calls.
- Constraint: agents can place a limited number of calls per hour, and
  regulations limit how often and when a consumer may be contacted.
- Chain: data store (history) → eligibility filter (who may be contacted) →
  scheduler (who to call and in which hour, up to each hour's capacity;
  changed) → integration (uploads lists) → dialer → agents.
- Concept: each hour's list should match what agents can dial in that hour.
- Problem and fix: the peak-hour lists run out and the dialer falls back to a
  backup list. Raise those two hours' capacity.
- Done signal: the next run summary shows the new capacity for those hours.
- Repositories: the scheduler repository (directly involved); the filter,
  integration and orchestration repositories and the shared CI workflows
  (context).
