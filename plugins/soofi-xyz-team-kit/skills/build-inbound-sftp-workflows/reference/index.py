from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Callable

import boto3
from botocore.exceptions import ClientError

MAX_RETURNED_ERRORS = 20
RETRYABLE_ERROR_CODES = {
    "Throttling",
    "ThrottlingException",
    "TooManyRequestsException",
    "RequestLimitExceeded",
}


def build_transfer_client():
    return boto3.client("transfer")


def build_s3_client():
    return boto3.client("s3")


def json_log(message: str, **fields: Any) -> None:
    payload = {"message": message, **fields}
    print(json.dumps(payload, sort_keys=True))


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_prefix(prefix: str | None) -> str:
    return (prefix or "").strip().strip("/")


def format_output_directory_path(bucket: str, prefix: str) -> str:
    safe_prefix = normalize_prefix(prefix)
    if not safe_prefix:
        return f"/{bucket}"
    return f"/{bucket}/{safe_prefix}"


def build_dated_prefix(base_prefix: str | None, *, now_fn: Callable[[], datetime] = utc_now) -> str:
    date_fragment = now_fn().strftime("%Y/%m/%d")
    safe_prefix = normalize_prefix(base_prefix)
    if not safe_prefix:
        return date_fragment
    return f"{safe_prefix}/{date_fragment}"


def build_local_directory_path(
    bucket: str,
    base_prefix: str | None,
    *,
    now_fn: Callable[[], datetime] = utc_now,
) -> str:
    return format_output_directory_path(bucket, build_dated_prefix(base_prefix, now_fn=now_fn))


def build_listing_output_prefix(
    base_prefix: str | None,
    *,
    now_fn: Callable[[], datetime] = utc_now,
) -> str:
    safe_prefix = normalize_prefix(base_prefix)
    listing_root = f"{safe_prefix}/transfer-listings" if safe_prefix else "transfer-listings"
    return build_dated_prefix(listing_root, now_fn=now_fn)


def start_directory_listing(
    transfer_client,
    *,
    connector_id: str,
    remote_directory_path: str,
    output_directory_path: str,
    max_items: int | None = None,
):
    params = {
        "ConnectorId": connector_id,
        "RemoteDirectoryPath": remote_directory_path,
        "OutputDirectoryPath": output_directory_path,
    }
    if max_items:
        params["MaxItems"] = max_items
    return transfer_client.start_directory_listing(**params)


def wait_for_listing(
    transfer_client,
    *,
    connector_id: str,
    listing_id: str,
    poll_seconds: int = 5,
    timeout_seconds: int = 300,
    sleep_func: Callable[[float], None] = time.sleep,
    time_func: Callable[[], float] = time.time,
):
    deadline = time_func() + timeout_seconds
    while time_func() < deadline:
        response = transfer_client.describe_directory_listing(
            ConnectorId=connector_id,
            ListingId=listing_id,
        )
        status = response.get("Status", "")
        if status in {"COMPLETED", "SUCCESS", "SUCCEEDED", "SUCCESSFUL"}:
            return response
        if status in {"FAILED", "ERROR"}:
            reason = response.get("FailureReason", "Unknown")
            raise RuntimeError(f"Directory listing failed: {reason}")
        sleep_func(poll_seconds)
    raise TimeoutError("Timed out waiting for directory listing to complete")


def fetch_listing_json(
    s3_client,
    *,
    bucket: str,
    key: str,
    poll_seconds: int = 3,
    timeout_seconds: int = 120,
    sleep_func: Callable[[float], None] = time.sleep,
    time_func: Callable[[], float] = time.time,
):
    deadline = time_func() + timeout_seconds
    while time_func() < deadline:
        try:
            response = s3_client.get_object(Bucket=bucket, Key=key)
            body = response["Body"].read()
            if isinstance(body, bytes):
                body = body.decode("utf-8")
            return json.loads(body)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code not in {"NoSuchKey", "404"}:
                raise
        sleep_func(poll_seconds)
    raise TimeoutError(f"Timed out waiting for listing file s3://{bucket}/{key}")


