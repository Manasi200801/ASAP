"""Build a Bedrock knowledge base: S3 vector store -> KB -> data source -> ingest.

Two are used by this project, both created with this script:

    python scripts/make_kb.py sops     # AP standard operating procedures -> rule 9
    python scripts/make_kb.py sap-api  # SAP OData specs, Lab 02 Task 02

Needs boto3 >= 1.40 for the s3vectors client. The AWS CLI shipped with the
workshop image is too old to do this, which is why it is a script and not a
handful of `aws` commands.
"""

import sys
import time

import boto3
import botocore

REGION = "us-east-1"
ACCOUNT = "516359819848"

# Both names are constrained by AmazonBedrockExecutionRoleForKnowledgeBase_my:
# the vector bucket must match `bedrock-knowledge-base-*` and the index must be
# named exactly this. Deviate and the KB builds but retrieval is denied.
INDEX = "bedrock-knowledge-base-default-index"
ROLE = f"arn:aws:iam::{ACCOUNT}:role/AmazonBedrockExecutionRoleForKnowledgeBase_my"
EMBED = f"arn:aws:bedrock:{REGION}::foundation-model/amazon.titan-embed-text-v2:0"

KBS = {
    "sops": {
        "name": "strike-ap-sops",
        "description": "Accounts Payable standard operating procedures.",
        "bucket": f"{ACCOUNT}-sops",
    },
    "sap-api": {
        "name": "knowledge-base-sap-api",
        "description": "Knowledge base to use as data source for APIs",
        "bucket": f"{ACCOUNT}-sap-api",
    },
}

s3v = boto3.client("s3vectors", region_name=REGION)
agent = boto3.client("bedrock-agent", region_name=REGION)


def create(label, fn, **kw):
    try:
        fn(**kw)
        print(f"  {label}: created")
    except botocore.exceptions.ClientError as e:
        if e.response["Error"]["Code"] not in (
            "ConflictException",
            "ResourceAlreadyExistsException",
        ):
            raise
        print(f"  {label}: already exists")


def main(which: str) -> None:
    spec = KBS[which]
    vec_bucket = f"bedrock-knowledge-base-{which}"

    print("1. vector bucket + index")
    create("bucket", s3v.create_vector_bucket, vectorBucketName=vec_bucket)
    create(
        "index",
        s3v.create_index,
        vectorBucketName=vec_bucket,
        indexName=INDEX,
        dataType="float32",
        dimension=1024,  # titan-embed-text-v2 default
        distanceMetric="cosine",
        metadataConfiguration={
            "nonFilterableMetadataKeys": ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"]
        },
    )
    index_arn = s3v.get_index(vectorBucketName=vec_bucket, indexName=INDEX)["index"]["indexArn"]

    print("2. knowledge base")
    found = [
        k for k in agent.list_knowledge_bases()["knowledgeBaseSummaries"] if k["name"] == spec["name"]
    ]
    if found:
        kb_id = found[0]["knowledgeBaseId"]
        print(f"  already exists: {kb_id}")
    else:
        kb = agent.create_knowledge_base(
            name=spec["name"],
            description=spec["description"],
            roleArn=ROLE,
            knowledgeBaseConfiguration={
                "type": "VECTOR",
                "vectorKnowledgeBaseConfiguration": {"embeddingModelArn": EMBED},
            },
            storageConfiguration={
                "type": "S3_VECTORS",
                "s3VectorsConfiguration": {"indexArn": index_arn},
            },
        )
        kb_id = kb["knowledgeBase"]["knowledgeBaseId"]
        print(f"  created: {kb_id}")

    for _ in range(30):
        if agent.get_knowledge_base(knowledgeBaseId=kb_id)["knowledgeBase"]["status"] == "ACTIVE":
            break
        time.sleep(2)

    print("3. data source")
    sources = agent.list_data_sources(knowledgeBaseId=kb_id)["dataSourceSummaries"]
    if sources:
        ds_id = sources[0]["dataSourceId"]
        print(f"  already exists: {ds_id}")
    else:
        ds = agent.create_data_source(
            knowledgeBaseId=kb_id,
            name=f"{which}-bucket",
            dataSourceConfiguration={
                "type": "S3",
                "s3Configuration": {"bucketArn": f"arn:aws:s3:::{spec['bucket']}"},
            },
        )
        ds_id = ds["dataSource"]["dataSourceId"]
        print(f"  created: {ds_id}")

    print("4. ingest")
    job_id = agent.start_ingestion_job(knowledgeBaseId=kb_id, dataSourceId=ds_id)["ingestionJob"][
        "ingestionJobId"
    ]
    for _ in range(120):
        job = agent.get_ingestion_job(
            knowledgeBaseId=kb_id, dataSourceId=ds_id, ingestionJobId=job_id
        )["ingestionJob"]
        if job["status"] in ("COMPLETE", "FAILED"):
            break
        time.sleep(3)

    stats = job.get("statistics", {})
    print(f"  {job['status']}")
    # Skipped documents are the trap: the job reports COMPLETE either way, so an
    # unsupported file type produces an empty knowledge base that looks healthy.
    for key in (
        "numberOfDocumentsScanned",
        "numberOfNewDocumentsIndexed",
        "numberOfDocumentsFailed",
        "numberOfDocumentsSkipped",
    ):
        print(f"    {key}: {stats.get(key, 0)}")

    print(f"\nknowledge base id: {kb_id}")


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "sops"
    if target not in KBS:
        sys.exit(f"unknown knowledge base '{target}'. one of: {', '.join(KBS)}")
    main(target)
