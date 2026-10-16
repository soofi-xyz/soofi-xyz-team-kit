# Connect — use cases and reuse evidence

This catalog maps the inbound paths observed in three Spring-Oaks-Capital-LLC
products to Connect flows. It is the acceptance set for the block catalog: every
in-scope path must be expressible with the verbs, drivers and options in
[blocks.md](blocks.md), and every out-of-scope path must stay out.

Evidence comes from reading the repositories on 2026-09-24 (no live AWS checks):
`sms-workflow` (SMS, codename Kadabra), `claydol-agent` (DSA workflows), and
`m2d-pipeline` with `seller-media-transfer-workflow`,
`seller-media-transfer-m2d-trigger` and `seller-media-upload-workflow` (M2D).
Interprose table ingestion (the `stage` lineage) is specified in
[table-ingestion/PRD.md](table-ingestion/PRD.md).

## 1. In scope: external systems

| Product | Path today | Flow | Connection types | Trigger |
| --- | --- | --- | --- | --- |
| SMS | Quiq delivery webhook `POST /quiq/feedback` | [partner-webhook-receipt](examples/flows/partner-webhook-receipt.json) (batched), or [provider-send-and-confirm](examples/flows/provider-send-and-confirm.json) if Connect also sends | `http` | `webhook` / `api` |
| SMS | Interprose account check for the LiveVox payment link (p95 < 1 s) | [interprose-account-lookup](examples/flows/interprose-account-lookup.json) | `http` | `api` (lookup) |
| SMS | Quiq BI JSON exports written to an S3 bucket | [partner-drop-receipt](examples/flows/partner-drop-receipt.json) | `drop_zone` | `drop_zone` |
| DSA | Partner spreadsheets in Azure Blob, one container per DSA, hourly poller with etag ledger and cutoff | [partner-file-intake](examples/flows/partner-file-intake.json) | `azure_blob` | `schedule` |
| DSA | Interprose reads and write-backs (account form, payment plans, notes) | `CALL` flows with `Idempotency` | `http` | `api` |
| DSA | Delivery of results to partner SFTP and Azure `FROM_SOC` | [partner-file-delivery](examples/flows/partner-file-delivery.json) on the partner's `outbox` connection | `sftp`, `azure_blob` | `api` |
| M2D | Interprose documents per account/debt (list, then base64 document bodies) | [interprose-debt-documents](examples/flows/interprose-debt-documents.json) | `http` | `api` |
| M2D | Operator document-ID list | Same flow; M2D passes the IDs in `request_payload` | `http` | `api` |
| M2D | Interprose customer S3 bucket via cross-account role | [partner-bucket-objects](examples/flows/partner-bucket-objects.json) | `s3` (`assume_role`) | `api` |
| M2D | Seller SFTP drops, PGP-encrypted | [encrypted-file-intake](examples/flows/encrypted-file-intake.json) | `sftp` | `schedule` |
| M2D | Elevate Azure Blob container | [partner-file-intake](examples/flows/partner-file-intake.json) with [elevate-prod](examples/partners/elevate-prod.json) | `azure_blob` | `schedule` |
| M2D | Upload of classified files back to Interprose and to seller Azure reporting | `CALL` (`RequestFormat: multipart`) / [partner-file-delivery](examples/flows/partner-file-delivery.json) | `http`, `azure_blob` | `api` |

The two Azure intakes share one flow. Claydol and `seller-media-transfer-workflow`
each hand-built that poller today; Connect replaces both with configuration.

## 2. Out of scope: internal systems

