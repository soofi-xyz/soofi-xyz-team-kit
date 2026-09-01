# Vercel Neon Resource

## Resource Identity

- Vercel team/workspace: `elephant-xyz`
- Vercel Neon resource name: `elephant-query-db`
- Vercel resource ID: `store_B1a1SflhBXyo7LaB`
- Neon external resource ID: `raspy-frost-51580436`
- Neon installation ID: `icfg_X7iBTade9EBSqFZVQfHznUFW`
- Region: `iad1`
- Connected Vercel project used during provisioning: `website`

Do not embed the connection string in code or answers. Use Vercel environment variables.

## Local Setup

Use the Vercel project that is connected to the `elephant-query-db` resource:

```bash
vercel link --yes --team elephant-xyz --project website
vercel env pull .env.local --scope elephant-xyz --environment development --yes
```

Expected env vars from the Neon integration include:

```text
DATABASE_URL
DATABASE_URL_UNPOOLED
POSTGRES_URL
POSTGRES_URL_NON_POOLING
POSTGRES_PRISMA_URL
PGHOST
PGHOST_UNPOOLED
PGDATABASE
PGUSER
PGPASSWORD
```

Use `DATABASE_URL` for normal Vercel app queries. Use the unpooled URL only for migrations or long administrative sessions.

## Dependencies

Install the query-db schema package and Neon/Drizzle client dependencies in the Vercel app:

```bash
npm install @elephant-xyz/query-db drizzle-orm @neondatabase/serverless
```

If `@elephant-xyz/query-db` is not available from the package registry in the target project, add it as a workspace or repository dependency. Do not paste local schema definitions as a workaround.

## Runtime Rules

- Keep query code server-side.
- In Next.js route handlers, set `export const runtime = "nodejs";` unless the app has already verified Edge runtime support for its database client.
- Do not expose `DATABASE_URL` to browser bundles. It must not be prefixed with `NEXT_PUBLIC_`.
- For migrations, run the checked-in SQL migrations from the `@elephant-xyz/query-db` package or the source repository; do not let application code mutate schema at request time.
