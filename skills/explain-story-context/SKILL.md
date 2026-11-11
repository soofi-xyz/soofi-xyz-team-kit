---
name: explain-story-context
description: "Produce a standalone context artifact (canvas, or Markdown when no canvas is available) for a story, task, or change: business context first, then why each involved component exists and how it serves the business, then the problem, fix, done signal, and the repositories involved. Depth scales with the size and impact of the change. Use when asked for an understanding doc, story context, or an explanation of why a change matters."
---

# Explain Story Context

Give the reader the smallest accurate mental model that makes a story, task,
or change make sense. The reader needs to act on the work, not to learn the
whole system.

## Output

Produce one standalone artifact:

- a canvas when the environment supports canvases
- otherwise a single Markdown document

Keep implementation steps out of the artifact. Link to the pull request or plan
instead.

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
   the setting or value that changes.
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
- Evidence as a few labeled numbers.
- A supply, demand or risk check when the fix depends on one.

Label every chart with the metric, units and source. Use no decoration that
carries no information.

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
