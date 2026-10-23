# Marketplace image access contract

A product whose Marketplace bundle runs prebuilt container images pulls them from Prism
Marketplace's image registry: ECR repositories under `marketplace/` in account `848665034107`,
`us-east-2`. Today that is `marketplace/persist`, for Persist's Fargate images. An install gets
pull access itself. Nobody grants it by hand.

## How an install gets access

- The product stack holds a custom resource that asks Marketplace's image access API for access:
  a SigV4-signed `PUT /image-access/{repository}?install=<CloudFormation StackId>` on
  Create/Update, and `DELETE` on Delete. In Persist that is `Custom::MarketplaceImageAccess` in
  `NeptuneStack`, which every image-running stack depends on, and the API URL is
  `imageAccessApiUrl` in `marketplace/container-images.json`.
- Marketplace grants the account that signed the request; nothing in the request names an
  account. A grant is held by the installs that asked for it and is revoked when the last one
  releases it, so two installs in one account keep pulling while either exists.
  `GET /image-access`, signed by the account, lists its grants and their installs.
- Marketplace admits the accounts of AWS Organization `o-uhckriw4i8` and the customer-managed
  accounts outside it listed in Marketplace's `IMAGE_ACCESS_CUSTOMER_ACCOUNT_IDS`.

## When an install is refused

A refused grant fails the install at that custom resource. The CloudFormation status reason
carries Marketplace's reason, for example
`Marketplace refused pull access to marketplace/persist (HTTP 403): …`:

- `403`: the account is outside the organization and not listed. Have Marketplace's owners add
  it to `IMAGE_ACCESS_CUSTOMER_ACCOUNT_IDS` and deploy Marketplace, then retry the install.
- `404 REPOSITORY_NOT_FOUND`: the repository is not in Marketplace's `imageRepositories`. That
  is a Marketplace change for Regigigas.
- `409 REPOSITORY_POLICY_FULL`: the policy would exceed ECR's size limit. Report it to
  Regigigas.

When an image can't be pulled at run time, Persist async Gremlin queries fail within seconds
with `GremlinAsyncWorkerImagePullFailed` (execution `FAILED` at `WorkerDidNotRun`). Check the
account's grant with `GET /image-access` before suspecting the image.

## Rules

- Never edit the registry repository policy by hand. Marketplace owns its
  `MarketplaceImageAccessPull` (organization, `aws:PrincipalOrgID` condition) and
  `MarketplaceImageAccessCustomerPull` statements and rebuilds them on every grant, release and
  Marketplace deploy. It leaves hand-written statements alone; remove an account from one once
  it has a managed grant.
- Never call `PUT /image-access` by hand to unblock an install: no stack would release that
  hold. Fix the cause and rerun the install.
- `IMAGE_ACCESS_CUSTOMER_ACCOUNT_IDS` is the whole list on every Marketplace deploy. An account
  left out is de-listed: that deploy deletes its grants, and the API refuses its later requests,
  including its installs' `DELETE` on stack delete.
- Update a product's images by copying the release images into its `marketplace/` repository by
  digest (`docker buildx imagetools create`, which keeps the digest), then a product pull
  request that changes the pinned digests (Persist: `marketplace/container-images.json`).
- Revoking access when an account is retired without uninstalling is out of scope. An account
  that leaves the organization loses access through the `aws:PrincipalOrgID` condition; a
  customer account loses it when it is de-listed.
