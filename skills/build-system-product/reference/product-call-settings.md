# Product-call settings under load

`ProductCallFn` sends every shared-domain step: it resolves the shared domain from
Parameter Store (`/account/env-parameters`) and the shared API key from Secrets
Manager, then calls `https://<domain><path>`. Treat those two reads as part of the
step's reliability, not as free configuration lookups.

This is a requirement for the System engine, not evidence of deployment. Verify
the target revision and its install parameters before claiming any part of it is
in place.

## Why it matters

Parameter Store throttles `GetParameter` per account and region, shared by every
caller, unless the account enables its high-throughput setting. A burst of flow
runs (an event trigger echoing tens of thousands of graph edges, or a backfill)
multiplies one read per product call into hundreds per second. The AWS SDK gives
up after about a second and the step fails with a raw `ThrottlingException`.
Templates retry `Product.Unavailable`; no template names `ThrottlingException`,
so the step and the run fail at once and the event that started it is not resent.

Observed in PROD on 2026-11-05 for `System-sms-optout-interprose`: 9,547 of
33,258 runs failed at 02:00 UTC and 19,778 of 27,671 at 09:00 UTC, every sampled
failure this `ThrottlingException` from `ProductCallFn`, while quiet hours failed
0 to 5 runs.

## Rules

- Do not read Parameter Store on every product call without an opt-in cache.
  Cache `/account/env-parameters` in the warm function for a bounded TTL set by an
  optional install parameter (default 0 = read every call, as before). Never cache
  a missing value, so a domain set later is picked up on the next call.
- Do not cache the shared API key. Read it from Secrets Manager on every call so a
  rotated key is used immediately; a stale key fails as `401`/`403`, which
  templates do not retry.
- Name a transient settings-read failure so templates can retry it: throttling,
  `429`/`5xx` and network or timeout errors become `Product.Unavailable`. Keep a
  missing value `Product.NotConfigured` and leave access-denied or decryption
  failures as they are. Renaming an error changes which `Retry` or `Catch` an
  existing template takes, so ship it behind the same opt-in parameter or list it
  under what existing installs see.
- Keep both changes opt-in per the no-changed-defaults rule, and test the default
  (both values read every call, raw SDK error unchanged), the enabled cache
  (reuse within the TTL, re-read after), the uncached key, and repeated calls in
  one warm instance.
- When a flow's runs fail in bursts, check `ProductCallFn` logs for
  `ThrottlingException` and the account's Parameter Store throughput setting
  before tuning the flow's own retries.

## Correct / incorrect

```ts
// Incorrect: one Parameter Store read per product call, raw SDK error on throttle.
const domain = sharedDomain(await ssm.send(new GetParameterCommand({ Name: ENV_PARAMETERS })));

// Incorrect: caches the shared key; a rotation fails calls until the TTL expires.
sharedApiKey: cachedSetting(readSharedKey, 300_000),

// Correct: opt-in TTL for the domain only, key read on every call,
// transient read failures named Product.Unavailable when the install opts in.
envParameters: cacheSeconds > 0 ? cachedSetting(readEnvParameters, cacheSeconds * 1000) : readEnvParameters,
sharedApiKey: readSharedKey,
```

Reference implementation: prismteam-ai/system#94 (`EnvParametersCacheSeconds`).
