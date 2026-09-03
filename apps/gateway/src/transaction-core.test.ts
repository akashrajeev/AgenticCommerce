import test from "node:test";
import assert from "node:assert/strict";
import type { CheckoutQuote, Product } from "@mandate/types";
import { evaluatePolicy, proposeTransaction, recordPayment, recordPaymentVerified, confirmOrder, retryFailedTransaction, getTimeline } from "./transaction-core.js";

type Snapshot = Parameters<typeof evaluatePolicy>[1];

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "hp-001",
    sku: "MM-HP-001",
    name: "SoundMax Pro",
    slug: "soundmax-pro",
    category: "headphones",
    pricePaise: 399900,
    currency: "INR",
    rating: 4.6,
    reviewCount: 10,
    inventory: 4,
    shortDescription: "ANC headphones",
    description: "ANC headphones",
    features: ["Active noise cancellation"],
    specifications: { anc: "true" },
    tags: ["anc"],
    ...overrides,
  };
}

function makeQuote(product: Product, overrides: Partial<CheckoutQuote> = {}): CheckoutQuote {
  return {
    quoteId: "quote_test",
    merchantId: "mandate-market",
    lineItems: [{ productId: product.id, quantity: 1, unitPricePaise: product.pricePaise, lineTotalPaise: product.pricePaise }],
    subtotalPaise: product.pricePaise,
    shippingPaise: 0,
    taxPaise: 0,
    discountPaise: 0,
    totalPaise: product.pricePaise,
    currency: "INR",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function evaluate(product: Product, quote: CheckoutQuote, input: Partial<Parameters<typeof evaluatePolicy>[0]> = {}) {
  return evaluatePolicy(
    { merchantId: "mandate-market", productId: product.id, quantity: 1, maxSpendPaise: 500000, reason: "buy it", quoteId: quote.quoteId, ...input },
    { product, quote, inventory: product.inventory } satisfies Snapshot,
  );
}

async function withMerchantFetch(product: Product, quote: CheckoutQuote, fn: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path.includes("/api/agent/products/")) return new Response(JSON.stringify({ product }), { status: 200, headers: { "content-type": "application/json" } });
    if (path.includes("/api/agent/inventory/")) return new Response(JSON.stringify({ inventory: product.inventory }), { status: 200, headers: { "content-type": "application/json" } });
    if (path.includes("/api/agent/checkout/quotes/")) return new Response(JSON.stringify({ quote }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`Unexpected test fetch: ${path}`);
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("policy allows an in-budget, in-stock transaction", () => {
  const product = makeProduct();
  const decision = evaluate(product, makeQuote(product));

  assert.equal(decision.decision, "ALLOW");
  assert.ok(decision.checks.every((check) => check.result === "PASS"));
});

test("policy blocks when verified total exceeds the user limit", () => {
  const product = makeProduct();
  const quote = makeQuote(product, {
    quoteId: "quote_test_2",
    totalPaise: 510000,
    subtotalPaise: 510000,
    lineItems: [{ productId: product.id, quantity: 1, unitPricePaise: product.pricePaise, lineTotalPaise: 510000 }],
  });

  const decision = evaluate(product, quote);
  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.checks.find((check) => check.rule === "MAX_SPEND")?.result, "FAIL");
});

test("policy blocks an expired quote", () => {
  const product = makeProduct();
  const quote = makeQuote(product, { quoteId: "quote_test_3", expiresAt: new Date(Date.now() - 60_000).toISOString() });

  const decision = evaluate(product, quote);
  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.checks.find((check) => check.rule === "QUOTE_VALIDITY")?.result, "FAIL");
});

test("policy blocks quantity above the configured limit", () => {
  const product = makeProduct();
  const quote = makeQuote(product, {
    quoteId: "quote_test_4",
    lineItems: [{ productId: product.id, quantity: 11, unitPricePaise: product.pricePaise, lineTotalPaise: product.pricePaise * 11 }],
    totalPaise: product.pricePaise * 11,
    subtotalPaise: product.pricePaise * 11,
  });

  const decision = evaluate(product, quote, { quantity: 11 });
  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.checks.find((check) => check.rule === "QUANTITY_LIMIT")?.result, "FAIL");
});

test("policy blocks when inventory cannot satisfy the request", () => {
  const product = makeProduct({ inventory: 1 });
  const quote = makeQuote(product, {
    quoteId: "quote_test_5",
    lineItems: [{ productId: product.id, quantity: 2, unitPricePaise: product.pricePaise, lineTotalPaise: product.pricePaise * 2 }],
    totalPaise: product.pricePaise * 2,
    subtotalPaise: product.pricePaise * 2,
  });

  const decision = evaluate(product, quote, { quantity: 2 });
  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.checks.find((check) => check.rule === "INVENTORY")?.result, "FAIL");
});

