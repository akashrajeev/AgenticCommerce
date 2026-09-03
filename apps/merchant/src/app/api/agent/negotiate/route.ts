import type { MerchantOffer } from "@mandate/types";
import { buildQuote, MERCHANT_ID, catalog } from "../../../../lib/catalog";
import { cleanupExpiredNegotiations, saveNegotiation } from "../../../../lib/agent-negotiation";

type NegotiationRequest = {
  intentId?: unknown;
  buyerAgentId?: unknown;
  purpose?: unknown;
  maxSpendPaise?: unknown;
  category?: unknown;
  requestedProductIds?: unknown;
  sourceProtocol?: unknown;
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const merchantAgent = {
  agentId: "merchant-agent:mandate-market",
  agentType: "merchant" as const,
  name: "Mandate Market Merchant Agent",
  issuer: "mandate-market",
};

function inferCategory(purpose: string): string | undefined {
  const normalized = purpose.toLowerCase();
  const categories = ["headphones", "keyboards", "mice", "monitors", "webcams", "smartwatches"];
  return categories.find((category) => normalized.includes(category.slice(0, -1)) || normalized.includes(category));
}

function inferProductIds(purpose: string): string[] {
  const normalized = purpose.toLowerCase();
  return catalog.filter((product) => normalized.includes(product.id) || normalized.includes(product.name.toLowerCase())).map((product) => product.id);
}

function rankCandidates(products: typeof catalog, maxSpendPaise: number) {
  return products.filter((product) => product.inventory > 0).map((product) => {
    let score = product.rating * 20 + Math.min(product.reviewCount / 100, 20);
    score += Math.min(Math.max(0, maxSpendPaise - product.pricePaise) / 100_000, 8);
    if (product.tags.includes("premium")) score += 2;
    return { product, score };
  }).sort((a, b) => b.score - a.score);
}

export function OPTIONS() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  cleanupExpiredNegotiations();
  const { id } = await context.params;
  const negotiation = (await import("../../../../lib/agent-negotiation")).getStoredNegotiation(id);
  if (!negotiation) return Response.json({ error: "NEGOTIATION_NOT_FOUND" }, { status: 404, headers: corsHeaders });
  return Response.json(negotiation, { headers: { ...corsHeaders, "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  cleanupExpiredNegotiations();
  const body = await request.json().catch(() => null) as NegotiationRequest | null;
  const intentId = typeof body?.intentId === "string" && body.intentId.trim() ? body.intentId.trim() : `intent_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const buyerAgentId = typeof body?.buyerAgentId === "string" ? body.buyerAgentId.trim() : "buyer-agent:mandate-demo";
  const purpose = typeof body?.purpose === "string" ? body.purpose.trim() : "";
  const maxSpendPaise = typeof body?.maxSpendPaise === "number" ? body.maxSpendPaise : NaN;
  if (!purpose || !Number.isSafeInteger(maxSpendPaise) || maxSpendPaise <= 0) return Response.json({ error: "INVALID_NEGOTIATION_REQUEST" }, { status: 400, headers: corsHeaders });

  const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : inferCategory(purpose);
  const requestedProductIds = Array.isArray(body?.requestedProductIds) && body.requestedProductIds.every((value) => typeof value === "string") ? body.requestedProductIds as string[] : inferProductIds(purpose);
  const sourceProtocol = body?.sourceProtocol === "acp" || body?.sourceProtocol === "ap2" || body?.sourceProtocol === "uap" || body?.sourceProtocol === "x402" ? body.sourceProtocol : "mandate-native";
  const candidateProducts = catalog.filter((product) => requestedProductIds.length ? requestedProductIds.includes(product.id) : !category || product.category === category);
  const offers: MerchantOffer[] = [];
  for (const { product } of rankCandidates(candidateProducts, maxSpendPaise)) {
    let quote;
    try { quote = buildQuote(product, 1); } catch { continue; }
    if (quote.totalPaise > maxSpendPaise) continue;
    offers.push({
      offerId: `offer_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
      intentId,
      merchantId: MERCHANT_ID,
      items: quote.lineItems,
      amount: { currency: "INR", amountPaise: quote.totalPaise },
      quoteId: quote.quoteId,
      conditions: { fulfillment: "standard", priceLockedMinutes: 5, inventoryAvailable: product.inventory, offerType: "single_item" },
      sourceProtocol,
      createdAt: new Date().toISOString(),
      expiresAt: quote.expiresAt,
    });
    if (offers.length >= 3) break;
  }
  if (!offers.length) return Response.json({ error: "MERCHANT_AGENT_NO_ELIGIBLE_OFFER" }, { status: 422, headers: corsHeaders });

  const negotiationId = `neg_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const createdAt = new Date().toISOString();
  const expiresAt = offers.reduce((earliest, offer) => offer.expiresAt < earliest ? offer.expiresAt : earliest, offers[0]!.expiresAt);
  const turns = [
    { turnId: `turn_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, actor: "buyer_agent" as const, type: "intent" as const, message: `${buyerAgentId || "buyer-agent:mandate-demo"} asks the merchant agent to satisfy: ${purpose} within ₹${(maxSpendPaise / 100).toFixed(2)}.`, createdAt },
    ...offers.map((offer) => ({ turnId: `turn_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, actor: "merchant_agent" as const, type: "offer" as const, offerId: offer.offerId, message: `Merchant agent offers ${offer.items.map((item) => item.productId).join(", ")} at ₹${(offer.amount.amountPaise / 100).toFixed(2)} using quote ${offer.quoteId}.`, createdAt: new Date().toISOString() })),
  ];
  const intent = { intentId, buyer: { agentId: buyerAgentId || "buyer-agent:mandate-demo", agentType: "buyer" as const, name: "MANDATE Buyer Agent" }, merchantId: MERCHANT_ID, purpose, items: offers[0]!.items.map((item) => ({ productId: item.productId, quantity: item.quantity })), maxSpend: { currency: "INR" as const, amountPaise: maxSpendPaise }, currency: "INR" as const, constraints: { category: category ?? null }, sourceProtocol, createdAt, expiresAt };
  saveNegotiation({ negotiationId, intent, merchant: merchantAgent, offers, turns, createdAt, expiresAt });
  return Response.json({ negotiationId, intent, merchant: merchantAgent, offers, turns }, { headers: { ...corsHeaders, "cache-control": "no-store" } });
}
