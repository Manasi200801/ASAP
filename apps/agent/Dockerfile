# AgentCore Runtime image for the orchestrator.
#
# Two requirements come from AgentCore rather than from us: the container must
# listen on 8080 and serve POST /invocations and GET /ping, and the image must be
# linux/arm64. Everything else is an ordinary FastAPI service.
FROM --platform=linux/arm64 python:3.12-slim

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# No --reload: the reloader spawns a child process, and a signal sent to the
# container would stop the parent while the child kept serving.
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
