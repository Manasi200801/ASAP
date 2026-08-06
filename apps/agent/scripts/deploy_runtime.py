"""Deploy the orchestrator to Bedrock AgentCore Runtime by direct code deployment.

    python scripts/deploy_runtime.py

Why this shape rather than a container: this AWS account denies the participant
role ecr:*, codebuild:* and ecs:*, so there is no way to build and push an image.
Direct code deployment needs none of them - it takes a zip of arm64 wheels plus
our source, in S3, and AgentCore runs `python main.py` against it.

The agent qualifies because app/main.py already serves POST /invocations and GET
/ping on 8080, which is the whole of the AgentCore service contract.

Not a GitHub Actions workflow on purpose: it needs AWS credentials, and the only
ones available are workshop credentials that expire with the event. A workflow
holding them would be broken by tomorrow.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import sys
import time
import zipfile

import boto3
import botocore

REGION = "us-east-1"
ACCOUNT = "516359819848"
NAME = "strike_ap_orchestrator"
BUCKET = f"bedrock-agentcore-code-{ACCOUNT}-{REGION}"
KEY = f"{NAME}/deployment_package.zip"
ROLE = f"arn:aws:iam::{ACCOUNT}:role/AmazonBedrockAgentCoreSDKRuntime-my"

# The runtime must accept the same Cognito tokens the MCP server does, so the
# browser-facing proxy needs one identity rather than two.
AUTHORIZER = {
    "customJWTAuthorizer": {
        "discoveryUrl": (
            f"https://cognito-idp.{REGION}.amazonaws.com/"
            "us-east-1_SoZI3LHP1/.well-known/openid-configuration"
        ),
        "allowedClients": ["16sckeouo8694o8eljsk7aeir3"],
    }
}

# Passed through to the runtime. Anything absent locally is simply not sent, so
# the runtime falls back to the same defaults the code already has.
FORWARDED = [
    "SAP_BACKEND",
    "EXTRACT_BACKEND",
    "JUDGE_BACKEND",
    "SAP_BASE_URL",
    "AGENT_RUNTIME_ARN",
    "BEDROCK_MODEL_ID",
    "INVOICE_BUCKET",
    "SOP_KNOWLEDGE_BASE_ID",
    "AWS_ACCOUNT_ID",
    "ALLOWED_ORIGINS",
    "LOG_LEVEL",
]

ROOT = pathlib.Path(__file__).resolve().parents[1]
BUILD = ROOT / "build" / "deployment_package"
ARCHIVE = ROOT / "build" / "deployment_package.zip"

# Only what the agent imports. requirements.txt is for developers and carries
# extras; every megabyte here is unpacked into the runtime on cold start.
RUNTIME_DEPS = [
    "fastapi>=0.115.0",
    "uvicorn>=0.32.0",
    "pydantic>=2.9.0",
    "boto3>=1.35.0",
    "requests>=2.32.0",
    "python-dotenv>=1.0.0",
]


def build() -> None:
    """Install arm64 wheels and lay the source beside them."""
    if BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir(parents=True)

    print("1. installing arm64 dependencies")
    subprocess.run(
        [
            sys.executable, "-m", "pip", "install", "--quiet",
            # AgentCore Runtime is arm64 only. Without these three flags pip
            # silently installs wheels for this machine, the zip uploads
            # cleanly, and the runtime fails at import time on a native module.
            "--platform", "manylinux2014_aarch64",
            "--only-binary=:all:",
            "--python-version", "3.12",
            "--target", str(BUILD),
            *RUNTIME_DEPS,
        ],
        check=True,
    )

    print("2. adding source")
    shutil.copy(ROOT / "main.py", BUILD / "main.py")
    shutil.copytree(
        ROOT / "app",
        BUILD / "app",
        # Bytecode compiled on this machine is the wrong architecture.
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )

    print("3. zipping")
    ARCHIVE.unlink(missing_ok=True)
    cached = 0
    with zipfile.ZipFile(ARCHIVE, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in BUILD.rglob("*"):
            if not path.is_file():
                continue
            # AgentCore rejects the whole artifact if it finds bytecode, with
            # "contains Python cache files that are incompatible with the target
            # runtime". pip leaves it behind even when installing wheels, so it
            # has to be stripped here rather than only from our own source.
            if path.suffix == ".pyc" or "__pycache__" in path.parts:
                cached += 1
                continue
            archive.write(path, path.relative_to(BUILD))
    if cached:
        print(f"   excluded {cached} bytecode files")

    size = ARCHIVE.stat().st_size / 1_000_000
    print(f"   {size:.1f} MB zipped (limit 250 MB)")
    if size > 250:
        sys.exit("deployment package is over the 250 MB limit")


def upload() -> None:
    print("4. uploading")
    boto3.client("s3", region_name=REGION).upload_file(
        str(ARCHIVE), BUCKET, KEY, ExtraArgs={"ExpectedBucketOwner": ACCOUNT}
    )
    print(f"   s3://{BUCKET}/{KEY}")


def deploy() -> str:
    client = boto3.client("bedrock-agentcore-control", region_name=REGION)

    environment = {name: os.environ[name] for name in FORWARDED if os.environ.get(name)}
    print(f"5. runtime env: {', '.join(sorted(environment)) or 'none'}")

    artifact = {
        "codeConfiguration": {
            "code": {"s3": {"bucket": BUCKET, "prefix": KEY}},
            "runtime": "PYTHON_3_12",
            "entryPoint": ["main.py"],
        }
    }
    shared = {
        "agentRuntimeArtifact": artifact,
        "networkConfiguration": {"networkMode": "PUBLIC"},
        "roleArn": ROLE,
        "authorizerConfiguration": AUTHORIZER,
        "environmentVariables": environment,
    }

    existing = next(
        (
            r
            for r in client.list_agent_runtimes()["agentRuntimes"]
            if r["agentRuntimeName"] == NAME
        ),
        None,
    )
    if existing:
        print("6. updating existing runtime")
        response = client.update_agent_runtime(
            agentRuntimeId=existing["agentRuntimeId"], **shared
        )
    else:
        print("6. creating runtime")
        response = client.create_agent_runtime(agentRuntimeName=NAME, **shared)

    arn = response["agentRuntimeArn"]
    runtime_id = arn.rsplit("/", 1)[-1]

    for _ in range(60):
        status = client.get_agent_runtime(agentRuntimeId=runtime_id)["status"]
        if status not in ("CREATING", "UPDATING"):
            break
        time.sleep(5)
    print(f"   {status}")
    return arn


if __name__ == "__main__":
    for name in (".env.local", ".env"):
        path = ROOT / name
        if path.exists():
            from dotenv import load_dotenv

            load_dotenv(path, override=False)

    build()
    upload()
    try:
        arn = deploy()
    except botocore.exceptions.ClientError as error:
        sys.exit(f"deploy failed: {error}")

    print(f"\nORCHESTRATOR_RUNTIME_ARN={arn}")
