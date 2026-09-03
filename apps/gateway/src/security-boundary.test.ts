import test from "node:test";
import assert from "node:assert/strict";
import type { CheckoutQuote, Product } from "@mandate/types";
import { verifyCheckoutSignature, verifyWebhookSignature } from "./razorpay.js";
import { attachRazorpayOrder, confirmOrder, getTransaction, markCheckoutStarted, proposeTransaction, recordPayment, transitionTransaction } from "./transaction-core.js";

function product(): Product {
  return { id: "hp-sec", sku: "SEC-001", name: "Security Headphones", slug: "security-headphones", category: "headphones", pricePaise: 399900, currency: "INR", rating: 4.8, reviewCount: 25, inventory: 5, shortDescription: "Test product", description: "Test product", features: ["ANC"], specifications: {}, tags: ["test"] };
}

function quote(): CheckoutQuote {
  const item = product();
  return { quoteId: "security-quote", merchantId: "mandate-market", lineItems: [{ productId: item.id, quantity: 1, unitPricePaise: item.pricePaise, lineTotalPaise: item.pricePaise }], subtotalPaise: item.pricePaise, shippingPaise: 0, taxPaise: 0, discountPaise: 0, totalPaise: item.pricePaise, currency: "INR", expiresAt: new Date(Date.now() + 60_000).toISOString() };
}

async function withMerchant(fn: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  const item = product();
  const q = quote();
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path.includes("/api/agent/products/")) return new Response(JSON.stringify({ product: item }), { status: 200 });
    if (path.includes("/api/agent/inventory/")) return new Response(JSON.stringify({ inventory: item.inventory }), { status: 200 });
    if (path.includes("/api/agent/checkout/quotes/")) return new Response(JSON.stringify({ quote: q }), { status: 200 });
    throw new Error(`Unexpected test fetch: ${path}`);
  };
  try { await fn(); } finally { globalThis.fetch = originalFetch; }
}

test("gateway rejects skipping directly from intent to Razorpay order", async () => {
  await withMerchant(async () => {
    const created = await proposeTransaction({ merchantId: "mandate-market", productId: "hp-sec", quantity: 1, maxSpendPaise: 500000, reason: "security transition test", quoteId: "security-quote" });
    assert.equal(created.state, "policy_authorized");
    assert.throws(() => transitionTransaction(created.id, "checkout_started"), /INVALID_TRANSITION/);
    assert.throws(() => confirmOrder(created.id), /PAYMENT_NOT_VERIFIED/);
  });
});

test("a policy-blocked transaction cannot receive a Razorpay order", async () => {
  await withMerchant(async () => {
    const created = await proposeTransaction({ merchantId: "mandate-market", productId: "hp-sec", quantity: 1, maxSpendPaise: 100000, reason: "security block test", quoteId: "security-quote" });
    assert.equal(created.state, "policy_blocked");
    assert.throws(() => attachRazorpayOrder(created.id, "order_should_not_exist"), /TRANSACTION_NOT_AUTHORIZED/);
    assert.equal(getTransaction(created.id)?.razorpayOrderId, undefined);
  });
});

test("duplicate captured payment callbacks do not create a second state transition", async () => {
  await withMerchant(async () => {
    const created = await proposeTransaction({ merchantId: "mandate-market", productId: "hp-sec", quantity: 1, maxSpendPaise: 500000, reason: "duplicate callback test", quoteId: "security-quote" });
    attachRazorpayOrder(created.id, "order_duplicate");
    markCheckoutStarted(created.id);
    recordPayment(created.id, "pay_duplicate", "captured");
    recordPayment(created.id, "pay_duplicate", "captured");
    assert.equal(getTransaction(created.id)?.state, "payment_captured");
  });
});

test("checkout and webhook verifiers reject missing signatures", () => {
  assert.equal(verifyCheckoutSignature("", "", ""), false);
  assert.equal(verifyWebhookSignature("{}", ""), false);
});
