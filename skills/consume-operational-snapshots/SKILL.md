---
name: consume-operational-snapshots
description: "Consumes source-owner-produced operational and control-plane snapshots from private S3 as authoritative Hoothoot report inputs. Verifies AWS account, immutable history, SHA-256 integrity, schema, freshness, provenance, and PII/secret safety before building reports. Triggers on: operational snapshot, control-plane telemetry, PagerDuty report, GitHub inventory, S3 report input, source-owned snapshot, external operational API export. Do NOT use for debt, person, account, campaign, eligibility, or other business-domain data, which remains governed by approved Athena/Persist/Rules contracts."
---

# Consume Authoritative Operational Snapshots

Use this skill when a non-business operational system has already produced a
reporting snapshot in private S3 and Hoothoot should build the report without
calling the upstream system.

Examples include PagerDuty incident telemetry, GitHub repository inventory,
deployment health, CI diagnostics, and other control-plane observations.

## Hard boundary

This path is only for operational/control-plane telemetry.

Do not use it for debt, person, account, payment, campaign, eligibility,
decision, offer, communication-content, or other business-domain data. Those
remain governed by the approved Athena, Persist, Rules, Filter, Lexicon, and
shared-business-logic contracts.

Do not ingest operational telemetry into Persist merely to satisfy a reporting
source restriction.

## Required snapshot contract

Require all of the following before using a snapshot:

- A private S3 current-object URI.
- An immutable history-object URI or immutable S3 VersionId.
- A source identifier naming the upstream systems.
- `schemaVersion` and updater version/ref.
- `generatedAt` in UTC.
- An explicit reporting window with `since`, `until`, and time zone.
- SHA-256 in S3 metadata or a signed manifest.
- No credentials, routing keys, authorization headers, or secret values.
- No unauthorized PII.
- A documented freshness expectation: fixed snapshot or maximum acceptable age.

Reject a mutable current object without immutable lineage.

## Verification workflow

1. Use the selected production AWS profile and `us-east-2` explicitly.
2. Verify AWS account `014948052063`.
3. `HeadObject` the current and immutable objects.
4. Fetch both objects through verified read-only AWS access.
5. Compute SHA-256 over the downloaded bytes.
6. Require the current bytes, immutable bytes, and declared SHA-256 to match.
7. Validate required schema fields and report-specific summary invariants.
8. Check `generatedAt` and the exact reporting window against the requested
   freshness.
9. Inspect a bounded sample/data shape before selecting widgets.
10. Record verification evidence in the report artifact and PR.

Fail closed on missing metadata, integrity mismatch, schema drift, stale input,
unexpected PII, or inaccessible immutable lineage.

## Building the report

- Treat the verified snapshot as source-owned facts.
- Do not call PagerDuty, GitHub, or another upstream API from the report builder.
- Do not reinterpret or silently recompute source facts.
- Derived presentation fields may format, group, sort, and filter source facts;
  document every derived metric.
- Label heuristic, unresolved, routing-only, and authoritative fields
  separately.
- Keep the main UI plain; put full snapshot provenance in Audit Details.
- Serve the final artifact through the protected Hoothoot report API, never from
  public static data.

## Required provenance

Include:

- Current S3 URI.
- Immutable S3 URI and/or VersionId.
- Source identifier.
- Schema and updater version/ref.
- Declared and computed SHA-256.
- `generatedAt`, fetched-at time, reporting window, and freshness status.
- AWS account, region, and selected read-only profile.
- Validation result and any unresolved fields.

## Refresh ownership

The source owner owns snapshot updates. Hoothoot owns snapshot verification,
report transformation, UI, and protected publishing.

Support either:

- on-demand report refresh after a source snapshot update; or
- an explicit event from the source updater that starts report refresh.

Do not add a recurring schedule unless the user requests one.
