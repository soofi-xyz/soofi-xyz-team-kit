---
title: Marketplace targets
impact: HIGH
tags: marketplace, targets, prism, soc, api-key
---

# Marketplace targets

Registeel operates one named target per request. Both run the same
`prismteam-ai/marketplace` service; only the values below differ.

| | Prism Marketplace (default) | SOC Marketplace |
| --- | --- | --- |
| Base URL | `https://prism-marketplace.account.prismteam.ai/marketplace` | `https://soc-marketplace.springoakscapital.com/marketplace` — **not yet live** (after SOC DNS cutover) |
| Marketplace account | `848665034107`, `us-east-2` | `649445653420`, `us-east-2` |
| Build | `https://prism-marketplace.account.prismteam.ai/build` (same account) | SOC's Build in `649445653420` (Metang configures it); no URL pinned in this kit |
| Review Deploy | `257779860257`, host `https://review-sandbox.account.prismteam.ai` | `919643791264`, `https://soc-marketplace-review.springoakscapital.com/deploy` (host `https://soc-marketplace-review.springoakscapital.com`) |
| `MARKETPLACE_API_KEY` | `shared-environment` key on the shared usage plan (skill Prerequisites step 2) | The SOC-MARKETPLACE Account key (Account `a0064d81-c26d-48c5-880d-1cedeab56a11`) |
| Catalog | Prism products and their service bundles | SOC-specific configurations (for example SMS opt-out/opt-in, email, voicemail) and SOC-only products |

## SOC Marketplace catalog

SOC Marketplace takes products such as Connect from Prism Marketplace. It holds
a bare product entry for each (no service bundle) only so SOC configurations can
attach: Marketplace validates `configured_product_id` locally. Never publish a
Prism product's service bundle to SOC Marketplace, and never register SOC
configurations in Prism Marketplace.

SOC configuration bundles are built by SOC's Build in `649445653420` and
reviewed by SOC's review Deploy in `919643791264`. Never build a SOC bundle
with Prism Marketplace's Build.

## SOC Marketplace is not yet live

Before any SOC write, run the skill's key check (`GET /settings/status`)
against the SOC base URL. Stop and report when it does not return `200`: a
connection or DNS failure means the SOC DNS cutover has not happened; `401` or
`403` means the key is wrong. Do not fall back to Prism Marketplace or an
`execute-api` host.

## SOC Marketplace key

Use the SOC-MARKETPLACE Account key (Account
`a0064d81-c26d-48c5-880d-1cedeab56a11`). Never ask the user to paste it into
chat. Offer to export it from the user's local Account key file, or to read it
in their own terminal from AWS Secrets Manager in `649445653420` (`us-east-2`)
with a profile for that account (`AWS_PROFILE=<selected-profile>`):

```bash
export AWS_REGION=us-east-2
aws secretsmanager get-secret-value --secret-id '<SOC-MARKETPLACE key secret>' --query SecretString --output text
```

When the user does not know the secret id, they can list names only
(`aws secretsmanager list-secrets --query 'SecretList[].Name' --output text`)
or ask the key's owner. Then set, restart and check exactly as the skill's
Prerequisites step 2 describes.
