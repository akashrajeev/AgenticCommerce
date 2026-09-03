import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantOffer } from "@mandate/types";
import { closePrisma, getPrisma } from "./prisma.js";
import {
  loadNegotiationAcceptances,
  saveNegotiationAcceptance,
  type PersistedNegotiationAcceptance,
} from "./persistence-prisma.js";

test("persists negotiated acceptance idempotency state through Prisma", { skip: !process.env.DATABASE_URL }, async () => {
  const prisma = await getPrisma();
  assert.ok(prisma, "DATABASE_URL should initialize Prisma");

  const key = `it_neg_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const now = new Date().toISOString();
  const offer: MerchantOffer = {
    offerId: `offer_${key}`,
    intentId: `intent_${key}`,
    merchantId: "mandate-market",
    items: [{ productId: "hp-001", quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 }],
    amount: { currency: "INR", amountPaise: 399900 },
    quoteId: `quote_${key}`,
    conditions: { fulfillment: "standard" },
    sourceProtocol: "mandate-native",
    createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const record: PersistedNegotiationAcceptance = {
    key,
    negotiationId: `neg_${key}`,
    mandateId: `mandate_${key}`,
    offer,
    transactionId: `tx_${key}`,
    executionId: `exec_${key}`,
    authorizationId: `auth_${key}`,
    createdAt: now,
  };

  try {
    await saveNegotiationAcceptance(record);
    const persisted = await prisma.negotiationAcceptance.findUnique({ where: { key } });
    assert.equal(persisted?.negotiationId, record.negotiationId);
    assert.equal(persisted?.mandateId, record.mandateId);
    assert.equal(persisted?.transactionId, record.transactionId);
    assert.equal(persisted?.executionId, record.executionId);
    assert.equal(persisted?.authorizationId, record.authorizationId);

    const restored = await loadNegotiationAcceptances();
    const hydrated = restored.find((item) => item.key === key);
    assert.ok(hydrated);
    assert.equal(hydrated.offer.offerId, offer.offerId);
    assert.equal(hydrated.offer.amount.amountPaise, offer.amount.amountPaise);
    assert.equal(hydrated.offer.quoteId, offer.quoteId);
  } finally {
    await prisma.negotiationAcceptance.deleteMany({ where: { key } });
    await closePrisma();
  }
});
