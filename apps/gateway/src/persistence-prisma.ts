import type { AuditEvent, MerchantOffer, MerchantOfferAttestation, Transaction } from "@mandate/types";
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

export type PersistedNegotiationSession = {
  negotiationId: string;
  intent: Record<string, unknown>;
  merchant: { agentId: string; agentType: "merchant"; name: string; issuer: string };
  offers: MerchantOffer[];
  offerAttestations?: MerchantOfferAttestation[];
  turns: Array<Record<string, unknown>>;
  createdAt: string;
  expiresAt: string;
};

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

export type PersistedCampaignPaymentEvidence = {
  evidenceId: string;
  campaignId: string;
  transactionId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountPaise: number;
  currency: string;
  orderNotes?: Record<string, string>;
  verifiedAt: string;
};

const NEGOTIATION_ACCEPTANCE_CLAIM_TTL_MS = 15 * 60 * 1000;

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

async function ensureNegotiationSessionTable(prisma: Awaited<ReturnType<typeof getPrisma>>): Promise<void> {
  if (!prisma) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS negotiation_sessions (
    negotiation_id TEXT PRIMARY KEY,
    intent JSONB NOT NULL,
    merchant JSONB NOT NULL,
    offers JSONB NOT NULL,
    offer_attestations JSONB,
    turns JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS negotiation_sessions_expires_at_idx ON negotiation_sessions(expires_at)`);
}

async function ensureNegotiationAcceptanceClaimTable(prisma: Awaited<ReturnType<typeof getPrisma>>): Promise<void> {
  if (!prisma) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS negotiation_acceptance_claims (
    key TEXT PRIMARY KEY,
    negotiation_id TEXT NOT NULL,
    mandate_id TEXT NOT NULL,
    offer_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS negotiation_acceptance_claims_created_at_idx ON negotiation_acceptance_claims(created_at)`);
}

async function ensureCampaignPaymentEvidenceTable(prisma: Awaited<ReturnType<typeof getPrisma>>): Promise<void> {
  if (!prisma) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS campaign_payment_evidence (
    evidence_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL UNIQUE,
    razorpay_order_id TEXT NOT NULL,
    razorpay_payment_id TEXT NOT NULL,
    amount_paise BIGINT NOT NULL,
    currency TEXT NOT NULL,
    order_notes JSONB,
    verified_at TIMESTAMPTZ NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`ALTER TABLE campaign_payment_evidence ADD COLUMN IF NOT EXISTS order_notes JSONB`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS campaign_payment_evidence_campaign_verified_idx ON campaign_payment_evidence(campaign_id, verified_at DESC)`);
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
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return false;
    throw error;
  }
}

export async function releaseWebhookEvent(dedupeKey: string): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return releaseWebhookEventSql(dedupeKey);
  await prisma.webhookEvent.deleteMany({ where: { dedupeKey } });
}

export async function saveNegotiationSession(input: PersistedNegotiationSession): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;
  await ensureNegotiationSessionTable(prisma);
  await prisma.negotiationSession.upsert({
    where: { negotiationId: input.negotiationId },
    create: {
      negotiationId: input.negotiationId,
      intent: jsonValue(input.intent),
      merchant: jsonValue(input.merchant),
      offers: jsonValue(input.offers),
      offerAttestations: input.offerAttestations === undefined ? undefined : jsonValue(input.offerAttestations),
      turns: jsonValue(input.turns),
      createdAt: new Date(input.createdAt),
      expiresAt: new Date(input.expiresAt),
    },
    update: {
      intent: jsonValue(input.intent),
      merchant: jsonValue(input.merchant),
      offers: jsonValue(input.offers),
      offerAttestations: input.offerAttestations === undefined ? undefined : jsonValue(input.offerAttestations),
      turns: jsonValue(input.turns),
      expiresAt: new Date(input.expiresAt),
    },
  });
}

export async function loadNegotiationSession(negotiationId: string): Promise<PersistedNegotiationSession | undefined> {
  const prisma = await getPrisma();
  if (!prisma) return undefined;
  await ensureNegotiationSessionTable(prisma);
  const row = await prisma.negotiationSession.findUnique({ where: { negotiationId } });
  if (!row || row.expiresAt.getTime() <= Date.now()) return undefined;
  return {
    negotiationId: row.negotiationId,
    intent: row.intent as Record<string, unknown>,
    merchant: row.merchant as PersistedNegotiationSession["merchant"],
    offers: row.offers as unknown as MerchantOffer[],
    offerAttestations: row.offerAttestations === null ? undefined : row.offerAttestations as unknown as MerchantOfferAttestation[],
    turns: row.turns as Array<Record<string, unknown>>,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function deleteNegotiationSession(negotiationId: string): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;
  await ensureNegotiationSessionTable(prisma);
  await prisma.negotiationSession.deleteMany({ where: { negotiationId } });
}

export async function claimNegotiationAcceptance(input: {
  key: string;
  negotiationId: string;
  mandateId: string;
  offerId: string;
}): Promise<boolean> {
  const prisma = await getPrisma();
  if (!prisma) return true;
  await ensureNegotiationAcceptanceClaimTable(prisma);

  const cutoff = new Date(Date.now() - NEGOTIATION_ACCEPTANCE_CLAIM_TTL_MS);
  await prisma.negotiationAcceptanceClaim.deleteMany({ where: { createdAt: { lt: cutoff } } });
  try {
    await prisma.negotiationAcceptanceClaim.create({
      data: {
        key: input.key,
        negotiationId: input.negotiationId,
        mandateId: input.mandateId,
        offerId: input.offerId,
        createdAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return false;
    throw error;
  }
}

export async function releaseNegotiationAcceptanceClaim(key: string): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;
  await ensureNegotiationAcceptanceClaimTable(prisma);
  await prisma.negotiationAcceptanceClaim.deleteMany({ where: { key } });
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
      createdAt: new Date(input.createdAt),
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

export async function saveCampaignPaymentEvidence(input: PersistedCampaignPaymentEvidence): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;
  await ensureCampaignPaymentEvidenceTable(prisma);
  await prisma.campaignPaymentEvidence.upsert({
    where: { transactionId: input.transactionId },
    create: {
      evidenceId: input.evidenceId,
      campaignId: input.campaignId,
      transactionId: input.transactionId,
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      amountPaise: BigInt(input.amountPaise),
      currency: input.currency,
      orderNotes: input.orderNotes === undefined ? undefined : jsonValue(input.orderNotes),
      verifiedAt: new Date(input.verifiedAt),
    },
    update: {
      evidenceId: input.evidenceId,
      campaignId: input.campaignId,
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      amountPaise: BigInt(input.amountPaise),
      currency: input.currency,
      orderNotes: input.orderNotes === undefined ? undefined : jsonValue(input.orderNotes),
      verifiedAt: new Date(input.verifiedAt),
    },
  });
}
