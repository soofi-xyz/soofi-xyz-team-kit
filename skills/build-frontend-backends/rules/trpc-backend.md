---
title: tRPC Backend on Lambda
impact: CRITICAL
tags: trpc, lambda, api, typescript, zod, router, aws-lambda-adapter
---

# tRPC Backend on Lambda

The backend API MUST use tRPC with the AWS Lambda adapter. This gives end-to-end type safety from the Lambda handler all the way to the frontend components.

For comprehensive tRPC documentation, read: `https://trpc.io/llms.txt`

For the AWS Lambda adapter reference: `https://trpc.io/docs/server/adapters/aws-lambda`

## Lambda Handler Entry Point

**apps/api/src/handler.ts:**

```typescript
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { CreateAWSLambdaContextOptions } from '@trpc/server/adapters/aws-lambda';
import { awsLambdaRequestHandler } from '@trpc/server/adapters/aws-lambda';
import { appRouter } from './routers';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'my-api' });
const tracer = new Tracer({ serviceName: 'my-api' });
const metrics = new Metrics({ serviceName: 'my-api', namespace: 'MyApi' });

const createContext = ({
  event,
  context,
}: CreateAWSLambdaContextOptions<APIGatewayProxyEventV2>) => ({
  event,
  context,
  logger,
  tracer,
  metrics,
});

export type Context = Awaited<ReturnType<typeof createContext>>;

export const handler = awsLambdaRequestHandler({
  router: appRouter,
  createContext,
});
```

## tRPC Initialization

**apps/api/src/trpc.ts:**

```typescript
import { initTRPC } from '@trpc/server';
import type { Context } from './handler';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
```

## Router Structure

Organize routers by domain. Each router file defines related procedures. The root router merges them all.

**apps/api/src/routers/index.ts:**

```typescript
import { router } from '../trpc';
import { usersRouter } from './users';
import { projectsRouter } from './projects';

export const appRouter = router({
  users: usersRouter,
  projects: projectsRouter,
});

export type AppRouter = typeof appRouter;
```

**apps/api/src/routers/users.ts:**

```typescript
import { z } from 'zod';
import { router, publicProcedure } from '../trpc';

export const usersRouter = router({
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      ctx.logger.info('Fetching user', { userId: input.id });
      // ... fetch user
      return { id: input.id, name: 'Alice' };
    }),

  create: publicProcedure
    .input(z.object({ name: z.string(), email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      ctx.logger.info('Creating user', { name: input.name });
      // ... create user
      return { id: 'new-id', ...input };
    }),
});
```

## Input Validation

Use **Zod** for all procedure inputs. Define reusable schemas in a shared location when used across multiple routers.

```typescript
import { z } from 'zod';

// Define schemas alongside procedures or in a shared schemas file
const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
});

export const projectsRouter = router({
  list: publicProcedure
    .input(paginationSchema)
    .query(async ({ input }) => {
      // input is fully typed: { cursor?: string; limit: number }
    }),
});
```

## Observability

Every Lambda handler MUST initialize Powertools Logger, Tracer, and Metrics (per `apply-engineering-guidelines`). Pass them through the tRPC context so every procedure has access.

## ✅ Correct

```typescript
// Routers organized by domain, merged in index.ts
// Zod validation on all inputs
// Powertools in context
// AppRouter type exported for frontend

import { awsLambdaRequestHandler } from '@trpc/server/adapters/aws-lambda';

export const handler = awsLambdaRequestHandler({
  router: appRouter,
  createContext,
});
```

## ❌ Incorrect

```typescript
// ❌ Express adapter instead of Lambda adapter
import { createExpressMiddleware } from '@trpc/server/adapters/express';

// ❌ No input validation
const getUser = publicProcedure.query(() => { /* ... */ });

// ❌ console.log instead of Powertools Logger
console.log('Processing request');

// ❌ JavaScript file
// handler.js — MUST be .ts

// ❌ Single monolithic router file with all procedures
// Split by domain into separate files
```

## References

- [tRPC Documentation](https://trpc.io/llms.txt)
- [tRPC AWS Lambda Adapter](https://trpc.io/docs/server/adapters/aws-lambda)
- [Zod](https://zod.dev)
