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
