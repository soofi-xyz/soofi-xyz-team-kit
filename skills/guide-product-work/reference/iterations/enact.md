# Enact capability map

Apply [stable stack identity](../../../build-product-deployer/reference/stack-identity.md)
to synthesis, review and installation: one stack, `Enact`, with no deployment stage,
installed through Marketplace and Deploy and updated in place.

Use Zoroark to implement Enact and Zorua to add or change an agent on an existing
deployment. Follow the [shared workflow](../../SKILL.md). These 12 areas are a starting
inventory, not a fixed iteration count. Order dependencies and split independently useful
features further. Use at least four pieces for a full-product build; narrow work selects
only relevant pieces. Keep automated tests and user/AWS feedback inside each piece, not as
a final testing phase.

Enact runs Prism's agents behind one MCP interface so an agent behaves the same whether a
person drives it from a coding agent, Asana drives it from a mention, or another surface
calls it. An **agent** is a directory of files. A **run** is one request to an agent. A
**session** is the conversation a run belongs to and can be continued later. Every run
records what was said, which tools were called, and how many tokens it used.

```text
person in a coding agent ─┐                      ┌─ model: the caller's own Claude plan
Asana mention ────────────┼─ Access ─ Enact API ─┤                    or Bedrock
any other surface ────────┘   (who)   (/enact)   └─ sandbox: one per session
                                          │              │
                                     runs ledger    transcript copy, Persist trace
```

## Product boundaries

| Product | What it owns here |
| --- | --- |
| **Enact** | Agent definitions, runs, sessions, the sandbox image, the MCP endpoint, each person's linked Claude plan, the repository tokens a run uses, the Asana channel, and writing the trace. |
| **Access** | Who is calling and whether they may run or manage an agent. Sign-in from MCP clients is an Access capability; Enact only verifies the token. Route gaps to `aegislash`. |
| **Persist** | Storing and querying the trace. Enact writes through Persist's ingest API with its own service identity and reads nothing back to run an agent. |
| **Model** | The record types of the trace. Enact reuses the agent-memory types this kit's session hooks already write; any new field or type is a Model decision for `dialga`. |
| **Build, Deploy** | Packing an agent directory into a bundle (`tinkaton`) and installing it through Enact's API (`corviknight`). |
| **Connect** | Nothing yet. Partner credentials an agent's tools need stay in Connect and are reached through its API. |

