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
