# Build System through usable feature increments

Use Zygarde with `build-system-product` and `guide-product-work`.

1. Discover target repository, account/region, existing deployment and desired
   outcome. Read the current scope. Reuse session facts and authorization.
2. Explain the product boundaries and one concrete input/output example. Record
   the person's understanding and corrections before choosing the design.
3. Derive a scoped plan from [the System capability map](../../guide-product-work/reference/iterations/system.md).
   Give selected features stable IDs, dependencies, usable results and acceptance
   cases. Separate binding reuse, sequencing, branches, retries, waterfalls and
   lifecycle behavior where requested. Use four only as the full-build floor;
   let the actual capabilities and their complexity determine the count.
4. For the current iteration, demonstrate its relevant mocked scenario, then
   implement only that capability in TypeScript/CDK. Keep compilation and binding
   generic. Deploy/test that increment within existing authorization.
5. Give the person the exact invocation and configuration, expected response,
   and up to three AWS inspection steps with actual execution/log links. Have
   them run the increment, inspect its named state and correlated log event,
   then report the execution ID and one or two sentences about the result.
6. Compare that evidence, correct/retest this increment if needed, then mark it
   verified. Only now implement the next iteration by repeating steps 4–6.
7. After all selected features have verified checkpoints, run cumulative
   acceptance, including cases outside the bundled fixtures, then introduce real
   products within the authorized scope. Leave missing leaves unresolved.

Follow the shared workflow's override and resumption rules. Expertise or a
narrow task does not waive its feature checkpoints or require unrelated pieces.
Preserve previously verified features; record changes to scope and interaction.
