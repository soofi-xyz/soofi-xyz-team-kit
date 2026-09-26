---
title: Testing Strategy and Quality Assurance
impact: HIGH
tags: testing, vitest, pytest, ci, github-actions, mocking, unit, integration
---

## Testing Strategy and Quality Assurance

### Testing Pyramid

| Layer | Share | Scope | Cost |
| --- | --- | --- | --- |
| Unit tests | ~70% | Individual functions and logic in isolation | Fast, cheap |
| Integration tests | ~30% | Modules working together (e.g., DB + API) | Slower, higher confidence |

### Tooling

| Concern | TypeScript | Python |
| --- | --- | --- |
| Test framework | **Vitest** | **Pytest** |
| Formatter | **Prettier** | **Ruff** |
| Linter | **ESLint** | **Ruff** |
| Type checker | **tsc** | **basedpyright** |
| AWS mocking | [**aws-sdk-client-mock**](https://www.npmjs.com/package/aws-sdk-client-mock) | [**moto**](https://docs.getmoto.org/en/latest/) |

### CI/CD

- All tests MUST pass in **GitHub Actions** before merge.
- Formatting checks MUST be part of CI.
- Type checking MUST be part of CI.

### Mock Guidance

- **Prefer real integrations** when practical.
- If a database can be started in a container for tests, prefer that over heavy mocking.
- Use the approved AWS mock libraries listed above.

### ✅ Correct

```typescript
// Vitest test with aws-sdk-client-mock
import { describe, it, expect } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('getUser', () => {
  it('returns user when found', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { id: '123', name: 'Alice' },
    });

    const result = await getUser('123');
    expect(result).toEqual({ id: '123', name: 'Alice' });
  });
});
```

```python
# Pytest test with moto
import boto3
import pytest
from moto import mock_aws

@mock_aws
def test_upload_to_s3():
    s3 = boto3.client("s3", region_name="us-east-2")
    s3.create_bucket(
        Bucket="test-bucket",
        CreateBucketConfiguration={"LocationConstraint": "us-east-2"},
    )
    s3.put_object(Bucket="test-bucket", Key="data.json", Body=b'{"ok": true}')
    response = s3.get_object(Bucket="test-bucket", Key="data.json")
    assert response["Body"].read() == b'{"ok": true}'
```

### ❌ Incorrect

```typescript
// Using Jest instead of Vitest — violates Golden Path
import { jest } from '@jest/globals';

// Manually stubbing AWS SDK instead of using aws-sdk-client-mock
const mockDynamo = { get: jest.fn() };
```

### References

- [Vitest](https://vitest.dev/)
- [Pytest](https://docs.pytest.org/)
- [aws-sdk-client-mock](https://www.npmjs.com/package/aws-sdk-client-mock)
- [moto](https://docs.getmoto.org/en/latest/)
