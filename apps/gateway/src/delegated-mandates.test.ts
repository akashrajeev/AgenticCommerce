import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { CheckoutQuote, Product } from "@mandate/types";
import { canonicalizeCheckoutBinding } from "@mandate/types";
import { clearDelegatedMandateStore, createDelegatedMandate, delegatedMandateStats, executeDelegatedMandate, revokeDelegatedMandate, settleDelegatedExecution } from "./delegated-mandates.js";

function product(id = "hp-001"): Product {
  return { id, sku: id, name: id === "hp-001" ? "SoundMax Pro" : "Arc Precision Mouse", slug: id, category: id === "hp-001" ? "headphones" : "mice", pricePaise: id === "hp-001" ? 399900 : 249900, currency: "INR", rating: 4.7, reviewCount: 20, inventory: 20, shortDescription: "test", description: "test", features: [], specifications: {}, tags: ["test"] };
}

function quote(productId = "hp-001"): CheckoutQuote {
  const item = product(productId);
  return { quoteId: `delegated-quote-${productId}`, merchantId: "mandate-market", lineItems: [{ productId: item.id, quantity: 1, unitPricePaise: item.pricePaise, lineTotalPaise: item.pricePaise }], subtotalPaise: item.pricePaise, shippingPaise: 0, taxPaise: 0, discountPaise: 0, totalPaise: item.pricePaise, currency: "INR", expiresAt: new Date(Date.now() + 60_000).toISOString() };
}

function checkout(q = quote(), id = `cs_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`) {
  const base = { checkoutId: id, merchantId: q.merchantId, quoteId: q.quoteId, currency: "INR" as const, totalPaise: q.totalPaise, lineItems: q.lineItems, expiresAt: q.expiresAt };
  return { ...base, cartHash: createHash("sha256").update(canonicalizeCheckoutBinding(base)).digest("hex") };
}

async function withMerchantFetch(fn: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const productId = path.includes("ms-001") ? "ms-001" : "hp-001";
    const q = quote(productId);
    const item = product(productId);
    if (path.includes("/api/agent/checkout/quotes/")) return new Response(JSON.stringify({ quote: q }), { status: 200 });
    if (path.includes("/api/agent/products/")) return new Response(JSON.stringify({ product: item }), { status: 200 });
    if (path.includes("/api/agent/inventory/")) return new Response(JSON.stringify({ inventory: 20 }), { status: 200 });
    throw new Error(`Unexpected fetch: ${path}`);
  };
  try { await fn(); } finally { globalThis.fetch = originalFetch; }
}

test.beforeEach(() => clearDelegatedMandateStore());

test("allows multiple purchases while enforcing a reusable total budget", async () => {
  await withMerchantFetch(async () => {
    const mandate = await createDelegatedMandate({ subjectId: "user_001", agentId: "buyer_001", purpose: "Office electronics", merchantIds: ["mandate-market"], maxSpendPerPurchase: { currency: "INR", amountPaise: 500000 }, totalBudget: { currency: "INR", amountPaise: 650000 }, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const first = await executeDelegatedMandate(mandate.mandateId, checkout());
    assert.equal(first.authorization.transaction.state, "policy_authorized");
    assert.equal(delegatedMandateStats(mandate.mandateId)?.reservedPaise, 399900);
    await assert.rejects(() => executeDelegatedMandate(mandate.mandateId, checkout()), /DELEGATED_MANDATE_REMAINING_BUDGET/);
    await settleDelegatedExecution(first.authorization.transaction.id, "confirmed");
    assert.equal(delegatedMandateStats(mandate.mandateId)?.spentPaise, 399900);
    const second = await executeDelegatedMandate(mandate.mandateId, checkout(quote("ms-001")));
    assert.equal(second.authorization.transaction.state, "policy_authorized");
    assert.equal(delegatedMandateStats(mandate.mandateId)?.remainingPaise, 200);
  });
});

test("blocks merchant and product violations without creating a reservation", async () => {
  await withMerchantFetch(async () => {
    const mandate = await createDelegatedMandate({ subjectId: "user_001", agentId: "buyer_001", purpose: "Approved electronics", merchantIds: ["mandate-market"], allowedProductIds: ["hp-001"], maxSpendPerPurchase: { currency: "INR", amountPaise: 500000 }, totalBudget: { currency: "INR", amountPaise: 700000 }, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await assert.rejects(() => executeDelegatedMandate(mandate.mandateId, { ...checkout(), merchantId: "other-merchant" }), /DELEGATED_MANDATE_MERCHANT_NOT_ALLOWED/);
    assert.equal(delegatedMandateStats(mandate.mandateId)?.blockedCount, 1);
    const q = quote();
    const base = { ...checkout(q), lineItems: [{ productId: "ms-001", quantity: 1, unitPricePaise: 249900, lineTotalPaise: 249900 }], totalPaise: 249900 };
    const tampered = { ...base, cartHash: createHash("sha256").update(canonicalizeCheckoutBinding(base)).digest("hex") };
    await assert.rejects(() => executeDelegatedMandate(mandate.mandateId, tampered), /DELEGATED_MANDATE_PRODUCT_NOT_ALLOWED/);
    assert.equal(delegatedMandateStats(mandate.mandateId)?.reservedPaise, 0);
    assert.equal(delegatedMandateStats(mandate.mandateId)?.blockedCount, 2);
  });
});

test("revocation immediately closes the execution boundary", async () => {
  const mandate = await createDelegatedMandate({ subjectId: "user_001", agentId: "buyer_001", purpose: "Today only", merchantIds: ["mandate-market"], maxSpendPerPurchase: { currency: "INR", amountPaise: 500000 }, totalBudget: { currency: "INR", amountPaise: 500000 }, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  await revokeDelegatedMandate(mandate.mandateId);
  await assert.rejects(() => executeDelegatedMandate(mandate.mandateId, checkout()), /DELEGATED_MANDATE_REVOKED/);
});
