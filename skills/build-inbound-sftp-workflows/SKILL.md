---
name: build-inbound-sftp-workflows
description: "Build inbound SFTP workflows on AWS. Covers gathering partner SFTP inputs, defining the secret and configuration contract, creating AWS infrastructure in Amazon CDK, implementing a Lambda poller, and validating listing and transfer behavior. Use when building an inbound SFTP integration from scratch, adapting an existing inbound flow, or verifying SFTP connection setup."
---

# Building Inbound SFTP Workflows

Step-by-step guide for designing and implementing inbound SFTP workflows in this repository ecosystem.

Use `reference/inbound-sftp-stack.ts` and `reference/index.py` as structural references only. Do NOT copy hostnames, secret ARNs, bucket names, paths, schedules, or any other partner-specific values from those files. Always build from the SFTP information the user gives you and fit that information into the reference shape.

## Workflow: Six Phases

Follow these phases in order. Do NOT skip ahead.

### Phase 1 — Gather the User Inputs

Before writing code, collect the connection contract.

1. **Ask for the required SFTP inputs:**
   - partner or vendor name
   - SFTP host or URL
   - username and password source
   - remote input directory
   - remote archive or processed directory, if any
   - destination bucket or storage target
   - destination prefix or folder
   - region
   - stack or service name
   - schedule or trigger behavior
   - concurrency or batching limits
2. **If any required input is missing, STOP and ask.** Do not guess partner values.
3. **Prefer user-provided values over reference values every time.**

### Phase 2 — Define the Configuration Contract

Define the runtime inputs before creating infrastructure.

1. **Create a clear secret contract.**
   Use `Username`, `Password`, and `Url` as the default secret keys when following the reference shape.
2. **Create a clear runtime config contract.**
   Include connector ID, target bucket, remote directory path, local directory base prefix, and transfer concurrency.
3. **Keep partner-specific values configurable.**
   Do not hardcode remote paths, buckets, prefixes, or schedules.
4. **Preserve target-project conventions when they already exist.**
   Match the project's naming, environment variable, and stack patterns.

### Phase 3 — Build the Infrastructure

For a new AWS implementation, use Amazon CDK. Start with the same architecture shape shown in `reference/inbound-sftp-stack.ts`.

1. **Create one AWS Transfer Family connector.**
2. **Create one IAM role for the connector.**
   It should support Secrets Manager reads and S3 access for listing and transfer output.
3. **Create one Lambda poller.**
4. **Create one IAM role for the poller.**
   It should support `transfer:StartDirectoryListing`, `transfer:DescribeDirectoryListing`, `transfer:StartFileTransfer`, and `transfer:DescribeConnector`.
5. **Create one schedule for automatic polling.**
6. **Keep one manual invocation path for connection testing.**

Use `reference/inbound-sftp-stack.ts` to preserve:

- resource types
- IAM responsibility boundaries
- environment variable shape
- connector-to-poller wiring

Do NOT reuse the sample values from the reference stack unless the user explicitly tells you to.

### Phase 4 — Implement the Runtime

For a new AWS implementation, follow the runtime behavior shown in `reference/index.py`.

1. Resolve config from the invocation event first, then environment variables.
2. Build deterministic dated output prefixes using `YYYY/MM/DD`.
3. Write directory listings under a `transfer-listings/` path.
4. Start a Transfer Family directory listing for the configured remote folder.
5. Poll listing status until completion or timeout.
6. Read the listing JSON from S3.
7. Extract file paths defensively from the listing payload.
8. Deduplicate file paths before starting transfers.
9. Start file transfers in parallel and retry throttling-style failures.
10. Return machine-readable results with counts, transfer IDs, listing location, and bounded errors.

Use `reference/index.py` to preserve the API sequence and behavior. Do NOT reuse its concrete bucket names, prefixes, defaults, or partner assumptions. If the target project is net new, prefer the project's approved language for the Lambda implementation and port the behavior rather than copying Python by default.

### Phase 5 — Test the Connection Safely

Validate the smallest possible happy path first.

1. Confirm the secret exists and contains the expected fields.
2. Confirm the destination bucket or storage path exists and is writable.
3. Deploy the stack or service.
4. Trigger one manual directory listing.
5. Confirm the listing artifact appears in the expected S3 location.
6. Transfer one known small file.
7. Confirm the file lands in the expected destination prefix.
8. Check logs for auth, path, permission, networking, and throttling errors.

Do not claim the connection works unless you actually ran a live listing or transfer.

### Phase 6 — Finish with a Clear Hand-Off

When finishing, always tell the user:

1. whether you built from scratch or adapted the reference structure
2. which partner-specific inputs were used
3. which inputs are still missing
4. which tests you ran
5. whether you validated wiring only or a live connection
6. any remaining setup such as secret creation, permissions, or schedule enablement

## Principles (Non-Negotiable)

### 1. Use the Reference for Shape, Not Values

Use `reference/inbound-sftp-stack.ts` and `reference/index.py` to preserve architecture and behavior. Do NOT copy sample values from them.

### 2. Build from User-Provided SFTP Information

Use the host, credentials, remote folders, destination, and schedule the user provides. If the user has not provided enough information, ask for it.

### 3. Keep the Listing-First Flow

List the remote directory before starting transfers. Use the listing artifact as the source for the transfer set.

### 4. Keep the Workflow Configurable

Treat partner values as configuration. Do not bury them in code constants.

### 5. Keep Results Deterministic and Machine-Readable

Use deterministic destination paths, structured logs, and bounded error payloads.

### 6. Validate with a Small Live Test

Run one listing and one small-file transfer before enabling the recurring schedule.

## Testing Guidance

Add or update tests that verify behavior without overfitting to one partner.

Good test areas:

- configuration parsing
- secret validation
- path and prefix generation
- listing parsing
- file-path deduplication
- retry behavior for transient transfer errors
- infrastructure-to-runtime wiring
- permissions or infrastructure wiring if those tests exist nearby

Prefer tests that validate behavior and contract, not tests that merely restate implementation details.

## Rules Summary

| Rule | Source | Impact |
| --- | --- | --- |
| Gather partner SFTP inputs before implementation | Phase 1 | CRITICAL |
| Use CDK and treat reference files as structure only | `reference/inbound-sftp-stack.ts`, `reference/index.py` | CRITICAL |
| Build the default AWS shape with connector + poller | Phase 3 | HIGH |
| Preserve the listing-first runtime flow | Phase 4, `reference/index.py` | CRITICAL |
| Validate with a live listing before claiming success | Phase 5 | CRITICAL |