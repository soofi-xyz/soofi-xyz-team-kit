# Example validation profiles

Profiles and calibration dossiers for specific mappings. They are data: no Silvally tool, core
document or core test reads them by default. Pass a profile directory explicitly
(`--profiles skills/validate-transform-configuration/examples/profiles`) or keep your own
elsewhere.

- `profiles/*.json` conform to `reference/transform-configuration-profile.schema.json`; the plugin
  CI only schema-checks them.
- Each profile's registered directions must regenerate from the registry:
  `resolve-transform-intent.py check-profile --profile <file> ...` reports every difference, and
  only the pairs listed in a direction's `derivationOverrides` may differ.
- `calibrations/*.md` hold sanitized expectations (row counts, digests, pinned revisions) for a
  profile's declared scenarios. They are evidence notes, not runtime inputs.

Mapping-specific rules belong in the profile as declarative checks, `oracles`, `allowedLosses`,
`columnConstraints` and `derivationOverrides`, interpreted by `compare_datasets.py check`.
