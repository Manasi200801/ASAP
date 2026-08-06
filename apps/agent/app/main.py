"""HTTP surface. Two endpoints, both streaming, exactly as `contract/events.md` says."""

from __future__ import annotations

import json
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

from . import events as ev  # noqa: E402
from .judge import build_judge  # noqa: E402
from .orchestrator import RunStore, post_run, validate_run  # noqa: E402
from .sap import build_sap  # noqa: E402

ACCOUNT = os.getenv("AWS_ACCOUNT_ID", "516359819848")

app = FastAPI(title="STRIKE AP orchestrator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["POST"],
    allow_headers=["*"],
)

store = RunStore()
sap = build_sap()
judge = build_judge()


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
    runId: str


@app.post("/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    """Read-only: extract and validate. Nothing reaches SAP from here."""
    run = store.create(request.runId, ACCOUNT, request.locale)
    return stream(validate_run(run, request.keys, sap, judge))


@app.post("/approve")
async def approve(request: ApproveRequest) -> StreamingResponse:
    """The only endpoint that writes.

    A separate request rather than a chat message, so the single approval gate is
    structural: the state machine rejects anything not awaiting approval.
    """
    run = store.get(request.runId)
    if run is None:

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
