# Model product contract and Lexicon artifacts

Use **Model** as the product identity, Dialga as builder and Jirachi as configurer. Preserve the Lexicon vocabulary and artifact identifiers used by existing consumers. Treat the reference implementation in `../lexicon` as a repository to verify, not proof of the current deployment. Model governs graph vocabulary, ruleset data, business metric-materialization definitions, observability metric definitions and shared mapping artifacts. Use Mew for retained vocabulary lookup and modeling expertise.

Deliver Model as an authenticated HTTP API for definition/release lookup, candidate validation, governed change submission and approved publication/status. Discover existing operations before invoking them; missing API capabilities are builder work. Keep review and versioned release gates, and preserve the S3/SSM consumer contracts below. This adds an API requirement, not an assertion that the reference artifact service already has one.

---

## 1. Product Overview

### 1.1 Mission

Lexicon publishes the shared product vocabulary that lets independently deployed services write, validate, query, and explain the same business facts.

The core artifact is `lexicon.json`: a reviewed graph ontology containing vertex labels, edge labels, properties, required fields, enums, string formats, common patterns, and derived index declarations. The product also publishes adjacent governed data:

- ruleset catalogs used by Rules and downstream decisioning products;
- Interprose source schemas and snapshot-constrained schemas used by Translate and data-preparation jobs;
- Interprose-to-Lexicon transform SQL artifacts;
- governed data-model-driven KPI metric packages with closed materialization
  plans, release attestations, and reviewed activation allowlists;
- CloudWatch metric definitions used by products that emit platform metrics;
- a read-only UI for humans to browse schemas, relationships, rules, and mappings.

Lexicon is deployed before products that depend on those artifacts. Consumers read immutable reviewed artifacts from S3 using SSM parameter names owned by Lexicon; they do not fetch arbitrary GitHub files or embed copies of the schema in their own source.

### 1.2 Primary user surface

Model requires an HTTP API in addition to the verified artifact/viewer interfaces:

| Surface | Identifier | Auth | Purpose |
| --- | --- | --- | --- |
| Product HTTP API | Discover or implement in the target service | Explicit authentication and caller/resource authorization | Read definitions/releases, validate candidates and follow governed publication status/results; required capability, not a claimed deployed route |
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
| `/lexicon/financial-metrics-catalog-uri` | Immutable approved-release document for the matching Lexicon release | Persist | Current payment-catalog reference: governed metric package, manifest and release attestation |
| `/lexicon/rule-query-artifacts-uri` | `s3://<LexiconDataBucket>/rule-query-artifacts.json` | Rules/tooling | Rule query artifact metadata |
| `/lexicon/release-uri` | `s3://<LexiconDataBucket>/release.json` | Build, Marketplace, operators | Release metadata tying artifact digests to `lexicon_version_id` |

Verify which parameters the target revision and deployment actually publish.
The current Lexicon reference includes the payment Financial Metrics release
chain. It proves one catalog contract, not a finance-only product boundary.
The target product MUST enumerate and publish every supported model's governed
metric catalogs through reviewed immutable artifacts and API discovery rather
than requiring consumers to read the repository.

### 1.3 Non-goals

- Lexicon does **not** persist graph facts or execute metric plans. Persist owns
  graph writes, Gremlin reads, Neptune, runtime graph validation,
  materialization-plan compilation, Neptune Streams processing, recomputation,
  mutable projection cells, rebuilds, activation/rollback, and search. Model
  owns validation and publication of governed definition candidates.
- Model does **not** allow unrestricted runtime mutation of canonical schemas, rules, metrics or mappings. API operations submit/validate candidates and initiate approved release work; canonical changes remain reviewed source changes and ship as versioned releases.
- Lexicon does **not** own partner ingestion, translation execution, or source-system credentials. Translate and data pipelines consume Lexicon artifacts; they own execution.
- Lexicon does **not** own the Main Dashboard. It owns the metric registry that dashboard changes must reference.
- Lexicon does **not** bypass Marketplace or Build compatibility checks. Release metadata is provenance and dependency input, not an alternate deployment channel.
- Lexicon does **not** mutate deployed data objects in place outside a reviewed deploy. Rollback is redeploying a previous bundle or restoring a versioned object through an operator-approved runbook.

---

## 2. Architecture

### 2.0 Architectural principles

