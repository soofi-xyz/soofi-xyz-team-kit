# Implementation status layer

Use this reference with
[SKILL.md](../SKILL.md#implementation-status-layer). The layer turns the
context artifact into the story's status page once work starts. The core above
it stays free of implementation steps.

## Placement

Place the layer after the core drawings, in the order below. When the artifact
mainly serves standups and status meetings, pin **Now** and **Today at a
glance** directly under the title and goal line, and keep the rest of the
layer after the core.

## Now

- Write two or three sentences: what is true now, what happens next, and what
  is blocked and on whom, by name.
- Start with the timestamp in the team's primary time zone and the reader's
  local zone in parentheses, for example
  "Updated 14:05 <primary zone> (16:05 <reader zone>)".

## Today at a glance

- Draw a horizontal timeline of the day's milestones in time order.
- Draw done milestones as filled circles, the current one in the accent color,
  and next ones as hollow circles.
- Give each milestone its time and a two-line label: the action on the first
  line and its object or result on the second (for example "Validation" over
  "passed").
- Draw the axis solid up to now and dashed after it.
- Keep it to one day. Earlier days belong in the path to done.

## Path to done

- Lay out the remaining work as columns from left to right. Boxes in one column
  run in parallel; each column waits for the one before it.
- Give each box a short action, its owner's name, its linked pull request or
  issue, and a status dot (done, in progress, blocked, not started). Add a
  legend for the dots.
- Under the drawing, add a collapsed table titled "Why these run in parallel or
  in order", with one row per dependency or deliberate absence of one:

| Step | Waits for | Reason | Proof |
| --- | --- | --- | --- |
| Backfill in production | Fix merged and deployed | The backfill reads the new field | Linked pull request and the code that reads the field |
| Second review | Nothing | It does not touch the backfill code | Linked pull request diff |

## Live run

Show this panel only while something long runs, such as a backfill, a
migration or a certification:

- The run identifier, linked to its console or log.
- The start time, in the primary zone with the reader's zone in parentheses.
- Progress phase by phase: each phase's name, its status and, where available,
  its count or elapsed time.
- The before-numbers captured just before the run started.
- The checks that will run after it, each with its expected result.

When the run finishes, record its result in **Now** and in the evidence, then
remove the panel.

## Meeting agenda

| Topic | What to settle |
| --- | --- |

List only topics that need the people in the meeting. Once a topic is settled,
move the outcome to **Decisions** and remove the row.

## Pull requests

| Pull request | What it changes | Status | Approver |
| --- | --- | --- | --- |

- Link every pull request, including inside this table.
- Name an approver only after confirming the approval on the pull request
  itself.

## Decisions

| Topic | Decision | Owner |
| --- | --- | --- |

- Link each decision to where it was made: a comment, a thread, or meeting
  notes.
- Write an owner only after confirming it from a source. A reaction or a reply
  such as "sounds fine" does not establish an owner or an approver.

## Done when

Add a callout that lists the observable conditions that close the story: the
core done signal plus any rollout conditions, for example "backfill counts
equal the expected rows, and the next scheduled run shows the corrected
outcome".

## Collapsed detail

- **Evidence.** Labeled numbers, each with its source. For numbers from a lower
  environment, state why they differ from production.
- **Outside-scope findings.** Issues found during the work that this story does
  not fix:

| Priority | Finding | Owner | Next |
| --- | --- | --- | --- |

## Pruning

Prune at every update. Candidates:

- checklists whose items have all passed
- options superseded by a decision
- proofs once the decision they supported is made
- rows nobody acts on
- panels for finished runs

Remove clearly stale content directly. When the owner asks which parts are
verbose, list the candidates with a one-line reason each and wait for
confirmation before deleting any of them.

## Coordination

- When several agents or threads work on the same story, name one coordination
  owner. That owner updates the artifact and the shared status; the others send
  their results to the owner.
- Give each pull request description a single editor. Two threads editing the
  same description overwrite each other.
