# System product scope

Build **System**, the reusable orchestration service. Zygarde owns its engine;
Celebi configures business outcomes. The supplied 2026-09-30 comparison maps
Staircase Product to Prism System and describes a TypeScript/CDK service under
`/system`. Verify the target repository before asserting any deployed capability.

## Scope

Include named definitions, input/output schemas, reusable flow templates compiled
to Step Functions, template-backed flows, optional waterfalls and invocations.
Include correlation, telemetry, retries and failure reporting required to run
those flows. Every executable flow must specify `flow_template_name` or the
verified equivalent field in the target contract.

Exclude reports, SMS, email, blobs, widgets, short links, partner ordering and
marketplace packaging from this version. Historical Product features are not
implicit requirements. Product-shaped wire fields can remain for compatibility;
those fields do not create a separate Product service in the catalog.

## Boundaries

System orchestrates; leaf products perform their own work. Use Connect for
external exchanges, Transform for conversions, Persist for graph storage and
Rule for evaluation. Keep Model's vocabulary and unassigned products explicit
as dependencies. Do not invent a new Spark engine or one-off Lambda pipeline
when the framework lacks a capability; fix System through Zygarde.

## Guided build and definition of done

1. Explain one outcome and show the product boundaries in a small diagram.
2. Derive usable feature increments and their dependencies from
   [the System capability map](../../guide-product-work/reference/iterations/system.md).
   Keep at least four for a full build; do not treat that floor as the target count.
   Demonstrate the relevant [mock scenario](mock-scenarios.md) for each increment.
3. Build only that iteration's framework capability and configure a runnable
   example on it. Compile templates instead of hard-coding each example pipeline.
4. Have the person invoke that configuration, inspect its Step Functions state
   and correlated logs, and explain the result. Fix/retest the current piece and
   wait for this feedback before implementing the next iteration.
5. Cover every selected feature with configuration variants and failure/recovery
   cases. The scenario pack's four configurations cover only part of System;
   add cases for missing capabilities and record each feature's checkpoint.
   Rerun cumulative acceptance; early PoCs alone do not prove framework behavior.
6. Introduce real services when the mock suite passes and the integration is in
   scope. Report real leaf readiness independently of framework acceptance.

Configuration validation, local fixture checks, CDK synthesis, deployed mock
acceptance and real integration are distinct outcomes. A configuration with
`verify: deferred` can be a valid draft but cannot substantiate completion.

The kit's [composition contract](contracts.md) is a review artifact, not the
System HTTP request schema. Use the actual target service contract when applying
it. Preserve backward compatibility deliberately; do not blindly rename deployed
fields when normalizing catalog terminology.
