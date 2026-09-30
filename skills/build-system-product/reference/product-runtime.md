# System runtime mapping

Use System as the current product and `/system` as the reported Prism base path.
Discover the actual deployment and caller contract. Historical implementation
[evidence](implementation-evidence.md) explains the origin of the configuration
shape; it does not certify the current runtime.

| Concept | Responsibility |
| --- | --- |
| Named definition and schemas | Establish an outcome's inputs and outputs. |
| Flow template | Define reusable orchestration compiled to Step Functions. |
| Flow | Bind a template and its supported configuration. |
| Waterfall | Order alternative flows; it is not the steps within a template. |
| Invocation | Execute and correlate the configured outcome. |

Zygarde owns the compiler and execution framework. Celebi authors configurations.
Keep engine fixtures with the builder and particular business mappings with
configurers. Preserve exact supported wire fields from the target revision.

Do not bring back the old default connector pipeline, unrelated Product features,
or a deferred custom microservice in place of the System framework. When a
capability is missing, identify the gap and route it to Zygarde.
