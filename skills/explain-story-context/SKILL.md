---
name: explain-story-context
description: "Produce one standalone context artifact (canvas, or Markdown when no canvas is available) for a story, task, or change, and keep it current: business context first, then why each involved component exists and how it serves the business, the problem and fix, each requirement traced to the story's own words, the done signal, only what is genuinely still open, and the repositories involved. Depth scales with the size and impact of the change. Use when asked for an understanding doc, story context, a handoff for a story, or an explanation of why a change matters."
---

# Explain Story Context

Give the reader the smallest accurate mental model that makes a story, task,
or change make sense. The reader needs to act on the work, not to learn the
whole system. Give full context on what the story asks and why, show which
parts the story settles and which you inferred, and leave out everything else.

## Output

Produce one standalone artifact per story:

- a canvas when the environment supports canvases
- otherwise a single Markdown document

When an artifact for the story already exists and you can reach it, update it
in place. Treat a request for a handoff, summary, or brief of the story for
another thread as a request to update this artifact: give its link, and put any
short prompt in the chat, not in a second artifact.

Keep implementation out of the artifact: no steps, task lists, design notes,
file paths, query or code shapes, or suggested prompts. Name a code identifier
(a flag, setting, or constant) only when the story names it or a requirement
depends on it. Link to the pull request or plan instead.

Do not rewrite the story or break it into tasks; use `groom-stories` for that.

## Read the story first

Before you list anything as open, unknown, or recommended, read the story's
full text: context, asks, tables, acceptance criteria, notes, and any
"Assuming …" sentences. Classify every question you would raise as exactly one
kind:

| Kind | Test | What to do |
|---|---|---|
| Settled | The story answers it in words. | Use the answer where it belongs and quote the story in the requirements trace. Never list it as open. |
| Implied | The story's words imply the answer. | Same as settled; quote the words, state the inference in one clause, and mark it implied. |
| Fact to check | The answer is a fact about code, configuration, data, or usage, not a choice. | Check it yourself when you can and state the result. Otherwise list it under Open items with how to check it and what changes with each answer. |
| Open decision | The story is silent or contradicts itself, the answer is a choice, and it changes what the reader builds, tests, or ships. | List it under Open items with who decides and why the story does not settle it. |

Apply these readings:

- Treat hedges such as "proposed", "for the team to review and confirm", or
  "open to feedback" as the author's position, open to review. When the reader
  belongs to the team asked to review, the review is part of the reader's work,
  not a wait on someone else. Present the content as the story's, not as
  unconfirmed.
- Treat the author's "please verify" or "for reference" findings as facts to
  check, not as requirements or decisions.
