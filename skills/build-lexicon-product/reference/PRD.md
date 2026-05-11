# Lexicon Product - Product Requirements Document (PRD)

Authoritative blueprint for re-creating the **Lexicon** product from the reference implementation in `../lexicon`. Lexicon is the governed source of truth for graph vocabulary, ruleset data, metric definitions, and source-system mapping artifacts consumed by SOCAPITAL products.

---

## 1. Product Overview

### 1.1 Mission

Lexicon publishes the shared product vocabulary that lets independently deployed services write, validate, query, and explain the same business facts.

The core artifact is `lexicon.json`: a reviewed graph ontology containing vertex labels, edge labels, properties, required fields, enums, string formats, common patterns, and derived index declarations. The product also publishes adjacent governed data:

- ruleset catalogs used by Rules and downstream decisioning products;
- Interprose source schemas and snapshot-constrained schemas used by Translate and data-preparation jobs;
- Interprose-to-Lexicon transform SQL artifacts;
- CloudWatch metric definitions used by products that emit platform metrics;
- a read-only UI for humans to browse schemas, relationships, rules, and mappings.

Lexicon is deployed before products that depend on those artifacts. Consumers read immutable reviewed artifacts from S3 using SSM parameter names owned by Lexicon; they do not fetch arbitrary GitHub files or embed copies of the schema in their own source.

### 1.2 Primary user surface

Lexicon has two surfaces:

| Surface | Identifier | Auth | Purpose |
| --- | --- | --- | --- |
| Static UI | CloudFront distribution output `DistributionUrl` | CloudFront/S3; optional upstream access control in future | Browse graph classes, relationships, rules, and mappings from checked-in data |
| Data artifacts | S3 URIs published through `/lexicon/*` SSM parameters | AWS IAM + S3 | Machine-readable artifact contract for Persist, Rules, Translate, dashboards, and build/release tooling |

The target deployment publishes these SSM parameters:

| Parameter | Value shape | Required consumer(s) | Purpose |
| --- | --- | --- | --- |
| `/lexicon/data-uri` | `s3://<LexiconDataBucket>/lexicon.json` | Persist, Translate, validators | Canonical graph ontology |
| `/lexicon/rulesets-uri` | `s3://<LexiconDataBucket>/rulesets/` | Rules | Ruleset catalog prefix containing `index.json` |
| `/lexicon/interprose-data-uri` | `s3://<LexiconDataBucket>/interprose.json` | Translate, mapping authors | Full Interprose source schema |
| `/lexicon/interprose-snapshots-data-uri` | `s3://<LexiconDataBucket>/inteprose-snapshots.json` | Translate, mapping authors | Snapshot-constrained Interprose source schema; object key preserves the current reference spelling |
| `/lexicon/interprose-transform-uri` | `s3://<LexiconDataBucket>/interprose/` | Translate, ETL builders | SQL transform prefix with `vertices/` and `edges/` children |
| `/lexicon/cloudwatch-metrics-uri` | `s3://<LexiconDataBucket>/cloudwatch-metrics.json` | Dashboards, metric checks | Governed metric definitions |
| `/lexicon/rule-query-artifacts-uri` | `s3://<LexiconDataBucket>/rule-query-artifacts.json` | Rules/tooling | Rule query artifact metadata |
| `/lexicon/release-uri` | `s3://<LexiconDataBucket>/release.json` | Build, Marketplace, operators | Release metadata tying artifact digests to `lexicon_version_id` |

The reference implementation already deploys the first five parameters. The target product MUST also publish the metric, rule-artifact, and release metadata parameters so products that already depend on those source files can consume them through the same S3/SSM boundary.

### 1.3 Non-goals

