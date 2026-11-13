---
name: configure-enact-product
description: "Add, change and test an agent on an existing Enact deployment: write its instructions, tools, skills and limits, choose its repositories and who may run it, save it, run it, read its trace and usage, and deliver it as a configuration bundle. Use Zorua; route runtime gaps to Zoroark."
---

For infrastructure, bundle or installation work, load
[the stable stack identity contract](../build-product-deployer/reference/stack-identity.md).
Do not introduce deployment stages. Preserve the same stack across direct and
Marketplace/Deploy installation; verify support before running an update.

# Operate Enact agents

Use `zorua`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Enact capability map](../guide-product-work/reference/iterations/enact.md).

This skill drives Enact's HTTP API and never changes its code. Once Enact has a
repository, write agents from its contract document and examples and use the routes in its
API document; they win over this skill.

## Status

Read [the Enact status table](../guide-product-work/reference/iterations/enact.md#status)
before each step, and confirm it against the environment with the read-only call under
Prerequisites. Where Enact is not installed, say so, show the person what the agent
directory will look like, and stop before any API call. Do not stand in for the service by
running an agent some other way and calling it Enact.

## Prerequisites

1. Require `PRISM_API_KEY` (the environment's shared API key) in the user's terminal.
   Check presence with exactly this command and no other expansion of the variable:

   ```bash
   if [ -n "${PRISM_API_KEY:-}" ]; then echo "PRISM_API_KEY set (${#PRISM_API_KEY} chars)"; else echo "PRISM_API_KEY unset"; fi
   ```

   If it is unset, stop and ask the user to set it in their own terminal. Never read it
   from AWS, print it or ask for it in chat.
2. Get the shared domain from the user or their environment (`PRISM_DOMAIN`); never from
   SSM or stack outputs. Confirm the key with a read-only call that prints only the status
   code:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' -H "x-api-key: $PRISM_API_KEY" "https://$PRISM_DOMAIN/enact/agents"
   ```

   `200` is ready and `403` a rejected key. `404` means Enact is not installed in this
   environment: hand the subscription to `skarmory` and stop.
3. Use no AWS credentials. Every checkpoint is a product-API read-back.

## After install

An installed Enact runs agents through the API and MCP at once. The Asana channel and
repository work each need a one-time setup per environment, described in Enact's
`docs/asana-channel.md` (Setting it up) and `docs/repositories.md` (The App and its key);
they win over this section. Check each one before relying on it, and before writing an
agent that lists `asana` in `channels` or names `repositories`.

Two of the steps write a secret into the stack `Enact`. You use no AWS credentials: give the
person the commands to run in their own terminal, with `AWS_PROFILE=<selected-profile>` and
the environment's account and region checked first, and never ask for the secret's value in
chat. Read the secret's ARN from the named stack output, and have them write the value from
a file so it never lands in shell history:

```bash
ARN=$(aws cloudformation describe-stacks --stack-name Enact \
  --query "Stacks[0].Outputs[?OutputKey=='<output key>'].OutputValue" --output text)
aws secretsmanager put-secret-value --secret-id "$ARN" --secret-string file://<value>.json
rm <value>.json
```

### Repositories

1. **The App.** Each environment has one Enact GitHub App with **Contents** and **Pull
   requests** read and write. The person who administers the GitHub organization creates
   it and installs it only on the repositories agents may use; a missing installation is
   a request to them, not something to work around.
2. **Its key.** The person writes `{"app_id": "<id>", "private_key": "<PEM>"}` into the
   `GitHubAppKeySecretArn` output's secret. The worker reads it within five minutes; no
   deploy is needed.
3. **The allowed list.** Read it with `GET /enact/repositories` and set it with
   `PUT /enact/repositories`. An agent can name only repositories on it, and every turn
   checks it again.
4. **Check.** Run an agent that names one allowed repository. A run that fails with
   `REPOSITORY_ERROR` means the key or the installation is missing.

### Asana

1. **The bot.** Keep one Asana bot user per environment and add it to each workspace whose
   people should reach agents. The person who administers Asana creates it.
2. **Its token.** The person writes `{"token": "<personal access token>"}` into the
   `AsanaBotTokenSecretArn` output's secret. The channel reads it within five minutes, and
   the next reconcile, at most 15 minutes later, registers one webhook per workspace.
   Until then the channel answers nothing.
3. **Agents.** Only agents whose current version lists `asana` in `channels` are offered.
   Asana runs use Bedrock, never a person's Claude plan.
4. **Check.** Assign a test task to the bot. It comments with the agents it can offer;
   answer with one agent's name, and confirm it comments the run id and then the result.
   Read that run with `GET /enact/runs/{run_id}`.

## Write an agent

```text
<agent>/
├── agent.json        # the manifest: model, turn and cost limits, channels, repositories
├── instructions.md   # the prompt
├── tools/            # one file per tool: tools/<name>.ts
├── skills/           # skills/<name>/SKILL.md
└── subagents/        # subagents/<name>.md
```

Enact's `docs/agent-contract.md` defines every manifest field and allowed path, and
`examples/agents/` holds a complete agent; they win over this outline.

1. **Name and purpose.** One agent does one job a person can state in a sentence. Give it
   a lowercase name and a semantic version.
2. **Instructions.** Write what the agent does, what it must never do, what it returns and
   when it stops. Quote no real customer, meeting or task content.
3. **Tools.** Add a tool only for something the instructions need. A tool that reaches
   another Prism product calls that product's HTTP API; a tool that needs a partner
   credential goes through Connect. Put no secret in a tool file.
4. **Limits.** Set the model, a turn limit and a cost ceiling. Start low and raise them
   from observed runs.
5. **Repositories.** List only the repositories the agent must work in. A repository the
   Enact GitHub App is not installed on is a request to the person who administers it,
   not something to work around.
6. **Who may run it.** Decide the roles or people. Grants are set through Access; hand
   them to `doublade`.

## Moving an existing agent

Eevee and Kirlia run elsewhere today. When asked to move one:

1. Read the existing agent's prompts, tools and runtime first, and list what it does that
   the directory above cannot express. Each such item is a gap for `zoroark`, not a
   reason to change the agent's behavior.
2. Move the prompt and tools unchanged. Improve nothing in the same change.
3. Run the same inputs through the old and the new agent and compare outputs with the
   person before anything is switched over.
4. Leave the old agent running until the person switches. Never disable it yourself.

## Save, run and check

1. Save the agent through the API and read it back. A changed document under a saved
   version is refused: publish a new version.
2. Start one run with a small input. Report the run id, status, turns, tokens and cost.
3. Read the trace through Persist's read-only query API: the thread, its turns, each tool
   call and result. For a failed run, name the last tool call it reached.
4. Send a second message to the same session to confirm it continues.
5. Try one variant: a different limit, an input the agent should refuse, or a repository
   outside its list.

A run calls a real model. A direct run uses the caller's own Claude plan and counts
against it; an Asana run uses Bedrock and costs money. Start runs only within the
requested scope and say which was used.

## Linking a Claude plan

A person links their own plan once, signing in on Anthropic's site. Tell them where the
link step is; never ask for a token, a code or a sign-in file in chat, and never link on
someone's behalf.

## Deliver

Keep every agent in a repository created from
`prismteam-ai/configuration-bundle-template` and follow
[the configuration-bundle handoff](../build-product-deployer/reference/configuration-bundles.md#target-api-and-authoring-handoffs).
Direct saves are for testing; remove them through the API once the bundle is installed.
Open the bundle PR and work it until checks and reviews are clean; the user merges.
Publication belongs to `registeel` and installation to `skarmory`. Until Build and Deploy
support Enact agents, say that bundle delivery is not available and stop at the tested
directory.

## Return

Return the agent directory (or its diff), the saved version, redacted run ids with status,
turns, tokens, cost and which model credential was used, what the trace showed, bundle PR
links, handoffs to `zoroark`, `doublade`, `uxie`, `registeel` or `skarmory`, and remaining
gaps. Never report an unperformed check as passing.
