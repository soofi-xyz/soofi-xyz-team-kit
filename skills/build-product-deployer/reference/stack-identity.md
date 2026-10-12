# Stable stack identity across deployment paths

Apply this contract to product source, Build, Marketplace review, Environment
installation and Deploy/Puller. Treat it as required behavior; verify support in
the target revision before claiming that a deployed service implements it.
Treat older source-repository stage rules as migration gaps against this contract,
not instructions to reintroduce deployment stages.

## No deployment stages

Do not introduce a stage selector or derive stack names, resource names, CDK
construct paths, configuration namespaces or bundle identity from `dev`, `prod`
or `review`. Use explicit target account and region for deployment scope. Keep
product configuration separate from stack identity. Do not rename existing AWS
resources merely to remove a legacy suffix; retain their deployed identity.
Existing API Gateway paths or service resource names containing a stage remain
connection/discovery facts until migrated, not a bundle naming convention.

Use the same stable stack names, construct paths and resource logical IDs for
direct product deployment and Marketplace-built assemblies. Keep multiple stacks
per product distinct with stable product/component identities. Do not include
bundle versions or the delivery channel in those identities.

## Build and Marketplace

- Synthesize without injecting `stage=review` or another deployment stage. Make
  the security scan and Build use the same identity rules and source revision.
  Remove stage selection from packing/provenance contracts; migrate legacy
  `packedStage` and `cloud_assembly.packed_stage` requirements together with
  their consumers. Preserve source, artifact and asset digest verification.
- Review the exact immutable bundle in an isolated review account with the same
  stack identities used for installation. Isolate by account/region and verified
  ownership, never by adding a suffix or rewriting the reviewed artifact.
- Validate identity compatibility rather than rejecting names containing legacy
  stage segments. Prevent review from targeting the Marketplace/Build/Deploy
  control-plane stacks. Inspect existing review stacks and ownership before
  updates or cleanup; clean up only resources owned by the review operation.
- Hand Build/scan gaps to Tinkaton, Marketplace review gaps to Regigigas, and
  differences between direct and bundle templates to the product's builder.
  Report unsupported behavior; do not patch zips or bypass review to conceal it.

## Update existing installations

1. Resolve each product stack in the selected account and region before a run.
   Match the exact stable identity, or use a verified explicit binding to an
   existing stack's name/ARN when its legacy name differs. Verify product
   ownership, template/resource compatibility and caller authority. Do not guess
   from a similar name. Reject ambiguous or unrelated matches before writes.
2. If the product was deployed directly, update that same CloudFormation stack
   through Deploy. Missing Marketplace/Puller history does not mean the stack is
   absent. Create only when no matching existing stack or explicit binding exists;
   a missing explicitly bound stack is an error, not permission to create another.
3. Preserve the stack ID, resource logical IDs, physical resources and data across
   the handoff. Compare templates/change sets; surface destructive replacements
   and incompatibilities. Do not delete/recreate, rename the stack or silently
   create a parallel stack to make adoption succeed. A stack-name override alone
   cannot fix changed logical IDs, resource names or references. Implement any
   needed binding through the supported Deploy contract without modifying signed
   or digested artifact bytes; an unsupported binding is a Deploy capability gap.
4. Use normal CloudFormation update/no-change behavior, dependency ordering and
   run reconciliation. Repeated installation must not create duplicate resources.
   Do not treat an update to an existing stack as resource import; separately
   plan import only when resources are outside that stack and it is in scope.
5. Keep durable product-to-stack bindings and installation history in Deploy's
   subscriber component. Pass resolved targets through the run API; do not add
   subscriber state to the stateless executor. Record prior direct deployment as
   discovered provenance, without inventing a previously installed bundle.
   Advance installed bundle identity only after terminal success; retain the
   binding and previous installed state on failure.

Environment must resolve existing stacks during initial installation and hand
those identities to Deploy/Puller. A missing adoption/binding API belongs to
Corviknight; configurers must not substitute direct stack or database edits.

## Acceptance evidence

Exercise these cases through the relevant product APIs and inspect stack results:

| Case | Required result |
| --- | --- |
| Fresh target | Create stable named stacks without a stage input or suffix. |
| Direct deployment followed by a changed Marketplace bundle | Update the same stack ARN; preserve unchanged logical IDs, physical resource IDs and representative data; create no parallel stack. |
| Existing legacy-suffixed stack | Bind explicitly and update that stack without renaming it or injecting a stage into the bundle. |
| Repeat the same bundle | Report no change/success without duplicate stacks or resources. |
| Two candidate stacks, foreign ownership, wrong account or missing bound stack | Reject before mutation with a concrete identity error. |
| Update failure or interrupted response | Reconcile the same stack; retain binding and truthful installed history. |
| Sandbox review followed by installation | Verify identical bundle digest and stack identities in separately verified target accounts. |

Distinguish required scenarios, local fakes and observed AWS evidence. A passing
kit validation does not prove live adoption or stage-free synthesis.