- Treat a catch-all row or clause (for example "anything not listed: no
  action") as settling every case it covers, including cases the story does not
  name.
- Treat a declared dependency as settled. After checking how the parts connect,
  state what it blocks: the change itself, only its measurement, or only its
  rollout.
- Classify a question the story addresses to someone by the table above, as a
  fact to check or an open decision, and name who can answer it.
- Treat a source you could not read as a reason to check a fact, not as a
  reason to open a decision.

Only open decisions may appear as decisions, and only when they change what the
reader does.

## Check your own recommendations

Explain the story; do not redesign it. Before including any recommendation,
interpretation, or edge case of your own, compare it with the story's explicit
text:

- If the story already says it, cite the story instead of presenting it as
  yours.
- If it goes beyond the story, mark it as inferred and keep it only when it
  changes what the reader does.
- If it contradicts the story, say so plainly: quote the story, state the
  difference and the reason, and name who would decide. Never present it as the
  story's position, and never apply it silently.

## Size to the change

Match depth to the change and its consequences, not to how much is known.

- **Small, low-risk change** (a constant, a flag, a copy edit): readable in
  about two minutes on one screen. The chain diagram and one before/after visual
  should make the change self-evident before any prose is read. The
  requirements trace may be a single row, and Open items a single line.
- **Larger change, or one with material consequences** (money movement,
  compliance, customer impact, irreversible operations, other teams affected):
  keep the same short core, then add only the supporting sections listed below.

Put the core first and collapse supporting detail so the reader can stop after
the core. Collapsing does not exempt content from the Cut rules.

## Core, in order

Open with the business, not with an internal component name.

1. **Context.** What the business does and what outcome matters, in at most
   two sentences.
2. **Constraint.** The limited resource or rule that makes the system necessary,
   in one or two sentences.
3. **Chain.** The components involved, in flow order. For each one, give its
   name, what it does (about 12 words) and why it exists, meaning how it serves
   the business (about 10 words). Highlight only the components the work
   changes. After checking the code, mark components that already do their part
   as unchanged.
4. **Concept.** The single idea the work depends on. Where it helps, show what
   happens on either side of it (for example: too small, matched, too large).
5. **Problem and fix.** State the problem in business terms first, then the
   behavior, setting, or value that changes, as the story states it. Mark any
   part of the fix that the story does not state as inferred.
6. **Requirements, traced.** One row per thing the work must achieve:
   - the requirement in plain words
   - the story's words that ask for it, quoted
   - where they appear (acceptance criteria, asks, a table, or notes)
   - explicit or implied; for an implied requirement, quote the text that
     implies it

   List acceptance criteria first, then asks, then tables, then notes, so
   placement shows weight. When a story table defines behavior, reproduce it
   once, labeled as the story's. Add no requirement that no story text
   supports.
7. **Done signal.** The observable evidence that the change worked, in one or
   two lines. Name the check (a run summary, a report, a test on a named
   environment); do not restate the requirements.
8. **Open items.** Facts to check and open decisions only, classified as above.
   - Fact: what it is, how to check it, and what changes with each answer.
   - Decision: the question, who decides, and why the story does not settle it.

   When there are none, write one line saying nothing is open, so the reader
   knows not to wait on anyone.
9. **Repositories.** Link every repository involved, in two groups:
   - **Directly involved:** repositories the work changes or must inspect.
     These are the ones to attach to the workspace or agent.
   - **Context:** repositories behind the other components in the chain,
     linked for reference. They do not need to be inspected.

   Give each repository's role in a few words, without file paths. Mark any
   repository name that could not be confirmed.

## Supporting detail, when warranted

Use only these sections, and only when they change what the reader does:

- **Reach.** When a requirement must hold in several places (every channel,
  entry point, or region), list each place, whether the change reaches it
  today, and how much it is used over a recent period. Check usage against
  production data or run history; until checked, mark it unchecked and list it
  under Open items when it would change scope.
- **Evidence.** A few labeled numbers with their source.
- **Unchanged.** What explicitly does not change, so the reader does not
  over-read the work.
- **Terms.** Only terms the reader will meet next and that the artifact does
  not already explain, one line each.

## Keep it current

Revise the artifact whenever a check, a finding, or the reader's feedback
answers or changes something:

- Replace the affected statement in every section where it appears.
- Remove an open item once it is answered, and put the answer where it
  belongs. Do not keep it marked as resolved.
- Remove banners, labels, and callouts whose premise no longer holds.
- Before handing back, re-read every section against the latest findings. A
  statement that is no longer true is an error, not history.
- Keep history out of the artifact: no change notes, version labels, or
  references to earlier versions. End with one line naming the sources and the
  date or commit they were checked at.

## Cut

Before handing back, remove:

- Implementation detail, as defined under Output.
- Statements about the artifact, the agent, earlier versions, or what was left
  out. When a source could not be read, mark the affected claim "not verified"
  instead of describing the access problem, and list it under Open items as a
  fact to check when it changes what the reader does.
- Readiness verdicts ("not ready", "blocked", "awaiting confirmation") unless an
  open decision or a declared dependency blocks the work; then name it.
- Repetition. State each fact once. Do not repeat a number shown in a visual in
  prose or in a stat, and do not restate requirements in the done signal.
- Captions longer than one line.
- Related links, terms, and evidence the reader does not need to act.
- Any sentence that does not change what the reader understands or does.

## Wording

- Use neutral, professional, technical language suitable for any organization
  that uses this kit. Avoid slang, humor, and loaded or judgmental terms.
- Describe people and business processes factually. Prefer the organization's
  canonical terms, such as those in a repository's `CONTEXT.md` or glossary.
- Define a term the first time it appears.
- Prefer one concrete number to an adjective.
- Mark inferred facts as inferred, and cite the source for business facts.
- Verify changing facts (capacities, flags, defaults, usage) against current
  code, configuration, or production data before including them.

## Visuals

- A chain diagram with only the changed components highlighted and the others
  marked unchanged.
- A before/after chart or table for the value or behavior that changes.
- Evidence as a few labeled numbers.
- A supply, demand or risk check when the fix depends on one.

Put the metric and units in each chart's title and the source in one short
line. Use no decoration that carries no information.

## Sources

Build context from current sources, in this order:

1. The story or task itself, including its tables, acceptance criteria, notes,
   and linked tasks. It is the authority for what the work must do.
2. The target repository's architecture or overview docs, glossary
   (`CONTEXT.md` or equivalent), and accepted ADRs.
3. Executable code, configuration, and tests, for any value the artifact
   states.
4. Production data or run history, when scope or impact depends on usage.
5. For products in this kit, `skills/guide-product-work/reference/product-catalog.json`
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
- Requirements, traced: raise both peak hours to the new capacity (explicit,
  acceptance criteria: "hours 10 and 11 plan up to the new capacity"); leave
  other hours unchanged (implied, asks: "raise capacity for the two peak
  hours only").
- Done signal: the next run summary shows the new capacity for those hours.
- Open items: one fact to check, whether the integration accepts the larger
  lists (its upload limit in configuration). If the limit is at or above the
  new capacity, nothing else changes; if it is lower, the integration must
  change too. Nothing to decide.
- Repositories: the scheduler repository (directly involved); the filter,
  integration and orchestration repositories and the shared CI workflows
  (context).

"Which hours change?" does not appear under Open items, because the story
settles it.