| Product | Path | Owner |
| --- | --- | --- |
| SMS | Persist Gremlin enrichment reads | Product, through the Persist skill |
| SMS | Transactional Postgres templates → GitHub PR | Product |
| SMS | Campaign CSV intake that starts orchestration | Product |
| SMS | Parsing Quiq events, SendContext correlation, `GraphFactProduced` publication | Product (after Connect's reply) |
| DSA | Jigglypuff content-generation callback | Product (internal service) |
| DSA | S3 ObjectCreated trigger after DataSync | Replaced by the Azure intake flow |
| DSA | Layout detection, Bedrock Input QC, SSN hashing, Filter, offers | Product |
| M2D | `ElevateMediaLanded` EventBridge event and M2D start | Product reacts to the subscriber reply |
| M2D | Persist classification reuse | Product |
| M2D | Archive unpacking, text extraction, Textract, Bedrock classification | Product |

## 3. Reuse test

Use these as design checks when changing the catalog. Each must stay at the
listed cost.

| Next use case | Cost |
| --- | --- |
| New DSA on Azure Blob | Partner configuration + activation |
| New DSA on SFTP instead of Azure | Partner configuration + activation ([dsa-sftp-prod](examples/partners/dsa-sftp-prod.json)) |
| New seller with PGP drops on SFTP or Azure | Partner configuration with a `keys.transfer` reference |
| Another SMS or dialer provider with status webhooks | New flow from existing verbs |
| Partner API returning paged JSON | `CALL` + `Paginate` |
| Seller on Box, Google Drive or FTPS | One driver; every file verb and flow works with it |
| Partner with unusual signed-request auth | One auth profile on `http` |
| Partner API acting for a user (refresh token or service account with delegation) | Partner configuration with `oauth2_refresh_token` or `oauth2_jwt_bearer` (§5) |
| Partner pushing events with a signed OIDC token (for example Pub/Sub push) | Partner configuration with a `signed_token` webhook + webhook activation (§5) |

## 4. Known product-side follow-ups

Adopting Connect moves these responsibilities into products; list them in the
migration plan for each product rather than into Connect:

- Kadabra consumes batched Quiq webhook and drop-zone replies and keeps its own
  pending-event correlation.
- Claydol receives landed file pointers from the intake activation and keeps
  layout checks and Input QC.
- M2D subscribes to seller and Elevate intake replies and starts its own
  preprocessing; unpacking stays in M2D.

## 5. Generic patterns

These patterns are tenant-neutral. The Google Workspace examples use fake
values; they show the configuration shape, not an observed deployment.

### OAuth2 delegated sign-in

A partner API returns data that belongs to one user, so Connect must call it as
that user. Implemented in Connect main (PR #29); no live run is recorded here.

| Situation | Auth profile | Credential keys | Connection settings |
| --- | --- | --- | --- |
| One user granted access once (consent screen) | `oauth2_refresh_token` | `client_id`, `client_secret`, `refresh_token` | `token_url`; leave `scopes` off for Google |
| An administrator delegated scopes to a service account for the domain | `oauth2_jwt_bearer` | `client_email`, `private_key`, `private_key_id` (the service-account key file's names) | `token_url`, `scopes`, default `subject`; optional `audience` |

Example: Google Workspace APIs with domain-wide delegation. The partner
configuration [workspace-meet-prod](examples/partners/workspace-meet-prod.json)
binds the Meet API with `oauth2_jwt_bearer`; the flow
[meeting-transcript-entries](examples/flows/meeting-transcript-entries.json)
reads one transcript's entries as the user named in the job request
(`Subject: "$.request.user"`), with the user pinned to the domain by the flow's
`parameters` schema.

- Keep the connection's `scopes` within the scopes granted to the service
  account's client id in the domain-wide-delegation grant; a scope outside the
  grant fails the token request (`AuthFailed`, `unauthorized_client`).
- Connect does not restrict which subject a job may name. Pin the user field in
  the flow's `parameters` schema; an engine-level subject allowlist is a
  Connect builder follow-up.

### Signed-token push source

A partner pushes events to Connect and proves its identity with a signed bearer
token (OIDC) instead of a shared secret. Implemented in Connect main (PR #30)
as the `signed_token` webhook scheme; no live run is recorded here.

Example: Google Workspace Events (for example Meet
`google.workspace.meet.transcript.v2.fileGenerated`) published to a Pub/Sub
topic, delivered by a **push** subscription to
`POST /connect/webhooks/workspace-meet-prod/events`:

- Create the push subscription with payload unwrapping
  (`--push-no-wrapper --push-no-wrapper-write-metadata`) and push
  authentication by a dedicated service account, so the body is the event JSON
  itself and the `Authorization` header carries a Google-signed OIDC token.
- Configure the webhook with `signed_token`: issuer, Google's JWKS, the push
  audience and `required_claims` pinning the push service account's `email`
  and `email_verified` ([workspace-meet-prod](examples/partners/workspace-meet-prod.json)).
- Run the reference [partner-webhook-receipt](examples/flows/partner-webhook-receipt.json)
  flow unchanged through a batched webhook activation
  ([workspace-transcript-events](examples/activations/workspace-transcript-events.json)).
  The subscriber parses each event, dedupes and calls
  [meeting-transcript-entries](examples/flows/meeting-transcript-entries.json)
  for the transcript it names.
- Pub/Sub acknowledges on any 2xx. While the activation is enabled, the flow's
  webhook answers `202` for every authorized event; with no enabled activation
  Connect answers `404`. A `404`, `401` (bad token) or `503` (key endpoint
  down) makes Pub/Sub redeliver, so enable the activation before creating the
  push subscription and attach a dead-letter topic.

Caveats:

- With unwrapping, the event type and message id move to `ce-*` and
  `x-goog-pubsub-*` headers. Connect uses webhook headers only for auth, so
  trigger events do not carry them: filter on the body's shape and dedupe in
  the consuming product.
- Confirm in one dev run that push authentication still sends the token with
  unwrapping enabled, and record the `iss` value Google sends.

Pull subscriptions are not supported for this source today: a pulled Pub/Sub
message carries the event as base64 in `message.data`, and Connect has no step
that decodes an inline base64 field to JSON, no `[*]` array projection in
`Extract.Save` to collect the `ackId`s, and so no way to acknowledge. Both
gaps belong to the Connect builder; do not work around them in a flow.