test("policy blocks a quote belonging to another merchant", () => {
  const product = makeProduct();
  const quote = makeQuote(product, { quoteId: "quote_test_6", merchantId: "other-merchant" });

  const decision = evaluate(product, quote);
  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.checks.find((check) => check.rule === "MERCHANT")?.result, "FAIL");
});

test("policy blocks when the quote line item does not match the current product price", () => {
  const product = makeProduct();
  const quote = makeQuote(product, {
    quoteId: "quote_test_7",
    lineItems: [{ productId: product.id, quantity: 1, unitPricePaise: 350000, lineTotalPaise: 350000 }],
    totalPaise: 350000,
    subtotalPaise: 350000,
  });

  const decision = evaluate(product, quote);
  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.checks.find((check) => check.rule === "AMOUNT_INTEGRITY")?.result, "FAIL");
});

test("late payment failure cannot regress a captured payment", async () => {
  const product = makeProduct();
  const quote = makeQuote(product, { quoteId: "quote_late_failure" });

  await withMerchantFetch(product, quote, async () => {
    const transaction = await proposeTransaction({
      merchantId: "mandate-market",
      productId: product.id,
      quantity: 1,
      maxSpendPaise: 500000,
      reason: "test late failure",
      quoteId: quote.quoteId,
    });

    assert.equal(transaction.state, "policy_authorized");
    recordPayment(transaction.id, "pay_test_late", "authorized");
    recordPayment(transaction.id, "pay_test_late", "captured");
    assert.equal((await import("./transaction-core.js")).getTransaction(transaction.id)?.state, "payment_captured");

    recordPayment(transaction.id, "pay_test_late", "failed");
    assert.equal((await import("./transaction-core.js")).getTransaction(transaction.id)?.state, "payment_captured");
    assert.ok(getTimeline(transaction.id).some((event) => event.action === "PAYMENT_FAILED_IGNORED"));
  });
});

test("failed payment retry creates a distinct transaction and preserves the failed attempt", async () => {
  const product = makeProduct();
  const quote = makeQuote(product, { quoteId: "quote_retry" });

  await withMerchantFetch(product, quote, async () => {
    const failed = await proposeTransaction({
      merchantId: "mandate-market",
      productId: product.id,
      quantity: 1,
      maxSpendPaise: 500000,
      reason: "test retry",
      quoteId: quote.quoteId,
    });

    recordPayment(failed.id, "pay_test_failed", "failed");
    assert.equal((await import("./transaction-core.js")).getTransaction(failed.id)?.state, "payment_failed");

    const retry = await retryFailedTransaction(failed.id);
    assert.notEqual(retry.id, failed.id);
    assert.equal(retry.state, "policy_authorized");
    assert.equal((await import("./transaction-core.js")).getTransaction(failed.id)?.state, "payment_failed");
    assert.ok(getTimeline(failed.id).some((event) => event.action === "PAYMENT_RETRY_REQUESTED"));
  });
});

test("payment retry is rejected unless the transaction is failed", async () => {
  const product = makeProduct();
  const quote = makeQuote(product, { quoteId: "quote_not_retryable" });

  await withMerchantFetch(product, quote, async () => {
    const transaction = await proposeTransaction({
      merchantId: "mandate-market",
      productId: product.id,
      quantity: 1,
      maxSpendPaise: 500000,
      reason: "test invalid retry",
      quoteId: quote.quoteId,
    });

    await assert.rejects(() => retryFailedTransaction(transaction.id), /TRANSACTION_NOT_RETRYABLE/);
  });
});

test("verified payment can be confirmed and remains non-regressible", async () => {
  const product = makeProduct();
  const quote = makeQuote(product, { quoteId: "quote_confirm" });

  await withMerchantFetch(product, quote, async () => {
    const transaction = await proposeTransaction({
      merchantId: "mandate-market",
      productId: product.id,
      quantity: 1,
      maxSpendPaise: 500000,
      reason: "test confirmation",
      quoteId: quote.quoteId,
    });

    recordPayment(transaction.id, "pay_test_confirm", "authorized");
    recordPayment(transaction.id, "pay_test_confirm", "captured");
    recordPaymentVerified(transaction.id);
    confirmOrder(transaction.id);
    assert.equal((await import("./transaction-core.js")).getTransaction(transaction.id)?.state, "order_confirmed");

    recordPayment(transaction.id, "pay_test_confirm", "failed");
    assert.equal((await import("./transaction-core.js")).getTransaction(transaction.id)?.state, "order_confirmed");
  });
});
