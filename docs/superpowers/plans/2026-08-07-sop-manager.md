# SOP Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a business user view, edit, and upload AP SOP markdown files from a new `/sops` page in `apps/web`, with edits/uploads writing straight to the `516359819848-sops` S3 bucket and an explicit "Sync knowledge base" action re-indexing the Bedrock Knowledge Base.

**Architecture:** New Next.js API routes (`apps/web/src/app/api/sops/*`) own all S3 reads/writes and Bedrock KB-sync calls, backed by a server-only helper module (`src/lib/sops.ts`). A new client page (`app/sops/page.tsx`) and four components render the list, editor, uploader, and sync bar. The Python agent (`apps/agent`) is untouched.

**Tech Stack:** Next.js 15 App Router route handlers (Node runtime), `@aws-sdk/client-s3` (already a dependency), new `@aws-sdk/client-bedrock-agent` dependency, Vitest for tests, Tailwind CSS v4 using the existing design tokens in `globals.css`.

## Global Constraints

- Bucket: `SOP_BUCKET` env var, default `516359819848-sops`.
- Knowledge base: `SOP_KNOWLEDGE_BASE_ID` env var, no default (matches `apps/agent/.env.example`'s value `NKB8KVAZ45` when copied into `apps/web/.env.local`).
- Only `.md` files are supported for edit/upload — reject anything else client-side (before any request) and server-side (in the `PUT` route).
- No delete functionality — out of scope for this plan.
- English-only UI — no i18n for this page, unlike the main screen.
- S3 writes (`PUT`) happen immediately per-file on explicit user action (Save button / upload), never on a debounce timer.
- The KB sync is a separate, explicit, page-level action — never triggered automatically by a save.
- Sync polling: every 3000ms, up to 120 attempts (~6 minutes), matching `apps/agent/scripts/make_kb.py`'s own polling cadence.
- Follow existing code conventions: `"use client"` on interactive components, Tailwind utility classes using the color tokens already defined in `apps/web/src/app/globals.css` (`surface-1/2/3`, `line`, `line-strong`, `ink`, `ink-dim`, `ink-faint`, `brass`, `brass-deep`, `ok`, `blocked`, `font-data`), Biome formatting (double quotes, 2-space indent, 100-column width — run `npm run format` if unsure).
- `export const runtime = "nodejs";` on every new route handler (AWS SDK needs the Node runtime, not edge) — matches `api/upload/route.ts` and `api/chat/route.ts`.

---

### Task 1: Dependency and environment config

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/.env.example`

**Interfaces:**
- Produces: `@aws-sdk/client-bedrock-agent` available for import in later tasks; `SOP_BUCKET` and `SOP_KNOWLEDGE_BASE_ID` env vars documented.

- [ ] **Step 1: Add the Bedrock Agent SDK dependency**

Edit `apps/web/package.json`, in `"dependencies"`, add a line after `"@aws-sdk/client-s3"`:

```json
    "@aws-sdk/client-bedrock-agent": "^3.699.0",
```

(Pin to the same major/minor line as the existing `@aws-sdk/client-s3": "^3.699.0"` so the AWS SDK v3 packages stay in lockstep.)

- [ ] **Step 2: Install it**

Run: `cd apps/web && npm install`
Expected: `package-lock.json` updates, no errors.

- [ ] **Step 3: Document the new env vars**

Edit `apps/web/.env.example`, append after the existing `INVOICE_BUCKET` line and its CORS comment:

```
# --- SOP manager ----------------------------------------------------------
# Read/write/edit access to the AP SOP documents that feed the price-tolerance
# knowledge base (SOP_KNOWLEDGE_BASE_ID below). Same AWS credential chain as
# the invoice upload above.
SOP_BUCKET=516359819848-sops

# From Workshop Studio / apps/agent/.env.example's value for the same knowledge
# base. Needed to trigger a re-index after editing or uploading a SOP file.
SOP_KNOWLEDGE_BASE_ID=NKB8KVAZ45
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/.env.example
git commit -m "Add Bedrock Agent SDK dependency and SOP manager env vars"
```

---

### Task 2: Server-side SOP helpers (`lib/sops.ts`)

**Files:**
- Create: `apps/web/src/lib/sop-types.ts`
- Create: `apps/web/src/lib/sops.ts`
- Test: `apps/web/src/lib/__tests__/sops.test.ts`

**Interfaces:**
- Consumes: `@aws-sdk/client-s3` (`S3Client`, `ListObjectsV2Command`, `GetObjectCommand`, `PutObjectCommand`), `@aws-sdk/client-bedrock-agent` (`BedrockAgentClient`, `ListDataSourcesCommand`, `StartIngestionJobCommand`, `GetIngestionJobCommand`).
- Produces (for Task 3's route handlers and, via `sop-types.ts`, for client components in Tasks 6-8):
  - `type SopFile = { key: string; size: number; lastModified: string }` (in `sop-types.ts`)
  - `async function listSops(): Promise<SopFile[]>`
  - `async function getSop(key: string): Promise<string>`
  - `async function putSop(key: string, content: string): Promise<void>`
  - `type SyncHandle = { jobId: string; dataSourceId: string }`
  - `async function startSync(): Promise<SyncHandle>`
  - `type SyncStatistics = { documentsScanned: number; documentsIndexed: number; documentsFailed: number; documentsSkipped: number }`
  - `type SyncStatus = { status: string; statistics: SyncStatistics }`
  - `async function getSyncStatus(jobId: string, dataSourceId: string): Promise<SyncStatus>`
  - `function awsErrorMessage(error: unknown): { message: string; status: number }`

- [ ] **Step 1: Create the shared type file**

Create `apps/web/src/lib/sop-types.ts`:

```typescript
export type SopFile = {
  key: string;
  size: number;
  lastModified: string;
};
```

This is a type-only file (no runtime code, no AWS SDK import) so client components can import it without pulling the AWS SDK into the browser bundle.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/lib/__tests__/sops.test.ts`:

```typescript
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
      statistics: { documentsScanned: 3, documentsIndexed: 2, documentsFailed: 0, documentsSkipped: 1 },
    });
  });
});

