---
name: guide-product-work
description: "Build or configure a product in usable feature increments derived from its scope and dependencies. Require a user-run configuration, AWS inspection and feedback after every increment. Use with every product builder and configurer."
---

# Guide Product Work

Use [the product catalog](reference/product-catalog.json) for product names and
builder/configurer assignments. Use the user's current instructions when they
explicitly change an assignment or the level of guidance. Naming a builder as
the entry point for a configuration request does not itself reassign ownership:
explain the boundary and use that product's configurer. Do not invent a new product to
name an implementation detail. Treat an unassigned product as an ownership gap,
not permission to use a general platform agent.

## Choose the role

- **Build:** change the reusable product implementation, fix an engine defect,
  or add a capability unavailable through configuration.
- **Configure:** create or change a particular use of the existing product,
  using its supported configuration surface. Include configuration validation
  and tests. Do not change the engine to make a configuration pass.
- Discover the repository, revision, environment and existing deployment from
  available evidence. Keep requirements, implemented behavior, and observed
  runtime results separate. An agent assignment does not establish deployment.
- Route a missing capability to that product's builder with a reproducible
  example. Continue independent configuration work but do not fabricate support.
- Reuse shared engineering skills and retained specialists when their scope fits.
  Discover installed agents from `agents/`; the README features only the product
  roster. A retained specialist does not replace the catalog's product owner.
- Read only reference sections relevant to the requested lane. A reference's
  build/deploy procedure does not authorize those actions during a test-only or
  configuration task. Reuse supplied facts and existing authorization when a
  supporting skill asks for information or approval already established.

## Derive pieces from product features

Load the product's `iterationGuide` from the catalog. Treat it as a capability
map, not an exact iteration count or a mandatory expansion of the user's scope.
Discover what exists, identify the requested missing/changed capabilities and
order usable increments by their dependencies. Explain the product with one
input/output example and a small diagram, then present the scoped feature plan.

Define each piece by a user-visible capability: “ingest a bulk file”, “configure
a trigger”, or “run a fallback flow”. Deliver the minimum implementation,
configuration, diagnostic output and deployment needed to use that capability
end to end. Split a piece that contains independently useful features, different
drivers/formats, or several concepts the person cannot inspect in one sitting.
Combine internal modules needed for one usable path; schemas, Lambda code, CDK,
tests and documentation are not automatically separate product pieces.

For a full product build or full product configuration walkthrough, retain
**at least four feature increments as a floor, never a target or maximum**.
The feature inventory determines the actual count, which may grow as dependencies
are discovered. Do not compress a product into four broad buckets or invent
features to reach a number. A scoped fix or configuration request uses only the
relevant capabilities and may need fewer pieces. Do not rebuild completed features
or create unrelated resources to pad the plan. Builder and configurer plans need
not have the same count: one implements capabilities, the other selects supported
configurations needed for the requested outcome.

Give each piece a stable feature ID, dependencies, a concrete usable result,
configuration variants, expected outcomes and its AWS inspection checkpoint.
Record a reason for splitting, merging, omitting or deferring mapped features.
Do not merge independently useful capabilities merely to reduce interactions.
Use `Piece i/N` with the current planned total; preserve IDs/evidence when changing
the order or count. For a capability missing from the map, add it to the scoped
plan after verifying that it belongs to this product and the authorized task.

Include a baseline, a materially different supported configuration and appropriate
negative/recovery cases **inside each feature's tests**. A corrected input,
repeated request, test-only rerun or final review is not another implementation
piece. Add a separate piece for recovery only when implementing a distinct
user-facing capability, such as configurable retry policy or replay control.
For a fixed configuration with no meaningful alternative, explain that boundary
and vary supported inputs without inventing a configuration surface. Pure
test-only requests exercise existing features without claiming implementation.

Repeat this loop for **each** iteration:

1. **Explain:** name the next usable piece, configuration change, expected result
   and one observable acceptance check. Demonstrate unfamiliar behavior with a
   small example or mock before implementing it.
2. **Implement and test:** change only this piece and run focused checks. Make
   this increment runnable in the authorized test environment. Add/discover
   correlation IDs and diagnostic output needed to inspect it. Keep later
   implementation pieces pending.
3. **Have the person use it:** give one copyable invocation and a small payload
   or fixture path. Have them run it and try the named configuration variant.
   Agent-run tests support this step; they do not replace the person's attempt.
4. **Guide AWS inspection:** provide the verified account/region, actual resource
   names and links, and at most three inspection steps using
   [the AWS inspection guide](reference/aws-inspection.md). Point to the exact
   execution/state and correlated logs, say what to look for, and distinguish
   success, expected rejection and unexpected failure.
5. **Collect feedback and close:** ask for the request/execution ID and one or
   two sentences about the output and named state/log event. Check that evidence
   against the expected result. Fix misunderstandings or defects and repeat the
   current check before advancing. Record cleanup and the accepted outcome.

**Stop before implementing the next iteration until the person has run the
current one, inspected AWS and supplied the requested observation.** A generic
"continue", silence, a local test pass or an agent-written summary is not that
observation. Ask only for the missing evidence; do not repeat completed steps.
While waiting, continue current-iteration diagnostics or harmless preparation,
but do not prebuild later iterations, even in another branch or subagent.

Keep each handoff concise: `Piece i/N — feature`, `Run`, `Expect`,
`AWS: open → inspect → compare`, `Reply with`. Resolve command arguments and
resource names from the environment; do not hand the person unresolved
placeholders or a wall of AWS instructions. Never ask them to paste secrets or
sensitive payloads. Keep existing deployment and production authorization rules.

Do not infer a shortcut from expertise, urgency, a narrow fix or "do the rest".
Only an explicit user instruction changing the iteration/checkpoint requirement
can override it; record the change and omitted evidence. Explanations and
read-only inspections are not implementation assignments. Resume previously
verified pieces instead of restarting the feature plan after every interruption.

## Keep progress visible

Maintain one row per iteration in the target repository or conversation:
iteration, stable feature ID, usable increment, dependencies, configuration/version, status, automated checks,
user-run request/execution ID, AWS resource/log reference, expected/actual result,
the person's observation, correction/cleanup and next step. Use `pending`,
`prepared`, `observed`, and `verified`. Mark `verified` only after the user's run,
AWS inspection and acceptance comparison. An unavailable environment, missing
log access or unsupported feature leaves the relevant checkpoint pending;
explain the concrete access or builder dependency instead of claiming completion.

For System, assign the mock scenario cases to the features they demonstrate in
[the System capability map](reference/iterations/system.md). Scenario/configuration
counts do not determine the implementation count; add cases for uncovered features.
Demonstrate the relevant orchestration, then run it on the actual framework
increment before building the next piece. Rerun cumulative acceptance at the end.
Configuration validity, local fixture checks, infrastructure synthesis, a
deployed mock execution, and a real integration are different evidence levels.

## Return

State the product and role, what the person can now do, changes and evidence,
current iteration/checkpoint, remaining gaps, and the next concrete step. Keep secrets out of
the progress record. Use the selected AWS profile and verify account and region
before environment changes; never embed an individual's profile or environment
as the reusable default.
