import { createPublicKey, verify } from "node:crypto";
import type { MerchantAgentCredential, MerchantOffer, MerchantOfferAttestation } from "@mandate/types";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function canonicalizeMerchantOfferAttestation(input: { offer: MerchantOffer; credential: MerchantAgentCredential }): string {
  return JSON.stringify(stableValue(input));
}

export function verifyMerchantOfferAttestation(
  offer: MerchantOffer,
  attestation: MerchantOfferAttestation,
  expectedMerchantId: string,
): void {
  const credential = attestation.credential;
  if (attestation.offerId !== offer.offerId) throw new Error("NEGOTIATED_OFFER_ATTESTATION_MISMATCH");
  if (credential.algorithm !== "Ed25519") throw new Error("UNSUPPORTED_MERCHANT_CREDENTIAL");
  if (!credential.keyId.trim() || !credential.publicKeyPem.trim() || !credential.merchantId.trim() || !credential.agentId.trim() || !credential.issuer.trim()) {
    throw new Error("INVALID_MERCHANT_CREDENTIAL");
  }
  if (credential.merchantId !== expectedMerchantId || credential.issuer !== expectedMerchantId || credential.agentId !== `merchant-agent:${expectedMerchantId}`) {
    throw new Error("MERCHANT_CREDENTIAL_IDENTITY_MISMATCH");
  }

  let publicKey;
  try {
    publicKey = createPublicKey(credential.publicKeyPem);
  } catch {
    throw new Error("INVALID_MERCHANT_PUBLIC_KEY");
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(attestation.signatureBase64) || attestation.signatureBase64.length % 4 !== 0) {
    throw new Error("INVALID_MERCHANT_SIGNATURE");
  }
  const signature = Buffer.from(attestation.signatureBase64, "base64");
  if (signature.length !== 64) throw new Error("INVALID_MERCHANT_SIGNATURE");

  const payload = Buffer.from(canonicalizeMerchantOfferAttestation({ offer, credential }), "utf8");
  if (!verify(null, payload, publicKey, signature)) throw new Error("INVALID_MERCHANT_SIGNATURE");
}
