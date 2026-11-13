---
name: build-enact-product
description: "Build or maintain the Enact product: agent definitions, runs and resumable sessions in isolated sandboxes, one MCP interface for every agent, sign-in, people's own Claude plans, repository work, the Asana channel, traces and usage. Use Zoroark; use Zorua to add or change an agent on an existing deployment."
disable-model-invocation: true
---

For infrastructure, bundle or installation work, load
[the stable stack identity contract](../build-product-deployer/reference/stack-identity.md).
Do not introduce deployment stages. Preserve the same stack across direct and
Marketplace/Deploy installation; verify support before running an update.

# Build Enact

Use `zoroark`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Enact capability map](../guide-product-work/reference/iterations/enact.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `zorua` with [configure-enact-product](../configure-enact-product/SKILL.md)
to add or change an agent on an existing deployment.

## Status

Read [the Enact status table](../guide-product-work/reference/iterations/enact.md#status).
Everything below is a build specification agreed on 2026-11-11, not evidence that a route,
image or integration exists. Once a repository exists, its `AGENTS.md`, `README.md`,
contract and API documents win over this skill; update the status table as pieces land.

## Decisions

These were agreed with the product owner. Do not reopen one without a concrete failure;
record the failure and ask.

| Decision | Chosen | Why |
| --- | --- | --- |
| Agent loop | Claude Agent SDK | It loads instructions, skills, subagents and tools from files, which is how this kit already describes agents. |
| Where the loop runs | Inside the sandbox | The SDK starts a `claude` process that owns a shell, a working directory and transcript files. The loop and the execution layer are the same machine. |
| Sandbox | AWS Lambda MicroVMs, one per session | Suspend and resume keep the process and disk between messages. AgentCore Runtime was considered and not chosen. |
| Durability | The stored transcript, not the sandbox | A sandbox lives at most 8 hours. The SDK's `SessionStore` copies the transcript out and `resume` continues it on a new sandbox. Add no workflow engine around the loop. |
| Agent definition | A directory in the layout below | Same shape as Vercel's eve. Do not adopt eve itself: it replaces the SDK and the AWS install path. |
| Model for direct MCP runs | The caller's own Claude plan | The person signs in through Anthropic's own flow. See [Claude plans](#claude-plans). |
| Model for Asana and other unattended runs | Bedrock | No person is present to own the usage. |
| Repository work | One Enact GitHub App | Agents push branches and open pull requests. GitHub is not an entrance. |
| Pull request author | The App, with the caller as co-author | Works for Asana runs and needs no second sign-in. |
| Agent delivery | Enact configuration that Zorua installs | Agent directories stay out of the runtime repository. |

## Rules

- Keep Enact generic. Never add code, tests or branches that name Eevee, Kirlia or any one
  agent. Everything specific to an agent lives in its directory.
- The API never executes agent code. It validates and stores a definition; tools and
  hooks run only inside a sandbox.
- One sandbox serves one session and one caller. Never reuse a sandbox across callers, and
  never place two people's files or sign-ins in the same sandbox.
- Treat a sandbox as disposable. Anything worth keeping leaves it: the transcript through
  the session store, code through a pushed branch, results through the run API.
- Verify the caller on every route and fail closed. Record the caller on every run.
- Keep credentials, tokens, prompts and model output out of logs. Log identifiers, counts,
  tokens and cost only. Redact secrets before writing the trace.
- A run that calls a real model costs money or uses a person's plan. Tests use a fake
  model; start real runs only within the requested scope.
- TypeScript strict, CDK the only IaC, one stack `Enact` with no stage suffix. Do not
  `cdk deploy` from the repository; Enact reaches accounts through Marketplace and Deploy.

## Architecture

| Part | Role |
| --- | --- |
| API handler | Stateless. Agent definitions, runs, sessions, linking, the MCP endpoint. Base path `enact` on the shared domain. |
| Ledger | Run and session records: caller, agent and version, status, sandbox identifier, usage. The source for status and results. |
| Definition store | Immutable agent versions: manifest plus the directory's files. |
| Sandbox image | The SDK, the unmodified `claude` binary, `git`, and a small server that accepts a turn, loads the agent directory and streams messages back. |
| Session store | The transcript copy, one object prefix per session. |
| Sign-in store | Each person's Claude sign-in directory, encrypted, loaded only into that person's sandbox. |
| Channels | The Asana channel. Callers of the API, never a second way to run an agent. |

A run, end to end:

1. A caller submits a message for an agent, with or without a session. The API verifies
   the caller, checks the `run` grant and writes the ledger record (`202`).
2. The API starts a sandbox for a new session, or wakes the session's sandbox. Derive the
   start request's idempotency token from the session so a retry cannot start a second one.
3. The sandbox loads the agent version, resumes the transcript when there is one and runs
   the turn. It streams messages to the API as they happen.
4. The API updates the ledger, writes the trace and usage, and serves status and result.
5. When the caller goes quiet the sandbox suspends. If it is gone when the next message
   arrives, a new one resumes from the session store.

## Agent definition

```text
<agent>/
├── agent.json        # the manifest: model, turn and cost limits, channels, repositories
├── instructions.md   # the prompt
├── tools/            # one file per tool
├── skills/
└── subagents/
```

- `agent.json` is the manifest, as plain JSON. Packaging reads files and runs no code; the API
  validates and stores the manifest. Enact's `docs/agent-contract.md` defines its fields.
- Load `instructions.md`, `skills/` and `subagents/` through the SDK's own file loading.
  Register each file in `tools/` as a custom tool through the SDK's in-process tool server.
- The manifest bounds a run: model, maximum turns, a cost ceiling, the repositories it may
  use and the hosts it may reach. A run may narrow these, never widen them.
- Versions are immutable. Changed content under a saved version is a conflict; compare by
  the SHA-256 of the canonical content.
- Decide the manifest's exact fields in the `agents` piece and write them into the
  repository's contract document. That document, not this skill, is then the contract.

## Sandbox

Check each fact below against AWS's current Lambda MicroVMs documentation before relying on
it; they were read on 2026-11-11, several from third-party notes.

- ARM64 only, in five regions. Confirm the target region before the first piece.
- An image is built from a Dockerfile and code in a zip. Lambda starts it, waits for the
  application to signal ready and snapshots memory and disk; every sandbox starts from that
  snapshot. Generate identifiers and anything unique after start, never at image build.
- Environment variables are fixed in the image. Pass the agent, session, repositories and
  credentials with the request to the sandbox's own endpoint, never through the image.
- A sandbox is terminated after 8 hours. Set an idle policy that suspends it and later
  deletes it, and let traffic resume it.
- Each sandbox has its own HTTPS endpoint and needs a token per connection, which is
  short-lived. Only the API calls a sandbox; mint the token there and refresh it.
- Outbound UDP is blocked by default, so anything that brings its own resolver, such as a
  nested container, needs Lambda's resolver address set explicitly.
- Disk size and how the execution role's credentials reach the sandbox were not confirmed.
  Measure both in the `runs` piece and record the result in the repository.
- The SDK's guidance is 1 GiB memory, 5 GiB disk and 1 CPU per agent as a floor. Bound
  every run with a turn limit: a session has no timeout of its own.

## Sessions and durability

- Configure the SDK's `SessionStore` with an object-store adapter and resume by session
  identifier. Start from Anthropic's reference adapter and run its conformance suite.
- The store mirrors transcripts only. Files in the working directory are lost with the
  sandbox; that is intended.
- Mirror writes are best-effort: the SDK drops a batch it cannot deliver and emits a
  `mirror_error` message. Alert on it and mark the session as not safely resumable.
- A turn that dies part-way leaves the run `FAILED` with the transcript up to the last
  mirrored batch. The retry is a new run in the same session.

## Model access

- **Bedrock.** Call through the stack's own tagged application inference profile per
  supported model, as Inference does, so spend carries the product tag. Never use a bare
  model identifier.
- **A person's Claude plan.** See below.
- The credential for a run is a setting on the `claude` process, chosen by the API from the
  caller and the entrance. Claude Code prefers a cloud provider setting, then an API key,
  over a subscription sign-in, so start a plan-mode process with none of those set and
  verify which credential was used before reporting the piece done.
- Never fall back from one to the other. A direct run by a person who has not linked a
  plan stops with a link prompt.

### Claude plans

Anthropic permits an end user to sign in to the unmodified Claude Code binary with their
own Claude subscription, including where a platform hosts Claude Code, and forbids a
developer from collecting, storing or intermediating Claude.ai credentials. Read
[Anthropic's legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance)
before building or changing this piece and stop if its conditions have changed.

- Run the `claude` binary exactly as Anthropic publishes it. Remove or restrict no sign-in
  method.
- Linking starts the binary's own login. The person signs in on Anthropic's site and the
  binary writes its own sign-in files. Never ask for, accept or store a token the person
  generated elsewhere, and never show or log the sign-in files.
- Keep each person's sign-in directory encrypted, declared to Access as a resource type
  private to its owner. Administrators and the environment key get its metadata and
  removal, never its use.
- A plan is used only by runs its owner started. Asana and service-identity runs never use
  a person's plan.
- Unlinking removes the stored directory and signs the binary out.
- The first increment of this piece proves three things in a sandbox: a login completes,
  it survives a replaced sandbox, and it refreshes itself. Stop and report if any fails.

## Trace and usage

- Write the trace to Persist with the record types this kit's session hooks already use:
  `agent`, `agent_prompt_version`, `agent_thread`, `agent_turn` and `agent_message` with
  their edges. Read `hooks/agent-memory/memory.mjs` in this repository for the shapes and
  redaction, and confirm them against the installed lexicon.
- The prompt version is the agent's name, version and content digest, so a prompt change
  can be compared across runs.
- Take token counts and cost from the SDK's result messages and tool activity from its
  message stream. Add an OpenTelemetry collector only when a named question needs it.
- Token and cost fields on the trace, and a client value for Enact, are Model decisions.
  Route them to `dialga`; serve usage from the ledger meanwhile.
- A failed trace write never fails the run. Queue it and retry.

## MCP endpoint

One endpoint under `enact`. Its tools list agents, start a run, send a message to a session
and read a run. Each maps onto one API route and adds no behavior. Follow the current MCP
authorization specification for discovery; the tokens are Access tokens.

MCP clients register themselves and sign in through a redirect to a local port. Access as
specified signs in registered applications with exact redirect addresses. Verify this
against the deployed Access; where it does not fit, hand `aegislash` a reproducible example
and keep testing with the environment key.

## Repositories

- Use one GitHub App installed only on repositories agents may use. Keep its private key in
  the stack's secret store; it never enters a sandbox.
- The API mints an installation token limited to the run's repositories and the permissions
  the manifest names, and sends it with the turn. Mint a fresh one for every turn and
  resume: the token lasts an hour.
- Agents clone, branch, push and open a pull request. Never merge and never push to a
  default branch.
- Name the caller as co-author on commits and in the pull request. For an Asana run, name
  the person who made the mention.
- A repository outside the agent's list is refused at save time and again at run time.

## Asana channel

Use `@soofi-xyz/chat-adapter-asana` and its CDK construct for ingress, as
[the AI-agent skill](../build-ai-agents/SKILL.md) describes. The channel only translates:
a mention becomes a run, a later comment the next message of the same session, the result a
comment. It calls Enact as a service identity and runs on Bedrock. Keep one bot user per
environment, and do not rebuild Kirlia's own webhook.

## Build each feature piece

1. Select and order the capability map's pieces; scope a fix to the pieces it touches.
2. Implement only that piece, test first, with the model, Persist, Access, GitHub and the
   sandbox service faked. Keep a fake-model sandbox test that runs the real image locally.
3. Regenerate the API description when routes change and synthesize strictly.
4. Install through Marketplace and Deploy into the user's test account. Give one API
   invocation, the expected result and at most three AWS inspection steps from the
   capability map; wait for the user's redacted run id and observation.
5. Open the PR and work it until checks and reviews are clean; the user merges.

Return changes, API examples, automated results, deployed evidence, AWS observations,
cleanup and remaining gaps. Keep local tests, fake-model runs and real-model runs distinct.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md).
Agents are delivered as bundles once Build has a kind for them and Deploy an adapter. Keep
the agent save semantics an adapter needs: created, updated, unchanged with an identical
read-back, and a conflict for changed content under a saved version. Route the Build kind
to `tinkaton` and the adapter to `corviknight` with the agent API contract.

## Shared API domain

For API infrastructure, packaging, review or installation, read and apply
[the shared API domain contract](../guide-product-work/reference/shared-api-domain.md).
Enact maps `enact`, attaches its stage to the shared usage plan and declares a public route
only where a piece requires one, such as MCP discovery.
