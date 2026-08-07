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
export async function POST(request: Request) {
  const { runId, files } = (await request.json()) as {
    runId: string;
    files: { name: string; size: number }[];
  };

  if (!runId || !Array.isArray(files) || files.length === 0) {
    return Response.json({ message: "Nothing to upload." }, { status: 400 });
  }

  const s3 = new S3Client({ region: REGION });

  const uploads = await Promise.all(
    files.map(async (file) => {
      const key = `runs/${runId}/${file.name}`;
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: "application/pdf" }),
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
