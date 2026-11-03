---
name: move-to-claude-code
description: "Walk a person who has never used our agents through moving from Cursor to Claude Code, one step at a time with the screenshot for each step: Claude plan and organization, install, sign-in and setup token, installing the Soofi team kit, checking agents and MCP servers with test prompts, Amp cloud runs, and recreating Cursor automations, loops and cloud agents. Use when someone asks to set up or move to Claude Code, install the team kit in Claude Code, or test the Move to Claude Code guide."
---

# Move to Claude Code (guided)

Walk the person through [`docs/move-to-claude-code.md`](../../docs/move-to-claude-code.md)
one step at a time. The guide is the source of truth: read it at the start of every session
and follow its steps, wording and order. Do not add steps from memory, and do not skip a
step because it seems obvious.

## Locate the guide and screenshots

- Guide: `<plugin-root>/docs/move-to-claude-code.md`, where `<plugin-root>` is two
  directories above this `SKILL.md` (in Claude Code, `${CLAUDE_PLUGIN_ROOT}`).
- Screenshots: `<plugin-root>/docs/images/move-to-claude-code/`. The guide references each
  one as `./images/move-to-claude-code/<file>.png`.
- When the plugin copy is missing either, use
  `https://github.com/soofi-xyz/soofi-xyz-team-kit/blob/main/docs/move-to-claude-code.md`.

## For every step

Present exactly one step per message, in this shape:

1. **Step number and title** from the guide.
2. **Where:** regular terminal, inside Claude Code, or browser. Say it in words every time;
   new people confuse the regular terminal with the Claude Code prompt.
3. **Run:** the exact command or clicks from the guide, in a code block when it is a
   command.
4. **You should see:** the guide's description, then show the step's screenshot(s):
   - In Cursor or any chat that renders Markdown images, embed the absolute path:
     `![<alt text from the guide>](<plugin-root>/docs/images/move-to-claude-code/<file>.png)`.
   - In a terminal-only session (Claude Code CLI, Codex CLI, Copilot CLI), give the
     GitHub link
     `https://github.com/soofi-xyz/soofi-xyz-team-kit/blob/main/docs/images/move-to-claude-code/<file>.png`
     and offer `open "<plugin-root>/docs/images/move-to-claude-code/<file>.png"` (macOS) so
     the person can view it.
5. **If you don't:** the guide's fixes for this step.
6. Ask: "What do you see?" Wait for the answer before moving on.

When the answer matches, go to the next step. When it does not, match it against the
step's **If you don't** list, give that fix, and ask again. When nothing in the guide
matches, say so plainly, help them get past it, and record it as a guide gap (below).

## Rules

- Never run sign-in, purchase, terms-acceptance or token commands on the person's behalf.
  The person runs `claude`, `/login`, `claude setup-token` and the checkout themselves.
- Never ask for, display, store or repeat the `claude setup-token` value. Tell the person
  to paste it only into Amp's **Token** field.
- For step 5, run or give the check from the `team-kit-check` skill and show its output
  as-is. Prefer the one-line `curl … | bash -s -- --test` form in a regular terminal.
- For step 7, build the person's table of running automations, loops, cloud agents and
  deployed runtimes with them. For each row, confirm the replacement has run once before
  you suggest turning the original off. When unsure, mark it "keeps running".
- When the person is on a step whose screenshot does not match what they see (a newer
  Claude Code or Amp screen), record it as a guide gap and ask them to capture the new
  screen for the pull request.

## Guide gaps and pass-it-on notes

Keep notes in `~/move-to-claude-code-notes.md` (create it on the first gap). For each gap
append:

```markdown
## Step <n>: <title>
- Saw: <exact message or screen, or screenshot file name>
- Expected (guide): <what the guide said>
- Got past it by: <what worked>
- Guide fix: <proposed wording or screenshot change>
```

At the end of the walkthrough (or when the person stops):

1. Summarize the gaps in plain language.
2. Offer to prepare the pass-it-on pull request to `soofi-xyz/soofi-xyz-team-kit`: edit
   `docs/move-to-claude-code.md`, replace changed screenshots under
   `docs/images/move-to-claude-code/` with the same file names, blur personal emails,
   usernames and private repository names, add the tester's row to the **Pass it on**
   table, bump the plugin version per `AGENTS.md`, and request Saman's review.
3. Remind them to hand the merged guide to the next new person.
