import { NextResponse } from "next/server";

const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const transactionId = typeof body?.transactionId === "string" ? body.transactionId.trim() : "";
  const razorpayPaymentId = typeof body?.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const razorpayOrderId = typeof body?.razorpay_order_id === "string" ? body.razorpay_order_id : "";
  const razorpaySignature = typeof body?.razorpay_signature === "string" ? body.razorpay_signature : "";
  if (!transactionId || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) return NextResponse.json({ error: "INVALID_PAYMENT_CALLBACK" }, { status: 400 });
  try {
    const response = await fetch(`${GATEWAY_INTERNAL_URL}/v1/transactions/${encodeURIComponent(transactionId)}/verify-payment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ razorpay_payment_id: razorpayPaymentId, razorpay_order_id: razorpayOrderId, razorpay_signature: razorpaySignature }), cache: "no-store" });
    const payload = await response.json().catch(() => null);
    return NextResponse.json(payload ?? { error: "PAYMENT_VERIFICATION_FAILED" }, { status: response.status, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "GOLDEN_PATH_UNAVAILABLE" }, { status: 502 });
  }
}
