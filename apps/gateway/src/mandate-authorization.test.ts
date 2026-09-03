import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { CheckoutQuote, Product, UserMandate } from "@mandate/types";
import { canonicalizeCheckoutBinding } from "@mandate/types";
import { canonicalizeUserMandate } from "./mandate-credentials.js";
import { authorizeCheckout, authorizeSignedCheckout, type MandateCheckoutBindingInput } from "./mandate-authorization.js";

function product(id = "hp-001"): Product {
  return { id, sku: id, name: id === "hp-001" ? "SoundMax Pro" : "Arc Precision Mouse", slug: id, category: id === "hp-001" ? "headphones" : "mice", pricePaise: id === "hp-001" ? 399900 : 249900, currency: "INR", rating: 4.6, reviewCount: 10, inventory: 20, shortDescription: "test", description: "test", features: [], specifications: {}, tags: ["test"] };
}

function quote(lineItems = [{ productId: "hp-001", quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 }]): CheckoutQuote {
  const subtotalPaise = lineItems.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  return { quoteId: `quote_mandate_${randomUUID()}`, merchantId: "mandate-market", lineItems, subtotalPaise, shippingPaise: 0, taxPaise: 0, discountPaise: 0, totalPaise: subtotalPaise, currency: "INR", expiresAt: new Date(Date.now() + 60_000).toISOString() };
}

function binding(): MandateCheckoutBindingInput {
  const q = quote();
  const checkout = { checkoutId: `cs_mandate_test_${randomUUID()}`, merchantId: q.merchantId, quoteId: q.quoteId, currency: "INR" as const, totalPaise: q.totalPaise, lineItems: q.lineItems, expiresAt: q.expiresAt };
  return { ...checkout, cartHash: createHash("sha256").update(canonicalizeCheckoutBinding(checkout)).digest("hex") };
}

function mandate(overrides: Partial<UserMandate> = {}): UserMandate {
  const now = Date.now();
  return { mandateId: `mandate_user_${randomUUID()}`, subjectId: "user_001", agentId: "buyer_001", merchantId: "mandate-market", purpose: "Buy approved headphones", maxSpend: { currency: "INR", amountPaise: 500000 }, constraints: {}, approvalMode: "human_present", nonce: `nonce_${randomUUID()}`, issuedAt: new Date(now - 5_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), ...overrides };
}

function signedMandate(base = mandate()) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const signatureBase64 = sign(null, Buffer.from(canonicalizeUserMandate(base), "utf8"), privateKey).toString("base64");
  return { ...base, credential: { algorithm: "Ed25519" as const, keyId: "test-key", publicKeyPem, signatureBase64 } };
}

async function withMerchantFetch(q: CheckoutQuote, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path.includes(`/api/agent/checkout/quotes/${q.quoteId}`)) return new Response(JSON.stringify({ quote: q }), { status: 200 });
    if (path.includes("/api/agent/products/")) {
      const id = path.split("/").pop() ?? "hp-001";
      return new Response(JSON.stringify({ product: product(id) }), { status: 200 });
    }
    if (path.includes("/api/agent/inventory/")) return new Response(JSON.stringify({ inventory: 20 }), { status: 200 });
    throw new Error(`Unexpected fetch: ${path}`);
  };
  try { await fn(); } finally { globalThis.fetch = original; }
}

test("authorizes a fresh checkout only when the mandate and binding match", async () => {
  const q = quote();
  const checkout = { ...binding(), quoteId: q.quoteId, merchantId: q.merchantId, lineItems: q.lineItems, totalPaise: q.totalPaise, expiresAt: q.expiresAt, cartHash: "" };
  checkout.cartHash = createHash("sha256").update(canonicalizeCheckoutBinding({ ...checkout })).digest("hex");
  await withMerchantFetch(q, async () => {
    const mandateInput = mandate();
    const result = await authorizeCheckout({ userMandate: mandateInput, checkout, paymentRail: "razorpay_standard_checkout" });
    assert.equal(result.transaction.state, "policy_authorized");
    assert.equal(result.transaction.mandateAuthorization?.authorizationId, result.authorization.authorizationId);
    assert.equal(result.checkoutMandate.cartHash, checkout.cartHash);
    assert.equal(result.paymentMandate.authorizationId, result.authorization.authorizationId);
    assert.equal(result.authorization.status, "authorized");
    assert.match(result.bindingSignature, /^[a-f0-9]{64}$/);
  });
});

