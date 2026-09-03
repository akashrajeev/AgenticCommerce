type BasketLine = { productId: string; quantity: number };
type Quote = { quoteId: string; merchantId: string; lineItems: Array<{ productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }>; subtotalPaise: number; shippingPaise: number; taxPaise: number; discountPaise: number; totalPaise: number; currency: "INR"; expiresAt: string };
const merchantInternalUrl = (process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { lineItems?: unknown; maxSpendPaise?: unknown } | null;
  if (!Array.isArray(body?.lineItems) || body.lineItems.length < 1 || body.lineItems.length > 20) return Response.json({ error: "INVALID_BASKET" }, { status: 400 });
  const lineItems = body.lineItems.map((item) => { const line = item as Record<string, unknown>; return { productId: typeof line.productId === "string" ? line.productId : "", quantity: typeof line.quantity === "number" ? line.quantity : NaN }; });
  if (lineItems.some((line) => !line.productId || !Number.isInteger(line.quantity) || line.quantity < 1)) return Response.json({ error: "INVALID_BASKET" }, { status: 400 });
  const maxSpendPaise = typeof body.maxSpendPaise === "number" ? body.maxSpendPaise : NaN;
  if (!Number.isInteger(maxSpendPaise) || maxSpendPaise < 0) return Response.json({ error: "INVALID_SPEND_LIMIT" }, { status: 400 });
  const response = await fetch(`${merchantInternalUrl}/api/agent/checkout/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lineItems }), cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { quote?: Quote; error?: string } | null;
  if (!response.ok || !payload?.quote) return Response.json({ error: payload?.error ?? "MERCHANT_QUOTE_UNAVAILABLE" }, { status: response.status || 502 });
  const quote = payload.quote;
  return Response.json({ approvedBasket: lineItems as BasketLine[], quote, withinHardLimit: quote.totalPaise <= maxSpendPaise, approvalRequired: true });
}
