---
title: Monorepo & Turborepo Setup
impact: CRITICAL
tags: monorepo, turborepo, pnpm, workspace, typescript
---

# Monorepo & Turborepo Setup

Every fullstack frontend + backend project MUST be organized as a Turborepo monorepo using pnpm workspaces. This enables shared types, shared logic, and consistent tooling across all apps.

## Root package.json

```json
{
  "name": "my-project",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.7.0"
  }
}
```

## pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

## turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

## Shared TypeScript Configs

Create `packages/tsconfig/` with base configurations:

**packages/tsconfig/base.json:**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "bundler",
    "module": "ESNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**packages/tsconfig/react.json:**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  }
}
```

**packages/tsconfig/node.json:**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"]
  }
}
```

## Internal Package References

Use the pnpm `workspace:*` protocol for all internal dependencies:

```json
{
  "dependencies": {
    "@my-project/api-client": "workspace:*",
    "@my-project/shared": "workspace:*"
  }
}
```

## ✅ Correct

```
project-root/
├── apps/
│   ├── web/           # Frontend app → Amplify
│   ├── admin/         # Another frontend → Amplify
│   └── api/           # tRPC backend → Lambda via CDK
├── packages/
│   ├── api-client/    # Shared tRPC client + AppRouter type
│   ├── shared/        # Shared business logic
│   └── tsconfig/      # Shared TS configs
├── package.json       # Workspace root with turbo scripts
├── pnpm-workspace.yaml
└── turbo.json
```

## ❌ Incorrect

```
# Separate repositories for frontend and backend — loses type sharing
frontend-repo/
backend-repo/

# Single app without workspace structure — can't share code
my-app/
├── src/
├── api/
└── package.json       # No workspaces, no turborepo

# Using npm/yarn without workspace protocol
"dependencies": {
  "@my-project/shared": "^1.0.0"  # ❌ Should be "workspace:*"
}

# Using JavaScript files
apps/web/src/utils.js  # ❌ Must be TypeScript
```

## References

- [Turborepo Handbook](https://turbo.build/repo/docs)
- [pnpm Workspaces](https://pnpm.io/workspaces)
