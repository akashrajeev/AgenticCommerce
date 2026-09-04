import assert from "node:assert/strict";
import test from "node:test";
import { createBuyerAgentRun } from "./buyer-agent";
import {
  BUYER_AGENT_TOOL_NAMES,
  createBuyerAgentWorkspace,
  executeBuyerAgentTool,
  type BuyerAgentToolContext,
} from "./buyer-agent-tools";

function context(): BuyerAgentToolContext {
  return {
    run: createBuyerAgentRun({ objective: "Find useful ANC headphones under ₹7,000", maxSpendPaise: 700000 }),
    workspace: createBuyerAgentWorkspace(),
    merchantInternalUrl: "http://merchant.test",
  };
}

test("exposes only shopping and preparation tools, never payment authority", () => {
  assert.deepEqual(BUYER_AGENT_TOOL_NAMES, [
    "discover_merchant",
    "read_catalog",
    "search_products",
    "inspect_product",
    "check_inventory",
    "get_quote",
    "compare_products",
    "get_merchant_recommendations",
    "build_basket",
    "validate_budget",
    "prepare_approval",
  ]);
  assert.equal(BUYER_AGENT_TOOL_NAMES.some((name) => /razorpay|payment|capture|refund|paid|authorize/i.test(name)), false);
});

test("discovers the machine-readable merchant and persists it in workspace", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    assert.equal(String(input), "http://merchant.test/.well-known/agent-commerce");
    return new Response(JSON.stringify({
      merchantId: "mandate-market",
      name: "Mandate Market",
      version: "1.3",
      currency: "INR",
      capabilities: { catalog: true, checkoutPreview: true },
      endpoints: { catalog: "/api/agent/catalog" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const ctx = context();
    const result = await executeBuyerAgentTool(ctx, "discover_merchant");
    assert.equal(ctx.workspace.manifest?.merchantId, "mandate-market");
    assert.equal((result.result as { name: string }).name, "Mandate Market");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reads catalog and search stays within the immutable buyer budget", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    assert.equal(String(input), "http://merchant.test/api/agent/catalog");
    return new Response(JSON.stringify({
      products: [
        { id: "hp-001", name: "SoundMax Pro", category: "headphones", pricePaise: 619900, rating: 4.7, inventory: 5, features: ["ANC", "30 hour battery"], specifications: { battery: "30h" } },
        { id: "hp-002", name: "Over Budget ANC", category: "headphones", pricePaise: 899900, rating: 4.9, inventory: 5, features: ["ANC"], specifications: {} },
        { id: "hp-003", name: "Out of Stock ANC", category: "headphones", pricePaise: 499900, rating: 4.8, inventory: 0, features: ["ANC"], specifications: {} },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const ctx = context();
    await executeBuyerAgentTool(ctx, "read_catalog");
    const result = await executeBuyerAgentTool(ctx, "search_products", { query: "ANC", category: "headphones", inStockOnly: true });
    const products = (result.result as { products: Array<{ id: string }> }).products;
    assert.deepEqual(products.map((product) => product.id), ["hp-001"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fresh quotes are application-bounded and persisted in workspace", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    assert.equal(String(input), "http://merchant.test/api/agent/checkout/preview");
    assert.deepEqual(JSON.parse(String(init?.body)), { lineItems: [{ productId: "hp-001", quantity: 1 }] });
    return new Response(JSON.stringify({
      quote: {
        quoteId: "quote_001",
        merchantId: "mandate-market",
        lineItems: [{ productId: "hp-001", quantity: 1, unitPricePaise: 619900, lineTotalPaise: 619900 }],
        subtotalPaise: 619900,
        shippingPaise: 0,
        taxPaise: 0,
        discountPaise: 0,
        totalPaise: 619900,
        currency: "INR",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const ctx = context();
    const result = await executeBuyerAgentTool(ctx, "get_quote", { lineItems: [{ productId: "hp-001", quantity: 1 }] });
    assert.equal(ctx.workspace.latestQuote?.quoteId, "quote_001");
    assert.equal((result.result as { totalPaise: number }).totalPaise, 619900);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("budget validation and preparation fail closed without a basket/quote", () => {
  const ctx = context();
  assert.doesNotThrow(() => executeBuyerAgentTool(ctx, "validate_budget", { totalPaise: 700000 }));
  assert.rejects(() => executeBuyerAgentTool(ctx, "validate_budget", { totalPaise: 700001 }), /BUYER_AGENT_BUDGET_EXCEEDED/);
  assert.rejects(() => executeBuyerAgentTool(ctx, "prepare_approval"), /BUYER_AGENT_BASKET_NOT_READY/);
});

test("unregistered tool names are rejected before execution", async () => {
  const ctx = context();
  await assert.rejects(
    () => executeBuyerAgentTool(ctx, "create_razorpay_order", {}),
    /BUYER_AGENT_TOOL_NOT_ALLOWED/,
  );
});
