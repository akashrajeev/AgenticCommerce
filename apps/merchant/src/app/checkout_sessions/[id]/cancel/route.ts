import { cancelCheckoutSession, formatAcpError, responseHeaders } from "../../../../lib/acp-checkout";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = cancelCheckoutSession(id, body, request.headers);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: responseHeaders(request.headers, result) });
  } catch (error) {
    const formatted = formatAcpError(error);
    return Response.json(formatted.body, { status: formatted.status });
  }
}
