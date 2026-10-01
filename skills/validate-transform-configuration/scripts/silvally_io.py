"""Shared helpers for the Silvally validation tools.

Only the Python standard library is used here. AWS access goes through the
`aws` CLI with an explicit operator-chosen profile; PROD calls are restricted
to read-only verbs. Nothing in this module stores credentials or raw rows.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

LAYOUT_PATH = Path(__file__).resolve().parent.parent / "reference" / "registry-layout.json"
DEFAULT_REGION = json.loads(LAYOUT_PATH.read_text())["repository"]["defaultRegion"]
READ_ONLY_VERBS = re.compile(r"^(get|list|describe|head|scan|query|batch-get|lookup|search|select|filter)\b")
WRITE_SUBCOMMANDS = {"start-execution", "put-object", "copy-object", "delete-object", "delete-objects", "put-item",
                     "update-item", "delete-item", "put-parameter", "delete-parameter", "start-job-run"}


class SilvallyError(RuntimeError):
    """A tool refused an unsafe or malformed operation."""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path | str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_digest(value: object) -> str:
    """sha256:<hex> of canonical JSON (sorted keys, compact separators)."""
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return "sha256:" + sha256_bytes(data)


def write_json(path: Path | str, value: object) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=1, sort_keys=False, default=str) + "\n")


def read_json(path: Path | str) -> object:
    return json.loads(Path(path).read_text())


def private_dir(path: Path | str) -> Path:
    """Create a mode-0700 directory for restricted local data (never commit it)."""
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    os.chmod(path, 0o700)
    return path


def credential_free(uri: str) -> str:
    """Drop query strings, fragments and user-info from a location."""
    uri = re.sub(r"[?#].*$", "", uri)
    return re.sub(r"^(\w+://)[^/@]+@", r"\1", uri)


def aws(args: list[str], *, profile: str, region: str = DEFAULT_REGION, environment: str = "dev",
        output_json: bool = True, check: bool = True) -> object:
    """Run the AWS CLI with an explicit profile.

    environment="prod" only allows read-only verbs; any write subcommand raises.
    """
    if not profile:
        raise SilvallyError("an explicit AWS profile is required; choose it with --profile")
    service, subcommand = (args + ["", ""])[:2]
    if environment == "prod" and (subcommand in WRITE_SUBCOMMANDS or not READ_ONLY_VERBS.match(subcommand)):
        if not (service == "s3" and subcommand in {"ls", "cp", "sync"} and _s3_download_only(args)):
            raise SilvallyError(f"PROD is read-only; refused: aws {service} {subcommand}")
    command = ["aws", *args, "--profile", profile, "--region", region]
    if output_json and service != "s3":
        command += ["--output", "json"]
    env = {k: v for k, v in os.environ.items() if k not in {"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE"}}
    result = subprocess.run(command, capture_output=True, text=True, env=env)
    if check and result.returncode != 0:
        raise SilvallyError(f"aws {service} {subcommand} failed: {result.stderr.strip()[-400:]}")
    if not output_json or service == "s3":
        return result.stdout
    return json.loads(result.stdout) if result.stdout.strip() else {}


def _s3_download_only(args: list[str]) -> bool:
    if args[1] == "ls":
        return True
    positional = [a for a in args[2:] if not a.startswith("--")]
    return len(positional) >= 2 and positional[0].startswith("s3://") and not positional[-1].startswith("s3://")


def account_id(profile: str, region: str = DEFAULT_REGION) -> str:
    return aws(["sts", "get-caller-identity"], profile=profile, region=region, environment="prod")["Account"]


def parse_s3(uri: str) -> tuple[str, str]:
    match = re.match(r"^s3://([^/]+)/?(.*)$", uri)
    if not match:
        raise SilvallyError(f"not an s3 URI: {uri}")
    return match.group(1), match.group(2)


def load_layout(path: Path | str | None = None) -> dict:
    """The registry layout: repository paths, SSM names, runtime conventions and defaults."""
    return json.loads(Path(path or LAYOUT_PATH).read_text())


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)
