import type { MerchantOffer, MerchantOfferAttestation } from "@mandate/types";

const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
const GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? process.env.GATEWAY_INTERNAL_SECRET ?? "";

export type StoredNegotiation = {
  negotiationId: string;
  intent: Record<string, unknown>;
  merchant: { agentId: string; agentType: "merchant"; name: string; issuer: string };
  offers: MerchantOffer[];
  offerAttestations?: MerchantOfferAttestation[];
  turns: Array<Record<string, unknown>>;
  createdAt: string;
  expiresAt: string;
};

const negotiations = new Map<string, StoredNegotiation>();

export function cleanupExpiredNegotiations() {
  const now = Date.now();
  for (const [id, negotiation] of negotiations) {
    if (new Date(negotiation.expiresAt).getTime() <= now) negotiations.delete(id);
  }
}

export function getStoredNegotiation(negotiationId: string): StoredNegotiation | undefined {
  cleanupExpiredNegotiations();
  return negotiations.get(negotiationId);
}

export function saveNegotiation(negotiation: StoredNegotiation): void {
  negotiations.set(negotiation.negotiationId, negotiation);
}

export async function persistNegotiation(negotiation: StoredNegotiation): Promise<void> {
  const response = await fetch(`${GATEWAY_INTERNAL_URL}/v1/negotiation-sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(GATEWAY_SECRET ? { "x-mandate-gateway-secret": GATEWAY_SECRET } : {}),
    },
    body: JSON.stringify(negotiation),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "NEGOTIATION_SESSION_PERSIST_FAILED");
  }
}

export async function restoreNegotiation(negotiationId: string): Promise<StoredNegotiation | undefined> {
  const local = getStoredNegotiation(negotiationId);
  if (local) return local;

  try {
    const response = await fetch(`${GATEWAY_INTERNAL_URL}/v1/negotiation-sessions/${encodeURIComponent(negotiationId)}`, {
      headers: GATEWAY_SECRET ? { "x-mandate-gateway-secret": GATEWAY_SECRET } : undefined,
      cache: "no-store",
    });
    if (!response.ok) return undefined;
    const body = await response.json().catch(() => null) as { session?: StoredNegotiation } | null;
    if (!body?.session) return undefined;
    saveNegotiation(body.session);
    return body.session;
  } catch {
    return undefined;
  }
}
