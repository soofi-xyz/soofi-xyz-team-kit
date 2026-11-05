# Human certification

Human certification is Transform's third kind of transform, beside deterministic
(SQL, JavaScript) and non-deterministic (extraction). When a caller cannot match
an incoming entity with certainty, it submits the entity to a registered
**certification** instead of creating a record. Transform holds the data,
returns the question a person must answer, applies the answer it is given, and
remembers it so the same identifier matches automatically afterwards.

## Architecture rule

- Transform never calls a review tool (Asana, email, chat or any other external
  system). Connect is the only layer that reaches external systems.
- The calling System flow carries the question step to step: the `HELD` result's
  `message` is the input of the next step (Connect opens the review task and
  waits for it), and Connect's answer is posted back to the message's
  `answer_path` as the step after. Transform publishes no events for this.
- Transform never writes the certified record to the graph. The caller loads the
  answer (and the held payloads) in its own next step.
- Every business rule lives in a per-domain configuration repository (identifier
  kinds, suggestion count, new-record prefix, mappings that build the question
  and read the answer). Transform code names no source, tool or company.

## Configuration

A certification is registered and versioned like a mapping (validate, register,
identical replay, conflict on changed content, read-back):

| Field | Meaning |
| --- | --- |
| `id`, `version` | Immutable identity; `id` scopes holds and links |
| `entityType` | Kind of record certified, e.g. `person` |
| `identifierKinds` | Per kind: `normalize` (`trim`, `lowercase`, `digits`, `e164`), `autoMatch` (default `true`), `matchCandidateNames` |
| `maxSuggestions` | 0-10 suggestions carried in a message |
| `newRecord` | `idPrefix` and `required` attributes for a New answer |
| `existingByRecordId` | Whether an Existing answer may name a record outside the suggestions |
| `recordIdPattern` | Pattern such a record id must match; registration refuses `existingByRecordId` without it |

Refuse any review-tool settings in a certification: they belong to Connect
configuration.

## Keys

Holds and identity links are keyed by certification id, entity type, identifier
kind and normalized value (JSON-encoded parts, so values never collide), plus
the `occurrenceId` where occurrence scoping applies. Two certifications never
share a hold or a link; versions of one certification do. Never key by version.

## Submission

`POST /transform/certifications/{id}/versions/{version}/submissions` takes up to
100 entities (identifier, optional `occurrenceId`, display name, context, up to
10 suggestions, optional `candidates`, payload). Results are in entity order:

- `MATCHED { record_id, matched_by? }`: the normalized identifier has an exact
  identity link, or (`matchCandidateNames`) exactly one candidate's normalized
  name equals it (`matched_by: "candidate-name"`). Several equal names are held,
  suggested first. Candidates never appear in a message.
- `HELD { hold_id, message?, payload_held? }`: no record is created; the payload
  is stored with the hold. The submission that **opened** the hold gets
  `message`, and so does an identical retry of it (same occurrence and payload,
  stored once), so a caller step retried after a timeout still asks; the caller
  keys its asking step by `hold_id`. Other submissions join without a message.
  A hold keeps at most 500 payloads; past that the result says
  `payload_held: false`.
- `REJECTED { hold_id }`: a rejected identifier stays rejected and holds no
  further data; a saved hold decides before any name match.

Data joins only a hold still waiting on its answer (`PENDING`, no saved
answer). Once an answer is saved, later data returns `MATCHED` or `REJECTED`
and is not held. A payload written by a submission that then lost the race to
open the hold is deleted when the winning hold refuses it.

Matching is exact after the kind's normalization; there is no fuzzy match.

**Occurrence scoping.**

- A kind with `autoMatch: false` holds and answers each occurrence on its own;
  `occurrenceId` is required.
- When two or more distinct `occurrenceId`s in one submission share an
  auto-matching identifier, Transform marks the identifier **shared** (a marker
  row with no status, invisible to the hold routes and indexes). An occurrence
  the identifier's existing hold already holds keeps that hold and is never
  asked twice; every other occurrence gets its own hold and message, suggesting
  the record the identifier was certified to, if any.
- Once shared, answering the identifier's own hold writes no identifier-wide
  link: the answer reaches only the occurrences that hold contains. Write the
  link in one `TransactWriteItems` with a condition that the shared marker is
  absent, so marking and linking can never interleave. A later
  occurrence with no hold of its own is held on its own and needs an
  `occurrenceId`. A link a person made before the sharing was seen still
  matches later entities that have no hold of their own.
- An occurrence that already has its own hold keeps it on any later
  submission, even alone, so a single-occurrence retry keeps its hold and
  answer.

## Holds and answers

A hold is created `PENDING` with its suggestions, payload keys, occurrence ids
and the pinned certification (id, version, sha256).
`GET /transform/certification-holds/{hold_id}` returns the hold, its `message`
and its payloads (100 a page); `GET /transform/certification-holds?status=&updated_after=`
lists holds (500 a page; a cursor from another status is `400 InvalidCursor`).

`POST /transform/certification-holds/{hold_id}/answer` takes exactly one of:

```json
{ "decision": "EXISTING", "suggestion": 2 }
{ "decision": "EXISTING", "record_id": "source:users/9" }
{ "decision": "NEW", "attributes": { "name": "Person A" } }
{ "decision": "REJECTED" }
```

- `EXISTING`: exactly one of `suggestion` (a number from the message) and
  `record_id` (one of the suggestions' record ids or, with
  `existingByRecordId`, any id matching `recordIdPattern`); the identifier is
  linked to it. The old overloaded `match` field is a `400`.
