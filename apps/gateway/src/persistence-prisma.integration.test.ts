import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEvent, CheckoutQuote, PurchaseIntent, Transaction } from "@mandate/types";
import { closePersistence, initializePersistence } from "./persistence.js";
import {
  claimWebhookEvent,
  deleteGrowthAgentRun,
  loadCampaignPaymentEvidence,
  loadGrowthAgentRun,
  releaseWebhookEvent,
  saveAuditEvent,
  saveCampaignPaymentEvidence,
  saveGrowthAgentCheckpoint,
  saveTransaction,
  type PersistedGrowthAgentRun,
  type PersistedGrowthAgentTraceStep,
} from "./persistence-prisma.js";
import { loadPrismaGatewayState } from "./persistence-prisma-read.js";
import { closePrisma, getPrisma } from "./prisma.js";
import { getTimeline, getTransaction, hydrateTransactionStore } from "./transaction-core.js";

test("persists financial records and webhook idempotency through Prisma", { skip: !process.env.DATABASE_URL }, async () => {
  await initializePersistence();
  const prisma = await getPrisma();
  assert.ok(prisma, "DATABASE_URL should initialize Prisma");

  const transactionId = `it_tx_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const auditId = `it_audit_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const webhookKey = `it_webhook_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const evidenceId = `it_evidence_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
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
    policy: { decision: "ALLOW", checks: [], evaluatedAt: now },
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

    await saveCampaignPaymentEvidence({
      evidenceId,
      campaignId: "it-campaign",
      transactionId,
      razorpayOrderId: `order_test_${transactionId}`,
      razorpayPaymentId: `pay_test_${transactionId}`,
      amountPaise: 399900,
      currency: "INR",
      orderNotes: { growth_campaign_id: "it-campaign", source: "integration-test" },
      verifiedAt: now,
    });
    const evidenceRows = await loadCampaignPaymentEvidence("it-campaign");
    const persistedEvidence = evidenceRows.find((row: (typeof evidenceRows)[number]) => row.evidenceId === evidenceId);
    assert.equal(persistedEvidence?.transactionId, transactionId);
    assert.equal(persistedEvidence?.amountPaise, 399900);

    const restored = await loadPrismaGatewayState();
    const restoredTransaction = restored.transactions.find((item) => item.id === transactionId);
    assert.equal(restoredTransaction?.state, "policy_authorized");
    assert.equal(restored.auditEvents.some((event) => event.id === auditId), true);

    hydrateTransactionStore(restored);
    assert.equal(getTransaction(transactionId)?.state, "policy_authorized");
    assert.equal(getTimeline(transactionId).some((event) => event.id === auditId), true);

    const growthRunId = `it_gar_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const growthCreatedAt = new Date().toISOString();
    const growthStep: PersistedGrowthAgentTraceStep = {
      step: 1,
      state: "EVALUATING",
      tool: "inspect_inventory",
      reason: "Verify current inventory",
      status: "succeeded",
      input: { campaignId: "it-growth-campaign" },
      output: { source: { productId: "hp-001", inventory: 4 } },
      callId: "call-test-1",
      plannerModel: "test-planner",
      startedAt: growthCreatedAt,
      completedAt: growthCreatedAt,
      durationMs: 2,
    };
    const growthRun: PersistedGrowthAgentRun = {
      id: growthRunId,
      objective: "Increase basket value for test campaign",
      campaignId: "it-growth-campaign",
      maxSpendPaise: 800000,
      maxSteps: 8,
      state: "EVALUATING",
      stepCount: 1,
      plannerCalls: 1,
      plannerModel: "test-planner",
      selectedOpportunity: { sourceProductId: "hp-001", targetProductId: "case-001", score: 0.91 },
      preparedOffer: undefined,
      trace: [growthStep],
      createdAt: growthCreatedAt,
      updatedAt: growthCreatedAt,
    };
    await saveGrowthAgentCheckpoint({ run: growthRun, step: growthStep });
    const restoredGrowthRun = await loadGrowthAgentRun(growthRunId);
    assert.ok(restoredGrowthRun);
    assert.equal(restoredGrowthRun.id, growthRunId);
    assert.equal(restoredGrowthRun.state, "EVALUATING");
    assert.equal(restoredGrowthRun.plannerCalls, 1);
    assert.equal(restoredGrowthRun.trace.length, 1);
    assert.equal(restoredGrowthRun.trace[0]?.tool, "inspect_inventory");
    assert.equal(restoredGrowthRun.trace[0]?.callId, "call-test-1");

    assert.equal(await claimWebhookEvent({ dedupeKey: webhookKey, eventName: "payment.captured" }), true);
    assert.equal(await claimWebhookEvent({ dedupeKey: webhookKey, eventName: "payment.captured" }), false);

    const webhookRow = await prisma.webhookEvent.findUnique({ where: { dedupeKey: webhookKey } });
    assert.equal(webhookRow?.eventName, "payment.captured");

    await releaseWebhookEvent(webhookKey);
    assert.equal(await prisma.webhookEvent.findUnique({ where: { dedupeKey: webhookKey } }), null);
    assert.equal(await claimWebhookEvent({ dedupeKey: webhookKey, eventName: "payment.captured" }), true);

    await deleteGrowthAgentRun(growthRunId);
    assert.equal(await loadGrowthAgentRun(growthRunId), undefined);
  } finally {
    hydrateTransactionStore({ transactions: [], auditEvents: [] });
    await prisma.webhookEvent.deleteMany({ where: { dedupeKey: webhookKey } });
    await prisma.auditEvent.deleteMany({ where: { id: auditId } });
    await prisma.campaignPaymentEvidence.deleteMany({ where: { evidenceId } });
    await prisma.growthAgentStep.deleteMany({ where: { runId: { startsWith: "it_gar_" } } });
    await prisma.growthAgentRun.deleteMany({ where: { id: { startsWith: "it_gar_" } } });
    await prisma.transaction.deleteMany({ where: { id: transactionId } });
    await closePersistence();
    await closePrisma();
  }
});