test("authorizes a signed user mandate only after Ed25519 verification", async () => {
  const q = quote();
  const checkoutBase = { ...binding(), quoteId: q.quoteId, merchantId: q.merchantId, lineItems: q.lineItems, totalPaise: q.totalPaise, expiresAt: q.expiresAt };
  const checkout = { ...checkoutBase, cartHash: createHash("sha256").update(canonicalizeCheckoutBinding(checkoutBase)).digest("hex") };
  await withMerchantFetch(q, async () => {
    const result = await authorizeSignedCheckout({ userMandate: signedMandate(), checkout, paymentRail: "razorpay_standard_checkout" });
    assert.equal(result.authorization.status, "authorized");
  });
});

test("rejects a checkout whose cart hash has been tampered", async () => {
  await assert.rejects(
    () => authorizeCheckout({ userMandate: mandate(), checkout: { ...binding(), cartHash: "tampered" }, paymentRail: "razorpay_standard_checkout" }),
    /CHECKOUT_CART_HASH_MISMATCH/,
  );
});

test("rejects spending beyond the user mandate", async () => {
  const q = quote([{ productId: "hp-001", quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 }, { productId: "ms-001", quantity: 1, unitPricePaise: 249900, lineTotalPaise: 249900 }]);
  const checkoutBase = { checkoutId: `cs_mandate_limit_${randomUUID()}`, merchantId: q.merchantId, quoteId: q.quoteId, currency: "INR" as const, totalPaise: q.totalPaise, lineItems: q.lineItems, expiresAt: q.expiresAt };
  const checkout = { ...checkoutBase, cartHash: createHash("sha256").update(canonicalizeCheckoutBinding(checkoutBase)).digest("hex") } satisfies MandateCheckoutBindingInput;
  await assert.rejects(
    () => authorizeCheckout({ userMandate: mandate({ maxSpend: { currency: "INR", amountPaise: 500000 } }), checkout, paymentRail: "razorpay_standard_checkout" }),
    /MANDATE_SPEND_LIMIT_EXCEEDED/,
  );
});

test("rejects products outside an allow-list", async () => {
  await assert.rejects(
    () => authorizeCheckout({ userMandate: mandate({ allowedProductIds: ["ms-001"] }), checkout: binding(), paymentRail: "razorpay_standard_checkout" }),
    /MANDATE_PRODUCT_NOT_ALLOWED/,
  );
});

test("re-runs the normal gateway policy before issuing payment authorization", async () => {
  const q = quote([{ productId: "hp-001", quantity: 1, unitPricePaise: 400000, lineTotalPaise: 400000 }]);
  const checkoutBase = { checkoutId: `cs_mandate_revalidate_${randomUUID()}`, merchantId: q.merchantId, quoteId: q.quoteId, currency: "INR" as const, totalPaise: q.totalPaise, lineItems: q.lineItems, expiresAt: q.expiresAt };
  const checkout = { ...checkoutBase, cartHash: createHash("sha256").update(canonicalizeCheckoutBinding(checkoutBase)).digest("hex") } satisfies MandateCheckoutBindingInput;
  await withMerchantFetch(q, async () => {
    await assert.rejects(
      () => authorizeCheckout({ userMandate: mandate(), checkout, paymentRail: "razorpay_standard_checkout" }),
      /MANDATE_POLICY_BLOCKED/,
    );
  });
});

test("rejects replaying the same mandate nonce", async () => {
  const q = quote();
  const userMandate = mandate();
  const firstBase = { checkoutId: `cs_mandate_replay_a_${randomUUID()}`, merchantId: q.merchantId, quoteId: q.quoteId, currency: "INR" as const, totalPaise: q.totalPaise, lineItems: q.lineItems, expiresAt: q.expiresAt };
  const first = { ...firstBase, cartHash: createHash("sha256").update(canonicalizeCheckoutBinding(firstBase)).digest("hex") } satisfies MandateCheckoutBindingInput;
  const secondBase = { ...firstBase, checkoutId: `cs_mandate_replay_b_${randomUUID()}` };
  const second = { ...secondBase, cartHash: createHash("sha256").update(canonicalizeCheckoutBinding(secondBase)).digest("hex") } satisfies MandateCheckoutBindingInput;
  await withMerchantFetch(q, async () => {
    await authorizeCheckout({ userMandate, checkout: first, paymentRail: "razorpay_standard_checkout" });
    await assert.rejects(
      () => authorizeCheckout({ userMandate, checkout: second, paymentRail: "razorpay_standard_checkout" }),
      /MANDATE_NONCE_REPLAY/,
    );
  });
});
