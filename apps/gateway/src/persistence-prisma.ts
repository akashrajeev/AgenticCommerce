import type { AuditEvent, MerchantOffer, Transaction } from "@mandate/types";
import { getPrisma } from "./prisma.js";
import {
  claimWebhookEvent as claimWebhookEventSql,
  releaseWebhookEvent as releaseWebhookEventSql,
  saveAuditEvent as saveAuditEventSql,
  saveTransaction as saveTransactionSql,
} from "./persistence.js";

function jsonValue<T>(value: T) {
  return JSON.parse(JSON.stringify(value));
}

export type PersistedNegotiationAcceptance = {
  key: string;
  negotiationId: string;
  mandateId: string;
  offer: MerchantOffer;
  transactionId: string;
  executionId: string;
  authorizationId: string;
  createdAt: string;
};

async function ensureNegotiationAcceptanceTable(prisma: Awaited<ReturnType<typeof getPrisma>>): Promise<void> {
  if (!prisma) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS negotiation_acceptances (
    key TEXT PRIMARY KEY,
    negotiation_id TEXT NOT NULL,
    mandate_id TEXT NOT NULL,
    offer JSONB NOT NULL,
    transaction_id TEXT NOT NULL UNIQUE,
    execution_id TEXT NOT NULL,
    authorization_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  )`);
}

export async function saveTransaction(transaction: Transaction): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return saveTransactionSql(transaction);

  const data = {
    state: transaction.state,
    intent: jsonValue(transaction.intent),
    quote: jsonValue(transaction.quote),
    policy: transaction.policy === undefined ? undefined : jsonValue(transaction.policy),
    mandateAuthorization:
      transaction.mandateAuthorization === undefined ? undefined : jsonValue(transaction.mandateAuthorization),
    razorpayOrderId: transaction.razorpayOrderId ?? undefined,
    razorpayPaymentId: transaction.razorpayPaymentId ?? undefined,
    createdAt: new Date(transaction.createdAt),
    updatedAt: new Date(transaction.updatedAt),
  };

  await prisma.transaction.upsert({
    where: { id: transaction.id },
    create: { id: transaction.id, ...data },
    update: data,
  });
}

export async function saveAuditEvent(event: AuditEvent): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return saveAuditEventSql(event);

  await prisma.auditEvent.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      transactionId: event.transactionId,
      actor: event.actor,
      action: event.action,
      reason: event.reason,
      metadata: event.metadata === undefined ? undefined : jsonValue(event.metadata),
      createdAt: new Date(event.createdAt),
    },
    update: {},
  });
}

export async function claimWebhookEvent(input: {
  dedupeKey: string;
  eventName: string;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
}): Promise<boolean> {
  const prisma = await getPrisma();
  if (!prisma) return claimWebhookEventSql(input);

  try {
    await prisma.webhookEvent.create({
      data: {
        dedupeKey: input.dedupeKey,
        eventName: input.eventName,
        razorpayOrderId: input.razorpayOrderId ?? undefined,
        razorpayPaymentId: input.razorpayPaymentId ?? undefined,
        receivedAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

export async function releaseWebhookEvent(dedupeKey: string): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return releaseWebhookEventSql(dedupeKey);
  await prisma.webhookEvent.deleteMany({ where: { dedupeKey } });
}

export async function saveNegotiationAcceptance(input: PersistedNegotiationAcceptance): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;
  await ensureNegotiationAcceptanceTable(prisma);
  await prisma.negotiationAcceptance.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      negotiationId: input.negotiationId,
      mandateId: input.mandateId,
      offer: jsonValue(input.offer),
      transactionId: input.transactionId,
      executionId: input.executionId,
      authorizationId: input.authorizationId,
      createdAt: new Date(input.createdAt),
    },
    update: {
      offer: jsonValue(input.offer),
      transactionId: input.transactionId,
      executionId: input.executionId,
      authorizationId: input.authorizationId,
    },
  });
}

export async function loadNegotiationAcceptances(): Promise<PersistedNegotiationAcceptance[]> {
  const prisma = await getPrisma();
  if (!prisma) return [];
  await ensureNegotiationAcceptanceTable(prisma);
  const rows = await prisma.negotiationAcceptance.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((row) => ({
    key: row.key,
    negotiationId: row.negotiationId,
    mandateId: row.mandateId,
    offer: row.offer as unknown as MerchantOffer,
    transactionId: row.transactionId,
    executionId: row.executionId,
    authorizationId: row.authorizationId,
    createdAt: row.createdAt.toISOString(),
  }));
}
