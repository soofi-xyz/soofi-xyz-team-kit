---
name: configure-console-product
description: "Submit Figma-to-HTML/React creation/edit jobs and configure applications through an existing Console API and runtime. Use Vivillon for routes, layouts, themes, components, product bindings, actions, access policies, refresh and rollback; route reusable runtime gaps to Chandelure."
---

# Configure Console

Use `vivillon`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Console capability map](../guide-product-work/reference/iterations/console.md).
Read the relevant [product contract](../build-console-product/reference/PRD.md) and
[synthetic test data](../build-console-product/reference/test-data.md).

For creation or modification of components, read [the authoring contract](../build-console-product/reference/component-authoring.md).
Verify the deployment has completed the authoring contract’s client registration
checkpoint. Connect the user through its supported OAuth flow; route missing
Console client approval/registration to Chandelure. Do not reuse editor credentials.
Use only existing API operations to select create/edit, HTML/React, Figma nodes,
repository revision and scoped paths; retrieve status/results and verify the
source/diff, preview and executed tests. Do not edit the engine or silently fall
back to running a local coding agent when the service lacks this capability.

1. Discover the existing Console deployment/revision, supported schema and API,
   authentication, selected AWS profile, account and region. Separate required,
   implemented and observed capabilities. Do not guess routes or component support.
2. Select the requested capability pieces and dependencies. Explain each with a
   synthetic application. Use a baseline, a materially different supported
   application, invalid/unauthorized input and relevant refresh/rollback cases
   inside each piece; use four as a full walkthrough floor, not a fixed count.
3. Author routes, layouts, themes, supported components, typed data/action
   bindings and access policies. Validate and publish them through the existing
   Console API, verify the immutable digest and read back the selected revision.
   Never embed credentials or arbitrary JavaScript in configuration.
4. Use only verified public contracts for Account identity, Model view definitions
   and resolved compositions, Persist queries and System actions. Verify route,
   component and action authorization server-side. Do not write product databases
   or bypass an owning product's API.
5. Verify a Model network begins at the declared top vertex, preserves canonical
   identities and distinguishes base and extension concepts. A missing composition
   resolver, query, component or compatibility rule remains pending and is handed
   to `chandelure` or the owning upstream builder with a redacted reproducer.
6. Give the user one copyable API invocation, expected result and at most three
   steps to inspect the hosted application, selected digest and correlated logs.
   Have them run two different applications on the same runtime, inspect the
   result and return redacted IDs and observations before advancing.
7. Verify a published configuration refresh without rebuilding the runtime, then
   roll back to the prior immutable revision. Keep schema validity, deployment
   health and upstream readiness as separate evidence.

Return configuration artifacts, selected versions/digests, API and browser
results, automated and user/AWS evidence, cleanup and builder handoffs.
