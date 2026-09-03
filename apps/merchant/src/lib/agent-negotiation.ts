import type { MerchantOffer, MerchantOfferAttestation } from "@mandate/types";

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