## Capabilities

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `agents` — save, version and read an agent definition | Shared API domain and key | Deliver create-or-replace by name, read, list and versions for an agent: its manifest, instructions, tools, skills and subagents. Versions are immutable. Exercise a first save, an unchanged save, a new version, changed content under a saved version (refused) and an invalid manifest (unknown field, missing instructions, a repository outside the allowed list). | Read the stored definition and version items; confirm a refused save wrote nothing and the API executed no agent code. |
| `runs` — start a run and follow it to a result | `agents`; model access through the stack's own tagged inference profile | Deliver submit (`202` with a run id), status and result. One sandbox per session; the agent loop runs inside it. Exercise a run that answers, a run that calls a tool, a run that exceeds its turn limit and a run on an unknown agent. | Follow the run in the ledger and the sandbox's logs; confirm the sandbox started from the image, called the model through the tagged profile and was released. |
| `sessions` — continue a conversation later | `runs` | Deliver sending another message to a session, idle suspend, resume of a suspended sandbox, and resume on a new sandbox from the stored transcript. Exercise a second message while warm, one after suspend, and one after the sandbox was deleted. | Read the session's sandbox history in the ledger and the transcript object; confirm the third case started a new sandbox and the agent still knew the earlier turns. |
| `trace` — find where a run got stuck | `runs`; Persist ingest; Enact's service identity | Deliver the trace in Persist: agent, prompt version, thread, turn and each message, tool call and tool result, with secrets redacted before saving. Exercise a successful run and one that fails inside a tool. | Query the thread with read-only Gremlin; confirm the failed run's last record is the failing tool call and no secret value was stored. |
| `usage` — see tokens, cost and duration | `runs` | Deliver input, output and cache token counts, cost, turns and duration per run and per session through the run API, attributed to the caller and the agent. Exercise two runs by different callers and a session with several turns. | Compare the run's counts with the model invocation metrics for the profile; confirm the caller and agent are recorded. |
| `mcp` — drive every agent through one MCP endpoint | `runs`, `sessions` | Deliver one MCP endpoint whose tools list agents, start a run, send a message to a session and read a run. Each tool maps onto the run API and adds no behavior. Exercise it from two different MCP clients. | Confirm an MCP call and the equivalent API call produce the same ledger record. |
| `sign-in` — only the right people run an agent | `mcp`; Access tokens and grants; Access accepting sign-in from MCP clients | Deliver token verification on every route, the `agent` resource type with `run` and `manage`, the caller recorded on each run, and the environment key as an administrator-level non-human caller. Exercise a person with a grant, a person without one, a service identity and an expired token. | Read the ledger's caller for each run; confirm the refused calls started no sandbox. |
| `claude-plan` — a person runs agents on their own Claude plan | `sign-in`; the conditions in the build skill | Deliver linking (the person signs in through Anthropic's own flow), status, unlinking, and runs by that person using their plan. A person who has not linked gets a link prompt, never another credential. Exercise link, a run, a run after the sandbox was replaced, unlink, and a run by a second person. | Confirm the stored sign-in is encrypted and readable only for its owner's sandbox, that no model call for these runs reached Bedrock, and that no credential appears in logs or the trace. |
| `repositories` — work in code and open a pull request | `runs`; the Enact GitHub App installed on the allowed repositories | Deliver a repository list per agent, a short-lived token limited to the run's repositories, clone, branch, push and pull request, with the caller named as co-author. Never merge. Exercise one repository, two repositories, a repository outside the agent's list and a session resumed after the token expired. | Read the token request in the API logs (repositories and permissions, never the token); confirm the pull request's author and co-author. |
| `asana-channel` — start a run from an Asana mention | `runs`, `sessions`, `sign-in`; an Asana bot user | Deliver a channel that turns a mention into a run on Bedrock and a reply into the next message of the same session, calling Enact as a service identity. Exercise a mention, a follow-up comment and a duplicate webhook delivery. | Follow the webhook to the run in the ledger; confirm one run per mention and the model call on Bedrock. |
| `agent-bundles` — install agents from a configuration bundle | `agents`; a Build kind and a Deploy adapter for Enact agents | Keep the save semantics a GET, PUT, GET adapter needs (created, updated, unchanged, conflict). Exercise a bundle install, an unchanged re-install and a new version with unchanged service code. | Read the Deploy run result and the agent through the API; compare the installed version and digest with the bundle. |
| `egress` — limit where a sandbox can connect | `runs` | Deliver an allow-list for outbound connections from sandboxes, per environment and narrowed per agent. Exercise an allowed host, a refused host and a tool that needs a newly allowed host. | Read the network path's flow logs for the refused connection. Required before agents work in repositories with sensitive code. |

## Status

This table is the kit's only record of what exists; the agents and skills link here.
Update it when a piece lands, and check it against the target revision and environment
before relying on it.

| Piece | State (2026-11-11) |
| --- | --- |
| Design | Agreed with the product owner on 2026-11-11; the decisions are in [the build skill](../../../build-enact-product/SKILL.md#decisions). |
| Repository | None recorded. Ask where to create it before the first piece; other products live at `prismteam-ai/<product>`. |
| Every capability above | **Planned.** Nothing is built, published or installed. |
| Access sign-in from MCP clients | Not verified against a deployed Access. Until it exists, people cannot sign in from a coding agent; use the environment key for tests. |
| Trace record types | The agent-memory types exist in the Persist graph the session hooks write to. Token and cost fields, and a client value for Enact, are open Model decisions. |
| Build kind and Deploy adapter for agents | Merged (2026-11-13): product `enact`, kind `agent`, see [Enact agent payloads](../../../build-product-deployer/reference/configuration-bundles.md#enact-agent-payloads). Deploy adapter prismteam-ai/deploy#85, published to Marketplace from `main` `7a19829`; Build kind prismteam-ai/build#57 (`main` `333d328`). Not verified as installed on dev; no bundle install has been exercised. |
| Existing agents (Eevee, Kirlia) | Not migrated. They keep running where they run today. |

Exercise each piece through the HTTP API, including submission (`202`), status and results
for runs. The MCP endpoint and the Asana channel sit on that API; they do not replace it
as the acceptance surface. Direct AWS inspection supports evidence; it does not replace
API use. Give one invocation and at most three AWS inspection steps, collect the person's
redacted run id and observation, and wait for that feedback before implementing or
configuring the next piece. Keep local tests, synthesis, runs against a fake model and runs
that call a real model distinct. A real run costs money or uses a person's plan; start
runs only within the requested scope.

Apply [the configuration-bundle contract](../../../build-product-deployer/reference/configuration-bundles.md)
when an agent is installed from a bundle, and
[the shared API domain contract](../shared-api-domain.md) within the relevant pieces:
base path `enact`, the shared usage plan, and no public routes unless a piece names one.