def extract_file_paths(listing_json: dict[str, Any]) -> list[str]:
    file_paths: list[str] = []
    seen: set[str] = set()
    for entry in listing_json.get("files", []):
        path = (entry.get("filePath") or entry.get("path") or "").strip()
        if not path or path in seen:
            continue
        seen.add(path)
        file_paths.append(path)
    return file_paths


def error_code(exc: Exception) -> str:
    if isinstance(exc, ClientError):
        return exc.response.get("Error", {}).get("Code", "ClientError")
    return exc.__class__.__name__


def start_file_transfer_with_retry(
    transfer_client,
    *,
    connector_id: str,
    file_path: str,
    local_directory_path: str,
    max_attempts: int = 5,
    sleep_func: Callable[[float], None] = time.sleep,
):
    for attempt in range(1, max_attempts + 1):
        try:
            response = transfer_client.start_file_transfer(
                ConnectorId=connector_id,
                RetrieveFilePaths=[file_path],
                LocalDirectoryPath=local_directory_path,
            )
            transfer_id = response.get("TransferId")
            if not transfer_id:
                raise RuntimeError(f"Missing TransferId for {file_path}")
            return transfer_id
        except ClientError as exc:
            if error_code(exc) not in RETRYABLE_ERROR_CODES or attempt == max_attempts:
                raise
            sleep_func(min(2 ** (attempt - 1), 10))


def start_transfers_in_parallel(
    file_paths: list[str],
    *,
    connector_id: str,
    local_directory_path: str,
    max_parallel_transfers: int,
    transfer_client,
    start_transfer_func: Callable[[str], str] | None = None,
):
    started: list[dict[str, str]] = []
    errors: list[dict[str, str]] = []
    if not file_paths:
        return {"started": started, "errors": errors}

    def _start(file_path: str) -> str:
        if start_transfer_func is not None:
            return start_transfer_func(file_path)
        return start_file_transfer_with_retry(
            transfer_client,
            connector_id=connector_id,
            file_path=file_path,
            local_directory_path=local_directory_path,
        )

    with ThreadPoolExecutor(max_workers=max(1, max_parallel_transfers)) as executor:
        future_to_path = {executor.submit(_start, file_path): file_path for file_path in file_paths}
        for future in as_completed(future_to_path):
            file_path = future_to_path[future]
            try:
                transfer_id = future.result()
                started.append({"filePath": file_path, "transferId": transfer_id})
            except Exception as exc:  # pragma: no cover - exercised via tests
                errors.append(
                    {
                        "filePath": file_path,
                        "errorCode": error_code(exc),
                        "message": str(exc),
                    }
                )
    return {"started": started, "errors": errors}


def coerce_int(value: Any, *, default: int) -> int:
    if value in (None, ""):
        return default
    return int(value)


def resolve_config(event: dict[str, Any]) -> dict[str, Any]:
    connector_id = event.get("connectorId") or os.environ.get("CONNECTOR_ID")
    target_bucket = event.get("targetBucket") or os.environ.get("TARGET_BUCKET")
    remote_directory_path = (
        event.get("remoteDirectoryPath") or os.environ.get("REMOTE_DIRECTORY_PATH") or "/Inbox"
    )
    local_directory_base_prefix = (
        event.get("localDirectoryBasePrefix")
        or os.environ.get("LOCAL_DIRECTORY_BASE_PREFIX")
        or "4287243"
    )
    max_parallel_transfers = coerce_int(
        event.get("maxParallelTransfers") or os.environ.get("MAX_PARALLEL_TRANSFERS"),
        default=20,
    )
    listing_max_items = coerce_int(event.get("listingMaxItems"), default=1000)
    listing_poll_seconds = coerce_int(event.get("listingPollSeconds"), default=5)
    listing_timeout_seconds = coerce_int(event.get("listingTimeoutSeconds"), default=300)

    if not connector_id:
        raise ValueError("CONNECTOR_ID is required")
    if not target_bucket:
        raise ValueError("TARGET_BUCKET is required")

    return {
        "connectorId": connector_id,
        "targetBucket": target_bucket,
        "remoteDirectoryPath": remote_directory_path,
        "localDirectoryBasePrefix": local_directory_base_prefix,
        "maxParallelTransfers": max_parallel_transfers,
        "listingMaxItems": listing_max_items,
        "listingPollSeconds": listing_poll_seconds,
        "listingTimeoutSeconds": listing_timeout_seconds,
    }


