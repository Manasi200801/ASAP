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
