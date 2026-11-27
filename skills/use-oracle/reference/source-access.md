# Source access: classify the block, pick the route, prove the capture

Use this before you size a harvest. Read [`collection-policy.md`](./collection-policy.md)
first — it is the single source of truth. Under that policy you do not "report a source
blocked" for a bot check, CAPTCHA, IP block, or rate limit: you work around it and log it.
The one gate that escalates to a human is terms/login/click-through acceptance with no
no-accept route ([`access-escalation.md`](./access-escalation.md)). Check
[`cookbooks/`](./cookbooks/README.md) first: a known vendor (qPublic, Accela, Cloudpermit,
…) already has a measured recipe.

## 1. Classify what you see

Probe once with `curl -sS -o /dev/null -w '%{http_code} %{time_total}\n'` and once with the
approved browser profile (section 3). Then read the symptom, not the guess:

| Symptom | Meaning | Next step |
|---|---|---|
| `Failed to connect … Couldn't connect to server` within ~100 ms, on 443 and 80, while the county's main website loads | The county firewall refuses this egress, usually because it is a hosting/datacenter ASN | Work around through an alternate egress (section 2) and log it. Do not record "down" or "firewalled" without that retry |
| Timeout after many seconds | Source slow, overloaded, or silently dropping | Retry later and once through an alternate egress before calling it down |
| 403 with `Just a moment…` / `Performing security verification` / `cf-ray` | Cloudflare managed challenge | Work around with the approved browser profile (section 3) and log it. A plain `curl` 403 here proves nothing about the data |
| Visible CAPTCHA, Turnstile widget, or reCAPTCHA checkbox | Bot check | Get around it (section 3) and log it in `workaround_log`. A CAPTCHA is never a stop |
| Login wall or a "by using this site you agree" / registration gate | Acceptance gate | Try a no-accept route (`access-escalation.md` section 1); if none, ask a human to approve |
| 403 / "Access Denied" / blank page only from a non-US egress | Geo-block | US egress. Check with `curl -s https://ipinfo.io/json` (look at `country` **and** `org`) |
| 403 from every egress and every browser, no challenge page | Deliberate block or un-accepted terms restriction | Ignore the terms claim; keep working around (alternate egress, proxy rotation) and log it. Only an acceptance gate escalates |

A US IP does not rule out the first row. Cloud VMs and CI runners egress from hosting
providers, and county firewalls often refuse those ranges outright. A fast connection
refusal is that, not geography.

Always check the redirect target before giving up on a host. A county permit host can
refuse you only because it redirects to a vendor host that does not (Cobb's
`cobbca.cobbcounty.org` → `aca-prod.accela.com/COBBCO` loads from a hosting IP).

## 2. Alternate egress

Egress work-arounds for firewall refusals, IP blocks, and rate limits: get around them and
keep going. Record which route each source needs in `<county>-sources.yaml` and log the
work-around in `workaround_log` (`collection-policy.md`). Secret-handling and VM safety
rules are in [`operating-in-vm.md`](./operating-in-vm.md): never put account numbers or keys
in chat, logs, or committed files.

1. **Cloudflare WARP in proxy mode**: a local SOCKS5 port, the VM routing is untouched.
   Try it first for firewall refusals.
2. **Mullvad CLI**: a full tunnel. Use the connect → run → disconnect script with a
   failsafe. It reached Cobb County's ArcGIS server when the VM IP was refused.
3. **Proxy rotation** (`PROXY_FILE` on the fetcher, `--proxy` on the CLI): for sustained
   volume once a single egress is rate-limited.

An alternate egress does not get past a Cloudflare challenge on its own: on qPublic, WARP
and Mullvad behaved exactly like the VM IP. Egress fixes refusals; the browser profile fixes
challenges.

## 3. Approved browser profile

This is the profile `elephant-cli prepare` itself launches
(`src/lib/common.ts#createBrowserPage` in `elephant-xyz/elephant-cli`). Use it as is for
public appraiser and permit pages that show a **non-interactive** challenge:

- real Chromium in headless-shell mode (Playwright `chromium_headless_shell`, or
  `@sparticuz/chromium` with `headless: 'shell'`);
- user agent `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36`
  (no `HeadlessChrome`);
- `navigator.webdriver` undefined (init script);
- `Accept-Language: en-US,en;q=0.9`;
- images, stylesheets, fonts, media and websockets aborted;
- args `--no-sandbox --disable-web-security --disable-features=site-per-process --hide-scrollbars`.

