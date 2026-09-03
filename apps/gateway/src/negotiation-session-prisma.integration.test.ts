import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantOffer } from "@mandate/types";
import { closePrisma, getPrisma } from "./prisma.js";
import { deleteNegotiationSession, loadNegotiationSession, saveNegotiationSession } from "./persistence-prisma.js";

test("persists and restores complete negotiation sessions through Prisma", { skip: !process.env.DATABASE_URL }, async () => {
  const prisma = await getPrisma();
  assert.ok(prisma, "DATABASE_URL should initialize Prisma");

  const negotiationId = `it_session_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const now = new Date().toISOString();
  const offer: MerchantOffer = {
    offerId: `offer_${negotiationId}`,
    intentId: `intent_${negotiationId}`,
    merchantId: "mandate-market",
    items: [{ productId: "hp-001", quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 }],
    amount: { currency: "INR", amountPaise: 399900 },
    quoteId: `quote_${negotiationId}`,
    conditions: { fulfillment: "standard" },
    sourceProtocol: "mandate-native",
    createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const session = {
    negotiationId,
    intent: { intentId: offer.intentId, purpose: "integration smoke" },
    merchant: { agentId: "merchant-agent:mandate-market", agentType: "merchant" as const, name: "Mandate Market Merchant Agent", issuer: "mandate-market" },
    offers: [offer],
    offerAttestations: [],
    turns: [{ turnId: "turn_1", actor: "merchant_agent", type: "offer", offerId: offer.offerId }],
    createdAt: now,
    expiresAt: offer.expiresAt,
  };

  try {
    await saveNegotiationSession(session);
    const restored = await loadNegotiationSession(negotiationId);
    assert.ok(restored);
    assert.equal(restored.negotiationId, negotiationId);
    assert.equal(restored.offers[0]?.offerId, offer.offerId);
    assert.equal(restored.offers[0]?.amount.amountPaise, 399900);
    assert.equal(restored.turns[0]?.offerId, offer.offerId);
  } finally {
    await deleteNegotiationSession(negotiationId);
    await closePrisma();
  }
});
