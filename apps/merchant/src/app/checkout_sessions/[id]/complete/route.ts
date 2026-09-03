import { completeCheckoutSessionWithMandate, mandateBridgeResponseHeaders } from "../../../../lib/mandate-bridge";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const result = await completeCheckoutSessionWithMandate(id, body, request.headers);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: mandateBridgeResponseHeaders(request.headers, result),
  });
}
