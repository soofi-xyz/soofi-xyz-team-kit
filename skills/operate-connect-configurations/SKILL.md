---
name: operate-connect-configurations
description: "Onboard a partner exchange onto the deployed Connect service as configuration: understand the partner's data, locate production credentials, get dev credentials, select a safe test sample, write the flow, partner configuration, activation and job request, prove them on the dev stack, and hand them to the consuming product. Use when adding a partner, a partner API call, webhook, SFTP or bucket intake, file delivery, or lookup to Connect, or when testing or using an existing Connect configuration."
---

Use [the Connect capability map](../guide-product-work/reference/iterations/connect.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

Follow [guide-product-work](../guide-product-work/SKILL.md). Wingull configures Connect; Lapras owns missing capabilities and defects.

# Operate Connect Configurations

Use `wingull`. Connect is deployed; this skill turns a partner exchange into
Connect configuration and proves it on the dev stack. The configuration
language lives in [build-connect-product](../build-connect-product/SKILL.md):
[flow spec](../build-connect-product/reference/flow-spec.md),
[blocks](../build-connect-product/reference/blocks.md),
[use cases](../build-connect-product/reference/use-cases.md). The Connect
repository that deploys the target stack is authoritative for
`contracts/flow.schema.json`, `contracts/examples/` and the dev runbook.

Work through the eight steps in order. Record each step's output in the run
report ([template](reference/run-report.md)) before moving on.

## Memoryless rule

Every Connect configuration is memoryless. Each job is fully described by its
request parameters (source scope plus a time window, or explicit item ids); it
fetches, lands and replies, and nothing depends on state saved by a previous
job.

- Never design a flow that needs a stored cursor, position or sync token
  carried between jobs (Gmail `historyId`, Calendar `syncToken`, Drive
  `pageToken`/changes token). Pagination inside one job is fine.
- Re-running the same request lands the same content under the same
  deterministic `transaction_id`.
- Deduplication across overlapping windows belongs downstream: Persist writes
  by identity (natural keys such as `Message-ID` + mailbox), not Connect.
- Use the `LIST`/drop-zone `Ledger` only to skip already-landed files for file
  sources. It is per-item file dedupe, not a cursor.
- Do not move the state into System either: it has no flow-usable key/value
  state (only 30-day idempotency keys and ordered-trigger lanes).

## 1. Understand the data

Answer these from the product's code, the partner's documentation and the
user. Ask only for what you cannot recover.

- **Consumer.** Which product receives the result, and how: HTTPS callback,
  Step Functions task token, or activation subscriber.
- **Direction and trigger.** Pull (schedule), push (partner webhook or drop into
  a Connect drop zone), on demand (job or lookup), or delivery (product uploads
  a file, Connect puts it at the partner).
- **Transport.** `http`, `sftp`, `azure_blob`, `s3` (partner-owned) or
  `drop_zone`; host or account, paths or endpoints, pagination, rate limits,
  static-IP allowlisting.
- **Auth.** Profile (API key header, basic, bearer, OAuth client credentials,
  OAuth refresh token for one user's grant, service-account JWT bearer acting
  as a user, SFTP password or private key, assume role with external id, PGP
  keys). For a user-scoped API, record which user or users Connect acts as.
- **Shape.** For each object: format, field names as the partner really sends
  them, size range (p50, max), counts per run, encoding (base64, PGP, zip),
  naming pattern, and how the partner marks "already processed" (archive
  folder, delete, nothing).
- **Volume and timing.** Items per run, run frequency, deadline, latency need.
- **Idempotency.** What identifies a duplicate (path plus ETag or size, a
  partner id, a transaction id) and the natural key the consumer writes by
  downstream.
- **Time filter.** Whether the source queries by time or modification
  (`modified_since`, `after:`, `updated_min`), and its granularity.

Read one real example of every object before writing configuration. Field
names in partner documentation are often wrong; the observed payload wins.

Then classify:

| Finding | Deliver |
| --- | --- |
| Pattern matches a reference flow in `contracts/examples/flows/` | Partner configuration + activation or job request; flow unchanged |
| Known verbs and options compose it | A new flow, validated and tested like a reference flow |
| Needs a saved cursor or position between jobs | Not a Connect gap; redesign as a memoryless pull (or a self-contained push) in step 2 |
| Cross-job dedupe of records | Persist identity downstream, not Connect |
| Subject or mailbox allowlist | Fixed in the configuration's `parameters` pattern or scope (a pull iterates a configured list); not a `lapras` gap |
| Connect cannot perform the single fetch, call or land itself: a missing driver, auth profile, verb or option, or a defect (for example decoding an inline base64 field to JSON) | Stop; hand to `lapras` with the data profile and the smallest failing request |
| Parsing, classification, graph writes, events | Not Connect; the product owns it after the reply |

## 2. Decide push or pull

Choose and record exactly one ingestion mode per partner configuration before
configuring anything:

- **Pull (default).** A scheduled job over an overlapping window (window at
  least twice the interval, for example every 30 minutes over the last 60)
  using the source's time or modified filter. Use it whenever the source
  supports time- or modified-based queries. Backfill is the same pull with a
  larger window.
- **Push.** Only when each event is self-contained: the payload carries the
  full record, or a stable id fetched directly with no prior state (an S3 or
  drop-zone object created, a webhook whose body is the record or a direct
  resource URL). Require a deterministic `transaction_id` and a fast plain
  success reply.
- **Reject push** when the event is only a change signal that needs a previous
  cursor (Gmail Pub/Sub `{emailAddress, historyId}`, Drive changes, Calendar
  sync tokens). Use pull, or a source-side full-content copy (for example a
  Workspace routing copy to SES → S3, read by an `s3` connection).

For a self-contained push from a queue (for example Pub/Sub carrying a Meet
transcript name), use a push subscription with payload unwrapping
(`--push-no-wrapper --push-no-wrapper-write-metadata`) and OIDC push
authentication, received by a `signed_token` webhook and a webhook activation
([signed-token push source](../build-connect-product/reference/use-cases.md#signed-token-push-source)).
The queue acknowledges on Connect's 2xx.

Record the decision in the bundle README's `## Ingestion` section (or the run
report when there is no bundle): mode, why, schedule and window or event
source, idempotency key, downstream dedupe key and backfill method. The builder
and operator run from this record.

```markdown
## Ingestion
- Mode: pull — Gmail push carries only `historyId` and needs the previous one
- Schedule / window: `*/30` cron, `after:` = scheduled time − 60 min, per configured mailbox
- Idempotency key: `transaction_id` = `<configuration_id>-<mailbox>-<window_start>`
- Downstream dedupe key: `Message-ID` + mailbox (Persist identity)
- Backfill: same request with a larger window
```

## 3. Locate production credentials

- Find where the production values live today: the Account product, or the
  consuming product's CDK, config or Secrets Manager (`<product>/<partner>/...`).
  Record the source, account and the keys it holds. Do not read values into
  the conversation; inspect keys and value lengths only.
- Record the partner's side of auth: allowlisted IPs (Connect egress must be
  added), host key fingerprint, OAuth token URL, granted scopes (for a service
  account, the domain-wide-delegation grant on its client id), role ARN and
  external id. Check every pair in the
  [values-that-must-match checklist](reference/dev-runtime.md#values-that-must-match).
- Plan the production Connect credential: its name, profile and keys, and
  whether it is imported from Account or set with `PUT`. Do not set production
  credentials until a production Connect stack exists and the user approves.

## 4. Get dev credentials

Prefer, in order:

1. **Partner QA or sandbox** credentials already in the dev account (for
   example `dev/<partner>/...`). Set them as a Connect credential with
   `PUT /connect/partners/<partner>/credentials/<name>` (`{profile, values}`),
   piping values from the source into the signed request without printing
   them. Use `POST .../import` from Account only when the target ships that
   route (Connect main does not). Confirm with `GET` that `state` is `SET`,
   every key of the profile is `true` and `used_by` lists the expected
   configurations. Never paste tokens, refresh tokens or key files into chat,
   logs or evidence.
2. **Partner production, read-only**, only with explicit user approval, only
   GET/LIST operations, and only when no QA exists.
3. **A test partner you control**: a Connect-owned Transfer Family SFTP server,
   a prefix in the dev drop zone, or an HTTPS fake returning the partner's
   real field names. Use it for anything that writes, sends or deletes at the
   partner.

Keep scripts idempotent (`PUT` replaces; never create a second credential for
the same purpose), tag infrastructure you create `connect:verify=dev`, and list
what you created. See [dev runtime](reference/dev-runtime.md) for the credentials
API, SFTP connectors and cross-account roles.

## 5. Select the test sample

Pick the smallest sample that exercises every branch of the flow:

- **Typical**: 2-5 real items of normal size.
- **Largest**: the biggest real item, to check `MaxInlineBytes`, Lambda memory
  and timeouts (inline lookups must fit under the flow's cap).
- **Non-matching**: an object the `Match` must skip (a readme, a wrong
  extension).
- **Duplicate** (file flows with a `LIST`/drop-zone `Ledger` only): the same
  object again, to prove the ledger lands it once.
- **Boundary** (pull flows): a record inside two overlapping windows, to prove
  neither window misses it.
- **Replayed event** (push flows): the same event delivered twice.
- **Broken**: one item the partner or Connect must reject (corrupt PGP, missing
  body, 403 debt) to prove a clean per-item failure and a `PARTIAL` job.
- **Empty**: a run with nothing to fetch.

Rules for the sample:

- Use QA or synthetic identifiers. Never use a real customer for anything that
  sends, pays or writes at the partner.
- Record each item's expected outcome and checksum before running.
- Keep PII out of the report: identifiers and hashes only.
- Put fixtures in the test partner, not in Git, unless they are synthetic.

## 6. Write the configuration

- Start from the closest reference flow and example partner configuration.
  Keep the flow unchanged when it fits; put tenant specifics in the partner
  configuration's `connections` and `parameters`.
- Name a dev partner configuration `<partner>-dev-<purpose>` and point every
  `credential` at a dev credential set in step 4.
- Put the pull window (or the explicit item ids) in the request, never in a
  value saved by an earlier job, and derive `transaction_id` from the
  configuration, scope and window start.
- Create schedule activations with `"enabled": false` and a cron that never
  fires (`0 5 1 1 ? 2099`); the test enables and fires them explicitly.
- Set `limits` on every new flow, `Concurrency` on every `Map`, and an explicit
  `Overwrite` on every `PUT`.
- When a `CALL` sets `Subject` from `$.request`, pin that field in the flow's
  `parameters` schema with a `pattern` for the allowed users (for example
  `^[^@]+@example\.com$`, or an explicit alternation of the configured
  mailboxes). The pattern is the allowlist; never leave the field open.
- When the partner addresses resources by multi-segment names (for example
  `conferenceRecords/<id>/transcripts/<id>`), fill one `{+name}` placeholder
  and pin the name's shape in `parameters`; use `{name}` for single segments.
- Validate every document with the Connect repo's spec module (the same
  schema and semantic checks the API applies) before touching dev. Kinds:
  `Flow`, `PartnerConfiguration`, `Activation`, `JobRequest`,
  `ResultManifest`. From the Connect checkout:

```bash
cat > validate.tmp.ts <<'EOF'
import { readFileSync } from "node:fs";
import { checkFlowSemantics, validateDocument } from "./src/spec/index.js";
const [kind, file] = process.argv.slice(2) as ["Flow", string];
const result = validateDocument(kind, JSON.parse(readFileSync(file, "utf8")));
const issues = result.ok ? (kind === "Flow" ? checkFlowSemantics(result.value) : []) : result.issues;
console.log(JSON.stringify(issues, null, 2));
process.exit(issues.length ? 1 : 0);
EOF
npx tsx validate.tmp.ts Flow <flow>.json   # prints [] and exits 0 when valid
rm validate.tmp.ts
```

- Run `npm run check` in the Connect checkout when you add a new flow to
  `contracts/examples/`.

- Add new flows as local proofs first: run them against the stand-ins
  (`npm run fakes`, `npm run test:integration`) until they pass.

## 7. Run it in dev

Follow [dev runtime](reference/dev-runtime.md) for the API, SigV4 signing and
triggers.

1. Confirm the account and region, and that the `Connect-dev` stack is
   `UPDATE_COMPLETE` or `CREATE_COMPLETE`.
2. Register the flow (`POST /connect/flows`) if it is new, then put the
   partner configuration and activation.
3. Trigger exactly as production will: enable and fire the schedule, drop the
   object in the drop zone, post the partner webhook, or start the job or
   lookup with a verification callback. For a `signed_token` webhook, enable
   the activation before pointing the partner's push at it, then send one real
   signed event; a hand-made token cannot pass.
4. Poll `GET /connect/jobs/{job_id}` until it is terminal. Check:
   - status (`SUCCEEDED` or the expected `PARTIAL`) and per-item errors;
   - the manifest validates against `#/$defs/ResultManifest`;
   - landed files' checksums equal the sample's;
   - the reply arrived and its signature verifies;
   - file flows with a `Ledger`: a rerun lands nothing new;
   - pull flows: the boundary record lands in both overlapping windows, a
     re-run of the same request gives identical content (sha256) and the same
     `transaction_id`, and the duplicates share one downstream identity key;
   - push flows: replaying the same event yields the same `transaction_id`
     and no second run;
   - no credential value appears in the manifest, reply, logs or API responses.
5. Record latencies (p50, p95 for lookups), durations, counts and job ids.
6. Disable the activation, remove test-partner objects, delete test
   credentials no configuration still names, and delete temporary
   infrastructure (Transfer Family servers bill hourly).

When a run fails, read the job's `error_code` and the Step Functions execution
history before changing anything. Fix configuration yourself; hand Connect
defects to `lapras` with the execution ARN and the smallest reproducing
sample.

## 8. Hand off and use

- Give the product the job contract it calls: route, `configuration_id`,
  request payload, callback or subscriber, the reply shape and file pointers,
  and the error codes it must handle.
- Add the dev configuration and its test to the Connect repo's dev suite
  (`test/dev/`, `docs/runbooks/dev-verification.md`) so CI keeps proving it.
- List the production steps: production credentials set or imported, partner
  allowlisting of production egress IPs, production partner configuration,
  activation with the real cron, and the user approval needed to enable it.

## Return

Return the run report: classification, data profile, credential sources and
Connect credentials set (names and key names only), sample and expected outcomes, configuration documents with
validation output, dev evidence, cleanup, defects handed to `lapras`, and the
production steps.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Author pinned configuration documents that name credentials and never carry their values; preserve partner validation and keep registration separate from activation and traffic.
