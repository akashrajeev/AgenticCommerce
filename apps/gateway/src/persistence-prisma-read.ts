import type { AuditEvent, Transaction } from "@mandate/types";
import { getPrisma } from "./prisma.js";

export type PersistedGatewayState = {
  transactions: Transaction[];
  auditEvents: AuditEvent[];
};

export async function loadPrismaGatewayState(): Promise<PersistedGatewayState> {
  const prisma = await getPrisma();
  if (!prisma) return { transactions: [], auditEvents: [] };

  const [transactionRows, auditRows] = await Promise.all([
    prisma.transaction.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.auditEvent.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const transactions: Transaction[] = transactionRows.map((row) => ({
    id: row.id,
    state: row.state as Transaction["state"],
    intent: row.intent as unknown as Transaction["intent"],
    quote: row.quote as unknown as Transaction["quote"],
    policy: row.policy === null ? undefined : row.policy as unknown as Transaction["policy"],
    mandateAuthorization:
      row.mandateAuthorization === null
        ? undefined
        : row.mandateAuthorization as unknown as Transaction["mandateAuthorization"],
    razorpayOrderId: row.razorpayOrderId ?? undefined,
    razorpayPaymentId: row.razorpayPaymentId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  const auditEvents: AuditEvent[] = auditRows.map((row) => ({
    id: row.id,
    transactionId: row.transactionId,
    actor: row.actor as AuditEvent["actor"],
    action: row.action,
    reason: row.reason,
    metadata: row.metadata === null ? undefined : row.metadata as unknown as AuditEvent["metadata"],
    createdAt: row.createdAt.toISOString(),
  }));

  return { transactions, auditEvents };
}
