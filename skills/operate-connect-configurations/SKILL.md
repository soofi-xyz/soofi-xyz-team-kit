---
name: operate-connect-configurations
description: "Onboard a partner exchange onto the deployed Connect service as configuration: understand the partner's data, locate production credentials, get dev credentials, select a safe test sample, write the flow, partner configuration, activation and job request, prove them on the dev stack, and hand them to the consuming product. Use when adding a partner, a partner API call, webhook, SFTP or bucket intake, file delivery, or lookup to Connect, or when testing or using an existing Connect configuration."
---

# Operate Connect Configurations

Use `wingull`. Connect is deployed; this skill turns a partner exchange into
Connect configuration and proves it on the dev stack. The configuration
language lives in [build-connect-product](../build-connect-product/SKILL.md):
[flow spec](../build-connect-product/reference/flow-spec.md),
[blocks](../build-connect-product/reference/blocks.md),
[use cases](../build-connect-product/reference/use-cases.md). The Connect
repository (`Spring-Oaks-Capital-LLC/connect`) is authoritative for
`contracts/flow.schema.json`, `contracts/examples/` and the dev runbook.

Work through the seven steps in order. Record each step's output in the run
report ([template](reference/run-report.md)) before moving on.

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
  SFTP password or private key, assume role with external id, PGP keys).
- **Shape.** For each object: format, field names as the partner really sends
  them, size range (p50, max), counts per run, encoding (base64, PGP, zip),
  naming pattern, and how the partner marks "already processed" (archive
  folder, delete, nothing).
- **Volume and timing.** Items per run, run frequency, deadline, latency need.
- **Idempotency.** What identifies a duplicate (path plus ETag or size, a
  partner id, a transaction id).

Read one real example of every object before writing configuration. Field
names in partner documentation are often wrong; the observed payload wins.

Then classify:

| Finding | Deliver |
| --- | --- |
| Pattern matches a reference flow in `contracts/examples/flows/` | Partner configuration + activation or job request; flow unchanged |
| Known verbs and options compose it | A new flow, validated and tested like a reference flow |
| Needs a driver, auth profile, verb or option Connect lacks | Stop; hand to `lapras` with the data profile |
| Parsing, classification, graph writes, events | Not Connect; the product owns it after the reply |

## 2. Locate production credentials

- Find where the consuming product keeps the partner secret today (its CDK,
  config, or Secrets Manager names such as `<product>/<partner>/...`). Record
  the secret ARN, account, and the JSON keys it holds. Do not read values
  into the conversation; inspect keys and value lengths only.
- Record the partner's side of auth: allowlisted IPs (Connect egress must be
  added), host key fingerprint, OAuth token URL, role ARN and external id.
- Plan the Connect-owned production copy:
  `connect/prod/partners/<partner>/<name>`, tagged
  `connect:partner-secret=prod`. Do not create production copies until a
  production Connect stack exists and the user approves.

## 3. Get dev credentials

Prefer, in order:

1. **Partner QA or sandbox** credentials already in the dev account (for
   example `dev/<partner>/...`). Copy them into
   `connect/dev/partners/<partner>/<name>` in the format Connect expects (raw
   string for an API key; `{"Username","Password"}` or
   `{"Username","PrivateKey"}` for a Transfer Family connector), tagged
   `connect:partner-secret=dev`. Connect's roles read only tagged secrets.
2. **Partner production, read-only**, only with explicit user approval, only
   GET/LIST operations, and only when no QA exists.
3. **A test partner you control**: a Connect-owned Transfer Family SFTP server,
   a prefix in the dev drop zone, or an HTTPS fake returning the partner's
   real field names. Use it for anything that writes, sends or deletes at the
   partner.

Keep scripts idempotent (create or update the copy; never duplicate), tag
everything you create `connect:verify=dev`, and list what you created. See
[dev runtime](reference/dev-runtime.md) for how the dev stack reads secrets,
SFTP connectors and cross-account roles.

## 4. Select the test sample

Pick the smallest sample that exercises every branch of the flow:

- **Typical**: 2-5 real items of normal size.
- **Largest**: the biggest real item, to check `MaxInlineBytes`, Lambda memory
  and timeouts (inline lookups must fit under the flow's cap).
- **Non-matching**: an object the `Match` must skip (a readme, a wrong
  extension).
- **Duplicate**: the same object again, to prove the ledger lands it once.
- **Broken**: one item the partner or Connect must reject (corrupt PGP, missing
  body, 403 debt) to prove a clean per-item failure and a `PARTIAL` job.
- **Empty**: a run with nothing to fetch.

Rules for the sample:

- Use QA or synthetic identifiers. Never use a real customer for anything that
  sends, pays or writes at the partner.
- Record each item's expected outcome and checksum before running.
- Keep PII out of the report: identifiers and hashes only.
- Put fixtures in the test partner, not in Git, unless they are synthetic.

## 5. Write the configuration

- Start from the closest reference flow and example partner configuration.
  Keep the flow unchanged when it fits; put tenant specifics in the partner
  configuration's `connections` and `parameters`.
- Name a dev partner configuration `<partner>-dev-<purpose>` and point every
  `secret_ref` at a Connect-owned dev copy.
- Create schedule activations with `"enabled": false` and a cron that never
  fires (`0 5 1 1 ? 2099`); the test enables and fires them explicitly.
- Set `limits` on every new flow, `Concurrency` on every `Map`, and an explicit
  `Overwrite` on every `PUT`.
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

## 6. Run it in dev

Follow [dev runtime](reference/dev-runtime.md) for the API, the API key and
triggers.

1. Confirm the account and region, and that the `Connect-dev` stack is
   `UPDATE_COMPLETE` or `CREATE_COMPLETE`.
2. Register the flow (`POST /connect/flows`) if it is new, then put the
   partner configuration and activation.
3. Trigger exactly as production will: enable and fire the schedule, drop the
   object in the drop zone, post the partner webhook, or start the job or
   lookup with a verification callback.
4. Poll `GET /connect/jobs/{job_id}` until it is terminal. Check:
   - status (`SUCCEEDED` or the expected `PARTIAL`) and per-item errors;
   - the manifest validates against `#/$defs/ResultManifest`;
   - landed files' checksums equal the sample's;
   - the reply arrived and its signature verifies;
   - a rerun lands nothing new (ledger);
   - no secret value appears in the manifest, reply or logs.
5. Record latencies (p50, p95 for lookups), durations, counts and job ids.
6. Disable the activation, remove test-partner objects, and delete temporary
   infrastructure (Transfer Family servers bill hourly).

When a run fails, read the job's `error_code` and the Step Functions execution
history before changing anything. Fix configuration yourself; hand Connect
defects to `lapras` with the execution ARN and the smallest reproducing
sample.

## 7. Hand off and use

- Give the product the job contract it calls: route, `configuration_id`,
  request payload, callback or subscriber, the reply shape and file pointers,
  and the error codes it must handle.
- Add the dev configuration and its test to the Connect repo's dev suite
  (`test/dev/`, `docs/runbooks/dev-verification.md`) so CI keeps proving it.
- List the production steps: Connect-owned production secret copies, partner
  allowlisting of production egress IPs, production partner configuration,
  activation with the real cron, and the user approval needed to enable it.

## Return

Return the run report: classification, data profile, credential sources and
copies (ARNs only), sample and expected outcomes, configuration documents with
validation output, dev evidence, cleanup, defects handed to `lapras`, and the
production steps.
