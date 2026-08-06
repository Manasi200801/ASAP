import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";

const BUCKET = process.env.INVOICE_BUCKET ?? "516359819848-invoice";
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
      return { name: file.name, key, url };
    }),
  );

  return Response.json({ uploads });
}
