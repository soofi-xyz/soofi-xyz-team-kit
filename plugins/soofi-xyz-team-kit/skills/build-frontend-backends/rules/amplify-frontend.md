---
title: Amplify Frontend Deployment
impact: HIGH
tags: amplify, frontend, deployment, aws, hosting, multi-app
---

# Amplify Frontend Deployment

Each frontend app in the monorepo deploys as its own **AWS Amplify** application. Amplify handles build, deploy, preview environments, and CDN distribution.

## One Amplify App Per Frontend

Every directory under `apps/` that serves a frontend (e.g., `apps/web/`, `apps/admin/`) gets its own Amplify app. Do NOT bundle multiple frontends into a single Amplify app.

## Amplify Build Configuration

Each frontend app needs an `amplify.yml` in its directory (or configured in the Amplify Console):

**apps/web/amplify.yml:**

```yaml
version: 1
applications:
  - appRoot: apps/web
    frontend:
      phases:
        preBuild:
          commands:
            - cd ../..
            - npm install -g pnpm
            - pnpm install --frozen-lockfile
        build:
          commands:
            - cd ../..
            - pnpm turbo run build --filter=web...
      artifacts:
        baseDirectory: dist
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
          - ../../node_modules/**/*
```

The key points:

- **preBuild** installs dependencies from the monorepo root using pnpm
- **build** uses `turbo run build --filter=<app-name>...` — the `...` suffix ensures all workspace dependencies are built first (including `packages/api-client/` and `packages/shared/`)
- **artifacts** points to the app's build output directory

## Environment Variables

Configure API URLs per Amplify branch/environment:

| Variable | Production | Development |
| --- | --- | --- |
| `VITE_API_URL` (Vite) | `https://api.springoakscapital.com/<app-base-path>` | `https://api-dev.ai.springoakscapital.com/<app-base-path>` |
| `NEXT_PUBLIC_API_URL` (Next.js) | Same pattern | Same pattern |

Set these in the Amplify Console under **Environment Variables**, not in code.

## CDK-Managed Amplify (Optional)

Amplify apps can also be defined in CDK for full infrastructure-as-code:

```typescript
import * as amplify from 'aws-cdk-lib/aws-amplify';

const webApp = new amplify.CfnApp(this, 'WebApp', {
  name: 'my-project-web',
  repository: 'https://github.com/org/my-project',
  oauthToken: cdk.SecretValue.secretsManager('github-token').unsafeUnwrap(),
  environmentVariables: [
    { name: 'VITE_API_URL', value: apiUrl },
  ],
});

new amplify.CfnBranch(this, 'MainBranch', {
  appId: webApp.attrAppId,
  branchName: 'main',
});
```

## ✅ Correct

```
apps/
├── web/                # → Amplify app "my-project-web"
│   ├── amplify.yml
│   ├── src/
│   └── package.json
└── admin/              # → Amplify app "my-project-admin"
    ├── amplify.yml
    ├── src/
    └── package.json
```

## ❌ Incorrect

```yaml
# ❌ Building only the app without workspace dependencies
build:
  commands:
    - npm run build          # Misses shared packages
    # Should use: pnpm turbo run build --filter=web...

# ❌ Hardcoding API URLs in source code
const API_URL = 'https://api.springoakscapital.com/my-app';
# Should use: import.meta.env.VITE_API_URL

# ❌ Single Amplify app serving multiple frontends
# Each frontend MUST be its own Amplify app
```

## References

- [AWS Amplify Hosting — Monorepo Setup](https://docs.aws.amazon.com/amplify/latest/userguide/build-settings.html)
