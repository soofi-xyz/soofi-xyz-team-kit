# Console Edit Mode turns

Console's Edit Mode lets a signed-in editor change an **installed app** by describing
the change. Each message is one Enact run of `vivillon`: one **turn**. A turn edits the
app's source in its repository, proves the edit passes the app kit's check, pushes it
once and answers with a small JSON result. Console builds its preview from the pushed
commit and links the pull request; a person merges it. Nothing else delivers the change.

Use this page only for a run whose message begins `Console edit turn`, or that
otherwise says it is an Edit Mode turn and gives a `sessionId`. A run that begins
`Console edit batch` (**Run fixes**) is a different thing and follows
[the skill's section 7](../SKILL.md#7-fix-a-console-edit-batch). Build a new app, or
change one outside Edit Mode, as [the skill](../SKILL.md) describes.

`scripts/edit-turn.mjs` (beside this skill; on Enact
`.claude/skills/configure-console-product/scripts/edit-turn.mjs`) does the git work
and holds the gate. Use it for every step below. Do not reproduce its steps by hand.

## What the turn is given

| Input | Meaning |
| --- | --- |
| `repository` | The app's GitHub repository, `owner/repo`, one of the run's repositories. |
| `appId` | The installed app, as in its `console-app.json`. |
| `sessionId` | The edit session. Every turn of a session has the same one. |
| `baseSha` | The commit the installed app was built from: the `commit` of its provenance (the `X-Source-Commit` Deploy sent when it installed the app). Full lowercase SHA. |
| The request | What the person wants changed, in their words, with any element or sketch Console attached. |

When `repository`, `appId`, `sessionId` or `baseSha` is missing or malformed, do not
guess one: answer `NEEDS-INFO` (below) naming what is missing.

## The turn

1. **Begin.** Run, from the session's directory:

   ```bash
   node <skill>/scripts/edit-turn.mjs begin --repository <owner/repo> \
     --app-id <appId> --session-id <sessionId> --base-sha <baseSha>
   ```

   It clones the repository when the sandbox has no clone, runs `git fetch`, and checks
   out `edit/<appId>/<sessionId>` reset hard to `origin/edit/<appId>/<sessionId>`. The
   first turn of a session has no such branch yet, so it starts the branch at `baseSha`,
   never at the default branch's head. Anything an earlier turn left in the clone,
   committed or not, is dropped. It prints `{ branch, startSha, baseSha, appRoot, dir }`:
   `startSha` is the commit the turn started from (`null` on the first turn) and
   `appRoot` the app's folder in the repository.
2. **Install.** In `<dir>/<appRoot>`, install the dependencies exactly as the lockfile
   pins them (`pnpm install --frozen-lockfile`). The sandbox already resolves
   `@prism/*` from the environment's `prism` registry with a read token: never run
   `aws codeartifact login` or write a registry file. When the install answers 404
   for the app's pinned `@prism/console-app-kit`, make
   [the kit bump](#bump-the-app-kit-when-the-registry-lacks-its-version), the one
   change to `package.json` and the lockfile a turn may make. Never change them, or a
   registry setting, any other way to make an install work. When the kit cannot be
   installed, the check cannot run and the turn cannot push: end it as `FAILED`.
3. **Understand, then edit.** Read the request against the app's source. When it is
   ambiguous, needs a decision only the person can make, or needs something outside
   the editable paths, answer `NEEDS-INFO` instead of guessing. Otherwise change only:

   - `<appRoot>/console-app.json`
   - files under `<appRoot>/src/`, as regular files

   Follow [the guardrails](../../build-console-product/reference/app-kit.md#guardrails).
   A request that needs a component, a variant or a data operation that does not exist
   is not an edit you can make: say so in the answer and name `chandelure` or the
   product's builder, as the skill's step 3.6 describes.
4. **Commit** the change on the branch. Leave nothing uncommitted under the editable
   paths.
5. **Push.** Run `node <skill>/scripts/edit-turn.mjs push`. It runs the gate, pushes
   once with `git push --force-with-lease=<branch>:<startSha>`, finds the session's open
   pull request or opens one as a **draft**, and prints `{ branch, sha, prUrl }`. Do not
   call `open_pull_request` as well.
6. **Answer** with [the result](#the-result).

One turn is one narrow piece of work. The person sees it in Console's preview and
answers with their next message: that is the feedback checkpoint. Do not start a
second change in the same turn.

## Bump the app kit when the registry lacks its version

Each environment's own package registry holds `@prism/console-app-kit` only from the
version it started at, never below 1.49.0. An app installed earlier can pin an older
kit that the registry answers with 404, so nothing installs and the gate refuses every
push. The run's prompt names the registry's newest kit in a line such as:

```text
- @prism (prism): the latest @prism/console-app-kit published here is 1.49.0
```

followed by a rule to use that app kit version when you add or upgrade the kit, unless
the repository pins another on purpose. The version is the text after
`published here is`; the registry's other packages, such as packs, are versioned on
their own and never take it.

This step is only for recovering from that 404. When `pnpm install --frozen-lockfile`
succeeds, the app's kit is in the registry: make no bump, whatever the prompt says,
and go on with the turn as usual.

Only when the app's `package.json` pins `@prism/console-app-kit` to an exact version
**and** `pnpm install --frozen-lockfile` failed with 404 for it, take
`<kit_version>` from that prompt line, never guessed. When the prompt has no
`- @prism (prism)` line, or has one that does not name `@prism/console-app-kit` and a
version (a bare `- @prism (prism)`: the registry has no kit yet, and then no line of the
prompt mentions the app kit), there is no kit to bump to: end the turn as `FAILED`,
with a `message` saying the environment's registry has no app kit for this app. An
installed commit pinning a kit the registry answers with 404 is never a pin "on
purpose" in this sense: the registry cannot install it. Otherwise run in the clone:

```bash
node <skill>/scripts/edit-turn.mjs bump-kit --kit-version <kit_version>
```

It runs `pnpm add -E --ignore-scripts @prism/console-app-kit@<kit_version>` in
`<appRoot>` (the kit and `console-app` need no install scripts; Build installs apps
the same way) and accepts the result only when:

- `package.json` changed only in the kit pin, and no other tracked file changed;
- `pnpm-lock.yaml` passes Build's kit gate: `lockfileVersion` stays `'9.0'`, as the
  installed commit has it; the lockfile pins the kit at `<kit_version>`;
  `@prism/console-app-kit@<kit_version>` and every other package under `packages:`
  resolve only by `{ integrity: sha512-… }`, with no `tarball:` URL, registry host,
  `file:`, `link:` or git source; and there is no `overrides`,
  `patchedDependencies`, `pnpmfileChecksum` or `packageExtensionsChecksum`.

It then records both files in the turn's state and prints `{ from, to, files }`.
When any of that fails, it puts `package.json` and the lockfile back as they were and
refuses. Then:

1. Make the requested edit.
2. Commit the bump with the edit. `check` checks the committed `HEAD` and refuses
   uncommitted changes to tracked files, so commit first.
3. Run `node <skill>/scripts/edit-turn.mjs check` (the gate and `console-app check`).
4. Push as usual.

It refuses, and changes nothing, when:

- `<kit_version>` is not an exact version, or is earlier than 1.49.0, the lowest
  kit any registry holds;
- `<kit_version>` is not later than the app's pin (the same version, or a
  downgrade): the 404 has another cause, so end the turn as `FAILED`;
- `<kit_version>` has a different major version than the app's pin (for example
  1.34.0 to 2.0.0): do not bump across a major version. End the turn as `FAILED`,
  with a `message` saying the app needs a kit upgrade across a major version;
- the pin is not an exact version, or `package.json` or the lockfile already differ
  from the installed commit;
- a `.npmrc`, `.pnpmfile.cjs`, `pnpm-workspace.yaml`, `package-lock.json` or other
  lockfile is in the app's folder or a folder above it, or such a file is untracked
  anywhere in the clone. Do not remove a committed one: end the turn as `FAILED`.

Never edit the pin by hand, add another dependency, or run `pnpm add` yourself: the
gate accepts `package.json` and the lockfile only as `bump-kit` left them in this
turn, or as an earlier turn of the session pushed them, and checks the lockfile
again either way.

## The gate

Every push from the clone passes through a `pre-push` hook that `begin` installs; `push`
and a plain `git push` meet the same gate. It refuses the push, and nothing reaches
GitHub, unless all of these hold:

| Rule | Refused example |
| --- | --- |
| Only `edit/<appId>/<sessionId>` is pushed, and it is neither deleted nor pushed with other refs. | A push to another branch. |
| The remote branch is still where the turn started (`startSha`). | Someone pushed to the branch during the turn. |
| The commit descends from `baseSha` and is the checked-out one. | A rebase onto the default branch. |
| Every path that differs from `baseSha` is `<appRoot>/console-app.json` or under `<appRoot>/src/`, except `<appRoot>/package.json` and `<appRoot>/pnpm-lock.yaml` exactly as [the kit bump](#bump-the-app-kit-when-the-registry-lacks-its-version) left them. | `package.json`, the lockfile (other than that bump, or a bump across a major version), `tsconfig.json`, a bundler or registry file, a workflow, `bundle.json`, another app. |
| No changed file is a `.npmrc`, `.pnpmfile.cjs`, `pnpm-workspace.yaml` or another lockfile, even under `src/`. | `src/.npmrc`. |
| Every changed file is a regular file, git mode `100644`. | A symbolic link (`120000`), a submodule (`160000`), an executable file (`100755`). |
| Nothing under the editable paths is uncommitted. | An edit made after the commit. |
| `console-app check` passes in `<appRoot>`. | A raw element, a direct network call, a type error; a kit that is not installed. |

The comparison is with `baseSha`, so the whole session's change stays inside the
editable paths, not only this turn's.

When the gate refuses:

- **Fix it in the turn.** Read the reasons it printed, change the source and commit
  again, then run `push` again. Put a path that is not editable back with
  `git checkout <baseSha> -- <path>` and commit that.
- **Or fail without pushing.** When you cannot fix it, end the turn as `FAILED` with
  the reasons. The branch on GitHub stays where the turn started.

Never get around the gate: no `--no-verify`, no change to the clone's hooks or git
configuration, no push from another clone, no pull request opened another way, and no
edit to the check, the build settings or `package.json` to make a refusal go away.
`node <skill>/scripts/edit-turn.mjs check` runs the gate on the current commit without
pushing.

A turn pushes once. After a successful push, `push` refuses a newer commit; leave
further changes to the next turn. When `push` fails after the branch was pushed (the
pull request could not be read or opened), run `push` again: it does not push twice.

## The result

End the run with exactly one JSON object as the whole final message, with no text
around it:

```json
{
  "branch": "edit/<appId>/<sessionId>",
  "sha": "<the pushed commit>",
  "prUrl": "https://github.com/<owner>/<repo>/pull/<number>",
  "status": "PUSHED",
  "message": "What changed, in plain words for the person."
}
```

Take `branch`, `sha` and `prUrl` from what `push` printed, unchanged. For a turn that
did not push, take them from `node <skill>/scripts/edit-turn.mjs result`, which never
pushes: `sha` is the commit this turn pushed, so `null` here, and `prUrl` is the
session's open pull request, or `null` when no turn has pushed yet.

| `status` | When | `sha` |
| --- | --- | --- |
| `PUSHED` | The gate passed and the commit is on the branch. | The pushed commit |
| `NO-OP` | The request needed no change to the app. | `null` |
| `NEEDS-INFO` | You need an answer before changing anything. `message` is the one question, in plain words. | `null` |
| `FAILED` | The gate refused and you could not fix it, or a step could not run. `message` says why. | `null` |

When `begin` itself could not run, answer with `branch` set to
`edit/<appId>/<sessionId>` when both are known, else `null`.

Write `status` exactly as shown, upper case with the hyphen. Enact reads only that
field of the final answer: `"NEEDS-INFO"` marks the run as asking for input and pauses
the session's queued messages until the person answers. The other three mean nothing
to Enact, so after `FAILED` or `NO-OP` the next queued message still runs; Console
reads them from the run's result. Keep `message` short: a result over 128 KiB is cut
off and no longer parses.

Never report a `sha` that `push` did not print, and never call a turn `PUSHED` when the
gate refused it.

## What this does not do

- It does not build or publish the preview, merge, close or mark the pull request
  ready, or delete the branch. Console and the person do those.
- It does not change Enact or Console. The gate lives in this skill; Console's preview
  builder checks the pushed commit again on its side.
- A draft pull request does not run the app repository's validation; marking it ready
  for review does.
