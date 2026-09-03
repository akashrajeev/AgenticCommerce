import { getCheckoutSession, updateCheckoutSession, formatAcpError, responseHeaders } from "../../../lib/acp-checkout";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const { id } = await params;
    const session = getCheckoutSession(id);
    const headers = new Headers({ "content-type": "application/json", "api-version": "2026-04-17" });
    const requestId = request.headers.get("request-id");
    if (requestId) headers.set("request-id", requestId);
    return new Response(JSON.stringify(session), { status: 200, headers });
  } catch (error) {
    const formatted = formatAcpError(error);
    return Response.json(formatted.body, { status: formatted.status });
  }
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const result = updateCheckoutSession(id, body, request.headers);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: responseHeaders(request.headers, result) });
  } catch (error) {
    const formatted = formatAcpError(error);
    return Response.json(formatted.body, { status: formatted.status });
  }
}
