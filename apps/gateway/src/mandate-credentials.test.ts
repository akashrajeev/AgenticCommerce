import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import type { UserMandate } from "@mandate/types";
import { canonicalizeUserMandate, verifySignedUserMandate } from "./mandate-credentials.js";
import type { MandateCredential } from "@mandate/types";

function mandate(overrides: Partial<UserMandate> = {}): UserMandate {
  const now = Date.now();
  return {
    mandateId: "mandate_signed_001",
    subjectId: "user_001",
    agentId: "buyer_001",
    merchantId: "mandate-market",
    purpose: "Buy approved headphones",
    maxSpend: { currency: "INR", amountPaise: 500000 },
    constraints: { category: "headphones" },
    approvalMode: "delegated_autonomous",
    nonce: "nonce_1234567890abcdef",
    issuedAt: new Date(now - 5_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    ...overrides,
  };
}

function signedMandate(base: UserMandate = mandate()) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const signatureBase64 = sign(null, Buffer.from(canonicalizeUserMandate(base), "utf8"), privateKey).toString("base64");
  const credential: MandateCredential = { algorithm: "Ed25519", keyId: "test-key-001", publicKeyPem, signatureBase64 };
  return { ...base, credential };
}

test("verifies an Ed25519-signed user mandate", () => {
  const signed = signedMandate();
  assert.doesNotThrow(() => verifySignedUserMandate(signed));
});

test("rejects a mandate after a signed field is changed", () => {
  const signed = signedMandate();
  const tampered = { ...signed, maxSpend: { currency: "INR" as const, amountPaise: 900000 } };
  assert.throws(() => verifySignedUserMandate(tampered), /INVALID_MANDATE_SIGNATURE/);
});

test("rejects malformed public keys", () => {
  const signed = signedMandate();
  assert.throws(() => verifySignedUserMandate({ ...signed, credential: { ...signed.credential, publicKeyPem: "not-a-key" } }), /INVALID_MANDATE_PUBLIC_KEY/);
});

test("canonicalization is deterministic for object property order", () => {
  const base = mandate();
  const reordered = { ...base, constraints: { category: "headphones" } };
  assert.equal(canonicalizeUserMandate(base), canonicalizeUserMandate(reordered));
});
