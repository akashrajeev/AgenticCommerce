import { NextResponse } from "next/server";

const MERCHANT_INTERNAL_URL = process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000";
const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
const merchantId = "mandate-market";

type Line = { productId: string; quantity: number };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { lines?: unknown; maxSpendPaise?: unknown; reason?: unknown } | null;
  const lines = Array.isArray(body?.lines) ? body.lines.map((item) => {
    const line = item as Record<string, unknown>;
    return { productId: typeof line.productId === "string" ? line.productId.trim() : "", quantity: typeof line.quantity === "number" ? line.quantity : NaN } satisfies Line;
  }) : [];
  const maxSpendPaise = typeof body?.maxSpendPaise === "number" ? body.maxSpendPaise : NaN;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "Golden path purchase";
  if (!lines.length || lines.length > 20 || lines.some((line) => !line.productId || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10) || !Number.isSafeInteger(maxSpendPaise) || maxSpendPaise < 0) return NextResponse.json({ error: "INVALID_GOLDEN_PATH_REQUEST" }, { status: 400 });
  const first = lines[0];
  if (!first) return NextResponse.json({ error: "EMPTY_GOLDEN_PATH_BASKET" }, { status: 400 });
  try {
    const quoteResponse = await fetch(`${MERCHANT_INTERNAL_URL}/api/agent/checkout/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lineItems: lines }), cache: "no-store" });
    const quoteBody = await quoteResponse.json().catch(() => null) as { quote?: { quoteId: string; totalPaise: number; lineItems: unknown[] }; error?: string } | null;
    if (!quoteResponse.ok || !quoteBody?.quote) return NextResponse.json({ error: quoteBody?.error ?? "MERCHANT_QUOTE_FAILED" }, { status: 502 });
    const transactionResponse = await fetch(`${GATEWAY_INTERNAL_URL}/v1/purchase-intents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchantId, productId: first.productId, quantity: first.quantity, lineItems: lines, maxSpendPaise, reason, quoteId: quoteBody.quote.quoteId }), cache: "no-store" });
    const transactionBody = await transactionResponse.json().catch(() => null);
    if (!transactionResponse.ok) return NextResponse.json({ error: transactionBody?.error ?? "GATEWAY_AUTHORIZATION_FAILED", quote: quoteBody.quote }, { status: transactionResponse.status });
    return NextResponse.json({ quote: quoteBody.quote, transaction: transactionBody.transaction });
  } catch {
    return NextResponse.json({ error: "GOLDEN_PATH_UNAVAILABLE" }, { status: 502 });
  }
}
