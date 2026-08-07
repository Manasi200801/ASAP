import { beforeEach, describe, expect, it, vi } from "vitest";

const { listSops } = vi.hoisted(() => ({ listSops: vi.fn() }));

vi.mock("@/lib/sops", () => ({
  listSops,
  awsErrorMessage: (error: unknown) => ({
    message: error instanceof Error ? error.message : "Unknown AWS error.",
    status: 502,
  }),
}));

import { GET } from "./route";

beforeEach(() => {
  listSops.mockReset();
});

describe("GET /api/sops", () => {
  it("returns the file list", async () => {
    listSops.mockResolvedValue([
      { key: "a.md", size: 10, lastModified: "2026-08-06T00:00:00.000Z" },
    ]);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.files).toEqual([
      { key: "a.md", size: 10, lastModified: "2026-08-06T00:00:00.000Z" },
    ]);
  });

  it("maps AWS errors to the mapped status and message", async () => {
    listSops.mockRejectedValue(new Error("boom"));
    const response = await GET();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.message).toBe("boom");
  });
});
