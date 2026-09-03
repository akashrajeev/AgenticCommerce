import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import type { MerchantOffer, MerchantOfferAttestation } from "@mandate/types";
import { canonicalizeMerchantOfferAttestation, verifyMerchantOfferAttestation } from "./merchant-credentials.js";

const offer: MerchantOffer = {
  offerId: "offer_1",
  intentId: "intent_1",
  merchantId: "mandate-market",
  items: [{ productId: "hp-001", quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 }],
  amount: { currency: "INR", amountPaise: 399900 },
  quoteId: "quote_1",
  conditions: { fulfillment: "standard" },
  sourceProtocol: "mandate-native",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function signedOffer(): MerchantOfferAttestation {
  const keyPair = generateKeyPairSync("ed25519");
  const credential = {
    algorithm: "Ed25519" as const,
    keyId: "merchant-test-1",
    merchantId: "mandate-market",
    agentId: "merchant-agent:mandate-market",
    issuer: "mandate-market",
    publicKeyPem: keyPair.publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
  const payload = Buffer.from(canonicalizeMerchantOfferAttestation({ offer, credential }), "utf8");
  return { offerId: offer.offerId, credential, signatureBase64: sign(null, payload, keyPair.privateKey).toString("base64") };
}

test("accepts a valid merchant offer signature", () => {
  assert.doesNotThrow(() => verifyMerchantOfferAttestation(offer, signedOffer(), "mandate-market"));
});

test("rejects an amount tamper against the signed offer", () => {
  const attestation = signedOffer();
  const tampered = { ...offer, amount: { currency: "INR" as const, amountPaise: 399899 } };
  assert.throws(() => verifyMerchantOfferAttestation(tampered, attestation, "mandate-market"), /INVALID_MERCHANT_SIGNATURE/);
});

test("rejects a credential for a different merchant", () => {
  const attestation = signedOffer();
  assert.throws(() => verifyMerchantOfferAttestation(offer, attestation, "another-merchant"), /MERCHANT_CREDENTIAL_IDENTITY_MISMATCH/);
});

test("rejects malformed or wrong-sized signatures", () => {
  const attestation = signedOffer();
  assert.throws(() => verifyMerchantOfferAttestation(offer, { ...attestation, signatureBase64: "bad" }, "mandate-market"), /INVALID_MERCHANT_SIGNATURE/);
  assert.throws(() => verifyMerchantOfferAttestation(offer, { ...attestation, signatureBase64: Buffer.alloc(32).toString("base64") }, "mandate-market"), /INVALID_MERCHANT_SIGNATURE/);
});