describe("awsErrorMessage", () => {
  it("maps an expired token error to a friendly message", () => {
    const error = Object.assign(new Error("The security token included in the request is expired"), {
      name: "ExpiredTokenException",
    });
    expect(awsErrorMessage(error)).toEqual({
      message: "AWS credentials expired — re-copy the workshop profile from Workshop Studio.",
      status: 502,
    });
  });

  it("passes through other error messages", () => {
    expect(awsErrorMessage(new Error("boom"))).toEqual({ message: "boom", status: 502 });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/lib/__tests__/sops.test.ts`
Expected: FAIL — `Cannot find module '../sops'` (the file doesn't exist yet).

- [ ] **Step 4: Implement `lib/sops.ts`**

Create `apps/web/src/lib/sops.ts`:

```typescript
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  BedrockAgentClient,
  GetIngestionJobCommand,
  ListDataSourcesCommand,
  StartIngestionJobCommand,
} from "@aws-sdk/client-bedrock-agent";
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run src/lib/__tests__/sops.test.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/sop-types.ts apps/web/src/lib/sops.ts apps/web/src/lib/__tests__/sops.test.ts
git commit -m "Add server-side SOP helpers (S3 list/get/put, KB sync)"
```

---

### Task 3: API route — list SOPs (`GET /api/sops`)

**Files:**
- Create: `apps/web/src/app/api/sops/route.ts`
- Test: `apps/web/src/app/api/sops/route.test.ts`

**Interfaces:**
- Consumes: `listSops`, `awsErrorMessage` from `@/lib/sops` (Task 2).
- Produces: `GET /api/sops` → `200 { files: SopFile[] }` on success, `{status} { message: string }` on failure. Later consumed by `app/sops/page.tsx` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/api/sops/route.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const listSops = vi.fn();

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
    listSops.mockResolvedValue([{ key: "a.md", size: 10, lastModified: "2026-08-06T00:00:00.000Z" }]);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.files).toEqual([{ key: "a.md", size: 10, lastModified: "2026-08-06T00:00:00.000Z" }]);
  });

  it("maps AWS errors to the mapped status and message", async () => {
    listSops.mockRejectedValue(new Error("boom"));
    const response = await GET();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.message).toBe("boom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/app/api/sops/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/sops/route.ts`:

```typescript
import { awsErrorMessage, listSops } from "@/lib/sops";

export const runtime = "nodejs";

export async function GET() {
  try {
    const files = await listSops();
    return Response.json({ files });
  } catch (error) {
    const { message, status } = awsErrorMessage(error);
    return Response.json({ message }, { status });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/app/api/sops/route.test.ts`
Expected: PASS, both tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/sops/route.ts apps/web/src/app/api/sops/route.test.ts
git commit -m "Add GET /api/sops route to list SOP files"
```

---

### Task 4: API route — read/write a single SOP (`GET`/`PUT /api/sops/[key]`)

**Files:**
- Create: `apps/web/src/app/api/sops/[key]/route.ts`
- Test: `apps/web/src/app/api/sops/[key]/route.test.ts`

**Interfaces:**
- Consumes: `getSop`, `putSop`, `awsErrorMessage` from `@/lib/sops` (Task 2).
- Produces: `GET /api/sops/:key` → `200 { key: string, content: string }`; `PUT /api/sops/:key` (body = raw text) → `200 { key: string }`, or `400 { message }` for a non-`.md` key. Later consumed by `app/sops/page.tsx` (Task 8) for loading a file into the editor and for both save and upload.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/sops/[key]/route.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSop = vi.fn();
const putSop = vi.fn();

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run "src/app/api/sops/[key]/route.test.ts"`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/sops/[key]/route.ts`:

```typescript
import { awsErrorMessage, getSop, putSop } from "@/lib/sops";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const decoded = decodeURIComponent(key);
  try {
    const content = await getSop(decoded);
    return Response.json({ key: decoded, content });
  } catch (error) {
    const { message, status } = awsErrorMessage(error);
    return Response.json({ message }, { status });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const decoded = decodeURIComponent(key);
  if (!decoded.endsWith(".md")) {
    return Response.json({ message: "Only .md files are supported." }, { status: 400 });
  }
  const content = await request.text();
  try {
    await putSop(decoded, content);
    return Response.json({ key: decoded });
  } catch (error) {
    const { message, status } = awsErrorMessage(error);
    return Response.json({ message }, { status });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run "src/app/api/sops/[key]/route.test.ts"`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/sops/[key]/route.ts" "apps/web/src/app/api/sops/[key]/route.test.ts"
git commit -m "Add GET/PUT /api/sops/[key] routes to read and save a SOP file"
```

---

### Task 5: API route — knowledge base sync (`POST`/`GET /api/sops/sync`)

**Files:**
- Create: `apps/web/src/app/api/sops/sync/route.ts`
- Test: `apps/web/src/app/api/sops/sync/route.test.ts`

**Interfaces:**
- Consumes: `startSync`, `getSyncStatus`, `awsErrorMessage` from `@/lib/sops` (Task 2).
- Produces: `POST /api/sops/sync` → `200 { jobId: string, dataSourceId: string }`; `GET /api/sops/sync?jobId=&dataSourceId=` → `200 { status: string, statistics: {...} }`, or `400 { message }` when either query param is missing. Later consumed by `components/sops/kb-sync-bar.tsx` (Task 7).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/sops/sync/route.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const startSync = vi.fn();
const getSyncStatus = vi.fn();

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/app/api/sops/sync/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/sops/sync/route.ts`:

```typescript
import { awsErrorMessage, getSyncStatus, startSync } from "@/lib/sops";

export const runtime = "nodejs";

export async function POST() {
  try {
    const handle = await startSync();
    return Response.json(handle);
  } catch (error) {
    const { message, status } = awsErrorMessage(error);
    return Response.json({ message }, { status });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const dataSourceId = url.searchParams.get("dataSourceId");
  if (!jobId || !dataSourceId) {
    return Response.json({ message: "jobId and dataSourceId are required." }, { status: 400 });
  }
  try {
    const status = await getSyncStatus(jobId, dataSourceId);
    return Response.json(status);
  } catch (error) {
    const { message, status: httpStatus } = awsErrorMessage(error);
    return Response.json({ message }, { status: httpStatus });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run src/app/api/sops/sync/route.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `cd apps/web && npm test && npm run typecheck`
Expected: all green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/sops/sync/route.ts apps/web/src/app/api/sops/sync/route.test.ts
git commit -m "Add POST/GET /api/sops/sync routes to trigger and poll KB ingestion"
```

---

### Task 6: `SopList` and `SopEditor` components

**Files:**
- Create: `apps/web/src/components/sops/sop-list.tsx`
- Create: `apps/web/src/components/sops/sop-editor.tsx`

No automated tests for this task — the codebase has no component-render tests anywhere (`approval-card.tsx`, `composer.tsx`, `batch-table.tsx` etc. are all untested at the component level; the logic these components call is already covered by the `lib/sops.ts` and `api/sops` route tests in Tasks 2-5). Verified manually in Task 9.

**Interfaces:**
- Consumes: `type SopFile` from `@/lib/sop-types` (Task 2).
- Produces: `SopList({ files: SopFile[], selectedKey: string | null, onSelect: (key: string) => void })`; `SopEditor({ fileKey: string, content: string, onSave: (key: string, content: string) => Promise<void> })`. Both consumed by `app/sops/page.tsx` (Task 8).

- [ ] **Step 1: Create the file list component**

Create `apps/web/src/components/sops/sop-list.tsx`:

```tsx
"use client";

import type { SopFile } from "@/lib/sop-types";

export function SopList({
  files,
  selectedKey,
  onSelect,
}: {
  files: SopFile[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-data text-[10.5px] text-ink-faint uppercase tracking-[0.14em]">
        Files
      </div>
      {files.length === 0 ? (
        <p className="text-[12.5px] text-ink-dim">No SOP files yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((file) => (
            <li key={file.key}>
              <button
                type="button"
                onClick={() => onSelect(file.key)}
                className={`pressable w-full cursor-pointer rounded-md border px-3 py-2 text-left transition-colors ${
                  file.key === selectedKey
                    ? "border-brass-deep bg-brass/[0.08]"
                    : "border-line bg-surface-2 hover:border-ink-faint"
                }`}
              >
                <div className="truncate text-[13px] text-ink">{file.key}</div>
                <div className="font-data text-[11px] text-ink-faint">
                  {formatSize(file.size)} · {formatDate(file.lastModified)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
```

- [ ] **Step 2: Create the editor component**

Create `apps/web/src/components/sops/sop-editor.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

export function SopEditor({
  fileKey,
  content,
  onSave,
}: {
  fileKey: string;
  content: string;
  onSave: (key: string, content: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(content);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // A newly selected file replaces the draft; re-renders of the same file must
  // not clobber an unsaved edit, so this only resets when the key changes.
  useEffect(() => {
    setDraft(content);
    setState("idle");
    setError(null);
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on fileKey only
  }, [fileKey]);

  async function save() {
    setState("saving");
    setError(null);
    try {
      await onSave(fileKey, draft);
      setState("saved");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="font-data text-[10.5px] text-ink-faint uppercase tracking-[0.14em]">
          {fileKey}
        </div>
        <div className="flex items-center gap-2.5">
          {state === "saved" ? <span className="text-[12px] text-ok">Saved</span> : null}
          {state === "error" && error ? (
            <span className="text-[12px] text-blocked">{error}</span>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={state === "saving"}
            className="pressable cursor-pointer rounded-full border border-brass-deep bg-brass/[0.08] px-3 py-1 font-medium text-[12px] text-brass disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
          >
            {state === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setState("idle");
        }}
        spellCheck={false}
        className="min-h-[420px] flex-1 rounded-md border border-line-strong bg-surface-1 p-3 font-data text-[12.5px] text-ink outline-none focus:border-brass-deep"
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd apps/web && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/sops/sop-list.tsx apps/web/src/components/sops/sop-editor.tsx
git commit -m "Add SopList and SopEditor components"
```

---

### Task 7: `SopUpload` and `KbSyncBar` components

**Files:**
- Create: `apps/web/src/components/sops/sop-upload.tsx`
- Create: `apps/web/src/components/sops/kb-sync-bar.tsx`

No automated tests — same rationale as Task 6. Verified manually in Task 9.

**Interfaces:**
- Produces: `SopUpload({ existingKeys: string[], onUpload: (key: string, content: string) => Promise<void> })`; `KbSyncBar({ unsyncedCount: number, onSynced: () => void })`. Both consumed by `app/sops/page.tsx` (Task 8).

- [ ] **Step 1: Create the upload component**

Create `apps/web/src/components/sops/sop-upload.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";

export function SopUpload({
  existingKeys,
  onUpload,
}: {
  existingKeys: string[];
  onUpload: (key: string, content: string) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<{ key: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    setError(null);
    const file = files[0];
    if (!file) return;
    if (!file.name.endsWith(".md")) {
      setError("Only .md files are supported.");
      return;
    }
    const content = await file.text();
    if (existingKeys.includes(file.name)) {
      setPending({ key: file.name, content });
      return;
    }
    await onUpload(file.name, content);
  }

  async function confirmOverwrite() {
    if (!pending) return;
    await onUpload(pending.key, pending.content);
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept=".md"
        className="hidden"
        onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
      />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the file input above is the keyboard path */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-md border border-dashed px-3.5 py-3 text-left text-[13px] transition-colors ${
          dragging ? "border-brass bg-brass/[0.06] text-ink" : "border-line-strong text-ink-dim"
        }`}
      >
        Upload a new SOP (.md) — click or drop a file
      </div>
      {error ? <p className="text-[12px] text-blocked">{error}</p> : null}
      {pending ? (
        <div className="flex items-center gap-2.5 rounded-md border border-blocked-deep bg-blocked/[0.06] px-3 py-2 text-[12.5px]">
          <span className="text-ink-dim">
            This will overwrite <b className="text-ink">{pending.key}</b>.
          </span>
          <button
            type="button"
            onClick={confirmOverwrite}
            className="pressable cursor-pointer rounded-full border border-blocked px-2.5 py-1 text-[11.5px] text-blocked"
          >
            Overwrite
          </button>
          <button
            type="button"
            onClick={() => setPending(null)}
            className="cursor-pointer text-[11.5px] text-ink-faint"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create the KB sync bar component**

Create `apps/web/src/components/sops/kb-sync-bar.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";

type Phase = "idle" | "starting" | "syncing" | "synced" | "failed" | "timeout";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 120; // ~6 minutes, matching apps/agent/scripts/make_kb.py

export function KbSyncBar({
  unsyncedCount,
  onSynced,
}: {
  unsyncedCount: number;
  onSynced: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollsRef = useRef(0);

  async function sync() {
    setPhase("starting");
    setError(null);
    pollsRef.current = 0;
    try {
      const response = await fetch("/api/sops/sync", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Could not start the sync.");
      setPhase("syncing");
      poll(body.jobId, body.dataSourceId);
    } catch (err) {
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Could not start the sync.");
    }
  }

  async function poll(jobId: string, dataSourceId: string) {
    if (pollsRef.current >= MAX_POLLS) {
      setPhase("timeout");
      return;
    }
    pollsRef.current += 1;
    const response = await fetch(
      `/api/sops/sync?jobId=${encodeURIComponent(jobId)}&dataSourceId=${encodeURIComponent(dataSourceId)}`,
    );
    const body = await response.json();
    if (!response.ok) {
      setPhase("failed");
      setError(body.message ?? "Sync failed.");
      return;
    }
    if (body.status === "COMPLETE") {
      setPhase("synced");
      onSynced();
      return;
    }
    if (body.status === "FAILED") {
      setPhase("failed");
      setError("The ingestion job failed.");
      return;
    }
    setTimeout(() => poll(jobId, dataSourceId), POLL_INTERVAL_MS);
  }

  const busy = phase === "starting" || phase === "syncing";

  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3.5 py-2.5">
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        className="pressable cursor-pointer rounded-full border border-brass-deep bg-brass/[0.08] px-3 py-1 font-medium text-[12px] text-brass disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
      >
        {busy ? "Syncing…" : "Sync knowledge base"}
      </button>
      {unsyncedCount > 0 && !busy ? (
        <span className="font-data text-[11px] text-ink-faint">
          {unsyncedCount} unsynced change{unsyncedCount === 1 ? "" : "s"}
        </span>
      ) : null}
      {phase === "synced" ? <span className="text-[12px] text-ok">Synced</span> : null}
      {phase === "timeout" ? (
        <span className="text-[12px] text-ink-dim">Still running — check back</span>
      ) : null}
      {phase === "failed" && error ? <span className="text-[12px] text-blocked">{error}</span> : null}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd apps/web && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/sops/sop-upload.tsx apps/web/src/components/sops/kb-sync-bar.tsx
git commit -m "Add SopUpload and KbSyncBar components"
```

---

### Task 8: Wire the `/sops` page and link it from the main screen

**Files:**
- Create: `apps/web/src/app/sops/page.tsx`
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: `SopList`, `SopEditor`, `SopUpload`, `KbSyncBar` (Tasks 6-7), `type SopFile` from `@/lib/sop-types` (Task 2), and the `/api/sops*` routes (Tasks 3-5).

- [ ] **Step 1: Create the page**

Create `apps/web/src/app/sops/page.tsx`:

```tsx
"use client";

import { KbSyncBar } from "@/components/sops/kb-sync-bar";
import { SopEditor } from "@/components/sops/sop-editor";
import { SopList } from "@/components/sops/sop-list";
import { SopUpload } from "@/components/sops/sop-upload";
import type { SopFile } from "@/lib/sop-types";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function SopsPage() {
  const [files, setFiles] = useState<SopFile[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unsyncedCount, setUnsyncedCount] = useState(0);

  useEffect(() => {
    refreshList();
  }, []);

  async function refreshList() {
    const response = await fetch("/api/sops");
    const body = await response.json();
    if (!response.ok) {
      setLoadError(body.message ?? "Could not load SOP files.");
      return;
    }
    setLoadError(null);
    setFiles(body.files);
  }

  async function selectFile(key: string) {
    setSelectedKey(key);
    const response = await fetch(`/api/sops/${encodeURIComponent(key)}`);
    const body = await response.json();
    if (!response.ok) {
      setLoadError(body.message ?? "Could not load the file.");
      return;
    }
    setLoadError(null);
    setContent(body.content);
  }

  async function save(key: string, nextContent: string) {
    const response = await fetch(`/api/sops/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: nextContent,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? "Save failed.");
    setUnsyncedCount((count) => count + 1);
    await refreshList();
  }

  async function upload(key: string, uploadContent: string) {
    await save(key, uploadContent);
    setSelectedKey(key);
    setContent(uploadContent);
  }

  return (
    <main className="mx-auto max-w-[1080px] px-5 pb-24">
      <section className="mt-10 overflow-hidden rounded-lg border border-line bg-surface-1">
        <header className="flex flex-wrap items-center gap-4 border-line border-b bg-surface-2 px-4 py-3">
          <div className="font-data text-[12px] uppercase tracking-[0.12em]">
            STRIKE <span className="text-brass">AP</span> · SOPs
          </div>
          <Link href="/" className="ml-auto font-data text-[11.5px] text-ink-dim hover:text-ink">
            ← Back
          </Link>
        </header>

        <div className="flex flex-col gap-4 px-4 py-5">
          <KbSyncBar unsyncedCount={unsyncedCount} onSynced={() => setUnsyncedCount(0)} />

          {loadError ? <p className="text-[12.5px] text-blocked">{loadError}</p> : null}

          <SopUpload existingKeys={files.map((f) => f.key)} onUpload={upload} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
            <SopList files={files} selectedKey={selectedKey} onSelect={selectFile} />
            {selectedKey ? (
              <SopEditor fileKey={selectedKey} content={content} onSave={save} />
            ) : (
              <p className="text-[13px] text-ink-dim">Select a file to edit it.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Add a nav link from the main page**

In `apps/web/src/app/page.tsx`, add the import next to the other imports (after the `useState` import line, `import { useState } from "react";`):

```tsx
import Link from "next/link";
```

Then, in the header, insert a link before the language toggle controls. Find this block (around line 82):

```tsx
          <div className="flex gap-1.5">
            {(["en", "de"] as const).map((code) => (
```

Replace it with:

```tsx
          <Link
            href="/sops"
            className="font-data text-[11px] text-ink-dim tracking-[0.06em] hover:text-ink"
          >
            SOPs
          </Link>

          <div className="flex gap-1.5">
            {(["en", "de"] as const).map((code) => (
```

- [ ] **Step 3: Typecheck, lint, and run the full test suite**

Run: `cd apps/web && npm run typecheck && npm run lint && npm test`
Expected: no errors, all tests green.

- [ ] **Step 4: Manual smoke test with the mock/no-AWS setup**

Run: `cd apps/web && npm run dev`, open `http://localhost:3000`, click "SOPs" in the header. The `/sops` page loads. Since no `.env.local` with real AWS credentials is required to *view* the page shell, but `GET /api/sops` will fail without them — expect the page to render with a visible error message ("Could not load SOP files." or an AWS SDK credential error) rather than crashing. This confirms error handling renders correctly; Task 9 does the real-credentials pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/sops/page.tsx apps/web/src/app/page.tsx
git commit -m "Add /sops page and link it from the main screen"
```

---

### Task 9: Documentation and end-to-end verification against real AWS

**Files:**
- Modify: `apps/web/README.md`
- Modify: `README.md`

**Interfaces:** None — this task documents and verifies Tasks 1-8, it doesn't add new interfaces.

- [ ] **Step 1: Update `apps/web/README.md`'s shape tree**

In the `## Shape` section's `api/` list, after the `api/upload/` line, add:

```
    api/sops/          list/read/write SOP files in S3, trigger/poll KB sync
```

In the `components/` list, after `composer.tsx`, add:

```
    sops/               SOP manager: list, editor, upload, KB sync bar
```

- [ ] **Step 2: Update `apps/web/README.md`'s env var table**

In the "Talking to the agent" section's table, add two rows after `INVOICE_BUCKET`, `AWS_REGION`:

```
| `SOP_BUCKET` | Bucket the `/sops` page reads and writes |
| `SOP_KNOWLEDGE_BASE_ID` | Knowledge base re-indexed by the "Sync knowledge base" action |
```

- [ ] **Step 3: Update the root `README.md`'s env var table**

In the `### apps/web/.env.local` table, add two rows after `INVOICE_BUCKET`:

```
| `SOP_BUCKET` | Bucket the `/sops` page manages — list, read, write SOP files |
| `SOP_KNOWLEDGE_BASE_ID` | Knowledge base the `/sops` page's "Sync knowledge base" button re-indexes |
```

- [ ] **Step 4: Commit the docs**

```bash
git add apps/web/README.md README.md
git commit -m "Document the SOP manager's shape and env vars"
```

- [ ] **Step 5: Verify against the real `workshop` AWS profile**

Ensure `apps/web/.env.local` has `SOP_BUCKET=516359819848-sops` and `SOP_KNOWLEDGE_BASE_ID=NKB8KVAZ45` (copy from the updated `.env.example` if not already present), and that AWS credentials resolve via the `workshop` profile (same setup the `/api/upload` route already relies on).

Run: `cd apps/web && npm run dev`, open `http://localhost:3000/sops`.

Check, in order:
1. The list shows the 3 files currently in `516359819848-sops` (`SOP-AP-004-price-tolerance.md`, `duplicate-invoice-exception-sop.md`, `three-way-match-exception-sop.md`).
2. Click a file, its content loads into the editor.
3. Make a small edit, click Save — "Saved" appears, and re-fetching (`aws s3 cp s3://516359819848-sops/<file> -` or re-selecting the file after a refresh) shows the edit persisted.
4. Upload a new `.md` file — it appears in the list without a page reload.
5. Re-upload a file with a name that already exists — the overwrite confirmation appears; confirming overwrites it.
6. Click "Sync knowledge base" — phase moves Syncing → Synced (or Failed with a readable message, or Still running if it's near the 6-minute ceiling on a slow day). Confirm in the AWS Console (Bedrock → Knowledge Bases → `strike-ap-sops` → Data source) that a new ingestion job ran and completed.

If any step fails with an `ExpiredToken` message, re-copy the `workshop` profile credentials from Workshop Studio and retry — this is the documented, expected failure mode for this account, not a bug in the feature.

- [ ] **Step 6: Final check — full CI-equivalent run**

Run: `cd apps/web && npm run lint && npm run typecheck && npm test && npm run build`
Expected: all green. This matches what `.github/workflows/ci.yml` runs, per `README.md`'s "Checks" section.
