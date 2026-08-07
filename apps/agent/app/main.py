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

from . import events as ev  # noqa: E402
from .judge import build_judge  # noqa: E402
from .orchestrator import RunStore, answer_run, post_run, validate_run  # noqa: E402
from .sap import build_sap  # noqa: E402
from .storage import build_mover  # noqa: E402

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
mover = build_mover()

log.info(
    "backends: sap=%s judge=%s mover=%s",
    type(sap).__name__,
    type(judge).__name__,
    type(mover).__name__,
)


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


class ApproveRequest(BaseModel):
    """One press, carrying every per-invoice decision the clerk made.

    `overrideIds` are blocked invoices the clerk approved anyway; `rejectIds`
    are ones they turned down. Marking a row in the table decides nothing on its
    own - it is this single request that acts, which is what keeps the brief's
    "single human approval step" literally true.
    """

    runId: str
    overrideIds: list[str] = []
    rejectIds: list[str] = []


@app.post("/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    """Read-only, two modes. Nothing reaches SAP from here in either.

    A message about a batch that has already been checked is a question, and is
    answered from the stored run. Anything else starts a run.

    The distinction is the whole of the fix: previously every message re-ran the
    validation, so asking "why was invoice 6 blocked?" re-checked all six against
    SAP and answered nothing.
    """
    existing = store.get(request.runId)
    if request.message and existing is not None and existing.invoices:
        log.info("chat %s answering: %r", request.runId, request.message[:80])
        return stream(answer_run(existing, request.message))

    log.info(
        "chat %s starting run: %d files, locale=%s, sap=%s, judge=%s",
        request.runId,
        len(request.keys),
        request.locale,
        type(sap).__name__,
        type(judge).__name__,
    )
    run = store.create(request.runId, ACCOUNT, request.locale)
    return stream(validate_run(run, request.keys, sap, judge))


@app.post("/approve")
async def approve(request: ApproveRequest) -> StreamingResponse:
    """The only endpoint that writes.

    A separate request rather than a chat message, so the single approval gate is
    structural: the state machine rejects anything not awaiting approval.
    """
    log.info(
        "approve %s requested: %d overrides, %d rejects",
        request.runId,
        len(request.overrideIds),
        len(request.rejectIds),
    )
    run = store.get(request.runId)
    if run is None:
        log.warning("approve %s rejected: no such run", request.runId)

        async def missing() -> AsyncIterator[ev.Event]:
            yield ev.Error(message="No such run.", recoverable=False)

        return stream(missing())

    return stream(post_run(run, sap, mover, request.overrideIds, request.rejectIds))


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "sap": type(sap).__name__,
        "judge": type(judge).__name__,
        "mover": type(mover).__name__,
    }
