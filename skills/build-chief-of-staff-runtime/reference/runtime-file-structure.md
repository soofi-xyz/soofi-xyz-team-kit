# Canonical Runtime File Structure

Use this layout when `chief-of-staff` is asked to scaffold the backend in another repo.

```text
chief-of-staff-runtime/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .github/
│   └── workflows/
│       └── ci.yml
├── infra/
│   ├── bin/
│   │   └── chief-of-staff.ts
│   └── lib/
│       └── chief-of-staff-stack.ts
├── src/
│   ├── contracts/
│   │   ├── schemas.ts
│   │   └── policies.ts
│   ├── handlers/
│   │   ├── get-linked-account-status.ts
│   │   ├── get-scope-and-session-state.ts
│   │   ├── get-sync-health.ts
│   │   └── retrieve-executive-context.ts
│   └── lib/
│       ├── connect/
│       ├── persist/
│       ├── retrieval/
│       ├── session/
│       ├── sync/
│       └── observability/
└── test/
    ├── contracts/
    ├── handlers/
    ├── integration/
    └── infra/
```
