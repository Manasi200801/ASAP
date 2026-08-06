"""Shared Bedrock plumbing for the two model-backed layers.

One place that knows how to call Converse and get JSON back, so `extract.py` and
`judge.py` only have to care about their prompts.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import AsyncIterator

log = logging.getLogger("app.bedrock")

# Sonnet 5 and Opus 5 appear in list-inference-profiles but are not enabled on the
# workshop account - Converse returns AccessDenied. 4.6 is the newest that works,
# and is already ahead of the 4.5 the workshop pins.
DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6"

# A malformed answer must never become a silent pass. One retry, then raise, and
# the orchestrator turns that into a blocked invoice with an honest message.
RETRIES = 1


class JudgementError(RuntimeError):
    """The model did not answer in a usable shape."""


def model_id() -> str:
    return os.getenv("BEDROCK_MODEL_ID", DEFAULT_MODEL)


def _client():
    import boto3

    return boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION", "us-east-1"))


def _text(response: dict) -> str:
    blocks = response.get("output", {}).get("message", {}).get("content", [])
    return "".join(b.get("text", "") for b in blocks)


def _as_json(raw: str) -> dict:
    """Parse the model's answer, tolerating a fenced block or surrounding prose."""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.S)
    candidate = fenced.group(1) if fenced else raw

    if not fenced:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start == -1 or end <= start:
            raise JudgementError("The model did not return JSON.")
        candidate = candidate[start : end + 1]

    try:
        return json.loads(candidate)
    except json.JSONDecodeError as error:
        raise JudgementError(f"The model returned malformed JSON: {error}") from error


async def stream_text(system: str, prompt: str) -> AsyncIterator[str]:
    """Converse with streaming, as text deltas.

    Everything else here answers in JSON, which has to arrive whole. An answer to
    a typed question is prose a person reads as it lands, and a five-second pause
    before a paragraph appears at once reads as a hang.

    boto3's event stream is a blocking iterator, so it is pumped on a worker
    thread into an asyncio queue. Errors cross the boundary as a value and are
    re-raised here, so a failure surfaces as a normal exception rather than a
    stream that silently stops.
    """
    import asyncio
    import threading

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | Exception | None] = asyncio.Queue()

    def pump() -> None:
        try:
            response = _client().converse_stream(
                modelId=model_id(),
                system=[{"text": system}],
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={"maxTokens": 1200, "temperature": 0},
            )
            for event in response["stream"]:
                delta = event.get("contentBlockDelta", {}).get("delta", {}).get("text")
                if delta:
                    loop.call_soon_threadsafe(queue.put_nowait, delta)
        except Exception as error:  # noqa: BLE001 - re-raised on the consumer side
            loop.call_soon_threadsafe(queue.put_nowait, error)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=pump, daemon=True).start()

    while (item := await queue.get()) is not None:
        if isinstance(item, Exception):
            raise item
        yield item


def ask_json(system: str, prompt: str, document: bytes | None = None, name: str = "invoice") -> dict:
    """One Converse call that must come back as a JSON object."""
    client = _client()

    content: list[dict] = []
    if document is not None:
        content.append(
            {
                "document": {
                    # Converse rejects most punctuation in document names.
                    "name": re.sub(r"[^A-Za-z0-9 ]+", " ", name)[:60] or "invoice",
                    "format": "pdf",
                    "source": {"bytes": document},
                }
            }
        )
    content.append({"text": prompt})

    last: Exception | None = None
    for attempt in range(RETRIES + 1):
        started = time.perf_counter()
        response = client.converse(
            modelId=model_id(),
            system=[{"text": system}],
            messages=[{"role": "user", "content": content}],
            inferenceConfig={"maxTokens": 2000, "temperature": 0},
        )
        usage = response.get("usage", {})
        log.info(
            "converse %s -> %.0fms, %d in / %d out tokens%s",
            model_id(),
            (time.perf_counter() - started) * 1000,
            usage.get("inputTokens", 0),
            usage.get("outputTokens", 0),
            f" (retry {attempt})" if attempt else "",
        )
        try:
            return _as_json(_text(response))
        except JudgementError as error:
            last = error
            # Worth a warning: a retry doubles the latency of whatever rule is
            # waiting on it, and a pattern of them means the prompt has drifted.
            log.warning("model did not return usable JSON: %s", error)
            if attempt == RETRIES:
                break

    raise JudgementError(str(last))
