# Current-only Persist lexicon catalog

Use feature `lexicon-catalog` to maintain a Gremlin-queryable catalog of the
current accepted base lexicon and extensions. Treat this as requested guidance,
not deployed behavior. Discover the target revision, API, account and region.
Follow [current scope](current-scope.md) and the Persist capability map.

## Store one current native property graph

Use ordinary metadata vertices, edges and scalar properties. Do not introduce
RDF/OWL semantics, immutable per-release graph copies, version-history vertices
or `latest` relationships. Keep history in Model's versioned source artifacts.
Interpret current as the accepted lexicon for this Persist target, not whichever
Model release happens to be newest elsewhere.

Use this illustrative shape; verify actual names before producing runnable queries:

```text
Lexicon {scopeKey: "core", version: 3, sourceDigest: "...", catalogRevision: 7}
  ├─ defines → Type {namespace: "example", name: "Person", kind: "vertex", version: 2}
  └─ defines → Type {namespace: "example", name: "worksFor", kind: "edge", version: 1}
```

- Use one lexicon anchor and one current definition per scoped type. Include
  catalog scope, declaring namespace, kind and logical name in deterministic type
  IDs; exclude version/digest. Identify property metadata by owner ID/property name
  and relationship metadata by owner, role and endpoints. Treat renames as removal
  plus addition unless Model provides an explicit stable identity across renames.
- Represent edge definitions as metadata vertices, with links to permitted source
  and target types and their property definitions. Keep actual business edges as
  edges. Store declared versions as properties; do not invent per-type versions
  when the source only versions the lexicon. Return source revision/digest instead.
- Persist queryable properties, requiredness, datatypes, constraints, endpoints
  and declared metadata, retaining a lossless definition representation where
  needed. A URI alone is not a stored schema. Validate supported values/size limits.
- Scope base and extension metadata separately. Retain source provenance, pinned
  base identity/digest and effective inherited definitions according to Model's
  composition rules. Do not mutate another scope's metadata or silently rebase an
  extension. If a base update affects extension validity, use the verified Model
  compatibility policy and reject incompatible updates before graph mutation.
- Reserve catalog labels/IDs and write access. Exclude catalog elements from
  ordinary fact counts, ingestion, derived indexes, triggers and search unless
  explicitly governed. Never delete, relabel or rehash business facts in this flow.

## Calculate and apply the diff

1. Load the complete approved source and required dependencies; verify identity,
   digest and validity. Resolve an API patch into a complete desired snapshot
   before diffing. Never interpret a partial/failed fetch as deletion authority.
2. Normalize to metadata vertices/edges with stable IDs and deterministic content
   hashes. Canonicalize map ordering and only arrays that the contract declares
   unordered. Include properties, defaults, constraints and endpoint declarations;
   exclude transient processing timestamps. Keep the projection format version
   separate from source version so a projector upgrade can force reconciliation.
3. Read the current catalog and its revision for the same scope. Compare element
   identities/hashes: create added elements, update changed elements in place,
   delete removed catalog elements and skip unchanged ones. For changed elements,
   explicitly remove absent properties and obsolete relationships; upsert alone
   leaves stale data. Use single-cardinality writes for scalar metadata. Restrict
   deletion to the selected scope and validate endpoint closure of the final graph.
4. Offer a read-only preview with added/changed/removed/unchanged counts, affected
   type/property/relationship names, source digest, projection format and expected
   current catalog revision. Bind the apply operation to those exact inputs. If
   the target changed after preview, reject it as stale and produce a fresh diff.
5. Apply the complete diff and version/digest/revision update in one Neptune writer
   transaction. Read/check the expected current revision inside that transaction;
   a client-side check alone does not protect against races. Handle first creation
   with the same concurrency protection. Roll back the whole mutation on failure.
   Bound transaction size/time; reject oversized work before mutation and return
   a builder gap rather than committing batches that expose a mixed catalog or
   storing extra version snapshots in the graph.
6. On conflicts, reread and recalculate with bounded retries, preserving the
   caller's selected source. Revalidate that the desired source is still accepted;
   do not let delayed work restore an older source. Use accepted-source revision
   ordering/preconditions, not version-string ordering or event arrival time.
   Treat an authorized rollback as a new accepted operation using older source
   content. Apply the same diff; keep graph history absent.
