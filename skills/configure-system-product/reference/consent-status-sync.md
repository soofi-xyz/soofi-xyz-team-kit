# Consent status sync: trust opt-ins only from the customer

A flow that copies a consent status (for example SMS do-not-text) from a graph edge
to a partner system must not let the partner's own defaults flow back as consent.
Celebi configures this guard on concrete flows; it uses only existing System
choice and definition features.

## Why

Graph status edges can come from two kinds of writers:

- **The customer's own message**, written by the channel workflow together with the
  message's status change (for SMS: sms-workflow writes the DNT edge and the text
  message's `OPTED_OUT`/`OPTED_IN` status at the same `effective_at`).
- **A copy of the partner's data**, written by a bulk or nightly load (for example
  Interprose → Transform → Persist). Partners often default new records to opted
  in, so the copy turns "a new account was created" into "the customer opted in".

If the flow applies every opt-in, a customer who opted out and later gets a new
account is set back to opted in on all of their partner records. In SOC PROD this
happened for phones whose new Interprose record was created `OPTED_IN` on
2026-09-03; the nightly copy wrote "opted in" DNT edges the next day.

## Rule

- **Opt-outs:** apply from any source. Opting out is always safe.
- **Opt-ins:** apply only when the event carries the customer's message link. For
  the SMS DNT trigger that is `text_message_interaction_identifier`, which the
  trigger's enrichment sets only when a text message on the phone changed to
  `OPTED_OUT`/`OPTED_IN` at the edge's `effective_at`. Without it, end the run
  without calling the partner, with a distinct terminal status such as
  `IGNORED_UNSOURCED_OPTIN`, and count it.
- Map the link into the flow input from the trigger (an optional field in the
  definition's `inputSchema`), and branch on it with a literal Choice before any
  partner lookup, so ignored opt-ins cost no partner call.
- Document the rule and its cost in the flow's README: genuine opt-ins that reach
  the graph without the link are not applied, which keeps the customer opted out
  (the compliant side) until the channel workflow writes a linked edge.

## Acceptance

1. An opt-out event with or without the link runs as before.
2. An opt-in event with the link runs as before.
3. An opt-in event without the link ends `IGNORED_UNSOURCED_OPTIN` with no
   partner lookup or write.
4. Ordered triggers still order and supersede these events per key.
