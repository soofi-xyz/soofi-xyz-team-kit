# Kadabra Communication Ontology

Use this rule to keep Kadabra aligned with the communication-organization model.

## Core Principle

Kadabra is the builder for the communication service.

Kadabra is not:

- the daily runtime
- a one-off migration script
- a single monolithic agent that directly does every specialized task

Kadabra should take a native business request, understand the organization ontology, choose the reusable communication capabilities needed for that request, and build the final runtime service.

## Three Layers To Keep Distinct

Always preserve these layers:

1. **Builder layer** - Kadabra interprets the business goal and decides what to build
2. **Reusable capability layer** - top-level communication agents/skills that solve stable subproblems across channels
3. **Runtime layer** - the deterministic workflow/service that executes the communication process every day

Do not merge those layers together unless there is a very strong reason.

## Stable Reusable Capability Inventory

### [`wigglytuff`](../../wigglytuff/)

Wigglytuff owns the template system itself:

- template CRUD
- template metadata
- active/inactive state
- family/variant organization (when the channel actually has one)
- GitHub-backed template source of truth
- synchronization from an operational template source into GitHub

Template sync is part of Wigglytuff. It is not a separate lower-level agent.

Wigglytuff is channel- and store-agnostic. Channel-specific details — the
operational source (Postgres, Snowflake, vendor API, file), the real column
names, the derived fields, the runtime contract shape, the target GitHub
repo — live in the per-instance golden prompt that Kadabra uses to invoke
Wigglytuff. They do not live in this skill.

### [`xatu`](../../xatu/)

Xatu owns the audience boundary:

- which population enters the communication process
- how eligibility handoff is represented
- how the runtime receives the filtered candidates it is allowed to optimize

For SMS, Xatu is the bridge between upstream filtering and the runtime's `input_s3_uri` intake.

### [`chatot`](../../chatot/)

Chatot owns the activity loop after the audience is chosen:

- provider/channel configuration
- routing and contact-point rules
- send-file contract
- execution handoff
- delivery status updates
- response and feedback ingestion
- activity-state closure

Dispatch and feedback should stay together at this abstraction level. Do not split them into separate lower-level builder agents unless there is a strong justification.

### [`oranguru`](../../oranguru/)

Oranguru owns assembly of the final runtime:

- compose the audience, template, and communication-activity capabilities
- implement the deterministic worker that runs the service
- keep runtime contracts explicit
- keep the runtime reproducible from Kadabra's prompt and knowledge base

The runtime may be implemented with Step Functions, Lambda, Glue, or similar deterministic systems. That runtime is the product Kadabra builds.

## Channel-Agnostic Bias

Prefer reusable communication capabilities that can work for SMS and email with only channel-specific adapters.

Examples:

- Jigglypuff should manage templates in a way that generalizes beyond SMS
- Xatu should define audience handoff patterns that can feed more than one channel
- Chatot should model communication activity management generically, even if the provider adapter is SMS-specific today

Only keep behavior SMS-specific when it is truly channel-specific:

- Quiq invocation details
- SMS contact points and routing
- SMS legal send hours
- SMS message rendering constraints

## Golden Prompt Contract

The golden prompt is the main artifact Kadabra produces and maintains.

At minimum, the golden prompt should specify:

- the business objective
- the source of the audience
- the source of templates
- the GitHub repo or persistence target for templates
- the runtime entrypoint and external contract
- the provider and send workflow contract
- the required outputs and feedback loop
- deployment and safety constraints

The prompt should be versioned and refined continuously as defects or missing behaviors are discovered.

## Rebuild-From-Scratch Standard

Kadabra is correct only when the prompts and knowledge base are strong enough that the service can be rebuilt from scratch without hidden tribal knowledge.

Quality bar:

- prompts are stored in the repo
- important ontology decisions are stored in the repo
- fixes improve the prompts and rules, not only the generated code
- deleting the generated implementation and rerunning the prompt should materially reproduce the same architecture and behavior

## Review Expectations

When reviewing Kadabra or a service Kadabra built, verify:

- builder vs runtime separation is still explicit
- reusable capabilities are still recognizable and not collapsed together
- template sync still belongs to Jigglypuff
- communication dispatch and feedback still belong to Chatot
- detailed runtime rule ownership stays with Oranguru, not Kadabra
- the runtime remains deterministic and contract-driven
- the golden prompt stays aligned with the implementation
