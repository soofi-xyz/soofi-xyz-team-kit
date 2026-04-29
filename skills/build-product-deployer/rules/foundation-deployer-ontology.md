---
title: Deployer Ontology
impact: HIGH
tags: [ontology, terminology, foundation]
---

# Deployer Ontology

| Term | Definition |
| --- | --- |
| **Deploy intent** | The tuple `(component, version, env_slug, base_path?)` that the marketplace enqueues onto the Deployer's SQS queue. |
| **Environment context** | The canonical strongly-typed object the Deployer injects into every product's CDK app via the `marketplaceContext` CDK context key. |
| **Adapter** | The mechanism that actually applies CloudFormation in the target account. One of `stackset`, `assume-role-cfn`, or `cdk-pipelines-bootstrap` (bootstrap-only). |
| **`MarketplaceProduct` construct** | The CDK construct from `@marketplace/product-sdk` that every product extends to wire context, tags, and standard outputs. |
| **`IMarketplaceProduct` interface** | The TypeScript interface a product MUST satisfy to be deployable by the Deployer. |
| **Component manifest** | A `marketplace.json` file at the root of a component bundle declaring `componentName`, `adapter`, `basePathRequired`, `identityRequired`, and `contextSchemaVersion`. |
| **Parameters digest** | `sha256` of the canonical JSON of the CFN parameter set used in a deploy; recorded in `Deployments` for change detection. |

## Rules

1. **A product is a CDK app.** Not a Helm chart, not a Pulumi program, not raw CFN. CDK only.
2. **A deploy intent is the only input** to the Deployer. There is no "build a product from source" path.
3. **`marketplaceContext` is the one and only CDK context key** the Deployer sets. Products MUST NOT define their own context keys with the same name.
4. **Component manifest is part of the registered artifact.** Producers can change it only by registering a new version.
