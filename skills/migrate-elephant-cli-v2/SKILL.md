---
name: migrate-elephant-cli-v2
description: "Move a county workflow from Elephant CLI 1.x (Node) to the experimental Elephant CLI 2 (one native binary with transform and prepare built in): how to install it, what stays the same, what changes, and the side-by-side check to run before the cut-over. Use when a task runs elephant-cli prepare, transform, validate, hash, export-tables or upload, when the user asks about Elephant CLI 2, or when installing the CLI from npm or GitHub fails."
metadata: {"author":"elephant-xyz"}
---

# Migrate to Elephant CLI 2

Elephant CLI 2 is a rewrite of `elephant-cli` as one native binary. It is
**experimental**: it lives on the `v2` branch of `elephant-xyz/elephant-cli`, every
commit there is published as a pre-release, and `main` and the npm package stay 1.x.

Names that look alike: a **Transform v2 handler** and a **Browser Flow v2** package are
file formats. Both CLIs read them. They say nothing about the CLI version.

## Propose it, do not switch silently

Before the first Elephant CLI command of a task, tell the user in a few lines:

- Elephant CLI 2 is one binary. It needs no Node, no `npm install` and no Chromium
  download.
- `validate`, `hash`, `export-tables` and `upload` keep their names and options. `hash`
  packs each data group of a property into one block by default; with `--linked` it
  writes the same bytes and CIDs as 1.x.
- `transform` and `prepare` are built in: county scripts and handlers run on an engine
  inside the binary, and `prepare` fetches and drives the browser itself.
- It is experimental. A problem is reported to `elephant-xyz/elephant-cli`, and 1.x
  stays available.

Then ask which CLI to use. Use Elephant CLI 2 when the user accepts and 1.x when they
decline. Record the answer, the output of `elephant-cli --version` and the build commit
in the run evidence. Do not ask again in the same task.

## Install

Each build has one archive per platform:

| Platform | `<target>` |
| --- | --- |
| macOS Apple silicon | `aarch64-apple-darwin` |
| macOS Intel | `x86_64-apple-darwin` |
| Linux x86_64 | `x86_64-unknown-linux-gnu` |
| Linux arm64 | `aarch64-unknown-linux-gnu` |
| Linux x86_64, static | `x86_64-unknown-linux-musl` |
| Linux arm64, static | `aarch64-unknown-linux-musl` |

The `gnu` binaries need glibc 2.35 or newer. Use a static one on AWS Lambda, Amazon
Linux, Alpine and older distributions.

```bash
target=aarch64-apple-darwin
commit=$(git ls-remote https://github.com/elephant-xyz/elephant-cli v2 | cut -f1)
mkdir -p elephant-cli-2
curl -fsSL "https://github.com/elephant-xyz/elephant-cli/releases/download/build-$commit/elephant-cli-$target.tar.gz" \
  | tar -xz -C elephant-cli-2
./elephant-cli-2/elephant-cli --version   # elephant-cli 2.x
```

- Keep it in its own directory until the cut-over, so `elephant-cli` on the `PATH` is
  still 1.x and both can run on the same input.
- A tagged release `v2.*` on the releases page is installed the same way, with the tag in
  place of `build-$commit`. `releases/latest` is 1.x: always name the build or the tag.
- With a Rust toolchain: `cargo install --git https://github.com/elephant-xyz/elephant-cli --branch v2 --locked`.
- The browser mechanisms of `prepare` need the obscura headless browser: download it from
  <https://github.com/h4ckf0r0day/obscura/releases>, put `obscura` on the `PATH` or name
  it in `OBSCURA_BIN`. Nothing else needs it.

## Built-in transform and prepare

Offer these whenever a task captures or transforms county pages. They replace a Node
install, the CLI's `node_modules` and a bundled Chromium.

**transform**

- Runs the five county scripts (`--scripts-zip`) or a handler package (`--transform-zip`)
  on a JavaScript engine inside the binary. `cheerio` is built in for both.
