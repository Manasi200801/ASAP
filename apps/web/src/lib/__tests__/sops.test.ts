import { beforeEach, describe, expect, it, vi } from "vitest";

const { s3Send, bedrockSend } = vi.hoisted(() => ({ s3Send: vi.fn(), bedrockSend: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: s3Send })),
  ListObjectsV2Command: vi.fn((input: unknown) => ({ input })),
  GetObjectCommand: vi.fn((input: unknown) => ({ input })),
  PutObjectCommand: vi.fn((input: unknown) => ({ input })),
}));

vi.mock("@aws-sdk/client-bedrock-agent", () => ({
  BedrockAgentClient: vi.fn().mockImplementation(() => ({ send: bedrockSend })),
  ListDataSourcesCommand: vi.fn((input: unknown) => ({ input })),
  StartIngestionJobCommand: vi.fn((input: unknown) => ({ input })),
  GetIngestionJobCommand: vi.fn((input: unknown) => ({ input })),
}));

import { awsErrorMessage, getSop, getSyncStatus, listSops, putSop, startSync } from "../sops";

beforeEach(() => {
  s3Send.mockReset();
  bedrockSend.mockReset();
});

describe("listSops", () => {
  it("maps and sorts S3 objects by key", async () => {
    s3Send.mockResolvedValue({
      Contents: [
        { Key: "b.md", Size: 20, LastModified: new Date("2026-08-06T00:00:00.000Z") },
        { Key: "a.md", Size: 10, LastModified: new Date("2026-08-05T00:00:00.000Z") },
      ],
    });
    const files = await listSops();
    expect(files).toEqual([
      { key: "a.md", size: 10, lastModified: "2026-08-05T00:00:00.000Z" },
      { key: "b.md", size: 20, lastModified: "2026-08-06T00:00:00.000Z" },
    ]);
  });

  it("returns an empty list when the bucket has no objects", async () => {
    s3Send.mockResolvedValue({});
    expect(await listSops()).toEqual([]);
  });
});

describe("getSop", () => {
  it("returns the object body as a string", async () => {
    s3Send.mockResolvedValue({ Body: { transformToString: async () => "# hello" } });
    expect(await getSop("a.md")).toBe("# hello");
  });
});

describe("putSop", () => {
  it("sends a PutObjectCommand with the key and content", async () => {
    s3Send.mockResolvedValue({});
    await putSop("a.md", "# content");
    expect(s3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ Key: "a.md", Body: "# content" }),
      }),
    );
  });
});

describe("startSync", () => {
  beforeEach(() => {
    process.env.SOP_KNOWLEDGE_BASE_ID = "kb-1";
  });

  it("resolves the data source then starts an ingestion job", async () => {
    bedrockSend
      .mockResolvedValueOnce({ dataSourceSummaries: [{ dataSourceId: "ds-1" }] })
      .mockResolvedValueOnce({ ingestionJob: { ingestionJobId: "job-1" } });
    const handle = await startSync();
    expect(handle).toEqual({ jobId: "job-1", dataSourceId: "ds-1" });
  });

  it("throws when the knowledge base has no data source", async () => {
    bedrockSend.mockResolvedValueOnce({ dataSourceSummaries: [] });
    await expect(startSync()).rejects.toThrow("No data source configured");
  });
});

describe("getSyncStatus", () => {
  beforeEach(() => {
    process.env.SOP_KNOWLEDGE_BASE_ID = "kb-1";
  });

  it("maps the ingestion job status and statistics", async () => {
    bedrockSend.mockResolvedValue({
      ingestionJob: {
        status: "COMPLETE",
        statistics: {
          numberOfDocumentsScanned: 3,
          numberOfNewDocumentsIndexed: 2,
          numberOfDocumentsFailed: 0,
          numberOfDocumentsSkipped: 1,
        },
      },
    });
    const status = await getSyncStatus("job-1", "ds-1");
    expect(status).toEqual({
      status: "COMPLETE",
      statistics: {
        documentsScanned: 3,
        documentsIndexed: 2,
        documentsFailed: 0,
        documentsSkipped: 1,
      },
    });
  });
});

describe("awsErrorMessage", () => {
  it("maps an expired token error to a friendly message", () => {
    const error = Object.assign(
      new Error("The security token included in the request is expired"),
      {
        name: "ExpiredTokenException",
      },
    );
    expect(awsErrorMessage(error)).toEqual({
      message: "AWS credentials expired — re-copy the workshop profile from Workshop Studio.",
      status: 502,
    });
  });

  it("passes through other error messages", () => {
    expect(awsErrorMessage(new Error("boom"))).toEqual({ message: "boom", status: 502 });
  });
});
