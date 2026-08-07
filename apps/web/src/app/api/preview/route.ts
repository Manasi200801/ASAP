import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";

const BUCKET = process.env.INVOICE_BUCKET ?? "516359819848-invoice";
const REGION = process.env.AWS_REGION ?? "us-east-1";

/**
 * Hands the browser a presigned GET for a document already sitting in S3, so
 * the validation queue can show the actual file a batch was checked against -
 * not a copy bundled into the app, and not limited to the moment a clerk's
 * own drop is still in browser memory.
 *
 * Two real locations, never a fabricated one:
 *  - `runs/<runId>/<file>`, the exact key `/api/upload` wrote to, for a batch
 *    someone actually dropped.
 *  - `<file>` at the bucket root, for the sample batch: the workshop stack
 *    itself provisions all six `fpl-invoice-0{1..6}.pdf` originals there -
 *    the same documents `sample_batch()` in the agent transcribes into fixture
 *    data, just not copied or bundled anywhere by this app.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");
  const file = searchParams.get("file");
  const sample = searchParams.get("sample") === "true";

  if (!file || (!sample && !runId)) {
    return Response.json(
      { message: "file, and either runId or sample, are required." },
      {
        status: 400,
      },
    );
  }

  const s3 = new S3Client({ region: REGION });
  const key = sample ? file : `runs/${runId}/${file}`;

  try {
    // Presigning is local arithmetic - it "succeeds" whether or not the key
    // exists, which is exactly wrong here: a dead presigned URL handed to an
    // <iframe> renders as S3's raw XML error rather than this app's own "not
    // available" state. Checking first is what makes that state honest
    // instead of a broken frame - and still matters for the sample batch,
    // since a filename typo or a future fixture with no upstream original
    // must fail the same clean way.
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    return Response.json({ message: "No document at that key." }, { status: 404 });
  }

  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
      expiresIn: 900,
    });
    return Response.json({ url });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Could not presign the document." },
      { status: 502 },
    );
  }
}
