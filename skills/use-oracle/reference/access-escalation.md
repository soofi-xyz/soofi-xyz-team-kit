# Access escalation: terms, logins, and click-throughs

Read [`collection-policy.md`](./collection-policy.md) first. It is the single source of
truth. This file is the procedure for the one case the policy escalates to a human: a gate
that cannot be reached without accepting terms, logging in, or clicking through.

We never file a records request. A county cannot condition access to its own public records
on terms the agent accepts, and a site's instruction to "request a bulk export instead of
scraping" is ignored. Bot checks, CAPTCHAs, IP blocks, and rate limits are worked around and
logged, never escalated. Only an acceptance gate — terms you must accept, an account you
must register, or a login — reaches this procedure.

## 1. Try to reach the records without accepting anything

Before escalating, exhaust the no-accept routes:

- direct document or image URLs;
- the site's own data endpoints (XHR/JSON the page itself calls);
- search result pages reachable without passing the gate;
- the same records from another public government source (state portal, GIS server, open
  data site).

If any route returns the records, take it and record the method in `workaround_log` (see
`collection-policy.md`). Do not escalate.

## 2. If there is no no-accept route, ask a human

Stop and ask a human to approve clicking, registering, or accepting. In the request, name:

- **which site** (host and the page with the gate);
- **what the gate asks you to accept** (quote the terms/login/registration requirement);
- **what you tried** (the no-accept routes from section 1 and why each failed).

Click, register, or accept **only after a human approves**. One approval covers the exact
condition named; a different gate needs its own approval.

## 3. After approval, log it

Record the acceptance so it is auditable and reproducible, in the county findings and, for a
catalogued source, in `docs/<county>-sources.yaml`:

```yaml
terms_acceptance_log:
  - url: <URL of the gate>
    condition_accepted: <what you accepted>
    approved_by: <human who approved>
    date: <YYYY-MM-DD>
```

## 4. Stop and report

Stop and report, without accepting anything, when the login or terms acceptance is on a
**private, non-government site**. We collect government records; a private host's account or
terms is not ours to accept, and its data is out of scope.

## Catalog field

For a jurisdiction whose only route requires human-approved acceptance, record the approved
acceptance in the source YAML so coverage shows why the route was taken:

```yaml
terms_acceptance:
  url: https://example.gov/permits/portal
  condition_accepted: site registration and terms of use
  approved_by: <human>
  date: 2026-01-01
```

A jurisdiction that is merely bot-/IP-blocked needs no such field: work around the block and
record it in `workaround_log` instead.
