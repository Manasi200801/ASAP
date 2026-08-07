"""Filing invoice PDFs once a human has decided about them.

An invoice arrives in the upload bucket and leaves for one of two archives:
parked in SAP, or rejected by a person. Anything nobody has settled stays where
it is, which is what makes the upload bucket answer "what still needs
attention?" by being looked at.

S3 has no move. Copy, confirm, then delete - in that order, so a failure leaves
a duplicate rather than a hole.

`FakeMover` keeps the orchestrator runnable without AWS. `S3Mover` is the real
one; both return the same shapes.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Protocol

log = logging.getLogger("app.storage")


class MoveError(RuntimeError):
    """The PDF could not be filed. Never fatal - the posting already happened."""


@dataclass(frozen=True)
class Filed:
    bucket: str
    key: str
    deleted: bool


def split_uri(uri: str) -> tuple[str, str]:
    """`s3://bucket/key` -> (bucket, key)."""
    bucket, _, key = uri[5:].partition("/")
    return bucket, key


class Mover(Protocol):
    async def file_to(self, source: str, bucket: str) -> Filed | None: ...


class FakeMover:
    """Records what would have moved. No network, no credentials."""

    def __init__(self) -> None:
        self.moves: list[tuple[str, str, bool]] = []

    async def file_to(self, source: str, bucket: str) -> Filed | None:
        if not source:
            return None
        origin, key = split_uri(source)
        deleted = origin == upload_bucket()
        self.moves.append((source, bucket, deleted))
        return Filed(bucket=bucket, key=key, deleted=deleted)


class S3Mover:
    """Copy into the archive, then delete the original - if we are allowed to.

    The delete is guarded by bucket, not by intent. `Load batch` reads the six
    workshop PDFs straight out of INVOICE_BUCKET, and those are shared account
    state: deleting one destroys the demo fallback for everybody, permanently,
    on the first successful run. So the rule is positional rather than a
    judgement call - nothing outside the upload bucket is ever deleted, and the
    copy still happens so the archive is complete either way.
    """

    def __init__(self, region: str = "us-east-1") -> None:
        self.region = region

    def _client(self):
        import boto3

        return boto3.client("s3", region_name=self.region)

    async def file_to(self, source: str, bucket: str) -> Filed | None:
        if not source:
            # Sample mode, or an invoice that never came from S3. Nothing to file,
            # and inventing a key from the filename deletes the wrong object.
            return None

        import asyncio

        return await asyncio.to_thread(self._move, source, bucket)

    def _move(self, source: str, bucket: str) -> Filed:
        origin, key = split_uri(source)
        client = self._client()

        try:
            client.copy_object(Bucket=bucket, Key=key, CopySource=f"{origin}/{key}")
        except Exception as error:  # noqa: BLE001 - surfaced, never fatal
            raise MoveError(f"could not copy {source} to {bucket}: {error}") from error

        if origin != upload_bucket():
            log.info("filed %s to %s, original kept (not the upload bucket)", source, bucket)
            return Filed(bucket=bucket, key=key, deleted=False)

        try:
            client.delete_object(Bucket=origin, Key=key)
        except Exception as error:  # noqa: BLE001 - the copy already succeeded
            # A duplicate is recoverable; losing the copy is not. Report the
            # filing as successful-but-undeleted rather than failing it.
            log.warning("filed %s to %s but could not delete the original: %s", source, bucket, error)
            return Filed(bucket=bucket, key=key, deleted=False)

        log.info("filed %s to %s", source, bucket)
        return Filed(bucket=bucket, key=key, deleted=True)


def upload_bucket() -> str:
    return os.getenv("UPLOAD_BUCKET", "516359819848-uploaded-invoice")


def processed_bucket() -> str:
    return os.getenv("PROCESSED_BUCKET", "516359819848-processed-invoice")


def blocked_bucket() -> str:
    return os.getenv("BLOCKED_BUCKET", "516359819848-blocked-invoice")


def build_mover() -> Mover:
    if os.getenv("STORAGE_BACKEND", "fake") == "s3":
        return S3Mover(region=os.getenv("AWS_REGION", "us-east-1"))
    return FakeMover()
