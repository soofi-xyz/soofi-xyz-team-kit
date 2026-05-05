---
name: build-bootstrap-cli
description: "Guides building the Bootstrap CLI — the operator-run TypeScript tool that turns a freshly provisioned Account tenant into a self-deploying tenant environment by installing the first Deployer locally, then installing Marketplace Puller through that Deployer. Triggers on: bootstrap cli, bootstrap environment, initial tenant bootstrap, install deployer, install marketplace puller, self-deploying tenant, account bootstrap manifest."
---

# Building the Bootstrap CLI

Use this skill when building or refactoring the Bootstrap CLI, the operator-run tool that closes the initial "no Deployer exists yet" gap for a newly provisioned tenant.

The authoritative blueprint is in [`reference/PRD.md`](./reference/PRD.md). Consult it for the current command surface, Account and Marketplace contracts, local Deployer install rules, resume-state requirements, and verification flow before implementation.

## What This Product Owns

1. Reading tenant bootstrap state from Account via `GET /accounts/{account_id}/bootstrap-manifest`.
2. Resolving the Deployer and Marketplace Puller system-component bundles from Marketplace.
3. Installing the first Deployer locally with the operator's AWS profile or SSO credentials.
4. Installing Marketplace Puller through the newly live Deployer API.
5. Verifying the tenant is self-deploying through Deployer and Puller information endpoints.

Bootstrap is a CLI artifact, not a hosted service. Do not add Lambda runtimes, API Gateway routes, Step Functions, queues, or persistent cloud databases for the CLI itself.

## Required Companion Skills

Load these skills with Bootstrap work:

- [`apply-engineering-guidelines`](../apply-engineering-guidelines/) for TypeScript, testing, observability, and packaging standards.
- [`build-tenant-account-manager`](../build-tenant-account-manager/) for the Account bootstrap-manifest and service-key contracts.
- [`build-saas-marketplace`](../build-saas-marketplace/) for system-component bundle discovery.
- [`build-product-deployer`](../build-product-deployer/) for the local Deployer install and `/infra-deployer/deploy-by-token` handoff.
- [`build-marketplace-puller`](../build-marketplace-puller/) for Puller installation and health verification.

## Non-Negotiable Principles

1. **Local mode is only for the first Deployer.** Once Deployer is live, Puller and all later products go through `/infra-deployer/deploy-by-token`.
2. **Bootstrap does not provision tenants.** Account owns AWS sub-accounts, DNS, ACM certificates, and service keys.
3. **Bootstrap does not mutate Marketplace bundles.** It resolves and consumes released system-component bundles only.
4. **Do not persist secrets.** State files must contain non-secret resume metadata only; never store plaintext API keys, AWS credentials, service keys, presigned bundle URLs, or subscription signing secrets.
5. **Plan before writes.** `bootstrap plan` must validate inputs and print the intended Account, Marketplace, local Deployer, and Puller actions without side effects.

## Verification

Verify the full bootstrap story:

1. `bootstrap plan` resolves the Account manifest and system-component bundles without writes.
2. `bootstrap environment` installs Deployer locally, waits for Deployer health, deploys Puller through Deployer, then waits for Puller health.
3. `bootstrap resume` continues from a non-secret state file after an interrupted run.
4. `bootstrap status` reports Account manifest availability plus Deployer and Puller endpoint health.
5. Failure cases cover missing manifest, expired bundle URL, AWS identity mismatch, failed Deployer deploy, failed Puller health, and interrupted resume.
