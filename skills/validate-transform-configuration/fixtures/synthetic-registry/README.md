# Synthetic registry fixture

A small, PII-free registry used by the tool and contract tests and by the teammate quick start.
Nothing here names a real language, mapping, dataset or environment.

- `layout.json`: a registry layout whose hub language (`canon`), paths and parameter names differ
  from the default layout, proving the tools read everything from the layout.
- `candidate/languages/`: the hub concept model (`canon.json`) and three languages: `alpha`
  (tabular source: `members` JSONL, `ledgers` CSV, `rates` Parquet), `omega` and `sigma` (targets).
- `candidate/mappings/`: `alpha-to-canon@1.0.0` (tabular to graph), `canon-to-omega@1.0.0` and the
  cumulative `@2.0.0` (CSV `;` with header plus a JSONL output), `canon-to-sigma@1.0.0` (Transform
  CSV defaults), and `alpha-to-omega@0.9.0`, retired by `forbidden-concepts.json`.
- `inputs/` with `manifest.json`: the source package (one row has a null key and is dropped; one
  ledger references an unknown member; `nickname` is an optional graph property absent from every row).
- `expected/`: oracles written from the specification, not from the SQL.
- `profiles/synthetic-alpha-omega.json`: a strict profile with one declared derivation override,
  one allowed loss, two oracles, declarative checks and a `sourceWindowPolicy` derived at intake
  with recorded defaults.

End to end (local Spark 3.3 and Java 17), from `skills/validate-transform-configuration`:

```bash
F=fixtures/synthetic-registry S=scripts W=$(mktemp -d)
R="--layout $F/layout.json --lexicon-root $F/candidate --main-lexicon-root $F/candidate --forbidden-concepts $F/forbidden-concepts.json --profiles $F/profiles"
python3 $S/resolve-transform-intent.py discover --request "test canon (alpha) to omega ledger summary" $R --out $W/intent.json
python3 $S/resolve-transform-intent.py check-profile --profile $F/profiles/synthetic-alpha-omega.json $R --out $W/profile-check.json
python3 $S/local_mapping_run.py --mapping $F/candidate/mappings/alpha-to-canon/1.0.0/registration.json --negatives \
  --input members=$F/inputs/members --input ledgers=$F/inputs/ledgers --input rates=$F/inputs/rates --out $W/step1
python3 $S/graph_export_bridge.py neptune-csv --source $W/step1 --out $W/graph
python3 $S/compare_datasets.py closure --vertex vertex-member=$W/graph/vertex-member --vertex vertex-ledger=$W/graph/vertex-ledger \
  --edge edge-member-has-ledger=$W/graph/edge-member-has-ledger:vertex-member:vertex-ledger > $W/closure.json
python3 $S/local_mapping_run.py --mapping $F/candidate/mappings/canon-to-omega/2.0.0/registration.json --negatives \
  --input vertex-member=$W/graph/vertex-member --input vertex-ledger=$W/graph/vertex-ledger \
  --input edge-member-has-ledger=$W/graph/edge-member-has-ledger --out $W/step2
python3 $S/resolve-transform-intent.py contracts --mapping canon-to-omega@2.0.0 $R --out $W/contracts.json
python3 $S/compare_datasets.py check --contracts $W/contracts.json --profile $F/profiles/synthetic-alpha-omega.json \
  --dataset member_report=$W/step2/member_report --dataset ledger_summary=$W/step2/ledger_summary \
  --oracle member-report-spec=$F/expected/member_report.csv --oracle ledger-summary-spec=$F/expected/ledger_summary.jsonl --out $W/checks.json
python3 $S/evaluate_run.py --intent $W/intent.json --profile $F/profiles/synthetic-alpha-omega.json --profile-check $W/profile-check.json \
  --contracts $W/contracts.json --checks $W/checks.json --local-report $W/step1/report.json --local-report $W/step2/report.json \
  --closure $W/closure.json --local-package synthetic-inputs=$F/inputs --mode synthetic-local --out $W/phases.json
```

This run passes phases 1–11 (`modeScopedResult: PASS`) and ends `BLOCKED` on phase 12 with
`FinalProdDerivedValidationRequired`: a synthetic fixture is an earlier phase, never `READY`. A real
profile continues with `source_window.py recommend` on read-only PROD metadata, the user's
confirmation (`source_window.py confirm`), an approved DEV staging of the window and approved
`observed-dev` executions, then `evaluate_run.py --source-window ... --staging-upload ...`.
