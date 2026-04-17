---
title: External System Response Validation
impact: CRITICAL
tags: validation, response, external-system, api, delivery, zod, pydantic
---

## External System Response Validation

When writing data to any external system (API, database, third-party service), ALWAYS validate the response to confirm the data was accepted.

### What to Validate

- **HTTP status code:** Expect 2xx. Any other status is a failure — do not silently ignore.
- **Response body:** Parse and validate the response body with a schema (Zod for TypeScript, Pydantic for Python). Some APIs return 200 with an error in the body — a schema catch this.
- **Record counts:** If sending a batch, verify the number of accepted records matches what was sent.

### How to Validate

| Language | Library |
| --- | --- |
| TypeScript | **Zod** — define a schema for the expected response shape |
| Python | **Pydantic** — define a model for the expected response shape |

### ✅ Correct

```typescript
import { z } from 'zod';

const TargetResponse = z.object({
  status: z.literal('ok'),
  accepted: z.number(),
  ids: z.array(z.string()),
});

const response = await fetch(targetUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  throw new Error(`Target system rejected data: ${response.status} ${await response.text()}`);
}

const parsed = TargetResponse.safeParse(await response.json());
if (!parsed.success) {
  throw new Error(`Unexpected response shape: ${parsed.error.message}`);
}

if (parsed.data.accepted !== payload.records.length) {
  throw new Error(
    `Partial acceptance: sent ${payload.records.length}, accepted ${parsed.data.accepted}`
  );
}
```

```python
from pydantic import BaseModel
import requests

class TargetResponse(BaseModel):
    status: str
    accepted: int
    ids: list[str]

response = requests.post(target_url, json=payload)
response.raise_for_status()

parsed = TargetResponse.model_validate(response.json())

if parsed.accepted != len(payload["records"]):
    raise ValueError(
        f"Partial acceptance: sent {len(payload['records'])}, accepted {parsed.accepted}"
    )
```

### ❌ Incorrect

```typescript
// Fire-and-forget — no response validation
await fetch(targetUrl, {
  method: 'POST',
  body: JSON.stringify(payload),
});
// No status check, no body check — data may have been rejected silently
```

```typescript
// Only checking status code — ignoring partial failures and not validating shape
const response = await fetch(targetUrl, { method: 'POST', body: JSON.stringify(payload) });
if (response.ok) {
  return; // API returned 200 but only accepted 3 of 100 records
}
```

```typescript
// Casting response without validation — trusts the API blindly
const result = (await response.json()) as TargetResponse;
// If the shape changed or the API returned an error object, this silently passes
```

```python
# Fire-and-forget — no response validation
requests.post(target_url, json=payload)
# No status check, no body parsing — data may have been rejected silently
```

```python
# Accessing response fields without schema validation
response = requests.post(target_url, json=payload)
response.raise_for_status()
result = response.json()
print(result["accepted"])  # KeyError if shape changed, no type safety
```

### References

- [Zod documentation](https://zod.dev)
- [Pydantic documentation](https://docs.pydantic.dev)
- [Step Functions error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
