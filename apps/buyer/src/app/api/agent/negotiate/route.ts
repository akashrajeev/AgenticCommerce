import type { MerchantOffer, NegotiationSession, NegotiationTurn } from "@mandate/types";
import { planBuyerIntent, type BuyerIntentPlan } from "@mandate/shared";

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
  category?: string;
  tags?: string[];
  rating: number;
  reviewCount: number;
  inventory: number;
};

const merchantInternalUrl = process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000";

async function fetchProduct(productId: string): Promise<Product | null> {
  const response = await fetch(`${merchantInternalUrl}/api/agent/products/${encodeURIComponent(productId)}`, { cache: "no-store" });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as { product?: Product } | null;
  return body?.product ?? null;
}

function keywordMatchScore(product: Product, plan: BuyerIntentPlan): number {
  if (!plan.keywords.length) return 0;
  const searchable = `${product.name} ${product.category ?? ""} ${(product.tags ?? []).join(" ")}`.toLowerCase();
  const matches = plan.keywords.filter((keyword) => searchable.includes(keyword)).length;
  return matches * 12;
}

function scoreOffer(offer: MerchantOffer, product: Product | null, plan: BuyerIntentPlan): number {
  if (!product) return -Infinity;
  const maxSpendPaise = plan.budgetCeilingPaise;
  const priceFraction = offer.amount.amountPaise / maxSpendPaise;
  const quality = product.rating * 25 + Math.min(product.reviewCount / 100, 20);
  const valuePreference = plan.priority === "value"
    ? (1 - priceFraction) * 40
    : plan.priority === "quality"
      ? (1 - priceFraction) * 8
      : (1 - priceFraction) * 18;
  return quality + valuePreference + keywordMatchScore(product, plan);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { request?: unknown; maxSpendPaise?: unknown; requestedProductIds?: unknown; sourceProtocol?: unknown } | null;
  const purpose = typeof body?.request === "string" ? body.request.trim() : "";
  const maxSpendPaise = typeof body?.maxSpendPaise === "number" ? body.maxSpendPaise : NaN;
  if (!purpose || !Number.isSafeInteger(maxSpendPaise) || maxSpendPaise <= 0) return Response.json({ error: "INVALID_BUYER_NEGOTIATION_REQUEST" }, { status: 400 });

  const intentPlan = await planBuyerIntent(purpose, maxSpendPaise);
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
      maxSpendPaise: intentPlan.budgetCeilingPaise,
      category: intentPlan.category,
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
  const ranked = [...scored].sort((a, b) => scoreOffer(b.offer, b.product, intentPlan) - scoreOffer(a.offer, a.product, intentPlan));
  const best = ranked[0];
  if (!best || !Number.isFinite(scoreOffer(best.offer, best.product, intentPlan))) return Response.json({ error: "BUYER_AGENT_CANNOT_EVALUATE_OFFERS" }, { status: 502 });

  const selectedOfferId = best.offer.offerId;
  const selectedProduct = best.product;
  const keywordSummary = intentPlan.keywords.slice(0, 4).join(", ");
  const selectionTurn: NegotiationTurn = {
    turnId: `turn_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    actor: "buyer_agent",
    type: "selection",
    offerId: selectedOfferId,
    message: `Buyer agent selects ${selectedProduct?.name ?? selectedOfferId} at ₹${(best.offer.amount.amountPaise / 100).toFixed(2)} using the constrained ${intentPlan.priority} plan${intentPlan.category ? ` for ${intentPlan.category}` : ""}${keywordSummary ? ` with keywords [${keywordSummary}]` : ""}. The hard ceiling remains ₹${(intentPlan.budgetCeilingPaise / 100).toFixed(2)}.`,
    createdAt: new Date().toISOString(),
  };

  return Response.json({
    negotiationId: merchantBody.negotiationId,
    intent: merchantBody.intent,
    intentPlan,
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