def lambda_handler(
    event,
    _context,
    *,
    transfer_client=None,
    s3_client=None,
    now_fn: Callable[[], datetime] = utc_now,
):
    try:
        event = event or {}
        config = resolve_config(event)
        transfer_client = transfer_client or build_transfer_client()
        s3_client = s3_client or build_s3_client()

        local_directory_path = build_local_directory_path(
            config["targetBucket"],
            config["localDirectoryBasePrefix"],
            now_fn=now_fn,
        )
        listing_output_prefix = build_listing_output_prefix(
            config["localDirectoryBasePrefix"],
            now_fn=now_fn,
        )
        listing_output_directory_path = format_output_directory_path(
            config["targetBucket"], listing_output_prefix
        )

        json_log(
            "starting inbound sftp poll",
            connectorId=config["connectorId"],
            targetBucket=config["targetBucket"],
            remoteDirectoryPath=config["remoteDirectoryPath"],
            localDirectoryPath=local_directory_path,
            maxParallelTransfers=config["maxParallelTransfers"],
        )

        listing_response = start_directory_listing(
            transfer_client,
            connector_id=config["connectorId"],
            remote_directory_path=config["remoteDirectoryPath"],
            output_directory_path=listing_output_directory_path,
            max_items=config["listingMaxItems"],
        )
        listing_id = listing_response.get("ListingId")
        output_file_name = listing_response.get("OutputFileName")
        if not listing_id or not output_file_name:
            raise RuntimeError("Directory listing response is missing ListingId or OutputFileName")

        wait_for_listing(
            transfer_client,
            connector_id=config["connectorId"],
            listing_id=listing_id,
            poll_seconds=config["listingPollSeconds"],
            timeout_seconds=config["listingTimeoutSeconds"],
        )

        listing_key = f"{listing_output_prefix}/{output_file_name}"
        listing_json = fetch_listing_json(
            s3_client,
            bucket=config["targetBucket"],
            key=listing_key,
            poll_seconds=max(1, config["listingPollSeconds"] // 2),
            timeout_seconds=min(600, config["listingTimeoutSeconds"]),
        )
        file_paths = extract_file_paths(listing_json)
        if not file_paths:
            json_log(
                "no inbound sftp files found",
                connectorId=config["connectorId"],
                remoteDirectoryPath=config["remoteDirectoryPath"],
                listingKey=listing_key,
            )
            return {
                "statusCode": 200,
                "fileCount": 0,
                "startedTransfers": 0,
                "failedTransfers": 0,
                "transferIds": [],
                "remoteDirectoryPath": config["remoteDirectoryPath"],
                "localDirectoryPath": local_directory_path,
                "listingKey": listing_key,
                "errors": [],
            }

        transfer_results = start_transfers_in_parallel(
            file_paths,
            connector_id=config["connectorId"],
            local_directory_path=local_directory_path,
            max_parallel_transfers=config["maxParallelTransfers"],
            transfer_client=transfer_client,
        )
        started = transfer_results["started"]
        errors = transfer_results["errors"]
        response = {
            "statusCode": 200,
            "fileCount": len(file_paths),
            "startedTransfers": len(started),
            "failedTransfers": len(errors),
            "transferIds": [entry["transferId"] for entry in started],
            "remoteDirectoryPath": config["remoteDirectoryPath"],
            "localDirectoryPath": local_directory_path,
            "listingKey": listing_key,
            "errors": errors[:MAX_RETURNED_ERRORS],
        }
        json_log("completed inbound sftp poll", **response)
        return response
    except Exception as exc:  # pragma: no cover - exercised via tests
        json_log("inbound sftp poll failed", errorCode=error_code(exc), error=str(exc))
        return {"statusCode": 500, "error": str(exc), "errorCode": error_code(exc)}
