# System composition artifacts

Use contract version **2** for compositions. The checker rejects unsupported
versions rather than silently reinterpreting their ownership or execution mode.

A composition manifest declares `systemId`, outcome, products, configuration
references, workflow ownership, success criteria, dependencies and inactive deploy
posture. The runtime mode is `system-service`. Do not invent another Product
runtime or an alternative thin-package execution mode.

Use canonical product IDs. Keep Model or Deploy `reference-only` when their work
is an external prerequisite and no product agent is assigned. Registered Lexicon
language/mapping artifacts are Transform configuration; they do not imply that
Model has a deployed runtime. Do not assign Model/Deploy work to Persist.

Every workflow step names a declared product, a resolving configRef and the
assigned configurer for that product. Artifact ownership must agree with workflow
ownership. Prefer Celebi for System, Wingull for Connect, Silvally for Transform,
Uxie for Persist and Meditite for Rule. Keep builder work in the target product's
implementation plan, outside the configuration workflow.

Pin remote artifact references with a SHA-256 digest. Keep local references inside
the package. Declare every file in `emits/`. Never embed secrets, JDBC strings or
Spark SQL in the manifest; keep executable/configuration details in the owning
product's referenced artifacts.

Keep every runnable flow template-backed. The checker validates template names,
transitions, flow bindings, leaf contracts and references. A kit `product-*`
artifact kind names a compatibility configuration shape, not a separate product.
Use `persist-ingest` rather than the removed historical collection API concept.

Run:

```bash
python3 scripts/check-system-manifest.py path/to/system.manifest.json
python3 scripts/test-build-system-product-contract.py
```

Schema checks do not invoke System. Mark unperformed runtime criteria deferred;
complete mock acceptance separately with actual responses and trace evidence.
