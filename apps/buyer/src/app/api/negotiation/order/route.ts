import { NextResponse } from "next/server";

const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
const INTERNAL_GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? process.env.GATEWAY_INTERNAL_SECRET ?? "";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { authorizationId?: unknown; transactionId?: unknown } | null;
  const authorizationId = typeof body?.authorizationId === "string" ? body.authorizationId.trim() : "";
  const transactionId = typeof body?.transactionId === "string" ? body.transactionId.trim() : "";
  if (!authorizationId || !transactionId) return NextResponse.json({ error: "MANDATE_PAYMENT_BINDING_REQUIRED" }, { status: 400 });
  if (!INTERNAL_GATEWAY_SECRET) return NextResponse.json({ error: "INTERNAL_GATEWAY_SECRET_NOT_CONFIGURED" }, { status: 503 });

  try {
    const response = await fetch(`${GATEWAY_INTERNAL_URL}/v1/mandates/${encodeURIComponent(authorizationId)}/razorpay-order`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mandate-gateway-secret": INTERNAL_GATEWAY_SECRET,
      },
      body: JSON.stringify({ transactionId }),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    return NextResponse.json(payload ?? { error: "RAZORPAY_ORDER_FAILED" }, { status: response.status, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "RAZORPAY_ORDER_UNAVAILABLE" }, { status: 502 });
  }
}
