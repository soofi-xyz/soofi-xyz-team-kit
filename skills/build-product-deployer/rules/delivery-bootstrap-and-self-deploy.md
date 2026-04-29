---
title: Bootstrap and Self-Deploy
impact: HIGH
tags: [delivery, bootstrap, self-host]
---

# Bootstrap and Self-Deploy

The Deployer is itself a marketplace component, but it has a chicken-and-egg problem: nothing else can deploy it the first time. Solve it explicitly with a one-shot bootstrap.

## Bootstrap Sequence

Run from an operator workstation or a marketplace-bootstrap CodeBuild project, with marketplace-account admin credentials.

1. **Bootstrap CDK** in the marketplace account: `cdk bootstrap aws://<marketplace-account>/<region>`.
2. **Synthesize the Deployer component** locally: `cdk synth` in the deployer repo.
3. **Apply the Deployer stack via `cdk deploy`** (uses the `cdk-pipelines-bootstrap` adapter conceptually — i.e. direct `cdk deploy`, no marketplace API). Outputs:
   - SQS queue ARN
   - Step Function ARN
   - SSM `/marketplace/deployer/queue-arn`, `/marketplace/deployer/state-machine-arn`
4. **Register the just-deployed Deployer artifact** with the marketplace registry (`POST /components/deployer/versions` with the synthesized template + assets).
5. **Release that version** (`POST /components/deployer/release`).
6. **Self-deploy** — manually enqueue an intent `(deployer, <bootstrap-version>, marketplace-self)` onto the deployer's own SQS queue with parameters that re-deploy the same template into the marketplace account. The Step Function should detect `parameters_digest` matches the live stack and short-circuit to `noop`.
7. **From now on**, every new version of the Deployer is deployed by the previous version. The bootstrap path is never used again.

## Self-Deploy Verification

- `Deployments` table contains a row with `component=deployer`, `version=<bootstrap-version>`, `env_slug=marketplace-self`, `status=succeeded`.
- Subsequent `release deployer` operations produce a new `Deployments` row, and the live Step Function ARN is unchanged (in-place update via CFN).

## Smoke Tests After Bootstrap

1. Register a trivial echo component, release it, subscribe a throwaway tenant. The Deployer must produce a `Deployments` row with `status=succeeded` and the stack must exist in the tenant.
2. Register the same `(component, version)` again with a different `Idempotency-Key` — the registry rejects (immutability), and no Deployer execution starts.
3. Re-enqueue the same `(component, version, env_slug)` — the Step Function execution short-circuits to `noop` within 5 seconds.
4. Trigger a release of a new version — the Deployer executes the StackSet update; subscribers get the new version.

## Rules

1. **Bootstrap is one-shot.** After step 6, the `cdk deploy` path MUST be retired. Operators with marketplace-admin creds MUST go through the marketplace API.
2. **Bootstrap version of the Deployer is preserved as the disaster-recovery artifact** in S3 with object lock enabled. If the live Deployer is somehow destroyed, the same bootstrap path can be replayed.
3. **The bootstrap script lives in the deployer repo as `bin/bootstrap.ts`** and is the only sanctioned automation outside the marketplace API.