1. **The reviewed source tree is authoritative for canonical changes.** Model API operations may submit candidates and initiate verified review/publication workflows. Runtime S3 data remains an output of source review, tests, Build and deployment; operators do not hand-edit canonical S3 objects.
2. **S3/SSM is the consumer boundary.** Consumers discover artifacts through stable `/lexicon/*` SSM parameters and then read scoped S3 objects or prefixes. They do not require repository checkout at runtime.
3. **Source facts are immutable by model.** Facts that change over time are
   modeled as new vertices or event edges. Declared derived indexes and
   generation-isolated metric cells are rebuildable Persist-managed projections,
   never source authority. Only their contract-authorized mutable fields may
   change through internal Persist writers.
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

The reference artifact stack does not establish a Model API deployment. Add the required HTTP interface using the target service architecture, with authorization, validated requests, correlated errors and observable async status/results. Keep the static viewer read-only and reuse the existing artifact store; do not create a second vocabulary service.

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
|-- financial-metrics-catalog/  # verified payment reference catalog
|   `-- releases/<lexicon_version_id>/
|       |-- manifest.json
|       |-- approved-release.json
|       |-- payment-financial-metrics.v2.json
|       `-- build.json
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
- governed business metric definitions and their lifecycle metadata;
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
| `FinancialMetricsCatalogS3Uri` | Convenience output for `/lexicon/financial-metrics-catalog-uri` |
| `RuleQueryArtifactsS3Uri` | Convenience output for `/lexicon/rule-query-artifacts-uri` |
| `ReleaseS3Uri` | Convenience output for `/lexicon/release-uri` |

### 2.5 IAM contract

Consumers receive least-privilege access by artifact group:

| Consumer | SSM access | S3 access |
| --- | --- | --- |
| Persist | `/lexicon/data-uri`, `/lexicon/financial-metrics-catalog-uri`, `/lexicon/release-uri` | `GetObject` on `lexicon.json`, attested Financial Metrics release objects, and approved candidate objects under `ovid-agent-changes/` |
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

