# Spring Oaks Email Template Conventions

Apply the Console
[Email HTML target](../../build-console-product/reference/component-authoring.md#email-html-target)
rules for structure, executable-content rejection, images and placeholders.
This page adds the Spring Oaks inventory conventions on top of them.

## Variables

- Reuse variables that existing `email/consumer_facing/*__english.json`
  templates already declare (for example `debt_id`, `current_balance_formatted`,
  `current_creditor_name`, `original_creditor_name`, `client_account_number`,
  `store_brand_associated_with_account`, `vehicle_year`, `vehicle_make`,
  `vehicle_model`, `vehicle_vin`, `current_year`, `short_url`,
  `unsubscribe_url`). Map design text to them; do not invent new data fields.
- Use Jigglypuff's filters as the runtime defines them: `usd` formats a number
  or numeric string such as `1,284.17` as `$1,284.17` and fails on anything
  else; `date` renders `MM/DD/YYYY` in UTC; `default` replaces empty values.
  Rendering throws on undefined variables, so wrap optional rows in
  `{% if field %}`.
- Keep the declared variable list equal to the variables the HTML and subject
  reference. Only template syntax counts, not visible words.

## Links

| Design element | Link |
| --- | --- |
| Call or "talk with a specialist" | `tel:+18334183084` |
| View account, pay, disclosures at link | `{{short_url}}` |
| Unsubscribe (required) | `{{unsubscribe_url}}` |
| Privacy policy | `https://www.springoakscapital.com/privacy-policy` |

`short_url` and `unsubscribe_url` are minted at send time; they are template
variables but not query fields.

## Legal and disclosure text

- Copy legal text exactly from the design or the current template, including
  punctuation and spacing. Do not reword, shorten, merge or correct it.
- When the design's wording looks wrong (for example a double space when an
  optional field is empty), keep it, match the live templates, and flag it for
  legal in the PR description.
- Keep the debt-collector notice, the electronic-communications opt-out, the
  paper-copy notice, office hours, mailing address, copyright and unsubscribe.

## Images and alt text

- Every `<img>` has an `alt` attribute. `alt=""` marks a decorative image
  (icons beside text, ticks, arrows); give logos and meaningful images a short
  description (for example `alt="Spring Oaks Capital LLC"`).
- Images are PNG, JPEG, GIF or WebP, at most 1 MB and 3000 px per side, exported
  at 2x the rendered CSS size and cropped as rendered.
- Hosted URLs are content addressed:
  `https://images.springoakscapital.com/email/<template_name>/<sha256>.<ext>`.
  Only Jigglypuff uploads them.

## Inventory files

Jigglypuff writes these; check them in the PR.

- HTML: `email/consumer_facing/html/<template_name>.html`. The validator only
  accepts linked HTML under `email/consumer_facing/html/`.
- Metadata: `email/consumer_facing/<template_name>__english.json` with exactly
  these keys, sorted: `active`, `channel` (`email`), `content_sha256` (SHA-256 of
  the HTML bytes), `html_file_path`, `language`, `last_synced_at`,
  `source_system` (`FILE_IMPORT`), `source_template_id`, `source_version`,
  `subject`, `template_identifier` (`FILE_IMPORT:<source_template_id>`),
  `template_name`, `template_type` (`consumer_facing`), `variables` (sorted).
- `source_template_id` is the UUIDv5 (URL namespace) of the canonical frame URL
  `https://www.figma.com/design/<fileKey>?node-id=<a>-<b>`, without the file
  name slug or other query parameters. For PR
  [templates-inventory#346](https://github.com/Spring-Oaks-Capital-LLC/templates-inventory/pull/346)
  that is `e49ed9c6-16e1-55fd-8386-a0d7f74875fb`.
- Query (optional): `email/consumer_facing/<template_name>__english.query.json`,
  derived from an existing template's Gremlin query by keeping only the
  `.project()` fields this email uses, with their `by()` steps copied unchanged
  and the reference's `output_contract` order. `template_key` equals
  `template_name`. A query file triggers engineering query review.
- `active: false` until the images are hosted and certification passes.
