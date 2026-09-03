import { NextResponse } from "next/server";

const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { transactionId?: unknown } | null;
  const transactionId = typeof body?.transactionId === "string" ? body.transactionId.trim() : "";
  if (!transactionId) return NextResponse.json({ error: "TRANSACTION_ID_REQUIRED" }, { status: 400 });
  try {
    const response = await fetch(`${GATEWAY_INTERNAL_URL}/v1/transactions/${encodeURIComponent(transactionId)}/razorpay-order`, { method: "POST", cache: "no-store" });
    const payload = await response.json().catch(() => null);
    return NextResponse.json(payload ?? { error: "RAZORPAY_ORDER_FAILED" }, { status: response.status, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "RAZORPAY_ORDER_UNAVAILABLE" }, { status: 502 });
  }
}