The existing Filter adapter selects the default `phone` catalog item only when rule context is absent. Context can select multiple matching manifests; explicit `rule_s3_uris` bypass catalog selection. Follow the [current Rules selection contract](../../build-rules-product/reference/implementation/rules-and-queries.md#selection-semantics) for precedence, matching and compatibility.

### 3.4 CloudWatch metric registry

`cloudwatch-metrics.json` uses the same `vertices` / `edges` container shape as other schema-like files, but metric definitions are standalone vertices and `edges` is empty.

Each metric vertex type is the canonical metric name. Properties describe required dimensions and accepted enum values. Products that emit CloudWatch metrics must add or update this file in the same PR cycle as the runtime metric emission and dashboard display work.

The registry is the source of truth for metric names and dimensions; CloudWatch itself is an operational sink, not the registry.

### 3.5 Data-model-driven KPI metric-materialization catalogs

Business KPI metric definitions are governed data, separate from the CloudWatch
observability registry. Model supports any compatible Lexicon data model; the
current Lexicon reference keeps one authoritative payment example at:

```text
src/data/financial-metrics/payment-financial-metrics.v2.json
```

Its validation, materialization-plan generation and release contracts live
under `scripts/lib/financial-metrics/`. The generated immutable release attests
the exact package and `lexicon.json` bytes, and
`/lexicon/financial-metrics-catalog-uri` points to its approved release
document. Verify each target model's package, generator, catalog and publication
contract. Do not reuse this payment path as the default for another domain.

Authority is ordered:

1. the reviewed versioned source configuration;
2. immutable `metric_definition` graph projections of that configuration; and
3. Persist-managed derived metric projections.

Metric cells never become definition authority. Publishing a valid package does
not activate it, run a rebuild, or prove that cells exist.

#### Meaningful candidate discovery

Jirachi follows the
[KPI-to-materialization workflow](../../configure-model-product/reference/kpi-to-metric-configuration.md):

- begin with a business/report question and a pinned source ledger;
- separate Lexicon facts from external report inputs or formulas;
- review one meaningful measure × classifier rule, not every numeric × enum ×
  graph-path permutation;
- require one canonical attribution path and one contribution per unique source
  item;
- resolve business time, timezone, units, coverage, enum members, elections,
  tie-breakers and correction triggers from evidence; and
- classify analysis candidates as `VALID`, `NEEDS_BUSINESS_RULE`, or
  `REJECTED`, publishing only `VALID` definitions.

Unsupported requested outputs are returned under `Cannot Be Generated`; the
agent never invents an enum value, formula, attribution, precedence, timezone,
currency conversion, route, or runtime capability.

Inspect each target model for meaningful vertex/entity, edge/relationship,
immutable-event, numeric-property, enum-member, current/as-of, first/latest,
presence/missingness and path/cohort families. These are candidate categories,
not a requirement to publish every structurally possible metric.

#### Definition contract

Use the target package schema exactly. Every delivered definition resolves the
concepts below; the current payment v2 definition contract is one implementation:

- stable metric ID, immutable definition version, business name, family and
  catalog contract;
- root/source labels, directed path hops, DEBT/GLOBAL scope paths and pinned
  Lexicon release;
- unique source item, contribution identity, once-only rule and correction
  rule;
- measure, calculation, unit, output type, dimensions and qualifying
  conditions;
- time behavior, business-time property/election, timezone and deterministic
  latest/as-of election where applicable;
- `FULL_HISTORY` without a coverage start or `FORWARD_ONLY` with one;
- selected scopes and period grains plus complete triggering vertices/edges;
- output cell, period, debt-scope and period-edge contracts; and
- a generated, closed materialization plan that resolves source traversal,
  predicates, election order, contribution identity, dimensions, period
  assignment, typed output and sparse-delete behavior.

Current payment definitions use `DEBT` and enterprise `GLOBAL` scopes and
`DAY`, `MONTH`, `QUARTER`, and `YEAR` grains. `GLOBAL` uses the literal
identifier `GLOBAL` and has no company or debt scope edge. Every cell links to
an immutable `metric_period`; debt-scoped cells additionally link from the
debt. Preserve target-contract requirements rather than silently reducing
scope or grain coverage.

Generated plans must round-trip byte-equivalently through the target generator.
They contain no prose-only execution rule, placeholder, runtime value, or
unresolved selector. Semantic changes require a new definition version.

#### Time and election semantics

Keep these behaviors distinct:

- `EVENT_FLOW` counts or measures each qualifying immutable occurrence in its
  business period.
- `LATEST_STATE` elects one current revision/state per source identity and can
  move a contribution between old and new cells after a correction.
- `AS_OF_SNAPSHOT` elects related state at the source fact's business time.
- `CUMULATIVE_VALUE` is valid only when the target contract defines its
  accumulation semantics.

Event metrics and current-state metrics answer different questions. For
example, `payment.status.nsf.event_count` counts NSF events, while
`payment.current_status.nsf.amount.sum` sums amounts of payments whose
definition-specific elected state is NSF. Every relevant status event must
trigger recomputation, including transitions out of NSF. Larger-grain
current/as-of cells are independently recomputed from authoritative candidates;
do not sum DAY snapshots into MONTH, QUARTER, or YEAR.

Historical company classifications follow the exact as-of relationship path.
For example, a DSA payment metric must elect the applicable
`company_represents_debt` relationship as of payment business time before
following `debt_has_payment`. A current debt index cannot establish historical
attribution.

#### Metric delivery

When metric delivery is requested, Jirachi converts approved `VALID`
suggestions into the target package, runs its generator and validator, submits
the candidate through the Model API, preserves review/version gates, publishes
the immutable catalog and reads back metric/catalog identity plus artifact
digests. `SUGGESTED`, `DELIVERED`, and `MATERIALIZED` are distinct states.
Missing API or reusable catalog support remains a Dialga builder gap; direct
source, S3, SSM or graph writes do not substitute for delivery.

#### Materialization boundary

Model validates and publishes the closed definition and any reviewed exact
activation allowlist. Persist consumes the attested package and owns:

- plan compilation and trigger indexes;
- Neptune Streams checkpoints and change detection;
- authoritative graph-history reads and deterministic elections;
- idempotent contributions and full affected-cell recomputation;
- internal writes to generation-isolated mutable `metric_cell` projections;
- shadow rebuilds, catch-up, verification, activation and rollback; and
- read/search behavior over the active generation.

Source facts, metric definitions, periods, contributions and dimension
coordinates remain immutable. Persist may mutate only contract-authorized cell
values and projection state through internal writers. Public ingest must not
author projection-managed labels. Reports resolve the active generation and
read the requested period grain directly instead of re-aggregating source
history.

Catalog-wide readiness and environment activation are independent. Persist
must consume a package-owned exact activation allowlist verbatim when the
package declares one; Persist still owns runtime fencing and generation
activation.

### 3.6 Interprose schemas and transforms

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

Publish SQL files as executable configuration consumed by Transform.
Model governs their shared definitions and publication; Silvally authors concrete
Transform mapping configurations. Transform resolves
the registered mapping, reads the SQL objects and executes them with
`spark.sql()` against typed temp views in its Python/PySpark Glue job.
Keep source joins, predicates, identifier expressions and typed projections in
the SQL artifacts. Coordinate generic execution-engine changes with `kecleon`
using the [Transform implementation PRD](../../build-transform-product/reference/PRD.md).
Lexicon itself does not execute these queries; preserve any separately verified
consumers of the same artifacts.

#### Generic Transform registration (target extension)

Extend configuration publication for Transform's explicit `from`/`to` contract:
publish named/versioned language schema references and enabled directional
`spark-sql` mapping manifests for arbitrary registered pairs. Keep language
identity independent of Parquet/JSONL/CSV encoding and tabular/graph serialization.
Model governs shared schema/mapping definitions and publication; Silvally owns
concrete Transform configuration. Model is not the required target language of every pair.

Use the [Transform registration contract](../../build-transform-product/reference/languages-and-mappings.md)
for schemas, SQL bindings, version/digest validation and the proposed
`/lexicon/transform-catalog-uri` publication. This generic pointer/catalog is a
new requirement, not one of the verified existing SSM parameters. Reuse external
language identities through their public registry interfaces. Retain existing
published artifacts for compatible consumers while publishing the new catalog.
For graph targets use the explicit [graph mapping format](../../build-transform-product/reference/graph-mappings.md)
to bind vertex IDs, edge IDs/endpoints, labels and properties.

### 3.7 Release metadata

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
    "financial-metrics-catalog": { "sha256": "...", "s3_uri": "s3://.../financial-metrics-catalog/releases/<lexicon_version_id>/manifest.json" },
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

Persist also consumes the approved Financial Metrics release through
`/lexicon/financial-metrics-catalog-uri` and verifies it against
`/lexicon/release-uri` before compiling any plan. Neptune Streams are change
detection, not metric-definition or value authority. Persist re-reads immutable
source history, applies the attested plan, and writes only internal
generation-isolated projections. Model publication does not call that runtime.

### 4.2 Rules

Rules consumes `/lexicon/rulesets-uri`. The existing Filter adapter reads the catalog and resolves manifests through its [Rules selection contract](../../build-rules-product/reference/implementation/rules-and-queries.md#selection-semantics), including default selection, context matching, explicit artifact precedence and shared-rule conflict handling. Keep runtime selection semantics in that reference rather than duplicating them here.

Rules never writes back to Lexicon, never mutates ruleset objects, and never reads rules from GitHub at runtime. Explicit `rule_s3_uris` must still point at prefixes containing exactly one rule JSON definition and one `.gremlin` query.

### 4.3 Translate

Translate treats `lexicon`, `interprose`, and `interprose_snapshots` as reserved read-only language names backed by Lexicon product artifacts, not by Persist.

- `lexicon` resolves from `/lexicon/data-uri`.
- `interprose` resolves from `/lexicon/interprose-data-uri`.
- `interprose_snapshots` resolves from `/lexicon/interprose-snapshots-data-uri`.
- Interprose mapping/transform helpers may read SQL assets from `/lexicon/interprose-transform-uri`.

Callers cannot register or overwrite these names through Translate's language registration API. Translate may cache the artifacts, but cache invalidation and compatibility checks must respect `release.json` and the `lexicon_version_id` used by the deployed mapping bundle.

### 4.4 Connect and observability metric-emitting services

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
- every governed metric-catalog package and its validation/generation
  contracts; the current payment reference is under
  `src/data/financial-metrics/**`;
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
- question/source evidence, canonical attribution, once-only identity,
  deterministic election, time, units, coverage and complete triggers for
  KPI metric definitions;
- no numeric × enum × path Cartesian generation or duplicate path attribution;
- generated closed plans and package-owned activation allowlists remain in sync
  with their validated source definitions;
- dashboard follow-through for observability metric registry changes;
- consumer PRD or code updates when a contract changes.

### 5.3 Deprecation and compatibility

Deprecating a vertex or property sets `is_deprecated` or records the property under `deprecated_properties`; it does not immediately remove the label from the document. Consumers may reject new writes to deprecated elements only after the consuming product PRD says so.

Breaking changes require a new Lexicon release and coordinated dependent product releases. Consumers that declare a lower `lexicon_version_id` continue to deploy against compatible Lexicon releases until Marketplace compatibility policy blocks them.

---

## 6. Testing

Follow the [Model capability map](../../guide-product-work/reference/iterations/model.md)
and [synthetic test data](test-data.md). Include HTTP authorization, candidate
conflicts, review gates, async status/results and artifact read-back in each piece.
Use local fakes, then the actual test API with mocked external integrations. Have
the user invoke each feature and inspect correlated AWS logs/workflows before
advancing; artifact validation or synthesis alone does not prove API behavior.

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
| `metric-materialization-catalog` | data-model-driven suggestion/delivery, package/release attestation, graph-reference validation, meaningful family contract, generated plan parity, elections/tie-breakers, coverage, triggers, typed outputs and activation allowlist |
| `interprose-mapping` | source schema and transform SQL references for mapped graph elements |
| `ui-smoke` | UI renders each registry entry without crashing |
| `cdk` | stack synthesizes, SSM parameter names and S3 deployment prefixes match this PRD |

### 6.3 Deployment verification

After deploy:

1. `DistributionUrl` serves the UI.
2. `/lexicon/data-uri` points at a readable `lexicon.json`.
3. `/lexicon/rulesets-uri` points at a prefix with `index.json`, `phone-interactions/ruleset.json`, and `sms-interactions/ruleset.json`.
4. `/lexicon/interprose-transform-uri` points at a prefix containing both `vertices/` and `edges/`.
5. `/lexicon/financial-metrics-catalog-uri` resolves an immutable approved
   release whose manifest and package match `/lexicon/release-uri`.
6. `/lexicon/cloudwatch-metrics-uri`, `/lexicon/rule-query-artifacts-uri`, and `/lexicon/release-uri` point at readable objects.
7. A principal with Persist's runtime policy can read only the core Lexicon,
   attested Financial Metrics objects, and approved candidate prefix.
8. A principal with Rules' runtime policy can read only the rulesets prefix it needs.
9. A principal with Translate's runtime policy can read the schemas and transform SQL prefix it needs.

---

## 7. Implementation Notes From The Reference

The current `../lexicon` implementation already includes:

- Vite + React UI with class, relationship, ruleset, and mapping viewers;
- `src/data/lexicon.json` with 38 vertices, 84 edges, common patterns, and debt derived indexes;
- `src/data/rulesets/index.json` with `phone` and `sms` catalog entries;
- split ruleset manifests, JSON rule definitions, Gremlin queries, and SQL notes;
- `src/data/cloudwatch-metrics.json`;
- the versioned payment Financial Metrics package, generated closed
  materialization plans, release attestations and
  `/lexicon/financial-metrics-catalog-uri`;
- `src/data/rule-query-artifacts.json`;
- Interprose schema files and transform SQL under `src/transform/interprose`;
- CDK stack creating a private website bucket, CloudFront distribution, retained data bucket, data deployments, and the first five `/lexicon/*` SSM parameters.

Target gaps to close while re-creating the product:

- deliver and verify the authenticated Model API rather than treating source
  artifacts or the viewer as an API;
- migrate npm/Bun scripts to the shared `pnpm`/`just` contract;
- preserve and verify publication of observability metrics, every governed KPI
  metric catalog, rule artifacts and release attestations through the supported
  API and S3/SSM consumer boundary;
- add CDK assertions for every SSM parameter and prefix;
- make production removal policies explicit for the website bucket;
- document the Marketplace component metadata for Lexicon, including `lexicon_version_id` generation.

---

## 8. Acceptance Criteria

- The authenticated Model HTTP API exposes the selected definition, candidate and approved release capabilities with validated requests, caller/resource authorization, correlated errors and async status/results where needed.
- Unsupported API operations remain builder gaps; configurers do not replace them with direct canonical S3/SSM writes.

- `LexiconStack` deploys a private data bucket, static UI, CloudFront distribution, all required SSM parameters, and CloudFormation outputs.
- All artifacts listed in section 2.2 are present in S3 after deployment with versioning enabled.
- Persist, Rules, Translate, Build/Marketplace, and metric checks can consume Lexicon only through the S3/SSM contracts in section 4.
- KPI metric candidates for any supported data model are question-led and
  source-supported; invalid
  Cartesian/path candidates and unresolved business rules cannot publish.
- Every delivered metric definition has deterministic identity,
  attribution, election/time, triggers, coverage, typed output and a generated
  closed materialization plan compatible with the pinned Lexicon release.
- Every immutable metric-catalog release and matching Lexicon release attest
  one another; delivery includes API publication and digest read-back, while
  publication performs no Persist graph write or activation.
- Tests cover schema integrity, ruleset structure, ruleset integration,
  business KPI and observability metric registry contracts, UI smoke rendering,
  and CDK parameter/prefix contracts.
- The deployed `release.json` records a `lexicon_version_id` and digests for every published artifact group.
- Existing consumer PRDs reference Lexicon as the owner of these artifacts and do not require consumers to read the Lexicon Git repository at runtime.
- Persist remains the sole owner of plan compilation, Streams processing,
  recomputation, mutable cells, generations, rebuilds, activation/rollback and
  metric search.