- Lexicon does **not** persist graph facts. Persist owns graph writes, Gremlin reads, Neptune, validation execution, and candidate validation routes.
- Lexicon does **not** expose a runtime CRUD API for schema edits, rules, metrics, or mappings. Changes are reviewed source changes and ship as product releases.
- Lexicon does **not** own partner ingestion, translation execution, or source-system credentials. Translate and data pipelines consume Lexicon artifacts; they own execution.
- Lexicon does **not** own the Main Dashboard. It owns the metric registry that dashboard changes must reference.
- Lexicon does **not** bypass Marketplace or Build compatibility checks. Release metadata is provenance and dependency input, not an alternate deployment channel.
- Lexicon does **not** mutate deployed data objects in place outside a reviewed deploy. Rollback is redeploying a previous bundle or restoring a versioned object through an operator-approved runbook.

---

## 2. Architecture

### 2.0 Architectural principles

1. **The reviewed source tree is the authoring surface.** Runtime S3 data is an output of source review, tests, Build, and CDK deploy. Operators do not hand-edit canonical S3 objects.
2. **S3/SSM is the consumer boundary.** Consumers discover artifacts through stable `/lexicon/*` SSM parameters and then read scoped S3 objects or prefixes. They do not require repository checkout at runtime.
3. **Graph data is immutable by model.** Facts that change over time are modeled as new vertices or event edges. Mutable current-state convenience belongs in declared derived indexes, not in destructive graph updates.
4. **Related entities are linked, not embedded.** Companies, phone numbers, addresses, emails, statuses, preferences, complaints, and similar concepts are separate vertices connected by typed edges.
5. **Rulesets are data, not Rules runtime code.** Rule definitions and Gremlin query files can change independently from the Rules service when they stay within the supported Rules compiler semantics.
6. **The UI is read-only.** The viewer renders checked-in artifacts and never becomes a schema editing or approval workflow.
7. **Release identity is explicit.** A Lexicon release has a `lexicon_version_id` and content digests for every published artifact group. Build and Marketplace compatibility checks use that release identity.

### 2.1 Stack

The target CDK app is a single tenant-local stack:

```text
bin/app.ts
`-- LexiconStack    # Static UI bucket, CloudFront distribution, data bucket,
                    # data deployments, SSM parameters, CloudFormation outputs
```

`LexiconStack` is declared in TypeScript with AWS CDK v2 and deployed with the same product command contract as other PRDs:

```text
pnpm install
pnpm cdk:synth
pnpm cdk:deploy
pnpm cdk:destroy
```

CI target repos expose `just check`, `just test`, `just cdk:synth`, and `just cdk:deploy`. The current reference implementation uses npm and Bun scripts; that is a migration gap, not the target contract.

Lexicon has no Lambda API router, no OpenAPI document, no API Gateway base path, and no Usage Plan attachment.

### 2.2 Storage

| Bucket | Retention | Purpose |
| --- | --- | --- |
| `LexiconWebsiteBucket` | Can be destroyed with the stack in non-prod; production should retain or be recoverable from Build artifact | Vite static UI assets served only through CloudFront Origin Access Control |
| `LexiconDataBucket` | Retained, versioned | Canonical data artifacts and ruleset/transform prefixes consumed by products |

Both buckets enforce `BLOCK_ALL` public access, SSL-only access, S3-managed encryption, and bucket-owner-enforced object ownership. `LexiconDataBucket` is versioned so rollback and audit can identify exactly which artifact bytes were deployed.

Target data layout:

```text
s3://<LexiconDataBucket>/
|-- lexicon.json
|-- interprose.json
|-- inteprose-snapshots.json
|-- cloudwatch-metrics.json
|-- rule-query-artifacts.json
|-- release.json
|-- interprose/
|   |-- vertices/
|   |   `-- <lexicon_vertex>.sql
|   `-- edges/
|       `-- <lexicon_edge>.sql
|-- rulesets/
|   |-- index.json
|   |-- phone-interactions/
|   |   |-- ruleset.json
|   |   `-- rules/<rule_id>/<rule_id>.{json,gremlin,sql}
|   `-- sms-interactions/
|       |-- ruleset.json
|       `-- rules/<rule_id>/<rule_id>.{json,gremlin,sql}
`-- ovid-agent-changes/
    `-- <session>/lexicon.json
