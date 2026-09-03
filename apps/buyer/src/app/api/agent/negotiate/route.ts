import type { MerchantOffer, NegotiationSession, NegotiationTurn } from "@mandate/types";

type MerchantResponse = {
  negotiationId: string;
  intent: NegotiationSession["intent"];
  merchant: NegotiationSession["merchant"];
  offers: MerchantOffer[];
  turns: NegotiationTurn[];
};

type Product = {
  id: string;
  name: string;
  rating: number;
  reviewCount: number;
  inventory: number;
};

const merchantInternalUrl = process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000";

function inferCategory(purpose: string): string | undefined {
  const normalized = purpose.toLowerCase();
  const categories = ["headphones", "keyboards", "mice", "monitors", "webcams", "smartwatches"];
  return categories.find((category) => normalized.includes(category.slice(0, -1)) || normalized.includes(category));
}

async function fetchProduct(productId: string): Promise<Product | null> {
  const response = await fetch(`${merchantInternalUrl}/api/agent/products/${encodeURIComponent(productId)}`, { cache: "no-store" });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as { product?: Product } | null;
  return body?.product ?? null;
}

function scoreOffer(offer: MerchantOffer, product: Product | null, maxSpendPaise: number, purpose: string): number {
  if (!product) return -Infinity;
  const normalized = purpose.toLowerCase();
  const budgetMode = normalized.includes("cheap") || normalized.includes("budget") || normalized.includes("lowest");
  const priceFraction = offer.amount.amountPaise / maxSpendPaise;
  const quality = product.rating * 25 + Math.min(product.reviewCount / 100, 20);
  const valuePreference = budgetMode ? (1 - priceFraction) * 35 : (1 - priceFraction) * 12;
  return quality + valuePreference;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { request?: unknown; maxSpendPaise?: unknown; requestedProductIds?: unknown; sourceProtocol?: unknown } | null;
  const purpose = typeof body?.request === "string" ? body.request.trim() : "";
  const maxSpendPaise = typeof body?.maxSpendPaise === "number" ? body.maxSpendPaise : NaN;
  if (!purpose || !Number.isSafeInteger(maxSpendPaise) || maxSpendPaise <= 0) return Response.json({ error: "INVALID_BUYER_NEGOTIATION_REQUEST" }, { status: 400 });

  const requestedProductIds = Array.isArray(body?.requestedProductIds) && body.requestedProductIds.every((value) => typeof value === "string")
    ? body.requestedProductIds as string[]
    : undefined;
  const sourceProtocol = body?.sourceProtocol === "acp" || body?.sourceProtocol === "ap2" || body?.sourceProtocol === "uap" || body?.sourceProtocol === "x402" ? body.sourceProtocol : "mandate-native";
  const response = await fetch(`${merchantInternalUrl}/api/agent/negotiate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intentId: `intent_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
      buyerAgentId: "buyer-agent:mandate-demo",
      purpose,
      maxSpendPaise,
      category: inferCategory(purpose),
      requestedProductIds,
      sourceProtocol,
    }),
    cache: "no-store",
  });
  const merchantBody = await response.json().catch(() => null) as MerchantResponse & { error?: string } | null;
  if (!response.ok || !merchantBody?.offers?.length) return Response.json({ error: merchantBody?.error ?? "MERCHANT_AGENT_FOUND_NO_OFFER" }, { status: response.status || 422 });

  const scored = await Promise.all(merchantBody.offers.map(async (offer) => {
    const productId = offer.items[0]?.productId ?? "";
    return { offer, product: await fetchProduct(productId) };
  }));
  const best = [...scored].sort((a, b) => scoreOffer(b.offer, b.product, maxSpendPaise, purpose) - scoreOffer(a.offer, a.product, maxSpendPaise, purpose))[0];
  if (!best) return Response.json({ error: "BUYER_AGENT_CANNOT_EVALUATE_OFFERS" }, { status: 502 });

  const selectedOfferId = best.offer.offerId;
  const selectedProduct = best.product;
  const selectionTurn: NegotiationTurn = {
    turnId: `turn_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    actor: "buyer_agent",
    type: "selection",
    offerId: selectedOfferId,
    message: `Buyer agent selects ${selectedProduct?.name ?? selectedOfferId} at ₹${(best.offer.amount.amountPaise / 100).toFixed(2)} because it best balances the stated requirement, merchant evidence and the hard budget.`,
    createdAt: new Date().toISOString(),
  };

  return Response.json({
    negotiationId: merchantBody.negotiationId,
    intent: merchantBody.intent,
    merchant: merchantBody.merchant,
    offers: merchantBody.offers,
    selectedOfferId,
    selectedOffer: best.offer,
    turns: [...merchantBody.turns, selectionTurn],
    status: "proposed" as const,
    buyer: {
      agentId: "buyer-agent:mandate-demo",
      agentType: "buyer" as const,
      name: "MANDATE Buyer Agent",
      selectionReason: selectionTurn.message,
    },
  });
}
