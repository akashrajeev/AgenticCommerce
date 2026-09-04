import assert from "node:assert/strict";
import test from "node:test";
import { createBuyerAgentRun, resetBuyerAgentRunsForTests } from "./buyer-agent";
import { clearBuyerAgentExecutionForTests, runBuyerAgent, type BuyerAgentPlanner } from "./buyer-agent-orchestrator";

function mockFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/.well-known/agent-commerce")) return new Response(JSON.stringify({ merchantId: "mandate-market", name: "Mandate Market", version: "1.3", currency: "INR", capabilities: { catalog: true, inventory: true, checkoutPreview: true }, endpoints: { catalog: "/api/agent/catalog", product: "/api/agent/products/:id", inventory: "/api/agent/inventory/:id", checkoutPreview: "/api/agent/checkout/preview" } }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/agent/catalog")) return new Response(JSON.stringify({ products: [
      { id: "hp-001", name: "SoundMax Pro", category: "headphones", pricePaise: 619900, rating: 4.8, inventory: 4, features: ["ANC", "40h battery"], specifications: {} },
      { id: "hp-002", name: "QuietTune X", category: "headphones", pricePaise: 579900, rating: 4.6, inventory: 3, features: ["ANC", "32h battery"], specifications: {} },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/agent/products/")) {
      const id = url.split("/").pop() ?? "hp-001";
      return new Response(JSON.stringify({ product: { id, name: id === "hp-002" ? "QuietTune X" : "SoundMax Pro", category: "headphones", pricePaise: id === "hp-002" ? 579900 : 619900, rating: id === "hp-002" ? 4.6 : 4.8, inventory: 4, features: ["ANC", "40h battery"], specifications: {} } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/agent/inventory/")) return new Response(JSON.stringify({ inventory: 4 }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/agent/checkout/preview")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { lineItems?: Array<{ productId: string; quantity: number }> };
      const prices: Record<string, number> = { "hp-001": 619900, "hp-002": 579900 };
      const lineItems = (body.lineItems ?? []).map((item) => ({ ...item, unitPricePaise: prices[item.productId] ?? 0, lineTotalPaise: (prices[item.productId] ?? 0) * item.quantity }));
      const totalPaise = lineItems.reduce((sum, item) => sum + item.lineTotalPaise, 0);
      return new Response(JSON.stringify({ quote: { quoteId: `quote_${Date.now()}`, merchantId: "mandate-market", lineItems, subtotalPaise: totalPaise, shippingPaise: 0, taxPaise: 0, discountPaise: 0, totalPaise, currency: "INR", expiresAt: new Date(Date.now() + 60_000).toISOString() } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test.afterEach(() => { resetBuyerAgentRunsForTests(); clearBuyerAgentExecutionForTests(); });

test("model-directed buyer loop reaches approval with explicit product selection", async () => {
  const restore = mockFetch();
  try {
    const sequence = ["discover_merchant", "read_catalog", "search_products", "inspect_product", "check_inventory", "select_product", "build_basket", "prepare_approval"] as const;
    let index = 0;
    const planner: BuyerAgentPlanner = async () => {
      const tool = sequence[index++];
      assert.ok(tool);
      return { tool, arguments: tool === "search_products" ? { query: "ANC headphones", category: "headphones", maxPricePaise: 700000, inStockOnly: true } : tool === "inspect_product" || tool === "check_inventory" ? { productId: "hp-002" } : tool === "select_product" ? { productId: "hp-002", reason: "Best observed combination of battery life, rating and price for the stated goal." } : tool === "build_basket" ? { lineItems: [{ productId: "hp-002", quantity: 1 }] } : {}, callId: `call-${index}`, model: "test-planner", outputItems: [{ type: "function_call", name: tool, call_id: `call-${index}`, arguments: "{}" }] };
    };
    const execution = await runBuyerAgent({ objective: "Find the best ANC headphones under ₹7,000", maxSpendPaise: 700000, planner, merchantInternalUrl: "http://merchant.test", persist: false });
    assert.equal(execution.run.state, "WAITING_FOR_APPROVAL");
    assert.equal(execution.trace.length, 8);
    assert.deepEqual(execution.trace.map((step) => step.tool), sequence);
    assert.equal(execution.workspace.selectedProductId, "hp-002");
    assert.equal(execution.workspace.latestQuote?.totalPaise, 579900);
    assert.equal(execution.workspace.basket[0]?.productId, "hp-002");
    const selectionStep = execution.trace.find((step) => step.tool === "select_product");
    assert.equal(selectionStep?.status, "succeeded");
    assert.equal((selectionStep?.output as { status?: string } | undefined)?.status, "SELECTED");
  } finally { restore(); }
});

test("a tool failure is returned to the planner and the agent can recover", async () => {
  const restore = mockFetch();
  try {
    const sequence = ["search_products", "read_catalog", "search_products", "inspect_product", "check_inventory", "select_product", "build_basket", "prepare_approval"] as const;
    let index = 0;
    const planner: BuyerAgentPlanner = async () => {
      const tool = sequence[index++];
      assert.ok(tool);
      return { tool, arguments: tool === "search_products" ? { query: "ANC headphones", category: "headphones", maxPricePaise: 700000, inStockOnly: true } : tool === "inspect_product" || tool === "check_inventory" ? { productId: "hp-001" } : tool === "select_product" ? { productId: "hp-001", reason: "Only after confirming it is available." } : tool === "build_basket" ? { lineItems: [{ productId: "hp-001", quantity: 1 }] } : {}, callId: `recovery-${index}`, model: "test-planner", outputItems: [{ type: "function_call", name: tool, call_id: `recovery-${index}`, arguments: "{}" }] };
    };
    const execution = await runBuyerAgent({ objective: "Recover from unavailable catalog", maxSpendPaise: 700000, planner, merchantInternalUrl: "http://merchant.test", persist: false });
    assert.equal(execution.run.state, "WAITING_FOR_APPROVAL");
    assert.equal(execution.trace.find((step) => step.status === "failed")?.error, "BUYER_AGENT_CATALOG_NOT_LOADED");
    assert.equal(execution.trace.at(-1)?.tool, "prepare_approval");
  } finally { restore(); }
});

test("planner cannot smuggle a payment tool into the execution loop", async () => {
  const planner = (async () => ({ tool: "create_razorpay_order", arguments: {}, callId: "malicious-call", model: "test-planner", outputItems: [] })) as unknown as BuyerAgentPlanner;
  const execution = await runBuyerAgent({ objective: "Never call payment", maxSpendPaise: 700000, planner, persist: false });
  assert.equal(execution.run.state, "FAILED");
  assert.equal(execution.run.lastError, "BUYER_AGENT_TOOL_NOT_ALLOWED");
});

test("buyer agent remains bounded by application-owned max steps", async () => {
  const run = createBuyerAgentRun({ objective: "bounded", maxSpendPaise: 700000, maxSteps: 2 });
  assert.equal(run.constraints.maxSteps, 2);
});
