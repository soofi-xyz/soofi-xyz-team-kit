# Connect — architecture

Connect is the only layer that talks to systems outside the company. It hides
each partner's transport, auth, file-drop and callback quirks behind one
declarative flow specification that a compiler turns into AWS Step Functions
state machines, and behind one job API that every product calls the same way.

Adding a partner of a known kind is a configuration release. Adding a new kind
of storage or auth is one driver. Adding a verb is rare and needs evidence.

## 1. Boundary

Connect talks to **external systems only**: partner REST/XML APIs, partner
webhooks, partner SFTP servers, partner Azure Blob containers, partner-owned S3
buckets, and Connect-owned drop zones that partners write into.

Connect does **not**:

- read or write Persist/Neptune, Lexicon, Transform or any product database;
- publish to EventBridge, SNS or product queues, or start product workflows;
- call internal services (Jigglypuff, Filter, Solver and similar);
- parse business layouts, classify documents, run OCR/LLM steps, compute
  offers, or unpack business archives;
- start from internal events. Products call the job API instead.

Its only interface to internal systems is the job contract in §5: a status API,
a reply to the caller's callback, and file pointers in S3. Everything after that
belongs to the calling product.

Treat a vendor-hosted system the company uses (for example Interprose's REST API
or its customer S3 bucket) as external. Treat a bucket, database or service the
company owns as internal, even when a partner originally produced the data.

## 2. Concepts

| Concept | Meaning |
| --- | --- |
| **Partner** | An external organization or system. Namespace for connections, flows and lookups. |
| **Connection** | A named, typed endpoint of a partner (`http`, `sftp`, `azure_blob`, `s3`, `drop_zone`). Carries location, auth profile and secret references. The type selects a driver. |
| **Partner configuration** | Per tenant and environment: binds a flow's connection aliases to concrete connections, and holds partner parameters (prefixes, cutoffs, key references, allowed actions). One flow serves many partner configurations. |
| **Flow** | A versioned, multi-step, asynchronous interaction written from verbs. Compiled to a STANDARD state machine. |
| **Lookup** | A single synchronous `CALL`. Compiled to an EXPRESS state machine and answered inline. |
| **Activation** | Runtime binding of flow + partner configuration + trigger + subscriber, with an `enabled` switch. Schedules, drop zones and partner webhooks are activations. |
| **Job** | One execution of a flow against one partner configuration. Has a `job_id`, status and a result manifest. |

The formal shapes are in [flow-spec.md](flow-spec.md). The verb, connection and
option catalog is in [blocks.md](blocks.md).

## 3. Build-time pipeline: spec → state machine

```text
POST flow spec
  → validate against contracts/flow.schema.json (exact error paths)
  → semantic checks (aliases declared, verbs allowed on the connection type,
    options valid for the verb, loops closed, limits present)
  → rewrite legacy task types to verbs (blocks.md §6)
  → expand verbs into ASL (native HTTP Task, worker Lambda or container task)
  → inject plumbing: auth resolution, default Retry/Catch, ledger commit,
    ReplyBack / ReplyBackError, metrics, dry-run short-circuit
  → validate ASL with the Step Functions validator
  → create or update the state machine; store the flow version
```

The compiler is itself a Step Functions workflow. Authors never write retries,
reply-back, metrics or auth plumbing; the compiler adds them to every flow.

## 4. Run-time pipeline: job

```text
Trigger (API call | schedule | drop-zone object | partner webhook)
  → resolve activation / partner configuration (secrets stay references)
  → create job_id, persist the request, return 202 for API calls
  → run the compiled flow: verbs, waits, loops, choices
  → land every fetched payload in the Connect bucket as file pointers
  → write result manifest; commit ledger claims for succeeded items
  → reply to the caller callback or the activation subscriber; emit metric
```

Batch invocation reuses the same flow: the caller supplies items (inline array
or a file pointer) plus `maximum_concurrency`, and Connect fans out one job per
item or chunk.

## 5. Caller contract

Every product sees the same shapes, whatever the partner does inside:

- `POST /partners/{partner}/flows/{flow}/jobs` → `202 {job_id}`;
- `POST /partners/{partner}/lookups/{lookup}` → `200 {result}` inline;
- `GET /jobs/{job_id}` → status and result manifest;
- reply to `callback.url` (HTTPS, HMAC-signed) or `callback.task_token`
  (caller's Step Functions execution waits), for API-triggered jobs;
- reply to the activation's subscriber URL for unattended runs (schedule,
  drop zone, partner webhook), because they have no caller.

A result manifest lists landed files (`s3Uri`, `sha256`, `size`,
`contentType`, source path and connection), extracted values, per-item status
and sanitized errors. It never contains credentials.

## 6. Runtime operability

- Create, update, dry-run and version flows, partner configurations, connections
  and activations through the API. Never require a CDK deploy per partner,
  schedule, drop zone or feature.
- Deploy shared runtime capacity once (compiler, workers, drivers, webhook
  ingress, scheduler group, drop-zone bucket) in an inactive state; activate
  per partner at runtime.
- Enable or disable an activation without redeploying. A disabled activation
  keeps its ledger.

## 7. Lineage and what changes

The design keeps the Staircase Connector model that the
[Connect service PRD](../../build-connect-service/reference/PRD.md) already ports
to TypeScript/CDK: vendors, flows, lookups, an ASL-shaped spec with
`ResourceDefinition.Type`, a compiler workflow, JSONPath state, `Extract.Save`,
injected retries and reply-back, file pointers for large responses, webhook
correlation by payload value, and per-tenant partner configuration.

It changes five things that blocked reuse:

1. **Verbs instead of provider/format types.** `GET_JSON`, `POST_XML`,
   `GET_FILE`, `SFTP` and similar collapse into `CALL` and file verbs whose
   provider comes from the connection. Legacy names remain as compile-time
   aliases.
2. **Auth on the connection, not the flow.** One partner's flows share one
   auth profile; the flow names only the connection alias.
3. **Open loops.** `Map` bodies accept any verb and any number of states, with
   items from state or from a landed file (JSON array, JSONL, CSV).
4. **Cross-run memory.** A ledger option skips already-seen items, supports
   cutoffs, leases and explicit replay.
5. **Triggers facing partners.** Schedules, drop zones and partner-initiated
   webhooks start jobs through activations; before, only the job API did.

Also added: pagination on `CALL`, `POLL` in place of the
`PROGRESSIVE_WAITING` + `Wait` + `Choice` idiom, webhook early-arrival
buffering and batching, `DECRYPT`/`DECODE`, and a `Runner` option that moves
heavy work from Lambda to a container task.
