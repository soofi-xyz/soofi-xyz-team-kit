# System configuration emits

Emit artifacts into the user's target repository and preserve its actual runtime
wire contract. These review shapes are not automatic HTTP payloads.

| Kind | Content | Configuration owner |
| --- | --- | --- |
| `product-definition` | Named outcome and input/output schemas | Celebi |
| `product-flow-template` | Named reusable template definition | Celebi |
| `product-flow` | Named flow with required `flow_template_name` | Celebi |
| `product-waterfall` | Ordered references to emitted flows | Celebi |
| `product-invocation` | Request fixture and expected result | Celebi |
| `lexicon-catalog` | Registered language/mapping references used by Transform | Silvally |
| `connect-partner`, `connect-activation` | Supported partner configuration and disabled activation | Wingull |
| `transform-request`, `transform-mapping` | From/to locations and governed mapping | Silvally |
| `persist-ingest` | Supported graph ingest fixture/configuration | Uxie |
| `deploy-environment` | Inactive environment prerequisite | Unassigned; reference only |

Use `emits/product/` for compatibility with existing package layouts. Preserve
names and schemas from the verified target service; catalog naming alone is not
a reason to break existing callers. Keep `activationEnabled: false` in kit examples.

Apply and test through the target product's supported interface. Hand missing
runtime behavior to its builder. Do not have the configurer implement compilers,
data stores, adapters or deployment engines as part of the configuration.
