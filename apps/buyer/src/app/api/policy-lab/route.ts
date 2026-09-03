import { NextResponse } from "next/server";

const MERCHANT_INTERNAL_URL = process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000";
const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
const merchantId = "mandate-market";
const basket = [
  { productId: "hp-001", quantity: 1 },
  { productId: "ms-001", quantity: 1 },
];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { maxSpendPaise?: unknown } | null;
  const maxSpendPaise = typeof body?.maxSpendPaise === "number" ? body.maxSpendPaise : NaN;
  if (!Number.isSafeInteger(maxSpendPaise) || maxSpendPaise < 0) {
    return NextResponse.json({ error: "INVALID_SPEND_LIMIT" }, { status: 400 });
  }

  try {
    const quoteResponse = await fetch(`${MERCHANT_INTERNAL_URL}/api/agent/checkout/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineItems: basket }),
      cache: "no-store",
    });
    const quoteBody = (await quoteResponse.json().catch(() => null)) as { quote?: unknown; error?: string } | null;
    if (!quoteResponse.ok || !quoteBody?.quote) {
      return NextResponse.json({ error: quoteBody?.error ?? "MERCHANT_QUOTE_FAILED" }, { status: 502 });
    }

    const quote = quoteBody.quote as {
      quoteId: string;
      totalPaise: number;
      lineItems: Array<{ productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }>;
      expiresAt: string;
    };
    const firstLine = quote.lineItems[0];
    if (!firstLine) return NextResponse.json({ error: "EMPTY_DEMO_BASKET" }, { status: 502 });

    const transactionResponse = await fetch(`${GATEWAY_INTERNAL_URL}/v1/purchase-intents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        merchantId,
        productId: firstLine.productId,
        quantity: firstLine.quantity,
        lineItems: basket,
        maxSpendPaise,
        reason: "Judge policy boundary demo: headphones plus a complementary mouse",
        quoteId: quote.quoteId,
      }),
      cache: "no-store",
    });
    const transactionBody = (await transactionResponse.json().catch(() => null)) as { transaction?: unknown; error?: string } | null;
    if (!transactionResponse.ok || !transactionBody?.transaction) {
      return NextResponse.json({ error: transactionBody?.error ?? "GATEWAY_POLICY_FAILED", quote }, { status: 422 });
    }

    return NextResponse.json({
      quote,
      transaction: transactionBody.transaction,
      scenario: maxSpendPaise < quote.totalPaise ? "BLOCKED" : "RECOVERY_AUTHORIZED",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "POLICY_LAB_UNAVAILABLE" }, { status: 502 });
  }
}
