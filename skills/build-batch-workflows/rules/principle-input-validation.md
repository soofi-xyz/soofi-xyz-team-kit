---
title: Input Data Validation
impact: CRITICAL
tags: validation, schema, input, zod, pydantic, data-quality
---

## Input Data Validation

Every batch workflow MUST validate input data before processing. Fail fast on invalid data — do not process garbage and produce garbage output.

### What to Validate

- **Schema:** Required fields present, correct types.
- **Constraints:** Values within expected ranges (e.g., positive amounts, valid dates).
- **Volume:** Record count within expected bounds (guards against empty inputs or runaway data).

### How to Validate

| Language | Library |
| --- | --- |
| TypeScript | **Zod** |
| Python (Lambda) | **Pydantic** |
| Python (Glue/PySpark) | Schema checks on DataFrame columns |

### ✅ Correct

```typescript
import { z } from 'zod';

const InputRecord = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  amount: z.number().positive(),
  timestamp: z.string().datetime(),
});

type InputRecord = z.infer<typeof InputRecord>;

function validateRecord(raw: unknown): InputRecord {
  return InputRecord.parse(raw); // Throws ZodError on invalid input
}
```

```python
from pydantic import BaseModel, field_validator
from datetime import datetime

class InputRecord(BaseModel):
    id: str
    name: str
    amount: float
    timestamp: datetime

    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('amount must be positive')
        return v
```

### ❌ Incorrect

```typescript
// No validation — trusting raw input blindly
const records = JSON.parse(event.body) as InputRecord[];
for (const record of records) {
  await process(record); // Will fail with cryptic errors on bad data
}
```

### References

- [Zod documentation](https://zod.dev)
- [Pydantic documentation](https://docs.pydantic.dev)
