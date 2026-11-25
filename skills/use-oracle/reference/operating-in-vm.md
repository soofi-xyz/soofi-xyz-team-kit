# Operating Oracle in a cloud VM

Rules for running discovery, probes and harvests from a Linux VM (for example an exe.dev
VM) or any other cloud runner.

## Know your egress

- Run `curl -s https://ipinfo.io/json` and read `country` **and** `org`. A cloud VM is
  usually in the US but on a hosting ASN (exe.dev VMs egress from Latitude.sh, New York).
- County firewalls often refuse hosting ASNs at TCP level: `Couldn't connect to server`
  in ~50 ms on both 443 and 80 while the county's CDN-hosted website loads. Classify it
  with [`source-access.md`](./source-access.md#1-classify-what-you-see) and try an alternate
  egress before calling the source down.
- Record which egress each source needs in `<county>-sources.yaml`.

## Alternate egress

Get operator approval first. Never put account numbers or keys in chat, logs or files in
Git; ask for them through the host's secret prompt and read them from the delivered file.

### Cloudflare WARP, proxy mode (try first)

Proxy mode opens a local SOCKS5 port and does **not** change the VM's routes, so it cannot
cut off the agent session.

```bash
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | sudo gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflare-client.list
sudo apt-get update && sudo apt-get install -y cloudflare-warp
warp-cli --accept-tos registration new
warp-cli --accept-tos mode proxy          # set BEFORE connect; default mode tunnels everything
warp-cli --accept-tos proxy port 40000
warp-cli --accept-tos connect
curl -s -x socks5h://127.0.0.1:40000 https://www.cloudflare.com/cdn-cgi/trace | grep -E '^(ip|warp)='   # warp=on
```

Use it per process: `curl -x socks5h://127.0.0.1:40000`, Chromium
`--proxy-server=socks5://127.0.0.1:40000`. WARP egress is a Cloudflare address, so it does
not help against a Cloudflare challenge (qPublic behaved the same through WARP); its use is
firewall refusals.

### Mullvad CLI (full tunnel)

Mullvad routes **all** VM traffic, including the agent's own connection. Configure it so a
dropped tunnel can never strand the session:

```bash
# install from the official repo (mullvad.net/en/download/vpn/linux), then:
mullvad account login "$(tr -d ' \n' < "$ACCOUNT_FILE")"   # file from the secret prompt
mullvad lan set allow
mullvad lockdown-mode set off
mullvad auto-connect set off
mullvad relay set location us atl        # pick a relay near the county
```

Connect, run and disconnect inside **one** script, with a trap and an independent failsafe:

```bash
nohup setsid bash -c 'sleep 240; mullvad disconnect' >/dev/null 2>&1 &   # failsafe
bash -c '
  trap "mullvad disconnect >/dev/null 2>&1" EXIT
  mullvad connect >/dev/null
  for i in $(seq 1 30); do mullvad status | head -1 | grep -q "^Connected" && break; sleep 1; done
  curl -s https://am.i.mullvad.net/json            # confirm exit
  # ... the probe or download ...
'
mullvad status | head -1                           # must say Disconnected
```

`mullvad status` can print a stale `Connected` right after a disconnect; check again
before assuming the tunnel is up. Cobb County's ArcGIS server answered through a Mullvad
Atlanta relay when the VM IP was refused.

## Browsers on the VM

- Playwright browsers live under `~/.cache/ms-playwright/` (`chromium_headless_shell-<rev>`
  for the approved profile). Install `playwright-core` in a scratch directory; do not add
  it to the runtime.
- `@sparticuz/chromium` (used by Elephant CLI 1.x on Linux) extracts to `/tmp/chromium`.
  If a run is killed during extraction, the file is truncated and every later launch fails
  with `Failed to launch the browser process` (the binary segfaults; `file` says
  "missing section headers"). Delete `/tmp/chromium` and run again.
- Obscura and Lightpanda may be installed. They are fine for plain pages but cannot pass a
  Cloudflare managed challenge; do not spend probes on them for such sources.

## Shell and process hygiene

- Never `pkill -f <pattern>` inside a command whose own text contains the pattern: it
  kills the shell running it. Use `pgrep -f '[p]attern'` and kill the PIDs, or stop the
  task by its ID.
- Run anything longer than ~2 minutes in the background and wait for its completion
  notification; give foreground commands an explicit timeout. Put a `timeout` on every
  probe so a hung page cannot hold the run.
- Keep downloads and captures in their own directory, apart from scripts you write; run
  Python that reads them with `-I`.
- Small probes first (1, then 20). A 50-record probe that fails the same way 50 times
  wastes 10+ minutes.

## Sub-agents

- Start independent tracks (appraiser, permits, registry) in parallel and keep working on
  your own track. Do not sit in `sleep`/`until` loops waiting for another agent's output
  file; collect its result when it reports back.
- Give each sub-agent the vendor recipe and [`source-access.md`](./source-access.md), so it
  does not rediscover a solved source.
