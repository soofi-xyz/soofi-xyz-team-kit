---
name: use-elephant-query-db
description: "User guide for consuming the Vercel Neon Postgres database named elephant-query-db: Vercel environment setup, schema imports from @elephant-xyz/query-db, and exact TypeScript/Drizzle query code for appraisal parcels/properties, Accela permits, BBB contractor reputation/quality scores, Sunbiz companies, and addresses. Use when building Vercel apps, route handlers, dashboards, reports, or agents that query Elephant oracle data. Not for changing loaders or schema migrations."
---

# Use Elephant Query DB

Use this skill when the task is to read from the deployed Elephant query database from a Vercel app or other TypeScript service.

Do not use this skill to change the database schema, loader, migrations, or S3 ingestion. For those tasks, work in the `elephant-query-db` package directly.

## Always Read First

1. Read [`reference/vercel-neon.md`](./reference/vercel-neon.md) for the exact Vercel resource name, team, env vars, and connection rules.
2. Read [`reference/schema-and-queries.md`](./reference/schema-and-queries.md) for the schema imports, exact schema-file snapshot, and query code.

## Non-Negotiables

- Use the Vercel Neon resource named `elephant-query-db`.
- Read credentials from Vercel-provided environment variables, normally `DATABASE_URL`.
- Never hard-code or print database credentials.
- Keep database access in server-only code: API routes, route handlers, server actions, background jobs, or trusted agents.
- Prefer schema objects from `@elephant-xyz/query-db` when that package is available.
- If the target project cannot consume the package yet, reuse the exact schema snapshot in [`reference/query-db-schema/`](./reference/query-db-schema/) instead of rewriting table definitions.
- Do not copy SQL DDL into app code.
- Prefer Drizzle query builder code from the reference file. Use raw SQL only for one-off diagnostics or when Drizzle cannot express the query cleanly.
- Query logical tables and views first; use `source_payload` only for evidence/debug views or fields not promoted to typed columns yet.

## Expected Output

When answering or coding with this skill, return:

- The Vercel resource name and env var used.
- The schema objects imported.
- The exact route/function/file code needed for the requested query.
- The query path, for example parcel -> property -> permits, permit -> inspections/contacts/links, company -> BBB reputation/contractor score, or company -> business registrations.
- Any missing dependency or env setup commands the caller must run.
