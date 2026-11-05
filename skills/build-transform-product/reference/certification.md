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
| `id`, `version` | Immutable identity |
| `entityType` | Scope of holds and links, e.g. `person` |
| `identifierKinds` | Per kind: `normalize` (`trim`, `lowercase`, `digits`, `e164`), `autoMatch` (default `true`), `matchCandidateNames` |
| `maxSuggestions` | 0-10 suggestions carried in a message |
| `newRecord` | `idPrefix` and `required` attributes for a New answer |
| `recordIdPattern` | Optional pattern an answered record id must match |

Refuse any review-tool settings in a certification: they belong to Connect
configuration.

## Submission

`POST /transform/certifications/{id}/versions/{version}/submissions` takes up to
100 entities (identifier, optional `occurrenceId`, display name, context, up to
10 suggestions, optional `candidates`, payload). Results are in entity order:

- `MATCHED { record_id, matched_by? }`: the normalized identifier has an exact
  identity link, or (`matchCandidateNames`) exactly one candidate's normalized
  name equals it (`matched_by: "candidate-name"`). Several equal names are held,
  suggested first. Candidates never appear in a message.
- `HELD { hold_id, message?, payload_held? }`: no record is created; the payload
  is stored with the hold. Only the submission that **created** the hold gets
  `message`; later submissions join the hold without one, an identical retry
  (same occurrence and payload) is stored once, and a full hold (500 payloads)
  answers `payload_held: false`.
- `REJECTED { hold_id }`: a rejected identifier stays rejected; a saved hold
  decides before any name match.

Matching is exact after the kind's normalization; there is no fuzzy match.

**Occurrence scoping.** Holds and links are keyed by entity type, kind and
normalized value (JSON-encoded parts, so values never collide). The key also
includes the `occurrenceId`:

- for a kind with `autoMatch: false` (each occurrence is held and answered on
  its own; `occurrenceId` is required);
- when two or more distinct `occurrenceId`s in one submission share an
  identifier: none matches automatically, each is held on its own, and the
  record the identifier was certified to (if any) is suggested first;
- on any later submission of an occurrence that already has its own hold, even
  when submitted alone, so a single-occurrence retry keeps its hold and answer.

## Holds and answers

A hold is created `PENDING` with its suggestions, payload keys and the pinned
certification (id, version, sha256). `GET /transform/certification-holds/{hold_id}`
returns the hold, its `message` and its payloads (100 a page);
`GET /transform/certification-holds?status=&updated_after=` lists holds.

`POST /transform/certification-holds/{hold_id}/answer` takes
`{ decision: EXISTING | NEW | REJECTED, match?, attributes? }`:

- `EXISTING`: `match` is a suggestion `number` or a record id matching
  `recordIdPattern`; the identifier is linked to it.
- `NEW`: links a new id, `idPrefix` plus a UUID derived from the hold id (a retry
  mints the same id); every `required` attribute must be filled.
- `REJECTED`: links nothing.

Responses: `200 { hold_id, status, resolution }`; `422 InvalidAnswer` with a
reason worded for the person; `409 AnswerConflict` for a different answer to an
answered hold; `404 HoldNotFound`. The same answer again (compared by the sha256
of the canonical answer) returns the saved resolution.

Apply an answer in this order: save it on the hold as `pendingResolution`
(conditional on no other pending answer), write the identity link (never
overwrite an existing link to another record), then mark the hold resolved. A
scheduled sweep (every 15 minutes) finishes saved but interrupted answers as
saved.

## Builder checklist

1. Keep the engine generic: no source, tool or company names in code; the
   README may name examples only as configuration.
2. Keep the step-to-step contract: `message` on the creating `HELD` result and on
   GET hold, `answer_path` in it, no event bus, no outbound review calls.
3. Keep keys stable across certification versions; never key holds or links by
   version.
4. Make every write conditional (claim the hold, append payloads, save the
   pending answer, mark resolved) and every retry idempotent.
5. Never put candidates in messages.
6. IAM: submission, answer and hold routes use the invoke policy; configuration
   routes use the configuration read/write policies.

## Verification

Run the full suite before every push. Cover at least:

- configuration validation and refused review-tool settings;
- held → message once; join without message; identical retry stored once; full
  hold; rejected stays rejected;
- Existing by number and by record id, New with required attributes, Rejected,
  repeated and conflicting answers, 422 reasons, interrupted answer finished by
  the sweep, an existing link to another record kept;
- exact matching per normalization (one differing character stays `HELD`),
  candidate-name single and multiple matches;
- two distinct occurrences sharing an identifier held separately, and each
  retried alone keeping its own hold and answer;
- the stack has no event-publishing permission or bus parameter for this area.

Hand certification configuration, the mappings that build the question and read
the answer, and their tests to Silvally; keep engine fixtures here.
