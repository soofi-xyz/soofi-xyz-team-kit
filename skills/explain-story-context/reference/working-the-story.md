# Working the story

Use this reference with [SKILL.md](../SKILL.md#working-the-story) while a story
is in flight. These process lessons prevent wasted time, whether or not a
context artifact exists. Record their outcomes in the
[implementation status layer](implementation-status.md).

## Decide before validating

- Before running an expensive validation or certification, close every open
  decision that changes the code being validated. A validation pins the code it
  ran against; a later logic change makes it stale, and it must run again.
- Formatting-only changes, such as whitespace or comment edits, usually do not
  make a validation stale. Confirm against the validation's own rules.
- Record which commit each validation ran against, so staleness is visible.

## Resolve spec and review conflicts by the rare case

- When a written spec and a reviewer's objection conflict, compare how each
  option behaves in the rare case the rule exists for. Pick the option that
  fails safely, for example by excluding a record rather than acting on it.
- Do not choose an option because it gives the same result on today's data.
  The rule exists for the case today's data may not contain.
- When someone cites a precedent, check that the precedent's reason still
  applies to this case.

## Keep the story text in step with the code

When a decision changes what the story says (scope, a rule, an acceptance
criterion), update the story text so it matches the code. Link the decision
from the story.

## Check instead of asking

- Do not depend on people for what the agent can check or do: read the code,
  query the data, run the test.
- When access is missing, give the user the exact commands to run and say what
  output to send back.
- Ask people only for decisions, or for access only they hold. Bring options
  with a recommendation.

## Write commands the user can paste

- Keep `#` comments out of commands meant for a terminal. zsh, the default
  shell on macOS, does not treat `#` as a comment in an interactive session by
  default, so the comment text runs as part of the command. Put notes in the
  text above the code block instead.
- Assume the user may not be an administrator on their laptop and may have no
  system package manager such as Homebrew. Prefer user-space installers that
  write to the home directory.

Correct: the note sits above the block.

Check the installed version, then list the user-space binaries:

```bash
tool --version
ls ~/.local/bin
```

Incorrect: in zsh, the comment text becomes part of the `tool` command.

```bash
tool --version   # check the installed version
```

## Quantify downstream impact before a rollout

- Before a rollout, list every consumer of the changed data: jobs, schedulers,
  reports, exports, and other teams' readers.
- Quantify the impact on each one, in rows affected and actions triggered. For
  example, a scheduler that treats recently dated deletions as a trigger acts
  on every record the change marks deleted with today's date.
- Prefer a rollout scope that leaves consumers untouched, for example by
  keeping the original event dates so date-triggered consumers see nothing new.

## Choose a low-coordination rollout and rehearse it

- Prefer rollout mechanisms that need no pause of production pipelines and no
  sign-off from other teams, for example a single-flight orchestrator run
  slotted between scheduled runs.
- Rehearse the exact production method in a lower environment and measure
  before and after. The rehearsal passes when:
  - every change, in each direction, is explained by the source of truth
  - no record ends up less protected than the source of truth requires
  - the changed counts equal the expected rows

## Map dependencies explicitly

For each step, state which steps can run in parallel with it and which it must
wait for, each with its reason. Show the result in the path-to-done drawing
and prove each dependency in its collapsed table.

## Measure against the source of truth

- Measure counts and impact against the source of truth rather than assuming
  them.
- Numbers in lower environments can differ greatly from production, for
  example because of sampled or synthetic data, stale copies, or missing
  integrations. When they differ, state why next to the number.
