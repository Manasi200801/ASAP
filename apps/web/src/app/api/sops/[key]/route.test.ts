import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSop, putSop } = vi.hoisted(() => ({ getSop: vi.fn(), putSop: vi.fn() }));

vi.mock("@/lib/sops", () => ({
  getSop,
  putSop,
  awsErrorMessage: (error: unknown) => ({
    message: error instanceof Error ? error.message : "Unknown AWS error.",
    status: 502,
  }),
}));

import { GET, PUT } from "./route";

beforeEach(() => {
  getSop.mockReset();
  putSop.mockReset();
});

describe("GET /api/sops/[key]", () => {
  it("returns the file content", async () => {
    getSop.mockResolvedValue("# hello");
    const response = await GET(new Request("http://localhost/api/sops/a.md"), {
      params: Promise.resolve({ key: "a.md" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ key: "a.md", content: "# hello" });
  });

  it("maps AWS errors", async () => {
    getSop.mockRejectedValue(new Error("not found"));
    const response = await GET(new Request("http://localhost/api/sops/a.md"), {
      params: Promise.resolve({ key: "a.md" }),
    });
    expect(response.status).toBe(502);
  });
});

describe("PUT /api/sops/[key]", () => {
  it("rejects non-.md keys", async () => {
    const response = await PUT(
      new Request("http://localhost/api/sops/a.pdf", { method: "PUT", body: "x" }),
      { params: Promise.resolve({ key: "a.pdf" }) },
    );
    expect(response.status).toBe(400);
    expect(putSop).not.toHaveBeenCalled();
  });

  it("writes the body to S3 under the decoded key", async () => {
    putSop.mockResolvedValue(undefined);
    const response = await PUT(
      new Request("http://localhost/api/sops/new%20sop.md", { method: "PUT", body: "# content" }),
      { params: Promise.resolve({ key: "new%20sop.md" }) },
    );
    expect(response.status).toBe(200);
    expect(putSop).toHaveBeenCalledWith("new sop.md", "# content");
  });
});
