#!/usr/bin/env python3
"""Clean-room scan for the self-contained Elephant ingestion runtime.

Run this from any checkout of this plugin — including a throwaway
`git clone --no-local .` into a temporary directory with no sibling source
repositories, no portal network access, and no credentials:

    python3 scripts/check-plugin-clean-room.py

It resolves the repository root from this file's own location (never the
caller's cwd) and inspects only `git ls-files`-tracked content, so results
are identical for a working copy and a fresh clone.

Exits 0 only when every gate below passes. Any failure prints a `- ` bullet
per finding to stderr and exits 1.

Gates:
  1. No tracked secrets: private-key blocks, cloud/vendor API token shapes,
     and quoted secret-looking assignments (`token: "..."`, `apiKey = "..."`),
     plus embedded non-localhost connection-string credentials. Public
     Filebase/IPNS URLs and Git provenance SHA citations are allowlisted —
     see ALLOWLIST_PATTERNS — since both are long, high-entropy-looking
     strings that legitimately appear throughout the bundled catalog and
     source-provenance docs.
  2. No tracked generated runtime directories (`node_modules/`,
     `downloads/`) and no tracked `.env*` file other than `.env.example`.
  3. No prohibited source-repository install/clone instruction on the
     tracked surface: `npx skills add ...`, or an instruction to `clone`
     one of the ingestion source repos this plugin must stay independent of
     (`oracle-node`, `Counties-trasform-scripts`, `elephant-query-db`) as a
     prerequisite. A line/paragraph that *states* the constraint negatively
     ("do not run `npx skills add ...`", "does not clone `oracle-node`") is
     not a violation — see NEGATION_CUES.
  4. No tracked file under `skills/use-oracle/runtime/` above the documented
     fixture size limit (`FIXTURE_SIZE_LIMIT_BYTES`; see
     `skills/use-oracle/reference/self-contained-ingestion.md`), except the
     npm lockfile.
  5. No broken symlink anywhere in the tracked tree (for example the Codex
     marketplace plugin symlinks under `plugins/soofi-xyz-team-kit/`).
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Fixtures/adapters/scripts are source code; a real capture (HTML dump,
# Parquet shard, ZIP) is at least an order of magnitude larger than anything
# legitimately hand-authored here. Keep in sync with the documented limit in
# skills/use-oracle/reference/self-contained-ingestion.md.
FIXTURE_SIZE_LIMIT_BYTES = 512 * 1024

RUNTIME_PREFIX = "skills/use-oracle/runtime/"
SIZE_LIMIT_EXEMPT = {f"{RUNTIME_PREFIX}package-lock.json"}

GENERATED_DIR_SEGMENTS = {"node_modules", "downloads"}
ENV_BASENAME = re.compile(r"^\.env(\..+)?$")
ENV_ALLOWED_EXACT = {".env.example"}

NEGATION_CUES = re.compile(
    r"\b(do not|don't|never|must not|without|forbidden|prohibit(?:ed|s)?|"
    r"remove(?:d|s)?|reject(?:ed|s)?|no longer|instead of|rather than|"
    r"not run|not install|not clone)\b",
    re.IGNORECASE,
)

# Named upstream ingestion repos this plugin must stay independent of at
# runtime (Global Constraint). elephant-mcp is deliberately excluded: a
# self-host `git clone` of elephant-mcp is a legitimate, unrelated,
# already-documented step in `deploy-open-data-mcp`.
BANNED_CLONE_REPOS = r"(?:oracle-node|Counties-trasform-scripts|elephant-query-db)"
# `[\s\S]{0,80}` (bounded, so still O(n) — not the unbounded-charclass shape
# that caused the ReDoS fixed above) rather than `[^\n]{0,80}` so a hard
# markdown line-wrap between "clone" and the repo name still matches.
PROHIBITED_INSTALL_PATTERNS = [
    ("npx skills add", re.compile(r"npx\s+skills\s+add", re.IGNORECASE)),
    (
        "clone of a banned ingestion source repo",
        re.compile(rf"\bclone\b[\s\S]{{0,80}}\b{BANNED_CLONE_REPOS}\b", re.IGNORECASE),
    ),
    (
        "clone of a banned ingestion source repo",
        re.compile(rf"\b{BANNED_CLONE_REPOS}\b[\s\S]{{0,80}}\bclone\b", re.IGNORECASE),
    ),
]
NEGATION_WINDOW = 150

ALLOWLIST_PATTERNS = [
    re.compile(r"https://ipfs\.filebase\.io/ipns/[a-z0-9]{20,}/?"),
    re.compile(r"https://k51[a-z0-9]{20,}\.ipns\.dweb\.link/?"),
    re.compile(r"\bk51[a-z0-9]{40,}\b"),  # bare Filebase/IPNS network keys
    re.compile(r"\b[0-9a-f]{40}\b"),  # Git commit SHA provenance citations
]

SECRET_PATTERNS = [
    ("AWS access key ID", re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("GitHub fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("OpenAI-style key", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("PEM private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    (
        "quoted secret-like assignment",
        re.compile(
            r"(?i)\b(secret|token|password|passwd|api[_-]?key|access[_-]?key|"
            r'private[_-]?key)\b\s*[:=]\s*["\']([A-Za-z0-9+/_.=-]{16,})["\']'
        ),
    ),
    (
        "embedded connection-string credential",
        # A fixed scheme alternation (not a generic `[a-z]+://` charclass)
        # so an unrelated long homogeneous run of scheme-charset bytes (for
        # example a generated fixture full of repeated characters) can only
        # ever start a match at a literal scheme keyword, keeping this
        # O(n) instead of the O(n^2) backtracking a greedy `[a-z0-9+.-]*`
        # prefix would cause on such input.
        re.compile(
            r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqps?|https?|ftp|sftp)"
            r"://[^:\s\"'/@]{1,200}:[^@\s\"']{1,200}@[^\s\"']{1,200}"
        ),
    ),
]
LOCAL_HOST_ALLOWLIST = re.compile(r"@(localhost|127\.0\.0\.1|0\.0\.0\.0)(?=[:/]|$)", re.IGNORECASE)

TEXT_READ_ERRORS = (UnicodeDecodeError, OSError)

# This scanner's own `run_self_test()` embeds literal examples of every
# violation shape it detects (so it can prove detection actually fires).
# Exclude this file itself from the secret/prohibited-install text scans —
# not from any other gate — so scanning this repository does not flag the
# scanner's own test fixtures as violations of the rules they exist to test.
SELF_PATH = "scripts/check-plugin-clean-room.py"


def tracked_files(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"],
        capture_output=True,
        check=True,
    )
    return [entry for entry in result.stdout.decode("utf-8", "surrogateescape").split("\0") if entry]


def tracked_symlinks(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-s", "-z"],
        capture_output=True,
        check=True,
    )
    entries = [e for e in result.stdout.decode("utf-8", "surrogateescape").split("\0") if e]
    paths = []
    for entry in entries:
        # Format: "<mode> <sha> <stage>\t<path>"
        meta, _, path = entry.partition("\t")
        mode = meta.split(" ", 1)[0]
        if mode == "120000":
            paths.append(path)
    return paths


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except TEXT_READ_ERRORS:
        return None


def is_allowlisted(snippet: str) -> bool:
    return any(pattern.search(snippet) for pattern in ALLOWLIST_PATTERNS)


def check_secrets(root: Path, files: list[str]) -> list[str]:
    findings = []
    for rel in files:
        if rel.startswith(f"{RUNTIME_PREFIX}node_modules/") or rel == SELF_PATH:
            continue
        text = read_text(root / rel)
        if text is None:
            continue
        for label, pattern in SECRET_PATTERNS:
            for match in pattern.finditer(text):
                snippet = match.group(0)
                if label == "embedded connection-string credential" and LOCAL_HOST_ALLOWLIST.search(snippet):
                    continue
                if is_allowlisted(snippet):
                    continue
                line_no = text.count("\n", 0, match.start()) + 1
                findings.append(f"{rel}:{line_no}: possible {label}: {snippet[:80]!r}")
    return findings


def check_generated_dirs_and_env(root: Path, files: list[str]) -> list[str]:
    findings = []
    for rel in files:
        parts = Path(rel).parts
        if any(segment in GENERATED_DIR_SEGMENTS for segment in parts[:-1]):
            findings.append(f"{rel}: tracked file inside a generated runtime directory ({GENERATED_DIR_SEGMENTS & set(parts)})")
            continue
        basename = parts[-1]
        if ENV_BASENAME.match(basename) and basename not in ENV_ALLOWED_EXACT:
            findings.append(f"{rel}: tracked .env* file (only .env.example may be committed)")
    return findings


def check_prohibited_installs(root: Path, files: list[str]) -> list[str]:
    findings = []
    for rel in files:
        if rel.startswith(f"{RUNTIME_PREFIX}node_modules/") or rel == SELF_PATH:
            continue
        text = read_text(root / rel)
        if text is None:
            continue
        for label, pattern in PROHIBITED_INSTALL_PATTERNS:
            for match in pattern.finditer(text):
                start = max(0, match.start() - NEGATION_WINDOW)
                end = min(len(text), match.end() + NEGATION_WINDOW)
                window = text[start:end].replace("\n", " ")
                if NEGATION_CUES.search(window):
                    continue
                line_no = text.count("\n", 0, match.start()) + 1
                findings.append(f"{rel}:{line_no}: prohibited instruction ({label}): {match.group(0)!r}")
    return findings


def check_oversized_artifacts(root: Path, files: list[str]) -> list[str]:
    findings = []
    for rel in files:
        if not rel.startswith(RUNTIME_PREFIX) or rel in SIZE_LIMIT_EXEMPT:
            continue
        path = root / rel
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size > FIXTURE_SIZE_LIMIT_BYTES:
            findings.append(
                f"{rel}: {size} bytes exceeds the {FIXTURE_SIZE_LIMIT_BYTES}-byte fixture limit "
                "(looks like a generated capture/parcel artifact, not hand-authored source)"
            )
    return findings


def check_broken_symlinks(root: Path, symlink_paths: list[str]) -> list[str]:
    findings = []
    for rel in symlink_paths:
        path = root / rel
        if not path.is_symlink():
            # Working tree may have replaced the symlink with a real file;
            # that is a different problem (checked by validate-plugin.sh's
            # manifest checks), not a broken symlink.
            continue
        if not path.exists():
            findings.append(f"{rel}: broken symlink (target does not resolve)")
    return findings


def check_runtime_bundle_present(root: Path) -> list[str]:
    findings = []
    required = [
        f"{RUNTIME_PREFIX}package.json",
        f"{RUNTIME_PREFIX}catalog/published-counties.json",
        f"{RUNTIME_PREFIX}catalog/mcp-overlays.json",
    ]
    for rel in required:
        if not (root / rel).is_file():
            findings.append(f"{rel}: required Oracle runtime file is missing")
    return findings


def _git(*args: str, cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _expect(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def run_self_test() -> int:
    """Exercise every gate against a synthetic tracked-file fixture, proving
    each rule both fires on a violation and stays silent on the allowlisted
    equivalent. Does not touch this repository's own tracked content."""
    errors: list[str] = []
    tmp = Path(tempfile.mkdtemp(prefix="clean-room-self-test-"))
    try:
        _git("init", "-q", cwd=tmp)
        _git("config", "user.email", "test@example.invalid", cwd=tmp)
        _git("config", "user.name", "Clean Room Self Test", cwd=tmp)

        # --- Gate 1: secrets, with allowlisted lookalikes alongside ---
        _write(
            tmp / "docs" / "example.md",
            "AWS key: AKIAABCDEFGHIJKLMNOP\n"
            'token: "abcdefghijklmnopqrstuvwx"\n'
            "postgresql://postgres:elephant@localhost:5432/elephant\n"
            "-----BEGIN RSA PRIVATE KEY-----\n"
            "safe: DATABASE_URL=<placeholder-neon-url>\n"
            "safe: secret = env.S3_SECRET_ACCESS_KEY\n"
            "safe: secret:marketplace/subscription/{tenantId}\n"
            "safe filebase url: https://ipfs.filebase.io/ipns/"
            "k51qzi5uqu5dibuhwyztmkjgvz94v3mkpgfreryxwb3d4neta5e7tsxebfi09s\n"
            "safe provenance sha: oracle-node@ff68b0b6812598d07e0f4aaa322ddbfe230f20b9\n"
            "full sha citation: ff68b0b6812598d07e0f4aaa322ddbfe230f20b9\n",
        )

        # --- Gate 2: generated dirs + .env ---
        _write(tmp / "skills" / "use-oracle" / "runtime" / "node_modules" / "x" / "index.js", "x")
        _write(tmp / "skills" / "use-oracle" / "runtime" / "downloads" / "capture.html", "x")
        _write(tmp / ".env", "SECRET=x\n")
        _write(tmp / ".env.example", "SECRET=\n")

        # --- Gate 3: prohibited installs, negated vs imperative. Kept in
        # separate files (not just separate lines) so the negation-window
        # check for one example can never accidentally absorb the cue word
        # from an unrelated nearby example. ---
        _write(
            tmp / "docs" / "constraint-negated.md",
            "Do not run `npx skills add elephant-xyz/skills`.\n\n"
            "This self-contained runtime does not clone `oracle-node` at any stage.\n",
        )
        _write(
            tmp / "docs" / "constraint-imperative.md",
            "First, run `npx skills add elephant-xyz/skills` to fetch ingestion skills.\n\n"
            "Clone oracle-node into a sibling directory before continuing.\n",
        )

        # --- Gate 4: oversized runtime artifact vs exempt lockfile ---
        _write(
            tmp / "skills" / "use-oracle" / "runtime" / "package.json",
            '{"name": "fixture"}\n',
        )
        _write(
            tmp / "skills" / "use-oracle" / "runtime" / "catalog" / "published-counties.json",
            '{"counties": []}\n',
        )
        _write(
            tmp / "skills" / "use-oracle" / "runtime" / "catalog" / "mcp-overlays.json",
            '{"counties": []}\n',
        )
        _write(
            tmp / "skills" / "use-oracle" / "runtime" / "fixtures" / "oversized.html",
            "x" * (FIXTURE_SIZE_LIMIT_BYTES + 1),
        )
        _write(
            tmp / "skills" / "use-oracle" / "runtime" / "package-lock.json",
            "x" * (FIXTURE_SIZE_LIMIT_BYTES + 1),
        )

        _git("add", "-A", cwd=tmp)

        # --- Gate 5: broken vs healthy symlink (added after `git add` so we
        # can control exactly one of each; git tracks symlinks by target
        # text, so a dangling target is tracked without error). ---
        (tmp / "healthy-target.txt").write_text("ok", encoding="utf-8")
        (tmp / "healthy-link.txt").symlink_to(tmp / "healthy-target.txt")
        (tmp / "broken-link.txt").symlink_to(tmp / "does-not-exist.txt")
        _git("add", "-A", cwd=tmp)

        files = tracked_files(tmp)
        symlinks = tracked_symlinks(tmp)

        secret_findings = check_secrets(tmp, files)
        _expect(
            any("AWS access key ID" in f for f in secret_findings),
            "self-test: AWS access key must be detected",
            errors,
        )
        _expect(
            any("quoted secret-like assignment" in f for f in secret_findings),
            "self-test: quoted secret-like assignment must be detected",
            errors,
        )
        _expect(
            any("PEM private key" in f for f in secret_findings),
            "self-test: PEM private key block must be detected",
            errors,
        )
        _expect(
            not any("localhost" in f for f in secret_findings),
            "self-test: localhost connection string must be allowlisted",
            errors,
        )
        _expect(
            not any("k51qzi5uqu5d" in f for f in secret_findings),
            "self-test: Filebase/IPNS URL must be allowlisted, not flagged as a secret",
            errors,
        )
        _expect(
            not any("ff68b0b6812598d07e0f4aaa322ddbfe230f20b9" in f for f in secret_findings),
            "self-test: provenance Git SHA must be allowlisted, not flagged as a secret",
            errors,
        )
        _expect(
            not any("secret = env.S3_SECRET_ACCESS_KEY" in f for f in secret_findings),
            "self-test: unquoted identifier reference must not be flagged as a secret",
            errors,
        )
        _expect(
            not any("marketplace/subscription" in f for f in secret_findings),
            "self-test: unquoted naming-convention path must not be flagged as a secret",
            errors,
        )

        dir_findings = check_generated_dirs_and_env(tmp, files)
        _expect(
            any("node_modules" in f for f in dir_findings),
            "self-test: tracked node_modules must be rejected",
            errors,
        )
        _expect(
            any("downloads" in f and "generated runtime directory" in f for f in dir_findings),
            "self-test: tracked downloads/ must be rejected",
            errors,
        )
        _expect(
            any(f.startswith(".env:") for f in dir_findings),
            "self-test: tracked .env must be rejected",
            errors,
        )
        _expect(
            not any(f.startswith(".env.example:") for f in dir_findings),
            "self-test: tracked .env.example must be allowed",
            errors,
        )

        install_findings = check_prohibited_installs(tmp, files)
        _expect(
            any("npx skills add" in f for f in install_findings),
            "self-test: imperative `npx skills add` must be rejected",
            errors,
        )
        _expect(
            any("banned ingestion source repo" in f for f in install_findings),
            "self-test: imperative clone-oracle-node instruction must be rejected",
            errors,
        )
        _expect(
            sum(1 for f in install_findings if "npx skills add" in f) == 1,
            "self-test: negated `Do not run npx skills add` must not itself be flagged",
            errors,
        )
        _expect(
            sum(1 for f in install_findings if "banned ingestion source repo" in f) == 1,
            "self-test: negated `does not clone oracle-node` must not itself be flagged",
            errors,
        )

        size_findings = check_oversized_artifacts(tmp, files)
        _expect(
            any("oversized.html" in f for f in size_findings),
            "self-test: oversized runtime fixture must be rejected",
            errors,
        )
        _expect(
            not any("package-lock.json" in f for f in size_findings),
            "self-test: package-lock.json must be exempt from the size limit",
            errors,
        )

        symlink_findings = check_broken_symlinks(tmp, symlinks)
        _expect(
            any("broken-link.txt" in f for f in symlink_findings),
            "self-test: dangling symlink target must be rejected",
            errors,
        )
        _expect(
            not any("healthy-link.txt" in f for f in symlink_findings),
            "self-test: a symlink with an existing target must not be rejected",
            errors,
        )

        bundle_findings = check_runtime_bundle_present(tmp)
        _expect(
            bundle_findings == [],
            f"self-test: expected the fixture runtime bundle to satisfy the presence gate, got {bundle_findings}",
            errors,
        )
        empty_tmp = Path(tempfile.mkdtemp(prefix="clean-room-self-test-empty-"))
        try:
            _expect(
                len(check_runtime_bundle_present(empty_tmp)) == 3,
                "self-test: an empty checkout must fail all three runtime-bundle presence checks",
                errors,
            )
        finally:
            shutil.rmtree(empty_tmp, ignore_errors=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if errors:
        print("clean-room self-test failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("clean-room self-test passed")
    return 0


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] in {"--self-test", "--test"}:
        return run_self_test()

    files = tracked_files(ROOT)
    symlinks = tracked_symlinks(ROOT)

    findings: list[str] = []
    findings += check_runtime_bundle_present(ROOT)
    findings += check_generated_dirs_and_env(ROOT, files)
    findings += check_secrets(ROOT, files)
    findings += check_prohibited_installs(ROOT, files)
    findings += check_oversized_artifacts(ROOT, files)
    findings += check_broken_symlinks(ROOT, symlinks)

    if findings:
        print("Clean-room scan failed:", file=sys.stderr)
        for finding in findings:
            print(f"- {finding}", file=sys.stderr)
        return 1

    print(f"clean-room scan passed ({len(files)} tracked files, {len(symlinks)} symlinks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
