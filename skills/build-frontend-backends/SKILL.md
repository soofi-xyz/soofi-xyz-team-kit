---
name: build-frontend-backends
description: "Guides creation of fullstack monorepo apps with Turborepo, AWS Amplify frontends, and tRPC + Lambda backends deployed via CDK. Covers monorepo structure, shared modules, tRPC routers, API Gateway custom domains, and multi-app deployment. Triggers on: frontend backend, fullstack app, trpc, turborepo, monorepo, amplify app, web app backend, api for frontend, multi-app monorepo."
---

# Building Frontend Backends

Step-by-step guide for building fullstack applications as a **Turborepo monorepo** with multiple frontend apps deployed to **AWS Amplify** and a shared **tRPC** backend running on **AWS Lambda** behind **API Gateway**, deployed via **CDK**.

## Prerequisites

Before starting any work, **load the `apply-engineering-guidelines` skill**. It defines the non-negotiable standards for CDK, observability (Powertools Logger/Tracer/Metrics), testing, and TypeScript usage that this skill builds on top of. Every rule in this skill assumes `apply-engineering-guidelines` is active.

## Non-Negotiables

1. **TypeScript everywhere.** Every app, package, Lambda, CDK stack, and shared module MUST be TypeScript. No exceptions.
2. **Monorepo with Turborepo.** All apps and packages live in one repository managed by Turborepo.
3. **Shared logic in packages.** When multiple frontend apps need the same logic — especially backend interaction — extract it into a shared package. Never duplicate tRPC client setup, types, or business logic across apps.
4. **tRPC for the API layer.** Use tRPC for end-to-end typesafe communication between frontend and backend. Read `https://trpc.io/llms.txt` for full tRPC documentation.
5. **CDK for infrastructure.** Follow the `apply-engineering-guidelines` skill — CDK is the only permitted IaC tool.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Turborepo Monorepo                    │
│                                                         │
│  apps/                                                  │
│  ├── web/            → Amplify (primary frontend)       │
│  ├── admin/          → Amplify (admin dashboard)        │
│  └── api/            → CDK Lambda (tRPC backend)        │
│                                                         │
│  packages/                                              │
│  ├── api-client/     → tRPC client + shared types       │
│  ├── shared/         → Business logic, utilities        │
│  └── tsconfig/       → Shared TypeScript configs        │
└─────────────────────────────────────────────────────────┘

Frontend apps ──(tRPC over HTTPS)──▶ API Gateway ──▶ Lambda
```

Each frontend app deploys independently to **AWS Amplify**. The backend deploys as a single **Lambda function** behind **API Gateway** with a custom domain, managed by CDK in the `apps/api/` directory.

## Workflow: Five Phases

Follow these phases in order. Each phase gates the next.

### Phase 1 — Initialize the Monorepo

Set up the Turborepo workspace structure.

Read `rules/monorepo-turborepo.md` for the complete monorepo setup including `package.json` workspace configuration, `turbo.json` pipeline definitions, and shared TypeScript configs.

### Phase 2 — Build the tRPC Backend

Create the API as a tRPC router deployed to Lambda via the AWS Lambda adapter.

- Use `@trpc/server` with the AWS Lambda adapter (`@trpc/server/adapters/aws-lambda`)
- Define routers and procedures with Zod input validation
- Structure routers by domain (e.g., `users.ts`, `projects.ts`)
- Export the `AppRouter` type for the frontend client packages

Read `rules/trpc-backend.md` for router structure, context creation, middleware patterns, and the Lambda handler setup.

### Phase 3 — Create the Shared API Client Package

Build a shared `packages/api-client/` that both frontend apps import:

- Exports a configured tRPC client using `httpBatchLink`
- Exports the `AppRouter` type from the backend
- Provides typed React hooks (if using React) or vanilla client
- Centralizes API URL configuration

Read `rules/shared-packages.md` for package structure and the shared module extraction rules.

### Phase 4 — Build the Frontend Apps

Each frontend app in `apps/` is a standalone application deployed to AWS Amplify:

- Import the shared API client from `packages/api-client/`
- Import shared business logic from `packages/shared/`
- Each app has its own `amplify.yml` or Amplify console configuration
- **Never duplicate backend interaction code** — always use the shared package

Read `rules/amplify-frontend.md` for Amplify deployment configuration.

### Phase 5 — CDK Infrastructure for the Backend

Deploy the tRPC Lambda behind API Gateway with custom domain mapping:

- API Gateway HTTP API (v2) with Lambda integration
- Custom domain with base path mapping per environment
- Follow `apply-engineering-guidelines` for Lambda configuration, observability, and tagging

Read `rules/cdk-api-infrastructure.md` for the full CDK stack template, custom domain setup, and environment-specific configuration.

## Repository Layout

```
project-root/
├── apps/
│   ├── web/                         # Primary frontend app
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── admin/                       # Admin frontend app (example)
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── api/                         # tRPC backend + CDK infra
│       ├── src/
│       │   ├── routers/             # tRPC routers by domain
│       │   │   ├── index.ts         # Root router (merges all)
│       │   │   ├── users.ts
│       │   │   └── projects.ts
│       │   ├── context.ts           # tRPC context creation
│       │   ├── trpc.ts              # tRPC init + middleware
│       │   └── handler.ts           # Lambda handler entry point
│       ├── cdk/
│       │   ├── bin/
│       │   │   └── app.ts           # CDK app entry
│       │   └── lib/
│       │       └── api-stack.ts     # API Gateway + Lambda + Domain
│       ├── package.json
│       ├── tsconfig.json
│       └── cdk.json
├── packages/
│   ├── api-client/                  # Shared tRPC client + types
│   │   ├── src/
│   │   │   ├── index.ts             # Client factory + type exports
│   │   │   └── react.ts             # React hooks (optional)
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── shared/                      # Shared business logic
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── tsconfig/                    # Shared TS configs
│       ├── base.json
│       ├── react.json
│       └── node.json
├── package.json                     # Workspace root
├── turbo.json                       # Turborepo pipeline config
└── tsconfig.json                    # Root TS config
```

## Key Conventions

- **TypeScript only** — every file in every app and package is `.ts` or `.tsx`. No `.js` files. No Python. No exceptions.
- **Turborepo** for task orchestration — `turbo run build`, `turbo run lint`, `turbo run test`
- **pnpm** as the package manager (workspace protocol)
- **Zod** for all input validation in tRPC procedures
- **Shared packages** use the `workspace:*` protocol for internal dependencies
- Follow `apply-engineering-guidelines` for Lambda observability (Powertools Logger, Tracer, Metrics)
- Follow `apply-engineering-guidelines` for CDK conventions (region `us-east-2`, cost tags, `cdk deploy`)

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Monorepo & Turborepo Setup | `rules/monorepo-turborepo.md` | CRITICAL |
| tRPC Backend on Lambda | `rules/trpc-backend.md` | CRITICAL |
| Shared Packages & Modules | `rules/shared-packages.md` | CRITICAL |
| Amplify Frontend Deployment | `rules/amplify-frontend.md` | HIGH |
| CDK API Infrastructure | `rules/cdk-api-infrastructure.md` | CRITICAL |
