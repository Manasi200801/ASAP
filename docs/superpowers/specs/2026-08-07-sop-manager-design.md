# SOP Manager — Design

## Purpose

Give business users a way to view, edit, and add Accounts Payable SOP documents (the
markdown files backing rule 9's price-tolerance check) without touching the AWS
console or the CLI. Edits and new files write straight to the `516359819848-sops`
S3 bucket; a separate explicit action re-syncs the Bedrock Knowledge Base
(`SOP_KNOWLEDGE_BASE_ID`) so the agent actually sees the change.

## Non-goals

- Delete support (S3 `DeleteObject` + re-sync would drop a doc from the KB, but
  nothing in the current ask requires it — add later if needed).
- Localization. This is internal tooling, unlike the demo-facing main screen; it
  ships English-only.
- Editing the `sap-api` knowledge base or bucket — out of scope, this only touches
  `sops`.
- Presigned direct-to-browser S3 writes (the pattern `/api/upload` uses for
  invoice PDFs). SOP files are small markdown text, so the API routes accept
  content in the request body and write to S3 server-side — simpler, and it
  lets the route validate and read-after-write in one place.

## Architecture

New route `apps/web/src/app/sops/page.tsx`, reached via a "SOPs" link added to the
header of the main screen (`apps/web/src/app/page.tsx`). New Next.js API routes
under `apps/web/src/app/api/sops/*` own all S3 and Bedrock KB-sync calls. The
Python agent (`apps/agent`) is untouched — its `main.py` implements exactly the
two contract endpoints (`/chat`, `/approve`) on purpose, and this feature doesn't
need to change that.

New env vars, `apps/web/.env.example`:

```
SOP_BUCKET=516359819848-sops
SOP_KNOWLEDGE_BASE_ID=NKB8KVAZ45
```

(`SOP_KNOWLEDGE_BASE_ID` mirrors the value already in `apps/agent/.env.example`.)

New dependency: `@aws-sdk/client-bedrock-agent` (for `ListDataSourcesCommand`,
`StartIngestionJobCommand`, `GetIngestionJobCommand`).

## API routes

| Route | Method | Does |
|---|---|---|
| `/api/sops` | `GET` | `ListObjectsV2` on `SOP_BUCKET` → `{ key, size, lastModified }[]`, sorted by key |
| `/api/sops/[key]` | `GET` | `GetObjectCommand` → the file's text content |
| `/api/sops/[key]` | `PUT` | `PutObjectCommand`, body = raw markdown text. Overwrites if the key exists, creates otherwise — this is how both "edit" and "new file" land |
| `/api/sops/sync` | `POST` | Resolves the `sops` KB's data source via `ListDataSourcesCommand` (KB id from `SOP_KNOWLEDGE_BASE_ID`), then `StartIngestionJobCommand`. Returns `{ jobId, dataSourceId }` |
| `/api/sops/sync` | `GET` (`?jobId=&dataSourceId=`) | `GetIngestionJobCommand` → `{ status, statistics }` |

`[key]` is the filename (bucket is flat — no prefixes), URL-encoded in the route
param.

### Error handling

- AWS errors are caught and turned into readable messages. `ExpiredToken` /
  `ExpiredTokenException` specifically maps to "AWS credentials expired — re-copy
  the workshop profile", since that's a documented, expected failure mode for
  this account (called out in `apps/agent/.env.example`).
- Any other AWS SDK error returns its message with a 502, rather than a bare 500.

## UI / components

All under `apps/web/src/app/sops/` (page) and `apps/web/src/components/sops/`
(components), following the existing `components/` flat-file convention.

- **`page.tsx`** — client component. Fetches the list on mount via
  `GET /api/sops`. Holds: file list, selected file, unsynced-change count, sync
  status. Two-column layout on wide screens (list left, editor right), stacked
  on narrow — same responsive approach as the main page's
  `grid-cols-1 lg:grid-cols-[1fr_270px]`.
- **`sop-list.tsx`** — renders the file list (name, size, last-modified,
  human-formatted). Clicking a row loads that file into the editor
  (`GET /api/sops/[key]`).
- **`sop-editor.tsx`** — textarea bound to the selected file's content. **Save**
  button `PUT`s to `/api/sops/[key]`, shows a transient "Saved" state, disabled
  while the request is in flight. On failure, the textarea content is left
  exactly as the user had it — nothing is cleared or reverted.
- **`sop-upload.tsx`** — file picker + drag-drop, restricted to `.md` by
  extension check before any request fires. If the chosen filename matches an
  existing entry in the list, shows a confirm step ("This will overwrite
  `x.md`") before `PUT`ing, since S3 has no separate create-vs-overwrite
  semantics.
- **`kb-sync-bar.tsx`** — persistent bar with a "Sync knowledge base" button and
  a local "N unsynced change(s)" counter (incremented on every successful
  save/upload, cleared on a successful sync — a UI nudge only, since the
  ingestion job always re-syncs the whole bucket regardless of the counter).
  Clicking it: `POST /api/sops/sync`, then polls `GET /api/sops/sync` every 3s
  (matching `make_kb.py`'s cadence) for up to 6 minutes (120 attempts), showing
  Syncing → Synced / Failed. Hitting the poll ceiling without a terminal status
  shows "Still running — check back" rather than reporting failure.

## Data flow summary

```
Upload/Edit (browser)
   -> PUT /api/sops/[key]         -> S3 PutObject (immediate, per-file)
   -> unsynced-change counter++

Confirm & Sync (explicit, separate action)
   -> POST /api/sops/sync         -> ListDataSourcesCommand, StartIngestionJobCommand
   -> poll GET /api/sops/sync     -> GetIngestionJobCommand until COMPLETE/FAILED
   -> unsynced-change counter reset on success
```

## Testing

- Unit tests for the new API routes (mocking `S3Client` and
  `BedrockAgentClient`) covering: list, get, put (new + overwrite), sync start,
  sync poll (in-progress / complete / failed), and the `ExpiredToken` error
  path. Follows the existing `vitest` setup (`apps/web/src/lib/__tests__/`).
- Manual verification against the real `workshop` profile and the
  `516359819848-sops` bucket: list shows the 3 existing files, edit + save
  overwrites one, upload adds a new one, sync completes and the KB reflects it.
