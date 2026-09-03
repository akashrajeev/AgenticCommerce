import assert from "node:assert/strict";
import test from "node:test";
import { clearNegotiationAcceptanceStore, acceptNegotiatedOffer } from "./negotiation.js";
import { clearDelegatedMandateStore, createDelegatedMandate } from "./delegated-mandates.js";
import type { CheckoutQuote, MerchantOffer, Product } from "@mandate/types";

function product(id = "hp-001"): Product {
  return { id, sku: id, name: "SoundMax Pro", slug: "soundmax-pro", category: "headphones", pricePaise: 399900, currency: "INR", rating: 4.6, reviewCount: 1842, inventory: 14, shortDescription: "Wireless ANC headphones.", description: "test", features: [], specifications: {}, tags: ["anc", "wireless"] };
}

function quote(): CheckoutQuote {
  const item = product();
  return { quoteId: "quote_negotiation_001", merchantId: "mandate-market", lineItems: [{ productId: item.id, quantity: 1, unitPricePaise: item.pricePaise, lineTotalPaise: item.pricePaise }], subtotalPaise: item.pricePaise, shippingPaise: 0, taxPaise: 71982, discountPaise: 0, totalPaise: 471882, currency: "INR", expiresAt: new Date(Date.now() + 60_000).toISOString() };
}

function offer(): MerchantOffer {
  const q = quote();
  return { offerId: "offer_negotiation_001", intentId: "intent_negotiation_001", merchantId: q.merchantId, items: q.lineItems, amount: { currency: "INR", amountPaise: q.totalPaise }, quoteId: q.quoteId, conditions: { fulfillment: "standard" }, sourceProtocol: "mandate-native", createdAt: new Date().toISOString(), expiresAt: q.expiresAt };
}

async function withMerchantFetch(fn: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const q = quote();
  const item = product();
  const merchantNegotiation = { negotiationId: "neg_001", offers: [offer()] };
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path.includes("/api/agent/negotiate/neg_001") || path.includes("/api/agent/negotiate/neg_002") || path.includes("/api/agent/negotiate/neg_003")) return new Response(JSON.stringify({ ...merchantNegotiation, negotiationId: path.includes("neg_002") ? "neg_002" : path.includes("neg_003") ? "neg_003" : "neg_001" }), { status: 200 });
    if (path.includes("/api/agent/checkout/quotes/")) return new Response(JSON.stringify({ quote: q }), { status: 200 });
    if (path.includes("/api/agent/products/")) return new Response(JSON.stringify({ product: item }), { status: 200 });
    if (path.includes("/api/agent/inventory/")) return new Response(JSON.stringify({ inventory: 14 }), { status: 200 });
    throw new Error(`Unexpected fetch: ${path}`);
  };
  try { await fn(); } finally { globalThis.fetch = originalFetch; }
}

test.beforeEach(() => { clearNegotiationAcceptanceStore(); clearDelegatedMandateStore(); });

test("accepts an authoritative merchant offer through a delegated mandate", async () => {
  await withMerchantFetch(async () => {
    const mandate = await createDelegatedMandate({ subjectId: "user_001", agentId: "buyer-agent:mandate-demo", purpose: "Negotiated headphones", merchantIds: ["mandate-market"], allowedProductIds: ["hp-001"], maxSpendPerPurchase: { currency: "INR", amountPaise: 500000 }, totalBudget: { currency: "INR", amountPaise: 1000000 }, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const result = await acceptNegotiatedOffer({ negotiationId: "neg_001", mandateId: mandate.mandateId, offer: offer() });
    assert.equal(result.replayed, false);
    assert.equal(result.transaction.state, "policy_authorized");
    assert.equal(result.transaction.quote.totalPaise, 471882);
  });
});

test("replays the same offer idempotently and rejects changed payloads", async () => {
  await withMerchantFetch(async () => {
    const mandate = await createDelegatedMandate({ subjectId: "user_001", agentId: "buyer-agent:mandate-demo", purpose: "Negotiated headphones", merchantIds: ["mandate-market"], allowedProductIds: ["hp-001"], maxSpendPerPurchase: { currency: "INR", amountPaise: 500000 }, totalBudget: { currency: "INR", amountPaise: 1000000 }, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const acceptedOffer = offer();
    const first = await acceptNegotiatedOffer({ negotiationId: "neg_002", mandateId: mandate.mandateId, offer: acceptedOffer });
    const replay = await acceptNegotiatedOffer({ negotiationId: "neg_002", mandateId: mandate.mandateId, offer: acceptedOffer });
    assert.equal(replay.replayed, true);
    assert.equal(replay.transactionId, first.transaction.id);

    const changed = { ...acceptedOffer, amount: { currency: "INR" as const, amountPaise: 481882 } };
    await assert.rejects(() => acceptNegotiatedOffer({ negotiationId: "neg_002", mandateId: mandate.mandateId, offer: changed }), /NEGOTIATION_IDEMPOTENCY_CONFLICT/);

    const attestationTamper = { ...acceptedOffer, amount: { currency: "INR" as const, amountPaise: 481882 } };
    await assert.rejects(() => acceptNegotiatedOffer({ negotiationId: "neg_003", mandateId: mandate.mandateId, offer: attestationTamper }), /NEGOTIATED_OFFER_ATTESTATION_MISMATCH/);
  });
});