7. Return a no-op for an identical source/projection with a verified matching
   catalog. Offer explicit repair/reconciliation for drift even when source digest
   is unchanged. A source-only digest shortcut must not hide missing graph elements.
   After an ambiguous timeout, read applied state before retrying; distinguish
   already committed work from failure. Return changed counts and the applied
   revision/digest, not merely a successful request submission.

## Integrate with the existing acceptance path

Keep Model authoritative for vocabulary and publication. Preserve Deploy's typed
Model release installation described by [Corviknight](../../../agents/corviknight.md#model-lexicon-installation-into-persist)
and [Skarmory](../../../agents/skarmory.md#model-lexicon-installation-into-persist).
Verify the target contract for `GET /persist/lexicon`, `PUT /persist/lexicon` and
`PUT /persist/lexicon/extensions/{vocabularyId}`. Preserve IAM SigV4, document-digest
checks and chained `If-Match`/`ETag` behavior; `source: legacy-ssm` is a cutover gap,
not permission to bypass the API. Do not claim these routes already project metadata.

Attach reconciliation to each accepted create/update of a base or extension,
including definitions unused by any business fact. Reconcile removals through the
verified supported removal contract. Keep multi-call base/extension installation
status separate from atomicity of an individual catalog update; do not claim one
Neptune transaction covers the whole Deploy installation or Model/S3 writes.

If acceptance and projection span systems, persist durable work and explicit
accepted-source versus applied-catalog revisions. Keep the previous complete graph
visible while work is pending, surface failure/lag and reconcile retries. Never
claim source acceptance alone means the graph is current. Define HTTP preview,
apply/reconcile, status and results through supported service interfaces; discover
or implement their actual names rather than inventing routes in operator examples.
Keep public Gremlin read-only and graph writes on the trusted projection path.

## Configure with Uxie

1. Resolve a request such as “sync core”, “refresh extension X” or “show the current
   Person/worksFor schema” into target, catalog scope and approved source. Reuse
   session context; ask only for missing choices. Verify the account/region,
   installed source and live capability. For Model source creation/changes use
   Jirachi/Dialga; for missing Persist behavior hand the gap to Conkeldurr.
2. For a lookup, run a read-only query immediately; do not trigger installation.
   For an update, show the supported preview and explain removals in plain language.
   Preserve the source digest and expected current revision. Follow the user's
   existing authorization; a preview-only request does not authorize application.
3. Coordinate managed release installation with Skarmory and its supported Deploy
   step. Do not bypass a missing step with direct lexicon PUTs. For repair of an
   already accepted lexicon, use Persist's supported reconcile operation. Never
   calculate or apply production graph mutations in an ad hoc Gremlin script.
4. Follow status to completion. Compare source/component digests, effective merged
   digest and applied catalog revision separately. Account for reader replica lag;
   do not mistake a stale read for a successful update or a second write requirement.
5. Supply a copyable query with actual names. For the illustrative graph above:

   ```groovy
   g.V().has('Lexicon', 'scopeKey', 'core')
     .out('defines').has('namespace', 'example')
     .has('kind', 'vertex').has('name', 'Person')
     .valueMap()
   ```

   Use `kind = edge` and `name = worksFor` to inspect an edge definition. Traverse
   the verified property/endpoint metadata relationships for its full schema.
6. Have the user exercise a base and an extension/update variant; inspect correlated
   AWS logs and graph results. Verify the current definitions, removed metadata,
   isolation of other scopes, no-op repeat and unchanged business facts. Return
   preview counts, source/applied digests, revision, request IDs and Gremlin results.
   Keep unsupported capabilities or unobserved runtime evidence explicit.

## Verify the builder increment

Use synthetic definitions with an added type, changed requiredness/default,
removed property, changed edge endpoint and removed type. Exercise empty-catalog
initialization and a valid empty desired catalog, base/extension name collisions,
inherited definitions, same-source replay, explicit drift repair, stale preview,
delayed source updates, competing writers, digest mismatch, incomplete source,
failure midway through mutation, ambiguous completion and authorized rollback.
Prove the failed transaction preserves the previous complete catalog and no case
creates historical definition vertices or affects business facts. Test projection
semantics in the real fixture (TinkerGraph where supported), and Neptune-specific
concurrency/rollback on the authorized deployment. Keep automated, user-run and
AWS evidence distinct; this kit update itself does not implement the service.
