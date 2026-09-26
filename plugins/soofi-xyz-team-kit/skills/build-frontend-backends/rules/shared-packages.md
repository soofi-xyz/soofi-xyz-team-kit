---
title: Shared Packages & Modules
impact: CRITICAL
tags: shared, packages, modules, api-client, trpc-client, code-reuse, dry
---

# Shared Packages & Modules

When multiple frontend apps need the same logic — **especially backend interaction** — that logic MUST be extracted into a shared package under `packages/`. This is non-negotiable. Duplicating tRPC client setup, type definitions, or business logic across apps creates drift and type-safety gaps.

## The Extraction Rule

Ask this question for every piece of code: **"Does more than one app need this?"** If yes — or if it will — move it to a package.

Priority for extraction (highest first):

1. **tRPC client setup and `AppRouter` type** → `packages/api-client/`
2. **Backend interaction hooks / utilities** → `packages/api-client/`
3. **Shared business logic** (validation, formatting, constants) → `packages/shared/`
4. **Shared UI components** (if applicable) → `packages/ui/`
5. **TypeScript configs** → `packages/tsconfig/`

## The API Client Package

This is the most important shared package. It provides a typed tRPC client that all frontend apps import.

**packages/api-client/package.json:**

```json
{
  "name": "@my-project/api-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./react": {
      "types": "./src/react.ts",
      "default": "./src/react.ts"
    }
  },
  "dependencies": {
    "@trpc/client": "^11.0.0",
    "@trpc/react-query": "^11.0.0",
    "@tanstack/react-query": "^5.0.0"
  },
  "devDependencies": {
    "@my-project/tsconfig": "workspace:*",
    "typescript": "^5.7.0"
  }
}
```

**packages/api-client/src/index.ts:**

```typescript
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../apps/api/src/routers';

// Re-export the router type for consumers
export type { AppRouter };

export function createApiClient(baseUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl,
      }),
    ],
  });
}
```

**packages/api-client/src/react.ts** (for React apps):

```typescript
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../apps/api/src/routers';

export const trpc = createTRPCReact<AppRouter>();
```

## Using the Shared Client in Apps

Every frontend app imports from the shared package — never creates its own client:

```typescript
// apps/web/src/lib/api.ts
import { trpc } from '@my-project/api-client/react';

export { trpc };

// apps/admin/src/lib/api.ts
import { trpc } from '@my-project/api-client/react';

export { trpc };
```

Both apps get the same typed client. When the backend adds a new procedure, both apps see it immediately through the shared `AppRouter` type.

## The Shared Logic Package

**packages/shared/package.json:**

```json
{
  "name": "@my-project/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "devDependencies": {
    "@my-project/tsconfig": "workspace:*",
    "typescript": "^5.7.0"
  }
}
```

Put shared constants, validation schemas, formatting utilities, and domain logic here:

```typescript
// packages/shared/src/index.ts
export { formatCurrency, formatDate } from './formatters';
export { ROLES, PERMISSIONS } from './constants';
export { validateEmail, validatePhone } from './validators';
```

## ✅ Correct

```typescript
// Both apps import from the shared package
// apps/web/src/components/UserList.tsx
import { trpc } from '@my-project/api-client/react';
import { formatCurrency } from '@my-project/shared';

// apps/admin/src/components/UserTable.tsx
import { trpc } from '@my-project/api-client/react';
import { formatCurrency } from '@my-project/shared';
```

## ❌ Incorrect

```typescript
// ❌ Each app creates its own tRPC client
// apps/web/src/lib/trpc.ts
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../../api/src/routers'; // direct relative import

// apps/admin/src/lib/trpc.ts
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../../api/src/routers'; // duplicated!

// ❌ Copying validation logic between apps
// apps/web/src/utils/validate.ts
export function validatePhone(phone: string) { /* ... */ }

// apps/admin/src/utils/validate.ts
export function validatePhone(phone: string) { /* ... */ } // duplicated!

// ❌ Using JavaScript
// packages/shared/src/utils.js — MUST be .ts
```

## References

- [pnpm Workspace Protocol](https://pnpm.io/workspaces)
- [Turborepo Internal Packages](https://turbo.build/repo/docs/core-concepts/internal-packages)
