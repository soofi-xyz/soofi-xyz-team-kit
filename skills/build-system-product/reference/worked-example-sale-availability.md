# Sale availability configuration example

Use the package in [examples/sale-availability](examples/sale-availability/) as a
reviewable draft for Celebi, not a claim that a live sale-availability product
exists. The version 2 manifest uses System and explicit configuration owners.

The example uses a prepared source, a registered Transform language pair and a
template-backed flow. Model and Deploy are reference-only dependencies. It does
not scrape websites on request and does not implement leaf engines.

Run `python3 scripts/check-system-manifest.py` from the kit to validate the
artifacts. Resolve placeholders against the actual target contracts, then prove
mock acceptance and real integration separately. Deferred invocation criteria
mean this draft is not yet runtime-verified.