```

`ovid-agent-changes/` is a reserved staging prefix for candidate Lexicon documents that Persist may validate through `candidate_lexicon_s3_uri`. Objects in this prefix are never canonical until promoted through source review and a Lexicon deploy.

### 2.3 CloudFront static UI

The UI is a Vite + React application built from the same data files published to S3. The stack creates:

- private S3 website asset bucket;
- CloudFront distribution with S3 Origin Access Control;
- HTTPS redirect, TLS 1.2 minimum, HTTP/2 and HTTP/3 enabled;
- security headers policy with CSP, HSTS, frame denial, content-type options, referrer policy, and XSS protection;
- SPA 403/404 fallback to `/index.html`;
- long cache for hashed `/assets/*` files;
- deployment invalidation for `/` and `/index.html`.

The UI must show at least:

- schema classes / vertices and required properties;
- relationships / edges with direction;
- property types, formats, patterns, enums, and deprecation state;
- derived indexes and their trigger/query metadata;
- rulesets and individual rule definitions;
- Interprose mapping and transform references;
- CloudWatch metric definitions.

### 2.4 SSM parameters and outputs

Every SSM parameter name in section 1.2 is stable and not stage-suffixed. Environment isolation comes from deploying the product into the target tenant account/region and from that account's SSM namespace.

Stack outputs include:

| Output | Purpose |
| --- | --- |
| `DistributionUrl` | Human UI entrypoint |
| `DistributionId` | Manual CloudFront invalidation |
| `WebsiteBucketName` / `WebsiteBucketArn` | Static UI asset bucket |
| `LexiconDataBucketName` | Machine artifact bucket |
| `LexiconS3Uri` | Convenience output for `/lexicon/data-uri` |
| `RulesetsS3Uri` | Convenience output for `/lexicon/rulesets-uri` |
| `InterproseS3Uri` | Convenience output for `/lexicon/interprose-data-uri` |
| `InterproseSnapshotsS3Uri` | Convenience output for `/lexicon/interprose-snapshots-data-uri` |
| `InterproseTransformS3Uri` | Convenience output for `/lexicon/interprose-transform-uri` |
| `CloudwatchMetricsS3Uri` | Convenience output for `/lexicon/cloudwatch-metrics-uri` |
| `RuleQueryArtifactsS3Uri` | Convenience output for `/lexicon/rule-query-artifacts-uri` |
| `ReleaseS3Uri` | Convenience output for `/lexicon/release-uri` |

### 2.5 IAM contract

Consumers receive least-privilege access by artifact group:

| Consumer | SSM access | S3 access |
| --- | --- | --- |
| Persist | `/lexicon/data-uri` | `GetObject` on `lexicon.json` and approved candidate objects under `ovid-agent-changes/` |
| Rules | `/lexicon/rulesets-uri` | `ListBucket`/`GetObject` for the `rulesets/` prefix |
| Translate | `/lexicon/data-uri`, `/lexicon/interprose-data-uri`, `/lexicon/interprose-snapshots-data-uri`, `/lexicon/interprose-transform-uri` | `GetObject` for schema files and `ListBucket`/`GetObject` for `interprose/` |
| Build / Marketplace | `/lexicon/release-uri` when validating compatibility | `GetObject` on `release.json` |
| Dashboards / metric checks | `/lexicon/cloudwatch-metrics-uri` | `GetObject` on `cloudwatch-metrics.json` |

Lexicon itself does not grant wildcard read to every tenant runtime. Each product's CDK stack requests or receives the minimum read policy it needs.

---

## 3. Data Contracts

### 3.1 Core `lexicon.json`

The canonical document is JSON with these top-level sections:

```jsonc
{
  "vertices": [],
  "edges": [],
  "common_patterns": [],
  "company_type": "..." // current reference metadata; consumers must ignore unknown top-level keys
}
```

Consumers MUST ignore unknown top-level keys unless their PRD says otherwise. Persist validates the schema sections it enforces and must not fail because a future release adds metadata outside `vertices`, `edges`, or `common_patterns`.

Vertex definition:

```jsonc
{
  "type": "debt",
  "is_deprecated": false,
  "deprecated_properties": {},
  "description": "Represents a debt account.",
  "properties": {
    "debt_identifier": {
      "type": "string",
      "minLength": 1,
      "comment": "Stable source identifier."
    }
  },
  "indexes": {
    "debt_status_latest": {
      "type": "string",
      "enum": ["ACTIVE", "CLOSED"],
      "change_trigger": { "type": "edge", "label": "debt_status_changed" },
      "subject_query": { "gremlin": "g.E(__ID__).outV().id()" },
      "value_query": { "gremlin": "..." }
    }
  },
  "required": ["debt_identifier"]
}
```

Edge definition:

```jsonc
{
  "type": "person_owes_debt",
  "from": "person",
  "to": "debt",
  "properties": {
    "created_at": {
      "type": "string",
      "format": "date-time",
      "required": true
    }
  }
}
```

Property definition fields:

| Field | Meaning |
| --- | --- |
| `type` | Scalar or array type. Supported target values are `string`, `integer`, `number`, `boolean`, and `array`. |
| `required` | Edge-property required flag. Vertex required fields are also listed in the vertex-level `required` array. |
| `comment` | Human explanation rendered in the UI and used by reviewers. |
| `format` | Semantic string format such as `date`, `date-time`, `time`, `email`, `uri`, or `phone_number`. |
| `pattern` | Regex constraint. |
| `enum` | Allowed values. Enum values must come from real source data and use uppercase underscore form when canonicalized. |
| `items` | Array item schema. |
| `minLength` | Minimum string length. |

Derived index definitions use the same value schema fields as properties plus:

| Field | Meaning |
| --- | --- |
| `change_trigger` | The inserted graph element type and label that should trigger recomputation. |
| `subject_query.gremlin` | Query that maps the changed element id (`__ID__`) to the owning vertex id. |
| `value_query.gremlin` | Query that recomputes the final value from canonical graph history. |

Indexes are declared conveniences for analytical reads. They are not required input properties, and Persist must not require clients to submit them during ingest.

### 3.2 Modeling standards

Lexicon changes follow these rules:

1. Durable facts are immutable. A source fact changing over time is represented by adding new vertices or event edges.
2. Status changes are event edges, not overwritten properties or embedded status histories.
3. `id` and `created_at` are server-managed by Persist. If source identity or business-effective time matters, model separate source identifier and effective timestamp fields.
4. Related entities are linked through edges, never embedded as string properties when a reusable vertex type exists.
5. Status vertices and child fact vertices include the parent identifier when needed for deterministic hashing and deduplication.
6. Court location, company contact details, phone numbers, addresses, and emails are represented through reusable vertices and edges.
7. Enum values are uppercase with underscores after canonicalization.
8. New enum values must be observed in real source data before being added.
9. Existing vertex and edge types are reused before introducing a new type.
10. Derived indexes are declared on the owning vertex. The index key is the target property name, and recomputation logic lives in Gremlin metadata.

### 3.3 Ruleset catalog

`/lexicon/rulesets-uri` points at a prefix whose root contains `index.json`:

```jsonc
{
  "rulesets": [
    {
      "id": "phone",
      "label": "Phone Interactions",
      "description": "Ruleset for determining which accounts are eligible for phone interactions.",
      "version": "1.0.0",
      "manifest_path": "phone-interactions/ruleset.json"
    },
    {
      "id": "sms",
      "label": "SMS Interactions",
      "description": "Ruleset for determining which accounts are eligible for SMS interactions.",
      "version": "1.0.0",
      "manifest_path": "sms-interactions/ruleset.json"
    }
  ]
}
```

Ruleset manifest:

```jsonc
{
  "id": "phone",
  "name": "phone_interactions",
  "label": "Phone Interactions",
  "version": "1.0.0",
  "description": "Rules that decide which debts and phone numbers can be called.",
  "owner_company": "Spring Oaks Capital",
  "rules": [
    {
      "id": "no_open_dispute",
      "path": "phone-interactions/rules/no_open_dispute/no_open_dispute.json",
      "query_path": "phone-interactions/rules/no_open_dispute/no_open_dispute.gremlin",
      "order": 0
    }
  ]
}
```

Rule definition:

```jsonc
{
  "id": "no_open_dispute",
  "name": "no_open_dispute",
  "description": "Reject debts with an open dispute.",
  "filter_scope": "debt",
  "filter_type": "exclusion",
  "vertices_used": ["debt", "dispute"],
  "edges_used": ["debt_has_dispute", "debt_dispute_status_changed"],
  "legal_compliance_reference": "optional"
}
```

The `.gremlin` file stores the executable query text. The optional `.sql` file stores source-system explanation or extraction logic. Markdown notes under `rulesets/docs/` remain source documentation and are not part of the deployable ruleset prefix.

Rules currently consumes the catalog item with `id = "phone"` unless explicit `rule_s3_uris` are supplied. SMS rules are published by Lexicon but not automatically used by Rules until a consumer explicitly selects them.

### 3.4 CloudWatch metric registry

`cloudwatch-metrics.json` uses the same `vertices` / `edges` container shape as other schema-like files, but metric definitions are standalone vertices and `edges` is empty.

Each metric vertex type is the canonical metric name. Properties describe required dimensions and accepted enum values. Products that emit CloudWatch metrics must add or update this file in the same PR cycle as the runtime metric emission and dashboard display work.

The registry is the source of truth for metric names and dimensions; CloudWatch itself is an operational sink, not the registry.

### 3.5 Interprose schemas and transforms

`interprose.json` and `inteprose-snapshots.json` describe source-system schemas in the Lexicon shape so the UI and mapping tooling can render source classes with the same components used for the graph ontology.

`/lexicon/interprose-transform-uri` points at SQL assets organized by target graph element:

```text
interprose/
|-- vertices/
|   |-- debt.sql
|   |-- person.sql
|   `-- phone_number.sql
`-- edges/
    |-- person_owes_debt.sql
    |-- person_has_phone_number.sql
    `-- debt_status_changed.sql
```

Transform SQL files are explanatory and reusable source assets. They are not executed by Lexicon; data pipelines or Translate-owned jobs decide when and how to execute them.

### 3.6 Release metadata

Each deploy writes `release.json`:

```jsonc
{
  "lexicon_version_id": "01J42CH184DC48N1PY3R2YCJ9P",
  "released_at": "2026-05-11T00:00:00.000Z",
  "source_revision": "git-sha-or-build-source-hash",
  "artifacts": {
    "lexicon.json": { "sha256": "...", "s3_uri": "s3://.../lexicon.json" },
    "rulesets/": { "sha256": "...", "s3_uri": "s3://.../rulesets/" },
    "interprose.json": { "sha256": "...", "s3_uri": "s3://.../interprose.json" },
    "inteprose-snapshots.json": { "sha256": "...", "s3_uri": "s3://.../inteprose-snapshots.json" },
    "interprose/": { "sha256": "...", "s3_uri": "s3://.../interprose/" },
    "cloudwatch-metrics.json": { "sha256": "...", "s3_uri": "s3://.../cloudwatch-metrics.json" },
    "rule-query-artifacts.json": { "sha256": "...", "s3_uri": "s3://.../rule-query-artifacts.json" }
  }
}
```

`lexicon_version_id` is a monotonic release identifier minted by the Lexicon release process. Build records the Lexicon release a product was built/tested against in `service-builder.lexicon_version_id`; Marketplace and Puller use that value for dependency compatibility checks.

---

## 4. Consumer Contracts

### 4.1 Persist

Persist consumes `/lexicon/data-uri` at deploy/runtime and uses the pointed `lexicon.json` for:

- `/persist/ingest` GraphSON validation;
- `/persist/ingest-async` validation before enqueue;
- `GraphFactProduced` EventBridge validation;
- `/persist/validate` validation-only requests;
- Neptune CSV workflow validation.

Persist caches the loaded document for 300 seconds, refreshes through single-flight fetch, and fails closed when refresh fails after expiry. Persist validates payload labels, edge endpoints, required properties, property types, enums, formats, patterns, and multi-value/cardinality semantics. Derived `indexes` metadata is accepted as Lexicon metadata but is not treated as required ingest input.

Candidate validation uses `candidate_lexicon_s3_uri`. Persist accepts candidate URIs only in the same Lexicon data bucket under `ovid-agent-changes/` and ending in `.json`.

### 4.2 Rules

Rules consumes `/lexicon/rulesets-uri`. When workflow input omits `rule_s3_uris`, Rules reads `<rulesets-uri>/index.json`, selects the `phone` catalog item, loads that manifest, sorts rule entries by `order`, and fetches each rule definition and `.gremlin` query.

Rules never writes back to Lexicon, never mutates ruleset objects, and never reads rules from GitHub at runtime. Explicit `rule_s3_uris` must still point at prefixes containing exactly one rule JSON definition and one `.gremlin` query.

### 4.3 Translate

Translate treats `lexicon`, `interprose`, and `interprose_snapshots` as reserved read-only language names backed by Lexicon product artifacts, not by Persist.

- `lexicon` resolves from `/lexicon/data-uri`.
- `interprose` resolves from `/lexicon/interprose-data-uri`.
- `interprose_snapshots` resolves from `/lexicon/interprose-snapshots-data-uri`.
- Interprose mapping/transform helpers may read SQL assets from `/lexicon/interprose-transform-uri`.

Callers cannot register or overwrite these names through Translate's language registration API. Translate may cache the artifacts, but cache invalidation and compatibility checks must respect `release.json` and the `lexicon_version_id` used by the deployed mapping bundle.

### 4.4 Connect and metric-emitting services

Connect and other services that emit CloudWatch metrics do not need a runtime dependency on Lexicon only to emit metrics. Their source changes must update `cloudwatch-metrics.json` and the Main Dashboard in the same PR cycle. Build or CI checks may read `/lexicon/cloudwatch-metrics-uri` in deployed environments to compare released metric definitions with product metadata.

### 4.5 Marketplace, Build, and Puller

Lexicon is a Marketplace component whose release artifact includes the data files, UI assets, CDK stack, and `release.json`. Products that require Lexicon data list `Lexicon` in `dependencies`; products that need Lexicon SSM parameters before deployment list it in `deploy_time_dependencies` when their component type allows deploy-time dependencies.

Build records `service-builder.lexicon_version_id` for products that were built or tested against a Lexicon release. Marketplace validates that direct dependencies are compatible with that version, and Puller persists the notified `bundle.lexicon_version_id` for local drift and audit.

---

## 5. Governance Workflow

### 5.1 Change authoring

All Lexicon changes are source changes. A change may update one or more of:

- `src/data/lexicon.json`;
- `src/data/rulesets/**`;
- `src/data/cloudwatch-metrics.json`;
- `src/data/rule-query-artifacts.json`;
- `src/data/interprose*.json`;
- `src/transform/interprose/**`;
- UI components needed to render the new shape.

Schema and ruleset changes must include tests that prove:

- new edge endpoints reference existing vertices unless an explicitly documented exception exists;
- duplicate labels are intentional and covered by compatibility allowances;
- required properties are present and not accidentally moved into indexes;
- enum changes are backed by source-system evidence;
- rules reference existing vertex/edge labels or documented derived/indexed properties;
- ruleset manifests reference existing rule/query files;
- deployable ruleset assets exclude docs-only markdown files.

### 5.2 Review gates

Reviewers enforce:

- modeling standards in section 3.2;
- no embedded related entities when reusable vertices/edges exist;
- no destructive removal of active labels, properties, enum values, rules, or metrics without a deprecation/migration path;
- legal/compliance review for contactability rules;
- dashboard follow-through for metric registry changes;
- consumer PRD or code updates when a contract changes.

### 5.3 Deprecation and compatibility

Deprecating a vertex or property sets `is_deprecated` or records the property under `deprecated_properties`; it does not immediately remove the label from the document. Consumers may reject new writes to deprecated elements only after the consuming product PRD says so.

Breaking changes require a new Lexicon release and coordinated dependent product releases. Consumers that declare a lower `lexicon_version_id` continue to deploy against compatible Lexicon releases until Marketplace compatibility policy blocks them.

---

## 6. Testing

### 6.1 Required checks

The target repo exposes:

```text
pnpm check        # tsc -b
pnpm lint         # ESLint
pnpm format       # Prettier check
pnpm test         # Vitest non-watch run
pnpm cdk:synth    # app build + CDK synth
```

`just check` runs typecheck, lint, format, and tests. `just test` runs Vitest without a watcher. `just cdk:synth` builds the UI and synthesizes `LexiconStack`.

### 6.2 Test coverage

Minimum suites:

| Suite | Coverage |
| --- | --- |
| `lexicon-data` | top-level shape, edge endpoint references, duplicate labels, property/index separation, index metadata completeness, immutable modeling invariants |
| `ruleset-structure` | catalog entries, manifest paths, split rule/query files, rule order, docs excluded from deployable prefix |
| `ruleset-integration` | rule Gremlin references against Lexicon labels/properties/indexes, status-event ordering, account/phone scope semantics |
| `cloudwatch-metrics-data` | metric list, dimensions, enum values, no edge relationships |
| `interprose-mapping` | source schema and transform SQL references for mapped graph elements |
| `ui-smoke` | UI renders each registry entry without crashing |
| `cdk` | stack synthesizes, SSM parameter names and S3 deployment prefixes match this PRD |

### 6.3 Deployment verification

After deploy:

1. `DistributionUrl` serves the UI.
2. `/lexicon/data-uri` points at a readable `lexicon.json`.
3. `/lexicon/rulesets-uri` points at a prefix with `index.json`, `phone-interactions/ruleset.json`, and `sms-interactions/ruleset.json`.
4. `/lexicon/interprose-transform-uri` points at a prefix containing both `vertices/` and `edges/`.
5. `/lexicon/cloudwatch-metrics-uri`, `/lexicon/rule-query-artifacts-uri`, and `/lexicon/release-uri` point at readable objects.
6. A principal with Persist's runtime policy can read only the core Lexicon object and approved candidate prefix.
7. A principal with Rules' runtime policy can read only the rulesets prefix it needs.
8. A principal with Translate's runtime policy can read the schemas and transform SQL prefix it needs.

---

## 7. Implementation Notes From The Reference

The current `../lexicon` implementation already includes:

- Vite + React UI with class, relationship, ruleset, and mapping viewers;
- `src/data/lexicon.json` with 38 vertices, 84 edges, common patterns, and debt derived indexes;
- `src/data/rulesets/index.json` with `phone` and `sms` catalog entries;
- split ruleset manifests, JSON rule definitions, Gremlin queries, and SQL notes;
- `src/data/cloudwatch-metrics.json`;
- `src/data/rule-query-artifacts.json`;
- Interprose schema files and transform SQL under `src/transform/interprose`;
- CDK stack creating a private website bucket, CloudFront distribution, retained data bucket, data deployments, and the first five `/lexicon/*` SSM parameters.

Target gaps to close while re-creating the product:

- migrate npm/Bun scripts to the shared `pnpm`/`just` contract;
- publish `cloudwatch-metrics.json`, `rule-query-artifacts.json`, and `release.json` through S3/SSM;
- add CDK assertions for every SSM parameter and prefix;
- make production removal policies explicit for the website bucket;
- document the Marketplace component metadata for Lexicon, including `lexicon_version_id` generation.

---

## 8. Acceptance Criteria

- `LexiconStack` deploys a private data bucket, static UI, CloudFront distribution, all required SSM parameters, and CloudFormation outputs.
- All artifacts listed in section 2.2 are present in S3 after deployment with versioning enabled.
- Persist, Rules, Translate, Build/Marketplace, and metric checks can consume Lexicon only through the S3/SSM contracts in section 4.
- Tests cover schema integrity, ruleset structure, ruleset integration, metric registry shape, UI smoke rendering, and CDK parameter/prefix contracts.
- The deployed `release.json` records a `lexicon_version_id` and digests for every published artifact group.
- Existing consumer PRDs reference Lexicon as the owner of these artifacts and do not require consumers to read the Lexicon Git repository at runtime.
