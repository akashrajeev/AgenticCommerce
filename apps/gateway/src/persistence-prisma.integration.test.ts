import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEvent, CheckoutQuote, PurchaseIntent, Transaction } from "@mandate/types";
import { closePersistence, initializePersistence } from "./persistence.js";
import {
  claimWebhookEvent,
  releaseWebhookEvent,
  saveAuditEvent,
  saveTransaction,
} from "./persistence-prisma.js";
import { closePrisma, getPrisma } from "./prisma.js";

test("persists financial records and webhook idempotency through Prisma", { skip: !process.env.DATABASE_URL }, async () => {
  await initializePersistence();
  const prisma = await getPrisma();
  assert.ok(prisma, "DATABASE_URL should initialize Prisma");

  const transactionId = `it_tx_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const auditId = `it_audit_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const webhookKey = `it_webhook_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const now = new Date().toISOString();
  const intent: PurchaseIntent = {
    id: `intent_${transactionId}`,
    merchantId: "mandate-market",
    productId: "hp-001",
    quantity: 1,
    maxSpendPaise: 500000,
    reason: "Prisma persistence integration smoke test",
    quoteId: `quote_${transactionId}`,
  };
  const quote: CheckoutQuote = {
    quoteId: intent.quoteId,
    merchantId: intent.merchantId,
    lineItems: [{ productId: intent.productId, quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 }],
    subtotalPaise: 399900,
    shippingPaise: 0,
    taxPaise: 0,
    discountPaise: 0,
    totalPaise: 399900,
    currency: "INR",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const transaction: Transaction = {
    id: transactionId,
    state: "policy_authorized",
    intent,
    quote,
    policy: {
      decision: "ALLOW",
      checks: [],
      evaluatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
  const auditEvent: AuditEvent = {
    id: auditId,
    transactionId,
    actor: "gateway",
    action: "PRISMA_INTEGRATION_TEST",
    reason: "Verify durable audit persistence",
    metadata: { source: "integration-test" },
    createdAt: now,
  };

  try {
    await saveTransaction(transaction);
    const persistedTransaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
    assert.equal(persistedTransaction?.state, "policy_authorized");
    assert.equal(persistedTransaction?.razorpayOrderId, null);

    await saveAuditEvent(auditEvent);
    const persistedAudit = await prisma.auditEvent.findUnique({ where: { id: auditId } });
    assert.equal(persistedAudit?.transactionId, transactionId);
    assert.equal(persistedAudit?.action, auditEvent.action);

    assert.equal(await claimWebhookEvent({ dedupeKey: webhookKey, eventName: "payment.captured" }), true);
    assert.equal(await claimWebhookEvent({ dedupeKey: webhookKey, eventName: "payment.captured" }), false);

    const webhookRow = await prisma.webhookEvent.findUnique({ where: { dedupeKey: webhookKey } });
    assert.equal(webhookRow?.eventName, "payment.captured");

    await releaseWebhookEvent(webhookKey);
    assert.equal(await prisma.webhookEvent.findUnique({ where: { dedupeKey: webhookKey } }), null);
    assert.equal(await claimWebhookEvent({ dedupeKey: webhookKey, eventName: "payment.captured" }), true);
  } finally {
    await prisma.webhookEvent.deleteMany({ where: { dedupeKey: webhookKey } });
    await prisma.auditEvent.deleteMany({ where: { id: auditId } });
    await prisma.transaction.deleteMany({ where: { id: transactionId } });
    await closePersistence();
    await closePrisma();
  }
});
