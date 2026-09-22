# Self-contained Elephant ingestion verification

Use this evidence template for changes under `skills/use-oracle/runtime/`. The runtime
must work without sibling ingestion repositories, portal access, or credentials for
offline tests.

All commands assume repository root and Node 22.18+.

## Install

```bash
(cd skills/use-oracle/runtime && npm ci)
```

Record Node/npm versions and exit code. Use `npm ci` so the lockfile is authoritative.

## Offline replay

Run fixture capture, transform, validation, and internal reconciliation artifacts:

```bash
node skills/use-oracle/runtime/bin/elephant-county.mjs replay \
  --county pinellas \
  --fixture skills/use-oracle/runtime/fixtures/pinellas-replay \
  --output "$(mktemp -d)"

node skills/use-oracle/runtime/bin/elephant-county.mjs replay \
  --county duval \
  --fixture skills/use-oracle/runtime/fixtures/duval-replay \
  --output "$(mktemp -d)"
```

Or:

```bash
npm test --prefix skills/use-oracle/runtime
```

Record transformed/validated counts and reconciliation-artifact counts. Offline replay
does not upload, mutate a public pointer, update Atlas, or require Filebase credentials.

## Bounded live pilot

Run only after county readiness PASS. Require explicit `--live-fetch`, a one- or two-row
seed, approved egress, and an ignored scratch directory:

```bash
run_dir="$(mktemp -d)"
node skills/use-oracle/runtime/bin/elephant-county.mjs ingest \
  --county <key> \
  --seed <bounded-seed.csv> \
  --html-dir "$run_dir/html" \
  --live-fetch \
  --output "$run_dir"
```

Record scope, source, run manifest, and blockers. Never weaken readiness, CAPTCHA, terms,
or rate gates to make a pilot pass.

## Internal reconciliation export

When an enrichment or reconciliation test needs working Parquet/coverage artifacts:

```bash
node skills/use-oracle/runtime/bin/elephant-county.mjs reconcile-export \
  --county <key> \
  --seed <bounded-seed.csv> \
  --run "$run_dir" \
  --output "$working_dir"
```

Keep these artifacts private and ignored. They are not publication output and must not be
uploaded or wired into MCP.

## Atlas publication

Use Elephant CLI, not the runtime, for public output. Follow
[`car-publication.md`](./car-publication.md):

1. validate each group directory;
2. hash one CAR per county/data group;
3. validate each CAR;
4. export normalized tables and the Atlas page;
5. upload CAR and tables with gateway readback;
6. open the one-file Atlas county PR;
7. verify merge, global Atlas IPNS, and MCP 2.0 sync.

Do not execute live upload or PR commands merely to verify a runtime code change. Record
the exact human/operator command and state why it was not run when credentials or public
mutation are out of scope.

## Clean-room gate

```bash
tmp="$(mktemp -d)"
git clone --no-local . "$tmp/soofi-xyz-team-kit"
(cd "$tmp/soofi-xyz-team-kit/skills/use-oracle/runtime" && npm ci)
npm test --prefix "$tmp/soofi-xyz-team-kit/skills/use-oracle/runtime"
"$tmp/soofi-xyz-team-kit/scripts/validate-plugin.sh"
python3 "$tmp/soofi-xyz-team-kit/scripts/check-plugin-clean-room.py"
```

The gate checks:

- no tracked secrets or generated data;
- no runtime prerequisite on sibling source repositories;
- no oversized captured artifacts;
- no broken symlinks;
- no retired catalog/publication surface;
- Atlas MCP configuration and generated-agent consistency.

## Fixture size

Tracked runtime files must stay below 512 KiB except `package-lock.json`. Store real
captures, archives, and Parquet outside Git. Public CAR/table artifacts are uploaded by
the Atlas publication flow and referenced by CID.
