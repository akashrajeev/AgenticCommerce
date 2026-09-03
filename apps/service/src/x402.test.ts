import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { buildPaymentRequired, canonicalizeX402ServiceMandate, clearX402MandateReplayStore, consumeX402ServiceMandate, decodeBase64Json, encodeBase64Json, facilitatorSettle, facilitatorVerify, paymentRequirementMatches, validateX402ServiceMandate, type X402PaymentPayload, type X402PaymentRequirements, type X402ServiceMandate } from "./x402.js";

const requirements: X402PaymentRequirements = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "10000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2" },
};

function makeMandate(overrides: Partial<X402ServiceMandate> = {}): X402ServiceMandate {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const unsigned = {
    version: 1 as const,
    mandateId: "xm_demo_001",
    subjectId: "user_001",
    agentId: "buyer_001",
    serviceId: "mandate-premium-data",
    network: requirements.network,
    asset: requirements.asset,
    payTo: requirements.payTo,
    maxAmountAtomic: "20000",
    nonce: "nonce-001",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
  const mandate = { ...unsigned, ...overrides, signatureBase64: "" } as X402ServiceMandate;
  mandate.signatureBase64 = sign(null, Buffer.from(canonicalizeX402ServiceMandate(mandate), "utf8"), privateKey).toString("base64");
  return mandate;
}

test("encodes and decodes x402 JSON headers", () => {
  const required = buildPaymentRequired("http://localhost:4021/resource", "MANDATE Agent Service", requirements.amount, requirements.network, requirements.asset, requirements.payTo);
  const decoded = decodeBase64Json<typeof required>(encodeBase64Json(required));
  assert.equal(decoded.x402Version, 2);
  assert.equal(decoded.accepts[0]?.amount, "10000");
});

test("matches exact payment requirements", () => {
  assert.equal(paymentRequirementMatches(requirements, { ...requirements }), true);
  assert.equal(paymentRequirementMatches(requirements, { ...requirements, amount: "10001" }), false);
});

test("verifies a signed MANDATE service authorization and blocks tampering", () => {
  clearX402MandateReplayStore();
  const mandate = makeMandate();
  validateX402ServiceMandate(mandate, requirements, "mandate-premium-data");
  assert.throws(() => validateX402ServiceMandate({ ...mandate, maxAmountAtomic: "1" }, requirements, "mandate-premium-data"), /X402_MANDATE_SIGNATURE_INVALID|X402_MANDATE_LIMIT_EXCEEDED/);
  assert.throws(() => validateX402ServiceMandate({ ...mandate, serviceId: "other-service" }, requirements, "mandate-premium-data"), /X402_MANDATE_SCOPE_MISMATCH|X402_MANDATE_SIGNATURE_INVALID/);
});

test("consumes the MANDATE replay key only after successful settlement", () => {
  clearX402MandateReplayStore();
  const mandate = makeMandate({ nonce: "nonce-replay" });
  validateX402ServiceMandate(mandate, requirements, "mandate-premium-data");
  validateX402ServiceMandate(mandate, requirements, "mandate-premium-data");
  consumeX402ServiceMandate(mandate, requirements);
  assert.throws(() => validateX402ServiceMandate(mandate, requirements, "mandate-premium-data"), /X402_MANDATE_REPLAY/);
});

test("calls facilitator verify and settle with the x402 v2 envelope", async () => {
  const seen: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    seen.push(url);
    const requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    assert.equal(requestBody.x402Version, 2);
    assert.deepEqual(requestBody.paymentRequirements, requirements);
    if (url.endsWith("/verify")) return new Response(JSON.stringify({ isValid: true, payer: "0xpayer" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ success: true, transaction: "0xtx", network: requirements.network, payer: "0xpayer", amount: requirements.amount }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const payload: X402PaymentPayload = { x402Version: 2, accepted: requirements, payload: { signature: "0xabc" } };
    const verified = await facilitatorVerify("http://facilitator.local", payload, requirements);
    const settled = await facilitatorSettle("http://facilitator.local", payload, requirements);
    assert.equal(verified.isValid, true);
    assert.equal(settled.success, true);
    assert.deepEqual(seen, ["http://facilitator.local/verify", "http://facilitator.local/settle"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