Let the challenge clear inside that session, then start a fresh browser context when the
source re-challenges (qPublic: every 2 parcels). This profile is the cheapest work-around,
so try it first. When it does not clear a bot check, escalate the method — fingerprint
adjustments, a solver for the CAPTCHA, alternate egress or proxy rotation — until you get
around it, and log what worked in `workaround_log` (`collection-policy.md`). A bot check is
never a stop. The only stop is an acceptance gate (login, registration, "by using this site
you agree"): try a no-accept route, and if none exists ask a human to approve
([`access-escalation.md`](./access-escalation.md)).

What does **not** pass a Cloudflare managed challenge (measured 2026-11-25 on qPublic):

- Playwright's default launch (user agent says `HeadlessChrome`);
- browsers with their own JavaScript engine: Obscura (with or without `--stealth`,
  with the profile's user agent, driven over CDP) and Lightpanda (it stops with
  `BotChallenge`);
- `elephant-cli prepare --use-browser`, both 1.x and Elephant CLI 2: the challenge's first
  response is HTTP 403 and both CLIs throw on any first-navigation status ≥ 400 before the
  challenge can clear. `--ignore-captcha` does not skip that check. A
  `--browser-flow-file` skips it, but with 1.x's bundled `@sparticuz/chromium` 138 the
  challenge still had not cleared after 60 s.

Until the CLI waits out a non-interactive challenge, capture such sources with a dedicated
runner that uses this profile, and keep the CLI for `transform`, `validate`, `hash` and
publication.

## 4. Prove the page is ready

Decide "captured" from content, never from the title or one selector:

1. Pick a readiness condition from the vendor recipe: the source's own identifier in the
   page **and** a section that every real record has (qPublic: title `Report: <PIN>` and
   the text `Assessed Values`).
2. Prove it on saved pages before scaling: the condition must hold on every complete
   capture and on no partial one. After a challenge clears, the title often switches
   before the body arrives; a title-only check saved 98 KB shells instead of 150–180 KB
   reports.
3. Do not rely on a CSS class found on one sample (qPublic's `.sectionTitle` is absent on
   many reports). Playwright `waitForSelector` also waits for *visible* by default; pass
   `state: 'attached'` when you only need presence.
4. Count complete captures by the readiness condition plus a size floor, not by HTTP status
   (a cleared challenge still reports 403 as the first status).
5. Once the page is ready, store only the element that holds the data, plus `<title>`, as
   the transform input. Keep the full page gzipped beside it, with its sha256 in the
   capture receipt. A missing or empty container is a retryable failure. Prove it safe with
   byte-identical transform output before adopting it. Method and checks:
   [`../../build-county-transform/reference/html-capture-and-parsing.md`](../../build-county-transform/reference/html-capture-and-parsing.md).

## 5. Measure throughput

Never invent delays. Measure, then scale:

1. 1 record, verify content.
2. 20 records back to back with 1 worker, using the vendor's session rule.
3. The same 20 with 4 workers (one browser per worker, shared queue).
4. A sustained run of a few thousand at the best worker count, watching re-challenge and
   error rates.

Record per step: complete/total, retries, re-challenges, wall time, s/record and
records/hour. Use the numbers in the feasibility gate of `county-ingest-run`. A run that
fails every record in the same way is a runner bug until a known-good probe on the same
record also fails.

Getting around a rate limit keeps the harvest going. It does not raise the load on the
source. Keep the total request rate per source host at or below the measured healthy
throughput from this ladder, whatever the number of egress routes. A slow or erroring county
server is a reason to back off, not to add routes.

## 6. Before you hand back a source as not harvested

Bot checks, CAPTCHAs, IP blocks and rate limits are worked around, never reported as
blocked. Hand a source back only for an acceptance gate awaiting human approval, a login
or terms gate on a private non-government site, or data that is not published online (we
never file a records request). Before you do, finish all of these and name them in the
hand-back:

- [ ] Vendor recipe in `cookbooks/` checked.
- [ ] Symptom classified with the table in section 1 (state which row).
- [ ] Redirect target checked.
- [ ] Every work-around tried: approved browser profile, escalated bot-check methods,
      alternate egress, proxy rotation, each one logged in `workaround_log`.
- [ ] No-accept routes tried (`access-escalation.md` section 1): direct document URLs, the
      site's data endpoints, ungated result pages, another public government source.
- [ ] For an acceptance gate: the site, what it asks you to accept, and what you tried sent
      to a human for approval.
