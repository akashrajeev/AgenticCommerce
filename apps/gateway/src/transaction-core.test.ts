import test from "node:test";
import assert from "node:assert/strict";
import type { CheckoutQuote, Product } from "@mandate/types";
import { evaluatePolicy } from "./transaction-core.js";

type Snapshot = Parameters<typeof evaluatePolicy>[1];

test("policy allows an in-budget, in-stock transaction", () => {
  const product = {
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
  } satisfies Product;

  const quote: CheckoutQuote = {
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
  };

  const decision = evaluatePolicy(
    { merchantId: "mandate-market", productId: product.id, quantity: 1, maxSpendPaise: 500000, reason: "buy it", quoteId: quote.quoteId },
    { product, quote, inventory: product.inventory } satisfies Snapshot,
  );

  assert.equal(decision.decision, "ALLOW");
  assert.ok(decision.checks.every((check) => check.result === "PASS"));
});

test("policy blocks when verified total exceeds the user limit", () => {
  const product = {
    id: "hp-001", sku: "MM-HP-001", name: "SoundMax Pro", slug: "soundmax-pro", category: "headphones",
    pricePaise: 399900, currency: "INR", rating: 4.6, reviewCount: 10, inventory: 4,
    shortDescription: "ANC headphones", description: "ANC headphones", features: ["ANC"], specifications: { anc: "true" }, tags: ["anc"],
  } satisfies Product;
  const quote: CheckoutQuote = {
    quoteId: "quote_test_2", merchantId: "mandate-market",
    lineItems: [{ productId: product.id, quantity: 1, unitPricePaise: product.pricePaise, lineTotalPaise: 510000 }],
    subtotalPaise: 510000, shippingPaise: 0, taxPaise: 0, discountPaise: 0, totalPaise: 510000,
    currency: "INR", expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  const decision = evaluatePolicy(
    { merchantId: "mandate-market", productId: product.id, quantity: 1, maxSpendPaise: 500000, reason: "buy it", quoteId: quote.quoteId },
    { product, quote, inventory: product.inventory } satisfies Snapshot,
  );

  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.checks.find((check) => check.rule === "MAX_SPEND")?.result, "FAIL");
});

test("policy blocks an expired quote", () => {
  const product = {
    id: "hp-001", sku: "MM-HP-001", name: "SoundMax Pro", slug: "soundmax-pro", category: "headphones",
    pricePaise: 399900, currency: "INR", rating: 4.6, reviewCount: 10, inventory: 4,
    shortDescription: "ANC headphones", description: "ANC headphones", features: ["ANC"], specifications: { anc: "true" }, tags: ["anc"],
  } satisfies Product;
  const quote: CheckoutQuote = {
    quoteId: "quote_test_3", merchantId: "mandate-market",
    lineItems: [{ productId: product.id, quantity: 1, unitPricePaise: product.pricePaise, lineTotalPaise: product.pricePaise }],
    subtotalPaise: product.pricePaise, shippingPaise: 0, taxPaise: 0, discountPaise: 0, totalPaise: product.pricePaise,
    currency: "INR", expiresAt: new Date(Date.now() - 60_000).toISOString(),
  };

  const decision = evaluatePolicy(
    { merchantId: "mandate-market", productId: product.id, quantity: 1, maxSpendPaise: 500000, reason: "buy it", quoteId: quote.quoteId },
    { product, quote, inventory: product.inventory } satisfies Snapshot,
  );

  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.checks.find((check) => check.rule === "QUOTE_VALIDITY")?.result, "FAIL");
});
