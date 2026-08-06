"""AgentCore Runtime entrypoint.

Direct code deployment runs `python main.py` at the root of the unpacked zip, so
this exists only to start the server the rest of the app already defines. It is
not used locally - `uvicorn app.main:app` is.

AgentCore requires port 8080, POST /invocations and GET /ping. All three live in
app/main.py, which is otherwise unaware it is running on AgentCore at all.
"""

import os

import uvicorn

from app.main import app

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",  # noqa: S104 - the container boundary is the network boundary
        port=int(os.getenv("PORT", "8080")),
        # Our own logging config is set up in app.main; letting uvicorn install
        # its dictConfig here would replace it and drop every app.* logger.
        log_config=None,
    )
