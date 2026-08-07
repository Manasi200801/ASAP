import { MAX_FILES } from "@/lib/events";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";

// Uploads land in their own bucket, separate from the workshop's read-only
// PDFs. An invoice leaves it for -processed-invoice or -blocked-invoice once a
// human has decided, so what remains here is exactly what still needs attention.
const BUCKET = process.env.UPLOAD_BUCKET ?? "516359819848-uploaded-invoice";
const REGION = process.env.AWS_REGION ?? "us-east-1";

/**
 * Hands the browser presigned PUT URLs so invoice PDFs go straight to S3.
 *
 * Files never pass through this server: no body-size limit, no function payload
 * cap, and the agent reads from the bucket it already expects.
 *
 * Requires a CORS rule on the bucket allowing PUT from our origin. The workshop
 * stack does not configure one - see contract/events.md.
 */
/** Anything else is refused before a presigned URL is issued for it. */
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function POST(request: Request) {
  const { runId, files } = (await request.json()) as {
    runId: string;
    files: { name: string; size: number; type?: string }[];
  };

  if (!runId || !Array.isArray(files) || files.length === 0) {
    return Response.json({ message: "Nothing to upload." }, { status: 400 });
  }

  if (files.length > MAX_FILES) {
    return Response.json({ message: `Up to ${MAX_FILES} documents at a time.` }, { status: 400 });
  }

  // Checked here as well as in the browser. The browser check is a courtesy; this
  // one is the boundary, and it decides what a presigned URL is ever issued for.
  const refused = files.filter((file) => !ALLOWED.has(contentType(file)));
  if (refused.length > 0) {
    return Response.json(
      { message: `Not a PDF or image: ${refused.map((f) => f.name).join(", ")}` },
      { status: 400 },
    );
  }

  const s3 = new S3Client({ region: REGION });

  const uploads = await Promise.all(
    files.map(async (file) => {
      const key = `runs/${runId}/${file.name}`;
      const url = await getSignedUrl(
        s3,
        // Must match the Content-Type the browser then sends, or S3 rejects the
        // PUT: the header is part of what the signature covers.
        new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType(file) }),
        { expiresIn: 900 },
      );
      // Fully qualified, because the agent reads from two buckets: uploads here,
      // and the workshop's own PDFs for the demo batch. A bare key would be
      // ambiguous the moment the second source exists.
      return { name: file.name, key: `s3://${BUCKET}/${key}`, url };
    }),
  );

  return Response.json({ uploads });
}

function contentType(file: { name: string; type?: string }): string {
  if (file.type) return file.type;
  // Some browsers send an empty type for a dragged file; fall back to the suffix.
  const suffix = file.name.split(".").pop()?.toLowerCase() ?? "";
  return (
    {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    }[suffix] ?? "application/octet-stream"
  );
}
