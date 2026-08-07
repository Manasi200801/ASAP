import {
  BedrockAgentClient,
  GetIngestionJobCommand,
  ListDataSourcesCommand,
  StartIngestionJobCommand,
} from "@aws-sdk/client-bedrock-agent";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { SopFile } from "./sop-types";

const BUCKET = process.env.SOP_BUCKET ?? "516359819848-sops";
const REGION = process.env.AWS_REGION ?? "us-east-1";

const s3 = new S3Client({ region: REGION });
const bedrockAgent = new BedrockAgentClient({ region: REGION });

// Read lazily rather than at module scope, so tests can set the env var after
// the module has already been imported.
function knowledgeBaseId(): string {
  const id = process.env.SOP_KNOWLEDGE_BASE_ID;
  if (!id) throw new Error("SOP_KNOWLEDGE_BASE_ID is not set.");
  return id;
}

export async function listSops(): Promise<SopFile[]> {
  const result = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
  return (result.Contents ?? [])
    .filter((object): object is typeof object & { Key: string } => Boolean(object.Key))
    .map((object) => ({
      key: object.Key,
      size: object.Size ?? 0,
      lastModified: (object.LastModified ?? new Date(0)).toISOString(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function getSop(key: string): Promise<string> {
  const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return (await result.Body?.transformToString()) ?? "";
}

export async function putSop(key: string, content: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: content, ContentType: "text/markdown" }),
  );
}

export type SyncHandle = { jobId: string; dataSourceId: string };

export async function startSync(): Promise<SyncHandle> {
  const knowledgeBase = knowledgeBaseId();
  const sources = await bedrockAgent.send(
    new ListDataSourcesCommand({ knowledgeBaseId: knowledgeBase }),
  );
  const dataSourceId = sources.dataSourceSummaries?.[0]?.dataSourceId;
  if (!dataSourceId) throw new Error("No data source configured for the SOP knowledge base.");
  const job = await bedrockAgent.send(
    new StartIngestionJobCommand({ knowledgeBaseId: knowledgeBase, dataSourceId }),
  );
  const jobId = job.ingestionJob?.ingestionJobId;
  if (!jobId) throw new Error("Bedrock did not return an ingestion job id.");
  return { jobId, dataSourceId };
}

export type SyncStatistics = {
  documentsScanned: number;
  documentsIndexed: number;
  documentsFailed: number;
  documentsSkipped: number;
};

export type SyncStatus = { status: string; statistics: SyncStatistics };

export async function getSyncStatus(jobId: string, dataSourceId: string): Promise<SyncStatus> {
  const knowledgeBase = knowledgeBaseId();
  const job = await bedrockAgent.send(
    new GetIngestionJobCommand({
      knowledgeBaseId: knowledgeBase,
      dataSourceId,
      ingestionJobId: jobId,
    }),
  );
  const ingestionJob = job.ingestionJob;
  const statistics = ingestionJob?.statistics;
  return {
    status: ingestionJob?.status ?? "UNKNOWN",
    statistics: {
      documentsScanned: statistics?.numberOfDocumentsScanned ?? 0,
      documentsIndexed: statistics?.numberOfNewDocumentsIndexed ?? 0,
      documentsFailed: statistics?.numberOfDocumentsFailed ?? 0,
      documentsSkipped: statistics?.numberOfDocumentsSkipped ?? 0,
    },
  };
}

export function awsErrorMessage(error: unknown): { message: string; status: number } {
  const name = error instanceof Error ? error.name : "";
  if (name.toLowerCase().includes("expiredtoken")) {
    return {
      message: "AWS credentials expired — re-copy the workshop profile from Workshop Studio.",
      status: 502,
    };
  }
  return {
    message: error instanceof Error ? error.message : "Unknown AWS error.",
    status: 502,
  };
}