- `NEW`: links a new id, `idPrefix` plus a UUID derived from the hold id (a retry
  mints the same id); every `required` attribute must be filled.
- `REJECTED`: links nothing.

Responses: `200 { hold_id, status, resolution }` with `resolution`
`{ decision, record_id?, attributes?, resolved_at, answer_sha256 }` (GET and list
carry the same snake_case shape); `422 InvalidAnswer` with a reason the caller
can relay (`Suggestion 7 is not in the message; choose 1-3.`,
`NEW needs attributes: name.`); `409 AnswerConflict` for a different answer to
an answered hold; `404 HoldNotFound`; `503 AnswerContention` when the hold kept
changing (send the same answer again). The same answer again (compared by the
sha256 of the canonical answer) returns the saved resolution.

Apply an answer in this order: save it on the hold as `pendingResolution` with
`pendingSince` (conditional on no other pending answer), tag the payloads
answered, write the identity link (never overwrite an existing link to another
record), then mark the hold resolved and remove `pendingSince`. A scheduled
sweep (every 15 minutes) queries only the sparse `pendingSince` index and
finishes saved but interrupted answers as saved.

**Reopen.** Rejection is permanent unless an administrator calls
`POST /transform/certification-holds/{hold_id}/reopen` (no body). It moves a
`REJECTED` hold back to `PENDING`, retags surviving payloads as waiting and
returns `200 { hold_id, status: "PENDING", payload_count, message }`; a retry
returns the same. Each reopen starts a new **generation** of the hold. A saved
answer carries its generation and is applied only while the hold is still in
it, so a delayed retry or sweep never restores the old rejection or removes a
newer answer. Any other status is `409 HoldNotRejected`, an unknown hold
`404`, repeated contention `503 ReopenContention`. Reopen is a
configuration-write route, never on the invoke policy.

## Operations

- **Sweep alerting.** A sweep that cannot finish a saved answer fails, naming
  the hold. Its error alarm and its schedule dead-letter-queue alarm notify the
  quality alert topic on ALARM and on OK; the PagerDuty forwarder triggers on
  ALARM and resolves on OK (dedup key by alarm name).
- **Recovery.** Holds and identity links tables keep point-in-time recovery:
  links are people's decisions and cannot be rebuilt.
- **Retention.** Payloads live under `certification-holds/<hold_id>/` in the
  data bucket. A waiting hold's payloads never expire. Applying an answer
  copies every payload the hold has at that moment (read after the answer is
  saved, so data that joined just before is included) onto itself with the tag
  `certification-hold=answered`. S3 counts expiry from the new version, so a
  payload expires 30 days after the answer, or `DataRetentionDays` when set and
  smaller, however long the hold waited; tagging alone would count from
  arrival. The answer and sweep functions need `s3:GetObject`, `s3:PutObject`
  and `s3:PutObjectTagging` on the holds prefix. Noncurrent versions and delete
  markers expire after a day. Rejected and answered holds accept no new
  payloads.

## Builder checklist

1. Keep the engine generic: no source, tool or company names in code, comments
   or fixtures (use `source:users/1`, "Person A"); the README may name
   examples only as configuration.
2. Keep the step-to-step contract: `message` on the opening `HELD` result, its
   identical retry and GET hold, `answer_path` in it, no event bus, no
   outbound review calls.
3. Key holds and links by certification id, never by version.
4. Make every write conditional (claim the hold, append payloads only while
   waiting, save the pending answer, mark resolved, reopen) and every retry
   idempotent. Apply a saved answer to the hold as reloaded after the save, and
   only within the answer's own generation.
5. Never put candidates in messages.
6. IAM: submission, answer and hold routes use the invoke policy; configuration
   routes and reopen use the configuration read/write policies.
7. Every scheduled job alerts on failure and on recovery.

## Verification

Run the full suite before every push. Cover at least:

- configuration validation, refused review-tool settings, and
  `existingByRecordId` refused without `recordIdPattern`;
- two certifications with the same entity type and identifier keep separate
  holds, each with its own message;
- held → message; identical retry of the opener gets the message again and is
  stored once; join without message; full hold; rejected stays rejected and
  stores nothing;
- data arriving while the hold is answered is not added; a lost claim's
  payload is deleted;
- Existing by suggestion and by record id (in and outside the suggestions,
  pattern match and miss), New with required attributes, Rejected, `match`
  refused, repeated and conflicting answers, each 422 reason, interrupted
  answer finished by the sweep through the sparse index, an existing link to
  another record kept;
- reopen: REJECTED → PENDING with a fresh message, retry, wrong status, not on
  the invoke policy, an answer saved before the reopen never applied after it;
- retention: payloads copied with the answered tag at apply time, including
  one that joined between save and apply;
- exact matching per normalization (one differing character stays `HELD`),
  candidate-name single and multiple matches;
- shared identifiers in both orders (the wide hold still waiting and already
  answered): no occurrence asked twice, no identifier-wide link after sharing
  (the link write fails its condition when the marker lands first),
  each occurrence retried alone keeping its own hold and answer;
- the stack: no event-publishing permission or bus parameter, PITR on both
  tables, sweep alarms with ALARM and OK actions, lifecycle rules on the
  holds prefix.

Hand certification configuration, the mappings that build the question and read
the answer, and their tests to Silvally; keep engine fixtures here.
