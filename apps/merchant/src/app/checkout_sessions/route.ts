import { createCheckoutSession, formatAcpError, responseHeaders } from "../../lib/acp-checkout";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    const result = createCheckoutSession(body, request.headers);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: responseHeaders(request.headers, result) });
  } catch (error) {
    const formatted = formatAcpError(error);
    return Response.json(formatted.body, { status: formatted.status });
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: { "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type, API-Version, Idempotency-Key, Request-Id, Signature, Timestamp" } });
}
