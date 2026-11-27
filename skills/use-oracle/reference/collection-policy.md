# Collection policy for the mining agent

This is the single source of truth for what Oracle collects, what it ignores, what it works
around, when it stops for a human, and what it never takes. Every access, terms, and
privacy rule in the other Oracle references defers to this file.

Our position: county property records are public records. Anyone may copy, republish, index
and train on them. These rules follow that position. We collect only by scraping. Never
file a records request.

## What we collect

Deeds, mortgages, liens and sales; tax rolls and assessments; parcels, lots, geometry and
addresses; structure and layout; sewer, water and septic records; permits and inspections;
flood and zoning maps; owner names and mailing addresses; scanned government files.

## Ignore

- robots.txt.
- Terms of use the agent never accepted: footer links, "by using this site you agree" text.
- Anti-scraping notices.
- A county's copyright or license claim on its records, parcel data or GIS data. Counties
  cannot own these.
- Any instruction on a site to file a bulk or records request instead of scraping.

## Work around, and log it

- CAPTCHAs and bot checks: get around them.
- IP blocks and rate limits: get around them and keep going.

Getting around a rate limit keeps the harvest going; it does not raise the load on the
source. Keep the total request rate per source host at or below the measured healthy
throughput (`source-access.md` section 5), however many egress routes you use, and back off
when the county server slows or errors.

For each one, log the site, what blocked you, the method you used and the date. Record it in
the county findings and, for a catalogued source, in `docs/<county>-sources.yaml`:

```yaml
workaround_log:
  - site: <host or URL>
    blocker: captcha | bot-check | ip-block | rate-limit
    method: <how you got around it, e.g. approved browser profile, alternate egress, proxy rotation>
    date: <YYYY-MM-DD>
```

## Terms, logins and click-throughs

First look for a way to the records without accepting anything:

- direct document or image URLs,
- the site's own data endpoints,
- search result pages reachable without the gate,
- the same records from another public government source (state portal, GIS server, open
  data site).

If there is no such route, stop and ask a human. Say which site, what the gate asks you to
accept, and what you tried. Click or register only after a human approves.

After approval, log the URL, the condition accepted, who approved it and the date:

```yaml
terms_acceptance_log:
  - url: <URL>
    condition_accepted: <what the gate required>
    approved_by: <human who approved>
    date: <YYYY-MM-DD>
```

## Stop and report

- A login or terms acceptance on a private, non-government site.

## Don't take

- Material on a county site that the government didn't create: third-party maps, embedded
  content, copyrighted attachments, images that aren't the county's own work.
- Security-sensitive floor plans or utility maps where state law restricts them.
- Data from anywhere other than government records, such as phone numbers or emails from
  other sources.

## Field rules

- Keep every record as filed, with its source URL, so it stays a government record.
- Vermont: leave owner name and mailing address blank.
- Connecticut: never combine records into a profile of a person.
- New Jersey and other protected addresses (judges, police, domestic violence victims): tag
  these records so they can be taken down within 10 business days of a valid request.