- Scripts get the part of Node the published county scripts use: `fs`, `path`, `vm`,
  `crypto` (`sha256`), `http.get` and `https.get`, `process`, `Buffer`, `URL`. A script
  that reaches for anything else fails with the name of what is missing. Other npm
  packages are not available.
- A script reads and writes only its working directory. `--offline` also takes its
  network away.
- It starts fast. On the two counties bundled with this kit, one parcel took 0.4 s with
  Elephant CLI 2 and 2.0 to 2.7 s with 1.x, with the same CIDs after `hash`.

**prepare**

- Plain HTTP requests, multi-request flows (`--multi-request-flow-file`) and the Orange
  County API need nothing but the binary.
- Browser flows (`--browser-flow-file`), Browser Flow v2 packages (`--browser-flow-zip`)
  and `--use-browser` start obscura and stop it when done.

**Where they run.** Anywhere the binary runs: a laptop, CI, a container, AWS Lambda (the
static binary; see "AWS Lambda" in the CLI's README for how to ship it with a function).
From code, run the binary with `--json`: stdout is one JSON document, exit `0` is success,
`1` means the input failed its checks, `2` means the command could not run.

```bash
elephant-cli prepare seed.zip --output-zip prepared.zip --multi-request-flow-file flow.json
elephant-cli transform --input-zip prepared.zip --scripts-zip scripts.zip --output-zip transformed.zip
elephant-cli --json validate transformed.zip --output-csv errors.csv
```

## What stays the same

- The publication sequence of `use-oracle`: `validate <input> --output-csv`,
  `hash <input> --output-zip --output-csv --output-car`, `validate <county>.car`,
  `export-tables` with its Atlas options, and `upload` with `--api`, `--token`,
  `--gateway`, `--timeout` and `--output-json`.
- With `hash --linked`: the bytes and CIDs `hash` writes, and the county CAR built from
  them.
- The lexicon manifest and `ELEPHANT_SCHEMA_MANIFEST_URL`.
- The CSV columns of `validate` and `hash`.
- The inputs of `transform`: seed mode, scripts mode and handler packages.

## What changes

| Area | 1.x | Elephant CLI 2 |
| --- | --- | --- |
| Install | `npm i github:elephant-xyz/elephant-cli#main`, Node 22+ | A binary per platform, or `cargo install`; there is no npm package |
| Library | `@elephant-xyz/cli/lib` | Gone; run the binary with `--json` |
| Removed commands | `validate-and-upload`, `submit-to-contract`, `check-transaction-status`, `check-gas-price`, `create-keystore`, `hex-to-cid`, `cid-to-hex`, `fetch-data`, `generate-transform` | Not available; keep 1.x for these |
| Exit codes | `1` for every failure | `1` the input failed its checks, `2` the command could not run |
| Output | Banners on stdout, `elephant-cli.log` in the working directory | A plain report, or one JSON document with `--json`; no log file |
| `.env` | Loaded from the working directory | Not loaded; export the variables |
| Gateways | `--ipfs-gateway <url>` | `ELEPHANT_IPFS_GATEWAYS`, a comma-separated list |
| `validate` on properties | Writes `submit_warnings.csv` | No warnings file; a property that cannot be checked is named on stderr, exit `2` |
| `hash` | A data group that cannot be hashed goes to `submit_errors.csv`, exit `0` | Named on stderr and in `--json`, exit `1`; `--property-cid` and `--max-concurrent-tasks` are gone |
| `hash` layout | One block per file (linked), until the 1.x release with packed data groups | From build `94db3af`: one packed block per data group by default, other data CIDs; `--linked` writes the 1.x layout. `validate` and `export-tables` read both |
| `export-tables` | hyparquet writer | Apache Parquet writer: same tables, columns and rows; part CIDs and the tables root differ |
| `upload` | Also sends a hashed ZIP to Pinata | County CARs and tables directories only |
| `transform` scripts | Node child processes with the CLI's `node_modules` | The engine inside the binary, with the modules listed above |
| `transform` handlers | `--transform-version 2` required | `--transform-zip` alone is enough; `--transform-version 2` is still accepted |
| `transform` modes | Legacy mode, Property Improvement extractor mode | Gone |
| `prepare` flows | doT templates, `--browser-flow-template`, `--browser-flow-parameters` | Only `{{=it.<name>}}` is filled; write the flow as a `--browser-flow-file` |
| `prepare` browser | Bundled Chromium through Puppeteer, `--no-headless` | obscura, installed separately; no headed mode |
| `prepare --input-csv` | With a multi-request flow or a browser flow | With a multi-request flow only |
| `prepare` captures | Cleaned and reformatted with Prettier | Cleaned, not reformatted |
| Browser Flow v2 `page` | The whole Puppeteer `Page` | `goto`, `url`, `content`, `evaluate`, `waitForSelector`, `waitForFunction`, `waitForNavigation`, `click`, `type`, `select`, `$`, `$$`, `$eval`, `$$eval`, `keyboard.press`, `keyboard.type` |

The full table is "Migrating from 1.x" in the CLI's README on the `v2` branch.

## Migrate a county

Run these in order. Stop and keep 1.x when a step fails.

1. **Find what the workflow uses that is gone.** Search the county's scripts, flows and
   automation for the removed commands, `@elephant-xyz/cli/lib`, `--ipfs-gateway`,
   `--browser-flow-template`, `--browser-flow-parameters`, `--no-headless`,
   `--property-cid`, `--max-concurrent-tasks`, reads of `elephant-cli.log` or
   `submit_warnings.csv`, credentials that only a `.env` file provides, and code that
   treats every non-zero exit alike.
2. **Install Elephant CLI 2 next to 1.x** (see Install).
3. **Transform the same samples with both.** Use the 10 to 20 sample parcels of
   `build-county-transform`:

   ```bash
   v2=./elephant-cli-2/elephant-cli
   elephant-cli transform --input-zip prepared.zip --scripts-zip scripts.zip --output-zip t1.zip
   $v2          transform --input-zip prepared.zip --scripts-zip scripts.zip --output-zip t2.zip
   elephant-cli hash t1.zip --output-zip h1.zip --output-csv h1.csv
   $v2          hash t2.zip --linked --output-zip h2.zip --output-csv h2.csv
   diff <(cut -d, -f1-3 h1.csv | sort) <(cut -d, -f1-3 h2.csv | sort)
   ```

   `--linked` makes Elephant CLI 2 write the layout 1.x writes; without it the data CIDs
   differ by design. Give a 1.x that already packs `--linked` too. No difference means
   both produced the same records. A script that fails only on
   Elephant CLI 2 names what it reached for: replace that call in the script, or keep
   1.x for this county and report it.
4. **Validate with Elephant CLI 2**: `$v2 validate t2.zip --output-csv errors.csv`, then
   the whole samples directory. Exit `0` and no data rows.
5. **Capture with Elephant CLI 2.** Run `prepare` on three parcels of different property
   types with the county's flow. Captured HTML is not reformatted, so its bytes differ
   from a 1.x capture: compare by transforming both captures and repeating step 3.
6. **Hash and export a sample archive** as in step 7 of `build-county-transform`. The
   county CAR is the same file from either CLI when both write the same layout
   (`--linked`); publish packed, which is what `hash` writes without the option. The
   tables root is not the same: an Atlas page entry written by Elephant CLI 2 carries a
   different `tables` CID than 1.x wrote for the same archive. Hash, export, upload and
   register one data group with one CLI.
7. **Cut over.** Put the binary on the `PATH` in place of 1.x, export the variables a
   `.env` file used to supply, and replace the npm install line in the county's notes
   with the install above and the build commit.

Roll back by installing 1.x again: `npm i github:elephant-xyz/elephant-cli#main`.

## Report a problem

Elephant CLI 2 is experimental. When it and 1.x disagree, or it fails where 1.x passes:

- Finish the run with 1.x.
- Open an issue in `elephant-xyz/elephant-cli` with the command, the build commit, the
  smallest input that shows it, and both outputs. Leave credentials and private rows out.
- Never edit a county's output by hand to make the two CLIs agree.
