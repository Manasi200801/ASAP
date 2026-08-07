import { beforeEach, describe, expect, it, vi } from "vitest";

const { startSync, getSyncStatus } = vi.hoisted(() => ({
  startSync: vi.fn(),
  getSyncStatus: vi.fn(),
}));

vi.mock("@/lib/sops", () => ({
  startSync,
  getSyncStatus,
  awsErrorMessage: (error: unknown) => ({
    message: error instanceof Error ? error.message : "Unknown AWS error.",
    status: 502,
  }),
}));

import { GET, POST } from "./route";

beforeEach(() => {
  startSync.mockReset();
  getSyncStatus.mockReset();
});

describe("POST /api/sops/sync", () => {
  it("starts the ingestion job", async () => {
    startSync.mockResolvedValue({ jobId: "job-1", dataSourceId: "ds-1" });
    const response = await POST();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ jobId: "job-1", dataSourceId: "ds-1" });
  });

  it("maps AWS errors", async () => {
    startSync.mockRejectedValue(new Error("no data source"));
    const response = await POST();
    expect(response.status).toBe(502);
  });
});

describe("GET /api/sops/sync", () => {
  it("requires jobId and dataSourceId", async () => {
    const response = await GET(new Request("http://localhost/api/sops/sync"));
    expect(response.status).toBe(400);
    expect(getSyncStatus).not.toHaveBeenCalled();
  });

  it("returns the ingestion job status", async () => {
    getSyncStatus.mockResolvedValue({ status: "COMPLETE", statistics: {} });
    const response = await GET(
      new Request("http://localhost/api/sops/sync?jobId=job-1&dataSourceId=ds-1"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("COMPLETE");
    expect(getSyncStatus).toHaveBeenCalledWith("job-1", "ds-1");
  });
});
