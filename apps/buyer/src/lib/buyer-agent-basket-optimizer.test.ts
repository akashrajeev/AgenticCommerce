import assert from "node:assert/strict";
import test from "node:test";
import { createBuyerAgentRun, resetBuyerAgentRunsForTests } from "./buyer-agent";
import { createBuyerAgentWorkspace } from "./buyer-agent-tools";
import { executeBuyerAgentBasketOptimizerTool } from "./buyer-agent-basket-optimizer";

test.afterEach(() => resetBuyerAgentRunsForTests());

function context(maxSpendPaise = 700000) {
  const run = createBuyerAgentRun({ objective: "Find headphones with useful additions", maxSpendPaise });
  const workspace = createBuyerAgentWorkspace();
  workspace.catalog = [
    { id: "hp-001", name: "Headphones", category: "headphones", pricePaise: 619900, rating: 4.8, inventory: 4, features: ["ANC"], specifications: {} },
    { id: "case-001", name: "Travel Case", category: "accessories", pricePaise: 49900, rating: 4.5, inventory: 5, features: ["Protection"], specifications: {} },
    { id: "dock-001", name: "Premium Dock", category: "accessories", pricePaise: 149900, rating: 4.5, inventory: 5, features: ["Desk"], specifications: {} },
  ];
  workspace.selectedProductId = "hp-001";
  workspace.recommendations = [
    { productId: "case-001", type: "CROSS_SELL", score: 0.9, rationale: "Useful protection", incrementalRevenuePaise: 49900 },
    { productId: "dock-001", type: "CROSS_SELL", score: 0.8, rationale: "Useful at a desk", incrementalRevenuePaise: 149900 },
  ];
  return { run, workspace };
}

function installFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { lineItems?: Array<{ productId: string; quantity: number }> };
    const prices: Record<string, number> = { "hp-001": 619900, "case-001": 49900, "dock-001": 149900 };
    const lineItems = (body.lineItems ?? []).map((item) => ({ productId: item.productId, quantity: item.quantity, unitPricePaise: prices[item.productId] ?? 0, lineTotalPaise: (prices[item.productId] ?? 0) * item.quantity }));
    const totalPaise = lineItems.reduce((sum, line) => sum + line.lineTotalPaise, 0);
    return new Response(JSON.stringify({ quote: {
      quoteId: `quote_${Date.now()}_${Math.random()}`,
      merchantId: "mandate-market",
      lineItems,
      subtotalPaise: totalPaise,
      shippingPaise: 0,
      taxPaise: 0,
      discountPaise: 0,
      totalPaise,
      currency: "INR",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("compares base and recommendation bundles using fresh quotes", async () => {
  const restore = installFetch();
  try {
    const ctx = context();
    const result = await executeBuyerAgentBasketOptimizerTool(ctx, { merchantInternalUrl: "http://merchant.test" }, { recommendationProductIds: ["case-001", "dock-001"] });
    assert.equal(result.tool, "optimize_basket");
    assert.equal(result.result.options.length, 3);
    assert.equal(result.result.recommendedOptionId, "with-case-001");
  } finally {
    restore();
  }
});

test("marks an add-on ineligible when the fresh bundle quote exceeds the immutable budget", async () => {
  const restore = installFetch();
  try {
    const ctx = context(650000);
    const result = await executeBuyerAgentBasketOptimizerTool(ctx, { merchantInternalUrl: "http://merchant.test" }, { recommendationProductIds: ["case-001"] });
    const option = result.result.options.find((candidate) => candidate.optionId === "with-case-001");
    assert.equal(option?.eligible, false);
    assert.equal(result.result.recommendedOptionId, "base");
  } finally {
    restore();
  }
});
