# Raw single-property capture

Use this route when the user asks for the direct source response for one property
and explicitly says not to transform, normalize, load, compare, or publish it.

## Boundary

This is a capture-only diagnostic:

- resolve the county and exact official parcel/request identifier;
- use the county adapter's existing official source request;
- fetch exactly one property;
- preserve the response body byte-for-byte;
- validate that the body belongs to the requested parcel;
- write request/response metadata and a SHA-256 digest to a separate receipt.

Do not run county transforms, reconciliation exports, Query DB loading, hashing,
CAR/table export, Atlas registration, or publication. Reading an in-memory decoded
copy to validate the official parcel identifier is not a data transformation; the
stored and streamed body remains the original byte sequence.

## Preconditions

1. Run the normal county readiness gate. Stop on blocked access, CAPTCHA, login,
   unsupported terms, or an unverified source.
2. Resolve the address to one official parcel identifier through the existing seed
   workflow. Do not guess a parcel from a similar address.
3. Build a seed CSV containing exactly one data row.
4. Confirm that the county adapter implements raw capture. The bundled command
   currently supports Duval. An unsupported adapter must fail explicitly.

## Command

Write only to OS-temporary storage or the runtime's gitignored `.scratch/`
directory:

```bash
run_dir="$(mktemp -d)"
node skills/use-oracle/runtime/bin/elephant-county.mjs capture-raw \
  --county duval \
  --seed <one-property-seed.csv> \
  --output "$run_dir"
```

The command writes:

- `response-body.html` — exact response bytes, with no newline or other rewrite;
- `raw-capture-receipt.json` — county, parcel/request identifier, source URL,
  capture timestamp, HTTP status, final URL, content type, byte count, SHA-256,
  and parcel-validation result.

To stream only the exact body to stdout, add `--stdout`. The receipt event goes to
stderr so it cannot contaminate the body:

```bash
node skills/use-oracle/runtime/bin/elephant-county.mjs capture-raw \
  --county duval \
  --seed <one-property-seed.csv> \
  --output "$run_dir" \
  --stdout
```

## Fail closed

Write no capture when:

- the seed has zero or more than one property;
- the HTTP response is unsuccessful;
- the page is empty, blocked, challenged, or contains CAPTCHA;
- the official parcel identifier in the response differs from the request;
- the output path is trackable source/fixture storage.

Never solve or bypass a challenge. Never commit captured bodies or receipts.

## User-facing result

When the user requested “no transformation” or “direct output,” return the raw
body verbatim (or link the raw body file when it is too large for chat). Keep the
receipt separate. Do not replace the body with extracted fields, a summary, JSON,
or transformed lexicon records.
