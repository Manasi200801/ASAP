"""HTTP surface. Two endpoints, both streaming, exactly as `contract/events.md` says."""

from __future__ import annotations

import json
import logging
import os
import pathlib
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Load .env.local before anything reads os.getenv. Without this a teammate can
# write a perfectly correct .env.local and have it silently ignored, which looks
# exactly like a broken backend.
try:
    from dotenv import load_dotenv

    _root = pathlib.Path(__file__).resolve().parents[1]
    for _name in (".env.local", ".env"):
        load_dotenv(_root / _name, override=False)
except ImportError:  # pragma: no cover - dotenv is optional
    pass

# Configured here, once, before any module logger is used. uvicorn covers the
# HTTP line; everything interesting happens after it - which SAP entity was read,
# which model was asked, how long each took - and none of that was visible.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-5s %(name)-16s %(message)s",
    datefmt="%H:%M:%S",
)

def _repair_ca_bundle() -> None:
    """Drop CA bundle paths that point at nothing.

    Symptom on a teammate's machine:

        SSL validation failed for https://bedrock-runtime.us-east-1.amazonaws.com/...
        [Errno 2] No such file or directory

    That errno is the tell. It is not a certificate that failed to verify - it is
    a certificate file that does not exist. Anaconda, corporate proxy installers
    and old virtualenvs all export these variables pointing into a prefix that
    later moved, and every boto3 call then fails with an error that reads like a
    network or trust problem.

    botocore ships its own CA bundle and uses it when nothing overrides it, so
    removing a dead override is the fix rather than a workaround.
    """
    for name in ("AWS_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "SSL_CERT_FILE", "CURL_CA_BUNDLE"):
        configured = os.environ.get(name)
        if configured and not pathlib.Path(configured).is_file():
            del os.environ[name]
            logging.getLogger("app.http").warning(
                "%s pointed at %s, which does not exist. Ignoring it and using the "
                "certificates bundled with botocore.",
                name,
                configured,
            )


_repair_ca_bundle()

from . import db  # noqa: E402
from . import events as ev  # noqa: E402
from .judge import build_judge  # noqa: E402
from .orchestrator import RunStore, answer_run, post_run, validate_run  # noqa: E402
from .sap import build_sap  # noqa: E402

ACCOUNT = os.getenv("AWS_ACCOUNT_ID", "516359819848")

app = FastAPI(title="STRIKE AP orchestrator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["POST"],
    allow_headers=["*"],
)

log = logging.getLogger("app.http")

store = RunStore()
sap = build_sap()
judge = build_judge()

db.init()

log.info("backends: sap=%s judge=%s, db=%s", type(sap).__name__, type(judge).__name__, db.path())


async def sse(events: AsyncIterator[ev.Event]) -> AsyncIterator[bytes]:
    try:
        async for event in events:
            yield f"data: {json.dumps(event.wire())}\n\n".encode()
    except Exception as error:  # noqa: BLE001 - the stream must end with a readable message
        failure = ev.Error(message=str(error) or "The run failed.", recoverable=False)
        yield f"data: {json.dumps(failure.wire())}\n\n".encode()


def stream(events: AsyncIterator[ev.Event]) -> StreamingResponse:
    return StreamingResponse(
        sse(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


class ChatRequest(BaseModel):
    runId: str
    keys: list[str] = []
    locale: str = "en"
    message: str | None = None
    # Explicit request for the demo batch. Without it, "no files" means no files.
    sample: bool = False
    # The conversation, which outlives any one batch. A run is a batch of
    # invoices; a session is the person talking, and they keep talking after the
    # batch on screen has been replaced.
    sessionId: str = "default"


class ApproveRequest(BaseModel):
    runId: str


@app.post("/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    """Read-only, two modes. Nothing reaches SAP from here in either.

    A message about a batch that has already been checked is a question, and is
    answered from the stored run. Anything else starts a run.

    The distinction is the whole of the fix: previously every message re-ran the
    validation, so asking "why was invoice 6 blocked?" re-checked all six against
    SAP and answered nothing.
    """
    if request.message and not request.sample:
        # Always an answer, never a run. The agent's tools read the database, so
        # it can answer about a batch this process never held - and when there is
        # genuinely nothing there, it says so itself rather than falling through
        # and re-checking six invoices to answer a question about one.
        log.info("chat %s answering: %r", request.sessionId, request.message[:80])
        return stream(
            answer_run(
                request.message,
                request.locale,
                session_id=request.sessionId,
                run_id=request.runId if request.runId != "none" else None,
            )
        )

    log.info(
        "chat %s starting run: %d files, locale=%s, sap=%s, judge=%s",
        request.runId,
        len(request.keys),
        request.locale,
        type(sap).__name__,
        type(judge).__name__,
    )
    run = store.create(request.runId, ACCOUNT, request.locale)
    return stream(validate_run(run, request.keys, sap, judge, sample=request.sample))


@app.post("/approve")
async def approve(request: ApproveRequest) -> StreamingResponse:
    """The only endpoint that writes.

    A separate request rather than a chat message, so the single approval gate is
    structural: the state machine rejects anything not awaiting approval.
    """
    log.info("approve %s requested", request.runId)
    run = store.get(request.runId)
    if run is None:
        log.warning("approve %s rejected: no such run", request.runId)

        async def missing() -> AsyncIterator[ev.Event]:
            yield ev.Error(message="No such run.", recoverable=False)

        return stream(missing())

    return stream(post_run(run, sap))


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "sap": type(sap).__name__,
        "judge": type(judge).__name__,
    }
