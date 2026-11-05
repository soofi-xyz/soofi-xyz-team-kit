# Configure human certification

A certification holds entities a caller cannot match. Transform returns a
`message`, never calls a review tool and publishes nothing. The System flow
passes the message to Connect, which opens the review task, waits for it and
hands the task back; a Transform mapping turns the task into an answer, and the
flow posts it to the message's `answer_path`. Keep every source-specific rule in
the configuration repository; hand engine gaps to Kecleon.

## Register

1. `POST /transform/certifications/validate` with the body; it stores nothing.
2. `PUT /transform/certifications/{id}/versions/{version}`. Identical content
   returns `200`; changed content under the same version returns
   `409 CertificationVersionConflict`, so every change is a new version.
3. `GET` the version and compare `certification_sha256` with the local digest.

Certifications and javascript mappings (with `activate`) are not covered by
`transform_api.py`; register them with a script in the configuration repository
that runs the same validate → register → read-back order. Holds and links are
keyed by certification id, entity type and normalized identifier, never by
version, so a new version keeps every earlier answer.

## Identifier kinds

Each kind sets `normalize` (`trim`, `lowercase`, `digits`, `e164`).

- `autoMatch: true` only when one identifier means one entity (an email, an
  exactly equal masked phone). A different value is a different identifier.
- `autoMatch: false` for values many people share. Every submission of that
  kind needs an `occurrenceId`, and an answer applies to that occurrence only.
- `matchCandidateNames: true` auto-matches when the normalized identifier
  equals exactly one caller-supplied `candidates[].name`; several equal names
  are held and suggested first. Candidates never appear in a message.
- Send `occurrenceId` for auto-matching kinds too, so Transform can tell two
  distinct people sharing one identifier in a submission apart and ask about
  each.

## Settings

- `maxSuggestions` is 0-10; a submission takes at most 100 entities, so split
  larger batches.
- `newRecord.idPrefix` plus a hold-derived UUID becomes the New id;
  `newRecord.required` lists the attributes a New answer must fill.
- Set `existingByRecordId: true` whenever reviewers may type an id that is not
  among the suggestions, in particular when the submission sends none. It
  requires `recordIdPattern`; write the pattern to cover every real id form of
  the entity, including `idPrefix` ids.

## Answer mapping

The answer is exactly one of:

```json
{ "decision": "EXISTING", "suggestion": 2 }
{ "decision": "EXISTING", "record_id": "source:users/9" }
{ "decision": "NEW", "attributes": { "name": "Person A" } }
{ "decision": "REJECTED" }
```

The legacy `match` field returns `400`. When reading a review tool's free-text
field, send a bare whole number 1-10 as `suggestion` and anything else, trimmed,
as `record_id`. Leave an empty Existing for Transform's `422 InvalidAnswer` so
the flow relays its reason, and return a separate `{ invalid: reason }` result
for a task the flow must send back without calling Transform.

The resolution is snake_case, `{ decision, record_id?, attributes?,
resolved_at, answer_sha256 }`, while submission `suggestions` and `candidates`
use camelCase `recordId`. Show each suggestion's own `number` in the task.

## Test

Cover, in the configuration repository: every identifier kind's normalization
and auto-match, two occurrences sharing one identifier, each answer shape from
the task mapping (number, id, New, Rejected, empty, invalid), and the message
mapping with zero and several suggestions.
